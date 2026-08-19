import { evaluateB31g, type B31gGeometry } from './b31g.ts';
import { analysisHorizonYears, DEFAULT_FFS_ANALYSIS_HORIZON_YEARS } from './lifeProjection.ts';
import { computeRemnantLife, EMPTY_SERVICE_LIFE, type FfsRemnantLimit } from './remnantLife.ts';
import { lengthApplicationFor, severityOf } from './screening.ts';
import { resolvedDepthRate } from './growthResolution.ts';
import type {
  FfsConfig,
  FfsLifeStatus,
  FfsResult,
  FfsScreeningConfig,
  FfsSeverity,
} from './types.ts';

export type FfsScenarioPreset = 'as-reported' | 'conservative' | 'forecast';

/**
 * Draft assumptions used only inside the detail drawer. They never replace the
 * imported ILI row, the screening configuration, or the stored nominal result.
 */
export interface FfsScenarioInputs {
  requiredPressureMpa: number;
  depthGrowthRateMmPerYear: number;
  lengthGrowthRateMmPerYear: number;
  forecastYears: number;
  applyConfiguredTolerance: boolean;
}

export interface FfsScenarioEvaluation {
  depthPct: number;
  lengthMm: number;
  failurePressureMpa: number;
  safePressureMpa: number;
  erf: number;
  capacityMarginMpa: number;
  severity: FfsSeverity;
  beyondDepthLimit: boolean;
  valid: boolean;
  invalidReason: string | null;
  limitYears: number | null;
  limitStatus: FfsLifeStatus;
  limitCriterion: FfsRemnantLimit | null;
  analysisHorizonYears: number;
}

/**
 * A seed value the drawer can format.
 *
 * A preset reads columns straight off the stored result, and a case filed by an
 * older build does not carry every column this file names — the growth columns
 * were renamed once already. A missing column reached the sliders as
 * `undefined` and the panel died formatting it, taking the whole workspace down
 * with it. Nothing is invented here: an unreadable seed becomes the zero the
 * rest of the engine already treats as "no rate established", and
 * `evaluateFfsScenario` still refuses the scenario and says so.
 */
