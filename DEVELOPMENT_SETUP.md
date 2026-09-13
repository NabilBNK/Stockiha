# Stockiha Development Setup & Launch Guide

**Date Created:** 2026-08-31  
**Environment:** Windows 10 Pro, PostgreSQL 18.x, Node.js LTS, Rust MSVC, Tauri v2  
**Status:** Verified and Documented

---

## Executive Summary

Stockiha is a desktop ERP application built with Tauri v2, React 19, TypeScript, and Rust. It requires:
- An isolated PostgreSQL 18 cluster running on **port 5433**
- A specific local database directory for the Stockiha data files
- Proper environment configuration and role setup
- The `run.bat` launcher script (not bare `npm run tauri dev`)

This document provides the authoritative paths, configuration, and launch procedure.

---

## 1. Critical Paths & Locations

### PostgreSQL Configuration

| Item | Real Path |
|------|-----------|
| **PostgreSQL Binaries** | `C:\Program Files\PostgreSQL\18\bin\` |
| **System PostgreSQL Data** | `C:\Program Files\PostgreSQL\18\data\` |
| **Stockiha Isolated PostgreSQL Data** | `%LOCALAPPDATA%\Stockiha\r8-acceptance\data-55433\` |
| **Stockiha Admin Credentials** | `%LOCALAPPDATA%\Stockiha\r8-acceptance\admin.key` |
| **Stockiha Runtime Credentials** | `%LOCALAPPDATA%\Stockiha\r8-acceptance\runtime.key` |
| **Stockiha Migrator Credentials** | `%LOCALAPPDATA%\Stockiha\r8-acceptance\migrator.key` |

**Expanded Paths (for reference):**
```
%LOCALAPPDATA% = C:\Users\<USERNAME>\AppData\Local\

So for user 'Perfetto':
Admin key:     C:\Users\Perfetto\AppData\Local\Stockiha\r8-acceptance\admin.key
Runtime key:   C:\Users\Perfetto\AppData\Local\Stockiha\r8-acceptance\runtime.key
Migrator key:  C:\Users\Perfetto\AppData\Local\Stockiha\r8-acceptance\migrator.key
PostgreSQL:    C:\Users\Perfetto\AppData\Local\Stockiha\r8-acceptance\data-55433\
```

### Application Root

| Item | Path |
|------|------|
| **Repository Root** | `C:\Users\Perfetto\Desktop\Stockiha-Part02-Test\` |
| **Frontend Source** | `C:\Users\Perfetto\Desktop\Stockiha-Part02-Test\src\` |
| **Rust Backend** | `C:\Users\Perfetto\Desktop\Stockiha-Part02-Test\src-tauri\src\` |
| **Database Migrations** | `C:\Users\Perfetto\Desktop\Stockiha-Part02-Test\src-tauri\migrations\` |
| **Launch Script** | `C:\Users\Perfetto\Desktop\Stockiha-Part02-Test\run.bat` |
| **Migration Runner** | `C:\Users\Perfetto\Desktop\Stockiha-Part02-Test\scripts\run-sqlx-migrations.ps1` |
| **PostgreSQL Starter** | `C:\Users\Perfetto\Desktop\Stockiha-Part02-Test\scripts\ensure-postgres.ps1` |

### Build Artifacts

| Item | Path |
|------|------|
| **Frontend Build Output** | `C:\Users\Perfetto\Desktop\Stockiha-Part02-Test\dist\` |
| **Backup Root** | `C:\Stockiha-R6-SQLx-Final-Acceptance\` |

---

## 2. Port Configuration

### PostgreSQL Ports

| Instance | Port | Purpose | Status |
|----------|------|---------|--------|
| **System PostgreSQL** | `5432` | System-wide PostgreSQL service (if running) | ⚠️ May interfere |
| **Stockiha PostgreSQL** | `5433` | Isolated cluster for Stockiha only | ✅ Required |

**Important:** Stockiha MUST use port 5433, not 5432. The isolated cluster on 5433 is intentional to avoid conflicts with system PostgreSQL installations.

### Application Ports

| Component | Port | Purpose |
|-----------|------|---------|
| **Frontend Vite Dev Server** | `1420` | Hot reload during development |
| **Tauri IPC Bridge** | Internal | Native app ↔ React communication |

---

## 3. Database Configuration

### Connection String Format

Stockiha uses the following connection string resolved from credentials:

```
postgresql://stockiha_runtime:<password_from_runtime.key>@127.0.0.1:5433/stockiha_acceptance?sslmode=disable
```

### Database Name

| Item | Value |
|------|-------|
| **Database Name** | `stockiha_acceptance` |
| **Owner Role** | `stockiha_owner` |
| **Runtime Role** | `stockiha_runtime` |
| **Migrator Role** | `stockiha_migrator` |
| **Admin Role** | `stockiha_admin` |

### Disposable `_test` databases on this same cluster

The isolated cluster on port 5433 (data dir `data-55433`) also hosts several
disposable, per-task `..._test` databases used only by opt-in
`#[ignore]`d Rust integration tests (`STOCKIHA_TEST_DATABASE_URL`), never by
the running app. Known as of WS-D-2 (2026-09-01):

