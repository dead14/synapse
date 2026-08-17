import assert from 'node:assert/strict';
import test from 'node:test';

import { processRow } from '../src/lib/ffs/calcEngine.ts';
import { screenResults, growthApplicationFor } from '../src/lib/ffs/screening.ts';
import {
  buildGrowthResolutionContext,
  percentileOf,
  serviceAgeYears,
  POPULATION_RATE_PERCENTILE,
} from '../src/lib/ffs/growthResolution.ts';
import { buildFfsReportCase, type FfsReportContext } from '../src/lib/ffs/reportCase.ts';
import { formatRemnantLife } from '../src/lib/ffs/lifeProjection.ts';
import {
  DEFAULT_SCREENING_CONFIG,
  type FfsConfig,
  type FfsResult,
  type FfsScreeningConfig,
} from '../src/lib/ffs/types.ts';

/**
 * Every corroding feature carries a remnant life.
 *
 * The run pair measures some of them. For the rest — NEW-only anomalies, merged
 * clusters, pairs reporting an apparent decrease — the assessment derives a rate
 * and says so. What it must never do is report "Not calculated" beside a defect
 * at 60 %WT, which is what a rate of zero used to produce.
 */

const config: FfsConfig = {
  lineName: 'Growth resolution line',
  method: 'modified',
  modifiedSa: 'smys69',
  iliDate: new Date('2024-08-23'),
  highlightYears: 5,
  analysisHorizonYears: 30,
};

const reportContext: FfsReportContext = {
  inspectionDateIso: '2024-08-23',
  asOfDateIso: '2026-08-03',
  reviewThresholdYears: 5,
};

function row(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    'Feature ID': 'F-001',
    'LD [m]': '100',
    Section: 'Sec A',
    Surface: 'External',
    'Max Depth [%]': '44',
    'Length [mm]': '40',
    'Width [mm]': '54',
    'Orient. (hrs:mins)': '6:00',
    'Nominal Wall Thickness [mm]': '9.3',
    'CR Depth [mm/y]': '0.2',
    'CR Length [mm/y]': '0',
    'Design Factor': '0.72',
    'Outer Diameter Ds': '508',
    'SMYS [MPa]': '359',
    'Operating Pressure P₀ [MPa]': '6.5',
    ...overrides,
  };
}

/** A feature the run pair could not measure: the rate is absent, not zero. */
function unmeasured(overrides: Record<string, string> = {}): FfsResult {
  const result = processRow(row({ 'CR Depth [mm/y]': '0', 'CR Length [mm/y]': '0', ...overrides }), config);
  result.growthEvidence = {
    oldSurveyYear: null,
    newSurveyYear: null,
    intervalYears: null,
    depth: {
      observation: 'unavailable',
      analysisBasis: 'none',
      rawRateMmPerYear: null,
      analysisRateMmPerYear: null,
      formula: null,
      note: 'The run pair did not measure this feature.',
    },
    length: {
      observation: 'unavailable',
      analysisBasis: 'none',
      rawRateMmPerYear: null,
      analysisRateMmPerYear: null,
      formula: null,
      note: 'No length rate.',
    },
  };
  return result;
}

/* ── The service-age step ──────────────────────────────────────────────── */

test('service age is measured from 1 January of the commissioning year', () => {
  const age = serviceAgeYears(2000, new Date('2024-08-23'));
  assert.ok(age !== null);
  assert.ok(Math.abs(age! - 24.64) < 0.02, `age ${age}`);
  // An inspection before commissioning establishes no age at all.
  assert.equal(serviceAgeYears(2030, new Date('2024-08-23')), null);
  assert.equal(serviceAgeYears(null, new Date('2024-08-23')), null);
});

