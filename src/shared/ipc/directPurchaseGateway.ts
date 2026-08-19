import { invoke } from '@tauri-apps/api/core';

import { GatewayError } from './gateway';
import type { ConfirmDirectPurchasePayload, ConfirmDirectPurchaseResult } from './directPurchaseDto';
import { parseTauriError } from '../utils/tauriError';

const COMMAND = 'confirm_direct_purchase';
const STORAGE_KEY = 'stockiha.pendingDirectPurchase';

type PendingDirectPurchase = {
  fingerprint: string;
  requestId: string;
};

let memoryPending: PendingDirectPurchase | null = null;

function fingerprint(payload: ConfirmDirectPurchasePayload): string {
  const intent: Partial<ConfirmDirectPurchasePayload> = { ...payload };
  delete intent.request_id;
  return JSON.stringify(intent);
}

function readPending(): PendingDirectPurchase | null {
  if (typeof window === 'undefined' || !window.localStorage) return memoryPending;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return memoryPending;
    const parsed = JSON.parse(raw) as Partial<PendingDirectPurchase>;
    if (typeof parsed.fingerprint !== 'string' || typeof parsed.requestId !== 'string') {
      window.localStorage.removeItem(STORAGE_KEY);
      return memoryPending;
    }
    return { fingerprint: parsed.fingerprint, requestId: parsed.requestId };
  } catch {
    return memoryPending;
  }
}

function writePending(pending: PendingDirectPurchase): void {
  memoryPending = pending;
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(pending));
  } catch {
    // The in-memory copy still protects retries during this application run.
  }
}

function clearPending(expected: PendingDirectPurchase): void {
  const current = readPending();
  if (current?.fingerprint !== expected.fingerprint || current.requestId !== expected.requestId) return;

  memoryPending = null;
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage cleanup failures after an authoritative success response.
  }
}

export async function confirmDirectPurchase(
  sessionToken: string,
  payload: ConfirmDirectPurchasePayload,
): Promise<ConfirmDirectPurchaseResult> {
  const intentFingerprint = fingerprint(payload);
  const existing = readPending();
  const pending = existing?.fingerprint === intentFingerprint
    ? existing
    : { fingerprint: intentFingerprint, requestId: payload.request_id };

  writePending(pending);

  try {
    const result = await invoke<ConfirmDirectPurchaseResult>(COMMAND, {
      sessionToken,
      payload: { ...payload, request_id: pending.requestId },
    });
    clearPending(pending);
    return result;
  } catch (error: unknown) {
    // Keep the same request ID. A transport/read timeout can happen after the
    // database committed, and a retry must resolve through backend idempotency
    // rather than posting the purchase twice.
    throw new GatewayError(parseTauriError(error));
  }
}
