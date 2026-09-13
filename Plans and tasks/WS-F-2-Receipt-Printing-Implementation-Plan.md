# WS-F-2 — Receipt Printing

**Workstream:** WS-F — POS, Sales & Cash Operations
**Sub-plan:** 2 of 4
**Executing agent:** Gemini (Antigravity IDE)
**Base branch:** the branch WS-F-1 landed on — **the owner will write its exact name here before you start:** `________________`
**Branch to create:** `task/ws-f-2-receipt-printing`
**Risk class:** MEDIUM. One new SQL migration (settings only — no money, no journal, no stock), one new Rust command wrapping already-tested Win32 code, and frontend work.

---

## 0. Authority and precedence

Read in this order before touching anything:

1. This document.
2. `GEMINI.md`
3. `AGENTS.md`

This document wins where they differ.

**Explicit, limited override of `GEMINI.md` section 2.** This task adds a SQL migration, a `SECURITY DEFINER` function, a new permission, a Tauri command, and `unsafe` Win32 FFI reached through an existing wrapper. `GEMINI.md` tells you to refuse those. You may proceed **only** because every line of SQL and Rust is written out for you below.

The condition attached to that override:

> **Do not invent, adapt, "improve", reorder, rename, or optimise any SQL or Rust in this document. Copy it exactly.**

Two further hard limits for this sub-plan:

> **Do not touch the sale-posting path.** `sales.confirm_cash_sale`, `confirmSale`, `confirmCreditSale`, and the credit-override flow are finished. A printer failure must never change whether a sale was recorded.

> **Do not modify `src-tauri/src/infrastructure/escpos_proof/mod.rs`.** That module already sends raw bytes through the Windows spooler and is unit-tested. You make it visible to the rest of the crate — a one-word change in a different file — and call it. You do not edit its contents.

If any file does not look the way this plan describes, **stop and report the difference**.

---

## 1. Repository safety — do this first

```bash
git branch --show-current
git rev-parse HEAD
git status --short
git fetch origin --prune
git branch -r
```

If `git status --short` shows changes that are not yours, **STOP** and report. Never reset, clean, stash, or discard.

Check out the base branch named at the top of this document, pull it, then:

```bash
git checkout -b task/ws-f-2-receipt-printing
```

If the base branch name at the top of this document is still blank, **stop and ask the owner**. Do not guess a branch name from `git branch -r`.

---

## 2. Verified current state

You do not need to re-derive this. It is given so you know what you are walking into.

- `src-tauri/src/infrastructure/escpos_proof/mod.rs` already contains a validated `SpoolerJob` type and a `send_raw_job` function that pushes raw bytes to a named Windows printer through the spooler with the correct Win32 lifecycle. It is declared `mod escpos_proof;` — private to the `infrastructure` module — and is reachable from no command. Nothing in the app can print yet.
- `src/shared/documents/documentPrintService.ts` already exports `printDocumentA4(htmlContent)`, which prints an HTML string through a hidden isolated iframe, and `escapeHtml(str)`. Use both. **Do not write new A4 printing machinery.**
- `core.get_setting(key, default)` exists, but there is no way to *write* a setting and no printing settings of any kind.
- Every cash sale already enqueues a generation job and a print job in `documents.generation_jobs` and `documents.print_jobs`. **No worker process ever consumes them**, so they sit at `PENDING` / `WAITING_FOR_GENERATION` forever, and `ReceiptView` displays those stuck statuses to the cashier. That is why the till currently looks like it is always about to print and never does. Task T7 stops showing them.
- The permission pattern to copy is in `20260801110000_drawer_policy_customer_refunds.sql`: insert into `iam.permissions`, then grant to roles via `iam.role_permissions`.
- Settings screens live in `src/features/settings/` and are reached from the Settings area of the shell.

---

## 3. Objective

Print a receipt for every sale, on the thermal printer or on A4, with a switch the owner can turn off — and tell the cashier plainly whether the print worked.

**How printing works in this sub-plan, so you do not go looking for a queue:** the receipt is printed immediately, synchronously, straight after the sale is recorded. If the printer fails, the sale is still recorded and the cashier sees a failure message with a **Reprint** button. The durable print-job queue in the database stays unused; wiring it up is a later workstream and is out of scope here.

---

## 4. Scope — IN

Nine tasks, in this order. Do not reorder them.

---

### T1 — The migration

Create **one** new file, exactly at this path:

```
src-tauri/migrations/20260913090000_ws_f_002_printing_settings.sql
```

Copy the content below verbatim. Do not edit any existing migration file. Do not create a second migration.

