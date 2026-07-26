const test = require('node:test');
const assert = require('node:assert/strict');

const {
    parseCreateFieldMeasurement,
    parseFieldMeasurementListQuery,
} = require('../src/modules/fieldMeasurements/fieldMeasurementContract');
const {
    createOwnedFieldMeasurement,
    listOwnedFieldMeasurements,
} = require('../src/modules/fieldMeasurements/fieldMeasurementRepository');

test('field measurement contract requires a measured value and source evidence', () => {
    const parsed = parseCreateFieldMeasurement({
        integrityCaseId: 12,
        measurementType: 'NDE',
        observedAt: '2026-07-18',
        depthPct: 18.5,
        depthUncertaintyPct: 2.5,
        chainageM: 125.5,
        sourceReference: 'dig-12-nde.csv',
        sourceRow: 18,
    });

    assert.equal(parsed.depthPct, 18.5);
    assert.equal(parsed.depthMm, null);
    assert.equal(parsed.sourceRow, 18);
    assert.throws(() => parseCreateFieldMeasurement({
        integrityCaseId: 12,
        measurementType: 'NDE',
        observedAt: '2026-07-18',
        sourceReference: 'dig-12-nde.csv',
    }), /depthPct or depthMm/i);
    assert.throws(() => parseCreateFieldMeasurement({
        integrityCaseId: 12,
        measurementType: 'NDE',
        observedAt: '2026-07-18',
        depthPct: 101,
        sourceReference: 'dig-12-nde.csv',
    }), /depthPct/i);
    assert.throws(() => parseCreateFieldMeasurement({
        measurementType: 'NDE',
        observedAt: '2026-07-18',
        depthPct: 20,
        sourceReference: 'dig-12-nde.csv',
    }), /integrityCaseId/i);
});

test('field measurement list query is bounded and uses an opaque positive id cursor', () => {
    assert.deepEqual(parseFieldMeasurementListQuery({}), { limit: 50, beforeId: null, integrityCaseId: null });
    assert.deepEqual(parseFieldMeasurementListQuery({ limit: '75', cursor: '90', integrityCaseId: '12' }), {
        limit: 75,
        beforeId: 90,
        integrityCaseId: 12,
    });
    assert.throws(() => parseFieldMeasurementListQuery({ limit: '201' }), /between 1 and 200/i);
});

test('field measurement repository enforces ownership for creation and listing', async () => {
    const calls = [];
    const pool = {
        async query(sql, values) {
            calls.push({ sql, values });
            return { rows: [{ id: 9 }, { id: 8 }, { id: 7 }] };
        },
    };
    const input = parseCreateFieldMeasurement({
        integrityCaseId: 12,
        measurementType: 'NDE',
        observedAt: '2026-07-18',
        depthMm: 2.5,
        sourceReference: 'dig-12-nde.csv',
    });

    await createOwnedFieldMeasurement(pool, 7, 5, input);
    const page = await listOwnedFieldMeasurements(pool, 7, {
        limit: 2,
        beforeId: 10,
        integrityCaseId: 12,
    });

    assert.match(calls[0].sql, /c\.organization_id = \$1/);
    assert.match(calls[0].sql, /survey_run_id/);
    assert.match(calls[1].sql, /fm\.organization_id = \$1/);
    assert.match(calls[1].sql, /fm\.integrity_case_id = \$3/);
    assert.deepEqual(calls[1].values, [7, 10, 12, 3]);
    assert.equal(page.rows.length, 2);
    assert.equal(page.nextCursor, 8);
});
