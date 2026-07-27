# Stockiha — Slice 0 Tasks

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

- [x] S3-001 Implement supplier master, purchase order workflow, and goods receipt posting
- [x] S3-002 Implement landed cost allocation, supplier invoices, three-way match, and payables ledger
- [x] S3-003 Implement supplier returns, debit notes, and payables settlement postings

# Stockiha — Slice 4 Tasks: Customer Master & Credit Limits

- [x] S4-001 Implement customer directory, credit limit enforcement, and customer ledger tracking
- [x] S4-002 Implement cashier session management (suspend, resume, blind counts, denomination entries, variance approvals) and single-use manager override tokens

# Stockiha — Slice 5 Tasks: Customer Returns, Warehouse Transfers & Stock Write-Offs

- [x] S5-001 Implement instant POS customer returns, flexible refund payouts (cash drawer, credit note, bank), 1-step warehouse stock transfers, and damaged stock write-offs

# Stockiha — Slice 6 Tasks: Official Document Templates & ESC/POS Printing Engine

- [x] S6-001 Implement official document sequence numbering, Typst PDF rendering (French/Arabic), ESC/POS thermal printing queue, and cash drawer pulse triggers




