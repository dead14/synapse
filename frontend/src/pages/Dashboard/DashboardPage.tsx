import { useEffect, useState } from 'react';
import { FiAlertTriangle, FiRefreshCw } from 'react-icons/fi';

import PageMeta from '../../components/common/PageMeta';
import { useAuth } from '../../context/AuthContext';
import { emptyDashboardStats, normalizeDashboardStats, type DashboardStats } from '../../domain/dashboard';
import { apiFetch } from '../../utils/api';
import DashboardFindings from './DashboardFindings';
import DashboardHeader from './DashboardHeader';
import DashboardInsights from './DashboardInsights';
import './dashboard-overview.css';

export default function DashboardPage() {
  const { user } = useAuth();
  const [stats, setStats] = useState<DashboardStats>(() => emptyDashboardStats());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    void apiFetch<unknown>('/api/dashboard/stats', { signal: controller.signal })
      .then((payload) => setStats(normalizeDashboardStats(payload)))
      .catch((caughtError: Error) => {
        if (caughtError.name !== 'AbortError') {
          setError('Dashboard evidence could not be loaded. Check your organization access and try again.');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [refreshKey]);

  const refresh = () => setRefreshKey((current) => current + 1);

  return (
    <div className="syn-page integrity-overview">
      <PageMeta title="Integrity Dashboard · Synapse" description="Measured pipeline integrity overview" />
      <div className="syn-shell integrity-overview__shell">
        <DashboardHeader stats={stats} loading={loading} onRefresh={refresh} />

        {error && (
          <div className="syn-alert syn-alert--danger integrity-overview__alert" role="alert">
            <div><FiAlertTriangle aria-hidden="true" /><span>{error}</span></div>
            <button type="button" className="syn-action syn-action--outline" onClick={refresh}>
              <FiRefreshCw aria-hidden="true" /> Retry
            </button>
          </div>
        )}

        <DashboardInsights overview={stats.overview} loading={loading} />
        <DashboardFindings stats={stats} loading={loading} user={user} />
      </div>
    </div>
  );
}
