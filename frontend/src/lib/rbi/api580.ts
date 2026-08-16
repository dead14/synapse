/**
 * The scoring rules, and nothing else.
 *
 * API 580 does not publish these numbers — it requires an owner-operator to
 * choose them and to write them down. So they are named constants with reasons
 * rather than literals buried in a scoring function, and every one is reproduced
 * in the assessment's own provenance, so an exported report can be checked
 * without reading this file.
 *
 * Pure functions throughout. Nothing here reads a date, a store, or the network.
 */

import { threatById } from './catalogues.ts';
import type {
  BusinessImpactClass,
  EnvironmentClass,
  PipelineFluid,
  PopulationClass,
  RbiDriver,
  RiskAcceptance,
  RiskCategory,
  RiskLevel,
  ThreatAssessment,
} from './types.ts';

export const PRACTICE = 'API RP 580, 4th edition (2021), with ASME B31.8S threat categories';
export const APPROACH = 'Semi-quantitative screening assessment';

/* ── Probability from measured metal loss ──────────────────────────────────── */

/**
 * The estimating repair factor: required pressure over safe pressure. At 1.0 the
 * safe pressure has fallen to the pressure the line is asked to hold, which is
 * the strongest signal a metal-loss assessment produces.
 */
export const ERF_BANDS: readonly { atOrAbove: number; category: RiskCategory }[] = [
  { atOrAbove: 1.0, category: 5 },
  { atOrAbove: 0.9, category: 4 },
  { atOrAbove: 0.8, category: 3 },
  { atOrAbove: 0.6, category: 2 },
  { atOrAbove: 0, category: 1 },
];

/** The same evidence expressed as time, which is what an interval is set against. */
export const REMAINING_LIFE_BANDS: readonly { belowYears: number; category: RiskCategory }[] = [
  { belowYears: 1, category: 5 },
  { belowYears: 3, category: 4 },
  { belowYears: 5, category: 3 },
  { belowYears: 10, category: 2 },
  { belowYears: Number.POSITIVE_INFINITY, category: 1 },
];

/** Depth as a fraction of wall. The project rejection line sits at 80 percent. */
export const DEPTH_BANDS: readonly { atOrAbove: number; category: RiskCategory }[] = [
  { atOrAbove: 80, category: 5 },
  { atOrAbove: 60, category: 4 },
  { atOrAbove: 40, category: 3 },
  { atOrAbove: 20, category: 2 },
  { atOrAbove: 0, category: 1 },
];

/* ── Probability from a reviewed threat ────────────────────────────────────── */

/**
 * What a threat is worth before the inspection is taken into account.
 *
 * Note the ceiling: an active threat starts at 4, not 5. Category 5 is reserved
 * for a measured condition at or past its limit, and a judgement — however
 * expert — is not that. A judged threat reaches 5 only by also being uninspected,
 * which is the combination that earns it.
 *
 * An unreviewed threat is scored in the middle. It is an unknown, and an unknown
 * is not a clear; scoring it 1 would let the threat nobody looked at appear to be
 * the safest thing on the line.
 */
export const RELEVANCE_CATEGORY: Record<ThreatAssessment['relevance'], RiskCategory | null> = {
  active: 4,
  possible: 2,
  unreviewed: 3,
  'not-credible': null,
};

/**
 * What the inspection coverage does to that figure.
 *
 * Inspection does not change the damage, only what is known about it. A method
 * that would have found the threat earns a category back; no inspection at all
 * costs one, because the damage state is unknown.
 */
export const COVERAGE_DELTA: Record<ThreatAssessment['coverage'], number> = {
  covered: -1,
  partial: 0,
  none: +1,
};

/** An active threat nobody has looked for cannot score below an unknown. */
export const UNINSPECTED_ACTIVE_FLOOR: RiskCategory = 3;

/* ── Consequence ───────────────────────────────────────────────────────────── */

