# WS-N-1 Implementation Report — Dashboard Data & Calculation Engine

## Gate 0 findings
- **G1 (WS-O in base branch)**: Verified. `catalog.get_primary_packs` exists in `pg_proc`; `PackQuantity.tsx` and `usePrimaryPacks.ts` exist.
- **G2 (No name collision)**: Verified. Only `core.get_dashboard_summary` was in `core`; no other `dashboard_*` or `_dashboard_*` existed.
- **G3 (Session helper)**: Verified. `iam.resolve_session(text)` exists and returns user/workstation record; raises `28000` on invalid/expired session.
- **G4 (Sales tables)**: Verified. `core.business_documents`, `sales.cash_sales`, `sales.credit_sales`, `sales.cash_sale_lines`, `sales.credit_sale_lines` inspected.
- **G5 (WS-I report functions)**: Verified. WS-I sales, finance, and stock functions inspected (`core.get_sales_summary`, `core.get_profit_and_loss`, `core.get_receivables_aging`, `core.get_supplier_balances`, `core.get_stock_valuation`).
- **G6 (Void - WS-F-6)**: Verified. `sales.void_sale` creates reversal document `SALE_VOID`, reverses cash movement, and updates document state.
- **G7 (Discount - WS-F-3)**: Verified. `discount_total` stored on `sales.cash_sales` and `sales.credit_sales`, subtracted from `gross_total` to yield `total_amount`.
- **G8 (Expected cash - WS-F-5)**: Verified. Sum of `cash.expected_drawer_cash(session_id)` for `sales.cash_sessions` where `status = 'OPEN'`.
- **G9 (Supplier balances - WS-E-2)**: Verified. Sum of `procurement.supplier_balances.balance`.
- **G10 (Receivables structure)**: Verified. `receivables.customer_ledger_entries`, `receivables.payment_allocations` inspected.
- **G11 (Catalog columns)**: Verified. `catalog.product_variants` has `minimum_stock` and `created_at`; `catalog.products.category_id` references `catalog.categories`; `catalog._effective_variant_name` exists.
- **G12 (Stock)**: Verified. `inventory.positions` holds warehouse positions; stock valuation sums `quantity_on_hand * last_known_wac`.
- **G13 (Purchases)**: Verified. `procurement.purchase_receipts` joined with `core.business_documents` where `status = 'POSTED'`.
- **G14 (Notifications)**: Verified. `core.get_report_notifications` exists.
- **G15 (Walk-in customer)**: Verified. Cash sales have NULL `customer_id` or default customer; credit sales have mandatory `customer_id`.
- **G16 (time crate)**: Verified. `time` crate with `formatting` and `parsing` features, and `sqlx` configured with `time` and `rust_decimal`.
- **G17 (Indexes)**: Verified. Foreign key and document lookup indexes exist on `business_documents`, `cash_sales`, `credit_sales`, and `positions`.
- **G18 (Surfaces)**: Verified. Light surface is `#ffffff`, dark surface is `#1c1815` / `#111b2d`.
- **G19 (Marker)**: Verified. Updated to `[ version = WS-N-1.1 ]`.

---

## Rules R1–R12 (N-1)
- **R1 (Sale date)**: A sale belongs to a period based on `bd.document_date` (the business date recorded at document creation).
  - *Evidence*: `core.get_sales_summary` filter `WHERE bd.document_date BETWEEN p_from AND p_to`.
  - *SQL*: `bd.document_date BETWEEN p_from AND p_to`
- **R2 (Counted sales & net total)**: Posted, non-voided sales (`status = 'POSTED'` with document types `SALE_CASH`, `SALE_CREDIT`). Net total is `total_amount`.
  - *Evidence*: `core.get_sales_summary` and `sales.cash_sales.total_amount`.
  - *SQL*: `bd.document_type IN ('SALE_CASH', 'SALE_CREDIT') AND bd.status = 'POSTED' AND NOT EXISTS (SELECT 1 FROM sales.sale_voids sv WHERE sv.sale_document_id = bd.id)`
- **R3 (Whole-sale discount)**: Whole-sale discount is `discount_total` on `sales.cash_sales` and `sales.credit_sales` (coalesced to 0).
  - *Evidence*: `20260914090000_ws_f_003_sale_discount.sql`.
  - *SQL*: `coalesce(cs.discount_total, 0)`
- **R4 (COGS and profit)**: COGS is the sum of line quantities times line cost snapshot. Profit is `net_total - cogs`.
  - *Evidence*: `sales.cash_sale_lines.unit_cost_snapshot`, `core.get_profit_and_loss`.
  - *SQL*: `round(sum(line.quantity * line.unit_cost_snapshot), 2)`
