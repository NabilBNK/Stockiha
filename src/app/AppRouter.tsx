/**
 * Top-level routing driven by backend setup status and the in-memory session.
 * Opening state is a one-time optional setup workflow: neither reconciliation
 * nor application appears in daily navigation. Restricted access is surfaced
 * from Settings only while an administrator still has a cutover action.
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
import { OpeningStateApplicationScreen } from '../features/onboarding/OpeningStateApplicationScreen';
import { DrawerPolicySettingsScreen } from '../features/settings/DrawerPolicySettingsScreen';
import { RecoverySettingsScreen } from '../features/settings/RecoverySettingsScreen';
import SuppliersScreen from '../features/procurement/SuppliersScreen';
import PurchaseOrdersScreen from '../features/procurement/PurchaseOrdersScreen';
import { SupplierInvoicesScreen } from '../features/procurement/SupplierInvoicesScreen';
import { SupplierLiabilitiesScreen } from '../features/procurement/SupplierLiabilitiesScreen';
import { SupplierReturnsScreen } from '../features/procurement/SupplierReturnsScreen';

type RouteState = 'loading' | 'unavailable' | 'setup' | 'ready';

type OpeningSetupCopy = {
  deferredTitle: string;
  deferredBody: string;
  deferredAction: string;
  applicationTitle: string;
  applicationBody: string;
  applicationAction: string;
};

const OPENING_SETUP_COPY: Record<Locale, OpeningSetupCopy> = {
  en: {
    deferredTitle: 'Opening state still pending',
    deferredBody: 'This optional one-time setup was postponed. Only an administrator can complete it.',
    deferredAction: 'Complete opening state',
    applicationTitle: 'Approved opening state awaiting application',
    applicationBody: 'The balances are approved but have not entered the live financial ledgers. An administrator must review the customer/supplier mappings and apply them once.',
    applicationAction: 'Review and apply opening state',
  },
  fr: {
    deferredTitle: 'Situation initiale encore en attente',
    deferredBody: 'Cette configuration facultative et unique a été reportée. Seul un administrateur peut la compléter.',
    deferredAction: 'Compléter la situation initiale',
    applicationTitle: 'Situation initiale approuvée en attente d’application',
    applicationBody: 'Les soldes sont approuvés mais ne figurent pas encore dans les registres financiers actifs. Un administrateur doit vérifier les correspondances et les appliquer une seule fois.',
    applicationAction: 'Vérifier et appliquer la situation',
  },
  ar: {
    deferredTitle: 'الوضعية الافتتاحية ما زالت مؤجلة',
    deferredBody: 'تم تأجيل هذا الإعداد الاختياري الذي يُنجز مرة واحدة. لا يمكن إكماله إلا من طرف المسؤول.',
    deferredAction: 'إكمال الوضعية الافتتاحية',
    applicationTitle: 'الوضعية الافتتاحية موافق عليها وتنتظر التطبيق',
    applicationBody: 'تمت الموافقة على الأرصدة لكنها لم تدخل بعد إلى السجلات المالية الفعلية. يجب على المسؤول مراجعة ربط الزبائن والموردين وتطبيقها مرة واحدة.',
    applicationAction: 'مراجعة وتطبيق الوضعية',
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
      // either restricted setup stage or its existence to them.
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
    if (
      view === 'opening_state_application'
      && !openingStateStatus?.showApplicationAccess
    ) {
      setView('dashboard');
    }
  }, [openingStateStatus, view]);

  async function finishOpeningStateApplication() {
    await refreshOpeningStateStatus();
    setView('settings');
  }

  return (
    <AppShell currentView={view} onNavigate={setView}>
      {view === 'dashboard' && <DashboardScreen />}
      {view === 'historical_finance' && (
        <HistoricalFinanceScreen sessionToken={user?.token ?? ''} />
      )}
      {view === 'opening_state' && openingStateStatus?.showDeferredAccess && (
        <OpeningStateScreen sessionToken={user?.token ?? ''} />
      )}
      {view === 'opening_state_application' && openingStateStatus?.showApplicationAccess && (
        <OpeningStateApplicationScreen
          sessionToken={user?.token ?? ''}
          openFiscalPeriodId={openFiscalPeriod?.id ?? null}
          onApplied={() => void finishOpeningStateApplication()}
          onCancel={() => setView('settings')}
        />
      )}
      {view === 'settings' && (
        <>
          {openingStateStatus?.showDeferredAccess ? (
            <section className="sk-card" aria-labelledby="deferred-opening-state-title">
              <h2 id="deferred-opening-state-title">{text.deferredTitle}</h2>
              <Banner tone="info">{text.deferredBody}</Banner>
              <Button type="button" onClick={() => setView('opening_state')}>
                {text.deferredAction}
              </Button>
            </section>
          ) : null}
          {openingStateStatus?.showApplicationAccess ? (
            <section
              className="sk-card"
              aria-labelledby="opening-state-application-title"
              data-testid="opening-state-application-settings-card"
            >
              <h2 id="opening-state-application-title">{text.applicationTitle}</h2>
              <Banner tone="warning">{text.applicationBody}</Banner>
              <Button type="button" onClick={() => setView('opening_state_application')}>
                {text.applicationAction}
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
