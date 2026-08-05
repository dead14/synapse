/**
 * The single B31G remaining-strength kernel — a Level 1 evaluation.
 *
 * ASME B31G-2023 para. 1.6 recognises four analysis levels. This is Level 1:
 * a calculation from a single maximum depth and axial extent. Level 0 is the
 * table lookup in section 3, Level 2 is the Effective Area Method over a
 * measured corrosion profile, and Level 3 is a user-defined detailed analysis.
 * Neither the ERF term nor any remaining-life method appears in B31G at all;
 * both are operator conventions layered on top of the acceptance criterion in
 * para. 2.2 Step 8, S_F ≥ SF × S_O.
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
 * evaluate features that the code itself would reject (a 75 %WT feature plus
 * ILI tolerance is past the 80 %WT limit) and the caller has to be able to show
 * that rather than crash on it.
 *
 * Public technical basis for the equation forms and branch factors:
 * https://primis.phmsa.dot.gov/rd/FileGet/1934/FinalCorrosionCriteriaReport.pdf
 * This implementation is not a claim of conformance to a licensed ASME edition.
 */

import { ksiToMegapascals } from './units.ts';

/**
 * Original B31G switches to the rectangular area form above this normalised
 * length. ASME B31G-2023 para. 2.2(a) states the branch as z ≤ 20 and z > 20.
 *
 * This used to be 4.479² = 20.0614, taken from the √(L²/Dt) ≤ 4.479 form some
 * secondary sources quote. In the sliver between 20 and 20.0614 that kept the
 * parabolic branch alive where the code has already moved to the rectangular
 * one, overstating the failure stress by about 68 % — non-conservatively.
 */
export const ORIGINAL_B31G_Z_CUTOFF = 20;
/** Modified B31G switches from the polynomial to the linear Folias factor here. */
export const MODIFIED_B31G_Z_CUTOFF = 50;
/**
 * The 80 %WT line.
 *
 * This is *not* an applicability limit of B31G, which is how this constant used
 * to be described. ASME B31G-2023 para. 1.2(f) admits metal loss of any depth,
 * requiring only that due consideration be given to measurement accuracy and to
 * effective corrosion rates once the depth passes 80 % of the actual wall.
 * Where 80 % is a hard limit is section 3(b): the Level 0 tables of allowable
 * length must not be used above it.
 *
 * Synapse keeps 80 % as a *project* rejection threshold, because that is the
 * ordinary operator rule and the one the reference reports apply — but it is an
 * operator decision layered on the code, not a statement the code makes. The
 * threshold itself is configurable through `FfsScreeningConfig.depthRejectionPct`.
 */
export const B31G_DEPTH_LIMIT_RATIO = 0.8;
/** Level 0 tabular screening limit. */
export const B31G_LEVEL0_MAX_DEPTH_RATIO = 0.8;
/** Para. 1.2(f) threshold for enhanced sizing and corrosion-rate review. */
export const B31G_DEEP_METAL_LOSS_REVIEW_RATIO = 0.8;
/** Para. 1.9 normal minimum assessment safety factor. */
export const ASME_MIN_ASSESSMENT_SAFETY_FACTOR = 1.25;
export const SMYS69_MAX_SMYS_MPA = 483;
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
  /**
   * The divisor between the estimated failure pressure and the safe operating
   * pressure: P_S = P_F / SF.
   *
   * ASME B31G-2023 para. 1.9 defines this as the ratio of the minimum
   * hydrostatic test pressure required for the construction type to the MAOP or
   * MOP, usually not less than 1.25 — it is not the B31.8 design factor. The two
   * coincide only when the line operates at exactly its design hoop stress,
   * which is why the Level 0 tables carry a safety factor of 1.39 for a line at
   * 72 % SMYS. The caller resolves which it is; this kernel only divides.
   */
  safetyFactor: number;
  operatingPressureMpa: number;
}

/** The minimum safety factor B31G para. 1.9 recommends. */
export const MINIMUM_RECOMMENDED_SAFETY_FACTOR = 1.25;

/**
 * The safety factor implied by a B31.8 design factor.
 *
 * Historic B31G practice, and the basis of the Level 0 tables: a line designed
 * to F = 0.72 and hydrotested to 100 % SMYS carries SF = 1/0.72 = 1.39. It is
 * only correct while the line actually operates at its design hoop stress.
 */
export function safetyFactorFromDesignFactor(designFactor: number): number {
  return designFactor > 0 ? 1 / designFactor : Number.POSITIVE_INFINITY;
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
  /** True when the feature is deeper than the 80 %WT project rejection line. */
  beyondDepthLimit: boolean;
  deepMetalLossReviewRequired: boolean;
}

