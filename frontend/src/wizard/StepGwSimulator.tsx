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
        const payload = {
          ota,
          oldRun: config?.summaryData?.oldRun?.rawFeatures || [],
          newRun: config?.summaryData?.newRun?.rawFeatures || []
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
    <div className="bg-white text-gray-800 rounded-2xl p-8 shadow-2xl border border-gray-200 animate-fade-in font-sans">
      <div className="flex gap-6 items-center justify-between bg-gray-50 p-6 rounded-2xl border border-gray-200 mb-6">
        <div>
          <h3 className="font-bold text-gray-800 text-lg mb-1">Matching Parameters</h3>
          <p className="text-sm text-gray-500">Adjust the OTA % slider and toggle DTW Correction to optimize Girth Weld alignment.</p>
        </div>
        <div className="flex items-center gap-8">
          <div className="flex flex-col min-w-[250px]">
            <label className="text-sm font-medium text-gray-700 mb-2 flex justify-between">
              <span>Slippage Tolerance</span>
              <span className="font-bold text-blue-600">{ota}%</span>
            </label>
            <input type="range" min="0" max="15" step="0.5" value={ota} onChange={e => setOta(parseFloat(e.target.value))} className="w-full accent-blue-500" />
          </div>
          <div className="flex items-center gap-4 bg-white px-4 py-3 rounded-xl border border-gray-200">
            <span className="font-medium text-sm leading-tight text-gray-700">Apply DTW<br/><span className="text-xs text-gray-500">Correction</span></span>
            <button onClick={() => setDtwOn(!dtwOn)} className={`w-14 h-8 rounded-full transition-colors relative ${dtwOn ? 'bg-blue-500' : 'bg-gray-300'}`}>
              <div className={`w-6 h-6 bg-white rounded-full absolute top-1 transition-all shadow-sm ${dtwOn ? 'left-7' : 'left-1'}`} />
            </button>
          </div>
        </div>
      </div>

      {/* Visualizer Header with Zoom Control */}
      <div className="flex justify-between items-end mb-2 mt-4">
         <div className="flex items-center gap-4">
           <h3 className="text-sm font-bold text-gray-500">Timeline Viewer (12+ km)</h3>
           {selectedGWs.length === 2 && (
             <div className="flex items-center gap-3 bg-yellow-400/10 px-4 py-1.5 rounded-full border border-yellow-400/30 animate-fade-in">
               <span className="text-xs text-yellow-400 font-mono">
                 Spool Length: {(selectedGWs[1] - selectedGWs[0]).toFixed(2)}m
               </span>
               <button 
                 onClick={() => setShow3DViewer(true)}
                 className="flex items-center gap-2 bg-yellow-500 hover:bg-yellow-400 text-gray-900 text-xs font-bold px-3 py-1 rounded shadow-lg transition-colors"
               >
                 <FiBox /> Look 3D Pipeline
               </button>
             </div>
           )}
         </div>
         <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">Zoom:</span>
            <input 
              type="range" min="100" max="15000" step="100" 
              value={zoom} onChange={(e) => setZoom(parseInt(e.target.value))}
              className="w-32 h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-gray-400"
            />
         </div>
      </div>

      {/* Timeline Visualizer */}
      <div className="mb-8 relative h-80 bg-gray-50 rounded-xl border border-gray-200 overflow-x-auto custom-scrollbar">
        {isCalculating && (
          <div className="absolute inset-0 bg-white/60 backdrop-blur-[1px] z-50 flex items-center justify-center">
            <div className="bg-white border border-blue-200 px-6 py-3 rounded-xl shadow-lg font-bold text-blue-600 animate-pulse flex items-center gap-3">
               <svg className="animate-spin h-5 w-5 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
               AI Recalculating DTW...
            </div>
          </div>
        )}
        <div className="relative h-full" style={{ width: `${zoom}%`, minWidth: '100%', padding: '0 40px' }}>
          <div className="relative w-full h-full">
           <div className="absolute top-4 left-0 text-xs font-bold text-gray-500 uppercase sticky left-0">Run Old (Reference)</div>
           <div className="absolute top-20 left-0 right-0 h-[2px] bg-gray-700"></div>
           {oldGWs.map((pos, i) => {
              const m = matches.find(mx => mx.oldIndex === i);
              const isSkipped = m && m.status === 'Skipped';
              const isFlagged = m && m.status === 'Flagged';
              const isSelected = selectedGWs.includes(pos);
              return (
              <div 
                key={`old-${i}`} 
                className="absolute top-[72px] flex flex-col items-center cursor-pointer group z-20" 
                style={{ left: `${getPosPct(pos)}%`, transform: 'translateX(-50%)' }}
                onClick={() => handleGWClick(pos, 'old')}
              >
                 <div className={`w-2 h-6 rounded transition-all shadow-md ${isSelected && selectedTrack === 'old' ? 'bg-yellow-400 scale-125' : isSkipped ? 'bg-rose-500 group-hover:bg-rose-400' : isFlagged ? 'bg-amber-400 group-hover:bg-amber-300' : 'bg-green-500 group-hover:bg-green-400 group-hover:scale-110'}`}></div>
                 <div className={`text-[10px] mt-1 font-mono font-bold ${isSelected && selectedTrack === 'old' ? 'text-yellow-400' : isSkipped ? 'text-rose-500' : isFlagged ? 'text-amber-500' : 'text-green-600'}`}>{pos.toFixed(2)}m</div>
              </div>
              )
           })}

           {/* Selected Spool Highlight for Old */}
           {selectedGWs.length === 2 && selectedTrack === 'old' && (
             <div 
               className="absolute top-[72px] h-6 bg-yellow-400/20 border-y border-yellow-400/50 z-10 animate-pulse"
               style={{ 
                 left: `${getPosPct(selectedGWs[0])}%`, 
                 width: `${getPosPct(selectedGWs[1]) - getPosPct(selectedGWs[0])}%` 
               }}
             />
           )}

           <div className="absolute top-[200px] left-0 text-xs font-bold text-gray-500 uppercase sticky left-0">Run New (Current)</div>
           <div className="absolute top-[240px] left-0 right-0 h-[2px] bg-gray-700"></div>
           {newGWs.map((pos, i) => {
              const m = matches.find(mx => mx.newIndex === i);
              const isSkipped = m && m.status === 'Skipped';
              const isFlagged = m && m.status === 'Flagged';
              const isSelected = selectedGWs.includes(pos);
              return (
                <div 
                  key={`new-${i}`} 
                  className="absolute top-[232px] flex flex-col items-center cursor-pointer group z-20" 
                  style={{ left: `${getPosPct(pos)}%`, transform: 'translateX(-50%)' }}
                  onClick={() => handleGWClick(pos, 'new')}
                >
                   <div className={`w-1.5 h-6 rounded transition-all shadow-md ${isSelected && selectedTrack === 'new' ? 'bg-yellow-400 scale-125' : isSkipped ? 'bg-rose-500 group-hover:bg-rose-400' : isFlagged ? 'bg-amber-400 group-hover:bg-amber-300' : 'bg-blue-500 group-hover:bg-blue-400'}`}></div>
                   <div className={`text-[10px] mt-1 font-mono font-bold ${isSelected && selectedTrack === 'new' ? 'text-yellow-400' : isSkipped ? 'text-rose-500' : isFlagged ? 'text-amber-500' : 'text-blue-600'}`}>{pos.toFixed(2)}m</div>
                </div>
              )
           })}

           {/* Selected Spool Highlight for New */}
           {selectedGWs.length === 2 && selectedTrack === 'new' && (
             <div 
               className="absolute top-[232px] h-6 bg-yellow-400/20 border-y border-yellow-400/50 z-10 animate-pulse"
               style={{ 
                 left: `${getPosPct(selectedGWs[0])}%`, 
                 width: `${getPosPct(selectedGWs[1]) - getPosPct(selectedGWs[0])}%` 
               }}
             />
           )}

           {/* Draw dashed lines connecting matches */}
           <svg className="absolute inset-0 w-full h-full pointer-events-none">
              {/* MATCHING LINES (Draw for Match and Flagged) */}
              {matches.filter(m => m.status === 'Match' || m.status === 'Flagged').map((m, i) => {
                 const x1 = `${getPosPct(m.oldVal as number)}%`;
                 const y1 = 116; // bottom of old text
                 const x2 = `${getPosPct(m.newVal as number)}%`;
                 const y2 = 232; // top of new tick
                 const isFlagged = m.status === 'Flagged';
                 return (
                   <line key={`line-${i}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke={isFlagged ? "rgba(251, 191, 36, 0.6)" : "rgba(147, 197, 253, 0.4)"} strokeWidth="1.5" strokeDasharray="4 4" />
                 );
              })}
           </svg>
          </div>
        </div>
      </div>

      
      {/* Tabs Header */}
      <div className="flex border-b border-gray-200 mb-6 bg-gray-50 rounded-t-xl overflow-hidden">
        {[
          { id: 'odometer', label: 'Odometer Slippage' },
          { id: 'offset', label: 'GW Offset' },
          { id: 'unmatched', label: 'Table GW Unmatched' },
          { id: 'matched', label: 'Table GW Matched' },
          { id: 'all', label: 'Table GW' }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => { setActiveTab(tab.id as any); setCurrentPage(1); }}
            className={`px-6 py-4 text-sm font-medium transition-colors border-b-2 ${
              activeTab === tab.id 
                ? 'border-blue-500 text-blue-600 bg-white' 
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-100'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="mb-8 min-h-[300px]">
        {activeTab === 'odometer' && <OdometerDashboard matches={matches.filter(m => m.status === 'Match')} ota={ota} setOta={setOta} dtwOn={dtwOn} setDtwOn={setDtwOn} />}
        {activeTab === 'offset' && (
          <div className="h-64 bg-gray-50 p-4 rounded-xl border border-gray-200">
            <h4 className="text-center text-blue-600 font-semibold mb-2 bg-blue-600/10 py-1 inline-block px-4 mx-auto block w-max rounded">Girth Weld Offset</h4>
             <Line data={chartData} options={{
                ...chartOptions,
                onClick: (e: any, elements: any[]) => {
                  if (elements.length > 0) {
                    const idx = elements[0].index;
                    const match = matches[idx];
                    if (match && match.oldVal !== null) {
                      // Select GW
                      setSelectedGWs(prev => {
                        const dist = match.oldVal;
                        if (prev.includes(dist)) return prev.filter(d => d !== dist);
                        const next = [...prev, dist].slice(-2);
                        if (next.length === 2) setShow3DViewer(true);
                        return next;
                      });
                      
                      // Scroll to table row
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
        )}

        {activeTab === 'unmatched' && (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="p-3 bg-gray-50 border-b border-gray-200 flex justify-between items-center">
              <button className="p-2 bg-gray-700 text-white hover:bg-gray-800 rounded shadow-sm"><FiDownload size={16} /></button>
              <div className="relative">
                <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input type="text" placeholder="Search" className="pl-9 pr-4 py-1.5 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm w-64" />
              </div>
            </div>
            <table className="w-full text-sm text-left">
              <thead className="text-gray-900 bg-gray-50 border-b border-gray-200 font-semibold">
                <tr>
                  <th className="px-6 py-3">Old From <span className="text-blue-500">m</span></th>
                  <th className="px-6 py-3">Old To <span className="text-blue-500">m</span></th>
                  <th className="px-6 py-3">New From <span className="text-blue-500">m</span></th>
                  <th className="px-6 py-3">New To <span className="text-blue-500">m</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 text-gray-600">
                {unmatchedRanges.map((r, idx) => (
                  <tr key={idx} className="hover:bg-gray-50">
                    <td className="px-6 py-2">{r.oldFrom !== null ? r.oldFrom.toFixed(3) : ''}</td>
                    <td className="px-6 py-2">{r.oldTo !== null && r.oldTo !== r.oldFrom ? r.oldTo.toFixed(3) : ''}</td>
                    <td className="px-6 py-2">{r.newFrom !== null ? r.newFrom.toFixed(3) : ''}</td>
                    <td className="px-6 py-2">{r.newTo !== null && r.newTo !== r.newFrom ? r.newTo.toFixed(3) : ''}</td>
                  </tr>
                ))}
                {unmatchedRanges.length === 0 && (
                  <tr><td colSpan={4} className="px-6 py-8 text-center text-gray-500">No unmatched ranges found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'matched' && (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="p-3 bg-gray-50 border-b border-gray-200 flex justify-between items-center">
              <div className="flex gap-2">
                <button className="p-1.5 hover:bg-gray-200 rounded text-gray-700"><FiPlus size={18} /></button>
                <button className="p-1.5 hover:bg-gray-200 rounded text-gray-700"><FiMinus size={18} /></button>
                <button className="p-1.5 bg-gray-700 text-white hover:bg-gray-800 rounded shadow-sm ml-2"><FiDownload size={16} /></button>
              </div>
              <div className="relative">
                <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input 
                  type="text" 
                  placeholder="Search" 
                  value={searchQuery}
                  onChange={(e) => {setSearchQuery(e.target.value); setCurrentPage(1);}}
                  className="pl-9 pr-4 py-1.5 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm w-64" 
                />
              </div>
            </div>
            
            <table className="w-full text-sm text-left">
              <thead className="text-gray-900 bg-gray-50 border-b border-gray-200 font-semibold">
                <tr>
                  <th className="px-4 py-3 w-12 text-center"></th>
                  <th className="px-4 py-3 w-12 text-center"></th>
                  <th className="px-6 py-3">GW Distance Run 1 <span className="text-blue-500">m</span></th>
                  <th className="px-6 py-3">GW Distance Run 2 <span className="text-blue-500">m</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 text-gray-600">
                {paginatedMatched.map((row) => (
                  <React.Fragment key={row.id}>
                    <tr className={`hover:bg-gray-50 transition-colors ${editingId === row.id ? 'bg-blue-50/40 text-blue-900 border-l-[3px] border-blue-500' : 'border-l-[3px] border-transparent'}`}>
                      <td className="px-4 py-2 text-center">
                        {editingId === row.id ? (
                           <button onClick={() => setEditingId(null)} className="text-blue-500 hover:text-blue-700 p-1 bg-blue-100 rounded-full transition-colors"><FiX size={16} /></button>
                        ) : (
                           <button 
                              onClick={() => {
                                setEditingId(row.id);
                                setEditRun1(row.oldVal !== null ? row.oldVal.toFixed(3) : '');
                                setEditRun2(row.newVal !== null ? row.newVal.toFixed(3) : '');
                              }} 
                              className="text-gray-400 hover:text-blue-600 transition-colors"
                           >
                             <FiEdit size={16} />
                           </button>
                        )}
                      </td>
                      <td className="px-4 py-2 text-center">
                        <input type="checkbox" className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500" />
                      </td>
                      <td className="px-6 py-2">{row.oldVal !== null ? row.oldVal.toFixed(3) : '-'}</td>
                      <td className="px-6 py-2">{row.newVal !== null ? row.newVal.toFixed(3) : '-'}</td>
                    </tr>
                    
                    {/* Inline Edit Form */}
                    {editingId === row.id && (
                      <tr className="bg-white shadow-inner">
                        <td colSpan={4} className="px-10 py-6 border-b border-gray-200 border-l-[3px] border-blue-500 relative">
                          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-b from-blue-500/10 to-transparent"></div>
                          <h5 className="text-[15px] font-semibold text-gray-800 mb-4 flex items-center gap-2">
                            <FiEdit className="text-blue-500" /> Adjust GirthWeld Match Distance
                          </h5>
                          
                          <div className="flex gap-8 max-w-xl mb-6">
                            <div className="flex-1">
                              <label className="block text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wider">GW Distance Run 1</label>
                              <div className="flex shadow-sm rounded-lg overflow-hidden border border-gray-200 focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500 transition-all bg-white">
                                 <input type="text" value={editRun1} onChange={e => setEditRun1(e.target.value)} className="flex-1 px-3 py-2 outline-none text-sm text-gray-900 font-mono" />
                                 <span className="bg-gray-50 px-3 py-2 text-gray-400 text-sm border-l border-gray-200 font-medium">m</span>
                              </div>
                            </div>
                            
                            <div className="flex-1">
                              <label className="block text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wider">GW Distance Run 2</label>
                              <div className="flex shadow-sm rounded-lg overflow-hidden border border-gray-200 focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500 transition-all bg-white">
                                 <input type="text" value={editRun2} onChange={e => setEditRun2(e.target.value)} className="flex-1 px-3 py-2 outline-none text-sm text-gray-900 font-mono" />
                                 <span className="bg-gray-50 px-3 py-2 text-gray-400 text-sm border-l border-gray-200 font-medium">m</span>
                              </div>
                            </div>
                          </div>
                          
                          <div className="flex items-center gap-3 pt-2">
                             <button 
                               onClick={() => setEditingId(null)} 
                               className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 shadow-sm text-sm"
                             >
                               <FiSave size={16} /> Save Changes
                             </button>
                             <button 
                               onClick={() => setEditingId(null)}
                               className="px-5 py-2 rounded-lg font-medium text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition-colors text-sm"
                             >
                               Cancel
                             </button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
            
            {/* Pagination */}
            <div className="flex justify-between items-center px-4 py-3 bg-gray-50 border-t border-gray-200">
               <div className="flex gap-1">
                 {Array.from({ length: Math.min(5, totalPages) }).map((_, i) => (
                   <button 
                     key={i} 
                     onClick={() => setCurrentPage(i + 1)}
                     className={`w-8 h-8 flex items-center justify-center border ${currentPage === i + 1 ? 'bg-gray-200 border-gray-300 font-semibold' : 'bg-white border-transparent hover:bg-gray-100'}`}
                   >
                     {i + 1}
                   </button>
                 ))}
                 {totalPages > 5 && <span className="w-8 h-8 flex items-center justify-center">...</span>}
                 {totalPages > 5 && (
                   <button 
                     onClick={() => setCurrentPage(totalPages)}
                     className={`w-8 h-8 flex items-center justify-center border ${currentPage === totalPages ? 'bg-gray-200 border-gray-300 font-semibold' : 'bg-white border-transparent hover:bg-gray-100'}`}
                   >
                     {totalPages}
                   </button>
                 )}
                 <button onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))} className="w-8 h-8 flex items-center justify-center hover:bg-gray-200"><FiChevronRight /></button>
               </div>
               <div className="flex items-center gap-2 text-sm text-gray-500">
                 Items per page: 
                 <select className="border border-gray-300 rounded px-2 py-1 bg-white">
                   <option>10</option>
                   <option>25</option>
                   <option>50</option>
                 </select>
               </div>
            </div>
          </div>
        )}

        {(activeTab === 'all' || activeTab === 'odometer') && (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden flex flex-col max-h-[400px] mt-8">
             <div className="flex justify-between items-center px-6 py-3 bg-gray-50 border-b border-gray-200 sticky top-0 shrink-0">
              <h4 className="font-semibold text-gray-800">Match Results Data</h4>
              <div className="flex gap-2">
                <button onClick={handleDownloadExcel} className="text-sm flex items-center gap-2 bg-green-600 text-white px-3 py-1.5 rounded-lg hover:bg-green-700 transition-colors">
                  <FiDownload /> Export Excel
                </button>
                <button onClick={() => setIsTableExpanded(!isTableExpanded)} className="text-gray-500 hover:text-gray-800 hover:bg-gray-200 rounded p-1.5 transition-colors">
                  {isTableExpanded ? <FiMinimize2 size={16} /> : <FiMaximize2 size={16} />}
                </button>
              </div>
            </div>
            <div className="overflow-y-auto flex-1 custom-scrollbar">
              <table className="w-full text-sm text-left">
                <thead className="text-gray-500 bg-gray-50 sticky top-0 border-b border-gray-200 z-10">
                  <tr>
                    <th className="px-6 py-4 font-normal">Status</th>
                    <th className="px-6 py-4 font-normal">Old (m)</th>
                    <th className="px-6 py-4 font-normal">New (m)</th>
                    <th className="px-6 py-4 font-normal">Var %</th>
                    <th className="px-6 py-4 font-normal">Offset</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {matches.map((row) => (
                    <tr key={row.id} 
                      ref={(el: HTMLTableRowElement | null) => { if (el) tableRowRefs.current[row.id] = el; }}
                      className={`transition-colors cursor-pointer ${
                        (row.oldVal !== null && selectedGWs.includes(row.oldVal)) || (row.newVal !== null && selectedGWs.includes(row.newVal))
                          ? 'bg-yellow-100 hover:bg-yellow-200' 
                          : row.status === 'Skipped'
                            ? 'bg-rose-50 hover:bg-rose-100'
                            : row.status === 'Flagged'
                              ? 'bg-amber-50 hover:bg-amber-100'
                              : 'hover:bg-gray-100'
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
                      <td className="px-6 py-3 flex items-center gap-2">
                        {row.status === 'Match' ? (
                          <><div className="w-2 h-2 rounded-full bg-blue-400"></div> Match</>
                        ) : (
                          <><div className="w-2 h-2 rounded-full bg-rose-400"></div> Skipped</>
                        )}
                      </td>
                      <td className="px-6 py-3">{row.oldVal !== null ? row.oldVal.toFixed(2) : '-'}</td>
                      <td className="px-6 py-3">{row.newVal !== null ? row.newVal.toFixed(2) : '-'}</td>
                      <td className="px-6 py-3 font-mono">{row.varPct.toFixed(1)}%</td>
                      <td className="px-6 py-3">{row.offset !== null ? row.offset.toFixed(2) : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
<div className="grid grid-cols-2 gap-8 mb-8 text-center border-t border-gray-200 pt-8">
        <div>
          <p className="text-gray-500 text-sm mb-1">Total Matches</p>
          <p className="text-2xl font-mono text-gray-900">{matches.filter(m => m.status === 'Match').length}</p>
        </div>
        <div>
          <p className="text-gray-500 text-sm mb-1">Mean Offset</p>
          <p className="text-2xl font-mono text-gray-900">
            {(graphPoints.reduce((sum, p) => sum + p.y, 0) / (graphPoints.length || 1)).toFixed(2)} m
          </p>
        </div>
      </div>

      <div className="flex justify-between mt-8">
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
