# WS-M-1 Result Report

## Branch and commit
- Base branch tip: `task/ws-l-1-journals-documents` @ `390f3eedd02450e5eaaad83a21a17e3b0f14e854`
- Branch: `task/ws-m-1-print-identity`, created from that exact tip
- Commit: `9a601ba8434626ced6d4f5160c14a6635e0f3a24` — "WS-M-1: shop identity, print settings and logo"

## Steps completed
- M1-01 — Migration `20260924090000_ws_m_001_print_identity.sql`: 17 new identity/display columns on `core.printing_settings`, length + format constraints, rewritten `get_printing_settings` (26 keys), `save_printing_settings(text, jsonb)` replacing the 9-arg function (missing key = keep, explicit `null` = clear, via `p_settings ? 'key'`), and new `set_printing_logo(text, text)`.
- M1-02 — Rust: `get_printing_settings`/`save_printing_settings` now pass raw `jsonb` (`serde_json::Value`) end to end — no Rust struct to update for future columns. New commands `set_company_logo`, `get_company_logo`, `clear_company_logo` (file copy happens before the DB call; atomic tmp-write+fsync+rename; extension + magic-byte validation for PNG/JPEG/WebP; 2 MiB cap). Logo lives at `<app_data_dir>/company-assets/logo.<ext>`, which `recovery_creation.rs`/`recovery_engine/live.rs` already back up and restore generically — no changes needed there.
- M1-03 — TypeScript IPC: `PrintingSettingsDto` extended with all 17 fields; `SavePrintingSettingsPayload` now a `Partial<...>` of the editable fields; `savePrintingSettings` sends `{ sessionToken, settings }`; added `setCompanyLogo`/`getCompanyLogo`/`clearCompanyLogo`.
- M1-04 — `PrintingSettingsScreen.tsx`: logo preview/choose/remove, 9 identity text fields, 5 checkboxes, print-language select, all with the exact `data-testid`s specified. Client-side validation (email format, per-field length limits) blocks the save call before it reaches the backend.
- M1-05 — Tests: SQL suite `src-tauri/tests/core/ws_m_001_print_identity_integration.sql` (13 numbered assertions incl. permission denial, partial save, explicit-null clear, all 4 enum/length/email rejections, logo bookkeeping incl. path-traversal and extension rejection, key-ignoring, all-26-keys, `{}` no-op, non-object rejection, schema_state, idempotent re-apply), registered in `run_current_sql_suites.sh`. Vitest: existing `printing-settings.workflow.test.tsx` extended (load, target toggle, full-payload save, logo choose/remove/cancel, invalid-email block); `receipt-builder.test.ts` / `void-slip-builder.test.ts` fixtures updated for the grown DTO. Rust unit tests for magic-byte/extension/size/missing-file validation. `APP_VERSION_MARKER` bumped to `WS-M-1.0`.

## Files changed
21 files, +2028/-133 (`git diff --stat` on the commit above — full list in the commit itself).

## Gates (real output)
- `cargo fmt --check` — clean
- `cargo check` — clean
- `cargo clippy --all-targets --all-features -- -D warnings` — clean
- `cargo test --lib` — **463 passed, 0 failed, 61 ignored**
- `cargo test --lib -- --ignored safe_upgrade` — **3 passed** (real disposable PostgreSQL)
- `cargo test --lib -- --ignored embedded_setup` — **5 passed** (real disposable PostgreSQL, incl. Arabic/space-in-path installs)
- `npm run typecheck` — clean
- `npm run lint` — clean
- `npm test -- --run` — **608 passed, 1 failed** (`historical-exports.test.ts` "renders a valid vector PDF..." — pre-existing 5s timeout under full-suite load; passes in 861ms run in isolation; unrelated file, untouched by this branch)
- `npm run build` — succeeds (359 modules, dist emitted)

## SQL suites
Built a throwaway PostgreSQL 18 cluster from the bundled `src-tauri/resources/postgres/win64` binaries (the CI recipe, run locally since no `ADMIN_URL` was preset), bootstrapped roles exactly as `.github/workflows/ci.yml` does, applied all migrations in filename order.

