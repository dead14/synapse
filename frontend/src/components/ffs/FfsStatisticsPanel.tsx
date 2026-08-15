import { useMemo, useState } from 'react';
import { FiDownload, FiPlus, FiRefreshCw, FiSettings, FiX } from 'react-icons/fi';
import { exportStatisticsWorkbook } from '../../lib/ffs/exports';
import { formatRemnantLife } from '../../lib/ffs/lifeProjection';
import {
  DEFAULT_DEPTH_BUCKETS,
  MIN_LD_BIN_SIZE_M,
  buildDistributionTable,
  buildWorstTable,
  isInternal,
  resolveLdBinSize,
  type DepthBucket,
  type WorstBy,
} from '../../lib/ffs/statistics';
import type { FfsConfig, FfsScreenedResult } from '../../lib/ffs/types';
import SynButton from '../ui/SynButton';
import { Callout, Panel, PanelHeader, PriorityLabel, SeverityBadge, formatErf } from './FfsPrimitives';

const WORST_BY_OPTIONS: { value: WorstBy; label: string }[] = [
  { value: 'depth', label: 'Depth %' },
  { value: 'erf', label: 'ERF' },
  { value: 'life', label: 'Shortest life' },
];

/** Editor for the depth bands used by the distribution cross-tab. */
function BucketEditor({
  buckets,
  onChange,
}: {
  buckets: DepthBucket[];
  onChange: (next: DepthBucket[]) => void;
}) {
  const rename = (list: DepthBucket[]) =>
    list.map((bucket) => ({
      ...bucket,
      name: Number.isFinite(bucket.to) ? `${bucket.from}-${bucket.to}%` : `${bucket.from}%+`,
    }));

  const setBoundary = (index: number, value: number) => {
    const next = buckets.map((b) => ({ ...b }));
    next[index].to = value;
    if (next[index + 1]) next[index + 1].from = value;
    onChange(rename(next));
  };

  const addBucket = () => {
    const next = buckets.map((b) => ({ ...b }));
    const last = next[next.length - 1];
    // Split the open-topped band so the new boundary sits inside it.
    const boundary = Math.min(95, last.from + 10);
    last.to = boundary;
    next.push({
      id: `b${Date.now()}`,
      name: `${boundary}%+`,
      from: boundary,
      to: Number.POSITIVE_INFINITY,
      color: '#64748b',
    });
    onChange(rename(next));
  };

  const removeBucket = (index: number) => {
    if (buckets.length <= 2) return;
    const next = buckets.filter((_, i) => i !== index).map((b) => ({ ...b }));
    // Re-chain the bands so there is no gap where the removed one sat.
    for (let i = 1; i < next.length; i++) next[i].from = next[i - 1].to;
    next[next.length - 1].to = Number.POSITIVE_INFINITY;
    onChange(rename(next));
  };

  return (
    <div className="space-y-2.5">
      {buckets.map((bucket, index) => (
        <div key={bucket.id} className="flex flex-wrap items-center gap-2">
          <input
            type="color"
            value={bucket.color}
            onChange={(event) => {
              const next = buckets.map((b) => ({ ...b }));
              next[index].color = event.target.value;
              onChange(next);
            }}
            aria-label={`${bucket.name} colour`}
            className="h-6 w-7 shrink-0 cursor-pointer rounded border border-slate-300 bg-transparent p-0.5 dark:border-slate-600"
          />
          <input
            type="text"
            value={bucket.name}
            onChange={(event) => {
              const next = buckets.map((b) => ({ ...b }));
              next[index].name = event.target.value;
              onChange(next);
            }}
            aria-label={`Band ${index + 1} name`}
            className="w-[90px] rounded border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700 focus:border-indigo-500 focus:outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
          />
          <span className="text-[11px] tabular-nums text-slate-500">from {bucket.from}%</span>
          {Number.isFinite(bucket.to) ? (
            <>
              <span className="text-[11px] text-slate-400">to</span>
              <input
                type="number"
                value={bucket.to}
                min={bucket.from + 1}
                max={100}
                onChange={(event) => setBoundary(index, parseFloat(event.target.value) || bucket.to)}
                aria-label={`Band ${index + 1} upper bound`}
                className="w-[58px] rounded border border-slate-200 bg-white px-2 py-1 text-[11px] tabular-nums text-slate-700 focus:border-indigo-500 focus:outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
              />
              <span className="text-[11px] text-slate-400">%</span>
            </>
          ) : (
            <span className="text-[11px] italic text-slate-400">and above</span>
          )}
          {buckets.length > 2 && (
            <button
              type="button"
              onClick={() => removeBucket(index)}
              aria-label={`Remove the ${bucket.name} band`}
              className="grid h-5 w-5 place-items-center rounded text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40"
            >
              <FiX className="h-3 w-3" />
            </button>
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={addBucket}
        className="inline-flex items-center gap-1.5 rounded-md border border-indigo-200 px-2.5 py-1 text-[11px] font-medium text-indigo-600 transition-colors hover:bg-indigo-50 dark:border-indigo-800/60 dark:text-indigo-400 dark:hover:bg-indigo-950/40"
      >
        <FiPlus className="h-3 w-3" /> Add band
      </button>
    </div>
  );
}

/**
 * Population statistics: a distribution cross-tab over log-distance bins and
 * depth bands, and the governing feature in each bin.
 */
export default function FfsStatisticsPanel({
  items,
  config,
  onSelect,
}: {
  items: FfsScreenedResult[];
  config: FfsConfig;
  onSelect: (item: FfsScreenedResult) => void;
}) {
  const [binSize, setBinSize] = useState(500);
  const [draftBin, setDraftBin] = useState(500);
  const [buckets, setBuckets] = useState<DepthBucket[]>(DEFAULT_DEPTH_BUCKETS);
  const [bucketsOpen, setBucketsOpen] = useState(false);
  const [worstBy, setWorstBy] = useState<WorstBy>('depth');

  const distribution = useMemo(
    () => buildDistributionTable(items, binSize, buckets),
    [items, binSize, buckets],
  );
  const worstRows = useMemo(() => buildWorstTable(items, binSize, worstBy), [items, binSize, worstBy]);
  // The size the tables were actually drawn with. A request finer than the line
  // can carry is widened rather than honoured, and an axis labelled with the
  // number the engineer typed instead of the one used would be a lie.
  const effectiveBinSize = useMemo(() => resolveLdBinSize(items, binSize), [items, binSize]);
  const binWasWidened = effectiveBinSize > binSize;

  if (!items.length) {
    return <Callout tone="warn">No assessed features are available to summarise.</Callout>;
  }

  const cellClass = (value: number) =>
    value === 0
      ? 'text-slate-300 dark:text-slate-600'
      : 'font-semibold text-slate-800 dark:text-slate-100';

  return (
    <div className="space-y-5">
      {/* Shared controls */}
      <Panel className="!p-3.5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="whitespace-nowrap text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Log distance bin
            </label>
            <input
              type="number"
              value={draftBin}
              min={MIN_LD_BIN_SIZE_M}
              step={50}
              onChange={(event) => setDraftBin(parseFloat(event.target.value) || 0)}
              className="w-[84px] rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs tabular-nums text-slate-800 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            />
            <span className="text-[11px] text-slate-400">m</span>
            {binWasWidened && (
              <span className="text-[11px] text-amber-600 dark:text-amber-500">
                widened to {effectiveBinSize.toFixed(1)} m to keep the table readable
              </span>
            )}
          </div>

          <button
            type="button"
            // `min` on a number input is a spinner hint, not a constraint on
            // typed text: a bin of 0.01 m over a long line asked for millions of
            // bins and froze the tab. Clamped here, and widened further inside
            // buildLdBins when the population still needs it.
            onClick={() => setBinSize(Math.max(MIN_LD_BIN_SIZE_M, draftBin || MIN_LD_BIN_SIZE_M))}
            className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 px-3 py-1.5 text-xs font-medium text-indigo-600 transition-colors hover:bg-indigo-50 dark:border-indigo-800/60 dark:text-indigo-400 dark:hover:bg-indigo-950/40"
          >
            <FiRefreshCw className="h-3 w-3" /> Rebuild tables
          </button>

          <div className="ml-auto flex items-center gap-2">
            <SynButton
              type="button"
              variant="outline"
              size="sm"
              onClick={() => exportStatisticsWorkbook(distribution, worstRows, effectiveBinSize, config)}
            >
              <span className="inline-flex items-center gap-2">
                <FiDownload /> Export Excel
              </span>
            </SynButton>
          </div>
        </div>
      </Panel>

      {/* Distribution table */}
      <Panel>
        <PanelHeader
          title="Defect distribution"
          subtitle={`Feature count per ${effectiveBinSize} m bin, by depth band and corrosion surface`}
          actions={
            <button
              type="button"
              onClick={() => setBucketsOpen((open) => !open)}
              aria-expanded={bucketsOpen}
              className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                bucketsOpen
                  ? 'border-indigo-300 bg-indigo-50 text-indigo-600 dark:border-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-400'
                  : 'border-slate-200 text-slate-500 hover:border-indigo-300 hover:text-indigo-600 dark:border-slate-700 dark:text-slate-400'
              }`}
            >
              <FiSettings className="h-3 w-3" /> Depth bands
            </button>
          }
        />

        {bucketsOpen && (
          <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3.5 dark:border-slate-700 dark:bg-slate-900/50">
            <p className="mb-2.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Depth bands — fully user-defined
            </p>
            <BucketEditor buckets={buckets} onChange={setBuckets} />
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs" style={{ minWidth: 180 + buckets.length * 150 }}>
            <thead>
              <tr>
                <th
                  rowSpan={2}
                  scope="col"
                  className="sticky left-0 z-10 border-b-2 border-slate-200 bg-slate-100 px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-slate-600 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300"
                >
                  LD bin [m]
                </th>
                {buckets.map((bucket) => (
                  <th
                    key={bucket.id}
                    colSpan={3}
                    scope="colgroup"
                    className="border-b border-slate-200 bg-slate-50 px-3 py-1.5 text-center text-[10px] font-bold uppercase tracking-wide text-slate-600 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300"
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ background: bucket.color }}
                        aria-hidden="true"
                      />
                      {bucket.name}
                    </span>
                  </th>
                ))}
                <th
                  rowSpan={2}
                  scope="col"
                  className="border-b-2 border-slate-200 bg-slate-100 px-3 py-2 text-right text-[10px] font-bold uppercase tracking-wide text-slate-600 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300"
                >
                  Row total
                </th>
              </tr>
              <tr>
                {buckets.flatMap((bucket) =>
                  ['Int', 'Ext', 'All'].map((label) => (
                    <th
                      key={`${bucket.id}-${label}`}
                      scope="col"
                      className="border-b-2 border-slate-200 bg-slate-50 px-2 py-1.5 text-center text-[9px] font-semibold uppercase tracking-wider text-slate-500 dark:border-slate-600 dark:bg-slate-900/60 dark:text-slate-400"
                    >
                      {label}
                    </th>
                  )),
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700/70">
              {distribution.rows.map((row) => (
                <tr key={row.bin.label} className="hover:bg-slate-50 dark:hover:bg-slate-700/30">
                  <th
                    scope="row"
                    className="sticky left-0 z-10 whitespace-nowrap bg-slate-50 px-3 py-2 text-left text-[11px] font-semibold tabular-nums text-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  >
                    {row.bin.label}
                  </th>
                  {row.cells.flatMap((cell, i) => [
                    <td key={`${i}-int`} className={`px-2 py-2 text-center tabular-nums ${cellClass(cell.internal)}`}>
                      {cell.internal || '·'}
                    </td>,
                    <td key={`${i}-ext`} className={`px-2 py-2 text-center tabular-nums ${cellClass(cell.external)}`}>
                      {cell.external || '·'}
                    </td>,
                    <td
                      key={`${i}-all`}
                      className={`bg-slate-50/60 px-2 py-2 text-center tabular-nums dark:bg-slate-900/30 ${cellClass(cell.total)}`}
                    >
                      {cell.total || '·'}
                    </td>,
                  ])}
                  <td className="px-3 py-2 text-right font-bold tabular-nums text-slate-800 dark:text-slate-100">
                    {row.total}
                  </td>
                </tr>
              ))}

              <tr className="border-t-2 border-slate-300 bg-slate-100 dark:border-slate-600 dark:bg-slate-900/70">
                <th
                  scope="row"
                  className="sticky left-0 z-10 bg-slate-100 px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-slate-700 dark:bg-slate-900/70 dark:text-slate-200"
                >
                  Total
                </th>
                {distribution.totals.cells.flatMap((cell, i) => [
                  <td key={`t${i}-int`} className="px-2 py-2 text-center font-bold tabular-nums text-slate-700 dark:text-slate-200">
                    {cell.internal || '·'}
                  </td>,
                  <td key={`t${i}-ext`} className="px-2 py-2 text-center font-bold tabular-nums text-slate-700 dark:text-slate-200">
                    {cell.external || '·'}
                  </td>,
                  <td key={`t${i}-all`} className="px-2 py-2 text-center font-bold tabular-nums text-slate-800 dark:text-slate-100">
                    {cell.total || '·'}
                  </td>,
                ])}
                <td className="px-3 py-2 text-right font-bold tabular-nums text-indigo-600 dark:text-indigo-400">
                  {distribution.totals.total}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="mt-3 text-[11px] text-slate-400">
          Int = internal corrosion · Ext = external corrosion ·{' '}
          {items.filter(isInternal).length.toLocaleString()} internal and{' '}
          {(items.length - items.filter(isInternal).length).toLocaleString()} external features in total.
        </p>
      </Panel>

      {/* Worst feature per bin */}
      <Panel>
        <PanelHeader
          title="Governing feature per bin"
          subtitle={`The single worst feature in each ${effectiveBinSize} m bin under the selected criterion`}
          actions={
            <div
              role="group"
              aria-label="Ranking criterion"
              className="flex gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 dark:border-slate-700 dark:bg-slate-900"
            >
              {WORST_BY_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setWorstBy(option.value)}
                  aria-pressed={worstBy === option.value}
                  className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
                    worstBy === option.value
                      ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-400'
                      : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          }
        />

        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-900/60">
                {[
                  ['LD bin [m]', 'left'],
                  ['In bin', 'right'],
                  ['LD [m]', 'right'],
                  ['Section', 'left'],
                  ['Surface', 'left'],
                  ['Depth [%]', 'right'],
                  ['Length [mm]', 'right'],
                  ['ERF', 'right'],
                  ['ERF cons.', 'right'],
                  ['Life [y]', 'right'],
                  ['Life to ERF 1', 'right'],
                  ['Priority', 'center'],
                  ['Status', 'center'],
                ].map(([label, align]) => (
                  <th
                    key={label}
                    scope="col"
                    className={`whitespace-nowrap border-b-2 border-slate-200 px-3 py-2 text-${align} text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:border-slate-600 dark:text-slate-400`}
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700/70">
              {worstRows.map((row) => {
                if (!row.worst) {
                  return (
                    <tr key={row.bin.label} className="text-slate-400">
                      <th scope="row" className="px-3 py-2 text-left text-[11px] font-semibold tabular-nums">
                        {row.bin.label}
                      </th>
                      <td className="px-3 py-2 text-right tabular-nums">0</td>
                      <td colSpan={11} className="px-3 py-2 text-center italic">
                        No feature reported in this bin
                      </td>
                    </tr>
                  );
                }

                const item = row.worst;
                const n = item.nominal;
                return (
                  <tr
                    key={row.bin.label}
                    onClick={() => onSelect(item)}
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        onSelect(item);
                      }
                    }}
                    className="cursor-pointer transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 dark:hover:bg-slate-700/40"
                  >
                    <th
                      scope="row"
                      className="whitespace-nowrap bg-slate-50/60 px-3 py-2 text-left text-[11px] font-semibold tabular-nums text-slate-700 dark:bg-slate-900/30 dark:text-slate-200"
                    >
                      {row.bin.label}
                    </th>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-500 dark:text-slate-400">
                      {row.count}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-800 dark:text-slate-100">
                      {Number(n.ld).toLocaleString(undefined, { maximumFractionDigits: 3 })}
                    </td>
                    <td className="max-w-[140px] truncate px-3 py-2 text-slate-600 dark:text-slate-300">
                      {n.section}
                    </td>
                    <td
                      className={`whitespace-nowrap px-3 py-2 font-medium ${
                        isInternal(item)
                          ? 'text-indigo-600 dark:text-indigo-400'
                          : 'text-amber-600 dark:text-amber-400'
                      }`}
                    >
                      {n.surface}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-800 dark:text-slate-100">
                      {n.maxDepthPct.toFixed(1)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600 dark:text-slate-300">
                      {n.length.toFixed(0)}
                    </td>
                    <td
                      className={`px-3 py-2 text-right font-bold tabular-nums ${
                        n.ERF > 1 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-800 dark:text-slate-100'
                      }`}
                    >
                      {formatErf(n.ERF)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-amber-600 dark:text-amber-400">
                      {formatErf(item.conservative.ERF)}
                    </td>
                    <td
                      className={`px-3 py-2 text-right font-semibold tabular-nums ${
                        n.remnantLife.years !== null && n.remnantLife.years < config.highlightYears
                          ? 'text-amber-600 dark:text-amber-400'
                          : 'text-slate-700 dark:text-slate-200'
                      }`}
                    >
                      {formatRemnantLife(n.remnantLife)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-500 dark:text-slate-400">
                      {formatRemnantLife(item.remnantLifeConservative)}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <PriorityLabel priority={item.priority} />
                    </td>
                    <td className="px-3 py-2 text-center">
                      <SeverityBadge severity={item.conservative.severity} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
