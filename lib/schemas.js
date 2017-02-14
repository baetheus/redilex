/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/*jslint node: true, nomen: true */
'use strict';

var joi = require('joi');

var schemas = {};

schemas.prop = joi.object().keys({
    seed: joi.func(),
    lexical: joi.boolean().required(),
    validate: joi.object().required(),
    updateValidate: joi.object().required()
});

schemas.search = joi.object().keys({
    field: joi.string().required(),
    term: joi.string().required(),
    offest: joi.number().positive().integer(),
    count: joi.number().positive().integer(),
    get: joi.boolean()
}).and('offset', 'count');

schemas.options = joi.object().keys({
    name: joi.string().required(),
    preCreate: joi.func(),
    preUpdate: joi.func(),
    postGet: joi.func()
});

schemas.arrStr = joi.array().min(1).items(joi.string()).required();

schemas.create = function createSchema(model, update) {
    var schema = joi.object();
    Object.keys(model).forEach(function (key) {
        var obj = {};
        if (update) {
            obj[key] = model[key].updateValidate;
        } else {
            obj[key] = model[key].validate;
        }
        schema = schema.keys(obj);
    });
    return schema;
};

module.exports = schemas;