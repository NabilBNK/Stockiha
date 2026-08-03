# Stockiha

A modular stock management, sales, procurement, and reporting desktop application built with Tauri v2, React 19, TypeScript, Vite, and Rust.

## Stack

- **Desktop Client:** Tauri v2
- **Frontend:** React 19 + TypeScript + Vite
- **Backend:** Rust (Tokio async runtime)
- **Database:** PostgreSQL 18.x
- **Primary Language:** French (default), Arabic (full RTL), English

## Development Setup

### Prerequisites

- Node.js LTS (installed via Winget: `Microsoft.NodeJS.LTS`)
- Rust stable MSVC (`rustup target add x86_64-pc-windows-msvc`)
- Visual Studio Build Tools 2022 with C++ workload
- Windows 10 SDK (`Microsoft.WindowsSDK.10.0.22621`)

### Running in Development

```powershell
# Frontend only
$env:PATH="C:\Program Files\nodejs;$env:PATH"
npm.cmd run dev

# Full Tauri app (frontend + backend)
$env:PATH="C:\Program Files\nodejs;C:\Users\<USER>\.cargo\bin;$env:PATH"
npm.cmd run tauri dev
```

### Running Tests

```powershell
# Frontend tests (Vitest)
npm.cmd run test

# Backend tests (Rust)
$env:PATH="C:\Users\<USER>\.cargo\bin;$env:PATH"
cmd.exe /c "call C:\BuildTools\VC\Auxiliary\Build\vcvars64.bat && cargo test"
```

## Current Project Position

- `main` includes the UI foundation, S0–S4-003, and the R2 supplier-accounting repair.
- S4-003 customer-payment refunds and drawer policies were validated through exact-head CI and a focused Windows/Tauri smoke test before merge.
- Procurement now uses GRNI/AP financial semantics with Cash/Bank selection. TVA and discounts remain intentionally deferred and non-zero values are rejected.
- The next critical path is representative spreadsheet parsing, reconciled opening-state import, and a proven pilot backup/restore workflow.
- Stale S5–S7 branches are not valid future-work bases.

See [`Stockiha_Audit_Redesigned_Roadmap_2026-08-02.md`](./Stockiha_Audit_Redesigned_Roadmap_2026-08-02.md) for the target architecture and release scope.