const FLUID_HAZARD: Record<PipelineFluid, RiskCategory> = {
  'sour-gas': 5,
  lpg: 5,
  'sweet-gas': 4,
  'crude-oil': 4,
  condensate: 4,
  'refined-product': 3,
  'produced-water': 2,
  water: 1,
};

const POPULATION_SEVERITY: Record<PopulationClass, RiskCategory> = {
  urban: 5,
  suburban: 4,
  rural: 2,
  remote: 1,
};

const ENVIRONMENT_SEVERITY: Record<EnvironmentClass, RiskCategory> = {
  protected: 5,
  'surface-water': 4,
  groundwater: 4,
  soil: 2,
  none: 1,
};

const BUSINESS_SEVERITY: Record<BusinessImpactClass, RiskCategory> = {
  critical: 5,
  high: 4,
  moderate: 2,
  low: 1,
};

/**
 * The floor on exposure. Nowhere is genuinely unpopulated during an incident —
 * somebody has to walk up to it — and for a release that injures without needing
 * to ignite, that person is closer to the hazard.
 */
const RESPONDER_EXPOSURE: RiskCategory = 2;
const TOXIC_RESPONDER_EXPOSURE: RiskCategory = 3;

/**
 * The 5x5 matrix, probability down and consequence across.
 *
 * Written out rather than computed from the product of the two categories. A
 * matrix is a decision an operator signs, and the asymmetry is the decision: a
 * consequence-5 section is never reported as low risk however unlikely failure
 * is, which multiplying would have allowed.
 */
export const RISK_MATRIX: readonly (readonly RiskLevel[])[] = [
  /* P1 */ ['Low', 'Low', 'Low', 'Medium', 'Medium'],
  /* P2 */ ['Low', 'Low', 'Medium', 'Medium', 'Medium high'],
  /* P3 */ ['Low', 'Medium', 'Medium', 'Medium high', 'High'],
  /* P4 */ ['Medium', 'Medium', 'Medium high', 'High', 'High'],
  /* P5 */ ['Medium', 'Medium high', 'High', 'High', 'High'],
];

export const RISK_LEVELS: readonly RiskLevel[] = ['Low', 'Medium', 'Medium high', 'High'];

/**
 * Which levels the operator lives with.
 *
 * Fixed here rather than asked for, because this is a screening assessment and a
 * fifth dropdown for it would be four more decisions than the answer deserves.
 * A programme with its own corporate criteria applies them in the full
 * assessment; this scheme is stated on the report so the difference is visible.
 */
export const RISK_ACCEPTANCE: Record<RiskLevel, RiskAcceptance> = {
  Low: 'acceptable',
  Medium: 'acceptable',
  'Medium high': 'tolerable',
  High: 'unacceptable',
};

/** Maximum interval by risk level, in years, absent a stated regulatory limit. */
export const MAX_INTERVAL_YEARS: Record<RiskLevel, number> = {
  Low: 10,
  Medium: 7,
  'Medium high': 5,
  High: 2,
};

/**
 * Inspect at half the remaining life, so the line is looked at again while there
 * is still time to act on what is found. A floor on frequency, never a licence
 * to wait longer than the risk-based cap.
 */
export const REMAINING_LIFE_FRACTION = 0.5;

/* ── Scoring ───────────────────────────────────────────────────────────────── */

function clampCategory(value: number): RiskCategory {
  return Math.min(5, Math.max(1, Math.round(value))) as RiskCategory;
}

export function categoryFromErf(erf: number | null): RiskCategory {
  if (erf === null || !Number.isFinite(erf)) return 1;
  for (const band of ERF_BANDS) if (erf >= band.atOrAbove) return band.category;
  return 1;
}

export function categoryFromRemainingLife(years: number | null): RiskCategory {
  // No remaining-life figure is an unknown probability, not a low one. Scoring
  // it 1 would let a feature with no growth basis outrank one with a measured
  // thirty-year life.
  if (years === null || !Number.isFinite(years)) return 3;
  for (const band of REMAINING_LIFE_BANDS) if (years < band.belowYears) return band.category;
  return 1;
}

