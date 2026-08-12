# Stockiha Procurement Acceptance Defect-Repair — Controlled Implementation Plan

> **Purpose of this document**
>
> This is not a brainstorming document and not a high-level roadmap. It is an execution contract for a weak/cheap coding agent.
>
> The implementing agent is an **executor**, not the product architect. It must follow the decisions, boundaries, sequencing, invariants, and verification gates in this document. It must not invent alternative accounting behavior, simplify away difficult cases, weaken tests, widen permissions, hide failures, or refactor unrelated code merely to make the task easier.

---

## 1. Reframed Problem

The procurement workflow is substantially implemented, but the current acceptance candidate is **not operationally acceptable** because three release-blocking defects break auditability and normal use:

1. **Supplier returns can fail with only `PRECONDITION_FAILED`**, while the real database function contains many materially different failure causes.
2. **Journal entries are created but there is no persistent Journals viewer**, so accounting evidence cannot be inspected from the application.
3. **The Documents screen is actually a printable-document queue**, and its database query intentionally exposes only existing sales/customer document types. Procurement business documents are therefore missing even though they exist in `core.business_documents`.

There are also confirmed cross-cutting defects in the procurement frontend:

- several procurement components derive a business date from UTC using `new Date().toISOString()`;
- some procurement validation still uses JavaScript floating-point parsing/comparison;
- procurement screens do not consistently use the existing safe localized error boundary;
- eligibility/read models can become stale after posting/payment/return activity;
- the current automated acceptance coverage proves clean fixtures better than it proves the exact failing upgraded Windows database state.

This work is a **release-blocker repair and hardening pass**.

It is **not** a procurement rewrite.
It is **not** an accounting-policy redesign.
It is **not** a document/PDF project.
It is **not** a general application refactor.

---

# 2. Immutable Baseline and Branch Discipline

## 2.1 Required source baseline

The accepted source baseline for this repair is:

- Repository: `NabilBNK/Stockiha`
- Source branch: `task/r8-e-procurement`
- Required source commit:

```text
486e07d7c0f21895332d1dcbc5ee6d4dda41e112
```

At the time this plan was written, the remote branch points to that exact commit.

## 2.2 New implementation branch

Create a dedicated branch from the exact SHA above.

Preferred branch:

```text
task/procurement-acceptance-defect-repair
```

The agent must not implement directly on `main` or directly on `task/r8-e-procurement`.

## 2.3 Mandatory preflight commands

Before editing any file, record the output of:

```bash
git status --short
git branch --show-current
git rev-parse HEAD
git fetch origin --prune
git rev-parse origin/task/r8-e-procurement
```

Required source SHA:

```text
486e07d7c0f21895332d1dcbc5ee6d4dda41e112
```

If the source branch no longer points to that SHA:

- do not silently use the new branch head;
- do not rebase the plan onto an unknown state;
- do not cherry-pick unknown commits;
- report the mismatch as a baseline drift;
- continue only from the exact required commit unless repository authority explicitly supersedes this plan.

## 2.4 Dirty working tree rule

The agent must never destroy unrelated work.

Forbidden:

```bash
git reset --hard
git clean -fd
git checkout -- .
```

against a dirty user workspace.

If the working tree contains unrelated changes:

1. preserve them;
2. preferably create/use a clean Git worktree for this task;
3. do not discard, overwrite, or silently stash user work;
4. if a clean isolated worktree cannot be created safely, report the blocker instead of deleting changes.

---

# 3. Authority Hierarchy

When implementation details conflict, use this authority order:

1. Database invariants and immutable posted-ledger rules already enforced by the repository.
2. Existing accepted architecture/ADR documents in the repository.
3. This implementation plan.
4. Existing domain/application/IPC conventions in the exact baseline.
5. Existing tests that represent accepted behavior.
6. Current UI behavior.

Current UI behavior is **not** authoritative when it conflicts with database/accounting invariants.

The agent may not choose a shortcut because it is easier to implement in React.

---

# 4. Agent Operating Contract

## 4.1 The agent must do these things

The implementing agent must:

- inspect relevant existing code before writing replacements;
- identify the exact data path from PostgreSQL → Rust → Tauri command → TypeScript gateway → React UI;
- preserve existing architecture boundaries;
- keep PostgreSQL authoritative for accounting and stock integrity;
- use forward-only migrations;
- use exact decimal representations for business quantities and money;
- keep public IPC errors redacted;
- localize user-facing error reasons;
- preserve posted-record immutability;
- preserve idempotency;
- preserve non-negative-stock behavior;
- preserve balanced-journal enforcement;
- preserve existing-document behavior;
- add tests before claiming a defect is fixed;
- run all required gates after implementation;
- inspect the final diff for accidental scope growth;
- report every uncompleted acceptance item explicitly.

## 4.2 The agent must not make independent product decisions

The agent must not:

- invent new accounting policy;
- change weighted-average costing policy;
- change document numbering policy;
- change tax/discount policy;
- introduce a new chart of accounts;
- add multiple-invoice return allocation logic unless the existing accepted accounting policy already defines it;
- create procurement PDFs merely to make Documents look complete;
- mutate historical posted journals;
- repair historical journal defects by rewriting old rows;
- change past applied migration files;
- expose SQL messages to users;
- broaden database table grants because writing a secure function is harder;
- bypass permission checks in Rust because SQL access already exists;
- weaken constraints to make tests pass;
- remove failing tests;
- alter acceptance expected values to match buggy behavior;
- replace exact decimals with floats;
- add a new frontend state-management framework;
- add a new UI library;
- perform unrelated UI redesign;
- rename large domain areas;
- move files merely for cleanliness;
- rewrite the procurement module wholesale.

## 4.3 No “temporary” shortcuts

The following are specifically forbidden even if marked TODO:

- hard-coded fake journal rows;
- fake document rows;
- mock-only functionality with no production backend;
- hiding the supplier-return confirm button instead of fixing eligibility;
- catching an error and showing “Something went wrong” for all cases;
- swallowing `PRECONDITION_FAILED`;
- setting stock or liability values directly in tests to bypass the workflow being tested;
- creating direct runtime write permissions to ledger tables;
- using `Number`, `parseFloat`, or binary floating-point math for accounting decisions;
- turning off a failing database trigger;
- skipping upgraded-database testing;
- claiming manual acceptance without actually running the Windows/Tauri flow.

---

# 5. Scope

## 5.1 In scope — mandatory

The following are mandatory and must all be completed.

### A. Supplier-return defect repair

- reproduce the failing supplier return;
- determine its exact private backend failure condition;
- ensure valid supplier returns complete successfully;
- ensure invalid returns are blocked with an actionable, safe, localized reason;
- ensure draft eligibility and final confirmation use the same business rules;
- ensure confirmation remains atomic and concurrency-safe;
- ensure failed posting leaves no partial accounting/inventory state.

### B. Read-only Journals feature

- secure journal list backend;
- secure journal detail backend;
- Rust/Tauri command layer;
- TypeScript DTO/gateway layer;
- application navigation;
- read-only Journals screen;
- balanced debit/credit totals;
- journal lines;
- source metadata;
- links from procurement results/history to the relevant journal;
- English/French/Arabic UI;
- RTL support;
- feature toggle default ON.

### C. Business Documents repair

- separate the concept of **business documents** from **print/generation jobs**;
- preserve existing printable-document behavior;
- expose procurement business documents;
- include linked journal information;
- show generation/print as Not applicable where procurement output generation does not exist;
- preserve permissions by document type;
- feature toggle default ON.

