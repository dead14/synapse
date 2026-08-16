/**
 * Risk-based inspection, built from an authored record and a filed FFS case.
 *
 * The probability side of an API 580 assessment is where most RBI programmes are
 * weakest: it is usually a workshop opinion. Here it is only partly so — the
 * line has been inspected, the metal loss has been measured, and a B31G
 * assessment of that metal loss has already been run and filed. Reading the
 * filed assessment means the metal-loss probability is carried by evidence with
 * provenance all the way back to a feature in an ILI file, and the RBI cannot
 * drift away from the FFS it claims to be based on, because it is not a copy of
 * it.
 *
 * §10.1 does not let that be the whole story: "The POF analysis shall address
 * all credible damage mechanisms to which the equipment being reviewed is or can
 * be susceptible." A metal-loss run says nothing about external SCC, a dent, or
 * a geohazard. So the damage mechanism review (§9) contributes the rest, each
 * mechanism scored from its own rate or susceptibility and adjusted for how
 * effectively anyone has been looking for it (§10.4.2) — and the unit takes the
 * worst of all of them, measured and judged alike, with the governing mechanism
 * named so it is obvious which one is driving the plan.
 *
 * The consequence side cannot come from the inspection at all and is not
 * pretended to: nothing in an ILI run knows what the line carries or who lives
 * beside it. It is entered, and every entered value is reported as a driver
 * beside the measured ones so a reader can see which half of the risk is
 * judgement.
 */

import type { FfsScreenedResult } from '../ffs/types.ts';
import type { RevivedFfsShareState } from '../ffs/shareState.ts';
import {
  API_580_EDITION,
  MAX_INTERVAL_YEARS,
  RATE_SCREEN_WALL_FRACTION,
  REMAINING_LIFE_FRACTION,
  SUSCEPTIBILITY_CATEGORY,
  UNINSPECTED_ACTIVE_FLOOR,
  addYearsIso,
  categoryFromDepth,
  categoryFromErf,
  categoryFromRemainingLife,
  consequenceOf,
  inspectionIntervalYears,
  mechanismCategory,
  riskLevelOf,
  worstCategory,
} from './api580.ts';
import { mechanismName } from './record.ts';
import type {
  RbiAssessment,
  RbiConsequenceInput,
  RbiDriver,
  RbiInspectionPlan,
  RbiMechanismPof,
  RbiRecord,
  RbiUnitPlan,
  RbiUnitResult,
  RiskAcceptance,
  RiskCategory,
  RiskLevel,
} from './types.ts';

/** Where an unassessed anomaly is grouped when it has no section of its own. */
const UNSECTIONED = 'Unsectioned';

