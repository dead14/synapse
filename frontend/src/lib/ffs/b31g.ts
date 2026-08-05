/**
 * The single B31G remaining-strength kernel.
 *
 * The same equations used to live in three places — `calcEngine` for the nominal
 * result, `screening.evaluateTier` for the tolerance and forecast tiers, and
 * `remainingStrength` for the strict public API — each with its own flow-stress
 * constant, its own branch cutoff, and its own idea of what to return when the
 * remaining-strength term collapses. They are one function now; the strict API
 * and the screening tiers are thin wrappers over it.
 *
 * This kernel never throws. Out-of-domain geometry comes back as a result with
 * `valid: false` and an infinite ERF, because the screening tiers deliberately
 * evaluate conservative and forecast dimensions that may require enhanced
 * deep-metal-loss review, and the caller has to be able to show that state.
 *
 * Public technical basis for the equation forms and branch factors:
 * https://primis.phmsa.dot.gov/rd/FileGet/1934/FinalCorrosionCriteriaReport.pdf
 * This implementation is not a claim of conformance to a licensed ASME edition.
 */

import { ksiToMegapascals } from './units.ts';

/** Original B31G switches to the rectangular area form above z = 20. */
export const ORIGINAL_B31G_Z_CUTOFF = 20;
export const ORIGINAL_B31G_NORMALIZED_LENGTH_CUTOFF = Math.sqrt(ORIGINAL_B31G_Z_CUTOFF);
/** Modified B31G switches from the polynomial to the linear Folias factor here. */
export const MODIFIED_B31G_Z_CUTOFF = 50;
/** Level 0 tabular screening is limited to 80% WT. */
export const B31G_LEVEL0_MAX_DEPTH_RATIO = 0.8;
/** Para. 1.2(f) threshold for enhanced sizing and corrosion-rate review. */
export const B31G_DEEP_METAL_LOSS_REVIEW_RATIO = 0.8;
/** Level 1 equation geometry collapses only at full-wall penetration. */
export const B31G_DEPTH_LIMIT_RATIO = 1;
/** Para. 1.9 normally expects an assessment safety factor not below 1.25. */
export const ASME_MIN_ASSESSMENT_SAFETY_FACTOR = 1.25;
/** Upper SMYS qualification for the SMYS + 69 MPa flow-stress option. */
export const SMYS69_MAX_SMYS_MPA = 483;
/** Upper operating-temperature qualification used by this implementation. */
export const SMYS69_MAX_OPERATING_TEMPERATURE_C = 120;
/** The Modified B31G flow-stress uplift, defined in the source as SMYS + 10 ksi. */
export const MODIFIED_FLOW_STRESS_UPLIFT_MPA = ksiToMegapascals(10);

export type B31gMethod = 'original' | 'modified';
export type FlowStressMode = 'smys69' | 'smys11';

export type B31gBranch =
  | 'ORIGINAL_SHORT_PARABOLIC'
  | 'ORIGINAL_LONG_RECTANGULAR'
  | 'MODIFIED_SHORT_POLYNOMIAL'
  | 'MODIFIED_LONG_LINEAR';

export interface B31gGeometry {
  wallThickness: number;
  outerDiameter: number;
  smysMpa: number;
  /** Legacy row field holding 1 / assessment safety factor. */
  designFactor: number;
  operatingPressureMpa: number;
}

export interface B31gKernelResult {
  branch: B31gBranch;
  depthRatio: number;
  depthPct: number;
  z: number;
  foliasFactor: number | null;
  flowStressMpa: number;
  failureStressMpa: number;
  failurePressureMpa: number;
  safePressureMpa: number;
  operatingHoopStressMpa: number;
  /** Infinity when no remaining strength is left — never a large sentinel. */
  erf: number;
  /** False when the geometry falls outside the domain the equations describe. */
  valid: boolean;
  /** Why `valid` is false, for display next to the number. */
  invalidReason: string | null;
  /** True only at full-wall penetration, where the Level 1 equation collapses. */
  beyondDepthLimit: boolean;
  /** True above 80% WT; the equation remains valid but enhanced review is mandatory. */
  deepMetalLossReviewRequired: boolean;
}

export interface FlowStressQualificationInput {
  method: B31gMethod;
  flowStressMode: FlowStressMode;
  smysMpa: number;
  materialClass: 'plain-carbon-low-alloy' | 'other' | 'unknown';
  operatingTemperatureC: number | null;
}