### D. Procurement UI hardening

- safe localized error handling;
- local-calendar business-date helper;
- exact decimal validation/comparison;
- stale-data refresh rules;
- double-submit prevention;
- meaningful blocked/empty states;
- no unusable modal when prerequisites are absent.

### E. Regression and acceptance coverage

- clean database;
- existing/upgraded database;
- concurrency;
- idempotency;
- permissions;
- supplier-return edge cases;
- journal balances;
- business-document visibility;
- frontend localization;
- RTL;
- light/dark rendering sanity;
- exact Windows/Tauri acceptance flow.

---

## 5.2 In scope — adjacent defect sweep

The agent must inspect the adjacent surfaces listed in Section 15.

If a defect is proven and is directly caused by the same procurement acceptance path, it must be repaired.

This does **not** grant permission for broad refactoring.

For every adjacent item, the agent must record one of:

```text
FIXED
NO DEFECT FOUND
OUT OF SCOPE — requires separate product/accounting decision
```

The agent may not ignore the sweep.

---

# 6. Explicitly Out of Scope

The following are excluded unless an already-accepted repository policy requires them for the repair.

## 6.1 Accounting policy changes

Out of scope:

- FIFO;
- LIFO;
- specific identification;
- configurable inventory costing;
- changing WAC;
- SCF account-number redesign;
- tax/TVA support;
- discounts;
- FX-policy redesign;
- supplier-credit-note policy redesign;
- multi-invoice allocation design that is not already specified;
- automatic allocation of returns across several supplier invoices;
- retroactive restatement of historical posted ledgers.

If a valid workflow requires an accounting decision that the repository does not define, the correct result is:

```text
OUT OF SCOPE — accounting policy decision required
```

Do not invent one.

## 6.2 Procurement document generation

Out of scope:

- purchase-order PDF generation;
- purchase-receipt PDF generation;
- supplier-invoice PDF generation;
- debit-note PDF generation;
- supplier-payment receipt PDF generation;
- procurement print queue;
- procurement templates;
- ESC/POS changes.

The Documents screen must show the durable business record even when no PDF exists.

For procurement documents without generation support:

```text
Generation: Not applicable
Print: Not applicable
```

Do not create fake generation jobs.

## 6.3 General accounting application expansion

Out of scope:

- editing journals;
- manual journal creation;
- journal reversal UI;
- general-ledger posting UI;
- chart-of-accounts editor;
- trial balance redesign;
- financial statement redesign;
- accountant approval workflow.

The Journals feature in this task is **read-only evidence**.

## 6.4 Broad UI redesign

Out of scope:

- changing the application visual identity;
- replacing the design system;
- redesigning unrelated pages;
- changing sidebar architecture beyond the navigation entry needed here;
- large CSS refactors.

Use existing Stockiha design primitives and patterns.

## 6.5 Unrelated cleanup

Do not:

- rename unrelated files;
- update unrelated dependencies;
- run formatting across the entire repository if it creates unrelated churn;
- “modernize” working code outside this scope.

---

# 7. Non-Negotiable Domain Invariants

Every implementation decision must preserve these invariants.

## 7.1 Posted documents are immutable

Never modify an already-posted journal line to repair this feature.

A correction to historical accounting, if ever required, must remain append-only and follow existing correction policy.

## 7.2 Journals must balance

For every posted journal:

```text
SUM(debit) == SUM(credit)
```

No tolerance based on float epsilon is allowed.

Use database numeric values.

## 7.3 Stock cannot become negative

Supplier-return confirmation must not create negative stock.

The database remains authoritative.

## 7.4 Inventory value and quantity must remain coherent

A return that removes stock must remove inventory value according to the currently accepted WAC implementation.

Do not substitute supplier invoice cost for inventory issue value.

The return may therefore produce a procurement variance.

## 7.5 Supplier liability cannot become negative

A supplier return against an invoice-backed payable must not reduce that payable below zero.

## 7.6 Idempotency must survive retry

Retrying the same posting request with the same request identity must not create:

- a second business document;
- a second stock movement;
- a second journal;
- a second liability adjustment.

## 7.7 Failed posting is all-or-nothing

If supplier-return confirmation fails:

- return stays unposted;
- no stock movement remains;
- inventory position is unchanged;
- liability is unchanged;
- no journal remains;
- no partial document numbering state is exposed as a posted result;
- no orphan related rows are created.

## 7.8 Runtime security

Read and write boundaries must remain permission-checked.

Never solve a UI access issue by broadly granting runtime table writes.

## 7.9 Error privacy

The public IPC contract must not expose:

- SQL text;
- SQLSTATE diagnostics;
- internal table names;
- database connection details;
- tokens;
- file paths;
- stack traces.

---

# 8. Verified Baseline Facts the Agent Must Respect

These are not assumptions.

## 8.1 Supplier return confirmation already contains many distinct preconditions

`inventory.confirm_supplier_return(...)` currently distinguishes conditions including:

- return document not DRAFT;
- missing purchase order;
- closed fiscal period;
- document date outside period;
- multiple posted supplier invoices for the purchase order;
- posted supplier invoice missing payable liability;
- no return lines;
- return quantity greater than received quantity;
- missing authoritative purchase cost;
- insufficient current stock;
- non-positive calculated values;
- clearing amount greater than outstanding supplier liability.

Many of these currently collapse into the same public `PRECONDITION_FAILED`.

## 8.2 Current IPC error boundary intentionally redacts diagnostics

The Rust `IpcError` currently serializes a stable code only.

Do not “fix” the UI by exposing the private diagnostic string.

## 8.3 The frontend already has a safe localization boundary

`src/shared/hooks/useErrorText.ts` exists specifically so raw backend diagnostics do not reach the UI.

Procurement should use it.

## 8.4 Documents currently means printable documents

The current backend `documents.list_printable_documents(...)` only includes:

- `CASH_SALE`;
- `CREDIT_SALE`;
- `CUSTOMER_PAYMENT`;

subject to current permissions.

The current React `DocumentsScreen` is therefore tied to generation/print state.

The repair must not corrupt this queue abstraction merely to add procurement rows.

## 8.5 Journal tables already exist and enforce immutability/balance

The journal feature is missing primarily as a secure application read model/UI, not as a new posting engine.

---

# 9. Required Implementation Sequence

The agent must perform the phases in this order.

Do not start the Journals UI before supplier-return evidence is captured.
Do not start broad frontend polish before database contracts are settled.

---

# Phase 0 — Repository Reconnaissance and Evidence Pack

## 9.1 Read before editing

At minimum inspect these existing areas before any implementation change:

```text
CURRENT_SLICE.md
docs/slices/*procurement*
final-architecture.md or the current architecture authority
docs/adr/*

src-tauri/migrations/*procurement*
src-tauri/migrations/*journal*
src-tauri/migrations/*document*
src-tauri/src/error.rs
src-tauri/src/application/*
src-tauri/src/commands/*
src-tauri/src/domain/*

src/shared/ipc/*
src/shared/types/errors.ts
src/shared/hooks/useErrorText.ts
src/shared/utils/tauriError.ts

src/features/procurement/*
src/features/documents/*
src/app/AppShell.tsx
src/app/AppRouter.tsx

tests/*procurement*
tests/*document*
src-tauri/tests/*
```

Do not assume a file is authoritative merely because its name sounds correct.

## 9.2 Produce a dependency map

Before modifying code, write an internal execution note that maps:

