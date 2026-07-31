param(
    [switch]$SkipInstall,
    [switch]$SkipDatabase
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

function Run-Step([string]$Name, [scriptblock]$Command) {
    Write-Host "`n=== $Name ===" -ForegroundColor Cyan
    & $Command
    if ($LASTEXITCODE -ne 0) {
        throw "$Name failed with exit code $LASTEXITCODE"
    }
}

if (-not $SkipInstall) {
    Run-Step 'npm ci' { npm ci }
}
Run-Step 'TypeScript typecheck' { npm run typecheck }
Run-Step 'ESLint' { npm run lint }
Run-Step 'Vitest' { npm test -- --run }
Run-Step 'Vite build' { npm run build }
Run-Step 'Rust unit tests' { cargo test --manifest-path src-tauri/Cargo.toml --lib }

if (-not $SkipDatabase) {
    $adminUrl = $env:STOCKIHA_TEST_ADMIN_DATABASE_URL
    $runtimeUrl = $env:STOCKIHA_TEST_DATABASE_URL

    if ([string]::IsNullOrWhiteSpace($adminUrl) -or [string]::IsNullOrWhiteSpace($runtimeUrl)) {
        throw @'
Database verification requested, but the test URLs are missing.
Set both:
  STOCKIHA_TEST_ADMIN_DATABASE_URL
  STOCKIHA_TEST_DATABASE_URL
The database name MUST end with _test. Use -SkipDatabase only when doing frontend/Rust verification intentionally.
'@
    }

    foreach ($url in @($adminUrl, $runtimeUrl)) {
        $withoutQuery = ($url -split '\?')[0]
        $dbName = ($withoutQuery -split '/')[-1]
        if (-not $dbName.EndsWith('_test')) {
            throw "Refusing database verification against non-test database '$dbName'."
        }
    }

    Run-Step 'Credit-sale DB integration' {
        psql $adminUrl -X -v ON_ERROR_STOP=1 -f src-tauri/tests/receivables/s4_001_credit_sale_integration.sql
    }
    Run-Step 'Customer-payment DB integration' {
        psql $adminUrl -X -v ON_ERROR_STOP=1 -f src-tauri/tests/receivables/s4_001_customer_payment_integration.sql
    }

    $bash = Get-Command bash -ErrorAction SilentlyContinue
    if ($null -eq $bash) {
        throw 'bash is required for the two-session credit concurrency harness. Install Git for Windows/WSL or run the script from a bash-capable environment.'
    }

    Run-Step 'Credit-limit concurrency race' {
        bash src-tauri/tests/receivables/s4_001_credit_concurrency.sh
    }
}

Write-Host "`nS4-001 automated verification completed successfully." -ForegroundColor Green
Write-Host 'Manual Tauri/Windows multilingual and touchscreen smoke testing is still required before merge.' -ForegroundColor Yellow
