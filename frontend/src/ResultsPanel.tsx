import { useState, useMemo, useEffect, useRef, lazy, Suspense } from 'react';
import { FiSearch, FiFileText, FiMaximize, FiMinimize, FiActivity, FiColumns, FiX, FiDownload } from 'react-icons/fi';
import { apiFetch, apiUrl } from './utils/api';
import Modal from './components/common/Modal';
import { useToast } from './components/common/ToastProvider';
import {
  createAlignmentExportPayload,
  createAlignmentSessionExportPayload,
  waitForAlignmentExport,
  type AlignmentExportJob,
} from './utils/alignmentExport';
import {
  alignmentResultColumns,
  alignmentDisplayValue,
  depthGrowthMmPerYear,
  isClusteredAlignmentRow,
  MASTER_AXIS_COLUMN,
  MATCH_EVIDENCE_KEY,
  sortAlignmentRowsByMasterAxis,
  summarizeConservationAudit,
} from './utils/alignmentDisplay';
import { pofColumnTitle, pofMatchOutcome } from './domain/pof100';
import MatchEvidenceDrawer, { type MatchEvidence } from './components/comparison/MatchEvidenceDrawer';
import ShareSnapshotButton from './components/sharing/ShareSnapshotButton';
import { buildAlignmentShareState } from './lib/sharing/publicShareSnapshot';
import { sectionNameForComparisonRow } from './wizard/matchingSections';
import {
  exclusionTarget,
  includedInterventionRows,
  isExcludedRow,
  isMatchedRow,
} from './utils/interventions';
import ExclusionControls from './components/comparison/ExclusionControls';

const RAW_DEPTH_GROWTH_COLUMN = 'Depth Growth (%WT/yr)';
const DEPTH_GROWTH_COLUMN = 'Depth Growth (mm/yr)';

// Lazy load chart.js - heavy library, only load when Chart tab is selected
const LazyScatterChart = lazy(() =>
  Promise.all([
    import('react-chartjs-2'),
    import('chart.js').then(({ Chart, ArcElement, Tooltip, Legend, CategoryScale, LinearScale, PointElement, Title }) => {
      Chart.register(ArcElement, Tooltip, Legend, CategoryScale, LinearScale, PointElement, Title);
      return { default: null };
    })
  ]).then(([chartjs]) => ({
    default: ({ data }: { data: any[] }) => {
      const { Scatter } = chartjs;
      return (
        <Scatter
          options={{
            maintainAspectRatio: false,
            scales: {
              x: { title: { display: true, text: 'Depth Run 1 (mm)' } },
              y: { title: { display: true, text: 'Depth Run 2 (mm)' } }
            }
          }}
          data={{
            datasets: [{
              label: 'Depth Correlation',
              data: data.map((r: any) => ({
                x: parseFloat(r['Depth OLD (%WT)']) || 0,
                y: parseFloat(r['Depth NEW (%WT)']) || 0
              })).filter((p: any) => p.x > 0 && p.y > 0),
              backgroundColor: '#3b82f6'
            }]
          }}
        />
      );
    }
  }))
);

interface ResultsPanelProps {
  data: any;
  loading: boolean;
  readOnly?: boolean;
  onOpenAnalytics?: () => void;
  selectedRowIdx?: number | null;
  onSelectRowIdx?: (idx: number | null) => void;
  onUpdateMatch?: (sourceIdx: number, targetIdx: number) => void;
  onExcludeSingle?: (rowIdx: number) => Promise<void> | void;
  /** Exclude every marked row in one reviewer action. */
  onExcludeMany?: (rowIdxs: number[]) => Promise<void> | void;
  onExcludeRange?: (startRowIdx: number, endRowIdx: number) => Promise<void> | void;
  onRestoreExclusion?: (rowIdxs: number | number[]) => Promise<void> | void;
  /** Break the marked matches back into their OLD-only and NEW-only rows. */
  onUnassign?: (rowIdxs: number[]) => Promise<void> | void;
  audit?: {
    isConserved?: boolean;
    old?: { inputCount?: number; outputReferences?: number };
    new?: { inputCount?: number; outputReferences?: number };
    pairs?: Array<{
      isConserved?: boolean;
      old?: { inputCount?: number; outputReferences?: number };
      new?: { inputCount?: number; outputReferences?: number };
    }>;
  };
  exportData?: any[];
  pipelineData?: Record<string, unknown>;
  sessionId?: string;
  /** The completed run behind these rows; a published link names it. */
  jobId?: string;
  interventions?: unknown[];
  /**
   * Section names for the Section column. The page supplies them so a read-only
   * viewer, who cannot call the authenticated session endpoint, still sees them.
   */
  sections?: unknown[];
  /**
   * Feature classes the Feature rules step switched off. The rows are already
   * gone from `data` by the time they get here; this is carried only so a
   * published link freezes the same visibility the author was reading.
   */
  hiddenFeatures?: string[];
}

/** Parse a clock value to hours (0..12) regardless of format ("HH:MM" or Excel serial fraction). */
function parseClockHours(val: unknown): number {
  if (val == null || val === '-') return 0;
  const s = String(val).trim();
  if (s.includes(':')) {
    const [h, m] = s.split(':').map(Number);
    return (h % 12) + (m || 0) / 60;
  }
  const n = parseFloat(s);
  if (isNaN(n)) return 0;
  // Excel time serial: fraction of 24-hour day
  if (n > 0 && n < 1) return (n * 24) % 12;
  return n % 12;
}

/** Format a clock value for display — convert Excel time serials to HH:MM. */
function formatClockDisplay(val: unknown): string {
  if (val == null || val === '-' || val === '') return '-';
  const s = String(val).trim();
  if (s.toLowerCase() === 'null' || s.toLowerCase() === 'nan' || s.toLowerCase() === 'undefined' || s === '-') return '-';
  if (s.includes(':')) return s; // already formatted
  const n = typeof val === 'number' ? val : parseFloat(s);
  if (isNaN(n)) return s;
  if (n > 0 && n < 1) {
    const totalHours = n * 24;
    let h = Math.floor(totalHours);
    let m = Math.round((totalHours - h) * 60);
    if (m === 60) { h += 1; m = 0; }
    if (h === 0) h = 12;
    return `${h}:${String(m).padStart(2, '0')}`;
  }
  return s;
}

// Footer showing total row count (replaces pagination). Kept at module scope:
// declaring it inside ResultsPanel gave it a new component identity every
// render, remounting the subtree each time.
const PaginationFooter = ({ totalRows, hasActiveFilters, onClearFilters }: {
  totalRows: number;
  hasActiveFilters: boolean;
  onClearFilters: () => void;
}) => (
  <div className="flex justify-between items-center" style={{ minHeight: '2.25rem', borderTop: '1px solid var(--syn-line)', background: 'var(--syn-surface)', padding: '0.4rem 0.75rem', color: 'var(--syn-muted)', font: '0.68rem var(--syn-font-data)' }}>
    <span>Total: {totalRows} rows</span>
    {hasActiveFilters && (
      <button onClick={onClearFilters} className="text-xs hover:underline font-bold" style={{ color: 'var(--syn-danger)' }}>
        Clear all filters
      </button>
    )}
  </div>
);

