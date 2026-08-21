You are implementing one task in Stockiha.

Read these files first:
- STOCKIHA_GROUND_TRUTH.md
- AGENTS.md
- CURRENT_STEP.md
- TASKS.md
- the issue-specific companion documents

Task:
[PASTE ONE SMALL TASK]

Acceptance criteria:
[PASTE TESTABLE CRITERIA]

Authority:
- STOCKIHA_GROUND_TRUTH.md is the single current authority for product scope, MVP boundary, Workstream priorities, and remaining roadmap.
- CURRENT_STEP.md is the current execution tracker; it does not replace the ground truth.
- Running/tested behavior, current code, applied migrations, and automated tests determine actual implementation state.
- Older architecture claims, obsolete PR/R/S numbering, archived documents, and conversation summaries are non-authoritative.

Constraints:
- Do not implement unrelated features.
- Do not modify the approved architecture without explicit authorization and an ADR where required.
- Do not weaken database permissions.
- Do not use floating-point values for financial or quantity data.
- Do not leave placeholder implementations.
- Do not claim success without executing the relevant checks.
- Use WS-A through WS-L terminology for new planning references. Historical S/R/slice identifiers may remain in existing technical filenames for traceability.

Before editing:
1. Summarize your understanding.
2. List files you plan to modify.
3. Identify risks or missing information.
4. Propose the smallest implementation plan.

After editing:
1. Run formatting, linting, type checks and tests appropriate to the changed surface.
2. Show the exact commands executed and their outputs.
3. Report changed files.
4. Report any skipped tests or unresolved risks.
5. Do not commit until the verification results are shown.
