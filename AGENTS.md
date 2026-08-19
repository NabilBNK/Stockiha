# Stockiha — AI Engineering Rules

## Purpose

These rules govern all AI-assisted engineering work on Stockiha.

Work only on the explicitly assigned task. Prefer the smallest complete, production-correct, testable change. Do not work ahead, create speculative abstractions, or build temporary parallel architectures.

## Sources of truth

Before implementation, establish the current state from the smallest relevant set of sources:

1. Running/tested behavior and reproducible failures.
2. Automated tests and applied database migrations.
3. Current source code.
4. `Stockiha_Audit_Redesigned_Roadmap_2026-08-02.md` for target architecture and roadmap scope.
5. `CURRENT_SLICE.md` and `TASKS.md` for execution tracking.
6. Relevant specifications under `docs/`.
7. Accepted ADRs under `docs/decisions/`.
8. This `AGENTS.md` for AI execution rules.

Repository evidence overrides conversation summaries when they conflict. Do not claim a feature exists merely because a roadmap or task file says it should exist.

Do not modify the ground-truth roadmap or accepted architecture without an explicit task requiring that change. Architecture changes require an ADR describing alternatives, risks, migration impact, and the chosen decision.

## Vibe-coding operating modes

Stockiha has exactly two AI workflow modes.

### Mode 1 — Full vibe coding

Use when Codex quota/credits are available.

Roles:

- **ChatGPT** — architect, senior analyst, task decomposition, cross-layer diagnosis, implementation contract, and final high-risk review.
- **Codex in VS Code** — primary implementation agent for complex, ambiguous, cross-layer, or high-risk repository changes.
- **Antigravity Gemini** — cheap bounded executor, Windows operator, reproduction agent, mechanical editor, test runner, Git operator, and local/manual QA assistant.
- **Compiler/tests/database/Git** — objective source of truth for correctness.
- **User** — product owner and final business acceptance.

Routing rules:

- Route architecture, accounting, WAC, inventory posting, authentication, permissions, migrations, concurrency, persistent-data integrity, and cross React/Rust/PostgreSQL defects to ChatGPT for reasoning and normally Codex for implementation.
- Route simple UI edits, label/spacing changes, bounded mechanical edits, command execution, branch pulling, reproduction, log collection, and Windows/Tauri acceptance to Antigravity.
- Do not ask multiple agents to independently solve the same problem.
- One agent owns implementation for a task. Other agents review or test unless explicitly reassigned.

Preferred flow for substantial work:

`User → ChatGPT contract → Codex implementation → deterministic verification → ChatGPT diff/risk review → GitHub → Antigravity Windows/manual QA → User acceptance`

### Mode 2 — No-Codex vibe coding

Use whenever the user says Codex is unavailable, quota/credits are exhausted, or No-Codex mode is active.

**Codex is completely removed from the workflow while this mode is active. Never route, recommend, queue, or defer work to Codex.**

Roles:

- **ChatGPT** keeps senior responsibilities: architecture, repository diagnosis, implementation design, exact patch/change instructions where needed, and review.
- **Antigravity** is constrained to bounded execution: repository inspection, reproduction, exact patch application, mechanical edits, terminal/Git operations, tests, local launch, screenshots/log collection, and manual QA.
- **Compiler/tests/database/Git** remain the source of truth.

For high-risk work in No-Codex mode, reduce task size rather than increasing Antigravity autonomy. Use small patches, explicit file boundaries, regression tests, and one concern per commit.

Preferred flow:

`User → ChatGPT diagnosis/contract/patch → Antigravity bounded execution → deterministic verification → ChatGPT diff review → Antigravity Windows/manual QA → User acceptance`

Antigravity must not independently redesign accounting, inventory valuation, database architecture, authentication, permissions, migrations, or other high-risk business logic. If such a change is required in No-Codex mode, ChatGPT must define the implementation precisely before Antigravity edits it.

## Cost and context discipline

- Think once; execute once; verify with tools.
- Do not make ChatGPT, Codex, and Antigravity independently rediscover the same context.
- Put stable repository rules here instead of repeating them in every prompt.
- For substantial work, use a concise task contract under `docs/tasks/` when useful.
- A task contract should contain: objective, current behavior, expected behavior, business rules, in-scope, out-of-scope, affected boundaries, invariants, acceptance tests, regression tests, and completion conditions.
- Prefer diffs, failing tests, exact logs, and relevant files over entire conversation transcripts.
- Search within files before reading large files in full.
- Read only files relevant to the task unless evidence requires expansion.
- Do not browse external documentation unless current official documentation is materially necessary.
- Do not reinstall dependencies repeatedly in the same workspace.
- Run targeted checks during development and the applicable verification set once before completion.
- Do not package Tauri unless packaging, capabilities, configuration, installer, or release behavior is in scope.
- Do not create placeholders, fake persistence, mock success paths, disabled tests, unused abstractions, or future-slice scaffolding merely to make a task appear complete.

