const pool = require('../src/config/db');

async function run() {
    try {
        const res = await pool.query(`
            SELECT id, status, started_at, params_json FROM alignment_sessions
            ORDER BY id DESC LIMIT 10
        `);
        
        const data = res.rows.map(row => {
            const config = row.params_json || {};
            const gwMatches = config.gwMatches || [];
            return {
                id: row.id,
                status: row.status,
                started_at: row.started_at,
                gwMatchesCount: gwMatches.length
            };
        });
        
        console.table(data);
        process.exit(0);
        
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

run();
