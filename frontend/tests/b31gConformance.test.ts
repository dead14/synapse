import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateB31g,
  safetyFactorFromDesignFactor,
  MINIMUM_RECOMMENDED_SAFETY_FACTOR,
  ORIGINAL_B31G_Z_CUTOFF,
  MODIFIED_B31G_Z_CUTOFF,
  type B31gGeometry,
} from '../src/lib/ffs/b31g.ts';
import { processRow } from '../src/lib/ffs/calcEngine.ts';
import { screenResults } from '../src/lib/ffs/screening.ts';
import { buildFfsReportCase, type FfsReportContext } from '../src/lib/ffs/reportCase.ts';
import { DEFAULT_SCREENING_CONFIG, type FfsConfig } from '../src/lib/ffs/types.ts';

/**
 * Conformance of the remaining-strength kernel to ASME B31G-2023.
 *
 * The cases below are the worked examples in the standard's Nonmandatory
 * Appendix A. They are the only published numbers that pin every part of the
 * calculation at once — z, the Folias factor, the flow-stress definition, the
 * branch, and the failure stress — so a regression anywhere in the chain shows
 * up here rather than in a report an engineer has already signed.
 *
 * The standard prints its intermediate values rounded, so the tolerance is on
 * the published precision, not on the calculation.
 */

const INCH_MM = 25.4;
const PSI_MPA = 0.006894757;

/** NPS 24 × 0.313 in, API 5L X52, MAOP 976 psig — the Appendix A pipeline. */
function appendixGeometry(safetyFactor = 1.39): B31gGeometry {
  return {
    wallThickness: 0.313 * INCH_MM,
    outerDiameter: 24 * INCH_MM,
    smysMpa: 52_000 * PSI_MPA,
    safetyFactor,
    operatingPressureMpa: 976 * PSI_MPA,
  };
}

interface AppendixCase {
  name: string;
  depthIn: number;
  lengthIn: number;
  method: 'original' | 'modified';
  /** Published z, M and S_F from Tables A-4-1 and A-6-1. */
  z: number;
  m: number;
  failureStressPsi: number;
}

const APPENDIX_CASES: AppendixCase[] = [
  { name: 'Example 1 Pit 1, Original B31G', depthIn: 0.060, lengthIn: 8, method: 'original', z: 8.520, m: 2.796, failureStressPsi: 52_280 },
  { name: 'Example 1 Pit 2, Original B31G', depthIn: 0.190, lengthIn: 1, method: 'original', z: 0.133, m: 1.052, failureStressPsi: 55_344 },
  { name: 'Example 2 interacting pair, Original B31G', depthIn: 0.190, lengthIn: 9.9, method: 'original', z: 13.047, m: 3.382, failureStressPsi: 38_682 },
  { name: 'Example 3 Pit 1, Modified B31G', depthIn: 0.060, lengthIn: 8, method: 'modified', z: 8.520, m: 2.470, failureStressPsi: 55_563 },
  { name: 'Example 3 Pit 2, Modified B31G', depthIn: 0.190, lengthIn: 1, method: 'modified', z: 0.133, m: 1.041, failureStressPsi: 59_507 },
  { name: 'Example 3 interacting pair, Modified B31G', depthIn: 0.190, lengthIn: 9.9, method: 'modified', z: 13.047, m: 2.935, failureStressPsi: 36_411 },
  { name: 'Example 4 Pit 3, Modified B31G', depthIn: 0.125, lengthIn: 6, method: 'modified', z: 4.792, m: 1.982, failureStressPsi: 49_416 },
  { name: 'Example 5 Pit 3 with 10 %WT ILI tolerance', depthIn: 0.125 + 0.10 * 0.313, lengthIn: 6, method: 'modified', z: 4.792, m: 1.982, failureStressPsi: 45_406 },
];

