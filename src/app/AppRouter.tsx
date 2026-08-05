/**
 * Slice 1 — top-level routing driven by BACKEND setup status and the
 * in-memory session (not local storage):
 *   loading → backend-unavailable | first-run setup | login | authenticated app.
 * The authenticated app mounts shared reference data, refreshes the active
 * cash session, and renders the selected feature view inside the shell.
 * A `SESSION_INVALID` result while loading reference data clears the session
 * and routes back to login.
 */
import { useCallback, useEffect, useState } from 'react';

import { Button, Spinner } from '../shared/components';
import { useI18n } from '../shared/i18n';
import { isSessionInvalid } from '../shared/hooks/useErrorText';
import { useSession } from '../shared/session/SessionContext';
import * as ipc from '../shared/ipc/gateway';
import { AppDataProvider, useAppData } from './AppDataContext';
import { AppShell, type AppView } from './AppShell';
import { LoginScreen } from '../features/auth/LoginScreen';
import { SetupScreen } from '../features/setup/SetupScreen';
import { DashboardScreen } from '../features/dashboard/DashboardScreen';
import { ProductsScreen } from '../features/products/ProductsScreen';
import { StockAdjustmentScreen } from '../features/inventory/StockAdjustmentScreen';
import { StockReceiptScreen } from '../features/inventory/StockReceiptScreen';
import { PosScreen } from '../features/pos/PosScreen';
import { CashSessionScreen } from '../features/cash-session/CashSessionScreen';
import { DocumentsScreen } from '../features/documents/DocumentsScreen';
import { CustomersScreen } from '../features/customers/CustomersScreen';
import { HistoricalFinanceScreen } from '../features/onboarding/HistoricalFinanceScreen';
import { OpeningStateScreen } from '../features/onboarding/OpeningStateScreen';
import { DrawerPolicySettingsScreen } from '../features/settings/DrawerPolicySettingsScreen';
import { RecoverySettingsScreen } from '../features/settings/RecoverySettingsScreen';
import SuppliersScreen from '../features/procurement/SuppliersScreen';
import PurchaseOrdersScreen from '../features/procurement/PurchaseOrdersScreen';
import { SupplierInvoicesScreen } from '../features/procurement/SupplierInvoicesScreen';
import { SupplierLiabilitiesScreen } from '../features/procurement/SupplierLiabilitiesScreen';
import { SupplierReturnsScreen } from '../features/procurement/SupplierReturnsScreen';

type RouteState = 'loading' | 'unavailable' | 'setup' | 'ready';

export function AppRouter() {
  const { t } = useI18n();
  const { user } = useSession();
  const [route, setRoute] = useState<RouteState>('loading');

  const refresh = useCallback(async () => {
    setRoute('loading');
    try {
      const status = await ipc.getSetupStatus();
      setRoute(status.initialized ? 'ready' : 'setup');
    } catch {
      setRoute('unavailable');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (route === 'loading') {
    return (
      <div className="sk-centered">
        <Spinner />
      </div>
    );
  }

  if (route === 'unavailable') {
    return (
      <div className="sk-centered">
        <div className="sk-card" role="alert" data-testid="backend-unavailable">
          <h1>{t('backend.unavailable.title')}</h1>
          <p>{t('backend.unavailable.body')}</p>
          <Button onClick={() => void refresh()}>{t('common.retry')}</Button>
        </div>
      </div>
    );
  }

  if (route === 'setup') {
    return <SetupScreen onComplete={() => void refresh()} />;
  }

  if (!user) {
    return <LoginScreen />;
  }

  return (
    <AppDataProvider>
      <AuthenticatedApp />
    </AppDataProvider>
  );
}

function AuthenticatedApp() {
  const { user, refreshActiveCashSession, clearSession } = useSession();
  const { error, openFiscalPeriod } = useAppData();
  const [view, setView] = useState<AppView>('dashboard');

  useEffect(() => {
    void refreshActiveCashSession();
  }, [refreshActiveCashSession]);

  useEffect(() => {
    if (error && isSessionInvalid(error)) {
      clearSession();
    }
  }, [error, clearSession]);

  return (
    <AppShell currentView={view} onNavigate={setView}>
      {view === 'dashboard' && <DashboardScreen />}
      {view === 'historical_finance' && (
        <HistoricalFinanceScreen sessionToken={user?.token ?? ''} />
      )}
      {view === 'opening_state' && (
        <OpeningStateScreen sessionToken={user?.token ?? ''} />
      )}
      {view === 'settings' && (
        <>
          <DrawerPolicySettingsScreen sessionToken={user?.token ?? ''} />
          <RecoverySettingsScreen sessionToken={user?.token ?? ''} />
        </>
      )}
      {view === 'products' && <ProductsScreen />}
      {view === 'stock' && <StockReceiptScreen />}
      {view === 'adjustment' && <StockAdjustmentScreen />}
      {view === 'pos' && <PosScreen />}
      {view === 'session' && <CashSessionScreen />}
      {view === 'documents' && <DocumentsScreen />}
      {view === 'customers' && <CustomersScreen sessionToken={user?.token ?? ''} />}
      {view === 'suppliers' && <SuppliersScreen sessionToken={user?.token ?? ''} />}
      {view === 'purchase_orders' && <PurchaseOrdersScreen sessionToken={user?.token ?? ''} />}
      {view === 'supplier_invoices' && (
        <SupplierInvoicesScreen
          sessionToken={user?.token ?? ''}
          openFiscalPeriodId={openFiscalPeriod?.id ?? null}
        />
      )}
      {view === 'supplier_liabilities' && (
        <SupplierLiabilitiesScreen sessionToken={user?.token ?? ''} />
      )}
      {view === 'supplier_returns' && (
        <SupplierReturnsScreen sessionToken={user?.token ?? ''} />
      )}
    </AppShell>
  );
}
