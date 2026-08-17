import assert from 'node:assert/strict';
import test from 'node:test';

import {
  b314AllowableStressMpa,
  b314DesignThicknessMm,
  b314Disposition,
  b314Interaction,
  B314_MANDATORY_REPAIR_DEPTH_RATIO,
  B314_MAX_DESIGN_FACTOR,
  B314_NO_REPAIR_DEPTH_RATIO_OF_DESIGN_THICKNESS,
  B314_TYPE_II_AXIAL_SEPARATION_MM,
  B314_WELD_JOINT_FACTORS,
  B314_YIELD_TO_TENSILE_ANALYSIS_THRESHOLD,
} from '../src/lib/ffs/b314.ts';
import { processRow } from '../src/lib/ffs/calcEngine.ts';
import { findInteractions, screenResults } from '../src/lib/ffs/screening.ts';
import { buildFfsReportCase, type FfsReportContext } from '../src/lib/ffs/reportCase.ts';
import { DEFAULT_SCREENING_CONFIG, type FfsConfig } from '../src/lib/ffs/types.ts';

/**
 * Conformance to ASME B31.4-2025 Chapter VII, para. 451.6.2.2.
 *
 * B31G decides what pressure the corroded pipe holds; this Code decides what has
 * to be done about it. The two are reported side by side and are allowed to
 * differ — which is exactly why each has to be pinned to its own paragraph.
 */

const config: FfsConfig = {
  lineName: 'B31.4 line',
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

/** NPS 20 × 9.3 mm, X52 (359 MPa), F = 0.72, required pressure 9.46 MPa. */
function row(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    'Feature ID': 'F-001',
    'LD [m]': '100',
    Section: 'Sec A',
    Surface: 'External',
    'Max Depth [%]': '40',
    'Length [mm]': '50',
    'Width [mm]': '80',
    'Orient. (hrs:mins)': '6:00',
    'Nominal Wall Thickness [mm]': '9.3',
    'CR Depth [mm/y]': '0.1',
    'CR Length [mm/y]': '0',
    'Design Factor': '0.72',
    'Outer Diameter Ds': '508',
    'SMYS [MPa]': '359',
    'Operating Pressure P₀ [MPa]': '9.46',
    ...overrides,
  };
}

/* ── Para. 403.2.1, the design thickness ───────────────────────────────── */

test('the allowable stress is F x E x SMYS and the design factor ceiling is 0.72', () => {
  assert.equal(B314_MAX_DESIGN_FACTOR, 0.72);
  assert.equal(B314_WELD_JOINT_FACTORS.seamless, 1.0);
  assert.equal(B314_WELD_JOINT_FACTORS['furnace-butt-welded'], 0.6);

  const seamless = b314AllowableStressMpa({
    internalDesignPressureMpa: 9.46, outerDiameterMm: 508, smysMpa: 359, designFactor: 0.72,
  });
  assert.ok(Math.abs(seamless! - 258.48) < 1e-9, `S = ${seamless}`);

  // Table 403.2.1-1: furnace butt welded pipe carries E = 0.60, and the Code
  // allowable falls with it.
  const buttWelded = b314AllowableStressMpa({
    internalDesignPressureMpa: 9.46, outerDiameterMm: 508, smysMpa: 359, designFactor: 0.72,
    weldJointFactor: B314_WELD_JOINT_FACTORS['furnace-butt-welded'],
  });
  assert.ok(Math.abs(buttWelded! - 0.6 * 258.48) < 1e-9);
});

test('t = P D / 2S reproduces the para. 403.2.1 pressure design thickness', () => {
  // 9.46 MPa x 508 mm / (2 x 258.48 MPa) = 9.296 mm.
  const thickness = b314DesignThicknessMm({
    internalDesignPressureMpa: 9.46, outerDiameterMm: 508, smysMpa: 359, designFactor: 0.72,
  });
  assert.ok(Math.abs(thickness! - 9.2963) < 0.001, `t = ${thickness}`);

  // The allowance A of para. 403.2.1 is an addition to t, never part of it —
  // folding a corrosion allowance in here would widen the 20 % no-repair band
  // past what the Code allows.
  assert.equal(
    b314DesignThicknessMm({
      internalDesignPressureMpa: 0, outerDiameterMm: 508, smysMpa: 359, designFactor: 0.72,
    }),
    null,
  );
});

/* ── Para. 451.6.2.2(a) and (b), the disposition ───────────────────────── */

const baseDisposition = {
  wallThicknessMm: 9.3,
  designThicknessMm: 9.2963,
  safeOperatingPressureMpa: 12,
  maximumOperatingPressureMpa: 9.46,
};

