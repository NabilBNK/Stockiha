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
