/**
 * The assessment, built from the reviewed record and the filed B31G case.
 *
 * The probability side of most RBI screenings is a workshop opinion. Here half
 * of it is not: the line has been inspected, the metal loss has been measured,
 * and a B31G assessment of it has been run and filed. Reading that filed case
 * rather than copying it means the ranking cannot drift away from the
 * fitness-for-service assessment it cites.
 *
 * The other half has to be judged, and is. A metal-loss run says nothing about
 * cracking, a dent, a bad girth weld or a landslide, so the reviewed threat list
 * carries those and the section takes the worst of everything — with the
 * governing threat named, so it is obvious which one is driving the plan.
 *
 * The consequence cannot come from the inspection at all and is not pretended
 * to. It is entered, and every entered value is reported beside the measured
 * ones so a reader can see which half of the risk is judgement.
 */

import type { RevivedFfsShareState } from '../ffs/shareState.ts';
import type { FfsScreenedResult } from '../ffs/types.ts';
import {
  APPROACH,
  MAX_INTERVAL_YEARS,
  PRACTICE,
  REMAINING_LIFE_FRACTION,
  RISK_ACCEPTANCE,
  UNINSPECTED_ACTIVE_FLOOR,
  addYearsIso,
  categoryFromDepth,
  categoryFromErf,
  categoryFromRemainingLife,
  consequenceOf,
  inspectionIntervalYears,
  riskLevelOf,
  threatCategory,
  worstCategory,
} from './api580.ts';
import { THREATS, threatById, threatLabel } from './catalogues.ts';
import type {
  RbiAssessment,
  RbiDriver,
  RbiRecord,
  RbiSectionResult,
  RiskCategory,
  RiskLevel,
  ThreatScore,
} from './types.ts';

/** Where an anomaly with no B31G result is grouped when it has no section. */
const UNSECTIONED = 'Unsectioned';

