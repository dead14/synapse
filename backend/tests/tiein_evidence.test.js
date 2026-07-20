const test = require('node:test');
const assert = require('node:assert/strict');

const {
    buildTieInEvidence,
    signTieInEvidence,
    verifyTieInEvidence,
} = require('../src/modules/alignment/tieInEvidence');

const evidence = {
    organizationId: 22,
    decision: { status: 'AUTO_ACCEPTED' },
    transform: {
        direction: 'OLD_TO_NEW',
        model: 'MONOTONIC_PIECEWISE_LINEAR',
        knots: [
            { oldDistanceM: 4, newDistanceM: 100 },
            { oldDistanceM: 16, newDistanceM: 112 },
        ],
    },
};

test('tie-in evidence is organization-bound and tamper evident', () => {
    const secret = 'test-secret-at-least-thirty-two-characters';
    const token = signTieInEvidence(evidence, secret);

    assert.equal(verifyTieInEvidence(evidence, token, secret), true);
    assert.equal(verifyTieInEvidence({ ...evidence, organizationId: 23 }, token, secret), false);
    assert.equal(verifyTieInEvidence({
        ...evidence,
        transform: { ...evidence.transform, knots: [{ oldDistanceM: 4, newDistanceM: 999 }] },
    }, token, secret), false);
});

test('tie-in evidence cannot be replayed against another run pair or exclusions', () => {
    const secret = 'test-secret-at-least-thirty-two-characters';
    const payload = {
        oldRunId: 10,
        newRunId: 20,
        tieInDecision: evidence.decision,
        tieInTransform: evidence.transform,
        tieInMethodVersion: 'ordered-local-spans-v1',
        excludedRanges: [{ run: 'OLD', startM: 0, endM: 4 }],
    };
    const signedEvidence = buildTieInEvidence(payload, 22);
    const token = signTieInEvidence(signedEvidence, secret);

    assert.equal(verifyTieInEvidence(signedEvidence, token, secret), true);
    assert.equal(verifyTieInEvidence(buildTieInEvidence({
        ...payload,
        oldRunId: 11,
    }, 22), token, secret), false);
    assert.equal(verifyTieInEvidence(buildTieInEvidence({
        ...payload,
        excludedRanges: [],
    }, 22), token, secret), false);
});
