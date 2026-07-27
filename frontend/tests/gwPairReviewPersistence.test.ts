import test from 'node:test';
import assert from 'node:assert/strict';

import {
  canonicalGwReviewSignature,
  pairResultForPersistence,
} from '../src/wizard/gwPairReviewPersistence.ts';

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

test('canonicalGwReviewSignature changes when the pair tie-in transform changes', () => {
  const settings = { ota: 1.5, strictPenalty: false, useValveAnchor: true, dtwOn: true };
  const baseConfig = {
    summaryData: { oldRun: { runId: 13 }, newRun: { runId: 14 } },
    tieInDecision: { status: 'AUTO_ACCEPTED' },
    tieInEvidenceToken: 'signed-evidence',
    tieInMethodVersion: 'v1',
    tieInTransform: { direction: 'OLD_TO_NEW', knots: [{ old: 0, next: 0 }] },
  };

  const changedTransform = {
    ...baseConfig,
    tieInTransform: { direction: 'OLD_TO_NEW', knots: [{ old: 0, next: 4.2 }] },
  };

  assert.notEqual(
    canonicalGwReviewSignature(baseConfig, settings),
    canonicalGwReviewSignature(changedTransform, settings),
  );
});
