# WS-A Security Boundary & User Administration Audit

**Date:** 2026-08-22 → 2026-08-23
**Branch:** `task/workspace-init`
**Base commit:** `de58e03`
**Runtime:** Windows 10 Pro 19045 · PostgreSQL 18 on `127.0.0.1:5433` · Tauri v2.11.5 · React 19 · sqlx 0.8.6
**Scope:** WS-A (authentication, sessions, users, roles, permissions, database authorization) with a mechanical sweep of immutability, exact-numeric handling, concurrency, idempotency, accounting integrity, tax representation, and migration state.

Every claim below is backed by a command that was actually executed against the local
working tree or a local PostgreSQL 18 database. Where something could not be
established it is labelled **UNKNOWN — NOT VERIFIED**. Where `report.md`
(2026-08-22) is contradicted by local evidence it is labelled
**REPORT CORRECTION**.

---

## 1. Executive summary

The WS-A security boundary is **substantially stronger than `report.md` assumed**, and
the report's single "confirmed" product gap was already largely closed in
uncommitted working-tree code that the report did not see. The mechanical audit
returned clean results on every item the report listed as an open verification
target: zero unpinned `SECURITY DEFINER` functions out of 181, zero floating-point
columns, zero unconstrained `numeric` columns, zero `f32`/`f64` in Rust, zero
failed migrations, a balanced trial balance, and an application database role with
no DML on any journal, ledger, inventory, sales, or IAM table.

Four genuine WS-A defects were found and fixed, two of which were security
defects:

* a **privilege-escalation path** — `iam.create_user` accepted `SUPER_ADMIN`
  without the hierarchy check its sibling `iam.assign_user_role` enforced;
