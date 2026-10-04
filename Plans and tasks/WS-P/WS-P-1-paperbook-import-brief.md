# WS-P-1 — Historical Paper Book: Import, Manual Entry, Records & Name Clean-up

| | |
|---|---|
| Implementing agent | **Claude Code** |
| Workstream | **WS-P — Historical Paper Book** (new) |
| This sub-plan | **P-1 of 3** — P-1 import + manual entry + records + name clean-up (this brief) · P-2 financial analytics & charts (next brief) · P-3 French/Arabic translations (last) |
| Replaces | `WS-P-0-history-discovery-brief.md` — do **not** run P-0; its checks are now Phase 0 of this brief |
| Branch | `task/ws-p-1-paperbook-import`, created from current `main` |
| Build marker | `[ version = WS-P-1.1 ]` |
| Test files | `WS-P-1-test-fixtures.zip` (given to you with this brief) |

Read the whole brief before touching anything. Every decision below is final. Where the brief gives a name, a number, a message or a rule, use exactly that. If something is not answered here, that is a stop condition (section 20) — never invent a rule.

---

## 0. The owner's situation in plain words

The pilot client (a bedding wholesaler) has kept a **paper ledger** for about 1.5 years. An employee is copying it, block by block, into **one Google Sheet** that follows a fixed layout (`PAPER_BOOK_V2`). The layout will **not** change; your code adapts to it. The owner downloads the sheet as `.xlsx` and imports it into Stockiha.

The owner wants three things from this old data:
1. to **see** every old record inside Stockiha (this brief),
2. to **add** old records by hand when needed (this brief),
3. **detailed financial analytics with charts** (brief P-2 — not now, but your data model must make it easy).

The file only holds three kinds of records: **Sell**, **Buy**, **Expense**. There are no credit/debt records; "Not Paid" is only a flag.

Facts about the real file that you must handle (seen by the architect in the live sheet):
- The employee is still typing. The file is re-downloaded and re-imported many times.
- Numbers are often stored as text with spaces: `9 200`, `110 400`, sometimes with a non-breaking space.
- Row 2 is completely empty. After the last real row there are hundreds of rows where only column K shows `0`.
- The supplier/customer name is sometimes repeated on continuation rows, sometimes only on the first row, sometimes missing.
- Typos exist: a date written `15/052025`, a date with the wrong year (`08/09/2026` among September 2025 rows), a date with the wrong month, names spelled several ways (`pillow cover` / `pillow couver`, `istanbul` / `iatanbul`), trailing spaces (`pillow `), mixed case (`AK home` / `Ak home`).
- The last row is an unfinished Expense with no date, no Paid and amount 0.
- The owner keeps writing the paper book after Stockiha goes live, as a backup. Those later pages must **never** be imported (they would double-count what Stockiha records itself).

---

## 1. Binding rules

1. Follow `stockiha-task-execution` (how you work, git safety, report). Follow `ws-d-skill` §4 (SQL function authoring contract), §5 (LIKE escaping), §7 (frontend rules), §10 (verification). Read `ws-b-skill` so you know what you must **not** touch.
2. **Complete isolation from live data.** Nothing in this workstream reads or writes sales, purchases, stock, stock movements, WAC/cost, cash sessions, journals, documents, customers, suppliers or products. The paper-book data lives only in the new `paperbook` schema. No live report, dashboard or journal may read `paperbook`.
3. **MVP ruling:** only the admin uses the app. Read and write functions validate the session with `iam.resolve_session(p_session_token)` only. No permission gates, no approval flows.
4. **Money and quantities are whole numbers** (Algerian dinars, no centimes). SQL type `numeric(14,0)`. Rust `rust_decimal::Decimal` (or `i64` inside the pure parser only, converted to `Decimal` before leaving it). Strings across IPC. `exactDecimal.ts` + `formatters.ts` in React. No `f32`/`f64`/`double precision`/`real`/JS `number` for any amount.
   - **One documented exception:** `.xlsx` files store numbers as floating point, so the cell reader receives an `f64`. The reader converts it immediately with the rule in section 6.4 and never does arithmetic with it. Put a code comment `// WS-P-1: the only float in this workstream — converted at the boundary, see brief 6.4` on that function.
5. Do not change the app version in `tauri.conf.json` or `package.json`.
6. The client's real Excel file must **never** be committed to git. Only the synthetic test files from the zip are committed.
7. All user-facing text goes through `src/shared/i18n/`. Add every new key to the French, Arabic and English files **with the English text in all three**. Real translations are P-3. No hard-coded strings.
8. Use existing `DESIGN.md` tokens and components only. Accent blue `#2457d6`. Light and dark mode. Arabic RTL (logical CSS properties). Numbers right-aligned, tabular numerals.

---

## 2. Vocabulary (used exactly like this everywhere below)

| Word | Meaning |
|---|---|
| **Transaction** | One paper block = one Sell, Buy or Expense. Stored in `paperbook.txn`. |
| **Line** | One product row inside a transaction (for an Expense, the amount row). Stored in `paperbook.txn_line`. |
| **First row** | The Excel row where column C (Type) is filled. It opens a new transaction. |
| **Continuation row** | A non-empty Excel row with C blank. It belongs to the transaction above. |
| **Go-live date** | The day Stockiha started recording the shop's real work. Every paper-book transaction must be dated **before** it. Stored once in `paperbook.settings`. |
| **Import** | Reading one `.xlsx` file and **replacing all previously imported transactions** with its content. |
| **Batch** | One successful import, recorded in `paperbook.import_batch`. Exactly one batch is active at a time. |
| **Source** | `import` (came from the file) or `manual` (typed in Stockiha). Manual transactions survive every re-import. |
| **Raw text** | A name as written in the file, trimmed, spaces collapsed, case kept. Used for display. |
| **Key** | The normalised form of a raw text (section 6.3). Two texts with the same key are the same name. |
| **Label** | What the owner sees for a key: the owner's chosen name if mapped, else the most frequent raw text. |
| **Effective key** | The key after applying the owner's name mapping. Analytics group by effective key. |

---

## 3. Phase 0 — establish reality (do this first, report it at the top of your report)

Mark each finding **verified** (you ran it / opened it and saw it), **read but not executed**, or **assumed**. Use live signatures from `pg_proc` (ws-d-skill §0 query), never the first migration that mentions a function. Read-only queries only against `stockiha_acceptance` (port 5433) during Phase 0.

**A. The existing historical page (it will be replaced)**
1. Its route path, sidebar entry (label + position), and every React file that belongs to it.
2. Every Tauri command it calls; for each, the Rust module and every SQL function behind it (live signature + full body).
3. Every table/schema it reads or writes (`\d` output in full) and the row counts in the acceptance DB.
4. Does anything **other than that page** use those commands, functions or tables (reports, dashboard, journals, backup/restore, notifications)? List every reference with file and line.
5. Does it write into any live operational table (sales, purchases, stock, movements, WAC, cash, journals, balances)? Back a "no" with the function bodies.
6. What it currently shows (analytics/charts), in one short list.

