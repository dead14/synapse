import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildIntegrityTimeline,
  type TimelineObservation,
} from '../src/lib/timeline/integrityTimeline.ts';

const observations: TimelineObservation[] = [
  { runId: 'r1', runDate: '2020-01-01', featureKey: 'a1', genealogyKey: 'g1', chainageM: 100, depthPct: 20, lengthMm: 40, widthMm: 20, measurementTolerancePct: 10, alignmentConfidence: 0.9, matchConfidence: 0.8 },
  { runId: 'r2', runDate: '2022-01-01', featureKey: 'a2', genealogyKey: 'g1', chainageM: 100.2, depthPct: 28, lengthMm: 48, widthMm: 24, measurementTolerancePct: 10, alignmentConfidence: 0.8, matchConfidence: 0.7 },
  { runId: 'r2', runDate: '2022-01-01', featureKey: 'new-1', genealogyKey: 'g2', chainageM: 200, depthPct: 12, lengthMm: 20, widthMm: 10, measurementTolerancePct: 10, alignmentConfidence: 0.7, matchConfidence: 0.6 },
];

test('builds a chronological genealogy with measured growth and decomposed confidence', () => {
  const timeline = buildIntegrityTimeline(observations);
  const genealogy = timeline.genealogies.find((item) => item.genealogyKey === 'g1');

  assert.equal(genealogy?.status, 'matched');
  assert.equal(genealogy?.observations.length, 2);
  assert.equal(genealogy?.growth?.depthPctDelta, 8);
  assert.equal(genealogy?.growth?.lengthMmDelta, 8);
  assert.equal(genealogy?.confidence.alignment, 0.8);
  assert.equal(genealogy?.confidence.match, 0.7);
  assert.ok((genealogy?.confidence.growth ?? 0) < 1);
});

test('labels a genealogy first seen in the latest run as new', () => {
  const timeline = buildIntegrityTimeline(observations);
  assert.equal(
    timeline.genealogies.find((item) => item.genealogyKey === 'g2')?.status,
    'new',
  );
});

test('fails closed on duplicate feature identity and invalid confidence', () => {
  assert.throws(
    () => buildIntegrityTimeline([...observations, observations[0]]),
    /duplicate featureKey/i,
  );
  assert.throws(
    () => buildIntegrityTimeline([{ ...observations[0], alignmentConfidence: 1.1 }]),
    /alignmentConfidence/i,
  );
});
