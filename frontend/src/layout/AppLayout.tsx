import { Outlet } from 'react-router-dom';

import AppHeader from './AppHeader';

function LayoutContent() {
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
          <Outlet />
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
