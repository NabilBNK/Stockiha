@echo off
title Stockiha Development Runner

echo Ensuring workspace is on branch task/r0-004-historical-line-party-benefit...
git checkout task/r0-004-historical-line-party-benefit 2>nul || git checkout r0-004-historical-line-party-benefit 2>nul

echo Terminating any existing running Stockiha instance and freeing port 1420...
taskkill /F /IM stockiha.exe /IM stockiha-backend.exe /IM tauri.exe /IM cargo.exe 2>nul
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :1420') do taskkill /F /PID %%a 2>nul
ping 127.0.0.1 -n 2 >nul

set "CARGO_BIN=%USERPROFILE%\.cargo\bin"
set "PATH=C:\Program Files\PostgreSQL\18\bin;C:\BuildTools\VC\Tools\MSVC\14.44.35207\bin\Hostx64\x64;C:\Program Files (x86)\Windows Kits\10\bin\10.0.22621.0\x64;%CARGO_BIN%;%PATH%"
set "INCLUDE=C:\BuildTools\VC\Tools\MSVC\14.44.35207\include;C:\Program Files (x86)\Windows Kits\10\Include\10.0.22621.0\ucrt;C:\Program Files (x86)\Windows Kits\10\Include\10.0.22621.0\shared;C:\Program Files (x86)\Windows Kits\10\Include\10.0.22621.0\um;C:\Program Files (x86)\Windows Kits\10\Include\10.0.22621.0\winrt;C:\Program Files (x86)\Windows Kits\10\Include\10.0.22621.0\cppwinrt"
set "LIB=C:\BuildTools\VC\Tools\MSVC\14.44.35207\lib\x64;C:\Program Files (x86)\Windows Kits\10\Lib\10.0.22621.0\ucrt\x64;C:\Program Files (x86)\Windows Kits\10\Lib\10.0.22621.0\um\x64;%LIB%"

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
if %errorlevel% neq 0 (
    echo Frontend compilation failed!
    exit /b %errorlevel%
)

echo Compiling Rust backend binary...
cargo build --manifest-path src-tauri/Cargo.toml
if %errorlevel% neq 0 (
    echo Backend compilation failed!
    exit /b %errorlevel%
)

echo ========================================================
echo Stockiha compiled successfully. Launching Tauri dev...
echo ========================================================

call npm run tauri dev
if %errorlevel% neq 0 (
    echo Stockiha Tauri launch failed!
    exit /b %errorlevel%
)
