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
    // Past full wall — the depth bound is the wall, not the 80 %WT line.
    [REQUIRED_COLUMNS[3]]: '100.01',
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

test('allows the 80% method boundary but never marks it acceptable', () => {
  const row = validRow({ [REQUIRED_COLUMNS[3]]: '80' });
  assert.deepEqual(validateData([row]), []);

  const result = processRow(row, config);
  assert.equal(result.acceptance, 'Un-Acceptable');
  assert.equal(result.remnantLife.years, 0);
  assert.equal(result.remnantLife.governingLimit, 'Depth = 80%');
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
