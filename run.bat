@echo off
title Stockiha Development Runner
setlocal enabledelayedexpansion

echo ========================================================
echo Starting Stockiha Development Environment
echo ========================================================

echo Terminating any existing running Stockiha / Node / Cargo instances and freeing port 1420...
taskkill /F /IM stockiha.exe /IM stockiha-backend.exe /IM tauri.exe /IM cargo.exe /IM node.exe 2>nul
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :1420') do taskkill /F /PID %%a 2>nul
ping 127.0.0.1 -n 2 >nul

set "CARGO_BIN=%USERPROFILE%\.cargo\bin"
set "PATH=C:\Program Files\PostgreSQL\18\bin;C:\BuildTools\VC\Tools\MSVC\14.44.35207\bin\Hostx64\x64;C:\Program Files (x86)\Windows Kits\10\bin\10.0.22621.0\x64;%CARGO_BIN%;%PATH%"
set "INCLUDE=C:\BuildTools\VC\Tools\MSVC\14.44.35207\include;C:\Program Files (x86)\Windows Kits\10\Include\10.0.22621.0\ucrt;C:\Program Files (x86)\Windows Kits\10\Include\10.0.22621.0\shared;C:\Program Files (x86)\Windows Kits\10\Include\10.0.22621.0\um;C:\Program Files (x86)\Windows Kits\10\Include\10.0.22621.0\winrt;C:\Program Files (x86)\Windows Kits\10\Include\10.0.22621.0\cppwinrt"
set "LIB=C:\BuildTools\VC\Tools\MSVC\14.44.35207\lib\x64;C:\Program Files (x86)\Windows Kits\10\Lib\10.0.22621.0\ucrt\x64;C:\Program Files (x86)\Windows Kits\10\Lib\10.0.22621.0\um\x64;%LIB%"

set "STOCKIHA_LOCAL_SECRET_ROOT=%LOCALAPPDATA%\Stockiha\r8-acceptance"

if not defined STOCKIHA_DEV_DATABASE_URL (
    if exist "%STOCKIHA_LOCAL_SECRET_ROOT%\runtime.key" (
        for /f "usebackq delims=" %%U in (`powershell -NoProfile -Command "$p=(Get-Content -LiteralPath '%STOCKIHA_LOCAL_SECRET_ROOT%\runtime.key' -Raw).Trim(); $e=[System.Uri]::EscapeDataString($p); Write-Output ('postgres://stockiha_runtime:' + $e + '@127.0.0.1:5433/stockiha_r8e_verification_test?sslmode=disable')"`) do set "STOCKIHA_DEV_DATABASE_URL=%%U"
    )
)

if not defined STOCKIHA_DEV_DATABASE_URL (
    echo ERROR: STOCKIHA_DEV_DATABASE_URL is not configured.
    echo Configure it in the Windows user environment or provide:
    echo   %STOCKIHA_LOCAL_SECRET_ROOT%\runtime.key
    exit /b 1
)

echo Ensuring PostgreSQL service is active on port 5433...
powershell -NoProfile -Command "$ready = & 'C:\Program Files\PostgreSQL\18\bin\pg_isready.exe' -h 127.0.0.1 -p 5433 2>&1; if ($ready -notlike '*accepting connections*') { Start-Process -FilePath 'C:\Program Files\PostgreSQL\18\bin\postgres.exe' -ArgumentList '-D', ('\"' + $env:LOCALAPPDATA + '\Stockiha\r8-acceptance\data-55433\"'), '-p', '5433' -WindowStyle Hidden; for ($i = 0; $i -lt 20; $i++) { Start-Sleep -Seconds 1; $ready = & 'C:\Program Files\PostgreSQL\18\bin\pg_isready.exe' -h 127.0.0.1 -p 5433 2>&1; if ($ready -like '*accepting connections*') { break } } }; if ($ready -notlike '*accepting connections*') { Write-Error ('PostgreSQL did not become ready on port 5433. Last readiness result: ' + ($ready -join ' ')); exit 1 }"
if errorlevel 1 (
    echo ERROR: PostgreSQL is not available on port 5433.
    exit /b 1
)

echo Applying database migrations via SQLx runner...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\run-sqlx-migrations.ps1"
if errorlevel 1 (
    echo ERROR: Database migration failed. Halting application launch.
    exit /b 1
)

if not defined STOCKIHA_BACKUP_ROOT set "STOCKIHA_BACKUP_ROOT=C:\Stockiha-R6-SQLx-Final-Acceptance"
if not defined STOCKIHA_PG_DUMP_PATH set "STOCKIHA_PG_DUMP_PATH=C:\Program Files\PostgreSQL\18\bin\pg_dump.exe"

echo ========================================================
echo Compiling Stockiha (Tauri v2 + React 19)
echo ========================================================
echo Database URL: Configured (Port 5433)
echo Backup Root: %STOCKIHA_BACKUP_ROOT%
echo ========================================================

echo Compiling frontend production bundle...
call npm run build
if errorlevel 1 (
    echo Frontend compilation failed!
    exit /b 1
)

echo ========================================================
echo Stockiha compiled successfully. Launching Tauri dev...
echo ========================================================

call npm run tauri dev
if errorlevel 1 (
    echo Stockiha Tauri launch failed!
    exit /b 1
)
