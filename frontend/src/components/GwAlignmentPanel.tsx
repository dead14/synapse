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
  }, [gwData]);

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
    <div className="flex flex-col gap-6">
      
      {/* Automated Girth Weld Match Simulator Header */}
      <div>
        <h2 className="text-2xl font-bold text-gray-800">Automated Girth Weld Match Simulator</h2>
        <p className="text-sm text-gray-500 mt-1">Adjust the OTA % slider to see how the algorithm filters out local pipeline anomalies (like repair spools) vs how it forces matches.</p>
      </div>

      <div className="bg-white border border-gray-100 rounded-xl p-6 shadow-sm flex items-center justify-between">
        <div className="w-full max-w-2xl">
          <label className="block text-sm font-bold text-gray-600 mb-4">Odometer Tracking Accuracy (OTA) Threshold</label>
          <div className="flex items-center gap-6">
            <input 
              type="range" 
              min="0.1" max="5.0" step="0.1" 
              value={ota} 
              onChange={e => setOta(parseFloat(e.target.value))}
              className="w-full accent-blue-600 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
            />
            <div className="px-4 py-1.5 bg-blue-50 text-blue-600 font-bold rounded shadow-sm text-sm border border-blue-100">
              {ota.toFixed(1)}%
            </div>
          </div>
        </div>
      </div>

      {/* Timeline Viewer */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden flex flex-col">
        <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
          <h3 className="font-bold text-gray-700">Timeline Viewer (12+ km)</h3>
          <div className="flex items-center gap-3">
            <span className="text-xs font-bold text-gray-500">Zoom:</span>
            <input 
              type="range" 
              min="1" max="10" step="0.5" 
              value={zoom} 
              onChange={e => setZoom(parseFloat(e.target.value))}
              className="w-32 accent-blue-600 cursor-pointer"
            />
          </div>
        </div>
        
        <div className="p-6 overflow-x-auto bg-white">
          {/* Container whose width scales with zoom */}
          <div style={{ minWidth: `${100 * zoom}%` }} className="flex flex-col gap-12 py-8 transition-all duration-300 relative border-x border-gray-200">
            
            {/* Run Old (Reference) */}
            <div className="relative h-px w-full bg-gray-300">
              <span className="absolute -top-8 left-0 text-xs font-bold text-gray-500 tracking-wide">RUN OLD (REFERENCE)</span>
              <div className="absolute top-0 bottom-0 left-0 right-0 h-px bg-green-500" />
              
              {/* Render GW ticks for Old */}
              {processedData.slice(0, 50).map((gw, idx) => {
                const perc = (gw.distOld / (12 * 50)) * 100; // Render first 50 points dynamically
                if (perc > 100) return null;
                return (
                  <div key={`old-${idx}`} className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 flex flex-col items-center" style={{ left: `${perc}%` }}>
                    <div className="w-1.5 h-4 bg-green-500 rounded-full" />
                    <span className="text-[9px] font-bold text-green-600 mt-1 whitespace-nowrap">{gw.distOld.toFixed(2)}m</span>
                  </div>
                );
              })}
            </div>

            {/* Run New (Current) */}
            <div className="relative h-px w-full bg-gray-300 mt-4">
              <span className="absolute -top-8 left-0 text-xs font-bold text-gray-500 tracking-wide">RUN NEW (CURRENT)</span>
              <div className="absolute top-0 bottom-0 left-0 right-0 h-px bg-blue-500" />
              
              {/* Render GW ticks for New */}
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
              
              {/* Alignment Links (Dotted lines for matched items) */}
              {processedData.slice(0, 50).map((gw, idx) => {
                if (!gw.isMatched) return null;
                const percOld = (gw.distOld / (12 * 50)) * 100;
                const percNew = (gw.distNew / (12 * 50)) * 100;
                if (percOld > 100 || percNew > 100) return null;
                
                // Draw a simple dotted line connection if they are close enough visually
                // Using SVG for easier drawing
                return null;
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

      {/* Tabs and Content */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden flex flex-col">
        {/* Tab Headers */}
        <div className="flex border-b border-gray-200 bg-gray-50/50 overflow-x-auto">
          {tabs.map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-6 py-4 text-sm font-bold transition-colors border-b-2 whitespace-nowrap ${
                activeTab === tab 
                  ? 'border-blue-600 text-blue-600 bg-white' 
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-100'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="p-6">
          {activeTab === 'GW Offset' && (
            <div className="border border-gray-100 rounded-xl bg-white p-6 shadow-sm">
              <div className="inline-block px-3 py-1 bg-blue-50 text-blue-700 font-bold text-sm rounded mb-4">
                Girth Weld Offset
              </div>
              <div className="h-[300px] w-full">
                <Line options={chartOptions} data={chartData} />
              </div>
            </div>
          )}

          {activeTab.startsWith('Table') && (
            <div className="border border-gray-200 rounded-lg overflow-hidden flex flex-col max-h-[400px]">
              <div className="flex justify-between items-center p-2 border-b border-gray-200 bg-gray-50">
                <span className="text-xs font-bold text-gray-600 pl-2">Girth Weld Data ({activeTab})</span>
                <button className="text-blue-600 flex items-center text-xs font-bold px-3 py-1 hover:bg-blue-50 rounded transition-colors">
                  <FiDownload className="mr-1"/> Export
                </button>
              </div>
              <div className="flex-1 overflow-auto">
                <table className="w-full text-left border-collapse text-[11px] leading-tight table-fixed break-words">
                  <thead className="bg-gray-100 text-gray-700 sticky top-0 border-b border-gray-200 shadow-sm z-10">
                    <tr>
                      <th className="px-1 py-1 font-bold border-r border-gray-200 w-16">GW ID</th>
                      <th className="px-1 py-1 font-bold border-r border-gray-200">Distance Old (m)</th>
                      <th className="px-1 py-1 font-bold border-r border-gray-200">Distance New (m)</th>
                      <th className="px-1 py-1 font-bold border-r border-gray-200">Offset (m)</th>
                      <th className="px-1 py-1 font-bold border-r border-gray-200">Length (mm)</th>
                      <th className="px-1 py-1 font-bold">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {/* Render table based on active tab */}
                    {(() => {
                      let displayData = processedData;
                      if (activeTab === 'Table GW Unmatched') displayData = unmatchedData;
                      if (activeTab === 'Table GW Matched') displayData = matchedData;
                      
                      return displayData.map((row, i) => (
                        <tr key={i} className="hover:bg-blue-50/50 transition-colors">
                          <td className="px-1 py-1 border-r border-gray-100 font-medium">GW-{i+1}</td>
                          <td className="px-1 py-1 border-r border-gray-100">{row.distOld.toFixed(3)}</td>
                          <td className="px-1 py-1 border-r border-gray-100">{row.distNew.toFixed(3)}</td>
                          <td className="px-1 py-1 border-r border-gray-100 font-bold text-blue-600">{row.offset.toFixed(2)}</td>
                          <td className="px-1 py-1 border-r border-gray-100">12.0</td>
                          <td className="px-1 py-1">
                            {row.isMatched ? (
                              <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded text-[10px] font-bold">Matched</span>
                            ) : (
                              <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded text-[10px] font-bold">Unmatched</span>
                            )}
                          </td>
                        </tr>
                      ));
                    })()}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
