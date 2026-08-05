export type OpeningStateSourceType = 'EXCEL' | 'MANUAL';

export type OpeningStateLineType =
  | 'CASH'
  | 'BANK'
  | 'INVENTORY_VALUE'
  | 'CUSTOMER_RECEIVABLE'
  | 'SUPPLIER_PAYABLE'
  | 'LOAN_PAYABLE'
  | 'TAX_PAYABLE'
  | 'OWNER_CAPITAL'
  | 'RETAINED_EARNINGS'
  | 'OTHER_ASSET'
  | 'OTHER_LIABILITY';

export type OpeningStateReviewStatus = 'READY' | 'NEEDS_REVIEW' | 'APPROVED' | 'REJECTED';

export interface OpeningStateSettingResult {
  enabled: boolean;
}

export interface UpdateOpeningStateSettingRequest {
  enabled: boolean;
}

export interface CreateOpeningStatePackageRequest {
  requestId: string;
  sourceType: OpeningStateSourceType;
  originalFilename?: string | null;
  cutoverDate: string;
}

export interface OpeningStatePackageResult {
  packageId: number;
  status: string;
  isReplay: boolean;
  sourceType: OpeningStateSourceType;
  originalFilename: string | null;
  cutoverDate: string;
}

export interface OpeningStateLineInput {
  sourceRowNumber: number;
  lineType: OpeningStateLineType;
  description: string;
  amountDzd: number;
  counterpartyName?: string | null;
  externalReference?: string | null;
  notes?: string | null;
  reviewStatus: OpeningStateReviewStatus;
}

export interface ReplaceOpeningStatePackageDataRequest {
  packageId: number;
  lines: OpeningStateLineInput[];
}

export interface OpeningStatePackageDataResult {
  packageId: number;
  status: string;
  lineCount: number;
}

export interface OpeningStatePackageIdRequest {
  packageId: number;
}

export interface OpeningStateValidationResult {
  packageId: number;
  status: 'VALIDATED' | 'NEEDS_REVIEW';
  rowCount: number;
  invalidRowCount: number;
  totalAssetsDzd: number;
  totalLiabilitiesDzd: number;
  totalEquityDzd: number;
  reconciliationDifferenceDzd: number;
  validationErrors: string[];
}

export interface OpeningStateApprovalResult {
  packageId: number;
  status: 'APPROVED_FOR_APPLICATION';
  isReplay: boolean;
  cutoverDate: string;
  totalAssetsDzd: number;
  totalLiabilitiesDzd: number;
  totalEquityDzd: number;
  reconciliationDifferenceDzd: number;
}

export interface OpeningStatePackageSummaryResult {
  packageId: number;
  status: string;
  sourceType: OpeningStateSourceType;
  originalFilename: string | null;
  cutoverDate: string;
  rowCount: number;
  invalidRowCount: number;
  totalAssetsDzd: number;
  totalLiabilitiesDzd: number;
  totalEquityDzd: number;
  reconciliationDifferenceDzd: number;
  validationErrors: string[];
}
