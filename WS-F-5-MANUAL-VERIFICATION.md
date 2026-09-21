Before starting: install the new build and confirm the screen shows `WS-F-5.1`. You need three accounts: an Admin, a Manager, and a Cashier.

**Cash in and out**
1. Sign in as the Cashier. Open a cash session with an opening float of 2,000.
2. In "Cash in and out", choose Money out, 500, reason Expense, note "delivery man". A "Manager approval required" box appears. Click Record without filling it: it must refuse and ask for the manager's username and password.
3. Fill in the Manager's username and password, then Record. It is saved and appears in the list.
4. Try again with a wrong manager password. It must refuse, and nothing is added to the list.
5. Choose Money in, 300, reason Change float. No approval box appears. Record. It appears in the list.
6. Choose reason "Custom reason" and leave the description empty. It must refuse. Type a description and it records.
7. Ring up a cash sale of 1,200 at the till. Back on the cash session screen, the sale must NOT appear in the cash in/out list.

**Closing**
8. Begin the blind close and count the drawer honestly (2,000 − 500 + 300 + 1,200 + any custom amounts in/out). It closes on its own, with no manager prompt.
9. Open a new session with 1,000, sell nothing, close it counting 970 (30 short). It closes on its own, because 30 is within the 50 DA tolerance.
10. Open Journals and find that shortfall: cash-variance debited 30, cash credited 30.
11. Open a session with 1,000 and close it counting 900 (100 short). It must ask for a manager. Approve it and check the journal posted the same way.
12. Try to record money out on a session that is already closing. It must be refused.

**Manager and settings**
13. Sign in as the Manager and open a session. Record Money out: no approval box appears, because a manager approves their own.
14. Open Settings as Admin. There must be NO "Cash variance tolerance" card.

**Languages**
15. Switch to French, then Arabic. The cash in/out panel and the approval box read correctly, and Arabic stays right-to-left.

**Earlier WS-F parts you have not tested yet (same build)**
16. Sale discount (WS-F-3): as a Manager, ring up a sale and apply a fixed discount, e.g. 200 DA. The total drops by exactly 200 and the receipt shows it. As a Cashier (without the discount permission) the discount option must not be usable.
17. Credit-limit warning (WS-F-4): give a customer a credit limit, then make a credit sale that takes them over it. A warning appears, but the sale is still allowed.
