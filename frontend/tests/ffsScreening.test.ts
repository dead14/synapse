import test from 'node:test';
import assert from 'node:assert/strict';

import { processRow } from '../src/lib/ffs/calcEngine.ts';
import {
  buildActionRegister,
  buildClusters,
  buildKpis,
  findInteractions,
  formatLife,
  parseClockHour,
  screenResults,
  severityOf,
} from '../src/lib/ffs/screening.ts';
import {
  buildDistributionTable,
  buildLdBins,
  buildWorstTable,
  DEFAULT_DEPTH_BUCKETS,
} from '../src/lib/ffs/statistics.ts';
import { buildEnvelopeCurves } from '../src/lib/ffs/chartData.ts';
import { buildNarrative } from '../src/lib/ffs/narrative.ts';
import type { FfsReportContext } from '../src/lib/ffs/reportCase.ts';
import { DEFAULT_SCREENING_CONFIG, type FfsConfig, type FfsScreeningConfig } from '../src/lib/ffs/types.ts';

const config: FfsConfig = {
  lineName: 'Test line',
  method: 'modified',
  modifiedSa: 'smys69',
  iliDate: new Date('2024-01-01'),
  highlightYears: 5,
};

const reportContext: FfsReportContext = {
  inspectionDateIso: '2024-01-01',
  asOfDateIso: '2026-08-03',
};

function row(overrides: Partial<Record<string, string>> = {}): Record<string, string> {
  return {
    'LD [m]': '100',
    Section: 'Sec A',
    Surface: 'External',
    'Max Depth [%]': '40',
    'Length [mm]': '50',
    'Width [mm]': '80',
    'Orient. (hrs:mins)': '6:00',
    'Nominal Wall Thickness [mm]': '9.3',
    'CR Depth [mm/y]': '0.1',
    'CR Length [mm/y]': '1',
    'Design Factor': '0.72',
    'Outer Diameter Ds': '508',
    'SMYS [MPa]': '390',
    'Operating Pressure P₀ [MPa]': '9.46',
    ...overrides,
  };
}

function screenOne(overrides: Partial<Record<string, string>> = {}, screening = DEFAULT_SCREENING_CONFIG) {
  return screenResults([processRow(row(overrides), config)], config, screening)[0];
}

test('the conservative tier applies the depth and both-end length tolerances', () => {
  const screening: FfsScreeningConfig = {
    ...DEFAULT_SCREENING_CONFIG,
    depthTolerancePct: 10,
    lengthToleranceMm: 10,
  };
  const item = screenOne({ 'Max Depth [%]': '40', 'Length [mm]': '50' }, screening);

  assert.equal(item.conservative.depthPct, 50, 'depth gains the tolerance as absolute percentage points');
  assert.equal(item.conservative.lengthMm, 70, 'length gains the tolerance at each end');
  assert.ok(
    item.conservative.ERF > item.nominal.ERF,
    'a deeper, longer feature must screen worse than the reported one',
  );
});

test('the forecast tier grows depth radially from the conservative basis', () => {
  const screening: FfsScreeningConfig = {
    ...DEFAULT_SCREENING_CONFIG,
    depthTolerancePct: 0,
    lengthToleranceMm: 0,
    growthBasis: 'uniform',
    growthRateMmPerYear: 0.93,
    forecastYears: 5,
  };
  const item = screenOne({ 'Max Depth [%]': '40', 'CR Length [mm/y]': '0' }, screening);

  // 0.93 mm/y over 5 years on a 9.3 mm wall adds 4.65 mm, i.e. 50 percentage points.
  assert.equal(Math.round(item.forecast.depthPct), 90);
  assert.ok(item.forecast.ERF > item.conservative.ERF);
});

test('the measured basis forecasts each feature at its own reported rate', () => {
  const screening: FfsScreeningConfig = {
    ...DEFAULT_SCREENING_CONFIG,
    depthTolerancePct: 0,
    lengthToleranceMm: 0,
    growthBasis: 'measured',
    growthRateMmPerYear: 0.93,
    forecastYears: 5,
  };
  // The row reports 0.1 mm/y, so the configured 0.93 mm/y must not be used.
  const item = screenOne({ 'Max Depth [%]': '40', 'CR Length [mm/y]': '0' }, screening);

  assert.equal(item.forecast.growthRateMmPerYear, 0.1);
  // 0.1 mm/y over 5 years on a 9.3 mm wall adds 0.5 mm, i.e. ~5.4 points.
  assert.equal(Math.round(item.forecast.depthPct), 45);
});

