const test = require('node:test');
const assert = require('node:assert/strict');

const {
    normalizeComparisonResult,
    summarizeComparison,
    validateDtwPayload,
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
