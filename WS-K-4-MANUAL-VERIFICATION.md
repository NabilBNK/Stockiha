# WS-K-4 manual verification — embedded database, clean Windows machine

This replaces `WS-K-3-MANUAL-VERIFICATION.md`. The old document tested an
installer that set up PostgreSQL as a Windows service in the background,
with its own dedicated Windows account. That whole approach has been
retired — three real-machine installs on that design failed in a row, each
time on a different bug, and it never once completed successfully. This
document tests the new approach instead: PostgreSQL now runs as an ordinary
part of the Stockiha program itself, and setting it up happens **on
screen, inside the app**, the first time it starts — not silently, during
install, as Administrator.

Written for a non-developer: what to do, what you should see, and what it
means if you see something else. **You do not need Administrator rights
for any of this** — that is one of the main things this redesign fixes.

> **If you tested an earlier build and setup failed at the "Initializing
> the database" step, you need the newest installer.** Two separate faults
> were found by testing on real machines, and neither can be worked around
> by pressing Retry:
>
> - `WS-K-4.1` put PostgreSQL's files in the wrong place — all of them
>   dumped into a single folder instead of the `bin`, `lib` and `share`
>   folders it needs. Fixed in `WS-K-4.2`.
> - `WS-K-4.2` put them in the right place, but the database programs
>   still could not start on a computer that has never had developer
>   tools installed: they need a standard Microsoft component
>   (`VCRUNTIME140.dll`) that is not part of a clean Windows install.
>   Every development machine already had it, which is why this only
>   appeared on a fresh PC. Fixed in `WS-K-4.3` by including that
>   component with the app.
>
> Use the **`WS-K-4.3`** installer for everything below. You can confirm
> the version after signing in: it is printed under the dashboard title.

Everything below assumes you are testing on a clean Windows machine (a
fresh VM, or a machine that has never had Stockiha on it before), unless a
step says otherwise.

---

## Step 0 — double-click the installer

1. The installer file is named **`Stockiha_0.1.0_x64-setup.exe`**.
2. Copy it onto the test machine (USB drive, shared folder, however you
   normally move files there). Do not run it on your own everyday machine
   first — always test on a clean machine.
3. **You should see:** one file, a few hundred MB (it still contains a full
   copy of PostgreSQL, bundled inside the app).
4. Double-click it.
5. **You should NOT see a Windows "User Account Control" prompt at all.**
   This install no longer needs permission to change the whole computer —
   it only installs for your own Windows user account. If Windows does ask
   you to let it make changes, or asks for an administrator password, stop
   and report this exactly — it should not happen.
6. **You should see:** the normal Stockiha installer window, and it should
   finish quickly (it is only copying files now — it is not setting up any
   database during install). You should never see a black command-window
   or blue PowerShell window flash on screen, even briefly.
7. Let Stockiha open once the installer finishes (or open it yourself from
   the Start menu).

---

## Scenario 1 — first launch: watching setup run, live, on screen

1. The very first time Stockiha opens on this machine, **you should see** a
   screen explaining that this is the first time Stockiha has run here and
   that it will take a few minutes to get ready — with a clearly labeled
   **Start** button. Nothing should happen automatically before you press
   it.
2. Press **Start**.
3. **You should see** a checklist of steps appear, and each one should
   change — in front of you, not frozen — from "in progress" to a
   checkmark, one after another, roughly in this order: creating a data
   folder, setting up the database, writing its settings, starting the
   database, creating internal accounts, creating the shop's database,
   setting up the shop's tables, saving the configuration, and checking the
   connection.
4. This should take a few minutes at most. **The window should never look
   frozen or unresponsive** while this runs — you should be able to see the
   checklist actively updating throughout.
5. Once every step shows a checkmark, **you should see** Stockiha restart
   itself and land on the sign-in screen.
6. In File Explorer's address bar, paste `%APPDATA%\com.raqmenha.stockiha`
   and press Enter. **You should see** a file named `database.json` and a
   file named `setup.log`, and a folder named `pgdata`.
7. Open `setup.log` in Notepad (read-only — do not edit it). **You should
   see** a plain-language line for every step above, each with a timestamp.
   **You should never see anything that looks like a password** anywhere
   in this file — no long random-looking string next to the word
   "password," "pwd," or similar. If you do see something that looks like a
   password in this file, stop and report it immediately — that is a
   serious problem.
8. Open `database.json` in Notepad (read-only). **You should see**
   real-looking values for `host`, `port`, `database`, `user`, and a long
   random-looking `password` — never a short or obviously-fake value.

## Scenario 2 — closing and reopening: the fast path (already set up)

1. Close Stockiha completely (close the window; do not force-quit it from
   Task Manager for this scenario).
