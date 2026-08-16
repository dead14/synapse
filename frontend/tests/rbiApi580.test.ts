import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addYearsIso,
  categoryFromDepth,
  categoryFromErf,
  categoryFromRemainingLife,
  consequenceOf,
  inspectionIntervalYears,
  lifeFromCorrosionRate,
  mechanismCategory,
  riskLevelOf,
  MAX_INTERVAL_YEARS,
  RISK_MATRIX,
} from '../src/lib/rbi/api580.ts';
import { buildRbiAssessment } from '../src/lib/rbi/fromFfs.ts';
import { evaluateChecklist } from '../src/lib/rbi/checklist.ts';
import { emptyRbiRecord, mechanismRowFor, reviveRbiRecord } from '../src/lib/rbi/record.ts';
import { screenResults } from '../src/lib/ffs/screening.ts';
import { processRow } from '../src/lib/ffs/calcEngine.ts';
import { DEFAULT_SCREENING_CONFIG, type FfsConfig } from '../src/lib/ffs/types.ts';
import type { RevivedFfsShareState } from '../src/lib/ffs/shareState.ts';
import type { RbiConsequenceInput, RbiRecord } from '../src/lib/rbi/types.ts';

const config: FfsConfig = {
  lineName: 'HU CPA 20in',
  method: 'modified',
  modifiedSa: 'smys69',
  iliDate: new Date(2024, 6, 14),
  highlightYears: 5,
  depthRejectionPct: 80,
};

/** The line-level consequence inputs, as the builder assembles them. */
const consequence: RbiConsequenceInput = {
  fluid: 'crude-oil',
  population: 'rural',
  personnelExposed: null,
  publicProximityM: null,
  toxicRelease: false,
  flammable: true,
  environmentReceptor: 'soil',
  environmentalCostUsd: null,
  dailyUnitValueUsd: null,
  downtimeDays: null,
  redundancy: 'none',
  repairCostUsd: null,
  outerDiameterMm: 508,
  operatingPressureMpa: 6,
  inventoryM3: null,
  detection: 'C',
  isolation: 'C',
  spillContainment: 'none',
  basisNote: '',
};

