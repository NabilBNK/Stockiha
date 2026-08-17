# Stockiha Purchase UI/UX Enhancement Specification

## 1. Purpose

Redesign and improve the Stockiha **Purchases**, **New purchase**, and **Purchase receipt details** interfaces so that purchasing remains fast, clear, and usable when the catalog grows beyond 1,000 variants.

This task is not only a visual refresh. It must improve product discovery, make variant information dominant, expose additional purchase costs correctly, and preserve Stockiha's existing inventory and accounting rules.

## 2. Reframed Problem

The current interface has four real problems:

1. The purchase dashboard provides too little operational information and uses oversized, low-density cards.
2. The history table exposes technical or low-value information while omitting useful receipt contents.
3. The new-purchase workflow cannot scale because selecting a variant depends mainly on scrolling through one long list.
4. The details dialog prioritizes generic product names and technical identifiers instead of the exact variants that were purchased.

The request to remove the visible **landed cost** column while adding optional delivery or custom costs must not create two competing cost systems. In this specification, these are called **Additional purchase costs** in the interface and must reuse Stockiha's existing landed-cost accounting behavior.

## 3. Primary UX Principle

**Variant visibility must be greater than product visibility.**

Wherever a purchased item is shown:

- Show the variant name as the primary, most prominent label.
- Show the parent product name as smaller secondary context.
- Show relevant attribute values as readable chips or secondary text.
- Do not display the barcode or SKU as prominent content.
- Barcode and SKU must remain searchable because they are useful for scanning and exact lookup.
- If a variant name is empty, use the existing fallback naming rule: product name plus meaningful attribute values.

Example:

- Primary: `Red – Nike – Double Bed`
- Secondary: `Bed`
- Attributes: `Color: Red`, `Brand: Nike`, `Size: Double`
- Hidden from the normal visual hierarchy: `SKU-00947384`

## 4. Scope

### 4.1 In scope

- Purchase dashboard analytics and interaction.
- Purchase receipt history filters and columns.
- New-purchase layout and field organization.
- Automatic use of the configured destination warehouse.
- Optional additional purchase costs.
- Scalable variant search and selection.
- Purchase receipt details redesign.
- PDF export from purchase receipt details.
- Variant-first display across all purchase-related views changed by this task.
- English, French, and Arabic right-to-left support.
- Light and dark themes.
- Required frontend, backend, database, export, and automated-test changes needed to complete the behavior safely.

### 4.2 Out of scope

- Deleting the warehouse model from Stockiha.
- Removing warehouse data from posted receipts or accounting records.
- Deleting the existing landed-cost accounting capability.
- Deleting SKU or barcode data.
- Redesigning unrelated procurement, sales, catalog, inventory, or accounting pages.
- Changing weighted-average-cost rules beyond applying the existing landed-cost policy correctly.
- Introducing a new accounting policy or parallel cost-posting system.
- Broad refactoring that is not necessary for this purchase-page enhancement.

## 5. Non-Negotiable Business and Engineering Rules

1. Posted receipt, inventory, weighted-average cost, journal, and document records must remain consistent.
2. Money must continue to use Stockiha's exact money representation. Do not introduce floating-point arithmetic.
3. Existing posted receipts must continue to load and export.
4. Do not rename or remove backend fields only because their UI representation is removed.
5. Warehouse selection becomes implicit in this workflow; the backend warehouse relationship remains mandatory.
6. The configured default purchase warehouse must be resolved before confirmation. If no valid default exists, block confirmation and show a clear, actionable configuration error.
7. Additional purchase costs must reuse the existing landed-cost domain and accounting logic. Do not create an unrelated `custom_cost` total that bypasses inventory valuation or journals.
8. Receipt creation and its submitted additional costs must not leave a silently partial result. Validate all data before posting and use the safest existing transactional boundary.
9. Preserve role and permission enforcement. Hiding a field is not authorization.
10. Keep all new user-visible text in the translation system. Do not hard-code English labels inside components.

## 6. Purchases Dashboard Redesign

### 6.1 Visual direction

- Replace the current oversized, mostly empty cards with compact, information-dense analytics cards.
- Use a clear typographic hierarchy:
  - Page title: prominent but not oversized.
  - Metric value: visually dominant.
  - Metric label: readable at normal interface font size.
  - Supporting comparison or description: smaller and muted.