```text
Supplier Return:
React screen
  -> TS gateway
  -> Tauri command
  -> Rust application function
  -> PostgreSQL function
  -> tables affected

Journals:
PostgreSQL tables
  -> new SQL read API
  -> Rust query/command
  -> TS gateway
  -> screen/router

Business Documents:
core.business_documents
  -> secure read model
  -> Rust/IPC
  -> Documents screen
  -> printable job sub-view where applicable
```

This is required to prevent one-layer-only fixes.

---

# Phase 1 — Reproduce the Supplier-Return Failure Before Editing

## 10.1 Reproduction is mandatory

Do not change supplier-return code until the failing state has been reproduced or a copy of the failing state has been inspected.

The exact private failure diagnostic must be captured in developer evidence.

It must **not** be rendered in the application.

## 10.2 Use a disposable database copy

Never experiment destructively against the only copy of the user's production/pilot database.

Required:

- create/use a safe disposable copy;
- record schema version;
- record application commit;
- record relevant IDs;
- record row state before confirmation;
- attempt confirmation;
- record the private backend/SQL diagnostic;
- verify rollback.

## 10.3 Mandatory state capture

Capture at least:

### Business document

```text
document id
document type
status
document number
document date
fiscal period
posted_at
```

### Supplier return

```text
return id
return document id
supplier id
warehouse id
purchase order id
reason code
```

### Return lines

For every line:

```text
line id
variant id
quantity
unit cost
line total
```

### Purchase order

```text
document id
supplier id
warehouse id
status
```

### Purchase receipts

For the same purchase order/supplier/warehouse:

```text
receipt document id
status
variant id
quantity received
unit cost
```

### Supplier invoices

```text
invoice document id
status
supplier id
purchase order id
exchange rate
invoice line quantity
invoice line cost
```

### Supplier liabilities

```text
liability id
source
invoice_document_id
receipt_document_id if applicable
original amount
outstanding amount
status
journal id
```

### Inventory position

For each returned variant:

```text
warehouse
variant
quantity_on_hand
total_value
last_known_wac
```

### Already-posted returns

For the same PO/variant:

```text
return document
status
quantity
```

### Fiscal period

```text
period id
status
starts_on
ends_on
```

## 10.4 Mandatory classification

Classify the observed failure into exactly one primary class:

```text
A. RETURN_NOT_DRAFT
B. PURCHASE_ORDER_REQUIRED
C. CLOSED_FISCAL_PERIOD
D. DATE_OUTSIDE_FISCAL_PERIOD
E. MULTIPLE_INVOICES_UNSUPPORTED
F. PAYABLE_LIABILITY_MISSING
G. RETURN_HAS_NO_LINES
H. QUANTITY_EXCEEDS_RECEIVED
I. AUTHORITATIVE_COST_MISSING
J. INSUFFICIENT_CURRENT_STOCK
K. NON_POSITIVE_RETURN_VALUE
L. RETURN_EXCEEDS_OUTSTANDING_PAYABLE
M. OTHER_PROVEN_DATABASE_CONDITION
```

If `M` is selected, record:

- exact condition;
- exact code path;
- why it is not represented above;
- why it belongs to this repair.

Do not use `M` as a substitute for investigation.

---

# Phase 2 — Build One Authoritative Supplier-Return Eligibility Model

## 11.1 Core design rule

The current UX can create/select a return based on a narrower notion of “returnable” than the final posting function uses.

That is the structural problem.

The repair must introduce a **database-authoritative eligibility read model**.

Do not duplicate accounting rules in React.

## 11.2 Required output contract

The read model must expose safe business information sufficient for the UI to determine whether a return can proceed.

At minimum, for the selected purchase order / variant or draft return, provide:

```text
eligible: boolean
eligibility_code: stable safe enum/string
maximum_returnable_quantity: exact decimal string
currently_available_stock: exact decimal string where safe/useful
received_quantity: exact decimal string
previously_returned_quantity: exact decimal string
invoice_count: integer
has_required_liability: boolean when applicable
outstanding_liability: money string when applicable and authorized
```

Do not expose SQL diagnostics.

## 11.3 Required safe eligibility codes

Use fixed, non-sensitive codes.

At minimum support:

```text
ELIGIBLE
RETURN_NOT_DRAFT
PURCHASE_ORDER_REQUIRED
CLOSED_FISCAL_PERIOD
DATE_OUTSIDE_FISCAL_PERIOD
MULTIPLE_INVOICES_UNSUPPORTED
PAYABLE_LIABILITY_MISSING
RETURN_HAS_NO_LINES
QUANTITY_EXCEEDS_RECEIVED
AUTHORITATIVE_COST_MISSING
INSUFFICIENT_CURRENT_STOCK
NON_POSITIVE_RETURN_VALUE
RETURN_EXCEEDS_OUTSTANDING_PAYABLE
```

If another proven condition is needed, add a stable code deliberately and test it.

Do not put variant IDs, SQL snippets, or diagnostics inside the code string.

## 11.4 Single-source-of-truth rule

The agent must not implement:

- one set of eligibility rules in `listPurchaseReceiptLines`;
- another set in React;
- another set in `confirm_supplier_return`.

The database must own the rule evaluation.

The final confirmation must revalidate the same rules after acquiring the necessary row locks.

The read model is advisory for UX.
The locked confirmation is authoritative for posting.

## 11.5 Locking rule

The confirmation transaction must continue to lock the rows whose concurrent change can invalidate the return.

At minimum reason about and test locking for:

- return business document status;
- supplier liability when invoice-backed;
- relevant inventory positions;
- relevant rows needed to prevent competing returns from both seeing the same available quantity.

Do not remove current locks.

If a race remains possible between two supplier returns against the same PO/variant, add the minimum deterministic lock required.

## 11.6 Maximum returnable quantity

The allowed quantity must be no greater than all relevant limits.

Conceptually:

```text
remaining received quantity
= total posted received
- total posted previous supplier returns
```

and:

```text
maximum returnable quantity
<= remaining received quantity
<= current stock available
```

If an invoice-backed monetary liability imposes a smaller permitted return because the outstanding payable has already been partially settled, that must also be reflected in eligibility according to the existing accepted return policy.

Do not convert the limit using floating-point math.

## 11.7 Multiple invoices

Current accepted implementation rejects ambiguous return allocation across multiple supplier invoices.

For this repair:

- preserve that accounting boundary;
- surface it before confirmation;
- display a clear localized message;
- do not invent proportional allocation;
- do not silently choose one invoice;
- do not use `min(invoice_document_id)` as an accounting allocation policy.

Expected user message meaning:

```text
This return cannot be posted because this purchase order is linked to multiple supplier invoices and automatic return allocation is not supported yet.
```

Localized English/French/Arabic copy is required.

## 11.8 Partially paid payable

If the supplier invoice liability has already been reduced by payments:

- the return must not push the outstanding liability below zero;
- if the requested return is too large, block it before posting;
- expose the safe reason;
- calculate using exact database numerics;
- add a regression test.

Do not create a supplier receivable/negative payable as a hidden consequence.

That would be a new accounting policy and is out of scope.

---

# Phase 3 — Repair Supplier-Return Confirmation

## 12.1 Forward-only migration

Any database behavior change must be added through a new migration.

Never modify:

```text
20260803131300_r2_supplier_return_and_payment.sql
```

or any other previously applied migration.

## 12.2 Confirmation behavior

For an eligible draft, confirmation must atomically:

