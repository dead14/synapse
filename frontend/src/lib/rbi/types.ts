/**
 * Risk-based inspection, API 580.
 *
 * API 580 is the *practice*: it says risk is the product of a likelihood of
 * failure and a consequence of failure, that both are to be assessed on stated
 * evidence, that the result is placed on a documented matrix, and that the
 * inspection plan follows from where a component lands on it. It does not
 * publish the numbers — those come from an owner-operator's own methodology, or
 * from API 581 for a quantitative one.
 *
 * So this module is deliberately semi-quantitative, in the sense of API 580
 * §14: the likelihood is derived from measured evidence Synapse already holds —
 * a filed B31G assessment of real ILI-measured metal loss — and the consequence
 * is entered by the engineer, because nothing in an ILI file knows what the line
 * carries or who lives beside it. Every driver carries the number behind it, so
 * a category on a matrix can always be traced back to the feature that earned
 * it.
 *
 * What this is not: it is not API 581, it does not produce a probability in
 * events per year, and it does not replace the fitness-for-service assessment it
 * reads from.
 */

/** Five likelihood and five consequence categories: the API 580 §14.2 grid. */
export type RiskCategory = 1 | 2 | 3 | 4 | 5;

/** Where a component lands on the matrix. */
export type RiskLevel = 'Low' | 'Medium' | 'Medium high' | 'High';

/** What an engineer states about the fluid and the surroundings. */
export interface RbiConsequenceInput {
  /**
   * What the line carries. Drives the safety and environmental consequence of a
   * release, and nothing in an ILI file can tell you it.
   */
  fluid: RbiFluidClass;
  /** Population exposure along the assessed stretch. */
  population: RbiPopulationClass;
  /** Environmental sensitivity of the surroundings. */
  environment: RbiEnvironmentClass;
  /** What a loss of this line costs the business per day, as a class. */
  businessImpact: RbiBusinessImpactClass;
  /** Line pressure and size scale the release; taken from the FFS case. */
  outerDiameterMm: number;
  operatingPressureMpa: number;
}

export type RbiFluidClass =
  | 'sweet-gas'
  | 'sour-gas'
  | 'crude-oil'
  | 'refined-product'
  | 'produced-water'
  | 'water';

export type RbiPopulationClass = 'remote' | 'rural' | 'suburban' | 'urban';

export type RbiEnvironmentClass = 'low' | 'moderate' | 'sensitive' | 'protected';

export type RbiBusinessImpactClass = 'low' | 'moderate' | 'high' | 'critical';

/** One measured driver behind a category, and the number it came from. */
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
}

/** Likelihood of failure for one assessed unit. */
export interface RbiLikelihood {
  category: RiskCategory;
  drivers: RbiDriver[];
  /**
   * True when the likelihood rests on a growth rate that was assumed rather
   * than measured. API 580 §8 asks for the confidence in the data to be stated;
   * an assumed corrosion rate is the usual reason a likelihood is soft.
   */
  growthAssumed: boolean;
  /** Anomalies in this unit with no B31G result, so no measured contribution. */
  unassessedCount: number;
}

export interface RbiConsequence {
  category: RiskCategory;
  drivers: RbiDriver[];
}

/**
 * One unit of the assessment.
 *
 * API 580 §7 asks for the assessment to be made on a stated boundary. Here the
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
  likelihood: RbiLikelihood;
  consequence: RbiConsequence;
  riskLevel: RiskLevel;
  /**
   * Years until the next inspection, and the rule that set it. Null when no
   * interval could be established, which is itself a finding — API 580 §16 does
   * not allow an interval to be invented where the data does not support one.
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

export interface RbiInspectionPlan {
  intervalYears: number | null;
  dueDateIso: string | null;
  /** Which rule produced the interval. */
  basis:
    | 'half-remaining-life'
    | 'risk-target-interval'
    | 'immediate-action'
    | 'no-basis';
  /** The recommended inspection or mitigation, in words an engineer can act on. */
  recommendation: string;
}

export interface RbiAssessment {
  /** The FFS session this risk assessment was derived from. */
  ffsSessionId: string | null;
  lineName: string;
  /** The date the assessed ILI run was flown; every interval counts from it. */
  assessmentDateIso: string;
  units: RbiUnitResult[];
  /** Line-level counts for the matrix and the summary. */
  totals: {
    features: number;
    unassessed: number;
    byLevel: Record<RiskLevel, number>;
  };
  provenance: {
    practice: 'API 580';
    edition: string;
    approach: 'semi-quantitative';
    /** Every rule this assessment applied, in the order it applied them. */
    rules: string[];
    limitations: string[];
  };
}
