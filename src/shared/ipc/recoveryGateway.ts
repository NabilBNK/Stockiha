import { invoke } from '@tauri-apps/api/core';

import { COMMANDS } from './commands';
import type {
  OperatorBackupValidationResult,
  ValidateOperatorBackupRequest,
} from './recoveryDto';
import { GatewayError } from './gateway';
import { parseTauriError } from '../utils/tauriError';

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
