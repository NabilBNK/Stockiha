<#
    WS-K-2 — Bundle and unattended-provision PostgreSQL for a client install.

    Invoked once, silently, during installation on the CLIENT's own Windows
    machine (never on the Owner's dev machine — see the detection logic
    below, which refuses to touch anything it cannot positively identify as
    either "a Stockiha instance we already provisioned" or "definitely
    unrelated software"). Designed to be called from the NSIS installer
    (WS-K-3, out of scope here) as an elevated post-install step, with all
    output redirected to a log file the Owner can send back if something
    goes wrong — nothing in this script is ever interactive.

    DEPLOYMENT SHAPE (Owner-confirmed, binding): one shop, one computer.
    PostgreSQL binds to 127.0.0.1 only. No multi-machine support is built
    here, and none should be added without a fresh decision.

    WHAT THIS SCRIPT DOES NOT DO:
      - It does not download or extract the PostgreSQL binaries themselves.
        Those are expected to already be present, bundled as a Tauri
        resource, at $PostgresBinDir (see the -PostgresBinDir parameter and
        resources/postgres/README.md). K2-1's binary provenance is a
        separate, explicit decision — this script only ever *runs* what it
        is given.
      - It does not touch %LOCALAPPDATA%\Stockiha\r8-acceptance. That path
        is the Owner's own dev/acceptance environment (see
        ensure-postgres.ps1, scripts/run-sqlx-migrations.ps1) and must never
        appear in anything this script writes.
      - It does not implement the NSIS installer UI/wrapper (WS-K-3) or
        uninstall (see Uninstall-StockihaPostgres.ps1 in this directory).

    Exit codes: 0 = success (database.json written and verified working).
    Any non-zero exit means database.json was NOT written, or was written
    but this script detected it doesn't work and removed it again — see
    "K2-6 failure handling" in the WS-K-2 report for the full design this
    implements. Every failure path logs a plain-language line prefixed
    [STOCKIHA-PROVISION] so an installer log capturing stdout/stderr is
    enough to diagnose remotely; nothing here ever opens an interactive
    prompt (no psql shell, no GUI installer dialog).
#>

