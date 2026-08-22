import { MINIMUM_RECOMMENDED_SAFETY_FACTOR } from './b31g.ts';
import { lifeSortValue } from './lifeProjection.ts';
import type { FfsConfig, FfsLifeStatus, FfsScreenedResult } from './types.ts';
import { isIsoCalendarDate } from './validation.ts';

/**
 * The remnant life of the line, as opposed to of one anomaly.
 *
 * A fitness-for-service report leads with two of these: the figure as the line
 * stands today, and the figure that would be obtained if the features already
 * recommended for permanent repair were replaced. The second is what makes the
 * repair recommendation quantitative instead of an assertion.
 */
export interface FfsPipelineRemnantLife {
  populationCount: number;
  /** The feature that sets the figure, or null when none establishes a limit. */
  governing: FfsScreenedResult | null;
  years: number | null;
  status: FfsScenarioLifeSummaryStatus;
  dueDateIso: string | null;
  calculatedCount: number;
  notReachedCount: number;
  insufficientBasisCount: number;
}

function pipelineRemnantLife(items: FfsScreenedResult[]): FfsPipelineRemnantLife {
  const calculated = items
    .filter((item) => item.nominal.remnantLife.status === 'calculated')
    .sort((a, b) =>
      lifeSortValue(a.nominal.remnantLife.years) - lifeSortValue(b.nominal.remnantLife.years));
  const governing = calculated[0] ?? null;

  const notReachedCount = items.filter(
    (item) => item.nominal.remnantLife.status === 'not-reached-within-horizon',
  ).length;
  const insufficientBasisCount = items.filter(
    (item) => item.nominal.remnantLife.status === 'insufficient-growth-basis',
  ).length;

  let status: FfsScenarioLifeSummaryStatus;
  if (items.length === 0) status = 'empty';
  else if (governing) status = 'calculated';
  else if (notReachedCount > 0 && insufficientBasisCount > 0) status = 'mixed-unbounded';
  else if (insufficientBasisCount > 0) status = 'insufficient-growth-basis';
  else status = 'not-reached-within-horizon';

  return {
    populationCount: items.length,
    governing,
    years: governing?.nominal.remnantLife.years ?? null,
    status,
    dueDateIso: governing?.nominal.remnantLife.dueDateIso ?? null,
    calculatedCount: calculated.length,
    notReachedCount,
    insufficientBasisCount,
  };
}

/**
 * The features a permanent-repair programme would remove from the line: those
 * whose remnant life falls below the review threshold, plus every temporary
 * repair still holding. Both are the ordinary contents of a cut-and-replace
 * recommendation, and both are what the "after repair" figure assumes gone.
 */
export function repairProgrammeTargets(
  items: FfsScreenedResult[],
  reviewThresholdYears: number,
): FfsScreenedResult[] {
  return items.filter((item) => {
    if (item.nominal.repairStatus === 'temporary-repair') return true;
    const { years, status } = item.nominal.remnantLife;
    return status === 'calculated' && years !== null && years < reviewThresholdYears;
  });
}

export type FfsReadinessSeverity = 'error' | 'warning' | 'info';

export interface FfsReadinessFinding {
  code: string;
  severity: FfsReadinessSeverity;
  message: string;
  affectedCount: number;
}

export interface FfsReportContext {
  inspectionDateIso: string;
  asOfDateIso: string;
  /** Remnant life below which a feature enters the repair programme. */
  reviewThresholdYears: number;
  /**
   * True when the B31.4 design thickness fell back to the operating pressure
   * because the dossier supplied no internal design pressure. Carried on the
   * context so the readiness findings can declare the substitution.
   */
  b314DesignPressureAssumed: boolean;
}

export type FfsScenarioLifeSummaryStatus =
  | FfsLifeStatus
  | 'mixed-unbounded'
  | 'empty';

