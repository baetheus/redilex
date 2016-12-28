/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/*jslint node: true, nomen: true */
'use strict';

var joi = require('joi');

var MODEL = {
    id: {
        seed: require('shortid').generate,
        lexical: false,
        validate: joi.string().required(),
        updateValidate: joi.string().required()
    },
    created: {
        seed: Date.now,
        lexical: true,
        validate: joi.number().integer().required(),
        updateValidate: joi.number().integer()
    }
};

module.exports = MODEL;
