/**
 * Case review by spool.
 *
 * The rest of the FFS workspace reviews features. This reviews pipe: every
 * anomaly between one girth weld and the next, the single ERF and remnant life
 * that govern that joint, the mean corrosion rate across it, and the one
 * decision an engineer actually takes — what to do with this spool.
 *
 * Two things deliberately do not happen here. No B31G figure is recalculated;
 * every number is the governing member's own. And recording a *plan* never
 * touches `repairStatus`: a planned sleeve is not a completed repair, and
 * crediting it would remove the feature from the as-managed population before
 * anyone has been to site. Plans are written to the recommendation and owner
 * fields; completed evidence stays in the repair disposition register.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  FiActivity,
  FiBox,
  FiCheckSquare,
  FiDownload,
  FiGrid,
  FiSquare,
  FiTool,
  FiX,
} from 'react-icons/fi';
import { formatRemnantLife, remnantLimitLabel } from '../../lib/ffs/lifeProjection';
import {
  buildFfsSpools,
  buildSpoolProgramme,
  emptySpoolDisposition,
  FFS_REPAIR_OPTIONS,
  repairOptionById,
  suggestSpoolDisposition,
  type FfsSpool,
  type FfsSpoolDecision,
  type FfsSpoolDisposition,
} from '../../lib/ffs/spoolReview';
import { exportSpoolReviewWorkbook } from '../../lib/ffs/spoolExports';
import type { FfsReportContext } from '../../lib/ffs/reportCase';
import type {
  FfsConfig,
  FfsRepairDispositionPatch,
  FfsScreenedResult,
  FfsScreeningConfig,
  FfsSeverity,
} from '../../lib/ffs/types';
import { isIsoCalendarDate } from '../../lib/ffs/validation';
import SynButton from '../ui/SynButton';
import { Callout, Panel, PanelHeader, Stat, formatErf } from './FfsPrimitives';
import { FfsSpoolProjectionView, FfsSpoolUnrolledView } from './FfsSpoolGeometry';

const SEVERITY_STYLE: Record<FfsSeverity, string> = {
  fail: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800/60 dark:bg-rose-950/30 dark:text-rose-300',
  review: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-300',
  pass: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800/60 dark:bg-emerald-950/30 dark:text-emerald-300',
};

const SEVERITY_LABEL: Record<FfsSeverity, string> = {
  fail: 'Not acceptable',
  review: 'Review',
  pass: 'Acceptable',
};

const DECISION_LABEL: Record<FfsSpoolDecision, string> = {
  repair: 'Repair',
  monitor: 'Monitor',
  defer: 'Defer with justification',
  'no-action': 'No action',
};

const FIELD_CLASS =
  'w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200';

const SPOOLS_PER_PAGE = 60;
const MEMBERS_SHOWN = 250;

function numericLd(item: FfsScreenedResult): number {
  const value = Number(item.nominal.ld);
  return Number.isFinite(value) ? value : 0;
}

function metres(value: number | null): string {
  return value === null || !Number.isFinite(value) ? '—' : value.toFixed(1);
}

function rate(value: number | null): string {
  return value === null || !Number.isFinite(value) ? '—' : value.toFixed(3);
}

function extentLabel(spool: FfsSpool): string {
  if (spool.usGwLdM !== null && spool.dsGwLdM !== null) {
    return `${metres(spool.usGwLdM)} – ${metres(spool.dsGwLdM)} m`;
  }
  return `${metres(spool.firstFeatureLdM)} – ${metres(spool.lastFeatureLdM)} m`;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label}
      </span>
      {children}
    </label>
  );
}

/**
 * The B31G working of the feature that governs the spool. This is the answer to
 * "why is this spool's result what it is": the reader can follow the reported
 * geometry through the Folias factor to the safe pressure and the ratio.
 */
