import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FiActivity,
  FiBarChart2,
  FiChevronDown,
  FiDatabase,
  FiGrid,
  FiLayers,
  FiMoreHorizontal,
  FiShield,
  FiUsers,
} from 'react-icons/fi';
import { Link, useLocation } from 'react-router-dom';

import { useAuth } from '../context/AuthContext';
import { useSidebar } from '../context/SidebarContext';
import { navigationForRole } from './navigation';

const groupIcons = {
  Portfolio: FiGrid,
  'Data & alignment': FiDatabase,
  Assessment: FiBarChart2,
  Administration: FiUsers,
} as const;

export default function AppSidebar() {
  const { user } = useAuth();
  const { isExpanded, isHovered, isMobileOpen, setIsHovered, toggleMobileSidebar } = useSidebar();
  const location = useLocation();
  const groups = useMemo(() => navigationForRole(user?.role), [user?.role]);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const submenuRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [submenuHeights, setSubmenuHeights] = useState<Record<string, number>>({});
  const showsText = isExpanded || isHovered || isMobileOpen;

  const pathIsActive = useCallback((path: string) => {
    if (path === '/') return location.pathname === '/';
    if (path === '/ffs') return location.pathname === '/ffs' || location.pathname.startsWith('/ffs/');
    return location.pathname === path;
  }, [location.pathname]);

  useEffect(() => {
    const active = groups.find((group) => group.items.some((item) => pathIsActive(item.path)));
    setOpenGroup(active && active.items.length > 1 ? active.label : null);
  }, [groups, pathIsActive]);

  useEffect(() => {
    if (!openGroup) return;
    const element = submenuRefs.current[openGroup];
    setSubmenuHeights((current) => ({ ...current, [openGroup]: element?.scrollHeight ?? 0 }));
  }, [openGroup, showsText]);

  const closeMobile = () => {
    if (isMobileOpen) toggleMobileSidebar();
  };

  return (
    <aside
      className={`fixed left-0 top-0 z-50 mt-16 flex h-screen flex-col border-r border-gray-200 bg-white px-5 text-gray-900 transition-all duration-300 ease-in-out dark:border-gray-800 dark:bg-gray-900 lg:mt-0 ${
        isExpanded || isMobileOpen || isHovered ? 'w-[290px]' : 'w-[90px]'
      } ${isMobileOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0`}
      onMouseEnter={() => !isExpanded && setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className={`flex py-8 ${showsText ? 'justify-start' : 'lg:justify-center'}`}>
        <Link to="/" onClick={closeMobile} className="flex items-center gap-3" aria-label="Synapse dashboard">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-500 text-lg font-bold text-white shadow-theme-xs">S</span>
          {showsText && (
            <span className="leading-none">
              <strong className="block text-xl font-semibold tracking-tight text-gray-900 dark:text-white">Synapse</strong>
              <small className="mt-1.5 block text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Pipeline Integrity</small>
            </span>
          )}
        </Link>
      </div>

      <div className="no-scrollbar flex flex-col overflow-y-auto pb-24">
        <nav className="mb-6" aria-label="Primary navigation">
          <h2 className={`mb-4 flex text-xs uppercase leading-5 text-gray-400 ${showsText ? 'justify-start' : 'lg:justify-center'}`}>
            {showsText ? 'Menu' : <FiMoreHorizontal className="size-6" />}
          </h2>
          <ul className="flex flex-col gap-2">
            {groups.map((group) => {
              const Icon = groupIcons[group.label as keyof typeof groupIcons] ?? FiLayers;
              const active = group.items.some((item) => pathIsActive(item.path));
              const open = openGroup === group.label;
              const singleItem = group.items.length === 1 ? group.items[0] : null;

              return (
                <li key={group.label}>
                  {singleItem ? (
                    <Link
                      to={singleItem.path}
                      onClick={closeMobile}
                      className={`menu-item group ${active ? 'menu-item-active' : 'menu-item-inactive'} ${!showsText ? 'lg:justify-center' : ''}`}
                      title={!showsText ? singleItem.label : undefined}
                    >
                      <Icon className={`size-5 ${active ? 'menu-item-icon-active' : 'menu-item-icon-inactive'}`} />
                      {showsText && <span>{singleItem.label}</span>}
                    </Link>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setOpenGroup(open ? null : group.label)}
                      className={`menu-item group ${active || open ? 'menu-item-active' : 'menu-item-inactive'} ${!showsText ? 'lg:justify-center' : ''}`}
                      aria-expanded={open}
                      title={!showsText ? group.label : undefined}
                    >
                      <Icon className={`size-5 ${active || open ? 'menu-item-icon-active' : 'menu-item-icon-inactive'}`} />
                      {showsText && <span>{group.label}</span>}
                      {showsText && <FiChevronDown className={`ml-auto size-5 transition-transform ${open ? 'rotate-180' : ''}`} />}
                    </button>
                  )}

                  {!singleItem && showsText && (
                    <div
                      ref={(element) => { submenuRefs.current[group.label] = element; }}
                      className="overflow-hidden transition-[height] duration-300"
                      style={{ height: open ? `${submenuHeights[group.label] ?? 0}px` : 0 }}
                    >
                      <ul className="ml-9 mt-2 space-y-1">
                        {group.items.map((item) => (
                          <li key={item.path}>
                            <Link
                              to={item.path}
                              onClick={closeMobile}
                              className={`menu-dropdown-item ${pathIsActive(item.path) ? 'menu-dropdown-item-active' : 'menu-dropdown-item-inactive'}`}
                            >
                              <span>{item.label}</span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </nav>

        {showsText && (
          <div className="mt-auto rounded-2xl bg-gray-50 p-4 dark:bg-white/[0.03]">
            <div className="mb-3 flex items-center gap-2 text-brand-500">
              <FiShield className="size-5" />
              <strong className="text-sm">Engineering workspace</strong>
            </div>
            <p className="text-xs leading-5 text-gray-500 dark:text-gray-400">
              Evidence-backed pipeline integrity analysis and decision support.
            </p>
            <div className="mt-3 flex items-center gap-2 text-xs font-medium text-success-700 dark:text-success-400">
              <FiActivity className="size-4" /> System connected
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
