# S4-001 Current-Head CI

The branch includes `.github/workflows/s4-001-verify.yml`, a manual `workflow_dispatch` verification workflow.

Run it from GitHub Actions using branch `task/s4-001-customer-credit-controls`.

It executes:

1. frontend typecheck, lint, Vitest, and build;
2. Rust unit tests;
3. PostgreSQL 18 role bootstrap and every migration in filename order;
4. runtime privilege check proving caller-supplied credit-sale hashes are not executable;
5. credit-sale integration assertions;
6. customer-payment integration assertions;
7. real two-connection credit-limit race harness.

Do not merge PR #6 until this workflow is green on its current head and the Windows/Tauri manual pass is recorded.
