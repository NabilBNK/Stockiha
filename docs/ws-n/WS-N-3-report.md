# WS-N-3 Implementation Report — Charts & Analysis (Bottom Half of Dashboard)

## Gate 0 findings
- **G1 (`package.json` dependencies)**: Verified. No chart library was present in `package.json` prior to N-3.
- **G2 (Installed React version)**: Verified. `react@19.2.4` and `react-dom@19.2.4` installed. Recharts pinned to exact `recharts@3.10.1` and `react-is@19.2.4`.
- **G3 (`src/shared/charts/` folder)**: Verified. Did not exist prior to N-3. Created with complete modular chart kit.
- **G4 (Live `--sk-surface` values)**: Verified. Light `#ffffff`, dark `#1c1815` / `#111b2d`.
- **G5 (`src/shared/utils/formatters.ts`)**: Verified. Refactored month arrays into module-level `MONTHS_SHORT` map; added `formatShortDate` and `formatMonthYear`; preserved exact behavior of `formatDisplayDate`.
- **G6 (N-1 chart functions reachable from gateway)**: Verified. `getDashboardSalesSeries`, `getDashboardSalesByCategory`, `listDashboardTopItems`, `getDashboardBusyHours`, and `getDashboardReceivablesAging` available and typed.

---

## What changed

### Dependencies
- `package.json`: added `"recharts": "3.10.1"` and `"react-is": "19.2.4"`.
- `package-lock.json`: updated with exact pinned versions.

### Utilities and Formatters
- `src/shared/utils/formatters.ts`:
  - Added `formatShortDate(date: string, locale: Locale): string` (e.g. `"5 Sep"`, `"5 sept."`, `"5 سبتمبر"`).
  - Added `formatMonthYear(date: string, locale: Locale): string` (e.g. `"Sep 2026"`, `"sept. 2026"`, `"سبتمبر 2026"`).
  - Refactored `formatDisplayDate` to share `MONTHS_SHORT`.

### Design Tokens & CSS
- `src/styles/global.css`:
  - Added light/dark tokens for charts:
    - `--sk-chart-sales: #2a78d6` (dark: `#3987e5`)
    - `--sk-chart-profit: #eb6834` (dark: `#d95926`)
    - `--sk-chart-purchases: #19a875` (dark: `#199e70`) — tuned light value from `#1baf7a` to `#19a875` to achieve 3.04:1 contrast ratio against `#ffffff`, satisfying automated WCAG AA large contrast tests (`tests/contrast.test.ts`).
    - `--sk-chart-credit: #86b6ef` (dark: `#184f95`)
    - `--sk-chart-age-1..4` ramp
    - `--sk-chart-heat-1..5` ramp
    - `--sk-chart-grid` and `--sk-chart-axis`
- `src/styles/charts.css`:
  - Styles for `.sk-chart-card`, `.sk-chart-card__header`, `.sk-chart-card__legend`, `.sk-chart-card__body`, `.sk-chart-table`, `.sk-chart-table__caption`, `.sk-ranking-bars`, `.sk-heatmap-grid`, `.sk-series-tooltip`.
- `src/App.tsx`:
  - Imported `./styles/charts.css`.

### Shared Reusable Chart Kit (`src/shared/charts/`)
- `chartFormat.ts`:
  - `toPlotNumber`: decimal string conversion for geometry only with explicit non-display guard comment.
  - `compactTick`: compact Western numbers via `Intl.NumberFormat` with `notation: 'compact'`.
  - `bucketLabel`: formatted bucket start labels according to `HOUR`, `DAY`, and `MONTH`.
  - `heatClass`: 0–5 bucket calculation based on max count.
- `ChartCard.tsx`:
  - Container with accessible heading, optional subtitle, legend items, and "Show as table" / "Show as chart" toggle button (`aria-pressed`).
  - Loading skeleton, error with Retry, empty state, and data refreshing dimming (0.55 opacity).
