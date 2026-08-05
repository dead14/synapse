import assert from 'node:assert/strict';
import test from 'node:test';

import { processAllRows, processRow } from '../src/lib/ffs/calcEngine.ts';
import { FfsInputValidationError } from '../src/lib/ffs/inputValidation.ts';
import { REQUIRED_COLUMNS, type FfsConfig } from '../src/lib/ffs/types.ts';
import { validateData } from '../src/lib/ffs/validation.ts';

function validRow(overrides: Record<string, string> = {}) {
  return {
    [REQUIRED_COLUMNS[0]]: '100.5',
    [REQUIRED_COLUMNS[1]]: 'Joint-1',
    [REQUIRED_COLUMNS[2]]: 'Internal',
    [REQUIRED_COLUMNS[3]]: '20',
    [REQUIRED_COLUMNS[4]]: '100',
    [REQUIRED_COLUMNS[5]]: '30',
    [REQUIRED_COLUMNS[6]]: '6:00',
    [REQUIRED_COLUMNS[7]]: '10',
    [REQUIRED_COLUMNS[8]]: '0',
    [REQUIRED_COLUMNS[9]]: '0',
    [REQUIRED_COLUMNS[10]]: '0.72',
    [REQUIRED_COLUMNS[11]]: '500',
    [REQUIRED_COLUMNS[12]]: '400',
    [REQUIRED_COLUMNS[13]]: '5',
    ...overrides,
  };
}

const config: FfsConfig = {
  lineName: 'Line A',
  method: 'original',
  modifiedSa: 'smys69',
  iliDate: new Date('2026-01-01T00:00:00.000Z'),
  highlightYears: 5,
};

test('accepts finite domain inputs including zero depth and zero growth rates', () => {
  const row = validRow({ [REQUIRED_COLUMNS[3]]: '0' });
  assert.deepEqual(validateData([row]), []);

  const result = processRow(row, config);
  assert.equal(result.maxDepthPct, 0);
  assert.equal(result.crDepth, 0);
  assert.equal(result.crLength, 0);
  assert.ok(Number.isFinite(result.ERF));
  assert.ok(Number.isFinite(result.safePressure));
});

test('rejects partial numbers, NaN, and Infinity instead of parseFloat coercion', () => {
  const rows = [
    validRow({ [REQUIRED_COLUMNS[4]]: '12mm' }),
    validRow({ [REQUIRED_COLUMNS[12]]: 'NaN' }),
    validRow({ [REQUIRED_COLUMNS[13]]: 'Infinity' }),
  ];
  const errors = validateData(rows);

  assert.equal(errors.length, 3);
  assert.deepEqual(errors.map((error) => error.col), [
    REQUIRED_COLUMNS[4],
    REQUIRED_COLUMNS[12],
    REQUIRED_COLUMNS[13],
  ]);
  assert.ok(errors.every((error) => /finite number/i.test(error.msg)));
});

test('rejects zero, negative, and out-of-domain engineering inputs', () => {
  const row = validRow({
    [REQUIRED_COLUMNS[0]]: '-1',
    [REQUIRED_COLUMNS[3]]: '100',
    [REQUIRED_COLUMNS[4]]: '0',
    [REQUIRED_COLUMNS[5]]: '0',
    [REQUIRED_COLUMNS[7]]: '10',
    [REQUIRED_COLUMNS[8]]: '-0.1',
    [REQUIRED_COLUMNS[9]]: '-0.1',
    [REQUIRED_COLUMNS[10]]: '1.01',
    [REQUIRED_COLUMNS[11]]: '20',
    [REQUIRED_COLUMNS[12]]: '0',
    [REQUIRED_COLUMNS[13]]: '0',
  });
  const errorColumns = new Set(validateData([row]).map((error) => error.col));

  for (const column of [
    REQUIRED_COLUMNS[0], REQUIRED_COLUMNS[3], REQUIRED_COLUMNS[4], REQUIRED_COLUMNS[5],
    REQUIRED_COLUMNS[8], REQUIRED_COLUMNS[9], REQUIRED_COLUMNS[10], REQUIRED_COLUMNS[11],
    REQUIRED_COLUMNS[12], REQUIRED_COLUMNS[13],
  ]) {
    assert.ok(errorColumns.has(column), `missing validation error for ${column}`);
  }
});

