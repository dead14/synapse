const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/download-report', (req, res) => {
    const file = path.join(__dirname, '..', 'ILI_Comparison_Final.xlsx');
    res.download(file);
});

app.get('/api/ili-results', (req, res) => {
    const { exec } = require('child_process');
    const pythonExecutable = path.join(__dirname, 'venv', 'Scripts', 'python.exe');
    const scriptPath = path.join(__dirname, 'parse_excel.py');
    
    exec(`"${pythonExecutable}" "${scriptPath}"`, {maxBuffer: 1024 * 1024 * 50}, (error, stdout, stderr) => {
        if (error) {
            console.error("Error parsing excel:", error);
            return res.status(500).json({ error: error.message });
        }
        try {
            const data = JSON.parse(stdout);
            res.json(data);
        } catch(e) {
            console.error("JSON parse error:", e);
            res.status(500).json({ error: "Failed to parse python output" });
        }
    });
});


app.get('/stream-alignment', (req, res) => {
    // Set headers for Server-Sent Events (SSE)
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Spawn the Python process using our wrapper
    const pythonExecutable = path.join(__dirname, 'venv', 'Scripts', 'python.exe');
    const wrapperScript = path.join(__dirname, '..', 'algo_wrapper.py');
    
    console.log("Spawning python process:", pythonExecutable, wrapperScript);
    const py = spawn(pythonExecutable, [wrapperScript], {
        cwd: path.join(__dirname, '..')
    });

    // Feed the interactive inputs expected by Algoritma.py
    // INPUT DATA ILI LAMA (OLD)
    py.stdin.write('ILI_Data_2020.xlsx\n');
    py.stdin.write('2020\n');
    py.stdin.write('Vendor Lama\n');
    
    // INPUT DATA ILI BARU (NEW)
    py.stdin.write('ILI_Data_2025.xlsx\n');
    py.stdin.write('2025\n');
    py.stdin.write('Vendor Baru\n');
    
    // OUTPUT FILE NAME
    py.stdin.write('ILI_Comparison_Final.xlsx\n');
    py.stdin.end();

    // Listen to stdout from Python and send to React
    py.stdout.on('data', (data) => {
        const lines = data.toString().split('\n');
        lines.forEach(line => {
            if (line.trim().length > 0) {
                console.log(`[PYTHON] ${line}`);
                res.write(`data: ${JSON.stringify({ message: line })}\n\n`);
            }
        });
    });

    // Listen to stderr for errors
    py.stderr.on('data', (data) => {
        const errLine = data.toString();
        console.error(`[PYTHON ERROR] ${errLine}`);
        res.write(`data: ${JSON.stringify({ error: errLine })}\n\n`);
    });

    py.on('close', (code) => {
        console.log(`Python process exited with code ${code}`);
        res.write(`data: ${JSON.stringify({ status: 'done', code: code })}\n\n`);
        res.end();
    });

    req.on('close', () => {
        console.log('Client disconnected. Killing python process...');
        py.kill();
    });
});

const PORT = 8000;
app.listen(PORT, () => {
    console.log(`Node.js Express Server running on port ${PORT}`);
});
