/**
 * Where a corrosion rate comes from when the run pair did not supply one.
 *
 * A remnant life is only ever as good as the rate it was projected with, and the
 * assessment used to stop at the run pair: a feature the alignment could not
 * match, a vendor-merged cluster, or a matched pair reporting an apparent
 * *decrease* all arrived at the results table with a rate of zero. Zero is not a
 * measurement — it is the absence of one — and the projection then reported "Not
 * calculated" for features that are unmistakably corroding. On a run where most
 * anomalies are NEW-only, that was most of the register.
 *
 * ASME B31.4-2025 para. 451.6.2.2(b) requires a safe operating pressure to be
 * established for every area of metal loss between 20 % and 80 % of the wall, and
 * para. 451.6.2.2(c) asks for continuing mitigation where internal corrosion is
 * active. Neither is answerable without a rate. So this module completes the
 * ladder rather than leaving the cell blank:
 *
 *   1. the matched run-pair rate                         (analysisBasis 'reported')
 *   2. the NEW-only zero-baseline estimate               ('estimated')
 *   3. the engineer's explicit fallback                  ('explicit-fallback')
 *   4. the feature's own service-age rate                ('service-age')
 *   5. the population rate of comparable features        ('population-percentile')
 *
 * Steps 4 and 5 are derivations, not measurements, and they are labelled as such
 * everywhere the rate is shown: the source `observation` is never overwritten,
 * only the analysis basis the projection consumes. A feature that reaches step 5
 * still carries "Source growth unavailable" as its observation.
 *
 * Step 4 is the long-term corrosion rate of ordinary inspection practice — the
 * measured metal loss divided by the time the line has been in service — which is
 * what an operator computes when only one run exists. It needs a commissioning
 * year; without one there is no service age to divide by.
 *
 * Step 5 assigns an unmatched feature the rate its neighbours are measured to be
 * corroding at. It is taken at a high percentile rather than the mean, because
 * the figure stands in for a measurement that was not made and a central estimate
 * would understate half the population it is drawn from.
 */

import type {
  FfsConfig,
  FfsGrowthAnalysisBasis,
  FfsGrowthComponentEvidence,
  FfsGrowthObservation,
  FfsResult,
} from './types.ts';

/**
 * The percentile of the comparable population a derived rate is taken at.
 *
 * A derived rate replaces a measurement nobody made. The mean of the measured
 * rates would place half the comparable features above the figure their unmatched
 * neighbour was projected with, so the derivation is taken well up the
 * distribution instead — high enough to be a conservative stand-in, not the
 * maximum, which on any real run is a single sizing outlier.
 */
export const POPULATION_RATE_PERCENTILE = 0.95;

/**
 * How many measured neighbours a section needs before its own rate is used.
 *
 * Below this the section statistic is one or two numbers wearing a percentile,
 * and the whole-line population is the better estimator.
 */
export const MIN_SECTION_SAMPLES = 3;

/** Days in a Julian year, the basis the rest of the projection uses. */
const DAYS_PER_YEAR = 365.25;
const MS_PER_YEAR = DAYS_PER_YEAR * 24 * 60 * 60 * 1000;

/**
 * The analysis bases that count as a measurement of this feature.
 *
 * `'reported'` only. This set used to admit `'estimated'` as well — the NEW-only
 * zero-baseline rate — which quietly defeated the purpose of the population
 * rung: on a run where most anomalies are unmatched, the "measured population"
 * became overwhelmingly the unmatched ones, and an unmatched feature was handed
 * the percentile of other features that had never been measured either. On the
 * HU_CPA_2026 register that pool was 5,785 estimates against 392 measurements,
 * and the rate it produced was 2.05x the percentile of the real ones.
 *
 * A zero-baseline estimate is an assumption about one feature. Averaging many of
 * them does not turn them into evidence about a different feature.
 */
const MEASURED_BASES: ReadonlySet<FfsGrowthAnalysisBasis> = new Set(['reported']);