function finite(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** ISO calendar date, in the same local-day sense the FFS report uses. */
function calendarDate(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function unitLabel(section: string | undefined | null): string {
  const normalized = String(section ?? '').trim();
  return normalized === '' || normalized === '-' ? UNSECTIONED : normalized;
}

export interface BuildRbiInput {
  record: RbiRecord;
  state: RevivedFfsShareState;
  screened: FfsScreenedResult[];
}

interface Bucket {
  label: string;
  members: FfsScreenedResult[];
  unassessed: number;
  fromM: number | null;
  toM: number | null;
}

/**
 * One API 580 assessment of the line, unit by unit.
 *
 * The unit is the section the alignment named, which is the same boundary the
 * FFS design factors were set against — so the risk ranking divides the pipeline
 * the way the assessment behind it already did, rather than inventing a second
 * segmentation nobody reviewed.
 */
export function buildRbiAssessment(input: BuildRbiInput): RbiAssessment {
  const { record, state, screened } = input;
  const assessmentDateIso = calendarDate(state.config.iliDate);

  const buckets = new Map<string, Bucket>();
  const bucketFor = (label: string): Bucket => {
    let bucket = buckets.get(label);
    if (!bucket) {
      bucket = { label, members: [], unassessed: 0, fromM: null, toM: null };
      buckets.set(label, bucket);
    }
    return bucket;
  };
  const extend = (bucket: Bucket, ldM: number | null) => {
    if (ldM === null) return;
    bucket.fromM = bucket.fromM === null ? ldM : Math.min(bucket.fromM, ldM);
    bucket.toM = bucket.toM === null ? ldM : Math.max(bucket.toM, ldM);
  };

  for (const item of screened) {
    const bucket = bucketFor(unitLabel(item.nominal.section));
    bucket.members.push(item);
    extend(bucket, finite(item.nominal.ld));
  }

  // Anomalies the assessment could not calculate still belong to the line. They
  // cannot raise a measured probability — there is no measurement to raise it
  // with — but a unit that is carrying them is a unit whose risk rests on
  // partial evidence, and every plan for it says so.
  for (const row of state.alignmentImport?.rejected ?? []) {
    const bucket = bucketFor(UNSECTIONED);
    bucket.unassessed += 1;
    extend(bucket, row.ldM ?? null);
  }

  const units = [...buckets.values()]
    .filter((bucket) => bucket.members.length > 0 || bucket.unassessed > 0)
    .map((bucket) => buildUnit(bucket, record, assessmentDateIso))
    .sort((left, right) => {
      const order: Record<RiskLevel, number> = { High: 0, 'Medium high': 1, Medium: 2, Low: 3 };
      return order[left.riskLevel] - order[right.riskLevel]
        || (left.fromM ?? 0) - (right.fromM ?? 0);
    });

  const byLevel: Record<RiskLevel, number> = { Low: 0, Medium: 0, 'Medium high': 0, High: 0 };
  const byAcceptance: Record<RiskAcceptance, number> = { acceptable: 0, tolerable: 0, unacceptable: 0 };
  let nextDueIso: string | null = null;
  for (const unit of units) {
    byLevel[unit.riskLevel] += 1;
    byAcceptance[unit.acceptance] += 1;
    const due = unit.inspection.dueDateIso;
    if (due !== null && (nextDueIso === null || due < nextDueIso)) nextDueIso = due;
  }

  return {
    record,
    ffsSessionId: record.ffsSessionId,
    lineName: state.config.lineName,
    assessmentDateIso,
    units,
    totals: {
      features: screened.length,
      unassessed: state.alignmentImport?.rejected?.length ?? 0,
      byLevel,
      byAcceptance,
      nextDueIso,
    },
    provenance: {
      practice: 'API 580',
      edition: API_580_EDITION,
      approach: record.planning.approach,
      rules: rulesApplied(record),
      limitations: limitationsOf(record),
    },
  };
}

/**
 * The rules this assessment ran under, restated in the assessment itself.
 *
 * §16.3 asks for the methodology to be documented "sufficiently complete so that
 * the basis and the logic for the decision-making process can be checked or
 * replicated at a later time". Restating the thresholds here rather than only in
 * source is what makes the exported workbook auditable on its own.
 */
function rulesApplied(record: RbiRecord): string[] {
  const jurisdictional = record.planning.jurisdictionalMaxIntervalYears;
  return [
    'Probability of failure is the worst contribution across all credible damage mechanisms (§10.1), not an '
    + 'average: an average buries one collapsed feature among a hundred healthy ones.',
    'Metal loss is scored from the filed B31G assessment — worst estimating repair factor, shortest remaining '
    + 'life, and deepest reported wall loss in the unit. Inspection effectiveness is not applied to it, '
    + 'because there the inspection is the measurement.',
    `Mechanisms with a stated corrosion rate are screened to a remaining life against the corrosion allowance, `
    + `or against ${Math.round(RATE_SCREEN_WALL_FRACTION * 100)} % of nominal wall where no allowance was `
    + 'entered; that fallback assumes the wall is currently intact and says so on the driver.',
    `Mechanisms scored by susceptibility take category ${SUSCEPTIBILITY_CATEGORY.high} (high), `
    + `${SUSCEPTIBILITY_CATEGORY.medium} (medium), ${SUSCEPTIBILITY_CATEGORY.low} (low). A judgement never `
    + 'reaches category 5 on its own.',
    'A mechanism that is credible but not observed is scored one category below the same mechanism found '
    + 'active (§9.4.2); a ruled-out mechanism contributes nothing but stays on the record with its reason.',
    'Inspection effectiveness adjusts a judged category by one in each direction — A lowers it, D and E and '
    + `"no inspection" raise it — and an active mechanism nobody has inspected for is floored at category `
    + `${UNINSPECTED_ACTIVE_FLOOR}, because an unknown damage state is not a safe one (§10.4.2).`,
    'Consequence is the worst of four components assessed separately — safety and health, environmental, '
    + 'production, and maintenance and reconstruction (§11.1.1) — raised one category where bore × pressure '
    + 'is at or above 3 m·MPa.',
    'The safety component is the fluid hazard bounded by the exposure, not the worst of the two: a hurt '
    + 'person needs both a hazardous fluid and somebody within reach of it. Exposure never falls below the '
    + 'responder, and a toxic hazard is never scored below category 4.',
    'Risk is read from a documented 5×5 matrix (§12.6.2); it is not the arithmetic product of the two '
    + 'categories, so a consequence-5 unit is never reported as low risk.',
    `Inspection interval is ${REMAINING_LIFE_FRACTION} × remaining life, capped by the risk-based maximum `
    + `(${Object.entries(MAX_INTERVAL_YEARS).map(([level, years]) => `${level} ${years} y`).join(', ')})`
    + `${jurisdictional === null ? '' : `, and by the stated jurisdictional limit of ${jurisdictional} y`}.`,
    'A unit with no remaining-life figure receives the risk-based target interval, reported as a target '
    + 'rather than as a calculated interval. No interval is ever invented from data that cannot support one.',
  ];
}

function limitationsOf(record: RbiRecord): string[] {
  const ruledOut = record.dmr.mechanisms.filter((row) => row.status === 'ruled-out').length;
  const judged = record.dmr.mechanisms.filter(
    (row) => row.status !== 'ruled-out' && row.rateBasis !== 'measured-ili',
  ).length;

  const limits = [
    'This is a semi-quantitative assessment in the sense of API 580 §5.4. It does not produce a probability '
    + 'of failure in events per year and is not an API 581 quantitative analysis.',
    'Only metal loss is measured. Every other damage mechanism on this assessment is scored from a stated '
    + `rate or a susceptibility${judged > 0 ? ` — ${judged} of them` : ''}, which is engineering judgement `
    + 'recorded as such, not measurement.',
    'Consequence categories are entered by the engineer and are not derived from inspection evidence.',
    'Intervals are recommendations for engineering review, not a substitute for a jurisdictional inspection '
    + 'requirement where one is shorter.',
  ];

  // A consequence component nobody costed is scored from a weaker basis, and
  // the report says which — §16.7 asks for the criteria behind each category.
  const unquantified: string[] = [];
  if (record.consequence.environmentalCostUsd === null) unquantified.push('environmental cleanup and fines');
  if (record.consequence.dailyUnitValueUsd === null || record.consequence.downtimeDays === null) {
    unquantified.push('business interruption');
  }
  if (record.consequence.repairCostUsd === null) unquantified.push('repair and reconstruction');
  if (unquantified.length > 0) {
    limits.push(
      `The following consequence components were not costed: ${unquantified.join(', ')}. They were scored `
      + 'from the receptor and the redundancy alone, which is a weaker basis than the figures §11.5 asks '
      + 'for, and the assessment may understate the economic and environmental consequence as a result.',
    );
  }

  if (record.dmr.mechanisms.length === 0) {
    limits.push(
      'No damage mechanism review has been recorded. §10.1 requires the probability analysis to address all '
      + 'credible mechanisms, so this assessment currently covers metal loss alone and understates the risk '
      + 'of anything a metal-loss run cannot see.',
    );
  }
  if (ruledOut > 0) {
    limits.push(
      `${ruledOut} damage mechanism(s) were ruled out and contribute nothing to the probability. Their `
      + 'reasons are on the damage mechanism sheet and should be re-tested at the next reassessment.',
    );
  }
  if (record.dmr.otherCauses.length > 0) {
    limits.push(
      `Causes of loss of containment outside the damage mechanisms — ${record.dmr.otherCauses.join(', ')} — `
      + 'were considered and recorded but are not scored in the probability (§10.1).',
    );
  }
  return limits;
}

/* ── One unit ──────────────────────────────────────────────────────────────── */

function buildUnit(
  bucket: Bucket,
  record: RbiRecord,
  assessmentDateIso: string,
): RbiUnitResult {
  const measured = measuredMetalLoss(bucket);
  const mechanisms = mechanismContributions(record, measured.category, bucket.members.length > 0);

  // A unit holding only unassessed anomalies has no measured probability at all.
  // It is reported in the middle of the scale and its plan says the evidence is
  // missing — not scored 1, which would read as "safe".
  const measuredCategory: RiskCategory = bucket.members.length === 0 ? 3 : measured.category;

  const probabilityCategory = worstCategory([
    measuredCategory,
    ...mechanisms.map((item) => item.category),
  ]);

  const governing = mechanisms
    .filter((item) => item.category === probabilityCategory)
    .sort((left, right) => Number(right.measured) - Number(left.measured))[0] ?? null;

  const consequenceInput = consequenceInputFor(record, bucket.label);
  const consequenceResult = consequenceOf(consequenceInput);
  const overridden = record.consequenceOverrides.some(
    (item) => item.unitId === bucket.label
      && (item.population !== null || item.environmentReceptor !== null),
  );

  const riskLevel = riskLevelOf(probabilityCategory, consequenceResult.category);
  const plan = record.unitPlans.find((item) => item.unitId === bucket.label) ?? null;

  const interval = inspectionIntervalYears({
    riskLevel,
    remainingLifeYears: measured.shortestLife,
    jurisdictionalMaxYears: record.planning.jurisdictionalMaxIntervalYears,
    overrideYears: plan?.overrideIntervalYears ?? null,
  });

  return {
    id: bucket.label,
    label: bucket.label,
    fromM: bucket.fromM,
    toM: bucket.toM,
    featureCount: bucket.members.length,
    probability: {
      category: probabilityCategory,
      drivers: measured.drivers,
      mechanisms,
      governingMechanism: governing?.name ?? (bucket.members.length > 0 ? 'Measured metal loss' : null),
      growthAssumed: measured.growthAssumed,
      unassessedCount: bucket.unassessed,
    },
    consequence: {
      category: consequenceResult.category,
      components: consequenceResult.components,
      drivers: consequenceResult.drivers,
      overridden,
    },
    riskLevel,
    acceptance: record.risk.acceptance[riskLevel],
    inspection: inspectionPlanFor(riskLevel, interval, plan, bucket, record, assessmentDateIso),
    governingFeature: measured.governingFeature,
  };
}

/**
 * The measured half: what the filed B31G assessment says about this unit.
 *
 * The worst feature governs. An average would let one collapsed feature
 * disappear into a hundred healthy ones, which is the failure mode a risk
 * ranking exists to prevent.
 */
function measuredMetalLoss(bucket: Bucket): {
  category: RiskCategory;
  shortestLife: number | null;
  drivers: RbiDriver[];
  growthAssumed: boolean;
  governingFeature: RbiUnitResult['governingFeature'];
} {
  let worstErf: number | null = null;
  let shortestLife: number | null = null;
  let deepest: number | null = null;
  let governing: FfsScreenedResult | null = null;
  let growthAssumed = false;

  for (const item of bucket.members) {
    const erf = Number.isFinite(item.nominal.ERF) ? item.nominal.ERF : null;
    if (erf !== null && (worstErf === null || erf > worstErf)) {
      worstErf = erf;
      governing = item;
    }
    const life = item.nominal.remnantLife?.years ?? null;
    if (life !== null && (shortestLife === null || life < shortestLife)) shortestLife = life;
    const depth = finite(item.nominal.maxDepthPct);
    if (depth !== null && (deepest === null || depth > deepest)) deepest = depth;

    const basis = item.nominal.growthEvidence?.depth.analysisBasis;
    if (basis === 'estimated' || basis === 'explicit-fallback' || basis === 'none') growthAssumed = true;
  }
  if (governing === null && bucket.members.length > 0) governing = bucket.members[0];

  const erfCategory = categoryFromErf(worstErf);
  const lifeCategory = categoryFromRemainingLife(shortestLife);
  const depthCategory = categoryFromDepth(deepest);
  const count = bucket.members.length.toLocaleString();

  return {
    category: worstCategory([erfCategory, lifeCategory, depthCategory]),
    shortestLife,
    growthAssumed,
    drivers: [
      {
        id: 'erf',
        label: 'Worst estimating repair factor',
        value: worstErf === null ? null : Number(worstErf.toFixed(3)),
        unit: 'ERF',
        category: erfCategory,
        measured: true,
        basis: worstErf === null
          ? 'No feature in this unit produced an ERF.'
          : `Highest ERF among ${count} assessed feature(s).`,
      },
      {
        id: 'remaining-life',
        label: 'Shortest remaining life',
        value: shortestLife === null ? null : Number(shortestLife.toFixed(1)),
        unit: 'years',
        category: lifeCategory,
        measured: !growthAssumed,
        basis: shortestLife === null
          ? 'No feature in this unit produced a remaining-life figure; scored as unknown, not as low.'
          : `Shortest as-reported remnant life in this unit, from the filed B31G assessment`
            + `${growthAssumed ? ', on an assumed growth rate' : ''}.`,
      },
      {
        id: 'depth',
        label: 'Deepest reported metal loss',
        value: deepest === null ? null : Number(deepest.toFixed(1)),
        unit: '%WT',
        category: depthCategory,
        measured: true,
        basis: deepest === null
          ? 'No depth was reported for any feature in this unit.'
          : 'Deepest depth as reported by the inspection run.',
      },
    ],
    governingFeature: governing === null ? null : {
      featureId: governing.nominal.featureId,
      ldM: finite(governing.nominal.ld),
      erf: Number.isFinite(governing.nominal.ERF) ? governing.nominal.ERF : null,
      remnantLifeYears: governing.nominal.remnantLife?.years ?? null,
      depthPct: finite(governing.nominal.maxDepthPct),
    },
  };
}

/**
 * Every credible mechanism's contribution, measured and judged.
 *
 * The damage mechanism review is line-level, so each unit carries the same list
 * — except the measured rows, which take that unit's own B31G result. Two
 * measured rows (internal and external corrosion, typically) therefore share a
 * category, and the basis says why: an ILI metal-loss result does not attribute
 * the loss it found between the two.
 */
function mechanismContributions(
  record: RbiRecord,
  measuredCategory: RiskCategory,
  unitHasFeatures: boolean,
): RbiMechanismPof[] {
  const output: RbiMechanismPof[] = [];

  for (const row of record.dmr.mechanisms) {
    if (row.status === 'ruled-out') continue;
    const name = mechanismName(row);

    if (row.rateBasis === 'measured-ili') {
      output.push({
        rowId: row.id,
        name,
        status: row.status,
        rateBasis: row.rateBasis,
        baseCategory: measuredCategory,
        effectiveness: row.effectiveness,
        effectivenessDelta: 0,
        category: unitHasFeatures ? measuredCategory : 3,
        measured: unitHasFeatures,
        basis: unitHasFeatures
          ? 'Scored from the filed B31G assessment of this unit. The metal-loss run does not attribute the '
            + 'loss it measured between internal and external mechanisms, so both carry the same category.'
          : 'No assessed feature in this unit, so the measured evidence is absent; scored as unknown.',
      });
      continue;
    }

    const scored = mechanismCategory(row, record.data.equipment);
    output.push({
      rowId: row.id,
      name,
      status: row.status,
      rateBasis: row.rateBasis,
      baseCategory: scored.base,
      effectiveness: row.effectiveness,
      effectivenessDelta: scored.delta,
      category: scored.category,
      measured: false,
      basis: scored.basis,
    });
  }

  return output;
}

/**
 * The consequence inputs for one unit.
 *
 * The line default, with the surroundings overridden where the engineer has said
 * this stretch differs. The five release-scale fields are copied from §8 and
 * from the FFS case rather than re-entered here, so the consequence and the data
 * collection cannot describe two different pipes.
 */
function consequenceInputFor(record: RbiRecord, unitId: string): RbiConsequenceInput {
  const override = record.consequenceOverrides.find((item) => item.unitId === unitId) ?? null;
  return {
    ...record.consequence,
    fluid: record.data.process.fluid,
    population: override?.population ?? record.consequence.population,
    environmentReceptor: override?.environmentReceptor ?? record.consequence.environmentReceptor,
    inventoryM3: record.data.inventory.volumeM3,
    detection: record.data.inventory.detectionSystem,
    isolation: record.data.inventory.isolationSystem,
    spillContainment: record.data.inventory.spillContainment,
  };
}

function inspectionPlanFor(
  riskLevel: RiskLevel,
  interval: ReturnType<typeof inspectionIntervalYears>,
  plan: RbiUnitPlan | null,
  bucket: Bucket,
  record: RbiRecord,
  assessmentDateIso: string,
): RbiInspectionPlan {
  return {
    intervalYears: interval.intervalYears,
    dueDateIso: interval.intervalYears === null
      ? null
      : addYearsIso(assessmentDateIso, interval.intervalYears),
    basis: interval.basis,
    recommendation: recommendationFor(riskLevel, interval.basis, bucket.unassessed, plan, record),
    technique: plan?.technique ?? '',
    coveragePct: plan?.coveragePct ?? null,
    locations: plan?.locations ?? '',
    strategy: plan?.strategy ?? 'none',
    mitigationNote: plan?.mitigationNote ?? '',
    targetDateIso: plan?.targetDateIso || null,
    owner: plan?.owner ?? '',
    residualRiskLevel: plan?.residualRiskLevel ?? null,
  };
}

/**
 * The recommendation, in words an engineer can act on.
 *
 * Deliberately not "monitor": every line of this is either an inspection with a
 * date or an intervention, because a plan whose action is to keep looking is not
 * a plan §13 would accept for a high-risk component. Where the engineer has
 * chosen a strategy under §13.1 it is stated first, because that is the decision
 * — the interval is what supports it.
 */
function recommendationFor(
  level: RiskLevel,
  basis: RbiInspectionPlan['basis'],
  unassessedCount: number,
  plan: RbiUnitPlan | null,
  record: RbiRecord,
): string {
  if (basis === 'immediate-action') {
    return 'Remaining life is exhausted at the assessed pressure. Reduce pressure or repair before the next '
      + 'inspection cycle; an inspection interval is not an adequate response on its own.';
  }

  const gap = unassessedCount > 0
    ? ` ${unassessedCount.toLocaleString()} anomal${unassessedCount === 1 ? 'y' : 'ies'} here carried no B31G `
      + 'result, so this probability is based on less than the full population — recover the missing source data.'
    : '';

  const uninspected = record.dmr.mechanisms.filter(
    (row) => row.status === 'active' && row.effectiveness === 'none',
  );
  const blind = uninspected.length > 0
    ? ` ${uninspected.length} active mechanism(s) here have had no inspection at all `
      + `(${uninspected.map(mechanismName).join(', ')}); the probability for those is an unknown, not a low.`
    : '';

  const strategy = plan?.strategy && plan.strategy !== 'none'
    ? `${STRATEGY_SENTENCE[plan.strategy]} `
    : '';

  if (level === 'High') {
    return `${strategy}In-line inspection or direct examination at the interval below, with a mitigation plan `
      + `(pressure reduction, repair, or recoating) prepared in parallel.${gap}${blind}`;
  }
  if (level === 'Medium high') {
    return `${strategy}Schedule the next in-line inspection at the interval below and confirm the corrosion `
      + `rate against the next run pair.${gap}${blind}`;
  }
  if (level === 'Medium') {
    return `${strategy}Include in the routine in-line inspection programme at the interval below.${gap}${blind}`;
  }
  return `${strategy}Routine inspection at the interval below is sufficient on current evidence.${gap}${blind}`;
}

/** §13.1 — the four strategies, said in the plan's own voice. */
const STRATEGY_SENTENCE: Record<Exclude<RbiUnitPlan['strategy'], 'none'>, string> = {
  'inspection-repair': 'Strategy: inspect and repair as indicated.',
  'pof-mitigation': 'Strategy: reduce the probability of failure — material, operating, or design change.',
  'cof-mitigation': 'Strategy: reduce the consequence of failure — isolation, detection, or inventory.',
  decommission: 'Strategy: decommission. The equipment is not required to support operation.',
};
