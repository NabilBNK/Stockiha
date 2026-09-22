# WS-L-1 Result Report — Journals & Documents: Fixed, Findable, Attributable

## Branch and commit

- Branch: `task/ws-l-1-journals-documents`, created from `main` at `88999b826fc680434fbe7543fe82b15cb769e959` (verified equal to `origin/main`).
- Code commit: `e8bbe951afb86d2df67dfa4f260da6bdf1806d4c`.
- This report is committed separately, docs-only, naming that commit.

## Steps completed

All eight sections of the migration (§5), all seven application steps (§6, STEP 1–7), the SQL suite and its registration, and both new Vitest files were implemented per the brief.

1. **Migration** `20260923090000_ws_l_001_journals_documents.sql` — all 8 sections applied verbatim or per the specified edits (see "Column corrections" below for the one deviation).
2. **Rust**: `search_business_documents` and `search_journals` added to `application/documents.rs` / `application/finance_service.rs` and `commands/documents.rs` / `commands/finance.rs`; both registered in `lib.rs`. `parse_filter_date` factored out of `commands/documents.rs` into a `pub(crate) fn` and reused by `commands/finance.rs`, exactly as STEP 1 specifies.
3. **TypeScript IPC**: `commands.ts`, `documentDto.ts`, `documentGateway.ts`, `dto.ts`, `gateway.ts` extended per STEP 2.
4. **Labels**: `formatters.ts` — the four new `humanDocumentType` entries and `journalSourceLabel` added per STEP 3.
5. **Documents tab** (`DocumentsScreen.tsx`) — rebuilt per STEP 4: server-side filters (date range, type, status, search with 400 ms debounce), 50-row pagination, new columns (party, amount, Recorded by), cancellation cross-links, no JOURNAL_ENTRY rows, Generation/Print columns removed. The Reports tab was not touched.
6. **Detail modal** (`BusinessDocumentDetailModal.tsx`) — Recorded by / Workstation rows, the REVERSED cancellation banner, and SALE_VOID reason/note/discount rows added per STEP 5.
7. **Journals screen** (`JournalsScreen.tsx`) — server-side filters and pagination, `journalSourceLabel` for the source column and the detail header, `<scf_code> · <localized name>` for journal lines, Recorded by everywhere, per STEP 6.
8. **Reports tab** — no JSX change, per STEP 7 (the migration's Section 7 fix is what makes it correct now).

## Files changed

```
src-tauri/migrations/20260923090000_ws_l_001_journals_documents.sql   (new)
src-tauri/src/application/documents.rs
src-tauri/src/application/finance_service.rs
src-tauri/src/commands/documents.rs
src-tauri/src/commands/finance.rs
src-tauri/src/lib.rs
src-tauri/tests/documents/ws_l_001_journals_documents_integration.sql (new)
src-tauri/tests/run_current_sql_suites.sh
src/shared/ipc/commands.ts
src/shared/ipc/documentDto.ts
src/shared/ipc/documentGateway.ts
src/shared/ipc/dto.ts
src/shared/ipc/gateway.ts
src/shared/utils/formatters.ts
src/shared/version.ts
src/features/documents/DocumentsScreen.tsx
src/features/documents/BusinessDocumentDetailModal.tsx
src/features/accounting/JournalsScreen.tsx
tests/documents-search.workflow.test.tsx        (new)
tests/journals-search.workflow.test.tsx         (new)
tests/documents.workflow.test.tsx               (updated: removed-behaviour assertions only)
tests/journals.workflow.test.tsx                (updated: mock + account-label assertions)
tests/business-documents-detail-reports.workflow.test.tsx (updated: mock only)
tests/customer-documents.workflow.test.tsx      (updated: mock only)
WS-L-1-MANUAL-VERIFICATION.md                   (new)
WS-L-1-RESULT-REPORT.md                         (new, this file)
```

No unrelated files changed. `src-tauri/Cargo.toml` shows as modified in `git status` only because of a pre-existing line-ending (LF→CRLF) normalization artifact with an empty content diff; it was **not** staged or committed.

## Gates

All run from a clean checkout on Windows, in the actual dev environment.

```
cargo fmt --check                                    → clean (one file needed `cargo fmt`, applied and re-verified clean)
cargo check                                           → Finished, 0 errors
cargo clippy --all-targets --all-features -- -D warnings → Finished, 0 warnings
cargo test --lib                                      → 453 passed; 0 failed; 61 ignored
cargo test --lib -- --ignored safe_upgrade             → 3 passed; 0 failed
cargo test --lib -- --ignored embedded_setup           → 5 passed; 0 failed
npm run typecheck                                      → clean
npm run lint                                           → clean
npm test -- --run                                      → 605 passed; 0 failed (60 files)
npm run build                                          → succeeded (pre-existing chunk-size warning only)
```

`cargo test --lib -- --ignored safe_upgrade` is the WS-K-5 safe-upgrade fixture: it deletes the newest migration's `schema_state` bookkeeping row and re-applies it, which is exactly the idempotency proof this migration needs (its own Section 8 sets `schema_state` and every `CREATE OR REPLACE` / `ADD COLUMN IF NOT EXISTS` / `ON CONFLICT DO NOTHING` in it is written to be safe on a second run — confirmed directly in the SQL suite's assertion 16 too). `cargo test --lib -- --ignored embedded_setup` proves a **fresh install** applies all 158 migrations end-to-end without error.

