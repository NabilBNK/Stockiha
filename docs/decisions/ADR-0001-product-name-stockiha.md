# ADR-0001 — Product renamed to Stockiha

## Status

Accepted

## Context

The product was originally named GestStock Pro during initial architecture design and early scaffolding. After reviewing product identity requirements, the owning company Raqmenha decided to adopt the name Stockiha for all user-visible labels, package identifiers, installer metadata, and documentation.

## Decision

The product previously referred to as GestStock Pro is now named **Stockiha**.

All of the following shall use Stockiha:

- Application display names and window titles
- npm package name (`stockiha`)
- Rust crate names (`stockiha-backend`, `stockiha_lib`)
- Tauri product name and identifier (`com.raqmenha.stockiha`)
- Database role prefixes:
  - `geststock_owner` → `stockiha_owner`
  - `geststock_migrator` → `stockiha_migrator`
  - `geststock_runtime` → `stockiha_runtime`
  - `geststock_backup` → `stockiha_backup`
- Documentation titles and headings
- GitHub repository name (`NabilBNK/Stockiha`)

## Consequences

This is a **naming change only**. It does not alter any approved architecture decisions, security policies, financial rules, or business logic described in `final-architecture.md`.

All future agents and developers must use Stockiha exclusively. References to GestStock Pro are stale and should be corrected when encountered.
