/**
 * WS-K-7 — the frontend's licence status, mounted outside `SessionProvider`
 * (see `App.tsx`) so the login screen can show it before anyone signs in.
 *
 * Fails OPEN, deliberately: on any error fetching or refreshing status —
 * including the very first call, before the backend has answered even
 * once — `status` is `null` and `readOnly` is `false`, so the UI never
 * blocks anything on its own. The backend's `invoke_handler` gate is the
 * real enforcement; this context only ever adds a banner or a friendlier
 * blocked screen on top of it. This is also what lets the existing test
 * suite pass without adding `get_licence_status` to every mock: an
 * unmocked or rejected call degrades to "nothing is blocked", never to a
 * thrown error or a blocking UI state.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { listen } from '@tauri-apps/api/event';

import { getLicenceStatus } from '../ipc/licenceGateway';
import { LICENCE_STATUS_CHANGED_EVENT, type LicenceStatus } from '../ipc/licenceDto';

const REFRESH_INTERVAL_MS = 10 * 60 * 1000;

interface LicenceContextValue {
  status: LicenceStatus | null;
  readOnly: boolean;
  refresh: () => Promise<void>;
}

// Exported (not just the hook) so tests can inject a fixed status without
// driving the real IPC/event wiring — see tests/licenceTestUtils.tsx.
export const LicenceContext = createContext<LicenceContextValue>({
  status: null,
  readOnly: false,
  refresh: async () => {},
});

export function LicenceProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<LicenceStatus | null>(null);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const next = await getLicenceStatus();
      if (mountedRef.current) setStatus(next);
    } catch {
      // Fail open: never block the UI on a licence-status fetch failure.
      if (mountedRef.current) setStatus(null);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [refresh]);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | null = null;
    listen<LicenceStatus>(LICENCE_STATUS_CHANGED_EVENT, (event) => {
      if (active) setStatus(event.payload);
    })
      .then((stop) => {
        if (active) {
          unlisten = stop;
        } else {
          stop();
        }
      })
      .catch(() => {
        // Event registration can fail (e.g. no Tauri backend in tests); the
        // periodic refresh above still covers status changes either way.
      });
    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  const value: LicenceContextValue = {
    status,
    readOnly: status?.mode === 'READ_ONLY',
    refresh,
  };

  return <LicenceContext.Provider value={value}>{children}</LicenceContext.Provider>;
}

export function useLicence(): LicenceContextValue {
  return useContext(LicenceContext);
}
