/**
 * ASME B31.4-2025 — the liquid-pipeline rules that sit around the B31G result.
 *
 * B31G answers one question: what pressure a corroded length of pipe can still
 * hold. B31.4 is the code the line is actually operated under, and it decides
 * what has to be done about that answer. Chapter VII para. 451.6.2.2 is the
 * whole of it for corrosion, and none of it was in this workspace:
 *
 *   (a) metal loss deeper than 80 % of the wall **shall** be removed or repaired.
 *       Synapse had this line as a configurable project threshold, which is what
 *       it is under B31G — under B31.4 it is a code requirement, and an operator
 *       screening at 70 %WT is being stricter than the code, never more lenient.
 *
 *   (b) an area with a maximum depth of 20 % or less **of the thickness required
 *       for design** need not be repaired. Note the denominator: t, the pressure
 *       design thickness of para. 403.2.1, not the nominal wall. On a line whose
 *       nominal wall carries a corrosion allowance the two are far apart, and
 *       reading 20 % of nominal in place of 20 % of t is non-conservative.
 *       Between 20 % and 80 % the area may remain in the line only while a safe
 *       operating pressure is established — which is the B31G calculation — and
 *       if that safe pressure is below the maximum operating pressure, the area
 *       is removed or repaired or the MOP is reduced to it.
 *
 *   (d) two areas of metal loss interact by a rule of this Code, not by the 3t
 *       rule of B31G para. 1.12: circumferentially at 6 times the design
 *       thickness (Type I), axially at 1 in. / 25.4 mm (Type II).
 *
 * The Y/T clause of (b) is here too: above a yield-to-tensile ratio of 0.93 — and
 * for unusual axial loads, lateral movement, or settlement — the Code requires an
 * engineering analysis rather than a B31G screen, so the assessment has to say so
 * instead of printing a safe pressure as though the screen applied.
 *
 * Every figure below is stated in the Code's own terms. Where B31.4 and B31G
 * disagree, both are reported: the calculation stays B31G, the disposition is
 * B31.4, and the report shows which rule produced which line.
 */

/** ASME B31.4-2025 Table 403.2.1-1 — weld joint factor E, by manufacture. */
export const B314_WELD_JOINT_FACTORS = {
  seamless: 1.0,
  'electric-resistance-welded': 1.0,
  'electric-flash-welded': 1.0,
  'electric-fusion-welded': 0.8,
  'furnace-butt-welded': 0.6,
} as const;

export type B314WeldJointType = keyof typeof B314_WELD_JOINT_FACTORS;

/** The value assumed where the pipe dossier does not name a manufacture. */
export const DEFAULT_WELD_JOINT_FACTOR = B314_WELD_JOINT_FACTORS.seamless;

/** Para. 403.2.1: the design factor may not exceed this. */
export const B314_MAX_DESIGN_FACTOR = 0.72;

/** Para. 451.6.2.2(a): deeper than this fraction of wall, removal or repair. */
export const B314_MANDATORY_REPAIR_DEPTH_RATIO = 0.8;

/**
 * Para. 451.6.2.2(b): at or below this fraction of the *design* thickness, no
 * repair is required — measures against further corrosion still are.
 */
export const B314_NO_REPAIR_DEPTH_RATIO_OF_DESIGN_THICKNESS = 0.2;

/** Para. 451.6.2.2(b): above this Y/T ratio an engineering analysis is required. */
export const B314_YIELD_TO_TENSILE_ANALYSIS_THRESHOLD = 0.93;

/** Para. 451.6.2.2(d) Type I: circumferential separation, as a multiple of t. */
export const B314_TYPE_I_CIRCUMFERENTIAL_SEPARATION_FACTOR = 6;

/** Para. 451.6.2.2(d) Type II: axial separation of 1 in. */
export const B314_TYPE_II_AXIAL_SEPARATION_MM = 25.4;

