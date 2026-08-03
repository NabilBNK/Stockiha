export interface CreateOperatorBackupRequest {
  requestId: string;
}

export interface ValidateOperatorBackupRequest {
  requestId: string;
  bundlePath: string;
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