1. resolve session and `POST_SUPPLIER_RETURN`;
2. validate idempotency;
3. lock return header;
4. validate DRAFT;
5. validate purchase order;
6. validate fiscal period and date;
7. determine invoice/GRNI clearing path;
8. lock relevant payable when invoice-backed;
9. lock relevant inventory positions;
10. recompute received/returned/current-stock eligibility;
11. compute authoritative supplier return cost;
12. compute WAC inventory issue value;
13. verify monetary eligibility;
14. update inventory position;
15. add immutable inventory movement;
16. set persisted return-line unit cost/line total;
17. create official debit-note number;
18. post business-document header;
19. create journal;
20. create balanced journal lines;
21. reduce liability where applicable;
22. record idempotent result;
23. return official result.

No intermediate committed state is allowed.

## 12.3 Do not use UI eligibility as authority

Even if React says the return is eligible, the database must re-check.

This prevents stale-browser and concurrent-operation defects.

## 12.4 Failure rollback test

For every failure that can occur after transaction start, verify no partial state remains.

At minimum compare before/after:

```text
core.business_documents
procurement.supplier_returns
procurement.supplier_return_lines
inventory.positions
inventory.movements
procurement.supplier_liabilities
finance.journal_entries
finance.journal_lines
```

## 12.5 Idempotent retry test

After one successful confirmation:

- call confirmation again with the same request ID/hash;
- assert the same document result is returned;
- assert no duplicate movement;
- assert no duplicate journal;
- assert no duplicate liability reduction.

Also test idempotency conflict behavior for a mismatched hash if the existing contract supports it.

---

# Phase 4 — Safe Error Handling Across Procurement

## 13.1 Existing architecture must be used

The repository already has:

```text
src/shared/hooks/useErrorText.ts
src/shared/types/errors.ts
src-tauri/src/error.rs
```

Use this safe boundary.

## 13.2 Remove raw `.message` rendering from procurement

Audit every procurement component.

Any pattern equivalent to:

```ts
setError((caught as Error)?.message || ...)
```

must be replaced with the existing safe error text mechanism unless the value is guaranteed to be local UI-generated copy.

Backend/Tauri errors must not render their raw message.

## 13.3 Eligibility messages are not raw backend errors

Supplier-return business blocking reasons should come from the safe eligibility code.

Create localized fixed copy for every allowed eligibility code.

No backend diagnostic interpolation.

## 13.4 Generic errors remain generic

If an unexpected failure occurs and there is no safe business eligibility code:

- use the normal safe localized app error;
- do not leak private details in an attempt to be “helpful.”

## 13.5 Rust error contract

Do not weaken the existing `{ code }` IPC error contract.

If implementation truly needs a new public backend error code:

1. add a dedicated stable `ErrorCode` in Rust;
2. map it from a deliberate database condition;
3. add the exact TypeScript allowlist entry;
4. add localization;
5. add serialization/redaction tests.

However, do not create dozens of IPC error variants when the supplier-return eligibility read model can safely express the business reason.

---

# Phase 5 — Correct Business-Date Handling

## 14.1 Confirmed defect

Procurement components currently use UTC-derived dates such as:

```ts
new Date().toISOString().slice(0, 10)
```

This can produce the previous local calendar date around local midnight.

## 14.2 Required solution

Create or reuse one tested helper that returns the user's **local calendar date** as:

```text
YYYY-MM-DD
```

without converting the calendar date to UTC first.

Example intent:

```text
local year
local month
local day
```

formatted directly.

## 14.3 Scope of replacement

Audit and replace unsafe posting-date defaults in at least:

```text
src/features/procurement/LandedCostModal.tsx
src/features/procurement/PurchaseReceiptModal.tsx
src/features/procurement/SupplierPaymentModal.tsx
src/features/procurement/SupplierInvoicesScreen.tsx
src/features/procurement/SupplierReturnsScreen.tsx
```

Also search the whole procurement feature directory rather than relying only on this list.

## 14.4 Fiscal-period validation

A local date helper does not replace database validation.

Before enabling a posting action, the UI should have a valid selected/open fiscal period.

The database must still reject dates outside the period.

## 14.5 Tests

Use deterministic fake time/timezone tests covering at least:

- normal daytime;
- local time shortly after midnight where UTC is still the previous date;
- month boundary;
- year boundary.

The expected output is the local business date.

Do not write tests that depend on the developer machine timezone.

---

# Phase 6 — Remove Floating-Point Business Validation

## 15.1 Rule

JavaScript floating-point numbers must not decide whether procurement quantities/money satisfy accounting or stock constraints.

## 15.2 Existing exact helpers

Supplier Returns already uses exact decimal-string helpers.

The agent must inspect and reuse/extend that approach rather than introducing another decimal implementation.

## 15.3 Mandatory audit

Search procurement for:

```text
parseFloat
parseInt for monetary/quantity decisions
Number(...)
unary +
Math.round on business monetary values
```

Not every `Number(...)` is necessarily wrong; IDs are fine.

Fix only business quantity/money comparisons/calculation paths.

## 15.4 Confirmed locations to inspect

At minimum:

```text
src/features/procurement/PurchaseReceiptModal.tsx
src/features/procurement/LandedCostModal.tsx
src/features/procurement/SupplierLiabilitiesScreen.tsx
src/features/procurement/PurchaseOrdersScreen.tsx
```

## 15.5 Exactness tests

Include:

- `0.1`;
- `0.2`;
- `0.3`;
- three-decimal quantities;
- equality at maximum returnable quantity;
- one smallest allowed decimal unit above the maximum;
- very large valid numeric string within schema bounds.

Database numeric remains the final authority.

---

# Phase 7 — Add Read-Only Journals Evidence

## 16.1 Goal

Users with appropriate permission must be able to inspect persisted journal entries and lines from the application.

This task does not create a new posting engine.

## 16.2 Database API

Add secure, session-authorized functions.

Preferred functional contracts:

```text
finance.list_journals(...)
finance.get_journal_detail(...)
```

Use repository naming conventions if signatures require adjustment.

## 16.3 List result requirements

Each journal list row must expose at least:

```text
journal_document_id
journal_document_number
document_date
posted_at
status
description
source_type
source_id
total_debit
total_credit
is_balanced
line_count
```

Use database numeric values.

`is_balanced` must derive from exact totals.

## 16.4 Detail result requirements

Journal detail must expose:

### Header

```text
journal_document_id
journal_document_number
document_date
fiscal_period_id
status
posted_at
description
source_type
source_id
total_debit
total_credit
is_balanced
```

### Lines

For each line:

```text
line_number
account_code
description
debit
credit
```

Sort by `line_number`.

## 16.5 Source linkage

Where safe and meaningful, expose enough source metadata for the UI to say:

```text
Source: Purchase receipt PR-...
Source: Supplier invoice SI-...
Source: Purchase return DN-...
Source: Supplier payment ...
```

Do not make a generic unsafe dynamic SQL resolver.

Use explicit supported source types.

## 16.6 Permission model

Do not rely only on the database role's existing direct SELECT grant.

The application read API must resolve the application session.

Deterministic permission rule:

1. inspect the baseline permission catalog for an existing **read-only finance/journal permission**;
2. if one exists and semantically covers journal inspection, use it;
3. if no suitable read permission exists, add:

```text
VIEW_JOURNALS
```

through a forward migration;
4. grant it to the existing administrator/manager roles according to current Stockiha role policy;
5. do not grant journal viewing to cashier merely because cashier can post/view sales documents.

