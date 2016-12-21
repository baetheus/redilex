#redilex
A naive redis orm with lexical indexing. This module was created to add a small amount of syntactical sugar to the node-redis client. It uses a model approach to managing hash objects within redis. Additionally, it has some simple hash property flags such as ```lexical```, ```mutable```, and ```seed``` that make creating and searching for hashes a little easier.

## Installation

    npm install redilex

## Basic Use

```js
var redilex = require('redilex');

var model = {
    name: {
        lexical: true
    },
    location: {
        seed: 'Home',
        mutable: true
    },
    randNumber: {
        seed: Math.random
    },
    someField: {}
};

var person = redilex.createModel(model, {name: 'person'});

person.create({name: 'Oscar'}, callback(err, res) {
    if (err) { return console.error(err); }
    console.log(res); // Will return a short uuid referencing the Oscar hash.
});
```

## Important Notes
By default, redilex will add an *id* field and a *created* field. These fields can be overwritten by your model definition. The *id* field will be seeded with a random shortuuid provided by the shortid module. The *created* field will be seeded with the ```Date.now()``` function (a Unix timestamp).

The model fields default to having no seed, and values of false for *mutable* and *lexical*.

### The **seed** Property
This property can be a string, number, or a function. The function will be called with no arguments. The output of the function or the supplied string or number will be seeded into the field during the creation of the object **ONLY** if the field is not contained in the create object already. If effectively functions as a default value on create.

### The **mutable** Property
This property defines whether the field can be updated. If set to false, then the field will be stripped from any update method calls.

### The **lexical** Property
This property defines whether the field should be lexicographically indexed. If set to *true* then the field can be used with the *search* method.

## Methods

### **redilex.createModel**(*model*, *options*, *client*)
To create a model, at minimum you must provide an object describing the model and an options object containing a *name* property.

Additionally, an existing redis client can be passed as the last argument, but if it is not passed, one will be instantiated.

This method returns a model object with methods used to create, update, remove, get, search, and searchGet against that model.

### [model].**create**(*data*, *callback*)
This method creates a new hash or hashes in redis. The *data* argument takes either a new object to store, or an array of new objects to store.

This method calls back with the idiomatic *callback(err, res)* where err contains any errors that occurred and res contains an array of new hash ids.

### [model].**remove**(*data*, *callback*)
This method deletes an existing hash or hashes by id. The *data* argument takes either a single string representing the hash id to delete, or an array of ids to delete.

This method calls back with the idiomatic *callback(err, res)* where err contains any errors that occurred and res contains the raw redis query response.

### [model].**update**(*data*, *callback*)
This method updates an existing hash or hashes in redis. The *data* argument takes either an object to update, or an array of objects to update. Every object that is being updated **MUST** have the id field populated correctly or this method will throw an error.

This method calls back with the idiomatic *callback(err, res)* where err contains any errors that occurred and res contains an array of the updated hash ids.

### [model].**get**(*data*, *callback*)
This method retrieves a hash or hashes from redis by id. The *data* argument takes either a single string representing the hash id to get, or an array of ids to get.

This method calls back with the idiomatic *callback(err, res)* where err contains any errors that occurred and res contains an array of the retrieved hashes.

### [model].**search**(*field*, *term*, *callback*)
This method searches for a hash or hashes from redis by *term* within *field*. The *field* argument is the field to search on. The *term* argument is the term to search for. Searches are case insensitive and will strip any ':' characters from *term*. This can be changed by altering the SYMBOLS object within the redilex module. Later on I may pull this into the options object.

This method calls back with the idiomatic *callback(err, res)* where err contains any errors that occurred and res contains an array of matching hash ids.

### [model].**searchGet**(*field*, *term*, *callback*)
This method searches for a hash or hashes from redis by *term* within *field*. The *field* argument is the field to search on. The *term* argument is the term to search for. A search is made from left to right, and does not match an arbitrary substring. Searches are case insensitive and will strip any ':' characters from *term*. This can be changed by altering the SYMBOLS object within the redilex module. Later on I may pull this into the options object.

For Example:

    person.search('name', 'osc', cbHandler);

This will match the hash created in Basic Use.

    person.search('name', 'car', cbHandler);

This will *not* match the hash created in Basic Use.

This method calls back with the idiomatic *callback(err, res)* where err contains any errors that occurred and res contains an array of matching hashes.