- Use semantic colors, not decorative random colors:
  - Blue: purchase value and primary activity.
  - Green: successfully posted receipts.
  - Amber: additional costs or values requiring attention.
  - Violet or teal: product/variant activity.
  - Red: errors only; never use red for a normal metric.
- All colors must remain readable in light and dark themes and must not be the only way information is communicated.
- Add subtle hover and focus states. Avoid exaggerated animation.

### 6.2 Required metrics

Provide the following metrics for the selected period:

1. **Total receipts** — number of posted purchase receipts.
2. **Purchase subtotal** — sum of purchased item values before additional purchase costs.
3. **Additional costs** — sum of delivery and other additional costs.
4. **Total purchase value** — purchase subtotal plus additional costs.
5. **Variants purchased** — number of distinct variants included in the receipts.
6. **Units purchased** — sum of receipt quantities, respecting Stockiha's quantity precision.
7. **Average receipt value** — total purchase value divided by receipt count; show zero safely when there are no receipts.

Do not invent paid, unpaid, supplier-balance, or tax metrics unless those fields are already reliable in the current purchase receipt contract.

### 6.3 Analytics interaction

- Add a period selector with at least: `7 days`, `30 days`, `90 days`, and `Custom`.
- Add a compact purchase-value trend chart for the selected period.
- Hovering or focusing chart points must show the date, receipt count, purchase subtotal, additional costs, and total.
- Clicking a chart point or period segment should narrow the history list to the matching date range when technically supported by the current filtering architecture.
- Keep the `New purchase` action visible and dominant without allowing it to overpower the page title.
- Empty analytics must show valid zero states, not broken charts or blank cards.

### 6.4 Metric definitions

- Use posted receipts only unless the existing screen explicitly supports other receipt states.
- `Variants purchased` means distinct variant identifiers across the selected receipts.
- `Units purchased` means the sum of quantities, not the number of receipt lines.
- `Total purchase value = purchase subtotal + additional purchase costs`.
- Values displayed in analytics must reconcile exactly with the filtered receipts used to calculate them.

## 7. Purchase Receipts & History

### 7.1 Filter bar

Remove:

- Origin filter.
- Warehouse filter.

Keep and improve:

- One search input for receipt number, supplier name, journal number, variant name, product name, barcode, or SKU.
- Supplier filter.
- Date range filter.
- Clear-all-filters action when any filter is active.
- Visible active-filter count or chips so the user knows why rows are hidden.

Search must be case-insensitive and should ignore harmless whitespace differences. Barcode and exact receipt-number matches must rank first.

### 7.2 History columns

Use this column order:

1. Receipt number.
2. Date.
3. Supplier.
4. Warehouse.
5. Items.
6. Total.
7. Receipt journal.
8. Actions.

Changes from the current table:

- Remove the **Origin** column.
- Replace it with **Items**.
- Remove the **Landed cost** column.
- Keep the warehouse column because the request removes only the filter and the new-purchase input, not the stored destination data. The default warehouse can still be meaningful historical information.

### 7.3 Items column definition

- The main value is the count of distinct receipt lines/variants, for example `3 variants`.
- Also expose total quantity as smaller secondary information or a tooltip, for example `30 units`.
- Do not label total quantity as product count.
- The count must come from receipt data and must not require opening every receipt through an N+1 query pattern.

### 7.4 Table behavior

- Make receipt number, date, supplier, item count, and total sortable where supported.
- Preserve the current filters and scroll position after closing receipt details.
- Provide clear loading, empty, no-results, and error states.
- Use a compact action button or menu with an accessible label such as `View receipt PR-2026-000005`.
- Avoid excessive row height and unnecessary line wrapping.
- Pagination or virtualization is required if the current query can return a large unbounded history.

## 8. New Purchase Page

### 8.1 Remove destination warehouse from the visible form

- Remove the **Destination warehouse** field from the user interface.
- Resolve the configured default purchase warehouse automatically.
- Continue sending a valid warehouse identifier through the existing backend contract.
- Do not hard-code `Main Warehouse` or any database identifier.
- If the configured warehouse is missing, inactive, inaccessible, or invalid, prevent posting and show a specific error explaining how to correct the default warehouse setting.
- The resolved warehouse may be shown as small read-only context near the page title or summary, but it must not consume a normal editable field.

