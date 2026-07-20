import { useEffect, useMemo, useRef, useState } from 'react';
import { FiChevronDown, FiCommand, FiHexagon, FiMoreHorizontal, FiSearch } from 'react-icons/fi';
import { Link, NavLink, useLocation } from 'react-router-dom';

import { ThemeToggleButton } from '../components/common/ThemeToggleButton';
import NotificationDropdown from '../components/header/NotificationDropdown';
import UserDropdown from '../components/header/UserDropdown';
import { useAuth } from '../context/AuthContext';
import { navigationForRole } from './navigation';

export default function AppHeader() {
  const { user } = useAuth();
  const location = useLocation();
  const [applicationMenuOpen, setApplicationMenuOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const topNavGroups = useMemo(() => navigationForRole(user?.role), [user?.role]);

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

  const pathIsActive = (path: string) => {
    if (path === '/') return location.pathname === '/';
    if (path === '/ffs') return location.pathname === '/ffs' || location.pathname.startsWith('/ffs/');
    return location.pathname === path;
  };

  const groupIsActive = (items: { path: string }[]) => items.some((item) => pathIsActive(item.path));
  const activeItem = topNavGroups.flatMap((group) => group.items).find((item) => pathIsActive(item.path));

  return (
    <header className="engine-header">
      <div className="engine-header__bar">
        <div className="engine-header__primary">
          <Link to="/" className="engine-brand" aria-label="Synapse dashboard">
            <span className="engine-brand__mark">
              <FiHexagon aria-hidden="true" />
              <span>S</span>
            </span>
            <span className="engine-brand__copy">
              <strong>Synapse</strong>
              <small>Integrity OS</small>
            </span>
          </Link>

          <button
            type="button"
            onClick={() => setApplicationMenuOpen((open) => !open)}
            className="engine-icon-button engine-menu-toggle"
            aria-label="Toggle application menu"
            aria-expanded={applicationMenuOpen}
          >
            <FiMoreHorizontal aria-hidden="true" />
          </button>

          <nav className="engine-nav" aria-label="Workspace navigation">
            {topNavGroups.map((group) => {
              const active = groupIsActive(group.items);
              const singleItem = group.items.length === 1 ? group.items[0] : null;
              const triggerClass = `engine-nav__trigger${active ? ' is-active' : ''}`;

              if (singleItem) {
                return (
                  <NavLink key={group.label} to={singleItem.path} title={singleItem.description} className={triggerClass}>
                    {singleItem.label}
                  </NavLink>
                );
              }

              return (
                <div key={group.label} className="engine-nav__group">
                  <button type="button" className={triggerClass} aria-haspopup="menu">
                    <span>{group.label}</span>
                    <FiChevronDown aria-hidden="true" />
                  </button>
                  <div className="engine-nav__menu">
                    <p>{group.label} / modules</p>
                    <div role="menu">
                      {group.items.map((item) => (
                        <NavLink
                          key={item.path}
                          to={item.path}
                          title={item.description}
                          role="menuitem"
                          className={() => `engine-nav__item${pathIsActive(item.path) ? ' is-active' : ''}`}
                        >
                          <span>{item.label}</span>
                          <small>{item.description}</small>
                        </NavLink>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </nav>
        </div>

        <div className="engine-header__context" aria-label="Current workspace">
          <span>workspace</span>
          <strong>{activeItem?.label ?? 'Overview'}</strong>
          <span className="engine-status"><i /> operational</span>
        </div>

        <div className={`engine-header__actions${applicationMenuOpen ? ' is-open' : ''}`}>
          {applicationMenuOpen && (
            <nav className="engine-mobile-nav" aria-label="Mobile workspace navigation">
              {topNavGroups.map((group) => (
                <div key={group.label}>
                  <p>{group.label}</p>
                  <div>
                    {group.items.map((item) => (
                      <NavLink
                        key={item.path}
                        to={item.path}
                        onClick={() => setApplicationMenuOpen(false)}
                        className={() => pathIsActive(item.path) ? 'is-active' : ''}
                      >
                        {item.label}
                      </NavLink>
                    ))}
                  </div>
                </div>
              ))}
            </nav>
          )}
          <label className="engine-command">
            <span className="sr-only">Search workspace</span>
            <FiSearch aria-hidden="true" />
            <input ref={searchRef} type="search" placeholder="Search" />
            <kbd><FiCommand aria-hidden="true" /> K</kbd>
          </label>
          <div className="engine-header__utilities">
            <ThemeToggleButton />
            <NotificationDropdown />
          </div>
          <UserDropdown />
        </div>
      </div>
    </header>
  );
}
