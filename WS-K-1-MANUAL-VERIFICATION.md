# WS-K-1 manual verification — clean Windows VM script

Follow these steps in order on the clean Windows VM. Each step tells you
exactly what to do, what you should see, and what it means if you see
something different. You do not need to know anything about databases or
programming to follow this.

You will need:
- The built Stockiha app (the `.exe`, not `npm run tauri dev`) copied to the VM.
- Notepad (built into Windows).
- File Explorer.

Throughout, "the app's data folder" means:
`%LOCALAPPDATA%\com.stockiha.app` (or whatever the installer's app
identifier resolves to — File Explorer's address bar accepts
`%LOCALAPPDATA%` directly; paste it in and press Enter, then look for a
`Stockiha`-named folder. If several exist, it's the one Stockiha's own
error screen names in step 1's technical details).

---

## Step 1 — Not set up yet

1. Make sure there is **no** `database.json` file anywhere under the app's
   data folder, and make sure no PostgreSQL-related environment variable is
   set (a clean VM already satisfies this).
2. Double-click the Stockiha app to launch it.
3. **You should see:** a screen titled "Not set up yet" explaining that
   Stockiha hasn't been given the shop's database connection details, with a
   "Retry" button.
4. **If you see something else** (e.g. the app just closes, or shows a
   different title): stop here and report exactly what you saw — this is
   the first thing to get working.

---

## Step 2 — Settings file problem (damaged file)

1. Close the app if it's open.
2. Go to the app's data folder (see above). Create a new text file named
   exactly `database.json` (make sure Windows doesn't add a hidden `.txt` —
   in File Explorer, enable "File name extensions" under the View tab to
   check).
3. Open it in Notepad and type: `not valid json at all`. Save and close.
4. Launch the app.
5. **You should see:** a screen titled "Settings file problem" saying the
   database settings could not be read.
6. **If you see something else:** note it and continue — this step is lower
   priority than Steps 1, 6, and 7.

---

## Step 3 — Database is not running

1. Close the app.
2. Edit `database.json` (from Step 2) so it contains exactly this (adjust
   the values only if your supplier gave you different ones — otherwise use
   these placeholder values as-is):
   ```json
   {"host":"127.0.0.1","port":59999,"database":"stockiha_shop","user":"stockiha_runtime","password":"placeholder"}
   ```
   (Port `59999` is deliberately a port nothing is listening on.)
3. Save and launch the app.
4. **You should see:** a screen titled "Database is not running", saying
   Stockiha cannot reach the database on this computer.
5. **If you see something else:** report it — this is one of the most
   important states, since it's the most likely real-world failure on a
   client machine that has no PostgreSQL installed at all yet.

---

## Step 4 — Database rejected the connection (only if PostgreSQL is actually installed and running on this VM)

Skip this step if this VM has no PostgreSQL installed — it needs a real,
running PostgreSQL server to test against.

1. Edit `database.json` so `host`/`port`/`database` point at your real,
   running PostgreSQL server, but set `"password"` to something wrong, e.g.
   `"definitely-wrong"`.
2. Launch the app.
3. **You should see:** a screen titled "Database rejected the connection".
4. **If you see something else:** report it.

---

## Step 5 — Database not found (only if PostgreSQL is installed and running)

1. Edit `database.json` so the connection details are otherwise correct
   (right host/port/password) but set `"database"` to a name that does not
   exist, e.g. `"stockiha_does_not_exist"`.
2. Launch the app.
3. **You should see:** a screen titled "Database not found".
4. **If you see something else:** report it.

---

## Step 6 — Retry works without restarting

1. While the app is showing any of the error screens above (Step 1 is the
   easiest to use for this), leave the app open.
2. Fix the underlying problem (for Step 1: create a valid `database.json`
   pointing at a real, running, already-set-up database; ask your supplier
   for exact values if you don't have a test database).
3. **Without closing the app**, click the "Retry" button on the error
   screen.
4. **You should see:** the app either reaches the sign-in screen / first-run
   setup, or shows a different, more specific error screen reflecting the
   next problem in the chain (e.g. it may now show "Database is empty" if
   the database exists but hasn't been set up with Stockiha's data yet —
   that's expected and correct, and it is itself proof Retry worked).
5. **If the app does nothing when you click Retry, or if you have to close
   and reopen the app to make progress:** this is a real problem — report
   it. Retry working without a restart is one of the most important
   requirements of this task.

---

## Step 7 — The technical details never show your password

1. On any of the error screens above, look for a small "Technical details"
   line — click it to expand it.
2. **You should see:** a short code (like `CONNECT_REFUSED`) and a sentence
   naming a host/port/database, but **never** the word `password` and
   **never** the actual password value you typed into `database.json`.
3. **If you ever see a password appear anywhere on screen** — in the main
   message, in the technical details, or anywhere else — **stop
   immediately and report this as an urgent problem.** This must never
   happen; if it does, the fix in this task did not work correctly.

---

## Step 8 — the config-file permission warning (needs the Owner or a developer's help to fully verify)

This one is harder to trigger on your own — it requires deliberately
loosening `database.json`'s Windows file permissions (right-click the file
→ Properties → Security → Edit → grant "Everyone" or "Authenticated Users"
read access), then launching the app with a database.json that actually
works (i.e., a fully valid, correct configuration).

1. If you're able to do this: after loosening the permissions and using a
   *working* `database.json`, launch the app and sign in (or reach the
   dashboard).
2. **You should see:** the app works completely normally, but with a
   yellow/orange banner near the top of the screen saying the database
   settings file can be read by other users of this computer.
3. **This must never stop you from using the app.** If the app fails to
   start or refuses to let you past this point because of the loosened
   permissions, that is a bug — report it immediately, since this warning
   was deliberately designed to never block the shop from opening.
4. If you're not comfortable changing file permissions, skip this step and
   note that it needs separate verification by a developer.

---

Report back which steps matched "what you should see" and which did not,
with a screenshot for any mismatch if possible.
