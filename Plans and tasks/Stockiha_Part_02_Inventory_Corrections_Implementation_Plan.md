# Stockiha Part 02 — Inventory Corrections Implementation Plan

## Purpose

This is a controlled implementation plan for a low-cost / low-reasoning AI coding agent.

It covers **Part 02 only: Inventory Corrections**.

It does not authorize the agent to redesign procurement, redo Direct Purchase, implement Administrative Emergency Receipt, or modify unrelated Stockiha features.

Repository:

```text
NabilBNK/Stockiha
```

Expected Windows checkout:

```text
C:\Users\Perfetto\Desktop\Stock-managements
```

Prepared against the GitHub repository state inspected on 2026-08-17.

---

# Reframed Problem:

The task is **not to build a second inventory engine**.

Stockiha already has a serious backend Stock Adjustment engine that provides:

- exact quantities and monetary valuation,
- positive and negative corrections,
- weighted-average-cost valuation,
- inventory movements,
- balanced accounting journals,
- permissions,
- immutable posted records,
- idempotent retry protection,
- rollback on failure,
- zero-stock valuation safeguards.

The real Part 02 problem is that the operator-facing workflow is still presented as a technical **Stock adjustment** form. It does not clearly explain when it should be used, it silently uses the fiscal period start as the posting date, it hides product-loading errors, it uses a long product dropdown, and it performs some stock/WAC checks through JavaScript `Number` even though Stockiha's accounting rules require exact decimal handling.

Part 02 must turn that existing engine into a safe, clear **Inventory Corrections** workflow without changing its accounting meaning.

The operator mental model must become:

```text
Physical quantity differs from Stockiha?
    -> Inventory Corrections

Goods purchased from a supplier and received?
    -> Purchases

Exceptional valued stock introduction outside purchasing?
    -> Administrative Emergency Receipt
       Part 03 — not this task
```

An Inventory Correction is not a purchase. It must never ask for a supplier or a new purchase cost.

---

# 1. Repository Ground Truth and Base-Branch Gate

## 1.1 GitHub state observed before this plan

The GitHub default branch is:

```text
main
```

The latest default-branch commit observed was:

```text
7c59c1653a5c361705ede980b8215d05d4038343
feat(documents): implement business document detail inspection and reports repair
```

That default branch does not contain all later Direct Purchase work.

The newest inspected Part 01-related branch was:

```text
fix/direct-purchase-page-repair
```

with inspected head:

```text
317527c14d513773eeb329fe77977bc02202b885
fix: repair direct purchase page IPC and validation
```

This branch is ahead of `main` and contains the Direct Purchase foundation and repair migrations.

The Part 02 agent must not start from old `main` merely because it is the default branch.

## 1.2 Mandatory preflight

Run from PowerShell:

```powershell
Set-Location 'C:\Users\Perfetto\Desktop\Stock-managements'

git branch --show-current
git rev-parse HEAD
git status --short
git remote -v
git fetch origin --prune
```

Then verify:

```powershell
git merge-base --is-ancestor 317527c14d513773eeb329fe77977bc02202b885 HEAD
```

Acceptable starting point:

- `fix/direct-purchase-page-repair` at `317527c...`, or
- a later accepted branch/commit that contains `317527c...` as an ancestor.

If the command returns non-zero, stop and report the exact branch and SHA. Do not guess which purchase branch should be used. Do not restart Part 01 from `main`.

If `git status --short` shows unrelated changes, stop and report them. Do not reset, clean, discard, overwrite, or automatically stash user work.

## 1.3 Create the Part 02 work branch

Only after the base gate passes:

```powershell
git switch -c task/part-02-inventory-corrections
```

If the branch already exists, inspect it before switching. Do not force-create or overwrite it.

## 1.4 Record the baseline

Before editing, save in the final report:

```text
Starting branch
Starting SHA
Working tree status
Node version
npm version
Rust version
PostgreSQL version used for tests
```

---

# 2. Existing Part 02 Ground Truth

The cheap agent must inspect the current versions of all files listed here before modifying them.

## 2.1 Current navigation and route

Current files:

```text
src/app/AppShell.tsx
src/app/AppRouter.tsx
```

Current route identity:

```text
AppView = 'adjustment'
```

Current user-facing navigation key:

```text
nav.stockAdjustment
```

Current capability gate:

```text
inventoryCapabilities.can_manage_inventory
```

The internal route name may remain `adjustment` during Part 02. Renaming the internal route is not required merely to improve user-facing wording. Avoid broad routing churn.

## 2.2 Current frontend workflow

Primary file:

```text
src/features/inventory/StockAdjustmentScreen.tsx
```

Supporting files:

```text
src/features/inventory/ZeroQuantityWarning.tsx
src/features/inventory/exactDecimal.ts
src/shared/i18n/locales.ts
src/shared/ipc/dto.ts
src/shared/ipc/gateway.ts
src/shared/ipc/commands.ts
```

Existing valid behavior that must be preserved:

- warehouse selection,
- active variant selection,
- base/alternate unit selection where the current model still exposes it,
- explicit increase or decrease direction,
- positive quantity input converted into a signed exact decimal string,
- controlled reason codes,
- `OTHER` requiring a note,
- stable request ID for retries,
- duplicate-submit suppression,
- official `SA-...` result number,
- linked `JE-...` journal number,
- quantity/value result display,
- refresh after confirmed posting without losing the confirmed result if refresh fails.

## 2.3 Current backend authority

Relevant Rust files:

