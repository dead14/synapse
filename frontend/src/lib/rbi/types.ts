/**
 * Risk-based inspection, API RP 580 4th edition (February 2021).
 *
 * API 580 is the *practice*, not a formula book. It says risk is the product of
 * a probability of failure and a consequence of failure (§12.1), that both are
 * assessed on stated evidence, that the result is placed on a documented matrix
 * (§12.6.2), and that the inspection plan follows from where a component lands
 * on it (§13). It does not publish the numbers — those come from an
 * owner-operator's own methodology, or from API 581 for a quantitative one.
 *
 * What it *does* prescribe, and what this module exists to carry, is a record.
 * §16.2 requires the assessment to be captured so completely that "the
 * assessment can be recreated or updated at a later time by others who were not
 * involved in the original assessment", and recommends holding it in a database.
 * That record is `RbiRecord`: a document authored across the practice's own
 * sequence — plan the programme (§6), name the team (§7), collect and validate
 * data (§8), review the damage mechanisms (§9), assess POF (§10), assess COF
 * (§11), determine risk against stated criteria (§12), plan inspection and
 * mitigation (§13/§14), set the reassessment triggers (§15), and sign it off
 * (§16).
 *
 * The approach is semi-quantitative (§5.4): the probability side is derived from
 * measured evidence Synapse already holds — a filed B31G assessment of real
 * ILI-measured metal loss — and everything the inspection run cannot know is
 * entered by the engineer and reported as entered. Every driver carries the
 * number behind it, so a category on a matrix can always be traced back to the
 * feature or the input that earned it.
 *
 * What this is not: it is not API 581, it does not produce a probability in
 * events per year, and it does not replace the fitness-for-service assessment it
 * reads from.
 */

/** Five probability and five consequence categories: the documented grid. */
export type RiskCategory = 1 | 2 | 3 | 4 | 5;

/** Where a component lands on the matrix. */
export type RiskLevel = 'Low' | 'Medium' | 'Medium high' | 'High';

/**
 * Whether a level is one the operator will live with. §12.3 asks for corporate
 * risk criteria to be applied; §12.7 for thresholds dividing acceptable from
 * unacceptable regions, with ALARP for what sits between.
 */
export type RiskAcceptance = 'acceptable' | 'tolerable' | 'unacceptable';

/** §5.4 / §6.5. Only the middle one is implemented, and the record says so. */
export type RbiApproach = 'qualitative' | 'semi-quantitative' | 'quantitative';

/* ─────────────────────────────────────────────────────────────────────────────
   §6 — Planning the RBI programme
   ────────────────────────────────────────────────────────────────────────── */

/**
 * Physical and operating boundaries, and the window the assessment speaks for.
 *
 * §6.3.2 asks for the physical boundary to be stated; §16.4 for what is included
 * *and* what is excluded, with the reasoning. §6.4 asks for the operating
 * boundary — and specifically for start-up, shutdown, upset and cyclic
 * conditions to be considered rather than assumed away, because those are where
 * mechanisms like PASCC live. §6.4.4 asks for the operating time period.
 */
export interface RbiPlanning {
  /** §6.2 — why this assessment is being done. Ids from `RBI_OBJECTIVES`. */
  objectives: string[];
  objectivesNote: string;
  approach: RbiApproach;
  /** §6.3.2 — where the assessment starts and stops, in the plant's own words. */
  facility: string;
  processUnit: string;
  system: string;
  /** §16.4 — the equipment covered, and the equipment deliberately not covered. */
  includedEquipment: string[];
  excludedEquipment: string[];
  scopeRationale: string;
  operating: RbiOperatingBoundary;
  /** §16.6 — the window over which the assessment is claimed to be valid. */
  timeframeFromIso: string;
  timeframeToIso: string;
  /** §6.4.4 — the run length the plan is built around. */
  runLengthYears: number | null;
  /** §16.11 — the in-service codes and standards in force. */
  codes: string[];
  codesNote: string;
  /**
   * A shorter inspection interval imposed by a jurisdiction or a company
   * standard. §12.7 and §15.1: a risk-derived interval never overrides one.
   */
  jurisdictionalMaxIntervalYears: number | null;
}