```sql
-- WS-F-002: printing settings for the till receipt.
--
-- A single-row table (id is pinned to 1) holding whether receipts print, which
-- device they go to, the Windows printer name, the paper width in characters,
-- and the shop header/footer text that appears on the receipt.
--
-- Reading the settings needs only a valid session, because the till must know
-- whether to print. Writing them needs MANAGE_PRINTING_SETTINGS.
--
-- No money, no journal, no stock, no document is touched by this migration.

SET ROLE stockiha_owner;

-- =============================================================================
-- 1. Permission
-- =============================================================================

INSERT INTO iam.permissions (code, name) VALUES
    ('MANAGE_PRINTING_SETTINGS', 'Manage receipt printing settings')
ON CONFLICT (code) DO NOTHING;

INSERT INTO iam.role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM iam.roles role
CROSS JOIN iam.permissions permission
WHERE role.code IN ('MANAGER', 'ADMIN')
  AND permission.code = 'MANAGE_PRINTING_SETTINGS'
ON CONFLICT DO NOTHING;

-- =============================================================================
-- 2. Settings table (exactly one row, forever)
-- =============================================================================

CREATE TABLE IF NOT EXISTS core.printing_settings (
    id                       smallint PRIMARY KEY DEFAULT 1,
    receipt_printing_enabled boolean NOT NULL DEFAULT true,
    receipt_target           text NOT NULL DEFAULT 'THERMAL',
    thermal_printer_name     text,
    thermal_columns          smallint NOT NULL DEFAULT 48,
    shop_name                text,
    shop_address             text,
    shop_phone               text,
    receipt_footer           text,
    updated_at               timestamptz NOT NULL DEFAULT now(),
    updated_by_user_id       bigint REFERENCES iam.users (id) ON DELETE SET NULL,
    CONSTRAINT printing_settings_single_row CHECK (id = 1),
    CONSTRAINT printing_settings_target_valid CHECK (receipt_target IN ('THERMAL', 'A4')),
    CONSTRAINT printing_settings_columns_valid CHECK (thermal_columns IN (32, 42, 48))
);

INSERT INTO core.printing_settings (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- 3. Read
-- =============================================================================

CREATE OR REPLACE FUNCTION core.get_printing_settings(p_session_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_result jsonb;
BEGIN
    PERFORM 1 FROM iam.resolve_session(p_session_token);

    SELECT jsonb_build_object(
        'receipt_printing_enabled', settings.receipt_printing_enabled,
        'receipt_target', settings.receipt_target,
        'thermal_printer_name', settings.thermal_printer_name,
        'thermal_columns', settings.thermal_columns,
        'shop_name', settings.shop_name,
        'shop_address', settings.shop_address,
        'shop_phone', settings.shop_phone,
        'receipt_footer', settings.receipt_footer,
        'updated_at', settings.updated_at
    )
    INTO v_result
    FROM core.printing_settings settings
    WHERE settings.id = 1;

    RETURN v_result;
END;
$$;

-- =============================================================================
-- 4. Write
-- =============================================================================

CREATE OR REPLACE FUNCTION core.save_printing_settings(
    p_session_token text,
    p_receipt_printing_enabled boolean,
    p_receipt_target text,
    p_thermal_printer_name text,
    p_thermal_columns smallint,
    p_shop_name text,
    p_shop_address text,
    p_shop_phone text,
    p_receipt_footer text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_user_id bigint;
BEGIN
    SELECT user_id INTO v_user_id
    FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_PRINTING_SETTINGS');

    IF p_receipt_target IS NULL OR p_receipt_target NOT IN ('THERMAL', 'A4') THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: receipt target must be THERMAL or A4'
            USING ERRCODE = '22023';
    END IF;

    IF p_thermal_columns IS NULL OR p_thermal_columns NOT IN (32, 42, 48) THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: thermal width must be 32, 42 or 48 characters'
            USING ERRCODE = '22023';
    END IF;

    IF p_receipt_printing_enabled
       AND p_receipt_target = 'THERMAL'
       AND nullif(btrim(coalesce(p_thermal_printer_name, '')), '') IS NULL THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: a thermal printer name is required when thermal printing is on'
            USING ERRCODE = '22023';
    END IF;

    UPDATE core.printing_settings
    SET receipt_printing_enabled = p_receipt_printing_enabled,
        receipt_target = p_receipt_target,
        thermal_printer_name = nullif(btrim(coalesce(p_thermal_printer_name, '')), ''),
        thermal_columns = p_thermal_columns,
        shop_name = nullif(btrim(coalesce(p_shop_name, '')), ''),
        shop_address = nullif(btrim(coalesce(p_shop_address, '')), ''),
        shop_phone = nullif(btrim(coalesce(p_shop_phone, '')), ''),
        receipt_footer = nullif(btrim(coalesce(p_receipt_footer, '')), ''),
        updated_at = now(),
        updated_by_user_id = v_user_id
    WHERE id = 1;

    RETURN core.get_printing_settings(p_session_token);
END;
$$;

-- =============================================================================
-- 5. Privileges
-- =============================================================================

REVOKE ALL ON core.printing_settings FROM PUBLIC;
GRANT SELECT ON core.printing_settings TO stockiha_runtime;

REVOKE ALL ON FUNCTION core.get_printing_settings(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION core.save_printing_settings(text, boolean, text, text, smallint, text, text, text, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION core.get_printing_settings(text) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION core.save_printing_settings(text, boolean, text, text, smallint, text, text, text, text) TO stockiha_runtime;

RESET ROLE;
```

**One thing to check before you run this.** `core.get_printing_settings` calls `iam.resolve_session(p_session_token)`. Confirm a function with that exact name and one text argument exists:

```bash
grep -rn "FUNCTION iam.resolve_session(" src-tauri/migrations/*.sql
```

If it does not exist under that exact name, **stop and report**. Do not substitute a different function.

---

### T2 — Make the ESC/POS module visible to the crate

In `src-tauri/src/infrastructure/mod.rs`, change the single line

```rust
mod escpos_proof;
```

to

```rust
pub(crate) mod escpos_proof;
```

That is the only change to that file. Do not open `escpos_proof/mod.rs`.

---

### T3 — The Rust printing command

Create `src-tauri/src/application/printing.rs` with exactly this content:

```rust
//! WS-F-002 — synchronous raw printing for till receipts.
//!
//! Sends ESC/POS bytes to a named Windows printer using the already-tested
//! spooler writer in `infrastructure::escpos_proof`. Printing is synchronous
//! and deliberately has no retry queue: the sale is already recorded before
//! this is called, and a failure is surfaced to the cashier who can reprint.
//!
//! Neither the printer name nor the payload is ever interpolated into an
//! error message — both may carry customer data.

use crate::error::AppError;
use crate::infrastructure::escpos_proof::{send_raw_job, SpoolerJob};

/// Sends raw bytes to a Windows printer by name.
///
/// Returns the number of bytes the spooler accepted.
#[cfg(windows)]
pub(crate) fn print_raw(printer_name: &str, payload: Vec<u8>) -> Result<usize, AppError> {
    let job = SpoolerJob::new(printer_name, payload).map_err(|error| AppError::ValidationError {
        diagnostic: format!("Printer job rejected: {error}"),
    })?;

    send_raw_job(&job).map_err(|error| AppError::internal(format!("Printing failed: {error}")))
}

/// Non-Windows builds compile but cannot print. The app ships on Windows only;
/// this arm exists so `cargo check` and CI pass on Linux.
#[cfg(not(windows))]
pub(crate) fn print_raw(printer_name: &str, payload: Vec<u8>) -> Result<usize, AppError> {
    let _ = SpoolerJob::new(printer_name, payload).map_err(|error| AppError::ValidationError {
        diagnostic: format!("Printer job rejected: {error}"),
    })?;

    Err(AppError::internal(
        "Raw printing is only available on Windows".to_string(),
    ))
}
```

