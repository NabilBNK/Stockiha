import { invoke } from '@tauri-apps/api/core';

import { COMMANDS } from './commands';
import { GatewayError } from './gateway';
import { parseTauriError } from '../utils/tauriError';

export type PurchaseWorkflowMode = 'DIRECT_PURCHASE' | 'PURCHASE_ORDER';

export interface PurchaseWorkflowPolicy {
  mode: PurchaseWorkflowMode;
  direct_purchase_enabled: boolean;
  can_manage: boolean;
}

async function call<T>(command: string, args: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error: unknown) {
    throw new GatewayError(parseTauriError(error));
  }
}

export function getPurchaseWorkflowPolicy(
  sessionToken: string,
): Promise<PurchaseWorkflowPolicy> {
  return call<PurchaseWorkflowPolicy>(COMMANDS.GET_PURCHASE_WORKFLOW_POLICY, {
    sessionToken,
  });
}

export function updatePurchaseWorkflowPolicy(
  sessionToken: string,
  mode: PurchaseWorkflowMode,
): Promise<PurchaseWorkflowPolicy> {
  return call<PurchaseWorkflowPolicy>(COMMANDS.UPDATE_PURCHASE_WORKFLOW_POLICY, {
    sessionToken,
    mode,
  });
}
