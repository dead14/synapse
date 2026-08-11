import assert from 'node:assert/strict';
import test from 'node:test';

import { buildClockRose, buildDistanceProfile, buildErfBands } from '../src/lib/ffs/integrityViews.ts';
import type { FfsScreenedResult, FfsSeverity } from '../src/lib/ffs/types.ts';

interface FixtureOptions {
  ld: number;
  severity?: FfsSeverity;
  erf?: number;
  clockHour?: number | null;
  surface?: string;
  depthPct?: number;
}

/** Only the fields these two aggregations read; everything else is irrelevant here. */
function feature({
  ld,
  severity = 'pass',
  erf = 0.4,
  clockHour = 6,
  surface = 'External',
  depthPct = 20,
}: FixtureOptions): FfsScreenedResult {
  return {
    key: `f-${ld}-${clockHour}-${surface}`,
    nominal: { ld, surface, maxDepthPct: depthPct },
    conservative: { severity, ERF: erf },
    clockHour,
  } as unknown as FfsScreenedResult;
}

test('an empty population produces an empty profile rather than a NaN axis', () => {
  const profile = buildDistanceProfile([], 10);
  assert.deepEqual(profile.bins, []);
  assert.equal(profile.peakCount, 0);
  assert.equal(profile.binWidthM, 0);
});

test('features are bucketed by distance and the far end lands in the last bin', () => {
  const profile = buildDistanceProfile(
    [feature({ ld: 0 }), feature({ ld: 50 }), feature({ ld: 100 })],
    4,
  );

  assert.deepEqual(profile.bins.map((bin) => bin.index), [0, 2, 3]);
  assert.equal(profile.minM, 0);
  assert.equal(profile.maxM, 100);
  assert.equal(profile.binWidthM, 25);
  // The last feature sits exactly on the upper bound and must not spill past it.
  assert.equal(profile.bins[profile.bins.length - 1].index, 3);
});

test('a bin reports the worst feature in it, not the average', () => {
  const worst = feature({ ld: 12, severity: 'fail', erf: 1.4 });
  const profile = buildDistanceProfile(
    [
      feature({ ld: 10, severity: 'pass', erf: 0.2 }),
      worst,
      feature({ ld: 14, severity: 'review', erf: 0.95 }),
      feature({ ld: 16, severity: 'pass', erf: 0.3 }),
    ],
    1,
  );

  assert.equal(profile.bins.length, 1);
  assert.equal(profile.bins[0].count, 4);
  assert.equal(profile.bins[0].severity, 'fail');
  assert.equal(profile.bins[0].worstErf, 1.4);
  assert.equal(profile.bins[0].worst, worst);
});

test('within one severity the higher ERF wins, so the bin opens the real worst case', () => {
  const higher = feature({ ld: 4, severity: 'review', erf: 0.98 });
  const profile = buildDistanceProfile(
    [feature({ ld: 2, severity: 'review', erf: 0.91 }), higher],
    1,
  );

  assert.equal(profile.bins[0].worst, higher);
});

test('the peak count is the busiest bin, which is what a full-height bar means', () => {
  const profile = buildDistanceProfile(
    [
      feature({ ld: 0 }),
      feature({ ld: 1 }),
      feature({ ld: 2 }),
      feature({ ld: 100 }),
    ],
    2,
  );

  assert.equal(profile.peakCount, 3);
});

test('the clock rose counts internal and external separately at every hour', () => {
  const rose = buildClockRose([
    feature({ clockHour: 6, surface: 'External', ld: 1 }),
    feature({ clockHour: 6, surface: 'External', ld: 2 }),
    feature({ clockHour: 6, surface: 'Internal', ld: 3 }),
    feature({ clockHour: 0, surface: 'Internal', ld: 4 }),
  ]);

  const six = rose.sectors[6];
  assert.equal(six.external, 2);
  assert.equal(six.internal, 1);
  assert.equal(six.total, 3);
  assert.equal(rose.sectors[0].internal, 1);
  assert.equal(rose.internalTotal, 2);
  assert.equal(rose.externalTotal, 2);
  assert.equal(rose.peakCount, 3);
});

test('a fractional clock value falls in the hour it started, and 12 wraps to zero', () => {
  const rose = buildClockRose([
    feature({ clockHour: 5.75, ld: 1 }),
    feature({ clockHour: 12, ld: 2 }),
    feature({ clockHour: 0, ld: 3 }),
  ]);

  assert.equal(rose.sectors[5].total, 1, '5:45 belongs to the 5 o\'clock sector');
  assert.equal(rose.sectors[0].total, 2, '12:00 and 0:00 are the same position');
  assert.equal(rose.sectors[0].label, '12');
});

test('features without a clock value are counted, never placed at 12 o\'clock', () => {
  const rose = buildClockRose([
    feature({ clockHour: null, ld: 1 }),
    feature({ clockHour: null, ld: 2 }),
    feature({ clockHour: 3, ld: 3 }),
  ]);

  assert.equal(rose.withoutOrientation, 2);
  assert.equal(rose.plotted, 1);
  assert.equal(rose.sectors[0].total, 0);
  assert.equal(rose.sectors[3].total, 1);
});

