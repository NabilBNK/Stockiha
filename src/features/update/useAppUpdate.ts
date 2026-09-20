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
 *
 * WS-K-6 real-hardware defect fix — install ordering: `performUpdate` calls
 * `update.download()` and `update.install()` as two separate steps, with
 * `prepare_for_update_install` (Rust) run in between, rather than the
 * combined `update.downloadAndInstall()`. This is not a style preference:
 * real-hardware testing found NSIS failing to overwrite a bundled
 * PostgreSQL file mid-update, because a *successful* `install()` on
 * Windows calls `std::process::exit(0)` internally and never reaches this
 * app's own database-shutdown hook (`RunEvent::Exit` in `lib.rs`) — see
 * `commands::update_shutdown`'s own doc comment for the full chain of
 * evidence. `prepare_for_update_install` stops the database itself,
 * explicitly, and confirms its files are writable again before this code
 * ever calls `install()`. If `download()` fails, nothing has been touched
 * yet. If `prepare_for_update_install` or `install()` itself fails after
 * the database was already stopped, `resume_after_failed_update_install`
 * restarts it — the shop must never end up with neither the update nor a
 * working database.
 *
 * WS-H-6 — a full backup before every update install (Owner ruling): between
 * `download()` and `prepare_for_update_install`, `performUpdate` now takes a
 * mandatory `PRE_UPDATE` automatic backup via `runAutomaticBackup`. If it
 * cannot be taken (any outcome other than `CREATED`, or `SKIPPED` for a
 * reason other than a developer machine's `MODE_UNSUPPORTED`), the update is
 * NOT installed — `prepare_for_update_install` and `install()` are never
 * called — and the banner explains why. This requires a signed-in session
 * (the backup is recorded against an actor), so `performUpdate` also refuses
 * to proceed at all when no session token is available yet.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { check, type Update } from '@tauri-apps/plugin-updater';

import { getUpdatePolicy } from '../../shared/ipc/gateway';
import { runAutomaticBackup } from '../../shared/ipc/recoveryGateway';
import { COMMANDS } from '../../shared/ipc/commands';

export type UpdateMode = 'optional' | 'forced';
export type UpdatePhase = 'idle' | 'downloading' | 'backing_up' | 'installing';
export type UpdateErrorKind = 'download' | 'backup' | 'install' | 'login_required' | null;

export interface AppUpdateState {
  /** `null` until a check has completed at least once. */
  available: Update | null;
  mode: UpdateMode;
  phase: UpdatePhase;
  /** Kept for callers that only cared whether *something* is in flight;
   * always equals `phase !== 'idle'`. */
  installing: boolean;
  errorKind: UpdateErrorKind;
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
  phase: 'idle',
  installing: false,
  errorKind: null,
  error: null,
};

export interface UseAppUpdateOptions {
  /** True while a cash session is open (or, by the subset argument in the
   * module doc comment, a sale might be mid-flight) — from
   * `useSession().activeCashSession`. */
  cashSessionOpen: boolean;
  /** The signed-in session token, or `null` before login. WS-H-6's mandatory
   * pre-update backup is recorded against an actor, so `performUpdate`
   * refuses to proceed without one. */
  sessionToken: string | null;
  /** Set to false to stop the periodic re-check (e.g. before the login/
   * setup/upgrade screens, where this hook is not mounted at all in
   * practice, but kept as an explicit guard rather than an implicit one). */
  enabled?: boolean;
}

export function useAppUpdate({ cashSessionOpen, sessionToken, enabled = true }: UseAppUpdateOptions) {
  const [state, setState] = useState<AppUpdateState>(INITIAL_STATE);
  // Re-checked synchronously inside performUpdate via a ref, so a stale
  // closure from when the interval/effect last ran can never let a
  // just-opened cash session (or a since-cleared session token) slip
  // through.
  const cashSessionOpenRef = useRef(cashSessionOpen);
  cashSessionOpenRef.current = cashSessionOpen;
  const sessionTokenRef = useRef(sessionToken);
  sessionTokenRef.current = sessionToken;

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

    const token = sessionTokenRef.current;
    if (!token) {
      // WS-H-6: the mandatory pre-update backup is recorded against an
      // actor, so an update cannot proceed at all without one. Nothing is
      // called - not even download() - so a signed-out session never even
      // starts a partial update.
      setState((prev) => ({ ...prev, phase: 'idle', errorKind: 'login_required', error: null }));
      return;
    }

    setState((prev) => ({ ...prev, phase: 'downloading', installing: true, errorKind: null, error: null }));
    let stoppedDatabase = false;
    // Tracks which step a thrown error belongs to - `stoppedDatabase` alone
    // cannot distinguish a `download()` throw from a `runAutomaticBackup()`
    // throw, since neither has touched the database yet.
    let failedPhase: 'download' | 'backup' | 'install' = 'download';
    try {
      // Nothing has been touched yet at this point - a failure here (a
      // dropped connection, a broken release) leaves the app exactly as it
      // was before the click.
      await update.download();

      // WS-H-6: a full safety backup before any database change. Any
      // outcome other than a genuine success (or a developer machine, which
      // has nothing to back up) stops here - prepare_for_update_install and
      // install() are never called, and nothing has been touched yet.
      failedPhase = 'backup';
      setState((prev) => ({ ...prev, phase: 'backing_up' }));
      const backup = await runAutomaticBackup(token, {
        requestId: `auto-update-${Date.now()}`,
        reason: 'PRE_UPDATE',
      });
      const backupOk =
        backup.status === 'CREATED'
        || (backup.status === 'SKIPPED' && backup.skipReason === 'MODE_UNSUPPORTED');
      if (!backupOk) {
        setState((prev) => ({ ...prev, phase: 'idle', installing: false, errorKind: 'backup' }));
        return;
      }

      // Only from here on does anything change: stop the database and
      // confirm its files are writable again BEFORE ever calling install().
      // See the module doc comment for why this ordering - not a race
      // against the plugin's own internal exit call - is the actual fix.
      failedPhase = 'install';
      setState((prev) => ({ ...prev, phase: 'installing' }));
      await invoke(COMMANDS.PREPARE_FOR_UPDATE_INSTALL);
      stoppedDatabase = true;

      await update.install();
      // On Windows this line is normally unreachable: a successful
      // `install()` already exits the process once NSIS launches (see the
      // Rust-side Cargo.toml note). Reaching here at all means installation
      // did not actually happen, so it is treated the same as any other
      // failure - the UI must not claim success.
      setState((prev) => ({ ...prev, phase: 'idle', installing: false }));
    } catch (err) {
      const errorKind: UpdateErrorKind = failedPhase;
      if (stoppedDatabase) {
        // install() itself failed after we already stopped the database
        // (or prepare_for_update_install stopped it but then refused to
        // proceed because files stayed locked) - get it running again so
        // the shop is not left without a database on top of not getting
        // the update. Best-effort: if this also fails, the error below is
        // still surfaced, and a normal app restart retries startup's own
        // database-start path regardless.
        try {
          await invoke(COMMANDS.RESUME_AFTER_FAILED_UPDATE_INSTALL);
        } catch {
          // Nothing more to do from here.
        }
      }
      // 2b: a failed download/install must never block trading. This
      // leaves every other screen exactly as usable as before the click.
      setState((prev) => ({
        ...prev,
        phase: 'idle',
        installing: false,
        errorKind,
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
    setState((prev) => ({ ...prev, error: null, errorKind: null }));
  }, []);

  return {
    ...state,
    canInstallNow: !cashSessionOpen,
    performUpdate,
    dismiss,
    recheck: runCheck,
  };
}
