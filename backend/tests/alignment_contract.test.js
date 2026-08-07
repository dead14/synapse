const test = require('node:test');
const assert = require('node:assert/strict');

const {
    comparisonRowDistance,
    normalizeComparisonResult,
    sortComparisonByDistance,
    summarizeComparison,
    validateDtwPayload,
    validateTieInTransform,
    validateMatchingSections,
    validateAlignmentReview,
    sameGwReviewDecisions,
    normalizeAlignmentReviewForPersistence,
    normalizeInterventionEvent,
    preserveCanonicalGwEvidence,
} = require('../src/modules/alignment/alignmentContract');

test('sameGwReviewDecisions ignores persistence timestamps but detects changed decisions', () => {
    const persisted = {
        'OLD-1::NEW-1': {
            disposition: 'accepted',
            note: 'verified in field',
            reviewedAt: '2026-07-27T04:00:00.000Z',
        },
    };
    const resavedFromSectioning = {
        'OLD-1::NEW-1': {
            disposition: 'accepted',
            note: 'verified in field',
            reviewedAt: '2026-07-27T05:00:00.000Z',
        },
    };

    assert.equal(sameGwReviewDecisions(resavedFromSectioning, persisted), true);
    assert.equal(sameGwReviewDecisions({
        ...resavedFromSectioning,
        'OLD-1::NEW-1': { ...resavedFromSectioning['OLD-1::NEW-1'], disposition: 'excluded' },
    }, persisted), false);
});

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

test('normalizeComparisonResult orders the flattened buckets along the line', () => {
    // The engine emits GW first, then matched anomalies, then the rest. Read in
    // that order the exported workbook is a list of feature classes, not a walk
    // down the pipeline.
    const groups = {
        gw_locked: [
            { id: 'gw-far', 'Log Dist NEW (m)': 900 },
            { id: 'gw-near', 'Log Dist NEW (m)': 100 },
        ],
        anomaly_matched: [{ id: 'ml-mid', 'Log Dist NEW (m)': 500 }],
        bypassed_new: [{ id: 'bend', 'Log Dist NEW (m)': 300 }],
    };

    const result = normalizeComparisonResult(groups);

    assert.deepEqual(
        result.comparison.map((row) => row.id),
        ['gw-near', 'bend', 'ml-mid', 'gw-far'],
    );
    assert.equal(result.groups, groups, 'the engine buckets stay untouched for the audit');
});

test('an OLD-only row is placed by its own odometer, not dropped to the start', () => {
    const result = normalizeComparisonResult({
        anomaly_matched: [
            { id: 'a', 'Log Dist NEW (m)': 100 },
            { id: 'c', 'Log Dist NEW (m)': 900 },
        ],
        anomaly_only_old: [{ id: 'b', 'Log Dist NEW (m)': '-', 'Log Dist OLD (m)': 500 }],
    });

    assert.deepEqual(result.comparison.map((row) => row.id), ['a', 'b', 'c']);
});

test('a row reporting no distance at all sinks to the end rather than to KP 0', () => {
    const ordered = sortComparisonByDistance([
        { id: 'no-distance' },
        { id: 'far', 'Log Dist NEW (m)': 4000 },
        { id: 'dash', 'Log Dist NEW (m)': '-', 'Log Dist OLD (m)': '-' },
        { id: 'near', 'Log Dist NEW (m)': 12 },
    ]);

    assert.deepEqual(ordered.map((row) => row.id), ['near', 'far', 'no-distance', 'dash']);
});

test('rows sharing a distance keep the order the engine emitted them in', () => {
    const ordered = sortComparisonByDistance([
        { id: 'first', 'Log Dist NEW (m)': 250 },
        { id: 'second', 'Log Dist NEW (m)': 250 },
        { id: 'third', 'Log Dist NEW (m)': 250 },
    ]);

    assert.deepEqual(ordered.map((row) => row.id), ['first', 'second', 'third']);
});

test('comparisonRowDistance prefers the NEW odometer and reads the absolute fallback', () => {
    assert.equal(comparisonRowDistance({ 'Log Dist NEW (m)': '1234.5' }), 1234.5);
    assert.equal(
        comparisonRowDistance({ 'Log Dist NEW (m)': '-', 'Abs. Dist NEW (m)': 77 }),
        77,
        'the absolute NEW column stands in when the log column is blank',
    );
    assert.equal(
        comparisonRowDistance({ 'Log Dist NEW (m)': 10, 'Log Dist OLD (m)': 999 }),
        10,
        'the table is read against the NEW run, so its odometer wins',
    );
    assert.equal(comparisonRowDistance({ 'Log Dist NEW (m)': 'n/a' }), null);
    assert.equal(comparisonRowDistance(null), null);
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
        // The one-run-only split is what the dashboard reads; it used to come
        // from a table the engine never writes.
        onlyOld: 0,
        onlyNew: 1,
        matchRate: 66.7,
        anomaliesFound: 3,
    });
});

