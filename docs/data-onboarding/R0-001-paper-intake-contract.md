# R0-001 — Representative Paper Intake Contract

## Status

This contract is based on six representative physical-paper images supplied on 4 August 2026. It establishes the minimum safe data shape for digitizing historical paperwork without silently posting uncertain history into live stock, cash, receivables, payables, or journals.

The source images remain the authority. Transcription is reviewable evidence, not a replacement for the original paper.

## Observed source families

### 1. Free-form handwritten notes

Five samples use blank paper with no stable column layout. Common characteristics:

- a small sequence/reference number near the top-left;
- one or more handwritten dates;
- Arabic product/customer text;
- arithmetic written as `quantity × unit price = line total`;
- handwritten subtotal or net total;
- later additions, deductions, corrections, or payment annotations;
- red ink used for material annotations such as payment status or a later date.

### 2. Printed delivery slip

One sample is a bilingual Arabic/French **BON DE LIVRAISON** form with printed fields for:

- document number;
- date;
- delivered-to party;
- quantity;
- designation;
- unit price;
- line total;
- document total.

The handwriting still crosses printed columns, so the form structure helps but does not make unattended OCR reliable.

## Evidence-backed observations

The following numeric observations are readable enough to demonstrate the required reconciliation model. They are not approved historical entries.

| Sample | Readable arithmetic | Observation |
|---|---|---|
| Paper 01 | `6×10900=65400`, `5×9800=49000`, `6×6500=39000`, `1×6600=6600`, `4×5800=23200` | Line arithmetic totals `183200`; a red unpaid annotation and a separate `+1000` appear to exist. |
| Paper 02 | approximately `7×2600=18200`, `1×5800=5800`, `1×9000=9000` | Printed delivery form; written final total is visually ambiguous and must be reviewed against the line arithmetic. |
| Paper 03 | `7×6400=44800` | One-line handwritten document with a written total of `44800`. |
| Paper 04 | `24×5500=132000`, `24×5500=132000`, `24×6600=158400`, `12×1450=17400` | The first three lines total `422400`; an additional line and a possible deduction require explicit adjustment capture. |
| Paper 05 | approximately `10×5300=53000`, `20×2100=42000` | A separate `-7500` and a later red paid annotation/date appear. Exact net semantics require review. |
| Paper 06 | `2×13500=27000`, `1×14500=14500`, `8×4700=37600`, `1×11400=11400`, `5×5800=29000` | Line arithmetic totals `119500`; a written `-500` likely produces `119000`, but this must remain an explicit adjustment pending review. |

Product descriptions, counterparty names, and some dates are not consistently legible enough to approve from these images alone. The system must preserve raw text and uncertainty rather than normalize guesses.

## Required document fields

Every paper document must retain:

- immutable source-image identifier;
- source-image SHA-256;
- original filename and capture timestamp;
- source family: `HANDWRITTEN_NOTE` or `PRINTED_DELIVERY_SLIP`;
- source reference/sequence as raw text;
- primary document date, when confidently known;
- secondary annotation/payment date, when present;
- transaction direction: `UNKNOWN`, `CUSTOMER_DELIVERY`, `SUPPLIER_DELIVERY`, `RETURN`, or `OTHER`;
- counterparty raw text;
- optional mapped customer or supplier identifier;
- payment state: `UNKNOWN`, `PAID`, `UNPAID`, or `PARTIAL`;
- written subtotal;
- signed adjustment amount;
- written net total;
- calculated line subtotal;
- reconciliation variance;
- free-form notes;
- transcription confidence and reviewer status.

## Required line fields

Each line must retain:

- source line order;
- raw handwritten description;
- optional normalized description;
- optional mapped product/variant identifier;
- quantity;
- unit price;
- written line total;
- calculated line total;
- line variance;
- confidence per field;
- reviewer note.

Quantity, unit price, and totals must use integer minor units until the business confirms whether the handwriting represents whole DZD or centimes. No conversion is permitted during transcription.

## Reconciliation rules

1. Never overwrite written values with calculated values.
2. Calculate `quantity × unit price` independently when both operands exist.
3. Store the difference between calculated and written line totals.
4. Calculate the sum of line totals independently from the written document subtotal.
5. Store additions and deductions as signed adjustments, not as edits to historical lines.
6. Treat red annotations as separate source evidence with their own raw text and optional date.
7. A document with any unresolved direction, counterparty, product mapping, payment state, or material variance cannot be approved for opening-state application.
8. Duplicate detection must use source hash plus normalized reference/date/total signals; it must never delete the original evidence.

## Workflow states

- `RECEIVED` — image stored; no transcription approved.
- `TRANSCRIBING` — draft fields or lines exist.
- `NEEDS_REVIEW` — transcription complete but unresolved fields/variances remain.
- `RECONCILED` — arithmetic and mappings independently checked.
- `APPROVED_FOR_OPENING_STATE` — explicitly selected to contribute to opening stock or balances.
- `ARCHIVED_ONLY` — retained as historical evidence but never posted.
- `REJECTED` — unusable duplicate, unreadable source, or invalid record; source remains retained.

## MVP data-onboarding decision

The default MVP policy is:

1. Digitize and retain all physical-paper images as historical source evidence.
2. Transcribe through an assisted/manual review screen; OCR suggestions may accelerate entry but never approve data.
3. Reconcile current opening stock, customer receivables, supplier payables, and cash separately.
4. Apply only an approved opening state to live operational ledgers.
5. Keep the 1.5-year transaction history isolated and searchable.
6. Do not replay historical sales, purchases, cash movements, or journals unless a later project explicitly proves complete and balanced reconstruction.

## Mandatory controls

- Only an administrator/CEO-authorized role may approve opening-state application.
- Approval and rejection are audited with actor, workstation, timestamp, and reason.
- Source images and prior transcription revisions are immutable.
- No staging record may call live sale, purchase, payment, stock-adjustment, or journal-posting functions directly.
- All opening-state application must be idempotent and produce a reconciliation report before commit.
- The feature is controlled by a CEO-visible setting and defaults ON, consistent with the Stockiha feature-toggle policy.

## Business confirmations still required

These questions do not block creation of staging and review tooling, but they block live opening-state approval:

1. Are these pages customer sales/deliveries, supplier purchases/deliveries, or a mixture?
2. Are handwritten monetary values whole Algerian dinars or minor-unit/centime values?
3. What does the large number at the top-left represent: daily sequence, customer code, page number, or something else?
4. Do red `خالص` / `غير خالص` annotations represent final settlement state, and is the nearby red date the settlement date?
5. Do `+` and `-` values represent delivery charges, discounts, returns, prior balance, or cash paid?
6. Are product descriptions expected to map to the current Stockiha catalog, or must new legacy aliases be created?

## R0-001 completion boundary

R0-001 is complete when:

- representative fixtures encode these source patterns and uncertainties;
- a staging schema enforces evidence retention, review states, arithmetic variance, and no-direct-posting boundaries;
- SQL tests prove role authorization and immutable approval/audit behavior;
- a minimal Tauri intake/review screen can create and review draft documents;
- one consolidated Windows check transcribes these representative patterns and exports a reconciliation report.