## SQL suites

Run individually against a throwaway PostgreSQL 18 cluster, bootstrapped exactly as `.github/workflows/ci.yml` does (roles, representative `_sqlx_migrations` row, one `OPEN` fiscal period), with all 158 migrations applied in filename order.

| Suite | Result |
|---|---|
| `catalog/s2_001_catalog_integration.sql` | PASS |
| `catalog/ws_d_001_catalogue_foundation_integration.sql` | PASS |
| `catalog/ws_d_003_active_attribute_filtering_integration.sql` | PASS |
| `inventory/r8_d_catalog_inventory_integration.sql` | PASS |
| `inventory/s2_003_zero_quantity_safeguards_integration.sql` | PASS |
| `procurement/s3_001_procurement_integration.sql` | FAIL (pre-existing, expected) |
| `procurement/s3_002_landed_cost_and_invoices_integration.sql` | FAIL (pre-existing, expected) |
| `procurement/s3_003_supplier_returns_and_payments_integration.sql` | FAIL (pre-existing, expected) |
| `procurement/r2_financial_semantics_integration.sql` | FAIL (pre-existing, expected) |
| `procurement/r8_e_procurement_integration.sql` | FAIL (pre-existing, expected) |
| `procurement/direct_purchase_acceptance_integration.sql` | PASS |
| `procurement/ws_e_002_purchase_payment_integration.sql` | PASS |
| `procurement/ws_e_003_purchase_return_integration.sql` | PASS |
| `receivables/s4_001_credit_sale_integration.sql` | PASS |
| `sales/ws_f_004_credit_limit_warning_integration.sql` | PASS |
| `cash/ws_f_005_cash_session_completion_integration.sql` | PASS |
| `cash/ws_f_005b_cash_out_approval_integration.sql` | PASS |
| `sales/ws_f_006_sale_void_integration.sql` | PASS |
| **`documents/ws_l_001_journals_documents_integration.sql`** | **PASS** (16 assertions + idempotent re-run) |
| `receivables/s4_001_customer_payment_integration.sql` | PASS |
| `cash/s4_002_cash_session_lifecycle.sql` | PASS |
| `cash/s4_002_cash_session_ownership_integration.sql` | PASS |
| `receivables/s4_003_drawer_refund_integration.sql` | PASS |
| `onboarding/r0_001_historical_finance_staging_integration.sql` | PASS |
| `onboarding/r0_001_excel_correction_reuse_integration.sql` | PASS |
| `onboarding/r0_001_setting_audit_integration.sql` | PASS |
| `onboarding/r0_001_onboarding_backup_acl_integration.sql` | PASS |
| `onboarding/r0_002_historical_trade_staging_integration.sql` | PASS |
| `onboarding/r0_003_historical_expenses_benefit_integration.sql` | PASS |
| `onboarding/r0_004_historical_line_party_benefit_integration.sql` | PASS |
| `onboarding/r0_005_historical_product_alias_integration.sql` | PASS |
| `onboarding/r5_002_opening_state_reconciliation_integration.sql` | PASS |
| `onboarding/r5_003_opening_state_setup_lifecycle_integration.sql` | PASS |
| `onboarding/r5_003_opening_state_application_integration.sql` | PASS |
| `recovery/r6_001_recovery_authorization_audit_integration.sql` | PASS |
| `recovery/r6_001_backup_role_read_privileges_integration.sql` | PASS |
| `recovery/r6_001_sqlx_metadata_backup_acl_integration.sql` | PASS |
| `recovery/r6_002_restore_verification_authorization_integration.sql` | PASS |
| `recovery/ws_h_003_recovery_foundation_integration.sql` | PASS |
| `inventory/s2_002_stock_adjustment_integration.sql` (own BEGIN/ROLLBACK) | PASS |

Exactly the five known, pre-existing procurement failures fail; nothing else does. `ws_l_001_journals_documents_integration.sql` was additionally re-run on its own (with the migration file re-applied a second time inside it, per its own assertion 16) and passed cleanly both times.

## Journal/document type pairing query output

Run on the throwaway database after all suites had run:

