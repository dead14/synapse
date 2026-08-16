import assert from 'node:assert/strict';
import test from 'node:test';

import { processAllRows, processRow } from '../src/lib/ffs/calcEngine.ts';
import { FfsInputValidationError } from '../src/lib/ffs/inputValidation.ts';
import { REQUIRED_COLUMNS, type FfsConfig } from '../src/lib/ffs/types.ts';
import { validateData } from '../src/lib/ffs/validation.ts';

function validRow(overrides: Record<string, string> = {}) {
  return {
    ['LD [m]']: '100.5',
    ['Section']: 'Joint-1',
    ['Surface']: 'Internal',
    ['Max Depth [%]']: '20',
    ['Length [mm]']: '100',
    ['Width [mm]']: '30',
    ['Orient. (hrs:mins)']: '6:00',
    ['Nominal Wall Thickness [mm]']: '10',
    ['CR Depth [mm/y]']: '0',
    ['CR Length [mm/y]']: '0',
    ['Design Factor']: '0.72',
    ['Outer Diameter Ds']: '500',
    ['SMYS [MPa]']: '400',
    ['Operating Pressure P₀ [MPa]']: '5',
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
  const row = validRow({ ['Max Depth [%]']: '0' });
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
    validRow({ ['Length [mm]']: '12mm' }),
    validRow({ ['SMYS [MPa]']: 'NaN' }),
    validRow({ ['Operating Pressure P₀ [MPa]']: 'Infinity' }),
  ];
  const errors = validateData(rows);

  assert.equal(errors.length, 3);
  assert.deepEqual(errors.map((error) => error.col), [
    'Length [mm]',
    'SMYS [MPa]',
    'Operating Pressure P₀ [MPa]',
  ]);
  assert.ok(errors.every((error) => /finite number/i.test(error.msg)));
});

test('rejects zero, negative, and out-of-domain engineering inputs', () => {
  const row = validRow({
    ['LD [m]']: '-1',
    // Past full wall — the depth bound is the wall, not the 80 %WT line.
    ['Max Depth [%]']: '100.01',
    ['Length [mm]']: '0',
    ['Width [mm]']: '0',
    ['Nominal Wall Thickness [mm]']: '10',
    ['CR Depth [mm/y]']: '-0.1',
    ['CR Length [mm/y]']: '-0.1',
    ['Design Factor']: '1.01',
    ['Outer Diameter Ds']: '20',
    ['SMYS [MPa]']: '0',
    ['Operating Pressure P₀ [MPa]']: '0',
  });
  const errorColumns = new Set(validateData([row]).map((error) => error.col));

  for (const column of [
    'LD [m]', 'Max Depth [%]', 'Length [mm]',
    'CR Depth [mm/y]', 'CR Length [mm/y]', 'Design Factor', 'Outer Diameter Ds',
    'SMYS [MPa]', 'Operating Pressure P₀ [MPa]',
  ]) {
    assert.ok(errorColumns.has(column), `missing validation error for ${column}`);
  }

  // Width is not one of them. B31G reads depth and axial length; requiring a
  // width refused whole runs whose vendor reports none, dropping anomalies the
  // calculation had everything it needed for. A blank width is accepted, and a
  // present one still has to be a number.
  assert.equal(errorColumns.has('Width [mm]'), false);
  assert.deepEqual(validateData([validRow({ 'Width [mm]': '' })]), []);
  assert.deepEqual(
    validateData([validRow({ 'Width [mm]': '30mm' })]).map((error) => error.col),
    ['Width [mm]'],
  );
});

test('allows the 80% method boundary but never marks it acceptable', () => {
  const row = validRow({ ['Max Depth [%]']: '80' });
  assert.deepEqual(validateData([row]), []);

  const result = processRow(row, config);
  assert.equal(result.acceptance, 'Un-Acceptable');
  assert.equal(result.remnantLife.years, 0);
  assert.equal(result.remnantLife.governingLimit, 'Depth = 80%');
  assert.ok(Number.isFinite(result.ERF));
});

test('processRow and processAllRows fail closed for invalid inputs', async () => {
  const invalid = validRow({ ['Nominal Wall Thickness [mm]']: '0' });

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
