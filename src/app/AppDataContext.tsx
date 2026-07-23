/**
 * Slice 1 — shared reference data for the authenticated area: the warehouse
 * list, the currently selected warehouse (used by products, stock receipt,
 * POS, and dashboard), and the current open fiscal period (required to post).
 * Loaded once after login from the backend; never cached as a source of
 * truth beyond the process.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import * as ipc from '../shared/ipc/gateway';
import type { OpenFiscalPeriod, Warehouse } from '../shared/ipc/dto';
import { useSession } from '../shared/session/SessionContext';

interface AppDataValue {
  warehouses: Warehouse[];
  selectedWarehouseId: number | null;
  selectWarehouse: (id: number) => void;
  openFiscalPeriod: OpenFiscalPeriod | null;
  loading: boolean;
  error: unknown;
  reload: () => Promise<void>;
}

const AppDataContext = createContext<AppDataValue | null>(null);

export function AppDataProvider({ children }: { children: ReactNode }) {
  const { user } = useSession();
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<number | null>(null);
  const [openFiscalPeriod, setOpenFiscalPeriod] = useState<OpenFiscalPeriod | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const reload = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const [ws, period] = await Promise.all([
        ipc.listWarehouses(user.token),
        ipc.getOpenFiscalPeriod(user.token),
      ]);
      setWarehouses(ws);
      setOpenFiscalPeriod(period);
      setSelectedWarehouseId((current) => current ?? ws[0]?.id ?? null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const value = useMemo<AppDataValue>(
    () => ({
      warehouses,
      selectedWarehouseId,
      selectWarehouse: setSelectedWarehouseId,
      openFiscalPeriod,
      loading,
      error,
      reload,
    }),
    [warehouses, selectedWarehouseId, openFiscalPeriod, loading, error, reload],
  );

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}

export function useAppData(): AppDataValue {
  const ctx = useContext(AppDataContext);
  if (!ctx) {
    throw new Error('useAppData must be used within an AppDataProvider');
  }
  return ctx;
}
