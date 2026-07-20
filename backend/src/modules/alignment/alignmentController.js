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
    createAlignmentJob,
    getLatestAlignmentJob,
    getOwnedAlignmentJob,
    listOwnedAlignmentResultPage,
    serializeAlignmentJob,
} = require('./alignmentRepository');
const {
    normalizeComparisonResult,
    summarizeComparison,
    validateDtwPayload,
    validateMatchingSections,
    validateAlignmentReview,
    normalizeCanonicalGwLocks,
    normalizeAlignmentReviewForPersistence,
    normalizeInterventionEvent,
} = require('./alignmentContract');
const { buildRunEndpointRejection } = require('./alignmentStrategyCapabilities');
const { buildTieInEvidence, signTieInEvidence, verifyTieInEvidence } = require('./tieInEvidence');
const { OwnedJobStore } = require('./ownedJobStore');
const ingestionController = require('../ingestion/ingestionController');
const { alignmentQueue } = require('./alignmentWorker');
const {
    ALIGNMENT_ANCHOR_FEATURE_TYPE_SQL,
    canonicalAlignmentAnchorType,
} = require('./alignmentAnchorTypes');

// Local execution remains intentionally bounded and owner-scoped. A shared
// queue can replace this store later without changing the public job contract.
const localJobs = new OwnedJobStore({
    ttlMs: Number(process.env.JOB_RESULT_TTL_MS) || 60 * 60 * 1000,
});
const resultsCache = new Map(); // sessionId -> cached result
// Bump whenever result semantics change so a hot backend process cannot keep
// serving rows produced by an older Python engine implementation.
const ALIGNMENT_ENGINE_VERSION = '2026-07-16-physics-softcost-v4';

const MAX_EXPORT_ROWS = Number(process.env.MAX_EXPORT_ROWS) || 100_000;
const MAX_DTW_ANCHORS = Number(process.env.MAX_DTW_RECORDS) || 25_000;

function parsePositiveId(value) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseSessionRevision(value) {
    return typeof value === 'string' && /^\d{1,20}$/.test(value) ? value : null;
}

function reviewPersistenceError(message, code = 'INVALID_ALIGNMENT_REVIEW') {
    const error = new Error(message);
    error.code = code;
    return error;
}

function getPersistedRunReferences(config) {
    const oldRunId = parsePositiveId(config?.summaryData?.oldRun?.runId);
    const newRunId = parsePositiveId(config?.summaryData?.newRun?.runId);
    if (!oldRunId || !newRunId || oldRunId === newRunId) {
        throw reviewPersistenceError('The alignment session must reference two distinct persisted inspection runs');
    }
    return { oldRunId, newRunId };
}

async function countOwnedRunFeatures({ oldRunId, newRunId }, orgId) {
    const result = await pool.query(
        `SELECT f.run_id, COUNT(*)::integer AS feature_count
         FROM ili_features f
         JOIN survey_runs sr ON sr.id = f.run_id
         JOIN pipelines p ON p.id = sr.pipeline_id
         WHERE f.run_id = ANY($1::integer[])
           AND p.organization_id = $2
         GROUP BY f.run_id`,
        [[oldRunId, newRunId], orgId],
    );
    const counts = new Map(result.rows.map((row) => [Number(row.run_id), Number(row.feature_count)]));
    return {
        master: counts.get(newRunId) || 0,
        historical: counts.get(oldRunId) || 0,
    };
}

function hasReviewEvidence(config) {
    return config?.dataReview !== undefined || config?.gwReview !== undefined;
}

function canonicalSignature(payload, { oldRunId, newRunId }) {
    return JSON.stringify({
        oldRunId,
        newRunId,
        ota: Number(payload?.ota) || 0,
        strictPenalty: Boolean(payload?.strictPenalty),
        useValveAnchor: Boolean(payload?.useValveAnchor),
        applyDtwCorrection: Boolean(payload?.applyDtwCorrection),
        tieInOffset: Number(payload?.tieInOffset) || 0,
        tieInTransform: payload?.tieInTransform || null,
        tieInDecisionStatus: payload?.tieInDecision?.status || null,
        tieInEvidenceToken: payload?.tieInEvidenceToken || null,
        tieInMethodVersion: payload?.tieInMethodVersion || null,
        tieInExcludedRanges: payload?.excludedRanges || payload?.tieInExcludedRanges || [],
    });
}

