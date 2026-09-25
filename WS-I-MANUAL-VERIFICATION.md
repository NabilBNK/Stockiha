# WS-I Manual Verification

> Windows/Tauri manual acceptance checks for the WS-I reporting workstream.
> Each sub-plan appends its own section below, per the WS-I plan PART 11.
> None of these have been run yet — this sandbox has no WebView2/real
> PostgreSQL-on-Windows environment. Run these on the Owner's Windows
> machine after `npm run tauri dev` (or the packaged build) against a
> database that has been migrated to at least `20260928090000`.

## After WS-I-1

1. A "Reports" menu item appears. Sales summary for "This month" shows net sales, profit, margin, number of sales, average basket, cash/credit, cancellations, and arrows vs last month.
2. Make a 1,000 DA sale with a 100 DA discount, then refresh: net sales go up by 900.
3. Cancel a sale: it leaves the totals; Cancellations goes up by 1.
4. Sales by product shows quantities with cartons, e.g. "200 pièce (20 carton)". Sort by profit.
5. Best sellers shows two top-10 lists.
6. Busy hours shows darker cells at your busiest times.
7. Sell one item below its cost: Margin alerts lists it with a suggested minimum price.
8. Print one report, save one as PDF, export one as CSV. The CSV opens in Excel with proper columns.

## After WS-I-2

9. The monthly summary for last month prints on one A4 page.
10. Record a 500 DA "Expense" cash-out: Profit & loss shows it under Expenses and the net result drops by 500.
11. Customers who owe: a customer with an old credit sale is in the right age column. "Copy reminder" and paste it into WhatsApp; switch the print language to Arabic and repeat.
12. That customer's statement ends with the same balance as the Customers page. Print it and save it as PDF.
13. The supplier statement ends with the same balance as the Suppliers page.
14. The trial balance says "Balanced". Open one account's ledger and click a journal number.
15. **Specifically check the end-of-day cash-out drawer count** — during Result Report review, a pre-existing bug was found (not introduced by WS-I): after any "cash out" during a session, the count screen's *expected* amount is inflated by 2x the cash-out total (confirmed in `sales.submit_cash_session_count`, unrelated to reporting). Closing a session with a real cash-out and checking whether the reported variance/shortfall looks right is worth a specific look, independent of the WS-I reports themselves (which compute correctly from the underlying ledger, not from this session field).

## After WS-I-3

16. Set a minimum stock above the current stock on two products: the bell shows a badge, and the home page shows the low-stock count.
17. Low stock → tick both → Prepare purchase: the purchase opens with both lines filled in; save it; the alert disappears.
18. Slow movers at 90 days lists products not sold recently, with the money tied up.
19. The home page shows today's sales, profit, cash expected, top products and the hourly chart. "Copy today's summary for WhatsApp" pastes correctly.
20. Dismiss a notification: hidden today, back tomorrow if still true.
21. Switch to French, then Arabic: reports, home page and bell all read correctly.
22. **Stock valuation "Avg cost" and product history**: open a product with real purchase history and confirm the running quantity in Product history matches the on-hand shown in Stock valuation for today's date.
23. **Prepare purchase with two suppliers**: select two low-stock rows whose last supplier differs, confirm the "choose a supplier" dialog appears, and that "Choose later" still opens the purchase form (with no supplier pre-selected).
