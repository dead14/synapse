const test = require('node:test');
const assert = require('node:assert/strict');

const {
    normalizeComparisonResult,
    summarizeComparison,
    validateDtwPayload,
    validateTieInTransform,
    validateMatchingSections,
    validateAlignmentReview,
    normalizeAlignmentReviewForPersistence,
    normalizeInterventionEvent,
} = require('../src/modules/alignment/alignmentContract');

test('normalizeComparisonResult preserves an array comparison', () => {
    const rows = [{ status: 'Matched' }];
    assert.deepEqual(normalizeComparisonResult(rows), {
        comparison: rows,
        groups: null,
    });
});

test('normalizeComparisonResult flattens Hungarian buckets in stable order', () => {
    const groups = {
        anomaly_only_new: [{ id: 'new' }],
        gw_locked: [{ id: 'gw' }],
        anomaly_matched: [{ id: 'matched' }],
        ignored_metadata: 'not-an-array',
    };

    const result = normalizeComparisonResult(groups);

    assert.deepEqual(result.comparison.map((row) => row.id), ['gw', 'matched', 'new']);
    assert.equal(result.groups, groups);
});

test('normalizeComparisonResult rejects unsupported engine output', () => {
    assert.throws(
        () => normalizeComparisonResult('bad output'),
        /array or bucket object/i,
    );
});

test('summarizeComparison calculates persisted run metrics', () => {
    const summary = summarizeComparison([
        { 'Match Status': 'Matched' },
        { 'Match Status': 'Only NEW' },
        { status: 'MATCHED' },
    ]);

    assert.deepEqual(summary, {
        total: 3,
        matched: 2,
        unmatched: 1,
        matchRate: 66.7,
        anomaliesFound: 3,
    });
});

test('validateDtwPayload rejects malformed datasets before starting the worker', () => {
    assert.throws(
        () => validateDtwPayload({ oldRun: [], newRun: 'not-an-array' }),
        (error) => error.code === 'INVALID_ALIGNMENT_PAYLOAD',
    );
});

test('validateDtwPayload rejects oversized quadratic input with a controlled code', () => {
    assert.throws(
        () => validateDtwPayload(
            { oldRun: [{}, {}, {}], newRun: [{}, {}, {}] },
            { maxRecords: 10, maxCells: 4 },
        ),
        (error) => error.code === 'DTW_INPUT_TOO_LARGE',
    );
});

test('validateDtwPayload accepts bounded array datasets', () => {
    assert.doesNotThrow(() => validateDtwPayload(
        { oldRun: [{ id: 'o' }], newRun: [{ id: 'n' }] },
        { maxRecords: 2, maxCells: 4 },
    ));
});

test('validateDtwPayload never permits a partial run to fall back to raw odometer matching', () => {
    assert.throws(
        () => validateDtwPayload({
            oldRun: [{ id: 'o' }],
            newRun: [{ id: 'n' }],
            partialRunEnabled: true,
        }),
        (error) => error.code === 'PARTIAL_RUN_TIEIN_REQUIRED',
    );
});

test('validateMatchingSections accepts ordered NEW-reference boundaries', () => {
    const locked = [
        { old_id: 'o1', new_id: 'n1', old_odometer: 0, new_odometer: 1 },
        { old_id: 'o2', new_id: 'n2', old_odometer: 10, new_odometer: 12 },
    ];

    assert.doesNotThrow(() => validateMatchingSections({
        gwMatchesFinal: locked,
        matchingSections: [{
            id: 'main',
            name: 'Main',
            startGwKey: 'o1::n1::0.000000::1.000000',
            endGwKey: 'o2::n2::10.000000::12.000000',
            policy: 'MATCH',
        }],
}));
});