| Database | Origin / purpose |
|---|---|
| `stockiha_wsd2_test` | Provisioned for WS-D-2 acceptance: fully migrated (incl. D-1's `20260901090000_ws_d_001_catalogue_foundation.sql`), used to run the `application::catalog::tests` overload/decimal/delete-blocked/worked-example tests against a real database. Safe to reuse for further WS-D work; safe to drop and re-provision (`CREATE DATABASE ... OWNER stockiha_owner` + `scripts/run-sqlx-migrations.ps1 -DatabaseName stockiha_wsd2_test`) if it drifts. |

Several other `..._test` / `..._verification_test` databases already exist on
this cluster from earlier workstreams (visible via `psql -d postgres -c
"SELECT datname FROM pg_database WHERE datname LIKE '%test%'"`) — treat any
undocumented one the same way: check its `_sqlx_migrations` max version
before trusting it, since (as WS-D-2 found for
`stockiha_r8_acceptance_inventory_test`) a `_test` name does not guarantee
current migrations.

### Credential Storage

Credentials are stored as plain-text files in `%LOCALAPPDATA%\Stockiha\r8-acceptance\`:

- **admin.key** — PostgreSQL admin password for initial setup and migrations
- **runtime.key** — Application runtime connection password
- **migrator.key** — SQLx migration runner password

These files are read by the launch scripts and should be protected at the OS level.

---

## 4. How to Properly Run the App

### Prerequisites

1. **PostgreSQL 18** installed at `C:\Program Files\PostgreSQL\18\`
2. **Node.js LTS** installed and in PATH
3. **Rust + Cargo** installed with MSVC toolchain
4. **Visual Studio Build Tools 2022** with C++ workload
5. **Windows SDK** (10.0.22621+)

Verify:
```powershell
node --version
cargo --version
rustc --version
```

### Step 1: Clean Environment

Remove any stale database URL environment variables that might point to the wrong target:

```powershell
# Check all scopes
function Get-StockihaDbTarget {
    param([ValidateSet('Process','User','Machine')][string]$Scope)
    $value = [Environment]::GetEnvironmentVariable('STOCKIHA_DEV_DATABASE_URL', $Scope)
    if ([string]::IsNullOrWhiteSpace($value)) { return "${Scope}: (not set)" }
    try {
        $u = [uri]$value
        if (-not $u.IsAbsoluteUri -or [string]::IsNullOrEmpty($u.Host)) { throw 'unparseable' }
        return "${Scope}: $($u.Host):$($u.Port)$($u.AbsolutePath)"
    } catch {
        return "${Scope}: (set, but unparseable - value withheld)"
    }
}

'Process','User','Machine' | ForEach-Object { Get-StockihaDbTarget $_ }

# Remove User-scope if it exists
[Environment]::SetEnvironmentVariable('STOCKIHA_DEV_DATABASE_URL', $null, 'User')
Remove-Item Env:STOCKIHA_DEV_DATABASE_URL -ErrorAction SilentlyContinue
```

### Step 2: Run the Launcher

**Do NOT use:** `npm run tauri dev` (bare command, missing environment setup)

**Do use:** The `run.bat` launcher script

```powershell
cd C:\Users\Perfetto\Desktop\Stockiha-Part02-Test
.\run.bat
```

The launcher automatically:

1. **Stops previous dev processes** associated with the worktree
2. **Ensures PostgreSQL is running** on port 5433
   - Checks if the Stockiha cluster is accepting connections
   - Starts it if not running
   - Uses data directory: `%LOCALAPPDATA%\Stockiha\r8-acceptance\data-55433\`
3. **Runs SQLx migrations** via `scripts/run-sqlx-migrations.ps1`
   - Connects as `stockiha_migrator` using credentials from `migrator.key`
   - Falls back to `stockiha_runtime` if migrator key unavailable
   - Applies all pending database migrations
   - Verifies IAM functions are installed
4. **Builds the frontend** using Vite + TypeScript
   - Compiles React 19 + TypeScript code
   - Generates optimized production bundle
   - Outputs to `dist/`
5. **Compiles the Rust backend** using Cargo
   - Builds Tauri application
   - Links to PostgreSQL via SQLx
6. **Launches the Tauri app**
   - Opens native Windows window
   - Connects to PostgreSQL on 5433
   - Displays login screen

### Step 3: Monitor Progress

The `run.bat` output shows these stages:

```
[1/5] Ensuring PostgreSQL is accepting connections on port 5433...
[OK] PostgreSQL is accepting connections on port 5433.

[2/5] Running SQLx migrations...
SQLx CLI: sqlx-cli 0.8.6
Database migrations: PASS
Total migrations applied: 138

[4/5] Checking database credentials and building URL...
[OK] Credentials loaded.

[4/5] Compiling Stockiha (Tauri v2 + React 19)
Building frontend production bundle...
> stockiha@0.1.0 build
> tsc -b && vite build

[5/5] Running Tauri...
```

### Step 4: Login

When the native Tauri window appears, you will see the **Sign in** screen. Use credentials from the database (initially seeded by migrations).

---

## 5. File Reference Guide

### Critical Scripts

| Script | Location | Purpose |
|--------|----------|---------|
| **run.bat** | Repository root | Main launcher — use this to start the app |
| **ensure-postgres.ps1** | `scripts/` | Checks and starts isolated PostgreSQL on 5433 |
| **run-sqlx-migrations.ps1** | `scripts/` | Applies database migrations |

### Configuration Files

| File | Location | Purpose |
|------|----------|---------|
| **postgresql.conf** | `C:\Program Files\PostgreSQL\18\data\` | System PostgreSQL config (port should be 5432) |
| **sqlx-data.json** | Repository root | SQLx compile-time query verification |

### Key Source Files

| Layer | File | Purpose |
|-------|------|---------|
| **Database Setup** | `src-tauri/migrations/*.sql` | 138 migration files defining schema |
| **Rust Backend** | `src-tauri/src/infrastructure/db.rs` | PostgreSQL connectivity and pooling |
| **Rust Backend** | `src-tauri/src/main.rs` | Tauri command setup and IPC bridge |
| **Frontend** | `src/app/App.tsx` | React root component |
| **Frontend** | `src/app/AppRouter.tsx` | Screen routing logic |
| **Frontend** | `src/features/*` | Feature screens (Inventory, Procurement, etc.) |

---

## 6. Troubleshooting

### Issue: "pool timed out while waiting for an open connection"

**Root Cause:** Application is connecting to wrong database target (usually port 55432 instead of 5433)

**Fix:**
```powershell
# Remove stale environment variable
[Environment]::SetEnvironmentVariable('STOCKIHA_DEV_DATABASE_URL', $null, 'User')
Remove-Item Env:STOCKIHA_DEV_DATABASE_URL -ErrorAction SilentlyContinue

# Start fresh shell and run launcher
.\run.bat
```

### Issue: "another server might be running; trying to start server anyway"

**Root Cause:** System PostgreSQL on port 5432 is interfering with Stockiha PostgreSQL startup on 5433

**Fix:**
```powershell
# Stop system PostgreSQL service (requires admin)
Stop-Service postgresql-x64-18 -Force

# Or kill processes manually
Get-Process postgres* | Stop-Process -Force -ErrorAction SilentlyContinue

# Then run launcher
.\run.bat
```

### Issue: "permission denied for table _sqlx_migrations"

**Root Cause:** SQLx metadata table is owned by wrong role

**Fix:** See `docs/incident-2026-08-16-local-development-launch.md` for detailed recovery steps

### Issue: Frontend build fails with type errors

**Cause:** TypeScript compilation errors in React components

**Fix:**
```powershell
npm run typecheck
npm run lint
# Fix errors, then:
.\run.bat
```

---

## 7. Environment Validation

Before running the app, verify the environment:

```powershell
# Check prerequisites
$checks = @{
    "PostgreSQL 18 binaries" = "C:\Program Files\PostgreSQL\18\bin\psql.exe"
    "Node.js" = (Get-Command node -ErrorAction SilentlyContinue).Source
    "npm" = (Get-Command npm -ErrorAction SilentlyContinue).Source
    "Cargo" = (Get-Command cargo -ErrorAction SilentlyContinue).Source
    "Rust" = (Get-Command rustc -ErrorAction SilentlyContinue).Source
    "SQLx CLI" = (Get-Command sqlx -ErrorAction SilentlyContinue).Source
}

foreach ($check in $checks.GetEnumerator()) {
    $path = $check.Value
    $exists = if ($path) { "✅" } else { "❌" }
    Write-Host "$exists $($check.Key): $path"
}

# Check Stockiha directories
Write-Host ""
Write-Host "Stockiha Directories:"
$dirs = @{
    "Repo root" = "C:\Users\Perfetto\Desktop\Stockiha-Part02-Test"
    "Migrations" = "C:\Users\Perfetto\Desktop\Stockiha-Part02-Test\src-tauri\migrations"
    "PostgreSQL data" = "$env:LOCALAPPDATA\Stockiha\r8-acceptance\data-55433"
    "Credentials" = "$env:LOCALAPPDATA\Stockiha\r8-acceptance"
}

foreach ($dir in $dirs.GetEnumerator()) {
    $exists = if (Test-Path $dir.Value) { "✅" } else { "❌" }
    Write-Host "$exists $($dir.Key): $($dir.Value)"
}
```

---

## 8. Development Workflow

### Making Changes

1. **Frontend changes:** Vite auto-reloads, no restart needed
2. **Rust backend changes:** Restart the launcher (Tauri rebuilds)
3. **Database schema changes:** Create new migration file in `src-tauri/migrations/`

### Restarting

```powershell
# The launcher cleans up and restarts everything
.\run.bat
```

### Building for Release

```powershell
npm run build
cargo build --release
```

---

## 9. Incident History & Prevention

### 23 August 2026 Incident

A stale `STOCKIHA_DEV_DATABASE_URL` environment variable persisted at User scope after a previous developer session. It pointed to `127.0.0.1:55432` (a typo or legacy target). When `npm run tauri dev` was run directly (bypassing `run.bat`), the application silently used this wrong target, resulting in a cryptic "pool timed out" error.

**Prevention:**
- Always use `run.bat`, never bare `npm run tauri dev`
- The launcher sets the environment variable at Process scope only, overriding any User/Machine scope values
- If direct dev commands are needed, verify the target with the helper function above

**Reference:** See `docs/incident-2026-08-16-local-development-launch.md` for full incident details

---

## 10. Quick Reference

### Start the app
```powershell
cd C:\Users\Perfetto\Desktop\Stockiha-Part02-Test
.\run.bat
```

### Check PostgreSQL status
```powershell
$pgIsReady = 'C:\Program Files\PostgreSQL\18\bin\pg_isready.exe'
& $pgIsReady -h 127.0.0.1 -p 5433 -U stockiha_admin
```

### Run frontend tests
```powershell
npm run test
```

### Run backend tests
```powershell
cargo test
```

### Type check frontend
```powershell
npm run typecheck
```

### Lint code
```powershell
npm run lint
```

---

## Appendix: All Ports Summary

| Port | Service | Purpose | Status |
|------|---------|---------|--------|
| **5432** | PostgreSQL (System) | System-wide PostgreSQL | May run, may interfere |
| **5433** | PostgreSQL (Stockiha) | Stockiha isolated cluster | ✅ **REQUIRED** |
| **1420** | Vite Dev Server | Frontend hot reload | Dev only |

---

**Last Updated:** 2026-08-31  
**Verified On:** Windows 10 Pro 10.0.19045.6466  
**PostgreSQL Version:** 18.4  
**Node.js Version:** LTS  
**Rust Toolchain:** MSVC stable