**B. Things this brief depends on**
7. Does a schema named `paperbook` exist? (`SELECT nspname FROM pg_namespace WHERE nspname = 'paperbook';`)
8. The return type of `iam.resolve_session` and the type/name of the user id it gives you (for `created_by`).
9. How backup (WS-H) captures the database: whole database, or a list of schemas? File and line. How restore works.
10. Which xlsx library exists in `src-tauri/Cargo.toml` or `package.json` (name + version). Whether `sha2`, `regex`, `uuid`, `chrono` are in `Cargo.toml` (versions).
11. How other screens open a native file picker (Tauri dialog plugin usage: file + line), e.g. backup restore.
12. The folder conventions for pure domain code, application (DB) code and commands in `src-tauri/src/` (give two existing examples with paths).
13. Chart library installed in the frontend (name + version) and which screens use it. (For P-2 — do not add charts now.)
14. Is there any **live** expense recording anywhere in Stockiha (table, screen, journal entry)? Paths and signatures. (For a later decision — do not build it.)
15. Current version marker string in `src/features/dashboard/DashboardScreen.tsx`.

**Stop gates (stop and report, do not continue) if:**
- item 7: a `paperbook` schema already exists;
- item 4: the old page's tables or functions are used by something other than the old page itself (you would break it by removing the page);
- item 10: no maintained xlsx reader can be added to the Rust side (report options);
- item 9: backup uses a hand-written schema list **and** restore cannot be tested locally.

Otherwise continue without waiting.

---

## 4. Data model — new migration

Create one migration file named `<timestamp>_ws_p_1_paperbook_foundation.sql`. Everything below goes in it. Follow ws-d-skill §4 for every function (SECURITY DEFINER, `SET search_path = pg_catalog`, fully schema-qualified names inside bodies, `REVOKE ALL ... FROM PUBLIC`, then `GRANT EXECUTE` to the runtime role exactly as existing functions do). Tables get the same grants pattern the existing schemas use (runtime role gets no direct table access if that is the existing pattern — check and copy).

### 4.1 Normalisation function (the single definition of a "key")

```sql
CREATE FUNCTION paperbook.normalize_key(p text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  SELECT NULLIF(
    pg_catalog.translate(
      pg_catalog.btrim(
        pg_catalog.regexp_replace(
          pg_catalog.translate(p, E'\u00A0\u202F\u2009\t\n\r', '      '),
          ' {2,}', ' ', 'g')),
      'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'),
    '')
$$;
```

`normalize_key` and `clean_text` (below) are plain helpers used by generated columns: they are **not** `SECURITY DEFINER`, take no session token and read no table. This is the one deliberate exception to ws-d-skill §4 in this workstream.

Rules it implements (the Rust version must produce byte-identical output — see tests 16.1 item 8 and 16.2 item 8):
1. Replace U+00A0, U+202F, U+2009, tab, LF, CR with a normal space.
2. Replace every run of 2+ spaces with one space.
3. Trim spaces at both ends.
4. Lower-case **ASCII letters A–Z only**. Every other character (accented letters, Arabic, digits, punctuation) is kept unchanged. Do not use `lower()` / `to_lowercase()`: they depend on locale.
5. Empty result → NULL.

Also create `paperbook.clean_text(p text)` = rules 1–3 only (case kept), empty → NULL. Raw texts are stored after `clean_text`.

### 4.2 Tables

```sql
CREATE TABLE paperbook.settings (
  id           smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  go_live_date date NULL,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
INSERT INTO paperbook.settings (id) VALUES (1);

CREATE TABLE paperbook.import_batch (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  file_name     text NOT NULL,
  file_sha256   text NOT NULL CHECK (file_sha256 ~ '^[0-9a-f]{64}$'),
  sheet_name    text NOT NULL,
  txn_count     integer NOT NULL CHECK (txn_count >= 1),
  line_count    integer NOT NULL CHECK (line_count >= 1),
  warning_count integer NOT NULL CHECK (warning_count >= 0),
  is_active     boolean NOT NULL,
  imported_at   timestamptz NOT NULL DEFAULT now(),
  imported_by   <user id type from Phase 0 item 8> NOT NULL,
  superseded_at timestamptz NULL,
  CHECK (is_active = (superseded_at IS NULL))
);
CREATE UNIQUE INDEX import_batch_one_active ON paperbook.import_batch (is_active) WHERE is_active;

CREATE TABLE paperbook.txn (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source          text NOT NULL CHECK (source IN ('import','manual')),
  batch_id        bigint NULL REFERENCES paperbook.import_batch(id),
  excel_first_row integer NULL CHECK (excel_first_row >= 2),
  excel_txn_no    text NULL,
  txn_date        date NOT NULL,
  txn_type        text NOT NULL CHECK (txn_type IN ('sell','buy','expense')),
  is_paid         boolean NOT NULL,
  party_raw       text NULL,
  party_key       text GENERATED ALWAYS AS (paperbook.normalize_key(party_raw)) STORED,
  benefit         numeric(14,0) NULL,
  page_no         text NULL,
  note            text NULL CHECK (note IS NULL OR char_length(note) <= 500),
  total           numeric(14,0) NOT NULL CHECK (total > 0),
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      <user id type> NOT NULL,
  updated_at      timestamptz NULL,
  updated_by      <user id type> NULL,
  CHECK ((source = 'import') = (batch_id IS NOT NULL)),
  CHECK ((source = 'import') = (excel_first_row IS NOT NULL)),
  CHECK (source = 'manual' OR note IS NULL),
  CHECK (benefit IS NULL OR txn_type = 'sell')
);
CREATE INDEX txn_date_idx      ON paperbook.txn (txn_date);
CREATE INDEX txn_type_date_idx ON paperbook.txn (txn_type, txn_date);
CREATE INDEX txn_party_key_idx ON paperbook.txn (party_key);
CREATE INDEX txn_source_idx    ON paperbook.txn (source);

CREATE TABLE paperbook.txn_line (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  txn_id           bigint NOT NULL REFERENCES paperbook.txn(id) ON DELETE CASCADE,
  line_no          integer NOT NULL CHECK (line_no >= 1),
  excel_row        integer NULL CHECK (excel_row >= 2),
  product_raw      text NULL,
  product_key      text GENERATED ALWAYS AS (paperbook.normalize_key(product_raw)) STORED,
  brand_raw        text NULL,
  brand_key        text GENERATED ALWAYS AS (paperbook.normalize_key(brand_raw)) STORED,
  details_raw      text NULL,
  details_key      text GENERATED ALWAYS AS (paperbook.normalize_key(details_raw)) STORED,
  quantity         numeric(14,0) NULL CHECK (quantity IS NULL OR quantity >= 1),
  unit_price       numeric(14,0) NULL CHECK (unit_price IS NULL OR unit_price >= 0),
  line_total       numeric(14,0) NOT NULL CHECK (line_total >= 0),
  total_overridden boolean NOT NULL DEFAULT false,
  page_no          text NULL,
  UNIQUE (txn_id, line_no)
);
CREATE INDEX txn_line_txn_idx     ON paperbook.txn_line (txn_id);
CREATE INDEX txn_line_product_idx ON paperbook.txn_line (product_key);
CREATE INDEX txn_line_brand_idx   ON paperbook.txn_line (brand_key);
CREATE INDEX txn_line_details_idx ON paperbook.txn_line (details_key);

CREATE TABLE paperbook.name_map (
  field           text NOT NULL CHECK (field IN ('party','product','brand','details')),
  raw_key         text NOT NULL,
  canonical_label text NOT NULL CHECK (paperbook.normalize_key(canonical_label) IS NOT NULL),
  canonical_key   text GENERATED ALWAYS AS (paperbook.normalize_key(canonical_label)) STORED,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      <user id type> NOT NULL,
  PRIMARY KEY (field, raw_key)
);
CREATE INDEX name_map_canonical_idx ON paperbook.name_map (field, canonical_key);

CREATE TABLE paperbook.name_dismissed (
  field      text NOT NULL CHECK (field IN ('party','product','brand','details')),
  key_a      text NOT NULL,
  key_b      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (key_a < key_b),
  PRIMARY KEY (field, key_a, key_b)
);
```

