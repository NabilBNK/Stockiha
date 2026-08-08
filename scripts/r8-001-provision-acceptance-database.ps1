param(
    [string]$DatabaseName = "stockiha_r8_acceptance_test"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ExpectedDatabasePattern = '^stockiha_r8_acceptance(?:_[a-z0-9]+)?_test$'
$ExpectedSchemaVersion = '20260807230000'
$AdminUrlEnv = 'STOCKIHA_R8_ADMIN_DATABASE_URL'
$MigratorUrlEnv = 'STOCKIHA_R8_MIGRATOR_DATABASE_URL'

function Fail([string]$Message) {
    throw $Message
}

function Require-EnvironmentValue([string]$Name) {
    $value = [Environment]::GetEnvironmentVariable($Name, 'Process')
    if ([string]::IsNullOrWhiteSpace($value)) {
        Fail "$Name is required in the current process environment."
    }
    return $value
}

function Parse-PostgresUrl([string]$Url, [string]$Label) {
    try {
        $uri = [System.Uri]$Url
    }
    catch {
        Fail "$Label could not be parsed as a PostgreSQL URL."
    }

    if ($uri.Scheme -notin @('postgres', 'postgresql')) {
        Fail "$Label must use the postgres or postgresql scheme."
    }

    $userInfo = $uri.UserInfo.Split(':', 2)
    if ($userInfo.Count -ne 2) {
        Fail "$Label must contain a username and password."
    }

    $username = [System.Uri]::UnescapeDataString($userInfo[0])
    $password = [System.Uri]::UnescapeDataString($userInfo[1])
    $database = [System.Uri]::UnescapeDataString($uri.AbsolutePath.TrimStart('/'))
    $port = if ($uri.IsDefaultPort) { 5432 } else { $uri.Port }

    if ([string]::IsNullOrWhiteSpace($username) -or
        [string]::IsNullOrWhiteSpace($password) -or
        [string]::IsNullOrWhiteSpace($database)) {
        Fail "$Label is missing a required connection component."
    }

    return [pscustomobject]@{
        Host = $uri.Host
        Port = $port
        Username = $username
        Password = $password
        Database = $database
    }
}

function Invoke-Psql([string]$PsqlPath, [string]$Sql) {
    $output = & $PsqlPath -X -v ON_ERROR_STOP=1 -At -c $Sql 2>&1
    if ($LASTEXITCODE -ne 0) {
        Fail 'PostgreSQL provisioning command failed. Inspect locally; do not share credential-bearing diagnostics.'
    }
    return (($output | Out-String).Trim())
}

function Save-PgEnvironment {
    return @{
        PGHOST = $env:PGHOST
        PGPORT = $env:PGPORT
        PGUSER = $env:PGUSER
        PGPASSWORD = $env:PGPASSWORD
        PGDATABASE = $env:PGDATABASE
        DATABASE_URL = $env:DATABASE_URL
    }
}

function Restore-PgEnvironment([hashtable]$Previous) {
    $env:PGHOST = $Previous.PGHOST
    $env:PGPORT = $Previous.PGPORT
    $env:PGUSER = $Previous.PGUSER
    $env:PGPASSWORD = $Previous.PGPASSWORD
    $env:PGDATABASE = $Previous.PGDATABASE
    $env:DATABASE_URL = $Previous.DATABASE_URL
}

if ($DatabaseName -notmatch $ExpectedDatabasePattern) {
    Fail "DatabaseName must match $ExpectedDatabasePattern"
}

$adminUrl = Require-EnvironmentValue $AdminUrlEnv
$migratorUrl = Require-EnvironmentValue $MigratorUrlEnv
$admin = Parse-PostgresUrl $adminUrl $AdminUrlEnv
$migrator = Parse-PostgresUrl $migratorUrl $MigratorUrlEnv

if ($migrator.Username -ne 'stockiha_migrator') {
    Fail "$MigratorUrlEnv must authenticate as stockiha_migrator."
}
if ($migrator.Database -ne $DatabaseName) {
    Fail "$MigratorUrlEnv must target the requested acceptance database."
}
if ($admin.Database -eq $DatabaseName) {
    Fail "$AdminUrlEnv must target an existing control database, not the fresh acceptance database."
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
    Fail 'sqlx CLI is required. Install the repository-compatible 0.8.x CLI before provisioning.'
}
$sqlxPath = $sqlxCommand.Source
$sqlxVersion = ((& $sqlxPath --version 2>&1 | Out-String).Trim())
if ($LASTEXITCODE -ne 0 -or $sqlxVersion -notmatch '0\.8\.') {
    Fail 'R8 acceptance requires sqlx CLI 0.8.x to match the repository SQLx line.'
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$migrationsPath = Join-Path $repoRoot 'src-tauri\migrations'
if (-not (Test-Path $migrationsPath)) {
    Fail 'Repository migrations directory was not found.'
}

$previous = Save-PgEnvironment
try {
    $env:PGHOST = $admin.Host
    $env:PGPORT = [string]$admin.Port
    $env:PGUSER = $admin.Username
    $env:PGPASSWORD = $admin.Password
    $env:PGDATABASE = $admin.Database

    $versionText = Invoke-Psql $psqlPath 'SHOW server_version_num;'
    $versionNumber = 0
    if (-not [int]::TryParse($versionText, [ref]$versionNumber) -or
        $versionNumber -lt 180000 -or $versionNumber -ge 190000) {
        Fail 'R8 acceptance provisioning requires PostgreSQL major version 18.'
    }

    $rolePosture = Invoke-Psql $psqlPath @"
SELECT CASE WHEN
    EXISTS (
        SELECT 1 FROM pg_roles
        WHERE rolname = 'stockiha_owner'
          AND NOT rolcanlogin AND NOT rolinherit AND NOT rolsuper
          AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls
    )
    AND EXISTS (
        SELECT 1 FROM pg_roles
        WHERE rolname = 'stockiha_migrator'
          AND rolcanlogin AND NOT rolinherit AND NOT rolsuper
          AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls
    )
    AND EXISTS (
        SELECT 1 FROM pg_roles
        WHERE rolname = 'stockiha_runtime'
          AND rolcanlogin AND NOT rolinherit AND NOT rolsuper
          AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls
    )
    AND EXISTS (
        SELECT 1 FROM pg_roles
        WHERE rolname = 'stockiha_backup'
          AND rolcanlogin AND NOT rolinherit AND NOT rolsuper
          AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls
    )
    AND EXISTS (
        SELECT 1
        FROM pg_auth_members am
        JOIN pg_roles granted_role ON granted_role.oid = am.roleid
        JOIN pg_roles member_role ON member_role.oid = am.member
        WHERE granted_role.rolname = 'stockiha_owner'
          AND member_role.rolname = 'stockiha_migrator'
          AND NOT am.admin_option
          AND NOT am.inherit_option
          AND am.set_option
    )
    AND (SELECT count(*) FROM pg_auth_members am JOIN pg_roles r ON r.oid = am.member WHERE r.rolname = 'stockiha_migrator') = 1
    AND (SELECT count(*) FROM pg_auth_members am JOIN pg_roles r ON r.oid = am.member WHERE r.rolname IN ('stockiha_owner','stockiha_runtime','stockiha_backup')) = 0
THEN 'OK' ELSE 'BAD' END;
"@
    if ($rolePosture -ne 'OK') {
        Fail 'Stockiha database role posture does not match the required least-privilege architecture.'
    }

    $existing = Invoke-Psql $psqlPath "SELECT count(*) FROM pg_database WHERE datname = '$DatabaseName';"
    if ($existing -ne '0') {
        Fail "Acceptance database $DatabaseName already exists. Use a new validated R8 acceptance database name."
    }

    [void](Invoke-Psql $psqlPath "CREATE DATABASE $DatabaseName WITH OWNER = stockiha_owner ENCODING = 'UTF8';")
    [void](Invoke-Psql $psqlPath "GRANT CONNECT ON DATABASE $DatabaseName TO stockiha_migrator, stockiha_runtime, stockiha_backup;")

    $env:PGDATABASE = $DatabaseName

    # SQLx creates public._sqlx_migrations before repository migrations run.
    # Grant only the schema privilege required for that metadata creation.
    # Do not change public schema ownership and do not grant table-wide rights.
    [void](Invoke-Psql $psqlPath 'REVOKE CREATE ON SCHEMA public FROM PUBLIC;')
    [void](Invoke-Psql $psqlPath 'GRANT USAGE, CREATE ON SCHEMA public TO stockiha_migrator;')

    $env:DATABASE_URL = $migratorUrl
    $firstRun = & $sqlxPath migrate run --source $migrationsPath 2>&1
    if ($LASTEXITCODE -ne 0) {
        Fail 'SQLx migration failed. This database is invalid for R8 evidence; do not repair it manually.'
    }

    $secondRun = & $sqlxPath migrate run --source $migrationsPath 2>&1
    if ($LASTEXITCODE -ne 0) {
        Fail 'Second SQLx migration verification failed. This database is invalid for R8 evidence.'
    }

    # Return to the administrator connection without ever placing credentials on a command line.
    $env:PGHOST = $admin.Host
    $env:PGPORT = [string]$admin.Port
    $env:PGUSER = $admin.Username
    $env:PGPASSWORD = $admin.Password
    $env:PGDATABASE = $DatabaseName

    $metadataOwner = Invoke-Psql $psqlPath "SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid = 'public._sqlx_migrations'::regclass;"
    if ($metadataOwner -ne 'stockiha_migrator') {
        Fail 'SQLx metadata must remain owned by stockiha_migrator.'
    }

    $latest = Invoke-Psql $psqlPath "SELECT version::text || ':' || success::text || ':' || octet_length(checksum)::text FROM public._sqlx_migrations ORDER BY version DESC LIMIT 1;"
    if ($latest -ne "$ExpectedSchemaVersion:true:48") {
        Fail 'SQLx migration metadata does not match the expected R8 schema version/checksum shape.'
    }

    $schemaVersion = Invoke-Psql $psqlPath 'SELECT migration_version::text FROM operations.schema_state WHERE singleton;'
    if ($schemaVersion -ne $ExpectedSchemaVersion) {
        Fail 'operations.schema_state does not match the expected R8 schema version.'
    }

    $backupAcl = Invoke-Psql $psqlPath @"
SELECT
    has_table_privilege('stockiha_backup', 'public._sqlx_migrations', 'SELECT')::int || ':' ||
    has_table_privilege('stockiha_backup', 'public._sqlx_migrations', 'INSERT')::int || ':' ||
    has_table_privilege('stockiha_backup', 'public._sqlx_migrations', 'UPDATE')::int || ':' ||
    has_table_privilege('stockiha_backup', 'public._sqlx_migrations', 'DELETE')::int || ':' ||
    has_table_privilege('stockiha_backup', 'public._sqlx_migrations', 'TRUNCATE')::int;
"@
    if ($backupAcl -ne '1:0:0:0:0') {
        Fail 'Backup ACL for SQLx metadata is not read-only.'
    }

    $runtimeCreate = Invoke-Psql $psqlPath "SELECT has_schema_privilege('stockiha_runtime', 'public', 'CREATE')::int;"
    if ($runtimeCreate -ne '0') {
        Fail 'stockiha_runtime must not have CREATE on public schema.'
    }

    Write-Host 'R8 acceptance database provisioning: PASS'
    Write-Host "Database: $DatabaseName"
    Write-Host 'PostgreSQL major: 18'
    Write-Host "SQLx CLI: $sqlxVersion"
    Write-Host 'SQLx metadata owner: stockiha_migrator'
    Write-Host "Schema version: $ExpectedSchemaVersion"
    Write-Host 'Manual schema ownership repair: NO'
    Write-Host 'Manual SQLx metadata ownership repair: NO'
    Write-Host 'Broad table grants to migrator: NO'
}
finally {
    Restore-PgEnvironment $previous
}
