import { B31G_DEPTH_LIMIT_RATIO, evaluateB31g, type B31gGeometry } from './b31g.ts';
import { analysisHorizonYears } from './lifeProjection.ts';
import { growthRateFor, severityOf } from './screening.ts';
import type {
  FfsConfig,
  FfsFailureCriterion,
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
  limitCriterion: FfsFailureCriterion | null;
  analysisHorizonYears: number;
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
    designFactor: nominal.df,
    operatingPressureMpa: requiredPressureMpa,
  };
}

export function scenarioInputsForPreset(
  preset: FfsScenarioPreset,
  nominal: FfsResult,
  screening: FfsScreeningConfig,
): FfsScenarioInputs {
  const common = {
    requiredPressureMpa: nominal.p0,
    depthGrowthRateMmPerYear: growthRateFor(nominal, screening),
    lengthGrowthRateMmPerYear: Math.max(0, nominal.crLength),
  };

  if (preset === 'as-reported') {
    return {
      ...common,
      forecastYears: 0,
      applyConfiguredTolerance: false,
    };
  }
  if (preset === 'conservative') {
    return {
      ...common,
      forecastYears: 0,
      applyConfiguredTolerance: true,
    };
  }
  return {
    ...common,
    forecastYears: screening.forecastYears,
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
  const atStart = evaluateAtYear(0).result;
  const hasPositiveGrowth = inputs.depthGrowthRateMmPerYear > 0 || inputs.lengthGrowthRateMmPerYear > 0;

  let depthLimitYears = Number.POSITIVE_INFINITY;
  if (baseDepthMm >= B31G_DEPTH_LIMIT_RATIO * nominal.wall) {
    depthLimitYears = 0;
  } else if (inputs.depthGrowthRateMmPerYear > 0) {
    depthLimitYears = (
      B31G_DEPTH_LIMIT_RATIO * nominal.wall - baseDepthMm
    ) / inputs.depthGrowthRateMmPerYear;
  }

  let erfLimitYears = Number.POSITIVE_INFINITY;
  if (atStart.erf >= 1) {
    erfLimitYears = 0;
  } else if (hasPositiveGrowth && evaluateAtYear(horizonYears).result.erf >= 1) {
    let lo = 0;
    let hi = horizonYears;
    for (let iteration = 0; iteration < 60; iteration += 1) {
      const mid = (lo + hi) / 2;
      if (evaluateAtYear(mid).result.erf >= 1) hi = mid;
      else lo = mid;
    }
    erfLimitYears = hi;
  }

  const firstLimitYears = Math.min(depthLimitYears, erfLimitYears);
  let limitYears: number | null = null;
  let limitStatus: FfsLifeStatus;
  let limitCriterion: FfsFailureCriterion | null = null;

  if (firstLimitYears <= horizonYears) {
    limitYears = Math.round(firstLimitYears * 100) / 100;
    limitStatus = 'calculated';
    limitCriterion = depthLimitYears <= erfLimitYears ? 'Depth = 80%' : 'ERF = 1';
  } else if (!hasPositiveGrowth) {
    limitStatus = 'insufficient-growth-basis';
  } else {
    limitStatus = 'not-reached-within-horizon';
  }

  const result = displayed.result;
  return {
    depthPct: result.depthPct,
    lengthMm: displayed.lengthMm,
    failurePressureMpa: result.failurePressureMpa,
    safePressureMpa: result.safePressureMpa,
    erf: result.erf,
    capacityMarginMpa: result.safePressureMpa - inputs.requiredPressureMpa,
    severity: severityOf(result.erf, result.depthPct, screening),
    beyondDepthLimit: result.beyondDepthLimit,
    valid: result.valid,
    invalidReason: result.invalidReason,
    limitYears,
    limitStatus,
    limitCriterion,
    analysisHorizonYears: horizonYears,
  };
}