function canonicalSignatureForConfig(config, references) {
    return canonicalSignature({
        ota: config?.ota,
        strictPenalty: config?.strictPenalty,
        useValveAnchor: config?.useValveAnchor,
        applyDtwCorrection: config?.dtwOn,
        tieInOffset: config?.globalOffset,
        tieInTransform: config?.tieInTransform,
        tieInDecision: config?.tieInDecision,
        tieInEvidenceToken: config?.tieInEvidenceToken,
        tieInMethodVersion: config?.tieInMethodVersion,
        tieInExcludedRanges: config?.tieInExcludedRanges,
    }, references);
}

function requireServerTieInEvidence(payload, organizationId) {
    if (payload?.tieInTransform === undefined || payload?.tieInTransform === null) return;
    const valid = verifyTieInEvidence(
        buildTieInEvidence(payload, organizationId),
        payload.tieInEvidenceToken,
    );
    if (!valid) {
        throw reviewPersistenceError(
            'Tie-in transform is not bound to server-estimated evidence. Recalculate Tie-In.',
            'INVALID_TIEIN_EVIDENCE',
        );
    }
}

function toCanonicalAnchor(row) {
    const canonicalType = canonicalAlignmentAnchorType(
        row.feature_type,
        row.feature_identification,
    );
    return {
        id: String(row.id),
        feature_id: row.feature_id || String(row.id),
        dist: Number(row.log_distance_m),
        log_distance_m: Number(row.log_distance_m),
        type: canonicalType || row.feature_type || row.feature_identification || 'other',
        originalType: row.feature_type || row.feature_identification || 'other',
        feature_type: row.feature_type || null,
        feature_identification: row.feature_identification || null,
        dist_to_us_gw_m: row.dist_to_us_gw_m === null ? null : Number(row.dist_to_us_gw_m),
        joint_length_m: row.joint_length_m === null ? null : Number(row.joint_length_m),
        clock: row.clock_position || null,
        clock_position: row.clock_position || null,
        depth: row.depth_pct === null ? null : Number(row.depth_pct),
        depth_pct: row.depth_pct === null ? null : Number(row.depth_pct),
        length: row.length_mm === null ? null : Number(row.length_mm),
        length_mm: row.length_mm === null ? null : Number(row.length_mm),
        width: row.width_mm === null ? null : Number(row.width_mm),
        width_mm: row.width_mm === null ? null : Number(row.width_mm),
    };
}

async function loadOwnedRunAnchors(runId, orgId) {
    const result = await pool.query(
        `SELECT f.id, f.feature_id, f.log_distance_m, f.feature_type,
                f.feature_identification, f.dist_to_us_gw_m, f.joint_length_m,
                f.clock_position, f.depth_pct, f.length_mm, f.width_mm
         FROM ili_features f
         JOIN survey_runs sr ON sr.id = f.run_id
         JOIN pipelines p ON p.id = sr.pipeline_id
         WHERE f.run_id = $1
           AND p.organization_id = $2
           AND (
               f.feature_type IN (${ALIGNMENT_ANCHOR_FEATURE_TYPE_SQL})
               OR (
                   COALESCE(f.feature_type, '') IN ('', 'Other')
                   AND COALESCE(f.feature_identification, '') ~* '(weld|girth|seam|valve|tee|offtake|branch|bend|elbow|launcher|receiver)'
               )
           )
         ORDER BY f.log_distance_m ASC, f.id ASC
         LIMIT $3`,
        [runId, orgId, MAX_DTW_ANCHORS + 1],
    );
    if (result.rows.length > MAX_DTW_ANCHORS) {
        const error = new Error(`Inspection run has more than ${MAX_DTW_ANCHORS.toLocaleString()} alignment anchors. Narrow the run or raise MAX_DTW_RECORDS for this deployment.`);
        error.code = 'DTW_INPUT_TOO_LARGE';
        throw error;
    }
    return result.rows.map(toCanonicalAnchor);
}

async function hydrateRunReferences(payload, orgId) {
    const oldRunId = parsePositiveId(payload?.oldRunId);
    const newRunId = parsePositiveId(payload?.newRunId);
    const referencesProvided = payload?.oldRunId !== undefined || payload?.newRunId !== undefined;
    if (!referencesProvided) return payload;
    if (!oldRunId || !newRunId) {
        const error = new Error('oldRunId and newRunId must both be valid inspection run ids');
        error.code = 'INVALID_ALIGNMENT_PAYLOAD';
        throw error;
    }

    const [oldRun, newRun] = await Promise.all([
        loadOwnedRunAnchors(oldRunId, orgId),
        loadOwnedRunAnchors(newRunId, orgId),
    ]);
    return { ...payload, oldRun, newRun };
}

