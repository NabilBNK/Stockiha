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
echo ========================================================
echo.

call npm run tauri dev
if errorlevel 1 (
    echo.
    echo  ERROR: Tauri dev launch exited with an error. See output above.
    echo.
    pause
    exit /b 1
)
