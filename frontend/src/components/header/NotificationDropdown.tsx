import { useCallback, useState } from 'react';
import { FiBell, FiInbox, FiX } from 'react-icons/fi';

import { Dropdown } from '../ui/dropdown/Dropdown';

export default function NotificationDropdown() {
  const [isOpen, setIsOpen] = useState(false);
  const close = useCallback(() => setIsOpen(false), []);

  return (
    <div className="relative">
      <button
        type="button"
        className="syn-icon-button dropdown-toggle"
        onClick={() => setIsOpen((open) => !open)}
        aria-label="Open notifications"
        aria-expanded={isOpen}
        aria-controls="notification-panel"
      >
        <FiBell aria-hidden="true" />
      </button>

      <Dropdown isOpen={isOpen} onClose={close} className="syn-popover">
        <section id="notification-panel" aria-labelledby="notification-title">
          <header className="syn-popover__header">
            <div>
              <p className="syn-kicker">Activity center</p>
              <h2 id="notification-title">Notifications</h2>
            </div>
            <button type="button" className="syn-icon-button" onClick={close} aria-label="Close notifications">
              <FiX aria-hidden="true" />
            </button>
          </header>
          <div className="syn-empty-compact" role="status">
            <span className="syn-empty-compact__icon"><FiInbox aria-hidden="true" /></span>
            <strong>No measured events</strong>
            <p>Workflow alerts will appear after approval and repair-event APIs are connected.</p>
          </div>
        </section>
      </Dropdown>
    </div>
  );
}