for (const appendixCase of APPENDIX_CASES) {
  test(`B31G-2023 Appendix A — ${appendixCase.name}`, () => {
    const result = evaluateB31g(
      appendixCase.depthIn * INCH_MM,
      appendixCase.lengthIn * INCH_MM,
      appendixGeometry(),
      appendixCase.method,
      'smys69',
    );

    assert.ok(result.valid);
    assert.ok(Math.abs(result.z - appendixCase.z) < 0.001, `z ${result.z} vs ${appendixCase.z}`);
    assert.ok(
      Math.abs((result.foliasFactor ?? 0) - appendixCase.m) < 0.001,
      `M ${result.foliasFactor} vs ${appendixCase.m}`,
    );

    const failureStressPsi = result.failureStressMpa / PSI_MPA;
    const relative = Math.abs(failureStressPsi - appendixCase.failureStressPsi) / appendixCase.failureStressPsi;
    assert.ok(relative < 0.0001, `S_F ${failureStressPsi.toFixed(0)} psi vs ${appendixCase.failureStressPsi} psi`);
  });
}

test('the Appendix A flow-stress definitions come out exactly', () => {
  const geometry = appendixGeometry();
  // Para. 1.7(b)(1): 1.1 × SMYS = 57,200 psi for X52.
  const original = evaluateB31g(0.06 * INCH_MM, 8 * INCH_MM, geometry, 'original', 'smys69');
  assert.ok(Math.abs(original.flowStressMpa / PSI_MPA - 57_200) < 1);
  // Para. 1.7(b)(2): SMYS + 10 ksi = 62,000 psi.
  const modified = evaluateB31g(0.06 * INCH_MM, 8 * INCH_MM, geometry, 'modified', 'smys69');
  assert.ok(Math.abs(modified.flowStressMpa / PSI_MPA - 62_000) < 1);
});

/* ── Branch cutoffs ───────────────────────────────────────────────────── */

test('the Original B31G branch changes at z = 20 exactly, as para. 2.2(a) states', () => {
  assert.equal(ORIGINAL_B31G_Z_CUTOFF, 20);
  assert.equal(MODIFIED_B31G_Z_CUTOFF, 50);

  const geometry = appendixGeometry();
  const lengthForZ = (z: number) =>
    Math.sqrt(z * geometry.outerDiameter * geometry.wallThickness);
  const depth = 0.19 * INCH_MM;

  const short = evaluateB31g(depth, lengthForZ(19.99), geometry, 'original', 'smys69');
  const long = evaluateB31g(depth, lengthForZ(20.01), geometry, 'original', 'smys69');

  assert.equal(short.branch, 'ORIGINAL_SHORT_PARABOLIC');
  assert.equal(long.branch, 'ORIGINAL_LONG_RECTANGULAR');
  // The rectangular form has no Folias term at all.
  assert.equal(long.foliasFactor, null);

  // The old 4.479² = 20.0614 cutoff left the parabolic branch running here, and
  // the parabolic form is much less conservative at this length.
  const justPastTwenty = evaluateB31g(depth, lengthForZ(20.03), geometry, 'original', 'smys69');
  assert.equal(justPastTwenty.branch, 'ORIGINAL_LONG_RECTANGULAR');
  assert.ok(justPastTwenty.failureStressMpa < short.failureStressMpa);
});

test('the rectangular branch is S_flow (1 − d/t) with no bulging term', () => {
  const geometry = appendixGeometry();
  const lengthForZ = (z: number) =>
    Math.sqrt(z * geometry.outerDiameter * geometry.wallThickness);
  const depthRatio = 0.5;
  const result = evaluateB31g(
    depthRatio * geometry.wallThickness,
    lengthForZ(30),
    geometry,
    'original',
    'smys69',
  );

  const expected = 1.1 * geometry.smysMpa * (1 - depthRatio);
  assert.ok(Math.abs(result.failureStressMpa - expected) < 1e-9);
});

/* ── Safe pressure and the safety factor ──────────────────────────────── */

