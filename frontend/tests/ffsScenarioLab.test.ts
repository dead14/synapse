import test from 'node:test';
import assert from 'node:assert/strict';

import { processRow } from '../src/lib/ffs/calcEngine.ts';
import {
  evaluateFfsScenario,
  scenarioInputsForPreset,
} from '../src/lib/ffs/scenarioLab.ts';
import { screenResults } from '../src/lib/ffs/screening.ts';
import {
  DEFAULT_SCREENING_CONFIG,
  type FfsConfig,
  type FfsScreeningConfig,
} from '../src/lib/ffs/types.ts';

const config: FfsConfig = {
  lineName: 'Scenario test line',
  method: 'modified',
  modifiedSa: 'smys69',
  iliDate: new Date('2024-01-01'),
  highlightYears: 5,
  analysisHorizonYears: 30,
};

const screening: FfsScreeningConfig = {
  ...DEFAULT_SCREENING_CONFIG,
  depthTolerancePct: 10,
  lengthToleranceMm: 10,
  forecastYears: 5,
};

function nominal() {
  return processRow({
    'LD [m]': '100',
    Section: 'Sec A',
    Surface: 'External',
    'Max Depth [%]': '40',
    'Length [mm]': '50',
    'Width [mm]': '80',
    'Orient. (hrs:mins)': '6:00',
    'Nominal Wall Thickness [mm]': '9.3',
    'CR Depth [mm/y]': '0.1',
    'CR Length [mm/y]': '1',
    'Design Factor': '0.72',
    'Outer Diameter Ds': '508',
    'SMYS [MPa]': '390',
    'Operating Pressure P₀ [MPa]': '9.46',
  }, config);
}

function assertClose(actual: number, expected: number, tolerance = 1e-4) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

test('as-reported scenario reproduces the locked nominal calculation', () => {
  const result = nominal();
  const inputs = scenarioInputsForPreset('as-reported', result, screening);
  const scenario = evaluateFfsScenario(result, config, screening, inputs);

  assert.equal(inputs.applyConfiguredTolerance, false);
  assert.equal(inputs.forecastYears, 0);
  assert.equal(scenario.depthPct, result.maxDepthPct);
  assert.equal(scenario.lengthMm, result.length);
  assertClose(scenario.failurePressureMpa, result.Pf);
  assertClose(scenario.safePressureMpa, result.safePressure);
  assertClose(scenario.erf, result.ERF);
  assert.equal(scenario.limitStatus, result.remnantLife.status);
  assert.equal(scenario.limitCriterion, result.remnantLife.governingLimit);
  assertClose(scenario.limitYears ?? -1, result.remnantLife.years ?? -1, 0.01);
});

test('as-reported does not inherit a uniform screening growth assumption', () => {
  const result = nominal();
  const uniformScreening: FfsScreeningConfig = {
    ...screening,
    growthBasis: 'uniform',
    growthRateMmPerYear: 0.5,
  };
  const asReportedInputs = scenarioInputsForPreset('as-reported', result, uniformScreening);
  const forecastInputs = scenarioInputsForPreset('forecast', result, uniformScreening);
  const asReported = evaluateFfsScenario(result, config, uniformScreening, asReportedInputs);

  assert.equal(asReportedInputs.depthGrowthRateMmPerYear, result.crDepthSource);
  assert.equal(forecastInputs.depthGrowthRateMmPerYear, 0.5);
  assert.equal(asReported.limitStatus, result.remnantLife.status);
  assertClose(asReported.limitYears ?? -1, result.remnantLife.years ?? -1, 0.01);
});

