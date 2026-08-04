import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateB31g, type B31gGeometry } from '../src/lib/ffs/b31g.ts';
import {
  buildIliColonyProfile,
  evaluateEffectiveArea,
  type EffectiveAreaProfilePoint,
} from '../src/lib/ffs/effectiveArea.ts';
import { processRow } from '../src/lib/ffs/calcEngine.ts';
import { screenResults } from '../src/lib/ffs/screening.ts';
import { DEFAULT_SCREENING_CONFIG, type FfsConfig } from '../src/lib/ffs/types.ts';

const INCH_MM = 25.4;
const PSI_MPA = 0.006894757;

/** The Appendix A pipeline: NPS 24 × 0.313 in, X52, MAOP 976 psig, SF 1.39. */
const geometry: B31gGeometry = {
  wallThickness: 0.313 * INCH_MM,
  outerDiameter: 24 * INCH_MM,
  smysMpa: 52_000 * PSI_MPA,
  safetyFactor: 1.39,
  operatingPressureMpa: 976 * PSI_MPA,
};

/** A single rectangular box of constant depth, padded with sound metal. */
function rectangularProfile(depthMm: number, lengthMm: number, padMm = 1): EffectiveAreaProfilePoint[] {
  const e = 1e-4;
  return [
    { positionMm: 0, depthMm: 0 },
    { positionMm: padMm + e, depthMm },
    { positionMm: padMm + lengthMm - e, depthMm },
    { positionMm: padMm + lengthMm + padMm, depthMm: 0 },
  ];
}

/**
 * A parabolic profile of maximum depth d over length L encloses exactly
 * (2/3)·d·L of metal, so A/A0 = (2/3)(d/t) — which is the area term the
 * Original B31G short branch hard-codes. Feeding the same parabola through the
 * Effective Area Method must therefore land on the Original B31G answer
 * exactly. This is the anchor for the area integration: nothing else pins the
 * trapezoidal sum against a published closed form.
 */
function parabolicProfile(depthMm: number, lengthMm: number, stations = 801): EffectiveAreaProfilePoint[] {
  const profile: EffectiveAreaProfilePoint[] = [];
  for (let i = 0; i < stations; i++) {
    const x = (i / (stations - 1)) * lengthMm;
    const normalized = (2 * x) / lengthMm - 1;
    profile.push({ positionMm: x, depthMm: depthMm * (1 - normalized * normalized) });
  }
  return profile;
}

/** The candidate spanning the whole profile, whether or not it governs. */
function fullSpan(result: ReturnType<typeof evaluateEffectiveArea>, stations: number) {
  return result.candidates.find(
    (candidate) => candidate.startIndex === 0 && candidate.endIndex === stations - 1,
  );
}

test('a parabolic profile reproduces the Original B31G area term exactly', () => {
  const depthMm = 0.19 * INCH_MM;
  const lengthMm = 4 * INCH_MM;
  const stations = 801;

  const level1 = evaluateB31g(depthMm, lengthMm, geometry, 'original', 'smys69');
  const level2 = evaluateEffectiveArea(
    parabolicProfile(depthMm, lengthMm, stations),
    geometry,
    'original',
    'smys69',
    Number.MAX_SAFE_INTEGER,
  );

  assert.ok(level2.valid);
  const span = fullSpan(level2, stations);
  assert.ok(span, 'the whole-profile candidate must be evaluated');
  // A/A0 must come out at (2/3)(d/t).
  const areaRatio = span!.metalLossAreaMm2 / span!.originalAreaMm2;
  const expectedRatio = (2 / 3) * (depthMm / geometry.wallThickness);
  assert.ok(Math.abs(areaRatio - expectedRatio) < 1e-4, `A/A0 ${areaRatio} vs ${expectedRatio}`);

  const relative = Math.abs(span!.failureStressMpa - level1.failureStressMpa) / level1.failureStressMpa;
  assert.ok(relative < 0.0005, `Level 2 ${span!.failureStressMpa} vs Level 1 ${level1.failureStressMpa}`);
});

