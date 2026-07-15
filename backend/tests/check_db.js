const pool = require('./src/config/db');

async function check() {
  const res = await pool.query(
    `SELECT id, params_json FROM alignment_sessions ORDER BY id DESC LIMIT 5`
  );
  console.log('Sessions with gwMatches:');
  res.rows.forEach(r => {
      const parsed = typeof r.params_json === 'string' ? JSON.parse(r.params_json) : r.params_json;
      console.log(`Session ${r.id}: gwMatches count = ${parsed.gwMatches ? parsed.gwMatches.length : 0}`);
  });
  
  process.exit(0);
}
check();
