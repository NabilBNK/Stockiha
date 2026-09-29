# AUDIT-1 — Post-WS-I Audit Fixes — Executable Implementation Specification

> **Status:** PLAN ONLY. Nothing in this document has been implemented yet.
> **Written:** 2026-09-25, against commit `8cf8afc` (branch `task/ws-i-3-stock-home-notifications`).
> **Audience:** the implementing agent (assume no prior context, no ability to guess).
> **Authority:** `STOCKIHA_GROUND_TRUTH.md` > `AGENTS.md` > this plan. If this plan conflicts with either, STOP and report.

---

## PART 0 — How to use this document (read fully before touching anything)

### 0.1 Ground rules (non-negotiable)

1. Execute the work items **in the exact order of PART 3**. Do not reorder. Do not skip.
2. Each work item lists **atomic steps**. Do each step fully, run its verification, then move to the next.
3. **Never** commit, push, merge, open a PR, tag, or release. `AGENTS.md` requires the Owner's explicit approval of the final Result Report first. When all items are done you write the Result Report (PART 7) and **stop**.
4. **Never** edit a migration file that already exists in `src-tauri/migrations/`. Applied migrations are immutable. All SQL changes go into the **new** migration files named in this plan.
5. **Never** use floating point (`Number(...)`, `parseFloat`, JS arithmetic) to compute money, quantity, WAC, or anything that is posted. Display-only conversions that already exist may stay.
6. **Never** weaken a `SECURITY DEFINER` function, a `GRANT`, a role, or a permission check to make a test pass.
7. If a step says "STOP", stop the whole batch, write what you found, and ask the Owner.
8. Do not "improve" anything this plan does not ask for. Unrelated problems you notice go into the Result Report's "Unrelated problems" section — **not** into code.
9. After each work item, bump the dashboard version marker (PART 2.4). This is mandatory.

### 0.2 Environment (Windows, this machine)

- Node: `C:\Program Files\nodejs` (use `npm.cmd` / `npx.cmd` from PowerShell, or `npm` from Git Bash with that dir on `PATH`).
- Rust: `C:\Users\Perfetto\.cargo\bin`, MSVC env from `C:\BuildTools\VC\Auxiliary\Build\vcvars64.bat`.
- **Memory limit:** this PC runs out of memory when `cargo test` compiles with default parallelism (observed: `memory allocation of 81920 bytes failed`, `STATUS_STACK_BUFFER_OVERRUN`, `E0786 invalid metadata`). **Always** run `cargo test` as:
  ```powershell
  $env:PATH="C:\Users\Perfetto\.cargo\bin;$env:PATH"; $env:CARGO_INCREMENTAL="0"
  cmd.exe /c "call C:\BuildTools\VC\Auxiliary\Build\vcvars64.bat >nul && cd /d C:\Users\Perfetto\Desktop\Stockiha-Part02-Test\src-tauri && cargo test -j 1"
  ```
  `cargo clippy` and `cargo check` succeed with default parallelism.
- **SQL suites** need a throwaway PostgreSQL 18 cluster exactly as described in `WS-I-3-RESULT-REPORT.md` → "SQL suites" (cluster built from `src-tauri/resources/postgres/win64`, a free port such as 55499, roles bootstrapped and a CI fiscal period seeded as `.github/workflows/ci.yml` does, **all** migrations applied in filename order). Never point any test at port 5433 or at the `stockiha_acceptance` database. Delete the throwaway cluster afterwards.

### 0.3 Branch

Before the first edit:

```bash
git status --short          # must print nothing. If not empty: STOP.
git switch -c task/audit-1-post-ws-i-fixes
```

The branch starts from the current tip `8cf8afc`. All work happens on this branch.

---

## PART 1 — What is being fixed (summary)

| ID | Severity | Owning WS | One-line problem | Layers touched |
|---|---|---|---|---|
| AUD-01 | CRITICAL | WS-F / WS-B | Closing a cash session **adds** cash-outs to expected cash (inflated by 2× every cash-out) and never posts the variance journal, because the app still calls the old `sales.submit_cash_session_count` / `sales.approve_cash_session_variance` instead of WS-F-005's corrected `cash.*` versions. | SQL, SQL tests |
| AUD-02 | CRITICAL | WS-B | Only one fiscal period exists (created at setup, calendar year 2026). Every posting is rejected once the date leaves it → **the till stops on 1 January 2027**. No code can create a new period. | SQL, SQL tests, React context, frontend tests |
| AUD-03 | HIGH | WS-D / WS-F | Stock receipts are always dated `openFiscalPeriod.starts_on` (1 January) instead of today. POS uses the PC's local timezone instead of the Algeria business date. | React, frontend tests |
| AUD-04 | HIGH | WS-A / WS-J | Login sessions expire after a fixed 12 h; the UI stays "logged in" and every action fails with "session invalid". No warning, no automatic return to login. | React, frontend tests, i18n |
| AUD-05 | HIGH | WS-G | Historical-finance manual entry creates and validates a batch but never approves it; the summary only counts approved batches → manual entries never appear. | React, frontend tests |
| AUD-06 | HIGH | WS-K | `src-tauri/tests/startup_runtime_guard.rs` fails 2 of 3 tests, unnoticed because result reports only ran `cargo test --lib`. | Rust integration test |
| AUD-07 | MEDIUM | WS-I | Management P&L ignores stock-adjustment losses/gains (damage, shrinkage, expiry, found stock), so "net result" disagrees with the ledger. | SQL, SQL tests, React, i18n |
| AUD-08 | MEDIUM | WS-I | Notification "Go to" (bell) does nothing when the user is already on the Reports screen. | React, frontend tests |
| AUD-09 | MEDIUM | WS-I / WS-J | Today home blanks to a spinner every 2 minutes; any transient error shows "no reports access"; users without `VIEW_REPORTS` keep polling failing calls forever (Today every 2 min, notifications every 5 min). | React, frontend tests, report copy |
| AUD-10 | MEDIUM | WS-H | The "daily" automatic backup runs once per app launch, never again while the app stays open. | React, frontend tests |
| AUD-11 | LOW | WS-I | Notification dismissals are shared by every user of the PC and survive midnight until restart. | React, frontend tests |
| AUD-12 | LOW | WS-J | For users without catalogue access, choosing a global-search result silently bounces back to the dashboard. | React, frontend tests, i18n |
| AUD-13 | LOW | WS-J | The `reports` view has no capability redirect guard (every other guarded view has one). | React |
| AUD-14 | LOW | WS-A / cleanup | Two frontend gateway functions call commands that do not exist; three database functions are `GRANT`ed to `PUBLIC`. | TS, SQL |
| AUD-15 | DOCS | — | `CURRENT_STEP.md` is stale (says WS-M active; lists defects that are already fixed). | Markdown |

Items deliberately **not** done are listed in PART 8 (Backlog) with the reason.

---

## PART 2 — Global conventions every step must follow

### 2.1 Migration files

- Location: `src-tauri/migrations/`. Current last file: `20260929090000_ws_i_003_stock_home.sql`.
- New files this plan creates (exact names, in this order):
  1. `20260930090000_audit_1_fiscal_period_rollover.sql` (AUD-02)
  2. `20260930091000_audit_1_cash_close_signed_expected.sql` (AUD-01)
  3. `20260930092000_audit_1_pnl_stock_adjustments.sql` (AUD-07)
  4. `20260930093000_audit_1_revoke_public_execute.sql` (AUD-14)
- Every new migration file has this exact shape:
  ```sql
  -- AUDIT-1 <ID>: <one-line purpose>. Re-runnable (WS-K-5 safe-upgrade fixture).
  SET ROLE stockiha_owner;

  -- ... body ...

  UPDATE operations.schema_state SET migration_version = <the 14-digit timestamp of THIS file>, updated_at = now() WHERE singleton;
  RESET ROLE;
  ```
- **Re-runnable** means: running the file a second time on the same database must succeed and change nothing. Use `CREATE OR REPLACE FUNCTION`, `REVOKE`/`GRANT` (idempotent by nature). Never `CREATE TABLE` without `IF NOT EXISTS`, never plain `ALTER TABLE ADD COLUMN` without `IF NOT EXISTS`. This plan adds **no** tables and **no** columns.
- `CREATE OR REPLACE FUNCTION` keeps the existing owner and existing ACL (grants) when the signature is unchanged. Do **not** change any function's argument list or return type in this plan — if you think you must, STOP.
- Every function body: `SET search_path = pg_catalog`, fully schema-qualified names (`finance.fiscal_periods`, never `fiscal_periods`).
- After creating a new migration, the licence-gate command count (`240` in `src-tauri/src/licence/gate.rs`) does **not** change — no Tauri command is added or removed anywhere in this plan.

### 2.2 SQL integration suites

- Location: `src-tauri/tests/<area>/<name>_integration.sql`.
- Pattern to copy: `src-tauri/tests/reports/ws_i_002_finance_reports_integration.sql` (lines 1–105: random suffix, users, roles, sessions inserted directly with `sha256(token::bytea)`, warehouse, fiscal period lookup-or-insert, product/variant/position).
- Each suite is one `DO $$ ... $$;` block, `\set ON_ERROR_STOP on` at the top, `RAISE NOTICE '=== Running <name> ===';` first, assertions as `IF <bad> THEN RAISE EXCEPTION 'Assertion failed (<n>): ...'; END IF;`.
- The runner (`src-tauri/tests/run_current_sql_suites.sh`) wraps each suite in `BEGIN; ... SET CONSTRAINTS ALL IMMEDIATE; ROLLBACK;`. Suites must therefore never `COMMIT`.
- Register every new suite by adding its path to the `suites=( ... )` array in `run_current_sql_suites.sh`, directly **after** the line `src-tauri/tests/reports/ws_i_003_stock_home_integration.sql`.
- To test "this must not happen" inside one DO block, use a sub-block that rolls itself back:
  ```sql
  BEGIN
      -- setup that must not leak
      -- assertions
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AUDIT_ROLLBACK_SUBBLOCK';
  EXCEPTION WHEN raise_exception THEN
      IF SQLERRM <> 'AUDIT_ROLLBACK_SUBBLOCK' THEN RAISE; END IF;
  END;
  ```
  Everything inside that sub-block is undone when it ends; assertion failures inside it (other message) still propagate.

### 2.3 Frontend conventions

