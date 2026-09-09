<#
    WS-K-3.3 hotfix — regression test for the exact crash reported on the
    Owner's real machine: Provision-StockihaPostgres.ps1 died on its very
    first line (a $PSScriptRoot-relative Join-Path in a param() default)
    when launched the way hooks.nsh actually launches it.

    This does NOT run the real provisioning flow — it must not, on this or
    any developer machine, since that would create a real Windows service
    account, initialize a real PostgreSQL cluster, and register a real
    Windows service (see the WS-K-3.3 report's "what remains unverified"
    section for why that only happens on the Owner's own clean VM). What it
    DOES prove, for real, by actually executing the real script:

      1. Parameter binding succeeds — the required -PostgresBinDir /
         -StockihaExePath / -AppDataDir arguments bind correctly when the
         script is invoked exactly the way hooks.nsh invokes it:
         powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass
         -WindowStyle Hidden -File <script> <args>.
      2. Execution reaches the script's first real statement past the
         param()/function-definition block (its first Write-Log call,
         "Starting WS-K-2 provisioning...") — i.e. it does NOT crash on
         argument/path resolution the way it did in the reported bug.

    To stop short of any real side effect, this test runs a TEMPORARY COPY
    of the real script with a single synthetic `exit 0` inserted
    immediately after that first Write-Log call — nothing upstream of that
    insertion point is modified, so everything this test exercises (the
    param() block, Set-StrictMode, every function definition, the first
    orchestration statement) is the exact, real, unmodified code.

    Exit code 0 = the regression is confirmed fixed. Non-zero = still
    broken; the failing PowerShell error is printed verbatim.
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$realScript = Join-Path $PSScriptRoot 'Provision-StockihaPostgres.ps1'
$scratchDir = Join-Path ([System.IO.Path]::GetTempPath()) ("stockiha-smoke-{0}" -f [Guid]::NewGuid())
New-Item -ItemType Directory -Path $scratchDir -Force | Out-Null

try {
    # Build the temp copy: everything up to and including the first
    # orchestration Write-Log call, then a synthetic exit — never reaching
    # New-StockihaServiceAccount or any other real-side-effect function.
    $lines = Get-Content -LiteralPath $realScript
    $cutoffPattern = 'Write-Log "Starting WS-K-2 provisioning\.'
    $cutoffIndex = ($lines | Select-String -Pattern $cutoffPattern | Select-Object -First 1).LineNumber
    if (-not $cutoffIndex) {
        Write-Error "Could not find the expected first orchestration Write-Log line in $realScript — the script may have been restructured; update this test's cutoff pattern."
        exit 2
    }
    $truncated = $lines[0..($cutoffIndex - 1)] + 'exit 0'
    $tempScript = Join-Path $scratchDir 'Provision-StockihaPostgres.smoketest.ps1'
    Set-Content -LiteralPath $tempScript -Value $truncated -Encoding UTF8

    # Dummy paths are fine: nothing past the inserted exit ever checks
    # whether -PostgresBinDir / -StockihaExePath actually exist.
    $fakeBinDir = Join-Path $scratchDir 'win64'
    $fakeExe = Join-Path $scratchDir 'stockiha-backend.exe'
    $fakeAppData = Join-Path $scratchDir 'appdata'
    $fakeDataRoot = Join-Path $scratchDir 'programdata'
    $logPath = Join-Path $fakeDataRoot 'provisioning.log'

    # The EXACT invocation hooks.nsh uses (nsExec::ExecToLog wraps this same
    # command line; PowerShell's own argument array here is equivalent to
    # what NSIS passes, just without NSIS's string-quoting layer).
    $psExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $arguments = @(
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
        '-File', $tempScript,
        '-PostgresBinDir', $fakeBinDir,
        '-StockihaExePath', $fakeExe,
        '-AppDataDir', $fakeAppData,
        '-StockihaDataRoot', $fakeDataRoot,
        '-LogPath', $logPath
    )

    $proc = Start-Process -FilePath $psExe -ArgumentList $arguments -NoNewWindow -Wait -PassThru `
        -RedirectStandardOutput (Join-Path $scratchDir 'stdout.log') `
        -RedirectStandardError (Join-Path $scratchDir 'stderr.log')

    $stdout = Get-Content -LiteralPath (Join-Path $scratchDir 'stdout.log') -Raw -ErrorAction SilentlyContinue
    $stderr = Get-Content -LiteralPath (Join-Path $scratchDir 'stderr.log') -Raw -ErrorAction SilentlyContinue

    $failures = @()
    if ($proc.ExitCode -ne 0) {
        $failures += "Expected exit code 0, got $($proc.ExitCode)."
    }
    if ($stderr -and $stderr.Trim().Length -gt 0) {
        $failures += "Expected no stderr output (would indicate a parameter-binding or execution crash), got:`n$stderr"
    }
    if (-not (Test-Path -LiteralPath $logPath)) {
        $failures += "Expected $logPath to exist (proves Write-Log's first call executed) but it does not."
    } else {
        $logContent = Get-Content -LiteralPath $logPath -Raw
        if ($logContent -notmatch 'Starting WS-K-2 provisioning') {
            $failures += "provisioning.log exists but does not contain the expected 'Starting WS-K-2 provisioning' line. Content:`n$logContent"
        }
    }

    if ($failures.Count -gt 0) {
        Write-Host "FAIL — the crash may still be present:" -ForegroundColor Red
        $failures | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
        if ($stdout) { Write-Host "`n--- stdout ---`n$stdout" }
        if ($stderr) { Write-Host "`n--- stderr ---`n$stderr" }
        exit 1
    }

    Write-Host "PASS — Provision-StockihaPostgres.ps1 bound its required parameters and reached its first Write-Log call under the exact hooks.nsh invocation (powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File), with no stderr output." -ForegroundColor Green
    Write-Host "Log content: $((Get-Content -LiteralPath $logPath -Raw).Trim())"
    exit 0
} finally {
    Remove-Item -LiteralPath $scratchDir -Recurse -Force -ErrorAction SilentlyContinue
}