Register the module: in `src-tauri/src/application/mod.rs`, add

```rust
pub(crate) mod printing;
```

keeping the existing module list in the same style and order the file already uses.

Then create `src-tauri/src/commands/printing.rs` with exactly this content:

```rust
//! WS-F-002 — IPC surface for till receipt printing.

use tauri::State;

use crate::application::printing;
use crate::error::IpcError;
use crate::infrastructure::db::{self, DatabaseState};

#[tauri::command]
pub(crate) async fn print_raw_receipt(
    _state: State<'_, DatabaseState>,
    printer_name: String,
    payload: Vec<u8>,
) -> Result<u32, IpcError> {
    let written = printing::print_raw(&printer_name, payload).map_err(IpcError::from)?;
    Ok(written as u32)
}
```

Register the module: in `src-tauri/src/commands/mod.rs`, add

```rust
pub(crate) mod printing;
```

in the same style as the existing entries.

In `src-tauri/src/lib.rs`, add this line to the invoke handler list, immediately after the last `commands::procurement::…` entry, with the same indentation:

```rust
            commands::printing::print_raw_receipt,
```

**If `db::DatabaseState` or `db::pool_or_unavailable` is not importable exactly as written**, or if `AppError::internal` / `AppError::ValidationError` do not exist with those exact shapes, **stop and report**. Check first:

```bash
grep -rn "pub enum AppError" -A 25 src-tauri/src/error.rs | head -40
grep -rn "fn internal" src-tauri/src/error.rs
```

The `_state` parameter is unused on purpose — it keeps this command's signature consistent with every other command in the app. Do not remove it, and do not add a database call to justify it.

---

### T4 — TypeScript IPC layer

**4a.** In `src/shared/ipc/commands.ts`, add three entries at the end of the `COMMANDS` object:

```ts
  GET_PRINTING_SETTINGS: 'get_printing_settings',
  SAVE_PRINTING_SETTINGS: 'save_printing_settings',
  PRINT_RAW_RECEIPT: 'print_raw_receipt',
```

**4b.** In `src/shared/ipc/dto.ts`, append at the end of the file:

```ts
export type ReceiptTarget = 'THERMAL' | 'A4';

export interface PrintingSettingsDto {
  receipt_printing_enabled: boolean;
  receipt_target: ReceiptTarget;
  thermal_printer_name: string | null;
  thermal_columns: 32 | 42 | 48;
  shop_name: string | null;
  shop_address: string | null;
  shop_phone: string | null;
  receipt_footer: string | null;
  updated_at: string;
}

export interface SavePrintingSettingsPayload {
  receipt_printing_enabled: boolean;
  receipt_target: ReceiptTarget;
  thermal_printer_name: string | null;
  thermal_columns: 32 | 42 | 48;
  shop_name: string | null;
  shop_address: string | null;
  shop_phone: string | null;
  receipt_footer: string | null;
}
```

**4c.** In `src/shared/ipc/gateway.ts`, append at the end of the file:

```ts
export function getPrintingSettings(
  sessionToken: string
): Promise<import('./dto').PrintingSettingsDto> {
  return call<import('./dto').PrintingSettingsDto>(COMMANDS.GET_PRINTING_SETTINGS, {
    sessionToken,
  });
}

export function savePrintingSettings(
  sessionToken: string,
  payload: import('./dto').SavePrintingSettingsPayload
): Promise<import('./dto').PrintingSettingsDto> {
  return call<import('./dto').PrintingSettingsDto>(COMMANDS.SAVE_PRINTING_SETTINGS, {
    sessionToken,
    receiptPrintingEnabled: payload.receipt_printing_enabled,
    receiptTarget: payload.receipt_target,
    thermalPrinterName: payload.thermal_printer_name,
    thermalColumns: payload.thermal_columns,
    shopName: payload.shop_name,
    shopAddress: payload.shop_address,
    shopPhone: payload.shop_phone,
    receiptFooter: payload.receipt_footer,
  });
}

export function printRawReceipt(printerName: string, payload: number[]): Promise<number> {
  return call<number>(COMMANDS.PRINT_RAW_RECEIPT, { printerName, payload });
}
```

`printRawReceipt` takes no session token. It talks to a printer, not to the database, and the command signature in T3 has no token parameter. Do not add one.

**4d.** You must also add the Rust service functions and commands for the two settings functions, following the exact pattern already used by `list_supplier_balances` in `src-tauri/src/application/procurement_service.rs` and `src-tauri/src/commands/procurement.rs`. Put them in new files:

`src-tauri/src/domain/printing.rs`:

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrintingSettingsDto {
    pub receipt_printing_enabled: bool,
    pub receipt_target: String,
    pub thermal_printer_name: Option<String>,
    pub thermal_columns: i16,
    pub shop_name: Option<String>,
    pub shop_address: Option<String>,
    pub shop_phone: Option<String>,
    pub receipt_footer: Option<String>,
    pub updated_at: String,
}
```

Register it in `src-tauri/src/domain/mod.rs` with `pub mod printing;` in the existing style.

Add to `src-tauri/src/application/printing.rs` (appended below what T3 put there):

```rust
use crate::domain::printing::PrintingSettingsDto;
use serde_json::Value as JsonValue;
use sqlx::{query_scalar, PgPool};