export interface RbiOperatingBoundary {
  normalPressureMpa: number | null;
  normalTemperatureC: number | null;
  minPressureMpa: number | null;
  maxPressureMpa: number | null;
  minTemperatureC: number | null;
  maxTemperatureC: number | null;
  flowNote: string;
  /** §6.4.2 — considered, and what was concluded. Unconsidered is a gap. */
  startupShutdownConsidered: boolean;
  startupShutdownNote: string;
  /** §6.4.3 — abnormal and upset excursions. */
  upsetConsidered: boolean;
  upsetNote: string;
  /** §6.4.3 — cyclic or intermittent service. */
  cyclicConsidered: boolean;
  cyclicNote: string;
}

/* ─────────────────────────────────────────────────────────────────────────────
   §7 / §16.5 — Team, roles, and qualifications
   ────────────────────────────────────────────────────────────────────────── */

/**
 * One person on the assessment team.
 *
 * §16.5 asks for a record of who assessed the risk and what they brought, "to
 * understand the basis for the risk assessment when the analysis is repeated or
 * updated". §9.1 goes further and makes one of these mandatory: the team *shall*
 * consult a corrosion specialist to define the damage mechanisms.
 */
export interface RbiTeamMember {
  id: string;
  name: string;
  role: string;
  organization: string;
  qualification: string;
}

/* ─────────────────────────────────────────────────────────────────────────────
   §8 — Data and information collection
   ────────────────────────────────────────────────────────────────────────── */

export type RbiDataAvailability = 'available' | 'partial' | 'unavailable';
export type RbiDataQuality = 'high' | 'medium' | 'low';

/** One source from the §8.5 list, and what was actually got from it. */
export interface RbiDataSource {
  id: string;
  availability: RbiDataAvailability;
  quality: RbiDataQuality;
  note: string;
}

/**
 * The design and construction data the POF rests on (§8.2.1 a–c, k).
 *
 * Where the filed FFS assessment already carries a figure it is read from there
 * rather than typed again, and the field says so — §8.3 is about data quality,
 * and a number transcribed by hand from a screen is a number with an extra way
 * to be wrong.
 */
export interface RbiEquipmentData {
  outerDiameterMm: number | null;
  nominalWallMm: number | null;
  material: string;
  grade: string;
  smysMpa: number | null;
  designPressureMpa: number | null;
  designTemperatureC: number | null;
  corrosionAllowanceMm: number | null;
  installedYear: number | null;
  seamType: string;
  externalCoating: string;
  insulated: boolean;
  cathodicProtection: string;
  note: string;
}

/**
 * Process conditions and the trace species that decide the mechanisms.
 *
 * §9.1 b) is emphatic about this: "Identifying trace constituents (ppm) in
 * addition to the primary constituents in a process can be very important as
 * trace constituents can have a significant effect on the damage mechanisms."
 * H₂S at single-digit ppm is the difference between sweet-service carbon steel
 * and a wet H₂S cracking review.
 */
export interface RbiProcessData {
  fluid: RbiFluidClass;
  phase: 'gas' | 'liquid' | 'two-phase';
  composition: string;
  h2sPpm: number | null;
  co2Pct: number | null;
  chloridesPpm: number | null;
  waterCutPct: number | null;
  ph: number | null;
  velocityMs: number | null;
  /** §9.3 — injection and mixing points, where localized thinning concentrates. */
  injectionPoints: string;
  note: string;
}

/**
 * What can escape, and what stops it (§11.4).
 *
 * The released volume is "the amount of fluid between isolation valves that can
 * be quickly closed", so the isolation arrangement is part of the inventory
 * figure rather than a separate nicety, and detection and isolation time are the
 * two numbers that decide how much of the available volume is actually released.
 */
export interface RbiInventoryData {
  volumeM3: number | null;
  isolationDescription: string;
  detectionSystem: RbiDetectionRating;
  isolationSystem: RbiIsolationRating;
  detectionTimeMin: number | null;
  isolationTimeMin: number | null;
  /** §11.5.5 — bunding, sumps, and whether a spill reaches a watercourse. */
  spillContainment: 'contained' | 'partial' | 'none';
  note: string;
}

/**
 * Detection and isolation, rated A (best) to C (none to speak of).
 *
 * A three-step rating rather than a time in seconds: this is a
 * semi-quantitative assessment, and a fabricated response time carries more
 * apparent precision than the underlying knowledge supports.
 */
