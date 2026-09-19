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
> - `WS-K-4.3` got the database programs running, but they then could not
>   find each other: Stockiha was giving them a special form of Windows
>   folder path (one starting `\\?\`) that the database's own tools do not
>   understand, so `initdb` reported that `postgres` "was not found in the
>   same directory" while it was sitting right beside it. Fixed in
>   `WS-K-4.4`.
>
> - `WS-K-4.4` fixed that for the normal install location, but Stockiha was
>   still asking Windows for the folder in a way that produces the same
>   unusable form of path. `WS-K-4.5` stops asking for it that way at all.
>
> - `WS-K-4.6` is that same `WS-K-4.5` build merged with everything that
>   landed on the main branch meanwhile (the supplier payments and supplier
>   returns work) — the first build carrying both the new database setup
>   and the latest shop features.
>
> - `WS-K-4.6` completed setup on a fresh PC — the first build to do so —
>   and closing/reopening worked. But "PostgreSQL Server" was still in Task
>   Manager after closing Stockiha: the database started during setup was
>   never stopped, because Stockiha restarts itself right after setup and
>   that restart skipped the normal shutdown. `WS-K-4.7` stops it before
>   restarting, and also stops any such leftover on the next normal close.
>
> - `WS-K-4.8` is `WS-K-4.7` plus the POS work from `task/ws-f-3-sale-discount`
>   (WS-F-2 receipt printing and printing settings, WS-F-3 sale discount).
>   The earlier installer did not contain that work, so the discount was
>   not there to find; this one has it.
>
> - `WS-K-4.8` could not run on a PC set up by `WS-K-4.6`/`4.7`: the
>   database was three migrations behind, and Stockiha showed "Database
>   needs an update — contact your supplier". That message was written for
>   a database someone else looks after; here the database is Stockiha's
>   own, so from `WS-K-4.9` it brings the database up to date itself when a
>   newer build starts. To make that possible it now keeps the upgrade
>   credential on disk — which `4.6`–`4.8` did not, so those three builds
>   can never self-upgrade (see the one-time reset just below).
>
> - `WS-K-4.9` brought a database up to date automatically, but did it with
>   no safety net at all: no backup, no check that a backup could even be
>   restored, and no way back if the update itself went wrong. `WS-K-5.1`
>   adds exactly that safety net, in front of the same self-update — see
>   **Scenario 7** below, which is the one that matters most for this
>   version.
>
> Use the **`WS-K-5.1`** installer for everything below. Installers are now
> named after their version — **`Stockiha_WS-K-5.1-setup.exe`** — so you
> can tell them apart on disk.
>
> **One-time reset if this PC already has `WS-K-4.6`, `4.7` or `4.8` on it:**
> before opening `WS-K-4.9`, close Stockiha, confirm "PostgreSQL Server" is
> gone from Task Manager, then delete the folder
> `%APPDATA%\com.raqmenha.stockiha` (and `C:\ProgramData\Stockiha\pgdata`
> if it exists). Setup will run again from scratch. This is only because
> those three test builds did not keep the upgrade credential; nothing set
> up by `4.9` or later will ever need this again. Never do this on a
> machine with real shop data.
>
> **The version is
> printed on the setup screen itself**, directly under "Setting up
> Stockiha" — so you can confirm which build you are running before
> pressing Start, without having to sign in first. If it does not say
> `WS-K-5.1`, you are running an older installer.
>
> **If you install `WS-K-4.7` over `WS-K-4.6` on the same PC** (rather than
> a fresh one), the leftover database from `WS-K-4.6` is still running when
> you first open `WS-K-4.7`. That is expected. It will be stopped the first
> time you close Stockiha normally — so do the Task Manager check in
> Scenario 3 *after* that first close, not before.
>
> If setup fails again, please also send
> `%APPDATA%\com.raqmenha.stockiha\setup.log`. It now records the exact
> folders Stockiha used, which is what the previous reports could not show.

Everything below assumes you are testing on a clean Windows machine (a
fresh VM, or a machine that has never had Stockiha on it before), unless a
step says otherwise.

---

## Step 0 — double-click the installer

1. The installer file is named **`Stockiha_WS-K-4.9-setup.exe`** (the
   version is in the file name).
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
2. Open Task Manager (right-click the taskbar → Task Manager). On the
   "Processes" tab the database shows up as **"PostgreSQL Server"**; on the
   "Details" tab it shows as **`postgres.exe`** — they are the same thing,
   so check whichever tab you have open.
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

1. With Stockiha open and signed in, open Task Manager and confirm you can
   see at least one "PostgreSQL Server" (Processes tab) / `postgres.exe`
   (Details tab).
2. Close Stockiha normally (click its own close button, not Task Manager).
3. Wait about 10 seconds, then refresh Task Manager (press F5 or reopen
   it).
4. **You should see: zero "PostgreSQL Server" / `postgres.exe` processes.** If any remain, note
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

## Scenario 7 — updating over an older build: the safe automatic upgrade

This is the most important scenario in this document for `WS-K-5.1`. It
proves that installing a newer Stockiha over an older one, with real shop
data already in it, cannot lose that data — even if something goes wrong
partway through.

**What this scenario is checking for, in plain terms:** every earlier
version of Stockiha that could bring its own database up to date did so
silently, with nothing kept in reserve if it went wrong. This version takes
a full backup first, checks that the backup actually works, and only then
updates — and if anything about the update itself does not go perfectly, it
puts everything back exactly the way it was before touching anything.

> **Do not use `WS-K-4.9` for step 1 below.** It was tried first, on the
> Owner's real machine, and nothing happened: no backup, no `upgrade.log`.
> That was the *correct* behavior, not a bug — `WS-K-4.9` and `WS-K-5.1`
> ship the exact same 152 database migrations, so there was genuinely
> nothing to update, and "nothing to update means no backup is taken" is
> itself one of this feature's requirements. But it also means this
> scenario cannot be exercised with those two installers together — they
> are not far enough apart. Use the dedicated **TEST** installer named
> below instead, which is deliberately built a few migrations behind so
> this scenario has something real to do.
>
> **`Stockiha_WS-K-5.1-TEST-OLDER-DB-147of152-setup.exe`** is that
> installer — the exact same `WS-K-5.1` code, compiled with its newest 5
> database migrations deliberately left out, so it is genuinely behind
> `WS-K-5.1` itself. Its setup screen shows the marker
> `WS-K-5.1-TEST-OLDER-DB-147of152` — unmistakably not a real release — and
> it must only ever be installed on a disposable test machine or VM, never
> on a real shop computer, and never pointed at real shop data. A developer
> can rebuild a fresh copy of it for any future release with
> `scripts\build-test-older-installer.ps1` (see the note at the end of this
> scenario) — this is now the standing way to test this path, since not
> every release will happen to add new migrations on its own.

1. On a clean test machine, install the **TEST** installer named above.
   Complete first-run setup (Scenario 1) — it looks and behaves identically
   to a normal first-run setup, just with the unmistakable TEST marker on
   screen.
2. Sign in and add something memorable and easy to check later — for
   example, create a product named **`WS-K-5 UPGRADE TEST PRODUCT`**. Note
   its name exactly.
3. Close Stockiha normally.
4. Now install **`Stockiha_WS-K-5.1-setup.exe`** over the same installation
   (do not uninstall the old one first — this scenario is specifically
   about installing over an existing, working database).
5. Open Stockiha. **You should see** a new screen, different from the
   first-run setup screen, explaining that this version needs to update the
   shop's database, that a backup is taken and checked first, and that this
   is not optional — there should be **no Start button**; it should begin
   on its own the moment this screen appears.
6. **You should see** a checklist appear and update live, in front of you,
   through these steps: checking disk space and required programs, backing
   up the current database, checking that the backup can be used, updating
   the shop's tables, and checking that the update succeeded. **The window
   should never look frozen** while this runs, the same as Scenario 1.
7. This should finish within a minute or two for an ordinary shop database.
   **You should see** Stockiha restart itself and land on the sign-in
   screen, exactly like first-run setup does.
8. Sign in and find **`WS-K-5 UPGRADE TEST PRODUCT`** in the product list.
   **You should see it, unchanged.** This is the single most important
   check in this whole document — the update must never lose or alter data
   that already existed.
9. In File Explorer's address bar, paste
   `%APPDATA%\com.raqmenha.stockiha\backups` and press Enter. **You should
   see** a file whose name starts with `stockiha-preupgrade-` and ends in
   `.dump` — the backup this update took of your database before changing
   anything. Leave it there; it is kept on purpose.
10. Open `%APPDATA%\com.raqmenha.stockiha\upgrade.log` in Notepad
    (read-only). **You should see** a plain-language, timestamped line for
    every step in the checklist above, and — the same rule as `setup.log` —
    **you should never see anything that looks like a password** anywhere
    in this file.

### If something goes wrong during Scenario 7

This is hard to force on purpose, so only follow this if a real failure
happens.

- If the checklist ever shows a red/failed step, **you should see** a
  message that starts by saying plainly whether any data was lost (it
  should say it was not), that the previous version of Stockiha still
  works, and that you should contact your supplier — never a message that
  could be read as "your data may be gone."
- After a failed update, reopen the **older** Stockiha installer you used
  in step 1 (do not try `WS-K-5.1` again yet). **You should see** it start
  normally and your test product should still be there — the failed update
  must leave the database exactly as it was, usable by the old version
  again.
- The backup file from the failed attempt should still be in the `backups`
  folder from step 9 above — under a `backups\failed` subfolder specifically
  for a failed attempt's backup, which is never deleted automatically.

### For developers: producing a fresh TEST installer for a future release

`scripts\build-test-older-installer.ps1` automates exactly what produced
the installer named above: it temporarily hides the newest few migration
files, builds normally, names the result unmistakably, and puts everything
back — the repository is left exactly as committed either way, success or
failure. It does not change one line of the actual upgrade/backup/rollback
code; it only changes which migrations that one build embeds.

Run it from a clean checkout:

```powershell
powershell -File scripts\build-test-older-installer.ps1
```

It refuses to run if there are uncommitted changes to tracked files (so its
own restore step means something exact), and it refuses to hold out any
migration that grants `stockiha_runtime` access to `_sqlx_migrations` —
without that grant the TEST build could not even tell it was behind.

**Important limit, stated plainly:** once a real machine's database is
fully up to date with a shipped build — which is exactly where the Owner's
real machine now sits, at all 152 migrations — there is no way to make
that same, real installation exercise this path again except by installing
a genuinely newer build that adds new migrations of its own. A TEST
installer like the one above must only ever be used on a disposable
test machine or VM, pointed at a fresh, purpose-made app-data folder — it
must never be installed over, or point at, a real shop's actual database.

---

Report back which steps and scenarios matched "what you should see" and
which did not. For any mismatch, attach `%APPDATA%\com.raqmenha.stockiha\setup.log`
and, for Scenario 7, `%APPDATA%\com.raqmenha.stockiha\upgrade.log` too, if
they exist (never attach `database.json` itself, since it holds real
database credentials) — both log files are designed to be read by someone
who is not a developer, and are guaranteed not to contain any password.
