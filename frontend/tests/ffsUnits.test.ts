import assert from 'node:assert/strict';
import test from 'node:test';

import {
  barToMegapascals,
  inchesToMillimetres,
  ksiToMegapascals,
  millimetresToInches,
  psiToMegapascals,
} from '../src/lib/ffs/units.ts';

function assertClose(actual: number, expected: number, tolerance = 1e-12) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
}

test('converts pressure units using published SI conversion factors', () => {
  assertClose(psiToMegapascals(1_000), 6.894757);
  assertClose(ksiToMegapascals(10), 68.94757);
  assertClose(barToMegapascals(65), 6.5);
});

test('converts inches and millimetres reversibly', () => {
  assert.equal(inchesToMillimetres(20), 508);
  assert.equal(millimetresToInches(508), 20);
});

test('rejects non-finite unit conversion inputs', () => {
  assert.throws(() => psiToMegapascals(Number.NaN), /finite/i);
  assert.throws(() => ksiToMegapascals(Number.POSITIVE_INFINITY), /finite/i);
  assert.throws(() => inchesToMillimetres(Number.NEGATIVE_INFINITY), /finite/i);
});
