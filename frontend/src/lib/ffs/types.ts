// Type-only, so the cycle with remnantLife.ts (which needs FfsLifeStatus) is
// erased at compile time rather than becoming a runtime import cycle.
import type { FfsRemnantLife, FfsServiceLifeInputs } from './remnantLife.ts';

export type { FfsRemnantLife, FfsRemnantLifeBasis, FfsRemnantLimit, FfsServiceLifeInputs } from './remnantLife.ts';

export interface FfsConfig {
  lineName: string;
  method: 'original' | 'modified';
  modifiedSa: 'smys69' | 'smys11';
  iliDate: Date;
  highlightYears: number;
  /** Bounded projection window; this is not a claim about pipeline service life. */
  analysisHorizonYears?: number;
  /** Units selected by the engineer; B31G values are normalized to MPa and mm. */
  inputUnits?: { pressure: 'MPa' | 'bar' | 'psi'; diameter: 'mm' | 'in' };
  /** What the pressure supplied to the ERF comparison represents. */
  pressureBasis?: FfsPressureBasis;
  /** Design-dossier figures used by the residual life assessment. */
  serviceLife?: FfsServiceLifeInputs;
  /**
   * The depth this project rejects at, as % of wall. Defaults to 80 %WT.
   *
   * Mirrors `FfsScreeningConfig.depthRejectionPct`, and exists so the nominal
   * acceptance column and the remnant-life limit answer to the same line. It is
   * an operator threshold, not a limit of B31G: para. 1.2(f) admits metal loss
   * of any depth given justified sizing accuracy. See `B31G_DEPTH_LIMIT_RATIO`.
   */
  depthRejectionPct?: number;
}

export type FfsPressureBasis = 'maop' | 'mop' | 'current-operating' | 'other-required';

export type FfsGrowthObservation =
  | 'matched-measured'
  | 'new-only-zero-baseline-estimate'
  | 'apparent-decrease'
  | 'manual-reported'
  | 'unavailable';

export type FfsGrowthAnalysisBasis = 'reported' | 'estimated' | 'explicit-fallback' | 'none';

export interface FfsGrowthComponentEvidence {
  /** What the source data actually says; never overwritten by an analysis fallback. */
  observation: FfsGrowthObservation;
  /** What rate, if any, the projection engine consumes. */
  analysisBasis: FfsGrowthAnalysisBasis;
  rawRateMmPerYear: number | null;
  analysisRateMmPerYear: number | null;
  formula: string | null;
  note: string;
}

export interface FfsGrowthEvidence {
  oldSurveyYear: number | null;
  newSurveyYear: number | null;
  intervalYears: number | null;
  depth: FfsGrowthComponentEvidence;
  length: FfsGrowthComponentEvidence;
}

export type FfsLifeStatus =
  | 'calculated'
  | 'not-reached-within-horizon'
  | 'insufficient-growth-basis';

/**
 * One design factor and the stretch of line it applies to.
 *
 * A single line routinely carries more than one: buried line pipe at 0.72 and a
 * river crossing or riser at 0.60 is the ordinary case, not the exception, and
 * assessing the crossing at the line-pipe factor overstates its safe pressure.
 * Sections come from the alignment sectioning that has already been reviewed,
 * so the engineer assigns a factor to a stretch they have already named rather
 * than typing distances again.
 */
export interface FfsSectionDesignFactor {
  /** Section name exactly as the alignment sectioning emitted it. */
  section: string;
  designFactor: number;
}

/**
 * Which rule produced the design factor a feature was assessed with.
 * `row-supplied` is the manual workbook, where the engineer sets it per row.
 */
export type FfsDesignFactorSource = 'section-override' | 'line-default' | 'row-supplied';

/**
 * Where the safety factor dividing the failure pressure came from.
 *
 * `derived-from-design-factor` is the historic B31G practice — SF = 1/F, the
 * basis of the Level 0 tables — and is only correct while the line operates at
 * its design hoop stress. `explicit` is the ratio B31G para. 1.9 actually asks
 * for: minimum hydrostatic test pressure over MAOP or MOP.
 */
