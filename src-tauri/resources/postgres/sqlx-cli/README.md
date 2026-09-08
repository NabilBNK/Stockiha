# sqlx-cli — drop-in location

`Provision-StockihaPostgres.ps1` runs `sqlx migrate run` to apply all
`src-tauri/migrations/*.sql` files against a freshly provisioned database,
using the exact same tool (`sqlx-cli`) `scripts/run-sqlx-migrations.ps1`
already uses for the Owner's own dev/acceptance cluster — so migration
behavior is provably identical between the two paths.

A client machine has no Rust toolchain and no `cargo install`. What must
go here is **`sqlx.exe`**, the standalone, statically-linked Windows binary
for the `sqlx-cli` crate — not the whole Rust/cargo toolchain, only the one
executable.

## Version to bundle

Pin the exact version matching `src-tauri/Cargo.toml`'s `sqlx = "0.8.6"`
dependency (currently `0.8.6`), so the migrator that provisions a client
database is the same major/minor SQLx that built `_sqlx_migrations`'
expected schema (columns, checksum algorithm) that
`infrastructure::schema_version` reads.

## How to obtain and verify it (not done in this repository yet)

`sqlx-cli` does not publish a prebuilt Windows binary release directly —
building it reproducibly requires either:

- Building it yourself from the pinned `sqlx-cli` source
  (`cargo install sqlx-cli --version 0.8.6 --locked --no-default-features
  --features rustls,postgres`) on a trusted machine, then bundling the
  resulting `sqlx.exe`, or
- Sourcing a binary from a package registry you have already established
  provenance/checksum verification for (e.g. an internal build pipeline
  that builds it from the pinned source and publishes its own checksum).

Whichever path is chosen, record the exact build/source and its checksum
in this file before shipping it, matching the discipline required for the
PostgreSQL binaries in `../win64/README.md`.

## Verification log

*(Nothing has been placed here yet.)*