```text
src-tauri/src/commands/stock_adjustment.rs
src-tauri/src/application/stock_adjustment.rs
src-tauri/src/domain/stock.rs
src-tauri/src/error.rs
src-tauri/src/lib.rs
```

Relevant effective migrations:

```text
src-tauri/migrations/20260724130000_inventory_confirm_stock_adjustment.sql
src-tauri/migrations/20260724140100_update_stock_adjustment_residual_handling.sql
```

Relevant database tests:

```text
src-tauri/tests/inventory/s2_002_stock_adjustment_integration.sql
src-tauri/tests/inventory/s2_002_stock_adjustment_concurrency.sh
src-tauri/tests/inventory/s2_003_zero_quantity_safeguards_concurrency.sh
src-tauri/tests/run_current_sql_suites.sh
```

The existing database operation key is:

```text
inventory.confirm_stock_adjustment
```

The existing business document type is:

```text
STOCK_ADJUSTMENT
```

The existing official number prefix is:

```text
SA-YYYY-NNNNNN
```

Do not rename these database identities just because the interface becomes **Inventory Corrections**.

## 2.4 Existing accounting behavior

Positive correction:

```text
Dr Inventory Merchandise
    Cr Inventory Adjustment Gain
```

Negative correction:

```text
Dr Inventory Adjustment Loss
    Cr Inventory Merchandise
```

Valuation uses authoritative existing weighted-average cost.

The operator does not enter a new acquisition cost.

## 2.5 Existing reason codes

Preserve these stable backend codes:

```text
DAMAGE
SHRINKAGE
EXPIRED
FOUND_STOCK
RECORDING_ERROR
OTHER
```

Only user-facing translations may change.

Do not rename persisted reason codes.

Do not add `PURCHASE`, `DELIVERY`, or `SUPPLIER_RECEIPT` as correction reasons.

## 2.6 Existing error contract

The backend maps database failures to public error codes, including:

```text
SESSION_INVALID
PERMISSION_DENIED
VALIDATION_ERROR
PRECONDITION_FAILED
IDEMPOTENCY_CONFLICT
IMMUTABLE_RECORD
UNSAFE_ZERO_STOCK_VALUATION
```

Raw SQL text and private diagnostics must remain redacted.

---

# 3. Fixed Product Decisions

The implementing agent must treat these as decisions, not suggestions.

## 3.1 Final user-facing name

Use:

```text
Inventory Corrections
```

Do not use as the main page title or normal sidebar label:

```text
Stock adjustment
Stock correction engine
Inventory mutation
Manual inventory movement
```

French user-facing concept:

```text
Corrections d’inventaire
```

Arabic user-facing concept:

```text
تصحيحات المخزون
```

Use natural translations consistently. Do not mix old and new wording on the same page.

## 3.2 Business purpose

The page is only for correcting Stockiha so it matches physical reality.

Examples:

- damaged stock,
- shrinkage or missing stock,
- expired stock,
- found stock,
- recording error,
- another controlled correction with an explanation.

## 3.3 Forbidden fields

The Inventory Corrections form must not contain:

- supplier,
- supplier invoice,
- purchase receipt,
- purchase order,
- delivery cost,
- landed cost,
- unit purchase cost,
- selling price override,
- cash/payment method,
- Accounts Payable fields.

## 3.4 Costing policy

Do not allow the user to enter a new WAC or arbitrary correction cost.

Do not calculate authoritative inventory value in React.

The database remains authoritative.

## 3.5 Reason and direction

Keep direction and reason as separate explicit inputs.

Do not invent a new hard rule that automatically blocks a reason/direction combination unless the existing backend already blocks it.

The UI may provide helpful wording such as:

```text
Damage normally decreases stock.
Found stock normally increases stock.
```

But Part 02 must not silently change accounting or historical reason semantics.

## 3.6 Feature toggle policy

Inventory Corrections must be controllable by a persisted administrative feature setting and default to **ON**.

Required behavior:

```text
inventory_corrections_enabled = true by default
```

When ON:

- authorized users see the route,
- authorized users can post corrections.

When OFF:

- the normal creation route is hidden,
- direct navigation is redirected safely,
- the backend posting operation rejects new corrections,
- historical `STOCK_ADJUSTMENT` records remain readable,
- existing journals and reports remain unchanged.

The feature setting does not replace role permissions. Effective permission is:

```text
feature enabled
AND
user has inventory-management permission
```

Use the repository's existing settings/policy architecture. Do not invent a parallel localStorage-only toggle.

The setting must be editable only by the existing highest administrative settings authority. Do not create a new `CEO` database role merely for the label if the repository has no such role; use the existing authoritative Admin/Manager policy and preserve the user's requirement that executive configuration controls the feature.

## 3.7 Part 03 boundary

Do not implement, move, rename, harden, or remove Stock Receipt in this task.

Part 03 will handle:

```text
Administrative Emergency Receipt
```

During Part 02, the existing `Stock receipt` route must remain behaviorally unchanged.

Do not direct users to a newly invented Emergency Receipt page. For a zero-stock/no-WAC failure, explain that an authorized administrative stock-establishment process is required, without implementing that process in Part 02.

---

# 4. In Scope

Part 02 includes all items in this section.

## 4.1 Navigation and naming

- Rename the normal sidebar label from `Stock adjustment` to `Inventory Corrections`.
- Rename the page title, form label, submit label, success copy, validation copy, warnings, and tests.
- Update English, French, and Arabic translations.
- Preserve Arabic right-to-left behavior.
- Preserve the internal `adjustment` route unless there is proven value in renaming it.
- Combine the administrative feature setting with the existing capability check.

