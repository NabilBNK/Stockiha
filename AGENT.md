# Stockiha Agent Rules

## Source of truth

Read these files before making changes:

1. docs/architecture/implementation-plan-v5.1.md
2. CURRENT_SLICE.md
3. docs/posting-matrix.md
4. docs/state-machines.md
5. docs/permissions.md

Do not silently change approved architecture decisions.

## Working rules

- Work on one task only.
- Do not implement future slices.
- Do not rewrite unrelated files.
- Never use floating-point values for money, tax, quantities, WAC or journal amounts.
- Never allow direct runtime modifications to immutable ledgers.
- Never place financial authority in the React frontend.
- Never bypass application-session validation.
- Never bypass idempotency.
- Never permit negative confirmed stock.
- Every financial operation must be atomic.
- Every new posting path requires integration tests.
- Every confirmed document must be reversible using a new linked document.
- Printing failure must not roll back a confirmed business document.
- Do not log passwords, PINs, tokens, database credentials or hashes.

## Before implementation

Report:

- Your interpretation of the task
- Files you intend to change
- Database changes
- Security implications
- Tests you will add

Stop if requirements conflict.

## After implementation

Run and report:

- cargo fmt --check
- cargo clippy --all-targets --all-features -- -D warnings
- cargo test
- npm run lint
- npm run typecheck
- npm test
- SQL migration tests where relevant

List changed files and unresolved concerns.