# PostgreSQL Windows binaries — provenance and verification log

This directory contains the PostgreSQL 18.6 Windows x86-64 runtime
(`bin/`, `lib/`, `share/` only — `include/`, `doc/`, pgAdmin 4, and
StackBuilder were deliberately excluded; Stockiha uses none of them, and
pgAdmin 4 alone is ~686 MB), bundled as a Tauri resource per
`tauri.conf.json`'s `bundle.resources`.

## Version note

The Owner's own dev environment runs PostgreSQL **18.4**. As of this
writing, EDB's official download pages no longer offer 18.4 at all —
only 18.6 (and other current patches) are listed; 18.4 has been
superseded. **18.6** was bundled instead. PostgreSQL patch releases within
the same major version (18.x) never change the on-disk format or require
migration, so this is a safe substitution, not a deviation from the
Owner's actual deployment target (PostgreSQL major version 18).

## Verification log — 2026-09-08

**What was originally planned:** compute a SHA-256 of the downloaded
binaries and compare it against a checksum EDB publishes. **What was
found instead:** neither EDB's binaries-only download page nor
postgresql.org's Windows download page publishes any checksum for this
artifact — confirmed by direct inspection of both pages, not merely
assumed absent. There is nothing to compare against for the binaries-only
zip.

In place of a checksum, two separate facts were established. **They are
related, not chained** — read them as two independent data points, not as
one continuous proof:

1. **The EDB installer wrapper for this exact release is validly signed.**
   `postgresql-18.6-3-windows-x64.exe` (EDB's interactive one-click
   installer, downloaded from `https://get.enterprisedb.com/postgresql/postgresql-18.6-3-windows-x64.exe`,
   375,202,592 bytes) was checked with PowerShell's
   `Get-AuthenticodeSignature`:
   - **Status: `Valid`**
   - **Subject:** `CN=EnterpriseDB Corporation, O=EnterpriseDB Corporation, L=Wilmington, S=Delaware, C=US`
   - **Issuer:** `CN=DigiCert Trusted G4 Code Signing RSA4096 SHA384 2021 CA1, O="DigiCert, Inc.", C=US`
   - **Thumbprint:** `7BEDD1269FCCF7A5D95F18274750B79893C06C70`
   - **Validity:** 2026-01-30 through 2029-02-01

2. **The binaries actually bundled in this directory were extracted from
   a different, separate EDB artifact**: the binaries-only zip
   `postgresql-18.6-3-windows-x64-binaries.zip`, downloaded from
   `https://get.enterprisedb.com/postgresql/postgresql-18.6-3-windows-x64-binaries.zip`
   (344,414,106 bytes), same version string (`18.6-3`), same official
   `get.enterprisedb.com` host, over HTTPS. **These individual binaries
   (`postgres.exe`, `initdb.exe`, `pg_ctl.exe`, `pg_isready.exe`,
   `psql.exe`, and every DLL alongside them) carry no Authenticode
   signature of their own** — confirmed with the same
   `Get-AuthenticodeSignature` check, `Status: NotSigned` on every one.

**What this does and does not establish:** fact 1 proves EDB really did
sign and publish a `18.6-3` Windows release under their own verified
corporate identity. Fact 2 proves what's bundled here has the same
version string and came from the same official host as that signed
release. There is **no cryptographic link** between the two — the zip's
bytes were not extracted from inside the signed installer's payload (that
payload is a BitRock InstallBuilder format that could not be unpacked
without executing real installer logic, which was out of bounds on the
machine doing this verification). A future reader must not treat this as
equivalent to an Authenticode-verified binary; it is same-publisher,
same-version, same-host correspondence, not a signature.

**Extraction:** the binaries-only zip was extracted with `unzip`
(PowerShell's `Expand-Archive` failed on this archive's long internal
paths on this machine — a local tooling limitation, not a provenance
concern). Only `bin/`, `lib/`, and `share/` were copied into this
directory.

## Microsoft Visual C++ runtime DLLs in `bin/` (added WS-K-4.3)

`bin/` contains three files that did **not** come from the PostgreSQL zip:

- `vcruntime140.dll`
- `vcruntime140_1.dll`
- `msvcp140.dll`

**Why they are here.** PostgreSQL's Windows binaries are built with MSVC
and link against the Visual C++ runtime: 154 of the bundled binaries
import `vcruntime140.dll`, 12 import `vcruntime140_1.dll`, and 9 import
`msvcp140.dll` (measured with `dumpbin /dependents` over every `.exe` and
`.dll` in `bin/` and `lib/`). That runtime is **not** part of a clean
Windows install — it comes from the Visual C++ 2015-2022 Redistributable,
which EDB's own installer installs as one of its steps. Bundling the raw
zip binaries skipped that step, so on a fresh machine every bundled
PostgreSQL program failed to load with `0xC0000135`
(`STATUS_DLL_NOT_FOUND`) before executing a single instruction. Every
development machine worked, because Visual Studio's Build Tools leave
these same DLLs in `System32`.

**Why app-local rather than running `vc_redist.x64.exe`.** Running the
redistributable installer requires elevation and makes a machine-wide
change — which would undo the central WS-K-4 decision that installing and
setting up Stockiha needs no administrator rights at all. Placing the
DLLs beside the `.exe` files works because the executable's own directory
is first in Windows' DLL search order, and it is a deployment model
Microsoft supports explicitly (the `Redist\MSVC\...\Microsoft.VC143.CRT`
folder these were taken from exists for exactly this purpose).

**Provenance — and note this chain is stronger than the PostgreSQL
binaries' own.** Copied byte-for-byte (SHA-256 verified identical after
the copy) from
`C:\BuildTools\VC\Redist\MSVC\14.44.35112\x64\Microsoft.VC143.CRT\` on the
build machine, the redistributable folder shipped with Microsoft Visual
Studio Build Tools. All three are file version `14.44.35211.0`, and unlike
the PostgreSQL binaries above, **each one is Authenticode-signed and
verifies `Status: Valid`** — `vcruntime140.dll` and `vcruntime140_1.dll`
signed by "Microsoft Windows Software Compatibility Publisher",
`msvcp140.dll` by "Microsoft Windows Hardware Compatibility Publisher"
(checked with `Get-AuthenticodeSignature` against the copies in this
directory, not just the originals).

**Servicing caveat, stated rather than left to be discovered:** an
app-local copy does not receive Windows Update servicing the way a
machine-wide redistributable does. Security updates to the VC++ runtime
will require replacing these files and shipping a new build. That is a
real, accepted tradeoff of not requiring administrator rights.

**Guarded by a test.** `pg_process`'s
`every_visual_cpp_runtime_dependency_ships_beside_the_binaries` parses the
PE import table of every executable in `bin/` and fails if any Visual C++
runtime import is not present in this directory. It reads the files
themselves rather than asking the running system what it can resolve —
deliberately, since a machine with the redistributable installed (every
development machine) cannot otherwise detect this problem at all.

## sqlx-cli — no longer needed

WS-K-3 replaced the separately-bundled `sqlx.exe` this directory's sibling
`sqlx-cli/README.md` used to describe with a `--provision-migrate` flag on
the Stockiha binary itself (see `infrastructure::provision_cli` in the
Rust source), reusing the exact same embedded migrator the app's own
schema-version check already uses. `resources/postgres/sqlx-cli/` has been
deleted — the provenance problem it described is now avoided, not solved.
