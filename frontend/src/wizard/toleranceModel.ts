/**
 * Presentation and projection layer for the engine tolerance gates.
 *
 * `matchingRules.ts` owns the wire contract (what actually reaches
 * `ToleranceConfig`). This module owns everything the Tolerances step needs to
 * *explain* them: bounds, copy, impact weighting, named profiles,
 * and a projection of what tightening or loosening them costs in review time.
 *
 * The projection is a model, not an engine run. See `projectMatchOutcome`.
 */
// Extension is explicit so `node --test` can load this module directly;
// `allowImportingTsExtensions` keeps Vite happy with the same specifier.
import { RECOMMENDED_TOLERANCES, type ToleranceValues } from './matchingRules.ts';

/** The keys that carry a numeric slider. `use_us_gw_distance` is a gate. */
export type ToleranceKey =
  | 'clock_tolerance'
  | 'us_gw_distance_tolerance'
  | 'ds_gw_distance_tolerance'
  | 'gw_offset_tolerance'
  | 'length_tolerance';

export type ImpactLevel = 'low' | 'medium';

export interface ToleranceSpec {
  key: ToleranceKey;
  label: string;
  /** Unit rendered next to the readout, e.g. `deg`. */
  unit: string;
  min: number;
  max: number;
  step: number;
  /** Decimal places for display. */
  precision: number;
  description: string;
  impact: ImpactLevel;
  guidance: string;
  /**
   * Difference at which roughly 63% of genuine pairs fall inside the gate.
   * Real ILI residuals cluster near zero rather than spreading evenly, so the
   * pass fraction is modelled as `1 - exp(-tolerance / characteristic)`.
   */
  characteristic: number;
}

/**
 * Minimums are deliberately above zero. Every one of these is a hard gate in
 * `hungarian_engine.pair_cost`: at zero the gate rejects any pair with a
 * non-identical reading, which silently empties the match table.
 */
export const TOLERANCE_SPECS: readonly ToleranceSpec[] = [
  {
    key: 'clock_tolerance',
    label: 'Clock tolerance',
    unit: 'deg',
    min: 1,
    max: 45,
    step: 1,
    precision: 0,
    description:
      'Hard gate on circumferential position, and the divisor of the clock penalty. '
      + 'A smaller value both rejects more candidates and weighs the remaining clock difference more heavily.',
    impact: 'medium',
    guidance: 'Balances clock alignment against match flexibility.',
    characteristic: 12,
  },
  {
    key: 'us_gw_distance_tolerance',
    label: 'US GW distance tolerance',
    unit: 'm',
    min: 0.05,
    max: 2,
    step: 0.05,
    precision: 2,
    description: 'Tie-in distance gate measured upstream of each locked girth weld.',
    impact: 'low',
    guidance: 'Tighter values reduce false matches on the upstream side.',
    characteristic: 0.18,
  },
  {
    key: 'ds_gw_distance_tolerance',
    label: 'DS GW distance tolerance',
    unit: 'm',
    min: 0.05,
    max: 2,
    step: 0.05,
    precision: 2,
    description: 'Tie-in distance gate measured downstream of each locked girth weld.',
    impact: 'low',
    guidance: 'Tighter values reduce false matches on the downstream side.',
    characteristic: 0.18,
  },
  {
    key: 'gw_offset_tolerance',
    label: 'U/S weld offset tolerance',
    unit: 'm',
    min: 0.05,
    max: 2,
    step: 0.05,
    precision: 2,
    description:
      'Hard gate on how far the two runs disagree about a feature\'s distance from its own '
      + 'upstream girth weld, and the divisor of the GW penalty. Independent of the odometer '
      + 'window above: a run whose odometer drifted still reports weld-relative distances well.',
    impact: 'medium',
    guidance: 'The strongest identity evidence in the record; keep it tighter than the odometer window.',
    characteristic: 0.18,
  },
  {
    key: 'length_tolerance',
    label: 'Length tolerance',
    unit: 'mm',
    min: 5,
    max: 200,
    step: 5,
    precision: 0,
    description: 'Permitted difference in reported defect length between the two runs.',
    impact: 'medium',
    guidance: 'Controls how much length variance still counts as the same defect.',
    characteristic: 45,
  },
] as const;

export const SPEC_BY_KEY: Record<ToleranceKey, ToleranceSpec> = Object.fromEntries(
  TOLERANCE_SPECS.map((spec) => [spec.key, spec]),
) as Record<ToleranceKey, ToleranceSpec>;

export function formatTolerance(spec: ToleranceSpec, value: number): string {
  return value.toFixed(spec.precision);
}

/* ---------------------------------------------------------------------------
 * Named profiles
 * ------------------------------------------------------------------------ */

/**
 * What a named profile actually sets.
 *
 * `wall_thickness_source` is deliberately not part of it. A profile describes
 * how strictly pairs are gated; where a thickness reading comes from is an
 * evidence decision about the uploaded data that survives switching profiles.
 * Including it would let picking "Conservative" silently undo it.
 */
export type ProfileValues = Omit<ToleranceValues, 'wall_thickness_source'>;

