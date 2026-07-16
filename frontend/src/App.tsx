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
    { label: 'Total ILI Runs', value: stats.kpi.totalIliRuns, icon: FiActivity, tone: 'bg-brand-50 text-brand-600' },
    { label: 'Match Rate', value: `${Number(stats.kpi.averageMatchRate || 0).toFixed(1)}%`, icon: FiCheckCircle, tone: 'bg-emerald-50 text-emerald-600' },
    { label: 'Unmatched Features', value: stats.kpi.unmatchedFeatures, icon: FiAlertTriangle, tone: 'bg-amber-50 text-amber-600' },
    { label: 'Average Confidence', value: `${Number(stats.kpi.averageConfidence || 0).toFixed(1)}%`, icon: FiClock, tone: 'bg-violet-50 text-violet-600' },
  ];

  return (
    <main className="app-light-page font-outfit py-6 md:py-8">
      <div className="app-page-shell">
      <div className="mb-6 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.16em] text-brand-600">Alignment operations</p>
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">Portfolio overview</h1>
          <p className="mt-2 text-sm text-gray-500">Ringkasan inspection alignment dan kualitas data organisasi Anda.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button onClick={() => navigate('/alignment')} className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 shadow-sm transition-colors hover:bg-gray-50">
            <FiPlus /> Mulai alignment
          </button>
          <button onClick={() => navigate('/runs')} className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-brand-500/20 transition-colors hover:bg-brand-700">
            Lihat run <FiArrowUpRight />
          </button>
        </div>
      </div>

      {error && <p role="alert" className="mb-5 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(({ label, value, icon: Icon, tone }) => (
          <div key={label} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-[0_12px_30px_rgba(15,23,42,0.06)]">
            <div className="mb-7 flex items-start justify-between">
              <span className={`inline-flex size-10 items-center justify-center rounded-xl ${tone}`}><Icon className="size-5" /></span>
              <span className="rounded-full bg-gray-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">Current</span>
            </div>
            <p className="text-sm text-gray-500">{label}</p>
            <p className="mt-1 text-2xl font-bold text-gray-900">{loading ? '—' : value}</p>
          </div>
        ))}
      </section>

      <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-[0_12px_30px_rgba(15,23,42,0.06)]">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 sm:px-6">
          <div>
            <h2 className="font-semibold text-gray-900">Recent alignment runs</h2>
            <p className="mt-0.5 text-xs text-gray-500">Run terbaru dan status quality check-nya.</p>
          </div>
          <button onClick={() => navigate('/runs')} className="rounded-lg px-2 py-1 text-sm font-semibold text-brand-600 transition-colors hover:bg-brand-50 hover:text-brand-700">Lihat semua</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr><th className="px-5 py-3">Pipeline</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Match rate</th><th className="px-5 py-3">Tanggal</th></tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {!loading && stats.recentJobs.length === 0 ? (
                <tr><td colSpan={4} className="px-5 py-12 text-center text-gray-500"><div className="mx-auto flex max-w-sm flex-col items-center"><span className="mb-3 inline-flex size-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600"><FiActivity /></span><strong className="text-sm text-gray-800">Belum ada alignment run</strong><span className="mt-1 text-xs">Mulai alignment pertama untuk melihat ringkasan kualitas pipeline di sini.</span></div></td></tr>
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
      </div>
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