export interface B314DesignInput {
  /** Internal design gauge pressure, MPa. */
  internalDesignPressureMpa: number;
  /** Outside diameter, mm. */
  outerDiameterMm: number;
  /** Specified minimum yield strength, MPa. */
  smysMpa: number;
  /** Design factor F, not greater than 0.72. */
  designFactor: number;
  /** Weld joint factor E from Table 403.2.1-1. Defaults to 1.0. */
  weldJointFactor?: number;
}

/**
 * Para. 403.2.1: S = F × E × S_y, the allowable stress value.
 *
 * Returns null rather than a number when the inputs cannot establish one — this
 * feeds a Code disposition, and a guessed allowable stress would silently move
 * the line between "no repair required" and "repair or reduce the MOP".
 */
export function b314AllowableStressMpa(input: B314DesignInput): number | null {
  const { smysMpa, designFactor } = input;
  const weldJointFactor = input.weldJointFactor ?? DEFAULT_WELD_JOINT_FACTOR;
  if (!(smysMpa > 0) || !(designFactor > 0) || !(weldJointFactor > 0)) return null;
  if (!Number.isFinite(smysMpa) || !Number.isFinite(designFactor) || !Number.isFinite(weldJointFactor)) return null;
  return designFactor * weldJointFactor * smysMpa;
}

/**
 * Para. 403.2.1: t = P_i D / (2S), the pressure design wall thickness.
 *
 * This is the thickness the 20 % no-repair band of para. 451.6.2.2(b) is a
 * fraction of. It excludes the allowance A — threading, grooving, corrosion and
 * erosion allowances are additions to t, not part of it, and including them here
 * would widen the no-repair band past what the Code allows.
 */
export function b314DesignThicknessMm(input: B314DesignInput): number | null {
  const stress = b314AllowableStressMpa(input);
  if (stress === null) return null;
  const { internalDesignPressureMpa, outerDiameterMm } = input;
  if (!(internalDesignPressureMpa > 0) || !(outerDiameterMm > 0)) return null;
  const thickness = (internalDesignPressureMpa * outerDiameterMm) / (2 * stress);
  return Number.isFinite(thickness) && thickness > 0 ? thickness : null;
}

/** What para. 451.6.2.2 requires be done about one area of metal loss. */
export type B314Disposition =
  /** (a) Deeper than 80 % of wall: removal or repair, no calculation admits it. */
  | 'remove-or-repair'
  /** (b) 20 % or less of the design thickness: no repair required. */
  | 'no-repair-required'
  /** (b) Safe operating pressure established and at or above the MOP. */
  | 'safe-pressure-established'
  /** (b) Safe operating pressure below the MOP: repair, replace, or reduce the MOP. */
  | 'repair-replace-or-reduce-mop'
  /** (b) Y/T above 0.93 or unusual loading: an engineering analysis is required. */
  | 'engineering-analysis-required'
  /** Inputs do not establish a disposition — never a silent pass. */
  | 'undetermined';

export interface B314DispositionInput {
  /** Maximum depth of the area, as a fraction of the nominal wall. */
  depthRatioOfWall: number;
  /** Nominal wall thickness, mm. */
  wallThicknessMm: number;
  /** Pressure design thickness t from para. 403.2.1, or null when unknown. */
  designThicknessMm: number | null;
  /** Safe operating pressure from the remaining-strength calculation, MPa. */
  safeOperatingPressureMpa: number;
  /** Maximum operating pressure the area must hold, MPa. */
  maximumOperatingPressureMpa: number;
  /**
   * Yield-to-tensile ratio, where the dossier gives one. Above 0.93 the Code
   * requires an engineering analysis instead of the generally acceptable methods.
   */
  yieldToTensileRatio?: number | null;
  /**
   * True where the line is subject to unusual axial loads, lateral movement, or
   * settlement — the other trigger for an engineering analysis in para.
   * 451.6.2.2(b).
   */
  unusualLoading?: boolean;
}

