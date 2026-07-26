const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const fsPromises = require('fs').promises;
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
    updateAlignmentJob,
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
    normalizePairGwResultsForPersistence,
} = require('./alignmentContract');
const {
    buildRunEndpointRejection,
    getAlignmentStrategyCapability,
    listAlignmentStrategyCapabilities,
} = require('./alignmentStrategyCapabilities');
const { buildTieInEvidence, signTieInEvidence, verifyTieInEvidence } = require('./tieInEvidence');
const { OwnedJobStore } = require('./ownedJobStore');
const ingestionController = require('../ingestion/ingestionController');
const { alignmentQueue } = require('./alignmentWorker');
const {
    ALIGNMENT_ANCHOR_FEATURE_TYPE_SQL,
    canonicalAlignmentAnchorType,
} = require('./alignmentAnchorTypes');
const {
    canonicalSignature,
    canonicalSignatureForConfig,
} = require('./alignmentSignature');
const {
    ALIGNMENT_ENGINE_VERSION,
    alignmentConfigFingerprint,
    buildReusableAlignmentJobResponse,
    isReusableAlignmentJob,
} = require('./alignmentExecution');
const {
    parseAlignmentResultPageQuery,
} = require('./alignmentResultPaging');
const {
    findSessionRunPair,
    primarySessionRunPair,
    runPairKey,
} = require('./runPairIdentity');

// Local execution remains intentionally bounded and owner-scoped. A shared
// queue can replace this store later without changing the public job contract.
const localJobs = new OwnedJobStore({
    ttlMs: Number(process.env.JOB_RESULT_TTL_MS) || 60 * 60 * 1000,
});
const DTW_WORKER_TIMEOUT_MS = Number(process.env.DTW_WORKER_TIMEOUT_MS) || 60_000;
const TIEIN_WORKER_TIMEOUT_MS = Number(process.env.TIEIN_WORKER_TIMEOUT_MS) || 30_000;

const MAX_EXPORT_ROWS = Number(process.env.MAX_EXPORT_ROWS) || 100_000;
const MAX_DTW_ANCHORS = Number(process.env.MAX_DTW_RECORDS) || 25_000;
const CONTROLLED_ALIGNMENT_ERROR_CODES = new Set([
    'INVALID_TIEIN_TRANSFORM',
    'PARTIAL_RUN_TIEIN_REQUIRED',
    'TIEIN_LOCK_RESOLUTION_FAILED',
    'NO_ALIGNMENT_ANCHORS',
]);

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

/**
 * The run pair a GW matching request is asking for.
 *
 * Chain alignment gives a session N-1 pairs, and the wizard switches between
 * them, so the session's `oldRun`/`newRun` fields cannot be forced onto every
 * request — doing that silently recomputed the same pair no matter which one the
 * operator selected. The requested pair is still resolved against the session's
 * own chain rather than trusted, because run ids arriving from a client must
 * never be able to reach another organization's persisted features.
 */
function resolveRequestedRunPair(config, body) {
    const requestedOldRunId = parsePositiveId(body?.oldRunId);
    const requestedNewRunId = parsePositiveId(body?.newRunId);
    if (!requestedOldRunId || !requestedNewRunId) {
        return getPersistedRunReferences(config);
    }
    const pair = findSessionRunPair(config, {
        oldRunId: requestedOldRunId,
        newRunId: requestedNewRunId,
    });
    if (!pair) {
        throw reviewPersistenceError(
            'The requested inspection run pair does not belong to this alignment session.',
            'UNKNOWN_ALIGNMENT_RUN_PAIR',
        );
    }
    return { oldRunId: pair.oldRunId, newRunId: pair.newRunId };
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
    return config?.dataReview !== undefined
        || config?.gwReview !== undefined
        || Object.values(config?.pairGwResults || {}).some((result) => result?.gwReview !== undefined);
}

/**
 * The settings a given run pair's GW matching actually ran under.
 *
 * Each pair carries its own tie-in transform and its own OTA, so signing a
 * pair's review with the session-level fields would compare it against settings
 * that belong to a different pair.
 */
