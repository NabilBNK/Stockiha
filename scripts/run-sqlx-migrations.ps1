param(
    [string]$DatabaseName = 'stockiha_r8e_verification_test'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Fail([string]$Message) {
    throw $Message
}

function Get-SecretValue([string]$EnvironmentVariable, [string]$FallbackPath) {
    $value = [Environment]::GetEnvironmentVariable($EnvironmentVariable, 'Process')
    if (-not [string]::IsNullOrWhiteSpace($value)) {
        return $value.Trim()
    }

    if (Test-Path -LiteralPath $FallbackPath) {
        $value = (Get-Content -LiteralPath $FallbackPath -Raw).Trim()
        if (-not [string]::IsNullOrWhiteSpace($value)) {
            return $value
        }
    }

    return $null
}

function Build-PostgresUrl(
    [string]$User,
    [string]$Password,
    [string]$Database
) {
    if ([string]::IsNullOrWhiteSpace($Password)) {
        return $null
    }

    $escapedPassword = [System.Uri]::EscapeDataString($Password)
    return "postgres://${User}:${escapedPassword}@127.0.0.1:5433/${Database}?sslmode=disable"
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$migrationsPath = Join-Path $repoRoot 'src-tauri\migrations'
if (-not (Test-Path -LiteralPath $migrationsPath)) {
    Fail "Migration directory not found: $migrationsPath"
}

$localSecretRoot = Join-Path $env:LOCALAPPDATA 'Stockiha\r8-acceptance'
$migrationUrl = [Environment]::GetEnvironmentVariable('STOCKIHA_MIGRATION_DATABASE_URL', 'Process')

if ([string]::IsNullOrWhiteSpace($migrationUrl)) {
    $migratorPassword = Get-SecretValue `
        -EnvironmentVariable 'STOCKIHA_MIGRATOR_PW' `
        -FallbackPath (Join-Path $localSecretRoot 'migrator.key')

    $migrationUrl = Build-PostgresUrl `
        -User 'stockiha_migrator' `
        -Password $migratorPassword `
        -Database $DatabaseName
}

if ([string]::IsNullOrWhiteSpace($migrationUrl)) {
    Fail @"
No migration database credentials were found.

Configure one of:
  STOCKIHA_MIGRATION_DATABASE_URL
  STOCKIHA_MIGRATOR_PW
  $localSecretRoot\migrator.key

No password is stored in this script.
"@
}

$sqlxCommand = Get-Command sqlx -ErrorAction SilentlyContinue
if ($null -eq $sqlxCommand) {
    $fallbackSqlx = Join-Path $env:USERPROFILE '.cargo\bin\sqlx.exe'
    if (Test-Path -LiteralPath $fallbackSqlx) {
        $sqlxPath = $fallbackSqlx
    }
    else {
        Fail @"
sqlx CLI was not found.
Install the repository-compatible SQLx CLI (0.8.x) before running Stockiha:
  cargo install sqlx-cli --version 0.8.6 --no-default-features --features postgres --locked
"@
    }
}
else {
    $sqlxPath = $sqlxCommand.Source
}

$psqlCommand = Get-Command psql -ErrorAction SilentlyContinue
if ($null -eq $psqlCommand) {
    $fallbackPsql = 'C:\Program Files\PostgreSQL\18\bin\psql.exe'
    if (Test-Path -LiteralPath $fallbackPsql) {
        $psqlPath = $fallbackPsql
    }
    else {
        Fail 'PostgreSQL 18 psql was not found.'
    }
}
else {
    $psqlPath = $psqlCommand.Source
}

$sqlxVersion = (& $sqlxPath --version 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0) {
    Fail 'Unable to execute sqlx CLI.'
}
if ($sqlxVersion -notmatch '0\.8\.') {
    Fail "Unsupported sqlx CLI version: $sqlxVersion. Stockiha requires sqlx 0.8.x."
}

$oldDatabaseUrl = $env:DATABASE_URL
$oldPgOptions = $env:PGOPTIONS
$metadataBridgeGranted = $false
try {
    $env:DATABASE_URL = $migrationUrl
    $env:PGOPTIONS = $null

    Write-Host "SQLx CLI: $sqlxVersion"
    Write-Host "Migration source: $migrationsPath"
    Write-Host "Database: $DatabaseName"
    Write-Host 'Applying pending SQLx migrations...'

    $metadataOwner = (& $psqlPath -X -v ON_ERROR_STOP=1 -d $migrationUrl -Atc "SELECT COALESCE((SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid=to_regclass('public._sqlx_migrations')), '<missing>');" 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) {
        Fail 'Unable to inspect SQLx migration metadata ownership.'
    }

    if ($metadataOwner -eq '<missing>') {
        & $sqlxPath migrate run --source $migrationsPath --target-version 20260812100000
        if ($LASTEXITCODE -ne 0) {
            Fail "SQLx bootstrap migration phase failed with exit code $LASTEXITCODE."
        }

        $metadataOwner = (& $psqlPath -X -v ON_ERROR_STOP=1 -d $migrationUrl -Atc "SELECT COALESCE((SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid=to_regclass('public._sqlx_migrations')), '<missing>');" 2>&1 | Out-String).Trim()
        if ($LASTEXITCODE -ne 0) {
            Fail 'Unable to verify SQLx migration metadata after bootstrap.'
        }
    }

    if ($metadataOwner -ne 'stockiha_migrator') {
        Fail "SQLx migration metadata is owned by $metadataOwner; expected stockiha_migrator. Reprovision or repair the local acceptance database before migrating."
    }

    & $psqlPath -X -v ON_ERROR_STOP=1 -d $migrationUrl -c 'GRANT SELECT, INSERT, UPDATE ON TABLE public._sqlx_migrations TO stockiha_owner;' 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Fail 'Unable to grant the temporary SQLx metadata owner bridge.'
    }
    $metadataBridgeGranted = $true

    & $sqlxPath migrate run --source $migrationsPath
    if ($LASTEXITCODE -ne 0) {
        Fail "SQLx migration command failed with exit code $LASTEXITCODE."
    }

    Write-Host 'Database migrations: PASS'
}
finally {
    if ($metadataBridgeGranted) {
        & $psqlPath -X -v ON_ERROR_STOP=1 -d $migrationUrl -c 'REVOKE SELECT, INSERT, UPDATE ON TABLE public._sqlx_migrations FROM stockiha_owner;' 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) {
            Fail 'Unable to revoke the temporary SQLx metadata owner bridge.'
        }

        $residualOwnerAcl = (& $psqlPath -X -v ON_ERROR_STOP=1 -d $migrationUrl -Atc "SELECT has_table_privilege('stockiha_owner','public._sqlx_migrations','SELECT')::int || ':' || has_table_privilege('stockiha_owner','public._sqlx_migrations','INSERT')::int || ':' || has_table_privilege('stockiha_owner','public._sqlx_migrations','UPDATE')::int;" 2>&1 | Out-String).Trim()
        if (($LASTEXITCODE -ne 0) -or ($residualOwnerAcl -ne '0:0:0')) {
            Fail 'Temporary SQLx metadata owner bridge was not fully revoked.'
        }
    }

    $env:DATABASE_URL = $oldDatabaseUrl
    $env:PGOPTIONS = $oldPgOptions
}