export type FfsSafetyFactorSource = 'derived-from-design-factor' | 'explicit';

export type FfsRepairStatus = 'unrepaired' | 'temporary-repair' | 'permanent-repair-verified';

/**
 * Screening assumptions layered on top of the code calculation. These are
 * project decisions rather than ASME B31G formulas, so they stay in their own
 * type and are always shown to the engineer alongside the nominal result.
 */
/**
 * Which corrosion rate drives the forecast and the remaining-life search.
 *
 * `measured` retains the historical name for compatibility but now uses each
 * feature's source-evidenced rate. The evidence record distinguishes reported,
 * estimated, assumed, and unavailable values. `uniform` applies one explicit
 * assumption to the whole population.
 */
export type FfsGrowthBasis = 'measured' | 'uniform';

export interface FfsScreeningConfig {
  /** Added to reported depth as absolute percentage points of wall thickness. */
  depthTolerancePct: number;
  /** Added to each end of the reported axial length, in mm. */
  lengthToleranceMm: number;
  /** How the forecast and remaining-life figures pick a growth rate. */
  growthBasis: FfsGrowthBasis;
  /** The uniform radial rate, or explicit fallback only where source evidence is unavailable. */
  growthRateMmPerYear: number;
  /** Forecast horizon in years. */
  forecastYears: number;
  /** ERF at which a feature enters the engineering-review band. */
  reviewBandErf: number;
  /** Multiple of wall thickness used for the axial interaction screen. */
  interactionSpacingFactor: number;
  /** Depth at which a feature is rejected regardless of ERF, as % of wall. */
  depthRejectionPct: number;
}

export const DEFAULT_SCREENING_CONFIG: FfsScreeningConfig = {
  depthTolerancePct: 10,
  lengthToleranceMm: 10,
  growthBasis: 'measured',
  growthRateMmPerYear: 0,
  forecastYears: 5,
  reviewBandErf: 0.9,
  interactionSpacingFactor: 3,
  depthRejectionPct: 80,
};

/**
 * Fills in a screening config that arrived missing fields.
 *
 * The results workspace receives its config through router navigation state,
 * which the browser keeps in its history entry — so it survives a reload, a
 * back navigation, and a deploy. An entry written by an earlier build comes
 * back shaped the way that build wrote it, and the type says nothing about it
 * because the value never passed through a parser.
 *
 * That is not hypothetical. A restored config without `reviewBandErf` took the
 * whole Narrative tab down with "Cannot read properties of undefined (reading
 * 'toFixed')", because the prose quotes the review band directly. Every panel
 * reads these fields, so the repair belongs here rather than in each caller: a
 * missing or non-finite value falls back to its default instead of reaching a
 * template as `undefined`.
 */
export function normaliseScreeningConfig(value: Partial<FfsScreeningConfig> | null | undefined): FfsScreeningConfig {
  const source = value ?? {};
  const numeric = (
    key: Exclude<keyof FfsScreeningConfig, 'growthBasis'>,
  ): number => {
    const candidate = source[key];
    return typeof candidate === 'number' && Number.isFinite(candidate)
      ? candidate
      : DEFAULT_SCREENING_CONFIG[key];
  };

  return {
    depthTolerancePct: numeric('depthTolerancePct'),
    lengthToleranceMm: numeric('lengthToleranceMm'),
    growthBasis: source.growthBasis === 'uniform' || source.growthBasis === 'measured'
      ? source.growthBasis
      : DEFAULT_SCREENING_CONFIG.growthBasis,
    growthRateMmPerYear: numeric('growthRateMmPerYear'),
    forecastYears: numeric('forecastYears'),
    reviewBandErf: numeric('reviewBandErf'),
    interactionSpacingFactor: numeric('interactionSpacingFactor'),
    depthRejectionPct: numeric('depthRejectionPct'),
  };
}

