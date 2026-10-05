# WS-N — Dashboard Rebuild: Executable Specification

| | |
|---|---|
| Workstream | **WS-N — Dashboard** |
| Implementing agent | **Claude Code** for N-1, N-2, N-3 (money figures, SQL, UI). N-4 (translations) may go to Gemini. |
| Sub-plans | **N-1** Dashboard data (SQL + Rust + TypeScript contracts, no screen) · **N-2** Overview screen (top half) · **N-3** Charts & analysis (bottom half) · **N-4** Translations |
| Replaces | `WS-N-1-dashboard-overview-brief.md` (do not run it) |
| Build marker | `[ version = WS-N-<n>.<bump> ]` in `src/features/dashboard/DashboardScreen.tsx` |
| Prerequisites | WS-O (boxes and pieces) O-1…O-5 accepted; WS-I reports, WS-F-3/F-5/F-6 and WS-E-2 present in the base branch |

---

## 0. How to use this document

1. **One run = one sub-plan.** The owner starts each run with exactly this prompt (replace `<n>`):
   > Read `WS-N-dashboard-spec.md` completely. Execute sub-plan **N-<n>** only, exactly as written, starting with its Gate 0. Do not start any other sub-plan. Stop at the end of N-<n> and write the report described in section 16.
2. Read sections 1 to 8 before any sub-plan. They are rules for every sub-plan.
3. **Evidence tags:**
   - **[S]** = seen in the repository snapshot dated **2026-08-21**. The code has changed since then (WS-D … WS-M, WS-O). Every [S] fact a step relies on is re-checked in that sub-plan's Gate 0. When the live name differs, use the live name and list the substitution in the report. When the live *behaviour* differs in a way this document does not cover, STOP.
   - **[R]** = owner ruling. Never change it.
   - **[D]** = design decision made in this document. Never change it; if it cannot be implemented, STOP.
   - **[G]** = a value the agent must discover in Gate 0 and write into the report before using it.
4. Every name this document gives (file, function, column, key, message, number) is used **exactly**.
5. If something is not answered here, it is a stop condition. Never invent a rule.

---

## 1. Owner rulings [R]

| # | Ruling |
|---|---|
| R-1 | The dashboard is for the owner/admin. Only the admin uses the app for now: **no new roles, permissions or approval flows.** |
| R-2 | The page must be rich with information and helpful for decisions: money, stock, customers, suppliers, recent activity. |
| R-3 | A **period switcher**: Today, This week, This month, This year, Custom range. |
| R-4 | Figures can be **compared with the previous period** (arrow + percentage). |
| R-5 | **Quick action buttons**: New sale, New purchase, Customer payment, Supplier payment, Add product, Stock adjustment. |
| R-6 | Stock warnings: low stock, out of stock, items not selling ("dead stock"). Bedding sells slowly: the default "not selling" limit is **90 days**, adjustable to 30 / 60 / 180. |
| R-7 | **Alerts live in the notifications section.** The dashboard only shows how many are unread, with a link. |
| R-8 | A **second section, lower on the page, is for charts and diagrams.** Charts approved: sales and profit over time, sales by category, top 10 items, cash vs credit sales, purchases vs sales over time, busiest days and hours, unpaid customer debts by age. |
| R-9 | Quantities show boxes and pieces ("2 Carton + 5 Unit") using WS-O. |
| R-10 | Small database additions are allowed. No deadline. |
| R-11 | The dashboard is a **separate page** from the WS-I "Today" home screen, which is not changed. |
| R-12 | Translations come last (N-4). |

---

## 2. Vocabulary (used exactly like this everywhere)

| Word | Meaning |
|---|---|
| **Business date / today** | The current date in time zone `Africa/Algiers`: SQL `(now() AT TIME ZONE 'Africa/Algiers')::date`; React `currentBusinessDate()` from `src/shared/utils/businessDate.ts` [S]. Never the PC's own time zone. |
| **Window** | An inclusive date range `[from, to]` of business dates. |
| **Current window** | The window of the selected period, ending today (or the custom end date). |
| **Previous window** | The window of the same length immediately before, used only for comparison arrows. |
| **Cut time** | When the current window ends today, the previous window's **last day** only counts records made up to the same clock time (e.g. "yesterday up to 12:00"). NULL = no cut. |
| **Bucket** | One step of a time chart: `HOUR` (a single-day window), `DAY` (2–62 days), `MONTH` (63 days or more). |
| **Counted sale** | A posted, **not voided** cash or credit sale, exactly as the WS-I sales report counts it (rule R2 found in Gate 0). |
| **Net sales** | Σ of counted sales' totals after the whole-sale discount (R2). The "Sales" figure. |
| **Sales before discount** | Σ of line totals of counted sales, before the whole-sale discount. Used for per-item and per-category rankings (a whole-sale discount belongs to no single line). |
| **COGS** | Cost of goods sold of counted sales (R4). |
| **Profit** | Net sales − COGS, rounded exactly as WS-I does (R4). |
| **Receivables** | What customers owe right now (R5). |
| **Payables** | What the shop owes suppliers right now (R6). |
| **Open item** | A customer debit (a credit sale or other positive ledger entry) not yet fully paid. |
| **Unapplied credit** | Customer money received but not matched to any open item (e.g. a payment kept after a credit sale was voided). Shown as a negative line so that the aging buckets always add up to the receivables total. |
| **Active item** | A variant that is active and whose product is active (ws-d-skill). |
| **Low stock** | Active item with `minimum_stock > 0 AND 0 < quantity <= minimum_stock` (ws-d-skill predicate plus `quantity > 0`, so an empty item is counted only as out of stock). |
| **Out of stock** | Active item with `quantity = 0`. |
| **Not selling ("dead")** | Active item with `quantity > 0`, created at least N days ago, and never sold or last sold at least N days ago (N = 30/60/90/180). |
| **Section** | One independently loading part of the page (a KPI strip, a list, a card, a chart). |

---

## 3. What already exists [S] (repository snapshot 2026-08-21)

| # | Fact | Evidence |
|---|---|---|
| S1 | The current dashboard `src/features/dashboard/DashboardScreen.tsx` shows only product/variant counts, selected warehouse, cash-session open/closed, latest document number and pending document jobs. It calls `ipc.getDashboardSummary(token, workstationId)` → Tauri command `get_dashboard_summary` → `commands::reference::get_dashboard_summary` → `application::dashboard::get_dashboard_summary` → SQL `core.get_dashboard_summary(text, text)`. It renders the version marker in a `div.sk-muted`. | those files |
| S2 | **`application::dashboard::get_dashboard_summary` is also called by `src-tauri/src/application/setup.rs`.** It must not change. | `setup.rs` |
| S3 | Navigation is **not URL routing**. `src/app/AppRouter.tsx` holds `const [view, setView] = useState<AppView>('dashboard')` (the dashboard is the page after login) and renders `{view === 'dashboard' && <DashboardScreen />}`. `src/app/AppShell.tsx` exports `type AppView` (a string union) and decides sidebar visibility in `canShow(item)` from `inventoryCapabilities`, `inventoryCorrectionsEnabled`, `procurementCapabilities`. AppRouter sends the user back to `'dashboard'` when a view is not allowed. | `AppRouter.tsx`, `AppShell.tsx` |
| S4 | **Tests:** at least 10 workflow tests (`tests/*.workflow.test.tsx`, `tests/workflow.test.tsx`) log in and wait for the heading **"Dashboard"**. They mock Tauri with `wireInvoke(handlers)`, which **rejects every command it does not know** with `{ code: 'INTERNAL_ERROR' }`. `tests/workflow.test.tsx` also asserts the old product-count widget. | `tests/` |
| S5 | Shared UI: `Button` (variants primary/secondary/danger, `loading`), `TextField`, `Spinner`, `Banner` (tones error/success/warning/info), `ConfirmDialog` in `src/shared/components/index.tsx`; full-page `ErrorBoundary.tsx`. Styles: `src/styles/global.css` with tokens `--sk-surface`, `--sk-surface-soft`, `--sk-surface-hover`, `--sk-border`, `--sk-border-strong`, `--sk-text`, `--sk-text-soft`, `--sk-muted`, `--sk-ok`, `--sk-danger`, `--sk-warn`, `--sk-primary`, `--sk-radius-sm`, `--sk-radius`, `--sk-radius-lg`, `--sk-gap`, `--sk-touch`; dark theme under `[data-theme="dark"]`. Extra CSS files are imported in `src/App.tsx`. | those files |
| S6 | i18n: `useI18n()` gives `t(key, vars)` with `{var}` interpolation; dictionaries live in `src/shared/i18n/locales` (typed `MessageKey`); French is the product default, tests run in English. | `src/shared/i18n/index.tsx` |
| S7 | IPC pattern: one gateway file per area (e.g. `src/shared/ipc/receivablesGateway.ts`) with a local `call<T>(command, args)` that wraps `invoke` and throws `GatewayError(parseTauriError(error))`; command names in `src/shared/ipc/commands.ts`; DTOs with snake_case fields; decimals as strings. Session data from `useSession()`: `user?.token`, `workstationId`, `clearSession()`. | those files |
| S8 | Errors: SQLSTATE `22023` → `VALIDATION_ERROR`, `28000` → `SESSION_INVALID`, `42501` → `PERMISSION_DENIED` (`src-tauri/src/error.rs::from_posting_error`); the UI shows only fixed text via `useErrorText()`. | those files |
| S9 | Schemas: `cash, catalog, core, documents, finance, iam, inventory, onboarding, operations, procurement, receivables, sales`. **Every schema owned by `stockiha_owner` must grant `USAGE` to `stockiha_backup`** — asserted by `src-tauri/tests/recovery/r6_001_backup_role_read_privileges_integration.sql`. | migrations, tests |
| S10 | `core.business_documents(id, document_type, status ('DRAFT','POSTED','REVERSED'), document_date, fiscal_period_id, document_number, posted_at, reverses_document_id, …)`. `sales.cash_sales(document_id, warehouse_id, subtotal, total_amount)`, `sales.credit_sales(document_id, customer_id, warehouse_id, subtotal, total_amount, due_date, …)`, line tables with `variant_id, quantity (base units), unit_price, unit_cost_snapshot numeric(18,4), line_total`. COGS at posting = Σ `round(quantity × unit_cost_snapshot, 4)`. | sales migrations |
| S11 | **The public `sales.confirm_credit_sale` ignores `p_document_date`**: credit sales are always dated today in `Africa/Algiers`. So test data cannot be back-dated through the normal posting functions. | `20260730200500_credit_sale_business_date.sql` |
| S12 | Receivables: `receivables.customer_ledger_entries(id, customer_id, entry_type, amount_delta (signed), document_id, related_entry_id, due_date, created_at)`, `receivables.payment_allocations(payment_document_id, invoice_ledger_entry_id, amount)`, `receivables.customers(id, code, name, …)`. | receivables migrations |
| S13 | Stock: `inventory.positions(warehouse_id, variant_id, quantity_on_hand, total_value, …wac…)`; one row per warehouse and variant. | inventory migrations |
| S14 | Frontend has **no chart library** (`package.json` dependencies: `@tauri-apps/api`, `react`, `react-dom`, `pdf-lib`, `@pdf-lib/fontkit`, `fflate`). | `package.json` |
| S15 | Test layout: frontend tests in top-level `tests/`; SQL suites listed in `src-tauri/tests/run_current_sql_suites.sh` (`suites=(…)`, each run in `BEGIN … ROLLBACK` against `ADMIN_URL`), helper pattern `pg_temp.expect_error(sql, sqlstate)`, sessions inserted into `iam.application_sessions` with `sha256('<token>'::bytea)`. | those files |
| S16 | `DESIGN.md`: KPI strip = **one bordered container divided by 1px rules, not separate cards, max 5 cells at 1280px**; a value takes a semantic colour only when it is a threshold breach; values must not jump on refresh; context rail 360px collapses below a 1440px viewport; loading = skeletons of final size; modals: Escape closes, focus trapped, focus returns to the trigger; logical CSS properties only; tabular numerals; 44px minimum targets; "the interface never invents truth" (derived money figures come from the backend). | `DESIGN.md` |

---

## 4. Design decisions [D] (alternatives compared, one chosen)

| # | Decision | Alternatives rejected and why |
|---|---|---|
| D1 | **All new SQL lives in the existing schema `core`**, public functions `core.dashboard_*`, private helpers `core._dashboard_*`. | A new `dashboard` schema would need USAGE grants for the runtime and backup roles and would fail the backup ACL test (S9) if one grant is missed. `core` already holds `core.get_dashboard_summary`. |
| D2 | **Every figure is computed in PostgreSQL** — totals, percentages, margins, averages, change arrows, buckets. React only formats strings. | DESIGN principle "the interface never invents truth"; exact decimals. |
| D3 | **The dashboard copies WS-I's business rules instead of guessing them.** Gate 0 writes down rules R1–R12 from the live WS-I/WS-F/WS-E code; the private "fact" helpers implement them; tests prove the dashboard totals equal the WS-I functions. | Writing our own definitions of "sale", "profit" or "owed" would make the dashboard disagree with the Reports pages. |
| D4 | **Time-dependent logic is split into pure helpers** that take `p_now` / `p_as_of` as parameters (tested with fixed dates) and thin public wrappers that pass `now()`. | S11 makes back-dated test data impossible; pure helpers make period, bucket and aging rules testable anyway. |
| D5 | **The client resolves the period once** (`core.dashboard_period`) and passes the explicit window to every other call. | If each function computed "today" itself, sections loaded around midnight could disagree. |
| D6 | **Rankings by item and by category use sales before discount; totals by time, payment type and customer use net sales.** A whole-sale discount is not allocated to lines. | Allocating the discount would be new money arithmetic (rounding rules) that WS-I does not have. The label says "before discount". |
| D7 | **Rankings are per variant** (the thing actually sold and stocked, e.g. "Couette 2p · Blanc"), named with `catalog._effective_variant_name`. | Per product would hide which size/colour sells, and packs (WS-O) exist per variant. |
| D8 | **Stock figures cover all warehouses together.** | The pilot is single-store, single-warehouse; one business-wide figure is what the owner asks for. |
| D9 | **Page layout follows DESIGN.md**: context bar → Money KPI strip (5 cells) → Stock KPI strip (4 cells) → lists beside a 360px context rail (≥1440px viewport) → Charts & analysis → footer. Cash in drawer, alerts, quick actions, debtors and running-low items live in the rail. | Six or ten separate cards break the DESIGN.md KPI-strip rule (S16). |
| D10 | **Navigation from the dashboard uses the existing `setView`** passed as a prop. Quick actions open the target screen; they do not open a form inside it. A quick action or link is shown only when the sidebar shows its target (single rule extracted from `AppShell.canShow`). | Opening a form directly would require changing six other screens. Showing a button that bounces back to the dashboard looks broken. |
| D11 | **Period selection, "compare" switch and dead-stock days are remembered in memory while the app runs** (module variable), not on disk. | Owner ruling of the first brief; the page remounts on every visit. |
| D12 | **No automatic refresh.** Data reloads on page open, on period change, and on the Refresh button. On refresh, old values stay visible at reduced opacity until new ones arrive (no skeleton flash). | DESIGN: values must not jump; dataviz: refetch keeps the frame. |
| D13 | **Charts use Recharts `3.10.1` (pinned, exact) for the three time charts only**; ranking bars, the aging bars and the heatmap are plain HTML/CSS. | Hand-built SVG time charts need scales, ticks, tooltips and resizing code — too much risk. Ranking bars and a heat grid are simpler, accessible and testable in HTML. Recharts 3 is React-19 compatible and has a keyboard accessibility layer on by default. |
| D14 | **Chart colours are new tokens validated for colour-blind safety** against the app surfaces (`#ffffff` light, `#1c1815` and `#111b2d` dark): Sales = blue, Profit = orange, Purchases = aqua, Credit = light blue; ordered ramps (blue) for debt age and the heatmap. Every chart has a table view. | Using the accent or status colours for data would break DESIGN.md §3 (accent = active, status = state). |
| D15 | **Time charts are drawn left-to-right in every language** (`dir="ltr"` around the plot only). | A mirrored time axis in Arabic is harder to read; numbers stay LTR (DESIGN §13.5). |
| D16 | **Dashboard SQL checks the session only** (MVP, R-1). Future: a `VIEW_DASHBOARD` permission when roles return. | R-1. |
| D17 | **Old code stays**: `core.get_dashboard_summary`, its Rust service and command, and old i18n keys are not removed. The new screen still calls `getDashboardSummary` only to show "documents waiting to print". | S2; removing keys may break other screens and tests. |
| D18 | **The dashboard never reads the `paperbook` schema** (WS-P historical records). | WS-P ruling: history stays separate from live figures. |

---

## 5. What must NOT change (all sub-plans)

1. No change to how sales, purchases, payments, stock, WAC, COGS, journals, receivables or payables are **computed or stored**. The dashboard only reads.
2. No change to `core.get_dashboard_summary`, `application::dashboard::get_dashboard_summary`, `commands::reference::get_dashboard_summary`, `setup.rs`.
3. No change to WS-I report functions, the "Today" home screen, the notifications section, or any other screen. **The only files outside `src/features/dashboard/` that may be created or edited are:** `src/app/AppRouter.tsx` (pass props to `DashboardScreen` only), `src/app/AppShell.tsx` (replace the body of `canShow` by a call to the extracted function only, N-2.2), new `src/app/navigationAccess.ts`, `src/App.tsx` (import the new CSS files only), `src/styles/global.css` (chart tokens only, N-3.3), new `src/styles/dashboard.css` and `src/styles/charts.css`, `src/shared/utils/formatters.ts` (N-3.2 only), the i18n dictionaries (new keys only), `src/shared/ipc/commands.ts` (new constants only), new `src/shared/ipc/dashboardDto.ts` and `dashboardGateway.ts`, new `src/shared/charts/*`, `package.json` / `package-lock.json` (N-3.1 only), new `src-tauri/src/application/dashboard_insights.rs` and `src-tauri/src/commands/dashboard_insights.rs`, `src-tauri/src/application/mod.rs`, `src-tauri/src/commands/mod.rs` and `src-tauri/src/lib.rs` (module and command registration only), new migrations, new `src-tauri/tests/dashboard/*` and `src-tauri/tests/perf/*`, `src-tauri/tests/run_current_sql_suites.sh` (add the two new suites only), new files in `tests/` plus the listed assertions of `tests/workflow.test.tsx`, and `docs/ws-n/*` (reports).
4. `src/shared/utils/formatters.ts`: only the N-3.2 extraction (same output for `formatDisplayDate`).
5. No new role, permission, setting or approval flow. No change to licence behaviour (WS-K-7).
6. No existing test is edited, **except** the old-dashboard assertions of `tests/workflow.test.tsx` listed in N-2 Gate 0 (widgets that no longer exist). Every edited assertion is listed in the report with the reason.
7. No app version bump in `tauri.conf.json` / `package.json`.
8. The page heading stays the translation of the existing key `dashboard.title` ("Dashboard" in English), rendered immediately, before any data arrives (S4).

---

## 6. Execution order and dependencies

```
WS-O O-1…O-5 accepted (packs, PackQuantity, usePrimaryPacks)
        │
        ▼
N-1 Dashboard data: SQL helpers + 12 public functions + Rust commands + TS gateway + SQL/Rust tests
        │
        ▼
N-2 Overview screen (top half): period bar, quick actions, KPI strips, rail, lists, stock dialog
        │
        ▼
N-3 Charts & analysis: Recharts, chart tokens, chart kit, 7 charts (data already in N-1)
        │
        ▼
N-4 Translations (French, Arabic)
```

- Strictly sequential. N-2 needs N-1's gateway; N-3 needs N-2's page and N-1's chart functions.
- WS-P (paper book) and WS-K-7 (licence) are independent of WS-N.
- Branches:
  - N-1 `task/ws-n-1-dashboard-data` from `main` **if WS-O is merged into main**, otherwise from the latest accepted WS-O branch (`task/ws-o-6-translations`, or `task/ws-o-5-pack-display` if O-6 is not done). Record which.
  - N-2 `task/ws-n-2-dashboard-overview` from accepted N-1.
  - N-3 `task/ws-n-3-dashboard-charts` from accepted N-2.
  - N-4 `task/ws-n-4-dashboard-translations` from accepted N-3.
- Work that is not pushed does not exist. Commit and push before the report; the report ends with the full commit hash and `Pushed: yes/no`.

---

## 7. Global conventions

**7.1 Skills.** Follow `stockiha-task-execution`; `ws-d-skill` §2 (explicit casts, no reliance on SQL defaults, contract triangle), §3 (invariants), §4 (function contract), §6 (numbers), §7 (frontend), §10 (verification); read `ws-b-skill` before N-1 (you read money, you never compute it differently from WS-B/WS-I).

