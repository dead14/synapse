const test = require('node:test');
const assert = require('node:assert/strict');

const {
    canonicalSignature,
    canonicalSignatureForConfig,
} = require('../src/modules/alignment/alignmentSignature');

const references = { oldRunId: 24, newRunId: 26 };
const transform = {
    direction: 'OLD_TO_NEW',
    model: 'MONOTONIC_PIECEWISE_LINEAR',
    allowExtrapolation: false,
    knots: [
        { oldDistanceM: 4.243, newDistanceM: 1868.81 },
        { oldDistanceM: 2095.565, newDistanceM: 3946.498 },
    ],
};

test('canonical partial-run signature ignores the legacy display offset when saving review', () => {
    const matchingSignature = canonicalSignature({
        ota: 1.5,
        strictPenalty: false,
        useValveAnchor: true,
        applyDtwCorrection: true,
        tieInOffset: 0,
        tieInTransform: transform,
        tieInDecision: { status: 'AUTO_ACCEPTED' },
        tieInEvidenceToken: 'accepted-evidence',
        tieInMethodVersion: 'ordered-drift-spans-v3',
        excludedRanges: [],
    }, references);

    const reviewSignature = canonicalSignatureForConfig({
        ota: 1.5,
        strictPenalty: false,
        useValveAnchor: true,
        dtwOn: true,
        globalOffset: -1875.455,
        tieInTransform: transform,
        tieInDecision: { status: 'AUTO_ACCEPTED' },
        tieInEvidenceToken: 'accepted-evidence',
        tieInMethodVersion: 'ordered-drift-spans-v3',
        tieInExcludedRanges: [],
    }, references);

    assert.equal(reviewSignature, matchingSignature);
});

test('legacy scalar alignment still includes its global offset in the signature', () => {
    const zeroOffset = canonicalSignatureForConfig({ globalOffset: 0 }, references);
    const shifted = canonicalSignatureForConfig({ globalOffset: 25 }, references);

    assert.notEqual(shifted, zeroOffset);
});
