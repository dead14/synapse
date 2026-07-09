const pool = require('./src/config/db');
pool.query("SELECT * FROM alignment_sessions ORDER BY id DESC LIMIT 1").then(res => { 
    console.log(JSON.stringify(res.rows, null, 2)); 
    process.exit(0); 
});
