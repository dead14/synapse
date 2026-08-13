import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildTimelineModel,
  buildOffsetHistogram,
  buildTimelineSummary,
  calculateViewportWindow,
  classifyTimelineMatch,
  offsetTrend,
  rawLdForTimelineMarker,
  readMatchConfidence,
  timelineLaneLabels,
  TIMELINE_STATUS_LABEL,
} from '../src/domain/gwTimeline.ts';

test('offsetTrend reports the mean, the worst pair and the drift along the line', () => {
  const trend = offsetTrend([
    { x: 0, y: 1 },
    { x: 1_000, y: 2 },
    { x: 2_000, y: 3 },
  ]);

  assert.ok(trend);
  assert.equal(trend.mean, 2);
  assert.equal(trend.maxAbs, 3);
  assert.equal(trend.maxAt, 2_000);
  assert.equal(trend.drift, 2);
  assert.equal(trend.spanFrom, 0);
  assert.equal(trend.spanTo, 2_000);
  // 1 m gained over 1000 m is 1 mm per metre.
  assert.equal(trend.slopeMmPerM, 1);
});

test('offsetTrend reads the series in distance order, not upload order', () => {
  const trend = offsetTrend([
    { x: 2_000, y: 3 },
    { x: 0, y: 1 },
  ]);

  assert.ok(trend);
  assert.equal(trend.drift, 2);
  assert.equal(trend.spanFrom, 0);
});

test('offsetTrend picks the largest magnitude, including a negative one', () => {
  const trend = offsetTrend([
    { x: 0, y: 2 },
    { x: 500, y: -9 },
  ]);

  assert.ok(trend);
  assert.equal(trend.maxAbs, 9);
  assert.equal(trend.maxAt, 500);
});

test('offsetTrend refuses to claim a slope it could not measure', () => {
  // Every pair at one chainage: there is no run to fit a line along, and
  // reporting 0 mm/m would read as a measured flat trend.
  assert.equal(offsetTrend([{ x: 100, y: 1 }, { x: 100, y: 3 }])?.slopeMmPerM, null);
  assert.equal(offsetTrend([]), null);
});

test('a girth weld with no counterpart reads as not matched, never as missing', () => {
  // "Missing" is the metal-loss finding — present in the old run, gone from the
  // new one. A weld the comparison could not pair is a different result, and
  // sharing the word makes two findings look like one.
  assert.equal(TIMELINE_STATUS_LABEL.missing, 'Not match');
  assert.equal(TIMELINE_STATUS_LABEL.matched, 'Matched');
  assert.equal(TIMELINE_STATUS_LABEL.review, 'Review');
});

test('viewer lanes are named by survey year, not by OLD and NEW', () => {
  assert.deepEqual(
    timelineLaneLabels({ year: '2024' }, { year: '2026' }),
    { old: '2024', new: '2026' },
  );
});

test('a lane with no year falls back to the vendor rather than to a side name', () => {
  assert.deepEqual(
    timelineLaneLabels({ vendor: 'ROSEN' }, { year: '2026' }),
    { old: 'ROSEN', new: '2026' },
  );
  assert.deepEqual(
    timelineLaneLabels({ surveyDate: '2021-11-02' }, { year: '2026' }),
    { old: '2021', new: '2026' },
  );
});

test('two lanes that would read identically are separated by position', () => {
  assert.deepEqual(
    timelineLaneLabels({ year: '2026' }, { year: '2026' }),
    { old: '2026 (earlier)', new: '2026 (later)' },
  );
  assert.deepEqual(
    timelineLaneLabels(null, undefined),
    { old: 'Undated run (earlier)', new: 'Undated run (later)' },
  );
});

test('buildTimelineModel keeps a full NEW master domain and a partial mapped OLD coverage', () => {
  const model = buildTimelineModel(
    [
      {
        id: 'pair-1',
        status: 'Match',
        oldId: 'old-1',
        newId: 'new-1',
        oldVal: 1_868.81,
        newVal: 1_868.81,
        originalOldVal: 4.243,
        originalNewVal: 1_868.81,
      },
      {
        id: 'pair-2',
        status: 'Match',
        oldId: 'old-2',
        newId: 'new-locked-end',
        oldVal: 3_946.498,
        newVal: 3_946.498,
        originalOldVal: 2_095.565,
        originalNewVal: 3_946.498,
      },
    ],
    {
      coordinateSystem: 'NEW_MASTER',
      domain: { startM: 0, endM: 3_947.278 },
      oldCoverage: {
        startM: 1_868.81,
        endM: 3_946.498,
        sourceStartM: 4.243,
        sourceEndM: 2_095.565,
      },
      newCoverage: { startM: 0, endM: 3_947.278 },
      oldFeatures: [
        { id: 'old-1', type: 'weld', displayDistanceM: 1_868.81, sourceDistanceM: 4.243 },
        { id: 'old-2', type: 'weld', displayDistanceM: 3_946.498, sourceDistanceM: 2_095.565 },
      ],
      newFeatures: [
        { id: 'new-0', type: 'weld', displayDistanceM: 0, sourceDistanceM: 0, inOverlap: false },
        { id: 'new-1', type: 'weld', displayDistanceM: 1_868.81, sourceDistanceM: 1_868.81, inOverlap: true },
        { id: 'new-locked-end', type: 'weld', displayDistanceM: 3_946.498, sourceDistanceM: 3_946.498, inOverlap: true },
        { id: 'new-2', type: 'weld', displayDistanceM: 3_947.278, sourceDistanceM: 3_947.278, inOverlap: false },
      ],
    },
  );

  assert.deepEqual(model.domain, { startM: 0, endM: 3_947.278 });
  assert.deepEqual(model.oldCoverage, { startM: 1_868.81, endM: 3_946.498 });
  assert.deepEqual(model.oldGWs, [1_868.81, 3_946.498]);
  assert.deepEqual(model.newGWs, [0, 1_868.81, 3_946.498, 3_947.278]);
  assert.equal(model.matches.filter((match) => match.status === 'Skipped').length, 2);
  assert.equal(model.matches.some((match) => match.oldVal === 0), false);
  assert.equal(model.matches.some((match) => match.newVal === 0 && match.status === 'Skipped'), true);
});

test('classifyTimelineMatch preserves review decisions and missing sides', () => {
  const matched = { status: 'Match', oldId: 'old-1', newId: 'new-1', flagged: false };

  assert.equal(classifyTimelineMatch(matched), 'matched');
  assert.equal(classifyTimelineMatch({ ...matched, flagged: true }), 'review');
  assert.equal(classifyTimelineMatch({ ...matched, flagged: true }, 'accepted'), 'matched');
  assert.equal(classifyTimelineMatch(matched, 'review'), 'review');
  assert.equal(classifyTimelineMatch(matched, 'excluded'), 'missing');
  assert.equal(classifyTimelineMatch({ status: 'Skipped', oldId: 'old-2', newId: null }), 'missing');
});

test('rawLdForTimelineMarker keeps the source LD instead of the mapped master coordinate', () => {
  const match = {
    oldVal: 1_868.81,
    newVal: 1_868.81,
    originalOldVal: 4.243,
    originalNewVal: 1_868.81,
  };

  assert.equal(rawLdForTimelineMarker(4.243, match, 'old'), 4.243);
  assert.equal(rawLdForTimelineMarker(null, match, 'old'), 4.243);
  assert.equal(rawLdForTimelineMarker(null, match, 'new'), 1_868.81);
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