### 8.2 Recommended layout

Use a compact desktop layout with clear sections:

1. **Purchase information**
   - Supplier.
   - Purchase date.
   - Note/reference.
   - Small read-only default warehouse context if useful.
2. **Add purchased variants**
   - Prominent search and filter control.
   - Selected variant result.
   - Quantity, unit, and unit cost.
   - Add-to-receipt action.
3. **Receipt lines**
   - Variant-first item table.
   - Inline editing for quantity and unit cost.
   - Remove-line action.
4. **Additional purchase costs**
   - Optional dynamic cost rows.
5. **Totals and confirmation**
   - Item subtotal.
   - Additional costs.
   - Grand total.
   - Cancel and confirm actions.

Layout requirements:

- Use the full content width intelligently and remove the large unused white area visible in the current form.
- Align related fields on a consistent grid.
- Use consistent horizontal and vertical spacing tokens from the Stockiha design system.
- Keep the totals and confirmation area visible with a sticky summary/footer when the line list becomes long.
- Do not place destructive actions next to the primary confirm action without clear visual separation.
- Confirmation must be protected against accidental double submission.

## 9. Additional Purchase Costs

### 9.1 User interface

Add an optional **Additional purchase costs** section below the receipt lines.

Each cost row contains:

- Cost label or type, for example `Delivery`, `Loading`, `Customs`, or `Other`.
- Optional description/reference.
- Amount in DZD.
- Remove action.

Provide:

- `+ Add cost` action.
- Useful predefined labels plus a custom label option.
- A live additional-cost subtotal.
- A grand total that updates immediately.

Validation:

- Amount must be greater than zero.
- Empty rows must not be submitted.
- Label is required when an amount exists.
- Apply the existing maximum amount, precision, and currency constraints.
- Duplicate labels are allowed because two separate deliveries may exist, but each row must remain independently stored and visible.

### 9.2 Accounting behavior

- Treat these entries as the receipt-creation interface for Stockiha's existing landed/additional-cost capability.
- Preserve the individual label, description, and amount for audit and export.
- Apply the existing landed-cost allocation and journal rules rather than inventing a second accounting path.
- Include additional costs in the displayed grand total.
- Show the allocation/accounting result in receipt details after posting.
- If the current backend cannot post a direct receipt and its additional costs safely in one workflow, extend the application service deliberately. Do not simulate success in the frontend while a second posting silently fails.

## 10. Variant Search and Selection

### 10.1 Replace the long select control

Replace the current native or basic dropdown with a searchable, keyboard-accessible variant picker designed for more than 1,000 variants.

The picker must support:

- Variant name search.
- Parent product name search.
- Barcode search and scanner input.
- SKU search.
- Current reference/selling price search where available.
- Attribute name and attribute value search, such as `Red`, `Nike`, `Double`, `Cotton`.
- Combined terms, such as `bed red nike`.

### 10.2 Search ranking

Use the following priority:

1. Exact barcode match.
2. Exact SKU match.
3. Exact variant-name match.
4. Variant-name prefix match.
5. Attribute-value match.
6. Parent-product-name match.
7. Partial/fuzzy text match, if an existing safe search utility supports it.

Do not implement an unpredictable fuzzy algorithm that makes exact results harder to reach.

### 10.3 Search interface

- Use one primary search box with a clear placeholder: `Search variants by name, product, barcode, SKU, price, or attribute…`.
- Provide optional filter chips or an expandable advanced-filter area for:
  - Product.
  - Attribute name/value.
  - Price minimum and maximum.
  - Active/available variants if that state already exists.
- Display the variant name prominently in every result.
- Display parent product and meaningful attributes as secondary context.
- Display price as useful supporting information.
- Keep barcode and SKU hidden by default, but reveal them for an exact barcode/SKU query or in a compact metadata/tooltip area.
- Clearly mark an already-added variant and allow the user to focus its existing receipt line rather than adding an accidental duplicate.

### 10.4 Performance and accessibility