## 4.2 Purpose and safety copy

Add a visible, non-dismissible informational block near the page header:

```text
Use Inventory Corrections when physical stock differs from Stockiha.
Do not use this page for supplier purchases or to enter a new purchase cost.
```

The message must be translated and must not rely on color alone.

## 4.3 Form organization

Reorganize the current form into clear sections:

1. **Correction context**
   - Warehouse.
   - Correction date.
2. **Item**
   - Search/select variant.
   - Selected variant context.
   - Unit.
3. **Correction**
   - Increase/decrease direction.
   - Positive quantity.
   - Reason.
   - Note.
4. **Review and confirm**
   - Signed direction summary.
   - Selected item and warehouse.
   - Correction date.
   - Reason.
   - One final `Confirm inventory correction` action.

Do not create a second confirmation page.

Do not create a draft workflow.

## 4.4 Correct document date

The current form sends:

```ts
documentDate: openFiscalPeriod.starts_on
```

That is wrong for normal daily operations because every correction can be posted with the first day of the period.

Required fix:

- Add an editable correction-date field.
- Use local calendar date semantics, not UTC conversion that may shift a day.
- Default to today's local date only when it falls inside the open fiscal period.
- If today is outside the open period, leave the field invalid/empty and show a clear message requiring a date within the open period.
- Set HTML/input minimum to `openFiscalPeriod.starts_on`.
- Set maximum to `openFiscalPeriod.ends_on`.
- Validate the `YYYY-MM-DD` string before enabling submit.
- Send the selected date to `confirmStockAdjustment`.
- Invalidate the current request ID when the date changes.
- Keep backend fiscal-period/date validation authoritative.

Forbidden shortcut:

```text
Always use starts_on
Always use ends_on
Use toISOString().slice(0,10) without local-date review
Remove the date from the request
```

## 4.5 Safe variant selection

The current screen renders every active variant in one native select and auto-selects the first result.

This is unsafe when the catalog is large because the user can accidentally correct the wrong item.

Required behavior:

- Do not auto-select the first variant on initial load.
- Require explicit user selection.
- Add a search/filter input before the variant selector.
- Search at least variant name and SKU using case-insensitive normalized matching.
- If a shared, accepted variant picker already exists on the target branch, reuse it.
- Do not create a second incompatible permanent variant picker.
- If no shared picker exists, keep Part 02 bounded: filter the already-loaded `listProducts` result and render at most the matching subset. Do not add a new database search API solely for this task.
- Show a clear no-results state.
- Preserve selection while editing quantity/reason.
- When warehouse changes, clear the variant selection and related unit state.
- Do not lose the rest of the form because a search query changes.

The selected item context must show:

- variant name,
- SKU as secondary technical context,
- current quantity on hand,
- current WAC when available.

Do not show sale price as correction value.

## 4.6 Exact-decimal frontend handling

The current screen uses:

```ts
Number(selectedVariant.quantity_on_hand)
Number(selectedVariant.last_known_wac)
```

Remove these checks.

Add exact string helpers in the existing inventory decimal utility, for example:

```text
isExactZeroDecimal(value)
isExactPositiveDecimal(value)
```

Requirements:

- operate on validated decimal strings,
- do not use `Number`, `parseFloat`, or floating-point arithmetic,
- handle values such as `0`, `0.000`, `000.000`, `10.000000`,
- reject malformed values safely,
- have focused unit tests.

Frontend preview is informational only.

Do not implement authoritative new quantity, new value, or journal calculations in React.

## 4.7 Loading, empty, and error states

The current product load failure silently becomes an empty list.

Required states:

- loading warehouses/app data,
- loading variants,
- variant load failed with Retry,
- no active variants,
- no variant matches the search,
- loading units,
- unit load failed with Retry,
- no usable unit,
- no open fiscal period,
- feature disabled,
- permission denied/direct-route rejection,
- posting in progress,
- posting succeeded,
- known posting failure,
- unknown outcome requiring same-request retry.

Do not show `No variants` when the real condition is a backend failure.

## 4.8 Stable request and retry behavior

Preserve this contract:

- Create one request ID for one intended correction.
- Any payload edit before submission invalidates the old request ID.
- During an unknown posting outcome, retain the same request ID and all form data.
- A Retry action must send exactly the same payload and request ID.
- Do not automatically generate a new request ID after an unknown result.
- After confirmed success, clear the request ID.
- Disable duplicate submissions while posting.
- A refresh failure after confirmed posting must not tell the user to post again.

Add a test that captures request IDs across an unknown outcome and retry.

## 4.9 Zero-stock/no-WAC safeguard

Preserve backend error:

```text
UNSAFE_ZERO_STOCK_VALUATION
```

Required UI behavior:

- Show a warning before submission when an increase is selected for zero quantity with no usable WAC.
- Do not treat the warning as authorization to invent zero cost.
- Keep backend rejection authoritative.
- Explain that a controlled administrative stock-establishment process is required.
- Do not add a purchase-cost input.
- Do not link to or implement Part 03 in this task.

## 4.10 Success result

After a confirmed correction, display:

- correction document number,
- journal document number,
- selected variant,
- warehouse,
- correction date,
- reason,
- signed base-unit quantity delta returned by backend,
- inventory value delta returned by backend,
- resulting quantity returned by backend,
- resulting total value returned by backend.

Use the backend response as authority.

