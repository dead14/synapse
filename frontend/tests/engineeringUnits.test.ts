import assert from 'node:assert/strict';
import test from 'node:test';

import {
  convertLength,
  convertPressure,
  formatConvertedValue,
  toMillimetres,
  toMegapascals,
} from '../src/lib/ffs/units.ts';

test('normalizes pressure inputs to MPa for the B31G calculation', () => {
  assert.equal(toMegapascals(100, 'bar'), 10);
  assert.ok(Math.abs(toMegapascals(1450.377377, 'psi') - 10) < 0.000001);
  assert.equal(toMegapascals(10, 'MPa'), 10);
  assert.equal(convertPressure(10, 'MPa', 'bar'), 100);
});

test('normalizes OD inches to millimetres and preserves physical value when switching display units', () => {
  assert.equal(toMillimetres(20, 'in'), 508);
  assert.equal(convertLength(508, 'mm', 'in'), 20);
  assert.equal(formatConvertedValue(20, 'in', 'mm'), '508');
});
