/**
 * Case review by spool — the pipe between two girth welds.
 *
 * The rest of the FFS workspace reviews features. This reviews pipe, because a
 * repair is made to a piece of pipe: the governing ERF, the shortest remnant
 * life, the mean corrosion rate and the total metal loss all belong to the
 * joint, and no single feature row can show them.
 *
 * The register itself carries every number a reviewer needs, laid out like the
 * results table. The card is not where the data lives — it is where the
 * decision is taken, and it asks one question in two forms: what should be done
 * to this spool, or what has already been done to it.
 *
 * Nothing here recalculates B31G. Every figure is the governing member's own,
 * and that member is named beside it.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  FiCheckSquare,
  FiChevronDown,
  FiChevronUp,
  FiDownload,
  FiSearch,
  FiSquare,
  FiTool,
  FiX,
} from 'react-icons/fi';
import { MathInline } from '../ds';
import { formatRemnantLife, remnantLimitLabel } from '../../lib/ffs/lifeProjection';
import {
  buildFfsSpools,
  buildSpoolProgramme,
  emptySpoolDisposition,
  FFS_REPAIR_OPTIONS,
  repairOptionById,
  suggestSpoolDisposition,
  type FfsSpool,
  type FfsSpoolDisposition,
  type FfsSpoolDispositionMode,
} from '../../lib/ffs/spoolReview';
import { exportSpoolReviewWorkbook } from '../../lib/ffs/spoolExports';
import type { FfsGirthWeld, FfsSpoolCensusRow } from '../../lib/ffs/alignmentImport';
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
import { resolvedDepthRate, resolvedLengthRate } from '../../lib/ffs/growthResolution.ts';
import FfsSpoolGeometryPanes from './FfsSpoolGeometry';

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

const FIELD_CLASS =
  'w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200';

const PAGE_SIZE = 100;
const MEMBERS_SHOWN = 250;

type SortKey =
  | 'position'
  | 'features'
  | 'totalLength'
  | 'depth'
  | 'erf'
  | 'conservativeErf'
  | 'life'
  | 'growth'
  | 'severity'
  | 'disposition';

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

function severityRank(severity: FfsSeverity): number {
  return severity === 'fail' ? 2 : severity === 'review' ? 1 : 0;
}

function spoolStartM(spool: FfsSpool): number {
  return spool.usGwLdM ?? spool.firstFeatureLdM;
}

function extentLabel(spool: FfsSpool): string {
  const start = spool.usGwLdM ?? spool.firstFeatureLdM;
  const end = spool.dsGwLdM ?? spool.lastFeatureLdM;
  return `${metres(start)} – ${metres(end)}`;
}

/** What the spool card has recorded, in the words the register prints. */
function dispositionLabel(disposition: FfsSpoolDisposition): string {
  const method = repairOptionById(disposition.optionId)?.label ?? 'method not selected';
  return disposition.mode === 'repaired' ? `Repaired · ${method}` : `Recommended · ${method}`;
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
 * The B31G working of the feature that governs the spool: the reader can follow
 * the reported geometry through the Folias factor to the safe pressure and the
 * ratio, which is the answer to "why is this spool's result what it is".
 */
function GoverningCalculation({ item }: { item: FfsScreenedResult }) {
  const n = item.nominal;
  // The rate the projection consumed, never the source column.
  const lengthRate = resolvedLengthRate(n);
  // Each row is a name, the symbol for the quantity, and the value. The symbol
  // used to be spliced into the label — `Length term z = L²/(D·t)` — which put
  // an equation in a table header cell set in the reading face, with a middle
  // dot for multiplication and a superscript two that the data face renders at
  // a different weight from the rest of the row.
  const rows: Array<[string, string | null, string]> = [
    ['Method', null, `${n.method === 'original' ? 'Original' : 'Modified'} B31G · branch ${n.branch}`],
    ['Reported depth', 'd', `${n.d.toFixed(3)} mm of ${n.wall.toFixed(2)} mm wall (${n.maxDepthPct.toFixed(1)} %WT)`],
    ['Depth ratio', '\\frac{d}{t}', n.dt.toFixed(4)],
    ['Length term', 'z = \\frac{L^{2}}{D\\,t}', n.z.toFixed(4)],
    ['Folias factor', 'M', n.M === null ? 'not used on this branch' : n.M.toFixed(4)],
    ['Flow stress', '\\Sflow', `${n.sflow.toFixed(2)} MPa (SMYS ${n.smys.toFixed(0)} MPa)`],
    ['Failure stress', '\\Sfail', `${n.Sf.toFixed(2)} MPa`],
    ['Failure pressure', '\\Pfail', `${n.Pf.toFixed(3)} MPa`],
    ['Safety factor', '\\SFac', `${n.SF.toFixed(3)} (${n.safetyFactorSource === 'explicit' ? 'supplied' : `derived from design factor ${n.df.toFixed(2)}`})`],
    ['Safe pressure', '\\Psafe = \\frac{\\Pfail}{\\SFac}', `${n.safePressure.toFixed(3)} MPa`],
    ['Required pressure', '\\Pop', `${n.p0.toFixed(3)} MPa`],
    ['Estimated repair factor', '\\ERF = \\frac{\\Pop}{\\Psafe}', `${formatErf(n.ERF)} → ${n.acceptance}`],
    ['Depth growth used', '\\CRd', `${resolvedDepthRate(n).toFixed(4)} mm/y`],
    ['Length growth used', '\\CRl', lengthRate !== null ? `${lengthRate.toFixed(4)} mm/y` : 'none established — length held constant'],
  ];
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
      <table className="w-full text-left text-xs">
        <tbody className="divide-y divide-slate-100 dark:divide-slate-700/70">
          {rows.map(([label, tex, value]) => (
            <tr key={label} className="text-slate-700 dark:text-slate-300">
              <td className="w-[46%] px-3 py-1.5 font-medium text-slate-500 dark:text-slate-400">
                {label}
                {tex && (
                  <span className="ml-1.5 text-slate-800 dark:text-slate-200">
                    <MathInline tex={tex} scale="sm" />
                  </span>
                )}
              </td>
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
  onSave: (spoolId: string, disposition: FfsSpoolDisposition) => void;
  onClear: (spoolId: string) => void;
  onApplyToFeatures?: (
    indexes: number[],
    patch: (item: FfsScreenedResult) => FfsRepairDispositionPatch,
  ) => void;
  onOpenFeature?: (item: FfsScreenedResult) => void;
  onClose: () => void;
}

function SpoolCard({
  spool,
  screening,
  config,
  disposition,
  onSave,
  onClear,
  onApplyToFeatures,
  onOpenFeature,
  onClose,
}: SpoolCardProps) {
  const suggestion = useMemo(
    () => suggestSpoolDisposition(spool, screening, config.highlightYears),
    [spool, screening, config.highlightYears],
  );
  const [draft, setDraft] = useState<FfsSpoolDisposition>(() => (
    disposition ?? { ...emptySpoolDisposition(spool), optionId: suggestion.optionId }
  ));
  const [focused, setFocused] = useState<FfsScreenedResult | null>(null);

  // A different spool means a different decision; carrying the previous draft
  // across would silently propose one joint's answer for another's.
  useEffect(() => {
    setDraft(disposition ?? { ...emptySpoolDisposition(spool), optionId: suggestion.optionId });
    setFocused(null);
  }, [spool, disposition, suggestion.optionId]);

  const selectedMembers = new Set(draft.memberIndexes);
  const option = repairOptionById(draft.optionId);
  const life = spool.governingLife?.nominal.remnantLife ?? null;

  const isRepaired = draft.mode === 'repaired';
  const dateInvalid = Boolean(draft.completedDateIso && !isIsoCalendarDate(draft.completedDateIso));
  const dateFuture = Boolean(
    draft.completedDateIso && isIsoCalendarDate(draft.completedDateIso)
    && draft.completedDateIso > new Date().toISOString().slice(0, 10),
  );
  const evidenceMissing = isRepaired && (
    !option || !draft.completedDateIso?.trim() || !draft.evidenceReference?.trim()
  );
  // A spool whose metal loss the review never released still deserves a
  // recorded decision — it just has no feature rows to write it onto.
  const blocked = !option
    || (spool.assessedCount > 0 && draft.memberIndexes.length === 0)
    || (isRepaired && (evidenceMissing || dateInvalid || dateFuture));

  const toggleMember = (index: number) => {
    setDraft((current) => {
      const next = new Set(current.memberIndexes);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return { ...current, memberIndexes: [...next].sort((a, b) => a - b) };
    });
  };

  /**
   * One button records the spool decision and writes it onto the features it
   * covers, because they are the same act. A recommendation touches only the
   * recommendation and owner fields; recording completed work is the only thing
   * that writes a repair status, and it cannot be saved without its evidence.
   */
  const save = () => {
    if (!option) return;
    onSave(spool.id, draft);
    onApplyToFeatures?.(draft.memberIndexes, (item) => (
      isRepaired
        ? {
          repairStatus: draft.repairKind,
          repairMethod: option.label,
          repairDate: draft.completedDateIso,
          repairReference: draft.evidenceReference,
          recommendation: draft.justification?.trim() || item.nominal.recommendation,
          actionOwner: draft.owner?.trim() || item.nominal.actionOwner,
        }
        : {
          // Untouched on purpose: a recommendation is not evidence that any
          // work happened, and marking it repaired would drop the feature out
          // of the as-managed population before anyone has been to site.
          repairStatus: item.nominal.repairStatus,
          repairMethod: item.nominal.repairMethod,
          repairDate: item.nominal.repairDate,
          repairReference: item.nominal.repairReference,
          recommendation: [option.label, draft.justification?.trim()].filter(Boolean).join(' — '),
          actionOwner: draft.owner?.trim() || item.nominal.actionOwner,
        }
    ));
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Spool disposition ${spool.label}`}
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
              Spool disposition
            </p>
            <h3 className="mt-1 text-lg font-bold text-slate-900 dark:text-slate-50">{spool.label}</h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {spool.section} · {extentLabel(spool)} m
              {spool.lengthM !== null && ` · ${spool.lengthM.toFixed(2)} m joint`} ·{' '}
              {spool.metalLossTotal.toLocaleString()} metal-loss record{spool.metalLossTotal === 1 ? '' : 's'}
              {spool.unassessedCount > 0 && ` (${spool.assessedCount} assessed)`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`inline-flex rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-wide ${SEVERITY_STYLE[spool.severity]}`}>
              {SEVERITY_LABEL[spool.severity]}
            </span>
            <button
              type="button"
              aria-label="Close spool disposition"
              onClick={onClose}
              className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-200"
            >
              <FiX aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="max-h-[78vh] overflow-y-auto px-5 py-4">
          {/* The decision comes first: the register behind this card already
              carried the numbers, and this is what the card is opened for. */}
          <section className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-700 dark:bg-slate-900/40">
            <div role="tablist" aria-label="Disposition kind" className="ds-segmented w-max">
              {([
                ['recommendation', 'Recommend an action'],
                ['repaired', 'Record work already done'],
              ] as Array<[FfsSpoolDispositionMode, string]>).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={draft.mode === value}
                  className={`ds-segmented__option${draft.mode === value ? ' is-active' : ''}`}
                  onClick={() => setDraft((current) => ({ ...current, mode: value }))}
                >
                  {label}
                </button>
              ))}
            </div>

            <p className="mt-3 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
              {draft.mode === 'recommendation' ? (
                <>
                  Suggested: <strong className="text-slate-700 dark:text-slate-200">{repairOptionById(suggestion.optionId)?.label}</strong>
                  {' '}— {suggestion.reason} A recommendation carries no date and does not change the assessed population.
                </>
              ) : (
                'Recording completed work changes the assessed population, so it needs the method, the completion date and an evidence reference. Only a verified permanent repair earns capacity credit.'
              )}
            </p>

            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className={isRepaired ? 'sm:col-span-2' : 'sm:col-span-2 lg:col-span-3'}>
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
                    {draft.mode === 'recommendation' && (
                      <optgroup label="No intervention">
                        {FFS_REPAIR_OPTIONS.filter((item) => item.repairClass === 'monitor').map((item) => (
                          <option key={item.id} value={item.id}>{item.label}</option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                </Field>
              </div>

              {isRepaired && (
                <>
                  <Field label="Repair kind">
                    <select
                      value={draft.repairKind}
                      onChange={(event) => setDraft((current) => ({
                        ...current,
                        repairKind: event.target.value as FfsSpoolDisposition['repairKind'],
                      }))}
                      className={FIELD_CLASS}
                    >
                      <option value="permanent-repair-verified">Permanent, verified</option>
                      <option value="temporary-repair">Temporary</option>
                    </select>
                  </Field>
                  <Field label="Completion date">
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="YYYY-MM-DD"
                      value={draft.completedDateIso ?? ''}
                      onChange={(event) => setDraft((current) => ({ ...current, completedDateIso: event.target.value || null }))}
                      className={FIELD_CLASS}
                    />
                  </Field>
                  <Field label="Evidence reference">
                    <input
                      type="text"
                      placeholder="Work order, dossier, certificate"
                      value={draft.evidenceReference ?? ''}
                      onChange={(event) => setDraft((current) => ({ ...current, evidenceReference: event.target.value || null }))}
                      className={FIELD_CLASS}
                    />
                  </Field>
                </>
              )}

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
                <Field label={isRepaired ? 'Notes' : 'Engineering justification'}>
                  <textarea
                    rows={2}
                    value={draft.justification ?? ''}
                    onChange={(event) => setDraft((current) => ({ ...current, justification: event.target.value || null }))}
                    placeholder={isRepaired ? 'Anything the dossier does not already say.' : 'Why this method, on this spool.'}
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

            {isRepaired && (dateInvalid || dateFuture || evidenceMissing) && (
              <div className="mt-3">
                <Callout tone="danger">
                  {dateInvalid
                    ? 'Completion date must be a real calendar date in YYYY-MM-DD format.'
                    : dateFuture
                      ? 'A completed repair cannot carry a future completion date.'
                      : 'Method, completion date and evidence reference are all required before work can be recorded as done.'}
                </Callout>
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Applies to <strong className="text-slate-700 dark:text-slate-200">{draft.memberIndexes.length}</strong> of{' '}
                {spool.featureCount} features — tick them in the table below.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {disposition && (
                  <SynButton type="button" variant="outline" size="sm" onClick={() => { onClear(spool.id); onClose(); }}>
                    Clear this record
                  </SynButton>
                )}
                <SynButton type="button" variant="outline" size="sm" onClick={onClose}>
                  Cancel
                </SynButton>
                <SynButton type="button" variant="lime" size="sm" disabled={blocked} onClick={save}>
                  {isRepaired ? 'Record as repaired' : 'Save recommendation'}
                </SynButton>
              </div>
            </div>
          </section>

          {/* Headline numbers for the joint */}
          <div className="mt-5 grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
            <Stat
              label="Metal loss on spool"
              value={spool.metalLossTotal.toLocaleString()}
              foot={`${spool.totalMetalLossLengthMm.toFixed(0)} mm total axial length`
                + (spool.unassessedCount > 0 ? ` · ${spool.unassessedCount} not released` : '')}
            />
            <Stat label="Governing ERF" value={formatErf(spool.worstNominalErf)} tone={spool.worstNominalErf >= 1 ? 'bad' : 'accent'} />
            <Stat
              label="With ILI tolerance"
              value={formatErf(spool.worstConservativeErf)}
              tone={spool.worstConservativeErf >= 1 ? 'bad' : 'default'}
            />
            <Stat
              label="Deepest feature"
              value={`${spool.maxDepthPct.toFixed(1)} %WT`}
              tone={spool.maxDepthPct >= screening.depthRejectionPct ? 'bad' : 'default'}
            />
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
          </div>

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

          <section className="mt-5">
            <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Spool geometry
            </h4>
            <FfsSpoolGeometryPanes
              spool={spool}
              selected={focused}
              markedIndexes={selectedMembers}
              onSelect={setFocused}
            />
          </section>

          <section className="mt-5">
            <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Governing feature calculation
            </h4>
            {spool.governingErf
              ? <GoverningCalculation item={spool.governingErf} />
              : <Callout>No feature in this spool produced a usable ERF.</Callout>}
          </section>

          {/* Which features the record covers */}
          <section className="mt-5">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Metal loss assessed on this spool
                {spool.unassessedCount > 0 && (
                  <span className="ml-2 font-normal normal-case tracking-normal text-amber-600 dark:text-amber-400">
                    {spool.unassessedCount} further record{spool.unassessedCount === 1 ? '' : 's'} were reported here but not released to the assessment
                  </span>
                )}
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
              </div>
            </div>
            <div className="max-h-[320px] overflow-auto rounded-lg border border-slate-200 dark:border-slate-700">
              <table className="min-w-[980px] w-full text-left text-xs">
                <thead className="sticky top-0 bg-slate-50 dark:bg-slate-900/95">
                  <tr className="text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    <th className="px-3 py-2">Include</th>
                    <th className="px-3 py-2">Feature</th>
                    <th className="px-3 py-2 text-right">LD [m]</th>
                    <th className="px-3 py-2">Clock</th>
                    <th className="px-3 py-2 text-right">Depth [%WT]</th>
                    <th className="px-3 py-2 text-right">L × W [mm]</th>
                    <th className="px-3 py-2 text-right">ERF</th>
                    <th className="px-3 py-2 text-right">Cons. ERF</th>
                    <th className="px-3 py-2 text-right">CR depth [mm/y]</th>
                    <th className="px-3 py-2">Remnant life</th>
                    <th className="px-3 py-2">Current record</th>
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
                            aria-label={`${checked ? 'Exclude' : 'Include'} ${n.featureId ?? `row ${member.index + 1}`} in this spool record`}
                            className="text-slate-500 hover:text-indigo-600 dark:text-slate-400"
                          >
                            {checked ? <FiCheckSquare aria-hidden="true" /> : <FiSquare aria-hidden="true" />}
                          </button>
                        </td>
                        <td className="px-3 py-1.5 font-mono text-[11px] font-semibold text-slate-900 dark:text-slate-100">
                          <button
                            type="button"
                            onClick={() => { setFocused(member); onOpenFeature?.(member); }}
                            className="hover:text-indigo-600 dark:hover:text-indigo-400"
                          >
                            {n.featureId ?? `Row ${member.index + 1}`}
                          </button>
                          {n.isClusteredMetalLoss && (
                            <span className="ml-1.5 font-sans text-[9px] font-bold uppercase tracking-wide text-amber-600 dark:text-amber-400">cluster</span>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono tabular-nums">{numericLd(member).toFixed(2)}</td>
                        <td className="px-3 py-1.5">{n.orient || '—'}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{n.maxDepthPct.toFixed(1)}</td>
                        {/* Width is optional: an unreported one reads as "—", not as a zero-width defect. */}
                        <td className="px-3 py-1.5 text-right tabular-nums">{n.length.toFixed(0)} × {n.width > 0 ? n.width.toFixed(0) : '—'}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{formatErf(n.ERF)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{formatErf(member.conservative.ERF)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{resolvedDepthRate(n).toFixed(3)}</td>
                        <td className="px-3 py-1.5">{formatRemnantLife(n.remnantLife)}</td>
                        <td className="px-3 py-1.5">
                          {n.repairStatus === 'permanent-repair-verified'
                            ? 'Repaired · permanent'
                            : n.repairStatus === 'temporary-repair'
                              ? 'Repaired · temporary'
                              : n.recommendation
                                ? `Recommended · ${n.recommendation}`
                                : '—'}
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
  girthWelds,
  census,
  dispositions,
  onSaveDisposition,
  onClearDisposition,
  onApplyToFeatures,
  onOpenFeature,
}: {
  items: FfsScreenedResult[];
  config: FfsConfig;
  screening: FfsScreeningConfig;
  reportContext: FfsReportContext;
  girthWelds?: readonly FfsGirthWeld[];
  census?: readonly FfsSpoolCensusRow[];
  dispositions: Record<string, FfsSpoolDisposition>;
  onSaveDisposition: (spoolId: string, disposition: FfsSpoolDisposition) => void;
  onClearDisposition: (spoolId: string) => void;
  onApplyToFeatures?: (
    indexes: number[],
    patch: (item: FfsScreenedResult) => FfsRepairDispositionPatch,
  ) => void;
  onOpenFeature?: (item: FfsScreenedResult) => void;
}) {
  const [openSpoolId, setOpenSpoolId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'undecided' | 'recommended' | 'repaired'>('all');
  // Off by default: the register is an inventory of the line, and hiding the
  // clean joints hides the fact that they were inspected and found clean.
  const [onlyWithMetalLoss, setOnlyWithMetalLoss] = useState(false);
  // Along the line by default. A per-weld register is walked, not ranked; one
  // click on any header re-sorts it by severity or ERF when that is the question.
  const [sortKey, setSortKey] = useState<SortKey>('position');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const spools = useMemo(
    () => buildFfsSpools(items, { screening, config, girthWelds, census }),
    [items, screening, config, girthWelds, census],
  );
  const programme = useMemo(() => buildSpoolProgramme(spools, dispositions), [spools, dispositions]);

  const visible = useMemo(() => {
    const sortValue = (spool: FfsSpool): number => {
      switch (sortKey) {
        case 'position': return spoolStartM(spool);
        case 'features': return spool.metalLossTotal;
        case 'totalLength': return spool.totalMetalLossLengthMm;
        case 'depth': return spool.maxDepthPct;
        case 'erf': return Number.isFinite(spool.worstNominalErf) ? spool.worstNominalErf : Number.MAX_VALUE;
        case 'conservativeErf': return Number.isFinite(spool.worstConservativeErf) ? spool.worstConservativeErf : Number.MAX_VALUE;
        // A spool with no established life sorts as the longest, not the
        // shortest: "unknown" is not "urgent".
        case 'life': return spool.governingLife?.nominal.remnantLife.years ?? Number.MAX_VALUE;
        case 'growth': return spool.growth.meanMmPerYear ?? -1;
        case 'disposition': {
          const disposition = dispositions[spool.id];
          return disposition ? (disposition.mode === 'repaired' ? 2 : 1) : 0;
        }
        default:
          return severityRank(spool.severity) * 1000
            + Math.min(999, (Number.isFinite(spool.worstConservativeErf) ? spool.worstConservativeErf : 9.99) * 100);
      }
    };
    const query = search.trim().toLowerCase();
    const direction = sortDir === 'asc' ? 1 : -1;
    return spools
      .filter((spool) => {
        if (query && !`${spool.label} ${spool.section} ${spool.jointNumber ?? ''}`.toLowerCase().includes(query)) {
          return false;
        }
        if (onlyWithMetalLoss && spool.metalLossTotal === 0) return false;
        const disposition = dispositions[spool.id];
        if (statusFilter === 'undecided') return !disposition;
        if (statusFilter === 'recommended') return disposition?.mode === 'recommendation';
        if (statusFilter === 'repaired') return disposition?.mode === 'repaired';
        return true;
      })
      .sort((left, right) => (
        (sortValue(left) - sortValue(right)) * direction || spoolStartM(left) - spoolStartM(right)
      ));
  }, [spools, dispositions, search, statusFilter, onlyWithMetalLoss, sortKey, sortDir]);

  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const rows = visible.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const openSpool = spools.find((spool) => spool.id === openSpoolId) ?? null;
  const unassigned = spools.filter((spool) => spool.grouping === 'unassigned').length;
  const totalMetalLoss = spools.reduce((sum, spool) => sum + spool.metalLossTotal, 0);
  const assessedTotal = spools.reduce((sum, spool) => sum + spool.assessedCount, 0);
  const spoolsWithMetalLoss = spools.filter((spool) => spool.metalLossTotal > 0).length;

  const columns: Array<{ key: SortKey; header: string; align: 'left' | 'right' | 'center' }> = [
    { key: 'position', header: 'Spool (GW → GW)', align: 'left' },
    { key: 'position', header: 'Extent [m]', align: 'right' },
    { key: 'features', header: 'Metal loss', align: 'right' },
    { key: 'totalLength', header: 'Total L [mm]', align: 'right' },
    { key: 'depth', header: 'Max depth [%WT]', align: 'right' },
    { key: 'erf', header: 'ERF', align: 'right' },
    { key: 'conservativeErf', header: 'ERF cons.', align: 'right' },
    { key: 'life', header: 'Remnant life', align: 'right' },
    { key: 'growth', header: 'Mean CR [mm/y]', align: 'right' },
    { key: 'severity', header: 'Result', align: 'center' },
    { key: 'disposition', header: 'Disposition', align: 'left' },
  ];

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir(key === 'position' ? 'asc' : 'desc');
    }
    setPage(0);
  };

  return (
    <Panel padded={false}>
      <div className="p-5 pb-3">
        <PanelHeader
          title="Metal loss per girth-weld spool"
          subtitle="Every metal-loss feature grouped by the pipe it sits on, girth weld to girth weld. Click a spool to recommend an action or to record work already done."
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

      <div className="grid grid-cols-2 gap-2 px-5 pb-4 md:grid-cols-6">
        <Stat
          label="Spools (GW → GW)"
          value={spools.length.toLocaleString()}
          foot={`${spoolsWithMetalLoss.toLocaleString()} carry metal loss`}
        />
        <Stat
          label="Metal loss reported"
          value={totalMetalLoss.toLocaleString()}
          foot={totalMetalLoss > assessedTotal
            ? `${assessedTotal.toLocaleString()} assessed · ${(totalMetalLoss - assessedTotal).toLocaleString()} not released`
            : 'all assessed'}
        />
        <Stat
          label="Not acceptable"
          value={spools.filter((spool) => spool.severity === 'fail').length.toLocaleString()}
          tone={spools.some((spool) => spool.severity === 'fail') ? 'bad' : 'good'}
        />
        <Stat label="In review band" value={spools.filter((spool) => spool.severity === 'review').length.toLocaleString()} tone="warn" />
        <Stat label="Recommended" value={programme.recommendedCount.toLocaleString()} tone={programme.recommendedCount > 0 ? 'warn' : 'default'} />
        <Stat label="Repaired" value={programme.repairedCount.toLocaleString()} tone={programme.repairedCount > 0 ? 'good' : 'default'} />
      </div>

      {unassigned > 0 && (
        <div className="px-5 pb-3">
          <Callout tone="warn">
            {unassigned} group{unassigned === 1 ? '' : 's'} could not be resolved to a spool: the run carried no girth-weld
            ladder, joint number or upstream-weld distance for those features, so they are grouped by section instead.
          </Callout>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 px-5 py-2.5 dark:border-slate-700">
        <div className="relative min-w-[220px] flex-1">
          <FiSearch className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={search}
            onChange={(event) => { setSearch(event.target.value); setPage(0); }}
            placeholder="Search spool, girth weld, joint number or section"
            aria-label="Search spools"
            className="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-9 pr-3 text-xs text-slate-800 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(event) => { setStatusFilter(event.target.value as typeof statusFilter); setPage(0); }}
          aria-label="Filter by disposition"
          className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs text-slate-700 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
        >
          <option value="all">All spools</option>
          <option value="undecided">No record yet</option>
          <option value="recommended">Recommended</option>
          <option value="repaired">Recorded as repaired</option>
        </select>
        <label className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <input
            type="checkbox"
            checked={onlyWithMetalLoss}
            onChange={(event) => { setOnlyWithMetalLoss(event.target.checked); setPage(0); }}
          />
          Only spools carrying metal loss
        </label>
      </div>

      <div className="overflow-x-auto border-t border-slate-200 dark:border-slate-700">
        <table className="min-w-[1240px] w-full text-left text-xs">
          <thead className="bg-slate-50 dark:bg-slate-900/55">
            <tr>
              {columns.map((column, index) => (
                <th
                  key={`${column.header}-${index}`}
                  scope="col"
                  className={`whitespace-nowrap border-b border-slate-200 px-3 py-2.5 text-${column.align} dark:border-slate-700`}
                >
                  <button
                    type="button"
                    onClick={() => toggleSort(column.key)}
                    className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide transition-colors ${
                      sortKey === column.key
                        ? 'text-indigo-600 dark:text-indigo-400'
                        : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
                    }`}
                  >
                    {column.header}
                    {sortKey === column.key && (sortDir === 'asc' ? <FiChevronUp className="h-3 w-3" /> : <FiChevronDown className="h-3 w-3" />)}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700/70">
            {rows.map((spool) => {
              const disposition = dispositions[spool.id];
              const life = spool.governingLife?.nominal.remnantLife ?? null;
              return (
                <tr
                  key={spool.id}
                  tabIndex={0}
                  onClick={() => setOpenSpoolId(spool.id)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
                    setOpenSpoolId(spool.id);
                  }}
                  className="cursor-pointer text-slate-700 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 dark:text-slate-300 dark:hover:bg-slate-800/60"
                >
                  <td className={`px-3 py-2 font-semibold text-slate-900 dark:text-slate-100 ${
                    spool.severity === 'fail'
                      ? 'border-l-[3px] border-l-rose-500'
                      : spool.severity === 'review'
                        ? 'border-l-[3px] border-l-amber-500'
                        : 'border-l-[3px] border-l-emerald-500'
                  }`}>
                    {spool.label}
                    {spool.clusterCount > 0 && (
                      <span className="ml-1.5 text-[9px] font-bold uppercase tracking-wide text-amber-600 dark:text-amber-400">
                        {spool.clusterCount} CL
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-[11px] tabular-nums">{extentLabel(spool)}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">
                    {spool.metalLossTotal}
                    {spool.unassessedCount > 0 && (
                      <span
                        title={`${spool.assessedCount} assessed, ${spool.unassessedCount} not released by the Corrosion Analysis review`}
                        className="ml-1 text-[9px] font-normal text-slate-400"
                      >
                        ({spool.assessedCount})
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{spool.totalMetalLossLengthMm.toFixed(0)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {spool.metalLossTotal === 0 ? '—' : spool.maxDepthPct.toFixed(1)}
                  </td>
                  <td className={`px-3 py-2 text-right font-bold tabular-nums ${
                    spool.worstNominalErf >= 1
                      ? 'text-rose-600 dark:text-rose-400'
                      : spool.worstNominalErf >= screening.reviewBandErf
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-slate-800 dark:text-slate-100'
                  }`}>
                    {spool.assessedCount === 0 ? '—' : formatErf(spool.worstNominalErf)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-amber-600 dark:text-amber-400">
                    {spool.assessedCount === 0 ? '—' : formatErf(spool.worstConservativeErf)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {spool.assessedCount === 0 ? '—' : life ? formatRemnantLife(life) : 'Not established'}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{rate(spool.growth.meanMmPerYear)}</td>
                  <td className="px-3 py-2 text-center">
                    {spool.assessedCount === 0 ? (
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                        {spool.metalLossTotal === 0 ? 'Clean' : 'Not assessed'}
                      </span>
                    ) : (
                      <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${SEVERITY_STYLE[spool.severity]}`}>
                        {SEVERITY_LABEL[spool.severity]}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {disposition ? (
                      <span className={`font-semibold ${disposition.mode === 'repaired' ? 'text-emerald-600 dark:text-emerald-400' : 'text-indigo-600 dark:text-indigo-400'}`}>
                        {dispositionLabel(disposition)}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-slate-400">
                        <FiTool aria-hidden="true" /> Not decided
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-3 py-10 text-center text-slate-400">
                  No spool matches the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pageCount > 1 && (
        <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-5 py-3 text-[11px] text-slate-500 dark:border-slate-700 dark:text-slate-400">
          <span>
            Spools {(currentPage * PAGE_SIZE + 1).toLocaleString()}–
            {Math.min((currentPage + 1) * PAGE_SIZE, visible.length).toLocaleString()} of {visible.length.toLocaleString()}
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
          onSave={onSaveDisposition}
          onClear={onClearDisposition}
          onApplyToFeatures={onApplyToFeatures}
          onOpenFeature={onOpenFeature}
          onClose={() => setOpenSpoolId(null)}
        />
      )}
    </Panel>
  );
}
