import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MODIFIED_B31G_Z_CUTOFF,
  ORIGINAL_B31G_Z_CUTOFF,
  evaluateModifiedB31g,
  evaluateOriginalB31g,
} from '../src/lib/ffs/calcEngine.ts';
import { validateFlowStressQualification } from '../src/lib/ffs/b31g.ts';
import {
  inchesToMillimetres,
  ksiToMegapascals,
  millimetresToInches,
  psiToMegapascals,
} from '../src/lib/ffs/units.ts';

const baseInput = {
  depth: 2,
  length: 100,
  wallThickness: 10,
  outerDiameter: 500,
  smysMpa: 400,
  designFactor: 0.72,
  operatingPressureMpa: 5,
};

test('uses the exact ASME Original B31G branch boundary z = 20', () => {
  assert.equal(ORIGINAL_B31G_Z_CUTOFF, 20);
  const lengthAtBoundary = Math.sqrt(20 * baseInput.outerDiameter * baseInput.wallThickness);
  assert.equal(evaluateOriginalB31g({ ...baseInput, length: lengthAtBoundary }).branch, 'ORIGINAL_SHORT_PARABOLIC');
  assert.equal(
    evaluateOriginalB31g({ ...baseInput, length: lengthAtBoundary + 1e-6 }).branch,
    'ORIGINAL_LONG_RECTANGULAR',
  );
});

test('enforces the ASME qualifications for SMYS + 69 MPa without an SMTS gate', () => {
  const valid = {
    method: 'modified' as const,
    flowStressMode: 'smys69' as const,
    smysMpa: 400,
    materialClass: 'plain-carbon-low-alloy' as const,
    operatingTemperatureC: 80,
  };

  assert.deepEqual(validateFlowStressQualification(valid), []);
  assert.match(validateFlowStressQualification({ ...valid, smysMpa: 484 }).join(' '), /483 MPa/i);
  assert.match(
    validateFlowStressQualification({ ...valid, materialClass: 'other' }).join(' '),
    /plain carbon|low-alloy/i,
  );
  assert.match(
    validateFlowStressQualification({ ...valid, operatingTemperatureC: 120 }).join(' '),
    /120.*C/i,
  );
});

test('reproduces the ASME B31G-2023 Appendix A combined-flaw benchmarks', () => {
  const appendixA = {
    depth: inchesToMillimetres(0.190),
    length: inchesToMillimetres(9.9),
    wallThickness: inchesToMillimetres(0.313),
    outerDiameter: inchesToMillimetres(24),
    smysMpa: ksiToMegapascals(52),
    designFactor: 1 / 1.39,
    operatingPressureMpa: psiToMegapascals(976),
  };

  const original = evaluateOriginalB31g(appendixA);
  const modified = evaluateModifiedB31g(appendixA, 'smys69');
  const mpaToPsi = (value: number) => value / psiToMegapascals(1);

  assert.ok(Math.abs(mpaToPsi(original.failureStressMpa) - 38_680) < 1);
  assert.ok(Math.abs(mpaToPsi(modified.failureStressMpa) - 36_411) < 1);
});

function assertClose(actual: number, expected: number, tolerance = 1e-10) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
}

test('evaluates the Original B31G short-defect branch deterministically', () => {
  const result = evaluateOriginalB31g(baseInput);

  assert.equal(result.branch, 'ORIGINAL_SHORT_PARABOLIC');
  assertClose(result.z, 2);
  assertClose(result.foliasFactor!, 1.61245154965971);
  assertClose(result.flowStressMpa, 440);
  assertClose(result.failureStressMpa, 415.7081682067248);
  assertClose(result.failurePressureMpa, 16.62832672826899);
  assertClose(result.safePressureMpa, 11.972395244353674);
  assertClose(result.erf, 0.41762737513682235);
});

test('evaluates the Original B31G long-defect branch deterministically', () => {
  const result = evaluateOriginalB31g({ ...baseInput, length: 400 });

  assert.equal(result.branch, 'ORIGINAL_LONG_RECTANGULAR');
  assert.equal(result.foliasFactor, null);
  assertClose(result.z, 32);
  assertClose(result.failureStressMpa, 352);
  assertClose(result.safePressureMpa, 10.1376);
  assertClose(result.erf, 0.49321338383838387);
});

test('evaluates both Modified B31G Folias-factor branches deterministically', () => {
  const shortResult = evaluateModifiedB31g(baseInput, 'smys69');
  const longResult = evaluateModifiedB31g({
    ...baseInput,
    length: Math.sqrt(100 * baseInput.outerDiameter * baseInput.wallThickness),
  }, 'smys69');

  assert.equal(shortResult.branch, 'MODIFIED_SHORT_POLYNOMIAL');
  assertClose(shortResult.flowStressMpa, 468.94757);
  assertClose(shortResult.foliasFactor!, 1.497163985674248);
  assertClose(shortResult.safePressureMpa, 12.645606207578902);
  assertClose(shortResult.erf, 0.3953942514043609);

  assert.equal(longResult.branch, 'MODIFIED_LONG_LINEAR');
  assertClose(longResult.z, 100);
  assertClose(longResult.foliasFactor!, 6.5);
  assertClose(longResult.safePressureMpa, 11.510773718218008);
  assertClose(longResult.erf, 0.4343756659977201);
});

test('is invariant when every length is expressed in another consistent unit', () => {
  const mmResult = evaluateModifiedB31g(baseInput, 'smys69');
  const inchResult = evaluateModifiedB31g({
    ...baseInput,
    depth: millimetresToInches(baseInput.depth),
    length: millimetresToInches(baseInput.length),
    wallThickness: millimetresToInches(baseInput.wallThickness),
    outerDiameter: millimetresToInches(baseInput.outerDiameter),
  }, 'smys69');

  assertClose(inchResult.z, mmResult.z);
  assertClose(inchResult.failureStressMpa, mmResult.failureStressMpa);
  assertClose(inchResult.failurePressureMpa, mmResult.failurePressureMpa);
  assertClose(inchResult.erf, mmResult.erf);
});

test('keeps both cutoff neighborhoods finite and exposes the Original discontinuity', () => {
  const lengthForZ = (z: number) => Math.sqrt(z * baseInput.outerDiameter * baseInput.wallThickness);
  const epsilon = 1e-8;

  const originalLeft = evaluateOriginalB31g({ ...baseInput, length: lengthForZ(ORIGINAL_B31G_Z_CUTOFF - epsilon) });
  const originalRight = evaluateOriginalB31g({ ...baseInput, length: lengthForZ(ORIGINAL_B31G_Z_CUTOFF + epsilon) });
  const modifiedLeft = evaluateModifiedB31g({ ...baseInput, length: lengthForZ(MODIFIED_B31G_Z_CUTOFF - epsilon) }, 'smys69');
  const modifiedRight = evaluateModifiedB31g({ ...baseInput, length: lengthForZ(MODIFIED_B31G_Z_CUTOFF + epsilon) }, 'smys69');

  for (const result of [originalLeft, originalRight, modifiedLeft, modifiedRight]) {
    assert.ok(Number.isFinite(result.failureStressMpa));
    assert.ok(Number.isFinite(result.safePressureMpa));
    assert.ok(Number.isFinite(result.erf));
  }
  assert.ok(originalRight.failureStressMpa < originalLeft.failureStressMpa);
  assert.ok(Math.abs(modifiedRight.foliasFactor! - modifiedLeft.foliasFactor!) < 0.01);
});
