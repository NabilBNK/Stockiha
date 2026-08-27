[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [string]$ConnectionString = $env:STOCKIHA_DEV_DATABASE_URL,

    [Parameter(Mandatory = $false)]
    [string]$OutFile = (Join-Path $PSScriptRoot 'stockiha_bootstrap_roles_and_grants.sql')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# WS-H-1 (G1): generates a fully idempotent SQL artifact that rebuilds the
# fixed Stockiha PostgreSQL roles, their attributes, memberships, object
# ownership, and every GRANT currently in effect on the live cluster — the
# artifact a developer runs, once, against a freshly `pg_restore`d database
# (or a freshly `initdb`'d cluster) to bring authorization back to a working
# state. This script only READS the live catalog; it issues no DDL/DML of its
# own and never touches business data.
#
# Regeneration is REQUIRED whenever a migration adds a role, a GRANT, changes
# object ownership, or changes a default-privilege rule. See README.md in
# this directory for the exact command.

if ([string]::IsNullOrWhiteSpace($ConnectionString)) {
    throw 'Set -ConnectionString, or export STOCKIHA_DEV_DATABASE_URL, before running this generator.'
}

$env:PATH = "C:\Program Files\PostgreSQL\18\bin;$env:PATH"

function Invoke-Psql([string]$Sql) {
    $psqlArgs = @('--no-psqlrc', '--quiet', '--tuples-only', '--no-align', "--field-separator=$([char]0x1f)", '-v', 'ON_ERROR_STOP=1', $ConnectionString, '-c', $Sql)
    $output = & psql @psqlArgs 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "psql query failed (exit $LASTEXITCODE): $output"
    }
    return @($output | Where-Object { $_ -ne '' })
}

function Sql-Ident([string]$Name) {
    return '"' + $Name.Replace('"', '""') + '"'
}

$rolePattern = 'stockiha\_%'

