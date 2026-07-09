import { useState, useEffect } from 'react';
import { FiActivity } from 'react-icons/fi';
import PageMeta from '../../components/common/PageMeta';
import { formatDistanceToNow } from 'date-fns';

interface LogEntry {
  id: number;
  user: string;
  action: string;
  target: string;
  timestamp: string;
  ip: string;
}

export default function ActivityLogs() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchLogs = async () => {
      try {
        const token = localStorage.getItem('synapse_token');
        const res = await fetch('http://localhost:8000/api/activity-logs', {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.ok) {
          const data = await res.json();
          setLogs(data);
        }
      } catch (err) {
        console.error('Failed to fetch logs:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchLogs();
  }, []);

  return (
    <>
      <PageMeta title="Activity Logs | Synapse PIMS" description="System audit trails" />
      <div className="p-4 md:p-6 2xl:p-10 bg-[#f8f9fc] min-h-screen">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-8">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 tracking-tight flex items-center gap-2">
              <div className="w-10 h-10 rounded-xl bg-gray-100 text-gray-600 flex items-center justify-center mr-2">
                <FiActivity size={20} />
              </div>
              Activity Logs
            </h2>
            <p className="text-sm text-gray-500 mt-2">Security audit trail of user actions across the system.</p>
          </div>
        </div>

        <div className="bg-white rounded-3xl border border-gray-100 shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50/50 border-b border-gray-100">
                  <th className="px-6 py-4 font-semibold text-gray-500 text-xs uppercase tracking-wider">User</th>
                  <th className="px-6 py-4 font-semibold text-gray-500 text-xs uppercase tracking-wider">Action</th>
                  <th className="px-6 py-4 font-semibold text-gray-500 text-xs uppercase tracking-wider">Time</th>
                  <th className="px-6 py-4 font-semibold text-gray-500 text-xs uppercase tracking-wider">IP Address</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading ? (
                  <tr>
                    <td colSpan={4} className="px-6 py-4 text-center text-gray-500">Loading activity logs...</td>
                  </tr>
                ) : logs.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-6 py-4 text-center text-gray-500">No recent activity.</td>
                  </tr>
                ) : logs.map((log) => (
                  <tr key={log.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-6 py-4 font-semibold text-gray-800 text-sm">{log.user || 'System'}</td>
                    <td className="px-6 py-4 text-sm text-gray-600">
                      {log.action} <span className="font-medium text-gray-800">{log.target}</span>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      {formatDistanceToNow(new Date(log.timestamp), { addSuffix: true })}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-400 font-mono">{log.ip || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