* a **permanent-lockout path** — a lone administrator could demote itself (or have
  its role's `MANAGE_USERS` revoked) and strand the installation with no recovery,
  because `core.bootstrap_first_admin` refuses to run once any user exists;
* `iam.list_users` duplicated users that hold more than one role;
* every IAM exception was raised untyped (`P0001`), forcing the Rust IPC boundary
  to classify failures by substring-matching database messages.

Two blockers that had nothing to do with the security model were also removed: the
branch did not compile the frontend at all (`npm run build` failed on three
pre-existing TypeScript errors), and the acceptance database was in a wedged state
that made login impossible.

The user-and-role administration flow was then driven **through the real Tauri
window** — first-run setup, sign-in, role creation, permission assignment, user
creation, and a negative lockout test — and separately attacked by invoking every
privileged IPC command directly with a genuine low-privilege session token. All
eight privileged commands were refused by PostgreSQL.

**WS-A verdict: READY FOR MANUAL ACCEPTANCE**, with two escalations for the Lead
Architect: `SUPER_ADMIN` is unreachable through every sanctioned path, and there is
no administrator recovery procedure.

A follow-up task then closed the one High-severity defect this audit found outside
WS-A: the oversell race in `sales.confirm_cash_sale` (F-POS-001) was empirically
reproduced — one unit of stock sold twice, two ISSUE movements, two sale lines —
and fixed by migration `20260823090000_sales_cash_sale_position_lock.sql`. See §8.

---

## 2. Repository state

```
git branch --show-current   → task/workspace-init
git log -1 --oneline        → de58e03 chore: initialize Stockiha workspace files
```

Counts from the current checkout:

| Item | Count |
|---|---|
| SQLx migrations (`src-tauri/migrations/*.sql`) | 119 (117 pre-existing + 2 added: WS-A hardening, cash-sale position lock) |
| Rust source files | 97 |
| TypeScript / TSX files | 101 |
| `#[tauri::command]` definitions | 141 |
| Occurrences of `f32`/`f64` in `src-tauri/src` | 3 — **all inside comments**, zero in code |

A substantial, uncommitted WS-A implementation was already present in the working
tree before this audit started: `src-tauri/migrations/20260821210000_iam_user_and_role_administration.sql`,
`20260822153600_iam_list_roles.sql`, `src-tauri/src/application/iam.rs`,
`src-tauri/src/commands/iam.rs`, `src/features/settings/UserManagementSettingsScreen.tsx`,
`src/shared/ipc/iamDto.ts`, and `src/shared/ipc/iamGateway.ts`.

---

## 3. Database state

Databases on port 5433 relevant to this audit:

| Database | Role in this audit |
|---|---|
| `stockiha_acceptance` | the database `run.bat` uses; audited, migrated, **wedged** (see F-ENV-001) |
| `stockiha_iam_test` | disposable, recreated from scratch by `scripts/provision-iam-test.ps1`; Rust integration tests |
| `stockiha_wsa_acceptance` | created clean for this audit; native Tauri UI acceptance |

`stockiha_acceptance` after this audit's migration:

```
SELECT count(*) FILTER (WHERE NOT success), count(*) FROM _sqlx_migrations;
→ 0 | 118
```

Schema inventory (`stockiha_acceptance`): `cash` 9 tables / 8 functions ·
`catalog` 9/28 · `core` 5/10 · `documents` 2/17 · `finance` 5/9 · `iam` 6/10 ·
`inventory` 6/18 · `onboarding` 14/32 · `operations` 4/7 · `procurement` 14/26 ·
`public` 1/0 · `receivables` 9/25 · `sales` 5/22.

---

## 4. Findings

| ID | Finding | Severity | Status | Evidence | Root cause | Fixed? |
|---|---|---|---|---|---|---|
| F-WSA-101 | `iam.create_user` accepted `SUPER_ADMIN` with no hierarchy check, so any `MANAGE_USERS` holder could mint a `SUPER_ADMIN` account | **High** (privilege escalation) | Fixed | function body of `iam.create_user` in `20260821210000_…sql`; regression test `iam_admin_safety_guards` | the guard was added to `assign_user_role` only | Yes |
| F-WSA-102 | The last active administrator could be stripped of `MANAGE_USERS` (self-demotion, or revoking the permission from its role), permanently stranding the installation | **High** (availability / unrecoverable) | Fixed | `iam.assign_user_role` had no self-check; `core.bootstrap_first_admin` raises `55000` once `iam.users` is non-empty | no "final administrator" predicate existed anywhere | Yes |
| F-WSA-103 | `iam.list_users` returned N rows for a user holding N roles | Medium | Fixed | `stockiha_acceptance` user id 16 holds `{ADMIN,MANAGER}`; the old body inner-joined `iam.user_roles` without aggregating | inner join, no `GROUP BY` | Yes |
| F-WSA-104 | Every IAM exception was raised without `ERRCODE`, landing on `P0001`; the Rust boundary had to substring-match database messages to classify them | Medium (fragile contract) | Fixed | `map_iam_error` in `src-tauri/src/application/iam.rs` matched 13 literal message fragments | untyped `RAISE EXCEPTION` throughout the WS-A-1 migration | Yes |
| F-WSA-105 | Debug scaffolding shipped in the IAM read paths: `list_users`/`list_roles` each ran a diagnostic query, printed host/port/database/user to stdout, and wrote `src-tauri/diagnostic.txt` on every call | Medium (information disclosure, side effects in a read path) | Fixed | `src-tauri/diagnostic.txt` was present and contained a live connection profile | left over from a debugging session | Yes |
| F-WSA-106 | `cargo test` could not compile: an `iam.rs` test referenced an unimported `db` module, and a non-`#[ignore]` test panicked whenever no database was configured | Medium | Fixed | `diagnostic_connection_proof` in `iam.rs` | same debugging session | Yes |
| F-WSA-107 | IAM integration tests seeded fixtures with direct `INSERT INTO iam.users`, which `stockiha_runtime` has no privilege to do — the tests could never pass | Medium (false-confidence tests) | Fixed | `permission denied for table users` (SQLSTATE 42501) on first run | fixture bypassed the sanctioned path | Yes |
| F-WSA-108 | No operational role-administration UI: role creation and permission assignment had backend commands but no frontend surface | High for WS-A completion | Fixed | `UserManagementSettingsScreen.tsx` before this change had no role card | not yet implemented | Yes |
| F-BUILD-001 | `npm run build` failed — three pre-existing TypeScript errors on `HEAD` (`inventory.sku_barcode` missing i18n key; unused `visibleVariants`; `SAFE_MESSAGES` missing `INSUFFICIENT_STOCK`/`CORRECTIONS_DISABLED`). `run.bat` calls `npm run build`, so the app could not be built or launched at all | **High** (blocks all acceptance) | Fixed | `tsc -b` output before the fix | introduced by commits `ae591fc` / `86908f5` | Yes |
| F-ENV-001 | `stockiha_acceptance` has `core.system_state.initialized = false` while `iam.users` holds 6 residue test users. The app routes to the first-run setup screen, and `core.bootstrap_first_admin` then refuses with `55000 system is already initialized`. **Login is impossible in that database.** | **High** (blocks acceptance) | Confirmed — **not** remediated, see §9 | `SELECT * FROM core.system_state` → `initialized=f`; 6 users named `s2adj_conc_admin_*`, `s2003_conc_user` | integration tests wrote users into a non-`_test` database | No — needs your approval |
| F-POS-001 | `sales.confirm_cash_sale` read `inventory.positions` **without `FOR UPDATE`**, checked sufficiency, then wrote an absolute `quantity_on_hand`. Two concurrent cash sales of the last unit both succeeded (lost update); the `positions_quantity_non_negative` CHECK did not catch it because the stored value never goes negative | **High** (oversell) | **Reproduced, then Fixed** — see §8 | against the unfixed function: 1 unit received, **2** ISSUE movements, **2** sale lines, 2 units sold | missing row lock — it was the only one of 8 `inventory.positions` writers without one | Yes — migration `20260823090000_sales_cash_sale_position_lock.sql` |
| F-RCV-001 | `CustomersScreen.tsx:513` sends `amount: paymentTotal`, a JS floating-point sum over *all* `allocationAmounts` entries, while `allocations` carries only entries passing `MONEY_RE`. A divergence is possible | Low | Confirmed | `src/features/customers/CustomersScreen.tsx:321-333, 499-513` | frontend sums instead of letting the backend derive | No — out of scope; **the database rejects any divergence**, see §7 |
| F-OPS-001 | `core.request_idempotency` has no retention or cleanup path; it grows without bound | Low | Confirmed | no cleanup function references the table | not yet designed | No — reported |

---

## 5. REPORT CORRECTIONS

Each item below was listed in `report.md` as *pending verification* or *unknown*
and is now settled by local evidence.

### 5.1 `SECURITY DEFINER` / `search_path` — REPORT CORRECTION: clean

```sql
SELECT COALESCE(array_to_string(p.proconfig,', '),'UNPINNED'), count(*)
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE p.prosecdef AND n.nspname NOT IN ('pg_catalog','information_schema')
GROUP BY 1;
```

```
search_path=pg_catalog          | 180
search_path=pg_catalog, pg_temp |   1
```

**Zero** unpinned functions. Every one of the 181 `SECURITY DEFINER` functions pins
`search_path`, and they reference objects schema-qualified (`iam.users`,
`inventory.positions`, …) rather than relying on resolution. Re-verified after this
audit's migration: still 0 unpinned.

### 5.2 Database roles — REPORT CORRECTION: least privilege confirmed

```
rolname            super createdb createrole bypassrls canlogin inherit
stockiha_admin      t     t        t          t         t        t
stockiha_backup     f     f        f          f         t        f
stockiha_migrator   f     f        f          f         t        f
stockiha_owner      f     f        f          f         f        f
stockiha_runtime    f     f        f          f         t        f
```

Memberships: only `stockiha_migrator → {stockiha_owner}`. The application role
`stockiha_runtime` is **not** a superuser, cannot create roles, cannot bypass RLS,
does not inherit, and is **not** a member of `stockiha_owner`.

### 5.3 Direct table DML by the application role — REPORT CORRECTION: architecture confirmed

```sql
SELECT table_schema||'.'||table_name, string_agg(privilege_type,',')
FROM information_schema.table_privileges
WHERE grantee='stockiha_runtime'
  AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE')
GROUP BY 1;
```

```
iam.application_sessions            | INSERT,UPDATE
procurement.purchase_order_lines    | DELETE,INSERT,UPDATE
procurement.purchase_orders         | INSERT,UPDATE
procurement.purchase_receipt_lines  | INSERT
procurement.purchase_receipts       | INSERT
procurement.suppliers               | INSERT,UPDATE
```

`stockiha_runtime` has **no** `INSERT`/`UPDATE`/`DELETE`/`TRUNCATE` on any journal,
ledger, inventory-movement, stock-balance, sales, `iam.users`, `iam.roles`,
`iam.permissions`, `iam.user_roles`, or `iam.role_permissions` table. On the `iam`
schema it holds `SELECT` everywhere plus `INSERT`/`UPDATE` on
`iam.application_sessions` only — the minimum login needs. `PUBLIC` holds **no**
table privileges anywhere. The architecture is genuinely
`application → EXECUTE-only functions` for everything financial, inventory, and
identity-related; the `procurement` grants are draft-document tables and are the
one intentional exception.

### 5.4 Floating-point and numeric precision — REPORT CORRECTION: clean

* Columns of type `double precision` / `real` outside system schemas: **0**.
* `numeric` columns with `numeric_precision IS NULL`: **0**.
* `f32`/`f64` in `src-tauri/src`: **0 in code** (3 comment mentions).

Representative money/quantity precision, `inventory.positions`:
`quantity_on_hand numeric(18,3)`, `total_value numeric(18,4)`,
`last_known_wac numeric(18,6)`. `finance.journal_lines.debit`/`.credit` are
`numeric(14,2)`.

### 5.5 Immutability — REPORT CORRECTION: enforced by triggers, comprehensively

93 `UPDATE`/`DELETE` triggers exist. Explicit `forbid_update` / `forbid_delete` /
`forbid_posted_*` / `forbid_mutation` triggers cover: `cash.movements`,
`cash.cash_session_events`, `cash.session_close_*`, `core.business_documents`,
`finance.journal_entries`, `finance.journal_lines`, `inventory.movements`,
`inventory.residual_clearances`, `inventory.stock_adjustments`,
`onboarding.opening_state_application*`, `procurement.purchase_receipts`,
`procurement.purchase_receipt_lines`, `procurement.supplier_liabilities`,
`procurement.supplier_returns`, `receivables.customer_ledger_entries`,
`receivables.customer_payments`, `receivables.customer_payment_refunds`,
`receivables.payment_allocations`, `receivables.payment_refund_allocations`,
`sales.cash_sales`, `sales.cash_sale_lines`, `sales.credit_sales`,
`sales.credit_sale_lines`, `sales.cash_sessions`. `finance.journal_lines` also
carries a `journal_lines_check_balance` trigger on `UPDATE`/`DELETE`.

Combined with §5.3 (no DML grant at all on those tables), posted history is
protected by two independent mechanisms.

### 5.6 Accounting integrity — REPORT CORRECTION: balanced

```sql
SELECT document_id, SUM(debit)-SUM(credit) FROM finance.journal_lines
GROUP BY document_id HAVING SUM(debit) <> SUM(credit);
→ (0 rows)

SELECT SUM(debit)-SUM(credit), count(*) FROM finance.journal_lines;
→ global_imbalance = 0.00 | lines = 10
```

No per-document imbalance, global imbalance exactly `0.00`. The dataset is small
(10 lines) so this proves the invariant holds for the data present, not that it
holds under all future postings.

### 5.7 Negative stock — REPORT CORRECTION: constraint present

`inventory.positions` constraints include
`positions_quantity_non_negative CHECK (quantity_on_hand >= 0)`,
`positions_value_non_negative`, `positions_wac_non_negative`,
`positions_zero_quantity_zero_value CHECK (quantity_on_hand > 0 OR total_value = 0)`,
and `positions_scope_unique UNIQUE (warehouse_id, variant_id)`.
Live check: `SELECT count(*) FROM inventory.positions WHERE quantity_on_hand < 0` → **0**.

Important qualification: this CHECK is **not** a backstop against the lost-update
race in F-POS-001, because in that race the stored value never becomes negative.

### 5.8 Idempotency — REPORT CORRECTION: present and correctly shaped

`core.request_idempotency`, primary key `(operation_key, request_id)`, FK
`result_document_id → core.business_documents(id)`, `CHECK (btrim(operation_key) <> '')`.
`core.reserve_idempotent_request` claims by `INSERT` first, and on
`unique_violation` re-reads `FOR UPDATE` and then: returns the stored
`result_document_id` on replay; raises `23505` if the canonical payload hash
differs; raises `55000` if the original request is still in flight. That is the
desired "same key → same logical operation → no duplicate mutation → stable
result" behaviour. Retention/cleanup: none — F-OPS-001.

### 5.9 Argon2 — REPORT CORRECTION: recorded

`src-tauri/src/application/auth.rs` uses `Argon2::default()` for both hashing and
verification. The parameters are visible in a hash produced through the live UI:

```
$argon2id$v=19$m=19456,t=2,p=1$…
```

Argon2id, version 19, memory 19456 KiB, 2 iterations, parallelism 1 — the
`argon2` crate default, which tracks the current OWASP recommendation. Password
verification happens in Rust; the raw password never reaches SQL
(`application/setup.rs` and `application/iam.rs` both hash before binding).

### 5.10 Migration integrity — REPORT CORRECTION: no drift

Repository migrations: 118. `_sqlx_migrations` in `stockiha_acceptance`: 118 rows,
0 unsuccessful. The new migration was verified twice: applied **from scratch** on a
recreated `stockiha_iam_test` and `stockiha_wsa_acceptance`, and applied
**incrementally** to `stockiha_acceptance`, which already contained real data
including the multi-role user that F-WSA-103 was about. No historical migration was
edited.

### 5.11 Historical `product_name` error — REPORT CORRECTION: not reproducible, not a current bug

`column "product_name" does not exist` could not be reproduced and there is no
stale reference. `onboarding.historical_trade_lines.product_name` is a real,
current column, and 14 functions reference the identifier legitimately
(`catalog._effective_variant_name`, `catalog.create_product_with_variant`,
`catalog.resolve_barcode`, `documents.get_business_document_detail`,
`inventory.list_inventory_snapshot`, `procurement.post_purchase_transaction`, …).
`cargo test` (258 tests) and the full frontend suite ran with no such error, and
the live app performed catalog/settings reads with no such error.
**Status: historical, fixed, not current.**

### 5.12 Tax / TVA — REPORT CORRECTION: partially represented, deliberately deferred

```
procurement.purchase_transaction_lines.tax_amount  numeric
procurement.purchase_transactions.tax_amount       numeric
procurement.suppliers.tax_id                       text
receivables.customers.tax_id                       text
receivables.customer_payments.customer_tax_id_snapshot text
sales.credit_sales.customer_tax_id_snapshot        text
```

There are amount columns on the purchase side and party tax identifiers, but **no
tax rate model, no tax on sale lines, and no tax accounts in journal posting**.
Future TVA support is therefore a schema *and* posting migration on the sales side,
not merely a rate configuration. This matches the deferral recorded in
`STOCKIHA_GROUND_TRUTH.md`; nothing was changed here.

### 5.13 The "missing User Management UI" — REPORT CORRECTION: partly stale

`report.md` finding F-WSA-001 states the application "does not expose the
operational User Management UI". At the time of this audit the working tree already
contained `src/features/settings/UserManagementSettingsScreen.tsx`, wired into
`src/app/AppRouter.tsx` under `view === 'settings'`, with list/create/activate/
deactivate/assign-role, all eight IPC commands registered in `src-tauri/src/lib.rs`,
and the database functions applied to `stockiha_acceptance`.

What was genuinely missing was **role administration** (F-WSA-108) — no way to
create a role or set its permissions — and the flow was unreachable in practice
because of F-BUILD-001 (the app could not be built) and F-ENV-001 (no login was
possible in `stockiha_acceptance`). The report's *symptom* was real; its *diagnosis*
was not.

### 5.14 Existing sessions after a role or permission change — REPORT CORRECTION: immediate

`iam.resolve_session_with_permission` re-resolves the permission on **every call**
from `iam.user_roles → iam.role_permissions → iam.permissions`, and re-checks
`iam.users.is_active`, `revoked_at IS NULL`, and `expires_at > now()`. There is no
cached permission set anywhere in the database or in Rust. A role change therefore
takes effect on the very next privileged call with no re-login.

Proven in `iam_admin_safety_guards`: after `assign_user_role` demotes a peer
administrator to `CASHIER`, that peer's **existing, unrevoked** session token
immediately returns `PermissionDenied` from `list_users`.

Deactivation is stronger still — `iam.set_user_active` also revokes every live
session for the target in the same transaction.

---

## 6. The caller-identity model (traced end to end)

```
React                     UserManagementSettingsScreen.tsx
                          holds sessionToken in React state only
                            (verified: absent from localStorage and sessionStorage)
   │  invoke('create_user', { sessionToken, username, password, displayName, roleCode })
   ▼
Tauri IPC                 src-tauri/src/commands/iam.rs — thin adapter, no logic
   │
   ▼
Rust                      src-tauri/src/application/iam.rs
                          hashes the password with Argon2id (m=19456,t=2,p=1)
                          binds the raw token as a parameter; never logs it
   │
   ▼
PostgreSQL connection     role stockiha_runtime
                          EXECUTE on iam.* functions; SELECT-only on iam tables
   │
   ▼
session identity          iam.resolve_session_with_permission(p_token, 'MANAGE_USERS')
                          SECURITY DEFINER, SET search_path = pg_catalog
                          WHERE token_hash = sha256(p_token::bytea)
                            AND revoked_at IS NULL
                            AND expires_at > now()
                            AND u.is_active
                          not found → RAISE 28000
   │
   ▼
permission check          EXISTS (user_roles ⋈ role_permissions ⋈ permissions
                                  WHERE user_id = resolved AND code = required)
                          false → RAISE 42501
                          then set_config('stockiha.actor_user_id', …, true)
   │
   ▼
SECURITY DEFINER function iam.create_user / list_users / set_user_active /
                          assign_user_role / create_role / list_permissions /
                          list_roles / set_role_permissions
   │
   ▼
protected tables          iam.users, iam.user_roles, iam.roles,
                          iam.role_permissions — writable only as the function
                          owner (stockiha_owner), never by stockiha_runtime
```

Identity is an opaque 64-hex-character CSPRNG token, stored only as a SHA-256
digest, resolved server-side. It cannot be forged (no client-supplied user id
anywhere in the chain), cannot be stale (expiry, revocation, and `is_active` are
re-checked per call), and cannot be omitted (the token is a required parameter and
absence resolves to `28000`).

**Residual observation:** the actor identity GUCs are set with
`set_config(..., true)` — transaction-local. Each `SELECT iam.f(...)` from sqlx runs
in its own implicit transaction, so the GUC is visible only inside the function
that set it. That is sufficient for the permission check (which happens in the same
call) but means the GUCs are **not** a cross-statement audit channel. No defect;
noted so it is not mistaken for one later.

---

## 7. Exact-numeric classification (TypeScript)

24 `parseFloat(` and 7 `.toFixed(` sites were examined and classified.

| Class | Meaning | Count | Verdict |
|---|---|---|---|
| A — display only | formats a backend-computed value, or a clearly labelled provisional preview | 30 | acceptable |
| B — round-trip | a JS number crosses back to the backend | 1 | documented risk |
| C — authoritative | the UI computes the amount that gets stored or charged | **0** | none |

**No Class C sites exist.** Every submission boundary passes decimal **strings**
straight through:

* `PosScreen.tsx` — `provisionalTotal` (`.toFixed(2)`) is display only; the payload
  is `lines: [{ variant_id, quantity: String(qty), unit_price: line.unitPrice }]`
  where `unit_price` is the untouched backend string.
* `PurchaseTransactionScreen.tsx` — the whole `calculations` memo is display only;
  the payload sends `quantity`, `unit_cost`, `amount`, and `paid_amount` as raw
  input strings.
* `StockReceiptScreen.tsx:58` — carries the comment "Provisional display only —
  never authoritative", and the submit path confirms it.

The single Class B site is **F-RCV-001**, `CustomersScreen.tsx:513`
(`amount: paymentTotal`). It is *not* an integrity violation, because the database
refuses any divergence:

```
receivables.post_customer_payment:
    IF v_allocation_sum <> p_amount THEN
        RAISE EXCEPTION 'payment allocations must equal payment amount'
            USING ERRCODE = '55000';
```

The worst outcome is a confusing rejection, never a wrong posting. Reported, not
fixed — it is WS-F/receivables, outside this task.

---

## 8. Stock concurrency — F-POS-001, reproduced and fixed

All eight functions that write `inventory.positions`, as originally audited:

| Function | `FOR UPDATE` on `inventory.positions` |
|---|---|
| `inventory.allocate_landed_cost` | yes |
| `inventory.confirm_direct_purchase` | yes |
| `inventory.confirm_purchase_receipt` | yes |
| `inventory.confirm_stock_adjustment` | yes |
| `inventory.confirm_stock_receipt` | yes |
| `inventory.confirm_supplier_return` | yes |
| `sales.confirm_credit_sale` | yes |
| **`sales.confirm_cash_sale`** | **no** ← the defect |

Seven of eight took the row lock before the read-check-write. `sales.confirm_cash_sale`
did not; its body was:

```
FOR v_line IN SELECT jsonb_array_elements(p_lines) LOOP
    SELECT quantity_on_hand, total_value, last_known_wac
      INTO v_qty_on_hand, v_position_value, v_wac
      FROM inventory.positions
     WHERE warehouse_id = p_warehouse_id AND variant_id = v_variant_id;   -- no FOR UPDATE

    IF v_qty_on_hand < v_quantity THEN
        RAISE EXCEPTION 'insufficient stock for variant % in warehouse % (have %, need %)' …

    UPDATE inventory.positions
       SET quantity_on_hand = v_new_qty, …                                -- absolute value
```

Note the step-7 comment on the loop this sits in: *"Process each line: validate,
**lock position**, issue stock, accumulate COGS."* The lock was intended and
simply absent — which is what the omission looked like from the inside.

Under `READ COMMITTED`, for the scenario the audit brief asks about
(`stock = 1`, A sells 1, B sells 1): both transactions read `1` from their own
snapshots, both pass `1 < 1 = false`, both compute `v_new_qty = 0`. B's `UPDATE`
blocks on A's row lock, then — because the `WHERE` clause still matches after A
commits — writes the value B computed from its stale read. Final state
`quantity_on_hand = 0` with **two units sold from one unit of stock**. This is a
lost update, so `positions_quantity_non_negative` never fires.

### 8.1 Reproduced

The two-session reproduction **was** performed, in
`application::cash_sale::tests::concurrent_cash_sales_cannot_oversell_the_last_unit`.
It is deterministic rather than racy: transaction A posts and is held open,
transaction B posts the same unit on a second connection, the test waits for B's
block to appear in `pg_stat_activity` (rather than sleeping a guessed interval),
commits A, and only then inspects B.

Run against the **unfixed** function, the second sale returned a document id
instead of failing:

```
thread '…concurrent_cash_sales_cannot_oversell_the_last_unit' panicked at
  src\application\cash_sale.rs:427:33:
the second sale must be rejected; if it succeeded, one unit of stock was sold
twice: 8
```

The resulting ledger, with `OVERSELL-…1899` posted by the fixed function and
`OVERSELL-…6400` by the unfixed one:

```
sku=OVERSELL-1787466118995297100 on_hand=0.000 issues=1 sale_lines=1 units_sold=1.000
sku=OVERSELL-1787466154244796400 on_hand=0.000 issues=2 sale_lines=2 units_sold=2.000

inventory.movements for the second variant:
  3 | RECEIPT | delta=1.000  | resulting=1.000
  4 | ISSUE   | delta=-1.000 | resulting=0.000
  5 | ISSUE   | delta=-1.000 | resulting=0.000
```

One unit received, two ISSUE movements, both claiming a resulting balance of
zero. That is the lost update, and `quantity_on_hand` never went negative, which
is exactly why the CHECK constraint could not intervene.

### 8.2 Fixed

`src-tauri/migrations/20260823090000_sales_cash_sale_position_lock.sql`
(forward-only; no applied migration edited) `CREATE OR REPLACE`s the function with
a single bulk lock over every touched position, taken before any document row is
written:

```sql
PERFORM 1
FROM inventory.positions
WHERE warehouse_id = p_warehouse_id
  AND variant_id IN (
      SELECT DISTINCT (elem ->> 'variant_id')::bigint
      FROM jsonb_array_elements(p_lines) elem
  )
ORDER BY variant_id
FOR UPDATE;
```

This is the pattern `sales.confirm_credit_sale` — the closest sibling, same
multi-line jsonb shape, same COGS and residual logic — already used, rather than
the per-line `FOR UPDATE` the other six inventory functions use. The distinction
matters for a sale: a per-line lock inside the loop would also close the race, but
would let two multi-line sales deadlock when their line arrays name an overlapping
variant set in different orders. Locking every touched row up front, ordered by
`variant_id`, cannot deadlock against another sale doing the same.

The per-line `SELECT` deliberately keeps no `FOR UPDATE` of its own, again
matching `confirm_credit_sale`: it is a separate statement, so under READ
COMMITTED it takes a fresh snapshot that already includes whatever the blocked-on
transaction committed.

Nothing else about the function changed — same signature, validation order, COGS
and residual handling, journal, numbering, idempotency contract, and SQLSTATEs.
`CREATE OR REPLACE` preserved owner (`stockiha_owner`), `SECURITY DEFINER`,
`search_path=pg_catalog`, and the `stockiha_runtime` EXECUTE grant, all
re-verified after applying.

After the fix, all three databases report every one of the eight writers locking:

```
inventory.allocate_landed_cost      | positions_FOR_UPDATE=true
inventory.confirm_direct_purchase   | positions_FOR_UPDATE=true
inventory.confirm_purchase_receipt  | positions_FOR_UPDATE=true
inventory.confirm_stock_adjustment  | positions_FOR_UPDATE=true
inventory.confirm_stock_receipt     | positions_FOR_UPDATE=true
inventory.confirm_supplier_return   | positions_FOR_UPDATE=true
sales.confirm_cash_sale             | positions_FOR_UPDATE=true   ← was false
sales.confirm_credit_sale           | positions_FOR_UPDATE=true
unpinned_secdef=0
```

---

## 9. F-ENV-001 — the wedged acceptance database (needs your decision)

```
SELECT * FROM core.system_state;
→ id=1 | initialized=f | … (workstation_id and default_warehouse_id empty)

SELECT id, username FROM iam.users ORDER BY id;
→ 11 s2adj_conc_admin_193982653
  15 s2adj_conc_admin_1641318210
  16 s2003_conc_user
  17 s2adj_conc_admin_1723928302
  18 s2adj_conc_admin_1346130128
  51 s2adj_conc_admin_926432585
```

`src/app/AppRouter.tsx:89` routes on `status.initialized` alone, so the app shows
the first-run setup screen. `core.bootstrap_first_admin` then refuses:

```
IF (SELECT initialized FROM core.system_state WHERE id = 1)
   OR EXISTS (SELECT 1 FROM iam.users)
THEN RAISE EXCEPTION 'system is already initialized' USING ERRCODE = '55000';
```

So in `stockiha_acceptance` you can never complete setup and never log in. **This,
not a missing UI, is why the user-management journey could not be performed.** The
six users have unknown passwords; they are residue from integration tests that
targeted a non-`_test` database.

This is a destructive-cleanup decision, so **nothing was deleted**. Options:

1. **Recommended** — use the clean database this audit provisioned. It already has
   all 118 migrations, a working administrator, and the role/user created through
   the UI:
   `postgres://stockiha_runtime:…@127.0.0.1:5433/stockiha_wsa_acceptance`
2. Recreate `stockiha_acceptance` from scratch (drops all 10 journal lines and the
   procurement/catalog data in it):
   `powershell -File scripts\run-sqlx-migrations.ps1 -DatabaseName stockiha_acceptance`
   after dropping the database.
3. Delete only the residue users so the existing data survives and bootstrap can
   run. This touches `iam.users`, `iam.user_roles`, and `iam.application_sessions`
   and may hit foreign keys from documents those users created — it needs
   inspection before execution.

Separately: the tests that caused this are now unable to do so. The fixtures in
`src-tauri/src/application/iam.rs` refuse any database whose name does not end in
`_test`, and they seed through `core.bootstrap_first_admin` + `iam.create_user`
rather than direct inserts, which `stockiha_runtime` cannot perform anyway.

---

## 10. WS-A authorization matrix

Every row was verified. "DB authz" names the function that enforces it and the
permission it demands; "bypass test" reports the result of invoking the Tauri
command directly, outside the UI, with a genuine session token for a user that
lacks the permission.

| Operation | Frontend gate | Tauri gate | DB authorization | Bypass test | Correct? |
|---|---|---|---|---|---|
| Login | login form | `commands::auth::login` | `iam.users` + Argon2 verify in Rust; `is_active` checked; session row inserted | n/a | yes |
| Logout | header button | `commands::auth::logout` | `UPDATE iam.application_sessions SET revoked_at` by token hash | n/a — idempotent by design | yes |
| List users | card hidden when `PERMISSION_DENIED` | `commands::iam::list_users` | `iam.list_users` → `resolve_session_with_permission(MANAGE_USERS)` | `PERMISSION_DENIED` | yes |
| Create user | modal behind the card | `commands::iam::create_user` | `iam.create_user` → `MANAGE_USERS`; **+ `SUPER_ADMIN` hierarchy check (new)** | `PERMISSION_DENIED` | yes |
| Assign / change role | row action | `commands::iam::assign_user_role` | `iam.assign_user_role` → `MANAGE_USERS`; `SUPER_ADMIN` hierarchy; **+ last-administrator guard (new)**; row locked `FOR UPDATE` | `PERMISSION_DENIED` | yes |
| Deactivate user | row action + confirm dialog | `commands::iam::set_user_active` | `iam.set_user_active` → `MANAGE_USERS`; self-deactivation refused; **+ last-administrator guard (new)**; revokes the target's live sessions | `PERMISSION_DENIED` | yes |
| Activate user | row action | `commands::iam::set_user_active` | same function | `PERMISSION_DENIED` | yes |
| Delete user | **not offered** | **no command** | **no function** | n/a | by design — deactivation replaces deletion, preserving audit history |
| Password change / reset | **not offered** | **no command** | **no function** | n/a | **gap — see §12** |
| Session revocation | via deactivation only | `commands::iam::set_user_active` | `iam.set_user_active` revokes all live sessions for the target | `PERMISSION_DENIED` | partial — no per-session revocation UI |
| List roles | populates the role selectors | `commands::iam::list_roles` | `iam.list_roles` → `MANAGE_USERS` | `PERMISSION_DENIED` | yes |
| Create role | **new** modal in the Roles card | `commands::iam::create_role` | `iam.create_role` → `MANAGE_ROLES`; `^[A-Z][A-Z0-9_]*$` code check | `PERMISSION_DENIED` | yes |
| List permissions | **new** — presence of the Roles card | `commands::iam::list_permissions` | `iam.list_permissions` → `MANAGE_ROLES` | `PERMISSION_DENIED` | yes |
| Set role permissions | **new** permission editor | `commands::iam::set_role_permissions` | `iam.set_role_permissions` → `MANAGE_ROLES`; `SUPER_ADMIN` immutable; **+ last-granting-role guard (new)**; row locked `FOR UPDATE` | `PERMISSION_DENIED` | yes |

The bypass test is the important column. It was run inside the live application by
obtaining a real 64-character session token for `wsa_cashier_469382` (a user whose
custom role grants only `VIEW_CUSTOMERS` and `MANAGE_INVENTORY`) and invoking each
command directly through `window.__TAURI_INTERNALS__.invoke`, skipping React
entirely:

```json
{
 "tokenLength": 64,
 "list_users":            "refused -> {\"code\":\"PERMISSION_DENIED\"}",
 "create_user":           "refused -> {\"code\":\"PERMISSION_DENIED\"}",
 "create_role":           "refused -> {\"code\":\"PERMISSION_DENIED\"}",
 "assign_user_role":      "refused -> {\"code\":\"PERMISSION_DENIED\"}",
 "set_user_active":       "refused -> {\"code\":\"PERMISSION_DENIED\"}",
 "set_role_permissions":  "refused -> {\"code\":\"PERMISSION_DENIED\"}",
 "list_permissions":      "refused -> {\"code\":\"PERMISSION_DENIED\"}",
 "list_roles":            "refused -> {\"code\":\"PERMISSION_DENIED\"}"
}
```

And nothing was created despite the attempts:

```
users=2  bypass_user=0  BYPASS_ROLE=0  admin_still_ADMIN=1
admin_active=true  CASHIER_has_MANAGE_USERS=0
```

Note also that only the redacted `{ code }` crossed the IPC boundary — no database
message, no SQL, no schema detail.

---

## 11. Changes made

### 11.1 New migration

`src-tauri/migrations/20260822190000_iam_admin_safety_hardening.sql` — forward-only.
No previously applied migration was edited.

* **new** `iam.another_active_user_administrator_exists(bigint)` —
  `SECURITY DEFINER`, `STABLE`, `search_path = pg_catalog`, `REVOKE ALL FROM PUBLIC`
  and **not** granted to `stockiha_runtime` (verified: `has_function_privilege → false`).
  Expressed over the `MANAGE_USERS` *permission*, not over a role code, so a custom
  role that grants `MANAGE_USERS` also counts as administrative.
* `iam.create_user` — added the `SUPER_ADMIN` hierarchy check (F-WSA-101); typed
  SQLSTATEs; trims the username.
* `iam.list_users` — dropped and recreated (the return type changed) to
  `LEFT JOIN` + `GROUP BY` with `array_agg(... ORDER BY r.code) FILTER (...)`,
  returning `role_codes text[]` / `role_names text[]` (F-WSA-103). `EXECUTE`
  re-granted to `stockiha_runtime`.
* `iam.set_user_active` — locks the target row `FOR UPDATE`; typed SQLSTATEs; a
  last-administrator guard that is documented in the migration as **currently
  unreachable** (the self-deactivation rule already makes lockout impossible here)
  and kept only so that relaxing that rule cannot silently reintroduce it.
* `iam.assign_user_role` — locks the target row `FOR UPDATE`; typed SQLSTATEs;
  refuses a reassignment that would remove `MANAGE_USERS` from the last active
  administrator (F-WSA-102, the reachable vector).
* `iam.create_role` — typed SQLSTATEs; trims the role name.
* `iam.set_role_permissions` — locks the role row `FOR UPDATE`; typed SQLSTATEs;
  refuses revoking `MANAGE_USERS` from the last role that grants it. The survivor
  predicate is evaluated against the **post-change** state (does any active user
  still reach `MANAGE_USERS` through a *different* role), because a first draft
  that asked "does another admin exist" per user would have wrongly allowed
  stripping a role held by two administrators at once.

All exceptions now carry `ERRCODE = '55000'`, which `AppError::from_posting_error`
maps to `PreconditionFailed` → `PRECONDITION_FAILED` at the IPC boundary. This
preserves the existing external contract exactly while removing the string matching.

### 11.2 Rust

* `src-tauri/src/application/iam.rs`
  * `UserSnapshot.role_code/role_name` → `role_codes: Vec<String>` / `role_names: Vec<String>`.
  * `map_iam_error` reduced to `AppError::from_posting_error` — the 13-fragment
    `P0001` substring match is gone (F-WSA-104).
  * removed the diagnostic query, the `println!` of host/port/database/user, and
    the `std::fs::write("diagnostic.txt", …)` from `list_users` and `list_roles`
    (F-WSA-105).
  * removed `diagnostic_connection_proof`, which referenced an unimported module
    and panicked without a configured database (F-WSA-106).
  * new fixtures `root_admin_session` and `seed_user_via_admin` that go through
    `core.bootstrap_first_admin` and `iam.create_user` instead of direct inserts
    (F-WSA-107).
  * new test `iam_functions_emit_the_expected_sqlstates` — asserts `28000`,
    `42501`, and `55000` directly at the SQL boundary the Rust classifier depends on.
  * new test `iam_admin_safety_guards` — one-row-per-user cardinality, the
    `SUPER_ADMIN` escalation refusal, immediate permission loss on a live session
    after a role change, and both last-administrator guards, made deterministic by
    first deactivating every other administrator and restoring them afterwards.
* `src-tauri/src/application/auth.rs` — removed the 441-line WS-A-1 block whose
  fixtures could never run (`permission denied for table users`). Its coverage now
  lives in `iam.rs` against fixtures that work.
* `src-tauri/diagnostic.txt` — deleted. It contained a live connection profile
  (host, port, database, role).

### 11.3 Frontend

* `src/shared/ipc/iamDto.ts` — `role_codes` / `role_names` arrays.
* `src/shared/ipc/iamGateway.ts` — renamed `createUser`'s `passwordHash` parameter
  to `password` (it was always the plaintext) and removed the stray
  "Wait, backend expects…" comment.
* `src/features/settings/UserManagementSettingsScreen.tsx` — rewritten.
  * renders multiple role badges per user; `key={user.user_id}` is now unique.
  * `MANAGE_USERS` gates the whole screen; `MANAGE_ROLES` gates only the new
    Roles & Permissions card, loaded independently so a `PERMISSION_DENIED` there
    is an expected outcome rather than an error.
  * **new** role administration: create role (with the `^[A-Z][A-Z0-9_]*$` hint
    mirrored from the database) and a permission checkbox editor;
    `SUPER_ADMIN` is shown as non-editable.
  * corrected `sk-page__header` (a class that does not exist in the stylesheet) to
    the card layout the other settings screens use.
  * `data-testid` hooks throughout, and en/fr/ar copy for every new string.
* `src/shared/utils/tauriError.ts` — added the two missing `SAFE_MESSAGES` entries (F-BUILD-001).
* `src/shared/i18n/locales.ts` — added `inventory.skuBarcode` in all three locales (F-BUILD-001).
* `src/features/inventory/InventoryScreen.tsx` — uses the real key (F-BUILD-001).
* `src/features/inventory/StockAdjustmentScreen.tsx` — removed the dead
  `visibleVariants` memo and the orphaned `variantSearch` state it was the only
  reader of; item selection goes through `ItemSearchModal` (F-BUILD-001).

Nothing else was touched. No authorization was implemented in the UI, no DB role,
grant, or `SECURITY DEFINER` boundary was weakened, and no test was disabled.

### 11.4 Follow-up task — F-POS-001

* `src-tauri/migrations/20260823090000_sales_cash_sale_position_lock.sql` — new,
  forward-only. Detailed in §8.2.
* `src-tauri/src/application/test_fixtures.rs` — new, `#[cfg(test)]`. The
  sanctioned-path fixtures (`require_test_pool_url`, `root_admin_session`,
  `seed_user_via_admin`) moved here from `iam.rs`'s private test module so the
  cash-sale test could reuse them instead of duplicating the bootstrap, plus
  `fixture_warehouse_id`, `fixture_fiscal_period_id`, `fixture_cash_session_id`
  (which reuses an existing live session, since `sales.cash_sessions` permits only
  one per workstation and a test that always opened one would pass exactly once),
  and `unique_suffix`.
* `src-tauri/src/application/mod.rs` — declares the module under `#[cfg(test)]`.
* `src-tauri/src/application/iam.rs` — its test module now imports the shared
  fixtures; 99 duplicated lines removed, no assertion changed.
* `src-tauri/src/application/cash_sale.rs` — payload construction extracted into
  `canonical_cash_sale_payload` so the new test derives the idempotency hash the
  same way production does rather than rebuilding and drifting from it; the
  duplicated local `require_test_pool_url` now comes from the shared module; new
  test `concurrent_cash_sales_cannot_oversell_the_last_unit`.

One deliberate deviation from the task brief: the brief said to add `FOR UPDATE` to
the per-line `SELECT`. The bulk pre-lock was used instead, because that is what the
closest sibling (`sales.confirm_credit_sale`) does and because a per-line lock is
deadlock-prone for multi-line sales. Reasoning in §8.2.

---

## 12. Escalations for the Lead Architect

### 12.1 `SUPER_ADMIN` is unreachable — an ADR-level decision, deliberately not changed

Three facts, each verified:

1. `core.bootstrap_first_admin` assigns the role **`ADMIN`** by fixed code.
2. `iam.assign_user_role` and (after this audit) `iam.create_user` both refuse to
   grant `SUPER_ADMIN` unless the actor already holds `SUPER_ADMIN`.
3. No other sanctioned path grants a role.

Therefore no user can ever obtain `SUPER_ADMIN`. Confirmed empirically: zero users
hold it in `stockiha_acceptance`, and the migration's own tests originally had to
insert `SUPER_ADMIN` users directly to exercise the hierarchy. The role, its full
permission grant, and the hierarchy rule are currently inert.

This is **fail-closed**, so it is not a vulnerability, and it was left alone: the
obvious fix (have `bootstrap_first_admin` assign `SUPER_ADMIN`) increases the first
user's authority and is an authorization-boundary decision, which the execution
protocol reserves for you. Either decide that `SUPER_ADMIN` is reserved for a
future feature, or change the bootstrap in a dedicated task.

### 12.2 There is no administrator recovery path

No `password_reset`, no offline recovery function, no mail server. Verified: no
command, no `iam.*` function, and no script offers a password change or reset for
any user — the matrix row is empty because nothing exists, not because it was
missed. Combined with `core.bootstrap_first_admin` refusing to run once
`iam.users` is non-empty, a forgotten administrator password today means the
installation is unrecoverable without direct database surgery.

The F-WSA-102 fix removes the *accidental* routes into that state (self-demotion
and role-permission revocation), but forgetting the password is still terminal. No
recovery mechanism was invented. This needs a deliberate design — most likely an
offline, physically-authenticated administrative reset — and is an **operational
blocker for release**, not for WS-A manual acceptance.

---

## 13. Tests and verification — commands actually executed

### Frontend

```
npm run typecheck   → PASS (was: 3 errors — see F-BUILD-001)
npm run lint        → 13 errors, ALL pre-existing in
                      src/features/procurement/PurchaseOrdersScreen.tsx
                      (7 unused `_id`/`_result`, 6 no-constant-binary-expression).
                      Zero in any file this audit touched. Not fixed — WS-E.
npm run test        → 165 passed, 10 failed (4 files)
npm run build       → PASS (was failing, so run.bat could not launch the app)
```

The 10 test failures were **proved pre-existing**, not caused by this work. The
four files I had edited in that area were stashed back to their `HEAD` state and
the same four test files were re-run:

```
git stash push -- src/features/inventory/InventoryScreen.tsx \
                  src/features/inventory/StockAdjustmentScreen.tsx \
                  src/shared/i18n/locales.ts src/shared/utils/tauriError.ts
npx vitest run tests/inventory.workflow.test.tsx tests/stock-adjustment.workflow.test.tsx \
               tests/procurement.workflow.test.tsx tests/direct-purchase.workflow.test.tsx
→ Test Files 4 failed (4) | Tests 10 failed | 27 passed (37)
git stash pop
```

Identical count, identical tests. They are assertion drift from commits `ae591fc`
and `86908f5`: `ItemSearchModal` deliberately shows barcode *or* SKU (barcode takes
precedence) while the tests expect both, and `InventoryScreen` moved to realtime
search while the tests still click a "Search" button that no longer exists.
Reported, not fixed — WS-D.

### Rust

```
cargo fmt --check   → PASS
cargo check --all-targets                          → PASS
cargo clippy --all-targets --all-features -D warnings → PASS (zero warnings)
cargo test          → 258 passed; 0 failed; 18 ignored
```

### Integration tests against real PostgreSQL 18

```
powershell -File scripts\provision-iam-test.ps1
→ recreates stockiha_iam_test, applies all 119 migrations from scratch,
  post-migration check confirms iam.list_users(text) and iam.list_roles(text)

STOCKIHA_TEST_DATABASE_URL=…/stockiha_iam_test
cargo test --lib -- --ignored --test-threads=1 \
    application::iam application::cash_sale::tests::concurrent

running 4 tests
test application::cash_sale::tests::concurrent_cash_sales_cannot_oversell_the_last_unit ... ok
test application::iam::tests::iam_admin_safety_guards ... ok
test application::iam::tests::iam_functions_emit_the_expected_sqlstates ... ok
test application::iam::tests::test_iam_operations_rigorous ... ok
test result: ok. 4 passed; 0 failed
```

The concurrency test was also run against the **unfixed** function (restored into
the disposable test database only, never into the migration file) and failed as
designed — see §8.1. A regression test that passes either way would prove nothing,
so this negative run is the load-bearing evidence.

Accounting integrity after the concurrency test posted real sales and COGS
journals into `stockiha_iam_test`:

```
per_document_imbalances = 0
global_imbalance = 0.00  (lines = 4)
negative_positions = 0
```

`test_iam_operations_rigorous` covers invalid token → `SessionInvalid`, missing
`MANAGE_USERS`/`MANAGE_ROLES` → `PermissionDenied`, create/list/deactivate/
reassign/create-role/list-permissions/set-permissions happy paths, and ten error
propagations (duplicate username, unknown role, unknown permission, nonexistent
user, `SUPER_ADMIN` hierarchy, `SUPER_ADMIN` permission immutability,
self-deactivation, malformed role code, duplicate role code).

### Migration forward-safety

```
# from scratch
scripts\provision-iam-test.ps1                                  → 119 applied, 0 failed
scripts\run-sqlx-migrations.ps1 -DatabaseName stockiha_wsa_acceptance → 119 applied, 0 failed
# incrementally, onto databases with existing data
scripts\run-sqlx-migrations.ps1 -DatabaseName stockiha_acceptance
→ Applied 20260822190000/migrate iam admin safety hardening (62.6993ms)
→ Applied 20260823090000/migrate sales cash sale position lock (20.8497ms)
→ Total migrations applied: 119
scripts\run-sqlx-migrations.ps1 -DatabaseName stockiha_wsa_acceptance
→ Applied 20260823090000/migrate sales cash sale position lock (10.0238ms)
→ Total migrations applied: 119
```

Post-migration assertions on `stockiha_acceptance`:

```
new signature:
  TABLE(user_id bigint, username text, display_name text, is_active boolean,
        role_codes text[], role_names text[])

F-WSA-103 fixed on real data — the multi-role user collapses to one row:
  16 | s2003_conc_user | {ADMIN,MANAGER}

unpinned SECURITY DEFINER functions: 0

EXECUTE for stockiha_runtime:
  another_active_user_administrator_exists => false   ← intentionally withheld
  assign_user_role, create_role, create_user, list_permissions, list_roles,
  list_users, resolve_session, resolve_session_with_permission,
  set_role_permissions, set_user_active => true
```

### Native Windows / Tauri acceptance

The real application was built and launched (`npm run tauri dev`, WebView2) against
the clean `stockiha_wsa_acceptance` database, with
`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333` so the
window's own DOM could be driven and read. Every action below went through the
app's real React handlers, real `invoke`, real Rust commands, and real PostgreSQL
functions.

```
[wsa] initial setup screen detected — filling it
[wsa] setup completed
[wsa] opening-state onboarding gate detected — deferring
[wsa] main shell reached
[wsa] opening Settings
[wsa] User Management surface rendered
[wsa] Roles & Permissions card rendered (MANAGE_ROLES granted by the database)
[wsa] creating role WSA_AUDIT_468963
[wsa] ROLE CREATED and listed: WSA_AUDIT_468963 WS-A Audit Reviewer Edit permissions
[wsa] granting permissions to WSA_AUDIT_468963
[wsa] ROLE PERMISSIONS SAVED
[wsa] creating user wsa_cashier_469382
[wsa] USER CREATED and listed: wsa_cashier_469382 WS-A Test Cashier
      WS-A Audit Reviewer Active Change role Deactivate
[wsa] user table row count: 2
```

Database confirmation of those UI actions:

```
1 | wsa.admin          | WS-A Administrator | active=true | roles=ADMIN
    | hash=$argon2id$v=19$m=19456,t=2,p=1$…
2 | wsa_cashier_469382 | WS-A Test Cashier  | active=true | roles=WSA_AUDIT_468963
    | hash=$argon2id$v=19$m=19456,t=2,p=1$…

5 | WSA_AUDIT_468963 | WS-A Audit Reviewer | perms=MANAGE_INVENTORY,VIEW_CUSTOMERS
```

The permissions stored are exactly the two ticked in the UI. The created user then
signed in through the real login form with the password typed into the create-user
modal, proving the Argon2 create → authenticate round trip, and the User Management
surface was correctly absent for them:

```
{"loggedInAs":"wsa_cashier_469382",
 "userManagementVisibleForNonAdmin":false}
```

Negative acceptance — the F-WSA-102 guard, exercised through the real
"Change role" dialog by trying to demote the only administrator to Cashier:

```
[wsa-neg] refusal surfaced in the UI: This action is not allowed in the current state.
[wsa-neg] administrator row after the refusal:
          wsa.admin WS-A Administrator Administrator Active Change role Deactivate
[wsa-neg] roles card still rendered (session still holds MANAGE_ROLES): true
```

The refusal is atomic and the message is the fixed `PRECONDITION_FAILED` copy — the
database's own text (`cannot remove user administration from the last active user
administrator`) appeared **only** in the debug-build stderr diagnostic and never in
the UI:

```
tauri-dev.err.log:
[DB_POSTING_ERROR] error returned from database:
  cannot remove user administration from the last active user administrator
```

No panics and no other errors were logged during the entire session.

---

## 14. Remaining risks

1. **F-ENV-001 is unresolved by choice.** Until you pick one of the three options
   in §9, `run.bat` still cannot reach a login screen, because it hard-codes
   `stockiha_acceptance`.
2. ~~F-POS-001 (oversell in `sales.confirm_cash_sale`) is unfixed.~~ **Reproduced
   and fixed** — see §8. The residual risk is narrower: the regression test covers
   the single-line, single-variant contention case. Multi-line sales whose variant
   sets overlap are protected by the deterministic `ORDER BY variant_id`, but that
   deadlock-avoidance property is reasoned about rather than tested.
3. **No administrator recovery path** (§12.2) — an operational release blocker.
4. **`SUPER_ADMIN` is inert** (§12.1) — needs a decision, not a code change.
5. **10 pre-existing frontend test failures** (WS-D/WS-E assertion drift) and **13
   pre-existing lint errors** (WS-E) remain. They were proved unrelated and left
   alone, but they mean `npm run test` and `npm run lint` are not currently green
   gates.
6. **Per-session revocation** exists only as a side effect of deactivating a user;
   there is no "sign out this device" surface.
7. **`core.request_idempotency` grows without bound** (F-OPS-001).
8. The accounting-integrity assertion passed against only 10 journal lines. It
   proves the invariant for the data present, not under future load.
9. `iam.user_roles` has no uniqueness on `user_id`, so multiple roles per user are
   representable even though `iam.assign_user_role` always replaces. `iam.list_users`
   now handles that correctly; whether multi-role should be supported or constrained
   is a product decision that was not made here.