export type RbiDetectionRating = 'A' | 'B' | 'C';
export type RbiIsolationRating = 'A' | 'B' | 'C';

export interface RbiDataCollection {
  sources: RbiDataSource[];
  equipment: RbiEquipmentData;
  process: RbiProcessData;
  inventory: RbiInventoryData;
  /**
   * §8.3 — "Data inputs and assumptions shall be validated by qualified
   * personnel such as process engineer/operator to review operating parameters
   * used." A shall, and one an audit will look for by name.
   */
  validatedBy: string;
  validatedOnIso: string;
  validationNote: string;
}

/* ─────────────────────────────────────────────────────────────────────────────
   §9 — Damage mechanism review, and §10 — POF
   ────────────────────────────────────────────────────────────────────────── */

/** §9.4.2 — a mechanism is active, credible but not yet seen, or ruled out. */
export type RbiMechanismStatus = 'active' | 'potential' | 'ruled-out';

/**
 * How the mechanism's rate of progress is expressed.
 *
 * §9.2: "Deterioration rate can be expressed in terms of corrosion rate for
 * thinning or susceptibility for mechanisms where the deterioration rate is
 * unknown or immeasurable (such as stress corrosion cracking)." Both are
 * legitimate; conflating them is not, so the row records which one it is.
 */
export type RbiRateBasis = 'measured-ili' | 'corrosion-rate' | 'susceptibility';

export type RbiSusceptibility = 'high' | 'medium' | 'low';

/**
 * Inspection effectiveness, §10.4.2.
 *
 * "Inspections vary in their effectiveness for locating, characterizing, and
 * sizing defects… the effectiveness of inspections is determined for each type
 * of damage mechanism and is a function of the type of technique used and the
 * extent of coverage." The A–E ladder is the convention API 581 Part 2 Annex 2.C
 * uses and API 580 §10.4.2 points at; the *effect* each grade has on the
 * category here is this product's documented rule, not the practice's.
 */
export type RbiInspectionEffectiveness = 'A' | 'B' | 'C' | 'D' | 'E' | 'none';

/**
 * One credible damage mechanism, its evidence, and what has been done to look
 * for it.
 *
 * POF inputs live on this row rather than in a separate step because that is
 * where API 580 puts them: §10.4.3 calculates the POF "by deterioration type",
 * from the mechanism, its rate or susceptibility, and the effectiveness of the
 * inspection that has been looking for it. Splitting them would invite a
 * mechanism to be reviewed in one place and scored in another.
 */
export interface RbiDamageMechanism {
  id: string;
  /** Id from `DAMAGE_MECHANISMS`, or free text for one the catalogue lacks. */
  mechanismId: string;
  customName: string;
  status: RbiMechanismStatus;
  /** §9.1 — thinning, pitting, cracking, and so on. */
  damageMode: string;
  /** §9.1 / §10.4.1 d — pinhole, leak, rupture. Decides which COF is credible. */
  failureMode: RbiFailureMode;
  rateBasis: RbiRateBasis;
  rateMmPerYear: number | null;
  susceptibility: RbiSusceptibility;
  /** §16.7 — the evidence, so the category is checkable rather than assertable. */
  basis: string;
  /** §9.5 b — "Rule out inactive damage mechanisms", which means saying why. */
  ruledOutReason: string;
  effectiveness: RbiInspectionEffectiveness;
  inspectionMethod: string;
  coveragePct: number | null;
  lastInspectionIso: string;
  /** §13.2 — the technique that should be used next for this mechanism. */
  plannedTechnique: string;
}

export type RbiFailureMode = 'pinhole-leak' | 'leak' | 'rupture';

/**
 * §9.4 / §14.8 — an integrity operating window.
 *
 * The parameter that keeps a mechanism dormant, the limits, and what happens if
 * they are crossed. §15.2.2 makes an IOW exceedance a reassessment trigger, so
 * an IOW recorded without an action is an alarm with nobody assigned to it.
 */
export interface RbiIow {
  id: string;
  parameter: string;
  unit: string;
  lowLimit: number | null;
  highLimit: number | null;
  /** The `RbiDamageMechanism.id` this window protects against. */
  mechanismRowId: string;
  actionOnExceedance: string;
}

