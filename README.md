#redilex
A naive redis orm with lexical indexing. This module was created to add syntactical sugar to the node-redis client. It uses a model approach to managing hash objects within redis. It enables single field lexical indexing, hash creation and update validation, and provides hooks to serialize or alter hash data prior to storage and before returning hashes to your client.

## Installation

    npm install redilex

## Basic Use

```js
// Require the redilex module
var redilex = require('redilex');

/**
 * Define the model for a hash.
 */
var model = {
    name: {
        lexical: true
    },
    location: {
        seed: 'Home',
    },
    randNumber: {
        seed: Math.random
    },
    someField: {}
};

// This is a helper function that simply prints an error or prints data.
printPeople(err, data) {
    if (err) { return console.error(err); }
    console.log(data);
}

// Instantiate a new model object.
var person = redilex.createModel(model, {name: 'person'});

// Create a new hash with a name of Oscar, then get and print the stored hash.
person.create({name: 'Oscar'}, function (err, res) {
    if (err) { return console.error(err); }
    person.get(res, printPeople);
});

```

## Root Method

### **redilex.createModel**(*model*, *options*, *client*)
To create a model, at minimum you must provide an object describing the model and an options object containing a *name* property.

Additionally, an existing redis client can be passed as the last argument, but if it is not passed, one will be instantiated.

This method returns a model object with methods used to create, update, remove, get, and search against the model.

#### The *model* parameter
First, an example:

```js
// Require the joi module to customize schema validation.
var joi = require('joi');

var model = {
    name: {
        lexical: true,
        validate: joi.string().required(),
        updateValidate: joi.string()
    },
    email: {
        lexical: true,
        validate: joi.string().email().required(),
        updateValidate: joi.string().email()
    },
    randNumber: {
        seed: Math.random,
        mutable: false,
        validate: joi.number().required(),
        updateValidate: joi.number()
    },
    someArray: {
        validate: joi.array().items(joi.string()).required();
        updateValidate: joi.array().items(joi.string());
    }
};
```

The model is an object literal. Each key in the object corresponds to a hash field in redis. Each key has the follow optional properties:

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| seed | String, Number, Function | None | This is a value or function that will be seeded into a field during object creation. It is only seeded if no value is supplied. |
| lexical | Boolean | ```false``` | When set to true, redilex will lexicographically index this field. |
| validate | Joi Object | ```Joi.any().required()``` | The joi object that is validated against this field when a new object is created. |
| updateValidate | Joi Object | ```Joi.any()``` | The joi object that is validated against this field when an object is updated. |

