import test from 'node:test';
import assert from 'node:assert/strict';

import { buildGwReviewTransitionPayload } from '../src/wizard/gwReviewTransition.ts';

test('GW review transition removes bulky derived arrays while preserving canonical evidence', () => {
  const existingConfig = {
    sessionId: 15,
    gwMatches: Array.from({ length: 1_170 }, (_, index) => ({
      id: `match-${index}`,
      oldVal: index * 10,
      newVal: index * 10 + 0.25,
      status: 'MATCHED',
      extra: 'x'.repeat(300),
    })),
    alignedFeatures: Array.from({ length: 1_127 }, (_, index) => ({
      id: `feature-${index}`,
      distance: index * 10,
      extra: 'y'.repeat(300),
    })),
  };
  const gwMatchesFinal = [{ key: 'gw-1', oldDistance: 10, newDistance: 10.25 }];
  const gwOrphans = [{ id: 'orphan-1', distance: 20 }];

  const transition = buildGwReviewTransitionPayload({
    ota: 1.5,
    strictPenalty: true,
    useValveAnchor: true,
    dtwOn: true,
    gwMatchesFinal,
    gwOrphans,
    gwReview: { 'gw-1': 'accepted' },
    gwReviewSignature: 'signature-1',
    sessionRevision: '42',
  });
  const serialized = JSON.stringify({ ...existingConfig, ...transition });

  assert.doesNotMatch(serialized, /"gwMatches"|"alignedFeatures"/);
  assert.deepEqual(transition.gwMatchesFinal, gwMatchesFinal);
  assert.deepEqual(transition.gwOrphans, gwOrphans);
  assert.ok(serialized.length < JSON.stringify(existingConfig).length / 10);
});