export interface RbiDamageMechanismReview {
  mechanisms: RbiDamageMechanism[];
  iows: RbiIow[];
  /** §9.1 — the corrosion specialist the team is required to have consulted. */
  corrosionSpecialist: string;
  reviewDateIso: string;
  /** §9.2 — where the rates came from: published data, testing, experience. */
  rateSources: string;
  /**
   * §10.1 — loss of containment has causes damage mechanisms do not cover:
   * seismic, weather, overpressure, operator error, wrong material, design
   * error, sabotage. Recorded as considered so the POF's blind spots are stated
   * rather than silently inherited.
   */
  otherCauses: string[];
  otherCausesNote: string;
}

/* ─────────────────────────────────────────────────────────────────────────────
   §11 — Consequence of failure
   ────────────────────────────────────────────────────────────────────────── */

export type RbiFluidClass =
  | 'sour-gas'
  | 'sweet-gas'
  | 'lpg'
  | 'crude-oil'
  | 'condensate'
  | 'refined-product'
  | 'produced-water'
  | 'water'
  | 'steam';

export type RbiPopulationClass = 'remote' | 'rural' | 'suburban' | 'urban';

export type RbiEnvironmentReceptor =
  | 'none'
  | 'soil'
  | 'groundwater'
  | 'surface-water'
  | 'protected';

/**
 * The consequence inputs, broken out along the four axes §11.1.1 names: safety
 * and health, environmental, economic, and reputation.
 *
 * They are kept apart rather than collapsed into one dropdown because §11.6.2
 * asks for the COF to be estimated per effect category and because they are
 * mitigated by completely different actions — you reduce a safety consequence by
 * moving people, and a production consequence by installing a spare.
 */
export interface RbiConsequenceInput {
  /** §11.5.2/§11.5.3 — what a release would be. Drives safety and environment. */
  fluid: RbiFluidClass;
  population: RbiPopulationClass;
  /** Persons credibly inside the affected area. §11.5.4 b. */
  personnelExposed: number | null;
  publicProximityM: number | null;
  toxicRelease: boolean;
  flammable: boolean;

  environmentReceptor: RbiEnvironmentReceptor;
  /** §11.5.5 — cleanup + fines + other, as an order of magnitude. */
  environmentalCostUsd: number | null;

  /** §11.5.6 — business interruption = daily unit value × downtime. */
  dailyUnitValueUsd: number | null;
  downtimeDays: number | null;
  redundancy: 'full' | 'partial' | 'none';

  /** §11.5.7 — repair and reconstruction of the equipment itself. */
  repairCostUsd: number | null;

  /**
   * §11.4 — the release scale the categories are scored against.
   *
   * These six are NOT authored on the consequence step. Geometry and pressure
   * come from the FFS case the assessment cites, and inventory, detection,
   * isolation and containment were already collected under §8; the builder
   * copies them in so the two steps cannot disagree about the same pipe. The
   * consequence step shows them read-only and points back at their source.
   */
  outerDiameterMm: number;
  operatingPressureMpa: number;
  inventoryM3: number | null;
  detection: RbiDetectionRating;
  isolation: RbiIsolationRating;
  spillContainment: 'contained' | 'partial' | 'none';

  basisNote: string;
}

/**
 * A section where the surroundings differ from the line default.
 *
 * A pipeline is the one asset class where consequence genuinely varies along its
 * own length — the same line is remote for forty kilometres and then crosses a
 * road, a river, and a village. §11.1.1 wants the COF to "provide discrimination
 * between equipment items"; a single line-wide category provides none, and would
 * put the river crossing and the empty desert in the same box.
 */
export interface RbiConsequenceOverride {
  unitId: string;
  population: RbiPopulationClass | null;
  environmentReceptor: RbiEnvironmentReceptor | null;
  note: string;
}

/* ─────────────────────────────────────────────────────────────────────────────
   §12 — Risk criteria, §13/§14 — plan, §15 — evergreening, §16 — sign-off
   ────────────────────────────────────────────────────────────────────────── */

/** §12.6 — one assumption, why it was made, and what it costs if it is wrong. */
export interface RbiAssumption {
  id: string;
  assumption: string;
  basis: string;
  impactIfWrong: string;
}

