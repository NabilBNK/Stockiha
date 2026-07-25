# Current Slice Status

## Active Context
- **Current Phase:** Slice 4 Customer Master & Credit Limits
- **Current Task:** S4-001 — Implement customer directory, credit limit enforcement, and customer ledger tracking
- **Implementation Status:** Not started

## Objective
Implement the complete customer management foundation: customer directory management (code, name, tax ID / NIF, contact details, active status), credit limit enforcement (`max_credit_limit`), customer ledger balance tracking (`current_balance`), customer risk categorization, and stored RPC procedures for customer operations.

## Included Task ID
- `S4-001`

## Database Scope
- `sales.customers`: Customer master directory (code, name, tax ID, credit limit, current balance, active status).
- `sales.customer_ledgers`: Customer ledger transaction log.
- Stored procedures: `create_customer`, `update_customer`, `list_customers`, `get_customer_detail`.
- Permissions: `MANAGE_CUSTOMERS`.

## Rust/Tauri Scope
- Customer domain types, payloads, and application service.
- Tauri IPC commands for customer management.

## React Scope
- Customers screen (directory list, create customer, edit customer, view credit limit & current balance).
- Navigation integration under Customers section.

## Tests and Validation
- SQL assertions for customer creation, unique code enforcement, and credit limit validation.
- Cargo unit tests for customer domain types.
- Frontend workflow tests for customer management UI.

## Production Invariants
- Customer credit limits cannot be negative.
- Customer code must be unique.
- Authoritative credit limit checks live in PostgreSQL (`SECURITY DEFINER`), not React.

## Explicit Exclusions
- Customer payments & invoice settlement workflows (deferred to Slice 6).
- Broad UI redesign.
