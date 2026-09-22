Install the new build and check that the screen shows `WS-L-1.0`. Sign in with your usual admin account.

**Discount (the WS-F-3 fix)**
1. At the till, add an item. A discount field is now visible for cash sales. Sell with a 100 DA discount; the total drops by 100.

**Documents page**
2. Open Documents. The list shows the last 30 days, with columns for customer/supplier, amount and "Recorded by". There are no "JE-…" accounting rows in this list.
3. Your new sale shows your username under "Recorded by". Documents from before this update show "—"; that is expected.
4. Click View on the discounted sale. The detail is filled in: items, total, discount, "Recorded by". It is no longer empty.
5. Cancel a sale from the cash session screen, then come back. The sale shows "Cancelled by AN-…" and the AN document shows "Cancels VC-…". Opening either one shows the other under Related Documents, and the cancelled sale shows a "cancelled" banner.
6. Type a customer's name in Search. Only that customer's documents remain. Try Type = "Cash Sale", then Status = "Cancelled".
7. Set the dates to a range with more than 50 documents. Next and Previous work, and "Showing 1–50 of N" is correct.
8. Open a sale's linked journal. It is the sale's own entry (VC number as source), never a cash in/out entry.

**Journals page**
9. Open Journals. Filter Source = "Cash In / Out". Each row shows "Session #…" as its source, not an unrelated document number.
10. Open any journal. Each line shows an account number and name (for example "530 · Caisse"), not "CASH_DESK".
11. Search a VC number. The sale's journal (and the cancellation's, if it was cancelled) appears.

**Languages**
12. Switch to French, then Arabic. Both pages and the detail windows read correctly, and Arabic is right-to-left.
