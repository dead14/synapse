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

async function runPythonAlignment(sessionId, algorithm) {
    const resultFile = path.join(os.tmpdir(), `synapse-alignment-${sessionId}-${Date.now()}.json`);
    try {
        const result = await new Promise((resolve, reject) => {
            const engineScript = algorithm === 'manual'
                ? 'src/python_engines/manual_alignment_engine.py'
                : 'src/python_engines/hungarian_engine.py';
            const child = spawn(pythonExecutable, [engineScript, String(sessionId)], pythonSpawnOptions({
                cwd: path.join(__dirname, '../../..'),
                env: { ALIGNMENT_RESULT_FILE: resultFile },
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
    }
}

async function processAlignmentJob(job) {
    const { sessionId, algorithm, configFingerprint } = job.data;
    await updateAlignmentJob(pool, job.id, { state: 'active', progress: 5, startedAt: new Date() });
    try {
        await emitProgress(job, 15, 'Alignment job started');
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

module.exports = { alignmentQueue, processAlignmentJob, startAlignmentWorker };
