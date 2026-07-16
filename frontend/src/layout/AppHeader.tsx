import { useEffect, useRef, useState } from 'react';
import { FiMenu, FiMoreHorizontal, FiSearch, FiX } from 'react-icons/fi';
import { Link } from 'react-router-dom';

import { ThemeToggleButton } from '../components/common/ThemeToggleButton';
import NotificationDropdown from '../components/header/NotificationDropdown';
import UserDropdown from '../components/header/UserDropdown';
import { useSidebar } from '../context/SidebarContext';

export default function AppHeader() {
  const { isMobileOpen, toggleMobileSidebar, toggleSidebar } = useSidebar();
  const [applicationMenuOpen, setApplicationMenuOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener('keydown', focusSearch);
    return () => document.removeEventListener('keydown', focusSearch);
  }, []);

  const toggleNavigation = () => {
    if (window.innerWidth >= 1024) toggleSidebar();
    else toggleMobileSidebar();
  };

  return (
    <header className="sticky top-0 z-99999 flex w-full border-b border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
      <div className="flex grow flex-col items-center justify-between lg:flex-row lg:px-6">
        <div className="flex w-full items-center justify-between gap-2 border-b border-gray-200 px-3 py-3 dark:border-gray-800 sm:gap-4 lg:justify-normal lg:border-b-0 lg:px-0 lg:py-4">
          <button
            type="button"
            className="z-99999 flex h-10 w-10 items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 lg:h-11 lg:w-11"
            onClick={toggleNavigation}
            aria-label="Toggle sidebar"
          >
            {isMobileOpen ? <FiX className="size-5" /> : <FiMenu className="size-5" />}
          </button>

          <Link to="/" className="flex items-center gap-2 lg:hidden" aria-label="Synapse dashboard">
            <span className="grid size-9 place-items-center rounded-lg bg-brand-500 text-base font-bold text-white">S</span>
            <span className="text-lg font-semibold text-gray-900 dark:text-white">Synapse</span>
          </Link>

          <button
            type="button"
            onClick={() => setApplicationMenuOpen((open) => !open)}
            className="z-99999 flex h-10 w-10 items-center justify-center rounded-lg text-gray-700 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800 lg:hidden"
            aria-label="Toggle application menu"
            aria-expanded={applicationMenuOpen}
          >
            <FiMoreHorizontal className="size-5" />
          </button>

          <label className="relative hidden lg:block">
            <span className="sr-only">Search workspace</span>
            <FiSearch className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-gray-500" />
            <input
              ref={searchRef}
              type="search"
              placeholder="Search workspace..."
              className="h-11 w-[360px] rounded-lg border border-gray-200 bg-transparent py-2.5 pl-12 pr-16 text-sm text-gray-800 shadow-theme-xs outline-none placeholder:text-gray-400 focus:border-brand-300 focus:ring-3 focus:ring-brand-500/10 dark:border-gray-800 dark:bg-white/[0.03] dark:text-white/90 xl:w-[430px]"
            />
            <kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-500 dark:border-gray-800 dark:bg-white/[0.03] dark:text-gray-400">
              Ctrl K
            </kbd>
          </label>
        </div>

        <div className={`${applicationMenuOpen ? 'flex' : 'hidden'} w-full items-center justify-between gap-4 px-5 py-4 shadow-theme-md lg:flex lg:w-auto lg:justify-end lg:px-0 lg:py-0 lg:shadow-none`}>
          <div className="flex items-center gap-2">
            <ThemeToggleButton />
            <NotificationDropdown />
          </div>
          <UserDropdown />
        </div>
      </div>
    </header>
  );
}
