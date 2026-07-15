const pool = require('./src/config/db');
pool.query("SELECT params_json FROM alignment_sessions WHERE status = 'in_progress' ORDER BY started_at DESC LIMIT 1")
.then(res => {
    if(res.rows.length > 0) {
        const fs = require('fs');
        fs.writeFileSync('test_params.json', JSON.stringify(res.rows[0].params_json));
        const { spawn } = require('child_process');
        const p = spawn('python', ['hungarian_engine.py']);
        let out = ''; let err = '';
        p.stdout.on('data', d => out += d);
        p.stderr.on('data', d => err += d);
        p.on('close', code => {
            console.log('Code:', code);
            console.log('Stdout:', out.substring(0, 100));
            console.log('Stderr:', err);
            pool.end();
        });
        p.stdin.write(JSON.stringify(res.rows[0].params_json));
        p.stdin.end();
    } else { console.log('No session'); pool.end(); }
});
