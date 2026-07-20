# Stockiha — Agent Rules and Constraints

These rules are authoritative and must be adhered to by all developers and AI agents working on this repository.

## Source of Truth

Read these files before making any changes:

1. `final-architecture.md` — Architectural decision baseline (authoritative)
2. `CURRENT_SLICE.md` — Active slice and task scope
3. `TASKS.md` — Task tracker

Do not silently change approved architecture decisions.

## Working Rules

- `final-architecture.md` is the architectural source of truth.
- Work on one explicitly assigned task only. Do not work ahead.
- Do not implement future slices.
- Do not modify unrelated files.
- Do not use floating-point values for money, quantities, tax, WAC, or journal values. Always use exact decimal types (e.g. `rust_decimal` in Rust).
- Do not place authoritative financial logic in React. The backend is the source of truth.
- Do not permit direct modification of immutable ledgers. Day-to-day operations must go through public database posting functions.
- Do not weaken database roles or SECURITY DEFINER protections.
- Do not bypass application-session validation or idempotency.
- Do not log secrets, passwords, PINs, tokens, hashes, or database credentials.
- Do not introduce placeholder business logic presented as complete.
- Do not expose raw backend error details in the React UI. Use sanitized user-facing messages.
- Every future posting operation must have integration tests.
- Architecture changes require an explicit Architecture Decision Record (ADR) and user approval.
- Never permit negative confirmed stock.
- Every financial operation must be atomic.
- Every confirmed document must be reversible using a new linked document.
- Printing failure must not roll back a confirmed business document.

## Before Implementation

Report:

- Your interpretation of the task
- Files you intend to change
- Database changes (if any)
- Security implications
- Tests you will add or modify

Stop and report if requirements conflict.

## After Implementation

Run and report real results for:

- `cargo fmt --check`
- `cargo clippy --all-targets --all-features -- -D warnings`
- `cargo test`
- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run build`
- SQL migration tests where relevant

List all changed files and any unresolved concerns.

Do not create or push a commit until the verification report is complete and passing.
