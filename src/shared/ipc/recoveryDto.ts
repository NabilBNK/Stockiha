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
}

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
}
