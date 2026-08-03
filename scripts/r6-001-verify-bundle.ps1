[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$BundlePath,

    [switch]$CreateTamperedCopy
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Fail([string]$Message) {
    throw "R6-001 verification failed: $Message"
}

function Resolve-RealDirectory([string]$Path) {
    $item = Get-Item -LiteralPath $Path -Force
    if (-not $item.PSIsContainer) {
        Fail "bundle path is not a directory"
    }
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        Fail "bundle directory is a reparse point"
    }
    return $item.FullName
}

function Resolve-ContainedFile([string]$Root, [string]$RelativePath) {
    if ([string]::IsNullOrWhiteSpace($RelativePath)) {
        Fail "checksum entry has an empty path"
    }
    if ([IO.Path]::IsPathRooted($RelativePath) -or $RelativePath.Contains('\')) {
        Fail "checksum entry uses an absolute or non-canonical path"
    }

    $components = $RelativePath.Split('/')
    foreach ($component in $components) {
        if ([string]::IsNullOrEmpty($component) -or $component -eq '.' -or $component -eq '..') {
            Fail "checksum entry contains path traversal"
        }
    }

    $nativeRelative = $RelativePath.Replace('/', [IO.Path]::DirectorySeparatorChar)
    $candidate = [IO.Path]::GetFullPath([IO.Path]::Combine($Root, $nativeRelative))
    $rootPrefix = $Root.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    if (-not $candidate.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        Fail "checksum entry escapes the bundle root"
    }

    $item = Get-Item -LiteralPath $candidate -Force
    if ($item.PSIsContainer) {
        Fail "checksum entry points to a directory"
    }
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        Fail "checksum entry points to a reparse point"
    }
    return $item
}

$bundleRoot = Resolve-RealDirectory $BundlePath
$bundleName = Split-Path -Leaf $bundleRoot
if ($bundleName -notmatch '^GestStock-Backup-\d{8}-\d{6}$') {
    Fail "bundle directory name is not canonical"
}

$checksumsPath = Join-Path $bundleRoot 'checksums.sha256'
$manifestPath = Join-Path $bundleRoot 'manifest.json'
if (-not (Test-Path -LiteralPath $checksumsPath -PathType Leaf)) {
    Fail "checksums.sha256 is missing"
}
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    Fail "manifest.json is missing"
}

$expected = @{}
foreach ($line in Get-Content -LiteralPath $checksumsPath -Encoding UTF8) {
    if ($line -notmatch '^([0-9A-Fa-f]{64})  (.+)$') {
        Fail "checksums.sha256 contains an invalid line"
    }
    $hash = $Matches[1].ToLowerInvariant()
    $relativePath = $Matches[2]
    if ($relativePath -eq 'checksums.sha256') {
        Fail "checksums.sha256 lists itself"
    }
    if ($expected.ContainsKey($relativePath)) {
        Fail "checksums.sha256 contains a duplicate path"
    }
    $expected[$relativePath] = $hash
}

if (-not $expected.ContainsKey('manifest.json')) {
    Fail "manifest.json is not covered by checksums.sha256"
}

$verifiedBytes = [uint64]0
foreach ($relativePath in ($expected.Keys | Sort-Object)) {
    $item = Resolve-ContainedFile $bundleRoot $relativePath
    $actualHash = (Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualHash -ne $expected[$relativePath]) {
        Fail "SHA-256 mismatch for $relativePath"
    }
    $verifiedBytes += [uint64]$item.Length
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($manifest.bundle_format_version -ne 1) {
    Fail "unsupported manifest bundle format version"
}
if ($manifest.database_dump_filename -ne 'database.dump') {
    Fail "manifest names an unexpected database dump"
}

$manifestPaths = @{}
foreach ($entry in $manifest.files) {
    $relativePath = [string]$entry.path
    if ($manifestPaths.ContainsKey($relativePath)) {
        Fail "manifest contains a duplicate path"
    }
    $manifestPaths[$relativePath] = $true
    if (-not $expected.ContainsKey($relativePath)) {
        Fail "manifest entry is missing from checksums.sha256: $relativePath"
    }

    $item = Resolve-ContainedFile $bundleRoot $relativePath
    if ([uint64]$item.Length -ne [uint64]$entry.size_bytes) {
        Fail "manifest size mismatch for $relativePath"
    }
    if ([string]$entry.sha256 -ne $expected[$relativePath]) {
        Fail "manifest/checksum hash disagreement for $relativePath"
    }
}

foreach ($required in @(
    'database.dump',
    'schema-version.txt',
    'application-version.txt',
    'postgres-version.txt'
)) {
    if (-not $manifestPaths.ContainsKey($required)) {
        Fail "required manifest entry is missing: $required"
    }
}

$dump = Get-Item -LiteralPath (Join-Path $bundleRoot 'database.dump')
if ($dump.Length -le 0) {
    Fail "database.dump is empty"
}

$result = [ordered]@{
    bundleIdentifier = $bundleName
    schemaVersion = [string]$manifest.schema_version
    applicationVersion = [string]$manifest.application_version
    verifiedChecksumEntries = $expected.Count
    verifiedBytes = $verifiedBytes
    integrityValid = $true
}

$result | ConvertTo-Json -Depth 3

if ($CreateTamperedCopy) {
    $parent = Split-Path -Parent $bundleRoot
    $candidateTime = [DateTime]::UtcNow
    do {
        $tamperedName = 'GestStock-Backup-' + $candidateTime.ToString('yyyyMMdd-HHmmss')
        $tamperedPath = Join-Path $parent $tamperedName
        $candidateTime = $candidateTime.AddSeconds(1)
    } while (Test-Path -LiteralPath $tamperedPath)

    Copy-Item -LiteralPath $bundleRoot -Destination $tamperedPath -Recurse
    $tamperedDump = Join-Path $tamperedPath 'database.dump'
    $stream = [IO.File]::Open($tamperedDump, [IO.FileMode]::Append, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try {
        $stream.WriteByte(0x58)
        $stream.Flush($true)
    }
    finally {
        $stream.Dispose()
    }

    [ordered]@{
        tamperedBundlePath = $tamperedPath
        expectedApplicationResult = 'BACKUP_VALIDATION_FAILED'
        originalBundleUnchanged = $true
    } | ConvertTo-Json -Depth 3
}
