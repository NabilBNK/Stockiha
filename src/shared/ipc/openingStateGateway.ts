import { invoke } from '@tauri-apps/api/core';

import { COMMANDS, type CommandName } from './commands';
import type {
  CreateOpeningStatePackageRequest,
  OpeningStateApprovalResult,
  OpeningStatePackageDataResult,
  OpeningStatePackageIdRequest,
  OpeningStatePackageResult,
  OpeningStatePackageSummaryResult,
  OpeningStateSettingResult,
  OpeningStateValidationResult,
  ReplaceOpeningStatePackageDataRequest,
  UpdateOpeningStateSettingRequest,
} from './openingStateDto';
import { GatewayError } from './gateway';
import { parseTauriError } from '../utils/tauriError';

async function call<T>(command: CommandName, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error: unknown) {
    throw new GatewayError(parseTauriError(error));
  }
}

export function getOpeningStateSetting(
  sessionToken: string,
): Promise<OpeningStateSettingResult> {
  return call<OpeningStateSettingResult>(COMMANDS.GET_OPENING_STATE_SETTING, {
    sessionToken,
  });
}

export function updateOpeningStateSetting(
  sessionToken: string,
  request: UpdateOpeningStateSettingRequest,
): Promise<OpeningStateSettingResult> {
  return call<OpeningStateSettingResult>(COMMANDS.UPDATE_OPENING_STATE_SETTING, {
    sessionToken,
    request,
  });
}

export function createOpeningStatePackage(
  sessionToken: string,
  request: CreateOpeningStatePackageRequest,
): Promise<OpeningStatePackageResult> {
  return call<OpeningStatePackageResult>(COMMANDS.CREATE_OPENING_STATE_PACKAGE, {
    sessionToken,
    request,
  });
}

export function replaceOpeningStatePackageData(
  sessionToken: string,
  request: ReplaceOpeningStatePackageDataRequest,
): Promise<OpeningStatePackageDataResult> {
  return call<OpeningStatePackageDataResult>(COMMANDS.REPLACE_OPENING_STATE_PACKAGE_DATA, {
    sessionToken,
    request,
  });
}

export function validateOpeningStatePackage(
  sessionToken: string,
  request: OpeningStatePackageIdRequest,
): Promise<OpeningStateValidationResult> {
  return call<OpeningStateValidationResult>(COMMANDS.VALIDATE_OPENING_STATE_PACKAGE, {
    sessionToken,
    request,
  });
}

export function approveOpeningStatePackage(
  sessionToken: string,
  request: OpeningStatePackageIdRequest,
): Promise<OpeningStateApprovalResult> {
  return call<OpeningStateApprovalResult>(COMMANDS.APPROVE_OPENING_STATE_PACKAGE, {
    sessionToken,
    request,
  });
}

export function getOpeningStatePackage(
  sessionToken: string,
  request: OpeningStatePackageIdRequest,
): Promise<OpeningStatePackageSummaryResult> {
  return call<OpeningStatePackageSummaryResult>(COMMANDS.GET_OPENING_STATE_PACKAGE, {
    sessionToken,
    request,
  });
}
