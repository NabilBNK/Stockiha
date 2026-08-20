Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Fail([string]$Message) {
    Write-Error $Message
    exit 1
}

$pgBin = 'C:\Program Files\PostgreSQL\18\bin'
if (-not (Test-Path -LiteralPath $pgBin)) {
    $pgCtlCmd = Get-Command pg_ctl.exe -ErrorAction SilentlyContinue
    if ($pgCtlCmd) {
        $pgBin = Split-Path -Parent $pgCtlCmd.Source
    } else {
        Fail "PostgreSQL 18 binaries not found at '$pgBin' and pg_ctl.exe is not in PATH."
    }
}

$pgCtl = Join-Path $pgBin 'pg_ctl.exe'
$pgIsReady = Join-Path $pgBin 'pg_isready.exe'
$initdb = Join-Path $pgBin 'initdb.exe'

$dataDir = Join-Path $env:LOCALAPPDATA 'Stockiha\r8-acceptance\data-55433'
$port = 5433

# 1. Idempotent initdb if PG_VERSION is missing
$pgVersionPath = Join-Path $dataDir 'PG_VERSION'
if (-not (Test-Path -LiteralPath $pgVersionPath)) {
    Write-Host "PostgreSQL data directory not initialised at: $dataDir"
    Write-Host "Running initdb..."
    $parentDir = Split-Path -Parent $dataDir
    if (-not (Test-Path -LiteralPath $parentDir)) {
        New-Item -ItemType Directory -Path $parentDir -Force | Out-Null
    }
    & $initdb -D $dataDir -E UTF8 --locale=C -U postgres -A trust
    if ($LASTEXITCODE -ne 0) {
        Fail "initdb failed to initialise cluster at $dataDir (exit code: $LASTEXITCODE)."
    }
}

# 2. Check if port 5433 is already bound
$tcpConn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if ($tcpConn) {
    # Port is bound. Verify whether it belongs to OUR exact cluster
    $ctlStatus = & $pgCtl status -D $dataDir 2>&1 | Out-String
    $isReadyOutput = & $pgIsReady -h 127.0.0.1 -p $port 2>&1 | Out-String
    
    if (($LASTEXITCODE -eq 0 -or $isReadyOutput -match 'accepting connections') -and ($ctlStatus -match 'server is running')) {
        Write-Host ('[OK] PostgreSQL is accepting connections on port ' + $port + '.')
        exit 0
    } else {
        Fail "port $port is in use by a different process/cluster - resolve manually"
    }
}

# 3. Port is not bound, so start OUR cluster using pg_ctl
Write-Host "Starting PostgreSQL cluster on port $port..."
& $pgCtl start -D $dataDir -o "-p $port" 2>&1 | Out-Host

# 4. Poll pg_isready in a real loop up to 15s (checking every 1s)
$ready = $false
$maxAttempts = 15
for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
    Start-Sleep -Seconds 1
    $isReadyResult = & $pgIsReady -h 127.0.0.1 -p $port 2>&1 | Out-String
    if ($LASTEXITCODE -eq 0 -or $isReadyResult -match 'accepting connections') {
        $ready = $true
        break
    }
}

if (-not $ready) {
    Fail "PostgreSQL cluster failed to accept connections on port $port after $maxAttempts seconds. Check logs in $dataDir."
}

Write-Host ('[OK] PostgreSQL is accepting connections on port ' + $port + '.')
exit 0
