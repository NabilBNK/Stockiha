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
  showDeferredAccess: boolean;
  isReplay?: boolean | null;
}

export interface SetOpeningStateOnboardingChoiceRequest {
  choice: OpeningStateSetupChoice;
}