export interface FfsScenarioSummary {
  populationCount: number;
  acceptableCount: number;
  unacceptableCount: number;
  governingErf: FfsScreenedResult | null;
  governingLife: FfsScreenedResult | null;
  lifeSummaryStatus: FfsScenarioLifeSummaryStatus;
  lifeStatusCounts: Record<FfsLifeStatus, number>;
}

export type FfsRepairCreditReason =
  | 'NOT_PERMANENT_REPAIR'
  | 'REPORT_CONTEXT_INVALID'
  | 'FEATURE_ID_MISSING'
  | 'FEATURE_ID_DUPLICATE'
  | 'REPAIR_EVIDENCE_INCOMPLETE'
  | 'REPAIR_DATE_INVALID'
  | 'REPAIR_PREDATES_INSPECTION'
  | 'REPAIR_DATE_IN_FUTURE';

export interface FfsRepairCreditDecision {
  credited: boolean;
  reasons: FfsRepairCreditReason[];
}

export interface FfsReportCase {
  asInspected: FfsScenarioSummary;
  asManaged: FfsScenarioSummary;
  /** Exact active population used by every managed-scenario consumer. */
  asManagedItems: FfsScreenedResult[];
  /** Line-level remnant life as the line stands, over the active population. */
  remnantLife: FfsPipelineRemnantLife;
  /** The same figure assuming the recommended permanent repairs are done. */
  remnantLifeAfterRepairProgramme: FfsPipelineRemnantLife;
  /** Features the "after repair" figure assumes are cut out and replaced. */
  repairProgrammeTargets: FfsScreenedResult[];
  /** One centralized, fail-closed credit decision per assessed feature. */
  repairCreditDecisions: ReadonlyMap<FfsScreenedResult, FfsRepairCreditDecision>;
  repairCounts: {
    unrepaired: number;
    temporary: number;
    permanentVerified: number;
    permanentPendingEvidence: number;
  };
  readiness: {
    status: 'ready' | 'ready-with-warnings' | 'blocked';
    findings: FfsReadinessFinding[];
  };
}

function normalizedText(value: string | null | undefined): string {
  return String(value ?? '').trim();
}

function normalizedFeatureId(value: string | null | undefined): string {
  return normalizedText(value).toLocaleLowerCase('en-US');
}

