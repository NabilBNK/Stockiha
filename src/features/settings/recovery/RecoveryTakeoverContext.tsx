import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

export type TakeoverRequest =
  | {
      kind: 'LIVE';
      sessionToken: string;
      bundlePath: string;
      bundleIdentifier: string;
      requestId: string;
      confirmationText: string;
    }
  | { kind: 'FRESH_INSTALL'; bundlePath: string; bundleIdentifier: string };

interface RecoveryTakeover {
  request: TakeoverRequest | null;
  /** Can only take effect once per app process: a real restore replaces the
   * whole database mid-flight, so a second call while one is already
   * showing would be meaningless (and the app is about to restart or has
   * already failed irrecoverably by the time this could ever matter). */
  begin: (request: TakeoverRequest) => void;
}

const RecoveryTakeoverContext = createContext<RecoveryTakeover | null>(null);

export function RecoveryTakeoverProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<TakeoverRequest | null>(null);
  const startedRef = useRef(false);

  const begin = useCallback((next: TakeoverRequest) => {
    if (startedRef.current) return;
    startedRef.current = true;
    setRequest(next);
  }, []);

  return (
    <RecoveryTakeoverContext.Provider value={{ request, begin }}>
      {children}
    </RecoveryTakeoverContext.Provider>
  );
}

export function useRecoveryTakeover(): RecoveryTakeover {
  const ctx = useContext(RecoveryTakeoverContext);
  if (!ctx) {
    throw new Error('useRecoveryTakeover must be used within a RecoveryTakeoverProvider');
  }
  return ctx;
}
