import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clockRose,
  corrosionVitals,
  countBySeverity,
  densityByKp,
  depthHistogram,
  growthHistogram,
  hasSections,
  orientationVerdict,
  parseClockHour,
  populationChange,
  remainingLifeRanking,
  remainingLifeYears,
  riskRanking,
  severityBySection,
  severityOf,
  surfaceSplit,
} from '../src/lib/corrosion/analytics.ts';
import type { CorrosionFeature } from '../src/lib/corrosion/analysis.ts';

function feature(overrides: Partial<CorrosionFeature> = {}): CorrosionFeature {
  return {
    sourceKey: overrides.sourceKey ?? `k${Math.random()}`,
    featureId: 'ML-1',
    section: '-',
    featureType: 'Metal Loss',
    distanceM: 100,
    clock: '6:00',
    surface: 'Internal',
    depthPct: 30,
    lengthMm: 40,
    widthMm: 20,
    wallMm: 10,
    depthGrowthPctWtPerYear: null,
    lengthGrowthMmPerYear: null,
    erf: null,
    psafeBar: null,
    matchStatus: 'Matched',
    physicsWarning: '-',
    growthClass: 'unknown',
    ffsReady: true,
    blockers: [],
    ...overrides,
  };
}

/* ── Severity ─────────────────────────────────────────────────────────────── */

test('severity is driven by whichever of depth or ERF binds first', () => {
  assert.equal(severityOf(feature({ depthPct: 10, erf: null })), 'low');
  assert.equal(severityOf(feature({ depthPct: 25, erf: null })), 'medium');
  assert.equal(severityOf(feature({ depthPct: 45, erf: null })), 'high');
  assert.equal(severityOf(feature({ depthPct: 65, erf: null })), 'critical');
  // A shallow but long defect can still be critical on ERF alone.
  assert.equal(severityOf(feature({ depthPct: 12, erf: 1.05 })), 'critical');
  assert.equal(severityOf(feature({ depthPct: 12, erf: 0.92 })), 'high');
});

test('severity counts cover every feature exactly once', () => {
  const counts = countBySeverity([
    feature({ depthPct: 5 }),
    feature({ depthPct: 25 }),
    feature({ depthPct: 45 }),
    feature({ depthPct: 85 }),
  ]);
  assert.deepEqual(counts, { low: 1, medium: 1, high: 1, critical: 1 });
});

/* ── Distributions ────────────────────────────────────────────────────────── */

test('depth histogram bins on the lower edge and keeps 100 %WT in the last bin', () => {
  const bins = depthHistogram([
    feature({ depthPct: 0 }),
    feature({ depthPct: 9.9 }),
    feature({ depthPct: 10 }),
    feature({ depthPct: 100 }),
  ], 10);

  assert.equal(bins.length, 10);
  assert.equal(bins[0].count, 2, '0 and 9.9 fall in the first bin');
  assert.equal(bins[1].count, 1, '10 opens the second bin');
  assert.equal(bins[9].count, 1, '100 stays inside the last bin');
});

test('depth histogram ignores features with no reported depth', () => {
  const bins = depthHistogram([feature({ depthPct: null }), feature({ depthPct: 35 })], 10);
  assert.equal(bins.reduce((sum, bin) => sum + bin.count, 0), 1);
});

test('growth histogram keeps the negative tail rather than hiding it', () => {
  const bins = growthHistogram([
    feature({ depthGrowthPctWtPerYear: -0.6 }),
    feature({ depthGrowthPctWtPerYear: 0.4 }),
    feature({ depthGrowthPctWtPerYear: 0.6 }),
  ], 0.25, 3);

  const negative = bins.filter((bin) => bin.sign === -1).reduce((sum, bin) => sum + bin.count, 0);
  const positive = bins.filter((bin) => bin.sign === 1).reduce((sum, bin) => sum + bin.count, 0);
  assert.equal(negative, 1);
  assert.equal(positive, 2);
});

test('growth histogram clamps outliers into the end bins instead of dropping them', () => {
  const bins = growthHistogram([
    feature({ depthGrowthPctWtPerYear: 99 }),
    feature({ depthGrowthPctWtPerYear: -99 }),
  ], 0.5, 2);
  assert.equal(bins[0].count, 1);
  assert.equal(bins[bins.length - 1].count, 1);
});

