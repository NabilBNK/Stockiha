# WS-K-6 manual verification — internet-delivered updates, real hardware

Written for a non-developer: what to do, what you should see, and what it
means if you see something else. Do this on a **test machine or VM**, not
a shop's real computer — this script includes a deliberately broken/
tampered update on purpose, to prove the app refuses it.

You will need: the R2 (or chosen host) login from
`WS-K-6-R2-SETUP.md`, two installers (an older one already on the test
machine, and a newer signed one to publish as the "update"), and about 30
minutes.

---

## Part 1 — publish a real test release and watch the app find it

1. On the test machine, install an **older** Stockiha build and complete
   first-run setup (see `WS-K-4-MANUAL-VERIFICATION.md`, Scenario 1).
2. Sign in and add something memorable — a product named
   **`WS-K-6 UPDATE TEST PRODUCT`**. Note its name exactly.
3. Following `WS-K-6-RELEASE-PROCESS.md` steps 1–6, build, sign, and
   publish a genuinely NEWER version to your R2 bucket (a real version
   bump is fine even if the only change is a comment — what matters here
   is the version number increasing). Set `update-policy.json`'s `mode`
   to `"optional"` for this first pass.
4. Leave Stockiha open on the test machine (it checks once on launch, and
   this is far sooner than the normal 6-hour recheck) or close and
   reopen it.
5. **You should see**, somewhere on screen (a small banner, not a
   full-screen interruption), a message that a new version is available,
   with an **Install now** button and a way to dismiss it.
6. Click **Install now**.
7. **You should see** a short "Installing... the app will restart"
   message.
8. **Watch closely here — this is the one thing that genuinely needs your
   own eyes, and it may change your mind about code-signing:** does
   Windows show a "Windows protected your PC" / SmartScreen warning at
   any point during this install? If it does, what exactly do you have to
   click to get past it ("More info" then "Run anyway", or something
   else)? **Write down exactly what you saw, word for word.** At install
   time you were there in person to click through anything; at update
   time — running unattended, on a shop's PC, on the client's own
   authority to click "Run anyway" if a screen even appears — this is
   very different, and needs your judgment afterward.
9. **You should see** Stockiha close and reopen on its own within a
   minute or so (no manual double-click needed).
10. Sign in. Find **`WS-K-6 UPDATE TEST PRODUCT`** in the product list.
    **You should see it, unchanged.**
11. If the new version's own database needed updating (only happens if
    the release you published also included new database migrations —
    most small releases will not), **you should see** WS-K-5's own
    upgrade screen run automatically right after the restart, exactly as
    described in `WS-K-4-MANUAL-VERIFICATION.md` Scenario 7 — backup,
    verify, migrate, verify, then straight to sign-in. If the release had
    no new migrations, you go straight to sign-in with nothing else
    happening, which is correct, not a sign anything is broken.

## Part 2 — confirm a tampered file is rejected

This is the single most important check in this whole document: proving
a corrupted or substituted download cannot install.

1. In your R2 bucket, open `latest.json` and note its current
   `signature` value somewhere safe (so you can restore it after this
   test).
2. Replace just a few characters in the middle of that `signature` value
   with anything else (e.g. change `AAAA` to `ZZZZ` wherever it appears),
   and save. This simulates the one thing signing exists to catch: a file
   that does not match what Stockiha itself actually produced.
3. On the test machine, trigger another check (close and reopen the app,
   or wait for the next automatic check).
4. **You should see** the app either report nothing new (treating the
   broken manifest as unusable) or, if it attempts the download, fail
   before installing anything — either way, **you should NOT see the
   update install, and you should NOT see the app crash or hang.**
5. Confirm the test machine is still running the same version as before
   this step — the tampered "update" must have had zero effect.
6. Restore the original `signature` value in `latest.json` from step 1
   before moving on, so the bucket is back to a genuine, working release.

## Part 3 — offline check is silent

1. Disconnect the test machine from the internet entirely (unplug the
   cable, or turn off Wi-Fi).
2. Open Stockiha (or trigger a manual recheck if the app is already
   open).
3. **You should see:** nothing at all related to updates — no error
   popup, no frozen screen, no retry spinner. The app should behave
   exactly as it would with no update system at all.
4. Reconnect the internet. **You should see** a normal check succeed on
   the next attempt, with no leftover error state from step 3.

## Part 4 — an open cash session defers the update, but trading still works

1. Publish another genuinely newer test release (bump the version again),
   this time with `update-policy.json`'s `mode` set to `"forced"`.
2. On the test machine, open a cash session (start a normal till shift).
3. Trigger a check. **You should see** the forced update notice appear —
   but its **Install now** button should be disabled/greyed out, with
   text explaining that closing the cash session first is required.
4. **With the notice still showing, use the till normally** — ring up a
   sale, browse products, open other screens. **You should see** every
   part of the app work exactly as if the notice were not there at all.
   This is the single most important behavior in this section: a
   required update must never stop a shop from taking money.
5. Close the cash session normally.
6. Trigger another check (or click **Install now** again). **You should
   see** the button now enabled, and the install proceeds as in Part 1.

## Part 5 — a broken update still leaves the shop able to trade

Hard to force on purpose without a genuinely broken build, so treat this
as optional unless you have one available to test with (e.g. deliberately
point `latest.json`'s `url` at a file that does not exist, so the
download itself fails partway through).

1. With a forced update notice showing and no cash session open, click
   **Install now** against a release whose `url` points at a missing or
   unreachable file.
2. **You should see** the install attempt fail with a plain message, and
   the notice remains — but **you should still be able to open a cash
   session and sell normally**, immediately, with no restart needed and
   no other part of the app affected.

---

Report back which steps matched "what you should see" and which did not,
plus your exact word-for-word answer to step 8 of Part 1 (the SmartScreen
question) — that answer may change whether a Windows code-signing
certificate is worth reconsidering for a later release.