**7.2 SQL function contract.**
- Public `core.dashboard_*`: `LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog`; first statement `PERFORM 1 FROM iam.resolve_session(p_session_token);`; then validation; then `RETURN QUERY SELECT * FROM core._dashboard_…(…)`. After the function: `REVOKE ALL ON FUNCTION <exact signature> FROM PUBLIC; GRANT EXECUTE ON FUNCTION <exact signature> TO stockiha_runtime;`
- Private `core._dashboard_*`: `LANGUAGE sql` or `plpgsql`, `STABLE`, `SECURITY DEFINER SET search_path = pg_catalog`, then `REVOKE ALL ON FUNCTION <exact signature> FROM PUBLIC;` and **no** grant.
- Every table and every non-built-in function inside bodies is schema-qualified (`catalog.products`, `core._dashboard_sales(…)`). Built-ins (`round`, `coalesce`, `sum`, `generate_series`) need no prefix because the search path is `pg_catalog`.
- Private functions that return a TABLE are written in `LANGUAGE sql` whenever possible. A `plpgsql` function that returns a TABLE and runs queries starts its body with `#variable_conflict use_column` (output column names would otherwise clash with query columns).
- Validation errors: `RAISE EXCEPTION '<CODE>: <detail with the offending value>' USING ERRCODE = '22023';` (codes in Appendix A.3).
- Migrations: `SET ROLE stockiha_owner; … RESET ROLE;` like existing files [S].

**7.3 Migration file.** `src-tauri/migrations/<YYYYMMDDHHMMSS>_ws_n_1_dashboard_data.sql`, timestamp = current UTC time, later than the newest existing file. Only N-1 has a migration (plus an optional index migration in N-1.11). It must apply on an **empty** database and on top of the acceptance database.

**7.4 Numbers.** Every **money** column a public dashboard function returns is rounded to 2 decimals with `round(x, 2)` as the last step (stock values carry 4 decimals internally); quantities keep their scale; percentages have 1 decimal. SQL `numeric`; Rust `rust_decimal::Decimal` serialized with `.to_string()`; IPC strings; React formats strings with `formatDisplayAmount` / the helpers of this document. **The only place a JavaScript `number` may hold a money or quantity value is chart geometry** (`src/shared/charts/chartFormat.ts::toPlotNumber`, N-3) — plot positions only, never displayed.

**7.5 Strings.** Every user-facing text goes through `src/shared/i18n/` with the keys of Appendix E. N-1 to N-3 put the **English text in all three locale dictionaries**; N-4 translates.

**7.6 Build marker.** `[ version = WS-N-<n>.1 ]` in `src/features/dashboard/DashboardScreen.tsx`, same commit as the change, `+1` on every corrective re-run. N-1 edits only the marker line of the old screen.

**7.7 Verification commands** (paste literal output with working directory; `NOT RUN — reason` is acceptable, an assumed pass is not):
```
npm run typecheck && npm run lint && npm test -- --run && npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo check --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --lib
bash src-tauri/tests/run_current_sql_suites.sh
```
A real Rust run ends with `test result: ok. N passed; 0 failed`. Then build the signed installer with `npm run tauri build` (needs `TAURI_SIGNING_PRIVATE_KEY` and its password in the environment) and give the `.exe` path.

**7.8 Logging.** Never log arguments, amounts, names or tokens. In **debug builds only** (`cfg!(debug_assertions)`), each dashboard command prints `[DASHBOARD] <command name> <elapsed_ms>ms` with `eprintln!` when it took more than 300 ms. React logs nothing.

---

## 8. Page blueprint (used by N-2 and N-3)

```
┌ Context bar ────────────────────────────────────────────────────────────────────────────┐
│ Dashboard   [Today|This week|This month|This year|Custom] [from][to][Apply]            │
│             1 Sep 2026 – 24 Sep 2026, compared with 1 Aug 2026 – 24 Aug 2026 (up to 12:00) │
│             ☑ Compare with previous period    Updated at 12:04   [Refresh]             │
├ MONEY (KPI strip, 5 cells) ─────────────────────────────────────────────────────────────┤
│ Sales │ Profit │ Number of sales │ Customers owe you │ You owe suppliers               │
├ STOCK — RIGHT NOW (KPI strip, 4 cells) ─────────────────────────────────────────────────┤
│ Stock value │ Low stock │ Out of stock │ Not selling [90 ▾] days                        │
├──────────────────────────────────────────────────┬─ Rail (360px) ───────────────────────┤
│ Best-selling items │ Best customers │ Latest sales│ Quick actions (6 buttons)           │
│ (3 list cards, auto-fit grid)                     │ Cash in drawer                      │
│                                                   │ Alerts (unread count)               │
│                                                   │ Biggest debtors                     │
│                                                   │ Running low                         │
├ CHARTS & ANALYSIS (N-3) ────────────────────────────────────────────────────────────────┤
│ Sales and profit (full width)                                                          │
│ Sales by category │ Top 10 items                                                       │
│ Cash and credit sales │ Sales and purchases                                            │
│ Busiest days and hours │ Unpaid customer debts by age                                  │
├ Footer ─────────────────────────────────────────────────────────────────────────────────┤
│ "3 documents are waiting to be generated or printed." (only when > 0)   [ version = … ] │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

**Responsive rule (exact CSS grid, file `src/styles/dashboard.css`):**
```css
.sk-dash { display: grid; gap: var(--sk-gap); grid-template-columns: minmax(0, 1fr);
  grid-template-areas: "bar" "money" "stock" "rail" "lists" "charts" "footer"; }
@media (min-width: 1440px) {
  .sk-dash { grid-template-columns: minmax(0, 1fr) 360px; align-items: start;
    grid-template-areas: "bar bar" "money money" "stock stock" "lists rail" "charts charts" "footer footer"; }
}
.sk-dash__bar { grid-area: bar; } .sk-dash__money { grid-area: money; } .sk-dash__stock { grid-area: stock; }
.sk-dash__lists { grid-area: lists; } .sk-dash__rail { grid-area: rail; } .sk-dash__charts { grid-area: charts; }
.sk-dash__footer { grid-area: footer; }
```
Below 1440px the rail cards sit **above** the lists (area order "rail" then "lists") in a grid `repeat(auto-fit, minmax(300px, 1fr))`; at ≥1440px the rail is one column. Lists: `repeat(auto-fit, minmax(340px, 1fr))`. Minimum supported width 1280px (DESIGN).

**Which sections depend on the period:** Money strip, Best-selling items, Best customers, and charts 1–6. **Right-now sections** (not affected by the period, labelled so): Stock strip, rail cards, Latest sales, chart 7 (debts by age).

---

## 9. Sub-plan N-1 — Dashboard data (SQL, Rust, TypeScript contracts; no screen)

**Goal:** every figure the dashboard and its charts need is available through 12 read-only functions, equal to the WS-I reports, proven by tests.

**Branch:** `task/ws-n-1-dashboard-data` (section 6). **Marker:** `[ version = WS-N-1.1 ]` (edit only the marker line of the old `DashboardScreen.tsx`).

### N-1.0 Gate 0 — establish reality (read-only; results go at the top of the report)

Run queries against `stockiha_acceptance` (port 5433), read-only. Label each finding *verified / read but not executed / assumed*. Use live signatures and bodies (`pg_get_functiondef`), never old migration files.

| # | What to check | How | Stop if |
|---|---|---|---|
| G1 | WS-O is in the base branch | `catalog.get_primary_packs` exists in `pg_proc`; files `src/shared/components/PackQuantity.tsx` and `src/shared/hooks/usePrimaryPacks.ts` exist | any is missing |
| G2 | No name collision | `SELECT n.nspname, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE p.proname ILIKE '%dashboard%';` | anything other than `core.get_dashboard_summary` is named `dashboard_*` or `_dashboard_*` in `core` |
| G3 | Session helper | live signature and return columns of `iam.resolve_session` | missing |
| G4 | Sales tables | `\d` of `core.business_documents`, `sales.cash_sales`, `sales.credit_sales`, `sales.cash_sale_lines`, `sales.credit_sale_lines`; `SELECT document_type, status, count(*) FROM core.business_documents GROUP BY 1,2 ORDER BY 1,2;` | — |
| G5 | WS-I report functions | list candidates: `SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.prokind='f' AND n.nspname NOT IN ('pg_catalog','information_schema') AND (p.proname ILIKE ANY (ARRAY['%report%','%summary%','%profit%','%owed%','%balance%','%valuation%','%notification%','%today%']));` then read every body that WS-I uses (follow the Rust service each WS-I screen calls) | no WS-I function returns net sales, profit, receivables or payables |
| G6 | Void (WS-F-6) | live signature and body of the sale-void function(s): what happens to the sale document (`status`?), which reversal document is created (type), which ledger entries / allocations are written for a credit sale | — |
| G7 | Discount (WS-F-3) | which column stores the whole-sale discount, on which sale types, and how `total_amount` relates to it | — |
| G8 | Expected cash (WS-F-5) | the function that returns expected cash of an open cash session; how "open" is defined | missing |
| G9 | Supplier balances (WS-E-2) | the function/expression WS-E-2 uses for "what we owe each supplier" and its total | missing |
| G10 | Receivables structure | `\d receivables.customer_ledger_entries`, `\d receivables.payment_allocations`; `SELECT entry_type, sign(amount_delta), count(*), count(related_entry_id) FROM receivables.customer_ledger_entries GROUP BY 1,2 ORDER BY 1,2;` | — |
| G11 | Catalog columns | variant `minimum_stock` column; variant `created_at`; `catalog.products.category_id` and the categories table name and its name column; active flags; live signature of `catalog._effective_variant_name`; the SQL expression `catalog.list_products_v2` uses for `display_identifier` and `identifier_type` | no `minimum_stock` or no `created_at` on variants |
| G12 | Stock | `\d inventory.positions`; the D-8 / WS-I stock valuation function and whether it includes inactive variants and all warehouses | no valuation function |
| G13 | Purchases | `\d procurement.purchase_receipts`; how a posted direct purchase is identified (document type/status), its total column, its date, and how a reversed/cancelled purchase is marked | — |
| G14 | Notifications | the command, gateway function and DTO WS-I uses to count unread notifications | missing (then the Alerts card is not built; say so) |
| G15 | Walk-in customer | how a cash sale without a named customer is stored (NULL customer? a default customer row?) and whether cash sales can carry a customer | — |
| G16 | `time` crate | `src-tauri/Cargo.toml`: `time` version and features; sqlx features include `time` and `rust_decimal` | sqlx cannot decode `date`, `time`, `timestamp` |
| G17 | Indexes | `\di core.*`, `\di sales.*`, `\di receivables.*`, `\di inventory.*`, `\di procurement.*` (paste) | — |
| G18 | Surfaces | live values of `--sk-surface` in `:root` and `[data-theme="dark"]` in `src/styles/global.css` | light is not `#ffffff`, or dark is neither `#1c1815` nor `#111b2d` (chart colours were validated only for those; report the values) |
| G19 | Marker | current marker string in `DashboardScreen.tsx` | missing |

**Rules to write down (from G4–G15).** For each, give the rule in one sentence, the evidence (function + line), and **the exact SQL expression you will use**:

| Rule | Question it answers |
|---|---|
| **R1** | Which date puts a sale in a period in the WS-I sales report (e.g. `bd.document_date`, or `(bd.posted_at AT TIME ZONE 'Africa/Algiers')::date`)? |
| **R2** | Which documents are counted sales (types, `status` filter, how voided sales are excluded), and which column is a sale's **net** total? |
| **R3** | Where the whole-sale discount is stored; 0 when absent. Check: for every counted sale, `net total = Σ line_total − discount`. |
| **R4** | How WS-I computes COGS and profit, including rounding. |
| **R5** | How WS-I computes "customers owe you" (which customers, which entries, whether negative balances are included). |
| **R6** | How WS-E-2 / WS-I computes "you owe suppliers". |
| **R7** | How to get expected cash of every open cash session. |
| **R8** | Stock: quantity per variant (sum of `inventory.positions`), value per variant (same rule as the valuation function), minimum stock, created date, category, active, display identifier. |
| **R9** | How a voided credit sale and its partial payment appear in `customer_ledger_entries` / `payment_allocations` (entry type, sign, `related_entry_id`, allocations kept or reversed). |
| **R10** | Unread notifications count (command/gateway). |
| **R11** | Walk-in: the condition that identifies "no named customer". |
| **R12** | Purchases: which receipts count, their total, their date (same basis as R1), their posted time. |

**Stop gates (stop and report with 2–3 options):** R2, R4, R5, R6, R7 or R8 cannot be established from live code; **R9 shows that the cancellation of a credit sale is not linked to the sale's ledger entry** (no `related_entry_id`, no reversed allocation) — the debt-age chart would put a cancelled sale in an age bucket; G1, G2, G3, G11, G12, G16 or G18 stop rules.

### N-1 steps

---

**N-1.1 — Create the migration file**
- **Objective:** one file holds all N-1 SQL.
- **Location:** `src-tauri/migrations/<timestamp>_ws_n_1_dashboard_data.sql`.
- **Change:** starts with `SET ROLE stockiha_owner;`, ends with `RESET ROLE;`; steps N-1.2 to N-1.5 add their SQL **in step order** (helpers before users).
- **Expected result:** applies on an empty database and on `stockiha_acceptance`.
- **Pitfalls:** `LANGUAGE sql` bodies are checked when the function is created, so every helper must be created before any function that uses it — keep step order.
- **Verify:** apply to an empty database; paste the command and output.

---

**N-1.2 — Pure helpers (no table access)**
- **Objective:** one definition of period, comparison, window, bucket and age rules.
- **Location:** the N-1 migration.
- **Change:** create exactly these private functions (7.2, owner-only). Behaviour is exact; examples in Appendix B/C are the test cases.

| Function | Returns | Exact behaviour |
|---|---|---|
| `core._dashboard_period_bounds_at(p_period text, p_from date, p_to date, p_now timestamptz)` | `TABLE (cur_from date, cur_to date, prev_from date, prev_to date, cut_time time, bucket text, today date)` | Algorithm B.1 (Appendix B). |
| `core._dashboard_validate_window(p_from date, p_to date, p_today date)` | `void` | Raise `DASHBOARD_RANGE_INVALID` when `p_from` or `p_to` is NULL, `p_from > p_to`, `p_from < '2000-01-01'`, or `p_to > p_today`. |
| `core._dashboard_change(p_cur numeric, p_prev numeric)` | `TABLE (kind text, pct numeric)` | `p_prev = 0 AND p_cur = 0` → `('NONE', NULL)`; `p_prev = 0` → `('NO_BASE', NULL)`; else `pct = round((p_cur - p_prev) / abs(p_prev) * 100, 1)` and kind `'UP'` if `pct > 0`, `'DOWN'` if `pct < 0`, `'FLAT'` if `pct = 0`. NULL inputs are treated as 0. |
| `core._dashboard_in_window(p_date date, p_local_time time, p_from date, p_to date, p_cut_time time)` | `boolean` | `p_date BETWEEN p_from AND p_to AND (p_cut_time IS NULL OR p_date < p_to OR p_local_time <= p_cut_time)` |
| `core._dashboard_bucket_start(p_date date, p_local_ts timestamp, p_bucket text)` | `timestamp` | `HOUR` → `p_date::timestamp + make_interval(hours => extract(hour FROM p_local_ts)::int)` (the **date** always comes from `p_date`); `DAY` → `p_date::timestamp`; `MONTH` → `date_trunc('month', p_date)::timestamp`; anything else → raise `DASHBOARD_BUCKET_INVALID`. |
| `core._dashboard_age_bucket(p_age_days integer)` | `text` | `p_age_days <= 30` → `'0_30'` (includes negative ages); `<= 60` → `'31_60'`; `<= 90` → `'61_90'`; else `'91_PLUS'`. |

- **Depends on:** N-1.1.
- **Pitfalls:** `extract(dow …)` returns Sunday = 0 — required by B.1; `date_trunc` returns `timestamp` for a `timestamp` input — cast carefully; `round(numeric, 1)` rounds half away from zero (expected).
- **Edge cases:** 29 February, month ends (B.1 clamps), `p_now` given in UTC (the function converts to `Africa/Algiers` first).
- **Verify:** tests H1–H6 (N-1.10).

---

**N-1.3 — Fact helpers (read tables, implement R1–R12)**
- **Objective:** every aggregate reads the same definitions.
- **Change:** create these private functions. Columns, types and order are **fixed**; the body implements the rules you wrote in Gate 0.

| Function | Returns (fixed) | Rules |
|---|---|---|
| `core._dashboard_sales(p_from date, p_to date)` | `TABLE (document_id bigint, document_number text, sale_kind text, customer_id bigint, customer_name text, sale_date date, posted_local timestamp, gross_total numeric, discount_total numeric, net_total numeric, cogs numeric)` | One row per **counted** sale (R2) with `sale_date` (R1) between `p_from` and `p_to`. `sale_kind` = `'CASH'` or `'CREDIT'`. `customer_id`/`customer_name` = the named customer (current name from `receivables.customers`) or NULL for walk-in (R11). `posted_local` = `bd.posted_at AT TIME ZONE 'Africa/Algiers'`. `gross_total` = Σ `line_total`; `discount_total` (R3); `net_total` (R2); `cogs` (R4). |
| `core._dashboard_sale_lines(p_from date, p_to date)` | `TABLE (document_id bigint, sale_date date, variant_id bigint, product_id bigint, category_id bigint, quantity numeric, line_total numeric)` | One row per line of every counted sale in the window. `quantity` in base units, `line_total` exactly as stored (never recomputed — WS-O pack lines depend on it). |
| `core._dashboard_purchases(p_from date, p_to date)` | `TABLE (document_id bigint, purchase_date date, posted_local timestamp, total numeric)` | One row per counted purchase receipt (R12) in the window. |
| `core._dashboard_variant_stock()` | `TABLE (variant_id bigint, product_id bigint, product_name text, quantity numeric, stock_value numeric, minimum_stock numeric, is_active boolean, created_on date, in_valuation boolean)` | One row per variant. `product_name` = `catalog.products.name` (plain column, used only for sorting). `quantity` = Σ `quantity_on_hand` over all warehouses (0 when no position). `stock_value` per R8. `is_active` = variant AND product active. `created_on` = `(created_at AT TIME ZONE 'Africa/Algiers')::date`. `in_valuation` = whether R8's valuation includes this variant. **No names or identifiers here** (they are costly per row; see the next helper). |
| `core._dashboard_variant_labels(p_variant_ids bigint[])` | `TABLE (variant_id bigint, item_name text, base_unit_name text, display_identifier text, identifier_type text)` | One row per id in the array (duplicates ignored). `item_name` = `catalog._effective_variant_name(variant_id)`; `base_unit_name` = name of `catalog.products.unit_id`; `display_identifier` / `identifier_type` = the same expression as `catalog.list_products_v2` (G11). Called only for rows that are already limited or paged (≤ 100 ids). |
| `core._dashboard_last_sold()` | `TABLE (variant_id bigint, last_sold_on date)` | `max(sale_date)` over all counted sales' lines, all dates (implement with R1/R2 directly; do not call `_dashboard_sales` with a huge window). |
| `core._dashboard_customer_balances()` | `TABLE (customer_id bigint, customer_name text, balance numeric)` | Exactly the set of customers and balances that R5 sums (e.g. only balances > 0 if R5 does that). `Σ balance` = the WS-I receivables total. |
| `core._dashboard_open_items_at(p_as_of date)` | `TABLE (customer_id bigint, ledger_entry_id bigint, item_date date, open_amount numeric, age_days integer)` | Algorithm C.5 (Appendix C), restricted to customers returned by `_dashboard_customer_balances()`. Rows with `open_amount = 0` are not returned. |

- **Depends on:** N-1.2, Gate 0 rules.
- **Pitfalls:** joining lines to headers and then summing header totals (multiplies totals — aggregate lines in a sub-query); forgetting credit sales or cash sales; recomputing `quantity * unit_price`.
- **Edge cases:** a sale with zero lines (should not exist; if found, it still appears with `gross_total = 0`); a variant without positions (quantity 0); inactive customers still appear in balances if R5 includes them.
- **Verify:** fixture checks F-1…F-6 (N-1.10).

---

**N-1.4 — Core computations (private, window/as-of explicit)**
- **Objective:** the exact figures, testable without the clock.
- **Change:** create these private functions. Output columns are listed in Appendix A.1 (same columns as the matching public function). Pseudo-SQL is normative.

