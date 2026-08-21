# Stockiha

A modular stock management, sales, procurement, financial accounting, and reporting desktop application built with Tauri v2, React 19, TypeScript, Vite, and Rust.

> ## ⚠️ Current Source of Truth
>
> **[`STOCKIHA_GROUND_TRUTH.md`](./STOCKIHA_GROUND_TRUTH.md) is the ONLY current product/roadmap ground-truth document.**
>
> Do not use old PR/R/S/Slice roadmaps as current planning authority. Historical documents are isolated under [`old-documents/`](./old-documents/).

## Current Project Position

Stockiha is in **MVP completion and stabilization under deadline pressure**. Work is prioritized by business criticality, dependency, risk, and speed-to-MVP.

### MVP target

**Setup → Authentication → Users/RBAC → Products → Inventory → Purchases → POS/Sales → Cash Sessions → Customers/Credit → Financial Accounting → Settings → Backup/Recovery → Basic Reports + Historical Financial Import**

### Current Workstream model

New work uses the priority-ordered **WS-A through WS-L** model defined in `STOCKIHA_GROUND_TRUTH.md`:

1. **WS-A — Foundation & Access** — Authentication, User Management, RBAC, role/access management.
2. **WS-B — Financial Core** — Accounting and transaction financial integrity.
3. **WS-C — Settings & Policy Engine** — Feature toggles, business policies, settings frontend/backend.
4. **WS-D — Product & Inventory Core** — Catalog, variants, barcode-first global search, inventory MVP.
5. **WS-E — Procurement & Supplier Operations** — Direct Purchase and supplier operations.
6. **WS-F — POS, Sales & Cash Operations** — POS, cash sessions, payments, customers/credit.
7. **WS-G — Historical Financial Import** — Complete validation, reliability and testing.
8. **WS-H — Backup & Recovery** — Repair and validate backup/restore/health workflows.
9. **WS-I — Reporting & Analytics** — Complete reporting after pillar features stabilize.
10. **WS-J — Dashboard & Application UX** — Dashboard, sidebar, topbar and layout redesign.
11. **WS-K — Windows/Tauri Acceptance & Release** — Release-critical Windows/Tauri verification.
12. **WS-L — Audit & Compliance** — Late-stage audit trail implementation.

## Important current priorities

- **User Management + RBAC:** critical and immediate priority.
- **Financial Core:** critical.
- **Settings:** critical; frontend and backend redesign required.
- **Windows/Tauri acceptance:** release-critical/top priority.
- **Product:** backend 6.5/10; frontend/UI 4/10.
- **Barcode-first global search:** 5/10; inventory pages already support it, but global coverage is incomplete.
- **Procurement/Purchase page:** 6/10; Direct Purchase is the current MVP purchasing workflow.
- **POS/Cash Session:** both require serious revision/testing.
- **Historical Financial Import:** 5/10.
- **Backup/Recovery:** currently not trusted/working reliably and requires repair/testing.
- **Reporting:** important, but follows stabilization of pillar features.
- **Dashboard/sidebar/topbar:** redesign after the pillar features unless blocking.
- **Audit Trail:** deliberately late.

## Settings + RBAC policy

Stockiha treats Settings as a **business policy engine**, not merely a preferences page.

All possible optional business features must be configurable/toggleable from Settings where applicable, including examples such as:

- tax ON/OFF;
- stock transfers ON/OFF;
- discounts configuration;
- inventory valuation policy such as WAC/FIFO where supported;
- feature availability;
- roles;
- RBAC management;
- other business-policy switches.

**Settings determines whether/how a capability is enabled. RBAC determines which users/roles can use it.** Both frontend visibility and backend authorization must respect these policies.

Default roles are **SuperAdmin, Admin, Manager, and Cashier**. Custom users can be created by SuperAdmin. Admins can modify role access according to the permission model.

## Scope intentionally deferred

Unless explicitly promoted in `STOCKIHA_GROUND_TRUTH.md`, do not pull these into MVP:

- Payroll.
- TVA/tax accounting implementation.
- Product images.
- Broader procurement policies beyond Direct Purchase.
- Advanced inventory features outside the defined inventory-MVP analytics boundary.
- Advanced reporting/analytics beyond MVP reporting.
- Advanced backup scheduling/off-device/encrypted retention.
- Other features explicitly marked future/deferred in the ground truth.

## Stack

- **Desktop Client:** Tauri v2
- **Frontend:** React 19 + TypeScript + Vite
- **Backend:** Rust (Tokio async runtime)
- **Database:** PostgreSQL 18.x
- **Primary Language:** French (default), Arabic (full RTL), English

## Repository Documentation

| Document | Authority / purpose |
|---|---|
| [`STOCKIHA_GROUND_TRUTH.md`](./STOCKIHA_GROUND_TRUTH.md) | **ONLY current product/roadmap authority** |
| [`CURRENT_STEP.md`](./CURRENT_STEP.md) | Current execution position/tracker |
| [`TASKS.md`](./TASKS.md) | Task execution + historical implementation record |
| [`AGENTS.md`](./AGENTS.md) | AI engineering rules and source-of-truth hierarchy |
| [`DESIGN.md`](./DESIGN.md) | Current design-system guidance; not roadmap authority |
| [`old-documents/`](./old-documents/) | Historical/obsolete documents only |

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

## Implementation Truth

For what actually works, prefer this order:

1. Reproducible runtime behavior.
2. Automated tests.
3. Applied migrations and database state.
4. Current source code.
5. Verified Windows/Tauri behavior.
6. `STOCKIHA_GROUND_TRUTH.md` for product scope and roadmap direction.
7. `CURRENT_STEP.md` and `TASKS.md` for execution tracking.

If an older document conflicts with the current ground truth, the older document is obsolete. Do not revive historical PR/R/S/Slice numbering for new work.
