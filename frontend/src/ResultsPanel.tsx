import { useState, useMemo, useEffect, useRef, lazy, Suspense } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { FiSearch, FiFileText, FiMaximize, FiMinimize, FiActivity, FiColumns, FiX, FiDownload, FiMap } from 'react-icons/fi';
import { apiFetch, apiUrl } from './utils/api';

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
  onOpenAnalytics?: () => void;
  selectedRowIdx?: number | null;
  onSelectRowIdx?: (idx: number | null) => void;
  onUpdateMatch?: (sourceIdx: number, targetIdx: number) => void;
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
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full p-6 animate-fade-in">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-bold text-gray-800">Match Probability Analysis</h3>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600"><FiX size={24} /></button>
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
      </div>
    </div>
  );
};

export default function ResultsPanel({ data: rawData, loading, onOpenAnalytics, selectedRowIdx, onSelectRowIdx, onUpdateMatch }: ResultsPanelProps) {
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
    // The backend keeps separate buckets for the matching phases.  The
    // Results view is one pipeline, so merge those buckets by odometer and
    // keep OLD/NEW pairs adjacent instead of rendering phase-sized blocks.
    return flattened
      .map((row: any, index: number) => ({ row, index }))
      .sort((a: any, b: any) => {
        const aDistances = [a.row['Log Dist OLD (m)'], a.row['Log Dist NEW (m)']]
          .map(Number).filter(Number.isFinite);
        const bDistances = [b.row['Log Dist OLD (m)'], b.row['Log Dist NEW (m)']]
          .map(Number).filter(Number.isFinite);
        const aSortable = aDistances.length ? Math.min(...aDistances) : Number.POSITIVE_INFINITY;
        const bSortable = bDistances.length ? Math.min(...bDistances) : Number.POSITIVE_INFINITY;
        return aSortable - bSortable || a.index - b.index;
      })
      .map(({ row }: { row: any }) => row);
  }, [rawData]);

  const navigate = useNavigate();
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

  // Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [distanceStart, setDistanceStart] = useState('');
  const [distanceEnd, setDistanceEnd] = useState('');

  // Full screen state
  const [isFullScreen, setIsFullScreen] = useState(false);

  const tabs = ['Results', 'ILI Run 1', 'ILI Run 2', 'Interventions'];
  
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
  const ROW_HEIGHT = 28; // px per row
  const OVERSCAN = 10; // extra rows to render above/below viewport

  // Extract all columns
  const allColumns = useMemo(() => {
    if (data && data.length > 0) {
      const keys = Object.keys(data[0]).filter(k => k !== 'Match/Unmatch' && k !== '__resultGroup');
      // Add computed columns at the end
      keys.push('Depth Growth (%WT/yr)', 'Length Growth (mm/yr)', 'Physics Warning');
      return ['Section', ...keys];
    }
    return ['Section'];
  }, [data]);

  // Fetch sections
  useEffect(() => {
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
  }, []);

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

  
  // 1. Process alignment data
  const processedData = useMemo(() => {
    return (data || []).map((row: any, idx: number) => {
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
        __origIdx: idx
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
          const rowValue = row[key];
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
      const aVal = a[sortConfig.key];
      const bVal = b[sortConfig.key];
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

  // Virtual scroll calculation
  const visibleRows = useMemo(() => {
    // Dynamic height: full screen uses window height (or 1200 fallback), normal uses 800
    const containerHeight = isFullScreen ? (typeof window !== 'undefined' ? window.innerHeight : 1200) : 800;
    const startIdx = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
    const endIdx = Math.min(sortedData.length - 1, Math.ceil((scrollTop + containerHeight) / ROW_HEIGHT) + OVERSCAN);
    return { startIdx, endIdx, totalHeight: sortedData.length * ROW_HEIGHT };
  }, [scrollTop, sortedData.length, ROW_HEIGHT, OVERSCAN, isFullScreen]);

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
      const response = await fetch(apiUrl('/api/alignment/export-excel'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({ data: sortedData })
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
      alert("Gagal mengekspor file Excel.");
    } finally {
      setIsExporting(false);
    }
  };

  // Footer showing total row count (replaces pagination)
  const PaginationFooter = () => (
    <div className="bg-gray-100 border-t border-gray-200 p-2 flex justify-between items-center text-sm text-gray-600">
      <span className="text-gray-500">Total: {sortedData.length} baris</span>
      {Object.values(filterInput).some(v => v) && (
        <button 
          onClick={() => { setFilterInput({}); setFilterConfig({}); }}
          className="text-xs text-red-500 hover:underline"
        >Clear all filters</button>
      )}
    </div>
  );

  const panelContent = (
    <div className={isFullScreen ? "fixed inset-0 z-[999999] bg-white flex flex-col overflow-hidden" : "bg-white rounded-xl shadow-sm border border-gray-200 flex flex-col h-full overflow-hidden"}>
      
      {/* Tabs Header */}
      <div className="flex justify-between border-b border-gray-200 bg-gray-50/50 pr-4">
        <div className="flex">
          {tabs.map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-6 py-3 text-sm font-medium transition-colors border-b-2 ${
                activeTab === tab 
                  ? 'border-blue-500 text-blue-600 bg-white' 
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-100'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3 relative">
          {activeTab === 'Results' && (
            <div ref={columnMenuRef}>
              <button 
                onClick={() => setShowColumnFilter(!showColumnFilter)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] bg-white border border-gray-300 text-gray-700 rounded-md shadow-sm hover:bg-gray-50 font-medium transition-colors"
              >
                <FiColumns size={14} />
                Columns ({visibleColumns.length}/{allColumns.length})
              </button>
              
              {showColumnFilter && (
                <div className="absolute right-0 top-full mt-2 w-72 bg-white rounded-lg shadow-xl border border-gray-200 z-[999999] overflow-hidden flex flex-col max-h-[400px]">
                  <div className="p-3 border-b border-gray-100 bg-gray-50/50 flex justify-between items-center">
                    <span className="font-bold text-gray-700 text-sm">Visible Columns</span>
                    <div className="flex gap-2">
                      <button onClick={() => setVisibleColumns(allColumns)} className="text-xs text-blue-600 hover:underline font-medium">All</button>
                      <span className="text-gray-300">|</span>
                      <button onClick={() => setVisibleColumns([])} className="text-xs text-gray-500 hover:underline font-medium">None</button>
                    </div>
                  </div>
                  <div className="overflow-y-auto p-2 flex-1 flex flex-col gap-1">
                    {allColumns.map(col => (
                      <label key={col} className="flex items-center gap-2 px-2 py-1.5 hover:bg-gray-50 rounded cursor-pointer text-sm">
                        <input 
                          type="checkbox" 
                          checked={visibleColumns.includes(col)}
                          onChange={() => toggleColumn(col)}
                          className="rounded border-gray-300 text-blue-600"
                        />
                        <span className="truncate flex-1 text-gray-700" title={col}>{col}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          {onOpenAnalytics && (
            <button 
              onClick={onOpenAnalytics}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] bg-blue-600 text-white rounded-md shadow-sm hover:bg-blue-700 font-medium transition-colors"
            >
              <FiActivity size={14} />
              Advanced Analytics
            </button>
          )}
          <button 
            onClick={() => {
              const urlParams = new URLSearchParams(window.location.search);
              const sessionId = urlParams.get('sessionId') || localStorage.getItem('synapse_last_session_id') || '';
              navigate(`/ili-sectioning?sessionId=${sessionId}`);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] bg-[#0f766e] text-white rounded-md shadow-sm hover:bg-[#115e59] font-medium transition-colors"
          >
            <FiMap size={14} />
            To Sectional
          </button>
          <button 
            onClick={exportToExcel}
            disabled={isExporting}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] bg-emerald-600 text-white rounded-md shadow-sm hover:bg-emerald-700 font-medium transition-colors disabled:opacity-50"
          >
            <FiDownload size={14} />
            {isExporting ? 'Exporting...' : 'Export Excel'}
          </button>
          <button 
            onClick={() => setIsFullScreen(!isFullScreen)}
            className="text-orange-500 hover:text-orange-700 p-2 rounded-full hover:bg-orange-100 transition-colors flex items-center justify-center font-medium"
            title={isFullScreen ? "Exit Full Screen" : "Full Screen Data"}
          >
            {isFullScreen ? <FiMinimize size={18} /> : <FiMaximize size={18} />}
          </button>
        </div>
      </div>

      {modalState.isOpen && (
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

      {(activeTab === 'Results' || activeTab === 'ILI Run 1' || activeTab === 'ILI Run 2' || activeTab === 'Interventions') && (
        <div className="flex flex-col h-full bg-white rounded shadow-sm border border-gray-200 overflow-hidden text-sm relative">
          {/* Summary Dashboard Area */}
          {summaryCounts && (
            <div className="p-4 bg-white border-b border-gray-200 grid grid-cols-1 md:grid-cols-5 gap-4 shadow-sm z-10">
              <div className="bg-blue-50/50 p-3 rounded-lg border border-blue-100 flex flex-col items-center justify-center text-center">
                 <span className="text-xs font-semibold text-blue-600 uppercase tracking-wider mb-1">Total Pairs Matched</span>
                 <span className="text-2xl font-black text-blue-800">{summaryCounts.gwLocked + summaryCounts.anomalyMatched}</span>
                 <span className="text-[10px] text-blue-500 mt-1">({summaryCounts.gwLocked} GW + {summaryCounts.anomalyMatched} Anom)</span>
              </div>
              <div className="bg-gray-50/50 p-3 rounded-lg border border-gray-200 flex flex-col items-center justify-center text-center">
                 <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Total GW Orphan</span>
                 <span className="text-2xl font-bold text-gray-700">{summaryCounts.gwUnmatched}</span>
              </div>
              <div className="bg-orange-50/50 p-3 rounded-lg border border-orange-100 flex flex-col items-center justify-center text-center">
                 <span className="text-xs font-semibold text-orange-600 uppercase tracking-wider mb-1">Only OLD (Anomaly)</span>
                 <span className="text-2xl font-bold text-orange-800">{summaryCounts.anomalyOnlyOld}</span>
              </div>
              <div className="bg-emerald-50/50 p-3 rounded-lg border border-emerald-100 flex flex-col items-center justify-center text-center">
                 <span className="text-xs font-semibold text-emerald-600 uppercase tracking-wider mb-1">Only NEW (Anomaly)</span>
                 <span className="text-2xl font-bold text-emerald-800">{summaryCounts.anomalyOnlyNew}</span>
              </div>
              <div className="bg-purple-50/50 p-3 rounded-lg border border-purple-100 flex flex-col items-center justify-center text-center">
                 <span className="text-xs font-semibold text-purple-600 uppercase tracking-wider mb-1">Bypassed Features</span>
                 <span className="text-2xl font-bold text-purple-800">{summaryCounts.bypassedOld + summaryCounts.bypassedNew}</span>
                 <span className="text-[10px] text-purple-500 mt-1">(Non-Anomaly / Filtered)</span>
              </div>
            </div>
          )}

          {/* Filters Area */}
          <div className="p-4 bg-[#fffdf0] border-b border-gray-200 text-sm flex flex-row flex-wrap items-center gap-8">
            <div className="flex gap-6 items-center">
              <label className="flex items-center gap-2 cursor-pointer font-medium">
                <input type="radio" name="filter" checked={radioFilter === 'All'} onChange={() => setRadioFilter('All')} className="text-blue-500" />
                All
              </label>
              <label className="flex items-center gap-2 cursor-pointer font-medium">
                <input type="radio" name="filter" checked={radioFilter === 'GW'} onChange={() => setRadioFilter('GW')} className="text-blue-500" />
                GWs Only
              </label>
              <label className="flex items-center gap-2 cursor-pointer font-medium">
                <input type="radio" name="filter" checked={radioFilter === 'Anomaly'} onChange={() => setRadioFilter('Anomaly')} className="text-blue-500" />
                Anomalies Only
              </label>
              <label className="flex items-center gap-2 cursor-pointer font-medium">
                <input type="radio" name="filter" checked={radioFilter === 'Bypassed'} onChange={() => setRadioFilter('Bypassed')} className="text-blue-500" />
                Bypassed
              </label>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 cursor-pointer font-medium">
                  <input type="radio" name="filter" checked={radioFilter === 'Distance'} onChange={() => setRadioFilter('Distance')} className="text-blue-500" />
                  Distance
                </label>
                {radioFilter === 'Distance' && (
                  <div className="flex items-center gap-2 ml-2">
                    <span className="text-gray-600">Start:</span>
                    <input type="text" value={distanceStart} onChange={e => setDistanceStart(e.target.value)} className="border border-gray-300 rounded px-2 py-0.5 w-20 focus:border-blue-400 focus:outline-none" />
                    <span className="text-gray-600 ml-2">End:</span>
                    <input type="text" value={distanceEnd} onChange={e => setDistanceEnd(e.target.value)} className="border border-gray-300 rounded px-2 py-0.5 w-20 focus:border-blue-400 focus:outline-none" />
                  </div>
                )}
              </div>
              <label className="flex items-center gap-2 cursor-pointer font-medium">
                <input type="radio" name="filter" checked={radioFilter === 'Chart'} onChange={() => setRadioFilter('Chart')} className="text-blue-500" />
                Chart
              </label>
            </div>
            <div className="flex gap-6 items-center border-l border-gray-300 pl-6">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={unmatchedOld} onChange={(e) => setUnmatchedOld(e.target.checked)} className="rounded text-blue-500" />
                Unmatched OLD
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={unmatchedNew} onChange={(e) => setUnmatchedNew(e.target.checked)} className="rounded text-blue-500" />
                Unmatched NEW
              </label>
            </div>
          </div>

          {/* Search Bar */}
          <div className="p-2 border-b border-gray-200 bg-white flex justify-between items-center">
            <div className="flex items-center gap-3 text-blue-600 pl-2">
              <FiFileText size={18} />
              <button 
                onClick={resetColumns}
                className="text-xs bg-gray-50 hover:bg-gray-100 text-gray-700 px-3 py-1 rounded border border-gray-200 transition-colors shadow-sm font-medium"
              >
                Reset Columns
              </button>
            </div>
            <div className="relative">
              <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input 
                type="text" 
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search" 
                className="pl-9 pr-4 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          {/* Chart View */}
          {radioFilter === 'Chart' ? (
             <div className="flex-1 p-8 overflow-auto bg-gray-50 flex items-center justify-center">
                <div className="w-full max-w-4xl bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
                  <h3 className="text-lg font-bold text-gray-800 mb-6">Filtered Depth Correlation</h3>
                  <div className="h-[400px]">
                    <Suspense fallback={<div className="flex items-center justify-center h-full text-gray-400 text-sm"><div className="w-6 h-6 border-4 border-blue-200 border-t-blue-500 rounded-full animate-spin mr-3" />Memuat chart...</div>}>
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
                <table className="w-max text-left border-collapse text-[11px] leading-tight table-fixed break-words min-w-full">
                  <thead className="bg-gray-50 text-gray-700 sticky top-0 border-b border-gray-200 shadow-sm z-10">
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
                          className={`px-2 py-2 font-bold border-r border-gray-200 whitespace-nowrap relative group select-none ${draggedColumn === col ? 'opacity-50 bg-gray-100' : ''}`}
                        >
                          <div className="flex flex-col gap-1">
                            <div className="flex justify-between items-center cursor-pointer hover:text-brand-600" onClick={() => {
                              let direction: 'asc' | 'desc' = 'asc';
                              if (sortConfig && sortConfig.key === col && sortConfig.direction === 'asc') direction = 'desc';
                              setSortConfig({ key: col, direction });
                            }}>
                              <span>{col}</span>
                              <span className="text-gray-400 text-[10px]">
                                {sortConfig?.key === col ? (sortConfig.direction === 'asc' ? '▲' : '▼') : '↕'}
                              </span>
                            </div>
                            <input 
                              type="text"
                              placeholder="Filter..."
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
                            className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize opacity-0 group-hover:opacity-100 bg-brand-400 hover:w-2 transition-all z-20"
                          />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr><td colSpan={visibleColumns.length} className="p-8 text-center text-gray-400">Loading data...</td></tr>
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
                          let bgClass = 'hover:bg-blue-50/50';
                          if (isMatch) {
                            if (featType.includes('valve')) bgClass = 'bg-purple-100 hover:bg-purple-200 text-purple-950';
                            else if (featType.includes('weld')) bgClass = 'bg-blue-100 hover:bg-blue-200 text-blue-950';
                            else if (featType.includes('bend')) bgClass = 'bg-yellow-100 hover:bg-yellow-200 text-yellow-950';
                            else if (featType.includes('anomaly') || featType.includes('metal') || featType.includes('dent') || featType.includes('corrosion')) bgClass = 'bg-red-100 hover:bg-red-200 text-red-950';
                            else bgClass = 'bg-gray-100 hover:bg-gray-200 text-gray-950';
                          }
                          if (isSelected) bgClass = 'bg-indigo-200 hover:bg-indigo-300 text-indigo-950 font-semibold';
                          
                          return (
                            <tr 
                              key={actualIdx} 
                              style={{ height: ROW_HEIGHT }} 
                              className={`transition-colors cursor-pointer ${bgClass} ${isDragTarget ? 'hover:bg-green-200 border-2 border-dashed border-green-500' : ''}`}
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
                                let val = row[col];
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
                                    className={`px-2 border-r border-gray-100 whitespace-nowrap overflow-hidden text-ellipsis ${
                                      j === 0 && isMatch ? (
                                        featType.includes('valve') ? 'border-l-4 border-purple-500' :
                                        featType.includes('weld') ? 'border-l-4 border-blue-500' :
                                        featType.includes('bend') ? 'border-l-4 border-yellow-500' :
                                        (featType.includes('anomaly') || featType.includes('metal') || featType.includes('dent') || featType.includes('corrosion')) ? 'border-l-4 border-red-500' :
                                        'border-l-4 border-gray-500'
                                      ) : ''
                                    } ${col === 'Depth Growth (%WT/yr)' || col === 'Length Growth (mm/yr)' ? 'font-bold text-blue-600' : ''} ${activeTab === 'Interventions' && isNewDataCol ? 'cursor-grab active:cursor-grabbing hover:bg-blue-50/80' : ''}`}
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
                <table className="w-full text-left border-collapse text-[11px] leading-tight table-fixed break-words">
                  <thead className="bg-gray-50 text-gray-700 sticky top-0 border-b border-gray-200 shadow-sm z-10">
                      <tr>
                        <th className="px-1 py-1 font-bold border-r border-gray-200">Defect ID</th>
                        <th className="px-1 py-1 font-bold border-r border-gray-200">Distance <span className="text-blue-500">m</span></th>
                        <th className="px-1 py-1 font-bold border-r border-gray-200">Dist. Adj <span className="text-blue-500">m</span></th>
                        <th className="px-1 py-1 font-bold border-r border-gray-200">Rel. to U/S Weld <span className="text-blue-500">m</span></th>
                        <th className="px-1 py-1 font-bold border-r border-gray-200">Rel. Nearest Weld <span className="text-blue-500">m</span></th>
                        <th className="px-1 py-1 font-bold border-r border-gray-200">Wall Thick <span className="text-blue-500">mm</span></th>
                        <th className="px-1 py-1 font-bold border-r border-gray-200">Orient <span className="text-blue-500">deg</span></th>
                        <th className="px-1 py-1 font-bold border-r border-gray-200">Length <span className="text-blue-500">mm</span></th>
                        <th className="px-1 py-1 font-bold border-r border-gray-200">Width <span className="text-blue-500">mm</span></th>
                        <th className="px-1 py-1 font-bold border-r border-gray-200">Depth <span className="text-blue-500">mm</span></th>
                        <th className="px-1 py-1 font-bold border-r border-gray-200">Flaw Depth <span className="text-blue-500">[%]</span></th>
                        <th className="px-1 py-1 font-bold">Wall Side</th>
                      </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                      {loading ? (
                        <tr><td colSpan={12} className="p-8 text-center text-gray-400">Loading data...</td></tr>
                      ) : (
                        sortedData.map((row: any, i: number) => {
                          const isOld = activeTab === 'ILI Run 1';
                          
                          const defectId = row[isOld ? 'Identif. OLD' : 'Identif. NEW'];
                          if (!defectId || defectId === '-') return null;
                          
                          const distance = row[isOld ? 'Log Dist OLD (m)' : 'Log Dist NEW (m)'];
                          const distGw = row[isOld ? 'Dist GW OLD (m)' : 'Dist GW NEW (m)'];
                          const wt = row[isOld ? 'Wall WT OLD (mm)' : 'Wall WT NEW (mm)'];
                          const oclock = row[isOld ? "O'Clock OLD" : "O'Clock NEW"];
                          const length = row[isOld ? 'Length OLD (mm)' : 'Length NEW (mm)'];
                          const width = row[isOld ? 'Width OLD (mm)' : 'Width NEW (mm)'];
                          const depth = row[isOld ? 'Depth OLD (%WT)' : 'Depth NEW (%WT)'];
                          const surface = row[isOld ? 'Surface OLD' : 'Surface NEW'] ?? 'Internal';
                          
                          const distFormatted = typeof distance === 'number' ? distance.toFixed(3) : '';
                          const distAdj = typeof distance === 'number' ? (distance - 0.1).toFixed(3) : '';
                          const nearWeld = distGw ? (parseFloat(distGw) - 0.05).toFixed(2) : '';
                          const perc = (parseFloat(depth) / parseFloat(wt) * 100).toFixed(1);

                          return (
                            <tr key={i} className="hover:bg-blue-50/50 transition-colors">
                              <td className="px-1 py-1 border-r border-gray-100">{defectId}</td>
                              <td className="px-1 py-1 border-r border-gray-100">{distFormatted}</td>
                              <td className="px-1 py-1 border-r border-gray-100 bg-gray-50">{distAdj}</td>
                              <td className="px-1 py-1 border-r border-gray-100">{distGw}</td>
                              <td className="px-1 py-1 border-r border-gray-100">{nearWeld}</td>
                              <td className="px-1 py-1 border-r border-gray-100">{wt}</td>
                              <td className="px-1 py-1 border-r border-gray-100">{oclock}</td>
                              <td className="px-1 py-1 border-r border-gray-100">{length}</td>
                              <td className="px-1 py-1 border-r border-gray-100">{width}</td>
                              <td className="px-1 py-1 border-r border-gray-100">{depth}</td>
                              <td className="px-1 py-1 border-r border-gray-100">{isNaN(Number(perc)) ? '-' : perc}</td>
                              <td className="px-1 py-1 text-blue-600 font-medium">{surface}</td>
                            </tr>
                          );
                        })
                      )}
                  </tbody>
                </table>
              )}
            </div>
          )}
          
          {radioFilter !== 'Chart' && <PaginationFooter />}
        </div>
      )}

    </div>
  );

  return isFullScreen ? createPortal(panelContent, document.body) : panelContent;
}
