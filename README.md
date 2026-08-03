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

- `main` includes the UI foundation and S0 through the verified S4-002 cashier-session lifecycle.
- S4-003 (drawer eligibility and customer-payment refunds) is implemented in [PR #9](https://github.com/NabilBNK/Stockiha/pull/9) but remains unverified until its required Windows/Tauri acceptance gate passes.
- Supplier accounting in S3 is not production-safe and must be repaired before real financial use.
- Spreadsheet onboarding, production backup/restore, credential wiring, hardware workers, and release packaging remain unfinished.

See [`Stockiha_Audit_Redesigned_Roadmap_2026-08-02.md`](./Stockiha_Audit_Redesigned_Roadmap_2026-08-02.md) for the single authoritative architecture, verified project audit, release scope, and redesigned remaining roadmap. `CURRENT_SLICE.md` and `TASKS.md` are execution trackers and cannot override stronger code/test evidence.
