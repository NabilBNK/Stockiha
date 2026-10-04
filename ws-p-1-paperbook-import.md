# Task Plan: WS-P-1 — Historical Paper Book: Import, Manual Entry, Records & Name Clean-up

## 1. Overview & Business Objective
The pilot client (a bedding wholesaler) has kept a paper ledger for ~1.5 years, copied into a fixed Excel format (`PAPER_BOOK_V2`).
The owner needs:
1. **Records Tab**: View every historical transaction (Sell, Buy, Expense) in Stockiha, filtered and paginated.
2. **Import Tab**: Upload the `.xlsx` file, preview all records, see exact errors (blocking) or warnings (non-blocking), and commit. A new import replaces previously imported records while permanently preserving all hand-entered records.
3. **Manual Entry**: Add, edit, and delete historical records by hand directly in Stockiha (with full validation against go-live date and line totals).
4. **Names Tab**: Group by canonical names, detect typos via Levenshtein distance, and allow renaming/merging.
5. **Strict Isolation**: The `paperbook` schema is 100% isolated from live tables (`sales`, `inventory`, `finance`, etc.). It never alters live stock, cash sessions, journals, or today's reports.

## 2. In-Scope & Out-of-Scope Work

### In-Scope
- PostgreSQL migration creating the `paperbook` schema, tables (`settings`, `import_batch`, `txn`, `txn_line`, `name_map`, `name_dismissed`), views/functions, and SECURITY DEFINER access wrappers.
- Pure Rust parsing and validation domain module (`src-tauri/src/domain/paperbook/`) using `calamine = "=0.26.1"` and `sha2 = "=0.10.9"`.
- Exact whole number handling: `numeric(14,0)` in SQL, `rust_decimal::Decimal` (or `i64` in parser) in Rust, strings over IPC, `exactDecimal.ts` in React. Zero floating point.
- 19 SQL functions in `paperbook` schema (read STABLE, write VOLATILE) validating session via `iam.resolve_session`.
- Rust application service and Tauri commands in `src-tauri/src/commands/paperbook.rs` and `src-tauri/src/application/paperbook.rs`.
- React frontend under `src/features/paperbook/` with tabs: Records, Import, Names.
- Retirement of legacy `HistoricalFinanceScreen` and unused onboarding commands.
- Shared i18n keys for all errors and warnings across English, French, and Arabic translation files.
- Comprehensive pure Rust unit tests asserting the 4 synthetic fixtures (`history_valid.xlsx`, `history_errors.xlsx`, `history_bad_layout.xlsx`, `history_big_20k.xlsx`) against `expected.json`.
- Performance validation on 20k rows (preview < 5s, commit < 10s).
- Version marker bump to `[ version = WS-P-1.1 ]`.
- Detailed report at `docs/ws-p/WS-P-1-report.md`.

### Out-of-Scope (Mandated by Brief §19)
- Analytics, charts, and monthly summaries (deferred to P-2).
- Real French/Arabic translations (deferred to P-3; English strings placed in all 3 files for now).
- Linking paper-book names to live Stockiha products, customers, or suppliers.
- Any live debt/credit tracking for "Not Paid".
- Live post-go-live expense recording.
- Importing CSV, `.xls`, or `.ods`.
- Dropping legacy `onboarding` SQL tables/data.
- Version bump in `package.json` or `tauri.conf.json`.

---

## 3. Database Schema & Functions (Migration)

### Migration File: `<timestamp>_ws_p_1_paperbook_foundation.sql`
1. **Schema**: `CREATE SCHEMA IF NOT EXISTS paperbook;`
2. **Helpers**:
   - `paperbook.normalize_key(text) RETURNS text`: ASCII lowercase, normalize whitespace (tabs, NBSP, narrow NBSP -> space), collapse multiple spaces, trim, empty -> NULL.
   - `paperbook.clean_text(text) RETURNS text`: Same whitespace rules, preserves case, empty -> NULL.
3. **Tables**:
   - `paperbook.settings`: `id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1)`, `go_live_date date NULL`, `updated_at timestamptz`.
   - `paperbook.import_batch`: `id bigint GENERATED ALWAYS AS IDENTITY`, `file_name text`, `file_sha256 text`, `sheet_name text`, `txn_count int`, `line_count int`, `warning_count int`, `is_active boolean`, `imported_at timestamptz`, `imported_by bigint`, `superseded_at timestamptz`. Unique active index.
   - `paperbook.txn`: `id bigint GENERATED ALWAYS AS IDENTITY`, `source text ('import'|'manual')`, `batch_id bigint NULL`, `excel_first_row int NULL`, `excel_txn_no text NULL`, `txn_date date`, `txn_type text ('sell'|'buy'|'expense')`, `is_paid boolean`, `party_raw text NULL`, `party_key text GENERATED`, `benefit numeric(14,0) NULL`, `page_no text NULL`, `note text NULL`, `total numeric(14,0)`, `created_at timestamptz`, `created_by bigint`, `updated_at timestamptz`, `updated_by bigint`.
   - `paperbook.txn_line`: `id bigint GENERATED ALWAYS AS IDENTITY`, `txn_id bigint REFERENCES paperbook.txn ON DELETE CASCADE`, `line_no int`, `excel_row int NULL`, `product_raw text NULL`, `product_key text GENERATED`, `brand_raw text NULL`, `brand_key text GENERATED`, `details_raw text NULL`, `details_key text GENERATED`, `quantity numeric(14,0) NULL`, `unit_price numeric(14,0) NULL`, `line_total numeric(14,0)`, `total_overridden boolean DEFAULT false`, `page_no text NULL`.
   - `paperbook.name_map`: `field text`, `raw_key text`, `canonical_label text`, `canonical_key text GENERATED`, `created_at timestamptz`, `created_by bigint`. Primary key `(field, raw_key)`.
   - `paperbook.name_dismissed`: `field text`, `key_a text`, `key_b text`, `created_at timestamptz`. Primary key `(field, key_a, key_b)`.
