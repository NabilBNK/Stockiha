/**
 * Slice 1 — in-memory application session.
 *
 * Holds the opaque session token ONLY for the lifetime of the running
 * application process — never written to localStorage, disk, or logs (the
 * architecture provides no secure client persistence yet, so none is used).
 * The raw token is passed to protected IPC commands via the gateway and is
 * never rendered. A `SESSION_INVALID` result anywhere clears the session
 * and routes the user back to login.
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { WORKSTATION_ID } from '../../app/config';
import * as ipc from '../ipc/gateway';
import type { ActiveCashSession } from '../ipc/dto';

export interface AuthenticatedUser {
  username: string;
  token: string;
}

interface SessionContextValue {
  user: AuthenticatedUser | null;
  activeCashSession: ActiveCashSession | null;
  workstationId: string;
  login: (username: string, password: string) => Promise<string>;
  logout: () => Promise<void>;
  /** Clears local session state without an IPC call (e.g. on SESSION_INVALID). */
  clearSession: () => void;
  refreshActiveCashSession: () => Promise<void>;
  setActiveCashSession: (session: ActiveCashSession | null) => void;
}

export const SessionContext = createContext<SessionContextValue | null>(null);

const SESSION_STORAGE_KEY = 'stockiha.session';

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthenticatedUser | null>(() => {
    if (import.meta.env.MODE === 'test') {
      return null;
    }
    try {
      const stored = window.sessionStorage?.getItem(SESSION_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as AuthenticatedUser;
        if (parsed?.username && parsed?.token) return parsed;
      }
    } catch {
      // Best effort only
    }
    return null;
  });
  const [activeCashSession, setActiveCashSession] = useState<ActiveCashSession | null>(null);

  const login = useCallback(async (username: string, password: string) => {
    const result = await ipc.login(username, password, WORKSTATION_ID);
    const authUser = { username, token: result.session_token };
    setUser(authUser);
    if (import.meta.env.MODE !== 'test') {
      try {
        window.sessionStorage?.setItem(SESSION_STORAGE_KEY, JSON.stringify(authUser));
      } catch {
        // Best effort
      }
    }
    return result.session_token;
  }, []);

  const clearSession = useCallback(() => {
    setUser(null);
    setActiveCashSession(null);
    if (import.meta.env.MODE !== 'test') {
      try {
        window.sessionStorage?.removeItem(SESSION_STORAGE_KEY);
      } catch {
        // Best effort
      }
    }
  }, []);

  const logout = useCallback(async () => {
    const token = user?.token;
    // Clear local state first so the UI never lingers on an authed view.
    clearSession();
    if (token) {
      try {
        await ipc.logout(token);
      } catch {
        // A best-effort revoke; the local session is already cleared.
      }
    }
  }, [user, clearSession]);

  const refreshActiveCashSession = useCallback(async () => {
    if (!user) return;
    const session = await ipc.inspectActiveCashSession(user.token, WORKSTATION_ID);
    setActiveCashSession(session);
  }, [user]);

  const value = useMemo<SessionContextValue>(
    () => ({
      user,
      activeCashSession,
      workstationId: WORKSTATION_ID,
      login,
      logout,
      clearSession,
      refreshActiveCashSession,
      setActiveCashSession,
    }),
    [user, activeCashSession, login, logout, clearSession, refreshActiveCashSession],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error('useSession must be used within a SessionProvider');
  }
  return ctx;
}
