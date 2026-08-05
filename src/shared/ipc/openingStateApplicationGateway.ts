import { invoke } from '@tauri-apps/api/core';

import { COMMANDS, type CommandName } from './commands';
import type {
  ApplyOpeningStateRequest,
  OpeningStateApplicationContextResult,
  OpeningStateApplicationResult,
  OpeningStateApplicationSettingResult,
  UpdateOpeningStateApplicationSettingRequest,
} from './openingStateApplicationDto';
import { GatewayError } from './gateway';
import { parseTauriError } from '../utils/tauriError';

async function call<T>(command: CommandName, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error: unknown) {
    throw new GatewayError(parseTauriError(error));
  }
}

export function getOpeningStateApplicationContext(
  sessionToken: string,
): Promise<OpeningStateApplicationContextResult> {
  return call<OpeningStateApplicationContextResult>(
    COMMANDS.GET_OPENING_STATE_APPLICATION_CONTEXT,
    { sessionToken },
  );
}

export function updateOpeningStateApplicationSetting(
  sessionToken: string,
  request: UpdateOpeningStateApplicationSettingRequest,
): Promise<OpeningStateApplicationSettingResult> {
  return call<OpeningStateApplicationSettingResult>(
    COMMANDS.UPDATE_OPENING_STATE_APPLICATION_SETTING,
    { sessionToken, request },
  );
}

export function applyOpeningState(
  sessionToken: string,
  request: ApplyOpeningStateRequest,
): Promise<OpeningStateApplicationResult> {
  return call<OpeningStateApplicationResult>(COMMANDS.APPLY_OPENING_STATE, {
    sessionToken,
    request,
  });
}