test('the measured basis falls back to the configured rate when a feature reports none', () => {
  const screening: FfsScreeningConfig = {
    ...DEFAULT_SCREENING_CONFIG,
    growthBasis: 'measured',
    growthRateMmPerYear: 0.5,
  };
  const item = screenOne({ 'CR Depth [mm/y]': '0' }, screening);

  assert.equal(item.forecast.growthRateMmPerYear, 0.5);
});

test('a tier past the 80 %WT applicability limit is flagged rather than presented as a code result', () => {
  const screening: FfsScreeningConfig = { ...DEFAULT_SCREENING_CONFIG, depthTolerancePct: 10 };
  const item = screenOne({ 'Max Depth [%]': '75' }, screening);

  assert.equal(item.nominal.maxDepthPct, 75);
  assert.equal(item.conservative.depthPct, 85);
  assert.equal(item.conservative.beyondDepthLimit, true, 'the tolerance tier is past the B31G domain');
  assert.equal(item.conservative.severity, 'fail');
});

test('a feature already past ERF 1 reports no remaining life', () => {
  const item = screenOne({ 'Max Depth [%]': '78', 'Length [mm]': '400' });
  assert.ok(item.conservative.ERF >= 1);
  assert.equal(item.lifeToErf1, 0);
});

test('life to ERF 1 is unbounded when nothing is growing', () => {
  const screening: FfsScreeningConfig = {
    ...DEFAULT_SCREENING_CONFIG,
    growthBasis: 'uniform',
    growthRateMmPerYear: 0,
  };
  const item = screenOne({ 'Max Depth [%]': '20', 'Length [mm]': '30' }, screening);

  assert.equal(item.lifeToErf1, null);
  assert.equal(item.lifeToErf1Status, 'insufficient-growth-basis');
  assert.equal(formatLife(item.lifeToErf1, item.lifeToErf1Status, 30), 'Not calculated');
});

test('nominal life does not turn the numerical search bound into a service-limit date', () => {
  const result = processRow(
    row({
      'Max Depth [%]': '20',
      'Length [mm]': '30',
      'CR Depth [mm/y]': '0.001',
      'CR Length [mm/y]': '0',
    }),
    { ...config, analysisHorizonYears: 30 },
  );

  assert.equal(result.lifeStatus, 'not-reached-within-horizon');
  assert.equal(result.expectedLife, null);
  assert.equal(result.yearService, null);
  assert.equal(result.failureCriteria, null);
  assert.equal(result.atFailure_ERF, null);
  assert.equal(result.atFailure_depth, null);
  assert.equal(result.atFailure_Sf, null);
});

test('nominal life is not calculated without a positive depth or length growth basis', () => {
  const result = processRow(
    row({
      'CR Depth [mm/y]': '0',
      'CR Length [mm/y]': '0',
    }),
    { ...config, analysisHorizonYears: 30 },
  );

  assert.equal(result.lifeStatus, 'insufficient-growth-basis');
  assert.equal(result.expectedLife, null);
  assert.equal(result.yearService, null);
  assert.equal(result.failureCriteria, null);
});

test('a calculated life retains its governing criterion and service-limit date', () => {
  const result = processRow(
    row({
      'Max Depth [%]': '70',
      'CR Depth [mm/y]': '0.93',
      'CR Length [mm/y]': '0',
    }),
    { ...config, analysisHorizonYears: 30 },
  );

  assert.equal(result.lifeStatus, 'calculated');
  assert.ok(result.expectedLife !== null && result.expectedLife > 0 && result.expectedLife < 2);
  assert.ok(result.failureCriteria === 'Depth = 80%' || result.failureCriteria === 'ERF = 1');
  assert.match(result.yearService ?? '', /^2024-/);
  assert.ok(result.atFailure_depth !== null);
});

test('life to ERF 1 shortens as the assumed growth rate rises', () => {
  const uniform: FfsScreeningConfig = { ...DEFAULT_SCREENING_CONFIG, growthBasis: 'uniform' };
  const slow = screenOne({ 'Max Depth [%]': '35' }, { ...uniform, growthRateMmPerYear: 0.05 });
  const fast = screenOne({ 'Max Depth [%]': '35' }, { ...uniform, growthRateMmPerYear: 0.3 });

  assert.equal(slow.lifeToErf1Status, 'not-reached-within-horizon');
  assert.equal(slow.lifeToErf1, null);
  assert.equal(fast.lifeToErf1Status, 'calculated');
  assert.ok(fast.lifeToErf1 !== null && fast.lifeToErf1 > 0);
});