Do not claim a resulting WAC unless the current response contract is deliberately extended and tested. Part 02 does not require a new response field merely for decoration.

## 4.11 Business Documents terminology

Historical and new records keep database type:

```text
STOCK_ADJUSTMENT
```

Where the Business Documents UI maps document types to human labels, display:

```text
Inventory Correction
```

Do not rewrite stored document types, document numbers, journal links, or history.

If this label mapping is not currently centralized or safely changeable, leave the raw stored identity intact and document the limitation. Do not create a duplicate document record.

## 4.12 Administrative feature setting

Inspect existing setting patterns before implementing:

```text
src/features/settings/
src/shared/ipc/*Settings* or policy gateways
src-tauri/src/commands/
src-tauri/src/application/
existing settings/policy migrations
```

Implement one persisted setting using repository conventions.

Minimum contract:

```text
get inventory correction policy
update inventory correction policy
```

The database posting function must enforce the setting. Hiding the sidebar alone is insufficient.

The update operation must require the established administrative permission.

The migration must:

- be forward-only,
- default existing installations to ON,
- default fresh installations to ON,
- preserve existing posted corrections,
- use existing ownership, `SECURITY DEFINER`, safe `search_path`, revoke/grant conventions,
- not grant broad rights to `PUBLIC`.

If the repository already has a generic feature-settings table and command, extend it rather than creating a new table.

---

# 5. Out of Scope

The agent must not implement or modify these items during Part 02:

## 5.1 Part 01 procurement

- Direct Purchase architecture.
- Purchase receipt posting.
- Purchase dashboard redesign.
- New purchase redesign.
- Additional/custom purchase costs.
- Purchase variant search.
- Purchase Receipt PDF export.
- Supplier Invoices.
- Supplier Payables.
- Supplier Returns.
- Landed cost.
- Purchase Orders.

Part 01 is a regression surface only.

## 5.2 Part 03

- Administrative Emergency Receipt.
- Moving Stock Receipt to Settings.
- Renaming Stock Receipt.
- Emergency Receipt permissions.
- Emergency reason/note schema.
- Emergency Receipt accounting policy.

## 5.3 Other inventory breadth

- warehouse transfers,
- cycle-count sessions,
- batch/lot/serial tracking,
- expiry tracking,
- barcode scanner redesign,
- mass/bulk corrections,
- CSV/Excel corrections import,
- approval workflow for large corrections,
- negative-stock policy redesign,
- costing-policy selection,
- FIFO/LIFO implementation,
- warehouse creation/editing,
- product/variant data-model redesign.

## 5.4 Unrelated application areas

- POS,
- customer refunds,
- cash sessions,
- historical finance,
- opening state,
- authentication,
- backup/restore,
- global dashboard,
- unrelated Documents reports,
- general design-system rewrite.

---

# 6. Backend and Database Preservation Rules

## 6.1 Do not rewrite the proven posting engine

The current stock-adjustment database operation already has the required business semantics.

Do not replace it with:

- multiple frontend calls,
- direct table inserts,
- a new parallel correction table,
- a JavaScript-only calculation,
- a generic inventory-update command,
- a stock receipt call.

## 6.2 Preserve atomicity

One correction must continue to atomically produce:

```text
one STOCK_ADJUSTMENT business document
one stock_adjustment detail row
one inventory movement
one balanced journal when value is non-zero
one idempotent result
one official document number
```

Failure must leave no partial writes.

## 6.3 Preserve valuation

For a correction base quantity delta `q` and current authoritative WAC `w`:

```text
inventory value delta = q × w
```

The database performs this calculation using exact numeric types.

Do not accept an arbitrary cost from the user.

## 6.4 Preserve zero-quantity residual handling

When a negative correction reduces quantity to zero, preserve the existing residual-value handling implemented by the effective migration.

Do not reopen the WAC/residual design in Part 02.

## 6.5 Preserve locks and concurrency

Do not remove position locks, deterministic update order, or concurrency tests.

Do not weaken behavior to make UI tests pass.

## 6.6 Preserve idempotency identity

Keep:

```text
operation_key = inventory.confirm_stock_adjustment
```

Do not rename it to a new operation key because the page label changed.

## 6.7 Preserve immutable history

Do not allow updates or deletes to posted correction rows.

Do not modify historical journal entries.

Do not renumber `SA-...` documents.

## 6.8 Migration rule

Do not edit these applied migrations:

```text
20260724130000_inventory_confirm_stock_adjustment.sql
20260724140100_update_stock_adjustment_residual_handling.sql
```

The only expected Part 02 migration is a new forward-only migration for the default-ON administrative feature setting and backend enforcement, if the existing settings architecture cannot express it without a migration.

No migration is authorized merely to rename UI text.

---

# 7. Detailed UI Contract

## 7.1 Target page structure

```text
Inventory Corrections

[Information]
Use this page when physical stock differs from Stockiha.
Do not use it for supplier purchases or to enter purchase cost.

[Correction context]
Warehouse
Correction date

[Item]
Search variant
Selected variant
Current quantity
Current WAC
Unit

[Correction]
Increase stock / Decrease stock
Positive quantity
Reason
Note

[Review]
Warehouse
Variant
Direction and quantity
Reason
Date

Confirm inventory correction

[Confirmed result]
SA-...
JE-...
Quantity delta
Value delta
Resulting quantity
Resulting value
```

## 7.2 Direction input

Keep explicit radio controls or an accessible segmented control.

Requirements:

- keyboard accessible,
- visible focus,
- not color-only,
- clear selected state,
- translated,
- request ID invalidated on change.

