---
name: deadline-mode
description: Enforces rapid, single-pass development discipline to accelerate task execution without superficial review loops.
---

# Deadline Mode Execution Skill

This skill enforces streamlined, fast-paced execution across all development tasks in Stockiha.

## Core Rules

1. **One Implementation Plan Only**: Create a single technical plan incorporating essential acceptance criteria. Avoid multi-iteration planning cycles.
2. **One Implementation Pass**: Write clean, functional code in a single targeted development effort.
3. **One Blocker-Focused Review**: Review strictly for correctness, security vulnerabilities, or blocking defects. Skip cosmetic formatting, comment styling, or harmless visibility preferences.
4. **One Windows Verification Pass**:
   - Run verification only once at the end of implementation.
   - Do **NOT** run frontend tests (`npm test` / `eslint`) if no frontend files were modified.
   - Do **NOT** rerun full test suites for documentation-only or minor comment changes.
   - Do **NOT** write speculative or nonessential test cases beyond required criteria.
5. **Commit and Continue**: Commit and push immediately upon passing essential verification checks, then move directly to the next task.
6. **Backlog Nonessentials**: Log nice-to-have refactorings or secondary enhancements in a backlog rather than delaying task completion.