test('life to ERF 1 and the nominal expected life share the measured growth rate', () => {
  // The two figures answer different questions — one includes ILI tolerance, the
  // other is the code result — but under the measured basis they must at least
  // be projected from the same rate, which is what used to differ silently.
  const item = screenOne({ 'Max Depth [%]': '45', 'CR Depth [mm/y]': '0.2' });

  assert.equal(item.forecast.growthRateMmPerYear, 0.2);
  assert.ok(
    item.lifeToErf1 <= item.nominal.expectedLife,
    'the tolerance-adjusted life cannot outlast the as-reported life on the same rate',
  );
});

test('severity separates the review band from outright rejection', () => {
  const screening = { ...DEFAULT_SCREENING_CONFIG, reviewBandErf: 0.9, depthRejectionPct: 80 };

  assert.equal(severityOf(0.5, 30, screening), 'pass');
  assert.equal(severityOf(0.95, 30, screening), 'review');
  assert.equal(severityOf(1, 30, screening), 'fail', 'ERF equal to the limit is not acceptable');
  assert.equal(severityOf(1.01, 30, screening), 'fail');
  assert.equal(severityOf(0.2, 85, screening), 'fail', 'the depth limit rejects regardless of ERF');
  assert.equal(severityOf(Number.POSITIVE_INFINITY, 10, screening), 'fail');
});

test('clock strings parse to decimal hours and flag the bottom quadrant', () => {
  assert.equal(parseClockHour('6:00'), 6);
  assert.equal(parseClockHour('05:30'), 5.5);
  assert.equal(parseClockHour('12:00'), 0, 'twelve is the top of the pipe, i.e. hour zero');
  assert.equal(parseClockHour(''), null);
  assert.equal(parseClockHour('nonsense'), null);

  assert.equal(screenOne({ 'Orient. (hrs:mins)': '5:30' }).bottomQuadrant, true);
  assert.equal(screenOne({ 'Orient. (hrs:mins)': '1:00' }).bottomQuadrant, false);
});

test('clusters group only features within the grouping distance', () => {
  const items = screenResults(
    ['10', '15', '19', '400', '404', '900'].map((ld) => processRow(row({ 'LD [m]': ld }), config)),
    config,
    DEFAULT_SCREENING_CONFIG,
  );
  const clusters = buildClusters(items);

  assert.equal(clusters.length, 2, 'the lone feature at 900 m forms no zone');
  assert.deepEqual(
    clusters.map((cluster) => cluster.members.length),
    [3, 2],
  );
  assert.equal(clusters[0].startLd, 10);
  assert.equal(clusters[0].endLd, 19);
});

test('the axial interaction screen flags only pairs inside the t-multiple', () => {
  // Wall 9.3 mm at 3t gives a 27.9 mm threshold. Two 50 mm features centred
  // 0.06 m apart sit 10 mm edge to edge; the third is far beyond the threshold.
  const items = screenResults(
    ['1', '1.06', '5'].map((ld) => processRow(row({ 'LD [m]': ld, 'Length [mm]': '50' }), config)),
    config,
    DEFAULT_SCREENING_CONFIG,
  );
  const pairs = findInteractions(items, DEFAULT_SCREENING_CONFIG);

  assert.equal(pairs.length, 1);
  assert.equal(Math.round(pairs[0].edgeGapMm), 10);
  assert.equal(Math.round(pairs[0].thresholdMm * 10) / 10, 27.9);
});

test('priority escalates on depth, capacity, and remaining life', () => {
  assert.equal(screenOne({ 'Max Depth [%]': '75' }).priority, 'High', 'deep metal loss is always high');
  assert.equal(
    screenOne({ 'Max Depth [%]': '10', 'Length [mm]': '20', 'CR Depth [mm/y]': '0' }, {
      ...DEFAULT_SCREENING_CONFIG,
      growthRateMmPerYear: 0,
    }).priority,
    'Routine',
    'a shallow, static feature stays routine',
  );
});