export interface ToleranceProfile {
  id: string;
  label: string;
  hint: string;
  values: ProfileValues;
}

export const TOLERANCE_PROFILES: readonly ToleranceProfile[] = [
  {
    id: 'default',
    label: 'Default profile',
    hint: 'The verified balance between match yield and review workload.',
    values: RECOMMENDED_TOLERANCES,
  },
  {
    id: 'conservative',
    label: 'Conservative',
    hint: 'Fewer, surer pairs. Use when the two runs disagree on odometer.',
    values: {
      clock_tolerance: 8,
      us_gw_distance_tolerance: 0.1,
      ds_gw_distance_tolerance: 0.1,
      use_us_gw_distance: true,
      us_gw_distance_source: 'auto',
      anomaly_matcher: 'hungarian',
      // Weld-relative distance survives an odometer disagreement, so this
      // profile keeps it usable rather than tightening it with the window.
      gw_offset_tolerance: 0.15,
      length_tolerance: 25,
    },
  },
  {
    id: 'permissive',
    label: 'Permissive',
    hint: 'More pairs to review. Use when a strict pass left obvious defects unmatched.',
    values: {
      clock_tolerance: 28,
      us_gw_distance_tolerance: 0.5,
      ds_gw_distance_tolerance: 0.5,
      use_us_gw_distance: true,
      us_gw_distance_source: 'auto',
      anomaly_matcher: 'hungarian',
      // Deliberately not widened with the odometer window: this is the gate
      // that still separates two neighbouring pits once the window is loose.
      gw_offset_tolerance: 0.3,
      length_tolerance: 120,
    },
  },
] as const;

/** The non-numeric settings that are part of a tolerance set's identity. */
const CHOICE_KEYS = ['use_us_gw_distance', 'us_gw_distance_source', 'anomaly_matcher'] as const;

/**
 * The evidence decisions a profile does not own. They are excluded from
 * `matchProfile` — a profile is still itself whichever way this is set — but
 * they are part of what "unsaved changes" means, because each one changes what
 * the engine is given rather than how strictly it gates.
 */
const EVIDENCE_KEYS = ['wall_thickness_source'] as const;

function sameChoices(left: ProfileValues, right: ProfileValues): boolean {
  return CHOICE_KEYS.every((key) => left[key] === right[key]);
}

export function matchProfile(values: ToleranceValues): ToleranceProfile | null {
  return TOLERANCE_PROFILES.find((profile) => (
    TOLERANCE_SPECS.every((spec) => profile.values[spec.key] === values[spec.key])
    && sameChoices(profile.values, values)
  )) ?? null;
}

export function sameTolerances(left: ToleranceValues, right: ToleranceValues): boolean {
  return TOLERANCE_SPECS.every((spec) => left[spec.key] === right[spec.key])
    && sameChoices(left, right)
    && EVIDENCE_KEYS.every((key) => left[key] === right[key]);
}

function clampToSpec(spec: ToleranceSpec, value: number): number {
  const stepped = Math.round(value / spec.step) * spec.step;
  const bounded = Math.min(spec.max, Math.max(spec.min, stepped));
  // Re-round: the step arithmetic above leaves float dust on 0.05 steps.
  return Number(bounded.toFixed(spec.precision + 2));
}

/** Every numeric gate scaled by `factor`, clamped to its own bounds. */
export function scaleTolerances(values: ToleranceValues, factor: number): ToleranceValues {
  const scaled = { ...values };
  for (const spec of TOLERANCE_SPECS) {
    scaled[spec.key] = clampToSpec(spec, values[spec.key] * factor);
  }
  return scaled;
}

/* ---------------------------------------------------------------------------
 * Projection
 * ------------------------------------------------------------------------ */

export interface ProjectionAssumptions {
  /**
   * New-run anomalies that share a locked GW section with a given old-run
   * anomaly, i.e. how many candidates each defect is compared against before
   * the gates run.
   */
  neighbourhood: number;
  /** Analyst seconds spent confirming or rejecting one candidate pair. */
  secondsPerPair: number;
}

export const DEFAULT_ASSUMPTIONS: ProjectionAssumptions = {
  neighbourhood: 4,
  secondsPerPair: 3.5,
};

export interface ProjectionInput {
  /** Metal-loss anomalies reported by the older run of the pair. */
  oldAnomalies: number;
  /** Metal-loss anomalies reported by the newer run of the pair. */
  newAnomalies: number;
}

export interface MatchProjection {
  candidatePairs: number;
  reviewHours: number;
  /** Percentage points, 0–100. */
  confidence: number;
  /** Geometric mean of the four gate pass fractions, 0–1. Higher = looser. */
  looseness: number;
  /**
   * False when the selected matcher has no distance gates, which makes every
   * number above meaningless rather than merely approximate. The projection
   * models gate pass fractions; a matcher without gates has none to model.
   */
  gatesApply: boolean;
}

/**
 * The four gates are correlated rather than independent — a genuine pair tends
 * to clear all of them, a spurious one tends to fail all of them — so the
 * fractions are combined as a geometric mean and then sharpened by a single
 * selectivity exponent. Multiplying them as if independent overstates how fast
 * the candidate pool collapses.
 */
