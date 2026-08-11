# R8-E — Procurement Acceptance Candidate

## Status

Implementation candidate on `task/r8-e-procurement`, based on accepted R8-D
`main` at `f554f3983792c4fe4c7576987f6fdb48aabc9ecf`. R8-E is not accepted
until automated verification and the focused Windows/Tauri journey below pass
on the exact published candidate.

## Implemented boundary

- Permission-aware procurement navigation with a safe-deny UI projection;
  database operation functions remain authoritative.
- Supplier and purchase-order workflows in EN/FR/AR using existing RTL and
  responsive layout primitives.
- Posted receipt history with its journal and landed-cost state.
- Reachable landed-cost allocation using the actual open fiscal period, one
  stable request ID per attempt, and an official posting-result card.
- DZD supplier-invoice draft creation from exact posted receipt lines, followed
  by idempotent confirmation and its official document/journal result.
- Supplier-return drafting from eligible purchase orders and variants without
  raw database ID entry, followed by idempotent confirmation and exact
  inventory/AP/variance results.
- Open supplier liabilities only, exact decimal total, allocated Cash/Bank/Check
  payments, payment history, and official posting results.
- Exact client-side decimal boundary checks for invoice quantities, return
  quantities, and allocated payments. PostgreSQL revalidates every posting.

## Database and security design

Migration `20260811140000_r8_e_procurement_acceptance.sql` adds or replaces only
owner-controlled `SECURITY DEFINER` functions:

- `procurement.get_capabilities(text)`
- `procurement.list_purchase_receipts(text,bigint,bigint)`
- `procurement.list_purchase_receipt_lines(text,bigint)`
- `procurement.create_supplier_return_draft(text,bigint,bigint,bigint,text,text,jsonb)`
- secure invoice, liability, return, and payment history projections.

`PUBLIC` execution is revoked and `stockiha_runtime` receives only function
execution. History and receipt-line reads require `MANAGE_PROCUREMENT`; posting
functions retain their specific `POST_*` checks. The UI capability result does
not grant authority.

Existing R2 posting functions remain authoritative for GRNI/AP semantics,
inventory valuation, account roles, fiscal-period validation, numbering,
balanced journals, atomicity, and idempotency. Exact numeric values cross
Rust/IPC as decimal strings. TVA and discounts remain disabled; the desktop
invoice path is intentionally DZD-only for the MVP.

## Deterministic acceptance journey

1. As an administrator, create one supplier, one warehouse, one product
   variant, and a purchase order for `10.000` units at `100.00 DZD`.
2. Confirm the purchase order and receipt. Retry the same receipt request and
   verify the original document is returned with one receipt only.
3. Verify `10.000` units, `1000.00 DZD` inventory value, `100.000000 DZD` WAC,
   and a visible posted receipt journal.
4. Allocate `100.00 DZD` landed cost by quantity. Verify `10.000` units,
   `1100.00 DZD` value, `110.000000 DZD` WAC, one `100.00 DZD` landed-cost AP,
   and the official journal result.
5. Create a DZD invoice from the exact receipt line for `10.000` units at
   `105.00 DZD`; post it and verify `1050.00 DZD` AP, `1000.00 DZD` GRNI
   clearing, and `50.00 DZD` procurement variance.
6. Reject a return draft for `11.000` units. Draft and post a return of `2.000`
   units; verify AP clearing `210.00 DZD`, inventory credit `220.00 DZD`,
   variance `10.00 DZD`, and the resulting position `8.000` units,
   `880.00 DZD`, `110.000000 DZD` WAC.
7. Reject a payment above the `840.00 DZD` invoice liability. Post a
   `400.00 DZD` bank payment, retry it safely, then settle `440.00 DZD` in cash.
8. Verify the fully paid invoice disappears from open payables while the
   separate `100.00 DZD` landed-cost liability remains. Settle it by check and
   verify no open payable remains and all three payments appear in history.
9. Verify a cashier cannot see procurement navigation or read the receipt-line,
   return, or payment projections.
10. Verify every receipt, landed-cost, invoice, return, and payment journal is
    balanced and linked to the official business document.

The PostgreSQL assertions live in
`src-tauri/tests/procurement/r8_e_procurement_integration.sql` and are mandatory
through `src-tauri/tests/run_current_sql_suites.sh`.

## Evidence recorded in this environment

- `npm run typecheck` — passed.
- `npm run lint` — passed.
- Focused procurement workflow and exact-decimal tests — 2 files, 12 tests passed.
- `npm test -- --run` — 23 files and 140 tests passed.
- `npm run build` — passed; Vite emitted only the existing large-chunk warning.
- `bash -n src-tauri/tests/run_current_sql_suites.sh` — passed.
- `git diff --check` — passed.
- Rust and PostgreSQL executables are unavailable in this Linux workspace;
  their mandatory checks remain delegated to CI and Windows acceptance.

## Required Windows/Antigravity checks

- Run Rust format, check, Clippy with warnings denied, and unit tests.
- Apply the complete migration chain through `20260811140000` to a disposable
  PostgreSQL 18 database and run the complete SQL suite runner.
- Run the deterministic journey above through the real Tauri application with
  a manager and cashier.
- Confirm official result cards, same-request retries, exact control totals,
  permission-aware navigation, EN/FR/AR, RTL, light/dark, narrow-window, and
  restart persistence.
- Record the exact candidate SHA, database identity, commands, totals, and every
  defect. Any unexplained stock, AP, GRNI, value, or journal variance blocks
  acceptance.

Linux verification cannot prove Windows WebView2/Tauri runtime behavior or the
local PostgreSQL service configuration.