Write-Host 'Introspecting roles...'
$roleRows = @(Invoke-Psql @"
SELECT rolname, rolcanlogin, rolinherit, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls, rolsuper
FROM pg_roles
WHERE rolname LIKE '$rolePattern' ESCAPE '\'
ORDER BY rolname;
"@)

Write-Host 'Introspecting role memberships...'
$membershipRows = @(Invoke-Psql @"
SELECT r.rolname, g.rolname, m.admin_option, m.inherit_option, m.set_option
FROM pg_auth_members m
JOIN pg_roles r ON r.oid = m.member
JOIN pg_roles g ON g.oid = m.roleid
WHERE r.rolname LIKE '$rolePattern' ESCAPE '\'
ORDER BY 1, 2;
"@)

Write-Host 'Introspecting predefined-role memberships (e.g. pg_read_all_settings)...'
$predefinedRows = @(Invoke-Psql @"
SELECT r.rolname, g.rolname
FROM pg_auth_members m
JOIN pg_roles r ON r.oid = m.member
JOIN pg_roles g ON g.oid = m.roleid
WHERE r.rolname LIKE '$rolePattern' ESCAPE '\'
  AND g.rolname LIKE 'pg\_%' ESCAPE '\'
ORDER BY 1, 2;
"@)

Write-Host 'Introspecting schemas (owner + ACL)...'
$schemaRows = @(Invoke-Psql @"
SELECT n.nspname, pg_get_userbyid(n.nspowner),
       COALESCE(acl.grantee_name, ''), COALESCE(acl.privilege_type, ''), COALESCE(acl.is_grantable::text, '')
FROM pg_namespace n
LEFT JOIN LATERAL (
    SELECT (aclexplode(n.nspacl)).grantee::regrole::text AS grantee_name,
           (aclexplode(n.nspacl)).privilege_type,
           (aclexplode(n.nspacl)).is_grantable
) acl ON n.nspacl IS NOT NULL
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
  AND n.nspname NOT LIKE 'pg\_%' ESCAPE '\'
ORDER BY 1, 3, 4;
"@)

Write-Host 'Introspecting tables and sequences (owner + ACL)...'
$relRows = @(Invoke-Psql @"
SELECT n.nspname, c.relname, c.relkind, pg_get_userbyid(c.relowner),
       COALESCE(acl.grantee_name, ''), COALESCE(acl.privilege_type, ''), COALESCE(acl.is_grantable::text, '')
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN LATERAL (
    SELECT (aclexplode(c.relacl)).grantee::regrole::text AS grantee_name,
           (aclexplode(c.relacl)).privilege_type,
           (aclexplode(c.relacl)).is_grantable
) acl ON c.relacl IS NOT NULL
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
  AND n.nspname NOT LIKE 'pg\_%' ESCAPE '\'
  AND c.relkind IN ('r', 'S')
ORDER BY 1, 2, 5, 6;
"@)

Write-Host 'Introspecting functions (owner + EXECUTE ACL)...'
$funcRows = @(Invoke-Psql @"
SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid), pg_get_userbyid(p.proowner),
       COALESCE(acl.grantee_name, ''), COALESCE(acl.privilege_type, ''), COALESCE(acl.is_grantable::text, '')
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
LEFT JOIN LATERAL (
    SELECT (aclexplode(p.proacl)).grantee::regrole::text AS grantee_name,
           (aclexplode(p.proacl)).privilege_type,
           (aclexplode(p.proacl)).is_grantable
) acl ON p.proacl IS NOT NULL
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
  AND n.nspname NOT LIKE 'pg\_%' ESCAPE '\'
ORDER BY 1, 2, 3, 5, 6;
"@)

Write-Host 'Introspecting default privileges...'
$defaultAclRows = @(Invoke-Psql @"
SELECT pg_get_userbyid(d.defaclrole), n.nspname, d.defaclobjtype,
       (aclexplode(d.defaclacl)).grantee::regrole::text,
       (aclexplode(d.defaclacl)).privilege_type
FROM pg_default_acl d
LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
WHERE pg_get_userbyid(d.defaclrole) LIKE '$rolePattern' ESCAPE '\'
ORDER BY 1, 2, 3, 4, 5;
"@)

Write-Host 'Confirming SECURITY DEFINER function ownership (report-only, evidence for the task report)...'
$secdefOwners = @(Invoke-Psql @"
SELECT DISTINCT pg_get_userbyid(p.proowner)
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE p.prosecdef AND n.nspname NOT IN ('pg_catalog', 'information_schema')
ORDER BY 1;
"@)

$sb = New-Object System.Text.StringBuilder
function Add-Line([string]$Text = '') { [void]$sb.AppendLine($Text) }

Add-Line '-- Stockiha recovery bootstrap: roles, attributes, memberships, ownership, and grants.'
Add-Line '-- GENERATED FILE. Do not hand-edit. Regenerate with:'
Add-Line '--   pwsh -File scripts/recovery/generate-bootstrap-roles-and-grants.ps1'
Add-Line '-- See scripts/recovery/README.md for when this must be regenerated.'
Add-Line '--'
Add-Line '-- Purpose: run this ONCE against a freshly pg_restore''d Stockiha database'
Add-Line '-- (schemas/tables/functions already exist, restored with --no-owner'
Add-Line '-- --no-privileges) to rebuild the four Stockiha roles and reapply every'
Add-Line '-- object ownership and GRANT the application depends on. Every statement'
Add-Line '-- below is idempotent: safe to run twice with no error and no further effect'
Add-Line '-- on the second run.'
Add-Line '--'
Add-Line '-- This script contains NO real password or password hash. Every CREATE ROLE'
Add-Line '-- below uses a fixed placeholder password that MUST be changed immediately'
Add-Line '-- after this script runs (see the NOTICE at the end of this file).'
Add-Line '--'
Add-Line "-- Generated: $([DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ'))"
Add-Line "-- SECURITY DEFINER function owners on the source cluster: $($secdefOwners -join ', ')"
Add-Line ''

# ---- Roles -----------------------------------------------------------------
Add-Line '-- ============================================================='
Add-Line '-- Roles (idempotent CREATE, then fixed attribute enforcement)'
Add-Line '-- ============================================================='
Add-Line 'DO $$'
Add-Line 'BEGIN'
foreach ($row in $roleRows) {
    $parts = $row -split [char]0x1f
    $name = $parts[0]
    Add-Line "    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$name') THEN"
    Add-Line "        CREATE ROLE $(Sql-Ident $name) PASSWORD 'CHANGE_ME_BOOTSTRAP_PLACEHOLDER';"
    Add-Line '    END IF;'
}
Add-Line 'END $$;'
Add-Line ''

foreach ($row in $roleRows) {
    $parts = $row -split [char]0x1f
    $name, $canLogin, $inherit, $createDb, $createRole, $replication, $bypassRls, $super = $parts
    $attrs = @()
    $attrs += if ($canLogin -eq 't') { 'LOGIN' } else { 'NOLOGIN' }
    $attrs += if ($inherit -eq 't') { 'INHERIT' } else { 'NOINHERIT' }
    $attrs += if ($super -eq 't') { 'SUPERUSER' } else { 'NOSUPERUSER' }
    $attrs += if ($createDb -eq 't') { 'CREATEDB' } else { 'NOCREATEDB' }
    $attrs += if ($createRole -eq 't') { 'CREATEROLE' } else { 'NOCREATEROLE' }
    $attrs += if ($replication -eq 't') { 'REPLICATION' } else { 'NOREPLICATION' }
    $attrs += if ($bypassRls -eq 't') { 'BYPASSRLS' } else { 'NOBYPASSRLS' }
    Add-Line "ALTER ROLE $(Sql-Ident $name) $($attrs -join ' ');"
}
Add-Line ''

if ($membershipRows.Count -gt 0) {
    Add-Line '-- ---- Role memberships -----------------------------------------'
    foreach ($row in $membershipRows) {
        $parts = $row -split [char]0x1f
        $member, $granted, $adminOpt, $inheritOpt, $setOpt = $parts
        $adminText = if ($adminOpt -eq 't') { 'TRUE' } else { 'FALSE' }
        $inheritText = if ($inheritOpt -eq 't') { 'TRUE' } else { 'FALSE' }
        $setText = if ($setOpt -eq 't') { 'TRUE' } else { 'FALSE' }
        Add-Line "GRANT $(Sql-Ident $granted) TO $(Sql-Ident $member) WITH ADMIN $adminText, INHERIT $inheritText, SET $setText;"
    }
    Add-Line ''
}

if ($predefinedRows.Count -gt 0) {
    Add-Line '-- ---- Predefined-role memberships (e.g. pg_read_all_settings) --'
    foreach ($row in $predefinedRows) {
        $parts = $row -split [char]0x1f
        $member, $predefined = $parts
        Add-Line "GRANT $(Sql-Ident $predefined) TO $(Sql-Ident $member);"
    }
    Add-Line ''
}

# ---- Schemas -----------------------------------------------------------------
Add-Line '-- ============================================================='
Add-Line '-- Schema ownership and grants'
Add-Line '-- ============================================================='
$schemaOwners = @{}
foreach ($row in $schemaRows) {
    $parts = $row -split [char]0x1f
    $schema, $owner, $grantee, $priv, $grantable = $parts
    if (-not $schemaOwners.ContainsKey($schema)) {
        $schemaOwners[$schema] = $owner
        Add-Line "ALTER SCHEMA $(Sql-Ident $schema) OWNER TO $(Sql-Ident $owner);"
    }
    if (-not [string]::IsNullOrWhiteSpace($grantee) -and $grantee -like 'stockiha_*') {
        $withGrant = if ($grantable -eq 'true') { ' WITH GRANT OPTION' } else { '' }
        Add-Line "GRANT $priv ON SCHEMA $(Sql-Ident $schema) TO $(Sql-Ident $grantee)$withGrant;"
    }
}
Add-Line ''

# ---- Tables and sequences -----------------------------------------------------
Add-Line '-- ============================================================='
Add-Line '-- Table and sequence ownership and grants'
Add-Line '-- ============================================================='
$relOwners = @{}
foreach ($row in $relRows) {
    $parts = $row -split [char]0x1f
    $schema, $rel, $kind, $owner, $grantee, $priv, $grantable = $parts
    $qualified = "$(Sql-Ident $schema).$(Sql-Ident $rel)"
    $kindWord = if ($kind -eq 'S') { 'SEQUENCE' } else { 'TABLE' }
    $key = "$schema.$rel"
    if (-not $relOwners.ContainsKey($key)) {
        $relOwners[$key] = $owner
        Add-Line "ALTER $kindWord $qualified OWNER TO $(Sql-Ident $owner);"
    }
    if (-not [string]::IsNullOrWhiteSpace($grantee) -and $grantee -like 'stockiha_*') {
        $withGrant = if ($grantable -eq 'true') { ' WITH GRANT OPTION' } else { '' }
        Add-Line "GRANT $priv ON $kindWord $qualified TO $(Sql-Ident $grantee)$withGrant;"
    }
}
Add-Line ''

# ---- Functions -----------------------------------------------------------------
Add-Line '-- ============================================================='
Add-Line '-- Function ownership and EXECUTE grants'
Add-Line '-- ============================================================='
$funcOwners = @{}
foreach ($row in $funcRows) {
    $parts = $row -split [char]0x1f
    $schema, $func, $args, $owner, $grantee, $priv, $grantable = $parts
    $signature = "$(Sql-Ident $schema).$(Sql-Ident $func)($args)"
    $key = "$schema.$func($args)"
    if (-not $funcOwners.ContainsKey($key)) {
        $funcOwners[$key] = $owner
        Add-Line "ALTER FUNCTION $signature OWNER TO $(Sql-Ident $owner);"
    }
    if (-not [string]::IsNullOrWhiteSpace($grantee) -and $grantee -like 'stockiha_*') {
        $withGrant = if ($grantable -eq 'true') { ' WITH GRANT OPTION' } else { '' }
        Add-Line "GRANT $priv ON FUNCTION $signature TO $(Sql-Ident $grantee)$withGrant;"
    }
}
Add-Line ''

# ---- Default privileges -----------------------------------------------------
Add-Line '-- ============================================================='
Add-Line '-- Default privileges (future objects created by the owner role)'
Add-Line '-- ============================================================='
foreach ($row in $defaultAclRows) {
    $parts = $row -split [char]0x1f
    $defRole, $schema, $objType, $grantee, $priv = $parts
    if ([string]::IsNullOrWhiteSpace($grantee) -or $grantee -notlike 'stockiha_*') { continue }
    $objWord = switch ($objType) {
        'r' { 'TABLES' }
        'S' { 'SEQUENCES' }
        'f' { 'FUNCTIONS' }
        'T' { 'TYPES' }
        default { $null }
    }
    if ($null -eq $objWord) { continue }
    if ([string]::IsNullOrWhiteSpace($schema)) {
        Add-Line "ALTER DEFAULT PRIVILEGES FOR ROLE $(Sql-Ident $defRole) GRANT $priv ON $objWord TO $(Sql-Ident $grantee);"
    } else {
        Add-Line "ALTER DEFAULT PRIVILEGES FOR ROLE $(Sql-Ident $defRole) IN SCHEMA $(Sql-Ident $schema) GRANT $priv ON $objWord TO $(Sql-Ident $grantee);"
    }
}
Add-Line ''

Add-Line '-- ============================================================='
Add-Line '-- REQUIRED MANUAL STEP AFTER RUNNING THIS SCRIPT'
Add-Line '-- ============================================================='
Add-Line '-- Every role created above was given the placeholder password'
Add-Line "-- ''CHANGE_ME_BOOTSTRAP_PLACEHOLDER''. Immediately after this script"
Add-Line '-- succeeds, set each role''s real password, e.g.:'
Add-Line '--   ALTER ROLE stockiha_runtime PASSWORD ''<value from Credential Manager or runtime.key>'';'
Add-Line '--   ALTER ROLE stockiha_migrator PASSWORD ''<...>'';'
Add-Line '--   ALTER ROLE stockiha_backup PASSWORD ''<...>'';'
Add-Line '-- Do this interactively (psql \password) so the value is never captured in'
Add-Line '-- shell history or a script argument. See docs/recovery/RESTORE_PROCEDURE.md.'

$content = $sb.ToString()
Set-Content -LiteralPath $OutFile -Value $content -NoNewline -Encoding UTF8
Write-Host "Wrote $OutFile ($((Get-Item $OutFile).Length) bytes)"