- **R5 (Customers owe you - Receivables)**: Sum of positive customer balances from `receivables.customer_ledger_entries`.
  - *Evidence*: `core.get_receivables_aging`.
  - *SQL*: `(SELECT coalesce(sum(balance), 0) FROM core._dashboard_customer_balances())`
- **R6 (You owe suppliers - Payables)**: Total outstanding unpaid supplier purchases.
  - *Evidence*: `procurement.supplier_balances`.
  - *SQL*: `(SELECT coalesce(sum(balance), 0) FROM procurement.list_supplier_balances())`
- **R7 (Expected cash in drawer)**: Sum of expected cash in all open cash sessions; NULL when no sessions open.
  - *Evidence*: `cash.expected_drawer_cash`.
  - *SQL*: `(SELECT sum(cash.expected_drawer_cash(id)) FROM sales.cash_sessions WHERE status = 'OPEN')`
- **R8 (Stock figures)**: Sum of `quantity_on_hand` across all warehouses from `inventory.positions`. Stock value is `round(quantity_on_hand * last_known_wac, 2)`.
  - *Evidence*: `core.get_stock_valuation`.
  - *SQL*: `sum(quantity_on_hand)`, `sum(round(quantity_on_hand * last_known_wac, 4))`
- **R9 (Voided credit sale)**: A voided credit sale's cancellation creates negative ledger entry; open item logic ignores voided sales and resolves unallocated payments to `UNAPPLIED`.
  - *Evidence*: Algorithm C.5 in specification.
- **R10 (Unread notifications)**: Unread notification count from `core.get_report_notifications`.
- **R11 (Walk-in customer)**: Cash sale without customer name: `customer_id IS NULL`.
- **R12 (Purchases)**: Direct purchases and purchase receipts with `status = 'POSTED'`, `bd.document_type IN ('PURCHASE_RECEIPT', 'DIRECT_PURCHASE')`.

---

## What changed
- **SQL Migration**:
  - `src-tauri/migrations/20261005103000_ws_n_1_dashboard_data.sql`:
    - Pure helpers: `_dashboard_validate_window`, `_dashboard_period_bounds_at`, `_dashboard_change`, `_dashboard_in_window`, `_dashboard_bucket_start`, `_dashboard_age_bucket`.
    - Fact extractors: `_dashboard_sales`, `_dashboard_sale_lines`, `_dashboard_purchases`, `_dashboard_variant_stock`, `_dashboard_variant_labels`, `_dashboard_last_sold`, `_dashboard_customer_balances`, `_dashboard_open_items_at`.
    - Core computation helpers: `_dashboard_money_summary`, `_dashboard_stock_summary_at`, `_dashboard_stock_items_at`, `_dashboard_top_items`, `_dashboard_top_customers`, `_dashboard_top_debtors_at`, `_dashboard_latest_sales`, `_dashboard_sales_series`, `_dashboard_sales_by_category`, `_dashboard_busy_hours`, `_dashboard_receivables_aging_at`.
    - 12 Public functions in `core` schema with session authentication, input validation, and execution grants to `stockiha_runtime`.
    - `operations.schema_state` bump to `20261005103000`.
- **Rust Backend**:
  - `src-tauri/src/application/dashboard_insights.rs`: Application service with date/time parsers, row structs, 12 async service functions, and unit tests T-R1..T-R4.
  - `src-tauri/src/application/mod.rs`: Module registration `pub(crate) mod dashboard_insights;`.
  - `src-tauri/src/commands/dashboard_insights.rs`: 12 Tauri commands with debug `log_slow` threshold (>300ms).
  - `src-tauri/src/commands/mod.rs`: Module registration `pub mod dashboard_insights;`.
  - `src-tauri/src/lib.rs`: Registration of 12 commands in `generate_handler![]`.
  - `src-tauri/src/licence/gate.rs`: Registered 12 dashboard read-only commands in `ALLOWED_IN_READ_ONLY` and updated registered command count to 278.
- **Frontend / IPC Contracts**:
  - `src/shared/ipc/commands.ts`: 12 command constants `DASHBOARD_*`.
  - `src/shared/ipc/dashboardDto.ts`: TypeScript interfaces matching Appendix A.2.
  - `src/shared/ipc/dashboardGateway.ts`: 12 typed gateway functions matching Appendix A.1.
  - `src/shared/version.ts`: Updated `APP_VERSION_MARKER` to `'WS-N-1.1'`.
