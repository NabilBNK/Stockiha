@echo off
title Stockiha Development Runner

echo Ensuring workspace is on branch agent/enhance-historical-finance-analytics...
git checkout agent/enhance-historical-finance-analytics 2>nul || git checkout -b agent/enhance-historical-finance-analytics origin/agent/enhance-historical-finance-analytics 2>nul

echo Terminating any existing running Stockiha instance and freeing port 1420...
taskkill /F /IM stockiha.exe /IM stockiha-backend.exe /IM tauri.exe /IM cargo.exe /IM node.exe 2>nul
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :1420') do taskkill /F /PID %%a 2>nul
ping 127.0.0.1 -n 2 >nul

set "CARGO_BIN=%USERPROFILE%\.cargo\bin"
set "PATH=C:\Program Files\PostgreSQL\18\bin;C:\BuildTools\VC\Tools\MSVC\14.44.35207\bin\Hostx64\x64;C:\Program Files (x86)\Windows Kits\10\bin\10.0.22621.0\x64;%CARGO_BIN%;%PATH%"
set "INCLUDE=C:\BuildTools\VC\Tools\MSVC\14.44.35207\include;C:\Program Files (x86)\Windows Kits\10\Include\10.0.22621.0\ucrt;C:\Program Files (x86)\Windows Kits\10\Include\10.0.22621.0\shared;C:\Program Files (x86)\Windows Kits\10\Include\10.0.22621.0\um;C:\Program Files (x86)\Windows Kits\10\Include\10.0.22621.0\winrt;C:\Program Files (x86)\Windows Kits\10\Include\10.0.22621.0\cppwinrt"
set "LIB=C:\BuildTools\VC\Tools\MSVC\14.44.35207\lib\x64;C:\Program Files (x86)\Windows Kits\10\Lib\10.0.22621.0\ucrt\x64;C:\Program Files (x86)\Windows Kits\10\Lib\10.0.22621.0\um\x64;%LIB%"

if exist "%LOCALAPPDATA%\Stockiha\r8-acceptance\runtime.key" (
    set /p STOCKIHA_RUNTIME_PW=<"%LOCALAPPDATA%\Stockiha\r8-acceptance\runtime.key"
)

if defined STOCKIHA_RUNTIME_PW (
    echo Ensuring PostgreSQL service is active on port 55433...
    powershell -NoProfile -Command "$ready = & 'C:\Program Files\PostgreSQL\18\bin\pg_isready.exe' -h 127.0.0.1 -p 55433 2>&1; if ($ready -notlike '*accepting connections*') { & 'C:\Program Files\PostgreSQL\18\bin\pg_ctl.exe' start -D '$env:LOCALAPPDATA\Stockiha\r8-acceptance\data-55433' -l '$env:LOCALAPPDATA\Stockiha\r8-acceptance\postgres-55433.log' -w }" >nul 2>&1
    set "STOCKIHA_DEV_DATABASE_URL=postgres://stockiha_runtime:%STOCKIHA_RUNTIME_PW%@127.0.0.1:55433/stockiha_r8_acceptance_20260808165143_test?sslmode=disable"
)

if not defined STOCKIHA_DEV_DATABASE_URL (
    echo ERROR: STOCKIHA_DEV_DATABASE_URL is not configured.
    echo Configure it in the Windows user environment or an untracked local shell before running this script.
    exit /b 1
)

if not defined STOCKIHA_BACKUP_ROOT set "STOCKIHA_BACKUP_ROOT=C:\Stockiha-R6-SQLx-Final-Acceptance"
if not defined STOCKIHA_PG_DUMP_PATH set "STOCKIHA_PG_DUMP_PATH=C:\Program Files\PostgreSQL\18\bin\pg_dump.exe"

echo ========================================================
echo Compiling Stockiha (Tauri v2 + React 19)
echo ========================================================
echo Database configuration: external environment
echo Backup Root: %STOCKIHA_BACKUP_ROOT%
echo ========================================================

echo Compiling frontend production bundle...
call npm run build
if errorlevel 1 (
    echo Frontend compilation failed!
    exit /b 1
)

echo Compiling Rust backend binary...
cargo build --manifest-path src-tauri/Cargo.toml
if errorlevel 1 (
    echo Backend compilation failed!
    exit /b 1
)

echo ========================================================
echo Stockiha compiled successfully. Launching Tauri dev...
echo ========================================================

call npm run tauri dev
if errorlevel 1 (
    exit /b 0
)