- Gateways live in `src/shared/ipc/*Gateway.ts`; DTOs in `src/shared/ipc/*Dto.ts`; command names in `src/shared/ipc/commands.ts` (`COMMANDS`).
- App-wide UI text: `src/shared/i18n/locales.ts`. It has three dictionaries: `fr` (line ~10, defines `MessageKey = keyof typeof fr`), `ar` (`Record<MessageKey, string>`, line ~751) and `en` (`Record<MessageKey, string>`, line ~1487). **A new key must be added to all three** or `npm run typecheck` fails. Interpolation placeholder syntax is `{name}`, used as `t('key', { name: value })`.
- Report UI text: `src/features/reports/common/reportCopy.ts`, `REPORT_COPY: Record<Locale, Record<string, string>>` with blocks `en` (starts line ~7), `fr` (~185), `ar` (~363). This one is **not** type-checked per key — you must add every new key to **all three** blocks by hand and double-check.
- Business date (Algeria, independent of the PC's timezone): `currentBusinessDate()` from `src/shared/utils/businessDate.ts`. This is the one function every posting screen must use for "today". (`todayLocal()` in `src/features/reports/common/periods.ts` computes the same Algeria date for reports; do not add a third implementation.)
- Error code of any thrown IPC error: `codeForError(error)` from `src/shared/hooks/useErrorText.ts` (returns an `AppErrorCode` such as `'SESSION_INVALID'`, `'PERMISSION_DENIED'`, `'UNKNOWN_ERROR'`).
- Frontend tests: `tests/*.test.ts(x)`, Vitest + Testing Library. Every workflow test mocks `@tauri-apps/api/core` with `vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args) => invokeMock(...args) }))` and wires handlers per command name. Default UI locale in tests is English.
- **Fake timers with the full `<App/>` tree:** use exactly `vi.useFakeTimers({ shouldAdvanceTime: true })` and `await vi.advanceTimersByTimeAsync(ms)`, as `tests/automatic-backup-daily-and-overdue.workflow.test.tsx` does. Plain `vi.useFakeTimers()` hangs with the full app tree (documented in `WS-I-3-RESULT-REPORT.md`). Always call `vi.useRealTimers()` in `afterEach`.
- Wherever time-dependent logic is non-trivial, this plan extracts it into a **pure function** and unit-tests that function directly (fast, no fake-timer risk), plus at most one workflow test.

### 2.4 Dashboard version marker (mandatory after every work item)

- File: `src/shared/version.ts`, constant `APP_VERSION_MARKER` (currently `'WS-I-3.0'`).
- After finishing work item number *n* in PART 3's order (1…15), set it to `'AUDIT-1.<n>'`. Example: after the first item (AUD-06) it is `'AUDIT-1.1'`; after the last (AUD-15) it is `'AUDIT-1.15'`.
- Change only the string literal. Do not touch the comment.

### 2.5 Things that must NOT change anywhere in this batch

- Tauri command names, their Rust signatures, the `generate_handler!` list in `src-tauri/src/lib.rs`, `licence::gate::ALLOWED_IN_READ_ONLY`, and the count `240`.
- Any existing migration file.
- `sales.cash_sessions`, `cash.movements`, `finance.*` table definitions, constraints, grants.
- `SESSION_LIFETIME` (12 h) in `src-tauri/src/application/auth.rs` — AUD-04 is UI handling only.
- The WS-K embedded PostgreSQL / setup / updater / licence code.
- `package.json`, `package-lock.json`, `Cargo.toml`, `Cargo.lock` — **no new dependencies**.
- All `data-testid` values that exist today (tests rely on them). New test ids are allowed.

---

## PART 3 — Dependencies and execution order

```
1  AUD-06  Rust guard test repair           (independent; first so the full `cargo test` gate is meaningful)
2  AUD-02  Fiscal period rollover           (SQL + context)            ─┐
3  AUD-03  Business dates on posting screens (needs AUD-02's context)    │  AUD-01 posts a variance journal that needs
4  AUD-01  Cash close signed expected        (needs AUD-02: journal needs a period covering today) ─┘
5  AUD-07  P&L stock adjustments             (independent SQL + UI)
6  AUD-04  Session expiry handling           (independent)
7  AUD-05  Historical finance manual approve (independent)
8  AUD-08  Reports navigation event          (independent; AUD-09 reuses its helper)
9  AUD-09  Today home + polling              (needs AUD-08's `openReportsSubTab`)
10 AUD-10  Daily backup hourly check         (independent)
11 AUD-11  Notification dismissal keys       (touches the same file as AUD-09 → must come after it)
12 AUD-12  Global search access notice       (independent)
13 AUD-13  Reports view guard                (independent)
14 AUD-14  Dead gateway cleanup + REVOKE     (independent)
15 AUD-15  CURRENT_STEP.md resync            (last: documents the final state)
```

Why this order:
- AUD-01's corrected close calls `cash._post_cash_journal`, which raises `PRECONDITION_FAILED: no open fiscal period covers today` when no period covers today. If AUD-01 shipped without AUD-02, every close with a non-zero variance would fail from 1 January 2027. So AUD-02 lands first.
- AUD-03 relies on AUD-02's guarantee that the context period covers the business date.
- AUD-09 and AUD-11 both edit `src/features/notifications/NotificationsContext.tsx`; doing AUD-09 first avoids conflicting edits.

---

## PART 4 — Work items (in execution order)

---

### WORK ITEM 1 — AUD-06: repair `startup_runtime_guard.rs` and make the full Rust test gate the standard

#### 4.1.1 Problem (evidence)

`cargo test -j 1` (full, not `--lib`) on `8cf8afc`:

```
test no_ad_hoc_tokio_runtime_is_constructed_in_the_crate ... FAILED
  Offending lines: src/infrastructure/provision_cli.rs:54 — let runtime = match tokio::runtime::Builder::new_current_thread()
test startup_builds_database_state_exactly_once ... FAILED
  src/lib.rs must build the managed DatabaseState exactly once, found 0
test result: FAILED. 1 passed; 2 failed
```

Root causes:
1. `provision_cli.rs` (WS-K-3) builds its own current-thread runtime. This is **intentional and safe**: it only runs when the process is launched with `--provision-migrate`, it runs before Tauri is ever built, it creates no `PgPool` (the `exactly_one_pgpool_is_constructed_outside_tests` test passes), and it calls `std::process::exit` immediately after. `src-tauri/src/lib.rs` lines 26–35 document that it was deliberately kept as a support tool, and `src-tauri/src/infrastructure/schema_version.rs` line ~52 says its only caller is `provision_cli::run`. **Deleting it would break `schema_version.rs` (dead code → clippy `-D warnings` failure) and contradict a recorded decision.**
2. WS-K-1 moved `DatabaseState` construction from `database_state_from_env()` into `.setup()` using `infrastructure::db::database_state_from_precedence(app_data_dir)` (`src/lib.rs` line ~301). The guard still searches for the old function name.

#### 4.1.2 Decision

Update the guard test to match the real, reviewed architecture. **Do not** change any production Rust file. Alternatives rejected: deleting `provision_cli` (breaks `schema_version.rs`, contradicts a recorded decision); marking the tests `#[ignore]` (hides the guard).

#### 4.1.3 Steps

**Step 1.1 — allowlist the provision CLI in the runtime guard**
- File: `src-tauri/tests/startup_runtime_guard.rs`, function `no_ad_hoc_tokio_runtime_is_constructed_in_the_crate` (starts line ~61).
- Add, directly above `let mut offences = Vec::new();`:
  ```rust
  // WS-K-3's `--provision-migrate` path runs in its own process mode: it is
  // entered from `main.rs` before Tauri is built, creates no PgPool, and
  // exits the process as soon as its single `block_on` returns — so the
  // runtime it owns can never outlive a pool. Allowlisted by exact path;
  // a stale entry fails below.
  const ALLOWED_FILES: [&str; 1] = ["src/infrastructure/provision_cli.rs"];
  for allowed in ALLOWED_FILES {
      assert!(
          Path::new(env!("CARGO_MANIFEST_DIR")).join(allowed).exists(),
          "ALLOWED_FILES names {allowed}, which no longer exists — remove the entry"
      );
  }
  ```
- Inside the `for path in crate_sources()` loop, as the first statement:
  ```rust
  if ALLOWED_FILES.contains(&label(&path).as_str()) {
      continue;
  }
  ```
- Pitfall: `label()` returns forward-slash paths (it replaces `\` with `/`), so the comparison works on Windows. Do not compare `path` directly.

**Step 1.2 — make the DatabaseState guard match the WS-K-1 construction**
- Same file, function `startup_builds_database_state_exactly_once` (line ~134).
- Replace the line `let calls = entry.matches("database_state_from_env()").count();` with:
  ```rust
  // WS-K-1: DatabaseState is built inside `.setup()` via
  // `database_state_from_precedence(app_data_dir)` (the `database.json`
  // tier needs an AppHandle). Count real code lines only — lib.rs also
  // names the function in comments.
  let calls = entry
      .lines()
      .map(str::trim_start)
      .filter(|code| !code.starts_with("//") && !code.starts_with('*'))
      .filter(|code| code.contains("database_state_from_precedence("))
      .count();
  ```
- Leave the `assert_eq!(calls, 1, ...)` and the `tauri::async_runtime::block_on` assertion as they are.
- Edge case: if `calls` is not 1 after this change, do **not** adjust the number — STOP and report, because it means startup really builds the state 0 or 2+ times.

**Step 1.3 — version marker** → `'AUDIT-1.1'` (PART 2.4).

#### 4.1.4 Verification

```powershell
cmd.exe /c "call C:\BuildTools\VC\Auxiliary\Build\vcvars64.bat >nul && cd /d C:\Users\Perfetto\Desktop\Stockiha-Part02-Test\src-tauri && cargo test -j 1 --test startup_runtime_guard"
```
Expected: `test result: ok. 3 passed; 0 failed`.

#### 4.1.5 Acceptance criteria
- All 3 tests in `startup_runtime_guard.rs` pass.
- No file under `src-tauri/src/` changed in this item.
- From now on, every gate run in this batch uses full `cargo test -j 1` (not `--lib`).

---

### WORK ITEM 2 — AUD-02: fiscal period rollover

#### 4.2.1 Problem (evidence)

- `finance.fiscal_periods` (migration `20260722125402`) has columns `id, period_code (UNIQUE), starts_on, ends_on, status ('OPEN'|'SOFT_CLOSED'|'HARD_CLOSED'), created_at, updated_at` and an exclusion constraint forbidding overlapping `[starts_on, ends_on]` ranges.
- The only rows ever inserted come from first-run setup (`core.bootstrap_first_admin`, migration `20260823210000`, line ~88), which the setup screen fills with the current calendar year (`src/features/setup/SetupScreen.tsx` lines 95–97: code `"2026"`, `2026-01-01`..`2026-12-31`).
- `finance.get_open_fiscal_period(p_session_token)` (migration `20260722200003`, line 95) returns "the earliest OPEN period" — no date awareness.
- The frontend loads it **once at login** (`src/app/AppDataContext.tsx`, `reload()`), and every posting screen sends `openFiscalPeriod.id` plus a document date. Every posting function rejects a document date outside the period (e.g. `20260914090000_ws_f_003_sale_discount.sql` line 224). Sale void and `cash._post_cash_journal` look up "the OPEN period containing today" and raise when there is none.
- There is no SQL function, Tauri command, or screen that creates a period.
- **Result:** from `2027-01-01` every sale, receipt, purchase, payment, adjustment, void and cash-close journal fails.

#### 4.2.2 Decision

**Chosen:** automatic, deterministic rollover inside the database, triggered by the existing `finance.get_open_fiscal_period` read (called at every login and — after this item — whenever the business date changes). Plus a context refresh in the frontend when the business date changes.

Alternatives considered:
- *Admin "Open next year" button in Settings.* Rejected: the Owner is a non-technical shop owner; on 1 January nobody will remember, and the till would stop until an admin logs in. It also adds a new command (licence gate change, allowlist decision).
- *Make every posting function pick its own period.* Rejected: touches ~15 posting functions and their Rust/TS contracts — large, risky, and contrary to "smallest complete change".

Accounting rules for the automatic rollover (explicit decisions):
1. A new period is created **only** when no period (any status) covers the Algeria business date **and** that date is **after** the latest existing `ends_on`. Gaps and dates before the first period are never auto-filled (that would be a clock problem, not a new year).
2. New periods are contiguous: `starts_on = previous max(ends_on) + 1 day`, `ends_on = starts_on + 1 year − 1 day`. For the standard calendar-year setup that yields exactly `YYYY-01-01 .. YYYY-12-31`.
3. At most **3** periods are created in one call. If more than 3 would be needed (PC clock wildly in the future), nothing is created and a `WARNING` is logged; the UI then shows its existing "no open period" state.
4. Old periods are **not** closed. Year-end closing is an accounting workflow that does not exist yet and is out of scope. Leaving 2026 `OPEN` changes nothing that works today.
5. `period_code`: `'YYYY'` (e.g. `'2027'`) when the period starts on 1 January; otherwise `'YYYY-MM-DD_YYYY-MM-DD'`. If that code is already used by another row (the table has a UNIQUE constraint), append `'-' || to_char(starts_on, 'YYYYMMDD')`.
6. Who may trigger it: **any authenticated session** (the function already only requires `iam.resolve_session`). Rationale: the creation is fully deterministic (no user input), and blocking it behind an admin permission recreates the "till stops on 1 January" failure for cashier-only shops. The row's `created_at` is the audit trace (no audit table exists for fiscal periods; adding one is out of scope).
7. `get_open_fiscal_period` now returns **the OPEN period that contains today**, or no row. (Before: the earliest OPEN period even if it did not contain today — which could never be posted into with today's date anyway.)
8. Concurrency: two workstations may call at the same moment. A transaction-scoped advisory lock serialises creation; the exclusion constraint is the final safety net.

#### 4.2.3 Data flow after the change

```
Login / business-date change
  → AppDataContext (React) calls ipc.getOpenFiscalPeriod(token)
  → Tauri command get_open_fiscal_period (src-tauri/src/commands/reference.rs:63, unchanged)
  → application::fiscal::get_open_fiscal_period (src-tauri/src/application/fiscal.rs, unchanged)
       SQL: SELECT id, period_code, starts_on, ends_on FROM finance.get_open_fiscal_period($1)
  → finance.get_open_fiscal_period (NEW BODY):
       resolve_session → finance._ensure_fiscal_period_for(today_algeria) → SELECT the OPEN period covering today
  → Option<OpenFiscalPeriod> → React context `openFiscalPeriod`
  → POS / receipts / purchases / payments / adjustments send openFiscalPeriod.id + today
```

#### 4.2.4 Steps

**Step 2.1 — create the migration** `src-tauri/migrations/20260930090000_audit_1_fiscal_period_rollover.sql` with exactly this body between the `SET ROLE` header and the `schema_state` footer (PART 2.1):

```sql
-- Internal: make sure a fiscal period covers p_day by rolling forward
-- contiguous one-year periods after the latest one. See AUDIT-1 plan §4.2.2.
CREATE OR REPLACE FUNCTION finance._ensure_fiscal_period_for(p_day date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_last_end date;
    v_probe date;
    v_needed integer := 0;
    v_start date;
    v_end date;
    v_code text;
    i integer;
BEGIN
    IF p_day IS NULL THEN
        RETURN;
    END IF;

    IF EXISTS (SELECT 1 FROM finance.fiscal_periods fp
               WHERE p_day BETWEEN fp.starts_on AND fp.ends_on) THEN
        RETURN;
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext('stockiha.finance.fiscal_period_rollover'));

    -- Re-check under the lock: another workstation may have just created it.
    IF EXISTS (SELECT 1 FROM finance.fiscal_periods fp
               WHERE p_day BETWEEN fp.starts_on AND fp.ends_on) THEN
        RETURN;
    END IF;

    SELECT max(fp.ends_on) INTO v_last_end FROM finance.fiscal_periods fp;
    IF v_last_end IS NULL OR p_day <= v_last_end THEN
        -- No period at all (setup not done) or p_day falls in a gap / before
        -- the first period: never auto-fill.
        RETURN;
    END IF;

    v_probe := v_last_end;
    LOOP
        v_needed := v_needed + 1;
        v_probe := ((v_probe + 1) + interval '1 year' - interval '1 day')::date;
        EXIT WHEN v_probe >= p_day OR v_needed > 3;
    END LOOP;

    IF v_needed > 3 THEN
        RAISE WARNING 'fiscal period rollover skipped: % is more than 3 years after the last period end %',
            p_day, v_last_end;
        RETURN;
    END IF;

    v_start := v_last_end + 1;
    FOR i IN 1..v_needed LOOP
        v_end := (v_start + interval '1 year' - interval '1 day')::date;
        IF extract(month FROM v_start) = 1 AND extract(day FROM v_start) = 1 THEN
            v_code := to_char(v_start, 'YYYY');
        ELSE
            v_code := to_char(v_start, 'YYYY-MM-DD') || '_' || to_char(v_end, 'YYYY-MM-DD');
        END IF;
        IF EXISTS (SELECT 1 FROM finance.fiscal_periods fp WHERE fp.period_code = v_code) THEN
            v_code := v_code || '-' || to_char(v_start, 'YYYYMMDD');
        END IF;
        INSERT INTO finance.fiscal_periods (period_code, starts_on, ends_on, status)
        VALUES (v_code, v_start, v_end, 'OPEN');
        v_start := v_end + 1;
    END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION finance._ensure_fiscal_period_for(date) FROM PUBLIC;

-- Same signature and return type as 20260722200003 (so owner and grants are
-- kept); now date-aware and self-healing across the year boundary.
CREATE OR REPLACE FUNCTION finance.get_open_fiscal_period(p_session_token text)
RETURNS TABLE (id bigint, period_code text, starts_on date, ends_on date)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_today date := (now() AT TIME ZONE 'Africa/Algiers')::date;
BEGIN
    PERFORM 1 FROM iam.resolve_session(p_session_token);
    PERFORM finance._ensure_fiscal_period_for(v_today);
    RETURN QUERY
        SELECT fp.id, fp.period_code, fp.starts_on, fp.ends_on
        FROM finance.fiscal_periods fp
        WHERE fp.status = 'OPEN'
          AND v_today BETWEEN fp.starts_on AND fp.ends_on
        ORDER BY fp.starts_on
        LIMIT 1;
END;
$$;
```

Pitfalls:
- Inside `RETURNS TABLE (id, period_code, starts_on, ends_on)` those names are also PL/pgSQL variables. **Every** column reference must be qualified with the alias `fp.` (as written) or PostgreSQL raises "column reference is ambiguous".
- Do not add `STABLE` to either function — they insert rows. Default (VOLATILE) is required.
- Do not re-`GRANT` `get_open_fiscal_period`; the existing grant to `stockiha_runtime` is kept by `CREATE OR REPLACE`.
- `date + interval` yields a `timestamp`; the `::date` casts are required.

**Step 2.2 — SQL suite** `src-tauri/tests/finance/audit_1_fiscal_period_rollover_integration.sql` (create the `finance` folder). Register it in `run_current_sql_suites.sh` (PART 2.2). Bootstrap: one ADMIN user and one CASHIER user with sessions (copy ws_i_002 lines 74–86, suffix `aud1fp`). Assertions:

1. **Covering period returned.** Ensure a period covers `CURRENT_DATE` (copy ws_i_002 lines 64–72). `SELECT * FROM finance.get_open_fiscal_period(v_cashier_token)` returns exactly one row and `CURRENT_DATE BETWEEN starts_on AND ends_on`. (Proves a cashier can call it.)
2. **Invalid token rejected.** Calling with `'not-a-token'` raises SQLSTATE `28000` (catch with `EXCEPTION WHEN SQLSTATE '28000' THEN v_blocked := true;`, then assert `v_blocked`).
3. **Idempotent fast path.** `SELECT count(*)` of `finance.fiscal_periods` before and after a second `get_open_fiscal_period` call is equal.
4. **Roll forward by one** (inside a self-rolling-back sub-block, PART 2.2): `v_last_end := max(ends_on)`; call `PERFORM finance._ensure_fiscal_period_for(v_last_end + 10)`; assert exactly one new row with `starts_on = v_last_end + 1`, `ends_on = (v_last_end + 1 + interval '1 year' - interval '1 day')::date`, `status = 'OPEN'`; if `extract(month from v_last_end + 1) = 1 AND extract(day from v_last_end + 1) = 1` assert `period_code = to_char(v_last_end + 1, 'YYYY')`. Call the same function again with the same day → row count unchanged.
5. **Roll forward by two** (sub-block): call with `v_last_end + 400` → exactly 2 new contiguous rows (second `starts_on` = first `ends_on` + 1).
6. **Too far in the future** (sub-block): call with `v_last_end + 365 * 5` → no new row.
7. **Gap / not after the last end** (sub-block): insert a manual period `('AUD1FP-FAR-' || v_suffix, v_last_end + 3000, v_last_end + 3010, 'OPEN')`; call with `v_last_end + 5` → no new row created by the function (count only rows other than the manual one).
8. **Code collision** (sub-block): compute `v_next_start := v_last_end + 1` and the code the function would generate (rule 5 of §4.2.2); insert a dummy row with that code at dates `'1990-01-01'..'1990-12-31'` (if that range overlaps an existing row, use `'1980-01-01'..'1980-12-31'`); call with `v_last_end + 10`; assert the new row's code equals `<expected code> || '-' || to_char(v_next_start, 'YYYYMMDD')`.
(There is deliberately no "post into the rolled period" assertion: that would need a future document date. Assertion 1 proves the returned period is the one the app posts with.)

**Step 2.3 — frontend: refresh the period when the business date changes**
- File: `src/app/AppDataContext.tsx`.
- Add imports: `useRef` from `react`; `currentBusinessDate` from `'../shared/utils/businessDate'`.
- Add a new exported pure function at module level (so it can be unit-tested):
  ```ts
  /** AUD-02: re-fetch the open period once the Algeria business date differs
   *  from the date it was last fetched for, or while no period is loaded. */
  export function shouldRefreshFiscalPeriod(
    lastFetchedFor: string | null,
    today: string,
    hasPeriod: boolean,
  ): boolean {
    return !hasPeriod || lastFetchedFor !== today;
  }
  ```
- Inside `AppDataProvider`:
  - `const periodFetchedForRef = useRef<string | null>(null);`
  - In `reload()`'s success branch, after `setOpenFiscalPeriod(period);` add `periodFetchedForRef.current = currentBusinessDate();`.
  - Add a callback:
    ```ts
    const refreshFiscalPeriod = useCallback(async () => {
      if (!user) return;
      try {
        const period = await ipc.getOpenFiscalPeriod(user.token);
        setOpenFiscalPeriod(period);
        periodFetchedForRef.current = currentBusinessDate();
      } catch {
        // Keep the previous value. A failure here must never set `error`
        // (that would log the user out if it were SESSION_INVALID — AUD-04
        // handles expiry globally) nor flip `loading`.
      }
    }, [user]);
    ```
  - Add an effect:
    ```ts
    useEffect(() => {
      if (!user) return;
      const id = window.setInterval(() => {
        if (shouldRefreshFiscalPeriod(periodFetchedForRef.current, currentBusinessDate(), openFiscalPeriodRef.current !== null)) {
          void refreshFiscalPeriod();
        }
      }, 60_000);
      return () => window.clearInterval(id);
    }, [user, refreshFiscalPeriod]);
    ```
    Also add `const openFiscalPeriodRef = useRef<OpenFiscalPeriod | null>(null);` and keep it in sync with `useEffect(() => { openFiscalPeriodRef.current = openFiscalPeriod; }, [openFiscalPeriod]);` so the interval does not need `openFiscalPeriod` in its dependency list (which would restart the timer on every change).
  - Do **not** change `reload()`'s other behaviour, the context value shape, or the `loading`/`error` semantics.
- Edge cases:
  - The user stays logged in across midnight on 31 December → within ≤ 60 s the new period is fetched (the DB creates it on that call) and every posting screen re-renders with the new id.
  - Backend unreachable at the tick → previous period kept; next tick retries only if the date still differs (it will, because `periodFetchedForRef` was not updated).
  - `getOpenFiscalPeriod` returns `null` (e.g. > 3 years jump) → context becomes `null`; screens show their existing "no open period" banners; the tick retries every minute.

**Step 2.4 — frontend tests**
- New file `tests/fiscalPeriodRefresh.test.ts`: unit-test `shouldRefreshFiscalPeriod`:
  - `(null, '2027-01-01', false) → true`
  - `('2026-12-31', '2027-01-01', true) → true`
  - `('2027-01-01', '2027-01-01', true) → false`
  - `('2027-01-01', '2027-01-01', false) → true`
- New workflow test `tests/fiscal-period-rollover.workflow.test.tsx` (copy the harness — `invokeMock`, `wireInvoke`, `baseHandlers`, `login()` — from `tests/automatic-backup-daily-and-overdue.workflow.test.tsx`; use a login mock with `expires_at` far in the future, e.g. `'2099-01-01T00:00:00Z'`):
  - `vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date('2026-12-31T22:50:00Z') })` (23:50 in Algeria).
  - `get_open_fiscal_period` handler returns `{ id: 1, period_code: '2026', starts_on: '2026-01-01', ends_on: '2026-12-31' }` on the first call and `{ id: 2, period_code: '2027', starts_on: '2027-01-01', ends_on: '2027-12-31' }` afterwards; count calls.
  - Render `<App/>`, log in, wait for the Dashboard heading.
  - `vi.setSystemTime(new Date('2026-12-31T23:10:00Z'))` (00:10 on 1 Jan in Algeria), then `await vi.advanceTimersByTimeAsync(61_000)`.
  - Before the advance, assert the handler call count is exactly `1`; after it, assert the count is `>= 2` (use `toBeGreaterThanOrEqual(2)`).
  - `afterEach(() => vi.useRealTimers())`.
  - If this test hangs for > 20 s despite `shouldAdvanceTime`, delete only this workflow test file, keep the unit test, and record the deviation in the Result Report.

**Step 2.5 — version marker** → `'AUDIT-1.2'`.

#### 4.2.5 Must not change
Rust `fiscal.rs`/`reference.rs`; `finance.list_fiscal_periods`; the setup flow; any posting function.

#### 4.2.6 Acceptance criteria
- New SQL suite passes (all 8 assertions), and the migration re-applies cleanly a second time.
- On a database whose only period ends yesterday, the first `get_open_fiscal_period` call creates the next one-year period and returns it.
- An app left open across midnight on 31 Dec picks up the new period within 60 s.
- `npm test`, `npm run typecheck`, `npm run lint` pass.

---

### WORK ITEM 3 — AUD-03: correct business dates on the stock-receipt and POS screens

#### 4.3.1 Problem (evidence)
- `src/features/inventory/StockReceiptScreen.tsx` line ~217 sends `documentDate: openFiscalPeriod.starts_on` → every stock receipt is dated 1 January (the period start), whatever the real date. Journals, documents lists and reports show the wrong date.
- `src/features/pos/PosScreen.tsx` defines its own `currentLocalDate()` (line 76) from the PC's local clock/timezone and uses it at lines ~489 and ~525. Everything else (purchases, customer payments, sale void, cash journals, reports) uses the Algeria business date. On a PC whose timezone is not Algeria, POS dates can differ by one day around midnight — which after AUD-02 matters at the year boundary.

#### 4.3.2 Steps

**Step 3.1 — StockReceiptScreen**
- File: `src/features/inventory/StockReceiptScreen.tsx`.
- Import `currentBusinessDate` from `'../../shared/utils/businessDate'`.
- In the component body, before `inputsValid`, add:
  ```ts
  const businessDate = currentBusinessDate();
  const periodCoversToday =
    openFiscalPeriod != null &&
    businessDate >= openFiscalPeriod.starts_on &&
    businessDate <= openFiscalPeriod.ends_on;
  ```
  (ISO `YYYY-MM-DD` strings compare correctly as strings.)
- In `inputsValid`, replace `openFiscalPeriod != null &&` with `periodCoversToday &&`.
- In `onSubmit`, replace `documentDate: openFiscalPeriod.starts_on,` with `documentDate: businessDate,`.
- Change the warning banner condition (line ~247) from `openFiscalPeriod == null ? ...` to `!periodCoversToday ? ...` (same `Banner`, same text `t('errors.preconditionFailed')`).
- Edge case: the idempotent retry path (`requestId` reused after `UNKNOWN_ERROR`) will now send today's date again; if the retry happens after midnight the backend's idempotency check sees a different payload hash → `IDEMPOTENCY_CONFLICT`, which the screen already shows as an error. That is correct behaviour (a new day is a new operation); do not add special handling.

**Step 3.2 — PosScreen**
- File: `src/features/pos/PosScreen.tsx`.
- Import `currentBusinessDate` from `'../../shared/utils/businessDate'`.
- Replace every call `currentLocalDate()` with `currentBusinessDate()` (two call sites: ~489 and ~525).
- Delete the now-unused function `currentLocalDate` (lines 76–82). Do **not** touch `currentLocalTime()`.
- Do not change `saleIntentDate` logic (it freezes the date for idempotent retries — correct).

**Step 3.3 — tests**
- `tests/stock-receipt.workflow.test.tsx`: the mock `get_open_fiscal_period` (line ~101) returns `starts_on: '2026-07-01', ends_on: '2026-07-31'`, which no longer covers "today" → the form would stay disabled. Change it to `starts_on: '2000-01-01', ends_on: '2099-12-31'` (keep `id: 9`, `period_code: '2026'`). Search the file for any other `'2026-07-01'` that is asserted as a document date and update it.
- In the test `posts stock receipt with selected item and displays resulting metrics`, after `expect(postArgs!.unitCost).toBe('820.00');` add `expect(postArgs!.documentDate).toBe(currentBusinessDate());` (import from `'../src/shared/utils/businessDate'`).
- Add a test in the same file: with the period mocked as `'2000-01-01'..'2000-12-31'`, after login and navigating to Stock receipt, the preconditionFailed banner text (English value of `errors.preconditionFailed` in `locales.ts`) is visible and the submit button is disabled.
- Run `npx vitest run tests/stock-receipt.workflow.test.tsx tests/pos-touch.workflow.test.tsx tests/pos-discount.workflow.test.tsx tests/pos-credit-limit.workflow.test.tsx tests/stock-adjustment.workflow.test.tsx tests/inventory.workflow.test.tsx`. If a POS test asserted a `document_date` equal to a PC-local date string, update it to `currentBusinessDate()`.

**Step 3.4 — version marker** → `'AUDIT-1.3'`.

#### 4.3.3 Acceptance criteria
- A stock receipt posted today carries today's Algeria date.
- POS, stock receipt, purchases and customer payments all use `currentBusinessDate()`; `grep -rn "currentLocalDate" src` returns nothing.

---

### WORK ITEM 4 — AUD-01: cash-session close uses the signed expected-cash formula and posts the variance journal

#### 4.4.1 Problem (evidence)
- The Rust layer calls `sales.submit_cash_session_count` and `sales.approve_cash_session_variance` (`src-tauri/src/application/cash_session.rs` lines 209 and 234).
- Those are the original versions (migration `20260731130000_cash_session_lifecycle.sql`). The expected-cash line (≈ line 777) is `round(v_opening_float + coalesce(sum(m.amount), 0), 2)` — it **adds** `CASH_OUT` amounts, which `cash.record_cash_movement` stores as **positive** numbers. Refunds and sale voids are stored negative, so only cash-outs are wrong. Effect: expected = float + sales + cash-in + **cash-out** (should be − cash-out) → a fake shortage of 2 × cash-out on every day with an expense, frequent needless manager approvals, wrong P&L "cash shortages", and wrong stored figures on the printed session report.
- WS-F-005 (`20260916090000_ws_f_005_cash_session_completion.sql`, lines 392 and 599) wrote correct `cash.submit_cash_session_count` and `cash.approve_cash_session_variance` (same signatures, same JSON result shape: `cash_session_id, close_attempt_id, status, expected_amount, counted_amount, variance_amount, requires_manager_approval`) that (a) use `CASE WHEN m.movement_type = 'CASH_OUT' THEN -m.amount ELSE m.amount END` and (b) post the variance to the ledger through `cash._post_cash_journal` (shortfall: debit `CASH_VARIANCE`, credit `CASH_DESK`; overage: the reverse). They were **never granted** to `stockiha_runtime` and **never called**.
- The WS-I-2 SQL suite documents this defect in its comment block at lines ~270–289 and deliberately uses the inflated figure.

#### 4.4.2 Decision
Turn the two `sales.*` functions into thin wrappers that delegate to the `cash.*` functions. Keep Rust untouched.

Alternatives: *change Rust to call `cash.*` and grant them* — rejected because it leaves two live implementations in the database (anything else calling `sales.*` would still get the wrong answer) and touches Rust + grants. Delegation gives one implementation and zero contract change.

#### 4.4.3 Steps

**Step 4.1 — migration** `src-tauri/migrations/20260930091000_audit_1_cash_close_signed_expected.sql`, body:

```sql
-- The app calls sales.*; WS-F-005's corrected logic lives in cash.*. Delegate
-- so there is exactly one implementation (signed expected cash + variance
-- journal). Signatures and return types are unchanged, so owner and the
-- existing EXECUTE grant to stockiha_runtime are kept.
CREATE OR REPLACE FUNCTION sales.submit_cash_session_count(
    p_session_token text,
    p_cash_session_id bigint,
    p_counts jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    RETURN cash.submit_cash_session_count(p_session_token, p_cash_session_id, p_counts);
END;
$$;

CREATE OR REPLACE FUNCTION sales.approve_cash_session_variance(
    p_session_token text,
    p_cash_session_id bigint,
    p_close_attempt_id bigint,
    p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    RETURN cash.approve_cash_session_variance(p_session_token, p_cash_session_id, p_close_attempt_id, p_reason);
END;
$$;

-- The cash.* versions are reached only through the sales.* wrappers (which run
-- as the owner). They were created without an explicit REVOKE, so PostgreSQL's
-- default PUBLIC EXECUTE applies; remove it. Do NOT grant them to stockiha_runtime.
REVOKE ALL ON FUNCTION cash.submit_cash_session_count(text, bigint, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION cash.approve_cash_session_variance(text, bigint, bigint, text) FROM PUBLIC;
```

Before writing it, confirm the two `cash.*` signatures by opening `20260916090000_ws_f_005_cash_session_completion.sql` lines 392–396 and 599–604: they must be exactly `(text, bigint, jsonb)` and `(text, bigint, bigint, text)`. If not: STOP.

Pitfall: the permission check (`CLOSE_CASH_SESSION`, etc.) happens inside the `cash.*` function using the caller's session token — the wrapper must pass the token through unchanged (as written). Never resolve the session in the wrapper as well (it would double-reset `stockiha.actor_user_id`).

**Step 4.2 — fix the WS-I-2 suite fixture** `src-tauri/tests/reports/ws_i_002_finance_reports_integration.sql`:
- The fixture: float 1000, two cash sales totalling 1500, `CASH_OUT` EXPENSE 500, `CASH_OUT` OTHER 50, `CASH_IN` 200. Correct expected = 1000 + 1500 + 200 − 550 = **2150.00**. The suite wants the session to close **30 below expected**, i.e. counted **2120.00**.
- Replace the denomination-count expression (the `CASE WHEN code = 'DZD_1000' THEN 3 WHEN code = 'DZD_200' THEN 1 WHEN code = 'DZD_20' THEN 1 ELSE 0 END`) with `CASE WHEN code = 'DZD_1000' THEN 2 WHEN code = 'DZD_100' THEN 1 WHEN code = 'DZD_20' THEN 1 ELSE 0 END` (2000 + 100 + 20 = 2120). `DZD_100` exists in `cash.denominations` (seeded).
- Replace the comment block above it (the one explaining the unsigned sum and "3250.00") with: `-- Expected (signed, WS-F-005/AUDIT-1 AUD-01): 1000 + 1500 + 200 - 550 = 2150.00. Counted 30 below = 2120.00 (2x1000 + 1x100 + 1x20).`
- Replace the long comment under "2. get_cash_flow.net_drawer_flow" (lines ~270–289) with a two-line comment: `-- 2. net_drawer_flow checked against the movements: SALE 1500 + CASH_IN 200 - CASH_OUT 550 = 1150.00. (The unsigned-sum close defect noted here before is fixed by AUDIT-1 AUD-01.)` Keep the assertion itself unchanged.
- If any other assertion in this suite now fails **only** because the close posts a `CASH_VARIANCE` journal of 30.00 (e.g. a trial-balance total), adjust that expected figure by exactly 30.00 on the right account and add a comment `-- +30.00 CASH_VARIANCE journal from the session close (AUD-01)`. Any other kind of failure: STOP.

**Step 4.3 — new SQL suite** `src-tauri/tests/cash/audit_1_cash_close_signed_expected_integration.sql` (register it, PART 2.2). Bootstrap ADMIN (holds `CLOSE_CASH_SESSION`, `APPROVE_CASH_OUT`) with session, warehouse, a fiscal period covering `CURRENT_DATE`, one variant with stock (copy ws_i_002 lines 64–102, suffix `aud1cc`). Call `PERFORM cash.save_session_policy(v_admin_token, 100.00);` (variance tolerance 100 DZD). Scenarios:
1. **Exact count, no journal.** Open session (float 1000), one cash sale of 3 × 500, `cash.record_cash_movement(v_admin_token, v_session, 'CASH_OUT', 500.00, 'EXPENSE', 'aud1 expense', NULL)`. `sales.begin_cash_session_close`, then `sales.submit_cash_session_count` with counts totalling 2000 (2 × `DZD_1000`). Assert `result ->> 'expected_amount' = '2000.00'`, `variance_amount = '0.00'`, `status = 'CLOSED'`, and no row in `finance.journal_entries` with `source_type = 'CASH_SESSION' AND source_id = v_session`.
2. **Small shortfall auto-accepted, journal posted.** New session, same sale and cash-out; count 1970 (1×`DZD_1000`, 4×`DZD_200`, 1×`DZD_100`, 1×`DZD_50`, 1×`DZD_20` = 1970). Assert `expected_amount = '2000.00'`, `variance_amount = '-30.00'`, `status = 'CLOSED'`; exactly one journal with `source_type = 'CASH_SESSION' AND source_id = v_session2`; its lines: `CASH_VARIANCE` debit 30.00 / `CASH_DESK` credit 30.00; `sum(debit) = sum(credit)`.
3. **Large shortfall needs approval.** New session, same; count 1800 (1×`DZD_1000`, 4×`DZD_200`). Assert `status = 'PENDING_APPROVAL'`, `requires_manager_approval = true`, and no `CASH_SESSION` journal yet. Then `sales.approve_cash_session_variance(v_admin_token, v_session3, (result ->> 'close_attempt_id')::bigint, 'aud1 approval')` → assert the session is `CLOSED` and exactly one `CASH_SESSION` journal of 200.00 (`CASH_VARIANCE` debit / `CASH_DESK` credit).
4. **Overage.** New session, same; count 2040 (2×`DZD_1000`, 2×`DZD_20`) → `variance_amount = '40.00'`, journal `CASH_DESK` debit 40.00 / `CASH_VARIANCE` credit 40.00.
5. **Wrapper grants.** `SELECT has_function_privilege('stockiha_runtime', 'sales.submit_cash_session_count(text,bigint,jsonb)', 'EXECUTE')` is true; `has_function_privilege('stockiha_runtime', 'cash.submit_cash_session_count(text,bigint,jsonb)', 'EXECUTE')` is false.

(Look up how ws_i_002 builds the `p_counts` jsonb from `cash.denominations` codes and reuse that exact pattern. Look up the tolerance semantics in `cash.submit_cash_session_count` — `v_threshold` from `cash.session_policy` — and if 100.00 does not make −30 auto-accept and −200 require approval, choose tolerance values that do and note the values in a comment.)

**Step 4.4 — run** all cash/sales suites: `s4_002_cash_session_lifecycle.sql`, `s4_002_cash_session_ownership_integration.sql`, `ws_f_005_cash_session_completion_integration.sql`, `ws_f_005b_cash_out_approval_integration.sql`, `ws_f_006_sale_void_integration.sql`, `ws_m_003_session_report_integration.sql`, `ws_i_002`, and the new suite. None of the older suites record cash-outs (verified: `CASH_OUT` count 0 in s4_002 and ws_f_006), so their expected amounts do not change. What **can** change: sessions closed with a non-zero variance now post a journal, which requires a fiscal period covering `CURRENT_DATE`. If such a suite fails with `no open fiscal period covers today`, add the standard "lookup-or-insert a period covering CURRENT_DATE" block (ws_i_002 lines 64–72) at the top of that suite. If a suite asserts a journal count that now differs by the variance journal, adjust by exactly one and comment it. Any other failure: STOP.

**Step 4.5 — version marker** → `'AUDIT-1.4'`.

#### 4.4.4 Edge cases and failure scenarios
- **Pending approvals at upgrade time.** A close attempt created before this migration by the old function carries an inflated variance; approving it after the upgrade would post a journal for that inflated amount. Mitigation (manual, documented in PART 6): before installing this build, make sure no cash session is waiting for variance approval (approve or cancel it with the old build). The migration itself does not modify any data.
- **Past sessions** keep their stored (inflated) `expected_amount`/`variance_amount`. Closed sessions are immutable history; they are **not** rewritten. P&L "cash shortages" for past periods therefore still include the old inflated amounts. This is recorded in the Result Report.
- **No period covering today** → close with non-zero variance fails with `PRECONDITION_FAILED`. AUD-02 guarantees the period exists as soon as any user loads the app that day.

#### 4.4.5 Acceptance criteria
- New suite passes all 5 scenarios; ws_i_002 passes with the corrected fixture.
- With a 500 DZD expense cash-out and an exact count, the close shows variance 0 and needs no approval.
- Non-zero variances appear in the ledger (`CASH_VARIANCE`), journals balance.
- `src-tauri/src/` unchanged.

---

### WORK ITEM 5 — AUD-07: P&L includes stock-adjustment losses and gains

#### 4.5.1 Problem (evidence)
`reports.get_profit_and_loss` (`20260928090000_ws_i_002_finance_reports.sql` lines 7–68) computes `net_result = net_sales − cost − expenses − shortages + overages`. Stock adjustments (`inventory.confirm_stock_adjustment`, latest body in `20260826095100_...account_id.sql`) post `INVENTORY_ADJUSTMENT_LOSS` (decrease) or `INVENTORY_ADJUSTMENT_GAIN` (increase) journals for `round(abs(inventory_value_delta), 2)`, but the P&L ignores them.

#### 4.5.2 Decision
Add two fields, `stock_losses` and `stock_gains`, computed from `inventory.stock_adjustments` joined to posted `core.business_documents` in the period, using the **same rounding as the journal** (`round(abs(inventory_value_delta), 2)` per adjustment). New formula: `net_result = net − cost − expenses − shortages + overages − stock_losses + stock_gains`.

Alternative: read the journal lines by account code. Rejected for now: the rest of this function is built from operational tables, and mixing sources inside one statement makes reconciliation harder to explain. Both give identical totals because the amount formula is identical.

#### 4.5.3 Steps

**Step 5.1 — migration** `src-tauri/migrations/20260930092000_audit_1_pnl_stock_adjustments.sql`:
- Copy the **entire** `CREATE OR REPLACE FUNCTION reports.get_profit_and_loss ... $$;` block from `20260928090000_ws_i_002_finance_reports.sql` lines 7–68 into the new file (same signature `(p_session_token text, p_from date, p_to date) RETURNS jsonb`, same `LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog`).
- Add to `DECLARE`: `v_stock_loss numeric; v_stock_gain numeric;`.
- After the cash-session variance `SELECT ... INTO v_short, v_over ...;` add:
  ```sql
  SELECT coalesce(sum(round(abs(sa.inventory_value_delta), 2)) FILTER (WHERE sa.quantity_delta < 0), 0),
         coalesce(sum(round(abs(sa.inventory_value_delta), 2)) FILTER (WHERE sa.quantity_delta > 0), 0)
  INTO v_stock_loss, v_stock_gain
  FROM inventory.stock_adjustments sa
  JOIN core.business_documents d ON d.id = sa.document_id
  WHERE d.status = 'POSTED'
    AND d.document_date BETWEEN p_from AND p_to;
  ```
- In the `RETURN jsonb_build_object(...)`, add after `'cash_overages', ...`:
  `'stock_losses', v_stock_loss::numeric(14,2)::text,` and `'stock_gains', v_stock_gain::numeric(14,2)::text,`
- Change `'net_result'` to `(v_net - v_cost - v_exp - v_short + v_over - v_stock_loss + v_stock_gain)::numeric(14,2)::text`.
- No `GRANT` needed (kept by `CREATE OR REPLACE`). `reports.get_monthly_summary` calls this function, so its `pnl` object gains the two fields automatically — do not redefine `get_monthly_summary`.

**Step 5.2 — SQL test.** Extend `src-tauri/tests/reports/ws_i_002_finance_reports_integration.sql`:
- After the existing P&L assertions (1a–1e), add a block (keep the existing assertions unchanged — the fixture has no adjustments, so `stock_losses = '0.00'` there):
  1. Assert `v_pnl ->> 'stock_losses' = '0.00'` and `v_pnl ->> 'stock_gains' = '0.00'` for the existing fixture.
  2. Post a negative adjustment: `inventory.confirm_stock_adjustment(v_admin_token, md5('wsi002-adj-loss-' || v_suffix)::uuid, sha256(('wsi002-adj-loss-' || v_suffix)::bytea), v_warehouse_id, v_p1_variant_id, v_unit_id, -2.000, 'DAMAGE', NULL, v_period_id, v_today)` (argument order from the function signature: token, request id, payload hash, warehouse, variant, unit, quantity delta, reason, note, period, date). The position has WAC 100 → value delta −200.
  3. Post a positive adjustment of `+1.000`, reason `'FOUND_STOCK'` (value +100 at the then-current WAC; read the actual WAC-based amount back from `inventory.stock_adjustments.inventory_value_delta` rather than hard-coding it).
  4. Re-run `reports.get_profit_and_loss` for today; assert `stock_losses = '200.00'`, `stock_gains` equals `round(<found-stock value delta>, 2)`, and `net_result = gross_profit − 500.00 − 30.00 − 200.00 + stock_gains`.
- The admin role holds `MANAGE_INVENTORY`; inventory corrections are enabled by default (`onboarding.feature_settings.inventory_corrections_enabled`). If the suite's database has them disabled, add `UPDATE onboarding.feature_settings SET inventory_corrections_enabled = true;` before posting.

**Step 5.3 — DTO.** `src/shared/ipc/reportsDto.ts`, `interface ProfitAndLoss` (line ~143): add `stock_losses: string;` and `stock_gains: string;` after `cash_overages`.

**Step 5.4 — copy.** `src/features/reports/common/reportCopy.ts`, add to **each** of the three blocks next to `cashOverages`:
- en: `stockLosses: 'Stock losses (damage, shrinkage, expiry)'`, `stockGains: 'Stock found (gains)'`
- fr: `stockLosses: 'Pertes de stock (casse, démarque, péremption)'`, `stockGains: 'Stock retrouvé (gains)'`
- ar: `stockLosses: 'خسائر المخزون (تلف، نقص، انتهاء الصلاحية)'`, `stockGains: 'مخزون مُكتشف (أرباح)'`
- Also change `managementViewNote` in all three blocks to mention adjustments:
  - en: `'Management view based on sales, cash and stock-adjustment records. The accounting view is in the Accounting tab.'`
  - fr: `'Vue de gestion fondée sur les ventes, la caisse et les ajustements de stock. La vue comptable se trouve dans l’onglet Comptabilité.'`
  - ar: `'عرض إداري مبني على المبيعات والصندوق وتسويات المخزون. العرض المحاسبي موجود في تبويب المحاسبة.'`

**Step 5.5 — P&L screen.** `src/features/reports/finance/ProfitLossReport.tsx`: after the `cashOverages` `<tr>`, add two rows in the same style:
```tsx
<tr>
  <td>{copy.stockLosses}</td>
  <td data-testid="pl-stock-losses">{data.stock_losses}</td>
</tr>
<tr>
  <td>{copy.stockGains}</td>
  <td data-testid="pl-stock-gains">{data.stock_gains}</td>
</tr>
```

**Step 5.6 — print models.** `src/features/reports/common/printModels.ts`:
- `buildProfitLossModel`: after `{ label: ctx.copy.cashOverages, amount: data.cash_overages },` add `{ label: ctx.copy.stockLosses, amount: data.stock_losses },` and `{ label: ctx.copy.stockGains, amount: data.stock_gains },`.
- `buildMonthlySummaryModel`: after the `cashOverages` row add `{ metric: ctx.copy.stockLosses, value: data.pnl.stock_losses },` and `{ metric: ctx.copy.stockGains, value: data.pnl.stock_gains },`.

**Step 5.7 — monthly screen.** `src/features/reports/finance/MonthlySummaryReport.tsx`: after the `msum-overages` `KpiCard` (line ~127) add `<KpiCard label={copy.stockLosses} value={data.pnl.stock_losses} testId="msum-stock-losses" />`.

**Step 5.8 — frontend tests.** `tests/reports-finance.workflow.test.tsx`: every P&L fixture object (e.g. line ~128 area) must gain `stock_losses: '0.00', stock_gains: '0.00'` (TypeScript will flag missing fields). Add one test: fixture with `stock_losses: '200.00'` → `pl-stock-losses` shows `200.00`.

**Step 5.9 — version marker** → `'AUDIT-1.5'`.

#### 4.5.4 Acceptance criteria
- A 200 DZD damage write-off lowers the P&L net result by exactly 200.00; found stock raises it by its value.
- Monthly summary shows the stock-loss KPI; print/PDF of both reports include the two new lines.

---

### WORK ITEM 6 — AUD-04: session-expiry handling (warning + automatic return to login)

#### 4.6.1 Problem (evidence)
- `SESSION_LIFETIME = 12 h` (`src-tauri/src/application/auth.rs` line 29); no renewal.
- `SessionContext` (`src/shared/session/SessionContext.tsx`) claims "A `SESSION_INVALID` result anywhere clears the session", but the only place that does it is `AppRouter.tsx` line ~447, which only watches `AppDataContext.error` (loaded once at login). Every other screen just shows "Your session has expired" and keeps the user on a dead screen.
- **Important trap:** a wrong password at login also returns `SESSION_INVALID` (`auth.rs` lines 80–95). The global handler must never react to the `login` command.
- **Second trap:** a background poll started with an *old* token can fail after the user has logged in again; it must not log out the *new* session.

#### 4.6.2 Decision
- No backend/security change (lifetime stays 12 h, no sliding renewal — that would be an authentication-policy change needing an ADR).
- One shared `invoke` wrapper in the frontend notifies listeners when a call fails with `SESSION_INVALID`, passing the token that was used. `SessionProvider` clears the session only if that token equals the current token.
- A warning banner appears in the last 30 minutes before `expires_at` with a "Sign in again" button.
- The login screen explains why the user was returned there.

#### 4.6.3 Steps

**Step 6.1 — invoke wrapper.** New file `src/shared/ipc/invoke.ts`:
```ts
/**
 * AUD-04 — the one place every gateway's IPC call passes through. Behaves
 * exactly like Tauri's `invoke` (same resolve/reject values); additionally,
 * when a call made WITH a session token is rejected as SESSION_INVALID, it
 * tells the session layer which token was rejected. `login` is excluded:
 * a wrong password is reported with the same code.
 */
import { invoke as tauriInvoke } from '@tauri-apps/api/core';

import { parseTauriError } from '../utils/tauriError';

type SessionRejectedListener = (rejectedToken: string) => void;

const listeners = new Set<SessionRejectedListener>();

export function onSessionRejected(listener: SessionRejectedListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await tauriInvoke<T>(command, args);
  } catch (error: unknown) {
    if (command !== 'login' && parseTauriError(error) === 'SESSION_INVALID') {
      const token = args?.sessionToken;
      if (typeof token === 'string' && token.length > 0) {
        for (const listener of [...listeners]) {
          try {
            listener(token);
          } catch {
            // A listener must never change what the caller receives.
          }
        }
      }
    }
    throw error;
  }
}
```

**Step 6.2 — route every gateway through it.** In each of these 17 files, change the import line `import { invoke } from '@tauri-apps/api/core';` (or the double-quoted variant) to `import { invoke } from './invoke';` — nothing else in the file changes:
`cashSessionGateway.ts, creditSaleGateway.ts, customerGateway.ts, documentGateway.ts, drawerGateway.ts, gateway.ts, iamGateway.ts, inventoryCorrectionsGateway.ts, licenceGateway.ts, onboardingGateway.ts, openingStateApplicationGateway.ts, openingStateGateway.ts, openingStateLifecycleGateway.ts, receivablesGateway.ts, recoveryGateway.ts, reportsGateway.ts, saleVoidGateway.ts` (all in `src/shared/ipc/`).
- Do **not** change `src/features/update/useAppUpdate.ts` (no session token involved).
- Verify: `grep -rn "@tauri-apps/api/core" src --include=*.ts --include=*.tsx` must list only `src/shared/ipc/invoke.ts` and `src/features/update/useAppUpdate.ts`.
- Pitfall: some gateways pass arguments typed as a specific interface rather than `Record<string, unknown>`. If `npm run typecheck` reports an argument type error at a call site, widen the wrapper's parameter to `args?: Parameters<typeof tauriInvoke>[1]` and read the token with `const token = (args as Record<string, unknown> | undefined)?.sessionToken;`. Do not change any gateway call site.
- Tests keep working because they mock `@tauri-apps/api/core`, which the wrapper imports.

**Step 6.3 — pure expiry helper.** New file `src/shared/session/sessionExpiry.ts`:
```ts
export const SESSION_WARNING_WINDOW_MS = 30 * 60 * 1000;

export type SessionExpiryState = 'OK' | 'EXPIRING_SOON' | 'UNKNOWN';

/** AUD-04 — `EXPIRING_SOON` only inside the last 30 minutes BEFORE expiry.
 *  After expiry it returns 'OK' on purpose: the backend's SESSION_INVALID
 *  (handled globally) is the authority, and test fixtures use fixed
 *  expiry dates that must not start showing banners once they pass. */
export function sessionExpiryState(expiresAt: string | null, nowMs: number): SessionExpiryState {
  if (!expiresAt) return 'UNKNOWN';
  const expiresMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresMs)) return 'UNKNOWN';
  const remaining = expiresMs - nowMs;
  return remaining > 0 && remaining <= SESSION_WARNING_WINDOW_MS ? 'EXPIRING_SOON' : 'OK';
}