function seedValue(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** The horizon the stored projection was bounded to, or the configured default. */
function seedHorizonYears(nominal: FfsResult): number {
  const stored = nominal.remnantLife?.analysisHorizonYears;
  return typeof stored === 'number' && Number.isFinite(stored) && stored > 0
    ? stored
    : DEFAULT_FFS_ANALYSIS_HORIZON_YEARS;
}

function assertFiniteAtLeast(label: string, value: number, minimum: number): void {
  if (!Number.isFinite(value) || value < minimum) {
    throw new RangeError(`${label} must be a finite value of at least ${minimum}.`);
  }
}

function geometryOf(nominal: FfsResult, requiredPressureMpa: number): B31gGeometry {
  return {
    wallThickness: nominal.wall,
    outerDiameter: nominal.od,
    smysMpa: nominal.smys,
    safetyFactor: nominal.safetyFactor,
    operatingPressureMpa: requiredPressureMpa,
  };
}

export function scenarioInputsForPreset(
  preset: FfsScenarioPreset,
  nominal: FfsResult,
  screening: FfsScreeningConfig,
): FfsScenarioInputs {
  const reported = {
    requiredPressureMpa: seedValue(nominal.p0),
    depthGrowthRateMmPerYear: seedValue(nominal.crDepthSource),
    lengthGrowthRateMmPerYear: seedValue(nominal.crLengthSource),
  };

  if (preset === 'as-reported') {
    return {
      ...reported,
      forecastYears: 0,
      applyConfiguredTolerance: false,
    };
  }

  const screened = {
    requiredPressureMpa: seedValue(nominal.p0),
    // Under the uniform basis every feature runs on the configured rate. On the
    // per-feature basis the rate is read off the projection rather than
    // re-resolved here: re-resolving without the population context skipped the
    // ladder's derived rungs, so a preset seeded the drawer with 0 mm/y for
    // exactly the features the assessment had projected on a derived rate, and
    // the drawer then disagreed with the results table it was opened from.
    depthGrowthRateMmPerYear: seedValue(screening.growthBasis === 'uniform'
      ? screening.growthRateMmPerYear
      : resolvedDepthRate(nominal)),
    // Resolved the same way as depth, so a preset cannot seed the drawer with a
    // length rate the screening basis would never have used.
    lengthGrowthRateMmPerYear: seedValue(lengthApplicationFor(nominal, screening).rateMmPerYear),
  };

  if (preset === 'conservative') {
    return {
      ...screened,
      forecastYears: 0,
      applyConfiguredTolerance: true,
    };
  }
  return {
    ...screened,
    forecastYears: Math.min(seedValue(screening.forecastYears), seedHorizonYears(nominal)),
    applyConfiguredTolerance: true,
  };
}

/**
 * Evaluates one draft scenario through the same B31G kernel used by the locked
 * nominal result. Only the explicit draft inputs differ; no source object is
 * mutated and no scenario value is persisted by this module.
 */
export function evaluateFfsScenario(
  nominal: FfsResult,
  config: FfsConfig,
  screening: FfsScreeningConfig,
  inputs: FfsScenarioInputs,
): FfsScenarioEvaluation {
  const horizonYears = analysisHorizonYears(config);
  assertFiniteAtLeast('Required pressure', inputs.requiredPressureMpa, Number.EPSILON);
  assertFiniteAtLeast('Depth growth rate', inputs.depthGrowthRateMmPerYear, 0);
  assertFiniteAtLeast('Length growth rate', inputs.lengthGrowthRateMmPerYear, 0);
  assertFiniteAtLeast('Forecast years', inputs.forecastYears, 0);
  if (inputs.forecastYears > horizonYears) {
    throw new RangeError(`Forecast years cannot exceed the ${horizonYears}-year analysis horizon.`);
  }

  const toleranceDepthPct = inputs.applyConfiguredTolerance ? screening.depthTolerancePct : 0;
  const toleranceLengthMm = inputs.applyConfiguredTolerance ? 2 * screening.lengthToleranceMm : 0;
  const baseDepthMm = ((nominal.maxDepthPct + toleranceDepthPct) / 100) * nominal.wall;
  const baseLengthMm = nominal.length + toleranceLengthMm;
  const geometry = geometryOf(nominal, inputs.requiredPressureMpa);

  const evaluateAtYear = (years: number) => {
    const depthMm = baseDepthMm + inputs.depthGrowthRateMmPerYear * years;
    const lengthMm = Math.max(0.001, baseLengthMm + inputs.lengthGrowthRateMmPerYear * years);
    return {
      lengthMm,
      result: evaluateB31g(depthMm, lengthMm, geometry, config.method, config.modifiedSa),
    };
  };

  const displayed = evaluateAtYear(inputs.forecastYears);

  // The drawer used to run its own depth-limit arithmetic and its own ERF
  // bisection, which is how a scenario could disagree with the table it was
  // opened from. Same kernel now; only the draft inputs differ.
  const remnant = computeRemnantLife({
    geometry,
    method: config.method,
    flowStressMode: config.modifiedSa,
    basis: inputs.applyConfiguredTolerance ? 'tolerance-adjusted' : 'as-reported',
    startDepthPct: (baseDepthMm / nominal.wall) * 100,
    startLengthMm: baseLengthMm,
    depthRateMmPerYear: inputs.depthGrowthRateMmPerYear,
    lengthRateMmPerYear: inputs.lengthGrowthRateMmPerYear,
    lengthRateAvailable: inputs.lengthGrowthRateMmPerYear > 0,
    horizonYears,
    iliDate: config.iliDate,
    service: config.serviceLife ?? EMPTY_SERVICE_LIFE,
    // Same rejection line as the table this drawer was opened from.
    depthLimitRatio: screening.depthRejectionPct / 100,
  });

  const result = displayed.result;
  const outsideDomain = result.beyondDepthLimit || !result.valid;
  return {
    depthPct: result.depthPct,
    lengthMm: displayed.lengthMm,
    failurePressureMpa: result.failurePressureMpa,
    safePressureMpa: result.safePressureMpa,
    erf: result.erf,
    capacityMarginMpa: result.safePressureMpa - inputs.requiredPressureMpa,
    severity: outsideDomain ? 'fail' : severityOf(result.erf, result.depthPct, screening),
    beyondDepthLimit: result.beyondDepthLimit,
    valid: result.valid,
    invalidReason: result.invalidReason,
    limitYears: remnant.years,
    limitStatus: remnant.status,
    limitCriterion: remnant.governingLimit,
    analysisHorizonYears: horizonYears,
  };
}
