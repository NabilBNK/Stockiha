# Stockiha Quick Start — 5-Minute Setup

## The One Command

```powershell
cd C:\Users\Perfetto\Desktop\Stockiha-Part02-Test
.\run.bat
```

That's it. The launcher handles everything:
- ✅ PostgreSQL startup (port 5433)
- ✅ Database migrations
- ✅ Frontend build
- ✅ Backend compilation
- ✅ Tauri window launch

**Wait ~3-5 minutes for the native window to appear.**

---

## If It Fails

### Error: "pool timed out while waiting for an open connection"

```powershell
# Remove stale config
[Environment]::SetEnvironmentVariable('STOCKIHA_DEV_DATABASE_URL', $null, 'User')
Remove-Item Env:STOCKIHA_DEV_DATABASE_URL -ErrorAction SilentlyContinue

# Start fresh terminal and try again
.\run.bat
```

### Error: "another server might be running"

System PostgreSQL is interfering. Kill it:

```powershell
Get-Process postgres* | Stop-Process -Force -ErrorAction SilentlyContinue
.\run.bat
```

### Error: "permission denied for table _sqlx_migrations"

Database permissions are corrupted. Wipe and restart:

```powershell
# Delete the isolated PostgreSQL cluster
Remove-Item "$env:LOCALAPPDATA\Stockiha\r8-acceptance\data-55433" -Recurse -Force

# Rerun launcher (will recreate from scratch)
.\run.bat
```

---

## Key Paths (Copy-Paste Ready)

```powershell
# Application root
C:\Users\Perfetto\Desktop\Stockiha-Part02-Test

# PostgreSQL data (Stockiha isolated)
C:\Users\Perfetto\AppData\Local\Stockiha\r8-acceptance\data-55433

# Credentials
C:\Users\Perfetto\AppData\Local\Stockiha\r8-acceptance\admin.key
C:\Users\Perfetto\AppData\Local\Stockiha\r8-acceptance\runtime.key

# Launcher script
C:\Users\Perfetto\Desktop\Stockiha-Part02-Test\run.bat

# Frontend source
C:\Users\Perfetto\Desktop\Stockiha-Part02-Test\src

# Rust backend
C:\Users\Perfetto\Desktop\Stockiha-Part02-Test\src-tauri\src

# Migrations
C:\Users\Perfetto\Desktop\Stockiha-Part02-Test\src-tauri\migrations
```

---

## Critical Ports

| Port | Service | Purpose |
|------|---------|---------|
| **5433** | PostgreSQL | Stockiha database (REQUIRED) |
| **5432** | PostgreSQL | System (may interfere) |
| **1420** | Vite | Frontend dev server |

---

## Development Commands

```powershell
# Start the app
.\run.bat

# Type check frontend
npm run typecheck

# Lint
npm run lint

# Run frontend tests
npm run test

# Backend tests
cargo test

# Clean rebuild
Remove-Item -Recurse -Force dist/, target/
.\run.bat
```

---

## Check Your Setup

```powershell
# All prerequisites installed?
node --version
npm --version
cargo --version
rustc --version

# PostgreSQL binary available?
Test-Path "C:\Program Files\PostgreSQL\18\bin\psql.exe"

# Stockiha directories exist?
Test-Path "C:\Users\Perfetto\Desktop\Stockiha-Part02-Test"
Test-Path "$env:LOCALAPPDATA\Stockiha\r8-acceptance"

# PostgreSQL running on 5433?
$pg = 'C:\Program Files\PostgreSQL\18\bin\pg_isready.exe'
& $pg -h 127.0.0.1 -p 5433 -U stockiha_admin
```

---

## Expected Output on Success

```
========================================================
 Stockiha Development Runner
========================================================
[1/5] Ensuring PostgreSQL is accepting connections on port 5433...
[OK] PostgreSQL is accepting connections on port 5433.

[2/5] Running SQLx migrations...
Database migrations: PASS
Total migrations applied: 138

[4/5] Checking database credentials and building URL...
[OK] Credentials loaded.

[4/5] Compiling Stockiha (Tauri v2 + React 19)
Building frontend production bundle...
...
[5/5] Running Tauri...
```

Then a **native Windows window** opens with the **Sign in** screen.

---

## Login Credentials

Default test user (created by migrations):

| Field | Value |
|-------|-------|
| Email | test@stockiha.local |
| Password | Check the migrations or database seeding scripts |

*Credentials are configured in migrations or `scripts/wipe_and_seed_users.sql`*

---

## Still Stuck?

Check these files in order:

1. `DEVELOPMENT_SETUP.md` — Full setup guide
2. `docs/incident-2026-08-16-local-development-launch.md` — Incident history & recovery
3. `CURRENT_STEP.md` — Current project status
4. `STOCKIHA_GROUND_TRUTH.md` — Architecture & scope

---

## Reset Everything

If the database is corrupted:

```powershell
# Wipe the Stockiha PostgreSQL cluster
Remove-Item "$env:LOCALAPPDATA\Stockiha\r8-acceptance\data-55433" -Recurse -Force

# Wipe the app builds
Remove-Item dist, build, target -Recurse -Force -ErrorAction SilentlyContinue

# Fresh start
.\run.bat
```

---

**Last Updated:** 2026-08-31