**`core._dashboard_money_summary(p_cur_from date, p_cur_to date, p_prev_from date, p_prev_to date, p_cut_time time)`**
```sql
WITH cur  AS (SELECT * FROM core._dashboard_sales(p_cur_from, p_cur_to)),
     prev AS (SELECT s.* FROM core._dashboard_sales(p_prev_from, p_prev_to) s
              WHERE core._dashboard_in_window(s.sale_date, s.posted_local::time, p_prev_from, p_prev_to, p_cut_time)),
     c AS (SELECT coalesce(sum(net_total),0) AS sales, coalesce(sum(cogs),0) AS cogs, count(*) AS n,
                  coalesce(sum(discount_total),0) AS disc,
                  coalesce(sum(net_total) FILTER (WHERE sale_kind = 'CASH'),0) AS cash,
                  coalesce(sum(net_total) FILTER (WHERE sale_kind = 'CREDIT'),0) AS credit FROM cur),
     p AS (SELECT coalesce(sum(net_total),0) AS sales, coalesce(sum(cogs),0) AS cogs, count(*) AS n FROM prev)
SELECT c.sales, p.sales, sc.kind, sc.pct,
       <R4 profit of c>, <R4 profit of p>, pc.kind, pc.pct,
       CASE WHEN c.sales > 0 THEN round(<R4 profit of c> / c.sales * 100, 1) END,      -- margin_pct
       c.n, p.n, nc.kind, nc.pct,
       CASE WHEN c.n > 0 THEN round(c.sales / c.n, 2) END,                              -- average_sale
       c.disc, c.cash, c.credit,
       <R7: sum of expected cash of open sessions, NULL when none>, <R7: number of open sessions>,
       (SELECT coalesce(sum(balance),0) FROM core._dashboard_customer_balances()),      -- receivables_total
       <R6 total>
FROM c, p,
     LATERAL core._dashboard_change(c.sales, p.sales) sc,
     LATERAL core._dashboard_change(<R4 profit of c>, <R4 profit of p>) pc,
     LATERAL core._dashboard_change(c.n, p.n) nc;
```

**`core._dashboard_stock_summary_at(p_dead_days integer, p_as_of date)`**
- `stock_value` = Σ `stock_value` where `in_valuation`.
- `low_count` = count of active items with `minimum_stock > 0 AND quantity > 0 AND quantity <= minimum_stock`.
- `out_count` = count of active items with `quantity = 0`.
- dead set = active items with `quantity > 0 AND p_as_of - created_on >= p_dead_days AND (last_sold_on IS NULL OR p_as_of - last_sold_on >= p_dead_days)` (left join `_dashboard_last_sold()`); `dead_count` = count, `dead_value` = Σ `stock_value`.

**`core._dashboard_stock_items_at(p_kind text, p_dead_days integer, p_limit integer, p_offset integer, p_as_of date)`**
- Same sets as above for `p_kind` = `'low'`, `'out'`, `'dead'`.
- Columns: `variant_id, product_id, item_name, display_identifier, identifier_type, base_unit_name, quantity, minimum_stock, stock_value, last_sold_on, total_count` (`total_count` = `count(*) OVER ()` before paging).
- Order: `low` → `quantity / minimum_stock ASC, product_name ASC, variant_id ASC`; `out` → `product_name ASC, variant_id ASC`; `dead` → `stock_value DESC, product_name ASC, variant_id ASC`.
- `LIMIT least(greatest(coalesce(p_limit, 25), 1), 100) OFFSET p_offset` is applied **first** (with `total_count` computed before it); then the page rows are joined to `core._dashboard_variant_labels(<array of the page's variant ids>)` for the name, unit and identifier columns, keeping the page order.

**`core._dashboard_top_items(p_from date, p_to date, p_limit integer)`**
```sql
WITH top AS (
  SELECT l.variant_id, sum(l.quantity) AS quantity_sold, sum(l.line_total) AS sales_before_discount
  FROM core._dashboard_sale_lines(p_from, p_to) l
  GROUP BY l.variant_id
  ORDER BY sales_before_discount DESC, l.variant_id ASC
  LIMIT least(greatest(coalesce(p_limit, 5), 1), 10))
SELECT t.variant_id, lb.item_name, lb.base_unit_name, t.quantity_sold, t.sales_before_discount
FROM top t
JOIN core._dashboard_variant_labels(ARRAY(SELECT variant_id FROM top)) lb ON lb.variant_id = t.variant_id
ORDER BY t.sales_before_discount DESC, t.variant_id ASC;
```
(Names are looked up only for the rows kept; ties on the amount are broken by variant id.)

**`core._dashboard_top_customers(p_from date, p_to date)`** → `customer_id, customer_name, sale_count, sales` from `_dashboard_sales` where `customer_id IS NOT NULL` (and not walk-in per R11), grouped, `ORDER BY sales DESC, customer_name ASC, customer_id ASC LIMIT 5`.

**`core._dashboard_top_debtors_at(p_as_of date)`** → `customer_id, customer_name, amount_owed, oldest_open_on, oldest_open_days`: customers from `_dashboard_customer_balances()` with `balance > 0`; `oldest_open_on` = `min(item_date)` of their open items (NULL when none); `oldest_open_days` = `p_as_of - oldest_open_on`; `ORDER BY amount_owed DESC, customer_name ASC, customer_id ASC LIMIT 5`.

**`core._dashboard_latest_sales()`** → `document_id, document_number, posted_local, sale_kind, customer_name, total, is_voided`: the 5 most recent **posted** sales documents **including voided ones** (R2 without the void filter; `is_voided` per R2/G6); `total` = the sale's net total as posted; `ORDER BY posted_at DESC, document_id DESC LIMIT 5` (the tie-break matters: all rows of one transaction share `posted_at`).

**`core._dashboard_sales_series(p_from date, p_to date, p_bucket text)`**
```sql
WITH b AS (   -- every bucket, including empty ones
  SELECT gs::timestamp AS bucket_start FROM generate_series(
      CASE p_bucket WHEN 'MONTH' THEN date_trunc('month', p_from::timestamp) ELSE p_from::timestamp END,
      CASE p_bucket WHEN 'HOUR'  THEN p_from::timestamp + interval '23 hours'
                    WHEN 'MONTH' THEN date_trunc('month', p_to::timestamp)
                    ELSE p_to::timestamp END,
      CASE p_bucket WHEN 'HOUR' THEN interval '1 hour' WHEN 'DAY' THEN interval '1 day' ELSE interval '1 month' END) gs),
s AS (SELECT core._dashboard_bucket_start(sale_date, posted_local, p_bucket) AS bs, net_total, cogs, sale_kind
      FROM core._dashboard_sales(p_from, p_to)),
sa AS (SELECT bs, sum(net_total) AS sales, sum(cogs) AS cogs, count(*) AS n,
              sum(net_total) FILTER (WHERE sale_kind = 'CASH') AS cash,
              sum(net_total) FILTER (WHERE sale_kind = 'CREDIT') AS credit
       FROM s GROUP BY bs),
pu AS (SELECT core._dashboard_bucket_start(purchase_date, posted_local, p_bucket) AS bs, sum(total) AS total
       FROM core._dashboard_purchases(p_from, p_to) GROUP BY 1)
SELECT b.bucket_start,
       coalesce(sa.sales, 0), <R4 profit of (coalesce(sa.sales,0), coalesce(sa.cogs,0))>,
       coalesce(sa.cash, 0), coalesce(sa.credit, 0), coalesce(pu.total, 0), coalesce(sa.n, 0)
FROM b LEFT JOIN sa ON sa.bs = b.bucket_start LEFT JOIN pu ON pu.bs = b.bucket_start
ORDER BY b.bucket_start;
```
Columns: `bucket_start timestamp, sales numeric, profit numeric, cash_sales numeric, credit_sales numeric, purchases numeric, sale_count bigint`.

**`core._dashboard_sales_by_category(p_from date, p_to date)`** → `sort_order integer, category_key text, category_name text, sales_before_discount numeric, share_pct numeric`:
1. `t` = Σ `line_total` per `category_id` from `_dashboard_sale_lines`.
2. Named categories ranked by value DESC, name ASC, id ASC: ranks 1–8 → rows with `category_key = 'ID:' || category_id`, `sort_order` = rank.
3. Ranks 9+ summed → one row `('OTHER', NULL)` with `sort_order = 9` (only if any).
4. `category_id IS NULL` → one row `('NONE', NULL)` with `sort_order = 10` (only if any).
5. `share_pct = round(value / Σ all values * 100, 1)` (NULL when Σ = 0). Result ordered by `sort_order`.

**`core._dashboard_busy_hours(p_from date, p_to date)`** → exactly 168 rows `weekday integer (0 = Sunday … 6 = Saturday), hour integer (0–23), sale_count bigint, sales numeric`:
```sql
SELECT d.dow, h.hr, count(s.document_id), coalesce(sum(s.net_total), 0)
FROM generate_series(0, 6) d(dow) CROSS JOIN generate_series(0, 23) h(hr)
LEFT JOIN core._dashboard_sales(p_from, p_to) s
       ON extract(dow FROM s.sale_date)::int = d.dow AND extract(hour FROM s.posted_local)::int = h.hr
GROUP BY d.dow, h.hr ORDER BY d.dow, h.hr;
```

**`core._dashboard_receivables_aging_at(p_as_of date)`** → `sort_order integer, bucket text, amount numeric, item_count bigint`, exactly 6 rows:
- sort 1–4: `'0_30'`, `'31_60'`, `'61_90'`, `'91_PLUS'` = Σ `open_amount` and count of open items with `core._dashboard_age_bucket(age_days)` = that bucket (0 when none).
- sort 5: `'UNAPPLIED'` = `receivables_total − Σ open_amount` (0 or negative), `item_count` 0.
- sort 6: `'TOTAL'` = `receivables_total` (Σ balances of `_dashboard_customer_balances()`), `item_count` 0.

- **Depends on:** N-1.3.
- **Pitfalls:** summing purchases through the sales join (multiplies purchases); forgetting empty buckets; `count(s.*)` vs `count(s.document_id)` on a LEFT JOIN (use the id).
- **Edge cases:** windows with no data → zeros, never missing rows (series, busy hours, aging).
- **Verify:** fixture F-7…F-20 and invariants I-1…I-6.

---

**N-1.5 — Public functions (session check + validation + call)**
- **Objective:** the 12 functions the app calls.
- **Change:** create the 12 public functions of **Appendix A.1** exactly (names, parameter order, types, output columns), each:
```sql
CREATE FUNCTION core.dashboard_money_summary(p_session_token text, p_cur_from date, p_cur_to date,
       p_prev_from date, p_prev_to date, p_cut_time time)
RETURNS TABLE (...Appendix A.1...)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE v_today date := (now() AT TIME ZONE 'Africa/Algiers')::date;
BEGIN
    PERFORM 1 FROM iam.resolve_session(p_session_token);
    PERFORM core._dashboard_validate_window(p_cur_from, p_cur_to, v_today);
    PERFORM core._dashboard_validate_window(p_prev_from, p_prev_to, v_today);
    RETURN QUERY SELECT * FROM core._dashboard_money_summary(p_cur_from, p_cur_to, p_prev_from, p_prev_to, p_cut_time);
END; $$;
REVOKE ALL ON FUNCTION core.dashboard_money_summary(text, date, date, date, date, time) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.dashboard_money_summary(text, date, date, date, date, time) TO stockiha_runtime;
```
  Validation per function is listed in Appendix A.1. Time-dependent public functions pass `v_today` as `p_as_of` and `now()` as `p_now`.
- **Pitfalls:** `RETURNS TABLE` column names must not collide with parameter names inside plpgsql (prefix none of the output columns with `p_`); forgetting a grant makes the call fail at runtime (`42501`).
- **Verify:** T-P1…T-P6 (N-1.10).

---