```sql
SELECT je.source_type, bd.document_type, count(*)
FROM finance.journal_entries je
JOIN core.business_documents bd ON bd.id = je.source_id
WHERE je.source_type <> bd.document_type
GROUP BY 1, 2 ORDER BY 1, 2;
```

```
 source_type | document_type | count 
-------------+---------------+-------
(0 rows)
```

No document type's journal uses a mismatched `source_type` name; nothing to report under Blockers for this check.

## Column corrections made in Section 3

One correction, exactly as the brief's pitfall clause anticipated:

- **`receivables.customer_payments` has no `reference_number` column** (only `note`, per its `CREATE TABLE` in `20260730195000_customer_payments.sql:67-85`). The 0812-era `get_business_document_detail` (which Section 3 is built from) referenced `cp.reference_number` in the `CUSTOMER_PAYMENT` branch; this raised a live `column cp.reference_number does not exist` error when the SQL suite exercised that branch. Corrected to `cp.note` — the same substitution the working `procurement.supplier_payments` branch already makes correctly with its own (real) `reference_number` column, which needed no change. Nothing else in Section 3 was touched.

## Deviations

- **PURCHASE_TRANSACTION test fixture is a direct fixture insert, not a call to `procurement.post_purchase_transaction`.** The brief's §7a bootstrap list says to "copy from `src-tauri/tests/procurement/direct_purchase_acceptance_integration.sql`" for the purchase transaction — that file actually calls `inventory.confirm_direct_purchase`, which posts a `PURCHASE_RECEIPT`, not a `PURCHASE_TRANSACTION`. No existing test suite in the repository calls `procurement.post_purchase_transaction` (grepped across `src-tauri/tests/`); its `p_payload` is a large, undocumented JSON contract with no working example to copy. Since WS-L-1 is a **read-side** fix — proving `get_business_document_detail`/`search_business_documents` render a `PURCHASE_TRANSACTION` document correctly — and not a re-test of that posting function's own orchestration (which is WS-E/single-entry-purchase scope, already covered by its own suites), the suite instead inserts a `core.business_documents` row of type `PURCHASE_TRANSACTION` plus its `procurement.purchase_transactions`/`purchase_transaction_lines` rows directly, satisfying every FK the real function would also satisfy (`purchase_order_id`, `goods_receipt_id`, `supplier_invoice_id` each point at a real, POSTED `core.business_documents` row). Assertion 5 in the suite proves the detail function fills `supplier_name`, `supplier_code`, and `lines` correctly for this fixture. Flagging this for the Architect's awareness rather than silently reinterpreting "copy from" — if a real `post_purchase_transaction` call is wanted instead, that requires a documented payload contract first.
- Test suite's numbered list uses "9a"–"9e" and "11a"–"11c", "12a"–"12c" for readability where the brief's single numbered assertion actually bundles several independent checks (e.g. assertion 9 covers four different filter behaviours, assertion 11 covers three validation errors). No assertion from the brief was dropped; this is presentation only.

## Blockers / questions for the Architect

None. No pitfall from §5's list occurred (no missing unique constraint surprised `ON CONFLICT`, no pre-existing trigger name collision, `procurement.purchase_transactions` does have `supplier_snapshot` and `total_amount`).

## Pending manual checks

Everything in `WS-L-1-MANUAL-VERIFICATION.md` (created, committed in the code commit) is Windows/WebView2/printer-class verification that cannot be proven from Linux-style CI or this environment: the live discount field at the till, the Documents/Journals screens rendered in the actual WebView2 shell, French/Arabic RTL rendering of the new columns and labels, and the full click-through of cancellation cross-links and journal links in the running app. None of these were claimed as passing — they are listed as pending.

## Unrelated problems noticed

- `documents.get_business_document_reports`'s `type_amounts` breakdown (Section: pre-existing, migration `20260812120000`) does not include `SALE_VOID` in its amount aggregation `CASE`/`IN (...)` list, unlike the per-row `amount` CASE which this brief's Section 7/R3 edit did add `SALE_VOID` to. This means a cancelled sale's amount is counted in the row list but not in the type-breakdown summary totals. Out of scope for this brief (§0 explicitly excludes non-listed Reports-tab changes); noted for a future brief.
- `finance.list_journals` and `documents.list_business_documents` (the pre-WS-L-1 top-100 functions) are still present and still used nowhere after this change except by their own now-unused Rust commands/TS gateway functions, per the brief's explicit "do not delete" instruction. They are dead code from the UI's perspective as of this commit; flagging in case a later cleanup brief wants to formally retire them.

---

**Full commit hash:** `e8bbe951afb86d2df67dfa4f260da6bdf1806d4c`
**Pushed:** no — awaiting the Owner's explicit "yes" per §9.2.
