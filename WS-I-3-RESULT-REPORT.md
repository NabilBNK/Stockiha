# WS-I-3 Result Report — Stock reports, Notifications centre & the "Today" home

**Branch:** `task/ws-i-3-stock-home-notifications`, from WS-I-2 tip `b8e2171`.
**Scope:** STEP I3-01 → I3-12 of `WS-I-REPORTS-PLAN-GEMINI.md` PART 7.

## Summary

All six new `reports.*` SQL functions (stock valuation, low stock, slow
movers, product history, notifications, today) are implemented, exposed
over IPC, and consumed by four new stock report screens, a notifications
bell/panel, and a rebuilt "Today" home page. The low-stock "Prepare
purchase" flow hands off to the Purchases screen via a `sessionStorage`
prefill that the screen now reads on mount. Every old dashboard test id
survives, moved unchanged into a collapsible "System status" section.

## Files changed

**New:**
- `src-tauri/migrations/20260929090000_ws_i_003_stock_home.sql`
- `src-tauri/tests/reports/ws_i_003_stock_home_integration.sql`
- `src/features/reports/stock/{StockValuationReport,LowStockReport,SlowMoversReport,ProductHistoryReport}.tsx`
- `src/features/notifications/{NotificationsContext,NotificationBell,NotificationPanel,notifications.css}`
- `src/features/dashboard/{dailySummaryText.ts,dashboard.css}`
- `tests/{notifications,home-today,reports-stock}.workflow.test.tsx`

**Modified:**
- `src-tauri/src/commands/reports.rs`, `lib.rs`, `licence/gate.rs` (6 new commands, allowlist +6, count 234→240)
- `src-tauri/tests/run_current_sql_suites.sh` (+1 suite)
- `src/shared/ipc/{commands.ts,reportsDto.ts,reportsGateway.ts}` (6 new commands/DTOs/gateway fns)
- `src/features/reports/ReportsScreen.tsx` (Stock tab; `REPORTS_LAST_TAB_STORAGE_KEY` exported)
- `src/features/reports/common/{printModels.ts,reportCopy.ts}` (4 print models; stock/notification/home copy, all 3 locales)
- `src/features/dashboard/DashboardScreen.tsx` (rewritten; see below)
- `src/features/procurement/PurchasesScreen.tsx` (prefill reader only)
- `src/app/AppShell.tsx` (bell in header), `src/app/AppRouter.tsx` (`NotificationsProvider` + `setView` passed to Dashboard)
- `src/shared/version.ts` → `WS-I-3.0`
- `WS-I-MANUAL-VERIFICATION.md` (PART 11 "After WS-I-3" appended)

## Deviations (all documented, none silent)

1. **I3-02 record-variable pitfall, applied preemptively.** The plan's own
   text warns that `SELECT ... INTO` on an unmatched row leaves a `record`
   variable "not assigned yet" as soon as a field is read, and explicitly
   pre-authorizes the scalar-variable fix. Applied from the start in both
   `get_notifications` (`v_session_id`/`v_session_hours` instead of
   `v_session`) and `get_today` (`v_s_id`/`v_s_status`/`v_s_float` instead
   of `v_s`) — confirmed necessary; the suite failed with exactly that
   error before the SQL was first written this way.

2. **Notification navigation ids use the existing kebab-case sub-id
   convention, not the plan's literal example strings.** STEP I3-06 gives
   `stock/low`, `stock/slow`, `sales/margin` as the `sessionStorage`
   targets. WS-I-1 already shipped `sales/margin-alerts` (not `margin`),
   and every other stock/finance sub-id in `ReportsScreen.tsx` follows the
   same `by-product`/`best-sellers` kebab pattern. Using the plan's literal
   strings would have silently failed to open the right sub-tab for two of
   the six notification kinds. Used `stock/low-stock`, `stock/slow-movers`,
   `sales/margin-alerts` instead — documented in-code at the constant
   definition (`ReportsScreen.tsx`).

