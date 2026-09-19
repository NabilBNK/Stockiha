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
