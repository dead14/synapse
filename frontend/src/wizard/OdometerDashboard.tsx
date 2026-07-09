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
        { label: 'Baseline (Reference)', data: matches.map((m: any) => m.oldVal || m.oldDist || 0), borderColor: '#F59E0B', borderDash: [5, 5], pointRadius: 0, borderWidth: 2 },
        { label: 'Raw Odometer', data: matches.map((m: any) => m.newVal || m.newDist || 0), borderColor: '#3B82F6', backgroundColor: 'rgba(59, 130, 246, 0.2)', pointRadius: 2, borderWidth: 2 }
      ]
    };
  }, [matches]);

  const barChartData = useMemo(() => {
    return {
      labels: matches.map((_: any, i: number) => i + 1),
      datasets: [
        { label: 'Error (%)', data: matches.map((m: any) => (m.deviationRatio || 0) * 100), backgroundColor: matches.map((m: any) => (m.deviationRatio || 0) > 0.05 ? '#EF4444' : '#10B981') }
      ]
    };
  }, [matches]);

  const maxDrift = matches.length > 0 ? Math.max(...matches.map((m: any) => Math.abs((m.oldVal || m.oldDist || 0) - (m.newVal || m.newDist || 0)))) : 0;
  const avgSlip = matches.length > 0 ? matches.reduce((acc: number, m: any) => acc + (m.deviationRatio || 0), 0) / matches.length : 0;
  const flaggedCount = matches.filter((m: any) => m.flagged).length;

  return (
    <div className="w-full flex flex-col gap-6 mt-4">
        <div className="bg-white p-6 rounded-2xl shadow-md border border-gray-100 relative">
          <div className="absolute top-6 right-6 bg-gray-50 p-4 rounded-xl border border-gray-200 shadow-sm w-64">
            <h4 className="text-sm font-bold text-gray-700 border-b pb-2 mb-2">Key Metrics</h4>
            <div className="flex justify-between text-sm mb-1"><span className="text-gray-500">Max Odometer Drift:</span><span className="font-mono font-medium">+{maxDrift.toFixed(2)} m</span></div>
            <div className="flex justify-between text-sm mb-1"><span className="text-gray-500">Average Slippage:</span><span className="font-mono font-medium">{(avgSlip * 100).toFixed(1)}%</span></div>
            <div className="flex justify-between text-sm"><span className="text-gray-500">Flagged Joints {'>'} 5%:</span><span className={`font-mono font-medium ${flaggedCount > 0 ? 'text-red-500' : 'text-green-500'}`}>{flaggedCount} Joints</span></div>
          </div>
          <h3 className="font-bold text-gray-800 mb-4">Odometer Jarak Deviasi (Baseline vs. Raw)</h3>
          <div className="h-64">
            <Line data={lineChartData} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }} />
          </div>
        </div>
        <div className="bg-white p-6 rounded-2xl shadow-md border border-gray-100">
          <h3 className="font-bold text-gray-800 mb-4">Rasio Deviasi Joint Length (%)</h3>
          <div className="h-48">
            <Bar data={barChartData} options={{ responsive: true, maintainAspectRatio: false, scales: { x: { display: false }, y: { max: 20 } }, plugins: { legend: { display: false }, annotation: { annotations: { line1: { type: 'line', yMin: 5, yMax: 5, borderColor: 'red', borderWidth: 2, borderDash: [5, 5] } } } as any } }} />
          </div>
        </div>
    </div>
  );
}
