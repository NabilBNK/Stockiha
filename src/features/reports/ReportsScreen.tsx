// WS-I-1 §5.9 / WS-I-2 §6 — the Reports screen: a top tab row (Sales from
// WS-I-1; Finance, Money owed and Accounting added in WS-I-2) and, inside
// each tab, a secondary row for its sub-reports. The active tab/sub-report
// survives a remount via sessionStorage (not a report's data, only which
// one is open).

import { useState } from 'react';

import './reports.css';
import type { AppView } from '../../app/AppShell';
import { useReportCopy } from './common/reportCopy';
import type { Period } from './common/periods';
import { SalesSummaryReport } from './sales/SalesSummaryReport';
import { SalesOverTimeReport } from './sales/SalesOverTimeReport';
import { SalesByProductReport } from './sales/SalesByProductReport';
import { BestSellersReport } from './sales/BestSellersReport';
import { SalesByCategoryReport } from './sales/SalesByCategoryReport';
import { SalesByCashierReport } from './sales/SalesByCashierReport';
import { BusyHoursReport } from './sales/BusyHoursReport';
import { MarginAlertsReport } from './sales/MarginAlertsReport';
import { MonthlySummaryReport } from './finance/MonthlySummaryReport';
import { ProfitLossReport } from './finance/ProfitLossReport';
import { CashFlowReport } from './finance/CashFlowReport';
import { ReceivablesReport } from './finance/ReceivablesReport';
import { CustomerStatementReport } from './finance/CustomerStatementReport';
import { SuppliersReport } from './finance/SuppliersReport';
import { SupplierStatementReport } from './finance/SupplierStatementReport';
import { TrialBalanceReport } from './finance/TrialBalanceReport';
import { AccountLedgerReport } from './finance/AccountLedgerReport';

const STORAGE_KEY = 'stockiha.reports.lastTab';

type TabId = 'sales' | 'finance' | 'owed' | 'accounting';

const SALES_SUB_IDS = [
  'summary',
  'over-time',
  'by-product',
  'best-sellers',
  'by-category',
  'by-cashier',
  'busy-hours',
  'margin-alerts',
] as const;
const FINANCE_SUB_IDS = ['monthly-summary', 'profit-loss', 'cash-flow'] as const;
const OWED_SUB_IDS = ['receivables', 'customer-statement', 'suppliers', 'supplier-statement'] as const;
const ACCOUNTING_SUB_IDS = ['trial-balance', 'account-ledger'] as const;

const SUB_IDS_BY_TAB: Record<TabId, readonly string[]> = {
  sales: SALES_SUB_IDS,
  finance: FINANCE_SUB_IDS,
  owed: OWED_SUB_IDS,
  accounting: ACCOUNTING_SUB_IDS,
};

const DEFAULT_SUB_BY_TAB: Record<TabId, string> = {
  sales: 'summary',
  finance: 'monthly-summary',
  owed: 'receivables',
  accounting: 'trial-balance',
};

function readLastTab(): { tab: TabId; sub: string } {
  try {
    const stored = window.sessionStorage.getItem(STORAGE_KEY);
    if (stored) {
      const [tab, sub] = stored.split('/') as [TabId, string];
      if (SUB_IDS_BY_TAB[tab]?.includes(sub)) return { tab, sub };
    }
  } catch {
    // sessionStorage unavailable (e.g. private mode) — fall through to default.
  }
  return { tab: 'sales', sub: 'summary' };
}

