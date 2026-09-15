/**
 * WS-K-6 — internet-delivered updates: the client-side decision engine.
 *
 * Combines two independent facts fetched separately and for different
 * reasons (see `infrastructure::update_policy`'s own doc comment for why
 * they are not one file): `check()` from `@tauri-apps/plugin-updater` (is
 * there a newer, signature-verified release, and what does it need to
 * install it) and `getUpdatePolicy()` (how urgently should it be
 * presented — read from a small, separate, UNSIGNED file the Owner can
 * edit without a rebuild).
 *
 * Owner rulings this hook exists to satisfy, restated as code:
 *
 * - 2d: the check must fail silently and harmlessly offline. Both fetches
 *   are wrapped in `try/catch`; any failure (no internet, DNS, timeout,
 *   `check()` throwing) leaves `available: false` and nothing else — no
 *   thrown error reaches a caller, no popup, no retry loop (the interval
 *   below just tries again next cycle, which is not a retry storm: it is
 *   the same, single, spaced-out check a healthy connection would also
 *   get).
 * - 2c: an update must never begin while a cash session is open, or a sale
 *   is in progress. Cash-session state comes from `useSession()`'s own
 *   `activeCashSession` — the one piece of state WS-F already models this
 *   with; nothing new is invented here. A sale cannot be submitted without
 *   an open cash session (`PosScreen`'s own `confirmSale` guard requires
 *   one), so "a sale is in progress" is structurally a subset of "a cash
 *   session is open" — one check covers both. The gate is re-evaluated
 *   immediately before `performUpdate` actually acts, not only at the
 *   moment the notice first appeared, so a session opened in the meantime
 *   (the operator started a shift while a FORCED notice sat on screen)
 *   still defers the actual download/install.
 * - 2b: a forced update must never prevent trading. This hook never
 *   disables, hides, or gates any other screen — it only ever adds a
 *   banner. `performUpdate` failing (network drop mid-download, a broken
 *   release) leaves `error` set and `installing: false`; nothing here ever
 *   throws past its own boundary or blocks the rest of the app.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { check, type Update } from '@tauri-apps/plugin-updater';

import { getUpdatePolicy } from '../../shared/ipc/gateway';

export type UpdateMode = 'optional' | 'forced';

export interface AppUpdateState {
  /** `null` until a check has completed at least once. */
  available: Update | null;
  mode: UpdateMode;
  installing: boolean;
  /** Credential-free, user-facing-safe: never the raw thrown value. */
  error: string | null;
}

/** How often to re-check while the app stays open. Not aggressive: a shop
 * can be open for a full day between launches, and a fresh install/launch
 * already checks once immediately. */
const RECHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

const INITIAL_STATE: AppUpdateState = {
  available: null,
  mode: 'optional',
  installing: false,
  error: null,
};

export interface UseAppUpdateOptions {
  /** True while a cash session is open (or, by the subset argument in the
   * module doc comment, a sale might be mid-flight) — from
   * `useSession().activeCashSession`. */
  cashSessionOpen: boolean;
  /** Set to false to stop the periodic re-check (e.g. before the login/
   * setup/upgrade screens, where this hook is not mounted at all in
   * practice, but kept as an explicit guard rather than an implicit one). */
  enabled?: boolean;
}

export function useAppUpdate({ cashSessionOpen, enabled = true }: UseAppUpdateOptions) {
  const [state, setState] = useState<AppUpdateState>(INITIAL_STATE);
  // Re-checked synchronously inside performUpdate via a ref, so a stale
  // closure from when the interval/effect last ran can never let a
  // just-opened cash session slip through.
  const cashSessionOpenRef = useRef(cashSessionOpen);
  cashSessionOpenRef.current = cashSessionOpen;

  const runCheck = useCallback(async () => {
    if (!enabled) return;

    let mode: UpdateMode = 'optional';
    try {
      const policy = await getUpdatePolicy();
      mode = policy.mode;
    } catch {
      // Fail-safe default already applied on the Rust side for every
      // failure mode; a thrown IPC error here (should not happen, since
      // the command itself never rejects) gets the identical treatment.
      mode = 'optional';
    }

    try {
      const update = await check();
      setState((prev) => ({ ...prev, available: update, mode, error: null }));
    } catch {
      // 2d: silent and harmless. No internet, DNS failure, malformed
      // manifest, whatever the cause - this is not an error the operator
      // needs to see, and it changes nothing else about the app.
      setState((prev) => ({ ...prev, available: null, mode }));
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    void runCheck();
    const interval = window.setInterval(() => void runCheck(), RECHECK_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [enabled, runCheck]);

  const performUpdate = useCallback(async () => {
    if (cashSessionOpenRef.current) {
      // Re-checked right before acting, not only when the notice first
      // rendered - see the module doc comment's 2c note.
      return;
    }
    const update = state.available;
    if (!update) return;

    setState((prev) => ({ ...prev, installing: true, error: null }));
    try {
      await update.downloadAndInstall();
      // On Windows this line is normally unreachable: a successful
      // `downloadAndInstall` already exits the process once NSIS launches
      // (see the Rust-side Cargo.toml note). Reaching here at all means
      // installation did not actually happen, so it is treated the same
      // as any other failure - the UI must not claim success.
      setState((prev) => ({ ...prev, installing: false }));
    } catch (err) {
      // 2b: a failed download/install must never block trading. This
      // leaves every other screen exactly as usable as before the click.
      setState((prev) => ({
        ...prev,
        installing: false,
        error: err instanceof Error ? err.message : 'update failed',
      }));
    }
  }, [state.available]);

  const dismiss = useCallback(() => {
    // Only ever hides the notice for THIS running session - a fresh
    // launch, or the next periodic check, re-evaluates from scratch. There
    // is deliberately no persistent "never show again" for a FORCED
    // update (2a): dismiss on a forced notice only collapses it visually,
    // it does not clear `available`, so the caller's own re-render logic
    // (see UpdateBanner) can choose to bring it back.
    setState((prev) => ({ ...prev, error: null }));
  }, []);

  return {
    ...state,
    canInstallNow: !cashSessionOpen,
    performUpdate,
    dismiss,
    recheck: runCheck,
  };
}
