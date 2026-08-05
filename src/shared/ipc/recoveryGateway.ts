import { invoke } from '@tauri-apps/api/core';

import { COMMANDS } from './commands';
import type {
  CreateOperatorBackupRequest,
  OperatorBackupCreationResult,
  OperatorBackupValidationResult,
  OperatorRestoreVerificationResult,
  RestoreVerificationSetting,
  ValidateOperatorBackupRequest,
  VerifyOperatorBackupRestoreRequest,
} from './recoveryDto';
import { GatewayError } from './gateway';
import { parseTauriError } from '../utils/tauriError';

export async function getRestoreVerificationSetting(
  sessionToken: string,
): Promise<RestoreVerificationSetting> {
  try {
    return await invoke<RestoreVerificationSetting>(
      COMMANDS.GET_RESTORE_VERIFICATION_SETTING,
      { sessionToken },
    );
  } catch (error: unknown) {
    throw new GatewayError(parseTauriError(error));
  }
}

export async function updateRestoreVerificationSetting(
  sessionToken: string,
  enabled: boolean,
): Promise<RestoreVerificationSetting> {
  try {
    return await invoke<RestoreVerificationSetting>(
      COMMANDS.UPDATE_RESTORE_VERIFICATION_SETTING,
      { sessionToken, enabled },
    );
  } catch (error: unknown) {
    throw new GatewayError(parseTauriError(error));
  }
}

export async function createOperatorBackup(
  sessionToken: string,
  request: CreateOperatorBackupRequest,
): Promise<OperatorBackupCreationResult> {
  try {
    return await invoke<OperatorBackupCreationResult>(COMMANDS.CREATE_OPERATOR_BACKUP, {
      sessionToken,
      request,
    });
  } catch (error: unknown) {
    throw new GatewayError(parseTauriError(error));
  }
}

export async function validateOperatorBackup(
  sessionToken: string,
  request: ValidateOperatorBackupRequest,
): Promise<OperatorBackupValidationResult> {
  try {
    return await invoke<OperatorBackupValidationResult>(COMMANDS.VALIDATE_OPERATOR_BACKUP, {
      sessionToken,
      request,
    });
  } catch (error: unknown) {
    throw new GatewayError(parseTauriError(error));
  }
}

export async function verifyOperatorBackupRestore(
  sessionToken: string,
  request: VerifyOperatorBackupRestoreRequest,
): Promise<OperatorRestoreVerificationResult> {
  try {
    return await invoke<OperatorRestoreVerificationResult>(
      COMMANDS.VERIFY_OPERATOR_BACKUP_RESTORE,
      { sessionToken, request },
    );
  } catch (error: unknown) {
    throw new GatewayError(parseTauriError(error));
  }
}