test('summarizeComparison splits unmatched anomalies by the run they came from', () => {
    const summary = summarizeComparison([
        { 'Match Status': 'Matched' },
        { 'Match Status': 'Only OLD' },
        { 'Match Status': 'Only OLD' },
        { 'Match Status': 'Only NEW' },
        { 'Result Group': 'GW', 'Match Status': 'ONLY_OLD' },
    ]);

    assert.equal(summary.onlyOld, 2);
    assert.equal(summary.onlyNew, 1);
    assert.equal(summary.onlyOld + summary.onlyNew, summary.unmatched);
});

test('summarizeComparison counts only anomaly rows as anomalies', () => {
    const summary = summarizeComparison([
        { 'Result Group': 'GW', 'Match Status': 'Matched' },
        { 'Result Group': 'GW', 'Match Status': 'ONLY_OLD' },
        { 'Result Group': 'ANOMALY', 'Match Status': 'Matched' },
        { 'Result Group': 'ANOMALY', 'Match Status': 'Only NEW' },
        { 'Result Group': 'BYPASSED', 'Match Status': 'Bypassed OLD' },
        { 'Result Group': 'FILTERED', 'Match Status': 'Filtered NEW' },
    ]);

    // Every row is still conserved in `total`...
    assert.equal(summary.total, 6);
    // ...but GW locks, bypasses and filtered rows are not anomalies, and the
    // match rate is computed over anomaly candidates only (1 of 2), not 2 of 6.
    assert.equal(summary.anomaliesFound, 2);
    assert.equal(summary.matched, 1);
    assert.equal(summary.unmatched, 1);
    assert.equal(summary.matchRate, 50);
});

test('summarizeComparison reports a zero match rate for an empty anomaly set', () => {
    const summary = summarizeComparison([
        { 'Result Group': 'GW', 'Match Status': 'Matched' },
        { 'Result Group': 'BYPASSED', 'Match Status': 'Bypassed OLD' },
    ]);

    assert.equal(summary.total, 2);
    assert.equal(summary.anomaliesFound, 0);
    assert.equal(summary.matchRate, 0);
});

test('validateDtwPayload rejects malformed datasets before starting the worker', () => {
    assert.throws(
        () => validateDtwPayload({ oldRun: [], newRun: 'not-an-array' }),
        (error) => error.code === 'INVALID_ALIGNMENT_PAYLOAD',
    );
});

test('validateDtwPayload rejects a run with no anchors instead of reporting zero matches', () => {
    // The size guard is only an upper bound, so an empty run used to satisfy it
    // and reach the engine.  The response was a truthful "zero matches", which
    // the timeline renders exactly like a matcher that never ran.
    const anchor = { dist: 10 };
    for (const payload of [
        { oldRun: [], newRun: [anchor] },
        { oldRun: [anchor], newRun: [] },
        { oldRun: [], newRun: [] },
    ]) {
        assert.throws(
            () => validateDtwPayload(payload),
            (error) => error.code === 'NO_ALIGNMENT_ANCHORS',
        );
    }
});

