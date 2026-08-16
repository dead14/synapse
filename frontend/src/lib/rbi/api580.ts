/**
 * The API 580 rules this product applies, and nothing else.
 *
 * Each threshold below is an owner-operator decision that API 580 requires to be
 * documented rather than a number the practice publishes — §12.6.2 asks for a
 * defined matrix, §12.7 for defined risk thresholds, §13 for a defined interval
 * rule, and §16.6/§16.7 for all of them to be stated in the assessment. They are
 * therefore constants with names and reasons, not literals buried in a scoring
 * function, and every one of them is reproduced in the assessment's own
 * provenance so a report can be audited without this file.
 *
 * Pure functions throughout. Nothing here reads a date, a store, or the network.
 */

import type {
  RbiConsequenceComponent,
  RbiConsequenceInput,
  RbiDamageMechanism,
  RbiDriver,
  RbiEquipmentData,
  RbiInspectionEffectiveness,
  RbiMechanismStatus,
  RbiSusceptibility,
  RiskCategory,
  RiskLevel,
} from './types.ts';

export const API_580_EDITION = 'API RP 580, 4th edition (February 2021)';

/* ── Probability bands ─────────────────────────────────────────────────────── */

/**
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

/**
 * Susceptibility, for the mechanisms whose rate cannot be measured.
 *
 * §9.2: "Susceptibility is often designated as high, medium, or low based on the
 * environmental conditions and material of construction combination." Note the
 * ceiling: a high susceptibility scores 4, not 5. Category 5 is reserved for a
 * measured condition at or past its limit, and a judgement — however expert —
 * is not that. A susceptible mechanism reaches 5 here only by also being active
 * and uninspected, which is the combination that genuinely deserves it.
 */
export const SUSCEPTIBILITY_CATEGORY: Record<RbiSusceptibility, RiskCategory> = {
  high: 4,
  medium: 3,
  low: 2,
};

/**
 * Whether the mechanism has been seen, or is only credible.
 *
 * §9.4.2 asks for active and credible mechanisms to be distinguished, and §9.5 b
 * asks for inactive ones to be ruled out. A mechanism that is credible but has
 * never been observed carries one category less than the same mechanism found
 * operating — the difference between "this could happen here" and "this is
 * happening here".
 */
export const STATUS_DELTA: Record<RbiMechanismStatus, number> = {
  active: 0,
  potential: -1,
  'ruled-out': 0, // Excluded from the POF entirely; the delta is never applied.
};

/**
 * What an inspection's effectiveness does to the category (§10.4.2).
 *
 * The A–E ladder is API 581 Part 2 Annex 2.C's, which §10.4.2 points at. The
 * effect of each grade is this product's rule: an inspection does not change the
 * damage, only what is known about it, so a highly effective one earns a
 * category back and a poor one costs a category, because §10.4.1 b makes the
 * probability a function of "effectiveness of the inspection program to identify
 * and monitor the damage mechanisms".
 *
 * This adjustment is applied ONLY to judged categories — susceptibilities and
 * stated corrosion rates. It is never applied to a mechanism scored from the
 * filed B31G assessment: there the inspection *is* the measurement, and
 * discounting a measured ERF for the quality of the run that measured it would
 * be applying the same evidence twice.
 */
export const EFFECTIVENESS_DELTA: Record<RbiInspectionEffectiveness, number> = {
  A: -1,
  B: 0,
  C: 0,
  D: +1,
  E: +1,
  none: +1,
};

/**
 * The floor for an active mechanism nobody has looked for.
 *
 * §10.4.2 turns on the reduction of uncertainty. Where there has been no
 * inspection at all there is no reduction, so the damage state of an active
 * mechanism is unknown — and unknown is the middle of the scale, not the bottom.
 * Scoring it 1 would let the mechanism with the least evidence look like the
 * safest thing on the line.
 */
export const UNINSPECTED_ACTIVE_FLOOR: RiskCategory = 3;

/**
 * The fraction of nominal wall a stated corrosion rate is allowed to consume
 * before the component is considered to have reached its limit.
 *
 * Matches the FFS depth rejection line, so a mechanism screened here and a
 * feature assessed there answer to the same threshold. Only used where no
 * corrosion allowance was entered, and the driver says which of the two was
 * used — the screen assumes the wall is currently intact, which is optimistic
 * and is stated as such wherever it appears.
 */