export interface RbiRiskCriteria {
  /** §12.7 — the thresholds the operator signs, per level. */
  acceptance: Record<RiskLevel, RiskAcceptance>;
  /** §12.6 — the assumptions register, which §16.7 makes a shall. */
  assumptions: RbiAssumption[];
  /** §12.4 — which inputs the result turned out to be sensitive to. */
  sensitivityNote: string;
  /** §12.3.1 — the corporate criteria this maps onto, where they exist. */
  criteriaSource: string;
}

/** §13.1 — the four strategies API 580 asks to be considered, at a minimum. */
export type RbiMitigationStrategy =
  | 'none'
  | 'inspection-repair'
  | 'pof-mitigation'
  | 'cof-mitigation'
  | 'decommission';

/**
 * The plan for one unit, layered over what the engine derived.
 *
 * §12.3.2 frames inspection planning as five questions — what to inspect, how,
 * where, how much, and when. The engine answers "when" from the measured
 * remaining life; the other four are engineering decisions, and this is where
 * they are recorded. §16.9 additionally asks for the residual risk after
 * mitigation, which is a judgement, never a calculation this product will make
 * on the engineer's behalf.
 */
export interface RbiUnitPlan {
  unitId: string;
  technique: string;
  coveragePct: number | null;
  locations: string;
  strategy: RbiMitigationStrategy;
  mitigationNote: string;
  targetDateIso: string;
  owner: string;
  /** §16.9 — risk expected to remain once the mitigation is in place. */
  residualRiskLevel: RiskLevel | null;
  /** An interval the engineer sets against the derived one, and why. */
  overrideIntervalYears: number | null;
  overrideReason: string;
}

export interface RbiEvergreening {
  /** §15.2 — the events that will send this assessment back for review. */
  triggers: string[];
  triggersNote: string;
  /** §15.3.2 — the default maximum period between reassessments. */
  reassessmentIntervalYears: number | null;
  nextReassessmentIso: string;
  /** §15.1.1 — who keeps the data current between reassessments. */
  evergreenOwner: string;
  evergreenProcess: string;
}

export interface RbiDocumentation {
  assessedBy: string;
  assessedOnIso: string;
  reviewedBy: string;
  reviewedOnIso: string;
  approvedBy: string;
  approvedOnIso: string;
  /** §16.3 — how the methodology was applied at this site. */
  methodologyNote: string;
  distribution: string;
}

/* ─────────────────────────────────────────────────────────────────────────────
   The document
   ────────────────────────────────────────────────────────────────────────── */

/** The wizard's steps, in the order API 580 works through the problem. */
export type RbiStepId =
  | 'planning'
  | 'team'
  | 'data'
  | 'dmr'
  | 'pof'
  | 'cof'
  | 'risk'
  | 'plan'
  | 'evergreen'
  | 'documentation';

/**
 * Everything an engineer authors. Not what the engine derives from it — that is
 * `RbiAssessment`, and keeping the two apart is what lets a stored assessment be
 * recomputed against corrected evidence instead of preserving a stale answer.
 */
export interface RbiRecord {
  /** Bumped when a field's meaning changes, so a stored record can be migrated. */
  version: 1;
  title: string;
  /** The filed FFS assessment the measured probability is read from. */
  ffsSessionId: string | null;
  planning: RbiPlanning;
  team: RbiTeamMember[];
  data: RbiDataCollection;
  dmr: RbiDamageMechanismReview;
  consequence: RbiConsequenceInput;
  consequenceOverrides: RbiConsequenceOverride[];
  risk: RbiRiskCriteria;
  unitPlans: RbiUnitPlan[];
  evergreening: RbiEvergreening;
  documentation: RbiDocumentation;
}

/* ─────────────────────────────────────────────────────────────────────────────
   What the engine derives
   ────────────────────────────────────────────────────────────────────────── */

/** One driver behind a category, and the number it came from. */
export interface RbiDriver {
  id: string;
  label: string;
  /** The measured or entered value this driver was scored from. */
  value: number | null;
  unit: string;
  /** The category this driver alone would give. */
  category: RiskCategory;
  /** Where the number came from, so a reviewer can go and check it. */
  basis: string;
  /** True when the number was measured rather than judged. §8.3, §12.6. */
  measured: boolean;
}

/**
 * The probability contribution of one damage mechanism to one unit (§10.4.3).
 *
 * `baseCategory` is what the rate or susceptibility alone gives; `category` is
 * that figure after the inspection-effectiveness adjustment, and both are kept
 * so the adjustment is visible rather than baked in.
 */
