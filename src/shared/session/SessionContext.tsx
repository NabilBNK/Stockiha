/**
 * Slice 1 — in-memory application session.
 *
 * Holds the opaque session token ONLY for the lifetime of the running
 * application process — never written to localStorage, disk, or logs (the
 * architecture provides no secure client persistence yet, so none is used).
 * The raw token is passed to protected IPC commands via the gateway and is
 * never rendered. A `SESSION_INVALID` result anywhere clears the session,
 * routing the user back to login.
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
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Clears local session state without an IPC call (e.g. on SESSION_INVALID). */
  clearSession: () => void;
  refreshActiveCashSession: () => Promise<void>;
  setActiveCashSession: (session: ActiveCashSession | null) => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [activeCashSession, setActiveCashSession] = useState<ActiveCashSession | null>(null);

  const login = useCallback(async (username: string, password: string) => {
    const result = await ipc.login(username, password, WORKSTATION_ID);
    setUser({ username, token: result.session_token });
  }, []);

  const clearSession = useCallback(() => {
    setUser(null);
    setActiveCashSession(null);
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
