# Stockiha — Architecture Decision Baseline v5.1 (Patched)

> **Architecture & Implementation Baseline** — Updated based on critical peer review. Patched with session-token identity, idempotency concurrency, tax/fiscal/numbering rules, corrected return costing, complete queue state machines, and procurement variance splits.

---

## 1. Executive Summary & Stack

Stockiha is a modular monolith stock, sales, procurement, and reporting system.
- **Desktop Client:** Tauri v2
- **Frontend:** React 19 + TypeScript + Vite
- **Backend/Application Layer:** Rust (Tokio async runtime, modularly decoupled for future LAN standalone API)
- **Database:** PostgreSQL 18.x (Windows Service) with connection pooling (SQLx)
- **Primary Language:** French (default), Arabic (full RTL with graphics fallback printing), and English
- **Base Currency:** Algerian Dinar (DZD)
- **Valuation:** Warehouse-specific Weighted-Average Cost (WAC)

---

## 2. Core Integrity & Security Policies

1. **Atomic Posting Boundary:** The database runtime role `stockiha_runtime` lacks direct modification permissions (`INSERT`, `UPDATE`, `DELETE`) on core ledgers (movements, payments, journals, positions). Day-to-day operations are executed exclusively through public database posting functions that act as atomic transaction entry points (e.g., `sales.confirm_cash_sale`).
2. **SECURITY DEFINER Protections:** All public posting database functions run under `SECURITY DEFINER` and are configured with:
  - A fixed, trusted `search_path` (e.g., `SET search_path = pg_catalog, sales, inventory, finance, core`).
  - `EXECUTE` privileges revoked from `PUBLIC` and granted specifically to `stockiha_runtime`.
  - Function owner is a dedicated non-login role (`stockiha_owner`). Runtime cannot modify function dependencies.
3. **Validated Application-Session Identity:** Posting functions do **not** receive a trusted `actor_user_id`. Instead, every protected call receives an opaque `application_session_token`. The database resolves the token against `iam.application_sessions` (which stores only `token_hash`, never the raw token) to retrieve the authenticated `user_id`, `workstation_id`, and active permissions. Rust authenticates the application user and issues the session token; the database validates it and records the resolved actor snapshot in audit and document records.
  - **Session table:** `iam.application_sessions` (`id`, `token_hash`, `user_id`, `workstation_id`, `created_at`, `expires_at`, `revoked_at`).
  - Every posting function verifies: token exists, is not expired, is not revoked, and the resolved user holds the required permission for the operation.
4. **Idempotency Control:** Every financial or ledger command requires a client-generated UUID (`request_id`). The system verifies the request against `core.request_idempotency` before execution, using the following concurrency algorithm:
  - **Table:** `core.request_idempotency` (`company_id`, `operation_key`, `request_id`, `canonical_payload_hash`, `result_document_id`, `created_at`) with `UNIQUE(company_id, operation_key, request_id)`.
  - **Algorithm:** (1) Attempt to insert the idempotency row. (2) If inserted, continue posting. (3) If it already exists, lock and read it. (4) If the payload hash differs, reject as an idempotency conflict. (5) If the payload hash matches and a result exists, return the original result. (6) Store `result_document_id` before transaction commit.
  - **Canonical hashing:** Payloads are serialized to a deterministic canonical form (sorted keys, normalized whitespace) before hashing. Semantically identical JSON with different key order must produce the same hash.
  - Transient failures (rollbacks) must **not** be cached as successful idempotency results.
5. **Double-Entry Journal Constraints:** The system enforces standard double-entry rules. The header and lines of a journal entry are immutable once marked `POSTED`. A deferred database constraint validates that the entry balances (Debits = Credits) prior to commit.
6. **Durable Print Spooling & Isolated Drawer Pulses:** Document rendering and physical printing are queued within the database transaction. Cash drawer openings are managed as a separate, idempotent queue (`cash.drawer_jobs`) to prevent multiple drawer pulses during receipt printing retries.
7. **Sandboxed Historical Isolation:** Historical ledger entries reside in the `history.*` schema. Import batches follow a lifecycle (`STAGING` → `VALIDATING` → `NEEDS_REVIEW` → `VALIDATED` → `LOCKED`). Only `LOCKED` batches are immutable. The runtime importer role must never post directly into active ledgers. Reconstruction replays `LOCKED` batches chronologically inside `reconstruction.*`. Discrepancies are reconciled by the CEO, resulting in explicit, audited adjustment documents in the live schema.