test('a rectangular profile is more conservative than either Level 1 shape factor', () => {
  // Level 1 assumes a shape: 2/3 of the box for Original, 0.85 for Modified. A
  // rectangle has none of that relief — the whole box really is gone — so the
  // measured-area result must sit below both. Reading the Level 2 number as
  // "less conservative" in general is exactly the mistake this guards.
  const depthMm = 0.19 * INCH_MM;
  const lengthMm = 4 * INCH_MM;
  const level2 = evaluateEffectiveArea(
    rectangularProfile(depthMm, lengthMm),
    geometry,
    'modified',
    'smys69',
    Number.MAX_SAFE_INTEGER,
  );

  // Stations 1 and 2 bound the box itself. The whole-profile span would dilute
  // A/A0 with the sound-metal pads, which is the search doing its job, not the
  // box's own area ratio.
  const box = level2.candidates.find(
    (candidate) => candidate.startIndex === 1 && candidate.endIndex === 2,
  );
  assert.ok(box, 'the box interior must be one of the evaluated sub-lengths');
  const areaRatio = box!.metalLossAreaMm2 / box!.originalAreaMm2;
  assert.ok(
    Math.abs(areaRatio - depthMm / geometry.wallThickness) < 1e-3,
    `A/A0 ${areaRatio} vs d/t ${depthMm / geometry.wallThickness}`,
  );

  const original = evaluateB31g(depthMm, lengthMm, geometry, 'original', 'smys69');
  const modified = evaluateB31g(depthMm, lengthMm, geometry, 'modified', 'smys69');
  assert.ok(level2.governing!.failureStressMpa < original.failureStressMpa);
  assert.ok(level2.governing!.failureStressMpa < modified.failureStressMpa);
});

test('the search finds the governing sub-length, not merely the whole profile', () => {
  // Appendix A Examples 1 to 3: an 8 in × 0.060 in pit and a 1 in × 0.190 in pit
  // separated by 0.9 in of sound metal. Level 1 has to merge them into one
  // 9.9 in flaw at 0.190 in deep, which fails; the profile keeps the sound metal.
  const e = 1e-4;
  const shallow = 0.060 * INCH_MM;
  const deep = 0.190 * INCH_MM;
  const pad = 1;
  const gapMm = 0.9 * INCH_MM;
  const profile: EffectiveAreaProfilePoint[] = [
    { positionMm: 0, depthMm: 0 },
    { positionMm: pad + e, depthMm: shallow },
    { positionMm: pad + 8 * INCH_MM - e, depthMm: shallow },
    { positionMm: pad + 8 * INCH_MM + e, depthMm: 0 },
    { positionMm: pad + 8 * INCH_MM + gapMm - e, depthMm: 0 },
    { positionMm: pad + 8 * INCH_MM + gapMm + e, depthMm: deep },
    { positionMm: pad + 9.9 * INCH_MM - e, depthMm: deep },
    { positionMm: pad + 9.9 * INCH_MM + pad, depthMm: 0 },
  ];

  const level2 = evaluateEffectiveArea(profile, geometry, 'original', 'smys69');
  const level1Merged = evaluateB31g(deep, 9.9 * INCH_MM, geometry, 'original', 'smys69');

  assert.ok(level2.valid && level2.governing !== null);
  // The published merged Level 1 answer is 38,682 psi.
  assert.ok(Math.abs(level1Merged.failureStressMpa / PSI_MPA - 38_682) < 20);
  // Level 2 must be less conservative than merging, because the sound metal
  // between the pits is real remaining strength.
  assert.ok(
    level2.governing!.failureStressMpa > level1Merged.failureStressMpa,
    'the effective-area result cannot be more conservative than merging the boxes',
  );
  // And it cannot exceed the weakest individual pit assessed on its own.
  const deepAlone = evaluateB31g(deep, 1 * INCH_MM, geometry, 'original', 'smys69');
  assert.ok(level2.governing!.failureStressMpa <= deepAlone.failureStressMpa + 1e-9);
});

test('every unordered pair of stations is evaluated', () => {
  const profile = rectangularProfile(2, 40);
  const result = evaluateEffectiveArea(profile, geometry, 'modified', 'smys69');
  const n = profile.length;
  assert.equal(result.iterations, (n * (n - 1)) / 2);
});

test('an unusable profile is reported rather than thrown', () => {
  assert.equal(
    evaluateEffectiveArea([{ positionMm: 0, depthMm: 0 }], geometry, 'modified').invalidReason,
    'A profile needs at least three stations, beginning and ending at full wall.',
  );
  assert.match(
    evaluateEffectiveArea(
      [
        { positionMm: 0, depthMm: 0 },
        { positionMm: 10, depthMm: 2 },
        { positionMm: 5, depthMm: 0 },
      ],
      geometry,
      'modified',
    ).invalidReason ?? '',
    /monotonic/i,
  );
});

/* ── Building a profile from ILI boxes ────────────────────────────────── */

