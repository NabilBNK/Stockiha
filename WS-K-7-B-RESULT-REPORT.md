# WS-K-7-B Result Report

## Branch and commit

- Base tip (accepted WS-K-7-A tip): `task/ws-k-7-a-licence-engine` @ `9fb212fd2803fb1dc4f2d30be5f27b87e2ce1c40`.
- Branch: `task/ws-k-7-b-licence-ui`, created from that tip (fetch/checkout/pull --ff-only/rev-parse all run first; branch was local-only so `pull` was a no-op — confirmed via `git branch -vv`).
- Code commit: `e5b70972273ac9616ab2dd31a7c9cabc4c329eb4` — "WS-K-7-B: licence screen, banners, and blocked-till UI" (22 files).
- Docs commit: this file, made after code review.
- **Not pushed.** Awaiting explicit instruction.

## Steps completed

B-01 through B-08, all implemented:

- **B-01** — `src/shared/ipc/commands.ts` (4 commands), `src/shared/ipc/licenceDto.ts` (mirrors §3.7 exactly, snake_case), `src/shared/ipc/licenceGateway.ts` (same `invoke`/`GatewayError` pattern as `recoveryGateway.ts`), `src/shared/types/errors.ts` (6 codes + `ERROR_MESSAGE_KEYS`). Also updated `src/shared/utils/tauriError.ts`'s `SAFE_MESSAGES` — a `Record<AppErrorCode, string>` the compiler would have refused to build without all six new arms; not explicitly named in the plan's B-01 file list but required by the existing `satisfies`/`Record` contracts it depends on.
- **B-02** — `src/shared/licence/LicenceContext.tsx`: `LicenceProvider` mounted in `App.tsx` between `I18nProvider` and `SessionProvider` (outside session, as specified). Fails open by construction: every `getLicenceStatus()` call is wrapped in try/catch that sets `status = null` on any failure, including the very first mount call — this is what lets a component depending on it never throw during render. Refreshes every 10 minutes and via the `licence-status-changed` Tauri event (registered with its own `.catch(() => {})`, since `listen()` itself goes through the same mocked `invoke` in tests and would otherwise produce an unhandled rejection).
- **B-03** — `src/features/licence/LicenceBanner.tsx`; wired into `AppRouter.tsx` (one line, directly above `db-config-permission-warning`) and `LoginScreen.tsx` (one line, above the form, `variant="login"` — no button, just the sign-in hint).
- **B-04** — `src/features/licence/LicenceSettingsCard.tsx`; rendered as the literal first child inside `view === 'settings'` in `AppRouter.tsx`, `id="licence-card"` / `data-testid="licence-card"`.
- **B-05** — `PosScreen.tsx` (a new `pos-licence-blocked` early return, checked before the existing `!activeCashSession` check) and `CashSessionScreen.tsx` (the "Open session" submit button gets `|| readOnly` added to its existing `disabled` expression; a new `cash-open-licence-blocked` hint banner shown alongside it). No other screen touched — every other command relies on the backend's `LICENCE_READ_ONLY` rejection surfacing through the existing `useErrorText`/error-banner path, proven in the gating test below. Every existing test id in both files is unchanged.
- **B-06** — All strings in plan §7.6 added to `fr`/`ar`/`en` in `locales.ts`, verbatim, real Arabic — verified by `npm run typecheck` (the `ar`/`en` blocks are typed `Record<MessageKey, string>` derived from `fr`'s own keys, so a missing or mistyped key in any of the three is a compile error, and it passed clean).
- **B-07** — `tests/licence-card.test.tsx` (20 cases), `tests/licence-banner.test.tsx` (13 cases), `tests/licence-gating.workflow.test.tsx` (4 cases) — see Gates below. A small `tests/licenceTestUtils.tsx` helper was added (not named in the plan) exporting `LicenceContextForTest`, needed to inject a fixed status into `LicenceBanner` without driving the real IPC/event wiring for its per-status-table test; this required exporting the raw `LicenceContext` object from `LicenceContext.tsx` alongside the existing `useLicence` hook.
- **B-08** — `APP_VERSION_MARKER` bumped to `'WS-K-7-B.0'`; `src-tauri/tauri.conf.json`'s `"version"` raised from `0.6.0` to `0.7.0` (the only edit to that file, confirmed by diff); `WS-K-7-MANUAL-VERIFICATION.md` created with PART 13 verbatim plus items 13 and 14 from the kickoff instruction.

## Files changed

```
 WS-K-7-MANUAL-VERIFICATION.md                    | new
 src-tauri/tauri.conf.json                        |   2 +-
 src/App.tsx                                      |  13 ++-
 src/app/AppRouter.tsx                            |  16 ++-
 src/features/auth/LoginScreen.tsx                |   2 +
 src/features/cash-session/CashSessionScreen.tsx  |  13 ++-
 src/features/licence/LicenceBanner.tsx           | new
 src/features/licence/LicenceSettingsCard.tsx     | new
 src/features/pos/PosScreen.tsx                   |  19 +++-
 src/shared/i18n/locales.ts                       | 138 ++++++++++++++++++++
 src/shared/ipc/commands.ts                       |   6 ++
 src/shared/ipc/licenceDto.ts                     | new
 src/shared/ipc/licenceGateway.ts                 | new
 src/shared/licence/LicenceContext.tsx            | new
 src/shared/licence/licenceCopy.ts                | new
 src/shared/types/errors.ts                       |  13 +++
 src/shared/utils/tauriError.ts                   |   6 ++
 src/shared/version.ts                            |   2 +-
 tests/licence-banner.test.tsx                    | new
 tests/licence-card.test.tsx                      | new
 tests/licence-gating.workflow.test.tsx           | new
 tests/licenceTestUtils.tsx                       | new
```

No Rust file, no `src-tauri/src/**`, and no migration touched — confirmed by `git status`/`git diff --stat` showing only the files above.

## Gates (real output)

Per your instruction, the ignored Rust suites and SQL suites were **not** re-run this sub-plan — no Rust or SQL was touched (`tauri.conf.json`'s version bump is JSON config, not code). Stated explicitly rather than silently skipped.

```
npm run typecheck   → clean
npm run lint        → clean
npm test -- --run   → 694 passed; 0 failed (68 files) — 657 pre-existing tests, all unmodified,
                       plus 37 new: 20 in licence-card.test.tsx, 13 in licence-banner.test.tsx,
                       4 in licence-gating.workflow.test.tsx
npm run build       → succeeds (dist/ produced; pre-existing >500kB chunk warning, unrelated)
```

Confirmed explicitly, as the rule required: **no pre-existing test file was edited** to add a `get_licence_status` mock. `git diff --stat` on this branch's commit shows zero changes to any file under `tests/` other than the four new licence test files.

## Command classification

Unaffected by this sub-plan — no Rust changed, so the 216/123/93 classification from WS-K-7-A's own report stands unchanged.

## Cargo.lock diff

Not applicable — no Rust dependency changed in this sub-plan.

## Deviations from the specification

1. **`tauriError.ts`'s `SAFE_MESSAGES` map required an edit** the plan's B-01 file list doesn't explicitly name. It is a `Record<AppErrorCode, string>` (a pre-existing exhaustiveness contract, not something WS-K-7 introduced), and TypeScript refuses to compile with the six new `AppErrorCode` values un-mapped. Filled with the same English text as `errors.ts`'s `ERROR_MESSAGE_KEYS` point to, for consistency.
2. **`LicenceContext` (the raw React context object) is now exported**, not just the `useLicence()` hook the plan's §7.2 interface describes. Needed so `tests/licenceTestUtils.tsx` can inject a fixed `LicenceStatus` into `LicenceBanner` for its per-status-code table test without driving the real `getLicenceStatus()`/`listen()` wiring — the alternative (mocking `invoke` per status code across 13 cases) would have been far more brittle. `useLicence()`'s public contract (`{ status, readOnly, refresh }`) is unchanged.
3. **The banner's action button always reads `t('licence.open')`**, even for the `GRACE` row, where plan §7.3's table describes the action informally as "Activate now". No such string key exists in the enumerated §7.6 list (`licence.activate` is the *activation form's* button label, used inside the card, not a banner-specific string) — using the one defined generic action string (`licence.open`) for every banner avoids inventing an unlisted key.
4. **A minimal `openLicenceCard()` navigation helper was added to `AppRouter.tsx`** (not a named plan file for B-05, but AppRouter is already an authorised file for B-03/B-04): `setView('settings')` then `scrollIntoView` on `#licence-card` via `requestAnimationFrame`. This is what plan §7.3 describes ("scrolls to `#licence-card`") but doesn't specify a mechanism for, since `PosScreen`/`LicenceBanner` are leaf components with no direct access to the settings-view setter.

## Blockers / questions for the Architect

None. Nothing in the repository contradicted the specification for this sub-plan.

## Pending manual checks

Everything in `WS-K-7-MANUAL-VERIFICATION.md` (PART 13, items 1-12, plus the two added items 13-14) requires a live installed build on Windows and is explicitly the Owner's to run — not attempted in this session. In particular, items 13 and 14 (activating a real issued licence on this machine, and confirming an expired licence blocks a cash sale while Documents/backup/session-close keep working) need the signed installer this report's next section addresses.

## Unrelated problems noticed

None found in scope for this sub-plan.

---

Full commit hash: `e5b70972273ac9616ab2dd31a7c9cabc4c329eb4`
Pushed: no
