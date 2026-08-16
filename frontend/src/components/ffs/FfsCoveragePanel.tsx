/**
 * What this assessment covered, and what it did not.
 *
 * An FFS report used to contain only the features that produced a B31G number.
 * Everything else — an anomaly with no depth, a run that reported no width, a
 * feature nobody had got round to reviewing — was absent, and absent from a
 * report reads as "not there on the pipe" rather than "not assessed". That is
 * how a line ends up looking cleaner than it is.
 *
 * This panel is the counterweight: the whole NEW-run metal-loss population,
 * split into what was assessed and what was not, with the reason against each
 * one. It never invents a result for a feature that has none.
 */

import { useMemo, useState } from 'react';
import { FiAlertTriangle, FiCheckCircle, FiInfo } from 'react-icons/fi';

import { Callout, Panel } from './FfsPrimitives';
import type {
  AlignmentImportSkipped,
  FfsIntakeScope,
  FfsSpoolCensusRow,
  RejectedAlignmentRow,
} from '../../lib/ffs/alignmentImport';

interface FfsCoveragePanelProps {
  /** Features that produced a B31G result. */
  assessedCount: number;
  scope?: FfsIntakeScope;
  rejected?: RejectedAlignmentRow[];
  skipped?: AlignmentImportSkipped;
  /** Every metal-loss record of the run, assessed or not. */
  census?: FfsSpoolCensusRow[];
}

/** How many rows of the unassessed register are shown before it is capped. */
const VISIBLE_ROWS = 200;

function count(value: number | undefined): number {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : 0;
}

function metres(value: number | null): string {
  return value === null ? '—' : value.toFixed(2);
}

