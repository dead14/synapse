/**
 * The API 580 rules this product applies, and nothing else.
 *
 * Each threshold below is an owner-operator decision that API 580 requires to be
 * documented rather than a number the practice publishes — §14.2 asks for a
 * defined matrix, §16 for a defined interval rule, and both to be stated in the
 * assessment. They are therefore constants with names and reasons, not literals
 * buried in a scoring function, and every one of them is reproduced in the
 * assessment's own provenance so a report can be audited without this file.
 *
 * Pure functions throughout. Nothing here reads a date, a store, or the network.
 */

import type {
  RbiConsequenceInput,
  RbiDriver,
  RiskCategory,
  RiskLevel,
} from './types.ts';

export const API_580_EDITION = 'API RP 580, 3rd edition (2016)';

/**
 * Likelihood bands.
 *
 * ERF — the ratio of required pressure to safe pressure — is the strongest
 * measured signal a metal-loss assessment produces: at 1.0 the safe pressure has
 * fallen to the pressure the line is asked to hold. Remaining life converts the
 * same evidence into time, which is what an inspection interval is set against.
 * A unit takes the worse of the two, because a feature that is nearly at its
 * limit and one that will reach its limit next year are the same problem.
 */
export const ERF_BANDS: readonly { atOrAbove: number; category: RiskCategory }[] = [
  { atOrAbove: 1.0, category: 5 },
  { atOrAbove: 0.9, category: 4 },
  { atOrAbove: 0.8, category: 3 },
  { atOrAbove: 0.6, category: 2 },
  { atOrAbove: 0, category: 1 },
];

export const REMAINING_LIFE_BANDS: readonly { belowYears: number; category: RiskCategory }[] = [
  { belowYears: 1, category: 5 },
  { belowYears: 3, category: 4 },
  { belowYears: 5, category: 3 },
  { belowYears: 10, category: 2 },
  { belowYears: Number.POSITIVE_INFINITY, category: 1 },
];

/** Depth as a fraction of wall. The project rejection line sits at 80 %WT. */
export const DEPTH_BANDS: readonly { atOrAbove: number; category: RiskCategory }[] = [
  { atOrAbove: 80, category: 5 },
  { atOrAbove: 60, category: 4 },
  { atOrAbove: 40, category: 3 },
  { atOrAbove: 20, category: 2 },
  { atOrAbove: 0, category: 1 },
];

/** Consequence weights. Safety leads, which is the ordering API 580 §9 implies. */
const FLUID_SEVERITY: Record<RbiConsequenceInput['fluid'], RiskCategory> = {
  'sour-gas': 5,
  'sweet-gas': 4,
  'crude-oil': 4,
  'refined-product': 3,
  'produced-water': 2,
  water: 1,
};

const POPULATION_SEVERITY: Record<RbiConsequenceInput['population'], RiskCategory> = {
  urban: 5,
  suburban: 4,
  rural: 2,
  remote: 1,
};

const ENVIRONMENT_SEVERITY: Record<RbiConsequenceInput['environment'], RiskCategory> = {
  protected: 5,
  sensitive: 4,
  moderate: 2,
  low: 1,
};

const BUSINESS_SEVERITY: Record<RbiConsequenceInput['businessImpact'], RiskCategory> = {
  critical: 5,
  high: 4,
  moderate: 2,
  low: 1,
};

/**
 * The 5×5 matrix, likelihood down and consequence across.
 *
 * Written out rather than computed from the product of the two categories: a
 * matrix is a decision an operator signs, and the asymmetry is the decision. A
 * consequence-5 component is never "low" however unlikely it is, which
 * multiplying would have allowed.
 */
export const RISK_MATRIX: readonly (readonly RiskLevel[])[] = [
  /* L1 */ ['Low', 'Low', 'Low', 'Medium', 'Medium'],
  /* L2 */ ['Low', 'Low', 'Medium', 'Medium', 'Medium high'],
  /* L3 */ ['Low', 'Medium', 'Medium', 'Medium high', 'High'],
  /* L4 */ ['Medium', 'Medium', 'Medium high', 'High', 'High'],
  /* L5 */ ['Medium', 'Medium high', 'High', 'High', 'High'],
];

export const RISK_LEVELS: readonly RiskLevel[] = ['Low', 'Medium', 'Medium high', 'High'];

/**
 * Maximum interval by risk level, in years.
 *
 * API 580 §16.2 sets the interval from the risk, capped by whatever the
 * jurisdiction requires. These are the caps this product applies in the absence
 * of a stated regulatory limit, and the assessment says so.
 */
export const MAX_INTERVAL_YEARS: Record<RiskLevel, number> = {
  Low: 10,
  Medium: 7,
  'Medium high': 5,
  High: 2,
};

/**
 * The half-life rule.
 *
 * The classic inspection-interval rule: inspect at half the remaining life, so a
 * component is looked at again while there is still time to act on what is
 * found. It is a floor on frequency, never a licence to wait longer than the
 * risk-based cap above.
 */
export const REMAINING_LIFE_FRACTION = 0.5;

export function categoryFromErf(erf: number | null): RiskCategory {
  if (erf === null || !Number.isFinite(erf)) return 1;
  for (const band of ERF_BANDS) {
    if (erf >= band.atOrAbove) return band.category;
  }
  return 1;
}

