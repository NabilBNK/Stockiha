<#
.SYNOPSIS
    WS-K-5 — build a disposable TEST installer whose embedded database is
    genuinely behind the real one, so the safe-upgrade path (backup,
    verification, migrate, rollback) can be exercised on real hardware even
    on a release that added zero migrations since the last one.

.DESCRIPTION
    The gap this closes: `infrastructure::safe_upgrade`'s automatic
    pre-upgrade backup/rollback can only run when the installed binary's
    compiled migration set is genuinely ahead of the connected database's
    `_sqlx_migrations` bookkeeping (SchemaCompatibility::OlderThanBinary).
    Two adjacent releases that happen to ship no new migrations can never
    produce that condition against each other — which is exactly what
    happened installing WS-K-5.1 over WS-K-4.9 on the Owner's machine: both
    embed the same 152 migrations, so the upgrade flow correctly did
    nothing. That is not a defect, but it means the upgrade/backup/rollback
    machinery had never actually run outside this repository's own
    automated integration tests.

    This script does NOT touch a single line of `infrastructure::
    safe_upgrade` or `infrastructure::embedded_setup` — the two modules
    whose correctness is what the automated tests already established and
    what real-hardware testing exists to confirm, unmodified. It instead
    temporarily hides the newest N migration files from `src-tauri/
    migrations/` (a build-time input, not application logic), sets a
    distinct, unmistakable version marker, runs the normal `npm run
    tauri:build`, and restores everything — migrations and the version
    marker — before exiting, success or failure alike.

    The resulting installer is the exact same WS-K-5 code (including the
    migrator-credential persistence WS-K-4.9 introduced and the safe-upgrade
    screen/command this task added), just compiled with a shorter migration
    list — so its own first-run setup writes a real `migrator.json`, and
    installing the REAL, full installer over it produces a genuine,
    multi-migration `OlderThanBinary` state that exercises the real upgrade
    screen end to end, not a simulation.

    Safety check: refuses to hold out any migration file whose SQL text
    grants `stockiha_runtime` access to `_sqlx_migrations` (the WS-K-1.2
    grant that lets the running app's own connection determine the schema
    version at all) — holding that one out would make the TEST build's own
    diagnostic report `Unknown` instead of `OlderThanBinary`, silently
    defeating the entire point of this script. If the default holdout count
    would exclude it, reduce -HoldoutCount or move that migration later in
    the sequence (it should never need to be the newest file in practice).

.PARAMETER HoldoutCount
    How many of the newest migration files to leave out of this TEST build.
    Default 5 — enough to be an unambiguous multi-migration upgrade, small
    enough that the held-out migrations are unlikely to be load-bearing for
    unrelated earlier ones (migrations only ever depend on earlier files,
    never later ones, so any suffix is safe to hold out on that count).

.PARAMETER Marker
    The on-screen/on-filename version marker for this TEST build. Defaults
    to the real marker in src/shared/version.ts with a `-TEST-OLDER-DB`
    suffix and the resulting migration count, e.g.
    `WS-K-5.1-TEST-OLDER-DB-147of152`. Kept unmistakable on purpose: this
    string appears both in the installer's file name and on the setup
    screen itself, so nobody can mistake this for a real shipping build.

.EXAMPLE
    powershell -File scripts/build-test-older-installer.ps1
    powershell -File scripts/build-test-older-installer.ps1 -HoldoutCount 8

.NOTES
    Run this from the repository root, on a clean working tree (the script
    checks and refuses otherwise, since it temporarily edits tracked files
    and must be certain of what "restore" means). Never point the resulting
    installer at a real shop's app-data folder — it is for a disposable,
    purpose-made test folder only, exactly as real-hardware verification
    documents (see WS-K-4-MANUAL-VERIFICATION.md, Scenario 7 addendum).
#>
param(
    [int]$HoldoutCount = 5,
    [string]$Marker = ''
)

$ErrorActionPreference = 'Stop'

$repoRoot = git rev-parse --show-toplevel
if (-not $repoRoot) { throw 'must be run inside a git repository' }
Set-Location $repoRoot

# ---------------------------------------------------------------------------
# Preconditions
# ---------------------------------------------------------------------------

# Untracked files are fine (this check only cares that the tracked files
# this script is about to edit - migrations/*.sql and version.ts - start
# from a known, committed state so "restore" means something exact).
$dirty = git status --porcelain --untracked-files=no
if ($dirty) {
    throw "tracked files have uncommitted changes - commit or stash first, so this script's own temporary edits can be restored exactly:`n$dirty"
}

$migrationsDir = Join-Path $repoRoot 'src-tauri\migrations'
$allMigrations = Get-ChildItem $migrationsDir -Filter '*.sql' | Sort-Object Name
if ($allMigrations.Count -le $HoldoutCount) {
    throw "HoldoutCount ($HoldoutCount) must be smaller than the total migration count ($($allMigrations.Count))"
}

$holdout = $allMigrations | Select-Object -Last $HoldoutCount
$kept = $allMigrations | Select-Object -First ($allMigrations.Count - $HoldoutCount)

