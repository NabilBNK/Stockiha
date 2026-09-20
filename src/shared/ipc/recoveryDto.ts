export interface CreateOperatorBackupRequest {
  requestId: string;
}

export interface ValidateOperatorBackupRequest {
  requestId: string;
  bundlePath: string;
}

export interface VerifyOperatorBackupRestoreRequest {
  requestId: string;
  bundlePath: string;
  confirmed: boolean;
}

export interface RestoreVerificationSetting {
  enabled: boolean;
}

export interface UpdateBackupDestinationRequest {
  path: string;
}

export interface BackupDestinationSetting {
  /** The stored setting (what the administrator chose), or null. */
  path: string | null;
  /**
   * WS-H-3: where the next backup actually goes — the stored path, the
   * default folder on this computer, or null when nothing is configured.
   */
  effectivePath: string | null;
  /** WS-H-3: `effectivePath` is the default folder on this computer. */
  isDefault: boolean;
  /** WS-H-3: false when the stored destination cannot be used right now. */
  available: boolean;
  /** WS-H-3: the effective folder is on the same disk as the live data. */
  sameDriveWarning: boolean;
}

export interface UpdateBackupDestinationResult {
  path: string | null;
  sameDriveWarning: boolean;
}

export interface OperatorBackupValidationResult {
  requestId: string;
  bundleIdentifier: string;
  createdAtLabel: string;
  applicationVersion: string;
  schemaVersion: string;
  postgresMajorVersion: number;
  integrityValid: boolean;
  applicationCompatible: boolean;
  schemaCompatible: boolean;
  postgresCompatible: boolean;
  fileCount: number;
  totalBytes: number;
  // WS-H-3 (plan §5.8.1): optional — absent on results stored before WS-H-3.
  formatVersion?: number;
  backupKind?: BackupKind;
  schemaVerdict?: SchemaVerdict;
  restorable?: boolean;
  /** RFC3339 */
  createdAtUtc?: string;
  usedFallbackDestination?: boolean;
}

export type BackupKind = 'MANUAL' | 'DAILY' | 'PRE_UPDATE' | 'PRE_RESTORE' | 'UNKNOWN';
export type SchemaVerdict = 'SAME' | 'OLDER' | 'NEWER' | 'UNKNOWN';

export type OperatorBackupCreationResult = OperatorBackupValidationResult;

export interface RestoreControlTotals {
  schemaCount: number;
  tableCount: number;
  userCount: number;
  productCount: number;
  customerCount: number;
  supplierCount: number;
  inventoryPositionCount: number;
  inventoryMovementCount: number;
  cashSaleCount: number;
  journalCount: number;
  journalDebitTotal: string;
  journalCreditTotal: string;
  customerExposureTotal: string;
  supplierOutstandingTotal: string;
  openingStateApplicationCount: number;
}

export interface OperatorRestoreVerificationResult {
  requestId: string;
  bundleIdentifier: string;
  schemaVersion: string;
  postgresMajorVersion: number;
  temporaryDatabaseCleaned: boolean;
  journalBalanced: boolean;
  controlTotals: RestoreControlTotals;
  // WS-H-3 (plan §5.8.1): optional — absent on results stored before WS-H-3.
  schemaVerdict?: SchemaVerdict;
  migratedForward?: boolean;
  cleanupPending?: boolean;
}

// ---------------------------------------------------------------------------
// WS-H-3: recovery mode, capabilities and status (plan §5.8).
// ---------------------------------------------------------------------------

export type RecoveryModeName = 'EMBEDDED' | 'EXTERNAL' | 'UNAVAILABLE';

export interface RecoveryModeResponse {
  mode: RecoveryModeName;
  unavailableReason:
    | 'APP_DATA_UNAVAILABLE'
    | 'RESOURCE_DIR_UNAVAILABLE'
    | 'NO_MIGRATOR_CREDENTIAL'
    | null;
}

export interface RecoveryCapabilities {
  mode: RecoveryModeName;
  canCreateBackup: boolean;
  canValidateBackup: boolean;
  canVerifyRestore: boolean;
  canRestoreLive: boolean;
}