Do not reuse a write permission such as `POST_SUPPLIER_RETURN` as a general journal-read authorization.

## 16.7 SQL security

For new SQL functions:

- `SECURITY DEFINER`;
- `SET search_path = pg_catalog`;
- resolve session/permission inside the function;
- validate limits/IDs;
- `REVOKE ALL ... FROM PUBLIC`;
- grant execute only to required runtime role;
- no dynamic SQL;
- no raw table write grants.

## 16.8 Pagination

Do not load an unbounded journal history.

Use a bounded page/limit contract consistent with repository style.

If cursor pagination already has an accepted pattern, reuse it.

If not, use deterministic bounded pagination with a stable ordering:

```text
posted_at DESC NULLS LAST
document_id DESC
```

Do not invent an elaborate pagination framework.

## 16.9 Rust layer

Add typed application/command support following existing repository patterns.

Requirements:

- no untyped `serde_json::Value` propagation if the surrounding code uses typed structs;
- preserve numeric values as strings where the IPC convention requires exact decimals;
- map DB errors through `AppError::from_posting_error` or the repository's corresponding query boundary;
- return `IpcError`, not private diagnostics.

## 16.10 TypeScript layer

Add typed DTOs/gateway functions.

Do not place journal SQL semantics in React.

## 16.11 UI

Add a read-only screen:

```text
Journals
```

Required behaviors:

- list view;
- selectable journal;
- detail view;
- debit total;
- credit total;
- visible balanced/unbalanced status;
- source;
- lines;
- loading state;
- empty state;
- permission-safe error state;
- narrow-layout usability;
- keyboard-accessible buttons/selection;
- English/French/Arabic copy;
- RTL correctness.

## 16.12 Do not hide an imbalance

The database is designed to prevent posted imbalance.

However, if a historical/upgraded database contains an anomaly:

- render `Unbalanced`;
- do not silently display `Balanced`;
- do not mutate the journal from the viewer;
- include the anomaly in the final implementation report.

---

# Phase 8 — Link Procurement to Journals

## 17.1 Required links

Where procurement results/history already show a journal identifier, replace dead text with an explicit read action when permitted.

At minimum inspect:

```text
Purchase receipts
Landed costs
Supplier invoices
Supplier returns
Supplier payments
```

## 17.2 Interaction

Preferred action:

```text
View journal
```

The action should navigate/open the Journals screen at the selected journal.

Do not duplicate a second journal detail implementation inside each procurement screen.

## 17.3 Missing journal behavior

If a posted procurement record that should have a journal has no linked journal:

- show an explicit unavailable/anomaly state;
- do not hide the column;
- do not fabricate an ID;
- include it in defect-sweep evidence.

---

# Phase 9 — Journals Feature Toggle

## 18.1 Toggle requirement

Add:

```text
accounting_journals_enabled
```

Default:

```text
ON
```

## 18.2 Meaning of OFF

Turning the toggle OFF may hide/disable the Journals **UI visibility**.

It must **not**:

- stop journal creation;
- stop balancing constraints;
- stop procurement accounting;
- mutate journals;
- weaken database integrity.

This is a presentation/feature-access toggle, not an accounting-integrity toggle.

## 18.3 Authority

Use the existing Stockiha settings/toggle authorization/audit pattern.

Do not invent a new `CEO` database role if the repository represents that authority through an existing administrator role.

The setting must:

- default ON;
- persist in database;
- be changeable only through the authorized settings path;
- record change audit evidence consistent with existing setting patterns;
- survive restart.

## 18.4 UI

When OFF:

- sidebar/navigation entry should not be shown to normal users;
- direct route access should return a disabled/not-authorized state rather than crash;
- procurement posting must continue normally.

When ON again:

- historical journals must immediately be visible;
- no backfill should be needed because posting never stopped.

---

# Phase 10 — Repair Documents Semantics

## 19.1 Core design decision

Do **not** stretch `list_printable_documents` until it means two contradictory things.

The application needs two concepts:

```text
Business document history
Printable/generation state
```

A procurement document can be a valid durable business document while having no PDF generation job.

## 19.2 Preserve current printable queue behavior

Existing customer/sales generation and print behavior must continue to work.

Do not break:

- cash-sale receipt viewing;
- credit-sale document generation;
- customer-payment receipt generation;
- reprint behavior;
- generation status;
- print status.

## 19.3 Add secure business-document read model

Add a secure paginated list/query covering at least:

### Existing sales/customer types

```text
CASH_SALE
CREDIT_SALE
CUSTOMER_PAYMENT
```

### Procurement types represented in the accepted baseline

Include the exact baseline document types corresponding to:

```text
Purchase order
Purchase receipt
Supplier invoice
Supplier return / debit note
Supplier payment
```

Use the actual `core.business_documents.document_type` values from the repository.

Do not guess names.

## 19.4 Required business-document fields

At minimum:

```text
document_id
document_type
document_number
document_date
status
posted_at
fiscal_period_id where applicable
source label/type
source id
journal_document_id when linked
journal_document_number when linked
generation_status nullable
generated_file_ref nullable
print_status nullable
```

For procurement rows with no generation support:

```text
generation_status = Not applicable in UI
print_status = Not applicable in UI
```

Prefer a typed UI state rather than inserting fake database status rows.

## 19.5 Document permissions

Preserve existing visibility semantics.

Deterministic rule:

- existing cash-sale rows retain current cash-sale authorization;
- existing customer credit/payment rows retain current customer authorization;
- procurement rows require the existing procurement management/read authorization, preferably `MANAGE_PROCUREMENT` where semantically correct;
- cashier must not gain supplier/procurement visibility merely because cash sale documents share the same screen.

Do not solve this by giving everyone one broad document permission.

## 19.6 Detail behavior

For existing printable sales/customer documents:

- preserve current detail components and actions.

For procurement documents in this repair:

- show durable business-document metadata;
- show relevant source/supplier/warehouse/PO references available through existing read models;
- show linked journal action;
- show `Not applicable` for generation/printing where unsupported.

Do not build new procurement PDFs.

## 19.7 Screen wording

The Documents page must no longer imply:

```text
No printable documents
```

when the screen is presenting business history.

Use business-document wording for the main history.

Generation and printing should be columns/secondary behavior rather than the definition of whether a document exists.

---

# Phase 11 — Business Documents Feature Toggle

## 20.1 Toggle

Add:

```text
business_documents_enabled
```

Default:

```text
ON
```

## 20.2 OFF semantics

Turning it OFF may hide the central Documents history feature.

It must **not**:

- stop creation of `core.business_documents`;
- stop official numbering;
- stop journal linkage;
- stop existing print-job workers;
- delete document history.

## 20.3 Audit and authorization

Follow the same existing audited setting pattern used by other Stockiha feature toggles.

Avoid a one-off localStorage-only toggle.

---

# Phase 12 — Procurement Form and State Hardening

## 21.1 Refresh rules

After any successful operation that can change return eligibility, refresh relevant data.

At minimum:

```text
purchase receipt posting
landed-cost posting
supplier invoice posting
supplier return confirmation
supplier payment posting
```

Supplier Return screen must refresh:

- returns;
- purchase orders;
- receipt/eligibility lines;
- relevant liabilities if shown.

## 21.2 Stale draft behavior

If a return draft was valid when created but becomes invalid before confirmation:

- confirmation must safely reject;
- UI must refresh eligibility;
- show the new safe reason;
- do not keep presenting the same confirm action as if nothing changed.