const ProbabilityModal = ({ sourceRow, targetRow, movingSide = 'NEW', onConfirm, onCancel }: { sourceRow: any, targetRow: any, movingSide?: 'OLD' | 'NEW', onConfirm: () => void, onCancel: () => void }) => {
  if (!sourceRow || !targetRow) return null;

  // The moving side always lives on the source row and the anchor side on the
  // target, whichever direction the reviewer is repairing the pair in.
  const anchorSide = movingSide === 'NEW' ? 'OLD' : 'NEW';
  const dDist = Math.abs((parseFloat(targetRow[`Log Dist ${anchorSide} (m)`]) || 0) - (parseFloat(sourceRow[`Log Dist ${movingSide} (m)`]) || 0));
  const dDepth = Math.abs((parseFloat(targetRow[`Depth ${anchorSide} (%WT)`]) || 0) - (parseFloat(sourceRow[`Depth ${movingSide} (%WT)`]) || 0));
  const dLength = Math.abs((parseFloat(targetRow[`Length ${anchorSide} (mm)`]) || 0) - (parseFloat(sourceRow[`Length ${movingSide} (mm)`]) || 0));
  const dWidth = Math.abs((parseFloat(targetRow[`Width ${anchorSide} (mm)`]) || 0) - (parseFloat(sourceRow[`Width ${movingSide} (mm)`]) || 0));
  const oClockAnchor = parseClockHours(targetRow[`O'Clock ${anchorSide}`]);
  const oClockMoved = parseClockHours(sourceRow[`O'Clock ${movingSide}`]);
  let dClock = Math.abs(oClockAnchor - oClockMoved);
  if (dClock > 6) dClock = 12 - dClock;
  
  // Gaussian likelihoods
  const likelihoodDist = Math.exp(-Math.pow(dDist, 2) / (2 * Math.pow(0.5, 2))); 
  const likelihoodDepth = Math.exp(-Math.pow(dDepth, 2) / (2 * Math.pow(10, 2))); 
  const likelihoodLength = Math.exp(-Math.pow(dLength, 2) / (2 * Math.pow(20, 2))); 
  const likelihoodWidth = Math.exp(-Math.pow(dWidth, 2) / (2 * Math.pow(20, 2))); 
  const likelihoodClock = Math.exp(-Math.pow(dClock, 2) / (2 * Math.pow(1, 2))); 
  
  const typeMatch = targetRow[`Feature Type ${anchorSide}`] === sourceRow[`Feature Type ${movingSide}`] ? 1.0 : 0.001;

  const pMatch = likelihoodDist * likelihoodDepth * likelihoodLength * likelihoodWidth * likelihoodClock * typeMatch;
  const pUnmatch = 0.05; 
  const confidence = Math.min(100, Math.max(0, (pMatch / (pMatch + pUnmatch)) * 100));
  
  let recommendation = "Not Recommended";
  let color = "text-red-600";
  if (confidence > 80) { recommendation = "Highly Recommended Match"; color = "text-green-600"; }
  else if (confidence > 50) { recommendation = "Possible Match"; color = "text-yellow-600"; }

  return (
    <Modal
      onClose={onCancel}
      labelledBy="probability-modal-title"
      overlayClassName="fixed inset-0 bg-black/50 z-[999999] flex items-center justify-center p-4"
      panelClassName="bg-white rounded-lg shadow-xl max-w-lg w-full p-6 animate-fade-in"
    >
        <div className="flex justify-between items-center mb-4">
          <h3 id="probability-modal-title" className="text-lg font-bold text-gray-800">Match Probability Analysis</h3>
          <button onClick={onCancel} aria-label="Close match probability analysis" className="text-gray-400 hover:text-gray-600"><FiX size={24} /></button>
        </div>
        
        <div className="bg-blue-50 p-4 rounded-lg mb-6 border border-blue-100">
          <div className="flex justify-between items-end mb-2">
            <span className="text-sm font-semibold text-blue-800">Naive Bayes Confidence</span>
            <span className={`text-2xl font-black ${color}`}>{confidence.toFixed(1)}%</span>
          </div>
          <div className={`text-xs font-bold px-2 py-1 inline-block rounded bg-white border ${color.replace('text', 'border')}`}>
            {recommendation}
          </div>
        </div>

        <div className="space-y-3 text-sm mb-6">
          <div className="flex justify-between border-b border-gray-100 pb-1">
            <span className="text-gray-500">Distance Diff (Δm)</span>
            <span className="font-bold">{dDist.toFixed(3)} m</span>
          </div>
          <div className="flex justify-between border-b border-gray-100 pb-1">
            <span className="text-gray-500">Δ Depth [%t]</span>
            <span className="font-bold">{dDepth.toFixed(1)} %t</span>
          </div>
          <div className="flex justify-between border-b border-gray-100 pb-1">
            <span className="text-gray-500">Dimensions Diff (ΔL/W)</span>
            <span className="font-bold">{dLength.toFixed(1)} / {dWidth.toFixed(1)} mm</span>
          </div>
          <div className="flex justify-between border-b border-gray-100 pb-1">
            <span className="text-gray-500">Clock Diff (Δhr)</span>
            <span className="font-bold">{dClock.toFixed(1)} hr</span>
          </div>
          <div className="flex justify-between pb-1">
            <span className="text-gray-500">Feature Match</span>
            <span className="font-bold">{targetRow[`Feature Type ${anchorSide}`] || '-'} vs {sourceRow[`Feature Type ${movingSide}`] || '-'}</span>
          </div>
        </div>

        <div className="flex gap-3 justify-end mt-4">
          <button onClick={onCancel} className="px-4 py-2 rounded text-gray-600 hover:bg-gray-100 font-medium">Cancel</button>
          <button onClick={onConfirm} className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-700 text-white font-bold shadow-sm">Confirm Match</button>
        </div>
    </Modal>
  );
};

/** True when the row carries a usable value under the given key. */
const hasRowValue = (row: any, key: string) => {
  const value = row?.[key];
  return value !== undefined && value !== null && value !== '' && value !== '-';
};

/**
 * Keyboard path for match reassignment: lists the rows that have no partner on
 * the moving side as targets for the chosen row. Picking one routes through the
 * same ProbabilityModal -> onUpdateMatch path the mouse drag-and-drop uses.
 *
 * It works in both directions. A NEW orphan is carried onto an OLD row, and an
 * OLD orphan onto a NEW row — the reviewer decides which half of the pair is
 * the one in the wrong place, and the engine's result never gets to decide it
 * for them.
 */
