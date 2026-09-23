# Printed documents (WS-M)

Every A4 page in Stockiha — invoices, receipts, cancellation slips, goods
receipts, journal vouchers, reports, the end-of-day cash session report — is
produced by one shared engine, not by per-screen HTML strings. This page
describes that engine, the settings that feed it, and the steps to add a new
document kind.

## The one template

`src/shared/documents/officialDocument.ts` exports two pure renderers:

- `renderOfficialDocumentHtml(model, identity)` — HTML for the print dialog,
  handed to `documentPrintService.printDocumentA4(html)`.
- `renderOfficialDocumentPdf(model, identity)` — PDF bytes for "Save as PDF",
  handed to `documentPrintService.saveDocumentFileWithDialog({ bytes, ... })`.

Both take the same two inputs:

- **`OfficialDocumentModel`** — what to print: title, document number/date,
  status, an optional party block and meta block (label/value rows), a
  table (columns with declared `align`, and rows keyed by column `key`),
  totals (with at most one `emphasis: true`), an optional
  `amountInWordsValue`, free-text notes, and its `kind` (one of
  `SALE_INVOICE | PAYMENT_RECEIPT | SALE_VOID | PURCHASE_RECEIPT |
  SUPPLIER_PAYMENT | JOURNAL_ENTRY | DOCUMENTS_REPORT | JOURNALS_REPORT |
  CASH_SESSION_REPORT | GENERIC`).
- **`OfficialDocumentIdentity`** — the shop's identity (name, legal name,
  address, phone, optional email/website/RIB, NIF/NIS/RC/AI, logo, the
  amount-in-words toggle, the A4 footer note, and the resolved print
  locale), loaded once via `useOfficialDocumentContext(sessionToken)`.

Neither renderer ever formats a number or a date, guesses column alignment
from header text, or renders a signature block — every string arriving in
the model is already translated and formatted by its model builder.

## Design rules that must not be relaxed casually

- **Black and white only.** The stylesheet in `officialDocument.ts` uses
  exactly `#000`, `#444`, `#888`, `#f2f2f2`, and white — nothing else. The
  shop's printer is monochrome.
- **No signature blocks, ever.** Owner ruling (O6).
- **"Stockiha" appears once**, as a small footer credit (`madeWith` in
  `printStrings.ts`) — never as the document's own brand.
- **Column alignment comes from the model** (`align: 'start' | 'center' |
  'end'`), resolved against the print locale's direction — never guessed
  from header text.
- **RTL is real.** When the identity's `printLocale` is `ar`, the HTML page
  gets `dir="rtl"` and every `'end'` column resolves to `text-align: left`
  (and `'start'` to `right`). The PDF path cannot shape Arabic glyphs
  (a `pdf-lib` limitation) — the HTML path is correct; the PDF is for
  sharing/archival.
- **The PDF paginates for real** — it repeats the identity band and the
  table header on every new page and prints `Page X / Y`. Chromium/WebView2
  cannot render `@page` margin boxes, so the HTML path cannot number pages;
  it repeats the table header via `thead { display: table-header-group }`
  instead.

## Settings that feed the identity

`core.printing_settings` (single row) holds the shop's legal identity, the
logo file name (the logo itself lives on disk at
`<app_data_dir>/company-assets/logo.<ext>`, which backup/restore already
covers generically), the print language (`FOLLOW_APP | fr | ar | en`), and
four display toggles (`show_email`, `show_website`, `show_rib`,
`show_logo`) plus `amount_in_words` and `a4_footer_note`. Settings → Printing
is where the Owner edits all of it, including a "Preview an invoice" button
that renders a sample using the current **unsaved** form values.

`useOfficialDocumentContext` loads this once, resolves `FOLLOW_APP` against
the live app locale, and never throws — a failed load still returns an
identity (every field `null`) so printing keeps working.

## Amount in words

`src/shared/documents/amountInWords.ts` spells out the grand total in French
or English (`amountInWords(amount, 'fr' | 'en')`). Algerian commercial
documents are written in French; when the print locale is Arabic the
sentence is still printed in French, under an Arabic label — a deliberate,
documented limitation, not an oversight.

## How to add a new document kind

1. **Add the kind** to `OfficialDocumentKind` in `officialDocument.ts` if it
   isn't already there.
2. **Write a model builder** in `src/shared/documents/models/`. It takes the
   screen's own data (already fetched/computed) plus the resolved
   `PrintLocale`, and returns a fully-translated, fully-formatted
   `OfficialDocumentModel`. Reuse `getModelLabels(locale)` from
   `models/shared.ts` for the common column/section labels (designation,
   quantity, total, customer, debit, credit, …) instead of hand-writing a
   new label table. If the screen's data doesn't cleanly fit an existing
   builder's shape, write a new one rather than overloading an unrelated
   one — but check `genericModel.ts` first, which exists precisely for
   layouts that don't deserve a dedicated builder.
3. **Wire the screen**: load `identity` via `useOfficialDocumentContext`,
   build the model, then:
   - Print: `printDocumentA4(renderOfficialDocumentHtml(model, identity))`.
   - Save as PDF: `const bytes = await renderOfficialDocumentPdf(model,
     identity); await saveDocumentFileWithDialog({ defaultFileName, bytes,
     filterName: 'PDF Document', extension: 'pdf' });`.
   Both actions must exist together (Owner ruling O9) unless the document
   kind is genuinely one-shot internal (none are, today).
4. **Never build an HTML string by hand.** `grep -rn "<!DOCTYPE html"
   src/features` must return nothing outside `officialDocument.ts` itself —
   this is asserted by the WS-M-2 acceptance criteria and should stay true.
5. **Add tests**: extend `tests/official-document.test.ts`'s pattern for
   the renderer-level checks that already apply to every kind (palette,
   no signature block, escaping), and add a builder-specific unit test
   next to the existing ones in that area (see
   `tests/session-report-builders.test.ts` for the shape to follow).

## Print strings and translation

Fixed, renderer-owned strings ("Page", "of", "No lines.", the legal-id
labels, "Printed on", the footer credit) live in
`src/shared/documents/printStrings.ts`, keyed by print locale — never by
app locale. Model-builder-owned column/section labels live in
`src/shared/documents/models/shared.ts`'s `getModelLabels`. Both are plain
`Record<PrintLocale, ...>` objects with no interpolation beyond what the
model already resolved; add a new key to all three locales (`fr`, `ar`,
`en`) at once, matching this project's Algerian French/Arabic commercial
glossary: *facture* = invoice, *reçu* = receipt, *bon de réception* = goods
receipt, *rapport de caisse* = cash report, *annulation* = cancellation
(Arabic: فاتورة, وصل, وصل استلام, تقرير الصندوق, إلغاء). `Stockiha`, `NIF`,
`NIS`, `RC`, `AI`, and `RIB` are never translated, in any locale.
