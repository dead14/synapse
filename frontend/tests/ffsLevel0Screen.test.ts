/**
 * The chart was titled "B31G Level 0" and drew something else.
 *
 * Level 0 is the section 3 screen: an allowable length against an allowable
 * depth, read off a table that has no pressure column. It has none because the
 * tables are drawn for a line at its design hoop stress with the matching
 * safety factor — F = 0.72 with SF = 1.39 — which places the target failure
 * stress at SMYS and leaves the boundary a function of diameter, wall, and
 * grade alone.
 *
 * What was drawn instead solved the same equations at the line's own operating
 * pressure. On a lightly loaded line that envelope sits far above the code's
 * screen, so a chart labelled Level 0 was passing anomalies the code's own
 * table rejects. Both curves are worth having; they are not the same curve.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { processRow } from '../src/lib/ffs/calcEngine.ts';
import { screenResults } from '../src/lib/ffs/screening.ts';
import {
  acceptableDepthRatio,
  foliasFactor,
  flowStress,
  normalizedLength,
  screeningTargetStressMpa,
} from '../src/lib/ffs/b31g.ts';
import {
  buildEnvelopeCurves,
  envelopeDomainMm,
  screenAgainstEnvelope,
} from '../src/lib/ffs/chartData.ts';
import { DEFAULT_SCREENING_CONFIG, type FfsConfig } from '../src/lib/ffs/types.ts';

const config: FfsConfig = {
  lineName: 'Level 0 line',
  method: 'modified',
  modifiedSa: 'smys69',
  iliDate: new Date('2026-01-01T00:00:00.000Z'),
  highlightYears: 5,
};

const OD = 508;
const WALL = 9.27;
const SMYS = 359;

function row(overrides: Record<string, string> = {}) {
  return {
    'LD [m]': '100',
    Section: 'S-01',
    Surface: 'External',
    'Max Depth [%]': '25',
    'Length [mm]': '20',
    'Width [mm]': '30',
    'Orient. (hrs:mins)': '6:00',
    'Nominal Wall Thickness [mm]': String(WALL),
    'CR Depth [mm/y]': '0.1',
    'CR Length [mm/y]': '0',
    'Design Factor': '0.72',
    'Outer Diameter Ds': String(OD),
    'SMYS [MPa]': String(SMYS),
    'Operating Pressure P₀ [MPa]': '6.0',
    ...overrides,
  };
}

function population(overrides: Record<string, string>[] = [{}]) {
  return screenResults(overrides.map((o) => processRow(row(o), config)), config, DEFAULT_SCREENING_CONFIG);
}

const geometry = {
  wallThickness: WALL,
  outerDiameter: OD,
  smysMpa: SMYS,
  safetyFactor: 1 / 0.72,
  operatingPressureMpa: 6,
};

test('the Level 0 target stress is SMYS, whatever the line is running at', () => {
  for (const p0 of [1, 6, 12]) {
    assert.equal(screeningTargetStressMpa({ ...geometry, operatingPressureMpa: p0 }, 'level-0'), SMYS);
  }

  // The operating basis is the one that tracks pressure.
  const light = screeningTargetStressMpa({ ...geometry, operatingPressureMpa: 1 }, 'operating-pressure')!;
  const heavy = screeningTargetStressMpa({ ...geometry, operatingPressureMpa: 12 }, 'operating-pressure')!;
  assert.ok(heavy > light * 11, 'the operating target must scale with P₀');
});

test('the Level 0 allowable depth is the published closed form', () => {
  // Worked by hand for a 508 × 9.27 X52 line, Modified B31G on SMYS + 69 MPa,
  // at a 100 mm anomaly: r = 359/428, z = 100²/(508 × 9.27), M from the
  // polynomial branch, d/t = (1 − r) / (0.85 (1 − r/M)).
  const ratio = acceptableDepthRatio(100, geometry, 'modified', 'smys69', 'level-0');
  assert.ok(ratio !== null);
  assert.ok(Math.abs(ratio - 0.4224) < 5e-4, `hand-worked 0.4224, got ${ratio}`);

  // And it agrees with the r-form the reference reports plot, at every length.
  const flow = flowStress(SMYS, 'modified', 'smys69');
  const r = SMYS / flow;
  for (const length of [10, 50, 100, 250, 400]) {
    const z = normalizedLength(length, OD, WALL);
    const M = foliasFactor(z, 'modified')!;
    const expected = (1 - r) / (0.85 * (1 - r / M));
    const actual = acceptableDepthRatio(length, geometry, 'modified', 'smys69', 'level-0')!;
    assert.ok(Math.abs(actual - expected) < 1e-9, `L=${length}: ${actual} vs ${expected}`);
  }
});

test('the Level 0 envelope does not move with operating pressure, and the Level 1 one does', () => {
  const light = population([{ 'Operating Pressure P₀ [MPa]': '3.0' }]);
  const heavy = population([{ 'Operating Pressure P₀ [MPa]': '9.0' }]);
  const domain = 600;

  const level0Light = buildEnvelopeCurves(light, config, domain, 80, 'level-0')[0];
  const level0Heavy = buildEnvelopeCurves(heavy, config, domain, 80, 'level-0')[0];
  assert.deepEqual(level0Light.points, level0Heavy.points);
  assert.equal(level0Light.basis, 'level-0');

  const operatingLight = buildEnvelopeCurves(light, config, domain, 80, 'operating-pressure')[0];
  const operatingHeavy = buildEnvelopeCurves(heavy, config, domain, 80, 'operating-pressure')[0];
  const midpoint = Math.floor(operatingLight.points.length / 2);
  assert.ok(
    operatingLight.points[midpoint].y > operatingHeavy.points[midpoint].y,
    'a lightly loaded line must tolerate deeper metal loss at operating pressure',
  );

  // The whole reason the two must not share a label: the lightly loaded line's
  // operating envelope is more permissive than the screen the code publishes.
  assert.ok(operatingLight.points[midpoint].y > level0Light.points[midpoint].y);
});

test('the Level 0 curve keeps the flat top and the drop the reference plots', () => {
  const items = population();
  const domain = envelopeDomainMm(items, config, 'level-0');
  const curve = buildEnvelopeCurves(items, config, domain, 80, 'level-0')[0];

  assert.ok(curve.points.some((point) => Math.abs(point.y - 80) < 1e-9), 'no flat top');
  assert.ok(curve.points[curve.points.length - 1].y < 45, 'the curve never falls away');
  for (let i = 1; i < curve.points.length; i++) {
    assert.ok(curve.points[i].y <= curve.points[i - 1].y + 1e-9, `depth rose at ${curve.points[i].x} mm`);
  }
});

test('exceedances are counted per feature against its own pipe, not off the drawn curve', () => {
  // Same wall and the same 37 %WT × 140 mm box on two grades. X52 allows
  // 34.2 %WT there and X42 allows 39.6 %, so exactly one of the pair fails —
  // a single curve drawn for whichever grade was more common would misjudge
  // the other.
  //
  // The weaker grade being the more tolerant one is not a slip. The Level 0
  // target stress is SMYS itself, so what governs is r = SMYS / S_flow, and on
  // the Modified basis the flow-stress uplift is a fixed 69 MPa — proportionally
  // a larger margin on a weaker pipe. The screen asks whether the corroded
  // section can still carry SMYS, not whether it can carry more than X42 could.
  const items = population([
    { 'Max Depth [%]': '37', 'Length [mm]': '140', 'SMYS [MPa]': '359', 'LD [m]': '100' },
    { 'Max Depth [%]': '37', 'Length [mm]': '140', 'SMYS [MPa]': '290', 'LD [m]': '200' },
  ]);

  const outcome = screenAgainstEnvelope(items, config, 80, 'level-0');
  assert.equal(outcome.total, 2);
  assert.equal(outcome.exceeded, 1);
  assert.equal(outcome.fraction, 0.5);

  const [x52, x42] = outcome.verdicts;
  assert.equal(x52.exceeds, true);
  assert.equal(x42.exceeds, false);
  assert.ok(Math.abs(x52.allowablePct! - 34.17) < 0.05, `X52 allowable ${x52.allowablePct}`);
  assert.ok(Math.abs(x42.allowablePct! - 39.57) < 0.05, `X42 allowable ${x42.allowablePct}`);
  assert.ok(x52.utilisation! > 1 && x42.utilisation! < 1);

  // Keyed lookup is what the chart tooltip reads.
  assert.equal(outcome.byKey.get(items[0].key)?.exceeds, true);
});

test('the rejection line caps the allowance, so a deep short anomaly still fails', () => {
  // Short enough that the equations would tolerate more than a whole wall.
  const items = population([{ 'Max Depth [%]': '85', 'Length [mm]': '5' }]);
  const outcome = screenAgainstEnvelope(items, config, 80, 'level-0');

  assert.equal(outcome.verdicts[0].allowablePct, 80);
  assert.equal(outcome.exceeded, 1);
});

test('a feature with no grade is reported as unscreenable rather than passed', () => {
  // The importer rejects a zero SMYS, so this is the manual and back-fed paths
  // rather than an ILI tally — but a screen that silently passed what it could
  // not evaluate would be the worse failure of the two.
  assert.equal(acceptableDepthRatio(100, { ...geometry, smysMpa: 0 }, 'modified', 'smys69', 'level-0'), null);

  const items = population([{ 'Max Depth [%]': '90' }]);
  items[0].nominal.smys = 0;
  const outcome = screenAgainstEnvelope(items, config, 80, 'level-0');

  assert.equal(outcome.indeterminate, 1);
  assert.equal(outcome.exceeded, 0);
  assert.equal(outcome.verdicts[0].allowablePct, null);
});

test('no acceptable depth at all reads as zero allowable, not as a negative one', () => {
  // A line running past the flow stress of sound pipe: the equations solve
  // below zero, and a chart that printed "allowable −4.2 %WT" would be worse
  // than useless.
  const items = population([{ 'Operating Pressure P₀ [MPa]': '18.0', 'Max Depth [%]': '5' }]);
  const outcome = screenAgainstEnvelope(items, config, 80, 'operating-pressure');

  assert.equal(outcome.verdicts[0].allowablePct, 0);
  assert.equal(outcome.verdicts[0].exceeds, true);
  assert.equal(outcome.exceeded, 1);
});

test('the Level 0 screen still needs no safety factor, and the operating one does', () => {
  const noSafetyFactor = { ...geometry, safetyFactor: 0 };
  assert.ok(acceptableDepthRatio(100, noSafetyFactor, 'modified', 'smys69', 'level-0') !== null);
  assert.equal(acceptableDepthRatio(100, noSafetyFactor, 'modified', 'smys69', 'operating-pressure'), null);
});

test('the default basis of the drawn envelope is the code screen the chart is titled for', () => {
  const items = population();
  const domain = envelopeDomainMm(items, config);
  const drawn = buildEnvelopeCurves(items, config, domain, 80)[0];
  const explicit = buildEnvelopeCurves(items, config, domain, 80, 'level-0')[0];

  assert.equal(drawn.basis, 'level-0');
  assert.deepEqual(drawn.points, explicit.points);
});
