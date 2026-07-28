import { useState, useMemo, useEffect, useRef, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiSearch, FiFileText, FiMaximize, FiMinimize, FiActivity, FiColumns, FiX, FiDownload, FiMap } from 'react-icons/fi';
import { apiFetch, apiUrl } from './utils/api';
import Modal from './components/common/Modal';
import { useToast } from './components/common/ToastProvider';
import { createExcelExportRows } from './utils/alignmentExport';
import {
  alignmentDisplayValue,
  isAlignmentDisplayMetadata,
  sortAlignmentRowsByDisplayedLogDistance,
} from './utils/alignmentDisplay';
import ShareSnapshotButton from './components/sharing/ShareSnapshotButton';

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
  audit?: unknown;
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

const ProbabilityModal = ({ sourceRow, targetRow, onConfirm, onCancel }: { sourceRow: any, targetRow: any, onConfirm: () => void, onCancel: () => void }) => {
  if (!sourceRow || !targetRow) return null;
  
  const dDist = Math.abs((parseFloat(targetRow['Log Dist OLD (m)']) || 0) - (parseFloat(sourceRow['Log Dist NEW (m)']) || 0));
  const dDepth = Math.abs((parseFloat(targetRow['Depth OLD (%WT)']) || 0) - (parseFloat(sourceRow['Depth NEW (%WT)']) || 0));
  const dLength = Math.abs((parseFloat(targetRow['Length OLD (mm)']) || 0) - (parseFloat(sourceRow['Length NEW (mm)']) || 0));
  const dWidth = Math.abs((parseFloat(targetRow['Width OLD (mm)']) || 0) - (parseFloat(sourceRow['Width NEW (mm)']) || 0));
  const oClockOld = parseClockHours(targetRow["O'Clock OLD"]);
  const oClockNew = parseClockHours(sourceRow["O'Clock NEW"]);
  let dClock = Math.abs(oClockOld - oClockNew);
  if (dClock > 6) dClock = 12 - dClock;
  
  // Gaussian likelihoods
  const likelihoodDist = Math.exp(-Math.pow(dDist, 2) / (2 * Math.pow(0.5, 2))); 
  const likelihoodDepth = Math.exp(-Math.pow(dDepth, 2) / (2 * Math.pow(10, 2))); 
  const likelihoodLength = Math.exp(-Math.pow(dLength, 2) / (2 * Math.pow(20, 2))); 
  const likelihoodWidth = Math.exp(-Math.pow(dWidth, 2) / (2 * Math.pow(20, 2))); 
  const likelihoodClock = Math.exp(-Math.pow(dClock, 2) / (2 * Math.pow(1, 2))); 
  
  const typeMatch = targetRow['Feature Type OLD'] === sourceRow['Feature Type NEW'] ? 1.0 : 0.001;

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
            <span className="text-gray-500">Depth Diff (Δ%WT)</span>
            <span className="font-bold">{dDepth.toFixed(1)} %WT</span>
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
            <span className="font-bold">{targetRow['Feature Type OLD'] || '-'} vs {sourceRow['Feature Type NEW'] || '-'}</span>
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
 * Keyboard path for match reassignment: lists unmatched OLD rows as targets
 * for the chosen NEW-side row. Picking one routes through the same
 * ProbabilityModal -> onUpdateMatch path the mouse drag-and-drop uses.
 */
const ReassignDialog = ({ sourceRow, candidates, onPick, onCancel }: {
  sourceRow: any;
  candidates: any[];
  onPick: (targetRow: any) => void;
  onCancel: () => void;
}) => {
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return candidates;
    return candidates.filter((row) => ['Source Key OLD', 'Identif. OLD', 'Log Dist OLD (m)', 'Feature Type OLD']
      .some((key) => row[key] !== undefined && row[key] !== null && String(row[key]).toLowerCase().includes(needle)));
  }, [candidates, query]);
  const visible = filtered.slice(0, 100);

  const sourceLabel = String(sourceRow?.['Identif. NEW'] ?? sourceRow?.['Source Key NEW'] ?? '-');
  const sourceDist = sourceRow?.['Log Dist NEW (m)'];

  return (
    <Modal
      onClose={onCancel}
      labelledBy="reassign-dialog-title"
      initialFocusRef={searchRef}
      overlayClassName="fixed inset-0 bg-black/50 z-[999999] flex items-center justify-center p-4"
      panelClassName="bg-white rounded-lg shadow-xl max-w-xl w-full p-6 flex flex-col max-h-[80vh]"
    >
      <div className="flex justify-between items-center mb-1">
        <h3 id="reassign-dialog-title" className="text-lg font-bold text-gray-800">Reassign NEW feature</h3>
        <button onClick={onCancel} aria-label="Close reassign dialog" className="text-gray-400 hover:text-gray-600"><FiX size={22} /></button>
      </div>
      <p className="text-sm text-gray-500 mb-3">
        NEW <span className="font-semibold text-gray-700">{sourceLabel}</span>
        {typeof sourceDist === 'number' ? ` at ${sourceDist.toFixed(3)} m` : ''} — choose the unmatched OLD feature it belongs to.
      </p>
      <input
        ref={searchRef}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by Source Key, ID, or distance..."
        aria-label="Search unmatched OLD features by source key, identifier, or distance"
        className="mb-3 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
      />
      {visible.length === 0 ? (
        <p className="py-6 text-center text-sm text-gray-400">No unmatched OLD features match this search.</p>
      ) : (
        <ul className="flex-1 overflow-y-auto divide-y divide-gray-100 border border-gray-100 rounded-md" aria-label="Candidate OLD features">
          {visible.map((row) => (
            <li key={row.__origIdx}>
              <button
                type="button"
                onClick={() => onPick(row)}
                className="w-full px-3 py-2 text-left text-sm hover:bg-blue-50 focus:bg-blue-50 focus:outline-none"
              >
                <span className="font-semibold text-gray-800">{String(row['Identif. OLD'] ?? row['Source Key OLD'] ?? '-')}</span>
                <span className="ml-2 text-gray-500">
                  {typeof row['Log Dist OLD (m)'] === 'number' ? `${row['Log Dist OLD (m)'].toFixed(3)} m` : String(row['Log Dist OLD (m)'] ?? '')}
                </span>
                {hasRowValue(row, 'Feature Type OLD') && (
                  <span className="ml-2 text-xs text-gray-400">{String(row['Feature Type OLD'])}</span>
                )}
                {hasRowValue(row, 'Depth OLD (%WT)') && (
                  <span className="ml-2 text-xs text-gray-400">{String(row['Depth OLD (%WT)'])} %WT</span>
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

export default function ResultsPanel({ data: rawData, loading, readOnly = false, onOpenAnalytics, selectedRowIdx, onSelectRowIdx, onUpdateMatch }: ResultsPanelProps) {
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
          ...(rawData.anomaly_matched || []).map((row: any) => ({ ...row, __resultGroup: 'ANOMALY' })),
          ...(rawData.anomaly_only_old || []).map((row: any) => ({ ...row, __resultGroup: 'ANOMALY' })),
          ...(rawData.anomaly_only_new || []).map((row: any) => ({ ...row, __resultGroup: 'ANOMALY' })),
          ...(rawData.bypassed_old || []).map((row: any) => ({ ...row, __resultGroup: 'BYPASSED' })),
          ...(rawData.bypassed_new || []).map((row: any) => ({ ...row, __resultGroup: 'BYPASSED' }))
       ];
    }
    // Tag every row with its index in the incoming (unsorted) array BEFORE any
    // sorting. This is the row's stable identity: selection, defect-viewer
    // highlighting, and onUpdateMatch all report it, and the parent
    // (IliComparisonPage) maps it straight back onto the rows it passed in.
    flattened.forEach((row, idx) => { row.__origIdx = idx; });
    // NEW is the spatial master. Keep the default order consistent with the
    // source NEW log distance rendered in the table; OLD-only rows follow it.
    return sortAlignmentRowsByDisplayedLogDistance(flattened);
  }, [rawData]);

  const navigate = useNavigate();
  const toast = useToast();
  const shareSessionId = useMemo(() => (
    new URLSearchParams(window.location.search).get('sessionId')
    || localStorage.getItem('synapse_last_session_id')
    || ''
  ), []);
  const [isExporting, setIsExporting] = useState(false);
  const [activeTab, setActiveTab] = useState('Results');
  const [radioFilter, setRadioFilter] = useState('All');
  const [unmatchedOld, setUnmatchedOld] = useState(false);
  const [unmatchedNew, setUnmatchedNew] = useState(false);
  
  // Sections state
  const [sections, setSections] = useState<any[]>([]);
  
  const summaryCounts = useMemo(() => {
    if (rawData && !Array.isArray(rawData)) {
      return {
        gwLocked: rawData.gw_locked?.length || 0,
        gwUnmatched: rawData.gw_unmatched?.length || 0,
        anomalyMatched: rawData.anomaly_matched?.length || 0,
        anomalyOnlyOld: rawData.anomaly_only_old?.length || 0,
        anomalyOnlyNew: rawData.anomaly_only_new?.length || 0,
        bypassedOld: rawData.bypassed_old?.length || 0,
        bypassedNew: rawData.bypassed_new?.length || 0,
      };
    }
    return null;
  }, [rawData]);

  // Drag & Drop Match State
  const [draggedRowIdx, setDraggedRowIdx] = useState<number | null>(null);
  const [modalState, setModalState] = useState<{ isOpen: boolean, sourceRow: any, targetRow: any }>({ isOpen: false, sourceRow: null, targetRow: null });
  // Keyboard path for reassignment: the row whose NEW side is being reassigned.
  const [reassignSource, setReassignSource] = useState<any | null>(null);
  // Same rows a drop can land on and pass the parent's validation: an OLD
  // feature that has no NEW pair yet.
  const reassignCandidates = useMemo(() => data
    .filter((row: any) => (hasRowValue(row, 'Source Key OLD') || hasRowValue(row, 'Identif. OLD'))
      && !hasRowValue(row, 'Source Key NEW') && !hasRowValue(row, 'Identif. NEW'))
    .sort((a: any, b: any) => (parseFloat(a['Log Dist OLD (m)']) || 0) - (parseFloat(b['Log Dist OLD (m)']) || 0)), [data]);

  // Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [distanceStart, setDistanceStart] = useState('');
  const [distanceEnd, setDistanceEnd] = useState('');

  // Full screen state
  const [isFullScreen, setIsFullScreen] = useState(false);

  const tabs = readOnly
    ? ['Results', 'ILI Run 1', 'ILI Run 2']
    : ['Results', 'ILI Run 1', 'ILI Run 2', 'Interventions'];
  
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
  const [colWidths, setColWidths] = useState<Record<string, number>>({});
  const [sortConfig, setSortConfig] = useState<{key: string, direction: 'asc'|'desc'} | null>(null);
  const [filterConfig, setFilterConfig] = useState<Record<string, string>>({});
  const [filterInput, setFilterInput] = useState<Record<string, string>>({});
  const columnMenuRef = useRef<HTMLDivElement>(null);

  // Virtual scroll state
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(800); // fallback until measured
  const ROW_HEIGHT = 24; // px per row — keep in sync with .results-table td height in synapse-tokens.css
  const OVERSCAN = 10; // extra rows to render above/below viewport

  // Extract all columns
  const allColumns = useMemo(() => {
    if (data && data.length > 0) {
      const keys = Object.keys(data[0]).filter(k =>
        k !== 'Match/Unmatch'
        && k !== '__resultGroup'
        && k !== '__origIdx'
        && !isAlignmentDisplayMetadata(k)
      );
      // Add computed columns at the end
      keys.push('Depth Growth (%WT/yr)', 'Length Growth (mm/yr)', 'Physics Warning');
      return ['Section', ...keys];
    }
    return ['Section'];
  }, [data]);

  // The column that hosts the keyboard "Reassign..." affordance: the first
  // visible NEW-side column in the Interventions tab.
  const reassignColumn = useMemo(
    () => visibleColumns.filter((c) => allColumns.includes(c)).find((c) => c.includes('NEW')),
    [visibleColumns, allColumns],
  );

  // Fetch sections
  useEffect(() => {
    if (readOnly) return;
    const fetchSections = async () => {
      try {
        const urlParams = new URLSearchParams(window.location.search);
        const sessionId = urlParams.get('sessionId') || localStorage.getItem('synapse_last_session_id') || '';
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
  }, [readOnly]);

  // Set specific important columns visible by default when data loads
  useEffect(() => {
    if (allColumns.length > 0 && visibleColumns.length === 0) {
      const defaultCols = [
        'Match/Unmatch',
        'Section',
        'Identif. OLD', 'Identif. NEW',
        'Log Dist OLD (m)', 'Log Dist NEW (m)',
        'Feature Type OLD', 'Feature Type NEW',
        'Depth OLD (%WT)', 'Depth NEW (%WT)',
        'Length OLD (mm)', 'Length NEW (mm)',
        'Width OLD (mm)', 'Width NEW (mm)',
        "O'Clock OLD", "O'Clock NEW",
        'Depth Growth (%WT/yr)', 'Length Growth (mm/yr)', 'Physics Warning'
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
      'Feature Type OLD', 'Feature Type NEW',
      'Depth OLD (%WT)', 'Depth NEW (%WT)',
      'Length OLD (mm)', 'Length NEW (mm)',
      'Width OLD (mm)', 'Width NEW (mm)',
      "O'Clock OLD", "O'Clock NEW",
      'Depth Growth (%WT/yr)', 'Length Growth (mm/yr)', 'Physics Warning'
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
      const depthGrowth = row['Depth Growth (%WT/yr)'] ?? (
        yearSpan && !isNaN(d1) && !isNaN(d2) ? ((d2 - d1) / yearSpan).toFixed(3) : '-'
      );
      
      const l1 = parseFloat(row['Length OLD (mm)']);
      const l2 = parseFloat(row['Length NEW (mm)']);
      const lengthGrowth = row['Length Growth (mm/yr)'] ?? (
        yearSpan && !isNaN(l1) && !isNaN(l2) ? ((l2 - l1) / yearSpan).toFixed(3) : '-'
      );

      // NEW is the current/reference run for corrosion-growth analysis.
      const dist = parseFloat(row['Log Dist NEW (m)']);
      let sectionName = '-';
      if (!isNaN(dist) && sections && sections.length > 0) {
         const matchingSec = sections.find(s => {
            const start = Number(s.newStartM ?? s.startM);
            const end = Number(s.newEndM ?? s.endM);
            const min = Math.min(start, end);
            const max = Math.max(start, end);
            return dist >= min && dist <= max;
         });
         if (matchingSec) {
            sectionName = matchingSec.name;
         }
      }

      return {
        ...row,
        'Depth Growth (%WT/yr)': depthGrowth,
        'Length Growth (mm/yr)': lengthGrowth,
        'Section': sectionName,
      };
    });
  }, [data, sections]);

  // 2. Filter data for view
  const filteredData = useMemo(() => {
    return processedData.filter((row: any) => {
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
  }, [processedData, radioFilter, unmatchedOld, unmatchedNew, distanceStart, distanceEnd, searchQuery, filterConfig]);

  const sortedData = useMemo(() => {
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
    if (sortedData.length === 0) return;
    setIsExporting(true);
    try {
      const exportRows = createExcelExportRows(sortedData);
      const response = await fetch(apiUrl('/api/alignment/export-excel'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({ data: exportRows })
      });
      
      if (!response.ok) {
        throw new Error('Failed to generate Excel file');
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
      toast.error('Failed to export the Excel file.');
    } finally {
      setIsExporting(false);
    }
  };

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
              {tab}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 relative">
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
                        <span className="truncate flex-1" title={col}>{col}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          {!readOnly && onOpenAnalytics && (
            <button onClick={onOpenAnalytics} className="syn-btn syn-btn--sm syn-btn--ink">
              <FiActivity size={14} />
              Analytics
            </button>
          )}
          {!readOnly && (
            <>
              <button
                onClick={() => {
                  const urlParams = new URLSearchParams(window.location.search);
                  const sessionId = urlParams.get('sessionId') || localStorage.getItem('synapse_last_session_id') || '';
                  navigate(`/ili-sectioning?sessionId=${sessionId}`);
                }}
                className="syn-btn syn-btn--sm syn-btn--ink"
              >
                <FiMap size={14} />
                Sectional
              </button>
              <button onClick={exportToExcel} disabled={isExporting} className="syn-btn syn-btn--sm syn-btn--lime">
                <FiDownload size={14} />
                {isExporting ? 'Exporting...' : 'Excel'}
              </button>
              <ShareSnapshotButton
                kind="ILI_ALIGNMENT"
                title={`Final ILI alignment${shareSessionId ? ` · Session ${shareSessionId}` : ''}`}
                sourceRef={shareSessionId ? `alignment-session:${shareSessionId}` : undefined}
                rows={data}
                summary={summaryCounts ? [
                  { label: 'GW locked', value: summaryCounts.gwLocked },
                  { label: 'Anomaly matched', value: summaryCounts.anomalyMatched },
                  { label: 'Only OLD', value: summaryCounts.anomalyOnlyOld },
                  { label: 'Only NEW', value: summaryCounts.anomalyOnlyNew },
                ] : undefined}
                notes={[
                  'Final ILI comparison snapshot. Open any row to inspect the shared evidence; editing is disabled.',
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

      {!readOnly && modalState.isOpen && (
        <ProbabilityModal
          sourceRow={modalState.sourceRow}
          targetRow={modalState.targetRow}
          onCancel={() => setModalState({ isOpen: false, sourceRow: null, targetRow: null })}
          onConfirm={() => {
            if (onUpdateMatch) {
              onUpdateMatch(modalState.sourceRow.__origIdx, modalState.targetRow.__origIdx);
            }
            setModalState({ isOpen: false, sourceRow: null, targetRow: null });
          }}
        />
      )}

      {!readOnly && reassignSource !== null && (
        <ReassignDialog
          sourceRow={reassignSource}
          candidates={reassignCandidates}
          onCancel={() => setReassignSource(null)}
          onPick={(targetRow) => {
            // Route through the same confirmation modal the drop path uses.
            setReassignSource(null);
            setModalState({ isOpen: true, sourceRow: reassignSource, targetRow });
          }}
        />
      )}

      {(activeTab === 'Results' || activeTab === 'ILI Run 1' || activeTab === 'ILI Run 2' || activeTab === 'Interventions') && (
        <div className="flex flex-col h-full overflow-hidden text-sm relative">
          {/* Summary Dashboard */}
          {summaryCounts && (
            <div className="results-summary grid grid-cols-2 md:grid-cols-5 z-10" style={{ borderBottom: '1px solid var(--syn-line)' }}>
              <div>
                <span>Total Pairs Matched</span>
                <span>{summaryCounts.gwLocked + summaryCounts.anomalyMatched}</span>
                <span>({summaryCounts.gwLocked} GW + {summaryCounts.anomalyMatched} Anom)</span>
              </div>
              <div>
                <span>GW Orphan</span>
                <span>{summaryCounts.gwUnmatched}</span>
              </div>
              <div>
                <span>Only OLD</span>
                <span>{summaryCounts.anomalyOnlyOld}</span>
              </div>
              <div>
                <span>Only NEW</span>
                <span>{summaryCounts.anomalyOnlyNew}</span>
              </div>
              <div>
                <span>Bypassed</span>
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
                  <span>{f === 'GW' ? 'GWs' : f === 'Anomaly' ? 'Anomalies' : f}</span>
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
                <input type="checkbox" checked={unmatchedOld} onChange={(e) => setUnmatchedOld(e.target.checked)} />
                <span>Unmatched OLD</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={unmatchedNew} onChange={(e) => setUnmatchedNew(e.target.checked)} />
                <span>Unmatched NEW</span>
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
              {(activeTab === 'Results' || activeTab === 'Interventions') && (
                <table className="results-table w-max text-left border-collapse text-[11px] leading-tight table-fixed break-words min-w-full">
                  <thead className="sticky top-0 z-10">
                    <tr>
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
                          aria-sort={sortConfig?.key === col ? (sortConfig.direction === 'asc' ? 'ascending' : 'descending') : undefined}
                          className={`px-2 py-2 font-bold whitespace-nowrap relative group select-none ${draggedColumn === col ? 'opacity-50' : ''}`}
                        >
                          <div className="flex flex-col gap-1">
                            <button
                              type="button"
                              className="flex w-full justify-between items-center cursor-pointer hover:text-brand-600 focus:outline-none focus-visible:ring-1 focus-visible:ring-brand-500 rounded"
                              aria-label={`Sort by ${col}${sortConfig?.key === col ? (sortConfig.direction === 'asc' ? ', currently ascending' : ', currently descending') : ''}`}
                              onClick={() => {
                                let direction: 'asc' | 'desc' = 'asc';
                                if (sortConfig && sortConfig.key === col && sortConfig.direction === 'asc') direction = 'desc';
                                setSortConfig({ key: col, direction });
                              }}
                            >
                              <span>{col}</span>
                              <span aria-hidden="true" className="text-gray-400 text-[10px]">
                                {sortConfig?.key === col ? (sortConfig.direction === 'asc' ? '▲' : '▼') : '↕'}
                              </span>
                            </button>
                            <input
                              type="text"
                              placeholder="Filter..."
                              aria-label={`Filter ${col}`}
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
                      <tr><td colSpan={visibleColumns.length} className="p-8 text-center text-gray-400">Loading data...</td></tr>
                    ) : sortedData.length === 0 ? (
                      <tr><td colSpan={visibleColumns.length} className="p-8 text-center text-gray-400">No data matches the current filters</td></tr>
                    ) : (
                      <>
                        {/* Spacer top */}
                        <tr style={{ height: visibleRows.startIdx * ROW_HEIGHT }}><td /></tr>
                        {sortedData.slice(visibleRows.startIdx, visibleRows.endIdx + 1).map((row: any, i: number) => {
                          const actualIdx = visibleRows.startIdx + i;
                          const isSelected = selectedRowIdx !== null && selectedRowIdx !== undefined && row.__origIdx === selectedRowIdx;
                          const isDragTarget = activeTab === 'Interventions' && draggedRowIdx !== null && draggedRowIdx !== row.__origIdx;
                          
                          const isMatch = row['Match/Unmatch'] === 'Matched' || row['Match/Unmatch'] === 'Match';
                          const featType = String(row['Feature Type OLD'] || row['Feature Type NEW'] || '').toLowerCase();
                          let rowClass = 'results-row';
                          if (isSelected) {
                            rowClass += ' results-row--selected';
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

                          const isReassignableSource = activeTab === 'Interventions'
                            && (hasRowValue(row, 'Source Key NEW') || hasRowValue(row, 'Identif. NEW'));

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
                                if (!isDragTarget) return;
                                e.preventDefault();
                                const sourceRow = sortedData.find((r: any) => r.__origIdx === draggedRowIdx);
                                if (sourceRow) {
                                  setModalState({ isOpen: true, sourceRow, targetRow: row });
                                }
                                setDraggedRowIdx(null);
                              }}
                            >
                              {visibleColumns.filter(c => allColumns.includes(c)).map((col, j) => {
                                let val = alignmentDisplayValue(row, col);
                                if (typeof val === 'string' && (val.toLowerCase() === 'null' || val.toLowerCase() === 'nan' || val.toLowerCase() === 'undefined')) {
                                  val = null;
                                }
                                const isNewDataCol = col.includes('NEW');
                                // Only format computed columns; leave raw data values untouched
                                if ((col === 'Depth Growth (%WT/yr)' || col === 'Length Growth (mm/yr)') && val !== '-' && val != null && !isNaN(parseFloat(String(val)))) {
                                  val = parseFloat(String(val)).toFixed(3);
                                }
                                // Convert O'Clock Excel time serial fractions to HH:MM
                                if (col.includes("O'Clock")) {
                                  val = formatClockDisplay(val);
                                }
                                return (
                                  <td 
                                    key={j} 
                                    className={`px-2 whitespace-nowrap overflow-hidden text-ellipsis ${col === 'Depth Growth (%WT/yr)' || col === 'Length Growth (mm/yr)' ? 'font-bold' : ''} ${activeTab === 'Interventions' && isNewDataCol ? 'cursor-grab active:cursor-grabbing' : ''}`}
                                    style={col === 'Depth Growth (%WT/yr)' || col === 'Length Growth (mm/yr)' ? { color: 'var(--syn-info, #155eef)' } : undefined}
                                    draggable={activeTab === 'Interventions' && isNewDataCol && val !== '-' && val !== null && val !== undefined}
                                    onDragStart={(e) => {
                                      if (activeTab === 'Interventions' && isNewDataCol) {
                                        setDraggedRowIdx(row.__origIdx);
                                        e.dataTransfer.effectAllowed = "move";
                                      }
                                    }}
                                    onDragEnd={() => setDraggedRowIdx(null)}
                                  >
                                    {val !== undefined && val !== null ? (
                                      (col === 'Feature Type OLD' || col === 'Feature Type NEW') ? (
                                        <span className={getFeatureColor(val, row['Identif. OLD'] !== '-' && row['Identif. NEW'] !== '-')}>{val}</span>
                                      ) : col === 'Section' && val !== '-' ? (
                                        <span className="bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wider">{val}</span>
                                      ) : col === 'Match/Unmatch' ? (
                                        val === 'Matched' || val === 'Match' ? (
                                          <span className="bg-green-600 text-white font-extrabold px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider shadow-sm">Match</span>
                                        ) : val === 'Unmatch' || val === 'Only NEW' || val === 'Only OLD' ? (
                                          <span className="bg-red-600 text-white font-extrabold px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider shadow-sm">{val}</span>
                                        ) : val !== '-' ? (
                                          <span className="bg-gray-500 text-white font-semibold px-1.5 py-0.5 rounded text-[10px] tracking-wider shadow-sm">{val}</span>
                                        ) : '-'
                                      ) : val
                                    ) : ''}
                                    {col === reassignColumn && isReassignableSource && (
                                      <button
                                        type="button"
                                        onClick={(e) => { e.stopPropagation(); setReassignSource(row); }}
                                        className="ml-1 inline-block align-middle rounded border border-blue-300 bg-white px-1 text-[9px] font-bold text-blue-700 opacity-0 transition-opacity focus:opacity-100 group-hover:opacity-100"
                                        aria-label={`Reassign NEW feature ${String(row['Identif. NEW'] ?? '')} to an unmatched OLD feature`}
                                      >
                                        Reassign…
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
                <table className="results-table results-table--run w-full text-left border-collapse text-[11px] leading-tight table-fixed break-words">
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
