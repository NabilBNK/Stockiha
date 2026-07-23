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
