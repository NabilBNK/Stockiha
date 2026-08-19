import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { confirmDirectPurchase } from '../src/shared/ipc/directPurchaseGateway';
import type {
  ConfirmDirectPurchasePayload,
  ConfirmDirectPurchaseResult,
} from '../src/shared/ipc/directPurchaseDto';

const STORAGE_KEY = 'stockiha.pendingDirectPurchase';

const result: ConfirmDirectPurchaseResult = {
  document_id: 901,
  document_number: 'PR-2026-000001',
  receipt_origin: 'DIRECT_PURCHASE',
  purchase_order_id: null,
  purchase_order_number: null,
  supplier_id: 1,
  warehouse_id: 2,
  total_amount: '1000.00',
  journal_document_id: 902,
  journal_document_number: 'JE-2026-000001',
  order_status: null,
  posted_at: '2026-08-16T12:00:00Z',
};

function payload(requestId: string, unitCost = '100.00'): ConfirmDirectPurchasePayload {
  return {
    request_id: requestId,
    supplier_id: 1,
    warehouse_id: 2,
    fiscal_period_id: 3,
    document_date: '2026-08-16',
    note: null,
    lines: [{
      variant_id: 7,
      unit_id: 1,
      quantity_received: '10',
      unit_cost: unitCost,
    }],
  };
}

function sentRequestId(callIndex: number): string {
  const args = invokeMock.mock.calls[callIndex][1] as {
    payload: ConfirmDirectPurchasePayload;
  };
  return args.payload.request_id;
}

describe('Direct Purchase gateway idempotency', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    window.localStorage.removeItem(STORAGE_KEY);
  });

  it('reuses the original request id after an uncertain failure and clears it after confirmed success', async () => {
    invokeMock
      .mockRejectedValueOnce({ code: 'INTERNAL_ERROR' })
      .mockResolvedValueOnce(result)
      .mockResolvedValueOnce({ ...result, document_id: 910, document_number: 'PR-2026-000002' });

    await expect(confirmDirectPurchase('tok', payload('request-A'))).rejects.toBeDefined();

    // The UI may create a fresh candidate request id on retry. The gateway must
    // keep the original id for the unchanged outcome-unknown purchase intent.
    await expect(confirmDirectPurchase('tok', payload('request-B'))).resolves.toEqual(result);

    expect(invokeMock.mock.calls[0][0]).toBe('confirm_direct_purchase');
    expect(sentRequestId(0)).toBe('request-A');
    expect(sentRequestId(1)).toBe('request-A');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();

    // A confirmed success ends the idempotency retry window. A deliberate new
    // purchase with identical values therefore uses its new request id.
    await confirmDirectPurchase('tok', payload('request-C'));
    expect(sentRequestId(2)).toBe('request-C');
  });

  it('uses a new request id when the purchase intent changes after a failure', async () => {
    invokeMock
      .mockRejectedValueOnce({ code: 'INTERNAL_ERROR' })
      .mockResolvedValueOnce(result);

    await expect(confirmDirectPurchase('tok', payload('request-A', '100.00'))).rejects.toBeDefined();
    await confirmDirectPurchase('tok', payload('request-B', '110.00'));

    expect(sentRequestId(0)).toBe('request-A');
    expect(sentRequestId(1)).toBe('request-B');
  });
});