- `ChartErrorBoundary.tsx`:
  - Class error boundary rendering localized fallback message without exposing raw exception internals.
- `ChartLegend.tsx`:
  - Color marks (line or rect) with text labels.
- `ChartTable.tsx`:
  - Semantic accessible HTML table with screen-reader caption and right-aligned numeric cells.
- `TimeSeriesChart.tsx`:
  - Recharts `LineChart` wrapped in `dir="ltr"` container.
  - Linear lines, no dots, 4px hover dot, hairline gridlines, custom accessible `SeriesTooltip`.
- `StackedColumnChart.tsx`:
  - Recharts `BarChart` wrapped in `dir="ltr"` container.
  - Stacked bars with 1px surface stroke, 4px top radius on upper bar, and hover cursor.
- `SeriesTooltip.tsx`:
  - Surface-card tooltip displaying timestamp, series mark, formatted amount, and series label.
- `RankingBars.tsx`:
  - CSS grid horizontal bars with proportional percentage widths, min 2px, and right-aligned Western amount text.
- `HeatmapGrid.tsx`:
  - 7 × 24 grid for 168 hours of the week starting with Sunday.
  - Focusable interactive cells (`tabIndex={0}`, `role="img"`) with hover/focus tooltips and color ramp scale legend.
- `index.ts`:
  - Re-exports all shared components and helpers.

### Hook Data Integration
- `src/features/dashboard/useDashboardData.ts`:
  - Added state and parallel data fetching for:
    - `series`: `getDashboardSalesSeries(token, cur_from, cur_to, bucket)`
    - `categories`: `getDashboardSalesByCategory(token, cur_from, cur_to)`
    - `topItems10`: `listDashboardTopItems(token, cur_from, cur_to, 10)`
    - `busyHours`: `getDashboardBusyHours(token, cur_from, cur_to)`
    - `aging`: `getDashboardReceivablesAging(token)` (as of today)
  - Sequence-guarded async execution; `aging` loads on mount and manual refresh; period-dependent charts refresh on period change.

### Seven Dashboard Charts (`src/features/dashboard/charts/`)
- `SalesProfitChart.tsx`: Wide time series comparing Sales and Profit.
- `CategoryChart.tsx`: Horizontal ranking bars of sales by category with percentage share.
- `TopItemsChart.tsx`: Top 10 selling products with pack/piece quantities via WS-O `usePrimaryPacks`.
- `CashCreditChart.tsx`: Stacked column chart of cash sales vs credit sales with period summary subtitle.
- `SalesPurchasesChart.tsx`: Time series comparing sales with goods received from suppliers.
- `BusyHoursChart.tsx`: 7x24 heatmap grid of sale counts and revenue by weekday and hour.
- `AgingChart.tsx`: Debtor aging buckets (0–30, 31–60, 61–90, 91+) with unapplied payments and total owed.
- `ChartsSection.tsx`: Responsive grid container mounting all seven charts wrapped in `ChartErrorBoundary`.
- `index.ts`: Re-export of `ChartsSection`.

### Screen Integration & Backward Compatibility
- `src/features/dashboard/DashboardScreen.tsx`:
  - Mounted `<ChartsSection>` inside `.sk-dash__charts`.
  - Added backward-compatible support for WS-I `get_today_overview` so `tests/home-today.workflow.test.tsx` passes without regression.
- `src/shared/version.ts`:
  - Set `APP_VERSION_MARKER` to `'WS-N-3.1'`.

---

## Contract triangle (N-3 chart endpoints)

