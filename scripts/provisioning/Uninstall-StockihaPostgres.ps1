<#
    WS-K-2 (K2-7) - what happens to the provisioned PostgreSQL instance when
    Stockiha is removed via Windows' normal Add/Remove Programs.

    DESIGN, and the reasoning behind it (see the WS-K-2 report's "Uninstall"
    section for the full argument):

    - The Windows service is stopped and unregistered. This is reversible in
      spirit (re-running the provisioning script recreates a service; see
      the caveat below) and removes the one thing that would otherwise keep
      running invisibly after the app itself is gone.
    - The data directory (C:\ProgramData\Stockiha\postgres\data) is NEVER
      deleted by this script, under any circumstance, by default. A shop's
      live inventory and sales ledger has no other backup this task can
      assume exists. Add/Remove Programs is a single, low-friction click - it
      can be triggered accidentally, by a well-meaning family member "cleaning
      up unused programs", or by third-party PC-cleanup software. The cost of
      wrongly keeping a few hundred MB of a stopped database around is
      trivial; the cost of wrongly destroying a shop's only copy of its data
      is not recoverable. This script does not implement a delete-everything
      path at all - if the Owner ever wants one, it should be a SEPARATE,
      explicitly-labelled action a human deliberately chooses (e.g. inside
      the app's own recovery/settings screen, after a fresh backup), never
      something bundled into "uninstall the program."
    - database.json is likewise left untouched. It is harmless once the
      service is stopped (WS-K-1's own screens correctly show
      "Database is not running" if the app is ever launched again without
      reinstalling), and leaving it means a later re-provisioning run that
      finds the data directory again does not need to reconstruct it from
      nothing.

    KNOWN GAP, stated rather than silently left for someone else to discover:
    WS-K-2's detection logic (K2-2, in Provision-StockihaPostgres.ps1) keys
    off the *Windows service* existing, not the data directory. After this
    uninstall script runs, the service is gone but the data directory
    survives - so a later fresh install's detection step will correctly see
    "no StockihaPostgreSQL service" and attempt a FRESH install (new port
    selection, new role creation) against what is now a non-empty
    C:\ProgramData\Stockiha\postgres\data. `initdb` refuses to initialize an
    already-populated directory (a loud, safe failure - not data loss), so
    the install would stop with a clear error rather than silently destroying
    anything, but it would NOT "just work" as a seamless repair. Closing this
    gap (e.g. by having detection also recognise a surviving, un-serviced
    data directory and offer a "re-register the service against existing
    data" repair path) is real, worthwhile follow-up work - flagged here
    rather than implemented, since it is not required for K2-7's stated
    scope (uninstall must not silently destroy data) and touching the
    detection decision tree deserves its own review.
#>

[CmdletBinding()]
param(
    [string]$StockihaDataRoot = (Join-Path $env:ProgramData 'Stockiha\postgres')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ServiceName = 'StockihaPostgreSQL'
$ServiceAccountName = 'StockihaPgService'
$LogPath = Join-Path $StockihaDataRoot 'uninstall.log'

function Write-Log([string]$Message) {
    $line = "[STOCKIHA-UNINSTALL] $(Get-Date -Format 'yyyy-MM-ddTHH:mm:ssK') $Message"
    Write-Host $line
    $logDir = Split-Path -Parent $LogPath
    if (Test-Path -LiteralPath $logDir) {
        Add-Content -LiteralPath $LogPath -Value $line
    }
}

$service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if (-not $service) {
    Write-Log "No '$ServiceName' service found; nothing to stop or unregister."
} else {
    if ($service.Status -eq 'Running') {
        Write-Log "Stopping '$ServiceName'..."
        Stop-Service -Name $ServiceName -Force
    }

    $pgCtl = Get-ChildItem -Path (Join-Path $StockihaDataRoot '..') -Filter 'pg_ctl.exe' -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
    $dataDir = Join-Path $StockihaDataRoot 'data'
    if ($pgCtl) {
        & $pgCtl.FullName unregister -N $ServiceName 2>&1 | ForEach-Object { Write-Log "pg_ctl unregister: $_" }
    } else {
        # Fall back to sc.exe if the bundled binaries were already removed
        # by the time uninstall runs (e.g. the app's own install directory
        # was cleaned up first). Still never touches $dataDir.
        & sc.exe delete $ServiceName 2>&1 | ForEach-Object { Write-Log "sc.exe delete: $_" }
    }
    Write-Log "Service '$ServiceName' stopped and unregistered. Data directory left untouched: $dataDir"
}

# The dedicated low-privilege Windows account is removed - it has no
# purpose once the service using it is gone, and it holds no data of its
# own (unlike the PostgreSQL data directory, which this script never
# touches).
$account = Get-LocalUser -Name $ServiceAccountName -ErrorAction SilentlyContinue
if ($account) {
    Remove-LocalUser -Name $ServiceAccountName
    Write-Log "Removed the '$ServiceAccountName' Windows service account."
}

Write-Log "Uninstall step complete. Data directory and database.json were NOT removed - see this script's header for why."
exit 0

