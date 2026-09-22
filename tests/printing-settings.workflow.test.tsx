import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));

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
  shop_legal_name: null,
  shop_email: null,
  shop_website: null,
  tax_id_nif: null,
  tax_id_nis: null,
  trade_register_rc: null,
  article_imposition_ai: null,
  bank_account_rib: null,
  logo_file_name: null,
  logo_updated_at: null,
  print_language: 'FOLLOW_APP',
  show_logo: true,
  show_email: true,
  show_website: false,
  show_rib: false,
  amount_in_words: true,
  a4_footer_note: null,
};

function renderScreen(locale: 'en' | 'fr' | 'ar' = 'en') {
  render(
    <I18nProvider initialLocale={locale}>
      <PrintingSettingsScreen sessionToken="test-session-token" />
    </I18nProvider>,
  );
}

beforeEach(async () => {
  invokeMock.mockReset();
  const { open } = await import('@tauri-apps/plugin-dialog');
  vi.mocked(open).mockReset();
  cleanup();
});

describe('WS-F-2 Printing Settings workflow', () => {
  it('loads and shows the saved values from a mocked get_printing_settings', async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === 'get_printing_settings') {
        return Promise.resolve(MOCK_SETTINGS);
      }
      if (command === 'get_company_logo') {
        return Promise.resolve(null);
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
      if (command === 'get_company_logo') {
        return Promise.resolve(null);
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
      if (command === 'get_company_logo') {
        return Promise.resolve(null);
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
      settings: {
        receipt_printing_enabled: true,
        receipt_target: 'THERMAL',
        thermal_printer_name: 'Epson-TM-T20',
        thermal_columns: 48,
        shop_name: 'Updated Store Name',
        shop_address: '10 Rue de la Paix',
        shop_phone: '0550123456',
        receipt_footer: 'Merci de votre visite',
        shop_legal_name: null,
        shop_email: null,
        shop_website: null,
        tax_id_nif: null,
        tax_id_nis: null,
        trade_register_rc: null,
        article_imposition_ai: null,
        bank_account_rib: null,
        a4_footer_note: null,
        print_language: 'FOLLOW_APP',
        show_logo: true,
        show_email: true,
        show_website: false,
        show_rib: false,
        amount_in_words: true,
      },
    });
  });

  it('choosing a logo calls set_company_logo then refreshes the preview via get_company_logo', async () => {
    const { open } = await import('@tauri-apps/plugin-dialog');
    vi.mocked(open).mockResolvedValueOnce('C:\\Users\\test\\logo.png');

    let logoAfterUpload: string | null = null;
    let setLogoCalls = 0;
    invokeMock.mockImplementation((command: string) => {
      if (command === 'get_printing_settings') {
        return Promise.resolve(MOCK_SETTINGS);
      }
      if (command === 'get_company_logo') {
        return Promise.resolve(logoAfterUpload);
      }
      if (command === 'set_company_logo') {
        setLogoCalls += 1;
        logoAfterUpload = 'data:image/png;base64,Zm9v';
        return Promise.resolve({ ...MOCK_SETTINGS, logo_file_name: 'logo.png' });
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    renderScreen();

    const chooseButton = await screen.findByTestId('logo-choose');
    fireEvent.click(chooseButton);

    await waitFor(() => expect(setLogoCalls).toBe(1));
    await waitFor(() => expect(screen.getByAltText('Logo')).toBeInTheDocument());
  });

  it('removing the logo calls clear_company_logo and clears the preview', async () => {
    const { open } = await import('@tauri-apps/plugin-dialog');
    vi.mocked(open).mockResolvedValue(null);

    let logo: string | null = 'data:image/png;base64,Zm9v';
    let clearCalls = 0;
    invokeMock.mockImplementation((command: string) => {
      if (command === 'get_printing_settings') {
        return Promise.resolve({ ...MOCK_SETTINGS, logo_file_name: 'logo.png' });
      }
      if (command === 'get_company_logo') {
        return Promise.resolve(logo);
      }
      if (command === 'clear_company_logo') {
        clearCalls += 1;
        logo = null;
        return Promise.resolve(MOCK_SETTINGS);
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    renderScreen();

    const removeButton = await screen.findByTestId('logo-remove');
    fireEvent.click(removeButton);

    await waitFor(() => expect(clearCalls).toBe(1));
    await waitFor(() => expect(screen.queryByTestId('logo-remove')).not.toBeInTheDocument());
  });

  it('cancelling the logo picker calls no logo command', async () => {
    const { open } = await import('@tauri-apps/plugin-dialog');
    vi.mocked(open).mockResolvedValueOnce(null);

    invokeMock.mockImplementation((command: string) => {
      if (command === 'get_printing_settings') {
        return Promise.resolve(MOCK_SETTINGS);
      }
      if (command === 'get_company_logo') {
        return Promise.resolve(null);
      }
      if (command === 'set_company_logo' || command === 'clear_company_logo') {
        throw new Error(`${command} must not be called when the picker is cancelled`);
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    renderScreen();

    const chooseButton = await screen.findByTestId('logo-choose');
    fireEvent.click(chooseButton);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByTestId('logo-remove')).not.toBeInTheDocument();
  });

  it('an invalid e-mail blocks the save call', async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === 'get_printing_settings') {
        return Promise.resolve(MOCK_SETTINGS);
      }
      if (command === 'get_company_logo') {
        return Promise.resolve(null);
      }
      if (command === 'save_printing_settings') {
        throw new Error('save_printing_settings must not be called with an invalid email');
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    renderScreen();

    const emailInput = (await screen.findByTestId('shop-email')) as HTMLInputElement;
    fireEvent.change(emailInput, { target: { value: 'not-an-email' } });

    const saveButton = screen.getByTestId('printing-save');
    fireEvent.click(saveButton);

    await screen.findByText('Invalid e-mail address.');
  });
});