function percent(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(1)} %WT`;
}

export default function FfsCoveragePanel({
  assessedCount,
  scope,
  rejected,
  skipped,
  census,
}: FfsCoveragePanelProps) {
  const [expanded, setExpanded] = useState(false);
  // Memoised rather than defaulted inline: a fresh `[]` on every render would
  // invalidate the grouping below on every render too.
  const unassessed = useMemo(() => rejected ?? [], [rejected]);

  /** Reasons, largest group first — the shape of the gap, not just its size. */
  const reasons = useMemo(() => {
    const grouped = new Map<string, number>();
    for (const row of unassessed) {
      grouped.set(row.reason, (grouped.get(row.reason) ?? 0) + 1);
    }
    return [...grouped.entries()]
      .map(([reason, total]) => ({ reason, total }))
      .sort((left, right) => right.total - left.total);
  }, [unassessed]);

  // The run's own metal-loss population, where the import recorded it. It is the
  // denominator this panel is really about: assessed + unassessed + held back
  // has to add up to it.
  const censusTotal = census?.length ?? null;
  const heldBack = count(skipped?.notReleased);
  const excluded = count(skipped?.excluded);
  // Welds, fittings, dents and cracks. B31G is written for metal loss, so these
  // are outside the method rather than outside the scope — but they are still
  // counted, because "we did not assess it" and "it is not there" must never
  // look the same.
  const notMetalLoss = count(skipped?.notMetalLoss);

  if (!rejected && !skipped && !census) {
    return (
      <Callout tone="info">
        This assessment was run from a manual workbook, so its coverage is the workbook: every row it
        contained was assessed. There is no run population to compare it against.
      </Callout>
    );
  }

  return (
    <div className="space-y-4">
      <Panel>
        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Assessment coverage</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <span className="block text-2xl font-semibold tabular-nums text-slate-800 dark:text-slate-100">
              {censusTotal === null ? '—' : censusTotal.toLocaleString()}
            </span>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              Metal-loss anomalies reported by the NEW run
            </span>
          </div>
          <div>
            <span className="block text-2xl font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
              {assessedCount.toLocaleString()}
            </span>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">Assessed to B31G</span>
          </div>
          <div>
            <span className={`block text-2xl font-semibold tabular-nums ${
              unassessed.length > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-800 dark:text-slate-100'
            }`}>
              {unassessed.length.toLocaleString()}
            </span>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              In scope but not calculable
            </span>
          </div>
          <div>
            <span className="block text-2xl font-semibold tabular-nums text-slate-800 dark:text-slate-100">
              {(heldBack + excluded).toLocaleString()}
            </span>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              Held back by a reviewer’s decision
            </span>
          </div>
        </div>

        <p className="mt-3 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
          {scope === 'all'
            ? 'This assessment covered every metal-loss anomaly the NEW run reported, matched to the previous '
              + 'inspection or not.'
            : scope === 'released'
              ? 'This assessment covered the features an engineer released in Corrosion Analysis. Anomalies '
                + 'outside that release are counted here rather than dropped.'
              : 'This assessment was filed before coverage was recorded as part of the case, so the scope '
                + 'behind these numbers is not stated.'}
          {' '}Nothing on this page is a fitness-for-service verdict: a feature that could not be calculated has
          no result, and is neither acceptable nor unacceptable until the data behind it is repaired.
        </p>
        {notMetalLoss > 0 && (
          <p className="mt-2 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
            A further {notMetalLoss.toLocaleString()} NEW-run feature{notMetalLoss === 1 ? '' : 's'} —
            welds, fittings, dents, cracks — {notMetalLoss === 1 ? 'is' : 'are'} outside ASME B31G, which is
            written for metal loss. {notMetalLoss === 1 ? 'It needs' : 'They need'} their own assessment method,
            not this one.
          </p>
        )}
      </Panel>

      {(heldBack > 0 || excluded > 0) && (
        <Callout tone="info">
          <span className="inline-flex items-start gap-2">
            <FiInfo className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>
              {heldBack > 0 && (
                <>{heldBack.toLocaleString()} anomal{heldBack === 1 ? 'y was' : 'ies were'} outside the released
                scope of this assessment. </>
              )}
              {excluded > 0 && (
                <>{excluded.toLocaleString()} anomal{excluded === 1 ? 'y was' : 'ies were'} excluded from the
                released outputs by a reviewer. </>
              )}
              These are decisions someone made, not data failures — re-run the assessment against the whole run
              to include them.
            </span>
          </span>
        </Callout>
      )}

      {unassessed.length === 0 ? (
        <Callout tone="ok">
          <span className="inline-flex items-start gap-2">
            <FiCheckCircle className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>Every anomaly in scope produced a B31G result. Nothing was dropped for missing data.</span>
          </span>
        </Callout>
      ) : (
        <Panel>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
              Anomalies with no B31G result
            </p>
            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">
              <FiAlertTriangle aria-hidden="true" /> {unassessed.length.toLocaleString()} feature
              {unassessed.length === 1 ? '' : 's'} need source data before they can be assessed
            </span>
          </div>

          <ul className="mt-3 space-y-1.5">
            {reasons.map((entry) => (
              <li key={entry.reason} className="text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
                <span className="font-semibold tabular-nums">{entry.total.toLocaleString()}</span>
                {' — '}{entry.reason}
              </li>
            ))}
          </ul>

          <div className="mt-4 max-h-96 overflow-auto rounded-lg border border-slate-200 dark:border-slate-700">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-slate-50 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:bg-slate-900/70">
                <tr>
                  <th className="px-3 py-2">Feature</th>
                  <th className="px-3 py-2 text-right">LD [m]</th>
                  <th className="px-3 py-2 text-right">Reported depth</th>
                  <th className="px-3 py-2">Why it was not assessed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {(expanded ? unassessed : unassessed.slice(0, VISIBLE_ROWS)).map((row, index) => (
                  <tr key={`${row.sourceKey || row.featureId}-${index}`}>
                    <td className="px-3 py-1.5 font-mono">{row.featureId}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums">{metres(row.ldM ?? null)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{percent(row.depthPct ?? null)}</td>
                    <td className="px-3 py-1.5 text-slate-600 dark:text-slate-300">{row.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {unassessed.length > VISIBLE_ROWS && (
            <button
              type="button"
              onClick={() => setExpanded((open) => !open)}
              className="mt-2 text-[11px] font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
            >
              {expanded
                ? `Show only the first ${VISIBLE_ROWS.toLocaleString()}`
                : `Show all ${unassessed.length.toLocaleString()}`}
            </button>
          )}
        </Panel>
      )}
    </div>
  );
}
