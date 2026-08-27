# Remaining Issues — deferred, non-blocking

Non-urgent, real problems found during task execution but explicitly out of
scope for the task that found them. Nobody should fix these without a
deliberate decision to pick them up.

**Note on this file's history:** prior task briefs in this project referenced
`WS-B_REMAINING_ISSUES.md` at the repo root as an existing document recording
WS-B's own deferred items (the `create_posted_journal` permission gap, the IAM
permissions CHECK constraint, the landed-cost call-shape mismatch, etc.). That
content was never checked into this repository — this file did not exist here
until now. That gap is a separate problem worth naming on its own (the
canonical WS-B issue list may exist only outside this checkout, or may not
exist at all) — it is not solved by creating this file, which starts empty of
WS-B content and only carries what's logged below.

---

## WS-I — Deferred

### 1. `pdf-lib` duplicates font resource entries per `drawText` call

Every call to `drawText` in the PDF export path (`historicalReportExports.ts`,
inherited from the pre-existing `buildHistoricalAnalyticsPdf` pattern in
`historicalExports.ts`) adds a new `/Amiri-Regular-<n>` font resource entry to
the page, even though every entry points at the same embedded font. A one-page
report carries ~26–58 redundant entries. Harmless at current file sizes
(9–13 KB per export), but would bloat a report with many more text lines.

**Fix direction (not implemented):** embed the font once per page/document and
reuse the same resource reference across `drawText` calls, instead of letting
pdf-lib register a new one each time.

### 2. `fontkit.es` is a 716 KB (330 KB gzipped) chunk pulled into the client bundle

Needed for `@pdf-lib/fontkit` to embed the Amiri font for PDF export
(pre-existing dependency, not introduced by WS-I). It's eagerly bundled rather
than lazy-loaded, so every user pays this cost even if they never export a
PDF.

**Fix direction (not implemented):** dynamic `import()` the PDF export path
(and therefore fontkit) only when a user actually clicks an "Exporter PDF"
action, instead of bundling it into the main chunk.

---

*(Add new entries above this line with a task/date heading, in the same
format: what was found, why it's deferred, and a fix direction if known. Do
not fix an entry here without moving it out with a note on which task
resolved it.)*