export interface RbiMechanismPof {
  rowId: string;
  name: string;
  status: RbiMechanismStatus;
  rateBasis: RbiRateBasis;
  baseCategory: RiskCategory;
  effectiveness: RbiInspectionEffectiveness;
  effectivenessDelta: number;
  category: RiskCategory;
  measured: boolean;
  basis: string;
}

/** Probability of failure for one assessed unit. */
export interface RbiProbability {
  category: RiskCategory;
  drivers: RbiDriver[];
  /** Per-mechanism contributions, so §10.1's "all credible mechanisms" is shown. */
  mechanisms: RbiMechanismPof[];
  /** Which mechanism set the unit's category. */
  governingMechanism: string | null;
  /**
   * True when the probability rests on a growth rate that was assumed rather
   * than measured. §8.3 asks for the confidence in the data to be stated; an
   * assumed corrosion rate is the usual reason a probability is soft.
   */
  growthAssumed: boolean;
  /** Anomalies in this unit with no B31G result, so no measured contribution. */
  unassessedCount: number;
}

/** One of the four §11.1.1 consequence axes, scored on its own. */
export interface RbiConsequenceComponent {
  id: 'safety' | 'environmental' | 'production' | 'maintenance';
  label: string;
  category: RiskCategory;
  drivers: RbiDriver[];
}

export interface RbiConsequence {
  category: RiskCategory;
  components: RbiConsequenceComponent[];
  /** Every driver across the components, flattened for the report. */
  drivers: RbiDriver[];
  /** True when this unit's surroundings were overridden from the line default. */
  overridden: boolean;
}

export interface RbiInspectionPlan {
  intervalYears: number | null;
  dueDateIso: string | null;
  /** Which rule produced the interval. */
  basis:
    | 'half-remaining-life'
    | 'risk-target-interval'
    | 'jurisdictional-limit'
    | 'engineer-override'
    | 'immediate-action'
    | 'no-basis';
  /** The recommended inspection or mitigation, in words an engineer can act on. */
  recommendation: string;
  /** §12.3.2 — what, how, where, how much. Empty until the engineer sets it. */
  technique: string;
  coveragePct: number | null;
  locations: string;
  strategy: RbiMitigationStrategy;
  mitigationNote: string;
  targetDateIso: string | null;
  owner: string;
  residualRiskLevel: RiskLevel | null;
}

/**
 * One unit of the assessment.
 *
 * §6.3.2 asks for the assessment to be made on a stated boundary. Here the
 * boundary is a section of the line as the alignment named it — the same
 * stretches the FFS design factors were set against — so the risk ranking and
 * the assessment it came from divide the pipeline the same way.
 */
export interface RbiUnitResult {
  id: string;
  label: string;
  fromM: number | null;
  toM: number | null;
  featureCount: number;
  probability: RbiProbability;
  consequence: RbiConsequence;
  riskLevel: RiskLevel;
  acceptance: RiskAcceptance;
  /**
   * Years until the next inspection, and the rule that set it. Null when no
   * interval could be established, which is itself a finding — §16 does not
   * allow an interval to be invented where the data does not support one.
   */
  inspection: RbiInspectionPlan;
  /** The worst feature in this unit, named so the plan can be acted on. */
  governingFeature: {
    featureId: string | null;
    ldM: number | null;
    erf: number | null;
    remnantLifeYears: number | null;
    depthPct: number | null;
  } | null;
}

export interface RbiAssessment {
  record: RbiRecord;
  /** The FFS session this risk assessment was derived from. */
  ffsSessionId: string | null;
  lineName: string;
  /** The date the assessed ILI run was flown; every interval counts from it. */
  assessmentDateIso: string;
  units: RbiUnitResult[];
  totals: {
    features: number;
    unassessed: number;
    byLevel: Record<RiskLevel, number>;
    byAcceptance: Record<RiskAcceptance, number>;
    /** The earliest inspection date anywhere on the line. */
    nextDueIso: string | null;
  };
  provenance: {
    practice: 'API 580';
    edition: string;
    approach: RbiApproach;
    /** Every rule this assessment applied, in the order it applied them. */
    rules: string[];
    limitations: string[];
  };
}
