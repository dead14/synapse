import { lazy, Suspense } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';

import { useAuth } from './context/AuthContext';
import { ToastProvider } from './components/common/ToastProvider';
import AppLayout from './layout/AppLayout';

// Route-level splitting follows React's lazy/Suspense contract:
// https://react.dev/reference/react/lazy
const DashboardPage = lazy(() => import('./pages/Dashboard/DashboardPage'));
const InspectionRegistryPage = lazy(() => import('./pages/Inspections/InspectionRegistryPage'));
const AlignmentPage = lazy(() => import('./AlignmentPage'));
const PipelineRuns = lazy(() => import('./PipelineRuns'));
const IliComparisonPage = lazy(() => import('./IliComparisonPage'));
const IliSectioningPage = lazy(() => import('./sectioning/IliSectioningPage'));
const LoginPage = lazy(() => import('./pages/LoginPage'));
const RegisterPage = lazy(() => import('./pages/RegisterPage'));
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPasswordPage'));
const DesignSystemPage = lazy(() => import('./pages/DesignSystemPage'));
const SpoolPreviewPage = lazy(() => import('./pages/SpoolPreviewPage'));
const MasterAdminPage = lazy(() => import('./pages/MasterAdmin/MasterAdminPage'));
const CorrosionAnalysisPage = lazy(() => import('./pages/Corrosion/CorrosionAnalysisPage'));
const FfsSetupPage = lazy(() => import('./pages/FFS/FfsSetupPage'));
const FfsResultsPage = lazy(() => import('./pages/FFS/FfsResultsPage'));
const UserList = lazy(() => import('./pages/Users/UserList'));
const AddUser = lazy(() => import('./pages/Users/AddUser'));
const Roles = lazy(() => import('./pages/Users/Roles'));
const ActivityLogs = lazy(() => import('./pages/Users/ActivityLogs'));
const Organizations = lazy(() => import('./pages/Organizations/Organizations'));
const CapabilityWorkspacePage = lazy(() => import('./pages/Integrity/CapabilityWorkspacePage'));
const IntegrityTimelinePage = lazy(() => import('./pages/Integrity/IntegrityTimelinePage'));
const DecisionWorkbenchPage = lazy(() => import('./pages/Integrity/DecisionWorkbenchPage'));
const ComplianceRegisterPage = lazy(() => import('./pages/Integrity/ComplianceRegisterPage'));
const RepairEvidencePage = lazy(() => import('./pages/Integrity/RepairEvidencePage'));
const RiskWhatIfPage = lazy(() => import('./pages/Integrity/RiskWhatIfPage'));
const DirectAssessmentPage = lazy(() => import('./pages/Integrity/DirectAssessmentPage'));
const SubmissionAdditionalInfoPage = lazy(() => import('./pages/Submission/SubmissionAdditionalInfoPage'));
const PublicSharePage = lazy(() => import('./pages/PublicShare/PublicSharePage'));

function WorkspaceLoading({ label = 'Loading workspace' }: { label?: string }) {
  return (
    <main className="syn-app syn-page" aria-busy="true">
      <div className="syn-shell">
        <div className="syn-empty-compact" role="status">
          <span className="syn-skeleton" aria-hidden="true" />
          <strong>{label}</strong>
          <span>Checking the local session and preparing the decision workspace.</span>
        </div>
      </div>
    </main>
  );
}

function RequireAuth() {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) return <WorkspaceLoading label="Checking your session" />;

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}

// Keep in sync with the Administration group in layout/navigation.ts.
const ADMIN_ROLES = ['admin', 'super_admin'];
const MASTER_ADMIN_ROLES = ['super_admin'];

/** Route-level role enforcement: navigation only hides the links, so any
 * authenticated user could still deep-link into the admin workspaces. */
function RequireRole({ roles }: { roles: string[] }) {
  const { user, isLoading } = useAuth();

  if (isLoading) return <WorkspaceLoading label="Checking your session" />;

  if (!user || !roles.includes(user.role)) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}

function NotFoundPage() {
  return (
    <div className="syn-page">
      <div className="syn-shell">
        <section className="syn-panel syn-empty-compact" role="status">
          <p className="syn-kicker">404 · Route unavailable</p>
          <h1 className="syn-heading">This workspace does not exist.</h1>
          <a className="syn-action syn-action--ink" href="/">Return to portfolio</a>
        </section>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <Suspense fallback={<WorkspaceLoading />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<RegisterPage />} />
        <Route path="/reset-password" element={<ForgotPasswordPage />} />
        <Route path="/share/:id" element={<PublicSharePage />} />
        {/* Living design-system reference. Dev builds only — it is a style guide,
            not a product surface, and carries no session data. */}
        {import.meta.env.DEV && <Route path="/ds-preview" element={<DesignSystemPage />} />}
        {import.meta.env.DEV && <Route path="/spool-preview" element={<SpoolPreviewPage />} />}

        <Route element={<RequireAuth />}>
          <Route element={<AppLayout />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/data" element={<InspectionRegistryPage />} />
            <Route path="/runs" element={<InspectionRegistryPage />} />
            <Route path="/alignment-history" element={<PipelineRuns />} />
            <Route path="/alignment" element={<AlignmentPage />} />
            <Route path="/ili-comparison" element={<IliComparisonPage />} />
            <Route path="/ili-sectioning" element={<IliSectioningPage />} />
            <Route path="/alignment/:sessionId/corrosion" element={<CorrosionAnalysisPage />} />
            <Route path="/ffs" element={<FfsSetupPage />} />
            <Route path="/ffs/results" element={<FfsResultsPage />} />
            <Route path="/integrity/:capability" element={<CapabilityWorkspacePage />} />
            <Route path="/integrity-timeline" element={<IntegrityTimelinePage />} />
            <Route path="/integrity-workbench" element={<DecisionWorkbenchPage />} />
            <Route path="/compliance-indonesia" element={<ComplianceRegisterPage />} />
            <Route path="/repair-evidence" element={<RepairEvidencePage />} />
            <Route path="/pipeline-risk" element={<RiskWhatIfPage />} />
            <Route path="/direct-assessment" element={<DirectAssessmentPage />} />
            <Route path="/submission" element={<SubmissionAdditionalInfoPage />} />
            <Route element={<RequireRole roles={ADMIN_ROLES} />}>
              <Route path="/users" element={<UserList />} />
              <Route path="/users/add" element={<AddUser />} />
              <Route path="/roles" element={<Roles />} />
              <Route path="/activity-logs" element={<ActivityLogs />} />
              <Route path="/organizations" element={<Organizations />} />
            </Route>
            <Route element={<RequireRole roles={MASTER_ADMIN_ROLES} />}>
              <Route path="/master-admin" element={<MasterAdminPage />} />
            </Route>
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Route>
      </Routes>
      </Suspense>
    </ToastProvider>
  );
}