function pairScopedSignatureConfig(config, pairKey) {
    const pairTieIn = config?.pairTieIns?.[pairKey];
    const pairResult = config?.pairGwResults?.[pairKey];
    return {
        ota: pairResult?.ota ?? config?.ota,
        strictPenalty: pairResult?.strictPenalty ?? config?.strictPenalty,
        useValveAnchor: pairResult?.useValveAnchor ?? config?.useValveAnchor,
        dtwOn: pairResult?.dtwOn ?? config?.dtwOn,
        globalOffset: pairTieIn?.globalOffset ?? config?.globalOffset,
        tieInTransform: pairTieIn?.tieInTransform ?? config?.tieInTransform,
        tieInDecision: pairTieIn?.tieInDecision ?? config?.tieInDecision,
        tieInEvidenceToken: pairTieIn?.tieInEvidenceToken ?? config?.tieInEvidenceToken,
        tieInMethodVersion: pairTieIn?.tieInMethodVersion ?? config?.tieInMethodVersion,
        tieInExcludedRanges: pairTieIn?.tieInExcludedRanges ?? config?.tieInExcludedRanges,
    };
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

    // A run whose features never normalized into an anchor type returns an
    // empty set here.  Passing it through produced a successful response with
    // zero matches, which the timeline renders identically to "not run yet" —
    // so the operator saw an empty chart and no reason for it.  Name the run
    // that has no anchors instead.
    const emptyRuns = [
        ...(oldRun.length === 0 ? [`OLD run ${oldRunId}`] : []),
        ...(newRun.length === 0 ? [`NEW run ${newRunId}`] : []),
    ];
    if (emptyRuns.length > 0) {
        const error = new Error(
            `${emptyRuns.join(' and ')} contains no alignment anchors. `
            + 'Alignment needs Weld, Valve, Tee, Flange, Bend, or Offtake features with a numeric log distance. '
            + 'Check the feature-type mapping for this inspection run.',
        );
        error.code = 'NO_ALIGNMENT_ANCHORS';
        throw error;
    }

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
        // Only the first 512 bytes matter for the magic-byte check; reading
        // the whole upload (up to 25 MB) synchronously blocked the event loop.
        let prefix;
        let handle;
        try {
            handle = await fsPromises.open(file.path, 'r');
            const header = Buffer.alloc(512);
            const { bytesRead } = await handle.read(header, 0, header.length, 0);
            prefix = header.subarray(0, bytesRead);
        } finally {
            await handle?.close().catch(() => {});
        }
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
        if (error.code === 'PARSER_DICTIONARY_UNAVAILABLE') {
            return res.status(503).json({
                error: error.message,
                code: error.code,
            });
        }
        return res.status(503).json({
            error: 'Ingestion queue is unavailable',
            code: 'INGESTION_QUEUE_UNAVAILABLE',
        });
    }
};