/** HH:MM in Africa/Algiers, 24-hour, for the banner text. */
export function formatExpiryTime(expiresAt: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Algiers', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(expiresAt));
}
```

**Step 6.4 — SessionContext.** `src/shared/session/SessionContext.tsx`:
- `AuthenticatedUser` gains `expiresAt: string;`.
- In `login`, `setUser({ username, token: result.session_token, expiresAt: result.expires_at });`.
- Add state `const [sessionEnded, setSessionEnded] = useState(false);`.
- Add to the context interface and value: `sessionEnded: boolean;` and `acknowledgeSessionEnded: () => void;` (`() => setSessionEnded(false)`).
- In `login`, after `setUser(...)`, call `setSessionEnded(false);`.
- Add a ref that always holds the current user, and an effect that subscribes to rejections:
  ```ts
  const userRef = useRef<AuthenticatedUser | null>(null);
  useEffect(() => {
    userRef.current = user;
  }, [user]);

  useEffect(() => {
    return onSessionRejected((rejectedToken) => {
      if (userRef.current?.token !== rejectedToken) return; // stale token or already logged out
      userRef.current = null;
      setUser(null);
      setActiveCashSession(null);
      setSessionEnded(true);
    });
  }, []);
  ```
  (Import `onSessionRejected` from `'../ipc/invoke'`; add `useEffect` and `useRef` to the `react` import.) Also set `userRef.current = null` at the start of `clearSession` so a rejection arriving right after an explicit logout is ignored.
- Update the file header comment's last sentence to: "A `SESSION_INVALID` result for the current token anywhere clears the session (via `ipc/invoke.ts`) and routes the user back to login with an explanation."
- Leave `clearSession` and `logout` unchanged. Explicit `logout()` must **not** set `sessionEnded`.
- Find every other place that constructs an `AuthenticatedUser` (`grep -rn "token:" src/shared/session src/features/auth tests | grep -i user`) — test helpers that build a user object directly must add `expiresAt`.

**Step 6.5 — i18n keys** (`src/shared/i18n/locales.ts`, all three dictionaries, next to the `auth.*` keys):
| key | en | fr | ar |
|---|---|---|---|
| `session.expiringSoon` | `Your sign-in ends at {time}. Finish the current operation, then sign in again.` | `Votre connexion se termine à {time}. Terminez l’opération en cours, puis reconnectez-vous.` | `تنتهي جلستك على الساعة {time}. أكمل العملية الجارية ثم سجّل الدخول من جديد.` |
| `session.signInAgain` | `Sign in again` | `Se reconnecter` | `تسجيل الدخول من جديد` |
| `session.endedNotice` | `Your session ended (sessions last 12 hours). Please sign in again.` | `Votre session est terminée (elle dure 12 heures). Veuillez vous reconnecter.` | `انتهت جلستك (مدة الجلسة 12 ساعة). يرجى تسجيل الدخول من جديد.` |

**Step 6.6 — warning banner.** New file `src/shared/session/SessionExpiryBanner.tsx`:
- Uses `useSession()`, `useI18n()`, `Banner` and `Button` from `'../components'`.
- `const [now, setNow] = useState(() => Date.now());` + an effect with `window.setInterval(() => setNow(Date.now()), 60_000)` (cleared on unmount).
- If `sessionExpiryState(user?.expiresAt ?? null, now) !== 'EXPIRING_SOON'` → return `null`.
- Otherwise render `<Banner tone="warning" testId="session-expiring-banner"><p>{t('session.expiringSoon', { time: formatExpiryTime(user.expiresAt) })}</p><Button type="button" onClick={() => void logout()} data-testid="session-sign-in-again">{t('session.signInAgain')}</Button></Banner>`. (If `Button` does not forward `data-testid`, omit that attribute and find it by role/name in tests.)
- Mount it in `src/app/AppRouter.tsx`, `AuthenticatedApp`'s return, directly after `<LicenceBanner onOpenLicence={openLicenceCard} />`.

**Step 6.7 — login screen notice.** `src/features/auth/LoginScreen.tsx`:
- Read `sessionEnded` and `acknowledgeSessionEnded` from `useSession()`.
- Above the form, when `sessionEnded` is true, render `<Banner tone="info" testId="session-ended-notice">{t('session.endedNotice')}</Banner>`.
- The notice disappears automatically on successful login (`login` sets it false). Do not clear it on keystrokes.

**Step 6.8 — AppRouter cleanup.** Keep the existing `useEffect` that clears the session when `AppDataContext.error` is `SESSION_INVALID` (harmless, redundant). Do not remove it.

**Step 6.9 — tests.**
- `tests/sessionExpiry.test.ts` (unit):
  - `sessionExpiryState(null, 0) === 'UNKNOWN'`; `('garbage', 0) === 'UNKNOWN'`.
  - expires in 31 min → `'OK'`; in 30 min exactly → `'EXPIRING_SOON'`; in 1 min → `'EXPIRING_SOON'`; 1 min ago → `'OK'`.
  - `formatExpiryTime('2026-09-25T12:05:00Z') === '13:05'` (Algeria is UTC+1, no DST).
- `tests/session-expiry.workflow.test.tsx` (copy the harness from `tests/automatic-backup-daily-and-overdue.workflow.test.tsx`):
  1. **Rejected current token logs out with notice:** login (token `'tok'`, `expires_at: '2099-01-01T00:00:00Z'`); make `get_dashboard_summary` reject with `{ code: 'SESSION_INVALID' }` **after** login (use a flag); trigger a dashboard reload (or navigate to a screen whose first call rejects — e.g. make `list_customers` reject and navigate to Customers); expect the login form to appear and `session-ended-notice` to be visible.
  2. **Wrong password does not show the notice:** `login` handler rejects with `{ code: 'SESSION_INVALID' }`; submit the form; expect the normal login error text and **no** `session-ended-notice`.
  3. **Stale token does not log out the new session:** first login returns token `'old'`; log out; log in again returning token `'new'`; then invoke any gateway call manually with `sessionToken: 'old'` that rejects `SESSION_INVALID` (e.g. `await import('../src/shared/ipc/reportsGateway').then(m => m.getReportNotifications('old')).catch(() => {})`); expect the app still shows the Dashboard heading.
  4. **Warning banner:** login with `expires_at` = now + 20 minutes (ISO string computed in the test) → `session-expiring-banner` visible; clicking "Sign in again" shows the login form **without** `session-ended-notice`.
- Run `npx vitest run` for the whole suite — every workflow test logs in, so all must still pass.

**Step 6.10 — version marker** → `'AUDIT-1.6'`.

#### 4.6.4 Edge cases
- Two tabs/windows: not applicable (single-instance app).
- `logout` IPC itself returning `SESSION_INVALID` with the current token: the session is already cleared locally before the call (`clearSession()` first), so the listener finds no matching user → no notice. Correct.
- Cash sale in progress when the session expires: the confirm call fails with `SESSION_INVALID` → the user is returned to login; the cart is lost, but the sale was **not** posted (the backend rejected it before posting). The warning banner 30 minutes earlier is the mitigation. Record this in the manual checks.
- `expires_at` is UTC ISO from the backend; `Date.parse` handles it.

#### 4.6.5 Acceptance criteria
- After the backend rejects the current token, the user lands on the login screen with the explanation, from any screen.
- Wrong password never shows that explanation.
- 30 minutes before expiry a warning with a working "Sign in again" button is shown.
- No backend file changed.

---

### WORK ITEM 7 — AUD-05: historical-finance manual entry is approved so it counts

#### 4.7.1 Problem (evidence)
`src/features/onboarding/HistoricalFinanceScreen.tsx`, `stageManual()` (lines ~559–612): creates a batch (`MANUAL`), replaces its data (row `reviewStatus: 'READY'`), validates it, shows "Manual row staged and validated." and stops. `approveHistoricalFinanceBatch` (gateway exists, command registered) is never called anywhere. `get_historical_finance_summary` only includes `APPROVED_FOR_REPORTING` batches with `review_status = 'APPROVED'` rows (migration `20260804185000`, lines ~244–253). The approve function (`20260804184500`, line ~800) requires `REVIEW_HISTORICAL_FINANCE_IMPORT`, flips `READY` rows to `APPROVED`, requires status `VALIDATED` with zero invalid rows, and is idempotent (`isReplay`). Both `MANAGE_…` and `REVIEW_…` permissions are granted to the same role (`ADMIN`), and the summary itself needs `REVIEW_…`.

#### 4.7.2 Decision
Make the manual path a single confirmed action: **Save, validate and approve**. A confirmation dialog explains the row becomes final. Alternative "separate Approve button after validation" rejected: if the user leaves the page between the two steps, the validated batch is orphaned forever (there is no function that lists finance batches).

#### 4.7.3 Steps

**Step 7.1 — copy** (the screen's own `COPY` object, lines ~108–260, blocks `en`, `fr`, `ar`):
- Change `saveManual`: en `'Save, validate and approve manual row'`, fr `'Enregistrer, valider et approuver la ligne'`, ar `'حفظ السطر والتحقق منه واعتماده'`.
- Change `manualSaved`: en `'Manual row saved and approved for historical reporting.'`, fr `'Ligne manuelle enregistrée et approuvée pour le reporting historique.'`, ar `'تم حفظ السطر اليدوي واعتماده للتقارير التاريخية.'`
- Add `confirmManualTitle`: en `'Approve this manual row?'`, fr `'Approuver cette ligne manuelle ?'`, ar `'اعتماد هذا السطر اليدوي؟'`
- Add `confirmManualBody`: en `'The row will be validated and, if it is clean, approved for historical reporting. Approved rows are final and cannot be edited.'`, fr `'La ligne sera validée puis, si elle est correcte, approuvée pour le reporting historique. Une ligne approuvée est définitive et ne peut plus être modifiée.'`, ar `'سيتم التحقق من السطر ثم اعتماده للتقارير التاريخية إن كان سليماً. السطر المعتمد نهائي ولا يمكن تعديله.'`
- Add `confirm`: en `'Approve'`, fr `'Approuver'`, ar `'موافقة'`; `cancel`: en `'Cancel'`, fr `'Annuler'`, ar `'إلغاء'` (only if keys with these names do not already exist in `COPY`; if they exist, reuse them).

**Step 7.2 — logic.**
- Add state `const [showConfirmManual, setShowConfirmManual] = useState(false);`.
- The manual submit button (line ~1103, `onClick={() => void stageManual()}`) becomes `onClick={openManualConfirm}` where:
  ```ts
  function openManualConfirm() {
    if (!enabled || busy) return;
    const amountDzd = parseWholeAmount(manual.netAmountDzd);
    if (!manual.paperId.trim() || !manual.transactionDate || amountDzd === null || amountDzd <= 0) {
      setError(text.invalidManual);
      return;
    }
    setError(null);
    setShowConfirmManual(true);
  }
  ```
- Render a `ConfirmDialog` (same props as the paper-book one at lines ~806–825) when `showConfirmManual`: `title={text.confirmManualTitle}`, `body={text.confirmManualBody}`, `confirmLabel={text.confirm}`, `cancelLabel={text.cancel}`, `confirmVariant="primary"`, `busy={busy === 'manual'}`, `onConfirm={() => { setShowConfirmManual(false); void stageManual(); }}`, `onCancel={() => setShowConfirmManual(false)}`. Place it directly after the manual submit button.
- In `stageManual()`, after `const validated = await validateHistoricalFinanceBatch(...)`, replace:
  ```ts
  setManual(EMPTY_MANUAL);
  if (validated.status === 'VALIDATED') setFeedback(text.manualSaved);
  else setError(text.needsReview);
  ```
  with:
  ```ts
  if (validated.status !== 'VALIDATED') {
    // Keep the typed values so the user can correct them.
    setError(text.needsReview);
    return;
  }
  await approveHistoricalFinanceBatch(sessionToken, { batchId: validated.batchId });
  setManual(EMPTY_MANUAL);
  setFeedback(text.manualSaved);
  if (summary && dateFrom && dateTo) void loadSummary();
  ```
  (`return` inside `try` still runs `finally { setBusy(null) }`.) Add `approveHistoricalFinanceBatch` to the import from `'../../shared/ipc/onboardingGateway'`. Use the exact state variable names that exist in the file for the summary result and the date range (check with a quick search: `setSummary`, `dateFrom`, `dateTo`); if the summary state variable is named differently, use that name.
- Error handling: an approve failure (e.g. `PERMISSION_DENIED`) falls into the existing `catch` → `setError(errorText(...))`. The batch then stays validated-but-unapproved (not reportable, harmless); the typed values remain so the user can retry — a retry creates a **new** batch (the backend treats each manual save as its own batch; acceptable, only approved batches count).

**Step 7.3 — tests.** `tests/historical-finance.workflow.test.tsx`, test `uses the same typed staging path for direct manual entry including supplier` (line ~134):
- Button name changes to `'Save, validate and approve manual row'`; after clicking it, click the dialog's `'Approve'` button.
- Add an `approve_historical_finance_batch` handler returning `{ batchId: <same id>, status: 'APPROVED_FOR_REPORTING', isReplay: false }` and assert it was called with `request: { batchId: <id> }`.
- Expected success text becomes `'Manual row saved and approved for historical reporting.'`.
- Add a test: validation returns `status: 'NEEDS_REVIEW'` → approve handler **not** called, the needs-review error is shown, and the Paper ID input still holds the typed value.
- Add a test: cancel in the dialog → no create/replace/validate call happens.

**Step 7.4 — version marker** → `'AUDIT-1.7'`.

#### 4.7.4 Acceptance criteria
- A manual row entered by an admin appears in the Historical Finance summary for its date.
- Nothing is sent to the backend until the dialog is confirmed.

Known limitation (Result Report): manual batches staged by earlier builds remain unapproved and invisible; there is no listing function to recover them (Owner's test data only).

---

### WORK ITEM 8 — AUD-08: Reports navigation works when Reports is already open

#### 4.8.1 Problem
`ReportsScreen` reads the target tab from `sessionStorage` only in `useState(readLastTab)` (mount). The bell is in the header, so on the Reports screen "Go to" writes storage, calls `setView('reports')` (no-op) and nothing changes. The same helper is duplicated in `NotificationPanel.tsx` (line 88) and `DashboardScreen.tsx` (line 101).

#### 4.8.2 Steps

**Step 8.1 — new module** `src/features/reports/reportsNavigation.ts`. Move from `ReportsScreen.tsx` (cut, not copy): `REPORTS_LAST_TAB_STORAGE_KEY`, the `TabId` type (export it), `SALES_SUB_IDS`, `FINANCE_SUB_IDS`, `OWED_SUB_IDS`, `ACCOUNTING_SUB_IDS`, the explanatory comment and `STOCK_SUB_IDS`, `SUB_IDS_BY_TAB`, `DEFAULT_SUB_BY_TAB` (export both), and `readLastTab` (rename to `readLastReportsTab`, export). Then add:
```ts
import type { AppView } from '../../app/AppShell';