## 7.3 Quantity input

The user enters a positive magnitude only.

Frontend signs it based on direction.

Keep maximum three decimal places unless the existing backend/domain contract changes elsewhere.

Valid examples:

```text
1
2.5
2.500
```

Invalid examples:

```text
0
-2
1.0000
abc
```

Do not use HTML `number` as the only validator because locale/browser behavior can produce inconsistent decimal values.

## 7.4 Notes

`OTHER` requires a non-blank note.

Other reasons keep note optional.

Trim the note at the gateway boundary as today.

Do not erase the note after a failed submission.

## 7.5 Styling

Use existing Stockiha classes/tokens where possible.

Do not add a parallel CSS framework.

Requirements:

- professional compact desktop layout,
- common laptop resolution support,
- no large unused empty area,
- light and dark themes,
- English/French/Arabic,
- Arabic RTL,
- touch-friendly controls,
- no clipped actions,
- no horizontal page scroll at normal laptop width,
- reduced-motion safe.

Do not redesign the whole application shell.

---

# 8. Permission and Feature-Control Contract

## 8.1 Existing role capability

Keep using the authoritative inventory permission represented in the frontend as:

```text
can_manage_inventory
```

Do not grant it to Cashier or unrelated roles.

## 8.2 Effective access

The route is visible only when:

```text
inventory_corrections_enabled
AND
can_manage_inventory
```

The backend must repeat the same policy authoritatively.

## 8.3 Safe denial

If capability or setting retrieval fails:

- deny creation access,
- do not assume ON,
- do not expose restricted controls,
- do not leak private diagnostics.

Default ON applies to persisted configuration, not to a failed permission query.

## 8.4 Historical visibility

Turning the feature OFF must not hide or delete historical accounting evidence in Business Documents or Journals from users who otherwise have read permission.

---

# 9. Expected File-Touch Map

This is a controlled map. Inspect before editing. Do not modify every file blindly.

## 9.1 Expected frontend modifications

```text
src/app/AppShell.tsx
src/app/AppRouter.tsx
src/features/inventory/StockAdjustmentScreen.tsx
src/features/inventory/ZeroQuantityWarning.tsx
src/features/inventory/exactDecimal.ts
src/shared/i18n/locales.ts
src/shared/ipc/dto.ts
src/shared/ipc/gateway.ts
src/shared/ipc/commands.ts
src/styles/global.css
tests/stock-adjustment.workflow.test.tsx
tests/inventory.workflow.test.tsx
```

## 9.2 Conditional settings files

Depending on existing architecture:

```text
src/features/settings/InventoryCorrectionPolicySettingsScreen.tsx
src/shared/ipc/inventoryCorrectionPolicyDto.ts
src/shared/ipc/inventoryCorrectionPolicyGateway.ts
```

Prefer existing naming patterns. Do not create separate files if the repository uses a centralized settings gateway.

## 9.3 Conditional backend modifications for the toggle

```text
src-tauri/src/commands/inventory_correction_policy.rs
src-tauri/src/application/inventory_correction_policy.rs
src-tauri/src/commands/mod.rs
src-tauri/src/application/mod.rs
src-tauri/src/lib.rs
```

The exact file names must follow current repository patterns.

## 9.4 Expected new migration

Use the next valid timestamped filename, for example:

```text
src-tauri/migrations/<next_timestamp>_inventory_corrections_policy.sql
```

Do not reuse this placeholder literally without checking the migration sequence.

## 9.5 Expected database test modifications

```text
src-tauri/tests/inventory/s2_002_stock_adjustment_integration.sql
src-tauri/tests/run_current_sql_suites.sh
```

Prefer adding focused assertions to the existing suite. Add a new test file only if repository test organization clearly requires it.

## 9.6 Files that normally should not change

```text
src-tauri/migrations/20260724130000_inventory_confirm_stock_adjustment.sql
src-tauri/migrations/20260724140100_update_stock_adjustment_residual_handling.sql
src/features/inventory/StockReceiptScreen.tsx
src/features/procurement/**
src-tauri/src/application/procurement_service.rs
src-tauri/src/commands/procurement.rs
```

Any change to these must be justified in the final report. A cosmetic dependency is not sufficient justification.

---

# 10. Implementation Phases and Exit Gates

The agent must work in this order.

## Phase 0 — Ground-truth audit

Tasks:

1. Pass branch/SHA/clean-tree gate.
2. Inspect every current file in Sections 2 and 9.
3. Trace:

```text
sidebar
-> route
-> StockAdjustmentScreen
-> gateway
-> Tauri command
-> application service
-> database function
-> movement
-> journal
-> document registry
```

4. Identify the repository's existing settings/policy pattern.
5. Run baseline focused tests before editing.

Baseline commands:

```powershell
npm ci
npm test -- tests/stock-adjustment.workflow.test.tsx tests/inventory.workflow.test.tsx
npm run typecheck
```

Exit gate:

The agent can state:

- exact current branch and SHA,
- current posting operation and document types,
- where WAC is sourced,
- where journal lines are created,
- how idempotency works,
- how permissions work,
- how an existing administrative setting is stored and enforced.

If it cannot state these, it must not continue.

## Phase 1 — Persisted default-ON feature policy

Tasks:

1. Reuse existing settings architecture.
2. Add default-ON Inventory Corrections setting.
3. Add authorized read/update functions/commands.
4. Enforce the setting inside backend posting authority.
5. Preserve role permission enforcement.
6. Add migration tests for default ON, update authorization, OFF rejection, and historical visibility.

