# Stockiha — Team Orchestration Model

> **Purpose:** defines who does what, who decides routing, and how work moves between the humans and AI agents on this project.
>
> This is a **process** document. It has no authority over product scope or roadmap — that is `STOCKIHA_GROUND_TRUTH.md` — and none over engineering rules — that is `AGENTS.md`.

---

## 1. The team

| # | Role | Identity | Responsibility |
|---|---|---|---|
| 1 | **Lead Architect / Consultant** | Claude (chat interface) | Owns technical direction. Decides which agent handles each task. Writes every Task Brief. Reviews every Result Report. Maintains continuity across sessions. |
| 2 | **Project Owner** | The human | Sets goals and priorities, approves decisions, runs commands, ships. Works in vibe-coding mode: does not read or write code, does not arbitrate technical disputes. |
| 3 | **Heavy Agent** | Claude Code | Complex, risky, integrity-sensitive implementation and hard debugging. Reads the repo directly. |
| 4 | **Cheap Agent** | Gemini 3.1 Pro / 3.7 Flash | Simple, fully-specified, low-risk execution. Exists to keep Claude Code usage — and cost — down. |

**The Lead Architect orchestrates. The Project Owner does not.** The owner states an outcome ("purchases page needs a history view"); the Lead Architect decides the agent, scope, and sequencing and hands over a ready-to-paste brief.

---

## 2. Routing rules

The Lead Architect assigns every task to exactly one agent using this test.

### → Claude Code (Heavy Agent)

Route here if **any** of these is true:

- Touches money, journals, ledgers, WAC, inventory valuation, or posting logic
- Touches authentication, sessions, RBAC, permissions, or `SECURITY DEFINER` boundaries
- Touches a database migration, schema, constraint, or protected function
- Is a bug with an unknown root cause, or requires tracing across React → Rust → PostgreSQL
- Spans more than roughly three files, or crosses application layers
- Requires a design decision, trade-off, or judgement call
- Touches POS, cash sessions, historical import, or backup/restore
- Risks data loss, regression in a working pillar feature, or a security weakening
- The Lead Architect cannot write acceptance criteria precise enough to be mechanically checked

### → Gemini (Cheap Agent)

Route here only if **all** of these are true:

- The change is mechanical and fully specified in advance — exact files, exact intent
- No financial, inventory, permission, security, or migration surface is touched
- No architecture or naming decision is left open
- Success is verifiable by a build/typecheck/lint/test pass or a visual check
- A wrong result is cheap to detect and cheap to throw away

Typical: copy and translation strings (FR/AR/EN), Tailwind/styling tweaks inside one component, renaming per an explicit list, extracting a constant, adding an existing-pattern unit test, prop-type or TypeScript annotation cleanup, formatting.

### → Lead Architect only (no agent)

Scope questions, roadmap sequencing, "should we do X or Y", ADR drafting, reviewing an agent's output, and explaining the system to the Project Owner.

### Escalation

If Gemini stalls, produces something that doesn't build, or starts touching files outside its brief: **stop it and re-route to Claude Code.** Do not iterate more than twice with the cheap agent — the third attempt costs more in the owner's time than Claude Code would have cost in tokens.

If Claude Code hits a stop condition (section 4 of its skill), it returns the blocker to the Lead Architect. The Lead Architect decides, and if the decision is architectural, an ADR is written under `docs/decisions/` before work resumes.

---

## 3. Task lifecycle

```
Owner states outcome
        │
        ▼
Lead Architect  ── establishes current repo state
                ── defines objective, scope, invariants, acceptance criteria
                ── selects agent
        │
        ▼
Task Brief  ──────────────►  Claude Code  or  Gemini
                                    │
                                    ▼
                            Result Report
        ┌───────────────────────────┘
        ▼
Lead Architect reviews against acceptance criteria + AGENTS.md invariants
        │
        ├── Rejected → corrective brief (same or escalated agent)
        └── Accepted → owner updates CURRENT_STEP.md / TASKS.md, commits
```

One task in flight per agent. Do not run parallel agents on overlapping files.

---

## 4. Standing rules

- **One task, one branch.** `task/...` or `fix/...`. Never work directly on the main branch without an explicit instruction.
- **No agent declares itself done.** Completion is decided by the Lead Architect against the acceptance criteria in the brief.
- **Code existence is not completion.** A feature is complete when it is verified, not when a file exists.
- **Never redo completed work** without evidence it is wrong.
- **Deferred scope stays deferred.** Payroll, TVA/tax, product images, advanced procurement, advanced discounts, cloud backup, auto-updater — none enter a brief without an explicit scope decision from the Project Owner.
- **Agents do not update the ground truth.** Only the Project Owner, on the Lead Architect's recommendation, changes `STOCKIHA_GROUND_TRUTH.md`.

---

## 5. Continuity between chat sessions

Chat sessions end; the project does not. To resume cleanly, the Project Owner should be able to hand a new session:

1. `STOCKIHA_GROUND_TRUTH.md`, `AGENTS.md`, `CURRENT_STEP.md`, `README.md` (already project files)
2. This document
3. The last Result Report, if a task is mid-flight

`CURRENT_STEP.md` must be updated after each accepted task — it is the handoff point between sessions. If it is stale, the next session starts blind.

---

## 6. File map for this workspace

| File | Read by | Purpose |
|---|---|---|
| `ORCHESTRATION.md` | Humans, Lead Architect | This document — team model and routing |
| `.claude/skills/stockiha-task-execution/SKILL.md` | Claude Code | Auto-loaded execution protocol and invariants |
| `GEMINI.md` | Gemini | Hard constraints and refusal list for the cheap agent |
| `docs/handoff/HANDOFF_TEMPLATES.md` | Lead Architect, both agents | Task Brief and Result Report formats |
| `AGENTS.md` | All agents | Engineering rules (pre-existing, authoritative) |
| `STOCKIHA_GROUND_TRUTH.md` | All | Product scope and roadmap (pre-existing, authoritative) |

---

## 7. Tooling reality

- **Claude Code** runs as its own tool and auto-loads `.claude/skills/stockiha-task-execution/SKILL.md`.
- **Gemini runs inside Google Antigravity.** Antigravity auto-loads root-level `GEMINI.md` and `AGENTS.md`, with `GEMINI.md` taking higher precedence. That precedence is deliberate: `GEMINI.md` narrows the autonomy that `AGENTS.md` grants.
- Rules files in Antigravity are capped at **12,000 characters** each. `GEMINI.md` and `AGENTS.md` are both currently well under. If either grows past that, content is silently dropped — split it into `.agents/rules/` rather than letting it overflow.
- Antigravity is agent-first and will make multiple edits before pausing. Keep manual approval on for this repository.
- The skill is **not** duplicated into `.agents/skills/`. Two copies drift, and Gemini is not meant to run heavy tasks.
