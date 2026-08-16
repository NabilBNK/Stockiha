import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { postPurchaseTransaction } from '../src/shared/ipc/gateway';
import type { PostPurchaseTransactionPayload, PostPurchaseTransactionResult } from '../src/shared/ipc/dto';

const STORAGE_KEY = 'stockiha.pendingPurchaseTransaction';

const result: PostPurchaseTransactionResult = {
  document_id: 900,
  document_number: 'PUR-2026-000001',
  status: 'POSTED',
  supplier_id: 1,
  warehouse_id: 1,
  gross_subtotal: '1000.00',
  discount_amount: '0.00',
  tax_amount: '0.00',
  total_amount: '1000.00',
  payment_status: 'UNPAID',
  payment_method: null,
  paid_amount: '0.00',
  outstanding_amount: '1000.00',
  child_documents: {
    purchase_order_id: null,
    goods_receipt_id: 901,
    supplier_invoice_id: 902,
    supplier_payment_id: null,
  },
  generation_status: 'QUEUED',
  print_status: 'QUEUED',
};

function payload(requestId: string, unitCost = '100.00'): PostPurchaseTransactionPayload {
  return {
    request_id: requestId,
    supplier_id: 1,
    document_date: '2026-08-16',
    external_supplier_document_number: null,
    payment_status: 'UNPAID',
    payment_method: null,
    paid_amount: null,
    print_after_confirmation: false,
    note: null,
    lines: [{
      variant_id: 7,
      unit_id: 1,
      quantity: '10',
      unit_cost: unitCost,
    }],
    additional_costs: null,
  };
}

function sentRequestId(callIndex: number): string {
  const args = invokeMock.mock.calls[callIndex][1] as {
    payload: PostPurchaseTransactionPayload;
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
      .mockResolvedValueOnce({ ...result, document_id: 910, document_number: 'PUR-2026-000002' });

    await expect(postPurchaseTransaction('tok', payload('request-A'))).rejects.toBeDefined();

    // The UI can generate a new candidate id on the retry; the gateway must
    // retain the original identity for the unchanged, outcome-unknown intent.
    await expect(postPurchaseTransaction('tok', payload('request-B'))).resolves.toEqual(result);

    expect(sentRequestId(0)).toBe('request-A');
    expect(sentRequestId(1)).toBe('request-A');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();

    // Once success is confirmed, a deliberate new purchase with identical
    // business values is a new transaction and must use its new request id.
    await postPurchaseTransaction('tok', payload('request-C'));
    expect(sentRequestId(2)).toBe('request-C');
  });

  it('uses a new request id when the purchase intent changes after a failure', async () => {
    invokeMock
      .mockRejectedValueOnce({ code: 'INTERNAL_ERROR' })
      .mockResolvedValueOnce(result);

    await expect(postPurchaseTransaction('tok', payload('request-A', '100.00'))).rejects.toBeDefined();
    await postPurchaseTransaction('tok', payload('request-B', '110.00'));

    expect(sentRequestId(0)).toBe('request-A');
    expect(sentRequestId(1)).toBe('request-B');
  });
});