test('the invert share covers the 4 to 8 o\'clock arc where water collects', () => {
  const rose = buildClockRose([
    feature({ clockHour: 4, ld: 1 }),
    feature({ clockHour: 6, ld: 2 }),
    feature({ clockHour: 8, ld: 3 }),
    feature({ clockHour: 11, ld: 4 }),
  ]);

  assert.ok(Math.abs(rose.bottomShare - 0.75) < 1e-9);
});

test('each sector keeps its deepest feature so the wedge can be opened', () => {
  const deepest = feature({ clockHour: 5, depthPct: 61, ld: 2 });
  const rose = buildClockRose([
    feature({ clockHour: 5, depthPct: 12, ld: 1 }),
    deepest,
    feature({ clockHour: 5, depthPct: 44, ld: 3 }),
  ]);

  assert.equal(rose.sectors[5].deepest, deepest);
  assert.equal(rose.sectors[0].deepest, null);
});

/** A feature carrying all three ERF tiers, which the band builder reads. */
function tiered(
  ld: number,
  nominal: number,
  conservative: number,
  forecast: number,
  severity: FfsSeverity = 'pass',
  forecastSeverity: FfsSeverity = 'pass',
): FfsScreenedResult {
  return {
    key: `t-${ld}-${nominal}`,
    index: Math.round(ld),
    nominal: { ld, ERF: nominal, surface: 'External', maxDepthPct: 20 },
    conservative: { ERF: conservative, severity },
    forecast: { ERF: forecast, severity: forecastSeverity },
    clockHour: 6,
  } as unknown as FfsScreenedResult;
}

test('an empty population produces an empty band profile rather than a NaN axis', () => {
  const profile = buildErfBands([], 10);
  assert.deepEqual(profile.bands, []);
  assert.equal(profile.peakErf, 0);
  assert.deepEqual(profile.notable, []);
});

test('a band carries the worst value of each tier in its stretch', () => {
  const profile = buildErfBands(
    [
      tiered(0, 0.10, 0.20, 0.30),
      tiered(5, 0.40, 0.55, 0.90),
      tiered(90, 0.05, 0.06, 0.07),
    ],
    2,
  );

  const first = profile.bands[0];
  assert.equal(first.nominalMax, 0.40);
  assert.equal(first.conservativeMax, 0.55);
  assert.equal(first.forecastMax, 0.90);
  // The envelope needs the low edge too, or the spread has no bottom.
  assert.equal(first.forecastMin, 0.30);
  assert.equal(first.count, 2);
  assert.equal(profile.peakErf, 0.90);
});

test('the axis scales on the population, so a healthy line still draws a curve', () => {
  // The bug this guards. Every ERF here is under a quarter; against a fixed
  // 1.35 axis all three curves collapse onto the baseline and the reader sees
  // an empty chart rather than a line that is comfortably in the clear.
  const profile = buildErfBands(
    [tiered(0, 0.18, 0.22, 0.23), tiered(40, 0.12, 0.15, 0.19)],
    4,
  );
  assert.ok(profile.peakErf < 0.3, `peak ${profile.peakErf}`);
  assert.ok(profile.peakErf > 0, 'the peak has to be finite and usable as an axis');
});

test('escalated features keep their own mark; passes become the band', () => {
  const escalated = tiered(20, 0.9, 1.05, 1.3, 'fail', 'fail');
  const forecastOnly = tiered(30, 0.5, 0.6, 0.95, 'pass', 'review');
  const profile = buildErfBands([tiered(10, 0.1, 0.2, 0.3), escalated, forecastOnly], 4);

  assert.equal(profile.notable.length, 2);
  // Worst forecast first, so the cap drops the least interesting features.
  assert.equal(profile.notable[0].key, escalated.key);
  assert.equal(profile.notableOmitted, 0);
});

test('the individual-mark cap is reported rather than silently applied', () => {
  const items = Array.from({ length: 25 }, (_unused, i) =>
    tiered(i, 0.9, 1.05, 1.2 + i / 100, 'fail', 'fail'));
  const profile = buildErfBands(items, 5, 10);
  assert.equal(profile.notable.length, 10);
  assert.equal(profile.notableOmitted, 15);
});

test('a collapsed feature is counted, not allowed to destroy the axis', () => {
  const profile = buildErfBands(
    [tiered(0, 0.3, 0.4, Number.POSITIVE_INFINITY, 'fail', 'fail'), tiered(10, 0.2, 0.3, 0.5)],
    2,
  );
  assert.equal(profile.unboundedCount, 1);
  assert.ok(Number.isFinite(profile.peakErf), `peak ${profile.peakErf}`);
  assert.equal(profile.peakErf, 0.5);
});
