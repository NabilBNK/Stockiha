import { invoke } from '@tauri-apps/api/core';

import { COMMANDS } from './commands';
import type {
  CreateOperatorBackupRequest,
  OperatorBackupCreationResult,
  OperatorBackupValidationResult,
  OperatorRestoreVerificationResult,
  ValidateOperatorBackupRequest,
  VerifyOperatorBackupRestoreRequest,
} from './recoveryDto';
import { GatewayError } from './gateway';
import { parseTauriError } from '../utils/tauriError';

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
