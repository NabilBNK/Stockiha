import { invoke } from '@tauri-apps/api/core';

import { COMMANDS, type CommandName } from './commands';
import type { DrawerOperationPolicy, UpdateDrawerOperationPolicyPayload } from './drawerDto';
import { GatewayError } from './gateway';
import { parseTauriError } from '../utils/tauriError';

async function call<T>(command: CommandName, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error: unknown) {
    throw new GatewayError(parseTauriError(error));
  }
}

export function listDrawerOperationPolicy(
  sessionToken: string,
): Promise<DrawerOperationPolicy[]> {
  return call<DrawerOperationPolicy[]>(COMMANDS.LIST_DRAWER_OPERATION_POLICY, {
    sessionToken,
  });
}

export function updateDrawerOperationPolicy(
  sessionToken: string,
  payload: UpdateDrawerOperationPolicyPayload,
): Promise<DrawerOperationPolicy> {
  return call<DrawerOperationPolicy>(COMMANDS.UPDATE_DRAWER_OPERATION_POLICY, {
    sessionToken,
    payload,
  });
}
