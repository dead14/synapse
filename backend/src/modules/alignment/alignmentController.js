const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { randomUUID } = require('crypto');
const socketConfig = require('../../socket');
const pool = require('../../config/db');
const {
    findOwnedSession,
    findLatestOwnedSession,
    listOwnedSessions,
    createOwnedSession,
    updateOwnedSessionConfig,
    markOwnedSessionCompleted,
    markOwnedSessionFailed,
    deleteOwnedSession,
} = require('./alignmentRepository');
const {
    normalizeComparisonResult,
    summarizeComparison,
    validateDtwPayload,
} = require('./alignmentContract');
const { OwnedJobStore } = require('./ownedJobStore');

// Local execution remains intentionally bounded and owner-scoped. A shared
// queue can replace this store later without changing the public job contract.
const localJobs = new OwnedJobStore({
    ttlMs: Number(process.env.JOB_RESULT_TTL_MS) || 60 * 60 * 1000,
});
const resultsCache = new Map(); // sessionId -> cached result

const MAX_EXPORT_ROWS = Number(process.env.MAX_EXPORT_ROWS) || 100_000;

function parsePositiveId(value) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function emitToUser(io, userId, event, payload) {
    if (io && userId != null) io.to(`user_${userId}`).emit(event, payload);
}

exports.uploadCsv = (req, res) => {
    const { pipelineName, surveyYear, vendor } = req.body;
    const file = req.file;
    if (!file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    try {
        const prefix = fs.readFileSync(file.path).subarray(0, 512);
        const extension = path.extname(file.originalname || '').toLowerCase();
        const isZipWorkbook = prefix.length >= 2 && prefix[0] === 0x50 && prefix[1] === 0x4B;
        const looksBinaryCsv = extension === '.csv' && prefix.includes(0);
        if ((extension === '.xlsx' && !isZipWorkbook) || looksBinaryCsv) {
            fs.unlink(file.path, () => {});
            return res.status(415).json({ error: 'Uploaded file content does not match its extension' });
        }
    } catch (error) {
        fs.unlink(file.path, () => {});
        return res.status(400).json({ error: 'Uploaded file could not be inspected' });
    }

    const normalizedPipelineName = String(pipelineName || '').trim();
    const normalizedVendor = String(vendor || '').trim();
    const normalizedYear = Number(surveyYear);
    if (!normalizedPipelineName || normalizedPipelineName.length > 120) {
        fs.unlink(file.path, () => {});
        return res.status(400).json({ error: 'Pipeline name is required and must be at most 120 characters' });
    }
    if (!normalizedVendor || normalizedVendor.length > 120) {
        fs.unlink(file.path, () => {});
        return res.status(400).json({ error: 'Vendor is required and must be at most 120 characters' });
    }
    if (!Number.isInteger(normalizedYear) || normalizedYear < 1900 || normalizedYear > 2100) {
        fs.unlink(file.path, () => {});
        return res.status(400).json({ error: 'Survey year is invalid' });
    }

    const io = socketConfig.getIO();
    const userId = req.user?.id;

    if (io && userId) {
        io.to(`user_${userId}`).emit('upload_progress', { progress: 10, message: 'File received, starting ingestion...' });
    }

    let settled = false;
    const respondOnce = (status, body) => {
        if (settled || res.headersSent) return;
        settled = true;
        res.status(status).json(body);
    };

    const pythonProcess = spawn('python', [
        'src/python_engines/db_ingest.py',
        '--file', file.path,
        '--pipeline', normalizedPipelineName,
        '--year', normalizedYear.toString(),
        '--vendor', normalizedVendor,
        '--organization-id', req.user.orgId.toString(),
        '--user-id', req.user.id.toString(),
    ], { cwd: path.join(__dirname, '../../..') });
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
        fs.unlink(file.path, () => {});
        if (code === 0) {
            try {
                const markedResult = output.match(/JSON_OUTPUT:(\{[^\r\n]+\})/);
                const result = JSON.parse(markedResult ? markedResult[1] : output.trim());
                if (result.status === 'success') {
                    if (io && userId) {
                        io.to(`user_${userId}`).emit('upload_progress', { progress: 100, message: 'Ingestion complete!', pipeline_run_id: result.run_id });
                    }
                    respondOnce(200, { message: 'Ingestion successful', pipeline_run_id: result.run_id });
                } else {
                    respondOnce(500, { error: 'Ingestion failed' });
                }
            } catch (err) {
                console.error('Failed to parse ingestion output:', err);
                respondOnce(500, { error: 'Failed to process ingestion result' });
            }
        } else {
            respondOnce(500, { error: 'Ingestion process failed' });
        }
    });

    pythonProcess.on('error', (err) => {
        fs.unlink(file.path, () => {});
        console.error('Failed to start ingestion process:', err);
        respondOnce(500, { error: 'Failed to start ingestion process' });
    });
};