function emitToUser(io, userId, event, payload) {
    if (io && userId != null) io.to(`user_${userId}`).emit(event, payload);
}

exports.uploadCsv = async (req, res) => {
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

    try {
        const intake = await ingestionController.enqueueIngestion({
            file,
            pipelineName: normalizedPipelineName,
            surveyYear: normalizedYear,
            vendor: normalizedVendor,
            user: req.user,
        });
        fs.unlink(file.path, () => {});
        if (intake.kind === 'existing') {
            const audit = intake.run.ingestion_audit && typeof intake.run.ingestion_audit === 'object'
                ? intake.run.ingestion_audit
                : {};
            const acceptedRows = Number(intake.run.row_count || 0);
            return res.status(200).json({
                message: 'Existing inspection run reused',
                pipeline_run_id: Number(intake.run.run_id),
                run_summary: audit.feature_counts || { total: acceptedRows },
                audit: { ...audit, accepted_rows: audit.accepted_rows ?? acceptedRows },
                source_sha256: intake.run.source_sha256 || null,
                reused: true,
            });
        }
        const job = intake.job;
        return res.status(202).json({
            message: 'Ingestion queued',
            jobId: job.job_id,
            state: job.state,
            progress: Number(job.progress || 0),
            sourceFile: job.source_file,
        });
    } catch (error) {
        fs.unlink(file.path, () => {});
        console.error('Failed to queue ingestion:', error);
        return res.status(503).json({
            error: 'Ingestion queue is unavailable',
            code: 'INGESTION_QUEUE_UNAVAILABLE',
        });
    }
};

