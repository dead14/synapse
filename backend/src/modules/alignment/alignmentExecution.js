const { createHash } = require('crypto');

const ALIGNMENT_ENGINE_VERSION = process.env.ALIGNMENT_ENGINE_VERSION
    || '2026-07-22-hard-tolerances-v6';
const REUSABLE_JOB_STATES = new Set(['queued', 'active', 'retrying', 'completed']);
// Non-terminal states only stay reusable while the row is fresh.  A pending
// row whose worker is gone (Redis flushed, enqueue raced a crash, worker died
// before its final attempt) would otherwise answer 202 for this session
// forever, because nothing ever moves it to a terminal state.
const PENDING_JOB_STATES = new Set(['queued', 'active', 'retrying']);
const RUNTIME_CONFIG_FIELDS = new Set(['resultSummary', 'failureReason']);

function alignmentJobReuseMaxAgeMs(env = process.env) {
    const configured = Number(env.ALIGNMENT_JOB_REUSE_MAX_AGE_MS);
    if (Number.isFinite(configured) && configured > 0) return configured;
    // The bound must comfortably exceed the engine's own per-process timeout,
    // or a legitimately long run would be declared stale while still working.
    const processTimeoutMs = Number(env.ALIGNMENT_PROCESS_TIMEOUT_MS) || 30 * 60 * 1000;
    return Math.max(30 * 60 * 1000, processTimeoutMs + 10 * 60 * 1000);
}

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

function jobFreshnessTimestamp(job) {
    // updated_at refreshes on every progress update, so an active job that is
    // still reporting progress keeps itself fresh while a wedged one ages out.
    const stamp = job?.updated_at || job?.created_at;
    if (!stamp) return null;
    const parsed = stamp instanceof Date ? stamp.getTime() : Date.parse(stamp);
    return Number.isFinite(parsed) ? parsed : null;
}

function isReusableAlignmentJob(job, config, { now = Date.now(), env = process.env } = {}) {
    if (!job || !REUSABLE_JOB_STATES.has(job.state)) return false;
    if (PENDING_JOB_STATES.has(job.state)) {
        const freshestAt = jobFreshnessTimestamp(job);
        if (freshestAt === null || now - freshestAt > alignmentJobReuseMaxAgeMs(env)) return false;
    }
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
    alignmentJobReuseMaxAgeMs,
    buildReusableAlignmentJobResponse,
    isReusableAlignmentJob,
};
