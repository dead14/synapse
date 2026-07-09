const pool = require('./src/config/db');
pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'alignment_sessions'")
.then(res => { console.log(res.rows); pool.end(); })
.catch(e => { console.error(e); pool.end(); });