## Authorization and execution

A clear user request to implement/fix a task is authorization to perform the normal non-destructive engineering workflow needed for that task, including:

- inspect relevant repository state;
- create/use a dedicated task branch;
- edit task-related files;
- add/update tests;
- run applicable validation;
- commit the completed task;
- push the task branch.

Do **not** repeatedly ask for approval for routine implementation steps already covered by the task request.

Still require explicit authorization for destructive or release-impacting operations such as:

- force-push;
- rewriting published history;
- deleting branches or tags;
- destructive database/data operations;
- merging to `main` when the user has not requested promotion/merge;
- creating releases or publishing installers.

If a task is blocked by a genuine architecture conflict, accounting-integrity conflict, security conflict, data-loss risk, missing credential, or unavailable environment with no safe workaround, stop and report the blocker. Otherwise resolve ordinary implementation problems autonomously.

## Implementation workflow

### Before editing

For substantial tasks, establish internally or report concisely:

- objective and current failure/behavior;
- in-scope and out-of-scope boundaries;
- likely files/components affected;
- database/accounting/security impact;
- tests or reproduction required;
- active vibe-coding mode and implementation owner.

Do not turn this into repeated planning cycles. Once the task is understood, implement it.

### During implementation

- Use a dedicated `task/...` or `fix/...` branch unless the user explicitly directs otherwise.
- Modify only task-related files.
- Preserve useful existing work.
- Stop for unexpected unrelated dirty-tree changes before overwriting them.
- Do not silently upgrade major dependencies.
- Add no dependency without a concrete need.
- Keep Tauri commands thin.
- Keep reusable domain/application logic testable.
- Keep authoritative financial, inventory, permission, and posting logic out of React.
- Fix root causes rather than hiding errors or bypassing preconditions.
- Never weaken validation merely to make acceptance pass.

### After implementation

Report concisely:

- files changed;
- important design decisions;
- commands/tests run and actual results;
- database/security/accounting impact;
- known limitations or unresolved failures;
- required Windows/manual checks;
- commit/branch information;
- verdict: `PASS`, `PASS WITH MANUAL CHECKS`, or `BLOCKED`.

## Git safety

- Never make ordinary feature work directly on `main`.
- Never force-push unless the user explicitly requests and understands the impact.
- Never silently overwrite unrelated local/user changes.
- Inspect the final diff before committing.
- Preserve lockfiles when dependency state requires them; do not delete `package-lock.json` or `src-tauri/Cargo.lock` to suppress conflicts.
- Never commit secrets, `.env` files, credentials, database dumps, build outputs, or machine-specific temporary paths.
- Prefer one coherent concern per commit, especially for high-risk fixes.

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
- Purchase, inventory, return, and sales changes must preserve quantity, valuation, document, and journal consistency across failure/retry paths.

## Verification policy

Use deterministic verification appropriate to the changed surface. AI confidence is not evidence.

Frontend, when applicable:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Rust, when applicable:

```bash
cargo fmt --check
cargo check
cargo clippy --all-targets --all-features -- -D warnings
cargo test
```

Also run relevant integration, migration, posting, security, concurrency, rollback, document-generation, or end-to-end tests when the task touches those boundaries.

For bug fixes, prefer a regression test that fails before the fix and passes after it when practical.

Do not claim full verification from a Linux environment for Windows-specific behavior such as WebView2, Windows Credential Manager, Windows Services, MSI/NSIS installers, Windows print spooler, physical ESC/POS output, Arabic thermal rendering, or cash-drawer behavior. Route those checks to Windows/manual acceptance.

## Antigravity operating guardrails

When Antigravity is used as the cheap execution/QA agent:

- Give it explicit objective, branch/workspace, scope, files if known, acceptance criteria, and forbidden changes.
- Prefer `DO NOT MODIFY CODE` during diagnostic or acceptance passes.
- Ask it to return exact commands, errors, logs, screenshots, `git diff`, and PASS/FAIL evidence rather than conclusions such as “looks good.”
- Do not let it make opportunistic refactors outside scope.
- Do not let it bypass failing database functions, permissions, accounting preconditions, or tests.
- If a task becomes architecturally ambiguous, stop Antigravity editing and route the decision back to ChatGPT.

## Completion standard

A task is complete only when:

1. The requested behavior is implemented at the authoritative layer.
2. Relevant regressions are covered or explicitly justified.
3. Applicable deterministic checks pass, or pre-existing failures are clearly separated from new failures.
4. The final diff contains no unrelated changes.
5. Required Windows/manual acceptance is identified or completed.
6. The task branch is committed and pushed when implementation was requested, unless the user explicitly asked for a local-only change.