/** ASME B31G para. 1.7(b) qualification checks requested for SMYS + 69 MPa. */
export function validateFlowStressQualification(input: FlowStressQualificationInput): string[] {
  if (input.method !== 'modified' || input.flowStressMode !== 'smys69') return [];
  const errors: string[] = [];
  if (input.materialClass !== 'plain-carbon-low-alloy') {
    errors.push('SMYS + 69 MPa requires plain carbon or low-alloy steel.');
  }
  if (!(Number.isFinite(input.smysMpa) && input.smysMpa <= SMYS69_MAX_SMYS_MPA)) {
    errors.push(`SMYS + 69 MPa requires SMYS not greater than ${SMYS69_MAX_SMYS_MPA} MPa.`);
  }
  if (
    input.operatingTemperatureC === null ||
    !Number.isFinite(input.operatingTemperatureC) ||
    input.operatingTemperatureC >= SMYS69_MAX_OPERATING_TEMPERATURE_C
  ) {
    errors.push(`SMYS + 69 MPa requires operating temperature below ${SMYS69_MAX_OPERATING_TEMPERATURE_C} C.`);
  }
  return errors;
}

export function assessmentSafetyFactor(designFactor: number): number {
  return 1 / designFactor;
}

/** Hoop stress at the operating pressure — Barlow, on the outside diameter. */
export function hoopStress(operatingPressureMpa: number, outerDiameter: number, wallThickness: number): number {
  return (operatingPressureMpa * outerDiameter) / (2 * wallThickness);
}

/** Flow stress for the selected method and, for Modified B31G, its stress basis. */
export function flowStress(smysMpa: number, method: B31gMethod, mode: FlowStressMode): number {
  if (method === 'original') return 1.1 * smysMpa;
  return mode === 'smys11' ? 1.1 * smysMpa : smysMpa + MODIFIED_FLOW_STRESS_UPLIFT_MPA;
}

/** Normalised defect length z = L² / (D·t). */
export function normalizedLength(lengthMm: number, outerDiameter: number, wallThickness: number): number {
  return (lengthMm * lengthMm) / (outerDiameter * wallThickness);
}

function originalShortBranch(z: number): boolean {
  const tolerance = Number.EPSILON * Math.max(1, Math.abs(z), ORIGINAL_B31G_Z_CUTOFF) * 8;
  return z <= ORIGINAL_B31G_Z_CUTOFF + tolerance;
}

/** Folias bulging factor for the branch the normalised length falls in. */
export function foliasFactor(z: number, method: B31gMethod): number | null {
  if (method === 'original') {
    return originalShortBranch(z) ? Math.sqrt(1 + 0.8 * z) : null;
  }
  if (z <= MODIFIED_B31G_Z_CUTOFF) {
    return Math.sqrt(Math.max(1, 1 + 0.6275 * z - 0.003375 * z * z));
  }
  return 0.032 * z + 3.3;
}

/** The metal-loss area shape factor: 2/3 parabolic for Original, 0.85 for Modified. */
export function areaShapeFactor(method: B31gMethod, z: number): number {
  if (method === 'original') return originalShortBranch(z) ? 2 / 3 : 1;
  return 0.85;
}

function branchOf(method: B31gMethod, z: number): B31gBranch {
  if (method === 'original') {
    return originalShortBranch(z) ? 'ORIGINAL_SHORT_PARABOLIC' : 'ORIGINAL_LONG_RECTANGULAR';
  }
  return z <= MODIFIED_B31G_Z_CUTOFF ? 'MODIFIED_SHORT_POLYNOMIAL' : 'MODIFIED_LONG_LINEAR';
}

function collapsed(
  branch: B31gBranch,
  depthRatio: number,
  z: number,
  folias: number | null,
  flow: number,
  hoop: number,
  reason: string,
  beyondDepthLimit: boolean,
  deepMetalLossReviewRequired: boolean,
): B31gKernelResult {
  return {
    branch,
    depthRatio,
    depthPct: depthRatio * 100,
    z,
    foliasFactor: folias,
    flowStressMpa: flow,
    failureStressMpa: 0,
    failurePressureMpa: 0,
    safePressureMpa: 0,
    operatingHoopStressMpa: hoop,
    erf: Number.POSITIVE_INFINITY,
    valid: false,
    invalidReason: reason,
    beyondDepthLimit,
    deepMetalLossReviewRequired,
  };
}

/**
 * Evaluates B31G for one depth/length pair against the given line geometry.
 *
 * `depthMm` and `lengthMm` are the dimensions to assess — the caller decides
 * whether those are as-reported, tolerance-adjusted, or grown forward in time.
 */