- Do not load and render 1,000+ options at once.
- Use backend/search-layer filtering, pagination, or a virtualized result list.
- Debounce normal typed search approximately 150–250 milliseconds.
- Do not delay exact scanner/barcode submission unnecessarily.
- Return a limited result page and provide a way to continue when more matches exist.
- The picker must work with keyboard only: focus, arrows, Enter to select, Escape to close.
- Provide visible focus states and accessible names.
- Search must not freeze the UI or reset entered receipt data.

## 11. Receipt-Line Presentation

Use these visible fields in the new-purchase line table:

1. Variant.
2. Product/attributes as secondary context inside the variant cell.
3. Unit.
4. Quantity.
5. Unit cost.
6. Line total.
7. Actions.

Rules:

- Do not make SKU or barcode a dedicated visible column.
- Unit cost must be clearly distinguished from selling/reference price shown during search.
- Line totals and receipt totals must update immediately and use exact money rules.
- Inline validation must identify the specific line and field that is invalid.
- A duplicate variant should normally merge or focus the existing line instead of silently creating a second indistinguishable row, unless the domain explicitly requires separate lines.

## 12. Purchase Receipt Details Redesign

### 12.1 Dialog structure

Redesign the details window with a cleaner hierarchy and consistent margins:

1. **Header**
   - Receipt number.
   - Posted status.
   - Purchase date.
   - Supplier.
   - Close control.
2. **Summary**
   - Supplier.
   - Date.
   - Destination warehouse.
   - Item subtotal.
   - Additional costs.
   - Grand total.
3. **Purchased variants**
   - Detailed, variant-first table.
4. **Additional purchase costs**
   - Cost label, description, amount, and allocation summary.
5. **Accounting and audit**
   - Receipt journal reference.
   - Relevant accounting impact.
   - Created/posted metadata when already available.
6. **Actions**
   - Export PDF.
   - Export Excel, preserving the existing capability.
   - Close.

### 12.2 Purchased-variant details

The item table must show:

- Variant name as the primary label.
- Parent product name as secondary text.
- Attribute names and values.
- Unit.
- Quantity.
- Unit cost.
- Line total.

Do not show SKU or barcode as a prominent column. They can exist in a collapsible technical-details area or be omitted from the normal view while remaining available in exported audit data if required.

### 12.3 Dialog usability

- Use balanced padding and spacing throughout the modal.
- Keep the header and action footer visible while scrolling long receipt contents.
- Avoid nested scroll areas unless required for the large items table.
- The modal must fit common laptop resolutions without clipping actions.
- Escape closes the dialog when safe; focus remains trapped inside while open and returns to the originating `View details` button on close.
- Do not close the dialog during an in-progress export without informing the user.

## 13. PDF Export

Add **Export PDF** to the receipt details actions.

The PDF must include:

- Stockiha/business identity already supported by the document system.
- Purchase receipt number and posted status.
- Supplier, date, and warehouse.
- Variant-first purchased-item details.
- Attributes for each variant.
- Quantity, unit cost, and line total.
- Item subtotal.
- Itemized additional purchase costs.
- Grand total.
- Receipt journal reference when appropriate.
- Page number and generated timestamp where supported by the existing document conventions.

PDF requirements:

- Use the existing Stockiha document/PDF generation path; do not create an unrelated browser-print implementation if a maintained document service exists.
- Support English, French, and Arabic right-to-left output.
- Use proper fonts for Arabic and embed fonts when required.
- Prevent table clipping and orphaned totals across pages.
- Use correct DZD formatting and exact stored values.
- Use a deterministic, safe filename such as `Purchase_Receipt_PR-2026-000005.pdf`.
- Report export failure clearly and do not show a false success message.

## 14. Data Contracts and Backend Requirements

Before editing, trace the complete current workflow:

`Purchase screen → frontend command/gateway → Tauri command → application service → database function/transaction → inventory ledger → accounting journal → document registry/export`

Required contract work may include:

- Summary query fields for analytics.
- Receipt-list fields for distinct variant-line count and total quantity.
- Search parameters and paginated variant results.
- Default purchase warehouse resolution.
- Additional purchase-cost input rows and posting result.
- Receipt-details fields for variant names, parent product names, attributes, costs, allocation, and totals.
- PDF export payload.

Rules:

