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

## MVP Batch Mode

When a task explicitly invokes MVP Batch Mode for an approved multi-part batch (e.g. an entire vertical slice's backend transaction chain):

1. Apply Core Rules 1–4 to the **batch as a whole**, not to each part of the batch individually — do not stop for a fresh plan/approval cycle between the tasks that make up one approved batch.
2. Correct ordinary implementation problems found while working through the batch (bugs, missing grants, naming mismatches, failing tests) without pausing to ask — that is expected, routine batch work.
3. Only pause mid-batch for a genuine architecture, accounting, security, data-loss, credential, or environment blocker — something with no safe implementation path forward, not a routine decision.
4. Core Rule 5 ("Commit and Continue") still ends in a **stop**, not a push: batch mode never removes the requirement for explicit human approval before a commit, push, merge, PR, or any destructive Git operation. Present the full diff and verification report for the completed batch and wait for that approval before touching the remote branch.