export interface FfsGrowthResolutionContext {
  iliDate: Date;
  /** Null disables the service-age step — there is no age to divide by. */
  commissioningYear: number | null;
  /** Service age at the inspection, in years. Null when it cannot be established. */
  serviceAgeYears: number | null;
  /** Percentile rate per `section|surface`, where the group carries enough samples. */
  sectionRates: ReadonlyMap<string, number>;
  /** Percentile rate over every measured feature on the line. */
  populationRate: number | null;
  /** How many features contributed a measured rate. */
  measuredSampleCount: number;
  /** Percentile axial rate over every run-pair measured feature, or null. */
  lengthPopulationRate: number | null;
  /** How many features contributed a measured axial rate. */
  lengthMeasuredSampleCount: number;
}

/**
 * The depth rate this feature's projection actually consumed.
 *
 * The one supported way to read a growth rate for display, export, or any
 * statistic. `FfsResult.crDepthSource` is the source column and is zero for
 * every feature the run pair did not match; the remnant-life record carries the
 * rate the ladder resolved and the projection was run on. Reading the source
 * column instead is what let a workbook print "CR depth used = 0" beside a life
 * computed from 0.908 mm/y.
 */
export function resolvedDepthRate(result: FfsResult): number {
  const rate = result.remnantLife?.depthRateMmPerYear;
  return rate !== undefined && Number.isFinite(rate) ? rate : result.crDepthSource;
}

/**
 * The length rate the projection consumed, or null when none was established.
 *
 * Null rather than zero, and callers have to handle it: a zero in a rate column
 * reads as "this defect is not lengthening", which is a measurement nobody made.
 */
export function resolvedLengthRate(result: FfsResult): number | null {
  const life = result.remnantLife;
  if (!life) return result.crLengthSource > 0 ? result.crLengthSource : null;
  if (life.lengthHeldConstant) return null;
  return Number.isFinite(life.lengthRateMmPerYear) ? life.lengthRateMmPerYear : null;
}

