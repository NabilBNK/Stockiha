---
name: ws-b-skill
description: The mandatory implementation protocol for WS-B (Financial Core) in the Stockiha desktop ERP — chart of accounts, journal and general ledger, the posting engine, AR and AP subledgers, cash and bank, weighted-average cost (WAC) inventory valuation, COGS, and period control. Use this skill whenever the task touches money, journals, posting, double-entry, debits or credits, WAC, cost of goods sold, inventory valuation, customer or supplier balances, the financial effects of cash sessions, period close, or financial reversals and adjustments — even if the user never says "WS-B". Also use it for any change to a SECURITY DEFINER function that writes financial or inventory data, any migration touching a financial table, and any code path where a monetary or quantity value crosses between PostgreSQL, Rust, and TypeScript. Do not skip this skill because the change looks small — a one-line rounding change can silently corrupt every future report.
---

# WS-B — Financial Core Implementation Protocol

You are the **heavy engineering agent** working on the accounting engine of Stockiha.

This skill layers on top of `stockiha-task-execution`. That skill governs how you work (source-of-truth order, scope discipline, git safety, result reports). **This skill governs what "correct" means for money.** When the two overlap, follow both; where this skill is stricter, this skill wins.

WS-B is the highest-consequence code in the project. A defect here does not stay here — it propagates into every purchase, sale, and report, and it propagates *silently*. The build stays green. The tests pass. The numbers are just wrong. Design every change assuming nobody will notice your mistake for six months.

---

## 0. Gate 0 — establish reality before writing anything

WS-B has **no measured baseline**. `STOCKIHA_GROUND_TRUTH.md` assigns health scores to five other areas and none to WS-B, despite marking it CRITICAL. Most of what "exists" in WS-B is asserted in documents and has never been verified against the database.

So: **never assume a WS-B component exists because a document, a task, or a previous agent said so.**

Before implementing anything, run the reality check:

1. Read every migration touching financial tables, **in applied order**. Migrations that exist in the repo but were never applied are fiction.
2. Read the actual PostgreSQL function bodies with `pg_get_functiondef`. Do not read only the `.sql` file — read what is *installed in the database*. These drift.
3. Run the queries in `references/verification-queries.sql`. They take seconds and answer questions you would otherwise guess at.
4. Identify which layer is authoritative for the change: PostgreSQL function, Rust command, or React. For anything financial the answer is **PostgreSQL**. If you find yourself about to put money logic in Rust or React, stop and reconsider.
5. Check for an existing implementation before adding a new one. Duplicate posting paths are how ledgers diverge.

State your findings explicitly at the top of your report, in the form: *verified* (you ran it and saw the result), *read but not executed* (you read the code), *assumed* (you did not check). If a claim is in the third category, it does not belong in an acceptance criterion.

---

## 1. What WS-B owns — and what it must not touch

**WS-B owns:**

| ID | Component |
|---|---|
| B-1 | Chart of accounts and control accounts |
| B-2 | Journal and general ledger |
| B-3 | The posting engine |
| B-4 | AR subledger (customer balances) |
| B-5 | AP subledger (supplier balances) |
| B-6 | Cash and bank accounts |
| B-7 | Inventory valuation (WAC) and COGS derivation |
| B-8 | Period control, posting locks, immutability, reversals |

**WS-B must NOT contain:**

- **TVA / tax accounting** — deferred scope. Do not implement tax. Do not add tax rates, tax accounts, or tax computation. You *may* shape journal lines so tax can be added later without altering posted rows (see §5.5), but that is the limit.
- **Payroll, contracts, commissions** — deferred entirely.
- **Financial reports, trial balance, statements, dashboards** — that is WS-I, and it comes after pillar stabilization. WS-B produces correct data; WS-I displays it. Building a report inside a WS-B task is scope creep.
- **Audit / change logging** — that is WS-L, deliberately late.
- **Historical opening-balance import** — that is WS-G, and it must remain isolated from live ledgers.

If a brief asks you to build any of the above under a WS-B heading, stop and escalate (§12).

---

## 2. Component correctness contracts

For each component, this is the standard you are implementing against. Not "it works" — this.

### B-1 Chart of accounts
Accounts have a type (asset, liability, equity, revenue, expense) that determines their natural balance. Control accounts — Inventory, AR, AP, Cash — are the accounts that must reconcile to their subledgers. Control accounts must be posted to **only** by the posting engine, never by ad-hoc entries, or reconciliation becomes impossible.

### B-2 Journal and general ledger
An entry is a header plus two or more lines. The lines must sum to zero. This must be **structurally guaranteed** — by a constraint, a trigger, or a posting function that is the only write path — not by application convention. If a developer can `INSERT` an unbalanced entry with plain SQL, B-2 is not implemented, regardless of what the application does.

