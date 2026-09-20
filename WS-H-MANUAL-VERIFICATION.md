# WS-H — Manual Windows Acceptance

Before each round: build the installer yourself (`npm run tauri:build`), install it, and check the version text on the screen shows the right `WS-H-x.y` marker. Paste every result (screenshots welcome) back to Claude without editing.

## §M3 — after WS-H-3

1. Log in as admin → Settings → the "Backup and recovery" card is there and shows a folder path with the note "Default folder…".
2. Click "Create backup now" (or "Create backup"). Wait. You should see a green success message and a status line "Last successful backup: today …".
3. Open that folder in File Explorer. There is a new folder named `GestStock-Backup-…`. Open its `manifest.json` with Notepad and check it contains `"bundle_format_version":2` and `"backup_kind":"MANUAL"`.
4. Copy that backup folder by hand to a USB stick. In Stockiha click Browse (validate), choose the USB copy, click Validate → success.
5. On the USB copy, open `database.dump` with Notepad, change one character, save. Validate again → it must fail.
6. Close Stockiha. In Task Manager, no "PostgreSQL" process should remain. No black window should have appeared at any point.
7. Change the backup folder to a folder on another drive (or USB). Then try to choose the Stockiha installation folder → it must be refused.
8. Log in as a cashier → Settings → the backup card must not be visible.

## §M4 — after WS-H-4

1. Log in as admin → Settings → "Backup and recovery". Create two or three backups (click "Create backup" a few times). The "Your backups" table below must list them, newest first, with Date, Type, Size (e.g. "4.0 KB"), Version status ("Current"), and Actions (Check / Test / Copy to…).
2. Click "Check" on a row → a validation result grid appears under the list, headed by that row's date, showing "Backup integrity verified." No "Restore…" button should appear anywhere in this list (that is WS-H-5).
3. Click "Copy to…" on a row, pick a folder on a USB stick or another drive → a success message names the copied path, and the copied folder appears on the USB stick with the same files as the original.
4. In Settings → Advanced, confirm "Temporary restore verification enabled" is checked (default). Click "Test" on a row → a dialog "Test this backup?" appears explaining a temporary database will be created and deleted. Click "Start test". Wait — this can take a couple of minutes on a real database. A result grid appears with "Server stopped: Yes", "Journals balanced: Balanced", and the control totals.
5. While the test above is running, open a second window/tab of Stockiha (or just keep working in another screen) and confirm the app keeps responding normally — the live database must not freeze or disconnect during the test.
6. After the test finishes, open Task Manager: no extra `postgres.exe` process should remain running, and in `%LOCALAPPDATA%\<app data>\` there must be no leftover `restore-drill-…` folder.
7. In Settings → Advanced, turn OFF "Temporary restore verification enabled". Back in "Your backups", the "Test" button must disappear from every row, replaced by the note "Backup testing is turned off in Advanced."
8. Click "Open a backup from another folder…", pick a `GestStock-Backup-…` folder copied earlier to a USB stick → it is validated and appears in a separate "Selected backup" one-row table with the same Check/Test/Copy actions.
9. Restart Stockiha immediately after force-closing it during a "Test" run (Task Manager → End Task while the dialog says the test is running). On the next launch, check Task Manager after a few seconds: no orphaned `postgres.exe` from the test should remain, and any leftover `restore-drill-…` folder from the killed run must be gone (Stockiha removes it automatically at startup).
10. Log in as a cashier → Settings → the backup card must still not be visible.

## §M5 — after WS-H-5 (real restore — this changes your live data; use a test PC or accept the risk)

**Before you start:** make sure you already have at least one backup, and know it is safe to lose everything recorded since that backup.

1. Log in as admin → Settings → "Backup and recovery" → "Your backups". A row now has a red "Restore…" button in addition to Check/Test/Copy to….
2. Record a sale or make some other visible change (a product, a customer — anything you'll recognize later), then click "Restore…" on a backup taken *before* that change. A dialog "Replace your data with this backup?" appears listing the backup's date and type, with a warning that everything recorded after that date will be removed, and that Stockiha will restart at the end.
3. Try to click "Restore now" immediately — it must be disabled. Check the "I understand…" box but leave the text field empty — still disabled. Type `restore` (lowercase) — still disabled. Type `RESTORE` (exact capitals) — the button becomes enabled.
4. Open a cash session (Sales → open the drawer / start a session), then go back and try the same dialog. It must show "Close the open cash session before restoring." and "Restore now" must stay disabled no matter what you type. Close the cash session before continuing.
5. Click "Cancel" — nothing happens, you're back at the backup list, and no restore starts.
6. Now actually confirm a restore (checkbox + `RESTORE` + "Restore now"). The whole window changes to a restore progress screen — no menu, no way to navigate away. Watch the checklist advance: Checking the backup → Preliminary checks → Testing the restore → Safety copy → Closing connections → Replacing data → (Updating the schema, only if the backup was older) → Verifying → Restoring files → Recording. This can take a few minutes on a real-sized database — that is expected, not a freeze.
7. Stockiha restarts itself automatically. Log back in: the change you made in step 2 (the sale, the product, whatever you recorded) is **gone**, matching the older backup.
8. Go back to "Your backups" — a new backup dated right before the restore now appears, of type "Before restore". Restore *that* one. After it finishes and Stockiha restarts, the change from step 2 is back.
9. Open Task Manager immediately after any restore finishes: exactly one Stockiha-owned `postgres.exe` process group should be running (the live server) — no extra one left over from the restore's internal test or safety steps.
10. **New-PC restore:** on a second PC (or after uninstalling and reinstalling Stockiha on the same one, wiping its data folder first), run the installer, and on the very first screen click "Restore from a backup instead" below the setup form. Choose a backup folder from a USB stick — a preview shows its date, type, and size. Check "I understand this installation will use the data from this backup," click "Restore," and wait through the same progress screen. Stockiha restarts to the **login screen** (not the setup form) — log in with the old admin username and password from the original PC; the products, customers, and balances should match what was on the original PC when that backup was made.
11. On that same first-run screen, confirm "Restore from a backup instead" only appears when running the installed embedded build — it should not appear if somehow pointed at a developer database.
12. If you deliberately unplug the USB drive or kill Stockiha mid-restore (only do this once you're prepared to contact support if something goes wrong): the screen should show one of "stopped before anything changed," "restored to the same state as before," or — worst case — a red screen naming an error code, a safety-backup path, and a log path, with a "Copy details" button. If you ever see that red screen, follow its instructions and contact your supplier with the copied text rather than trying to fix it yourself.

## §M6 — after WS-H-6 (automatic backups)

1. Installing an update from the banner shows "Saving a safety backup before updating…" before it installs, and after the restart a "Before update" backup is in the list.
2. With the backup folder set to an unplugged USB drive, an update still installs and the new "Before update" backup is in the default folder.
3. If the backup cannot be made at all, the update is NOT installed and the banner explains why; the app keeps working.
4. About a minute after the first login of the day, a "Daily automatic" backup appears in the list.
5. Logging out and in again the same day does not create a second daily backup.
6. After more than 14 daily backups exist, only the newest 14 remain; manual backups are never removed.
7. An admin with no backup for 7 days sees the warning banner with a working button to the backup settings.