test('the action register ranks by priority and dates the most severe as immediate', () => {
  const items = screenResults(
    [
      processRow(row({ 'LD [m]': '10', 'Max Depth [%]': '15', 'Length [mm]': '20' }), config),
      processRow(row({ 'LD [m]': '20', 'Max Depth [%]': '78', 'Length [mm]': '400' }), config),
    ],
    config,
    DEFAULT_SCREENING_CONFIG,
  );
  const actions = buildActionRegister(items, DEFAULT_SCREENING_CONFIG, reportContext);

  assert.equal(actions[0].code, 'ACT-01');
  assert.equal(actions[0].target.nominal.ld, 20, 'the worst feature leads the register');
  assert.equal(actions[0].due, 'Immediate');
  assert.match(actions[0].recommendation, /pressure control/i);
});

test('the action register removes only evidence-qualified permanent repairs', () => {
  const items = screenResults(
    [
      processRow(row({
        'Feature ID': 'REPAIR-CREDITED',
        'LD [m]': '10',
        'Repair Status': 'Permanent repair verified',
        'Repair Method': 'Cut and replace',
        'Repair Date': '2025-01-10',
        'Repair Reference': 'WO-10',
      }), config),
      processRow(row({
        'Feature ID': 'REPAIR-INCOMPLETE',
        'LD [m]': '20',
        'Repair Status': 'Permanent repair verified',
        'Repair Method': '',
        'Repair Date': '',
        'Repair Reference': '',
      }), config),
    ],
    config,
    DEFAULT_SCREENING_CONFIG,
  );

  const actions = buildActionRegister(items, DEFAULT_SCREENING_CONFIG, reportContext);

  assert.deepEqual(actions.map((action) => action.target.nominal.featureId), ['REPAIR-INCOMPLETE']);
});

test('temporary repair notes and source text cannot suppress an immediate pressure-control action', () => {
  const item = screenOne({
    'Feature ID': 'TEMP-UNSAFE',
    'Max Depth [%]': '78',
    'Length [mm]': '400',
    'Repair Status': 'Temporary repair',
    'Repair Method': 'Clamp',
    'Repair Date': '2025-01-01',
    'Repair Reference': 'TEMP-1',
    Recommendation: 'Monitor annually',
  });

  const action = buildActionRegister([item], DEFAULT_SCREENING_CONFIG, reportContext)[0];

  assert.equal(action.due, 'Immediate');
  assert.match(action.recommendation, /pressure control/i);
  assert.match(action.recommendation, /temporary repair remains active/i);
  assert.match(action.recommendation, /Monitor annually/i);
});

test('an exact ERF limit and a rounded zero life both require an immediate action', () => {
  const nominal = processRow(row({ 'Feature ID': 'EXACT-LIMIT', 'Max Depth [%]': '35' }), config);
  const initial = screenResults([nominal], config, DEFAULT_SCREENING_CONFIG)[0];
  nominal.p0 /= initial.conservative.ERF;
  const exactLimit = screenResults([nominal], config, DEFAULT_SCREENING_CONFIG)[0];
  assert.ok(Math.abs(exactLimit.conservative.ERF - 1) < 1e-12);
  assert.equal(exactLimit.priority, 'High');
  exactLimit.conservative.ERF = 1;
  assert.equal(
    buildActionRegister([exactLimit], DEFAULT_SCREENING_CONFIG, reportContext)[0].due,
    'Immediate',
  );

  const roundedNow = screenOne({ 'Feature ID': 'ROUNDED-NOW', 'Max Depth [%]': '35' });
  roundedNow.conservative.ERF = 0.999;
  roundedNow.lifeToErf1 = 0;
  roundedNow.lifeToErf1Status = 'calculated';
  const roundedAction = buildActionRegister([roundedNow], DEFAULT_SCREENING_CONFIG, reportContext)[0];
  assert.equal(roundedAction.due, 'Immediate');
  assert.match(roundedAction.recommendation, /capacity limit/i);
});

test('KPIs report the governing feature in each dimension', () => {
  const items = screenResults(
    [
      processRow(row({ 'LD [m]': '10', 'Max Depth [%]': '20', 'Orient. (hrs:mins)': '1:00' }), config),
      processRow(row({ 'LD [m]': '20', 'Max Depth [%]': '70', 'Orient. (hrs:mins)': '6:00' }), config),
    ],
    config,
    DEFAULT_SCREENING_CONFIG,
  );
  const kpis = buildKpis(items);

  assert.equal(kpis.totalCount, 2);
  assert.equal(kpis.maxNominalErf?.nominal.ld, 20);
  assert.equal(kpis.minLife?.nominal.ld, 20);
  assert.equal(kpis.bottomQuadrantCount, 1);
});

