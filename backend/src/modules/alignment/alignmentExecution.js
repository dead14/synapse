const { createHash } = require('crypto');

const ALIGNMENT_ENGINE_VERSION = process.env.ALIGNMENT_ENGINE_VERSION
    || '2026-07-22-hard-tolerances-v6';
const REUSABLE_JOB_STATES = new Set(['queued', 'active', 'retrying', 'completed']);
const RUNTIME_CONFIG_FIELDS = new Set(['resultSummary', 'failureReason']);

function canonicalize(value) {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(
        Object.keys(value)
            .sort()
            .map((key) => [key, canonicalize(value[key])]),
    );
}

function alignmentConfigFingerprint(config) {
    const matchingConfig = Object.fromEntries(
        Object.entries(config || {}).filter(([key]) => !RUNTIME_CONFIG_FIELDS.has(key)),
    );
    return createHash('sha256')
        .update(JSON.stringify(canonicalize(matchingConfig)))
        .digest('hex');
}

function jobExecutionMetadata(job) {
    const stored = job?.result_json;
    if (!stored) return null;
    if (typeof stored === 'object') return stored;
    try {
        return JSON.parse(stored);
    } catch (_error) {
        return null;
    }
}

function isReusableAlignmentJob(job, config) {
    if (!job || !REUSABLE_JOB_STATES.has(job.state)) return false;
    const metadata = jobExecutionMetadata(job);
    return metadata?.engineVersion === ALIGNMENT_ENGINE_VERSION
        && metadata?.configFingerprint === alignmentConfigFingerprint(config);
}

function buildReusableAlignmentJobResponse(job) {
    const metadata = jobExecutionMetadata(job);
    const response = {
        jobId: job.job_id,
        state: job.state,
        progress: Number(job.progress || 0),
    };
    const audit = metadata?.groups?.audit;
    if (job.state === 'completed' && audit) {
        response.groups = { audit };
    }
    return response;
}

module.exports = {
    ALIGNMENT_ENGINE_VERSION,
    alignmentConfigFingerprint,
    buildReusableAlignmentJobResponse,
    isReusableAlignmentJob,
};