Notes:
- A `name_map` row whose `canonical_key` equals its `raw_key` is allowed: it only changes how the name is displayed (e.g. `ak home` shown as `AK Home`).
- The "most frequent raw text" for a key: among all rows holding that raw key, the `clean_text` value used most often; tie → alphabetically first (use `ORDER BY count DESC, raw ASC`).
- Effective key of a raw key = `coalesce(name_map.canonical_key, raw_key)`.
- Label of an effective key = the `canonical_label` of the most recently created `name_map` row whose `canonical_key` = that key; if none, the most frequent raw text among rows whose raw key = that key.
- Put these three rules in one SQL view or set-returning function (`paperbook.v_labels` or `paperbook._labels(field)`) and use it everywhere. Never re-implement them in React.

---

## 5. What the page looks like

### 5.1 Navigation
- Replace the old historical page. Use the **old route path** and the **old sidebar position** if one exists (Phase 0 item 1); otherwise route `/paper-book`, placed directly after Reports in the sidebar.
- Sidebar label (i18n key `paperbook.nav`): **"Paper book (history)"**.

### 5.2 Page header (always visible)
- Title: "Paper book (history)". Subtitle: "Records copied from the paper ledger. They never change today's stock, cash or reports."
- **Go-live chip**: "Stockiha go-live date: 01/03/2026 · Change". When not set: an amber callout: "Set the date Stockiha started recording your shop's work. Paper records on or after this date cannot be imported." with a date input and **Save**. While not set, the Import tab and the "Add record" button are disabled (with a tooltip saying why).
- Changing the date opens a small dialog with the date input; errors from the backend are shown inside the dialog.

### 5.3 Tabs
Three tabs in this order: **Records** (default) · **Import** · **Names**.

---

## 6. Import — reading the file

All reading and checking happens in **pure Rust** (no database access) in a domain module, so it can be unit-tested with the fixture files. Recommended location (adapt only to the existing folder convention from Phase 0 item 12, and report the paths you used):
`src-tauri/src/domain/paperbook/{mod.rs, cells.rs, normalize.rs, reader.rs, validate.rs, warnings.rs, suggest.rs}`.

Use the `calamine` crate (current stable release; state the version) unless Phase 0 found an xlsx reader already in use. Use `sha2` for the file hash.

### 6.1 Accepting the file
| Check | Result |
|---|---|
| Extension is not `.xlsx` (case-insensitive) | file error `E_FILE_TYPE` |
| File larger than 25 MB | `E_FILE_TOO_BIG` |
| File cannot be opened as a workbook (corrupt, password) | `E_FILE_UNREADABLE` |

Compute the SHA-256 of the file bytes (lower-case hex) before parsing.

### 6.2 Choosing the sheet and checking the header row
Expected headers, columns A to M (compared after normalising both sides: whitespace incl. newlines → single space, trim, ASCII case-insensitive):

| Col | Header | Col | Header |
|---|---|---|---|
| A | Txn No. (Auto) | H | Custom Details (Optional) |
| B | Date | I | Quantity |
| C | Type | J | Unit Price |
| D | Paid | K | Line Total |
| E | Party / Company (Optional) | L | Benefit (Sell Only) |
| F | Product Name (Optional) | M | Page No. (Optional) |
| G | Brand (Optional) | | |

- Look at row 1 of every sheet, in workbook order. A sheet **fully matches** when all 13 headers are equal. It **partly matches** when 6–12 are equal.
- Exactly one full match → use it. Columns after M are ignored.
- Two or more full matches → file error `E_SEVERAL_MATCHING_SHEETS` (params: sheet names).
- No full match, at least one partial → `E_LAYOUT` for the **first** partial sheet: one issue per wrong column (row 1, that column, params `expected`, `found`). No row checks are run.
- No full or partial match → `E_NO_MATCHING_SHEET`.
- Other sheets (for example a "Guide" tab) are ignored silently.

### 6.3 Normalising text (Rust side)
`clean_text` and `normalize_key` in `normalize.rs` implement **exactly** the rules of section 4.1. Keep a shared list of at least 12 tricky inputs (NBSP, narrow NBSP, tabs, newlines, double spaces, `ÉTÉ`, Arabic text, digits, empty, only spaces) with their expected outputs, used by both the Rust test and the SQL test (16.4).

### 6.4 Reading cells
Blank means: empty cell, or a text cell that is empty after `clean_text`.

**Whole-number cells (I Quantity, J Unit Price, K Line Total, L Benefit)** → function `parse_whole(cell) -> Result<Option<i64>, Code>`:
| Cell | Result |
|---|---|
| blank | `None` |
| number (float or int) | if finite, has no fractional part and `|v| <= 9_007_199_254_740_991` → that integer; fractional → `E_NOT_WHOLE`; otherwise `E_NUMBER_INVALID` |
| text | remove U+0020, U+00A0, U+202F, U+2009; the rest must match `^-?[0-9]+$` → integer; anything else (letters, `,`, `.`) → `E_NUMBER_INVALID` |
| Excel error (`#DIV/0!`, `#VALUE!`, …) | `E_CELL_ERROR` |
| date, bool | `E_NUMBER_INVALID` |

**Date cell (B)** → `parse_date(cell) -> Result<Option<NaiveDate>, Code>`:
| Cell | Result |
|---|---|
| blank | `None` |
| Excel date/datetime | its calendar date (time ignored) |
| text | must match `^\s*(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})\s*$`, read as **day / month / year**, must be a real calendar date and year ≥ 2000 → date; otherwise `E_DATE_INVALID` |
| plain number (not date-formatted), bool | `E_DATE_INVALID` |
| Excel error | `E_CELL_ERROR` |

**Text cells (C, D, E, F, G, H, M)**: text → `clean_text`; whole number → its digits (`160`); non-whole number → shortest decimal with `.` (`1.6`); date → `YYYY-MM-DD`; bool → `TRUE`/`FALSE`; Excel error → `E_CELL_ERROR` on that column.

**Column A** is never used for logic. If its value is text starting with `TX-`, keep it as `excel_txn_no` for display in messages and in the Records list.

**Type (C)** after `normalize_key`: `sell` / `buy` / `expense` → valid. Anything else non-blank → `E_TYPE_INVALID`.
**Paid (D)** after `normalize_key`: `paid` → true, `not paid` → false. Anything else non-blank → `E_PAID_INVALID`.

### 6.5 Splitting rows into transactions
For each row from 2 to the last row of the sheet's range:
1. **Has line data** = any of F, G, H, I, J is non-blank, **or** K is non-blank and not equal to 0 (number 0 or text `0`).
2. **Empty row** = C, B, D, E, L, M blank **and** no line data → skip it silently (count it for display only).
3. C non-blank → this row is a **first row**: close the current transaction, open a new one. Transaction fields come from this row: B date, C type, D paid, E party, L benefit, M page.
4. C blank, not empty → **continuation row** of the current transaction. If there is no current transaction → `E_ORPHAN_LINE` (column C) and skip the row.
5. Every row (first or continuation) that has line data adds one **line** (F product, G brand, H details, I quantity, J unit price, K line total, M page) with `line_no` 1, 2, 3… in row order.
6. Transaction page = M of the first row if non-blank, else the first non-blank M among its other rows. Each line also keeps its own M.

### 6.6 Errors (blocking) — exact rules
Report **every** error in the file (not just the first), each with row, column, code and params. Messages are in Appendix A.