Exit gate:

- existing installs are ON,
- fresh installs are ON,
- unauthorized users cannot change it,
- OFF prevents new posting at the backend,
- existing rows/journals remain readable,
- no old migration was edited.

## Phase 2 — Exact helpers and date contract

Tasks:

1. Add exact decimal predicate helpers.
2. Remove `Number`/`parseFloat` stock/WAC checks from the page.
3. Add local correction-date helper/validation.
4. Add date field and fiscal period bounds.
5. Pass selected date through the existing gateway.
6. Add focused tests.

Exit gate:

- exact helper tests pass,
- current date is used when valid,
- period start is no longer silently posted,
- out-of-period date blocks submit,
- changing date invalidates the request ID.

## Phase 3 — Navigation, copy, and route policy

Tasks:

1. Rename user-facing navigation/page copy in all languages.
2. Add purpose/safety explanation.
3. Combine feature setting and capability for route visibility.
4. Add safe redirect if disabled or unauthorized.
5. Preserve internal route compatibility.

Exit gate:

- normal UI consistently says Inventory Corrections,
- Cashier/unauthorized roles do not see or open it,
- feature OFF hides creation route,
- historical records remain intact.

## Phase 4 — Form safety and UX

Tasks:

1. Add explicit variant selection/search.
2. Do not auto-select the first variant.
3. Add current stock/WAC context.
4. Add explicit loading/error/retry states.
5. Reorganize form sections.
6. Improve zero-WAC warning.
7. Preserve stable request behavior.
8. Improve confirmed-result presentation.
9. Update styles using existing design tokens.

Exit gate:

- worker must deliberately select the item,
- backend failures are not shown as empty data,
- no new purchase-cost input exists,
- one Confirm action posts one correction,
- recoverable failures preserve entered data.

## Phase 5 — Documents terminology

Tasks:

1. Inspect current Business Documents type-label mapping.
2. Map `STOCK_ADJUSTMENT` to user-facing `Inventory Correction` where safe.
3. Preserve stored identity, details, and journal links.
4. Add/update focused Documents tests only if touched.

Exit gate:

- no duplicate business document,
- `SA-...` and `JE-...` links remain correct,
- historical correction evidence remains visible.

## Phase 6 — Full verification

Run all required automated and manual gates in Sections 12 and 13.

Do not claim completion before Phase 6.

---

# 11. Mandatory Automated Tests

## 11.1 Frontend naming and navigation

Test:

1. English sidebar shows `Inventory Corrections`.
2. French sidebar shows `Corrections d’inventaire`.
3. Arabic sidebar shows `تصحيحات المخزون` in RTL.
4. Old `Stock adjustment` wording is absent from normal user-facing English UI.
5. Internal database codes are not translated in payloads.
6. Feature OFF hides the route.
7. Permission false hides the route.
8. Direct route is safely rejected when unavailable.

## 11.2 Form semantics

Test:

1. Purpose warning says not to use the page for supplier purchases.
2. No supplier field exists.
3. No unit-cost/purchase-cost field exists.
4. First variant is not auto-selected.
5. Search finds variant by name.
6. Search finds variant by SKU.
7. No-match state is clear.
8. Warehouse change clears selected variant/unit.
9. Variant load error shows Retry rather than fake empty state.
10. Unit load error shows Retry.

## 11.3 Exact quantity helpers

Test:

```text
0                -> zero
0.000            -> zero
000.000          -> zero
10               -> positive
10.000000        -> positive
malformed value  -> safely invalid
```

Search modified inventory UI code and ensure no `Number(` or `parseFloat(` is used for stock/WAC policy checks.

## 11.4 Date behavior

Test:

1. Today inside period becomes default.
2. Today outside period does not silently use period start.
3. Date before period start is invalid.
4. Date after period end is invalid.
5. Selected valid date is sent to `confirm_stock_adjustment`.
6. Date change invalidates the pending request ID.
7. Local-date helper does not shift the day because of UTC conversion.

## 11.5 Direction, quantity, reason, and note

Preserve/add tests for:

- increase creates positive decimal string,
- decrease creates negative decimal string,
- zero invalid,
- negative typed magnitude invalid,
- more than three decimals invalid,
- every stable reason code is sent unchanged,
- `OTHER` without note disabled/rejected,
- `OTHER` with note posts,
- other reasons allow optional note.

## 11.6 Idempotency and unknown outcomes

Test:

1. Double-click sends one request.
2. Unknown outcome retains form.
3. Retry uses same request ID.
4. Payload edit after failure creates a new request ID for a new intent.
5. Confirmed result clears request ID.
6. Refresh failure after success does not remove official result or prompt repost.

## 11.7 Zero-stock safeguard

Test:

- zero stock + no WAC + increase shows warning,
- usable historical WAC does not show the no-WAC warning,
- public error message is specific,
- private diagnostics never render,
- form never offers arbitrary cost as a workaround.

## 11.8 Success result

Test that the result shows:

- `SA-...`,
- `JE-...`,
- signed quantity delta,
- value delta,
- resulting quantity,
- resulting value,
- selected variant and context.

## 11.9 Database integration tests

Preserve and pass current assertions for:

