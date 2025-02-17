/*!
 * migrate - Set
 * Copyright (c) 2010 TJ Holowaychuk <tj@vision-media.ca>
 * MIT Licensed
 */

/**
 * Module dependencies.
 */

import { EventEmitter } from 'events';
import path from 'path';
import mongoose from 'mongoose';

/**
 * Initialize a new migration `Set` with the given `path`
 * which is used to store data between migrations.
 *
 * @param {String} path
 * @api private
 */

export function Set(path) {
  this.migrations = [];
  this.path = path;
  this.pos = 0;
}

/**
 * Inherit from `EventEmitter.prototype`.
 */

Set.prototype.__proto__ = EventEmitter.prototype;

/**
 * Save the migration data and call `fn(err)`.
 *
 * @param {Function} fn
 * @api public
 */

Set.prototype.save = function (fn) {
  var self = this;
  this.connect(fn);
};

/**
 * Load the migration data and call `fn(err, obj)`.
 *
 * @param {Function} fn
 * @return {Type}
 * @api public
 */

Set.prototype.load = function (fn) {
  this.emit('load');
  this.connect(fn, 'new');
};

// get the config file path from env variable
var configFile =
  process.env.NODE_MONGOOSE_MIGRATIONS_CONFIG ||
  process.cwd() + '/config/migrations.js';
var configPath = path.resolve(configFile);
var json = await import(configPath);
if (json.default) {
  json = json.default;
}
var env = process.env.NODE_ENV || 'development';
var config = json[env];
var Schema = mongoose.Schema;
var Migration;
var MigrationSchema = new Schema(config.schema);
mongoose.connect(config.db, config.dbOptions);

/**
 * Connect to mongo
 */
Set.prototype.connect = async function (fn, type) {
  var self = this;
  if (type) {
    Migration = mongoose.model(config.modelName, MigrationSchema);
  } else {
    Migration = mongoose.model(config.modelName);
  }

  let doc;
  try {
    doc = await Migration.findOne();
  } catch (err) {
    return fn(err);
  }
  if (type) {
    try {
      var obj =
        doc && doc.migration ? doc.migration : { pos: 0, migrations: [] };
      fn(null, obj);
    } catch (err) {
      fn(err);
    }
  } else {
    let err;
    try {
      if (!doc) {
        var m = new Migration({ migration: self });
        await m.save();
      } else {
        doc.migration = self;
        await doc.save();
      }
    } catch (e) {
      err = e;
    }
    self.emit('save');
    fn && fn(err);
  }
};

/**
 * Run down migrations and call `fn(err)`.
 *
 * @param {Function} fn
 * @api public
 */

Set.prototype.down = function (fn, migrationName) {
  this.migrate('down', fn, migrationName);
};

/**
 * Run up migrations and call `fn(err)`.
 *
 * @param {Function} fn
 * @api public
 */

Set.prototype.up = function (fn, migrationName) {
  this.migrate('up', fn, migrationName);
};

/**
 * Migrate in the given `direction`, calling `fn(err)`.
 *
 * @param {String} direction
 * @param {Function} fn
 * @api public
 */

Set.prototype.migrate = function (direction, fn, migrationName) {
  var self = this;
  const migrateFn = function () {
    fn = fn || function () {};
    self.load(function (err, obj) {
      if (err) {
        if ('ENOENT' != err.code) return fn(err);
      } else {
        self.pos = obj.pos;
      }
      self._migrate(direction, fn, migrationName);
    });
  };
  if (mongoose.connection.readyState !== 1) { // connected
    mongoose.connection.once('open', migrateFn);
  } else {
    migrateFn();
  }
};

/**
 * Get index of given migration in list of migrations
 *
 * @api private
 */

function positionOfMigration(migrations, filename) {
  for (var i = 0; i < migrations.length; ++i) {
    if (migrations[i].title == filename) return i;
  }
  return -1;
}

/**
 * Perform migration.
 *
 * @api private
 */

Set.prototype._migrate = function (direction, fn, migrationName) {
  var self = this,
    migrations,
    migrationPos;

  if (!migrationName) {
    migrationPos = direction == 'up' ? this.migrations.length : 0;
  } else if (
    (migrationPos = positionOfMigration(this.migrations, migrationName)) == -1
  ) {
    console.error('Could not find migration: ' + migrationName);
    process.exit(1);
  }

  switch (direction) {
    case 'up':
      migrations = this.migrations.slice(this.pos, migrationPos + 1);
      this.pos += migrations.length;
      break;
    case 'down':
      migrations = this.migrations.slice(migrationPos, this.pos).reverse();
      this.pos -= migrations.length;
      break;
  }

  function next(err, migration) {
    // error from previous migration
    if (err) {
      console.error(err.toString());
      process.exit(1);
    }

    // done
    if (!migration) {
      self.emit('complete');
      self.save(fn);
      return;
    }

    self.emit('migration', migration, direction);
    if (self.force) {
      next(null, migrations.shift());
    } else {
      migration[direction](function (err) {
        next(err, migrations.shift());
      });
    }
  }

  next(null, migrations.shift());
};
