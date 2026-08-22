# Handoff Templates

The two formats that move work through the team. The Lead Architect writes the **Task Brief**; the executing agent returns the **Result Report**. See `ORCHESTRATION.md` for routing.

---

## A. Task Brief — Claude Code (heavy work)

```markdown
# TASK BRIEF — <short title>

**Agent:** Claude Code
**Workstream:** WS-_ (<name>)
**Branch:** task/<slug>
**Git:** commit when checks pass, do NOT push | do not commit | commit and push

## Objective
One sentence. The outcome, not the method.

## Why now
One or two lines linking this to the current step in CURRENT_STEP.md.

## Inspect first
Read these before changing anything, and confirm what you find:
- <file/module> — <what to establish>
- <file/module> — <what to establish>
State any mismatch between this brief and the actual code before proceeding.

## Scope
IN:
- <thing>
OUT (do not touch, even if it looks wrong):
- <thing>

## Authoritative layer
Where this logic must live: PostgreSQL function | Rust command | React.
<Explicit note if financial/inventory/permission logic is involved.>

## Invariants that apply
- <e.g. exact numerics only — no f64/float for amounts>
- <e.g. permission check enforced at the DB SECURITY DEFINER boundary>
- <e.g. posted journals immutable; corrections via linked reversal>

## Acceptance criteria
1. <mechanically checkable statement>
2. <mechanically checkable statement>
3. Deterministic checks pass or pre-existing failures are separated.
4. Final diff contains no unrelated changes.

## Verification required
- npm run typecheck / lint / test / build
- cargo fmt --check / check / clippy -D warnings / test
- <migration, posting, security, or integration tests if applicable>
- Windows/manual checks to LIST, not to claim: <e.g. ESC/POS print, Arabic RTL>

## Stop and escalate if
- <task-specific risk>
- Any stop condition in the stockiha-task-execution skill.

## Return
A Result Report in the format below.
```

---

## B. Task Brief — Gemini (cheap work)

Shorter, harder, more literal. If you cannot fill every field concretely, the task is not a Gemini task.

```markdown
# TASK — <short title>

**Branch:** task/<slug>
**Rules:** follow GEMINI.md. Stop if the task touches a restricted area.

## Do exactly this
1. In `<exact path>`: <exact change>
2. In `<exact path>`: <exact change>

## Do not
- Touch any file not listed above.
- Change behavior, logic, naming, or structure beyond the steps above.
- Add dependencies, tests, comments, or refactors.

## Done when
- <visible/checkable result>
- `npm run typecheck` and `npm run build` pass.

## Report
Use the report format in GEMINI.md.
```

---

## C. Result Report — returned by either agent

```markdown
# RESULT — <task title>

**STATUS:** Complete | Partial | Blocked
**Branch:** task/<slug>
**Commit:** <sha or "not committed">

## What changed
- `path/file` — <one line>
- `path/file` — <one line>

## Approach
3–6 sentences. Why this way. Any judgement call made and its reasoning.

## Acceptance criteria
| # | Criterion | Met | Evidence |
|---|---|---|---|
| 1 | ... | yes/no | <test name, command output, or file:line> |

## Verification — actual output
| Check | Result |
|---|---|
| npm run typecheck | pass / FAIL: <error> |
| npm run lint | ... |
| npm test | <n> passed, <n> failed |
| npm run build | ... |
| cargo check | ... |
| cargo clippy -D warnings | ... |
| cargo test | ... |

Pre-existing failures unrelated to this change: <list or none>

## Requires manual Windows/Tauri verification
- <e.g. cash drawer pulse on cash sale — cannot be verified from this environment>
- Or: none

## Invariants — self-check
- Exact numerics only for money/qty/WAC: yes / n/a
- Authorization enforced at DB boundary: yes / n/a
- Posted history not mutated: yes / n/a
- No placeholders, mocks, disabled tests, or fake success paths: yes
- Diff contains only task-related files: yes / no — <explain>

## Out of scope — noticed, did NOT change
- <real issue found, with file:line> — or none

## Blocked on
Only if Partial/Blocked. State the blocker, what was already verified,
and 2–3 options with a recommendation. Or: none.
```

---

## D. Lead Architect review checklist

Before accepting any Result Report:

1. Every acceptance criterion has **evidence**, not an assertion.
2. Verification output is real and pasted — not summarized as "all good".
3. Diff is scoped; no drive-by edits.
4. No invariant from `AGENTS.md` was weakened to make something pass.
5. Financial/inventory/permission logic sits in the database, not in React.
6. Windows-only behavior is listed as pending, never claimed as passing.
7. Anything flagged out-of-scope is triaged: new task, backlog, or ignore.
8. `CURRENT_STEP.md` / `TASKS.md` updated on acceptance.