export interface B314DispositionResult {
  disposition: B314Disposition;
  /** The Code paragraph the disposition comes from. */
  reference: string;
  /** One sentence, in the Code's terms, for the report column. */
  statement: string;
  /** The depth as a fraction of the design thickness, where t is known. */
  depthRatioOfDesignThickness: number | null;
  /** True when the area may stay in the line as it is. */
  acceptableAsIs: boolean;
}

/**
 * The para. 451.6.2.2 disposition for one area of metal loss.
 *
 * The order is the Code's own. The 80 % line is absolute and comes first: it is
 * not traded against a safe pressure, and a deep feature that happens to compute
 * an acceptable ERF is still removed or repaired. The engineering-analysis
 * triggers come next, because where they apply the generally acceptable methods
 * — B31G, modified B31G, an effective area method — are not the ones the Code
 * accepts, so their result must not be presented as the disposition.
 */
export function b314Disposition(input: B314DispositionInput): B314DispositionResult {
  const {
    depthRatioOfWall, wallThicknessMm, designThicknessMm,
    safeOperatingPressureMpa, maximumOperatingPressureMpa,
  } = input;

  const depthMm = depthRatioOfWall * wallThicknessMm;
  const depthRatioOfDesignThickness = designThicknessMm !== null && designThicknessMm > 0
    ? depthMm / designThicknessMm
    : null;

  const base = { depthRatioOfDesignThickness };

  if (!Number.isFinite(depthRatioOfWall) || !(wallThicknessMm > 0)) {
    return {
      ...base,
      disposition: 'undetermined',
      reference: 'ASME B31.4-2025 para. 451.6.2.2',
      statement: 'The measured depth and wall thickness do not establish a Code disposition.',
      acceptableAsIs: false,
    };
  }

  if (depthRatioOfWall > B314_MANDATORY_REPAIR_DEPTH_RATIO) {
    return {
      ...base,
      disposition: 'remove-or-repair',
      reference: 'ASME B31.4-2025 para. 451.6.2.2(a)',
      statement: 'Maximum depth exceeds 80% of the wall thickness: the area shall be removed or repaired.',
      acceptableAsIs: false,
    };
  }

  const yieldToTensile = input.yieldToTensileRatio ?? null;
  const yieldToTensileExceeded = yieldToTensile !== null
    && Number.isFinite(yieldToTensile)
    && yieldToTensile > B314_YIELD_TO_TENSILE_ANALYSIS_THRESHOLD;
  if (yieldToTensileExceeded || input.unusualLoading === true) {
    return {
      ...base,
      disposition: 'engineering-analysis-required',
      reference: 'ASME B31.4-2025 para. 451.6.2.2(b)',
      statement: yieldToTensileExceeded
        ? 'Yield-to-tensile ratio exceeds 0.93: an engineering analysis shall establish the safe operating '
          + 'pressure, and the B31G screen is not the Code disposition for this area.'
        : 'The line is subject to unusual axial loads, lateral movement, or settlement: an engineering '
          + 'analysis shall establish the safe operating pressure.',
      acceptableAsIs: false,
    };
  }

  if (depthRatioOfDesignThickness !== null
    && depthRatioOfDesignThickness <= B314_NO_REPAIR_DEPTH_RATIO_OF_DESIGN_THICKNESS) {
    return {
      ...base,
      disposition: 'no-repair-required',
      reference: 'ASME B31.4-2025 para. 451.6.2.2(b)',
      statement: 'Maximum depth is 20% or less of the thickness required for design: no repair is required, '
        + 'but measures should be taken to prevent further corrosion.',
      acceptableAsIs: true,
    };
  }

  if (!(safeOperatingPressureMpa > 0) || !(maximumOperatingPressureMpa > 0)) {
    return {
      ...base,
      disposition: 'undetermined',
      reference: 'ASME B31.4-2025 para. 451.6.2.2(b)',
      statement: 'No safe operating pressure was established for this area, so it may not remain in the '
        + 'pipeline unrepaired.',
      acceptableAsIs: false,
    };
  }

  if (safeOperatingPressureMpa < maximumOperatingPressureMpa) {
    return {
      ...base,
      disposition: 'repair-replace-or-reduce-mop',
      reference: 'ASME B31.4-2025 para. 451.6.2.2(b)',
      statement: 'The safe operating pressure is below the maximum operating pressure: the area shall be '
        + 'removed or repaired, or the maximum operating pressure reduced to the safe operating pressure '
        + 'or less.',
      acceptableAsIs: false,
    };
  }

  return {
    ...base,
    disposition: 'safe-pressure-established',
    reference: 'ASME B31.4-2025 para. 451.6.2.2(b)',
    statement: 'A safe operating pressure at or above the maximum operating pressure is established, so the '
      + 'area is permitted to remain in the pipeline unrepaired.',
    acceptableAsIs: true,
  };
}