export interface FfsInput {
  featureId: string | null;
  ld: number | string;
  section: string;
  surface: string;
  maxDepthPct: number;
  length: number;
  /**
   * Circumferential extent in mm, or 0 where the run reported none.
   *
   * Not a B31G input — the failure pressure follows from depth and axial length.
   * Only the circumferential interaction screen and the spool area estimate read
   * it, and both treat a non-positive value as unknown rather than as zero-width
   * metal loss.
   */
  width: number;
  orient: string;
  wall: number;
  crDepth: number;
  crLength: number;
  df: number;
  od: number;
  smys: number;
  p0: number;
  repairStatus: FfsRepairStatus;
  repairMethod: string | null;
  repairDate: string | null;
  repairReference: string | null;
  recommendation: string | null;
  actionOwner: string | null;
  /** Source observation and analysis-use provenance for time projection. */
  growthEvidence?: FfsGrowthEvidence;
  /**
   * True when the ILI record is a vendor-merged corrosion group rather than a
   * single defect. B31G is written for one metal-loss feature, and a cluster box
   * is never matched across runs, so both the remaining-strength result and the
   * growth rate mean something different for these rows.
   */
  isClusteredMetalLoss: boolean;
  /**
   * Where the feature sits on the pipe skeleton, as the ILI reported it. These
   * are what make a spool (girth weld to girth weld) reviewable as one piece of
   * pipe instead of a list of independent features. Null when the run did not
   * report them — the review then says so rather than inventing a boundary.
   */
  jointNumber: string | null;
  usGwDistanceM: number | null;
  jointLengthM: number | null;
  /** Which rule supplied `df`. */
  designFactorSource: FfsDesignFactorSource;
  /** The divisor between failure pressure and safe pressure: P_S = P_F / SF. */
  safetyFactor: number;
  safetyFactorSource: FfsSafetyFactorSource;
}

export type FfsRepairDispositionPatch = Pick<
  FfsInput,
  | 'repairStatus'
  | 'repairMethod'
  | 'repairDate'
  | 'repairReference'
  | 'recommendation'
  | 'actionOwner'
>;

export interface FfsResult extends FfsInput {
  SF: number;
  d: number;
  dt: number;
  z: number;
  M: number | null;
  sflow: number;
  Sf: number;
  Pf: number;
  So: number;
  safePressure: number;
  ERF: number;
  acceptance: 'Acceptable' | 'Un-Acceptable';
  branch: string;
  /**
   * Remnant life on the as-reported dimensions — the figure this assessment
   * reports. The tolerance-adjusted sensitivity lives on FfsScreenedResult.
   */
  remnantLife: FfsRemnantLife;
  atFailure_ERF: number | null;
  atFailure_depth: number | null;
  atFailure_Sf: number | null;
  method: 'original' | 'modified';
  saMode: 'smys69' | 'smys11';
}

/** Severity band derived from ERF and the configured review band. */
export type FfsSeverity = 'pass' | 'review' | 'fail';

/** Engineering priority for the action register. */
export type FfsPriority = 'High' | 'Medium' | 'Routine';

/**
 * One screening tier — the same B31G maths evaluated against a different set of
 * dimensions (as-reported, tolerance-adjusted, or grown forward in time).
 */
export interface FfsTier {
  /** The depth the kernel was evaluated at, capped just below full wall. */
  depthPct: number;
  /**
   * The depth this tier was asked for, before capping.
   *
   * A forecast can project past the wall. The kernel cannot report remaining
   * strength there, so it is evaluated at 99.5 %WT — and every figure below then
   * belongs to a shallower defect than the one requested. `depthClamped` says
   * so, rather than letting a substituted geometry read as the answer.
   */
  requestedDepthPct: number;
  depthClamped: boolean;
  lengthMm: number;
  dMm: number;
  z: number;
  M: number | null;
  sflow: number;
  Sf: number;
  Pf: number;
  safePressure: number;
  ERF: number;
  severity: FfsSeverity;
  /**
   * True when this tier's depth is past the 80 %WT limit B31G is written for.
   * The tier is still evaluated — the tolerance and forecast tiers are meant to
   * push features past the limit — but the ERF is no longer a code result and
   * must be presented as an indicator, not an assessment.
   */
  beyondDepthLimit: boolean;
  /** The growth rate this tier was projected with, in mm/year. */
  growthRateMmPerYear: number;
  /** Evidence behind the rate used by this tier. */
  growthObservation?: FfsGrowthObservation;
  growthAnalysisBasis?: FfsGrowthAnalysisBasis | 'uniform-assumption';
}

