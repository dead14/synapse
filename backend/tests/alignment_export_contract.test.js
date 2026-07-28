const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeAlignmentExportPayload } = require('../src/modules/alignment/exportContract');

test('accepts the additive three-sheet export contract', () => {
    const payload = normalizeAlignmentExportPayload({
        comparison: [{ 'Match/Unmatch': 'Matched' }],
        report: [{ 'Result Group': 'ANOMALY' }],
        pipelineData: {
            pipelineName: 'North Line',
            inspectionRuns: [{ year: '2026', vendor: 'Vendor A', total: 10 }],
        },
    }, { maxRows: 100 });

    assert.equal(payload.comparison.length, 1);
    assert.equal(payload.report.length, 1);
    assert.equal(payload.pipelineData.pipelineName, 'North Line');
});

test('keeps the legacy data-array contract working', () => {
    assert.deepEqual(
        normalizeAlignmentExportPayload({ data: [{ id: 1 }] }, { maxRows: 100 }),
        [{ id: 1 }],
    );
});

test('rejects oversized or non-scalar workbook data', () => {
    assert.throws(
        () => normalizeAlignmentExportPayload({
            comparison: [{ id: 1 }, { id: 2 }],
            report: [],
            pipelineData: {},
        }, { maxRows: 1 }),
        /limited to 1 rows/,
    );
    assert.throws(
        () => normalizeAlignmentExportPayload({
            comparison: [],
            report: [],
            pipelineData: { pipelineName: { nested: true } },
        }, { maxRows: 10 }),
        /scalar values/,
    );
    assert.throws(
        () => normalizeAlignmentExportPayload({
            comparison: [],
            report: [{ physics_warnings: [{ code: 'REVIEW' }] }],
            pipelineData: {},
        }, { maxRows: 10 }),
        /report row fields must contain scalar values/,
    );
});

test('keeps comparison optional so one report payload can feed both data sheets', () => {
    const payload = normalizeAlignmentExportPayload({
        report: [{ 'Match/Unmatch': 'Matched' }],
        pipelineData: {},
    }, { maxRows: 100 });

    assert.equal(payload.comparison, null);
    assert.equal(payload.report.length, 1);
});
