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

function Invoke-PsqlScalar(
    [string]$PsqlPath,
    [string]$DatabaseUrl,
    [string]$Sql,
    [string]$FailureMessage
) {
    $value = (& $PsqlPath $DatabaseUrl -X -v ON_ERROR_STOP=1 -At -c $Sql 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) {
        Fail $FailureMessage
    }
    return $value
}

function Invoke-PsqlCommand(
    [string]$PsqlPath,
    [string]$DatabaseUrl,
    [string]$Sql,
    [string]$FailureMessage
) {
    & $PsqlPath $DatabaseUrl -X -v ON_ERROR_STOP=1 -c $Sql 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Fail $FailureMessage
    }
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$migrationsPath = Join-Path $repoRoot 'src-tauri\migrations'
if (-not (Test-Path -LiteralPath $migrationsPath)) {
    Fail "Migration directory not found: $migrationsPath"
}

$localSecretRoot = Join-Path $env:LOCALAPPDATA 'Stockiha\r8-acceptance'
$migrationUrl = [Environment]::GetEnvironmentVariable('STOCKIHA_MIGRATION_DATABASE_URL', 'Process')
$adminUrl = [Environment]::GetEnvironmentVariable('STOCKIHA_ADMIN_DATABASE_URL', 'Process')

if ([string]::IsNullOrWhiteSpace($migrationUrl)) {
    $migratorPassword = Get-SecretValue `
        -EnvironmentVariable 'STOCKIHA_MIGRATOR_PW' `
        -FallbackPath (Join-Path $localSecretRoot 'migrator.key')

    $migrationUrl = Build-PostgresUrl `
        -User 'stockiha_migrator' `
        -Password $migratorPassword `
        -Database $DatabaseName
}

if ([string]::IsNullOrWhiteSpace($adminUrl)) {
    $adminPassword = Get-SecretValue `
        -EnvironmentVariable 'STOCKIHA_ADMIN_PW' `
        -FallbackPath (Join-Path $localSecretRoot 'admin.key')

    $adminUrl = Build-PostgresUrl `
        -User 'stockiha_admin' `
        -Password $adminPassword `
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

if ([string]::IsNullOrWhiteSpace($adminUrl)) {
    Fail @"
No administrator database credentials were found for the bounded SQLx metadata bridge.

Configure one of:
  STOCKIHA_ADMIN_DATABASE_URL
  STOCKIHA_ADMIN_PW
  $localSecretRoot\admin.key

The administrator credential is used only to grant and then revoke the narrow migration metadata privileges required by the existing Stockiha database.
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
        Fail 'psql was not found. PostgreSQL 18 client tools are required for the bounded migration privilege bridge.'
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
$metadataBridgeGranted = $false
$procurementUsageGranted = $false

try {
    $metadataTableExists = Invoke-PsqlScalar `
        -PsqlPath $psqlPath `
        -DatabaseUrl $adminUrl `
        -Sql "SELECT (to_regclass('public._sqlx_migrations') IS NOT NULL)::int;" `
        -FailureMessage 'Could not inspect SQLx migration metadata.'

    if ($metadataTableExists -eq '1') {
        Invoke-PsqlCommand `
            -PsqlPath $psqlPath `
            -DatabaseUrl $adminUrl `
            -Sql 'GRANT SELECT, INSERT, UPDATE ON TABLE public._sqlx_migrations TO stockiha_owner;' `
            -FailureMessage 'Could not grant the temporary SQLx metadata bridge to stockiha_owner.'
        $metadataBridgeGranted = $true
    }

    $procurementSchemaExists = Invoke-PsqlScalar `
        -PsqlPath $psqlPath `
        -DatabaseUrl $adminUrl `
        -Sql "SELECT (to_regnamespace('procurement') IS NOT NULL)::int;" `
        -FailureMessage 'Could not inspect the procurement schema.'

    if ($procurementSchemaExists -eq '1') {
        Invoke-PsqlCommand `
            -PsqlPath $psqlPath `
            -DatabaseUrl $adminUrl `
            -Sql 'GRANT USAGE ON SCHEMA procurement TO stockiha_migrator;' `
            -FailureMessage 'Could not grant temporary procurement schema usage to stockiha_migrator.'
        $procurementUsageGranted = $true
    }

    $env:DATABASE_URL = $migrationUrl

    Write-Host "SQLx CLI: $sqlxVersion"
    Write-Host "Migration source: $migrationsPath"
    Write-Host "Database: $DatabaseName"
    Write-Host 'Applying pending SQLx migrations...'

    & $sqlxPath migrate run --source $migrationsPath
    if ($LASTEXITCODE -ne 0) {
        Fail "SQLx migration command failed with exit code $LASTEXITCODE."
    }

    Write-Host 'Database migrations: PASS'
}
finally {
    $env:DATABASE_URL = $oldDatabaseUrl

    if ($metadataBridgeGranted) {
        Invoke-PsqlCommand `
            -PsqlPath $psqlPath `
            -DatabaseUrl $adminUrl `
            -Sql 'REVOKE SELECT, INSERT, UPDATE ON TABLE public._sqlx_migrations FROM stockiha_owner;' `
            -FailureMessage 'Could not revoke the temporary SQLx metadata bridge from stockiha_owner.'

        $residualMetadataAcl = Invoke-PsqlScalar `
            -PsqlPath $psqlPath `
            -DatabaseUrl $adminUrl `
            -Sql "SELECT (has_table_privilege('stockiha_owner', 'public._sqlx_migrations', 'SELECT')::int)::text || ':' || (has_table_privilege('stockiha_owner', 'public._sqlx_migrations', 'INSERT')::int)::text || ':' || (has_table_privilege('stockiha_owner', 'public._sqlx_migrations', 'UPDATE')::int)::text;" `
            -FailureMessage 'Could not verify revocation of temporary SQLx metadata privileges.'

        if ($residualMetadataAcl -ne '0:0:0') {
            Fail "Temporary SQLx metadata privileges were not fully revoked (detected $residualMetadataAcl, expected 0:0:0)."
        }
    }

    if ($procurementUsageGranted) {
        Invoke-PsqlCommand `
            -PsqlPath $psqlPath `
            -DatabaseUrl $adminUrl `
            -Sql 'REVOKE USAGE ON SCHEMA procurement FROM stockiha_migrator;' `
            -FailureMessage 'Could not revoke temporary procurement schema usage from stockiha_migrator.'

        $residualSchemaAcl = Invoke-PsqlScalar `
            -PsqlPath $psqlPath `
            -DatabaseUrl $adminUrl `
            -Sql "SELECT (has_schema_privilege('stockiha_migrator', 'procurement', 'USAGE')::int)::text;" `
            -FailureMessage 'Could not verify revocation of temporary procurement schema usage.'

        if ($residualSchemaAcl -ne '0') {
            Fail "Temporary procurement schema usage was not fully revoked (detected $residualSchemaAcl, expected 0)."
        }
    }
}
