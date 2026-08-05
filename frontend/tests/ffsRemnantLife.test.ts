import assert from 'node:assert/strict';
import test from 'node:test';

import { processRow } from '../src/lib/ffs/calcEngine.ts';
import { screenResults, lengthApplicationFor } from '../src/lib/ffs/screening.ts';
import { computeRemnantLife, designLifeUsage } from '../src/lib/ffs/remnantLife.ts';
import {
  buildFfsReportCase,
  repairProgrammeTargets,
  type FfsReportContext,
} from '../src/lib/ffs/reportCase.ts';
import {
  mapAlignmentRowsToFfs,
  resolveDesignFactor,
  alignmentSectionOptions,
  type AlignmentEngineeringInputs,
} from '../src/lib/ffs/alignmentImport.ts';
import { buildSectionGrowthSummary } from '../src/lib/ffs/sectionSummary.ts';
import { DEFAULT_SCREENING_CONFIG, type FfsConfig } from '../src/lib/ffs/types.ts';

const config: FfsConfig = {
  lineName: 'Remnant life line',
  method: 'modified',
  modifiedSa: 'smys69',
  iliDate: new Date('2024-08-23'),
  highlightYears: 5,
  analysisHorizonYears: 30,
};

const reportContext: FfsReportContext = {
  inspectionDateIso: '2024-08-23',
  asOfDateIso: '2026-08-03',
  reviewThresholdYears: 5,
};

function row(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    'Feature ID': 'F-001',
    'LD [m]': '100',
    Section: 'Aerial Section',
    Surface: 'External',
    'Max Depth [%]': '44',
    'Length [mm]': '12',
    'Width [mm]': '54',
    'Orient. (hrs:mins)': '5:38',
    'Nominal Wall Thickness [mm]': '9.3',
    'CR Depth [mm/y]': '0.33',
    'CR Length [mm/y]': '0.96',
    'Design Factor': '0.72',
    'Outer Diameter Ds': '219.1',
    'SMYS [MPa]': '290',
    'Operating Pressure P₀ [MPa]': '9.35',
    ...overrides,
  };
}

/* ── The 80 %WT criterion ──────────────────────────────────────────────── */

test('the depth criterion reproduces the (0.80 − d/t) · t / CR arithmetic', () => {
  // Worked from the reference residual-life assessment: 44 %WT on a 9.30 mm
  // wall growing at 0.33 mm/y reaches the 80 % limit in (0.80 − 0.44) × 9.30 /
  // 0.33 = 10.14 years.
  const result = processRow(row(), config);

  assert.equal(result.remnantLife.status, 'calculated');
  assert.ok(result.remnantLife.depthLimitYears !== null);
  assert.ok(Math.abs(result.remnantLife.depthLimitYears! - 10.14) < 0.02);
});

test('the governing limit is the earlier of the two criteria', () => {
  const result = processRow(row({ 'Max Depth [%]': '70', 'CR Depth [mm/y]': '0.5' }), config);
  const { depthLimitYears, erfLimitYears, years, governingLimit } = result.remnantLife;

  const candidates = [depthLimitYears, erfLimitYears].filter((value): value is number => value !== null);
  assert.ok(candidates.length > 0);
  assert.equal(years, Math.min(...candidates));
  assert.equal(governingLimit, depthLimitYears === years ? 'Depth = 80%' : 'ERF = 1');
});

/* ── Length growth actually reaches the projection ─────────────────────── */

test('a lengthening defect reaches ERF 1 sooner than a static one', () => {
  // The old depth-only search could not see this at all: both rows below have
  // the same depth rate, and only the axial rate differs.
  const staticLength = processRow(
    row({ 'Max Depth [%]': '55', 'Length [mm]': '60', 'CR Length [mm/y]': '0' }),
    config,
  );
  const lengthening = processRow(
    row({ 'Max Depth [%]': '55', 'Length [mm]': '60', 'CR Length [mm/y]': '8' }),
    config,
  );

  assert.ok(staticLength.remnantLife.erfLimitYears !== null);
  assert.ok(lengthening.remnantLife.erfLimitYears !== null);
  assert.ok(
    lengthening.remnantLife.erfLimitYears! < staticLength.remnantLife.erfLimitYears!,
    'growing the axial length must shorten the time to ERF 1',
  );
});

test('an unavailable length rate is reported as held constant, not as a measured zero', () => {
  const result = processRow(row({ 'CR Length [mm/y]': '0' }), config);
  assert.equal(result.remnantLife.lengthHeldConstant, true);
  assert.equal(result.remnantLife.lengthRateMmPerYear, 0);
});