**File/sheet level**: `E_FILE_TYPE`, `E_FILE_TOO_BIG`, `E_FILE_UNREADABLE`, `E_NO_MATCHING_SHEET`, `E_SEVERAL_MATCHING_SHEETS`, `E_LAYOUT`, `E_GO_LIVE_NOT_SET` (go-live date not set), `E_NO_TRANSACTIONS` (sheet has zero transactions).

**Transaction level** (reported on the first row unless stated):
| Code | Column | Rule |
|---|---|---|
| `E_TYPE_INVALID` | C | Type is not Sell/Buy/Expense. The benefit checks below are skipped for this transaction. |
| `E_DATE_MISSING` | B | B blank on the first row |
| `E_DATE_INVALID` | B | see 6.4 |
| `E_DATE_IN_FUTURE` | B | date > today (Africa/Algiers). When this fires, do not also report `E_DATE_AFTER_GO_LIVE`. |
| `E_DATE_AFTER_GO_LIVE` | B | date ≥ go-live date |
| `E_PAID_MISSING` | D | D blank on the first row |
| `E_PAID_INVALID` | D | see 6.4 |
| `E_BENEFIT_NOT_SELL` | L | type is Buy or Expense and L is non-blank |
| `E_NUMBER_INVALID` / `E_NOT_WHOLE` / `E_CELL_ERROR` | L | Sell benefit cannot be read (negative is allowed) |
| `E_CELL_ERROR` | E, F, G, H, M | text cell holds an Excel error (reported on that row) |
| `E_TXN_NO_LINES` | K | the transaction has zero lines |
| `E_TXN_TOTAL_ZERO` | K | all lines are error-free and their totals add up to 0 |

**Continuation rows** (reported on the continuation row):
| Code | Column | Rule |
|---|---|---|
| `E_CONTINUATION_DATE_DIFFERS` | B | B non-blank and (unreadable, or a different date than the transaction). Same date → silently accepted. |
| `E_CONTINUATION_PAID_DIFFERS` | D | D non-blank and its normalised value differs from the first row's. Same → accepted. |
| `E_CONTINUATION_PARTY_DIFFERS` | E | E non-blank and its key differs from the first row's key (a blank first-row party also counts as different). Same → accepted (the real file repeats the supplier on every row). |
| `E_BENEFIT_NOT_FIRST_ROW` | L | L non-blank on a continuation row |

**Line level** — checked in this order; **stop at the first failure for that line** (one error per line maximum):
1. I (quantity): `parse_whole` error → that code on I; if present and < 1 → `E_QTY_NOT_POSITIVE` on I.
2. J (unit price): `parse_whole` error → that code on J; if present and < 0 → `E_AMOUNT_NEGATIVE` on J.
3. K (line total): `parse_whole` error → that code on K; if present and < 0 → `E_AMOUNT_NEGATIVE` on K.
4. Amount: K present → `line_total = K`, and `total_overridden = true` when I and J are both present and K ≠ I × J. K blank and I, J both present → `line_total = I × J`. Otherwise → `E_LINE_AMOUNT_MISSING` on K.

These amount rules are the same for Sell, Buy and Expense (an Expense normally has only K).

**If there is at least one error, the import is blocked.** Nothing is written. Warnings are **not** computed while errors exist.

### 6.7 Warnings (only when there are zero errors)
Warnings never block. The owner must tick "I have checked these warnings" before importing. List them sorted by row (file-level ones first).

| Code | Row | Rule |
|---|---|---|
| `W_DATE_OUT_OF_ORDER` | first row | Compare the transaction's date with the previous and next transaction in row order. Warn when it is more than 7 days **earlier than all** its neighbours, or more than 7 days **later than all** its neighbours (a transaction at the start or end has one neighbour). Params: `date`, `prev`, `next`. |
| `W_PRICE_UNUSUAL` | the line | Group lines by (type, product key, brand key, details key) where the product key is not NULL and unit price is present. Groups with fewer than 3 lines are skipped. Median = middle value (even count: average of the two middle values, exact decimal). Warn when `|price − median| × 100 > 25 × median` (no division; skip if median = 0). Params: `price`, `median`, `name` (product / brand / details labels). |
| `W_TOTAL_OVERRIDDEN` | the line | `total_overridden = true`. Params: `qty`, `price`, `computed`, `written`. |
| `W_LINE_ONLY_AMOUNT` | the line | Sell or Buy line with I and J both blank (only K). |
| `W_BENEFIT_ABOVE_TOTAL` | first row | Sell benefit > transaction total. Params: `benefit`, `total`. |
| `W_DUPLICATE_IN_FILE` | first row | Same date, same type, same party key, and the same ordered list of lines (product key, brand key, details key, quantity, unit price, line total) as an earlier transaction in the file. Flag the second and later occurrences. Params: `other_row`. |
| `W_POSSIBLE_MANUAL_DUPLICATE` | first row | A **manual** transaction in the database has the same date, type and total. Params: `manual_id`. |
| `W_FEWER_THAN_CURRENT` | file level | The file has fewer transactions than the active batch. Params: `file_count`, `current_count`, `current_date`. |

### 6.8 Name suggestions (used by the Names tab, section 9)
Two effective keys of the same field are **suggested as possibly the same** when all of these hold:
1. Their sequences of digit runs are identical (`re.findall(\d+)`): `1p` vs `2p` → never; `240` vs `260` → never; `0,9` vs `0,90` → never.
2. The shorter key has at least 4 characters.
3. Levenshtein distance (on characters) ≤ 1 when the shorter key has 4–7 characters, ≤ 2 when it has 8 or more.
4. The pair is not in `paperbook.name_dismissed`.

Implement Levenshtein yourself in `suggest.rs` (about 20 lines, no new crate). Suggestions are computed in Rust from keys fetched from SQL.

---

## 7. Import — the flow and the screen

### 7.1 Import tab
1. **Current import card**: "Current import: `<file name>` · imported `<date time>` · `<N>` records" or "Nothing imported yet". Below: "`<M>` records entered by hand (always kept)."
2. **Choose file** button → native file picker (same plugin as Phase 0 item 11), filter `.xlsx`.
3. While reading: spinner + "Reading the file…".
4. **Preview** (no database write yet):
   - Summary tiles: Transactions (with Sell / Buy / Expense counts) · Lines · Dates (first → last) · Sales total · Purchases total · Expenses total · Recorded benefit ("46,500 DA on 6 of 7 sales") · Not paid (sales / purchases / expenses).
   - If the file's SHA-256 equals the active batch's: blue banner "This exact file is already imported (on `<date>`). Nothing to do." and no import button.
   - **Errors** (red), if any: header "`<n>` problems to fix in the Excel file — nothing was imported". Table columns: Row · Txn No. · Column · Problem. Under the table: "Fix these in the Google Sheet, download it again as .xlsx and choose it again."
   - **Warnings** (amber), only when there are no errors: table Row · Txn No. · Problem, then the checkbox "I have checked these warnings".
   - **Replace notice**: "Importing will replace the `<N>` records from the current import. The `<M>` records entered by hand are kept." (or "This is the first import." when none).
   - Button **"Import and replace"**: visible only with zero errors and not the same file; enabled only when warnings are zero or the checkbox is ticked.
   - Show at most 1,000 issues in each table; above it "Showing the first 1,000 of `<total>`".
5. **After success**: green toast "Imported `<N>` records (`<L>` lines). `<R>` older imported records were replaced." and switch to the Records tab.