export function categoryFromDepth(depthPct: number | null): RiskCategory {
  if (depthPct === null || !Number.isFinite(depthPct)) return 1;
  for (const band of DEPTH_BANDS) if (depthPct >= band.atOrAbove) return band.category;
  return 1;
}

export function worstCategory(categories: readonly RiskCategory[]): RiskCategory {
  return categories.reduce<RiskCategory>((worst, item) => (item > worst ? item : worst), 1);
}

/**
 * A judged threat's contribution.
 *
 * Measured threats do not come through here — they are scored from the filed
 * B31G assessment, and discounting a measured result for the quality of the run
 * that measured it would apply the same evidence twice. Returns null where the
 * threat was ruled out, which contributes nothing.
 */
export function threatCategory(
  threat: ThreatAssessment,
): { category: RiskCategory; basis: string } | null {
  const base = RELEVANCE_CATEGORY[threat.relevance];
  if (base === null) return null;

  const delta = COVERAGE_DELTA[threat.coverage];
  let category = clampCategory(base + delta);
  if (threat.relevance === 'active' && threat.coverage === 'none'
    && category < UNINSPECTED_ACTIVE_FLOOR) {
    category = UNINSPECTED_ACTIVE_FLOOR;
  }

  const detectedBy = threatById(threat.id)?.detectedBy ?? 'a suitable method';
  const relevanceText = threat.relevance === 'unreviewed'
    ? 'Not reviewed, so the threat is scored as an unknown'
    : threat.relevance === 'active'
      ? 'Active on this line'
      : 'Credible but not observed';
  const coverageText = threat.coverage === 'covered'
    ? `inspected with a method that finds it (${detectedBy}), which earns a category back`
    : threat.coverage === 'partial'
      ? 'partly inspected, so no adjustment'
      : `not inspected for, so the damage state is unknown and the category rises`;

  return { category, basis: `${relevanceText}; ${coverageText}.` };
}

/**
 * Consequence of failure.
 *
 * Three components scored separately and taken at their worst: safety, the
 * environment, and the business. Separately, because they are reduced by
 * completely different actions — you lower a safety consequence by moving people
 * or shortening the release, and a business one by building a spare.
 *
 * Safety is the fluid hazard *bounded by* the exposure, not the worse of the
 * two. A hurt person needs both a hazardous fluid and somebody within reach of
 * it: a water main under a city centre is not a safety-5 event, and crude oil
 * forty kilometres from a road is not one either. Taking the worse of the two is
 * the obvious implementation and it flattens every section of a pipeline into a
 * single category, which is the one thing a consequence analysis must not do.
 */
