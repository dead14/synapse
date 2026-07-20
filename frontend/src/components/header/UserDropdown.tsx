import { useCallback, useMemo, useState } from 'react';
import { FiChevronDown, FiLogOut, FiShield } from 'react-icons/fi';
import { useNavigate } from 'react-router-dom';

import { useAuth } from '../../context/AuthContext';
import { Dropdown } from '../ui/dropdown/Dropdown';

export default function UserDropdown() {
  const [isOpen, setIsOpen] = useState(false);
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const close = useCallback(() => setIsOpen(false), []);
  const initials = useMemo(() => {
    const source = user?.username?.trim() || 'User';
    return source.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('');
  }, [user?.username]);

  const signOut = () => {
    close();
    logout();
    navigate('/login');
  };

  return (
    <div className="relative">
      <button
        type="button"
        className="syn-user-trigger dropdown-toggle"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        aria-controls="user-menu"
        aria-label="Open account menu"
      >
        <span className="syn-user-trigger__avatar" aria-hidden="true">{initials}</span>
        <span className="syn-user-trigger__copy">
          <strong>{user?.username || 'User'}</strong>
          <small>{user?.role || 'member'}</small>
        </span>
        <FiChevronDown aria-hidden="true" />
      </button>

      <Dropdown isOpen={isOpen} onClose={close} className="syn-popover syn-popover--account">
        <section id="user-menu" aria-label="Account information">
          <div className="syn-account-card">
            <span className="syn-user-trigger__avatar syn-user-trigger__avatar--large" aria-hidden="true">{initials}</span>
            <div>
              <strong>{user?.username || 'User'}</strong>
              <p>{user?.email || 'No email available'}</p>
            </div>
          </div>
          <dl className="syn-account-meta">
            <div><dt><FiShield aria-hidden="true" /> Role</dt><dd>{user?.role || 'member'}</dd></div>
            <div><dt>Organization</dt><dd>{user?.orgName || 'Not assigned'}</dd></div>
          </dl>
          <button type="button" className="syn-account-signout" onClick={signOut}>
            <FiLogOut aria-hidden="true" /> Sign out
          </button>
        </section>
      </Dropdown>
    </div>
  );
}