/** Formats the user's local calendar date without UTC rollover. */
export function formatLocalCalendarDate(date = new Date()): string {
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Creates the explicit assessment time basis shared by UI, actions and exports. */
export function createFfsReportContext(
  config: FfsConfig,
  asOfDate = new Date(),
): FfsReportContext {
  return {
    inspectionDateIso: config.iliDate.toISOString().slice(0, 10),
    asOfDateIso: formatLocalCalendarDate(asOfDate),
    reviewThresholdYears: config.highlightYears,
    b314DesignPressureAssumed: !(
      config.internalDesignPressureMpa !== null
      && config.internalDesignPressureMpa !== undefined
      && Number.isFinite(config.internalDesignPressureMpa)
      && config.internalDesignPressureMpa > 0
    ),
  };
}

function scenarioSummary(items: FfsScreenedResult[]): FfsScenarioSummary {
  const byErf = [...items].sort((a, b) => b.nominal.ERF - a.nominal.ERF);
  const byLife = items
    .filter((item) => item.nominal.remnantLife.status === 'calculated')
    .sort((a, b) =>
      lifeSortValue(a.nominal.remnantLife.years) - lifeSortValue(b.nominal.remnantLife.years));
  const acceptableCount = items.filter((item) => item.nominal.acceptance === 'Acceptable').length;
  const lifeStatusCounts: Record<FfsLifeStatus, number> = {
    calculated: 0,
    'not-reached-within-horizon': 0,
    'insufficient-growth-basis': 0,
  };
  for (const item of items) lifeStatusCounts[item.nominal.remnantLife.status] += 1;

  let lifeSummaryStatus: FfsScenarioLifeSummaryStatus;
  if (items.length === 0) lifeSummaryStatus = 'empty';
  else if (lifeStatusCounts.calculated > 0) lifeSummaryStatus = 'calculated';
  else if (
    lifeStatusCounts['not-reached-within-horizon'] > 0 &&
    lifeStatusCounts['insufficient-growth-basis'] > 0
  ) lifeSummaryStatus = 'mixed-unbounded';
  else if (lifeStatusCounts['insufficient-growth-basis'] > 0) lifeSummaryStatus = 'insufficient-growth-basis';
  else lifeSummaryStatus = 'not-reached-within-horizon';

  return {
    populationCount: items.length,
    acceptableCount,
    unacceptableCount: items.length - acceptableCount,
    governingErf: byErf[0] ?? null,
    governingLife: byLife[0] ?? null,
    lifeSummaryStatus,
    lifeStatusCounts,
  };
}

function finding(
  code: string,
  severity: FfsReadinessSeverity,
  message: string,
  affectedCount: number,
): FfsReadinessFinding {
  return { code, severity, message, affectedCount };
}

/**
 * Computes repair capacity credit once for the complete population. Identity is
 * deliberately population-aware: a blank or duplicated ID can never remove a
 * feature from the active managed scenario.
 */
export function buildRepairCreditDecisions(
  items: FfsScreenedResult[],
  context: FfsReportContext,
): ReadonlyMap<FfsScreenedResult, FfsRepairCreditDecision> {
  const identityCounts = new Map<string, number>();
  for (const item of items) {
    const identity = normalizedFeatureId(item.nominal.featureId);
    if (identity) identityCounts.set(identity, (identityCounts.get(identity) ?? 0) + 1);
  }

  const contextValid = isIsoCalendarDate(context.inspectionDateIso) &&
    isIsoCalendarDate(context.asOfDateIso) &&
    context.inspectionDateIso <= context.asOfDateIso;
  const decisions = new Map<FfsScreenedResult, FfsRepairCreditDecision>();

  for (const item of items) {
    const nominal = item.nominal;
    const reasons: FfsRepairCreditReason[] = [];
    const featureId = normalizedFeatureId(nominal.featureId);
    const repairDate = normalizedText(nominal.repairDate);

    if (nominal.repairStatus !== 'permanent-repair-verified') reasons.push('NOT_PERMANENT_REPAIR');
    if (!contextValid) reasons.push('REPORT_CONTEXT_INVALID');
    if (!featureId) reasons.push('FEATURE_ID_MISSING');
    else if ((identityCounts.get(featureId) ?? 0) !== 1) reasons.push('FEATURE_ID_DUPLICATE');
    if (
      !normalizedText(nominal.repairMethod) ||
      !repairDate ||
      !normalizedText(nominal.repairReference)
    ) reasons.push('REPAIR_EVIDENCE_INCOMPLETE');
    if (repairDate && !isIsoCalendarDate(repairDate)) reasons.push('REPAIR_DATE_INVALID');
    if (isIsoCalendarDate(repairDate) && contextValid && repairDate < context.inspectionDateIso) {
      reasons.push('REPAIR_PREDATES_INSPECTION');
    }
    if (isIsoCalendarDate(repairDate) && contextValid && repairDate > context.asOfDateIso) {
      reasons.push('REPAIR_DATE_IN_FUTURE');
    }

    decisions.set(item, { credited: reasons.length === 0, reasons });
  }

  return decisions;
}

export function buildFfsReportCase(
  items: FfsScreenedResult[],
  context: FfsReportContext,
): FfsReportCase {
  const repairCreditDecisions = buildRepairCreditDecisions(items, context);
  const activeItems = items.filter((item) => !repairCreditDecisions.get(item)?.credited);
  const temporaryCount = items.filter((item) => item.nominal.repairStatus === 'temporary-repair').length;
  const permanentStatusCount = items.filter(
    (item) => item.nominal.repairStatus === 'permanent-repair-verified',
  ).length;
  const permanentVerifiedCount = items.filter(
    (item) => repairCreditDecisions.get(item)?.credited,
  ).length;
  const findings: FfsReadinessFinding[] = [];

  const contextValid = isIsoCalendarDate(context.inspectionDateIso) &&
    isIsoCalendarDate(context.asOfDateIso) &&
    context.inspectionDateIso <= context.asOfDateIso;
  if (!contextValid) {
    findings.push(finding(
      'REPORT_CONTEXT_INVALID',
      'error',
      'Inspection date and report as-of date must be valid, ordered ISO calendar dates.',
      items.length,
    ));
  }

  if (items.length === 0) {
    findings.push(finding('NO_ASSESSED_FEATURES', 'error', 'No assessed feature is available for reporting.', 0));
  }

  const missingIdentityCount = items.filter((item) => !normalizedFeatureId(item.nominal.featureId)).length;
  if (missingIdentityCount > 0) {
    findings.push(finding(
      'FEATURE_ID_MISSING',
      'error',
      'Every reported feature needs a stable feature identifier.',
      missingIdentityCount,
    ));
  }

  const identityCounts = new Map<string, number>();
  for (const item of items) {
    const identity = normalizedFeatureId(item.nominal.featureId);
    if (identity) identityCounts.set(identity, (identityCounts.get(identity) ?? 0) + 1);
  }
  const duplicateIdentityRows = items.filter((item) => {
    const identity = normalizedFeatureId(item.nominal.featureId);
    return Boolean(identity) && (identityCounts.get(identity) ?? 0) > 1;
  }).length;
  if (duplicateIdentityRows > 0) {
    findings.push(finding(
      'DUPLICATE_FEATURE_ID',
      'error',
      'Duplicate feature identifiers prevent an auditable repair and calculation trace.',
      duplicateIdentityRows,
    ));
  }

  const incompleteRepairEvidence = items.filter((item) => {
    const nominal = item.nominal;
    return nominal.repairStatus !== 'unrepaired' &&
      (!normalizedText(nominal.repairMethod) ||
        !normalizedText(nominal.repairDate) ||
        !normalizedText(nominal.repairReference));
  }).length;
  if (incompleteRepairEvidence > 0) {
    findings.push(finding(
      'REPAIR_EVIDENCE_INCOMPLETE',
      'error',
      'Every repair disposition requires method, completion date, and evidence reference.',
      incompleteRepairEvidence,
    ));
  }

  const invalidRepairDateCount = items.filter((item) => {
    const date = normalizedText(item.nominal.repairDate);
    return item.nominal.repairStatus !== 'unrepaired' && Boolean(date) && !isIsoCalendarDate(date);
  }).length;
  if (invalidRepairDateCount > 0) {
    findings.push(finding(
      'REPAIR_DATE_INVALID',
      'error',
      'Repair completion dates must be real calendar dates in YYYY-MM-DD format.',
      invalidRepairDateCount,
    ));
  }

  const repairPredatesInspectionCount = contextValid
    ? items.filter((item) => {
        const date = normalizedText(item.nominal.repairDate);
        return item.nominal.repairStatus === 'permanent-repair-verified' &&
          isIsoCalendarDate(date) && date < context.inspectionDateIso;
      }).length
    : 0;
  if (repairPredatesInspectionCount > 0) {
    findings.push(finding(
      'REPAIR_PREDATES_INSPECTION',
      'error',
      'A permanent repair completed before the ILI cannot resolve a feature reported by that later inspection.',
      repairPredatesInspectionCount,
    ));
  }

  const futureRepairCount = contextValid
    ? items.filter((item) => {
        const date = normalizedText(item.nominal.repairDate);
        return item.nominal.repairStatus !== 'unrepaired' &&
          isIsoCalendarDate(date) && date > context.asOfDateIso;
      }).length
    : 0;
  if (futureRepairCount > 0) {
    findings.push(finding(
      'REPAIR_DATE_IN_FUTURE',
      'error',
      'A verified repair completion date cannot be after the report as-of date.',
      futureRepairCount,
    ));
  }

  if (temporaryCount > 0) {
    findings.push(finding(
      'TEMPORARY_REPAIR_ACTIVE',
      'warning',
      'Temporary repairs remain in the active as-managed population until permanent repair is verified.',
      temporaryCount,
    ));
  }

  const temporaryActionGapCount = items.filter((item) =>
    item.nominal.repairStatus === 'temporary-repair' &&
    (!normalizedText(item.nominal.recommendation) || !normalizedText(item.nominal.actionOwner))
  ).length;
  if (temporaryActionGapCount > 0) {
    findings.push(finding(
      'TEMPORARY_REPAIR_ACTION_INCOMPLETE',
      'warning',
      'Temporary repairs need a follow-up recommendation and accountable action owner.',
      temporaryActionGapCount,
    ));
  }

  const noGrowthBasisCount = activeItems.filter(
    (item) => item.nominal.remnantLife.status === 'insufficient-growth-basis',
  ).length;
  if (noGrowthBasisCount > 0) {
    findings.push(finding(
      'GROWTH_BASIS_UNAVAILABLE',
      'warning',
      'No remaining life is projected for these features: the source reports a growth rate of zero for '
      + 'them and no rate could be derived. A measured zero is inside the sizing tolerance of any run '
      + 'pair, so it is not evidence that corrosion has stopped — enter a fallback growth rate, or a '
      + 'commissioning year so a service-age rate can be derived, before the report is relied on.',
      noGrowthBasisCount,
    ));
  }

  // Derived rates are the reason every corroding feature now carries a remnant
  // life, and exactly the reason each one has to be named: the number is a
  // stand-in for a measurement the run pair did not make.
  const serviceAgeRateCount = activeItems.filter(
    (item) => item.nominal.growthEvidence?.depth.analysisBasis === 'service-age',
  ).length;
  if (serviceAgeRateCount > 0) {
    findings.push(finding(
      'GROWTH_RATE_DERIVED_FROM_SERVICE_AGE',
      'warning',
      'Depth growth was derived from the measured metal loss over the service age of the line, because '
      + 'no run-pair rate exists for these features. It assumes uniform loss since commissioning and '
      + 'under-rates any defect that initiated late.',
      serviceAgeRateCount,
    ));
  }

  const populationRateCount = activeItems.filter(
    (item) => item.nominal.growthEvidence?.depth.analysisBasis === 'population-percentile',
  ).length;
  if (populationRateCount > 0) {
    findings.push(finding(
      'GROWTH_RATE_DERIVED_FROM_POPULATION',
      'warning',
      'Depth growth was derived from the percentile rate of comparable measured features, because '
      + 'neither a run-pair rate nor a service age was available. It is a population estimate, not a '
      + 'measurement of these features.',
      populationRateCount,
    ));
  }

  // ASME B31.4-2025 para. 451.6.2.2 dispositions. These are Code requirements,
  // not screening bands, so they are stated as requirements — and they are
  // warnings rather than errors: an assessment that finds areas needing repair
  // has done its job, and blocking the report over it would withhold the very
  // finding the operator has to act on.
  const b314RemoveOrRepairCount = activeItems.filter(
    (item) => item.b314?.disposition === 'remove-or-repair',
  ).length;
  if (b314RemoveOrRepairCount > 0) {
    findings.push(finding(
      'B314_REMOVE_OR_REPAIR_REQUIRED',
      'warning',
      'ASME B31.4-2025 para. 451.6.2.2(a): these areas exceed 80% of the wall thickness and shall be '
      + 'removed or repaired. No remaining-strength result admits them.',
      b314RemoveOrRepairCount,
    ));
  }

  const b314ReduceMopCount = activeItems.filter(
    (item) => item.b314?.disposition === 'repair-replace-or-reduce-mop',
  ).length;
  if (b314ReduceMopCount > 0) {
    findings.push(finding(
      'B314_SAFE_PRESSURE_BELOW_MOP',
      'warning',
      'ASME B31.4-2025 para. 451.6.2.2(b): the safe operating pressure established for these areas is '
      + 'below the maximum operating pressure, so each shall be removed or repaired, or the maximum '
      + 'operating pressure reduced to the safe operating pressure or less.',
      b314ReduceMopCount,
    ));
  }

  const b314AnalysisCount = activeItems.filter(
    (item) => item.b314?.disposition === 'engineering-analysis-required',
  ).length;
  if (b314AnalysisCount > 0) {
    findings.push(finding(
      'B314_ENGINEERING_ANALYSIS_REQUIRED',
      'error',
      'ASME B31.4-2025 para. 451.6.2.2(b): for a yield-to-tensile ratio above 0.93, or a line subject to '
      + 'unusual axial loads, lateral movement, or settlement, an engineering analysis shall establish '
      + 'the safe operating pressure. A B31G screen is not the Code disposition for these areas.',
      b314AnalysisCount,
    ));
  }

  const b314NoDesignThicknessCount = activeItems.filter(
    (item) => item.b314DesignThicknessMm === null || item.b314DesignThicknessMm === undefined,
  ).length;
  if (b314NoDesignThicknessCount > 0) {
    findings.push(finding(
      'B314_DESIGN_THICKNESS_UNAVAILABLE',
      'info',
      'The ASME B31.4 para. 403.2.1 design thickness could not be established for these features, so the '
      + 'para. 451.6.2.2(b) 20% no-repair band was not applied to them. They are dispositioned on the '
      + 'safe operating pressure alone, which is the more conservative of the two.',
      b314NoDesignThicknessCount,
    ));
  }

  // B31G para. 1.9 recommends the hydrotest-to-MAOP ratio, usually not below
  // 1.25. A design factor of 1.0 derives a safety factor of exactly 1.0, which
  // leaves the safe pressure equal to the failure pressure.
  const thinSafetyFactorCount = items.filter(
    (item) => item.nominal.safetyFactor < MINIMUM_RECOMMENDED_SAFETY_FACTOR,
  ).length;
  if (thinSafetyFactorCount > 0) {
    findings.push(finding(
      'SAFETY_FACTOR_BELOW_RECOMMENDED',
      'error',
      `The safety factor dividing the failure pressure is below the ${MINIMUM_RECOMMENDED_SAFETY_FACTOR} minimum recommended by ASME B31G para. 1.9.`,
      thinSafetyFactorCount,
    ));
  }

  const derivedSafetyFactorCount = items.filter(
    (item) => item.nominal.safetyFactorSource === 'derived-from-design-factor',
  ).length;
  if (derivedSafetyFactorCount > 0) {
    findings.push(finding(
      'SAFETY_FACTOR_DERIVED_FROM_DESIGN_FACTOR',
      'info',
      'The safety factor was derived from the design factor as 1/F. That is the historic B31G basis and holds only while the line operates at its design hoop stress; B31G para. 1.9 asks for the hydrostatic-test-to-MAOP ratio.',
      derivedSafetyFactorCount,
    ));
  }

  // The axial dimension is the half of the projection nobody notices is
  // missing: the ERF search still returns a date, it is just a date computed as
  // though the defect never gets any longer.
  const lengthHeldConstantCount = activeItems.filter(
    (item) => item.nominal.remnantLife.lengthHeldConstant &&
      item.nominal.remnantLife.status === 'calculated',
  ).length;
  if (lengthHeldConstantCount > 0) {
    findings.push(finding(
      'LENGTH_GROWTH_UNAVAILABLE',
      'warning',
      // The count is deliberately narrower than "features with no length rate",
      // and says so. Four defensible counts exist for this one idea — no source,
      // no usable rate, length frozen, and length frozen while a life was still
      // quoted — and publishing one of them unlabelled sent a reader to
      // reconcile a figure against three others that did not match it. This is
      // the last of the four, because it is the only one where the
      // non-conservatism reaches a number somebody acts on.
      'No axial length growth rate was established, so the projection holds the length constant and quotes a '
      + 'remnant life anyway. The ERF limit is non-conservative in the length direction for these features. '
      + 'Counted where a life was actually calculated, which is narrower than the count of features carrying '
      + 'no length rate at all.',
      lengthHeldConstantCount,
    ));
  }

  // The headline caveat of the whole report. Every remnant life, every priority
  // and every review date is projected from a growth rate, and where the run
  // pair matched little those rates are mostly substitutions. Stating the count
  // of urgent features without stating how many of them rest on a measurement
  // invites the reader to act on the substitutions as if they were data.
  // The 20 % no-repair band of para. 451.6.2.2(b) is a fraction of the design
  // thickness, and the design thickness follows from the design pressure. With
  // no dossier figure the operating pressure stands in, which narrows the band.
  if (context.b314DesignPressureAssumed && activeItems.length > 0) {
    findings.push(finding(
      'B314_DESIGN_PRESSURE_ASSUMED',
      'info',
      'No internal design pressure was supplied, so the B31.4 para. 403.2.1 design thickness was computed '
      + 'from the required operating pressure. Where the line was designed above its operating pressure the '
      + 'design thickness is understated and the 20 % no-repair band is narrower than the Code allows — '
      + 'conservative, but not the Code figure.',
      activeItems.length,
    ));
  }

  const measuredDepthCount = activeItems.filter(
    (item) => item.nominal.growthEvidence?.depth.analysisBasis === 'reported',
  ).length;
  const unmeasuredDepthCount = activeItems.length - measuredDepthCount;
  if (unmeasuredDepthCount > 0 && activeItems.length > 0) {
    const share = Math.round((unmeasuredDepthCount / activeItems.length) * 100);
    findings.push(finding(
      'GROWTH_RATE_NOT_MEASURED',
      // Past half the register this stops being a footnote about some features
      // and becomes a statement about what the assessment is.
      unmeasuredDepthCount * 2 > activeItems.length ? 'warning' : 'info',
      `${share}% of the assessed features carry no run-pair measured depth growth rate. Their remnant lives, `
      + 'priorities and review dates are projected from rates the growth ladder substituted — a zero-baseline '
      + 'estimate, an engineer-entered fallback, a service-age rate, or the percentile of the measured '
      + 'population. Read every count of urgent features against this one.',
      unmeasuredDepthCount,
    ));
  }

  const clusteredCount = items.filter((item) => item.nominal.isClusteredMetalLoss).length;
  if (clusteredCount > 0) {
    findings.push(finding(
      'CLUSTERED_METAL_LOSS_ASSESSED',
      'warning',
      'Clustered metal loss is assessed as a single rectangular defect. B31G is written for one feature, and the reported box is the envelope of several pits, so the remaining strength does not carry its usual meaning.',
      clusteredCount,
    ));
  }

  const designLifeCappedCount = activeItems.filter(
    (item) => item.nominal.remnantLife.designLifeCapApplied,
  ).length;
  if (designLifeCappedCount > 0) {
    findings.push(finding(
      'REMNANT_LIFE_CAPPED_AT_DESIGN_LIFE',
      'info',
      'The calculated limit falls beyond the original design life, so the reported remnant life is the design life instead.',
      designLifeCappedCount,
    ));
  }

  const pastDesignLifeCount = activeItems.filter(
    (item) => item.nominal.remnantLife.pastDesignLifeAtInspection,
  ).length;
  if (pastDesignLifeCount > 0) {
    findings.push(finding(
      'LINE_PAST_ORIGINAL_DESIGN_LIFE',
      'warning',
      'The line had already consumed its original design life at the inspection date, so the design-life rule does not bound the reported figures. The remnant lives below are corrosion-governed only, and continued service past the design life is a life-extension decision outside this assessment.',
      pastDesignLifeCount,
    ));
  }

  const zeroBaselineEstimateCount = activeItems.filter(
    (item) => item.nominal.growthEvidence?.depth.observation === 'new-only-zero-baseline-estimate',
  ).length;
  if (zeroBaselineEstimateCount > 0) {
    findings.push(finding(
      'NEW_ONLY_ZERO_BASELINE_ESTIMATE',
      'warning',
      'NEW-only depth rates use an assumed zero-depth OLD-survey baseline. They are estimates, not measured run-pair CGRs.',
      zeroBaselineEstimateCount,
    ));
  }

  const explicitFallbackCount = activeItems.filter(
    (item) => item.nominal.growthEvidence?.depth.analysisBasis === 'explicit-fallback',
  ).length;
  if (explicitFallbackCount > 0) {
    findings.push(finding(
      'EXPLICIT_GROWTH_FALLBACK',
      'warning',
      'Depth projection uses an engineer-entered fallback where source growth was unavailable or unsuitable.',
      explicitFallbackCount,
    ));
  }

  const apparentDecreaseCount = activeItems.filter(
    (item) => item.nominal.growthEvidence?.depth.observation === 'apparent-decrease',
  ).length;
  if (apparentDecreaseCount > 0) {
    findings.push(finding(
      'APPARENT_DEPTH_DECREASE',
      'warning',
      'Matched runs report an apparent depth decrease. Preserve the observation and review ILI sizing uncertainty before assigning future growth.',
      apparentDecreaseCount,
    ));
  }

  const beyondHorizonCount = activeItems.filter(
    (item) => item.nominal.remnantLife.status === 'not-reached-within-horizon',
  ).length;
  if (beyondHorizonCount > 0) {
    findings.push(finding(
      'LIMIT_NOT_REACHED_WITHIN_HORIZON',
      'info',
      'No service-limit date is reported when the calculation does not reach a limit inside the analysis horizon.',
      beyondHorizonCount,
    ));
  }

  if (items.length > 0 && activeItems.length === 0) {
    findings.push(finding(
      'NO_ACTIVE_FEATURES_AFTER_VERIFIED_REPAIRS',
      'info',
      'All assessed features have verified permanent repair evidence tied to a unique feature; no active governing feature remains.',
      items.length,
    ));
  }

  const hasErrors = findings.some((item) => item.severity === 'error');
  const hasWarnings = findings.some((item) => item.severity === 'warning');

  const programmeTargets = repairProgrammeTargets(activeItems, context.reviewThresholdYears);
  const programmeTargetSet = new Set(programmeTargets);

  return {
    asInspected: scenarioSummary(items),
    asManaged: scenarioSummary(activeItems),
    asManagedItems: activeItems,
    remnantLife: pipelineRemnantLife(activeItems),
    remnantLifeAfterRepairProgramme: pipelineRemnantLife(
      activeItems.filter((item) => !programmeTargetSet.has(item)),
    ),
    repairProgrammeTargets: programmeTargets,
    repairCreditDecisions,
    repairCounts: {
      unrepaired: items.filter((item) => item.nominal.repairStatus === 'unrepaired').length,
      temporary: temporaryCount,
      permanentVerified: permanentVerifiedCount,
      permanentPendingEvidence: permanentStatusCount - permanentVerifiedCount,
    },
    readiness: {
      status: hasErrors ? 'blocked' : hasWarnings ? 'ready-with-warnings' : 'ready',
      findings,
    },
  };
}
