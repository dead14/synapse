const test = require('node:test');
const assert = require('node:assert/strict');

const {
    ALIGNMENT_ENGINE_VERSION,
    alignmentConfigFingerprint,
    alignmentJobReuseMaxAgeMs,
    isReusableAlignmentJob,
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
    // Default: engine timeout (30 min) plus headroom.
    assert.equal(alignmentJobReuseMaxAgeMs({}), 40 * 60 * 1000);
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
