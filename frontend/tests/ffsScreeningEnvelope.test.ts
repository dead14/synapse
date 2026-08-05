/**
 * The screening chart rendered a legend with no lines beside it.
 *
 * Two faults stacked. Short anomalies solve to an allowable depth above the
 * wall itself — the equations do not stop metal loss reaching 117 % of a wall
 * that only has 100 % to give — and the builder dropped every such point. On a
 * lightly loaded line that is the whole curve. Then the x domain was taken from
 * the reported lengths, so a tally of uniformly short boxes kept the axis too
 * short for any envelope to bend inside it, which removed whatever the first
 * fault had left.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { processRow } from '../src/lib/ffs/calcEngine.ts';
import { screenResults } from '../src/lib/ffs/screening.ts';
import { buildEnvelopeCurves, envelopeDomainMm, measureUniformity } from '../src/lib/ffs/chartData.ts';
import { DEFAULT_SCREENING_CONFIG, type FfsConfig } from '../src/lib/ffs/types.ts';

const config: FfsConfig = {
  lineName: 'Envelope line',
  method: 'modified',
  modifiedSa: 'smys69',
  iliDate: new Date('2026-01-01T00:00:00.000Z'),
  highlightYears: 5,
};

function row(overrides: Record<string, string> = {}) {
  return {
    'LD [m]': '100',
    Section: 'S-01',
    Surface: 'External',
    'Max Depth [%]': '25',
    'Length [mm]': '20',
    'Width [mm]': '30',
    'Orient. (hrs:mins)': '6:00',
    'Nominal Wall Thickness [mm]': '9.27',
    'CR Depth [mm/y]': '0.1',
    'CR Length [mm/y]': '0',
    'Design Factor': '0.72',
    'Outer Diameter Ds': '508',
    'SMYS [MPa]': '359',
    'Operating Pressure P₀ [MPa]': '6.0',
    ...overrides,
  };
}

function population(overrides: Record<string, string>[] = [{}]) {
  return screenResults(overrides.map((o) => processRow(row(o), config)), config, DEFAULT_SCREENING_CONFIG);
}

test('the envelope is drawn even when every reported length is short', () => {
  // The exact shape of the reported chart: two walls, every box 20 mm.
  const items = population([
    { 'Nominal Wall Thickness [mm]': '9.27' },
    { 'Nominal Wall Thickness [mm]': '12.70', 'LD [m]': '200' },
  ]);
  const domain = envelopeDomainMm(items, config);
  const curves = buildEnvelopeCurves(items, config, domain, DEFAULT_SCREENING_CONFIG.depthRejectionPct);

  assert.equal(curves.length, 2);
  for (const curve of curves) {
    assert.ok(curve.points.length > 10, `t=${curve.wall} drew ${curve.points.length} points`);
  }
});

test('the domain reaches past the knee instead of stopping at the data', () => {
  const items = population();
  const dataMax = Math.max(...items.map((item) => item.nominal.length));
  const domain = envelopeDomainMm(items, config);

  assert.equal(dataMax, 20);
  assert.ok(domain > 200, `domain ${domain} must clear the knee, not the 22 mm the data would give`);
});

test('the flat top is clamped to the project rejection line, not discarded', () => {
  const items = population();
  const curve = buildEnvelopeCurves(items, config, envelopeDomainMm(items, config), 80)[0];

  // Short anomalies solve above the wall; they belong on the 80 %WT line.
  assert.ok(curve.points[0].y <= 80 + 1e-9);
  assert.ok(curve.points.some((point) => Math.abs(point.y - 80) < 1e-9), 'no flat top drawn');
  assert.ok(curve.points.every((point) => point.y > 0 && point.y <= 80 + 1e-9));
});

test('the envelope falls as anomalies lengthen, and never rises', () => {
  const items = population();
  const curve = buildEnvelopeCurves(items, config, envelopeDomainMm(items, config), 80)[0];

  for (let i = 1; i < curve.points.length; i++) {
    assert.ok(
      curve.points[i].y <= curve.points[i - 1].y + 1e-9,
      `depth rose at ${curve.points[i].x} mm`,
    );
  }
});

test('a stricter rejection line lowers the flat top with it', () => {
  const items = population();
  const domain = envelopeDomainMm(items, config);
  const at80 = buildEnvelopeCurves(items, config, domain, 80)[0];
  const at70 = buildEnvelopeCurves(items, config, domain, 70)[0];

  assert.ok(at80.points[0].y > at70.points[0].y);
  assert.ok(at70.points.every((point) => point.y <= 70 + 1e-9));
});

test('a column holding one value is reported as degenerate', () => {
  const uniform = measureUniformity(new Array(7436).fill(20));
  assert.equal(uniform.degenerate, true);
  assert.equal(uniform.value, 20);
  assert.equal(uniform.distinctCount, 1);
  assert.equal(uniform.total, 7436);

  // A real spread is not flagged, and neither is a merely common value.
  const varied = measureUniformity([20, 20, 20, 35, 48, 61, 77, 90, 120, 150]);
  assert.equal(varied.degenerate, false);
  assert.equal(varied.value, 20);
  assert.equal(varied.distinctCount, 8);
});

test('measuring an empty population does not claim degeneracy', () => {
  const empty = measureUniformity([]);
  assert.equal(empty.degenerate, false);
  assert.equal(empty.value, null);
  assert.equal(empty.total, 0);
});