3. **STEP I3-07's "call the add-line function with (variant_id,
   quantity_base, unit_cost)"**: the single function `PurchasesScreen.tsx`
   uses to add a line, `appendLineFromOption(option: PurchaseProductOption)`,
   takes a full product option and always defaults quantity to `'1'` and
   cost to the product's own last cost — it has no `(variant_id, quantity,
   unit_cost)` overload. Rather than extending that function's signature
   (touching more of the file than "prefill reader only" implies) or
   invoking it and then separately patching the pushed line, the prefill
   effect builds the `CreatePoLinePayload` objects directly, in the same
   shape `appendLineFromOption` produces, and appends them in one
   `setLines` call. Net effect matches the spec (variant id from the
   matched product option, quantity/cost from the prefill payload,
   inactive/missing variants skipped and counted); no other line-adding
   path in the screen was touched.

4. **The "Today" home keeps `<h1>{t('dashboard.title')}</h1>` ("Dashboard")
   as the page's only `<h1>`.** 22 existing workflow test files assert
   `screen.findByRole('heading', { name: 'Dashboard' })` right after login.
   An early draft made the greeting itself the `<h1>`, which broke all 22
   (verified via a full `npx vitest run`, then fixed). The greeting
   (`home-greeting`) is a `<p>` under that same `<h1>`; the "System status"
   section's own inner heading was demoted from a second `<h1>` to plain
   text so only one "Dashboard"-named heading exists on the page. This is
   the one point in the sub-plan where the specified test id
   (`home-greeting`) and an unstated but load-bearing existing contract
   (the post-login heading) both had to hold at once.

5. **`BACKUP_OVERDUE`'s notification action** navigates to Settings but
   does not scroll to a specific card: no backup-card element carries an
   `id` in `RecoverySettingsScreen.tsx`, and that file is outside this
   sub-plan's file list, so none was added. `LICENCE_*` items do scroll to
   `#licence-card`, which already exists.

6. **Home KPI "Cash expected" tile** is not built from the shared
   `KpiCard` component like the other four KPIs: the no-session state
   needs an inline "Open session" button, which `KpiCard`'s fixed
   value/comparison layout does not support. It reuses the same
   `.sk-kpi-card` classes by hand instead of inventing new ones.

## SQL suite (STEP I3-10) — how it was built

