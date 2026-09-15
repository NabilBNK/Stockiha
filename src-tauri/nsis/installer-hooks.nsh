; WS-K-6 — defense in depth against the real-hardware NSIS failure:
; "Error opening file for writing: ...postgres\win64\bin\icudt77.dll",
; shown as the classic Abort/Retry/Ignore dialog a shop owner cannot
; safely evaluate.
;
; PRIMARY FIX lives in Rust (commands::update_shutdown::
; prepare_for_update_install), called from the frontend BEFORE the
; updater ever launches this installer: it stops the embedded PostgreSQL
; server and confirms these exact files are writable again, with a
; bounded wait. That is the real fix — this hook is the narrow,
; additional safety net for the residual, much smaller window between
; that check succeeding and this installer actually reaching its file
; copy (e.g. an antivirus scan starting in that gap).
;
; Deliberately NOT `SetOverwrite try`/`ifnewer`: the real generated
; installer.nsi (inspected directly, not assumed) never sets
; `SetOverwrite` anywhere, and NSIS_HOOK_PREINSTALL runs before EVERY
; file operation in the script, including the main application
; executable's own overwrite (`File "${MAINBINARYSRCPATH}"`, the very
; next instruction after this hook). A `SetOverwrite` mode set here would
; apply to that file too — turning a locked main .exe into a *silently
; skipped* update (the installer reports success while the app itself
; never actually changed), which is a worse failure than the one this
; hook exists to prevent. This hook therefore never touches
; `SetOverwrite` and only ever inspects the specific PostgreSQL support
; files already named by the real-hardware failure — never the app's own
; binary, which Tauri's own `CheckIfAppIsRunning` macro (the instruction
; immediately following this hook) already handles.
;
; Built entirely from NSIS core instructions (Rename/ClearErrors/IfErrors/
; Sleep/IntOp/IntCmp/MessageBox/Abort) — no third-party plugin, so nothing
; new to acquire or bundle. A file that can be renamed to itself has no
; process holding an incompatible handle on it (the same underlying
; Win32 sharing check `File`'s own overwrite would hit); one that cannot
; has exactly the condition that would otherwise show the generic
; dialog moments later.
!macro NSIS_HOOK_PREINSTALL
  Push $0
  Push $1
  StrCpy $1 "$INSTDIR\postgres\win64\bin\icudt77.dll"

  ; If this is a fresh install (the file does not exist yet), there is
  ; nothing to check — skip straight past the wait entirely.
  IfFileExists "$1" wsk6_check_lock wsk6_done

  wsk6_check_lock:
    StrCpy $0 0
    wsk6_retry_loop:
      ClearErrors
      Rename "$1" "$1"
      IfErrors 0 wsk6_done
      IntOp $0 $0 + 1
      IntCmp $0 20 wsk6_still_locked wsk6_wait wsk6_still_locked
      wsk6_wait:
        Sleep 250
        Goto wsk6_retry_loop

    wsk6_still_locked:
      MessageBox MB_OK|MB_ICONEXCLAMATION "Stockiha needs to finish closing before this update can install, but another program is still using its files.$\r$\n$\r$\nPlease make sure Stockiha is fully closed (check Task Manager if it does not close on its own), then run this installer again.$\r$\n$\r$\nNo changes have been made yet — the version you already have is untouched."
      Pop $1
      Pop $0
      Abort

  wsk6_done:
  Pop $1
  Pop $0
!macroend