test('an unmeasured feature is projected from its own metal loss over the service age', () => {
  const withCommissioning: FfsConfig = {
    ...config,
    serviceLife: { designLifeYears: null, commissioningYear: 2000 },
  };
  const item = screenResults([unmeasured()], withCommissioning, DEFAULT_SCREENING_CONFIG)[0];
  const life = item.nominal.remnantLife;

  // 44 %WT of 9.30 mm is 4.092 mm, over 24.64 y of service: 0.1661 mm/y.
  assert.equal(item.nominal.growthEvidence?.depth.analysisBasis, 'service-age');
  assert.ok(Math.abs(life.depthRateMmPerYear - 0.1661) < 0.001, `rate ${life.depthRateMmPerYear}`);
  assert.equal(life.status, 'calculated');
  // (0.80 − 0.44) × 9.30 / 0.1661 = 20.2 y to the depth line.
  assert.ok(Math.abs(life.depthLimitYears! - 20.16) < 0.15, `years ${life.depthLimitYears}`);
  assert.match(life.dueDateIso ?? '', /^\d{4}-\d{2}-\d{2}$/);
});

test('the derivation moves the analysis basis but never the source observation', () => {
  const withCommissioning: FfsConfig = {
    ...config,
    serviceLife: { designLifeYears: null, commissioningYear: 2000 },
  };
  const item = screenResults([unmeasured()], withCommissioning, DEFAULT_SCREENING_CONFIG)[0];
  const evidence = item.nominal.growthEvidence!.depth;

  // The run pair still did not measure this feature, and no derivation changes
  // that. Only what the projection consumed moves.
  assert.equal(evidence.observation, 'unavailable');
  assert.equal(evidence.analysisBasis, 'service-age');
  assert.ok(evidence.note.startsWith('Derived:'), evidence.note);
  assert.match(evidence.formula ?? '', /since 2000/);
  // The source column is untouched: a derived rate is not a measurement.
  assert.equal(item.nominal.crDepth, 0);
});

/* ── The population step ───────────────────────────────────────────────── */

test('percentileOf interpolates and survives a one-value sample', () => {
  assert.equal(percentileOf([], 0.95), null);
  assert.equal(percentileOf([0.4], 0.95), 0.4);
  assert.equal(percentileOf([0, 1], 0.5), 0.5);
  assert.equal(percentileOf([0, 10, 20, 30, 40], 0.5), 20);
});

test('without a service age an unmeasured feature takes the rate of its measured neighbours', () => {
  const population = [
    processRow(row({ 'Feature ID': 'M1', 'LD [m]': '10', 'CR Depth [mm/y]': '0.10' }), config),
    processRow(row({ 'Feature ID': 'M2', 'LD [m]': '20', 'CR Depth [mm/y]': '0.20' }), config),
    processRow(row({ 'Feature ID': 'M3', 'LD [m]': '30', 'CR Depth [mm/y]': '0.30' }), config),
    unmeasured({ 'Feature ID': 'U1', 'LD [m]': '40' }),
  ];
  const items = screenResults(population, config, DEFAULT_SCREENING_CONFIG);
  const derived = items.find((item) => item.nominal.featureId === 'U1')!;

  assert.equal(derived.nominal.growthEvidence?.depth.analysisBasis, 'population-percentile');
  // P95 of {0.10, 0.20, 0.30} interpolates to 0.29.
  assert.ok(
    Math.abs(derived.nominal.remnantLife.depthRateMmPerYear - 0.29) < 0.001,
    `rate ${derived.nominal.remnantLife.depthRateMmPerYear}`,
  );
  assert.equal(derived.nominal.remnantLife.status, 'calculated');
  assert.equal(POPULATION_RATE_PERCENTILE, 0.95);
});

test('the population statistic is drawn from measured features only', () => {
  const population = [
    processRow(row({ 'Feature ID': 'M1', 'LD [m]': '10', 'CR Depth [mm/y]': '0.30' }), config),
    unmeasured({ 'Feature ID': 'U1', 'LD [m]': '20' }),
    unmeasured({ 'Feature ID': 'U2', 'LD [m]': '30' }),
  ];
  const context = buildGrowthResolutionContext(population, config);

  // Two of the three carry no rate; a derived rate must never feed the sample
  // it was itself derived from.
  assert.equal(context.measuredSampleCount, 1);
  assert.equal(context.populationRate, 0.3);
});

