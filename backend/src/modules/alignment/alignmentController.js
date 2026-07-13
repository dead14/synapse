const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { alignmentQueue } = require('./alignmentWorker');

exports.uploadCsv = (req, res) => {
    const { pipelineName, surveyYear, vendor } = req.body;
    const file = req.file;
    if (!file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    const pythonProcess = spawn('python', ['db_ingest.py', file.path, pipelineName, surveyYear, vendor, req.user.id.toString(), req.user.orgId.toString()]);
    let output = '';

    pythonProcess.stdout.on('data', (data) => {
        output += data.toString();
        console.log(`Python: ${data}`);
    });

    pythonProcess.stderr.on('data', (data) => {
        console.error(`Python Error: ${data}`);
    });

    pythonProcess.on('close', (code) => {
        if (code === 0) {
            try {
                const result = JSON.parse(output);
                if (result.success) {
                    res.json({ message: 'Ingestion successful', pipeline_run_id: result.pipeline_run_id });
                } else {
                    res.status(500).json({ error: result.error || 'Ingestion failed' });
                }
            } catch (err) {
                res.status(500).json({ error: 'Failed to parse ingestion output', raw: output });
            }
        } else {
            res.status(500).json({ error: `Python process exited with code ${code}` });
        }
    });
};

exports.runAlignment = async (req, res) => {
    const { runId, algorithm } = req.body;
    if (!runId) {
        return res.status(400).json({ error: 'runId is required' });
    }
    
    const algoArg = algorithm || 'dtw_hungarian';
    console.log(`Starting alignment for run ${runId} using ${algoArg}...`);
    
    try {
        const job = await alignmentQueue.add('run-alignment', { runId, algorithm: algoArg });
        res.json({ success: true, jobId: job.id, message: 'Alignment job added to queue' });
    } catch (err) {
        console.error("Queue error:", err);
        res.status(500).json({ error: 'Failed to enqueue alignment job' });
    }
};

exports.getAlignmentResults = async (req, res) => {
    const { runId } = req.params;
    const pool = require('../../config/db'); // lazy load to avoid circular issues
    try {
        const result = await pool.query(
            `SELECT id, master_feature_id, candidate_feature_id, confidence_score, status 
             FROM alignment_results 
             WHERE pipeline_run_id = $1`,
            [runId]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch alignment results' });
    }
};

exports.runDtwAlignment = (req, res) => {
    const payload = req.body;
    
    // DTW is lightweight and called repeatedly by the GW Simulator slider,
    // so it runs synchronously (no queue). Only Hungarian uses the Redis queue.
    const inputData = JSON.stringify(payload);
    
    const pythonProcess = spawn('python', ['dtw_engine.py']);
    let output = '';
    let errorOutput = '';

    pythonProcess.stdout.on('data', (data) => {
        output += data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
        errorOutput += data.toString();
        console.error(`DTW Engine Error: ${data}`);
    });

    pythonProcess.on('close', (code) => {
        if (code === 0) {
            try {
                const firstBrace = output.indexOf('{');
                const lastBrace = output.lastIndexOf('}');
                if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
                    const jsonStr = output.substring(firstBrace, lastBrace + 1);
                    const result = JSON.parse(jsonStr);
                    res.json(result);
                } else {
                    res.status(500).json({ error: 'No JSON result found from DTW engine', raw: output });
                }
            } catch (err) {
                res.status(500).json({ error: 'Failed to parse DTW engine output', raw: output });
            }
        } else {
            res.status(500).json({ error: `DTW engine failed with code ${code}`, details: errorOutput });
        }
    });

    // Write data to stdin and close it
    pythonProcess.stdin.write(inputData);
    pythonProcess.stdin.end();
};

exports.estimateTieInOffset = (req, res) => {
    const payload = req.body;
    const inputData = JSON.stringify(payload);
    
    const pythonProcess = spawn('python', ['tiein_engine.py'], { cwd: path.join(__dirname, '../../..') });
    let output = '';
    let errorOutput = '';

    pythonProcess.stdout.on('data', (data) => {
        output += data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
        errorOutput += data.toString();
        console.error(`TieIn Engine Error: ${data}`);
    });

    pythonProcess.on('close', (code) => {
        if (code === 0) {
            try {
                const firstBrace = output.indexOf('{');
                const lastBrace = output.lastIndexOf('}');
                if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
                    const jsonStr = output.substring(firstBrace, lastBrace + 1);
                    const result = JSON.parse(jsonStr);
                    res.json(result);
                } else {
                    res.status(500).json({ error: 'No JSON result found from TieIn engine', raw: output });
                }
            } catch (err) {
                res.status(500).json({ error: 'Failed to parse TieIn engine output', raw: output });
            }
        } else {
            res.status(500).json({ error: `TieIn engine failed with code ${code}`, details: errorOutput });
        }
    });

    pythonProcess.stdin.write(inputData);
    pythonProcess.stdin.end();
};

exports.saveWizardState = async (req, res) => {
    const pool = require('../../config/db');
    const { config, sessionId } = req.body;
    try {
        if (sessionId) {
            await pool.query(
                `UPDATE alignment_sessions SET params_json = $1 WHERE id = $2`,
                [JSON.stringify(config), sessionId]
            );
            res.json({ success: true, sessionId: sessionId });
        } else {
            const result = await pool.query(
                `INSERT INTO alignment_sessions (started_at, status, params_json)
                 VALUES (NOW(), 'in_progress', $1) RETURNING id`,
                [JSON.stringify(config)]
            );
            res.json({ success: true, sessionId: result.rows[0].id });
        }
    } catch (err) {
        console.error("Save state error:", err);
        res.status(500).json({ error: 'Failed to save state' });
    }
};