exports.runAlignment = async (req, res) => {
    const { algorithm } = req.body;
    const runId = parsePositiveId(req.body.runId);
    if (!runId) {
        return res.status(400).json({ error: 'runId is required' });
    }

    const ownedSession = await findOwnedSession(pool, runId, req.user.orgId);
    if (!ownedSession) {
        return res.status(404).json({ error: 'Session not found' });
    }
    
    const algoArg = algorithm || 'dtw_hungarian';
    console.log(`Starting alignment for run ${runId} using ${algoArg}...`);
    
    // Fallback: Run directly without BullMQ to avoid Redis requirement
    const jobId = `job_${Date.now()}`;
    const io = socketConfig.getIO();

    // Keep a queryable status from the moment the job is accepted.  The
    // frontend polls this as a fallback when Socket.IO is disconnected.
    localJobs.create(jobId, { userId: req.user.id, orgId: req.user.orgId });
    
    const emitProgress = (progress, message) => {
        localJobs.update(jobId, { state: 'active', progress });
        emitToUser(io, req.user.id, 'alignment_progress', { jobId, progress, message });
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

            pythonProcess.on('close', async (code) => {
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
                        localJobs.update(jobId, {
                            state: 'completed',
                            progress: 100,
                            returnvalue: result
                        });
                        await markOwnedSessionCompleted(
                            pool,
                            runId,
                            req.user.orgId,
                            result,
                        );
                        emitToUser(io, req.user.id, 'alignment_complete', { jobId, result });
                    } catch (err) {
                        console.error('Failed to parse python engine output:', err);
                        localJobs.update(jobId, { state: 'failed', failedReason: 'Failed to parse engine output' });
                        await markOwnedSessionFailed(pool, runId, req.user.orgId, 'Failed to parse engine output');
                        emitToUser(io, req.user.id, 'alignment_error', { jobId, error: 'Failed to parse engine output' });
                    }
                } else {
                    console.error(`Python engine failed with code ${code}. Details: ${errorOutput}`);
                    localJobs.update(jobId, { state: 'failed', failedReason: `Engine failed with code ${code}` });
                    await markOwnedSessionFailed(pool, runId, req.user.orgId, 'Alignment engine failed');
                    emitToUser(io, req.user.id, 'alignment_error', { jobId, error: 'Alignment engine failed' });
                }
            });
        } catch (err) {
            console.error("Execution error:", err);
            localJobs.update(jobId, { state: 'failed', failedReason: 'Alignment execution failed' });
            await markOwnedSessionFailed(pool, runId, req.user.orgId, 'Alignment execution failed');
            emitToUser(io, req.user.id, 'alignment_error', { jobId, error: 'Alignment execution failed' });
        }
    }, 100);
};

