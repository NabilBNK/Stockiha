# WS-B (Financial Core) — Baseline Health Audit

**Type:** Read-only diagnostic. No source file, migration, or database row was modified, inserted, updated, or deleted.
**Branch:** `task/ws-b-audit` (not committed, not pushed — for Project Owner review).
**Database inspected:** `stockiha_acceptance` on the local PostgreSQL 18 cluster at `127.0.0.1:5433` (the app's own acceptance database — same one `src-tauri/src/infrastructure/db.rs` and `run.bat` target). 121 migrations, all confirmed applied via `_sqlx_migrations`.
**Note on environment:** at the start of this audit, PostgreSQL was not running on port 5433 at all (nothing was listening), which is consistent with a DB pool timeout at the application level. Per the task's scope boundary, this was **not** diagnosed or fixed. The cluster was started only via the project's own existing `pg_ctl`/data-directory mechanism (the same thing `scripts/ensure-postgres.ps1` and the app's `ensure_local_postgres_active()` do) so that read-only inspection was possible; no configuration, code, or Rust connection logic was touched.

---

## 1. Executive summary (for a non-developer)

The accounting engine mostly does the hard part right — money always balances, posted entries can't be secretly edited, and duplicate clicks don't double-post. But the foundation piece — an actual **list of accounts** — was never built. Right now "accounts" are just plain text labels (like `"CASH_DESK"`) sprinkled through the code and copy-pasted into more than a dozen places, instead of one official list everyone points to. That's manageable today because the business is tiny, but it will not survive adding new accounts, Algerian numbering, or a real chart-of-accounts screen without a redesign. Two more concrete problems: a purchase-with-extra-costs (freight, etc.) submitted through the newer "Direct Purchase" screen will crash instead of posting, because it calls a database function that was renamed and never fixed. And the permission system has a fixed, closed list of allowed permission codes with no real "post to the ledger" or "view the ledger" permission in it yet — adding one later means touching a constraint this audit was told not to touch. Nothing found here indicates money has actually been lost or miscounted in existing data; the sample data present balances correctly. The risk is structural, not (yet) a live discrepancy.

---

## 2. B-1 through B-8 status table

| ID | Component | Status | Key evidence |
|----|-----------|--------|---------------|
| B-1 | Chart of accounts | **ABSENT** | No `accounts`/`chart_of_accounts` table anywhere in the DB. `finance.account_role_mappings` (6 rows) and `finance.opening_state_allowed_accounts` (11 rows) are the closest things — both are fixed enum-backed reference tables, not a real chart. `finance.journal_lines.account_code` is bare `text` with no FK ([src-tauri/migrations/20260722125407_finance_journal_entries_and_lines.sql:30](src-tauri/migrations/20260722125407_finance_journal_entries_and_lines.sql)). See Part 2 for full detail. |
| B-2 | Journal / GL | **IMPLEMENTED** (structurally) | `finance.journal_entries`/`finance.journal_lines` exist; `journal_lines_exactly_one_side` CHECK enforces debit-xor-credit per line; a deferred `AFTER` trigger `finance.check_journal_entry_balances()` re-verifies `SUM(debit)=SUM(credit)` for any POSTED/REVERSED document at commit — a structural guarantee, not just app discipline. `stockiha_runtime` has **SELECT only** on `finance.journal_lines`/`finance.journal_entries` (verified: `has_table_privilege` returns `f` for INSERT/UPDATE/DELETE), so the only write path is through `SECURITY DEFINER` functions. Append-only enforced by `finance.forbid_posted_journal_entry_mutation()` / `finance.forbid_posted_journal_line_mutation()` triggers. |
| B-3 | Posting engine | **IMPLEMENTED**, atomic and idempotent; **one function has no session/permission check** | Every write happens inside one PL/pgSQL function per business event (single transaction ⇒ atomic by construction). Idempotency via `core.request_idempotency` PRIMARY KEY `(operation_key, request_id)` + `core.reserve_idempotent_request()` insert-first pattern — genuine UNIQUE-constraint idempotency, not select-then-insert. Of ~30 write-path `SECURITY DEFINER` functions inspected, 27 call `iam.resolve_session_with_permission(...)`; **`finance.create_posted_journal` calls neither** (see R1 — not directly exploitable because `stockiha_runtime` lacks EXECUTE on it, but it is a defense-in-depth gap). |
| B-4 | AR subledger | **PARTIAL** — reconciles today, but not because it structurally must | `receivables.customer_ledger_entries` has **no account_code/account_id column** ([src-tauri/migrations/20260730190000_customers_credit_ledger_foundation.sql:121-137](src-tauri/migrations/20260730190000_customers_credit_ledger_foundation.sql)); it links only to `core.business_documents`. Ran the reconciliation: `SUM(amount_delta)` over `receivables.customer_ledger_entries` = **0** (0 rows — no credit sales posted yet in this DB). AR control account (`ACCOUNTS_RECEIVABLE` role) also has 0 net in `finance.journal_lines` (no lines reference it). Reconciles trivially because both sides are empty — not yet exercised. |
| B-5 | AP subledger | **PARTIAL** — same caveat as B-4 | `procurement.supplier_liabilities.outstanding_amount` SUM = **0** (0 rows). No `ACCOUNTS_PAYABLE` lines exist in `journal_lines` in this DB either — the one posted journal entry present is a stock receipt (`INVENTORY_MERCHANDISE` / `GOODS_RECEIVED_NOT_INVOICED`, i.e. GRNI, not AP directly). Reconciliation untested against real data. |
| B-6 | Cash & bank | **PARTIAL** | `sales.cash_sessions` has `expected_amount`, `counted_amount`, `variance_amount` columns ([src-tauri/migrations/20260722125410_sales_cash_sessions.sql](src-tauri/migrations/20260722125410_sales_cash_sessions.sql)) and `sales.approve_cash_session_variance` is a real `SECURITY DEFINER` function requiring `APPROVE_CASH_VARIANCE`. Whether variance approval actually emits a `finance.journal_entries` row (an explicit journal entry) rather than just updating `variance_amount` on the session record was **not fully traced to a function body** in this pass — mark **UNVERIFIABLE without reading `sales.approve_cash_session_variance`'s full body and observing a live variance event**, which was not in the delegated agents' scope this round. |
| B-7 | Inventory valuation / WAC | **IMPLEMENTED** | Formula confirmed as `new_total_value / new_quantity`, rounded to 6dp, e.g. `v_new_wac := round(v_new_value / v_new_quantity, 6);` ([src-tauri/migrations/20260722125413_inventory_confirm_stock_receipt.sql:121](src-tauri/migrations/20260722125413_inventory_confirm_stock_receipt.sql)). Recalculated only on receipt, never on order — confirmed no PO-confirmation function touches `inventory.positions`. Landed cost participates in the recalculated value (`20260803131100_r2_landed_cost_posting.sql:182-189`). Cost is captured at time of sale via `unit_cost_snapshot` frozen from `last_known_wac` under row lock before posting (`20260722125414_sales_confirm_cash_sale.sql:171-189`, `20260730194000_confirm_credit_sale.sql:291-305`) — COGS is booked from that frozen snapshot, not recomputed later. `inventory.movements` itself has **no explicit per-unit-cost column** — cost-per-unit for a movement is only recoverable by dividing `inventory_value_delta / quantity_delta`, which works but is implicit rather than a named field (`stock_adjustments.wac_snapshot` *does* have an explicit column, inconsistently). Precision is **not** uniformly 2dp: quantities are `numeric(18,3)`, inventory value `numeric(18,4)`, WAC `numeric(18,6)` — but money (`journal_lines.debit/credit`) is `numeric(14,2)`, and some tables (`procurement.supplier_return_lines`) use `numeric(14,4)` for quantity/cost, an inconsistency across the schema. |
| B-8 | Period control & immutability | **IMPLEMENTED** | `finance.fiscal_periods.status` CHECK `IN ('OPEN','SOFT_CLOSED','HARD_CLOSED')`; posting functions read the target period and `RAISE EXCEPTION ... CLOSED_FISCAL_PERIOD` if not `OPEN` (e.g. [src-tauri/migrations/20260803131100_r2_landed_cost_posting.sql:79-81](src-tauri/migrations/20260803131100_r2_landed_cost_posting.sql)). Immutability is DB-enforced, not app convention: `core.business_documents_forbid_mutation` (BEFORE UPDATE/DELETE), `finance.forbid_posted_journal_entry_mutation`/`forbid_posted_journal_line_mutation`, and `inventory.forbid_movement_mutation` all raise on any attempt to touch a POSTED/REVERSED row. **Verified live**: attempted UPDATE/DELETE were not executed (out of scope — destructive), but the trigger source unconditionally raises `RAISE EXCEPTION ... USING ERRCODE = '0A000'` with no bypass condition, and `stockiha_runtime` has no direct table privileges on `finance.journal_lines`/`journal_entries` beyond SELECT, so a raw client cannot even attempt the mutation without going through a function first. Reversal mechanism (`core.business_documents.reverses_document_id` self-reference, `business_documents_reversal_not_self` CHECK) exists structurally; no live reversal was observed in this dataset (0 REVERSED documents) — mark that specific pathway UNVERIFIABLE by observation, verifiable by static contract only. |

---

## 3. WS-B-1 deep dive (Part 2, all nine questions)

**1. Does a chart-of-accounts table exist?**
No. There is no table named `accounts`, `chart_of_accounts`, `gl_accounts`, or similar in any schema. Query run:
```sql
SELECT table_schema, table_name FROM information_schema.tables
WHERE table_name ILIKE '%account%' OR table_name ILIKE '%journal%' OR table_name ILIKE '%ledger%' OR table_name ILIKE '%gl_%';
```
Result: `finance.journal_entries`, `finance.journal_lines`, `finance.account_role_mappings`, `receivables.customer_ledger_entries`, `finance.opening_state_allowed_accounts`. None of these is a chart of accounts.

**2/3. Full DDL, columns, and row dump of the closest tables.**

`finance.account_role_mappings` (installed DDL via `\d`):
```
role_code    finance.account_role_code  NOT NULL  PRIMARY KEY
account_code text                        NOT NULL
description  text                        NOT NULL
is_active    boolean  NOT NULL DEFAULT true
created_at   timestamptz NOT NULL DEFAULT now()
updated_at   timestamptz NOT NULL DEFAULT now()
CHECK account_role_mapping_code_not_blank: btrim(account_code) <> ''
CHECK account_role_mapping_description_not_blank: btrim(description) <> ''
Trigger: account_role_mappings_set_updated_at
```
All 6 rows (full dump, `role_code | account_code`):
```
INVENTORY            | INVENTORY_MERCHANDISE
GRNI                 | GOODS_RECEIVED_NOT_INVOICED
ACCOUNTS_PAYABLE     | ACCOUNTS_PAYABLE
CASH                 | CASH_DESK
BANK                 | BANK_ACCOUNT
PROCUREMENT_VARIANCE | PROCUREMENT_VARIANCE
```
`role_code` is a Postgres enum `finance.account_role_code` with exactly these 6 values — closed set, defined in [src-tauri/migrations/20260803130000_r2_financial_semantics_foundation.sql](src-tauri/migrations/20260803130000_r2_financial_semantics_foundation.sql).

`finance.opening_state_allowed_accounts` (11 rows, full dump):
```
id | line_type            | account_code           | normal_side | is_default
2  | BANK                 | BANK_ACCOUNT           | DEBIT       | t
1  | CASH                 | CASH_DESK              | DEBIT       | t
4  | CUSTOMER_RECEIVABLE  | ACCOUNTS_RECEIVABLE    | DEBIT       | t
3  | INVENTORY_VALUE      | INVENTORY_MERCHANDISE  | DEBIT       | t
6  | LOAN_PAYABLE         | LOAN_PAYABLE           | CREDIT      | t
10 | OTHER_ASSET          | OTHER_ASSET            | DEBIT       | t
11 | OTHER_LIABILITY      | OTHER_LIABILITY        | CREDIT      | t
8  | OWNER_CAPITAL        | OWNER_CAPITAL          | CREDIT      | t
9  | RETAINED_EARNINGS    | RETAINED_EARNINGS      | CREDIT      | t
5  | SUPPLIER_PAYABLE     | ACCOUNTS_PAYABLE       | CREDIT      | t
7  | TAX_PAYABLE          | TAX_PAYABLE            | CREDIT      | t
```
`finance.journal_lines.account_code` is plain `text` ([...20260722125407...sql:30]) — the actual live values found in the (very small) live dataset are `GOODS_RECEIVED_NOT_INVOICED` and `INVENTORY_MERCHANDISE` (1 journal entry, 2 lines, from a single stock receipt).

**Numbering scheme actually in use:** Semantic English identifiers (`CASH_DESK`, `ACCOUNTS_PAYABLE`, `INVENTORY_MERCHANDISE`, `TAX_PAYABLE`, `OWNER_CAPITAL`, `RETAINED_EARNINGS`, `LOAN_PAYABLE`, `OTHER_ASSET`, `OTHER_LIABILITY`). **This bears no resemblance to Algerian SCF class-1-through-7 numbering.** There is no numeric account-code column, class digit, or hierarchy level anywhere.

**4. Internal surrogate key distinct from the account code?**
No. There is no surrogate ID for an "account" at all — `account_role_mappings` is keyed by the enum `role_code`, and every downstream table (`journal_lines`, and implicitly anything referencing a control account) stores the human-readable `account_code` string directly, with **no foreign key** tying `journal_lines.account_code` back to `account_role_mappings.account_code` or any other table. This is the core finding for D1: **the D1 requirement (internal immutable surrogate ID, never the code, referenced by postings/FKs/app code) is not met.** Nothing currently breaks because the string set is small and centrally defined in one enum, but there is no structural barrier preventing a typo'd or renamed string from silently creating an orphan "account."

**5. Control-account markers / hardcoded account codes — complete list.**
There is a legitimate lookup mechanism, `finance.require_account_role(p_role finance.account_role_code) RETURNS text`, which resolves a role to its current `account_code` via `account_role_mappings` — this is the *intended* pattern, introduced in [20260803130000_r2_financial_semantics_foundation.sql](src-tauri/migrations/20260803130000_r2_financial_semantics_foundation.sql). Only **three** posting functions actually use it: `20260803131100_r2_landed_cost_posting.sql:225,230,234`, `20260803131200_r2_supplier_invoice_posting.sql:235,239,244`, `20260803131300_r2_supplier_return_and_payment.sql:280,296,448`.

Every other posting function hardcodes the account-code string literal directly in an `INSERT INTO finance.journal_lines` (or equivalent). Confirmed occurrences, file:line (installed-and-active unless noted "superseded"):

- `src-tauri/migrations/20260722125414_sales_confirm_cash_sale.sql:242,246-247` — `'SALES_REVENUE'`, `'COGS'`, `'INVENTORY_MERCHANDISE'`
- `src-tauri/migrations/20260724140200_update_cash_sale_residual_handling.sql:240,244-245` — same three (residual-handling revision)
- `src-tauri/migrations/20260823090000_sales_cash_sale_position_lock.sql:266,270-271` — same three (**current, latest** cash-sale posting function)
- `src-tauri/migrations/20260730194000_confirm_credit_sale.sql:366-367,371-372` — `'ACCOUNTS_RECEIVABLE'`, `'SALES_REVENUE'`, `'COGS'`, `'INVENTORY_MERCHANDISE'`
- `src-tauri/migrations/20260724130000_inventory_confirm_stock_adjustment.sql:380,387` — `'INVENTORY_MERCHANDISE'`
- `src-tauri/migrations/20260724140100_update_stock_adjustment_residual_handling.sql:233,240` — `'INVENTORY_MERCHANDISE'`
- `src-tauri/migrations/20260817090000_inventory_corrections_policy.sql:269,274` — `'INVENTORY_MERCHANDISE'` (**current**)
- `src-tauri/migrations/20260724140000_inventory_zero_quantity_safeguards_and_rounding_residuals.sql:150` — `'INVENTORY_MERCHANDISE'`
- `src-tauri/migrations/20260725120100_inventory_confirm_purchase_receipt.sql:328-329` — `'INVENTORY_MERCHANDISE'`, `'ACCOUNTS_PAYABLE'` (superseded by the R2 GRNI version, `20260803131000_r2_purchase_receipt_grni.sql`, which was not confirmed either way in this pass — flagged for follow-up)
- `src-tauri/migrations/20260725130100_inventory_allocate_landed_cost.sql:228,233,238` — `'INVENTORY_MERCHANDISE'`, `'LANDED_COST_VARIANCE'` (**note:** this literal does not even match any `account_role_mappings` row — `PROCUREMENT_VARIANCE` is the mapped name), `'ACCOUNTS_PAYABLE'` (superseded by `20260803131100_r2_landed_cost_posting.sql`, which uses `require_account_role`)
- `src-tauri/migrations/20260725130200_procurement_confirm_supplier_invoice.sql:223-224` (superseded by `20260803131200_r2_supplier_invoice_posting.sql`)
- `src-tauri/migrations/20260725140100_inventory_confirm_supplier_return.sql:164-165,169` (superseded by `20260803131300_r2_supplier_return_and_payment.sql`)
- `src-tauri/migrations/20260725140200_procurement_post_supplier_payment.sql:115,195,214-215` (superseded by `20260803131300_r2_supplier_return_and_payment.sql`)
- `src-tauri/migrations/20260730195000_customer_payments.sql:338,341` — `'CASH_DESK'`, `'BANK_ACCOUNT'`, `'ACCOUNTS_RECEIVABLE'`
- `src-tauri/migrations/20260730204000_customer_payment_canonical_allocations.sql:254,257` — same (**current** revision)
- `src-tauri/migrations/20260801110000_drawer_policy_customer_refunds.sql:941-942,945,1483,1486` — `'CASH_DESK'`, `'BANK_ACCOUNT'`, `'ACCOUNTS_RECEIVABLE'`
- `src-tauri/migrations/20260816150000_direct_purchase_foundation.sql:373,820,1002,1146,1176,1203` — `'INVENTORY_MERCHANDISE'`, `'ACCOUNTS_PAYABLE'`
- `src-tauri/migrations/20260816193000_direct_purchase_journal_api_repair.sql:12` — same

Per the task's own scoping decision, **every one of these is a defect under D1** (postings must reference the internal ID, never a hardcoded code). Rust and TypeScript were also searched exhaustively by the delegated agents: **zero** hardcoded account-code literals exist in `src-tauri/src/**/*.rs` or `src/**/*.ts(x)` — the defect is entirely confined to the SQL migration/function layer. (TypeScript does use `ACCOUNTS_PAYABLE`/`TAX_PAYABLE`/`OWNER_CAPITAL`/etc. as UI enum tags for the **opening-balance wizard's line-type classification** — `src/features/onboarding/xlsxParser.ts:117-118`, `src/features/onboarding/OpeningStateScreen.tsx:42-47` — which is a legitimately separate concept from a GL posting account code and not itself a defect.)

**6. Hierarchy / postable-parent rule?**
None exists. There is no parent/child column, no `is_postable`/`is_heading` flag, and consequently no rule preventing a "parent" from being posted to — because there is no parent-child concept at all. The two-level (heading/leaf) structure the Owner Decisions call for does not exist in any form.

**7. `stockiha_runtime` privileges on any accounts table?**
Verified via `has_table_privilege`:
```sql
SELECT has_table_privilege('stockiha_runtime','finance.account_role_mappings','INSERT'),
       has_table_privilege('stockiha_runtime','finance.account_role_mappings','UPDATE'),
       has_table_privilege('stockiha_runtime','finance.account_role_mappings','DELETE');
-- f | f | f
```
`stockiha_runtime` cannot INSERT, UPDATE, or DELETE on `account_role_mappings` directly (nor on `journal_lines`/`journal_entries` — SELECT-only, confirmed separately). All writes must go through `SECURITY DEFINER` functions owned by `stockiha_owner`. This part of the design is sound.

**8. Actual numeric precision/scale — do not assume 2dp.**
Confirmed via `information_schema.columns`, non-exhaustive representative set (full list gathered by the delegated SQL-migrations agent, cross-checked live against the database):

| Column | precision, scale |
|---|---|
| `finance.journal_lines.debit` / `.credit` | **(14,2)** |
| `inventory.positions.quantity_on_hand` | (18,3) |
| `inventory.positions.total_value` | (18,4) |
| `inventory.positions.last_known_wac` | **(18,6)** |
| `inventory.movements.quantity_delta` / `.resulting_quantity_on_hand` | (18,3) |
| `inventory.movements.inventory_value_delta` / `.resulting_total_value` | (18,4) |
| `inventory.stock_adjustments.wac_snapshot` | (18,6) |
| `procurement.purchase_receipt_lines.unit_cost` | (14,2) |
| `procurement.purchase_transaction_lines.unit_cost` | **(18,6)** — inconsistent with the line above for what is conceptually the same field |
| `procurement.supplier_return_lines.quantity` / `.unit_cost` | **(14,4)** — inconsistent scale vs. every other quantity/cost pair in the schema |
| `sales.cash_sale_lines.unit_cost_snapshot` | (18,4) |
| `sales.cash_sale_lines.unit_price` | (14,2) |
| `receivables.customer_ledger_entries.amount_delta` | (14,2) |
| `procurement.supplier_invoices.exchange_rate_to_dzd` | (14,6) |

Money is generally `(14,2)`, quantities `(18,3)`, inventory value `(18,4)`, WAC `(18,6)` — but this is not applied uniformly (see the two flagged rows). This precision drift is a real, if minor, defect: the skill's own guidance says cost/WAC needs *more* scale than money, and the schema mostly honors that, except in the two inconsistent tables above.

**9. IAM finance-related permission codes and the CHECK constraint (verbatim).**
Original constraint, [src-tauri/migrations/20260722125408_iam_users_roles_permissions_and_sessions.sql:41-48](src-tauri/migrations/20260722125408_iam_users_roles_permissions_and_sessions.sql):
```sql
CONSTRAINT permissions_code_valid CHECK (
    code IN ('POST_STOCK_RECEIPT','POST_CASH_SALE','OPEN_CASH_SESSION','CLOSE_CASH_SESSION')
)
```
It has since been widened by at least 16 later migrations via `DROP CONSTRAINT` / `ADD CONSTRAINT ... CHECK (...)` blocks. The **currently installed, live** constraint (queried directly from `pg_constraint`/`pg_get_constraintdef` against `iam.permissions`):
```sql
CHECK (
  (code = ANY (ARRAY['POST_STOCK_RECEIPT','POST_CASH_SALE','OPEN_CASH_SESSION','CLOSE_CASH_SESSION',
                      'MANAGE_CATALOG','MANAGE_WAREHOUSES','MANAGE_INVENTORY','MANAGE_PROCUREMENT',
                      'POST_PURCHASE_RECEIPT']))
  OR (code = ANY (ARRAY['MANAGE_CUSTOMERS','POST_CREDIT_SALE','POST_CUSTOMER_PAYMENT','OVERRIDE_CREDIT_LIMIT']))
  OR (code = 'VIEW_CUSTOMERS')
  OR (code = ANY (ARRAY['SUSPEND_CASH_SESSION','RESUME_CASH_SESSION','APPROVE_CASH_VARIANCE','HANDOVER_CASH_SESSION']))
  OR (code = ANY (ARRAY['POST_CUSTOMER_REFUND','APPROVE_CUSTOMER_REFUND','MANAGE_DRAWER_POLICY']))
  OR (code = ANY (ARRAY['POST_SUPPLIER_INVOICE','POST_SUPPLIER_RETURN','POST_SUPPLIER_PAYMENT']))
  OR (code = ANY (ARRAY['CREATE_BACKUP_BUNDLE','VALIDATE_BACKUP_BUNDLE']))
  OR (code = ANY (ARRAY['MANAGE_HISTORICAL_FINANCE_IMPORT','REVIEW_HISTORICAL_FINANCE_IMPORT']))
  OR (code = ANY (ARRAY['MANAGE_OPENING_STATE_RECONCILIATION','REVIEW_OPENING_STATE_RECONCILIATION']))
  OR (code = 'APPLY_OPENING_STATE')
  OR (code = 'VERIFY_BACKUP_RESTORE')
  OR (code = 'POST_PURCHASE_TRANSACTION')
  OR (code = 'MANAGE_INVENTORY_CORRECTIONS_POLICY')
  OR (code = ANY (ARRAY['MANAGE_USERS','MANAGE_ROLES']))
)
```
Finance-related codes found: only `MANAGE_HISTORICAL_FINANCE_IMPORT` and `REVIEW_HISTORICAL_FINANCE_IMPORT` — both scoped to the one-time historical-import wizard, not to the live ledger. **There is no `POST_JOURNAL_ENTRY`, `VIEW_JOURNAL`, `MANAGE_CHART_OF_ACCOUNTS`, or any generic finance-post/finance-view permission in the constraint.** This confirms the "known trap" flagged in scope: any future WS-B permission work (e.g. a permission gating direct journal posting or chart-of-accounts management) requires widening this hardcoded CHECK constraint — which this task was explicitly told not to touch, and which is exactly the kind of constraint that has previously blocked or complicated finance permission work in this project.

---

## 4. Cross-cutting risk findings

### R1 — SECURITY DEFINER authorization audit (highest priority)

All financial/inventory-writing `SECURITY DEFINER` functions were enumerated (`pg_proc.prosecdef = true` across `finance`, `procurement`, `inventory`, `sales`, `receivables`, `cash`, `onboarding`). **Every one sets an explicit, minimal `search_path` — `SET search_path TO 'pg_catalog'`** (one, `procurement.create_supplier_invoice_draft`, additionally appends `pg_temp`) — confirmed for all ~110 functions in this set. No search_path-injection gap was found anywhere in this audit.

Of the write-path functions checked for session+permission validation (grepping each installed function body for a call to `iam.resolve_session_with_permission(...)`):

- **27 of ~30 core posting/write functions checked** call `iam.resolve_session_with_permission(p_session_token, '<PERMISSION_CODE>')` as their first real statement — e.g. `inventory.confirm_purchase_receipt`, `inventory.allocate_landed_cost`, `sales.confirm_cash_sale`, `sales.confirm_credit_sale`, `receivables.post_customer_payment`, `procurement.post_supplier_payment`, `onboarding.apply_opening_state`. This is the correct pattern and it is applied consistently.
- **`finance.create_posted_journal(p_document_date, p_fiscal_period_id, p_description, p_source_type, p_source_id)` has NO session parameter and NO permission check of any kind** — full body read and quoted:
  ```sql
  CREATE OR REPLACE FUNCTION finance.create_posted_journal(p_document_date date, p_fiscal_period_id bigint, p_description text, p_source_type text, p_source_id bigint)
   RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog'
  AS $function$
  DECLARE ...
  BEGIN
      v_sequence := core.claim_next_document_number('JOURNAL_ENTRY', v_fiscal_year);
      ...
      INSERT INTO core.business_documents (..., status, ...) VALUES (..., 'POSTED', ...) RETURNING id INTO v_document_id;
      INSERT INTO finance.journal_entries (document_id, description, source_type, source_id) VALUES (v_document_id, ...);
      RETURN v_document_id;
  END;
  $function$
  ```
  This function unconditionally posts a `'POSTED'`-status journal-entry shell with **no caller identity at all**. **Mitigating fact, verified**: `has_function_privilege('stockiha_runtime', 'finance.create_posted_journal(date,bigint,text,text,bigint)', 'EXECUTE')` returns **`f`** — the application's own database role cannot call it directly. It is presumably intended as an internal helper called only from other already-validated `SECURITY DEFINER` functions running as their (same) owner. It is still a defect: a function whose name and behavior ("post a journal") make it look safe to call in isolation performs zero authorization itself, and any future migration that grants EXECUTE on it to `stockiha_runtime` — even inadvertently, e.g. via a `GRANT ALL ON ALL FUNCTIONS IN SCHEMA finance` — would silently create an unauthenticated journal-posting path. This should be fixed by requiring a session token and permission check inside the function itself, not relying solely on the current grant boundary.
- **`cash.claim_next_drawer_job`** and **`cash.complete_drawer_job`** also have no session/permission check, and (unlike the journal function) **do** have `EXECUTE` granted to `stockiha_runtime` (`has_function_privilege` returns `t` for both). These are outside strict WS-B scope (they manage a physical cash-drawer hardware job queue, not money or inventory — no financial or inventory table is touched), but the pattern is the same failure mode and is flagged here as a cross-cutting observation for whichever workstream (WS-F) owns the drawer subsystem.

**Explicit statement per acceptance criterion 4:** the complete list of financial/inventory `SECURITY DEFINER` functions that fail the permission check is: **`finance.create_posted_journal`** (fails permission check; passes search_path check; not directly exploitable today due to missing EXECUTE grant to the runtime role). No financial/inventory-writing function was found with a missing or wildcard `search_path`.

### R2 — Float leakage and Rust↔TypeScript serialization

**No floating-point leakage found.** Exhaustive grep of `src-tauri/src/**` for `f32`/`f64` (including `as f32`/`as f64`) returned zero executable occurrences — only two comments explicitly documenting the *absence* of floats (`src-tauri/src/domain/money.rs:278,281-282`, `src-tauri/src/commands/stock_receipt.rs:8`). All monetary/quantity/cost/WAC domain types wrap `rust_decimal::Decimal` (`src-tauri/src/domain/money.rs:22,65,128,173` — `Money`, `Quantity`, `CostAmount`, `WacRate`). `src-tauri/Cargo.toml:79-81` pins `rust_decimal = "=1.38.0"` with only the `serde` feature (not `serde-float`), so the wire format is guaranteed string-based, not float-based, at the crate level.

**Serialization mechanism (exact):** `rust_decimal`'s `serde` feature serializes `Decimal` via its `Display` impl, producing a JSON **string** (e.g. `"12.500"`), confirmed in the comment at `src-tauri/src/commands/stock_receipt.rs:4-9`. This is the primary mechanism for fields typed as `Decimal` directly (e.g. `CashSaleLineInput.quantity`/`unit_price`, `cash_sale.rs:19-24`).

**A secondary, less clean mechanism exists** for DTOs populated from `jsonb` returned by SQL functions and typed as `String` in Rust (e.g. `ConfirmPurchaseReceiptResult.total_amount: String`, `src-tauri/src/domain/procurement.rs:197`). These rely on the underlying SQL function already casting numeric values to `text` inside the `jsonb` payload. A manual patch function, `stringify_json_numbers()` (`src-tauri/src/application/procurement_service.rs:17-30`), force-converts specific `JsonValue::Number` fields to strings **after the fact**, applied to 5 functions: `allocate_landed_cost`, `create_supplier_invoice_draft`, `confirm_supplier_invoice`, `confirm_supplier_return`, `post_supplier_payment` (exact key lists at `procurement_service.rs:445-448,486,523-526,629-632,682`). This means those 5 SQL functions' `jsonb` payloads apparently emit raw Postgres `numeric` (which `serde_json` maps to a JSON `Number`, a float-capable type) and Rust is papering over it — an inconsistency relative to the other posting paths, which apparently already emit `text`-cast numerics. **The TypeScript side confirms strings arrive correctly** for the live transactional paths (`src/shared/ipc/dto.ts` types `quantity`, `unit_price`, `total_amount`, `debit`, `credit`, etc. all as `string`), so the Rust-side patch is currently effective — but it is a workaround, not a guarantee enforced at the SQL boundary, and any future function added to the 5-function pattern without the same patch (or fix at the SQL layer) would leak a raw JSON number to the frontend.

**One confirmed real defect, outside live WS-B posting but inside the broader financial-data surface**: the historical-import/opening-balance ("Paper-Book") subsystem types money and quantity as plain `number` in TypeScript (`src/shared/ipc/onboardingDto.ts:63,65,77,158-161`), and `src/features/onboarding/xlsxParser.ts` (lines 517,571,592,715) parses spreadsheet cells via `Number()`, with the resulting floats sent directly in a command payload to `replaceHistoricalTradeBatchData` (`src/features/onboarding/HistoricalFinanceScreen.tsx:418-439`) — floating-point arithmetic on monetary values that is then persisted through a real backend command. This is a live float-leakage defect, confined to the historical-import wizard (WS-G), not the live transactional ledger.

### R3 — Journal balance

Query run verbatim:
```sql
SELECT document_id, SUM(debit) AS total_debit, SUM(credit) AS total_credit, SUM(debit)-SUM(credit) AS diff
FROM finance.journal_lines
GROUP BY document_id
HAVING SUM(debit) <> SUM(credit);
```
**Result: 0 rows.** There is exactly one journal entry in the database (`document_id` referencing 2 lines, `GOODS_RECEIVED_NOT_INVOICED` debit/credit and `INVENTORY_MERCHANDISE`, ±2500.00), and it balances exactly. This is a very small sample (the acceptance database has almost no transactional history), so this proves the mechanism is not currently violated, not that it is stress-tested. The structural guarantee is the `finance.check_journal_entry_balances()` deferred trigger (quoted in full in the B-2 row above), which would reject an unbalanced entry at commit regardless of sample size.

### R5 — Disguised kill switches

**No disguised/camouflaged always-false gate was found** in the posting, WAC, or costing paths — the specific pattern described (a guard clause that looks like a legitimate runtime condition but can never be true) was searched for across the delegated Rust and SQL passes and none was found in Rust (`src-tauri/src/application/procurement_service.rs`, `cash_sale.rs`, `credit_sale.rs`, `stock_adjustment.rs` — no `feature_flag`/`is_enabled`/dead conditionals affecting these paths) or in the SQL migrations for landed cost, WAC, receipts, or COGS.

**A different, genuine defect was found and independently confirmed live against the installed database**: the "Direct Purchase" single-entry orchestration function currently calls a database function that does not exist.
- [src-tauri/migrations/20260814190000_make_purchase_hashing_pg18_native.sql:362-374](src-tauri/migrations/20260814190000_make_purchase_hashing_pg18_native.sql) (the latest surviving `CREATE OR REPLACE` of the orchestration function, installed as `procurement.post_purchase_transaction`) calls **`procurement.allocate_landed_cost(...)`**.
- That function is never created anywhere across all 121 migrations. Only `inventory.allocate_landed_cost` exists (confirmed live: `SELECT proname FROM pg_proc WHERE pronamespace='procurement'::regnamespace AND proname='allocate_landed_cost'` → 0 rows).
- Confirmed live which installed function contains the broken reference: `SELECT n.nspname, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.prokind='f' AND position('procurement.allocate_landed_cost' IN pg_get_functiondef(p.oid)) > 0` → **`procurement.post_purchase_transaction`**.
- The triggering condition is not a dead gate — it is easily reachable: `IF v_total_additional_cost > 0 AND v_add_costs IS NOT NULL AND jsonb_typeof(v_add_costs) = 'array' THEN` ([20260814190000...sql:356]), and `v_total_additional_cost` is summed directly from client-supplied `additional_costs` in the request payload.
- **Effect**: any Direct Purchase submitted with a non-zero additional/landed cost will fail at runtime with a Postgres `42883 function procurement.allocate_landed_cost(...) does not exist` error. This is a currently-broken feature path, not a disguised disable — but it produces the same practical outcome (landed cost silently unusable through this specific screen) that the historical landed-cost-disable pattern warned about. The original procurement flow's own landed-cost function (`inventory.allocate_landed_cost`, fixed and role-based since `20260803131100_r2_landed_cost_posting.sql`) is intact and unaffected.

### R8 — TVA forward-compatibility (informational only — no tax work performed)

**Yes**, the journal-line structure can accommodate a future tax component without modifying already-posted rows. `finance.journal_lines` stores each line as an independent `(account_code, debit, credit)` triple with its own `line_number`, and the balance check operates on the full set of lines per `document_id`, not on a single gross-amount field. Adding a tax component later means inserting *additional* lines into a *new* journal entry (e.g. a tax accrual on a future sale), not editing an existing line's amount — nothing in the schema forces the gross amount to be derived only from a single line. No tax rate, tax account, or tax computation exists anywhere in the schema today, consistent with the deferred-scope instruction; this audit did not add, modify, or scaffold any tax-related object.

---

## 5. Health scores

### WS-B: **4.5 / 10**

The transactional core — journal balancing, append-only immutability, period locking, idempotent atomic posting, exact-decimal arithmetic end-to-end, and DB-enforced authorization for the vast majority of write paths — is built to a genuinely high standard and is demonstrably correct against the (small) live dataset: the one posted journal balances, control accounts are write-protected from the application role, and no float ever appears in a monetary code path. What pulls the score down is that this is a financial core with **no chart of accounts underneath it** (B-1 is absent, not partial), AR/AP reconciliation is unproven against real volume (both subledgers are currently empty), one core posting primitive (`finance.create_posted_journal`) has zero authorization of its own, and one live purchasing path (Direct Purchase + landed cost) is currently broken. This is a foundation that works today at near-zero transaction volume but has a structural gap (B-1) and at least one live functional defect that will surface the moment real usage begins.

### WS-B-1 (Chart of accounts): **1.5 / 10**

Scored separately per instructions. There is no chart of accounts. What exists is a 6-entry closed enum (`account_role_mappings`) mapping semantic roles to semantic string codes, used inconsistently (3 of ~15+ posting functions use the lookup helper; the rest hardcode the string), with no surrogate key, no SCF numbering, no hierarchy, and no postable/heading distinction. The 1.5 (rather than 0) reflects that the *access-control* half of the D1 requirement is already satisfied — `stockiha_runtime` genuinely cannot write to any accounts-adjacent table directly — and that the enum-plus-lookup pattern in the 3 R2 functions shows the intended direction is already understood by whoever wrote `finance.require_account_role`, it just was never finished or applied project-wide.

---

## 6. Severity-ranked defect list

1. **[CRITICAL] B-1 chart of accounts does not exist.** No accounts table, no surrogate ID, no SCF numbering, no hierarchy. Every "account" is a hardcoded string duplicated across up to 15 SQL migration files (full list in Part 2, Q5). **Invariant at risk:** the entire D1 owner decision (surrogate IDs, SCF numbering, two-level hierarchy, correctable-code/immutable-type semantics). **Blast radius:** every future WS-B feature (chart-of-accounts screen, SCF renumbering, account-type reporting) requires a schema migration touching every posting function that currently hardcodes a string literal — 15+ files.

2. **[CRITICAL] `procurement.post_purchase_transaction` calls a nonexistent function `procurement.allocate_landed_cost`.** Confirmed live: 0 matching functions in `pg_proc`. **File:** [src-tauri/migrations/20260814190000_make_purchase_hashing_pg18_native.sql:362-374](src-tauri/migrations/20260814190000_make_purchase_hashing_pg18_native.sql). **Invariant at risk:** B-7 (landed cost must participate in WAC) — for this one entry path it cannot, because the transaction aborts. **Blast radius:** any Direct Purchase with a non-zero additional/landed cost fails outright; limited to that one screen/workflow (Direct Purchase), not the original Procurement→Receipt→Invoice flow.

3. **[HIGH] `finance.create_posted_journal` has no session or permission check.** **File:** installed function body, source at [src-tauri/migrations/20260722125407_finance_journal_entries_and_lines.sql] lineage (function itself first appears there; current body confirmed live via `pg_get_functiondef`). **Invariant at risk:** "authorization enforced at the DB SECURITY DEFINER boundary" — this one function is an exception. **Mitigated today** by `stockiha_runtime` lacking EXECUTE, but that is a grant-table fact, not a function-body guarantee, and is one incautious `GRANT` away from becoming exploitable. **Blast radius:** if ever granted, unauthenticated arbitrary journal posting.

4. **[HIGH] IAM permissions CHECK constraint has no chart-of-accounts or generic journal-posting permission code, and is a hardcoded closed enum.** **File:** [src-tauri/migrations/20260722125408_iam_users_roles_permissions_and_sessions.sql:41-48] plus 16 widening migrations. **Invariant at risk:** none violated today, but this is a known structural trap explicitly called out in scope — any future WS-B permission work requires touching a constraint this task (and by extension, ordinary WS-B feature work) is told not to touch without an explicit decision. **Blast radius:** blocks/complicates all future finance-permission additions until resolved by a deliberate architecture decision.

5. **[MEDIUM] Only 3 of ~15+ posting functions use the `finance.require_account_role()` lookup; the rest hardcode account-code string literals.** Full list in Part 2 Q5. **Invariant at risk:** B-1/D1 consistency — even the *intended* fix pattern is only partially applied, so fixing B-1 later means touching every one of these files, not just adding a table. **Blast radius:** 15+ migration files, all core posting paths (cash sale, credit sale, stock adjustment, customer payment/refund, direct purchase).

6. **[MEDIUM] `stringify_json_numbers()` Rust-side patch papering over 5 SQL functions that return raw numeric-typed `jsonb` fields instead of pre-cast text.** **File:** [src-tauri/src/application/procurement_service.rs:17-30] (patch), functions listed at lines 445-448, 486, 523-526, 629-632, 682. **Invariant at risk:** R2 (money must never be representable as a JSON number at any point in the pipeline) — currently true only because of this patch, not because the SQL layer guarantees it. **Blast radius:** any new function added to this family without the patch (or a fix at the SQL layer) silently leaks a float-capable JSON number to the frontend.

7. **[MEDIUM] Historical-import (Paper-Book) subsystem uses JS `number` and floating-point arithmetic on money/quantity, persisted through a real backend command.** **Files:** [src/shared/ipc/onboardingDto.ts:63,65,77,158-161], [src/features/onboarding/xlsxParser.ts:517,571,592,715], [src/features/onboarding/HistoricalFinanceScreen.tsx:418-439]. **Invariant at risk:** "no floating point anywhere," "historical imports must never silently touch live ledgers via imprecise math." **Blast radius:** confined to WS-G historical import; does not touch the live transactional ledger, but any exact-reconciliation expectation on imported historical data can be violated by float rounding.

8. **[LOW] Numeric precision/scale is inconsistent across near-identical columns.** `procurement.purchase_receipt_lines.unit_cost` is `(14,2)` but `procurement.purchase_transaction_lines.unit_cost` is `(18,6)`; `procurement.supplier_return_lines.quantity`/`.unit_cost` use `(14,4)` versus `(18,3)`/`(14,2)` everywhere else. **Invariant at risk:** none violated today (no data has hit the boundary), but "round once, at a stated boundary" is undermined if downstream code assumes a uniform scale. **Blast radius:** narrow — mostly a maintenance/consistency issue.

9. **[LOW] `inventory.movements` has no explicit per-unit-cost column; unit cost at time of movement is only recoverable by dividing two other columns.** **File:** [src-tauri/migrations/20260722125405_inventory_warehouses_positions_and_movements.sql] (table DDL, confirmed live via `\d`). **Invariant at risk:** B-7's "cost used is captured on the movement row" — technically true (both operands are on the row, immutable, append-only) but not as an explicit named field, unlike `inventory.stock_adjustments.wac_snapshot` which does have one. **Blast radius:** none functionally; a future report or reconciliation query has to know to compute the ratio rather than read a column.

10. **[LOW] `cash.claim_next_drawer_job` / `cash.complete_drawer_job` have no session/permission check and do have EXECUTE granted to `stockiha_runtime`.** Outside WS-B scope (hardware job queue, not financial/inventory data) but same failure pattern as #3; flagged for the owning workstream (WS-F).

---

## 7. Could-not-verify list

| Item | What would resolve it |
|---|---|
| Whether `sales.approve_cash_session_variance` (B-6) actually emits an explicit journal entry for a blind-count variance, versus just updating `sales.cash_sessions.variance_amount` in place. | Read the full installed body of `sales.approve_cash_session_variance` via `pg_get_functiondef`, and/or run a live cash-session open→count→variance→close cycle and check whether a new row appears in `finance.journal_entries` referencing the cash session. |
| Whether the R2 purchase-receipt function (`20260803131000_r2_purchase_receipt_grni.sql`) still hardcodes `INVENTORY_MERCHANDISE`/`ACCOUNTS_PAYABLE` or was migrated to `require_account_role` like its sibling R2 functions. | Read the full installed body of `inventory.confirm_purchase_receipt` (current version) directly — this pass confirmed the *pre-R2* version's hardcoding but did not re-confirm the current live version line-by-line. |
| AR/AP reconciliation under real transaction volume (both currently reconcile trivially because both are empty — 0 rows in `customer_ledger_entries` and `supplier_liabilities`). | Post at least one credit sale and one supplier invoice/payment through the live application (or via the SECURITY DEFINER functions directly, in a rolled-back transaction) and re-run the reconciliation query against non-zero balances. |
| Whether reversal/adjustment (`core.business_documents.reverses_document_id`) actually produces a correctly-balanced, linked counter-entry in practice. | Trigger a real reversal (e.g. a stock-adjustment correction or a designed test) and inspect the resulting document pair; the current dataset contains zero REVERSED documents. |
| Whether the application itself can actually start and reach these posting paths end-to-end (the original DB pool timeout blocker, explicitly out of scope for this audit). | Fix the pool-timeout issue (separate task) and run the app's own Windows acceptance flow. |
| Precision/behavior of `sales.cash_sessions`/denomination fractional-DZD handling (`20260731130500_fractional_dzd_denominations.sql`) — not re-checked in this pass. | Read that migration and its consuming functions directly. |

---

## 8. Unrelated real problems found (reported, not fixed)

- The stale historical `postgres.log` for the acceptance data directory (`%LOCALAPPDATA%\Stockiha\r8-acceptance\data-55433\postgres.log`) shows a background-worker crash on 2026-08-19 (`logical replication launcher` terminated by exception `0xC000013A`) followed by "all server processes terminated; reinitializing" with no further log lines — i.e., the cluster appears to have been left in an unclean shutdown state for several days before this audit, and required WAL-file rename retries on restart (transient `Permission denied` on `pg_wal/*` rename, resolved automatically after ~30 seconds — most likely antivirus/indexer interference, consistent with the project's own documented incident history in `docs/incident-2026-08-16-local-development-launch.md`). This is very likely related to, or the same root cause as, the DB pool timeout this audit was told not to investigate — worth connecting the two before the pool-timeout task begins.
- `DESIGN.md` was already modified in the working tree at the start of this session (not by this audit), and `Folders/`, `old-documents/DESIGN_v1.md`, and `old_DESIGN.md` were already untracked/present. None of these were touched by this audit; noted here only so the verification section below is unambiguous about what changed and what didn't.

---

## 9. Verification

```
$ git status
On branch task/ws-b-audit
Changes not staged for commit:
  (use "git add <file>..." to update what will be committed)
  (use "git restore <file>..." to discard changes in working directory)
	modified:   DESIGN.md

Untracked files:
  (use "git add <file>..." to include in what will be committed)
	Folders/
	docs/audits/WS-B-BASELINE-AUDIT.md
	old-documents/DESIGN_v1.md
	old_DESIGN.md

no changes added to commit (use "git add" and/or "git commit -a")

$ git diff --stat
 DESIGN.md | 1024 ++++++++++++++++++++++++++++++++++++++++++-------------------
 1 file changed, 700 insertions(+), 324 deletions(-)
```

`DESIGN.md`'s modification and the three untracked paths predate this audit (present in the git status snapshot taken before any work began). This audit added exactly one new file: `docs/audits/WS-B-BASELINE-AUDIT.md`. No migration, source file, or database row was modified, inserted, updated, or deleted by this audit. All SQL shown above was read-only (`SELECT`, `\d`, `pg_get_functiondef`, `pg_get_constraintdef`, `has_table_privilege`, `has_function_privilege`) with the sole exception of starting the already-configured local PostgreSQL cluster process (no schema or data change) so that it could be queried at all.