/* ── Orientation ──────────────────────────────────────────────────────────── */

test('clock positions parse from the formats vendors actually ship', () => {
  assert.equal(parseClockHour('6:00'), 6);
  assert.equal(parseClockHour('12:00'), 0);
  assert.equal(parseClockHour('6'), 6);
  assert.equal(parseClockHour('5:30'), 5.5);
  assert.equal(parseClockHour('5.5'), 5.5);
});

test('clock parsing refuses unusable values instead of defaulting to midnight', () => {
  assert.equal(parseClockHour(''), null);
  assert.equal(parseClockHour('-'), null);
  assert.equal(parseClockHour('n/a'), null);
});

test('the rose separates internal from external in the same sector', () => {
  const sectors = clockRose([
    feature({ clock: '6:00', surface: 'Internal' }),
    feature({ clock: '6:20', surface: 'Internal' }),
    feature({ clock: '6:00', surface: 'External' }),
    feature({ clock: '12:00', surface: 'External' }),
  ]);

  assert.equal(sectors[6].internal, 2);
  assert.equal(sectors[6].external, 1);
  assert.equal(sectors[6].total, 3);
  assert.equal(sectors[0].external, 1);
});

test('internal loss along the invert is reported as water dropout, not "mixed"', () => {
  const features = [
    ...Array.from({ length: 18 }, () => feature({ clock: '6:00', surface: 'Internal' })),
    ...Array.from({ length: 4 }, () => feature({ clock: '12:00', surface: 'External' })),
  ];
  const verdict = orientationVerdict(features);
  assert.equal(verdict.dominant, 'internal-invert');
  assert.ok(verdict.invertShare >= 0.5);
});

test('external loss on the crown is reported as a coating or CP finding', () => {
  const features = [
    ...Array.from({ length: 18 }, () => feature({ clock: '12:00', surface: 'External' })),
    ...Array.from({ length: 4 }, () => feature({ clock: '6:00', surface: 'Internal' })),
  ];
  assert.equal(orientationVerdict(features).dominant, 'external-crown');
});

test('a thin population is reported as insufficient rather than a false diagnosis', () => {
  const verdict = orientationVerdict([feature({ clock: '6:00', surface: 'Internal' })]);
  assert.equal(verdict.dominant, 'insufficient');
});

/* ── Remaining life ───────────────────────────────────────────────────────── */

test('remaining life extrapolates the measured growth to the wall-loss limit', () => {
  const value = remainingLifeYears(feature({ depthPct: 40, depthGrowthPctWtPerYear: 2 }), 80);
  assert.equal(value, 20);
});

test('remaining life refuses to extrapolate a flat or shrinking defect', () => {
  assert.equal(remainingLifeYears(feature({ depthGrowthPctWtPerYear: 0 })), null);
  assert.equal(remainingLifeYears(feature({ depthGrowthPctWtPerYear: -0.4 })), null);
  assert.equal(remainingLifeYears(feature({ depthGrowthPctWtPerYear: null })), null);
});

test('a defect already past the limit reports zero, not a negative life', () => {
  assert.equal(remainingLifeYears(feature({ depthPct: 90, depthGrowthPctWtPerYear: 1 }), 80), 0);
});

test('the remaining-life ranking puts the soonest first and omits non-growers', () => {
  const ranking = remainingLifeRanking([
    feature({ sourceKey: 'slow', depthPct: 10, depthGrowthPctWtPerYear: 0.5 }),
    feature({ sourceKey: 'fast', depthPct: 70, depthGrowthPctWtPerYear: 5 }),
    feature({ sourceKey: 'flat', depthPct: 70, depthGrowthPctWtPerYear: 0 }),
  ]);
  assert.deepEqual(ranking.map((entry) => entry.feature.sourceKey), ['fast', 'slow']);
});

/* ── Density ──────────────────────────────────────────────────────────────── */

test('density bins features into fixed windows along the line', () => {
  const profile = densityByKp([
    feature({ distanceM: 10 }),
    feature({ distanceM: 120 }),
    feature({ distanceM: 640 }),
  ], 500);

  assert.equal(profile.windows.length, 2);
  assert.equal(profile.windows[0].count, 2);
  assert.equal(profile.windows[1].count, 1);
  assert.equal(profile.windows[0].perKm, 4);
});

