/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/*jslint node: true, nomen: true */
'use strict';

var MODEL = require('./MODEL');
var SYMBOLS = require('./SYMBOLS');

var helpers = require('./helpers');

function index(name, prop, id, value, remove) {
    var query = ['zadd',
        helpers.formatKey(name, prop, SYMBOLS.index),
        0,
        helpers.formatIndex(value, id)];
    if (remove) {
        query[0] = 'zrem';
        query.splice(2, 1);
    }
    return query;
}

function create(name, id, hash) {
    return Object.keys(hash).reduce(function (arr, key) {
        arr.push(key, hash[key]);
        return arr;
    }, ['hmset', helpers.formatKey(name, id)]);
}

function get(name, id) {
    return ['hgetall', helpers.formatKey(name, id)];
}

function remove(name, id) {
    return ['del', helpers.formatKey(name, id)];
}

function createAndIndex(name, model, hash, remove) {
    var query = remove ? [remove(name, hash.id)] : [create(name, hash.id, hash)];
    query.push.apply(query, multiIndex(name, model, hash, remove));
    return query;
}

function multiIndex(name, model, hash, remove) {
    var indices = helpers.getIndices(model);
    var query = [];
    indices.forEach(function (prop) {
        if (hash[prop]) {
            query.push(index(name, prop, hash.id, hash[prop], remove));
        }
    });
    return query;
}

function multiCreate(name, model, data) {
    var ids = [];
    var query = [];
    data.forEach(function (hash) {
        ids.push(hash.id);
        query.push.apply(query, createAndIndex(name, model, hash));
    });
    return {query: query, ids: ids};
}

function multiRemove(name, model, data) {
    var query = [];
    data.forEach(function (hash) {
        query.push.apply(query, createAndIndex(name, model, hash, true));
    });
    return query;
}

function multiGet(name, data) {
    return data.map(function (id) {
        return get(name, id);
    });
}

function multiUpdate(name, model, data, oldData) {
    var ids = [];
    var query = [];
    data.forEach(function (hash, i) {
        ids.push(hash.id);
        var oldHash = helpers.pruneObject(hash, oldData[i]);
        query.push.apply(query, createAndIndex(name, model, hash));
        query.push.apply(query, multiIndex(name, model, oldHash, true));
    });
    return {query: query, ids: ids};
}

var query = {
    index: index,
    create: create,
    get: get,
    remove: remove,
    createAndIndex: createAndIndex,
    multiIndex: multiIndex,
    multiCreate: multiCreate,
    multiRemove: multiRemove,
    multiGet: multiGet,
    multiUpdate: multiUpdate
};  

module.exports = query;
