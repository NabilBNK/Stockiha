# Stockiha — Execution Task Tracker

> This file records task progress only. [`STOCKIHA_GROUND_TRUTH.md`](./STOCKIHA_GROUND_TRUTH.md) is the single authority for target architecture, release scope, verified status classifications, and remaining work. Active execution status is tracked in [`CURRENT_STEP.md`](./CURRENT_STEP.md). A checked implementation task is not proof that the feature is production-correct or release-ready.

# Stockiha — Slice 0 Tasks

# Cross-slice UI foundation

- [x] UI-001 Frontend foundation overhaul: coherent shell, reusable visual system, responsive operational screens

- [x] S0-001 Repository foundation and Tauri scaffold
- [x] S0-002 Development configuration and typed error foundation
  - [x] S0-002a Configure restrictive Tauri v2 Content Security Policy (CSP hardening — deferred from S0-001)
- [x] S0-003 Local PostgreSQL and SQLx connectivity proof
- [x] S0-004 Database-role bootstrap proof
- [x] S0-005 Windows Credential Manager proof
- [x] S0-006 SECURITY DEFINER and session-token proof
- [x] S0-007 Typst French/Arabic PDF proof
- [x] S0-008 ESC/POS Windows RAW spooler proof (software verified; physical printer validation deferred)
- [x] S0-009 Backup bundle creation proof
- [x] S0-010 Temporary-database restore and reconciliation proof

# Stockiha — Slice 1 Tasks

- [x] S1-001a Implement backend MVP transaction engine (Golden Transaction Chain: product, stock receipt, WAC, cash session, cash sale, stock issue, cash movement, double-entry journal, print queue, drawer pulse)
- [x] S1-001b Implement core request idempotency and session validation
- [x] S1-001c Implement backup/restore database reconciliation for the Golden Chain
- [x] S1-002 Implement Slice 1 MVP frontend batch (User-facing setup, login, product, stock receipt, cash-session, POS, and receipt workflows)

# Stockiha — Slice 2 Tasks: Catalog & Advanced Inventory

- [x] S2-001 Implement variant catalog, attributes, units, and barcodes
- [x] S2-002 Implement advanced posting handler `inventory.confirm_stock_adjustment`
- [x] S2-003 Implement zero-quantity safeguards and rounding residual handlers

# Stockiha — Slice 3 Tasks: Procurement & Supplier Purchasing

> **Release blocker:** S3 code exists, but the authoritative audit classifies its supplier accounting as implemented incorrectly. Treat all three checked items below as historical implementation completion, not production acceptance. Roadmap step R2 must repair and regression-test the postings before real financial use.

- [x] S3-001 Implement supplier master, purchase order workflow, and goods receipt posting
- [x] S3-002 Implement landed cost allocation, supplier invoices, three-way match, and payables ledger
- [x] S3-003 Implement supplier returns, debit notes, and payables settlement postings

# Stockiha — Slice 4 Tasks: Customers, Receivables & Cash Controls

- [x] S4-001 Implement customer master, customer credit state, customer ledger, credit-limit/overdue enforcement, receivables, and customer document pipeline
- [x] S4-002 Implement full cashier-session lifecycle: blind denomination counts, variance approval, suspension, and handover
- [x] S4-003 Implement extended drawer eligibility and customer cash-payment/refund integration
- [x] R2 Repair supplier-accounting financial semantics with forward-only migrations and regression coverage
- [x] R4 Prove spreadsheet parser and mapping against representative anonymized source files
- [x] R5 Implement reconciled opening-state import
- [x] R6 Implement and prove an operator-facing pilot backup/restore workflow

> The legacy S4-004 label is superseded by the integrated pilot release gate in the authoritative roadmap.

# Stockiha — R8 Pilot Acceptance Tasks

- [x] R8-B/R8-C entry dependencies (user-confirmed complete before R8-D)
- [x] R8-D Catalog & Inventory acceptance — focused confirmation passed on exact candidate `27e8ad1`; merged through PR #21
- [ ] R8-E Procurement acceptance — implementation candidate requires exact-head PostgreSQL 18/Rust CI and focused Windows/Tauri confirmation
