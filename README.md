# Stockiha

A modular stock management, sales, procurement, and reporting desktop application built with Tauri v2, React 19, TypeScript, Vite, and Rust.

## Stack

- **Desktop Client:** Tauri v2
- **Frontend:** React 19 + TypeScript + Vite
- **Backend:** Rust (Tokio async runtime)
- **Database:** PostgreSQL 18.x (planned)
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

## Current Slice: S0-001 — Repository Foundation and Tauri Scaffold

Business modules (inventory, sales, accounting, etc.) are not yet implemented.

See `TASKS.md` for the full slice roadmap and `final-architecture.md` for the authoritative architecture.
