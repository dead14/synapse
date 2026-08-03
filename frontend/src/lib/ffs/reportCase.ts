import { lifeSortValue } from './lifeProjection.ts';
import type { FfsConfig, FfsLifeStatus, FfsScreenedResult } from './types.ts';
import { isIsoCalendarDate } from './validation.ts';

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
  };
}

function scenarioSummary(items: FfsScreenedResult[]): FfsScenarioSummary {
  const byErf = [...items].sort((a, b) => b.nominal.ERF - a.nominal.ERF);
  const byLife = items
    .filter((item) => item.nominal.lifeStatus === 'calculated')
    .sort((a, b) => lifeSortValue(a.nominal.expectedLife) - lifeSortValue(b.nominal.expectedLife));
  const acceptableCount = items.filter((item) => item.nominal.acceptance === 'Acceptable').length;
  const lifeStatusCounts: Record<FfsLifeStatus, number> = {
    calculated: 0,
    'not-reached-within-horizon': 0,
    'insufficient-growth-basis': 0,
  };
  for (const item of items) lifeStatusCounts[item.nominal.lifeStatus] += 1;

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
    (item) => item.nominal.lifeStatus === 'insufficient-growth-basis',
  ).length;
  if (noGrowthBasisCount > 0) {
    findings.push(finding(
      'GROWTH_BASIS_UNAVAILABLE',
      'warning',
      'Remaining life is not calculated where no positive depth or length growth basis is available.',
      noGrowthBasisCount,
    ));
  }

  const beyondHorizonCount = activeItems.filter(
    (item) => item.nominal.lifeStatus === 'not-reached-within-horizon',
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

  return {
    asInspected: scenarioSummary(items),
    asManaged: scenarioSummary(activeItems),
    asManagedItems: activeItems,
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