test('the uniform growth basis does not leave the axial rate on the measured value', () => {
  const nominal = processRow(row({ 'CR Length [mm/y]': '4' }), config);
  const measured = lengthApplicationFor(nominal, DEFAULT_SCREENING_CONFIG);
  const uniform = lengthApplicationFor(nominal, {
    ...DEFAULT_SCREENING_CONFIG,
    growthBasis: 'uniform',
    growthRateMmPerYear: 0.4,
  });

  assert.equal(measured.rateMmPerYear, 4);
  assert.equal(measured.available, true);
  // Distrusting the run pair has to apply to both dimensions or neither.
  assert.equal(uniform.rateMmPerYear, 0);
  assert.equal(uniform.available, false);
  assert.equal(uniform.analysisBasis, 'uniform-assumption');
});

/* ── Design life ───────────────────────────────────────────────────────── */

test('remnant life is not reported above the original design life', () => {
  // 20 %WT on a 9.30 mm wall at 0.15 mm/y reaches the depth limit in 37.2 years,
  // comfortably inside the horizon and comfortably past a 25-year design life.
  const slow = row({ 'Max Depth [%]': '20', 'CR Depth [mm/y]': '0.15', 'CR Length [mm/y]': '0' });
  const uncapped = processRow(slow, { ...config, analysisHorizonYears: 100 });
  const capped = processRow(slow, {
    ...config,
    analysisHorizonYears: 100,
    serviceLife: { designLifeYears: 25, commissioningYear: 1985 },
  });

  assert.ok(uncapped.remnantLife.years !== null && uncapped.remnantLife.years > 25);
  assert.equal(capped.remnantLife.years, 25);
  assert.equal(capped.remnantLife.governingLimit, 'Original design life');
  assert.equal(capped.remnantLife.designLifeCapApplied, true);
});

test('the design-life cap never manufactures a figure where no limit was reached', () => {
  const result = processRow(
    row({ 'Max Depth [%]': '20', 'CR Depth [mm/y]': '0', 'CR Length [mm/y]': '0' }),
    { ...config, serviceLife: { designLifeYears: 25, commissioningYear: 1985 } },
  );

  assert.equal(result.remnantLife.years, null);
  assert.equal(result.remnantLife.status, 'insufficient-growth-basis');
  assert.equal(result.remnantLife.designLifeCapApplied, false);
});

test('design life usage reports a line already past its design life as negative', () => {
  const usage = designLifeUsage(
    { designLifeYears: 25, commissioningYear: 1985 },
    new Date('2024-08-23'),
  );

  assert.ok(usage !== null);
  assert.ok(Math.abs(usage!.ageAtInspectionYears - 39.64) < 0.1);
  assert.ok(usage!.designLifeRemainingYears < 0);
});

/* ── Due dates and the horizon ─────────────────────────────────────────── */

