import React, { useMemo } from 'react';
import { Line, Bar } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, BarElement, Tooltip, Legend } from 'chart.js';
import annotationPlugin from 'chartjs-plugin-annotation';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Tooltip, Legend, annotationPlugin);

export default function OdometerDashboard({ matches, ota, setOta, dtwOn, setDtwOn }: any) {
  const lineChartData = useMemo(() => {
    return {
      labels: matches.map((_: any, i: number) => i + 1),
      datasets: [
        { label: 'Baseline (Reference)', data: matches.map((m: any) => m.oldVal || m.oldDist || 0), borderColor: '#F59E0B', borderDash: [5, 5], pointRadius: 0, borderWidth: 1.5 },
        { label: 'Raw Odometer', data: matches.map((m: any) => m.newVal || m.newDist || 0), borderColor: '#3B82F6', backgroundColor: 'rgba(59, 130, 246, 0.08)', fill: true, pointRadius: 1, borderWidth: 1.5 }
      ]
    };
  }, [matches]);

  const barChartData = useMemo(() => {
    return {
      labels: matches.map((_: any, i: number) => i + 1),
      datasets: [
        { label: 'Error (%)', data: matches.map((m: any) => (m.deviationRatio || 0) * 100), backgroundColor: matches.map((m: any) => (m.deviationRatio || 0) > 0.05 ? '#EF4444' : '#10B981'), borderRadius: 2 }
      ]
    };
  }, [matches]);

  const maxDrift = matches.length > 0 ? Math.max(...matches.map((m: any) => Math.abs((m.oldVal || m.oldDist || 0) - (m.newVal || m.newDist || 0)))) : 0;
  const avgSlip = matches.length > 0 ? matches.reduce((acc: number, m: any) => acc + (m.deviationRatio || 0), 0) / matches.length : 0;
  const flaggedCount = matches.filter((m: any) => m.flagged).length;

  const compactChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { display: false },
      y: { grid: { color: 'rgba(0,0,0,0.04)' }, ticks: { font: { size: 9 }, color: '#9ca3af' } }
    }
  };

  return (
    <div className="w-full flex flex-col gap-4">
      {/* Compact Metrics Row */}
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
            <svg className="w-4 h-4 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>
          </div>
          <div>
            <div className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">Max Drift</div>
            <div className="text-sm font-bold font-mono text-gray-800">+{maxDrift.toFixed(2)}m</div>
          </div>
        </div>
        <div className="h-8 w-px bg-gray-200"></div>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center">
            <svg className="w-4 h-4 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
          </div>
          <div>
            <div className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">Avg Slippage</div>
            <div className="text-sm font-bold font-mono text-gray-800">{(avgSlip * 100).toFixed(1)}%</div>
          </div>
        </div>
        <div className="h-8 w-px bg-gray-200"></div>
        <div className="flex items-center gap-2">
          <div className={`w-8 h-8 rounded-lg ${flaggedCount > 0 ? 'bg-red-50' : 'bg-green-50'} flex items-center justify-center`}>
            <svg className={`w-4 h-4 ${flaggedCount > 0 ? 'text-red-500' : 'text-green-500'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" /></svg>
          </div>
          <div>
            <div className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">Flagged {'>'} 5%</div>
            <div className={`text-sm font-bold font-mono ${flaggedCount > 0 ? 'text-red-500' : 'text-green-600'}`}>{flaggedCount} Joints</div>
          </div>
        </div>
      </div>

      {/* Side-by-side Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Odometer Distance Chart */}
        <div className="bg-gray-50/50 rounded-xl border border-gray-100 p-4">
          <div className="flex justify-between items-center mb-3">
            <h4 className="text-xs font-bold text-gray-700">Odometer Deviasi (Baseline vs Raw)</h4>
            <div className="flex items-center gap-3 text-[9px]">
              <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-amber-500 inline-block" style={{borderTop: '2px dashed #F59E0B'}}></span> Baseline</span>
              <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-blue-500 inline-block"></span> Raw</span>
            </div>
          </div>
          <div className="h-40">
            <Line data={lineChartData} options={compactChartOptions as any} />
          </div>
        </div>

        {/* Deviation Ratio Chart */}
        <div className="bg-gray-50/50 rounded-xl border border-gray-100 p-4">
          <div className="flex justify-between items-center mb-3">
            <h4 className="text-xs font-bold text-gray-700">Rasio Deviasi Joint Length (%)</h4>
            <div className="flex items-center gap-1 text-[9px] text-red-500 font-medium">
              <span className="w-6 h-0 border-t-2 border-dashed border-red-400 inline-block"></span> OTA {ota}%
            </div>
          </div>
          <div className="h-40">
            <Bar data={barChartData} options={{
              ...compactChartOptions,
              scales: { 
                ...compactChartOptions.scales, 
                y: { ...compactChartOptions.scales.y, max: 20 } 
              },
              plugins: { 
                ...compactChartOptions.plugins,
                annotation: { 
                  annotations: { 
                    line1: { type: 'line', yMin: 5, yMax: 5, borderColor: 'red', borderWidth: 1.5, borderDash: [4, 4] } 
                  } 
                } as any 
              } 
            } as any} />
          </div>
        </div>
      </div>
    </div>
  );
}