2. Open Task Manager (right-click the taskbar → Task Manager), go to the
   "Details" tab, and look for any process named `postgres.exe`.
   **You should see: none at all.** If Stockiha has closed, its database
   should have closed with it — no leftover `postgres.exe` process should
   still be running. If you see one or more `postgres.exe` still there,
   stop and report it — this means the database was not shut down
   properly when the app closed, which is a serious problem worth fixing
   before this ships.
3. Reopen Stockiha.
4. **You should see** it go straight to the sign-in screen — no first-run
   setup screen, no checklist. This confirms it recognized the database was
   already set up and simply started it again.
5. This time, check Task Manager again while Stockiha is open. **You should
   see** one or more `postgres.exe` processes now — that is normal and
   expected while the app is running.
6. Sign in and confirm any data you entered before (a product, a category,
   whatever you tried) is still there.

## Scenario 3 — orphan check after a normal close

This is the same check as Scenario 2 step 2, called out on its own because
it is the single most important thing to get right: **a database process
that keeps running invisibly after you close the app is a real, ongoing
problem for a shop's computer**, not just an inconvenience.

1. With Stockiha open and signed in, open Task Manager's Details tab and
   confirm you can see at least one `postgres.exe`.
2. Close Stockiha normally (click its own close button, not Task Manager).
3. Wait about 10 seconds, then refresh Task Manager (press F5 or reopen
   it).
4. **You should see: zero `postgres.exe` processes.** If any remain, note
   how many, and report it exactly as you saw it — do not end the test
   session by manually killing them first, since that would hide the
   problem from whoever reads this report.

## Scenario 4 — an Arabic Windows username or display name

This scenario exists because of a well-known, specific risk: some database
software (including the PostgreSQL tools Stockiha bundles) has historically
had trouble with Windows file paths that contain non-Latin characters —
and your client is in Algeria, where an Arabic Windows username or display
name is a completely realistic, expected setup, not an edge case.

1. On a clean test machine, create a **new local Windows user account**
   with an Arabic username and an Arabic display name (for example, a
   username like `محمد` and a matching display name). This needs to be
   done by whoever has administrator access to the test machine — creating
   a new Windows account is an administrative action in its own right, not
   something the app does or needs.
2. Sign in to Windows as that new Arabic-named user.
3. Install and run Stockiha exactly as in Step 0 and Scenario 1 above, under
   this account.
4. **You should see** the same first-run setup checklist as Scenario 1,
   completing successfully all the way through, ending on the sign-in
   screen — exactly as it did for the ordinary-username account.
5. **If any step fails here specifically** (and did not fail under an
   ordinary English-named account), this is the exact risk this scenario
   exists to catch — stop, copy the failed step's message from the app
   (there is a "Copy details" button for this), and report it along with
   the exact Windows username and display name you used.

   **What was actually tested, and its result, before this document was
   written:** creating a new Windows account was not performed as part of
   preparing this document (that is a system-administration action left to
   whoever runs this manual verification, not something automated here).
   Instead, the exact underlying mechanism was reproduced directly: a real
   setup run was pointed at a data folder whose own path contained Arabic
   characters — the same situation an Arabic Windows username produces,
   since `database.json` and the app's own data folder live under a path
   that includes your Windows username. On the first attempt, this failed
   for real: PostgreSQL's own `initdb` tool could not create its data
   folder, because it converts file paths through an older, Latin-only
   text encoding internally and turns non-Latin characters into `?`
   marks — a real, confirmed bug in the bundled database tools themselves,
   not in Stockiha's own code. Stockiha now detects this case itself and
   automatically relocates the database's data folder to a fixed, safe
   location instead (`C:\ProgramData\Stockiha\pgdata`) whenever the normal
   location would not work — after that fix, the same test succeeded. This
   scenario is what confirms that fix continues to work on a real Windows
   account, not just in an automated test.

## Scenario 5 — nothing was written to the Owner's own dev path

1. In File Explorer's address bar, paste
   `%LOCALAPPDATA%\Stockiha\r8-acceptance` and press Enter.
2. **You should see** "This folder doesn't exist" — this path belongs only
   to the Owner's own development machine and must never appear on a
   client's computer.
3. **If this folder exists and contains anything:** report it — something
   used the wrong path.

## Scenario 6 — a failed step can be retried without reinstalling

This is harder to force on purpose (it requires a step to genuinely fail),
so treat it as optional unless a real failure happens during any scenario
above.

1. If any step in Scenario 1's checklist ever shows a red/failed mark
   instead of a checkmark, **you should see** a plain-language explanation
   of what went wrong, a "Copy details" button, and a **Retry** button.
2. Press **Retry**.
3. **You should see** the checklist start again and pick up from where it
   is safe to resume — you should not need to uninstall or reinstall
   anything to try again.

---

Report back which steps and scenarios matched "what you should see" and
which did not. For any mismatch, attach `%APPDATA%\com.raqmenha.stockiha\setup.log`
if it exists (never attach `database.json` itself, since it holds real
database credentials) — `setup.log` is designed to be read by someone who
is not a developer, and is guaranteed not to contain any password.