exports.getAlignmentResults = async (req, res) => {
    const runId = parsePositiveId(req.params.runId);
    if (!runId) return res.status(400).json({ error: 'Invalid session ID' });
    try {
        const result = await pool.query(
            `SELECT r.*
             FROM alignment_results r
             JOIN alignment_sessions s ON s.id = r.session_id
             LEFT JOIN pipelines p ON p.id = s.pipeline_id
             WHERE r.session_id = $1
               AND COALESCE(s.organization_id, p.organization_id) = $2
             ORDER BY r.id`,
            [runId, req.user.orgId]
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
let dtwRestartTimer = null;
let tieInPythonProcess = null;
let tieInPendingRequests = new Map();
let tieInRequestCounter = 0;
let tieInRestartTimer = null;
let workersShuttingDown = false;
const pythonExecutable = process.env.PYTHON_EXECUTABLE || 'python';

function scheduleWorkerRestart(startWorker, getTimer, setTimer) {
    if (workersShuttingDown || getTimer()) return;
    setTimer(setTimeout(() => {
        setTimer(null);
        if (!workersShuttingDown) startWorker();
    }, 1000));
}

function stopPythonWorkers() {
    workersShuttingDown = true;
    if (dtwRestartTimer) clearTimeout(dtwRestartTimer);
    if (tieInRestartTimer) clearTimeout(tieInRestartTimer);
    dtwPythonProcess?.kill();
    tieInPythonProcess?.kill();
}

process.once('exit', stopPythonWorkers);

function startDtwPythonWorker() {
    console.log("Starting persistent DTW Python worker...");
    if (workersShuttingDown) return;
    dtwPythonProcess = spawn(pythonExecutable, ['src/python_engines/dtw_engine.py'], { cwd: path.join(__dirname, '../../..') });
    
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
        console.error(`DTW Python worker exited (code ${code}).`);
        for (const { reject } of dtwPendingRequests.values()) {
            reject(new Error('Python worker crashed'));
        }
        dtwPendingRequests.clear();
        dtwPythonProcess = null;
        scheduleWorkerRestart(
            startDtwPythonWorker,
            () => dtwRestartTimer,
            (timer) => { dtwRestartTimer = timer; },
        );
    });
}

// Start the worker once when the module loads
startDtwPythonWorker();


exports.runDtwAlignment = async (req, res) => {
    const payload = { ...req.body };
    try {
        validateDtwPayload(payload);
    } catch (err) {
        return res.status(err.code === 'DTW_INPUT_TOO_LARGE' ? 413 : 400).json({
            error: err.message,
            code: err.code || 'INVALID_ALIGNMENT_PAYLOAD',
        });
    }
    // require('fs').writeFileSync('debug_payload.json', JSON.stringify(payload));
    
    const requestId = ++dtwRequestCounter;
    payload.requestId = requestId;
    
    try {
        const result = await new Promise((resolve, reject) => {
            if (!dtwPythonProcess || dtwPythonProcess.killed || !dtwPythonProcess.stdin?.writable) {
                reject(new Error('DTW worker is not available. Check the Python runtime and backend logs.'));
                return;
            }
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

function startTieInPythonWorker() {
    console.log("Starting persistent TieIn Python worker...");
    if (workersShuttingDown) return;
    tieInPythonProcess = spawn(pythonExecutable, ['src/python_engines/tiein_engine.py'], { cwd: path.join(__dirname, '../../..') });
    
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
        console.error(`TieIn Python worker exited (code ${code}).`);
        for (const { reject } of tieInPendingRequests.values()) {
            reject(new Error('TieIn Python worker crashed'));
        }
        tieInPendingRequests.clear();
        tieInPythonProcess = null;
        scheduleWorkerRestart(
            startTieInPythonWorker,
            () => tieInRestartTimer,
            (timer) => { tieInRestartTimer = timer; },
        );
    });
}

// Start the worker once when the module loads
startTieInPythonWorker();

exports.estimateTieInOffset = async (req, res) => {
    const payload = { ...req.body };
    try {
        validateDtwPayload(payload);
    } catch (err) {
        return res.status(err.code === 'DTW_INPUT_TOO_LARGE' ? 413 : 400).json({
            error: err.message,
            code: err.code || 'INVALID_ALIGNMENT_PAYLOAD',
        });
    }
    const requestId = ++tieInRequestCounter;
    payload.requestId = requestId;
    
    try {
        const result = await new Promise((resolve, reject) => {
            if (!tieInPythonProcess || tieInPythonProcess.killed || !tieInPythonProcess.stdin?.writable) {
                reject(new Error('Tie-in worker is not available. Check the Python runtime and backend logs.'));
                return;
            }
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
    const { config, sessionId } = req.body || {};
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
        return res.status(400).json({ error: 'Config object is required' });
    }
    try {
        if (sessionId) {
            const parsedSessionId = parsePositiveId(sessionId);
            if (!parsedSessionId) return res.status(400).json({ error: 'Invalid session ID' });
            const updated = await updateOwnedSessionConfig(
                pool,
                parsedSessionId,
                req.user.orgId,
                config,
            );
            if (!updated) return res.status(404).json({ error: 'Session not found' });
            res.json({ success: true, sessionId: parsedSessionId });
        } else {
            const created = await createOwnedSession(pool, config, req.user);
            if (!created) {
                return res.status(400).json({ error: 'Pipeline does not belong to your organization' });
            }
            res.status(201).json({ success: true, sessionId: created.id });
        }
    } catch (err) {
        console.error("Save state error:", err);
        res.status(500).json({ error: 'Failed to save state' });
    }
};

exports.getWizardSession = async (req, res) => {
    const id = parsePositiveId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid session ID' });
    try {
        const session = await findOwnedSession(pool, id, req.user.orgId);
        if (session) {
            res.json({ config: session.params_json, sessionId: session.id, status: session.status });
        } else {
            res.status(404).json({ error: 'Session not found' });
        }
    } catch (err) {
        console.error("Get session error:", err);
        res.status(500).json({ error: 'Failed to fetch session' });
    }
};

exports.saveSections = async (req, res) => {
    const { sessionId, sections } = req.body;
    try {
        const parsedSessionId = parsePositiveId(sessionId);
        if (!parsedSessionId) return res.status(400).json({ error: 'Session ID required' });
        if (!Array.isArray(sections) || sections.length > 5_000) {
            return res.status(400).json({ error: 'Sections must be an array with at most 5000 items' });
        }
        const session = await findOwnedSession(pool, parsedSessionId, req.user.orgId);
        if (!session) return res.status(404).json({ error: 'Session not found' });

        const config = { ...(session.params_json || {}), sections };
        const updated = await updateOwnedSessionConfig(
            pool,
            parsedSessionId,
            req.user.orgId,
            config,
        );
        if (!updated) return res.status(404).json({ error: 'Session not found' });
        res.json({ success: true });
    } catch (err) {
        console.error("Save sections error:", err);
        res.status(500).json({ error: 'Failed to save sections' });
    }
};

exports.getPipelineRuns = async (req, res) => {
    try {
        const sessions = await listOwnedSessions(pool, req.user.orgId);

        const runs = sessions.map(row => {
            const params = row.params_json || {};
            const summaryData = params.summaryData || {};
            const resultSummary = params.resultSummary || {};
            const pipelineName = summaryData.sessionName
                || summaryData.pipelineName
                || row.stored_pipeline_name
                || `Run ${row.id}`;
            const vendorOld = summaryData.oldRun?.name || 'Old';
            const vendorNew = summaryData.newRun?.name || 'New';
            
            return {
                id: row.id.toString(),
                pipelineName: pipelineName,
                date: row.started_at,
                status: row.status,
                matchRate: Number.isFinite(Number(resultSummary.matchRate))
                    ? Number(resultSummary.matchRate)
                    : null,
                anomaliesFound: Number(resultSummary.anomaliesFound) || 0,
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
    try {
        const session = await findLatestOwnedSession(
            pool,
            req.user.orgId,
            { status: 'in_progress' },
        );

        if (session) {
            res.json({ success: true, sessionId: session.id, config: session.params_json });
        } else {
            res.json({ success: false, message: 'No session to resume' });
        }
    } catch (err) {
        console.error("Resume state error:", err);
        res.status(500).json({ error: 'Failed to resume state' });
    }
};

exports.getIliResults = async (req, res) => {
    try {
        const requestedSessionId = req.query.sessionId
            ? parsePositiveId(req.query.sessionId)
            : null;
        if (req.query.sessionId && !requestedSessionId) {
            return res.status(400).json({ error: 'Invalid session ID' });
        }

        const session = requestedSessionId
            ? await findOwnedSession(pool, requestedSessionId, req.user.orgId)
            : await findLatestOwnedSession(pool, req.user.orgId, { requireData: true });

        if (!session && requestedSessionId) {
            return res.status(404).json({ error: 'Session not found' });
        }
        if (!session) {
            return res.json({ comparison: [] });
        }

        const resolvedSessionId = session.id;

        // Check cache first
        if (resultsCache.has(resolvedSessionId)) {
            console.log("Returning cached results for session:", resolvedSessionId);
            const jobId = `job_hungarian_cached_${Date.now()}`;
            const cachedResult = resultsCache.get(resolvedSessionId);
            localJobs.create(jobId, { userId: req.user.id, orgId: req.user.orgId }, {
                state: 'completed',
                progress: 100,
                returnvalue: cachedResult,
            });
            return res.json({ jobId });
        }

        try {
            console.log("Starting run-hungarian job for session:", resolvedSessionId);
            const jobId = `job_hungarian_${Date.now()}`;

            localJobs.create(jobId, { userId: req.user.id, orgId: req.user.orgId }, {
                state: 'active',
                progress: 10,
                returnvalue: null,
            });

            // Run asynchronously
            setTimeout(() => {
                const pythonProcess = spawn('python', ['src/python_engines/hungarian_engine.py', resolvedSessionId.toString()], { cwd: path.join(__dirname, '../../..') });
                let output = '';
                let errorOutput = '';

                localJobs.update(jobId, { progress: 30 });

                pythonProcess.stdout.on('data', (data) => {
                    output += data.toString();
                });

                pythonProcess.stderr.on('data', (data) => {
                    errorOutput += data.toString();
                    console.error(`[hungarian_engine.py] Error: ${data}`);
                });

                pythonProcess.on('close', async (code) => {
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
                            
                            const normalized = normalizeComparisonResult(resultData);
                            const resultPayload = {
                                comparison: normalized.comparison,
                                groups: normalized.groups,
                                sessionId: resolvedSessionId,
                            };
                            resultsCache.set(resolvedSessionId, resultPayload);

                            localJobs.update(jobId, {
                                state: 'completed',
                                progress: 100,
                                returnvalue: resultPayload,
                            });
                            await markOwnedSessionCompleted(
                                pool,
                                resolvedSessionId,
                                req.user.orgId,
                                summarizeComparison(normalized.comparison),
                            );
                            emitToUser(socketConfig.getIO(), req.user.id, 'alignment_complete', {
                                jobId,
                                result: resultPayload,
                            });
                        } catch (err) {
                            console.error('Failed to normalize Hungarian output:', err);
                            localJobs.update(jobId, { state: 'failed', failedReason: 'Failed to parse alignment result' });
                            await markOwnedSessionFailed(pool, resolvedSessionId, req.user.orgId, 'Failed to parse alignment result');
                        }
                    } else {
                        console.error(`Hungarian engine failed with code ${code}: ${errorOutput}`);
                        localJobs.update(jobId, { state: 'failed', failedReason: 'Hungarian engine failed' });
                        await markOwnedSessionFailed(pool, resolvedSessionId, req.user.orgId, 'Hungarian engine failed');
                    }
                });
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
        const job = localJobs.getForPrincipal(jobId, req.user);
        if (!job) {
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

exports.deletePipelineRun = async (req, res) => {
    const sessionId = parsePositiveId(req.params.id);
    if (!sessionId) return res.status(400).json({ error: 'Invalid session ID' });

    try {
        const deleted = await deleteOwnedSession(pool, sessionId, req.user.orgId);
        if (!deleted) return res.status(404).json({ error: 'Session not found' });
        resultsCache.delete(sessionId);
        return res.status(204).send();
    } catch (err) {
        console.error('Delete pipeline run error:', err);
        return res.status(500).json({ error: 'Failed to delete pipeline run' });
    }
};

exports.exportExcel = async (req, res) => {
    try {
        const { data } = req.body;
        if (!data || !Array.isArray(data)) {
            return res.status(400).json({ error: 'Invalid data payload' });
        }
        if (data.length > MAX_EXPORT_ROWS) {
            return res.status(413).json({ error: `Export is limited to ${MAX_EXPORT_ROWS} rows` });
        }
        if (!data.every((row) => row && typeof row === 'object' && !Array.isArray(row))) {
            return res.status(400).json({ error: 'Each export row must be an object' });
        }
        
        // Write the data to a temporary file
        const uploadsDir = path.join(__dirname, '../../../../uploads');
        if (!fs.existsSync(uploadsDir)) {
            fs.mkdirSync(uploadsDir, { recursive: true });
        }
        
        const exportId = randomUUID();
        const tempInputFile = path.join(uploadsDir, `export_input_${exportId}.json`);
        const tempOutputFile = path.join(uploadsDir, `export_output_${exportId}.xlsx`);
        
        fs.writeFileSync(tempInputFile, JSON.stringify(data, null, 2));
        
        // Spawn Python process
        const pythonProcess = spawn('python', [
            path.join(__dirname, '../../python_engines/export_excel.py'),
            tempInputFile,
            tempOutputFile
        ]);
        
        let errorOutput = '';
        pythonProcess.stderr.on('data', (data) => {
            errorOutput += data.toString();
        });
        
        pythonProcess.on('close', (code) => {
            // Clean up input file
            if (fs.existsSync(tempInputFile)) {
                fs.unlinkSync(tempInputFile);
            }
            
            if (code === 0 && fs.existsSync(tempOutputFile)) {
                res.download(tempOutputFile, 'synapse_alignment_report.xlsx', () => {
                    // Clean up output file after download
                    if (fs.existsSync(tempOutputFile)) {
                        fs.unlinkSync(tempOutputFile);
                    }
                });
            } else {
                console.error("Excel export python failed with error: ", errorOutput);
                if (fs.existsSync(tempOutputFile)) {
                    fs.unlinkSync(tempOutputFile);
                }
                res.status(500).json({ error: 'Failed to generate Excel file' });
            }
        });
        
    } catch (err) {
        console.error("Failed to export Excel:", err);
        res.status(500).json({ error: 'Failed to export Excel' });
    }
};
