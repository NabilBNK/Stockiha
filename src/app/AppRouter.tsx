/**
 * Top-level routing driven by backend setup status and the in-memory session.
 * Opening state is a one-time optional setup workflow: it is not part of the
 * daily navigation and is surfaced later only to a permitted administrator
 * while the setup decision remains pending or deferred.
 */
import { useCallback, useEffect, useState } from 'react';

import { Banner, Button, Spinner } from '../shared/components';
import { useI18n, type Locale } from '../shared/i18n';
import { isSessionInvalid } from '../shared/hooks/useErrorText';
import { useSession } from '../shared/session/SessionContext';
import * as ipc from '../shared/ipc/gateway';
import { getOpeningStateOnboardingStatus } from '../shared/ipc/openingStateLifecycleGateway';
import type { OpeningStateOnboardingStatusResult } from '../shared/ipc/openingStateLifecycleDto';
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

const OPENING_SETUP_COPY: Record<Locale, { title: string; body: string; action: string }> = {
  en: {
    title: 'Opening state still pending',
    body: 'This optional one-time setup was postponed. Only an administrator can complete it.',
    action: 'Complete opening state',
  },
  fr: {
    title: 'Situation initiale encore en attente',
    body: 'Cette configuration facultative et unique a été reportée. Seul un administrateur peut la compléter.',
    action: 'Compléter la situation initiale',
  },
  ar: {
    title: 'الوضعية الافتتاحية ما زالت مؤجلة',
    body: 'تم تأجيل هذا الإعداد الاختياري الذي يُنجز مرة واحدة. لا يمكن إكماله إلا من طرف المسؤول.',
    action: 'إكمال الوضعية الافتتاحية',
  },
};

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
  const { locale } = useI18n();
  const text = OPENING_SETUP_COPY[locale];
  const { user, refreshActiveCashSession, clearSession } = useSession();
  const { error, openFiscalPeriod } = useAppData();
  const [view, setView] = useState<AppView>('dashboard');
  const [openingStateStatus, setOpeningStateStatus] =
    useState<OpeningStateOnboardingStatusResult | null>(null);

  const refreshOpeningStateStatus = useCallback(async () => {
    const token = user?.token;
    if (!token) {
      setOpeningStateStatus(null);
      return;
    }
    try {
      setOpeningStateStatus(await getOpeningStateOnboardingStatus(token));
    } catch {
      // Permission denial is the normal result for operators. Do not expose
      // the restricted setup workflow or its existence to them.
      setOpeningStateStatus(null);
    }
  }, [user?.token]);

  useEffect(() => {
    void refreshActiveCashSession();
  }, [refreshActiveCashSession]);

  useEffect(() => {
    void refreshOpeningStateStatus();
  }, [refreshOpeningStateStatus]);

  useEffect(() => {
    if (view === 'settings') void refreshOpeningStateStatus();
  }, [view, refreshOpeningStateStatus]);

  useEffect(() => {
    if (error && isSessionInvalid(error)) {
      clearSession();
    }
  }, [error, clearSession]);

  useEffect(() => {
    if (view === 'opening_state' && !openingStateStatus?.showDeferredAccess) {
      setView('dashboard');
    }
  }, [openingStateStatus, view]);

  return (
    <AppShell currentView={view} onNavigate={setView}>
      {view === 'dashboard' && <DashboardScreen />}
      {view === 'historical_finance' && (
        <HistoricalFinanceScreen sessionToken={user?.token ?? ''} />
      )}
      {view === 'opening_state' && openingStateStatus?.showDeferredAccess && (
        <OpeningStateScreen sessionToken={user?.token ?? ''} />
      )}
      {view === 'settings' && (
        <>
          {openingStateStatus?.showDeferredAccess ? (
            <section className="sk-card" aria-labelledby="deferred-opening-state-title">
              <h2 id="deferred-opening-state-title">{text.title}</h2>
              <Banner tone="info">{text.body}</Banner>
              <Button type="button" onClick={() => setView('opening_state')}>
                {text.action}
              </Button>
            </section>
          ) : null}
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