test('a due date is only issued when a limit is reached inside the horizon', () => {
  const reached = processRow(row({ 'Max Depth [%]': '75', 'CR Depth [mm/y]': '0.5' }), config);
  const notReached = processRow(
    row({ 'Max Depth [%]': '20', 'CR Depth [mm/y]': '0.001', 'CR Length [mm/y]': '0' }),
    { ...config, analysisHorizonYears: 5 },
  );

  assert.match(reached.remnantLife.dueDateIso ?? '', /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(notReached.remnantLife.status, 'not-reached-within-horizon');
  assert.equal(notReached.remnantLife.dueDateIso, null);
});

test('the ERF search is bounded by the horizon rather than extrapolated past it', () => {
  const short = computeRemnantLife({
    geometry: {
      wallThickness: 9.3,
      outerDiameter: 219.1,
      smysMpa: 290,
      safetyFactor: 1 / 0.72,
      operatingPressureMpa: 9.35,
    },
    method: 'modified',
    flowStressMode: 'smys69',
    basis: 'as-reported',
    startDepthPct: 20,
    startLengthMm: 30,
    depthRateMmPerYear: 0.01,
    lengthRateMmPerYear: 0,
    lengthRateAvailable: false,
    horizonYears: 2,
    iliDate: new Date('2024-08-23'),
    service: { designLifeYears: null, commissioningYear: null },
  });

  assert.equal(short.years, null);
  assert.equal(short.status, 'not-reached-within-horizon');
});

/* ── Line-level remnant life ───────────────────────────────────────────── */

test('the line remnant life is the shortest among its active features', () => {
  const items = screenResults(
    [
      processRow(row({ 'Feature ID': 'A', 'LD [m]': '100', 'Max Depth [%]': '71', 'CR Depth [mm/y]': '0.53' }), config),
      processRow(row({ 'Feature ID': 'B', 'LD [m]': '200', 'Max Depth [%]': '44', 'CR Depth [mm/y]': '0.33' }), config),
      processRow(row({ 'Feature ID': 'C', 'LD [m]': '300', 'Max Depth [%]': '30', 'CR Depth [mm/y]': '0.10' }), config),
    ],
    config,
    DEFAULT_SCREENING_CONFIG,
  );

  const reportCase = buildFfsReportCase(items, reportContext);

  assert.equal(reportCase.remnantLife.governing?.nominal.featureId, 'A');
  assert.equal(reportCase.remnantLife.years, items[0].nominal.remnantLife.years);
  assert.equal(reportCase.remnantLife.dueDateIso, items[0].nominal.remnantLife.dueDateIso);
});

test('the repair programme figure excludes the features it assumes replaced', () => {
  const items = screenResults(
    [
      // Reaches the depth limit in about 1.7 years, so it is inside the 5-year
      // review threshold and enters the repair programme.
      processRow(row({ 'Feature ID': 'SHORT', 'LD [m]': '100', 'Max Depth [%]': '71', 'CR Depth [mm/y]': '0.5' }), config),
      processRow(row({ 'Feature ID': 'LONG', 'LD [m]': '200', 'Max Depth [%]': '44', 'CR Depth [mm/y]': '0.33' }), config),
    ],
    config,
    DEFAULT_SCREENING_CONFIG,
  );

  const targets = repairProgrammeTargets(items, 5);
  const reportCase = buildFfsReportCase(items, reportContext);

  assert.deepEqual(targets.map((item) => item.nominal.featureId), ['SHORT']);
  assert.equal(reportCase.remnantLife.governing?.nominal.featureId, 'SHORT');
  assert.equal(reportCase.remnantLifeAfterRepairProgramme.governing?.nominal.featureId, 'LONG');
  assert.ok(
    reportCase.remnantLifeAfterRepairProgramme.years! > reportCase.remnantLife.years!,
    'removing the governing feature must extend the line figure',
  );
});

test('a temporary repair stays in the repair programme regardless of its remnant life', () => {
  const items = screenResults(
    [processRow(row({ 'Repair Status': 'Temporary repair', 'Max Depth [%]': '20', 'CR Depth [mm/y]': '0.02' }), config)],
    config,
    DEFAULT_SCREENING_CONFIG,
  );

  assert.equal(repairProgrammeTargets(items, 5).length, 1);
});

/* ── Per-section design factor ─────────────────────────────────────────── */

const engineering: AlignmentEngineeringInputs = {
  outerDiameterMm: 219.1,
  smysMpa: 290,
  designFactor: 0.72,
  operatingPressureMpa: 9.35,
  fallbackDepthGrowthMmPerYear: 0,
  fallbackLengthGrowthMmPerYear: 0,
  sectionDesignFactors: [
    { section: 'River Crossing RC#86', designFactor: 0.6 },
    { section: 'Aerial Section', designFactor: 0.72 },
  ],
};

test('a section override wins over the line default and records its source', () => {
  assert.deepEqual(resolveDesignFactor('River Crossing RC#86', engineering), {
    designFactor: 0.6,
    source: 'section-override',
  });
  assert.deepEqual(resolveDesignFactor('Aerial Section', engineering), {
    designFactor: 0.72,
    source: 'section-override',
  });
  assert.deepEqual(resolveDesignFactor('Unnamed stretch', engineering), {
    designFactor: 0.72,
    source: 'line-default',
  });
});

test('section matching survives the whitespace and case a second run introduces', () => {
  assert.equal(resolveDesignFactor('  river crossing   RC#86 ', engineering).designFactor, 0.6);
});

function alignmentRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    'Match/Unmatch': 'Matched',
    'Source Key OLD': 'old:1',
    'Source Key NEW': 'new:1',
    'Identif. NEW': 'A-1',
    'Log Dist NEW (m)': 658.019,
    'Section NEW': 'River Crossing RC#86',
    'Surface NEW': 'External',
    'Depth NEW (%WT)': 58,
    'Length NEW (mm)': 31,
    'Width NEW (mm)': 99,
    "O'Clock NEW": '09:44',
    'Wall WT NEW (mm)': 9.3,
    'Run Year OLD': 2012,
    'Run Year NEW': 2024,
    'Depth Growth (%WT/yr)': 4.6,
    'Length Growth (mm/yr)': 2.48,
    ...overrides,
  };
}

test('the crossing is assessed at its own design factor, not the line-pipe one', () => {
  const mapped = mapAlignmentRowsToFfs(
    [alignmentRow() as never],
    engineering,
    'session-1',
    { selectedKeys: new Set(['new:1']) },
  );

  assert.equal(mapped.accepted.length, 1);
  assert.equal(mapped.accepted[0].row['Design Factor'], '0.6');
  assert.equal(mapped.accepted[0].row['Design Factor Source'], 'section-override');
  assert.equal(mapped.accepted[0].provenance.designFactor, 0.6);
  assert.equal(mapped.accepted[0].provenance.section, 'River Crossing RC#86');
});