test('KPIs stay defined for an empty population', () => {
  const kpis = buildKpis([]);
  assert.equal(kpis.totalCount, 0);
  assert.equal(kpis.maxNominalErf, null);
  assert.equal(kpis.escalatedCount, 0);
});

test('log-distance bins span the dataset at the requested size', () => {
  const items = screenResults(
    ['30', '520', '1780'].map((ld) => processRow(row({ 'LD [m]': ld }), config)),
    config,
    DEFAULT_SCREENING_CONFIG,
  );
  const bins = buildLdBins(items, 500);

  assert.equal(bins.length, 4);
  assert.equal(bins[0].start, 0);
  assert.equal(bins[3].end, 2000);
});

test('the distribution table conserves the population across bins and bands', () => {
  const items = screenResults(
    [
      processRow(row({ 'LD [m]': '100', 'Max Depth [%]': '15', Surface: 'Internal' }), config),
      processRow(row({ 'LD [m]': '150', 'Max Depth [%]': '25', Surface: 'External' }), config),
      processRow(row({ 'LD [m]': '700', 'Max Depth [%]': '55', Surface: 'Internal' }), config),
    ],
    config,
    DEFAULT_SCREENING_CONFIG,
  );
  const table = buildDistributionTable(items, 500, DEFAULT_DEPTH_BUCKETS);

  assert.equal(table.totals.total, 3, 'every feature lands in exactly one cell');
  assert.equal(
    table.rows.reduce((sum, r) => sum + r.total, 0),
    3,
  );
  const internal = table.totals.cells.reduce((sum, cell) => sum + cell.internal, 0);
  const external = table.totals.cells.reduce((sum, cell) => sum + cell.external, 0);
  assert.equal(internal, 2);
  assert.equal(external, 1);
});

test('the worst-per-bin table honours the selected ranking criterion', () => {
  const items = screenResults(
    [
      processRow(row({ 'LD [m]': '100', 'Max Depth [%]': '60', 'CR Depth [mm/y]': '0.01' }), config),
      processRow(row({ 'LD [m]': '200', 'Max Depth [%]': '45', 'CR Depth [mm/y]': '0.5' }), config),
    ],
    config,
    DEFAULT_SCREENING_CONFIG,
  );

  const byDepth = buildWorstTable(items, 500, 'depth');
  const byLife = buildWorstTable(items, 500, 'life');

  assert.equal(byDepth[0].count, 2);
  assert.equal(byDepth[0].worst?.nominal.maxDepthPct, 60, 'deepest wins on the depth criterion');
  assert.equal(byLife[0].worst?.nominal.ld, 200, 'the fastest-growing feature wins on life');
});

test('the screening envelope gives shallower allowable depth as anomalies lengthen', () => {
  const items = screenResults([processRow(row(), config)], config, DEFAULT_SCREENING_CONFIG);
  const curves = buildEnvelopeCurves(items, config, 400, 40);

  assert.equal(curves.length, 1, 'one curve per distinct wall thickness');
  const points = curves[0].points;
  assert.ok(points.length > 5);
  assert.ok(
    points[points.length - 1].y < points[0].y,
    'the acceptance envelope falls away as length grows',
  );
  assert.ok(points.every((point) => point.y > 0 && point.y <= 100));
});

test('the narrative reports the population split and names the governing feature', () => {
  const items = screenResults(
    [
      processRow(row({ 'LD [m]': '100', 'Max Depth [%]': '20' }), config),
      processRow(row({ 'LD [m]': '900', 'Max Depth [%]': '78', 'Length [mm]': '400' }), config),
    ],
    config,
    DEFAULT_SCREENING_CONFIG,
  );
  const blocks = buildNarrative(items, config, DEFAULT_SCREENING_CONFIG);
  const prose = blocks
    .filter((block) => block.kind === 'paragraph')
    .map((block) => (block as { text: string }).text)
    .join(' ');

  assert.match(prose, /2 metal-loss features/);
  assert.match(prose, /governing feature is located at log distance 900/);
  assert.ok(blocks.some((block) => block.kind === 'table'));
  assert.ok(blocks.some((block) => block.kind === 'formula'));
});

test('the narrative degrades gracefully with no features', () => {
  const blocks = buildNarrative([], config, DEFAULT_SCREENING_CONFIG);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].kind, 'heading');
});
