import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Line } from 'react-chartjs-2';
import { FiX, FiBox, FiChevronRight, FiChevronLeft, FiEdit, FiDownload, FiSearch } from 'react-icons/fi';
import Pipeline3DViewer from '../components/3d/Pipeline3DViewer';
import OdometerDashboard from './OdometerDashboard';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Tooltip } from 'chart.js';
import { apiFetch, ApiError } from '../utils/api';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip);

interface StepGwSimulatorProps {
  initialOta: number;
  onNext: (data?: any) => void;
  onBack: () => void;
  config?: any;
}

export default function StepGwSimulator({ initialOta, onNext, onBack, config }: StepGwSimulatorProps) {
  const [ota, setOta] = useState(initialOta); // Preserve the accepted OTA when navigating back.
  const [zoom, setZoom] = useState(150);
  const [selectedGWs, setSelectedGWs] = useState<number[]>([]);
  const [selectedTrack, setSelectedTrack] = useState<'old' | 'new' | null>(null);
  const [show3DViewer, setShow3DViewer] = useState(false);
  const [tooltipState, setTooltipState] = useState<{ x: number, y: number, row: any } | null>(null);

  const [activeTab, setActiveTab] = useState<'offset' | 'unmatched' | 'matched' | 'table' | 'odometer' | 'all'>('all');

  const handleDownloadExcel = async () => {
    const Papa = (await import('papaparse')).default;
    const dataToExport = matches.map((m: any, index: number) => ({
      'No.': index + 1,
      'Status': m.status,
      'Baseline Odometer (m)': m.oldVal !== null ? m.oldVal.toFixed(3) : '-',
      'Raw Odometer (m)': m.newVal !== null ? m.newVal.toFixed(3) : '-',
      'Deviation (%)': m.varPct.toFixed(2) + '%',
      'Offset (m)': m.offset !== null ? m.offset.toFixed(3) : '-',
      'Flagged (>5%)': m.flagged ? 'Yes' : 'No'
    }));

    const csv = Papa.unparse(dataToExport);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    link.href = url;
    link.download = 'GW_Match_Report.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const [dtwOn, setDtwOn] = useState(true);
  const [useValveAnchor, setUseValveAnchor] = useState(true);
  const [strictPenalty, setStrictPenalty] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const tableRowRefs = useRef<{[key: string]: HTMLTableRowElement | null}>({});
  const itemsPerPage = 10;
  
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editRun1, setEditRun1] = useState<string>('');
  const [editRun2, setEditRun2] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [valveMatches, setValveMatches] = useState<any[]>([]);



  const handleGWClick = (pos: number, track: 'old' | 'new') => {
    // Scroll to the corresponding row in the table
    const targetMatch = matches.find(m => track === 'old' ? m.oldVal === pos : m.newVal === pos);
    if (targetMatch && tableRowRefs.current[targetMatch.id]) {
      tableRowRefs.current[targetMatch.id]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    if (selectedTrack !== track) {
      setSelectedTrack(track);
      setSelectedGWs([pos]);
      return;
    }

    setSelectedGWs(prev => {
      if (prev.includes(pos)) {
        const newSelection = prev.filter(p => p !== pos);
        if (newSelection.length === 0) setSelectedTrack(null);
        return newSelection;
      }
      if (prev.length >= 2) return [pos]; // Reset to just this one
      const newSelection = [...prev, pos].sort((a, b) => a - b);
      return newSelection;
    });
  };

  const [matches, setMatches] = useState<any[]>([]);
  const [gwMatchesFinal, setGwMatchesFinal] = useState<any[]>([]);
  const [gwOrphans, setGwOrphans] = useState<any[]>([]);
  const [alignedFeatures, setAlignedFeatures] = useState<any[]>([]);
  const [oldGWs, setOldGWs] = useState<number[]>([]);
  const [newGWs, setNewGWs] = useState<number[]>([]);
  const [oldValves, setOldValves] = useState<number[]>([]);
  const [newValves, setNewValves] = useState<number[]>([]);
  const [oldTees, setOldTees] = useState<number[]>([]);
  const [newTees, setNewTees] = useState<number[]>([]);
  const [isCalculating, setIsCalculating] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    
    const calculateDTW = async () => {
      setIsCalculating(true);
      setLoadError(null);
      try {
        const globalOffset = config?.globalOffset || 0;
        const featureTypeText = (feature: any) => [
          feature.type,
          feature.feature_type,
          feature.feature_identification,
          feature.originalType,
        ].filter((value) => value !== null && value !== undefined)
          .map((value) => String(value).toLowerCase())
          .join(' ');
        const finiteDistance = (feature: any) => {
          const candidates = [
            feature.dist,
            feature.log_distance_m,
            feature.logDistance,
            feature.distance,
            feature.chainage,
            feature.odometer,
          ];
          for (const candidate of candidates) {
            const raw = String(candidate ?? '').trim();
            if (!raw) continue;
            const parsed = Number(raw.replace(/,/g, ''));
            if (Number.isFinite(parsed)) return parsed;
          }
          return null;
        };
        const selectAlignmentAnchors = (features: any[]) => features
          .filter((feature) => /weld|girth|seam|valve|tee/.test(featureTypeText(feature)))
          .map((feature) => ({ ...feature, dist: finiteDistance(feature) }))
          .filter((feature) => feature.dist !== null);
        const rawOldRun = selectAlignmentAnchors(config?.summaryData?.oldRun?.rawFeatures || []);
        const rawNewRun = selectAlignmentAnchors(config?.summaryData?.newRun?.rawFeatures || []);

        if (rawOldRun.length === 0 || rawNewRun.length === 0) {
          setMatches([]);
          setLoadError('Data anchor belum tersedia. Pastikan kedua file ILI berisi fitur Weld, Valve, atau Tee.');
          return;
        }
        
        // Apply global offset to new run features if partial run mode is enabled
        const adjustedNewRun = globalOffset !== 0 
          ? rawNewRun.map((f: any) => ({ ...f, dist: f.dist + globalOffset }))
          : rawNewRun;

        const payload = {
          ota,
          strictPenalty,
          useValveAnchor,
          applyDtwCorrection: dtwOn,
          oldRun: rawOldRun,
          newRun: adjustedNewRun,
          globalOffset
        };
        
        const data = await apiFetch<any>('/api/align-dtw', {
          method: 'POST',
          signal: controller.signal,
          body: JSON.stringify(payload)
        });
        
        if (data.success && Array.isArray(data.gwMatches)) {
          if (data.alignedFeatures) setAlignedFeatures(data.alignedFeatures);
          if (data.gwMatchesFinal) setGwMatchesFinal(data.gwMatchesFinal);
          if (data.gwOrphans) setGwOrphans(data.gwOrphans);
          
          // Extract old and new distances just for the visualizer scales
          const oldW = payload.oldRun.filter((f: any) => /weld|girth|seam/.test(featureTypeText(f))).map((f: any) => f.dist);
          const newW = payload.newRun.filter((f: any) => /weld|girth|seam/.test(featureTypeText(f))).map((f: any) => f.dist);
          const oldValves = payload.oldRun.filter((f: any) => featureTypeText(f).includes('valve')).map((f: any) => f.dist);
          const newValves = payload.newRun.filter((f: any) => featureTypeText(f).includes('valve')).map((f: any) => f.dist);
          const oldTees = payload.oldRun.filter((f: any) => featureTypeText(f).includes('tee')).map((f: any) => f.dist);
          const newTees = payload.newRun.filter((f: any) => featureTypeText(f).includes('tee')).map((f: any) => f.dist);
          
          setOldGWs(oldW);
          setNewGWs(newW);
          setOldValves(oldValves);
          setNewValves(newValves);
          setOldTees(oldTees);
          setNewTees(newTees);
          
          if (data.valveAnchors) {
            setValveMatches(data.valveAnchors);
          } else {
            setValveMatches([]);
          }
          
          const formattedMatches = data.gwMatches.map((m: any, idx: number) => {
              const isMatch = m && m.status === 'Match';
              const rawOffset = m.newDist !== null && m.oldDist !== null ? (m.newDist - m.oldDist) : null;
              
              let correctedNewVal = m.newDist;
              let correctedOffset = rawOffset;
              
              const oldFeature = m.oldId ? config?.summaryData?.oldRun?.rawFeatures?.find((f: any) => f.id === m.oldId) : null;
              const newFeature = m.newId ? config?.summaryData?.newRun?.rawFeatures?.find((f: any) => f.id === m.newId) : null;
              const oldDesc = oldFeature ? (oldFeature.feature_identification || oldFeature.originalType || 'Weld') : '(Missing)';
              const newDesc = newFeature ? (newFeature.feature_identification || newFeature.originalType || 'Weld') : '(Missing)';

              const finalVarPct = isMatch && m.deviation_ratio !== undefined && m.deviation_ratio !== null 
                  ? m.deviation_ratio * 100 
                  : 0;

              return {
                id: `match-${idx}`,
                oldIndex: m.oldIndex, newIndex: m.newIndex,
                oldId: m.oldId, newId: m.newId,
                oldDesc, newDesc,
                oldVal: m.oldDist, newVal: correctedNewVal,
                originalNewVal: m.newDist !== null ? m.newDist - globalOffset : null,
                varPct: finalVarPct,
                offset: correctedOffset,
                status: m.status,
                deviationRatio: m.deviation_ratio,
                flagged: m.flagged,
                sOld: m.L_ref, sNew: m.L_new, rawVarPct: m.deviation_ratio ? m.deviation_ratio * 100 : 0, rawOffset,
              };
          });

          setMatches(formattedMatches);
        } else {
          throw new Error(data.error || 'Server tidak mengembalikan hasil GW matching.');
        }
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          console.error("Failed to run DTW:", err);
          setLoadError(err instanceof ApiError && err.status === 401
            ? 'Sesi login sudah kedaluwarsa. Silakan masuk kembali.'
            : `Gagal memuat hasil GW matching: ${err.message || 'periksa koneksi backend.'}`);
        }
      } finally {
        setIsCalculating(false);
      }
    };
    
    // Debounce: cancel rapid slider drags, fire only after user stops moving for 300ms
    const timeout = setTimeout(calculateDTW, 300);
    return () => {
      clearTimeout(timeout);
    };
  }, [ota, strictPenalty, useValveAnchor, dtwOn, config, retryNonce]);

  const unmatchedRanges = useMemo(() => {
    const ranges: any[] = [];
    let currentRange: any = null;

    matches.forEach(m => {
      if (m.status === 'Skipped') {
        if (!currentRange) {
           currentRange = {
             id: m.id,
             oldFrom: m.oldVal, oldTo: m.oldVal,
             newFrom: m.newVal, newTo: m.newVal
           };
        } else {
           if (m.oldVal !== null) {
              if (currentRange.oldFrom === null) currentRange.oldFrom = m.oldVal;
              currentRange.oldTo = m.oldVal;
           }
           if (m.newVal !== null) {
              if (currentRange.newFrom === null) currentRange.newFrom = m.newVal;
              currentRange.newTo = m.newVal;
           }
        }
      } else {
        if (currentRange) {
           ranges.push(currentRange);
           currentRange = null;
        }
      }
    });
    if (currentRange) ranges.push(currentRange);
    return ranges;
  }, [matches]);

  const matchedOnly = useMemo(
    () => matches.filter(m => m.status === 'Match').sort((a, b) => a.oldVal - b.oldVal),
    [matches],
  );
  const filteredMatched = matchedOnly.filter(m => 
    searchQuery === '' || 
    (m.oldVal !== null && m.oldVal.toString().includes(searchQuery)) ||
    (m.newVal !== null && m.newVal.toString().includes(searchQuery))
  );
  
  const paginatedMatched = filteredMatched.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  const totalPages = Math.ceil(filteredMatched.length / itemsPerPage);


  // Build the chart from the exact rows shown in the matched table.  The
  // table and chart therefore use the same x-position and offset value,
  // including when a long-running backend worker returns a legacy payload.
  const chartPoints = useMemo(() => {
    return matchedOnly
      .map((match) => ({
        x: match.oldVal as number,
        y: match.offset as number,
        match,
      }))
      .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  }, [matchedOnly]);

  const graphPoints = chartPoints.map(({ x, y }) => ({ x, y }));

  const chartData = {
    datasets: [{
      label: 'Offset (New - Old) m',
      data: graphPoints,
      borderColor: '#93c5fd', // Light blue
      backgroundColor: '#93c5fd',
      borderWidth: 1.5,
      pointBackgroundColor: '#93c5fd',
      pointRadius: 0,
      pointHoverRadius: 4,
      pointHitRadius: 10,
      tension: 0,
      parsing: false as const,
      normalized: true,
    }]
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: {
        type: 'linear' as const,
        grid: { color: 'rgba(0,0,0,0.05)' },
        ticks: { color: '#9ca3af' },
        title: { display: true, text: 'Pipeline Length (m) →', color: '#9ca3af', align: 'end' as const }
      },
      y: {
        grid: { color: 'rgba(0,0,0,0.05)' },
        ticks: { color: '#9ca3af' },
        title: { display: true, text: 'Offset (New - Old) m ↑', color: '#9ca3af', align: 'end' as const }
      }
    }
  };

  // Helper for visualizing Timeline UI
  const finiteDistances = [...oldGWs, ...newGWs].filter(Number.isFinite);
  const maxDist = Math.max(10, ...finiteDistances) + 10;
  const getPosPct = (val: number) => Math.max(0, Math.min(100, (val / maxDist) * 100));

  return (
    <div className="bg-transparent text-gray-800 font-sans flex flex-col gap-6 animate-fade-in">
      {loadError && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 shadow-sm">
          <span>{loadError}</span>
          <button
            type="button"
            onClick={() => setRetryNonce((value) => value + 1)}
            className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100"
          >
            Coba lagi
          </button>
        </div>
      )}
      
      {/* 2-Column Dashboard Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-5 items-start">
        
        {/* LEFT COLUMN: Visuals & Trends */}
        <div className="xl:col-span-3 flex flex-col gap-5">
          
          {/* Top: Timeline Viewer */}
          <div className="bg-white rounded-2xl p-6 shadow-xl shadow-blue-900/5 border border-gray-200 flex flex-col">
            {/* Visualizer Header */}
            <div className="flex justify-between items-end mb-4 border-b border-gray-100 pb-4">
              <div className="flex items-center gap-4">
                <div>
                  <h3 className="text-lg font-bold text-gray-800">Timeline Viewer</h3>
                  <p className="text-xs font-medium text-gray-500 mt-1">{(maxDist / 1000).toFixed(1)}+ km Interactive Pipeline Alignment Map</p>
                </div>
                {selectedGWs.length === 2 && (
                  <div className="flex items-center gap-3 bg-yellow-400/10 px-4 py-1.5 rounded-full border border-yellow-400/30 animate-fade-in">
                    <span className="text-xs text-yellow-500 font-mono font-bold">
                      Spool Length: {(selectedGWs[1] - selectedGWs[0]).toFixed(2)}m
                    </span>
                    <button 
                      onClick={() => setShow3DViewer(true)}
                      className="flex items-center gap-2 bg-yellow-500 hover:bg-yellow-400 text-gray-900 text-xs font-bold px-3 py-1 rounded shadow-md transition-colors"
                    >
                      <FiBox /> View in 3D
                    </button>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 bg-gray-50 px-4 py-2 rounded-xl border border-gray-200 shadow-inner">
                <span className="text-xs font-bold text-gray-500 tracking-wide uppercase">Zoom</span>
                <input 
                  type="range" min="100" max="200000" step="500" 
                  value={zoom} onChange={(e) => setZoom(parseInt(e.target.value))}
                  className="w-32 h-1.5 bg-gray-300 rounded-lg appearance-none cursor-pointer accent-blue-600"
                />
              </div>
            </div>

            {/* Timeline Visualizer */}
            <div className="relative h-72 bg-gradient-to-r from-gray-50 to-white rounded-xl border border-gray-200 overflow-x-auto custom-scrollbar shadow-inner">
              {isCalculating && (
                <div className="absolute top-2 right-2 z-50">
                  <div className="bg-blue-50 border border-blue-200 px-3 py-1.5 rounded-lg shadow-sm font-bold text-blue-600 text-xs flex items-center gap-2">
                    <svg className="animate-spin h-3.5 w-3.5 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373,0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                    Updating...
                  </div>
                </div>
              )}
              <div className="relative h-full" style={{ width: `${zoom}%`, minWidth: '100%', padding: '0 40px' }}>
                <div className="relative w-full h-full">
                  <div className="absolute top-4 left-0 text-[10px] font-bold text-gray-400 tracking-wider uppercase sticky">
                    {config?.summaryData?.oldRun?.year ? `${config.summaryData.oldRun.year} (Reference)` : 'Run Old (Reference)'}
                  </div>
                  <div className="absolute top-[70px] left-0 right-0 h-px bg-green-500/50"></div>
                  
                  {/* Dashed Lines for Matches */}
                  <svg className="absolute inset-0 w-full h-full pointer-events-none z-0">
                    {matches.filter(m => m.status === 'Match' && m.oldVal !== null && m.newVal !== null).map((m, i) => (
                      <line 
                        key={`match-line-${i}`} 
                        x1={`${getPosPct(m.oldVal)}%`} y1="70" 
                        x2={`${getPosPct(m.newVal)}%`} y2="200" 
                        stroke="#22c55e" strokeWidth="1.5" strokeDasharray="4 4" className="opacity-40" 
                      />
                    ))}
                    {valveMatches.map((m, i) => (
                      <line 
                        key={`valve-match-line-${i}`} 
                        x1={`${getPosPct(m.old_dist)}%`} y1="70" 
                        x2={`${getPosPct(m.new_dist)}%`} y2="200" 
                        stroke="#22c55e" strokeWidth="2" strokeDasharray="6 4" className="opacity-60" 
                      />
                    ))}
                  </svg>
                  
                  {/* Valves - Old Run */}
                  {oldValves.map((pos, i) => {
                    const isMatched = valveMatches.some(vm => vm.old_dist === pos);
                    const isSelected = selectedGWs.includes(pos);
                    return (
                    <div 
                      key={`old-valve-${i}`} 
                      className={`absolute top-[52px] flex flex-col items-center z-10 cursor-pointer group`}
                      style={{ left: `${getPosPct(pos)}%`, transform: 'translateX(-50%)' }}
                      onClick={() => handleGWClick(pos, 'old')}
                    >
                      <div className={`text-[8px] font-bold mb-1 uppercase tracking-tighter ${isSelected && selectedTrack === 'old' ? 'text-yellow-500' : isMatched ? 'text-green-600' : 'text-purple-600'}`}>VALVE</div>
                      <div className={`w-3 h-3 border border-white rounded-full shadow-sm transition-transform ${isSelected && selectedTrack === 'old' ? 'bg-yellow-400 scale-125' : isMatched ? 'bg-green-500 group-hover:scale-110' : 'bg-purple-500 group-hover:scale-110'}`}></div>
                    </div>
                  )})}

                  {/* Tees - Old Run */}
                  {oldTees.map((pos, i) => {
                    const isMatched = valveMatches.some(vm => vm.old_dist === pos);
                    const isSelected = selectedGWs.includes(pos);
                    return (
                    <div 
                      key={`old-tee-${i}`} 
                      className={`absolute top-[52px] flex flex-col items-center z-10 cursor-pointer group`}
                      style={{ left: `${getPosPct(pos)}%`, transform: 'translateX(-50%)' }}
                      onClick={() => handleGWClick(pos, 'old')}
                    >
                      <div className={`text-[8px] font-bold mb-1 uppercase tracking-tighter ${isSelected && selectedTrack === 'old' ? 'text-yellow-500' : isMatched ? 'text-green-600' : 'text-purple-600'}`}>TEE</div>
                      <div className={`w-3 h-3 border border-white rounded-full shadow-sm transition-transform ${isSelected && selectedTrack === 'old' ? 'bg-yellow-400 scale-125' : isMatched ? 'bg-green-500 group-hover:scale-110' : 'bg-purple-500 group-hover:scale-110'}`}></div>
                    </div>
                  )})}
                  
                  {oldGWs.map((pos, i) => {
                    const m = matches.find(mx => mx.oldVal === pos);
                    const isMatched = m && m.status === 'Match';
                    const isFlagged = isMatched && m.flagged;
                    const isSelected = selectedGWs.includes(pos);
                    return (
                    <div 
                      key={`old-${i}`} 
                      className="absolute top-[60px] flex flex-col items-center cursor-pointer group z-20" 
                      style={{ left: `${getPosPct(pos)}%`, transform: 'translateX(-50%)' }}
                      onClick={() => handleGWClick(pos, 'old')}
                    >
                      <div className={`w-1.5 h-5 rounded-full transition-all shadow-sm ${isSelected && selectedTrack === 'old' ? 'bg-yellow-400 scale-125 shadow-yellow-500/50' : isFlagged ? 'bg-amber-400 group-hover:bg-amber-300' : isMatched ? 'bg-green-500 group-hover:bg-green-400 group-hover:scale-110' : 'bg-red-500 group-hover:bg-red-400'}`}></div>
                      <div className={`text-[9px] mt-1.5 font-mono font-bold ${isSelected && selectedTrack === 'old' ? 'text-yellow-500' : isFlagged ? 'text-amber-500' : isMatched ? 'text-green-600/80' : 'text-red-500'}`}>{pos.toFixed(2)}m</div>
                    </div>
                    )
                  })}

                  {/* Selected Spool Highlight for Old */}
                  {selectedGWs.length === 2 && selectedTrack === 'old' && (
                    <div 
                      className="absolute top-[60px] h-5 bg-yellow-400/20 border-y border-yellow-400/50 z-10 animate-pulse rounded"
                      style={{ 
                        left: `${getPosPct(selectedGWs[0])}%`, 
                        width: `${getPosPct(selectedGWs[1]) - getPosPct(selectedGWs[0])}%` 
                      }}
                    />
                  )}

                  <div className="absolute top-[170px] left-0 text-[10px] font-bold text-gray-400 tracking-wider uppercase sticky">
                    {config?.summaryData?.newRun?.year ? `${config.summaryData.newRun.year} (Current)` : 'Run New (Current)'}
                  </div>
                  <div className="absolute top-[200px] left-0 right-0 h-px bg-blue-500/50"></div>
                  
                  {/* Valves - New Run */}
                  {newValves.map((pos, i) => {
                    // Match against original dist or adjusted pos? valveAnchors returns the adjusted pos!
                    const isMatched = valveMatches.some(vm => vm.new_dist === pos);
                    const isSelected = selectedGWs.includes(pos);
                    return (
                    <div 
                      key={`new-valve-${i}`} 
                      className={`absolute top-[182px] flex flex-col items-center z-10 cursor-pointer group`}
                      style={{ left: `${getPosPct(pos)}%`, transform: 'translateX(-50%)' }}
                      onClick={() => handleGWClick(pos, 'new')}
                    >
                      <div className={`text-[8px] font-bold mb-1 uppercase tracking-tighter ${isSelected && selectedTrack === 'new' ? 'text-yellow-500' : isMatched ? 'text-green-600' : 'text-purple-600'}`}>VALVE</div>
                      <div className={`w-3 h-3 border border-white rounded-full shadow-sm transition-transform ${isSelected && selectedTrack === 'new' ? 'bg-yellow-400 scale-125' : isMatched ? 'bg-green-500 group-hover:scale-110' : 'bg-purple-500 group-hover:scale-110'}`}></div>
                    </div>
                  )})}

                  {/* Tees - New Run */}
                  {newTees.map((pos, i) => {
                    const isMatched = valveMatches.some(vm => vm.new_dist === pos);
                    const isSelected = selectedGWs.includes(pos);
                    return (
                    <div 
                      key={`new-tee-${i}`} 
                      className={`absolute top-[182px] flex flex-col items-center z-10 cursor-pointer group`}
                      style={{ left: `${getPosPct(pos)}%`, transform: 'translateX(-50%)' }}
                      onClick={() => handleGWClick(pos, 'new')}
                    >
                      <div className={`text-[8px] font-bold mb-1 uppercase tracking-tighter ${isSelected && selectedTrack === 'new' ? 'text-yellow-500' : isMatched ? 'text-green-600' : 'text-purple-600'}`}>TEE</div>
                      <div className={`w-3 h-3 border border-white rounded-full shadow-sm transition-transform ${isSelected && selectedTrack === 'new' ? 'bg-yellow-400 scale-125' : isMatched ? 'bg-green-500 group-hover:scale-110' : 'bg-purple-500 group-hover:scale-110'}`}></div>
                    </div>
                  )})}
                  
                  {newGWs.map((pos, i) => {
                    const m = matches.find(mx => mx.newVal === pos);
                    const isMatched = m && m.status === 'Match';
                    const isFlagged = isMatched && m.flagged;
                    const isSelected = selectedGWs.includes(pos);
                    const originalPos = pos - (config?.globalOffset || 0);
                    return (
                      <div 
                        key={`new-${i}`} 
                        className="absolute top-[190px] flex flex-col items-center cursor-pointer group z-20" 
                        style={{ left: `${getPosPct(pos)}%`, transform: 'translateX(-50%)' }}
                        onClick={() => handleGWClick(pos, 'new')}
                      >
                        <div className={`w-1.5 h-5 rounded-full transition-all shadow-sm ${isSelected && selectedTrack === 'new' ? 'bg-yellow-400 scale-125 shadow-yellow-500/50' : isFlagged ? 'bg-amber-400 group-hover:bg-amber-300' : isMatched ? 'bg-green-500 group-hover:bg-green-400 group-hover:scale-110' : 'bg-red-500 group-hover:bg-red-400'}`}></div>
                        <div className={`text-[9px] mt-1.5 font-mono font-bold ${isSelected && selectedTrack === 'new' ? 'text-yellow-500' : isFlagged ? 'text-amber-500' : isMatched ? 'text-green-600/80' : 'text-red-500'}`}>{originalPos.toFixed(2)}m</div>
                      </div>
                    )
                  })}

                  {/* Selected Spool Highlight for New */}
                  {selectedGWs.length === 2 && selectedTrack === 'new' && (
                    <div 
                      className="absolute top-[190px] h-5 bg-yellow-400/20 border-y border-yellow-400/50 z-10 animate-pulse rounded"
                      style={{ 
                        left: `${getPosPct(selectedGWs[0])}%`, 
                        width: `${getPosPct(selectedGWs[1]) - getPosPct(selectedGWs[0])}%` 
                      }}
                    />
                  )}

                  {/* Draw dashed lines connecting matches */}
                  <svg className="absolute inset-0 w-full h-full pointer-events-none">
                    {/* MATCHING LINES */}
                    {matches.filter(m => m.status === 'Match' || m.status === 'Flagged').map((m, i) => {
                        const x1 = `${getPosPct(m.oldVal as number)}%`;
                        const y1 = 80; // bottom of old text
                        const x2 = `${getPosPct(m.newVal as number)}%`;
                        const y2 = 190; // top of new tick
                        const isFlagged = m.status === 'Flagged';
                        return (
                          <line key={`line-${i}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke={isFlagged ? "rgba(251, 191, 36, 0.4)" : "rgba(147, 197, 253, 0.3)"} strokeWidth="1" strokeDasharray="3 3" />
                        );
                    })}
                  </svg>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: Tables & Analytics */}
        <div className="xl:col-span-2 flex flex-col gap-5">
          
          {/* Data Tables Container */}
          <div className="bg-white rounded-2xl shadow-xl shadow-blue-900/5 border border-gray-200 flex flex-col overflow-hidden" style={{ height: 'calc(100vh - 280px)', minHeight: '500px', maxHeight: '750px' }}>
            
            {/* Tabs Header */}
            <div className="flex border-b border-gray-200 bg-gray-50">
              {[
                { id: 'all', label: 'All GWs' },
                { id: 'matched', label: 'Matched' },
                { id: 'unmatched', label: 'Unmatched' }
              ].map(tab => (
                <button
                  key={tab.id}
                  onClick={() => { setActiveTab(tab.id as any); setCurrentPage(1); }}
                  className={`flex-1 py-3 text-xs font-bold transition-colors border-b-2 tracking-wide uppercase ${
                    activeTab === tab.id || (activeTab === 'offset' && tab.id === 'all') || (activeTab === 'odometer' && tab.id === 'all')
                      ? 'border-blue-600 text-blue-600 bg-white shadow-[0_2px_0_0_white]' 
                      : 'border-transparent text-gray-500 hover:text-gray-800 hover:bg-gray-100'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="flex-1 flex flex-col overflow-hidden relative">
              {/* Unmatched Table */}
              {(activeTab === 'unmatched') && (
                <div className="absolute inset-0 flex flex-col bg-white">
                  <div className="p-2 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                    <span className="text-xs font-bold text-gray-600 pl-2">Anomalies Detected</span>
                    <button className="text-gray-500 hover:text-gray-800 p-1.5 hover:bg-gray-200 rounded transition-colors"><FiDownload size={14} /></button>
                  </div>
                  <div className="flex-1 overflow-auto custom-scrollbar">
                    <table className="w-full text-left text-[11px] leading-tight">
                      <thead className="text-gray-500 bg-gray-50 sticky top-0 border-b border-gray-200 z-10 shadow-sm">
                        <tr>
                          <th className="px-3 py-2 font-bold">Old From</th>
                          <th className="px-3 py-2 font-bold">New From</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {unmatchedRanges.map((r, idx) => (
                          <tr key={idx} className="hover:bg-rose-50/50 transition-colors group">
                            <td className="px-3 py-2 font-mono text-gray-700">{r.oldFrom !== null ? r.oldFrom.toFixed(3) : ''}</td>
                            <td className="px-3 py-2 font-mono text-gray-700">{r.newFrom !== null ? r.newFrom.toFixed(3) : ''}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Matched Table */}
              {(activeTab === 'matched') && (
                <div className="absolute inset-0 flex flex-col bg-white">
                  <div className="p-2 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                    <div className="relative flex-1 max-w-[180px]">
                      <FiSearch className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" size={12} />
                      <input 
                        type="text" placeholder="Search GW..." 
                        value={searchQuery} onChange={(e) => {setSearchQuery(e.target.value); setCurrentPage(1);}}
                        className="w-full pl-7 pr-2 py-1 text-xs border border-gray-200 rounded bg-white focus:outline-none focus:border-blue-500" 
                      />
                    </div>
                    <button className="text-gray-500 hover:text-gray-800 p-1.5 hover:bg-gray-200 rounded transition-colors"><FiDownload size={14} /></button>
                  </div>
                  <div className="flex-1 overflow-auto custom-scrollbar">
                    <table className="w-full text-left text-[11px] leading-tight">
                      <thead className="text-gray-500 bg-gray-50 sticky top-0 border-b border-gray-200 z-10 shadow-sm">
                        <tr>
                          <th className="px-2 py-2 w-8 text-center font-bold"></th>
                          <th className="px-3 py-2 font-bold">Old Run (m)</th>
                          <th className="px-3 py-2 font-bold">Old Desc</th>
                          <th className="px-3 py-2 font-bold">New Run (m)</th>
                          <th className="px-3 py-2 font-bold">New Desc</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {paginatedMatched.map((row) => (
                          <React.Fragment key={row.id}>
                            <tr className={`hover:bg-blue-50/50 transition-colors ${editingId === row.id ? 'bg-blue-50/80 border-l-2 border-blue-500' : 'border-l-2 border-transparent'}`}>
                              <td className="px-2 py-2 text-center">
                                {editingId === row.id ? (
                                  <button onClick={() => setEditingId(null)} className="text-rose-500 hover:text-rose-700 transition-colors"><FiX size={14} /></button>
                                ) : (
                                  <button onClick={() => { setEditingId(row.id); setEditRun1(row.oldVal?.toFixed(3) || ''); setEditRun2(row.originalNewVal?.toFixed(3) || ''); }} className="text-gray-400 hover:text-blue-600 transition-colors"><FiEdit size={12} /></button>
                                )}
                              </td>
                              <td className="px-3 py-2 font-mono text-gray-700">{row.oldVal !== null ? row.oldVal.toFixed(3) : '-'}</td>
                              <td className="px-3 py-2 text-gray-500 truncate max-w-[100px]" title={row.oldDesc}>{row.oldDesc}</td>
                              <td className="px-3 py-2 font-mono text-gray-700">{row.originalNewVal !== undefined && row.originalNewVal !== null ? row.originalNewVal.toFixed(3) : '-'}</td>
                              <td className="px-3 py-2 text-gray-500 truncate max-w-[100px]" title={row.newDesc}>{row.newDesc}</td>
                            </tr>
                            {editingId === row.id && (
                              <tr className="bg-white">
                                <td colSpan={5} className="px-4 py-3 border-b border-gray-200 bg-blue-50/30">
                                  <div className="flex gap-2 mb-2">
                                    <input type="text" value={editRun1} onChange={e => setEditRun1(e.target.value)} className="w-full px-2 py-1 text-xs border border-gray-300 rounded font-mono" />
                                    <input type="text" value={editRun2} onChange={e => setEditRun2(e.target.value)} className="w-full px-2 py-1 text-xs border border-gray-300 rounded font-mono" />
                                  </div>
                                  <div className="flex justify-end gap-2">
                                    <button onClick={() => setEditingId(null)} className="px-3 py-1 bg-blue-600 text-white text-[10px] font-bold rounded">Save</button>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {/* Pagination Mini */}
                  <div className="px-3 py-2 bg-gray-50 border-t border-gray-200 flex justify-between items-center text-[10px]">
                    <div className="flex gap-1">
                      <button onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))} className="p-1 text-gray-500 hover:bg-gray-200 rounded"><FiChevronLeft/></button>
                      <span className="p-1 font-bold text-gray-700">{currentPage} / {totalPages}</span>
                      <button onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))} className="p-1 text-gray-500 hover:bg-gray-200 rounded"><FiChevronRight/></button>
                    </div>
                  </div>
                </div>
              )}

              {/* All Table (Default) */}
              {(activeTab === 'all' || activeTab === 'offset' || activeTab === 'odometer') && (
                <div className="absolute inset-0 flex flex-col bg-white">
                   <div className="p-2 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                    <span className="text-xs font-bold text-gray-600 pl-2">All Pipeline Features</span>
                    <button onClick={handleDownloadExcel} className="text-blue-600 bg-blue-50 hover:bg-blue-100 flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-bold rounded transition-colors uppercase"><FiDownload /> Export</button>
                  </div>
                  <div className="flex-1 overflow-auto custom-scrollbar">
                    <table className="w-full text-left text-[11px] leading-tight">
                      <thead className="text-gray-500 bg-gray-50 sticky top-0 border-b border-gray-200 z-10 shadow-sm">
                        <tr>
                          <th className="px-3 py-2 font-bold w-6"></th>
                          <th className="px-3 py-2 font-bold">Old Run (m)</th>
                          <th className="px-3 py-2 font-bold hidden md:table-cell">Old Desc</th>
                          <th className="px-3 py-2 font-bold">New Run (m)</th>
                          <th className="px-3 py-2 font-bold hidden md:table-cell">New Desc</th>
                          <th className="px-3 py-2 font-bold text-right">Offset</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {!isCalculating && matches.length === 0 && (
                          <tr>
                            <td colSpan={6} className="px-3 py-10 text-center text-gray-500">
                              {loadError || 'Belum ada hasil matching untuk ditampilkan.'}
                            </td>
                          </tr>
                        )}
                        {matches.map((row) => (
                          <tr key={row.id} 
                            ref={(el: HTMLTableRowElement | null) => { if (el) tableRowRefs.current[row.id] = el; }}
                            className={`transition-colors cursor-pointer group ${
                              (row.oldVal !== null && selectedGWs.includes(row.oldVal)) || (row.newVal !== null && selectedGWs.includes(row.newVal))
                                ? 'bg-yellow-100 hover:bg-yellow-200' 
                                : row.status === 'Skipped'
                                  ? 'bg-rose-50 hover:bg-rose-100'
                                  : row.status === 'Flagged'
                                    ? 'bg-amber-50 hover:bg-amber-100'
                                    : 'hover:bg-blue-50/50'
                            }`}
                            onMouseMove={(e) => setTooltipState({ x: e.clientX, y: e.clientY, row: row })}
                            onMouseLeave={() => setTooltipState(null)}
                            onClick={() => {
                              if (row.oldVal === null) return;
                              setSelectedGWs(prev => {
                                const dist = row.oldVal;
                                if (prev.includes(dist)) return prev.filter(d => d !== dist);
                                const next = [...prev, dist].slice(-2);
                                if (next.length === 2) setShow3DViewer(true);
                                return next;
                              });
                            }}>
                            <td className="px-3 py-2.5">
                              <div className={`w-1.5 h-1.5 rounded-full ${row.status === 'Match' ? 'bg-blue-500' : 'bg-rose-500'}`}></div>
                            </td>
                            <td className="px-3 py-2.5 font-mono text-gray-700">{row.oldVal !== null ? row.oldVal.toFixed(2) : '-'}</td>
                            <td className="px-3 py-2.5 text-gray-500 hidden md:table-cell truncate max-w-[100px]" title={row.oldDesc}>{row.oldDesc}</td>
                            <td className="px-3 py-2.5 font-mono text-gray-700">{row.originalNewVal !== undefined && row.originalNewVal !== null ? row.originalNewVal.toFixed(2) : '-'}</td>
                            <td className="px-3 py-2.5 text-gray-500 hidden md:table-cell truncate max-w-[100px]" title={row.newDesc}>{row.newDesc}</td>
                            <td className="px-3 py-2.5 font-mono font-bold text-right text-gray-800">{row.offset !== null ? row.offset.toFixed(2) : '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
            
            {/* Table Footer Stats */}
            <div className="bg-gray-50 border-t border-gray-200 px-4 py-3 flex justify-between items-center text-xs">
               <div className="flex flex-col">
                 <span className="font-bold text-gray-800">{matches.filter(m => m.status === 'Match').length}</span>
                 <span className="text-gray-500 text-[10px] uppercase tracking-wider">Total Matches</span>
               </div>
               <div className="h-6 w-px bg-gray-300"></div>
               <div className="flex flex-col text-right">
                 <span className="font-bold text-blue-600">{(graphPoints.reduce((sum, p) => sum + p.y, 0) / (graphPoints.length || 1)).toFixed(2)}m</span>
                 <span className="text-gray-500 text-[10px] uppercase tracking-wider">Mean Offset</span>
               </div>
            </div>
          </div>
          
        </div>

      </div>

      {/* Middle Row: OTA Settings & GW Offset Trends */}
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-5 items-stretch">
        
        {/* LEFT: OTA Settings */}
        <div className="xl:col-span-2 flex">
          <div className="bg-white rounded-2xl p-6 shadow-xl shadow-blue-900/5 border border-gray-200 flex flex-col justify-between w-full">
             <div>
               <h3 className="font-bold text-gray-800 text-lg mb-1">OTA Settings</h3>
               <p className="text-xs text-gray-500 mb-6 leading-relaxed">Adjust slippage tolerance and toggle DTW correction to force alignment.</p>
               
               <div className="mt-6 space-y-4">
                 <label className="flex items-center justify-between text-sm font-bold text-gray-700">
                   <span>Slippage Tolerance</span>
                   <span className="font-mono bg-white px-2 py-1 rounded shadow-sm border border-gray-200 text-blue-600">{ota}%</span>
                 </label>
                 <input type="range" min="0.1" max="10" step="0.1" value={ota} onChange={e => setOta(parseFloat(e.target.value))} className="w-full accent-blue-600 h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer" />
               </div>
             </div>

             <div className="flex items-center justify-between bg-blue-50/50 px-5 py-4 rounded-xl border border-blue-100 w-full mb-3">
                <div>
                  <span className="font-bold text-sm text-blue-900">Strict Distance & Spool Matching</span>
                  <p className="text-[10px] text-blue-600/80 font-medium mt-0.5">Penalizes distance drift to prevent forced matches across Tie-ins</p>
                </div>
                <button onClick={() => setStrictPenalty(!strictPenalty)} className={`w-12 h-6 rounded-full transition-colors relative shadow-inner ${strictPenalty ? 'bg-blue-600' : 'bg-gray-300'}`}>
                  <div className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-all shadow-md ${strictPenalty ? 'left-7' : 'left-1'}`} />
                </button>
              </div>

              <div className="flex items-center justify-between bg-blue-50/50 px-5 py-4 rounded-xl border border-blue-100 w-full mb-3">
                <div>
                  <span className="font-bold text-sm text-blue-900">Valve-to-Valve Anchoring</span>
                  <p className="text-[10px] text-blue-600/80 font-medium mt-0.5">Locks alignment explicitly between matched valves</p>
                </div>
                <button onClick={() => setUseValveAnchor(!useValveAnchor)} className={`w-12 h-6 rounded-full transition-colors relative shadow-inner ${useValveAnchor ? 'bg-blue-600' : 'bg-gray-300'}`}>
                  <div className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-all shadow-md ${useValveAnchor ? 'left-7' : 'left-1'}`} />
                </button>
              </div>

             <div className="flex items-center justify-between bg-blue-50/50 px-5 py-4 rounded-xl border border-blue-100 w-full">
               <div>
                 <span className="font-bold text-sm text-blue-900">Apply DTW Correction</span>
                 <p className="text-[10px] text-blue-600/80 font-medium mt-0.5">Corrects raw odometer using reference run</p>
               </div>
               <button onClick={() => setDtwOn(!dtwOn)} className={`w-12 h-6 rounded-full transition-colors relative shadow-inner ${dtwOn ? 'bg-blue-600' : 'bg-gray-300'}`}>
                 <div className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-all shadow-md ${dtwOn ? 'left-7' : 'left-1'}`} />
               </button>
             </div>
          </div>
        </div>

        {/* RIGHT: GW Offset Chart */}
        <div className="xl:col-span-3 flex">
      <div className="bg-white rounded-2xl p-6 shadow-xl shadow-blue-900/5 border border-gray-200 flex flex-col w-full">
        <div className="flex justify-between items-start mb-4">
          <div>
            <h3 className="font-bold text-gray-800 text-lg">GW Offset Trends</h3>
            <p className="text-xs text-gray-500">Difference in distance (m) over pipeline</p>
          </div>
          <div className="bg-blue-50 px-2 py-1 rounded text-blue-700 text-xs font-bold font-mono">Matched Only</div>
        </div>
        <div className="w-full relative h-[300px]">
          <Line data={chartData} options={{
            ...chartOptions,
            maintainAspectRatio: false,
            onClick: (e: any, elements: any[]) => {
              if (elements.length > 0) {
                const idx = elements[0].index;
                const match = chartPoints[idx]?.match;
                if (match && match.oldVal !== null) {
                  setSelectedGWs(prev => {
                    const dist = match.oldVal;
                    if (prev.includes(dist)) return prev.filter(d => d !== dist);
                    const next = [...prev, dist].slice(-2);
                    if (next.length === 2) setShow3DViewer(true);
                    return next;
                  });
                  const rowEl = tableRowRefs.current[match.id];
                  if (rowEl) {
                    rowEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    rowEl.classList.add('animate-pulse', 'bg-yellow-200');
                    setTimeout(() => rowEl.classList.remove('animate-pulse', 'bg-yellow-200'), 2000);
                  }
                }
              }
            }
          } as any} />
        </div>
      </div>
      </div>
      </div>

      {/* Full-Width Odometer Slippage Section */}
      <div className="bg-white rounded-2xl p-6 shadow-xl shadow-blue-900/5 border border-gray-200">
        <div className="flex items-center justify-between mb-4 border-b border-gray-100 pb-4">
          <div>
            <h3 className="text-lg font-bold text-gray-800">Odometer Slippage Analysis</h3>
            <p className="text-xs font-medium text-gray-500 mt-1">Baseline vs. Raw odometer drift and joint deviation ratios</p>
          </div>
        </div>
        <OdometerDashboard matches={matchedOnly} ota={ota} setOta={setOta} dtwOn={dtwOn} setDtwOn={setDtwOn} />
      </div>

      <div className="flex justify-between mt-4">
        <button 
          onClick={onBack}
          className="px-6 py-3 rounded-xl font-medium text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition-colors flex items-center gap-2"
        >
          <FiChevronLeft /> Adjust Scenarios
        </button>
        <button 
          onClick={() => onNext({ ota, strictPenalty, useValveAnchor, dtwOn, gwMatches: matches, gwMatchesFinal, gwOrphans, alignedFeatures })}
          className="bg-white hover:bg-gray-200 text-black px-8 py-3 rounded-xl font-medium transition-colors flex items-center gap-2 shadow-lg shadow-white/10"
        >
          Accept Matches & Next <FiChevronRight />
        </button>
      </div>
      {/* 3D Viewer Modal */}
      {show3DViewer && selectedGWs.length === 2 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-fade-in p-8">
          <div className="bg-[#111] border border-gray-200 rounded-2xl w-full max-w-6xl h-[80vh] flex flex-col shadow-2xl overflow-hidden relative">
            <div className="flex justify-between items-center p-4 border-b border-gray-200 bg-black/50">
              <div>
                <h3 className="text-gray-900 font-bold flex items-center gap-2"><FiBox className="text-brand-500" /> Interactive Spool Analysis</h3>
                <p className="text-gray-500 text-xs">Viewing segment from {selectedGWs[0].toFixed(2)}m to {selectedGWs[1].toFixed(2)}m</p>
              </div>
              <button onClick={() => setShow3DViewer(false)} className="text-gray-500 hover:text-gray-900 bg-gray-100 hover:bg-gray-700 p-2 rounded-full transition-colors">
                <FiX size={20} />
              </button>
            </div>
            <div className="flex-1 bg-black relative">
              {(() => {
                const startDist = Math.min(selectedGWs[0], selectedGWs[1]);
                const endDist = Math.max(selectedGWs[0], selectedGWs[1]);
                
                // Get all metal loss/dents between these two GWs from the original oldRun payload
                const anomalies = (config?.payload?.oldRun || [])
                  .filter((f: any) => {
                    const isDefect = f.type && (f.type.toLowerCase().includes('metal loss') || f.type.toLowerCase().includes('dent') || f.type.toLowerCase().includes('corrosion') || f.type.toLowerCase().includes('anomaly'));
                    return isDefect && f.dist > startDist && f.dist < endDist;
                  })
                  .map((f: any) => ({
                    position: f.dist - startDist, // relative position from the first GW
                    depthPct: f.depth || 10,
                    clockAngle: f.orientation || 0
                  }));

                return <Pipeline3DViewer length={endDist - startDist} od={12} anomalies={anomalies} />;
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Math Explanation Tooltip */}
      {tooltipState && tooltipState.row.id !== 'match-0-0' && (
        <div className="fixed z-[100] bg-white border border-gray-200 shadow-2xl rounded-xl p-4 w-80 pointer-events-none" style={{ left: tooltipState.x + 15, top: tooltipState.y + 15 }}>
          <h5 className={`font-bold mb-2 ${tooltipState.row.status === 'Match' ? 'text-blue-600' : 'text-rose-600'}`}>
            Algorithm Decision: {tooltipState.row.status}
          </h5>
          <div className="text-xs text-gray-600 space-y-2 font-mono bg-gray-50 p-3 rounded border border-gray-100 mb-3">
            <div className="flex justify-between"><span>sOld (Baseline):</span><span>{tooltipState.row.sOld?.toFixed(3)} m</span></div>
            <div className="flex justify-between"><span>sNew (Raw):</span><span>{tooltipState.row.sNew?.toFixed(3)} m</span></div>
            <div className="flex justify-between border-b border-gray-200 pb-2 mb-2 text-gray-500">
               <span>Abs. Odo Diff:</span>
               <span>{tooltipState.row.rawOffset?.toFixed(3) || tooltipState.row.offset?.toFixed(3) || '-'} m</span>
            </div>
            <div className="pt-2 flex justify-between text-blue-800 font-bold">
               <span>v = |(sOld/sNew)-1|×100</span>
               <span>{tooltipState.row.rawVarPct?.toFixed(2)}%</span>
            </div>
            {tooltipState.row.dtwOn && tooltipState.row.status === 'Match' && (
              <div className="flex justify-between text-green-700 font-bold mt-1">
                 <span>DTW (Corrected v):</span>
                 <span>{tooltipState.row.varPct?.toFixed(2)}%</span>
              </div>
            )}
          </div>
          <div className="text-xs font-medium text-gray-700 leading-relaxed">
            {tooltipState.row.status === 'Match' ? (
              <p>✅ <b>{tooltipState.row.rawVarPct?.toFixed(2)}% &lt;= {ota}% (OTA)</b><br/>Variance is within tolerance. Joints matched successfully.</p>
            ) : (
              <p>❌ <b>{tooltipState.row.rawVarPct?.toFixed(2)}% &gt; {ota}% (OTA)</b><br/>Variance exceeds tolerance. Detected local anomaly (e.g. repair spool), joint skipped.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