test('safe pressure is the failure pressure divided by the safety factor', () => {
  const geometry = appendixGeometry(1.39);
  const result = evaluateB31g(0.125 * INCH_MM, 6 * INCH_MM, geometry, 'modified', 'smys69');

  assert.ok(Math.abs(result.safePressureMpa - result.failurePressureMpa / 1.39) < 1e-9);
  // Para. 1.9 acceptance: S_F >= SF x S_O is the same statement as ERF < 1.
  const acceptanceStress = 1.39 * result.operatingHoopStressMpa;
  assert.equal(result.failureStressMpa >= acceptanceStress, result.erf <= 1);
});

test('a lower safety factor raises the safe pressure — Appendix A Example 4', () => {
  // The standard's own demonstration: Pit 3 fails at SF 1.39 and passes at 1.25.
  const strict = evaluateB31g(0.125 * INCH_MM, 6 * INCH_MM, appendixGeometry(1.39), 'modified', 'smys69');
  const relaxed = evaluateB31g(0.125 * INCH_MM, 6 * INCH_MM, appendixGeometry(1.25), 'modified', 'smys69');

  assert.ok(strict.erf > 1, 'SF 1.39 must reject Pit 3');
  assert.ok(relaxed.erf < 1, 'SF 1.25 must accept Pit 3');
});

test('the historic 1/F derivation reproduces the Level 0 table safety factor', () => {
  // Section 2.1: the tables were designed for a minimum safety factor of 1.39
  // at 72 % SMYS, which is exactly 1/0.72.
  assert.ok(Math.abs(safetyFactorFromDesignFactor(0.72) - 1.39) < 0.005);
  assert.ok(Math.abs(safetyFactorFromDesignFactor(0.6) - 1.667) < 0.001);
});

/* ── The safety factor reaching the assessment ────────────────────────── */

const config: FfsConfig = {
  lineName: 'Conformance line',
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
    'Max Depth [%]': '40',
    'Length [mm]': '60',
    'Width [mm]': '54',
    'Orient. (hrs:mins)': '5:38',
    'Nominal Wall Thickness [mm]': '9.3',
    'CR Depth [mm/y]': '0.2',
    'CR Length [mm/y]': '0',
    'Design Factor': '0.72',
    'Outer Diameter Ds': '219.1',
    'SMYS [MPa]': '290',
    'Operating Pressure P₀ [MPa]': '9.35',
    ...overrides,
  };
}

test('an absent safety factor is derived from the design factor and says so', () => {
  const result = processRow(row(), config);

  assert.ok(Math.abs(result.safetyFactor - 1 / 0.72) < 1e-4);
  assert.equal(result.safetyFactorSource, 'derived-from-design-factor');
  assert.equal(result.SF, result.safetyFactor);
});

test('an explicit safety factor overrides the derivation', () => {
  const result = processRow(row({ 'Safety Factor': '1.25' }), config);

  assert.equal(result.safetyFactor, 1.25);
  assert.equal(result.safetyFactorSource, 'explicit');
  assert.ok(Math.abs(result.safePressure - result.Pf / 1.25) < 1e-3);
});

test('a safety factor below the recommended minimum blocks the report', () => {
  const items = screenResults([processRow(row({ 'Safety Factor': '1.0' }), config)], config, DEFAULT_SCREENING_CONFIG);
  const reportCase = buildFfsReportCase(items, reportContext);
  const finding = reportCase.readiness.findings.find(
    (item) => item.code === 'SAFETY_FACTOR_BELOW_RECOMMENDED',
  );

  assert.ok(finding, `SF below ${MINIMUM_RECOMMENDED_SAFETY_FACTOR} must be surfaced`);
  assert.equal(finding!.severity, 'error');
  assert.equal(reportCase.readiness.status, 'blocked');
});

test('a derived safety factor is disclosed even when it is above the minimum', () => {
  const items = screenResults([processRow(row(), config)], config, DEFAULT_SCREENING_CONFIG);
  const reportCase = buildFfsReportCase(items, reportContext);

  assert.ok(
    reportCase.readiness.findings.some(
      (item) => item.code === 'SAFETY_FACTOR_DERIVED_FROM_DESIGN_FACTOR',
    ),
  );
});
