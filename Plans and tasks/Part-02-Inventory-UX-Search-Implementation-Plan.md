# Part 02 --- Inventory Corrections UX & Search Implementation Plan

## 1. Objective

Improve the Stockiha Part 02 inventory experience based on the completed
manual verification.

The backend inventory-correction implementation is considered working.
This task is focused on the remaining UX/UI and search improvements:

1.  Fix **Positive quantity** input so it accepts only valid decimal
    quantities.
2.  Improve **Search item** so users can search by:
    -   Barcode
    -   SKU
    -   Product name
    -   Variant name
    -   Attribute value
3.  Replace the current inline item-search experience with a dedicated
    **item-search popup/modal**.
4.  Make inventory rows identify products primarily by **variant name**,
    not ambiguous product name.
5.  Display **barcode before SKU** when a barcode exists.
6.  Improve inventory and inventory-correction UI spacing, hierarchy,
    margins, and usability.
7.  Improve validation/error feedback so protected operations explain
    the problem clearly to the user.
8.  Do **not** change alternative-unit behavior in this task;
    alternative units are explicitly out of scope for now.

------------------------------------------------------------------------

# 2. Current Verified State

The following Part 02 functionality has already been manually verified
as working:

-   Inventory corrections policy works.
-   Inventory correction workflow works.
-   Positive/negative correction behavior works.
-   Correction reason handling works.
-   Stock protection works.
-   Zero-stock/WAC protection works.
-   Inventory consistency works.
-   Existing Part 02 behavior is generally working.
-   The dedicated stock-adjustment workflow tests pass.
-   PostgreSQL S2-002 integration assertions pass.

The following issues remain:

### Issue A --- Quantity input

Current **Positive quantity** field should reject arbitrary characters
and accept valid decimal quantities only.

Expected behavior:

-   Accept digits.
-   Accept decimal quantities.
-   Reject letters.
-   Reject arbitrary symbols.
-   Reject malformed decimal values.
-   Preserve the application's existing precision rules.
-   Do not use JavaScript floating-point arithmetic for business
    calculations.
-   Frontend validation must improve UX, but backend validation remains
    authoritative.

### Issue B --- Ambiguous inventory names

The Inventory page currently displays the product name.

Example problem:

``` text
Product: Bed
Product: Bed
```

When multiple variants exist under the same product, the user cannot
easily distinguish them.

The Inventory page should instead prioritize:

``` text
Variant A
Variant B
```

The variant name is the primary human-readable identifier.

### Issue C --- Barcode should have priority over SKU

When an item has a barcode:

``` text
Barcode > SKU
```

Therefore, the UI should show:

``` text
Barcode: 123456789
```

before:

``` text
SKU: SKU-00000010
```

If no barcode exists, show the SKU.

Do not remove the SKU from the data model or business logic. This is a
display-priority rule.

### Issue D --- Search experience

The current item search is an inline field.

It should become a dedicated search interaction:

``` text
Click / focus Search Item
        ↓
Open Item Search modal
        ↓
Search field
        ↓
Search across multiple identifiers
        ↓
Display matching items
        ↓
User selects item
        ↓
Modal closes
        ↓
Selected item appears in correction form
```

### Issue E --- Error feedback

Some validation/protection logic works technically but does not explain
the problem clearly enough to the user.

For example, if an operation is rejected because of inventory
protection, the UI should explain:

-   What went wrong.
-   Why the operation was rejected.
-   What the user should do next, where appropriate.

Do not expose backend diagnostics, SQL errors, stack traces, or internal
implementation details.

------------------------------------------------------------------------

# 3. Scope

## In Scope

### Inventory Corrections

-   Quantity input validation.
-   Search-item UX.
-   Search result presentation.
-   Item selection.
-   Error messaging.
-   Form spacing and visual hierarchy.

### Inventory Page

-   Variant-first display.
-   Barcode-first identifier display.
-   Better table readability.
-   Improved spacing and margins.
-   Better distinction between similar variants.

### Shared Search Behavior

The item search should support:

``` text
Barcode
SKU
Product name
Variant name
Attribute value
```

Search should be case-insensitive where appropriate and should not
require users to know which field contains the value.

## Explicitly Out of Scope

Do NOT implement:

-   Alternative-unit enhancements.
-   New inventory accounting rules.
-   New correction reason types.
-   Changes to WAC calculation.
-   Changes to stock-adjustment accounting.
-   Changes to negative-stock rules.
-   Changes to inventory-correction authorization.
-   Changes to the Part 02 database contract unless strictly required to
    support the search/display task.
-   User/role-management redesign.
-   Cashier/manager/admin creation workflow.

