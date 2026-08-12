# Stockiha Procurement Acceptance Defect-Repair Plan

## Reframed problem

The procurement posting engine exists, but the Windows acceptance journey is not operable or auditable enough to accept: supplier returns fail without an actionable reason, journal evidence has no persistent viewer, and the Documents screen intentionally filters out procurement records. This work is a release-blocker repair, not a new procurement rewrite.

**Baseline:** `task/r8-e-procurement` at `486e07d7c0f21895332d1dcbc5ee6d4dda41e112`. Work on a new branch from that exact commit. Preserve unrelated changes. Use only forward-only migrations; never edit an applied migration or mutate posted records.

## Confirmed defects and adjacent risks

| Priority | Finding | Required result |
|---|---|---|
| Blocker | Supplier return shows only `PRECONDITION_FAILED`. The database has several distinct triggers, while the UI discards the diagnostic. | Reproduce the exact failing state, fix the valid workflow, and expose a safe localized reason without leaking SQL/internal details. |
| Blocker | No journal navigation, list API, or journal-detail UI exists. Procurement screens expose only journal identifiers. | Add a read-only Journals screen with balanced totals, source link, and debit/credit lines. |
| Blocker | Documents uses `list_printable_documents`, whose SQL allows only cash sale, credit sale, and customer payment records. | Add a secure business-document projection and show procurement documents; generation/print status is “Not applicable” until procurement PDFs exist. |
| High | Procurement screens render `GatewayError.message`, producing raw codes instead of localized messages. | Route all procurement errors through the existing safe localization boundary. |
| High | Several screens use `new Date().toISOString()`, which can select the previous Algerian calendar date near midnight. | Use one tested local-calendar date helper and validate it against the selected open fiscal period. |
| High | Purchase receipt client checks use `parseFloat` although exact decimal helpers exist. | Replace floating-point comparisons with exact decimal-string validation. PostgreSQL remains authoritative. |
| High | Current tests prove a clean SQL fixture, but not the failing Windows database state; journal balance coverage omits later settlement payments. | Add regression fixtures for the reproduced state and every generated journal/document. |

## Implementation sequence for the agent

1. **Reproduce before editing.** On a disposable copy of the failing database, record the exact commit, schema version, return document, purchase order, receipt, posted invoices, liabilities, current stock, fiscal period, and the private database diagnostic. Do not expose the diagnostic to the UI. Re-run the official `10 × 100 + 100 landed cost + 105 invoice + 2 return` fixture. Classify the failure as stale status, ambiguous invoices, insufficient stock, missing liability, liability already reduced, missing authoritative cost, or another proven condition.

2. **Repair supplier-return eligibility atomically.** Add a forward-only migration that makes draft eligibility and confirmation use the same authoritative rules. Expose a safe `eligibility_code`/`maximum_returnable_quantity` projection. Revalidate under row locks at confirmation. A failed confirmation must leave stock, liability, documents, movements, and journals unchanged. Preserve idempotent retry behavior. If multiple-invoice allocation or post-settlement credit balances are outside the accepted accounting policy, block them before draft creation with an explicit localized reason; do not invent accounting.

3. **Add journal evidence.** Add session-authorized `finance.list_journals` and `finance.get_journal_detail` `SECURITY DEFINER` functions; revoke `PUBLIC`, grant only runtime execution, and enforce a read permission. Add typed Rust commands, TypeScript gateway/data-transfer objects, router/navigation entry, and an English/French/Arabic read-only screen. Show journal number/date/source/source document, total debit, total credit, balance status, and account lines. Add “View journal” actions to procurement result/history rows. Add `accounting_journals_enabled`, default ON and administrator/CEO-controlled; disabling visibility must never disable posting or integrity checks.

4. **Fix Documents semantics.** Keep printable-document jobs separate. Add a secure paginated business-document query covering purchase order, purchase receipt, supplier invoice, purchase return/debit note, and supplier payment, plus existing sales/customer types. Show status, official number, date, source, linked journal, and document detail. Do not create fake PDF/print jobs for procurement. Ensure manager/administrator visibility and cashier denial follow permissions. Add `business_documents_enabled`, default ON, without disabling record creation.

5. **Harden the whole procurement UI.** Use `useErrorText` plus new allowlisted return-specific public error codes and translations. Replace UTC date defaults and floating-point comparisons. Refresh eligibility after every draft/post/payment and prevent double-submit. Empty or blocked forms must explain why rather than open unusable modals.

6. **Verification and delivery.** Extend PostgreSQL tests for clean and upgraded databases, rollback, permissions, concurrency, idempotency, over-return, sold-stock limits, partial payment before return, multiple invoices, all payment journals, and document visibility. Extend React tests for error copy, local dates, exact decimals, journal detail, document filters, toggles, RTL, and narrow layout. Run frontend typecheck/lint/tests/build; Rust format/check/Clippy/tests; complete PostgreSQL migration, integration, race, and existing-database upgrade gates. Then run the exact Windows/Tauri journey, restart, and verify English/French/Arabic, RTL, light/dark, stock `8`, value `880.00`, invoice liability `840.00`, landed-cost liability `100.00`, and balanced linked journals.

## Likely files

New migration and SQL tests; `src-tauri/src/{domain,application,commands}` journal/document/procurement modules; `src/shared/ipc/{commands,dto,gateway,documentDto,documentGateway}`; `src/features/procurement/*`; new `src/features/accounting/JournalsScreen.tsx`; `src/features/documents/DocumentsScreen.tsx`; `src/app/{AppShell,AppRouter}.tsx`; locale/error definitions; focused frontend tests; current acceptance specification and tracker.

## Completion gate

Do not claim success because automated tests pass. Success requires the originally failing return to pass or be rejected before drafting with the correct safe reason; procurement records must persist in Documents; every linked journal must be inspectable and balanced; no unexplained stock, inventory-value, goods-received-not-invoiced, accounts-payable, variance, or permission difference may remain. Commit and push only after presenting the diff and exact verification results required by repository rules.