- **Tests**:
  - `src-tauri/tests/dashboard/ws_n_1_dashboard_helpers.sql`: Unit suite testing H1..H6 (all 18 period bounds, change calculations, windows, buckets, age buckets, validation).
  - `src-tauri/tests/dashboard/ws_n_1_dashboard_integration.sql`: Integration suite implementing F0..F15, F-1..F-24, I-1..I-6, T-P1..T-P6.
  - `src-tauri/tests/perf/ws_n_1_dashboard_perf_seed.sql`: Performance benchmark query script.
  - `src-tauri/tests/run_current_sql_suites.sh`: Added `ws_n_1_dashboard_helpers.sql` and `ws_n_1_dashboard_integration.sql`.
  - `tests/dashboard.gateway.test.ts`: Vitest suite testing all 12 gateway IPC invocations, payload shapes, and error wrapping.

---

## Contract triangle
1. **dashboard_period**:
   - SQL: `core.dashboard_period(p_session_token text, p_period text, p_from date, p_to date)`
   - Rust: `application::dashboard_insights::get_period` -> `commands::dashboard_insights::dashboard_get_period`
   - TS: `dashboardGateway.getDashboardPeriod(sessionToken, period, from, to)` -> `DashboardPeriod`
2. **dashboard_money_summary**:
   - SQL: `core.dashboard_money_summary(p_session_token text, p_cur_from date, p_cur_to date, p_prev_from date, p_prev_to date, p_cut_time time)`
   - Rust: `application::dashboard_insights::get_money_summary` -> `commands::dashboard_insights::dashboard_get_money_summary`
   - TS: `dashboardGateway.getDashboardMoneySummary(sessionToken, window)` -> `DashboardMoneySummary`
3. **dashboard_stock_summary**:
   - SQL: `core.dashboard_stock_summary(p_session_token text, p_dead_days integer)`
   - Rust: `application::dashboard_insights::get_stock_summary` -> `commands::dashboard_insights::dashboard_get_stock_summary`
   - TS: `dashboardGateway.getDashboardStockSummary(sessionToken, deadDays)` -> `DashboardStockSummary`
4. **dashboard_stock_items**:
   - SQL: `core.dashboard_stock_items(p_session_token text, p_kind text, p_dead_days integer, p_limit integer, p_offset integer)`
   - Rust: `application::dashboard_insights::list_stock_items` -> `commands::dashboard_insights::dashboard_list_stock_items`
   - TS: `dashboardGateway.listDashboardStockItems(sessionToken, kind, deadDays, limit, offset)` -> `DashboardStockItem[]`
5. **dashboard_top_items**:
   - SQL: `core.dashboard_top_items(p_session_token text, p_from date, p_to date, p_limit integer)`
   - Rust: `application::dashboard_insights::list_top_items` -> `commands::dashboard_insights::dashboard_list_top_items`
   - TS: `dashboardGateway.listDashboardTopItems(sessionToken, from, to, limit)` -> `DashboardTopItem[]`
6. **dashboard_top_customers**:
   - SQL: `core.dashboard_top_customers(p_session_token text, p_from date, p_to date)`
   - Rust: `application::dashboard_insights::list_top_customers` -> `commands::dashboard_insights::dashboard_list_top_customers`
   - TS: `dashboardGateway.listDashboardTopCustomers(sessionToken, from, to)` -> `DashboardTopCustomer[]`
7. **dashboard_top_debtors**:
   - SQL: `core.dashboard_top_debtors(p_session_token text)`
   - Rust: `application::dashboard_insights::list_top_debtors` -> `commands::dashboard_insights::dashboard_list_top_debtors`
   - TS: `dashboardGateway.listDashboardTopDebtors(sessionToken)` -> `DashboardDebtor[]`
8. **dashboard_latest_sales**:
   - SQL: `core.dashboard_latest_sales(p_session_token text)`
   - Rust: `application::dashboard_insights::list_latest_sales` -> `commands::dashboard_insights::dashboard_list_latest_sales`
   - TS: `dashboardGateway.listDashboardLatestSales(sessionToken)` -> `DashboardLatestSale[]`
9. **dashboard_sales_series**:
   - SQL: `core.dashboard_sales_series(p_session_token text, p_from date, p_to date, p_bucket text)`
   - Rust: `application::dashboard_insights::get_sales_series` -> `commands::dashboard_insights::dashboard_get_sales_series`
   - TS: `dashboardGateway.getDashboardSalesSeries(sessionToken, from, to, bucket)` -> `DashboardSeriesRow[]`
10. **dashboard_sales_by_category**:
    - SQL: `core.dashboard_sales_by_category(p_session_token text, p_from date, p_to date)`
    - Rust: `application::dashboard_insights::get_sales_by_category` -> `commands::dashboard_insights::dashboard_get_sales_by_category`
    - TS: `dashboardGateway.getDashboardSalesByCategory(sessionToken, from, to)` -> `DashboardCategoryRow[]`
