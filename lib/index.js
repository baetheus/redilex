/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/*jslint node: true, nomen: true, esversion: 6 */
'use strict';

var sprintf = require('util').format;

var async = require('vasync');
var assert = require('assert-plus');
var curry = require('lodash.curry');
var map = require('lodash.map');
var joi = require('joi');
var pino = require('pino')({
    module: 'redilex',
    level: process.env.NODE_LEVEL || 'info'
});

var SYMBOLS = require('./SYMBOLS');

var queries = require('./queries');
var helpers = require('./helpers');
var schemas = require('./schemas');

/**
 * Fake Async Handlers
 */
function getToRemove(name, model, data, callback) {
    callback(null, queries.multiRemove(name, model, data));
}

function getToUpdate(name, model, data, callback) {
    console.log(data);
    if (helpers.testArray(data.current)) {
        return callback(new Error('Attempting to update non-existent hash.'));
    }
    callback(null, queries.multiUpdate(name, model, data.update, data.current));
}

function parseSearch(data, callback) {
    callback(null, map(data, helpers.parseIndex));
}

function idsToGet(name, data, callback) {
    callback(null, queries.multiGet(name, data));
}

function asyncMap(func, data, callback) {
    if (func) {
        return callback(null, map(data, func));    
    }
    callback(null, data);
}

function skip(data, callback) {
    console.log(data, 'Hey, skipping and logging.');
    console.log(map(data, 'id'), 'This is mapping data on id.');
    callback(null, data);
}

function toSearch(name, data, callback) {
    var start = '[' + data.term;
    var end = start + '\xff';
    var key = helpers.formatKey(name, data.field, SYMBOLS.index);
    callback(null, key, start, end);
}

/** Primary Export */
function createModel(model, options, client) {
    options = typeof options === 'string' ? {name: options} : options;
    var that = {};
    var opts = options || {};
    var name = opts.name;
    var log, createSchema, updateSchema;

    assert.object(model, 'model');
    assert.object(opts, 'opts');
    assert.string(name, 'name');
    assert.ifError(schemas.options.validate(opts).error);

    client = client || require('redis').createClient();
    model = helpers.formatModel(model);
    log = pino.child({model: name});

    // Create model schemas
    createSchema = joi.array().min(1).items(schemas.create(model)).required();
    updateSchema = joi.array().min(1).items(schemas.create(model, true)).required();

    // Wrap client and joi functions so they can be curried
    function multiexec(query, callback) {
        client.multi(query).exec(callback);
    }

    function multiexecupdate(update, callback) {
        var query = queries.multiGet(name, map(update, 'id'));
        multiexec(query, function multiexecupdateCB(err, current) {
            if (err) { return callback(err); }
            callback(null, {update, current});
        });
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

    function validate(schema, data, callback) {
        schema.validate(data, callback);
    }

    function createImage(data, callback) {
        callback(null, queries.multiCreate(name, model, data));
    }

    // Method definitions
    function create(data, callback) {
        log.trace({data: data}, 'Create begin.');
        data = helpers.seedHashes(model, helpers.wrapArray(data));
        async.waterfall([
            curry(validate)(updateSchema, data),
            curry(asyncMap)(opts.preCreate),
            createImage,
            multiexecimage
        ], callback);
    }

    function remove(data, callback) {
        log.trace({data: data}, 'Remove begin.');
        data = helpers.wrapArray(data);
        async.waterfall([
            curry(validate)(schemas.arrStr, data),
            curry(multiexec)(queries.multiGet(name, data)),
            curry(getToRemove)(name, model),
            multiexec
        ], callback);
    }

    function update(data, callback) {
        log.trace({data: data}, 'Update begin.');
        data = helpers.wrapArray(data);
        async.waterfall([
            curry(validate)(updateSchema, data),
            curry(asyncMap)(opts.preUpdate),
            multiexecupdate,
            curry(getToUpdate)(name, model),
            multiexecimage
        ], callback);
    }

    function get(data, callback) {
        log.trace({data: data}, 'Get begin.');
        data = helpers.wrapArray(data);
        async.waterfall([
            curry(validate)(schemas.arrStr, data),
            curry(idsToGet)(name),
            multiexec,
            curry(asyncMap)(opts.postGet)
        ], callback);
    }

    function search(data, callback) {
        log.trace({data: data}, 'Search begin.');
        var funcs = [
            curry(validate)(schemas.search, data),
            curry(toSearch)(name),
            zrangebylex,
            parseSearch
        ];
        if (data.get) {
            funcs.push(
                curry(idsToGet)(name),
                multiexec,
                curry(asyncMap)(opts.postGet)
            );
        }
        async.waterfall(funcs, callback);
    }

    that = {
        create: create,
        remove: remove,
        update: update,
        get: get,
        search: search
    };

    return that;
}

module.exports = {
    createModel: createModel
};