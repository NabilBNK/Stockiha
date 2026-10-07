/**
 * Top-level routing driven by backend setup status and the in-memory session.
 * Opening state is a one-time optional setup workflow: neither reconciliation
 * nor application appears in daily navigation. Restricted access is surfaced
 * from Settings only while an administrator still has a cutover action.
 */
import { useCallback, useEffect, useState } from 'react';

import { Banner, Button, Spinner } from '../shared/components';
import { useI18n } from '../shared/i18n';
import { isSessionInvalid } from '../shared/hooks/useErrorText';
import { useSession } from '../shared/session/SessionContext';
import * as ipc from '../shared/ipc/gateway';
import { getCustomerCapabilities } from '../shared/ipc/customerGateway';
import type { CustomerCapabilities } from '../shared/ipc/customerDto';
import { getReportsCapabilities } from '../shared/ipc/reportsGateway';
import type { ReportsCapabilities } from '../shared/ipc/reportsDto';
import { ReportsScreen } from '../features/reports/ReportsScreen';
import { NotificationsProvider } from '../features/notifications/NotificationsContext';
import { AppDataProvider, useAppData } from './AppDataContext';
import { LiveRestoreScreen } from '../features/settings/recovery/LiveRestoreScreen';
import { useRecoveryTakeover } from '../features/settings/recovery/RecoveryTakeoverContext';
import {
  getBackupStatus,
  getRecoveryCapabilities,
  runAutomaticBackup,
} from '../shared/ipc/recoveryGateway';
import { AppShell, type AppView } from './AppShell';
import { LicenceBanner } from '../features/licence/LicenceBanner';
import { LicenceSettingsCard } from '../features/licence/LicenceSettingsCard';
import { LoginScreen } from '../features/auth/LoginScreen';
import { SetupScreen } from '../features/setup/SetupScreen';
import { BackendUnavailableScreen } from '../features/startup/BackendUnavailableScreen';
import { EmbeddedSetupScreen } from '../features/startup/EmbeddedSetupScreen';
import { DatabaseUpgradeScreen } from '../features/startup/DatabaseUpgradeScreen';
import { UpdateBanner } from '../features/update/UpdateBanner';
import { DashboardScreen } from '../features/dashboard/DashboardScreen';
import { CatalogScreen } from '../features/catalog2/CatalogScreen';
import { CatalogueSetupScreen } from '../features/catalogue-setup/CatalogueSetupScreen';
import { StockAdjustmentScreen } from '../features/inventory/StockAdjustmentScreen';
import { StockReceiptScreen } from '../features/inventory/StockReceiptScreen';
import { InventoryScreen } from '../features/inventory/InventoryScreen';
import { PosScreen } from '../features/pos/PosScreen';
import { CashSessionScreen } from '../features/cash-session/CashSessionScreen';
import { DocumentsScreen } from '../features/documents/DocumentsScreen';
import { JournalsScreen } from '../features/accounting/JournalsScreen';
import { CustomersScreen } from '../features/customers/CustomersScreen';
import { PaperBookScreen } from '../features/paperbook';
import { DrawerPolicySettingsScreen } from '../features/settings/DrawerPolicySettingsScreen';
import { RecoverySettingsScreen } from '../features/settings/RecoverySettingsScreen';
import { InventoryCorrectionsSettingsScreen } from '../features/settings/InventoryCorrectionsSettingsScreen';
import { UserManagementSettingsScreen } from '../features/settings/UserManagementSettingsScreen';
import { PrintingSettingsScreen } from '../features/settings/PrintingSettingsScreen';
import { getInventoryCorrectionsSetting } from '../shared/ipc/inventoryCorrectionsGateway';
import SuppliersScreen from '../features/procurement/SuppliersScreen';
import PurchasesScreen from '../features/procurement/PurchasesScreen';
import type { InventoryCapabilities, ProcurementCapabilities } from '../shared/ipc/dto';

type RouteState = 'loading' | 'unavailable' | 'setup' | 'ready';

