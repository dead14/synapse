import { useState, useEffect } from 'react';
import { FiEye, FiSettings, FiBell, FiActivity, FiClock, FiCheckCircle, FiTrash2 } from 'react-icons/fi';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { apiFetch } from './utils/api';

interface PipelineRun {
  id: string;
  pipelineName: string;
  date: string;
  status: string;
  matchRate?: number | null;
  anomaliesFound: number;
  vendorLama: string;
  vendorBaru: string;
}

export default function PipelineRuns() {
  const navigate = useNavigate();
  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchRuns = async () => {
      try {
        setRuns(await apiFetch<PipelineRun[]>('/api/pipeline-runs'));
      } catch (err) {
        console.error('Failed to fetch pipeline runs:', err);
        setError('Riwayat pipeline tidak dapat dimuat.');
      } finally {
        setLoading(false);
      }
    };
    fetchRuns();
  }, []);

  const deleteRun = async (runId: string) => {
    if (!window.confirm('Hapus pipeline run ini? Tindakan ini tidak dapat dibatalkan.')) return;
    try {
      await apiFetch(`/api/pipeline-runs/${encodeURIComponent(runId)}`, { method: 'DELETE' });
      setRuns((previous) => previous.filter((run) => run.id !== runId));
    } catch (caughtError) {
      console.error('Failed to delete pipeline run:', caughtError);
      setError('Pipeline run tidak dapat dihapus.');
    }
  };

  return (
    <div className="app-light-page font-outfit flex flex-col items-center pb-12">
      {/* Header Area */}
      <div className="w-full border-b border-gray-200 bg-white py-6">
        <div className="app-page-shell flex justify-between items-start">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
              <span className="bg-[#1a2130] text-white p-2 rounded-xl"><FiActivity size={24} /></span>
              Pipeline Runs History
            </h1>
            <p className="text-gray-500 mt-2">Manage your previous ILI alignment runs, view data, or initiate Fitness For Service (FFS).</p>
          </div>
          <div className="flex gap-4 items-center">
            <button 
              onClick={() => {
                localStorage.removeItem('synapse_alignment_wizard_progress');
                navigate('/alignment');
              }}
              className="px-4 py-2 bg-[#1a2130] hover:bg-black text-white rounded-xl text-sm font-semibold transition-colors shadow-sm"
            >
              + New Alignment Run
            </button>
            <button className="p-2 text-gray-400 hover:text-gray-900 bg-white border border-gray-200 rounded-full hover:bg-gray-50 transition-colors">
              <FiBell size={20} />
            </button>
            <button className="p-2 text-gray-400 hover:text-gray-900 bg-white border border-gray-200 rounded-full hover:bg-gray-50 transition-colors">
              <FiSettings size={20} />
            </button>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="app-page-shell mt-6 flex flex-col gap-5">
        {error && <p role="alert" className="mx-6 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
        
        {/* Table Container */}
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-[0_12px_30px_rgba(15,23,42,0.06)]">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100 text-xs uppercase tracking-wider text-gray-500">
                  <th className="px-6 py-4 font-bold">Pipeline Line Name</th>
                  <th className="px-6 py-4 font-bold">Upload Date</th>
                  <th className="px-6 py-4 font-bold">Match Rate</th>
                  <th className="px-6 py-4 font-bold">Status</th>
                  <th className="px-6 py-4 font-bold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-8 text-center text-gray-500">
                      Loading pipeline runs...
                    </td>
                  </tr>
                ) : runs.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-8 text-center text-gray-500">
                      No pipeline runs found. Upload a CSV to start an alignment.
                    </td>
                  </tr>
                ) : runs.map((run) => (
                  <tr key={run.id} className="hover:bg-blue-50/30 transition-colors group">
                    <td className="px-6 py-5">
                      <div className="font-bold text-gray-800 text-[15px]">{run.pipelineName}</div>
                      <div className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                        <FiEye size={12} /> {run.vendorLama} vs {run.vendorBaru}
                      </div>
                    </td>
                    <td className="px-6 py-5">
                      <div className="text-sm font-medium text-gray-700">
                        {run.date ? format(new Date(run.date), 'dd MMM yyyy') : '-'}
                      </div>
                      <div className="text-xs text-gray-400">Total Anomalies: {run.anomaliesFound}</div>
                    </td>
                    <td className="px-6 py-5">
                      <div className="inline-flex items-center justify-center px-3 py-1 rounded-full bg-blue-50 text-blue-700 font-bold text-sm">
                        {typeof run.matchRate === 'number' ? `${run.matchRate.toFixed(1)}%` : 'N/A'}
                      </div>
                    </td>
                    <td className="px-6 py-5">
                      {run.status === 'completed' ? (
                        <div className="flex items-center gap-1.5 text-emerald-600 bg-emerald-50 px-3 py-1 rounded-full text-sm font-medium w-fit">
                          <FiCheckCircle size={14} /> {run.status}
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 text-amber-600 bg-amber-50 px-3 py-1 rounded-full text-sm font-medium w-fit">
                          <FiClock size={14} /> {run.status}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-5 text-right">
                      <div className="flex justify-end gap-3 opacity-80 group-hover:opacity-100 transition-opacity">
                        
                        {/* Action: View Data */}
                        <button 
                          onClick={() => navigate(`/ili-comparison?sessionId=${run.id}`)}
                          className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 hover:text-gray-900 transition-colors"
                          title="View Alignment Data"
                        >
                          <FiEye /> View
                        </button>
                        
                        <button
                          onClick={() => navigate(`/ili-comparison?sessionId=${encodeURIComponent(run.id)}`)}
                          className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-blue-600 bg-blue-50 border border-blue-100 rounded-lg hover:bg-blue-100 transition-colors"
                          title="Open report"
                        >
                          <FiEye /> Report
                        </button>

                        {/* Action: FFS */}
                        <button 
                          onClick={() => navigate('/ffs')}
                          className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-gray-900 bg-[#cfff2e] rounded-lg hover:bg-[#bfee1a] shadow-sm transition-colors"
                          title="Fitness For Service"
                        >
                          ⚙️ FFS
                        </button>

                        {/* Action: Delete */}
                        <button 
                          onClick={() => void deleteRun(run.id)}
                          className="flex items-center justify-center p-2 text-red-500 bg-red-50 hover:bg-red-100 rounded-lg transition-colors"
                          title="Delete Run"
                        >
                          <FiTrash2 size={18} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          
          <div className="bg-white px-6 py-4 border-t border-gray-100 flex items-center justify-between">
            <span className="text-sm text-gray-500">Total <span className="font-medium text-gray-900">{runs.length}</span> pipeline run</span>
          </div>
        </div>
      </div>
    </div>
  );
}
