const { Queue, Worker } = require('bullmq');
const { spawn } = require('child_process');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const { connection, createWorkerConnection } = require('../../config/redis');
const pool = require('../../config/db');
const socketConfig = require('../../socket');
const {
    markOwnedSessionCompleted,
    markOwnedSessionFailed,
    saveAlignmentJobRows,
    updateAlignmentJob,
} = require('./alignmentRepository');
const {
    normalizeComparisonResult,
    summarizeComparison,
} = require('./alignmentContract');
const { ALIGNMENT_ENGINE_VERSION, alignmentProcessTimeoutMs } = require('./alignmentExecution');
const { resolveAnomalyMatcher } = require('./anomalyMatchers');
const { pairKeyOf } = require('./runPairIdentity');
const { pythonExecutable, pythonSpawnOptions, killPythonProcess } = require('../../config/python');

// Strategies that own Phase 1 and Phase 2 together, keyed by their engine.
// Everything else takes a fixed girth-weld phase and varies only the anomaly
// matcher, which `anomalyMatchers.js` resolves — so these are exactly the
// strategies a matcher choice must not be able to redirect.
const END_TO_END_ENGINE_SCRIPTS = Object.freeze({
    manual: 'src/python_engines/manual_alignment_engine.py',
    phylogenetic: 'src/python_engines/phylogenetic_engine.py',
    aurora_ili: 'src/python_engines/aurora_engine.py',
});

/**
 * Which Python engine runs this job.
 *
 * An end-to-end strategy wins over the matcher registry: it locks the welds and
 * pairs the anomalies in one engine, so honouring a saved matcher choice here
 * would hand the run to a script that cannot read its configuration — and
 * would produce a plausible-looking result from the wrong algorithm.
 */
function resolveEngineScript(algorithm, matcher) {
    return END_TO_END_ENGINE_SCRIPTS[algorithm]
        || matcher?.engineScript
        || 'src/python_engines/hungarian_engine.py';
}

const alignmentQueue = new Queue('ili-alignment', {
    connection,
    defaultJobOptions: {
        attempts: Number(process.env.ALIGNMENT_JOB_ATTEMPTS) || 2,
        backoff: { type: 'exponential', delay: 10_000 },
        removeOnComplete: { age: 7 * 24 * 60 * 60, count: 10_000 },
        removeOnFail: { age: 30 * 24 * 60 * 60, count: 10_000 },
    },
});

function emitProgress(job, progress, message) {
    return Promise.all([
        job.updateProgress(progress),
        updateAlignmentJob(pool, job.id, { state: 'active', progress }),
    ]).then(() => {
        if (job.data.userId) {
            socketConfig.getIO()?.to(`user_${job.data.userId}`).emit('alignment_progress', {
                jobId: job.id, progress, message,
            });
        }
    });
}

async function runPythonAlignment(sessionId, algorithm, pairConfig = null, matcher = null) {
    // mkdtemp gives this run a private, unpredictable directory instead of
    // guessable file names in the shared tmp dir (mirrors
    // objectStorage.createWorkerTempPath).
    const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'synapse-alignment-'));
    const resultFile = path.join(workDir, 'result.json');
    // A chain job runs the engine once per pair with different configuration
    // each time. Handing that over in a file keeps the shared
    // `alignment_sessions` row untouched: rewriting it per pair raced any other
    // reader of the session and left the row holding one pair's configuration
    // for good if the process died mid-loop.
    const pairConfigFile = pairConfig
        ? path.join(workDir, 'pair-config.json')
        : null;
    if (pairConfigFile) await fs.writeFile(pairConfigFile, JSON.stringify(pairConfig), 'utf8');
    try {
        const result = await new Promise((resolve, reject) => {
            const engineScript = resolveEngineScript(algorithm, matcher);
            const child = spawn(pythonExecutable, [engineScript, String(sessionId)], pythonSpawnOptions({
                cwd: path.join(__dirname, '../../..'),
                env: {
                    ALIGNMENT_RESULT_FILE: resultFile,
                    ...(pairConfigFile ? { ALIGNMENT_PAIR_CONFIG_FILE: pairConfigFile } : {}),
                },
            }));
            let errorOutput = '';
            const timeoutMs = alignmentProcessTimeoutMs();
            const timeout = setTimeout(() => {
                killPythonProcess(child);
                const error = new Error(`Alignment process exceeded ${timeoutMs} ms`);
                error.code = 'ALIGNMENT_PROCESS_TIMEOUT';
                reject(error);
            }, timeoutMs);
            child.stdout.resume();
            child.stderr.on('data', (data) => { errorOutput += data.toString(); });
            child.on('error', (error) => { clearTimeout(timeout); reject(error); });
            child.on('close', async (code) => {
                clearTimeout(timeout);
                if (code !== 0) return reject(new Error(errorOutput || `Alignment exited with code ${code}`));
                try {
                    const raw = await fs.readFile(resultFile, 'utf8');
                    return resolve(JSON.parse(raw));
                } catch (error) { return reject(error); }
            });
        });
        return result;
    } finally {
        await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
}

