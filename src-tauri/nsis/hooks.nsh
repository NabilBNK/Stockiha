; WS-K-3 — Stockiha NSIS installer hooks.
;
; Wired via tauri.conf.json's bundle.windows.nsis.installerHooks. Tauri's
; NSIS template calls these macros at the corresponding points in the
; generated installer/uninstaller script.
;
; ELEVATION (K3-3): requested once, at installer start, via
; bundle.windows.nsis.installMode = "perMachine" in tauri.conf.json — that
; setting is what makes Tauri emit `RequestExecutionLevel admin` in the
; generated .nsi, which triggers Windows' own UAC prompt before the
; installer's UI even opens. Nothing in this file requests elevation itself;
; every step below already runs elevated because the whole installer does.
;
; ZERO VISIBLE WINDOW (K3-2): every PowerShell invocation below uses BOTH
; the `nsExec::ExecToLog` plugin (which creates the child process with its
; window state set to hidden from the moment of creation, and redirects its
; stdout/stderr into a pipe NSIS reads and writes to its own install log —
; not a console window) AND PowerShell's own `-WindowStyle Hidden` flag,
; deliberately redundant: `nsExec` alone is the documented, bulletproof
; mechanism (no window is ever created to begin with, so there is nothing to
; flash before hiding); `-WindowStyle Hidden` is kept as a second, cheap
; layer in case a future edit ever calls this command line through a plain
; `ExecWait` instead. Plain `ExecWait` with only `-WindowStyle Hidden` is
; the known-fragile combination (a window can flash before PowerShell hides
; it) and is never used here.

!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "Setting up your database..."

  ; $INSTDIR\postgres\Provision-StockihaPostgres.ps1 — see tauri.conf.json's
  ; bundle.resources. $APPDATA here is NSIS's own per-machine APPDATA
  ; constant, which for a perMachine install resolves under the installing
  ; (admin) user's profile at install time — matching what Tauri's
  ; app_data_dir() resolves for identifier "com.raqmenha.stockiha" at
  ; runtime for that same user. If the shop's Stockiha operator account
  ; differs from the installing admin account, this is a known follow-up
  ; (see the WS-K-3 report's "known gaps" note) — out of scope to solve
  ; here, since the Owner-confirmed deployment shape is one shop, one
  ; computer, one operator account.
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "$INSTDIR\postgres\Provision-StockihaPostgres.ps1" -AppDataDir "$APPDATA\com.raqmenha.stockiha"'
  Pop $0
  ${If} $0 != 0
    DetailPrint "Database setup did not complete (exit code $0). Stockiha will explain what to do the first time it starts."
  ${Else}
    DetailPrint "Database setup complete."
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DetailPrint "Removing the Stockiha database service (your data will not be deleted)..."
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "$INSTDIR\postgres\Uninstall-StockihaPostgres.ps1"'
  Pop $0
!macroend