/** Linear-interpolated percentile over an ascending sample. */
export function percentileOf(sortedAscending: readonly number[], fraction: number): number | null {
  if (sortedAscending.length === 0) return null;
  if (sortedAscending.length === 1) return sortedAscending[0];
  const position = fraction * (sortedAscending.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sortedAscending[lower];
  return sortedAscending[lower] + (sortedAscending[upper] - sortedAscending[lower]) * (position - lower);
}

/** The key a feature's comparable population is grouped under. */
export function comparableGroupKey(result: FfsResult): string {
  const section = String(result.section ?? '').trim().toLocaleLowerCase('en-US');
  const surface = String(result.surface ?? '').trim().toLocaleLowerCase('en-US');
  return `${section}|${surface}`;
}

/** True when this feature's own depth rate is a measurement of this feature. */
function measuredDepthRateOf(result: FfsResult): number | null {
  const evidence = result.growthEvidence?.depth;
  if (!evidence) return result.crDepthSource > 0 ? result.crDepthSource : null;
  if (!MEASURED_BASES.has(evidence.analysisBasis)) return null;
  const rate = evidence.analysisRateMmPerYear;
  return rate !== null && Number.isFinite(rate) && rate > 0 ? rate : null;
}

/**
 * This feature's own axial rate, where a run pair measured it.
 *
 * No zero-baseline counterpart exists and none is invented: a defect never had
 * zero length, so an unmatched feature contributes nothing to this pool.
 */
function measuredLengthRateOf(result: FfsResult): number | null {
  const evidence = result.growthEvidence?.length;
  if (!evidence) return result.crLengthSource > 0 ? result.crLengthSource : null;
  if (!MEASURED_BASES.has(evidence.analysisBasis)) return null;
  const rate = evidence.analysisRateMmPerYear;
  return rate !== null && Number.isFinite(rate) && rate > 0 ? rate : null;
}

/**
 * The service age at the inspection, in years.
 *
 * Measured from 1 January of the commissioning year, which is the only precision
 * a commissioning *year* carries. Null when the dossier gives no year or the
 * inspection predates it.
 */
export function serviceAgeYears(commissioningYear: number | null, iliDate: Date): number | null {
  if (commissioningYear === null || !Number.isFinite(commissioningYear)) return null;
  if (!(iliDate instanceof Date) || !Number.isFinite(iliDate.getTime())) return null;
  const commissioned = Date.UTC(commissioningYear, 0, 1);
  const age = (iliDate.getTime() - commissioned) / MS_PER_YEAR;
  return age > 0 ? age : null;
}

/**
 * Builds the population statistics the derived steps draw on.
 *
 * One pass over the assessed features. The context is deliberately built from the
 * whole population rather than per feature, so two features in the same section
 * cannot be given two different "section rates".
 */
export function buildGrowthResolutionContext(
  results: readonly FfsResult[],
  config: FfsConfig,
): FfsGrowthResolutionContext {
  const commissioningYear = config.serviceLife?.commissioningYear ?? null;
  const grouped = new Map<string, number[]>();
  const all: number[] = [];
  const allLength: number[] = [];

  for (const result of results) {
    const lengthRate = measuredLengthRateOf(result);
    if (lengthRate !== null) allLength.push(lengthRate);
    const rate = measuredDepthRateOf(result);
    if (rate === null) continue;
    all.push(rate);
    const key = comparableGroupKey(result);
    const bucket = grouped.get(key);
    if (bucket) bucket.push(rate);
    else grouped.set(key, [rate]);
  }

  const sectionRates = new Map<string, number>();
  for (const [key, rates] of grouped) {
    if (rates.length < MIN_SECTION_SAMPLES) continue;
    const percentile = percentileOf([...rates].sort((a, b) => a - b), POPULATION_RATE_PERCENTILE);
    if (percentile !== null && percentile > 0) sectionRates.set(key, percentile);
  }

  const populationRate = percentileOf([...all].sort((a, b) => a - b), POPULATION_RATE_PERCENTILE);
  // Line-wide only. The axial rate is not sectioned the way depth is: the
  // sample is an order of magnitude smaller, and a three-sample section
  // percentile of a quantity this noisy is a number pretending to be a
  // statistic.
  const lengthPopulationRate = percentileOf(
    [...allLength].sort((a, b) => a - b), POPULATION_RATE_PERCENTILE,
  );

  return {
    iliDate: config.iliDate,
    commissioningYear,
    serviceAgeYears: serviceAgeYears(commissioningYear, config.iliDate),
    sectionRates,
    populationRate: populationRate !== null && populationRate > 0 ? populationRate : null,
    measuredSampleCount: all.length,
    lengthPopulationRate: lengthPopulationRate !== null && lengthPopulationRate > 0
      ? lengthPopulationRate
      : null,
    lengthMeasuredSampleCount: allLength.length,
  };
}

/** A rate the ladder derived, with the sentence that has to travel with it. */
export interface DerivedDepthRate {
  rateMmPerYear: number;
  analysisBasis: Extract<FfsGrowthAnalysisBasis, 'service-age' | 'population-percentile'>;
  formula: string;
  note: string;
}

function round6(value: number): number {
  return Number(value.toFixed(6));
}

/**
 * The feature's own metal loss divided by the time the line has been in service.
 *
 * The long-term rate of ordinary inspection practice, and the only derivation
 * that uses this feature's own measurement rather than its neighbours'. It
 * assumes the metal loss accumulated uniformly from commissioning, which
 * understates a defect that initiated late — the note says so.
 */
export function serviceAgeDepthRate(
  result: FfsResult,
  context: FfsGrowthResolutionContext,
): DerivedDepthRate | null {
  const age = context.serviceAgeYears;
  if (age === null || !(age > 0)) return null;
  const depthMm = (result.maxDepthPct / 100) * result.wall;
  if (!Number.isFinite(depthMm) || !(depthMm > 0)) return null;
  const rate = round6(depthMm / age);
  if (!(rate > 0)) return null;
  return {
    rateMmPerYear: rate,
    analysisBasis: 'service-age',
    formula: `${Number(depthMm.toFixed(4))} mm / ${Number(age.toFixed(2))} y since ${context.commissioningYear}`,
    note:
      'Derived: the measured metal loss over the service age of the line, because no run-pair rate '
      + 'was available for this feature. It assumes uniform loss since commissioning, so a defect '
      + 'that initiated late is under-rated by it.',
  };
}

/**
 * The rate the comparable measured population is corroding at.
 *
 * Same section and surface where that group carries enough measured features,
 * otherwise the whole line. Null when nothing on the line was measured at all.
 */
export function populationDepthRate(
  result: FfsResult,
  context: FfsGrowthResolutionContext,
): DerivedDepthRate | null {
  const key = comparableGroupKey(result);
  const sectionRate = context.sectionRates.get(key) ?? null;
  const rate = sectionRate ?? context.populationRate;
  if (rate === null || !(rate > 0)) return null;
  const scope = sectionRate !== null
    ? `section "${result.section}" / ${result.surface || 'unstated'} surface`
    : 'whole assessed population';
  return {
    rateMmPerYear: round6(rate),
    analysisBasis: 'population-percentile',
    formula: `P${Math.round(POPULATION_RATE_PERCENTILE * 100)} of ${context.measuredSampleCount} run-pair measured depth rate(s), ${scope}`,
    note:
      `Derived: the ${Math.round(POPULATION_RATE_PERCENTILE * 100)}th-percentile run-pair measured depth rate of the `
      + `${scope}, because neither a run-pair rate nor a service age was available for this feature. `
      + 'It is a stand-in for a measurement that was not made, not a measurement of this feature.',
  };
}

/**
 * The axial rate the measured population is lengthening at.
 *
 * The one derived rung length is offered, and only where the engineer asked for
 * it — see `FfsScreeningConfig.deriveMissingLengthRates`. There is deliberately
 * no zero-baseline and no service-age counterpart: both would divide this
 * feature's whole axial extent by an interval, and a defect has never at any
 * point been zero millimetres long.
 */
export function populationLengthRate(
  context: FfsGrowthResolutionContext,
): DerivedLengthRate | null {
  const rate = context.lengthPopulationRate;
  if (rate === null || !(rate > 0)) return null;
  const percentile = Math.round(POPULATION_RATE_PERCENTILE * 100);
  return {
    rateMmPerYear: round6(rate),
    analysisBasis: 'population-percentile',
    formula: `P${percentile} of ${context.lengthMeasuredSampleCount} run-pair measured length rate(s), whole assessed population`,
    note:
      `Derived: the ${percentile}th-percentile run-pair measured axial growth rate of the assessed `
      + 'population, because this feature carries none of its own. It is a stand-in for a measurement that '
      + 'was not made, and axial extent is the dimension ILI sizes least precisely — treat it as a '
      + 'sensitivity, not as a rate this defect was observed to lengthen at.',
  };
}

/** A derived axial rate, with the sentence that has to travel with it. */
export interface DerivedLengthRate {
  rateMmPerYear: number;
  analysisBasis: Extract<FfsGrowthAnalysisBasis, 'population-percentile'>;
  formula: string;
  note: string;
}

/**
 * The derived rate for one feature, or null when the population supports none.
 *
 * Service age first: it is this feature's own measurement. The population
 * statistic is the last resort before the projection has to say it cannot
 * establish a rate at all.
 */
export function deriveDepthRate(
  result: FfsResult,
  context: FfsGrowthResolutionContext,
): DerivedDepthRate | null {
  return serviceAgeDepthRate(result, context) ?? populationDepthRate(result, context);
}

/**
 * Rewrites the evidence record so the derivation is visible wherever the rate is.
 *
 * The source `observation` is untouched — the run pair still did not measure this
 * feature, and no derivation changes that. Only the analysis basis, the rate the
 * projection consumes, and the note move.
 */
export function withDerivedDepthRate(
  evidence: FfsGrowthComponentEvidence | undefined,
  derived: DerivedDepthRate,
  fallbackObservation: FfsGrowthObservation = 'unavailable',
): FfsGrowthComponentEvidence {
  return {
    observation: evidence?.observation ?? fallbackObservation,
    analysisBasis: derived.analysisBasis,
    rawRateMmPerYear: evidence?.rawRateMmPerYear ?? null,
    analysisRateMmPerYear: derived.rateMmPerYear,
    formula: derived.formula,
    note: derived.note,
  };
}