function resolveRunPairs(sessionConfig) {
    const summary = sessionConfig?.summaryData || {};
    const pairs = summary.runPairs;
    if (Array.isArray(pairs) && pairs.length > 0) return pairs;
    const oldRun = summary.oldRun;
    const newRun = summary.newRun;
    if (oldRun?.runId && newRun?.runId) return [{ oldRun, newRun }];
    return [];
}

function buildPairSessionConfig(sessionConfig, pair) {
    const { runPairs: _runPairs, ...summaryWithoutPairs } = sessionConfig?.summaryData || {};
    const pairKey = pairKeyOf(pair);
    // Without this every pair ran on the last pair's tie-in transform, GW locks
    // and sections, because those fields only ever existed unscoped. That is what
    // displaced a 2012 run by the offset belonging to a 2024 -> 2026 transform.
    const pairTieIn = pairKey ? sessionConfig?.pairTieIns?.[pairKey] : null;
    const pairGw = pairKey ? sessionConfig?.pairGwResults?.[pairKey] : null;
    // A 14-year interval and a 2-year interval do not deserve the same anomaly
    // tolerances, so each pair may carry its own. Sessions that never set them
    // keep using the single session-wide config.
    const pairTolerances = pairKey ? sessionConfig?.pairToleranceConfigs?.[pairKey] : null;
    const sections = Array.isArray(sessionConfig?.matchingSections)
        ? sessionConfig.matchingSections.filter((section) => (
            section?.pairKey ? section.pairKey === pairKey : !section?.pairKey
        ))
        : [];

    // A pair with no tie-in entry of its own must run with *no* transform, not
    // with whichever transform happens to sit at the session root: spreading
    // `pairTieIn` only when it exists still let the 2024→2026 transform displace
    // the 2012 run. Every tie-in field is therefore rebound unconditionally.
    const tieInFields = {
        globalOffset: pairTieIn?.globalOffset ?? null,
        tieInOffset: pairTieIn?.tieInOffset ?? null,
        tieInTransform: pairTieIn?.tieInTransform ?? null,
        tieInDecision: pairTieIn?.tieInDecision ?? null,
        tieInEvidenceToken: pairTieIn?.tieInEvidenceToken ?? null,
        tieInMethodVersion: pairTieIn?.tieInMethodVersion ?? null,
        tieInExcludedRanges: pairTieIn?.tieInExcludedRanges ?? null,
        partialRunEnabled: pairTieIn?.partialRunEnabled ?? false,
    };

    return {
        ...sessionConfig,
        ...(pairTieIn || {}),
        ...tieInFields,
        ...(pairGw
            ? {
                gwMatchesFinal: pairGw.gwMatchesFinal,
                gwOrphans: pairGw.gwOrphans,
                gwReview: pairGw.gwReview,
                ota: pairGw.ota ?? sessionConfig?.ota,
                dtwOn: pairGw.dtwOn ?? sessionConfig?.dtwOn,
                strictPenalty: pairGw.strictPenalty ?? sessionConfig?.strictPenalty,
                useValveAnchor: pairGw.useValveAnchor ?? sessionConfig?.useValveAnchor,
            }
            : {}),
        ...(pairTolerances ? { ToleranceConfig: pairTolerances } : {}),
        matchingSections: sections,
        activeRunPairKey: pairKey,
        summaryData: {
            ...summaryWithoutPairs,
            oldRun: pair.oldRun,
            newRun: pair.newRun,
            masterRun: pair.newRun,
            historicalRuns: [pair.oldRun],
        },
    };
}

