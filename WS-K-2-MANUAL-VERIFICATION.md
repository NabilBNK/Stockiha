# WS-K-2 manual verification — clean Windows VM script

Follow these in order on the clean Windows VM. Written for a non-developer:
what to do, what you should see, and what it means if you see something
else. You will need Administrator rights on the VM (the installer requires
elevation to register a Windows service).

Throughout, "the Stockiha data folder" means `C:\ProgramData\Stockiha\postgres`
(open File Explorer, paste that into the address bar).

---

## Scenario 1 — fresh install on a machine with no PostgreSQL at all

1. Confirm this VM has never had PostgreSQL installed: open Services
   (`services.msc`) and confirm there is no service with "postgres" in its
   name.
2. Install and launch Stockiha normally.
3. **You should see:** the app starts and reaches either the sign-in screen
   or the first-run setup screen — not an error screen.
4. Open the Stockiha data folder. **You should see:** a `data` folder and a
   file named `stockiha-instance.json`.
5. In File Explorer's address bar, paste `%LOCALAPPDATA%\com.raqmenha.stockiha`
   (Stockiha's own app-data folder). **You should see:** a file named
   `database.json`.
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
   nothing was lost. Ask your supplier for the one-line command to do this,
   or use the app itself: create one test product or one test category
   through the app's own screens, and remember its exact name (e.g.
   "ZZZ-TEST-DO-NOT-DELETE").
2. Re-run the Stockiha installer on this same VM (simulating a repair or
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
2. Now install Stockiha on this same VM.
3. **You should see:** Stockiha's own install still completes normally
   (scenario 1's checks all still apply), and the app works normally.
4. Open Services (`services.msc`). **You should see:** BOTH PostgreSQL
   services listed and running — the one you installed yourself, and
   "StockihaPostgreSQL" — with different names, and (if you check their
   properties) different port numbers.
5. Confirm the other PostgreSQL install still works exactly as it did
   before Stockiha was installed (open whatever tool you used to verify it
   originally).
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
2. **You should see:** "This folder doesn't exist" (or an empty/File Explorer
   error) — this path belongs only to the Owner's own development machine
   and must never appear on a client's computer.
3. **If this folder exists and contains anything:** report it — something
   used the wrong path.

---

Report back which scenarios matched "what you should see" and which did
not. For any mismatch, attach `C:\ProgramData\Stockiha\postgres\provisioning.log`
if it exists — it is designed to be read by someone who is not a developer.
