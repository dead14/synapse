import assert from 'node:assert/strict';
import test from 'node:test';

import { bendArcLength, buildSpoolPath } from '../src/components/spool/spoolPath.ts';
import {
  classifyFitting,
  collectSpoolFittings,
  reportedBendAngle,
} from '../src/components/spool/spoolFittings.ts';
import type { SpoolFeature } from '../src/domain/spoolFeatures.ts';

const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function feature(overrides: Partial<SpoolFeature> & { key: string; maM: number; featureType: string }): SpoolFeature {
  const side = {
    present: true,
    id: overrides.key,
    maM: overrides.maM,
    reportedM: overrides.maM,
    depthPct: null,
    lengthMm: null,
    widthMm: null,
    clockDeg: null,
    clockLabel: '—',
    wtMm: null,
    erf: null,
    psafeBar: null,
    external: null,
    jointNo: null,
    distGwM: null,
    featureType: overrides.featureType,
    year: null,
    remainingWtMm: null,
  };
  return {
    key: overrides.key,
    rowIndex: 0,
    id: overrides.key,
    kind: 'other',
    featureClass: 'other',
    status: 'new',
    maM: overrides.maM,
    clockDeg: 0,
    clockLabel: '12:00',
    current: side,
    previous: { ...side, present: false },
    depthDeltaPct: null,
    lengthDeltaMm: null,
    widthDeltaMm: null,
    erfDelta: null,
    remainingWtDeltaMm: null,
    maShiftM: null,
    depthGrowthPctPerYear: null,
    lengthGrowthMmPerYear: null,
    intervalYears: null,
    section: null,
    bypassReason: null,
    physicsWarning: null,
    comment: null,
    ...overrides,
  } as SpoolFeature;
}

test('a spool with no fitting is drawn straight, as it always was', () => {
  const path = buildSpoolPath(100, 112, 2, []);

  assert.equal(path.isStraight, true);
  assert.equal(path.length, 24);
  const start = path.frameAt(100);
  const end = path.frameAt(112);
  assert.deepEqual(start.tangent, [1, 0, 0]);
  assert.deepEqual(end.tangent, [1, 0, 0]);
  // Centred on its own bounding box, so the camera target still frames it.
  assert.ok(Math.abs(start.origin[0] + 12) < 1e-6);
  assert.ok(Math.abs(end.origin[0] - 12) < 1e-6);
});

test('a bend between the two welds turns the pipe by the angle it was given', () => {
  const path = buildSpoolPath(100, 112, 2, [
    { key: 'bend', maM: 106, angleDeg: 90, rollDeg: 0, radius: 6 },
  ]);

  assert.equal(path.isStraight, false);
  const before = path.frameAt(101);
  const after = path.frameAt(111);
  assert.ok(dot(before.tangent, [1, 0, 0]) > 0.999, 'upstream leg runs along the axis');
  // Rolled to 12:00, so the pipe turns up: the downstream tangent is +Y.
  assert.ok(dot(after.tangent, [0, 1, 0]) > 0.99, `downstream leg turns up, got ${after.tangent}`);
  assert.ok(Math.abs(dot(after.tangent, before.tangent)) < 0.02, 'the two legs are square');
});

test('the clock frame is carried around a bend without twisting', () => {
  const path = buildSpoolPath(0, 20, 1, [
    { key: 'bend', maM: 10, angleDeg: 90, rollDeg: 90, radius: 4 },
  ]);
  const after = path.frameAt(19);

  // up, right and tangent stay a right-handed orthonormal frame, which is what
  // keeps 12:00 meaning 12:00 on the far side of the corner.
  assert.ok(Math.abs(dot(after.up, after.right)) < 1e-6);
  assert.ok(Math.abs(dot(after.up, after.tangent)) < 1e-6);
  assert.ok(Math.abs(Math.hypot(...after.up) - 1) < 1e-6);
  assert.ok(Math.abs(Math.hypot(...after.right) - 1) < 1e-6);
});