test('a section with too few measured features falls back to the whole line', () => {
  const population = [
    processRow(row({ 'Feature ID': 'A1', 'LD [m]': '10', Section: 'Sec A', 'CR Depth [mm/y]': '0.10' }), config),
    processRow(row({ 'Feature ID': 'A2', 'LD [m]': '20', Section: 'Sec A', 'CR Depth [mm/y]': '0.20' }), config),
    processRow(row({ 'Feature ID': 'A3', 'LD [m]': '30', Section: 'Sec A', 'CR Depth [mm/y]': '0.30' }), config),
    processRow(row({ 'Feature ID': 'B1', 'LD [m]': '40', Section: 'Sec B', 'CR Depth [mm/y]': '0.90' }), config),
  ];
  const context = buildGrowthResolutionContext(population, config);

  assert.ok(context.sectionRates.has('sec a|external'), 'three samples is enough for a section rate');
  assert.ok(!context.sectionRates.has('sec b|external'), 'one sample is not a percentile');
});

/* ── The ladder's order ────────────────────────────────────────────────── */

test('a measured rate is never replaced by a derived one', () => {
  const withCommissioning: FfsConfig = {
    ...config,
    serviceLife: { designLifeYears: null, commissioningYear: 1980 },
  };
  const measured = processRow(row({ 'CR Depth [mm/y]': '0.4' }), withCommissioning);
  const item = screenResults([measured], withCommissioning, DEFAULT_SCREENING_CONFIG)[0];

  assert.equal(item.nominal.remnantLife.depthRateMmPerYear, 0.4);
  assert.equal(item.nominal.growthEvidence?.depth.analysisBasis, 'reported');
});

test('an engineer-entered fallback outranks both derivations', () => {
  const withCommissioning: FfsConfig = {
    ...config,
    serviceLife: { designLifeYears: null, commissioningYear: 1980 },
  };
  const screening: FfsScreeningConfig = { ...DEFAULT_SCREENING_CONFIG, growthRateMmPerYear: 0.75 };
  const item = screenResults([unmeasured()], withCommissioning, screening)[0];

  assert.equal(item.nominal.remnantLife.depthRateMmPerYear, 0.75);
  assert.equal(item.forecast.growthAnalysisBasis, 'explicit-fallback');
});

test('the uniform basis overrides every step of the ladder, derivations included', () => {
  const withCommissioning: FfsConfig = {
    ...config,
    serviceLife: { designLifeYears: null, commissioningYear: 1980 },
  };
  const screening: FfsScreeningConfig = {
    ...DEFAULT_SCREENING_CONFIG,
    growthBasis: 'uniform',
    growthRateMmPerYear: 0.05,
  };
  const item = screenResults([unmeasured()], withCommissioning, screening)[0];

  assert.equal(item.nominal.remnantLife.depthRateMmPerYear, 0.05);
  assert.equal(item.forecast.growthAnalysisBasis, 'uniform-assumption');
});

test('the derivation can be switched off, and then the feature reports no life', () => {
  const withCommissioning: FfsConfig = {
    ...config,
    serviceLife: { designLifeYears: null, commissioningYear: 1980 },
  };
  const strict: FfsScreeningConfig = { ...DEFAULT_SCREENING_CONFIG, deriveMissingGrowthRates: false };
  const item = screenResults([unmeasured()], withCommissioning, strict)[0];

  assert.equal(item.nominal.remnantLife.status, 'insufficient-growth-basis');
  assert.equal(item.nominal.remnantLife.years, null);
});

test('a reported zero is still a measurement and is left alone', () => {
  // The row's own column says zero, and nothing in the ladder may overwrite what
  // the source actually reported.
  const withCommissioning: FfsConfig = {
    ...config,
    serviceLife: { designLifeYears: null, commissioningYear: 1980 },
  };
  const item = screenResults(
    [processRow(row({ 'CR Depth [mm/y]': '0', 'CR Length [mm/y]': '0' }), withCommissioning)],
    withCommissioning,
    DEFAULT_SCREENING_CONFIG,
  )[0];

  assert.equal(item.forecast.growthRateMmPerYear, 0);
  assert.equal(item.forecast.growthAnalysisBasis, 'reported');
});

/* ── What the report has to show ───────────────────────────────────────── */