test('validateTieInTransform accepts only bounded accepted monotonic evidence', () => {
    const valid = {
        tieInDecision: { status: 'AUTO_ACCEPTED' },
        tieInTransform: {
            direction: 'OLD_TO_NEW',
            model: 'MONOTONIC_PIECEWISE_LINEAR',
            allowExtrapolation: false,
            domain: { oldStartM: 4, oldEndM: 28 },
            knots: [
                { oldDistanceM: 4, newDistanceM: 100 },
                { oldDistanceM: 16, newDistanceM: 112.2 },
                { oldDistanceM: 28, newDistanceM: 124 },
            ],
        },
    };
    assert.doesNotThrow(() => validateTieInTransform(valid));
    assert.throws(
        () => validateTieInTransform({
            ...valid,
            tieInDecision: { status: 'REVIEW_REQUIRED' },
        }),
        (error) => error.code === 'INVALID_TIEIN_TRANSFORM',
    );
    assert.throws(
        () => validateTieInTransform({
            ...valid,
            tieInTransform: { ...valid.tieInTransform, domain: {} },
        }),
        (error) => error.code === 'INVALID_TIEIN_TRANSFORM',
    );
    assert.throws(
        () => validateTieInTransform({
            ...valid,
            tieInTransform: {
                ...valid.tieInTransform,
                knots: [
                    { oldDistanceM: 4, newDistanceM: 100 },
                    { oldDistanceM: 5, newDistanceM: 103 },
                ],
                domain: { oldStartM: 4, oldEndM: 5 },
            },
        }),
        (error) => error.code === 'INVALID_TIEIN_TRANSFORM',
    );
    assert.throws(
        () => validateTieInTransform({
            ...valid,
            tieInTransform: {
                ...valid.tieInTransform,
                domain: {
                    oldStartM: 4,
                    oldEndM: 28,
                    newStartM: 100,
                    newEndM: 999,
                },
            },
        }),
        (error) => error.code === 'INVALID_TIEIN_TRANSFORM',
    );
});

test('validateMatchingSections accepts an optional partial section', () => {
    const locked = [
        { old_id: 'o1', new_id: 'n1', old_odometer: 0, new_odometer: 1 },
        { old_id: 'o2', new_id: 'n2', old_odometer: 10, new_odometer: 12 },
        { old_id: 'o3', new_id: 'n3', old_odometer: 20, new_odometer: 22 },
    ];

    assert.doesNotThrow(() => validateMatchingSections({
        gwMatchesFinal: locked,
        matchingSections: [{
            id: 'optional-area',
            name: 'Optional area',
            startGwKey: 'o2::n2::10.000000::12.000000',
            endGwKey: 'o3::n3::20.000000::22.000000',
            policy: 'MATCH',
        }],
    }));
});

test('validateMatchingSections rejects overlaps and non-locked boundaries', () => {
    const locked = [
        { old_id: 'o1', new_id: 'n1', old_odometer: 0, new_odometer: 1 },
        { old_id: 'o2', new_id: 'n2', old_odometer: 10, new_odometer: 12 },
        { old_id: 'o3', new_id: 'n3', old_odometer: 20, new_odometer: 22 },
    ];

    assert.throws(() => validateMatchingSections({
        gwMatchesFinal: locked,
        matchingSections: [
            { startGwKey: 'o1::n1::0.000000::1.000000', endGwKey: 'o3::n3::20.000000::22.000000', policy: 'MATCH' },
            { startGwKey: 'o2::n2::10.000000::12.000000', endGwKey: 'missing', policy: 'MATCH' },
        ],
    }), (error) => error.code === 'INVALID_MATCHING_SECTIONS');
});

test('validateMatchingSections rejects GW locks that cross between OLD and NEW', () => {
    const locked = [
        { old_id: 'o1', new_id: 'n1', old_odometer: 10, new_odometer: 1 },
        { old_id: 'o2', new_id: 'n2', old_odometer: 5, new_odometer: 12 },
    ];

    assert.throws(() => validateMatchingSections({
        gwMatchesFinal: locked,
        matchingSections: [{
            name: 'Main',
            startGwKey: 'o1::n1::10.000000::1.000000',
            endGwKey: 'o2::n2::5.000000::12.000000',
            policy: 'MATCH',
        }],
    }), /increase strictly/i);
});

