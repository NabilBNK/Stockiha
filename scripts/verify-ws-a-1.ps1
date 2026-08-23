# Comprehensive WS-A-1 provisioning, catalog verification, and acceptance test runner
param(
    [switch]$SkipProvision
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

$localSecretRoot = Join-Path $env:LOCALAPPDATA 'Stockiha\r8-acceptance'

function Get-Secret([string]$File, [string]$EnvName) {
    $envVal = [Environment]::GetEnvironmentVariable($EnvName, 'Process')
    if (-not [string]::IsNullOrWhiteSpace($envVal)) { return $envVal.Trim() }
    $path = Join-Path $localSecretRoot $File
    if (Test-Path -LiteralPath $path) { return (Get-Content -LiteralPath $path -Raw).Trim() }
    throw "Secret $File / $EnvName not found."
}

$adminPw = Get-Secret 'admin.key' 'STOCKIHA_ADMIN_PW'
$runtimePw = Get-Secret 'runtime.key' 'STOCKIHA_RUNTIME_PW'
$DatabaseName = 'stockiha_iam_test'

if (-not $SkipProvision) {
    Write-Host "`n=== Phase 2 & 3: Provision & Migrate $DatabaseName ===" -ForegroundColor Cyan
    & "$PSScriptRoot\provision-iam-test.ps1"
    if ($LASTEXITCODE -ne 0) { throw "Provisioning failed." }
}

Write-Host "`n=== Phase 4: Direct DB Catalog & Security Verification ===" -ForegroundColor Cyan
& "$PSScriptRoot\verify-iam-catalog.ps1"
if ($LASTEXITCODE -ne 0) { throw "Direct catalog verification failed." }

Write-Host "`n=== Phase 5: Run Targeted Acceptance Test ===" -ForegroundColor Cyan
$escapedAdminPw = [System.Uri]::EscapeDataString($adminPw)
$env:STOCKIHA_TEST_DATABASE_URL = "postgres://stockiha_admin:${escapedAdminPw}@127.0.0.1:5433/${DatabaseName}?sslmode=disable"
$env:STOCKIHA_TEST_ADMIN_DATABASE_URL = $env:STOCKIHA_TEST_DATABASE_URL

cargo test --manifest-path src-tauri/Cargo.toml application::auth::tests::ws_a_1_comprehensive_iam_admin_tests -- --ignored --nocapture
if ($LASTEXITCODE -ne 0) {
    throw "WS-A-1 targeted acceptance test failed."
}

Write-Host "`n=== Phase 6: Normal Rust Unit Regression ===" -ForegroundColor Cyan
cargo test --manifest-path src-tauri/Cargo.toml --lib
if ($LASTEXITCODE -ne 0) {
    throw "Rust library unit tests failed."
}

Write-Host "`n========================================================" -ForegroundColor Green
Write-Host "WS-A-1 VERIFICATION: PASS" -ForegroundColor Green
Write-Host "========================================================" -ForegroundColor Green
