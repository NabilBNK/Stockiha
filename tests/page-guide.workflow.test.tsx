import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PageGuideModal } from '../src/app/PageGuideModal';
import { I18nProvider } from '../src/shared/i18n';
import type { AppView } from '../src/app/AppShell';

const ALL_VIEWS: AppView[] = [
  'dashboard',
  'settings',
  'historical_finance',
  'opening_state',
  'opening_state_application',
  'products',
  'catalogueSetup',
  'inventory',
  'stock',
  'adjustment',
  'pos',
  'session',
  'documents',
  'journals',
  'customers',
  'suppliers',
  'purchases',
  'reports',
];

describe('PageGuideModal', () => {
  it('renders for every view without crashing in FR, AR, and EN', () => {
    for (const locale of ['fr', 'ar', 'en'] as const) {
      for (const view of ALL_VIEWS) {
        const { unmount } = render(
          <I18nProvider initialLocale={locale}>
            <PageGuideModal view={view} onClose={() => {}} />
          </I18nProvider>
        );
        expect(screen.getByTestId('page-guide-modal')).toBeInTheDocument();
        expect(screen.getByTestId('page-guide-close-btn')).toBeInTheDocument();
        unmount();
      }
    }
  });

  it('closes on close button click and escape key', () => {
    const onClose = vi.fn();
    render(
      <I18nProvider initialLocale="fr">
        <PageGuideModal view="dashboard" onClose={onClose} />
      </I18nProvider>
    );

    fireEvent.click(screen.getByTestId('page-guide-close-btn'));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);

    // Clicking overlay backdrop
    fireEvent.click(screen.getByTestId('page-guide-modal'));
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});