function finite(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function calendarDate(date: Date): string {
  return [
    String(date.getFullYear()).padStart(4, '0'),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function sectionLabel(section: string | undefined | null): string {
  const normalized = String(section ?? '').trim();
  return normalized === '' || normalized === '-' ? UNSECTIONED : normalized;
}

interface Bucket {
  label: string;
  members: FfsScreenedResult[];
  unassessed: number;
  fromM: number | null;
  toM: number | null;
}

export interface BuildRbiInput {
  record: RbiRecord;
  state: RevivedFfsShareState;
  screened: FfsScreenedResult[];
}

/**
 * One assessment of the line, section by section.
 *
 * The section is the one the alignment named, which is the same boundary the
 * fitness-for-service design factors were set against — so the ranking divides
 * the pipeline the way the assessment behind it already did, rather than
 * inventing a second segmentation nobody reviewed.
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
    const bucket = bucketFor(sectionLabel(item.nominal.section));
    bucket.members.push(item);
    extend(bucket, finite(item.nominal.ld));
  }

  // Anomalies the assessment could not calculate still belong to the line. They
  // cannot raise a measured probability, but a section carrying them rests on
  // partial evidence and its plan says so.
  for (const row of state.alignmentImport?.rejected ?? []) {
    const bucket = bucketFor(UNSECTIONED);
    bucket.unassessed += 1;
    extend(bucket, row.ldM ?? null);
  }

  const geometry = {
    outerDiameterMm: finite(screened[0]?.nominal.od) ?? 0,
    operatingPressureMpa: finite(screened[0]?.nominal.p0) ?? 0,
  };

  const sections = [...buckets.values()]
    .filter((bucket) => bucket.members.length > 0 || bucket.unassessed > 0)
    .map((bucket) => buildSection(bucket, record, geometry, assessmentDateIso))
    .sort((left, right) => {
      const order: Record<RiskLevel, number> = { High: 0, 'Medium high': 1, Medium: 2, Low: 3 };
      return order[left.riskLevel] - order[right.riskLevel]
        || (left.fromM ?? 0) - (right.fromM ?? 0);
    });

  const byLevel: Record<RiskLevel, number> = { Low: 0, Medium: 0, 'Medium high': 0, High: 0 };
  let unacceptable = 0;
  let nextDueIso: string | null = null;
  for (const section of sections) {
    byLevel[section.riskLevel] += 1;
    if (section.acceptance === 'unacceptable') unacceptable += 1;
    const due = section.inspection.dueDateIso;
    if (due !== null && (nextDueIso === null || due < nextDueIso)) nextDueIso = due;
  }

  return {
    record,
    ffsSessionId: record.ffsSessionId,
    lineName: record.segment.trim() || state.config.lineName,
    assessmentDateIso,
    sections,
    totals: {
      features: screened.length,
      unassessed: state.alignmentImport?.rejected?.length ?? 0,
      byLevel,
      unacceptable,
      nextDueIso,
    },
    provenance: {
      practice: PRACTICE,
      approach: APPROACH,
      rules: rulesApplied(record),
      limitations: limitationsOf(record),
    },
  };
}

/**
 * The rules restated inside the assessment.
 *
 * API 580 asks for the methodology to be documented completely enough that the
 * logic can be checked or replicated later. Restating the thresholds here rather
 * than only in source is what makes the exported report auditable on its own.
 */
function rulesApplied(record: RbiRecord): string[] {
  return [
    'Probability is the worst contribution across all eight pipeline threat categories, never an average — '
    + 'an average buries one collapsed feature among a hundred healthy ones.',
    'Metal loss is scored from the filed B31G assessment: the worst estimating repair factor, the shortest '
    + 'remaining life, and the deepest reported wall loss in the section.',
    'Threats a metal-loss run cannot measure are scored from the review: active 4, credible but unseen 2, '
    + 'unreviewed 3. A judgement never reaches category 5 on its own.',
    'Inspection coverage adjusts a judged threat by one category in each direction, and an active threat '
    + `nobody has inspected for is floored at ${UNINSPECTED_ACTIVE_FLOOR} — an unknown damage state is not a `
    + 'safe one.',
    'Consequence is the worst of safety, environment and business impact, raised one category where bore '
    + 'times pressure is at or above 3 m.MPa. Safety is the fluid hazard bounded by the exposure, not the '
    + 'worse of the two: a release needs both a hazardous fluid and somebody within reach of it.',
    'Risk is read from a documented 5x5 matrix, not multiplied, so a high-consequence section is never '
    + 'reported as low risk.',
    `Inspection interval is ${REMAINING_LIFE_FRACTION} times the remaining life, capped by risk level `
    + `(${Object.entries(MAX_INTERVAL_YEARS).map(([level, years]) => `${level} ${years} y`).join(', ')})`
    + `${record.maxIntervalYears === null ? '' : `, and by the stated regulatory limit of ${record.maxIntervalYears} y`}.`,
    'A section with no remaining-life figure receives the risk-based target interval, reported as a target '
    + 'rather than as a calculated one.',
    `Risk acceptance: ${Object.entries(RISK_ACCEPTANCE).map(([level, state]) => `${level} ${state}`).join(', ')}.`,
  ];
}

function limitationsOf(record: RbiRecord): string[] {
  const unreviewed = record.threats.filter((threat) => threat.relevance === 'unreviewed');
  const ruledOut = record.threats.filter((threat) => threat.relevance === 'not-credible');
  const judged = record.threats.filter(
    (threat) => threat.relevance !== 'not-credible' && !threatById(threat.id)?.measured,
  );

  const limits = [
    'This is a screening assessment. It ranks sections and proposes intervals; it does not produce a '
    + 'probability of failure in events per year and is not a quantitative API 581 analysis.',
    'The full risk-based inspection assessment — the damage mechanism review, the integrity operating '
    + 'windows, the programme documentation — is an RBI engineer\'s work. This does not replace it.',
    `Only metal loss is measured. The other ${judged.length} threat categories are scored from the review, `
    + 'which is engineering judgement recorded as such.',
    'Consequence categories are entered by the engineer and are not derived from inspection evidence.',
    'The pipe body only. Valves, flanges, gaskets and station equipment are outside what an in-line '
    + 'inspection reaches and are not ranked here.',
    'Intervals are recommendations for engineering review, not a substitute for a regulatory inspection '
    + 'requirement where one is shorter.',
  ];

  if (unreviewed.length > 0) {
    limits.push(
      `${unreviewed.length} threat(s) were never reviewed — ${unreviewed.map((threat) => threatLabel(threat.id)).join(', ')}. `
      + 'They are scored as unknowns, which is honest but weak: review them before acting on this ranking.',
    );
  }
  if (ruledOut.length > 0) {
    limits.push(
      `${ruledOut.length} threat(s) were ruled out and contribute nothing: `
      + `${ruledOut.map((threat) => threatLabel(threat.id)).join(', ')}. Their reasons are on the threat `
      + 'sheet and should be re-tested when the line or its surroundings change.',
    );
  }
  return limits;
}

/* ── One section ───────────────────────────────────────────────────────────── */

function buildSection(
  bucket: Bucket,
  record: RbiRecord,
  geometry: { outerDiameterMm: number; operatingPressureMpa: number },
  assessmentDateIso: string,
): RbiSectionResult {
  const measured = measuredMetalLoss(bucket);

  // A section holding only anomalies with no B31G result has no measured
  // probability. It is reported in the middle of the scale and its plan says the
  // evidence is missing — not scored 1, which would read as safe.
  const measuredCategory: RiskCategory = bucket.members.length === 0 ? 3 : measured.category;
  const threats = threatScores(record, measuredCategory, bucket.members.length > 0);

  const probabilityCategory = worstCategory([
    measuredCategory,
    ...threats.map((threat) => threat.category),
  ]);
  const governing = threats
    .filter((threat) => threat.category === probabilityCategory)
    .sort((left, right) => Number(right.measured) - Number(left.measured))[0] ?? null;

  const override = record.overrides.find((item) => item.sectionId === bucket.label) ?? null;
  const consequence = consequenceOf({
    fluid: record.fluid,
    toxic: record.toxic,
    population: override?.population ?? record.population,
    environment: override?.environment ?? record.environment,
    businessImpact: record.businessImpact,
    ...geometry,
  });

  const riskLevel = riskLevelOf(probabilityCategory, consequence.category);
  const interval = inspectionIntervalYears({
    riskLevel,
    remainingLifeYears: measured.shortestLife,
    regulatoryMaxYears: record.maxIntervalYears,
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
      threats,
      governingThreat: governing?.label ?? null,
      growthAssumed: measured.growthAssumed,
      unassessedCount: bucket.unassessed,
    },
    consequence: {
      category: consequence.category,
      drivers: consequence.drivers,
      overridden: override !== null
        && (override.population !== null || override.environment !== null),
    },
    riskLevel,
    acceptance: RISK_ACCEPTANCE[riskLevel],
    inspection: {
      intervalYears: interval.intervalYears,
      dueDateIso: addYearsIso(assessmentDateIso, interval.intervalYears),
      basis: interval.basis,
      recommendation: recommendationFor(riskLevel, interval.basis, bucket.unassessed, record),
    },
    governingFeature: measured.governingFeature,
  };
}

/**
 * The measured half: what the filed B31G assessment says about this section.
 *
 * The worst feature governs. An average would let one collapsed feature
 * disappear into a hundred healthy ones, which is the failure a ranking exists
 * to prevent.
 */
function measuredMetalLoss(bucket: Bucket): {
  category: RiskCategory;
  shortestLife: number | null;
  drivers: RbiDriver[];
  growthAssumed: boolean;
  governingFeature: RbiSectionResult['governingFeature'];
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
          ? 'No feature in this section produced an ERF.'
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
          ? 'No feature here produced a remaining-life figure; scored as unknown, not as low.'
          : `Shortest as-reported remnant life in this section`
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
          ? 'No depth was reported for any feature here.'
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
 * Every threat's contribution.
 *
 * The review is line-level, so each section carries the same list except the two
 * measured ones, which take that section's own B31G result. Those two share a
 * category, and the basis says why: a metal-loss run does not attribute the loss
 * it found between internal and external corrosion.
 */
function threatScores(
  record: RbiRecord,
  measuredCategory: RiskCategory,
  sectionHasFeatures: boolean,
): ThreatScore[] {
  const output: ThreatScore[] = [];

  for (const definition of THREATS) {
    const threat = record.threats.find((item) => item.id === definition.id);
    if (!threat || threat.relevance === 'not-credible') continue;

    if (definition.measured) {
      output.push({
        id: definition.id,
        label: definition.label,
        relevance: threat.relevance,
        category: sectionHasFeatures ? measuredCategory : 3,
        measured: sectionHasFeatures,
        basis: sectionHasFeatures
          ? 'Scored from the filed B31G assessment of this section. The metal-loss run does not attribute '
            + 'the loss it measured between internal and external corrosion, so both carry the same category.'
          : 'No assessed feature in this section, so the measured evidence is absent; scored as unknown.',
      });
      continue;
    }

    const scored = threatCategory(threat);
    if (scored === null) continue;
    output.push({
      id: definition.id,
      label: definition.label,
      relevance: threat.relevance,
      category: scored.category,
      measured: false,
      basis: scored.basis,
    });
  }

  return output;
}

/**
 * The recommendation, in words an engineer can act on.
 *
 * Deliberately not "monitor": every line of this is either an inspection with a
 * date or an intervention, because a plan whose action is to keep looking is not
 * a plan for a high-risk section.
 */
function recommendationFor(
  level: RiskLevel,
  basis: RbiSectionResult['inspection']['basis'],
  unassessedCount: number,
  record: RbiRecord,
): string {
  if (basis === 'immediate-action') {
    return 'Remaining life is exhausted at the assessed pressure. Reduce pressure or repair before the next '
      + 'inspection cycle; an interval is not an adequate response on its own.';
  }

  const gap = unassessedCount > 0
    ? ` ${unassessedCount.toLocaleString()} anomal${unassessedCount === 1 ? 'y' : 'ies'} here carried no B31G `
      + 'result, so this rests on less than the full population — recover the missing source data.'
    : '';

  const blind = record.threats.filter(
    (threat) => threat.relevance === 'active' && threat.coverage === 'none',
  );
  const blindText = blind.length > 0
    ? ` No inspection covers ${blind.map((threat) => threatLabel(threat.id).toLowerCase()).join(', ')}; `
      + 'the probability for those is an unknown, not a low.'
    : '';

  if (level === 'High') {
    return `In-line inspection or direct examination at the interval below, with a mitigation plan — pressure `
      + `reduction, repair, or recoating — prepared in parallel.${gap}${blindText}`;
  }
  if (level === 'Medium high') {
    return `Schedule the next in-line inspection at the interval below and confirm the corrosion rate against `
      + `the next run pair.${gap}${blindText}`;
  }
  if (level === 'Medium') {
    return `Include in the routine in-line inspection programme at the interval below.${gap}${blindText}`;
  }
  return `Routine inspection at the interval below is sufficient on current evidence.${gap}${blindText}`;
}
