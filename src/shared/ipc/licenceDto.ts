/**
 * WS-K-7 — mirrors the Rust `licence` module's wire shapes exactly (plan
 * §3.7). Field names stay `snake_case` to match the backend's serde output
 * verbatim, same convention as `recoveryDto.ts` and `cashSessionDto.ts`.
 */

export type LicenceStatusCode =
  | 'DEVELOPER'
  | 'ACTIVE'
  | 'EXPIRING_SOON'
  | 'GRACE'
  | 'GRACE_OVER'
  | 'EXPIRED'
  | 'INVALID'
  | 'WRONG_MACHINE'
  | 'CLOCK_ROLLBACK'
  | 'MACHINE_UNAVAILABLE';

export type LicenceMode = 'FULL' | 'READ_ONLY';

export interface LicenceDetails {
  licence_id: string;
  licensee: string;
  issued_on: string;
  expires_on: string | null;
}

export interface LicenceStatus {
  status: LicenceStatusCode;
  mode: LicenceMode;
  machine_code: string | null;
  licence: LicenceDetails | null;
  days_left: number | null;
  grace_days_left: number | null;
  evaluated_at: string;
}

export const LICENCE_STATUS_CHANGED_EVENT = 'licence-status-changed';
