/**
 * Risk-based inspection, built from a filed fitness-for-service assessment.
 *
 * The likelihood side of an API 580 assessment is where most RBI programmes are
 * weakest: it is usually a workshop opinion. Here it is not — the line has been
 * inspected, the metal loss has been measured, and a B31G assessment of that
 * metal loss has already been run and filed. Reading the filed assessment means
 * the likelihood is carried by evidence with provenance all the way back to a
 * feature in an ILI file, and the RBI cannot drift away from the FFS it claims
 * to be based on, because it is not a copy of it.
 *
 * The consequence side cannot come from the same place and is not pretended to:
 * nothing in an ILI run knows what the line carries or who lives beside it. It
 * is entered, and every entered value is reported as a driver beside the
 * measured ones so a reader can see which half of the risk is judgement.
 */

import type { FfsScreenedResult } from '../ffs/types.ts';
import type { RevivedFfsShareState } from '../ffs/shareState.ts';
import {
  API_580_EDITION,
  addYearsIso,
  categoryFromDepth,
  categoryFromErf,
  categoryFromRemainingLife,
  consequenceOf,
  inspectionIntervalYears,
  riskLevelOf,
  worstCategory,
  MAX_INTERVAL_YEARS,
  REMAINING_LIFE_FRACTION,
} from './api580.ts';
import type {
  RbiAssessment,
  RbiConsequenceInput,
  RbiInspectionPlan,
  RbiUnitResult,
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

/**
 * The recommendation, in words an engineer can act on.
 *
 * Deliberately not "monitor": every line of this is either an inspection with a
 * date or an intervention, because a plan whose action is to keep looking is not
 * a plan API 580 §16 would accept for a high-risk component.
 */
function recommendationFor(
  level: RiskLevel,
  basis: RbiInspectionPlan['basis'],
  unassessedCount: number,
): string {
  if (basis === 'immediate-action') {
    return 'Remaining life is exhausted at the assessed pressure. Reduce pressure or repair before the next '
      + 'inspection cycle; an inspection interval is not an adequate response on its own.';
  }
  const gap = unassessedCount > 0
    ? ` ${unassessedCount.toLocaleString()} anomal${unassessedCount === 1 ? 'y' : 'ies'} here carried no B31G `
      + 'result, so this likelihood is based on less than the full population — recover the missing source data.'
    : '';
  if (level === 'High') {
    return `In-line inspection or direct examination at the interval below, with a mitigation plan (pressure `
      + `reduction, repair, or recoating) prepared in parallel.${gap}`;
  }
  if (level === 'Medium high') {
    return `Schedule the next in-line inspection at the interval below and confirm the corrosion rate against `
      + `the next run pair.${gap}`;
  }
  if (level === 'Medium') {
    return `Include in the routine in-line inspection programme at the interval below.${gap}`;
  }
  return `Routine inspection at the interval below is sufficient on current evidence.${gap}`;
}

function unitLabel(section: string | undefined | null): string {
  const normalized = String(section ?? '').trim();
  return normalized === '' || normalized === '-' ? UNSECTIONED : normalized;
}

export interface BuildRbiInput {
  ffsSessionId: string | null;
  state: RevivedFfsShareState;
  screened: FfsScreenedResult[];
  consequence: RbiConsequenceInput;
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
  const { state, screened, consequence } = input;
  const assessmentDateIso = calendarDate(state.config.iliDate);
  const consequenceResult = consequenceOf(consequence);

  interface Bucket {
    label: string;
    members: FfsScreenedResult[];
    unassessed: number;
    fromM: number | null;
    toM: number | null;
  }
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
  // cannot raise a likelihood — there is no measurement to raise it with — but a
  // unit that is carrying them is a unit whose risk rests on partial evidence,
  // and every plan for it says so.
  for (const row of state.alignmentImport?.rejected ?? []) {
    const bucket = bucketFor(UNSECTIONED);
    bucket.unassessed += 1;
    extend(bucket, row.ldM ?? null);
  }

  const units: RbiUnitResult[] = [...buckets.values()]
    .filter((bucket) => bucket.members.length > 0 || bucket.unassessed > 0)
    .map((bucket) => buildUnit(bucket, consequenceResult, assessmentDateIso))
    .sort((left, right) => {
      const order: Record<RiskLevel, number> = { High: 0, 'Medium high': 1, Medium: 2, Low: 3 };
      return order[left.riskLevel] - order[right.riskLevel]
        || (left.fromM ?? 0) - (right.fromM ?? 0);
    });

  const byLevel: Record<RiskLevel, number> = { Low: 0, Medium: 0, 'Medium high': 0, High: 0 };
  for (const unit of units) byLevel[unit.riskLevel] += 1;

  return {
    ffsSessionId: input.ffsSessionId,
    lineName: state.config.lineName,
    assessmentDateIso,
    units,
    totals: {
      features: screened.length,
      unassessed: state.alignmentImport?.rejected?.length ?? 0,
      byLevel,
    },
    provenance: {
      practice: 'API 580',
      edition: API_580_EDITION,
      approach: 'semi-quantitative',
      rules: [
        'Likelihood is the worst of three measured drivers per unit: estimating repair factor (ERF), '
        + 'remaining life, and reported depth as a percentage of wall.',
        'Consequence is the worst of the stated fluid, population, environmental, and business classes, '
        + 'raised one category where bore × pressure is at or above 3 m·MPa.',
        'Risk is read from a documented 5×5 matrix; it is not the arithmetic product of the two categories.',
        `Inspection interval is ${REMAINING_LIFE_FRACTION} × remaining life, capped by the risk-based maximum `
        + `(${Object.entries(MAX_INTERVAL_YEARS).map(([level, years]) => `${level} ${years} y`).join(', ')}).`,
        'A unit with no remaining-life figure receives the risk-based target interval, reported as a target '
        + 'rather than as a calculated interval.',
      ],
      limitations: [
        'This is a semi-quantitative assessment in the sense of API 580 §14. It does not produce a probability '
        + 'of failure in events per year and is not an API 581 quantitative analysis.',
        'The likelihood covers metal loss assessed to ASME B31G only. Cracking, dents, external interference, '
        + 'geohazard, and third-party damage are not represented.',
        'Consequence categories are entered by the engineer and are not derived from inspection evidence.',
        'Intervals are recommendations for engineering review, not a substitute for a jurisdictional '
        + 'inspection requirement where one is shorter.',
      ],
    },
  };
}

function buildUnit(
  bucket: { label: string; members: FfsScreenedResult[]; unassessed: number; fromM: number | null; toM: number | null },
  consequence: ReturnType<typeof consequenceOf>,
  assessmentDateIso: string,
): RbiUnitResult {
  // The worst feature governs the unit. An average would let one collapsed
  // feature disappear into a hundred healthy ones, which is the failure mode a
  // risk ranking exists to prevent.
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
  const likelihoodCategory: RiskCategory = bucket.members.length === 0
    // A unit holding only unassessed anomalies has no measured likelihood at
    // all. It is reported in the middle of the scale and its plan says the
    // evidence is missing — not scored 1, which would read as "safe".
    ? 3
    : worstCategory([erfCategory, lifeCategory, depthCategory]);

  const riskLevel = riskLevelOf(likelihoodCategory, consequence.category);
  const interval = inspectionIntervalYears(riskLevel, shortestLife);

  return {
    id: bucket.label,
    label: bucket.label,
    fromM: bucket.fromM,
    toM: bucket.toM,
    featureCount: bucket.members.length,
    likelihood: {
      category: likelihoodCategory,
      growthAssumed,
      unassessedCount: bucket.unassessed,
      drivers: [
        {
          id: 'erf',
          label: 'Worst estimated repair factor',
          value: worstErf === null ? null : Number(worstErf.toFixed(3)),
          unit: 'ERF',
          category: erfCategory,
          basis: worstErf === null
            ? 'No feature in this unit produced an ERF.'
            : `Highest ERF among ${bucket.members.length.toLocaleString()} assessed feature(s).`,
        },
        {
          id: 'remaining-life',
          label: 'Shortest remaining life',
          value: shortestLife === null ? null : Number(shortestLife.toFixed(1)),
          unit: 'years',
          category: lifeCategory,
          basis: shortestLife === null
            ? 'No feature in this unit produced a remaining-life figure; scored as unknown, not as low.'
            : `Shortest as-reported remnant life in this unit, from the filed B31G assessment.`,
        },
        {
          id: 'depth',
          label: 'Deepest reported metal loss',
          value: deepest === null ? null : Number(deepest.toFixed(1)),
          unit: '%WT',
          category: depthCategory,
          basis: deepest === null
            ? 'No depth was reported for any feature in this unit.'
            : 'Deepest depth as reported by the inspection run.',
        },
      ],
    },
    consequence: { category: consequence.category, drivers: consequence.drivers },
    riskLevel,
    inspection: {
      intervalYears: interval.intervalYears,
      dueDateIso: interval.intervalYears === null
        ? null
        : addYearsIso(assessmentDateIso, interval.intervalYears),
      basis: interval.basis,
      recommendation: recommendationFor(riskLevel, interval.basis, bucket.unassessed),
    },
    governingFeature: governing === null ? null : {
      featureId: governing.nominal.featureId,
      ldM: finite(governing.nominal.ld),
      erf: Number.isFinite(governing.nominal.ERF) ? governing.nominal.ERF : null,
      remnantLifeYears: governing.nominal.remnantLife?.years ?? null,
      depthPct: finite(governing.nominal.maxDepthPct),
    },
  };
}