const SELECTIVITY = 1.6;

/** Confidence at a hypothetical zero-width gate, in percentage points. */
const CONFIDENCE_CEILING = 99;
/** Points of confidence given up across the full looseness range. */
const CONFIDENCE_SPREAD = 12;

function passFraction(value: number, characteristic: number): number {
  if (!(value > 0)) return 0;
  return 1 - Math.exp(-value / characteristic);
}

/**
 * Projects the review workload implied by a tolerance set.
 *
 * This is a model over the run's own feature counts, not a dry run of the
 * Hungarian matcher — the engine is the only thing that produces real pair
 * counts. Treat the numbers as relative: the direction and rough size of a
 * change are meaningful, the absolute values are an order-of-magnitude guide.
 */
export function projectMatchOutcome(
  values: ToleranceValues,
  input: ProjectionInput,
  assumptions: ProjectionAssumptions = DEFAULT_ASSUMPTIONS,
): MatchProjection {
  // An absent value means a session saved before the matcher choice existed,
  // which ran the gated matcher — the same fallback `toleranceValues` and the
  // backend registry apply. Only an explicit non-gated matcher suppresses this.
  if (values.anomaly_matcher && values.anomaly_matcher !== 'hungarian') {
    // Not a zero and not a guess: this matcher has no gates for the model to
    // reason about, so it reports that rather than a number the engineer would
    // read as a prediction.
    return {
      candidatePairs: 0, reviewHours: 0, confidence: 0, looseness: 0, gatesApply: false,
    };
  }

  const fractions = TOLERANCE_SPECS.map((spec) => {
    // A disabled upstream gate rejects nothing, so it removes no candidates.
    if (spec.key === 'us_gw_distance_tolerance' && !values.use_us_gw_distance) return 1;
    return passFraction(values[spec.key], spec.characteristic);
  });

  const logSum = fractions.reduce((total, fraction) => total + Math.log(Math.max(fraction, 1e-6)), 0);
  const looseness = Math.exp(logSum / fractions.length);

  const pool = Math.max(0, Math.min(input.oldAnomalies, input.newAnomalies)) * assumptions.neighbourhood;
  const candidatePairs = Math.round(pool * looseness ** SELECTIVITY);
  const reviewHours = (candidatePairs * assumptions.secondsPerPair) / 3600;
  const confidence = Math.min(99, Math.max(55, CONFIDENCE_CEILING - looseness * CONFIDENCE_SPREAD));

  return { candidatePairs, reviewHours, confidence, looseness, gatesApply: true };
}

/** Anomaly counts for the pair being tuned, or null when intake has not run. */
export function projectionInputFrom(summaryData: any): ProjectionInput | null {
  const oldAnomalies = Number(summaryData?.oldRun?.anomalies);
  const newAnomalies = Number(summaryData?.newRun?.anomalies ?? summaryData?.masterRun?.anomalies);
  if (!Number.isFinite(oldAnomalies) || !Number.isFinite(newAnomalies)) return null;
  if (oldAnomalies <= 0 || newAnomalies <= 0) return null;
  return { oldAnomalies, newAnomalies };
}

/* ---------------------------------------------------------------------------
 * Comparison columns
 * ------------------------------------------------------------------------ */

export const STRICTER_FACTOR = 0.6;
export const LOOSER_FACTOR = 1.6;

export interface ProjectionColumn {
  id: 'stricter' | 'current' | 'looser';
  label: string;
  values: ToleranceValues;
  projection: MatchProjection;
}

export function buildProjectionColumns(
  values: ToleranceValues,
  input: ProjectionInput,
  assumptions: ProjectionAssumptions = DEFAULT_ASSUMPTIONS,
): ProjectionColumn[] {
  const variants: Array<Pick<ProjectionColumn, 'id' | 'label'> & { values: ToleranceValues }> = [
    { id: 'stricter', label: 'Stricter', values: scaleTolerances(values, STRICTER_FACTOR) },
    { id: 'current', label: 'Current', values },
    { id: 'looser', label: 'Looser', values: scaleTolerances(values, LOOSER_FACTOR) },
  ];
  return variants.map((variant) => ({
    ...variant,
    projection: projectMatchOutcome(variant.values, input, assumptions),
  }));
}

export function formatHours(hours: number): string {
  if (hours < 0.1) return '<0.1 h';
  if (hours < 10) return `~${hours.toFixed(1)} h`;
  return `~${Math.round(hours)} h`;
}

/** Signed percentage change, or null when there is no baseline to compare to. */
export function percentDelta(value: number, baseline: number): number | null {
  if (!baseline) return null;
  return ((value - baseline) / baseline) * 100;
}

export function formatSignedPercent(delta: number): string {
  const rounded = Math.round(delta);
  return `${rounded > 0 ? '+' : ''}${rounded}%`;
}

export function formatSignedPoints(delta: number): string {
  const rounded = Math.round(delta);
  return `${rounded > 0 ? '+' : ''}${rounded} pts`;
}