The existing Part 02 business rules must remain unchanged.

------------------------------------------------------------------------

# 4. Design Principles

The implementation must follow these principles:

1.  **Backend remains authoritative.**
2.  **Frontend validation is for UX, not security.**
3.  **Do not duplicate business calculations in the UI.**
4.  **Do not introduce floating-point inventory calculations.**
5.  **Do not modify working Part 02 accounting behavior.**
6.  **Prefer existing shared components and styling conventions.**
7.  **Avoid unnecessary dependencies.**
8.  **Keep the implementation small and easy to review.**
9.  **Do not refactor unrelated code.**
10. **Preserve RTL/Arabic support.**
11. **Preserve keyboard accessibility.**
12. **Preserve existing tests and add focused tests for the new
    behavior.**

------------------------------------------------------------------------

# 5. Phase 1 --- Repository Inspection

Before modifying code, inspect the repository.

Find:

``` text
StockAdjustmentScreen
InventoryScreen
inventoryCorrectionsGateway
inventory-related IPC contracts
catalog/product/variant models
barcode/SKU fields
attribute/value models
existing modal/dialog components
existing form/input components
existing validation helpers
existing error translation helpers
inventory tests
stock-adjustment workflow tests
```

Likely areas include:

``` text
src/features/inventory/
src/shared/ipc/
src/shared/hooks/
src/shared/
tests/
src-tauri/
```

Do not assume exact filenames. Search the repository first.

## Inspection goals

Determine:

1.  Where inventory rows are assembled.
2.  Where product/variant data comes from.
3.  Whether barcode is already available in the inventory query.
4.  Whether variant name is already available.
5.  Where attribute values are stored/exposed.
6.  How the current item search works.
7.  Whether an existing reusable dialog/modal exists.
8.  How errors are translated into user-facing text.
9.  Which existing tests cover the correction form.

Do not create duplicate data-access paths if the existing IPC contract
already provides the required information.

------------------------------------------------------------------------

# 6. Phase 2 --- Quantity Input

## 6.1 Required behavior

The quantity field must accept valid decimal quantities only.

Examples of acceptable input:

``` text
1
2
10
1.5
0.25
12.125
```

Subject to the application's existing maximum precision.

Reject:

``` text
abc
1abc
abc1
1..5
--
++
1,5
<script>
```

Do not rely solely on:

``` html
type="number"
```

because browser number inputs can still have inconsistent behavior
across platforms and can permit values that are undesirable for the
application's exact decimal contract.

## 6.2 Recommended implementation

Use a text input with controlled validation if that matches the existing
decimal-string architecture.

The UI should:

-   Allow typing valid decimal prefixes.
-   Prevent obviously invalid characters where practical.
-   Validate the complete value before submission.
-   Show an inline validation message when invalid.
-   Keep the backend validation unchanged.

Do not convert the quantity into a JavaScript `number` for business
calculations.

Prefer the existing exact decimal/string helpers.

## 6.3 UX

Label:

``` text
Quantity
```

Avoid awkward dynamic labels such as:

``` text
Positive quantity
```

unless the application intentionally uses direction-specific labels.

The selected direction can determine the semantic meaning.

Show an example/helper when useful:

``` text
Enter a positive quantity, e.g. 1.5
```

The field should clearly indicate that the quantity itself is positive
while the selected direction determines increase/decrease.

------------------------------------------------------------------------

# 7. Phase 3 --- Global Item Search

## 7.1 Search fields

Search must cover:

``` text
Barcode
SKU
Product name
Variant name
Attribute value
```

The user should not need to select a search type.

Example:

``` text
Search: red
```

could match:

``` text
Variant: Chair Red
Attribute: Color = Red
```

Example:

``` text
Search: 123456789
```

should match:

``` text
Barcode: 123456789
```

Example:

``` text
Search: SKU-000001
```

should match by SKU.

## 7.2 Search semantics

Preferred behavior:

-   Case-insensitive.
-   Trim surrounding whitespace.
-   Partial matching for names/attributes.
-   Exact or prefix-friendly matching for barcode/SKU where appropriate.
-   Stable deterministic ordering.
-   No duplicate result rows when multiple searchable fields match the
    same item.

Do not silently change backend search semantics if an existing canonical
search function already exists.

If the backend already provides the necessary search contract, reuse it.

------------------------------------------------------------------------

# 8. Phase 4 --- Dedicated Item Search Modal

## 8.1 Interaction

Replace the current large inline item selector/search combination with a
dedicated search control.

Recommended UI:

