const test = require('node:test');
const assert = require('node:assert/strict');

const {
    ALIGNMENT_ENGINE_VERSION,
    alignmentConfigFingerprint,
    alignmentJobReuseMaxAgeMs,
    alignmentProcessTimeoutMs,
    isReusableAlignmentJob,
    isSupersededAlignmentJob,
} = require('../src/modules/alignment/alignmentExecution');

function jobFor(config, state = 'completed', timestamps = {}) {
    return {
        state,
        ...timestamps,
        result_json: {
            engineVersion: ALIGNMENT_ENGINE_VERSION,
            configFingerprint: alignmentConfigFingerprint(config),
        },
    };
}

test('completed result is reusable only for the exact matching configuration', () => {
    const config = {
        algorithm: 'dtw_hungarian',
        ToleranceConfig: { clock_tolerance: 10, length_tolerance: 50 },
    };

    assert.equal(isReusableAlignmentJob(jobFor(config), config), true);
    assert.equal(isReusableAlignmentJob(jobFor(config), {
        ...config,
        ToleranceConfig: { ...config.ToleranceConfig, clock_tolerance: 15 },
    }), false);
});

test('legacy result without execution metadata is never reused', () => {
    const config = { ToleranceConfig: { clock_tolerance: 10 } };

    assert.equal(isReusableAlignmentJob({ state: 'completed', result_json: {} }, config), false);
});

test('runtime result summary does not invalidate the configuration fingerprint', () => {
    const config = { ToleranceConfig: { clock_tolerance: 10 } };

    assert.equal(
        alignmentConfigFingerprint(config),
        alignmentConfigFingerprint({
            ...config,
            resultSummary: { total: 100, matched: 80 },
            failureReason: 'old failure',
        }),
    );
});

test('failed and stale jobs are never reusable even with matching metadata', () => {
    const config = { ToleranceConfig: { clock_tolerance: 10 } };

    assert.equal(isReusableAlignmentJob(jobFor(config, 'failed'), config), false);
    assert.equal(isReusableAlignmentJob(jobFor(config, 'stale'), config), false);
});

test('pending jobs are reusable only while their row is fresh', () => {
    const config = { ToleranceConfig: { clock_tolerance: 10 } };
    const now = Date.parse('2026-07-26T12:00:00Z');
    const fresh = jobFor(config, 'queued', { created_at: new Date(now - 60_000) });
    const stale = jobFor(config, 'queued', { created_at: new Date(now - 24 * 60 * 60 * 1000) });

    assert.equal(isReusableAlignmentJob(fresh, config, { now, env: {} }), true);
    assert.equal(isReusableAlignmentJob(stale, config, { now, env: {} }), false);
});

test('an active job that keeps reporting progress stays fresh via updated_at', () => {
    const config = { ToleranceConfig: { clock_tolerance: 10 } };
    const now = Date.parse('2026-07-26T12:00:00Z');
    const job = jobFor(config, 'active', {
        created_at: new Date(now - 3 * 60 * 60 * 1000),
        updated_at: new Date(now - 30_000),
    });

    assert.equal(isReusableAlignmentJob(job, config, { now, env: {} }), true);
});

test('a pending job without timestamps cannot prove freshness and is not reused', () => {
    const config = { ToleranceConfig: { clock_tolerance: 10 } };

    assert.equal(isReusableAlignmentJob(jobFor(config, 'queued'), config), false);
});

test('completed results stay reusable regardless of age', () => {
    const config = { ToleranceConfig: { clock_tolerance: 10 } };
    const now = Date.parse('2026-07-26T12:00:00Z');
    const job = jobFor(config, 'completed', {
        created_at: new Date(now - 365 * 24 * 60 * 60 * 1000),
    });

    assert.equal(isReusableAlignmentJob(job, config, { now, env: {} }), true);
});

