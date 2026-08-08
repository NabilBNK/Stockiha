param(
    [string]$DatabaseName = 'stockiha_r8_acceptance_test'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ExpectedDatabasePattern = '^stockiha_r8_acceptance(?:_[a-z0-9]+)?_test$'
$ExpectedSchemaVersion = '20260807230000'
$LegacyOwnerPhaseStart = '20260725120200'
$LegacyOwnerPhaseEnd = '20260725140200'

function Fail([string]$Message) {
    throw $Message
}

function Require-ProcessEnv([string]$Name) {
    $value = [Environment]::GetEnvironmentVariable($Name, 'Process')
    if ([string]::IsNullOrWhiteSpace($value)) {
        Fail "$Name is required in the current process environment."
    }
    return $value
}

function Invoke-Psql([string]$PsqlPath, [string]$Sql) {
    $output = & $PsqlPath -X -v ON_ERROR_STOP=1 -At -c $Sql 2>&1
    if ($LASTEXITCODE -ne 0) {
        Fail 'PostgreSQL provisioning command failed. Inspect locally; do not share credential-bearing diagnostics.'
    }
    return (($output | Out-String).Trim())
}

function Invoke-Sqlx([string]$SqlxPath, [string]$Source, [string]$Failure, [string]$Target = '') {
    if ([string]::IsNullOrWhiteSpace($Target)) {
        $output = & $SqlxPath migrate run --source $Source 2>&1
    }
    else {
        $output = & $SqlxPath migrate run --source $Source --target-version $Target 2>&1
    }
    if ($LASTEXITCODE -ne 0) {
        Fail $Failure
    }
    return $output
}

if ($DatabaseName -notmatch $ExpectedDatabasePattern) {
    Fail "DatabaseName must match $ExpectedDatabasePattern"
}

$adminHost = Require-ProcessEnv 'PGHOST'
$adminPort = Require-ProcessEnv 'PGPORT'
$adminUser = Require-ProcessEnv 'PGUSER'
[void](Require-ProcessEnv 'PGPASSWORD')
$controlDatabase = Require-ProcessEnv 'PGDATABASE'
$migratorUrl = Require-ProcessEnv 'DATABASE_URL'

try {
    $migratorUri = [System.Uri]$migratorUrl
}
catch {
    Fail 'DATABASE_URL could not be parsed as a PostgreSQL URL.'
}
if ($migratorUri.Scheme -notin @('postgres', 'postgresql')) {
    Fail 'DATABASE_URL must use the postgres or postgresql scheme.'
}
$migratorUser = [System.Uri]::UnescapeDataString($migratorUri.UserInfo.Split(':', 2)[0])
$migratorDatabase = [System.Uri]::UnescapeDataString($migratorUri.AbsolutePath.TrimStart('/'))
$migratorPort = if ($migratorUri.IsDefaultPort) { '5432' } else { [string]$migratorUri.Port }
if ($migratorUser -ne 'stockiha_migrator') {
    Fail 'DATABASE_URL must authenticate as stockiha_migrator.'
}
if ($migratorDatabase -ne $DatabaseName) {
    Fail 'DATABASE_URL must target the requested fresh acceptance database.'
}
if ($migratorUri.Host -ne $adminHost -or $migratorPort -ne $adminPort) {
    Fail 'Administrator and migrator connections must target the same PostgreSQL server.'
}
if ($controlDatabase -eq $DatabaseName) {
    Fail 'PGDATABASE must name an existing control database, not the fresh acceptance database.'
}

$psqlCommand = Get-Command psql -ErrorAction SilentlyContinue
if ($null -eq $psqlCommand) {
    $fallback = 'C:\Program Files\PostgreSQL\18\bin\psql.exe'
    if (-not (Test-Path $fallback)) {
        Fail 'PostgreSQL 18 psql was not found.'
    }
    $psqlPath = $fallback
}
else {
    $psqlPath = $psqlCommand.Source
}

$sqlxCommand = Get-Command sqlx -ErrorAction SilentlyContinue
if ($null -eq $sqlxCommand) {
    Fail 'sqlx CLI is required. Install repository-compatible sqlx-cli 0.8.6 first.'
}
$sqlxPath = $sqlxCommand.Source
$sqlxVersion = ((& $sqlxPath --version 2>&1 | Out-String).Trim())
if ($LASTEXITCODE -ne 0 -or $sqlxVersion -notmatch '0\.8\.') {
    Fail 'R8 acceptance requires sqlx CLI 0.8.x.'
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$migrationsPath = Join-Path $repoRoot 'src-tauri/migrations'
if (-not (Test-Path $migrationsPath)) {
    Fail 'Repository migrations directory was not found.'
}

$previousDatabase = $env:PGDATABASE
$previousOptions = $env:PGOPTIONS
try {
    $env:PGOPTIONS = $null

    $adminPosture = Invoke-Psql $psqlPath "SELECT current_database() || ':' || session_user || ':' || current_user || ':' || current_setting('is_superuser');"
    if ($adminPosture -ne "$controlDatabase`:$adminUser`:$adminUser`:on") {
        Fail 'Administrator PG* environment must identify a direct PostgreSQL superuser session on the control database.'
    }

    $versionText = Invoke-Psql $psqlPath 'SHOW server_version_num;'
    $versionNumber = 0
    if (-not [int]::TryParse($versionText, [ref]$versionNumber) -or $versionNumber -lt 180000 -or $versionNumber -ge 190000) {
        Fail 'R8 acceptance provisioning requires PostgreSQL major version 18.'
    }

    $rolePosture = Invoke-Psql $psqlPath @"
SELECT CASE WHEN
    EXISTS (SELECT 1 FROM pg_roles WHERE rolname='stockiha_owner' AND NOT rolcanlogin AND NOT rolinherit AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls)
    AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname='stockiha_migrator' AND rolcanlogin AND NOT rolinherit AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls)
    AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname='stockiha_runtime' AND rolcanlogin AND NOT rolinherit AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls)
    AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname='stockiha_backup' AND rolcanlogin AND NOT rolinherit AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls)
    AND EXISTS (
        SELECT 1 FROM pg_auth_members am
        JOIN pg_roles g ON g.oid=am.roleid
        JOIN pg_roles m ON m.oid=am.member
        WHERE g.rolname='stockiha_owner' AND m.rolname='stockiha_migrator'
          AND NOT am.admin_option AND NOT am.inherit_option AND am.set_option
    )
    AND (SELECT count(*) FROM pg_auth_members am JOIN pg_roles r ON r.oid=am.member WHERE r.rolname='stockiha_migrator')=1
    AND (SELECT count(*) FROM pg_auth_members am JOIN pg_roles r ON r.oid=am.member WHERE r.rolname IN ('stockiha_owner','stockiha_runtime','stockiha_backup'))=0