### 7.2 Commit rules
- The commit command receives the **path**, the **SHA-256 shown in the preview** and `warnings_acknowledged`.
- It re-reads the file, recomputes the hash; if it differs → error "The file changed since the preview. Choose it again." (code `E_FILE_CHANGED`).
- It re-runs all checks. Any error → refuse (the preview is never trusted). Warnings > 0 and not acknowledged → refuse (`E_WARNINGS_NOT_ACKNOWLEDGED`).
- It calls `paperbook.import_replace` (section 11) **once**, which does everything in a single database transaction: delete all `source = 'import'` transactions (lines cascade), mark the active batch superseded, insert the new batch, insert all transactions and lines. Manual transactions are never touched.
- If anything fails, nothing changes (the old import is still there).

---

## 8. Records tab (list, details, manual entry)

### 8.1 Filters bar
Date from / Date to · Type (All, Sell, Buy, Expense) · Paid (All, Paid, Not paid) · Source (All, Imported, Entered by hand) · Search box (matches party, product, brand or details **label or raw text**, contains, case-insensitive, LIKE-escaped per ws-d-skill §5) · Sort (Newest first — default, Oldest first). Button **"Add record"** on the right.

### 8.2 Table — server-side paginated, 50 per page
Columns: Date · Type (badge: Sale / Purchase / Expense) · Party (label) · What (first line's product label + brand label + details label, then "+N more") · Total · Benefit (sales only, "—" when blank) · Paid (badge; "Not paid" in amber) · Source (Imported "TX-000123" / Entered by hand) · Page.
Sort order: `txn_date` then `id`, in the chosen direction.

### 8.3 Totals strip (under the filters, for the **whole filtered set**, not the page)
Records `<count>` · Sales `<total>` · Purchases `<total>` · Expenses `<total>` · Recorded benefit `<total>` · Not paid `<total>`.

### 8.4 Detail drawer (click a row)
All transaction fields, then the lines table: Product · Brand · Details · Qty · Unit price · Line total (tag "written by hand" when `total_overridden`) · Page. When a label differs from the raw text, show both: "pillow couver → **pillow cover**".
- Imported records: read-only, with the note "To correct it, fix the Excel file and import again."
- Manual records: **Edit** and **Delete** buttons. Delete asks "Delete this record? This cannot be undone." and hard-deletes.

### 8.5 Add / edit record form (dialog)
Common fields: Type (Sale / Purchase / Expense — segmented) · Date · Paid / Not paid · Party (autocomplete) · Page (optional) · Note (optional, max 500 characters).
- **Sale / Purchase**: a lines table (min 1 line, add/remove line buttons): Product (autocomplete) · Brand (autocomplete) · Details (autocomplete) · Qty · Unit price · Line total. Line total fills itself with Qty × Unit price; the user may type another value, which sets `total_overridden` and shows the tag "written by hand". **Benefit** field only for Sale (negative allowed).
- **Expense**: Description (stored as `details_raw` of a single line, autocomplete on details) and Amount (stored as `line_total`); Qty and Unit price optional and hidden behind "Add quantity and price".
- Autocomplete: server-side, labels whose raw text or label **contains** the typed text, max 10, LIKE-escaped.
- Validation: the same Rust rules as the import (section 6.6, line rules and date/go-live/benefit rules) plus: at least one line; errors shown under the related field. SQL re-checks on save (section 11).
- Saving is disabled while the go-live date is not set.

---

## 9. Names tab (clean-up)

Sub-tabs: **Parties** · **Products** · **Brands** · **Details**.

### 9.1 "Possible duplicates" panel (top)
One card per suggestion (section 6.8): "**pillow cover** (3 uses) ↔ **pillow couver** (1 use)" with three buttons: **Keep "pillow cover"** · **Keep "pillow couver"** · **Not the same**. "Keep X" maps the other key to X's label. "Not the same" writes a `name_dismissed` row. When there are none: "No possible duplicates found."

### 9.2 Names table (server-side paginated, 50 per page, search box)
Columns: Written as (label of the raw key) · Uses (parties: number of transactions; others: number of lines) · Shown as (effective label; "same" when not mapped) · Actions: **Rename / merge** (dialog: type a name, with autocomplete of existing labels) · **Undo** (only when mapped).

### 9.3 Mapping rules (enforced in SQL, `paperbook.set_name_map`)
- Mapping raw key X to label L: let T = `normalize_key(L)`. If T itself has a mapping to label L2, use L2 instead of L (no chains).
- Upsert `(field, X) → label`.
- Every other mapping in the same field whose `canonical_key` = X is updated to the same label (so merging a name that others were merged into keeps them together).
- Mappings apply everywhere at read time (Records, Names, and later P-2 analytics) and survive every re-import, because they are keyed by text, not by rows.

---

## 10. Go-live date rules (`paperbook.set_go_live_date`)
- Allowed range: 2000-01-01 ≤ date ≤ today + 365 days.
- Refused (`22023`) if any stored transaction has `txn_date >= new date`; message includes the count and the earliest such date, e.g. `paperbook: 3 records are dated on or after 2026-03-01 (earliest 2026-03-15)`.
- Once set it can be changed (same rules) but never cleared.

---

## 11. Backend — exact functions

All in schema `paperbook`, following ws-d-skill §4. Read functions `STABLE`; write functions `VOLATILE`. Every function starts with `PERFORM 1 FROM iam.resolve_session(p_session_token);` (or the variant that gives you the user id for `created_by`). Validation failures raise `ERRCODE = '22023'` with a message starting `paperbook: `. Every limit is clamped: `LEAST(GREATEST(coalesce(p_limit,50),1),200)`.

| # | Function | Returns | Notes |
|---|---|---|---|
| 1 | `get_settings(p_session_token text)` | `go_live_date date` | |
| 2 | `set_go_live_date(p_session_token text, p_date date)` | `go_live_date date` | section 10 |
| 3 | `import_status(p_session_token text)` | one row: `batch_id, file_name, file_sha256, imported_at, txn_count, line_count` (all NULL when none), `manual_count bigint` | used by the Import tab and by the preview |
| 4 | `manual_signatures(p_session_token text)` | rows `id, txn_date, txn_type, total` for manual transactions | for `W_POSSIBLE_MANUAL_DUPLICATE` |
| 5 | `import_replace(p_session_token text, p_file_name text, p_file_sha256 text, p_sheet_name text, p_warning_count integer, p_txns jsonb)` | one row `batch_id, txn_count, line_count, replaced_txn_count` | single statement-level transaction; see payload 11.1 |
| 6 | `create_manual(p_session_token text, p_txn jsonb)` | `id bigint` | payload 11.1 without Excel fields |
| 7 | `update_manual(p_session_token text, p_id bigint, p_txn jsonb)` | `id bigint` | refuses non-manual ids; replaces all lines |
| 8 | `delete_manual(p_session_token text, p_id bigint)` | `void` | refuses non-manual ids |
| 9 | `list_txns(p_session_token text, p_from date, p_to date, p_type text, p_paid text, p_source text, p_search text, p_sort text, p_limit integer, p_offset integer)` | rows + `total_count bigint` (window count) | `p_type` ∈ NULL/`sell`/`buy`/`expense`; `p_paid` ∈ NULL/`paid`/`not_paid`; `p_source` ∈ NULL/`import`/`manual`; `p_sort` ∈ `newest`/`oldest`; anything else → 22023 |
| 10 | `list_totals(same filters, no sort/limit/offset)` | one row: `txn_count, sell_total, buy_total, expense_total, benefit_total, not_paid_total` | must equal the sums of `list_txns` over all pages |
| 11 | `get_txn(p_session_token text, p_id bigint)` | one row with labels | |
| 12 | `get_txn_lines(p_session_token text, p_id bigint)` | lines with raw texts and labels | |
| 13 | `autocomplete(p_session_token text, p_field text, p_text text, p_limit integer)` | `label text` rows | max 10 |
| 14 | `list_names(p_session_token text, p_field text, p_search text, p_limit integer, p_offset integer)` | `raw_key, raw_label, usage_count, effective_key, effective_label, is_mapped` + `total_count` | |
| 15 | `list_effective_keys(p_session_token text, p_field text)` | `effective_key, label, usage_count` | input for Rust suggestions |
| 16 | `list_dismissed(p_session_token text, p_field text)` | `key_a, key_b` | |
| 17 | `set_name_map(p_session_token text, p_field text, p_raw_key text, p_label text)` | `void` | section 9.3 |
| 18 | `remove_name_map(p_session_token text, p_field text, p_raw_key text)` | `void` | |
| 19 | `dismiss_suggestion(p_session_token text, p_field text, p_key_a text, p_key_b text)` | `void` | stores the pair sorted |

### 11.1 Transaction payload (jsonb) — money and quantities as **strings**
```json
{
  "excel_first_row": 3, "excel_txn_no": "TX-000001",
  "date": "2025-05-13", "type": "buy", "paid": true,
  "party": "Supplier Alpha", "benefit": null, "page": "1", "note": null,
  "lines": [
    {"excel_row": 3, "product": "couette", "brand": "Alpha", "details": "bossoft",
     "qty": "12", "unit_price": "9200", "line_total": "110400",
     "total_overridden": false, "page": "1"}
  ]
}
```
`import_replace` receives an array of these. Manual payloads omit `excel_first_row`, `excel_txn_no` and `excel_row`.

### 11.2 Server-side safety net (inside functions 5, 6, 7)
Rust has already checked everything; SQL re-checks the rules that protect the data, and raises `22023` naming the Excel row when one fails (this should never fire in normal use): go-live date set; `date < go_live_date`; `date <= (now() AT TIME ZONE 'Africa/Algiers')::date`; type in the three values; benefit only on sell; at least one line; each line's `line_total >= 0`, `quantity >= 1` when present, `unit_price >= 0` when present; **the transaction total is computed in SQL as the sum of its line totals** (never taken from the payload) and must be > 0; raw texts stored through `clean_text`. Put the shared insert logic in one private function `paperbook._insert_txn(...)` used by functions 5, 6 and 7.

### 11.3 Rust and TypeScript
- Commands (one per row below), registered in `src-tauri/src/lib.rs`: `paperbook_get_settings`, `paperbook_set_go_live_date`, `paperbook_preview_import(path)`, `paperbook_commit_import(path, expected_sha256, warnings_acknowledged)`, `paperbook_list_txns`, `paperbook_list_totals`, `paperbook_get_txn`, `paperbook_create_manual`, `paperbook_update_manual`, `paperbook_delete_manual`, `paperbook_autocomplete`, `paperbook_list_names`, `paperbook_name_suggestions(field)`, `paperbook_set_name_map`, `paperbook_remove_name_map`, `paperbook_dismiss_suggestion`.
- Issues are returned as data, not text: `{ row: number|null, txn_no: string|null, column: string|null, code: string, params: Record<string,string> }`. React builds the message from i18n key `paperbook.issue.<CODE>` with the params (this is what makes P-3 translation possible).
- Preview DTO: `{ file_name, file_sha256, sheet_name, same_as_current, current_import, manual_count, summary, errors, error_total, warnings, warning_total, can_import }`. Summary money values are strings.
- Every SQL call passes every parameter explicitly with an explicit cast (ws-d-skill §2.2, §2.3).
- DTOs in `src/shared/ipc/dto.ts`, commands in `commands.ts`, gateway calls in `gateway.ts`; React feature folder `src/features/paperbook/`.
- Report the contract triangle for every function: SQL signature · Rust struct + call site · TS type — "verified matching".

---

## 12. Removing the old page
- Remove its route, sidebar entry and React files.
- Remove its Tauri command registrations and Rust command code **only if** Phase 0 item 4 showed nothing else uses them.
- **Do not drop or alter** its SQL tables, functions or data. List them all in the report under "Old objects left in place" — they will be dropped in a later cleanup after the owner confirms.

---

## 13. Backup coverage
- If backup dumps the whole database (Phase 0 item 9): nothing to change; say so with the file/line proving it.
- If backup uses a schema list: add `paperbook` to it in this task and report the change.
- Either way, add to the owner's manual checks: back up, restore, confirm the Records tab shows the same count and totals.

---

## 14. Test files (from `WS-P-1-test-fixtures.zip`)
Unzip into `src-tauri/tests/fixtures/paperbook/` and commit them (they are synthetic; no client data).

| File | What it is |
|---|---|
| `history_valid.xlsx` | 19 transactions with every allowed quirk (a "Guide" sheet before the data sheet, empty row 2, text numbers with normal and non-breaking spaces, a text date, party repeated on continuation rows, `not  paid` with two spaces, `sell ` with a trailing space, a page number on a continuation row, a Buy with blank quantity and a written total, 60 trailing rows showing 0). Imports with exactly 6 warnings and 0 errors. |
| `history_errors.xlsx` | Every blocking error, one per transaction, plus one valid transaction at the end. |
| `history_bad_layout.xlsx` | Column L header is "Profit" instead of "Benefit (Sell Only)". |
| `history_big_20k.xlsx` | 7,052 transactions / 20,001 lines, for speed. |
| `expected.json` | The exact expected results for all four files. Your tests read it. |

All checks use **go-live date 2026-03-01** and **today frozen at 2026-09-27**. The pure Rust validator must therefore take everything it needs as parameters and never read the clock or the database itself: `go_live`, `today`, the list of manual signatures (for `W_POSSIBLE_MANUAL_DUPLICATE`) and the active batch's transaction count and date (for `W_FEWER_THAN_CURRENT`). For the fixture tests these last two are empty.

---

## 15. Worked example — expected results (assert exactly; paste real output)

### 15.1 `history_valid.xlsx` (empty database, no current import, no manual records)
| Figure | Expected |
|---|---|
| Sheet used | `Transactions` (the `Guide` sheet is ignored) |
| Errors | 0 |
| Transactions | 19 (Sell 7 · Buy 9 · Expense 3) |
| Lines | 30 |
| Dates | 2025-05-03 → 2025-06-12 |
| Sales total | 236,000 |
| Purchases total | 1,189,900 |
| Expenses total | 24,500 |
| Recorded benefit | 46,500 on 6 of 7 sales; those 6 sales total 194,000 |
| Not paid | sales 132,000 · purchases 0 · expenses 18,500 |

Warnings, exactly these six, in this order:
| Row | Code | Why |
|---|---|---|
| 11 | `W_PRICE_UNUSUAL` | couette / Alpha / 1p bought at 2,800; median 5,500 |
| 17 | `W_DATE_OUT_OF_ORDER` | 03/05/2025 between 01/06/2025 and 03/06/2025 |
| 20 | `W_LINE_ONLY_AMOUNT` | Buy line with only a line total (3,000) |
| 26 | `W_TOTAL_OVERRIDDEN` | 10 × 500 = 5,000 but the cell says 4,500 |
| 28 | `W_BENEFIT_ABOVE_TOTAL` | benefit 30,000 > sale total 18,000 |
| 30 | `W_DUPLICATE_IN_FILE` | same as row 27 |

Specific reads to assert:
- Row 6: text date `18/05/2025` → 2025-05-18; text `10`, `11 500`, `115 000` → 10, 11500, 115000.
- Row 7: `1<NBSP>050` and `50<NBSP>400` → 1050 and 50400.
- Row 22: Paid `not  paid` → Not paid. Row 25: Type `sell ` → Sell.
- Rows 13–16 (TX-000006): transaction page = `3` (from row 16).
- Row 18 (TX-000008): Buy line with blank quantity, unit price 5,000, total 25,000 → accepted, **no** warning.
- Brand `ALPHA` and `Alpha` → one key `alpha`. Product `pillow ` and `pillow` → one key `pillow`. Party `client amel` and `Client Amel` → one key `client amel`.

After committing it:
- `list_totals` with no filters: 19 records · sales 236,000 · purchases 1,189,900 · expenses 24,500 · benefit 46,500 · not paid 150,500.
- Name suggestions: Products → exactly one pair (`pillow cover`, `pillow couver`); Details → exactly one pair (`istanbul 2p`, `iatanbul 2p`); Parties and Brands → none.
- Preview the same file again → `same_as_current = true`, no import button.

### 15.2 `history_errors.xlsx`
Import blocked; exactly these 25 errors (row · column · code), nothing else; no warnings computed. Row 29 (a valid Sell, 2 × 8,000, benefit 2,000) must produce no error.

| Row | Col | Code | Row | Col | Code |
|---|---|---|---|---|---|
| 2 | C | E_ORPHAN_LINE | 16 | K | E_AMOUNT_NEGATIVE |
| 3 | B | E_DATE_INVALID | 18 | B | E_CONTINUATION_DATE_DIFFERS |
| 4 | B | E_DATE_MISSING | 20 | E | E_CONTINUATION_PARTY_DIFFERS |
| 5 | C | E_TYPE_INVALID | 22 | D | E_CONTINUATION_PAID_DIFFERS |
| 6 | D | E_PAID_MISSING | 23 | B | E_DATE_AFTER_GO_LIVE |
| 7 | D | E_PAID_INVALID | 24 | B | E_DATE_IN_FUTURE |
| 8 | L | E_BENEFIT_NOT_SELL | 25 | B | E_DATE_MISSING |
| 10 | L | E_BENEFIT_NOT_FIRST_ROW | 25 | D | E_PAID_MISSING |
| 11 | K | E_LINE_AMOUNT_MISSING | 25 | K | E_TXN_NO_LINES |
| 12 | I | E_NOT_WHOLE | 26 | K | E_LINE_AMOUNT_MISSING |
| 13 | I | E_QTY_NOT_POSITIVE | 27 | I | E_QTY_NOT_POSITIVE |
| 14 | J | E_NUMBER_INVALID | 28 | L | E_NUMBER_INVALID |
| 15 | K | E_CELL_ERROR | | | |

(Row 25 is the same situation as the real file's TX-000084: an Expense with no date, no Paid and 0 amount.)

### 15.3 `history_bad_layout.xlsx`
Exactly one error: row 1 · column L · `E_LAYOUT` · expected "Benefit (Sell Only)", found "Profit". No row checks run.

### 15.4 `history_big_20k.xlsx`
0 errors; 7,052 transactions (Sell 3,893 · Buy 2,453 · Expense 706); 20,001 lines; sales 1,498,132,000; purchases 673,691,350; expenses 5,264,500; recorded benefit 299,626,400; last date 2025-10-16. Warnings are not asserted (about 54 `W_DUPLICATE_IN_FILE` are expected). Performance targets in section 17.

---

## 16. Tests you must add

### 16.1 Rust unit tests (pure, no database)
1. The four fixtures against `expected.json` (everything in section 15 that does not need the database).
2. `parse_whole`: `12`, `12.0` (float) → 12; `2.5` → E_NOT_WHOLE; `"9 200"`, `"9\u00A0200"`, `"9\u202F200"` → 9200; `"-500"` → -500; `"1,050"`, `"1.050"`, `"abc"`, `"5 000,50"` → E_NUMBER_INVALID; error cell → E_CELL_ERROR; blank and `"  "` → None.
3. `parse_date`: `13/05/2025`, `3/5/2025`, `13-05-2025`, `13.05.2025` → valid; `15/052025`, `31/02/2025`, `13/05/25`, `05/13/2025` (month 13) → E_DATE_INVALID.
4. Splitting: empty rows in the middle of a transaction are skipped and the next continuation row still belongs to it. A Sell whose only line is 3 × 0 → `E_TXN_TOTAL_ZERO`. A first row with no line data followed by two continuation lines → one transaction with 2 lines.
5. Price median with odd and even counts, and the 25 % boundary (exactly 25 % → no warning; 25.01 % → warning).
6. Date order: first and last transaction (single neighbour).
7. Suggestions: the pairs in section 6.8 (`1p`/`2p`, `240`/`260`, `0,9`/`0,90`, `blanc polister 240`/`blanc polister 260` → not suggested; `iatanbul 1p`/`istanbul 1p`, `rolored`/`colored`, `pillow couver`/`pillow cover` → suggested; `polister`/`polinare` → not suggested).
8. `normalize_key` and `clean_text` shared list (section 6.3).

### 16.2 SQL tests (added to the existing SQL suite)
1. **Replace keeps manual records:** import payload A (3 txns) → create 1 manual → import payload B (2 txns) → 2 imported + 1 manual; 2 batch rows, exactly 1 active; `replaced_txn_count` = 3.
2. **Go-live:** with go-live 2026-03-01, importing a txn dated 2026-03-15 → 22023 and nothing changed. Setting go-live to 2025-06-01 while a txn is dated 2025-06-05 → 22023 with the count and earliest date in the message.
3. Benefit on a buy → 22023. A transaction whose lines total 0 → 22023. `total` equals the sum of line totals even when the payload tries to pass a different total.
4. `update_manual` / `delete_manual` on an imported id → 22023.
5. **Name map chains:** map `pillow couver` → "pillow cover"; then map `pillow cover` → "pillow case": both effective keys = `pillow case`. Then map `x` → "pillow couver": `x` resolves to `pillow case`.
6. **LIKE escaping:** a manual record with party `50% off` and another with party `500 off`: search `50%` returns only the first; search `_0` returns none.
7. `list_totals` equals the sum of every page of `list_txns` for three different filter combinations.
8. `normalize_key` / `clean_text` on the shared list (section 6.3) — identical to the Rust results.

### 16.3 Integration (Rust + database)
Preview + commit `history_valid.xlsx` into a clean test database and assert every figure of 15.1 including `list_totals` and suggestions; then preview `history_errors.xlsx` and assert the database is unchanged.

---

## 17. Performance (paste the measurements)
On `history_big_20k.xlsx`: preview under **5 s**; commit under **10 s**; `list_txns` first page and `list_totals` under **300 ms** each with the 20k data loaded (`EXPLAIN (ANALYZE, BUFFERS)`); Names tab `list_names` under 300 ms. Add an index only if a measurement shows it is needed, and say why.

---

## 18. Verification (literal output with working directory; `NOT RUN — reason` is allowed, an assumed pass is not)
```
npm run typecheck && npm run lint && npm test -- --run && npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo check --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --lib
bash src-tauri/tests/run_current_sql_suites.sh
```
Migrations must apply cleanly to an **empty** database — verify it. A real Rust test run ends with `test result: ok. N passed; 0 failed`; no such line means the tests did not run.

Then set the version marker in `src/features/dashboard/DashboardScreen.tsx` to exactly `[ version = WS-P-1.1 ]` (same commit as the change; bump the last number on every corrective re-run), build the signed installer with `npm run tauri build` (needs `TAURI_SIGNING_PRIVATE_KEY` and its password in the environment) and give the `.exe` path. If the build cannot run: `NOT RUN — reason`.

---

## 19. Out of scope (do not do)
- Analytics, charts, monthly summaries (P-2). Do not add a chart library.
- Real French/Arabic text (P-3).
- Linking paper-book names to real Stockiha products, customers or suppliers.
- Any debt/credit tracking for "Not paid".
- Live (post-go-live) expense recording.
- Importing CSV, `.xls` or `.ods` files; reading Google Sheets directly from the internet.
- Editing imported records inside Stockiha.
- Dropping the old page's SQL objects.
- App version bump.

---

## 20. Stop conditions
Continue on your own through ordinary problems (failing tests, compile errors, missing grants, naming mismatches). Stop and report with 2–3 options and their cost when:
- a Phase 0 stop gate (section 3) fires;
- a fixture result cannot match `expected.json` without changing a rule in this brief (report the row, what you got, and why — never edit `expected.json`);
- you would need to touch live sales, purchases, stock, cash, journals, reports or the dashboard (other than the version marker line);
- the same failure survives two different fix attempts.

---

## 21. Report (Markdown file committed to the branch: `docs/ws-p/WS-P-1-report.md`)
```
## Phase 0 findings (items 1–15, each verified / read but not executed / assumed)
## What changed (files, grouped SQL / Rust / React)
## Old objects left in place (tables, functions, data counts)
## Backup coverage (proof, or the change you made)
## Contract triangle (per function)
## Fixture results (section 15 tables with actual output)
## Tests added (names) and their output
## Performance (section 17 measurements)
## Verification output (literal)
## Build version marker (exact string)
## Installer (.exe path, or NOT RUN — reason)
## Pending manual checks for the owner (see below)
## Unrelated problems found (named, not fixed)
## Not finished / could not verify
Branch: task/ws-p-1-paperbook-import
Commit: <full hash>
Pushed: yes/no
```

**Pending manual checks for the owner** — include these, numbered, each with the exact expected result, and add any others your change needs:
1. Open the dashboard: the marker reads `[ version = WS-P-1.1 ]`. If not, stop — wrong build.
2. Open "Paper book (history)": the go-live callout appears; set the planned go-live date; the callout disappears.
3. Import `history_valid.xlsx`: 0 errors, 6 warnings, summary as in 15.1; tick the box; import; the Records tab shows 19 records and the totals strip shows sales 236,000 · purchases 1,189,900 · expenses 24,500.
4. Download the real Google Sheet as .xlsx and choose it (do **not** import yet): errors include at least TX-000002 (date `15/052025`) and TX-000084 (no date, no Paid, no amount). If the go-live date is before 08/09/2026, TX-000027 (dated 08/09/2026) is also an error; otherwise it is a date warning.
5. Names tab after importing the test file: Products shows one possible duplicate (pillow cover / pillow couver); click Keep "pillow cover"; the Records detail of TX-000006 shows "pillow couver → pillow cover".
6. Add a manual Expense (any date before the go-live date, 4,000 DA, "Transport"). Open `history_valid.xlsx`, change one quantity, save, import it again: the Records tab still shows the manual expense, and the imported records show the new quantity.
7. Arabic: the page mirrors correctly (text still English until P-3).
8. Backup then restore: the Records count and totals are unchanged.

---

## Appendix A — English message texts (i18n `paperbook.issue.<CODE>`, same text in fr/ar files for now)

| Code | Message |
|---|---|
| E_FILE_TYPE | Only Excel files (.xlsx) can be imported. |
| E_FILE_TOO_BIG | The file is larger than 25 MB. |
| E_FILE_UNREADABLE | This file cannot be opened. Download it again as .xlsx. |
| E_NO_MATCHING_SHEET | No sheet in this file has the paper-book columns. |
| E_SEVERAL_MATCHING_SHEETS | Several sheets have the paper-book columns ({sheets}). Keep only one. |
| E_LAYOUT | Column {column} should be titled "{expected}" but is "{found}". |
| E_GO_LIVE_NOT_SET | Set the Stockiha go-live date first. |
| E_NO_TRANSACTIONS | The file has no records. |
| E_FILE_CHANGED | The file changed since the preview. Choose it again. |
| E_WARNINGS_NOT_ACKNOWLEDGED | Tick "I have checked these warnings" first. |
| E_ORPHAN_LINE | This row has no Type and there is no record above it. Fill Type (Sell, Buy or Expense). |
| E_TYPE_INVALID | Type must be Sell, Buy or Expense. |
| E_DATE_MISSING | The first row of a record needs a date. |
| E_DATE_INVALID | Date must be written like 13/05/2025. |
| E_DATE_IN_FUTURE | This date is in the future. |
| E_DATE_AFTER_GO_LIVE | This date is on or after the Stockiha go-live date ({go_live}). Stockiha records these itself. |
| E_PAID_MISSING | The first row of a record needs Paid or Not Paid. |
| E_PAID_INVALID | Paid must be "Paid" or "Not Paid". |
| E_BENEFIT_NOT_SELL | Benefit is only for Sell records. Leave it empty here. |
| E_BENEFIT_NOT_FIRST_ROW | Benefit goes on the first row of the sale only. |
| E_CONTINUATION_DATE_DIFFERS | This row has a different date but no Type. If it is a new record, fill Type. |
| E_CONTINUATION_PAID_DIFFERS | This row says {found} but its record says {expected}. |
| E_CONTINUATION_PARTY_DIFFERS | This row names "{found}" but its record names "{expected}". If it is a new record, fill Type. |
| E_NUMBER_INVALID | Column {column} must be a whole number (found "{found}"). |
| E_NOT_WHOLE | Column {column} must be a whole number, without decimals. |
| E_CELL_ERROR | Column {column} shows an Excel error ({found}). |
| E_QTY_NOT_POSITIVE | Quantity must be 1 or more. |
| E_AMOUNT_NEGATIVE | Column {column} cannot be negative. |
| E_LINE_AMOUNT_MISSING | This line needs a Line Total, or both Quantity and Unit Price. |
| E_TXN_NO_LINES | This record has no product or amount. |
| E_TXN_TOTAL_ZERO | This record's total is 0. |
| W_DATE_OUT_OF_ORDER | Date {date} is far from the records around it ({prev} / {next}). Check the year and month. |
| W_PRICE_UNUSUAL | Unit price {price} is far from the usual {median} for {name}. |
| W_TOTAL_OVERRIDDEN | {qty} × {price} = {computed}, but the Line Total says {written}. The written amount is used. |
| W_LINE_ONLY_AMOUNT | This line has an amount but no quantity or unit price. |
| W_BENEFIT_ABOVE_TOTAL | Benefit {benefit} is higher than the sale total {total}. |
| W_DUPLICATE_IN_FILE | This record looks identical to row {other_row}. |
| W_POSSIBLE_MANUAL_DUPLICATE | A record entered by hand has the same date, type and total (#{manual_id}). |
| W_FEWER_THAN_CURRENT | This file has {file_count} records but the current import has {current_count} (from {current_date}). Is this the newest file? |

---

## Appendix B — what P-2 (analytics) will need (for your awareness only; build nothing for it)
Monthly and yearly sales, purchases and expenses; recorded benefit and how much of sales it covers; cash result (sales − purchases − expenses); top products (effective product + brand + details), top customers and suppliers by effective party; expense breakdown by effective details; not-paid totals; year-over-year comparison. All grouping uses **effective keys and labels** (section 4.2) — that is why the name map must stay the single source of names.
