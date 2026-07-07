import React, { useState, useEffect, useMemo } from 'react';
import { Line } from 'react-chartjs-2';
import { FiPlay, FiCheck, FiX, FiBox, FiChevronRight, FiChevronLeft } from 'react-icons/fi';
import Pipeline3DViewer from '../components/3d/Pipeline3DViewer';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Tooltip } from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip);

interface StepGwSimulatorProps {
  initialOta: number;
  onNext: (ota: number) => void;
  onBack: () => void;
}

export default function StepGwSimulator({ initialOta, onNext, onBack }: StepGwSimulatorProps) {
  const [ota, setOta] = useState(1.5);
  const [zoom, setZoom] = useState(150);
  const [selectedGWs, setSelectedGWs] = useState<number[]>([]);
  const [selectedTrack, setSelectedTrack] = useState<'old' | 'new' | null>(null);
  const [show3DViewer, setShow3DViewer] = useState(false);

  const handleGWClick = (pos: number, track: 'old' | 'new') => {
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

  // Generate ~1050 Pipeline Joints with realistic tracking errors and anomalies
  const { oldGWs, newGWs } = useMemo(() => {
    let oldP = 0.0;
    let newP = 0.35; // Initial odometer offset
    const oldW = [oldP];
    const newW = [newP];
    
    // Generate 1050 joints
    for (let i = 1; i <= 1050; i++) {
      const spoolLength = 12.0; // Standard joint
      oldP += spoolLength;
      oldW.push(oldP);

      // Simulate tracking drift (e.g. +0.3% drift over time) + random noise
      // Keep it under 0.5% total variance so it doesn't fail realistic OTA thresholds (e.g. 1.0%)
      const trackingError = 1.0 + (Math.sin(i / 50) * 0.003) + (Math.random() * 0.0015); 
      
      // Inject anomalies (repair welds) randomly (about 15 anomalies across 1000 spools)
      if (i % 70 === 0) {
        // Repair weld inserted! (e.g. 5m and 7m)
        const repair1 = 5.0 * trackingError;
        const repair2 = 7.0 * trackingError;
        newP += repair1;
        newW.push(newP);
        newP += repair2;
        newW.push(newP);
      } else {
        newP += (spoolLength * trackingError);
        newW.push(newP);
      }
    }
    return { oldGWs: oldW, newGWs: newW };
  }, []);

  // Run the core algorithm reactively based on OTA
  const matches = useMemo(() => {
    let result = [];
    let i = 0; // index in oldGWs
    let j = 0; // index in newGWs

    // First GW is a match by default (benchmark)
    result.push({
      id: `match-0-0`,
      oldIndex: 0, newIndex: 0,
      oldVal: oldGWs[0], newVal: newGWs[0],
      varPct: 0.0, offset: newGWs[0] - oldGWs[0],
      status: 'Match'
    });

    i++; j++;

    while (i < oldGWs.length && j < newGWs.length) {
      const lastMatch = [...result].reverse().find(m => m.status === 'Match') || result[0];
      const prevOldVal = lastMatch.oldVal as number;
      const prevNewVal = lastMatch.newVal as number;

      let foundMatch = false;
      // Search window ahead to recover from anomalies
      for (let window = 0; window <= 6; window++) {
        for (let di = 0; di <= window; di++) {
          let dj = window - di;
          if (i + di < oldGWs.length && j + dj < newGWs.length) {
            let sOld = oldGWs[i + di] - prevOldVal;
            let sNew = newGWs[j + dj] - prevNewVal;
            
            // Prevent division by zero
            if (sNew <= 0) continue;

            let v = Math.abs((sOld / sNew) - 1) * 100;
            if (v <= ota) {
              // Found a match! Mark intermediate welds as skipped
              for (let stepI = 0; stepI < di; stepI++) {
                result.push({
                   id: `skip-old-${i + stepI}`,
                   oldIndex: i + stepI, newIndex: null,
                   oldVal: oldGWs[i + stepI], newVal: null,
                   varPct: 0, offset: null, status: 'Skipped'
                });
              }
              for (let stepJ = 0; stepJ < dj; stepJ++) {
                result.push({
                   id: `skip-new-${j + stepJ}`,
                   oldIndex: null, newIndex: j + stepJ,
                   oldVal: null, newVal: newGWs[j + stepJ],
                   varPct: 0, offset: null, status: 'Skipped'
                });
              }
              // Record the match
              result.push({
                id: `match-${i+di}-${j+dj}`,
                oldIndex: i+di, newIndex: j+dj,
                oldVal: oldGWs[i+di], newVal: newGWs[j+dj],
                varPct: v, offset: newGWs[j+dj] - oldGWs[i+di],
                status: 'Match'
              });
              i += di + 1;
              j += dj + 1;
              foundMatch = true;
              break;
            }
          }
        }
        if (foundMatch) break;
      }

      if (!foundMatch) {
         // OTA is too strict, unable to find any valid matching pair in window.
         // Skip both current welds to advance the pointers and try again.
         result.push({
            id: `skip-fail-old-${i}`,
            oldIndex: i, newIndex: null,
            oldVal: oldGWs[i], newVal: null,
            varPct: 0, offset: null, status: 'Skipped'
         });
         result.push({
            id: `skip-fail-new-${j}`,
            oldIndex: null, newIndex: j,
            oldVal: null, newVal: newGWs[j],
            varPct: 0, offset: null, status: 'Skipped'
         });
         i++;
         j++;
      }
    }
    return result;
  }, [ota]);

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
      <div className="mb-6">
        <h2 className="text-2xl font-semibold tracking-tight text-gray-900 mb-2">Automated Girth Weld Match Simulator</h2>
        <p className="text-sm text-gray-500">
          Adjust the OTA % slider to see how the algorithm filters out local pipeline anomalies (like repair spools) vs how it forces matches.
        </p>
      </div>

      {/* Slider Controls */}
      <div className="flex items-center gap-6 mb-8 bg-gray-50 p-6 rounded-xl border border-gray-200">
        <div className="flex flex-col">
          <label className="text-sm font-medium whitespace-nowrap text-gray-500 mb-2">Odometer Tracking Accuracy (OTA) Threshold</label>
          <div className="flex items-center gap-4">
            <input 
              type="range" min="0.1" max="5.0" step="0.1" 
              value={ota} onChange={(e) => setOta(parseFloat(e.target.value))}
              className="w-64 h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
            />
            <div className="bg-gray-100 text-blue-400 px-4 py-2 rounded-lg font-mono text-sm border border-gray-300 font-bold min-w-[80px] text-center">
              {ota.toFixed(1)}%
            </div>
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
      <div className="mb-8 relative h-48 bg-gray-50 rounded-xl border border-gray-200 overflow-x-auto custom-scrollbar">
        <div className="relative h-full" style={{ width: `${zoom}%`, minWidth: '100%' }}>
           <div className="absolute top-4 left-4 text-xs font-bold text-gray-500 uppercase sticky left-4">Run Old (Reference)</div>
           <div className="absolute top-12 left-0 right-0 h-[2px] bg-gray-700"></div>
           {oldGWs.map((pos, i) => {
              const isSelected = selectedGWs.includes(pos);
              return (
              <div 
                key={`old-${i}`} 
                className="absolute top-10 flex flex-col items-center cursor-pointer group z-20" 
                style={{ left: `${getPosPct(pos)}%`, transform: 'translateX(-50%)' }}
                onClick={() => handleGWClick(pos, 'old')}
              >
                 <div className={`w-2 h-6 rounded transition-all shadow-md ${isSelected && selectedTrack === 'old' ? 'bg-yellow-400 scale-125' : 'bg-green-500 group-hover:bg-green-400 group-hover:scale-110'}`}></div>
                 <div className={`text-[10px] mt-1 font-mono font-bold ${isSelected && selectedTrack === 'old' ? 'text-yellow-400' : 'text-green-600'}`}>{pos.toFixed(2)}m</div>
              </div>
              )
           })}

           {/* Selected Spool Highlight for Old */}
           {selectedGWs.length === 2 && selectedTrack === 'old' && (
             <div 
               className="absolute top-10 h-6 bg-yellow-400/20 border-y border-yellow-400/50 z-10 animate-pulse"
               style={{ 
                 left: `${getPosPct(selectedGWs[0])}%`, 
                 width: `${getPosPct(selectedGWs[1]) - getPosPct(selectedGWs[0])}%` 
               }}
             />
           )}

           <div className="absolute top-28 left-4 text-xs font-bold text-gray-500 uppercase sticky left-4">Run New (Current)</div>
           <div className="absolute top-36 left-0 right-0 h-[2px] bg-gray-700"></div>
           {newGWs.map((pos, i) => {
              const m = matches.find(mx => mx.newIndex === i);
              const isSkipped = m && m.status === 'Skipped';
              const isSelected = selectedGWs.includes(pos);
              return (
                <div 
                  key={`new-${i}`} 
                  className="absolute top-[136px] flex flex-col items-center cursor-pointer group z-20" 
                  style={{ left: `${getPosPct(pos)}%`, transform: 'translateX(-50%)' }}
                  onClick={() => handleGWClick(pos, 'new')}
                >
                   <div className={`w-1.5 h-6 rounded transition-all shadow-md ${isSelected && selectedTrack === 'new' ? 'bg-yellow-400 scale-125' : isSkipped ? 'bg-rose-500 group-hover:bg-rose-400 group-hover:scale-110' : 'bg-blue-500 group-hover:bg-blue-400 group-hover:scale-110'}`}></div>
                   <div className={`text-[10px] mt-1 font-mono font-bold ${isSelected && selectedTrack === 'new' ? 'text-yellow-400' : isSkipped ? 'text-rose-500' : 'text-blue-600'}`}>{pos.toFixed(2)}m</div>
                </div>
              )
           })}

           {/* Selected Spool Highlight for New */}
           {selectedGWs.length === 2 && selectedTrack === 'new' && (
             <div 
               className="absolute top-[136px] h-6 bg-yellow-400/20 border-y border-yellow-400/50 z-10 animate-pulse"
               style={{ 
                 left: `${getPosPct(selectedGWs[0])}%`, 
                 width: `${getPosPct(selectedGWs[1]) - getPosPct(selectedGWs[0])}%` 
               }}
             />
           )}

           {/* Draw dashed lines connecting matches */}
           <svg className="absolute inset-0 w-full h-full pointer-events-none">
              {matches.filter(m => m.status === 'Match').map((m, i) => {
                 const x1 = `${getPosPct(m.oldVal as number)}%`;
                 const y1 = 48; // bottom of old tick (top:10(40px) + h:5(20px)) -> roughly 48px
                 const x2 = `${getPosPct(m.newVal as number)}%`;
                 const y2 = 136; // top of new tick (top:34(136px))
                 return (
                   <line key={`line-${i}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(147, 197, 253, 0.4)" strokeWidth="1.5" strokeDasharray="4 4" />
                 );
              })}
           </svg>
        </div>
      </div>

      {/* Offset Chart */}
      <div className="h-64 mb-8 bg-gray-50 p-4 rounded-xl border border-gray-200">
         <Line data={chartData} options={chartOptions as any} />
      </div>

      {/* Match Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-8 max-h-[300px] overflow-y-auto">
        <table className="w-full text-sm text-left">
          <thead className="text-gray-500 bg-gray-50 sticky top-0 border-b border-gray-200">
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
              <tr key={row.id} className="hover:bg-gray-100 transition-colors">
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
          onClick={() => onNext(ota)}
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
              <Pipeline3DViewer length={selectedGWs[1] - selectedGWs[0]} od={12} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
