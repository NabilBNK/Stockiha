# Provisioning script for dedicated WS-A-1 disposable test database: stockiha_iam_test
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$DatabaseName = 'stockiha_iam_test'
$localSecretRoot = Join-Path $env:LOCALAPPDATA 'Stockiha\r8-acceptance'

function Get-Secret([string]$File, [string]$EnvName) {
    $envVal = [Environment]::GetEnvironmentVariable($EnvName, 'Process')
    if (-not [string]::IsNullOrWhiteSpace($envVal)) {
        return $envVal.Trim()
    }
    $path = Join-Path $localSecretRoot $File
    if (Test-Path -LiteralPath $path) {
        return (Get-Content -LiteralPath $path -Raw).Trim()
    }
    throw "Secret $File / $EnvName not found."
}

$adminPw = Get-Secret 'admin.key' 'STOCKIHA_ADMIN_PW'
$migratorPw = Get-Secret 'migrator.key' 'STOCKIHA_MIGRATOR_PW'
$runtimePw = Get-Secret 'runtime.key' 'STOCKIHA_RUNTIME_PW'

$psql = 'C:\Program Files\PostgreSQL\18\bin\psql.exe'
if (-not (Test-Path -LiteralPath $psql)) {
    $psqlCmd = Get-Command psql.exe -ErrorAction SilentlyContinue
    if ($psqlCmd) { $psql = $psqlCmd.Source }
    else { throw "psql not found" }
}

$escapedAdminPw = [System.Uri]::EscapeDataString($adminPw)
$controlAdminUrl = "postgres://stockiha_admin:${escapedAdminPw}@127.0.0.1:5433/postgres?sslmode=disable"

Write-Host "Recreating disposable test database: $DatabaseName..."

# Terminate existing connections to target db if any and drop
& $psql $controlAdminUrl -X -v ON_ERROR_STOP=1 -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$DatabaseName' AND pid <> pg_backend_pid();"
& $psql $controlAdminUrl -X -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS $DatabaseName;"
& $psql $controlAdminUrl -X -v ON_ERROR_STOP=1 -c "CREATE DATABASE $DatabaseName OWNER stockiha_owner;"

if ($LASTEXITCODE -ne 0) {
    throw "Failed to recreate database $DatabaseName"
}

Write-Host "Database $DatabaseName created with owner stockiha_owner."

$targetAdminUrl = "postgres://stockiha_admin:${escapedAdminPw}@127.0.0.1:5433/${DatabaseName}?sslmode=disable"
& $psql $targetAdminUrl -X -v ON_ERROR_STOP=1 -c "
GRANT ALL ON SCHEMA public TO stockiha_owner;
GRANT USAGE, CREATE ON SCHEMA public TO stockiha_migrator;
ALTER SCHEMA public OWNER TO stockiha_owner;
ALTER ROLE stockiha_migrator IN DATABASE $DatabaseName SET role = 'stockiha_owner';
"

# Run migrations
$repoRoot = Split-Path -Parent $PSScriptRoot
$migrationScript = Join-Path $PSScriptRoot 'run-sqlx-migrations.ps1'

& $migrationScript -DatabaseName $DatabaseName
if ($LASTEXITCODE -ne 0) {
    throw "Failed to run migrations on $DatabaseName"
}

Write-Host "Successfully provisioned and migrated $DatabaseName!"
