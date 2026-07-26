const { UnrecoverableError, Worker } = require('bullmq');
const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const { createWorkerConnection } = require('../config/redis');
const pool = require('../config/db');
const {
    isParserDictionaryReady,
    updateIngestionJob,
} = require('../modules/ingestion/ingestionRepository');
const storage = require('../modules/storage/objectStorage');
const metrics = require('../observability/metrics');
const { buildIngestionArguments, ingestionWorkerCwd } = require('./ingestionCommand');
const { resolveIngestionExit } = require('./ingestionOutcome');
const { ingestionLimiter, isUnrecoverableIngestionError } = require('./ingestionPolicy');
const { pythonExecutable, pythonSpawnOptions, killPythonProcess } = require('../config/python');

function runIngestionProcess({ inputPath, pipelineName, surveyYear, vendor, organizationId, userId, sourceFile, objectKey }) {
    return new Promise((resolve, reject) => {
        const child = spawn(pythonExecutable, buildIngestionArguments({
            inputPath,
            pipelineName,
            surveyYear,
            vendor,
            organizationId,
            userId,
            sourceFile,
            objectKey,
        }), pythonSpawnOptions({ cwd: ingestionWorkerCwd() }));
        let output = '';
        let errorOutput = '';
        // Without this, a workbook that makes the parser block or spin forever
        // never settles the job, permanently consuming one of the concurrency
        // slots with no error surfaced.  Mirrors runPythonAlignment.
        const timeoutMs = Number(process.env.INGESTION_PROCESS_TIMEOUT_MS) || 30 * 60 * 1000;
        const timeout = setTimeout(() => {
            killPythonProcess(child);
            const error = new Error(`Ingestion process exceeded ${timeoutMs} ms`);
            error.code = 'INGESTION_PROCESS_TIMEOUT';
            reject(error);
        }, timeoutMs);
        child.stdout.on('data', (data) => { output += data.toString(); });
        child.stderr.on('data', (data) => { errorOutput += data.toString(); });
        child.on('error', (error) => { clearTimeout(timeout); reject(error); });
        child.on('close', (code) => {
            clearTimeout(timeout);
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
        state: 'active',
        progress: 5,
        startedAt: new Date(),
        completedAt: null,
        errorCode: null,
        errorMessage: null,
    });
    await job.updateProgress(5);

    let temporaryPath = null;
    try {
        if (!(await isParserDictionaryReady(pool))) {
            const error = new Error('Kamus sinonim parser belum tersedia.');
            error.code = 'PARSER_DICTIONARY_UNAVAILABLE';
            throw error;
        }
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
        // Structured importer errors carry stderr separately; surface it in
        // the log without letting it replace the operator-facing message.
        if (error.diagnostic) {
            console.error(JSON.stringify({
                event: 'ili_ingestion_stderr',
                jobId: payload.jobId,
                stderr: error.diagnostic,
            }));
        }
        const unrecoverable = isUnrecoverableIngestionError(error);
        const isFinalAttempt = unrecoverable
            || (job.attemptsMade + 1) >= (job.opts.attempts || 1);
        await updateIngestionJob(pool, payload.jobId, {
            state: isFinalAttempt ? 'failed' : 'retrying',
            errorCode: error.code || 'INGESTION_FAILED',
            errorMessage: String(error.message || error),
            completedAt: isFinalAttempt ? new Date() : undefined,
        });
        metrics.observe('ili_upload_ingest', performance.now() - startedAt, { state: 'failed' });
        if (unrecoverable) throw new UnrecoverableError(error.message);
        throw error;
    } finally {
        if (temporaryPath) {
            await fs.rm(path.dirname(temporaryPath), { recursive: true, force: true }).catch(() => {});
        }
    }
}

function startIngestionWorker() {
    const options = {
        connection: createWorkerConnection('ingestion-worker'),
        concurrency: Number(process.env.INGESTION_WORKER_CONCURRENCY) || 2,
    };
    const limiter = ingestionLimiter(process.env);
    if (limiter) options.limiter = limiter;
    const worker = new Worker('ili-ingestion', processIngestionJob, options);
    worker.on('completed', (job) => console.log(JSON.stringify({ event: 'ili_ingestion_completed', jobId: job.id })));
    worker.on('failed', (job, error) => console.error(JSON.stringify({ event: 'ili_ingestion_failed', jobId: job?.id, error: error.message })));
    return worker;
}

module.exports = { processIngestionJob, startIngestionWorker };