THEN 'OK' ELSE 'BAD' END;
"@
    if ($rolePosture -ne 'OK') {
        Fail 'Stockiha database role posture does not match the required least-privilege architecture.'
    }

    $existing = Invoke-Psql $psqlPath "SELECT count(*) FROM pg_database WHERE datname='$DatabaseName';"
    if ($existing -ne '0') {
        Fail "Acceptance database $DatabaseName already exists. Use a new database name."
    }

    [void](Invoke-Psql $psqlPath "CREATE DATABASE $DatabaseName WITH OWNER=stockiha_owner ENCODING='UTF8';")
    [void](Invoke-Psql $psqlPath "GRANT CONNECT ON DATABASE $DatabaseName TO stockiha_migrator, stockiha_runtime, stockiha_backup;")
    $env:PGDATABASE = $DatabaseName
    [void](Invoke-Psql $psqlPath 'REVOKE CREATE ON SCHEMA public FROM PUBLIC;')
    [void](Invoke-Psql $psqlPath 'GRANT USAGE, CREATE ON SCHEMA public TO stockiha_migrator;')

    [void](Invoke-Sqlx $sqlxPath $migrationsPath 'Pre-S3 SQLx phase failed; reject this database and do not repair it.' $LegacyOwnerPhaseStart)

    $metadataOwner = Invoke-Psql $psqlPath "SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid='public._sqlx_migrations'::regclass;"
    if ($metadataOwner -ne 'stockiha_migrator') {
        Fail 'SQLx metadata must be created and owned by stockiha_migrator.'
    }

    $bridgeGrantActive = $false
    try {
        [void](Invoke-Psql $psqlPath 'GRANT SELECT, INSERT, UPDATE ON TABLE public._sqlx_migrations TO stockiha_owner;')
        $bridgeGrantActive = $true
        $env:PGOPTIONS = '-c role=stockiha_owner'
        [void](Invoke-Sqlx $sqlxPath $migrationsPath 'Immutable legacy S3 SQLx phase failed; reject this database and do not repair it.' $LegacyOwnerPhaseEnd)
    }
    finally {
        $env:PGOPTIONS = $null
        if ($bridgeGrantActive) {
            [void](Invoke-Psql $psqlPath 'REVOKE SELECT, INSERT, UPDATE ON TABLE public._sqlx_migrations FROM stockiha_owner;')
        }
    }

    $residualOwnerAcl = Invoke-Psql $psqlPath @"
