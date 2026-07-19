import { useState, useMemo } from 'react';
import { Line } from 'react-chartjs-2';
import { FiDownload } from 'react-icons/fi';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

interface GwAlignmentPanelProps {
  gwData: any[]; // Array of dummy GW matches
}

export default function GwAlignmentPanel({ gwData }: GwAlignmentPanelProps) {
  const [zoom, setZoom] = useState(1);
  const [ota, setOta] = useState(1.6);
  const [activeTab, setActiveTab] = useState('GW Offset');

  const tabs = ['GW Offset', 'Table GW Unmatched', 'Table GW Matched', 'Table GW'];

  // Process data using OTA algorithm
  const processedData = useMemo(() => {
    return gwData.map(d => {
      const threshold = (ota / 100) * d.distOld;
      const offset = Math.abs(d.distNew - d.distOld);
      // If we are at the very beginning (distOld is small), give a minimum threshold of 0.5m
      const actualThreshold = Math.max(0.5, threshold);
      const isMatched = offset <= actualThreshold;
      return { ...d, isMatched, offset: d.distNew - d.distOld, threshold: actualThreshold };
    });
  }, [gwData, ota]);

  const matchedData = useMemo(() => processedData.filter(d => d.isMatched), [processedData]);
  const unmatchedData = useMemo(() => processedData.filter(d => !d.isMatched), [processedData]);

  // Prepare chart data for Spline curve (GW Offset)
  const chartData = useMemo(() => {
    // Sort by distance to make a smooth line (only for matched or all?)
    // Usually offset chart plots all matched points
    const sortedData = [...matchedData].sort((a, b) => a.distOld - b.distOld);
    
    return {
      labels: sortedData.map(d => d.distOld.toFixed(1)),
      datasets: [
        {
          label: 'Offset (New - Old) m',
          data: sortedData.map(d => d.distNew - d.distOld),
          borderColor: '#60a5fa', // blue-400
          backgroundColor: 'rgba(96, 165, 250, 0.2)', // light blue fill
          tension: 0.4, // Smooth curve (bezier/spline)
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
          fill: true,
        }
      ]
    };
  }, [matchedData]);

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: true,
        position: 'top' as const,
        labels: { boxWidth: 20, usePointStyle: false }
      },
      tooltip: {
        mode: 'index' as const,
        intersect: false,
      },
    },
    scales: {
      x: {
        title: { display: true, text: 'Pipeline Length (m)', align: 'end' as const },
        grid: { color: '#f3f4f6', drawBorder: false },
        ticks: { maxTicksLimit: 10 }
      },
      y: {
        title: { display: true, text: 'Offset (New - Old) m' },
        grid: { color: '#f3f4f6', drawBorder: false },
        min: 0,
        suggestedMax: 14
      }
    },
    interaction: {
      mode: 'nearest' as const,
      axis: 'x' as const,
      intersect: false
    }
  };

  return (
    <div className="gw-alignment-panel flex flex-col gap-6">
      
      {/* Automated Girth Weld Match Simulator Header */}
      <div>
        <h2 className="text-2xl font-bold text-gray-800">Automated Girth Weld Match Simulator</h2>
        <p className="text-sm text-gray-500 mt-1">Adjust the OTA % slider to see how the algorithm filters out local pipeline anomalies (like repair spools) vs how it forces matches.</p>
      </div>

      {/* Two-Column Grid Layout */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-start">
        
        {/* LEFT COLUMN (Visuals & Charts) */}
        <div className="xl:col-span-2 flex flex-col gap-6">
          
          {/* 1. Timeline Viewer */}
          <div className="gw-alignment-timeline bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden flex flex-col">
            <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
              <h3 className="font-bold text-gray-700">Timeline Viewer (12+ km)</h3>
              <div className="flex items-center gap-3">
                <span className="text-xs font-bold text-gray-500">Zoom:</span>
                <input 
                  type="range" 
                  min="1" max="100" step="0.5" 
                  value={zoom} 
                  onChange={e => setZoom(parseFloat(e.target.value))}
                  className="w-32 accent-blue-600 cursor-pointer"
                />
              </div>
            </div>
            
            <div className="p-6 overflow-x-auto bg-white min-h-[250px] flex items-center">
              <div style={{ minWidth: `${100 * zoom}%` }} className="flex flex-col gap-12 py-8 transition-all duration-300 relative border-x border-gray-200 w-full">
                {/* Historical OLD */}
                <div className="relative h-px w-full bg-gray-300">
                  <span className="absolute -top-8 left-0 text-xs font-bold text-gray-500 tracking-wide">HISTORICAL OLD (NON-MASTER)</span>
                  <div className="absolute top-0 bottom-0 left-0 right-0 h-px bg-green-500" />
                  {processedData.slice(0, 50).map((gw, idx) => {
                    const perc = (gw.distOld / (12 * 50)) * 100;
                    if (perc > 100) return null;
                    return (
                      <div key={`old-${idx}`} className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 flex flex-col items-center" style={{ left: `${perc}%` }}>
                        <div className="w-1.5 h-4 bg-green-500 rounded-full" />
                        <span className="text-[9px] font-bold text-green-600 mt-1 whitespace-nowrap">{gw.distOld.toFixed(2)}m</span>
                      </div>
                    );
                  })}
                </div>

                {/* Master NEW */}
                <div className="relative h-px w-full bg-gray-300 mt-4">
                  <span className="absolute -top-8 left-0 text-xs font-bold text-gray-500 tracking-wide">MASTER NEW (CURRENT)</span>
                  <div className="absolute top-0 bottom-0 left-0 right-0 h-px bg-blue-500" />
                  {processedData.slice(0, 50).map((gw, idx) => {
                    const perc = (gw.distNew / (12 * 50)) * 100;
                    if (perc > 100) return null;
                    return (
                      <div key={`new-${idx}`} className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 flex flex-col items-center opacity-${gw.isMatched ? '100' : '40'}`} style={{ left: `${perc}%` }}>
                        <div className="w-1.5 h-4 bg-blue-500 rounded-full" />
                        <span className="text-[9px] font-bold text-blue-600 mt-1 whitespace-nowrap">{gw.distNew.toFixed(2)}m</span>
                      </div>
                    );
                  })}
                </div>
                
                <svg className="absolute inset-0 pointer-events-none w-full h-full" preserveAspectRatio="none">
                  {processedData.slice(0, 50).map((gw, idx) => {
                    if (!gw.isMatched) return null;
                    const percOld = (gw.distOld / (12 * 50)) * 100;
                    const percNew = (gw.distNew / (12 * 50)) * 100;
                    if (percOld > 100 || percNew > 100) return null;
                    return (
                      <line 
                        key={`link-${idx}`}
                        x1={`${percOld}%`} y1="35%" 
                        x2={`${percNew}%`} y2="72%" 
                        stroke="#cbd5e1" strokeWidth="1" strokeDasharray="2,2" 
                      />
                    );
                  })}
                </svg>
              </div>
            </div>
          </div>

          {/* 2. Trends & Settings (Bottom Left) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            
            {/* OTA Slider */}
            <div className="bg-white border border-gray-100 rounded-xl p-5 shadow-sm flex flex-col">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-gray-700">OTA Threshold Settings</h3>
                <span className="px-3 py-1 bg-blue-50 text-blue-600 font-bold rounded-lg text-sm border border-blue-100">
                  {ota.toFixed(1)}%
                </span>
              </div>
              <p className="text-xs text-orange-600 font-medium mb-6 bg-orange-50 p-3 rounded-lg border border-orange-100">
                Adjusting this threshold will immediately recalculate matched vs unmatched girth welds in your area.
              </p>
              
              <div className="mt-auto pb-2">
                <div className="flex justify-between text-xs text-gray-400 font-bold mb-2">
                  <span>0.1%</span>
                  <span>5.0%</span>
                </div>
                <input 
                  type="range" 
                  min="0.1" max="5.0" step="0.1" 
                  value={ota} 
                  onChange={e => setOta(parseFloat(e.target.value))}
                  className="w-full accent-blue-600 h-2.5 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                />
              </div>
            </div>

            {/* GW Offset Chart */}
            <div className="bg-white border border-gray-100 rounded-xl p-5 shadow-sm flex flex-col h-[280px]">
              <div className="flex justify-between items-center mb-2">
                <h3 className="font-bold text-gray-700">GW Offset Trends</h3>
                <span className="text-[10px] bg-gray-100 text-gray-500 px-2 py-1 rounded font-bold uppercase tracking-wider">Matched Only</span>
              </div>
              <div className="flex-1 w-full relative">
                <Line options={chartOptions} data={chartData} />
              </div>
            </div>

          </div>

        </div>

        {/* RIGHT COLUMN (Tables & Analytics) */}
        <div className="xl:col-span-1 flex flex-col gap-6">
          
          {/* Data Tables Container */}
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden flex flex-col flex-1 h-[450px]">
            {/* Tab Headers */}
            <div className="flex border-b border-gray-200 bg-gray-50/80">
              {tabs.filter(t => t.startsWith('Table')).map((tab, i) => {
                const isSelected = activeTab === tab || (activeTab === 'GW Offset' && i === 0);
                return (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`flex-1 px-2 py-3 text-[11px] font-bold transition-colors border-b-2 whitespace-nowrap ${
                      isSelected 
                        ? 'border-blue-600 text-blue-600 bg-white' 
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    {tab.replace('Table GW ', '') === 'Table GW' ? 'All' : tab.replace('Table GW ', '')}
                  </button>
                )
              })}
            </div>

            {/* Table Content */}
            <div className="flex flex-col flex-1 overflow-hidden relative">
              <div className="absolute inset-0 flex flex-col">
                <div className="flex justify-between items-center p-3 border-b border-gray-100">
                  <span className="text-xs font-bold text-gray-700">
                    {activeTab === 'GW Offset' ? 'Unmatched' : activeTab.replace('Table GW ', 'All')} Overview
                  </span>
                  <button className="text-blue-600 flex items-center text-[10px] font-bold px-2 py-1 bg-blue-50 rounded hover:bg-blue-100 transition-colors">
                    <FiDownload className="mr-1"/> Export
                  </button>
                </div>
                
                <div className="flex-1 overflow-auto bg-white custom-scrollbar">
                  <table className="w-full text-left border-collapse text-[11px] leading-tight table-fixed">
                    <thead className="bg-gray-50 text-gray-600 sticky top-0 border-b border-gray-200 shadow-sm z-10">
                      <tr>
                        <th className="px-3 py-2 font-bold w-14">ID</th>
                        <th className="px-3 py-2 font-bold">Old (m)</th>
                        <th className="px-3 py-2 font-bold">New (m)</th>
                        <th className="px-3 py-2 font-bold">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {(() => {
                        let displayData = processedData;
                        const currentTab = activeTab === 'GW Offset' ? 'Table GW Unmatched' : activeTab;
                        if (currentTab === 'Table GW Unmatched') displayData = unmatchedData;
                        if (currentTab === 'Table GW Matched') displayData = matchedData;
                        
                        return displayData.map((row, i) => (
                          <tr key={i} className="hover:bg-blue-50/50 transition-colors">
                            <td className="px-3 py-2 font-medium text-gray-700">GW-{i+1}</td>
                            <td className="px-3 py-2 text-gray-500">{row.distOld.toFixed(2)}</td>
                            <td className="px-3 py-2 text-gray-500">{row.distNew.toFixed(2)}</td>
                            <td className="px-3 py-2">
                              {row.isMatched ? (
                                <span className="inline-block px-1.5 py-0.5 bg-green-100 text-green-700 rounded text-[9px] font-bold uppercase">Match</span>
                              ) : (
                                <span className="inline-block px-1.5 py-0.5 bg-red-100 text-red-700 rounded text-[9px] font-bold uppercase">Unmatch</span>
                              )}
                            </td>
                          </tr>
                        ));
                      })()}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>

          {/* Odometer Slippage Widget */}
          <div className="bg-gradient-to-br from-blue-50 to-white border border-blue-100 rounded-xl shadow-sm p-5 flex flex-col relative overflow-hidden">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="font-bold text-gray-700">Odometer Slippage</h3>
                <p className="text-[11px] text-gray-500 mt-0.5">Estimated slippage along pipeline</p>
              </div>
              <span className="p-2 bg-white rounded-lg shadow-sm border border-gray-100 text-blue-600">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
              </span>
            </div>
            
            <div className="flex items-end gap-3 mb-2">
              <span className="text-3xl font-extrabold text-gray-800 tracking-tight">1.24%</span>
              <span className="text-xs font-bold text-red-500 mb-1 flex items-center bg-red-50 px-1.5 py-0.5 rounded">
                <svg className="w-3 h-3 mr-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"></path></svg>
                +0.15%
              </span>
            </div>
            
            <p className="text-[10px] text-gray-500 mb-4">Compared to previous inspection run (Jan 2024)</p>
            
            {/* Mini Dummy Bar Chart */}
            <div className="flex items-end h-16 gap-1 w-full mt-auto">
              {[4, 6, 5, 8, 12, 10, 16, 14, 18, 12, 8, 10, 15, 20, 22].map((val, idx) => (
                <div 
                  key={idx} 
                  className={`flex-1 rounded-t-sm ${idx > 12 ? 'bg-red-400' : 'bg-blue-400'}`}
                  style={{ height: `${(val / 22) * 100}%`, opacity: idx === 14 ? 1 : 0.6 }}
                />
              ))}
            </div>
          </div>

        </div>

      </div>
    </div>
  );
}
