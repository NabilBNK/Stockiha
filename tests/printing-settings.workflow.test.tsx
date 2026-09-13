import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));

import { PrintingSettingsScreen } from '../src/features/settings/PrintingSettingsScreen';
import { I18nProvider } from '../src/shared/i18n';
import type { PrintingSettingsDto } from '../src/shared/ipc/dto';

const MOCK_SETTINGS: PrintingSettingsDto = {
  receipt_printing_enabled: true,
  receipt_target: 'THERMAL',
  thermal_printer_name: 'Epson-TM-T20',
  thermal_columns: 48,
  shop_name: 'My Store',
  shop_address: '10 Rue de la Paix',
  shop_phone: '0550123456',
  receipt_footer: 'Merci de votre visite',
  updated_at: '2026-09-13T10:00:00Z',
};

function renderScreen(locale: 'en' | 'fr' | 'ar' = 'en') {
  render(
    <I18nProvider initialLocale={locale}>
      <PrintingSettingsScreen sessionToken="test-session-token" />
    </I18nProvider>,
  );
}

beforeEach(() => {
  invokeMock.mockReset();
  cleanup();
});

describe('WS-F-2 Printing Settings workflow', () => {
  it('loads and shows the saved values from a mocked get_printing_settings', async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === 'get_printing_settings') {
        return Promise.resolve(MOCK_SETTINGS);
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    renderScreen();

    const enabled = (await screen.findByTestId('printing-enabled')) as HTMLInputElement;
    expect(enabled.checked).toBe(true);

    const target = screen.getByTestId('printing-target') as HTMLSelectElement;
    expect(target.value).toBe('THERMAL');

    const printerName = screen.getByTestId('printing-printer-name') as HTMLInputElement;
    expect(printerName.value).toBe('Epson-TM-T20');

    const columns = screen.getByTestId('printing-columns') as HTMLSelectElement;
    expect(columns.value).toBe('48');

    const shopName = screen.getByTestId('printing-shop-name') as HTMLInputElement;
    expect(shopName.value).toBe('My Store');

    const shopAddress = screen.getByTestId('printing-shop-address') as HTMLInputElement;
    expect(shopAddress.value).toBe('10 Rue de la Paix');

    const shopPhone = screen.getByTestId('printing-shop-phone') as HTMLInputElement;
    expect(shopPhone.value).toBe('0550123456');

    const footer = screen.getByTestId('printing-footer') as HTMLInputElement;
    expect(footer.value).toBe('Merci de votre visite');
  });

  it('changing the target to A4 hides printing-printer-name', async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === 'get_printing_settings') {
        return Promise.resolve(MOCK_SETTINGS);
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    renderScreen();

    await screen.findByTestId('printing-enabled');
    expect(screen.getByTestId('printing-printer-name')).toBeInTheDocument();

    const targetSelect = screen.getByTestId('printing-target');
    fireEvent.change(targetSelect, { target: { value: 'A4' } });

    expect(screen.queryByTestId('printing-printer-name')).not.toBeInTheDocument();
  });

  it('clicking printing-save calls save_printing_settings once with the values currently in the form', async () => {
    let capturedArgs: Record<string, unknown> | null = null;
    invokeMock.mockImplementation((command: string, args: Record<string, unknown>) => {
      if (command === 'get_printing_settings') {
        return Promise.resolve(MOCK_SETTINGS);
      }
      if (command === 'save_printing_settings') {
        capturedArgs = args;
        return Promise.resolve({
          ...MOCK_SETTINGS,
          shop_name: 'Updated Store Name',
        });
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    renderScreen();

    const shopNameInput = (await screen.findByTestId('printing-shop-name')) as HTMLInputElement;
    fireEvent.change(shopNameInput, { target: { value: 'Updated Store Name' } });

    const saveButton = screen.getByTestId('printing-save');
    fireEvent.click(saveButton);

    await waitFor(() => expect(capturedArgs).not.toBeNull());
    expect(capturedArgs).toEqual({
      sessionToken: 'test-session-token',
      receiptPrintingEnabled: true,
      receiptTarget: 'THERMAL',
      thermalPrinterName: 'Epson-TM-T20',
      thermalColumns: 48,
      shopName: 'Updated Store Name',
      shopAddress: '10 Rue de la Paix',
      shopPhone: '0550123456',
      receiptFooter: 'Merci de votre visite',
    });
  });
});
