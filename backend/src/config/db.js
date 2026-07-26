const { Pool } = require('pg');
const { buildDatabaseConfig } = require('./databaseConfig');

const pool = new Pool(buildDatabaseConfig());

// pg emits 'error' on idle clients when Postgres restarts or a firewall drops
// the connection.  Without a listener Node treats it as an unhandled 'error'
// event and tears the process down.
pool.on('error', (err) => {
    console.error('Idle Postgres client error:', err.message);
});

module.exports = pool;
