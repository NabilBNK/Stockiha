# Historical Repository Documentation Archive

> [!CAUTION]
> **NON-AUTHORITATIVE HISTORICAL ARCHIVE.**
> The documents stored in this directory (`old-documents/`) are retained **strictly for historical traceability and audit context**.
> They do **NOT** represent current product scope, architecture decisions, or execution status.

---

## 1. Ground Truth & Active Authority

- **Single Product & Architecture Authority:** [`STOCKIHA_GROUND_TRUTH.md`](../STOCKIHA_GROUND_TRUTH.md)
- **Active Implementation & Step Tracker:** [`CURRENT_STEP.md`](../CURRENT_STEP.md)
- **Active Task Progress:** [`TASKS.md`](../TASKS.md)
- **Technical Architecture Evidence:** [`Architecture.md`](../Architecture.md)

---

## 2. Archived Documents in this Directory

| Archived Document | Original Purpose | Why Archived / Obsolete |
|---|---|---|
| [`Stockiha_Audit_Redesigned_Roadmap_2026-08-02.md`](./Stockiha_Audit_Redesigned_Roadmap_2026-08-02.md) | Former roadmap audit and transition plan | Superseded by [`STOCKIHA_GROUND_TRUTH.md`](../STOCKIHA_GROUND_TRUTH.md). Contains obsolete R/S/PR numbering conventions. |
| [`CURRENT_SLICE.md`](./CURRENT_SLICE.md) | Former slice-by-slice execution status tracker | Superseded by [`CURRENT_STEP.md`](../CURRENT_STEP.md) under the workstream-based roadmap model. |

---

## 3. Important Rules
1. **Never use archived documents to override active code, migrations, or tests.**
2. **Never reintroduce obsolete terminology (e.g. Slice 0–9, R0–R12) into active development documents.**
3. **All future product decisions and roadmap milestones must align with [`STOCKIHA_GROUND_TRUTH.md`](../STOCKIHA_GROUND_TRUTH.md).**