function mergeMultiPairResults(pairResults, runPairs = []) {
    const merged = {
        gw_locked: [],
        gw_unmatched: [],
        fitting_matched: [],
        anomaly_matched: [],
        anomaly_only_old: [],
        anomaly_only_new: [],
        bypassed_old: [],
        bypassed_new: [],
        filtered_old: [],
        filtered_new: [],
        audit: { pairs: [] },
    };
    for (const [idx, result] of pairResults.entries()) {
        const pair = runPairs[idx];
        // A bare index cannot be read by anyone looking at the results table.
        // Carrying the years and the pair key lets the report say which
        // comparison a row came from and lets the UI group by it.
        const identity = {
            pair_index: idx,
            ...(pair
                ? {
                    pair_key: pairKeyOf(pair),
                    pair_label: `${pair.oldRun?.year || '?'} → ${pair.newRun?.year || '?'}`,
                    pair_old_year: pair.oldRun?.year ?? null,
                    pair_new_year: pair.newRun?.year ?? null,
                }
                : {}),
        };
        const tag = (rows) => rows.map((r) => ({ ...r, ...identity }));
        merged.gw_locked.push(...tag(result.gw_locked || []));
        merged.gw_unmatched.push(...tag(result.gw_unmatched || []));
        merged.fitting_matched.push(...tag(result.fitting_matched || []));
        merged.anomaly_matched.push(...tag(result.anomaly_matched || []));
        merged.anomaly_only_old.push(...tag(result.anomaly_only_old || []));
        merged.anomaly_only_new.push(...tag(result.anomaly_only_new || []));
        merged.bypassed_old.push(...tag(result.bypassed_old || []));
        merged.bypassed_new.push(...tag(result.bypassed_new || []));
        merged.filtered_old.push(...tag(result.filtered_old || []));
        merged.filtered_new.push(...tag(result.filtered_new || []));
        merged.audit.pairs.push(result.audit || {});
    }
    return merged;
}

/**
 * Store one finished run and announce it.
 *
 * The comparison rows go to `alignment_job_rows`; `result_json` keeps only the
 * execution metadata and the conservation audit.  Writing both the flat
 * `comparison` array and the `groups` buckets into one JSONB column stored every
 * row twice, and made each status poll, each reuse check and each result page
 * de-TOAST and parse the whole document.
 */
async function finishAlignmentJob(job, sessionId, configFingerprint, engineResult, extra = {}) {
    await emitProgress(job, 80, 'Normalizing alignment result');
    const normalized = normalizeComparisonResult(engineResult);
    await emitProgress(job, 88, 'Storing alignment rows');
    const rowCount = await saveAlignmentJobRows(pool, job.id, normalized.comparison);
    const resultPayload = {
        sessionId,
        engineVersion: job.data.engineVersion || ALIGNMENT_ENGINE_VERSION,
        configFingerprint: configFingerprint || null,
        rowCount,
        // The audit is the only part of the engine's bucket output any consumer
        // reads, so the buckets themselves are not stored a second time.
        groups: { audit: normalized.groups?.audit ?? null },
        ...extra,
    };
    await updateAlignmentJob(pool, job.id, {
        state: 'completed',
        progress: 100,
        result: resultPayload,
        rowCount,
        completedAt: new Date(),
        organizationId: job.data.organizationId,
    });
    await markOwnedSessionCompleted(
        pool, sessionId, job.data.organizationId, summarizeComparison(normalized.comparison),
    );
    await job.updateProgress(100);
    // The socket payload mirrors the polled response: a listener that receives
    // the rows inline would defeat the paged read path it goes on to use.
    socketConfig.getIO()?.to(`user_${job.data.userId}`).emit('alignment_complete', {
        jobId: job.id, result: resultPayload,
    });
    return resultPayload;
}

