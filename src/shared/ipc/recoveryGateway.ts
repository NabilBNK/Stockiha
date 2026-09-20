import { invoke } from '@tauri-apps/api/core';

import { COMMANDS } from './commands';
import type {
  BackupDestinationSetting,
  BackupListItem,
  BackupStatus,
  CopyBackupToRequest,
  CopyBackupToResult,
  CreateOperatorBackupRequest,
  InspectBackupForFreshInstallRequest,
  ListBackupsResponse,
  OperatorBackupCreationResult,
  OperatorBackupValidationResult,
  OperatorRestoreVerificationResult,
  RecoveryCapabilities,
  RecoveryModeResponse,
  RestoreBackupFreshInstallRequest,
  RestoreBackupLiveRequest,
  RestoreStarted,
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

// WS-H-4: backup list and copy-to-folder.

export async function listBackups(sessionToken: string): Promise<ListBackupsResponse> {
  try {
    return await invoke<ListBackupsResponse>(COMMANDS.LIST_BACKUPS, { sessionToken });
  } catch (error: unknown) {
    throw new GatewayError(parseTauriError(error));
  }
}

export async function copyBackupTo(
  sessionToken: string,
  request: CopyBackupToRequest,
): Promise<CopyBackupToResult> {
  try {
    return await invoke<CopyBackupToResult>(COMMANDS.COPY_BACKUP_TO, {
      sessionToken,
      request,
    });
  } catch (error: unknown) {
    throw new GatewayError(parseTauriError(error));
  }
}

// WS-H-5: real restore and new-PC restore.

/**
 * Starts a real, in-place live restore. Resolves once the command has been
 * accepted and the restore worker thread is running — it does **not** wait
 * for the restore to finish. Progress arrives via
 * `RECOVERY_RESTORE_PROGRESS_EVENT`; on success the backend stops the
 * embedded server and restarts the app process itself. On any other
 * outcome the final state arrives via `RECOVERY_RESTORE_OUTCOME_EVENT`.
 * Callers MUST subscribe to both events before calling this.
 */
export async function restoreBackupLive(
  sessionToken: string,
  request: RestoreBackupLiveRequest,
): Promise<RestoreStarted> {
  try {
    return await invoke<RestoreStarted>(COMMANDS.RESTORE_BACKUP_LIVE, {
      sessionToken,
      request,
    });
  } catch (error: unknown) {
    throw new GatewayError(parseTauriError(error));
  }
}

export async function inspectBackupForFreshInstall(
  request: InspectBackupForFreshInstallRequest,
): Promise<BackupListItem> {
  try {
    return await invoke<BackupListItem>(COMMANDS.INSPECT_BACKUP_FOR_FRESH_INSTALL, {
      request,
    });
  } catch (error: unknown) {
    throw new GatewayError(parseTauriError(error));
  }
}

/** Same subscribe-before-invoke contract as {@link restoreBackupLive}. */
export async function restoreBackupFreshInstall(
  request: RestoreBackupFreshInstallRequest,
): Promise<RestoreStarted> {
  try {
    return await invoke<RestoreStarted>(COMMANDS.RESTORE_BACKUP_FRESH_INSTALL, {
      request,
    });
  } catch (error: unknown) {
    throw new GatewayError(parseTauriError(error));
  }
}

export async function restartAfterRecovery(): Promise<void> {
  try {
    return await invoke<void>(COMMANDS.RESTART_AFTER_RECOVERY);
  } catch (error: unknown) {
    throw new GatewayError(parseTauriError(error));
  }
}