test('the hotspot contains the peak window', () => {
  const features = [
    ...Array.from({ length: 40 }, () => feature({ distanceM: 2200 })),
    feature({ distanceM: 10 }),
    feature({ distanceM: 5100 }),
  ];
  const profile = densityByKp(features, 500);
  assert.ok(profile.hotspot, 'a clear cluster produces a hotspot');
  assert.ok(profile.peak);
  assert.ok(profile.hotspot!.startM <= profile.peak!.startM);
  assert.ok(profile.hotspot!.endM >= profile.peak!.endM);
});

test('density survives an empty or distance-less population', () => {
  assert.deepEqual(densityByKp([], 500).windows, []);
  assert.deepEqual(densityByKp([feature({ distanceM: null })], 500).windows, []);
});

/* ── Sections ─────────────────────────────────────────────────────────────── */

test('sections are only reported once the engineer actually named them', () => {
  assert.equal(hasSections([feature({ section: '-' })]), false);
  assert.equal(hasSections([feature({ section: 'Unclassified' })]), false);
  assert.equal(hasSections([feature({ section: 'River crossing' })]), true);
});

test('section severity ignores unsectioned features and ranks by population', () => {
  const rows = severityBySection([
    feature({ section: 'River crossing', depthPct: 65 }),
    feature({ section: 'Buried', depthPct: 5 }),
    feature({ section: 'Buried', depthPct: 5 }),
    feature({ section: '-', depthPct: 90 }),
  ]);

  assert.deepEqual(rows.map((row) => row.section), ['Buried', 'River crossing']);
  assert.equal(rows[1].counts.critical, 1);
  assert.equal(rows[1].criticalDensity, 1);
});

/* ── Review queue ─────────────────────────────────────────────────────────── */

test('the review queue ranks the binding defect first and explains why', () => {
  const ranking = riskRanking([
    feature({ sourceKey: 'mild', depthPct: 15 }),
    feature({ sourceKey: 'severe', depthPct: 70, erf: 1.1, depthGrowthPctWtPerYear: 2, growthClass: 'active' }),
  ]);

  assert.equal(ranking[0].feature.sourceKey, 'severe');
  assert.ok(ranking[0].drivers.includes('ERF at or above 1'));
  assert.ok(ranking[0].drivers.includes('Active growth'));
});

test('the review queue flags incomplete dimensions as a driver of its own', () => {
  const ranking = riskRanking([
    feature({ depthPct: 50, ffsReady: false, blockers: ['No reported width'] }),
  ]);
  assert.ok(ranking[0].drivers.includes('Incomplete dimensions'));
});

/* ── Splits ───────────────────────────────────────────────────────────────── */

test('surface split reads the vendor abbreviations as well as the full words', () => {
  const split = surfaceSplit([
    feature({ surface: 'Internal' }),
    feature({ surface: 'EXT' }),
    feature({ surface: 'I' }),
    feature({ surface: '-' }),
  ]);
  assert.deepEqual(split, { internal: 2, external: 1, unknown: 1 });
});

test('population change separates new corrosion from corrosion that grew', () => {
  const change = populationChange([
    feature({ matchStatus: 'Unmatched' }),
    feature({ matchStatus: 'Matched', depthGrowthPctWtPerYear: 1 }),
    feature({ matchStatus: 'Matched', depthGrowthPctWtPerYear: 0 }),
  ]);
  assert.deepEqual(change, { matched: 2, newlyReported: 1, growing: 1, dormant: 1 });
});

/* ── Vitals ───────────────────────────────────────────────────────────────── */

test('vitals report the worst case and how much of the population is unusable', () => {
  const vitals = corrosionVitals([
    feature({ depthPct: 20, erf: 0.5 }),
    feature({ depthPct: 72, erf: 1.2, depthGrowthPctWtPerYear: 4, growthClass: 'active' }),
    feature({ depthPct: 30, ffsReady: false, blockers: ['No wall thickness'] }),
  ]);

  assert.equal(vitals.metalLoss, 3);
  assert.equal(vitals.incomplete, 1);
  assert.equal(vitals.assessable, 2);
  assert.equal(vitals.maxDepthPct, 72);
  assert.equal(vitals.maxErf, 1.2);
  assert.equal(vitals.activeGrowth, 1);
  assert.equal(vitals.worstRemainingLife, 2);
});