- positive correction,
- negative correction,
- exact alternate-unit conversion where still supported,
- gain journal direction,
- loss journal direction,
- journal balance,
- immutable posted row,
- actor/workstation snapshot,
- zero quantity rejection,
- missing warehouse rejection,
- inactive warehouse rejection,
- inactive variant rejection,
- negative correction beyond stock rejection,
- positive correction at zero stock without WAC rejection,
- Cashier permission rejection,
- invalid session rejection,
- `OTHER` note requirement,
- rollback/no idempotency record on failure,
- same-request idempotent response,
- changed-payload idempotency conflict,
- stock receipt regression,
- POS regression.

Add policy assertions:

- default ON permits authorized correction,
- OFF rejects before protected writes,
- unauthorized policy update rejected,
- OFF does not delete historical corrections,
- re-enable restores posting for authorized users.

## 11.10 Concurrency tests

Run existing:

```text
s2_002_stock_adjustment_concurrency.sh
s2_003_zero_quantity_safeguards_concurrency.sh
```

Do not disable or skip them.

---

# 12. Engineering Verification Gates

Run from repository root:

```powershell
npm ci
npm run typecheck
npm run lint
npm test
npm run build
```

Run Rust gates:

```powershell
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo check --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

Run the repository's PostgreSQL test/provisioning workflow using the existing dedicated test database and scripts. Do not point tests at the user's live data.

At minimum, prove:

```text
all migrations apply in order
current SQL suites pass
stock-adjustment integration passes
stock-adjustment concurrency passes
zero-quantity concurrency passes
```

Do not use:

```text
--force
--ignore
test.skip
describe.skip
#[allow(...)] to hide new warnings broadly
SQL exception swallowing
weakened permissions
```

Run:

```powershell
git diff --check
git status --short
```

Inspect the final diff and confirm every changed file belongs to Part 02.

---

# 13. Manual Windows Acceptance

Use the normal project launcher because it applies migrations and uses the accepted runtime configuration:

```powershell
Set-Location 'C:\Users\Perfetto\Desktop\Stock-managements'
Remove-Item Env:STOCKIHA_DEV_DATABASE_URL -ErrorAction SilentlyContinue
.\run.bat
```

Do not bypass launcher/migration failures by switching to a different database or deleting data.

## Scenario A — Navigation and meaning

1. Sign in as Admin/authorized inventory user.
2. Confirm sidebar shows `Inventory Corrections`.
3. Open it.
4. Confirm helper text says it is for physical-vs-system discrepancies.
5. Confirm helper text says not to use it for purchases.
6. Confirm there is no supplier field.
7. Confirm there is no purchase-cost field.

## Scenario B — Damaged stock decrease

Starting state:

```text
Quantity: 20
WAC: 100 DZD
Total value: 2,000 DZD
```

Correction:

```text
Direction: Decrease
Quantity: 2
Reason: Damage
```

Expected:

```text
Quantity: 18
Total value: 1,800 DZD
Inventory value delta: -200 DZD

Dr Inventory Adjustment Loss  200
Cr Inventory Merchandise      200
```

Verify one `SA-...`, one movement, and one balanced `JE-...`.

## Scenario C — Found stock increase

Starting state:

```text
Quantity: 18
WAC: 100 DZD
Total value: 1,800 DZD
```

Correction:

```text
Direction: Increase
Quantity: 3
Reason: Found stock
```

Expected:

```text
Quantity: 21
Total value: 2,100 DZD
Inventory value delta: +300 DZD

