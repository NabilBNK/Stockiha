/**
 * WS-K-7 — the licence IPC gateway. Same `invoke`/`GatewayError` pattern as
 * `recoveryGateway.ts`.
 */
import { invoke } from '@tauri-apps/api/core';

import { COMMANDS } from './commands';
import type { LicenceStatus } from './licenceDto';
import { GatewayError } from './gateway';
import { parseTauriError } from '../utils/tauriError';

export async function getLicenceStatus(): Promise<LicenceStatus> {
  try {
    return await invoke<LicenceStatus>(COMMANDS.GET_LICENCE_STATUS);
  } catch (error: unknown) {
    throw new GatewayError(parseTauriError(error));
  }
}

export async function activateLicence(
  sessionToken: string,
  licenceKey: string,
): Promise<LicenceStatus> {
  try {
    return await invoke<LicenceStatus>(COMMANDS.ACTIVATE_LICENCE, {
      sessionToken,
      licenceKey,
    });
  } catch (error: unknown) {
    throw new GatewayError(parseTauriError(error));
  }
}

export async function removeLicence(sessionToken: string): Promise<LicenceStatus> {
  try {
    return await invoke<LicenceStatus>(COMMANDS.REMOVE_LICENCE, { sessionToken });
  } catch (error: unknown) {
    throw new GatewayError(parseTauriError(error));
  }
}

export async function refreshLicenceStatus(): Promise<LicenceStatus> {
  try {
    return await invoke<LicenceStatus>(COMMANDS.REFRESH_LICENCE_STATUS);
  } catch (error: unknown) {
    throw new GatewayError(parseTauriError(error));
  }
}
