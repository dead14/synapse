const { randomUUID } = require('crypto');
const pool = require('../../config/db');
const { ingestionQueue } = require('./ingestionQueue');
const { queueUnavailableError } = require('./ingestionErrors');
const {
    ensureOwnedPipeline,
    findOwnedPersistedRunByChecksum,
    getOwnedIngestionJob,
    isParserDictionaryReady,
    serializeIngestionJob,
} = require('./ingestionRepository');

exports.getIngestionJob = async (req, res) => {
    const jobId = String(req.params.jobId || '').trim();
    if (!jobId || jobId.length > 100) return res.status(400).json({ error: 'Invalid ingestion job id' });
    try {
        const job = await getOwnedIngestionJob(pool, jobId, req.user.orgId);
        if (!job) return res.status(404).json({ error: 'Ingestion job not found' });
        return res.json(serializeIngestionJob(job));
    } catch (error) {
        console.error('Get ingestion job error:', error);
        return res.status(500).json({ error: 'Failed to fetch ingestion job' });
    }
};

exports.enqueueIngestion = async ({ file, pipelineName, surveyYear, surveyDate, vendor, user }) => {
    const jobId = randomUUID();
    const storage = require('../storage/objectStorage');
    if (!(await isParserDictionaryReady(pool))) {
        const error = new Error('Konfigurasi importer belum siap. Hubungi administrator.');
        error.code = 'PARSER_DICTIONARY_UNAVAILABLE';
        throw error;
    }
    const pipeline = await ensureOwnedPipeline(pool, {
        organizationId: user.orgId,
        pipelineName,
    });
    if (!pipeline) {
        const error = new Error('Organization is inactive or its pipeline limit has been reached.');
        error.code = 'ORGANIZATION_LIMIT_REACHED';
        throw error;
    }
    const stored = await storage.putFile(file.path, {
        organizationId: user.orgId,
        sourceName: file.originalname,
        contentType: file.mimetype,
    });
    const repository = require('./ingestionRepository');
    const existingRun = await findOwnedPersistedRunByChecksum(pool, {
        organizationId: user.orgId,
        pipelineName,
        sourceSha256: stored.sourceSha256,
    });
    if (existingRun) {
        return { kind: 'existing', run: existingRun };
    }
    const created = await repository.createIngestionJob(pool, {
        jobId,
        organizationId: user.orgId,
        userId: user.id,
        pipelineName,
        surveyYear,
        surveyDate: surveyDate || null,
        vendor,
        sourceFile: file.originalname,
        objectKey: stored.key,
        sourceSha256: stored.sourceSha256,
    });
    try {
        const enqueuePromise = ingestionQueue.add('ingest-ili', {
            jobId,
            organizationId: user.orgId,
            userId: user.id,
            pipelineName,
            surveyYear,
            surveyDate: surveyDate || null,
            vendor,
            sourceFile: file.originalname,
            objectKey: stored.key,
        }, { jobId });
        
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => {
                const error = new Error('Queue unavailable (timeout)');
                error.code = 'QUEUE_UNAVAILABLE';
                reject(error);
            }, 5000);
        });

        await Promise.race([enqueuePromise, timeoutPromise]);
    } catch (error) {
        try {
            await repository.updateIngestionJob(pool, jobId, {
                state: 'failed',
                errorCode: 'QUEUE_UNAVAILABLE',
                errorMessage: 'Ingestion queue is unavailable',
                completedAt: new Date(),
            });
        } catch (updateError) {
            console.error('Failed to record unavailable ingestion queue:', updateError);
        }
        throw queueUnavailableError(error);
    }
    return { kind: 'queued', job: created };
};
