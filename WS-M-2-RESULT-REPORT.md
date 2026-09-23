# WS-M-2 Result Report

## Branch and commit
- Base branch tip: `task/ws-m-1-print-identity` @ `e98d7f671b564fad38b25bd6ee30edb53c2e3535`
- Branch: `task/ws-m-2-a4-template`, created from that exact tip
- Commit: `f5d6da9` — "WS-M-2: the one shared A4 template"

## Steps completed
- **M2-01 — The engine.** New `src/shared/documents/officialDocument.ts`: `OfficialDocumentModel`/`OfficialDocumentIdentity` types, `renderOfficialDocumentHtml` (LTR/RTL via `dir`, alignment resolved from the model per column, `thead { display: table-header-group }`, `page-break-inside: avoid`, black-and-white palette only), `renderOfficialDocumentPdf` (real multi-page pagination — repeats the identity band + table header, prints `Page X / Y`; reuses the exact Amiri/Helvetica font-loading block from the old `genericDocumentPdf.ts`; a `webp` logo is skipped — pdf-lib can't embed it — while the HTML keeps it). `printStrings.ts` (the exact §5.5 table) and `amountInWords.ts` (French + English cardinal number-to-words, exact §5.6 rules) are new, standalone modules. `useOfficialDocumentContext.ts` loads settings + logo once, resolves `FOLLOW_APP` against the live app locale, and never throws (a failed load yields an all-`null` identity so printing still works).
- **M2-02 — Per-document builders.** New `src/shared/documents/models/`: `saleInvoiceModel`, `paymentReceiptModel` (covers `CUSTOMER_PAYMENT`/`CUSTOMER_REFUND`/`SUPPLIER_PAYMENT` — same label/amount column shape), `saleVoidModel`, `purchaseReceiptModel`, `journalEntryModel`, `documentsReportModel`, `journalsReportModel` (new — see deviation below), `genericModel` (the untyped fallback), plus `shared.ts` for the fr/ar/en column-label dictionary used across all of them. Columns, totals, and `amountInWordsValue` scope match the spec table exactly.
- **M2-03 — Migrated every call site**, deleting the old generators as it went:
  1. `ReceiptView.tsx` — print via the engine; also gained a Save-as-PDF button (it only had Print before — see deviation).
  2. `BusinessDocumentDetailModal.tsx` — dispatches to `saleInvoiceModel`/`paymentReceiptModel`/`saleVoidModel`/`purchaseReceiptModel` by `document_type`, falling back to `genericModel` for every other type (STOCK_RECEIPT, STOCK_ADJUSTMENT, etc.) using the same dynamic `subtype_detail` field extraction the component already had.
  3. `DocumentsScreen.tsx` — Reports tab print/PDF now built from `documentsReportModel`.
  4. `JournalsScreen.tsx` — journal-entry detail print/PDF via `journalEntryModel`; **added** a report-level print/PDF for the journal list (JournalsScreen had no report-level output before WS-M-2 — see deviation).
  5. `printReceipt.ts` — the A4 branch of `printSaleReceipt`/`printVoidSlip` now builds a model and calls the engine; both functions gained an optional `identity` parameter, threaded through every caller (`PosScreen.tsx`, `SessionSalesPanel.tsx`, `PrintingSettingsScreen.tsx`'s test print).
  6. `purchaseReceiptPrint.ts` — `printReceiptA4`/`downloadReceiptPdf` are now thin wrappers over the engine (also gained an `identity` parameter); `PurchaseReceiptDetailModal.tsx` updated to supply it.
  7. Deleted `buildA4Receipt` (`receiptBuilder.ts`) and `buildA4VoidSlip` (`voidSlipBuilder.ts`); their thermal siblings are untouched (confirmed zero shared runtime logic before deleting).
  8. `documentPrintService.ts` now only keeps `saveDocumentFileWithDialog`, `printDocumentA4`, and a re-export of `escapeHtml` (moved into `officialDocument.ts`). `genericDocumentPdf.ts` had zero remaining importers after step 6, so it was deleted.
  - `grep -rn "<!DOCTYPE html" src/features` returns nothing; the only HTML-document source left in `src/` is `officialDocument.ts` itself.
- **M2-04 — Settings preview.** `PrintingSettingsScreen.tsx` gained a "Preview an invoice" button (`data-testid="print-preview"`) that builds a sample two-line invoice using the current **unsaved** form values as identity (via a new `identityFromForm()` helper) and prints it through the engine — this is how the Owner can review the amount-in-words sentence before saving.
- **M2-05 — Tests.** `tests/official-document.test.ts` (16 assertions: identity/legal-id content, "Stockiha" appears exactly once, empty-identity resilience, no signature block ever, A8-palette-only colours, `end`-alignment resolves correctly per locale/RTL, `thead` repeat rule, `<script>` escaping, amount-in-words toggle, PDF `%PDF-` header for all 3 locales with/without a PNG logo, webp-in-HTML-but-skipped-in-PDF). `tests/amount-in-words.test.ts` (18 assertions matching every exact string the spec lists, plus English coverage). `tests/receipt-builder.test.ts` and `tests/void-slip-builder.test.ts` had their `buildA4Receipt`/`buildA4VoidSlip` assertions removed (thermal + `formatReceiptItemName` tests untouched). `APP_VERSION_MARKER` bumped to `WS-M-2.0`.

## Files changed
33 files, +2544/-2174 (see commit `f5d6da9`). No database or Rust files touched — WS-M-2 is frontend-only, consistent with the specification (§A10, no new DB objects; the shared A4 engine reads only what WS-M-1 already exposes).

## Gates (real output)
- `npm run typecheck` — clean
- `npm run lint` — clean
- `npm test -- --run` — **639 passed, 0 failed** across 62 files (includes the 2 new test files and the 60 pre-existing ones, unmodified behavior confirmed for `BusinessDocumentDetailModal`/`DocumentsScreen`/`JournalsScreen`/`PosScreen`/`ReceiptView`/`PurchaseReceiptDetailModal` — none of their existing tests broke despite every one of those components now calling the new `useOfficialDocumentContext` hook on mount)
- `npm run build` — succeeds (371 modules, dist emitted)
- `cargo fmt --check` / `cargo check` / `cargo clippy -- -D warnings` / `cargo test --lib` — all clean, **463 passed, 0 failed** (expected — no Rust files changed this workstream; run anyway to confirm zero regression)
- `cargo test --lib -- --ignored safe_upgrade` / `embedded_setup`, and the throwaway-PostgreSQL SQL suites — **not re-run**. WS-M-2 adds no migration, so these gates (which exist specifically to prove a migration applies cleanly) have nothing new to verify; WS-M-1's run already covers the current migration set.

## Deviations from the specification
1. **Journals report is new UI, not a migration of existing UI.** The plan's PART 1.1 baseline table lists JournalsScreen as already having "(report + detail)" print, but direct inspection (`grep` for `buildOfficialDocumentHtml`/`generateGenericDocumentPdf` and every print/PDF button) found only the journal-**detail** modal had print/PDF — the journal list/search view had none. Since M2-02 explicitly specifies a `journalsReportModel.ts` with its own column set (number/date/source/debit/credit), I built the missing report-level print/PDF into `JournalsScreen.tsx`'s toolbar (visible when `rows.length > 0`), matching `DocumentsScreen`'s existing Reports-tab pattern. Flagging this because it's new functionality, not a like-for-like refactor.
2. **`ReceiptView.tsx` gained a Save-as-PDF button.** It previously had Print only. Ruling O9 ("both actions stay: print directly, and save as PDF") and PART 11's Owner check #6 ("save the same invoice as PDF") apply to every A4 sale invoice; since `ReceiptView` renders the same sale invoice as the POS receipt, it needed the same pair of actions for O9 to hold everywhere, not just at the POS.
3. **`SUPPLIER_PAYMENT` shares `paymentReceiptModel.ts` rather than getting its own file.** M2-02's model-file bullet list doesn't name a dedicated builder for it, but the `OfficialDocumentKind` union includes `'SUPPLIER_PAYMENT'` and its column shape (label/amount) is identical to a customer payment receipt. `buildPaymentReceiptModel` takes a `kind: 'PAYMENT_RECEIPT' | 'SUPPLIER_PAYMENT'` parameter so the model's `kind` field stays correct without a near-duplicate file.
4. **`JOURNAL_ENTRY` inside `BusinessDocumentDetailModal` falls through to the generic model**, not `journalEntryModel`. I found no evidence a `business_documents` row with `document_type = 'JOURNAL_ENTRY'` is ever opened through that modal in the current codebase (journal entries are reached exclusively through `JournalsScreen`'s `JournalDetailModal`, which already uses `journalEntryModel` directly with properly typed `JournalDetail` data). Wiring an unconfirmed code path through the modal's untyped `subtype_detail` risked inventing field-name guesses with no way to verify them; the generic fallback handles it safely if it's ever hit.
5. **PDF italic font for the amount-in-words line.** Not specified, but the HTML renderer uses `font-style: italic` there (spec §5.7 point 7); for parity I used `StandardFonts.HelveticaOblique` in the PDF (Arabic has no italic Amiri variant available, so it falls back to the regular Amiri font when `printLocale === 'ar'`).

## Blockers / questions for the Architect
None. No repository contradiction requiring escalation.

## Pending manual checks (PART 11, items 5–11)
Not run — no Windows WebView2 runtime in this environment. Needs the Owner on an installed build:
5. Print a cash sale invoice — shop identity, logo, NIF/NIS/RC/AI line, no signatures, no colour.
6. Save the same invoice as PDF — same content and order, page numbers at the bottom.
7. Print a customer payment receipt, cancellation slip, purchase receipt, journal entry, documents report, journals report — same header/style across all.
8. Review the amount-in-words sentence via the new "Preview an invoice" button.
9. Switch print language to Arabic and print — RTL layout, amount in words still French (by design, §A5).
10. Turn the logo off and print again — name takes its place cleanly.
11. Print a 60+ line invoice — table continues on page 2 with the header repeated (this exercises the PDF paginator's `ensureSpace`/new-page logic, which only unit tests reached indirectly via a 1-line sample; a real multi-page document has not been visually inspected).

## Unrelated problems noticed (not fixed)
None new. (The `tests/historical-exports.test.ts` flakiness noted in the WS-M-1 report is unrelated to this branch and was not re-triggered in this run.)

## Push status
**Not pushed.** Commit is local only on `task/ws-m-2-a4-template`, per instruction to ask before pushing.
- Local HEAD: `f5d6da9`
