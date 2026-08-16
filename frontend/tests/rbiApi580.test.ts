import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addYearsIso,
  categoryFromDepth,
  categoryFromErf,
  categoryFromRemainingLife,
  consequenceOf,
  inspectionIntervalYears,
  riskLevelOf,
  MAX_INTERVAL_YEARS,
  RISK_MATRIX,
} from '../src/lib/rbi/api580.ts';
import { buildRbiAssessment } from '../src/lib/rbi/fromFfs.ts';
import { screenResults } from '../src/lib/ffs/screening.ts';
import { processRow } from '../src/lib/ffs/calcEngine.ts';
import { DEFAULT_SCREENING_CONFIG, type FfsConfig } from '../src/lib/ffs/types.ts';
import type { RevivedFfsShareState } from '../src/lib/ffs/shareState.ts';
import type { RbiConsequenceInput } from '../src/lib/rbi/types.ts';

const config: FfsConfig = {
  lineName: 'HU CPA 20in',
  method: 'modified',
  modifiedSa: 'smys69',
  iliDate: new Date(2024, 6, 14),
  highlightYears: 5,
  depthRejectionPct: 80,
};

const consequence: RbiConsequenceInput = {
  fluid: 'crude-oil',
  population: 'rural',
  environment: 'moderate',
  businessImpact: 'moderate',
  outerDiameterMm: 508,
  operatingPressureMpa: 6,
};

function ffsRow(overrides: Record<string, string> = {}) {
  return {
    'Feature ID': 'A-1',
    'LD [m]': '1000',
    Section: 'Line pipe',
    Surface: 'External',
    'Max Depth [%]': '30',
    'Length [mm]': '80',
    'Width [mm]': '25',
    'Orient. (hrs:mins)': '6:00',
    'Nominal Wall Thickness [mm]': '12.7',
    'CR Depth [mm/y]': '0.1',
    'CR Length [mm/y]': '0',
    'Design Factor': '0.72',
    'Outer Diameter Ds': '508',
    'SMYS [MPa]': '359',
    'Operating Pressure P₀ [MPa]': '6',
    ...overrides,
  };
}

function caseWith(rows: Record<string, string>[], rejected: RevivedFfsShareState['alignmentImport'] extends undefined ? never : unknown[] = []) {
  const results = rows.map((row) => processRow(row, config));
  const state: RevivedFfsShareState = {
    results,
    config,
    screening: DEFAULT_SCREENING_CONFIG,
    alignmentImport: {
      sessionId: '12',
      scope: 'all',
      accepted: [],
      rejected: rejected as never,
      girthWelds: [],
      census: [],
      warningCount: 0,
    },
    review: { repairOverrides: {}, spoolDispositions: {} },
  };
  return { state, screened: screenResults(results, config, DEFAULT_SCREENING_CONFIG) };
}

test('likelihood bands follow the measured evidence, worst driver first', () => {
  assert.equal(categoryFromErf(1.2), 5);
  assert.equal(categoryFromErf(0.95), 4);
  assert.equal(categoryFromErf(0.3), 1);

  assert.equal(categoryFromRemainingLife(0.5), 5);
  assert.equal(categoryFromRemainingLife(30), 1);
  // No life figure is an unknown likelihood, not a low one — otherwise a feature
  // with no growth basis outranks one with a measured 30-year life.
  assert.equal(categoryFromRemainingLife(null), 3);

  assert.equal(categoryFromDepth(85), 5);
  assert.equal(categoryFromDepth(10), 1);
  assert.equal(categoryFromDepth(null), 1);
});

test('a consequence-5 component is never low, however unlikely a failure is', () => {
  for (let likelihood = 1; likelihood <= 5; likelihood += 1) {
    assert.notEqual(riskLevelOf(likelihood as 1, 5), 'Low');
  }
  assert.equal(RISK_MATRIX.length, 5);
  assert.ok(RISK_MATRIX.every((row) => row.length === 5));
});

test('consequence takes the worst stated class and raises it for a large, high-pressure line', () => {
  const small = consequenceOf({ ...consequence, outerDiameterMm: 168, operatingPressureMpa: 2 });
  const large = consequenceOf({ ...consequence, outerDiameterMm: 762, operatingPressureMpa: 8 });

  assert.equal(small.category, 4, 'crude oil alone carries a category 4 consequence');
  assert.equal(large.category, 5, 'bore × pressure at or above 3 m·MPa raises it one');
  assert.ok(large.drivers.some((driver) => driver.id === 'release-scale' && driver.category === 2));

  // Sour gas in an urban area is the worst case and cannot be diluted by a low
  // business impact.
  const worst = consequenceOf({
    ...consequence, fluid: 'sour-gas', population: 'urban', businessImpact: 'low',
  });
  assert.equal(worst.category, 5);
});