function GoverningCalculation({ item }: { item: FfsScreenedResult }) {
  const n = item.nominal;
  const rows: Array<[string, string]> = [
    ['Method', `${n.method === 'original' ? 'Original' : 'Modified'} B31G · branch ${n.branch}`],
    ['Reported depth d', `${n.d.toFixed(3)} mm of ${n.wall.toFixed(2)} mm wall (${n.maxDepthPct.toFixed(1)} %WT)`],
    ['Depth ratio d/t', n.dt.toFixed(4)],
    ['Length term z = L²/(D·t)', n.z.toFixed(4)],
    ['Folias factor M', n.M === null ? 'not used on this branch' : n.M.toFixed(4)],
    ['Flow stress S_flow', `${n.sflow.toFixed(2)} MPa (SMYS ${n.smys.toFixed(0)} MPa)`],
    ['Failure stress S_f', `${n.Sf.toFixed(2)} MPa`],
    ['Failure pressure P_f', `${n.Pf.toFixed(3)} MPa`],
    ['Safety factor', `${n.SF.toFixed(3)} (${n.safetyFactorSource === 'explicit' ? 'supplied' : 'derived from design factor ' + n.df.toFixed(2)})`],
    ['Safe pressure P_s = P_f / SF', `${n.safePressure.toFixed(3)} MPa`],
    ['Required pressure P₀', `${n.p0.toFixed(3)} MPa`],
    ['ERF = P₀ / P_s', `${formatErf(n.ERF)} → ${n.acceptance}`],
    ['Hoop stress at P₀', `${n.So.toFixed(2)} MPa`],
    ['Depth growth used', `${n.crDepth.toFixed(4)} mm/y`],
    ['Length growth used', n.crLength > 0 ? `${n.crLength.toFixed(4)} mm/y` : 'none established — length held constant'],
  ];
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
      <table className="w-full text-left text-xs">
        <tbody className="divide-y divide-slate-100 dark:divide-slate-700/70">
          {rows.map(([label, value]) => (
            <tr key={label} className="text-slate-700 dark:text-slate-300">
              <td className="w-[46%] px-3 py-1.5 font-medium text-slate-500 dark:text-slate-400">{label}</td>
              <td className="px-3 py-1.5 font-mono text-[11px] text-slate-900 dark:text-slate-100">{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface SpoolCardProps {
  spool: FfsSpool;
  screening: FfsScreeningConfig;
  config: FfsConfig;
  disposition: FfsSpoolDisposition | null;
  onSaveDisposition: (spoolId: string, disposition: FfsSpoolDisposition) => void;
  onClearDisposition: (spoolId: string) => void;
  onApplyToFeatures?: (indexes: number[], patch: (item: FfsScreenedResult) => FfsRepairDispositionPatch) => void;
  onRecordFeature?: (item: FfsScreenedResult) => void;
  onSelectFeature?: (item: FfsScreenedResult) => void;
  onClose: () => void;
}

function SpoolCard({
  spool,
  screening,
  config,
  disposition,
  onSaveDisposition,
  onClearDisposition,
  onApplyToFeatures,
  onRecordFeature,
  onSelectFeature,
  onClose,
}: SpoolCardProps) {
  const suggestion = useMemo(
    () => suggestSpoolDisposition(spool, screening, config.highlightYears),
    [spool, screening, config.highlightYears],
  );
  const [draft, setDraft] = useState<FfsSpoolDisposition>(() => (
    disposition ?? { ...emptySpoolDisposition(spool), optionId: suggestion.optionId }
  ));
  const [view, setView] = useState<'unrolled' | 'projection'>('unrolled');
  const [focused, setFocused] = useState<FfsScreenedResult | null>(null);

  // A different spool means a different decision; carrying the previous draft
  // across would silently propose one joint's answer for another's.
  useEffect(() => {
    setDraft(disposition ?? { ...emptySpoolDisposition(spool), optionId: suggestion.optionId });
    setFocused(null);
  }, [spool, disposition, suggestion.optionId]);

  const selectedMembers = new Set(draft.memberIndexes);
  const option = repairOptionById(draft.optionId);
  const dateInvalid = Boolean(draft.targetDateIso && !isIsoCalendarDate(draft.targetDateIso));
  const life = spool.governingLife?.nominal.remnantLife ?? null;

  const toggleMember = (index: number) => {
    setDraft((current) => {
      const next = new Set(current.memberIndexes);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return { ...current, memberIndexes: [...next].sort((a, b) => a - b) };
    });
  };

  const applyPlanToFeatures = () => {
    if (!onApplyToFeatures || !option) return;
    const note = [option.label, draft.justification?.trim()].filter(Boolean).join(' — ');
    onApplyToFeatures(draft.memberIndexes, (item) => ({
      // The completed-repair fields are passed through untouched: this records
      // an intention, and an intention is not evidence of work done.
      repairStatus: item.nominal.repairStatus,
      repairMethod: item.nominal.repairMethod,
      repairDate: item.nominal.repairDate,
      repairReference: item.nominal.repairReference,
      recommendation: note || null,
      actionOwner: draft.owner?.trim() || item.nominal.actionOwner,
    }));
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Spool review ${spool.label}`}
      className="fixed inset-0 z-[100000] flex items-start justify-center overflow-y-auto bg-slate-900/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="my-4 w-full max-w-6xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 dark:border-slate-700">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Spool case review
            </p>
            <h3 className="mt-1 text-lg font-bold text-slate-900 dark:text-slate-50">{spool.label}</h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {spool.section} · {extentLabel(spool)}
              {spool.lengthM !== null && ` · ${spool.lengthM.toFixed(2)} m joint`} ·{' '}
              {spool.featureCount.toLocaleString()} feature{spool.featureCount === 1 ? '' : 's'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`inline-flex rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-wide ${SEVERITY_STYLE[spool.severity]}`}>
              {SEVERITY_LABEL[spool.severity]}
            </span>
            <button
              type="button"
              aria-label="Close spool review"
              onClick={onClose}
              className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-200"
            >
              <FiX aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="max-h-[78vh] overflow-y-auto px-5 py-4">
          {/* Headline numbers for the joint */}
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
            <Stat label="Governing ERF" value={formatErf(spool.worstNominalErf)} tone={spool.worstNominalErf >= 1 ? 'bad' : 'accent'} />
            <Stat
              label="With ILI tolerance"
              value={formatErf(spool.worstConservativeErf)}
              tone={spool.worstConservativeErf >= 1 ? 'bad' : 'default'}
            />
            <Stat label="Deepest feature" value={`${spool.maxDepthPct.toFixed(1)} %WT`} tone={spool.maxDepthPct >= screening.depthRejectionPct ? 'bad' : 'default'} />
            <Stat
              label="Shortest remnant life"
              value={life ? formatRemnantLife(life) : 'Not established'}
              foot={life ? remnantLimitLabel(life) : 'No limit reached in the horizon'}
              tone="warn"
            />
            <Stat
              label="Mean depth growth"
              value={spool.growth.meanMmPerYear === null ? '—' : `${rate(spool.growth.meanMmPerYear)} mm/y`}
              foot={`${spool.growth.measuredCount} observed · ${spool.growth.assumedCount} assumed · ${spool.growth.unavailableCount} none`}
            />
            <Stat
              label="Not acceptable"
              value={`${spool.unacceptableCount} of ${spool.featureCount}`}
              tone={spool.unacceptableCount > 0 ? 'bad' : 'good'}
            />
          </div>

          {/* Why the spool scores the way it does */}
          <section className="mt-5">
            <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Basis of the spool result
            </h4>
            <ul className="space-y-1.5 rounded-xl border border-slate-200 bg-slate-50/70 p-4 text-xs leading-relaxed text-slate-700 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300">
              {spool.drivers.map((driver) => (
                <li key={driver} className="flex gap-2">
                  <span aria-hidden="true" className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-slate-400" />
                  <span>{driver}</span>
                </li>
              ))}
            </ul>
          </section>

          <div className="mt-5 grid gap-4 xl:grid-cols-2">
            <section>
              <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Governing feature calculation
              </h4>
              {spool.governingErf
                ? <GoverningCalculation item={spool.governingErf} />
                : <Callout>No feature in this spool produced a usable ERF.</Callout>}
            </section>

            <section>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Spool geometry
                </h4>
                <div role="tablist" aria-label="Spool view" className="ds-segmented w-max">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={view === 'unrolled'}
                    className={`ds-segmented__option${view === 'unrolled' ? ' is-active' : ''}`}
                    onClick={() => setView('unrolled')}
                  >
                    <FiGrid aria-hidden="true" /> 2D unrolled
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={view === 'projection'}
                    className={`ds-segmented__option${view === 'projection' ? ' is-active' : ''}`}
                    onClick={() => setView('projection')}
                  >
                    <FiBox aria-hidden="true" /> 3D pipe
                  </button>
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                {view === 'unrolled' ? (
                  <FfsSpoolUnrolledView
                    spool={spool}
                    selectedIndex={focused?.index ?? null}
                    markedIndexes={selectedMembers}
                    onSelect={setFocused}
                  />
                ) : (
                  <FfsSpoolProjectionView
                    spool={spool}
                    selectedIndex={focused?.index ?? null}
                    markedIndexes={selectedMembers}
                    onSelect={setFocused}
                  />
                )}
                {focused && (
                  <p className="mt-2 text-[11px] text-slate-600 dark:text-slate-300">
                    <strong className="font-mono">{focused.nominal.featureId ?? `LD ${numericLd(focused).toFixed(2)} m`}</strong>
                    {' · '}{focused.nominal.maxDepthPct.toFixed(1)} %WT
                    {' · '}{focused.nominal.length.toFixed(0)} × {focused.nominal.width.toFixed(0)} mm
                    {' · '}{focused.nominal.orient || 'no clock'}
                    {' · ERF '}{formatErf(focused.nominal.ERF)}
                  </p>
                )}
              </div>
            </section>
          </div>

          {/* Member register: which features the decision covers */}
          <section className="mt-5">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Metal loss in this spool
              </h4>
              <div className="flex items-center gap-2 text-[11px]">
                <button
                  type="button"
                  onClick={() => setDraft((current) => ({ ...current, memberIndexes: spool.members.map((m) => m.index) }))}
                  className="font-semibold text-slate-600 underline-offset-2 hover:underline dark:text-slate-300"
                >
                  Select all
                </button>
                <button
                  type="button"
                  onClick={() => setDraft((current) => ({ ...current, memberIndexes: [] }))}
                  className="font-semibold text-slate-600 underline-offset-2 hover:underline dark:text-slate-300"
                >
                  Select none
                </button>
                <span className="text-slate-500 dark:text-slate-400">
                  {draft.memberIndexes.length} of {spool.featureCount} selected
                </span>
              </div>
            </div>
            <div className="max-h-[320px] overflow-auto rounded-lg border border-slate-200 dark:border-slate-700">
              <table className="min-w-[980px] w-full text-left text-xs">
                <thead className="sticky top-0 bg-slate-50 dark:bg-slate-900/95">
                  <tr className="text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    <th className="px-3 py-2">Repair?</th>
                    <th className="px-3 py-2">Feature</th>
                    <th className="px-3 py-2 text-right">LD [m]</th>
                    <th className="px-3 py-2">Clock</th>
                    <th className="px-3 py-2 text-right">Depth [%WT]</th>
                    <th className="px-3 py-2 text-right">L × W [mm]</th>
                    <th className="px-3 py-2 text-right">ERF</th>
                    <th className="px-3 py-2 text-right">Cons. ERF</th>
                    <th className="px-3 py-2 text-right">CR depth [mm/y]</th>
                    <th className="px-3 py-2">Remnant life</th>
                    <th className="px-3 py-2">Repair evidence</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700/70">
                  {spool.members.slice(0, MEMBERS_SHOWN).map((member) => {
                    const n = member.nominal;
                    const checked = selectedMembers.has(member.index);
                    return (
                      <tr
                        key={member.key}
                        className={`text-slate-700 dark:text-slate-300 ${focused?.index === member.index ? 'bg-indigo-50/60 dark:bg-indigo-950/30' : ''}`}
                      >
                        <td className="px-3 py-1.5">
                          <button
                            type="button"
                            onClick={() => toggleMember(member.index)}
                            aria-pressed={checked}
                            aria-label={`${checked ? 'Exclude' : 'Include'} ${n.featureId ?? `row ${member.index + 1}`} in the spool disposition`}
                            className="text-slate-500 hover:text-indigo-600 dark:text-slate-400"
                          >
                            {checked ? <FiCheckSquare aria-hidden="true" /> : <FiSquare aria-hidden="true" />}
                          </button>
                        </td>
                        <td className="px-3 py-1.5 font-mono text-[11px] font-semibold text-slate-900 dark:text-slate-100">
                          <button type="button" onClick={() => { setFocused(member); onSelectFeature?.(member); }} className="hover:text-indigo-600 dark:hover:text-indigo-400">
                            {n.featureId ?? `Row ${member.index + 1}`}
                          </button>
                          {n.isClusteredMetalLoss && (
                            <span className="ml-1.5 font-sans text-[9px] font-bold uppercase tracking-wide text-amber-600 dark:text-amber-400">cluster</span>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono tabular-nums">{numericLd(member).toFixed(2)}</td>
                        <td className="px-3 py-1.5">{n.orient || '—'}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{n.maxDepthPct.toFixed(1)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{n.length.toFixed(0)} × {n.width.toFixed(0)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{formatErf(n.ERF)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{formatErf(member.conservative.ERF)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{n.crDepth.toFixed(3)}</td>
                        <td className="px-3 py-1.5">{formatRemnantLife(n.remnantLife)}</td>
                        <td className="px-3 py-1.5">
                          {onRecordFeature ? (
                            <button
                              type="button"
                              onClick={() => onRecordFeature(member)}
                              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[10px] font-semibold text-slate-600 transition-colors hover:border-indigo-300 hover:text-indigo-600 dark:border-slate-700 dark:text-slate-300"
                            >
                              <FiTool aria-hidden="true" />
                              {n.repairStatus === 'unrepaired' ? 'Record' : n.repairStatus === 'temporary-repair' ? 'Temporary' : 'Permanent'}
                            </button>
                          ) : (
                            n.repairStatus
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {spool.featureCount > MEMBERS_SHOWN && (
              <p className="mt-1.5 text-[11px] text-amber-600 dark:text-amber-400">
                Showing the first {MEMBERS_SHOWN} of {spool.featureCount.toLocaleString()} features. The Excel export
                carries all of them.
              </p>
            )}
          </section>

          {/* The decision itself */}
          <section className="mt-5 rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-700 dark:bg-slate-900/40">
            <h4 className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Engineering disposition for this spool
            </h4>
            <p className="mb-3 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
              Suggested: <strong className="text-slate-700 dark:text-slate-200">{repairOptionById(suggestion.optionId)?.label}</strong>{' '}
              — {suggestion.reason} This is a starting point from the screening thresholds, not a decision.
            </p>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Decision">
                <select
                  value={draft.decision}
                  onChange={(event) => setDraft((current) => ({ ...current, decision: event.target.value as FfsSpoolDecision }))}
                  className={FIELD_CLASS}
                >
                  {(Object.keys(DECISION_LABEL) as FfsSpoolDecision[]).map((value) => (
                    <option key={value} value={value}>{DECISION_LABEL[value]}</option>
                  ))}
                </select>
              </Field>
              <div className="sm:col-span-2">
                <Field label="Method">
                  <select
                    value={draft.optionId ?? ''}
                    onChange={(event) => setDraft((current) => ({ ...current, optionId: event.target.value || null }))}
                    className={FIELD_CLASS}
                  >
                    <option value="">Not selected</option>
                    <optgroup label="Permanent repair">
                      {FFS_REPAIR_OPTIONS.filter((item) => item.repairClass === 'permanent').map((item) => (
                        <option key={item.id} value={item.id}>{item.label}</option>
                      ))}
                    </optgroup>
                    <optgroup label="Temporary repair or mitigation">
                      {FFS_REPAIR_OPTIONS.filter((item) => item.repairClass === 'temporary').map((item) => (
                        <option key={item.id} value={item.id}>{item.label}</option>
                      ))}
                    </optgroup>
                    <optgroup label="No intervention">
                      {FFS_REPAIR_OPTIONS.filter((item) => item.repairClass === 'monitor').map((item) => (
                        <option key={item.id} value={item.id}>{item.label}</option>
                      ))}
                    </optgroup>
                  </select>
                </Field>
              </div>
              <Field label="Target date">
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="YYYY-MM-DD"
                  value={draft.targetDateIso ?? ''}
                  onChange={(event) => setDraft((current) => ({ ...current, targetDateIso: event.target.value || null }))}
                  className={FIELD_CLASS}
                />
              </Field>
              <Field label="Owner">
                <input
                  type="text"
                  placeholder="Responsible discipline or person"
                  value={draft.owner ?? ''}
                  onChange={(event) => setDraft((current) => ({ ...current, owner: event.target.value || null }))}
                  className={FIELD_CLASS}
                />
              </Field>
              <div className="sm:col-span-2 lg:col-span-3">
                <Field label="Engineering justification">
                  <textarea
                    rows={2}
                    value={draft.justification ?? ''}
                    onChange={(event) => setDraft((current) => ({ ...current, justification: event.target.value || null }))}
                    placeholder="Why this method, on this spool, at this date."
                    className={`${FIELD_CLASS} resize-y`}
                  />
                </Field>
              </div>
            </div>

            {option && (
              <p className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] leading-relaxed text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                <strong>{option.label}</strong> · {option.repairClass === 'permanent' ? 'Permanent repair' : option.repairClass === 'temporary' ? 'Temporary / mitigation' : 'No intervention'} — {option.note}
              </p>
            )}

            {dateInvalid && (
              <div className="mt-3">
                <Callout tone="danger">Target date must be a real calendar date in YYYY-MM-DD format.</Callout>
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="max-w-2xl text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                Applying the plan writes the method and owner onto the selected features' recommendation fields.
                It never marks them repaired — capacity credit still requires completed evidence recorded in the
                repair disposition register.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {disposition && (
                  <SynButton type="button" variant="outline" size="sm" onClick={() => onClearDisposition(spool.id)}>
                    Clear decision
                  </SynButton>
                )}
                {onApplyToFeatures && (
                  <SynButton
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!option || draft.memberIndexes.length === 0}
                    onClick={applyPlanToFeatures}
                  >
                    Apply plan to {draft.memberIndexes.length} feature{draft.memberIndexes.length === 1 ? '' : 's'}
                  </SynButton>
                )}
                <SynButton
                  type="button"
                  variant="lime"
                  size="sm"
                  disabled={dateInvalid}
                  onClick={() => onSaveDisposition(spool.id, draft)}
                >
                  Save spool decision
                </SynButton>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export default function FfsSpoolReviewPanel({
  items,
  config,
  screening,
  reportContext,
  dispositions,
  onSaveDisposition,
  onClearDisposition,
  onApplyToFeatures,
  onRecordFeature,
  onSelectFeature,
}: {
  items: FfsScreenedResult[];
  config: FfsConfig;
  screening: FfsScreeningConfig;
  reportContext: FfsReportContext;
  dispositions: Record<string, FfsSpoolDisposition>;
  onSaveDisposition: (spoolId: string, disposition: FfsSpoolDisposition) => void;
  onClearDisposition: (spoolId: string) => void;
  onApplyToFeatures?: (indexes: number[], patch: (item: FfsScreenedResult) => FfsRepairDispositionPatch) => void;
  onRecordFeature?: (item: FfsScreenedResult) => void;
  onSelectFeature?: (item: FfsScreenedResult) => void;
}) {
  const [openSpoolId, setOpenSpoolId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [onlyUndecided, setOnlyUndecided] = useState(false);

  const spools = useMemo(() => buildFfsSpools(items, { screening, config }), [items, screening, config]);
  const programme = useMemo(() => buildSpoolProgramme(spools, dispositions), [spools, dispositions]);
  const visible = useMemo(
    () => (onlyUndecided ? spools.filter((spool) => !dispositions[spool.id]) : spools),
    [spools, dispositions, onlyUndecided],
  );
  const pageCount = Math.max(1, Math.ceil(visible.length / SPOOLS_PER_PAGE));
  const currentPage = Math.min(page, pageCount - 1);
  const rows = visible.slice(currentPage * SPOOLS_PER_PAGE, (currentPage + 1) * SPOOLS_PER_PAGE);
  const openSpool = spools.find((spool) => spool.id === openSpoolId) ?? null;

  const unassigned = spools.filter((spool) => spool.grouping === 'unassigned').length;

  return (
    <Panel padded={false}>
      <div className="p-5 pb-3">
        <PanelHeader
          title="Spool review"
          subtitle="Every metal-loss feature grouped by the piece of pipe it sits on, with the ERF, remnant life and corrosion rate that govern that spool — and the one disposition taken for it."
          actions={(
            <SynButton
              type="button"
              variant="lime"
              size="sm"
              onClick={() => exportSpoolReviewWorkbook(spools, dispositions, config, screening, reportContext)}
            >
              <span className="inline-flex items-center gap-1.5">
                <FiDownload /> Export spool review
              </span>
            </SynButton>
          )}
        />
      </div>

      <div className="grid grid-cols-2 gap-2 px-5 pb-4 md:grid-cols-5">
        <Stat label="Spools" value={spools.length.toLocaleString()} />
        <Stat
          label="Not acceptable"
          value={spools.filter((spool) => spool.severity === 'fail').length.toLocaleString()}
          tone={spools.some((spool) => spool.severity === 'fail') ? 'bad' : 'good'}
        />
        <Stat label="In review band" value={spools.filter((spool) => spool.severity === 'review').length.toLocaleString()} tone="warn" />
        <Stat label="Decision recorded" value={programme.decided.toLocaleString()} tone={programme.decided > 0 ? 'good' : 'default'} />
        <Stat label="Repair planned" value={programme.repairCount.toLocaleString()} tone={programme.repairCount > 0 ? 'warn' : 'default'} />
      </div>

      {unassigned > 0 && (
        <div className="px-5 pb-3">
          <Callout tone="warn">
            {unassigned} group{unassigned === 1 ? '' : 's'} could not be resolved to a spool: the run reported neither a
            joint number nor a distance to the upstream girth weld for those features, so they are grouped by section.
            Re-run the alignment import with the joint columns present to review them as real pipe.
          </Callout>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-5 py-2 text-[11px] text-slate-500 dark:border-slate-700 dark:text-slate-400">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={onlyUndecided}
            onChange={(event) => { setOnlyUndecided(event.target.checked); setPage(0); }}
          />
          Only spools with no decision yet
        </label>
        <span>Sorted worst first — severity, then ERF with tolerance applied.</span>
      </div>

      <div className="overflow-x-auto border-t border-slate-200 dark:border-slate-700">
        <table className="min-w-[1180px] w-full text-left text-xs">
          <thead className="bg-slate-50 dark:bg-slate-900/55">
            <tr className="text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              <th className="px-4 py-2.5">Spool</th>
              <th className="px-3 py-2.5">Section</th>
              <th className="px-3 py-2.5">Extent</th>
              <th className="px-3 py-2.5 text-right">Features</th>
              <th className="px-3 py-2.5 text-right">Max depth [%WT]</th>
              <th className="px-3 py-2.5 text-right">ERF</th>
              <th className="px-3 py-2.5 text-right">Cons. ERF</th>
              <th className="px-3 py-2.5">Remnant life</th>
              <th className="px-3 py-2.5 text-right">Mean CR [mm/y]</th>
              <th className="px-3 py-2.5">Result</th>
              <th className="px-4 py-2.5">Disposition</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700/70">
            {rows.map((spool) => {
              const disposition = dispositions[spool.id];
              const life = spool.governingLife?.nominal.remnantLife ?? null;
              return (
                <tr
                  key={spool.id}
                  className="cursor-pointer text-slate-700 transition-colors hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800/60"
                  onClick={() => setOpenSpoolId(spool.id)}
                >
                  <td className="px-4 py-2 font-semibold text-slate-900 dark:text-slate-100">
                    {spool.label}
                    {spool.clusterCount > 0 && (
                      <span className="ml-1.5 text-[9px] font-bold uppercase tracking-wide text-amber-600 dark:text-amber-400">
                        {spool.clusterCount} cluster
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">{spool.section}</td>
                  <td className="px-3 py-2 font-mono text-[11px] tabular-nums">{extentLabel(spool)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{spool.featureCount}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{spool.maxDepthPct.toFixed(1)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatErf(spool.worstNominalErf)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatErf(spool.worstConservativeErf)}</td>
                  <td className="px-3 py-2">{life ? formatRemnantLife(life) : 'Not established'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{rate(spool.growth.meanMmPerYear)}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${SEVERITY_STYLE[spool.severity]}`}>
                      {SEVERITY_LABEL[spool.severity]}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    {disposition ? (
                      <span className="font-semibold text-slate-800 dark:text-slate-200">
                        {DECISION_LABEL[disposition.decision]}
                        {disposition.optionId && ` · ${repairOptionById(disposition.optionId)?.label}`}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-slate-500 dark:text-slate-400">
                        <FiActivity aria-hidden="true" /> Not decided
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {pageCount > 1 && (
        <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-5 py-3 text-[11px] text-slate-500 dark:border-slate-700 dark:text-slate-400">
          <span>
            Spools {(currentPage * SPOOLS_PER_PAGE + 1).toLocaleString()}–
            {Math.min((currentPage + 1) * SPOOLS_PER_PAGE, visible.length).toLocaleString()} of {visible.length.toLocaleString()}
          </span>
          <div className="flex items-center gap-2">
            <SynButton type="button" variant="outline" size="sm" disabled={currentPage === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>
              Previous
            </SynButton>
            <span className="tabular-nums">Page {currentPage + 1} / {pageCount}</span>
            <SynButton type="button" variant="outline" size="sm" disabled={currentPage >= pageCount - 1} onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))}>
              Next
            </SynButton>
          </div>
        </div>
      )}

      {openSpool && (
        <SpoolCard
          spool={openSpool}
          screening={screening}
          config={config}
          disposition={dispositions[openSpool.id] ?? null}
          onSaveDisposition={onSaveDisposition}
          onClearDisposition={(spoolId) => { onClearDisposition(spoolId); }}
          onApplyToFeatures={onApplyToFeatures}
          onRecordFeature={onRecordFeature}
          onSelectFeature={onSelectFeature}
          onClose={() => setOpenSpoolId(null)}
        />
      )}
    </Panel>
  );
}