export const REPORTS_NAVIGATE_EVENT = 'stockiha:reports-navigate';

export function parseReportsTarget(value: string): { tab: TabId; sub: string } | null {
  const [tab, sub] = value.split('/') as [TabId, string];
  return SUB_IDS_BY_TAB[tab]?.includes(sub) ? { tab, sub } : null;
}

/** Open Reports on a given sub-report, whether or not Reports is mounted. */
export function openReportsSubTab(tab: TabId, sub: string, setView: (v: AppView) => void): void {
  const value = `${tab}/${sub}`;
  try {
    window.sessionStorage.setItem(REPORTS_LAST_TAB_STORAGE_KEY, value);
  } catch {
    // Best effort only.
  }
  window.dispatchEvent(new CustomEvent<string>(REPORTS_NAVIGATE_EVENT, { detail: value }));
  setView('reports');
}
```
Make `readLastReportsTab` use `parseReportsTarget` internally (same result as before: fallback `{ tab: 'sales', sub: 'summary' }`).

**Step 8.2 — ReportsScreen.** Import what it needs from `./reportsNavigation`; `useState(readLastReportsTab)`; add:
```ts
useEffect(() => {
  function handleNavigate(event: Event) {
    const detail = (event as CustomEvent<unknown>).detail;
    if (typeof detail !== 'string') return;
    const target = parseReportsTarget(detail);
    if (target) setActive(target);
  }
  window.addEventListener(REPORTS_NAVIGATE_EVENT, handleNavigate);
  return () => window.removeEventListener(REPORTS_NAVIGATE_EVENT, handleNavigate);
}, []);
```
(add `useEffect` to the `react` import). `selectSub` keeps writing storage as today.

**Step 8.3 — callers.**
- `NotificationPanel.tsx`: delete the local `navigateToSubReport`; import `openReportsSubTab` from `'../reports/reportsNavigation'`; replace each `navigateToSubReport('x', 'y', setView)` with `openReportsSubTab('x', 'y', setView)`; remove the `REPORTS_LAST_TAB_STORAGE_KEY` import.
- `DashboardScreen.tsx`: delete the local `navigateToSubReport`; import `openReportsSubTab`; replace its three calls (`'owed','receivables'`, `'owed','suppliers'`, `'stock','low-stock'`) with `openReportsSubTab(tab, sub, setView)`; remove the `REPORTS_LAST_TAB_STORAGE_KEY` import.
- `grep -rn "REPORTS_LAST_TAB_STORAGE_KEY" src` afterwards: only `reportsNavigation.ts` and `ReportsScreen.tsx` (if it still uses it in `selectSub`).

**Step 8.4 — tests.** `tests/notifications.workflow.test.tsx`: add a test — navigate to Reports (Sales tab visible), open the bell, click `notification-action-LOW_STOCK` → the Stock tab's low-stock report is shown (assert by the element/heading the existing stock tests use for the low-stock report, e.g. `findByTestId` used in `tests/reports-stock.workflow.test.tsx`). Also unit-test `parseReportsTarget` in `tests/reportsNavigation.test.ts`: valid `'stock/low-stock'`; invalid `'stock/nope'`, `'nope/x'`, `''` → `null`.

**Step 8.5 — version marker** → `'AUDIT-1.8'`.

#### 4.8.3 Acceptance criteria
Every notification "Go to" and every Today-home report link opens the right sub-report from any screen, including Reports itself.

---

### WORK ITEM 9 — AUD-09: Today home keeps its data on refresh; denied users stop polling

#### 4.9.1 Problem
`DashboardScreen.loadToday` sets `todayLoading = true` on every 2-minute refresh → the whole page is replaced by a spinner; any error → "no reports access" banner. `NotificationsContext` polls every 5 minutes even after `PERMISSION_DENIED`. Cashiers therefore make ~42 failing calls per hour forever.

#### 4.9.2 Steps

**Step 9.1 — report copy** (`reportCopy.ts`, all three blocks, next to `homeNoReports`):
- `homeLoadFailed`: en `"Today's figures could not be loaded."`, fr `'Les chiffres du jour n’ont pas pu être chargés.'`, ar `'تعذّر تحميل أرقام اليوم.'`
- `homeRefreshFailed`: en `'Could not refresh — showing the figures from the last successful update.'`, fr `'Actualisation impossible — affichage des chiffres de la dernière mise à jour réussie.'`, ar `'تعذّر التحديث — تُعرض أرقام آخر تحديث ناجح.'`

**Step 9.2 — DashboardScreen** (`src/features/dashboard/DashboardScreen.tsx`):
- Import `useRef` and `codeForError` (from `'../../shared/hooks/useErrorText'`).
- Add `const [todayError, setTodayError] = useState<string | null>(null);`, `const todayLoadedRef = useRef(false);`, `const todayDeniedRef = useRef(false);`.
- Replace `loadToday` with:
  ```ts
  const loadToday = useCallback(async () => {
    if (!token || todayDeniedRef.current) return;
    if (!todayLoadedRef.current) setTodayLoading(true);
    try {
      const result = await getTodayOverview(token);
      setToday(result);
      setTodayError(null);
      setTodayDenied(false);
    } catch (err) {
      if (codeForError(err) === 'PERMISSION_DENIED') {
        todayDeniedRef.current = true;
        setToday(null);
        setTodayDenied(true);
      } else {
        setTodayError(errorText(err)); // keep the previous `today`
      }
    } finally {
      todayLoadedRef.current = true;
      setTodayLoading(false);
    }
  }, [token, errorText]);
  ```
- In the polling `useEffect`, before `void loadToday();`, reset `todayLoadedRef.current = false; todayDeniedRef.current = false;` (new token → fresh start).
- Render branches (replace the current `todayLoading ? … : todayDenied || !today ? … : …`):
  1. `todayLoading` → spinner (unchanged).
  2. `todayDenied` → existing `home-no-reports` banner (unchanged).
  3. `!today` → `<Banner tone="error" testId="home-load-error"><p>{copy.homeLoadFailed}</p><Button type="button" variant="secondary" onClick={() => void loadToday()} data-testid="home-retry">{copy.retry}</Button></Banner>` (omit `data-testid` on `Button` if unsupported).
  4. otherwise → existing content, preceded by `{todayError ? <Banner tone="warning" testId="home-refresh-warning">{copy.homeRefreshFailed}</Banner> : null}`.
- The `home-system-status` `<details>` stays outside these branches, unchanged.

**Step 9.3 — NotificationsContext** (`src/features/notifications/NotificationsContext.tsx`):
- Import `codeForError`.
- Add `const deniedRef = useRef(false);`.
- In `refresh`: first line after the `!token` check: `if (deniedRef.current) return;`. In `catch (error)`: `if (codeForError(error) === 'PERMISSION_DENIED') deniedRef.current = true;` then the existing `setReportItems([])`.
- In the polling effect, before `void refresh();`: `deniedRef.current = false;` (token changed → try again once).
- Licence items are unaffected (computed locally).

**Step 9.4 — tests** (`tests/home-today.workflow.test.tsx`):
- Existing test "without VIEW_REPORTS…" must still pass unchanged.
- New: `get_today_overview` rejects `{ code: 'INTERNAL_ERROR' }` on first load → `home-load-error` visible, `home-no-reports` absent; clicking Retry with the handler now succeeding shows the KPIs (`home-kpi-sales`).
- New (fake timers, PART 2.3): first call succeeds, second rejects `INTERNAL_ERROR`; advance 121 s → `home-kpi-sales` still visible and `home-refresh-warning` visible; no spinner.
- New (fake timers): `get_today_overview` rejects `PERMISSION_DENIED`; advance 5 minutes → the handler was called exactly once.
- `tests/notifications.workflow.test.tsx`, new (fake timers): `get_report_notifications` rejects `PERMISSION_DENIED`; advance 11 minutes → called exactly once.

**Step 9.5 — version marker** → `'AUDIT-1.9'`.

#### 4.9.3 Acceptance criteria
No spinner flash on background refresh; transient failures keep the last figures with a warning; a cashier's PC makes at most one Today and one notifications call per login.

---

### WORK ITEM 10 — AUD-10: automatic backup checks every hour, not once per launch

#### 4.10.1 Problem
`AppRouter.tsx` lines ~105–106 and ~277–303: module-level `dailyBackupDone`/`dailyBackupTimer` make exactly one `run_automatic_backup('DAILY')` call per app process, 60 s after first login. The backend (`recovery_embedded.rs`, `DAILY_DUE_AFTER_HOURS = 20`) already skips (`SKIPPED/NOT_DUE`) when the last success is less than 20 h old, so asking more often is safe and cheap.

#### 4.10.2 Steps

**Step 10.1 — module state.** Replace
```ts
let dailyBackupTimer: number | null = null;
let dailyBackupDone = false;
```
with
```ts
const DAILY_BACKUP_FIRST_DELAY_MS = 60_000;
const DAILY_BACKUP_CHECK_EVERY_MS = 5 * 60_000;
const DAILY_BACKUP_MIN_GAP_MS = 60 * 60_000;
let dailyBackupLastAttemptMs: number | null = null;
let dailyBackupInFlight = false;

