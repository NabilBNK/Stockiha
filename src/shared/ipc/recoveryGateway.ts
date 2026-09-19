import { invoke } from '@tauri-apps/api/core';

import { COMMANDS } from './commands';
import type {
  BackupDestinationSetting,
  BackupStatus,
  CreateOperatorBackupRequest,
  OperatorBackupCreationResult,
  OperatorBackupValidationResult,
  OperatorRestoreVerificationResult,
  RecoveryCapabilities,
  RecoveryModeResponse,
  RestoreVerificationSetting,
  UpdateBackupDestinationRequest,
  UpdateBackupDestinationResult,
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

export async function getBackupDestinationSetting(
  sessionToken: string,
): Promise<BackupDestinationSetting> {
  try {
    return await invoke<BackupDestinationSetting>(
      COMMANDS.GET_BACKUP_DESTINATION_SETTING,
      { sessionToken },
    );
  } catch (error: unknown) {
    throw new GatewayError(parseTauriError(error));
  }
}

export async function updateBackupDestinationSetting(
  sessionToken: string,
  request: UpdateBackupDestinationRequest,
): Promise<UpdateBackupDestinationResult> {
  try {
    return await invoke<UpdateBackupDestinationResult>(
      COMMANDS.UPDATE_BACKUP_DESTINATION_SETTING,
      { sessionToken, request },
    );
  } catch (error: unknown) {
    throw new GatewayError(parseTauriError(error));
  }
}

// WS-H-3: mode, capabilities and status.

export async function getRecoveryMode(): Promise<RecoveryModeResponse> {
  try {
    return await invoke<RecoveryModeResponse>(COMMANDS.GET_RECOVERY_MODE);
  } catch (error: unknown) {
    throw new GatewayError(parseTauriError(error));
  }
}

export async function getRecoveryCapabilities(
  sessionToken: string,
): Promise<RecoveryCapabilities> {
  try {
    return await invoke<RecoveryCapabilities>(COMMANDS.GET_RECOVERY_CAPABILITIES, {
      sessionToken,
    });
  } catch (error: unknown) {
    throw new GatewayError(parseTauriError(error));
  }
}

export async function getBackupStatus(sessionToken: string): Promise<BackupStatus> {
  try {
    return await invoke<BackupStatus>(COMMANDS.GET_BACKUP_STATUS, { sessionToken });
  } catch (error: unknown) {
    throw new GatewayError(parseTauriError(error));
  }
}
