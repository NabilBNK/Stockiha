param(
    [string]$AdminDatabaseUrl = $env:STOCKIHA_TEST_ADMIN_DATABASE_URL,
    [string]$RuntimeDatabaseUrl = $env:STOCKIHA_TEST_DATABASE_URL
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($AdminDatabaseUrl)) {
    throw 'STOCKIHA_TEST_ADMIN_DATABASE_URL or -AdminDatabaseUrl is required.'
}

if ([string]::IsNullOrWhiteSpace($RuntimeDatabaseUrl)) {
    throw 'STOCKIHA_TEST_DATABASE_URL or -RuntimeDatabaseUrl is required.'
}

if ($AdminDatabaseUrl -notmatch '/[^/?]+_test(?:\?|$)') {
    throw 'Refusing to run S4-003 verifier: admin database name must end with _test.'
}

$psql = (Get-Command psql -ErrorAction Stop).Source

Write-Host 'Running S4-003 drawer/refund integration assertions...'
& $psql $AdminDatabaseUrl -X -v ON_ERROR_STOP=1 -f 'src-tauri/tests/receivables/s4_003_drawer_refund_integration.sql'
if ($LASTEXITCODE -ne 0) {
    throw 'S4-003 drawer/refund integration assertions failed.'
}

Write-Host 'Verifying runtime cannot directly mutate central drawer/refund tables...'
$securityResult = & $psql $AdminDatabaseUrl -X -At -v ON_ERROR_STOP=1 -c @"
SELECT
    has_table_privilege('stockiha_runtime', 'cash.drawer_operation_policy', 'INSERT,UPDATE,DELETE')::int || ':' ||
    has_table_privilege('stockiha_runtime', 'receivables.customer_refund_authorizations', 'INSERT,UPDATE,DELETE')::int || ':' ||
    has_table_privilege('stockiha_runtime', 'receivables.customer_payment_refunds', 'INSERT,UPDATE,DELETE')::int || ':' ||
    has_table_privilege('stockiha_runtime', 'receivables.payment_refund_allocations', 'INSERT,UPDATE,DELETE')::int;
"@
if ($LASTEXITCODE -ne 0) {
    throw 'S4-003 security verification query failed.'
}
if ($securityResult.Trim() -ne '0:0:0:0') {
    throw "Runtime direct-mutation security boundary failed: $securityResult"
}

Write-Host 'PASS: S4-003 drawer/refund integration and security checks.'