``` text
Search item
[ Search by barcode, SKU, product, variant, or attribute ]

        ↓ click

┌───────────────────────────────────────────────┐
│ Search items                              X   │
│                                               │
│ [ Search barcode, SKU, product, variant... ] │
│                                               │
│ Results                                       │
│                                               │
│ Variant Name                                  │
│ Barcode: 123456789                            │
│ SKU: SKU-000001                               │
│ Color: Red                                    │
│                                               │
│ Variant Name 2                                │
│ SKU: SKU-000002                               │
│ Size: Large                                   │
└───────────────────────────────────────────────┘
```

## 8.2 Modal behavior

The modal must:

-   Open from the Search Item control.
-   Focus the search input automatically.
-   Support keyboard navigation.
-   Allow Enter to select a highlighted result.
-   Allow Escape to close.
-   Allow clicking outside to close if consistent with existing modal
    conventions.
-   Preserve the current selection when reopened.
-   Close after selecting an item.
-   Return the selected item to the correction form.

## 8.3 Empty state

If there are no matches:

``` text
No items found.

Try searching by:
• barcode
• SKU
• product name
• variant name
• attribute
```

## 8.4 Loading state

If search is asynchronous:

``` text
Searching items…
```

Do not show a blank modal while the request is pending.

## 8.5 Result design

Each result must be visually distinguishable.

Recommended hierarchy:

``` text
Variant Name
Product Name
Barcode / SKU
Attribute values
```

Example:

``` text
Office Chair — Red
Product: Chair

Barcode: 123456789
SKU: CHAIR-RED-001

Color: Red
Material: Fabric
```

The variant name should be the strongest identifier.

------------------------------------------------------------------------

# 9. Phase 5 --- Inventory Page Display

## 9.1 Variant-first presentation

Current:

``` text
PRODUCT
Bed
Bed
```

Desired:

``` text
ITEM / VARIANT
Single Bed — White
Single Bed — Black
```

The exact label should follow the application's terminology.

The key requirement is:

> Variant name is the primary visible identifier.

## 9.2 Product name

Product name can remain as secondary context.

Recommended structure:

``` text
Single Bed — White
Bed
```

This preserves context without making the two rows look identical.

## 9.3 Barcode priority

Display identifiers in this order:

``` text
Barcode
SKU
```

If barcode exists:

``` text
Barcode: 123456789
SKU: SKU-00000010
```

If barcode does not exist:

``` text
SKU: SKU-00000010
```

Do not show:

``` text
SKU: SKU-00000010
Barcode: —
```

unless the existing table design explicitly requires empty fields.

The UI should avoid unnecessary noise.

------------------------------------------------------------------------

# 10. Phase 6 --- Inventory Table UX

Improve:

-   Row padding.
-   Column spacing.
-   Header spacing.
-   Text hierarchy.
-   Badge alignment.
-   Search/filter spacing.
-   Table readability.
-   Responsive behavior.

## Recommended hierarchy

Primary:

``` text
Variant name
```

Secondary:

``` text
Product name
Barcode
SKU
Attributes
```

Operational values:

``` text
Quantity
WAC
Total value
```

Status:

``` text
Active
Inactive
```

Use consistent typography rather than making every piece of metadata
equally prominent.

------------------------------------------------------------------------

# 11. Phase 7 --- Inventory Corrections UI Spacing

The screenshots show large horizontal containers and substantial empty
space.

Improve:

-   Form group spacing.
-   Label-to-input spacing.
-   Input-to-input spacing.
-   Modal padding.
-   Button spacing.
-   Section separation.
-   Mobile/responsive layout.

Recommended structure:

``` text
Page title
Subtitle

Correction form
────────────────────────

Warehouse       Correction date

Search item

Selected item

Direction

Quantity        Unit

Reason          Note

Validation / feedback

Confirm adjustment
```

Avoid excessive gaps while preserving a comfortable visual rhythm.

Use the existing design system tokens if available.

Do not introduce arbitrary one-off pixel values when reusable spacing
tokens already exist.

------------------------------------------------------------------------

# 12. Phase 8 --- User-Facing Error Messages

Current behavior protects the operation, but some failures do not
explain themselves sufficiently.

Every expected business-rule rejection should produce a clear message.

Examples:

### Missing WAC

Use the existing verified message:

``` text
This increase cannot be valued because the item has no usable WAC.
```

### Insufficient stock

Prefer:

``` text
This adjustment cannot be completed because the decrease exceeds the available stock.
```

### Disabled corrections

Prefer:

``` text
Inventory corrections are currently disabled.
Ask an administrator to enable inventory corrections before posting a new adjustment.
```

### Missing OTHER note

Prefer:

``` text
Please provide a note when the reason is Other.
```

