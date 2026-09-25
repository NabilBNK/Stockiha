// WS-I-1 §5.9 — the Reports screen: a top tab row (only "Sales" exists in
// WS-I-1; later sub-plans add "Finance", "Stock") and, inside Sales, a
// secondary row for each sales sub-report. The active sub-report survives a
// remount via sessionStorage (not a report's data, only which one is open).

import { useState } from 'react';

import type { AppView } from '../../app/AppShell';
import { useReportCopy } from './common/reportCopy';
import { SalesSummaryReport } from './sales/SalesSummaryReport';
import { SalesOverTimeReport } from './sales/SalesOverTimeReport';
import { SalesByProductReport } from './sales/SalesByProductReport';
import { BestSellersReport } from './sales/BestSellersReport';
import { SalesByCategoryReport } from './sales/SalesByCategoryReport';
import { SalesByCashierReport } from './sales/SalesByCashierReport';
import { BusyHoursReport } from './sales/BusyHoursReport';
import { MarginAlertsReport } from './sales/MarginAlertsReport';

const STORAGE_KEY = 'stockiha.reports.lastTab';

type SalesSubId =
  | 'summary'
  | 'over-time'
  | 'by-product'
  | 'best-sellers'
  | 'by-category'
  | 'by-cashier'
  | 'busy-hours'
  | 'margin-alerts';

const SALES_SUB_IDS: SalesSubId[] = [
  'summary',
  'over-time',
  'by-product',
  'best-sellers',
  'by-category',
  'by-cashier',
  'busy-hours',
  'margin-alerts',
];

function readLastTab(): { tab: string; sub: string } {
  try {
    const stored = window.sessionStorage.getItem(STORAGE_KEY);
    if (stored) {
      const [tab, sub] = stored.split('/');
      if (tab === 'sales' && SALES_SUB_IDS.includes(sub as SalesSubId)) return { tab, sub };
    }
  } catch {
    // sessionStorage unavailable (e.g. private mode) — fall through to default.
  }
  return { tab: 'sales', sub: 'summary' };
}

export function ReportsScreen({ setView }: { setView: (v: AppView) => void }) {
  // `setView` is part of this screen's declared contract (plan §5.9) because
  // a later sub-plan's "Prepare purchase" action (WS-I-3, A12) navigates
  // away from Reports to the Purchases screen. Unused in WS-I-1 itself.
  void setView;
  const copy = useReportCopy();
  const [{ tab, sub }, setActive] = useState(readLastTab);

  function selectSub(nextSub: SalesSubId) {
    setActive({ tab: 'sales', sub: nextSub });
    try {
      window.sessionStorage.setItem(STORAGE_KEY, `sales/${nextSub}`);
    } catch {
      // Best effort only.
    }
  }

  return (
    <div className="sk-reports-screen">
      <div className="sk-reports-screen__tabs" role="tablist">
        <button type="button" className="sk-btn sk-btn--primary" data-testid="reports-tab-sales" aria-selected={tab === 'sales'}>
          {copy.tabSales}
        </button>
      </div>
      <div className="sk-reports-screen__subtabs">
        {SALES_SUB_IDS.map((id) => (
          <button
            key={id}
            type="button"
            data-testid={`reports-sub-${id}`}
            className={sub === id ? 'sk-btn sk-btn--primary' : 'sk-btn sk-btn--secondary'}
            onClick={() => selectSub(id)}
          >
            {SUB_LABEL(id, copy)}
          </button>
        ))}
      </div>
      {sub === 'summary' && <SalesSummaryReport />}
      {sub === 'over-time' && <SalesOverTimeReport />}
      {sub === 'by-product' && <SalesByProductReport />}
      {sub === 'best-sellers' && <BestSellersReport />}
      {sub === 'by-category' && <SalesByCategoryReport />}
      {sub === 'by-cashier' && <SalesByCashierReport />}
      {sub === 'busy-hours' && <BusyHoursReport />}
      {sub === 'margin-alerts' && <MarginAlertsReport />}
    </div>
  );
}

function SUB_LABEL(id: SalesSubId, copy: Record<string, string>): string {
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
    default:
      return id;
  }
}
