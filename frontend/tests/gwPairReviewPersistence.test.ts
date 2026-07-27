import test from 'node:test';
import assert from 'node:assert/strict';

import { pairResultForPersistence } from '../src/wizard/gwPairReviewPersistence.ts';

test('pairResultForPersistence keeps review decisions calculated with the current settings', () => {
  const result = pairResultForPersistence({
    gwMatchesFinal: [{ oldId: 'OLD-1', newId: 'NEW-1' }],
    gwOrphans: [],
    gwReview: { pair: { disposition: 'accepted', note: '', reviewedAt: '2026-07-27' } },
    reviewSignature: 'current',
    ota: 5,
    dtwOn: true,
    useValveAnchor: true,
    strictPenalty: false,
  }, 'current');

  assert.deepEqual(result.gwReview, {
    pair: { disposition: 'accepted', note: '', reviewedAt: '2026-07-27' },
  });
  assert.equal(result.gwReviewSignature, 'current');
});

test('pairResultForPersistence drops stale review decisions but preserves calculated locks', () => {
  const result = pairResultForPersistence({
    gwMatchesFinal: [{ oldId: 'OLD-1', newId: 'NEW-1' }],
    gwOrphans: [],
    gwReview: { pair: { disposition: 'accepted', note: '', reviewedAt: '2026-07-27' } },
    reviewSignature: 'old-settings',
    ota: 5,
    dtwOn: true,
    useValveAnchor: true,
    strictPenalty: false,
  }, 'current-settings');

  assert.deepEqual(result.gwMatchesFinal, [{ oldId: 'OLD-1', newId: 'NEW-1' }]);
  assert.equal('gwReview' in result, false);
  assert.equal('gwReviewSignature' in result, false);
});