/**
 * A nominal FFS result enriched with the conservative screen, the degradation
 * forecast, and the derived engineering judgement fields.
 */
export interface FfsScreenedResult {
  /** Stable identity for selection and cross-referencing. */
  key: string;
  index: number;
  nominal: FfsResult;
  conservative: FfsTier;
  forecast: FfsTier;
  /**
   * Remnant life recomputed from the tolerance-adjusted dimensions. Reported as
   * the sensitivity case beside the as-reported figure, never instead of it.
   */
  remnantLifeConservative: FfsRemnantLife;
  priority: FfsPriority;
  /** Clock hour 0–11.99 parsed from the orientation string, or null. */
  clockHour: number | null;
  /** True when the feature sits in the 4–8 o'clock bottom quadrant. */
  bottomQuadrant: boolean;
}

/**
 * A stretch of line holding several features close together.
 *
 * This is a spatial grouping for inspection planning. It is deliberately not
 * called a cluster: "clustered metal loss" in this workspace means a single ILI
 * record that the vendor already merged, which is a property of one feature —
 * see `FfsInput.isClusteredMetalLoss`.
 */
export interface FfsLocationZone {
  id: string;
  members: FfsScreenedResult[];
  startLd: number;
  endLd: number;
  worstErf: number;
}

/**
 * Two features screened against the 3t interaction rule of B31G para. 1.12(a),
 * which measures the separation both longitudinally and circumferentially.
 */
export interface FfsInteractionPair {
  a: FfsScreenedResult;
  b: FfsScreenedResult;
  /** Axial edge-to-edge separation in mm; negative when the boxes overlap. */
  edgeGapMm: number;
  /**
   * Circumferential edge-to-edge separation in mm, measured the short way round
   * the pipe. Null when either feature has no usable clock position or width.
   */
  circumferentialGapMm: number | null;
  thresholdMm: number;
  /** True when the axial separation is inside the threshold. */
  axialInteracting: boolean;
  /** True when the circumferential separation is inside the threshold. */
  circumferentialInteracting: boolean;
  /**
   * Angle of the line joining the two features, in degrees from the pipe axis.
   * Null when the circumferential offset could not be established.
   */
  orientationAngleDeg: number | null;
  /**
   * How B31G para. 1.13 says the pair's extent should be taken. Below 45° the
   * overall length of the pattern governs; at or above it, the most severe
   * longitudinal section is sufficient, so combining the two into one long flaw
   * would be over-conservative rather than correct.
   */
  combineRule: 'overall-length' | 'worst-longitudinal-section' | 'undetermined';
}

export interface FfsAction {
  code: string;
  target: FfsScreenedResult;
  priority: FfsPriority;
  recommendation: string;
  due: string;
}

export const REQUIRED_COLUMNS = [
  'LD [m]', 'Section', 'Surface', 'Max Depth [%]', 'Length [mm]',
  'Orient. (hrs:mins)', 'Nominal Wall Thickness [mm]',
  'CR Depth [mm/y]', 'CR Length [mm/y]', 'Design Factor',
  'Outer Diameter Ds', 'SMYS [MPa]', 'Operating Pressure P₀ [MPa]'
] as const;

export const OPTIONAL_COLUMNS = [
  'Feature ID',
  // Not a B31G input: the failure pressure is a function of depth and axial
  // length only. It is used by the circumferential interaction screen and the
  // spool area estimate, both of which treat a missing width as unknown.
  'Width [mm]',
  'Safety Factor',
  'Clustered Metal Loss',
  'Repair Status',
  'Repair Method',
  'Repair Date',
  'Repair Reference',
  'Recommendation',
  'Action Owner',
] as const;
