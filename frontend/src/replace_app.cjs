const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'App.tsx');
let content = fs.readFileSync(filePath, 'utf8');

content = content.replace("import RiskTrendChart from './components/charts/RiskTrendChart';", "import AlignmentQualityTrendChart from './components/charts/AlignmentQualityTrendChart';");
content = content.replace("import AssetCompositionChart from './components/charts/AssetCompositionChart';", "import FeatureCompositionChart from './components/charts/FeatureCompositionChart';");

const newDashboardComponent = `const Dashboard = () => {
  const navigate = useNavigate();
  const [stats, setStats] = useState<any>({
    kpi: { totalIliRuns: 0, averageMatchRate: 0, unmatchedFeatures: 0, averageConfidence: 0 },
    featureComposition: { matched: 0, unmatched: 0, newFeature: 0, removedFeature: 0 },
    growthAnalysis: [],
    recentJobs: [],
    trendData: [],
    mapIndicators: []
  });

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const token = localStorage.getItem('synapse_token');
        const res = await fetch('http://localhost:8000/api/dashboard/stats', {
          headers: { Authorization: \`Bearer \${token}\` }
        });
        if (res.ok) {
          const data = await res.json();
          setStats(data);
        }
      } catch (err) {
        console.error('Failed to fetch stats:', err);
      }
    };
    fetchStats();
  }, []);

  return (
    <div>
      <div className="flex justify-between items-end mb-6">
        <div>
          <h1 className="text-title-md2 font-bold text-gray-800 dark:text-white/90">ILI Alignment Overview</h1>
        </div>
        <div className="flex gap-3 items-center">
          <button 
            title="Data Management"
            onClick={() => navigate('/data')}
            className="group flex items-center justify-center rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 hover:shadow-sm dark:border-gray-800 dark:bg-white/[0.03] dark:text-white/90 dark:hover:bg-white/[0.05] transition-all"
          >
            <FiPlus size={18} className="mr-2" />
            Upload ILI Data
          </button>
          
          <button 
            onClick={() => navigate('/alignment')}
            className="flex items-center justify-center rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 transition-colors gap-2"
          >
            Run Alignment 
            <FiArrowUpRight size={16} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6 mb-6">
        <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] md:p-6">
          <div className="flex items-center justify-center w-12 h-12 bg-gray-100 rounded-xl dark:bg-gray-800">
            <FiActivity className="text-gray-800 size-6 dark:text-white/90" />
          </div>
          <div className="flex items-end justify-between mt-5">
            <div>
              <span className="text-sm text-gray-500 dark:text-gray-400">Total ILI Runs Terproses</span>
              <h4 className="mt-1 font-bold text-gray-800 text-title-sm dark:text-white/90">{stats.kpi.totalIliRuns}</h4>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] md:p-6">
          <div className="flex items-center justify-center w-12 h-12 bg-gray-100 rounded-xl dark:bg-gray-800">
            <FiCheckCircle className="text-gray-800 size-6 dark:text-white/90" />
          </div>
          <div className="flex items-end justify-between mt-5">
            <div>
              <span className="text-sm text-gray-500 dark:text-gray-400">Match Rate Rata-rata</span>
              <h4 className="mt-1 font-bold text-gray-800 text-title-sm dark:text-white/90">{stats.kpi.averageMatchRate}%</h4>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] md:p-6">
          <div className="flex items-center justify-center w-12 h-12 bg-gray-100 rounded-xl dark:bg-gray-800">
            <FiAlertTriangle className="text-gray-800 size-6 dark:text-white/90" />
          </div>
          <div className="flex items-end justify-between mt-5">
            <div>
              <span className="text-sm text-gray-500 dark:text-gray-400">Fitur Unmatched</span>
              <h4 className="mt-1 font-bold text-gray-800 text-title-sm dark:text-white/90">{stats.kpi.unmatchedFeatures}</h4>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] md:p-6">
          <div className="flex items-center justify-center w-12 h-12 bg-gray-100 rounded-xl dark:bg-gray-800">
            <FiClock className="text-gray-800 size-6 dark:text-white/90" />
          </div>
          <div className="flex items-end justify-between mt-5">
            <div>
              <span className="text-sm text-gray-500 dark:text-gray-400">Confidence Score avg</span>
              <h4 className="mt-1 font-bold text-gray-800 text-title-sm dark:text-white/90">{stats.kpi.averageConfidence}%</h4>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-4 md:gap-6 mb-6">
        <div className="col-span-12 xl:col-span-8 rounded-2xl border border-gray-200 bg-white px-5 pt-7 pb-5 shadow-sm dark:border-gray-800 dark:bg-white/[0.03] sm:px-7">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-4">
            <h2 className="text-lg font-bold text-gray-800 dark:text-white/90">Alignment Quality Trend</h2>
          </div>
          <AlignmentQualityTrendChart data={stats.trendData} />
        </div>

        <div className="col-span-12 xl:col-span-4 rounded-2xl border border-gray-200 bg-white px-5 pt-7 pb-5 shadow-sm dark:border-gray-800 dark:bg-white/[0.03] sm:px-7">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-4">
            <h2 className="text-lg font-bold text-gray-800 dark:text-white/90">Feature Composition</h2>
          </div>
          <FeatureCompositionChart data={stats.featureComposition} />
        </div>
      </div>

      <div className="grid grid-cols-12 gap-6 mb-6">
        <div className="col-span-12 xl:col-span-7 rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] md:p-6">
          <div className="flex justify-between items-center mb-5">
            <h2 className="text-lg font-bold text-gray-800 dark:text-white/90">Growth Analysis Highlights</h2>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-800 text-sm text-gray-500">
                  <th className="pb-3 font-medium">Anomaly ID</th>
                  <th className="pb-3 font-medium">Joint Number</th>
                  <th className="pb-3 font-medium">Growth (mm)</th>
                  <th className="pb-3 font-medium text-right">Status</th>
                </tr>
              </thead>
              <tbody>
                {stats.growthAnalysis.map((item: any) => (
                  <tr key={item.id} className="border-b border-gray-100 dark:border-gray-800/50 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-800/20">
                    <td className="py-4 text-sm font-semibold text-gray-800 dark:text-gray-200">{item.feature_id}</td>
                    <td className="py-4 text-sm text-gray-600 dark:text-gray-400">{item.joint_number}</td>
                    <td className="py-4 text-sm font-bold text-error">+{item.growth_rate}</td>
                    <td className="py-4 text-right">
                      <span className={\`inline-flex rounded-full px-3 py-1 text-xs font-medium \${item.status === 'Critical' ? 'bg-error/10 text-error' : 'bg-warning/10 text-warning'}\`}>
                        {item.status}
                      </span>
                    </td>
                  </tr>
                ))}
                {stats.growthAnalysis.length === 0 && (
                  <tr><td colSpan={4} className="py-8 text-center text-gray-500">No matching anomalies found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="col-span-12 xl:col-span-5 rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] md:p-6 flex flex-col h-[400px]">
          <h2 className="text-lg font-bold text-gray-800 dark:text-white/90 mb-4">Alignment Status Map</h2>
          <div className="flex-1 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-800 relative z-0">
            <MapContainer center={[-2.5, 118]} zoom={4} style={{ height: '100%', width: '100%' }} zoomControl={false}>
              <TileLayer
                url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
                attribution='&copy; OpenStreetMap'
              />
              {stats.mapIndicators.map((m: any) => (
                <CircleMarker 
                  key={m.id}
                  center={m.coords} 
                  pathOptions={{ 
                    color: m.status === 'Aligned' ? '#10B981' : m.status === 'Processing' ? '#3C50E0' : '#F59E0B', 
                    fillColor: m.status === 'Aligned' ? '#10B981' : m.status === 'Processing' ? '#3C50E0' : '#F59E0B', 
                    fillOpacity: 0.7 
                  }} 
                  radius={7}
                >
                  <Popup>{m.name} ({m.status})</Popup>
                </CircleMarker>
              ))}
            </MapContainer>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] md:p-6 mb-8">
        <h2 className="text-lg font-bold text-gray-800 dark:text-white/90 mb-5">Recent Alignment Jobs</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-800 text-sm text-gray-500 uppercase tracking-wider">
                <th className="pb-3 font-medium">Pipeline</th>
                <th className="pb-3 font-medium">Compared Runs</th>
                <th className="pb-3 font-medium">Match Rate</th>
                <th className="pb-3 font-medium">Status</th>
                <th className="pb-3 font-medium text-right">Date</th>
              </tr>
            </thead>
            <tbody>
              {stats.recentJobs.map((job: any) => (
                <tr key={job.id} className="border-b border-gray-100 dark:border-gray-800/50 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-800/20 transition-colors cursor-pointer" onClick={() => navigate(\`/compare\`)}>
                  <td className="py-4 text-sm font-semibold text-gray-800 dark:text-gray-200">{job.pipeline}</td>
                  <td className="py-4 text-sm text-gray-600 dark:text-gray-400">{job.runs}</td>
                  <td className="py-4 text-sm font-bold text-gray-800 dark:text-gray-300">{job.matchRate}%</td>
                  <td className="py-4">
                    <span className={\`inline-flex rounded-full px-3 py-1 text-xs font-medium \${
                      job.status === 'completed' ? 'bg-success/10 text-success' : 
                      job.status === 'failed' ? 'bg-error/10 text-error' : 
                      'bg-brand-500/10 text-brand-500'
                    }\`}>
                      {job.status}
                    </span>
                  </td>
                  <td className="py-4 text-sm text-gray-500 text-right">{job.date}</td>
                </tr>
              ))}
              {stats.recentJobs.length === 0 && (
                <tr><td colSpan={5} className="py-8 text-center text-gray-500">No recent alignment jobs.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};`;

content = content.replace(/const Dashboard = \(\) => \{[\s\S]*?(?=\nimport AppLayout from)/, newDashboardComponent);
fs.writeFileSync(filePath, content);
console.log('Successfully updated App.tsx');