Bootstrap follows `ws_i_002`'s pattern exactly (suffix `wsi003`). One real
bug was found and fixed during verification, not by the plan text:
`catalog.variant_units.conversion_direction`/`conversion_quantity` became
`NOT NULL` in a later migration
(`20260908090000_ws_d_007_variant_alt_unit_direction.sql`, grep-proven,
R-03) after the plan was written; the suite's carton-unit insert now sets
both (`ALT_TO_BASE`, `10.000`, matching `conversion_factor`'s own meaning).
A second bug was in the suite itself, not the migration: V3 ("has stock,
never sold" — required for the slow-movers assertion) was accidentally
reused as the "sale posted today" fixture too, which of course means it
*had* been sold and get_slow_movers(30) correctly stopped listing it. Added
a fifth variant (V5) for today's cash sale and the overdue credit invoice,
leaving V3 untouched. Both are noted here rather than silently fixed.

All 9 STEP I3-10 assertions pass; the migration file re-applies cleanly a
second time (idempotency check).

## Gates — real output

```
cargo fmt --check                                    PASS (no output)
cargo check                                           PASS
cargo clippy --all-targets --all-features -- -D warnings   PASS
cargo test --lib                                      PASS — 515 passed; 0 failed; 62 ignored
cargo test --lib -- --ignored safe_upgrade             PASS — 3 passed
cargo test --lib -- --ignored embedded_setup           PASS — 5 passed
npm run typecheck                                      PASS
npm run lint                                           PASS
npm test -- --run                                      PASS — 761 passed, 76 files (0 failed)
npm run build                                          PASS
```

`licence::gate::tests::every_registered_command_is_classified` passes at
the expected count of **240**.

**SQL suites** — throwaway PostgreSQL 18 cluster built from
`src-tauri/resources/postgres/win64`, port 55499, roles bootstrapped and
CI fiscal period seeded exactly as `.github/workflows/ci.yml` does, all
165 migrations applied in filename order, every suite in
`run_current_sql_suites.sh` run individually against one clean pass
(cross-run sequence-value pollution from a first, dirty pass was
diagnosed and discarded — same methodology fix as WS-I-1):

| Suite | Result |
|---|---|
| All suites except the five below | **PASS** (42 suites, including `ws_i_001`, `ws_i_002`, **`ws_i_003`**, and the standalone `s2_002` race suite) |
| `s3_001_procurement_integration.sql` | FAIL — expected, PART 10 |
| `s3_002_landed_cost_and_invoices_integration.sql` | FAIL — expected, PART 10 |
| `s3_003_supplier_returns_and_payments_integration.sql` | FAIL — expected, PART 10 |
| `r2_financial_semantics_integration.sql` | FAIL — expected, PART 10 |
| `r8_e_procurement_integration.sql` | FAIL — expected, PART 10 |

No other failure. Throwaway cluster deleted afterward; nothing connected
to `stockiha_acceptance` or port 5433.

**Frontend workflow tests (STEP I3-11):** `tests/notifications.workflow.test.tsx`
(6 tests), `tests/home-today.workflow.test.tsx` (9 tests),
`tests/reports-stock.workflow.test.tsx` (4 tests) — all included in the
761-test `npm test` run above. One planned scenario (day-rollover
dismissal) is tested by seeding a stale `stockiha.notifications.dismissed.<date>`
key directly rather than mocking system time end-to-end through the whole
app tree — `vi.useFakeTimers()` combined with the full `<App/>` render
tree hung indefinitely (a testing-library/fake-timer interaction, not a
product bug); the direct-storage-key approach proves the same per-day
keying behavior without that flakiness.

## Acceptance criteria (§7.13)

1. All gates pass. ✔
2. The suite's 9 assertions pass. ✔
3. The gate count is 240. ✔
4. Every old dashboard test id is still present (`dashboard`, plus every
   id inside it — verified by test and by the `<details>` wrapping
   preserving the DOM subtree). ✔
5. The bell shows real alerts (from `get_notifications`) and per-day
   dismissal works (localStorage-keyed by date, stale keys pruned on
   mount). ✔
6. Prepare purchase opens a pre-filled purchase that saves normally
   (verified end-to-end in `reports-stock.workflow.test.tsx`, including
   the multi-supplier dialog). ✔
7. The WhatsApp summary is correct in three languages
   (`dailySummaryText.ts`, unit-tested for fr/ar/en including the
   no-shop-name and no-session variants).

   **One intentional wording deviation, consistent with the WS-I-2
   precedent (`reminderText.ts`):** the plan's literal template lines end
   each amount in a literal `" DA"`/`" دج"` suffix. `formatDisplayAmount`
   already appends a currency suffix (`" DZD"`) to every amount everywhere
   else in this app. Stacking a second, different literal suffix on top
   would show two currency markers per line and contradict every other
   report screen. Amounts go through `formatDisplayAmount` with no extra
   literal suffix, exactly as `reminderText.ts` already established for
   WS-I-2's WhatsApp reminder text.

## Manual/Windows-only

Not run in this sandbox (no WebView2, no Windows print pipeline): the
printed/PDF output of the four new stock reports, the bell's live badge
in the real app, and item 19 of `WS-I-MANUAL-VERIFICATION.md`'s
after-WS-I-3 checklist (pasting the WhatsApp text into an actual chat).
Appended as PART "After WS-I-3", items 16–23.

## Verdict

**PASS WITH MANUAL CHECKS** — every automated gate is green with real
output above; Windows/WebView2/print verification is still owed per the
project's standing Linux-sandbox limitation.