export function ReportsScreen({ setView }: { setView: (v: AppView) => void }) {
  // `setView` is part of this screen's declared contract (plan §5.9) because
  // a later sub-plan's "Prepare purchase" action (WS-I-3, A12) navigates
  // away from Reports to the Purchases screen. Unused before WS-I-3.
  void setView;
  const copy = useReportCopy();
  const [{ tab, sub }, setActive] = useState(readLastTab);
  const [customerStatementPrefill, setCustomerStatementPrefill] =
    useState<{ customerId: number; period: Period } | null>(null);
  const [supplierStatementPrefill, setSupplierStatementPrefill] =
    useState<{ supplierId: number } | null>(null);

  function selectTab(nextTab: TabId) {
    selectSub(nextTab, DEFAULT_SUB_BY_TAB[nextTab]);
  }

  function selectSub(nextTab: TabId, nextSub: string) {
    setActive({ tab: nextTab, sub: nextSub });
    try {
      window.sessionStorage.setItem(STORAGE_KEY, `${nextTab}/${nextSub}`);
    } catch {
      // Best effort only.
    }
  }

  function openCustomerStatement(customerId: number, period: Period) {
    setCustomerStatementPrefill({ customerId, period });
    selectSub('owed', 'customer-statement');
  }

  function openSupplierStatement(supplierId: number) {
    setSupplierStatementPrefill({ supplierId });
    selectSub('owed', 'supplier-statement');
  }

  return (
    <div className="sk-reports-screen">
      <nav className="sk-view-switcher" role="tablist" aria-label={copy.reports} data-testid="reports-view-switcher">
        {(['sales', 'finance', 'owed', 'accounting'] as const).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            data-testid={`reports-tab-${id}`}
            className={`sk-view-switcher__item ${tab === id ? 'sk-view-switcher__item--active' : ''}`}
            aria-selected={tab === id}
            onClick={() => selectTab(id)}
          >
            {TAB_LABEL(id, copy)}
          </button>
        ))}
      </nav>
      <div className="sk-analytics-tabs" role="tablist">
        {SUB_IDS_BY_TAB[tab].map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            data-testid={`reports-sub-${id}`}
            aria-selected={sub === id}
            className={`sk-tab-btn ${sub === id ? 'sk-tab-btn--active' : ''}`}
            onClick={() => selectSub(tab, id)}
          >
            {SUB_LABEL(id, copy)}
          </button>
        ))}
      </div>
      {tab === 'sales' && sub === 'summary' && <SalesSummaryReport />}
      {tab === 'sales' && sub === 'over-time' && <SalesOverTimeReport />}
      {tab === 'sales' && sub === 'by-product' && <SalesByProductReport />}
      {tab === 'sales' && sub === 'best-sellers' && <BestSellersReport />}
      {tab === 'sales' && sub === 'by-category' && <SalesByCategoryReport />}
      {tab === 'sales' && sub === 'by-cashier' && <SalesByCashierReport />}
      {tab === 'sales' && sub === 'busy-hours' && <BusyHoursReport />}
      {tab === 'sales' && sub === 'margin-alerts' && <MarginAlertsReport />}

      {tab === 'finance' && sub === 'monthly-summary' && <MonthlySummaryReport />}
      {tab === 'finance' && sub === 'profit-loss' && <ProfitLossReport />}
      {tab === 'finance' && sub === 'cash-flow' && <CashFlowReport />}

      {tab === 'owed' && sub === 'receivables' && <ReceivablesReport onOpenStatement={openCustomerStatement} />}
      {tab === 'owed' && sub === 'customer-statement' && (
        <CustomerStatementReport
          initialCustomerId={customerStatementPrefill?.customerId ?? null}
          initialPeriod={customerStatementPrefill?.period ?? null}
        />
      )}
      {tab === 'owed' && sub === 'suppliers' && <SuppliersReport onOpenStatement={openSupplierStatement} />}
      {tab === 'owed' && sub === 'supplier-statement' && (
        <SupplierStatementReport initialSupplierId={supplierStatementPrefill?.supplierId ?? null} />
      )}

      {tab === 'accounting' && sub === 'trial-balance' && <TrialBalanceReport />}
      {tab === 'accounting' && sub === 'account-ledger' && <AccountLedgerReport />}
    </div>
  );
}

function TAB_LABEL(id: TabId, copy: Record<string, string>): string {
  switch (id) {
    case 'sales':
      return copy.tabSales;
    case 'finance':
      return copy.tabFinance;
    case 'owed':
      return copy.tabOwed;
    case 'accounting':
      return copy.tabAccounting;
    default:
      return id;
  }
}

function SUB_LABEL(id: string, copy: Record<string, string>): string {
  switch (id) {
    case 'summary':
      return copy.salesSummary;
    case 'over-time':
      return copy.salesOverTime;
    case 'by-product':
      return copy.salesByProduct;
    case 'best-sellers':
      return copy.bestSellers;
    case 'by-category':
      return copy.salesByCategory;
    case 'by-cashier':
      return copy.salesByCashier;
    case 'busy-hours':
      return copy.busyHours;
    case 'margin-alerts':
      return copy.marginAlerts;
    case 'monthly-summary':
      return copy.monthlySummary;
    case 'profit-loss':
      return copy.profitLoss;
    case 'cash-flow':
      return copy.cashFlow;
    case 'receivables':
      return copy.receivables;
    case 'customer-statement':
      return copy.customerStatement;
    case 'suppliers':
      return copy.suppliersBalances;
    case 'supplier-statement':
      return copy.supplierStatement;
    case 'trial-balance':
      return copy.trialBalance;
    case 'account-ledger':
      return copy.accountLedger;
    default:
      return id;
  }
}