/** A record carrying the same consequence inputs, for the whole-assessment tests. */
function recordWith(patch: Partial<RbiRecord> = {}): RbiRecord {
  const blank = emptyRbiRecord();
  return {
    ...blank,
    ffsSessionId: '9',
    ...patch,
    data: {
      ...blank.data,
      ...(patch.data ?? {}),
      process: { ...blank.data.process, fluid: 'crude-oil', ...(patch.data?.process ?? {}) },
      inventory: { ...blank.data.inventory, ...(patch.data?.inventory ?? {}) },
      equipment: { ...blank.data.equipment, ...(patch.data?.equipment ?? {}) },
    },
    consequence: { ...consequence, ...(patch.consequence ?? {}) },
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

/* ── §10 Probability ───────────────────────────────────────────────────────── */

test('measured probability bands follow the evidence, worst driver first', () => {
  assert.equal(categoryFromErf(1.2), 5);
  assert.equal(categoryFromErf(0.95), 4);
  assert.equal(categoryFromErf(0.3), 1);

  assert.equal(categoryFromRemainingLife(0.5), 5);
  assert.equal(categoryFromRemainingLife(30), 1);
  // No life figure is an unknown probability, not a low one — otherwise a
  // feature with no growth basis outranks one with a measured 30-year life.
  assert.equal(categoryFromRemainingLife(null), 3);

  assert.equal(categoryFromDepth(85), 5);
  assert.equal(categoryFromDepth(10), 1);
  assert.equal(categoryFromDepth(null), 1);
});

test('a stated corrosion rate is screened against the allowance, or against the wall', () => {
  const withAllowance = lifeFromCorrosionRate(0.2, { corrosionAllowanceMm: 3, nominalWallMm: 12.7 });
  assert.equal(withAllowance.basis, 'corrosion-allowance');
  assert.equal(withAllowance.years, 15);

  // No allowance falls back to 80 % of nominal wall — the same rejection line
  // the FFS screening uses — and says so, because it assumes an intact wall.
  const withoutAllowance = lifeFromCorrosionRate(0.2, { corrosionAllowanceMm: null, nominalWallMm: 10 });
  assert.equal(withoutAllowance.basis, 'wall-fraction');
  assert.equal(withoutAllowance.years, 40);

  // Neither figure means no life, not an optimistic one.
  assert.deepEqual(
    lifeFromCorrosionRate(0.2, { corrosionAllowanceMm: null, nominalWallMm: null }),
    { years: null, basis: 'no-basis' },
  );
  assert.equal(lifeFromCorrosionRate(0, { corrosionAllowanceMm: 3, nominalWallMm: 10 }).years, null);
});

test('inspection effectiveness moves a judged category, and never a measured one', () => {
  const equipment = { corrosionAllowanceMm: null, nominalWallMm: 12.7 };
  const base = mechanismRowFor('scc-external');

  // Active, highly susceptible, and nobody has looked: the worst combination.
  const blind = mechanismCategory(
    { ...base, status: 'active', susceptibility: 'high', effectiveness: 'none' },
    equipment,
  );
  assert.equal(blind.baseCategory ?? blind.base, 4);
  assert.equal(blind.category, 5);

  // The same mechanism, thoroughly inspected, earns a category back.
  const inspected = mechanismCategory(
    { ...base, status: 'active', susceptibility: 'high', effectiveness: 'A' },
    equipment,
  );
  assert.equal(inspected.category, 3);

  // Credible but never observed is scored below the same mechanism found active.
  const potential = mechanismCategory(
    { ...base, status: 'potential', susceptibility: 'high', effectiveness: 'B' },
    equipment,
  );
  assert.equal(potential.category, 3);

  // An active mechanism with no inspection is floored at "unknown", not "safe".
  const lowButBlind = mechanismCategory(
    { ...base, status: 'active', susceptibility: 'low', effectiveness: 'none' },
    equipment,
  );
  assert.equal(lowButBlind.category, 3);
});

test('a judgement never reaches category 5 on susceptibility alone', () => {
  const equipment = { corrosionAllowanceMm: null, nominalWallMm: 12.7 };
  const scored = mechanismCategory(
    { ...mechanismRowFor('hic-sohic'), status: 'active', susceptibility: 'high', effectiveness: 'B' },
    equipment,
  );
  assert.equal(scored.category, 4);
});

/* ── §11 Consequence ───────────────────────────────────────────────────────── */

test('a consequence-5 component is never low, however unlikely a failure is', () => {
  for (let probability = 1; probability <= 5; probability += 1) {
    assert.notEqual(riskLevelOf(probability as 1, 5), 'Low');
  }
  assert.equal(RISK_MATRIX.length, 5);
  assert.ok(RISK_MATRIX.every((row) => row.length === 5));
});

test('consequence is the worst of four components, raised for a large high-pressure line', () => {
  const urban = { ...consequence, population: 'urban' as const };
  const small = consequenceOf({ ...urban, outerDiameterMm: 168, operatingPressureMpa: 2 });
  const large = consequenceOf({ ...urban, outerDiameterMm: 762, operatingPressureMpa: 8 });

  assert.equal(small.category, 4, 'crude oil with people nearby carries a category 4 safety consequence');
  assert.equal(large.category, 5, 'bore × pressure at or above 3 m·MPa raises it one');
  assert.ok(large.drivers.some((driver) => driver.id === 'release-scale' && driver.category === 2));

  // All four axes are reported separately, per §11.1.1.
  assert.deepEqual(
    small.components.map((component) => component.id),
    ['safety', 'environmental', 'production', 'maintenance'],
  );

  // Sour gas in an urban area is the worst case and cannot be diluted by a
  // cheap repair or a redundant route.
  const worst = consequenceOf({
    ...consequence, fluid: 'sour-gas', population: 'urban', redundancy: 'full', repairCostUsd: 1000,
  });
  assert.equal(worst.category, 5);
});

test('safety consequence needs both a hazardous fluid and somebody near it', () => {
  const bare = { ...consequence, outerDiameterMm: 100, operatingPressureMpa: 1 };
  const safetyOf = (input: RbiConsequenceInput) => consequenceOf(input)
    .components.find((component) => component.id === 'safety')?.category;

  // A water main under a city centre is not a safety-5 event. It may well be a
  // production or environmental one, which is why the axes are kept apart.
  assert.equal(safetyOf({ ...bare, fluid: 'water', population: 'urban' }), 1);

  // Nor is a crude oil release forty kilometres from the nearest road — but it
  // is not a 1 either, because somebody has to walk up to it.
  assert.equal(safetyOf({ ...bare, fluid: 'crude-oil', population: 'remote' }), 2);

  // The same fluid beside houses is what the analysis is for.
  assert.equal(safetyOf({ ...bare, fluid: 'crude-oil', population: 'suburban' }), 4);

  // A stated crew count raises a remote section on its own.
  assert.equal(safetyOf({ ...bare, fluid: 'crude-oil', population: 'remote', personnelExposed: 12 }), 4);
});

test('a toxic hazard is never scored below the responder who meets it', () => {
  const bare = { ...consequence, outerDiameterMm: 100, operatingPressureMpa: 1 };
  const safetyOf = (input: RbiConsequenceInput) => consequenceOf(input)
    .components.find((component) => component.id === 'safety')?.category;

  // Toxic in the middle of nowhere still endangers whoever responds to it: the
  // exposure floor rises with the hazard, so it cannot fall to the ordinary
  // responder category.
  assert.equal(safetyOf({ ...bare, fluid: 'sour-gas', population: 'remote', toxicRelease: true }), 3);
  // And a nominally harmless fluid declared toxic is lifted to the same floor.
  assert.equal(safetyOf({ ...bare, fluid: 'water', population: 'suburban', toxicRelease: true }), 4);
});

test('detection and isolation earn a category by reducing the volume released', () => {
  const exposed = {
    ...consequence, population: 'suburban' as const, outerDiameterMm: 100, operatingPressureMpa: 1,
  };
  const safetyOf = (input: RbiConsequenceInput) => consequenceOf(input)
    .components.find((component) => component.id === 'safety')?.category;

  assert.equal(safetyOf(exposed), 4);
  assert.equal(safetyOf({ ...exposed, detection: 'A', isolation: 'A' }), 3);
  // Either one alone leaves the release running while somebody decides.
  assert.equal(safetyOf({ ...exposed, detection: 'A', isolation: 'C' }), 4);
  assert.equal(safetyOf({ ...exposed, detection: 'C', isolation: 'A' }), 4);
});

test('production consequence is quantified where it can be, and says so where it cannot', () => {
  const unquantified = consequenceOf(consequence);
  const production = unquantified.components.find((component) => component.id === 'production');
  // Capped below the point where a missing input could govern the risk.
  assert.equal(production?.category, 2, 'scored from redundancy alone');
  assert.match(
    production?.drivers[0].basis ?? '',
    /not quantified/i,
    'the weaker basis is stated, not hidden',
  );

  const quantified = consequenceOf({
    ...consequence, dailyUnitValueUsd: 500_000, downtimeDays: 30,
  });
  const costed = quantified.components.find((component) => component.id === 'production');
  assert.equal(costed?.category, 5, '15 M USD of business interruption');
  assert.equal(costed?.drivers[0].value, 15_000_000);
});

test('an uncosted consequence component is named as a limitation, not passed over', () => {
  const { state, screened } = caseWith([ffsRow()]);
  const assessment = buildRbiAssessment({ record: recordWith(), state, screened });
  assert.ok(assessment.provenance.limitations.some(
    (limit) => /not costed/i.test(limit) && /business interruption/i.test(limit),
  ));
});

/* ── §12/§13 Risk and the plan ─────────────────────────────────────────────── */

test('the inspection interval is half the remaining life, capped by risk then by the regulator', () => {
  const plain = { jurisdictionalMaxYears: null, overrideYears: null };

  // 6 years of life at medium risk: half-life governs.
  assert.deepEqual(
    inspectionIntervalYears({ riskLevel: 'Medium', remainingLifeYears: 6, ...plain }),
    { intervalYears: 3, basis: 'half-remaining-life' },
  );
  // 40 years of life at high risk: the risk cap governs.
  assert.deepEqual(
    inspectionIntervalYears({ riskLevel: 'High', remainingLifeYears: 40, ...plain }),
    { intervalYears: MAX_INTERVAL_YEARS.High, basis: 'risk-target-interval' },
  );
  // No life figure: the cap is a target, and the basis says so rather than
  // presenting it as a calculated interval.
  assert.deepEqual(
    inspectionIntervalYears({ riskLevel: 'Low', remainingLifeYears: null, ...plain }),
    { intervalYears: MAX_INTERVAL_YEARS.Low, basis: 'risk-target-interval' },
  );
  // A shorter jurisdictional limit wins outright, and is named as the reason.
  assert.deepEqual(
    inspectionIntervalYears({
      riskLevel: 'Low', remainingLifeYears: 40, jurisdictionalMaxYears: 5, overrideYears: null,
    }),
    { intervalYears: 5, basis: 'jurisdictional-limit' },
  );
  // Exhausted life is not an inspection problem.
  assert.deepEqual(
    inspectionIntervalYears({ riskLevel: 'High', remainingLifeYears: 0, ...plain }),
    { intervalYears: 0, basis: 'immediate-action' },
  );
  // An engineer's own figure is honoured and labelled as theirs.
  assert.deepEqual(
    inspectionIntervalYears({
      riskLevel: 'High', remainingLifeYears: 40, jurisdictionalMaxYears: null, overrideYears: 1.5,
    }),
    { intervalYears: 1.5, basis: 'engineer-override' },
  );
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

  const assessment = buildRbiAssessment({ record: recordWith(), state, screened });

  assert.equal(assessment.units.length, 2);
  const linePipe = assessment.units.find((unit) => unit.label === 'Line pipe');
  assert.ok(linePipe);
  assert.equal(linePipe?.featureCount, 2);
  // The deepest feature governs; an average would bury it in the healthy ones.
  assert.equal(linePipe?.governingFeature?.featureId, 'A-2');
  assert.equal(linePipe?.probability.drivers.find((driver) => driver.id === 'depth')?.value, 72);
  assert.equal(linePipe?.fromM, 1000);
  assert.equal(linePipe?.toM, 1100);
  // Highest risk is listed first, which is what a ranking is for.
  assert.ok(assessment.units[0].riskLevel !== 'Low' || assessment.units.length === 1);
});

test('a judged mechanism can drive the probability above the measured metal loss', () => {
  const { state, screened } = caseWith([ffsRow({ 'Max Depth [%]': '15' })]);

  const withoutDmr = buildRbiAssessment({ record: recordWith(), state, screened });
  const measuredCategory = withoutDmr.units[0].probability.category;

  const record = recordWith({
    dmr: {
      ...emptyRbiRecord().dmr,
      mechanisms: [{
        ...mechanismRowFor('scc-external'),
        status: 'active',
        susceptibility: 'high',
        effectiveness: 'none',
        basis: 'Colonies found in two excavations on the adjacent section.',
      }],
    },
  });
  const withDmr = buildRbiAssessment({ record, state, screened });

  assert.ok(
    withDmr.units[0].probability.category > measuredCategory,
    '§10.1 — the analysis shall address all credible mechanisms, not only the measured one',
  );
  assert.equal(withDmr.units[0].probability.governingMechanism, 'External SCC (near-neutral / high-pH)');
});

test('a ruled-out mechanism contributes nothing but stays on the record', () => {
  const { state, screened } = caseWith([ffsRow({ 'Max Depth [%]': '15' })]);
  const record = recordWith({
    dmr: {
      ...emptyRbiRecord().dmr,
      mechanisms: [{
        ...mechanismRowFor('creep'),
        status: 'ruled-out',
        susceptibility: 'high',
        ruledOutReason: 'The line never operates above 60 °C.',
      }],
    },
  });

  const assessment = buildRbiAssessment({ record, state, screened });
  assert.equal(assessment.units[0].probability.mechanisms.length, 0);
  assert.ok(assessment.provenance.limitations.some((limit) => /ruled out/i.test(limit)));
});

test('a section override discriminates one stretch of line from the rest', () => {
  const { state, screened } = caseWith([
    ffsRow({ Section: 'Line pipe' }),
    ffsRow({ 'Feature ID': 'B-1', Section: 'River crossing', 'LD [m]': '5000' }),
  ]);

  const record = recordWith({
    consequence: { ...consequence, outerDiameterMm: 100, operatingPressureMpa: 1, population: 'remote' },
    consequenceOverrides: [
      { unitId: 'River crossing', population: 'suburban', environmentReceptor: 'surface-water', note: '' },
    ],
  });

  const assessment = buildRbiAssessment({ record, state, screened });
  const crossing = assessment.units.find((unit) => unit.label === 'River crossing');
  const linePipe = assessment.units.find((unit) => unit.label === 'Line pipe');

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
  const unsectioned = assessment.units.find((unit) => unit.label === 'Unsectioned');
  assert.ok(unsectioned, 'an unassessed anomaly still belongs to the line');
  assert.equal(unsectioned?.probability.unassessedCount, 1);
  // A unit with no measured features is scored in the middle of the scale, and
  // its recommendation says the evidence is missing rather than implying safety.
  assert.equal(unsectioned?.probability.category, 3);
  assert.match(unsectioned?.inspection.recommendation ?? '', /no B31G result/i);
});

test('risk acceptance follows the operator criteria, not the level alone', () => {
  const { state, screened } = caseWith([ffsRow({ 'Max Depth [%]': '75' })]);
  const strict = recordWith({
    risk: {
      ...emptyRbiRecord().risk,
      acceptance: {
        Low: 'acceptable', Medium: 'unacceptable', 'Medium high': 'unacceptable', High: 'unacceptable',
      },
    },
  });

  const assessment = buildRbiAssessment({ record: strict, state, screened });
  assert.ok(assessment.totals.byAcceptance.unacceptable > 0);
  assert.equal(
    assessment.units[0].acceptance,
    strict.risk.acceptance[assessment.units[0].riskLevel],
  );
});

test('the assessment states its practice, its rules, and what it does not cover', () => {
  const { state, screened } = caseWith([ffsRow()]);
  const assessment = buildRbiAssessment({ record: recordWith(), state, screened });

  assert.equal(assessment.provenance.practice, 'API 580');
  assert.equal(assessment.provenance.approach, 'semi-quantitative');
  assert.match(assessment.provenance.edition, /4th edition/);
  assert.ok(assessment.provenance.rules.length >= 8);
  assert.ok(assessment.provenance.limitations.some((limit) => /API 581/.test(limit)));
  assert.ok(assessment.provenance.limitations.some((limit) => /damage mechanism review/i.test(limit)));
  assert.equal(assessment.assessmentDateIso, '2024-07-14');
});

/* ── Appendix A ────────────────────────────────────────────────────────────── */

test('a blank record fails the Appendix A shall-items rather than passing quietly', () => {
  const result = evaluateChecklist(emptyRbiRecord());
  assert.ok(result.blockers.length > 0);
  assert.equal(result.shallMet, result.shallTotal - result.blockers.length);
  // The one Appendix A calls out by name.
  assert.ok(result.blockers.some((item) => item.id === 'corrosion-specialist'));
  assert.ok(result.blockers.every((item) => item.remedy.trim().length > 0));
});

test('ruling a mechanism out without a reason is a blocking failure', () => {
  const withReason = evaluateChecklist(recordWith({
    dmr: {
      ...emptyRbiRecord().dmr,
      mechanisms: [{ ...mechanismRowFor('creep'), status: 'ruled-out', ruledOutReason: 'Below the creep range.' }],
    },
  }));
  const withoutReason = evaluateChecklist(recordWith({
    dmr: {
      ...emptyRbiRecord().dmr,
      mechanisms: [{ ...mechanismRowFor('creep'), status: 'ruled-out', ruledOutReason: '' }],
    },
  }));

  assert.ok(!withReason.blockers.some((item) => item.id === 'dmr-ruled-out'));
  assert.ok(withoutReason.blockers.some((item) => item.id === 'dmr-ruled-out'));
});

test('acceptance criteria that refuse nothing are not criteria', () => {
  const permissive = evaluateChecklist(recordWith({
    risk: {
      ...emptyRbiRecord().risk,
      acceptance: { Low: 'acceptable', Medium: 'acceptable', 'Medium high': 'tolerable', High: 'tolerable' },
    },
  }));
  assert.ok(permissive.blockers.some((item) => item.id === 'risk-criteria'));
});

/* ── Storage ───────────────────────────────────────────────────────────────── */

test('a record saved before a field existed still opens', () => {
  // §16.2 asks for an assessment that can be recreated later by someone else.
  // A partial document from an older version must revive, not throw.
  const revived = reviveRbiRecord({ version: 1, title: 'Legacy', planning: { facility: 'CPA' } });
  assert.equal(revived.title, 'Legacy');
  assert.equal(revived.planning.facility, 'CPA');
  assert.deepEqual(revived.planning.objectives, []);
  assert.deepEqual(revived.team, []);
  assert.equal(revived.data.inventory.detectionSystem, 'C');
  assert.equal(revived.risk.acceptance.High, 'unacceptable');

  // Nonsense in the column is a blank document, not a crash.
  assert.deepEqual(reviveRbiRecord(null), emptyRbiRecord());
});
