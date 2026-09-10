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
    & $initdb -D $dataDir -E UTF8 --locale=C -U stockiha_admin -A trust
    if ($LASTEXITCODE -ne 0) {
        Fail "initdb failed to initialise cluster at $dataDir (exit code: $LASTEXITCODE)."
    }
}

# 2. Check if port 5433 is already bound
$tcpConns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if ($tcpConns) {
    $owningPids = $tcpConns | Select-Object -ExpandProperty OwningProcess -Unique
    $postmasterPidFile = Join-Path $dataDir 'postmaster.pid'
    $expectedPid = $null
    if (Test-Path -LiteralPath $postmasterPidFile) {
        try {
            $pidLines = Get-Content -LiteralPath $postmasterPidFile -ErrorAction SilentlyContinue
            if ($pidLines -and $pidLines.Count -ge 1) {
                $expectedPid = [int]$pidLines[0].Trim()
            }
        } catch {}
    }

    $isOurCluster = $false
    $isAccepting = $false

    # Quick test with pg_isready
    $readyOutput = (& $pgIsReady -h 127.0.0.1 -p $port -U stockiha_admin 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -eq 0 -or $readyOutput -match 'accepting connections' -or $readyOutput -match 'accepte des connexions') {
        $isAccepting = $true
    }

    # Verify if the process matches our data directory
    foreach ($pidNum in $owningPids) {
        if ($expectedPid -and $pidNum -eq $expectedPid) {
            $isOurCluster = $true
            break
        }
        try {
            $wmiProc = Get-CimInstance Win32_Process -Filter "ProcessId = $pidNum" -ErrorAction SilentlyContinue
            if ($wmiProc -and $wmiProc.CommandLine) {
                if ($wmiProc.CommandLine.IndexOf('data-55433', [StringComparison]::OrdinalIgnoreCase) -ge 0) {
                    $isOurCluster = $true
                    break
                }
            }
        } catch {}
    }

    # Check with pg_ctl status as well
    $ctlStatus = (& $pgCtl status -D $dataDir 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -eq 0 -or $ctlStatus -match 'running' -or $ctlStatus -match 'fonctionne') {
        $isOurCluster = $true
    }

    if ($isOurCluster -and $isAccepting) {
        Write-Host ('[OK] PostgreSQL is accepting connections on port ' + $port + '.')
        exit 0
    }

    # If it is our cluster but NOT accepting connections (zombie or hung process)
    if ($isOurCluster -and -not $isAccepting) {
        Write-Host "PostgreSQL process on port $port ($dataDir) is unresponsive. Stopping it..."
        foreach ($pidNum in $owningPids) {
            Stop-Process -Id $pidNum -Force -ErrorAction SilentlyContinue
        }
        Start-Sleep -Seconds 1
        if (Test-Path -LiteralPath $postmasterPidFile) {
            Remove-Item -LiteralPath $postmasterPidFile -Force -ErrorAction SilentlyContinue
        }
    } else {
        # Check if the process is a postgres.exe with data-55433
        $killedAny = $false
        foreach ($pidNum in $owningPids) {
            $proc = Get-Process -Id $pidNum -ErrorAction SilentlyContinue
            if ($proc -and $proc.ProcessName -eq 'postgres') {
                Write-Host "Stopping stale postgres process $pidNum on port $port..."
                Stop-Process -Id $pidNum -Force -ErrorAction SilentlyContinue
                $killedAny = $true
            }
        }
        if ($killedAny) {
            Start-Sleep -Seconds 1
            if (Test-Path -LiteralPath $postmasterPidFile) {
                Remove-Item -LiteralPath $postmasterPidFile -Force -ErrorAction SilentlyContinue
            }
        } else {
            $procDetails = ($owningPids | ForEach-Object { 
                $p = Get-Process -Id $_ -ErrorAction SilentlyContinue
                if ($p) { "$($p.ProcessName) (PID $_)" } else { "PID $_" }
            }) -join ', '
            Fail "port $port is in use by a different process ($procDetails) - resolve manually."
        }
    }
}

# 3. Port is free, start our cluster using pg_ctl
Write-Host "Starting PostgreSQL cluster on port $port..."
& $pgCtl start -D $dataDir -o "-p $port" 2>&1 | Out-Host

# 4. Poll pg_isready in a real loop up to 15s (checking every 1s)
$ready = $false
$maxAttempts = 15
for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
    Start-Sleep -Seconds 1
    $isReadyResult = (& $pgIsReady -h 127.0.0.1 -p $port -U stockiha_admin 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -eq 0 -or $isReadyResult -match 'accepting connections' -or $isReadyResult -match 'accepte des connexions') {
        $ready = $true
        break
    }
}

if (-not $ready) {
    Fail "PostgreSQL cluster failed to accept connections on port $port after $maxAttempts seconds. Check logs in $dataDir."
}

Write-Host ('[OK] PostgreSQL is accepting connections on port ' + $port + '.')
exit 0
