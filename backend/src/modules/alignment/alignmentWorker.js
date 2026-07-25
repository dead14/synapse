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
    updateAlignmentJob,
} = require('./alignmentRepository');
const {
    normalizeComparisonResult,
    summarizeComparison,
} = require('./alignmentContract');
const { ALIGNMENT_ENGINE_VERSION } = require('./alignmentExecution');
const { pairKeyOf } = require('./runPairIdentity');
const { pythonExecutable, pythonSpawnOptions } = require('../../config/python');

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

async function runPythonAlignment(sessionId, algorithm, pairConfig = null) {
    const stamp = `${sessionId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const resultFile = path.join(os.tmpdir(), `synapse-alignment-${stamp}.json`);
    // A chain job runs the engine once per pair with different configuration
    // each time. Handing that over in a file keeps the shared
    // `alignment_sessions` row untouched: rewriting it per pair raced any other
    // reader of the session and left the row holding one pair's configuration
    // for good if the process died mid-loop.
    const pairConfigFile = pairConfig
        ? path.join(os.tmpdir(), `synapse-alignment-pair-${stamp}.json`)
        : null;
    if (pairConfigFile) await fs.writeFile(pairConfigFile, JSON.stringify(pairConfig), 'utf8');
    try {
        const result = await new Promise((resolve, reject) => {
            const engineScript = algorithm === 'manual'
                ? 'src/python_engines/manual_alignment_engine.py'
                : algorithm === 'phylogenetic'
                    ? 'src/python_engines/phylogenetic_engine.py'
                    : 'src/python_engines/hungarian_engine.py';
            const child = spawn(pythonExecutable, [engineScript, String(sessionId)], pythonSpawnOptions({
                cwd: path.join(__dirname, '../../..'),
                env: {
                    ALIGNMENT_RESULT_FILE: resultFile,
                    ...(pairConfigFile ? { ALIGNMENT_PAIR_CONFIG_FILE: pairConfigFile } : {}),
                },
            }));
            let errorOutput = '';
            const timeoutMs = Number(process.env.ALIGNMENT_PROCESS_TIMEOUT_MS) || 30 * 60 * 1000;
            const timeout = setTimeout(() => {
                child.kill();
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
        await fs.rm(resultFile, { force: true }).catch(() => {});
        if (pairConfigFile) await fs.rm(pairConfigFile, { force: true }).catch(() => {});
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
    const sections = Array.isArray(sessionConfig?.matchingSections)
        ? sessionConfig.matchingSections.filter((section) => (
            section?.pairKey ? section.pairKey === pairKey : !section?.pairKey
        ))
        : [];

    return {
        ...sessionConfig,
        ...(pairTieIn || {}),
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

async function processAlignmentJob(job) {
    const { sessionId, algorithm, configFingerprint } = job.data;
    await updateAlignmentJob(pool, job.id, { state: 'active', progress: 5, startedAt: new Date() });
    try {
        await emitProgress(job, 15, 'Alignment job started');

        const sessionRow = await pool.query(
            'SELECT params_json FROM alignment_sessions WHERE id = $1', [sessionId],
        );
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
                await emitProgress(
                    job, pairProgress,
                    `Aligning pair ${i + 1}/${runPairs.length}: ${pair.oldRun?.year || '?'} → ${pair.newRun?.year || '?'}`,
                );
                pairResults.push(await runPythonAlignment(
                    sessionId,
                    algorithm,
                    buildPairSessionConfig(sessionConfig, pair),
                ));
            }

            const result = mergeMultiPairResults(pairResults, runPairs);
            await emitProgress(job, 80, 'Normalizing alignment result');
            const normalized = normalizeComparisonResult(result);
            const resultPayload = {
                comparison: normalized.comparison,
                groups: normalized.groups,
                sessionId,
                engineVersion: job.data.engineVersion || ALIGNMENT_ENGINE_VERSION,
                configFingerprint: configFingerprint || null,
                pairCount: runPairs.length,
                runPairs: runPairs.map((p, i) => ({
                    index: i,
                    oldRunId: p.oldRun?.runId,
                    newRunId: p.newRun?.runId,
                    oldYear: p.oldRun?.year,
                    newYear: p.newRun?.year,
                })),
            };
            await updateAlignmentJob(pool, job.id, {
                state: 'completed', progress: 100, result: resultPayload, completedAt: new Date(),
            });
            await markOwnedSessionCompleted(pool, sessionId, job.data.organizationId, summarizeComparison(normalized.comparison));
            await job.updateProgress(100);
            socketConfig.getIO()?.to(`user_${job.data.userId}`).emit('alignment_complete', { jobId: job.id, result: resultPayload });
            return resultPayload;
        }

        await emitProgress(job, 20, 'Loading canonical ILI data');
        const result = await runPythonAlignment(sessionId, algorithm);
        await emitProgress(job, 80, 'Normalizing alignment result');
        const normalized = normalizeComparisonResult(result);
        const resultPayload = {
            comparison: normalized.comparison,
            groups: normalized.groups,
            sessionId,
            engineVersion: job.data.engineVersion || ALIGNMENT_ENGINE_VERSION,
            configFingerprint: configFingerprint || null,
        };
        await updateAlignmentJob(pool, job.id, {
            state: 'completed', progress: 100, result: resultPayload, completedAt: new Date(),
        });
        await markOwnedSessionCompleted(pool, sessionId, job.data.organizationId, summarizeComparison(normalized.comparison));
        await job.updateProgress(100);
        socketConfig.getIO()?.to(`user_${job.data.userId}`).emit('alignment_complete', { jobId: job.id, result: resultPayload });
        return resultPayload;
    } catch (error) {
        const finalAttempt = (job.attemptsMade + 1) >= (job.opts.attempts || 1);
        await updateAlignmentJob(pool, job.id, {
            state: finalAttempt ? 'failed' : 'retrying',
            errorCode: error.code || 'ALIGNMENT_FAILED',
            errorMessage: String(error.message || error),
            completedAt: finalAttempt ? new Date() : undefined,
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
    __testables: { resolveRunPairs, buildPairSessionConfig, mergeMultiPairResults },
};