test('metal loss past 80% of wall is removed or repaired whatever the ERF says', () => {
  assert.equal(B314_MANDATORY_REPAIR_DEPTH_RATIO, 0.8);
  // A generous safe pressure does not save it: para. 451.6.2.2(a) is absolute.
  const deep = b314Disposition({
    ...baseDisposition,
    depthRatioOfWall: 0.81,
    safeOperatingPressureMpa: 40,
  });

  assert.equal(deep.disposition, 'remove-or-repair');
  assert.equal(deep.acceptableAsIs, false);
  assert.match(deep.reference, /451\.6\.2\.2\(a\)/);

  // Exactly 80 % is not "greater than 80 %".
  assert.notEqual(
    b314Disposition({ ...baseDisposition, depthRatioOfWall: 0.8 }).disposition,
    'remove-or-repair',
  );
});

test('the 20% no-repair band is a fraction of the design thickness, not of the wall', () => {
  assert.equal(B314_NO_REPAIR_DEPTH_RATIO_OF_DESIGN_THICKNESS, 0.2);
  // 20 % of t = 1.859 mm, which on this 9.30 mm wall is 19.99 %WT.
  const shallow = b314Disposition({ ...baseDisposition, depthRatioOfWall: 0.19 });
  assert.equal(shallow.disposition, 'no-repair-required');
  assert.equal(shallow.acceptableAsIs, true);

  const past = b314Disposition({ ...baseDisposition, depthRatioOfWall: 0.21 });
  assert.equal(past.disposition, 'safe-pressure-established');

  // On a line with a corrosion allowance the two denominators separate: a 12.7 mm
  // wall over the same 9.296 mm design thickness moves the band down to 14.6 %WT,
  // and reading it off the wall instead would let a deeper feature through.
  const withAllowance = b314Disposition({
    ...baseDisposition,
    wallThicknessMm: 12.7,
    depthRatioOfWall: 0.18,
  });
  assert.equal(withAllowance.disposition, 'safe-pressure-established');
  assert.ok(withAllowance.depthRatioOfDesignThickness! > 0.2);
});

test('a safe pressure below the MOP requires repair, replacement, or an MOP reduction', () => {
  const under = b314Disposition({
    ...baseDisposition,
    depthRatioOfWall: 0.55,
    safeOperatingPressureMpa: 8.2,
    maximumOperatingPressureMpa: 9.46,
  });

  assert.equal(under.disposition, 'repair-replace-or-reduce-mop');
  assert.equal(under.acceptableAsIs, false);
  assert.match(under.statement, /reduced to the safe operating pressure/);
});

test('an unestablished safe pressure never reads as acceptable', () => {
  const none = b314Disposition({
    ...baseDisposition,
    depthRatioOfWall: 0.55,
    safeOperatingPressureMpa: 0,
  });
  assert.equal(none.disposition, 'undetermined');
  assert.equal(none.acceptableAsIs, false);
});

test('a Y/T above 0.93 or unusual loading takes the area out of the B31G screen', () => {
  assert.equal(B314_YIELD_TO_TENSILE_ANALYSIS_THRESHOLD, 0.93);
  const brittle = b314Disposition({
    ...baseDisposition,
    depthRatioOfWall: 0.3,
    yieldToTensileRatio: 0.95,
  });
  assert.equal(brittle.disposition, 'engineering-analysis-required');

  const settling = b314Disposition({
    ...baseDisposition,
    depthRatioOfWall: 0.3,
    unusualLoading: true,
  });
  assert.equal(settling.disposition, 'engineering-analysis-required');

  // The 80 % line still comes first: an engineering analysis does not admit a
  // feature the Code says must be removed.
  const both = b314Disposition({
    ...baseDisposition,
    depthRatioOfWall: 0.9,
    yieldToTensileRatio: 0.95,
  });
  assert.equal(both.disposition, 'remove-or-repair');
});

/* ── Para. 451.6.2.2(d), interaction ───────────────────────────────────── */

test('Type II combines two areas under one inch apart into one flaw', () => {
  assert.equal(B314_TYPE_II_AXIAL_SEPARATION_MM, 25.4);
  const close = b314Interaction({
    axialSeparationMm: 20,
    circumferentialSeparationMm: 10,
    designThicknessMm: 9.2963,
    wallThicknessMm: 9.3,
    lengthAMm: 50,
    lengthBMm: 30,
  });

  assert.equal(close.typeIIInteracting, true);
  // L = L1 + L2 + L3.
  assert.equal(close.combinedLengthMm, 100);
  assert.equal(close.assessSeparately, false);

  const apart = b314Interaction({
    axialSeparationMm: 25.4,
    circumferentialSeparationMm: 10,
    designThicknessMm: 9.2963,
    wallThicknessMm: 9.3,
    lengthAMm: 50,
    lengthBMm: 30,
  });
  assert.equal(apart.typeIIInteracting, false, 'at exactly one inch the areas are separate');
  assert.equal(apart.combinedLengthMm, null);
});

