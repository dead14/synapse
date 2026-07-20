import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildDataReview,
  gwReviewKey,
  normalizeGwReview,
  selectReviewedGwLocks,
} from '../src/domain/alignmentReview.ts';

test('buildDataReview requires populated master and historical runs before acknowledgement', () => {
  assert.equal(buildDataReview({ newRun: { total: 2 }, oldRun: { total: 1 } }, false), null);

  const review = buildDataReview({ newRun: { total: 2 }, oldRun: { total: 1 } }, true, '2026-07-18T10:00:00.000Z');
  assert.deepEqual(review, {
    status: 'acknowledged',
    reviewedAt: '2026-07-18T10:00:00.000Z',
    masterFeatureCount: 2,
    historicalFeatureCount: 1,
  });
});

test('normalizeGwReview keeps bounded evidence dispositions and notes', () => {
  assert.deepEqual(normalizeGwReview({
    'old-1::new-1': { disposition: 'review', note: '  Check tie-in log.  ', reviewedAt: '2026-07-18T10:00:00.000Z' },
    invalid: { disposition: 'invented', note: 'ignored' },
  }), {
    'old-1::new-1': { disposition: 'review', note: 'Check tie-in log.', reviewedAt: '2026-07-18T10:00:00.000Z' },
  });
});

test('selectReviewedGwLocks excludes only rejected persisted lock pairs', () => {
  const locks = [
    { old_id: 'old-1', new_id: 'new-1', old_odometer: 10, new_odometer: 11 },
    { old_id: 'old-2', new_id: 'new-2', old_odometer: 20, new_odometer: 21 },
  ];
  const key = gwReviewKey(locks[1]);

  assert.deepEqual(selectReviewedGwLocks(locks, {
    [key]: { disposition: 'excluded', note: 'Duplicate anchor', reviewedAt: '2026-07-18T10:00:00.000Z' },
  }), [locks[0]]);
});