---

## 3. Critical Logical & Financial Rules

### A. Procurement Cleared Three-Way Match
To prevent double-counting inventory value and supplier liabilities, the accounting model follows a clearing account flow:
1. **Goods Receipt:**
   - Debit: `INVENTORY_MERCHANDISE` (Warehouse-specific WAC)
   - Credit: `GOODS_RECEIVED_NOT_INVOICED` (Clearing account)
2. **Supplier Invoice (matched to receipt lines):**
   - Debit: `GOODS_RECEIVED_NOT_INVOICED` (Clearing account)
   - Debit: `VAT_DEDUCTIBLE` (where applicable)
   - Credit: `SUPPLIER_PAYABLE`
   - **Price variance policy:** If the authoritative invoice unit price differs from the receipt estimate, the difference is split: the portion attributable to remaining stock adjusts `INVENTORY_MERCHANDISE`; the portion attributable to already-sold stock is posted to `PURCHASE_PRICE_VARIANCE` (or COGS). The business may alternatively adopt a policy of posting the entire difference to variance—this choice must be documented and applied consistently across periods.
   - **Additional matching cases:** Partial receipts, partial invoices, invoice-before-goods (accrual), goods-without-invoice, quantity mismatches, rejected goods, and supplier credit notes each require explicit handling in the posting matrix (companion document).
3. **Supplier Payment:**
   - Debit: `SUPPLIER_PAYABLE`
   - Credit: `CASH` or `BANK`

