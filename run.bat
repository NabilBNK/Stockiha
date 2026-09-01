@echo off
title Stockiha Development Runner
setlocal enabledelayedexpansion

REM ============================================================
REM  Stockiha - Deterministic & Safe Development Runner
REM  Double-click or run from any terminal in the repo root.
REM ============================================================

echo ========================================================
echo  Stockiha Development Runner
echo ========================================================

REM ---- Step 1: Clean up previous dev processes for this worktree ----
echo Stopping previous dev processes associated with this worktree...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\cleanup-dev-processes.ps1"
if errorlevel 1 (
    echo.
    echo  ERROR: cleanup-dev-processes.ps1 failed.
    echo.
    pause
    exit /b 1
)

REM ---- Build-tool environment paths ----
set "CARGO_BIN=%USERPROFILE%\.cargo\bin"
set "PATH=C:\Program Files\PostgreSQL\18\bin;C:\BuildTools\VC\Tools\MSVC\14.44.35207\bin\Hostx64\x64;C:\Program Files (x86)\Windows Kits\10\bin\10.0.22621.0\x64;%CARGO_BIN%;%PATH%"
set "INCLUDE=C:\BuildTools\VC\Tools\MSVC\14.44.35207\include;C:\Program Files (x86)\Windows Kits\10\Include\10.0.22621.0\ucrt;C:\Program Files (x86)\Windows Kits\10\Include\10.0.22621.0\shared;C:\Program Files (x86)\Windows Kits\10\Include\10.0.22621.0\um;C:\Program Files (x86)\Windows Kits\10\Include\10.0.22621.0\winrt;C:\Program Files (x86)\Windows Kits\10\Include\10.0.22621.0\cppwinrt"
set "LIB=C:\BuildTools\VC\Tools\MSVC\14.44.35207\lib\x64;C:\Program Files (x86)\Windows Kits\10\Lib\10.0.22621.0\ucrt\x64;C:\Program Files (x86)\Windows Kits\10\Lib\10.0.22621.0\um\x64;%LIB%"

set "SECRET_ROOT=%LOCALAPPDATA%\Stockiha\r8-acceptance"

REM ---- WS-H-2 (Task 3): capture a full run log -------------------------------
REM The PostgreSQL backend crash seen during acceptance left almost no evidence:
REM the cluster runs with logging_collector=off, and the app's own tracing
REM subscriber defaults to "warn" with nothing capturing stdout. Every run now
REM writes a complete, timestamped transcript to logs\ (gitignored) while the
REM console keeps showing only progress, warnings, and errors.
if not exist "%~dp0logs" mkdir "%~dp0logs"
for /f "usebackq delims=" %%T in (`powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"`) do set "RUN_STAMP=%%T"
set "STOCKIHA_LOG_FILE=%~dp0logs\stockiha-%RUN_STAMP%.log"

REM RUST_LOG governs what the app emits at all; the console filter below decides
REM what is shown. Detail goes to the file, so raise the app's own level here
REM rather than leaving it at the built-in "warn" default.
if not defined RUST_LOG set "RUST_LOG=warn,stockiha_backend=debug"

echo ========================================================
echo  Run log: %STOCKIHA_LOG_FILE%
echo  RUST_LOG: %RUST_LOG%
echo ========================================================


REM ---- Step 2: Ensure PostgreSQL is running on port 5433 ----
echo.
echo [1/5] Ensuring PostgreSQL is accepting connections on port 5433...

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\ensure-postgres.ps1"
if errorlevel 1 (
    echo.
    echo  ERROR: Failed to ensure PostgreSQL is running on port 5433.
    echo.
    pause
    exit /b 1
)

REM ---- Step 3: Run SQLx migrations ----
echo.
echo ========================================================
echo  [2/5] Running SQLx migrations...
echo ========================================================
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\run-sqlx-migrations.ps1"
if errorlevel 1 (
    echo.
    echo  ERROR: Database migrations failed.
    echo.
    pause
    exit /b 1
)

if not defined STOCKIHA_BACKUP_ROOT set "STOCKIHA_BACKUP_ROOT=C:\Stockiha-R6-SQLx-Final-Acceptance"
if not defined STOCKIHA_PG_DUMP_PATH set "STOCKIHA_PG_DUMP_PATH=C:\Program Files\PostgreSQL\18\bin\pg_dump.exe"
if not defined STOCKIHA_PG_RESTORE_PATH set "STOCKIHA_PG_RESTORE_PATH=C:\Program Files\PostgreSQL\18\bin\pg_restore.exe"

