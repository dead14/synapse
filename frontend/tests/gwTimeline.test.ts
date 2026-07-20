import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildOffsetHistogram,
  buildTimelineSummary,
  calculateViewportWindow,
  classifyTimelineMatch,
  readMatchConfidence,
} from '../src/domain/gwTimeline.ts';

test('classifyTimelineMatch preserves review decisions and missing sides', () => {
  const matched = { status: 'Match', oldId: 'old-1', newId: 'new-1', flagged: false };

  assert.equal(classifyTimelineMatch(matched), 'matched');
  assert.equal(classifyTimelineMatch({ ...matched, flagged: true }), 'review');
  assert.equal(classifyTimelineMatch({ ...matched, flagged: true }, 'accepted'), 'matched');
  assert.equal(classifyTimelineMatch(matched, 'review'), 'review');
  assert.equal(classifyTimelineMatch(matched, 'excluded'), 'missing');
  assert.equal(classifyTimelineMatch({ status: 'Skipped', oldId: 'old-2', newId: null }), 'missing');
});

test('buildTimelineSummary reports health and offsets from canonical pairs', () => {
  const matches = [
    { id: 'a', status: 'Match', oldId: 'old-1', newId: 'new-1', offset: 2, flagged: false },
    { id: 'b', status: 'Match', oldId: 'old-2', newId: 'new-2', offset: -1, flagged: true },
    { id: 'c', status: 'Skipped', oldId: 'old-3', newId: null, offset: null },
    { id: 'd', status: 'Match', oldId: 'old-4', newId: 'new-4', offset: 3, flagged: false },
  ];

  assert.deepEqual(buildTimelineSummary(matches, { d: 'review' }), {
    matched: 1,
    review: 2,
    missing: 1,
    total: 4,
    matchedPercent: 25,
    meanOffset: 1.3333333333333333,
    maxOffset: 3,
  });
});

test('buildOffsetHistogram keeps every finite sample in a symmetric domain', () => {
  const histogram = buildOffsetHistogram([-2, -1, 0, 1, 2, Number.NaN], 4);

  assert.equal(histogram.length, 4);
  assert.equal(histogram.reduce((sum, bin) => sum + bin.count, 0), 5);
  assert.equal(histogram[0].from, -2);
  assert.equal(histogram.at(-1)?.to, 2);
});

test('calculateViewportWindow maps the scrollable viewport onto the mini-map', () => {
  assert.deepEqual(calculateViewportWindow({ scrollLeft: 250, clientWidth: 250, scrollWidth: 1000 }), {
    leftPercent: 25,
    widthPercent: 25,
  });
  assert.deepEqual(calculateViewportWindow({ scrollLeft: 0, clientWidth: 500, scrollWidth: 0 }), {
    leftPercent: 0,
    widthPercent: 100,
  });
});

test('readMatchConfidence never invents a score when the engine omitted it', () => {
  assert.equal(readMatchConfidence({}), null);
  assert.equal(readMatchConfidence({ confidence: 0.987 }), 98.7);
  assert.equal(readMatchConfidence({ matchConfidence: 94.2 }), 94.2);
  assert.equal(readMatchConfidence({ confidence: 150 }), null);
});