export function evaluateB31g(
  depthMm: number,
  lengthMm: number,
  geometry: B31gGeometry,
  method: B31gMethod,
  flowStressMode: FlowStressMode = 'smys69',
): B31gKernelResult {
  const { wallThickness, outerDiameter, smysMpa, designFactor, operatingPressureMpa } = geometry;
  const flow = flowStress(smysMpa, method, flowStressMode);
  const hoop = hoopStress(operatingPressureMpa, outerDiameter, wallThickness);
  const depthRatio = depthMm / wallThickness;
  const beyondDepthLimit = depthRatio >= B31G_DEPTH_LIMIT_RATIO;
  const deepMetalLossReviewRequired = depthRatio > B31G_DEEP_METAL_LOSS_REVIEW_RATIO;

  const geometryFinite = [wallThickness, outerDiameter, smysMpa, designFactor, operatingPressureMpa, depthMm, lengthMm]
    .every((value) => Number.isFinite(value));
  if (!geometryFinite || wallThickness <= 0 || outerDiameter <= 0 || lengthMm <= 0) {
    return collapsed('MODIFIED_SHORT_POLYNOMIAL', depthRatio, 0, null, flow, hoop, 'Geometry is missing or not usable', beyondDepthLimit, deepMetalLossReviewRequired);
  }

  const z = normalizedLength(lengthMm, outerDiameter, wallThickness);
  const branch = branchOf(method, z);
  const folias = foliasFactor(z, method);

  if (depthRatio >= 1) {
    return collapsed(branch, depthRatio, z, folias, flow, hoop, 'Metal loss reaches the full wall thickness', true, true);
  }

  const shape = areaShapeFactor(method, z);
  const areaRatio = shape * depthRatio;
  // The rectangular Original branch has no Folias term; the others divide by it.
  const denominator = folias === null ? 1 : 1 - areaRatio / folias;
  const numerator = 1 - areaRatio;

  if (!Number.isFinite(denominator) || denominator <= 0 || numerator <= 0) {
    return collapsed(branch, depthRatio, z, folias, flow, hoop, 'No remaining strength at this depth and length', beyondDepthLimit, deepMetalLossReviewRequired);
  }

  const failureStressMpa = (flow * numerator) / denominator;
  const failurePressureMpa = (2 * failureStressMpa * wallThickness) / outerDiameter;
  const safetyFactor = assessmentSafetyFactor(designFactor);
  const safePressureMpa = failurePressureMpa / safetyFactor;
  const erf = safePressureMpa > 0 ? operatingPressureMpa / safePressureMpa : Number.POSITIVE_INFINITY;

  if (![failureStressMpa, failurePressureMpa, safePressureMpa, erf].every(Number.isFinite) || safePressureMpa <= 0) {
    return collapsed(branch, depthRatio, z, folias, flow, hoop, 'The calculation produced a non-finite result', beyondDepthLimit, deepMetalLossReviewRequired);
  }

  return {
    branch,
    depthRatio,
    depthPct: depthRatio * 100,
    z,
    foliasFactor: folias,
    flowStressMpa: flow,
    failureStressMpa,
    failurePressureMpa,
    safePressureMpa,
    operatingHoopStressMpa: hoop,
    erf,
    valid: true,
    invalidReason: null,
    beyondDepthLimit,
    deepMetalLossReviewRequired,
  };
}

/**
 * The greatest depth, as a fraction of wall, that still keeps ERF at 1.0 for a
 * given anomaly length — the B31G Level 0 acceptance envelope, solved in closed
 * form rather than searched.
 *
 * Returns null when no depth on the curve satisfies the equation, which happens
 * when the operating stress already exceeds the flow stress of sound pipe.
 */
export function acceptableDepthRatio(
  lengthMm: number,
  geometry: B31gGeometry,
  method: B31gMethod,
  flowStressMode: FlowStressMode = 'smys69',
): number | null {
  const { wallThickness, outerDiameter, smysMpa, designFactor, operatingPressureMpa } = geometry;
  if (!(wallThickness > 0) || !(outerDiameter > 0) || !(designFactor > 0)) return null;

  const flow = flowStress(smysMpa, method, flowStressMode);
  // Target failure stress: the value at which the safe pressure equals P₀.
  const target = hoopStress(operatingPressureMpa, outerDiameter, wallThickness) * assessmentSafetyFactor(designFactor);
  const z = normalizedLength(lengthMm, outerDiameter, wallThickness);
  const folias = foliasFactor(z, method);
  const shape = areaShapeFactor(method, z);

  // Rectangular branch: Sf = flow · (1 − d/t), so d/t follows directly.
  if (folias === null) {
    const ratio = 1 - target / flow;
    return Number.isFinite(ratio) ? ratio : null;
  }

  // flow(1 − k·dt) = target(1 − k·dt/M)  ⇒  dt = (flow − target) / (k(flow − target/M))
  const denominator = shape * (flow - target / folias);
  if (denominator === 0 || !Number.isFinite(denominator)) return null;
  const ratio = (flow - target) / denominator;
  return Number.isFinite(ratio) ? ratio : null;
}
