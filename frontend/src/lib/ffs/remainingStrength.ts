import type { FfsConfig } from './types';
import {
  B31G_DEPTH_LIMIT_RATIO,
  MODIFIED_B31G_Z_CUTOFF,
  ORIGINAL_B31G_NORMALIZED_LENGTH_CUTOFF,
  ORIGINAL_B31G_Z_CUTOFF,
  evaluateB31g,
  type B31gBranch,
} from './b31g.ts';

export {
  B31G_DEPTH_LIMIT_RATIO,
  MODIFIED_B31G_Z_CUTOFF,
  ORIGINAL_B31G_NORMALIZED_LENGTH_CUTOFF,
  ORIGINAL_B31G_Z_CUTOFF,
};
export type { B31gBranch };

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

/**
 * The strict entry point. Where the kernel degrades gracefully so the screening
 * tiers can show an out-of-domain feature, this wrapper refuses the input: it is
 * the API used where a number must either be defensible or not exist.
 */
function requireEvaluationInput(input: B31gEvaluationInput): void {
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
  if (!Number.isFinite(depthRatio) || depthRatio >= B31G_DEPTH_LIMIT_RATIO) {
    throw new RangeError('depth must remain below full-wall penetration');
  }
}

function strictEvaluate(
  input: B31gEvaluationInput,
  method: 'original' | 'modified',
  flowStressMode: FfsConfig['modifiedSa'],
): B31gEvaluation {
  requireEvaluationInput(input);
  const result = evaluateB31g(input.depth, input.length, {
    wallThickness: input.wallThickness,
    outerDiameter: input.outerDiameter,
    smysMpa: input.smysMpa,
    designFactor: input.designFactor,
    operatingPressureMpa: input.operatingPressureMpa,
  }, method, flowStressMode);

  if (!result.valid) {
    throw new RangeError(result.invalidReason ?? 'B31G calculation produced a non-finite or non-positive result');
  }

  return {
    branch: result.branch,
    depthRatio: result.depthRatio,
    z: result.z,
    foliasFactor: result.foliasFactor,
    flowStressMpa: result.flowStressMpa,
    failureStressMpa: result.failureStressMpa,
    failurePressureMpa: result.failurePressureMpa,
    safePressureMpa: result.safePressureMpa,
    operatingHoopStressMpa: result.operatingHoopStressMpa,
    erf: result.erf,
  };
}

export function evaluateOriginalB31g(input: B31gEvaluationInput): B31gEvaluation {
  return strictEvaluate(input, 'original', 'smys11');
}

export function evaluateModifiedB31g(
  input: B31gEvaluationInput,
  flowStressMode: FfsConfig['modifiedSa'],
): B31gEvaluation {
  return strictEvaluate(input, 'modified', flowStressMode);
}
