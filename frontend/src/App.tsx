import { lazy, Suspense, useEffect, useState } from 'react';
import { Navigate, Outlet, Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import { FiActivity, FiAlertTriangle, FiArrowUpRight, FiCheckCircle, FiClock, FiPlus } from 'react-icons/fi';
import AppLayout from './layout/AppLayout';
import { apiFetch } from './utils/api';
import { useAuth } from './context/AuthContext';

const AlignmentPage = lazy(() => import('./AlignmentPage'));
const PipelineRuns = lazy(() => import('./PipelineRuns'));
const IliComparisonPage = lazy(() => import('./IliComparisonPage'));
const IliSectioningPage = lazy(() => import('./sectioning/IliSectioningPage'));
const LoginPage = lazy(() => import('./pages/LoginPage'));
const RegisterPage = lazy(() => import('./pages/RegisterPage'));
const FfsSetupPage = lazy(() => import('./pages/FFS/FfsSetupPage'));
const FfsResultsPage = lazy(() => import('./pages/FFS/FfsResultsPage'));
const UserList = lazy(() => import('./pages/Users/UserList'));
const AddUser = lazy(() => import('./pages/Users/AddUser'));
const Roles = lazy(() => import('./pages/Users/Roles'));
const ActivityLogs = lazy(() => import('./pages/Users/ActivityLogs'));
const Organizations = lazy(() => import('./pages/Organizations/Organizations'));

type DashboardStats = {
  kpi: {
    totalIliRuns: number;
    averageMatchRate: number | string;
    unmatchedFeatures: number;
    averageConfidence: number | string;
  };
  recentJobs: Array<{
    id: number | string;
    pipeline: string;
    status: string;
    matchRate: number | string;
    date: string;
  }>;
};

const emptyStats: DashboardStats = {
  kpi: { totalIliRuns: 0, averageMatchRate: 0, unmatchedFeatures: 0, averageConfidence: 0 },
  recentJobs: [],
};

function RequireAuth() {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return <main className="min-h-screen p-8 text-sm text-gray-600">Memeriksa sesi login...</main>;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}

function Dashboard() {
  const navigate = useNavigate();
  const [stats, setStats] = useState<DashboardStats>(emptyStats);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        setStats(await apiFetch<DashboardStats>('/api/dashboard/stats', { signal: controller.signal }));
      } catch (caughtError) {
        if ((caughtError as Error).name !== 'AbortError') setError('Dashboard tidak dapat dimuat.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, []);

  const cards = [
    { label: 'Total ILI Runs', value: stats.kpi.totalIliRuns, icon: FiActivity },
    { label: 'Match Rate', value: `${Number(stats.kpi.averageMatchRate || 0).toFixed(1)}%`, icon: FiCheckCircle },
    { label: 'Unmatched Features', value: stats.kpi.unmatchedFeatures, icon: FiAlertTriangle },
    { label: 'Average Confidence', value: `${Number(stats.kpi.averageConfidence || 0).toFixed(1)}%`, icon: FiClock },
  ];

  return (
    <main className="p-4 md:p-6 xl:p-8 bg-[#f8f9fc] min-h-screen">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Portfolio Overview</h1>
          <p className="mt-1 text-sm text-gray-500">Ringkasan alignment untuk organisasi Anda.</p>
        </div>
        <div className="flex gap-3">
          <button onClick={() => navigate('/alignment')} className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
            <FiPlus /> Mulai alignment
          </button>
          <button onClick={() => navigate('/runs')} className="inline-flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600">
            Lihat run <FiArrowUpRight />
          </button>
        </div>
      </div>

      {error && <p role="alert" className="mb-5 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4 mb-6">
        {cards.map(({ label, value, icon: Icon }) => (
          <div key={label} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <Icon className="mb-4 size-6 text-brand-500" />
            <p className="text-sm text-gray-500">{label}</p>
            <p className="mt-1 text-2xl font-bold text-gray-900">{loading ? '—' : value}</p>
          </div>
        ))}
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <h2 className="font-semibold text-gray-900">Recent Alignment Runs</h2>
          <button onClick={() => navigate('/runs')} className="text-sm font-medium text-brand-600 hover:text-brand-700">Lihat semua</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr><th className="px-5 py-3">Pipeline</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Match rate</th><th className="px-5 py-3">Tanggal</th></tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {!loading && stats.recentJobs.length === 0 ? (
                <tr><td colSpan={4} className="px-5 py-8 text-center text-gray-500">Belum ada alignment run.</td></tr>
              ) : stats.recentJobs.map((job) => (
                <tr key={job.id} className="hover:bg-gray-50">
                  <td className="px-5 py-4 font-medium text-gray-800">{job.pipeline}</td>
                  <td className="px-5 py-4 capitalize text-gray-600">{job.status}</td>
                  <td className="px-5 py-4 text-gray-600">{Number(job.matchRate || 0).toFixed(1)}%</td>
                  <td className="px-5 py-4 text-gray-600">{job.date}</td>
                </tr>
              ))}
              {loading && <tr><td colSpan={4} className="px-5 py-8 text-center text-gray-500">Memuat dashboard...</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

export default function App() {
  return (
    <Suspense fallback={<main className="min-h-screen p-8 text-sm text-gray-600">Memuat halaman...</main>}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<RegisterPage />} />
        <Route element={<RequireAuth />}>
          <Route element={<AppLayout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/data" element={<PipelineRuns />} />
          <Route path="/runs" element={<PipelineRuns />} />
          <Route path="/alignment" element={<AlignmentPage />} />
          <Route path="/ili-comparison" element={<IliComparisonPage />} />
          <Route path="/ili-sectioning" element={<IliSectioningPage />} />
          <Route path="/ffs" element={<FfsSetupPage />} />
          <Route path="/ffs/results" element={<FfsResultsPage />} />
          <Route path="/users" element={<UserList />} />
          <Route path="/users/add" element={<AddUser />} />
          <Route path="/roles" element={<Roles />} />
          <Route path="/activity-logs" element={<ActivityLogs />} />
          <Route path="/organizations" element={<Organizations />} />
          <Route path="*" element={<div className="p-8 text-gray-700">Halaman tidak ditemukan.</div>} />
          </Route>
        </Route>
      </Routes>
    </Suspense>
  );
}