**N-1.6 — Rust module**
- **Objective:** typed services for the 12 functions.
- **Location:** new `src-tauri/src/application/dashboard_insights.rs`; register `pub(crate) mod dashboard_insights;` in `src-tauri/src/application/mod.rs`.
- **Change:**
  1. Row structs `#[derive(sqlx::FromRow)]` with fields named exactly like the SQL columns: `numeric` → `rust_decimal::Decimal` (`Option<Decimal>` when nullable), `bigint` → `i64`, `integer` → `i32`, `text` → `String`/`Option<String>`, `date` → `time::Date`, `time` → `Option<time::Time>`, `timestamp` → `time::PrimitiveDateTime`, `boolean` → `bool`.
  2. Response DTOs `#[derive(serde::Serialize)]` with the **same field names** and the TS types of Appendix A.2: every `Decimal` → `String` via `.to_string()`; `Date` → `"YYYY-MM-DD"` via `date.to_string()`; `Time` → `"HH:MM:SS"` via `format!("{:02}:{:02}:{:02}", t.hour(), t.minute(), t.second())` (do **not** use `Time`'s `Display`, it prints fractions); `PrimitiveDateTime` → `"YYYY-MM-DDTHH:MM:SS"` via `format!("{}T{:02}:{:02}:{:02}", v.date(), v.hour(), v.minute(), v.second())`.
  3. Input parsing helpers (with unit tests):
     - `parse_iso_date(s: &str) -> Result<time::Date, AppError>`: exactly `YYYY-MM-DD` (10 chars, digits and two `-`); `Date::from_calendar_date(y, Month::try_from(m)?, d)`; any failure → `AppError::ValidationError { diagnostic: format!("DASHBOARD_DATE_INVALID: {s}") }`.
     - `parse_hms(s: &str) -> Result<time::Time, AppError>`: exactly `HH:MM:SS`; `Time::from_hms`; failure → `ValidationError`.
     - `parse_period(s: &str) -> Result<&'static str, AppError>`: one of `today, week, month, year, custom`.
     - `parse_bucket`, `parse_kind` likewise (`HOUR, DAY, MONTH`; `low, out, dead`).
  4. One `pub(crate) async fn` per public SQL function (names in Appendix A.1, column "Rust service"), each binding **every** parameter with an explicit cast, e.g. `SELECT * FROM core.dashboard_money_summary($1::text, $2::date, $3::date, $4::date, $5::date, $6::time)`, `.map_err(AppError::from_posting_error)`.
- **Pitfalls:** decoding a positional tuple instead of a named struct; forgetting `Option` on nullable columns (`cut_time`, `pct`, `margin_pct`, `average_sale`, `cash_in_drawer`, `oldest_open_on`, `last_sold_on`, `customer_name`, `category_name`, `share_pct`).
- **Verify:** `cargo check`, `clippy`, unit tests for the parse/format helpers (N-1.10 T-R1…T-R4).

---

**N-1.7 — Tauri commands**
- **Location:** new `src-tauri/src/commands/dashboard_insights.rs`; register the module in `src-tauri/src/commands/mod.rs`; register the 12 commands in `src-tauri/src/lib.rs` next to `commands::reference::get_dashboard_summary`.
- **Change:** one `#[tauri::command] pub(crate) async fn` per row of Appendix A.1 column "Tauri command", following the existing pattern [S]:
```rust
#[tauri::command]
pub(crate) async fn dashboard_get_money_summary(
    state: State<'_, DatabaseState>, session_token: String,
    cur_from: String, cur_to: String, prev_from: String, prev_to: String, cut_time: Option<String>,
) -> Result<DashboardMoneySummaryDto, IpcError> {
    let started = std::time::Instant::now();
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    let result = dashboard_insights::get_money_summary(pool, &session_token,
        parse_iso_date(&cur_from)?, parse_iso_date(&cur_to)?, parse_iso_date(&prev_from)?,
        parse_iso_date(&prev_to)?, cut_time.as_deref().map(parse_hms).transpose()?)
        .await.map_err(IpcError::from);
    log_slow("dashboard_get_money_summary", started);   // 7.8, debug builds only
    result
}
```
  (Parse errors are `AppError`; convert with `.map_err(IpcError::from)` exactly like the existing commands do — follow the live pattern.)
- **Pitfalls:** Tauri maps JS camelCase keys to Rust snake_case arguments (`curFrom` → `cur_from`); an unregistered command fails only at runtime.
- **Verify:** `cargo check`; T-R5 (every command name appears in `lib.rs`).

---

**N-1.8 — TypeScript contracts**
- **Location:** `src/shared/ipc/commands.ts`, new `src/shared/ipc/dashboardDto.ts`, new `src/shared/ipc/dashboardGateway.ts`.
- **Change:**
  - `commands.ts`: add the 12 command constants of Appendix A.1 (`DASHBOARD_GET_PERIOD: 'dashboard_get_period'`, …).
  - `dashboardDto.ts`: the types of Appendix A.2, exactly.
  - `dashboardGateway.ts`: copy the local `call<T>` of `receivablesGateway.ts` [S] and export one function per command (Appendix A.1 column "Gateway function"), passing `{ sessionToken, …camelCaseArgs }`.
- **Verify:** `npm run typecheck`; T-T1 (gateway passes the exact argument names — mock `invoke`).

---

**N-1.9 — Marker**
Set the old screen's marker line to `[ version = WS-N-1.1 ]`. Nothing else in the old screen changes.

---

**N-1.10 — Tests**

**A. SQL helper suite** — new `src-tauri/tests/dashboard/ws_n_1_dashboard_helpers.sql` (add to `run_current_sql_suites.sh`). No data needed. Assert every example of Appendix B.2 and C.1–C.4 exactly:
- H1 `_dashboard_period_bounds_at`: all 18 rows of B.2, plus errors: period `'decade'`, custom with NULL dates, custom `from > to`, custom `to` after today, custom `from < 2000-01-01` → `22023`.
- H2 `_dashboard_change`: all rows of C.1.
- H3 `_dashboard_in_window`: all rows of C.2.
- H4 `_dashboard_bucket_start`: all rows of C.3, plus `'WEEK'` → `22023`.
- H5 `_dashboard_age_bucket`: all rows of C.4.
- H6 `_dashboard_validate_window`: valid window passes; the four invalid cases raise `22023`.

**B. SQL integration suite** — new `src-tauri/tests/dashboard/ws_n_1_dashboard_integration.sql` (add to the runner). Everything happens **today** (S11). Let `T = (now() AT TIME ZONE 'Africa/Algiers')::date` and `H = extract(hour FROM now() AT TIME ZONE 'Africa/Algiers')::int`.
**Precondition (first statement of the suite):** the database holds no business data — no posted sales, no customer ledger entries, no stock position with a quantity above 0. If any exists, `RAISE EXCEPTION 'WS-N-1 integration suite needs an empty business database'` (the dedicated CI database is empty, S15; never run this suite against `stockiha_acceptance`).

Setup (copy the setup patterns of the live suites for direct purchase, supplier payment, cash session, cash sale with discount, pack sale (WS-O-4), credit sale, customer payment, sale void; pass every parameter explicitly):

| Step | Action |
|---|---|
| F0 | Admin session `'wsnadmin'`; warehouse; open fiscal period containing `T`; unit `CTN` "Carton"; categories **Oreillers**, **Couettes**; products/variants (base unit = the seeded unit): **A** "Oreiller blanc" (Oreillers, price 1,000.00, min 5) with pack Carton ×12 at 15,000.00, main (WS-O `create_pack`); **B** "Couette 2p" (Couettes, 2,000.00, min 5); **C** "Drap 1p" (no category, 1,200.00, min 0); **D** "Plaid" (no category, 900.00, min 0); **F** "Ancien modèle" (no category, 500.00, min 5), then set F's variant **inactive**. Customers **Karim** and **Samir** (credit enabled, limit 1,000,000.00). Supplier **Alpha**. |
| F1 | Direct purchase from Alpha: A 80 × 800.00, B 10 × 1,500.00, D 4 × 500.00 (total 81,000.00). |
| F2 | Supplier payment to Alpha 30,000.00. |
| F3 | Open a cash session with opening float 0.00. |
| F4 | S1 cash (walk-in): B 1 × 2,000.00. |
| F5 | S2 cash: A 3 × 1,000.00. |
| F6 | S3 credit Karim: B 2 × 2,000.00. |
| F7 | S4 cash: A 1 × 1,000.00, then **void S4**. |
| F8 | S5 cash: A pack line `pack_quantity 2, extra_quantity 5, pack_price 15000.00` and a **whole-sale discount of 250.00** (WS-F-3). |
| F9 | S6 credit Samir: B 3 × 2,100.00. |
| F10 | Samir pays 2,000.00 in cash, allocated to S6. |
| F11 | S7 credit Karim: A 5 × 1,000.00. |
| F12 | S8 cash: A 2 × 1,100.00. |
| F13 | S9 credit Samir: B 1 × 2,000.00. |
| F14 | Samir pays 500.00 in cash, allocated to S9. |
| F15 | **Void S9** (the 500.00 stays as customer credit, WS-F-6 ruling). |

Expected results (assert exactly; money as `numeric` equality):

| # | Call | Expected |
|---|---|---|
| F-1 | `_dashboard_sales(T, T)` | 7 rows (S1, S2, S3, S5, S6, S7, S8); S4 and S9 absent; Σ gross 58,750.00; Σ discount 250.00; Σ net 58,500.00; Σ cogs 40,200.00; S5 row: gross 36,250.00, discount 250.00, net 36,000.00 |
| F-2 | `_dashboard_sale_lines(T, T)` | Σ `line_total` 58,750.00; S5 has 2 lines (24 units / 30,000.00 and 5 units / 6,250.00) |
| F-3 | `_dashboard_purchases(T, T)` | 1 row, total 81,000.00 |
| F-4 | `_dashboard_variant_stock()` | A qty 41 value 32,800.00; B qty 4 value 6,000.00; C qty 0; D qty 4 value 2,000.00; F `is_active = false` |
| F-5 | `_dashboard_customer_balances()` | Karim 9,000.00; Samir 3,800.00 (Σ 12,800.00) |
| F-6 | `_dashboard_open_items_at(T)` | 3 rows: Karim S3 4,000.00, Karim S7 5,000.00, Samir S6 4,300.00; all `age_days = 0`; no row for S9 |
| F-7 | `_dashboard_money_summary(T, T, T-1, T-1, NULL)` | sales 58,500.00; prev_sales 0; sales_change `NO_BASE`/NULL; profit 18,300.00; prev_profit 0; profit_change `NO_BASE`; margin_pct 31.3; sale_count 7; prev_sale_count 0; count_change `NO_BASE`; average_sale 8,357.14; discount_total 250.00; cash_sales 43,200.00; credit_sales 15,300.00; open_session_count 1; receivables_total 12,800.00. **Assert** `cash_in_drawer` = the R7 function's value and `payables_total` = the R6 function's value; **report** whether they equal the expected 45,700.00 (float 0 + cash sales + cash customer payments − cash refund of the S4 void) and 51,000.00 (81,000.00 − 30,000.00) |
| F-8 | `_dashboard_stock_summary_at(90, T)` | stock_value 40,800.00; low_count 1; out_count 1; dead_count 0; dead_value 0 |
| F-9 | `_dashboard_stock_summary_at(90, T + 100)` | dead_count 3; dead_value 40,800.00 |
| F-10 | `_dashboard_stock_summary_at(180, T + 100)` | dead_count 0 |
| F-11 | `_dashboard_stock_items_at('low', 90, 25, 0, T)` | 1 row: B, quantity 4, minimum 5, value 6,000.00, total_count 1 |
| F-12 | `_dashboard_stock_items_at('out', 90, 25, 0, T)` | 1 row: C (F is inactive and absent) |
| F-13 | `_dashboard_stock_items_at('dead', 90, 2, 0, T + 100)` then offset 2 | page 1: A (32,800.00), B (6,000.00), total_count 3; page 2: D (2,000.00, last_sold_on NULL) |
| F-14 | `_dashboard_top_items(T, T, 5)` | A: qty 39, 46,450.00; B: qty 6, 12,300.00 (2 rows) |
| F-15 | `_dashboard_top_customers(T, T)` | Karim 2 sales 9,000.00; Samir 1 sale 6,300.00 |
| F-16 | `_dashboard_top_debtors_at(T)` | Karim 9,000.00 (oldest T, 0 days); Samir 3,800.00 (oldest T, 0 days) |
| F-17 | `_dashboard_latest_sales()` | 5 rows in order S9 (credit, Samir, 2,000.00, voided), S8 (cash, walk-in, 2,200.00), S7 (credit, Karim, 5,000.00), S6 (credit, Samir, 6,300.00), S5 (cash, walk-in, 36,000.00) |
| F-18 | `_dashboard_sales_series(T-2, T, 'DAY')` | 3 rows; first two all zero; last: sales 58,500.00, profit 18,300.00, cash 43,200.00, credit 15,300.00, purchases 81,000.00, count 7 |
| F-19 | `_dashboard_sales_series(T, T, 'HOUR')` | 24 rows; the row at `T + H hours` holds the totals of F-18; the other 23 are zero |
| F-20 | `_dashboard_sales_series(first day of (T's month − 2 months), T, 'MONTH')` | 3 rows; the last holds the totals |
| F-21 | `_dashboard_sales_by_category(T, T)` | `ID:<Oreillers>` 46,450.00 share 79.1 (sort 1); `ID:<Couettes>` 12,300.00 share 20.9 (sort 2); no OTHER, no NONE |
| F-22 | `_dashboard_busy_hours(T, T)` | 168 rows; only (`dow(T)`, `H`): count 7, sales 58,500.00 |
| F-23 | `_dashboard_receivables_aging_at(T)` | 0_30 13,300.00 (3); 31_60 0; 61_90 0; 91_PLUS 0; UNAPPLIED −500.00; TOTAL 12,800.00 |
| F-24 | `_dashboard_receivables_aging_at(T + 100)` | 91_PLUS 13,300.00 (3); other buckets 0; UNAPPLIED −500.00; TOTAL 12,800.00 |

Invariants (assert):
- **I-1** Σ series `sales` = money `sales`; Σ series `cash_sales` = money `cash_sales`; Σ series `credit_sales` = money `credit_sales`; money `cash_sales` + `credit_sales` = money `sales`; Σ `sale_count` = money `sale_count` (for F-18, F-19, F-20).
- **I-2** |Σ series `profit` − money `profit`| ≤ 0.01 × (number of non-empty buckets).
- **I-3** Σ category values = Σ `sales_before_discount` of `_dashboard_top_items(T, T, 10)` = money `sales` + money `discount_total` = 58,750.00.
- **I-4** Σ busy-hours `sale_count` = money `sale_count`; Σ busy-hours `sales` = money `sales`.
- **I-5** Σ aging rows 1–5 = aging `TOTAL` = money `receivables_total`.
- **I-6 (WS-I equality)** For the window `[T, T]`, call the WS-I functions named in R2, R4, R5, R6, R8 and assert: sales, profit, sale count, receivables total, payables total, stock value are **equal** to the dashboard values (compare with the WS-I value rounded to 2 decimals when WS-I returns more). If a fixture expectation above differs from WS-I, WS-I wins: make the dashboard equal to WS-I, never change WS-I, and report the row with both numbers.

**C. Public function checks** (same integration file, after the fixture):
- T-P1 every public function called with an unknown session token raises the SQLSTATE that `iam.resolve_session` raises for it (G3; expected `28000`).
- T-P2 `dashboard_money_summary` with `cur_to = T + 1` → `22023`; with `cur_from > cur_to` → `22023`.
- T-P3 `dashboard_stock_summary(token, 45)` → `22023`.
- T-P4 `dashboard_stock_items(token, 'all', 90, 25, 0)` → `22023`; offset −1 → `22023`. Limit clamp on the private function: `_dashboard_stock_items_at('dead', 90, 0, 0, T + 100)` → 1 row; with limit NULL → 3 rows.
- T-P5 `dashboard_sales_series(token, T-1, T, 'HOUR')` → `22023` (HOUR needs a single day); `'WEEK'` → `22023`; `DAY` over 367 days → `22023`.
- T-P6 `dashboard_period(token, 'month', NULL, NULL)` returns one row whose `today` = `T`.

**D. Rust unit tests** (in `dashboard_insights.rs`, `#[cfg(test)]`):
- T-R1 `parse_iso_date`: `"2026-09-24"` ok; `"2026-9-24"`, `"2026-02-30"`, `"24/09/2026"`, `""` → `ValidationError`.
- T-R2 `parse_hms`: `"12:00:00"` ok; `"12:00"`, `"25:00:00"` → error.
- T-R3 time formatting: `Time 09:05:03` → `"09:05:03"`; `PrimitiveDateTime 2026-09-24 09:00:00` → `"2026-09-24T09:00:00"`.
- T-R4 `parse_period`, `parse_bucket`, `parse_kind` accept exactly the listed values.
- T-R5 a test (or a documented grep in the report) proving all 12 commands are registered in `lib.rs`.

**E. TypeScript** — `tests/dashboard.gateway.test.ts`: mock `@tauri-apps/api/core` `invoke`; call every gateway function once; assert the command name and the exact argument object (e.g. `{ sessionToken: 'tok', curFrom: '2026-09-01', curTo: '2026-09-24', prevFrom: '2026-08-01', prevTo: '2026-08-24', cutTime: '12:00:00' }`) (T-T1).

---

**N-1.11 — Performance**
- **Location:** new `src-tauri/tests/perf/ws_n_1_dashboard_perf_seed.sql` — run **only** against a scratch database `stockiha_ws_n_perf` created for this purpose, never against `stockiha_acceptance`, never added to the suite runner.
- **Seed (through the live posting functions, all dated today):** 5,000 products; 17,500 variants; 200 customers; 12,000 sales with 50,000 lines in total (≈ 20 % credit); 1,000 customer payments; 300 purchases.
- **Measure** each public function with `EXPLAIN (ANALYZE, BUFFERS)` using the window `[today, today]` (worst case: every row is inside it). Target **< 300 ms** each.
- If a function is slower: add the single index its plan shows is missing, in a second migration `<timestamp>_ws_n_1_dashboard_indexes.sql`, re-measure, report both timings and the reason for the index. If still slower after one index per function, STOP and report the plans.

**N-1.12 — Verification, build, report** (7.7, section 16).

### N-1 data flow (reference for N-2)
React `dashboardGateway.getDashboardPeriod(token, 'month', null, null)` → `invoke('dashboard_get_period', { sessionToken, period: 'month', from: null, to: null })` → `commands::dashboard_insights::dashboard_get_period` (parse) → `application::dashboard_insights::get_period` → `SELECT * FROM core.dashboard_period($1::text, $2::text, $3::date, $4::date)` → session check → `_dashboard_period_bounds_at(…, now())` → row → DTO with string dates → React stores the window → every other call receives that window.

### N-1 acceptance criteria
1. Migration applies on an empty database and on `stockiha_acceptance`; the backup ACL suite still passes (no new schema).
2. H1–H6, F-1…F-24, I-1…I-6, T-P1…T-P6 pass with pasted output; every pre-existing SQL suite passes unchanged.
3. Rust T-R1…T-R5 and TS T-T1 pass; `cargo clippy -D warnings` clean.
4. Contract triangle reported for all 12 functions (SQL signature · Rust struct + call site · TS type).
5. Performance table: every public function < 300 ms on the perf seed, or an index added and justified.
6. Rules R1–R12 written in the report with evidence and the SQL expression used.
7. No file outside this sub-plan's list changed (report `git diff --stat`).

### N-1 stop conditions
Gate 0 stop rules; a fixture step cannot be performed with the live functions (report which and why); I-6 cannot be made to hold without changing WS-I; two fix attempts fail on the same problem.

---

## 10. Sub-plan N-2 — Overview screen (top half)

**Goal:** the dashboard page shows the context bar, both KPI strips, the rail (quick actions, cash, alerts, debtors, running low), the three lists, the stock dialog and the footer — all from N-1 data, loading section by section, never breaking the page.

**Branch:** `task/ws-n-2-dashboard-overview` from accepted N-1. **Marker:** `[ version = WS-N-2.1 ]`.

### N-2.0 Gate 0
| # | Find | Stop if |
|---|---|---|
| G1 | N-1 gateway file `src/shared/ipc/dashboardGateway.ts` and DTO file exist with the Appendix A.2 types | missing |
| G2 | Live `AppView` union, live `canShow` (or its replacement) in `AppShell.tsx` with every input it reads, and live AppRouter guards. If `canShow` reads a hook or context directly (e.g. the user's roles), the extracted function receives those values as extra `NavAccess` fields. | `canShow` does not exist in any form |
| G3 | **Navigation map M1** — for each purpose below, the live view name whose screen serves it (or "none"): `M-POS` (till), `M-PURCHASE` (direct purchase entry), `M-CUSTOMERS` (customers + payments), `M-SUPPLIERS` (suppliers + supplier payments), `M-PRODUCTS`, `M-ADJUSTMENT`, `M-INVENTORY`, `M-SESSION` (cash session), `M-DOCUMENTS`, `M-REPORT-SALES`, `M-REPORT-PROFIT`, `M-REPORT-OWED` (money owed by customers), `M-REPORT-PAYABLES` (supplier balances), `M-REPORT-STOCK`, `M-NOTIFICATIONS`. If WS-I has one `reports` view with tabs, map every report purpose to it. | `M-POS` has no view |
| G4 | The sidebar icon glyph of each mapped view (live `NAV` list) | — |
| G5 | i18n dictionary file(s) and how a key is added to all three locales | — |
| G6 | Where CSS files are imported (`src/App.tsx` [S]) | — |
| G7 | Every existing test that references the dashboard (S4) and each assertion that checks an **old** dashboard widget | — |
| G8 | WS-O `PackQuantity` props and `usePrimaryPacks` signature (live) | missing |
| G9 | The notifications count gateway function (R10 from the N-1 report) | — |

### N-2 steps

---

**N-2.1 — Page preferences (memory only)**
- **Location:** new `src/features/dashboard/dashboardPrefs.ts` (+ `tests/dashboard.prefs.test.ts`).
- **Change:**
```ts
export type PeriodKind = 'today' | 'week' | 'month' | 'year' | 'custom';
export interface DashboardPrefs { period: PeriodKind; customFrom: string | null; customTo: string | null; compare: boolean; deadDays: 30 | 60 | 90 | 180; }
const DEFAULT_PREFS: DashboardPrefs = { period: 'today', customFrom: null, customTo: null, compare: true, deadDays: 90 };
let current: DashboardPrefs = { ...DEFAULT_PREFS };
export function getDashboardPrefs(): DashboardPrefs { return { ...current }; }
export function setDashboardPrefs(patch: Partial<DashboardPrefs>): DashboardPrefs { current = { ...current, ...patch }; return { ...current }; }
export function resetDashboardPrefsForTests(): void { current = { ...DEFAULT_PREFS }; }
```
- **Logic:** survives leaving and re-opening the dashboard during one app run; resets on restart (D11). No `localStorage`.
- **Verify:** default values; patch merges; reset restores.

---

**N-2.2 — One visibility rule for sidebar and dashboard**
- **Location:** new `src/app/navigationAccess.ts` (+ `tests/navigation-access.test.ts`); edit `src/app/AppShell.tsx`.
- **Change:** move the body of `canShow` into
```ts
export interface NavAccess { inventoryCapabilities: InventoryCapabilities | null; inventoryCorrectionsEnabled: boolean | null; procurementCapabilities: ProcurementCapabilities | null; /* plus every other input the live canShow reads (G2) */ }
export function isNavViewVisible(view: AppView, access: NavAccess): boolean { /* the live switch, unchanged */ }
```
  and make `canShow(item)` return `isNavViewVisible(item.view, { … })`.
- **Must not change:** which sidebar items are visible for any input.
- **Verify:** a truth-table test: for every `AppView` value and four access cases (all capabilities false/null; all true with corrections enabled; all true with corrections disabled; procurement false only), the result equals what the pre-change `canShow` returned (write the expected table from the live switch before moving it). Existing shell tests pass.

---

**N-2.3 — Formatting helpers**
- **Location:** new `src/features/dashboard/dashboardFormat.ts` (+ `tests/dashboard.format.test.ts`).
- **Change (exact behaviour; examples are the tests):**

| Function | Behaviour | Examples |
|---|---|---|
| `splitAmount(value: string): { sign: '' \| '-'; integer: string; fraction: string }` | Parse a decimal string; group the integer part with `,` every 3 digits; `fraction` = `.` + exactly 2 digits (pad or keep; values from SQL have ≤ 2 decimals for money). | `"58500.00"` → `{'', '58,500', '.00'}`; `"-1250.5"` → `{'-', '1,250', '.50'}`; `"0"` → `{'', '0', '.00'}` |
| `formatCount(n: number): string` | Integer with `,` grouping. | `7` → `"7"`; `12000` → `"12,000"` |
| `formatPct(value: string): string` | Absolute value, one decimal kept as given. | `"-76.4"` → `"76.4"`; `"31.3"` → `"31.3"` |
| `deltaText(kind, pct, prevAmountText, t)` | `UP` → `t('dash.delta.up', { pct })`; `DOWN` → `t('dash.delta.down', { pct })` (pct without minus); `FLAT` → `t('dash.delta.flat')`; `NO_BASE` → `t('dash.delta.noBase', { value: prevAmountText })`; `NONE` → `''` | — |
| `formatRange(from, to, locale)` | `from === to` → `formatDisplayDate(from, locale)`; else `t('dash.period.range', { from, to })` with both dates formatted by `formatDisplayDate`. | `2026-09-01`/`2026-09-24` en → `"1 Sep 2026 – 24 Sep 2026"` |
| `formatCutTime(cut: string \| null)` | `"12:00:00"` → `"12:00"`; `null` → `null` | — |
| `formatTimeOfSale(postedLocal, today, locale)` | Same date as `today` → `"HH:MM"`; else `formatDisplayDate(date) + ' ' + "HH:MM"` | `"2026-09-24T09:30:00"`, today `2026-09-24` → `"09:30"` |
| `nowClockLabel(date: Date)` | `HH:MM` in `Africa/Algiers` via `Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Algiers', hour: '2-digit', minute: '2-digit', hour12: false })` | — |

- **Pitfalls:** no `parseFloat`/`Number()` on money; string operations only.

---

**N-2.4 — Quick actions and links**
- **Location:** new `src/features/dashboard/quickActions.ts` (+ `tests/dashboard.quick-actions.test.ts`).
- **Change:**
```ts
export type NavPurpose = 'M-POS' | 'M-PURCHASE' | 'M-CUSTOMERS' | 'M-SUPPLIERS' | 'M-PRODUCTS' | 'M-ADJUSTMENT' | 'M-INVENTORY' | 'M-SESSION' | 'M-DOCUMENTS' | 'M-REPORT-SALES' | 'M-REPORT-PROFIT' | 'M-REPORT-OWED' | 'M-REPORT-PAYABLES' | 'M-REPORT-STOCK' | 'M-NOTIFICATIONS';
export const NAV_MAP: Record<NavPurpose, AppView | null> = { /* filled from G3; null = none */ };
export function resolveTarget(purposes: NavPurpose[], access: NavAccess): AppView | null  // first purpose whose view is non-null AND isNavViewVisible
export const QUICK_ACTIONS = [
  { id: 'newSale',         labelKey: 'dash.actions.newSale',         purposes: ['M-POS'] },
  { id: 'newPurchase',     labelKey: 'dash.actions.newPurchase',     purposes: ['M-PURCHASE'] },
  { id: 'customerPayment', labelKey: 'dash.actions.customerPayment', purposes: ['M-CUSTOMERS'] },
  { id: 'supplierPayment', labelKey: 'dash.actions.supplierPayment', purposes: ['M-SUPPLIERS'] },
  { id: 'addProduct',      labelKey: 'dash.actions.addProduct',      purposes: ['M-PRODUCTS'] },
  { id: 'stockAdjustment', labelKey: 'dash.actions.stockAdjustment', purposes: ['M-ADJUSTMENT'] },
] as const;
```
  Link targets (use `resolveTarget` with these purpose lists, in order):

| Element | Purposes |
|---|---|
| Sales KPI, Number of sales KPI, Best-selling items "See all" | `M-REPORT-SALES` |
| Profit KPI | `M-REPORT-PROFIT` |
| Customers owe you KPI, Biggest debtors "See all" | `M-REPORT-OWED`, `M-CUSTOMERS` |
| You owe suppliers KPI | `M-REPORT-PAYABLES`, `M-SUPPLIERS` |
| Stock value KPI | `M-REPORT-STOCK`, `M-INVENTORY` |
| Cash in drawer card link | `M-SESSION` |
| Alerts card link | `M-NOTIFICATIONS` |
| Best customers "See all" | `M-CUSTOMERS` |
| Latest sales "See all", footer link | `M-DOCUMENTS` |
| Stock dialog "Open inventory" | `M-INVENTORY` |

  `resolveTarget` returns `null` → the element is **not clickable** (KPI) or **not rendered** (button/link) (DESIGN "hide, do not tease").
- **Verify:** tests for a hidden adjustment action when corrections are disabled; fallback to `M-CUSTOMERS` when `M-REPORT-OWED` is null.

---

**N-2.5 — Data hook**
- **Location:** new `src/features/dashboard/useDashboardData.ts`.
- **Change:** a hook `useDashboardData(token: string, prefs: DashboardPrefs)` returning section states and actions.
```ts
type SectionState<T> = { status: 'loading' | 'ready' | 'error'; data: T | null; errorCode: AppErrorCode | null; refreshing: boolean };
sections: period, money, topItems, topCustomers (period-dependent); stock, runningLow, debtors, latest, alerts, system (right now)
actions: refreshAll(), changePeriod(next: {period, customFrom, customTo}), changeDeadDays(days), retry(section)
updatedAt: string | null   // nowClockLabel of the last completed refreshAll
```
- **Load logic (exact):**
  1. **On mount** and **refreshAll**: call `getDashboardPeriod(token, prefs.period, customFrom, customTo)`. On success store it, then start **in parallel**: `money` (window from the period), `topItems` (limit 5), `topCustomers`, `stock` (deadDays), `runningLow` (`listDashboardStockItems('low', deadDays, 5, 0)`), `debtors`, `latest`, `alerts` (R10 gateway), `system` (`getDashboardSummary(token, workstationId)` — show only pending jobs). On period failure: the four period-dependent sections go to `error`; right-now sections still load.
  2. **changePeriod**: `setDashboardPrefs(…)`, call `getDashboardPeriod`, then reload only period-dependent sections.
  3. **changeDeadDays**: `setDashboardPrefs({ deadDays })`, reload `stock` only.
  4. **retry(section)**: reload that section only (with the current period).
  5. First load of a section: `status: 'loading'` (skeleton). Later loads: keep `data`, set `refreshing: true` (old values dimmed), then replace.
  6. **Stale responses:** keep a `useRef<Record<string, number>>` sequence per section; increment before each call; apply a result only if its sequence is still the latest.
  7. **Session expiry:** if any call fails with `SESSION_INVALID`, call `clearSession()` once.
  8. Every promise has a `catch`; nothing throws out of the hook (S4: unknown commands reject in tests).
  9. `updatedAt` is set when every section started by `refreshAll` has settled (success or error).
- **Verify:** covered by N-2.12 tests.

---

**N-2.6 — Context bar**
- **Location:** new `src/features/dashboard/components/PeriodBar.tsx`.
- **Renders (in this order, one row that wraps):**
  1. `<h1>{t('dashboard.title')}</h1>` — rendered **immediately**, before any data (S4).
  2. Period group: `<div role="group" aria-label={t('dash.period.label')}>` with 5 `<button type="button" aria-pressed>`: Today / This week / This month / This year / Custom. Clicking a non-custom button calls `changePeriod`. Clicking Custom only reveals the date inputs (no load yet).
  3. Custom inputs (only when Custom is selected): `TextField type="date"` "From" and "To" (`min="2000-01-01"`, `max={today}` from `currentBusinessDate()`), and an **Apply** button. Apply validates (below) and then calls `changePeriod({ period: 'custom', customFrom, customTo })`.
  4. Range line (`body-sm`, muted): `formatRange(cur_from, cur_to)`; when Compare is on: `t('dash.period.rangeCompared', { range, prevRange })` and, when `cut_time` is set, `t('dash.period.cutNote', { time })` appended. `aria-live="polite"`.
  5. Compare switch: `<label><input type="checkbox"> {t('dash.compare')}</label>` → `setDashboardPrefs({ compare })`; hides/shows delta lines; **no reload**.
  6. `t('dash.updatedAt', { time: updatedAt })` (hidden until the first full load).
  7. Refresh `Button variant="secondary"` → `refreshAll()`; shows its spinner while any section is refreshing.
- **Custom validation (client mirror of `DASHBOARD_RANGE_INVALID`):** both empty/one empty → `dash.period.error.missing`; `from > to` → `dash.period.error.order`; `to > today` → `dash.period.error.future`; `from < 2000-01-01` → `dash.period.error.tooOld`. Errors show under the inputs (`role="alert"`) and no call is made.
- **Edge cases:** switching back to a non-custom period hides the inputs but keeps the typed dates in prefs.

---

**N-2.7 — KPI strips**
- **Location:** new `components/KpiStrip.tsx` (container), `components/KpiCell.tsx`, `components/DeltaLine.tsx`.
- **KpiStrip:** `<section aria-labelledby>` with a `label-sm` uppercase heading (`dash.money.title` / `dash.stock.title`) and one bordered container `.sk-dash-kpis` (`display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); background: var(--sk-surface); border: 1px solid var(--sk-border); border-radius: var(--sk-radius);`), cells separated by `border-inline-start: 1px solid var(--sk-border)` (none on the first cell). DESIGN §7.5.
- **KpiCell:** label (`label-sm`, uppercase, muted) · value (`font-size: clamp(1.9rem, 2.6vw, 2.4rem); font-weight: 800; line-height: 1; font-feature-settings: "tnum"`) · up to two subtitle lines (`body-sm`, each `min-height: 1.4em` so cells never jump). Money values render `sign + integer` large and `fraction + " DZD"` in `body-sm` muted (`splitAmount`). When the cell has a target (N-2.4) or opens the stock dialog, the whole cell is a `<button type="button">` with `aria-label` = `"{label}: {value text}. {subtitle texts}"`; otherwise a `<div>`. Refreshing: `data-refreshing="true"` → `opacity: .55; transition: opacity 200ms` (none under `prefers-reduced-motion: reduce`). Loading: a skeleton block 40px tall where the value goes and two 14px lines.
- **DeltaLine:** hidden when Compare is off or kind is `NONE`. `UP` → `--sk-ok`; `DOWN` → `--sk-danger`; `FLAT`/`NO_BASE` → `--sk-muted`. Text from `deltaText`. `title` = `t('dash.delta.previous', { value, range: prevRange })`.
- **Money strip (5 cells, data = `money`):**

| Cell | Value | Subtitle 1 | Subtitle 2 | Colour rule |
|---|---|---|---|---|
| `dash.kpi.sales` | `sales` | DeltaLine(`sales_change_*`, prev `prev_sales`) | when `discount_total > 0`: `dash.kpi.discounts` | — |
| `dash.kpi.profit` | `profit` | DeltaLine(`profit_change_*`) | `dash.kpi.margin` with `margin_pct` (or "—" when NULL) | value in `--sk-danger` when profit < 0 |
| `dash.kpi.saleCount` | `formatCount(sale_count)` | DeltaLine(`count_change_*`, prev `formatCount(prev_sale_count)`) | `dash.kpi.average` with `average_sale` (or "—") | — |
| `dash.kpi.receivables` | `receivables_total` | `dash.kpi.asOfNow` | — | — |
| `dash.kpi.payables` | `payables_total` | `dash.kpi.asOfNow` | — | plain text colour always (a negative value means a supplier owes you; it shows its "-" sign) |

- **Stock strip (4 cells, data = `stock`):**

| Cell | Value | Subtitle | Click | Colour rule |
|---|---|---|---|---|
| `dash.kpi.stockValue` | `stock_value` | `dash.kpi.atCost` | N-2.4 target | — |
| `dash.kpi.lowStock` | `formatCount(low_count)` | `dash.kpi.items` | stock dialog `low` | `--sk-warn` when > 0 |
| `dash.kpi.outOfStock` | `formatCount(out_count)` | `dash.kpi.items` | stock dialog `out` | `--sk-danger` when > 0 |
| `dash.kpi.deadStock` | `formatCount(dead_count)` | `dash.kpi.deadValue` + a `<select aria-label={t('dash.kpi.deadDaysSelect')}>` 30/60/90/180 days (`dash.kpi.days`) → `changeDeadDays` | stock dialog `dead` (click on the value area only, not on the select) | — |

---

**N-2.8 — Rail cards**
- **Location:** `components/QuickActionsCard.tsx`, `components/CashDrawerCard.tsx`, `components/AlertsCard.tsx`, `components/DebtorsList.tsx`, `components/RunningLowList.tsx`; all use a card style `.sk-card` [S].
- **QuickActionsCard:** title `dash.actions.title`; a grid `repeat(2, minmax(0, 1fr))` of `Button variant="secondary"` (min-height 44px), each = sidebar glyph (G4, `aria-hidden`) + visible label; click → `onNavigate(view)`. Only actions whose `resolveTarget` is non-null; if none, the card is not rendered.
- **CashDrawerCard (data = `money`):** title `dash.cash.title`; value `cash_in_drawer` (large, `splitAmount`) when `open_session_count > 0` plus `dash.cash.sessions` with the count; otherwise the text `dash.cash.noSession` (muted, no value). Link button `dash.cash.open` to `M-SESSION` when resolvable. (This card reads the money section; it is "right now" information even though money is period-dependent — `cash_in_drawer` never depends on the window.)
- **AlertsCard (data = `alerts`):** count > 0 → `dash.alerts.unread` with `badge-warn` count; 0 → `dash.alerts.none` (muted); link `dash.alerts.open` to `M-NOTIFICATIONS`. Not rendered when R10 did not exist (N-1 report).
- **DebtorsList (data = `debtors`):** title `dash.list.debtors`; ≤ 5 rows: customer name · amount (`formatDisplayAmount`, right-aligned, tnum) · second line `dash.list.oldestUnpaid` with days (or `dash.list.oldestUnpaidToday` when 0, "—" when NULL). Empty → `dash.list.empty.debtors`. "See all" per N-2.4.
- **RunningLowList (data = `runningLow`):** title `dash.list.runningLow`; ≤ 5 rows: item name · `PackQuantity` of `quantity` · second line `dash.list.minimum` with `PackQuantity` of `minimum_stock`. Empty → `dash.list.empty.low`. "See all" opens the stock dialog `low`.
- Packs: one `usePrimaryPacks(variantIds)` call per list with the visible variant ids (WS-O-5); if packs fail to load, quantities show in base units (the WS-O hook never throws).

---

**N-2.9 — Main lists**
- **Location:** `components/TopItemsList.tsx`, `components/TopCustomersList.tsx`, `components/LatestSalesList.tsx`, generic `components/ShortListCard.tsx` (title, optional "See all" link, loading skeleton of 5 rows × 48px, error with Retry, empty text, children rows).
- **TopItemsList (topItems):** title `dash.list.topItems`; column note `dash.list.salesBeforeDiscount`; rows: rank number · item name · `PackQuantity(quantity_sold)` · `sales_before_discount`. Empty → `dash.list.empty.period`.
- **TopCustomersList (topCustomers):** rows: name · `dash.list.saleCount` · `sales`. Empty → `dash.list.empty.customers`.
- **LatestSalesList (latest):** rows: `formatTimeOfSale` · customer name or `dash.list.walkIn` · `total` · badge `dash.list.cash` (`badge-neutral`) or `dash.list.credit` (`badge-info`) · when `is_voided` a `badge-danger` `dash.list.voided` and the total struck through (`text-decoration: line-through`). Empty → `dash.list.empty.latest`.
- Amounts right-aligned (left in RTL) with tnum; names truncate with ellipsis and a `title` attribute.

---

**N-2.10 — Stock dialog**
- **Location:** `components/StockDialog.tsx`.
- **Props:** `kind: 'low' | 'out' | 'dead'`, `deadDays`, `onClose`, `onNavigate`, `access`.
- **Behaviour:** modal (`sk-modal__backdrop` + `sk-modal`, `role="dialog" aria-modal="true" aria-labelledby`), width 720px (DESIGN wide dialog). Title: `dash.stockDialog.low` / `.out` / `.dead` (with days). On open: focus the title; Tab and Shift+Tab cycle inside the dialog; Escape and the Close button close it; focus returns to the KPI cell that opened it. Loads `listDashboardStockItems(kind, deadDays, 25, offset)`; table columns: Item (name + `display_identifier` in mono) · In stock (`PackQuantity`) · Minimum (`PackQuantity`; hidden for `out`) · Value at cost · Last sold (only for `dead`: `formatDisplayDate` or `dash.stockDialog.never`). Pagination row: Previous / `dash.stockDialog.page` / Next (disabled at ends). Loading: 5 skeleton rows. Error: message + Retry. Empty: `dash.stockDialog.empty`. Footer: "Open inventory" (N-2.4) and Close.

---

**N-2.11 — The screen**
- **Location:** rewrite `src/features/dashboard/DashboardScreen.tsx`; new `src/styles/dashboard.css` imported in `src/App.tsx` (G6); edit `src/app/AppRouter.tsx`.
- **Props:** `onNavigate: (view: AppView) => void; access: NavAccess`. AppRouter renders `<DashboardScreen onNavigate={setView} access={{ inventoryCapabilities, inventoryCorrectionsEnabled, procurementCapabilities /* + G2 inputs */ }} />`.
- **Structure:** `<section className="sk-page sk-dash">` with areas of section 8: `PeriodBar` · money `KpiStrip` · stock `KpiStrip` · `<div className="sk-dash__lists">` (TopItems, TopCustomers, LatestSales) · `<aside className="sk-dash__rail">` (QuickActions, CashDrawer, Alerts, Debtors, RunningLow) · `<section className="sk-dash__charts">` **left empty in N-2** (N-3 fills it; render nothing inside) · footer: SystemStrip (when `pending_generation_jobs + pending_print_jobs > 0`: `badge-warn` text `dash.system.pendingDocs` + link to `M-DOCUMENTS`; nothing otherwise; failure → nothing) and the marker `<div className="sk-muted sk-dash__version">[ version = WS-N-2.1 ]</div>`.
- **Section errors:** each section shows `dash.section.error` + the `useErrorText` message + a Retry button (`common.retry`) in place of its content; the rest of the page keeps working.
- **CSS (in `dashboard.css`, tokens only, logical properties only):** section 8 grid; `.sk-dash-kpis`, `.sk-dash-kpi`, `.sk-dash-kpi__value`, `.sk-dash-kpi__sub`, `.sk-dash-rail` (below 1440px: `display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: var(--sk-gap)`; at ≥1440px: one column), `.sk-dash-lists`, `.sk-dash-row` (min-height 48px, `border-block-end: 1px solid var(--sk-border)`), `.sk-dash-skeleton` (`background: var(--sk-surface-soft); border-radius: var(--sk-radius-sm)`), `[data-refreshing="true"]` rule, reduced-motion rule.
- **Must not change:** anything else in AppRouter (guards, other views, default view).

---

**N-2.12 — Tests**
Frontend tests in `tests/` (Vitest + Testing Library), mocking `invoke` like the existing workflow tests:
- **T-N2-1** (`tests/dashboard.workflow.test.tsx`) happy path: mock every dashboard command with the Appendix F responses → after login the heading "Dashboard" shows; Sales KPI shows "58,500" and ".00 DZD"; Profit "18,300"; margin "Margin 31.3%"; Number of sales "7" with "Average sale 8,357.14 DZD"; deltas show "Previous period: 0.00 DZD"; Customers owe you "12,800"; Low stock "1"; Out of stock "1"; Best-selling items lists A then B; Latest sales shows 5 rows with one "Voided".
- **T-N2-2** isolation: `dashboard_get_money_summary` rejects → the money strip shows the error + Retry; lists and stock still render; clicking Retry calls the command again.
- **T-N2-3** unknown commands (the S4 harness): only `get_dashboard_summary` is mocked → heading "Dashboard" still renders and no unhandled rejection is reported.
- **T-N2-4** stale response: change period twice quickly; the first (slower) response resolves last → the screen shows the second period's values.
- **T-N2-5** custom validation: Apply with `from > to` shows `dash.period.error.order` text and makes no call.
- **T-N2-6** compare switch hides every delta line without any new call.
- **T-N2-7** quick actions: with `inventoryCorrectionsEnabled = false` the "Stock adjustment" button is absent; clicking "New sale" calls `onNavigate` with the `M-POS` view.
- **T-N2-8** stock dialog: clicking Low stock opens the dialog, loads page 1, Escape closes it and focus returns to the Low stock cell.
- **T-N2-9** SESSION_INVALID from any dashboard call triggers `clearSession` once.
- **T-N2-10** formatting and prefs unit tests (N-2.1, N-2.3, N-2.4) and the navigation truth table (N-2.2).
- **Regression:** every existing test passes. Only the old-widget assertions of `tests/workflow.test.tsx` found in G7 may be replaced, by assertions on the new page (heading + "Sales" KPI label); list each replaced line in the report.

**N-2.13 — Strings, marker, verification, build, report.** Add every Appendix E key used in N-2 (English in all three locales). Every visible text uses the Appendix E key whose English text it shows: period buttons `dash.period.today`, `dash.period.week`, `dash.period.month`, `dash.period.year`, `dash.period.custom`; custom inputs `dash.period.from`, `dash.period.to`, `dash.period.apply`; list titles `dash.list.topItems`, `dash.list.topCustomers`, `dash.list.latestSales`, `dash.list.debtors`, `dash.list.runningLow`; "See all" `dash.list.seeAll`; alerts title `dash.alerts.title`; stock dialog titles, columns and buttons `dash.stockDialog.*`; footer link `dash.system.openDocuments`. No other text may be hard-coded.

### N-2 data flow
Owner clicks "This month" → `PeriodBar` → `changePeriod` → `setDashboardPrefs` → `getDashboardPeriod` (invoke → Rust → `core.dashboard_period`) → window stored → parallel `getDashboardMoneySummary`, `listDashboardTopItems`, `listDashboardTopCustomers` with that window → each section: `refreshing` → new data → KPI values cross-fade → range line updates (aria-live).

### N-2 acceptance criteria
1. Heading renders immediately; every section loads independently; one failing section never blanks another.
2. Period switch, custom range (with validation), compare switch, refresh, dead-stock days work as specified; no automatic refresh.
3. Quick actions and links follow the sidebar visibility rule; nothing bounces back to the dashboard.
4. Quantities show packs; amounts show exact decimals; derived figures come from SQL only.
5. DESIGN rules: KPI strips (one container, 1px rules), tokens only, logical properties, tnum, 44px targets, dialog focus rules, reduced motion.
6. All tests of N-2.12 pass; all existing tests pass except the listed old-widget assertions.

### N-2 manual checks for the owner
1. Marker reads `[ version = WS-N-2.1 ]`.
2. Log in: the dashboard opens with "Today"; money and stock strips fill in; nothing shows raw error text.
3. Click "This month": the range line shows "1 Sep 2026 – … compared with 1 Aug 2026 – … (up to HH:MM)" and the Sales figure matches the Reports page for the same month.
4. Choose Custom with the end date before the start date → a clear message, nothing reloads.
5. Untick "Compare": the arrows disappear.
6. Click "Low stock": a window lists the low items with boxes and pieces; Escape closes it.
7. Change "Not selling" to 30 days: the number updates.
8. Quick action "New sale" opens the till; go back to the dashboard: the period you chose is still selected.
9. Resize the window to 1280px wide and to full screen: no horizontal scrolling; the rail moves above the lists below 1440px.
10. Dark mode and Arabic: the page is readable and mirrored (text still English until N-4).

---

## 11. Sub-plan N-3 — Charts & analysis (bottom half)

**Goal:** the "Charts & analysis" section shows 7 charts for the selected period (the debt-age chart is "right now"), each with a table view, legend where needed, tooltips, loading/empty/error states, correct colours in light and dark, readable in Arabic.

**Branch:** `task/ws-n-3-dashboard-charts` from accepted N-2. **Marker:** `[ version = WS-N-3.1 ]`.

### N-3.0 Gate 0
| # | Find | Stop if |
|---|---|---|
| G1 | `package.json` dependencies: no chart library present | one is present (report name/version; do not add a second) |
| G2 | Installed React version: `npm ls react --depth=0` (exact, e.g. `19.1.0`) | React major is not 19 |
| G3 | `src/shared/charts/` does not exist | it exists (report its contents) |
| G4 | Live `--sk-surface` values (same rule as N-1 G18) | differs |
| G5 | `src/shared/utils/formatters.ts`: where the month-name arrays live and every caller of `formatDisplayDate` | — |
| G6 | N-1 chart functions reachable from the gateway: `getDashboardSalesSeries`, `getDashboardSalesByCategory`, `listDashboardTopItems` (limit 10), `getDashboardBusyHours`, `getDashboardReceivablesAging` | missing |

### N-3 steps

---

**N-3.1 — Install the chart library**
- **Command:** `npm install --save-exact recharts@3.10.1 react-is@<the exact React version from G2>`
- **Expected result:** `package.json` gains exactly these two dependencies with exact versions; `package-lock.json` updated; `npm install` prints no peer-dependency error. If it prints one, STOP and paste it.
- **Why exact:** recharts 3.x minor releases change internals; `react-is` must match React (recharts install note).

---

**N-3.2 — Month names for chart labels**
- **Location:** `src/shared/utils/formatters.ts` (+ `tests/formatters.dates.test.ts`).
- **Change:** move the three month-name arrays of `formatDisplayDate` to module-level `const MONTHS_SHORT: Record<Locale, string[]>` (same values), make `formatDisplayDate` use it (**same output**), and add:
  - `formatShortDate(date: string, locale: Locale): string` → day + short month (`"5 Sep"`, `"5 sept."`, `"5 سبتمبر"`).
  - `formatMonthYear(date: string, locale: Locale): string` → short month + year (`"Sep 2026"`, `"sept. 2026"`, `"سبتمبر 2026"`).
- **Verify:** `formatDisplayDate('2026-08-12', l)` still returns `"12 Aug 2026"`, `"12 août 2026"`, `"12 أغسطس 2026"`; the two new functions as above.

---

**N-3.3 — Chart colour tokens**
- **Location:** `src/styles/global.css`, inside the existing `:root` block and the existing `[data-theme="dark"]` block.
- **Change (exact values — validated with the data-viz palette validator against `#ffffff`, `#1c1815` and `#111b2d`; do not change them):**

| Token | Light | Dark | Use |
|---|---|---|---|
| `--sk-chart-sales` | `#2a78d6` | `#3987e5` | Sales series; single-series bars; Cash segment |
| `--sk-chart-profit` | `#eb6834` | `#d95926` | Profit series |
| `--sk-chart-purchases` | `#1baf7a` | `#199e70` | Purchases series |
| `--sk-chart-credit` | `#86b6ef` | `#184f95` | Credit segment (a lighter/recessive step of the sales blue: both are sales) |
| `--sk-chart-age-1` … `-4` | `#86b6ef`, `#3987e5`, `#1c5cab`, `#0d366b` | `#184f95`, `#2a78d6`, `#6da7ec`, `#b7d3f6` | Debt age 0–30, 31–60, 61–90, 90+ (older = stronger) |
| `--sk-chart-heat-1` … `-5` | `#86b6ef`, `#5598e7`, `#256abf`, `#184f95`, `#0d366b` | `#184f95`, `#256abf`, `#3987e5`, `#6da7ec`, `#b7d3f6` | Heatmap classes 1 (few) … 5 (many) |
| `--sk-chart-grid` | `var(--sk-border)` | `var(--sk-border)` | Gridlines (hairline, solid) |
| `--sk-chart-axis` | `var(--sk-border-strong)` | `var(--sk-border-strong)` | Axis line / crosshair |

- **Rules (from the validator report):** the light aqua, light credit and the lightest ramp steps are under 3:1 on white → every chart **must** keep its legend or labels **and** its table view (never remove them). Text never uses these colours; labels, values and legends use `--sk-text`, `--sk-text-soft`, `--sk-muted`.

---

**N-3.4 — Chart kit (shared, reusable by WS-P later)**
- **Location:** new folder `src/shared/charts/` with `index.ts` re-exporting everything below, and `src/styles/charts.css` imported in `src/App.tsx`.

| File | Exact contract |
|---|---|
| `chartFormat.ts` | `toPlotNumber(value: string): number` — the **only** conversion of a decimal string to a JS number in the app; comment `// Chart geometry only (WS-N D2/7.4). Never display the result.` · `compactTick(value: number, locale: Locale): string` — `new Intl.NumberFormat(tag, { notation: 'compact', maximumFractionDigits: 1, numberingSystem: 'latn' })` with tag `fr` → `fr-FR`, `en` → `en-GB`, `ar` → `ar-DZ` · `bucketLabel(bucketStart: string, bucket: SeriesBucket, locale): string` — `HOUR` → `"HH:00"` (from characters 11–12), `DAY` → `formatShortDate`, `MONTH` → `formatMonthYear` · `heatClass(count: number, max: number): 0\|1\|2\|3\|4\|5` — `count <= 0` → 0, else `min(5, ceil(count * 5 / max))`. |
| `ChartCard.tsx` | Props: `title`, `subtitle?`, `legend?: LegendItem[]`, `state: 'loading' \| 'ready' \| 'error' \| 'empty'`, `refreshing: boolean`, `errorText?`, `onRetry?`, `emptyText`, `table: ReactNode`, `children` (the chart), `wide?: boolean`. Renders `<figure className="sk-chart-card" aria-labelledby={titleId}>` with header (title `h3`, subtitle `body-sm` muted, a toggle `Button variant="secondary"` "Show as table"/"Show as chart" with `aria-pressed`), legend row, then: loading → skeleton block `block-size: 300px`; error → text + Retry; empty → `emptyText`; ready → chart or table. `data-refreshing` dims (0.55) the previous render while refreshing (no skeleton on refresh). The toggle is hidden when `state !== 'ready'`. |
| `ChartErrorBoundary.tsx` | Class component; on render error shows `fallbackText` (prop) inside the card area; never shows error details. Wrap every chart's `children`. |
| `ChartLegend.tsx` | `LegendItem = { label: string; token: string; mark: 'line' \| 'rect' }`. Row of items: mark (line = 16×2px, rect = 10×10px radius 2px) filled with `var(<token>)` + label in `--sk-text-soft`. Rendered only when there are ≥ 2 items. |
| `ChartTable.tsx` | Props `caption`, `columns: { key, label, numeric?: boolean }[]`, `rows: Record<string, string>[]`. `<table className="sk-table">` with a visually hidden `<caption>`, `<th scope="col">`, numeric cells right-aligned (left in RTL) with tnum. |
| `TimeSeriesChart.tsx` | Recharts line chart. Props: `rows: SeriesPoint[]` (`{ key, label, values: Record<string, string> }`), `series: { dataKey, label, token }[]`, `formatValue(v: string): string`, `locale`. Implementation: `<div dir="ltr">` → `<ResponsiveContainer width="100%" height={300}>` → `<LineChart data={plotRows} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>`; `<CartesianGrid vertical={false} stroke="var(--sk-chart-grid)" />`; `<XAxis dataKey="label" tick={{ fill: 'var(--sk-muted)', fontSize: 12 }} tickLine={false} axisLine={{ stroke: 'var(--sk-chart-axis)' }} interval="preserveStartEnd" minTickGap={16} />`; `<YAxis width={64} tickFormatter={(v) => compactTick(v, locale)} tick={{ fill: 'var(--sk-muted)', fontSize: 12 }} axisLine={false} tickLine={false} domain={[(min: number) => Math.min(0, min), 'auto']} />`; one `<Line>` per series with `type="linear"`, `dataKey` = the series key followed by `__n` (e.g. `sales__n`), `stroke` = `var(<series token>)`, `strokeWidth={2}`, `dot={false}`, `activeDot={{ r: 4, stroke: 'var(--sk-surface)', strokeWidth: 2 }}`, `isAnimationActive={false}`; `<Tooltip cursor={{ stroke: 'var(--sk-chart-axis)', strokeWidth: 1 }} isAnimationActive={false} content={(p) => <SeriesTooltip {...p} series={series} formatValue={formatValue} />} />`. `plotRows` = each row plus `<dataKey>__n = toPlotNumber(value)`. |
| `StackedColumnChart.tsx` | Same axes/grid/tooltip as above with `<BarChart>`; one `<Bar>` per series with `dataKey` = the series key followed by `__n`, `stackId="stack"`, `fill` = `var(<series token>)`, `stroke="var(--sk-surface)"`, `strokeWidth={1}`, `maxBarSize={24}`, `isAnimationActive={false}`, the **last** series with `radius={[4, 4, 0, 0]}`; tooltip `cursor={{ fill: 'var(--sk-surface-hover)' }}`. |
| `SeriesTooltip.tsx` | Reads the hovered row from `props.payload?.[0]?.payload`; renders nothing when `!props.active` or no row. Box: `surface` background, 1px border, radius 8px, padding 8px 10px. First line: the row `label` (`body-sm`, muted). Then one line per series: a 12×2px line key in the series colour, the **value first** (`formatValue(row.values[dataKey])`, bold, `--sk-text`), then the series label (`--sk-text-soft`). Text via React (never `innerHTML`). |
| `RankingBars.tsx` | HTML bars. Props: `rows: { key, label, sublabel?, value: string, valueText: string, token?: string }[]`, `defaultToken`. Each row: `display: grid; grid-template-columns: minmax(120px, 34%) 1fr auto; gap: 8px; min-height: 32px; align-items: center`: label (ellipsis + `title`) with optional sublabel below (`body-sm`, muted), a track containing the bar (`block-size: 16px; border-start-end-radius: 4px; border-end-end-radius: 4px; background: var(token)`; `inline-size` = `value / max × 100%`, minimum 2px when value > 0), then `valueText` (tnum). Bars grow from the inline start (right side in Arabic). No tooltip (values are printed). |
| `HeatmapGrid.tsx` | Props: `cells: { weekday: number; hour: number; count: number; valueText: string }[]` (168), `dayLabels: string[7]`, `cellLabel(cell): string`, `legend: { fewer: string; more: string; none: string }`. Grid `grid-template-columns: 48px repeat(24, minmax(18px, 1fr)); gap: 2px`; header row of hours `00`…`23` (show every 3rd label, others empty); one row per weekday **Sunday first**; each cell a `<div tabIndex={0} role="img" aria-label={cellLabel(cell)}>` `block-size: 22px; border-radius: 3px`, background `var(--sk-chart-heat-<class>)` or `var(--sk-surface-soft)` with a 1px `--sk-border` outline for class 0; a tooltip (`role="tooltip"`, same box style as SeriesTooltip) on hover **and** focus with `cellLabel(cell)`. Below: scale legend "No sales" swatch, then the 5 class swatches between `fewer` and `more`. |

- **Pitfalls:** `ResponsiveContainer` renders nothing in jsdom (0 size) — tests use the table view and the pure functions; `fill="var(--x)"` works in WebView2 (Chromium) — check it manually (N-3 manual check 3).

---

**N-3.5 — Chart data in the same hook**
- **Location:** extend `src/features/dashboard/useDashboardData.ts` (no new hook file; one period request for the whole page).
- **Change:** add five sections: `series` (`getDashboardSalesSeries(token, period.cur_from, period.cur_to, period.bucket)`), `categories` (`getDashboardSalesByCategory(token, period.cur_from, period.cur_to)`), `topItems10` (`listDashboardTopItems(token, period.cur_from, period.cur_to, 10)`), `busyHours` (`getDashboardBusyHours(token, period.cur_from, period.cur_to)`) — these four are period-dependent — and `aging` (`getDashboardReceivablesAging(token)`, right now). Same state shape, sequence guard, SESSION_INVALID rule and "refresh keeps the frame" rule as N-2.5. The four period-dependent ones load on mount, refresh and period change; `aging` on mount and refresh only.

---

**N-3.6 — The seven charts**
- **Location:** `src/features/dashboard/charts/ChartsSection.tsx` and one component per chart in the same folder. `ChartsSection` renders into the `.sk-dash__charts` area: `<h2>` `dash.charts.title`, subtitle `dash.charts.subtitle` with the current range, then a grid `.sk-chart-grid { display: grid; gap: var(--sk-gap); grid-template-columns: repeat(auto-fit, minmax(520px, 1fr)); }`, chart 1 has `grid-column: 1 / -1`. Order: 1, 2, 3, 4, 5, 6, 7. Every chart body is wrapped in `ChartErrorBoundary` with `fallbackText = t('dash.charts.failed')`.

| # | Component | Data | Form | Series / colours | Table view columns | Empty when |
|---|---|---|---|---|---|---|
| 1 | `SalesProfitChart` (wide) | `series` | `TimeSeriesChart` | Sales `--sk-chart-sales`, Profit `--sk-chart-profit`; legend (2 line items) | Period · Sales · Profit | every bucket has sales = 0 and profit = 0 |
| 2 | `CategoryChart` | `categories` | `RankingBars`, rows in `sort_order`; `OTHER` → `dash.charts.category.other`, `NONE` → `dash.charts.category.none`; `valueText` = amount + ` · ` + share `%` | single series `--sk-chart-sales`; no legend; subtitle `dash.charts.category.subtitle` | Category · Sales (before discount) · Share | no rows |
| 3 | `TopItemsChart` | `topItems10` | `RankingBars`; `sublabel` = `formatPackQuantity(quantity_sold, <main pack from usePrimaryPacks for the 10 variant ids>, base_unit_name)` (WS-O `src/shared/utils/packMath.ts`; map a `PrimaryPack` to `{ unitName: unit_name, factor: conversion_factor }`) | `--sk-chart-sales`; no legend | Item · Quantity · Sales (before discount) | no rows |
| 4 | `CashCreditChart` | `series` + `money` | `StackedColumnChart` | Cash `--sk-chart-sales` (bottom), Credit `--sk-chart-credit` (top); legend (2 rect items); subtitle = `dash.charts.cashCredit.totals` with `money.cash_sales` and `money.credit_sales` formatted by `formatDisplayAmount` (totals come from SQL, never added in React) | Period · Cash sales · Credit sales | every bucket has cash = 0 and credit = 0 |
| 5 | `SalesPurchasesChart` | `series` | `TimeSeriesChart` | Sales `--sk-chart-sales`, Purchases `--sk-chart-purchases`; legend; subtitle `dash.charts.salesPurchases.subtitle` | Period · Sales · Purchases | every bucket has sales = 0 and purchases = 0 |
| 6 | `BusyHoursChart` | `busyHours` | `HeatmapGrid`; `max` = largest `sale_count`; day labels `dash.weekdayShort.0…6`; `cellLabel` = `dash.charts.busy.cell` with `day` = `dash.weekday.<weekday>`, `hour` = two-digit hour, `hourEnd` = hour + 1 as two digits (`23` → `24`), `count` = `formatCount`, `amount` = `formatDisplayAmount(sales)` | heat ramp; scale legend | Day · Hour · Number of sales · Sales (only cells with count > 0, ordered by weekday then hour) | every count = 0 |
| 7 | `AgingChart` | `aging` | `RankingBars` with rows 0_30, 31_60, 61_90, 91_PLUS **in that fixed order** (not sorted), tokens `--sk-chart-age-1…4`, `valueText` = amount + ` · ` + `dash.charts.aging.items`; below the bars: `dash.charts.aging.unapplied` (only when UNAPPLIED ≠ 0) and `dash.charts.aging.total` in bold; subtitle `dash.charts.aging.subtitle` (right now) | ordinal ramp; no legend (every bar is labelled) | Age · Open sales · Amount, then rows "Unapplied", "Total" | TOTAL = 0 and every bucket = 0 → `dash.list.empty.debtors` |

- **Series rows (charts 1, 4, 5):** from each `series` row build `{ key: bucket_start, label: bucketLabel(bucket_start, period.bucket, locale), values: { sales, profit, cash: cash_sales, credit: credit_sales, purchases } }`. Values stay strings.
- **Tooltip `formatValue`:** `formatDisplayAmount`.
- **Accessibility:** every chart has its table view; Recharts' keyboard layer stays on (default in v3); heat cells are focusable with tooltips on focus; legends are text, never colour alone.

---

**N-3.7 — Tests**
- **T-N3-1** `chartFormat` unit tests: `heatClass` (max 7: counts 0,1,3,4,5,6,7 → 0,1,3,3,4,5,5), `bucketLabel` (HOUR `2026-09-24T09:00:00` → `09:00`; DAY en `2026-09-05T00:00:00` → `5 Sep`; MONTH en → `Sep 2026`), `compactTick(58500,'en')` → `58.5K`, `toPlotNumber('58500.00')` → 58500.
- **T-N3-2** `ChartCard`: loading shows the skeleton; ready + toggle shows the table; error shows Retry and calls `onRetry`; empty shows the text and hides the toggle.
- **T-N3-3** `RankingBars`: widths proportional (a row with half the max value has `inline-size: 50%`); values printed.
- **T-N3-4** `HeatmapGrid`: 168 cells; Sunday row first; focusing a cell shows its tooltip text.
- **T-N3-5** dashboard workflow (Appendix F data): switching each chart to "Show as table" shows the Appendix F values (chart 1 last row: Sales 58,500.00 DZD, Profit 18,300.00 DZD; chart 4 totals line: Cash 43,200.00 DZD · Credit 15,300.00 DZD; chart 7: 0–30 days 13,300.00 DZD, unapplied -500.00 DZD (ASCII hyphen, as `formatDisplayAmount` prints it), total 12,800.00 DZD).
- **T-N3-6** one chart's command fails → only that chart shows the error.
- **Regression:** all N-2 tests and existing tests pass.

**N-3.8 — Strings, marker, verification, build, report.** Chart titles `dash.charts.salesProfit.title`, `dash.charts.category.title`, `dash.charts.topItems.title`, `dash.charts.cashCredit.title`, `dash.charts.salesPurchases.title`, `dash.charts.busy.title` (+ `dash.charts.busy.subtitle`), `dash.charts.aging.title`; series names in legends, tooltips and table headers `dash.charts.series.sales`, `.profit`, `.purchases`, `.cash`, `.credit`; table toggle `dash.charts.showTable` / `dash.charts.showChart`; empty text `dash.charts.empty` (unless the chart row says otherwise); table columns `dash.charts.col.*`; aging bar labels `dash.charts.aging.b0_30`, `.b31_60`, `.b61_90`, `.b91`; heat legend `dash.charts.busy.none`, `.fewer`, `.more`; weekday names `dash.weekday.0`…`6` (table) and `dash.weekdayShort.0`…`6` (grid).

### N-3 acceptance criteria
1. Recharts 3.10.1 and matching `react-is` pinned exactly; no other new dependency.
2. Seven charts render with the specified forms, colours (tokens only), legends, tooltips, table views and states; the debt-age chart is labelled "as of today".
3. Chart totals agree with the KPI strip (the N-1 invariants guarantee it; manual check 4).
4. Charts read left-to-right in all languages; the rest of the card mirrors in Arabic.
5. Tests of N-3.7 pass; nothing else changed.

### N-3 manual checks for the owner
1. Marker reads `[ version = WS-N-3.1 ]`.
2. Scroll down: "Charts & analysis" shows seven charts for the chosen period.
3. Light and dark mode: lines and bars are coloured (not black), text stays readable.
4. "This month": the total of "Cash and credit sales" equals the Sales figure at the top.
5. Hover a point of "Sales and profit": a box shows the day, the sales and the profit.
6. Press "Show as table" on any chart: the same numbers appear in a table.
7. "Busiest days and hours": hovering or tabbing to a square shows the day, hour, number of sales and amount.
8. "Unpaid customer debts by age" does not change when you switch the period.
9. Arabic: the page mirrors, the time charts still run left to right.

---

## 12. Sub-plan N-4 — Translations (last)

**Branch:** `task/ws-n-4-dashboard-translations` from accepted N-3. **Agent:** Gemini allowed (text only). **Marker:** `[ version = WS-N-4.1 ]`.

1. Take every key of Appendix E. 2. Fill the French and Arabic dictionaries using the glossary below; keep `{placeholders}` exactly; keep the arrows `▲` `▼`. 3. Do not change English text, key names, components or logic. 4. Run `npm run typecheck && npm run lint && npm test -- --run && npm run build`.

| English | French | Arabic |
|---|---|---|
| Dashboard | Tableau de bord | لوحة القيادة |
| Sales | Ventes | المبيعات |
| Profit | Bénéfice | الربح |
| Margin | Marge | الهامش |
| Number of sales | Nombre de ventes | عدد المبيعات |
| Customers owe you | Les clients vous doivent | ديون الزبائن |
| You owe suppliers | Vous devez aux fournisseurs | ديون الموردين |
| Stock value (at cost) | Valeur du stock (au coût) | قيمة المخزون (بسعر التكلفة) |
| Low stock | Stock faible | مخزون منخفض |
| Out of stock | En rupture | نفد المخزون |
| Not selling | Sans vente | لا يباع |
| Cash in drawer | Espèces en caisse | النقد في الدرج |
| Quick actions | Actions rapides | إجراءات سريعة |
| Walk-in customer | Client de passage | زبون عابر |
| Voided | Annulée | ملغاة |
| Charts & analysis | Graphiques et analyses | الرسوم البيانية والتحليل |
| Busiest days and hours | Jours et heures les plus actifs | أكثر الأيام والساعات نشاطا |
| Unpaid customer debts by age | Créances clients par ancienneté | ديون الزبائن حسب الأقدمية |
| Previous period | Période précédente | الفترة السابقة |

**Manual check:** switch to French and to Arabic; every dashboard text is translated; Arabic reads right-to-left; numbers stay in Western digits.

---

## 13. Edge cases and failure scenarios

| # | Situation | Required behaviour | Where |
|---|---|---|---|
| E1 | Brand-new shop: no sales, no stock | All figures 0; deltas hidden (`NONE`); lists and charts show their empty texts; no error | N-1, N-2, N-3 |
| E2 | Only voided sales in the period | Sales 0, count 0; the voided sales appear only in "Latest sales" with the Voided badge | N-1 F-1/F-17 |
| E3 | Loss (profit < 0) | Profit shown with "-" in danger colour; margin negative; profit line goes below 0 (y-axis includes 0) | N-2.7, N-3.4 |
| E4 | Previous period is 0 | `NO_BASE`: "Previous period: 0.00 DZD", no arrow | C.1 |
| E5 | Previous profit negative | Percentage uses `abs(prev)`; direction follows the actual change | C.1 |
| E6 | Month end (31 Mar) / leap day (29 Feb) | Previous window clamped, no cut time | B.2 rows 7–9 |
| E7 | Midnight while the page is open | Figures stay for the old day until Refresh; Refresh re-resolves the period (new "today") | N-2.5 |
| E8 | PC clock / time zone different from Algeria | Every "today" comes from SQL (`Africa/Algiers`) or `currentBusinessDate()` | 2, B.1 |
| E9 | Custom range invalid (order, future, before 2000, missing) | Blocked in the UI with a message; SQL also refuses (`22023`) | N-2.6, A.3 |
| E10 | Custom range of several years | `MONTH` buckets; allowed | B.1 |
| E11 | User clicks periods quickly | Only the latest request's results are shown (sequence guard) | N-2.5 |
| E12 | Repeated Refresh clicks | Same guard; no duplicated rows | N-2.5 |
| E13 | One section's command fails | That section shows the error + Retry; the rest works | N-2, N-3 |
| E14 | Command unknown (old test harness, missing registration) | Section error; heading still shown; no unhandled rejection | S4, T-N2-3 |
| E15 | Session expired | `clearSession()` once → login screen | N-2.5 |
| E16 | Two sections read data while a sale is posted | Tiny differences possible between sections until the next Refresh (each read is its own snapshot) — accepted | — |
| E17 | Whole-sale discount | Sales = after discount; item/category rankings = before discount, labelled | D6 |
| E18 | Sale with box lines (WS-O) | `line_total` used as stored; quantities in base units shown as boxes + pieces | N-1.3, N-2.8 |
| E19 | Decimal base unit (kg) | Quantities with decimals; `PackQuantity` formats them | WS-O |
| E20 | Item renamed / deactivated after being sold | Rankings show the current effective name; stock counts exclude inactive items | N-1.3 |
| E21 | Customer with a credit balance (paid in advance) | Follows R5; if R5 excludes negative balances, aging and debtors exclude that customer too | C.5 |
| E22 | Payment not matched to a sale; voided partly-paid credit sale | Appears as "Payments not yet matched to a sale" (negative) so the total still equals receivables | C.5, F-23 |
| E23 | Several cash sessions open (several tills) | Cash in drawer = sum of expected cash; "Open sessions: 2" | N-1.4 |
| E24 | No open cash session | "No open cash session", no amount | N-2.8 |
| E25 | Supplier overpaid (negative payable) | Shown as a negative amount, plain colour | N-2.7 |
| E26 | Corrections disabled in Settings | "Stock adjustment" quick action hidden (same rule as the sidebar) | N-2.2/2.4 |
| E27 | A WS-I report view does not exist | The KPI is not clickable; nothing else changes | N-2.4 |
| E28 | Notifications feature missing (R10) | Alerts card not rendered; reported | N-1 G14 |
| E29 | Very large amounts (billions) | Exact strings; KPI value font wraps inside the cell, no overflow of the page | N-2.7 |
| E30 | Category deleted | Impossible while used (ws-d-skill); items without category go to "No category" | N-1.4 |
| E31 | More than 8 categories | Top 8 + "Other categories" + "No category" | N-1.4 |
| E32 | A chart component throws while rendering | `ChartErrorBoundary` shows the fallback text inside that card only | N-3.4 |
| E33 | Dark mode / Arabic | Tokens and logical properties; time charts stay left-to-right | N-2, N-3 |
| E34 | Licence in read-only mode (WS-K-7) | Dashboard works (read-only); quick actions still open the screens, which enforce the licence themselves | D10 |
| E35 | Paper-book (WS-P) data | Never included | D18 |

---

## 14. Testing strategy (summary)

| Kind | What | Where |
|---|---|---|
| Unit — SQL | Period, change, window, bucket, age, window validation (H1–H6) with fixed dates | `src-tauri/tests/dashboard/ws_n_1_dashboard_helpers.sql` |
| Integration — SQL | Real posting functions, everything dated today; exact figures F-1…F-24; invariants I-1…I-5; equality with WS-I (I-6); public wrappers T-P1…T-P6 | `src-tauri/tests/dashboard/ws_n_1_dashboard_integration.sql` |
| Unit — Rust | Date/time parsing and formatting, value parsers, command registration (T-R1…T-R5) | `dashboard_insights.rs` |
| Unit — TS | Gateway argument names, prefs, formatting, quick actions, navigation truth table, chart format helpers | `tests/dashboard.*.test.ts`, `tests/navigation-access.test.ts`, `tests/formatters.dates.test.ts` |
| Component | KPI cells, lists, stock dialog focus rules, ChartCard states, RankingBars, HeatmapGrid | `tests/*.test.tsx` |
| Workflow (end-to-end in jsdom) | Login → dashboard with mocked commands: happy path, isolation, unknown commands, stale responses, validation, compare, quick actions, session expiry, chart tables | `tests/dashboard.workflow.test.tsx`, `tests/dashboard.charts.workflow.test.tsx` |
| End-to-end on Windows | The owner's numbered manual checks of N-2 and N-3 (no automated E2E framework exists [S]) | reports |
| Validation | Every rule of A.3 in SQL, the custom-range mirror in the UI | H1, H6, T-P2…T-P5, T-N2-5 |
| Permission | Unknown session → `28000` (T-P1); no role checks by design (R-1) | N-1 |
| Regression | All existing SQL suites (incl. backup ACL), all existing frontend tests (only listed old-widget assertions replaced), `core.get_dashboard_summary` unchanged, sidebar truth table unchanged | all |
| Boundary | Month-end/leap clamps, 62 vs 63 days, cut time equal/after, age 30/31/60/61/90/91, dead days exactly N, 500+ pack ids (WS-O), limit clamp 1000 → 100 | B, C, F, T-P4 |
| Performance | Perf seed, EXPLAIN ANALYZE < 300 ms per public function | N-1.11 |

---

## 15. Junior-developer test and missing-details audit

| Question | Answer |
|---|---|
| A live name differs from this document. | Use the live one found in Gate 0; list the substitution in the report. |
| WS-I computes something differently from my fixture table. | WS-I wins (I-6). Make the dashboard equal to WS-I, never edit WS-I, report both numbers. |
| Can I compute a total or a percentage in React? | No. Only formatting. The one JS-number exception is chart geometry (`toPlotNumber`). |
| Where do I put new SQL? | Schema `core`, one migration (plus an optional index migration). Never a new schema. |
| May I remove the old dashboard summary function or command? | No (S2). The new screen still calls it for pending documents. |
| The period changes while requests are running. | The sequence guard drops the old responses. |
| What does "right now" mean for a section? | It ignores the period and is labelled so. |
| A quick action's screen does not exist. | Do not render that button. |
| An old test fails because the product-count widget is gone. | Replace only that assertion (G7 list) and report it. Any other failing test: STOP. |
| Should I add a chart library other than Recharts, or a newer version? | No. Exactly `recharts@3.10.1`. |
| Do I show the percentage sign and arrow colours without text? | Never colour alone: the arrow and the words are always there. |
| Where is today's date on the frontend? | `currentBusinessDate()` [S]. |
| Numbers in Arabic? | Western digits (`numberingSystem: 'latn'` for ticks; amounts are formatted strings). |
| Should the dashboard auto-refresh? | No (D12). |
| Should I store the period on disk? | No (D11). |
| Stock of inactive items? | Excluded from low/out/dead counts; included in stock value only if R8's valuation includes it. |
| Which warehouse? | All together (D8). |

---

## 16. Report (Markdown file committed to the branch: `docs/ws-n/WS-N-<n>-report.md`)

```
## Gate 0 findings (each item: verified / read but not executed / assumed; name substitutions)
## Rules R1–R12 (N-1 only): rule · evidence · SQL expression used
## Navigation map M1 (N-2 only)
## What changed (files, grouped SQL / Rust / React / CSS / tests)
## Contract triangle (every new function: SQL signature · Rust struct + call site · TS type)
## Test results (tables of this sub-plan with actual output; invariants; WS-I equality)
## Performance (N-1 only: EXPLAIN ANALYZE timings; indexes added and why)
## Regression proof (existing suites; replaced old-widget assertions with reasons)
## Verification output (literal, with working directory)
## New i18n keys (list)
## Build version marker (exact string)
## Installer (.exe path, or NOT RUN — reason)
## Pending manual checks for the owner (the sub-plan's list; step 1 = marker)
## Unrelated problems found (named, not fixed)
## Not finished / could not verify
Branch: <branch>
Commit: <full hash>
Pushed: yes/no
```

---

## Appendix A — Contracts

### A.1 Public functions, Rust services, Tauri commands, gateway functions

All SQL functions are `core.<name>`, first parameter `p_session_token text`. Rust services live in `application::dashboard_insights`; commands in `commands::dashboard_insights`; gateway functions in `src/shared/ipc/dashboardGateway.ts`.

| # | SQL function (after the token) | Output columns (SQL type) | Validation (SQL) | Rust service | Tauri command (args after `session_token`) | Gateway function |
|---|---|---|---|---|---|---|
| P1 | `dashboard_period(p_period text, p_from date, p_to date)` | `cur_from date, cur_to date, prev_from date, prev_to date, cut_time time, bucket text, today date` | B.1 (period value; custom window) | `get_period` | `dashboard_get_period(period: String, from: Option<String>, to: Option<String>)` | `getDashboardPeriod(sessionToken, period, from, to)` |
| P2 | `dashboard_money_summary(p_cur_from date, p_cur_to date, p_prev_from date, p_prev_to date, p_cut_time time)` | `sales numeric, prev_sales numeric, sales_change_kind text, sales_change_pct numeric, profit numeric, prev_profit numeric, profit_change_kind text, profit_change_pct numeric, margin_pct numeric, sale_count bigint, prev_sale_count bigint, count_change_kind text, count_change_pct numeric, average_sale numeric, discount_total numeric, cash_sales numeric, credit_sales numeric, cash_in_drawer numeric, open_session_count bigint, receivables_total numeric, payables_total numeric` | both windows: `_dashboard_validate_window` | `get_money_summary` | `dashboard_get_money_summary(cur_from: String, cur_to: String, prev_from: String, prev_to: String, cut_time: Option<String>)` | `getDashboardMoneySummary(sessionToken, window: DashboardWindow)` |
| P3 | `dashboard_stock_summary(p_dead_days integer)` | `stock_value numeric, low_count bigint, out_count bigint, dead_count bigint, dead_value numeric` | `p_dead_days IN (30, 60, 90, 180)` | `get_stock_summary` | `dashboard_get_stock_summary(dead_days: i32)` | `getDashboardStockSummary(sessionToken, deadDays)` |
| P4 | `dashboard_stock_items(p_kind text, p_dead_days integer, p_limit integer, p_offset integer)` | `variant_id bigint, product_id bigint, item_name text, display_identifier text, identifier_type text, base_unit_name text, quantity numeric, minimum_stock numeric, stock_value numeric, last_sold_on date, total_count bigint` | kind in `low/out/dead`; dead days as P3; `p_offset >= 0`; limit clamped 1–100 (default 25) | `list_stock_items` | `dashboard_list_stock_items(kind: String, dead_days: i32, limit: i32, offset: i32)` | `listDashboardStockItems(sessionToken, kind, deadDays, limit, offset)` |
| P5 | `dashboard_top_items(p_from date, p_to date, p_limit integer)` | `variant_id bigint, item_name text, base_unit_name text, quantity_sold numeric, sales_before_discount numeric` | window; limit clamped 1–10 (default 5) | `list_top_items` | `dashboard_list_top_items(from: String, to: String, limit: i32)` | `listDashboardTopItems(sessionToken, from, to, limit)` |
| P6 | `dashboard_top_customers(p_from date, p_to date)` | `customer_id bigint, customer_name text, sale_count bigint, sales numeric` | window | `list_top_customers` | `dashboard_list_top_customers(from: String, to: String)` | `listDashboardTopCustomers(sessionToken, from, to)` |
| P7 | `dashboard_top_debtors()` | `customer_id bigint, customer_name text, amount_owed numeric, oldest_open_on date, oldest_open_days integer` | — | `list_top_debtors` | `dashboard_list_top_debtors()` | `listDashboardTopDebtors(sessionToken)` |
| P8 | `dashboard_latest_sales()` | `document_id bigint, document_number text, posted_local timestamp, sale_kind text, customer_name text, total numeric, is_voided boolean` | — | `list_latest_sales` | `dashboard_list_latest_sales()` | `listDashboardLatestSales(sessionToken)` |
| P9 | `dashboard_sales_series(p_from date, p_to date, p_bucket text)` | `bucket_start timestamp, sales numeric, profit numeric, cash_sales numeric, credit_sales numeric, purchases numeric, sale_count bigint` | window; bucket in `HOUR/DAY/MONTH`; `HOUR` needs `p_from = p_to`; `DAY` needs `p_to - p_from + 1 <= 366` | `get_sales_series` | `dashboard_get_sales_series(from: String, to: String, bucket: String)` | `getDashboardSalesSeries(sessionToken, from, to, bucket)` |
| P10 | `dashboard_sales_by_category(p_from date, p_to date)` | `sort_order integer, category_key text, category_name text, sales_before_discount numeric, share_pct numeric` | window | `get_sales_by_category` | `dashboard_get_sales_by_category(from: String, to: String)` | `getDashboardSalesByCategory(sessionToken, from, to)` |
| P11 | `dashboard_busy_hours(p_from date, p_to date)` | `weekday integer, hour integer, sale_count bigint, sales numeric` | window | `get_busy_hours` | `dashboard_get_busy_hours(from: String, to: String)` | `getDashboardBusyHours(sessionToken, from, to)` |
| P12 | `dashboard_receivables_aging()` | `sort_order integer, bucket text, amount numeric, item_count bigint` | — | `get_receivables_aging` | `dashboard_get_receivables_aging()` | `getDashboardReceivablesAging(sessionToken)` |

Command constants in `commands.ts`: the upper-case form of the command name (`DASHBOARD_GET_PERIOD: 'dashboard_get_period'`, …). JavaScript argument keys are the camelCase form of the Rust names (`curFrom`, `deadDays`, `from`, `to`, `limit`, `offset`, `kind`, `bucket`, `period`, `cutTime`).

### A.2 TypeScript types (`src/shared/ipc/dashboardDto.ts`)

```ts
export type DashboardPeriodKind = 'today' | 'week' | 'month' | 'year' | 'custom';
export type SeriesBucket = 'HOUR' | 'DAY' | 'MONTH';
export type ChangeKind = 'UP' | 'DOWN' | 'FLAT' | 'NO_BASE' | 'NONE';
export type StockItemKind = 'low' | 'out' | 'dead';

export interface DashboardPeriod { cur_from: string; cur_to: string; prev_from: string; prev_to: string;
  cut_time: string | null; bucket: SeriesBucket; today: string; }
export interface DashboardWindow { curFrom: string; curTo: string; prevFrom: string; prevTo: string; cutTime: string | null; }
export function windowOf(p: DashboardPeriod): DashboardWindow {
  return { curFrom: p.cur_from, curTo: p.cur_to, prevFrom: p.prev_from, prevTo: p.prev_to, cutTime: p.cut_time };
}
export interface DashboardMoneySummary { sales: string; prev_sales: string; sales_change_kind: ChangeKind; sales_change_pct: string | null;
  profit: string; prev_profit: string; profit_change_kind: ChangeKind; profit_change_pct: string | null; margin_pct: string | null;
  sale_count: number; prev_sale_count: number; count_change_kind: ChangeKind; count_change_pct: string | null;
  average_sale: string | null; discount_total: string; cash_sales: string; credit_sales: string;
  cash_in_drawer: string | null; open_session_count: number; receivables_total: string; payables_total: string; }
export interface DashboardStockSummary { stock_value: string; low_count: number; out_count: number; dead_count: number; dead_value: string; }
export interface DashboardStockItem { variant_id: number; product_id: number; item_name: string; display_identifier: string;
  identifier_type: string; base_unit_name: string; quantity: string; minimum_stock: string; stock_value: string;
  last_sold_on: string | null; total_count: number; }
export interface DashboardTopItem { variant_id: number; item_name: string; base_unit_name: string; quantity_sold: string; sales_before_discount: string; }
export interface DashboardTopCustomer { customer_id: number; customer_name: string; sale_count: number; sales: string; }
export interface DashboardDebtor { customer_id: number; customer_name: string; amount_owed: string; oldest_open_on: string | null; oldest_open_days: number | null; }
export interface DashboardLatestSale { document_id: number; document_number: string; posted_local: string; sale_kind: 'CASH' | 'CREDIT';
  customer_name: string | null; total: string; is_voided: boolean; }
export interface DashboardSeriesRow { bucket_start: string; sales: string; profit: string; cash_sales: string; credit_sales: string; purchases: string; sale_count: number; }
export interface DashboardCategoryRow { sort_order: number; category_key: string; category_name: string | null; sales_before_discount: string; share_pct: string | null; }
export interface DashboardBusyCell { weekday: number; hour: number; sale_count: number; sales: string; }
export interface DashboardAgingRow { sort_order: number; bucket: '0_30' | '31_60' | '61_90' | '91_PLUS' | 'UNAPPLIED' | 'TOTAL'; amount: string; item_count: number; }
```
Formats: dates `YYYY-MM-DD`; `cut_time` `HH:MM:SS`; `bucket_start` / `posted_local` `YYYY-MM-DDTHH:MM:SS` (Algiers local time); money and quantities as exact decimal strings.

### A.3 Validation codes (all reach the UI as the generic validation message; the UI prevents them)

| Code | Layer | Raised when |
|---|---|---|
| `DASHBOARD_PERIOD_INVALID` | SQL | period not in `today/week/month/year/custom` |
| `DASHBOARD_RANGE_INVALID` | SQL | window with NULL date, `from > to`, `from < 2000-01-01` or `to` after today |
| `DASHBOARD_BUCKET_INVALID` | SQL | bucket not `HOUR/DAY/MONTH`; `HOUR` over more than one day; `DAY` over more than 366 days |
| `DASHBOARD_DEAD_DAYS_INVALID` | SQL | dead days not 30/60/90/180 |
| `DASHBOARD_KIND_INVALID` | SQL | stock item kind not `low/out/dead` |
| `DASHBOARD_PAGING_INVALID` | SQL | offset < 0 |
| `DASHBOARD_DATE_INVALID` / `DASHBOARD_TIME_INVALID` / `DASHBOARD_VALUE_INVALID` | Rust | an argument string cannot be parsed |

---

## Appendix B — Periods

### B.1 Algorithm of `core._dashboard_period_bounds_at(p_period, p_from, p_to, p_now)`
```
local   := p_now AT TIME ZONE 'Africa/Algiers'          -- timestamp without time zone
today   := local::date ;  clock := local::time(0)       -- seconds precision
clamped := false
CASE p_period
  'today':  cur := [today, today];              prev := [today - 1, today - 1]
  'week':   start := today - extract(dow FROM today)::int     -- Sunday = 0
            cur := [start, today];              prev := [start - 7, today - 7]
  'month':  cur_from := date_trunc('month', today)::date; cur := [cur_from, today]
            prev_from := (cur_from - interval '1 month')::date; prev_last := cur_from - 1
            IF extract(day FROM today) > extract(day FROM prev_last) THEN prev_to := prev_last; clamped := true
            ELSE prev_to := prev_from + (extract(day FROM today)::int - 1) END IF
  'year':   cur := [make_date(y, 1, 1), today]  (y = year of today); prev_from := make_date(y - 1, 1, 1)
            IF month(today) = 2 AND day(today) = 29 THEN prev_to := make_date(y - 1, 2, 28); clamped := true
            ELSE prev_to := make_date(y - 1, month(today), day(today)) END IF
  'custom': PERFORM core._dashboard_validate_window(p_from, p_to, today)
            n := p_to - p_from + 1;  cur := [p_from, p_to];  prev := [p_from - n, p_from - 1]
  ELSE:     RAISE 'DASHBOARD_PERIOD_INVALID: <p_period>' (22023)
cut_time := CASE WHEN cur_to = today AND NOT clamped THEN clock ELSE NULL END
days     := cur_to - cur_from + 1
bucket   := CASE WHEN days = 1 THEN 'HOUR' WHEN days <= 62 THEN 'DAY' ELSE 'MONTH' END
RETURN (cur_from, cur_to, prev_from, prev_to, cut_time, bucket, today)
```
`p_from`/`p_to` are ignored for non-custom periods.

### B.2 Test table (pass `p_now` as `timestamptz '<date> <time>+01'` unless stated)

| # | Period | p_now | p_from – p_to | cur | prev | cut_time | bucket |
|---|---|---|---|---|---|---|---|
| 1 | today | 2026-09-24 12:00 | — | 09-24 – 09-24 | 09-23 – 09-23 | 12:00:00 | HOUR |
| 2 | week | 2026-09-24 12:00 (Thu) | — | 09-20 – 09-24 | 09-13 – 09-17 | 12:00:00 | DAY |
| 3 | month | 2026-09-24 12:00 | — | 09-01 – 09-24 | 08-01 – 08-24 | 12:00:00 | DAY |
| 4 | year | 2026-09-24 12:00 | — | 2026-01-01 – 09-24 | 2025-01-01 – 2025-09-24 | 12:00:00 | MONTH |
| 5 | custom | 2026-09-24 12:00 | 2026-09-01 – 09-15 | 09-01 – 09-15 | 08-17 – 08-31 | NULL | DAY |
| 6 | custom | 2026-09-24 12:00 | 2026-06-01 – 09-24 | 06-01 – 09-24 | 2026-02-05 – 05-31 | 12:00:00 | MONTH |
| 7 | month | 2026-03-31 10:00 | — | 03-01 – 03-31 | 02-01 – 02-28 | NULL (clamped) | DAY |
| 8 | month | 2028-03-30 10:00 | — | 03-01 – 03-30 | 02-01 – 02-29 | NULL (clamped) | DAY |
| 9 | year | 2028-02-29 09:00 | — | 2028-01-01 – 02-29 | 2027-01-01 – 2027-02-28 | NULL (clamped) | DAY |
| 10 | week | 2026-09-27 08:00 (Sun) | — | 09-27 – 09-27 | 09-20 – 09-20 | 08:00:00 | HOUR |
| 11 | month | 2026-10-01 09:00 | — | 10-01 – 10-01 | 09-01 – 09-01 | 09:00:00 | HOUR |
| 12 | custom | 2026-09-24 12:00 | 2026-09-10 – 09-10 | 09-10 – 09-10 | 09-09 – 09-09 | NULL | HOUR |
| 13 | custom | 2026-09-24 12:00 | 2026-07-25 – 09-24 (62 days) | same | 2026-05-24 – 07-24 | 12:00:00 | DAY |
| 14 | custom | 2026-09-24 12:00 | 2026-07-24 – 09-24 (63 days) | same | 2026-05-22 – 07-23 | 12:00:00 | MONTH |
| 15 | week | 2026-10-03 18:30 (Sat) | — | 09-27 – 10-03 | 09-20 – 09-26 | 18:30:00 | DAY |
| 16 | today | `timestamptz '2026-09-23 23:30:00+00'` (UTC) | — | 09-24 – 09-24 | 09-23 – 09-23 | 00:30:00 | HOUR |
| 17 | month | 2026-03-28 10:00 | — | 03-01 – 03-28 | 02-01 – 02-28 | 10:00:00 (not clamped) | DAY |
| 18 | month | 2026-01-15 10:00 | — | 01-01 – 01-15 | 2025-12-01 – 2025-12-15 | 10:00:00 | DAY |

Every row's `today` = the local date of `p_now`. Error rows (H1): `'decade'`; custom with NULL; custom 2026-09-30 – 2026-09-01; custom to 2026-09-25 with now 2026-09-24; custom from 1999-12-31 → all `22023`.

---

## Appendix C — Helper examples (test tables)

**C.1 `_dashboard_change(cur, prev)`**

| cur | prev | kind | pct |
|---|---|---|---|
| 58500 | 0 | NO_BASE | NULL |
| 0 | 0 | NONE | NULL |
| 8500 | 36000 | DOWN | -76.4 |
| 100 | 100 | FLAT | 0.0 |
| 500 | -1000 | UP | 150.0 |
| -200 | 100 | DOWN | -300.0 |
| 100.04 | 100 | FLAT | 0.0 |
| 51500 | 2000 | UP | 2475.0 |
| 0 | 2000 | DOWN | -100.0 |
| 10 | 3 | UP | 233.3 |
| 2 | 3 | DOWN | -33.3 |
| -50 | -100 | UP | 50.0 |
| -150 | -100 | DOWN | -50.0 |
| NULL | 5 | DOWN | -100.0 |

**C.2 `_dashboard_in_window(date, local_time, 2026-08-01, 2026-08-24, cut)`**

| date | local_time | cut | result |
|---|---|---|---|
| 2026-08-24 | 11:59:00 | 12:00:00 | true |
| 2026-08-24 | 12:00:00 | 12:00:00 | true |
| 2026-08-24 | 12:00:01 | 12:00:00 | false |
| 2026-08-23 | 23:00:00 | 12:00:00 | true |
| 2026-08-25 | 09:00:00 | 12:00:00 | false |
| 2026-07-31 | 10:00:00 | 12:00:00 | false |
| 2026-08-24 | 18:00:00 | NULL | true |

**C.3 `_dashboard_bucket_start(date, local_ts, bucket)`**

| date | local_ts | bucket | result |
|---|---|---|---|
| 2026-09-24 | 2026-09-24 09:45:10 | HOUR | 2026-09-24 09:00:00 |
| 2026-09-24 | 2026-09-23 23:10:00 | HOUR | 2026-09-24 23:00:00 |
| 2026-09-05 | 2026-09-05 17:20:00 | DAY | 2026-09-05 00:00:00 |
| 2026-09-05 | 2026-09-05 17:20:00 | MONTH | 2026-09-01 00:00:00 |
| 2026-09-05 | 2026-09-05 17:20:00 | WEEK | error 22023 |

**C.4 `_dashboard_age_bucket(days)`**: −3 → `0_30`; 0 → `0_30`; 30 → `0_30`; 31 → `31_60`; 60 → `31_60`; 61 → `61_90`; 90 → `61_90`; 91 → `91_PLUS`; 400 → `91_PLUS`.

**C.5 Open items (`_dashboard_open_items_at`)**
```sql
WITH cust AS (SELECT customer_id FROM core._dashboard_customer_balances()),
items AS (
  SELECT e.id, e.customer_id, e.amount_delta,
         coalesce(<R1 date of the entry's document, joined through core.business_documents bd ON bd.id = e.document_id>,
                  (e.created_at AT TIME ZONE 'Africa/Algiers')::date) AS item_date
  FROM receivables.customer_ledger_entries e
  LEFT JOIN core.business_documents bd ON bd.id = e.document_id
  WHERE e.amount_delta > 0 AND e.customer_id IN (SELECT customer_id FROM cust)),
alloc AS (SELECT invoice_ledger_entry_id AS id, sum(amount) AS a FROM receivables.payment_allocations GROUP BY 1),
linked AS (SELECT x.related_entry_id AS id, sum(-x.amount_delta) AS a
           FROM receivables.customer_ledger_entries x
           WHERE x.related_entry_id IS NOT NULL AND x.amount_delta < 0
             AND NOT EXISTS (SELECT 1 FROM receivables.payment_allocations pa WHERE pa.payment_document_id = x.document_id)
           GROUP BY 1),
o AS (SELECT i.customer_id, i.id AS ledger_entry_id, i.item_date,
             greatest(i.amount_delta - coalesce(alloc.a, 0) - coalesce(linked.a, 0), 0) AS open_amount
      FROM items i LEFT JOIN alloc ON alloc.id = i.id LEFT JOIN linked ON linked.id = i.id)
SELECT customer_id, ledger_entry_id, item_date, open_amount, (p_as_of - item_date) AS age_days
FROM o WHERE open_amount > 0;
```
Adapt the table/column names to the live structure found in G10/R9 — **the counting rule does not change**: each settlement is counted once (allocations, or linked negative entries that are not allocated payments); an over-settled item counts as 0 and the excess ends up in "Unapplied".

---

## Appendix D — Chart design rules (apply to every chart)

1. **Form follows the job:** trend over time → line; composition over time → stacked columns; ranking → horizontal bars; ordered age groups → bars in an ordered colour ramp; day × hour intensity → heatmap. No pie, no donut, no dual y-axis, no 3D.
2. **Colour:** tokens of N-3.3 only, in fixed roles (Sales always blue). Never the accent, never status colours, never a colour on text. Every chart keeps a legend or direct labels **and** a table view (some colours are under 3:1 on white).
3. **Marks:** lines 2px, no dots except the 8px hover dot with a 2px surface ring; bars at most 24px thick, 4px rounded end, square at the baseline; 1px surface gap between stacked segments; gridlines hairline, solid, horizontal only.
4. **Axes:** y-axis always includes 0; compact ticks (`58.5K`) in Western digits; x-axis labels thinned automatically; muted tick text.
5. **Labels:** a legend only for 2+ series; values printed at bar tips; never a number on every point of a line.
6. **Interaction:** crosshair + one tooltip listing every series at that point (value first, then the series name); heat cells show a tooltip on hover **and** keyboard focus; tooltips never hold information that the table view lacks.
7. **States:** first load → skeleton of final size; refresh → previous render dimmed; error → message + Retry in the card; empty → one sentence.
8. **Direction:** plots `dir="ltr"`; card text follows the page direction.
9. **Motion:** no animations (`isAnimationActive={false}`); 200ms opacity only, none with reduced motion.

---

## Appendix E — Translation keys (English text; copy into fr and ar until N-4)

| Key | English |
|---|---|
| `dash.period.label` | Period |
| `dash.period.today` | Today |
| `dash.period.week` | This week |
| `dash.period.month` | This month |
| `dash.period.year` | This year |
| `dash.period.custom` | Custom |
| `dash.period.from` | From |
| `dash.period.to` | To |
| `dash.period.apply` | Apply |
| `dash.period.range` | {from} – {to} |
| `dash.period.rangeCompared` | {range}, compared with {prevRange} |
| `dash.period.cutNote` | (up to {time}) |
| `dash.period.error.missing` | Choose both dates. |
| `dash.period.error.order` | The start date must be on or before the end date. |
| `dash.period.error.future` | The end date cannot be after today. |
| `dash.period.error.tooOld` | The start date cannot be before 1 January 2000. |
| `dash.compare` | Compare with previous period |
| `dash.updatedAt` | Updated at {time} |
| `dash.section.error` | This part could not be loaded. |
| `dash.actions.title` | Quick actions |
| `dash.actions.newSale` | New sale |
| `dash.actions.newPurchase` | New purchase |
| `dash.actions.customerPayment` | Customer payment |
| `dash.actions.supplierPayment` | Supplier payment |
| `dash.actions.addProduct` | Add product |
| `dash.actions.stockAdjustment` | Stock adjustment |
| `dash.money.title` | Money — selected period |
| `dash.stock.title` | Stock — right now |
| `dash.kpi.sales` | Sales |
| `dash.kpi.profit` | Profit |
| `dash.kpi.saleCount` | Number of sales |
| `dash.kpi.receivables` | Customers owe you |
| `dash.kpi.payables` | You owe suppliers |
| `dash.kpi.margin` | Margin {pct}% |
| `dash.kpi.average` | Average sale {amount} |
| `dash.kpi.discounts` | Discounts given {amount} |
| `dash.kpi.asOfNow` | Right now |
| `dash.kpi.stockValue` | Stock value |
| `dash.kpi.atCost` | At cost |
| `dash.kpi.lowStock` | Low stock |
| `dash.kpi.outOfStock` | Out of stock |
| `dash.kpi.deadStock` | Not selling |
| `dash.kpi.items` | items |
| `dash.kpi.deadValue` | {amount} at cost |
| `dash.kpi.deadDaysSelect` | Days without a sale |
| `dash.kpi.days` | {days} days |
| `dash.delta.up` | ▲ {pct}% vs previous period |
| `dash.delta.down` | ▼ {pct}% vs previous period |
| `dash.delta.flat` | No change vs previous period |
| `dash.delta.noBase` | Previous period: {value} |
| `dash.delta.previous` | Previous period: {value} ({range}) |
| `dash.cash.title` | Cash in drawer |
| `dash.cash.sessions` | Open sessions: {count} |
| `dash.cash.noSession` | No open cash session |
| `dash.cash.open` | Open cash session |
| `dash.alerts.title` | Alerts |
| `dash.alerts.unread` | Unread alerts: {count} |
| `dash.alerts.none` | No new alerts |
| `dash.alerts.open` | Open alerts |
| `dash.list.topItems` | Best-selling items |
| `dash.list.topCustomers` | Best customers |
| `dash.list.debtors` | Biggest debtors |
| `dash.list.latestSales` | Latest sales |
| `dash.list.runningLow` | Running low |
| `dash.list.seeAll` | See all |
| `dash.list.salesBeforeDiscount` | Sales (before discount) |
| `dash.list.saleCount` | Sales: {count} |
| `dash.list.oldestUnpaid` | Oldest unpaid: {days} days |
| `dash.list.oldestUnpaidToday` | Oldest unpaid: today |
| `dash.list.walkIn` | Walk-in customer |
| `dash.list.cash` | Cash |
| `dash.list.credit` | Credit |
| `dash.list.voided` | Voided |
| `dash.list.minimum` | Minimum {qty} |
| `dash.list.empty.period` | No sales in this period. |
| `dash.list.empty.customers` | No named customer bought in this period. |
| `dash.list.empty.debtors` | No customer owes you money. |
| `dash.list.empty.latest` | No sales yet. |
| `dash.list.empty.low` | Nothing is running low. |
| `dash.stockDialog.low` | Low stock items |
| `dash.stockDialog.out` | Out of stock items |
| `dash.stockDialog.dead` | Items not selling for {days} days |
| `dash.stockDialog.item` | Item |
| `dash.stockDialog.quantity` | In stock |
| `dash.stockDialog.minimum` | Minimum |
| `dash.stockDialog.value` | Value at cost |
| `dash.stockDialog.lastSold` | Last sold |
| `dash.stockDialog.never` | Never |
| `dash.stockDialog.page` | Page {page} of {pages} |
| `dash.stockDialog.previous` | Previous |
| `dash.stockDialog.next` | Next |
| `dash.stockDialog.close` | Close |
| `dash.stockDialog.openInventory` | Open inventory |
| `dash.stockDialog.empty` | No items to show. |
| `dash.system.pendingDocs` | {count} documents are waiting to be generated or printed. |
| `dash.system.openDocuments` | Open documents |
| `dash.charts.title` | Charts & analysis |
| `dash.charts.subtitle` | Period: {range} |
| `dash.charts.showTable` | Show as table |
| `dash.charts.showChart` | Show as chart |
| `dash.charts.empty` | No data for this period. |
| `dash.charts.failed` | This chart could not be displayed. |
| `dash.charts.series.sales` | Sales |
| `dash.charts.series.profit` | Profit |
| `dash.charts.series.purchases` | Purchases |
| `dash.charts.series.cash` | Cash sales |
| `dash.charts.series.credit` | Credit sales |
| `dash.charts.salesProfit.title` | Sales and profit |
| `dash.charts.category.title` | Sales by category |
| `dash.charts.category.subtitle` | Before whole-sale discounts |
| `dash.charts.category.other` | Other categories |
| `dash.charts.category.none` | No category |
| `dash.charts.topItems.title` | Top 10 items |
| `dash.charts.cashCredit.title` | Cash and credit sales |
| `dash.charts.cashCredit.totals` | Cash {cash} · Credit {credit} |
| `dash.charts.salesPurchases.title` | Sales and purchases |
| `dash.charts.salesPurchases.subtitle` | Purchases = goods received from suppliers |
| `dash.charts.busy.title` | Busiest days and hours |
| `dash.charts.busy.subtitle` | Number of sales by weekday and hour |
| `dash.charts.busy.fewer` | Fewer sales |
| `dash.charts.busy.more` | More sales |
| `dash.charts.busy.none` | No sales |
| `dash.charts.busy.cell` | {day} {hour}:00–{hourEnd}:00 · {count} sales · {amount} |
| `dash.charts.aging.title` | Unpaid customer debts by age |
| `dash.charts.aging.subtitle` | As of today — not affected by the period |
| `dash.charts.aging.b0_30` | 0–30 days |
| `dash.charts.aging.b31_60` | 31–60 days |
| `dash.charts.aging.b61_90` | 61–90 days |
| `dash.charts.aging.b91` | More than 90 days |
| `dash.charts.aging.items` | {count} open sales |
| `dash.charts.aging.unapplied` | Payments not yet matched to a sale: {amount} |
| `dash.charts.aging.total` | Total owed: {amount} |
| `dash.charts.col.period` | Period |
| `dash.charts.col.category` | Category |
| `dash.charts.col.share` | Share |
| `dash.charts.col.item` | Item |
| `dash.charts.col.quantity` | Quantity |
| `dash.charts.col.day` | Day |
| `dash.charts.col.hour` | Hour |
| `dash.charts.col.count` | Number of sales |
| `dash.charts.col.age` | Age |
| `dash.charts.col.openSales` | Open sales |
| `dash.charts.col.amount` | Amount |
| `dash.weekday.0` … `dash.weekday.6` | Sunday, Monday, Tuesday, Wednesday, Thursday, Friday, Saturday |
| `dash.weekdayShort.0` … `dash.weekdayShort.6` | Sun, Mon, Tue, Wed, Thu, Fri, Sat |

The existing key `dashboard.title` ("Dashboard") is reused for the heading; `common.retry` for Retry buttons.

---

## Appendix F — Example responses (the N-1 fixture on 2026-09-24, a Thursday, sales posted at 10:xx). Use them as the frontend test mocks.

```json
{
  "dashboard_get_period": { "cur_from": "2026-09-24", "cur_to": "2026-09-24", "prev_from": "2026-09-23", "prev_to": "2026-09-23",
                            "cut_time": "12:00:00", "bucket": "HOUR", "today": "2026-09-24" },
  "dashboard_get_money_summary": { "sales": "58500.00", "prev_sales": "0", "sales_change_kind": "NO_BASE", "sales_change_pct": null,
    "profit": "18300.00", "prev_profit": "0", "profit_change_kind": "NO_BASE", "profit_change_pct": null, "margin_pct": "31.3",
    "sale_count": 7, "prev_sale_count": 0, "count_change_kind": "NO_BASE", "count_change_pct": null, "average_sale": "8357.14",
    "discount_total": "250.00", "cash_sales": "43200.00", "credit_sales": "15300.00", "cash_in_drawer": "45700.00",
    "open_session_count": 1, "receivables_total": "12800.00", "payables_total": "51000.00" },
  "dashboard_get_stock_summary": { "stock_value": "40800.00", "low_count": 1, "out_count": 1, "dead_count": 0, "dead_value": "0" },
  "dashboard_list_stock_items(low)": [ { "variant_id": 2, "product_id": 2, "item_name": "Couette 2p", "display_identifier": "SKU-000002",
    "identifier_type": "sku", "base_unit_name": "Unit", "quantity": "4.000", "minimum_stock": "5.000", "stock_value": "6000.00",
    "last_sold_on": "2026-09-24", "total_count": 1 } ],
  "dashboard_list_top_items": [ { "variant_id": 1, "item_name": "Oreiller blanc", "base_unit_name": "Unit", "quantity_sold": "39.000", "sales_before_discount": "46450.00" },
                                { "variant_id": 2, "item_name": "Couette 2p", "base_unit_name": "Unit", "quantity_sold": "6.000", "sales_before_discount": "12300.00" } ],
  "dashboard_list_top_customers": [ { "customer_id": 1, "customer_name": "Karim", "sale_count": 2, "sales": "9000.00" },
                                    { "customer_id": 2, "customer_name": "Samir", "sale_count": 1, "sales": "6300.00" } ],
  "dashboard_list_top_debtors": [ { "customer_id": 1, "customer_name": "Karim", "amount_owed": "9000.00", "oldest_open_on": "2026-09-24", "oldest_open_days": 0 },
                                  { "customer_id": 2, "customer_name": "Samir", "amount_owed": "3800.00", "oldest_open_on": "2026-09-24", "oldest_open_days": 0 } ],
  "dashboard_list_latest_sales": [
    { "document_id": 19, "document_number": "CR-2026-000004", "posted_local": "2026-09-24T10:15:00", "sale_kind": "CREDIT", "customer_name": "Samir", "total": "2000.00", "is_voided": true },
    { "document_id": 17, "document_number": "CS-2026-000005", "posted_local": "2026-09-24T10:14:00", "sale_kind": "CASH", "customer_name": null, "total": "2200.00", "is_voided": false },
    { "document_id": 16, "document_number": "CR-2026-000003", "posted_local": "2026-09-24T10:13:00", "sale_kind": "CREDIT", "customer_name": "Karim", "total": "5000.00", "is_voided": false },
    { "document_id": 14, "document_number": "CR-2026-000002", "posted_local": "2026-09-24T10:12:00", "sale_kind": "CREDIT", "customer_name": "Samir", "total": "6300.00", "is_voided": false },
    { "document_id": 13, "document_number": "CS-2026-000004", "posted_local": "2026-09-24T10:11:00", "sale_kind": "CASH", "customer_name": null, "total": "36000.00", "is_voided": false } ],
  "dashboard_get_sales_series": "24 rows: bucket_start 2026-09-24T00:00:00 … 2026-09-24T23:00:00; the 10:00 row = { sales 58500.00, profit 18300.00, cash_sales 43200.00, credit_sales 15300.00, purchases 81000.00, sale_count 7 }; every other row has \"0\" amounts and sale_count 0",
  "dashboard_get_sales_by_category": [ { "sort_order": 1, "category_key": "ID:1", "category_name": "Oreillers", "sales_before_discount": "46450.00", "share_pct": "79.1" },
                                       { "sort_order": 2, "category_key": "ID:2", "category_name": "Couettes", "sales_before_discount": "12300.00", "share_pct": "20.9" } ],
  "dashboard_get_busy_hours": "168 cells: weekday 0..6 × hour 0..23; the cell weekday 4 (Thursday), hour 10 = { sale_count 7, sales 58500.00 }; all other cells sale_count 0, sales \"0\"",
  "dashboard_get_receivables_aging": [ { "sort_order": 1, "bucket": "0_30", "amount": "13300.00", "item_count": 3 },
    { "sort_order": 2, "bucket": "31_60", "amount": "0", "item_count": 0 }, { "sort_order": 3, "bucket": "61_90", "amount": "0", "item_count": 0 },
    { "sort_order": 4, "bucket": "91_PLUS", "amount": "0", "item_count": 0 }, { "sort_order": 5, "bucket": "UNAPPLIED", "amount": "-500.00", "item_count": 0 },
    { "sort_order": 6, "bucket": "TOTAL", "amount": "12800.00", "item_count": 0 } ]
}
```
The document numbers, ids and times are illustrative (mocks); the amounts are the fixture's exact values.
