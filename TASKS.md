# Stockiha — Execution Task Tracker

> **Execution tracker only.** The only current product/roadmap ground-truth document is [`STOCKIHA_GROUND_TRUTH.md`](./STOCKIHA_GROUND_TRUTH.md). Use [`CURRENT_STEP.md`](./CURRENT_STEP.md) for the current execution position. A checked task is not proof that a feature is production-correct or release-ready.
>
> Historical PR/R/S numbering is retained below only as implementation history. Do **not** use it to define new work. New work must use the current `WS-A` through `WS-L` Workstream model.

## Current execution priorities

- [ ] **WS-A — Foundation & Access:** User Management, Authentication, RBAC, role/access management, custom-user administration, permission enforcement.
- [ ] **WS-B — Financial Core:** accounting correctness, journals/ledger integrity, AR/AP, cash/bank, inventory valuation and transaction-to-accounting integrity.
- [ ] **WS-C — Settings & Policy Engine:** frontend/backend redesign, feature toggles, business policies, valuation policy, role/RBAC configuration and backend enforcement.
- [ ] **WS-D — Product & Inventory Core:** product UI/backend revision, barcode-first global search, inventory MVP analytics, stock correction and serious transfer testing.
- [ ] **WS-E — Procurement & Supplier Operations:** direct purchase refinement, history, returns/details and accounting integration.
- [ ] **WS-F — POS, Sales & Cash Operations:** POS and cash-session revision/testing, payments, customers/credit and configurable discounts.
- [ ] **WS-G — Historical Financial Import:** improve validation/reliability and complete representative testing; current condition 5/10.
- [ ] **WS-H — Backup & Recovery:** repair backup, restore, validation, consistency and database-health workflows.
- [ ] **WS-I — Reporting & Analytics:** complete/repair reporting after pillar features stabilize.
- [ ] **WS-J — Dashboard & Application UX:** redesign dashboard, sidebar, topbar and element placement after pillar features stabilize.
- [ ] **WS-K — Windows/Tauri Acceptance & Release:** release-critical end-to-end Windows/Tauri verification.
- [ ] **WS-L — Audit & Compliance:** implement late, after most pillar features are stable.

## Historical implementation record

The sections below preserve what was previously completed under the old Slice/R roadmap. They are historical records, not current roadmap authority.

### Slice 0 — Technical foundation proofs

- [x] S0-001 Repository foundation and Tauri scaffold
- [x] S0-002 Development configuration and typed error foundation
- [x] S0-002a Configure restrictive Tauri v2 Content Security Policy
- [x] S0-003 Local PostgreSQL and SQLx connectivity proof
- [x] S0-004 Database-role bootstrap proof
- [x] S0-005 Windows Credential Manager proof
- [x] S0-006 SECURITY DEFINER and session-token proof
- [x] S0-007 Typst French/Arabic PDF proof
- [x] S0-008 ESC/POS Windows RAW spooler proof
- [x] S0-009 Backup bundle creation proof
- [x] S0-010 Temporary-database restore and reconciliation proof

### Slice 1 — Core transaction implementation

- [x] S1-001a Backend MVP transaction engine / Golden Transaction Chain
- [x] S1-001b Core request idempotency and session validation
- [x] S1-001c Backup/restore database reconciliation for the Golden Chain
- [x] S1-002 MVP frontend batch for setup, login, product, receipt, cash-session, POS and receipt workflows

### Slice 2 — Catalog & inventory history

- [x] S2-001 Variant catalog, attributes, units and barcodes
- [x] S2-002 Advanced posting handler `inventory.confirm_stock_adjustment`
- [x] S2-003 Zero-quantity safeguards and rounding residual handlers

### Slice 3 — Procurement history

- [x] S3-001 Supplier master, purchase order workflow and goods receipt posting
- [x] S3-002 Landed cost allocation, supplier invoices, three-way match and payables ledger
- [x] S3-003 Supplier returns, debit notes and payables settlement postings

> Historical note: the old procurement slice was later found to contain supplier-accounting correctness issues. Do not treat these checkmarks as current production acceptance. Current procurement scope is governed by **WS-E** and the current ground truth.

### Slice 4 — Customers, receivables & cash controls

- [x] S4-001 Customer master, customer credit state, customer ledger, credit-limit/overdue enforcement, receivables and customer document pipeline
- [x] S4-002 Cashier-session lifecycle, denomination counts, variance approval, suspension and handover
- [x] S4-003 Drawer eligibility and customer cash-payment/refund integration

### Historical R-series records

- [x] R2 Supplier-accounting financial-semantics repair with forward-only migrations and regression coverage
- [x] R4 Spreadsheet parser and mapping proof against representative anonymized source files
- [x] R5 Reconciled opening-state import
- [x] R6 Pilot backup/restore workflow proof
- [x] R8-D Catalog & Inventory acceptance on the historical exact candidate
- [ ] R8-E Procurement acceptance — historical candidate gate

> These R-series entries are preserved for traceability only. They do not define the current roadmap, priorities, MVP boundary, or release status.

## Task status policy

- A checked historical task means the implementation work was recorded as completed at that time; it does not guarantee current production readiness.
- Current completion must be established against `STOCKIHA_GROUND_TRUTH.md`, `CURRENT_STEP.md`, executable behavior, tests, migrations, and Windows/Tauri acceptance where applicable.
- Do not create new `S*`, `R*`, or legacy slice labels for future work. Use `WS-A` through `WS-L` and, where useful, sub-items such as `A.1`, `A.2`, `B.1`.
