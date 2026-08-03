import { useMemo, useState } from 'react';
import { FiAlertTriangle, FiCheckCircle, FiEdit3, FiPlus, FiShield, FiTool, FiX } from 'react-icons/fi';
import { formatLifeProjection } from '../../lib/ffs/lifeProjection';
import {
  buildFfsReportCase,
  type FfsReportContext,
  type FfsReadinessSeverity,
  type FfsScenarioSummary,
} from '../../lib/ffs/reportCase';
import type { FfsRepairDispositionPatch, FfsScreenedResult } from '../../lib/ffs/types';
import { isIsoCalendarDate } from '../../lib/ffs/validation';
import SynButton from '../ui/SynButton';
import { Callout, Panel, PanelHeader, Stat } from './FfsPrimitives';

function featureLabel(item: FfsScreenedResult | null): string {
  if (!item) return '—';
  return item.nominal.featureId ?? `LD ${Number(item.nominal.ld).toLocaleString()} m`;
}

function readinessPresentation(status: ReturnType<typeof buildFfsReportCase>['readiness']['status']) {
  if (status === 'blocked') {
    return {
      label: 'Blocked',
      tone: 'danger' as const,
      icon: FiAlertTriangle,
      className: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800/60 dark:bg-rose-950/30 dark:text-rose-300',
    };
  }
  if (status === 'ready-with-warnings') {
    return {
      label: 'Ready with warnings',
      tone: 'warn' as const,
      icon: FiAlertTriangle,
      className: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-300',
    };
  }
  return {
    label: 'Ready',
    tone: 'info' as const,
    icon: FiCheckCircle,
    className: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800/60 dark:bg-emerald-950/30 dark:text-emerald-300',
  };
}

function findingStyle(severity: FfsReadinessSeverity): string {
  if (severity === 'error') {
    return 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800/60 dark:bg-rose-950/30 dark:text-rose-300';
  }
  if (severity === 'warning') {
    return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-300';
  }
  return 'border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-800/60 dark:bg-indigo-950/30 dark:text-indigo-300';
}

function repairDraft(item: FfsScreenedResult): FfsRepairDispositionPatch {
  const n = item.nominal;
  return {
    repairStatus: n.repairStatus,
    repairMethod: n.repairMethod,
    repairDate: n.repairDate,
    repairReference: n.repairReference,
    recommendation: n.recommendation,
    actionOwner: n.actionOwner,
  };
}

function scenarioLifeFoot(scenario: FfsScenarioSummary): string {
  if (scenario.lifeSummaryStatus === 'empty') return 'No active feature';
  if (scenario.lifeSummaryStatus === 'insufficient-growth-basis') {
    return 'Not calculated - growth basis unavailable';
  }
  if (scenario.lifeSummaryStatus === 'not-reached-within-horizon') {
    return 'Limit not reached within the analysis horizon';
  }
  if (scenario.lifeSummaryStatus === 'mixed-unbounded') {
    return `${scenario.lifeStatusCounts['insufficient-growth-basis']} without growth basis · ` +
      `${scenario.lifeStatusCounts['not-reached-within-horizon']} not reached within horizon`;
  }
  return 'No finite calculated limit';
}

function ScenarioCard({
  label,
  description,
  scenario,
  onSelect,
}: {
  label: string;
  description: string;
  scenario: FfsScenarioSummary;
  onSelect?: (item: FfsScreenedResult) => void;
}) {
  const governingErf = scenario.governingErf;
  const governingLife = scenario.governingLife;

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-700 dark:bg-slate-900/35">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-50">{label}</h3>
          <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">{description}</p>
        </div>
        <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
          {scenario.populationCount.toLocaleString()} features
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Stat label="Nominal acceptable" value={scenario.acceptableCount.toLocaleString()} tone="good" />
        <Stat
          label="Nominal not acceptable"
          value={scenario.unacceptableCount.toLocaleString()}
          tone={scenario.unacceptableCount > 0 ? 'bad' : 'good'}
        />
        <button
          type="button"
          disabled={!governingErf || !onSelect}
          onClick={() => governingErf && onSelect?.(governingErf)}
          className="text-left disabled:cursor-default"
        >
          <Stat
            label="Governing ERF"
            value={governingErf ? governingErf.nominal.ERF.toFixed(3) : '—'}
            foot={featureLabel(governingErf)}
            tone={governingErf && governingErf.nominal.ERF >= 1 ? 'bad' : 'accent'}
          />
        </button>
        <button
          type="button"
          disabled={!governingLife || !onSelect}
          onClick={() => governingLife && onSelect?.(governingLife)}
          className="text-left disabled:cursor-default"
        >
          <Stat
            label="Governing life"
            value={
              governingLife
                ? formatLifeProjection(
                    governingLife.nominal.expectedLife,
                    governingLife.nominal.lifeStatus,
                    governingLife.nominal.analysisHorizonYears,
                  )
                : 'Not established'
            }
            foot={governingLife
              ? `${featureLabel(governingLife)} · ${governingLife.nominal.yearService ?? 'no date'}`
              : scenarioLifeFoot(scenario)}
            tone="warn"
          />
        </button>
      </div>
    </div>
  );
}

