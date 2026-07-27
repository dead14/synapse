import { Outlet, useLocation } from 'react-router-dom';

import ErrorBoundary from '../components/common/ErrorBoundary';
import AppHeader from './AppHeader';

function LayoutContent() {
  const location = useLocation();

  return (
    <div className="syn-app engine-app">
      <a href="#main-content" className="syn-action syn-action--signal syn-skip-link">
        Skip to main content
      </a>
      <div className="min-w-0 flex-1">
        <AppHeader />
        <main
          id="main-content"
          tabIndex={-1}
          className="engine-main"
        >
          {/* Keyed by path so the boundary clears when the operator navigates
              away, and so a failed workspace never blanks the header they
              would use to leave it. */}
          <ErrorBoundary key={location.pathname} scope="This workspace">
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}

export default function AppLayout() {
  return (
    <LayoutContent />
  );
}