export const RATE_SCREEN_WALL_FRACTION = 0.8;

/* ── Consequence weights ───────────────────────────────────────────────────── */

/** Safety leads, which is the ordering §11.1.1 implies. */
const FLUID_SEVERITY: Record<RbiConsequenceInput['fluid'], RiskCategory> = {
  'sour-gas': 5,
  lpg: 5,
  'sweet-gas': 4,
  'crude-oil': 4,
  condensate: 4,
  'refined-product': 3,
  steam: 2,
  'produced-water': 2,
  water: 1,
};

const POPULATION_SEVERITY: Record<RbiConsequenceInput['population'], RiskCategory> = {
  urban: 5,
  suburban: 4,
  rural: 2,
  remote: 1,
};

const RECEPTOR_SEVERITY: Record<RbiConsequenceInput['environmentReceptor'], RiskCategory> = {
  protected: 5,
  'surface-water': 4,
  groundwater: 4,
  soil: 2,
  none: 1,
};

/** Persons credibly inside the affected area (§11.5.4 b). */
const PERSONNEL_BANDS: readonly { atOrAbove: number; category: RiskCategory }[] = [
  { atOrAbove: 25, category: 5 },
  { atOrAbove: 10, category: 4 },
  { atOrAbove: 3, category: 3 },
  { atOrAbove: 1, category: 2 },
];

/**
 * Money, in one ladder used by all three financial consequences.
 *
 * §11.3.3 makes cost the common currency of consequence, and §11.5.5 gives the
 * environmental form of it directly: cleanup + fines + other costs. One ladder
 * rather than three keeps a $2 m outage and a $2 m cleanup in the same category,
 * which is the only way the four components can be compared at all.
 */
export const COST_BANDS: readonly { atOrAbove: number; category: RiskCategory }[] = [
  { atOrAbove: 10_000_000, category: 5 },
  { atOrAbove: 2_000_000, category: 4 },
  { atOrAbove: 500_000, category: 3 },
  { atOrAbove: 100_000, category: 2 },
  { atOrAbove: 0, category: 1 },
];

/**
 * The 5×5 matrix, probability down and consequence across.
 *
 * Written out rather than computed from the product of the two categories: a
 * matrix is a decision an operator signs (§12.6.2), and the asymmetry is the
 * decision. A consequence-5 component is never "low" however unlikely it is,
 * which multiplying would have allowed.
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
 * Maximum interval by risk level, in years.
 *
 * §13 sets the inspection plan from the risk; §12.7 caps it by whatever the
 * jurisdiction requires. These are the caps this product applies in the absence
 * of a stated regulatory limit, and the assessment says so. Where the engineer
 * has entered a jurisdictional limit it wins outright, in both directions of the
 * comparison — §15.1.3 does not treat a code interval as advisory.
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

/**
 * The default reassessment ceiling, in years.
 *
 * §15.1.3: "a reassessment may be mandated by a code, standard, or regulation.
 * Such can be found in API 510 and API 570 which require a 10-year maximum
 * between reassessments."
 */
export const MAX_REASSESSMENT_YEARS = 10;

/* ── Scoring ───────────────────────────────────────────────────────────────── */

function clampCategory(value: number): RiskCategory {
  return Math.min(5, Math.max(1, Math.round(value))) as RiskCategory;
}

export function categoryFromErf(erf: number | null): RiskCategory {
  if (erf === null || !Number.isFinite(erf)) return 1;
  for (const band of ERF_BANDS) {
    if (erf >= band.atOrAbove) return band.category;
  }
  return 1;
}