// The wizard used to hard-code its strategy dropdown, so an operator could pick
// an unvalidated engine, complete every remaining step, and only discover the
// rejection at execution.  Serving the capability table lets the picker close
// that dead end at the point of choice.
exports.listAlignmentStrategies = (_req, res) => {
    return res.json({ strategies: listAlignmentStrategyCapabilities() });
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
    let pageQuery;
    try {
        pageQuery = parseAlignmentResultPageQuery(req.query);
    } catch (error) {
        return res.status(400).json({ error: error.message });
    }
    try {
        const page = await listOwnedAlignmentResultPage(
            pool,
            sessionId,
            req.user.orgId,
            pageQuery,
        );
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
const { pythonExecutable, pythonSpawnOptions, killPythonProcess } = require('../../config/python');

// Restart backoff: a worker that dies on startup (bad PYTHON_EXECUTABLE,
// missing dependency) used to be respawned every 1000 ms forever.  Failures
// now back off exponentially and the counter resets once a worker proves
// healthy — by surviving WORKER_HEALTHY_AFTER_MS or completing a request.
const WORKER_RESTART_BASE_DELAY_MS = Number(process.env.WORKER_RESTART_BASE_DELAY_MS) || 1000;
const WORKER_RESTART_MAX_DELAY_MS = Number(process.env.WORKER_RESTART_MAX_DELAY_MS) || 60_000;
const WORKER_HEALTHY_AFTER_MS = Number(process.env.WORKER_HEALTHY_AFTER_MS) || 60_000;

const dtwWorkerHealth = { consecutiveFailures: 0, healthyTimer: null };
const tieInWorkerHealth = { consecutiveFailures: 0, healthyTimer: null };

function workerRestartDelayMs(consecutiveFailures) {
    return Math.min(
        WORKER_RESTART_BASE_DELAY_MS * 2 ** Math.max(0, consecutiveFailures - 1),
        WORKER_RESTART_MAX_DELAY_MS,
    );
}

function armWorkerHealthyReset(health) {
    if (health.healthyTimer) clearTimeout(health.healthyTimer);
    health.healthyTimer = setTimeout(() => {
        health.healthyTimer = null;
        health.consecutiveFailures = 0;
    }, WORKER_HEALTHY_AFTER_MS);
    health.healthyTimer.unref?.();
}

function recordWorkerFailure(health) {
    if (health.healthyTimer) {
        clearTimeout(health.healthyTimer);
        health.healthyTimer = null;
    }
    health.consecutiveFailures += 1;
}

// Removes a pending request and clears its timeout so a settled request never
// leaves a live timer behind (previously every request held its timer for the
// full 60 s even after responding).
function settlePendingRequest(pendingRequests, requestId) {
    const pending = pendingRequests.get(requestId);
    if (!pending) return null;
    pendingRequests.delete(requestId);
    clearTimeout(pending.timeout);
    return pending;
}

function rejectAllPendingRequests(pendingRequests, error) {
    for (const pending of pendingRequests.values()) {
        clearTimeout(pending.timeout);
        pending.reject(error);
    }
    pendingRequests.clear();
}

function scheduleWorkerRestart(startWorker, getTimer, setTimer, health) {
    if (workersShuttingDown || getTimer()) return;
    setTimer(setTimeout(() => {
        setTimer(null);
        if (!workersShuttingDown) startWorker();
    }, workerRestartDelayMs(health.consecutiveFailures)));
}

function stopPythonWorkers() {
    workersShuttingDown = true;
    if (dtwRestartTimer) clearTimeout(dtwRestartTimer);
    if (tieInRestartTimer) clearTimeout(tieInRestartTimer);
    if (dtwWorkerHealth.healthyTimer) clearTimeout(dtwWorkerHealth.healthyTimer);
    if (tieInWorkerHealth.healthyTimer) clearTimeout(tieInWorkerHealth.healthyTimer);
    rejectAllPendingRequests(dtwPendingRequests, new Error('Python workers are shutting down'));
    rejectAllPendingRequests(tieInPendingRequests, new Error('Python workers are shutting down'));
    dtwPythonProcess?.kill();
    tieInPythonProcess?.kill();
}

process.once('exit', stopPythonWorkers);

exports.stopPythonWorkers = stopPythonWorkers;

// Readiness detail for the health endpoint: state only, never process handles.
function getPythonWorkerStates() {
    return {
        dtw: {
            alive: Boolean(dtwPythonProcess && !dtwPythonProcess.killed && dtwPythonProcess.exitCode === null),
            restarting: Boolean(dtwRestartTimer),
            consecutiveFailures: dtwWorkerHealth.consecutiveFailures,
            pendingRequests: dtwPendingRequests.size,
        },
        tieIn: {
            alive: Boolean(tieInPythonProcess && !tieInPythonProcess.killed && tieInPythonProcess.exitCode === null),
            restarting: Boolean(tieInRestartTimer),
            consecutiveFailures: tieInWorkerHealth.consecutiveFailures,
            pendingRequests: tieInPendingRequests.size,
        },
    };
}

exports.getPythonWorkerStates = getPythonWorkerStates;

function startDtwPythonWorker() {
    console.log("Starting persistent DTW Python worker...");
    if (workersShuttingDown) return;
    const child = spawn(pythonExecutable, ['src/python_engines/dtw_engine.py'], pythonSpawnOptions({ cwd: path.join(__dirname, '../../..') }));
    dtwPythonProcess = child;
    armWorkerHealthyReset(dtwWorkerHealth);

    let buffer = '';
    child.stdout.on('data', (data) => {
        buffer += data.toString();
        let lines = buffer.split('\n');
        buffer = lines.pop(); // keep incomplete line

        for (const line of lines) {
            if (!line.trim()) continue;
            try {
                const result = JSON.parse(line);
                const { requestId } = result;
                const pending = settlePendingRequest(dtwPendingRequests, requestId);
                if (pending) {
                    // A completed round-trip proves the worker is healthy.
                    dtwWorkerHealth.consecutiveFailures = 0;
                    pending.resolve(result);
                }
            } catch (e) {
                console.error('Parse error from DTW worker:', line);
            }
        }
    });

    child.stderr.on('data', (data) => {
        console.error('DTW Worker Stderr:', data.toString());
    });

    // A worker that died mid-write surfaces EPIPE here; with no listener that
    // is an uncaught 'error' event.  Fail the in-flight requests immediately
    // instead of letting each wait out its full timeout.
    child.stdin.on('error', (error) => {
        console.error('DTW worker stdin error:', error.message);
        rejectAllPendingRequests(dtwPendingRequests, new Error(`DTW worker unavailable: ${error.message}`));
    });

    // 'error' (spawn failure such as an ENOENT interpreter) may arrive without
    // any 'close', and 'close' may follow an 'error'; route both through one
    // guard so pending rejection and restart scheduling happen exactly once.
    let exitHandled = false;
    const handleWorkerExit = (failure) => {
        if (exitHandled || workersShuttingDown) return;
        exitHandled = true;
        recordWorkerFailure(dtwWorkerHealth);
        rejectAllPendingRequests(dtwPendingRequests, failure);
        if (dtwPythonProcess === child) dtwPythonProcess = null;
        scheduleWorkerRestart(
            startDtwPythonWorker,
            () => dtwRestartTimer,
            (timer) => { dtwRestartTimer = timer; },
            dtwWorkerHealth,
        );
    };

    // Without this listener a spawn failure emits an unhandled 'error' event,
    // which becomes an uncaughtException and takes the whole API process down
    // in a supervisor crash-loop.  Mirrors the exportExcel guard.
    child.on('error', (error) => {
        console.error('DTW Python worker error:', error.message);
        handleWorkerExit(new Error(`DTW Python worker failed to start: ${error.message}`));
    });

    child.on('close', (code) => {
        console.error(`DTW Python worker exited (code ${code}).`);
        handleWorkerExit(new Error('Python worker crashed'));
    });
}

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
            persistedReferences = resolveRequestedRunPair(session.params_json || {}, req.body);
        }
        payload = await hydrateRunReferences({
            ...req.body,
            ...(persistedReferences || {}),
        }, req.user.orgId);
        requireServerTieInEvidence(payload, req.user.orgId);
        validateDtwPayload(payload);
    } catch (err) {
        const status = err.code === 'DTW_INPUT_TOO_LARGE'
            ? 413
            : err.code === 'ALIGNMENT_SESSION_NOT_FOUND'
                ? 404
                : CONTROLLED_ALIGNMENT_ERROR_CODES.has(err.code) ? 422 : 400;
        return res.status(status).json({
            error: err.message,
            code: err.code || 'INVALID_ALIGNMENT_PAYLOAD',
        });
    }
    const requestId = ++dtwRequestCounter;
    payload.requestId = requestId;
    
    try {
        const result = await new Promise((resolve, reject) => {
            if (!dtwPythonProcess || dtwPythonProcess.killed || !dtwPythonProcess.stdin?.writable) {
                reject(new Error('DTW worker is not available. Check the Python runtime and backend logs.'));
                return;
            }
            const timeout = setTimeout(() => {
                if (dtwPendingRequests.has(requestId)) {
                    dtwPendingRequests.delete(requestId);
                    console.error(`[DTW] Request ${requestId} timeout!`);
                    reject(new Error('Python worker timeout'));
                }
            }, DTW_WORKER_TIMEOUT_MS);
            dtwPendingRequests.set(requestId, { resolve, reject, timeout });

            // Log payload length for debugging
            console.log(`[DTW] Request ${requestId}: oldRun=${payload.oldRun?.length}, newRun=${payload.newRun?.length}`);

            // A write into a dying worker (EPIPE) must fail this request now,
            // not after the full worker timeout.
            dtwPythonProcess.stdin.write(JSON.stringify(payload) + '\n', (error) => {
                if (!error) return;
                const pending = settlePendingRequest(dtwPendingRequests, requestId);
                if (pending) pending.reject(new Error(`DTW worker write failed: ${error.message}`));
            });
        });
        
        if (result.success) {
            if (session && persistedReferences) {
                const canonicalGwLocks = normalizeCanonicalGwLocks(result.gwMatchesFinal);
                const current = await findOwnedSession(pool, session.id, req.user.orgId);
                if (!current) return res.status(404).json({ error: 'Alignment session not found' });
                // The pair must still be part of this session's chain. Comparing
                // against the session's single oldRun/newRun instead would reject
                // every pair except the last one the moment chains got longer.
                if (!findSessionRunPair(current.params_json || {}, persistedReferences)) {
                    return res.status(409).json({ error: 'Inspection runs changed while GW matching was running. Refresh and try again.' });
                }
                const signature = canonicalSignature(payload, persistedReferences);
                const pairKey = runPairKey(persistedReferences.oldRunId, persistedReferences.newRunId);
                const isPrimaryPair = primarySessionRunPair(current.params_json || {})?.key === pairKey;
                const previousPairEvidence = current.params_json?.pairGwEvidence?.[pairKey];
                const config = {
                    ...(current.params_json || {}),
                    // Every pair keeps its own canonical locks. One shared field
                    // meant matching a second pair overwrote the first pair's
                    // evidence, and its saved review then failed validation.
                    pairGwEvidence: {
                        ...(current.params_json?.pairGwEvidence || {}),
                        [pairKey]: { canonicalGwLocks, gwCanonicalSignature: signature },
                    },
                };
                // Legacy single-pair consumers still read the unscoped fields.
                if (isPrimaryPair) {
                    config.canonicalGwLocks = canonicalGwLocks;
                    config.gwCanonicalSignature = signature;
                }
                if (previousPairEvidence?.gwCanonicalSignature !== signature) {
                    // Settings changed for this pair only, so only this pair's
                    // downstream review and sections become stale.
                    if (config.pairGwResults?.[pairKey]) {
                        const { [pairKey]: _stale, ...remaining } = config.pairGwResults;
                        config.pairGwResults = remaining;
                    }
                    if (Array.isArray(config.matchingSections)) {
                        config.matchingSections = config.matchingSections.filter((section) => (
                            section?.pairKey ? section.pairKey !== pairKey : !isPrimaryPair
                        ));
                    }
                    if (isPrimaryPair) {
                        delete config.gwReview;
                        delete config.gwMatchesFinal;
                    }
                }
                const updated = await updateOwnedSessionConfig(pool, session.id, req.user.orgId, config);
                if (!updated) return res.status(409).json({ error: 'GW matching result could not be saved. Refresh and try again.' });
                result.sessionRevision = updated.revision;
            }
            res.json(result);
        } else {
            console.error(`[DTW] Request ${requestId} failed:`, result.error);
            const status = result.code === 'DTW_INPUT_TOO_LARGE'
                ? 413
                : CONTROLLED_ALIGNMENT_ERROR_CODES.has(result.code) ? 422 : 500;
            res.status(status).json({
                error: result.error,
                code: result.code || 'ALIGNMENT_ENGINE_FAILED',
                ...(Array.isArray(result.unresolvedKnotIndexes)
                    ? { unresolvedKnotIndexes: result.unresolvedKnotIndexes }
                    : {}),
            });
        }
    } catch (err) {
        console.error(`[DTW] Request ${requestId} exception:`, err);
        res.status(500).json({ error: err.message });
    }
};

