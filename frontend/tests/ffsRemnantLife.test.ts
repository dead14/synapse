import assert from 'node:assert/strict';
import test from 'node:test';

import { processRow } from '../src/lib/ffs/calcEngine.ts';
import { screenResults, lengthApplicationFor } from '../src/lib/ffs/screening.ts';
import { computeRemnantLife, designLifeUsage } from '../src/lib/ffs/remnantLife.ts';
import { remnantLimitLabel } from '../src/lib/ffs/lifeProjection.ts';
import { evaluateB31g } from '../src/lib/ffs/b31g.ts';
import {
  buildFfsReportCase,
  repairProgrammeTargets,
  type FfsReportContext,
} from '../src/lib/ffs/reportCase.ts';
import {
  mapAlignmentRowsToFfs,
  resolveDesignFactor,
  resolveOuterDiameter,
  resolveSmys,
  alignmentSectionOptions,
  summariseReleasedIntake,
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

test('remnant life is not reported above the design life the line has left', () => {
  // 20 %WT on a 9.30 mm wall at 0.15 mm/y reaches the depth limit in 37.2 years,
  // comfortably inside the horizon.  The cap is the design life *remaining* at
  // the inspection, not the total the line was built for: commissioned in 2010
  // with a 40-year design life, ~25.6 years are left at the 2024 ILI.
  const slow = row({ 'Max Depth [%]': '20', 'CR Depth [mm/y]': '0.15', 'CR Length [mm/y]': '0' });
  const uncapped = processRow(slow, { ...config, analysisHorizonYears: 100 });
  const capped = processRow(slow, {
    ...config,
    analysisHorizonYears: 100,
    serviceLife: { designLifeYears: 40, commissioningYear: 2010 },
  });

  assert.ok(uncapped.remnantLife.years !== null && uncapped.remnantLife.years > 30);
  assert.ok(capped.remnantLife.years !== null);
  assert.ok(Math.abs(capped.remnantLife.years! - 25.4) < 0.2);
  assert.equal(capped.remnantLife.governingLimit, 'Original design life');
  assert.equal(capped.remnantLife.designLifeCapApplied, true);
  // The cap quoted is the design life left at the inspection, not the 40 y total.
  assert.ok(Math.abs(capped.remnantLife.designLifeCapYears! - 25.4) < 0.2);
});

test('a line already past its design life is flagged, not capped to zero', () => {
  // Commissioned 1985 with a 25-year design life: the dossier ran out in 2010,
  // so the 2024 inspection has none of it left. Clamping the remaining design
  // life at zero made the rule bind on every feature, so a shallow ACCEPTABLE
  // anomaly reported a remnant life of "Now" due on the ILI date. The dossier
  // bound is dropped instead, and the corrosion limit is what gets reported.
  const slow = row({ 'Max Depth [%]': '20', 'CR Depth [mm/y]': '0.15', 'CR Length [mm/y]': '0' });
  const uncapped = processRow(slow, { ...config, analysisHorizonYears: 100 });
  const past = processRow(slow, {
    ...config,
    analysisHorizonYears: 100,
    serviceLife: { designLifeYears: 25, commissioningYear: 1985 },
  });

  assert.equal(past.remnantLife.years, uncapped.remnantLife.years);
  assert.equal(past.remnantLife.governingLimit, uncapped.remnantLife.governingLimit);
  assert.equal(past.remnantLife.designLifeCapApplied, false);
  assert.equal(past.remnantLife.designLifeCapYears, null);
  assert.equal(past.remnantLife.pastDesignLifeAtInspection, true);
  assert.notEqual(past.remnantLife.dueDateIso, config.iliDate.toISOString().slice(0, 10));
});

test('without a commissioning year the total design life remains the bound', () => {
  const slow = row({ 'Max Depth [%]': '20', 'CR Depth [mm/y]': '0.15', 'CR Length [mm/y]': '0' });
  const capped = processRow(slow, {
    ...config,
    analysisHorizonYears: 100,
    serviceLife: { designLifeYears: 25, commissioningYear: null },
  });

  assert.equal(capped.remnantLife.years, 25);
  assert.equal(capped.remnantLife.designLifeCapApplied, true);
  assert.equal(capped.remnantLife.designLifeCapYears, 25);
  assert.equal(capped.remnantLife.pastDesignLifeAtInspection, false);
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

/* ── Per-section pipe spec ─────────────────────────────────────────────── */

const engineering: AlignmentEngineeringInputs = {
  outerDiameterMm: 219.1,
  smysMpa: 290,
  designFactor: 0.72,
  operatingPressureMpa: 9.35,
  fallbackDepthGrowthMmPerYear: 0,
  fallbackLengthGrowthMmPerYear: 0,
  sectionPipeSpecs: [
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

/* ── Per-section diameter ──────────────────────────────────────────────── */

/** A line that leaves the station at 20 in and steps up to 24 in at a reducer. */
const twoDiameters: AlignmentEngineeringInputs = {
  ...engineering,
  outerDiameterMm: 508,
  nominalWallThicknessMm: 9.5,
  sectionPipeSpecs: [
    { section: 'River Crossing RC#86', designFactor: 0.6 },
    // The 24 in stretch: its own diameter and its own wall.
    { section: 'Aerial Section', designFactor: 0.72, outerDiameterMm: 610, nominalWallThicknessMm: 11.1 },
  ],
};

test('a section diameter wins over the line default and records its source', () => {
  assert.deepEqual(resolveOuterDiameter('Aerial Section', twoDiameters), {
    outerDiameterMm: 610,
    source: 'section-override',
  });
  // A section that names no diameter is line default pipe, not an omission.
  assert.deepEqual(resolveOuterDiameter('River Crossing RC#86', twoDiameters), {
    outerDiameterMm: 508,
    source: 'line-default',
  });
  assert.deepEqual(resolveOuterDiameter('Unnamed stretch', twoDiameters), {
    outerDiameterMm: 508,
    source: 'line-default',
  });
});

test('the 24 in stretch is assessed on 24 in pipe, and the row says so', () => {
  const mapped = mapAlignmentRowsToFfs(
    [
      alignmentRow() as never,
      alignmentRow({
        'Source Key NEW': 'new:2', 'Identif. NEW': 'A-2',
        'Section NEW': 'Aerial Section', 'Log Dist NEW (m)': 1453.539,
      }) as never,
    ],
    twoDiameters,
    'session-1',
    { selectedKeys: new Set(['new:1', 'new:2']) },
  );

  assert.equal(mapped.accepted.length, 2);
  const [crossing, aerial] = mapped.accepted;
  assert.equal(crossing.row['Outer Diameter Ds'], '508');
  assert.equal(crossing.row['Outer Diameter Source'], 'line-default');
  assert.equal(aerial.row['Outer Diameter Ds'], '610');
  assert.equal(aerial.row['Outer Diameter Source'], 'section-override');
  assert.equal(aerial.provenance.outerDiameterMm, 610);
  assert.equal(aerial.provenance.outerDiameterSource, 'section-override');
});

test('the same defect is a different ERF on the two diameters', () => {
  // B31G carries D in the failure pressure and in z = L²/(D·t), so identical
  // depth and length on a wider pipe is not the same remaining strength.
  const narrow = processRow(row({ 'Outer Diameter Ds': '508' }), config);
  const wide = processRow(row({ 'Outer Diameter Ds': '610' }), config);
  assert.notEqual(narrow.ERF, wide.ERF);
  assert.equal(narrow.outerDiameterSource, 'row-supplied');
});

test('a section wall stands in for its own stretch, not the line wall', () => {
  const mapped = mapAlignmentRowsToFfs(
    [
      // Neither run reported a wall, so both fall back — to different pipe.
      alignmentRow({ 'Wall WT NEW (mm)': '-' }) as never,
      alignmentRow({
        'Source Key NEW': 'new:2', 'Identif. NEW': 'A-2',
        'Section NEW': 'Aerial Section', 'Wall WT NEW (mm)': '-',
      }) as never,
    ],
    twoDiameters,
    'session-1',
    { selectedKeys: new Set(['new:1', 'new:2']) },
  );

  assert.equal(mapped.accepted.length, 2);
  const [crossing, aerial] = mapped.accepted;
  assert.equal(crossing.row['Nominal Wall Thickness [mm]'], '9.5');
  assert.equal(crossing.provenance.wallThicknessSource, 'line-nominal');
  assert.equal(aerial.row['Nominal Wall Thickness [mm]'], '11.1');
  assert.equal(aerial.provenance.wallThicknessSource, 'section-nominal');
  // The feature says which wall it borrowed, not merely that it borrowed one.
  assert.ok(aerial.warnings.some((warning) => /section nominal wall of 11.1 mm/.test(warning)));
});

/* ── Per-section grade ─────────────────────────────────────────────────── */

/** An X52 line with an X60 spool welded in at the aerial crossing. */
const twoGrades: AlignmentEngineeringInputs = {
  ...engineering,
  smysMpa: 359,
  sectionPipeSpecs: [
    { section: 'River Crossing RC#86', designFactor: 0.6 },
    { section: 'Aerial Section', designFactor: 0.72, smysMpa: 414 },
  ],
};

test('a section grade wins over the line default and records its source', () => {
  assert.deepEqual(resolveSmys('Aerial Section', twoGrades), {
    smysMpa: 414,
    source: 'section-override',
  });
  // A section that names no grade is line pipe, not an omission.
  assert.deepEqual(resolveSmys('River Crossing RC#86', twoGrades), {
    smysMpa: 359,
    source: 'line-default',
  });
  assert.deepEqual(resolveSmys('Unnamed stretch', twoGrades), {
    smysMpa: 359,
    source: 'line-default',
  });
});

test('the X60 stretch is assessed on X60, and the row says so', () => {
  const mapped = mapAlignmentRowsToFfs(
    [
      alignmentRow() as never,
      alignmentRow({
        'Source Key NEW': 'new:2', 'Identif. NEW': 'A-2',
        'Section NEW': 'Aerial Section', 'Log Dist NEW (m)': 1453.539,
      }) as never,
    ],
    twoGrades,
    'session-1',
    { selectedKeys: new Set(['new:1', 'new:2']) },
  );

  assert.equal(mapped.accepted.length, 2);
  const [crossing, aerial] = mapped.accepted;
  assert.equal(crossing.row['SMYS [MPa]'], '359');
  assert.equal(crossing.row['SMYS Source'], 'line-default');
  assert.equal(aerial.row['SMYS [MPa]'], '414');
  assert.equal(aerial.row['SMYS Source'], 'section-override');
  assert.equal(aerial.provenance.smysMpa, 414);
  assert.equal(aerial.provenance.smysSource, 'section-override');
});

test('the same defect is a different safe pressure on the two grades', () => {
  // SMYS sets the flow stress, and the flow stress multiplies the failure
  // pressure, so a stronger grade is a higher safe pressure at one depth.
  const x52 = processRow(row({ 'SMYS [MPa]': '359' }), config);
  const x60 = processRow(row({ 'SMYS [MPa]': '414' }), config);
  assert.ok(x60.safePressure > x52.safePressure);
  // A manual workbook carries no source column, and the row is where the
  // engineer typed the grade.
  assert.equal(x52.smysSource, 'row-supplied');
});

test('a section grade that is present but unusable is refused, not ignored', () => {
  assert.throws(
    () => mapAlignmentRowsToFfs(
      [alignmentRow() as never],
      {
        ...engineering,
        sectionPipeSpecs: [
          { section: 'River Crossing RC#86', designFactor: 0.6, smysMpa: 0 },
        ],
      },
      'session-1',
      { selectedKeys: new Set(['new:1']) },
    ),
    /SMYS for section "River Crossing RC#86"/,
  );
});

test('a wall read off the joint is a measurement, and never the section fallback', () => {
  const mapped = mapAlignmentRowsToFfs(
    [alignmentRow({
      'Section NEW': 'Aerial Section',
      // The tally carried the thickness on the girth-weld rows, and the
      // alignment engine filled it in from the welds bounding this joint.
      'Wall WT NEW (mm)': 12.7,
      'Wall WT Source NEW': 'gw_joint',
    }) as never],
    twoDiameters,
    'session-1',
    { selectedKeys: new Set(['new:1']) },
  );

  const [feature] = mapped.accepted;
  // The joint's own 12.7 mm, not the 11.1 mm typed against this section.
  assert.equal(feature.row['Nominal Wall Thickness [mm]'], '12.7');
  assert.equal(feature.provenance.wallThicknessSource, 'joint-inherited');
  assert.ok(feature.warnings.some((warning) => /girth\s+welds bounding its joint/.test(warning)));
  // It is disclosed, but never as a wall the engineer assumed.
  assert.ok(!feature.warnings.some((warning) => /nominal wall of/.test(warning)));
});

test('the intake preview counts typed walls, not walls taken off the joint', () => {
  const summary = summariseReleasedIntake(
    [
      alignmentRow({ 'Wall WT NEW (mm)': 12.7, 'Wall WT Source NEW': 'gw_joint' }) as never,
      alignmentRow({
        'Source Key NEW': 'new:2', 'Identif. NEW': 'A-2', 'Wall WT NEW (mm)': '-',
      }) as never,
    ],
    { selectedKeys: new Set(['new:1', 'new:2']) },
    { lineNominalWallMm: 9.5 },
  );

  assert.equal(summary.assessable, 2);
  // Only the second borrowed a figure an engineer typed.
  assert.equal(summary.usingNominalWall, 1);
});

test('a section diameter that cannot be pipe stops the run rather than the results table', () => {
  const impossible: AlignmentEngineeringInputs = {
    ...twoDiameters,
    sectionPipeSpecs: [{ section: 'Aerial Section', designFactor: 0.72, outerDiameterMm: 20 }],
  };
  assert.throws(
    () => mapAlignmentRowsToFfs([alignmentRow() as never], impossible, 's', {
      selectedKeys: new Set(['new:1']),
    }),
    /at least 50 mm/,
  );

  // Wall and diameter sit side by side in the table and are easy to transpose.
  const transposed: AlignmentEngineeringInputs = {
    ...twoDiameters,
    sectionPipeSpecs: [{
      section: 'Aerial Section', designFactor: 0.72,
      outerDiameterMm: 11.1, nominalWallThicknessMm: 610,
    }],
  };
  assert.throws(
    () => mapAlignmentRowsToFfs([alignmentRow() as never], transposed, 's', {
      selectedKeys: new Set(['new:1']),
    }),
    /at least 50 mm|leaves no bore/,
  );
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

test('the governing-limit label names the depth line that was actually used', () => {
  // 'Depth = 80%' is a stable identifier, not a label. Printing it verbatim put
  // "Depth = 80%" in the governing-limit column and in the exported workbook
  // for an assessment screened at 70 %WT, contradicting the years beside it.
  const at70 = computeRemnantLife({
    geometry: { wallThickness: 10, outerDiameter: 508, smysMpa: 359, safetyFactor: 1.39, operatingPressureMpa: 5 },
    method: 'modified',
    flowStressMode: 'smys69',
    basis: 'as-reported',
    startDepthPct: 40,
    startLengthMm: 20,
    depthRateMmPerYear: 0.2,
    lengthRateMmPerYear: 0,
    lengthRateAvailable: false,
    horizonYears: 30,
    iliDate: new Date('2024-08-23'),
    service: { designLifeYears: null, commissioningYear: null },
    depthLimitRatio: 0.7,
  });

  assert.equal(at70.governingLimit, 'Depth = 80%', 'the stored token must not change');
  assert.equal(at70.depthLimitPct, 70);
  assert.equal(remnantLimitLabel(at70), 'Depth = 70%');
  // (0.70 - 0.40) x 10 mm / 0.2 mm/y = 15 y — the label and the figure agree.
  assert.equal(at70.years, 15);
});

test('the default depth line still reads as 80% and the other limits are untouched', () => {
  const request = {
    geometry: { wallThickness: 10, outerDiameter: 508, smysMpa: 359, safetyFactor: 1.39, operatingPressureMpa: 5 },
    method: 'modified' as const,
    flowStressMode: 'smys69' as const,
    basis: 'as-reported' as const,
    startDepthPct: 40,
    startLengthMm: 20,
    depthRateMmPerYear: 0.2,
    lengthRateMmPerYear: 0,
    lengthRateAvailable: false,
    horizonYears: 30,
    iliDate: new Date('2024-08-23'),
    service: { designLifeYears: null, commissioningYear: null },
  };
  assert.equal(remnantLimitLabel(computeRemnantLife(request)), 'Depth = 80%');

  const noGrowth = computeRemnantLife({ ...request, depthRateMmPerYear: 0 });
  assert.equal(noGrowth.governingLimit, null);
  assert.equal(remnantLimitLabel(noGrowth), 'No positive growth basis');
});

test('the ERF bisection resolves far past the precision remnant life is quoted at', () => {
  // The search was cut from 60 halvings to 30. Thirty takes a 100-year bracket
  // to about 1e-7 years, which round2 discards anyway — so the shorter search
  // has to land on exactly the same reported figure.
  const request = {
    geometry: { wallThickness: 8, outerDiameter: 323.9, smysMpa: 359, safetyFactor: 1.39, operatingPressureMpa: 6.5 },
    method: 'modified' as const,
    flowStressMode: 'smys69' as const,
    basis: 'as-reported' as const,
    startDepthPct: 55,
    startLengthMm: 120,
    depthRateMmPerYear: 0.25,
    lengthRateMmPerYear: 2,
    lengthRateAvailable: true,
    horizonYears: 100,
    iliDate: new Date('2024-08-23'),
    service: { designLifeYears: null, commissioningYear: null },
  };
  const life = computeRemnantLife(request);

  assert.equal(life.status, 'calculated');
  assert.notEqual(life.erfLimitYears, null);
  // The bracket is monotonic, so the answer is the crossing itself: ERF is
  // below 1 just before the reported year and at or above it just after.
  const erfAt = (years: number) => evaluateB31g(
    (request.startDepthPct / 100) * request.geometry.wallThickness + request.depthRateMmPerYear * years,
    request.startLengthMm + request.lengthRateMmPerYear * years,
    request.geometry,
    request.method,
    request.flowStressMode,
  ).erf;
  assert.ok(erfAt(life.erfLimitYears! - 0.01) < 1);
  assert.ok(erfAt(life.erfLimitYears! + 0.01) >= 1);
});