## 21.3 Double-submit

Posting buttons must be disabled per operation while the operation is in flight.

Do not use one broad global `submitting` state if it unnecessarily disables unrelated rows and creates race confusion.

For row-based confirm operations, prefer tracking the active document/request.

Idempotency remains mandatory even with UI disabling.

## 21.4 Request identity

Do not generate a fresh idempotency request ID on every retry after an uncertain response.

Preserve the existing intended retry identity until the application knows the operation succeeded or the user intentionally starts a new posting operation.

## 21.5 Empty states

If there are no eligible purchase orders/lines:

- explain why;
- do not open an empty modal with required selects containing no choices.

Examples:

```text
No received purchase orders are currently eligible for supplier return.
No remaining returnable quantity is available for this purchase order.
This purchase order cannot be returned because it has multiple supplier invoices.
```

Use localized fixed copy.

---

# Phase 13 — Feature Toggle Implementation Pattern

## 22.1 Do not create frontend-only policy

Both new toggles must persist through the accepted settings mechanism.

Use repository precedent for:

- singleton settings;
- default ON;
- authorized update function;
- audit row;
- `updated_by`;
- workstation;
- timestamp;
- `SECURITY DEFINER`;
- public revoke;
- runtime execute grant.

## 22.2 Do not disable backend integrity

These toggles control feature visibility/access only.

The database must still:

- create journals;
- create business documents;
- maintain immutable ledgers;
- enforce posting rules.

---

# Phase 14 — Adjacent Defect Sweep

The agent must inspect these areas after the primary fixes.

Fix a discovered defect only when it is directly within the repaired procurement acceptance path.

## 23.1 Supplier-return list integrity

Check:

- draft rows show correct PO/supplier/warehouse;
- posted row shows official debit-note number;
- journal link matches the return;
- quantity eligibility does not count the current draft as a previous posted return;
- duplicate receipt lines for the same variant do not produce inconsistent limits.

## 23.2 Purchase receipt logic

Check:

- exact decimal quantity validation;
- received quantities cannot exceed accepted PO constraints;
- local date;
- resulting journal link;
- resulting return eligibility refresh.

## 23.3 Landed cost

Check:

- local date;
- exact amount comparison;
- no float validation;
- linked AP liability persists;
- linked journal is viewable;
- return WAC issue value correctly includes landed cost in inventory value.

## 23.4 Supplier invoice

Check:

- local date;
- invoice exact line matching rules;
- liability is correctly linked;
- journal is viewable;
- posting refreshes return eligibility.

## 23.5 Supplier liabilities/payment

Check:

- amount exactness;
- payment cannot exceed outstanding liability;
- payment updates return monetary eligibility;
- all supplier payment journals are visible in Journals;
- cash vs bank/check funding account remains correct.

## 23.6 Journal coverage

Search all procurement posting functions and create a table:

```text
Operation | Creates journal? | Source type | Source id | Visible in Journals? | Balanced?
```

Every operation that creates a journal must be covered.

Do not test only receipts/returns and forget supplier payments.

## 23.7 Business-document coverage

Create a similar table:

```text
Operation | Creates business document? | document_type | Visible in Documents? | Print support?
```

No supported procurement document should disappear because it has no generation job.

## 23.8 Permission matrix

Test at least:

```text
Administrator
Manager
Cashier / sales-only user
Unauthorized runtime session
Expired/invalid session
```

Verify:

- procurement visibility;
- journal visibility;
- document visibility;
- no privilege escalation.

## 23.9 RTL/narrow layout

Check:

- tables remain usable;
- action buttons remain reachable;
- journal debit/credit columns do not become semantically reversed just because layout direction is RTL;
- numbers remain readable;
- modal controls do not overflow.

## 23.10 Existing database upgrade

Run the migration chain against:

- a clean database;
- the existing/historical upgrade fixtures already used by the repository;
- a database representing the pre-repair procurement candidate.

Do not rely only on a fresh schema.

---

# Phase 15 — Likely File Map

This is a controlled map, not permission for unrelated edits.

## 24.1 New database migration

Expected:

```text
src-tauri/migrations/<new_timestamp>_procurement_acceptance_defect_repair.sql
```

If feature-toggle tables/settings are large enough to warrant a separate forward migration, keep the split minimal and logically coherent.

Never modify applied migrations.

## 24.2 PostgreSQL tests

Expected changes/additions under existing patterns in:

```text
src-tauri/tests/procurement/
src-tauri/tests/finance/
src-tauri/tests/documents/
src-tauri/tests/*upgrade*
src-tauri/tests/run_current_sql_suites.sh
```

Use actual existing directories discovered at baseline.

Do not create parallel test infrastructure if one already exists.

## 24.3 Rust

Likely:

```text
src-tauri/src/domain/
src-tauri/src/application/
src-tauri/src/commands/
src-tauri/src/lib.rs
src-tauri/src/error.rs   # only if a genuinely required public code is added
```

## 24.4 TypeScript IPC

Likely:

```text
src/shared/ipc/commands.ts
src/shared/ipc/dto.ts
src/shared/ipc/gateway.ts
src/shared/ipc/documentDto.ts
src/shared/ipc/documentGateway.ts
```

If journal-specific DTO/gateway files better match repository conventions, create them consistently.

Do not duplicate command constants in multiple places.

## 24.5 React

Expected:

```text
src/features/procurement/*
src/features/documents/DocumentsScreen.tsx
src/features/accounting/JournalsScreen.tsx
src/app/AppShell.tsx
src/app/AppRouter.tsx
```

Potential settings screen changes for the two toggles are also in scope.

## 24.6 Localization/error copy

Use existing i18n architecture.

Do not create English-only strings inside error handlers.

---

# Phase 16 — Database Migration Quality Rules

## 25.1 Forward-only

No historical migration edits.

## 25.2 Repeatability expectations

Migration must:

- apply on clean schema history;
- apply on current accepted existing database;
- not rely on manual row edits;
- not erase historical data;
- not rewrite posted accounting;
- preserve old document numbers.

## 25.3 Closed vocabularies

If adding:

- permission codes;
- setting codes;
- constrained status/code values;

extend the current CHECK/enum vocabulary using the repository's established migration pattern.

Do not drop validation entirely.

## 25.4 Grants

For every new function/table:

Explicitly reason about:

```text
PUBLIC
stockiha_runtime
stockiha_backup
owner/migrator role
```

Do not rely on default privileges accidentally.

## 25.5 Search path

New security-definer functions must use safe search-path handling consistent with repository policy.

---

# Phase 17 — Supplier Return Regression Matrix

The following cases are mandatory.

## 26.1 Clean happy path

Official acceptance fixture:

```text
Purchase:
10 units × 100.00 DZD = 1,000.00 DZD receipt value

Landed cost:
100.00 DZD

Inventory after landed cost:
quantity = 10
value = 1,100.00 DZD
WAC = 110.00 DZD/unit

Supplier invoice:
10 units × 105.00 DZD = 1,050.00 DZD payable

Return:
2 units
authoritative supplier clearing = 2 × 105.00 = 210.00 DZD
inventory issue value = 2 × 110.00 = 220.00 DZD
variance = 10.00 DZD
```

Expected after return:

```text
stock quantity = 8
inventory value = 880.00 DZD
supplier invoice outstanding liability = 840.00 DZD
landed-cost liability = 100.00 DZD
return journal balanced
```

Do not alter these expected values merely to match implementation.

## 26.2 No invoice yet

