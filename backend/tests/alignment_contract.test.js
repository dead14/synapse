const test = require('node:test');
const assert = require('node:assert/strict');

const {
    normalizeComparisonResult,
    summarizeComparison,
    validateDtwPayload,
    validateMatchingSections,
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