| Result | Count |
|---|---|
| Fresh install: all migrations applied | **159/159**, zero errors |
| SQL suites passed | **35/35** non-procurement suites |
| SQL suites with the 5 documented pre-existing failures | `s3_001`, `s3_002`, `s3_003`, `r2_financial_semantics`, `r8_e_procurement` — all four run individually and confirmed to fail identically **before** this branch's changes too (they're the plan's documented exceptions) |
| `ws_m_001_print_identity_integration.sql` | **PASS** — all 13 assertions, plus a second `\i` of the migration file proving it re-applies with zero errors |
| `ws_l_001_journals_documents_integration.sql` (regression check) | **PASS**, unchanged |
| Migration idempotency | Confirmed — re-running `20260924090000_ws_m_001_print_identity.sql` against an already-migrated database raises no error (all `ADD COLUMN IF NOT EXISTS` / `DROP+ADD CONSTRAINT` / `CREATE OR REPLACE` / `DROP FUNCTION IF EXISTS`) |

## Deviations from the specification
1. **`base64` promoted from `[dev-dependencies]` to `[dependencies]`** in `Cargo.toml`. The plan said "no Cargo.toml change needed since the crate is already pinned," but it was only pinned under `[dev-dependencies]` (for a WS-K-6 test-only assertion) — unusable from `src/application/printing.rs`, a production module. Promoted the existing entry to `[dependencies]` (same exact pinned version, zero `Cargo.lock` churn — confirmed with `git diff --stat -- Cargo.lock` showing no change), following the identical precedent already in the file for `serde_json` (WS-K-6 comment block right above it). No new crate, no new version.
2. **Three new stable `ErrorCode` variants** (`LOGO_TOO_LARGE`, `LOGO_NOT_A_FILE`, `LOGO_UNSUPPORTED_TYPE`) were added to the existing `AppError`/`ErrorCode`/`IpcError` allowlist system (mirroring `RESTORE_ADMIN_NOT_CONFIGURED`, `BACKUP_NOT_RESTORABLE`, etc.), plus matching frontend `BACKEND_ERROR_CODES`/`ERROR_MESSAGE_KEYS`/locale strings. The plan named these three diagnostics (`LOGO_TOO_LARGE` / `LOGO_NOT_A_FILE` / `LOGO_UNSUPPORTED_TYPE`) but Stockiha's IPC contract only ever puts the stable `code` on the wire, never free-text diagnostics (`IpcError` serializes to `{"code": "..."}` only — confirmed in `error.rs`). Treating the three names as new `ErrorCode` variants, not string diagnostics, was the only way to make them distinguishable on the frontend, consistent with every other WS-H/WS-K precedent in this file.
3. Second save button dropped. Built one first (top card + bottom identity card), then removed it — the plan is explicit that there is "one Save button for the whole screen," and the existing top-of-screen button already sends the full payload including every new field.

## Blockers / questions for the Architect
None. No repository contradiction found requiring escalation.

## Pending manual checks (PART 11, items 1–4)
Not run — this environment has no Windows Tauri runtime/WebView2. Needs the Owner on an installed Windows build:
1. Fill in every identity field, choose a logo, save, reopen Settings — values and logo preview persist.
2. Remove the logo — preview empties, file gone from `%APPDATA%\com.raqmenha.stockiha\company-assets`.
3. Set print language to French while the app is in Arabic, save — nothing printed changes yet (expected, WS-M-2 scope).
4. Take a backup after setting a logo — backup folder contains `company-assets/logo.png`.

**Installer not built.** `npm run tauri:build` requires `TAURI_SIGNING_PRIVATE_KEY`/`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, which only the Owner holds — per PART 12, these are never requested in chat. The Owner should run the build once the branch is accepted.

## Unrelated problems noticed (not fixed)
- `tests/historical-exports.test.ts`'s Arabic-font PDF test times out at the default 5s when the full 609-test suite runs together (passes cleanly at 861ms alone) — a pre-existing timing sensitivity, not touched by WS-M-1.

## Push status
**Not pushed.** Commit is local only on `task/ws-m-1-print-identity`, per instruction to ask before pushing.
- Local HEAD: `9a601ba8434626ced6d4f5160c14a6635e0f3a24`