test('validateAlignmentReview permits bounded evidence decisions and rejects malformed persistence input', () => {
    assert.doesNotThrow(() => validateAlignmentReview({
        dataReview: {
            status: 'acknowledged',
            reviewedAt: '2026-07-18T10:00:00.000Z',
            masterFeatureCount: 24,
            historicalFeatureCount: 19,
        },
        gwReview: {
            'old-1::new-1': {
                disposition: 'review',
                note: 'Check tie-in log.',
                reviewedAt: '2026-07-18T10:00:00.000Z',
            },
        },
    }));

    assert.throws(
        () => validateAlignmentReview({ gwReview: { pair: { disposition: 'invented', note: 'x', reviewedAt: 'not-a-date' } } }),
        (error) => error.code === 'INVALID_ALIGNMENT_REVIEW',
    );
    assert.throws(
        () => validateAlignmentReview({
            dataReview: {
                status: 'acknowledged',
                reviewedAt: `${'2026-07-18T10:00:00.000Z'}${' '.repeat(10_000)}`,
                masterFeatureCount: true,
                historicalFeatureCount: '19',
            },
        }),
        (error) => error.code === 'INVALID_ALIGNMENT_REVIEW',
    );
});

test('normalizeAlignmentReviewForPersistence derives trusted review evidence and canonical GW locks', () => {
    const canonicalLocks = [
        { old_id: 'old-1', new_id: 'new-1', old_odometer: 10, new_odometer: 10.5 },
        { old_id: 'old-2', new_id: 'new-2', old_odometer: 20, new_odometer: 21 },
    ];
    const config = {
        dataReview: {
            status: 'acknowledged',
            reviewedAt: '2026-07-18T10:00:00.000Z',
            masterFeatureCount: 999_999,
            historicalFeatureCount: 999_999,
        },
        gwMatchesFinal: [{ old_id: 'forged', new_id: 'pair', old_odometer: 1, new_odometer: 2 }],
        gwReview: {
            'old-1::new-1': { disposition: 'excluded', note: 'Duplicate weld', reviewedAt: '2026-07-18T10:00:00.000Z' },
            'old-2::new-2': { disposition: 'review', note: 'Verify field note', reviewedAt: '2026-07-18T10:00:00.000Z' },
        },
    };

    const normalized = normalizeAlignmentReviewForPersistence(config, {
        featureCounts: { master: 24, historical: 19 },
        canonicalGwLocks: canonicalLocks,
        reviewedAt: '2026-07-18T11:00:00.000Z',
    });

    assert.deepEqual(normalized.dataReview, {
        status: 'acknowledged',
        reviewedAt: '2026-07-18T11:00:00.000Z',
        masterFeatureCount: 24,
        historicalFeatureCount: 19,
    });
    assert.deepEqual(normalized.gwMatchesFinal, [{
        old_id: 'old-2', new_id: 'new-2', old_odometer: 20, new_odometer: 21, type: 'GW', status: 'MATCHED',
    }]);
    assert.equal(normalized.gwReview['old-1::new-1'].reviewedAt, '2026-07-18T11:00:00.000Z');

    assert.throws(
        () => normalizeAlignmentReviewForPersistence({
            gwReview: {
                'forged::pair': { disposition: 'accepted', note: '', reviewedAt: '2026-07-18T10:00:00.000Z' },
            },
        }, { canonicalGwLocks: canonicalLocks }),
        (error) => error.code === 'INVALID_ALIGNMENT_REVIEW',
    );
});

test('normalizeInterventionEvent accepts only auditable NEW-to-OLD reassignments', () => {
    const event = normalizeInterventionEvent({
        id: 'move-1',
        type: 'REASSIGN_NEW',
        sourceNewKey: 'NEW:12',
        targetOldKey: 'OLD:8',
        evidenceScore: 73.5,
    });
    assert.equal(event.type, 'REASSIGN_NEW');
    assert.equal(event.sourceNewKey, 'NEW:12');
    assert.equal(event.targetOldKey, 'OLD:8');
    assert.equal(event.evidenceScore, 73.5);
    assert.match(event.createdAt, /^\d{4}-/);

    assert.throws(
        () => normalizeInterventionEvent({ type: 'REASSIGN_NEW', sourceNewKey: '', targetOldKey: 'OLD:8', evidenceScore: 50 }),
        (error) => error.code === 'INVALID_INTERVENTION',
    );
});
