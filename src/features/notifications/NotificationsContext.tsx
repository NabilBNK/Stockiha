// WS-I-3 STEP I3-06 — the Notifications centre: merges the read-only
// `reports.get_notifications` items with the existing licence banner items
// (WS-K-7) into one dismissible-per-day list, polled every 5 minutes.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { useSession } from '../../shared/session/SessionContext';
import { useLicence } from '../../shared/licence/LicenceContext';
import { getReportNotifications } from '../../shared/ipc/reportsGateway';
import type { NotificationKind, ReportNotificationItem } from '../../shared/ipc/reportsDto';
import { todayLocal } from '../reports/common/periods';

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const DISMISSED_KEY_PREFIX = 'stockiha.notifications.dismissed.';

// The three licence-derived ids (WS-K-7) are not `reports.get_notifications`
// kinds — they never touch SQL — so the panel's id space is a superset of
// the DTO's `NotificationKind`.
export type LicenceNotificationKind = 'LICENCE_GRACE' | 'LICENCE_EXPIRING' | 'LICENCE_READ_ONLY';
export type AnyNotificationId = NotificationKind | LicenceNotificationKind;

export type NotificationItem = Omit<ReportNotificationItem, 'id' | 'kind'> & {
  id: AnyNotificationId;
  kind: AnyNotificationId;
};

interface NotificationsContextValue {
  items: NotificationItem[];
  visible: NotificationItem[];
  dismiss: (id: string) => void;
  refresh: () => Promise<void>;
}

const NotificationsContext = createContext<NotificationsContextValue>({
  items: [],
  visible: [],
  dismiss: () => {},
  refresh: async () => {},
});

function dismissedKeyForToday(): string {
  return `${DISMISSED_KEY_PREFIX}${todayLocal()}`;
}

function readDismissed(): string[] {
  try {
    const raw = window.localStorage.getItem(dismissedKeyForToday());
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function pruneStaleDismissedKeys() {
  try {
    const todayKey = dismissedKeyForToday();
    const stale: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (key && key.startsWith(DISMISSED_KEY_PREFIX) && key !== todayKey) stale.push(key);
    }
    for (const key of stale) window.localStorage.removeItem(key);
  } catch {
    // Best effort only.
  }
}

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { user } = useSession();
  const token = user?.token ?? null;
  const { status } = useLicence();

  const [reportItems, setReportItems] = useState<NotificationItem[]>([]);
  const [dismissed, setDismissed] = useState<string[]>(() => readDismissed());
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    pruneStaleDismissedKeys();
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!token) {
      if (mountedRef.current) setReportItems([]);
      return;
    }
    try {
      const result = await getReportNotifications(token);
      if (mountedRef.current) setReportItems(result.items);
    } catch {
      // Never throw: an unreachable backend must never crash the shell.
      if (mountedRef.current) setReportItems([]);
    }
  }, [token]);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [refresh]);

  const licenceItems = useMemo<NotificationItem[]>(() => {
    if (!status) return [];
    const items: NotificationItem[] = [];
    if (status.status === 'GRACE') {
      items.push({ id: 'LICENCE_GRACE', kind: 'LICENCE_GRACE', severity: 'WARNING' });
    }
    if (status.status === 'EXPIRING_SOON') {
      items.push({ id: 'LICENCE_EXPIRING', kind: 'LICENCE_EXPIRING', severity: 'WARNING' });
    }
    if (status.mode === 'READ_ONLY') {
      items.push({ id: 'LICENCE_READ_ONLY', kind: 'LICENCE_READ_ONLY', severity: 'CRITICAL' });
    }
    return items;
  }, [status]);

  const items = useMemo(() => [...reportItems, ...licenceItems], [reportItems, licenceItems]);
  const visible = useMemo(() => items.filter((item) => !dismissed.includes(item.id)), [items, dismissed]);

  const dismiss = useCallback((id: string) => {
    setDismissed((prev) => {
      if (prev.includes(id)) return prev;
      const next = [...prev, id];
      try {
        window.localStorage.setItem(dismissedKeyForToday(), JSON.stringify(next));
      } catch {
        // Best effort only.
      }
      return next;
    });
  }, []);

  const value: NotificationsContextValue = { items, visible, dismiss, refresh };

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

export function useNotifications(): NotificationsContextValue {
  return useContext(NotificationsContext);
}