const config: FfsConfig = {
  lineName: 'Effective area line',
  method: 'modified',
  modifiedSa: 'smys69',
  iliDate: new Date('2024-08-23'),
  highlightYears: 5,
  analysisHorizonYears: 30,
};

function row(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    'Feature ID': 'F-001',
    'LD [m]': '100',
    Section: 'Aerial Section',
    Surface: 'External',
    'Max Depth [%]': '40',
    'Length [mm]': '50',
    'Width [mm]': '40',
    'Orient. (hrs:mins)': '6:00',
    'Nominal Wall Thickness [mm]': '9.3',
    'CR Depth [mm/y]': '0.1',
    'CR Length [mm/y]': '0',
    'Design Factor': '0.72',
    'Outer Diameter Ds': '219.1',
    'SMYS [MPa]': '290',
    'Operating Pressure P₀ [MPa]': '9.35',
    ...overrides,
  };
}

function screened(rows: Record<string, string>[]) {
  return screenResults(rows.map((entry) => processRow(entry, config)), config, DEFAULT_SCREENING_CONFIG);
}

test('a colony of ILI boxes becomes a profile that starts and ends at full wall', () => {
  const items = screened([
    row({ 'Feature ID': 'A', 'LD [m]': '100.000', 'Length [mm]': '50', 'Max Depth [%]': '30' }),
    row({ 'Feature ID': 'B', 'LD [m]': '100.100', 'Length [mm]': '30', 'Max Depth [%]': '60' }),
  ]);

  const built = buildIliColonyProfile(items);
  assert.ok(built !== null);
  assert.equal(built!.profile[0].depthMm, 0);
  assert.equal(built!.profile.at(-1)!.depthMm, 0);
  assert.equal(built!.members.length, 2);
  // The deeper box must appear at its reported depth, not averaged away.
  const deepest = Math.max(...built!.profile.map((point) => point.depthMm));
  assert.ok(Math.abs(deepest - 0.6 * 9.3) < 1e-6);
});

test('a profile is refused where it would be a fiction', () => {
  // One box carries nothing Level 1 does not already have.
  assert.equal(buildIliColonyProfile(screened([row()])), null);
  // Boxes on different walls do not lie on one profile.
  assert.equal(
    buildIliColonyProfile(screened([
      row({ 'Feature ID': 'A', 'LD [m]': '100.0' }),
      row({ 'Feature ID': 'B', 'LD [m]': '100.1', 'Nominal Wall Thickness [mm]': '12.7' }),
    ])),
    null,
  );
});

test('overlapping boxes are resolved to the deeper one across the overlap', () => {
  const items = screened([
    row({ 'Feature ID': 'A', 'LD [m]': '100.000', 'Length [mm]': '100', 'Max Depth [%]': '20' }),
    row({ 'Feature ID': 'B', 'LD [m]': '100.000', 'Length [mm]': '40', 'Max Depth [%]': '55' }),
  ]);

  const built = buildIliColonyProfile(items);
  assert.ok(built !== null);
  const deepest = Math.max(...built!.profile.map((point) => point.depthMm));
  assert.ok(Math.abs(deepest - 0.55 * 9.3) < 1e-6);
});

test('the colony Level 2 result is less conservative than merging the colony', () => {
  const items = screened([
    row({ 'Feature ID': 'A', 'LD [m]': '100.000', 'Length [mm]': '60', 'Max Depth [%]': '25' }),
    row({ 'Feature ID': 'B', 'LD [m]': '100.150', 'Length [mm]': '40', 'Max Depth [%]': '65' }),
  ]);
  const built = buildIliColonyProfile(items);
  assert.ok(built !== null);

  const colonyGeometry: B31gGeometry = {
    wallThickness: items[0].nominal.wall,
    outerDiameter: items[0].nominal.od,
    smysMpa: items[0].nominal.smys,
    safetyFactor: items[0].nominal.safetyFactor,
    operatingPressureMpa: items[0].nominal.p0,
  };

  const level2 = evaluateEffectiveArea(built!.profile, colonyGeometry, 'modified', 'smys69');
  assert.ok(level2.valid && level2.governing !== null);

  // Level 1 has to merge: deepest depth over the full colony extent.
  const mergedLengthMm = built!.profile.at(-1)!.positionMm - built!.profile[0].positionMm;
  const merged = evaluateB31g(0.65 * 9.3, mergedLengthMm, colonyGeometry, 'modified', 'smys69');

  assert.ok(level2.governing!.failurePressureMpa > merged.failurePressureMpa);
});