test('the inspection interval is half the remaining life, capped by risk', () => {
  // 6 years of life at medium risk: half-life governs.
  assert.deepEqual(inspectionIntervalYears('Medium', 6), {
    intervalYears: 3, basis: 'half-remaining-life',
  });
  // 40 years of life at high risk: the risk cap governs.
  assert.deepEqual(inspectionIntervalYears('High', 40), {
    intervalYears: MAX_INTERVAL_YEARS.High, basis: 'risk-target-interval',
  });
  // No life figure: the cap is a target, and the basis says so rather than
  // presenting it as a calculated interval.
  assert.deepEqual(inspectionIntervalYears('Low', null), {
    intervalYears: MAX_INTERVAL_YEARS.Low, basis: 'risk-target-interval',
  });
  // Exhausted life is not an inspection problem.
  assert.deepEqual(inspectionIntervalYears('High', 0), {
    intervalYears: 0, basis: 'immediate-action',
  });
});

test('due dates count from the inspection the assessment was built on', () => {
  assert.equal(addYearsIso('2024-07-14', 3), '2027-07-14');
  // A fractional year is 365.25 days, so half a year is 183 days.
  assert.equal(addYearsIso('2024-07-14', 0.5), '2025-01-13');
  assert.equal(addYearsIso('not-a-date', 1), null);
});

test('the assessment is built per section, worst feature governing', () => {
  const { state, screened } = caseWith([
    ffsRow({ 'Feature ID': 'A-1', Section: 'Line pipe', 'Max Depth [%]': '20' }),
    ffsRow({ 'Feature ID': 'A-2', Section: 'Line pipe', 'Max Depth [%]': '72', 'LD [m]': '1100' }),
    ffsRow({ 'Feature ID': 'B-1', Section: 'River crossing', 'Max Depth [%]': '15', 'LD [m]': '5000' }),
  ]);

  const assessment = buildRbiAssessment({ ffsSessionId: '9', state, screened, consequence });

  assert.equal(assessment.units.length, 2);
  const linePipe = assessment.units.find((unit) => unit.label === 'Line pipe');
  assert.ok(linePipe);
  assert.equal(linePipe?.featureCount, 2);
  // The deepest feature governs; an average would bury it in the healthy ones.
  assert.equal(linePipe?.governingFeature?.featureId, 'A-2');
  assert.equal(linePipe?.likelihood.drivers.find((driver) => driver.id === 'depth')?.value, 72);
  assert.equal(linePipe?.fromM, 1000);
  assert.equal(linePipe?.toM, 1100);
  // Highest risk is listed first, which is what a ranking is for.
  assert.ok(assessment.units[0].riskLevel !== 'Low' || assessment.units.length === 1);
});

test('anomalies with no B31G result are carried into the plan, not ignored', () => {
  const { state, screened } = caseWith(
    [ffsRow()],
    [{ featureId: 'X-9', sourceKey: 'new:9', ldM: 2000, depthPct: null, reason: 'Missing or invalid measured field(s): Depth NEW (%WT).' }],
  );

  const assessment = buildRbiAssessment({ ffsSessionId: '9', state, screened, consequence });

  assert.equal(assessment.totals.unassessed, 1);
  const unsectioned = assessment.units.find((unit) => unit.label === 'Unsectioned');
  assert.ok(unsectioned, 'an unassessed anomaly still belongs to the line');
  assert.equal(unsectioned?.likelihood.unassessedCount, 1);
  // A unit with no measured features is scored in the middle of the scale, and
  // its recommendation says the evidence is missing rather than implying safety.
  assert.equal(unsectioned?.likelihood.category, 3);
  assert.match(unsectioned?.inspection.recommendation ?? '', /no B31G result/i);
});

test('the assessment states its practice, its rules, and what it does not cover', () => {
  const { state, screened } = caseWith([ffsRow()]);
  const assessment = buildRbiAssessment({ ffsSessionId: '9', state, screened, consequence });

  assert.equal(assessment.provenance.practice, 'API 580');
  assert.equal(assessment.provenance.approach, 'semi-quantitative');
  assert.ok(assessment.provenance.rules.length >= 4);
  assert.ok(assessment.provenance.limitations.some((limit) => /API 581/.test(limit)));
  assert.ok(assessment.provenance.limitations.some((limit) => /crack/i.test(limit)));
  assert.equal(assessment.assessmentDateIso, '2024-07-14');
});