### B. Late Landed-Cost Attribution
When a transport or customs invoice is received after stock has been partially sold and pooled, the cost is allocated using an auxiliary receipt attribution layer (`inventory.receipt_cost_attribution`):
- Tracks `receipt_line_id`, `original_quantity`, `attributed_remaining_quantity`, `original_value`, and `late_cost_allocated`.
- **Attribution depletion convention:** FIFO attribution (first receipt's remaining quantity is depleted first). The chosen convention must never change between periods.
- Late cost is split proportionally based on `attributed_remaining_quantity / original_quantity`:
  - **Remaining stock portion:**
    - Debit: `INVENTORY_MERCHANDISE` (updating cached positions and WAC).
  - **Already-sold stock portion:**
    - Debit: `LANDED_COST_VARIANCE` / COGS.
  - **Credit (the funding side):**
    - Credit: `SUPPLIER_PAYABLE` (if invoiced on credit), or
    - Credit: `CASH` / `BANK` (if paid immediately), or
    - Credit: `ACCRUED_LANDED_COST` (if accrued before invoice).
- **Zero-quantity invariant:** If no attributed quantity remains for a receipt, the entire late cost goes to `LANDED_COST_VARIANCE` / COGS. A cost-only movement (`quantity_delta = 0`, `inventory_value_delta > 0`) is **only** permitted when `quantity_on_hand > 0`. If `quantity_on_hand = 0`, then `total_value` must equal `0`—no positive inventory value may exist against zero units.

### C. WAC Costing Ledger and Edge Cases
The inventory ledger stores two distinct deltas: `quantity_delta` and `inventory_value_delta`.
- **Zero-Quantity Safeguard:** When the physical quantity reaches exactly zero, `quantity_on_hand` and `total_value` are set to `0`. The `last_known_wac` remains stored separately to prevent rounding residuals from leaving dangling values.
- **Cost-Only Adjustments:** Landed-cost adjustments are written with `quantity_delta = 0` and `inventory_value_delta > 0`. This is only permitted when `quantity_on_hand > 0`. When an issue brings quantity to zero, any sub-centime rounding residual in `total_value` is cleared explicitly in the same movement.
- **Return Costing Rules (corrected):**
  - Customer return linked to original sale line: restore at the original sale-line snapshot cost.
  - Customer return without a reliable original line: use current WAC or an approved estimated cost.
  - Stock-count gain: use current WAC. If no current WAC exists (zero stock), require an approved estimated cost.
  - Quarantined return: same cost as the return entry, but placed in a quarantine location. Inspection approval may move stock from quarantine to available inventory without changing its value.
  - Quarantine status controls **availability and location**, not cost basis.

### D. Journal Model Rules
Every posted journal entry must satisfy:
- At least two lines.
- Non-negative debit and credit values.
- Exactly one side (debit OR credit) populated per line.
- Cannot be updated or deleted after posting.
- Journal states: `DRAFT`, `POSTED`, `REVERSED`. Reversals are written as new linked journal entries.
- Posting flow: create draft → add lines → validate ≥ 2 lines → verify total debit = total credit → mark `POSTED` → header and lines become immutable.
- Journal period, document date, and company must be validated inside the posting function.
- Required SCF account-role mappings must exist before any confirmation proceeds.

### D-bis. Fiscal Periods & Document Numbering
- **Period states:** `OPEN`, `SOFT_CLOSED`, `HARD_CLOSED`.
  - `OPEN`: Normal posting allowed.
  - `SOFT_CLOSED`: No normal posting; authorized reopening with a recorded reason.
  - `HARD_CLOSED`: No reopening, no backdated modification of any kind.
  - Corrections to documents in closed periods must be posted in an open period and linked to the original document.
- **Business time zone:** `Africa/Algiers` is the authoritative business time zone for all fiscal-date determinations.
- **Document numbering:**
  - `DRAFT` documents receive no official number.
  - `CONFIRMED` documents receive an official number allocated atomically inside the posting function.
  - Annual numbering resets are supported (e.g., `FA-2026-00001`).
  - If a transaction rolls back, the allocated number must not leave a gap. Use a deferred sequence claim or post-commit numbering strategy.
  - Document-date to fiscal-period to company relationships are validated inside the posting function.

### D-ter. Tax, Discount & Monetary Formulas
All monetary and quantity calculations must use exact decimal types (`rust_decimal` or equivalent)—never floating-point.
- **Line calculation (base):**
  - `base_quantity = entered_quantity × conversion_factor_to_base`
  - `line_gross = entered_quantity × price_per_entered_unit`
  - `cost_total = base_quantity × unit_cost_per_base`
- **Tax-exclusive pricing (HT):**
  - `net_excl_tax = line_gross - allocated_discounts`
  - `tax = round(net_excl_tax × tax_rate, 2)`
  - `total_incl_tax = net_excl_tax + tax`
- **Tax-inclusive pricing (TTC):**
  - `total_incl_tax = line_gross - allocated_discounts`
  - `net_excl_tax = round(total_incl_tax / (1 + tax_rate), 2)`
  - `tax = total_incl_tax - net_excl_tax`
- **Confirmed line snapshots:** Every confirmed line stores: `tax_code`, `tax_rate`, `tax_included`, `rounding_policy_version`, `price_per_entered_unit`, `conversion_factor`, `unit_cost_per_base`.
- **TVA configuration:** TVA enabled/disabled flag, effective-dated tax rates, per-line rounding, header discount allocation method, credit-note tax reversal rules, supplier deductible TVA—all must be finalized before building sales and procurement posting functions.

### E. Cash Register Sessions & Drawer Auditing
- **Sessions:** Tracked via OPEN, CLOSING, PENDING_APPROVAL, CLOSED, SUSPENDED states. Cashiers enter blind counts by denomination at close. Material variances require manager authorization.
- **Drawer Opening Policy:** The `cash.drawer_jobs` queue processes pulses separately from print jobs. Auto-open is triggered by eligible cash operations (configurable policy), including:
  - Cash sales, customer cash debt payments, approved cash refunds, supplier cash payments, cash expenses, authorized deposits/withdrawals.
  - Each drawer operation has its own idempotency key.
- **Drawer blocked for:** Receipt reprints, A4 printing, credit sales without cash, failed transactions, product searches, login, invoice previews.

### F. Credit Limits & Exposure Override
- **Exposure Formula:** `confirmed_credit_invoices + debit_notes - confirmed_credit_notes - allocated_payments - approved_write_offs`.
- **Blocking Constraints:** Rejects transaction at the database level if a client exceeds their limit or maximum overdue term limit, using a lock on the credit-state row (`FOR UPDATE`).
- **Overrides:** The system generates a single-use authorization token linked to a specific draft-sale payload. If the cart changes, the token is invalidated.

---

## 4. Development Plan: Vertical Slices

- [ ] **Slice 0: Technical Feasibility & Proofs**
  - PostgreSQL bootstrap utility, creating roles (`stockiha_owner`, `stockiha_migrator`, `stockiha_runtime`, `stockiha_backup`).
  - Windows Credential Manager integration in Rust.
  - Basic `SECURITY DEFINER` function with fixed search path and session-token validation.
  - Typst French/Arabic PDF rendering & ESC/POS Windows RAW spooler integration.
  - Prove Arabic thermal receipt rendering (native text + rasterized fallback).
  - Backup & restore wrappers: database dump, attachments, generated documents, configuration, manifest with checksums, schema/app version. Restore into a temporary database and verify ledger/cache reconciliation.
- [ ] **Slice 1: The Golden Transaction Chain**
  - Minimal schemas and models for products, warehouse stock, cash sales, journal entries, fiscal periods, and document sequences.
  - Implement `iam.application_sessions` with token-hash validation.
  - Implement `core.request_idempotency` with the full concurrency algorithm.
  - Implement tax/discount line calculations with exact decimal types.
  - Establish i18n structure and RTL layout primitives in the frontend.
  - Minimal open cash session required for the Golden Chain (no blind counts or variance approval yet).
  - End-to-end integration: `Create Product` → `Emergency Receipt` → `WAC Update` → `Cash Sale` → `Stock Issue` → `Cash Session Entry` → `Double-entry Journal Posting` → `Print Queue Spooling` → `Drawer Pulse (separate job)`.
  - Validate with a backup/restore cycle and immediate live audit check.
- [ ] **Slice 2: Catalog & Advanced Inventory**
  - Variant catalog, attributes, units, barcodes.
  - Advanced posting handler: `inventory.confirm_stock_adjustment`.
  - Zero-quantity safeguards and rounding residual handlers.
  - *(Transfers are deferred to Slice 5.)*
- [ ] **Slice 3: Procurement & Receipt Clearing**
  - Purchase Orders, Goods Receipts, Supplier Invoices, and Payments.
  - Three-way match clearing accounts with price-variance split policy.
  - Landed-cost allocation utilizing the `inventory.receipt_cost_attribution` ledger.
  - Foreign-currency schema support: `currency_code`, `foreign_amount`, `exchange_rate_to_dzd`, `exchange_rate_date`, `base_amount_dzd` on purchase documents. May be disabled for initial release but schema must not assume all documents are DZD.
- [ ] **Slice 4: Cash Sessions & Credit Controls**
  - Touchscreen POS interface. Test complete POS workflow in French and Arabic.
  - Full cashier session management: blind counts, denomination entries, variance approvals, suspension, handover.
  - Extended drawer eligibility policy (cash sales, payments, refunds, expenses).
  - Credit limit checks, exposure cache rebuilding, and single-use manager override tokens.
- [ ] **Slice 5: Returns & Transfers**
  - Quarantine inspect logic with corrected return-costing rules, credit notes, purchase returns.
  - Complete warehouse transfers with states: `DRAFT`, `DISPATCHED`, `IN_TRANSIT`, `RECEIVED`, `CANCELLED`. Simple single-transaction local transfers use `CONFIRMED` only.
- [ ] **Slice 6: Expenses & Payroll**
  - Employee contracts, commissions, payroll runs, and general company expense documents.
- [ ] **Slice 7: Sandbox Reconstruction & Historical Importer**
  - CSV/Excel importer for `history.*` schema with batch lifecycle: `STAGING` → `VALIDATING` → `NEEDS_REVIEW` → `VALIDATED` → `LOCKED`.
  - Chronological replay logic inside `reconstruction.*` schema.
  - Discrepancy report generator and CEO approval workflow.
- [ ] **Slice 8: Reporting & Analytics**
  - Live dashboards, multi-terminal ready views, financial statements, and account exports.
  - Live cache audit tool: detection-only by default; repairs require verified backup, maintenance mode, CEO/admin approval, atomic rebuild, post-repair reconciliation, and audit record.
- [ ] **Slice 9: Production Hardening & Security**
  - Final multi-language regression testing (French, Arabic RTL, English).
  - Stress testing (10k variants, 50k clients, 250k sales, 2M movements).
  - Encrypted backup bundles, backup retention policy, automatic off-device backup, RPO/RTO targets, monthly restore drills.
  - Tauri capability restrictions, signed installer, update signature verification.
  - Log rotation, secret redaction, disk-space health check, PostgreSQL service monitoring.
  - NSIS/WiX installer packaging.

---

## 5. Queue State Machines

### Generation Jobs (`documents.generation_jobs`)
States: `PENDING` → `CLAIMED` → `GENERATING` → `COMPLETED` | `RETRYABLE_FAILURE` | `PERMANENT_FAILURE`.

### Print Jobs (`documents.print_jobs`)
States: `WAITING_FOR_GENERATION` → `PENDING` → `CLAIMED` → `SENDING` → `SUBMITTED` → `COMPLETED` | `RETRYABLE_FAILURE` | `PERMANENT_FAILURE` | `UNKNOWN_DELIVERY` | `CANCELLED`.
- A print job inserted during the sale transaction uses `WAITING_FOR_GENERATION` status. It transitions to `PENDING` only after the generation job reaches `COMPLETED`.

### Drawer Jobs (`cash.drawer_jobs`)
States: `PENDING` → `CLAIMED` → `PULSE_SUBMITTED` | `PULSE_FAILED` | `CANCELLED`.

### Common Lease Fields (all job types)
`claimed_by`, `lease_expires_at`, `attempt_count`, `next_attempt_at`, `external_job_id`, `error_code`, `error_message`.
- Workers claim jobs using `FOR UPDATE SKIP LOCKED`.
- Expired leases are safely reclaimed by other workers.

---

## 6. Verification & Definition of Done

### Performance Targets
- **Product Barcode Lookup:** p95 < 100 ms, p99 < 250 ms.
- **Product Text Search:** p95 < 250 ms for the first 50 results.
- **Confirm 10-line Cash Sale:** p95 < 750 ms (excluding physical printer queues).
- **Dashboard Load:** p95 < 1.5 seconds.
- **Print Worker Lease Check:** No duplicate processing under concurrent workers.
- **Test Machine Specs:** Windows 11, 16 GB RAM, 4-Core CPU, SSD, Local PostgreSQL.

### Mandatory Integrity Tests
- **Idempotency:** Duplicate confirmation requests produce only one document.
- **Idempotency (concurrent):** Two identical requests arriving simultaneously produce exactly one document.
- **Idempotency (conflict):** Same request ID with a different payload is rejected.
- **Idempotency (crash):** Commit succeeds but client loses the response; retry returns the original sale.
- **Race Prevention:** Two concurrent sales cannot cause negative stock or exceed client credit limit.
- **Financial Validation:** Journal debits always equal credits. Journal with zero or one line cannot be posted. Posted journal lines cannot be deleted. Posted ledgers cannot be modified.
- **Allocation Safety:** Payment allocation cannot exceed the payment amount. Customer payment cannot be allocated to another customer's invoice. Supplier payment cannot exceed supplier invoice balance.
- **Return Limits:** Return quantity cannot exceed the original sold quantity. Purchase return cannot exceed received quantity.
- **Fiscal Enforcement:** Hard-closed period rejects posting. Document numbering remains unique under concurrency.
- **Landed Cost Edge:** Late landed cost with zero remaining quantity goes entirely to COGS/variance. Receipt price adjustment correctly splits between remaining stock and sold quantities.
- **Reconstruction Validation:** Rebuilt cache equals the sum of movements.
- **Crash Recovery:** If app or worker is killed midway, jobs are not lost, and database transactions roll back.
- **Thermal Print Safety:** Unknown printer delivery states do not trigger automatic retries. Reprint never creates a drawer pulse.
- **Queue Safety:** Print job cannot run before generation completes. Expired job lease is safely reclaimed.
- **Backup Integrity:** Restored backup reproduces identical financial and inventory totals.

### Failure-Injection Testing
- Stop PostgreSQL service during posting transaction.
- Application termination immediately after database commit (before returning success to UI).
- Worker termination after claiming a job.
- Worker termination after partial ESC/POS transmission.
- Disconnect USB/Network printer mid-stream.
- Fill the disk during PDF generation.
- Insufficient disk space during backup.
- Corrupted backup bundle.
- Attempt migration with an incompatible schema.
- Power loss during installer migration.
- Unavailable Windows Credential Manager.

---

## 7. Recommended Companion Documents

Before each slice implementation, create these supporting specifications:

1. **Posting Matrix** — Every operation with its stock, receivable, payable, cash, and journal effects.
2. **State-Machine Specification** — Sales, purchases, returns, sessions, print/drawer jobs, and fiscal periods.
3. **Data Dictionary & ERD** — Tables, fields, constraints, indexes, and ownership.
4. **Permission Matrix** — Employee, administrator, CEO, and accountant capabilities.
5. **Error Catalogue** — Stable backend error codes and user-facing messages (FR/AR/EN).
6. **Test Matrix** — Normal, concurrent, reversal, and failure scenarios per slice.
