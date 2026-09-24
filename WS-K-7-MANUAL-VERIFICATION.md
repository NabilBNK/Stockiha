# WS-K-7 — Owner Manual Checks

Reproduced verbatim from `WS-K-7-LICENCE-ACTIVATION-PLAN.md` PART 13 ("Owner
manual checks (after WS-K-7-B)"), with two additional checks (13, 14) added
at the end per the WS-K-7-B kickoff instruction.

Install the new build (version 0.7.0) and check that the screen shows
`WS-K-7-B.0`.

1. On a machine that never had a licence: a yellow banner says Stockiha is
   not activated and shows the days left. Selling still works.
2. Open Settings → Licence: note the machine code (`STKH-…`). The Copy
   button works — paste it into Notepad to check.
3. On your own PC, issue a **dated** licence for that code, expiring one
   year from today:
   `node scripts/licence/issue-licence.mjs --machine-code <code> --licensee "<shop>" --expires <date>`
   Send yourself the key and paste it into the Licence card → Activate. The
   status becomes "Active", with the expiry date and days left, and the
   banner disappears.
4. Paste a key issued for a **different** machine code: it is refused with
   "issued for another computer", and the current licence stays active.
5. Paste a key with one character changed: it is refused as not valid.
6. Remove the licence (confirm). With the grace period still running, the
   yellow banner returns.
7. Issue and activate a licence that **expires today**: it shows "expiring
   soon" with 0 days left. Tomorrow (or after moving the Windows date
   forward one day and clicking "Check again") it shows "Expired —
   read-only":
   - the till shows "Selling is blocked";
   - Documents, Journals and reports still open;
   - the open cash session can still be counted and closed;
   - a backup can still be created.
   Put the date back afterwards.
8. With a valid dated licence, move the Windows date **back** by 3 days and
   click "Check again": "Computer date problem — read-only". Put the date
   right, click "Check again": back to "Active".
9. Issue a **permanent** licence and activate it: "Permanent licence", no
   expiry.
10. Log out: the login screen shows the licence banner when the app is
    read-only, and nothing when it is active.
11. Switch to French, then Arabic: every licence text reads correctly.
12. Take a backup, restore it on another PC: that PC shows its own machine
    code and needs its own licence (the grace period applies there).
13. In a normal installed build, activate a real licence you issued for
    this machine's code and confirm the status turns Active.
14. With an expired licence installed, confirm a cash sale is refused while
    Documents, backup and closing the cash session still work.