const ReassignDialog = ({ sourceRow, movingSide, candidates, onPick, onCancel }: {
  sourceRow: any;
  movingSide: 'OLD' | 'NEW';
  candidates: any[];
  onPick: (targetRow: any) => void;
  onCancel: () => void;
}) => {
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const anchorSide = movingSide === 'NEW' ? 'OLD' : 'NEW';

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return candidates;
    return candidates.filter((row) => [`Source Key ${anchorSide}`, `Identif. ${anchorSide}`, `Log Dist ${anchorSide} (m)`, `Feature Type ${anchorSide}`]
      .some((key) => row[key] !== undefined && row[key] !== null && String(row[key]).toLowerCase().includes(needle)));
  }, [anchorSide, candidates, query]);
  const visible = filtered.slice(0, 100);

  const sourceLabel = String(sourceRow?.[`Identif. ${movingSide}`] ?? sourceRow?.[`Source Key ${movingSide}`] ?? '-');
  const sourceDist = sourceRow?.[`Log Dist ${movingSide} (m)`];

  return (
    <Modal
      onClose={onCancel}
      labelledBy="reassign-dialog-title"
      initialFocusRef={searchRef}
      overlayClassName="fixed inset-0 bg-black/50 z-[999999] flex items-center justify-center p-4"
      panelClassName="bg-white rounded-lg shadow-xl max-w-xl w-full p-6 flex flex-col max-h-[80vh]"
    >
      <div className="flex justify-between items-center mb-1">
        <h3 id="reassign-dialog-title" className="text-lg font-bold text-gray-800">Reassign {movingSide} feature</h3>
        <button onClick={onCancel} aria-label="Close reassign dialog" className="text-gray-400 hover:text-gray-600"><FiX size={22} /></button>
      </div>
      <p className="text-sm text-gray-500 mb-3">
        {movingSide} <span className="font-semibold text-gray-700">{sourceLabel}</span>
        {typeof sourceDist === 'number' ? ` at ${sourceDist.toFixed(3)} m` : ''} — choose the unmatched {anchorSide} feature it belongs to.
      </p>
      <input
        ref={searchRef}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by Source Key, ID, or distance..."
        aria-label={`Search unmatched ${anchorSide} features by source key, identifier, or distance`}
        className="mb-3 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
      />
      {visible.length === 0 ? (
        <p className="py-6 text-center text-sm text-gray-400">No unmatched {anchorSide} features match this search.</p>
      ) : (
        <ul className="flex-1 overflow-y-auto divide-y divide-gray-100 border border-gray-100 rounded-md" aria-label={`Candidate ${anchorSide} features`}>
          {visible.map((row) => (
            <li key={row.__origIdx}>
              <button
                type="button"
                onClick={() => onPick(row)}
                className="w-full px-3 py-2 text-left text-sm hover:bg-blue-50 focus:bg-blue-50 focus:outline-none"
              >
                <span className="font-semibold text-gray-800">{String(row[`Identif. ${anchorSide}`] ?? row[`Source Key ${anchorSide}`] ?? '-')}</span>
                <span className="ml-2 text-gray-500">
                  {typeof row[`Log Dist ${anchorSide} (m)`] === 'number' ? `${row[`Log Dist ${anchorSide} (m)`].toFixed(3)} m` : String(row[`Log Dist ${anchorSide} (m)`] ?? '')}
                </span>
                {hasRowValue(row, `Feature Type ${anchorSide}`) && (
                  <span className="ml-2 text-xs text-gray-400">{String(row[`Feature Type ${anchorSide}`])}</span>
                )}
                {hasRowValue(row, `Depth ${anchorSide} (%WT)`) && (
                  <span className="ml-2 text-xs text-gray-400">{String(row[`Depth ${anchorSide} (%WT)`])} %t</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      {filtered.length > visible.length && (
        <p className="mt-2 text-xs text-gray-400">Showing the first {visible.length} of {filtered.length} candidates — refine the search to narrow down.</p>
      )}
    </Modal>
  );
};

export default function ResultsPanel({
  data: rawData,
  loading,
  readOnly = false,
  onOpenAnalytics,
  selectedRowIdx,
  onSelectRowIdx,
  onUpdateMatch,
  onExcludeSingle,
  onExcludeMany,
  onExcludeRange,
  onRestoreExclusion,
  onUnassign,
  audit,
  exportData,
  pipelineData,
  sessionId = '',
  jobId = '',
  interventions: interventionsProp,
  sections: sectionsProp,
  hiddenFeatures = [],
}: ResultsPanelProps) {
  const data = useMemo(() => {
    let flattened: any[] = [];
    if (Array.isArray(rawData)) {
       flattened = rawData.map((row: any) => ({
         ...row,
         __resultGroup: String(row['Result Group'] || '').toUpperCase(),
       }));
    } else if (rawData && typeof rawData === 'object') {
       flattened = [
          ...(rawData.gw_locked || []).map((row: any) => ({ ...row, __resultGroup: 'GW' })),
          ...(rawData.gw_unmatched || []).map((row: any) => ({ ...row, __resultGroup: 'GW' })),
          ...(rawData.fitting_matched || []).map((row: any) => ({ ...row, __resultGroup: 'FITTING' })),
          ...(rawData.anomaly_matched || []).map((row: any) => ({ ...row, __resultGroup: 'ANOMALY' })),
          ...(rawData.anomaly_only_old || []).map((row: any) => ({ ...row, __resultGroup: 'ANOMALY' })),
          ...(rawData.anomaly_only_new || []).map((row: any) => ({ ...row, __resultGroup: 'ANOMALY' })),
          ...(rawData.bypassed_old || []).map((row: any) => ({ ...row, __resultGroup: 'BYPASSED' })),
          ...(rawData.bypassed_new || []).map((row: any) => ({ ...row, __resultGroup: 'BYPASSED' })),
          ...(rawData.filtered_old || []).map((row: any) => ({ ...row, __resultGroup: 'FILTERED' })),
          ...(rawData.filtered_new || []).map((row: any) => ({ ...row, __resultGroup: 'FILTERED' })),
       ];
    }
    // Tag every row with its index in the incoming (unsorted) array BEFORE any
    // sorting. This is the row's stable identity: selection, defect-viewer
    // highlighting, and onUpdateMatch all report it, and the parent
    // (IliComparisonPage) maps it straight back onto the rows it passed in.
    flattened.forEach((row, idx) => { row.__origIdx = idx; });
    // Use the same canonical master axis as the aligned viewer. Reported OLD
    // and NEW LDs remain visible, but unmatched rows from both runs interleave
    // at their physical TIE-in positions instead of forming separate blocks.
    return sortAlignmentRowsByMasterAxis(flattened);
  }, [rawData]);

  const toast = useToast();
  const [isExporting, setIsExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState('');
  const [activeTab, setActiveTab] = useState('Results');
  const [radioFilter, setRadioFilter] = useState('All');
  const [unmatchedOld, setUnmatchedOld] = useState(false);
  const [unmatchedNew, setUnmatchedNew] = useState(false);
  
  // Sections state, seeded from the page and refreshed from the session when
  // this panel is being used by a signed-in reviewer.
  const [sections, setSections] = useState<any[]>(() => (sectionsProp as any[]) ?? []);
  
  const summaryCounts = useMemo(() => {
    if (rawData && !Array.isArray(rawData)) {
      return {
        gwLocked: rawData.gw_locked?.length || 0,
        gwUnmatched: rawData.gw_unmatched?.length || 0,
        fittingMatched: rawData.fitting_matched?.length || 0,
        anomalyMatched: rawData.anomaly_matched?.length || 0,
        anomalyOnlyOld: rawData.anomaly_only_old?.length || 0,
        anomalyOnlyNew: rawData.anomaly_only_new?.length || 0,
        bypassedOld: rawData.bypassed_old?.length || 0,
        bypassedNew: rawData.bypassed_new?.length || 0,
        filteredOld: rawData.filtered_old?.length || 0,
        filteredNew: rawData.filtered_new?.length || 0,
      };
    }
    return null;
  }, [rawData]);

  // Drag & Drop Match State. The dragged side travels with the row: dragging a
  // NEW cell offers that NEW feature to an OLD row, and an OLD cell the reverse.
  const [dragged, setDragged] = useState<{ rowIdx: number; movingSide: 'OLD' | 'NEW' } | null>(null);
  const [modalState, setModalState] = useState<{ isOpen: boolean, sourceRow: any, targetRow: any, movingSide: 'OLD' | 'NEW' }>({ isOpen: false, sourceRow: null, targetRow: null, movingSide: 'NEW' });
  // Keyboard path for reassignment: the row being reassigned, and which of its
  // two sides is the one that moves.
  const [reassignSource, setReassignSource] = useState<{ row: any; movingSide: 'OLD' | 'NEW' } | null>(null);
  // Rows marked for a bulk action, addressed by the stable `__origIdx`.
  const [markedRowIdxs, setMarkedRowIdxs] = useState<number[]>([]);
  // Same rows a drop can land on and pass the parent's validation: a feature
  // that has no partner yet on the side that is moving.
  const reassignCandidates = useMemo(() => {
    if (!reassignSource) return [];
    const anchor = reassignSource.movingSide === 'NEW' ? 'OLD' : 'NEW';
    const moving = reassignSource.movingSide;
    return data
      .filter((row: any) => !isExcludedRow(row)
        && !isClusteredAlignmentRow(row)
        && (hasRowValue(row, `Source Key ${anchor}`) || hasRowValue(row, `Identif. ${anchor}`))
        && !hasRowValue(row, `Source Key ${moving}`) && !hasRowValue(row, `Identif. ${moving}`))
      .sort((a: any, b: any) => (parseFloat(a[`Log Dist ${anchor} (m)`]) || 0) - (parseFloat(b[`Log Dist ${anchor} (m)`]) || 0));
  }, [data, reassignSource]);

  // Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [distanceStart, setDistanceStart] = useState('');
  const [distanceEnd, setDistanceEnd] = useState('');

  // Full screen state
  const [isFullScreen, setIsFullScreen] = useState(false);
  const auditSummary = useMemo(() => summarizeConservationAudit(audit), [audit]);
  const resultRowCount = Array.isArray(exportData) ? exportData.length : data.length;

  const tabs = readOnly
    ? ['Results', 'ILI Run 1', 'ILI Run 2']
    : ['Results', 'ILI Run 1', 'ILI Run 2', 'Interventions', 'Excluded'];
  
  // Dynamic columns state
  const [showColumnFilter, setShowColumnFilter] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState<string[]>([]);
  const [draggedColumn, setDraggedColumn] = useState<string | null>(null);

  const handleColumnDrop = (targetCol: string) => {
    if (!draggedColumn || draggedColumn === targetCol) return;
    const newCols = [...visibleColumns];
    const fromIdx = newCols.indexOf(draggedColumn);
    const toIdx = newCols.indexOf(targetCol);
    if (fromIdx !== -1 && toIdx !== -1) {
      newCols.splice(fromIdx, 1);
      newCols.splice(toIdx, 0, draggedColumn);
      setVisibleColumns(newCols);
    }
    setDraggedColumn(null);
  };
  // The per-pair calculation behind a matched row, opened from the row itself.
  // Held as its own state rather than folded into row selection: selecting a row
  // drives the charts and the intervention controls, and a reviewer reading the
  // arithmetic should not disturb either.
  const [evidenceRow, setEvidenceRow] = useState<any | null>(null);
  const [colWidths, setColWidths] = useState<Record<string, number>>({});
  const [sortConfig, setSortConfig] = useState<{key: string, direction: 'asc'|'desc'} | null>(null);
  const [filterConfig, setFilterConfig] = useState<Record<string, string>>({});
  const [filterInput, setFilterInput] = useState<Record<string, string>>({});
  const columnMenuRef = useRef<HTMLDivElement>(null);

  // Virtual scroll state
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(800); // fallback until measured
  const ROW_HEIGHT = 22; // px per row — keep in sync with .results-table td height in synapse-tokens.css
  const OVERSCAN = 10; // extra rows to render above/below viewport

  // Extract all columns
  const allColumns = useMemo(() => {
    const schemaRows = Array.isArray(exportData) && exportData.length > 0 ? exportData : data;
    if (schemaRows.length > 0) {
      const keys = alignmentResultColumns(schemaRows).filter(k => k !== RAW_DEPTH_GROWTH_COLUMN);
      // Add computed columns at the end
      for (const computed of [MASTER_AXIS_COLUMN, DEPTH_GROWTH_COLUMN, 'Length Growth (mm/yr)', 'Physics Warning']) {
        if (!keys.includes(computed)) keys.push(computed);
      }
      return ['Section', ...keys.filter((key) => key !== 'Section')];
    }
    return ['Section'];
  }, [data, exportData]);

  // The column that hosts the per-row "Reassign…" and "Unassign" affordances.
  // It is the first visible column rather than a NEW-side one: an OLD orphan
  // has to be reachable too, and it carries no NEW cell to hang a button on.
  const actionColumn = useMemo(
    () => visibleColumns.filter((c) => allColumns.includes(c))[0],
    [visibleColumns, allColumns],
  );

  useEffect(() => {
    setSections((current) => (Array.isArray(sectionsProp) && sectionsProp.length > 0
      ? sectionsProp as any[]
      : current));
  }, [sectionsProp]);

  // Fetch sections
  useEffect(() => {
    if (readOnly) return;
    const fetchSections = async () => {
      try {
        if (sessionId) {
          const sessData = await apiFetch<{ config?: { sections?: any[]; matchingSections?: any[] } }>(`/api/wizard/session/${encodeURIComponent(sessionId)}`);
          const configuredSections = sessData.config?.matchingSections?.length
            ? sessData.config.matchingSections
            : sessData.config?.sections;
          if (configuredSections) setSections(configuredSections);
        }
      } catch (err) {
        console.error("Failed to fetch sections:", err);
      }
    };
    fetchSections();
  }, [readOnly, sessionId]);

  // Set specific important columns visible by default when data loads
  useEffect(() => {
    if (allColumns.length > 0 && visibleColumns.length === 0) {
      const defaultCols = [
        'Match/Unmatch',
        'Section',
        'Identif. OLD', 'Identif. NEW',
        'Log Dist OLD (m)', 'Log Dist NEW (m)',
        MASTER_AXIS_COLUMN,
        'Feature Type OLD', 'Feature Type NEW',
        'Depth OLD (%WT)', 'Depth NEW (%WT)',
        'Length OLD (mm)', 'Length NEW (mm)',
        'Width OLD (mm)', 'Width NEW (mm)',
        "O'Clock OLD", "O'Clock NEW",
        DEPTH_GROWTH_COLUMN, 'Length Growth (mm/yr)', 'Physics Warning'
      ];
      // Only include columns that actually exist in allColumns to be safe
      setVisibleColumns(defaultCols.filter(col => allColumns.includes(col)));
    }
  }, [allColumns, visibleColumns.length]);

  // Debounce filter inputs - delay 300ms before applying
  useEffect(() => {
    const timer = setTimeout(() => {
      setFilterConfig(filterInput);
    }, 300);
    return () => clearTimeout(timer);
  }, [filterInput]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (columnMenuRef.current && !columnMenuRef.current.contains(event.target as Node)) {
        setShowColumnFilter(false);
      }
    };
    if (showColumnFilter) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showColumnFilter]);

  const toggleColumn = (col: string) => {
    if (visibleColumns.includes(col)) {
      setVisibleColumns(visibleColumns.filter(c => c !== col));
    } else {
      setVisibleColumns([...visibleColumns, col]);
    }
  };

  const resetColumns = () => {
    const defaultCols = [
      'Match/Unmatch',
      'Section',
      'Identif. OLD', 'Identif. NEW',
      'Log Dist OLD (m)', 'Log Dist NEW (m)',
      MASTER_AXIS_COLUMN,
      'Feature Type OLD', 'Feature Type NEW',
      'Depth OLD (%WT)', 'Depth NEW (%WT)',
      'Length OLD (mm)', 'Length NEW (mm)',
      'Width OLD (mm)', 'Width NEW (mm)',
      "O'Clock OLD", "O'Clock NEW",
      DEPTH_GROWTH_COLUMN, 'Length Growth (mm/yr)', 'Physics Warning'
    ];
    setVisibleColumns(defaultCols.filter(col => allColumns.includes(col)));
    setColWidths({});
  };

  const getFeatureColor = (val: string, isMatched: boolean) => {
    if (!val || val === '-') return '';
    const v = val.toLowerCase();
    let bg = '';
    if (v.includes('valve')) {
      bg = isMatched ? 'bg-purple-100 text-purple-800' : 'bg-purple-50 text-purple-600 border border-purple-200 border-dashed';
    } else if (v.includes('weld')) {
      bg = isMatched ? 'bg-blue-100 text-blue-800' : 'bg-blue-50 text-blue-600 border border-blue-200 border-dashed';
    } else if (v.includes('metal loss') || v.includes('corrosion')) {
      bg = isMatched ? 'bg-red-100 text-red-800' : 'bg-red-50 text-red-600 border border-red-200 border-dashed';
    } else {
      bg = isMatched ? 'bg-gray-100 text-gray-800' : 'bg-gray-50 text-gray-500 border border-gray-200 border-dashed';
    }
    return `font-medium rounded px-1.5 py-0.5 inline-block text-[10px] ${bg}`;
  };

  
  // 1. Process alignment data (rows already carry their stable __origIdx)
  const processedData = useMemo(() => {
    return (data || []).map((row: any) => {
      const d1 = parseFloat(row['Depth OLD (%WT)']);
      const d2 = parseFloat(row['Depth NEW (%WT)']);
      const oldYear = Number(row['Run Year OLD']);
      const newYear = Number(row['Run Year NEW']);
      const yearSpan = Number.isFinite(oldYear) && Number.isFinite(newYear) && newYear > oldYear
        ? newYear - oldYear
        : null;
      const depthGrowthPct = row[RAW_DEPTH_GROWTH_COLUMN] ?? (
        yearSpan && !isNaN(d1) && !isNaN(d2) ? ((d2 - d1) / yearSpan).toFixed(3) : '-'
      );
      const depthGrowth = depthGrowthMmPerYear({
        ...row,
        [RAW_DEPTH_GROWTH_COLUMN]: depthGrowthPct,
      });
      
      const l1 = parseFloat(row['Length OLD (mm)']);
      const l2 = parseFloat(row['Length NEW (mm)']);
      const lengthGrowth = row['Length Growth (mm/yr)'] ?? (
        yearSpan && !isNaN(l1) && !isNaN(l2) ? ((l2 - l1) / yearSpan).toFixed(3) : '-'
      );

      const sectionName = sectionNameForComparisonRow(row, sections);

      return {
        ...row,
        [DEPTH_GROWTH_COLUMN]: depthGrowth ?? '-',
        'Length Growth (mm/yr)': lengthGrowth,
        'Section': sectionName,
      };
    });
  }, [data, sections]);

  // 2. Filter data for view
  const filteredData = useMemo(() => {
    return processedData.filter((row: any) => {
      if (activeTab === 'Excluded') {
        if (!isExcludedRow(row)) return false;
      } else if (isExcludedRow(row)) {
        return false;
      }
      const run1 = row['Identif. OLD'];
      const run2 = row['Identif. NEW'];
      const dist1 = row['Log Dist OLD (m)'];
      const dist2 = row['Log Dist NEW (m)'];
      
      const isUnmatchedOld = run1 && run1 !== '-' && (!run2 || run2 === '-');
      const isUnmatchedNew = run2 && run2 !== '-' && (!run1 || run1 === '-');
      
      // Checkbox filters
      let typeInclude = true;
      if (unmatchedOld || unmatchedNew) {
        typeInclude = false;
        if (unmatchedOld && isUnmatchedOld) typeInclude = true;
        if (unmatchedNew && isUnmatchedNew) typeInclude = true;
      }
      
      if (!typeInclude) return false;

      // Radio filter for categories
      const resultGroup = String(row.__resultGroup || row['Result Group'] || '').toUpperCase();
      const oldFeatureType = String(row['Feature Type OLD'] || '').toLowerCase();
      const newFeatureType = String(row['Feature Type NEW'] || '').toLowerCase();
      const legacyGw = !resultGroup && [oldFeatureType, newFeatureType]
        .some((featureType) => ['weld', 'valve', 'tee', 'flange'].some((type) => featureType.includes(type)));
      const isGw = resultGroup === 'GW' || legacyGw;
      const isBypassed = resultGroup === 'BYPASSED' || ['Bypassed OLD', 'Bypassed NEW'].includes(row['Match/Unmatch']);

      if (radioFilter === 'GW') {
        if (!isGw) return false;
      } else if (radioFilter === 'Anomaly') {
        if (resultGroup ? resultGroup !== 'ANOMALY' : isGw || isBypassed) return false;
      } else if (radioFilter === 'Bypassed') {
        if (!isBypassed) return false;
      }
      
      // Distance filter
      if (radioFilter === 'Distance') {
        const start = parseFloat(distanceStart);
        const end = parseFloat(distanceEnd);
        if (!isNaN(start) && !isNaN(end)) {
          const d1In = typeof dist1 === 'number' && dist1 >= start && dist1 <= end;
          const d2In = typeof dist2 === 'number' && dist2 >= start && dist2 <= end;
          if (!d1In && !d2In) return false;
        }
      }
      
      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        if (!(run1?.toString().toLowerCase().includes(query) || run2?.toString().toLowerCase().includes(query))) {
          return false;
        }
      }
      
      // Column data filters
      for (const [key, value] of Object.entries(filterConfig)) {
        if (value) {
          const rowValue = alignmentDisplayValue(row, key);
          if (rowValue === undefined || rowValue === null || !rowValue.toString().toLowerCase().includes(value.toLowerCase())) {
            return false;
          }
        }
      }
      
      return true;
    });
  }, [processedData, activeTab, radioFilter, unmatchedOld, unmatchedNew, distanceStart, distanceEnd, searchQuery, filterConfig]);

  const sortedData = useMemo(() => {
    // No column chosen means the master-axis order `processedData` already
    // applied, which is the pipeline order.
    if (!sortConfig) return filteredData;
    return [...filteredData].sort((a, b) => {
      const aVal = alignmentDisplayValue(a, sortConfig.key);
      const bVal = alignmentDisplayValue(b, sortConfig.key);
      if (aVal === bVal) return 0;
      
      if (aVal === undefined || aVal === null || aVal === '-') return sortConfig.direction === 'asc' ? 1 : -1;
      if (bVal === undefined || bVal === null || bVal === '-') return sortConfig.direction === 'asc' ? -1 : 1;

      const aNum = parseFloat(aVal);
      const bNum = parseFloat(bVal);
      if (!isNaN(aNum) && !isNaN(bNum)) {
        return sortConfig.direction === 'asc' ? aNum - bNum : bNum - aNum;
      }
      
      const aStr = aVal.toString().toLowerCase();
      const bStr = bVal.toString().toLowerCase();
      if (aStr < bStr) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aStr > bStr) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
  }, [filteredData, sortConfig]);

  // The ILI Run tabs only render rows present in that run; windowing needs the
  // filtered list up front so the spacer math stays exact.
  const iliRows = useMemo(() => {
    const idKey = activeTab === 'ILI Run 1' ? 'Identif. OLD' : 'Identif. NEW';
    return sortedData.filter((row: any) => row[idKey] && row[idKey] !== '-');
  }, [sortedData, activeTab]);

  // Measure the scroll container so tall displays don't get blank rows below a
  // hardcoded window. Re-observe when the container remounts (chart view,
  // full-screen portal, tab switches).
  useEffect(() => {
    const container = tableContainerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect?.height;
      if (measured) setContainerHeight(measured);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [radioFilter, isFullScreen, activeTab]);

  // Each tab is a different virtual list; a stale scroll offset from the
  // previous tab would window past the end of the new one.
  useEffect(() => {
    if (tableContainerRef.current) tableContainerRef.current.scrollTop = 0;
    setScrollTop(0);
  }, [activeTab]);

  // Virtual scroll calculation (shared by the Results and ILI Run tabs)
  const virtualRowCount = (activeTab === 'ILI Run 1' || activeTab === 'ILI Run 2')
    ? iliRows.length
    : sortedData.length;
  const visibleRows = useMemo(() => {
    const startIdx = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
    const endIdx = Math.min(virtualRowCount - 1, Math.ceil((scrollTop + containerHeight) / ROW_HEIGHT) + OVERSCAN);
    return { startIdx, endIdx, totalHeight: virtualRowCount * ROW_HEIGHT };
  }, [scrollTop, virtualRowCount, ROW_HEIGHT, OVERSCAN, containerHeight]);

  // Auto scroll when selectedRowIdx changes
  useEffect(() => {
    if (selectedRowIdx !== null && selectedRowIdx !== undefined && tableContainerRef.current) {
      const idx = sortedData.findIndex((r: any) => r.__origIdx === selectedRowIdx);
      if (idx !== -1) {
        const targetScroll = Math.max(0, (idx * ROW_HEIGHT) - 200); // 200px offset from top
        tableContainerRef.current.scrollTop = targetScroll;
        setScrollTop(targetScroll);
      }
    }
  }, [selectedRowIdx, sortedData]);

  const exportToExcel = async () => {
    if (resultRowCount === 0) return;
    setIsExporting(true);
    setExportStatus('Starting export');
    try {
      const payload = sessionId
        ? createAlignmentSessionExportPayload(sessionId, pipelineData || {})
        // The session path is ordered by the server. This one ships rows from
        // the browser, so it has to put them on the master axis itself — the
        // workbook must read down the line either way.
        : createAlignmentExportPayload(
          sortAlignmentRowsByMasterAxis(
            includedInterventionRows(Array.isArray(exportData) ? exportData : data),
          ),
          pipelineData || {},
        );
      const response = await fetch(apiUrl('/api/alignment/export-excel'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        const message = typeof payload?.error === 'string'
          ? payload.error
          : payload?.error?.message;
        throw new Error(message || `Failed to generate Excel file (${response.status})`);
      }

      if (response.status === 202) {
        const queued = await response.json() as AlignmentExportJob;
        if (!queued.exportId) throw new Error('Export job did not return an identifier.');
        setExportStatus(queued.message || 'Preparing rows');
        await waitForAlignmentExport(
          async () => {
            const status = await apiFetch<AlignmentExportJob>(
              `/api/alignment/exports/${encodeURIComponent(queued.exportId)}`,
            );
            setExportStatus(status.message || 'Building workbook');
            return status;
          },
          () => new Promise((resolve) => window.setTimeout(resolve, 2_000)),
        );
        // Let the browser download manager stream large workbooks directly to
        // disk. Fetching a 500k-row file into a Blob would allocate another
        // ~140 MB in the page before the download even starts.
        const link = document.createElement('a');
        link.href = apiUrl(
          `/api/alignment/exports/${encodeURIComponent(queued.exportId)}/download`,
        );
        link.download = 'synapse_alignment_report.xlsx';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        return;
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', 'synapse_alignment_report.xlsx');
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Failed to export Excel:", err);
      toast.error(err instanceof Error ? err.message : 'Failed to export the Excel file.');
    } finally {
      setIsExporting(false);
      setExportStatus('');
    }
  };

  const excludedCount = useMemo(
    () => data.filter((row: any) => isExcludedRow(row)).length,
    [data],
  );
  const selectedRow = useMemo(
    () => data.find((row: any) => row.__origIdx === selectedRowIdx) ?? null,
    [data, selectedRowIdx],
  );

  // ─── Bulk marking ─────────────────────────────────────────────────────────
  // Marks address rows by `__origIdx`, so they survive sorting, filtering and
  // the virtual window; a mark made in one tab still means the same row in the
  // next. Rows that leave the result entirely are dropped on the way out.
  const showMarkColumn = !readOnly
    && (activeTab === 'Results' || activeTab === 'Interventions' || activeTab === 'Excluded');

  const toggleMarkedRow = (rowIdx: number) => {
    setMarkedRowIdxs((current) => (current.includes(rowIdx)
      ? current.filter((idx) => idx !== rowIdx)
      : [...current, rowIdx]));
  };

  const visibleRowIdxs = useMemo(
    () => sortedData.map((row: any) => row.__origIdx as number),
    [sortedData],
  );
  const markedInView = useMemo(
    () => markedRowIdxs.filter((idx) => visibleRowIdxs.includes(idx)),
    [markedRowIdxs, visibleRowIdxs],
  );
  const allInViewMarked = visibleRowIdxs.length > 0 && markedInView.length === visibleRowIdxs.length;
  const markedRows = useMemo(
    () => markedInView
      .map((idx) => data.find((row: any) => row.__origIdx === idx))
      .filter(Boolean) as any[],
    [data, markedInView],
  );

  const toggleMarkAllInView = () => {
    setMarkedRowIdxs((current) => (allInViewMarked
      ? current.filter((idx) => !visibleRowIdxs.includes(idx))
      : [...new Set([...current, ...visibleRowIdxs])]));
  };

  // A mark is a statement about a row that is on screen. Changing tab changes
  // which rows those are, so carrying marks across would act on rows the
  // reviewer can no longer see.
  useEffect(() => { setMarkedRowIdxs([]); }, [activeTab]);
  useEffect(() => {
    setMarkedRowIdxs((current) => {
      const live = current.filter((idx) => data.some((row: any) => row.__origIdx === idx));
      return live.length === current.length ? current : live;
    });
  }, [data]);

  const panelContent = (
    <div className={`results-panel ${isFullScreen ? "h-full w-full flex flex-col overflow-hidden" : "flex flex-col h-full overflow-hidden"}`}>

      {/* Tabs Header */}
      <div className="results-tabs flex justify-between pr-3">
        <div className="flex">
          {tabs.map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`results-tab px-5 py-3 text-sm font-medium transition-colors border-b-2 ${
                activeTab === tab
                  ? 'border-current'
                  : 'border-transparent'
              }`}
              style={activeTab === tab ? { color: 'var(--syn-info, #155eef)', background: 'var(--syn-surface-raised, #fff)' } : {}}
            >
              {tab === 'Excluded' ? `Excluded (${excludedCount})` : tab}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 relative">
          {!readOnly && (
            <ExclusionControls
              activeTab={activeTab}
              selectedRow={selectedRow}
              selectedRowIdx={selectedRowIdx ?? null}
              markedRowIdxs={markedInView}
              markedRows={markedRows}
              onClearMarks={() => setMarkedRowIdxs([])}
              onExcludeSingle={onExcludeSingle}
              onExcludeMany={onExcludeMany}
              onExcludeRange={onExcludeRange}
              onRestoreExclusion={onRestoreExclusion}
              onUnassign={onUnassign}
            />
          )}
          {activeTab === 'Results' && (
            <div ref={columnMenuRef}>
              <button
                onClick={() => setShowColumnFilter(!showColumnFilter)}
                className="syn-btn syn-btn--sm syn-btn--outline"
              >
                <FiColumns size={14} />
                Columns ({visibleColumns.length}/{allColumns.length})
              </button>

              {showColumnFilter && (
                <div className="absolute right-0 top-full mt-2 w-72 rounded-lg z-[999999] overflow-hidden flex flex-col max-h-[400px]"
                  style={{ background: 'var(--syn-surface-raised, #fff)', border: '1px solid var(--syn-line, #d4d9d0)', boxShadow: 'var(--syn-shadow)' }}>
                  <div className="p-3 flex justify-between items-center" style={{ borderBottom: '1px solid var(--syn-line, #d4d9d0)', background: 'var(--syn-surface, #fbfcf9)' }}>
                    <span className="font-bold text-sm" style={{ color: 'var(--syn-ink, #151711)' }}>Visible Columns</span>
                    <div className="flex gap-2">
                      <button onClick={() => setVisibleColumns(allColumns)} className="text-xs hover:underline font-medium" style={{ color: 'var(--syn-info, #155eef)' }}>All</button>
                      <span style={{ color: 'var(--syn-line-strong)' }}>|</span>
                      <button onClick={() => setVisibleColumns([])} className="text-xs hover:underline font-medium" style={{ color: 'var(--syn-muted, #727a6d)' }}>None</button>
                    </div>
                  </div>
                  <div className="overflow-y-auto p-2 flex-1 flex flex-col gap-0.5">
                    {allColumns.map(col => (
                      <label key={col} className="flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer text-sm" style={{ color: 'var(--syn-ink-soft)' }}>
                        <input
                          type="checkbox"
                          checked={visibleColumns.includes(col)}
                          onChange={() => toggleColumn(col)}
                        />
                        <span className="truncate flex-1" title={`${pofColumnTitle(col)} · engine field: ${col}`}>
                          {pofColumnTitle(col)}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          {/* The matching charts moved to Corrosion Analysis, where the rest of
              the analysis lives — this table is for reading rows, not plotting. */}
          {!readOnly && onOpenAnalytics && (
            <button onClick={onOpenAnalytics} className="ds-btn ds-btn--secondary ds-btn--sm">
              <FiActivity size={14} />
              Corrosion analysis
            </button>
          )}
          {!readOnly && (
            <>
              <button onClick={exportToExcel} disabled={isExporting || activeTab === 'Excluded'} className="syn-btn syn-btn--sm syn-btn--lime">
                <FiDownload size={14} />
                {isExporting ? (exportStatus || 'Exporting...') : 'Excel · 3 sheets'}
              </button>
              <ShareSnapshotButton
                kind="ILI_ALIGNMENT"
                title={`Final ILI alignment${sessionId ? ` · Session ${sessionId}` : ''}`}
                // The run comes first: naming it pins the link to the result
                // that was released, so re-running the alignment afterwards
                // cannot change what the recipient opens.
                sourceRef={jobId
                  ? `alignment-job:${jobId}`
                  : sessionId ? `alignment-session:${sessionId}` : undefined}
                disabled={!sessionId && !jobId}
                buildState={() => buildAlignmentShareState({
                  interventions: interventionsProp,
                  sections,
                  hiddenFeatures,
                })}
                summary={summaryCounts ? [
                  { label: 'GW locked', value: summaryCounts.gwLocked },
                  { label: 'Anomaly matched', value: summaryCounts.anomalyMatched },
                  { label: 'Anomaly missing', value: summaryCounts.anomalyOnlyOld },
                  { label: 'Anomaly new', value: summaryCounts.anomalyOnlyNew },
                ] : undefined}
                notes={[
                  'Final ILI comparison view, frozen to this alignment run. Open any row to inspect the shared evidence; editing is disabled.',
                ]}
                label="Share result"
              />
            </>
          )}
          <button
            onClick={() => setIsFullScreen(!isFullScreen)}
            className="syn-icon-button"
            title={isFullScreen ? "Exit Full Screen" : "Full Screen Data"}
            style={{ width: '2rem', height: '2rem' }}
          >
            {isFullScreen ? <FiMinimize size={15} /> : <FiMaximize size={15} />}
          </button>
        </div>
      </div>

      <div
        role="status"
        className={`results-evidence${auditSummary.state === 'warning' ? ' is-warning' : auditSummary.state === 'verified' ? ' is-verified' : ''}`}
      >
        <span className="results-evidence__status">
          {auditSummary.state === 'warning' ? 'Result integrity warning' : auditSummary.state === 'verified' ? 'Engine result verified' : 'Engine result loaded'}
        </span>
        <span>{resultRowCount.toLocaleString()} result rows</span>
        <span>{allColumns.length.toLocaleString()} visible fields available</span>
        {auditSummary.state !== 'unknown' && (
          <span>
            Source references OLD {auditSummary.old.outputReferences.toLocaleString()}/{auditSummary.old.inputCount.toLocaleString()}
            {' · '}
            NEW {auditSummary.new.outputReferences.toLocaleString()}/{auditSummary.new.inputCount.toLocaleString()}
            {auditSummary.pairCount > 1 ? ` · ${auditSummary.pairCount} run pairs` : ''}
          </span>
        )}
      </div>

      {!readOnly && modalState.isOpen && (
        <ProbabilityModal
          sourceRow={modalState.sourceRow}
          targetRow={modalState.targetRow}
          movingSide={modalState.movingSide}
          onCancel={() => setModalState({ isOpen: false, sourceRow: null, targetRow: null, movingSide: 'NEW' })}
          onConfirm={() => {
            if (onUpdateMatch) {
              onUpdateMatch(modalState.sourceRow.__origIdx, modalState.targetRow.__origIdx);
            }
            setModalState({ isOpen: false, sourceRow: null, targetRow: null, movingSide: 'NEW' });
          }}
        />
      )}

      {!readOnly && reassignSource !== null && (
        <ReassignDialog
          sourceRow={reassignSource.row}
          movingSide={reassignSource.movingSide}
          candidates={reassignCandidates}
          onCancel={() => setReassignSource(null)}
          onPick={(targetRow) => {
            // Route through the same confirmation modal the drop path uses.
            const sourceRow = reassignSource.row;
            setReassignSource(null);
            setModalState({ isOpen: true, sourceRow, targetRow, movingSide: reassignSource.movingSide });
          }}
        />
      )}

      {(activeTab === 'Results' || activeTab === 'ILI Run 1' || activeTab === 'ILI Run 2' || activeTab === 'Interventions' || activeTab === 'Excluded') && (
        <div className="flex flex-col h-full overflow-hidden text-sm relative">
          {/* Summary Dashboard */}
          {summaryCounts && (
            <div className="results-summary grid grid-cols-2 md:grid-cols-5 z-10" style={{ borderBottom: '1px solid var(--syn-line)' }}>
              <div>
                <span>Total Pairs Matched</span>
                <span>{summaryCounts.gwLocked + summaryCounts.fittingMatched + summaryCounts.anomalyMatched}</span>
                <span>({summaryCounts.gwLocked} GW + {summaryCounts.fittingMatched} Fitting + {summaryCounts.anomalyMatched} Anom)</span>
              </div>
              <div>
                <span>GW Unmatched</span>
                <span>{summaryCounts.gwUnmatched}</span>
              </div>
              {/* POF wording: a feature the OLD run reported and the NEW run did
                  not is missing; one only the NEW run reported is new. */}
              <div>
                <span>Missing</span>
                <span>{summaryCounts.anomalyOnlyOld}</span>
                <span>(OLD, not in NEW)</span>
              </div>
              <div>
                <span>New</span>
                <span>{summaryCounts.anomalyOnlyNew}</span>
                <span>(NEW, not in OLD)</span>
              </div>
              <div>
                <span>Not Compared</span>
                <span>{summaryCounts.bypassedOld + summaryCounts.bypassedNew}</span>
                <span>(Non-Anomaly)</span>
              </div>
            </div>
          )}

          {/* Filters */}
          <div className="results-filters flex flex-row flex-wrap items-center" style={{ borderBottom: '1px solid var(--syn-line)' }}>
            <div className="results-filter-group flex gap-1 items-center flex-wrap">
              {['All', 'GW', 'Anomaly', 'Bypassed', 'Distance', 'Chart'].map(f => (
                <label key={f} className="flex items-center gap-1.5 cursor-pointer">
                  <input type="radio" name="filter" checked={radioFilter === f} onChange={() => setRadioFilter(f)} />
                  <span>{f === 'GW' ? 'GWs' : f === 'Anomaly' ? 'Anomalies' : f === 'Bypassed' ? 'Not compared' : f}</span>
                </label>
              ))}
              {radioFilter === 'Distance' && (
                <div className="flex items-center gap-2 ml-1">
                  <span style={{ color: 'var(--syn-muted)' }}>Start:</span>
                  <input type="text" value={distanceStart} onChange={e => setDistanceStart(e.target.value)} aria-label="Distance filter start (m)" style={{ width: '5rem', minHeight: '1.75rem', padding: '0.25rem 0.5rem', fontSize: '0.75rem' }} />
                  <span style={{ color: 'var(--syn-muted)' }}>End:</span>
                  <input type="text" value={distanceEnd} onChange={e => setDistanceEnd(e.target.value)} aria-label="Distance filter end (m)" style={{ width: '5rem', minHeight: '1.75rem', padding: '0.25rem 0.5rem', fontSize: '0.75rem' }} />
                </div>
              )}
            </div>
            <div className="flex gap-1 items-center ml-auto" style={{ borderLeft: '1px solid var(--syn-line)', paddingLeft: '0.5rem' }}>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={unmatchedOld}
                  onChange={(e) => setUnmatchedOld(e.target.checked)}
                  aria-label="Show features the OLD run reported and the NEW run did not"
                />
                <span>Missing</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={unmatchedNew}
                  onChange={(e) => setUnmatchedNew(e.target.checked)}
                  aria-label="Show features only the NEW run reported"
                />
                <span>New</span>
              </label>
            </div>
          </div>

          {/* Toolbar */}
          <div className="results-toolbar flex justify-between items-center" style={{ borderBottom: '1px solid var(--syn-line)' }}>
            <div>
              <FiFileText size={16} />
              <button onClick={resetColumns} className="results-toolbar__reset syn-btn syn-btn--sm syn-btn--outline" style={{ minHeight: '1.75rem', fontSize: '0.68rem' }}>
                Reset Columns
              </button>
            </div>
            <div className="relative">
              <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--syn-muted)' }} />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search"
                aria-label="Search by OLD or NEW identifier"
              />
            </div>
          </div>

          {/* Chart View */}
          {radioFilter === 'Chart' ? (
             <div className="flex-1 p-8 overflow-auto bg-gray-50 flex items-center justify-center">
                <div className="w-full max-w-4xl bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
                  <h3 className="text-lg font-bold text-gray-800 mb-6">Filtered Depth Correlation</h3>
                  <div className="h-[400px]">
                    <Suspense fallback={<div className="flex items-center justify-center h-full text-gray-400 text-sm"><div className="w-6 h-6 border-4 border-blue-200 border-t-blue-500 rounded-full animate-spin mr-3" />Loading chart...</div>}>
                      <LazyScatterChart data={filteredData} />
                    </Suspense>
                  </div>
                </div>
             </div>
          ) : (
            <div 
              ref={tableContainerRef}
              className="flex-1 overflow-auto"
              onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
            >
              {(activeTab === 'Results' || activeTab === 'Interventions' || activeTab === 'Excluded') && (
                <table className="results-table w-max text-left border-collapse text-[10px] leading-tight table-fixed break-words min-w-full">
                  <thead className="sticky top-0 z-10">
                    <tr>
                      {showMarkColumn && (
                        <th className="px-1 py-2 text-center align-top" style={{ width: 30 }}>
                          <input
                            type="checkbox"
                            checked={allInViewMarked}
                            onChange={toggleMarkAllInView}
                            aria-label={allInViewMarked ? 'Clear every mark in this view' : 'Mark every row in this view'}
                            title={`Mark all ${sortedData.length.toLocaleString()} rows currently listed`}
                          />
                        </th>
                      )}
                      {visibleColumns.filter(c => allColumns.includes(c)).map((col, idx) => (
                        <th
                          key={idx}
                          draggable
                          onDragStart={(e) => {
                            setDraggedColumn(col);
                            e.dataTransfer.effectAllowed = 'move';
                          }}
                          onDragOver={(e) => {
                            e.preventDefault();
                            e.dataTransfer.dropEffect = 'move';
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            handleColumnDrop(col);
                          }}
                          style={{ width: colWidths[col] || 150 }}
                          title={col === MASTER_AXIS_COLUMN
                            ? 'Canonical TIE-in coordinate used to align and order OLD and NEW rows. POF 100 has no term for it; it is the newest run\'s log distance with the older runs projected onto it.'
                            : col === DEPTH_GROWTH_COLUMN
                              ? 'Converted from %t/year using NEW wall thickness (OLD when NEW is unavailable).'
                              // POF 100 terminology on screen, engine field on hover,
                              // so a filter or a support question can still name the
                              // key the payload actually carries.
                              : `POF 100 term. Engine field: ${col}`}
                          aria-sort={sortConfig?.key === col ? (sortConfig.direction === 'asc' ? 'ascending' : 'descending') : undefined}
                          className={`px-2 py-2 font-bold whitespace-nowrap relative group select-none ${draggedColumn === col ? 'opacity-50' : ''}`}
                        >
                          <div className="flex flex-col gap-1">
                            <button
                              type="button"
                              className="flex w-full justify-between items-center cursor-pointer hover:text-brand-600 focus:outline-none focus-visible:ring-1 focus-visible:ring-brand-500 rounded"
                              aria-label={`Sort by ${pofColumnTitle(col)}${sortConfig?.key === col ? (sortConfig.direction === 'asc' ? ', currently ascending' : ', currently descending') : ''}`}
                              onClick={() => {
                                let direction: 'asc' | 'desc' = 'asc';
                                if (sortConfig && sortConfig.key === col && sortConfig.direction === 'asc') direction = 'desc';
                                setSortConfig({ key: col, direction });
                              }}
                            >
                              <span>{pofColumnTitle(col)}</span>
                              <span aria-hidden="true" className="text-gray-400 text-[10px]">
                                {sortConfig?.key === col ? (sortConfig.direction === 'asc' ? '▲' : '▼') : '↕'}
                              </span>
                            </button>
                            <input
                              type="text"
                              placeholder="Filter..."
                              aria-label={`Filter ${pofColumnTitle(col)}`}
                              className="w-full border border-gray-300 rounded px-1 py-0.5 text-[10px] font-normal focus:outline-none focus:border-brand-500"
                              value={filterInput[col] || ''}
                              onChange={(e) => setFilterInput(prev => ({ ...prev, [col]: e.target.value }))}
                            />
                          </div>
                          <div 
                            onMouseDown={(e) => {
                              e.preventDefault();
                              const startX = e.pageX;
                              const startWidth = colWidths[col] || 150;
                              const onMouseMove = (moveEvent: MouseEvent) => {
                                const newWidth = Math.max(50, startWidth + (moveEvent.pageX - startX));
                                setColWidths(prev => ({ ...prev, [col]: newWidth }));
                              };
                              const onMouseUp = () => {
                                document.removeEventListener('mousemove', onMouseMove);
                                document.removeEventListener('mouseup', onMouseUp);
                              };
                              document.addEventListener('mousemove', onMouseMove);
                              document.addEventListener('mouseup', onMouseUp);
                            }}
                            className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize opacity-0 group-hover:opacity-100 hover:w-2 transition-all z-20"
                            style={{ background: 'var(--syn-accent-strong, #8b9f3d)' }}
                          />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr><td colSpan={visibleColumns.length + (showMarkColumn ? 1 : 0)} className="p-8 text-center text-gray-400">Loading data...</td></tr>
                    ) : sortedData.length === 0 ? (
                      <tr><td colSpan={visibleColumns.length + (showMarkColumn ? 1 : 0)} className="p-8 text-center text-gray-400">
                        {activeTab === 'Excluded'
                          ? 'Nothing has been excluded from this result yet.'
                          : 'No data matches the current filters'}
                      </td></tr>
                    ) : (
                      <>
                        {/* Spacer top */}
                        <tr style={{ height: visibleRows.startIdx * ROW_HEIGHT }}><td /></tr>
                        {sortedData.slice(visibleRows.startIdx, visibleRows.endIdx + 1).map((row: any, i: number) => {
                          const actualIdx = visibleRows.startIdx + i;
                          const isSelected = selectedRowIdx !== null && selectedRowIdx !== undefined && row.__origIdx === selectedRowIdx;
                          // Clusters are held out of alignment by the engine;
                          // the manual path must not put them back in.
                          const isClusterRow = isClusteredAlignmentRow(row);
                          // A drop only lands where the moving side is free —
                          // the parent refuses anything else, and lighting up a
                          // row that will be rejected is worse than not lighting.
                          const isDragTarget = activeTab === 'Interventions'
                            && dragged !== null
                            && dragged.rowIdx !== row.__origIdx
                            && !isClusterRow
                            && !hasRowValue(row, `Source Key ${dragged.movingSide}`)
                            && !hasRowValue(row, `Identif. ${dragged.movingSide}`);

                          const isMatch = row['Match/Unmatch'] === 'Matched' || row['Match/Unmatch'] === 'Match';
                          const featType = String(row['Feature Type OLD'] || row['Feature Type NEW'] || '').toLowerCase();
                          let rowClass = 'results-row';
                          if (isSelected) {
                            rowClass += ' results-row--selected';
                          } else if (isExcludedRow(row)) {
                            rowClass += ' opacity-60';
                          } else if (isMatch) {
                            if (featType.includes('valve')) rowClass += ' results-row--match-valve';
                            else if (featType.includes('weld')) rowClass += ' results-row--match-weld';
                            else if (featType.includes('bend')) rowClass += ' results-row--match-bend';
                            else if (featType.includes('flange')) rowClass += ' results-row--match-flange';
                            else if (featType.includes('tee')) rowClass += ' results-row--match-tee';
                            else if (featType.includes('anomaly') || featType.includes('metal') || featType.includes('dent') || featType.includes('corrosion')) rowClass += ' results-row--match-anomaly';
                            else rowClass += ' results-row--match-other';
                          }
                          const bgClass = '';

                          // Either orphan half can be carried onto a partner.
                          const movableSide: 'OLD' | 'NEW' | null = isClusterRow
                            ? null
                            : (exclusionTarget(row)?.side === 'NEW' ? 'NEW'
                              : exclusionTarget(row)?.side === 'OLD' ? 'OLD' : null);
                          const isReassignableSource = activeTab === 'Interventions' && movableSide !== null;
                          const isUnassignable = activeTab === 'Interventions'
                            && !isClusterRow
                            && isMatchedRow(row)
                            && hasRowValue(row, 'Source Key OLD')
                            && hasRowValue(row, 'Source Key NEW');
                          const isMarked = markedRowIdxs.includes(row.__origIdx);

                          return (
                            <tr
                              key={actualIdx}
                              style={{ height: ROW_HEIGHT }}
                              className={`${rowClass} group transition-colors cursor-pointer ${bgClass} ${isDragTarget ? 'results-row--drop-target' : ''}`}
                              onClick={() => onSelectRowIdx?.(row.__origIdx)}
                              onDragOver={(e) => {
                                if (!isDragTarget) return;
                                e.preventDefault(); // allow drop
                              }}
                              onDrop={(e) => {
                                if (!isDragTarget || !dragged) return;
                                e.preventDefault();
                                const sourceRow = sortedData.find((r: any) => r.__origIdx === dragged.rowIdx);
                                if (sourceRow) {
                                  setModalState({ isOpen: true, sourceRow, targetRow: row, movingSide: dragged.movingSide });
                                }
                                setDragged(null);
                              }}
                            >
                              {showMarkColumn && (
                                <td className="px-1 text-center" onClick={(e) => e.stopPropagation()}>
                                  <input
                                    type="checkbox"
                                    checked={isMarked}
                                    onChange={() => toggleMarkedRow(row.__origIdx)}
                                    aria-label={`Mark row ${String(row['Identif. NEW'] ?? row['Identif. OLD'] ?? actualIdx + 1)} for a bulk action`}
                                  />
                                </td>
                              )}
                              {visibleColumns.filter(c => allColumns.includes(c)).map((col, j) => {
                                let val = alignmentDisplayValue(row, col);
                                if (typeof val === 'string' && (val.toLowerCase() === 'null' || val.toLowerCase() === 'nan' || val.toLowerCase() === 'undefined')) {
                                  val = null;
                                }
                                const columnSide: 'OLD' | 'NEW' | null = col.includes('NEW') ? 'NEW' : col.includes('OLD') ? 'OLD' : null;
                                const isDraggableCol = activeTab === 'Interventions'
                                  && columnSide !== null
                                  && columnSide === movableSide;
                                // Only format computed columns; leave raw data values untouched
                                if ((col === DEPTH_GROWTH_COLUMN || col === 'Length Growth (mm/yr)') && val !== '-' && val != null && !isNaN(parseFloat(String(val)))) {
                                  val = parseFloat(String(val)).toFixed(3);
                                }
                                if (col === MASTER_AXIS_COLUMN && val !== '-' && val != null && !isNaN(Number(val))) {
                                  val = Number(val).toFixed(3);
                                }
                                // Convert O'Clock Excel time serial fractions to HH:MM
                                if (col.includes("O'Clock")) {
                                  val = formatClockDisplay(val);
                                }
                                // The run comparison cell already reads in POF wording; the badge
                                // colour follows the outcome behind that word, never its spelling.
                                const matchOutcome = col === 'Match/Unmatch' || col === 'Match Status'
                                  ? pofMatchOutcome(val)
                                  : null;
                                return (
                                  <td
                                    key={j}
                                    className={`px-2 whitespace-nowrap overflow-hidden text-ellipsis ${col === DEPTH_GROWTH_COLUMN || col === 'Length Growth (mm/yr)' ? 'font-bold' : ''} ${isDraggableCol ? 'cursor-grab active:cursor-grabbing' : ''}`}
                                    style={col === DEPTH_GROWTH_COLUMN || col === 'Length Growth (mm/yr)' ? { color: 'var(--syn-info, #155eef)' } : undefined}
                                    draggable={isDraggableCol && val !== '-' && val !== null && val !== undefined}
                                    onDragStart={(e) => {
                                      if (isDraggableCol && movableSide) {
                                        setDragged({ rowIdx: row.__origIdx, movingSide: movableSide });
                                        e.dataTransfer.effectAllowed = "move";
                                      }
                                    }}
                                    onDragEnd={() => setDragged(null)}
                                  >
                                    {val !== undefined && val !== null ? (
                                      (col === 'Feature Type OLD' || col === 'Feature Type NEW') ? (
                                        <span className={getFeatureColor(val, row['Identif. OLD'] !== '-' && row['Identif. NEW'] !== '-')}>{val}</span>
                                      ) : col === 'Section' && val !== '-' ? (
                                        <span className="bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wider">{val}</span>
                                      ) : matchOutcome ? (
                                        matchOutcome === 'matched' ? (
                                          <span className="bg-green-600 text-white font-extrabold px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider shadow-sm">{val}</span>
                                        ) : matchOutcome === 'missing' || matchOutcome === 'new' || matchOutcome === 'unmatched' ? (
                                          <span className="bg-red-600 text-white font-extrabold px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider shadow-sm">{val}</span>
                                        ) : val !== '-' ? (
                                          <span className="bg-gray-500 text-white font-semibold px-1.5 py-0.5 rounded text-[10px] tracking-wider shadow-sm">{val}</span>
                                        ) : '-'
                                      ) : val
                                    ) : ''}
                                    {col === 'Match/Unmatch' && row[MATCH_EVIDENCE_KEY] && (
                                      <button
                                        type="button"
                                        onClick={(e) => { e.stopPropagation(); setEvidenceRow(row); }}
                                        className="ml-1 inline-block align-middle rounded border border-slate-300 bg-white px-1 text-[9px] font-bold text-slate-700 opacity-0 transition-opacity focus:opacity-100 group-hover:opacity-100"
                                        aria-label={`Show the calculation behind the match between ${String(row['Identif. OLD'] ?? '')} and ${String(row['Identif. NEW'] ?? '')}`}
                                      >
                                        Why?
                                      </button>
                                    )}
                                    {col === actionColumn && isReassignableSource && movableSide && (
                                      <button
                                        type="button"
                                        onClick={(e) => { e.stopPropagation(); setReassignSource({ row, movingSide: movableSide }); }}
                                        className="ml-1 inline-block align-middle rounded border border-blue-300 bg-white px-1 text-[9px] font-bold text-blue-700 opacity-0 transition-opacity focus:opacity-100 group-hover:opacity-100"
                                        aria-label={`Reassign ${movableSide} feature ${String(row[`Identif. ${movableSide}`] ?? '')} to an unmatched ${movableSide === 'NEW' ? 'OLD' : 'NEW'} feature`}
                                      >
                                        Reassign…
                                      </button>
                                    )}
                                    {col === actionColumn && isUnassignable && onUnassign && (
                                      <button
                                        type="button"
                                        onClick={(e) => { e.stopPropagation(); void onUnassign([row.__origIdx]); }}
                                        className="ml-1 inline-block align-middle rounded border border-amber-300 bg-white px-1 text-[9px] font-bold text-amber-700 opacity-0 transition-opacity focus:opacity-100 group-hover:opacity-100"
                                        aria-label={`Unassign the match between ${String(row['Identif. OLD'] ?? '')} and ${String(row['Identif. NEW'] ?? '')}`}
                                      >
                                        Unassign
                                      </button>
                                    )}
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                        {/* Spacer bottom */}
                        <tr style={{ height: Math.max(0, (sortedData.length - visibleRows.endIdx - 1) * ROW_HEIGHT) }}><td /></tr>
                      </>
                    )}
                  </tbody>
                </table>
              )}

              {(activeTab === 'ILI Run 1' || activeTab === 'ILI Run 2') && (
                <table className="results-table results-table--run w-full text-left border-collapse text-[10px] leading-tight table-fixed break-words">
                  <thead className="sticky top-0 z-10">
                      <tr>
                        <th className="px-1.5 py-2 font-bold">Defect ID</th>
                        <th className="px-1.5 py-2 font-bold">Distance (m)</th>
                        <th className="px-1.5 py-2 font-bold" title="Estimate only: nominal 0.1 m offset applied to the logged distance.">Dist. Adj (m) <span style={{ color: 'var(--syn-warning)' }}>(est.)</span></th>
                        <th className="px-1.5 py-2 font-bold">Rel. U/S Weld (m)</th>
                        <th className="px-1.5 py-2 font-bold" title="Estimate only: nominal 0.05 m offset applied to the upstream-weld distance.">Rel. Nearest Weld (m) <span style={{ color: 'var(--syn-warning)' }}>(est.)</span></th>
                        <th className="px-1.5 py-2 font-bold">Wall Thick (mm)</th>
                        <th className="px-1.5 py-2 font-bold">Orient (deg)</th>
                        <th className="px-1.5 py-2 font-bold">Length (mm)</th>
                        <th className="px-1.5 py-2 font-bold">Width (mm)</th>
                        <th className="px-1.5 py-2 font-bold">Depth (mm)</th>
                        <th className="px-1.5 py-2 font-bold">Flaw Depth (%)</th>
                        <th className="px-1.5 py-2 font-bold">Wall Side</th>
                      </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                      {loading ? (
                        <tr><td colSpan={12} className="p-8 text-center text-gray-400">Loading data...</td></tr>
                      ) : iliRows.length === 0 ? (
                        <tr><td colSpan={12} className="p-8 text-center text-gray-400">No data matches the current filters</td></tr>
                      ) : (
                        <>
                        {/* Spacer top */}
                        <tr style={{ height: visibleRows.startIdx * ROW_HEIGHT }}><td /></tr>
                        {iliRows.slice(visibleRows.startIdx, visibleRows.endIdx + 1).map((row: any, i: number) => {
                          const isOld = activeTab === 'ILI Run 1';

                          const defectId = row[isOld ? 'Identif. OLD' : 'Identif. NEW'];

                          const distance = row[isOld ? 'Log Dist OLD (m)' : 'Log Dist NEW (m)'];
                          const distGw = row[isOld ? 'Dist GW OLD (m)' : 'Dist GW NEW (m)'];
                          const wt = row[isOld ? 'Wall WT OLD (mm)' : 'Wall WT NEW (mm)'];
                          const oclock = row[isOld ? "O'Clock OLD" : "O'Clock NEW"];
                          const length = row[isOld ? 'Length OLD (mm)' : 'Length NEW (mm)'];
                          const width = row[isOld ? 'Width OLD (mm)' : 'Width NEW (mm)'];
                          const depth = row[isOld ? 'Depth OLD (%WT)' : 'Depth NEW (%WT)'];
                          const surface = row[isOld ? 'Surface OLD' : 'Surface NEW'] ?? 'Internal';
                          
                          const distFormatted = typeof distance === 'number' ? distance.toFixed(3) : '';
                          // Rough estimates, not measured values: fixed nominal
                          // offsets pending a real tie-in / weld-table lookup.
                          // The column headers mark them as such.
                          const distAdj = typeof distance === 'number' ? (distance - 0.1).toFixed(3) : '';
                          const nearWeld = distGw ? (parseFloat(distGw) - 0.05).toFixed(2) : '';

                          // The source column is 'Depth (%WT)' — already a
                          // percentage of wall thickness. The two depth columns
                          // were inverted: the mm column printed the raw
                          // percentage, and the % column divided that
                          // percentage by the wall thickness and scaled it
                          // again, so a 40 %WT flaw in a 10 mm wall rendered as
                          // "400.0" under a [%] header.
                          const depthPctValue = parseFloat(depth);
                          const wallThicknessMm = parseFloat(wt);
                          const depthPct = Number.isFinite(depthPctValue)
                            ? depthPctValue.toFixed(1)
                            : '';
                          const depthMm = Number.isFinite(depthPctValue) && Number.isFinite(wallThicknessMm)
                            ? ((depthPctValue / 100) * wallThicknessMm).toFixed(2)
                            : '';

                          return (
                            <tr key={visibleRows.startIdx + i} style={{ height: ROW_HEIGHT }} className="hover:bg-blue-50/50 transition-colors">
                              <td className="px-1 py-1 border-r border-gray-100">{defectId}</td>
                              <td className="px-1 py-1 border-r border-gray-100">{distFormatted}</td>
                              <td className="px-1 py-1 border-r border-gray-100 bg-gray-50">{distAdj}</td>
                              <td className="px-1 py-1 border-r border-gray-100">{distGw}</td>
                              <td className="px-1 py-1 border-r border-gray-100">{nearWeld}</td>
                              <td className="px-1 py-1 border-r border-gray-100">{wt}</td>
                              <td className="px-1 py-1 border-r border-gray-100">{oclock}</td>
                              <td className="px-1 py-1 border-r border-gray-100">{length}</td>
                              <td className="px-1 py-1 border-r border-gray-100">{width}</td>
                              <td className="px-1 py-1 border-r border-gray-100">{depthMm || '-'}</td>
                              <td className="px-1 py-1 border-r border-gray-100">{depthPct || '-'}</td>
                              <td className="px-1 py-1 text-blue-600 font-medium">{surface}</td>
                            </tr>
                          );
                        })}
                        {/* Spacer bottom */}
                        <tr style={{ height: Math.max(0, (iliRows.length - visibleRows.endIdx - 1) * ROW_HEIGHT) }}><td /></tr>
                        </>
                      )}
                  </tbody>
                </table>
              )}
            </div>
          )}
          
          {evidenceRow && (
            <MatchEvidenceDrawer
              evidence={evidenceRow[MATCH_EVIDENCE_KEY] as MatchEvidence}
              title={`${String(evidenceRow['Identif. OLD'] ?? '—')} → ${String(evidenceRow['Identif. NEW'] ?? '—')}`}
              onClose={() => setEvidenceRow(null)}
            />
          )}

          {radioFilter !== 'Chart' && (
            <PaginationFooter
              totalRows={sortedData.length}
              hasActiveFilters={Object.values(filterInput).some(v => v)}
              onClearFilters={() => { setFilterInput({}); setFilterConfig({}); }}
            />
          )}
        </div>
      )}

    </div>
  );

  // Full screen keeps the exact same layout but gains dialog semantics:
  // Escape exits, focus is trapped and restored, and the page cannot scroll.
  if (isFullScreen) {
    return (
      <Modal
        onClose={() => setIsFullScreen(false)}
        ariaLabel="Alignment results (full screen)"
        closeOnBackdrop={false}
        overlayClassName="fixed inset-0 z-[999999]"
        panelClassName="h-full w-full"
      >
        {panelContent}
      </Modal>
    );
  }
  return panelContent;
}
