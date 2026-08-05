export interface OpeningStateAccountOption {
  accountCode: string;
  normalSide: 'DEBIT' | 'CREDIT';
  description: string;
  isDefault: boolean;
}

export interface OpeningStateApplicationLine {
  lineId: number;
  sourceRowNumber: number;
  lineType: string;
  description: string;
  amountDzd: number;
  counterpartyName: string | null;
  externalReference: string | null;
  notes: string | null;
  accountOptions: OpeningStateAccountOption[];
}

export interface OpeningStateApplicationPackage {
  packageId: number;
  status: string;
  cutoverDate: string;
  totalAssetsDzd: number;
  totalLiabilitiesDzd: number;
  totalEquityDzd: number;
  reconciliationDifferenceDzd: number;
}

export interface OpeningStateApplicationContextResult {
  enabled: boolean;
  hasApprovedPackage: boolean;
  applied: boolean;
  applicationId: number | null;
  journalDocumentId: number | null;
  package: OpeningStateApplicationPackage | null;
  lines: OpeningStateApplicationLine[];
}

export interface UpdateOpeningStateApplicationSettingRequest {
  enabled: boolean;
}

export interface OpeningStateApplicationSettingResult {
  enabled: boolean;
}

export interface OpeningStateApplicationMappingInput {
  lineId: number;
  customerId?: number | null;
  supplierId?: number | null;
  accountCode?: string | null;
}

export interface ApplyOpeningStateRequest {
  requestId: string;
  packageId: number;
  fiscalPeriodId: number;
  mappings: OpeningStateApplicationMappingInput[];
}

export interface OpeningStateApplicationResult {
  applicationId: number;
  packageId: number;
  journalDocumentId: number;
  status: 'APPLIED';
  isReplay: boolean;
  physicalInventoryIncomplete: boolean;
}
