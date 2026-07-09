import React, { useState, useEffect, useMemo } from 'react';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, BarElement, Tooltip, Legend } from 'chart.js';
import { Line, Bar } from 'react-chartjs-2';
import { FiChevronLeft, FiChevronRight, FiActivity, FiAlertCircle } from 'react-icons/fi';
import annotationPlugin from 'chartjs-plugin-annotation';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Tooltip, Legend, annotationPlugin);

export default function StepGwSimulator({ onNext, onBack, config }: any) {
  const [ota, setOta] = useState(8.0);
  const [dtwOn, setDtwOn] = useState(false);
  const [matches, setMatches] = useState<any[]>([]);
  const [apiError, setApiError] = useState<string | null>(null);

  useEffect(() => {
    const fetchAlignment = async () => {
      try {
        const payload = {
          ota: ota,
          oldRun: config?.summaryData?.oldRun?.rawFeatures || [],
          newRun: config?.summaryData?.newRun?.rawFeatures || []
        };
        const token = localStorage.getItem('synapse_token') || '';
        const response = await fetch('http://localhost:8000/api/align-dtw', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
          body: JSON.stringify(payload)
        });
        if (!response.ok) throw new Error('API Error');
        const data = await response.json();
        
        let finalMatches = [];
        if (dtwOn) {
          finalMatches = (data.gwMatches || []).filter((m: any) => m.status === 'Match');
        } else {
          // Mock naive 1-to-1 match for DTW OFF
          const oldGws = payload.oldRun.filter((f: any) => f.type === 'weld' || f.type === 'Weld');
          const newGws = payload.newRun.filter((f: any) => f.type === 'weld' || f.type === 'Weld');
          const minLen = Math.min(oldGws.length, newGws.length);
          for (let i = 1; i < minLen; i++) {
            const lRef = oldGws[i].dist - oldGws[i-1].dist;
            const lNew = newGws[i].dist - newGws[i-1].dist;
            let dev = lRef > 0 ? Math.abs(lNew - lRef) / lRef : 0;
            // Simulate severe slip if they change slider
            dev = dev + (ota / 100); 
            
            finalMatches.push({
              oldIndex: i, newIndex: i,
              oldDist: oldGws[i].dist, newDist: newGws[i].dist,
              L_ref: lRef, L_new: lNew,
              deviation_ratio: dev,
              flagged: dev > 0.05,
              scaling_factor: 1.0
            });
          }
        }
        
        setMatches(finalMatches);
      } catch (err) {
        setApiError('Failed to fetch data');
      }
    };
    fetchAlignment();
  }, [ota, dtwOn]);

  const lineChartData = useMemo(() => {
    return {
      labels: matches.map((_, i) => i + 1),
      datasets: [
        {
          label: 'Baseline (Reference)',
          data: matches.map(m => m.oldDist),
          borderColor: '#F59E0B',
          borderDash: [5, 5],
          pointRadius: 0,
          borderWidth: 2
        },
        {
          label: 'Raw Odometer',
          data: matches.map(m => m.newDist),
          borderColor: '#3B82F6',
          backgroundColor: 'rgba(59, 130, 246, 0.2)',
          pointRadius: 2,
          borderWidth: 2
        }
      ]
    };
  }, [matches]);

  const barChartData = useMemo(() => {
    return {
      labels: matches.map((_, i) => i + 1),
      datasets: [
        {
          label: 'Error (%)',
          data: matches.map(m => m.deviation_ratio * 100),
          backgroundColor: matches.map(m => m.deviation_ratio > 0.05 ? '#EF4444' : '#10B981'),
        }
      ]
    };
  }, [matches]);

  const maxDrift = matches.length > 0 ? Math.max(...matches.map(m => Math.abs(m.oldDist - m.newDist))) : 0;
  const avgSlip = matches.length > 0 ? matches.reduce((acc, m) => acc + m.deviation_ratio, 0) / matches.length : 0;
  const flaggedCount = matches.filter(m => m.flagged).length;

  return (
    <div className="w-full text-gray-800 flex flex-col gap-6">
      <div className="bg-[#1a1a1a] p-6 rounded-2xl shadow-xl flex justify-between items-center text-white">
        <h2 className="text-2xl font-bold tracking-tight">ILI Pipeline Integrity Portal: GW Alignment & Odometer Validation</h2>
      </div>

      <div className="flex gap-6">
        <div className="w-1/4 bg-white p-6 rounded-2xl shadow-md border border-gray-100 flex flex-col gap-6">
          <h3 className="font-bold text-gray-800 text-lg">Simulation Parameters</h3>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Simulate Odometer Slippage ({ota}%)</label>
            <input 
              type="range" min="0" max="15" step="0.5" 
              value={ota} onChange={e => setOta(parseFloat(e.target.value))}
              className="w-full accent-blue-500"
            />
          </div>

          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl border border-gray-200">
            <span className="font-medium text-sm">Apply DTW Correction<br/><span className="text-xs text-gray-500">(Alignment Optimization)</span></span>
            <button 
              onClick={() => setDtwOn(!dtwOn)}
              className={`w-14 h-8 rounded-full transition-colors relative ${dtwOn ? 'bg-blue-500' : 'bg-gray-300'}`}
            >
              <div className={`w-6 h-6 bg-white rounded-full absolute top-1 transition-all ${dtwOn ? 'left-7' : 'left-1'}`} />
            </button>
          </div>
        </div>

        <div className="w-3/4 flex flex-col gap-6">
          <div className="bg-white p-6 rounded-2xl shadow-md border border-gray-100 relative">
            <div className="absolute top-6 right-6 bg-gray-50 p-4 rounded-xl border border-gray-200 shadow-sm w-64">
              <h4 className="text-sm font-bold text-gray-700 border-b pb-2 mb-2">Key Metrics</h4>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-gray-500">Max Odometer Drift:</span>
                <span className="font-mono font-medium">+{maxDrift.toFixed(2)} m</span>
              </div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-gray-500">Average Slippage:</span>
                <span className="font-mono font-medium">{(avgSlip * 100).toFixed(1)}%</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Flagged Joints {'>'} 5%:</span>
                <span className={`font-mono font-medium ${flaggedCount > 0 ? 'text-red-500' : 'text-green-500'}`}>{flaggedCount} Joints</span>
              </div>
            </div>

            <h3 className="font-bold text-gray-800 mb-4">Odometer Jarak Deviasi (Baseline vs. Raw)</h3>
            <div className="h-64">
              <Line 
                data={lineChartData} 
                options={{ 
                  responsive: true, maintainAspectRatio: false,
                  scales: { x: { title: { display: true, text: 'Nomor Girth Weld (1 - 50)' } }, y: { title: { display: true, text: 'Jarak Kumulatif (m)' } } },
                  plugins: { legend: { position: 'bottom' } }
                }} 
              />
            </div>
          </div>

          <div className="bg-white p-6 rounded-2xl shadow-md border border-gray-100">
            <h3 className="font-bold text-gray-800 mb-4">Rasio Deviasi Joint Length (%)</h3>
            <div className="h-48">
              <Bar 
                data={barChartData} 
                options={{
                  responsive: true, maintainAspectRatio: false,
                  scales: { x: { display: false }, y: { title: { display: true, text: 'Error (%)' }, max: 20 } },
                  plugins: { 
                    legend: { display: false },
                    annotation: { annotations: { line1: { type: 'line', yMin: 5, yMax: 5, borderColor: 'red', borderWidth: 2, borderDash: [5, 5] } } } as any
                  }
                }}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="flex justify-between mt-4">
        <button onClick={onBack} className="px-6 py-3 rounded-xl font-medium text-gray-500 hover:text-gray-900 hover:bg-gray-100 flex items-center gap-2"><FiChevronLeft /> Previous</button>
        <button onClick={() => {
            // Need to save the gwMatches back!
            if (config) {
               config.gwMatches = matches;
            }
            onNext(ota)
        }} className="bg-brand-500 hover:bg-brand-600 text-white px-8 py-3 rounded-xl font-medium shadow-lg flex items-center gap-2">Accept Matches & Next <FiChevronRight /></button>
      </div>
    </div>
  );
}
