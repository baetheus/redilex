/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/*jslint node: true, nomen: true */
'use strict';

var sprintf = require('util').format;

var serialize = require('serialize-javascript');
var async = require('vasync');
var assert = require('assert-plus');
var curry = require('lodash.curry');
var map = require('lodash.map');
var joi = require('joi');
var log = require('pino')({
    name: 'redilex',
    level: process.env.NODE_LEVEL || 'info'
});


var SYMBOLS = {
    index: 'i',
    sep: ':'
};

var MODEL = {
    id: {
        seed: require('shortid').generate,
        mutable: false,
        lexical: false,
    },
    created: {
        seed: Date.now,
        mutable: false,
        lexical: true,
    }
};

/**
 * Joi Schemas
 */

var propSchema = joi.object().keys({
    seed: joi.func(),
    mutable: joi.boolean().required(),
    lexical: joi.boolean().required()
});

var searchSchema = joi.object().keys({
    field: joi.string().required(),
    term: joi.string().required(),
    get: joi.boolean()
});

var arrStrSchema = joi.array().min(1).items(joi.string()).required();

function createModelSchema(model, update) {
    var schema = joi.object();
    Object.keys(model).forEach(function (key) {
        var obj = {};
        if (!update || key === 'id') {
            obj[key] = joi.any().required();
        } else {
            obj[key] = joi.any();
        }
        schema = schema.keys(obj);
    });
    return schema;
}

/**
 * Helper Functions
 */

function wrapFunc(seed) { return function () { return seed; }; }

function makeInd(value, id) {
    value = String(value).replace(/[\s+:]/g, '').toLowerCase();
    return sprintf('%s%s%s', value, SYMBOLS.sep, id);
}

function unmakeInd(value) {
    return value.substring(value.indexOf(SYMBOLS.sep) + 1);
}

function makeKey(name, id, sub) {
    var key;
    if (sub) {
        key = sprintf('%s%s%s%s%s', name, SYMBOLS.sep, sub, SYMBOLS.sep, id);
    } else {
        key = sprintf('%s%s%s', name, SYMBOLS.sep, id);
    }
    return key;
}

function makeProp(seed, mutable, lexical, validate) {
    return {
        seed: seed,
        mutable: mutable,
        lexical: lexical,
        validate: validate
    };
}

function makeIndKeys(model) {
    return Object.keys(model).reduce(function (arr, key) {
        if (model[key].lexical) { arr.push(key); }
        return arr;
    }, []);
}

function pruneObj(model, prunee) {
    var pruned = {};
    Object.keys(model).forEach(function (prop) {
        pruned[prop] = prunee[prop];
    });
    return pruned;
}

function setDefault(current, def) {
    if (current === undefined) {
        return def;
    }
    return current;
}

function wrapArr(data) {
    if (data instanceof Array) {
        return data;
    }
    return [data];
}

/**
 * Formatting Functions
 */

function formatSeed(seed) {
    if (typeof seed !== 'function') {
        seed = wrapFunc(seed);
    }
    return seed;
}

function formatModel(model) {
    var output = Object.assign({}, MODEL, model);
    Object.keys(output).forEach(function (key) {
        if (output[key].seed) {
            output[key].seed = formatSeed(output[key].seed);
        }
        output[key].mutable = setDefault(output[key].mutable, false);
        output[key].lexical = setDefault(output[key].lexical, false);
        joi.validate(output[key], propSchema, function (err, value) {
            if (err) { throw err; }
            log.trace({value: value}, 'Clean model property.');
        });
    });
    log.trace({model: output}, 'Formatted model.');
    return output;
}

function seedHash(model, data) {
    var cleanHash = {};
    Object.keys(model).forEach(function (key) {
        if (data[key]) {
            cleanHash[key] = data[key];
        } else if (model[key].seed) {
            cleanHash[key] = model[key].seed();
        }
    });
    log.trace({hash: cleanHash}, 'Seeded hash for create.');
    return cleanHash;
}

function seedHashes(model, data) {
    var seededData = data.map(curry(seedHash)(model));
    log.trace({data: seededData}, 'Completed seeding.');
    return seededData;
}

function serializeHash(model, data) {
    var cleanHash = {};
    Object.keys(model).forEach(function (key) {
        if (typeof data[key] !== 'string' && typeof data[key] !== 'number') {
            cleanHash[key] = serialize(data[key]);
        } else {
            cleanHash[key] = data[key];
        }
    });
    return cleanHash;
}

/**
 * Query Primitive Generators
 */
function hashIndex(name, prop, id, value, remove) {
    var query = ['zadd', makeKey(name, prop, SYMBOLS.index), 0, makeInd(value, id)];
    if (remove) {
        query[0] = 'zrem';
        query.splice(2, 1);
    }
    return query;
}

function hashSet(name, id, hash) {
    return Object.keys(hash).reduce(function (arr, key) {
        arr.push(key, hash[key]);
        return arr;
    }, ['hmset', makeKey(name, id)]);
}

function hashGet(name, id) {
    return ['hgetall', makeKey(name, id)];
}

function hashRem(name, id) {
    return ['del', makeKey(name, id)];
}

function multiIndex(name, model, hash, remove) {
    var indices = makeIndKeys(model);
    var query = [];
    indices.forEach(function (prop) {
        if (hash[prop]) {
            query.push(hashIndex(name, prop, hash.id, hash[prop], remove));
        }
    });
    return query;
}

function hashAndIndex(name, model, hash, remove) {
    var query = remove ? [hashRem(name, hash.id)] : [hashSet(name, hash.id, hash)];
    query.push.apply(query, multiIndex(name, model, hash, remove));
    return query;
}

