/**
 * Quick risk-based inspection for a pipeline, to API RP 580.
 *
 * This is a screening assessment, not a full RBI programme. It answers one
 * question — which sections of this line carry the most risk, and when should
 * each be inspected — from evidence the product already holds, in four steps.
 * The full assessment, with its damage mechanism review, integrity operating
 * windows and programme documentation, is an RBI engineer's work and this does
 * not pretend to replace it.
 *
 * Risk is the probability of failure times the consequence of failure, read off
 * a documented 5x5 matrix. The probability comes from measured metal loss where
 * an in-line inspection has measured it, and from a reviewed threat list where
 * it has not — a metal-loss run says nothing about cracking, a dent, or a
 * landslide. The consequence is entered, because nothing in an inspection file
 * knows what the line carries or who lives beside it.
 */

/** Five probability and five consequence categories. */
export type RiskCategory = 1 | 2 | 3 | 4 | 5;

/** Where a section lands on the matrix. */
export type RiskLevel = 'Low' | 'Medium' | 'Medium high' | 'High';

/** Whether the operator will live with a level. */
export type RiskAcceptance = 'acceptable' | 'tolerable' | 'unacceptable';

/* ── Threats ───────────────────────────────────────────────────────────────── */

/**
 * The pipeline threat categories from ASME B31.8S.
 *
 * A pipeline is not a pressure vessel and does not share its damage list. These
 * are the categories the pipeline codes actually use, grouped as B31.8S groups
 * them: time-dependent threats that grow, stable threats that sit in the pipe
 * from the day it was built, and time-independent threats that arrive from
 * outside.
 *
 * Equipment threats — valves, gaskets, flange faces — are deliberately absent.
 * This assessment covers the pipe body an in-line inspection can reach, and
 * says so in its limitations rather than listing a threat it cannot rank.
 */
export type ThreatId =
  | 'external-corrosion'
  | 'internal-corrosion'
  | 'scc'
  | 'manufacturing'
  | 'construction'
  | 'third-party'
  | 'weather-outside-force'
  | 'incorrect-operations';

/**
 * How much of a threat this line carries.
 *
 * `unreviewed` is the starting value and is scored as an unknown, not as a
 * clear. An assessment cannot be issued while any threat sits here — the point
 * of the step is that somebody looked at each one.
 */
export type ThreatRelevance = 'unreviewed' | 'not-credible' | 'possible' | 'active';

/** How well the last inspection could have found the threat, if it were there. */
export type ThreatCoverage = 'covered' | 'partial' | 'none';

export interface ThreatAssessment {
  id: ThreatId;
  relevance: ThreatRelevance;
  coverage: ThreatCoverage;
  /** What the judgement rests on, so a reviewer can check it. */
  note: string;
}

/* ── Consequence ───────────────────────────────────────────────────────────── */

export type PipelineFluid =
  | 'sour-gas'
  | 'sweet-gas'
  | 'lpg'
  | 'crude-oil'
  | 'condensate'
  | 'refined-product'
  | 'produced-water'
  | 'water';

export type PopulationClass = 'remote' | 'rural' | 'suburban' | 'urban';

export type EnvironmentClass = 'none' | 'soil' | 'groundwater' | 'surface-water' | 'protected';

export type BusinessImpactClass = 'low' | 'moderate' | 'high' | 'critical';

/**
 * A section whose surroundings differ from the line default.
 *
 * The one thing a pipeline consequence analysis must get right. A line runs
 * remote for forty kilometres and then crosses a river, a road and a village; a
 * single category for the whole line puts the crossing and the empty desert in
 * the same box and ranks neither.
 */
export interface SectionOverride {
  sectionId: string;
  population: PopulationClass | null;
  environment: EnvironmentClass | null;
  note: string;
}

/* ── The record ────────────────────────────────────────────────────────────── */

export type RbiStepId = 'line' | 'threats' | 'consequence' | 'result';

/** Everything an engineer enters. Short by design. */
export interface RbiRecord {
  version: 2;
  title: string;
  /** The filed fitness-for-service assessment the measured evidence comes from. */
  ffsSessionId: string | null;
  /** Line or segment name. Seeded from the assessment it cites. */
  segment: string;
  fluid: PipelineFluid;
  /** A release that injures without needing to ignite. */
  toxic: boolean;
  threats: ThreatAssessment[];
  population: PopulationClass;
  environment: EnvironmentClass;
  businessImpact: BusinessImpactClass;
  overrides: SectionOverride[];
  /** A shorter interval imposed by a regulator or a company standard. */
  maxIntervalYears: number | null;
  assessedBy: string;
  assessedOnIso: string;
  notes: string;
}

/* ── What the engine derives ───────────────────────────────────────────────── */

/** One driver behind a category, and the number it came from. */
export interface RbiDriver {
  id: string;
  label: string;
  value: number | null;
  unit: string;
  category: RiskCategory;
  /** Where the number came from, so a reviewer can go and check it. */
  basis: string;
  /** True when the number was measured rather than judged. */
  measured: boolean;
}

/** One threat's contribution to a section's probability. */
export interface ThreatScore {
  id: ThreatId;
  label: string;
  relevance: ThreatRelevance;
  category: RiskCategory;
  measured: boolean;
  basis: string;
}

export interface RbiProbability {
  category: RiskCategory;
  /** The measured metal-loss drivers for this section. */
  drivers: RbiDriver[];
  threats: ThreatScore[];
  governingThreat: string | null;
  /** True when the remaining life rests on an assumed growth rate. */
  growthAssumed: boolean;
  /** Anomalies here with no B31G result, so no measured contribution. */
  unassessedCount: number;
}

export interface RbiConsequence {
  category: RiskCategory;
  drivers: RbiDriver[];
  /** True when this section's surroundings were overridden from the default. */
  overridden: boolean;
}

export interface RbiInspectionPlan {
  intervalYears: number | null;
  dueDateIso: string | null;
  basis:
    | 'half-remaining-life'
    | 'risk-target-interval'
    | 'regulatory-limit'
    | 'immediate-action';
  recommendation: string;
}

/** One section of the line, as the alignment named it. */
export interface RbiSectionResult {
  id: string;
  label: string;
  fromM: number | null;
  toM: number | null;
  featureCount: number;
  probability: RbiProbability;
  consequence: RbiConsequence;
  riskLevel: RiskLevel;
  acceptance: RiskAcceptance;
  inspection: RbiInspectionPlan;
  /** The worst feature here, named so the plan can be acted on. */
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
  ffsSessionId: string | null;
  lineName: string;
  /** The date the assessed inspection was run; every interval counts from it. */
  assessmentDateIso: string;
  sections: RbiSectionResult[];
  totals: {
    features: number;
    unassessed: number;
    byLevel: Record<RiskLevel, number>;
    unacceptable: number;
    nextDueIso: string | null;
  };
  provenance: {
    practice: string;
    approach: string;
    rules: string[];
    limitations: string[];
  };
}
