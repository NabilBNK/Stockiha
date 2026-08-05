export type OpeningStateSetupStatus =
  | 'PENDING'
  | 'DEFERRED'
  | 'DECLINED'
  | 'COMPLETED';

export type OpeningStateSetupChoice = 'DEFERRED' | 'DECLINED';

export interface OpeningStateOnboardingStatusResult {
  status: OpeningStateSetupStatus;
  enabled: boolean;
  hasApprovedPackage: boolean;
  approvedPackageId?: number | null;
  hasAppliedOpeningState?: boolean;
  showDeferredAccess: boolean;
  showApplicationAccess?: boolean;
  isReplay?: boolean | null;
}

export interface SetOpeningStateOnboardingChoiceRequest {
  choice: OpeningStateSetupChoice;
}