test('accepts deep metal loss below full-wall penetration for Level 1 calculation', () => {
  const row = validRow({ [REQUIRED_COLUMNS[3]]: '92' });
  assert.deepEqual(validateData([row]), []);
  const result = processRow(row, config);
  assert.ok(Number.isFinite(result.ERF));
  assert.equal(result.deepMetalLossReviewRequired, true);
});

test('does not use 80% as a universal Level 1 acceptance cutoff', () => {
  const row = validRow({ [REQUIRED_COLUMNS[3]]: '80' });
  assert.deepEqual(validateData([row]), []);

  const result = processRow(row, config);
  assert.equal(result.deepMetalLossReviewRequired, false);
  assert.equal(result.acceptance, result.ERF < 1 ? 'Acceptable' : 'Un-Acceptable');
  assert.notEqual(result.remnantLife.governingLimit, 'Wall penetration');
  assert.ok(Number.isFinite(result.ERF));
});

test('processRow and processAllRows fail closed for invalid inputs', async () => {
  const invalid = validRow({ [REQUIRED_COLUMNS[7]]: '0' });

  assert.throws(() => processRow(invalid, config), FfsInputValidationError);
  await assert.rejects(processAllRows([invalid], config), FfsInputValidationError);
});

test('rejects invalid runtime configuration values', () => {
  const invalidConfig = { ...config, iliDate: new Date('invalid') };
  assert.throws(() => processRow(validRow(), invalidConfig), /ILI date/i);

  assert.throws(
    () => processRow(validRow(), { ...config, analysisHorizonYears: 0 }),
    /analysis horizon/i,
  );
  assert.throws(
    () => processRow(validRow(), { ...config, analysisHorizonYears: 101 }),
    /analysis horizon/i,
  );
});

test('enforces SMYS + 69 MPa and the minimum assessment safety factor at runtime', () => {
  const applicability = {
    materialClass: 'plain-carbon-low-alloy' as const,
    operatingTemperatureC: 80,
    ductileFractureBehaviorConfirmed: true,
    pressureDominatedLoadingConfirmed: true,
    codeExclusionsReviewed: true,
    deepMetalLossMeasurementAccuracyConfirmed: false,
    effectiveCorrosionRateConfirmed: false,
    assessmentSafetyFactorBasis: 'MAOP and hydrotest basis',
    lowSafetyFactorJustification: '',
  };

  assert.throws(
    () => processRow(
      validRow({ [REQUIRED_COLUMNS[12]]: '484' }),
      { ...config, method: 'modified', applicability },
    ),
    /483 MPa/i,
  );
  assert.throws(
    () => processRow(validRow({ [REQUIRED_COLUMNS[10]]: '0.9' }), { ...config, applicability }),
    /below 1.25/i,
  );
  assert.doesNotThrow(() => processRow(
    validRow({ [REQUIRED_COLUMNS[10]]: '0.9' }),
    { ...config, applicability: { ...applicability, lowSafetyFactorJustification: 'Approved special-case assessment.' } },
  ));
});

test('validates optional repair disposition values and real calendar dates', () => {
  assert.deepEqual(validateData([validRow({
    'Repair Status': 'Permanent repair verified',
    'Repair Date': '2024-02-29',
  })]), []);

  const errors = validateData([validRow({
    'Repair Status': 'Completed',
    'Repair Date': '2025-02-29',
  })]);

  assert.deepEqual(errors.map((error) => error.col), ['Repair Status', 'Repair Date']);
});