- Prefer server/database aggregation for analytics and counts. Do not fetch all receipts and calculate large histories in React.
- Avoid N+1 queries for item count, variant attributes, and receipt details.
- Keep existing API/command consumers compatible or update all consumers and tests together.
- Preserve database permission and `SECURITY DEFINER` boundaries already used by Stockiha.
- Do not expose raw database errors in the UI.

## 15. Error, Loading, and Empty States

Implement explicit states for:

- Dashboard loading and unavailable analytics.
- No purchase receipts yet.
- No history results for active filters.
- Variant search before typing.
- Variant search with no matches.
- Search/backend failure with retry.
- Missing default warehouse.
- Invalid quantity or unit cost.
- Invalid additional cost.
- Receipt-posting failure.
- PDF-generation failure.
- Duplicate confirmation attempt.

User-entered supplier, date, note, lines, and costs must remain intact after a recoverable failure.

## 16. Internationalization and Themes

- Add every new label, status, validation message, tooltip, chart label, and export message to English, French, and Arabic translations.
- Validate Arabic right-to-left layout for forms, tables, dialogs, charts, currency, and PDF.
- Do not reverse numeric values, receipt numbers, SKUs, barcodes, or journal identifiers incorrectly in right-to-left mode.
- Validate meaningful contrast and status colors in both light and dark themes.
- Do not use fixed widths that only fit English.

## 17. Accessibility Requirements

- All fields and buttons must have programmatic labels.
- Icon-only controls require accessible names and tooltips.
- Filters, variant search, receipt lines, modal, and export controls must work by keyboard.
- Use visible focus indicators.
- Associate inline validation messages with their fields.
- Do not communicate status or chart meaning by color alone.
- Respect reduced-motion settings.

## 18. Implementation Sequence

1. Inspect the current purchase components, commands, data-transfer objects, migrations, database functions, accounting rules, and export utilities.
2. Document the current purchase posting and landed-cost path before changing it.
3. Add or extend backend read models for analytics, item counts, variant search, and receipt details.
4. Add safe default-warehouse resolution.
5. Extend the purchase creation contract for itemized additional purchase costs using existing landed-cost accounting logic.
6. Add focused backend/database tests for totals, allocation, journals, permissions, and rollback behavior.
7. Build the scalable variant picker and its tests.
8. Redesign the new-purchase form and receipt-line workflow.
9. Redesign dashboard analytics and history.
10. Redesign receipt details.
11. Add PDF export through the existing document pipeline.
12. Complete translations, themes, keyboard behavior, and responsive laptop-layout checks.
13. Run the full relevant automated checks and complete manual acceptance tests.

Do not begin with cosmetic CSS while the required data and accounting contracts are unresolved.

## 19. Required Automated Tests

Add or update tests for at least:

### 19.1 Analytics

- Correct zero state.
- Correct date-period filtering.
- Correct receipt, subtotal, additional-cost, total, distinct-variant, unit, and average calculations.
- Reconciliation between analytics and filtered history.

### 19.2 History

- Origin and warehouse filters are absent.
- Origin and landed-cost columns are absent.
- Items column returns correct distinct variant-line count and total quantity.
- Search matches receipt, supplier, journal, variant, product, barcode, and SKU.
- Sorting and pagination preserve filters.

### 19.3 Default warehouse

- Valid configured default warehouse posts correctly.
- Missing, inactive, or unauthorized default blocks before posting.
- No warehouse identifier is hard-coded.

### 19.4 Variant search

- Exact barcode ranks first.
- Exact SKU ranks second after an exact barcode.
- Variant name, product name, attribute, combined-term, and price filters work.
- Pagination/virtualization does not duplicate or lose selection.
- Keyboard selection works.
- Search handles at least 1,000 seeded variants without rendering them all at once.

### 19.5 Additional costs and accounting

- No-cost receipt remains compatible with the old workflow.
- One and multiple additional costs calculate correctly.
- Invalid and empty costs are rejected.
- Receipt subtotal, cost subtotal, allocation, grand total, inventory valuation, and journal values reconcile.
- Posting failure does not report a successful complete receipt with missing costs.
- Existing landed-cost behavior remains valid for older receipts.

### 19.6 Receipt details and exports

- Variant name and attributes appear correctly.
- Product is secondary.
- SKU/barcode are not prominent.
- PDF and Excel totals match stored receipt values.
- Long receipts paginate correctly in PDF.
- English, French, and Arabic PDF output renders correctly.