async function processAlignmentJob(job) {
    const { sessionId, algorithm, configFingerprint } = job.data;
    await updateAlignmentJob(pool, job.id, { state: 'active', progress: 5, startedAt: new Date() });
    try {
        await emitProgress(job, 15, 'Alignment job started');

        // Ownership was verified when the job was created, but a worker that
        // reads the session by id alone would happily align another tenant's
        // configuration if a job row were ever mis-addressed.
        const sessionRow = await pool.query(
            `SELECT s.params_json
             FROM alignment_sessions s
             LEFT JOIN pipelines p ON p.id = s.pipeline_id
             WHERE s.id = $1
               AND COALESCE(s.organization_id, p.organization_id) = $2`,
            [sessionId, job.data.organizationId],
        );
        if (sessionRow.rows.length === 0) {
            const error = new Error('Alignment session is not available for this organization');
            error.code = 'ALIGNMENT_SESSION_NOT_FOUND';
            throw error;
        }
        const sessionConfig = sessionRow.rows[0]?.params_json || {};
        const runPairs = resolveRunPairs(sessionConfig);
        const isMultiPair = runPairs.length > 1
            && algorithm !== 'phylogenetic'
            && algorithm !== 'manual';

        if (isMultiPair) {
            const pairResults = [];
            for (let i = 0; i < runPairs.length; i++) {
                const pair = runPairs[i];
                const pairProgress = 20 + Math.round((i / runPairs.length) * 55);
                // Resolved per pair, not once for the job: a pair may carry its
                // own tolerance configuration, and that is where the matcher
                // choice lives.
                const pairSessionConfig = buildPairSessionConfig(sessionConfig, pair);
                const pairMatcher = resolveAnomalyMatcher(pairSessionConfig, algorithm);
                await emitProgress(
                    job, pairProgress,
                    `Aligning pair ${i + 1}/${runPairs.length}: ${pair.oldRun?.year || '?'} → ${pair.newRun?.year || '?'}`,
                );
                pairResults.push(await runPythonAlignment(
                    sessionId,
                    algorithm,
                    pairSessionConfig,
                    pairMatcher,
                ));
            }

            const result = mergeMultiPairResults(pairResults, runPairs);
            return finishAlignmentJob(job, sessionId, configFingerprint, result, {
                pairCount: runPairs.length,
                runPairs: runPairs.map((p, i) => ({
                    index: i,
                    oldRunId: p.oldRun?.runId,
                    newRunId: p.newRun?.runId,
                    oldYear: p.oldRun?.year,
                    newYear: p.newRun?.year,
                })),
            });
        }

        const matcher = resolveAnomalyMatcher(sessionConfig, algorithm);
        await emitProgress(job, 20, 'Loading canonical ILI data');
        const result = await runPythonAlignment(sessionId, algorithm, null, matcher);
        return finishAlignmentJob(job, sessionId, configFingerprint, result);
    } catch (error) {
        const finalAttempt = (job.attemptsMade + 1) >= (job.opts.attempts || 1);
        await updateAlignmentJob(pool, job.id, {
            state: finalAttempt ? 'failed' : 'retrying',
            errorCode: error.code || 'ALIGNMENT_FAILED',
            errorMessage: String(error.message || error),
            completedAt: finalAttempt ? new Date() : undefined,
            organizationId: job.data.organizationId,
        });
        if (finalAttempt) await markOwnedSessionFailed(pool, sessionId, job.data.organizationId, error.message);
        throw error;
    }
}

function startAlignmentWorker() {
    const worker = new Worker('ili-alignment', processAlignmentJob, {
        connection: createWorkerConnection('alignment-worker'),
        concurrency: Number(process.env.ALIGNMENT_WORKER_CONCURRENCY) || 1,
    });
    worker.on('completed', (job) => console.log(JSON.stringify({ event: 'ili_alignment_completed', jobId: job.id })));
    worker.on('failed', (job, error) => console.error(JSON.stringify({ event: 'ili_alignment_failed', jobId: job?.id, error: error.message })));
    return worker;
}

module.exports = {
    alignmentQueue,
    processAlignmentJob,
    startAlignmentWorker,
    __testables: {
        resolveRunPairs,
        buildPairSessionConfig,
        mergeMultiPairResults,
        resolveEngineScript,
    },
};
