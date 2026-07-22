const test = require('node:test');
const assert = require('node:assert/strict');

const {
    ALIGNMENT_ENGINE_VERSION,
    alignmentConfigFingerprint,
    isReusableAlignmentJob,
} = require('../src/modules/alignment/alignmentExecution');

function jobFor(config, state = 'completed') {
    return {
        state,
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