## 20. Manual Acceptance Scenarios

### Scenario A — Dashboard and history

1. Open Purchases with receipts in several dates.
2. Switch between 7, 30, and 90 days.
3. Confirm every metric and chart value changes consistently.
4. Confirm Origin and Warehouse filters are gone.
5. Confirm Origin and Landed cost columns are gone.
6. Confirm Items shows variant-line count plus total quantity.
7. Search by receipt, supplier, variant name, barcode, and SKU.
8. Sort supported columns twice and verify ascending and descending order.

### Scenario B — Large catalog search

1. Use a database containing at least 1,000 active variants.
2. Search by exact barcode and confirm the exact variant is first.
3. Search by SKU.
4. Search by variant name.
5. Search using parent product plus two attribute values.
6. Filter by price range.
7. Select with keyboard only.
8. Confirm the interface does not freeze and does not render the entire catalog.

### Scenario C — Create a purchase with additional costs

1. Start a new purchase.
2. Confirm no editable destination-warehouse field exists.
3. Select a supplier and date.
4. Add at least three distinct variants.
5. Edit quantity and unit cost for each.
6. Add `Delivery` and another custom cost.
7. Confirm item subtotal, additional-cost subtotal, and grand total.
8. Post once and confirm double-clicking cannot create a duplicate.
9. Verify inventory quantities, weighted-average costs, receipt record, document record, and accounting journal.

### Scenario D — Receipt details

1. Open the posted receipt.
2. Confirm variant names are visually dominant.
3. Confirm product names and attributes provide secondary context.
4. Confirm additional costs and allocation details are visible.
5. Confirm spacing, scrolling, sticky header/footer, and focus behavior.
6. Close and confirm the history retains its filters and scroll position.

### Scenario E — Export

1. Export the receipt as PDF in English, French, and Arabic.
2. Open every file and inspect all pages.
3. Confirm variant attributes, item totals, costs, grand total, currency, and journal reference.
4. Confirm Arabic is correctly shaped and right-to-left.
5. Export Excel and confirm its values match the PDF and receipt details.

### Scenario F — Failure safety

1. Remove or disable the configured default warehouse and attempt confirmation.
2. Confirm posting is blocked with a useful message and no partial records.
3. Trigger a recoverable search or posting error.
4. Confirm entered receipt data is preserved.
5. Trigger a PDF failure and confirm no false success message appears.

## 21. Definition of Done

The task is complete only when:

- All in-scope interface and behavior changes are implemented.
- The purchase dashboard is denser, more meaningful, interactive, and visually consistent.
- Origin and warehouse filters are removed.
- Origin and landed-cost history columns are removed.
- The Items column is accurate and performant.
- New purchase no longer asks the user to choose a warehouse and still posts to the configured default safely.
- Additional purchase costs are itemized and use the existing landed-cost accounting rules.
- A user can find a specific variant efficiently in a catalog of more than 1,000 variants.
- Variant names and attributes are more prominent than parent product names.
- Barcode and SKU remain searchable but are not visually dominant.
- Receipt details are redesigned and contain meaningful variant, cost, total, accounting, and audit information.
- PDF export works through Stockiha's maintained document pipeline.
- English, French, Arabic right-to-left, light theme, and dark theme are verified.
- Automated tests pass.
- Manual acceptance scenarios pass.
- No inventory, weighted-average-cost, journal, document-registry, permissions, or historical-receipt regression remains.

## 22. Prohibited Shortcuts

- Do not replace the product dropdown with another dropdown that still renders every variant.
- Do not calculate all analytics by downloading every receipt into the frontend.
- Do not remove warehouse data from the backend.
- Do not hard-code the main warehouse.
- Do not create a frontend-only custom-cost field.
- Do not create a second accounting concept parallel to landed costs.
- Do not hide posting failures behind a generic success message.
- Do not make barcode or SKU visible as the primary item name.
- Do not omit variant attributes from receipt details and PDF.
- Do not produce PDF through an unmaintained one-off path when the Stockiha document service can be extended.
- Do not skip Arabic, dark-theme, keyboard, performance, accounting, or rollback tests.
- Do not declare completion based only on screenshots or successful compilation.
