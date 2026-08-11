import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GIRTH_EXAGGERATION,
  MAX_DRAWN_ARC_DEG,
  NOMINAL_OD_MM,
  axialTicks,
  bendRadiusM,
  drawnArcDeg,
  drawnAxialM,
  drawnRadialM,
  drawnSizeIsCapped,
  niceStep,
  sceneScale,
} from '../src/components/spool/spoolScale.ts';
import { arcWidthDeg } from '../src/domain/spoolFeatures.ts';
import { bendArcLength, buildSpoolPath } from '../src/components/spool/spoolPath.ts';

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

test('a bend turns on the real radius, not the exaggerated one', () => {
  // The arc an elbow consumes is odometer distance. Deriving it from the drawn
  // radius made a 90 degrees bend eat four times the master axis it really
  // does, which displaced every feature downstream of the turn.
  const { trueRadius } = sceneScale(12, 323.9, { hasBend: true });
  const arc = bendArcLength(90, bendRadiusM(trueRadius));

  // 1.5 diameters of 323.9 mm pipe, quarter turn: 0.486 m radius -> 0.763 m.
  assert.ok(Math.abs(arc - 0.7632) < 1e-3, `arc ${arc}`);

  // The whole point: the turn fits inside a short spool instead of swallowing
  // it. buildSpoolPath clamps an over-long arc to the window, which is what
  // turned a 2.29 m window into one continuous curve.
  assert.ok(arc < 2.29, `a 90 degrees bend must fit inside a 2.29 m window, got ${arc}`);
});

test('girth exaggeration backs off far enough for a bend to render', () => {
  const straight = sceneScale(12, 323.9);
  const bent = sceneScale(12, 323.9, { hasBend: true });

  assert.equal(straight.girth, GIRTH_EXAGGERATION);
  assert.ok(bent.girth < straight.girth, `bent girth ${bent.girth}`);

  // The inner wall of the elbow must stay clear of the centre of the turn, or
  // the shell folds through itself.
  assert.ok(
    bent.radius < bendRadiusM(bent.trueRadius),
    `drawn radius ${bent.radius} must sit inside bend radius ${bendRadiusM(bent.trueRadius)}`,
  );
  // Still fatter than life, so a bent spool is legible too.
  assert.ok(bent.girth > 1, `bent girth ${bent.girth}`);
});

test('axial ticks stay on the readable ladder at true scale', () => {
  assert.equal(niceStep(12), 2);
  assert.deepEqual(axialTicks(6.5, 18.5), [8, 10, 12, 14, 16, 18]);
});

test('marker magnification cannot draw a patch off the pipe it sits on', () => {
  // The failure this guards. An 8" line is 638 mm around, so a 100 mm wide box
  // already covers 56 degrees of it. Multiplied by the pane's default 6x that
  // is 339 degrees — nearly a full wrap — and the flat plate the scene used to
  // draw for it was metres across, hanging in space beside the pipe with the
  // camera inside it.
  const trueArc = arcWidthDeg(100, 203.2) as number;
  assert.ok(trueArc > 55 && trueArc < 57, `true arc ${trueArc}`);
  assert.ok(trueArc * 6 > 300, 'the unclamped product is what used to be drawn');

  const drawn = drawnArcDeg(trueArc, 6);
  assert.equal(drawn, MAX_DRAWN_ARC_DEG);
  assert.ok(drawn <= 360, 'a defect can never wrap further than the pipe');
});

test('magnification still lifts a small defect, and never shrinks a real one', () => {
  // What the magnification is for: a 6 mm pit on an 8" line is under 2 degrees
  // and invisible at true scale, so it is allowed the full factor.
  const small = arcWidthDeg(6, 203.2) as number;
  assert.ok(Math.abs(drawnArcDeg(small, 6) - small * 6) < 1e-9, 'small defects magnify in full');

  // And a genuinely wide cluster keeps its measured extent rather than being
  // clamped down to the ceiling, which would understate the metal loss.
  const wide = arcWidthDeg(600, 203.2) as number;
  assert.ok(wide > MAX_DRAWN_ARC_DEG, `measured arc ${wide}`);
  assert.equal(drawnArcDeg(wide, 6), Math.min(wide, 360));

  // A width with no diameter behind it draws a nominal band, unmagnified: a
  // made-up width multiplied six times is a made-up width smeared six times.
  assert.equal(drawnArcDeg(null, 6), 8);
});

test('an axial length may not be magnified past a quarter of the window', () => {
  // A 2 m vendor-merged cluster on a 12 m spool is 12 m long at 6x — the patch
  // swallows the whole drawing and the spool underneath it.
  assert.equal(drawnAxialM(2000, 6, 12), 3);
  // Short features still get the full factor.
  assert.ok(Math.abs(drawnAxialM(50, 6, 12) - 0.3) < 1e-9);
  // A cluster longer than the ceiling keeps its measured length.
  assert.equal(drawnAxialM(9000, 6, 12), 9);
});

test('wall loss is drawn inside the wall, however large the magnification', () => {
  const scale = sceneScale(12, 203.2);
  // 5 mm of loss, exaggerated with the girth and then by 16x, would otherwise
  // reach past the centreline and turn the pit inside out.
  const deep = drawnRadialM(5, 16, scale.radius, scale.girth);
  assert.ok(deep < scale.radius, `drawn depth ${deep} must stay inside radius ${scale.radius}`);
  // A run with no wall thickness has no depth to draw, but the patch still has
  // to be thick enough to see.
  assert.ok(drawnRadialM(0, 6, scale.radius, scale.girth) > 0);
});

test('the pane reports when the ceilings bit, rather than claiming the factor', () => {
  const wide = arcWidthDeg(100, 203.2);
  assert.equal(drawnSizeIsCapped(wide, 40, 6, 12), true);
  assert.equal(drawnSizeIsCapped(arcWidthDeg(6, 203.2), 40, 6, 12), false);
  // At true scale nothing is magnified, so nothing can be capped.
  assert.equal(drawnSizeIsCapped(wide, 40, 1, 12), false);
});