function startTieInPythonWorker() {
    console.log("Starting persistent TieIn Python worker...");
    if (workersShuttingDown) return;
    const child = spawn(pythonExecutable, ['src/python_engines/tiein_engine.py'], pythonSpawnOptions({ cwd: path.join(__dirname, '../../..') }));
    tieInPythonProcess = child;
    armWorkerHealthyReset(tieInWorkerHealth);

    let buffer = '';
    child.stdout.on('data', (data) => {
        buffer += data.toString();
        let lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
            if (!line.trim()) continue;
            try {
                const result = JSON.parse(line);
                const { requestId } = result;
                const pending = settlePendingRequest(tieInPendingRequests, requestId);
                if (pending) {
                    tieInWorkerHealth.consecutiveFailures = 0;
                    pending.resolve(result);
                }
            } catch (e) {
                console.error('Parse error from TieIn worker:', line);
            }
        }
    });

    child.stderr.on('data', (data) => {
        console.error('TieIn Worker Stderr:', data.toString());
    });

    child.stdin.on('error', (error) => {
        console.error('TieIn worker stdin error:', error.message);
        rejectAllPendingRequests(tieInPendingRequests, new Error(`TieIn worker unavailable: ${error.message}`));
    });

    let exitHandled = false;
    const handleWorkerExit = (failure) => {
        if (exitHandled || workersShuttingDown) return;
        exitHandled = true;
        recordWorkerFailure(tieInWorkerHealth);
        rejectAllPendingRequests(tieInPendingRequests, failure);
        if (tieInPythonProcess === child) tieInPythonProcess = null;
        scheduleWorkerRestart(
            startTieInPythonWorker,
            () => tieInRestartTimer,
            (timer) => { tieInRestartTimer = timer; },
            tieInWorkerHealth,
        );
    };

    // See startDtwPythonWorker: a missing 'error' listener turns a spawn
    // failure into an uncaughtException and a supervisor crash-loop.
    child.on('error', (error) => {
        console.error('TieIn Python worker error:', error.message);
        handleWorkerExit(new Error(`TieIn Python worker failed to start: ${error.message}`));
    });

    child.on('close', (code) => {
        console.error(`TieIn Python worker exited (code ${code}).`);
        handleWorkerExit(new Error('TieIn Python worker crashed'));
    });
}

