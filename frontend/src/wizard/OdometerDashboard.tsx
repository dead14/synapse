import React, { useMemo } from 'react';
import { Line, Bar } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, BarElement, Tooltip, Legend } from 'chart.js';
import annotationPlugin from 'chartjs-plugin-annotation';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Tooltip, Legend, annotationPlugin);

export default function OdometerDashboard({ matches, ota, setOta: _setOta, dtwOn: _dtwOn, setDtwOn: _setDtwOn }: any) {
  const samples = useMemo(() => matches
    .map((match: any) => {
      const oldDistance = Number(match.oldVal ?? match.oldDist);
      const newDistance = Number(match.newVal ?? match.newDist);
      const deviationPct = Math.abs(Number(match.deviationRatio ?? 0)) * 100;

      return {
        oldDistance,
        newDistance,
        offset: newDistance - oldDistance,
        deviationPct,
        flagged: Boolean(match.flagged) || deviationPct > ota,
      };
    })
    .filter((sample: any) => Number.isFinite(sample.oldDistance) && Number.isFinite(sample.newDistance))
    .sort((left: any, right: any) => left.oldDistance - right.oldDistance), [matches, ota]);

  const lineChartData = useMemo(() => ({
    datasets: [
      {
        label: 'Baseline (Reference)',
        data: samples.map((sample: any) => ({ x: sample.oldDistance, y: sample.oldDistance })),
        borderColor: '#F59E0B', borderDash: [5, 5], pointRadius: 0, borderWidth: 1.5, parsing: false as const,
      },
      {
        label: 'Raw Odometer',
        data: samples.map((sample: any) => ({ x: sample.oldDistance, y: sample.newDistance })),
        borderColor: '#3B82F6', pointRadius: 0, borderWidth: 1.5, parsing: false as const,
      },
    ],
  }), [samples]);

  const barChartData = useMemo(() => ({
    datasets: [{
      label: 'Spool OTA deviation (%)',
      data: samples.map((sample: any) => ({ x: sample.oldDistance, y: sample.deviationPct })),
      backgroundColor: samples.map((sample: any) => sample.flagged ? '#EF4444' : '#10B981'),
      borderRadius: 1,
      parsing: false as const,
    }],
  }), [samples]);

  const maxDrift = samples.length > 0 ? Math.max(...samples.map((sample: any) => Math.abs(sample.offset))) : 0;
  const avgSlip = samples.length > 0 ? samples.reduce((total: number, sample: any) => total + sample.deviationPct, 0) / samples.length : 0;
  const flaggedCount = samples.filter((sample: any) => sample.flagged).length;
  const maximumDeviation = samples.length > 0 ? Math.max(...samples.map((sample: any) => sample.deviationPct)) : 0;
  const deviationAxisMax = Math.max(5, Math.ceil((Math.max(maximumDeviation, ota) + 1) / 5) * 5);

  const axisText = { font: { size: 9 }, color: '#9ca3af' };
  const chartGrid = { color: 'rgba(0,0,0,0.04)' };
  const positionChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    normalized: true,
    plugins: { legend: { display: false } },
    scales: {
      x: { type: 'linear' as const, grid: chartGrid, ticks: axisText, title: { display: true, text: 'Pipeline position (m)', color: '#9ca3af', font: { size: 9 } } },
      y: { grid: chartGrid, ticks: axisText, title: { display: true, text: 'Odometer (m)', color: '#9ca3af', font: { size: 9 } } },
    },
  };

  const deviationChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    normalized: true,
    plugins: {
      legend: { display: false },
      annotation: {
        annotations: {
          otaLimit: { type: 'line', yMin: ota, yMax: ota, borderColor: '#EF4444', borderWidth: 1.5, borderDash: [4, 4] },
        },
      } as any,
    },
    scales: {
      x: { type: 'linear' as const, grid: chartGrid, ticks: axisText, title: { display: true, text: 'Pipeline position (m)', color: '#9ca3af', font: { size: 9 } } },
      y: { beginAtZero: true, max: deviationAxisMax, grid: chartGrid, ticks: axisText, title: { display: true, text: 'OTA deviation (%)', color: '#9ca3af', font: { size: 9 } } },
    },
  };

  return (
    <div className="w-full flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3">
          <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
            <svg className="w-4 h-4 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>
          </div>
          <div>
            <div className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">Max Drift</div>
            <div className="text-sm font-bold font-mono text-gray-800">+{maxDrift.toFixed(2)}m</div>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3">
          <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center">
            <svg className="w-4 h-4 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
          </div>
          <div>
            <div className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">Avg Slippage</div>
            <div className="text-sm font-bold font-mono text-gray-800">{avgSlip.toFixed(2)}%</div>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3">
          <div className={`w-8 h-8 rounded-lg ${flaggedCount > 0 ? 'bg-red-50' : 'bg-green-50'} flex items-center justify-center`}>
            <svg className={`w-4 h-4 ${flaggedCount > 0 ? 'text-red-500' : 'text-green-500'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" /></svg>
          </div>
          <div>
            <div className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">Flagged {'>'} {ota}%</div>
            <div className={`text-sm font-bold font-mono ${flaggedCount > 0 ? 'text-red-500' : 'text-green-600'}`}>{flaggedCount} Joints</div>
          </div>
        </div>
      </div>

      {/* Side-by-side Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Odometer Distance Chart */}
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-theme-xs">
          <div className="flex justify-between items-center mb-3">
            <h4 className="text-sm font-semibold text-gray-800">Odometer comparison</h4>
            <div className="flex items-center gap-3 text-[9px]">
              <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-amber-500 inline-block" style={{borderTop: '2px dashed #F59E0B'}}></span> Baseline</span>
              <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-blue-500 inline-block"></span> Raw</span>
            </div>
          </div>
          <div className="h-52" aria-label="Reference and raw odometer comparison chart">
            <Line data={lineChartData} options={positionChartOptions as any} />
          </div>
        </div>

        {/* Deviation Ratio Chart */}
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-theme-xs">
          <div className="flex justify-between items-center mb-3">
            <h4 className="text-sm font-semibold text-gray-800">Spool / joint OTA deviation</h4>
            <div className="flex items-center gap-1 text-[9px] text-red-500 font-medium">
              <span className="w-6 h-0 border-t-2 border-dashed border-red-400 inline-block"></span> OTA {ota}%
            </div>
          </div>
          <div className="h-52" aria-label="Spool and joint OTA deviation chart">
            <Bar data={barChartData} options={deviationChartOptions as any} />
          </div>
        </div>
      </div>
    </div>
  );
}