/**
 * General Query Functions
 */
function createQuery(name, model, data) {
    var ids = [];
    var query = [];
    log.trace('Creating queries..');
    data.forEach(function (hash) {
        ids.push(hash.id);
        hash = serializeHash(model, hash);
        query.push.apply(query, hashAndIndex(name, model, hash));
    });
    log.trace({query: query}, 'Completed create query.');
    return {query: query, ids: ids};
}

function removeQuery(name, model, data) {
    var query = [];
    data.forEach(function (hash) {
        query.push.apply(query, hashAndIndex(name, model, hash, true));
    });
    log.trace({query: query}, 'Completed remove query.');
    return query;
}

function getQuery(name, data) {
    return data.map(function (id) {
        return hashGet(name, id);
    });
}

function updateQuery(name, model, data, oldData) {
    var ids = [];
    var query = [];
    data.forEach(function (hash, i) {
        ids.push(hash.id);
        hash = serializeHash(model, hash);
        var oldHash = pruneObj(hash, oldData[i]);
        query.push.apply(query, hashAndIndex(name, model, hash));
        query.push.apply(query, multiIndex(name, model, oldHash, true));
    });
    return {query: query, ids: ids};
}


/**
 * Fake Async Handlers
 */
function getToRemove(name, model, data, callback) {
    callback(null, removeQuery(name, model, data));
}

function getToUpdate(name, model, data, oldData, callback) {
    callback(null, updateQuery(name, model, data, oldData));
}

function parseSearch(data, callback) {
    callback(null, map(data, unmakeInd));
}

function searchToGet(name, data, callback) {
    callback(null, getQuery(name, data));
}

function rollCallback(msg, callback, err, res) {
    log.trace({err: err, res: res}, msg);
    callback(err, res);
}

/** Primary Export */
function createModel(model, options, client) {
    options = typeof options === 'string' ? {name: options} : options;
    var that = {};
    var opts = options || {};
    var name = opts.name;
    var mSchema, uSchema, createSchema, updateSchema;

    assert.object(model, 'model');
    assert.object(opts, 'opts');
    assert.string(name, 'name');

    client = client || require('redis').createClient();
    model = formatModel(model);

    // Create model schemas
    mSchema = setDefault(opts.mSchema, createModelSchema(model));
    uSchema = setDefault(opts.uSchema, createModelSchema(model, true));
    createSchema = joi.array().min(1).items(mSchema).required();
    updateSchema = joi.array().min(1).items(uSchema).required();

    // Wrap client functions so they can be curried.
    function multiexec(query, callback) {
        client.multi(query).exec(callback);
    }

    function multiexecimage(image, callback) {
        multiexec(image.query, function (err, res) {
            if (err) { return callback(err, res); }
            callback(null, image.ids);
        });
    }

    function zrangebylex(key, start, end, callback) {
        client.zrangebylex(key, start, end, callback);
    }

    // Model definitions.
    function create(data, callback) {
        data = seedHashes(model, wrapArr(data));
        var validate = createSchema.validate(data);
        if (validate.error) {
            log.trace({validate: validate}, 'Failed schema validation.');
            return callback(validate.error);
        }
        log.trace('Validated..');
        var image = createQuery(name, model, data);
        log.trace({query: image.query}, 'Running create query.');
        multiexecimage(image, curry(rollCallback)('Create Complete', callback));
    }

    function remove(data, callback) {
        data = wrapArr(data);
        var validate = arrStrSchema.validate(data);
        if (validate.error) {
            log.trace({validate: validate}, 'Failed schema validation.');
            return callback(validate.error);
        }
        log.trace({data: data}, 'Attempting to remove hashes.');
        async.waterfall([
            curry(multiexec)(getQuery(name, data)),
            curry(getToRemove)(name, model),
            multiexec
        ], curry(rollCallback)('Remove Complete', callback));
    }

    function update(data, callback) {
        data = wrapArr(data);
        var validate = updateSchema.validate(data);
        if (validate.error) {
            log.trace({validate: validate}, 'Failed schema validation.');
            return callback(validate.error);
        }
        log.trace({data: data}, 'Attempting to update hashes.');
        async.waterfall([
            curry(multiexec)(getQuery(name, map(data, 'id'))),
            curry(getToUpdate)(name, model, data),
            multiexecimage
        ], curry(rollCallback)('Create Complete', callback));
    }

    function get(data, callback) {
        data = wrapArr(data);
        var validate = arrStrSchema.validate(data);
        if (validate.error) {
            log.trace({validate: validate}, 'Failed schema validation.');
            return callback(validate.error);
        }
        log.trace({data: data}, 'Attempting to get hashes by id.');
        multiexec(getQuery(name, data), curry(rollCallback)('Create Complete', callback));
    }

    function search(data, callback) {
        var validate = joi.validate(data, searchSchema);
        if (validate.error) {
            log.trace({validate: validate}, 'Failed schema validation.');
            return callback(validate.error);
        }
        var start = '[' + data.term;
        var end = start + '\xff';
        var key = makeKey(name, data.field, SYMBOLS.index);
        var funcs = [
            curry(zrangebylex)(key, start, end),
            parseSearch
        ];
        if (data.get) {
            funcs.push(curry(searchToGet)(name), multiexec);
        }
        log.trace(data, 'Attempting to search for hash ids.');
        async.waterfall(funcs, curry(rollCallback)('Create Complete', callback));
    }

    that = {
        create: create,
        remove: remove,
        update: update,
        get: get,
        search: search
    };

    log.trace('Creating new model.');
    return Object.freeze(that);
}

module.exports = {
    createModel: createModel
};