test('reuse age bound is configurable and always exceeds the engine process timeout', () => {
    assert.equal(alignmentJobReuseMaxAgeMs({ ALIGNMENT_JOB_REUSE_MAX_AGE_MS: '120000' }), 120_000);
    // Default: engine timeout (10 min) plus headroom, floored at 30 min.
    assert.equal(alignmentJobReuseMaxAgeMs({}), 30 * 60 * 1000);
    // A raised engine timeout raises the bound with it.
    assert.equal(
        alignmentJobReuseMaxAgeMs({ ALIGNMENT_PROCESS_TIMEOUT_MS: String(60 * 60 * 1000) }),
        70 * 60 * 1000,
    );
    // A tiny engine timeout never drops the bound below 30 minutes.
    assert.equal(
        alignmentJobReuseMaxAgeMs({ ALIGNMENT_PROCESS_TIMEOUT_MS: '60000' }),
        30 * 60 * 1000,
    );
});

test('engine process timeout is bounded by what a reviewer waits for, and overridable', () => {
    assert.equal(alignmentProcessTimeoutMs({}), 10 * 60 * 1000);
    assert.equal(alignmentProcessTimeoutMs({ ALIGNMENT_PROCESS_TIMEOUT_MS: '90000' }), 90_000);
    // A non-numeric or non-positive override falls back rather than disabling
    // the timeout, which would let one wedged run hold the worker forever.
    assert.equal(alignmentProcessTimeoutMs({ ALIGNMENT_PROCESS_TIMEOUT_MS: '0' }), 10 * 60 * 1000);
    assert.equal(alignmentProcessTimeoutMs({ ALIGNMENT_PROCESS_TIMEOUT_MS: 'soon' }), 10 * 60 * 1000);
});

test('review evidence written after a run does not invalidate that run', () => {
    const config = { ToleranceConfig: { clock_tolerance: 10 } };
    const reviewed = {
        ...config,
        // Recorded by the reviewer while reading the result; the engine never
        // reads any of them, so the result they are reviewing stays valid.
        interventions: [{ id: 'evt-1', type: 'exclusion' }],
        sections: [{ from: 0, to: 1200 }],
        pipelineRoute: [[1.23, 103.4], [1.24, 103.5]],
    };

    assert.equal(alignmentConfigFingerprint(config), alignmentConfigFingerprint(reviewed));
    assert.equal(isReusableAlignmentJob(jobFor(config), reviewed), true);
});

test('matchingSections still invalidates: the engine reads it', () => {
    const config = { ToleranceConfig: { clock_tolerance: 10 } };
    const resectioned = { ...config, matchingSections: [{ from: 0, to: 1200 }] };

    assert.notEqual(alignmentConfigFingerprint(config), alignmentConfigFingerprint(resectioned));
    assert.equal(isReusableAlignmentJob(jobFor(config), resectioned), false);
});

test('only a not-yet-started run whose configuration changed counts as superseded', () => {
    const config = { ToleranceConfig: { clock_tolerance: 10 } };
    const changed = { ToleranceConfig: { clock_tolerance: 15 } };
    const now = Date.parse('2026-08-07T12:00:00Z');
    const at = { created_at: new Date(now - 30_000) };
    const options = { now, env: {} };

    assert.equal(isSupersededAlignmentJob(jobFor(config, 'queued', at), changed, options), true);
    assert.equal(isSupersededAlignmentJob(jobFor(config, 'retrying', at), changed, options), true);
    // Still the configuration this run was queued for: it is reused, not dropped.
    assert.equal(isSupersededAlignmentJob(jobFor(config, 'queued', at), config, options), false);
    // Already handed to a worker: its Python child cannot be stopped from here.
    assert.equal(isSupersededAlignmentJob(jobFor(config, 'active', at), changed, options), false);
    // Terminal rows hold no queue slot and are not the caller's to rewrite.
    assert.equal(isSupersededAlignmentJob(jobFor(config, 'completed', at), changed, options), false);
    assert.equal(isSupersededAlignmentJob(jobFor(config, 'failed', at), changed, options), false);
    assert.equal(isSupersededAlignmentJob(null, changed, options), false);
});