test('a lower design factor lowers the safe pressure and raises the ERF', () => {
  const atLinePipe = processRow(row({ 'Design Factor': '0.72' }), config);
  const atCrossing = processRow(row({ 'Design Factor': '0.6' }), config);

  assert.ok(atCrossing.safePressure < atLinePipe.safePressure);
  assert.ok(atCrossing.ERF > atLinePipe.ERF);
});

test('the section list offered for design factors comes from the released features', () => {
  const options = alignmentSectionOptions(
    [
      alignmentRow() as never,
      alignmentRow({ 'Source Key NEW': 'new:2', 'Section NEW': 'Aerial Section', 'Log Dist NEW (m)': 1453.539 }) as never,
      // Not released, so it must not appear as a section needing a factor.
      alignmentRow({ 'Source Key NEW': 'new:3', 'Section NEW': 'Buried Section' }) as never,
    ],
    { selectedKeys: new Set(['new:1', 'new:2']) },
  );

  assert.deepEqual(options.map((option) => option.section), ['River Crossing RC#86', 'Aerial Section']);
  assert.deepEqual(options.map((option) => option.featureCount), [1, 1]);
});

/* ── Clustered metal loss ──────────────────────────────────────────────── */

test('a vendor-merged corrosion group is tagged as clustered metal loss', () => {
  const mapped = mapAlignmentRowsToFfs(
    [
      alignmentRow({ 'Feature Identification NEW': 'CLUSTER corrosion' }) as never,
      alignmentRow({ 'Source Key NEW': 'new:2', 'Feature Identification NEW': 'Corrosion' }) as never,
    ],
    engineering,
    'session-1',
    { selectedKeys: new Set(['new:1', 'new:2']) },
  );

  assert.equal(mapped.accepted[0].provenance.isClusteredMetalLoss, true);
  assert.equal(mapped.accepted[0].row['Clustered Metal Loss'], 'Yes');
  assert.equal(mapped.accepted[1].provenance.isClusteredMetalLoss, false);
});

test('the clustered flag survives into the assessed result and the readiness findings', () => {
  const items = screenResults(
    [
      processRow(row({ 'Feature ID': 'CL-1', 'Clustered Metal Loss': 'Yes' }), config),
      processRow(row({ 'Feature ID': 'S-1', 'LD [m]': '400' }), config),
    ],
    config,
    DEFAULT_SCREENING_CONFIG,
  );

  assert.equal(items[0].nominal.isClusteredMetalLoss, true);
  assert.equal(items[1].nominal.isClusteredMetalLoss, false);

  const reportCase = buildFfsReportCase(items, reportContext);
  const finding = reportCase.readiness.findings.find(
    (item) => item.code === 'CLUSTERED_METAL_LOSS_ASSESSED',
  );
  assert.ok(finding, 'a clustered record must be disclosed as a method limitation');
  assert.equal(finding!.affectedCount, 1);
});

/* ── Section roll-ups ──────────────────────────────────────────────────── */

test('section growth reports the maximum per surface and counts unavailable axial rates', () => {
  const items = screenResults(
    [
      processRow(row({ 'Feature ID': '1', Section: 'Aerial Section', Surface: 'External', 'CR Depth [mm/y]': '0.53', 'CR Length [mm/y]': '1.68' }), config),
      processRow(row({ 'Feature ID': '2', 'LD [m]': '200', Section: 'Aerial Section', Surface: 'External', 'CR Depth [mm/y]': '0.20', 'CR Length [mm/y]': '0' }), config),
      processRow(row({ 'Feature ID': '3', 'LD [m]': '300', Section: 'Aerial Section', Surface: 'Internal', 'CR Depth [mm/y]': '0.08', 'CR Length [mm/y]': '0.5' }), config),
      processRow(row({ 'Feature ID': '4', 'LD [m]': '658', Section: 'River Crossing', Surface: 'External', 'CR Depth [mm/y]': '0.18', 'CR Length [mm/y]': '0' }), config),
    ],
    config,
    DEFAULT_SCREENING_CONFIG,
  );

  const rows = buildSectionGrowthSummary(items);
  const aerial = rows.find((entry) => entry.section === 'Aerial Section')!;
  const crossing = rows.find((entry) => entry.section === 'River Crossing')!;

  assert.equal(aerial.externalDepthRateMmPerYear, 0.53);
  assert.equal(aerial.internalDepthRateMmPerYear, 0.08);
  assert.equal(aerial.externalLengthRateMmPerYear, 1.68);
  // Feature 2 contributes to the unavailable count, never as a zero maximum.
  assert.equal(aerial.lengthRateUnavailableCount, 1);
  assert.equal(crossing.externalLengthRateMmPerYear, null);
  assert.equal(crossing.lengthRateUnavailableCount, 1);
});
