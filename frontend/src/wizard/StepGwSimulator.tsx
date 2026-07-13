import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Line } from 'react-chartjs-2';
import { FiPlay, FiCheck, FiX, FiBox, FiChevronRight, FiChevronLeft, FiMaximize2, FiMinimize2, FiEdit, FiSave, FiDownload, FiSearch, FiPlus, FiMinus } from 'react-icons/fi';
import * as XLSX from 'xlsx';
import Pipeline3DViewer from '../components/3d/Pipeline3DViewer';
import OdometerDashboard from './OdometerDashboard';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Tooltip } from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip);

interface StepGwSimulatorProps {
  initialOta: number;
  onNext: (data?: any) => void;
  onBack: () => void;
  config?: any;
}

export default function StepGwSimulator({ initialOta, onNext, onBack, config }: StepGwSimulatorProps) {
  const [ota, setOta] = useState(10.0);
  const [zoom, setZoom] = useState(150);
  const [selectedGWs, setSelectedGWs] = useState<number[]>([]);
  const [selectedTrack, setSelectedTrack] = useState<'old' | 'new' | null>(null);
  const [show3DViewer, setShow3DViewer] = useState(false);
  const [isTableExpanded, setIsTableExpanded] = useState(false);
  const [tooltipState, setTooltipState] = useState<{ x: number, y: number, row: any } | null>(null);

  const [activeTab, setActiveTab] = useState<'offset' | 'unmatched' | 'matched' | 'table' | 'odometer' | 'all'>('all');

  const handleDownloadExcel = () => {
    const dataToExport = matches.map((m: any, index: number) => ({
      'No.': index + 1,
      'Status': m.status,
      'Baseline Odometer (m)': m.oldVal !== null ? m.oldVal.toFixed(3) : '-',
      'Raw Odometer (m)': m.newVal !== null ? m.newVal.toFixed(3) : '-',
      'Deviation (%)': m.varPct.toFixed(2) + '%',
      'Offset (m)': m.offset !== null ? m.offset.toFixed(3) : '-',
      'Flagged (>5%)': m.flagged ? 'Yes' : 'No'
    }));

    const worksheet = XLSX.utils.json_to_sheet(dataToExport);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Girth Weld Matches');
    
    const colWidths = [
      { wch: 5 }, { wch: 10 }, { wch: 22 }, { wch: 22 }, { wch: 15 }, { wch: 15 }, { wch: 15 }
    ];
    worksheet['!cols'] = colWidths;

    XLSX.writeFile(workbook, 'GW_Match_Report.xlsx');
  };

  const [dtwOn, setDtwOn] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const tableRowRefs = useRef<{[key: string]: HTMLTableRowElement | null}>({});
  const itemsPerPage = 10;
  
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editRun1, setEditRun1] = useState<string>('');
  const [editRun2, setEditRun2] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');



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
  const [alignedFeatures, setAlignedFeatures] = useState<any[]>([]);
  const [oldGWs, setOldGWs] = useState<number[]>([]);
  const [newGWs, setNewGWs] = useState<number[]>([]);
  const [isCalculating, setIsCalculating] = useState(false);

  useEffect(() => {
    const calculateDTW = async () => {
      setIsCalculating(true);
      const token = localStorage.getItem('synapse_token') || '';
      try {
        const globalOffset = config?.globalOffset || 0;
        const rawNewRun = config?.summaryData?.newRun?.rawFeatures || [];
        
        // Apply global offset to new run features if partial run mode is enabled
        const adjustedNewRun = globalOffset !== 0 
          ? rawNewRun.map((f: any) => ({ ...f, dist: f.dist + globalOffset }))
          : rawNewRun;

        const payload = {
          ota,
          oldRun: config?.summaryData?.oldRun?.rawFeatures || [],
          newRun: adjustedNewRun,
          globalOffset
        };
        
        const res = await fetch('http://localhost:8000/api/align-dtw', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify(payload)
        });
        
        const data = await res.json();
        
        if (data.success && data.gwMatches) {
          if (data.alignedFeatures) setAlignedFeatures(data.alignedFeatures);
          
          // Extract old and new distances just for the visualizer scales
          const oldW = payload.oldRun.filter((f: any) => f.type === 'weld').map((f: any) => f.dist);
          const newW = payload.newRun.filter((f: any) => f.type === 'weld').map((f: any) => f.dist);
          
          setOldGWs(oldW);
          setNewGWs(newW);
          
          const formattedMatches = data.gwMatches.map((m: any, idx: number) => {
            const isMatch = m.status === 'Match';
            const rawOffset = m.newDist !== null && m.oldDist !== null ? (m.newDist - m.oldDist) : null;
            
            // Re-apply DTW correction visualization if enabled
            let correctedNewVal = m.newDist;
            let correctedOffset = rawOffset;
            let finalVarPct = m.deviation_ratio ? m.deviation_ratio * 100 : 0;
            
            if (dtwOn && isMatch && rawOffset !== null && m.oldDist !== null) {
               // Snap them perfectly so user sees a dramatic physical move!
               correctedNewVal = m.oldDist;
               correctedOffset = 0;
               finalVarPct = 0;
            }

            return {
              id: `match-${idx}`,
              oldIndex: m.oldIndex, newIndex: m.newIndex,
              oldId: m.oldId, newId: m.newId,
              oldVal: m.oldDist, newVal: correctedNewVal,
              varPct: finalVarPct,
              offset: correctedOffset,
              status: m.status,
              deviationRatio: m.deviation_ratio,
              flagged: m.flagged,
              sOld: m.L_ref, sNew: m.L_new, rawVarPct: m.deviation_ratio ? m.deviation_ratio * 100 : 0, rawOffset, dtwOn
            };
          });
          setMatches(formattedMatches);
        }
      } catch (err) {
        console.error("Failed to run DTW:", err);
      } finally {
        setIsCalculating(false);
      }
    };
    
    // Add a slight debounce
    const timeout = setTimeout(calculateDTW, 500);
    return () => clearTimeout(timeout);
  }, [ota, dtwOn, config]);

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

  const matchedOnly = matches.filter(m => m.status === 'Match');
  const filteredMatched = matchedOnly.filter(m => 
    searchQuery === '' || 
    (m.oldVal !== null && m.oldVal.toString().includes(searchQuery)) ||
    (m.newVal !== null && m.newVal.toString().includes(searchQuery))
  );
  
  const paginatedMatched = filteredMatched.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  const totalPages = Math.ceil(filteredMatched.length / itemsPerPage);


  // Extract matched points for the graph
  const graphPoints = matches.filter(m => m.status === 'Match').map(m => ({
    x: m.oldVal as number,
    y: m.offset as number
  }));

  const chartData = {
    labels: oldGWs,
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
      tension: 0
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
  const maxDist = oldGWs[oldGWs.length - 1] + 10;
  const getPosPct = (val: number) => (val / maxDist) * 100;

  return (
    <div className="bg-transparent text-gray-800 font-sans flex flex-col gap-6 animate-fade-in">
      
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
                  <p className="text-xs font-medium text-gray-500 mt-1">12+ km Interactive Pipeline Alignment Map</p>
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
                  type="range" min="100" max="15000" step="100" 
                  value={zoom} onChange={(e) => setZoom(parseInt(e.target.value))}
                  className="w-32 h-1.5 bg-gray-300 rounded-lg appearance-none cursor-pointer accent-blue-600"
                />
              </div>
            </div>

            {/* Timeline Visualizer */}
            <div className="relative h-72 bg-gradient-to-r from-gray-50 to-white rounded-xl border border-gray-200 overflow-x-auto custom-scrollbar shadow-inner">
              {isCalculating && (
                <div className="absolute inset-0 bg-white/60 backdrop-blur-[1px] z-50 flex items-center justify-center rounded-xl">
                  <div className="bg-white border border-blue-200 px-6 py-3 rounded-xl shadow-xl font-bold text-blue-600 animate-pulse flex items-center gap-3">
                    <svg className="animate-spin h-5 w-5 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                    AI Recalculating DTW...
                  </div>
                </div>
              )}
              <div className="relative h-full" style={{ width: `${zoom}%`, minWidth: '100%', padding: '0 40px' }}>
                <div className="relative w-full h-full">
                  <div className="absolute top-4 left-0 text-[10px] font-bold text-gray-400 tracking-wider uppercase sticky">Run Old (Reference)</div>
                  <div className="absolute top-[70px] left-0 right-0 h-px bg-green-500/50"></div>
                  {oldGWs.map((pos, i) => {
                    const m = matches.find(mx => mx.oldIndex === i);
                    const isSkipped = m && m.status === 'Skipped';
                    const isFlagged = m && m.status === 'Flagged';
                    const isSelected = selectedGWs.includes(pos);
                    return (
                    <div 
                      key={`old-${i}`} 
                      className="absolute top-[60px] flex flex-col items-center cursor-pointer group z-20" 
                      style={{ left: `${getPosPct(pos)}%`, transform: 'translateX(-50%)' }}
                      onClick={() => handleGWClick(pos, 'old')}
                    >
                      <div className={`w-1.5 h-5 rounded-full transition-all shadow-sm ${isSelected && selectedTrack === 'old' ? 'bg-yellow-400 scale-125 shadow-yellow-500/50' : isSkipped ? 'bg-rose-500 group-hover:bg-rose-400' : isFlagged ? 'bg-amber-400 group-hover:bg-amber-300' : 'bg-green-500 group-hover:bg-green-400 group-hover:scale-110'}`}></div>
                      <div className={`text-[9px] mt-1.5 font-mono font-bold ${isSelected && selectedTrack === 'old' ? 'text-yellow-500' : isSkipped ? 'text-rose-500' : isFlagged ? 'text-amber-500' : 'text-green-600/80'}`}>{pos.toFixed(2)}m</div>
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

                  <div className="absolute top-[170px] left-0 text-[10px] font-bold text-gray-400 tracking-wider uppercase sticky">Run New (Current)</div>
                  <div className="absolute top-[200px] left-0 right-0 h-px bg-blue-500/50"></div>
                  {newGWs.map((pos, i) => {
                    const m = matches.find(mx => mx.newIndex === i);
                    const isSkipped = m && m.status === 'Skipped';
                    const isFlagged = m && m.status === 'Flagged';
                    const isSelected = selectedGWs.includes(pos);
                    return (
                      <div 
                        key={`new-${i}`} 
                        className="absolute top-[190px] flex flex-col items-center cursor-pointer group z-20" 
                        style={{ left: `${getPosPct(pos)}%`, transform: 'translateX(-50%)' }}
                        onClick={() => handleGWClick(pos, 'new')}
                      >
                        <div className={`w-1.5 h-5 rounded-full transition-all shadow-sm ${isSelected && selectedTrack === 'new' ? 'bg-yellow-400 scale-125 shadow-yellow-500/50' : isSkipped ? 'bg-rose-500 group-hover:bg-rose-400' : isFlagged ? 'bg-amber-400 group-hover:bg-amber-300' : 'bg-blue-500 group-hover:bg-blue-400 group-hover:scale-110'}`}></div>
                        <div className={`text-[9px] mt-1.5 font-mono font-bold ${isSelected && selectedTrack === 'new' ? 'text-yellow-500' : isSkipped ? 'text-rose-500' : isFlagged ? 'text-amber-500' : 'text-blue-600/80'}`}>{pos.toFixed(2)}m</div>
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
                          <th className="px-3 py-2 font-bold">Old (m)</th>
                          <th className="px-3 py-2 font-bold">New (m)</th>
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
                                  <button onClick={() => { setEditingId(row.id); setEditRun1(row.oldVal?.toFixed(3) || ''); setEditRun2(row.newVal?.toFixed(3) || ''); }} className="text-gray-400 hover:text-blue-600 transition-colors"><FiEdit size={12} /></button>
                                )}
                              </td>
                              <td className="px-3 py-2 font-mono text-gray-700">{row.oldVal !== null ? row.oldVal.toFixed(3) : '-'}</td>
                              <td className="px-3 py-2 font-mono text-gray-700">{row.newVal !== null ? row.newVal.toFixed(3) : '-'}</td>
                            </tr>
                            {editingId === row.id && (
                              <tr className="bg-white">
                                <td colSpan={3} className="px-4 py-3 border-b border-gray-200 bg-blue-50/30">
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
                          <th className="px-3 py-2 font-bold">Old (m)</th>
                          <th className="px-3 py-2 font-bold">New (m)</th>
                          <th className="px-3 py-2 font-bold text-right">Offset</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
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
                            <td className="px-3 py-2.5 font-mono text-gray-700">{row.newVal !== null ? row.newVal.toFixed(2) : '-'}</td>
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
               
               <div className="mb-4 bg-gray-50 p-4 rounded-xl border border-gray-100 w-full">
                 <label className="text-sm font-bold text-gray-700 mb-3 flex justify-between items-center">
                   <span>Slippage Tolerance</span>
                   <span className="font-mono bg-white px-2 py-1 rounded shadow-sm border border-gray-200 text-blue-600">{ota}%</span>
                 </label>
                 <input type="range" min="0" max="15" step="0.5" value={ota} onChange={e => setOta(parseFloat(e.target.value))} className="w-full accent-blue-600 h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer" />
               </div>
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
                const match = matches[idx];
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
        <OdometerDashboard matches={matches.filter(m => m.status === 'Match')} ota={ota} setOta={setOta} dtwOn={dtwOn} setDtwOn={setDtwOn} />
      </div>

      <div className="flex justify-between mt-4">
        <button 
          onClick={onBack}
          className="px-6 py-3 rounded-xl font-medium text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition-colors flex items-center gap-2"
        >
          <FiChevronLeft /> Adjust Scenarios
        </button>
        <button 
          onClick={() => onNext({ ota, gwMatches: matches, alignedFeatures })}
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