// WS-H-6: the daily automatic backup fires at most once per app process, 60
// seconds after the first login of that process — module-level, not
// component state, so remounting `AuthenticatedApp` (e.g. a settings view
// re-render elsewhere in the tree) never re-arms it or fires it twice.
let dailyBackupTimer: number | null = null;
let dailyBackupDone = false;

export function AppRouter() {
  const { user } = useSession();
  const takeover = useRecoveryTakeover();
  const [route, setRoute] = useState<RouteState>('loading');
  // Credential-free reason for the unavailable state, so the screen can name
  // the real cause instead of showing a generic message for every failure.
  const [reason, setReason] = useState<ipc.DbDiagnostic | null>(null);

  const refresh = useCallback(async () => {
    setRoute('loading');
    try {
      const status = await ipc.getSetupStatus();
      setReason(null);
      setRoute(status.initialized ? 'ready' : 'setup');
    } catch {
      // Best-effort: the diagnostic command is infallible in Rust, but a
      // failure to fetch it must never replace the unavailable screen.
      try {
        setReason(await ipc.getDbDiagnostic());
      } catch {
        setReason(null);
      }
      setRoute('unavailable');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // WS-H-5: a real restore or new-PC restore takes over the whole window —
  // no navigation, no logout, nothing else — until the app restarts or the
  // operator explicitly restarts it. Checked after every hook above and
  // before every other route.
  if (takeover.request) {
    return <LiveRestoreScreen request={takeover.request} />;
  }

  if (route === 'loading') {
    return (
      <div className="sk-centered">
        <Spinner />
      </div>
    );
  }

  if (route === 'unavailable') {
    // WS-K-4: with the embedded architecture, NOT_CONFIGURED always means
    // "first launch, setup has never run" — not a broken configuration.
    // Route it to the interactive setup flow instead of the generic
    // unavailable card; every other diagnostic reason is unchanged.
    if (reason?.code === 'NOT_CONFIGURED') {
      return <EmbeddedSetupScreen />;
    }
    // WS-K-5: an embedded install that can self-upgrade (a migrator
    // credential is on file) routes to the safe-upgrade screen instead of
    // the plain "contact your supplier" card — that message was written for
    // a database someone else administers, and here Stockiha is the one
    // that can bring it up to date, safely, itself. An installation with no
    // migrator credential (pre-WS-K-4.9, or a non-embedded database) still
    // falls through to the unchanged BackendUnavailableScreen.
    if (reason?.code === 'OK' && reason.schema?.status === 'OLDER_THAN_BINARY' && reason.self_upgrade_available) {
      return <DatabaseUpgradeScreen />;
    }
    return <BackendUnavailableScreen diagnostic={reason} onRetry={() => void refresh()} />;
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
  const { t } = useI18n();
  const { user, activeCashSession, refreshActiveCashSession, clearSession } = useSession();
  const { error, openFiscalPeriod } = useAppData();
  const [view, setView] = useState<AppView>('dashboard');
  /**
   * WS-D-15 A3 — the minimal hand-off authorized to complete the global
   * search's "no extra click" requirement. AppShell (inside the D-7 blast
   * radius exception) cannot reach CatalogScreen directly — it is rendered
   * only here — so this is the one piece of state carrying "open on this
   * variant" across that boundary. Cleared by CatalogScreen itself via
   * onPendingSelectionConsumed once it has acted on it, so switching away
   * from Products and back does not re-open the same panel.
   */
  const [pendingProductSelection, setPendingProductSelection] =
    useState<{ productId: number; variantId: number } | null>(null);
  const [inventoryCapabilities, setInventoryCapabilities] =
    useState<InventoryCapabilities | null>(null);
  const [inventoryCorrectionsEnabled, setInventoryCorrectionsEnabled] = useState<boolean | null>(null);
  const [procurementCapabilities, setProcurementCapabilities] =
    useState<ProcurementCapabilities | null>(null);
  const [customerCapabilities, setCustomerCapabilities] =
    useState<CustomerCapabilities | null>(null);
  const [reportsCapabilities, setReportsCapabilities] =
    useState<ReportsCapabilities | null>(null);
  /**
   * WS-K-1 (correction 1) — a persistent, non-dismissible notice that
   * `database.json`'s on-disk permissions look broader than the current
   * user. Deliberately non-blocking: the app has already started and
   * connected successfully by the time this state exists, so this only ever
   * adds a banner, never gates routing. Fetched once, best-effort — a
   * failure here must never affect the authenticated app in any way.
   */
  const [configWarning, setConfigWarning] = useState<ipc.ConfigWarning | null>(null);
  // WS-H-6: shown when this admin's install has no successful backup in the
  // last 7 days (or none at all). `false` whenever the current session
  // cannot even create a backup, or the check itself fails — never surfaced
  // as an error.
  const [backupOverdue, setBackupOverdue] = useState(false);

  useEffect(() => {
    let active = true;
    void ipc
      .getDbDiagnostic()
      .then((diagnostic) => {
        if (active) setConfigWarning(diagnostic.config_warning);
      })
      .catch(() => {
        // Best-effort only: never surface this failure to the user.
      });
    return () => {
      active = false;
    };
  }, []);

  const refreshBackupOverdueWarning = useCallback(async () => {
    const token = user?.token;
    if (!token) {
      setBackupOverdue(false);
      return;
    }
    try {
      const capabilities = await getRecoveryCapabilities(token);
      if (!capabilities.canCreateBackup) {
        setBackupOverdue(false);
        return;
      }
      const status = await getBackupStatus(token);
      if (!status.lastSuccessAt) {
        setBackupOverdue(true);
        return;
      }
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      setBackupOverdue(Date.now() - new Date(status.lastSuccessAt).getTime() > sevenDaysMs);
    } catch {
      // Any IPC error here renders no banner - never a raw error.
      setBackupOverdue(false);
    }
  }, [user?.token]);

  useEffect(() => {
    void refreshBackupOverdueWarning();
  }, [refreshBackupOverdueWarning]);

  // WS-H-6: the daily automatic backup, 60 seconds after the first login of
  // this app process, at most once regardless of remounts (module-level
  // `dailyBackupDone`/`dailyBackupTimer`, not component state).
  useEffect(() => {
    const token = user?.token;
    if (!token || dailyBackupDone || dailyBackupTimer !== null) {
      return;
    }
    dailyBackupTimer = window.setTimeout(() => {
      dailyBackupDone = true;
      dailyBackupTimer = null;
      void runAutomaticBackup(token, {
        requestId: `auto-daily-${Date.now()}`,
        reason: 'DAILY',
      })
        .catch(() => {
          // Swallowed - never a popup, never blocks the UI.
        })
        .finally(() => void refreshBackupOverdueWarning());
    }, 60_000);
    return () => {
      if (dailyBackupTimer !== null) {
        window.clearTimeout(dailyBackupTimer);
        dailyBackupTimer = null;
      }
    };
  }, [user?.token, refreshBackupOverdueWarning]);


  useEffect(() => {
    const token = user?.token;
    if (!token) { setInventoryCorrectionsEnabled(null); return; }
    let active = true;
    void getInventoryCorrectionsSetting(token).then((setting) => { if (active) setInventoryCorrectionsEnabled(setting.enabled); }).catch(() => { if (active) setInventoryCorrectionsEnabled(false); });
    return () => { active = false; };
  }, [user?.token]);

  useEffect(() => {
    const token = user?.token;
    if (!token) {
      setProcurementCapabilities(null);
      return;
    }
    let active = true;
    void ipc.getProcurementCapabilities(token)
      .then((capabilities) => {
        if (active) setProcurementCapabilities(capabilities);
      })
      .catch(() => {
        if (active) {
          setProcurementCapabilities({
            can_manage_procurement: false,
            can_post_purchase_receipt: false,
            can_post_supplier_invoice: false,
            can_post_supplier_return: false,
            can_post_supplier_payment: false,
          });
        }
      });
    return () => {
      active = false;
    };
  }, [user?.token]);

  useEffect(() => {
    const token = user?.token;
    if (!token) {
      setCustomerCapabilities(null);
      return;
    }
    let active = true;
    void getCustomerCapabilities(token)
      .then((capabilities) => {
        if (active) setCustomerCapabilities(capabilities);
      })
      .catch(() => {
        if (active) {
          // Safe-deny the UI projection. Database checks remain authoritative.
          setCustomerCapabilities({
            can_view_customers: false,
            can_manage_customers: false,
            can_post_credit_sale: false,
            can_post_customer_payment: false,
            can_post_customer_refund: false,
            can_manage_drawer_policy: false,
            can_override_credit_limit: false,
            can_apply_sale_discount: false,
          });
        }
      });
    return () => {
      active = false;
    };
  }, [user?.token]);

  // WS-I-1 — read-only capability for the reporting screens; safe-deny like
  // the other capability flags above (UI hiding only, not authorisation).
  useEffect(() => {
    const token = user?.token;
    if (!token) {
      setReportsCapabilities(null);
      return;
    }
    let active = true;
    void getReportsCapabilities(token)
      .then((capabilities) => {
        if (active) setReportsCapabilities(capabilities);
      })
      .catch(() => {
        if (active) setReportsCapabilities({ can_view_reports: false });
      });
    return () => {
      active = false;
    };
  }, [user?.token]);

  useEffect(() => {
    void refreshActiveCashSession();
  }, [refreshActiveCashSession]);

  useEffect(() => {
    const token = user?.token;
    if (!token) {
      setInventoryCapabilities(null);
      return;
    }
    let active = true;
    void ipc.getInventoryCapabilities(token)
      .then((capabilities) => {
        if (active) setInventoryCapabilities(capabilities);
      })
      .catch(() => {
        if (active) {
          // Safe-deny the UI projection. Database checks remain authoritative.
          setInventoryCapabilities({
            can_manage_catalog: false,
            can_post_stock_receipt: false,
            can_view_inventory: false,
            can_manage_inventory: false,
          });
        }
      });
    return () => {
      active = false;
    };
  }, [user?.token]);

  useEffect(() => {
    if (error && isSessionInvalid(error)) {
      clearSession();
    }
  }, [error, clearSession]);

  useEffect(() => {
    if (view === 'opening_state' || view === 'opening_state_application') {
      setView('dashboard');
    }
  }, [view]);

  useEffect(() => {
    if (!inventoryCapabilities) return;
    const allowed =
      (view !== 'products' || inventoryCapabilities.can_manage_catalog)
      && (view !== 'catalogueSetup' || inventoryCapabilities.can_manage_catalog)
      && (view !== 'inventory' || inventoryCapabilities.can_view_inventory)
      && (view !== 'stock' || inventoryCapabilities.can_post_stock_receipt)
      && (view !== 'adjustment' || (inventoryCapabilities.can_manage_inventory && inventoryCorrectionsEnabled));
    if (!allowed) setView('dashboard');
  }, [inventoryCapabilities, inventoryCorrectionsEnabled, view]);

  useEffect(() => {
    if (!procurementCapabilities) return;
    const procurementView = ['suppliers', 'purchases'].includes(view);
    if (procurementView && !procurementCapabilities.can_manage_procurement) {
      setView('dashboard');
    }
  }, [procurementCapabilities, view]);

  useEffect(() => {
    if (!customerCapabilities) return;
    if (view === 'customers' && !customerCapabilities.can_view_customers) {
      setView('dashboard');
    }
  }, [customerCapabilities, view]);

  // WS-D-15 A3 — navigates to Products and arms the hand-off CatalogScreen
  // picks up. Reuses the existing 'products' view id; no parallel navigation
  // mechanism is added.
  function goToVariant(productId: number, variantId: number) {
    setPendingProductSelection({ productId, variantId });
    setView('products');
  }

  // WS-K-7: navigate to Settings and scroll the licence card into view — the
  // one cross-screen action the licence banner and the POS/cash-session
  // blocked cards all need (plan §7.3/§7.5).
  function openLicenceCard() {
    setView('settings');
    window.requestAnimationFrame(() => {
      document.getElementById('licence-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }



  return (
    <NotificationsProvider>
    <AppShell
      currentView={view}
      onNavigate={setView}
      onNavigateToVariant={goToVariant}
      inventoryCapabilities={inventoryCapabilities}
      inventoryCorrectionsEnabled={inventoryCorrectionsEnabled}
      procurementCapabilities={procurementCapabilities}
      customerCapabilities={customerCapabilities}
      reportsCapabilities={reportsCapabilities}
    >
      <UpdateBanner cashSessionOpen={activeCashSession !== null} />
      {(view === 'dashboard' || view === 'settings') && (
        <LicenceBanner onOpenLicence={openLicenceCard} />
      )}
      {configWarning === 'INSECURE_PERMISSIONS' ? (
        <Banner tone="warning" testId="db-config-permission-warning">
          {t('backend.configWarning.insecurePermissions')}
        </Banner>
      ) : null}
      {backupOverdue ? (
        <Banner tone="warning" testId="backup-overdue-warning">
          <p>{t('recovery.overdueWarning')}</p>
          <Button type="button" onClick={() => setView('settings')}>
            {t('recovery.overdueAction')}
          </Button>
        </Banner>
      ) : null}
      {view === 'dashboard' && (
        <DashboardScreen
          onNavigate={setView}
          access={{
            inventoryCapabilities,
            inventoryCorrectionsEnabled,
            procurementCapabilities,
            customerCapabilities,
            reportsCapabilities,
          }}
        />
      )}
      {view === 'reports' && <ReportsScreen setView={setView} />}
      {view === 'historical_finance' && (
        <PaperBookScreen sessionToken={user?.token ?? ''} />
      )}
      {view === 'settings' && (
        <>
          <DrawerPolicySettingsScreen sessionToken={user?.token ?? ''} />
          <InventoryCorrectionsSettingsScreen sessionToken={user?.token ?? ''} />
          <RecoverySettingsScreen sessionToken={user?.token ?? ''} />
          <UserManagementSettingsScreen sessionToken={user?.token ?? ''} />
          <PrintingSettingsScreen sessionToken={user?.token ?? ''} />
          <LicenceSettingsCard sessionToken={user?.token ?? ''} />
        </>
      )}
      {view === 'products' && (
        <CatalogScreen
          pendingSelection={pendingProductSelection}
          onPendingSelectionConsumed={() => setPendingProductSelection(null)}
        />
      )}
      {view === 'catalogueSetup' && <CatalogueSetupScreen sessionToken={user?.token ?? ''} />}
      {view === 'inventory' && <InventoryScreen />}
      {view === 'stock' && <StockReceiptScreen />}
      {view === 'adjustment' && inventoryCorrectionsEnabled && <StockAdjustmentScreen />}
      {view === 'pos' && <PosScreen onOpenLicence={openLicenceCard} />}
      {view === 'session' && <CashSessionScreen />}
      {view === 'documents' && <DocumentsScreen />}
      {view === 'journals' && <JournalsScreen />}
      {view === 'customers' && <CustomersScreen sessionToken={user?.token ?? ''} />}
      {view === 'suppliers' && <SuppliersScreen sessionToken={user?.token ?? ''} />}
      {view === 'purchases' && procurementCapabilities && (
        <PurchasesScreen
          sessionToken={user?.token ?? ''}
          capabilities={procurementCapabilities}
          openFiscalPeriodId={openFiscalPeriod?.id ?? null}
        />
      )}
    </AppShell>
    </NotificationsProvider>
  );
}