4. **View**:
   - `paperbook.v_labels`: Resolves raw keys to effective keys and effective labels using the latest canonical labels or most frequent raw text.
5. **Functions (19 functions)**:
   - `get_settings`, `set_go_live_date`
   - `import_status`, `manual_signatures`, `import_replace`
   - `create_manual`, `update_manual`, `delete_manual`
   - `list_txns`, `list_totals`, `get_txn`, `get_txn_lines`
   - `autocomplete`, `list_names`, `list_effective_keys`, `list_dismissed`
   - `set_name_map`, `remove_name_map`, `dismiss_suggestion`

---

## 4. Pure Rust Parser & Domain Engine (`src-tauri/src/domain/paperbook/`)

- `cells.rs`: Parses whole numbers (with NBSP handling, float boundary conversion) and dates (`parse_date`).
- `normalize.rs`: Byte-identical Rust implementation of `clean_text` and `normalize_key`.
- `reader.rs`: Evaluates workbook sheet headers (columns A through M), selects matching sheet or reports `E_LAYOUT` / `E_NO_MATCHING_SHEET`.
- `validate.rs`: Splits sheet rows into transactions and lines; enforces all transaction-level, continuation-level, and line-level blocking errors.
- `warnings.rs`: Computes price unusual (median ± 25%), date order (± 7 days vs neighbors), duplicate in file, possible manual duplicate, fewer than current batch.
- `suggest.rs`: Pure Rust Levenshtein distance (<=1 for 4-7 chars, <=2 for 8+ chars) + pure Rust digit run equivalence filter.
- `mod.rs`: Public interface and DTO types.

---

## 5. Backend Application & Tauri Commands

- **Cargo Dependency**: Add `calamine = "=0.26.1"` to `src-tauri/Cargo.toml`.
- **Application Service** (`src-tauri/src/application/paperbook.rs`): Handles SQL transactions for `import_replace`, manual CRUD, listing, and suggestions.
- **Tauri Commands** (`src-tauri/src/commands/paperbook.rs`):
  - `paperbook_get_settings`
  - `paperbook_set_go_live_date`
  - `paperbook_preview_import`
  - `paperbook_commit_import`
  - `paperbook_list_txns`
  - `paperbook_list_totals`
  - `paperbook_get_txn`
  - `paperbook_create_manual`
  - `paperbook_update_manual`
  - `paperbook_delete_manual`
  - `paperbook_autocomplete`
  - `paperbook_list_names`
  - `paperbook_name_suggestions`
  - `paperbook_set_name_map`
  - `paperbook_remove_name_map`
  - `paperbook_dismiss_suggestion`
- **Registration**: Registered in `src-tauri/src/lib.rs`.

---

## 6. Frontend UI (`src/features/paperbook/`)

- `PaperBookScreen.tsx`: Main screen with header (title, subtitle, go-live chip/banner) and 3 tabs.
- `RecordsTab.tsx`: Filter bar (dates, type, paid, source, search, sort), totals strip, paginated table (50/page), click row opens drawer.
- `ImportTab.tsx`: Current import card, native file picker via `@tauri-apps/plugin-dialog`, preview summary tiles, blocking errors table, warnings table with acknowledgment checkbox, "Import and replace" action button.
- `NamesTab.tsx`: Sub-tabs (Parties, Products, Brands, Details), "Possible duplicates" cards with Keep / Not the same actions, paginated names table with rename/merge dialog.
- `RecordDetailDrawer.tsx`: Read-only for imported records; Edit/Delete for manual records.
- `RecordFormModal.tsx`: Segmented type switch (Sale / Purchase / Expense), lines table with autocomplete, total calculation, manual override indicator.
- `GoLiveModal.tsx`: Date picker dialog to set or update go-live date.
- `paperbook.css`: Clean, token-based styles adhering to `DESIGN.md` (accent `#2457d6`, light/dark mode, tabular numbers, RTL friendly).

---

## 7. Migration & Legacy Retirement Plan

1. In `src/app/AppShell.tsx`: Update `view: 'historical_finance'` sidebar label to `paperbook.nav` ("Paper book (history)").
2. In `src/app/AppRouter.tsx`: Render `<PaperBookScreen />` when `view === 'historical_finance'`.
3. In `src/features/onboarding/`: Remove retired `Historical*` files and `xlsxParser.ts`. Keep `OpeningState*` files completely untouched.
4. In `src-tauri/src/commands/onboarding.rs` and `lib.rs`: Unregister unused historical onboarding commands.
5. In `src/shared/version.ts`: Update version marker to `'WS-P-1.1'`.

---

## 8. Verification Strategy

1. **Rust Unit Tests**:
   - Assert all 4 fixture files against `expected.json`.
   - Unit tests for `parse_whole`, `parse_date`, splitting, median math, date order, suggestions, normalisation.
2. **SQL Integration Tests**:
   - Re-import preserves manual records; go-live date enforcement; total calculation integrity; name map chains; LIKE escaping.
3. **Full Frontend Verification**:
   - `npm run typecheck`
   - `npm run lint`
   - `npm test -- --run`
   - `npm run build`
4. **Full Backend Verification**:
   - `cargo fmt -- --check`
   - `cargo check`
   - `cargo clippy --all-targets --all-features -- -D warnings`
   - `cargo test --lib`
5. **Performance Target Check**:
   - `history_big_20k.xlsx` preview < 5s, commit < 10s.
6. **Execution Report**:
   - Write comprehensive report to `docs/ws-p/WS-P-1-report.md`.
