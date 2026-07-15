const { Pool } = require('pg');
const { buildDatabaseConfig } = require('./databaseConfig');

const pool = new Pool(buildDatabaseConfig());

module.exports = pool;