function startPythonWorkers() {
    if (!dtwPythonProcess) startDtwPythonWorker();
    if (!tieInPythonProcess) startTieInPythonWorker();
}

exports.startPythonWorkers = startPythonWorkers;

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
            const timeout = setTimeout(() => {
                if (tieInPendingRequests.has(requestId)) {
                    tieInPendingRequests.delete(requestId);
                    reject(new Error('TieIn Python worker timeout'));
                }
            }, TIEIN_WORKER_TIMEOUT_MS);
            tieInPendingRequests.set(requestId, { resolve, reject, timeout });
            tieInPythonProcess.stdin.write(JSON.stringify(payload) + '\n', (error) => {
                if (!error) return;
                const pending = settlePendingRequest(tieInPendingRequests, requestId);
                if (pending) pending.reject(new Error(`TieIn worker write failed: ${error.message}`));
            });
        });
        
        if (result.success && result.transform && result.decision) {
            result.evidenceToken = signTieInEvidence(buildTieInEvidence({
                ...payload,
                decision: result.decision,
                transform: result.transform,
            }, req.user.orgId, result.methodVersion));

            // Partial Run cannot fall back to a scalar offset, so a
            // REVIEW_REQUIRED estimate would otherwise dead-end the wizard.  The
            // server decides what an acknowledged decision looks like and signs
            // it here; the client can only replay it, never author it.
            if (result.decision.status === 'REVIEW_REQUIRED') {
                const acknowledgedDecision = {
                    ...result.decision,
                    status: 'REVIEW_ACKNOWLEDGED',
                    originalStatus: 'REVIEW_REQUIRED',
                    requiresHumanReview: true,
                    acknowledgedBy: Number(req.user.id),
                };
                result.reviewAcknowledgement = {
                    decision: acknowledgedDecision,
                    evidenceToken: signTieInEvidence(buildTieInEvidence({
                        ...payload,
                        decision: acknowledgedDecision,
                        transform: result.transform,
                    }, req.user.orgId, result.methodVersion)),
                };
            }
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
                    for (const [pairKey, pairResult] of Object.entries(config.pairGwResults || {})) {
                        if (pairResult?.gwReview === undefined) continue;
                        const pair = findSessionRunPair(session.params_json || {}, {
                            oldRunId: Number(pairKey.split('->')[0]),
                            newRunId: Number(pairKey.split('->')[1]),
                        });
                        if (!pair) {
                            throw reviewPersistenceError(
                                `Run pair ${pairKey} does not belong to this alignment session.`,
                                'UNKNOWN_ALIGNMENT_RUN_PAIR',
                            );
                        }
                        const expected = canonicalSignatureForConfig(
                            pairScopedSignatureConfig(config, pairKey),
                            { oldRunId: pair.oldRunId, newRunId: pair.newRunId },
                        );
                        if (session.params_json?.pairGwEvidence?.[pairKey]?.gwCanonicalSignature !== expected) {
                            throw reviewPersistenceError(`GW matching settings changed for pair ${pairKey}. Recalculate that pair before saving its review decisions.`);
                        }
                    }
                    const pairGwResults = normalizePairGwResultsForPersistence(configToPersist, {
                        pairGwEvidence: session.params_json?.pairGwEvidence,
                    });
                    if (pairGwResults !== undefined) configToPersist.pairGwResults = pairGwResults;
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
        if (isReusableAlignmentJob(previousJob, session.params_json)) {
            return res
                .status(previousJob.state === 'completed' ? 200 : 202)
                .json(buildReusableAlignmentJobResponse(previousJob));
        }

        const jobId = randomUUID();
        const configFingerprint = alignmentConfigFingerprint(session.params_json);
        const configuredAlgorithm = session.params_json?.algorithm
            || session.params_json?.summaryData?.algorithm
            || 'dtw_hungarian';
        const strategyCapability = getAlignmentStrategyCapability(configuredAlgorithm);
        if (!strategyCapability.available) {
            return res.status(422).json({
                error: `Alignment strategy "${strategyCapability.id}" is not available for execution.`,
                code: 'ALIGNMENT_STRATEGY_NOT_AVAILABLE',
                strategy: strategyCapability.id,
            });
        }
        await createAlignmentJob(pool, {
            jobId,
            sessionId: resolvedSessionId,
            organizationId: req.user.orgId,
            userId: req.user.id,
            engineVersion: ALIGNMENT_ENGINE_VERSION,
            configFingerprint,
        });
        try {
            await alignmentQueue.add('align-ili', {
                jobId,
                sessionId: resolvedSessionId,
                organizationId: req.user.orgId,
                userId: req.user.id,
                algorithm: configuredAlgorithm,
                engineVersion: ALIGNMENT_ENGINE_VERSION,
                configFingerprint,
            }, { jobId });
        } catch (queueError) {
            // Mirrors enqueueIngestion: with Redis down the durable row would
            // otherwise stay 'queued' forever, and the reuse check above would
            // keep answering 202 for this session with no worker ever coming.
            console.error('Failed to queue alignment job:', queueError);
            await updateAlignmentJob(pool, jobId, {
                state: 'failed',
                errorCode: 'QUEUE_UNAVAILABLE',
                errorMessage: 'Alignment queue is unavailable',
                completedAt: new Date(),
            });
            return res.status(503).json({
                error: 'Alignment queue is unavailable',
                code: 'ALIGNMENT_QUEUE_UNAVAILABLE',
            });
        }
        return res.status(202).json({
            success: true,
            jobId,
            state: 'queued',
            progress: 0,
            message: 'Alignment job queued',
        });


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
        return res.status(204).send();
    } catch (err) {
        console.error('Delete pipeline run error:', err);
        return res.status(500).json({ error: 'Failed to delete pipeline run' });
    }
};

