/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/*jslint node: true, nomen: true */
'use strict';

var sprintf = require('util').format;

var joi = require('joi');
var curry = require('lodash.curry');

var MODEL = require('./MODEL');
var SYMBOLS = require('./SYMBOLS');

var schemas = require('./schemas');

function wrapFunc(seed) { return function () { return seed; }; }

function wrapArray(data) {
    if (data instanceof Array) {
        return data;
    }
    return [data];
}

function formatIndex(value, id) {
    value = String(value).replace(/[\s+:]/g, '').toLowerCase();
    return sprintf('%s%s%s', value, SYMBOLS.sep, id);
}

function formatKey(name, id, sub) {
    var key;
    if (sub) {
        key = sprintf('%s%s%s%s%s', name, SYMBOLS.sep, sub, SYMBOLS.sep, id);
    } else {
        key = sprintf('%s%s%s', name, SYMBOLS.sep, id);
    }
    return key;
}

function formatProp(seed, lexical, validate, updateValidate) {
    return {
        seed: seed,
        lexical: lexical,
        validate: validate,
        updateValidate: updateValidate
    };
}

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
        output[key].lexical = setDefault(output[key].lexical, false);
        output[key].validate = setDefault(output[key].validate, joi.any().required());
        output[key].updateValidate = setDefault(output[key].updateValidate, joi.any());
        joi.validate(output[key], schemas.prop, function (err, value) {
            if (err) { throw err; }
        });
    });
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
    return cleanHash;
}

function seedHashes(model, data) {
    var seededData = data.map(curry(seedHash)(model));
    return seededData;
}

function parseIndex(value) {
    return value.substring(value.indexOf(SYMBOLS.sep) + 1);
}

function getIndices(model) {
    return Object.keys(model).reduce(function (arr, key) {
        if (model[key].lexical) { arr.push(key); }
        return arr;
    }, []);
}

function pruneObject(model, prunee) {
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

var helpers = {
    wrapFunc: wrapFunc,
    wrapArray: wrapArray,
    formatIndex: formatIndex,
    formatKey: formatKey,
    formatProp: formatProp,
    formatSeed: formatSeed,
    formatModel: formatModel,
    seedHash: seedHash,
    seedHashes: seedHashes,
    parseIndex: parseIndex,
    getIndices: getIndices,
    pruneObject: pruneObject,
    setDefault: setDefault
};

module.exports = helpers;