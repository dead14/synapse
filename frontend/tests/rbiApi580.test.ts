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
  threatCategory,
  MAX_INTERVAL_YEARS,
  RISK_MATRIX,
} from '../src/lib/rbi/api580.ts';
import { buildRbiAssessment } from '../src/lib/rbi/fromFfs.ts';
import { THREATS } from '../src/lib/rbi/catalogues.ts';
import { emptyRbiRecord, readiness, reviveRbiRecord } from '../src/lib/rbi/record.ts';
import { screenResults } from '../src/lib/ffs/screening.ts';
import { processRow } from '../src/lib/ffs/calcEngine.ts';
import { DEFAULT_SCREENING_CONFIG, type FfsConfig } from '../src/lib/ffs/types.ts';
import type { RevivedFfsShareState } from '../src/lib/ffs/shareState.ts';
import type {
  PipelineFluid,
  PopulationClass,
  RbiRecord,
  ThreatAssessment,
  ThreatId,
} from '../src/lib/rbi/types.ts';

const config: FfsConfig = {
  lineName: 'HU CPA 20in',
  method: 'modified',
  modifiedSa: 'smys69',
  iliDate: new Date(2024, 6, 14),
  highlightYears: 5,
  depthRejectionPct: 80,
};

/** A record with every threat reviewed, so a test says what it means to say. */
function recordWith(patch: Partial<RbiRecord> = {}): RbiRecord {
  const blank = emptyRbiRecord();
  return {
    ...blank,
    ffsSessionId: '9',
    threats: blank.threats.map((threat) => (
      threat.relevance === 'unreviewed' ? { ...threat, relevance: 'not-credible', note: 'Screened out.' } : threat
    )),
    ...patch,
  };
}

function withThreat(record: RbiRecord, id: ThreatId, change: Partial<ThreatAssessment>): RbiRecord {
  return {
    ...record,
    threats: record.threats.map((threat) => (threat.id === id ? { ...threat, ...change } : threat)),
  };
}

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

