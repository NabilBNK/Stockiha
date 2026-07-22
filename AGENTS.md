# Stockiha — AI Engineering Rules

## Purpose
Work only on Stockiha and only on the explicitly assigned task. Prefer the smallest complete, testable change. Do not work ahead.

## Sources of truth
Read in this order:
1. `final-architecture.md`
2. `AGENTS.md`
3. `CURRENT_SLICE.md`
4. `TASKS.md`
5. Relevant companion specs under `docs/`
6. Accepted ADRs under `docs/decisions/`
7. Existing code and tests

Repository documents override conversation memory and agent summaries. Do not modify `final-architecture.md` without an approved ADR and explicit user approval.

## Slice implementation boundary

Slice 0 consists of isolated technical feasibility proofs.

Slices 1 through 9 are production vertical implementation slices. Work must use
the intended production architecture, migrations, domain models, application
services, database posting functions, IPC boundaries, frontend workflows and
end-to-end tests.

Do not create proof-only modules, toy implementations, placeholder workflows
or temporary parallel architectures for Slices 1 through 9.

## Quota and cost discipline
- Keep planning responses under 700 words unless a blocker requires more.
- Do not repeat large repository sections.
- Search within files before reading long files in full.
- Read only files relevant to the task.
- Do not browse unless current official documentation is necessary.
- In plan-only mode, do not install dependencies or run builds.
- During implementation, install dependencies once.
- Run targeted tests while developing and the applicable full verification set once at the end.
- Do not run Tauri packaging unless the task affects packaging, capabilities, configuration, or releases.
- Do not create speculative code, placeholders, unused abstractions, or future-slice scaffolding.
- Ask at most one consolidated clarification question when blocked.

## Deadline Mode Execution Rules
For every remaining task:
1. **One implementation plan only**: Do not repeatedly revise plans; incorporate essential requirements in the initial proposal.
2. **One implementation pass**: Build the feature cleanly in a single targeted effort.
3. **One blocker-focused review**: Review strictly for correctness, security, or blocking bugs. Do not review harmless naming or visibility preferences.
4. **One Windows verification pass**: Execute applicable checks once at the end of implementation.
   - **No frontend tests** when no frontend files changed.
   - **No repeated full test suites** after documentation-only or comment edits.
   - **No extra tests** beyond essential acceptance criteria.
5. **Commit and continue**: Upon passing verification, commit immediately and advance. Useful but nonessential improvements go into a backlog.

## Workflow

### Before editing
Report:
- interpretation
- in-scope and out-of-scope work
- exact files expected to change
- database and security impact
- tests to add
- unresolved blockers

Do not edit until the user approves the plan.

### During implementation
- Use a dedicated `task/...` branch after approval.
- Modify only task-related files.
- Do not silently upgrade major dependencies.
- Add no dependency without justification.
- Keep Tauri commands thin and reusable logic testable.
- Keep authoritative business logic out of React.

### After implementation
Report concisely:
- files changed
- design decisions
- commands and actual results
- tests
- security/database impact
- Linux limitations
- Windows/manual checks
- `git diff --stat`
- `git status --short`
- verdict: `PASS`, `PASS WITH MANUAL CHECKS`, or `BLOCKED`

Do not commit or push until the user approves the report.

## Git safety
- Never commit directly to `main`.
- Never force-push or merge.
- Stop for unexpected working-tree changes.
- Show the diff before commit approval.
- Preserve `package-lock.json` and `src-tauri/Cargo.lock`.
- Never commit build outputs, secrets, `.env` files, dumps, or machine paths.

Confirmation is required before commit, push, PR creation, destructive Git operations, releases, or tags.

## Stockiha constraints
- Stack: Tauri v2, React 19, TypeScript, Vite, Rust, PostgreSQL 18.x, SQLx, Typst, ESC/POS.
- Windows is the primary target.
- Never use floating point for authoritative money, tax, quantity, WAC, inventory value, or journals.
- React is not authoritative for financial, inventory, permission, or posting decisions.
- Posted ledgers are immutable.
- Confirmed negative stock is forbidden.
- Financial operations must be atomic and idempotent.
- Protected operations validate sessions and permissions.
- Journals must balance.
- Corrections use linked reversals or adjustments.
- Printing failure must not roll back a confirmed document.
- Historical imports must not silently affect live ledgers.
- Do not weaken DB roles, posting functions, or `SECURITY DEFINER`.
- Never expose or log passwords, PINs, raw tokens, hashes, credentials, or sensitive internal errors.

Architecture changes require an ADR, alternatives and risks, explicit approval, then an approved architecture update.

## Verification
Run only checks applicable to changed areas.

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

Run relevant integration, migration, security, concurrency, rollback, or document tests when applicable.

A Linux sandbox cannot prove Windows runtime, WebView2, Credential Manager, Windows Service, MSI/NSIS, Windows spooler, physical ESC/POS output, Arabic thermal output, or cash-drawer behavior. Mark these for Windows or hardware verification.
