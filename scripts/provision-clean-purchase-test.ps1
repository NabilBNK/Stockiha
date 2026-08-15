param(
    [string]$DatabaseName = 'stockiha_r8_acceptance_purchase_test'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$BaselineSha = '851e718459abf569a309a648039d63caec3d23ad'
$ExpectedDatabasePattern = '^stockiha_r8_acceptance(?:_[a-z0-9]+)?_test$'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$CurrentMigrations = Join-Path $RepoRoot 'src-tauri\migrations'
$SecretRoot = Join-Path $env:LOCALAPPDATA 'Stockiha\r8-acceptance'
$WorktreePath = Join-Path $env:TEMP ("stockiha-r8-baseline-{0}" -f $PID)

function Fail([string]$Message) {
    throw $Message
}

function Require-Secret([string]$Path, [string]$Label) {
    if (-not (Test-Path -LiteralPath $Path)) {
        Fail "$Label is missing at $Path"
    }

    $value = (Get-Content -LiteralPath $Path -Raw).Trim()
    if ([string]::IsNullOrWhiteSpace($value)) {
        Fail "$Label is empty at $Path"
    }

    return $value
}

function Build-PostgresUrl([string]$User, [string]$Password, [string]$Database) {
    $escapedPassword = [System.Uri]::EscapeDataString($Password)
    return "postgres://${User}:${escapedPassword}@127.0.0.1:5433/${Database}"
}

function Invoke-Checked([scriptblock]$Command, [string]$FailureMessage) {
    & $Command
    if ($LASTEXITCODE -ne 0) {
        Fail "$FailureMessage (exit code $LASTEXITCODE)"
    }
}

if ($DatabaseName -notmatch $ExpectedDatabasePattern) {
    Fail "DatabaseName must match $ExpectedDatabasePattern"
}

if (-not (Test-Path -LiteralPath $CurrentMigrations)) {
    Fail "Current migrations directory is missing: $CurrentMigrations"
}

$gitCommand = Get-Command git -ErrorAction SilentlyContinue
if ($null -eq $gitCommand) {
    Fail 'git was not found in PATH.'
}
$gitPath = $gitCommand.Source

$sqlxCommand = Get-Command sqlx -ErrorAction SilentlyContinue
if ($null -eq $sqlxCommand) {
    $fallbackSqlx = Join-Path $env:USERPROFILE '.cargo\bin\sqlx.exe'
    if (-not (Test-Path -LiteralPath $fallbackSqlx)) {
        Fail 'sqlx CLI 0.8.x is required. Install sqlx-cli 0.8.6 before continuing.'
    }
    $sqlxPath = $fallbackSqlx
}
else {
    $sqlxPath = $sqlxCommand.Source
}

$sqlxVersion = ((& $sqlxPath --version 2>&1 | Out-String).Trim())
if ($LASTEXITCODE -ne 0 -or $sqlxVersion -notmatch '0\.8\.') {
    Fail "Stockiha requires sqlx CLI 0.8.x. Detected: $sqlxVersion"
}

$psqlCommand = Get-Command psql -ErrorAction SilentlyContinue
if ($null -eq $psqlCommand) {
    $fallbackPsql = 'C:\Program Files\PostgreSQL\18\bin\psql.exe'
    if (-not (Test-Path -LiteralPath $fallbackPsql)) {
        Fail 'PostgreSQL 18 psql was not found.'
    }
    $psqlPath = $fallbackPsql
}
else {
    $psqlPath = $psqlCommand.Source
}

$adminPassword = Require-Secret (Join-Path $SecretRoot 'admin.key') 'Stockiha administrator key'
$migratorPassword = Require-Secret (Join-Path $SecretRoot 'migrator.key') 'Stockiha migrator key'

$controlAdminUrl = Build-PostgresUrl 'stockiha_admin' $adminPassword 'postgres'
$targetAdminUrl = Build-PostgresUrl 'stockiha_admin' $adminPassword $DatabaseName
$targetMigratorUrl = Build-PostgresUrl 'stockiha_migrator' $migratorPassword $DatabaseName

$oldEnvironment = @{
    PGHOST = $env:PGHOST
    PGPORT = $env:PGPORT
    PGUSER = $env:PGUSER
    PGPASSWORD = $env:PGPASSWORD
    PGDATABASE = $env:PGDATABASE
    DATABASE_URL = $env:DATABASE_URL
    STOCKIHA_R8_ADMIN_MIGRATION_DATABASE_URL = $env:STOCKIHA_R8_ADMIN_MIGRATION_DATABASE_URL
    PGOPTIONS = $env:PGOPTIONS
}

try {
    Write-Host '========================================================'
    Write-Host 'Stockiha Clean Purchase Database Provisioning'
    Write-Host '========================================================'
    Write-Host "Repository: $RepoRoot"
    Write-Host "Database: $DatabaseName"
    Write-Host 'Existing diagnostic database is not modified.'
    Write-Host "SQLx CLI: $sqlxVersion"
    Write-Host "Baseline commit: $BaselineSha"
    Write-Host '========================================================'

    $existingCount = (& $psqlPath $controlAdminUrl -X -v ON_ERROR_STOP=1 -At -c "SELECT count(*) FROM pg_database WHERE datname='$DatabaseName';" 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) {
        Fail 'Could not query the PostgreSQL control database with the local administrator key.'
    }
    if ($existingCount -ne '0') {
        Fail "Target database $DatabaseName already exists. The clean provisioning path refuses to reuse or repair it."
    }

    Write-Host 'Fetching canonical R8 provisioning baseline...'
    & $gitPath -C $RepoRoot fetch origin task/r8-001-reproducible-sqlx-provisioning --quiet
    if ($LASTEXITCODE -ne 0) {
        Fail 'Could not fetch the canonical R8 provisioning branch.'
    }

    & $gitPath -C $RepoRoot cat-file -e "$BaselineSha^{commit}" 2>$null
    if ($LASTEXITCODE -ne 0) {
        Fail "Canonical baseline commit $BaselineSha is not available after fetch."
    }

    if (Test-Path -LiteralPath $WorktreePath) {
        Fail "Temporary worktree path already exists: $WorktreePath"
    }

    Write-Host 'Creating isolated canonical baseline worktree...'
    & $gitPath -C $RepoRoot worktree add --detach $WorktreePath $BaselineSha
    if ($LASTEXITCODE -ne 0) {
        Fail 'Could not create the isolated baseline worktree.'
    }

    $baselineHelper = Join-Path $WorktreePath 'scripts\r8-001-provision-acceptance-database.ps1'
    if (-not (Test-Path -LiteralPath $baselineHelper)) {
        Fail 'Canonical baseline provisioning helper is missing from the pinned baseline commit.'
    }

    $env:PGHOST = '127.0.0.1'
    $env:PGPORT = '5433'
    $env:PGUSER = 'stockiha_admin'
    $env:PGPASSWORD = $adminPassword
    $env:PGDATABASE = 'postgres'
    $env:DATABASE_URL = $targetMigratorUrl
    $env:STOCKIHA_R8_ADMIN_MIGRATION_DATABASE_URL = $targetAdminUrl
    $env:PGOPTIONS = $null

    Write-Host 'Provisioning a brand-new database through the canonical historical SQLx path...'
    & $baselineHelper -DatabaseName $DatabaseName

    Write-Host 'Canonical baseline provisioning: PASS'
    Write-Host 'Applying only migrations newer than the baseline from the current branch...'

    $bridgeGranted = $false
    $schemaUsageGranted = $false

    try {
        & $psqlPath $targetAdminUrl -X -v ON_ERROR_STOP=1 -c "GRANT USAGE ON SCHEMA procurement TO stockiha_migrator;" 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) {
            Fail 'Could not grant temporary procurement schema usage to stockiha_migrator.'
        }
        $schemaUsageGranted = $true

        & $psqlPath $targetAdminUrl -X -v ON_ERROR_STOP=1 -c "GRANT SELECT, INSERT, UPDATE ON TABLE public._sqlx_migrations TO stockiha_owner;" 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) {
            Fail 'Could not grant temporary SQLx metadata privileges to stockiha_owner.'
        }
        $bridgeGranted = $true

        $env:DATABASE_URL = $targetMigratorUrl
        & $sqlxPath migrate run --source $CurrentMigrations
        if ($LASTEXITCODE -ne 0) {
            Fail 'Current-branch pending migrations failed on the clean database.'
        }
    }
    finally {
        if ($bridgeGranted) {
            & $psqlPath $targetAdminUrl -X -v ON_ERROR_STOP=1 -c "REVOKE SELECT, INSERT, UPDATE ON TABLE public._sqlx_migrations FROM stockiha_owner;" 2>&1 | Out-Null
            if ($LASTEXITCODE -ne 0) {
                Fail 'Could not revoke temporary SQLx metadata privileges from stockiha_owner.'
            }

            $residualAcl = (& $psqlPath $targetAdminUrl -X -v ON_ERROR_STOP=1 -At -c "SELECT (has_table_privilege('stockiha_owner', 'public._sqlx_migrations', 'SELECT')::int)::text || ':' || (has_table_privilege('stockiha_owner', 'public._sqlx_migrations', 'INSERT')::int)::text || ':' || (has_table_privilege('stockiha_owner', 'public._sqlx_migrations', 'UPDATE')::int)::text;" 2>&1 | Out-String).Trim()
            if ($LASTEXITCODE -ne 0) {
                Fail 'Could not verify revocation of temporary SQLx metadata privileges.'
            }

            if ($residualAcl -ne '0:0:0') {
                Fail "Temporary metadata privileges were not fully revoked (detected residual ACL $residualAcl, expected 0:0:0)."
            }
        }

        if ($schemaUsageGranted) {
            & $psqlPath $targetAdminUrl -X -v ON_ERROR_STOP=1 -c "REVOKE USAGE ON SCHEMA procurement FROM stockiha_migrator;" 2>&1 | Out-Null
            if ($LASTEXITCODE -ne 0) {
                Fail 'Could not revoke temporary procurement schema usage from stockiha_migrator.'
            }

            $schemaUsagePrivilege = (& $psqlPath $targetAdminUrl -X -v ON_ERROR_STOP=1 -At -c "SELECT (has_schema_privilege('stockiha_migrator', 'procurement', 'USAGE')::int)::text;" 2>&1 | Out-String).Trim()
            if ($LASTEXITCODE -ne 0) {
                Fail 'Could not verify revocation of temporary procurement schema usage.'
            }

            if ($schemaUsagePrivilege -ne '0') {
                Fail "Temporary procurement schema usage was not fully revoked (detected privilege $schemaUsagePrivilege, expected 0)."
            }
        }
    }

    Write-Host 'Current-branch pending migrations: PASS'

    $latestMigration = (& $psqlPath $targetAdminUrl -X -v ON_ERROR_STOP=1 -At -c "SELECT version::text || ':' || success::text FROM public._sqlx_migrations ORDER BY version DESC LIMIT 1;" 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) {
        Fail 'Could not inspect SQLx migration metadata on the clean database.'
    }

    $purchaseDefinition = (& $psqlPath $targetAdminUrl -X -v ON_ERROR_STOP=1 -At -c "SELECT pg_get_functiondef('procurement.post_purchase_transaction(text,uuid,bytea,jsonb)'::regprocedure);" 2>&1 | Out-String)
    if ($LASTEXITCODE -ne 0) {
        Fail 'Could not inspect the installed purchase posting function.'
    }

    $digestCount = ([regex]::Matches($purchaseDefinition, 'digest\s*\(')).Count
    $coreEnqueueCount = ([regex]::Matches($purchaseDefinition, 'core\.enqueue_document_job\s*\(')).Count
    $canonicalEnqueueCount = ([regex]::Matches($purchaseDefinition, 'documents\.enqueue_business_document_jobs\s*\(')).Count

    if ($coreEnqueueCount -ne 0) {
        Fail "Clean provisioning failed: live purchase function still calls core.enqueue_document_job ($coreEnqueueCount occurrences found)."
    }

    if ($canonicalEnqueueCount -lt 1) {
        Fail "Clean provisioning failed: live purchase function does not call documents.enqueue_business_document_jobs ($canonicalEnqueueCount occurrences found)."
    }

    $coreDigestExists = (& $psqlPath $targetAdminUrl -X -v ON_ERROR_STOP=1 -At -c "SELECT (to_regprocedure('core.digest(text,text)') IS NOT NULL)::int;" 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) {
        Fail 'Could not verify the installed core.digest compatibility function.'
    }

    $purchaseDocumentKindExists = (& $psqlPath $targetAdminUrl -X -v ON_ERROR_STOP=1 -At -c "SELECT (pg_get_constraintdef(oid) LIKE '%PURCHASE_RECEIPT_PDF%')::int FROM pg_constraint WHERE conrelid='documents.generation_jobs'::regclass AND conname='generation_jobs_document_kind_valid';" 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) {
        Fail 'Could not verify the purchase receipt document-generation kind.'
    }

    Write-Host '========================================================'
    Write-Host 'CLEAN DATABASE NORMALIZATION: PASS'
    Write-Host "DATABASE=$DatabaseName"
    Write-Host "LATEST_SQLX_MIGRATION=$latestMigration"
    Write-Host 'CURRENT_BRANCH_OWNER_METADATA_BRIDGE=BOUNDED'
    Write-Host 'CURRENT_BRANCH_MIGRATOR_SCHEMA_VISIBILITY_BRIDGE=BOUNDED'
    Write-Host "CORE_DIGEST_EXISTS=$coreDigestExists"
    Write-Host "PURCHASE_RECEIPT_DOCUMENT_KIND_EXISTS=$purchaseDocumentKindExists"
    Write-Host "LIVE_PURCHASE_DIGEST_CALLS=$digestCount"
    Write-Host "LIVE_PURCHASE_CORE_ENQUEUE_CALLS=$coreEnqueueCount"
    Write-Host "LIVE_PURCHASE_CANONICAL_ENQUEUE_CALLS=$canonicalEnqueueCount"
    Write-Host 'OLD_DIAGNOSTIC_DATABASE_MODIFIED=no'
    Write-Host '========================================================'
    Write-Host 'Do not test Confirm Purchase yet. This command establishes a trustworthy clean database only.'
}
finally {
    foreach ($name in $oldEnvironment.Keys) {
        [Environment]::SetEnvironmentVariable($name, $oldEnvironment[$name], 'Process')
    }

    if (Test-Path -LiteralPath $WorktreePath) {
        & $gitPath -C $RepoRoot worktree remove --force $WorktreePath 2>$null
    }
}