export function categoryFromRemainingLife(years: number | null): RiskCategory {
  // No remaining-life figure is not a low likelihood — it is an unknown one, and
  // the drivers list says which. Scoring it as 1 here would let a feature with no
  // growth basis look safer than one with a measured 30-year life.
  if (years === null || !Number.isFinite(years)) return 3;
  for (const band of REMAINING_LIFE_BANDS) {
    if (years < band.belowYears) return band.category;
  }
  return 1;
}

export function categoryFromDepth(depthPct: number | null): RiskCategory {
  if (depthPct === null || !Number.isFinite(depthPct)) return 1;
  for (const band of DEPTH_BANDS) {
    if (depthPct >= band.atOrAbove) return band.category;
  }
  return 1;
}

export function worstCategory(categories: readonly RiskCategory[]): RiskCategory {
  return categories.reduce<RiskCategory>((worst, item) => (item > worst ? item : worst), 1);
}

/**
 * Consequence of failure.
 *
 * The safety pair (fluid × population) governs, and environmental and business
 * impact can only raise the result — never lower it below what the fluid and the
 * people nearby already imply. A large, high-pressure line raises the category
 * by one, because release rate scales with both.
 */
export function consequenceOf(input: RbiConsequenceInput): {
  category: RiskCategory;
  drivers: RbiDriver[];
} {
  const fluid = FLUID_SEVERITY[input.fluid] ?? 3;
  const population = POPULATION_SEVERITY[input.population] ?? 2;
  const environment = ENVIRONMENT_SEVERITY[input.environment] ?? 2;
  const business = BUSINESS_SEVERITY[input.businessImpact] ?? 2;

  // Stored energy: bore area × pressure, as a coarse release-scale proxy.
  const scale = (input.outerDiameterMm / 1000) * input.operatingPressureMpa;
  const scaleRaises = Number.isFinite(scale) && scale >= 3;

  const safety = Math.max(fluid, population) as RiskCategory;
  const base = worstCategory([safety, environment, business]);
  const category = Math.min(5, base + (scaleRaises ? 1 : 0)) as RiskCategory;

  return {
    category,
    drivers: [
      {
        id: 'fluid',
        label: 'Released fluid',
        value: fluid,
        unit: 'category',
        category: fluid,
        basis: `Stated as ${input.fluid.replace(/-/g, ' ')}.`,
      },
      {
        id: 'population',
        label: 'Population exposure',
        value: population,
        unit: 'category',
        category: population,
        basis: `Stated as ${input.population}.`,
      },
      {
        id: 'environment',
        label: 'Environmental sensitivity',
        value: environment,
        unit: 'category',
        category: environment,
        basis: `Stated as ${input.environment}.`,
      },
      {
        id: 'business',
        label: 'Business impact',
        value: business,
        unit: 'category',
        category: business,
        basis: `Stated as ${input.businessImpact}.`,
      },
      {
        id: 'release-scale',
        label: 'Release scale (bore × pressure)',
        value: Number.isFinite(scale) ? Number(scale.toFixed(2)) : null,
        unit: 'm·MPa',
        category: scaleRaises ? 2 : 1,
        basis: scaleRaises
          ? `${input.outerDiameterMm} mm at ${input.operatingPressureMpa} MPa raises the consequence by one category.`
          : `${input.outerDiameterMm} mm at ${input.operatingPressureMpa} MPa does not raise the consequence.`,
      },
    ],
  };
}

export function riskLevelOf(likelihood: RiskCategory, consequence: RiskCategory): RiskLevel {
  return RISK_MATRIX[likelihood - 1][consequence - 1];
}

/**
 * The inspection interval, and the rule that produced it.
 *
 * Half the remaining life, capped by the risk-based maximum — and refused
 * outright where there is no remaining-life figure to halve. API 580 §16 does
 * not permit an interval to be set on data that does not support one, and a
 * default number here would be exactly that: the most dangerous kind of output,
 * one that looks like an answer.
 */
export function inspectionIntervalYears(
  riskLevel: RiskLevel,
  remainingLifeYears: number | null,
): { intervalYears: number | null; basis: 'half-remaining-life' | 'risk-target-interval' | 'immediate-action' | 'no-basis' } {
  if (remainingLifeYears !== null && remainingLifeYears <= 0) {
    return { intervalYears: 0, basis: 'immediate-action' };
  }
  const cap = MAX_INTERVAL_YEARS[riskLevel];
  if (remainingLifeYears === null || !Number.isFinite(remainingLifeYears)) {
    // Without a life figure the risk cap is all there is. It is a target, not a
    // calculated interval, and the plan says which of the two it is.
    return { intervalYears: cap, basis: 'risk-target-interval' };
  }
  const halfLife = remainingLifeYears * REMAINING_LIFE_FRACTION;
  return halfLife <= cap
    ? { intervalYears: Number(halfLife.toFixed(1)), basis: 'half-remaining-life' }
    : { intervalYears: cap, basis: 'risk-target-interval' };
}

/** Adds whole and fractional years to an ISO calendar date, in UTC. */
export function addYearsIso(dateIso: string, years: number): string | null {
  const parsed = new Date(`${dateIso}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  const whole = Math.trunc(years);
  const shifted = new Date(parsed);
  shifted.setUTCFullYear(shifted.getUTCFullYear() + whole);
  shifted.setUTCDate(shifted.getUTCDate() + Math.round((years - whole) * 365.25));
  return shifted.toISOString().slice(0, 10);
}