# Refuse to hold out the migration that grants `stockiha_runtime` SELECT on
# `_sqlx_migrations` - without it the TEST build's own running-app connection
# cannot determine its schema version at all (WS-K-1.2's fail-open path
# reports Unknown, not OlderThanBinary), which would silently defeat this
# script's entire purpose. Detected by content, not by a hardcoded file
# name, so this keeps working as the migration set grows.
$grantPattern = 'GRANT\s+SELECT\s+ON\s+.*_sqlx_migrations.*TO\s+stockiha_runtime'
foreach ($file in $holdout) {
    if (Select-String -Path $file.FullName -Pattern $grantPattern -Quiet) {
        throw "refusing: holding out '$($file.Name)' would exclude the grant that lets " +
              "stockiha_runtime read _sqlx_migrations at all, which would make this TEST " +
              "build report UNKNOWN instead of OLDER_THAN_BINARY. Reduce -HoldoutCount so " +
              "this file stays in the kept set."
    }
}

$keptCount = $kept.Count
$totalCount = $allMigrations.Count
if (-not $Marker) {
    $versionSource = Get-Content 'src\shared\version.ts' -Raw
    $realMarker = [regex]::Match($versionSource, "APP_VERSION_MARKER\s*=\s*'([^']+)'").Groups[1].Value
    if (-not $realMarker) { throw 'could not read APP_VERSION_MARKER from src/shared/version.ts' }
    $Marker = "$realMarker-TEST-OLDER-DB-${keptCount}of${totalCount}"
}

Write-Host "Building a TEST installer: $keptCount of $totalCount migrations embedded, marker '$Marker'" -ForegroundColor Cyan
Write-Host "Holding out:" -ForegroundColor Cyan
$holdout | ForEach-Object { Write-Host "  - $($_.Name)" }

# ---------------------------------------------------------------------------
# Temporary edits, with a guaranteed restore
# ---------------------------------------------------------------------------

$holdoutTempDir = Join-Path ([System.IO.Path]::GetTempPath()) "stockiha-migration-holdout-$([guid]::NewGuid())"
New-Item -ItemType Directory -Path $holdoutTempDir | Out-Null

$versionPath = Join-Path $repoRoot 'src\shared\version.ts'
$originalVersionContent = Get-Content $versionPath -Raw

try {
    foreach ($file in $holdout) {
        Move-Item -Path $file.FullName -Destination $holdoutTempDir
    }

    $testVersionContent = $originalVersionContent -replace "APP_VERSION_MARKER = '[^']+'", "APP_VERSION_MARKER = '$Marker'"
    if ($testVersionContent -eq $originalVersionContent) {
        throw 'failed to rewrite APP_VERSION_MARKER for the test build'
    }
    Set-Content -Path $versionPath -Value $testVersionContent -NoNewline

    # Force a rebuild of the migrator: `sqlx::migrate!()` tracks the
    # migrations directory for cargo's own dependency graph, but touching the
    # file that invokes the macro removes any doubt.
    (Get-Item 'src-tauri\src\infrastructure\schema_version.rs').LastWriteTime = Get-Date

    npm run tauri:build
    if ($LASTEXITCODE -ne 0) { throw 'npm run tauri:build failed' }

    $nsisDir = Join-Path $repoRoot 'src-tauri\target\release\bundle\nsis'
    $produced = Join-Path $nsisDir "Stockiha_${Marker}-setup.exe"
    if (-not (Test-Path $produced)) {
        throw "expected installer not found at $produced"
    }

    $sizeBytes = (Get-Item $produced).Length
    Write-Host ""
    Write-Host "TEST installer ready:" -ForegroundColor Green
    Write-Host "  Path: $produced"
    Write-Host "  Size: $sizeBytes bytes"
    Write-Host "  Migrations embedded: $keptCount of $totalCount"
    Write-Host ""
    Write-Host "Never point this installer's app-data folder at a real shop's data." -ForegroundColor Yellow
}
finally {
    # Restore unconditionally, success or failure.
    foreach ($file in $holdout) {
        $restored = Join-Path $migrationsDir $file.Name
        $held = Join-Path $holdoutTempDir $file.Name
        if ((Test-Path $held) -and -not (Test-Path $restored)) {
            Move-Item -Path $held -Destination $restored
        }
    }
    Remove-Item -Path $holdoutTempDir -Recurse -Force -ErrorAction SilentlyContinue
    Set-Content -Path $versionPath -Value $originalVersionContent -NoNewline
    (Get-Item 'src-tauri\src\infrastructure\schema_version.rs').LastWriteTime = Get-Date

    $stillDirty = git status --porcelain --untracked-files=no
    if ($stillDirty) {
        Write-Host "WARNING: working tree is not clean after restore - inspect before committing anything:" -ForegroundColor Red
        Write-Host $stillDirty
    }
    else {
        Write-Host "Working tree restored to exactly its committed state." -ForegroundColor Green
    }
}
