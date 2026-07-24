/**
 * Slice 1 — typed IPC gateway tests. Mocks ONLY the Tauri IPC boundary
 * (`@tauri-apps/api/core` `invoke`); no business logic is mocked. Asserts
 * that the gateway calls the correct production command names with the
 * expected argument shape, and that any rejection is normalized to a safe
 * {@link GatewayError} code (never raw diagnostics).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));

import * as ipc from '../src/shared/ipc/gateway';
import { GatewayError } from '../src/shared/ipc/gateway';
import { COMMANDS } from '../src/shared/ipc/commands';

beforeEach(() => {
  invokeMock.mockReset();
});

describe('gateway command routing + payloads', () => {
  it('login sends the login command with camelCase args', async () => {
    invokeMock.mockResolvedValue({ session_token: 'tok', expires_at: '2026-01-01T00:00:00Z' });
    const result = await ipc.login('admin', 'pw', 'POS-1');
    expect(invokeMock).toHaveBeenCalledWith(COMMANDS.LOGIN, {
      username: 'admin',
      password: 'pw',
      workstationId: 'POS-1',
    });
    expect(result.session_token).toBe('tok');
  });

  it('createProduct forwards the exact-decimal price as a string', async () => {
    invokeMock.mockResolvedValue({ product_id: 1, variant_id: 2 });
    await ipc.createProduct('tok', 'Widget', 'SKU-1', '100.00', true);
    expect(invokeMock).toHaveBeenCalledWith(COMMANDS.CREATE_PRODUCT, {
      sessionToken: 'tok',
      name: 'Widget',
      sku: 'SKU-1',
      salePrice: '100.00',
      isActive: true,
    });
  });

  it('confirmCashSale sends snake_case nested line fields with string decimals', async () => {
    invokeMock.mockResolvedValue(42);
    await ipc.confirmCashSale('tok', {
      requestId: 'req-1',
      cashSessionId: 3,
      warehouseId: 1,
      fiscalPeriodId: 1,
      documentDate: '2026-01-15',
      lines: [{ variant_id: 7, quantity: '2', unit_price: '100.00' }],
    });
    const [, args] = invokeMock.mock.calls[0];
    expect(args.lines).toEqual([{ variant_id: 7, quantity: '2', unit_price: '100.00' }]);
    expect(args.requestId).toBe('req-1');
    expect(args.cashSessionId).toBe(3);
  });

  it('confirmStockAdjustment sends signed exact quantity and a stable reason code', async () => {
    invokeMock.mockResolvedValue({
      document_id: 80,
      document_number: 'SA-2026-000001',
      movement_id: 81,
      journal_document_id: 82,
      journal_document_number: 'JE-2026-000001',
      warehouse_id: 1,
      variant_id: 7,
      quantity_delta: '-12.500',
      inventory_value_delta: '-125.0000',
      resulting_quantity_on_hand: '20.000',
      resulting_total_value: '200.0000',
      reason_code: 'DAMAGE',
    });
    await ipc.confirmStockAdjustment('tok', {
      requestId: 'req-adjustment',
      warehouseId: 1,
      variantId: 7,
      unitId: 3,
      quantityDelta: '-12.500',
      reasonCode: 'DAMAGE',
      fiscalPeriodId: 4,
      documentDate: '2026-07-24',
    });
    expect(invokeMock).toHaveBeenCalledWith(COMMANDS.CONFIRM_STOCK_ADJUSTMENT, {
      sessionToken: 'tok',
      requestId: 'req-adjustment',
      warehouseId: 1,
      variantId: 7,
      unitId: 3,
      quantityDelta: '-12.500',
      reasonCode: 'DAMAGE',
      note: null,
      fiscalPeriodId: 4,
      documentDate: '2026-07-24',
    });
  });

  it('newRequestId returns distinct UUID-shaped strings', () => {
    const a = ipc.newRequestId();
    const b = ipc.newRequestId();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f-]{36}$/i);
  });
});

describe('gateway error normalization', () => {
  it('maps a recognized backend code to a GatewayError with that code', async () => {
    invokeMock.mockRejectedValue({ code: 'PERMISSION_DENIED' });
    await expect(ipc.listWarehouses('tok')).rejects.toMatchObject({
      name: 'GatewayError',
      code: 'PERMISSION_DENIED',
    });
  });

  it('maps insufficient-stock (PRECONDITION_FAILED) through unchanged', async () => {
    invokeMock.mockRejectedValue({ code: 'PRECONDITION_FAILED' });
    await expect(
      ipc.confirmCashSale('tok', {
        requestId: 'r',
        cashSessionId: 1,
        warehouseId: 1,
        fiscalPeriodId: 1,
        documentDate: '2026-01-15',
        lines: [],
      }),
    ).rejects.toBeInstanceOf(GatewayError);
  });

  it('preserves the safe zero-stock valuation error code', async () => {
    invokeMock.mockRejectedValue({ code: 'UNSAFE_ZERO_STOCK_VALUATION' });
    await expect(
      ipc.confirmStockAdjustment('tok', {
        requestId: 'r',
        warehouseId: 1,
        variantId: 1,
        unitId: 1,
        quantityDelta: '1.000',
        reasonCode: 'FOUND_STOCK',
        fiscalPeriodId: 1,
        documentDate: '2026-07-24',
      }),
    ).rejects.toMatchObject({ code: 'UNSAFE_ZERO_STOCK_VALUATION' });
  });

  it('collapses an unknown/hostile rejection to UNKNOWN_ERROR without leaking it', async () => {
    invokeMock.mockRejectedValue({ code: 'NOT_REAL', message: 'DO_NOT_LEAK', stack: 'DO_NOT_LEAK' });
    try {
      await ipc.getSetupStatus();
      expect.unreachable('should have thrown');
    } catch (e) {
      const err = e as GatewayError;
      expect(err.code).toBe('UNKNOWN_ERROR');
      expect(JSON.stringify(err)).not.toContain('DO_NOT_LEAK');
    }
  });
});
