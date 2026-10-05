import { describe, it, expect, vi, beforeEach } from 'vitest';

const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { COMMANDS } from '../src/shared/ipc/commands';
import {
  getDashboardPeriod,
  getDashboardMoneySummary,
  getDashboardStockSummary,
  listDashboardStockItems,
  listDashboardTopItems,
  listDashboardTopCustomers,
  listDashboardTopDebtors,
  listDashboardLatestSales,
  getDashboardSalesSeries,
  getDashboardSalesByCategory,
  getDashboardBusyHours,
  getDashboardReceivablesAging,
} from '../src/shared/ipc/dashboardGateway';
import type { DashboardWindow } from '../src/shared/ipc/dashboardDto';

beforeEach(() => {
  invokeMock.mockReset();
});

describe('dashboardGateway (T-T1)', () => {
  it('getDashboardPeriod calls DASHBOARD_GET_PERIOD with exact arguments', async () => {
    const mockPeriod = {
      cur_from: '2026-09-01',
      cur_to: '2026-09-24',
      prev_from: '2026-08-01',
      prev_to: '2026-08-24',
      cut_time: '12:00:00',
      bucket: 'DAY',
      today: '2026-09-24',
    };
    invokeMock.mockResolvedValue(mockPeriod);

    const result = await getDashboardPeriod('tok', 'custom', '2026-09-01', '2026-09-24');
    expect(invokeMock).toHaveBeenCalledWith(COMMANDS.DASHBOARD_GET_PERIOD, {
      sessionToken: 'tok',
      period: 'custom',
      from: '2026-09-01',
      to: '2026-09-24',
    });
    expect(result).toEqual(mockPeriod);
  });

  it('getDashboardPeriod passes null for optional from and to when omitted', async () => {
    invokeMock.mockResolvedValue({});
    await getDashboardPeriod('tok', 'month');
    expect(invokeMock).toHaveBeenCalledWith(COMMANDS.DASHBOARD_GET_PERIOD, {
      sessionToken: 'tok',
      period: 'month',
      from: null,
      to: null,
    });
  });

  it('getDashboardMoneySummary calls DASHBOARD_GET_MONEY_SUMMARY with exact arguments', async () => {
    const mockSummary = { sales: '58500.00' };
    invokeMock.mockResolvedValue(mockSummary);

    const window: DashboardWindow = {
      curFrom: '2026-09-01',
      curTo: '2026-09-24',
      prevFrom: '2026-08-01',
      prevTo: '2026-08-24',
      cutTime: '12:00:00',
    };

    const result = await getDashboardMoneySummary('tok', window);
    expect(invokeMock).toHaveBeenCalledWith(COMMANDS.DASHBOARD_GET_MONEY_SUMMARY, {
      sessionToken: 'tok',
      curFrom: '2026-09-01',
      curTo: '2026-09-24',
      prevFrom: '2026-08-01',
      prevTo: '2026-08-24',
      cutTime: '12:00:00',
    });
    expect(result).toEqual(mockSummary);
  });

  it('getDashboardStockSummary calls DASHBOARD_GET_STOCK_SUMMARY with exact arguments', async () => {
    invokeMock.mockResolvedValue({ stock_value: '40800.00' });
    const result = await getDashboardStockSummary('tok', 90);
    expect(invokeMock).toHaveBeenCalledWith(COMMANDS.DASHBOARD_GET_STOCK_SUMMARY, {
      sessionToken: 'tok',
      deadDays: 90,
    });
    expect(result).toEqual({ stock_value: '40800.00' });
  });

  it('listDashboardStockItems calls DASHBOARD_LIST_STOCK_ITEMS with exact arguments', async () => {
    invokeMock.mockResolvedValue([]);
    await listDashboardStockItems('tok', 'low', 90, 25, 0);
    expect(invokeMock).toHaveBeenCalledWith(COMMANDS.DASHBOARD_LIST_STOCK_ITEMS, {
      sessionToken: 'tok',
      kind: 'low',
      deadDays: 90,
      limit: 25,
      offset: 0,
    });
  });

  it('listDashboardTopItems calls DASHBOARD_LIST_TOP_ITEMS with exact arguments', async () => {
    invokeMock.mockResolvedValue([]);
    await listDashboardTopItems('tok', '2026-09-01', '2026-09-24', 5);
    expect(invokeMock).toHaveBeenCalledWith(COMMANDS.DASHBOARD_LIST_TOP_ITEMS, {
      sessionToken: 'tok',
      from: '2026-09-01',
      to: '2026-09-24',
      limit: 5,
    });
  });

  it('listDashboardTopCustomers calls DASHBOARD_LIST_TOP_CUSTOMERS with exact arguments', async () => {
    invokeMock.mockResolvedValue([]);
    await listDashboardTopCustomers('tok', '2026-09-01', '2026-09-24');
    expect(invokeMock).toHaveBeenCalledWith(COMMANDS.DASHBOARD_LIST_TOP_CUSTOMERS, {
      sessionToken: 'tok',
      from: '2026-09-01',
      to: '2026-09-24',
    });
  });

  it('listDashboardTopDebtors calls DASHBOARD_LIST_TOP_DEBTORS with exact arguments', async () => {
    invokeMock.mockResolvedValue([]);
    await listDashboardTopDebtors('tok');
    expect(invokeMock).toHaveBeenCalledWith(COMMANDS.DASHBOARD_LIST_TOP_DEBTORS, {
      sessionToken: 'tok',
    });
  });

  it('listDashboardLatestSales calls DASHBOARD_LIST_LATEST_SALES with exact arguments', async () => {
    invokeMock.mockResolvedValue([]);
    await listDashboardLatestSales('tok');
    expect(invokeMock).toHaveBeenCalledWith(COMMANDS.DASHBOARD_LIST_LATEST_SALES, {
      sessionToken: 'tok',
    });
  });

  it('getDashboardSalesSeries calls DASHBOARD_GET_SALES_SERIES with exact arguments', async () => {
    invokeMock.mockResolvedValue([]);
    await getDashboardSalesSeries('tok', '2026-09-01', '2026-09-24', 'DAY');
    expect(invokeMock).toHaveBeenCalledWith(COMMANDS.DASHBOARD_GET_SALES_SERIES, {
      sessionToken: 'tok',
      from: '2026-09-01',
      to: '2026-09-24',
      bucket: 'DAY',
    });
  });

  it('getDashboardSalesByCategory calls DASHBOARD_GET_SALES_BY_CATEGORY with exact arguments', async () => {
    invokeMock.mockResolvedValue([]);
    await getDashboardSalesByCategory('tok', '2026-09-01', '2026-09-24');
    expect(invokeMock).toHaveBeenCalledWith(COMMANDS.DASHBOARD_GET_SALES_BY_CATEGORY, {
      sessionToken: 'tok',
      from: '2026-09-01',
      to: '2026-09-24',
    });
  });

  it('getDashboardBusyHours calls DASHBOARD_GET_BUSY_HOURS with exact arguments', async () => {
    invokeMock.mockResolvedValue([]);
    await getDashboardBusyHours('tok', '2026-09-01', '2026-09-24');
    expect(invokeMock).toHaveBeenCalledWith(COMMANDS.DASHBOARD_GET_BUSY_HOURS, {
      sessionToken: 'tok',
      from: '2026-09-01',
      to: '2026-09-24',
    });
  });

  it('getDashboardReceivablesAging calls DASHBOARD_GET_RECEIVABLES_AGING with exact arguments', async () => {
    invokeMock.mockResolvedValue([]);
    await getDashboardReceivablesAging('tok');
    expect(invokeMock).toHaveBeenCalledWith(COMMANDS.DASHBOARD_GET_RECEIVABLES_AGING, {
      sessionToken: 'tok',
    });
  });

  it('propagates GatewayError on backend failure', async () => {
    invokeMock.mockRejectedValue({ code: 'SESSION_INVALID', message: 'Session expired' });
    await expect(getDashboardPeriod('bad_tok', 'today')).rejects.toThrow();
  });
});
