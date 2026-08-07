const { createHash } = require('crypto');

const ALIGNMENT_ENGINE_VERSION = process.env.ALIGNMENT_ENGINE_VERSION
    || '2026-07-22-hard-tolerances-v6';
const REUSABLE_JOB_STATES = new Set(['queued', 'active', 'retrying', 'completed']);
// Non-terminal states only stay reusable while the row is fresh.  A pending
// row whose worker is gone (Redis flushed, enqueue raced a crash, worker died
// before its final attempt) would otherwise answer 202 for this session
// forever, because nothing ever moves it to a terminal state.
const PENDING_JOB_STATES = new Set(['queued', 'active', 'retrying']);
// A job that has not reached the engine yet can still be dropped: nothing has
// been spawned, so discarding it costs nothing.  An 'active' job owns a running
// Python child that this process cannot stop, so it is left to finish.
const DISCARDABLE_JOB_STATES = new Set(['queued', 'retrying']);
// Session config fields that never reach the engine, so changing one must not
// invalidate a finished run.  resultSummary and failureReason are written by
// the worker; interventions, sections and pipelineRoute are written by the
// reviewer *reading* the result, which meant every exclusion, intervention or
// saved section threw away the very run being reviewed and made the next page
// load re-run the engine from scratch.
//
// matchingSections is deliberately absent: hungarian_engine.py reads it, so it
// genuinely changes the result and must stay in the fingerprint.
const RUNTIME_CONFIG_FIELDS = new Set([
    'resultSummary',
    'failureReason',
    'interventions',
    'sections',
    'pipelineRoute',
]);

function alignmentProcessTimeoutMs(env = process.env) {
    const configured = Number(env.ALIGNMENT_PROCESS_TIMEOUT_MS);
    if (Number.isFinite(configured) && configured > 0) return configured;
    // With one worker slot this ceiling is also how long a wedged run can block
    // every other session, so it is bounded by what a reviewer will wait for
    // rather than by what the engine might conceivably need.
    return 10 * 60 * 1000;
}

function alignmentJobReuseMaxAgeMs(env = process.env) {
    const configured = Number(env.ALIGNMENT_JOB_REUSE_MAX_AGE_MS);
    if (Number.isFinite(configured) && configured > 0) return configured;
    // The bound must comfortably exceed the engine's own per-process timeout,
    // or a legitimately long run would be declared stale while still working.
    return Math.max(30 * 60 * 1000, alignmentProcessTimeoutMs(env) + 10 * 60 * 1000);
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

/**
 * True when a job is still waiting for the engine and its configuration has
 * already been replaced, so nothing will ever read what it produces.  Left in
 * the queue it holds the single worker slot and every reload stacks another run
 * behind it, which is how a session ends up permanently reporting that it is
 * waiting for the alignment worker.
 */
function isSupersededAlignmentJob(job, config, options = {}) {
    if (!job || !DISCARDABLE_JOB_STATES.has(job.state)) return false;
    return !isReusableAlignmentJob(job, config, options);
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
    RUNTIME_CONFIG_FIELDS,
    alignmentConfigFingerprint,
    alignmentJobReuseMaxAgeMs,
    alignmentProcessTimeoutMs,
    buildReusableAlignmentJobResponse,
    isReusableAlignmentJob,
    isSupersededAlignmentJob,
};