function caseWith(rows: Record<string, string>[], rejected: unknown[] = []) {
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

/* ── Probability ───────────────────────────────────────────────────────────── */

test('measured probability bands follow the evidence, worst driver first', () => {
  assert.equal(categoryFromErf(1.2), 5);
  assert.equal(categoryFromErf(0.95), 4);
  assert.equal(categoryFromErf(0.3), 1);

  assert.equal(categoryFromRemainingLife(0.5), 5);
  assert.equal(categoryFromRemainingLife(30), 1);
  // No life figure is an unknown probability, not a low one — otherwise a
  // feature with no growth basis outranks one with a measured thirty-year life.
  assert.equal(categoryFromRemainingLife(null), 3);

  assert.equal(categoryFromDepth(85), 5);
  assert.equal(categoryFromDepth(10), 1);
  assert.equal(categoryFromDepth(null), 1);
});

test('a threat is scored from what it is and how well anyone has looked', () => {
  const threat = (change: Partial<ThreatAssessment>): ThreatAssessment => ({
    id: 'scc', relevance: 'possible', coverage: 'partial', note: '', ...change,
  });

  // Active and nobody has looked: the worst combination.
  assert.equal(threatCategory(threat({ relevance: 'active', coverage: 'none' }))?.category, 5);
  // The same threat, inspected with a method that finds it, earns a category back.
  assert.equal(threatCategory(threat({ relevance: 'active', coverage: 'covered' }))?.category, 3);
  // Credible but unseen sits below active.
  assert.equal(threatCategory(threat({ relevance: 'possible', coverage: 'partial' }))?.category, 2);
  assert.equal(threatCategory(threat({ relevance: 'possible', coverage: 'covered' }))?.category, 1);
  // Unreviewed is an unknown, scored in the middle rather than cleared.
  assert.equal(threatCategory(threat({ relevance: 'unreviewed', coverage: 'none' }))?.category, 4);
  // Ruled out contributes nothing.
  assert.equal(threatCategory(threat({ relevance: 'not-credible' })), null);
});

test('a judgement never reaches category 5 without also being uninspected', () => {
  const scored = threatCategory({ id: 'scc', relevance: 'active', coverage: 'partial', note: '' });
  assert.equal(scored?.category, 4);
});

/* ── Consequence ───────────────────────────────────────────────────────────── */

test('a high-consequence section is never low risk, however unlikely failure is', () => {
  for (let probability = 1; probability <= 5; probability += 1) {
    assert.notEqual(riskLevelOf(probability as 1, 5), 'Low');
  }
  assert.equal(RISK_MATRIX.length, 5);
  assert.ok(RISK_MATRIX.every((row) => row.length === 5));
});

test('safety needs both a hazardous fluid and somebody near it', () => {
  const at = (fluid: PipelineFluid, population: PopulationClass, toxic = false) => consequenceOf({
    fluid,
    toxic,
    population,
    environment: 'none',
    businessImpact: 'low',
    outerDiameterMm: 100,
    operatingPressureMpa: 1,
  }).drivers.find((driver) => driver.id === 'safety')?.category;

  // A water main under a city centre is not a catastrophic safety event. It may
  // well be a business or environmental one, which is why the axes are apart.
  assert.equal(at('water', 'urban'), 1);
  // Nor is crude oil forty kilometres from a road — but it is not a 1 either,
  // because somebody has to walk up to it.
  assert.equal(at('crude-oil', 'remote'), 2);
  // The same fluid beside houses is what the ranking is for.
  assert.equal(at('crude-oil', 'suburban'), 4);
  // A toxic release reaches the responder even where nobody lives.
  assert.equal(at('sour-gas', 'remote', true), 3);
  // And a nominally harmless fluid declared toxic is lifted to the same floor.
  assert.equal(at('water', 'suburban', true), 4);
});

test('consequence is the worst of safety, environment and business', () => {
  const base = {
    fluid: 'water' as const,
    toxic: false,
    population: 'remote' as const,
    environment: 'none' as const,
    businessImpact: 'low' as const,
    outerDiameterMm: 100,
    operatingPressureMpa: 1,
  };
  assert.equal(consequenceOf(base).category, 1);
  // A harmless fluid crossing a protected area is still a serious release.
  assert.equal(consequenceOf({ ...base, environment: 'protected' }).category, 5);
  // As is one whose loss stops production with no way around it.
  assert.equal(consequenceOf({ ...base, businessImpact: 'critical' }).category, 5);
});

test('a large high-pressure line raises the consequence by one', () => {
  const base = {
    fluid: 'crude-oil' as const,
    toxic: false,
    population: 'suburban' as const,
    environment: 'soil' as const,
    businessImpact: 'moderate' as const,
  };
  const small = consequenceOf({ ...base, outerDiameterMm: 168, operatingPressureMpa: 2 });
  const large = consequenceOf({ ...base, outerDiameterMm: 762, operatingPressureMpa: 8 });
  assert.equal(small.category, 4);
  assert.equal(large.category, 5);
  assert.ok(large.drivers.some((driver) => driver.id === 'release-scale' && driver.category === 2));
});

/* ── Intervals ─────────────────────────────────────────────────────────────── */

test('the interval is half the remaining life, capped by risk then by the regulator', () => {
  assert.deepEqual(
    inspectionIntervalYears({ riskLevel: 'Medium', remainingLifeYears: 6, regulatoryMaxYears: null }),
    { intervalYears: 3, basis: 'half-remaining-life' },
  );
  assert.deepEqual(
    inspectionIntervalYears({ riskLevel: 'High', remainingLifeYears: 40, regulatoryMaxYears: null }),
    { intervalYears: MAX_INTERVAL_YEARS.High, basis: 'risk-target-interval' },
  );
  // No life figure: the cap is a target, and the basis says so rather than
  // presenting it as a calculated interval.
  assert.deepEqual(
    inspectionIntervalYears({ riskLevel: 'Low', remainingLifeYears: null, regulatoryMaxYears: null }),
    { intervalYears: MAX_INTERVAL_YEARS.Low, basis: 'risk-target-interval' },
  );
  // A shorter regulatory limit wins outright, and is named as the reason.
  assert.deepEqual(
    inspectionIntervalYears({ riskLevel: 'Low', remainingLifeYears: 40, regulatoryMaxYears: 5 }),
    { intervalYears: 5, basis: 'regulatory-limit' },
  );
  // Exhausted life is not an inspection problem.
  assert.deepEqual(
    inspectionIntervalYears({ riskLevel: 'High', remainingLifeYears: 0, regulatoryMaxYears: null }),
    { intervalYears: 0, basis: 'immediate-action' },
  );
});

test('due dates count from the inspection the assessment was built on', () => {
  assert.equal(addYearsIso('2024-07-14', 3), '2027-07-14');
  // A fractional year is 365.25 days, so half a year is 183 days.
  assert.equal(addYearsIso('2024-07-14', 0.5), '2025-01-13');
  assert.equal(addYearsIso('not-a-date', 1), null);
});

/* ── The whole assessment ──────────────────────────────────────────────────── */

test('the assessment is built per section, worst feature governing', () => {
  const { state, screened } = caseWith([
    ffsRow({ 'Feature ID': 'A-1', Section: 'Line pipe', 'Max Depth [%]': '20' }),
    ffsRow({ 'Feature ID': 'A-2', Section: 'Line pipe', 'Max Depth [%]': '72', 'LD [m]': '1100' }),
    ffsRow({ 'Feature ID': 'B-1', Section: 'River crossing', 'Max Depth [%]': '15', 'LD [m]': '5000' }),
  ]);

  const assessment = buildRbiAssessment({ record: recordWith(), state, screened });

  assert.equal(assessment.sections.length, 2);
  const linePipe = assessment.sections.find((section) => section.label === 'Line pipe');
  assert.ok(linePipe);
  assert.equal(linePipe?.featureCount, 2);
  // The deepest feature governs; an average would bury it in the healthy ones.
  assert.equal(linePipe?.governingFeature?.featureId, 'A-2');
  assert.equal(linePipe?.probability.drivers.find((driver) => driver.id === 'depth')?.value, 72);
  assert.equal(linePipe?.fromM, 1000);
  assert.equal(linePipe?.toM, 1100);
  // Highest risk first, which is what a ranking is for.
  assert.ok(assessment.sections[0].riskLevel !== 'Low' || assessment.sections.length === 1);
});

test('a judged threat can drive the probability above the measured metal loss', () => {
  const { state, screened } = caseWith([ffsRow({ 'Max Depth [%]': '15' })]);

  const quiet = buildRbiAssessment({ record: recordWith(), state, screened });
  const measured = quiet.sections[0].probability.category;

  const record = withThreat(recordWith(), 'scc', {
    relevance: 'active',
    coverage: 'none',
    note: 'Colonies found in two excavations on the adjacent section.',
  });
  const loud = buildRbiAssessment({ record, state, screened });

  assert.ok(
    loud.sections[0].probability.category > measured,
    'a metal-loss run says nothing about cracking, so the review has to',
  );
  assert.equal(loud.sections[0].probability.governingThreat, 'Stress corrosion cracking');
});

test('a threat ruled out contributes nothing but stays on the record', () => {
  const { state, screened } = caseWith([ffsRow({ 'Max Depth [%]': '15' })]);
  const record = withThreat(recordWith(), 'weather-outside-force', {
    relevance: 'not-credible',
    note: 'Flat terrain, no watercourse crossings, no seismic history.',
  });

  const assessment = buildRbiAssessment({ record, state, screened });
  assert.ok(!assessment.sections[0].probability.threats.some(
    (threat) => threat.id === 'weather-outside-force',
  ));
  assert.ok(assessment.provenance.limitations.some((limit) => /ruled out/i.test(limit)));
});

test('an unreviewed threat is scored as an unknown and named as a limitation', () => {
  const { state, screened } = caseWith([ffsRow({ 'Max Depth [%]': '15' })]);
  // The blank record leaves the six judged threats unreviewed.
  const assessment = buildRbiAssessment({
    record: { ...emptyRbiRecord(), ffsSessionId: '9' }, state, screened,
  });

  assert.ok(assessment.sections[0].probability.category >= 3);
  assert.ok(assessment.provenance.limitations.some((limit) => /never reviewed/i.test(limit)));
});

test('a section override discriminates one stretch of line from the rest', () => {
  const { state, screened } = caseWith([
    ffsRow({ Section: 'Line pipe' }),
    ffsRow({ 'Feature ID': 'B-1', Section: 'River crossing', 'LD [m]': '5000' }),
  ]);

  const record = recordWith({
    fluid: 'crude-oil',
    population: 'remote',
    environment: 'none',
    businessImpact: 'low',
    overrides: [
      { sectionId: 'River crossing', population: 'suburban', environment: 'surface-water', note: '' },
    ],
  });

  const assessment = buildRbiAssessment({ record, state, screened });
  const crossing = assessment.sections.find((section) => section.label === 'River crossing');
  const linePipe = assessment.sections.find((section) => section.label === 'Line pipe');

  assert.ok(crossing && linePipe);
  assert.ok(
    (crossing?.consequence.category ?? 0) > (linePipe?.consequence.category ?? 0),
    'a crossing and an empty desert must not land in the same box',
  );
  assert.equal(crossing?.consequence.overridden, true);
  assert.equal(linePipe?.consequence.overridden, false);
});

test('anomalies with no B31G result are carried into the plan, not ignored', () => {
  const { state, screened } = caseWith(
    [ffsRow()],
    [{ featureId: 'X-9', sourceKey: 'new:9', ldM: 2000, depthPct: null, reason: 'Missing or invalid measured field(s): Depth NEW (%WT).' }],
  );

  const assessment = buildRbiAssessment({ record: recordWith(), state, screened });

  assert.equal(assessment.totals.unassessed, 1);
  const unsectioned = assessment.sections.find((section) => section.label === 'Unsectioned');
  assert.ok(unsectioned, 'an unassessed anomaly still belongs to the line');
  assert.equal(unsectioned?.probability.unassessedCount, 1);
  // Scored in the middle of the scale, with a recommendation that says the
  // evidence is missing rather than implying safety.
  assert.equal(unsectioned?.probability.category, 3);
  assert.match(unsectioned?.inspection.recommendation ?? '', /no B31G result/i);
});

test('the assessment states its rules and what it does not cover', () => {
  const { state, screened } = caseWith([ffsRow()]);
  const assessment = buildRbiAssessment({ record: recordWith(), state, screened });

  assert.match(assessment.provenance.practice, /API RP 580/);
  assert.match(assessment.provenance.practice, /B31\.8S/);
  assert.ok(assessment.provenance.rules.length >= 8);
  assert.ok(assessment.provenance.limitations.some((limit) => /API 581/.test(limit)));
  assert.ok(assessment.provenance.limitations.some((limit) => /RBI engineer/.test(limit)));
  assert.ok(assessment.provenance.limitations.some((limit) => /Valves, flanges/.test(limit)));
  assert.equal(assessment.assessmentDateIso, '2024-07-14');
});

/* ── Readiness and storage ─────────────────────────────────────────────────── */

test('a blank record is not ready to issue, and says exactly why', () => {
  const outstanding = readiness(emptyRbiRecord()).filter((item) => !item.satisfied);
  assert.equal(outstanding.length, 3);
  assert.deepEqual(
    outstanding.map((item) => item.id).sort(),
    ['evidence', 'signed', 'threats-reviewed'],
  );
});

test('a threat ruled out with no reason blocks issue', () => {
  const withReason = recordWith({ ffsSessionId: '9', assessedBy: 'A', assessedOnIso: '2026-01-01' });
  assert.deepEqual(readiness(withReason).filter((item) => !item.satisfied), []);

  const withoutReason = withThreat(withReason, 'third-party', {
    relevance: 'not-credible', note: '   ',
  });
  assert.ok(readiness(withoutReason).some(
    (item) => item.id === 'ruled-out-reason' && !item.satisfied,
  ));
});

test('a record saved before a threat existed still opens, with the threat unreviewed', () => {
  const revived = reviveRbiRecord({
    version: 2,
    title: 'Legacy',
    threats: [{ id: 'scc', relevance: 'active', coverage: 'covered', note: 'Found in 2019.' }],
  });

  assert.equal(revived.title, 'Legacy');
  assert.equal(revived.threats.length, THREATS.length);
  assert.equal(revived.threats.find((threat) => threat.id === 'scc')?.relevance, 'active');
  // A threat the stored document never knew about appears as unreviewed rather
  // than silently missing from the probability.
  assert.equal(
    revived.threats.find((threat) => threat.id === 'weather-outside-force')?.relevance,
    'unreviewed',
  );
  // Nonsense in the column is a blank record, not a crash.
  assert.deepEqual(reviveRbiRecord(null), emptyRbiRecord());
});
