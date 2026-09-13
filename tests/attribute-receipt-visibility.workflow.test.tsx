import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));

import { AttributesManager } from '../src/features/catalogue-setup/AttributesManager';
import { setAttributeVisibleOnReceipt } from '../src/shared/ipc/gateway';
import { I18nProvider } from '../src/shared/i18n';
import type { AttributeValueLifecycleItem, ReferenceLifecycleItem } from '../src/shared/ipc/dto';

const MOCK_ATTRIBUTES: ReferenceLifecycleItem[] = [
  { id: 1, name: 'Taille', is_active: true, visible_on_receipt: true, usage_count: 5 },
  { id: 2, name: 'Marque', is_active: true, visible_on_receipt: false, usage_count: 3 },
];

const MOCK_VALUES: AttributeValueLifecycleItem[] = [
  { id: 10, attribute_id: 1, attribute_name: 'Taille', value: 'M', is_active: true, usage_count: 5 },
  { id: 20, attribute_id: 2, attribute_name: 'Marque', value: 'Dolz', is_active: true, usage_count: 3 },
];

beforeEach(() => {
  invokeMock.mockReset();
  cleanup();
});

describe('WS-F-3 Attribute Receipt Visibility', () => {
  it('renders receipt visibility toggle for each attribute and displays badge for hidden attributes', () => {
    render(
      <I18nProvider initialLocale="en">
        <AttributesManager
          attributes={MOCK_ATTRIBUTES}
          attributeValues={MOCK_VALUES}
          loading={false}
          error={null}
          onCreateAttribute={vi.fn()}
          onRenameAttribute={vi.fn()}
          onToggleAttributeActive={vi.fn()}
          onToggleAttributeVisibleOnReceipt={vi.fn()}
          onDeleteAttribute={vi.fn()}
          onAddValue={vi.fn()}
          onRenameValue={vi.fn()}
          onToggleValueActive={vi.fn()}
          onDeleteValue={vi.fn()}
        />
      </I18nProvider>,
    );

    const toggleAttr1 = screen.getByTestId('toggle-receipt-visible-1') as HTMLInputElement;
    const toggleAttr2 = screen.getByTestId('toggle-receipt-visible-2') as HTMLInputElement;

    expect(toggleAttr1.checked).toBe(true);
    expect(toggleAttr2.checked).toBe(false);

    // Attribute 2 has visible_on_receipt: false, so it shows the "Hidden on receipts" badge
    expect(screen.getByText('Hidden on receipts')).toBeInTheDocument();
  });

  it('clicking the receipt visibility toggle calls onToggleAttributeVisibleOnReceipt with new boolean value', async () => {
    const toggleFn = vi.fn().mockResolvedValue(undefined);

    render(
      <I18nProvider initialLocale="en">
        <AttributesManager
          attributes={MOCK_ATTRIBUTES}
          attributeValues={MOCK_VALUES}
          loading={false}
          error={null}
          onCreateAttribute={vi.fn()}
          onRenameAttribute={vi.fn()}
          onToggleAttributeActive={vi.fn()}
          onToggleAttributeVisibleOnReceipt={toggleFn}
          onDeleteAttribute={vi.fn()}
          onAddValue={vi.fn()}
          onRenameValue={vi.fn()}
          onToggleValueActive={vi.fn()}
          onDeleteValue={vi.fn()}
        />
      </I18nProvider>,
    );

    const toggleAttr1 = screen.getByTestId('toggle-receipt-visible-1');
    fireEvent.click(toggleAttr1);

    await waitFor(() => {
      expect(toggleFn).toHaveBeenCalledTimes(1);
      expect(toggleFn).toHaveBeenCalledWith(1, false);
    });
  });

  it('setAttributeVisibleOnReceipt gateway helper calls set_attribute_visible_on_receipt with correct arguments', async () => {
    invokeMock.mockResolvedValue(undefined);

    await setAttributeVisibleOnReceipt('token-123', 42, false);

    expect(invokeMock).toHaveBeenCalledWith('set_attribute_visible_on_receipt', {
      sessionToken: 'token-123',
      attributeId: 42,
      visibleOnReceipt: false,
    });
  });
});