| Chart Endpoint | SQL Signature | Rust Service / Command | TypeScript Contract & Gateway |
|---|---|---|---|
| Sales Series | `core.dashboard_sales_series(p_session_token text, p_from date, p_to date, p_bucket text)` | `dashboard_insights::get_sales_series` / `dashboard_get_sales_series` | `DashboardSeriesRow` / `getDashboardSalesSeries` |
| Sales by Category | `core.dashboard_sales_by_category(p_session_token text, p_from date, p_to date)` | `dashboard_insights::get_sales_by_category` / `dashboard_get_sales_by_category` | `DashboardCategoryRow` / `getDashboardSalesByCategory` |
| Busy Hours | `core.dashboard_busy_hours(p_session_token text, p_from date, p_to date)` | `dashboard_insights::get_busy_hours` / `dashboard_get_busy_hours` | `DashboardBusyCell` / `getDashboardBusyHours` |
| Receivables Aging | `core.dashboard_receivables_aging(p_session_token text)` | `dashboard_insights::get_receivables_aging` / `dashboard_get_receivables_aging` | `DashboardAgingRow` / `getDashboardReceivablesAging` |
| Top Items (limit 10) | `core.dashboard_top_items(p_session_token text, p_from date, p_to date, p_limit integer)` | `dashboard_insights::list_top_items` / `dashboard_list_top_items` | `DashboardTopItem` / `listDashboardTopItems` |

---

## Test results

### Automated Test Suites
- **`tests/formatters.dates.test.ts`**:
  - `formatDisplayDate` maintains exact French, English, Arabic formatting.
  - `formatShortDate` formats day and short month.
  - `formatMonthYear` formats short month and 4-digit year.
- **`tests/dashboard.charts.test.tsx`** (T-N3-1 to T-N3-6):
  - **T-N3-1**: `chartFormat` unit tests (`heatClass`, `bucketLabel`, `compactTick`, `toPlotNumber`).
  - **T-N3-2**: `ChartCard` states (skeleton loading, ready, table toggle, error + retry, empty state).
  - **T-N3-3**: `RankingBars` proportional width rendering and value formatting.
  - **T-N3-4**: `HeatmapGrid` 168 cells, Sunday first row, tooltip on focus/hover.
  - **T-N3-5**: Seven dashboard charts workflow with Appendix F fixture data verifying table view contents.
  - **T-N3-6**: Error isolation (single chart endpoint failure displays error card while others render).
- **`tests/contrast.test.ts`**:
  - 51/51 token contrast tests pass (all chart palette tokens meet WCAG AA large >= 3.0:1 requirement against white and dark backgrounds).
- **`tests/dashboard.workflow.test.tsx`**:
  - 9/9 tests pass (overview, isolation, custom range validation, compare toggling, quick actions).
- **`tests/home-today.workflow.test.tsx`**:
  - 9/9 tests pass (Today home screen compatibility preserved per Ruling R-11).
- **Repository Full Test Suite**:
  - 89 of 89 test files passed (835 passed, 0 failed).
- **Backend Cargo Test Suite**:
  - 532 passed, 0 failed, 62 ignored.

---

## Regression proof
All existing tests across the entire repository pass with 0 errors. No existing business assertions were weakened.

---

## Verification output

### Working directory: `C:\Users\Perfetto\Desktop\Stockiha-Part02-Test`

1. **`npm run typecheck`**:
   ```
   > stockiha@0.1.0 typecheck
   > tsc -b
   (clean exit 0)
   ```

2. **`npm run lint`**:
   ```
   > stockiha@0.1.0 lint
   > eslint .
   (clean exit 0, 0 errors, 0 warnings)
   ```

3. **`npm test -- --run`**:
   ```
   ✓ 89 test files passed (835 tests passed)
   Test Files  89 passed (89)
        Tests  835 passed (835)
     Duration  25.43s
   ```

4. **`npm run build`**:
   ```
   > stockiha@0.1.0 build
   > tsc -b && vite build

   ✓ 1047 modules transformed.
   dist/index.html                             0.41 kB
   dist/assets/index-Dpw4LGu0.css            154.46 kB
   dist/assets/index-bOYhXEiI.js           1,786.53 kB
   ✓ built in 12.29s
   ```

5. **`cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`**:
   ```
   (clean exit 0)
   ```

6. **`cargo check --manifest-path src-tauri/Cargo.toml`**:
   ```
   Finished `dev` profile [unoptimized + debuginfo] target(s) in 30.86s
   ```

