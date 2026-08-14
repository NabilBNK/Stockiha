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

$sqlxVersion = (& $sqlxPath --version 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0) {
    Fail 'Unable to execute sqlx CLI.'
}
if ($sqlxVersion -notmatch '0\.8\.') {
    Fail "Unsupported sqlx CLI version: $sqlxVersion. Stockiha requires sqlx 0.8.x."
}

$oldDatabaseUrl = $env:DATABASE_URL
try {
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
}
