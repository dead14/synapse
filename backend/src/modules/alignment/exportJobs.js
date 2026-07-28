const { randomUUID } = require('crypto');
const metrics = require('../../observability/metrics');

const EXPORT_JOB_TTL_MS = Number(process.env.EXPORT_JOB_TTL_MS) || 30 * 60 * 1000;
const MAX_RETAINED_EXPORT_JOBS = Number(process.env.MAX_RETAINED_EXPORT_JOBS) || 10;
const MAX_USER_EXPORT_JOBS = Number(process.env.MAX_USER_EXPORT_JOBS) || 2;
const PUBLIC_ERROR_CODES = new Set([
    'EXPORT_BUSY',
    'EXPORT_FAILED',
    'EXPORT_TIMEOUT',
    'EXPORT_TOO_LARGE',
]);
const jobs = new Map();

function exportError(message, code) {
    const error = new Error(message);
    error.code = code;
    return error;
}

function occupiesRetainedSlot(job) {
    return job.state === 'processing'
        || job.state === 'ready'
        || job.state === 'downloading';
}

function rowCountBucket(rowCount) {
    if (rowCount <= 10_000) return 'up_to_10k';
    if (rowCount <= 100_000) return '10k_to_100k';
    if (rowCount <= 250_000) return '100k_to_250k';
    return '250k_to_500k';
}

function serialize(job) {
    return {
        exportId: job.exportId,
        state: job.state,
        rowCount: job.rowCount,
        progress: job.progress,
        message: job.message,
        error: job.error,
        code: job.code,
    };
}

function ownedJob(exportId, orgId, userId) {
    const job = jobs.get(exportId);
    if (!job || job.orgId !== orgId || job.userId !== userId) return null;
    return job;
}

async function removeJob(exportId) {
    const job = jobs.get(exportId);
    if (!job) return;
    jobs.delete(exportId);
    if (job.expiryTimer) clearTimeout(job.expiryTimer);
    await job.output?.release?.();
}

function scheduleExpiry(job) {
    job.expiryTimer = setTimeout(() => {
        void removeJob(job.exportId);
    }, EXPORT_JOB_TTL_MS);
    job.expiryTimer.unref?.();
}

function startExportJob({ orgId, userId, rowCount, run }) {
    const retainedJobs = [...jobs.values()].filter(occupiesRetainedSlot);
    const userRetainedJobs = retainedJobs.filter(
        (job) => job.orgId === orgId && job.userId === userId,
    );
    if (
        retainedJobs.length >= MAX_RETAINED_EXPORT_JOBS
        || userRetainedJobs.length >= MAX_USER_EXPORT_JOBS
    ) {
        throw exportError(
            'Too many pending exports. Download an existing export or retry shortly.',
            'EXPORT_BUSY',
        );
    }

    const exportId = randomUUID();
    const job = {
        exportId,
        orgId,
        userId,
        rowCount,
        state: 'processing',
        progress: 1,
        message: 'Queued for export',
        error: null,
        code: null,
        output: null,
        expiryTimer: null,
    };
    jobs.set(exportId, job);
    const startedAt = performance.now();

    const reportProgress = (progress, message) => {
        if (job.state !== 'processing') return;
        const numeric = Number(progress);
        if (Number.isFinite(numeric)) {
            job.progress = Math.max(
                job.progress,
                Math.min(99, Math.max(1, Math.round(numeric))),
            );
        }
        if (typeof message === 'string' && message.trim()) {
            job.message = message.trim().slice(0, 100);
        }
    };

    Promise.resolve()
        .then(() => run(reportProgress))
        .then((output) => {
            job.output = output;
            job.state = 'ready';
            job.progress = 100;
            job.message = 'Ready to download';
            metrics.observe('alignment_excel_export_job', performance.now() - startedAt, {
                status: 'ready',
                rows: rowCountBucket(rowCount),
            });
            scheduleExpiry(job);
        })
        .catch((error) => {
            const code = PUBLIC_ERROR_CODES.has(String(error?.code))
                ? String(error.code)
                : 'EXPORT_FAILED';
            if (code === 'EXPORT_FAILED' && error?.code !== 'EXPORT_FAILED') {
                console.error('Background Excel export failed:', error?.message || error);
            }
            job.state = 'failed';
            job.message = 'Export failed';
            job.error = code === 'EXPORT_FAILED'
                ? 'Failed to generate Excel file'
                : String(error?.message || 'Excel export failed').slice(0, 200);
            job.code = code;
            metrics.observe('alignment_excel_export_job', performance.now() - startedAt, {
                status: 'failed',
                rows: rowCountBucket(rowCount),
            });
            scheduleExpiry(job);
        });

    return serialize(job);
}

function getOwnedExportJob(exportId, orgId, userId) {
    const job = ownedJob(exportId, orgId, userId);
    return job ? serialize(job) : null;
}

function claimOwnedExportDownload(exportId, orgId, userId) {
    const job = ownedJob(exportId, orgId, userId);
    if (!job || job.state !== 'ready' || !job.output) return null;
    job.state = 'downloading';
    if (job.expiryTimer) clearTimeout(job.expiryTimer);
    scheduleExpiry(job);
    return job.output;
}

async function finishExportDownload(exportId) {
    await removeJob(exportId);
}

module.exports = {
    claimOwnedExportDownload,
    finishExportDownload,
    getOwnedExportJob,
    startExportJob,
};
