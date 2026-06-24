const { Pool } = require('pg');
const config = require('./env');

const pool = new Pool(config.db);

module.exports = pool;
