import assert from 'node:assert/strict';
import test from 'node:test';

import {
  NOMINAL_OD_MM,
  axialTicks,
  niceStep,
  sceneScale,
} from '../src/components/spool/spoolScale.ts';
import { buildSpoolPath } from '../src/components/spool/spoolPath.ts';

test('the 3D scene is metric: a 12 m spool is 12 world units of pipe', () => {
  // worldPerM is 1 in the pane, so the centreline length IS the master-axis
  // span. This is the property the whole true-scale view rests on.
  const path = buildSpoolPath(6.5, 18.5, 1, []);
  assert.equal(path.length, 12);
  // Centred on its own bounding box, so half the run sits either side.
  assert.ok(Math.abs(path.extentAxial - 6) < 1e-6, `extentAxial ${path.extentAxial}`);
  assert.equal(path.isStraight, true);
});

test('pipe radius is the real outside radius, in metres', () => {
  // 12" NPS, 323.9 mm OD → 0.16195 m radius. A 12 m spool is therefore ~37
  // diameters long, which is what a transmission spool actually looks like.
  const known = sceneScale(12, 323.9);
  assert.ok(Math.abs(known.radius - 0.16195) < 1e-9, `radius ${known.radius}`);
  assert.equal(known.odKnown, true);

  const wide = sceneScale(12, 762);
  assert.ok(Math.abs(wide.radius - 0.381) < 1e-9, `radius ${wide.radius}`);

  // A 30" pipe must be drawn wider than a 12" one rather than both landing on
  // one hard-coded stage radius, which is the bug this replaced.
  assert.ok(wide.radius > known.radius * 2);
});

test('an unset outside diameter falls back to a stated nominal, never a guess', () => {
  const nominal = sceneScale(12, null);
  assert.equal(nominal.odKnown, false);
  assert.equal(nominal.radius, NOMINAL_OD_MM / 2000);
});

test('label height follows whichever dimension frames the view', () => {
  // A long window is framed by its length…
  const long = sceneScale(120, 323.9);
  assert.ok(Math.abs(long.label - 120 * 0.022) < 1e-9, `label ${long.label}`);

  // …a window shorter than the pipe is wide is framed by its girth, so the
  // label must not collapse towards zero and become unreadable.
  const stub = sceneScale(0.2, 323.9);
  assert.ok(stub.label > 0.2 * 0.022, `label ${stub.label}`);
  assert.ok(Math.abs(stub.label - 0.16195 * 10 * 0.022) < 1e-9, `label ${stub.label}`);
});

test('axial ticks stay on the readable ladder at true scale', () => {
  assert.equal(niceStep(12), 2);
  assert.deepEqual(axialTicks(6.5, 18.5), [8, 10, 12, 14, 16, 18]);
});