test('a mixed population leaves no feature without a projected life', () => {
  // The guarantee is that every feature is projected: either a figure, or the
  // horizon it outlasts. "Not calculated" — the answer for a feature nobody
  // could put a rate on — must not appear at all.
  const withCommissioning: FfsConfig = {
    ...config,
    serviceLife: { designLifeYears: null, commissioningYear: 2005 },
  };
  const population = [
    processRow(row({ 'Feature ID': 'MEASURED', 'LD [m]': '10', 'CR Depth [mm/y]': '0.25' }), withCommissioning),
    unmeasured({ 'Feature ID': 'NEW-ONLY', 'LD [m]': '20', 'Max Depth [%]': '52' }),
    unmeasured({ 'Feature ID': 'CLUSTER', 'LD [m]': '30', 'Max Depth [%]': '31' }),
    unmeasured({ 'Feature ID': 'DECREASE', 'LD [m]': '40', 'Max Depth [%]': '68' }),
  ];
  const items = screenResults(population, withCommissioning, DEFAULT_SCREENING_CONFIG);

  for (const item of items) {
    const life = item.nominal.remnantLife;
    assert.notEqual(
      life.status,
      'insufficient-growth-basis',
      `${item.nominal.featureId} must carry a growth basis`,
    );
    assert.ok(life.depthRateMmPerYear > 0, `${item.nominal.featureId} must carry a positive rate`);
    assert.notEqual(formatRemnantLife(life), 'Not calculated');
  }

  // Three of the four resolve to a dated limit inside the 30-year horizon; the
  // shallowest reads as the bound it outlasts, which is still a life statement.
  const cluster = items.find((item) => item.nominal.featureId === 'CLUSTER')!;
  assert.equal(cluster.nominal.remnantLife.status, 'not-reached-within-horizon');
  assert.equal(formatRemnantLife(cluster.nominal.remnantLife), '> 30 y');
  // Raising the horizon resolves it to a figure — the bound was the search, not
  // the data.
  const wider = screenResults(
    population,
    { ...withCommissioning, analysisHorizonYears: 60 },
    DEFAULT_SCREENING_CONFIG,
  ).find((item) => item.nominal.featureId === 'CLUSTER')!;
  assert.equal(wider.nominal.remnantLife.status, 'calculated');
  assert.ok(Math.abs(wider.nominal.remnantLife.years! - 31.0) < 0.5);
});

test('every derived rate is raised as a readiness finding', () => {
  const withCommissioning: FfsConfig = {
    ...config,
    serviceLife: { designLifeYears: null, commissioningYear: 2005 },
  };
  const items = screenResults(
    [unmeasured({ 'Feature ID': 'U1' }), unmeasured({ 'Feature ID': 'U2', 'LD [m]': '200' })],
    withCommissioning,
    DEFAULT_SCREENING_CONFIG,
  );
  const reportCase = buildFfsReportCase(items, reportContext);
  const derivedFinding = reportCase.readiness.findings.find(
    (item) => item.code === 'GROWTH_RATE_DERIVED_FROM_SERVICE_AGE',
  );

  assert.ok(derivedFinding, 'a derived rate must never travel undisclosed');
  assert.equal(derivedFinding!.affectedCount, 2);
});

test('both remnant-life columns are projected from the same resolved rate', () => {
  // The as-reported figure used to come from the row and the tolerance-adjusted
  // one from this layer, so a derived or uniform rate moved one and not the
  // other. They are one calculation under two assumptions, or they are nothing.
  const withCommissioning: FfsConfig = {
    ...config,
    serviceLife: { designLifeYears: null, commissioningYear: 2005 },
  };
  const item = screenResults([unmeasured()], withCommissioning, DEFAULT_SCREENING_CONFIG)[0];

  assert.equal(
    item.nominal.remnantLife.depthRateMmPerYear,
    item.remnantLifeConservative.depthRateMmPerYear,
  );
  assert.ok(
    item.remnantLifeConservative.years! <= item.nominal.remnantLife.years!,
    'the tolerance-adjusted life cannot outlast the as-reported one on the same rate',
  );
});

test('a rate resolved without population context keeps the historical behaviour', () => {
  // Every caller that does not pass a resolution context must see exactly what
  // it saw before the ladder existed.
  const application = growthApplicationFor(unmeasured(), DEFAULT_SCREENING_CONFIG);
  assert.equal(application.rateMmPerYear, 0);
  assert.equal(application.analysisBasis, 'none');
  assert.equal(application.derived, null);
});