export function consequenceOf(input: {
  fluid: PipelineFluid;
  toxic: boolean;
  population: PopulationClass;
  environment: EnvironmentClass;
  businessImpact: BusinessImpactClass;
  outerDiameterMm: number;
  operatingPressureMpa: number;
}): { category: RiskCategory; drivers: RbiDriver[] } {
  const fluid = FLUID_HAZARD[input.fluid] ?? 3;
  const population = POPULATION_SEVERITY[input.population] ?? 2;
  const environment = ENVIRONMENT_SEVERITY[input.environment] ?? 2;
  const business = BUSINESS_SEVERITY[input.businessImpact] ?? 2;

  // A toxic release needs no ignition and reaches further than a flammable one,
  // so as a hazard it cannot sit in the lower half of the scale.
  const hazard = input.toxic ? worstCategory([fluid, 4]) : fluid;
  const responderFloor = input.toxic ? TOXIC_RESPONDER_EXPOSURE : RESPONDER_EXPOSURE;
  const exposure = worstCategory([population, responderFloor]);
  const safety = Math.min(hazard, exposure) as RiskCategory;

  // Stored energy as a coarse release-scale proxy: a large high-pressure line
  // empties faster into all three consequences.
  const scale = (input.outerDiameterMm / 1000) * input.operatingPressureMpa;
  const scaleRaises = Number.isFinite(scale) && scale >= 3;

  const base = worstCategory([safety, environment, business]);
  const category = clampCategory(base + (scaleRaises ? 1 : 0));

  const driver = (
    id: string, label: string, value: number | null, unit: string,
    itemCategory: RiskCategory, basis: string, measured = false,
  ): RbiDriver => ({ id, label, value, unit, category: itemCategory, basis, measured });

  return {
    category,
    drivers: [
      driver('safety', 'Safety', null, 'category', safety,
        `${input.fluid.replace(/-/g, ' ')}${input.toxic ? ', toxic' : ''} carries a hazard of ${hazard}; `
        + `${input.population} surroundings and the responder floor give an exposure of ${exposure}. `
        + 'The lower of the two governs — a release needs both a hazardous fluid and somebody near it.'),
      driver('environment', 'Environment', null, 'category', environment,
        `Receptor stated as ${input.environment.replace(/-/g, ' ')}.`),
      driver('business', 'Business impact', null, 'category', business,
        `Stated as ${input.businessImpact}.`),
      driver('release-scale', 'Release scale', Number.isFinite(scale) ? Number(scale.toFixed(2)) : null,
        'm.MPa', scaleRaises ? 2 : 1,
        `${input.outerDiameterMm} mm at ${input.operatingPressureMpa} MPa `
        + `${scaleRaises ? 'raises the consequence by one category' : 'does not raise the consequence'}.`,
        true),
    ],
  };
}

export function riskLevelOf(probability: RiskCategory, consequence: RiskCategory): RiskLevel {
  return RISK_MATRIX[probability - 1][consequence - 1];
}

/**
 * The inspection interval, and the rule that produced it.
 *
 * Half the remaining life, capped by the risk-based maximum and then by any
 * regulatory limit. Where there is no remaining-life figure the cap is all there
 * is, and the result is reported as a target rather than as a calculated
 * interval — a default number presented as an answer is the most dangerous kind
 * of output.
 */
export function inspectionIntervalYears(input: {
  riskLevel: RiskLevel;
  remainingLifeYears: number | null;
  regulatoryMaxYears: number | null;
}): { intervalYears: number; basis: 'half-remaining-life' | 'risk-target-interval' | 'regulatory-limit' | 'immediate-action' } {
  const { riskLevel, remainingLifeYears, regulatoryMaxYears } = input;

  if (remainingLifeYears !== null && remainingLifeYears <= 0) {
    return { intervalYears: 0, basis: 'immediate-action' };
  }

  const riskCap = MAX_INTERVAL_YEARS[riskLevel];
  const legalCap = regulatoryMaxYears !== null && Number.isFinite(regulatoryMaxYears)
    && regulatoryMaxYears > 0
    ? regulatoryMaxYears
    : null;
  const cap = legalCap === null ? riskCap : Math.min(riskCap, legalCap);
  const capBasis = legalCap !== null && legalCap <= riskCap ? 'regulatory-limit' : 'risk-target-interval';

  if (remainingLifeYears === null || !Number.isFinite(remainingLifeYears)) {
    return { intervalYears: cap, basis: capBasis };
  }

  const halfLife = remainingLifeYears * REMAINING_LIFE_FRACTION;
  return halfLife <= cap
    ? { intervalYears: Number(halfLife.toFixed(1)), basis: 'half-remaining-life' }
    : { intervalYears: cap, basis: capBasis };
}

/** Adds whole and fractional years to a calendar date, in UTC. */
export function addYearsIso(dateIso: string, years: number): string | null {
  const parsed = new Date(`${dateIso}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  const whole = Math.trunc(years);
  const shifted = new Date(parsed);
  shifted.setUTCFullYear(shifted.getUTCFullYear() + whole);
  shifted.setUTCDate(shifted.getUTCDate() + Math.round((years - whole) * 365.25));
  return shifted.toISOString().slice(0, 10);
}
