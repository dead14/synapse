import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_LAYERS,
  arcWidthDeg,
  buildSpoolModel,
  clockLabelFromDegrees,
  defaultFilters,
  filterSpoolFeatures,
  type SpoolFilters,
} from '../src/domain/spoolFeatures.ts';
import { axialTicks, niceStep } from '../src/components/spool/spoolScale.ts';

function anomalyRow(overrides: Record<string, unknown> = {}) {
  return {
    'Identif. OLD': 'A-1',
    'Identif. NEW': 'A-2',
    'Feature Type OLD': 'Metal Loss',
    'Feature Type NEW': 'Metal Loss',
    'Log Dist OLD (m)': 10.31,
    'Log Dist NEW (m)': 10.35,
    'Original Log Dist OLD (m)': 9.98,
    'Original Log Dist NEW (m)': 10.35,
    'Depth OLD (%WT)': 32,
    'Depth NEW (%WT)': 41,
    'Length OLD (mm)': 84,
    'Length NEW (mm)': 91,
    'Width OLD (mm)': 64,
    'Width NEW (mm)': 68,
    "O'Clock OLD": '5:30',
    "O'Clock NEW": '5:30',
    'Wall WT OLD (mm)': 8.7,
    'Wall WT NEW (mm)': 8.7,
    'ERF ASME OLD': 0.56,
    'ERF ASME NEW': 0.71,
    'Surface NEW': 'INT',
    'Joint No. NEW': 'J-12',
    'Dist GW NEW (m)': 1.42,
    'Depth Growth (%WT/yr)': 3,
    'Run Year OLD': 2023,
    'Run Year NEW': 2026,
    'Result Group': 'Anomaly',
    match_status: 'Matched',
    ...overrides,
  };
}

test('folds a comparison row into a current side, a previous side and their deltas', () => {
  const model = buildSpoolModel([anomalyRow()]);
  assert.equal(model.features.length, 1);

  const feature = model.features[0];
  assert.equal(feature.id, 'A-2');
  assert.equal(feature.maM, 10.35);
  assert.equal(feature.status, 'matched-growth');
  assert.equal(feature.depthDeltaPct, 9);
  assert.equal(feature.lengthDeltaMm, 7);
  assert.equal(feature.widthDeltaMm, 4);
  assert.equal(Number(feature.erfDelta?.toFixed(2)), 0.15);
  assert.equal(feature.intervalYears, 3);
  assert.equal(feature.clockLabel, '5:30');
  assert.equal(model.currentRun.label, 'ILI 2026');
  assert.equal(model.previousRun.label, 'ILI 2023');
  assert.equal(model.hasComparison, true);
});

test('derives remaining wall from the wall thickness and never guesses one', () => {
  const withWall = buildSpoolModel([anomalyRow()]).features[0];
  assert.equal(Number(withWall.current.remainingWtMm?.toFixed(3)), 5.133);
  assert.equal(Number(withWall.remainingWtDeltaMm?.toFixed(3)), -0.783);

  const withoutWall = buildSpoolModel([anomalyRow({
    'Wall WT OLD (mm)': '-',
    'Wall WT NEW (mm)': '-',
  })]).features[0];
  assert.equal(withoutWall.current.remainingWtMm, null);
  assert.equal(withoutWall.remainingWtDeltaMm, null);
});

test('a depth change inside the tool tolerance is not reported as growth', () => {
  const flat = buildSpoolModel([anomalyRow({ 'Depth NEW (%WT)': 32.4 })]).features[0];
  assert.equal(flat.status, 'matched-no-growth');
});

test('separates unmatched sides and the engine bypass bucket', () => {
  const onlyNew = buildSpoolModel([anomalyRow({
    'Identif. OLD': '-', 'Log Dist OLD (m)': '-', 'Depth OLD (%WT)': '-',
  })]).features[0];
  assert.equal(onlyNew.status, 'new');

  const onlyOld = buildSpoolModel([anomalyRow({
    'Identif. NEW': '-', 'Log Dist NEW (m)': '-', 'Depth NEW (%WT)': '-',
  })]).features[0];
  assert.equal(onlyOld.status, 'prev-only');
  assert.equal(onlyOld.maM, 10.31);

  // Clusters are parked by the engine rather than aligned, and that is a
  // statement about the alignment — not a new defect.
  const bypassed = buildSpoolModel([anomalyRow({
    'Result Group': 'Bypassed', 'Bypass Reason': 'Clustering',
  })]).features[0];
  assert.equal(bypassed.status, 'bypassed');
});