test('a bend consumes its own arc length, so nothing moves axially', () => {
  // Distance on the master axis is arc length along the pipe, which is what an
  // ILI odometer measures — the whole reason a bend may not shift a feature.
  const arc = bendArcLength(90, 6);
  assert.ok(Math.abs(arc - (Math.PI / 2) * 6) < 1e-9);

  const worldPerM = 2;
  const straight = buildSpoolPath(100, 112, worldPerM, []);
  const bent = buildSpoolPath(100, 112, worldPerM, [
    { key: 'bend', maM: 106, angleDeg: 45, rollDeg: 0, radius: 6 },
  ]);
  assert.equal(bent.length, straight.length);
  assert.ok(Math.abs(bent.frameAt(103).s - straight.frameAt(103).s) < 1e-9);
});

test('bend angles are read from the reported label and never invented silently', () => {
  assert.equal(reportedBendAngle('Bend 45'), 45);
  assert.equal(reportedBendAngle('45 deg elbow'), 45);
  assert.equal(reportedBendAngle('Pipe Jog 30'), 30);
  assert.equal(reportedBendAngle('Bend'), null);
  assert.equal(reportedBendAngle('Elbow'), null);
  assert.equal(reportedBendAngle('Valve'), null);
});

test('classification separates the furniture the pane draws differently', () => {
  assert.equal(classifyFitting('Pipeline Bend'), 'bend');
  assert.equal(classifyFitting('90 Elbow'), 'bend');
  assert.equal(classifyFitting('Tee'), 'tee');
  assert.equal(classifyFitting('Branch offtake'), 'tee');
  assert.equal(classifyFitting('Ball Valve'), 'valve');
  assert.equal(classifyFitting('Weld neck flange'), 'flange');
  assert.equal(classifyFitting('Metal Loss'), null);
});

test('only the fittings between the two picked welds are collected', () => {
  const features = [
    feature({ key: 'a', maM: 99, featureType: 'Bend' }),
    feature({ key: 'b', maM: 104, featureType: 'Bend 45' }),
    feature({ key: 'c', maM: 108, featureType: 'Ball Valve' }),
    feature({ key: 'd', maM: 110, featureType: 'Metal Loss' }),
    feature({ key: 'e', maM: 130, featureType: 'Tee' }),
  ];

  const fittings = collectSpoolFittings(features, { startM: 100, endM: 112 });

  assert.deepEqual(fittings.map((fitting) => fitting.key), ['b', 'c']);
  assert.equal(fittings[0].kind, 'bend');
  assert.equal(fittings[0].angleDeg, 45);
  assert.equal(fittings[0].angleAssumed, false);
  assert.equal(fittings[1].kind, 'valve');
  assert.equal(fittings[1].angleDeg, null);
});

test('an unreported bend angle is drawn at 90 degrees and flagged as assumed', () => {
  const [fitting] = collectSpoolFittings(
    [feature({ key: 'b', maM: 104, featureType: 'Bend' })],
    { startM: 100, endM: 112 },
  );

  assert.equal(fitting.angleDeg, 90);
  assert.equal(fitting.angleAssumed, true);
  assert.equal(fitting.isOverridden, false);
});

test('the engineer can set the angle, the direction and the fitting type', () => {
  const features = [feature({ key: 'b', maM: 104, featureType: 'Bend' })];
  const [overridden] = collectSpoolFittings(features, { startM: 100, endM: 112 }, {
    b: { angleDeg: 45, rollDeg: 180 },
  });

  assert.equal(overridden.angleDeg, 45);
  assert.equal(overridden.rollDeg, 180);
  assert.equal(overridden.angleAssumed, false);
  assert.equal(overridden.isOverridden, true);

  // A feature the run did not label as furniture can still be declared one.
  const [declared] = collectSpoolFittings(
    [feature({ key: 'x', maM: 105, featureType: 'Unknown object' })],
    { startM: 100, endM: 112 },
    { x: { kind: 'tee' } },
  );
  assert.equal(declared.kind, 'tee');
});
