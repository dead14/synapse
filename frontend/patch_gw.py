import os

with open('src/wizard/StepGwSimulator.tsx', 'r', encoding='utf-8') as f:
    text = f.read()

# 1. Imports
text = text.replace("import { Line } from 'react-chartjs-2';", "import { Line } from 'react-chartjs-2';\nimport OdometerDashboard from './OdometerDashboard';")

# 2. States
text = text.replace("const [activeTab, setActiveTab] = useState<'offset' | 'unmatched' | 'matched' | 'all'>('offset');", "const [activeTab, setActiveTab] = useState<'odometer' | 'offset' | 'unmatched' | 'matched' | 'all'>('odometer');\n  const [dtwOn, setDtwOn] = useState(false);")

# 3. Payload and Matches
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

# 5. Inject the Dashboard UI and Tabs
tabs_str = """          <button onClick={() => setActiveTab('offset')} className={`px-4 py-3 border-b-2 font-medium text-sm transition-colors ${activeTab === 'offset' ? 'border-brand-500 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}>Offset vs Distance</button>"""

new_tabs_str = """          <button onClick={() => setActiveTab('odometer')} className={`px-4 py-3 border-b-2 font-medium text-sm transition-colors ${activeTab === 'odometer' ? 'border-brand-500 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}>Odometer Slippage</button>
""" + tabs_str
text = text.replace(tabs_str, new_tabs_str)

dashboard_ui = """
        {activeTab === 'odometer' && (
          <OdometerDashboard matches={matches} ota={ota} setOta={setOta} dtwOn={dtwOn} setDtwOn={setDtwOn} />
        )}
"""

text = text.replace("{activeTab === 'offset' && (", dashboard_ui + "{activeTab === 'offset' && (")

with open('src/wizard/StepGwSimulator.tsx', 'w', encoding='utf-8') as f:
    f.write(text)