### Invalid quantity

Prefer:

``` text
Enter a valid positive decimal quantity.
```

Messages must:

-   Be understandable to non-technical users.
-   Explain the actual problem.
-   Avoid SQL/database terminology.
-   Avoid stack traces.
-   Avoid internal IPC names.
-   Avoid leaking diagnostics.

Use the existing error translation mechanism where possible.

------------------------------------------------------------------------

# 13. Phase 9 --- Accessibility

The new search modal must support:

-   Keyboard focus.
-   Visible focus state.
-   Escape to close.
-   Enter to select.
-   Proper button labels.
-   Proper dialog semantics.
-   Screen-reader-friendly labels.
-   Logical tab order.

Quantity validation must not rely only on color.

Errors should include visible text.

RTL behavior must remain correct for Arabic.

Test:

``` text
English LTR
Arabic RTL
```

------------------------------------------------------------------------

# 14. Phase 10 --- Tests

Add focused tests without rewriting the existing suite.

## 14.1 Quantity tests

Test:

``` text
1       -> accepted
1.5     -> accepted
0.25    -> accepted
abc     -> rejected
1abc    -> rejected
1..5    -> rejected
empty   -> rejected on submit
```

Also verify the existing maximum decimal precision.

## 14.2 Search tests

Test each searchable field:

``` text
barcode
SKU
product name
variant name
attribute value
```

Test:

-   Case-insensitive search.
-   Partial name search.
-   No-result state.
-   Duplicate-match deduplication.
-   Selection behavior.

## 14.3 Modal tests

Test:

``` text
opens modal
focuses search field
shows results
selects item
closes modal
selected item appears in form
Escape closes
empty state renders
```

## 14.4 Inventory display tests

Verify:

``` text
variant name is primary
product name is secondary
barcode is shown when available
SKU is fallback/secondary
```

Test both:

``` text
item with barcode
item without barcode
```

## 14.5 Error-message tests

Verify that expected backend rejection codes become user-facing
explanations.

Do not assert internal diagnostic text.

------------------------------------------------------------------------

# 15. Phase 11 --- Regression Verification

After implementation, run the existing relevant tests first.

At minimum:

``` powershell
npm test -- tests/stock-adjustment.workflow.test.tsx
```

Then run the broader frontend suite:

``` powershell
npm test
```

Then:

``` powershell
npm run typecheck
npm run build
```

If the repository has lint configured:

``` powershell
npm run lint
```

Do not modify backend accounting code merely to make frontend tests
pass.

------------------------------------------------------------------------

# 16. Manual Verification Checklist

## Inventory Corrections

### Quantity

-   [ ] Can enter `1`.
-   [ ] Can enter `1.5`.
-   [ ] Can enter valid decimal precision.
-   [ ] Cannot enter letters.
-   [ ] Cannot submit malformed decimal values.
-   [ ] Error is understandable.

### Search

-   [ ] Search by barcode.
-   [ ] Search by SKU.
-   [ ] Search by product name.
-   [ ] Search by variant name.
-   [ ] Search by attribute value.
-   [ ] Search is case-insensitive where expected.
-   [ ] No-results state is clear.
-   [ ] Search modal opens correctly.
-   [ ] Search input receives focus.
-   [ ] Selecting a result closes the modal.
-   [ ] Selected item appears in the form.

### Correction workflow

-   [ ] Increase still works.
-   [ ] Decrease still works.
-   [ ] OTHER note protection still works.
-   [ ] Zero-stock/WAC protection still works.
-   [ ] Negative-stock protection still works.
-   [ ] Disabled policy still blocks posting.
-   [ ] Existing historical corrections remain unaffected.

## Inventory Page

-   [ ] Variant name is the primary visible identifier.
-   [ ] Similar product rows are distinguishable.
-   [ ] Product name remains useful secondary context.
-   [ ] Barcode is displayed when available.
-   [ ] Barcode appears before SKU.
-   [ ] SKU is shown when barcode is unavailable.
-   [ ] Quantity/WAC/value remain correct.
-   [ ] Table remains readable.

## UI/UX

-   [ ] Spacing is consistent.
-   [ ] No excessive empty gaps.
-   [ ] Form fields align correctly.
-   [ ] Modal is visually balanced.
-   [ ] Buttons have appropriate spacing.
-   [ ] Error messages are visible and understandable.
-   [ ] English layout works.
-   [ ] Arabic RTL layout works.
-   [ ] Keyboard navigation works.

------------------------------------------------------------------------

# 17. Implementation Constraints for the AI Agent

The implementing AI agent must follow these rules.

## Rule 1 --- Inspect before editing