test('validateDtwPayload accepts a single anchor in each run', () => {
    assert.doesNotThrow(() => validateDtwPayload({ oldRun: [{ dist: 1 }], newRun: [{ dist: 2 }] }));
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
    assert.doesNotThrow(
        () => validateTieInTransform({
            ...valid,
            tieInDecision: {
                status: 'REVIEW_ACKNOWLEDGED',
                originalStatus: 'REVIEW_REQUIRED',
                requiresHumanReview: true,
                acknowledgedBy: 42,
            },
        }),
    );
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

test('validateMatchingSections accepts explicit side-qualified unmatched GW boundaries', () => {
    const locked = [
        { old_id: 'o1', new_id: 'n1', old_odometer: 0, new_odometer: 1 },
        { old_id: 'o2', new_id: 'n2', old_odometer: 10, new_odometer: 12 },
        { old_id: 'o3', new_id: 'n3', old_odometer: 20, new_odometer: 23 },
    ];

    assert.doesNotThrow(() => validateMatchingSections({
        gwMatchesFinal: locked,
        matchingSections: [{
            id: 'tie-in',
            name: 'Tie-in',
            startGwKey: 'UNMATCHED::NEW::nx::6.000000',
            endGwKey: 'UNMATCHED::OLD::ox::15.000000',
            startBoundary: {
                key: 'UNMATCHED::NEW::nx::6.000000',
                side: 'NEW',
                label: 'nx',
                oldId: null,
                newId: 'nx',
                oldDistance: 4.545454545454545,
                newDistance: 6,
                sourceDistance: 6,
            },
            endBoundary: {
                key: 'UNMATCHED::OLD::ox::15.000000',
                side: 'OLD',
                label: 'ox',
                oldId: 'ox',
                newId: null,
                oldDistance: 15,
                newDistance: 17.5,
                sourceDistance: 15,
            },
            policy: 'MATCH',
        }],
    }));
});

test('validateMatchingSections rejects a tampered unmatched boundary projection', () => {
    const locked = [
        { old_id: 'o1', new_id: 'n1', old_odometer: 0, new_odometer: 1 },
        { old_id: 'o2', new_id: 'n2', old_odometer: 10, new_odometer: 12 },
    ];
    const boundary = {
        key: 'UNMATCHED::NEW::nx::6.000000',
        side: 'NEW',
        label: 'nx',
        oldId: null,
        newId: 'nx',
        oldDistance: 999,
        newDistance: 6,
        sourceDistance: 6,
    };

    assert.throws(() => validateMatchingSections({
        gwMatchesFinal: locked,
        matchingSections: [{
            name: 'Tampered',
            startGwKey: boundary.key,
            endGwKey: 'o2::n2::10.000000::12.000000',
            startBoundary: boundary,
            policy: 'MATCH',
        }],
    }), (error) => error.code === 'INVALID_MATCHING_SECTIONS');
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

test('preserveCanonicalGwEvidence keeps server-owned pair locks across wizard saves', () => {
    const persisted = {
        pairGwEvidence: {
            '8->9': {
                canonicalGwLocks: [{ old_id: 'old-8', new_id: 'new-9' }],
                gwCanonicalSignature: 'server-signature',
            },
        },
        canonicalGwLocks: [{ old_id: 'primary-old', new_id: 'primary-new' }],
        gwCanonicalSignature: 'primary-signature',
    };
    const incoming = {
        pairGwResults: { '8->9': { gwReview: {} } },
        pairGwEvidence: { '8->9': { canonicalGwLocks: [{ old_id: 'forged', new_id: 'forged' }] } },
    };

    assert.deepEqual(preserveCanonicalGwEvidence(incoming, persisted), {
        ...incoming,
        pairGwEvidence: persisted.pairGwEvidence,
        canonicalGwLocks: persisted.canonicalGwLocks,
        gwCanonicalSignature: persisted.gwCanonicalSignature,
    });
});

test('normalizeInterventionEvent accepts auditable reassignments and result exclusions', () => {
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

    const single = normalizeInterventionEvent({
        id: 'exclude-1',
        type: 'EXCLUDE_FEATURE',
        side: 'old',
        pairIndex: 1,
        sourceKey: 'OLD:12',
    });
    assert.equal(single.id, 'exclude-1');
    assert.equal(single.type, 'EXCLUDE_FEATURE');
    assert.equal(single.side, 'OLD');
    assert.equal(single.pairIndex, 1);
    assert.equal(single.sourceKey, 'OLD:12');
    assert.match(single.createdAt, /^\d{4}-/);

    const range = normalizeInterventionEvent({
        id: 'range-1',
        type: 'EXCLUDE_RANGE',
        side: 'NEW',
        pairIndex: 2,
        startSourceKey: 'NEW:A',
        endSourceKey: 'NEW:X',
    });
    assert.equal(range.startSourceKey, 'NEW:A');
    assert.equal(range.endSourceKey, 'NEW:X');
    assert.equal(range.pairIndex, 2);

    const restore = normalizeInterventionEvent({
        id: 'restore-1',
        type: 'RESTORE_EXCLUSION',
        exclusionId: 'range-1',
    });
    assert.equal(restore.exclusionId, 'range-1');

    assert.throws(
        () => normalizeInterventionEvent({ type: 'REASSIGN_NEW', sourceNewKey: '', targetOldKey: 'OLD:8', evidenceScore: 50 }),
        (error) => error.code === 'INVALID_INTERVENTION',
    );
    assert.throws(
        () => normalizeInterventionEvent({ type: 'EXCLUDE_FEATURE', side: 'BOTH', sourceKey: 'OLD:8' }),
        (error) => error.code === 'INVALID_INTERVENTION',
    );
    assert.throws(
        () => normalizeInterventionEvent({
            type: 'EXCLUDE_RANGE',
            side: 'OLD',
            pairIndex: -1,
            startSourceKey: 'OLD:A',
            endSourceKey: 'OLD:X',
        }),
        (error) => error.code === 'INVALID_INTERVENTION',
    );
    assert.throws(
        () => normalizeInterventionEvent({ type: 'RESTORE_EXCLUSION', exclusionId: '' }),
        (error) => error.code === 'INVALID_INTERVENTION',
    );
});