export interface FlowStressQualificationInput {
  method: B31gMethod;
  flowStressMode: FlowStressMode;
  smysMpa: number;
  materialClass: 'plain-carbon-low-alloy' | 'other' | 'unknown';
  operatingTemperatureC: number | null;
}

/** Qualification for the requested Modified B31G SMYS + 69 MPa stress basis. */
export function validateFlowStressQualification(input: FlowStressQualificationInput): string[] {
  if (input.method !== 'modified' || input.flowStressMode !== 'smys69') return [];
  const errors: string[] = [];
  if (input.materialClass !== 'plain-carbon-low-alloy') errors.push('SMYS + 69 MPa requires plain carbon or low-alloy steel.');
  if (!(Number.isFinite(input.smysMpa) && input.smysMpa <= SMYS69_MAX_SMYS_MPA)) errors.push(`SMYS + 69 MPa requires SMYS not greater than ${SMYS69_MAX_SMYS_MPA} MPa.`);
  if (input.operatingTemperatureC === null || !Number.isFinite(input.operatingTemperatureC) || input.operatingTemperatureC >= SMYS69_MAX_OPERATING_TEMPERATURE_C) errors.push(`SMYS + 69 MPa requires operating temperature below ${SMYS69_MAX_OPERATING_TEMPERATURE_C} C.`);
  return errors;
}

/** Legacy helper retained for audit UI wording; B31G evaluates with explicit safetyFactor. */
export function assessmentSafetyFactor(designFactor: number): number {
  return safetyFactorFromDesignFactor(designFactor);
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

/** Folias bulging factor for the branch the normalised length falls in. */
export function foliasFactor(z: number, method: B31gMethod): number | null {
  if (method === 'original') {
    return z <= ORIGINAL_B31G_Z_CUTOFF ? Math.sqrt(1 + 0.8 * z) : null;
  }
  if (z <= MODIFIED_B31G_Z_CUTOFF) {
    return Math.sqrt(Math.max(1, 1 + 0.6275 * z - 0.003375 * z * z));
  }
  return 0.032 * z + 3.3;
}

/** The metal-loss area shape factor: 2/3 parabolic for Original, 0.85 for Modified. */
export function areaShapeFactor(method: B31gMethod, z: number): number {
  if (method === 'original') return z <= ORIGINAL_B31G_Z_CUTOFF ? 2 / 3 : 1;
  return 0.85;
}

function branchOf(method: B31gMethod, z: number): B31gBranch {
  if (method === 'original') {
    return z <= ORIGINAL_B31G_Z_CUTOFF ? 'ORIGINAL_SHORT_PARABOLIC' : 'ORIGINAL_LONG_RECTANGULAR';
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
  deepMetalLossReviewRequired = depthRatio > B31G_DEEP_METAL_LOSS_REVIEW_RATIO,
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
  const { wallThickness, outerDiameter, smysMpa, safetyFactor, operatingPressureMpa } = geometry;
  const flow = flowStress(smysMpa, method, flowStressMode);
  const hoop = hoopStress(operatingPressureMpa, outerDiameter, wallThickness);
  const depthRatio = depthMm / wallThickness;
  const beyondDepthLimit = depthRatio > B31G_DEPTH_LIMIT_RATIO;
  const deepMetalLossReviewRequired = depthRatio > B31G_DEEP_METAL_LOSS_REVIEW_RATIO;

  const geometryFinite = [wallThickness, outerDiameter, smysMpa, safetyFactor, operatingPressureMpa, depthMm, lengthMm]
    .every((value) => Number.isFinite(value));
  if (!geometryFinite || wallThickness <= 0 || outerDiameter <= 0 || lengthMm <= 0 || safetyFactor <= 0) {
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
 * The greatest depth, as a fraction of wall, that still keeps the safe pressure
 * at the required pressure for a given anomaly length — the acceptance envelope
 * of the Level 1 criterion, solved in closed form rather than searched.
 *
 * This is the same boundary the section 3 tables tabulate, but computed from the
 * Level 1 equations at the line's own safety factor rather than read off the
 * published tables, which are fixed at their own basis.
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
  const { wallThickness, outerDiameter, smysMpa, safetyFactor, operatingPressureMpa } = geometry;
  if (!(wallThickness > 0) || !(outerDiameter > 0) || !(safetyFactor > 0)) return null;

  const flow = flowStress(smysMpa, method, flowStressMode);
  // Target failure stress: the value at which the safe pressure equals P₀.
  const target = hoopStress(operatingPressureMpa, outerDiameter, wallThickness) * safetyFactor;
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
