// Type-only, so the cycle with remnantLife.ts (which needs FfsLifeStatus) is
// erased at compile time rather than becoming a runtime import cycle.
import type { FfsRemnantLife, FfsServiceLifeInputs } from './remnantLife.ts';
import type { B314DispositionResult, B314InteractionResult } from './b314.ts';

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
  /**
   * ASME B31.4-2025 Table 403.2.1-1 weld joint factor E, used only by the B31.4
   * design-thickness calculation the para. 451.6.2.2(b) 20 % band is measured
   * against. Defaults to 1.0 — seamless, ERW, and electric flash welded pipe,
   * which is most line pipe. It is 0.80 for electric fusion welded and 0.60 for
   * furnace butt welded, where it moves the band substantially.
   */
  weldJointFactor?: number;
  /**
   * Yield-to-tensile ratio of the pipe material, where the dossier gives one.
   * Above 0.93, ASME B31.4-2025 para. 451.6.2.2(b) requires an engineering
   * analysis rather than B31G to establish the safe operating pressure.
   */
  yieldToTensileRatio?: number | null;
  /**
   * True where the line is subject to unusual axial loads, lateral movement, or
   * settlement — the other para. 451.6.2.2(b) trigger for engineering analysis.
   */
  unusualLoading?: boolean;
}

export type FfsPressureBasis = 'maop' | 'mop' | 'current-operating' | 'other-required';

export type FfsGrowthObservation =
  | 'matched-measured'
  | 'new-only-zero-baseline-estimate'
  | 'apparent-decrease'
  | 'manual-reported'
  | 'unavailable';

/**
 * What the projection actually consumed as a rate.
 *
 * The first three come from the source: a matched run pair, a NEW-only estimate,
 * or the engineer's own fallback entry. The last two are derivations the
 * assessment makes when none of those exist, so that a corroding feature is never
 * left without a remnant life — see `growthResolution.ts`. They are labelled
 * apart from the measured bases everywhere the rate is shown, and the source
 * `observation` beside them still reads "unavailable".
 */
export type FfsGrowthAnalysisBasis =
  | 'reported'
  | 'estimated'
  | 'explicit-fallback'
  /** Measured metal loss divided by the service age of the line. */
  | 'service-age'
  /** The percentile rate of the comparable measured population. */
  | 'population-percentile'
  | 'none';

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
 * What one stretch of line is made of, and how it is assessed.
 *
 * A single line routinely carries more than one of each of these. Buried line
 * pipe at 0.72 with a river crossing or riser at 0.60 is the ordinary case, not
 * the exception, and assessing the crossing at the line-pipe factor overstates
 * its safe pressure. So is a line that leaves the station at 20 in and steps up
 * to 24 in at a reducer: B31G's failure pressure carries D in the denominator
 * and D·t in the Folias term, so assessing the 24 in run at the 20 in diameter
 * is not a rounding difference — it moves the answer.
 *
 * Sections come from the alignment sectioning that has already been reviewed,
 * so the engineer describes a stretch they have already named and bounded on
 * girth welds rather than typing distances again.
 */
export interface FfsSectionPipeSpec {
  /** Section name exactly as the alignment sectioning emitted it. */
  section: string;
  designFactor: number;
  /**
   * Outside diameter of the pipe in this section, in mm. Absent, null, or
   * non-positive means the section is made of the line default pipe.
   */
  outerDiameterMm?: number | null;
  /**
   * Nominal wall for this section, in mm, used on the same terms as the line
   * nominal wall: only where the run reported no wall for a feature. A section
   * of a different diameter is almost always a different wall as well, and
   * falling back to the line wall there would put the 20 in wall on 24 in pipe.
   */
  nominalWallThicknessMm?: number | null;
  /**
   * Specified minimum yield strength of the grade in this section, in MPa.
   * Absent, null, or non-positive means the stretch is the line default grade.
   *
   * A line is no more uniform in grade than it is in diameter: a station run in
   * X52 stepping into X60 line pipe, or an X65 crossing in an X52 line, is the
   * ordinary case. SMYS enters B31G through the flow stress — 1.1·SMYS, or
   * SMYS + 69 MPa on the Modified method — so it scales the failure pressure
   * directly, and assessing an X60 stretch at X52 understates it by the ratio
   * of the two grades.
   */
  smysMpa?: number | null;
}

/**
 * Which rule produced the design factor a feature was assessed with.
 * `row-supplied` is the manual workbook, where the engineer sets it per row.
 */
export type FfsDesignFactorSource = 'section-override' | 'line-default' | 'row-supplied';

/**
 * Which rule produced the outside diameter a feature was assessed at.
 *
 * Deliberately the same three cases as `FfsDesignFactorSource`, and recorded on
 * every feature for the same reason: on a line of more than one diameter, the
 * D behind an ERF is a decision the report has to be able to show.
 */
export type FfsOuterDiameterSource = 'section-override' | 'line-default' | 'row-supplied';

/**
 * Which rule produced the SMYS a feature was assessed with.
 *
 * The same three cases again, and recorded per feature for the same reason: the
 * grade multiplies the flow stress, so on a line of more than one grade the
 * strength behind an ERF is a decision the report has to be able to show.
 */
export type FfsSmysSource = 'section-override' | 'line-default' | 'row-supplied';

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
  /**
   * Whether a feature with no source growth rate may be given a derived one.
   *
   * On by default, and it is what makes every assessed feature carry a remnant
   * life. The derivation ladder is in `growthResolution.ts`; every derived rate
   * is labelled as a derivation and raised as a readiness finding, never
   * presented as a measurement. Turning it off restores the strict behaviour —
   * an unmatched feature then reports no remaining life at all, which is honest
   * but leaves ASME B31.4-2025 para. 451.6.2.2(b) unanswered for that feature.
   */
  deriveMissingGrowthRates: boolean;
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
  deriveMissingGrowthRates: true,
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
    key: Exclude<keyof FfsScreeningConfig, 'growthBasis' | 'deriveMissingGrowthRates'>,
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
    // A config restored from an entry written before this field existed comes
    // back without it. Absent means the default, not "off": the alternative is
    // that reloading a results page silently empties the remnant-life column.
    deriveMissingGrowthRates: typeof source.deriveMissingGrowthRates === 'boolean'
      ? source.deriveMissingGrowthRates
      : DEFAULT_SCREENING_CONFIG.deriveMissingGrowthRates,
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
  /** Which rule supplied `od`. */
  outerDiameterSource: FfsOuterDiameterSource;
  /** Which rule supplied `smys`. */
  smysSource: FfsSmysSource;
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
  /**
   * What ASME B31.4-2025 para. 451.6.2.2 requires be done about this area.
   *
   * Held apart from `nominal.acceptance`, which is the B31G acceptance criterion.
   * The two answer different questions and can differ legitimately: a feature at
   * 15 % of the design thickness needs no repair under the Code while still
   * carrying an ERF, and a feature past 80 %WT is removed or repaired under the
   * Code whatever its ERF says.
   */
  b314: B314DispositionResult;
  /** The B31.4 para. 403.2.1 pressure design thickness, mm. Null when unknown. */
  b314DesignThicknessMm: number | null;
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
  /**
   * The same pair under ASME B31.4-2025 para. 451.6.2.2(d), which is the rule a
   * liquid pipeline is actually operated under. Its triggers are not the 3t of
   * B31G: one inch axially, six times the design thickness circumferentially.
   * Both screens are reported because they disagree on ordinary geometry, and an
   * engineer has to see which rule brought a pair into the list.
   */
  b314: B314InteractionResult;
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
