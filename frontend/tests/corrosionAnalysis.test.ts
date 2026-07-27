import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyseComparison,
  buildReviewPayload,
  selectableKeys,
  suggestSelection,
  summariseCorrosion,
  toCorrosionFeature,
} from '../src/lib/corrosion/analysis.ts';

function metalLoss(overrides: Record<string, unknown> = {}) {
  return {
    'Source Key NEW': 'new:1',
    'Identif. NEW': 'A-1',
    'Feature Type NEW': 'Metal Loss',
    'Section NEW': 'KP 0-5',
    'Log Dist NEW (m)': 120.5,
    "O'Clock NEW": '06:00',
    'Surface NEW': 'External',
    'Depth NEW (%WT)': 32,
    'Length NEW (mm)': 80,
    'Width NEW (mm)': 30,
    'Wall WT NEW (mm)': 12.7,
    'Depth Growth (%WT/yr)': 1.2,
    'Length Growth (mm/yr)': 3,
    'ERF ASME NEW': 0.82,
    'Match/Unmatch': 'Match',
    'Physics Warning': '-',
    ...overrides,
  };
}

test('reads the corrosion condition from an alignment comparison row', () => {
  const feature = toCorrosionFeature(metalLoss());

  assert.ok(feature);
  assert.equal(feature.sourceKey, 'new:1');
  assert.equal(feature.featureId, 'A-1');
  assert.equal(feature.depthPct, 32);
  assert.equal(feature.growthClass, 'active');
  assert.equal(feature.ffsReady, true);
  assert.deepEqual(feature.blockers, []);
});

test('rows without a NEW-run feature are not part of the review', () => {
  assert.equal(toCorrosionFeature({ 'Source Key NEW': '-', 'Source Key OLD': 'old:3' }), null);
  assert.equal(analyseComparison([{ 'Source Key NEW': '-' }, metalLoss()]).length, 1);
});

test('growth classification separates active, marginal, stable, and unmeasured', () => {
  const classOf = (growth: unknown) => toCorrosionFeature(metalLoss({ 'Depth Growth (%WT/yr)': growth }))?.growthClass;

  assert.equal(classOf(1.2), 'active');
  assert.equal(classOf(0.5), 'active');
  assert.equal(classOf(0.2), 'possibly-active');
  assert.equal(classOf(0), 'stable');
  assert.equal(classOf(-0.4), 'stable');
  assert.equal(classOf('-'), 'unknown');
});

test('a feature missing a dimension the engine needs is not assessable', () => {
  const noLength = toCorrosionFeature(metalLoss({ 'Length NEW (mm)': '-' }));
  assert.equal(noLength?.ffsReady, false);
  assert.deepEqual(noLength?.blockers, ['No reported length']);

  const tooDeep = toCorrosionFeature(metalLoss({ 'Depth NEW (%WT)': 92 }));
  assert.equal(tooDeep?.ffsReady, false);
  assert.match(tooDeep!.blockers[0], /0–80 %WT/);

  const bare = toCorrosionFeature({ 'Source Key NEW': 'new:9' });
  assert.equal(bare?.ffsReady, false);
  assert.equal(bare?.blockers.length, 5);
});

test('the rule proposes only assessable metal loss', () => {
  const features = analyseComparison([
    metalLoss({ 'Source Key NEW': 'new:high-erf', 'ERF ASME NEW': 0.95, 'Depth Growth (%WT/yr)': 0 }),
    metalLoss({ 'Source Key NEW': 'new:deep', 'ERF ASME NEW': 0.4, 'Depth NEW (%WT)': 55, 'Depth Growth (%WT/yr)': 0 }),
    metalLoss({ 'Source Key NEW': 'new:growing', 'ERF ASME NEW': 0.4, 'Depth NEW (%WT)': 12 }),
    metalLoss({ 'Source Key NEW': 'new:quiet', 'ERF ASME NEW': 0.4, 'Depth NEW (%WT)': 12, 'Depth Growth (%WT/yr)': 0 }),
    metalLoss({ 'Source Key NEW': 'new:incomplete', 'ERF ASME NEW': 0.99, 'Width NEW (mm)': '-' }),
  ]);

  const suggested = suggestSelection(features);

  assert.deepEqual([...suggested].sort(), ['new:deep', 'new:growing', 'new:high-erf']);
});

test('the saved payload records rejections but omits untouched features', () => {
  const features = analyseComparison([
    metalLoss({ 'Source Key NEW': 'new:1' }),
    metalLoss({ 'Source Key NEW': 'new:2' }),
    metalLoss({ 'Source Key NEW': 'new:3' }),
  ]);

  const payload = buildReviewPayload(
    features,
    new Set(['new:1']),
    { 'new:2': ' below the reporting threshold ', 'new:3': '   ' },
  );

  assert.deepEqual(payload, [
    { sourceKey: 'new:1', featureId: 'A-1', selected: true, reason: null },
    { sourceKey: 'new:2', featureId: 'A-1', selected: false, reason: 'below the reporting threshold' },
  ]);
});

test('a stored selection can never resurrect a feature the engine cannot assess', () => {
  const features = analyseComparison([
    metalLoss({ 'Source Key NEW': 'new:ok' }),
    metalLoss({ 'Source Key NEW': 'new:broken', 'Wall WT NEW (mm)': '-' }),
  ]);

  const usable = selectableKeys(features, new Set(['new:ok', 'new:broken']));

  assert.deepEqual([...usable], ['new:ok']);
});

test('the summary counts what the engineer has to work through', () => {
  const summary = summariseCorrosion(analyseComparison([
    metalLoss(),
    metalLoss({ 'Source Key NEW': 'new:2', 'Depth Growth (%WT/yr)': '-', 'Physics Warning': 'DEPTH_DECREASE' }),
    metalLoss({ 'Source Key NEW': 'new:3', 'Length NEW (mm)': '-' }),
  ]));

  assert.deepEqual(summary, {
    total: 3,
    metalLoss: 3,
    ffsReady: 2,
    // The unassessable feature is still growing; the count describes the line,
    // not the work list.
    activeGrowth: 2,
    unknownGrowth: 1,
    withWarnings: 1,
  });
});
