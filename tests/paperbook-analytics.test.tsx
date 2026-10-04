import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

// Mock gateway
vi.mock('../src/shared/ipc/gateway', () => ({
  paperbookGetAnalyticsReport: vi.fn(),
}));

import { AnalyticsTab } from '../src/features/paperbook/AnalyticsTab';
import * as gateway from '../src/shared/ipc/gateway';
import type { PaperBookAnalyticsPayloadDto } from '../src/shared/ipc/dto';
import { I18nProvider } from '../src/shared/i18n';

const mockReport: PaperBookAnalyticsPayloadDto = {
  summary: {
    sell_total: '250000.00',
    buy_total: '180000.00',
    expense_total: '12500.00',
    benefit_total: '62500.00',
    net_profit: '50000.00',
    margin_rate: '25.0',
    unpaid_sell_total: '15000.00',
    unpaid_buy_total: '8000.00',
    sell_count: 140,
    buy_count: 45,
    expense_count: 22,
  },
  monthly: [
    {
      year_month: '2025-01',
      month_date: '2025-01-01',
      sell_total: '120000.00',
      benefit_total: '30000.00',
      expense_total: '6000.00',
      net_profit: '24000.00',
      buy_total: '90000.00',
      unpaid_sell_total: '5000.00',
      txn_count: 70,
    },
    {
      year_month: '2025-02',
      month_date: '2025-02-01',
      sell_total: '130000.00',
      benefit_total: '32500.00',
      expense_total: '6500.00',
      net_profit: '26000.00',
      buy_total: '90000.00',
      unpaid_sell_total: '10000.00',
      txn_count: 70,
    },
  ],
  top_products: [
    {
      product_label: 'Huile Elio 5L',
      total_qty: '350',
      total_revenue: '75000.00',
      txn_count: 48,
      avg_price: '214.29',
    },
    {
      product_label: 'Sucre Cevital 1kg',
      total_qty: '500',
      total_revenue: '50000.00',
      txn_count: 62,
      avg_price: '100.00',
    },
  ],
  top_customers: [
    {
      party_label: 'Alimentation Salem',
      total_amount: '85000.00',
      unpaid_amount: '12000.00',
      txn_count: 18,
    },
  ],
  top_suppliers: [
    {
      party_label: 'Grossiste Blida',
      total_amount: '140000.00',
      unpaid_amount: '8000.00',
      txn_count: 8,
    },
  ],
  top_brands: [
    {
      brand_label: 'Cevital',
      total_qty: '850',
      total_revenue: '125000.00',
      txn_count: 110,
    },
  ],
  expenses: [
    {
      category_label: 'Transport',
      total_amount: '7500.00',
      txn_count: 12,
      percent_of_total: '60.0',
    },
    {
      category_label: 'Electricite',
      total_amount: '5000.00',
      txn_count: 2,
      percent_of_total: '40.0',
    },
  ],
};

describe('WS-P-2 AnalyticsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(gateway.paperbookGetAnalyticsReport).mockResolvedValue(mockReport);
  });

  afterEach(() => {
    cleanup();
  });

  it('loads and renders headline KPI cards and leaderboards', async () => {
    render(
      <I18nProvider>
        <AnalyticsTab sessionToken="test-token" />
      </I18nProvider>,
    );

    // Initial query should be called with no dates (All History)
    expect(gateway.paperbookGetAnalyticsReport).toHaveBeenCalledWith('test-token', undefined, undefined);

    // Wait for data to render
    await waitFor(() => {
      expect(screen.getByText('250,000.00 DZD')).toBeInTheDocument();
    });

    // Check Gross Benefit and Margin
    expect(screen.getByText('62,500.00 DZD')).toBeInTheDocument();
    expect(screen.getByText(/25\.0%/)).toBeInTheDocument();

    // Check Net Profit
    expect(screen.getAllByText('50,000.00 DZD').length).toBeGreaterThanOrEqual(1);

    // Check Unpaid Sales and Purchases
    expect(screen.getByText('15,000.00 DZD')).toBeInTheDocument();
    expect(screen.getAllByText('8,000.00 DZD').length).toBeGreaterThanOrEqual(1);

    // Check Leaderboards
    expect(screen.getAllByText('Huile Elio 5L').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Alimentation Salem')).toBeInTheDocument();
    expect(screen.getByText('Grossiste Blida')).toBeInTheDocument();
    expect(screen.getAllByText('Cevital').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Transport').length).toBeGreaterThanOrEqual(1);
  });

  it('switches preset date filters and reloads data with date boundaries', async () => {
    render(
      <I18nProvider>
        <AnalyticsTab sessionToken="test-token" />
      </I18nProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('250,000.00 DZD')).toBeInTheDocument();
    });

    // Click 2025 preset button
    const btn2025 = screen.getByRole('button', { name: '2025' });
    fireEvent.click(btn2025);

    await waitFor(() => {
      expect(gateway.paperbookGetAnalyticsReport).toHaveBeenCalledWith(
        'test-token',
        '2025-01-01',
        '2025-12-31',
      );
    });

    // Click 2026 preset button
    const btn2026 = screen.getByRole('button', { name: '2026' });
    fireEvent.click(btn2026);

    await waitFor(() => {
      expect(gateway.paperbookGetAnalyticsReport).toHaveBeenCalledWith(
        'test-token',
        '2026-01-01',
        '2026-12-31',
      );
    });
  });

  it('exports CSV report cleanly without errors', async () => {
    // Mock URL.createObjectURL and click
    const createObjectURLMock = vi.fn().mockReturnValue('blob:test');
    const revokeObjectURLMock = vi.fn();
    window.URL.createObjectURL = createObjectURLMock;
    window.URL.revokeObjectURL = revokeObjectURLMock;

    render(
      <I18nProvider>
        <AnalyticsTab sessionToken="test-token" />
      </I18nProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('250,000.00 DZD')).toBeInTheDocument();
    });

    const exportBtn = screen.getByRole('button', { name: /csv/i });
    expect(exportBtn).toBeEnabled();
    fireEvent.click(exportBtn);

    expect(createObjectURLMock).toHaveBeenCalledTimes(1);
    expect(revokeObjectURLMock).toHaveBeenCalledTimes(1);
  });

  it('renders Best Sellers podium, Pareto bar, and toggles ranking modes', async () => {
    render(
      <I18nProvider>
        <AnalyticsTab sessionToken="test-token" />
      </I18nProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('250,000.00 DZD')).toBeInTheDocument();
    });

    // Verify Champion podium badge exists
    expect(screen.getByText(/#1 Champion/i)).toBeInTheDocument();

    // Verify Pareto concentration indicator exists
    expect(screen.getByText(/Sales Concentration/i)).toBeInTheDocument();

    // Verify mode toggle buttons exist and can be clicked
    const qtyModeBtn = screen.getByRole('button', { name: /By Quantity/i });
    expect(qtyModeBtn).toBeInTheDocument();
    fireEvent.click(qtyModeBtn);

    const txnsModeBtn = screen.getByRole('button', { name: /By Order Frequency/i });
    expect(txnsModeBtn).toBeInTheDocument();
    fireEvent.click(txnsModeBtn);

    const revModeBtn = screen.getByRole('button', { name: /By Revenue/i });
    expect(revModeBtn).toBeInTheDocument();
    fireEvent.click(revModeBtn);
  });
});