pub(crate) async fn get_printing_settings(
    pool: &PgPool,
    session_token: &str,
) -> Result<PrintingSettingsDto, AppError> {
    let res: JsonValue = query_scalar("SELECT core.get_printing_settings($1)")
        .bind(session_token)
        .fetch_one(pool)
        .await
        .map_err(AppError::from_posting_error)?;

    serde_json::from_value(res)
        .map_err(|e| AppError::internal(format!("Failed to parse printing settings: {e}")))
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn save_printing_settings(
    pool: &PgPool,
    session_token: &str,
    receipt_printing_enabled: bool,
    receipt_target: &str,
    thermal_printer_name: Option<&str>,
    thermal_columns: i16,
    shop_name: Option<&str>,
    shop_address: Option<&str>,
    shop_phone: Option<&str>,
    receipt_footer: Option<&str>,
) -> Result<PrintingSettingsDto, AppError> {
    let res: JsonValue = query_scalar(
        "SELECT core.save_printing_settings($1, $2, $3, $4, $5, $6, $7, $8, $9)",
    )
    .bind(session_token)
    .bind(receipt_printing_enabled)
    .bind(receipt_target)
    .bind(thermal_printer_name)
    .bind(thermal_columns)
    .bind(shop_name)
    .bind(shop_address)
    .bind(shop_phone)
    .bind(receipt_footer)
    .fetch_one(pool)
    .await
    .map_err(AppError::from_posting_error)?;

    serde_json::from_value(res)
        .map_err(|e| AppError::internal(format!("Failed to parse printing settings: {e}")))
}
```

And add to `src-tauri/src/commands/printing.rs`:

```rust
use crate::domain::printing::PrintingSettingsDto;

#[tauri::command]
pub(crate) async fn get_printing_settings(
    state: State<'_, DatabaseState>,
    session_token: String,
) -> Result<PrintingSettingsDto, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    printing::get_printing_settings(pool, &session_token)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub(crate) async fn save_printing_settings(
    state: State<'_, DatabaseState>,
    session_token: String,
    receipt_printing_enabled: bool,
    receipt_target: String,
    thermal_printer_name: Option<String>,
    thermal_columns: i16,
    shop_name: Option<String>,
    shop_address: Option<String>,
    shop_phone: Option<String>,
    receipt_footer: Option<String>,
) -> Result<PrintingSettingsDto, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    printing::save_printing_settings(
        pool,
        &session_token,
        receipt_printing_enabled,
        &receipt_target,
        thermal_printer_name.as_deref(),
        thermal_columns,
        shop_name.as_deref(),
        shop_address.as_deref(),
        shop_phone.as_deref(),
        receipt_footer.as_deref(),
    )
    .await
    .map_err(IpcError::from)
}
```

Register both in `src-tauri/src/lib.rs` alongside `print_raw_receipt`:

```rust
            commands::printing::get_printing_settings,
            commands::printing::save_printing_settings,
```

---

### T5 — The receipt builders

Create `src/features/pos/receiptBuilder.ts` with exactly this content:

```ts
/**
 * WS-F-002 — builds the two receipt formats from a posted sale.
 *
 * THERMAL: ESC/POS bytes for a roll printer, laid out in a fixed number of
 * monospace columns.
 * A4: an HTML string handed to the shared A4 print service.
 *
 * Money arrives here as decimal strings and is never converted to a number.
 */
import type { PrintingSettingsDto } from '../../shared/ipc/dto';
import { escapeHtml } from '../../shared/documents/documentPrintService';

export interface ReceiptLineInput {
  name: string;
  qty: number;
  unitPrice: string;
  lineTotal: string;
}

export interface ReceiptInput {
  documentNumber: string;
  documentDate: string;
  cashierName: string;
  paymentLabel: string;
  customerName: string | null;
  lines: ReceiptLineInput[];
  total: string;
  currency: string;
}

const ESC = 0x1b;
const GS = 0x1d;

/**
 * Maps a string to single-byte values. Characters above U+00FF cannot be
 * represented in the printer's single-byte code page and become '?'.
 * This is why an Arabic product name will not print on the thermal roll --
 * the A4 target is the option for a non-Latin catalogue.
 */
function toPrinterBytes(text: string): number[] {
  const bytes: number[] = [];
  for (const char of text) {
    const code = char.codePointAt(0) ?? 63;
    bytes.push(code <= 0xff ? code : 63);
  }
  return bytes;
}

function padEnd(text: string, width: number): string {
  return text.length >= width ? text.slice(0, width) : text + ' '.repeat(width - text.length);
}

function padStart(text: string, width: number): string {
  return text.length >= width ? text.slice(text.length - width) : ' '.repeat(width - text.length) + text;
}

function centre(text: string, width: number): string {
  if (text.length >= width) return text.slice(0, width);
  const left = Math.floor((width - text.length) / 2);
  return ' '.repeat(left) + text;
}

/** Builds the ESC/POS byte payload for one receipt. */
export function buildThermalReceipt(
  input: ReceiptInput,
  settings: PrintingSettingsDto,
): number[] {
  const width = settings.thermal_columns;
  const bytes: number[] = [];

  bytes.push(ESC, 0x40); // initialise

  const line = (text: string) => {
    bytes.push(...toPrinterBytes(text), 0x0a);
  };

  if (settings.shop_name) line(centre(settings.shop_name, width));
  if (settings.shop_address) line(centre(settings.shop_address, width));
  if (settings.shop_phone) line(centre(settings.shop_phone, width));
  line('-'.repeat(width));

  line(input.documentNumber);
  line(input.documentDate);
  line(input.cashierName);
  line(input.paymentLabel);
  if (input.customerName) line(input.customerName);
  line('-'.repeat(width));

  const amountWidth = 10;
  const qtyWidth = 4;
  const nameWidth = width - amountWidth - qtyWidth - 2;

  input.lines.forEach((receiptLine) => {
    line(padEnd(receiptLine.name, width));
    line(
      `${padEnd('', nameWidth)}${padStart(String(receiptLine.qty), qtyWidth)} ${padStart(
        receiptLine.lineTotal,
        amountWidth,
      )}`,
    );
  });

  line('-'.repeat(width));
  line(`${padEnd('TOTAL', width - amountWidth)}${padStart(input.total, amountWidth)}`);
  line(padEnd(input.currency, width));

  if (settings.receipt_footer) {
    line('');
    line(centre(settings.receipt_footer, width));
  }

  bytes.push(0x0a, 0x0a, 0x0a, 0x0a);
  bytes.push(GS, 0x56, 0x42, 0x00); // feed and partial cut

  return bytes;
}