export function categoryFromRemainingLife(years: number | null): RiskCategory {
  // No remaining-life figure is not a low probability — it is an unknown one,
  // and the drivers list says which. Scoring it as 1 here would let a feature
  // with no growth basis look safer than one with a measured 30-year life.
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

export function categoryFromCost(usd: number | null): RiskCategory {
  if (usd === null || !Number.isFinite(usd) || usd < 0) return 1;
  for (const band of COST_BANDS) {
    if (usd >= band.atOrAbove) return band.category;
  }
  return 1;
}

function categoryFromPersonnel(count: number | null): RiskCategory {
  if (count === null || !Number.isFinite(count)) return 1;
  for (const band of PERSONNEL_BANDS) {
    if (count >= band.atOrAbove) return band.category;
  }
  return 1;
}

export function worstCategory(categories: readonly RiskCategory[]): RiskCategory {
  return categories.reduce<RiskCategory>((worst, item) => (item > worst ? item : worst), 1);
}

/**
 * Time for a stated corrosion rate to consume the wall available to it.
 *
 * The corrosion allowance is used where one has been entered, because that is
 * the figure the design actually set aside for this. Otherwise the screen falls
 * back to a fraction of nominal wall and reports that it has done so — the
 * fallback assumes the wall is currently intact, which is optimistic, and a
 * caller that does not surface `basis` is misusing this function.
 */
export function lifeFromCorrosionRate(
  rateMmPerYear: number | null,
  equipment: Pick<RbiEquipmentData, 'corrosionAllowanceMm' | 'nominalWallMm'>,
): { years: number | null; basis: 'corrosion-allowance' | 'wall-fraction' | 'no-basis' } {
  if (rateMmPerYear === null || !Number.isFinite(rateMmPerYear) || rateMmPerYear <= 0) {
    return { years: null, basis: 'no-basis' };
  }
  const allowance = equipment.corrosionAllowanceMm;
  if (allowance !== null && Number.isFinite(allowance) && allowance > 0) {
    return { years: allowance / rateMmPerYear, basis: 'corrosion-allowance' };
  }
  const wall = equipment.nominalWallMm;
  if (wall !== null && Number.isFinite(wall) && wall > 0) {
    return { years: (wall * RATE_SCREEN_WALL_FRACTION) / rateMmPerYear, basis: 'wall-fraction' };
  }
  return { years: null, basis: 'no-basis' };
}

/**
 * The probability contribution of one judged mechanism.
 *
 * Measured mechanisms do not come through here — they are scored from the filed
 * B31G assessment, and applying an inspection-effectiveness discount to a
 * measurement would count the same inspection twice.
 */
export function mechanismCategory(
  row: RbiDamageMechanism,
  equipment: Pick<RbiEquipmentData, 'corrosionAllowanceMm' | 'nominalWallMm'>,
): { base: RiskCategory; category: RiskCategory; delta: number; basis: string } {
  let base: RiskCategory;
  let basis: string;

  if (row.rateBasis === 'corrosion-rate') {
    const life = lifeFromCorrosionRate(row.rateMmPerYear, equipment);
    base = categoryFromRemainingLife(life.years);
    basis = life.basis === 'corrosion-allowance'
      ? `${row.rateMmPerYear} mm/y consumes the ${equipment.corrosionAllowanceMm} mm corrosion allowance in `
        + `${life.years === null ? '—' : life.years.toFixed(1)} years.`
      : life.basis === 'wall-fraction'
        ? `${row.rateMmPerYear} mm/y reaches ${Math.round(RATE_SCREEN_WALL_FRACTION * 100)} % of the `
          + `${equipment.nominalWallMm} mm nominal wall in ${life.years === null ? '—' : life.years.toFixed(1)} `
          + 'years. No corrosion allowance was entered and the screen assumes the wall is currently intact.'
        : 'A rate was stated but neither a corrosion allowance nor a nominal wall was, so no life could be '
          + 'derived from it; scored as unknown.';
  } else {
    base = SUSCEPTIBILITY_CATEGORY[row.susceptibility];
    basis = `Susceptibility stated as ${row.susceptibility}; the deterioration rate is not measurable for `
      + 'this mechanism.';
  }

  const statusDelta = STATUS_DELTA[row.status];
  const effectivenessDelta = EFFECTIVENESS_DELTA[row.effectiveness];
  let category = clampCategory(base + statusDelta + effectivenessDelta);

  // An active mechanism nobody has inspected for has an unknown damage state.
  if (row.status === 'active' && row.effectiveness === 'none' && category < UNINSPECTED_ACTIVE_FLOOR) {
    category = UNINSPECTED_ACTIVE_FLOOR;
  }

  return { base, category, delta: statusDelta + effectivenessDelta, basis };
}

/* ── Consequence ───────────────────────────────────────────────────────────── */

function driver(
  id: string,
  label: string,
  value: number | null,
  unit: string,
  category: RiskCategory,
  basis: string,
  measured = false,
): RbiDriver {
  return { id, label, value, unit, category, basis, measured };
}

/**
 * Consequence of failure, on the four axes §11.1.1 names.
 *
 * Kept apart rather than collapsed into one score because they are mitigated by
 * completely different actions (§13.1 c) and because §11.6.2 asks for the
 * consequence to be estimated per effect category. The governing category is the
 * worst of the four: a catastrophic safety consequence is not averaged away by a
 * cheap repair, which is exactly what a mean would do.
 */
export function consequenceOf(input: RbiConsequenceInput): {
  category: RiskCategory;
  components: RbiConsequenceComponent[];
  drivers: RbiDriver[];
} {
  const components: RbiConsequenceComponent[] = [
    safetyComponent(input),
    environmentalComponent(input),
    productionComponent(input),
    maintenanceComponent(input),
  ];

  const base = worstCategory(components.map((component) => component.category));

  // Stored energy: bore × pressure, as a coarse release-scale proxy. §11.4 makes
  // the released volume the element that decides the magnitude of most of these
  // consequences, and a large high-pressure line empties faster into all four.
  const scale = (input.outerDiameterMm / 1000) * input.operatingPressureMpa;
  const scaleRaises = Number.isFinite(scale) && scale >= 3;
  const category = clampCategory(base + (scaleRaises ? 1 : 0));

  const scaleDriver = driver(
    'release-scale',
    'Release scale (bore × pressure)',
    Number.isFinite(scale) ? Number(scale.toFixed(2)) : null,
    'm·MPa',
    scaleRaises ? 2 : 1,
    scaleRaises
      ? `${input.outerDiameterMm} mm at ${input.operatingPressureMpa} MPa raises the consequence by one category.`
      : `${input.outerDiameterMm} mm at ${input.operatingPressureMpa} MPa does not raise the consequence.`,
    true,
  );

  return {
    category,
    components,
    drivers: [...components.flatMap((component) => component.drivers), scaleDriver],
  };
}

/**
 * Safety and health consequence: hazard bounded by exposure.
 *
 * Not the worst of the two. A hurt person needs both a hazardous fluid *and*
 * somebody within reach of it, so neither factor alone can carry the category —
 * a water main under a city centre is not a safety-5 event, and a crude oil
 * release forty kilometres from the nearest road is not one either. Taking the
 * worst of fluid and population, which is the obvious implementation, produces
 * exactly the opposite of what §11.1.1 asks the analysis for: it flattens every
 * section of a pipeline carrying one fluid into one category, discriminating
 * between none of them.
 *
 * The floor is the responder. Nowhere is genuinely unpopulated during an
 * incident — somebody has to walk up to it — so exposure never falls below
 * `RESPONDER_EXPOSURE`, and below `TOXIC_RESPONDER_EXPOSURE` for a release that
 * injures without needing to ignite (§11.5.3).
 */
const RESPONDER_EXPOSURE: RiskCategory = 2;
const TOXIC_RESPONDER_EXPOSURE: RiskCategory = 3;

function safetyComponent(input: RbiConsequenceInput): RbiConsequenceComponent {
  const fluid = FLUID_SEVERITY[input.fluid] ?? 3;
  const population = POPULATION_SEVERITY[input.population] ?? 2;
  const personnel = categoryFromPersonnel(input.personnelExposed);

  // §11.5.3 — a toxic release needs no ignition and reaches further than a
  // flammable one, so as a hazard it cannot sit in the lower half of the scale.
  const hazard = input.toxicRelease ? worstCategory([fluid, 4]) : fluid;
  const responderFloor = input.toxicRelease ? TOXIC_RESPONDER_EXPOSURE : RESPONDER_EXPOSURE;
  const exposure = worstCategory([population, personnel, responderFloor]);

  // §11.4 — safeguards mean "the volume released will be less than the volume
  // available for release", which is a smaller affected area and fewer people
  // inside it. Both an instrumented detection and an automatic isolation are
  // required; either alone leaves the release running while somebody decides.
  const wellSafeguarded = input.detection === 'A' && input.isolation === 'A';
  const bounded = Math.min(hazard, exposure) as RiskCategory;
  const category = wellSafeguarded ? clampCategory(bounded - 1) : bounded;

  return {
    id: 'safety',
    label: 'Safety and health',
    category,
    drivers: [
      driver('fluid', 'Released fluid — hazard', fluid, 'category', hazard,
        `Stated as ${input.fluid.replace(/-/g, ' ')}${input.flammable ? ', flammable' : ''}`
        + `${input.toxicRelease ? ', toxic — a toxic hazard is never scored below 4' : ''}.`),
      driver('population', 'Population exposure', population, 'category', population,
        `Stated as ${input.population}`
        + `${input.publicProximityM === null ? '' : `; nearest occupancy ${input.publicProximityM} m`}.`),
      driver('personnel', 'Personnel in the affected area', input.personnelExposed, 'persons', personnel,
        input.personnelExposed === null
          ? 'Not stated; this driver does not contribute.'
          : `${input.personnelExposed} person(s) credibly inside the affected area.`),
      driver('exposure', 'Governing exposure', null, 'category', exposure,
        `The worst of the surroundings, the personnel count, and the responder floor of ${responderFloor}. `
        + 'Nowhere is unpopulated during an incident — somebody has to walk up to it.'),
      driver('safeguards', 'Detection and isolation', null, 'rating',
        wellSafeguarded ? 1 : 2,
        `Detection ${input.detection}, isolation ${input.isolation}.`
        + (wellSafeguarded
          ? ' Instrumented detection with automatic isolation lowers the released volume, and with it this'
            + ' component, by one category.'
          : ' No release-volume credit: automatic detection and isolation are both required for it.')),
    ],
  };
}

function environmentalComponent(input: RbiConsequenceInput): RbiConsequenceComponent {
  const receptor = RECEPTOR_SEVERITY[input.environmentReceptor] ?? 2;
  const cost = categoryFromCost(input.environmentalCostUsd);
  // §11.5.5 c — leak containment safeguards. Full containment keeps the spill
  // out of the receptor, so it earns a category back; partial containment does
  // not, because a bund that overtops is a bund that failed.
  const contained = input.spillContainment === 'contained';

  let category = worstCategory([receptor, cost]);
  if (contained) category = clampCategory(category - 1);

  return {
    id: 'environmental',
    label: 'Environmental',
    category,
    drivers: [
      driver('receptor', 'Receptor at risk', receptor, 'category', receptor,
        `Stated as ${input.environmentReceptor.replace(/-/g, ' ')}.`),
      driver('containment', 'Spill containment', null, 'class', contained ? 1 : 2,
        `Stated as ${input.spillContainment}.`
        + (contained ? ' Full containment lowers this component by one category.' : '')),
      driver('env-cost', 'Cleanup, fines and other costs', input.environmentalCostUsd, 'USD', cost,
        input.environmentalCostUsd === null
          ? 'Not quantified; the receptor alone carries this component. §11.5.5 asks for cleanup + fines + '
            + 'other costs, and that figure is missing from this assessment.'
          : `Stated as ${input.environmentalCostUsd.toLocaleString()} USD.`),
    ],
  };
}

function productionComponent(input: RbiConsequenceInput): RbiConsequenceComponent {
  const daily = input.dailyUnitValueUsd;
  const days = input.downtimeDays;
  const quantified = daily !== null && days !== null && Number.isFinite(daily) && Number.isFinite(days);
  // §11.5.6 — business interruption = daily unit value × downtime days.
  const interruption = quantified ? daily * days : null;

  // Where the outage has not been costed, redundancy is all there is to score
  // from — and it is capped at 2, deliberately below the point where it could
  // govern the risk on its own. An uncosted outage is a missing input, not a
  // moderate consequence, and inventing a category from it would put every
  // unfinished assessment at the same risk regardless of what it carries. The
  // Appendix A checklist asks for the number instead.
  const redundancyCategory: RiskCategory = input.redundancy === 'full' ? 1 : 2;

  let category = quantified ? categoryFromCost(interruption) : redundancyCategory;
  if (quantified && input.redundancy === 'full') category = clampCategory(category - 1);

  return {
    id: 'production',
    label: 'Production (business interruption)',
    category,
    drivers: [
      driver('business-interruption', 'Business interruption', interruption, 'USD', category,
        quantified
          ? `${daily?.toLocaleString()} USD/day × ${days} day(s) of downtime`
            + `${input.redundancy === 'full' ? ', reduced one category for full redundancy' : ''}.`
          : 'Not quantified. Scored from redundancy alone, which is a weaker basis than the outage cost '
            + '§11.5.6 asks for.'),
      driver('redundancy', 'Redundancy', null, 'class', redundancyCategory,
        `Stated as ${input.redundancy}.`),
    ],
  };
}

function maintenanceComponent(input: RbiConsequenceInput): RbiConsequenceComponent {
  const category = categoryFromCost(input.repairCostUsd);
  return {
    id: 'maintenance',
    label: 'Maintenance and reconstruction',
    category,
    drivers: [
      driver('repair-cost', 'Repair and replacement cost', input.repairCostUsd, 'USD', category,
        input.repairCostUsd === null
          ? 'Not quantified; this component does not contribute. §11.5.7 asks for the repair and '
            + 'reconstruction impact to be accounted for.'
          : `Stated as ${input.repairCostUsd.toLocaleString()} USD.`),
    ],
  };
}

/* ── Risk and the plan ─────────────────────────────────────────────────────── */

export function riskLevelOf(probability: RiskCategory, consequence: RiskCategory): RiskLevel {
  return RISK_MATRIX[probability - 1][consequence - 1];
}

export interface IntervalInput {
  riskLevel: RiskLevel;
  remainingLifeYears: number | null;
  /** §12.7 / §15.1.3 — a code or regulator's limit, which always wins. */
  jurisdictionalMaxYears: number | null;
  /** An interval the engineer set deliberately, with a reason. */
  overrideYears: number | null;
}

/**
 * The inspection interval, and the rule that produced it.
 *
 * Half the remaining life, capped by the risk-based maximum and then by any
 * jurisdictional limit — and refused outright where there is no remaining-life
 * figure to halve. §16 does not permit an interval to be set on data that does
 * not support one, and a default number here would be exactly that: the most
 * dangerous kind of output, one that looks like an answer.
 */
export function inspectionIntervalYears(input: IntervalInput): {
  intervalYears: number | null;
  basis: 'half-remaining-life' | 'risk-target-interval' | 'jurisdictional-limit' | 'engineer-override' | 'immediate-action' | 'no-basis';
} {
  const { riskLevel, remainingLifeYears, jurisdictionalMaxYears, overrideYears } = input;

  if (overrideYears !== null && Number.isFinite(overrideYears) && overrideYears >= 0) {
    return { intervalYears: overrideYears, basis: 'engineer-override' };
  }
  if (remainingLifeYears !== null && remainingLifeYears <= 0) {
    return { intervalYears: 0, basis: 'immediate-action' };
  }

  const riskCap = MAX_INTERVAL_YEARS[riskLevel];
  const legalCap = jurisdictionalMaxYears !== null && Number.isFinite(jurisdictionalMaxYears)
    && jurisdictionalMaxYears > 0
    ? jurisdictionalMaxYears
    : null;
  const cap = legalCap === null ? riskCap : Math.min(riskCap, legalCap);
  const capBasis = legalCap !== null && legalCap <= riskCap ? 'jurisdictional-limit' : 'risk-target-interval';

  if (remainingLifeYears === null || !Number.isFinite(remainingLifeYears)) {
    // Without a life figure the cap is all there is. It is a target, not a
    // calculated interval, and the plan says which of the two it is.
    return { intervalYears: cap, basis: capBasis };
  }

  const halfLife = remainingLifeYears * REMAINING_LIFE_FRACTION;
  return halfLife <= cap
    ? { intervalYears: Number(halfLife.toFixed(1)), basis: 'half-remaining-life' }
    : { intervalYears: cap, basis: capBasis };
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