Do not immediately rewrite components.

First inspect the existing implementation and identify the smallest set
of files that need changes.

## Rule 2 --- Reuse existing infrastructure

Search for existing:

``` text
Dialog
Modal
Search
Input
Error
Toast
Form
Select
Table
```

components before creating new ones.

## Rule 3 --- Do not duplicate business logic

The backend remains authoritative for:

``` text
stock availability
WAC
valuation
authorization
inventory correction policy
accounting
idempotency
```

## Rule 4 --- Keep search canonical

If a canonical backend/catalog search exists, extend or reuse it rather
than creating a second unrelated search implementation.

## Rule 5 --- Preserve exact decimal behavior

Do not replace exact decimal/string quantity handling with JavaScript
floating-point arithmetic.

## Rule 6 --- Avoid unrelated refactors

Do not modify:

``` text
purchase workflows
cash workflows
accounting workflows
backup/recovery
user management
alternative units
```

unless compilation requires a minimal related adjustment.

## Rule 7 --- Preserve existing tests

Existing passing Part 02 tests must remain passing.

## Rule 8 --- Test incrementally

After each logical change:

``` text
typecheck
focused test
```

Then run the broader suite.

------------------------------------------------------------------------

# 18. Suggested File-Level Work Strategy

The agent should discover exact paths first, but the expected
implementation areas are approximately:

``` text
src/features/inventory/InventoryScreen.tsx
src/features/inventory/StockAdjustmentScreen.tsx
src/features/inventory/*
src/shared/ipc/inventoryCorrectionsGateway.ts
src/shared/ipc/*
tests/stock-adjustment.workflow.test.tsx
tests/*
```

Possible additional files:

``` text
catalog search/data-access files
shared dialog/modal components
shared input components
shared error translation helpers
backend catalog/inventory query files
```

Only modify files actually required by the implementation.

------------------------------------------------------------------------

# 19. Acceptance Criteria

The task is complete only when all of the following are true.

### Quantity

-   [ ] Quantity accepts valid decimals.
-   [ ] Quantity rejects invalid characters/values.
-   [ ] Existing exact decimal business behavior remains unchanged.

### Search

-   [ ] Barcode search works.
-   [ ] SKU search works.
-   [ ] Product-name search works.
-   [ ] Variant-name search works.
-   [ ] Attribute-value search works.
-   [ ] Search is presented through a dedicated modal.
-   [ ] Item selection is clear and fast.

### Inventory display

-   [ ] Variant name is the primary identifier.
-   [ ] Product name is secondary context.
-   [ ] Barcode has priority over SKU.
-   [ ] SKU remains available when appropriate.

### UX

-   [ ] Spacing and margins are improved.
-   [ ] Modal is clean and usable.
-   [ ] Errors clearly explain expected business-rule failures.
-   [ ] Arabic RTL remains correct.
-   [ ] Keyboard interaction works.

### Regression

-   [ ] Existing stock-adjustment workflow tests pass.
-   [ ] New focused tests pass.
-   [ ] Typecheck passes.
-   [ ] Build passes.
-   [ ] Lint passes if configured.
-   [ ] No unrelated Part 02 behavior regresses.

------------------------------------------------------------------------

# 20. Recommended Implementation Order

Implement in this order to minimize risk:

``` text
1. Inspect existing catalog/inventory/search architecture
        ↓
2. Fix quantity input validation
        ↓
3. Reuse/extend canonical item search
        ↓
4. Build dedicated item-search modal
        ↓
5. Connect modal selection to correction form
        ↓
6. Improve user-facing error messages
        ↓
7. Change Inventory page to variant-first display
        ↓
8. Apply barcode > SKU display priority
        ↓
9. Improve spacing/margins
        ↓
10. Add/update focused tests
        ↓
11. Run existing Part 02 regression tests
        ↓
12. Run typecheck/lint/build
        ↓
13. Perform manual verification
```

------------------------------------------------------------------------

# 21. Final Agent Instruction

**Do not redesign Stockiha from scratch.**

Make a focused UX improvement on top of the already-working Part 02
implementation.

The primary goals are:

> **Variant name first. Barcode first. Global item search. Dedicated
> search modal. Clean quantity input. Clear errors. Better spacing.**

Keep the backend inventory/accounting behavior unchanged unless a
minimal search-data change is genuinely required.

When finished, report:

``` text
FILES CHANGED
WHAT CHANGED
TESTS RUN
TEST RESULTS
BUILD RESULT
MANUAL CHECKS REQUIRED
KNOWN LIMITATIONS
```

Do not claim completion unless the implementation and verification
actually pass.