Posted entries are append-only. See B-8.

### B-3 Posting engine
One business event produces one atomic posting. "Atomic" means: journal lines, stock movements, subledger effects, and document status all commit together or none of them do. There is no valid state where stock moved but the journal did not.

Every posting function is subject to the contract in §4.

### B-4 / B-5 AR and AP subledgers
The sum of all customer balances must equal the AR control account balance in the general ledger. Same for suppliers and AP. This reconciliation is a **test you can run**, not an aspiration. If it cannot be run, the subledger design is wrong.

### B-6 Cash and bank
Cash movements post to cash accounts through the posting engine like everything else. Cash-session opening and closing counts are WS-F's concern; the *financial effect* of a session — the cash account balance and any variance entry — is WS-B's. A blind-count variance must produce an explicit journal entry, not a silent adjustment of the cash balance.

### B-7 WAC and COGS
**WAC = weighted average cost.** On receipt of goods, the new average is:

```
new_wac = (existing_qty * existing_wac + received_qty * received_unit_cost)
          / (existing_qty + received_qty)
```

Rules that are easy to get wrong and expensive to get wrong:

- Recalculate WAC on **receipt**, not on order. An unreceived purchase changes nothing.
- Landed costs (freight, duty) that are allocated to a receipt participate in `received_unit_cost`. If landed cost allocation is disabled, WAC is understated and every margin figure is wrong. Confirm the current state rather than assuming — this feature has been disabled in this codebase before (§9).
- COGS on a sale is `qty_sold * wac_at_time_of_sale`. Capture the WAC used **on the movement row**. Do not recompute COGS later from the current WAC — the current WAC will have moved and history will not reproduce.
- Sale does not change WAC. Only receipts and cost adjustments do.
- Division: guard `existing_qty + received_qty = 0`. Never let a zero-quantity state produce a division error or a silently reset cost.
- Returns and reversals must reverse the cost effect using the **original** captured cost, not the current WAC.

### B-8 Period control and immutability
Posted rows are immutable at the **database** level — enforced by trigger, rule, or revoked privileges. Application-level discipline is not immutability.

Corrections happen exactly one way: a new, linked, balanced counter-entry that references the original. Never `UPDATE`. Never `DELETE`. Never "fix" a posted row.

Period locks prevent posting into a closed period. If period control does not exist yet, that is a *known gap to report*, not something to invent mid-task.

---

## 3. Hard invariants

Violating any of these is a failed task even if the feature appears to work.

- **No floating point.** Not `f32`, not `f64`, not `double precision`, not `real` — for money, tax, quantity, cost, WAC, inventory value, or journal amounts. Use `rust_decimal` and PostgreSQL `numeric`. This includes intermediate calculations and test fixtures.
- **Journals balance to zero.** Always. Structurally.
- **Posted ledgers and confirmed documents are immutable.**
- **Confirmed negative stock is forbidden at the database constraint level.**
- **Financial operations are atomic and idempotent.**
- **React is never authoritative.** It displays and orchestrates. It never decides an amount, a cost, a balance, or a permission.
- **Rust is a thin typed adapter.** Validation boundary and OS bridge. Not the place for accounting logic.
- **Authorization lives at the `SECURITY DEFINER` boundary.** Hiding a button is not authorization.
- **Never weaken a DB role, grant, posting function, or `SECURITY DEFINER` boundary to make something pass.** If a grant is missing, that is a finding, not an obstacle to remove.
- **Never log or expose** passwords, PINs, tokens, hashes, or credentials — including in error messages and in your own result report.
- **Printing failure never rolls back a confirmed document.**
- **Historical imports never silently touch live ledgers.**

---

## 4. The posting function contract

Every `SECURITY DEFINER` function that writes financial or inventory data must satisfy all seven. Walk this list explicitly for each function you write or modify, and state the result in your report.

1. **Authenticate.** Resolve and validate the session. Reject expired or unknown sessions.
2. **Authorize.** Check the specific permission required for this operation, *inside the function*. `SECURITY DEFINER` runs with the owner's privileges — if the function does not check, the caller is effectively unrestricted. This is the single most dangerous omission in WS-B.
3. **Validate inputs.** Positive quantities where required, existing references, permitted document state, no posting into a locked period.
4. **Enforce idempotency.** See §6.
5. **Do the work atomically.** Journal lines, movements, subledger effects, document state — one transaction.
6. **Assert the invariant before returning.** The function should verify its own journal balances to zero and raise if not. A function that can emit an unbalanced entry is broken even if it never has.
7. **Return a typed result**, not a bare boolean. The caller needs the entry id to link reversals later.

Also: set an explicit, minimal `search_path` on every `SECURITY DEFINER` function. A mutable `search_path` on an elevated-privilege function is a privilege-escalation vector.

