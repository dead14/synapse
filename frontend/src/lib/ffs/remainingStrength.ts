import type { FfsConfig } from './types';
import { ksiToMegapascals } from './units.ts';

export const ORIGINAL_B31G_NORMALIZED_LENGTH_CUTOFF = 4.479;
export const ORIGINAL_B31G_Z_CUTOFF = ORIGINAL_B31G_NORMALIZED_LENGTH_CUTOFF ** 2;
export const MODIFIED_B31G_Z_CUTOFF = 50;

export type B31gBranch =
  | 'ORIGINAL_SHORT_PARABOLIC'
  | 'ORIGINAL_LONG_RECTANGULAR'
  | 'MODIFIED_SHORT_POLYNOMIAL'
  | 'MODIFIED_LONG_LINEAR';

export interface B31gEvaluationInput {
  depth: number;
  length: number;
  wallThickness: number;
  outerDiameter: number;
  smysMpa: number;
  designFactor: number;
  operatingPressureMpa: number;
}

export interface B31gEvaluation {
  branch: B31gBranch;
  depthRatio: number;
  z: number;
  foliasFactor: number | null;
  flowStressMpa: number;
  failureStressMpa: number;
  failurePressureMpa: number;
  safePressureMpa: number;
  operatingHoopStressMpa: number;
  erf: number;
}

function requireEvaluationInput(input: B31gEvaluationInput): number {
  const positiveEntries: Array<[string, number]> = [
    ['length', input.length],
    ['wallThickness', input.wallThickness],
    ['outerDiameter', input.outerDiameter],
    ['smysMpa', input.smysMpa],
    ['designFactor', input.designFactor],
    ['operatingPressureMpa', input.operatingPressureMpa],
  ];
  for (const [name, value] of positiveEntries) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new RangeError(`${name} must be finite and greater than zero`);
    }
  }
  if (!Number.isFinite(input.depth) || input.depth < 0) {
    throw new RangeError('depth must be finite and non-negative');
  }
  if (input.designFactor > 1) {
    throw new RangeError('designFactor must not exceed 1');
  }
  if (input.outerDiameter <= 2 * input.wallThickness) {
    throw new RangeError('outerDiameter must exceed twice the wall thickness');
  }

  const depthRatio = input.depth / input.wallThickness;
  if (!Number.isFinite(depthRatio) || depthRatio > 0.8 + Number.EPSILON * 8) {
    throw new RangeError('depth must not exceed 80% of wall thickness');
  }
  return depthRatio;
}

function finishEvaluation(
  input: B31gEvaluationInput,
  depthRatio: number,
  z: number,
  foliasFactor: number | null,
  flowStressMpa: number,
  failureStressMpa: number,
  branch: B31gBranch,
): B31gEvaluation {
  const failurePressureMpa = 2 * failureStressMpa * input.wallThickness / input.outerDiameter;
  const safePressureMpa = failurePressureMpa * input.designFactor;
  const operatingHoopStressMpa = input.operatingPressureMpa * input.outerDiameter / (2 * input.wallThickness);
  const erf = input.operatingPressureMpa / safePressureMpa;
  const derived = [z, flowStressMpa, failureStressMpa, failurePressureMpa, safePressureMpa, operatingHoopStressMpa, erf];
  if (derived.some((value) => !Number.isFinite(value)) || failureStressMpa <= 0 || safePressureMpa <= 0) {
    throw new RangeError('B31G calculation produced a non-finite or non-positive result');
  }
  return {
    branch,
    depthRatio,
    z,
    foliasFactor,
    flowStressMpa,
    failureStressMpa,
    failurePressureMpa,
    safePressureMpa,
    operatingHoopStressMpa,
    erf,
  };
}

// Public technical basis for the equation forms and branch factors:
// https://primis.phmsa.dot.gov/rd/FileGet/1934/FinalCorrosionCriteriaReport.pdf
// This implementation is not a claim of conformance to a licensed ASME edition.
export function evaluateOriginalB31g(input: B31gEvaluationInput): B31gEvaluation {
  const depthRatio = requireEvaluationInput(input);
  const z = input.length ** 2 / (input.outerDiameter * input.wallThickness);
  const flowStressMpa = 1.1 * input.smysMpa;
  if (!Number.isFinite(z)) throw new RangeError('normalized defect length must be finite');

  if (z <= ORIGINAL_B31G_Z_CUTOFF) {
    const foliasFactor = Math.sqrt(1 + 0.8 * z);
    const areaRatio = (2 / 3) * depthRatio;
    const denominator = 1 - areaRatio / foliasFactor;
    if (denominator <= 0) throw new RangeError('Original B31G denominator is non-positive');
    const failureStressMpa = flowStressMpa * (1 - areaRatio) / denominator;
    return finishEvaluation(input, depthRatio, z, foliasFactor, flowStressMpa, failureStressMpa, 'ORIGINAL_SHORT_PARABOLIC');
  }

  const failureStressMpa = flowStressMpa * (1 - depthRatio);
  return finishEvaluation(input, depthRatio, z, null, flowStressMpa, failureStressMpa, 'ORIGINAL_LONG_RECTANGULAR');
}

export function evaluateModifiedB31g(
  input: B31gEvaluationInput,
  flowStressMode: FfsConfig['modifiedSa'],
): B31gEvaluation {
  const depthRatio = requireEvaluationInput(input);
  const z = input.length ** 2 / (input.outerDiameter * input.wallThickness);
  if (!Number.isFinite(z)) throw new RangeError('normalized defect length must be finite');

  const flowStressMpa = flowStressMode === 'smys11'
    ? 1.1 * input.smysMpa
    : input.smysMpa + ksiToMegapascals(10);
  const foliasFactor = z <= MODIFIED_B31G_Z_CUTOFF
    ? Math.sqrt(1 + 0.6275 * z - 0.003375 * z ** 2)
    : 0.032 * z + 3.3;
  const areaRatio = 0.85 * depthRatio;
  const denominator = 1 - areaRatio / foliasFactor;
  if (!Number.isFinite(foliasFactor) || foliasFactor < 1 || denominator <= 0) {
    throw new RangeError('Modified B31G Folias factor or denominator is outside its safe domain');
  }
  const failureStressMpa = flowStressMpa * (1 - areaRatio) / denominator;
  const branch = z <= MODIFIED_B31G_Z_CUTOFF
    ? 'MODIFIED_SHORT_POLYNOMIAL'
    : 'MODIFIED_LONG_LINEAR';
  return finishEvaluation(input, depthRatio, z, foliasFactor, flowStressMpa, failureStressMpa, branch);
}