Dr Inventory Merchandise       300
Cr Inventory Adjustment Gain   300
```

## Scenario D — Other reason

1. Select `Other`.
2. Leave note empty.
3. Confirm posting is blocked.
4. Enter a meaningful note.
5. Confirm posting is enabled.

## Scenario E — Correct date

1. Choose a correction date inside the open fiscal period that is not the period start date.
2. Post correction.
3. Inspect Business Documents and Journal.
4. Confirm the selected date was stored.
5. Attempt a date outside the period.
6. Confirm the UI blocks it and backend remains authoritative.

## Scenario F — Zero stock without WAC

1. Select an item with zero quantity and no usable WAC.
2. Choose Increase.
3. Confirm a clear warning appears.
4. Attempt posting.
5. Confirm no stock, movement, document, journal, or idempotency result is created.
6. Confirm no cost field appears as a workaround.

## Scenario G — Insufficient stock

1. Select an item with quantity 5.
2. Attempt to decrease 6.
3. Confirm rejection.
4. Confirm quantity/value/history are unchanged.

## Scenario H — Unknown result retry

Use a controlled test or test double; do not damage the live database.

1. Trigger an unknown transport outcome.
2. Confirm form data remains.
3. Retry without changing fields.
4. Confirm same request ID is used.
5. Confirm only one correction exists.

## Scenario I — Feature toggle

1. Confirm setting defaults ON.
2. Turn it OFF as authorized administrator.
3. Confirm route disappears for normal use.
4. Confirm direct navigation is rejected.
5. Confirm historical correction remains visible in Business Documents/Journals.
6. Confirm backend rejects a direct posting attempt.
7. Turn it ON.
8. Confirm authorized workflow becomes available again.

## Scenario J — Permission

1. Sign in as Cashier/unprivileged user.
2. Confirm Inventory Corrections is absent.
3. Confirm direct command invocation is rejected by backend.
4. Confirm no protected write occurred.

## Scenario K — Localization and themes

Verify the full page in:

```text
English light
English dark
French light
French dark
Arabic RTL light
Arabic RTL dark
```

Verify labels, helper text, dates, quantities, DZD values, focus order, and buttons.

## Scenario L — Regression

1. Create one Direct Purchase.
2. Confirm receipt/inventory/WAC/journal still work.
3. Confirm Stock Receipt still behaves exactly as before Part 02.
4. Run one POS sale regression if the test environment permits it.
5. Restart Stockiha.
6. Confirm posted correction and journal persist.

---

# 14. Prohibited Shortcuts

The agent must not:

1. Rename only the heading and call Part 02 complete.
2. Replace the backend posting function with frontend calculations.
3. Use Stock Receipt to implement corrections.
4. Add supplier or purchase-cost fields.
5. Set WAC to zero to bypass valuation safeguards.
6. Use `Number` or `parseFloat` for authoritative stock/WAC decisions.
7. Keep sending `openFiscalPeriod.starts_on` as every correction date.
8. Hide product-load errors by showing an empty select.
9. Auto-select the first variant and allow accidental submission.
10. Generate a new request ID for an unknown-result retry.
11. Clear the form after an unknown result.
12. Hide the route only with CSS.
13. Implement the feature toggle only in localStorage.
14. Remove backend permission checks.
15. Grant correction access to Cashier to make a test pass.
16. Edit applied migrations.
17. Delete historical corrections or journals.
18. Rename persisted `STOCK_ADJUSTMENT`, `SA-...`, or the idempotency operation key.
19. Start Administrative Emergency Receipt.
20. Modify Direct Purchase UI or accounting.
21. Add a new UI framework or rewrite the design system.
22. Delete failing tests instead of updating policy assertions.
23. Skip Arabic, RTL, dark theme, concurrency, migration, or Windows runtime verification.
24. Claim manual verification without opening and using the Tauri application.

---

# 15. Definition of Done

Part 02 is complete only when all statements below are true.

## User experience

- Normal navigation says Inventory Corrections.
- Page purpose is explicit.
- No purchase semantics appear.
- Variant selection is deliberate and searchable.
- Current quantity/WAC context is visible.
- Correction date is explicit and correct.
- Loading, empty, and error states are distinct.
- One final confirmation posts one correction.
- Success result is complete and readable.
- English, French, Arabic RTL, light, and dark are verified.

## Domain correctness

- Existing WAC valuation remains authoritative.
- Positive/negative journal directions remain correct.
- No arbitrary cost is accepted.
- Zero-WAC safeguard remains.
- Negative stock remains blocked.
- Posted records remain immutable.
- Idempotent retries remain safe.
- Failed transactions leave no partial writes.

## Policy and permissions

- Feature setting defaults ON.
- Authorized administration can toggle it.
- Backend enforces OFF state.
- Role permission remains required.
- Historical evidence remains readable when OFF.

## Regression safety

- Direct Purchase still works.
- Stock Receipt remains unchanged for Part 03.
- Business Documents and Journals retain links.
- POS/inventory regression tests pass.
- Fresh and upgrade migration paths pass.

## Engineering quality

- Typecheck passes.
- Lint passes.
- All frontend tests pass.
- Production build passes.
- Rust format/check/clippy/tests pass.
- PostgreSQL suites pass.
- Concurrency tests pass.
- `git diff --check` passes.
- Live Tauri manual acceptance passes.

---

# 16. Required Final Report From the Implementing Agent

The implementing agent must return this exact structure.

## A. Starting state

```text
Starting branch:
Starting SHA:
Working tree before changes:
Part 01 ancestor gate:
```

## B. Ground-truth audit

Explain:

- current posting path,
- current WAC authority,
- current journal behavior,
- current idempotency behavior,
- current permission behavior,
- existing settings architecture used.

## C. Implemented changes

List separately:

- navigation/copy,
- feature policy,
- date correction,
- exact-decimal safety,
- variant selection,
- loading/error states,
- retry behavior,
- Documents label mapping,
- styles/accessibility/localization.

## D. Files

```text
Created:
Modified:
Deleted:
```

Every file needs one sentence explaining why it changed.

## E. Database and migration

State:

- new migration filename,
- default-ON backfill behavior,
- ownership/security/grants,
- fresh database result,
- upgrade database result,
- confirmation that applied migrations were not edited.

## F. Tests added or changed

List every test and the business rule it proves.

## G. Exact command results

Report pass/fail and exit code for:

```text
npm run typecheck
npm run lint
npm test
npm run build
cargo fmt
cargo check
cargo clippy
cargo test
SQL suites
concurrency tests
git diff --check
```

## H. Manual acceptance

Report every scenario A–L as:

```text
PASS
FAIL
NOT RUN — reason
```

Do not mark an unrun scenario as PASS.

## I. Scope proof

Confirm:

```text
Direct Purchase not redesigned
Stock Receipt not changed
Administrative Emergency Receipt not started
No historical document/journal deleted
No applied migration edited
No permission weakened
```

## J. Remaining issues

State every limitation honestly.

## K. Git result

```text
Final branch:
Final SHA:
Commit message:
Push result:
Pull request URL if created:
Final git status:
```

Do not call Part 02 complete if any mandatory gate failed or was not run.

---

# Final Instruction to the Cheap AI Agent

Begin with Phase 0 and work through the phases in order.

Do not ask for approval between phases.

Stop only for a real blocker such as:

- wrong base branch,
- dirty working tree with unrelated changes,
- unavailable required database credentials/configuration,
- destructive migration conflict,
- missing authority to push.

Do not use a shortcut to bypass a blocker.

Part 02 is a controlled correction-workflow repair. Preserve the proven backend, correct the unsafe frontend behavior, implement the default-ON administrative feature setting, verify every accounting and inventory invariant, and do not start Part 03.
