# WS-I Manual Verification

> Windows/Tauri manual acceptance checks for the WS-I reporting workstream.
> Each sub-plan appends its own section below, per the WS-I plan PART 11.
> None of these have been run yet — this sandbox has no WebView2/real
> PostgreSQL-on-Windows environment. Run these on the Owner's Windows
> machine after `npm run tauri dev` (or the packaged build) against a
> database that has been migrated to at least `20260927091000`.

## After WS-I-1

1. A "Reports" menu item appears. Sales summary for "This month" shows net sales, profit, margin, number of sales, average basket, cash/credit, cancellations, and arrows vs last month.
2. Make a 1,000 DA sale with a 100 DA discount, then refresh: net sales go up by 900.
3. Cancel a sale: it leaves the totals; Cancellations goes up by 1.
4. Sales by product shows quantities with cartons, e.g. "200 pièce (20 carton)". Sort by profit.
5. Best sellers shows two top-10 lists.
6. Busy hours shows darker cells at your busiest times.
7. Sell one item below its cost: Margin alerts lists it with a suggested minimum price.
8. Print one report, save one as PDF, export one as CSV. The CSV opens in Excel with proper columns.
