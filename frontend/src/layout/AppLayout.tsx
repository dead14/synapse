import { Outlet } from 'react-router-dom';

import { SidebarProvider, useSidebar } from '../context/SidebarContext';
import AppHeader from './AppHeader';
import AppSidebar from './AppSidebar';
import Backdrop from './Backdrop';

function LayoutContent() {
  const { isExpanded, isHovered, isMobileOpen } = useSidebar();

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 xl:flex">
      <a href="#main-content" className="syn-action syn-action--signal syn-skip-link">
        Skip to main content
      </a>
      <AppSidebar />
      <Backdrop />
      <div
        className={`min-w-0 flex-1 transition-[margin] duration-300 ease-in-out ${
          isExpanded || isHovered ? 'lg:ml-[290px]' : 'lg:ml-[90px]'
        } ${isMobileOpen ? 'ml-0' : ''}`}
      >
        <AppHeader />
        <main
          id="main-content"
          tabIndex={-1}
          className="mx-auto min-h-[calc(100vh-73px)] max-w-(--breakpoint-2xl)"
        >
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export default function AppLayout() {
  return (
    <SidebarProvider>
      <LayoutContent />
    </SidebarProvider>
  );
}