Return after receipt, before supplier invoice.

Expected clearing path follows existing GRNI policy.

Verify:

- stock/value;
- GRNI clearing;
- balanced journal;
- no fake supplier-invoice liability.

## 26.3 Partially paid supplier invoice

Create invoice.
Post a partial supplier payment.
Attempt a return within remaining liability.

Expected:

- valid return succeeds;
- liability remains non-negative;
- journal balances.

Then attempt a return whose clearing amount exceeds remaining payable.

Expected:

- preflight eligibility blocks;
- confirmation also blocks if called directly;
- no state mutation.

## 26.4 Multiple posted invoices

Expected:

- preflight shows `MULTIPLE_INVOICES_UNSUPPORTED`;
- create/confirm path is blocked appropriately;
- no arbitrary invoice is selected;
- no posting side effects.

## 26.5 Sold/consumed stock

Receive goods, then reduce current stock through an accepted outgoing flow.
Attempt supplier return greater than current stock.

Expected:

```text
INSUFFICIENT_CURRENT_STOCK
```

No negative stock.

## 26.6 Over-return

Attempt:

```text
previous posted returns + requested return > posted received quantity
```

Expected:

```text
QUANTITY_EXCEEDS_RECEIVED
```

## 26.7 Closed fiscal period

Expected safe reason and no mutation.

## 26.8 Date outside period

Expected safe reason and no mutation.

## 26.9 Missing liability corruption case

On a disposable test fixture, create the database state representing a posted supplier invoice without required liability, using controlled fixture setup.

Expected:

```text
PAYABLE_LIABILITY_MISSING
```

Do not change production policy to tolerate this corruption.

## 26.10 Concurrent returns

Two sessions attempt returns that individually look valid but together exceed remaining received/current stock.

Expected:

- at most one succeeds where both cannot validly succeed;
- loser receives safe blocked result;
- no negative stock;
- no over-return;
- no duplicate liability reduction.

## 26.11 Retry

Network/IPC uncertainty simulation where feasible:

- first posting succeeds;
- caller retries same request;
- same official result;
- one journal;
- one stock movement.

---

# Phase 18 — Journal Verification Matrix

## 27.1 Every displayed journal

For each:

```text
total debit == total credit
line count >= 2
every line has exactly one positive side
```

## 27.2 Procurement journal sources

At minimum cover all baseline source types corresponding to:

```text
purchase receipt
landed cost
supplier invoice
purchase return
supplier payment
```

## 27.3 Detail integrity

List totals must equal detail-line totals.

Do not calculate list totals one way and detail totals another way.

## 27.4 Read-only enforcement

Attempt unauthorized writes/direct application actions.

There must be no journal edit controls.

---

# Phase 19 — Documents Verification Matrix

## 28.1 Existing behavior regression

Verify existing:

```text
cash sale
credit sale
customer payment
```

still appear to authorized users as before.

## 28.2 Procurement coverage

Verify:

```text
purchase order
purchase receipt
supplier invoice
supplier return/debit note
supplier payment
```

appear after their durable records exist.

## 28.3 No fake print status

Procurement row with no PDF support must not create a generation/print job.

UI:

```text
Generation: Not applicable
Print: Not applicable
```

## 28.4 Journal link

Where a journal exists, business-document detail/history should expose `View journal`.

Purchase order may legitimately have no accounting journal if accepted workflow does not post one; display that truth instead of fabricating a journal.

---

# Phase 20 — Frontend Test Matrix

## 29.1 Supplier Return screen

Test:

- safe localized error;
- eligibility reason;
- exact quantity limit;
- no empty modal;
- successful confirmation;
- retry behavior;
- refreshed state;
- row-specific submit disable;
- journal action.

## 29.2 Journals

Test:

- load;
- empty;
- detail selection;
- totals;
- balanced badge;
- source;
- lines;
- permission failure;
- toggle ON/OFF;
- route access while disabled.

## 29.3 Documents

Test:

- sales/customer rows;
- procurement rows;
- `Not applicable`;
- selection;
- existing customer document view;
- journal action;
- permissions;
- toggle.

## 29.4 Date helper

Deterministic timezone tests.

## 29.5 Decimal helpers

Exact string comparison tests.

## 29.6 Localization

English, French, Arabic.

No untranslated eligibility code should appear as raw production UI text.

## 29.7 RTL

At least one supplier return, one journal detail, one Documents history rendering.

---

# Phase 21 — Required Automated Commands

The agent must inspect `package.json`, Cargo workspace, and repository test scripts and run the exact available gates.

