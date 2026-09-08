# PostgreSQL Windows binaries — drop-in location

WS-K-2 wires this directory into `tauri.conf.json`'s `bundle.resources`
(`resources/postgres/win64/**/*` → `postgres/win64/` inside the installed
app), but does **not** fetch or embed the actual PostgreSQL binaries in
this repository. That was an explicit decision (see the WS-K-2 report,
section "K2-1 — binary provenance"): downloading and embedding a ~300–400MB
installer is a large, consequential action that needs the Owner's own
sign-off before it happens, not something to do silently as a side effect
of an unrelated task.

## What must go here before this app can be bundled for real

The **PostgreSQL 18.4 Windows x86-64 binaries** (matching the version
already running in the Owner's own dev environment — `postgres --version`
reports `PostgreSQL 18.4` there as of this writing), specifically the
subset `Provision-StockihaPostgres.ps1` actually calls:

```
win64/
  initdb.exe
  pg_ctl.exe
  postgres.exe
  pg_isready.exe
  psql.exe
  (+ every DLL those binaries load at runtime — libpq, ICU, SSL, zlib, etc.)
```

The simplest correct way to obtain a complete, self-consistent set of these
is to extract them from the official EDB Windows x86-64 "binaries only" zip
(not the full graphical one-click installer, which also bundles
StackBuilder/pgAdmin/other components Stockiha does not use) — published at
`https://www.enterprisedb.com/download-postgresql-binaries` — or from the
official EDB one-click installer's own payload, since the same binary set
is used inside it.

## Verifying provenance before bundling — required, not optional

1. Download from the official EDB or postgresql.org-linked distribution
   channel only. Never a mirror, a search-engine ad, or a third-party
   re-host.
2. EDB publishes a SHA-256 checksum alongside each release on its download
   page. Compute the checksum of what you downloaded
   (`Get-FileHash -Algorithm SHA256 <file>` in PowerShell) and compare it
   character-for-character against the published value before extracting
   anything.
3. Only after the checksum matches: extract the `bin/` directory's contents
   (and lib/ dependencies) into this directory, replacing this README's
   placeholder status.
4. Record the exact checksum you verified and the exact URL you downloaded
   from in this file (append a dated entry below) so a future audit can
   trace exactly what shipped in a given build.

## Verification log

*(No binaries have been placed here yet — this repository ships this
directory empty except for this README. `tauri build` will need real
content here before it can produce a working installer.)*
