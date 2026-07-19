# GestStock Pro — Agent Rules and Constraints

These rules are authoritative and must be adhered to by all developers and AI agents working on this repository:

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
- Every future posting operation must have integration tests.
- Architecture changes require an explicit Architecture Decision Record (ADR) and user approval.
