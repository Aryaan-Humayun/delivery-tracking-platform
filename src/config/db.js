const { Pool } = require('pg');
const config = require('./env');

// In production, connectionString + ssl take over entirely instead of being
// merged with the local host/port/etc fields, so there's no ambiguity about
// which set of credentials is actually in effect.
const pool = new Pool(
  config.db.connectionString
    ? { connectionString: config.db.connectionString, ssl: config.db.ssl }
    : config.db
);

module.exports = pool;
