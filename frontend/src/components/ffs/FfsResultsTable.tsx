import { useMemo, useState } from 'react';
import { FiChevronDown, FiChevronUp, FiSearch } from 'react-icons/fi';
import type { FfsConfig, FfsScreenedResult, FfsScreeningConfig } from '../../lib/ffs/types';
import { formatRemnantLife, lifeSortValue, remnantLimitLabel } from '../../lib/ffs/lifeProjection';
import { Callout, Panel, PriorityLabel, SeverityBadge, formatErf } from './FfsPrimitives';

const PAGE_SIZE = 100;

type SortKey =
  | 'ld'
  | 'featureId'
  | 'section'
  | 'surface'
  | 'depth'
  | 'length'
  | 'erf'
  | 'conservativeErf'
  | 'safePressure'
  | 'acceptance'
  | 'remnantLife'
  | 'dueDate'
  | 'governingLimit'
  | 'repairStatus'
  | 'disposition'
  | 'priority';

interface Column {
  key: SortKey;
  header: string;
  align: 'left' | 'right' | 'center';
  value: (item: FfsScreenedResult) => number | string | null;
}

const PRIORITY_RANK = { High: 3, Medium: 2, Routine: 1 } as const;

const COLUMNS: Column[] = [
  { key: 'ld', header: 'LD [m]', align: 'right', value: (i) => Number(i.nominal.ld) || 0 },
  { key: 'featureId', header: 'Feature ID', align: 'left', value: (i) => i.nominal.featureId ?? '' },
  { key: 'section', header: 'Section', align: 'left', value: (i) => i.nominal.section },
  { key: 'surface', header: 'Surface', align: 'left', value: (i) => i.nominal.surface },
  { key: 'depth', header: 'Depth [%]', align: 'right', value: (i) => i.nominal.maxDepthPct },
  { key: 'length', header: 'Length [mm]', align: 'right', value: (i) => i.nominal.length },
  { key: 'erf', header: 'ERF', align: 'right', value: (i) => i.nominal.ERF },
  { key: 'conservativeErf', header: 'ERF cons.', align: 'right', value: (i) => i.conservative.ERF },
  { key: 'safePressure', header: 'P_safe [MPa]', align: 'right', value: (i) => i.nominal.safePressure },
  { key: 'acceptance', header: 'Acceptance', align: 'center', value: (i) => i.nominal.acceptance },
  { key: 'remnantLife', header: 'Remnant life', align: 'right', value: (i) => lifeSortValue(i.nominal.remnantLife.years) },
  { key: 'dueDate', header: 'Due date', align: 'center', value: (i) => i.nominal.remnantLife.dueDateIso ?? '' },
  { key: 'governingLimit', header: 'Governing limit', align: 'left', value: (i) => i.nominal.remnantLife.governingLimit ?? i.nominal.remnantLife.status },
  { key: 'repairStatus', header: 'Repair', align: 'center', value: (i) => i.nominal.repairStatus },
  { key: 'disposition', header: 'Disposition', align: 'left', value: (i) => dispositionRank(i) },
  { key: 'priority', header: 'Priority', align: 'center', value: (i) => PRIORITY_RANK[i.priority] },
];

/**
 * What the spool review has said about this feature. A repair that has been
 * carried out outranks a recommendation, and a recommendation outranks nothing
 * recorded, so sorting on this column walks the register from decided to open.
 */
function dispositionRank(item: FfsScreenedResult): number {
  if (item.nominal.repairStatus === 'permanent-repair-verified') return 3;
  if (item.nominal.repairStatus === 'temporary-repair') return 2;
  return item.nominal.recommendation ? 1 : 0;
}

