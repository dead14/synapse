const { Worker } = require('bullmq');
const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const { connection } = require('../config/redis');
const pool = require('../config/db');
const { updateIngestionJob } = require('../modules/ingestion/ingestionRepository');
const storage = require('../modules/storage/objectStorage');
const metrics = require('../observability/metrics');
const { buildIngestionArguments, ingestionWorkerCwd } = require('./ingestionCommand');
const { resolveIngestionExit } = require('./ingestionOutcome');

function runIngestionProcess({ inputPath, pipelineName, surveyYear, vendor, organizationId, userId, sourceFile, objectKey }) {
    return new Promise((resolve, reject) => {
        const child = spawn('python', buildIngestionArguments({
            inputPath,
            pipelineName,
            surveyYear,
            vendor,
            organizationId,
            userId,
            sourceFile,
            objectKey,
        }), { cwd: ingestionWorkerCwd() });
        let output = '';
        let errorOutput = '';
        child.stdout.on('data', (data) => { output += data.toString(); });
        child.stderr.on('data', (data) => { errorOutput += data.toString(); });
        child.on('error', reject);
        child.on('close', (code) => {
            try {
                return resolve(resolveIngestionExit({ code, output, errorOutput }));
            } catch (error) {
                return reject(error);
            }
        });
    });
}

async function processIngestionJob(job) {
    const startedAt = performance.now();
    const payload = job.data;
    await updateIngestionJob(pool, payload.jobId, {
        state: 'active', progress: 5, startedAt: new Date(),
    });
    await job.updateProgress(5);

    let temporaryPath = null;
    try {
        temporaryPath = storage.storageDriver() === 's3'
            ? await storage.createWorkerTempPath(payload.jobId, payload.sourceFile)
            : null;
        const inputPath = await storage.materializeFile(payload.objectKey, temporaryPath);
        await updateIngestionJob(pool, payload.jobId, { state: 'active', progress: 20 });
        await job.updateProgress(20);
        const result = await runIngestionProcess({ inputPath, ...payload });
        const storedResult = {
            status: 'success',
            pipelineRunId: Number(result.run_id),
            rowCount: Number(result.row_count || 0),
            summary: result.summary || result.audit?.feature_counts || null,
            audit: result.audit || null,
            sourceSha256: result.source_sha256 || null,
        };
        await updateIngestionJob(pool, payload.jobId, {
            state: 'completed',
            progress: 100,
            runId: storedResult.pipelineRunId,
            result: storedResult,
            completedAt: new Date(),
        });
        await job.updateProgress(100);
        metrics.observe('ili_upload_ingest', performance.now() - startedAt, { state: 'completed' });
        return storedResult;
    } catch (error) {
        const isFinalAttempt = (job.attemptsMade + 1) >= (job.opts.attempts || 1);
        await updateIngestionJob(pool, payload.jobId, {
            state: isFinalAttempt ? 'failed' : 'retrying',
            errorCode: error.code || 'INGESTION_FAILED',
            errorMessage: String(error.message || error),
            completedAt: isFinalAttempt ? new Date() : undefined,
        });
        metrics.observe('ili_upload_ingest', performance.now() - startedAt, { state: 'failed' });
        throw error;
    } finally {
        if (temporaryPath) {
            await fs.rm(path.dirname(temporaryPath), { recursive: true, force: true }).catch(() => {});
        }
    }
}

function startIngestionWorker() {
    const worker = new Worker('ili-ingestion', processIngestionJob, {
        connection,
        concurrency: Number(process.env.INGESTION_WORKER_CONCURRENCY) || 2,
        limiter: { max: Number(process.env.INGESTION_RATE_MAX) || 4, duration: Number(process.env.INGESTION_RATE_DURATION_MS) || 60_000 },
    });
    worker.on('completed', (job) => console.log(JSON.stringify({ event: 'ili_ingestion_completed', jobId: job.id })));
    worker.on('failed', (job, error) => console.error(JSON.stringify({ event: 'ili_ingestion_failed', jobId: job?.id, error: error.message })));
    return worker;
}

module.exports = { processIngestionJob, startIngestionWorker };
