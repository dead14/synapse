import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GIRTH_EXAGGERATION,
  NOMINAL_OD_MM,
  axialTicks,
  niceStep,
  sceneScale,
} from '../src/components/spool/spoolScale.ts';
import { buildSpoolPath } from '../src/components/spool/spoolPath.ts';

test('axial distance is true metres: a 12 m spool is 12 world units long', () => {
  // worldPerM is 1 in the pane, so the centreline length IS the master-axis
  // span. Length on screen is therefore proportional to length on the pipe.
  const path = buildSpoolPath(6.5, 18.5, 1, []);
  assert.equal(path.length, 12);
  // Centred on its own bounding box, so half the run sits either side.
  assert.ok(Math.abs(path.extentAxial - 6) < 1e-6, `extentAxial ${path.extentAxial}`);
  assert.equal(path.isStraight, true);
});

test('picking a second spool draws a pipe exactly twice as long', () => {
  // The point of the picture. The old fixed 10-40 unit stage clamped both of
  // these to the same length, so one spool and two looked identical.
  const one = buildSpoolPath(0, 12, 1, []);
  const two = buildSpoolPath(0, 24, 1, []);
  assert.equal(two.length, one.length * 2);

  // And the girth does not move with the window, so the shape genuinely
  // lengthens instead of being rescaled back to the same proportions.
  assert.equal(sceneScale(24, 323.9).radius, sceneScale(12, 323.9).radius);
});

test('girth is exaggerated by a constant so one spool is legible', () => {
  // 12" NPS, 323.9 mm OD -> 0.16195 m true radius. At true proportions a 12 m
  // spool is ~37 diameters long and renders as a hair; the constant brings it
  // to roughly 9:1 without touching the axis.
  const known = sceneScale(12, 323.9);
  assert.ok(Math.abs(known.trueRadius - 0.16195) < 1e-9, `trueRadius ${known.trueRadius}`);
  assert.equal(known.radius, known.trueRadius * GIRTH_EXAGGERATION);
  assert.equal(known.girth, GIRTH_EXAGGERATION);
  assert.equal(known.odKnown, true);

  const drawnRatio = known.spanM / (known.radius * 2);
  assert.ok(drawnRatio > 5 && drawnRatio < 15, `drawn length:diameter ${drawnRatio}`);
});

test('every diameter is exaggerated equally, so pipes stay comparable', () => {
  const twelveInch = sceneScale(12, 323.9);
  const thirtyInch = sceneScale(12, 762);

  // A 30" pipe is 2.35x a 12" one in reality and must stay 2.35x on screen.
  const trueRatio = 762 / 323.9;
  const drawnRatio = thirtyInch.radius / twelveInch.radius;
  assert.ok(Math.abs(drawnRatio - trueRatio) < 1e-9, `drawn ${drawnRatio} vs true ${trueRatio}`);
});

test('an unset outside diameter falls back to a stated nominal, never a guess', () => {
  const nominal = sceneScale(12, null);
  assert.equal(nominal.odKnown, false);
  assert.equal(nominal.trueRadius, NOMINAL_OD_MM / 2000);
});

test('label height follows whichever dimension frames the view', () => {
  // A long window is framed by its length…
  const long = sceneScale(120, 323.9);
  assert.ok(Math.abs(long.label - 120 * 0.022) < 1e-9, `label ${long.label}`);

  // …a window shorter than the pipe is wide is framed by its girth, so the
  // label must not collapse towards zero and become unreadable.
  const stub = sceneScale(0.2, 323.9);
  assert.ok(stub.label > 0.2 * 0.022, `label ${stub.label}`);
});

test('axial ticks stay on the readable ladder at true scale', () => {
  assert.equal(niceStep(12), 2);
  assert.deepEqual(axialTicks(6.5, 18.5), [8, 10, 12, 14, 16, 18]);
});
