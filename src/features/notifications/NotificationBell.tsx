// WS-I-3 STEP I3-06 — the bell button in the header, with a badge counting
// WARNING/CRITICAL visible items, and the dropdown panel.

import { useEffect, useRef, useState } from 'react';

import './notifications.css';
import type { AppView } from '../../app/AppShell';
import { useNotifications } from './NotificationsContext';
import { NotificationPanel } from './NotificationPanel';

export function NotificationBell({ setView }: { setView: (v: AppView) => void }) {
  const { visible } = useNotifications();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const badgeCount = visible.filter((item) => item.severity === 'WARNING' || item.severity === 'CRITICAL').length;

  useEffect(() => {
    if (!open) return;
    function handleClick(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <div className="sk-notification-bell-root" ref={rootRef} style={{ position: 'relative' }}>
      <button
        type="button"
        className="sk-shell__icon-button sk-notification-bell-btn"
        data-testid="notification-bell"
        aria-label="Notifications"
        style={{ position: 'relative' }}
        onClick={() => setOpen((v) => !v)}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {badgeCount > 0 ? (
          <span className="sk-notification-badge" data-testid="notification-badge">
            {badgeCount}
          </span>
        ) : null}
      </button>
      {open ? <NotificationPanel setView={setView} onClose={() => setOpen(false)} /> : null}
    </div>
  );
}
