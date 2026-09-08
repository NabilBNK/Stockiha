# WS-K-3 manual verification — clean Windows VM script

This replaces the WS-K-2 manual verification document. That one tested
provisioning logic against a hand-run script — there was nothing to
actually double-click yet. This one starts from the real installer file,
exactly as a client will experience it.

Written for a non-developer: what to do, what you should see, and what it
means if you see something else. You will need Administrator rights on the
VM (installing requires elevation to register a Windows service).

---

## Step 0 — get the installer

1. The installer file is named **`Stockiha_0.1.0_x64-setup.exe`**.
2. Copy it onto the clean VM (USB drive, shared folder, or however you
   normally transfer files to it). Do not run it on your own working
   machine — always test on a clean VM first.
3. **You should see:** one file, roughly the size your supplier told you to
   expect (a few hundred MB — it contains a full copy of PostgreSQL).
4. Double-click it.
5. **You should see:** a single Windows "User Account Control" prompt
   asking to let Stockiha's installer make changes to this computer — this
   is normal and expected (installing a database service requires this).
   Click **Yes**. You should **not** see more than one such prompt during
   the whole install, and you should **never** see a black command-window
   or blue PowerShell window at any point, even briefly.
6. **You should see:** the normal Stockiha installer window, ending with a
   line saying either "Database setup complete." or a message explaining
   database setup did not complete. Either way, the installer itself should
   finish without crashing.
7. **If you ever see a black or blue console window flash on screen, even
   for under a second:** stop and report this exactly — it should never
   happen, and if it does, something needs fixing before this ships to a
   real client.

Everything below assumes Step 0 succeeded. Throughout, "the Stockiha data
folder" means `C:\ProgramData\Stockiha\postgres` (paste that into File
Explorer's address bar).

---

## Scenario 1 — fresh install on a machine with no PostgreSQL at all

1. Confirm this VM has never had PostgreSQL installed: open Services
   (`services.msc`) and confirm there is no service with "postgres" in its
   name, before you run the installer.
2. Run the installer (Step 0 above).
3. **You should see:** Stockiha itself opens afterward (or can be opened
   from the Start menu) and reaches either the sign-in screen or the
   first-run setup screen — not an error screen.
4. Open the Stockiha data folder. **You should see:** a `data` folder and a
   file named `stockiha-instance.json`.
5. In File Explorer's address bar, paste
   `%LOCALAPPDATA%\com.raqmenha.stockiha` (Stockiha's own app-data folder).
   **You should see:** a file named `database.json`.
6. Open `database.json` in Notepad (read-only — do not edit it). **You
   should see:** real-looking values for `host`, `port`, `database`,
   `user`, and a long random-looking `password` — never a short or
   obviously-fake value like `password123` or `CHANGE_ME`.
7. In Services (`services.msc`), find "StockihaPostgreSQL". **You should
   see:** its status is "Running" and its startup type is "Automatic".
8. **If any of the above is missing or different:** stop here and send the
   log file at `C:\ProgramData\Stockiha\postgres\provisioning.log` — it
   names exactly which step failed in plain language.

## Scenario 2 — re-running install / repair on the SAME machine, data must survive

1. **Before continuing**, put a test row in the database so you can prove
   nothing was lost. Create one test product or one test category through
   the app's own screens, and remember its exact name (e.g.
   "ZZZ-TEST-DO-NOT-DELETE").
2. Run the Stockiha installer again on this same VM (simulating a repair or
   reinstall).
3. **You should see:** the installer completes without any error, and the
   app still starts normally afterward.
4. Open the app and find the test product/category you created in step 1.
   **You should see:** it is still there, unchanged.
5. **If the test data is missing, or the installer asked to overwrite
   anything, or `database.json`'s password looks different from before:**
   stop immediately and do not repeat the test — this is a serious problem,
   report it exactly as you saw it.

## Scenario 3 — an unrelated, independent PostgreSQL already on the machine

1. On a **fresh** clean VM (not the one from scenarios 1–2), install any
   other PostgreSQL yourself first — any version, from postgresql.org or
   any other source, using its own default settings. Let it fully install
   and start.
2. Now run the Stockiha installer on this same VM.
3. **You should see:** Stockiha's own install still completes normally
   (Scenario 1's checks all still apply), and the app works normally.
4. Open Services (`services.msc`). **You should see:** BOTH PostgreSQL
   services listed and running — the one you installed yourself, and
   "StockihaPostgreSQL" — with different names, and (if you check their
   properties) different port numbers.
5. Confirm the other PostgreSQL install still works exactly as it did
   before Stockiha was installed.
6. **If either installation stopped working, if a service is missing, or if
   they ended up using the same port:** this is a serious problem — stop
   and report exactly what you see in Services.

## Scenario 4 — confirm PostgreSQL only listens on 127.0.0.1

1. Open a PowerShell window (does not need to be Administrator for this
   check).
2. Run this exact command:
   ```powershell
   Get-NetTCPConnection -State Listen | Where-Object { $_.OwningProcess -in (Get-Process postgres -ErrorAction SilentlyContinue).Id } | Select-Object LocalAddress, LocalPort
   ```
3. **You should see:** one or more rows, and every single one has
   `LocalAddress` equal to `127.0.0.1` (or `::1`). **You should never see**
   `0.0.0.0` or any other address.
4. **If you see `0.0.0.0` or any address other than 127.0.0.1/::1:** this
   means the database could be reachable from other computers on the same
   network — stop and report this immediately, it is a serious problem.

## Scenario 5 — nothing was written to the Owner's own dev path

1. In File Explorer's address bar, paste
   `%LOCALAPPDATA%\Stockiha\r8-acceptance` and press Enter.
2. **You should see:** "This folder doesn't exist" — this path belongs
   only to the Owner's own development machine and must never appear on a
   client's computer.
3. **If this folder exists and contains anything:** report it — something
   used the wrong path.

## Scenario 6 — uninstall does not delete your data

1. On the VM from Scenario 1 or 2 (with real data in it), open Windows
   Settings → Apps, find Stockiha, and uninstall it.
2. **You should see:** the uninstall completes normally.
3. Open Services (`services.msc`). **You should see:** "StockihaPostgreSQL"
   is gone.
4. Open the Stockiha data folder (`C:\ProgramData\Stockiha\postgres`).
   **You should see:** the `data` folder is still there, completely
   untouched — uninstalling Stockiha must never delete your shop's data.
5. **If the data folder is gone:** this is a severe problem — report it
   immediately, before this ships to any real client.

---

Report back which steps and scenarios matched "what you should see" and
which did not. For any mismatch, attach
`C:\ProgramData\Stockiha\postgres\provisioning.log` if it exists — it is
designed to be read by someone who is not a developer.