Redilex uses [Joi](https://github.com/hapijs/joi) to add schema validation support. Joi has a fairly extensive api. None of the field properties are required.

#### The *options* parameter
Again, an example:

```js
var options = {
    name: 'people',
    preCreate: serializeHash,
    preUpdate: serializeHash,
    postGet: deserializeHash
}
```

The options parameter let's you set various options that are applied to all hashes based on the supplied model. Only the *name* sub-parameter is required. *preCreate*, *preUpdate*, and *postGet* are optional functions that can be used to modify hashes before they are created or updated, or after they are retrieved from redis. These functions will receive a single parameter, which is a complete hash object, and are expected to output a modified hash object. The primary use case for these functions is to allow you to serialize complex data types before they are stored in redis and to deserialize them when they are retrieved.

Following are example serialize and deserialize functions based on the model in the model parameter section:

```js
var serialize = require('serialize-javascript');

function serializeHash(hash) {
    if ('someArray' in hash) {
        hash.someArray = serialize(hash.someArray);
    }
    return hash;
}

function deserializeHash(hash) {
    hash.someArray = eval('(' + hash.someArray + ')');
    return hash;
}
```

These functions would allow you to validate an array of strings within a hash field, store the array as serialized javascript in redis, and deserialize the array whenever the hash is returned. The *preCreate* and *preUpdate* functions are called after hashes are seeded and validated. The *postGet* function is called after hashes have been retrieved.

## Model Methods

### [model].**create**(*data*, *callback*)
This method creates a new hash or hashes in redis. The *data* argument takes either a new object to store, or an array of new objects to store.

This method calls back with the idiomatic *callback(err, res)* where err contains any errors that occurred and res contains an array of new hash ids.

Examples:

```js
// Create a single hash
person.create({name: 'Jedidiah'}, printPeople);

// Create multiple hashes
person.create([{name: 'James'}, {name: 'Julian'}], printPeople);
```

### [model].**remove**(*data*, *callback*)
This method deletes an existing hash or hashes by id. The *data* argument takes either a single string representing the hash id to delete, or an array of ids to delete.

This method calls back with the idiomatic *callback(err, res)* where err contains any errors that occurred and res contains the raw redis query response.

Examples:

```js
var async = require('vasync');

// Removes a single hash.
person.remove('rkWkj65ZBx', printPeople);

// Removes multiple hashes
person.remove(['rkWkj65ZBx', 'ByeLi69WSl'], printPeople);

// Search and remove with nested functions
person.search({field: 'name', term: 'j'}, function (err, data) {
    if (err) { return console.error(err); }
    person.remove(data, printPeople);
});

// Search and remove using async.waterfall
async.waterfall([
    person.search.bind(undefined, {field: 'name', term: 'j'}),
    person.remove
], printPeople);
```

### [model].**update**(*data*, *callback*)
This method updates an existing hash or hashes in redis. The *data* argument takes either an object to update, or an array of objects to update. Every object that is being updated **MUST** have the id field populated correctly or this method will throw an error.

This method calls back with the idiomatic *callback(err, res)* where err contains any errors that occurred and res contains an array of the updated hash ids.

Examples:

```js
// Map Helper
function makeBobById(id) {
    return {
        id: id,
        name: 'Bob #' + id
    };
}

// Removes a single hash.
person.update({id: 'rkWkj65ZBx', name: 'Bob'}, printPeople);

// Removes multiple hashes
person.update([{id: 'rkWkj65ZBx', name: 'Jacob'}, {id: 'ByeLi69WSl', name: 'Linda'}], printPeople);

// Search and update with nested functions
person.search({field: 'name', term: 'j'}, function (err, data) {
    if (err) { return console.error(err); }
    person.update(data.map(makeBobById), printPeople);
});
```

### [model].**get**(*data*, *callback*)
This method retrieves a hash or hashes from redis by id. The *data* argument takes either a single string representing the hash id to get, or an array of ids to get.

This method calls back with the idiomatic *callback(err, res)* where err contains any errors that occurred and res contains an array of the retrieved hashes.

Example:

```js
// Gets a single hash by id.
person.get('rkWkj65ZBx', printPeople);

// Gets multiple hashes by id.
person.get(['rkWkj65ZBx', 'ByeLi69WSl'], printPeople);
```

### [model].**search**(*data*, *callback*)
The *data* argument is an object that requires at *term* string property and a *field* string property. It optionally accepts a *get* boolean property.

This method searches for a hash or hashes from redis by *data.term* within *data.field*. The *data.field* argument is the field to search on. The *data.term* argument is the term to search for. A search is made from left to right, and does not match an arbitrary substring. Searches are case insensitive and will strip any ':' characters from *data.term*. By default, search will return an array of matching model ids. If the *data.get* property is set to ```true```, then it will instead return an array of all matching hashes.

This method calls back with the idiomatic *callback(err, res)* where err contains any errors that occurred and res contains an array of matching hashes.

Examples:

```js
// This will print an array of matching hash ids, but not the full hashes.
person.search({field: 'name', term: 'j'}, printPeople);

// This will print an array of matching hashes in full.
person.search({field: 'name', term: 'j', get: true}, printPeople);
```

Note: If you search on a field that is not indexed the result will be an empty array. No error is returned. This is by design, so pay attention when you are searching.

## Contact
If you have any questions, they can be directed to brandon@null.pub. Thanks for your interest!