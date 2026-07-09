import os
import re

with open('src/wizard/StepGwSimulator.tsx', 'r', encoding='utf-8') as f:
    text = f.read()

# 1. Imports
text = text.replace("import { Line } from 'react-chartjs-2';", "import { Line, Bar } from 'react-chartjs-2';\nimport annotationPlugin from 'chartjs-plugin-annotation';")
text = text.replace("ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip);", "import { BarElement, Legend } from 'chart.js';\nChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Tooltip, Legend, annotationPlugin);")

# 2. States
text = text.replace("const [activeTab, setActiveTab] = useState<'offset' | 'unmatched' | 'matched' | 'all'>('offset');", "const [activeTab, setActiveTab] = useState<'odometer' | 'offset' | 'unmatched' | 'matched' | 'all'>('odometer');\n  const [dtwOn, setDtwOn] = useState(false);")

# 3. Payload and Matches (We need to replace the API call block)
old_map = """             offset: m.newDist && m.oldDist ? m.newDist - m.oldDist : 0,
             status: m.status || 'Match'
          }));"""
new_map = """             offset: m.newDist && m.oldDist ? m.newDist - m.oldDist : 0,
             status: m.status || 'Match',
             lRef: m.L_ref || 0,
             lNew: m.L_new || 0,
             deviationRatio: m.deviation_ratio || 0,
             flagged: m.flagged || false,
             scalingFactor: m.scaling_factor || 1.0
          }));
          
          if (!dtwOn) {
            // Mock naive 1-to-1 match for DTW OFF
            const oldGws = payload.oldRun.filter((f: any) => f.type === 'weld' || f.type === 'Weld');
            const newGws = payload.newRun.filter((f: any) => f.type === 'weld' || f.type === 'Weld');
            const minLen = Math.min(oldGws.length, newGws.length);
            formattedMatches = [];
            for (let i = 1; i < minLen; i++) {
              const lRef = oldGws[i].dist - oldGws[i-1].dist;
              const lNew = newGws[i].dist - newGws[i-1].dist;
              let dev = lRef > 0 ? Math.abs(lNew - lRef) / lRef : 0;
              dev = dev + (ota / 100); 
              formattedMatches.push({
                id: `match-${i}-${i}`,
                oldIndex: i, newIndex: i,
                oldVal: oldGws[i].dist, newVal: newGws[i].dist,
                varPct: dev * 100,
                offset: newGws[i].dist - oldGws[i].dist,
                status: 'Match',
                lRef: lRef, lNew: lNew,
                deviationRatio: dev,
                flagged: dev > 0.05,
                scalingFactor: 1.0
              });
            }
          }"""
text = text.replace(old_map, new_map)

# 4. UseEffect dependencies
text = text.replace("}, [ota, config]);", "}, [ota, dtwOn, config]);")

# 5. Add lineChartData and barChartData
charts_code = """
  const lineChartData = useMemo(() => {
    return {
      labels: matches.map((_, i) => i + 1),
      datasets: [
        { label: 'Baseline (Reference)', data: matches.map(m => m.oldVal), borderColor: '#F59E0B', borderDash: [5, 5], pointRadius: 0, borderWidth: 2 },
        { label: 'Raw Odometer', data: matches.map(m => m.newVal), borderColor: '#3B82F6', backgroundColor: 'rgba(59, 130, 246, 0.2)', pointRadius: 2, borderWidth: 2 }
      ]
    };
  }, [matches]);

  const barChartData = useMemo(() => {
    return {
      labels: matches.map((_, i) => i + 1),
      datasets: [
        { label: 'Error (%)', data: matches.map(m => (m.deviationRatio || 0) * 100), backgroundColor: matches.map(m => (m.deviationRatio || 0) > 0.05 ? '#EF4444' : '#10B981') }
      ]
    };
  }, [matches]);

  const maxDrift = matches.length > 0 ? Math.max(...matches.map(m => Math.abs((m.oldVal || 0) - (m.newVal || 0)))) : 0;
  const avgSlip = matches.length > 0 ? matches.reduce((acc, m) => acc + (m.deviationRatio || 0), 0) / matches.length : 0;
  const flaggedCount = matches.filter(m => m.flagged).length;

"""
text = text.replace("const graphPoints = useMemo(", charts_code + "const graphPoints = useMemo(")

# 6. Inject the Dashboard UI and Tabs
tabs_str = """          <button onClick={() => setActiveTab('offset')} className={`px-4 py-3 border-b-2 font-medium text-sm transition-colors ${activeTab === 'offset' ? 'border-brand-500 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}>Offset vs Distance</button>"""

new_tabs_str = """          <button onClick={() => setActiveTab('odometer')} className={`px-4 py-3 border-b-2 font-medium text-sm transition-colors ${activeTab === 'odometer' ? 'border-brand-500 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}>Odometer Slippage</button>
""" + tabs_str
text = text.replace(tabs_str, new_tabs_str)

dashboard_ui = """
        {activeTab === 'odometer' && (
          <div className="flex gap-6 w-full mt-4">
            <div className="w-1/4 bg-white p-6 rounded-2xl shadow-md border border-gray-100 flex flex-col gap-6">
              <h3 className="font-bold text-gray-800 text-lg">Simulation Parameters</h3>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Simulate Slippage ({ota}%)</label>
                <input type="range" min="0" max="15" step="0.5" value={ota} onChange={e => setOta(parseFloat(e.target.value))} className="w-full accent-blue-500" />
              </div>
              <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl border border-gray-200">
                <span className="font-medium text-sm">Apply DTW Correction<br/><span className="text-xs text-gray-500">(Alignment Optimization)</span></span>
                <button onClick={() => setDtwOn(!dtwOn)} className={`w-14 h-8 rounded-full transition-colors relative ${dtwOn ? 'bg-blue-500' : 'bg-gray-300'}`}>
                  <div className={`w-6 h-6 bg-white rounded-full absolute top-1 transition-all ${dtwOn ? 'left-7' : 'left-1'}`} />
                </button>
              </div>
            </div>
            <div className="w-3/4 flex flex-col gap-6">
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
          </div>
        )}
"""

text = text.replace("{activeTab === 'offset' && (", dashboard_ui + "{activeTab === 'offset' && (")

with open('src/wizard/StepGwSimulator.tsx', 'w', encoding='utf-8') as f:
    f.write(text)