/** AUD-10 — pure gate: at most one attempt per hour per app process. */
export function dailyBackupAttemptDue(lastAttemptMs: number | null, nowMs: number): boolean {
  return lastAttemptMs === null || nowMs - lastAttemptMs >= DAILY_BACKUP_MIN_GAP_MS;
}
```
(If exporting a non-component from `AppRouter.tsx` triggers the `react-refresh/only-export-components` lint rule, put `dailyBackupAttemptDue` and the three constants in a new file `src/app/dailyBackupSchedule.ts` and import them.)

**Step 10.2 — effect.** Replace the WS-H-6 daily-backup `useEffect` with:
```ts
useEffect(() => {
  const token = user?.token;
  if (!token) return;
  const attempt = () => {
    if (dailyBackupInFlight || !dailyBackupAttemptDue(dailyBackupLastAttemptMs, Date.now())) return;
    dailyBackupInFlight = true;
    dailyBackupLastAttemptMs = Date.now();
    void runAutomaticBackup(token, { requestId: `auto-daily-${Date.now()}`, reason: 'DAILY' })
      .catch(() => {
        // Swallowed - never a popup, never blocks the UI.
      })
      .finally(() => {
        dailyBackupInFlight = false;
        void refreshBackupOverdueWarning();
      });
  };
  const first = window.setTimeout(attempt, DAILY_BACKUP_FIRST_DELAY_MS);
  const every = window.setInterval(attempt, DAILY_BACKUP_CHECK_EVERY_MS);
  return () => {
    window.clearTimeout(first);
    window.clearInterval(every);
  };
}, [user?.token, refreshBackupOverdueWarning]);
```
Update the comment above it: "AUD-10: first attempt 60 s after login, then re-checked every 5 minutes, at most one attempt per hour per app process; the backend itself skips unless ≥ 20 h since the last success, so this yields one backup per day even if the app stays open for weeks."

**Step 10.3 — tests.** `tests/automatic-backup-daily-and-overdue.workflow.test.tsx`:
- Update the header comment (lines 1–12) to describe the new module state (`dailyBackupLastAttemptMs`, `dailyBackupInFlight`).
- The three existing daily-trigger tests must still pass unchanged in behaviour: not called at 30 s, called once by 70 s; remount within the hour → still one call; unmount before 60 s → no call.
- New test: after the first call, `await vi.advanceTimersByTimeAsync(61 * 60_000)` → called exactly twice.
- New unit tests for `dailyBackupAttemptDue`: `(null, 0) → true`, `(0, 59*60_000) → false`, `(0, 60*60_000) → true`.

**Step 10.4 — version marker** → `'AUDIT-1.10'`.

#### 4.10.3 Acceptance criteria
An app left open for 3 days produces 3 daily backups (backend decides), never more than one attempt per hour.

---

### WORK ITEM 11 — AUD-11: notification dismissals per user and per day

#### 4.11.1 Problem
Key `stockiha.notifications.dismissed.<date>` is shared by all users; `dismissed` is read once at mount so yesterday's dismissals stay hidden past midnight.

#### 4.11.2 Steps (`src/features/notifications/NotificationsContext.tsx`)
- New key format: `stockiha.notifications.dismissed.<encodeURIComponent(username)>.<YYYY-MM-DD>`. Keep `DISMISSED_KEY_PREFIX = 'stockiha.notifications.dismissed.'`.
- Replace `dismissedKeyForToday()` with `export function dismissedStorageKey(username: string, day: string): string { return `${DISMISSED_KEY_PREFIX}${encodeURIComponent(username)}.${day}`; }`.
- `readDismissed(key: string)` takes the key as a parameter (same parsing).
- `pruneStaleDismissedKeys(today: string)`: remove every key that starts with the prefix and whose **last** dot-separated segment is not `today` (this also removes legacy `…dismissed.<date>` keys from older builds — the existing test that seeds `stockiha.notifications.dismissed.2020-01-01` keeps passing).
- In the provider:
  ```ts
  const username = user?.username ?? null;
  const [day, setDay] = useState(() => todayLocal());
  const storageKey = username ? dismissedStorageKey(username, day) : null;
  const [dismissed, setDismissed] = useState<string[]>(() => (storageKey ? readDismissed(storageKey) : []));
  useEffect(() => {
    setDismissed(storageKey ? readDismissed(storageKey) : []);
  }, [storageKey]);
  ```
- In the existing 5-minute interval callback (and in the mount effect), call `setDay(todayLocal())` and `pruneStaleDismissedKeys(todayLocal())`. (`setDay` with an unchanged string causes no re-render.)
- `dismiss(id)`: if `!storageKey` return; write to `storageKey`.
- Note: after AUD-09 the interval callback also checks `deniedRef`; put `setDay(...)` **before** that early return so the day still advances for denied users (licence items are dismissible too).

**Tests** (`tests/notifications.workflow.test.tsx`): existing tests pass; new unit test for `dismissedStorageKey('ali', '2026-09-25') === 'stockiha.notifications.dismissed.ali.2026-09-25'`; new workflow test: user A dismisses LOW_STOCK, logs out, user B logs in → LOW_STOCK visible for B.

**Version marker** → `'AUDIT-1.11'`.

**Acceptance:** dismissals are per user and reset at the next day (within 5 minutes after midnight).

---

### WORK ITEM 12 — AUD-12: global search explains missing product access instead of bouncing

#### 4.12.1 Decision
Keep the search available to everyone (cashiers benefit from seeing price/stock in the results list), but when the user lacks `can_manage_catalog`, selecting a result shows a notice inside the search instead of navigating. The AppRouter redirect effect stays as the safety net.

#### 4.12.2 Steps
- i18n (`locales.ts`, all three, next to `search.barcodeNotFound`): `search.noProductAccess` — en `'Opening the product page requires catalogue access. The item details are shown in the list.'`, fr `'L’ouverture de la fiche produit nécessite l’accès au catalogue. Les détails de l’article sont affichés dans la liste.'`, ar `'فتح صفحة المنتج يتطلب صلاحية الكتالوج. تفاصيل الصنف معروضة في القائمة.'`
- `src/app/AppShell.tsx`:
  - `const canOpenProducts = inventoryCapabilities?.can_manage_catalog === true;`
  - `handleEnter`: inside `if (result.type === 'match') { ... }`, before `closeSearch()`, add `if (!canOpenProducts) { setSearchNotice(t('search.noProductAccess')); await runTextSearch(trimmed); return; }`. Add `canOpenProducts` to the `useCallback` dependency list.
  - `handleSelect`: first line `if (!canOpenProducts) { setSearchNotice(t('search.noProductAccess')); return; }`; add `canOpenProducts` and `t` to its dependencies.
- Test update `tests/nav-role-based-access.workflow.test.tsx`, test at line ~212: after `fireEvent.keyDown(input, { key: 'Enter' })`, add `expect(await screen.findByText('Opening the product page requires catalogue access. The item details are shown in the list.')).toBeInTheDocument();` and keep the Dashboard-heading assertion. Update the test's comment: the jump is now refused in the shell; the AppRouter redirect remains as defence in depth.
- Version marker → `'AUDIT-1.12'`.
- Acceptance: a cashier who scans a barcode in global search sees the result list and the notice; no silent jump.

---

### WORK ITEM 13 — AUD-13: redirect guard for the `reports` view

- `src/app/AppRouter.tsx`, after the customer-capabilities redirect effect (line ~488), add:
  ```ts
  useEffect(() => {
    if (!reportsCapabilities) return;
    if (view === 'reports' && !reportsCapabilities.can_view_reports) setView('dashboard');
  }, [reportsCapabilities, view]);
  ```
- Test: **none added for this item.** Reason (write it in the Result Report): no UI path can reach `view === 'reports'` for a denied user — the nav button is hidden while capabilities are `null` or denied, and the Today/notification report links only exist for users who can view reports. The guard is defence in depth with the same shape as the existing products/inventory/procurement/customers guards and is covered by `npm run typecheck` and `npm run lint`.
- Version marker → `'AUDIT-1.13'`.

---

### WORK ITEM 14 — AUD-14: remove dead gateway functions; revoke PUBLIC execute

**Step 14.1 — TypeScript.**
- `src/shared/ipc/gateway.ts`: delete `closeCashSession` (line ~431) and `postPurchaseTransaction` (line ~924) — both call commands that are not registered in `lib.rs`, and nothing calls them (verified with grep across `src` and `tests`).
- `src/shared/ipc/commands.ts`: delete `CLOSE_CASH_SESSION: 'close_cash_session',` (line 38) and `POST_PURCHASE_TRANSACTION: 'post_purchase_transaction',` (line 236).
- `src/shared/ipc/dto.ts`: delete `PostPurchaseTransactionPayload` (line ~718) and `PostPurchaseTransactionResult` (line ~741) **only if** `grep -rn "PostPurchaseTransaction" src tests` shows no other user after the gateway deletion. If other code uses them, keep them.
- Verify `npm run typecheck` and `npm run lint`.

**Step 14.2 — SQL.** Migration `src-tauri/migrations/20260930093000_audit_1_revoke_public_execute.sql`, body:
```sql
-- 20260814170000 and 20260814190000 granted these to PUBLIC. Every legitimate
-- caller already has its own grant (stockiha_runtime, stockiha_owner), and
-- PUBLIC has no USAGE on these schemas, so this removes nothing in use.
REVOKE EXECUTE ON FUNCTION catalog._effective_variant_name(bigint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION procurement.list_purchase_product_options(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION procurement.post_purchase_transaction(text, uuid, bytea, jsonb) FROM PUBLIC;
```
Must not change: the existing grants to `stockiha_runtime` and `stockiha_owner` (do not revoke from them). Add to the AUD-01 suite (or a tiny block at the end of it) assertions: `has_function_privilege('stockiha_runtime', 'procurement.list_purchase_product_options(text)', 'EXECUTE')` is true; `has_function_privilege('public', ...)` — use `NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid = 'procurement.post_purchase_transaction(text,uuid,bytea,jsonb)'::regprocedure AND a.grantee = 0)` (grantee 0 = PUBLIC) is true for all three.

Also run `src-tauri/tests/recovery/r6_001_backup_role_read_privileges_integration.sql` and the procurement suites to confirm no privilege regression.

**Version marker** → `'AUDIT-1.14'`.

---

### WORK ITEM 15 — AUD-15: resync `CURRENT_STEP.md`

Edit only these parts of `CURRENT_STEP.md`:
1. §1 "Active Implementation Position": set **Active Workstream** to `AUDIT-1 — post-WS-I audit fixes (see Plans and tasks/AUDIT-1-Post-WS-I-Fixes-Implementation-Plan.md)`, **Active Branch** to `task/audit-1-post-ws-i-fixes` (from `task/ws-i-3-stock-home-notifications` tip `8cf8afc`), **Current Focus** to one sentence listing AUD-01…AUD-14 as implemented and pending Owner review/Windows acceptance. Keep the "Note on this section's prior … entries" paragraph and extend it with "…and WS-I-1..3 and AUDIT-1".
2. §5 "Known Defects": strike through (`~~…~~`) the two WS-E entries and add after each: `**Resolved:** PurchaseOrdersScreen.tsx no longer exists and tests/procurement.workflow.test.tsx passes (76/76 files green on 2026-09-25).` Add a new bullet: `**WS-E (backend, pre-existing):** five SQL suites fail as documented since WS-M-1 (PART 10): s3_001, s3_002, s3_003, r2_financial_semantics, r8_e_procurement. They exercise the purchase-order / supplier-invoice backend, which has no screen since PurchaseOrdersScreen was removed.`
3. Add a new §7 "Verification rule (AUDIT-1)": "Result reports must run the full `cargo test -j 1` (all targets), not only `--lib`; `--lib` skips `tests/startup_runtime_guard.rs`, which was red from WS-K-1 until AUDIT-1 AUD-06. Use `-j 1` and `CARGO_INCREMENTAL=0` on the acceptance PC (memory)."

Do not change any other section. Version marker → `'AUDIT-1.15'` (the marker still changes even though this item is documentation, because the batch's final build must be identifiable).

---

## PART 5 — Consolidated edge cases and failure scenarios

| Scenario | Expected behaviour | Covered by |
|---|---|---|
| App open across midnight 31 Dec → 1 Jan | New period created on the next period fetch (≤ 60 s); postings continue | AUD-02 SQL 1/4, workflow test |
| Two PCs call `get_open_fiscal_period` at 00:00:01 simultaneously | Advisory lock → exactly one new row; the other call returns it | AUD-02 design (lock + re-check + exclusion constraint) |
| PC clock set to 2035 | No periods created (> 3 needed), WARNING logged, UI "no open period" | AUD-02 SQL 6 |
| Clock set to before the first period | Nothing created; no period returned | AUD-02 SQL 7 logic (`p_day <= v_last_end` / gap rule) |
| Existing code `'2027'` already used | New code `'2027-20270101'` | AUD-02 SQL 8 |
| Uncertain stock receipt retried after midnight | `IDEMPOTENCY_CONFLICT` shown; user re-enters (correct: new day) | AUD-03 |
| Close with an expense cash-out, exact count | Variance 0, no approval, no journal | AUD-01 SQL 1 |
| Close with variance within tolerance | Auto-closed, variance journal posted | AUD-01 SQL 2, 4 |
| Close with variance above tolerance | Pending approval; journal posted on approval | AUD-01 SQL 3 |
| Pending approval created by the old build | Must be resolved before upgrading (manual check) | PART 6 |
| Close with variance but no period covers today | `PRECONDITION_FAILED` (prevented in practice by AUD-02) | AUD-01 §4.4.4 |
| Wrong password | Normal login error; no "session ended" notice | AUD-04 test 2 |
| Background poll with an old token after re-login | Ignored; new session stays | AUD-04 test 3 |
| Session expires mid-sale | Sale not posted; user returned to login with notice; warning shown 30 min earlier | AUD-04 |
| Manual historical row fails validation | No approval; inputs kept; needs-review error | AUD-05 test |
| Approve fails with permission error | Error shown; batch stays unapproved (not reported) | AUD-05 |
| "Go to" while already on Reports | Tab switches | AUD-08 test |
| Today refresh fails after a good load | Old figures kept + warning | AUD-09 test |
| Cashier without VIEW_REPORTS | One Today call, one notifications call per login | AUD-09 tests |
| Backup already done today; app left open | Hourly attempts return `SKIPPED/NOT_DUE`; next backup after ≥ 20 h | AUD-10 |
| Backup call still running after 5 min | Next tick skipped (`dailyBackupInFlight`) | AUD-10 |
| Two users on one PC | Separate dismissal lists | AUD-11 test |
| Cashier scans barcode in global search | Result list + notice, no jump | AUD-12 test |

---

## PART 6 — Testing plan and final verification

### 6.1 Per-item tests
Listed inside each work item. Summary of new/changed test files:
- Rust: `src-tauri/tests/startup_runtime_guard.rs` (changed).
- SQL (new): `src-tauri/tests/finance/audit_1_fiscal_period_rollover_integration.sql`, `src-tauri/tests/cash/audit_1_cash_close_signed_expected_integration.sql`. SQL (changed): `src-tauri/tests/reports/ws_i_002_finance_reports_integration.sql`, possibly other cash suites per Step 4.4, `src-tauri/tests/run_current_sql_suites.sh`.
- Frontend (new): `tests/fiscalPeriodRefresh.test.ts`, `tests/fiscal-period-rollover.workflow.test.tsx`, `tests/sessionExpiry.test.ts`, `tests/session-expiry.workflow.test.tsx`, `tests/reportsNavigation.test.ts`. Frontend (changed): `tests/stock-receipt.workflow.test.tsx`, `tests/reports-finance.workflow.test.tsx`, `tests/historical-finance.workflow.test.tsx`, `tests/notifications.workflow.test.tsx`, `tests/home-today.workflow.test.tsx`, `tests/automatic-backup-daily-and-overdue.workflow.test.tsx`, `tests/nav-role-based-access.workflow.test.tsx`.

### 6.2 Final gate (run once, at the end, in this order; record real output)

```powershell
$env:PATH="C:\Program Files\nodejs;C:\Users\Perfetto\.cargo\bin;$env:PATH"; $env:CARGO_INCREMENTAL="0"
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
npm.cmd run build
cmd.exe /c "call C:\BuildTools\VC\Auxiliary\Build\vcvars64.bat >nul && cd /d C:\Users\Perfetto\Desktop\Stockiha-Part02-Test\src-tauri && cargo fmt --check && cargo check && cargo clippy --all-targets --all-features -- -D warnings && cargo test -j 1"
cmd.exe /c "call C:\BuildTools\VC\Auxiliary\Build\vcvars64.bat >nul && cd /d C:\Users\Perfetto\Desktop\Stockiha-Part02-Test\src-tauri && cargo test -j 1 --lib -- --ignored safe_upgrade"
cmd.exe /c "call C:\BuildTools\VC\Auxiliary\Build\vcvars64.bat >nul && cd /d C:\Users\Perfetto\Desktop\Stockiha-Part02-Test\src-tauri && cargo test -j 1 --lib -- --ignored embedded_setup"
```
Expected: all green; `licence::gate` count still 240; `embedded_setup` reports `embedded=169 … verdict=UpToDate` (165 + 4 new migrations).

SQL suites: throwaway cluster (PART 0.2), all migrations applied, every suite in `run_current_sql_suites.sh` run once; the only allowed failures are the five pre-existing procurement suites (`s3_001`, `s3_002`, `s3_003`, `r2_financial_semantics`, `r8_e_procurement`). Also re-apply the 4 new migrations a second time on the same cluster → no error (idempotency).

### 6.3 Regression checks (explicit)
- `grep -rn "@tauri-apps/api/core" src` → only `src/shared/ipc/invoke.ts`, `src/features/update/useAppUpdate.ts`.
- `grep -rn "currentLocalDate" src` → nothing.
- `grep -rn "close_cash_session\b\|post_purchase_transaction" src` → nothing.
- `git diff --stat -- src-tauri/src` → **empty** (no production Rust change in this batch).
- `git diff --stat -- src-tauri/migrations` → exactly 4 **added** files, no modified files.
- `git status --short` → no `dist/`, logs, `.env`, `target/`, or tsbuildinfo files.

### 6.4 Windows manual checks (for the Owner; write them into `AUDIT-1-MANUAL-VERIFICATION.md` at the repo root)
1. Dashboard shows `[ version = AUDIT-1.15 ]`.
2. **Before installing:** no cash session is waiting for variance approval in the old build.
3. Open a cash session (float 1000), sell 1500, record a cash-out "Expense" 500, count exactly 2000 → close shows difference 0, no manager approval.
4. Repeat with a count 30 DZD short → closes (within tolerance) and a "Cash session shortfall" journal appears in Journals.
5. Stock receipt today → the document list shows today's date (not 1 January).
6. Write off 2 units (Damage) → Reports › Finance › Profit & loss shows "Stock losses" and a lower net result; print and PDF show the new lines (FR/AR/EN).
7. Historical Finance › manual row → confirm dialog → the row appears in the summary for its date.
8. Open Reports, then the bell › Low stock "Go to" → switches to Stock › Low stock.
9. Today home: leave it open 5 minutes → no spinner flashes.
10. Log in as a cashier → no errors, "Sales figures are available to managers…" banner; notification bell shows only licence items.
11. Cashier: global search, scan a barcode, press Enter → notice shown, list visible, no jump.
12. (Optional, needs clock change) Set the Windows clock to 31 Dec 23:58, keep Stockiha open past midnight, make a sale → it succeeds and Settings/Documents show the new year's numbering (`…-2027-000001`). Restore the clock afterwards.
13. (Optional) Leave the app logged in until 30 minutes before the 12-hour limit → yellow "Your sign-in ends at…" banner; "Sign in again" returns to the login screen.

---

## PART 7 — Result Report (what to hand back)

Write `AUDIT-1-RESULT-REPORT.md` at the repo root in the format of `docs/handoff/HANDOFF_TEMPLATES.md` (Result Report), containing: files changed (grouped per work item), design decisions (copy each item's "Decision"), deviations from this plan (every one, with reason), real gate output (PART 6.2), SQL suite table, the regression-check outputs (PART 6.3), `git diff --stat`, `git status --short`, known limitations (below), unrelated problems noticed, and a verdict (`PASS`, `PASS WITH MANUAL CHECKS`, or `BLOCKED`). Then **stop** — no commit.

Known limitations to state:
- Past closed sessions keep their inflated stored expected/variance (immutable history); P&L "cash shortages" for dates before this build still include them.
- Manual historical batches staged by earlier builds stay unapproved and cannot be listed.
- Old fiscal periods stay OPEN (no year-end close workflow exists).
- Session lifetime is still a fixed 12 hours (by design; changing it needs an ADR).

---

## PART 8 — Backlog (explicitly NOT done in AUDIT-1, and why)

| Item | Reason deferred |
|---|---|
| Remove the three unused Rust v1 catalog commands (`create_product_with_variants`, `update_product`, `update_variant`) | Removing them makes their `application::catalog` functions dead (clippy `-D warnings`), changes the licence-gate count, and needs a separate reviewed change. Harmless today. |
| The purchase-order / supplier-invoice / supplier-payment / supplier-return backend (32 unused gateway functions, 5 failing SQL suites) | Large; whether it is kept, repaired or retired is a WS-E scope decision for the Lead Architect. |
| Performance: `reports._variant_info()` / `_sale_lines()` are `SECURITY DEFINER` SQL functions that cannot be inlined; aging/notifications call `net_invoice_allocated_amount` per invoice | No measured problem at MVP catalogue sizes. Revisit with real data volumes. |
| Build P&L entirely from journals | AUD-07 closes the concrete gap; a full journal-based P&L is a WS-I design change. |
| Low-stock "Prepare purchase" uses the product's unit, not a variant base-unit override | Edge case (variant with a different base unit than its product); needs WS-D input on the unit model. |
| Test fixtures with hard-coded 2026 dates (e.g. `s2_002` `'2026-07-24'`, Rust `setup.rs` live test period `2026`) | Self-contained today; revisit before 2027 as a test-hygiene task. |
| Sliding session renewal | Authentication-policy change → ADR required. |
| Year-end fiscal close workflow | Accounting workflow not in MVP scope. |

---

## PART 9 — Self-checks performed on this plan

**Junior-developer test (things a weak agent could get wrong, and where this plan pins them down):**
- Editing an old migration instead of adding one → PART 0.1 rule 4, PART 2.1, exact file names.
- Unqualified column names inside `RETURNS TABLE` → Step 2.1 pitfall.
- Reacting to `login`'s `SESSION_INVALID` → Step 6.1 code excludes `login`; test 2.
- Logging out a new session because of an old token → token comparison in Step 6.4; test 3.
- Using plain fake timers with `<App/>` → PART 2.3.
- Forgetting a locale → PART 2.3 (i18n is type-checked; report copy is not — explicit tables given).
- Running `cargo test` with full parallelism and misreading OOM as a code failure → PART 0.2.
- Deleting `provision_cli.rs` → §4.1.2 explicitly forbids it.
- Rewriting past cash-session figures → §4.4.4 forbids it.
- Committing → PART 0.1 rule 3.

**Missing-details audit (checked):** every new file has an exact path; every changed file has a line anchor; every new function has a signature; every SQL change states grants/ownership; every new UI string has en/fr/ar text; every state transition (session ended, today denied/error, backup in flight, dismissal day) is specified; every item has tests and acceptance criteria; dependencies and order are in PART 3; things that must not change are in PART 2.5 and per item; no new Tauri command, dependency, table or column is introduced.
