import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CALLOUT_MIN_GAP_PCT,
  axisMaximum,
  positionOnAxis,
  pressureRailLayout,
  spreadCallouts,
} from '../src/lib/ffs/pressureRail.ts';

test('axis maximum leaves headroom above the largest pressure and lands on a round step', () => {
  assert.equal(axisMaximum([6, 15.4, 27.5]), 30);
  assert.equal(axisMaximum([8.274, 15.425, 21.424]), 25);
  assert.equal(axisMaximum([0.4, 1.2, 2.1]), 3);
});

test('axis maximum ignores non-finite and non-positive capacities', () => {
  assert.equal(axisMaximum([6, 15.4, Number.POSITIVE_INFINITY]), 20);
  assert.equal(axisMaximum([0, -3, Number.NaN]), 2);
});

test('an unbounded failure pressure is pinned to the end of the axis', () => {
  assert.equal(positionOnAxis(Number.POSITIVE_INFINITY, 30), 100);
  assert.equal(positionOnAxis(Number.NaN, 30), 0);
  assert.equal(positionOnAxis(15, 30), 50);
});

test('callouts keep their order and the configured separation when values coincide', () => {
  const spread = spreadCallouts([61.7, 61.7, 85.7], 24);
  assert.equal(spread.length, 3);
  assert.ok(spread[1] - spread[0] >= 24 - 1e-9, 'coincident callouts are pushed apart');
  assert.ok(spread[2] - spread[1] >= 24 - 1e-9, 'the third callout keeps clear of the second');
  assert.ok(spread[0] < spread[1] && spread[1] < spread[2], 'left-to-right order survives');
});

test('callouts stay inside the plot when every pressure crowds one edge', () => {
  const spread = spreadCallouts([96, 98, 99], CALLOUT_MIN_GAP_PCT);
  const edge = CALLOUT_MIN_GAP_PCT / 2;
  for (const position of spread) {
    assert.ok(position >= edge - 1e-9, `${position} is inside the left edge`);
    assert.ok(position <= 100 - edge + 1e-9, `${position} is inside the right edge`);
  }
});

test('spread positions are returned in the caller order, not sorted order', () => {
  const spread = spreadCallouts([80, 20, 50], 24);
  assert.ok(spread[1] < spread[2] && spread[2] < spread[0]);
});

test('an acceptable feature shows a margin band between required and safe pressure', () => {
  const layout = pressureRailLayout({
    requiredPressureMpa: 6,
    safePressureMpa: 15.4,
    failurePressureMpa: 27.5,
  });

  assert.equal(layout.acceptable, true);
  assert.ok(Math.abs(layout.marginMpa - 9.4) < 1e-9);
  assert.deepEqual(layout.markers.map((marker) => marker.id), ['required', 'safe', 'failure']);
  assert.deepEqual(layout.bands.map((band) => band.id), ['reserve', 'service', 'margin']);

  const [reserve, service, margin] = layout.bands;
  assert.equal(service.fromPct, 0);
  assert.equal(service.toPct, layout.markers[0].positionPct);
  assert.equal(margin.fromPct, layout.markers[0].positionPct);
  assert.equal(margin.toPct, layout.markers[1].positionPct);
  assert.equal(reserve.fromPct, layout.markers[1].positionPct);
  assert.equal(reserve.toPct, layout.markers[2].positionPct);
});

test('a feature with no remaining margin reports a deficit band and a failed verdict', () => {
  const layout = pressureRailLayout({
    requiredPressureMpa: 18,
    safePressureMpa: 12,
    failurePressureMpa: 16.7,
  });

  assert.equal(layout.acceptable, false);
  assert.equal(layout.marginMpa, -6);
  const deficit = layout.bands[2];
  assert.equal(deficit.id, 'deficit');
  assert.equal(deficit.fromPct, layout.markers[1].positionPct);
  assert.equal(deficit.toPct, layout.markers[0].positionPct);
  for (const band of layout.bands) {
    assert.ok(band.toPct >= band.fromPct, `${band.id} band is not inverted`);
  }
});

test('the axis carries five ticks from zero to the axis maximum', () => {
  const layout = pressureRailLayout({
    requiredPressureMpa: 6,
    safePressureMpa: 15.4,
    failurePressureMpa: 27.5,
  });
  assert.deepEqual(layout.ticksMpa, [0, 7.5, 15, 22.5, 30]);
  assert.equal(layout.axisMaximumMpa, 30);
});
