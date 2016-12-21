/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/*jslint node: true, nomen: true */
'use strict';

var sprintf = require('util').format;

var async = require('vasync');
var assert = require('assert-plus');
var curry = require('lodash.curry');
var map = require('lodash.map');
var log = require('pino')({name: 'redilex'});

var _ = curry.placeholder; // For placeholder during curry.

var SYMBOLS = {
    index: 'i',
    sep: ':'
};

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

function makeProp(seed, mutable, lexical) {
    return { seed: seed, mutable: mutable, lexical: lexical };
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
    // Hard coded default seed functions for id and created.
    model.id = model.id || makeProp(require('shortid').generate, false, false);
    model.created = model.created || makeProp(Date.now, false, true);
    Object.keys(model).forEach(function (key) {
        if (model[key].seed) { model[key].seed = formatSeed(model[key].seed); }
        model[key].mutable = setDefault(model[key].mutable, false);
        model[key].lexical = setDefault(model[key].lexical, false);
        assert.bool(model[key].lexical, sprintf('model[%s].lexical', key));
        assert.bool(model[key].mutable, sprintf('model[%s].mutable', key));
    });
    log.trace({model: model}, 'Formatted model.');
    return model;
}

function formatHash(model, data, update) {
    var cleanHash = {};
    Object.keys(model).forEach(function (key) {
        if (data[key]) {
            cleanHash[key] = data[key];
        } else if (model[key].seed) {
            cleanHash[key] = model[key].seed();
        }
        if (update && !model[key].mutable) { delete cleanHash[key]; }
    });
    log.trace({hash: cleanHash}, 'Formatted hash for create or update.');
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
    data = data instanceof Array ? data : [data];
    var ids = [];
    var query = [];
    data.forEach(function (hash) {
        hash = formatHash(model, hash);
        ids.push(hash.id);
        query.push.apply(query, hashAndIndex(name, model, hash));
    });
    return {query: query, ids: ids};
}

function removeQuery(name, model, data) {
    data = data instanceof Array ? data : [data];
    var query = [];
    data.forEach(function (hash) {
        query.push.apply(query, hashAndIndex(name, model, hash, true));
    });
    return query;
}

function getQuery(name, data) {
    data = data instanceof Array ? data : [data];
    return data.map(function (id) {
        return hashGet(name, id);
    });
}

function updateQuery(name, model, data, oldData) {
    var ids = [];
    var query = [];
    data = data instanceof Array ? data : [data];
    data.forEach(function (hash, i) {
        // This could be cleaner..
        ids.push(hash.id);
        hash = formatHash(model, hash, true);
        hash.id = ids[i];
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

/** Primary Export */
function createModel(model, options, client) {
    var that = {};
    var opts = options || {};
    var name = opts.name;

    assert.object(model, 'model');
    assert.object(opts, 'opts');
    assert.string(name, 'name');

    client = client || require('redis').createClient();
    model = formatModel(model);

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
        var image = createQuery(name, model, data);
        log.trace({query: image.query}, 'Running create query.');
        multiexecimage(image, callback);
    }

    function remove(data, callback) {
        log.trace({data: data}, 'Attempting to remove hashes.');
        async.waterfall([
            curry(multiexec)(getQuery(name, data)),
            curry(getToRemove)(name, model),
            multiexec
        ], callback);
    }

    function update(data, callback) {
        data = data instanceof Array ? data : [data];
        log.trace({data: data}, 'Attempting to update hashes.');
        async.waterfall([
            curry(multiexec)(getQuery(name, map(data, 'id'))),
            curry(getToUpdate)(name, model, data),
            multiexecimage
        ], callback);
    }

    function get(data, callback) {
        log.trace({data: data}, 'Attempting to get hashes by id.');
        multiexec(getQuery(name, data), callback);
    }

    function search(field, term, callback) {
        var start = '[' + term;
        var end = start + '\xff';
        var key = makeKey(name, field, SYMBOLS.index);
        log.trace({term: term, field: field}, 'Attempting to search for hash ids.');
        async.waterfall([
            curry(zrangebylex)(key, start, end),
            parseSearch
        ], callback);
    }

    function searchGet(field, term, callback) {
        log.trace({term: term, field: field}, 'Attempting to search for hashes.');
        async.waterfall([
            curry(search)(term, field),
            curry(searchToGet)(name),
            multiexec
        ], callback);
    }

    that = {
        create: create,
        remove: remove,
        update: update,
        get: get,
        search: search,
        searchGet: searchGet
    };

    log.trace('Creating new model.');
    return Object.freeze(that);
}

module.exports = {
    createModel: createModel
};