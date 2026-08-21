# Stockiha — AI Engineering Rules

## Purpose

Work only on the explicitly assigned Stockiha task. Prefer the smallest complete, production-correct, testable change. Do not work ahead or create speculative parallel architectures.

## Current source-of-truth hierarchy

Before implementation, establish current state from:

1. Reproducible running/tested behavior.
2. Automated tests and applied database migrations.
3. Current source code.
4. **`STOCKIHA_GROUND_TRUTH.md` — the only current product/roadmap ground-truth document.**
5. `CURRENT_STEP.md` — current execution position.
6. `TASKS.md` — execution/task history and current task tracking.
7. Relevant specifications under `docs/`.
8. Accepted ADRs under `docs/decisions/`.

> **Historical-document rule:** Everything under `old-documents/` is historical reference only. It must not be used to determine current MVP scope, priorities, roadmap, or implementation status.

Repository evidence overrides conversation summaries and roadmap prose when determining what actually works. Do not claim a feature exists merely because a task or roadmap says it should exist.

Use the current **WS-A through WS-L** Workstream model for all new planning. Do not create new PR/R/S/Slice numbering.

Do not modify `STOCKIHA_GROUND_TRUTH.md` unless the assigned task explicitly requires a ground-truth update or the user explicitly requests one. Architecture changes require an ADR documenting alternatives, risks, and the chosen decision.

## Current project priorities

The current MVP direction and priority order are defined exclusively by `STOCKIHA_GROUND_TRUTH.md`. In particular:

- User Management + RBAC are critical and high priority.
- Financial Core is critical.
- Settings is a core policy/configuration engine, not merely a preferences page.
- Settings controls optional feature enablement/configuration; RBAC controls user access.
- Product and inventory reliability are core MVP concerns.
- Barcode-first search must become global.
- Direct Purchase is the current MVP procurement workflow; broader procurement policies are future scope.
- POS and Cash Sessions require serious revision/testing.
- Historical Financial Import requires further work/testing.
- Backup/Recovery currently requires repair and validation.
- Reporting follows pillar-feature stabilization.
- Dashboard/sidebar/topbar redesign follows the pillar features unless UI work blocks a pillar.
- Windows/Tauri acceptance is a release-critical gate.
- Audit Trail is intentionally late.
- Payroll, TVA/tax implementation, product images, and other explicitly deferred scope must not be pulled forward without an explicit scope decision.

## Settings + RBAC policy

All possible optional business features must be configurable/toggleable through Settings where applicable, including business policies such as tax enablement, stock transfers, discounts, valuation policy, feature availability, roles, and RBAC management.

Settings determines whether/how a capability is enabled. RBAC determines which users/roles can use it. Both frontend visibility and backend authorization must respect these policies.

Default roles are SuperAdmin, Admin, Manager, and Cashier. Custom users can be created by SuperAdmin. Admins may modify role access according to the permission model.

## Deadline mode

Stockiha is deadline-constrained. Prefer small, complete, testable increments and avoid speculative work.

For each task:
1. Establish objective, scope, affected boundaries, invariants, and acceptance criteria.
2. Implement one coherent solution.
3. Fix ordinary implementation problems autonomously.
4. Stop only for genuine architecture, accounting-integrity, security, data-loss, credential, or environment blockers with no safe workaround.
5. Run the applicable deterministic verification.
6. Inspect the final diff and status.
7. Report actual results and remaining manual Windows/Tauri checks.

Do not repeatedly rediscover repository context across agents.

## Implementation rules

- Use a dedicated `task/...` or `fix/...` branch unless explicitly directed otherwise.
- Modify only task-related files.
- Preserve useful existing work.
- Do not silently upgrade major dependencies.
- Add no dependency without a concrete need.
- Keep Tauri commands thin and reusable domain/application logic testable.
- Keep authoritative financial, inventory, permission, and posting logic out of React.
- Fix root causes rather than hiding errors or weakening validation.
- Do not create placeholders, fake persistence, mock success paths, disabled tests, unused abstractions, or future-work scaffolding merely to appear complete.

## Git safety

- Never silently overwrite unrelated local changes.
- Never use destructive reset/clean operations to discard work.
- Never force-push unless explicitly authorized.
- Never rewrite published history without explicit authorization.
- Inspect the final diff before commit.
- Preserve lockfiles when dependency state requires them.
- Never commit secrets, `.env` files, credentials, database dumps, build outputs, or machine-specific temporary paths.

## Stockiha non-negotiable invariants

- Stack: Tauri v2, React 19, TypeScript, Vite, Rust, PostgreSQL 18.x, SQLx, Typst, ESC/POS.
- Windows is the primary runtime target.
- Never use floating point for authoritative money, tax, quantity, WAC, inventory value, or journals.
- React is not authoritative for financial, inventory, permission, or posting decisions.
- Posted ledgers are immutable.
- Confirmed negative stock is forbidden.
- Financial operations must be atomic and idempotent.
- Protected operations validate sessions and permissions.
- Journals must balance.
- Corrections use linked reversals or explicit adjustments; do not mutate posted history.
- Printing failure must not roll back an already confirmed business document.
- Historical imports must not silently affect live operational ledgers.
- Do not weaken database roles, posting functions, grants, or `SECURITY DEFINER` boundaries to bypass failures.
- Never expose or log passwords, PINs, raw tokens, hashes, credentials, or sensitive internal errors.
- Preserve the product → variant model and authoritative identifiers defined by current catalog contracts.

## Verification

Run checks applicable to the changed surface.

Frontend:
```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Rust:
```bash
cargo fmt --check
cargo check
cargo clippy --all-targets --all-features -- -D warnings
cargo test
```

Run relevant integration, migration, posting, security, concurrency, rollback, document-generation, or end-to-end tests when applicable.

Do not claim Windows-specific behavior from Linux. Windows/Tauri, WebView2, Credential Manager, Windows services, installers, print spooler, physical ESC/POS, Arabic thermal output, and cash-drawer behavior require Windows/manual acceptance where applicable.

## Completion standard

A task is complete only when:

1. Requested behavior is implemented at the authoritative layer.
2. Relevant regressions are covered or explicitly justified.
3. Applicable deterministic checks pass, or pre-existing failures are clearly separated.
4. Final diff contains no unrelated changes.
5. Required Windows/manual acceptance is identified or completed.
6. Commit/push behavior follows the user's explicit Git instruction.

## Documentation authority reminder

`STOCKIHA_GROUND_TRUTH.md` is the current ground truth.

`CURRENT_STEP.md` is the current execution tracker.

`TASKS.md` is the execution/history tracker.

`README.md` is the repository entry point.

`DESIGN.md` is design-system guidance, not roadmap authority.

`old-documents/` contains obsolete historical documents and must not be treated as current truth.
