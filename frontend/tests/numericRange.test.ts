import test from 'node:test';
import assert from 'node:assert/strict';

import { extentOf, maxOf, minOf } from '../src/utils/numericRange.ts';

test('minOf and maxOf agree with Math.min/Math.max on ordinary arrays', () => {
  const values = [3, -1, 7, 0, 2.5];
  assert.equal(minOf(values), Math.min(...values));
  assert.equal(maxOf(values), Math.max(...values));
  assert.deepEqual(extentOf(values), { min: -1, max: 7 });
});

test('empty input returns the caller-supplied fallback', () => {
  assert.equal(minOf([]), 0);
  assert.equal(maxOf([]), 0);
  assert.equal(minOf([], 42), 42);
  assert.deepEqual(extentOf([], { min: 0, max: 1 }), { min: 0, max: 1 });
});

test('non-finite values are skipped rather than poisoning the result', () => {
  const values = [5, NaN, 1, Infinity, 9, -Infinity];
  assert.equal(minOf(values), 1);
  assert.equal(maxOf(values), 9);
  // The spread form would return NaN here.
  assert.ok(Number.isNaN(Math.min(...values)));
});

test('an all-non-finite input falls back instead of returning Infinity', () => {
  assert.equal(minOf([NaN, Infinity]), 0);
  assert.equal(maxOf([NaN, -Infinity]), 0);
});

test('handles ILI-sized arrays that make the spread form throw', () => {
  // A 150k-feature master run is ordinary. Math.min(...array) throws
  // RangeError: Maximum call stack size exceeded somewhere past ~125k args,
  // so the spread form did not degrade on large runs -- it took the view down.
  const values = Array.from({ length: 200_000 }, (_unused, index) => index);

  assert.throws(() => Math.min(...values), RangeError);

  assert.equal(minOf(values), 0);
  assert.equal(maxOf(values), 199_999);
  assert.deepEqual(extentOf(values), { min: 0, max: 199_999 });
});
