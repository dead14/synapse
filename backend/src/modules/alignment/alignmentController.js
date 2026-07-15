const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { alignmentQueue } = require('./alignmentWorker');
const socketConfig = require('../../socket');

// In-memory job store to bypass Redis/BullMQ
const localJobs = new Map();
const resultsCache = new Map(); // sessionId -> cached result

exports.uploadCsv = (req, res) => {
    const { pipelineName, surveyYear, vendor } = req.body;
    const file = req.file;
    if (!file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    const io = socketConfig.getIO();
    const userId = req.user?.id;

    if (io && userId) {
        io.to(`user_${userId}`).emit('upload_progress', { progress: 10, message: 'File received, starting ingestion...' });
    }

    const pythonProcess = spawn('python', ['src/python_engines/db_ingest.py', file.path, pipelineName, surveyYear, vendor, req.user.id.toString(), req.user.orgId.toString()], { cwd: path.join(__dirname, '../../..') });
    let output = '';

    pythonProcess.stdout.on('data', (data) => {
        output += data.toString();
        console.log(`Python: ${data}`);
        if (io && userId) {
            io.to(`user_${userId}`).emit('upload_progress', { progress: 50, message: 'Processing data...' });
        }
    });

    pythonProcess.stderr.on('data', (data) => {
        console.error(`Python Error: ${data}`);
    });

    pythonProcess.on('close', (code) => {
        if (code === 0) {
            try {
                const result = JSON.parse(output);
                if (result.success) {
                    if (io && userId) {
                        io.to(`user_${userId}`).emit('upload_progress', { progress: 100, message: 'Ingestion complete!', pipeline_run_id: result.pipeline_run_id });
                    }
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
    const { runId, algorithm, userId } = req.body;
    if (!runId) {
        return res.status(400).json({ error: 'runId is required' });
    }
    
    const algoArg = algorithm || 'dtw_hungarian';
    console.log(`Starting alignment for run ${runId} using ${algoArg}...`);
    
    // Fallback: Run directly without BullMQ to avoid Redis requirement
    const jobId = `job_${Date.now()}`;
    const room = userId ? `user_${userId}` : null;
    const io = socketConfig.getIO();

    // Keep a queryable status from the moment the job is accepted.  The
    // frontend polls this as a fallback when Socket.IO is disconnected.
    localJobs.set(jobId, {
        id: jobId,
        state: 'active',
        progress: 0,
        returnvalue: null,
    });
    
    const emitProgress = (progress, message) => {
        localJobs.set(jobId, {
            ...localJobs.get(jobId),
            id: jobId,
            state: 'active',
            progress,
        });
        if (io) {
            const payload = { jobId, progress, message };
            if (room) {
                io.to(room).emit('alignment_progress', payload);
            } else {
                io.emit('alignment_progress', payload);
            }
        }
    };

    // Send immediate response so UI can start listening
    res.json({ success: true, jobId: jobId, message: 'Alignment job started' });

    // Run asynchronously
    setTimeout(async () => {
        try {
            emitProgress(10, `Starting job run-alignment...`);
            emitProgress(20, 'Initializing pipeline data...');
            
            const pythonProcess = spawn('python', ['src/python_engines/alignment_engine.py', runId.toString(), algoArg], { cwd: path.join(__dirname, '../../..') });
            
            let output = '';
            let errorOutput = '';

            pythonProcess.stdout.on('data', (data) => {
                output += data.toString();
            });

            pythonProcess.stderr.on('data', (data) => {
                errorOutput += data.toString();
                console.error(`[alignment_engine.py] Error: ${data}`);
            });

            pythonProcess.on('close', (code) => {
                if (code === 0) {
                    try {
                        const firstBrace = output.indexOf('{');
                        const lastBrace = output.lastIndexOf('}');
                        let result = {};
                        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
                            const jsonStr = output.substring(firstBrace, lastBrace + 1);
                            result = JSON.parse(jsonStr);
                        }
                        emitProgress(90, 'Alignment complete, saving results...');
                        emitProgress(100, 'Job finished successfully!');
                        // Update localJobs map
                        localJobs.set(jobId, {
                            id: jobId,
                            state: 'completed',
                            progress: 100,
                            returnvalue: result
                        });
                        
                        if (io) {
                            const payload = { jobId, result };
                            if (room) io.to(room).emit('alignment_complete', payload);
                            else io.emit('alignment_complete', payload);
                        }
                    } catch (err) {
                        console.error('Failed to parse python engine output:', err);
                        localJobs.set(jobId, { id: jobId, state: 'failed', failedReason: 'Failed to parse engine output' });
                        if (io) {
                            const payload = { jobId, error: 'Failed to parse engine output' };
                            if (room) io.to(room).emit('alignment_error', payload);
                            else io.emit('alignment_error', payload);
                        }
                    }
                } else {
                    console.error(`Python engine failed with code ${code}. Details: ${errorOutput}`);
                    localJobs.set(jobId, { id: jobId, state: 'failed', failedReason: `Engine failed with code ${code}` });
                    if (io) {
                        const payload = { jobId, error: `Engine failed with code ${code}` };
                        if (room) io.to(room).emit('alignment_error', payload);
                        else io.emit('alignment_error', payload);
                    }
                }
            });
        } catch (err) {
            console.error("Execution error:", err);
            localJobs.set(jobId, { id: jobId, state: 'failed', failedReason: err.message });
            if (io) {
                const payload = { jobId, error: err.message };
                if (room) io.to(room).emit('alignment_error', payload);
                else io.emit('alignment_error', payload);
            }
        }
    }, 100);
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

// Persistent Python Worker for DTW
let dtwPythonProcess = null;
let dtwPendingRequests = new Map();
let dtwRequestCounter = 0;

function startDtwPythonWorker() {
    console.log("Starting persistent DTW Python worker...");
    dtwPythonProcess = spawn('python', ['src/python_engines/dtw_engine.py'], { cwd: path.join(__dirname, '../../..') });
    
    let buffer = '';
    dtwPythonProcess.stdout.on('data', (data) => {
        buffer += data.toString();
        let lines = buffer.split('\n');
        buffer = lines.pop(); // keep incomplete line
        
        for (const line of lines) {
            if (!line.trim()) continue;
            try {
                const result = JSON.parse(line);
                const { requestId } = result;
                if (dtwPendingRequests.has(requestId)) {
                    dtwPendingRequests.get(requestId).resolve(result);
                    dtwPendingRequests.delete(requestId);
                }
            } catch (e) {
                console.error('Parse error from DTW worker:', line);
            }
        }
    });
    
    dtwPythonProcess.stderr.on('data', (data) => {
        console.error('DTW Worker Stderr:', data.toString());
    });
    
    dtwPythonProcess.on('close', (code) => {
        console.error(`DTW Python worker exited (code ${code}), restarting...`);
        for (const { reject } of dtwPendingRequests.values()) {
            reject(new Error('Python worker crashed'));
        }
        dtwPendingRequests.clear();
        setTimeout(startDtwPythonWorker, 1000);
    });
}

// Start the worker once when the module loads
startDtwPythonWorker();


exports.runDtwAlignment = async (req, res) => {
    const payload = req.body;
    // require('fs').writeFileSync('debug_payload.json', JSON.stringify(payload));
    
    const requestId = ++dtwRequestCounter;
    payload.requestId = requestId;
    
    try {
        const result = await new Promise((resolve, reject) => {
            dtwPendingRequests.set(requestId, { resolve, reject });
            
            // Log payload length for debugging
            console.log(`[DTW] Request ${requestId}: oldRun=${payload.oldRun?.length}, newRun=${payload.newRun?.length}`);
            
            dtwPythonProcess.stdin.write(JSON.stringify(payload) + '\n');
            
            // 60 seconds timeout for full DTW
            setTimeout(() => {
                if (dtwPendingRequests.has(requestId)) {
                    dtwPendingRequests.delete(requestId);
                    console.error(`[DTW] Request ${requestId} timeout!`);
                    reject(new Error('Python worker timeout'));
                }
            }, 60000);
        });
        
        if (result.success) {
            res.json(result);
        } else {
            console.error(`[DTW] Request ${requestId} failed:`, result.error);
            res.status(500).json({ error: result.error, raw: result });
        }
    } catch (err) {
        console.error(`[DTW] Request ${requestId} exception:`, err);
        res.status(500).json({ error: err.message });
    }
};

// Persistent Python Worker for TieIn
let tieInPythonProcess = null;
let tieInPendingRequests = new Map();
let tieInRequestCounter = 0;

function startTieInPythonWorker() {
    console.log("Starting persistent TieIn Python worker...");
    tieInPythonProcess = spawn('python', ['src/python_engines/tiein_engine.py'], { cwd: path.join(__dirname, '../../..') });
    
    let buffer = '';
    tieInPythonProcess.stdout.on('data', (data) => {
        buffer += data.toString();
        let lines = buffer.split('\n');
        buffer = lines.pop();
        
        for (const line of lines) {
            if (!line.trim()) continue;
            try {
                const result = JSON.parse(line);
                const { requestId } = result;
                if (tieInPendingRequests.has(requestId)) {
                    tieInPendingRequests.get(requestId).resolve(result);
                    tieInPendingRequests.delete(requestId);
                }
            } catch (e) {
                console.error('Parse error from TieIn worker:', line);
            }
        }
    });
    
    tieInPythonProcess.stderr.on('data', (data) => {
        console.error('TieIn Worker Stderr:', data.toString());
    });
    
    tieInPythonProcess.on('close', (code) => {
        console.error(`TieIn Python worker exited (code ${code}), restarting...`);
        for (const { reject } of tieInPendingRequests.values()) {
            reject(new Error('TieIn Python worker crashed'));
        }
        tieInPendingRequests.clear();
        setTimeout(startTieInPythonWorker, 1000);
    });
}

// Start the worker once when the module loads
startTieInPythonWorker();

exports.estimateTieInOffset = async (req, res) => {
    const payload = req.body;
    const requestId = ++tieInRequestCounter;
    payload.requestId = requestId;
    
    try {
        const result = await new Promise((resolve, reject) => {
            tieInPendingRequests.set(requestId, { resolve, reject });
            tieInPythonProcess.stdin.write(JSON.stringify(payload) + '\n');
            
            setTimeout(() => {
                if (tieInPendingRequests.has(requestId)) {
                    tieInPendingRequests.delete(requestId);
                    reject(new Error('TieIn Python worker timeout'));
                }
            }, 30000);
        });
        
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
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
                `SELECT id, params_json FROM alignment_sessions WHERE id = $1`,
                [sessionId]
            );
        }
        
        // Fallback: if no sessionId or session not found, use latest with actual data
        if (!result || result.rows.length === 0) {
            result = await pool.query(
                `SELECT id, params_json FROM alignment_sessions
                 WHERE status = 'in_progress' AND params_json IS NOT NULL AND params_json::text != 'null'
                 ORDER BY started_at DESC LIMIT 1`
            );
        }
        
        if (result.rows.length === 0) {
            return res.json({ comparison: [] });
        }
        
        const resolvedSessionId = result.rows[0].id || sessionId;
        const config = result.rows[0].params_json;
        
        // Check cache first
        if (resultsCache.has(resolvedSessionId)) {
            console.log("Returning cached results for session:", resolvedSessionId);
            const jobId = `job_hungarian_cached_${Date.now()}`;
            localJobs.set(jobId, {
                id: jobId,
                state: 'completed',
                progress: 100,
                returnvalue: { comparison: resultsCache.get(resolvedSessionId) }
            });
            return res.json({ jobId });
        }
        
        try {
            console.log("Starting run-hungarian job for session:", resolvedSessionId);
            const jobId = `job_hungarian_${Date.now()}`;
            
            // Initialize job in local map
            localJobs.set(jobId, {
                id: jobId,
                state: 'active',
                progress: 10,
                returnvalue: null
            });

            // Run asynchronously
            setTimeout(() => {
                const pythonProcess = spawn('python', ['src/python_engines/hungarian_engine.py', resolvedSessionId.toString()], { cwd: path.join(__dirname, '../../..') });
                let output = '';
                let errorOutput = '';

                localJobs.set(jobId, { ...localJobs.get(jobId), progress: 30 });

                pythonProcess.stdout.on('data', (data) => {
                    output += data.toString();
                });

                pythonProcess.stderr.on('data', (data) => {
                    errorOutput += data.toString();
                    console.error(`[hungarian_engine.py] Error: ${data}`);
                });

                pythonProcess.on('close', (code) => {
                    if (code === 0) {
                        try {
                            let resultData = {};
                            const match = output.match(/___RESULT_JSON_BEGIN___([\s\S]*?)___RESULT_JSON_END___/);
                            if (match && match[1]) {
                                resultData = JSON.parse(match[1]);
                            } else {
                                // Fallback
                                const firstBracket = output.indexOf('{');
                                const lastBracket = output.lastIndexOf('}');
                                if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
                                    resultData = JSON.parse(output.substring(firstBracket, lastBracket + 1));
                                }
                            }
                            
                            resultsCache.set(resolvedSessionId, resultData);
                            
                            localJobs.set(jobId, {
                                id: jobId,
                                state: 'completed',
                                progress: 100,
                                returnvalue: { comparison: resultData }
                            });
                        } catch (err) {
                            localJobs.set(jobId, { id: jobId, state: 'failed', failedReason: 'Failed to parse JSON' });
                        }
                    } else {
                        localJobs.set(jobId, { id: jobId, state: 'failed', failedReason: `Code ${code}: ${errorOutput}` });
                    }
                });

                // Write config to stdin
                // pythonProcess.stdin.write(JSON.stringify(config));
                // pythonProcess.stdin.end();

            }, 100);

            res.json({ success: true, jobId: jobId, message: 'Hungarian alignment job started' });
        } catch (err) {
            console.error("Queue error:", err);
            res.status(500).json({ error: 'Failed to run Hungarian job' });
        }


    } catch (err) {
        console.error("Failed to get ILI results:", err);
        res.status(500).json({ error: 'Failed to get ILI results' });
    }
};

exports.getJobResult = async (req, res) => {
    const { jobId } = req.params;
    try {
        const job = localJobs.get(jobId);
        if (!job) {
            // Fallback to BullMQ if it was enqueued there (not likely locally, but safe)
            try {
                const bullJob = await alignmentQueue.getJob(jobId);
                if (bullJob) {
                    const state = await bullJob.getState();
                    return res.json({ 
                        jobId, 
                        state, 
                        progress: bullJob.progress, 
                        result: bullJob.returnvalue, 
                        failedReason: bullJob.failedReason 
                    });
                }
            } catch (e) {
                // Ignore bullmq error
            }
            return res.status(404).json({ error: 'Job not found' });
        }

        res.json({ 
            jobId, 
            state: job.state, 
            progress: job.progress, 
            result: job.returnvalue, 
            failedReason: job.failedReason 
        });
    } catch (err) {
        console.error("Get job result error:", err);
        res.status(500).json({ error: 'Failed to get job status' });
    }
};
