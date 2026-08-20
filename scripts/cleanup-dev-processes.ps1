Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Fail([string]$Message) {
    Write-Error $Message
    exit 1
}

$repoRoot = (Split-Path -Parent $PSScriptRoot).TrimEnd('\', '/')

Write-Host "Cleaning up dev processes associated with: $repoRoot"

# Helper function to check if a process belongs to this worktree
function Test-ProcessInWorktree([int]$procId) {
    try {
        $cimProc = Get-CimInstance Win32_Process -Filter "ProcessId = $procId" -ErrorAction SilentlyContinue
        if ($null -eq $cimProc) {
            return $false
        }
        if ($cimProc.ExecutablePath -and $cimProc.ExecutablePath.StartsWith($repoRoot, [StringComparison]::OrdinalIgnoreCase)) {
            return $true
        }
        if ($cimProc.CommandLine -and ($cimProc.CommandLine.IndexOf($repoRoot, [StringComparison]::OrdinalIgnoreCase) -ge 0)) {
            return $true
        }
    } catch {
        return $false
    }
    return $false
}

# 1. Free port 1420 (Vite dev server default port)
$tcpConns = Get-NetTCPConnection -LocalPort 1420 -State Listen -ErrorAction SilentlyContinue
if ($tcpConns) {
    foreach ($conn in $tcpConns) {
        $procId = [int]$conn.OwningProcess
        if ($procId -and $procId -ne 0 -and $procId -ne $PID) {
            if (Test-ProcessInWorktree -procId $procId) {
                Write-Host "Stopping process $procId bound to port 1420 in this worktree..."
                Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
            } else {
                Fail "Port 1420 is in use by PID $procId which does not belong to this worktree ($repoRoot) - resolve manually."
            }
        }
    }
}

# 2. Stop running dev processes whose executable path or command line contains this repo root
# Targeted process names: node.exe, cargo.exe, tauri.exe, stockiha-backend.exe, stockiha.exe
$targetNames = @('node.exe', 'cargo.exe', 'tauri.exe', 'stockiha-backend.exe', 'stockiha.exe')
$wmiProcesses = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { 
    $targetNames -contains $_.Name -and $_.ProcessId -ne $PID
}

if ($wmiProcesses) {
    foreach ($proc in $wmiProcesses) {
        $belongsToRepo = $false
        if ($proc.ExecutablePath -and $proc.ExecutablePath.StartsWith($repoRoot, [StringComparison]::OrdinalIgnoreCase)) {
            $belongsToRepo = $true
        } elseif ($proc.CommandLine -and ($proc.CommandLine.IndexOf($repoRoot, [StringComparison]::OrdinalIgnoreCase) -ge 0)) {
            $belongsToRepo = $true
        }

        if ($belongsToRepo) {
            Write-Host "Stopping $($proc.Name) (PID: $($proc.ProcessId)) associated with this worktree..."
            Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
        }
    }
}

Write-Host "[OK] Dev process cleanup complete."
exit 0
