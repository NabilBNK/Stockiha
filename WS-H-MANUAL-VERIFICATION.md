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