/** ISO-8601 strings or null. */
export interface BackupStatus {
  lastSuccessAt: string | null;
  lastSuccessBundle: string | null;
  lastFailureAt: string | null;
  lastFailureCode: string | null;
  lastRestoreAt: string | null;
  lastRestoreBundle: string | null;
}

// ---------------------------------------------------------------------------
// WS-H-4: backup list and copy-to-folder (plan §H4-01, H4-02, H4-05).
// ---------------------------------------------------------------------------

export interface BackupListItem {
  bundleIdentifier: string;
  path: string;
  /** RFC3339, or null when the manifest could not be read. */
  createdAtUtc: string | null;
  backupKind: string;
  formatVersion: number | null;
  schemaVersion: string | null;
  schemaVerdict: SchemaVerdict | string;
  restorable: boolean;
  totalBytes: number;
  manifestReadable: boolean;
}

export interface ListBackupsResponse {
  destination: string | null;
  items: BackupListItem[];
}

export interface CopyBackupToRequest {
  requestId: string;
  bundlePath: string;
  targetDirectory: string;
}

export interface CopyBackupToResult {
  copiedPath: string;
  totalBytes: number;
}

// ---------------------------------------------------------------------------
// WS-H-5: real restore and new-PC restore (plan §H5, §5.9).
// ---------------------------------------------------------------------------

export interface RestoreBackupLiveRequest {
  requestId: string;
  bundlePath: string;
  confirmationText: string;
}

export interface RestoreStarted {
  started: boolean;
}

export interface InspectBackupForFreshInstallRequest {
  bundlePath: string;
}

export interface RestoreBackupFreshInstallRequest {
  bundlePath: string;
}

/** Mirrors `restore_flow::RestoreStep`, in the fixed order the backend
 * always reports them in. `ROLLBACK` and `RESTART` only ever progress past
 * `pending` on the paths that reach them. */
export type RestoreStep =
  | 'VALIDATE_BACKUP'
  | 'PREFLIGHT'
  | 'TEST_RESTORE'
  | 'SAFETY_BACKUP'
  | 'STOP_CONNECTIONS'
  | 'REPLACE_DATA'
  | 'UPDATE_SCHEMA'
  | 'VERIFY'
  | 'RESTORE_FILES'
  | 'RECORD'
  | 'ROLLBACK'
  | 'RESTART';

export const RESTORE_STEPS: RestoreStep[] = [
  'VALIDATE_BACKUP',
  'PREFLIGHT',
  'TEST_RESTORE',
  'SAFETY_BACKUP',
  'STOP_CONNECTIONS',
  'REPLACE_DATA',
  'UPDATE_SCHEMA',
  'VERIFY',
  'RESTORE_FILES',
  'RECORD',
  'ROLLBACK',
  'RESTART',
];

export type RestoreStepStatus = 'RUNNING' | 'DONE' | 'FAILED' | 'SKIPPED';

export interface RestoreProgress {
  step: RestoreStep;
  status: RestoreStepStatus;
  detailCode: string | null;
}

export const RECOVERY_RESTORE_PROGRESS_EVENT = 'recovery-restore-progress';

export type RestoreOutcomeEvent =
  | { outcome: 'SUCCEEDED'; bundleIdentifier: string; migratedForward: boolean }
  | { outcome: 'ABORTED_BEFORE_CHANGE'; errorCode: string; restartRequired: boolean }
  | { outcome: 'ROLLED_BACK'; errorCode: string; safetyBundleIdentifier: string | null }
  | {
      outcome: 'ROLLBACK_FAILED';
      errorCode: string;
      safetyBundlePath: string | null;
      logPath: string;
    };

export const RECOVERY_RESTORE_OUTCOME_EVENT = 'recovery-restore-outcome';

// ---------------------------------------------------------------------------
// WS-H-6: automatic backups (plan §H6-01/H6-03).
// ---------------------------------------------------------------------------

export type AutomaticBackupReason = 'DAILY' | 'PRE_UPDATE';

export interface RunAutomaticBackupRequest {
  requestId: string;
  reason: AutomaticBackupReason;
}

export interface AutomaticBackupResponse {
  status: 'CREATED' | 'SKIPPED';
  skipReason?: 'MODE_UNSUPPORTED' | 'NOT_DUE' | 'BUSY';
  result?: OperatorBackupCreationResult;
  usedFallbackDestination: boolean;
}
