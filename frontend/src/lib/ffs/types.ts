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
}

export type FfsLifeStatus =
  | 'calculated'
  | 'not-reached-within-horizon'
  | 'insufficient-growth-basis';

export type FfsFailureCriterion = 'Depth = 80%' | 'ERF = 1';

/**
 * Screening assumptions layered on top of the code calculation. These are
 * project decisions rather than ASME B31G formulas, so they stay in their own
 * type and are always shown to the engineer alongside the nominal result.
 */
/**
 * Which corrosion rate drives the forecast and the remaining-life search.
 *
 * `measured` uses each feature's own reported rate — the same basis as the
 * nominal expected life — and falls back to the uniform rate only where a
 * feature carries none. `uniform` applies one rate to the whole population,
 * which is what you want when the run pair's growth numbers are not trusted.
 */
export type FfsGrowthBasis = 'measured' | 'uniform';

export interface FfsScreeningConfig {
  /** Added to reported depth as absolute percentage points of wall thickness. */
  depthTolerancePct: number;
  /** Added to each end of the reported axial length, in mm. */
  lengthToleranceMm: number;
  /** How the forecast and remaining-life figures pick a growth rate. */
  growthBasis: FfsGrowthBasis;
  /** The uniform radial growth rate, and the fallback under `measured`, in mm/year. */
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
  growthRateMmPerYear: 0.1,
  forecastYears: 5,
  reviewBandErf: 0.9,
  interactionSpacingFactor: 3,
  depthRejectionPct: 80,
};

export interface FfsInput {
  ld: number | string;
  section: string;
  surface: string;
  maxDepthPct: number;
  length: number;
  width: number;
  orient: string;
  wall: number;
  crDepth: number;
  crLength: number;
  df: number;
  od: number;
  smys: number;
  p0: number;
}

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
  /** Null unless a limit is reached inside the configured analysis horizon. */
  expectedLife: number | null;
  yearService: string | null;
  failureCriteria: FfsFailureCriterion | null;
  lifeStatus: FfsLifeStatus;
  analysisHorizonYears: number;
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
  depthPct: number;
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
  /** Years until conservative ERF reaches 1.0; null when no finite limit is established. */
  lifeToErf1: number | null;
  lifeToErf1Status: FfsLifeStatus;
  priority: FfsPriority;
  /** Clock hour 0–11.99 parsed from the orientation string, or null. */
  clockHour: number | null;
  /** True when the feature sits in the 4–8 o'clock bottom quadrant. */
  bottomQuadrant: boolean;
}

export interface FfsCluster {
  id: string;
  members: FfsScreenedResult[];
  startLd: number;
  endLd: number;
  worstErf: number;
}

export interface FfsInteractionPair {
  a: FfsScreenedResult;
  b: FfsScreenedResult;
  edgeGapMm: number;
  thresholdMm: number;
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
  'Width [mm]', 'Orient. (hrs:mins)', 'Nominal Wall Thickness [mm]',
  'CR Depth [mm/y]', 'CR Length [mm/y]', 'Design Factor',
  'Outer Diameter Ds', 'SMYS [MPa]', 'Operating Pressure P₀ [MPa]'
] as const;
