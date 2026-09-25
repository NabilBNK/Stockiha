# WS-K-7-A Result Report

## Branch and commit

- Base tip: `main` @ `c9a09733b8eab28673bfdd185b1a7662db598d2c` (matches the plan's stated baseline exactly).
- Branch: `task/ws-k-7-a-licence-engine`, created from that tip.
- Code commit: `b4b0657` — "WS-K-7-A: licence engine, issuing tool, enforcement gate" (30 files).
- Follow-up code commit: `39e76bb` — "WS-K-7-A: print the machine code in the real registry test" (adds the `println!` this report's machine-code line below depends on; not secret, plan §3.7).
- Docs commit (this file): see its own commit, made after this report, naming `39e76bb`.
- **Not pushed.** Awaiting explicit instruction, per this session's own request.

## Steps completed

A-01 through A-15, all implemented:

- **A-01** — `minisign-verify` moved `[dev-dependencies]` → `[dependencies]`; `Win32_System_Registry` added to `windows-sys`. `Cargo.lock` diff is empty (verified after every gate run in this session).
- **A-02** — `src-tauri/licence/licence-public.key` holds the Owner's public key text verbatim (one line, as pasted); `.gitignore` updated with explicit negations for both public keys and the test fixtures directory, plus `scripts/licence/out/`.
- **A-03** — `src-tauri/src/licence/mod.rs`: constants (§4.1), `LicenceStatus`, `LicenceMode`, `LicenceDetails`, `LicenceStatusDto` (with a shared `LicenceStatusDto::from_evaluation` constructor used by both the IPC commands and the `licence-status-changed` event).
- **A-04** — `machine.rs`: hand-written Crockford base32 encoder (test vectors for all-zero/all-`FF` bytes pass), `compute_machine_code` (pure, pinned test), `machine_code()` reading `HKLM\SOFTWARE\Microsoft\Cryptography\MachineGuid` via `RegGetValueW` (two-call size-then-fill pattern, `// SAFETY:` comments matching `local_config.rs`'s existing style). The real Windows registry read was exercised live on this machine (see Gates below) and returns a correctly shaped code.
- **A-05** — `payload.rs` (`parse_key`, full §3.1 field validation, `KeyError` with the `is_malformed()`/`LICENCE_MALFORMED` vs `LICENCE_INVALID` split per §5.9) and `signature.rs` (mirrors `tauri-plugin-updater`'s verification exactly, reusing the same real fixtures already proven in `tests/update_signature_verification.rs`).
- **A-06** — `evaluator.rs`: the §4.4 algorithm, byte-for-byte, with the plan's own boundary cases pinned as tests (14-day/0-day expiry warning, day-after-expiry in Algeria local time, 47h/49h clock-rollback boundary, GRACE day 0/13, GRACE_OVER day 14).
- **A-07** — `storage.rs`: atomic write (temp file + `sync_all` + rename), `licence.key`/`licence-state.json` read/write treating missing-or-corrupt as "no value", append-only `licence.log`, and a rate-limited `log_blocked` for the gate.
- **A-08** — `migrations/20260926090000_ws_k_007_licensing.sql`: `core.licence_runtime`, `core.licence_events`, and the four `SECURITY DEFINER` functions. Applied cleanly against a real, from-scratch PostgreSQL 18 cluster as the final migration in the full chain (see Gates), and re-applying it is a no-op error-free run (§9.3 item 7).
- **A-09** — `runtime.rs`: `LicenceRuntime` managed state, `refresh`/`activate`/`remove` per §5.5/§4.5. See **Deviations** for the one place this needed a judgment call (Tauri-event emission) and the test-injectable clock/machine-code added for determinism.
- **A-10** — `gate.rs`: `ALLOWED_IN_READ_ONLY` (exact §6.3 list, 123 entries), `is_blocked`, and the three §6.4 tests including the self-checking `every_registered_command_is_classified` (parses `lib.rs` itself, asserts exactly 216 registered commands).
- **A-11** — `commands/licence.rs` (4 thin commands) and six new `ErrorCode`/`AppError` variants in `error.rs`, each with all four required match arms (`Debug`, `Display`, `From<AppError> for IpcError`) plus the pre-existing `stable_error_code` match in `application/recovery.rs`, which the compiler correctly flagged as needing the same six arms.
- **A-12** — `lib.rs`: `LicenceRuntime` managed synchronously in `.setup()` (file-only initial snapshot, per §5.6), the periodic refresh task (`licence_refresh_loop`, bounded wait for the DB, then hourly), and the `invoke_handler` gate wrap exactly as specified in §6.1 — confirmed against the real Tauri 2.11.5 source (`Invoke`/`InvokeMessage`/`InvokeResolver` all match the plan's assumed shape; no `Invoke` re-export at the crate root, so it's `tauri::ipc::Invoke`, the one place the plan's snippet needed a path correction).
- **A-13** — `scripts/licence/issue-licence.mjs` (Node ESM, no dependencies), `scripts/licence/README.md`, and all six committed test fixtures under `src-tauri/licence/test-fixtures/`, generated with the real `npx tauri signer generate`/`sign` CLI against a throwaway test-only key pair (also committed, no password) — not hand-rolled.
- **A-14** — Rust unit tests (§9.2, all listed cases), the SQL suite (§9.3, all six assertions), and the two Windows-ignored tests re-run (§9.4).
- **A-15** — `APP_VERSION_MARKER` bumped to `'WS-K-7-A.0'` in `src/shared/version.ts` (propagates to all five screens that render it).

## Files changed

```
 .gitignore                                                       |  13 +
 scripts/licence/README.md                                        | new
 scripts/licence/issue-licence.mjs                                | new
 src-tauri/Cargo.toml                                              |  27 +-
 src-tauri/licence/licence-public.key                              | new
 src-tauri/licence/test-fixtures/expired-2020-01-31.txt            | new
 src-tauri/licence/test-fixtures/issued-2026-09-26-permanent.txt   | new
 src-tauri/licence/test-fixtures/other-machine.txt                 | new
 src-tauri/licence/test-fixtures/tampered.txt                      | new
 src-tauri/licence/test-fixtures/test-licence-signing.key          | new (deliberately public, test-only)
 src-tauri/licence/test-fixtures/valid-2099-12-31.txt               | new
 src-tauri/licence/test-fixtures/valid-permanent.txt               | new
 src-tauri/licence/test-licence-public.key                         | new
 src-tauri/migrations/20260926090000_ws_k_007_licensing.sql         | new
 src-tauri/src/application/recovery.rs                             |   6 +
 src-tauri/src/commands/licence.rs                                 | new
 src-tauri/src/commands/mod.rs                                     |   1 +
 src-tauri/src/error.rs                                            | 125 +++
 src-tauri/src/lib.rs                                              | 523 (212 unchanged commands reformatted/moved + 4 net-new + gate wiring)
 src-tauri/src/licence/evaluator.rs                                 | new
 src-tauri/src/licence/gate.rs                                     | new
 src-tauri/src/licence/machine.rs                                  | new
 src-tauri/src/licence/mod.rs                                      | new
 src-tauri/src/licence/payload.rs                                  | new
 src-tauri/src/licence/runtime.rs                                  | new
 src-tauri/src/licence/signature.rs                                | new
 src-tauri/src/licence/storage.rs                                  | new
 src-tauri/tests/core/ws_k_007_licensing_integration.sql            | new
 src-tauri/tests/run_current_sql_suites.sh                          |   1 +
 src/shared/version.ts                                              |   2 +-
```

`lib.rs`'s large line count is misleading: verified with a mechanical diff that all 212 pre-existing `commands::...` entries in `generate_handler!` are byte-identical, just reformatted after being split into its own `let inner = ...` binding — the only *new* entries are the four licence commands.

This branch contains only WS-K-7-A changes — no unrelated files.

## Gates (real output)

All run on this machine (Windows, real PostgreSQL 18 and Tauri toolchain — not simulated):

```
cargo fmt --check                                    → clean
cargo check                                          → clean, Cargo.lock unchanged
cargo clippy --all-targets --all-features -D warnings → clean
cargo test --lib                                     → 515 passed; 0 failed; 62 ignored
cargo test --lib -- --ignored safe_upgrade            → 3 passed; 0 failed
cargo test --lib -- --ignored embedded_setup          → 5 passed; 0 failed
cargo test --lib -- --ignored reads_real_machine_guid_on_windows → 1 passed; 0 failed
    → machine code of this build machine: STKH-TXPY-2W37-HQWK-SW1G

npm run typecheck                                    → clean
npm run lint                                         → clean
npm test -- --run                                    → 656 passed; 1 failed (pre-existing flake, see below); 657 total
npm run build                                        → succeeds (dist/ produced; pre-existing >500kB chunk warning, unrelated)
```

The one `npm test` failure — `tests/official-document.test.ts > renderOfficialDocumentPdf > returns real PDF bytes for locale fr, with no logo` — is a 5-second timeout under full-suite parallel load (Typst PDF compilation is CPU-heavy and contended across 657 concurrent tests). Re-run in isolation (`npx vitest run tests/official-document.test.ts`), it passes in 559ms along with the other 15 tests in that file. Not touched by this branch (no file under `src/shared/documents/` or `tests/official-document.test.ts` was edited); pre-existing flakiness, not a regression.

## SQL suites

Re-run in full per your instruction: a **second, independent** throwaway PostgreSQL 18 cluster (own data directory, own port 55501, destroyed afterward — never `stockiha_acceptance`/5433), roles bootstrapped exactly per `.github/workflows/ci.yml`'s recipe, all 161 files under `src-tauri/migrations/` applied in filename order with zero errors (the CI fiscal period was also seeded, matching that recipe's next step), and then **every one of the 42 suites listed in `run_current_sql_suites.sh`'s array run individually** — same wrapper the script itself uses (`BEGIN; \i <suite>; SET CONSTRAINTS ALL IMMEDIATE; ROLLBACK;` via `psql -v ON_ERROR_STOP=1`), just one suite per `psql` invocation instead of one process for the whole loop, so a failure in one suite cannot hide the suites after it. `s2_002_stock_adjustment_integration.sql` was run separately exactly as the script does (unwrapped, `-f` directly, since it tests rollback itself).

| # | Suite | Result |
|---|---|---|
| 1 | `catalog/s2_001_catalog_integration.sql` | PASS |
| 2 | `catalog/ws_d_001_catalogue_foundation_integration.sql` | PASS |
| 3 | `catalog/ws_d_003_active_attribute_filtering_integration.sql` | PASS |
| 4 | `inventory/r8_d_catalog_inventory_integration.sql` | PASS |
| 5 | `inventory/s2_003_zero_quantity_safeguards_integration.sql` | PASS |
| 6 | `procurement/s3_001_procurement_integration.sql` | **FAIL (expected, pre-existing — `confirm_purchase_receipt` check-constraint violation, unrelated to WS-K-7)** |
| 7 | `procurement/s3_002_landed_cost_and_invoices_integration.sql` | **FAIL (expected, pre-existing — same `confirm_purchase_receipt` path)** |
| 8 | `procurement/s3_003_supplier_returns_and_payments_integration.sql` | **FAIL (expected, pre-existing — same `confirm_purchase_receipt` path)** |
| 9 | `procurement/r2_financial_semantics_integration.sql` | **FAIL (expected, pre-existing — same `confirm_purchase_receipt` path)** |
| 10 | `procurement/r8_e_procurement_integration.sql` | **FAIL (expected, pre-existing — same `confirm_purchase_receipt` path)** |
| 11 | `procurement/direct_purchase_acceptance_integration.sql` | PASS |
| 12 | `procurement/ws_e_002_purchase_payment_integration.sql` | PASS |
| 13 | `procurement/ws_e_003_purchase_return_integration.sql` | PASS |
| 14 | `receivables/s4_001_credit_sale_integration.sql` | PASS |
| 15 | `sales/ws_f_004_credit_limit_warning_integration.sql` | PASS |
| 16 | `cash/ws_f_005_cash_session_completion_integration.sql` | PASS |
| 17 | `cash/ws_f_005b_cash_out_approval_integration.sql` | PASS |
| 18 | `sales/ws_f_006_sale_void_integration.sql` | PASS |
| 19 | `documents/ws_l_001_journals_documents_integration.sql` | PASS |
| 20 | `core/ws_m_001_print_identity_integration.sql` | PASS |
| 21 | `cash/ws_m_003_session_report_integration.sql` | PASS |
| 22 | `core/ws_k_007_licensing_integration.sql` (new, this workstream) | **PASS** — all 6 assertions (`licence_touch` nulls-initially, `licence_record_seen` earliest-wins/never-lowers semantics, `licence_reset_last_seen` lowers + rejects an invalid token with `28000`, `record_licence_event` inserts with `user_id` + rejects `'BOGUS'` via the table's own CHECK constraint, `stockiha_runtime` has no `SELECT` on either table, `schema_state` ≥ `20260926090000`) |
| 23 | `receivables/s4_001_customer_payment_integration.sql` | PASS |
| 24 | `cash/s4_002_cash_session_lifecycle.sql` | PASS |
| 25 | `cash/s4_002_cash_session_ownership_integration.sql` | PASS |
| 26 | `receivables/s4_003_drawer_refund_integration.sql` | PASS |
| 27 | `onboarding/r0_001_historical_finance_staging_integration.sql` | PASS |
| 28 | `onboarding/r0_001_excel_correction_reuse_integration.sql` | PASS |
| 29 | `onboarding/r0_001_setting_audit_integration.sql` | PASS |
| 30 | `onboarding/r0_001_onboarding_backup_acl_integration.sql` | PASS |
| 31 | `onboarding/r0_002_historical_trade_staging_integration.sql` | PASS |
| 32 | `onboarding/r0_003_historical_expenses_benefit_integration.sql` | PASS |
| 33 | `onboarding/r0_004_historical_line_party_benefit_integration.sql` | PASS |
| 34 | `onboarding/r0_005_historical_product_alias_integration.sql` | PASS |
| 35 | `onboarding/r5_002_opening_state_reconciliation_integration.sql` | PASS |
| 36 | `onboarding/r5_003_opening_state_setup_lifecycle_integration.sql` | PASS |
| 37 | `onboarding/r5_003_opening_state_application_integration.sql` | PASS |
| 38 | `recovery/r6_001_recovery_authorization_audit_integration.sql` | PASS |
| 39 | **`recovery/r6_001_backup_role_read_privileges_integration.sql`** | **PASS** — checked with special attention per your instruction, since this branch adds `core.licence_runtime`/`core.licence_events`. Confirms `stockiha_backup` retains its blanket schema-wide `SELECT` grant (via the `ALTER DEFAULT PRIVILEGES` this suite verifies) and was unaffected by the new tables. |
| 40 | `recovery/r6_001_sqlx_metadata_backup_acl_integration.sql` | PASS |
| 41 | `recovery/r6_002_restore_verification_authorization_integration.sql` | PASS |
| 42 | `recovery/ws_h_003_recovery_foundation_integration.sql` | PASS |
| 43 | `inventory/s2_002_stock_adjustment_integration.sql` (standalone, own rollback test) | PASS |

**37 PASS, 5 FAIL (all expected/pre-existing per your list — `s3_001`, `s3_002`, `s3_003`, `r2_financial_semantics`, `r8_e_procurement` — none newly introduced or newly fixed by this branch), 1 standalone PASS.** No suite outside that named set of five failed, so nothing triggered the "stop and report" condition. (The migration's re-apply idempotency, §9.3 item 7, was verified separately on the first throwaway cluster used in this session, before it was torn down; not re-run a third time on this second cluster.)

## Command classification

- Registered commands after this branch: **216** (212 baseline + 4 licence commands), verified by `gate::tests::every_registered_command_is_classified`, which parses `lib.rs` itself (no `regex` dependency added) and asserts the exact count.
- Allowed in `READ_ONLY`: **123** (exact §6.3 list).
- Blocked in `READ_ONLY`: **93** (every other registered command — fail-closed by construction, per `gate::is_blocked`).
- Also covered: `gate::tests::blocked_examples_are_blocked` and `gate::tests::allowed_examples_are_allowed` (the plan's named example commands).

## Cargo.lock diff

Empty at every gate run in this session (`git diff --stat Cargo.lock` produced no output after `cargo check`, `cargo clippy`, and every `cargo test` invocation). Confirmed both immediately after the Cargo.toml edit (A-01) and again at the end.

## Deviations from the specification

1. **`licence-status-changed` event emission is split, not entirely inside `refresh()`.** §5.5 describes `refresh()` as itself emitting the Tauri event on a status change. `LicenceRuntime` (in `runtime.rs`) is deliberately Tauri-free — it takes no `AppHandle` and has no `tauri::` imports at all, which is what makes it possible to unit-test `activate`/`remove`/`refresh` with plain temp directories and no live app. Concretely: `refresh()` still detects the status change and writes the `EVALUATED` log line itself; the actual `app_handle.emit("licence-status-changed", ...)` call is made by `lib.rs`'s `licence_refresh_loop`, which compares the snapshot's status before and after calling `refresh()` and emits if they differ. The net behavior the plan specifies (an event fires exactly when the status changes) is unchanged; only which module holds the Tauri handle differs. Flagging this so the Architect can confirm it's an acceptable implementation detail rather than a structural change — I did not want to silently reinterpret "refresh does X" as "refresh may delegate X" without saying so.
2. **`tauri::Invoke` is at `tauri::ipc::Invoke`, not the crate root**, in Tauri 2.11.5 — the plan's §6.1 snippet writes `invoke.message.command()` etc. correctly, but doesn't spell out the full type path for the closure parameter. Confirmed against the real installed crate source (not assumed) before writing the gate; no other part of the plan's assumed API shape needed correction (`InvokeMessage::command()`, `InvokeMessage::webview()`, `InvokeResolver::reject<T: Serialize>(self, T)` all matched exactly).
3. **`core.record_licence_event`'s manual event-type validation was removed**, relying solely on `licence_events_type_valid` (the table's own CHECK constraint) to reject an invalid `p_event_type`. The plan's §9.3 assertion 4 says a `'BOGUS'` event type should produce a "check-constraint error"; an initial version of the function pre-validated and raised its own `22023` before ever reaching the INSERT, which technically never exercised the constraint. Removed the redundant pre-check so the constraint is the one and only source of that rejection, matching the SQL suite's literal expectation.
4. **A test-injectable clock and machine-code override were added to `runtime.rs`** (`now_utc()`/`current_machine_code()`, `#[cfg(not(test))]` passthrough to the real OS calls, `#[cfg(test)]` thread-local overrides with an RAII guard that resets them). Not explicitly specified by the plan, but necessary: `activate()`'s clock-rollback-reset path (§4.5 step 5) compares against the *real* wall clock, and the committed test fixtures are issued for `STKH-TEST-...` codes that never match a real machine's `MachineGuid`. Without this, §9.2's "Activation (with temp dirs and no DB)" tests (valid/expired/wrong-machine/clock-rollback-stale/clock-rollback-fresh) would be untestable against the real fixtures at all. Production code paths (`#[cfg(not(test))]`) are byte-identical to what the plan describes — this is additive, test-only wiring.

## Blockers / questions for the Architect

None. The one place the plan's own pitfall-warning applied (§6.1's Tauri API shape) was checked against the real source and matched, so no STOP was triggered.

## Pending manual checks

Everything requiring a live Windows shop machine, per the skill's "never claim Windows behavior from Linux" rule — except this session *was* run on a real Windows machine with real PostgreSQL 18 and a real registry, so several of these are already covered above rather than merely claimed:

- Machine-code read from the real Windows registry (`reads_real_machine_guid_on_windows`, ignored test, run for real above; this build machine's code is `STKH-TXPY-2W37-HQWK-SW1G`).
- Full from-scratch embedded setup including this migration (`embedded_setup` tests, run for real above).
- Every SQL suite run individually against a fresh throwaway cluster, including `r6_001_backup_role_read_privileges_integration.sql` (run for real above — see SQL suites).

**Deferred by instruction, moved to after WS-K-7-B — not attempted this session:**

- Acceptance criterion 3 (activating a licence end-to-end from a debug build's devtools console) and acceptance criterion 4 (forcing read-only mode and confirming the split between blocked and allowed commands in a live app) are both moved to the Owner's manual checks once WS-K-7-B lands, rather than being attempted now against the backend alone. Both are covered at the unit level already (`runtime::tests` for activation, `gate::tests` for the blocked/allowed split).
- Acceptance criterion 5 (the issuing tool's env-var guard) — reviewed by reading the script's logic, not re-verified interactively beyond the fixture-generation runs this session already did (which had both variables set throughout).
- The signed release installer was not built, per your instruction. WS-K-7-B's frontend work remains out of scope for this sub-plan.

## Unrelated problems noticed

- The one `npm test` flake described above (`tests/official-document.test.ts`, Typst PDF rendering under parallel load) — not fixed, out of scope for this branch's file-editing restriction, reported per the skill's "report it, do not fix it" rule.
- Nothing else was noticed that falls outside this workstream's scope.

---

**Push status:** Not pushed. This branch (`task/ws-k-7-a-licence-engine`) is local only: two code commits (`b4b0657`, `39e76bb`) plus this docs commit, all ahead of `main` @ `c9a0973`. Awaiting explicit instruction before pushing, per the skill's git-safety rule and the plan's own PART 14 instruction.