/** Builds the A4 HTML for one receipt. */
export function buildA4Receipt(input: ReceiptInput, settings: PrintingSettingsDto): string {
  const header = [settings.shop_name, settings.shop_address, settings.shop_phone]
    .filter(Boolean)
    .map((value) => `<div>${escapeHtml(String(value))}</div>`)
    .join('');

  const rows = input.lines
    .map(
      (receiptLine) => `<tr>
        <td>${escapeHtml(receiptLine.name)}</td>
        <td style="text-align:end">${escapeHtml(String(receiptLine.qty))}</td>
        <td style="text-align:end">${escapeHtml(receiptLine.unitPrice)}</td>
        <td style="text-align:end">${escapeHtml(receiptLine.lineTotal)}</td>
      </tr>`,
    )
    .join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8" />
    <style>
      body { font-family: Arial, sans-serif; margin: 24px; color: #000; }
      h1 { font-size: 18px; margin: 0 0 4px 0; }
      table { width: 100%; border-collapse: collapse; margin-block-start: 16px; }
      th, td { border-bottom: 1px solid #999; padding: 6px 4px; font-size: 13px; }
      tfoot td { border: none; font-weight: bold; font-size: 15px; }
      .meta { font-size: 13px; margin-block-start: 12px; }
      .footer { margin-block-start: 24px; font-size: 12px; text-align: center; }
    </style></head><body>
    <h1>${escapeHtml(input.documentNumber)}</h1>
    ${header}
    <div class="meta">
      <div>${escapeHtml(input.documentDate)}</div>
      <div>${escapeHtml(input.cashierName)}</div>
      <div>${escapeHtml(input.paymentLabel)}</div>
      ${input.customerName ? `<div>${escapeHtml(input.customerName)}</div>` : ''}
    </div>
    <table>
      <tbody>${rows}</tbody>
      <tfoot><tr>
        <td colspan="3" style="text-align:end">TOTAL</td>
        <td style="text-align:end">${escapeHtml(input.total)} ${escapeHtml(input.currency)}</td>
      </tr></tfoot>
    </table>
    ${settings.receipt_footer ? `<div class="footer">${escapeHtml(settings.receipt_footer)}</div>` : ''}
    </body></html>`;
}
```

---

### T6 — The print orchestrator

Create `src/features/pos/printReceipt.ts` with exactly this content:

```ts
/**
 * WS-F-002 — decides where a receipt goes and reports what happened.
 *
 * Printing never throws to the caller. A posted sale must not appear to have
 * failed because a printer did.
 */
import { printRawReceipt } from '../../shared/ipc/gateway';
import { printDocumentA4 } from '../../shared/documents/documentPrintService';
import type { PrintingSettingsDto } from '../../shared/ipc/dto';
import { buildA4Receipt, buildThermalReceipt, type ReceiptInput } from './receiptBuilder';

export type PrintOutcome =
  | { status: 'printed'; target: 'THERMAL' | 'A4' }
  | { status: 'disabled' }
  | { status: 'failed'; reason: string };

export async function printSaleReceipt(
  input: ReceiptInput,
  settings: PrintingSettingsDto | null,
): Promise<PrintOutcome> {
  if (!settings || !settings.receipt_printing_enabled) {
    return { status: 'disabled' };
  }

  try {
    if (settings.receipt_target === 'A4') {
      printDocumentA4(buildA4Receipt(input, settings));
      return { status: 'printed', target: 'A4' };
    }

    const printerName = settings.thermal_printer_name?.trim() ?? '';
    if (!printerName) {
      return { status: 'failed', reason: 'NO_PRINTER_NAME' };
    }

    await printRawReceipt(printerName, buildThermalReceipt(input, settings));
    return { status: 'printed', target: 'THERMAL' };
  } catch (error: unknown) {
    return { status: 'failed', reason: error instanceof Error ? error.message : 'PRINT_FAILED' };
  }
}
```

---

### T7 — Wire printing into the till

All edits are in `src/features/pos/PosScreen.tsx`.

**7a.** Add imports:

```tsx
import { printSaleReceipt, type PrintOutcome } from './printReceipt';
import type { PrintingSettingsDto } from '../../shared/ipc/dto';
```

**7b.** Add state:

```tsx
const [printingSettings, setPrintingSettings] = useState<PrintingSettingsDto | null>(null);
const [printOutcome, setPrintOutcome] = useState<PrintOutcome | null>(null);
const [lastReceiptInput, setLastReceiptInput] = useState<Parameters<typeof printSaleReceipt>[0] | null>(null);
```

**7c.** Load the settings once. Add `ipc.getPrintingSettings(token).catch(() => null)` as a third entry in the existing customers-and-categories `Promise.all` from WS-F-1, destructure it as `printingRow`, and set it with `setPrintingSettings(printingRow)`.

**7d.** Add this helper immediately above `confirmSale`:

```tsx
  const runReceiptPrint = useCallback(
    async (documentNumber: string, customerName: string | null) => {
      const input = {
        documentNumber,
        documentDate: currentLocalDate(),
        cashierName: user?.displayName ?? user?.username ?? '',
        paymentLabel: paymentMode === 'cash' ? creditText.cash : creditText.credit,
        customerName,
        lines: cart.map((l) => ({
          name: l.name,
          qty: l.qty,
          unitPrice: l.unitPrice,
          lineTotal: multiplyMoneyByQuantity(l.unitPrice, l.qty),
        })),
        total: provisionalTotal,
        currency: 'DZD',
      };
      setLastReceiptInput(input);
      setPrintOutcome(await printSaleReceipt(input, printingSettings));
    },
    [cart, provisionalTotal, paymentMode, printingSettings, user, creditText],
  );
```

If `user` does not expose `displayName` or `username`, check the session type first and use whichever field holds the signed-in person's name. If neither exists, **stop and report** rather than inventing a field.

**7e.** In `confirmSale`, in the **cash** success path — immediately after `setLastSaleDocId(...)` is called with the new document id — add:

```tsx
        void runReceiptPrint(String(result.document_number ?? result), null);
```

If the cash-sale result does not carry a `document_number`, pass the document id as a string instead, and say so in your report. **Do not change what `confirmSale` sends to the database, do not move any existing line, and do not wrap the existing call in a try/catch.**

**7f.** In the **credit** success path — immediately after `setLastCreditSale(...)` — add:

```tsx
        void runReceiptPrint(creditResult.document_number, selectedCustomer?.name ?? null);
```

using whatever variable name the existing code already uses for the credit result.

**7g.** Show the outcome and offer a reprint. Immediately after the existing `pos-sold` success banner block, add:

```tsx
      {printOutcome && printOutcome.status !== 'disabled' ? (
        <div className="sk-pos__print-status" data-testid="pos-print-status">
          {printOutcome.status === 'printed' ? (
            <Banner tone="success" testId="pos-print-ok">{t('pos.printOk')}</Banner>
          ) : (
            <>
              <Banner tone="warning" testId="pos-print-failed">{t('pos.printFailed')}</Banner>
              <Button
                onClick={() => {
                  if (lastReceiptInput) {
                    void printSaleReceipt(lastReceiptInput, printingSettings).then(setPrintOutcome);
                  }
                }}
                testId="pos-reprint"
              >
                {t('pos.reprint')}
              </Button>
            </>
          )}
        </div>
      ) : null}
```

Use the `Banner` and `Button` prop names exactly as the surrounding code in this file already uses them. If `testId` is not the prop name those components take, use the one they do.

**7h.** Reset `printOutcome` and `lastReceiptInput` to `null` inside the existing `invalidateSaleIntent` callback, alongside the other resets already there.

**7i.** The receipt view currently shows the stuck print-job statuses. In `src/features/documents/ReceiptView.tsx`, add an optional prop and use it to skip the job panel:

- change the signature to `export function ReceiptView({ documentId, showJobs = true }: { documentId: number; showJobs?: boolean })`
- wrap the block that renders the job statuses in `{showJobs ? ( … ) : null}`
- stop the polling when it is off: in the effect that sets up the interval, return early when `showJobs` is false, and add `showJobs` to that effect's dependency array

Then in `PosScreen.tsx` render it as `<ReceiptView documentId={lastSaleDocId} showJobs={false} />`.

Change nothing else in `ReceiptView.tsx`. Other screens keep the default `showJobs = true` and are unaffected.

---

### T8 — The printing settings screen

Create `src/features/settings/PrintingSettingsScreen.tsx`. Copy the structure, layout classes, loading/saving pattern and permission handling of the existing `src/features/settings/RecoverySettingsScreen.tsx` — read that file first and follow it closely rather than inventing a new shape.

The form must contain, in this order:

1. A checkbox, `data-testid="printing-enabled"`, bound to `receipt_printing_enabled`, labelled `t('printing.enabled')`.
2. A select, `data-testid="printing-target"`, with the two options `THERMAL` (labelled `t('printing.targetThermal')`) and `A4` (labelled `t('printing.targetA4')`).
3. A text input, `data-testid="printing-printer-name"`, for `thermal_printer_name`, labelled `t('printing.printerName')`, with the helper text `t('printing.printerNameHelp')` shown beneath it. Show this field only when the target is `THERMAL`.
4. A select, `data-testid="printing-columns"`, with options `32`, `42` and `48`, labelled `t('printing.columns')`. Show only when the target is `THERMAL`.
5. Four text inputs for `shop_name`, `shop_address`, `shop_phone` and `receipt_footer`, with testids `printing-shop-name`, `printing-shop-address`, `printing-shop-phone`, `printing-footer`.
6. A **Save** button, `data-testid="printing-save"`, calling `savePrintingSettings` and showing a success banner on return and the error text on failure.
7. A **Test print** button, `data-testid="printing-test"`, which calls `printSaleReceipt` with this fixed sample and shows the outcome:

```tsx
{
  documentNumber: 'TEST-0001',
  documentDate: new Date().toISOString().slice(0, 10),
  cashierName: '—',
  paymentLabel: '—',
  customerName: null,
  lines: [{ name: 'Test item', qty: 1, unitPrice: '1.00', lineTotal: '1.00' }],
  total: '1.00',
  currency: 'DZD',
}
```

The Test print button uses the values currently in the form, not the last saved ones, so the owner can try a printer name before committing it.

Wire the screen into the Settings area exactly the way `RecoverySettingsScreen` is wired — same navigation mechanism, same permission gate, using `MANAGE_PRINTING_SETTINGS`. Read how that existing screen is reached and copy it. Do not invent a new routing mechanism.

---

### T9 — Copy keys and tests

**9a. Copy keys.** In `src/shared/i18n/locales.ts`, add these keys to all three locale blocks. Put the `pos.*` keys next to the existing `pos.*` entries and the `printing.*` keys at the end of each block. The Arabic block stores strings as escaped `\uXXXX` sequences — match that existing style for the Arabic values.

| key | en | fr | ar |
|---|---|---|---|
| `pos.printOk` | `Receipt printed` | `Ticket imprimé` | `تم طبع الوصل` |
| `pos.printFailed` | `The receipt did not print. The sale is recorded.` | `Le ticket n'a pas été imprimé. La vente est enregistrée.` | `لم يُطبع الوصل. عملية البيع مسجلة.` |
| `pos.reprint` | `Print again` | `Réimprimer` | `إعادة الطبع` |
| `printing.title` | `Receipt printing` | `Impression des tickets` | `طباعة الوصولات` |
| `printing.enabled` | `Print a receipt for every sale` | `Imprimer un ticket pour chaque vente` | `طبع وصل لكل عملية بيع` |
| `printing.target` | `Print to` | `Imprimer sur` | `الطبع على` |
| `printing.targetThermal` | `Thermal roll printer` | `Imprimante thermique` | `طابعة حرارية` |
| `printing.targetA4` | `A4 printer` | `Imprimante A4` | `طابعة A4` |
| `printing.printerName` | `Windows printer name` | `Nom de l'imprimante Windows` | `اسم الطابعة في ويندوز` |
| `printing.printerNameHelp` | `Type it exactly as it appears in Windows Settings, Printers & scanners.` | `Saisissez-le exactement comme dans Paramètres Windows, Imprimantes et scanners.` | `اكتبه تماماً كما يظهر في إعدادات ويندوز، الطابعات والماسحات.` |
| `printing.columns` | `Paper width` | `Largeur du papier` | `عرض الورق` |
| `printing.shopName` | `Shop name` | `Nom du magasin` | `اسم المتجر` |
| `printing.shopAddress` | `Address` | `Adresse` | `العنوان` |
| `printing.shopPhone` | `Phone` | `Téléphone` | `الهاتف` |
| `printing.footer` | `Footer message` | `Message de pied de ticket` | `رسالة أسفل الوصل` |
| `printing.test` | `Test print` | `Test d'impression` | `تجربة الطبع` |
| `printing.saved` | `Printing settings saved` | `Paramètres d'impression enregistrés` | `تم حفظ إعدادات الطباعة` |

Remove no existing key.

**9b. Unit tests.** Create `tests/receipt-builder.test.ts` with four tests against `src/features/pos/receiptBuilder.ts`:

1. `buildThermalReceipt` output starts with the two bytes `0x1b, 0x40` and ends with the four bytes `0x1d, 0x56, 0x42, 0x00`.
2. Every value in the returned array is between 0 and 255 inclusive.
3. A line name containing an Arabic character produces the byte `63` for that character and does not throw.
4. `buildA4Receipt` output contains the document number and the total, and a product name containing `<script>` appears escaped, not as a live tag.

Build the `PrintingSettingsDto` fixture these tests need by hand, with `thermal_columns: 48`.

**9c. Workflow test.** Create `tests/printing-settings.workflow.test.tsx`, copying the structure and mocks of `tests/recovery-settings.workflow.test.tsx`. Three tests:

1. The screen loads and shows the saved values from a mocked `get_printing_settings`.
2. Changing the target to `A4` hides `printing-printer-name`.
3. Clicking `printing-save` calls `save_printing_settings` once with the values currently in the form.

**9d. Existing tests.** Every test in `tests/` must still pass. If a POS test fails only because printing is now attempted, mock `get_printing_settings` in that test to return `receipt_printing_enabled: false`. Do not weaken or delete any assertion. If a test fails for any other reason, **stop and report**.

---

## 5. Scope — OUT. Do not touch.

- `sales.confirm_cash_sale`, the credit-sale posting path, `sales.*` migrations, any money, any journal, any stock.
- `src-tauri/src/infrastructure/escpos_proof/mod.rs` — its contents. You change its visibility in `infrastructure/mod.rs` only.
- The durable print-job queue: `documents.generation_jobs`, `documents.print_jobs`, `documents.enqueue_receipt_jobs`, `documents.claim_next_generation_job`, and every other function in those migrations. No worker is being written. The orphan job rows are a known, accepted condition and are being hidden from the cashier, not fixed.
- The cash drawer. `cash.enqueue_drawer_job` stays untouched and no drawer pulse is sent.
- Printer enumeration. There is no "pick your printer from a list" in this sub-plan — the name is typed. Do not add Win32 printer-listing FFI.
- `src/shared/documents/documentPrintService.ts` and `genericDocumentPdf.ts` — you import from the first and change neither.
- Discounts (WS-F-3), cash-session changes and sale voids (WS-F-4).
- `PurchasesScreen.tsx`, procurement, inventory, catalogue.
- `package.json`, `package-lock.json`, `Cargo.toml`, `Cargo.lock`.
- `STOCKIHA_GROUND_TRUTH.md`, `AGENTS.md`, `CURRENT_STEP.md`, `README.md`, `TASKS.md`, `GEMINI.md`.

If you find a genuine unrelated bug: **report it, do not fix it.**

---

## 6. Constraints

- **A print failure must never look like a sale failure.** `printSaleReceipt` returns an outcome and never throws. Nothing in the printing path may be inside the same try/catch as the sale confirmation.
- **Never use floating point for money.** Receipt amounts arrive as strings and are printed as strings. The only arithmetic permitted is `multiplyMoneyByQuantity` from WS-F-1.
- Never interpolate a printer name or receipt bytes into a log line or an error message.
- Every user-facing string comes from `t(...)` in all three locales. No hardcoded English in JSX.
- Logical CSS properties only. Arabic RTL must keep working in the settings screen.
- No new npm dependency and no new Rust crate.
- No placeholder, no `TODO`, no mock, no commented-out block left behind.
- Show your file plan before editing. If it names a file not in the list below, you have misread the task — stop.

The complete list of files this task may touch:

```
src-tauri/migrations/20260913090000_ws_f_002_printing_settings.sql   (new)
src-tauri/src/infrastructure/mod.rs                                  (one word)
src-tauri/src/application/printing.rs                                (new)
src-tauri/src/application/mod.rs                                     (one line)
src-tauri/src/commands/printing.rs                                   (new)
src-tauri/src/commands/mod.rs                                        (one line)
src-tauri/src/domain/printing.rs                                     (new)
src-tauri/src/domain/mod.rs                                          (one line)
src-tauri/src/lib.rs                                                 (three lines)
src/shared/ipc/commands.ts                                           (edited)
src/shared/ipc/dto.ts                                                (appended)
src/shared/ipc/gateway.ts                                            (appended)
src/features/pos/receiptBuilder.ts                                   (new)
src/features/pos/printReceipt.ts                                     (new)
src/features/pos/PosScreen.tsx                                       (edited)
src/features/documents/ReceiptView.tsx                               (edited)
src/features/settings/PrintingSettingsScreen.tsx                     (new)
src/shared/i18n/locales.ts                                           (edited)
src/styles/global.css                                                (appended, if a style is needed)
tests/receipt-builder.test.ts                                        (new)
tests/printing-settings.workflow.test.tsx                            (new)
plus whichever file wires Settings navigation, matching RecoverySettingsScreen
plus existing test files, mock setup only, per 9d
```

---

## 7. Acceptance criteria

1. The migration applies cleanly on top of every earlier migration and `sqlx` records it. No existing migration file is modified.
2. `cargo fmt --check`, `cargo check`, `cargo clippy -- -D warnings`, `cargo test` all pass.
3. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` all pass, with every pre-existing test still passing.
4. A new **Receipt printing** screen appears in Settings for Admin and Manager, and is not reachable by a Cashier.
5. The screen saves and reloads all eight settings correctly.
6. Saving with thermal printing on and an empty printer name is refused with a clear message.
7. **Test print** sends a one-line sample receipt using the values currently on screen, without saving them.
8. With printing on and target THERMAL, confirming a cash sale prints a receipt with the shop header, the sale's document number, one row per item, the total, and the footer, and then cuts the paper.
9. With target A4, confirming a sale opens the A4 print dialog with the same information laid out as a page.
10. With printing off, confirming a sale prints nothing and shows no print banner.
11. When the printer name is wrong, the sale still completes, a warning appears saying the sale is recorded, and **Print again** retries.
12. The till no longer shows perpetually pending print-job statuses under a completed sale.
13. Other screens that use `ReceiptView` are unchanged and still show job statuses.
14. Every receipt amount matches the posted total to the centime.
15. All new text appears correctly in French, Arabic (RTL intact) and English.
16. `git status --short` shows only files from section 6's list.

---

## 8. Verification required

Paste the real, unedited output of every command.

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

```bash
cd src-tauri
cargo fmt --check
cargo check
cargo clippy -- -D warnings
cargo test
cd ..
```

```bash
bash src-tauri/tests/run_current_sql_suites.sh
git status --short
git diff --stat
git diff --stat -- src-tauri/src/infrastructure/escpos_proof/
```

The last command must return nothing.

Do not run `npm run tauri build`. The Windows build and the real-printer acceptance run are the owner's steps.

Commit once:

```
feat(pos): WS-F-2 thermal and A4 receipt printing with printing settings
```

Push the branch. Do not merge into `main`.

---

## 9. Report back — required format

```
WS-F-2 REPORT

Git
- Branch:
- Base branch used:
- Full commit hash:
- Pushed: yes/no
- Working tree clean: yes/no
- Migration files: new = ?, modified = ? (modified must be 0)

Files changed (full list):
Files created (full list):
Files touched that are NOT in section 6's list (must be none):

Anything I could not verify because it needs a real printer:

Acceptance criteria 1-16: PASS / FAIL / NEEDS-HARDWARE each, one line each

Commands run (paste real output):
- npm run typecheck:
- npm run lint:
- npm test:
- npm run build:
- cargo fmt --check:
- cargo check:
- cargo clippy -- -D warnings:
- cargo test:
- run_current_sql_suites.sh:
- git diff --stat -- src-tauri/src/infrastructure/escpos_proof/:

Anything not finished, and why:

Unrelated problems found but NOT fixed:
```

Criteria 7 through 11 and 14 cannot be verified without a real printer. Mark them **NEEDS-HARDWARE** — do not mark them PASS and do not mark them FAIL. Any other criterion failing means the whole result is FAIL.

---

## 10. Manual acceptance checklist for the owner (not for the agent)

You need the thermal printer and the A4 printer connected for this.

1. In Windows, open Settings then Printers & scanners and copy the thermal printer's name exactly.
2. Sign in as Admin, open Settings, Receipt printing. Turn printing on, choose Thermal, paste the printer name, choose the paper width that matches your roll (48 for 80mm, 32 for 58mm), fill in the shop name, address, phone and a footer line. Save.
3. Press **Test print**. A one-line sample should come out and the paper should cut. If nothing prints, the name is wrong — check it character by character, including spaces.
4. Go to the till, ring up three items and confirm a cash sale. A receipt should print immediately and the till should say the receipt printed.
5. Check the receipt against the screen: shop header, document number, one row per item with quantity and amount, the total, the footer. The total must match the screen exactly.
6. **Test one product with an Arabic name.** On the thermal roll it will very likely print as question marks — that is a known limitation of single-byte thermal printing and is why the A4 option exists. Tell me what you actually get, because it decides whether we need image-based thermal printing later.
7. Switch the target to A4 and save. Ring up another sale. The Windows print dialog should open with a full page showing the same information. Arabic should render correctly here.
8. Switch printing off and save. Ring up a sale. Nothing should print and no print banner should appear.
9. Turn printing back on, change the printer name to something wrong, save, and ring up a sale. The sale must still complete, with a warning that the receipt did not print. Fix the name and press **Print again**.
10. Sign in as a Cashier. The Receipt printing screen must not be reachable.
11. Switch the language to French, then Arabic. Check the settings screen reads correctly and Arabic stays right-to-left.
12. Close and reopen the app. The printing settings must still be there.
