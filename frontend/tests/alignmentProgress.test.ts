import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ALIGNMENT_RESULT_PAGE_SIZE,
  nextAlignmentProgress,
} from '../src/utils/alignmentProgress.ts';

test('alignment progress never moves backwards while polling', () => {
  assert.equal(nextAlignmentProgress(20, 10), 20);
  assert.equal(nextAlignmentProgress(20, 35), 35);
});

test('alignment progress ignores invalid values and stays within its bounds', () => {
  assert.equal(nextAlignmentProgress(35, Number.NaN), 35);
  assert.equal(nextAlignmentProgress(35, -10), 35);
  assert.equal(nextAlignmentProgress(95, 120), 100);
});

test('result hydration uses one bounded page for the current production dataset', () => {
  assert.equal(ALIGNMENT_RESULT_PAGE_SIZE, 20_000);
});