test('girth welds leave the anomaly set and become markers', () => {
  const model = buildSpoolModel([
    anomalyRow(),
    { 'Identif. NEW': 'GW-141', 'Feature Type NEW': 'Girth Weld', 'Log Dist NEW (m)': 12.5, 'Result Group': 'GW' },
  ]);
  assert.equal(model.features.length, 1);
  assert.deepEqual(model.welds.map((weld) => weld.id), ['GW-141']);
});

test('rows the reviewer excluded never reach the workspace', () => {
  const model = buildSpoolModel([anomalyRow({ __excluded: true })]);
  assert.equal(model.features.length, 0);
  assert.equal(model.extentM, null);
});

test('the clock window filter wraps past twelve o\'clock', () => {
  const rows = [
    anomalyRow({ 'Identif. NEW': 'top', "O'Clock NEW": '12:30', 'Log Dist NEW (m)': 10 }),
    anomalyRow({ 'Identif. NEW': 'side', "O'Clock NEW": '3:00', 'Log Dist NEW (m)': 11 }),
    anomalyRow({ 'Identif. NEW': 'bottom', "O'Clock NEW": '6:00', 'Log Dist NEW (m)': 12 }),
  ];
  const model = buildSpoolModel(rows);
  const base: SpoolFilters = { ...defaultFilters(0, 20), clockFromDeg: 300, clockToDeg: 60 };

  const kept = filterSpoolFeatures(model.features, base, DEFAULT_LAYERS).map((feature) => feature.id);
  assert.deepEqual(kept, ['top']);

  const wide = filterSpoolFeatures(
    model.features,
    { ...base, clockFromDeg: 0, clockToDeg: 360 },
    DEFAULT_LAYERS,
  );
  assert.equal(wide.length, 3);
});

test('layer switches and the depth band narrow the same set the panes draw', () => {
  const rows = [
    anomalyRow({ 'Identif. NEW': 'ml', 'Depth NEW (%WT)': 45, 'Log Dist NEW (m)': 10 }),
    anomalyRow({
      'Identif. NEW': 'dent', 'Feature Type NEW': 'Dent', 'Feature Type OLD': 'Dent',
      'Depth NEW (%WT)': 12, 'Log Dist NEW (m)': 11,
    }),
  ];
  const model = buildSpoolModel(rows);
  const filters = defaultFilters(0, 20);

  const withoutDents = filterSpoolFeatures(model.features, filters, { ...DEFAULT_LAYERS, dent: false });
  assert.deepEqual(withoutDents.map((feature) => feature.id), ['ml']);

  const deepOnly = filterSpoolFeatures(model.features, { ...filters, depthBand: '40-60' }, DEFAULT_LAYERS);
  assert.deepEqual(deepOnly.map((feature) => feature.id), ['ml']);
});

test('a defect width becomes an arc only when the diameter is known', () => {
  assert.equal(arcWidthDeg(68, null), null);
  assert.equal(arcWidthDeg(null, 610), null);
  assert.equal(Number(arcWidthDeg(68, 610)?.toFixed(2)), 12.77);
});

test('clock labels round-trip through degrees', () => {
  assert.equal(clockLabelFromDegrees(0), '12:00');
  assert.equal(clockLabelFromDegrees(165), '5:30');
  assert.equal(clockLabelFromDegrees(270), '9:00');
  assert.equal(clockLabelFromDegrees(null), '—');
});

test('both panes take their axial ticks from one ladder', () => {
  assert.equal(niceStep(12.12), 2);
  assert.deepEqual(axialTicks(6.67, 18.79), [8, 10, 12, 14, 16, 18]);
  assert.deepEqual(axialTicks(0, 4), [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4]);
});