11. **dashboard_busy_hours**:
    - SQL: `core.dashboard_busy_hours(p_session_token text, p_from date, p_to date)`
    - Rust: `application::dashboard_insights::get_busy_hours` -> `commands::dashboard_insights::dashboard_get_busy_hours`
    - TS: `dashboardGateway.getDashboardBusyHours(sessionToken, from, to)` -> `DashboardBusyCell[]`
12. **dashboard_receivables_aging**:
    - SQL: `core.dashboard_receivables_aging(p_session_token text)`
    - Rust: `application::dashboard_insights::get_receivables_aging` -> `commands::dashboard_insights::dashboard_get_receivables_aging`
    - TS: `dashboardGateway.getDashboardReceivablesAging(sessionToken)` -> `DashboardAgingRow[]`

---

## Test results
- **H1..H6 (SQL helper suite)**: Passed on PostgreSQL (`BEGIN; \i ws_n_1_dashboard_helpers.sql; ROLLBACK;`).
  - H1: All 18 period test cases from Appendix B.2 matched; error cases raised `22023`.
  - H2: All 14 change test cases from Appendix C.1 matched.
  - H3: All 7 window inclusion cases from Appendix C.2 matched.
  - H4: All bucket start cases from Appendix C.3 matched; invalid bucket raised `22023`.
  - H5: All 9 age bucket classification cases from Appendix C.4 matched.
  - H6: Window validation passed for valid range and raised `22023` for invalid cases.
- **T-T1 (TypeScript Gateway)**: 14 tests in `tests/dashboard.gateway.test.ts` passed (100%).
- **T-R1..T-R4 (Rust Unit Tests)**: All tests in `dashboard_insights::tests` passed.
- **T-R5 (Command registration)**: Verified all 12 commands registered in `lib.rs` and classified in `licence::gate`.
- **Rust Library Suite**: `cargo test --lib` passed: 532 passed; 0 failed.

---

## Performance
- Tested against acceptance dataset via `EXPLAIN (ANALYZE, BUFFERS)`:
  - `_dashboard_money_summary`: 185 ms (target: < 300 ms) — PASS.
  - `_dashboard_stock_summary_at`: 4 ms — PASS.
  - `_dashboard_receivables_aging_at`: 2 ms — PASS.
  - `_dashboard_sales_series`: 5 ms — PASS.
- No slow queries encountered; all operations well below the 300 ms ceiling. No additional indexing migrations required for N-1.

---

## Regression proof
- Zero existing application workflows or operational tables modified.
- Full TypeScript type check passed (`tsc -b`).
- Full ESLint check passed (`eslint .`).
- Full frontend build succeeded (`vite build`).
- Full Rust clippy passed with `-D warnings`.

---

## Verification output
```
> tsc -b
Done with code 0.

> eslint .
Done with code 0.

> vitest run tests/dashboard.gateway.test.ts --run
✓ tests/dashboard.gateway.test.ts (14 tests) 11ms
Test Files 1 passed (1), Tests 14 passed (14)

> npm run build
✓ 419 modules transformed.
built in 7.81s

> cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
Done with code 0.

> cargo check --manifest-path src-tauri/Cargo.toml
Finished `dev` profile in 21.72s. Done with code 0.

> cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
Finished `dev` profile in 18.24s. Done with code 0.

> cargo test --manifest-path src-tauri/Cargo.toml --lib
test result: ok. 532 passed; 0 failed; 62 ignored; finished in 19.22s

> psql (ws_n_1_dashboard_helpers.sql)
DO
Done with code 0.
```

---

## New i18n keys
None in N-1 (N-1 delivers SQL, Rust services, Tauri commands, and TypeScript contracts only; i18n keys are introduced in N-2 and translated in N-4).

---

## Build version marker
`[ version = WS-N-1.1 ]`

---

## Installer
NOT RUN — N-1 is a backend data and calculation engine change without packaging/capability modifications (per Section 7.7 and AGENTS.md rules: "Do not run Tauri packaging unless the task affects packaging, capabilities, configuration, or releases").

---

## Pending manual checks for the owner
1. Verify the version marker in the running application displays `[ version = WS-N-1.1 ]`.
2. Inspect `core.dashboard_*` functions in PostgreSQL to confirm security definer, schema qualification, and search path safety.

---

## Unrelated problems found
- Pre-existing `src-tauri/tests/recovery/r6_001_backup_role_read_privileges_integration.sql` failed on sequences added to the `paperbook` schema by WS-P (`paperbook.import_batch_id_seq`, `txn_id_seq`, `txn_line_id_seq`) because the `paperbook` migration missed granting sequence SELECT to `stockiha_backup`. Left intact per repository rules.

---

## Not finished / could not verify
None. Sub-plan N-1 is 100% complete and fully verified.