test('Type I measures the circumferential separation against 6 times the design thickness', () => {
  // 6 x 9.2963 = 55.78 mm.
  const inside = b314Interaction({
    axialSeparationMm: 400,
    circumferentialSeparationMm: 50,
    designThicknessMm: 9.2963,
    wallThicknessMm: 9.3,
    lengthAMm: 50,
    lengthBMm: 30,
  });
  assert.ok(Math.abs(inside.circumferentialThresholdMm - 55.778) < 0.01);
  assert.equal(inside.typeIInteracting, true);
  assert.equal(inside.assessSeparately, false, 'a Type I pair is not assessed separately');

  const outside = b314Interaction({
    axialSeparationMm: 400,
    circumferentialSeparationMm: 60,
    designThicknessMm: 9.2963,
    wallThicknessMm: 9.3,
    lengthAMm: 50,
    lengthBMm: 30,
  });
  assert.equal(outside.typeIInteracting, false);
  assert.equal(outside.assessSeparately, true);
});

test('an unmeasured circumferential separation is undetermined, never separate', () => {
  const unknown = b314Interaction({
    axialSeparationMm: 400,
    circumferentialSeparationMm: null,
    designThicknessMm: null,
    wallThicknessMm: 9.3,
    lengthAMm: 50,
    lengthBMm: 30,
  });

  assert.equal(unknown.typeIInteracting, null);
  assert.equal(unknown.assessSeparately, false);
  // Without a design thickness the nominal wall is the denominator, and the
  // result says which one it used by the threshold it reports.
  assert.ok(Math.abs(unknown.circumferentialThresholdMm - 55.8) < 0.01);
});

/* ── The disposition reaching the assessment ───────────────────────────── */

test('every screened feature carries its Code disposition beside the B31G result', () => {
  const items = screenResults(
    [
      processRow(row({ 'Feature ID': 'SHALLOW', 'Max Depth [%]': '15' }), config),
      processRow(row({ 'Feature ID': 'MID', 'LD [m]': '200', 'Max Depth [%]': '45' }), config),
      processRow(row({ 'Feature ID': 'DEEP', 'LD [m]': '300', 'Max Depth [%]': '85' }), config),
    ],
    config,
    DEFAULT_SCREENING_CONFIG,
  );

  assert.equal(items[0].b314.disposition, 'no-repair-required');
  assert.equal(items[2].b314.disposition, 'remove-or-repair');
  for (const item of items) {
    assert.ok(item.b314DesignThicknessMm !== null);
    assert.match(item.b314.reference, /ASME B31\.4-2025/);
  }
});

test('the Code disposition and the B31G acceptance are allowed to disagree', () => {
  // A shallow feature on a line at its design hoop stress: B31G returns an ERF
  // and an acceptance, the Code says no repair is required at all. Reporting
  // only one of the two hides which rule the operator is answering to.
  const item = screenResults(
    [processRow(row({ 'Max Depth [%]': '15' }), config)],
    config,
    DEFAULT_SCREENING_CONFIG,
  )[0];

  assert.equal(item.nominal.acceptance, 'Acceptable');
  assert.equal(item.b314.disposition, 'no-repair-required');
  assert.ok(item.b314.depthRatioOfDesignThickness! < 0.2);
});

test('the Code dispositions are raised as findings without blocking the report', () => {
  const items = screenResults(
    [processRow(row({ 'Feature ID': 'DEEP', 'Max Depth [%]': '85' }), config)],
    config,
    DEFAULT_SCREENING_CONFIG,
  );
  const reportCase = buildFfsReportCase(items, reportContext);
  const codeFinding = reportCase.readiness.findings.find(
    (finding) => finding.code === 'B314_REMOVE_OR_REPAIR_REQUIRED',
  );

  assert.ok(codeFinding, 'a feature past 80 %WT must be raised against the Code');
  assert.equal(codeFinding!.severity, 'warning');
  assert.notEqual(
    reportCase.readiness.status,
    'blocked',
    'finding areas that need repair is the assessment working, not a reason to withhold it',
  );
});

test('the pair screen reports the Code rule alongside the B31G 3t one', () => {
  // 30 mm apart: inside the B31G 3t screen on this wall (27.9 mm) only just, and
  // past the flat one-inch trigger of B31.4. The two rules disagree here on
  // purpose, and the pair has to carry both answers.
  const items = screenResults(
    [
      processRow(row({ 'Feature ID': 'A', 'LD [m]': '100.000', 'Length [mm]': '20' }), config),
      processRow(row({ 'Feature ID': 'B', 'LD [m]': '100.040', 'Length [mm]': '20' }), config),
    ],
    config,
    DEFAULT_SCREENING_CONFIG,
  );
  const [pair] = findInteractions(items, DEFAULT_SCREENING_CONFIG);

  assert.ok(pair, 'the two features are inside the B31G screen');
  assert.ok(Math.abs(pair.edgeGapMm - 20) < 1e-6);
  assert.equal(pair.b314.typeIIInteracting, true, '20 mm is under one inch');
  assert.ok(Math.abs(pair.b314.combinedLengthMm! - 60) < 1e-6);
  assert.match(pair.b314.reference, /451\.6\.2\.2\(d\)/);
});