REM ---- WS-H-1 (G2): resolve the restore-verification admin connection the ----
REM ---- same way STOCKIHA_DEV_DATABASE_URL is resolved below from runtime.key.
REM ---- Optional: the "Verify temporary restore" feature is unreachable
REM ---- without it, but its absence must not block the rest of the app.
if not defined STOCKIHA_RESTORE_ADMIN_DATABASE_URL if exist "%SECRET_ROOT%\admin.key" (
    for /f "usebackq delims=" %%A in (`powershell -NoProfile -Command "$pw = (Get-Content -LiteralPath '%SECRET_ROOT%\admin.key' -Raw).Trim(); if ([string]::IsNullOrWhiteSpace($pw)) { exit 0 }; $enc = [System.Uri]::EscapeDataString($pw); Write-Output ('postgres://stockiha_admin:' + $enc + '@127.0.0.1:5433/postgres?sslmode=disable')"`) do set "STOCKIHA_RESTORE_ADMIN_DATABASE_URL=%%A"
)

REM ---- Step 4: Read database credentials and build DB URL ----
echo.
echo ========================================================
echo [4/5] Checking database credentials and building URL...
echo ========================================================

if not exist "%SECRET_ROOT%\runtime.key" (
    echo.
    echo  ERROR: runtime.key not found.
    echo.
    echo  Expected location: %SECRET_ROOT%\runtime.key
    echo  This file must contain the password for the stockiha_runtime
    echo  PostgreSQL role on port 5433.
    echo.
    pause
    exit /b 1
)

for /f "usebackq delims=" %%V in (`powershell -NoProfile -Command "(Get-Content -LiteralPath '%SECRET_ROOT%\runtime.key' -Raw).Trim()"`) do set "STOCKIHA_RUNTIME_PW=%%V"

if not defined STOCKIHA_RUNTIME_PW (
    echo.
    echo  ERROR: runtime.key exists but is empty.
    echo.
    pause
    exit /b 1
)

for /f "usebackq delims=" %%U in (`powershell -NoProfile -Command "$pw = (Get-Content -LiteralPath '%SECRET_ROOT%\runtime.key' -Raw).Trim(); $enc = [System.Uri]::EscapeDataString($pw); Write-Output ('postgres://stockiha_runtime:' + $enc + '@127.0.0.1:5433/stockiha_acceptance?sslmode=disable')"`) do set "STOCKIHA_DEV_DATABASE_URL=%%U"

if not defined STOCKIHA_DEV_DATABASE_URL (
    echo.
    echo  ERROR: Failed to build database URL from runtime.key.
    echo.
    pause
    exit /b 1
)

echo  [OK] Credentials loaded.
if defined STOCKIHA_RESTORE_ADMIN_DATABASE_URL (
    echo  [OK] Restore-verification admin connection resolved.
) else (
    echo  [WARN] Restore-verification admin connection NOT resolved -- the
    echo         "Verify temporary restore" feature will be unavailable this run.
)

REM ---- Step 5: Build frontend and backend, then launch Tauri dev ----
echo.
echo ========================================================
echo  [4/5] Compiling Stockiha (Tauri v2 + React 19)
echo ========================================================
echo  Backup Root : %STOCKIHA_BACKUP_ROOT%
echo ========================================================

echo  Building frontend production bundle...
call npm run build
if errorlevel 1 (
    echo.
    echo  ERROR: Frontend build failed. See output above for details.
    echo.
    pause
    exit /b 1
)

echo  Building Rust backend binary...
call cargo build --manifest-path src-tauri/Cargo.toml
if errorlevel 1 (
    echo.
    echo  ERROR: Rust backend build failed. See output above for details.
    echo.
    pause
    exit /b 1
)

echo.
echo ========================================================
echo  [5/5] Launching Tauri dev window...
echo ========================================================
echo  Database: postgres://stockiha_runtime@127.0.0.1:5433/stockiha_acceptance
echo  Run log : %STOCKIHA_LOG_FILE%
echo ========================================================
echo.

REM The full transcript (including every SQLx/tracing line RUST_LOG lets
REM through) goes to the log file; the console shows build progress plus
REM anything that looks like a warning, an error, or one of the app's own
REM bracketed startup diagnostics. Note that after a pipe cmd's ERRORLEVEL
REM reports PowerShell's exit status rather than npm's, so the launch result
REM is reported from the transcript instead of being tested here.
call npm run tauri dev 2>&1 | powershell -NoProfile -Command "$input | Tee-Object -FilePath '%STOCKIHA_LOG_FILE%' -Append | Where-Object { $_ -match '(?i)error|warn|panic|fatal|\[DB_STARTUP\]|\[DB_POSTING_ERROR\]|\[RECOVERY_STARTUP\]|\[RESTORE_CLEANUP\]|Compiling |Finished |Running |Local:' }"

echo.
echo ========================================================
echo  Session ended. Full transcript:
echo  %STOCKIHA_LOG_FILE%
echo ========================================================
pause