---

## 5. Numeric discipline

### 5.1 Types
PostgreSQL `numeric` with explicit precision and scale. Rust `rust_decimal::Decimal`. No implicit conversion through `f64` anywhere in the chain — including in serialization libraries, test helpers, and CSV or XLSX parsing.

### 5.2 Scale
Money uses the application's currency scale. **Confirm the configured scale from the schema rather than assuming two decimal places.** Cost and WAC need *more* scale than money — a unit cost rounded to currency scale accumulates visible error across thousands of units. A common shape is money at scale 2 and WAC at scale 6, but verify what this codebase actually uses before matching it.

### 5.3 Rounding
Round once, at the boundary where a value becomes a posted amount — never repeatedly through a calculation. State the rounding mode explicitly in the code. When rounding creates a residual that would unbalance an entry, that residual must be posted to a designated account, never silently dropped. A dropped residual is an unbalanced journal.

### 5.4 The Rust → TypeScript boundary
This is the most likely place for silent corruption. **JavaScript has exactly one number type: a 64-bit float.** A `numeric` value serialized as a JSON number becomes a float the moment it reaches React.

Therefore: serialize monetary and quantity values across the IPC boundary as **strings**, and parse them as decimals on the way back. Display formatting in React is fine. Arithmetic in React on a value that will be sent back to the backend is not — recompute authoritatively in PostgreSQL instead.

If you find money crossing as a JSON number, report it as a defect. Do not quietly "fix" it as a side change in an unrelated task — that alters serialized contracts and can break other screens.

### 5.5 Tax shape (do not implement)
Tax is deferred. Do not build it. When designing new journal-line structures, simply avoid choices that would force editing posted rows to add tax later — for example, do not make a line's amount the only place the gross figure can be derived from. That is the whole obligation. Anything more is out of scope.

---

## 6. Idempotency

**Idempotent** means: submitting the same operation twice produces one effect, not two.

This matters more than it sounds. Retries happen — a double-clicked button, a dropped IPC response, a startup failure that leaves the client resubmitting. Without idempotency the result is a duplicated sale, duplicated stock movement, and duplicated revenue, discovered weeks later.

Implement it as: the caller supplies a request key; the key is stored with a **unique constraint**; a repeated key returns the original result rather than posting again.

The unique constraint is the mechanism. A `SELECT` to check whether the key exists, followed by an `INSERT`, is not idempotency — two concurrent calls both see nothing and both insert. Let the database reject the duplicate and handle the conflict.

---

## 7. Corrections and reversals

There is exactly one correction pattern:

```
Original entry  →  stays exactly as posted, forever
Reversal entry  →  new entry, mirrored debits and credits,
                   linked to the original by id,
                   dated in an open period,
                   balancing to zero on its own
```

Reversing must also reverse the *cost* effect using the cost captured on the original movement — not the current WAC.

Never add an "edit posted entry" path, an admin override that mutates history, or a soft-delete flag that hides a posted entry from reports. If a brief asks for one, escalate (§12).

---

## 8. Migrations on financial schema

- Forward-only. Never edit a migration that has already been applied.
- Never drop or rename a column holding posted financial data without an explicit, approved data-migration plan.
- Adding a `NOT NULL` column to a table with posted rows requires a backfill decision that is an accounting decision, not a technical one — escalate rather than picking a default.
- After any migration touching financial tables, re-check role grants. Grant drift has already occurred in this project (§9): a table can exist, the code can be correct, and the runtime role can still lack the privilege to write to it. That failure only appears at runtime, mid-transaction.
- Constraints that enforce an invariant (balance, non-negative stock) belong in the migration, not in application code.

---

## 9. Known failure patterns in this codebase

These have actually happened here. Look for them specifically.

**Disguised kill switches.** Landed cost was disabled in five separate locations, **two of them camouflaged as legitimate runtime conditions** — a plausible-looking guard clause that can never be true. A feature can look fully implemented and be completely inert. When verifying that a costing or posting path works, trace it to an observed effect in the database. Reading the code is not enough.

**Grant drift.** The `stockiha_runtime` role was found lacking DML privileges on IAM tables. Assume the same class of problem may exist on financial tables until you have checked `information_schema.role_table_grants`.

**`SECURITY DEFINER` without an authorization check.** Known to exist on the IAM side; unverified on the financial side. Treat every elevated function as unauthorized until you have read its body and seen the check.

**Function ownership drift.** A `SECURITY DEFINER` function runs as its owner. If ownership has drifted, the effective privileges are not what the design assumed. Check `pg_get_userbyid(proowner)`.

**Documents describing features that do not exist.** The project's own ground-truth documents were partly synthesized from roadmap prose. Repository and database evidence override document assertions, always.