export default function FfsCaseReviewPanel({
  items,
  reportContext,
  onSelect,
  onUpdateRepair,
  onResetRepair,
  changedRepairIndexes = new Set<number>(),
}: {
  items: FfsScreenedResult[];
  reportContext: FfsReportContext;
  onSelect?: (item: FfsScreenedResult) => void;
  onUpdateRepair?: (index: number, patch: FfsRepairDispositionPatch) => void;
  onResetRepair?: (index: number) => void;
  changedRepairIndexes?: Set<number>;
}) {
  const [selectedFeatureIndex, setSelectedFeatureIndex] = useState('');
  const [repairPage, setRepairPage] = useState(0);
  const [editingItem, setEditingItem] = useState<FfsScreenedResult | null>(null);
  const [draft, setDraft] = useState<FfsRepairDispositionPatch | null>(null);
  const reportCase = useMemo(() => buildFfsReportCase(items, reportContext), [items, reportContext]);
  const repairs = useMemo(
    () => items.filter((item) => item.nominal.repairStatus !== 'unrepaired'),
    [items],
  );
  const readiness = readinessPresentation(reportCase.readiness.status);
  const repairsPerPage = 100;
  const repairPageCount = Math.max(1, Math.ceil(repairs.length / repairsPerPage));
  const visibleRepairPage = Math.min(repairPage, repairPageCount - 1);
  const visibleRepairs = repairs.slice(
    visibleRepairPage * repairsPerPage,
    (visibleRepairPage + 1) * repairsPerPage,
  );
  const ReadinessIcon = readiness.icon;
  const selectedFeature = items.find((item) => String(item.index) === selectedFeatureIndex) ?? items[0] ?? null;
  const draftRepairMethod = draft?.repairMethod?.trim() ?? '';
  const draftRepairDate = draft?.repairDate?.trim() ?? '';
  const draftRepairReference = draft?.repairReference?.trim() ?? '';
  const draftRepairDateInvalid = Boolean(draftRepairDate && !isIsoCalendarDate(draftRepairDate));
  const draftRepairDateFuture = Boolean(
    draftRepairDate && isIsoCalendarDate(draftRepairDate) &&
    draftRepairDate > reportContext.asOfDateIso,
  );
  const draftRepairPredatesInspection = Boolean(
    draft?.repairStatus === 'permanent-repair-verified' &&
    draftRepairDate && isIsoCalendarDate(draftRepairDate) &&
    draftRepairDate < reportContext.inspectionDateIso,
  );

  const openEditor = (item: FfsScreenedResult) => {
    setEditingItem(item);
    setDraft(repairDraft(item));
  };

  const saveEditor = () => {
    if (!editingItem || !draft || !onUpdateRepair) return;
    const trimmedDraft: FfsRepairDispositionPatch = {
      ...draft,
      repairMethod: draft.repairMethod?.trim() || null,
      repairDate: draft.repairDate?.trim() || null,
      repairReference: draft.repairReference?.trim() || null,
      recommendation: draft.recommendation?.trim() || null,
      actionOwner: draft.actionOwner?.trim() || null,
    };
    const normalized = trimmedDraft.repairStatus === 'unrepaired'
      ? {
          repairStatus: 'unrepaired' as const,
          repairMethod: null,
          repairDate: null,
          repairReference: null,
          recommendation: trimmedDraft.recommendation,
          actionOwner: trimmedDraft.actionOwner,
        }
      : trimmedDraft;
    onUpdateRepair(editingItem.index, normalized);
    setEditingItem(null);
    setDraft(null);
  };

  return (
    <div className="space-y-5">
      <Panel>
        <PanelHeader
          title="FFS report case"
          headingLevel={2}
          subtitle="Controlled comparison of the inspected population and the active population after evidence-qualified repairs."
          actions={(
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-wide ${readiness.className}`}>
              <ReadinessIcon aria-hidden="true" className="h-3.5 w-3.5" />
              Report {readiness.label}
            </span>
          )}
        />

        <Callout tone={readiness.tone}>
          {reportCase.readiness.status === 'blocked'
            ? 'The calculation remains available for engineering review, but the report is a draft until every blocking evidence or identity finding is resolved.'
            : reportCase.readiness.status === 'ready-with-warnings'
              ? 'No blocking traceability gap was found. Review the warnings before approving the final engineering disposition.'
              : 'Minimum identity and repair-evidence checks are complete. Independent checking and approval are still required.'}
        </Callout>

        <div className="mt-4 grid gap-3 xl:grid-cols-2">
          <ScenarioCard
            label="As-inspected"
            description="All assessed metal-loss features, before any repair credit."
            scenario={reportCase.asInspected}
            onSelect={onSelect}
          />
          <ScenarioCard
            label="As-managed"
            description="Active features after only evidence-qualified permanent repairs are removed. Temporary or unverified repairs remain active."
            scenario={reportCase.asManaged}
            onSelect={onSelect}
          />
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
          <Stat label="Unrepaired" value={reportCase.repairCounts.unrepaired.toLocaleString()} />
          <Stat
            label="Temporary repair"
            value={reportCase.repairCounts.temporary.toLocaleString()}
            tone={reportCase.repairCounts.temporary > 0 ? 'warn' : 'default'}
          />
          <Stat
            label="Permanent · credited"
            value={reportCase.repairCounts.permanentVerified.toLocaleString()}
            tone="good"
          />
          <Stat
            label="Permanent · pending credit"
            value={reportCase.repairCounts.permanentPendingEvidence.toLocaleString()}
            tone={reportCase.repairCounts.permanentPendingEvidence > 0 ? 'bad' : 'default'}
          />
        </div>
      </Panel>

      <Panel padded={false}>
        <div className="p-5 pb-3">
          <PanelHeader
            title="Repair disposition register"
            subtitle="Capacity credit requires a unique feature ID and permanent-repair evidence completed from the ILI date through the report as-of date."
            actions={onUpdateRepair ? (
              <>
                <select
                  value={selectedFeatureIndex || String(selectedFeature?.index ?? '')}
                  onChange={(event) => setSelectedFeatureIndex(event.target.value)}
                  aria-label="Feature to update"
                  className="max-w-[220px] rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-700 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                >
                  {items.map((item) => (
                    <option key={`${item.key}-${item.index}`} value={item.index}>
                      {item.nominal.featureId ?? `Row ${item.index + 1}`} · LD {Number(item.nominal.ld).toLocaleString()} m
                    </option>
                  ))}
                </select>
                <SynButton
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!selectedFeature}
                  onClick={() => selectedFeature && openEditor(selectedFeature)}
                >
                  <span className="inline-flex items-center gap-1.5"><FiPlus /> Record / update</span>
                </SynButton>
              </>
            ) : <FiTool aria-hidden="true" className="h-4 w-4 text-slate-400" />}
          />
        </div>
        {repairs.length === 0 ? (
          <div className="border-t border-slate-200 px-5 py-8 text-center text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
            No repair disposition is recorded. All features remain in the as-managed population.
          </div>
        ) : (
          <>
          <div className="overflow-x-auto border-t border-slate-200 dark:border-slate-700">
            <table className="min-w-[1180px] w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-900/55">
                <tr className="text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  <th className="px-4 py-2.5">Feature</th>
                  <th className="px-3 py-2.5 text-right">LD [m]</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="px-3 py-2.5">Method</th>
                  <th className="px-3 py-2.5">Date</th>
                  <th className="px-3 py-2.5">Evidence</th>
                  <th className="px-3 py-2.5">Owner / recommendation</th>
                  <th className="px-4 py-2.5">As-managed treatment</th>
                  {onUpdateRepair && <th className="px-4 py-2.5 text-right">Edit</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/70">
                {visibleRepairs.map((item) => {
                  const n = item.nominal;
                  const credited = reportCase.repairCreditDecisions.get(item)?.credited === true;
                  return (
                    <tr key={`${item.key}-${item.index}`} className="text-slate-700 dark:text-slate-300">
                      <td className="px-4 py-2 font-mono text-[11px] font-semibold text-slate-900 dark:text-slate-100">
                        <button type="button" onClick={() => onSelect?.(item)} className="hover:text-indigo-600 dark:hover:text-indigo-400">
                          {n.featureId ?? '—'}
                        </button>
                        {changedRepairIndexes.has(item.index) && (
                          <span className="ml-1.5 font-sans text-[9px] font-bold uppercase tracking-wide text-indigo-600 dark:text-indigo-400">edited</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">{Number(n.ld).toLocaleString()}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                          n.repairStatus === 'temporary-repair'
                            ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-300'
                            : 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800/60 dark:bg-emerald-950/30 dark:text-emerald-300'
                        }`}>
                          {n.repairStatus === 'temporary-repair' ? 'Temporary' : 'Permanent'}
                        </span>
                      </td>
                      <td className="px-3 py-2">{n.repairMethod ?? '—'}</td>
                      <td className="px-3 py-2 font-mono text-[11px]">{n.repairDate ?? '—'}</td>
                      <td className="px-3 py-2 font-mono text-[11px]">{n.repairReference ?? '—'}</td>
                      <td className="max-w-[260px] px-3 py-2">
                        <p className="font-semibold text-slate-800 dark:text-slate-200">{n.actionOwner ?? 'Owner not assigned'}</p>
                        <p className="mt-0.5 truncate text-[11px] text-slate-500 dark:text-slate-400">{n.recommendation ?? 'No recommendation recorded'}</p>
                      </td>
                      <td className="px-4 py-2">
                        <span className={credited ? 'font-semibold text-emerald-600 dark:text-emerald-400' : 'font-semibold text-amber-600 dark:text-amber-400'}>
                          {credited ? 'Excluded · evidence validated' : 'Active · no capacity credit'}
                        </span>
                      </td>
                      {onUpdateRepair && (
                        <td className="px-4 py-2 text-right">
                          <button
                            type="button"
                            onClick={() => openEditor(item)}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[10px] font-semibold text-slate-600 transition-colors hover:border-indigo-300 hover:text-indigo-600 dark:border-slate-700 dark:text-slate-300 dark:hover:border-indigo-700 dark:hover:text-indigo-400"
                          >
                            <FiEdit3 aria-hidden="true" /> Edit
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {repairPageCount > 1 && (
            <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-5 py-3 text-[11px] text-slate-500 dark:border-slate-700 dark:text-slate-400">
              <span>
                Repair records {(visibleRepairPage * repairsPerPage + 1).toLocaleString()}-
                {Math.min((visibleRepairPage + 1) * repairsPerPage, repairs.length).toLocaleString()} of{' '}
                {repairs.length.toLocaleString()}
              </span>
              <div className="flex items-center gap-2">
                <SynButton
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={visibleRepairPage === 0}
                  onClick={() => setRepairPage((page) => Math.max(0, page - 1))}
                >
                  Previous
                </SynButton>
                <span className="tabular-nums">Page {visibleRepairPage + 1} / {repairPageCount}</span>
                <SynButton
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={visibleRepairPage >= repairPageCount - 1}
                  onClick={() => setRepairPage((page) => Math.min(repairPageCount - 1, page + 1))}
                >
                  Next
                </SynButton>
              </div>
            </div>
          )}
          </>
        )}
      </Panel>

      <Panel padded={false}>
        <div className="p-5 pb-3">
          <PanelHeader
            title="Report readiness findings"
            subtitle="Deterministic checks for feature identity, repair evidence, and bounded life projection."
            actions={<FiShield aria-hidden="true" className="h-4 w-4 text-slate-400" />}
          />
        </div>
        {reportCase.readiness.findings.length === 0 ? (
          <div className="border-t border-slate-200 px-5 py-6 text-xs text-emerald-700 dark:border-slate-700 dark:text-emerald-400">
            <span className="inline-flex items-center gap-2 font-semibold">
              <FiCheckCircle aria-hidden="true" /> No blocking or warning finding.
            </span>
          </div>
        ) : (
          <div className="overflow-x-auto border-t border-slate-200 dark:border-slate-700">
            <table className="min-w-[760px] w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-900/55">
                <tr className="text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  <th className="px-4 py-2.5">Severity</th>
                  <th className="px-3 py-2.5">Check code</th>
                  <th className="px-3 py-2.5 text-right">Affected</th>
                  <th className="px-4 py-2.5">Finding</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/70">
                {reportCase.readiness.findings.map((finding) => (
                  <tr key={finding.code} className="text-slate-700 dark:text-slate-300">
                    <td className="px-4 py-2">
                      <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${findingStyle(finding.severity)}`}>
                        {finding.severity}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px] font-semibold">{finding.code}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{finding.affectedCount.toLocaleString()}</td>
                    <td className="px-4 py-2 leading-relaxed">{finding.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Callout>
        Scope boundary: this view covers FFS capacity, degradation projection, repair disposition, and evidence readiness. Risk ranking and next-inspection scheduling remain separate workflows.
      </Callout>

      {editingItem && draft && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Edit repair disposition"
          className="fixed inset-0 z-[100000] flex items-center justify-center bg-slate-900/70 p-4 backdrop-blur-sm"
          onClick={() => {
            setEditingItem(null);
            setDraft(null);
          }}
        >
          <div
            className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-800"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 dark:border-slate-700">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wide text-indigo-600 dark:text-indigo-400">Repair evidence</p>
                <h3 className="mt-1 text-base font-bold text-slate-900 dark:text-slate-50">
                  {editingItem.nominal.featureId ?? `Row ${editingItem.index + 1}`} · LD {Number(editingItem.nominal.ld).toLocaleString()} m
                </h3>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Changes apply to this assessment session and its Excel/Word outputs.
                </p>
              </div>
              <button
                type="button"
                aria-label="Close repair editor"
                onClick={() => {
                  setEditingItem(null);
                  setDraft(null);
                }}
                className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-200"
              >
                <FiX aria-hidden="true" />
              </button>
            </div>

            <div className="overflow-y-auto px-5 py-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Repair status</span>
                  <select
                    value={draft.repairStatus}
                    onChange={(event) => setDraft((previous) => previous && ({
                      ...previous,
                      repairStatus: event.target.value as FfsRepairDispositionPatch['repairStatus'],
                    }))}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                  >
                    <option value="unrepaired">Unrepaired</option>
                    <option value="temporary-repair">Temporary repair</option>
                    <option value="permanent-repair-verified">Permanent repair verified</option>
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Repair method</span>
                  <input
                    type="text"
                    value={draft.repairMethod ?? ''}
                    disabled={draft.repairStatus === 'unrepaired'}
                    onChange={(event) => setDraft((previous) => previous && ({ ...previous, repairMethod: event.target.value || null }))}
                    placeholder="e.g. cut and replace, steel sleeve"
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 focus:border-indigo-500 focus:outline-none disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Completion date</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="\d{4}-\d{2}-\d{2}"
                    value={draft.repairDate ?? ''}
                    disabled={draft.repairStatus === 'unrepaired'}
                    onChange={(event) => setDraft((previous) => previous && ({ ...previous, repairDate: event.target.value || null }))}
                    placeholder="YYYY-MM-DD"
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 focus:border-indigo-500 focus:outline-none disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Evidence reference</span>
                  <input
                    type="text"
                    value={draft.repairReference ?? ''}
                    disabled={draft.repairStatus === 'unrepaired'}
                    onChange={(event) => setDraft((previous) => previous && ({ ...previous, repairReference: event.target.value || null }))}
                    placeholder="Work order, dossier, certificate"
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 focus:border-indigo-500 focus:outline-none disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Action owner</span>
                  <input
                    type="text"
                    value={draft.actionOwner ?? ''}
                    onChange={(event) => setDraft((previous) => previous && ({ ...previous, actionOwner: event.target.value || null }))}
                    placeholder="Responsible discipline or person"
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                  />
                </label>
                <label className="block sm:col-span-2">
                  <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Recommendation / follow-up</span>
                  <textarea
                    rows={3}
                    value={draft.recommendation ?? ''}
                    onChange={(event) => setDraft((previous) => previous && ({ ...previous, recommendation: event.target.value || null }))}
                    placeholder="Record the engineering disposition or required follow-up."
                    className="w-full resize-y rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                  />
                </label>
              </div>

              {draft.repairStatus !== 'unrepaired' &&
                (!draftRepairMethod || !draftRepairDate || !draftRepairReference ||
                  draftRepairDateInvalid || draftRepairDateFuture || draftRepairPredatesInspection) && (
                  <div className="mt-4">
                    <Callout tone="danger">
                      {draftRepairDateInvalid
                        ? 'Completion date must be a real calendar date in YYYY-MM-DD format.'
                        : draftRepairDateFuture
                          ? 'A completed repair cannot use a future completion date.'
                          : draftRepairPredatesInspection
                            ? 'A permanent repair completed before the ILI cannot resolve a feature reported by that later inspection.'
                          : 'Method, completion date, and evidence reference are required for an auditable repair disposition.'}{' '}
                      Until resolved, this feature remains active and report readiness is blocked.
                    </Callout>
                  </div>
                )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-5 py-4 dark:border-slate-700">
              <div>
                {changedRepairIndexes.has(editingItem.index) && onResetRepair && (
                  <SynButton
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      onResetRepair(editingItem.index);
                      setEditingItem(null);
                      setDraft(null);
                    }}
                  >
                    Reset to source data
                  </SynButton>
                )}
              </div>
              <div className="flex items-center gap-2">
                <SynButton
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setEditingItem(null);
                    setDraft(null);
                  }}
                >
                  Cancel
                </SynButton>
                <SynButton type="button" variant="lime" size="sm" onClick={saveEditor}>
                  Save disposition
                </SynButton>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
