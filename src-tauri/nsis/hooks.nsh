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
;
; WS-K-3.3 hotfix, TWO bugs fixed here, both confirmed by reading the
; ACTUAL generated installer.nsi/utils.nsh from a real `tauri build`, not
; guessed:
;
;   1. Provision-StockihaPostgres.ps1 crashed on its very first line on the
;      Owner's real machine: $PSScriptRoot was empty under this exact
;      nsExec + `powershell.exe ... -File` invocation, so its old
;      $PSScriptRoot-relative default for -PostgresBinDir crashed
;      Join-Path immediately. Fixed by never letting the script derive its
;      own location at all: every path it needs is now a REQUIRED
;      parameter (no default), computed here from $INSTDIR, which this
;      hook already knows with total precision. Confirmed separately that
;      the OLD relative math ('..\..\resources\postgres\win64') was ALSO
;      wrong independent of $PSScriptRoot being empty: both the script and
;      win64\ land under $INSTDIR\postgres\ per tauri.conf.json's
;      bundle.resources mapping, making win64 a SIBLING of the script, not
;      two directories above $INSTDIR. Two independent bugs, both fixed by
;      the same change.
;
;   2. $APPDATA, used unqualified, resolved to the WRONG folder for this
;      perMachine install. utils.nsh's SetContext macro (called from
;      .onInit, before any hook runs) sets `SetShellVarContext all` for
;      installMode=perMachine — which redirects $APPDATA to the ALL-USERS
;      application-data tree, not the per-CURRENT-USER Roaming AppData
;      folder Tauri's own `app_data_dir()` reads from at runtime
;      (confirmed by reading tauri-2.11.5's own source:
;      `path/desktop.rs::app_data_dir` = `dirs::data_dir()` =
;      `FOLDERID_RoamingAppData`, always resolved for the current process's
;      user token, with NO "all users" variant). Left uncorrected, this
;      would write database.json to a folder the running app never reads
;      from, on every single perMachine install — deterministic, not an
;      edge case. Fixed by switching to `SetShellVarContext current` just
;      long enough to resolve $APPDATA, then switching back to `all` so
;      nothing else in this installer (which may rely on the all-users
;      context for shortcuts/registry) is affected.

Var StockihaAppDataDir

!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "Setting up your database..."

  SetShellVarContext current
  StrCpy $StockihaAppDataDir "$APPDATA\com.raqmenha.stockiha"
  SetShellVarContext all

  ; $INSTDIR\postgres\Provision-StockihaPostgres.ps1,
  ; $INSTDIR\postgres\win64\, and $INSTDIR\stockiha-backend.exe — see
  ; tauri.conf.json's bundle.resources for the first two; the app's own
  ; binary is always installed directly at $INSTDIR by Tauri itself.
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "$INSTDIR\postgres\Provision-StockihaPostgres.ps1" -PostgresBinDir "$INSTDIR\postgres\win64" -StockihaExePath "$INSTDIR\stockiha-backend.exe" -AppDataDir "$StockihaAppDataDir"'
  Pop $0
  ${If} $0 != 0
    DetailPrint "Database setup did not complete (exit code $0). Stockiha will explain what to do the first time it starts."
  ${Else}
    DetailPrint "Database setup complete."
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DetailPrint "Removing the Stockiha database service (your data will not be deleted)..."
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "$INSTDIR\postgres\Uninstall-StockihaPostgres.ps1" -PostgresBinDir "$INSTDIR\postgres\win64"'
  Pop $0
!macroend