exports.getWizardSession = async (req, res) => {
    const pool = require('../../config/db');
    const { id } = req.params;
    try {
        const result = await pool.query(
            `SELECT params_json FROM alignment_sessions WHERE id = $1`,
            [id]
        );
        if (result.rows.length > 0) {
            res.json({ config: result.rows[0].params_json });
        } else {
            res.status(404).json({ error: 'Session not found' });
        }
    } catch (err) {
        console.error("Get session error:", err);
        res.status(500).json({ error: 'Failed to fetch session' });
    }
};

exports.saveSections = async (req, res) => {
    const pool = require('../../config/db');
    const { sessionId, sections } = req.body;
    try {
        if (!sessionId) {
            return res.status(400).json({ error: 'Session ID required' });
        }
        const result = await pool.query(`SELECT params_json FROM alignment_sessions WHERE id = $1`, [sessionId]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Session not found' });
        
        let config = result.rows[0].params_json || {};
        config.sections = sections;
        
        await pool.query(
            `UPDATE alignment_sessions SET params_json = $1 WHERE id = $2`,
            [JSON.stringify(config), sessionId]
        );
        res.json({ success: true });
    } catch (err) {
        console.error("Save sections error:", err);
        res.status(500).json({ error: 'Failed to save sections' });
    }
};

exports.getPipelineRuns = async (req, res) => {
    const pool = require('../../config/db');
    try {
        const result = await pool.query(
            `SELECT id, started_at, status, params_json FROM alignment_sessions ORDER BY started_at DESC`
        );
        
        const runs = result.rows.map(row => {
            const params = row.params_json || {};
            // Try to find pipelineName and vendors
            const summaryData = params.summaryData || {};
            const pipelineName = summaryData.sessionName || summaryData.pipelineName || `Run ${row.id}`;
            const vendorOld = summaryData.oldRun?.name || 'Old';
            const vendorNew = summaryData.newRun?.name || 'New';
            
            return {
                id: row.id.toString(),
                pipelineName: pipelineName,
                date: row.started_at,
                status: row.status,
                matchRate: 'N/A', // Compute if available
                anomaliesFound: 0,
                vendorLama: vendorOld,
                vendorBaru: vendorNew
            };
        });
        
        res.json(runs);
    } catch (err) {
        console.error("Get pipeline runs error:", err);
        res.status(500).json({ error: 'Failed to fetch pipeline runs' });
    }
};


exports.resumeWizardState = async (req, res) => {
    const pool = require('../../config/db');
    try {
        const result = await pool.query(
            `SELECT params_json FROM alignment_sessions 
             WHERE status = 'in_progress' 
             ORDER BY started_at DESC LIMIT 1`
        );
        
        if (result.rows.length > 0) {
            res.json({ success: true, config: result.rows[0].params_json });
        } else {
            res.json({ success: false, message: 'No session to resume' });
        }
    } catch (err) {
        console.error("Resume state error:", err);
        res.status(500).json({ error: 'Failed to resume state' });
    }
};

exports.getIliResults = async (req, res) => {
    const pool = require('../../config/db');
    try {
        const sessionId = req.query.sessionId;
        let result;
        
        if (sessionId && sessionId !== '') {
            // Use the specific session requested by the frontend
            result = await pool.query(
                `SELECT params_json FROM alignment_sessions WHERE id = $1`,
                [sessionId]
            );
        }
        
        // Fallback: if no sessionId or session not found, use latest with actual data
        if (!result || result.rows.length === 0) {
            result = await pool.query(
                `SELECT params_json FROM alignment_sessions 
                 WHERE status = 'in_progress' AND params_json IS NOT NULL AND params_json::text != 'null'
                 ORDER BY started_at DESC LIMIT 1`
            );
        }
        
        if (result.rows.length === 0) {
            return res.json({ comparison: [] });
        }
        
        const config = result.rows[0].params_json;
        
        try {
            console.log("Enqueuing run-hungarian job for session:", sessionId);
            const job = await alignmentQueue.add('run-hungarian', config);
            res.json({ success: true, jobId: job.id, message: 'Hungarian alignment job added to queue' });
        } catch (err) {
            console.error("Queue error:", err);
            res.status(500).json({ error: 'Failed to enqueue Hungarian job' });
        }

    } catch (err) {
        console.error("Failed to get ILI results:", err);
        res.status(500).json({ error: 'Failed to get ILI results' });
    }
};

exports.getJobResult = async (req, res) => {
    const { jobId } = req.params;
    try {
        const job = await alignmentQueue.getJob(jobId);
        if (!job) {
            return res.status(404).json({ error: 'Job not found' });
        }
        const state = await job.getState();
        const progress = job.progress;
        const result = job.returnvalue;
        const failedReason = job.failedReason;

        res.json({ jobId, state, progress, result, failedReason });
    } catch (err) {
        console.error("Get job result error:", err);
        res.status(500).json({ error: 'Failed to get job status' });
    }
};