exports.runAlignment = (req, res) => {
    const rejection = buildRunEndpointRejection(req.body?.algorithm);
    return res.status(422).json(rejection);
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

exports.getAlignmentResultsPage = async (req, res) => {
    const sessionId = parsePositiveId(req.params.runId);
    if (!sessionId) return res.status(400).json({ error: 'Invalid session ID' });
    const limit = req.query.limit === undefined ? 1000 : Number(req.query.limit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 5000) {
        return res.status(400).json({ error: 'limit must be an integer between 1 and 5000' });
    }
    let after = null;
    if (req.query.cursor !== undefined && req.query.cursor !== '') {
        after = Number(req.query.cursor);
        if (!Number.isSafeInteger(after) || after < 0) {
            return res.status(400).json({ error: 'cursor must be a non-negative result ordinal' });
        }
    }
    try {
        const page = await listOwnedAlignmentResultPage(pool, sessionId, req.user.orgId, { limit, after });
        return res.json({
            items: page.rows,
            nextCursor: page.nextCursor === null ? null : String(page.nextCursor),
        });
    } catch (error) {
        console.error('Paged alignment results error:', error);
        return res.status(500).json({ error: 'Failed to fetch paged alignment results' });
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
    let payload;
    let session = null;
    let persistedReferences = null;
    try {
        const sessionId = parsePositiveId(req.body?.sessionId);
        if (req.body?.sessionId !== undefined && !sessionId) {
            throw reviewPersistenceError('Invalid alignment session ID', 'INVALID_ALIGNMENT_PAYLOAD');
        }
        if (sessionId) {
            session = await findOwnedSession(pool, sessionId, req.user.orgId);
            if (!session) {
                throw reviewPersistenceError('Alignment session not found', 'ALIGNMENT_SESSION_NOT_FOUND');
            }
            persistedReferences = getPersistedRunReferences(session.params_json || {});
        }
        payload = await hydrateRunReferences({
            ...req.body,
            ...(persistedReferences || {}),
        }, req.user.orgId);
        requireServerTieInEvidence(payload, req.user.orgId);
        validateDtwPayload(payload);
    } catch (err) {
        const status = err.code === 'DTW_INPUT_TOO_LARGE' ? 413 : err.code === 'ALIGNMENT_SESSION_NOT_FOUND' ? 404 : 400;
        return res.status(status).json({
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
            if (session && persistedReferences) {
                const canonicalGwLocks = normalizeCanonicalGwLocks(result.gwMatchesFinal);
                const current = await findOwnedSession(pool, session.id, req.user.orgId);
                if (!current) return res.status(404).json({ error: 'Alignment session not found' });
                const currentReferences = getPersistedRunReferences(current.params_json || {});
                if (currentReferences.oldRunId !== persistedReferences.oldRunId
                    || currentReferences.newRunId !== persistedReferences.newRunId) {
                    return res.status(409).json({ error: 'Inspection runs changed while GW matching was running. Refresh and try again.' });
                }
                const signature = canonicalSignature(payload, persistedReferences);
                const config = { ...(current.params_json || {}), canonicalGwLocks, gwCanonicalSignature: signature };
                if (current.params_json?.gwCanonicalSignature !== signature) {
                    delete config.gwReview;
                    delete config.gwMatchesFinal;
                    delete config.matchingSections;
                }
                const updated = await updateOwnedSessionConfig(pool, session.id, req.user.orgId, config);
                if (!updated) return res.status(409).json({ error: 'GW matching result could not be saved. Refresh and try again.' });
                result.sessionRevision = updated.revision;
            }
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
    let payload;
    try {
        payload = await hydrateRunReferences({ ...req.body }, req.user.orgId);
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
        
        if (result.success && result.transform && result.decision) {
            result.evidenceToken = signTieInEvidence(buildTieInEvidence({
                ...payload,
                decision: result.decision,
                transform: result.transform,
            }, req.user.orgId, result.methodVersion));
        }
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.saveWizardState = async (req, res) => {
    const { config, sessionId, sessionRevision } = req.body || {};
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
        return res.status(400).json({ error: 'Config object is required' });
    }
    try {
        requireServerTieInEvidence(config, req.user.orgId);
    } catch (err) {
        return res.status(422).json({ error: err.message, code: err.code });
    }
    try {
        if (sessionId) {
            const parsedSessionId = parsePositiveId(sessionId);
            if (!parsedSessionId) return res.status(400).json({ error: 'Invalid session ID' });
            const session = await findOwnedSession(pool, parsedSessionId, req.user.orgId);
            if (!session) return res.status(404).json({ error: 'Session not found' });
            const requiresReviewBoundary = hasReviewEvidence(config);
            const expectedRevision = parseSessionRevision(sessionRevision);
            if (requiresReviewBoundary && !expectedRevision) {
                return res.status(409).json({ error: 'This review is out of date. Refresh the alignment session before saving.' });
            }
            let configToPersist = config;
            try {
                if (requiresReviewBoundary) {
                    const references = getPersistedRunReferences(session.params_json || {});
                    const featureCounts = await countOwnedRunFeatures(references, req.user.orgId);
                    if (config.gwReview !== undefined
                        && session.params_json?.gwCanonicalSignature !== canonicalSignatureForConfig(config, references)) {
                        throw reviewPersistenceError('GW matching settings changed. Recalculate the canonical matching result before saving review decisions.');
                    }
                    configToPersist = normalizeAlignmentReviewForPersistence(config, {
                        featureCounts,
                        canonicalGwLocks: session.params_json?.canonicalGwLocks,
                        existingDataReview: session.params_json?.dataReview,
                    });
                    if (Array.isArray(session.params_json?.canonicalGwLocks)) {
                        configToPersist.canonicalGwLocks = session.params_json.canonicalGwLocks;
                        configToPersist.gwCanonicalSignature = session.params_json.gwCanonicalSignature;
                        if (config.gwReview === undefined) {
                            configToPersist.gwMatchesFinal = session.params_json.gwMatchesFinal || [];
                        }
                    }
                } else {
                    validateAlignmentReview(config);
                }
                validateMatchingSections(configToPersist);
            } catch (err) {
                return res.status(422).json({
                    error: err.message,
                    code: err.code || 'INVALID_ALIGNMENT_CONFIG',
                });
            }
            const updated = await updateOwnedSessionConfig(
                pool,
                parsedSessionId,
                req.user.orgId,
                configToPersist,
                { expectedRevision: requiresReviewBoundary ? expectedRevision : null },
            );
            if (!updated) {
                return res.status(requiresReviewBoundary ? 409 : 404).json({
                    error: requiresReviewBoundary ? 'This review changed in another session. Refresh before saving.' : 'Session not found',
                });
            }
            // GW alignment and Hungarian tolerances are part of this config.
            // A saved change must force a fresh Hungarian run rather than
            // returning the previous comparison for the same session.
            resultsCache.delete(parsedSessionId);
            res.json({ success: true, sessionId: parsedSessionId, sessionRevision: updated.revision });
        } else {
            if (hasReviewEvidence(config)) {
                return res.status(422).json({ error: 'Review evidence requires an existing alignment session' });
            }
            try {
                validateMatchingSections(config);
                validateAlignmentReview(config);
            } catch (err) {
                return res.status(422).json({
                    error: err.message,
                    code: err.code || 'INVALID_ALIGNMENT_CONFIG',
                });
            }
            const created = await createOwnedSession(pool, config, req.user);
            if (!created) {
                return res.status(400).json({ error: 'Pipeline does not belong to your organization' });
            }
            res.status(201).json({ success: true, sessionId: created.id, sessionRevision: created.revision });
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
            res.json({ config: session.params_json, sessionId: session.id, status: session.status, sessionRevision: session.revision });
        } else {
            res.status(404).json({ error: 'Session not found' });
        }
    } catch (err) {
        console.error("Get session error:", err);
        res.status(500).json({ error: 'Failed to fetch session' });
    }
};

exports.saveSections = async (req, res) => {
    const { sessionId, sections, pipelineRoute } = req.body;
    try {
        const parsedSessionId = parsePositiveId(sessionId);
        if (!parsedSessionId) return res.status(400).json({ error: 'Session ID required' });
        if (!Array.isArray(sections) || sections.length > 5_000) {
            return res.status(400).json({ error: 'Sections must be an array with at most 5000 items' });
        }
        if (pipelineRoute !== undefined) {
            const routeIsValid = Array.isArray(pipelineRoute)
                && pipelineRoute.length <= 10_000
                && pipelineRoute.every((point) => Array.isArray(point)
                    && point.length === 2
                    && Number.isFinite(Number(point[0]))
                    && Number.isFinite(Number(point[1]))
                    && Number(point[0]) >= -90
                    && Number(point[0]) <= 90
                    && Number(point[1]) >= -180
                    && Number(point[1]) <= 180);
            if (!routeIsValid) {
                return res.status(400).json({ error: 'Pipeline route must contain valid [latitude, longitude] points' });
            }
        }
        const session = await findOwnedSession(pool, parsedSessionId, req.user.orgId);
        if (!session) return res.status(404).json({ error: 'Session not found' });

        const config = {
            ...(session.params_json || {}),
            sections,
            ...(pipelineRoute === undefined ? {} : { pipelineRoute }),
        };
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

exports.saveIntervention = async (req, res) => {
    const parsedSessionId = parsePositiveId(req.body?.sessionId);
    if (!parsedSessionId) return res.status(400).json({ error: 'Session ID required' });
    try {
        const event = normalizeInterventionEvent(req.body?.event);
        const session = await findOwnedSession(pool, parsedSessionId, req.user.orgId);
        if (!session) return res.status(404).json({ error: 'Session not found' });
        const existing = Array.isArray(session.params_json?.interventions)
            ? session.params_json.interventions
            : [];
        if (existing.length >= 10_000) {
            return res.status(400).json({ error: 'Intervention event limit reached' });
        }
        const interventions = existing.some((item) => item.id === event.id)
            ? existing
            : [...existing, event];
        const config = { ...(session.params_json || {}), interventions };
        const updated = await updateOwnedSessionConfig(pool, parsedSessionId, req.user.orgId, config);
        if (!updated) return res.status(404).json({ error: 'Session not found' });
        return res.status(201).json({ success: true, event, count: interventions.length });
    } catch (error) {
        if (error?.code === 'INVALID_INTERVENTION') {
            return res.status(400).json({ error: error.message, code: error.code });
        }
        console.error('Save intervention error:', error);
        return res.status(500).json({ error: 'Failed to save intervention' });
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
            res.json({ success: true, sessionId: session.id, sessionRevision: session.revision, config: session.params_json });
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

        const previousJob = await getLatestAlignmentJob(pool, resolvedSessionId, req.user.orgId);
        if (previousJob && ['queued', 'active', 'retrying', 'completed'].includes(previousJob.state)) {
            return res.status(previousJob.state === 'completed' ? 200 : 202).json({ jobId: previousJob.job_id });
        }

        const jobId = randomUUID();
        const configuredAlgorithm = session.params_json?.algorithm
            || session.params_json?.summaryData?.algorithm
            || 'dtw_hungarian';
        await createAlignmentJob(pool, {
            jobId,
            sessionId: resolvedSessionId,
            organizationId: req.user.orgId,
            userId: req.user.id,
        });
        await alignmentQueue.add('align-ili', {
            jobId,
            sessionId: resolvedSessionId,
            organizationId: req.user.orgId,
            userId: req.user.id,
            algorithm: configuredAlgorithm,
        }, { jobId });
        return res.status(202).json({ success: true, jobId, message: 'Alignment job queued' });


    } catch (err) {
        console.error("Failed to get ILI results:", err);
        res.status(500).json({ error: 'Failed to get ILI results' });
    }
};

exports.getJobResult = async (req, res) => {
    const { jobId } = req.params;
    try {
        const durableJob = await getOwnedAlignmentJob(pool, jobId, req.user.orgId);
        if (durableJob) return res.json(serializeAlignmentJob(durableJob));
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
