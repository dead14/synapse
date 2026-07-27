const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_HOST ||= '127.0.0.1';
process.env.DB_USER ||= 'test';
process.env.DB_PASSWORD ||= 'test';
process.env.DB_NAME ||= 'test';

const alignmentController = require('../src/modules/alignment/alignmentController');
const { canonicalSignatureForConfig } = require('../src/modules/alignment/alignmentSignature');

function pairState(signature) {
    return {
        ota: 1.5,
        strictPenalty: false,
        useValveAnchor: true,
        dtwOn: true,
        gwReviewSignature: signature,
        gwReview: {
            'old-8::new-9': {
                disposition: 'accepted',
                note: '',
                reviewedAt: '2026-07-27T08:00:00.000Z',
            },
        },
        gwMatchesFinal: [{
            oldId: 'old-8',
            newId: 'new-9',
            oldVal: 80,
            newVal: 90,
        }],
    };
}

test('recovers legacy pair canonical evidence from a matching persisted result', () => {
    const references = { oldRunId: 8, newRunId: 9 };
    const signature = canonicalSignatureForConfig({
        ota: 1.5,
        strictPenalty: false,
        useValveAnchor: true,
        dtwOn: true,
    }, references);
    const persisted = {
        summaryData: {
            runPairs: [{ oldRun: { runId: 8 }, newRun: { runId: 9 } }],
            masterRun: { runId: 9 },
        },
        pairGwResults: { '8->9': pairState(signature) },
    };

    const repaired = alignmentController.recoverLegacyCanonicalGwEvidence(persisted, persisted);

    assert.deepEqual(repaired.pairGwEvidence, {
        '8->9': {
            canonicalGwLocks: [{
                old_id: 'old-8',
                new_id: 'new-9',
                old_odometer: 80,
                new_odometer: 90,
                type: 'GW',
                status: 'MATCHED',
            }],
            gwCanonicalSignature: signature,
        },
    });
    assert.deepEqual(repaired.canonicalGwLocks, repaired.pairGwEvidence['8->9'].canonicalGwLocks);
});

test('recovers pair evidence when production session retained only the root canonical result', () => {
    const references = { oldRunId: 8, newRunId: 9 };
    const signature = canonicalSignatureForConfig({
        ota: 7.8,
        strictPenalty: false,
        useValveAnchor: true,
        dtwOn: true,
        globalOffset: -1875.484,
    }, references);
    const rootState = pairState(signature);
    const persisted = {
        summaryData: {
            runPairs: [{ oldRun: { runId: 8 }, newRun: { runId: 9 } }],
            masterRun: { runId: 9 },
        },
        ota: 7.8,
        strictPenalty: false,
        useValveAnchor: true,
        dtwOn: true,
        globalOffset: -1875.484,
        gwReviewSignature: signature,
        gwReview: rootState.gwReview,
        gwMatchesFinal: rootState.gwMatchesFinal,
        canonicalGwLocks: rootState.gwMatchesFinal,
        gwCanonicalSignature: signature,
        pairGwResults: {},
    };

    const repaired = alignmentController.recoverLegacyCanonicalGwEvidence(persisted, persisted);

    assert.deepEqual(
        repaired.pairGwEvidence?.['8->9']?.canonicalGwLocks,
        [{
            old_id: 'old-8',
            new_id: 'new-9',
            old_odometer: 80,
            new_odometer: 90,
            type: 'GW',
            status: 'MATCHED',
        }],
    );
    assert.deepEqual(repaired.pairGwEvidence['8->9'].gwCanonicalSignature, signature);
});

test('does not attach a root canonical result to a pair after matching settings change', () => {
    const references = { oldRunId: 8, newRunId: 9 };
    const signature = canonicalSignatureForConfig({
        ota: 7.8,
        strictPenalty: false,
        useValveAnchor: true,
        dtwOn: true,
    }, references);
    const rootState = pairState(signature);
    const persisted = {
        summaryData: {
            runPairs: [{ oldRun: { runId: 8 }, newRun: { runId: 9 } }],
            masterRun: { runId: 9 },
        },
        ota: 7.8,
        strictPenalty: false,
        useValveAnchor: true,
        dtwOn: true,
        gwReviewSignature: signature,
        gwReview: rootState.gwReview,
        canonicalGwLocks: rootState.gwMatchesFinal,
        gwCanonicalSignature: signature,
        pairGwResults: {},
    };
    const incoming = { ...persisted, ota: 9.1 };

    const repaired = alignmentController.recoverLegacyCanonicalGwEvidence(incoming, persisted);

    assert.equal(repaired.pairGwEvidence, undefined);
});

test('review normalization keeps canonical pair evidence recovered before save', () => {
    const references = { oldRunId: 8, newRunId: 9 };
    const signature = canonicalSignatureForConfig({
        ota: 7.8,
        strictPenalty: false,
        useValveAnchor: true,
        dtwOn: true,
    }, references);
    const rootState = pairState(signature);
    const persisted = {
        summaryData: {
            runPairs: [{ oldRun: { runId: 8 }, newRun: { runId: 9 } }],
            masterRun: { runId: 9 },
        },
        ota: 7.8,
        strictPenalty: false,
        useValveAnchor: true,
        dtwOn: true,
        gwReviewSignature: signature,
        gwReview: rootState.gwReview,
        canonicalGwLocks: rootState.gwMatchesFinal,
        gwCanonicalSignature: signature,
        pairGwResults: {},
    };
    const recovered = alignmentController.recoverLegacyCanonicalGwEvidence(persisted, persisted);

    const normalized = alignmentController.normalizeRecoveredAlignmentReview(
        recovered,
        persisted,
        { featureCounts: null },
    );

    assert.equal(normalized.pairGwEvidence['8->9'].canonicalGwLocks.length, 1);
});

test('does not recover legacy canonical evidence when matching settings are stale', () => {
    const references = { oldRunId: 8, newRunId: 9 };
    const signature = canonicalSignatureForConfig({
        ota: 1.5,
        strictPenalty: false,
        useValveAnchor: true,
        dtwOn: true,
    }, references);
    const persisted = {
        summaryData: {
            runPairs: [{ oldRun: { runId: 8 }, newRun: { runId: 9 } }],
            masterRun: { runId: 9 },
        },
        pairGwResults: { '8->9': pairState(signature) },
    };
    const incoming = {
        ...persisted,
        pairGwResults: {
            '8->9': { ...pairState(signature), ota: 2.5 },
        },
    };

    const repaired = alignmentController.recoverLegacyCanonicalGwEvidence(incoming, persisted);

    assert.equal(repaired.pairGwEvidence, undefined);
});