At minimum, expected frontend gates include the repository equivalents of:

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
```

Rust gates:

```bash
cargo fmt --check
cargo check
cargo clippy --all-targets --all-features -- -D warnings
cargo test
```

Database gates:

- complete migration application;
- current PostgreSQL integration suite;
- procurement suite;
- concurrency/race suite;
- historical/existing-database upgrade suites;
- migration syntax checks.

Also run:

```bash
git diff --check
```

Do not claim a skipped command passed.

If a command does not exist, report:

```text
NOT PRESENT IN REPOSITORY
```

and run the repository's actual equivalent.

---

# Phase 22 — Manual Windows/Tauri Acceptance

Automated tests are necessary but insufficient.

The final candidate must be tested through the actual Tauri application on Windows.

## 31.1 Start cleanly

Use the project's normal Windows workflow.

Verify exact branch/SHA before launching.

## 31.2 Language/theme matrix

At minimum smoke-test the new/modified screens in:

```text
English / light
English / dark
French / light or dark
Arabic / RTL / light
Arabic / RTL / dark
```

Do not require duplicating every transaction in every language, but all new screen layouts/copy must be inspected.

## 31.3 Main business journey

Perform the exact happy-path fixture:

1. Supplier exists.
2. Product/variant exists.
3. Purchase order for 10 × 100.00 DZD.
4. Post purchase receipt.
5. Verify receipt document appears in Documents.
6. Open linked receipt journal.
7. Allocate/post 100.00 DZD landed cost.
8. Open linked landed-cost journal.
9. Post supplier invoice for 10 × 105.00 DZD.
10. Verify supplier invoice appears in Documents.
11. Open supplier-invoice journal.
12. Create supplier return for 2 units.
13. Before confirmation, verify UI reports it eligible and exact maximum.
14. Confirm return.
15. Verify no raw `PRECONDITION_FAILED`.
16. Verify debit note appears in Documents.
17. Open return journal.
18. Verify stock quantity = 8.
19. Verify inventory value = 880.00 DZD.
20. Verify invoice liability = 840.00 DZD.
21. Verify landed-cost liability = 100.00 DZD.
22. Verify all journals balance.
23. Restart Tauri application.
24. Verify records remain.
25. Re-open Documents/Journals after restart.

## 31.4 Failure journey

Also manually exercise at least one blocked supplier return.

The UI must explain the business reason before destructive posting.

---

# Phase 23 — Toggle Acceptance

## 32.1 Journals

With toggle ON:

- Journals navigation visible to authorized user.

Turn OFF:

- viewer hidden/disabled;
- posting a procurement transaction still creates its journal.

Turn ON:

- journal created while hidden becomes visible.

## 32.2 Documents

With toggle ON:

- Documents history visible.

Turn OFF:

- central history feature hidden/disabled;
- procurement and sales posting still creates durable business documents;
- print worker behavior remains intact.

Turn ON:

- documents created while hidden become visible.

## 32.3 Restart

Both toggle values must persist after restart.

---

# Phase 24 — Forbidden Test Manipulation

The agent must not “make CI green” by:

- deleting a test;
- skipping a test with `.skip`;
- marking tests ignored;
- weakening assertions;
- broadening acceptable ranges;
- replacing exact expected money with snapshots that hide wrong values;
- updating golden expected values without proving the new values are correct;
- setting database constraints deferred/disabled only in tests to avoid the production path;
- bypassing posting functions with direct fixture inserts for the happy path being tested.

Direct fixture inserts are allowed only for deliberately creating a corruption/edge state that cannot be produced through valid application behavior, and the test must state why.

---

# Phase 25 — Diff Review Gate

Before commit, inspect:

```bash
git status --short
git diff --stat
git diff
git diff --check
```

## 34.1 Reject accidental scope

If final diff contains unrelated:

- dependency upgrades;
- global style rewrites;
- unrelated feature changes;
- mass formatting;
- old migration edits;

remove those changes before commit.

## 34.2 Search for known bad patterns

Run repository searches for at least:

```text
new Date().toISOString
parseFloat
(caught as Error)?.message
PRECONDITION_FAILED
TODO
FIXME
console.log
```

Interpret results; do not blindly require zero across the entire repo.

For procurement touched surfaces, there must be no remaining unsafe pattern relevant to this task.

---

# Phase 26 — Required Final Evidence Report

The implementing agent may not finish with:

```text
Done
Tests passed
Fixed
```

without evidence.

Final report must contain all sections below.

## 35.1 Baseline

```text
Source SHA:
Implementation branch:
Final SHA:
```

## 35.2 Root cause of original supplier-return failure

State:

```text
Observed private condition:
Why current UI reduced it to PRECONDITION_FAILED:
What changed:
Why the accounting result is correct:
```

Do not expose secret diagnostics in user-facing application UI, but the developer report may summarize the technical root cause safely.

## 35.3 Files changed

Group by:

```text
Database
Rust
IPC
React
Localization
Tests
Docs
```

## 35.4 In-scope results

For every mandatory scope item:

```text
PASS
FAIL
BLOCKED
```

No omitted rows.

## 35.5 Out-of-scope findings

List any issue deliberately not solved and why.

## 35.6 Test commands

For every command:

```text
command
exit result
important output summary
```

Do not say “all tests” without listing suites.

## 35.7 Manual acceptance

Record the exact observed values:

```text
stock
inventory value
invoice liability
landed-cost liability
document numbers
journal IDs/numbers
balanced totals
```

## 35.8 Permission verification

Record admin/manager/cashier results.

## 35.9 Toggle verification

Record ON/OFF/restart behavior.

## 35.10 Remaining risk

If anything is uncertain, say so.

Do not claim release acceptance with unresolved uncertainty.

---

# Phase 27 — Commit and Push Rules

## 36.1 No approval loop

Do not repeatedly ask the user for approval during ordinary implementation.

The implementation authorization is this plan.

## 36.2 Commit only after gates

Commit only after:

- required automated gates pass;
- diff review passes;
- no applied migration was edited;
- no unrelated files remain;
- acceptance evidence is prepared.

## 36.3 Commit message

Use a focused message such as:

```text
fix: close procurement acceptance defects
```

Use repository conventions if they require another format.

## 36.4 Push

Push only the dedicated implementation branch.

Do not merge to `main` as part of this plan unless separately instructed.

---

# 37. Definition of Done

This task is complete only when **all** statements below are true.

## Supplier return

- [ ] The originally failing supplier-return case has been reproduced and classified.
- [ ] A valid return succeeds.
- [ ] An invalid return is blocked with a safe localized business reason.
- [ ] UI no longer exposes raw backend diagnostic messages.
- [ ] Draft/preflight eligibility and confirmation rules cannot silently diverge.
- [ ] Confirmation revalidates under appropriate locks.
- [ ] Failed confirmation leaves no partial mutation.
- [ ] Return cannot exceed received quantity.
- [ ] Return cannot exceed current stock.
- [ ] Return cannot make payable negative.
- [ ] Multiple-invoice ambiguity is blocked explicitly rather than guessed.
- [ ] Idempotent retry does not duplicate effects.

## Journals

- [ ] Journals screen exists.
- [ ] Journal list is session-authorized.
- [ ] Journal detail is session-authorized.
- [ ] Debit and credit totals are shown.
- [ ] Lines are shown.
- [ ] Source is shown.
- [ ] Balance status is shown.
- [ ] Procurement journal links open the persistent viewer.
- [ ] Supplier-payment journals are included.
- [ ] Viewer is read-only.
- [ ] Toggle exists, defaults ON, persists, and never disables posting.

## Documents

- [ ] Procurement business documents appear.
- [ ] Existing sales/customer documents still appear to authorized users.
- [ ] Procurement documents do not require fake print jobs.
- [ ] Generation/print shows Not applicable where unsupported.
- [ ] Journal linkage is available where a journal exists.
- [ ] Cashier does not gain procurement visibility.
- [ ] Toggle exists, defaults ON, persists, and does not disable durable record creation.

## Cross-cutting

- [ ] Procurement posting dates use local calendar date.
- [ ] Exact decimal validation replaces float-based business decisions in touched procurement paths.
- [ ] Forms prevent duplicate submit.
- [ ] Empty/blocked states explain prerequisites.
- [ ] English/French/Arabic are complete.
- [ ] Arabic RTL is usable.
- [ ] Light and dark themes remain usable.
- [ ] Clean database tests pass.
- [ ] Existing/upgraded database tests pass.
- [ ] Concurrency tests pass.
- [ ] Frontend tests pass.
- [ ] Rust tests/checks pass.
- [ ] PostgreSQL suites pass.
- [ ] Windows/Tauri acceptance passes.
- [ ] Restart persistence passes.
- [ ] Final diff contains no unrelated work.

---

# 38. Hard Stop Conditions

The agent must stop claiming completion if any of the following is true:

- the original failure was never reproduced or its exact class remains unknown;
- the agent changed an applied migration;
- a valid return still produces generic unexplained `PRECONDITION_FAILED`;
- a blocked return can partially mutate stock/liability/journal state;
- a journal is unbalanced;
- a posted procurement record that should have a durable business document is missing;
- supplier-payment journals are not covered;
- a toggle disables posting/integrity rather than only feature visibility;
- raw SQL diagnostics reach the UI;
- float comparisons remain in the touched business-decision path;
- the local date bug remains;
- cashier gains unauthorized supplier/accounting visibility;
- upgraded database tests fail;
- manual Windows/Tauri acceptance was not run;
- expected accounting values differ and the difference is unexplained.

In these cases, report the specific blocker.

Do not replace failure with a vague success statement.

---

# 39. Final Instruction to the Implementing Agent

Execute this plan from top to bottom.

Do not optimize for speed of completion.
Optimize for correctness, auditability, deterministic behavior, and preservation of Stockiha's existing accounting invariants.

When there is an easy shortcut and a correct implementation, choose the correct implementation.

When repository evidence contradicts an assumption in this document, do not silently improvise. Record the evidence, follow the higher authority in Section 3, and keep the change as narrow as possible.

The task is not complete when the UI “looks fixed.”

The task is complete when the original failure is explained, valid business behavior works, invalid behavior is safely blocked, all durable accounting evidence is inspectable, procurement documents are visible, permissions remain correct, automated and upgraded-database gates pass, and the exact Windows/Tauri acceptance journey passes with the expected accounting values.