export interface B314InteractionInput {
  /** Axial edge-to-edge separation L₃, mm. Negative where the boxes overlap. */
  axialSeparationMm: number;
  /** Circumferential edge-to-edge separation C, mm. Null when it is unknown. */
  circumferentialSeparationMm: number | null;
  /** Pressure design thickness t, mm. Null falls back to the nominal wall. */
  designThicknessMm: number | null;
  /** Nominal wall thickness, mm — the fallback denominator for the 6t rule. */
  wallThicknessMm: number;
  /** Axial extent of each area, mm, for the combined length of a Type II pair. */
  lengthAMm: number;
  lengthBMm: number;
}

export interface B314InteractionResult {
  /**
   * Type I, para. 451.6.2.2(d)(1): the circumferential separation is inside 6t,
   * so the composite area and the overall length govern. Null when the
   * circumferential separation could not be measured — never assumed separate.
   */
  typeIInteracting: boolean | null;
  /**
   * Type II, para. 451.6.2.2(d)(2): the axial separation is under 1 in., so the
   * two areas are assessed as one of length L₁ + L₂ + L₃.
   */
  typeIIInteracting: boolean;
  /** The 6t threshold this pair was measured against, mm. */
  circumferentialThresholdMm: number;
  /** L₁ + L₂ + L₃ for a Type II pair, or null when they are separate. */
  combinedLengthMm: number | null;
  /** True when both rules leave the two areas to be evaluated separately. */
  assessSeparately: boolean;
  reference: string;
}

/**
 * Para. 451.6.2.2(d) interaction, for a liquid pipeline under B31.4.
 *
 * Deliberately not the 3t rule of B31G para. 1.12. B31.4 fixes the axial trigger
 * at one inch regardless of wall, and puts the circumferential trigger at six
 * times the *design* thickness — so on a heavy-walled line the Code screen is
 * wider circumferentially and much narrower axially than the B31G one. Reporting
 * only the B31G screen against a B31.4 line left both errors in the same table.
 *
 * A missing circumferential separation returns null rather than false: two areas
 * whose clock positions were not reported are not thereby separate.
 */
export function b314Interaction(input: B314InteractionInput): B314InteractionResult {
  const denominator = input.designThicknessMm !== null && input.designThicknessMm > 0
    ? input.designThicknessMm
    : input.wallThicknessMm;
  const circumferentialThresholdMm = B314_TYPE_I_CIRCUMFERENTIAL_SEPARATION_FACTOR * denominator;

  const typeIInteracting = input.circumferentialSeparationMm === null
    ? null
    : input.circumferentialSeparationMm < circumferentialThresholdMm;
  const typeIIInteracting = input.axialSeparationMm < B314_TYPE_II_AXIAL_SEPARATION_MM;

  return {
    typeIInteracting,
    typeIIInteracting,
    circumferentialThresholdMm,
    // L = L₁ + L₂ + L₃. A negative separation means the boxes already overlap,
    // and adding it back would shorten the flaw below its own extent.
    combinedLengthMm: typeIIInteracting
      ? input.lengthAMm + input.lengthBMm + Math.max(0, input.axialSeparationMm)
      : null,
    assessSeparately: !typeIIInteracting && typeIInteracting === false,
    reference: 'ASME B31.4-2025 para. 451.6.2.2(d)',
  };
}