// Each export spawns a Python process and writes a temp file, so an
// authenticated client looping this endpoint could otherwise spawn unbounded
// interpreters and fill uploads/.  Cap how many can run at once.
const MAX_CONCURRENT_EXPORTS = Number(process.env.MAX_CONCURRENT_EXPORTS) || 3;
const EXPORT_PROCESS_TIMEOUT_MS = Number(process.env.EXPORT_PROCESS_TIMEOUT_MS) || 2 * 60 * 1000;
let activeExports = 0;

async function removeQuietly(filePath) {
    await fsPromises.rm(filePath, { force: true }).catch(() => {});
}

exports.exportExcel = async (req, res) => {
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

    if (activeExports >= MAX_CONCURRENT_EXPORTS) {
        res.set('Retry-After', '10');
        return res.status(429).json({
            error: 'Too many exports in progress. Retry shortly.',
            code: 'EXPORT_BUSY',
        });
    }
    activeExports += 1;

    const uploadsDir = path.join(__dirname, '../../../../uploads');
    const exportId = randomUUID();
    const tempInputFile = path.join(uploadsDir, `export_input_${exportId}.json`);
    const tempOutputFile = path.join(uploadsDir, `export_output_${exportId}.xlsx`);

    let settled = false;
    const finish = async (handler) => {
        if (settled) return;
        settled = true;
        await removeQuietly(tempInputFile);
        try {
            await handler();
        } finally {
            activeExports -= 1;
        }
    };

    try {
        await fsPromises.mkdir(uploadsDir, { recursive: true });
        // Async, and without the pretty-printing that tripled the bytes written
        // for a 100k-row export.
        await fsPromises.writeFile(tempInputFile, JSON.stringify(data));

        const pythonProcess = spawn(
            pythonExecutable,
            [
                path.join(__dirname, '../../python_engines/export_excel.py'),
                tempInputFile,
                tempOutputFile,
            ],
            pythonSpawnOptions(),
        );

        let errorOutput = '';
        pythonProcess.stderr.on('data', (chunk) => { errorOutput += chunk.toString(); });

        const timeout = setTimeout(() => {
            killPythonProcess(pythonProcess);
            finish(async () => {
                await removeQuietly(tempOutputFile);
                if (!res.headersSent) {
                    res.status(504).json({ error: 'Excel export timed out', code: 'EXPORT_TIMEOUT' });
                }
            });
        }, EXPORT_PROCESS_TIMEOUT_MS);

        // 'error' is emitted asynchronously (e.g. the interpreter is not on
        // PATH).  With no listener it becomes an uncaught exception, the
        // request hangs until the client times out, and the temp file leaks.
        pythonProcess.on('error', (error) => {
            clearTimeout(timeout);
            console.error('Excel export failed to spawn:', error.message);
            finish(async () => {
                await removeQuietly(tempOutputFile);
                if (!res.headersSent) {
                    res.status(500).json({ error: 'Failed to generate Excel file' });
                }
            });
        });

        pythonProcess.on('close', (code) => {
            clearTimeout(timeout);
            finish(async () => {
                const produced = code === 0 && await fsPromises
                    .access(tempOutputFile)
                    .then(() => true, () => false);

                if (!produced) {
                    console.error('Excel export python failed:', errorOutput);
                    await removeQuietly(tempOutputFile);
                    if (!res.headersSent) {
                        res.status(500).json({ error: 'Failed to generate Excel file' });
                    }
                    return;
                }

                await new Promise((resolve) => {
                    res.download(tempOutputFile, 'synapse_alignment_report.xlsx', () => {
                        removeQuietly(tempOutputFile).finally(resolve);
                    });
                });
            });
        });
    } catch (err) {
        console.error('Failed to export Excel:', err);
        await finish(async () => {
            await removeQuietly(tempOutputFile);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Failed to export Excel' });
            }
        });
    }
};