---

## 10. Definition of Done

A WS-B task is complete only when every applicable item holds — and you can show the evidence.

1. Journal balance query returns **zero** unbalanced entries.
2. Zero `double precision` or `real` columns in any money, quantity, cost, or valuation column.
3. Every touched `SECURITY DEFINER` function validates session **and** permission before writing.
4. The same operation submitted twice with the same request key produces one effect. Demonstrated, not asserted.
5. AR subledger total equals the GL AR control account balance.
6. AP subledger total equals the GL AP control account balance.
7. Inventory valuation reconciles to the inventory control account balance.
8. `UPDATE` and `DELETE` on a posted journal row are rejected **by the database**.
9. Corrections produce linked, balanced reversals; originals are untouched.
10. **The worked example below reproduces exactly.**

### The worked example — run this, with these numbers

Any change touching B-3 or B-7 must reproduce this. Not "tests pass" — these figures.

| Step | Action | Qty after | WAC after | Inventory value | Journal effect |
|---|---|---:|---:|---:|---|
| 1 | Receive 10 @ 100 | 10 | 100 | 1,000 | Dr Inventory 1,000 / Cr AP 1,000 |
| 2 | Receive 10 @ 120 | 20 | **110** | 2,200 | Dr Inventory 1,200 / Cr AP 1,200 |
| 3 | Sell 5 @ 200 | 15 | 110 | **1,650** | Dr Cash 1,000 / Cr Sales 1,000 **and** Dr COGS 550 / Cr Inventory 550 |

Checks that must all hold at the end:

- WAC after step 2 is exactly **110** — `(10×100 + 10×120) / 20`.
- COGS on the sale is exactly **550** — `5 × 110`.
- Gross profit is exactly **450** — `1,000 − 550`.
- Inventory control account balance is exactly **1,650** — `2,200 − 550` — and equals `15 × 110`.
- Every entry balances to zero.
- Selling did not change WAC.

If any figure differs, the implementation is wrong even if every automated test is green. Report the actual numbers you observed, not the expected ones.

---

## 11. Verification

Run what applies to what you changed. Report **real output**. Never claim a pass you did not see.

```bash
# Frontend
npm run typecheck
npm run lint
npm test
npm run build

# Rust
cargo fmt --check
cargo check
cargo clippy --all-targets --all-features -- -D warnings
cargo test
```

Then run the SQL checks in `references/verification-queries.sql` and include the results verbatim.

For anything touching posting, also run integration, migration, concurrency, and rollback tests.

**Never claim Windows behavior from Linux.** WebView2, Credential Manager, installers, the print spooler, physical ESC/POS output, Arabic thermal rendering, and cash-drawer actuation require Windows manual acceptance. List those as *pending manual checks*, not as passing.

Separate three things in your report and never blur them: **verified** (evidence seen), **expected to work** (reasoning, no evidence), **needs manual check** (assigned to the human).

---

## 12. Stop conditions

Fix ordinary implementation problems yourself. Stop and escalate to the Lead Architect only for:

- An accounting-correctness question with no obviously right answer — which account, which side, how to treat a residual, how to date a correction.
- A rounding or precision policy decision that changes posted amounts.
- An authorization boundary decision.
- A request to mutate posted history, add an edit-posted path, or soft-delete a posted entry.
- A missing grant, role, or privilege — report it, never grant it yourself.
- A migration with data-loss risk, or a backfill whose default is an accounting judgement.
- A brief that asks for deferred scope: TVA/tax, payroll, product images, advanced procurement, WS-I reporting, WS-L audit trail.
- A brief that conflicts with §3.
- Discovery that an existing posted ledger is already wrong. **Do not silently correct historical data.** Report the scope of the discrepancy and stop.

When you stop: state the blocker, what you already verified, and two or three options with your recommendation. Do not guess and proceed.

---

## 13. Result report

Write for a reviewer, not a beginner. The Lead Architect reads it.

```
## What changed
File-level summary of the diff.

## Evidence classification
Verified / Read but not executed / Assumed — for each significant claim.

## Posting contract walkthrough
For each SECURITY DEFINER function touched: all seven points of §4, pass or fail.

## Worked example result
The actual numbers observed at each step of §10. Actual, not expected.

## Verification output
Real command output. Real SQL results, verbatim.

## Invariants
Each applicable invariant from §3: how it is enforced now, and where.

## Not finished / could not verify
Each item paired with the evidence that would resolve it.

## Unrelated problems found
Reported, NOT fixed. Include file paths.

## Pending Windows/manual checks
Assigned to the human, with exact steps and exact expected results.
```

Be honest about partial completion. "Three of four criteria met, here is the blocker on the fourth" is far more useful than a false green — and in WS-B, a false green is the most expensive thing you can produce.