7. **`cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`**:
   ```
   Checking stockiha-backend v0.1.0
   Finished `dev` profile [unoptimized + debuginfo] target(s) in 48.31s
   (clean exit 0, 0 warnings)
   ```

8. **`cargo test --manifest-path src-tauri/Cargo.toml --lib`**:
   ```
   test result: ok. 532 passed; 0 failed; 62 ignored; finished in 19.42s
   ```

---

## New i18n keys
Added to `src/shared/i18n/translations.ts` across English, French, and Arabic:
- `dash.charts.title`
- `dash.charts.subtitle`
- `dash.charts.showTable`
- `dash.charts.showChart`
- `dash.charts.empty`
- `dash.charts.failed`
- `dash.charts.series.sales`
- `dash.charts.series.profit`
- `dash.charts.series.purchases`
- `dash.charts.series.cash`
- `dash.charts.series.credit`
- `dash.charts.salesProfit.title`
- `dash.charts.category.title`
- `dash.charts.category.subtitle`
- `dash.charts.category.other`
- `dash.charts.category.none`
- `dash.charts.topItems.title`
- `dash.charts.cashCredit.title`
- `dash.charts.cashCredit.totals`
- `dash.charts.salesPurchases.title`
- `dash.charts.salesPurchases.subtitle`
- `dash.charts.busy.title`
- `dash.charts.busy.subtitle`
- `dash.charts.busy.fewer`
- `dash.charts.busy.more`
- `dash.charts.busy.none`
- `dash.charts.busy.cell`
- `dash.charts.aging.title`
- `dash.charts.aging.subtitle`
- `dash.charts.aging.b0_30`
- `dash.charts.aging.b31_60`
- `dash.charts.aging.b61_90`
- `dash.charts.aging.b91`
- `dash.charts.aging.items`
- `dash.charts.aging.unapplied`
- `dash.charts.aging.total`
- `dash.charts.col.period`
- `dash.charts.col.category`
- `dash.charts.col.share`
- `dash.charts.col.item`
- `dash.charts.col.quantity`
- `dash.charts.col.day`
- `dash.charts.col.hour`
- `dash.charts.col.count`
- `dash.charts.col.age`
- `dash.charts.col.openSales`
- `dash.charts.col.amount`
- `dash.weekday.0` … `dash.weekday.6`
- `dash.weekdayShort.0` … `dash.weekdayShort.6`

---

## Build version marker
`[ version = WS-N-3.1 ]`

---

## Installer
NOT RUN — per repository constraint: "Do not run Tauri packaging unless the task affects packaging, capabilities, configuration, or releases."

---

## Pending manual checks for the owner
1. Verify version marker in dashboard footer reads `[ version = WS-N-3.1 ]`.
2. Scroll down on Dashboard screen: "Charts & analysis" displays seven charts for the chosen period.
3. Switch between Light and Dark mode: lines and bars remain properly colored (not black) and text remains readable.
4. Select "This month": the total of "Cash and credit sales" subtitle equals the "Sales" figure at the top KPI strip.
5. Hover a point of "Sales and profit": tooltip card appears showing the period, sales, and profit.
6. Press "Show as table" on any chart: identical numbers appear in a formatted accessible data table.
7. Inspect "Busiest days and hours": hovering or focusing (Tab key) a square reveals day, hour, number of sales, and revenue amount.
8. Switch period between "Today", "This week", and "This month": "Unpaid customer debts by age" remains constant as it reflects today's balances.
9. Switch to Arabic: page layout mirrors to RTL, and time charts continue to plot chronologically left-to-right (`dir="ltr"`).

---

## Unrelated problems found
None.

---

## Not finished / could not verify
None. All components, styling, data loading, error handling, tests, and builds verified.

Branch: task/ws-n-3-dashboard-charts
Commit: 56526ac61903f1c52906e4f3aa9535f3402cc5c5
Pushed: no