[CmdletBinding()]
param(
    # Where the bundled PostgreSQL binaries already are (extracted from the
    # Tauri NSIS resource before this script runs — see K2-1 in the report).
    [string]$PostgresBinDir = (Join-Path $PSScriptRoot '..\..\resources\postgres\win64'),

    # Root of everything this script creates: the data directory, logs, and
    # the instance marker. Deliberately NOT %LOCALAPPDATA% (see module
    # header) and deliberately NOT inside the app's own install directory
    # (so it survives an app reinstall/upgrade, and so a full uninstall can
    # remove it as one clean tree without touching the app's Program Files
    # entry). ProgramData is the correct Windows location for state owned by
    # a Windows SERVICE rather than by a specific logged-in user.
    [string]$StockihaDataRoot = (Join-Path $env:ProgramData 'Stockiha\postgres'),

    # Preferred port. Deliberately not 5432 (the universal PostgreSQL
    # default, most likely to collide with unrelated software) and
    # deliberately not 5433 (the Owner's own dev/acceptance port — a client
    # machine won't have that instance, but reusing the number invites the
    # exact "which one am I talking to" confusion WS-K-1's incident report
    # already documented once).
    [int]$PreferredPort = 55432,

    # Where the running app will read its connection from (WS-K-1's own
    # format). Must match Tauri's app_data_dir() for identifier
    # "com.raqmenha.stockiha" — passed in explicitly rather than
    # hard-derived here, since only the Tauri side truly knows that path;
    # the NSIS installer step is expected to resolve it and pass it in.
    [Parameter(Mandatory = $true)]
    [string]$AppDataDir,

    [string]$DatabaseName = 'stockiha_shop',

    [string]$LogPath = (Join-Path $env:ProgramData 'Stockiha\postgres\provisioning.log')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ServiceName = 'StockihaPostgreSQL'
$ServiceAccountName = 'StockihaPgService'
$InstanceMarkerFileName = 'stockiha-instance.json'
$RolesForBootstrap = @('stockiha_admin', 'stockiha_backup', 'stockiha_migrator', 'stockiha_owner', 'stockiha_runtime')

# ——— logging: every line also goes to $LogPath, prefixed, never containing
# a password — see Write-Redacted below, the only function allowed to log a
# value that came from a generated credential. ———
function Write-Log([string]$Message) {
    $line = "[STOCKIHA-PROVISION] $(Get-Date -Format 'yyyy-MM-ddTHH:mm:ssK') $Message"
    Write-Host $line
    $logDir = Split-Path -Parent $LogPath
    if (-not (Test-Path -LiteralPath $logDir)) {
        New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    }
    Add-Content -LiteralPath $LogPath -Value $line
}

function Fail([string]$Message) {
    Write-Log "FAILED: $Message"
    exit 1
}

# ═══════════════════════════════════════════════════════════════════
# K2-6 — credential generation. Never a fixed or bundled password, never
# the bootstrap script's 'CHANGE_ME_BOOTSTRAP_PLACEHOLDER'. 32 bytes of
# CSPRNG output (via .NET's RandomNumberGenerator, not System.Random),
# base64-encoded then stripped of characters PostgreSQL's password syntax
# or a connection URL could ever need escaping for for defense in depth
# even though WS-K-1's writer never builds a URL string from this value.
# ═══════════════════════════════════════════════════════════════════
function New-StockihaPassword {
    $bytes = [byte[]]::new(32)
    [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
    $b64 = [Convert]::ToBase64String($bytes)
    return ($b64 -replace '[+/=]', '')
}

# ═══════════════════════════════════════════════════════════════════
# K2-2 — DETECT BEFORE ACTING.
# ═══════════════════════════════════════════════════════════════════
<#
  Decision tree (verbatim, matches the report):

  1. Does the Windows service $ServiceName ("StockihaPostgreSQL") exist?
     - YES:
       a. Does $StockihaDataRoot\$InstanceMarkerFileName exist and parse as
          the expected JSON shape (product == "stockiha")?
          - YES -> EXISTING STOCKIHA INSTANCE. Upgrade/repair path:
            * Do NOT recreate roles. Do NOT re-run role creation with new
              random passwords. Do NOT drop or reinitialize anything.
            * Ensure the service is Running (start it if Stopped; never
              reinitialize its data directory).
            * If $AppDataDir\database.json already exists, leave it
              untouched and verify it connects (see Test-DatabaseJsonWorks).
            * If database.json is MISSING (e.g. the app was reinstalled but
              ProgramData survived, or a previous provisioning run crashed
              after creating the instance but before writing the file):
              this is the one case where a password RESET is the correct,
              safe repair — resetting stockiha_runtime's password never
              touches data, unlike recreating the role. Generate a fresh
              password, ALTER ROLE stockiha_runtime PASSWORD, write
              database.json with it, and verify it connects.
          - NO (service exists, no valid marker) -> CANNOT CONFIDENTLY
            IDENTIFY. Per the WS-K-2 stop condition: do not guess, do not
            touch it, do not install anything else that could collide with
            it. Fail loudly with a message telling the Owner exactly what
            was found, so a human decides.
     - NO -> proceed to step 2 (nothing Stockiha-branded exists yet).

  2. Is $PreferredPort already bound by anything (Stockiha's or not)?
     - Also, independently, is there any OTHER Windows service whose name
       matches a common PostgreSQL pattern (postgresql-x64-*, postgresql*,
       *postgres*) that is NOT $ServiceName? This is reported (so the
       report/log names what else is on the machine) but never touched,
       never queried, never connected to — K2-2 forbids reusing or sharing
       an unrelated instance, and the safest way to honor that is to never
       even attempt to authenticate against it.
     - If $PreferredPort is free -> use it.
     - If taken -> probe a small fixed set of alternate candidate ports
       (55432 range +1..+9), verifying each with an actual local TCP bind
       test (not just "nothing answered a connect", which can't distinguish
       "free" from "firewalled") before selecting it. If every candidate in
       the range is taken, fail loudly rather than picking blindly further
       up a range that starts overlapping likely-dynamic/ephemeral ports.

  3. No existing Stockiha instance, a free port confirmed -> fresh install
     (K2-3/K2-4).
#>

function Get-StockihaInstanceMarker {
    $markerPath = Join-Path $StockihaDataRoot $InstanceMarkerFileName
    if (-not (Test-Path -LiteralPath $markerPath)) {
        return $null
    }
    try {
        $json = Get-Content -LiteralPath $markerPath -Raw | ConvertFrom-Json
    } catch {
        return $null
    }
    if ($null -eq $json.product -or $json.product -ne 'stockiha') {
        return $null
    }
    return $json
}

function Test-PortFree([int]$Port) {
    # An actual bind attempt, not a connect attempt: a connect can fail for
    # reasons (firewall, service starting up) that don't mean the port is
    # free, and can succeed against something that will refuse OUR bind a
    # moment later. Binding and immediately releasing is the only check
    # that actually answers "can I use this port."
    $listener = $null
    try {
        $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
        $listener.Start()
        return $true
    } catch {
        return $false
    } finally {
        if ($listener) { $listener.Stop() }
    }
}

function Find-StockihaPort([int]$Preferred) {
    if (Test-PortFree $Preferred) {
        return $Preferred
    }
    Write-Log "Preferred port $Preferred is not free; probing alternates."
    for ($offset = 1; $offset -le 9; $offset++) {
        $candidate = $Preferred + $offset
        if (Test-PortFree $candidate) {
            Write-Log "Selected alternate port $candidate."
            return $candidate
        }
    }
    Fail "No free port found in the range $Preferred..$($Preferred + 9). Resolve manually before retrying."
}

function Get-OtherPostgresServices {
    # Reported only, never touched or connected to.
    Get-Service -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -ne $ServiceName -and $_.Name -match '(?i)postgres' } |
        Select-Object -ExpandProperty Name
}

# ═══════════════════════════════════════════════════════════════════
# K2-3 — silent install: register the PostgreSQL service.
# ═══════════════════════════════════════════════════════════════════
<#
  Chose pg_ctl register (initdb + pg_ctl register) over invoking the EDB GUI
  installer in silent mode:
    - The EDB one-click installer's silent mode still shells out to
      initdb/pg_ctl internally, plus stackbuilder and other optional
      components Stockiha doesn't use (pgAdmin, etc.) that would only add
      installer surface and failure modes with no benefit for a bundled,
      already-extracted binary set.
    - initdb + pg_ctl register is exactly what ensure-postgres.ps1 (the
      Owner's own dev-cluster script) already does for the analogous local
      case, minus the -A trust dev shortcut, so this reuses a pattern
      already proven to work in this codebase rather than introducing a
      second installation mechanism to reason about.

  A dedicated, low-privilege Windows local service account is created for
  the service to run under ($ServiceAccountName) rather than LocalSystem:
  PostgreSQL's own startup check refuses to run as a member of the
  Administrators group, and EDB's own installer follows the identical
  pattern (a dedicated low-privilege "postgres" OS user) for the same
  reason. The account's Windows password is generated fresh, granted only
  "log on as a service", and is never written to any file this script
  produces (New-StockihaPassword output for it lives only in process
  memory for the duration of Register-StockihaPostgresService).
#>

function Grant-LogOnAsServiceRight([string]$AccountName) {
    # No built-in cmdlet exists for this (as of PowerShell 7 on Windows);
    # LsaAddAccountRights via P/Invoke is the standard, documented pattern.
    $signature = @'
using System;
using System.Runtime.InteropServices;

public static class StockihaLsaRights {
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint LsaOpenPolicy(ref LSA_UNICODE_STRING SystemName, ref LSA_OBJECT_ATTRIBUTES ObjectAttributes, int AccessMask, out IntPtr PolicyHandle);

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint LsaAddAccountRights(IntPtr PolicyHandle, IntPtr AccountSid, LSA_UNICODE_STRING[] UserRights, int CountOfRights);

    [DllImport("advapi32.dll")]
    private static extern int LsaClose(IntPtr ObjectHandle);

    [StructLayout(LayoutKind.Sequential)]
    private struct LSA_UNICODE_STRING {
        public ushort Length;
        public ushort MaximumLength;
        public IntPtr Buffer;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct LSA_OBJECT_ATTRIBUTES {
        public int Length;
        public IntPtr RootDirectory;
        public IntPtr ObjectName;
        public int Attributes;
        public IntPtr SecurityDescriptor;
        public IntPtr SecurityQualityOfService;
    }

    public static void GrantLogOnAsService(string accountName) {
        var sid = new System.Security.Principal.NTAccount(accountName)
            .Translate(typeof(System.Security.Principal.SecurityIdentifier))
            as System.Security.Principal.SecurityIdentifier;
        byte[] sidBytes = new byte[sid.BinaryLength];
        sid.GetBinaryForm(sidBytes, 0);
        IntPtr sidPtr = Marshal.AllocHGlobal(sidBytes.Length);
        Marshal.Copy(sidBytes, 0, sidPtr, sidBytes.Length);

        var objAttrs = new LSA_OBJECT_ATTRIBUTES();
        var systemName = new LSA_UNICODE_STRING();
        IntPtr policyHandle;
        uint status = LsaOpenPolicy(ref systemName, ref objAttrs, 0x00000800 /* POLICY_CREATE_ACCOUNT */, out policyHandle);
        if (status != 0) throw new Exception("LsaOpenPolicy failed: " + status);

        string right = "SeServiceLogonRight";
        var rightStr = new LSA_UNICODE_STRING {
            Buffer = Marshal.StringToHGlobalUni(right),
            Length = (ushort)(right.Length * 2),
            MaximumLength = (ushort)((right.Length + 1) * 2)
        };
        var rights = new LSA_UNICODE_STRING[] { rightStr };

        status = LsaAddAccountRights(policyHandle, sidPtr, rights, 1);
        Marshal.FreeHGlobal(rightStr.Buffer);
        Marshal.FreeHGlobal(sidPtr);
        LsaClose(policyHandle);
        if (status != 0) throw new Exception("LsaAddAccountRights failed: " + status);
    }
}
'@
    if (-not ([System.Management.Automation.PSTypeName]'StockihaLsaRights').Type) {
        Add-Type -TypeDefinition $signature -Language CSharp
    }
    [StockihaLsaRights]::GrantLogOnAsService($AccountName)
}

function New-StockihaServiceAccount {
    # SecureString password for the *Windows* account (distinct from any
    # PostgreSQL role password) — used only transiently to register the
    # service and is never persisted.
    $windowsPassword = New-StockihaPassword
    $secure = ConvertTo-SecureString $windowsPassword -AsPlainText -Force

    $existing = Get-LocalUser -Name $ServiceAccountName -ErrorAction SilentlyContinue
    if ($existing) {
        # Repair path only reaches here if the marker/service check above
        # already decided this is NOT an existing Stockiha instance, which
        # would be a genuine inconsistency (account present, service and
        # marker absent). Treat that combination as unsafe to proceed
        # through automatically too.
        Fail "Windows account '$ServiceAccountName' already exists but no Stockiha service/marker was found. Resolve manually before retrying."
    }

    New-LocalUser -Name $ServiceAccountName -Password $secure `
        -PasswordNeverExpires -UserMayNotChangePassword `
        -Description 'Stockiha PostgreSQL service account (created by Stockiha installer; do not log in interactively)' `
        | Out-Null
    Grant-LogOnAsServiceRight ".\$ServiceAccountName"

    return $secure
}

function Initialize-StockihaCluster([string]$DataDir, [SecureString]$AdminPassword) {
    $initdb = Join-Path $PostgresBinDir 'initdb.exe'
    if (-not (Test-Path -LiteralPath $initdb)) {
        Fail "PostgreSQL binaries not found at $PostgresBinDir (expected initdb.exe). Bundled resource extraction must run before this script."
    }
    New-Item -ItemType Directory -Path $DataDir -Force | Out-Null

    $pwFile = [System.IO.Path]::GetTempFileName()
    try {
        $plainAdminPassword = [System.Net.NetworkCredential]::new('', $AdminPassword).Password
        Set-Content -LiteralPath $pwFile -Value $plainAdminPassword -NoNewline -Encoding ascii

        # -U stockiha_admin: stockiha_admin becomes the cluster's own
        # bootstrap superuser directly (matching ensure-postgres.ps1's
        # existing pattern), so no separate throwaway "postgres" identity
        # is ever created or needs cleaning up.
        # -A scram-sha-256: PostgreSQL 18's own default and the only
        # acceptable choice here — ensure-postgres.ps1's "-A trust" is a
        # dev-only shortcut that must never reach a client machine.
        & $initdb -D $DataDir -E UTF8 --locale=C -U stockiha_admin `
            -A scram-sha-256 --pwfile=$pwFile --auth-host=scram-sha-256 --auth-local=scram-sha-256 2>&1 |
            ForEach-Object { Write-Log "initdb: $_" }
        if ($LASTEXITCODE -ne 0) {
            Fail "initdb failed (exit code $LASTEXITCODE). See the log above for the underlying reason."
        }
    } finally {
        Remove-Item -LiteralPath $pwFile -Force -ErrorAction SilentlyContinue
    }
}

function Set-StockihaClusterConfig([string]$DataDir, [int]$Port) {
    # K2-3: loopback only, never 0.0.0.0, never any other interface. These
    # two lines are the entire network-exposure surface of this cluster —
    # reported verbatim in the WS-K-2 report and re-verified by the manual
    # script's step 4.
    Add-Content -LiteralPath (Join-Path $DataDir 'postgresql.conf') -Value @"

# --- Stockiha WS-K-2 provisioning: appended, not templated, so a future
# `initdb` re-run (never done by this script, but documented for clarity)
# would not need this logic duplicated elsewhere. ---
listen_addresses = '127.0.0.1'
port = $Port
"@

    # pg_hba.conf: scram-sha-256 for every local/host entry, no 'trust'
    # anywhere. initdb with --auth-host/--auth-local above already wrote
    # this file correctly; this is a defensive re-assertion in case a
    # future PostgreSQL version's initdb default ever changes silently.
    $hbaPath = Join-Path $DataDir 'pg_hba.conf'
    $hba = @"
# Stockiha WS-K-2: loopback-only, password-authenticated. No trust, no
# network-exposed entries. Regenerated by the installer; do not hand-edit.
local   all             all                                     scram-sha-256
host    all             all             127.0.0.1/32            scram-sha-256
host    all             all             ::1/128                 scram-sha-256
"@
    Set-Content -LiteralPath $hbaPath -Value $hba -Encoding ascii
}

function Register-StockihaPostgresService([string]$DataDir, [SecureString]$WindowsAccountPassword) {
    $pgCtl = Join-Path $PostgresBinDir 'pg_ctl.exe'
    $plainPw = [System.Net.NetworkCredential]::new('', $WindowsAccountPassword).Password
    & $pgCtl register -N $ServiceName -D $DataDir -U ".\$ServiceAccountName" -P $plainPw -w -s 2>&1 |
        ForEach-Object { Write-Log "pg_ctl register: $_" }
    if ($LASTEXITCODE -ne 0) {
        Fail "Registering the '$ServiceName' Windows service failed (exit code $LASTEXITCODE)."
    }

    Set-Service -Name $ServiceName -StartupType Automatic
    Start-Service -Name $ServiceName

    $pgIsReady = Join-Path $PostgresBinDir 'pg_isready.exe'
    $ready = $false
    for ($attempt = 1; $attempt -le 20; $attempt++) {
        Start-Sleep -Seconds 1
        $out = & $pgIsReady -h 127.0.0.1 -p $script:StockihaPort 2>&1 | Out-String
        if ($LASTEXITCODE -eq 0 -or $out -match 'accepting connections') { $ready = $true; break }
    }
    if (-not $ready) {
        Fail "The '$ServiceName' service started but PostgreSQL did not accept connections within 20s. Check the PostgreSQL log under $DataDir\log."
    }
}

# ═══════════════════════════════════════════════════════════════════
# K2-4 — roles, database, migrations, grants.
# ═══════════════════════════════════════════════════════════════════
<#
  Role attributes below are copied VERBATIM from
  scripts/recovery/stockiha_bootstrap_roles_and_grants.sql lines 42-49
  (the ALTER ROLE / GRANT membership statements) — only the password
  differs (freshly generated here, never the bootstrap file's
  'CHANGE_ME_BOOTSTRAP_PLACEHOLDER').

  What this script does NOT reproduce from that file, and why: the ~2000
  lines of per-schema/per-table/per-function ALTER ... OWNER TO / GRANT
  statements in that file exist to rebuild ownership and grants that
  pg_restore --no-owner --no-privileges stripped from an already-existing
  schema. They are not needed here, because every migration file already
  contains its own SET ROLE stockiha_owner / <DDL> / RESET ROLE block (see
  e.g. src-tauri/migrations/20260722125401_create_schemas_and_helpers.sql)
  and the stockiha_backup role's grants are themselves established by two
  migrations (20260803214300_r6_001_backup_role_read_privileges.sql,
  20260804185500_r0_001_onboarding_backup_acl.sql) that sweep every schema
  that exists at that point in the migration sequence AND set
  ALTER DEFAULT PRIVILEGES for schemas created later. Running all 148
  migrations in order against a role-provisioned-but-otherwise-empty
  database therefore reproduces the bootstrap file's entire final
  ownership/grant state as a byproduct — it is not a coincidence, it is
  the same mechanism the bootstrap file's own generator introspected in
  the first place. The one thing that must exist BEFORE migrations run,
  because migration 1 immediately does `SET ROLE stockiha_owner`, is role
  membership: GRANT stockiha_owner TO stockiha_migrator.
#>

function New-StockihaRoles([string]$Port) {
    $psql = Join-Path $PostgresBinDir 'psql.exe'
    $passwords = @{}
    foreach ($role in $RolesForBootstrap) {
        $passwords[$role] = New-StockihaPassword
    }

    # $env:PGPASSWORD carries stockiha_admin's own password for this whole
    # function (the role initdb created); PostgreSQL never logs
    # PGPASSWORD's value anywhere, and it is cleared in the finally block.
    try {
        foreach ($role in $RolesForBootstrap) {
            if ($role -eq 'stockiha_admin') { continue } # already exists, created by initdb
            $escaped = $passwords[$role] -replace "'", "''"
            $sql = "CREATE ROLE `"$role`" PASSWORD '$escaped';"
            Invoke-StockihaAdminSql -Port $Port -Database 'postgres' -Sql $sql
        }

        # Attributes copied verbatim from the bootstrap file (see doc
        # comment above) — freshly generated passwords set separately,
        # above, since ALTER ROLE ... PASSWORD and ALTER ROLE ... <attrs>
        # are independent and the bootstrap file itself issues them as
        # separate statements too.
        $attrSql = @(
            'ALTER ROLE "stockiha_admin" LOGIN INHERIT SUPERUSER CREATEDB CREATEROLE REPLICATION BYPASSRLS;'
            'ALTER ROLE "stockiha_backup" LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;'
            'ALTER ROLE "stockiha_migrator" LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;'
            'ALTER ROLE "stockiha_owner" NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;'
            'ALTER ROLE "stockiha_runtime" LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;'
            'GRANT "stockiha_owner" TO "stockiha_migrator" WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;'
        ) -join "`n"
        Invoke-StockihaAdminSql -Port $Port -Database 'postgres' -Sql $attrSql
    } catch {
        Fail "Role creation failed: $($_.Exception.Message)"
    }

    return $passwords
}

function Invoke-StockihaAdminSql([int]$Port, [string]$Database, [string]$Sql, [string]$AsUser = 'stockiha_admin') {
    $psql = Join-Path $PostgresBinDir 'psql.exe'
    $out = & $psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p $Port -U $AsUser -d $Database -c $Sql 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) {
        throw $out
    }
    return $out
}

function New-StockihaDatabase([int]$Port, [string]$DbName) {
    Invoke-StockihaAdminSql -Port $Port -Database 'postgres' `
        -Sql "CREATE DATABASE `"$DbName`" WITH OWNER stockiha_owner;"

    # Matches scripts/run-sqlx-migrations.ps1's own existing pattern
    # exactly (line ~155): grants stockiha_migrator CREATE on the public
    # schema (needed to bootstrap `_sqlx_migrations` itself) and sets the
    # per-database session default so `SET ROLE stockiha_owner` inside every
    # migration file has something to switch to.
    Invoke-StockihaAdminSql -Port $Port -Database $DbName -Sql @"
GRANT ALL ON SCHEMA public TO stockiha_owner;
GRANT USAGE, CREATE ON SCHEMA public TO stockiha_migrator;
ALTER SCHEMA public OWNER TO stockiha_owner;
ALTER ROLE stockiha_migrator IN DATABASE "$DbName" SET role = 'stockiha_owner';
"@
}

function Resolve-StockihaMigrationsPath {
    # Installed layout (see tauri.conf.json's bundle.resources): this script
    # ships at postgres\Provision-StockihaPostgres.ps1 with a sibling
    # postgres\migrations\ directory. Checked first, since that is the real
    # production path.
    $installed = Join-Path $PSScriptRoot 'migrations'
    if (Test-Path -LiteralPath $installed) {
        return $installed
    }
    # Dev/repo layout fallback, so this script is also directly runnable
    # from a checkout for local testing without needing a built bundle.
    $repoRoot = Join-Path $PSScriptRoot '..\..'
    $devPath = Join-Path $repoRoot 'src-tauri\migrations'
    if (Test-Path -LiteralPath $devPath) {
        return Resolve-Path $devPath
    }
    Fail "Could not find a migrations directory (looked for '$installed' and '$devPath')."
}

function Resolve-StockihaSqlxCli {
    # Installed layout: bundled next to this script (see tauri.conf.json's
    # bundle.resources and resources/postgres/README.md — sqlx-cli's static
    # Windows binary, not the whole Rust toolchain).
    $bundled = Join-Path $PSScriptRoot 'sqlx-cli\sqlx.exe'
    if (Test-Path -LiteralPath $bundled) {
        return $bundled
    }
    $onPath = Get-Command sqlx.exe -ErrorAction SilentlyContinue
    if ($onPath) {
        return $onPath.Source
    }
    Fail "sqlx-cli (sqlx.exe) was not found bundled at '$bundled' or on PATH. The installer must bundle it (see resources/postgres/README.md) or install it before calling this script."
}

function Invoke-StockihaMigrations([int]$Port, [string]$DbName, [string]$MigratorPassword) {
    $migrationsPath = Resolve-StockihaMigrationsPath
    $sqlxExe = Resolve-StockihaSqlxCli

    $escapedPw = [System.Uri]::EscapeDataString($MigratorPassword)
    $migrationUrl = "postgres://stockiha_migrator:$escapedPw@127.0.0.1:$Port/$DbName`?sslmode=disable"

    $env:DATABASE_URL = $migrationUrl
    try {
        # Literal tool output captured and logged verbatim — K2-4 requires
        # this, not a summary. sqlx migrate run reports each applied file
        # by name; a failure partway through stops here with a non-zero
        # exit and prints exactly which file failed.
        $output = & $sqlxExe migrate run --source $migrationsPath 2>&1 | Out-String
        Write-Log "sqlx migrate run output:`n$output"
        if ($LASTEXITCODE -ne 0) {
            # K2-6: migrations failed partway. The database is left at a
            # valid-but-behind schema version — see the report's Failure
            # Handling section for why this is safe and why the installer
            # must NOT retry or roll back here: WS-K-1's schema check
            # (infallible after the WS-K-1.2 hotfix) will detect
            # OlderThanBinary on the app's first launch and show "Database
            # needs an update" rather than crash on a missing column, which
            # is the correct, already-built outcome for exactly this case.
            Fail "Migrations failed partway (see sqlx output above). database.json will NOT be written; the app's own startup diagnostic will report the incomplete schema on first launch."
        }
    } finally {
        Remove-Item Env:\DATABASE_URL -ErrorAction SilentlyContinue
    }
}

# ═══════════════════════════════════════════════════════════════════
# K2-5 — write database.json with the tightest correct permissions, and
# ONLY after everything above is verified working (K2-6).
# ═══════════════════════════════════════════════════════════════════

function Test-DatabaseJsonWorks([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return $false }
    try {
        $config = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
    } catch {
        return $false
    }
    $psql = Join-Path $PostgresBinDir 'psql.exe'
    $env:PGPASSWORD = $config.password
    try {
        & $psql -X -v ON_ERROR_STOP=1 -h $config.host -p $config.port -U $config.user -d $config.database -Atc 'SELECT 1;' 2>&1 | Out-Null
        return ($LASTEXITCODE -eq 0)
    } finally {
        Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
    }
}

function Write-StockihaDatabaseJson([string]$AppDataDir, [string]$Host, [int]$Port, [string]$Database, [string]$User, [string]$Password) {
    if (-not (Test-Path -LiteralPath $AppDataDir)) {
        New-Item -ItemType Directory -Path $AppDataDir -Force | Out-Null
    }
    $path = Join-Path $AppDataDir 'database.json'

    $payload = [ordered]@{
        host     = $Host
        port     = $Port
        database = $Database
        user     = $User
        password = $Password
    } | ConvertTo-Json

    # Write first, then immediately tighten the ACL to owner (SYSTEM +
    # Administrators, whoever created the file) only, removing inherited
    # broad access — mirroring, at creation time, exactly what WS-K-1's
    # advisory ACL check looks for so it ideally never has anything to warn
    # about on a fresh install.
    Set-Content -LiteralPath $path -Value $payload -Encoding utf8 -NoNewline

    $acl = Get-Acl -LiteralPath $path
    $acl.SetAccessRuleProtection($true, $false) # disable inheritance, drop inherited rules
    foreach ($rule in @($acl.Access)) {
        $acl.RemoveAccessRule($rule) | Out-Null
    }
    $currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    foreach ($identity in @($currentUser, 'NT AUTHORITY\SYSTEM', 'BUILTIN\Administrators')) {
        $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
            $identity, 'FullControl', 'Allow')
        $acl.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $path -AclObject $acl

    return $path
}

function Write-StockihaInstanceMarker([string]$Port) {
    $marker = [ordered]@{
        product        = 'stockiha'
        provisioner    = 'WS-K-2.1'
        provisioned_at = (Get-Date).ToUniversalTime().ToString('o')
        port           = $Port
        service_name   = $ServiceName
    } | ConvertTo-Json
    $markerPath = Join-Path $StockihaDataRoot $InstanceMarkerFileName
    Set-Content -LiteralPath $markerPath -Value $marker -Encoding utf8 -NoNewline
}

# ═══════════════════════════════════════════════════════════════════
# Orchestration
# ═══════════════════════════════════════════════════════════════════

Write-Log "Starting WS-K-2 provisioning. AppDataDir=$AppDataDir StockihaDataRoot=$StockihaDataRoot"

$existingMarker = $null
$service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue

if ($service) {
    $existingMarker = Get-StockihaInstanceMarker
    if (-not $existingMarker) {
        Fail "A Windows service named '$ServiceName' already exists, but $StockihaDataRoot\$InstanceMarkerFileName is missing or invalid. This cannot be confidently identified as a Stockiha-provisioned instance. Stopping without touching it — a human must resolve this."
    }

    Write-Log "Existing Stockiha instance detected (service '$ServiceName', marker confirmed). Repair/upgrade path: no roles will be created or reset, no data will be touched."
    if ($service.Status -ne 'Running') {
        Start-Service -Name $ServiceName
    }

    $databaseJsonPath = Join-Path $AppDataDir 'database.json'
    if (Test-Path -LiteralPath $databaseJsonPath) {
        if (Test-DatabaseJsonWorks -Path $databaseJsonPath) {
            Write-Log "Existing database.json already works. Nothing further to do."
            exit 0
        }
        Fail "Existing database.json is present but does not connect. This is not a fresh-install scenario this script will repair automatically — a human must investigate (see the technical detail the app itself shows on its startup screen)."
    }

    Write-Log "database.json is missing for an existing instance. Repairing by resetting stockiha_runtime's password only (never role recreation, never data changes)."
    $port = $existingMarker.port
    $newRuntimePassword = New-StockihaPassword
    $escaped = $newRuntimePassword -replace "'", "''"
    Invoke-StockihaAdminSql -Port $port -Database 'postgres' -Sql "ALTER ROLE stockiha_runtime PASSWORD '$escaped';"

    $dbNameGuess = $DatabaseName
    $jsonPath = Write-StockihaDatabaseJson -AppDataDir $AppDataDir -Host '127.0.0.1' -Port $port -Database $dbNameGuess -User 'stockiha_runtime' -Password $newRuntimePassword
    if (-not (Test-DatabaseJsonWorks -Path $jsonPath)) {
        Remove-Item -LiteralPath $jsonPath -Force
        Fail "Repaired database.json still does not connect. Removed it rather than leave broken credentials behind. A human must investigate."
    }
    Write-Log "Repair complete. database.json written and verified."
    exit 0
}

$otherPg = Get-OtherPostgresServices
if ($otherPg) {
    Write-Log "Unrelated PostgreSQL service(s) detected and will NOT be touched: $($otherPg -join ', ')"
}

$script:StockihaPort = Find-StockihaPort -Preferred $PreferredPort
Write-Log "Selected port $script:StockihaPort for Stockiha's isolated PostgreSQL instance."

$dataDir = Join-Path $StockihaDataRoot 'data'
$windowsAccountPassword = New-StockihaServiceAccount
$adminPassword = New-StockihaPassword
$adminSecure = ConvertTo-SecureString $adminPassword -AsPlainText -Force

Initialize-StockihaCluster -DataDir $dataDir -AdminPassword $adminSecure
Set-StockihaClusterConfig -DataDir $dataDir -Port $script:StockihaPort
Register-StockihaPostgresService -DataDir $dataDir -WindowsAccountPassword $windowsAccountPassword

$env:PGPASSWORD = $adminPassword
try {
    $passwords = New-StockihaRoles -Port $script:StockihaPort
    New-StockihaDatabase -Port $script:StockihaPort -DbName $DatabaseName
} finally {
    Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
}

Invoke-StockihaMigrations -Port $script:StockihaPort -DbName $DatabaseName -MigratorPassword $passwords['stockiha_migrator']

# K2-6: database.json is written ONLY here, after the migrations above have
# already returned success — never before every prior step is verified.
$jsonPath = Write-StockihaDatabaseJson -AppDataDir $AppDataDir -Host '127.0.0.1' -Port $script:StockihaPort `
    -Database $DatabaseName -User 'stockiha_runtime' -Password $passwords['stockiha_runtime']

if (-not (Test-DatabaseJsonWorks -Path $jsonPath)) {
    Remove-Item -LiteralPath $jsonPath -Force
    Fail "database.json was written but does not actually connect with what was written. Removed it rather than leave broken credentials behind — the app will show 'Not set up yet' rather than a false success."
}

Write-StockihaInstanceMarker -Port $script:StockihaPort
Write-Log "Provisioning complete. Port=$script:StockihaPort Database=$DatabaseName database.json=$jsonPath"
exit 0