SELECT has_table_privilege('stockiha_owner','public._sqlx_migrations','SELECT')::int || ':' ||
       has_table_privilege('stockiha_owner','public._sqlx_migrations','INSERT')::int || ':' ||
       has_table_privilege('stockiha_owner','public._sqlx_migrations','UPDATE')::int;
"@
    if ($residualOwnerAcl -ne '0:0:0') {
        Fail 'Temporary legacy SQLx metadata privileges were not fully revoked.'
    }

    [void](Invoke-Sqlx $sqlxPath $migrationsPath 'Post-S3 SQLx phase failed; reject this database and do not repair it.')
    [void](Invoke-Sqlx $sqlxPath $migrationsPath 'Second SQLx verification failed; reject this database.')

    $metadataOwner = Invoke-Psql $psqlPath "SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid='public._sqlx_migrations'::regclass;"
    $latest = Invoke-Psql $psqlPath "SELECT version::text || ':' || success::text || ':' || octet_length(checksum)::text FROM public._sqlx_migrations ORDER BY version DESC LIMIT 1;"
    $schemaVersion = Invoke-Psql $psqlPath 'SELECT migration_version::text FROM operations.schema_state WHERE singleton;'
    if ($metadataOwner -ne 'stockiha_migrator' -or $latest -ne "$ExpectedSchemaVersion:true:48" -or $schemaVersion -ne $ExpectedSchemaVersion) {
        Fail 'Final SQLx metadata/schema state does not match the R8 acceptance baseline.'
    }

    $backupAcl = Invoke-Psql $psqlPath @"
SELECT has_table_privilege('stockiha_backup','public._sqlx_migrations','SELECT')::int || ':' ||
       has_table_privilege('stockiha_backup','public._sqlx_migrations','INSERT')::int || ':' ||
       has_table_privilege('stockiha_backup','public._sqlx_migrations','UPDATE')::int || ':' ||
       has_table_privilege('stockiha_backup','public._sqlx_migrations','DELETE')::int || ':' ||
       has_table_privilege('stockiha_backup','public._sqlx_migrations','TRUNCATE')::int;
"@
    if ($backupAcl -ne '1:0:0:0:0') {
        Fail 'Backup ACL for SQLx metadata is not read-only.'
    }
    if ((Invoke-Psql $psqlPath "SELECT has_schema_privilege('stockiha_runtime','public','CREATE')::int;") -ne '0') {
        Fail 'stockiha_runtime must not have CREATE on public schema.'
    }

    Write-Host 'R8 acceptance database provisioning: PASS'
    Write-Host "Database: $DatabaseName"
    Write-Host 'PostgreSQL major: 18'
    Write-Host "SQLx CLI: $sqlxVersion"
    Write-Host 'SQLx metadata owner: stockiha_migrator'
    Write-Host "Schema version: $ExpectedSchemaVersion"
    Write-Host "Immutable legacy owner bridge: $LegacyOwnerPhaseStart -> $LegacyOwnerPhaseEnd"
    Write-Host 'Temporary owner metadata ACL revoked: YES'
    Write-Host 'Historical migration bytes changed: NO'
    Write-Host 'Persistent migrator role override: NO'
    Write-Host 'Manual schema/ownership repair: NO'
}
finally {
    $env:PGOPTIONS = $previousOptions
    $env:PGDATABASE = $previousDatabase
}