test('conservative and forecast presets apply the configured screening basis', () => {
  const result = nominal();
  const screened = screenResults([result], config, screening)[0];
  const conservativeInputs = scenarioInputsForPreset('conservative', result, screening);
  const conservative = evaluateFfsScenario(result, config, screening, conservativeInputs);
  const forecastInputs = scenarioInputsForPreset('forecast', result, screening);
  const forecast = evaluateFfsScenario(result, config, screening, forecastInputs);

  assert.equal(conservativeInputs.applyConfiguredTolerance, true);
  assert.equal(conservative.depthPct, 50);
  assert.equal(conservative.lengthMm, 70);
  assertClose(conservative.failurePressureMpa, screened.conservative.Pf, 1e-10);
  assertClose(conservative.safePressureMpa, screened.conservative.safePressure, 1e-10);
  assertClose(conservative.erf, screened.conservative.ERF, 1e-10);
  assert.equal(forecastInputs.forecastYears, 5);
  assertClose(forecast.depthPct, 50 + (0.1 * 5 / 9.3) * 100);
  assert.equal(forecast.lengthMm, 75);
  assertClose(forecast.failurePressureMpa, screened.forecast.Pf, 1e-10);
  assertClose(forecast.safePressureMpa, screened.forecast.safePressure, 1e-10);
  assertClose(forecast.erf, screened.forecast.ERF, 1e-10);
  assert.ok(forecast.erf > conservative.erf);

  assert.equal(result.maxDepthPct, 40, 'scenario evaluation must not mutate the official result');
  assert.equal(result.length, 50, 'scenario evaluation must not mutate source geometry');
});

test('required pressure changes ERF but not the B31G pressure capacity', () => {
  const result = nominal();
  const baseInputs = scenarioInputsForPreset('as-reported', result, screening);
  const base = evaluateFfsScenario(result, config, screening, baseInputs);
  const raised = evaluateFfsScenario(result, config, screening, {
    ...baseInputs,
    requiredPressureMpa: baseInputs.requiredPressureMpa * 1.25,
  });

  assertClose(raised.failurePressureMpa, base.failurePressureMpa, 1e-10);
  assertClose(raised.safePressureMpa, base.safePressureMpa, 1e-10);
  assertClose(raised.erf, base.erf * 1.25, 1e-10);
  assert.ok(raised.capacityMarginMpa < base.capacityMarginMpa);
});

test('scenario life remains bounded by the configured analysis horizon', () => {
  const result = nominal();
  const baseInputs = scenarioInputsForPreset('as-reported', result, screening);
  const stationary = evaluateFfsScenario(result, config, screening, {
    ...baseInputs,
    depthGrowthRateMmPerYear: 0,
    lengthGrowthRateMmPerYear: 0,
  });
  const fast = evaluateFfsScenario(result, config, screening, {
    ...baseInputs,
    depthGrowthRateMmPerYear: 0.5,
  });

  assert.equal(stationary.limitStatus, 'insufficient-growth-basis');
  assert.equal(stationary.limitYears, null);
  assert.equal(fast.limitStatus, 'calculated');
  assert.ok(
    fast.limitYears !== null && fast.limitYears <= result.remnantLife.analysisHorizonYears,
  );
});

test('forecast preset is bounded when the screening forecast exceeds the analysis horizon', () => {
  const result = nominal();
  const longForecast = { ...screening, forecastYears: 50 };
  const inputs = scenarioInputsForPreset('forecast', result, longForecast);

  assert.equal(inputs.forecastYears, result.remnantLife.analysisHorizonYears);
  assert.doesNotThrow(() => evaluateFfsScenario(result, config, longForecast, inputs));
});

test('a projection outside the B31G depth domain cannot be presented as pass', () => {
  const result = nominal();
  const permissiveScreening = { ...screening, depthRejectionPct: 95 };
  const inputs = scenarioInputsForPreset('as-reported', result, permissiveScreening);
  const outsideDomain = evaluateFfsScenario(result, config, permissiveScreening, {
    ...inputs,
    forecastYears: 10,
    depthGrowthRateMmPerYear: 0.4,
  });

  assert.ok(outsideDomain.depthPct > 80 && outsideDomain.depthPct < 95);
  assert.equal(outsideDomain.beyondDepthLimit, true);
  assert.equal(outsideDomain.severity, 'fail');
});

test('invalid scenario assumptions are rejected instead of silently clamped', () => {
  const result = nominal();
  const inputs = scenarioInputsForPreset('as-reported', result, screening);

  assert.throws(
    () => evaluateFfsScenario(result, config, screening, { ...inputs, requiredPressureMpa: 0 }),
    /required pressure/i,
  );
  assert.throws(
    () => evaluateFfsScenario(result, config, screening, { ...inputs, depthGrowthRateMmPerYear: -0.1 }),
    /depth growth rate/i,
  );
  assert.throws(
    () => evaluateFfsScenario(result, config, screening, { ...inputs, forecastYears: 31 }),
    /analysis horizon/i,
  );
});