function DispositionCell({ item }: { item: FfsScreenedResult }) {
  const n = item.nominal;
  if (n.repairStatus !== 'unrepaired') {
    return (
      <span className="inline-flex items-center gap-1 font-semibold text-emerald-600 dark:text-emerald-400">
        Repaired
        <span className="font-normal text-slate-500 dark:text-slate-400">
          {n.repairMethod ? `· ${n.repairMethod}` : ''}
        </span>
      </span>
    );
  }
  if (n.recommendation) {
    return (
      <span className="inline-flex items-center gap-1 font-semibold text-indigo-600 dark:text-indigo-400">
        Recommended
        <span className="font-normal text-slate-500 dark:text-slate-400">· {n.recommendation}</span>
      </span>
    );
  }
  return <span className="text-slate-400">—</span>;
}

/**
 * The assessment register: every feature with its nominal and conservative
 * result, sortable and filterable, with rows below the life threshold flagged.
 */
export default function FfsResultsTable({
  items,
  config,
  screening,
  onSelect,
}: {
  items: FfsScreenedResult[];
  config: FfsConfig;
  screening: FfsScreeningConfig;
  onSelect: (item: FfsScreenedResult) => void;
}) {
  const [search, setSearch] = useState('');
  const [acceptance, setAcceptance] = useState('All');
  const [criterion, setCriterion] = useState('All');
  const [priority, setPriority] = useState('All');
  const [sortKey, setSortKey] = useState<SortKey>('erf');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const column = COLUMNS.find((c) => c.key === sortKey)!;
    const direction = sortDir === 'asc' ? 1 : -1;

    return items
      .filter((item) => {
        if (query) {
          const haystack = `${item.nominal.featureId ?? ''} ${item.nominal.ld} ${item.nominal.section} ${item.nominal.surface} ${item.nominal.orient} ${item.nominal.repairReference ?? ''}`;
          if (!haystack.toLowerCase().includes(query)) return false;
        }
        if (acceptance !== 'All' && item.nominal.acceptance !== acceptance) return false;
        if (
          criterion !== 'All' &&
          item.nominal.remnantLife.governingLimit !== criterion &&
          item.nominal.remnantLife.status !== criterion
        ) return false;
        if (priority !== 'All' && item.priority !== priority) return false;
        return true;
      })
      .sort((a, b) => {
        const av = column.value(a);
        const bv = column.value(b);
        if (av === null || bv === null) {
          if (av === bv) return 0;
          return av === null ? 1 : -1;
        }
        if (typeof av === 'number' && typeof bv === 'number') {
          // Push non-finite ERF values (no remaining capacity) to the severe end.
          const safeA = Number.isFinite(av) ? av : Number.MAX_VALUE;
          const safeB = Number.isFinite(bv) ? bv : Number.MAX_VALUE;
          return (safeA - safeB) * direction;
        }
        return String(av).localeCompare(String(bv)) * direction;
      });
  }, [items, search, acceptance, criterion, priority, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const highlighted = filtered.filter(
    (item) => item.nominal.remnantLife.years !== null &&
      item.nominal.remnantLife.years < config.highlightYears,
  ).length;

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'ld' || key === 'featureId' || key === 'section' ? 'asc' : 'desc');
    }
    setPage(1);
  };

  const selectClass =
    'rounded-lg border border-slate-200 bg-slate-50 px-2 py-2 text-xs text-slate-700 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200';

  return (
    <div className="space-y-4">
      {/* Controls */}
      <Panel className="!p-3.5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[200px] flex-1">
            <FiSearch className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Search Feature ID, log distance, section, surface, orientation, or repair reference"
              aria-label="Search features"
              className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-xs text-slate-800 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            />
          </div>

          <select
            value={acceptance}
            onChange={(event) => {
              setAcceptance(event.target.value);
              setPage(1);
            }}
            aria-label="Filter by acceptance"
            className={selectClass}
          >
            <option value="All">All acceptance</option>
            <option value="Acceptable">Acceptable</option>
            <option value="Un-Acceptable">Not acceptable</option>
          </select>

          <select
            value={criterion}
            onChange={(event) => {
              setCriterion(event.target.value);
              setPage(1);
            }}
            aria-label="Filter by governing criterion"
            className={selectClass}
          >
            <option value="All">All criteria</option>
            <option value="ERF = 1">ERF = 1</option>
            <option value="Depth = 80%">Depth limit</option>
            <option value="not-reached-within-horizon">Limit not reached</option>
            <option value="insufficient-growth-basis">No growth basis</option>
          </select>

          <select
            value={priority}
            onChange={(event) => {
              setPriority(event.target.value);
              setPage(1);
            }}
            aria-label="Filter by priority"
            className={selectClass}
          >
            <option value="All">All priorities</option>
            <option value="High">High</option>
            <option value="Medium">Medium</option>
            <option value="Routine">Routine</option>
          </select>

          {highlighted > 0 && (
            <span className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-2 text-[11px] font-semibold text-amber-700 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-400">
              {highlighted} row{highlighted === 1 ? '' : 's'} under {config.highlightYears} y
            </span>
          )}
        </div>
      </Panel>

      {/* Table */}
      <Panel padded={false} className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="ffs-table w-full min-w-[1380px] border-collapse">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-900/60">
                {COLUMNS.map((column) => {
                  const active = sortKey === column.key;
                  return (
                    <th
                      key={column.key}
                      scope="col"
                      className={`whitespace-nowrap border-b border-slate-200 px-2 py-2 text-${column.align} dark:border-slate-700`}
                    >
                      <button
                        type="button"
                        onClick={() => toggleSort(column.key)}
                        className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide transition-colors ${
                          active
                            ? 'text-indigo-600 dark:text-indigo-400'
                            : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
                        }`}
                      >
                        {column.header}
                        {active &&
                          (sortDir === 'asc' ? (
                            <FiChevronUp className="h-3 w-3" />
                          ) : (
                            <FiChevronDown className="h-3 w-3" />
                          ))}
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700/70">
              {pageRows.map((item) => {
                const n = item.nominal;
                const life = n.remnantLife;
                const belowThreshold = life.years !== null && life.years < config.highlightYears;
                const failed = n.acceptance === 'Un-Acceptable';

                return (
                  <tr
                    key={`${item.key}-${item.index}`}
                    onClick={() => onSelect(item)}
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        onSelect(item);
                      }
                    }}
                    className={`cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 ${
                      belowThreshold
                        ? 'bg-amber-50/60 hover:bg-amber-100/60 dark:bg-amber-950/20 dark:hover:bg-amber-950/40'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-700/40'
                    }`}
                  >
                    <td
                      className={`whitespace-nowrap px-2 py-2 text-right font-semibold tabular-nums text-slate-800 dark:text-slate-100 ${
                        failed ? 'border-l-[3px] border-l-rose-500' : 'border-l-[3px] border-l-emerald-500'
                      }`}
                    >
                      {Number(n.ld).toLocaleString(undefined, { maximumFractionDigits: 3 })}
                    </td>
                    <td className="max-w-[150px] truncate px-2 py-2 font-mono text-[10px] font-semibold text-slate-700 dark:text-slate-200">
                      <span className="inline-flex items-center gap-1">
                        {n.featureId ?? '—'}
                        {n.isClusteredMetalLoss && (
                          <span
                            title="Clustered metal loss: a vendor-merged group assessed as one defect, with no run-pair growth rate."
                            className="rounded border border-violet-200 bg-violet-50 px-1 py-px font-sans text-[8px] font-bold uppercase tracking-wide text-violet-700 dark:border-violet-800/60 dark:bg-violet-950/30 dark:text-violet-300"
                          >
                            CL
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="max-w-[160px] truncate px-2 py-2 text-slate-600 dark:text-slate-300">
                      {n.section}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-slate-600 dark:text-slate-300">{n.surface}</td>
                    <td className="px-2 py-2 text-right font-semibold tabular-nums text-slate-800 dark:text-slate-100">
                      {n.maxDepthPct.toFixed(1)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-slate-600 dark:text-slate-300">
                      {n.length.toFixed(0)}
                    </td>
                    <td
                      className={`px-2 py-2 text-right font-bold tabular-nums ${
                        n.ERF > 1
                          ? 'text-rose-600 dark:text-rose-400'
                          : n.ERF >= screening.reviewBandErf
                            ? 'text-amber-600 dark:text-amber-400'
                            : 'text-slate-800 dark:text-slate-100'
                      }`}
                    >
                      {formatErf(n.ERF)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-amber-600 dark:text-amber-400">
                      {formatErf(item.conservative.ERF)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-slate-600 dark:text-slate-300">
                      {n.safePressure.toFixed(3)}
                    </td>
                    <td className="px-2 py-2 text-center">
                      <SeverityBadge
                        severity={failed ? 'fail' : 'pass'}
                        label={failed ? 'Not acceptable' : 'Acceptable'}
                      />
                    </td>
                    <td
                      className={`px-2 py-2 text-right font-semibold tabular-nums ${
                        belowThreshold ? 'text-amber-600 dark:text-amber-400' : 'text-slate-700 dark:text-slate-200'
                      }`}
                    >
                      {formatRemnantLife(life)}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-center tabular-nums text-slate-500 dark:text-slate-400">
                      {life.dueDateIso ?? '—'}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-slate-500 dark:text-slate-400">
                      <span className="inline-flex items-center gap-1">
                        {remnantLimitLabel(life)}
                        {life.lengthHeldConstant && life.status === 'calculated' && (
                          <span
                            title="No axial length growth rate was established, so the projection holds the length constant."
                            className="rounded border border-slate-200 px-1 py-px text-[8px] font-bold uppercase tracking-wide text-slate-400 dark:border-slate-700"
                          >
                            L fixed
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-center">
                      <span className={`inline-flex rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${
                        n.repairStatus === 'permanent-repair-verified'
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800/60 dark:bg-emerald-950/30 dark:text-emerald-300'
                          : n.repairStatus === 'temporary-repair'
                            ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-300'
                            : 'border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400'
                      }`}>
                        {n.repairStatus === 'permanent-repair-verified'
                          ? 'Permanent'
                          : n.repairStatus === 'temporary-repair'
                            ? 'Temporary'
                            : 'None'}
                      </span>
                    </td>
                    <td className="max-w-[240px] truncate px-2 py-2 text-[11px]">
                      <DispositionCell item={item} />
                    </td>
                    <td className="px-2 py-2 text-center">
                      <PriorityLabel priority={item.priority} />
                    </td>
                  </tr>
                );
              })}

              {!pageRows.length && (
                <tr>
                  <td colSpan={COLUMNS.length} className="px-2 py-12 text-center text-slate-400">
                    No feature matches the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* Pagination */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Showing{' '}
          <span className="font-semibold tabular-nums text-slate-700 dark:text-slate-200">
            {filtered.length ? (safePage - 1) * PAGE_SIZE + 1 : 0}–
            {Math.min(safePage * PAGE_SIZE, filtered.length)}
          </span>{' '}
          of <span className="font-semibold tabular-nums">{filtered.length.toLocaleString()}</span> features
          {filtered.length !== items.length && ` (${items.length.toLocaleString()} total)`}
        </p>

        {totalPages > 1 && (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={safePage === 1}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors enabled:hover:border-indigo-400 enabled:hover:text-indigo-600 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300"
            >
              Previous
            </button>
            <span className="px-2 text-xs tabular-nums text-slate-500 dark:text-slate-400">
              {safePage} / {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={safePage === totalPages}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors enabled:hover:border-indigo-400 enabled:hover:text-indigo-600 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300"
            >
              Next
            </button>
          </div>
        )}
      </div>

      <Callout>
        Select any row to open the right-side calculation drawer. <strong>ERF cons.</strong> applies the ILI depth and
        length tolerance; where it crosses {screening.reviewBandErf.toFixed(2)} the disposition depends on
        inspection accuracy rather than the reported dimensions.
      </Callout>
    </div>
  );
}
