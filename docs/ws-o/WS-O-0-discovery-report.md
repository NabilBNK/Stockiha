# WS-O-0 — Units & Packaging: Discovery Report

Workstream: WS-O — Units & Packaging · Sub-plan: O-0 (read-only discovery)
Base: `main` @ `c9a09733b8eab28673bfdd185b1a7662db598d2c`

## Read this first — which database the evidence comes from

**`stockiha_acceptance` could not be reached** (stop condition 5.1). Exact error, from the cloud container this task ran in:

```
$ pg_isready -h localhost -p 5433
localhost:5433 - no response
$ psql -h localhost -p 5433 -U postgres -d stockiha_acceptance -c 'select 1'
psql: error: connection to server at "localhost" (127.0.0.1), port 5433 failed: Connection refused
	Is the server running on that host and accepting TCP/IP connections?
```

The acceptance database lives on the Owner's Windows PC; this task ran in a Linux cloud container with no network path to it.

**Declared fallback.** For the schema and function questions, I built a **throwaway** database, `stockiha_ws_o0_throwaway`, from this repository's own migrations. I followed `.github/workflows/ci.yml` exactly: the same role bootstrap, then all **160** files in `src-tauri/migrations/` applied in filename order with `ON_ERROR_STOP=1`. All 160 applied with no errors. Every `\d` output and every "live signature" below comes from `pg_proc` / `pg_get_functiondef` in that database, not from reading migration files.

Limits of the fallback:

- **Server version is PostgreSQL 16.13**, not 18.x. It is the only server installed in the container. All migrations applied cleanly on it. Catalog output such as `\d` and `pg_get_functiondef` does not depend on 16 vs 18 for anything here.
- The schema matches `stockiha_acceptance` **only if** the acceptance DB has every migration up to `20260925090000_ws_m_003_session_report.sql` applied. I could not check that (see *Could not verify*).
- **Row counts and unit rows (items 5 and 28) show only what migrations seed.** They say nothing about the real shop data. The queries to run on Windows are given, ready to paste, in items 5 and 28.

Evidence labels used below:
- **verified (DB)**: I ran the query against the throwaway DB and saw the output.
- **verified (file)**: I opened the file and saw the line.
- **read but not executed**: I read the function body; I did not run it.
- **assumed**: not used anywhere in this report.

The ws-d-skill Gate 0 references (`references/ws-d-surface-map.md`, `references/verification-queries.sql`) **do not exist** in `.claude/skills/ws-d-skill/`. I used the Gate 0 `pg_proc` query directly instead.

---

## Summary

1. **Pack infrastructure already exists at variant level**: `catalog.variant_units` stores `(variant_id, unit_id, conversion_factor numeric(20,6), conversion_direction, conversion_quantity)` with a UNIQUE `(variant_id, unit_id)`. Direct purchase, PO receipt, purchase return and stock adjustment already turn pack quantity into base quantity through it.
2. **Stock is already held only in the base unit.** `inventory.positions.quantity_on_hand numeric(18,3)` and every movement are base-unit only; neither table has a unit column.
3. **The sale side has no unit concept at all.** `sales.cash_sale_lines` and `sales.credit_sale_lines` have no `unit_id`. The sale posting functions treat `quantity` as base units. The POS cart holds **one line per variant**.
4. **Only one price exists**: `catalog.product_variants.sale_price numeric(14,2)`. There are no price lists, no customer prices, and no per-unit prices.
5. **Barcodes point only to a variant**: `catalog.variant_barcodes(variant_id, normalized_barcode UNIQUE)`, with no unit or quantity. `resolve_barcode` returns one price and the **product-level** unit.
6. **The sale price is not authoritative.** SQL accepts any client `unit_price ≥ 0` and never compares it with `sale_price`, and there is no override permission. The POS UI currently has no way to edit the price.
7. **`allows_fractions` is not enforced by any posting function** (React guidance only, by design, per the column comment).
8. **Two unit columns can disagree**: `products.unit_id` versus `product_variants.base_unit_id`. Purchasing and `resolve_barcode` use the product one; stock and conversion use the variant one. `catalog.set_variant_base_unit` changes the variant one with **no stock-history guard**.
9. **Purchasing UI cannot choose a pack today**: `procurement.list_purchase_product_options` hardcodes `'alternate_units': '[]'`.
10. **Dead or broken code found**: `inventory.confirm_supplier_return` writes non-existent columns, so it cannot succeed if called. It is registered as a Tauri command but no React code calls it. `procurement.post_purchase_transaction` is not registered in Rust at all, and hardcodes `COALESCE(unit_id, 1)`.

---

## A. Units (items 1–5)

### 1. `\d catalog.units` — verified (DB)

```
                                       Table "catalog.units"
      Column      |           Type           | Collation | Nullable |           Default
------------------+--------------------------+-----------+----------+------------------------------
 id               | bigint                   |           | not null | generated always as identity
 code             | text                     |           | not null |
 normalized_code  | text                     |           | not null |
 name             | text                     |           | not null |
 created_at       | timestamp with time zone |           | not null | now()
 updated_at       | timestamp with time zone |           | not null | now()
 is_active        | boolean                  |           | not null | true
 allows_fractions | boolean                  |           | not null | true
Indexes:
    "units_pkey" PRIMARY KEY, btree (id)
    "units_normalized_code_unique" UNIQUE CONSTRAINT, btree (normalized_code)
Check constraints:
    "units_code_not_blank" CHECK (btrim(code) <> ''::text)
    "units_name_not_blank" CHECK (btrim(name) <> ''::text)
    "units_normalized_code_not_blank" CHECK (normalized_code <> ''::text)
Referenced by:
    TABLE "catalog.product_variants" CONSTRAINT "product_variants_base_unit_id_fkey" FOREIGN KEY (base_unit_id) REFERENCES catalog.units(id)
    TABLE "catalog.products" CONSTRAINT "products_unit_id_fkey" FOREIGN KEY (unit_id) REFERENCES catalog.units(id)
    TABLE "procurement.purchase_order_lines" CONSTRAINT "purchase_order_lines_unit_id_fkey" FOREIGN KEY (unit_id) REFERENCES catalog.units(id)
    TABLE "procurement.purchase_receipt_lines" CONSTRAINT "purchase_receipt_lines_unit_id_fkey" FOREIGN KEY (unit_id) REFERENCES catalog.units(id)
    TABLE "procurement.purchase_return_lines" CONSTRAINT "purchase_return_lines_unit_id_fkey" FOREIGN KEY (unit_id) REFERENCES catalog.units(id) ON DELETE RESTRICT
    TABLE "procurement.purchase_transaction_lines" CONSTRAINT "purchase_transaction_lines_unit_id_fkey" FOREIGN KEY (unit_id) REFERENCES catalog.units(id)
    TABLE "inventory.stock_adjustments" CONSTRAINT "stock_adjustments_input_unit_id_fkey" FOREIGN KEY (input_unit_id) REFERENCES catalog.units(id)
    TABLE "catalog.variant_units" CONSTRAINT "variant_units_unit_id_fkey" FOREIGN KEY (unit_id) REFERENCES catalog.units(id)
Triggers:
    units_set_updated_at BEFORE UPDATE ON catalog.units FOR EACH ROW EXECUTE FUNCTION core.set_updated_at()
```

Units are global. They have no conversion, no "kind", and no base/derived relationship. Unit-related functions (live signatures, verified (DB)): `catalog.create_unit(text,text,boolean)`, `catalog.rename_unit(text,bigint,text,boolean)`, `catalog.set_unit_active(text,bigint,boolean)`, `catalog.delete_unit(text,bigint)`, `catalog.list_units(text)`, `catalog.list_units_v2(text)`. Full bodies of `create_unit` and `list_units_v2` are in Appendix B.

### 2. Existing conversion storage — verified (DB) + verified (file)

**It exists.** `\d catalog.variant_units` (verified (DB)):

```
                                     Table "catalog.variant_units"
        Column        |           Type           | Collation | Nullable |           Default
----------------------+--------------------------+-----------+----------+------------------------------
 id                   | bigint                   |           | not null | generated always as identity
 variant_id           | bigint                   |           | not null |
 unit_id              | bigint                   |           | not null |
 conversion_factor    | numeric(20,6)            |           | not null |
 created_at           | timestamp with time zone |           | not null | now()
 updated_at           | timestamp with time zone |           | not null | now()
 conversion_direction | text                     |           | not null |
 conversion_quantity  | numeric(20,6)            |           | not null |
Indexes:
    "variant_units_pkey" PRIMARY KEY, btree (id)
    "variant_units_unique" UNIQUE CONSTRAINT, btree (variant_id, unit_id)
    "variant_units_variant_idx" btree (variant_id)
Check constraints:
    "variant_units_conversion_direction_check" CHECK (conversion_direction = ANY (ARRAY['ALT_TO_BASE'::text, 'BASE_TO_ALT'::text]))
    "variant_units_conversion_quantity_positive" CHECK (conversion_quantity > 0::numeric)
    "variant_units_factor_positive" CHECK (conversion_factor > 0::numeric)
Foreign-key constraints:
    "variant_units_unit_id_fkey" FOREIGN KEY (unit_id) REFERENCES catalog.units(id)
    "variant_units_variant_id_fkey" FOREIGN KEY (variant_id) REFERENCES catalog.product_variants(id)
Triggers:
    variant_units_set_updated_at BEFORE UPDATE ON catalog.variant_units FOR EACH ROW EXECUTE FUNCTION core.set_updated_at()
```

Semantics (read but not executed, from `catalog.add_variant_alt_unit`, Appendix B):
- `conversion_factor` always means "1 alternate unit = `conversion_factor` base units". It is the only column the posting functions read.
- `ALT_TO_BASE`: `conversion_factor := conversion_quantity` (exact).
- `BASE_TO_ALT`: `conversion_factor := round(1 / conversion_quantity, 6)`. **This is lossy.** For example, "1 base = 3 alt" stores `0.333333`. The frontend comments document this (`src/shared/ipc/dto.ts:209-217`).
- There is no price column, no barcode column, and no "sellable" flag.

Other conversion storage:
- `inventory.stock_adjustments.input_unit_id`, `input_quantity_delta numeric(18,3)`, `conversion_factor numeric(20,6)` (verified (DB)). This is a snapshot of the conversion used.
- `procurement.purchase_return_lines.quantity` + `base_quantity numeric(18,3)` + `unit_id` (verified (DB)).
- `unit_id` columns on `purchase_order_lines`, `purchase_receipt_lines`, `purchase_transaction_lines` (verified (DB)).
- Rust: `src-tauri/src/domain/catalog.rs:32-49` has `validate_positive_factor` and `base_quantity(entered, factor) = entered * factor` (verified (file)). I found no production caller outside its own tests there. Other Rust hits: `application/catalog.rs:496-517` (`add_variant_alt_unit` binding), `application/stock_adjustment.rs:46,180,195`, `commands/stock_adjustment.rs:33,109`, `commands/catalog.rs:311-321`, `domain/procurement.rs:650` (verified (file)).
- TypeScript: `src/shared/ipc/dto.ts:195-248, 684`, `src/shared/ipc/gateway.ts:536-550`, `src/features/catalog2/CatalogPanel.tsx:1187-1425` (the `AlternateUnitsSection` editor) (verified (file)).
- **User-facing contradiction** (verified (file)): `src/shared/i18n/locales.ts:1790` `'catalog2.altUnitsNotAppliedYet': 'These conversions are recorded for this variant. They are not yet applied automatically to receipts, purchases or sales.'` (the French text is at `:405`). The SQL for direct purchase, PO receipt, purchase return and stock adjustment **does** apply them when it receives a non-base `unit_id`. What is true is that the purchasing UI never offers one (item 15).

Complete keyword hit list (`factor|conversion|ratio|pack|box|carton|base_unit|base_quantity|pieces` across migrations, Rust and TS; 349 lines after removing `package`, `checkbox`, `Box<`, CSS `box` and similar false positives): **Appendix C**. Some non-unit hits remain in that list (recovery-screen CSS classes, the French word "opération"). They are left in so the list stays unedited.

### 3. Where a product/variant links to a unit — verified (DB)

There are two columns:
- `catalog.products.unit_id bigint NOT NULL DEFAULT catalog._default_product_unit_id()` (FK to `units`). The default function returns the unit whose `normalized_code = 'UNIT'`.
- `catalog.product_variants.base_unit_id bigint NOT NULL` (FK to `units`).
- Alternate units: `catalog.variant_units`, which is **variant-level**.

Sync (read but not executed):
- `catalog._insert_variant` copies the product's `unit_id` into `base_unit_id` (`SELECT unit_id INTO v_product_unit FROM catalog.products …`).
- `catalog.quick_create_product` inserts the same `p_unit_id` into both.
- Both `catalog.update_product` overloads, `(text,bigint,text,bigint,boolean)` and `(…,bigint)`, overwrite every variant's `base_unit_id` with the product unit. They refuse the change when `catalog._product_has_stock_history(product_id)` is true.
- **`catalog.set_variant_base_unit(text,bigint,bigint)` changes one variant's `base_unit_id` with no stock-history check** (body in Appendix B). It is exposed through Rust `application/catalog.rs:540` and TS `gateway.ts:558`. I found **no React caller** (verified (file), grep for `setVariantBaseUnit` in `src/**/*.tsx`).

Which column each reader uses:

| Reader | Uses |
|---|---|
| `catalog.resolve_barcode` | `products.unit_id` |
| `procurement.list_purchase_product_options` ("default unit") | `products.unit_id` |
| `procurement.post_purchase_transaction` snapshot | `COALESCE(line.unit_id, p.unit_id)`; inserts `COALESCE(line.unit_id, 1)` |
| `catalog.get_product_detail` | `products.unit_id` |
| `inventory.list_inventory_snapshot` (`base_unit_code`) | `product_variants.base_unit_id` |
| `inventory.confirm_direct_purchase`, `confirm_purchase_receipt`, `confirm_stock_adjustment`, `procurement.confirm_purchase_return`, `inventory.list_stock_adjustment_units` | `product_variants.base_unit_id` + `variant_units` |

### 4. Decimal / whole-number flag — verified (DB) + verified (file)

Storage: `catalog.units.allows_fractions boolean NOT NULL DEFAULT true`. The column comment (`src-tauri/migrations/20260906090000_ws_d_005_unit_allows_fractions.sql:53-59`) says:

> Whether quantities in this unit may carry a fractional part. true for Kg/Litre, false for Piece/Box. Existing rows were backfilled to true deliberately (WS-D-13 Phase A)… **Enforced as UI guidance only -- there is no CHECK constraint on quantity columns.**

SQL: the live functions whose body mentions `allows_fractions` are only `catalog.list_units_v2`, `catalog.create_unit`, and `catalog.rename_unit` (verified (DB), `prosrc ~ 'allows_fractions'`). **No posting function checks it.** The only quantity-precision checks in posting SQL are `numeric(18,3)` scale checks, for example `confirm_stock_adjustment`: `IF p_quantity_delta <> round(p_quantity_delta, 3)`.

Rust: carried only for create, rename and list (`application/catalog.rs:411-417, 735, 1076-1124`; `commands/catalog.rs:259-262, 506, 775, 789-792`). There is no validation (verified (file)).

React (the only enforcement, all advisory):
- `src/features/inventory/exactDecimal.ts:54` `isQuantityValidForUnit(quantity, allowsFractions)`. It is documented at `:50-53` as "NOT AUTHORITATIVE".
- `src/features/inventory/useUnitFractionRules.ts:41-61` (lookup by unit id or code).
- `src/features/inventory/StockReceiptScreen.tsx:84-90, 194, 404` (base unit only).
- `src/features/inventory/StockAdjustmentScreen.tsx:300-307, 322, 650` (selected unit).
- `src/features/procurement/PurchaseReceiptModal.tsx:35-48` (by unit code).
- **Not checked** in `PurchasesScreen.tsx` (direct purchase), `PurchaseReturnModal.tsx`, or the POS. The POS quantity is a JS integer changed only by ±1 buttons.

### 5. Rows in `catalog.units` — verified (DB), **throwaway DB only**

```sql
SELECT id, code, normalized_code, name, is_active, allows_fractions FROM catalog.units ORDER BY id;
```
```
 id | code | normalized_code | name | is_active | allows_fractions
----+------+-----------------+------+-----------+------------------
  1 | UNIT | UNIT            | Unit | t         | t
(1 row)
```
This is only the migration seed. **Run the same query on Windows against `stockiha_acceptance`** to get the real rows.

---

## B. Prices & cost (items 6–8)

### 6. Selling price — verified (DB)

- The only catalogue price is `catalog.product_variants.sale_price numeric(14,2) NOT NULL`, `CHECK (sale_price >= 0)`. It is **one price per variant**.
- Every column in the database whose name contains `price` (verified (DB), `information_schema.columns`):

```
 catalog.product_variants                 | sale_price     | numeric | 14 | 2
 onboarding.historical_trade_lines        | unit_price_dzd | bigint  | 64 | 0
 onboarding.historical_trade_lines_mapped | unit_price_dzd | bigint  | 64 | 0
 sales.cash_sale_lines                    | unit_price     | numeric | 14 | 2
 sales.credit_sale_lines                  | unit_price     | numeric | 14 | 2
```
- **There are no price lists, customer-specific prices, per-unit prices, or price history tables.** No table name contains `price`.

### 7. Cost columns — verified (DB)

```
 inventory.positions                    | last_known_wac     | numeric | 18 | 6
 inventory.receipt_cost_attribution     | original_unit_cost | numeric | 14 | 2
 inventory.stock_adjustments            | wac_snapshot       | numeric | 18 | 6
 procurement.purchase_order_lines       | unit_cost          | numeric | 14 | 2
 procurement.purchase_receipt_lines     | unit_cost          | numeric | 14 | 2
 procurement.purchase_return_lines      | unit_cost          | numeric | 14 | 2
 procurement.purchase_return_lines      | wac_at_return      | numeric | 18 | 6
 procurement.purchase_transaction_lines | unit_cost          | numeric | 18 | 6
 procurement.supplier_invoice_lines     | unit_cost          | numeric | 14 | 2
 procurement.supplier_return_lines      | unit_cost          | numeric | 14 | 4
 sales.cash_sale_lines                  | unit_cost_snapshot | numeric | 18 | 4
 sales.credit_sale_lines                | unit_cost_snapshot | numeric | 18 | 4
```
Also `inventory.positions.total_value numeric(18,4)` and `inventory.movements.inventory_value_delta` / `resulting_total_value numeric(18,4)`.

Things to note:
- Purchase-line `unit_cost` is **per entered unit** (for a pack line, the pack cost) at **2 dp**.
- The sale COGS snapshot is stored at **4 dp** while WAC is **6 dp**. The sale functions compute COGS from the 6-dp `v_wac` and write `unit_cost_snapshot := v_wac`; the column cast rounds it to 4 dp.

Rust fixed scales (verified (file), `src-tauri/src/domain/money.rs`):

| Type | Line | SCALE |
|---|---|---|
| `Money` | `:22-25` | 2 |
| `Quantity` | `:65-68` | 3 |
| `CostAmount` | `:128-131` | 4 |
| `WacRate` | `:173-176` | 6 |

### 8. WAC recalculation — read but not executed (bodies in Appendix B)

There is no dedicated WAC function. Each stock-in function recomputes WAC inline, per `(warehouse_id, variant_id)`:

| Function (live signature) | WAC formula | Rounding |
|---|---|---|
| `inventory.confirm_direct_purchase(text,uuid,bytea,bigint,bigint,bigint,date,text,jsonb)` (the live UI purchase path) | `v_base_qty := round(qty × conversion_factor, 3)`; `v_value_delta := round(qty × unit_cost, 2)` (the pack line total); `v_new_wac := round(new_value / new_qty, 6)` | base qty 3 dp; value 2 dp; WAC 6 dp |
| `inventory.confirm_purchase_receipt(text,uuid,bytea,bigint,bigint,date,jsonb)` (PO receipt) | `base_qty := qty × factor` (implicit cast to `numeric(18,3)` on write); `value_delta := round(base_qty × (unit_cost / factor), 4)`; `new_wac := new_value / new_qty` (no explicit round; column cast to 6 dp) | 4 dp value |
| `inventory.confirm_stock_receipt(text,uuid,bytea,bigint,bigint,numeric,numeric,bigint,date)` (base unit only) | `received_value := round(qty × unit_cost, 4)`; `new_wac := round(new_value / new_qty, 6)` | |
| `inventory.allocate_landed_cost(text,uuid,bytea,bigint,numeric,text,bigint,date,text)` | allocation `round(…, 2)`; `new_wac := round(new_value / qty_on_hand, 6)` | |
| `sales.void_sale(text,bigint,text,text)` | re-receipt at original value; `last_known_wac = round(new_value / new_qty, 6)` | |
| `procurement.confirm_purchase_return(text,uuid,bytea,bigint,bigint,date,text,text,jsonb)` | issues at current WAC | |

Issues (sales, adjustments) do not change WAC. They take out `round(qty × wac, 4)`.

**Residuals:**
- `inventory._handle_residual_at_zero_quantity(bigint,bigint,bigint,numeric,bigint,date)` (full body in Appendix B). It is called when a stock-out leaves quantity at 0 and value not 0. If `0 < |remaining| < 0.01`, it writes a `RESIDUAL_CLEARANCE` movement (qty 0, value `-residual`) and an `inventory.residual_clearances` row. It posts a journal (Dr `INVENTORY_ADJUSTMENT_LOSS` / Cr `INVENTORY_MERCHANDISE`) only when `round(residual, 2) > 0`. So a negative sub-centime residual is cleared without a journal.
- The callers refuse `|remaining| ≥ 0.01` with SQLSTATE 55000 (`'… material unresolved inventory residual'`).
- `inventory.residual_clearances` has `CHECK (abs(detected_residual_value) < 0.01)`.
- Rust `src-tauri/src/domain/residual.rs`: `InventoryResidual`, `MATERIAL_THRESHOLD = "0.01"` (`:17`), `to_journal_amount = round_dp(2)` (`:41-42`) (verified (file)). It mirrors the SQL rule; the SQL is the authority.

---

## C. Barcodes (items 9–11)

### 9. Barcode storage — verified (DB)

```
                                  Table "catalog.variant_barcodes"
       Column       |           Type           | Collation | Nullable |           Default
--------------------+--------------------------+-----------+----------+------------------------------
 id                 | bigint                   |           | not null | generated always as identity
 variant_id         | bigint                   |           | not null |
 barcode            | text                     |           | not null |
 normalized_barcode | text                     |           | not null |
 created_at         | timestamp with time zone |           | not null | now()
 is_primary         | boolean                  |           | not null | false
Indexes:
    "variant_barcodes_pkey" PRIMARY KEY, btree (id)
    "idx_variant_barcodes_barcode_trgm" gin (barcode gin_trgm_ops)
    "variant_barcodes_normalized_unique" UNIQUE CONSTRAINT, btree (normalized_barcode)
    "variant_barcodes_primary_unique" UNIQUE, btree (variant_id) WHERE is_primary = true
    "variant_barcodes_variant_idx" btree (variant_id)
Check constraints:
    "variant_barcodes_normalized_not_blank" CHECK (normalized_barcode <> ''::text)
    "variant_barcodes_not_blank" CHECK (btrim(barcode) <> ''::text)
Foreign-key constraints:
    "variant_barcodes_variant_id_fkey" FOREIGN KEY (variant_id) REFERENCES catalog.product_variants(id)
```
Uniqueness is global on `normalized_barcode`, and there is at most one primary barcode per variant. **There is no unit or pack column.** A variant can already hold several barcodes, but all of them mean "one base unit of this variant".

SKU: `product_variants.sku` is `UNIQUE` (`product_variants_sku_unique`), and `resolve_barcode` falls back to it.

### 10. `catalog.resolve_barcode` — verified (DB)

Live signature (single row in `pg_proc`, no overloads): `catalog.resolve_barcode(text,text)`, `SECURITY DEFINER`, session-checked only (no permission).

```sql
CREATE OR REPLACE FUNCTION catalog.resolve_barcode(p_session_token text, p_identifier text)
 RETURNS TABLE(variant_id bigint, product_id bigint, sku text, name_override text, effective_variant_name text, primary_barcode text, operational_identifier text, identifier_type text, product_name text, sale_price numeric, unit_id bigint, unit_code text, unit_name text, variant_is_active boolean, product_is_active boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
    v_norm text;
BEGIN
    PERFORM 1 FROM iam.resolve_session(p_session_token);
    v_norm := upper(btrim(coalesce(p_identifier, '')));
    IF v_norm = '' THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT v.id, p.id, v.sku, v.name_override, catalog._effective_variant_name(v.id),
           b_prim.barcode, coalesce(b_prim.barcode, v.sku),
           CASE WHEN b_prim.barcode IS NOT NULL THEN 'BARCODE' ELSE 'SKU' END,
           p.name, v.sale_price, u.id, u.code, u.name, v.is_active, p.is_active
    FROM catalog.variant_barcodes b
    JOIN catalog.product_variants v ON v.id = b.variant_id
    JOIN catalog.products p ON p.id = v.product_id
    JOIN catalog.units u ON u.id = p.unit_id
    LEFT JOIN catalog.variant_barcodes b_prim
      ON b_prim.variant_id = v.id AND b_prim.is_primary = true
    WHERE b.normalized_barcode = v_norm
      AND v.is_active
      AND p.is_active
    LIMIT 1;

    IF FOUND THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT v.id, p.id, v.sku, v.name_override, catalog._effective_variant_name(v.id),
           b_prim.barcode, coalesce(b_prim.barcode, v.sku),
           CASE WHEN b_prim.barcode IS NOT NULL THEN 'BARCODE' ELSE 'SKU' END,
           p.name, v.sale_price, u.id, u.code, u.name, v.is_active, p.is_active
    FROM catalog.product_variants v
    JOIN catalog.products p ON p.id = v.product_id
    JOIN catalog.units u ON u.id = p.unit_id
    LEFT JOIN catalog.variant_barcodes b_prim
      ON b_prim.variant_id = v.id AND b_prim.is_primary = true
    WHERE upper(v.sku) = v_norm
      AND v.is_active
      AND p.is_active
    LIMIT 1;
END;
$function$
```
It returns 0 or 1 row. That row carries **one `sale_price`** (the variant's) and the **product-level** unit (`p.unit_id`, not `v.base_unit_id`). It does not report *which* barcode matched or what quantity that barcode stands for.

### 11. Callers of `resolve_barcode` — verified (file)

- Rust: `src-tauri/src/application/catalog.rs:561-589` (`resolve_barcode`, `SELECT … FROM catalog.resolve_barcode($1, $2)`); the struct is `ResolvedBarcode` at `:188`. Test caller: `:1486`. Command: `src-tauri/src/commands/catalog.rs:399-405`. Registered in `src-tauri/src/lib.rs:389`.
- TS IPC: `src/shared/ipc/commands.ts:148`; `src/shared/ipc/gateway.ts:562` (`resolveBarcode`); DTO `src/shared/ipc/dto.ts:187` (`ResolvedBarcode`).
- Wrapper: `src/shared/search/barcodeFirstSearch.ts:31-38` (`resolveBarcodeFirst`). It swallows errors and returns `no-match`.
- UI callers of the wrapper:
  - `src/app/AppShell.tsx:248` (global search).
  - `src/features/pos/PosScreen.tsx:297` (`handleSearchEnter`). The POS then **ignores the resolved price and unit**. It makes a second call, `listProductsV2(search: trimmed)`, finds the row with the same `variant_id`, and calls `addToCart(matchedProduct)`. That function adds **+1 base quantity at `sale_price`** (`PosScreen.tsx:304-322, 338-358`).

---

## D. Stock (items 12–13)

### 12. Quantity storage — verified (DB)

- `inventory.positions`: `quantity_on_hand numeric(18,3)`, `total_value numeric(18,4)`, `last_known_wac numeric(18,6)`, and `UNIQUE (warehouse_id, variant_id)`. **There is no unit column; it is always the variant's base unit.**
- `inventory.movements` (full `\d` in Appendix A): `quantity_delta numeric(18,3)`, `inventory_value_delta numeric(18,4)`, `resulting_quantity_on_hand numeric(18,3)`, `resulting_total_value numeric(18,4)`, `movement_type IN ('RECEIPT','ISSUE','ADJUSTMENT','COST_ONLY','RESIDUAL_CLEARANCE')`, `reference_type text`, `reference_id bigint`.
  - **There is no unit column and no line-id column.** A movement links back only to a *document* id through `(reference_type, reference_id)`. Purchase-side line tables hold `movement_id`; sale lines do not.
  - Delete is forbidden by trigger `movements_forbid_delete`.

### 13. Negative-stock constraints — verified (DB)

```
inventory.positions:
    "positions_quantity_non_negative" CHECK (quantity_on_hand >= 0::numeric)
    "positions_value_non_negative" CHECK (total_value >= 0::numeric)
    "positions_wac_non_negative" CHECK (last_known_wac >= 0::numeric)
    "positions_zero_quantity_zero_value" CHECK (quantity_on_hand > 0::numeric OR total_value = 0::numeric)
inventory.movements:
    "movements_resulting_quantity_non_negative" CHECK (resulting_quantity_on_hand >= 0::numeric)
    "movements_resulting_value_non_negative" CHECK (resulting_total_value >= 0::numeric)
    "movements_zero_quantity_zero_value" CHECK (resulting_quantity_on_hand > 0::numeric OR resulting_total_value = 0::numeric)
    "movements_cost_only_requires_stock" CHECK (quantity_delta <> 0::numeric OR resulting_quantity_on_hand > 0::numeric OR movement_type = 'RESIDUAL_CLEARANCE'::text AND quantity_delta = 0::numeric AND resulting_quantity_on_hand = 0::numeric)
```
The sale functions also check before writing: `IF v_qty_on_hand < v_quantity THEN RAISE … 'insufficient stock …' USING ERRCODE = '55000'`.

---

## E. Purchases (items 14–16)

**Which path is live** (verified (file)):

| Path | Status |
|---|---|
| `PurchasesScreen.tsx:297` → `confirmDirectPurchase` → Rust `procurement_service.rs:315-336` → `inventory.confirm_direct_purchase` | **Live** UI purchase path |
| `PurchaseReceiptModal.tsx` → `inventory.confirm_purchase_receipt` | PO receipt |
| `procurement.post_purchase_transaction(text,uuid,bytea,jsonb)` | **Not reachable.** It exists in the DB, and TS has `commands.ts:209` and `gateway.ts:923-931`, but **no Rust `#[tauri::command]` is registered** (`grep post_purchase_transaction src-tauri/src/lib.rs src-tauri/src/commands/*.rs` returns nothing). No React code calls `postPurchaseTransaction`. |

### 14. Purchase tables — verified (DB) (full `\d` in Appendix A)

- `procurement.purchase_receipts` (header): `subtotal`, `total_amount numeric(14,2)`, `receipt_origin IN ('DIRECT_PURCHASE','PURCHASE_ORDER')`, `CHECK (total_amount = subtotal)`.
- `procurement.purchase_receipt_lines`: `unit_id bigint NOT NULL` (FK), `quantity_received numeric(18,3)` (**in the entered unit**), `unit_cost numeric(14,2)` (**per entered unit**), `line_total numeric(14,2)`, `movement_id NOT NULL` (FK to `inventory.movements`), `po_line_id`.
- `procurement.purchase_order_lines`: `unit_id`, `quantity_ordered`, `quantity_received numeric(18,3)` (entered unit), `unit_cost numeric(14,2)`, `line_total numeric(14,2)`.
- `procurement.purchase_transactions` / `purchase_transaction_lines` (the unreachable path): the line has `unit_id`, `quantity numeric(18,3)`, `unit_cost numeric(18,6)`, `gross_amount`, `discount_amount`, `tax_amount`, `line_total numeric(14,2)`, `unit_code_snapshot`.
- `procurement.supplier_invoice_lines`: `quantity numeric(14,3)`, `unit_cost numeric(14,2)`, `line_total`, and **no `unit_id`**.

### 15. Direct purchase posting — read but not executed (full body in Appendix B)

`inventory.confirm_direct_purchase(p_session_token text, p_request_id uuid, p_payload_hash bytea, p_supplier_id bigint, p_warehouse_id bigint, p_fiscal_period_id bigint, p_document_date date, p_note text, p_lines jsonb)` returns jsonb, `SECURITY DEFINER`.

Per line `{variant_id, unit_id, quantity_received, unit_cost}`:
- `unit_id` is required.
- If `unit_id = base_unit_id` the factor is 1; otherwise it reads `variant_units.conversion_factor` and errors if absent.
- `base_qty := round(qty × factor, 3)`; `line_total := round(qty × unit_cost, 2)`; `value_delta := line_total`.
- Upserts `inventory.positions` (`qty += base_qty`, `value += line_total`, `wac := round(value / qty, 6)`).
- Writes a `RECEIPT` movement with `reference_type 'PURCHASE_RECEIPT'`.
- Writes `purchase_receipt_lines` in the entered unit.
- Journal: Dr INVENTORY / Cr GRNI for the receipt subtotal.

**So "purchase by the pack at the pack cost" already works in SQL.** What blocks it is the option feed: `procurement.list_purchase_product_options(text)` returns `'default_unit_id', u.id` from `JOIN catalog.units u ON u.id = p.unit_id` (the product unit), and **`'alternate_units', '[]'::jsonb` hardcoded** (full body in Appendix B). `PurchasesScreen.tsx:224` builds the unit dropdown from `default_unit_id` plus `alternate_units`, so today only the product unit can be picked.

Also verified (file): `PurchasesScreen.tsx:232` validates the cost with `parseFloat` (validation only; the string itself is sent).

`procurement.post_purchase_transaction` (unreachable) inserts `COALESCE(v_line_rec.unit_id, 1)` into `purchase_order_lines` and `purchase_transaction_lines`, a hardcoded unit id 1 (read but not executed, lines 305-308 and 480-486 of its `pg_get_functiondef`).

### 16. Supplier returns — verified (DB) + read but not executed

There are **two** return systems:

1. **Live (WS-E-3):** `PurchaseReturnModal.tsx:115` → `confirmPurchaseReturn` → `procurement.confirm_purchase_return(text,uuid,bytea,bigint,bigint,date,text,text,jsonb)`.
   - Tables `procurement.purchase_returns` and `procurement.purchase_return_lines`: `receipt_line_id`, `unit_id`, `quantity numeric(18,3)` (entered unit), `base_quantity numeric(18,3)`, `unit_cost numeric(14,2)`, `refund_total`, `wac_at_return numeric(18,6)`, `inventory_value numeric(14,2)`, `movement_id`.
   - The function takes the unit from the receipt line, converts through `variant_units.conversion_factor`, and issues at current WAC.
2. **Legacy (S3-003):** tables `procurement.supplier_returns` / `procurement.supplier_return_lines` (`quantity numeric(14,4)`, `unit_cost numeric(14,4)`, `line_total numeric(14,2)`, **no `unit_id`**). Posting function `inventory.confirm_supplier_return(text,uuid,bytea,bigint,bigint,date)`.
   - **This function cannot succeed.** Its `INSERT INTO inventory.movements (…, value_delta, unit_cost, reference_document_id, created_by_user_id)` names columns that do not exist. The live columns (verified (DB)) are `id, warehouse_id, variant_id, movement_type, quantity_delta, inventory_value_delta, resulting_quantity_on_hand, resulting_total_value, reference_type, reference_id, created_at`. It also uses `movement_type 'PURCHASE_RETURN'`, which the CHECK rejects, and sets `inventory.positions.current_wac`, which does not exist (the column is `last_known_wac`).
   - Rust registers it (`lib.rs:465`, `procurement_service.rs:604-621`) and TS exposes it (`gateway.ts:882`), but **no React code calls `confirmSupplierReturn`**.
   - Not executed. It would need writes, and plpgsql only fails on these at run time.

---

## F. Sales / POS (items 17–21)

### 17. Sale tables — verified (DB)

`sales.cash_sales` (header): `subtotal`, `total_amount`, `discount_amount numeric(14,2) DEFAULT 0`, with:
```
    "cash_sales_discount_non_negative" CHECK (discount_amount >= 0::numeric)
    "cash_sales_discount_within_subtotal" CHECK (discount_amount <= subtotal)
    "cash_sales_total_is_subtotal_less_discount" CHECK (total_amount = (subtotal - discount_amount))
```
`sales.cash_sale_lines`: `variant_id`, `variant_sku_snapshot`, `variant_name_snapshot`, `quantity numeric(18,3)`, `unit_price numeric(14,2)`, `unit_cost_snapshot numeric(18,4)`, `line_total numeric(14,2)`, with:
```
    "cash_sale_lines_line_total_matches_quantity_and_price" CHECK (line_total = round(quantity * unit_price, 2))
    "cash_sale_lines_quantity_positive" CHECK (quantity > 0::numeric)
    "cash_sale_lines_unit_price_non_negative" CHECK (unit_price >= 0::numeric)
    "cash_sale_lines_unit_cost_non_negative" CHECK (unit_cost_snapshot >= 0::numeric)
```
**There is no `unit_id`, no line discount, and no `movement_id`.**

`sales.credit_sales`: `subtotal`, `total_amount`, `CHECK (total_amount = subtotal)`. **There is no discount column.**
`sales.credit_sale_lines`: identical line shape and CHECK (`credit_sale_lines_total_matches`). Full `\d` is in Appendix A.

### 18. Sale posting functions — verified (DB) signatures; bodies read but not executed

- `sales.confirm_cash_sale(p_session_token text, p_request_id uuid, p_payload_hash bytea, p_cash_session_id bigint, p_warehouse_id bigint, p_fiscal_period_id bigint, p_document_date date, p_lines jsonb, p_discount_amount numeric DEFAULT 0)` returns bigint. Full body in Appendix B.
- `sales.confirm_credit_sale` has **two live overloads**:
  - `(text,uuid,bytea,bigint,bigint,bigint,date,jsonb,uuid)` does the work.
  - `(text,uuid,bigint,bigint,bigint,date,jsonb,uuid)` is a wrapper. It computes the hash with `receivables.credit_sale_payload_hash` and **replaces `p_document_date` with `(now() AT TIME ZONE 'Africa/Algiers')::date`**. Rust calls the wrapper (`application/credit_sale.rs:107-120`).

**Where the price comes from:** both functions read `unit_price` **from the client JSON line** (`v_unit_price := (v_line ->> 'unit_price')::numeric`) and only check that it is `≥ 0`. `catalog.product_variants.sale_price` is **never read** by either (verified (DB): `prosrc ~ 'sale_price'` does not match either sale function). The quantity from the client is used directly as the **base-unit** stock issue (`quantity_delta = -v_quantity`).

Rust: `application/cash_sale.rs:20-33` (`CashSaleLineInput { variant_id, quantity: Decimal, unit_price: Decimal }`), `commands/cash_sale.rs:18-21, 53-54`, `application/credit_sale.rs:10-14`. Rust validation (`credit_sale.rs:64`) only checks sign and positivity.

### 19. Can the POS change a line's unit price? — verified (file)

- **UI: no.** `CartLine.unitPrice` (`PosScreen.tsx:28-37`) is copied from `sale_price` in `addToCart` / `addProductListItemToCart` (`:338-381`). There is no price input in the cart (`:858-870`: only name, total, ± buttons, remove). The quantity is a JS `number` changed only by `changeQty(±1)` (`:417-431`).
- **Rust: no rule.** It passes `unit_price` through.
- **SQL: accepts any value ≥ 0 with no permission check and no comparison to catalogue price.** So "the seller may change the price" needs no new capability in the posting SQL. However, there is currently **no authorization boundary** on price changes: any `POST_CASH_SALE` caller can send any price.

### 20. Whole-sale fixed discount — verified (DB) + read but not executed

- Cash sales only: `p_discount_amount` is stored in `sales.cash_sales.discount_amount`. It needs permission `APPLY_SALE_DISCOUNT` when > 0, at most 2 dp, and `≤ subtotal`.
- It is **not allocated to lines.** The journal credits `SALES_REVENUE` gross (`v_subtotal`), debits `SALES_DISCOUNT` with the discount and `CASH_DESK` with the net. COGS is unaffected.
- The POS enables the discount only for cash mode (`PosScreen.tsx:434`).
- Credit sales have no discount at all.

### 21. Sale void — read but not executed (full body in Appendix B)

`sales.void_sale(p_session_token text, p_document_id bigint, p_reason_code text, p_note text)` returns jsonb. It voids the **whole document**; there is no partial or line void. It:
- locks the original,
- requires that session to still be open and owned by the caller,
- refuses a credit sale that has payments allocated,
- creates a void document with `reverses_document_id`,
- writes a mirrored journal (every sale journal line with debit and credit swapped),
- finds the original `ISSUE` movements by `(reference_type = '<CASH|CREDIT>_SALE_LINE', reference_id = document)` and posts opposite `RECEIPT` movements at **exactly the original value**, recomputing `last_known_wac = round(value / qty, 6)`,
- reverses the cash movement or the customer ledger,
- marks the original `REVERSED`.

The slip payload re-reads `quantity` and `unit_price` from the sale lines.

---

## G. Adjustments & other stock writers (items 22–23)

### 22. Stock adjustment — verified (DB) + read but not executed

`inventory.stock_adjustments` holds **one row per adjustment** (single line). Its columns:
- `document_id`, `warehouse_id`, `variant_id`
- `input_unit_id` (FK units)
- `input_quantity_delta numeric(18,3)`, `conversion_factor numeric(20,6)`, `quantity_delta numeric(18,3)` (base)
- `wac_snapshot numeric(18,6)`, `inventory_value_delta numeric(18,4)`
- `reason_code`, `note`, `movement_id`, `journal_document_id`, `posted_by_user_id`, `workstation_id`, `created_at`

The full CHECK list is in Appendix A. It includes `stock_adjustments_factor_positive`, `…_input_delta_nonzero`, `…_base_delta_nonzero`, and `…_direction_matches`.

Posting: `inventory.confirm_stock_adjustment(p_session_token text, p_request_id uuid, p_payload_hash bytea, p_warehouse_id bigint, p_variant_id bigint, p_unit_id bigint, p_quantity_delta numeric, p_reason_code text, p_note text, p_fiscal_period_id bigint, p_document_date date)` returns jsonb. It:
- converts through `variant_units.conversion_factor`,
- **rejects** results with more than 3 dp in base (`p_quantity_delta * factor <> round(…, 3)`),
- values at current WAC.

Unit choices come from `inventory.list_stock_adjustment_units(text,bigint)`: base unit (factor 1) plus every `variant_units` row. This is the **one UI path where a pack can already be chosen** (`StockAdjustmentScreen.tsx`).

### 23. Every function that writes stock movements — verified (DB)

Query: `prosrc ~* 'insert\s+into\s+inventory\.movements'` OR updates or inserts `inventory.positions`.

```
 inventory.confirm_stock_receipt(text,uuid,bytea,bigint,bigint,numeric,numeric,bigint,date)             | secdef t
 inventory._handle_residual_at_zero_quantity(bigint,bigint,bigint,numeric,bigint,date)                  | secdef t
 inventory.confirm_stock_adjustment(text,uuid,bytea,bigint,bigint,bigint,numeric,text,text,bigint,date) | secdef t
 inventory.confirm_purchase_receipt(text,uuid,bytea,bigint,bigint,date,jsonb)                           | secdef t
 inventory.allocate_landed_cost(text,uuid,bytea,bigint,numeric,text,bigint,date,text)                   | secdef t
 inventory.confirm_supplier_return(text,uuid,bytea,bigint,bigint,date)                                  | secdef t   (broken, see item 16)
 sales.confirm_credit_sale(text,uuid,bytea,bigint,bigint,bigint,date,jsonb,uuid)                        | secdef t
 inventory.confirm_direct_purchase(text,uuid,bytea,bigint,bigint,bigint,date,text,jsonb)                | secdef t
 procurement.confirm_purchase_return(text,uuid,bytea,bigint,bigint,date,text,text,jsonb)                | secdef t
 sales.confirm_cash_sale(text,uuid,bytea,bigint,bigint,bigint,date,jsonb,numeric)                       | secdef t
 sales.void_sale(text,bigint,text,text)                                                                 | secdef t
(11 rows)
```
`procurement.post_purchase_transaction` writes stock only indirectly, by calling `inventory.confirm_purchase_receipt`.

The opening-state import (`onboarding.*`) writes **no** movements or positions: none of its functions match the query. `OpeningStateApplicationScreen.tsx:111` also says so.

---

## H. Screens & documents (items 24–27) — verified (file)

### 24. Where quantity (or price) is entered

| File | Component | What is entered |
|---|---|---|
| `src/features/pos/PosScreen.tsx` | `PosScreen` | qty via ± buttons only (`changeQty` `:417`, buttons `:867`); discount input (`:897`); **no price input** |
| `src/features/procurement/PurchasesScreen.tsx` | `PurchasesScreen` | unit select (`:600`), `quantity_ordered` (`:616`), `unit_cost` (`:626`) |
| `src/features/procurement/PurchaseReceiptModal.tsx` | `PurchaseReceiptModal` | received qty per PO line (`:232-236`) |
| `src/features/procurement/PurchaseReturnModal.tsx` | `PurchaseReturnModal` | return qty per receipt line (`:232-237`) |
| `src/features/inventory/StockReceiptScreen.tsx` | `StockReceiptScreen` | qty (`:395`), unit cost (`:411`), base unit only |
| `src/features/inventory/StockAdjustmentScreen.tsx` | `StockAdjustmentScreen` | qty (`:641`) with unit choice |
| `src/features/catalog2/CatalogPanel.tsx` | `AlternateUnitsSection` | conversion quantity (`:1378`) |
| `src/features/catalog2/VariantEditor.tsx` (`:214`), `VariantLine.tsx` (`:119`), `VariantDraftFields.tsx` (`:84`), `BulkVariantGenerator.tsx` (`:371, :464`) | `VariantEditor`, `VariantLine`, `VariantDraftFields`, `BulkVariantGenerator` | `sale_price` |
| `src/features/procurement/PurchaseItemPicker.tsx` | picker | cost filter min/max (`:292, :304`), filter only |

### 25. Where quantity or unit price is displayed

- **POS / sales:** `PosScreen.tsx` (product tiles `:765-771`, cart `:866-867`, receipt payload `:477-504`), `SessionSalesPanel.tsx`, `ReceiptView.tsx`.
- **Documents:** `BusinessDocumentDetailModal.tsx`, `CustomerDocumentView.tsx`.
- **Inventory:** `InventoryScreen.tsx` (`:158-165`, qty + `base_unit_code`), `ZeroQuantityWarning.tsx`.
- **Procurement:** `PurchaseReceiptDetailModal.tsx`, `PurchaseItemPicker.tsx`, `PurchasesScreen.tsx`.
- **Catalogue:** `CatalogTable.tsx`, `CatalogScreen.tsx`, `CatalogPanel.tsx`.
- **Search:** `ItemSearchModal.tsx`, `AppShell.tsx` (global search result).
- **Historical (onboarding) screens:** `HistoricalAnalyticsDashboard.tsx`, `HistoricalFinanceScreen.tsx`, `HistoricalProductMappingScreen.tsx`, `HistoricalReportsScreen.tsx`, `HistoricalRowPreview.tsx`.
- **Other:** `PrintingSettingsScreen.tsx` (sample preview).

### 26. Where line quantity and unit are printed

- **Thermal sale receipt:** `src/features/pos/receiptBuilder.ts`. Here `qty: number` (`:13`), the line is printed as `` `${l.qty} x ${l.unitPrice}` `` (`:218, :232`), and **`totalItems = sum(l.qty)`** (`:241`). **No unit is printed.** Fed by `src/features/pos/printReceipt.ts:57, :106`.
- **Thermal void slip:** `src/features/pos/voidSlipBuilder.ts:16, :81` (`qty: string`, no unit).
- **A4 sale invoice:** `src/shared/documents/models/saleInvoiceModel.ts:11, :63, :69` (quantity column, **no unit column**).
- **A4 purchase receipt:** `src/shared/documents/models/purchaseReceiptModel.ts:10, :52, :58`, fed by `src/features/procurement/purchaseReceiptPrint.ts:48` (`quantity_received`).
- **Purchase receipt XLSX export:** `src/features/procurement/purchaseReceiptExport.ts:48-49, :87-88`. It has a `unitCode` column, but **`quantity: number`** (a JS float) at `:49`.
- **A4 void slip:** `src/shared/documents/models/saleVoidModel.ts:47, :53`.
- **Shared labels:** `src/shared/documents/models/shared.ts:11, :46, :81, :116` (`Quantité` / `الكمية` / `Quantity`).
- **Cash session report** (`sessionReportModel.ts`, `sessionReportBuilder.ts`): **no line quantities** (money only).
- **Purchase return A4:** no dedicated model found. Returns use the generic model or the business-document detail. Only the files above contain quantity columns.

### 27. WS-I reports and operational screens that show quantities — verified (DB) + verified (file)

- **There is no live-ledger "sales by product" or "stock report" function.** Report or analytics-like live functions (verified (DB)):
  - `inventory.list_inventory_snapshot(text,bigint,text,boolean)`: returns `quantity_on_hand`, `last_known_wac`, `total_value`, and `base_unit_code` from `variant.base_unit_id`. Used by `InventoryScreen.tsx`.
  - `catalog.list_products_v2` (two overloads with the same arity but a different argument order: `(text,bigint,text,bigint,boolean,integer,integer)` and `(text,bigint,bigint,bigint,text,boolean,integer,integer)`): returns `quantity_on_hand`, `sale_price`, `last_known_wac`.
  - `core.get_dashboard_summary(text,text)`: counts only.
  - `cash.get_session_report(text,bigint)`: money only.
  - `documents.get_business_document_reports(…)`: document list.
- **WS-I reports are historical-import only** (`20260829090000_ws_i_001_historical_core_reports.sql`). They read `onboarding.historical_trade_lines`, not live ledgers:
  - `onboarding.historical_report_sales(bigint,date,date)` sums `quantity` into `totalQuantity`.
  - `onboarding.historical_report_stock_valuation(bigint,date,date)` returns `quantity` and `unitCostDzd = round(value / quantity, 2)`.
  - The others: `…_purchases`, `…_monthly_rows`, `…_monthly_trend`, `…_profit_and_loss`, `…_sellers`, `…_supplier_debt_and_expenses`, `…_customer_debt`, plus the dispatcher `onboarding.get_historical_report(text,text,bigint,date,date)`.
  - Screen: `src/features/onboarding/HistoricalReportsScreen.tsx`.

---

## I. Data size (item 28) — verified (DB), **throwaway DB only**

```sql
SELECT 'catalog.products' AS tbl, count(*) FROM catalog.products
UNION ALL SELECT 'catalog.product_variants', count(*) FROM catalog.product_variants
UNION ALL SELECT 'catalog.variant_barcodes', count(*) FROM catalog.variant_barcodes
UNION ALL SELECT 'catalog.units', count(*) FROM catalog.units
UNION ALL SELECT 'catalog.variant_units', count(*) FROM catalog.variant_units
UNION ALL SELECT 'sales.cash_sales', count(*) FROM sales.cash_sales
UNION ALL SELECT 'sales.cash_sale_lines', count(*) FROM sales.cash_sale_lines
UNION ALL SELECT 'sales.credit_sales', count(*) FROM sales.credit_sales
UNION ALL SELECT 'sales.credit_sale_lines', count(*) FROM sales.credit_sale_lines
UNION ALL SELECT 'procurement.purchase_receipts', count(*) FROM procurement.purchase_receipts
UNION ALL SELECT 'procurement.purchase_receipt_lines', count(*) FROM procurement.purchase_receipt_lines
UNION ALL SELECT 'procurement.purchase_transactions', count(*) FROM procurement.purchase_transactions
UNION ALL SELECT 'procurement.purchase_transaction_lines', count(*) FROM procurement.purchase_transaction_lines
UNION ALL SELECT 'inventory.movements', count(*) FROM inventory.movements
UNION ALL SELECT 'inventory.positions', count(*) FROM inventory.positions;
```
```
                  tbl                   | count
----------------------------------------+-------
 catalog.products                       |     0
 catalog.product_variants               |     0
 catalog.variant_barcodes               |     0
 catalog.units                          |     1
 catalog.variant_units                  |     0
 sales.cash_sales                       |     0
 sales.cash_sale_lines                  |     0
 sales.credit_sales                     |     0
 sales.credit_sale_lines                |     0
 procurement.purchase_receipts          |     0
 procurement.purchase_receipt_lines     |     0
 procurement.purchase_transactions      |     0
 procurement.purchase_transaction_lines |     0
 inventory.movements                    |     0
 inventory.positions                    |     0
```
"Purchases" means `purchase_receipts` here, because that is what the live direct-purchase path writes. **These numbers are the empty seed state, not the shop.** The Owner should run the query above (and the item-5 query) on Windows, for example `psql -h localhost -p 5433 -d stockiha_acceptance -f counts.sql`, and paste the output back.

---

## J. Conflicts with the pack design (items 29–30)

### 29. Places that assume "one variant = one unit = one price"

**Database**
1. `catalog.product_variants.sale_price` is one column. There is no per-unit price anywhere, and `catalog.variant_units` has no price column. *verified (DB)*
2. `catalog.variant_barcodes` has no unit or quantity column, so every barcode means one base unit. The unique index is on `normalized_barcode` only. *verified (DB)*
3. `catalog.resolve_barcode` returns one `sale_price` and the product-level unit, and does not say which barcode matched. *verified (DB)*
4. `sales.cash_sale_lines` and `sales.credit_sale_lines` have no `unit_id`, no base quantity, and no conversion snapshot. `line_total = round(quantity * unit_price, 2)` is a CHECK. If a pack line stores pack quantity with pack price, it cannot also store the base quantity that stock needs. *verified (DB)*
5. `sales.confirm_cash_sale` and `sales.confirm_credit_sale` issue `-v_quantity` straight from the client quantity as base units, with no unit lookup and no conversion. *read but not executed*
6. `sales.void_sale` finds movements by `(reference_type, reference_id = document)`, with no line link. It will still reverse correctly if the sale writes base-quantity movements, but any per-line pack information is lost unless stored on the line. *read but not executed*
7. Idempotency hashes cover only today's line fields:
   - `receivables.credit_sale_payload_hash` normalizes each line to **exactly** `{variant_id, quantity, unit_price}` and drops any other key. A new `unit_id` would **not** be part of the fingerprint, so two different sales could hash equal. *read but not executed*
   - The cash sale hash is built in Rust from the serialized `CashSaleLineInput` (`application/cash_sale.rs:43-59`). A new field there flows into the hash automatically. *verified (file)*
8. `inventory.positions` is UNIQUE `(warehouse_id, variant_id)`, a single base-unit balance. That fits the design ("count in pieces"), but every quantity display reads it as a plain number plus `base_unit_code`. *verified (DB)*
9. `catalog.products.unit_id` and `catalog.product_variants.base_unit_id` are duplicated sources of truth, and different readers use different ones (item 3). `set_variant_base_unit` can split them with no stock guard. *verified (DB)*
10. `variant_units.conversion_factor` is lossy for `BASE_TO_ALT` (6-dp reciprocal), and it is what posting multiplies by. "1 piece = 1/12 box" entered the wrong way round produces `0.083333`, and 12 of those make `0.999996` pieces. `confirm_stock_adjustment` rejects that result (more than 3 dp); `confirm_direct_purchase` silently rounds it to 3 dp (`round(qty × factor, 3)`). *read but not executed*
11. `procurement.list_purchase_product_options` hardcodes `'alternate_units', '[]'`. *verified (DB)*
12. `procurement.post_purchase_transaction` has `COALESCE(unit_id, 1)`. It is unreachable today. *read but not executed*
13. `allows_fractions` is not enforced in SQL, so "whole boxes only" cannot be relied on at the posting boundary. *verified (DB)*

**Rust**
14. `CashSaleLineInput { variant_id, quantity, unit_price }` (`application/cash_sale.rs:20-24`), `CashSaleLineRequest` (`commands/cash_sale.rs:18-21`), and `CreditSaleLineInput` (`application/credit_sale.rs:10-14`) have no unit. *verified (file)*
15. The `ResolvedBarcode` struct (`application/catalog.rs:188`) has one `sale_price` and one `unit_id`. `ProductListItem` (`:14`, `sale_price` at `:22`) and `ProductListRowV2` / `ProductListItemV2` (`:749`, `:770`) each have a single `sale_price` (`:758`, `:779`). *verified (file)*

**TypeScript / React**
16. DTOs with a single price or unit: `ProductListItem.sale_price` (`dto.ts:33`), `CashSaleLineInput` (`dto.ts:168-171`), `ResolvedBarcode` (`dto.ts:187`), `VariantDetail.sale_price` (`dto.ts:204`), `ProductDetail.unit_id` (`dto.ts:205`, product-level), `ProductListItemV2.sale_price` (`dto.ts:842`), `CreditSaleLineInput` (`creditSaleDto.ts:1-4`). *verified (file)*
17. The POS cart is **keyed by `variantId`**. `addToCart` merges by `variant_id` (`PosScreen.tsx:340-342`), and `changeQty` (`:417`) and `removeLine` (`:425`) take a `variantId`. The same variant can never appear twice (for example once as a box and once as a piece). `qty: number` is a JS number (`:33`). *verified (file)*
18. POS barcode scan throws away the resolve result and re-looks-up by `variant_id` (`PosScreen.tsx:304-322`), so a pack barcode would add +1 piece at piece price. *verified (file)*
19. Thermal receipt: `qty: number` (`receiptBuilder.ts:13`), and `totalItems = Σ qty` (`:241`) would add boxes and pieces together. No unit is printed on any sale document. *verified (file)*
20. `purchaseReceiptExport.ts:49` `quantity: number` (a float in the XLSX export). `PurchasesScreen.tsx:232` uses `parseFloat` for cost validation. *verified (file)*
21. The message `catalog2.altUnitsNotAppliedYet` (`locales.ts:405, :1790`) will be false once packs are wired. It is already partly false today (item 2). *verified (file)*

### 30. Tests that pin quantity / price behaviour — verified (file)

The criterion was "the file mentions `unit_price|sale_price|conversion_factor|variant_units|quantity_on_hand|allows_fractions|resolve_barcode|last_known_wac`" for SQL, and `unitPrice|unit_price|sale_price|salePrice|qty|quantity|allowsFractions|conversion` for vitest.

**SQL / shell integration** (`src-tauri/tests/`):
- **cash**: `cash/s4_002_cash_session_ownership_integration.sql`, `cash/ws_f_003_sale_discount_integration.sql`, `cash/ws_m_003_session_report_integration.sql`
- **catalog**: `catalog/s2_001_catalog_integration.sql`, `catalog/ws_d_001_catalogue_foundation_integration.sql`
- **documents**: `documents/ws_l_001_journals_documents_integration.sql`
- **inventory**: `inventory/r8_d_catalog_inventory_integration.sql`, `inventory/s2_002_stock_adjustment_concurrency.sh`, `inventory/s2_002_stock_adjustment_integration.sql`, `inventory/s2_003_zero_quantity_safeguards_concurrency.sh`, `inventory/s2_003_zero_quantity_safeguards_integration.sql`
- **onboarding**: `onboarding/r0_002_historical_trade_staging_integration.sql`, `onboarding/r0_003_historical_expenses_benefit_integration.sql`, `onboarding/r0_004_historical_line_party_benefit_integration.sql`, `onboarding/r0_005_historical_product_alias_integration.sql`
- **procurement**: `procurement/direct_purchase_acceptance_integration.sql`, `procurement/r2_financial_semantics_integration.sql`, `procurement/r8_e_defect_repair_integration.sql`, `procurement/r8_e_procurement_integration.sql`, `procurement/s3_001_procurement_concurrency.sh`, `procurement/s3_001_procurement_integration.sql`, `procurement/s3_002_landed_cost_and_invoices_integration.sql`, `procurement/s3_003_supplier_returns_and_payments_integration.sql`, `procurement/ws_e_002_purchase_payment_integration.sql`, `procurement/ws_e_003_purchase_return_integration.sql`
- **receivables**: `receivables/s4_001_credit_concurrency.sh`, `receivables/s4_001_credit_sale_integration.sql`, `receivables/s4_001_customer_payment_integration.sql`, `receivables/s4_003_drawer_refund_integration.sql`
- **sales**: `sales/ws_f_004_credit_limit_warning_integration.sql`, `sales/ws_f_006_sale_void_integration.sql`

**Rust unit tests** (`#[cfg(test)]` modules in files that mention quantity, price, conversion or WAC):
- `application/`: `cash_sale.rs`, `catalog.rs`, `credit_sale.rs`, `inventory.rs`, `stock_adjustment.rs`, `stock_receipt.rs`, `setup.rs`
- `domain/`: `catalog.rs` (`base_quantity_*` at `:106-133`), `money.rs`, `residual.rs`, `sale.rs`, `sale_void.rs`, `stock.rs`, `procurement.rs`, `product.rs`

**Vitest** (`tests/`):
- **POS**: `pos-touch.workflow.test.tsx`, `pos-discount.workflow.test.tsx`, `pos-credit-limit.workflow.test.tsx`
- **Receipts and slips**: `receipt-builder.test.ts`, `void-slip-builder.test.ts`
- **Inventory**: `stock-receipt.workflow.test.tsx`, `stock-adjustment.workflow.test.tsx`, `unit-fractions.workflow.test.tsx`, `inventory.workflow.test.tsx`
- **Catalogue**: `catalog2.workflow.test.tsx`, `catalog.gateway.test.ts`, `products-list.decimal.test.ts`, `global-search.workflow.test.tsx`
- **Procurement**: `direct-purchase.workflow.test.tsx`, `direct-purchase-receipt-detail.workflow.test.tsx`, `procurement.workflow.test.tsx`, `purchase-return.workflow.test.tsx`
- **Cash, sales, customers**: `cash-session.workflow.test.tsx`, `session-sales-void.workflow.test.tsx`, `customers.workflow.test.tsx`, `customer-documents.workflow.test.tsx`
- **Documents**: `business-documents-detail-reports.workflow.test.tsx`, `official-document.test.ts`
- **Money and IPC**: `exactMoney.test.ts`, `ipc.gateway.test.ts`
- **Navigation**: `nav-role-based-access.workflow.test.tsx`
- **Historical import**: `historical-*.test.*` (five files)

---

## Commands run (literal)

Working directory `/home/user/Stockiha` unless stated.

```
$ which psql pg_ctl postgres initdb; ls /usr/lib/postgresql
/usr/bin/psql
16
$ pg_isready -h localhost -p 5433
localhost:5433 - no response
$ psql -h localhost -p 5433 -U postgres -d stockiha_acceptance -c 'select 1'
psql: error: connection to server at "localhost" (127.0.0.1), port 5433 failed: Connection refused
	Is the server running on that host and accepting TCP/IP connections?

# Throwaway cluster (outside the repo; the postgres OS user cannot traverse the scratchpad path)
$ D=/var/tmp/ws-o0-pg; mkdir -p $D && chown postgres $D && su postgres -c "/usr/lib/postgresql/16/bin/initdb -D $D/data -U postgres -A trust && /usr/lib/postgresql/16/bin/pg_ctl -D $D/data -o '-p 55433 -k $D' -l $D/pg.log start"
server started
$ psql -h /var/tmp/ws-o0-pg -p 55433 -U postgres -Atc 'select version()'
PostgreSQL 16.13 (Ubuntu 16.13-0ubuntu0.24.04.1) on x86_64-pc-linux-gnu, compiled by gcc (Ubuntu 13.3.0-6ubuntu2~24.04.1) 13.3.0, 64-bit
$ psql … -c 'create database stockiha_ws_o0_throwaway'
# Role bootstrap copied verbatim from .github/workflows/ci.yml lines 129-161 (database name substituted)
# Apply every migration, CI recipe (ci.yml lines 164-170):
$ find src-tauri/migrations -maxdepth 1 -type f -name '*.sql' | sort | while read m; do psql -X -q -d stockiha_ws_o0_throwaway -v ON_ERROR_STOP=1 -f "$m"; done
applied=160      (no failures)

# All subsequent queries: PGHOST=/var/tmp/ws-o0-pg PGPORT=55433 PGUSER=postgres PGDATABASE=stockiha_ws_o0_throwaway
$ psql -X -c "\d <table>"   for the 25 tables in Appendix A
$ psql -X -c "SELECT p.oid::regprocedure AS live_signature, p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('catalog','inventory','sales','procurement','cash','reporting','receivables') ORDER BY 1"      (178-line result)
$ psql -X -c "SELECT p.oid::regprocedure, p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND (p.prosrc ~* 'insert\s+into\s+inventory\.movements' OR p.prosrc ~* 'inventory\.positions' AND p.prosrc ~* '(update|insert\s+into)\s+inventory\.positions') ORDER BY 1"   (11 rows, item 23)
$ for pat in variant_units conversion_factor allows_fractions sale_price unit_price last_known_wac resolve_barcode; do psql -XAt -c "SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND p.prosrc ~ '$pat' ORDER BY 1"; done
$ psql -XAt -c "select pg_get_functiondef(<oid>)"   for every function in Appendix B
$ psql -X -c "select table_schema||'.'||table_name, column_name, data_type, numeric_precision, numeric_scale from information_schema.columns where table_schema not in ('pg_catalog','information_schema') and (column_name ~ 'price' or table_name ~ 'price') order by 1,2"
$ psql -X -c "… column_name ~ '(wac|unit_cost|cost_snapshot)' …"
$ psql -XAt -c "select column_name from information_schema.columns where table_schema='inventory' and table_name='positions' and column_name like '%wac%'"
last_known_wac
$ psql -XAt -c "select string_agg(column_name,',') from information_schema.columns where table_schema='inventory' and table_name='movements'"
id,warehouse_id,variant_id,movement_type,quantity_delta,inventory_value_delta,resulting_quantity_on_hand,resulting_total_value,reference_type,reference_id,created_at
$ psql -X -f q_units.sql ; psql -X -f q_counts.sql      (items 5 and 28, outputs above)

# Source searches (Grep tool / grep -rn), e.g.:
$ grep -rniE "\b(factor|conversion|ratio|pack|packs|packaging|box|boxes|carton|base_unit|baseunit|base_quantity|pieces)\w*" src-tauri/migrations src-tauri/src src --include=*.sql --include=*.rs --include=*.ts --include=*.tsx | grep -viE "package|checkbox|Box<|Box::|box-?shadow|boxShadow|boxSizing|box-sizing|inbox|sandbox|textbox|listbox|combobox|bounding|flexbox|\bpackage|opening_state_package|historical_package|backup_package|Box\.new|alertbox|\bbox\b.*(style|css|className)|ration_|aspect-ratio|aspectRatio|OWNERSHIP_RATIO|compression"   (349 lines, Appendix C)
$ grep -rn "post_purchase_transaction" src-tauri/src/lib.rs src-tauri/src/commands/*.rs      (no output)
$ grep -rn "postPurchaseTransaction\|confirmSupplierReturn" src --include=*.tsx --include=*.ts | grep -v gateway.ts   (no output)
$ grep -rn "setVariantBaseUnit" src --include=*.tsx      (no output)
```

The throwaway cluster was stopped and deleted after the report was written. No write was made to any database other than the throwaway one (DDL from migrations plus the CI role bootstrap). No repository code was changed.

## Could not verify

1. **Everything against `stockiha_acceptance`**: it is unreachable from this environment (error above). In particular:
   - the real `catalog.units` rows (item 5);
   - the real row counts (item 28);
   - whether the acceptance DB is at migration `20260925090000`. Run `SELECT max(version) FROM public._sqlx_migrations;` on Windows; it should be `20260925090000`.
2. **PostgreSQL 18 behaviour**: the throwaway server is 16.13. `\d` and `pg_get_functiondef` output is not version-sensitive for these objects, but that is not proven here.
3. **Runtime failure of `inventory.confirm_supplier_return`**: established by comparing its column names with the live table (verified (DB)), not by calling it. Calling it would need writes. plpgsql checks column names only at execution, which is why the migration applied cleanly.
4. **Runtime rounding behaviour** (for example `BASE_TO_ALT` × 12 giving `0.999996`; see item 29 #10): derived by reading the function bodies and doing the arithmetic, not by posting data.
5. **Which `catalog.list_products_v2` overload the POS resolves to**: Rust `application/catalog.rs:1219` calls an 8-parameter form, and two 8-parameter overloads with different argument orders exist. Not traced further; out of O-0 scope.
6. Whether any **Windows-only** path (for example the printed thermal output) formats quantities differently from the TS builders read here.

---

# Appendix A — full `\d` output (verified (DB), throwaway DB)

```
=================== \d catalog.units
                                       Table "catalog.units"
      Column      |           Type           | Collation | Nullable |           Default
------------------+--------------------------+-----------+----------+------------------------------
 id               | bigint                   |           | not null | generated always as identity
 code             | text                     |           | not null |
 normalized_code  | text                     |           | not null |
 name             | text                     |           | not null |
 created_at       | timestamp with time zone |           | not null | now()
 updated_at       | timestamp with time zone |           | not null | now()
 is_active        | boolean                  |           | not null | true
 allows_fractions | boolean                  |           | not null | true
Indexes:
    "units_pkey" PRIMARY KEY, btree (id)
    "units_normalized_code_unique" UNIQUE CONSTRAINT, btree (normalized_code)
Check constraints:
    "units_code_not_blank" CHECK (btrim(code) <> ''::text)
    "units_name_not_blank" CHECK (btrim(name) <> ''::text)
    "units_normalized_code_not_blank" CHECK (normalized_code <> ''::text)
Referenced by:
    TABLE "catalog.product_variants" CONSTRAINT "product_variants_base_unit_id_fkey" FOREIGN KEY (base_unit_id) REFERENCES catalog.units(id)
    TABLE "catalog.products" CONSTRAINT "products_unit_id_fkey" FOREIGN KEY (unit_id) REFERENCES catalog.units(id)
    TABLE "procurement.purchase_order_lines" CONSTRAINT "purchase_order_lines_unit_id_fkey" FOREIGN KEY (unit_id) REFERENCES catalog.units(id)
    TABLE "procurement.purchase_receipt_lines" CONSTRAINT "purchase_receipt_lines_unit_id_fkey" FOREIGN KEY (unit_id) REFERENCES catalog.units(id)
    TABLE "procurement.purchase_return_lines" CONSTRAINT "purchase_return_lines_unit_id_fkey" FOREIGN KEY (unit_id) REFERENCES catalog.units(id) ON DELETE RESTRICT
    TABLE "procurement.purchase_transaction_lines" CONSTRAINT "purchase_transaction_lines_unit_id_fkey" FOREIGN KEY (unit_id) REFERENCES catalog.units(id)
    TABLE "inventory.stock_adjustments" CONSTRAINT "stock_adjustments_input_unit_id_fkey" FOREIGN KEY (input_unit_id) REFERENCES catalog.units(id)
    TABLE "catalog.variant_units" CONSTRAINT "variant_units_unit_id_fkey" FOREIGN KEY (unit_id) REFERENCES catalog.units(id)
Triggers:
    units_set_updated_at BEFORE UPDATE ON catalog.units FOR EACH ROW EXECUTE FUNCTION core.set_updated_at()

=================== \d catalog.variant_units
                                     Table "catalog.variant_units"
        Column        |           Type           | Collation | Nullable |           Default
----------------------+--------------------------+-----------+----------+------------------------------
 id                   | bigint                   |           | not null | generated always as identity
 variant_id           | bigint                   |           | not null |
 unit_id              | bigint                   |           | not null |
 conversion_factor    | numeric(20,6)            |           | not null |
 created_at           | timestamp with time zone |           | not null | now()
 updated_at           | timestamp with time zone |           | not null | now()
 conversion_direction | text                     |           | not null |
 conversion_quantity  | numeric(20,6)            |           | not null |
Indexes:
    "variant_units_pkey" PRIMARY KEY, btree (id)
    "variant_units_unique" UNIQUE CONSTRAINT, btree (variant_id, unit_id)
    "variant_units_variant_idx" btree (variant_id)
Check constraints:
    "variant_units_conversion_direction_check" CHECK (conversion_direction = ANY (ARRAY['ALT_TO_BASE'::text, 'BASE_TO_ALT'::text]))
    "variant_units_conversion_quantity_positive" CHECK (conversion_quantity > 0::numeric)
    "variant_units_factor_positive" CHECK (conversion_factor > 0::numeric)
Foreign-key constraints:
    "variant_units_unit_id_fkey" FOREIGN KEY (unit_id) REFERENCES catalog.units(id)
    "variant_units_variant_id_fkey" FOREIGN KEY (variant_id) REFERENCES catalog.product_variants(id)
Triggers:
    variant_units_set_updated_at BEFORE UPDATE ON catalog.variant_units FOR EACH ROW EXECUTE FUNCTION core.set_updated_at()

=================== \d catalog.products
                                      Table "catalog.products"
   Column    |           Type           | Collation | Nullable |              Default
-------------+--------------------------+-----------+----------+------------------------------------
 id          | bigint                   |           | not null | generated always as identity
 name        | text                     |           | not null |
 is_active   | boolean                  |           | not null | true
 created_at  | timestamp with time zone |           | not null | now()
 updated_at  | timestamp with time zone |           | not null | now()
 brand_id    | bigint                   |           |          |
 unit_id     | bigint                   |           | not null | catalog._default_product_unit_id()
 category_id | bigint                   |           |          |
Indexes:
    "products_pkey" PRIMARY KEY, btree (id)
    "idx_products_brand_id" btree (brand_id)
    "idx_products_category_id" btree (category_id)
    "idx_products_name_trgm" gin (name gin_trgm_ops)
Check constraints:
    "products_name_not_blank" CHECK (btrim(name) <> ''::text)
Foreign-key constraints:
    "products_brand_id_fkey" FOREIGN KEY (brand_id) REFERENCES catalog.brands(id)
    "products_category_id_fkey" FOREIGN KEY (category_id) REFERENCES catalog.categories(id)
    "products_unit_id_fkey" FOREIGN KEY (unit_id) REFERENCES catalog.units(id)
Referenced by:
    TABLE "onboarding.historical_trade_lines" CONSTRAINT "historical_trade_lines_matched_product_id_fkey" FOREIGN KEY (matched_product_id) REFERENCES catalog.products(id) ON DELETE SET NULL
    TABLE "catalog.product_variants" CONSTRAINT "product_variants_product_id_fkey" FOREIGN KEY (product_id) REFERENCES catalog.products(id)
Triggers:
    products_set_updated_at BEFORE UPDATE ON catalog.products FOR EACH ROW EXECUTE FUNCTION core.set_updated_at()

=================== \d catalog.product_variants
                                   Table "catalog.product_variants"
       Column        |           Type           | Collation | Nullable |           Default
---------------------+--------------------------+-----------+----------+------------------------------
 id                  | bigint                   |           | not null | generated always as identity
 product_id          | bigint                   |           | not null |
 sku                 | text                     |           | not null |
 sale_price          | numeric(14,2)            |           | not null |
 is_active           | boolean                  |           | not null | true
 created_at          | timestamp with time zone |           | not null | now()
 updated_at          | timestamp with time zone |           | not null | now()
 base_unit_id        | bigint                   |           | not null |
 attribute_signature | text                     |           | not null | ''::text
 name_override       | text                     |           |          |
 minimum_stock       | numeric                  |           | not null | 0
Indexes:
    "product_variants_pkey" PRIMARY KEY, btree (id)
    "idx_product_variants_name_override_trgm" gin (name_override gin_trgm_ops) WHERE name_override IS NOT NULL
    "idx_product_variants_product_id" btree (product_id)
    "idx_product_variants_sku_trgm" gin (sku gin_trgm_ops)
    "product_variants_combo_unique" UNIQUE CONSTRAINT, btree (product_id, attribute_signature)
    "product_variants_sku_unique" UNIQUE CONSTRAINT, btree (sku)
Check constraints:
    "product_variants_minimum_stock_non_negative" CHECK (minimum_stock >= 0::numeric)
    "product_variants_sale_price_non_negative" CHECK (sale_price >= 0::numeric)
    "product_variants_sku_not_blank" CHECK (btrim(sku) <> ''::text)
Foreign-key constraints:
    "product_variants_base_unit_id_fkey" FOREIGN KEY (base_unit_id) REFERENCES catalog.units(id)
    "product_variants_product_id_fkey" FOREIGN KEY (product_id) REFERENCES catalog.products(id)
Referenced by:
    TABLE "sales.cash_sale_lines" CONSTRAINT "cash_sale_lines_variant_id_fkey" FOREIGN KEY (variant_id) REFERENCES catalog.product_variants(id)
    TABLE "sales.credit_sale_lines" CONSTRAINT "credit_sale_lines_variant_id_fkey" FOREIGN KEY (variant_id) REFERENCES catalog.product_variants(id)
    TABLE "inventory.movements" CONSTRAINT "movements_variant_id_fkey" FOREIGN KEY (variant_id) REFERENCES catalog.product_variants(id)
    TABLE "inventory.positions" CONSTRAINT "positions_variant_id_fkey" FOREIGN KEY (variant_id) REFERENCES catalog.product_variants(id)
    TABLE "procurement.purchase_order_lines" CONSTRAINT "purchase_order_lines_variant_id_fkey" FOREIGN KEY (variant_id) REFERENCES catalog.product_variants(id)
    TABLE "procurement.purchase_receipt_lines" CONSTRAINT "purchase_receipt_lines_variant_id_fkey" FOREIGN KEY (variant_id) REFERENCES catalog.product_variants(id)
    TABLE "procurement.purchase_return_lines" CONSTRAINT "purchase_return_lines_variant_id_fkey" FOREIGN KEY (variant_id) REFERENCES catalog.product_variants(id) ON DELETE RESTRICT
    TABLE "procurement.purchase_transaction_lines" CONSTRAINT "purchase_transaction_lines_variant_id_fkey" FOREIGN KEY (variant_id) REFERENCES catalog.product_variants(id)
    TABLE "inventory.receipt_cost_attribution" CONSTRAINT "receipt_cost_attribution_variant_id_fkey" FOREIGN KEY (variant_id) REFERENCES catalog.product_variants(id) ON DELETE RESTRICT
    TABLE "inventory.residual_clearances" CONSTRAINT "residual_clearances_variant_id_fkey" FOREIGN KEY (variant_id) REFERENCES catalog.product_variants(id)
    TABLE "inventory.stock_adjustments" CONSTRAINT "stock_adjustments_variant_id_fkey" FOREIGN KEY (variant_id) REFERENCES catalog.product_variants(id)
    TABLE "procurement.supplier_invoice_lines" CONSTRAINT "supplier_invoice_lines_variant_id_fkey" FOREIGN KEY (variant_id) REFERENCES catalog.product_variants(id) ON DELETE RESTRICT
    TABLE "procurement.supplier_return_lines" CONSTRAINT "supplier_return_lines_variant_id_fkey" FOREIGN KEY (variant_id) REFERENCES catalog.product_variants(id) ON DELETE RESTRICT
    TABLE "catalog.variant_attribute_values" CONSTRAINT "variant_attribute_values_variant_id_fkey" FOREIGN KEY (variant_id) REFERENCES catalog.product_variants(id)
    TABLE "catalog.variant_barcodes" CONSTRAINT "variant_barcodes_variant_id_fkey" FOREIGN KEY (variant_id) REFERENCES catalog.product_variants(id)
    TABLE "catalog.variant_units" CONSTRAINT "variant_units_variant_id_fkey" FOREIGN KEY (variant_id) REFERENCES catalog.product_variants(id)
Triggers:
    product_variants_set_updated_at BEFORE UPDATE ON catalog.product_variants FOR EACH ROW EXECUTE FUNCTION core.set_updated_at()

=================== \d catalog.variant_barcodes
                                  Table "catalog.variant_barcodes"
       Column       |           Type           | Collation | Nullable |           Default
--------------------+--------------------------+-----------+----------+------------------------------
 id                 | bigint                   |           | not null | generated always as identity
 variant_id         | bigint                   |           | not null |
 barcode            | text                     |           | not null |
 normalized_barcode | text                     |           | not null |
 created_at         | timestamp with time zone |           | not null | now()
 is_primary         | boolean                  |           | not null | false
Indexes:
    "variant_barcodes_pkey" PRIMARY KEY, btree (id)
    "idx_variant_barcodes_barcode_trgm" gin (barcode gin_trgm_ops)
    "variant_barcodes_normalized_unique" UNIQUE CONSTRAINT, btree (normalized_barcode)
    "variant_barcodes_primary_unique" UNIQUE, btree (variant_id) WHERE is_primary = true
    "variant_barcodes_variant_idx" btree (variant_id)
Check constraints:
    "variant_barcodes_normalized_not_blank" CHECK (normalized_barcode <> ''::text)
    "variant_barcodes_not_blank" CHECK (btrim(barcode) <> ''::text)
Foreign-key constraints:
    "variant_barcodes_variant_id_fkey" FOREIGN KEY (variant_id) REFERENCES catalog.product_variants(id)

=================== \d inventory.positions
                                    Table "inventory.positions"
      Column      |           Type           | Collation | Nullable |           Default
------------------+--------------------------+-----------+----------+------------------------------
 id               | bigint                   |           | not null | generated always as identity
 warehouse_id     | bigint                   |           | not null |
 variant_id       | bigint                   |           | not null |
 quantity_on_hand | numeric(18,3)            |           | not null | 0
 total_value      | numeric(18,4)            |           | not null | 0
 last_known_wac   | numeric(18,6)            |           | not null | 0
 updated_at       | timestamp with time zone |           | not null | now()
Indexes:
    "positions_pkey" PRIMARY KEY, btree (id)
    "positions_scope_unique" UNIQUE CONSTRAINT, btree (warehouse_id, variant_id)
Check constraints:
    "positions_quantity_non_negative" CHECK (quantity_on_hand >= 0::numeric)
    "positions_value_non_negative" CHECK (total_value >= 0::numeric)
    "positions_wac_non_negative" CHECK (last_known_wac >= 0::numeric)
    "positions_zero_quantity_zero_value" CHECK (quantity_on_hand > 0::numeric OR total_value = 0::numeric)
Foreign-key constraints:
    "positions_variant_id_fkey" FOREIGN KEY (variant_id) REFERENCES catalog.product_variants(id)
    "positions_warehouse_id_fkey" FOREIGN KEY (warehouse_id) REFERENCES inventory.warehouses(id)
Triggers:
    positions_set_updated_at BEFORE UPDATE ON inventory.positions FOR EACH ROW EXECUTE FUNCTION core.set_updated_at()

=================== \d inventory.movements
                                         Table "inventory.movements"
           Column           |           Type           | Collation | Nullable |           Default
----------------------------+--------------------------+-----------+----------+------------------------------
 id                         | bigint                   |           | not null | generated always as identity
 warehouse_id               | bigint                   |           | not null |
 variant_id                 | bigint                   |           | not null |
 movement_type              | text                     |           | not null |
 quantity_delta             | numeric(18,3)            |           | not null |
 inventory_value_delta      | numeric(18,4)            |           | not null |
 resulting_quantity_on_hand | numeric(18,3)            |           | not null |
 resulting_total_value      | numeric(18,4)            |           | not null |
 reference_type             | text                     |           |          |
 reference_id               | bigint                   |           |          |
 created_at                 | timestamp with time zone |           | not null | now()
Indexes:
    "movements_pkey" PRIMARY KEY, btree (id)
Check constraints:
    "movements_cost_only_requires_stock" CHECK (quantity_delta <> 0::numeric OR resulting_quantity_on_hand > 0::numeric OR movement_type = 'RESIDUAL_CLEARANCE'::text AND quantity_delta = 0::numeric AND resulting_quantity_on_hand = 0::numeric)
    "movements_movement_type_valid" CHECK (movement_type = ANY (ARRAY['RECEIPT'::text, 'ISSUE'::text, 'ADJUSTMENT'::text, 'COST_ONLY'::text, 'RESIDUAL_CLEARANCE'::text]))
    "movements_resulting_quantity_non_negative" CHECK (resulting_quantity_on_hand >= 0::numeric)
    "movements_resulting_value_non_negative" CHECK (resulting_total_value >= 0::numeric)
    "movements_zero_quantity_zero_value" CHECK (resulting_quantity_on_hand > 0::numeric OR resulting_total_value = 0::numeric)
Foreign-key constraints:
    "movements_variant_id_fkey" FOREIGN KEY (variant_id) REFERENCES catalog.product_variants(id)
    "movements_warehouse_id_fkey" FOREIGN KEY (warehouse_id) REFERENCES inventory.warehouses(id)
Referenced by:
    TABLE "procurement.purchase_receipt_lines" CONSTRAINT "purchase_receipt_lines_movement_id_fkey" FOREIGN KEY (movement_id) REFERENCES inventory.movements(id)
    TABLE "procurement.purchase_return_lines" CONSTRAINT "purchase_return_lines_movement_id_fkey" FOREIGN KEY (movement_id) REFERENCES inventory.movements(id) ON DELETE RESTRICT
    TABLE "inventory.residual_clearances" CONSTRAINT "residual_clearances_clearing_movement_id_fkey" FOREIGN KEY (clearing_movement_id) REFERENCES inventory.movements(id)
    TABLE "inventory.residual_clearances" CONSTRAINT "residual_clearances_source_movement_id_fkey" FOREIGN KEY (source_movement_id) REFERENCES inventory.movements(id)
    TABLE "inventory.stock_adjustments" CONSTRAINT "stock_adjustments_movement_id_fkey" FOREIGN KEY (movement_id) REFERENCES inventory.movements(id)
Triggers:
    movements_forbid_delete BEFORE DELETE ON inventory.movements FOR EACH ROW EXECUTE FUNCTION inventory.forbid_movement_mutation()
    movements_forbid_update BEFORE UPDATE ON inventory.movements FOR EACH ROW EXECUTE FUNCTION inventory.forbid_movement_mutation()

=================== \d inventory.stock_adjustments
                        Table "inventory.stock_adjustments"
        Column         |           Type           | Collation | Nullable | Default
-----------------------+--------------------------+-----------+----------+---------
 document_id           | bigint                   |           | not null |
 warehouse_id          | bigint                   |           | not null |
 variant_id            | bigint                   |           | not null |
 input_unit_id         | bigint                   |           | not null |
 input_quantity_delta  | numeric(18,3)            |           | not null |
 conversion_factor     | numeric(20,6)            |           | not null |
 quantity_delta        | numeric(18,3)            |           | not null |
 wac_snapshot          | numeric(18,6)            |           | not null |
 inventory_value_delta | numeric(18,4)            |           | not null |
 reason_code           | text                     |           | not null |
 note                  | text                     |           |          |
 movement_id           | bigint                   |           | not null |
 journal_document_id   | bigint                   |           |          |
 posted_by_user_id     | bigint                   |           | not null |
 workstation_id        | text                     |           | not null |
 created_at            | timestamp with time zone |           | not null | now()
Indexes:
    "stock_adjustments_pkey" PRIMARY KEY, btree (document_id)
    "stock_adjustments_journal_document_id_key" UNIQUE CONSTRAINT, btree (journal_document_id)
    "stock_adjustments_movement_id_key" UNIQUE CONSTRAINT, btree (movement_id)
Check constraints:
    "stock_adjustments_base_delta_nonzero" CHECK (quantity_delta <> 0::numeric)
    "stock_adjustments_direction_matches" CHECK (input_quantity_delta > 0::numeric AND quantity_delta > 0::numeric AND inventory_value_delta >= 0::numeric OR input_quantity_delta < 0::numeric AND quantity_delta < 0::numeric AND inventory_value_delta <= 0::numeric)
    "stock_adjustments_factor_positive" CHECK (conversion_factor > 0::numeric)
    "stock_adjustments_input_delta_nonzero" CHECK (input_quantity_delta <> 0::numeric)
    "stock_adjustments_note_normalized" CHECK (note IS NULL OR note = btrim(note))
    "stock_adjustments_other_note_required" CHECK (reason_code <> 'OTHER'::text OR btrim(COALESCE(note, ''::text)) <> ''::text)
    "stock_adjustments_reason_valid" CHECK (reason_code = ANY (ARRAY['DAMAGE'::text, 'SHRINKAGE'::text, 'EXPIRED'::text, 'FOUND_STOCK'::text, 'RECORDING_ERROR'::text, 'OTHER'::text]))
    "stock_adjustments_wac_non_negative" CHECK (wac_snapshot >= 0::numeric)
    "stock_adjustments_workstation_not_blank" CHECK (btrim(workstation_id) <> ''::text)
Foreign-key constraints:
    "stock_adjustments_document_id_fkey" FOREIGN KEY (document_id) REFERENCES core.business_documents(id)
    "stock_adjustments_input_unit_id_fkey" FOREIGN KEY (input_unit_id) REFERENCES catalog.units(id)
    "stock_adjustments_journal_document_id_fkey" FOREIGN KEY (journal_document_id) REFERENCES finance.journal_entries(document_id)
    "stock_adjustments_movement_id_fkey" FOREIGN KEY (movement_id) REFERENCES inventory.movements(id)
    "stock_adjustments_posted_by_user_id_fkey" FOREIGN KEY (posted_by_user_id) REFERENCES iam.users(id)
    "stock_adjustments_variant_id_fkey" FOREIGN KEY (variant_id) REFERENCES catalog.product_variants(id)
    "stock_adjustments_warehouse_id_fkey" FOREIGN KEY (warehouse_id) REFERENCES inventory.warehouses(id)
Triggers:
    stock_adjustments_forbid_delete BEFORE DELETE ON inventory.stock_adjustments FOR EACH ROW EXECUTE FUNCTION inventory.forbid_stock_adjustment_mutation()
    stock_adjustments_forbid_update BEFORE UPDATE ON inventory.stock_adjustments FOR EACH ROW EXECUTE FUNCTION inventory.forbid_stock_adjustment_mutation()

=================== \d inventory.receipt_cost_attribution
                                   Table "inventory.receipt_cost_attribution"
            Column             |           Type           | Collation | Nullable |           Default
-------------------------------+--------------------------+-----------+----------+------------------------------
 id                            | bigint                   |           | not null | generated always as identity
 receipt_line_id               | bigint                   |           | not null |
 variant_id                    | bigint                   |           | not null |
 warehouse_id                  | bigint                   |           | not null |
 original_quantity             | numeric(14,3)            |           | not null |
 attributed_remaining_quantity | numeric(14,3)            |           | not null |
 original_unit_cost            | numeric(14,2)            |           | not null |
 late_cost_allocated           | numeric(14,2)            |           | not null | 0.00
 created_at                    | timestamp with time zone |           | not null | now()
 updated_at                    | timestamp with time zone |           | not null | now()
Indexes:
    "receipt_cost_attribution_pkey" PRIMARY KEY, btree (id)
    "idx_receipt_cost_attr_line" btree (receipt_line_id)
    "idx_receipt_cost_attr_var_wh" btree (variant_id, warehouse_id)
Check constraints:
    "receipt_cost_attribution_attributed_remaining_quantity_check" CHECK (attributed_remaining_quantity >= 0::numeric)
    "receipt_cost_attribution_late_cost_allocated_check" CHECK (late_cost_allocated >= 0::numeric)
    "receipt_cost_attribution_original_quantity_check" CHECK (original_quantity > 0::numeric)
    "receipt_cost_attribution_original_unit_cost_check" CHECK (original_unit_cost >= 0::numeric)
Foreign-key constraints:
    "receipt_cost_attribution_receipt_line_id_fkey" FOREIGN KEY (receipt_line_id) REFERENCES procurement.purchase_receipt_lines(id) ON DELETE RESTRICT
    "receipt_cost_attribution_variant_id_fkey" FOREIGN KEY (variant_id) REFERENCES catalog.product_variants(id) ON DELETE RESTRICT
    "receipt_cost_attribution_warehouse_id_fkey" FOREIGN KEY (warehouse_id) REFERENCES inventory.warehouses(id) ON DELETE RESTRICT

=================== \d inventory.residual_clearances
                                     Table "inventory.residual_clearances"
            Column            |           Type           | Collation | Nullable |           Default
------------------------------+--------------------------+-----------+----------+------------------------------
 id                           | bigint                   |           | not null | generated always as identity
 warehouse_id                 | bigint                   |           | not null |
 variant_id                   | bigint                   |           | not null |
 source_movement_id           | bigint                   |           | not null |
 detected_residual_value      | numeric(18,4)            |           | not null |
 clearing_movement_id         | bigint                   |           | not null |
 clearing_journal_document_id | bigint                   |           |          |
 created_at                   | timestamp with time zone |           | not null | now()
Indexes:
    "residual_clearances_pkey" PRIMARY KEY, btree (id)
    "residual_clearances_clearing_journal_document_id_key" UNIQUE CONSTRAINT, btree (clearing_journal_document_id)
    "residual_clearances_clearing_movement_id_key" UNIQUE CONSTRAINT, btree (clearing_movement_id)
    "residual_clearances_source_movement_id_key" UNIQUE CONSTRAINT, btree (source_movement_id)
Check constraints:
    "residual_clearances_detected_nonzero" CHECK (abs(detected_residual_value) > 0::numeric)
    "residual_clearances_detected_sub_centime" CHECK (abs(detected_residual_value) < 0.01)
Foreign-key constraints:
    "residual_clearances_clearing_journal_document_id_fkey" FOREIGN KEY (clearing_journal_document_id) REFERENCES finance.journal_entries(document_id)
    "residual_clearances_clearing_movement_id_fkey" FOREIGN KEY (clearing_movement_id) REFERENCES inventory.movements(id)
    "residual_clearances_source_movement_id_fkey" FOREIGN KEY (source_movement_id) REFERENCES inventory.movements(id)
    "residual_clearances_variant_id_fkey" FOREIGN KEY (variant_id) REFERENCES catalog.product_variants(id)
    "residual_clearances_warehouse_id_fkey" FOREIGN KEY (warehouse_id) REFERENCES inventory.warehouses(id)
Triggers:
    residual_clearances_forbid_delete BEFORE DELETE ON inventory.residual_clearances FOR EACH ROW EXECUTE FUNCTION inventory.forbid_residual_clearance_mutation()
    residual_clearances_forbid_update BEFORE UPDATE ON inventory.residual_clearances FOR EACH ROW EXECUTE FUNCTION inventory.forbid_residual_clearance_mutation()

=================== \d procurement.purchase_transactions
                           Table "procurement.purchase_transactions"
              Column               |           Type           | Collation | Nullable | Default
-----------------------------------+--------------------------+-----------+----------+---------
 document_id                       | bigint                   |           | not null |
 supplier_id                       | bigint                   |           | not null |
 warehouse_id                      | bigint                   |           | not null |
 external_supplier_document_number | text                     |           |          |
 payment_status                    | text                     |           | not null |
 payment_method                    | text                     |           |          |
 gross_subtotal                    | numeric(14,2)            |           | not null |
 discount_amount                   | numeric(14,2)            |           | not null | 0
 tax_amount                        | numeric(14,2)            |           | not null | 0
 additional_cost_amount            | numeric(14,2)            |           | not null | 0
 total_amount                      | numeric(14,2)            |           | not null |
 paid_amount                       | numeric(14,2)            |           | not null | 0
 outstanding_amount                | numeric(14,2)            |           | not null | 0
 due_date                          | date                     |           |          |
 purchase_order_id                 | bigint                   |           | not null |
 goods_receipt_id                  | bigint                   |           | not null |
 supplier_invoice_id               | bigint                   |           | not null |
 supplier_payment_id               | bigint                   |           |          |
 note                              | text                     |           |          |
 supplier_snapshot                 | jsonb                    |           | not null |
 created_at                        | timestamp with time zone |           | not null | now()
 updated_at                        | timestamp with time zone |           | not null | now()
Indexes:
    "purchase_transactions_pkey" PRIMARY KEY, btree (document_id)
    "idx_purchase_transactions_external_doc" btree (supplier_id, external_supplier_document_number)
    "idx_purchase_transactions_supplier" btree (supplier_id)
    "purchase_transactions_supplier_doc_unique" UNIQUE CONSTRAINT, btree (supplier_id, external_supplier_document_number)
Check constraints:
    "purchase_transactions_additional_cost_amount_check" CHECK (additional_cost_amount >= 0::numeric)
    "purchase_transactions_discount_amount_check" CHECK (discount_amount >= 0::numeric)
    "purchase_transactions_gross_subtotal_check" CHECK (gross_subtotal >= 0::numeric)
    "purchase_transactions_outstanding_amount_check" CHECK (outstanding_amount >= 0::numeric)
    "purchase_transactions_paid_amount_check" CHECK (paid_amount >= 0::numeric)
    "purchase_transactions_payment_method_check" CHECK (payment_method IS NULL OR (payment_method = ANY (ARRAY['CASH'::text, 'BANK_TRANSFER'::text])))
    "purchase_transactions_payment_status_check" CHECK (payment_status = ANY (ARRAY['PAID'::text, 'PARTIALLY_PAID'::text, 'UNPAID'::text]))
    "purchase_transactions_tax_amount_check" CHECK (tax_amount >= 0::numeric)
    "purchase_transactions_total_amount_check" CHECK (total_amount >= 0::numeric)
Foreign-key constraints:
    "purchase_transactions_document_id_fkey" FOREIGN KEY (document_id) REFERENCES core.business_documents(id)
    "purchase_transactions_goods_receipt_id_fkey" FOREIGN KEY (goods_receipt_id) REFERENCES core.business_documents(id)
    "purchase_transactions_purchase_order_id_fkey" FOREIGN KEY (purchase_order_id) REFERENCES core.business_documents(id)
    "purchase_transactions_supplier_id_fkey" FOREIGN KEY (supplier_id) REFERENCES procurement.suppliers(id)
    "purchase_transactions_supplier_invoice_id_fkey" FOREIGN KEY (supplier_invoice_id) REFERENCES core.business_documents(id)
    "purchase_transactions_supplier_payment_id_fkey" FOREIGN KEY (supplier_payment_id) REFERENCES core.business_documents(id)
    "purchase_transactions_warehouse_id_fkey" FOREIGN KEY (warehouse_id) REFERENCES inventory.warehouses(id)
Referenced by:
    TABLE "procurement.purchase_transaction_lines" CONSTRAINT "purchase_transaction_lines_document_id_fkey" FOREIGN KEY (document_id) REFERENCES procurement.purchase_transactions(document_id) ON DELETE CASCADE

=================== \d procurement.purchase_transaction_lines
                             Table "procurement.purchase_transaction_lines"
        Column         |           Type           | Collation | Nullable |           Default
-----------------------+--------------------------+-----------+----------+------------------------------
 id                    | bigint                   |           | not null | generated always as identity
 document_id           | bigint                   |           | not null |
 line_number           | integer                  |           | not null |
 variant_id            | bigint                   |           | not null |
 unit_id               | bigint                   |           | not null |
 quantity              | numeric(18,3)            |           | not null |
 unit_cost             | numeric(18,6)            |           | not null |
 gross_amount          | numeric(14,2)            |           | not null |
 discount_amount       | numeric(14,2)            |           | not null | 0
 tax_amount            | numeric(14,2)            |           | not null | 0
 line_total            | numeric(14,2)            |           | not null |
 sku_snapshot          | text                     |           | not null |
 product_name_snapshot | text                     |           | not null |
 brand_snapshot        | text                     |           |          |
 attributes_snapshot   | jsonb                    |           | not null | '[]'::jsonb
 unit_code_snapshot    | text                     |           | not null |
 created_at            | timestamp with time zone |           | not null | now()
Indexes:
    "purchase_transaction_lines_pkey" PRIMARY KEY, btree (id)
    "idx_purchase_transaction_lines_doc" btree (document_id)
    "purchase_transaction_lines_line_number_unique" UNIQUE CONSTRAINT, btree (document_id, line_number)
Check constraints:
    "purchase_transaction_lines_discount_amount_check" CHECK (discount_amount >= 0::numeric)
    "purchase_transaction_lines_gross_amount_check" CHECK (gross_amount >= 0::numeric)
    "purchase_transaction_lines_line_total_check" CHECK (line_total >= 0::numeric)
    "purchase_transaction_lines_quantity_check" CHECK (quantity > 0::numeric)
    "purchase_transaction_lines_tax_amount_check" CHECK (tax_amount >= 0::numeric)
    "purchase_transaction_lines_unit_cost_check" CHECK (unit_cost >= 0::numeric)
Foreign-key constraints:
    "purchase_transaction_lines_document_id_fkey" FOREIGN KEY (document_id) REFERENCES procurement.purchase_transactions(document_id) ON DELETE CASCADE
    "purchase_transaction_lines_unit_id_fkey" FOREIGN KEY (unit_id) REFERENCES catalog.units(id)
    "purchase_transaction_lines_variant_id_fkey" FOREIGN KEY (variant_id) REFERENCES catalog.product_variants(id)

=================== \d procurement.purchase_receipts
                              Table "procurement.purchase_receipts"
       Column        |           Type           | Collation | Nullable |         Default
---------------------+--------------------------+-----------+----------+-------------------------
 document_id         | bigint                   |           | not null |
 purchase_order_id   | bigint                   |           |          |
 supplier_id         | bigint                   |           | not null |
 warehouse_id        | bigint                   |           | not null |
 subtotal            | numeric(14,2)            |           | not null | 0
 total_amount        | numeric(14,2)            |           | not null | 0
 journal_document_id | bigint                   |           |          |
 posted_by_user_id   | bigint                   |           | not null |
 workstation_id      | text                     |           | not null |
 created_at          | timestamp with time zone |           | not null | now()
 receipt_origin      | text                     |           | not null | 'DIRECT_PURCHASE'::text
Indexes:
    "purchase_receipts_pkey" PRIMARY KEY, btree (document_id)
    "purchase_receipts_journal_document_id_key" UNIQUE CONSTRAINT, btree (journal_document_id)
Check constraints:
    "pr_origin_po_invariant" CHECK (receipt_origin = 'DIRECT_PURCHASE'::text AND purchase_order_id IS NULL OR receipt_origin = 'PURCHASE_ORDER'::text AND purchase_order_id IS NOT NULL)
    "pr_receipt_origin_valid" CHECK (receipt_origin = ANY (ARRAY['DIRECT_PURCHASE'::text, 'PURCHASE_ORDER'::text]))
    "pr_subtotal_non_negative" CHECK (subtotal >= 0::numeric)
    "pr_total_matches_subtotal" CHECK (total_amount = subtotal)
Foreign-key constraints:
    "purchase_receipts_document_id_fkey" FOREIGN KEY (document_id) REFERENCES core.business_documents(id)
    "purchase_receipts_journal_document_id_fkey" FOREIGN KEY (journal_document_id) REFERENCES finance.journal_entries(document_id)
    "purchase_receipts_posted_by_user_id_fkey" FOREIGN KEY (posted_by_user_id) REFERENCES iam.users(id)
    "purchase_receipts_purchase_order_id_fkey" FOREIGN KEY (purchase_order_id) REFERENCES procurement.purchase_orders(document_id)
    "purchase_receipts_supplier_id_fkey" FOREIGN KEY (supplier_id) REFERENCES procurement.suppliers(id)
    "purchase_receipts_warehouse_id_fkey" FOREIGN KEY (warehouse_id) REFERENCES inventory.warehouses(id)
Referenced by:
    TABLE "procurement.landed_cost_postings" CONSTRAINT "landed_cost_postings_receipt_document_id_fkey" FOREIGN KEY (receipt_document_id) REFERENCES procurement.purchase_receipts(document_id) ON DELETE RESTRICT
    TABLE "procurement.purchase_receipt_lines" CONSTRAINT "purchase_receipt_lines_document_id_fkey" FOREIGN KEY (document_id) REFERENCES procurement.purchase_receipts(document_id) ON DELETE CASCADE
    TABLE "procurement.purchase_receipt_payments" CONSTRAINT "purchase_receipt_payments_receipt_document_id_fkey" FOREIGN KEY (receipt_document_id) REFERENCES procurement.purchase_receipts(document_id) ON DELETE RESTRICT
    TABLE "procurement.purchase_returns" CONSTRAINT "purchase_returns_receipt_document_id_fkey" FOREIGN KEY (receipt_document_id) REFERENCES procurement.purchase_receipts(document_id) ON DELETE RESTRICT
    TABLE "procurement.supplier_liabilities" CONSTRAINT "supplier_liabilities_receipt_document_id_fkey" FOREIGN KEY (receipt_document_id) REFERENCES procurement.purchase_receipts(document_id)
    TABLE "procurement.supplier_returns" CONSTRAINT "supplier_returns_receipt_document_id_fkey" FOREIGN KEY (receipt_document_id) REFERENCES procurement.purchase_receipts(document_id) ON DELETE RESTRICT
Triggers:
    purchase_receipts_forbid_delete BEFORE DELETE ON procurement.purchase_receipts FOR EACH ROW EXECUTE FUNCTION procurement.forbid_receipt_mutation()
    purchase_receipts_forbid_update BEFORE UPDATE ON procurement.purchase_receipts FOR EACH ROW EXECUTE FUNCTION procurement.forbid_receipt_mutation()

=================== \d procurement.purchase_receipt_lines
                       Table "procurement.purchase_receipt_lines"
      Column       |     Type      | Collation | Nullable |           Default
-------------------+---------------+-----------+----------+------------------------------
 id                | bigint        |           | not null | generated always as identity
 document_id       | bigint        |           | not null |
 line_number       | integer       |           | not null |
 po_line_id        | bigint        |           |          |
 variant_id        | bigint        |           | not null |
 unit_id           | bigint        |           | not null |
 quantity_received | numeric(18,3) |           | not null |
 unit_cost         | numeric(14,2) |           | not null |
 line_total        | numeric(14,2) |           | not null |
 movement_id       | bigint        |           | not null |
Indexes:
    "purchase_receipt_lines_pkey" PRIMARY KEY, btree (id)
    "pr_lines_document_line_unique" UNIQUE CONSTRAINT, btree (document_id, line_number)
    "purchase_receipt_lines_movement_id_key" UNIQUE CONSTRAINT, btree (movement_id)
Check constraints:
    "pr_lines_qty_received_positive" CHECK (quantity_received > 0::numeric)
    "pr_lines_total_non_negative" CHECK (line_total >= 0::numeric)
    "pr_lines_unit_cost_non_negative" CHECK (unit_cost >= 0::numeric)
Foreign-key constraints:
    "purchase_receipt_lines_document_id_fkey" FOREIGN KEY (document_id) REFERENCES procurement.purchase_receipts(document_id) ON DELETE CASCADE
    "purchase_receipt_lines_movement_id_fkey" FOREIGN KEY (movement_id) REFERENCES inventory.movements(id)
    "purchase_receipt_lines_po_line_id_fkey" FOREIGN KEY (po_line_id) REFERENCES procurement.purchase_order_lines(id)
    "purchase_receipt_lines_unit_id_fkey" FOREIGN KEY (unit_id) REFERENCES catalog.units(id)
    "purchase_receipt_lines_variant_id_fkey" FOREIGN KEY (variant_id) REFERENCES catalog.product_variants(id)
Referenced by:
    TABLE "procurement.purchase_return_lines" CONSTRAINT "purchase_return_lines_receipt_line_id_fkey" FOREIGN KEY (receipt_line_id) REFERENCES procurement.purchase_receipt_lines(id) ON DELETE RESTRICT
    TABLE "inventory.receipt_cost_attribution" CONSTRAINT "receipt_cost_attribution_receipt_line_id_fkey" FOREIGN KEY (receipt_line_id) REFERENCES procurement.purchase_receipt_lines(id) ON DELETE RESTRICT
    TABLE "procurement.supplier_invoice_lines" CONSTRAINT "supplier_invoice_lines_receipt_line_id_fkey" FOREIGN KEY (receipt_line_id) REFERENCES procurement.purchase_receipt_lines(id) ON DELETE RESTRICT
Triggers:
    purchase_receipt_lines_forbid_delete BEFORE DELETE ON procurement.purchase_receipt_lines FOR EACH ROW EXECUTE FUNCTION procurement.forbid_receipt_mutation()
    purchase_receipt_lines_forbid_duplicate_direct_purchase_line BEFORE INSERT ON procurement.purchase_receipt_lines FOR EACH ROW EXECUTE FUNCTION procurement.forbid_duplicate_direct_purchase_line()
    purchase_receipt_lines_forbid_update BEFORE UPDATE ON procurement.purchase_receipt_lines FOR EACH ROW EXECUTE FUNCTION procurement.forbid_receipt_mutation()

=================== \d procurement.purchase_order_lines
                        Table "procurement.purchase_order_lines"
      Column       |     Type      | Collation | Nullable |           Default
-------------------+---------------+-----------+----------+------------------------------
 id                | bigint        |           | not null | generated always as identity
 document_id       | bigint        |           | not null |
 line_number       | integer       |           | not null |
 variant_id        | bigint        |           | not null |
 unit_id           | bigint        |           | not null |
 quantity_ordered  | numeric(18,3) |           | not null |
 quantity_received | numeric(18,3) |           | not null | 0
 unit_cost         | numeric(14,2) |           | not null |
 line_total        | numeric(14,2) |           | not null |
Indexes:
    "purchase_order_lines_pkey" PRIMARY KEY, btree (id)
    "po_lines_document_line_unique" UNIQUE CONSTRAINT, btree (document_id, line_number)
Check constraints:
    "po_lines_qty_ordered_positive" CHECK (quantity_ordered > 0::numeric)
    "po_lines_qty_received_le_ordered" CHECK (quantity_received <= quantity_ordered)
    "po_lines_qty_received_non_negative" CHECK (quantity_received >= 0::numeric)
    "po_lines_total_non_negative" CHECK (line_total >= 0::numeric)
    "po_lines_unit_cost_non_negative" CHECK (unit_cost >= 0::numeric)
Foreign-key constraints:
    "purchase_order_lines_document_id_fkey" FOREIGN KEY (document_id) REFERENCES procurement.purchase_orders(document_id) ON DELETE CASCADE
    "purchase_order_lines_unit_id_fkey" FOREIGN KEY (unit_id) REFERENCES catalog.units(id)
    "purchase_order_lines_variant_id_fkey" FOREIGN KEY (variant_id) REFERENCES catalog.product_variants(id)
Referenced by:
    TABLE "procurement.purchase_receipt_lines" CONSTRAINT "purchase_receipt_lines_po_line_id_fkey" FOREIGN KEY (po_line_id) REFERENCES procurement.purchase_order_lines(id)
    TABLE "procurement.supplier_invoice_lines" CONSTRAINT "supplier_invoice_lines_po_line_id_fkey" FOREIGN KEY (po_line_id) REFERENCES procurement.purchase_order_lines(id) ON DELETE RESTRICT

=================== \d procurement.supplier_returns
                                 Table "procurement.supplier_returns"
       Column        |           Type           | Collation | Nullable |           Default
---------------------+--------------------------+-----------+----------+------------------------------
 id                  | bigint                   |           | not null | generated always as identity
 document_id         | bigint                   |           | not null |
 supplier_id         | bigint                   |           | not null |
 warehouse_id        | bigint                   |           | not null |
 purchase_order_id   | bigint                   |           |          |
 reason_code         | text                     |           | not null | 'DEFECTIVE_GOODS'::text
 note                | text                     |           |          |
 created_at          | timestamp with time zone |           | not null | now()
 receipt_document_id | bigint                   |           |          |
Indexes:
    "supplier_returns_pkey" PRIMARY KEY, btree (id)
    "supplier_returns_document_id_key" UNIQUE CONSTRAINT, btree (document_id)
Foreign-key constraints:
    "supplier_returns_document_id_fkey" FOREIGN KEY (document_id) REFERENCES core.business_documents(id) ON DELETE RESTRICT
    "supplier_returns_purchase_order_id_fkey" FOREIGN KEY (purchase_order_id) REFERENCES procurement.purchase_orders(document_id) ON DELETE RESTRICT
    "supplier_returns_receipt_document_id_fkey" FOREIGN KEY (receipt_document_id) REFERENCES procurement.purchase_receipts(document_id) ON DELETE RESTRICT
    "supplier_returns_supplier_id_fkey" FOREIGN KEY (supplier_id) REFERENCES procurement.suppliers(id) ON DELETE RESTRICT
    "supplier_returns_warehouse_id_fkey" FOREIGN KEY (warehouse_id) REFERENCES inventory.warehouses(id) ON DELETE RESTRICT
Referenced by:
    TABLE "procurement.supplier_return_lines" CONSTRAINT "supplier_return_lines_return_id_fkey" FOREIGN KEY (return_id) REFERENCES procurement.supplier_returns(id) ON DELETE CASCADE
Triggers:
    supplier_returns_forbid_delete BEFORE DELETE ON procurement.supplier_returns FOR EACH ROW EXECUTE FUNCTION procurement.forbid_return_mutation()
    supplier_returns_forbid_update BEFORE UPDATE ON procurement.supplier_returns FOR EACH ROW EXECUTE FUNCTION procurement.forbid_return_mutation()

=================== \d procurement.supplier_return_lines
                     Table "procurement.supplier_return_lines"
   Column    |     Type      | Collation | Nullable |           Default
-------------+---------------+-----------+----------+------------------------------
 id          | bigint        |           | not null | generated always as identity
 return_id   | bigint        |           | not null |
 line_number | integer       |           | not null |
 variant_id  | bigint        |           | not null |
 quantity    | numeric(14,4) |           | not null |
 unit_cost   | numeric(14,4) |           | not null |
 line_total  | numeric(14,2) |           | not null |
Indexes:
    "supplier_return_lines_pkey" PRIMARY KEY, btree (id)
    "supplier_return_lines_return_id_line_number_key" UNIQUE CONSTRAINT, btree (return_id, line_number)
Check constraints:
    "supplier_return_lines_line_total_check" CHECK (line_total >= 0::numeric)
    "supplier_return_lines_quantity_check" CHECK (quantity > 0::numeric)
    "supplier_return_lines_unit_cost_check" CHECK (unit_cost >= 0::numeric)
Foreign-key constraints:
    "supplier_return_lines_return_id_fkey" FOREIGN KEY (return_id) REFERENCES procurement.supplier_returns(id) ON DELETE CASCADE
    "supplier_return_lines_variant_id_fkey" FOREIGN KEY (variant_id) REFERENCES catalog.product_variants(id) ON DELETE RESTRICT

=================== \d procurement.purchase_returns
                                 Table "procurement.purchase_returns"
       Column        |           Type           | Collation | Nullable |           Default
---------------------+--------------------------+-----------+----------+------------------------------
 id                  | bigint                   |           | not null | generated always as identity
 document_id         | bigint                   |           | not null |
 receipt_document_id | bigint                   |           | not null |
 supplier_id         | bigint                   |           | not null |
 warehouse_id        | bigint                   |           | not null |
 reason_code         | text                     |           | not null |
 note                | text                     |           |          |
 refund_amount       | numeric(14,2)            |           | not null |
 inventory_value     | numeric(14,2)            |           | not null |
 variance_amount     | numeric(14,2)            |           | not null |
 journal_document_id | bigint                   |           | not null |
 posted_by_user_id   | bigint                   |           | not null |
 created_at          | timestamp with time zone |           | not null | now()
Indexes:
    "purchase_returns_pkey" PRIMARY KEY, btree (id)
    "purchase_returns_document_id_key" UNIQUE CONSTRAINT, btree (document_id)
    "purchase_returns_receipt_idx" btree (receipt_document_id)
    "purchase_returns_supplier_idx" btree (supplier_id)
Check constraints:
    "purchase_returns_inventory_non_negative" CHECK (inventory_value >= 0::numeric)
    "purchase_returns_reason_valid" CHECK (reason_code = ANY (ARRAY['DEFECTIVE_GOODS'::text, 'EXCESS_DELIVERY'::text, 'WRONG_ITEM'::text, 'OTHER'::text]))
    "purchase_returns_refund_positive" CHECK (refund_amount > 0::numeric)
Foreign-key constraints:
    "purchase_returns_document_id_fkey" FOREIGN KEY (document_id) REFERENCES core.business_documents(id) ON DELETE RESTRICT
    "purchase_returns_journal_document_id_fkey" FOREIGN KEY (journal_document_id) REFERENCES finance.journal_entries(document_id) ON DELETE RESTRICT
    "purchase_returns_posted_by_user_id_fkey" FOREIGN KEY (posted_by_user_id) REFERENCES iam.users(id) ON DELETE RESTRICT
    "purchase_returns_receipt_document_id_fkey" FOREIGN KEY (receipt_document_id) REFERENCES procurement.purchase_receipts(document_id) ON DELETE RESTRICT
    "purchase_returns_supplier_id_fkey" FOREIGN KEY (supplier_id) REFERENCES procurement.suppliers(id) ON DELETE RESTRICT
    "purchase_returns_warehouse_id_fkey" FOREIGN KEY (warehouse_id) REFERENCES inventory.warehouses(id) ON DELETE RESTRICT
Referenced by:
    TABLE "procurement.purchase_return_lines" CONSTRAINT "purchase_return_lines_return_document_id_fkey" FOREIGN KEY (return_document_id) REFERENCES procurement.purchase_returns(document_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
Triggers:
    purchase_returns_immutable BEFORE DELETE OR UPDATE ON procurement.purchase_returns FOR EACH ROW EXECUTE FUNCTION procurement.forbid_purchase_return_mutation()

=================== \d procurement.purchase_return_lines
                        Table "procurement.purchase_return_lines"
       Column       |     Type      | Collation | Nullable |           Default
--------------------+---------------+-----------+----------+------------------------------
 id                 | bigint        |           | not null | generated always as identity
 return_document_id | bigint        |           | not null |
 line_number        | integer       |           | not null |
 receipt_line_id    | bigint        |           | not null |
 variant_id         | bigint        |           | not null |
 unit_id            | bigint        |           | not null |
 quantity           | numeric(18,3) |           | not null |
 base_quantity      | numeric(18,3) |           | not null |
 unit_cost          | numeric(14,2) |           | not null |
 refund_total       | numeric(14,2) |           | not null |
 wac_at_return      | numeric(18,6) |           | not null |
 inventory_value    | numeric(14,2) |           | not null |
 movement_id        | bigint        |           | not null |
Indexes:
    "purchase_return_lines_pkey" PRIMARY KEY, btree (id)
    "purchase_return_lines_document_line_unique" UNIQUE CONSTRAINT, btree (return_document_id, line_number)
    "purchase_return_lines_movement_id_key" UNIQUE CONSTRAINT, btree (movement_id)
    "purchase_return_lines_receipt_line_idx" btree (receipt_line_id)
Check constraints:
    "purchase_return_lines_base_quantity_positive" CHECK (base_quantity > 0::numeric)
    "purchase_return_lines_quantity_positive" CHECK (quantity > 0::numeric)
Foreign-key constraints:
    "purchase_return_lines_movement_id_fkey" FOREIGN KEY (movement_id) REFERENCES inventory.movements(id) ON DELETE RESTRICT
    "purchase_return_lines_receipt_line_id_fkey" FOREIGN KEY (receipt_line_id) REFERENCES procurement.purchase_receipt_lines(id) ON DELETE RESTRICT
    "purchase_return_lines_return_document_id_fkey" FOREIGN KEY (return_document_id) REFERENCES procurement.purchase_returns(document_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
    "purchase_return_lines_unit_id_fkey" FOREIGN KEY (unit_id) REFERENCES catalog.units(id) ON DELETE RESTRICT
    "purchase_return_lines_variant_id_fkey" FOREIGN KEY (variant_id) REFERENCES catalog.product_variants(id) ON DELETE RESTRICT
Triggers:
    purchase_return_lines_immutable BEFORE DELETE OR UPDATE ON procurement.purchase_return_lines FOR EACH ROW EXECUTE FUNCTION procurement.forbid_purchase_return_mutation()

=================== \d procurement.supplier_invoice_lines
                      Table "procurement.supplier_invoice_lines"
     Column      |     Type      | Collation | Nullable |           Default
-----------------+---------------+-----------+----------+------------------------------
 id              | bigint        |           | not null | generated always as identity
 document_id     | bigint        |           | not null |
 line_number     | integer       |           | not null |
 po_line_id      | bigint        |           |          |
 receipt_line_id | bigint        |           |          |
 variant_id      | bigint        |           | not null |
 quantity        | numeric(14,3) |           | not null |
 unit_cost       | numeric(14,2) |           | not null |
 line_total      | numeric(14,2) |           | not null |
Indexes:
    "supplier_invoice_lines_pkey" PRIMARY KEY, btree (id)
    "supplier_invoice_lines_unique_line" UNIQUE CONSTRAINT, btree (document_id, line_number)
Check constraints:
    "supplier_invoice_lines_line_number_check" CHECK (line_number > 0)
    "supplier_invoice_lines_line_total_check" CHECK (line_total >= 0::numeric)
    "supplier_invoice_lines_quantity_check" CHECK (quantity > 0::numeric)
    "supplier_invoice_lines_unit_cost_check" CHECK (unit_cost >= 0::numeric)
Foreign-key constraints:
    "supplier_invoice_lines_document_id_fkey" FOREIGN KEY (document_id) REFERENCES procurement.supplier_invoices(document_id) ON DELETE CASCADE
    "supplier_invoice_lines_po_line_id_fkey" FOREIGN KEY (po_line_id) REFERENCES procurement.purchase_order_lines(id) ON DELETE RESTRICT
    "supplier_invoice_lines_receipt_line_id_fkey" FOREIGN KEY (receipt_line_id) REFERENCES procurement.purchase_receipt_lines(id) ON DELETE RESTRICT
    "supplier_invoice_lines_variant_id_fkey" FOREIGN KEY (variant_id) REFERENCES catalog.product_variants(id) ON DELETE RESTRICT

=================== \d sales.cash_sales
                          Table "sales.cash_sales"
     Column      |           Type           | Collation | Nullable | Default
-----------------+--------------------------+-----------+----------+---------
 document_id     | bigint                   |           | not null |
 warehouse_id    | bigint                   |           | not null |
 subtotal        | numeric(14,2)            |           | not null | 0
 total_amount    | numeric(14,2)            |           | not null | 0
 created_at      | timestamp with time zone |           | not null | now()
 updated_at      | timestamp with time zone |           | not null | now()
 discount_amount | numeric(14,2)            |           | not null | 0
Indexes:
    "cash_sales_pkey" PRIMARY KEY, btree (document_id)
Check constraints:
    "cash_sales_discount_non_negative" CHECK (discount_amount >= 0::numeric)
    "cash_sales_discount_within_subtotal" CHECK (discount_amount <= subtotal)
    "cash_sales_subtotal_non_negative" CHECK (subtotal >= 0::numeric)
    "cash_sales_total_is_subtotal_less_discount" CHECK (total_amount = (subtotal - discount_amount))
    "cash_sales_total_non_negative" CHECK (total_amount >= 0::numeric)
Foreign-key constraints:
    "cash_sales_document_id_fkey" FOREIGN KEY (document_id) REFERENCES core.business_documents(id)
    "cash_sales_warehouse_id_fkey" FOREIGN KEY (warehouse_id) REFERENCES inventory.warehouses(id)
Referenced by:
    TABLE "sales.cash_sale_lines" CONSTRAINT "cash_sale_lines_document_id_fkey" FOREIGN KEY (document_id) REFERENCES sales.cash_sales(document_id) ON DELETE CASCADE
Triggers:
    cash_sales_forbid_posted_delete BEFORE DELETE ON sales.cash_sales FOR EACH ROW EXECUTE FUNCTION sales.forbid_posted_cash_sale_mutation()
    cash_sales_forbid_posted_update BEFORE UPDATE ON sales.cash_sales FOR EACH ROW EXECUTE FUNCTION sales.forbid_posted_cash_sale_mutation()
    cash_sales_set_updated_at BEFORE UPDATE ON sales.cash_sales FOR EACH ROW EXECUTE FUNCTION core.set_updated_at()

=================== \d sales.cash_sale_lines
                                     Table "sales.cash_sale_lines"
        Column         |           Type           | Collation | Nullable |           Default
-----------------------+--------------------------+-----------+----------+------------------------------
 id                    | bigint                   |           | not null | generated always as identity
 document_id           | bigint                   |           | not null |
 line_number           | integer                  |           | not null |
 variant_id            | bigint                   |           | not null |
 variant_sku_snapshot  | text                     |           | not null |
 variant_name_snapshot | text                     |           | not null |
 quantity              | numeric(18,3)            |           | not null |
 unit_price            | numeric(14,2)            |           | not null |
 unit_cost_snapshot    | numeric(18,4)            |           | not null |
 line_total            | numeric(14,2)            |           | not null |
 created_at            | timestamp with time zone |           | not null | now()
 updated_at            | timestamp with time zone |           | not null | now()
Indexes:
    "cash_sale_lines_pkey" PRIMARY KEY, btree (id)
    "cash_sale_lines_line_number_unique" UNIQUE CONSTRAINT, btree (document_id, line_number)
Check constraints:
    "cash_sale_lines_line_number_positive" CHECK (line_number > 0)
    "cash_sale_lines_line_total_matches_quantity_and_price" CHECK (line_total = round(quantity * unit_price, 2))
    "cash_sale_lines_line_total_non_negative" CHECK (line_total >= 0::numeric)
    "cash_sale_lines_quantity_positive" CHECK (quantity > 0::numeric)
    "cash_sale_lines_unit_cost_non_negative" CHECK (unit_cost_snapshot >= 0::numeric)
    "cash_sale_lines_unit_price_non_negative" CHECK (unit_price >= 0::numeric)
Foreign-key constraints:
    "cash_sale_lines_document_id_fkey" FOREIGN KEY (document_id) REFERENCES sales.cash_sales(document_id) ON DELETE CASCADE
    "cash_sale_lines_variant_id_fkey" FOREIGN KEY (variant_id) REFERENCES catalog.product_variants(id)
Triggers:
    cash_sale_lines_forbid_posted_delete BEFORE DELETE ON sales.cash_sale_lines FOR EACH ROW EXECUTE FUNCTION sales.forbid_posted_cash_sale_line_mutation()
    cash_sale_lines_forbid_posted_update BEFORE UPDATE ON sales.cash_sale_lines FOR EACH ROW EXECUTE FUNCTION sales.forbid_posted_cash_sale_line_mutation()
    cash_sale_lines_set_updated_at BEFORE UPDATE ON sales.cash_sale_lines FOR EACH ROW EXECUTE FUNCTION core.set_updated_at()

=================== \d sales.credit_sales
                              Table "sales.credit_sales"
          Column           |           Type           | Collation | Nullable | Default
---------------------------+--------------------------+-----------+----------+---------
 document_id               | bigint                   |           | not null |
 customer_id               | bigint                   |           | not null |
 warehouse_id              | bigint                   |           | not null |
 subtotal                  | numeric(14,2)            |           | not null | 0
 total_amount              | numeric(14,2)            |           | not null | 0
 due_date                  | date                     |           | not null |
 journal_document_id       | bigint                   |           |          |
 posted_by_user_id         | bigint                   |           | not null |
 workstation_id            | text                     |           | not null |
 created_at                | timestamp with time zone |           | not null | now()
 updated_at                | timestamp with time zone |           | not null | now()
 customer_code_snapshot    | text                     |           | not null |
 customer_name_snapshot    | text                     |           | not null |
 customer_tax_id_snapshot  | text                     |           |          |
 customer_address_snapshot | text                     |           |          |
 over_limit_at_posting     | boolean                  |           | not null | false
Indexes:
    "credit_sales_pkey" PRIMARY KEY, btree (document_id)
    "credit_sales_journal_document_id_key" UNIQUE CONSTRAINT, btree (journal_document_id)
Check constraints:
    "credit_sales_subtotal_non_negative" CHECK (subtotal >= 0::numeric)
    "credit_sales_total_matches_subtotal" CHECK (total_amount = subtotal)
    "credit_sales_total_non_negative" CHECK (total_amount >= 0::numeric)
    "credit_sales_workstation_not_blank" CHECK (btrim(workstation_id) <> ''::text)
Foreign-key constraints:
    "credit_sales_customer_id_fkey" FOREIGN KEY (customer_id) REFERENCES receivables.customers(id)
    "credit_sales_document_id_fkey" FOREIGN KEY (document_id) REFERENCES core.business_documents(id)
    "credit_sales_journal_document_id_fkey" FOREIGN KEY (journal_document_id) REFERENCES finance.journal_entries(document_id)
    "credit_sales_posted_by_user_id_fkey" FOREIGN KEY (posted_by_user_id) REFERENCES iam.users(id)
    "credit_sales_warehouse_id_fkey" FOREIGN KEY (warehouse_id) REFERENCES inventory.warehouses(id)
Referenced by:
    TABLE "sales.credit_sale_lines" CONSTRAINT "credit_sale_lines_document_id_fkey" FOREIGN KEY (document_id) REFERENCES sales.credit_sales(document_id) ON DELETE CASCADE
Triggers:
    credit_sales_customer_snapshot BEFORE INSERT ON sales.credit_sales FOR EACH ROW EXECUTE FUNCTION receivables.populate_customer_document_snapshot()
    credit_sales_forbid_posted_delete BEFORE DELETE ON sales.credit_sales FOR EACH ROW EXECUTE FUNCTION sales.forbid_posted_credit_sale_mutation()
    credit_sales_forbid_posted_update BEFORE UPDATE ON sales.credit_sales FOR EACH ROW EXECUTE FUNCTION sales.forbid_posted_credit_sale_mutation()
    credit_sales_set_updated_at BEFORE UPDATE ON sales.credit_sales FOR EACH ROW EXECUTE FUNCTION core.set_updated_at()

=================== \d sales.credit_sale_lines
                                    Table "sales.credit_sale_lines"
        Column         |           Type           | Collation | Nullable |           Default
-----------------------+--------------------------+-----------+----------+------------------------------
 id                    | bigint                   |           | not null | generated always as identity
 document_id           | bigint                   |           | not null |
 line_number           | integer                  |           | not null |
 variant_id            | bigint                   |           | not null |
 variant_sku_snapshot  | text                     |           | not null |
 variant_name_snapshot | text                     |           | not null |
 quantity              | numeric(18,3)            |           | not null |
 unit_price            | numeric(14,2)            |           | not null |
 unit_cost_snapshot    | numeric(18,4)            |           | not null |
 line_total            | numeric(14,2)            |           | not null |
 created_at            | timestamp with time zone |           | not null | now()
Indexes:
    "credit_sale_lines_pkey" PRIMARY KEY, btree (id)
    "credit_sale_lines_line_number_unique" UNIQUE CONSTRAINT, btree (document_id, line_number)
Check constraints:
    "credit_sale_lines_line_number_positive" CHECK (line_number > 0)
    "credit_sale_lines_quantity_positive" CHECK (quantity > 0::numeric)
    "credit_sale_lines_total_matches" CHECK (line_total = round(quantity * unit_price, 2))
    "credit_sale_lines_total_non_negative" CHECK (line_total >= 0::numeric)
    "credit_sale_lines_unit_cost_non_negative" CHECK (unit_cost_snapshot >= 0::numeric)
    "credit_sale_lines_unit_price_non_negative" CHECK (unit_price >= 0::numeric)
Foreign-key constraints:
    "credit_sale_lines_document_id_fkey" FOREIGN KEY (document_id) REFERENCES sales.credit_sales(document_id) ON DELETE CASCADE
    "credit_sale_lines_variant_id_fkey" FOREIGN KEY (variant_id) REFERENCES catalog.product_variants(id)
Triggers:
    credit_sale_lines_forbid_posted_delete BEFORE DELETE ON sales.credit_sale_lines FOR EACH ROW EXECUTE FUNCTION sales.forbid_posted_credit_sale_mutation()
    credit_sale_lines_forbid_posted_update BEFORE UPDATE ON sales.credit_sale_lines FOR EACH ROW EXECUTE FUNCTION sales.forbid_posted_credit_sale_mutation()

=================== \d sales.sale_voids
                             Table "sales.sale_voids"
        Column        |           Type           | Collation | Nullable | Default
----------------------+--------------------------+-----------+----------+---------
 void_document_id     | bigint                   |           | not null |
 original_document_id | bigint                   |           | not null |
 sale_kind            | text                     |           | not null |
 reason_code          | text                     |           | not null |
 note                 | text                     |           |          |
 total_amount         | numeric(14,2)            |           | not null |
 cash_session_id      | bigint                   |           | not null |
 journal_document_id  | bigint                   |           | not null |
 voided_by_user_id    | bigint                   |           | not null |
 workstation_id       | text                     |           | not null |
 created_at           | timestamp with time zone |           | not null | now()
Indexes:
    "sale_voids_pkey" PRIMARY KEY, btree (void_document_id)
    "sale_voids_original_document_id_key" UNIQUE CONSTRAINT, btree (original_document_id)
Check constraints:
    "sale_voids_custom_reason_needs_note" CHECK (reason_code <> 'OTHER'::text OR note IS NOT NULL)
    "sale_voids_kind_valid" CHECK (sale_kind = ANY (ARRAY['CASH'::text, 'CREDIT'::text]))
    "sale_voids_note_length" CHECK (note IS NULL OR char_length(note) <= 200)
    "sale_voids_reason_valid" CHECK (reason_code = ANY (ARRAY['CUSTOMER_CHANGED_MIND'::text, 'WRONG_ITEM'::text, 'WRONG_PRICE'::text, 'CASHIER_MISTAKE'::text, 'OTHER'::text]))
    "sale_voids_total_non_negative" CHECK (total_amount >= 0::numeric)
    "sale_voids_workstation_not_blank" CHECK (btrim(workstation_id) <> ''::text)
Foreign-key constraints:
    "sale_voids_cash_session_id_fkey" FOREIGN KEY (cash_session_id) REFERENCES sales.cash_sessions(id)
    "sale_voids_journal_document_id_fkey" FOREIGN KEY (journal_document_id) REFERENCES finance.journal_entries(document_id)
    "sale_voids_original_document_id_fkey" FOREIGN KEY (original_document_id) REFERENCES core.business_documents(id)
    "sale_voids_void_document_id_fkey" FOREIGN KEY (void_document_id) REFERENCES core.business_documents(id)
    "sale_voids_voided_by_user_id_fkey" FOREIGN KEY (voided_by_user_id) REFERENCES iam.users(id)
Triggers:
    sale_voids_forbid_delete BEFORE DELETE ON sales.sale_voids FOR EACH ROW EXECUTE FUNCTION sales.forbid_sale_void_mutation()
    sale_voids_forbid_update BEFORE UPDATE ON sales.sale_voids FOR EACH ROW EXECUTE FUNCTION sales.forbid_sale_void_mutation()

```

# Appendix B — full live function definitions (`pg_get_functiondef`, verified (DB), throwaway DB)

One block per live overload. Filename suffix in the heading is the `pg_proc.oid` in the throwaway DB (meaningless elsewhere, kept only to distinguish overloads).

## `catalog.resolve_barcode` (oid 19227)

```sql
CREATE OR REPLACE FUNCTION catalog.resolve_barcode(p_session_token text, p_identifier text)
 RETURNS TABLE(variant_id bigint, product_id bigint, sku text, name_override text, effective_variant_name text, primary_barcode text, operational_identifier text, identifier_type text, product_name text, sale_price numeric, unit_id bigint, unit_code text, unit_name text, variant_is_active boolean, product_is_active boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
    v_norm text;
BEGIN
    PERFORM 1 FROM iam.resolve_session(p_session_token);
    v_norm := upper(btrim(coalesce(p_identifier, '')));
    IF v_norm = '' THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT v.id, p.id, v.sku, v.name_override, catalog._effective_variant_name(v.id),
           b_prim.barcode, coalesce(b_prim.barcode, v.sku),
           CASE WHEN b_prim.barcode IS NOT NULL THEN 'BARCODE' ELSE 'SKU' END,
           p.name, v.sale_price, u.id, u.code, u.name, v.is_active, p.is_active
    FROM catalog.variant_barcodes b
    JOIN catalog.product_variants v ON v.id = b.variant_id
    JOIN catalog.products p ON p.id = v.product_id
    JOIN catalog.units u ON u.id = p.unit_id
    LEFT JOIN catalog.variant_barcodes b_prim
      ON b_prim.variant_id = v.id AND b_prim.is_primary = true
    WHERE b.normalized_barcode = v_norm
      AND v.is_active
      AND p.is_active
    LIMIT 1;

    IF FOUND THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT v.id, p.id, v.sku, v.name_override, catalog._effective_variant_name(v.id),
           b_prim.barcode, coalesce(b_prim.barcode, v.sku),
           CASE WHEN b_prim.barcode IS NOT NULL THEN 'BARCODE' ELSE 'SKU' END,
           p.name, v.sale_price, u.id, u.code, u.name, v.is_active, p.is_active
    FROM catalog.product_variants v
    JOIN catalog.products p ON p.id = v.product_id
    JOIN catalog.units u ON u.id = p.unit_id
    LEFT JOIN catalog.variant_barcodes b_prim
      ON b_prim.variant_id = v.id AND b_prim.is_primary = true
    WHERE upper(v.sku) = v_norm
      AND v.is_active
      AND p.is_active
    LIMIT 1;
END;
$function$

```

## `catalog.add_variant_alt_unit` (oid 19589)

```sql
CREATE OR REPLACE FUNCTION catalog.add_variant_alt_unit(p_session_token text, p_variant_id bigint, p_unit_id bigint, p_conversion_direction text, p_conversion_quantity numeric)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
    v_base_unit bigint;
    v_id        bigint;
    v_factor    numeric(20, 6);
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_CATALOG');
    SELECT base_unit_id INTO v_base_unit FROM catalog.product_variants WHERE id = p_variant_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'variant % not found', p_variant_id USING ERRCODE = '22023';
    END IF;
    PERFORM 1 FROM catalog.units WHERE id = p_unit_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'unit % not found', p_unit_id USING ERRCODE = '22023';
    END IF;
    -- Preserved unchanged from the 4-argument version.
    IF p_unit_id = v_base_unit THEN
        RAISE EXCEPTION 'alternate unit must differ from the base unit' USING ERRCODE = '22023';
    END IF;
    IF p_conversion_direction NOT IN ('ALT_TO_BASE', 'BASE_TO_ALT') THEN
        RAISE EXCEPTION 'conversion direction must be ALT_TO_BASE or BASE_TO_ALT' USING ERRCODE = '22023';
    END IF;
    IF p_conversion_quantity IS NULL OR p_conversion_quantity <= 0 THEN
        RAISE EXCEPTION 'conversion quantity must be strictly positive' USING ERRCODE = '22023';
    END IF;

    -- conversion_factor keeps its existing "1 alt = factor base" meaning for
    -- the three out-of-scope functions that already read it. ALT_TO_BASE is
    -- a direct copy (matches today's behaviour exactly, no division).
    -- BASE_TO_ALT is the one place a division happens, and only to populate
    -- this legacy column -- conversion_quantity itself is stored untouched.
    IF p_conversion_direction = 'ALT_TO_BASE' THEN
        v_factor := p_conversion_quantity;
    ELSE
        v_factor := round(1 / p_conversion_quantity, 6);
        IF v_factor <= 0 THEN
            RAISE EXCEPTION 'conversion quantity % is too large to represent at six decimal places',
                p_conversion_quantity USING ERRCODE = '22023';
        END IF;
    END IF;

    BEGIN
        INSERT INTO catalog.variant_units
                (variant_id, unit_id, conversion_factor, conversion_direction, conversion_quantity)
            VALUES (p_variant_id, p_unit_id, v_factor, p_conversion_direction, p_conversion_quantity)
            RETURNING id INTO v_id;
    EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION 'alternate unit % is already configured for this variant', p_unit_id
            USING ERRCODE = '22023';
    END;
    RETURN v_id;
END;
$function$

```

## `catalog.remove_variant_alt_unit` (oid 17126)

```sql
CREATE OR REPLACE FUNCTION catalog.remove_variant_alt_unit(p_session_token text, p_variant_unit_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_CATALOG');
    DELETE FROM catalog.variant_units WHERE id = p_variant_unit_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'alternate unit assignment % not found', p_variant_unit_id USING ERRCODE = '22023';
    END IF;
END;
$function$

```

## `catalog.set_variant_base_unit` (oid 17127)

```sql
CREATE OR REPLACE FUNCTION catalog.set_variant_base_unit(p_session_token text, p_variant_id bigint, p_unit_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_CATALOG');
    PERFORM 1 FROM catalog.product_variants WHERE id = p_variant_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'variant % not found', p_variant_id USING ERRCODE = '22023';
    END IF;
    PERFORM 1 FROM catalog.units WHERE id = p_unit_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'unit % not found', p_unit_id USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM catalog.variant_units WHERE variant_id = p_variant_id AND unit_id = p_unit_id) THEN
        RAISE EXCEPTION 'unit % is already an alternate unit of this variant', p_unit_id USING ERRCODE = '22023';
    END IF;
    UPDATE catalog.product_variants SET base_unit_id = p_unit_id WHERE id = p_variant_id;
END;
$function$

```

## `catalog.create_unit` (oid 19597)

```sql
CREATE OR REPLACE FUNCTION catalog.create_unit(p_session_token text, p_name text, p_allows_fractions boolean)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
    v_name   text;
    v_base   text;
    v_code   text;
    v_suffix int := 1;
    v_id     bigint;
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_CATALOG');
    v_name := btrim(coalesce(p_name, ''));
    IF v_name = '' THEN
        RAISE EXCEPTION 'unit name must not be blank' USING ERRCODE = '22023';
    END IF;
    IF p_allows_fractions IS NULL THEN
        RAISE EXCEPTION 'unit allows_fractions must not be null' USING ERRCODE = '22023';
    END IF;

    -- Derivation algorithm -- see the file header for the worked cases.
    v_base := upper(regexp_replace(public.unaccent(v_name), '[^a-zA-Z0-9]+', '', 'g'));
    v_base := left(v_base, 20);
    IF v_base = '' THEN
        v_base := 'UNIT';
    END IF;

    LOOP
        v_code := CASE WHEN v_suffix = 1 THEN v_base ELSE v_base || v_suffix::text END;
        BEGIN
            INSERT INTO catalog.units (code, normalized_code, name, allows_fractions)
                VALUES (v_code, upper(v_code), v_name, p_allows_fractions)
                RETURNING id INTO v_id;
            RETURN v_id;
        EXCEPTION WHEN unique_violation THEN
            v_suffix := v_suffix + 1;
            IF v_suffix > 1000 THEN
                RAISE EXCEPTION 'could not generate a unique code for unit %', v_name USING ERRCODE = '22023';
            END IF;
        END;
    END LOOP;
END;
$function$

```

## `catalog.rename_unit` (oid 19598)

```sql
CREATE OR REPLACE FUNCTION catalog.rename_unit(p_session_token text, p_unit_id bigint, p_name text, p_allows_fractions boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_CATALOG');
    PERFORM 1 FROM catalog.units WHERE id = p_unit_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'unit % not found', p_unit_id USING ERRCODE = '22023';
    END IF;
    IF btrim(coalesce(p_name, '')) = '' THEN
        RAISE EXCEPTION 'unit name must not be blank' USING ERRCODE = '22023';
    END IF;
    IF p_allows_fractions IS NULL THEN
        RAISE EXCEPTION 'unit allows_fractions must not be null' USING ERRCODE = '22023';
    END IF;
    UPDATE catalog.units
        SET name = btrim(p_name),
            allows_fractions = p_allows_fractions
        WHERE id = p_unit_id;
END;
$function$

```

## `catalog.list_units_v2` (oid 19584)

```sql
CREATE OR REPLACE FUNCTION catalog.list_units_v2(p_session_token text)
 RETURNS TABLE(id bigint, code text, name text, is_active boolean, allows_fractions boolean, usage_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
BEGIN
    PERFORM 1 FROM iam.resolve_session(p_session_token);
    RETURN QUERY
        SELECT u.id, u.code, u.name, u.is_active, u.allows_fractions,
               (SELECT count(*) FROM catalog.products p WHERE p.unit_id = u.id)
             + (SELECT count(*) FROM catalog.product_variants pv WHERE pv.base_unit_id = u.id)
             + (SELECT count(*) FROM catalog.variant_units vu WHERE vu.unit_id = u.id)
        FROM catalog.units u
        ORDER BY u.code;
END;
$function$

```

## `catalog._insert_variant` (oid 17113)

```sql
CREATE OR REPLACE FUNCTION catalog._insert_variant(p_product_id bigint, p_variant jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
    v_sku        text;
    v_price      numeric;
    v_active     boolean;
    v_name       text;
    v_variant_id bigint;
    v_attr_ids   bigint[];
    v_attr_id    bigint;
    v_barcode    text;
    v_product_unit bigint;
    v_sig        text;
BEGIN
    SELECT unit_id INTO v_product_unit FROM catalog.products WHERE id = p_product_id;
    IF v_product_unit IS NULL THEN
        RAISE EXCEPTION 'product % has no assigned unit', p_product_id USING ERRCODE = '22023';
    END IF;

    v_sku := catalog._generate_sku();
    v_name := NULLIF(btrim(coalesce(p_variant ->> 'name_override', '')), '');

    IF NOT (p_variant ? 'sale_price') OR (p_variant ->> 'sale_price') IS NULL THEN
        RAISE EXCEPTION 'variant sale_price is required' USING ERRCODE = '22023';
    END IF;
    v_price := (p_variant ->> 'sale_price')::numeric;
    IF v_price < 0 THEN
        RAISE EXCEPTION 'sale price must not be negative' USING ERRCODE = '22023';
    END IF;

    v_active := coalesce((p_variant ->> 'is_active')::boolean, true);

    IF p_variant ? 'attribute_value_ids' AND jsonb_typeof(p_variant -> 'attribute_value_ids') = 'array' THEN
        SELECT array_agg(DISTINCT elem::bigint ORDER BY elem::bigint)
            INTO v_attr_ids
            FROM jsonb_array_elements_text(p_variant -> 'attribute_value_ids') AS elem;
    END IF;

    v_sig := catalog.compute_attribute_signature(v_attr_ids);

    PERFORM 1 FROM catalog.product_variants
        WHERE product_id = p_product_id AND attribute_signature = v_sig;
    IF FOUND THEN
        RAISE EXCEPTION 'a variant with this attribute combination already exists for this product'
            USING ERRCODE = '22023';
    END IF;

    INSERT INTO catalog.product_variants (
        product_id, sku, name_override, sale_price, base_unit_id, attribute_signature, is_active
    ) VALUES (
        p_product_id, v_sku, v_name, v_price, v_product_unit, v_sig, v_active
    ) RETURNING id INTO v_variant_id;

    IF v_attr_ids IS NOT NULL AND array_length(v_attr_ids, 1) IS NOT NULL THEN
        INSERT INTO catalog.variant_attribute_values (
            variant_id,
            attribute_id,
            attribute_value_id
        )
        SELECT
            v_variant_id,
            av.attribute_id,
            av.id
        FROM catalog.attribute_values av
        WHERE av.id = ANY (v_attr_ids);
    END IF;

    IF p_variant ? 'barcodes' AND jsonb_typeof(p_variant -> 'barcodes') = 'array' THEN
        FOR v_barcode IN SELECT jsonb_array_elements_text(p_variant -> 'barcodes') LOOP
            PERFORM catalog._insert_barcode(v_variant_id, v_barcode);
        END LOOP;
    END IF;

    RETURN v_variant_id;
END;
$function$

```

## `catalog.update_variant` (oid 19225)

```sql
CREATE OR REPLACE FUNCTION catalog.update_variant(p_session_token text, p_variant_id bigint, p_name_override text, p_sale_price numeric, p_is_active boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
    v_product_id bigint;
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_CATALOG');
    SELECT product_id INTO v_product_id FROM catalog.product_variants WHERE id = p_variant_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'variant % not found', p_variant_id USING ERRCODE = '22023';
    END IF;
    IF p_sale_price < 0 THEN
        RAISE EXCEPTION 'sale price must not be negative' USING ERRCODE = '22023';
    END IF;
    IF p_is_active THEN
        PERFORM 1 FROM catalog.products WHERE id = v_product_id AND is_active;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'cannot activate a variant of an inactive product' USING ERRCODE = '55000';
        END IF;
    END IF;

    UPDATE catalog.product_variants
        SET name_override = NULLIF(btrim(p_name_override), ''),
            sale_price = p_sale_price,
            is_active = p_is_active
        WHERE id = p_variant_id;
END;
$function$

```

## `catalog.update_variant` (oid 19561)

```sql
CREATE OR REPLACE FUNCTION catalog.update_variant(p_session_token text, p_variant_id bigint, p_name_override text, p_sale_price numeric, p_is_active boolean, p_minimum_stock numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
    v_product_id bigint;
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_CATALOG');
    SELECT product_id INTO v_product_id FROM catalog.product_variants WHERE id = p_variant_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'variant % not found', p_variant_id USING ERRCODE = '22023';
    END IF;
    IF p_sale_price < 0 THEN
        RAISE EXCEPTION 'sale price must not be negative' USING ERRCODE = '22023';
    END IF;
    IF coalesce(p_minimum_stock, 0) < 0 THEN
        RAISE EXCEPTION 'minimum stock must not be negative' USING ERRCODE = '22023';
    END IF;
    IF p_is_active THEN
        PERFORM 1 FROM catalog.products WHERE id = v_product_id AND is_active;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'cannot activate a variant of an inactive product' USING ERRCODE = '55000';
        END IF;
    END IF;

    UPDATE catalog.product_variants
        SET name_override = NULLIF(btrim(p_name_override), ''),
            sale_price = p_sale_price,
            is_active = p_is_active,
            minimum_stock = coalesce(p_minimum_stock, 0)
        WHERE id = p_variant_id;
END;
$function$

```

## `inventory.list_stock_adjustment_units` (oid 17195)

```sql
CREATE OR REPLACE FUNCTION inventory.list_stock_adjustment_units(p_session_token text, p_variant_id bigint)
 RETURNS TABLE(unit_id bigint, unit_code text, unit_name text, conversion_factor numeric, is_base boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
    v_base_unit_id bigint;
BEGIN
    PERFORM 1 FROM iam.resolve_session(p_session_token);

    SELECT pv.base_unit_id INTO v_base_unit_id
    FROM catalog.product_variants pv
    JOIN catalog.products p ON p.id = pv.product_id
    WHERE pv.id = p_variant_id AND pv.is_active AND p.is_active;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'variant % is not found or is inactive', p_variant_id
            USING ERRCODE = '22023';
    END IF;

    RETURN QUERY
        SELECT u.id, u.code, u.name, 1::numeric, true
        FROM catalog.units u
        WHERE u.id = v_base_unit_id
        UNION ALL
        SELECT u.id, u.code, u.name, vu.conversion_factor, false
        FROM catalog.variant_units vu
        JOIN catalog.units u ON u.id = vu.unit_id
        WHERE vu.variant_id = p_variant_id
        ORDER BY 5 DESC, 2;
END;
$function$

```

## `procurement.list_purchase_product_options` (oid 19208)

```sql
CREATE OR REPLACE FUNCTION procurement.list_purchase_product_options(p_session_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
    v_user_id bigint;
    v_result jsonb;
BEGIN
    SELECT user_id INTO v_user_id FROM iam.resolve_session(p_session_token);
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'SESSION_INVALID: Session is invalid or expired' USING ERRCODE = '28000';
    END IF;

    SELECT coalesce(jsonb_agg(
        jsonb_build_object(
            'product_id', p.id,
            'variant_id', pv.id,
            'sku', pv.sku,
            'product_name', p.name,
            'variant_name', catalog._effective_variant_name(pv.id),
            'primary_barcode', (
                SELECT barcode FROM catalog.variant_barcodes vb
                WHERE vb.variant_id = pv.id AND vb.is_primary = true
                LIMIT 1
            ),
            'brand', CASE WHEN b.id IS NOT NULL THEN jsonb_build_object('id', b.id, 'name', b.name) ELSE NULL END,
            'default_unit_id', u.id,
            'default_unit_code', u.code,
            'default_unit_name', u.name,
            'alternate_units', '[]'::jsonb,
            'attributes', coalesce((
                SELECT jsonb_agg(jsonb_build_object('name', a.name, 'value', val.value))
                FROM catalog.variant_attribute_values vav
                JOIN catalog.attribute_values val ON val.id = vav.attribute_value_id
                JOIN catalog.attributes a ON a.id = val.attribute_id
                WHERE vav.variant_id = pv.id
            ), '[]'::jsonb),
            'is_active', (p.is_active AND pv.is_active)
        ) ORDER BY p.name, pv.sku
    ), '[]'::jsonb) INTO v_result
    FROM catalog.product_variants pv
    JOIN catalog.products p ON p.id = pv.product_id
    JOIN catalog.units u ON u.id = p.unit_id
    LEFT JOIN catalog.brands b ON b.id = p.brand_id
    WHERE p.is_active = true AND pv.is_active = true;

    RETURN v_result;
END;
$function$

```

## `sales.confirm_cash_sale` (oid 19781)

```sql
CREATE OR REPLACE FUNCTION sales.confirm_cash_sale(p_session_token text, p_request_id uuid, p_payload_hash bytea, p_cash_session_id bigint, p_warehouse_id bigint, p_fiscal_period_id bigint, p_document_date date, p_lines jsonb, p_discount_amount numeric DEFAULT 0)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
    v_user_id bigint;
    v_cached_result bigint;
    v_session_status text;
    v_session_warehouse_id bigint;
    v_period_status text;
    v_period_start date;
    v_period_end date;
    v_fiscal_year integer;
    v_document_id bigint;
    v_journal_document_id bigint;
    v_line jsonb;
    v_line_number integer := 0;
    v_variant_id bigint;
    v_quantity numeric;
    v_unit_price numeric;
    v_variant_active boolean;
    v_variant_sku text;
    v_variant_name text;
    v_qty_on_hand numeric;
    v_position_value numeric;
    v_wac numeric;
    v_new_qty numeric;
    v_new_value numeric;
    v_unit_cost_snapshot numeric;
    v_line_total numeric;
    v_subtotal numeric(14, 2) := 0;
    v_total_cogs numeric(18, 4) := 0;
    v_gen_job bigint;
    v_print_job bigint;
    v_drawer_job bigint;
    v_movement_id bigint;
    v_residual_journal_id bigint;
    v_sequence bigint;
    v_document_number text;
    -- WS-F-003 addition 1 of 4: discount state.
    v_discount numeric(14, 2);
    v_net_total numeric(14, 2);
    v_journal_line_number integer;
BEGIN
    -- 1. Session + permission (never trusts a caller-supplied actor id).
    SELECT user_id INTO v_user_id
        FROM iam.resolve_session_with_permission(p_session_token, 'POST_CASH_SALE');

    -- 2. Idempotency.
    v_cached_result := core.reserve_idempotent_request(
        'sales.confirm_cash_sale', p_request_id, p_payload_hash
    );
    IF v_cached_result IS NOT NULL THEN
        RETURN v_cached_result;
    END IF;

    -- WS-F-003 addition 2 of 4: validate the discount and, if there is one,
    -- require the discount permission on top of POST_CASH_SALE. A sale with no
    -- discount is unaffected and any cashier may still post it.
    v_discount := coalesce(p_discount_amount, 0)::numeric(14, 2);
    IF v_discount < 0 THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: discount must not be negative' USING ERRCODE = '22023';
    END IF;
    IF v_discount <> round(v_discount, 2) THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: discount must have at most two decimals'
            USING ERRCODE = '22023';
    END IF;
    IF v_discount > 0 THEN
        PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'APPLY_SALE_DISCOUNT');
    END IF;

    -- 3. Cash session validation.
    SELECT status, warehouse_id
        INTO v_session_status, v_session_warehouse_id
        FROM sales.cash_sessions
        WHERE id = p_cash_session_id
        FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'cash session % not found', p_cash_session_id USING ERRCODE = '22023';
    END IF;
    IF v_session_status <> 'OPEN' THEN
        RAISE EXCEPTION 'cash session % is not open', p_cash_session_id USING ERRCODE = '55000';
    END IF;
    IF v_session_warehouse_id <> p_warehouse_id THEN
        RAISE EXCEPTION 'warehouse mismatch between cash session and sale'
            USING ERRCODE = '22023';
    END IF;

    -- 4. Fiscal period must be OPEN and must contain the document date.
    SELECT status, starts_on, ends_on, extract(year FROM starts_on)::integer
        INTO v_period_status, v_period_start, v_period_end, v_fiscal_year
        FROM finance.fiscal_periods
        WHERE id = p_fiscal_period_id
        FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'fiscal period % not found', p_fiscal_period_id USING ERRCODE = '22023';
    END IF;
    IF v_period_status <> 'OPEN' THEN
        RAISE EXCEPTION 'fiscal period % is not open', p_fiscal_period_id USING ERRCODE = '55000';
    END IF;
    IF p_document_date < v_period_start OR p_document_date > v_period_end THEN
        RAISE EXCEPTION 'document date % is outside fiscal period %', p_document_date, p_fiscal_period_id
            USING ERRCODE = '22023';
    END IF;

    -- 5. Validate non-empty lines.
    IF p_lines IS NULL OR jsonb_array_length(p_lines) = 0 THEN
        RAISE EXCEPTION 'cash sale must have at least one line' USING ERRCODE = '22023';
    END IF;

    -- 5b. Lock all existing touched stock positions in deterministic order.
    PERFORM 1
    FROM inventory.positions
    WHERE warehouse_id = p_warehouse_id
      AND variant_id IN (
          SELECT DISTINCT (elem ->> 'variant_id')::bigint
          FROM jsonb_array_elements(p_lines) elem
      )
    ORDER BY variant_id
    FOR UPDATE;

    -- 6. Create sale header (DRAFT).
    INSERT INTO core.business_documents (document_type, document_date, fiscal_period_id, fiscal_year)
        VALUES ('CASH_SALE', p_document_date, p_fiscal_period_id, v_fiscal_year)
        RETURNING id INTO v_document_id;

    INSERT INTO sales.cash_sales (
        document_id, warehouse_id, subtotal, total_amount
    ) VALUES (
        v_document_id, p_warehouse_id, 0, 0
    );

    -- 7. Process each line: validate, issue stock, accumulate COGS.
    FOR v_line IN SELECT jsonb_array_elements(p_lines)
    LOOP
        v_line_number := v_line_number + 1;
        v_variant_id := (v_line ->> 'variant_id')::bigint;
        v_quantity := (v_line ->> 'quantity')::numeric;
        v_unit_price := (v_line ->> 'unit_price')::numeric;

        IF v_variant_id IS NULL OR v_quantity IS NULL OR v_unit_price IS NULL THEN
            RAISE EXCEPTION 'line % is missing required fields', v_line_number
                USING ERRCODE = '22023';
        END IF;
        IF v_quantity <= 0 THEN
            RAISE EXCEPTION 'line % quantity must be positive', v_line_number
                USING ERRCODE = '22023';
        END IF;
        IF v_unit_price < 0 THEN
            RAISE EXCEPTION 'line % unit price must not be negative', v_line_number
                USING ERRCODE = '22023';
        END IF;

        SELECT pv.is_active, pv.sku, p.name
            INTO v_variant_active, v_variant_sku, v_variant_name
            FROM catalog.product_variants pv
            JOIN catalog.products p ON p.id = pv.product_id
            WHERE pv.id = v_variant_id;
        IF NOT FOUND OR NOT v_variant_active THEN
            RAISE EXCEPTION 'variant % is not found or is inactive', v_variant_id USING ERRCODE = '22023';
        END IF;

        SELECT quantity_on_hand, total_value, last_known_wac
            INTO v_qty_on_hand, v_position_value, v_wac
            FROM inventory.positions
            WHERE warehouse_id = p_warehouse_id AND variant_id = v_variant_id;
        IF NOT FOUND THEN
            v_qty_on_hand := 0;
            v_position_value := 0;
            v_wac := 0;
        END IF;

        -- Reject insufficient stock / prevent negative confirmed stock.
        IF v_qty_on_hand < v_quantity THEN
            RAISE EXCEPTION 'insufficient stock for variant % in warehouse % (have %, need %)',
                v_variant_id, p_warehouse_id, v_qty_on_hand, v_quantity
                USING ERRCODE = '55000';
        END IF;

        -- COGS uses warehouse-specific WAC at the moment of sale.
        v_unit_cost_snapshot := v_wac;
        v_line_total := round(v_quantity * v_unit_price, 2);
        v_subtotal := v_subtotal + v_line_total;
        v_total_cogs := v_total_cogs + round(v_quantity * v_unit_cost_snapshot, 4);

        v_new_qty := v_qty_on_hand - v_quantity;
        v_new_value := v_position_value - round(v_quantity * v_wac, 4);

        -- S2-003: Handle zero-quantity residuals.
        IF v_new_qty = 0 THEN
            IF abs(v_new_value) >= 0.01 THEN
                RAISE EXCEPTION 'sale line % would result in a material unresolved inventory residual',
                    v_line_number USING ERRCODE = '55000';
            END IF;
        ELSIF v_new_value < 0 THEN
            RAISE EXCEPTION 'sale line % would make inventory value negative', v_line_number
                USING ERRCODE = '55000';
        END IF;

        UPDATE inventory.positions
            SET quantity_on_hand = v_new_qty,
                total_value = CASE WHEN v_new_qty = 0 THEN 0 ELSE v_new_value END
            WHERE warehouse_id = p_warehouse_id AND variant_id = v_variant_id;

        INSERT INTO inventory.movements (
            warehouse_id, variant_id, movement_type, quantity_delta, inventory_value_delta,
            resulting_quantity_on_hand, resulting_total_value, reference_type, reference_id
        ) VALUES (
            p_warehouse_id, v_variant_id, 'ISSUE', -v_quantity, -round(v_quantity * v_wac, 4),
            v_new_qty, CASE WHEN v_new_qty = 0 THEN 0 ELSE v_new_value END, 'CASH_SALE_LINE', v_document_id
        ) RETURNING id INTO v_movement_id;

        -- S2-003: Handle residual clearance if qty=0 with residual remaining.
        IF v_new_qty = 0 AND v_new_value <> 0 THEN
            v_residual_journal_id := inventory._handle_residual_at_zero_quantity(
                p_warehouse_id, v_variant_id, v_movement_id, v_new_value,
                p_fiscal_period_id, p_document_date
            );
        END IF;

        INSERT INTO sales.cash_sale_lines (
            document_id, line_number, variant_id, variant_sku_snapshot, variant_name_snapshot,
            quantity, unit_price, unit_cost_snapshot, line_total
        ) VALUES (
            v_document_id, v_line_number, v_variant_id, v_variant_sku, v_variant_name,
            v_quantity, v_unit_price, v_unit_cost_snapshot, v_line_total
        );
    END LOOP;

    -- WS-F-003 addition 3 of 4: the discount may not exceed what was sold, and
    -- the net total is what the customer actually pays.
    IF v_discount > v_subtotal THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: discount exceeds the sale total'
            USING ERRCODE = '22023';
    END IF;
    v_net_total := v_subtotal - v_discount;

    -- 8. Finalize the sale header's exact totals.
    UPDATE sales.cash_sales
        SET subtotal = v_subtotal,
            discount_amount = v_discount,
            total_amount = v_net_total
        WHERE document_id = v_document_id;

    -- 9. Balanced journal -- revenue is credited gross, the discount is debited
    -- to its own account, and cash receives only the net. COGS is unchanged.
    INSERT INTO core.business_documents (document_type, document_date, fiscal_period_id, fiscal_year)
        VALUES ('JOURNAL_ENTRY', p_document_date, p_fiscal_period_id, v_fiscal_year)
        RETURNING id INTO v_journal_document_id;

    INSERT INTO finance.journal_entries (document_id, description, source_type, source_id)
        VALUES (v_journal_document_id, 'Cash sale', 'CASH_SALE', v_document_id);

    -- WS-F-003 addition 4 of 4: three-line revenue posting when a discount is
    -- present, otherwise exactly the two lines that were posted before.
    INSERT INTO finance.journal_lines (document_id, line_number, account_code, account_id, debit, credit) VALUES
        (v_journal_document_id, 1, 'CASH_DESK', finance.resolve_account_id('CASH_DESK'), v_net_total, 0);

    v_journal_line_number := 2;

    IF v_discount > 0 THEN
        INSERT INTO finance.journal_lines (document_id, line_number, account_code, account_id, debit, credit) VALUES
            (v_journal_document_id, v_journal_line_number, 'SALES_DISCOUNT', finance.resolve_account_id('SALES_DISCOUNT'), v_discount, 0);
        v_journal_line_number := v_journal_line_number + 1;
    END IF;

    INSERT INTO finance.journal_lines (document_id, line_number, account_code, account_id, debit, credit) VALUES
        (v_journal_document_id, v_journal_line_number, 'SALES_REVENUE', finance.resolve_account_id('SALES_REVENUE'), 0, v_subtotal);

    v_journal_line_number := v_journal_line_number + 1;

    IF v_total_cogs > 0 THEN
        INSERT INTO finance.journal_lines (document_id, line_number, account_code, account_id, debit, credit) VALUES
            (v_journal_document_id, v_journal_line_number, 'COGS', finance.resolve_account_id('COGS'), round(v_total_cogs, 2), 0),
            (v_journal_document_id, v_journal_line_number + 1, 'INVENTORY_MERCHANDISE', finance.resolve_account_id('INVENTORY_MERCHANDISE'), 0, round(v_total_cogs, 2));
    END IF;

    -- 10. Allocate both official document numbers inside this same transaction, then post.
    v_sequence := core.claim_next_document_number('CASH_SALE', v_fiscal_year);
    v_document_number := 'VC-' || v_fiscal_year || '-' || lpad(v_sequence::text, 6, '0');
    UPDATE core.business_documents
        SET status = 'POSTED', sequence_number = v_sequence, document_number = v_document_number, posted_at = now()
        WHERE id = v_document_id;

    v_sequence := core.claim_next_document_number('JOURNAL_ENTRY', v_fiscal_year);
    v_document_number := 'JE-' || v_fiscal_year || '-' || lpad(v_sequence::text, 6, '0');
    UPDATE core.business_documents
        SET status = 'POSTED', sequence_number = v_sequence, document_number = v_document_number, posted_at = now()
        WHERE id = v_journal_document_id;

    -- 11. Record the cash movement -- the drawer receives the net, not the gross.
    INSERT INTO cash.movements (cash_session_id, business_document_id, movement_type, amount)
        VALUES (p_cash_session_id, v_document_id, 'SALE', v_net_total);

    -- 12. Enqueue document generation + receipt printing (inside this same transaction) and drawer pulse.
    SELECT generation_job_id, print_job_id INTO v_gen_job, v_print_job
        FROM documents.enqueue_receipt_jobs(v_document_id, 'cash_sale_receipt:' || v_document_id);

    v_drawer_job := cash.enqueue_drawer_job(
        p_cash_session_id, v_document_id, 'cash_sale_drawer:' || v_document_id
    );

    -- 13. Record the idempotent result and return it.
    PERFORM core.record_idempotent_result('sales.confirm_cash_sale', p_request_id, v_document_id);

    RETURN v_document_id;
END;
$function$

```

## `sales.confirm_credit_sale` (oid 17883)

```sql
CREATE OR REPLACE FUNCTION sales.confirm_credit_sale(p_session_token text, p_request_id uuid, p_payload_hash bytea, p_customer_id bigint, p_warehouse_id bigint, p_fiscal_period_id bigint, p_document_date date, p_lines jsonb, p_override_token uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
    v_user_id bigint;
    v_workstation_id text;
    v_cached_result bigint;
    v_period_status text;
    v_period_start date;
    v_period_end date;
    v_fiscal_year integer;
    v_customer_active boolean;
    v_credit_enabled boolean;
    v_credit_limit numeric(14, 2);
    v_payment_terms_days integer;
    v_max_overdue_days integer;
    v_exposure numeric(14, 2);
    v_oldest_due date;
    v_business_today date := (now() AT TIME ZONE 'Africa/Algiers')::date;
    v_over_limit boolean;
    v_overdue_blocked boolean;
    v_override_used boolean := false;
    v_document_id bigint;
    v_journal_document_id bigint;
    v_line jsonb;
    v_line_number integer := 0;
    v_variant_id bigint;
    v_quantity numeric;
    v_unit_price numeric;
    v_variant_active boolean;
    v_variant_sku text;
    v_variant_name text;
    v_qty_on_hand numeric;
    v_position_value numeric;
    v_wac numeric;
    v_new_qty numeric;
    v_new_value numeric;
    v_unit_cost_snapshot numeric;
    v_line_total numeric(14, 2);
    v_subtotal numeric(14, 2) := 0;
    v_total_cogs numeric(18, 4) := 0;
    v_movement_id bigint;
    v_residual_journal_id bigint;
    v_due_date date;
    v_sequence bigint;
    v_document_number text;
    v_journal_sequence bigint;
    v_journal_number text;
    v_new_exposure numeric(14, 2);
BEGIN
    -- Application session + permission. Actor and workstation are resolved here,
    -- never trusted from caller input.
    SELECT user_id, workstation_id
    INTO v_user_id, v_workstation_id
    FROM iam.resolve_session_with_permission(p_session_token, 'POST_CREDIT_SALE');

    -- Core idempotency. Failed attempts roll back this reservation naturally.
    v_cached_result := core.reserve_idempotent_request(
        'sales.confirm_credit_sale', p_request_id, p_payload_hash
    );
    IF v_cached_result IS NOT NULL THEN
        -- WS-F-004 change 1 of 3: the replay must return the same over-limit
        -- flag the original posting returned, so it is read from the stored
        -- column rather than recomputed against today's exposure.
        RETURN (
            SELECT jsonb_build_object(
                'document_id', d.id,
                'document_number', d.document_number,
                'customer_id', s.customer_id,
                'total_amount', s.total_amount::text,
                'due_date', s.due_date,
                'exposure_amount', cs.exposure_amount::text,
                'available_credit', (c.credit_limit - cs.exposure_amount)::text,
                'credit_limit', c.credit_limit::text,
                'over_limit', s.over_limit_at_posting,
                'journal_document_id', s.journal_document_id
            )
            FROM core.business_documents d
            JOIN sales.credit_sales s ON s.document_id = d.id
            JOIN receivables.customers c ON c.id = s.customer_id
            JOIN receivables.customer_credit_state cs ON cs.customer_id = c.id
            WHERE d.id = v_cached_result
        );
    END IF;

    -- Fiscal boundary.
    SELECT status, starts_on, ends_on, extract(year FROM starts_on)::integer
    INTO v_period_status, v_period_start, v_period_end, v_fiscal_year
    FROM finance.fiscal_periods
    WHERE id = p_fiscal_period_id
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'fiscal period % not found', p_fiscal_period_id USING ERRCODE = '22023';
    END IF;
    IF v_period_status <> 'OPEN' THEN
        RAISE EXCEPTION 'fiscal period is not open' USING ERRCODE = '55000';
    END IF;
    IF p_document_date < v_period_start OR p_document_date > v_period_end THEN
        RAISE EXCEPTION 'document date is outside fiscal period' USING ERRCODE = '22023';
    END IF;

    IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
        RAISE EXCEPTION 'credit sale must contain at least one line' USING ERRCODE = '22023';
    END IF;

    -- Lock customer master + credit state before evaluating exposure. Every future
    -- customer payment/credit posting follows this same lock boundary.
    SELECT c.is_active, c.credit_enabled, c.credit_limit, c.payment_terms_days,
           c.max_overdue_days, cs.exposure_amount, cs.oldest_open_due_date
    INTO v_customer_active, v_credit_enabled, v_credit_limit, v_payment_terms_days,
         v_max_overdue_days, v_exposure, v_oldest_due
    FROM receivables.customers c
    JOIN receivables.customer_credit_state cs ON cs.customer_id = c.id
    WHERE c.id = p_customer_id
    FOR UPDATE OF c, cs;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'customer % not found', p_customer_id USING ERRCODE = '22023';
    END IF;
    IF NOT v_customer_active THEN
        RAISE EXCEPTION 'customer is inactive' USING ERRCODE = '55000';
    END IF;
    IF NOT v_credit_enabled THEN
        RAISE EXCEPTION 'customer is not enabled for credit sales' USING ERRCODE = '55000';
    END IF;

    -- Validate wire amounts and calculate sale total before any inventory mutation.
    FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
    LOOP
        v_variant_id := NULLIF(v_line ->> 'variant_id', '')::bigint;
        v_quantity := NULLIF(v_line ->> 'quantity', '')::numeric;
        v_unit_price := NULLIF(v_line ->> 'unit_price', '')::numeric;
        IF v_variant_id IS NULL OR v_quantity IS NULL OR v_unit_price IS NULL THEN
            RAISE EXCEPTION 'credit sale line is missing required fields' USING ERRCODE = '22023';
        END IF;
        IF v_quantity <= 0 THEN
            RAISE EXCEPTION 'credit sale quantity must be positive' USING ERRCODE = '22023';
        END IF;
        IF v_unit_price < 0 THEN
            RAISE EXCEPTION 'credit sale unit price cannot be negative' USING ERRCODE = '22023';
        END IF;
        v_subtotal := v_subtotal + round(v_quantity * v_unit_price, 2);
    END LOOP;

    IF v_subtotal <= 0 THEN
        RAISE EXCEPTION 'credit sale total must be positive' USING ERRCODE = '22023';
    END IF;

    v_due_date := p_document_date + v_payment_terms_days;
    v_over_limit := (v_exposure + v_subtotal) > v_credit_limit;
    v_overdue_blocked := v_oldest_due IS NOT NULL
        AND v_max_overdue_days IS NOT NULL
        AND (v_oldest_due + v_max_overdue_days) < v_business_today;

    -- WS-F-004 change 2 of 3: only the overdue condition blocks now. Being over
    -- the credit limit is recorded and returned, and the sale continues. An
    -- override token is still honoured if one was supplied for the overdue case.
    IF v_overdue_blocked THEN
        IF p_override_token IS NULL THEN
            RAISE EXCEPTION 'customer has an overdue invoice beyond the allowed window'
                USING ERRCODE = '55000';
        END IF;

        PERFORM 1
        FROM receivables.credit_override_tokens o
        WHERE o.id = p_override_token
          AND o.customer_id = p_customer_id
          AND o.canonical_payload_hash = encode(p_payload_hash, 'hex')
          AND o.consumed_at IS NULL
          AND o.expires_at > now()
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'credit override is invalid, expired, consumed, or does not match this sale'
                USING ERRCODE = '55000';
        END IF;
        v_override_used := true;
    END IF;

    -- Lock all existing touched stock positions in deterministic order.
    PERFORM 1
    FROM inventory.positions
    WHERE warehouse_id = p_warehouse_id
      AND variant_id IN (
          SELECT DISTINCT (elem ->> 'variant_id')::bigint
          FROM jsonb_array_elements(p_lines) elem
      )
    ORDER BY variant_id
    FOR UPDATE;

    INSERT INTO core.business_documents (
        document_type, document_date, fiscal_period_id, fiscal_year
    ) VALUES (
        'CREDIT_SALE', p_document_date, p_fiscal_period_id, v_fiscal_year
    ) RETURNING id INTO v_document_id;

    INSERT INTO sales.credit_sales (
        document_id, customer_id, warehouse_id, subtotal, total_amount, due_date,
        posted_by_user_id, workstation_id
    ) VALUES (
        v_document_id, p_customer_id, p_warehouse_id, 0, 0, v_due_date,
        v_user_id, v_workstation_id
    );

    v_line_number := 0;
    FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
    LOOP
        v_line_number := v_line_number + 1;
        v_variant_id := (v_line ->> 'variant_id')::bigint;
        v_quantity := (v_line ->> 'quantity')::numeric;
        v_unit_price := (v_line ->> 'unit_price')::numeric;

        SELECT pv.is_active, pv.sku, p.name
        INTO v_variant_active, v_variant_sku, v_variant_name
        FROM catalog.product_variants pv
        JOIN catalog.products p ON p.id = pv.product_id
        WHERE pv.id = v_variant_id;

        IF NOT FOUND OR NOT v_variant_active THEN
            RAISE EXCEPTION 'variant % is missing or inactive', v_variant_id USING ERRCODE = '22023';
        END IF;

        SELECT quantity_on_hand, total_value, last_known_wac
        INTO v_qty_on_hand, v_position_value, v_wac
        FROM inventory.positions
        WHERE warehouse_id = p_warehouse_id AND variant_id = v_variant_id;

        IF NOT FOUND THEN
            v_qty_on_hand := 0;
            v_position_value := 0;
            v_wac := 0;
        END IF;
        IF v_qty_on_hand < v_quantity THEN
            RAISE EXCEPTION 'insufficient stock for variant %', v_variant_id USING ERRCODE = '55000';
        END IF;

        v_unit_cost_snapshot := v_wac;
        v_line_total := round(v_quantity * v_unit_price, 2);
        v_total_cogs := v_total_cogs + round(v_quantity * v_unit_cost_snapshot, 4);
        v_new_qty := v_qty_on_hand - v_quantity;
        v_new_value := v_position_value - round(v_quantity * v_wac, 4);

        IF v_new_qty = 0 THEN
            IF abs(v_new_value) >= 0.01 THEN
                RAISE EXCEPTION 'credit sale would leave a material zero-quantity inventory residual'
                    USING ERRCODE = '55000';
            END IF;
        ELSIF v_new_value < 0 THEN
            RAISE EXCEPTION 'credit sale would make inventory value negative' USING ERRCODE = '55000';
        END IF;

        UPDATE inventory.positions
        SET quantity_on_hand = v_new_qty,
            total_value = CASE WHEN v_new_qty = 0 THEN 0 ELSE v_new_value END
        WHERE warehouse_id = p_warehouse_id AND variant_id = v_variant_id;

        INSERT INTO inventory.movements (
            warehouse_id, variant_id, movement_type, quantity_delta, inventory_value_delta,
            resulting_quantity_on_hand, resulting_total_value, reference_type, reference_id
        ) VALUES (
            p_warehouse_id, v_variant_id, 'ISSUE', -v_quantity,
            -round(v_quantity * v_wac, 4), v_new_qty,
            CASE WHEN v_new_qty = 0 THEN 0 ELSE v_new_value END,
            'CREDIT_SALE_LINE', v_document_id
        ) RETURNING id INTO v_movement_id;

        IF v_new_qty = 0 AND v_new_value <> 0 THEN
            v_residual_journal_id := inventory._handle_residual_at_zero_quantity(
                p_warehouse_id, v_variant_id, v_movement_id, v_new_value,
                p_fiscal_period_id, p_document_date
            );
        END IF;

        INSERT INTO sales.credit_sale_lines (
            document_id, line_number, variant_id, variant_sku_snapshot,
            variant_name_snapshot, quantity, unit_price, unit_cost_snapshot, line_total
        ) VALUES (
            v_document_id, v_line_number, v_variant_id, v_variant_sku,
            v_variant_name, v_quantity, v_unit_price, v_unit_cost_snapshot, v_line_total
        );
    END LOOP;

    -- WS-F-004 change 3 of 3: store the over-limit fact alongside the totals.
    UPDATE sales.credit_sales
    SET subtotal = v_subtotal,
        total_amount = v_subtotal,
        over_limit_at_posting = v_over_limit
    WHERE document_id = v_document_id;

    -- Receivable journal: Dr AR / Cr revenue, plus COGS / inventory.
    INSERT INTO core.business_documents (
        document_type, document_date, fiscal_period_id, fiscal_year
    ) VALUES (
        'JOURNAL_ENTRY', p_document_date, p_fiscal_period_id, v_fiscal_year
    ) RETURNING id INTO v_journal_document_id;

    INSERT INTO finance.journal_entries (document_id, description, source_type, source_id)
    VALUES (v_journal_document_id, 'Customer credit sale', 'CREDIT_SALE', v_document_id);

    INSERT INTO finance.journal_lines (document_id, line_number, account_code, account_id, debit, credit) VALUES
        (v_journal_document_id, 1, 'ACCOUNTS_RECEIVABLE', finance.resolve_account_id('ACCOUNTS_RECEIVABLE'), v_subtotal, 0),
        (v_journal_document_id, 2, 'SALES_REVENUE', finance.resolve_account_id('SALES_REVENUE'), 0, v_subtotal);

    IF v_total_cogs > 0 THEN
        INSERT INTO finance.journal_lines (document_id, line_number, account_code, account_id, debit, credit) VALUES
            (v_journal_document_id, 3, 'COGS', finance.resolve_account_id('COGS'), round(v_total_cogs, 2), 0),
            (v_journal_document_id, 4, 'INVENTORY_MERCHANDISE', finance.resolve_account_id('INVENTORY_MERCHANDISE'), 0, round(v_total_cogs, 2));
    END IF;

    UPDATE sales.credit_sales
    SET journal_document_id = v_journal_document_id
    WHERE document_id = v_document_id;

    -- Official numbers claimed inside transaction; rollback leaves no gap.
    v_sequence := core.claim_next_document_number('CREDIT_SALE', v_fiscal_year);
    v_document_number := 'CR-' || v_fiscal_year || '-' || lpad(v_sequence::text, 6, '0');
    UPDATE core.business_documents
    SET status = 'POSTED', sequence_number = v_sequence,
        document_number = v_document_number, posted_at = now()
    WHERE id = v_document_id;

    v_journal_sequence := core.claim_next_document_number('JOURNAL_ENTRY', v_fiscal_year);
    v_journal_number := 'JE-' || v_fiscal_year || '-' || lpad(v_journal_sequence::text, 6, '0');
    UPDATE core.business_documents
    SET status = 'POSTED', sequence_number = v_journal_sequence,
        document_number = v_journal_number, posted_at = now()
    WHERE id = v_journal_document_id;

    -- Append-only AR movement and authoritative cache update happen under the
    -- same customer lock as the credit decision.
    INSERT INTO receivables.customer_ledger_entries (
        customer_id, entry_type, amount_delta, document_id, due_date,
        posted_by_user_id, workstation_id
    ) VALUES (
        p_customer_id, 'CREDIT_INVOICE', v_subtotal, v_document_id, v_due_date,
        v_user_id, v_workstation_id
    );

    v_new_exposure := v_exposure + v_subtotal;
    UPDATE receivables.customer_credit_state
    SET exposure_amount = v_new_exposure,
        oldest_open_due_date = CASE
            WHEN oldest_open_due_date IS NULL THEN v_due_date
            ELSE least(oldest_open_due_date, v_due_date)
        END
    WHERE customer_id = p_customer_id;

    IF v_override_used THEN
        UPDATE receivables.credit_override_tokens
        SET consumed_at = now(), consumed_document_id = v_document_id
        WHERE id = p_override_token;
    END IF;

    PERFORM core.record_idempotent_result(
        'sales.confirm_credit_sale', p_request_id, v_document_id
    );

    RETURN jsonb_build_object(
        'document_id', v_document_id,
        'document_number', v_document_number,
        'customer_id', p_customer_id,
        'total_amount', v_subtotal::text,
        'due_date', v_due_date,
        'exposure_amount', v_new_exposure::text,
        'available_credit', (v_credit_limit - v_new_exposure)::text,
        'credit_limit', v_credit_limit::text,
        'over_limit', v_over_limit,
        'journal_document_id', v_journal_document_id
    );
END;
$function$

```

## `sales.confirm_credit_sale` (oid 17890)

```sql
CREATE OR REPLACE FUNCTION sales.confirm_credit_sale(p_session_token text, p_request_id uuid, p_customer_id bigint, p_warehouse_id bigint, p_fiscal_period_id bigint, p_document_date date, p_lines jsonb, p_override_token uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
    v_business_date date := (now() AT TIME ZONE 'Africa/Algiers')::date;
    v_payload_hash bytea;
BEGIN
    v_payload_hash := receivables.credit_sale_payload_hash(
        p_customer_id,
        p_warehouse_id,
        p_fiscal_period_id,
        v_business_date,
        p_lines
    );

    RETURN sales.confirm_credit_sale(
        p_session_token,
        p_request_id,
        v_payload_hash,
        p_customer_id,
        p_warehouse_id,
        p_fiscal_period_id,
        v_business_date,
        p_lines,
        p_override_token
    );
END;
$function$

```

## `sales.void_sale` (oid 19888)

```sql
CREATE OR REPLACE FUNCTION sales.void_sale(p_session_token text, p_document_id bigint, p_reason_code text, p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
    v_user_id bigint;
    v_workstation_id text;
    v_note text;
    v_doc_type text;
    v_doc_status text;
    v_doc_number text;
    v_sale_kind text;
    v_session_id bigint;
    v_session_status text;
    v_session_cashier bigint;
    v_session_workstation text;
    v_sale_total numeric(14, 2);
    v_sale_subtotal numeric(14, 2);
    v_sale_discount numeric(14, 2);
    v_sale_created_at timestamptz;
    v_sale_workstation text;
    v_customer_id bigint;
    v_customer_name text;
    v_invoice_entry_id bigint;
    v_original_journal_id bigint;
    v_line_reference text;
    v_today date := (now() AT TIME ZONE 'Africa/Algiers')::date;
    v_period_id bigint;
    v_fiscal_year integer;
    v_void_document_id bigint;
    v_void_journal_id bigint;
    v_sequence bigint;
    v_void_number text;
    v_journal_number text;
    v_mv record;
    v_new_qty numeric;
    v_new_value numeric;
    v_restocked_lines integer := 0;
    v_mirrored_lines integer := 0;
    v_oldest_due date;
    v_lines jsonb;
BEGIN
    -- 1. Who is asking.
    SELECT user_id, workstation_id
    INTO v_user_id, v_workstation_id
    FROM iam.resolve_session_with_permission(p_session_token, 'VOID_SALE');

    -- 2. Reason and description.
    IF p_reason_code IS NULL OR p_reason_code NOT IN
        ('CUSTOMER_CHANGED_MIND', 'WRONG_ITEM', 'WRONG_PRICE', 'CASHIER_MISTAKE', 'OTHER') THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: unsupported cancellation reason' USING ERRCODE = '22023';
    END IF;
    v_note := nullif(btrim(coalesce(p_note, '')), '');
    IF v_note IS NOT NULL AND char_length(v_note) > 200 THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: note must be at most 200 characters' USING ERRCODE = '22023';
    END IF;
    IF p_reason_code = 'OTHER' AND v_note IS NULL THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: a description is required for a custom reason'
            USING ERRCODE = '22023';
    END IF;

    -- 3. Lock the original document; this is also the double-cancel guard.
    SELECT document_type, status, document_number
    INTO v_doc_type, v_doc_status, v_doc_number
    FROM core.business_documents
    WHERE id = p_document_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'sale not found' USING ERRCODE = '22023';
    END IF;
    IF v_doc_type NOT IN ('CASH_SALE', 'CREDIT_SALE') THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: only a cash or credit sale can be cancelled' USING ERRCODE = '22023';
    END IF;
    IF v_doc_status = 'REVERSED' THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: this sale is already cancelled' USING ERRCODE = '55000';
    END IF;
    IF v_doc_status <> 'POSTED' THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: only a posted sale can be cancelled' USING ERRCODE = '55000';
    END IF;

    -- 4. Gather the sale and find its cash session.
    IF v_doc_type = 'CASH_SALE' THEN
        v_sale_kind := 'CASH';
        v_line_reference := 'CASH_SALE_LINE';

        SELECT m.cash_session_id INTO v_session_id
        FROM cash.movements m
        WHERE m.business_document_id = p_document_id AND m.movement_type = 'SALE';
        IF NOT FOUND THEN
            RAISE EXCEPTION 'PRECONDITION_FAILED: this sale is not linked to a cash session'
                USING ERRCODE = '55000';
        END IF;

        SELECT total_amount, subtotal, discount_amount
        INTO v_sale_total, v_sale_subtotal, v_sale_discount
        FROM sales.cash_sales
        WHERE document_id = p_document_id;

        SELECT je.document_id INTO v_original_journal_id
        FROM finance.journal_entries je
        WHERE je.source_type = 'CASH_SALE' AND je.source_id = p_document_id;
    ELSE
        v_sale_kind := 'CREDIT';
        v_line_reference := 'CREDIT_SALE_LINE';

        SELECT cs.total_amount, cs.subtotal, cs.created_at, cs.workstation_id,
               cs.customer_id, cs.journal_document_id, c.name
        INTO v_sale_total, v_sale_subtotal, v_sale_created_at, v_sale_workstation,
             v_customer_id, v_original_journal_id, v_customer_name
        FROM sales.credit_sales cs
        JOIN receivables.customers c ON c.id = cs.customer_id
        WHERE cs.document_id = p_document_id;
        v_sale_discount := 0;

        SELECT s.id INTO v_session_id
        FROM sales.cash_sessions s
        WHERE s.workstation_id = v_sale_workstation
          AND s.status = 'OPEN'
          AND s.opened_at <= v_sale_created_at
        ORDER BY s.opened_at DESC
        LIMIT 1;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'PRECONDITION_FAILED: a sale can only be cancelled while the cash session it was made in is still open'
                USING ERRCODE = '55000';
        END IF;
    END IF;

    IF v_original_journal_id IS NULL THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: the sale journal was not found' USING ERRCODE = '55000';
    END IF;

    -- 5. The session must still be open and belong to the caller.
    SELECT status, current_cashier_user_id, workstation_id
    INTO v_session_status, v_session_cashier, v_session_workstation
    FROM sales.cash_sessions
    WHERE id = v_session_id
    FOR UPDATE;

    IF v_session_status <> 'OPEN' THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: a sale can only be cancelled while the cash session it was made in is still open'
            USING ERRCODE = '55000';
    END IF;
    IF v_session_cashier <> v_user_id OR v_session_workstation <> v_workstation_id THEN
        RAISE EXCEPTION 'only the cashier of the open session can cancel its sales' USING ERRCODE = '42501';
    END IF;

    -- 6. Credit sale: refuse if any payment is allocated to it (ruling R4).
    IF v_sale_kind = 'CREDIT' THEN
        SELECT id INTO v_invoice_entry_id
        FROM receivables.customer_ledger_entries
        WHERE document_id = p_document_id AND entry_type = 'CREDIT_INVOICE';
        IF NOT FOUND THEN
            RAISE EXCEPTION 'PRECONDITION_FAILED: the customer invoice was not found' USING ERRCODE = '55000';
        END IF;

        PERFORM 1 FROM receivables.customer_credit_state
        WHERE customer_id = v_customer_id
        FOR UPDATE;

        IF receivables.net_invoice_allocated_amount(v_invoice_entry_id) <> 0 THEN
            RAISE EXCEPTION 'PRECONDITION_FAILED: the customer has already paid part of this sale; refund that payment first, then cancel the sale'
                USING ERRCODE = '55000';
        END IF;
    END IF;

    -- 7. Fiscal period covering today (same rule as cash._post_cash_journal).
    SELECT id, extract(year FROM starts_on)::integer
    INTO v_period_id, v_fiscal_year
    FROM finance.fiscal_periods
    WHERE status = 'OPEN' AND v_today BETWEEN starts_on AND ends_on
    ORDER BY starts_on DESC
    LIMIT 1;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: no open fiscal period covers today' USING ERRCODE = '55000';
    END IF;

    -- 8. The void document (DRAFT for now; numbered and posted in step 13).
    INSERT INTO core.business_documents (
        document_type, document_date, fiscal_period_id, fiscal_year, reverses_document_id
    ) VALUES (
        'SALE_VOID', v_today, v_period_id, v_fiscal_year, p_document_id
    ) RETURNING id INTO v_void_document_id;

    -- 9. The mirrored journal: every line of the sale journal, debit and credit swapped.
    INSERT INTO core.business_documents (document_type, document_date, fiscal_period_id, fiscal_year)
    VALUES ('JOURNAL_ENTRY', v_today, v_period_id, v_fiscal_year)
    RETURNING id INTO v_void_journal_id;

    INSERT INTO finance.journal_entries (document_id, description, source_type, source_id)
    VALUES (v_void_journal_id, 'Sale cancelled', 'SALE_VOID', v_void_document_id);

    INSERT INTO finance.journal_lines (document_id, line_number, account_code, account_id, debit, credit)
    SELECT v_void_journal_id, jl.line_number, jl.account_code, jl.account_id, jl.credit, jl.debit
    FROM finance.journal_lines jl
    WHERE jl.document_id = v_original_journal_id
    ORDER BY jl.line_number;
    GET DIAGNOSTICS v_mirrored_lines = ROW_COUNT;
    IF v_mirrored_lines = 0 THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: the sale journal has no lines' USING ERRCODE = '55000';
    END IF;

    -- 10. Stock comes back at exactly the value it left with.
    PERFORM 1
    FROM inventory.positions p
    WHERE (p.warehouse_id, p.variant_id) IN (
        SELECT m.warehouse_id, m.variant_id
        FROM inventory.movements m
        WHERE m.reference_type = v_line_reference
          AND m.reference_id = p_document_id
          AND m.movement_type = 'ISSUE'
    )
    ORDER BY p.warehouse_id, p.variant_id
    FOR UPDATE;

    FOR v_mv IN
        SELECT m.warehouse_id, m.variant_id, m.quantity_delta, m.inventory_value_delta
        FROM inventory.movements m
        WHERE m.reference_type = v_line_reference
          AND m.reference_id = p_document_id
          AND m.movement_type = 'ISSUE'
        ORDER BY m.warehouse_id, m.variant_id, m.id
    LOOP
        UPDATE inventory.positions
        SET quantity_on_hand = quantity_on_hand - v_mv.quantity_delta,
            total_value = total_value - v_mv.inventory_value_delta
        WHERE warehouse_id = v_mv.warehouse_id AND variant_id = v_mv.variant_id
        RETURNING quantity_on_hand, total_value INTO v_new_qty, v_new_value;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'PRECONDITION_FAILED: stock position for variant % not found', v_mv.variant_id
                USING ERRCODE = '55000';
        END IF;

        UPDATE inventory.positions
        SET last_known_wac = CASE WHEN v_new_qty > 0 THEN round(v_new_value / v_new_qty, 6) ELSE last_known_wac END
        WHERE warehouse_id = v_mv.warehouse_id AND variant_id = v_mv.variant_id;

        INSERT INTO inventory.movements (
            warehouse_id, variant_id, movement_type, quantity_delta, inventory_value_delta,
            resulting_quantity_on_hand, resulting_total_value, reference_type, reference_id
        ) VALUES (
            v_mv.warehouse_id, v_mv.variant_id, 'RECEIPT', -v_mv.quantity_delta, -v_mv.inventory_value_delta,
            v_new_qty, v_new_value, 'SALE_VOID_LINE', v_void_document_id
        );
        v_restocked_lines := v_restocked_lines + 1;
    END LOOP;

    IF v_restocked_lines = 0 THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: the sale has no stock movements to reverse' USING ERRCODE = '55000';
    END IF;

    -- 11. Money: drawer (cash sale) or customer debt (credit sale).
    IF v_sale_kind = 'CASH' THEN
        IF v_sale_total > 0 THEN
            INSERT INTO cash.movements (
                cash_session_id, business_document_id, movement_type, amount,
                recorded_by_user_id, journal_document_id
            ) VALUES (
                v_session_id, v_void_document_id, 'SALE_VOID', -v_sale_total,
                v_user_id, v_void_journal_id
            );
        END IF;
    ELSE
        INSERT INTO receivables.customer_ledger_entries (
            customer_id, entry_type, amount_delta, document_id, related_entry_id,
            posted_by_user_id, workstation_id
        ) VALUES (
            v_customer_id, 'CREDIT_NOTE', -v_sale_total, v_void_document_id, v_invoice_entry_id,
            v_user_id, v_workstation_id
        );

        SELECT min(l.due_date) INTO v_oldest_due
        FROM receivables.customer_ledger_entries l
        WHERE l.customer_id = v_customer_id
          AND l.entry_type = 'CREDIT_INVOICE'
          AND l.due_date IS NOT NULL
          AND l.amount_delta > receivables.net_invoice_allocated_amount(l.id);

        UPDATE receivables.customer_credit_state
        SET exposure_amount = exposure_amount - v_sale_total,
            oldest_open_due_date = v_oldest_due,
            last_rebuilt_at = now()
        WHERE customer_id = v_customer_id;
    END IF;

    -- 12. The void record.
    INSERT INTO sales.sale_voids (
        void_document_id, original_document_id, sale_kind, reason_code, note,
        total_amount, cash_session_id, journal_document_id, voided_by_user_id, workstation_id
    ) VALUES (
        v_void_document_id, p_document_id, v_sale_kind, p_reason_code, v_note,
        v_sale_total, v_session_id, v_void_journal_id, v_user_id, v_workstation_id
    );

    -- 13. Numbers, posting, and the original becomes REVERSED.
    v_sequence := core.claim_next_document_number('SALE_VOID', v_fiscal_year);
    v_void_number := 'AN-' || v_fiscal_year || '-' || lpad(v_sequence::text, 6, '0');
    UPDATE core.business_documents
    SET status = 'POSTED', sequence_number = v_sequence, document_number = v_void_number, posted_at = now()
    WHERE id = v_void_document_id;

    v_sequence := core.claim_next_document_number('JOURNAL_ENTRY', v_fiscal_year);
    v_journal_number := 'JE-' || v_fiscal_year || '-' || lpad(v_sequence::text, 6, '0');
    UPDATE core.business_documents
    SET status = 'POSTED', sequence_number = v_sequence, document_number = v_journal_number, posted_at = now()
    WHERE id = v_void_journal_id;

    UPDATE core.business_documents SET status = 'REVERSED' WHERE id = p_document_id;

    -- 14. Everything the slip needs.
    IF v_sale_kind = 'CASH' THEN
        SELECT jsonb_agg(jsonb_build_object(
                   'name', l.variant_name_snapshot,
                   'quantity', l.quantity::text,
                   'unit_price', l.unit_price::text,
                   'line_total', l.line_total::text) ORDER BY l.line_number)
        INTO v_lines
        FROM sales.cash_sale_lines l
        WHERE l.document_id = p_document_id;
    ELSE
        SELECT jsonb_agg(jsonb_build_object(
                   'name', l.variant_name_snapshot,
                   'quantity', l.quantity::text,
                   'unit_price', l.unit_price::text,
                   'line_total', l.line_total::text) ORDER BY l.line_number)
        INTO v_lines
        FROM sales.credit_sale_lines l
        WHERE l.document_id = p_document_id;
    END IF;

    RETURN jsonb_build_object(
        'void_document_id', v_void_document_id,
        'void_document_number', v_void_number,
        'original_document_id', p_document_id,
        'original_document_number', v_doc_number,
        'sale_kind', v_sale_kind,
        'customer_name', v_customer_name,
        'subtotal', v_sale_subtotal::text,
        'discount_amount', coalesce(v_sale_discount, 0)::text,
        'total_amount', v_sale_total::text,
        'reason_code', p_reason_code,
        'note', v_note,
        'cash_session_id', v_session_id,
        'journal_document_id', v_void_journal_id,
        'voided_at', now(),
        'lines', coalesce(v_lines, '[]'::jsonb)
    );
END;
$function$

```

## `sales.list_sale_lines` (oid 16981)

```sql
CREATE OR REPLACE FUNCTION sales.list_sale_lines(p_session_token text, p_document_id bigint)
 RETURNS TABLE(line_number integer, variant_sku_snapshot text, variant_name_snapshot text, quantity numeric, unit_price numeric, line_total numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'POST_CASH_SALE');
    RETURN QUERY
        SELECT l.line_number, l.variant_sku_snapshot, l.variant_name_snapshot,
               l.quantity, l.unit_price, l.line_total
        FROM sales.cash_sale_lines l
        WHERE l.document_id = p_document_id
        ORDER BY l.line_number;
END;
$function$

```

## `inventory.confirm_direct_purchase` (oid 19246)

```sql
CREATE OR REPLACE FUNCTION inventory.confirm_direct_purchase(p_session_token text, p_request_id uuid, p_payload_hash bytea, p_supplier_id bigint, p_warehouse_id bigint, p_fiscal_period_id bigint, p_document_date date, p_note text, p_lines jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
    v_user_id bigint;
    v_workstation_id text;
    v_cached_result bigint;
    v_period_status text;
    v_period_start date;
    v_period_end date;
    v_fiscal_year integer;
    v_input_line jsonb;
    v_line_number integer := 0;
    v_variant_id bigint;
    v_unit_id bigint;
    v_qty_received numeric;
    v_unit_cost numeric(14, 2);
    v_base_unit_id bigint;
    v_variant_active boolean;
    v_conversion_factor numeric(20, 6);
    v_base_qty_received numeric(18, 3);
    v_value_delta numeric(18, 4);
    v_line_total numeric(14, 2);
    v_receipt_subtotal numeric(14, 2) := 0;
    v_old_qty numeric(18, 3);
    v_old_value numeric(18, 4);
    v_old_wac numeric(18, 6);
    v_new_qty numeric(18, 3);
    v_new_value numeric(18, 4);
    v_new_wac numeric(18, 6);
    v_movement_id bigint;
    v_receipt_document_id bigint;
    v_journal_document_id bigint;
    v_sequence bigint;
    v_document_number text;
BEGIN
    -- 1. Resolve Session & Permission
    SELECT user_id, workstation_id
    INTO v_user_id, v_workstation_id
    FROM iam.resolve_session_with_permission(p_session_token, 'POST_PURCHASE_RECEIPT');

    -- 2. Idempotency Check
    v_cached_result := core.reserve_idempotent_request(
        'inventory.confirm_direct_purchase', p_request_id, p_payload_hash
    );
    IF v_cached_result IS NOT NULL THEN
        RETURN inventory._purchase_receipt_response(v_cached_result);
    END IF;

    -- 3. Validate Fiscal Period
    SELECT status, starts_on, ends_on, extract(year FROM starts_on)::integer
    INTO v_period_status, v_period_start, v_period_end, v_fiscal_year
    FROM finance.fiscal_periods
    WHERE id = p_fiscal_period_id
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'fiscal period % not found', p_fiscal_period_id USING ERRCODE = '22023';
    END IF;
    IF v_period_status <> 'OPEN' THEN
        RAISE EXCEPTION 'fiscal period % is not open', p_fiscal_period_id USING ERRCODE = '55000';
    END IF;
    IF p_document_date < v_period_start OR p_document_date > v_period_end THEN
        RAISE EXCEPTION 'document date is outside fiscal period' USING ERRCODE = '22023';
    END IF;

    -- 4. Validate Supplier & Warehouse
    PERFORM 1 FROM procurement.suppliers WHERE id = p_supplier_id AND is_active FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'supplier % is inactive or not found', p_supplier_id USING ERRCODE = '22023';
    END IF;

    PERFORM 1 FROM inventory.warehouses WHERE id = p_warehouse_id AND is_active FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'warehouse % is inactive or not found', p_warehouse_id USING ERRCODE = '22023';
    END IF;

    -- 5. Validate Lines
    IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Direct purchase requires at least one product line' USING ERRCODE = '22023';
    END IF;

    -- 6. Deterministic Row Locking on inventory.positions
    PERFORM 1
    FROM inventory.positions pos
    WHERE pos.warehouse_id = p_warehouse_id
      AND pos.variant_id IN (
          SELECT (elem->>'variant_id')::bigint
          FROM jsonb_array_elements(p_lines) elem
          WHERE (elem->>'variant_id') IS NOT NULL
      )
    ORDER BY pos.variant_id
    FOR UPDATE;

    -- 7. Create Business Document for Purchase Receipt
    v_sequence := core.claim_next_document_number('PURCHASE_RECEIPT', v_fiscal_year);
    v_document_number := 'PR-' || v_fiscal_year || '-' || lpad(v_sequence::text, 6, '0');

    INSERT INTO core.business_documents (
        document_type, status, document_date, fiscal_period_id, fiscal_year,
        sequence_number, document_number, posted_at
    ) VALUES (
        'PURCHASE_RECEIPT', 'DRAFT', p_document_date, p_fiscal_period_id, v_fiscal_year,
        NULL, NULL, NULL
    ) RETURNING id INTO v_receipt_document_id;

    -- 8. Insert Purchase Receipt Header
    INSERT INTO procurement.purchase_receipts (
        document_id, receipt_origin, purchase_order_id, supplier_id, warehouse_id,
        subtotal, total_amount, posted_by_user_id, workstation_id
    ) VALUES (
        v_receipt_document_id, 'DIRECT_PURCHASE', NULL, p_supplier_id, p_warehouse_id,
        0.00, 0.00, v_user_id, v_workstation_id
    );

    -- 9. Process Lines
    FOR v_input_line IN SELECT * FROM jsonb_array_elements(p_lines)
    LOOP
        v_line_number := v_line_number + 1;
        v_variant_id := (v_input_line->>'variant_id')::bigint;
        v_unit_id := (v_input_line->>'unit_id')::bigint;
        v_qty_received := (v_input_line->>'quantity_received')::numeric;
        v_unit_cost := (v_input_line->>'unit_cost')::numeric(14, 2);

        IF v_variant_id IS NULL OR v_variant_id <= 0 THEN
            RAISE EXCEPTION 'VALIDATION_ERROR: Line % has invalid variant', v_line_number USING ERRCODE = '22023';
        END IF;
        IF v_unit_id IS NULL OR v_unit_id <= 0 THEN
            RAISE EXCEPTION 'VALIDATION_ERROR: Line % has invalid unit', v_line_number USING ERRCODE = '22023';
        END IF;
        IF v_qty_received IS NULL OR v_qty_received <= 0 THEN
            RAISE EXCEPTION 'VALIDATION_ERROR: Line % quantity must be positive', v_line_number USING ERRCODE = '22023';
        END IF;
        IF v_unit_cost IS NULL OR v_unit_cost < 0 THEN
            RAISE EXCEPTION 'VALIDATION_ERROR: Line % unit cost cannot be negative', v_line_number USING ERRCODE = '22023';
        END IF;

        -- Validate Variant & Unit
        SELECT pv.base_unit_id, (p.is_active AND pv.is_active)
        INTO v_base_unit_id, v_variant_active
        FROM catalog.product_variants pv
        JOIN catalog.products p ON p.id = pv.product_id
        WHERE pv.id = v_variant_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'VALIDATION_ERROR: Variant % not found', v_variant_id USING ERRCODE = '22023';
        END IF;
        IF NOT v_variant_active THEN
            RAISE EXCEPTION 'VALIDATION_ERROR: Variant % or its product is inactive', v_variant_id USING ERRCODE = '22023';
        END IF;

        -- Resolve Unit Conversion
        IF v_unit_id = v_base_unit_id THEN
            v_conversion_factor := 1.0;
        ELSE
            SELECT conversion_factor
            INTO v_conversion_factor
            FROM catalog.variant_units
            WHERE variant_id = v_variant_id
              AND unit_id = v_unit_id
            FOR SHARE;

            IF NOT FOUND OR v_conversion_factor IS NULL OR v_conversion_factor <= 0 THEN
                RAISE EXCEPTION 'VALIDATION_ERROR: No unit conversion for variant % from unit % to base unit %',
                    v_variant_id, v_unit_id, v_base_unit_id USING ERRCODE = '22023';
            END IF;
        END IF;

        v_base_qty_received := round(v_qty_received * v_conversion_factor, 3);
        v_line_total := round(v_qty_received * v_unit_cost, 2);
        v_value_delta := v_line_total;
        v_receipt_subtotal := v_receipt_subtotal + v_line_total;

        -- Lock or create the position before calculating its resulting balance.
        INSERT INTO inventory.positions (warehouse_id, variant_id)
        VALUES (p_warehouse_id, v_variant_id)
        ON CONFLICT (warehouse_id, variant_id) DO NOTHING;

        SELECT quantity_on_hand, total_value, last_known_wac
        INTO v_old_qty, v_old_value, v_old_wac
        FROM inventory.positions
        WHERE warehouse_id = p_warehouse_id AND variant_id = v_variant_id
        FOR UPDATE;

        v_new_qty := v_old_qty + v_base_qty_received;
        v_new_value := v_old_value + v_value_delta;
        v_new_wac := CASE WHEN v_new_qty > 0 THEN round(v_new_value / v_new_qty, 6) ELSE v_old_wac END;

        UPDATE inventory.positions
        SET quantity_on_hand = v_new_qty,
            total_value = v_new_value,
            last_known_wac = v_new_wac,
            updated_at = now()
        WHERE warehouse_id = p_warehouse_id AND variant_id = v_variant_id;

        INSERT INTO inventory.movements (
            warehouse_id, variant_id, movement_type, quantity_delta,
            inventory_value_delta, resulting_quantity_on_hand,
            resulting_total_value, reference_type, reference_id
        ) VALUES (
            p_warehouse_id, v_variant_id, 'RECEIPT', v_base_qty_received,
            v_value_delta, v_new_qty, v_new_value,
            'PURCHASE_RECEIPT', v_receipt_document_id
        ) RETURNING id INTO v_movement_id;

        -- Insert Purchase Receipt Line
        INSERT INTO procurement.purchase_receipt_lines (
            document_id, line_number, po_line_id, variant_id, unit_id,
            quantity_received, unit_cost, line_total, movement_id
        ) VALUES (
            v_receipt_document_id, v_line_number, NULL, v_variant_id, v_unit_id,
            v_qty_received, v_unit_cost, v_line_total, v_movement_id
        );
    END LOOP;

    -- 10. Update Receipt Header Totals
    UPDATE procurement.purchase_receipts
    SET subtotal = v_receipt_subtotal,
        total_amount = v_receipt_subtotal
    WHERE document_id = v_receipt_document_id;

    -- 11. Create Balanced Journal Entry (Dr INVENTORY / Cr GRNI)
    v_journal_document_id := finance.create_posted_journal(
        p_document_date,
        p_fiscal_period_id,
        COALESCE(p_note, 'Direct purchase goods receipt'),
        'PURCHASE_RECEIPT',
        v_receipt_document_id
    );

    INSERT INTO finance.journal_lines (document_id, line_number, account_code, debit, credit)
    VALUES
        (v_journal_document_id, 1, finance.require_account_role('INVENTORY'), v_receipt_subtotal, 0),
        (v_journal_document_id, 2, finance.require_account_role('GRNI'), 0, v_receipt_subtotal);

    UPDATE procurement.purchase_receipts
    SET journal_document_id = v_journal_document_id
    WHERE document_id = v_receipt_document_id;

    UPDATE core.business_documents
    SET status = 'POSTED',
        sequence_number = v_sequence,
        document_number = v_document_number,
        posted_at = now()
    WHERE id = v_receipt_document_id;

    -- 12. Record Idempotency Result
    PERFORM core.record_idempotent_result(
        'inventory.confirm_direct_purchase', p_request_id, v_receipt_document_id
    );

    RETURN inventory._purchase_receipt_response(v_receipt_document_id);
END;
$function$

```

## `inventory.confirm_purchase_receipt` (oid 17471)

```sql
CREATE OR REPLACE FUNCTION inventory.confirm_purchase_receipt(p_session_token text, p_request_id uuid, p_payload_hash bytea, p_purchase_order_id bigint, p_fiscal_period_id bigint, p_document_date date, p_lines jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
    v_user_id bigint;
    v_workstation_id text;
    v_cached_result bigint;
    v_period_status text;
    v_period_start date;
    v_period_end date;
    v_fiscal_year integer;
    v_supplier_id bigint;
    v_warehouse_id bigint;
    v_po_status text;
    v_input_line jsonb;
    v_line_number integer := 0;
    v_po_line_id bigint;
    v_po_document_id bigint;
    v_variant_id bigint;
    v_unit_id bigint;
    v_qty_received numeric;
    v_qty_ordered numeric(18, 3);
    v_prev_received numeric(18, 3);
    v_unit_cost numeric(14, 2);
    v_base_unit_id bigint;
    v_conversion_factor numeric(20, 6);
    v_base_qty_received numeric(18, 3);
    v_value_delta numeric(18, 4);
    v_line_total numeric(14, 2);
    v_receipt_subtotal numeric(14, 2) := 0;
    v_old_qty numeric(18, 3);
    v_old_value numeric(18, 4);
    v_old_wac numeric(18, 6);
    v_new_qty numeric(18, 3);
    v_new_value numeric(18, 4);
    v_new_wac numeric(18, 6);
    v_movement_id bigint;
    v_receipt_document_id bigint;
    v_journal_document_id bigint;
    v_unreceived_count integer;
    v_new_po_status text;
    v_sequence bigint;
    v_document_number text;
BEGIN
    SELECT user_id, workstation_id
    INTO v_user_id, v_workstation_id
    FROM iam.resolve_session_with_permission(p_session_token, 'POST_PURCHASE_RECEIPT');

    v_cached_result := core.reserve_idempotent_request(
        'inventory.confirm_purchase_receipt', p_request_id, p_payload_hash
    );
    IF v_cached_result IS NOT NULL THEN
        RETURN inventory._purchase_receipt_response(v_cached_result);
    END IF;

    SELECT status, starts_on, ends_on, extract(year FROM starts_on)::integer
    INTO v_period_status, v_period_start, v_period_end, v_fiscal_year
    FROM finance.fiscal_periods
    WHERE id = p_fiscal_period_id
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'fiscal period % not found', p_fiscal_period_id USING ERRCODE = '22023';
    END IF;
    IF v_period_status <> 'OPEN' THEN
        RAISE EXCEPTION 'fiscal period % is not open', p_fiscal_period_id USING ERRCODE = '55000';
    END IF;
    IF p_document_date < v_period_start OR p_document_date > v_period_end THEN
        RAISE EXCEPTION 'document date is outside fiscal period' USING ERRCODE = '22023';
    END IF;

    SELECT supplier_id, warehouse_id, status
    INTO v_supplier_id, v_warehouse_id, v_po_status
    FROM procurement.purchase_orders
    WHERE document_id = p_purchase_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'purchase order % not found', p_purchase_order_id USING ERRCODE = '22023';
    END IF;
    IF v_po_status NOT IN ('CONFIRMED', 'PARTIALLY_RECEIVED') THEN
        RAISE EXCEPTION 'purchase order % is not eligible for receipt (status: %)', p_purchase_order_id, v_po_status
            USING ERRCODE = '55000';
    END IF;

    PERFORM 1 FROM procurement.suppliers WHERE id = v_supplier_id AND is_active FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'supplier % is inactive or not found', v_supplier_id USING ERRCODE = '22023';
    END IF;
    PERFORM 1 FROM inventory.warehouses WHERE id = v_warehouse_id AND is_active FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'warehouse % is inactive or not found', v_warehouse_id USING ERRCODE = '22023';
    END IF;

    IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
        RAISE EXCEPTION 'purchase receipt must contain at least one line' USING ERRCODE = '22023';
    END IF;

    PERFORM 1
    FROM procurement.purchase_order_lines pol
    WHERE pol.id IN (
        SELECT DISTINCT (elem ->> 'po_line_id')::bigint
        FROM jsonb_array_elements(p_lines) elem
    )
    ORDER BY pol.id
    FOR UPDATE;

    PERFORM 1
    FROM inventory.positions pos
    WHERE pos.warehouse_id = v_warehouse_id
      AND pos.variant_id IN (
          SELECT DISTINCT pol.variant_id
          FROM jsonb_array_elements(p_lines) elem
          JOIN procurement.purchase_order_lines pol
            ON pol.id = (elem ->> 'po_line_id')::bigint
      )
    ORDER BY pos.variant_id
    FOR UPDATE;

    INSERT INTO core.business_documents (
        document_type, document_date, fiscal_period_id, fiscal_year
    ) VALUES (
        'PURCHASE_RECEIPT', p_document_date, p_fiscal_period_id, v_fiscal_year
    ) RETURNING id INTO v_receipt_document_id;

    INSERT INTO procurement.purchase_receipts (
        document_id, purchase_order_id, supplier_id, warehouse_id,
        subtotal, total_amount, posted_by_user_id, workstation_id
    ) VALUES (
        v_receipt_document_id, p_purchase_order_id, v_supplier_id, v_warehouse_id,
        0, 0, v_user_id, v_workstation_id
    );

    FOR v_input_line IN SELECT jsonb_array_elements(p_lines)
    LOOP
        v_line_number := v_line_number + 1;
        v_po_line_id := (v_input_line ->> 'po_line_id')::bigint;
        v_qty_received := (v_input_line ->> 'quantity_received')::numeric;

        IF v_po_line_id IS NULL OR v_qty_received IS NULL OR v_qty_received <= 0 THEN
            RAISE EXCEPTION 'line % must have valid po_line_id and positive quantity_received', v_line_number
                USING ERRCODE = '22023';
        END IF;

        SELECT document_id, variant_id, unit_id, quantity_ordered, quantity_received, unit_cost
        INTO v_po_document_id, v_variant_id, v_unit_id, v_qty_ordered, v_prev_received, v_unit_cost
        FROM procurement.purchase_order_lines
        WHERE id = v_po_line_id;

        IF NOT FOUND OR v_po_document_id <> p_purchase_order_id THEN
            RAISE EXCEPTION 'purchase order line % does not belong to purchase order %', v_po_line_id, p_purchase_order_id
                USING ERRCODE = '22023';
        END IF;
        IF v_prev_received + v_qty_received > v_qty_ordered THEN
            RAISE EXCEPTION 'receipt quantity exceeds remaining ordered quantity for line %', v_line_number
                USING ERRCODE = '55000';
        END IF;

        SELECT pv.base_unit_id
        INTO v_base_unit_id
        FROM catalog.product_variants pv
        JOIN catalog.products p ON p.id = pv.product_id
        WHERE pv.id = v_variant_id AND pv.is_active AND p.is_active
        FOR SHARE OF pv, p;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'variant % is inactive or not found', v_variant_id USING ERRCODE = '22023';
        END IF;

        IF v_unit_id = v_base_unit_id THEN
            v_conversion_factor := 1;
        ELSE
            SELECT vu.conversion_factor
            INTO v_conversion_factor
            FROM catalog.variant_units vu
            WHERE vu.variant_id = v_variant_id AND vu.unit_id = v_unit_id
            FOR SHARE;
            IF NOT FOUND THEN
                RAISE EXCEPTION 'unit % is invalid for variant %', v_unit_id, v_variant_id USING ERRCODE = '22023';
            END IF;
        END IF;

        v_base_qty_received := v_qty_received * v_conversion_factor;
        v_line_total := round(v_qty_received * v_unit_cost, 2);
        v_receipt_subtotal := v_receipt_subtotal + v_line_total;
        v_value_delta := round(v_base_qty_received * (v_unit_cost / v_conversion_factor), 4);

        INSERT INTO inventory.positions (warehouse_id, variant_id)
        VALUES (v_warehouse_id, v_variant_id)
        ON CONFLICT (warehouse_id, variant_id) DO NOTHING;

        SELECT quantity_on_hand, total_value, last_known_wac
        INTO v_old_qty, v_old_value, v_old_wac
        FROM inventory.positions
        WHERE warehouse_id = v_warehouse_id AND variant_id = v_variant_id
        FOR UPDATE;

        v_new_qty := v_old_qty + v_base_qty_received;
        v_new_value := v_old_value + v_value_delta;
        v_new_wac := CASE WHEN v_new_qty > 0 THEN v_new_value / v_new_qty ELSE v_old_wac END;

        UPDATE inventory.positions
        SET quantity_on_hand = v_new_qty,
            total_value = v_new_value,
            last_known_wac = v_new_wac
        WHERE warehouse_id = v_warehouse_id AND variant_id = v_variant_id;

        INSERT INTO inventory.movements (
            warehouse_id, variant_id, movement_type, quantity_delta,
            inventory_value_delta, resulting_quantity_on_hand,
            resulting_total_value, reference_type, reference_id
        ) VALUES (
            v_warehouse_id, v_variant_id, 'RECEIPT', v_base_qty_received,
            v_value_delta, v_new_qty, v_new_value,
            'PURCHASE_RECEIPT', v_receipt_document_id
        ) RETURNING id INTO v_movement_id;

        INSERT INTO procurement.purchase_receipt_lines (
            document_id, line_number, po_line_id, variant_id, unit_id,
            quantity_received, unit_cost, line_total, movement_id
        ) VALUES (
            v_receipt_document_id, v_line_number, v_po_line_id, v_variant_id, v_unit_id,
            v_qty_received, v_unit_cost, v_line_total, v_movement_id
        );

        UPDATE procurement.purchase_order_lines
        SET quantity_received = quantity_received + v_qty_received
        WHERE id = v_po_line_id;
    END LOOP;

    UPDATE procurement.purchase_receipts
    SET subtotal = v_receipt_subtotal,
        total_amount = v_receipt_subtotal
    WHERE document_id = v_receipt_document_id;

    SELECT count(*)
    INTO v_unreceived_count
    FROM procurement.purchase_order_lines
    WHERE document_id = p_purchase_order_id
      AND quantity_received < quantity_ordered;
    v_new_po_status := CASE WHEN v_unreceived_count = 0 THEN 'RECEIVED' ELSE 'PARTIALLY_RECEIVED' END;
    UPDATE procurement.purchase_orders SET status = v_new_po_status WHERE document_id = p_purchase_order_id;

    IF v_receipt_subtotal > 0 THEN
        v_journal_document_id := finance.create_posted_journal(
            p_document_date,
            p_fiscal_period_id,
            'Purchase goods receipt',
            'PURCHASE_RECEIPT',
            v_receipt_document_id
        );

        INSERT INTO finance.journal_lines (
            document_id, line_number, account_code, debit, credit
        ) VALUES
            (v_journal_document_id, 1, finance.require_account_role('INVENTORY'), v_receipt_subtotal, 0),
            (v_journal_document_id, 2, finance.require_account_role('GRNI'), 0, v_receipt_subtotal);

        UPDATE procurement.purchase_receipts
        SET journal_document_id = v_journal_document_id
        WHERE document_id = v_receipt_document_id;
    END IF;

    -- A receipt accrues GRNI; it is not yet a supplier payable. AP and the
    -- supplier liability are created only by a confirmed invoice (or by the
    -- separately posted landed-cost payable).
    v_sequence := core.claim_next_document_number('PURCHASE_RECEIPT', v_fiscal_year);
    v_document_number := 'PR-' || v_fiscal_year || '-' || lpad(v_sequence::text, 6, '0');
    UPDATE core.business_documents
    SET status = 'POSTED', sequence_number = v_sequence,
        document_number = v_document_number, posted_at = now()
    WHERE id = v_receipt_document_id;

    PERFORM core.record_idempotent_result(
        'inventory.confirm_purchase_receipt', p_request_id, v_receipt_document_id
    );

    RETURN inventory._purchase_receipt_response(v_receipt_document_id);
END;
$function$

```

## `procurement.post_purchase_transaction` (oid 19209)

```sql
CREATE OR REPLACE FUNCTION procurement.post_purchase_transaction(p_session_token text, p_request_id uuid, p_request_hash bytea, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
    v_user_id bigint;
    v_workstation_id text;
    v_existing_doc_id bigint;

    v_supplier_id bigint;
    v_supplier_rec record;
    v_external_doc_num text;
    v_doc_date date;
    v_fiscal_period_id bigint;
    v_period_status text;
    v_period_start date;
    v_period_end date;
    v_fiscal_year integer;
    v_warehouse_id bigint;

    v_payment_status text;
    v_payment_method text;
    v_paid_amount numeric(14,2) := 0;
    v_outstanding_amount numeric(14,2) := 0;
    v_due_terms_days integer;
    v_due_date date;

    v_require_cash_session boolean;
    v_cash_session_id bigint;
    v_default_bank_account text;

    v_lines jsonb;
    v_line_rec record;
    v_line_idx integer := 0;
    v_gross_subtotal numeric(14,2) := 0;
    v_total_additional_cost numeric(14,2) := 0;
    v_grand_total numeric(14,2) := 0;

    v_po_lines_json jsonb := '[]'::jsonb;
    v_rcpt_lines_json jsonb := '[]'::jsonb;
    v_inv_lines_json jsonb := '[]'::jsonb;

    v_root_doc_id bigint;
    v_root_doc_num text;
    v_po_doc_id bigint;
    v_po_doc_num text;
    v_rcpt_doc_id bigint;
    v_rcpt_doc_num text;
    v_inv_doc_id bigint;
    v_inv_doc_num text;
    v_pay_doc_id bigint := NULL;
    v_pay_doc_num text := NULL;
    v_liability_id bigint := NULL;
    v_landed_cost_doc_ids jsonb := '[]'::jsonb;

    v_add_costs jsonb;
    v_add_cost_item record;

    v_print_after boolean;
    v_gen_status text := 'NOT_ENQUEUED';
    v_print_status text := NULL;
    v_res jsonb;
BEGIN
    -- 1. Resolve Session & Permission
    SELECT user_id, workstation_id INTO v_user_id, v_workstation_id
    FROM iam.resolve_session_with_permission(p_session_token, 'POST_PURCHASE_TRANSACTION');

    -- 2. Idempotency Check
    v_existing_doc_id := core.reserve_idempotent_request(
        'procurement.post_purchase_transaction', p_request_id, p_request_hash
    );
    IF v_existing_doc_id IS NOT NULL THEN
        SELECT bd.document_number INTO v_root_doc_num
        FROM core.business_documents bd WHERE bd.id = v_existing_doc_id;

        SELECT jsonb_build_object(
            'document_id', pt.document_id,
            'document_number', v_root_doc_num,
            'status', 'POSTED',
            'supplier_id', pt.supplier_id,
            'warehouse_id', pt.warehouse_id,
            'gross_subtotal', pt.gross_subtotal::text,
            'discount_amount', '0.00',
            'tax_amount', '0.00',
            'total_amount', pt.total_amount::text,
            'payment_status', pt.payment_status,
            'payment_method', pt.payment_method,
            'paid_amount', pt.paid_amount::text,
            'outstanding_amount', pt.outstanding_amount::text,
            'due_date', pt.due_date,
            'child_documents', jsonb_build_object(
                'purchase_order_id', pt.purchase_order_id,
                'goods_receipt_id', pt.goods_receipt_id,
                'supplier_invoice_id', pt.supplier_invoice_id,
                'supplier_payment_id', pt.supplier_payment_id
            ),
            'generation_status', 'COMPLETED',
            'print_status', 'COMPLETED'
        ) INTO v_res
        FROM procurement.purchase_transactions pt
        WHERE pt.document_id = v_existing_doc_id;

        RETURN v_res;
    END IF;

    -- 3. Resolve Warehouse
    SELECT default_warehouse_id INTO v_warehouse_id FROM core.system_state WHERE id = 1;
    IF v_warehouse_id IS NULL THEN
        SELECT id INTO v_warehouse_id FROM inventory.warehouses WHERE is_active = true ORDER BY id LIMIT 1;
    END IF;
    IF v_warehouse_id IS NULL THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: No active default warehouse configured' USING ERRCODE = '55000';
    END IF;

    -- 4. Parse Header Payload
    v_supplier_id := (p_payload->>'supplier_id')::bigint;
    v_external_doc_num := trim(p_payload->>'external_supplier_document_number');
    IF v_external_doc_num = '' THEN
        v_external_doc_num := NULL;
    END IF;

    v_doc_date := (p_payload->>'document_date')::date;
    v_payment_status := p_payload->>'payment_status';
    v_payment_method := p_payload->>'payment_method';
    v_print_after := COALESCE((p_payload->>'print_after_confirmation')::boolean, true);

    IF v_supplier_id IS NULL OR v_supplier_id <= 0 THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Supplier is required' USING ERRCODE = '22023';
    END IF;
    IF v_doc_date IS NULL THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Document date is required' USING ERRCODE = '22023';
    END IF;
    IF v_payment_status NOT IN ('PAID', 'PARTIALLY_PAID', 'UNPAID') THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Invalid payment status' USING ERRCODE = '22023';
    END IF;

    -- Supplier validation & uniqueness check
    SELECT * INTO v_supplier_rec FROM procurement.suppliers WHERE id = v_supplier_id AND is_active = true;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Supplier does not exist or is inactive' USING ERRCODE = '22023';
    END IF;

    IF v_external_doc_num IS NOT NULL AND EXISTS (
        SELECT 1 FROM procurement.purchase_transactions
        WHERE supplier_id = v_supplier_id AND external_supplier_document_number = v_external_doc_num
    ) THEN
        RAISE EXCEPTION 'DUPLICATE_SUPPLIER_DOCUMENT: This supplier document has already been recorded' USING ERRCODE = '23505';
    END IF;

    -- 5. Resolve Fiscal Period
    v_fiscal_year := extract(year FROM v_doc_date)::integer;
    SELECT id, status, starts_on, ends_on
    INTO v_fiscal_period_id, v_period_status, v_period_start, v_period_end
    FROM finance.fiscal_periods
    WHERE status = 'OPEN' AND starts_on <= v_doc_date AND ends_on >= v_doc_date
    ORDER BY id DESC LIMIT 1;

    IF v_fiscal_period_id IS NULL THEN
        SELECT id, status, starts_on, ends_on
        INTO v_fiscal_period_id, v_period_status, v_period_start, v_period_end
        FROM finance.fiscal_periods WHERE status = 'OPEN' ORDER BY id DESC LIMIT 1;
    END IF;
    IF v_fiscal_period_id IS NULL THEN
        RAISE EXCEPTION 'CLOSED_FISCAL_PERIOD: No open fiscal period exists' USING ERRCODE = '55000';
    END IF;

    -- Ensure document date matches open fiscal period bounds
    IF v_doc_date < v_period_start THEN
        v_doc_date := v_period_start;
    ELSIF v_doc_date > v_period_end THEN
        v_doc_date := v_period_end;
    END IF;

    -- 6. Validate Lines & Recompute Totals
    v_lines := p_payload->'lines';
    IF v_lines IS NULL OR jsonb_typeof(v_lines) <> 'array' OR jsonb_array_length(v_lines) = 0 THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Purchase transaction must contain at least one product line' USING ERRCODE = '22023';
    END IF;

    FOR v_line_rec IN SELECT * FROM jsonb_to_recordset(v_lines) AS x(
        variant_id bigint,
        unit_id bigint,
        quantity numeric,
        unit_cost numeric
    ) LOOP
        v_line_idx := v_line_idx + 1;
        IF v_line_rec.variant_id IS NULL OR v_line_rec.variant_id <= 0 THEN
            RAISE EXCEPTION 'VALIDATION_ERROR: Line % has invalid variant', v_line_idx USING ERRCODE = '22023';
        END IF;
        IF v_line_rec.quantity IS NULL OR v_line_rec.quantity <= 0 THEN
            RAISE EXCEPTION 'VALIDATION_ERROR: Line % quantity must be positive', v_line_idx USING ERRCODE = '22023';
        END IF;
        IF v_line_rec.unit_cost IS NULL OR v_line_rec.unit_cost < 0 THEN
            RAISE EXCEPTION 'VALIDATION_ERROR: Line % unit cost cannot be negative', v_line_idx USING ERRCODE = '22023';
        END IF;

        DECLARE
            v_line_gross numeric(14,2) := round(v_line_rec.quantity * v_line_rec.unit_cost, 2);
        BEGIN
            v_gross_subtotal := v_gross_subtotal + v_line_gross;
        END;
    END LOOP;

    -- Calculate additional costs if provided
    v_add_costs := p_payload->'additional_costs';
    IF v_add_costs IS NOT NULL AND jsonb_typeof(v_add_costs) = 'array' AND jsonb_array_length(v_add_costs) > 0 THEN
        FOR v_add_cost_item IN SELECT * FROM jsonb_to_recordset(v_add_costs) AS c(cost_type text, amount numeric) LOOP
            IF v_add_cost_item.amount IS NOT NULL AND v_add_cost_item.amount > 0 THEN
                v_total_additional_cost := v_total_additional_cost + round(v_add_cost_item.amount, 2);
            END IF;
        END LOOP;
    END IF;

    v_grand_total := v_gross_subtotal + v_total_additional_cost;

    -- 7. Payment Logic & Session/Bank Validation
    IF v_payment_status = 'PAID' THEN
        IF v_payment_method NOT IN ('CASH', 'BANK_TRANSFER') THEN
            RAISE EXCEPTION 'VALIDATION_ERROR: Paid status requires Cash or Bank payment method' USING ERRCODE = '22023';
        END IF;
        v_paid_amount := v_grand_total;
        v_outstanding_amount := 0;
    ELSIF v_payment_status = 'PARTIALLY_PAID' THEN
        IF v_payment_method NOT IN ('CASH', 'BANK_TRANSFER') THEN
            RAISE EXCEPTION 'VALIDATION_ERROR: Partially Paid status requires Cash or Bank payment method' USING ERRCODE = '22023';
        END IF;
        v_paid_amount := COALESCE((p_payload->>'paid_amount')::numeric, 0);
        IF v_paid_amount <= 0 OR v_paid_amount >= v_grand_total THEN
            RAISE EXCEPTION 'VALIDATION_ERROR: Partially Paid amount must be greater than zero and less than total amount' USING ERRCODE = '22023';
        END IF;
        v_outstanding_amount := v_grand_total - v_paid_amount;
    ELSE -- UNPAID
        v_payment_method := NULL;
        v_paid_amount := 0;
        v_outstanding_amount := v_grand_total;
    END IF;

    IF v_payment_method = 'CASH' THEN
        v_require_cash_session := (core.get_setting('require_open_cash_session_for_purchase_cash_payment', 'true') = 'true');
        IF v_require_cash_session THEN
            SELECT cs.id INTO v_cash_session_id
            FROM sales.cash_sessions cs
            WHERE (cs.current_cashier_user_id = v_user_id OR cs.opened_by_user_id = v_user_id) AND cs.status = 'OPEN'
            ORDER BY cs.opened_at DESC LIMIT 1;

            IF v_cash_session_id IS NULL THEN
                RAISE EXCEPTION 'CASH_SESSION_REQUIRED: A cash session must be open before paying a supplier with cash' USING ERRCODE = '55000';
            END IF;
        END IF;
    ELSIF v_payment_method = 'BANK_TRANSFER' THEN
        v_default_bank_account := core.get_setting('default_purchase_bank_account', '');
        IF COALESCE(NULLIF(v_default_bank_account, ''), '') = '' THEN
            RAISE EXCEPTION 'default_purchase_bank_account setting is required for BANK_TRANSFER payments' USING ERRCODE = '55000';
        END IF;
    END IF;

    -- Due date resolution
    v_due_terms_days := COALESCE(NULLIF(core.get_setting('default_supplier_payment_terms', '30'), '')::integer, 30);
    v_due_date := v_doc_date + v_due_terms_days;

    -- 8. Create Internal Purchase Order (Draft + Confirm)
    DECLARE
        v_po_seq bigint := core.claim_next_document_number('PURCHASE_ORDER', v_fiscal_year);
    BEGIN
        v_po_doc_num := 'PO-' || v_fiscal_year || '-' || lpad(v_po_seq::text, 6, '0');
        INSERT INTO core.business_documents (document_type, sequence_number, document_number, status, document_date, fiscal_year, fiscal_period_id, posted_at)
        VALUES ('PURCHASE_ORDER', v_po_seq, v_po_doc_num, 'POSTED', v_doc_date, v_fiscal_year, v_fiscal_period_id, now())
        RETURNING id INTO v_po_doc_id;
    END;

    INSERT INTO procurement.purchase_orders (
        document_id, supplier_id, warehouse_id, status, subtotal, total_amount, note, created_by_user_id, confirmed_at, confirmed_by_user_id
    ) VALUES (
        v_po_doc_id, v_supplier_id, v_warehouse_id, 'CONFIRMED', v_gross_subtotal, v_gross_subtotal, p_payload->>'note', v_user_id, now(), v_user_id
    );

    -- Build lines for PO, Receipt, Invoice
    v_line_idx := 0;
    FOR v_line_rec IN SELECT * FROM jsonb_to_recordset(v_lines) AS x(
        variant_id bigint,
        unit_id bigint,
        quantity numeric,
        unit_cost numeric
    ) LOOP
        v_line_idx := v_line_idx + 1;
        DECLARE
            v_l_gross numeric(14,2) := round(v_line_rec.quantity * v_line_rec.unit_cost, 2);
            v_l_total numeric(14,2) := v_l_gross;
            v_po_line_id bigint;
            v_sku text;
            v_pname text;
            v_bname text;
            v_ucode text;
        BEGIN
            SELECT pv.sku, p.name, b.name, u.code
            INTO v_sku, v_pname, v_bname, v_ucode
            FROM catalog.product_variants pv
            JOIN catalog.products p ON p.id = pv.product_id
            JOIN catalog.units u ON u.id = COALESCE(v_line_rec.unit_id, p.unit_id)
            LEFT JOIN catalog.brands b ON b.id = p.brand_id
            WHERE pv.id = v_line_rec.variant_id;

            INSERT INTO procurement.purchase_order_lines (
                document_id, line_number, variant_id, unit_id, quantity_ordered, unit_cost, line_total
            ) VALUES (
                v_po_doc_id, v_line_idx, v_line_rec.variant_id, COALESCE(v_line_rec.unit_id, 1), v_line_rec.quantity, v_line_rec.unit_cost, v_l_gross
            ) RETURNING id INTO v_po_line_id;

            v_rcpt_lines_json := v_rcpt_lines_json || jsonb_build_object(
                'po_line_id', v_po_line_id,
                'quantity_received', v_line_rec.quantity::text
            );
        END;
    END LOOP;

    -- 9. Post Goods Receipt (Native PG18 sha256)
    DECLARE
        v_rcpt_res jsonb;
    BEGIN
        v_rcpt_res := inventory.confirm_purchase_receipt(
            p_session_token,
            gen_random_uuid(),
            sha256(convert_to(jsonb_build_object('po_id', v_po_doc_id, 'rcpt_lines', v_rcpt_lines_json)::text, 'UTF8')),
            v_po_doc_id,
            v_fiscal_period_id,
            v_doc_date,
            v_rcpt_lines_json
        );
        v_rcpt_doc_id := (v_rcpt_res->>'document_id')::bigint;
        v_rcpt_doc_num := v_rcpt_res->>'document_number';
    END;

    -- 10. Allocate Landed Costs if present (Native PG18 sha256)
    IF v_total_additional_cost > 0 AND v_add_costs IS NOT NULL AND jsonb_typeof(v_add_costs) = 'array' THEN
        FOR v_add_cost_item IN SELECT * FROM jsonb_to_recordset(v_add_costs) AS c(cost_type text, amount numeric) LOOP
            IF v_add_cost_item.amount IS NOT NULL AND v_add_cost_item.amount > 0 THEN
                DECLARE
                    v_lc_res jsonb;
                BEGIN
                    v_lc_res := procurement.allocate_landed_cost(
                        p_session_token,
                        gen_random_uuid(),
                        sha256(convert_to(jsonb_build_object('rcpt_id', v_rcpt_doc_id, 'amount', v_add_cost_item.amount, 'type', v_add_cost_item.cost_type)::text, 'UTF8')),
                        v_rcpt_doc_id,
                        'WEIGHT',
                        '["FREIGHT"]'::jsonb,
                        v_add_cost_item.amount,
                        v_add_cost_item.cost_type,
                        v_fiscal_period_id,
                        v_doc_date
                    );
                    v_landed_cost_doc_ids := v_landed_cost_doc_ids || (v_lc_res->'document_id');
                END;
            END IF;
        END LOOP;
    END IF;

    -- 11. Create & Confirm Supplier Invoice (Native PG18 sha256)
    DECLARE
        v_inv_draft_res jsonb;
        v_inv_confirm_res jsonb;
    BEGIN
        SELECT coalesce(jsonb_agg(jsonb_build_object(
            'line_number', prl.line_number,
            'po_line_id', prl.po_line_id,
            'receipt_line_id', prl.id,
            'variant_id', prl.variant_id,
            'quantity', prl.quantity_received::text,
            'unit_cost', prl.unit_cost::text
        )), '[]'::jsonb) INTO v_inv_lines_json
        FROM procurement.purchase_receipt_lines prl
        WHERE prl.document_id = v_rcpt_doc_id;

        v_inv_draft_res := procurement.create_supplier_invoice_draft(
            p_session_token,
            v_supplier_id,
            v_po_doc_id,
            'DZD',
            1.0,
            p_payload->>'note',
            v_inv_lines_json
        );
        v_inv_doc_id := (v_inv_draft_res->>'document_id')::bigint;

        v_inv_confirm_res := procurement.confirm_supplier_invoice(
            p_session_token,
            gen_random_uuid(),
            sha256(convert_to(jsonb_build_object('inv_id', v_inv_doc_id)::text, 'UTF8')),
            v_inv_doc_id,
            v_fiscal_period_id,
            v_doc_date
        );
        v_inv_doc_num := v_inv_confirm_res->>'document_number';

        SELECT id INTO v_liability_id
        FROM procurement.supplier_liabilities
        WHERE invoice_document_id = v_inv_doc_id;
    END;

    -- 12. Post Supplier Payment if applicable (Native PG18 sha256)
    IF v_payment_status IN ('PAID', 'PARTIALLY_PAID') AND v_paid_amount > 0 THEN
        DECLARE
            v_pay_res jsonb;
        BEGIN
            v_pay_res := procurement.post_supplier_payment(
                p_session_token,
                gen_random_uuid(),
                sha256(convert_to(jsonb_build_object('liability_id', v_liability_id, 'amount', v_paid_amount)::text, 'UTF8')),
                v_supplier_id,
                v_liability_id,
                v_paid_amount,
                v_payment_method,
                v_fiscal_period_id,
                v_doc_date,
                'Single-entry purchase payment'
            );
            v_pay_doc_id := (v_pay_res->>'document_id')::bigint;
            v_pay_doc_num := v_pay_res->>'document_number';
        END;
    END IF;

    -- 13. Create Root Business Document & Record Storage
    DECLARE
        v_root_seq bigint := core.claim_next_document_number('PURCHASE_TRANSACTION', v_fiscal_year);
    BEGIN
        v_root_doc_num := 'PUR-' || v_fiscal_year || '-' || lpad(v_root_seq::text, 6, '0');
        INSERT INTO core.business_documents (document_type, sequence_number, document_number, status, document_date, fiscal_year, fiscal_period_id, posted_at)
        VALUES ('PURCHASE_TRANSACTION', v_root_seq, v_root_doc_num, 'POSTED', v_doc_date, v_fiscal_year, v_fiscal_period_id, now())
        RETURNING id INTO v_root_doc_id;

        INSERT INTO procurement.purchase_transactions (
            document_id, supplier_id, warehouse_id, external_supplier_document_number,
            payment_status, payment_method, gross_subtotal, discount_amount, tax_amount, additional_cost_amount,
            total_amount, paid_amount, outstanding_amount, due_date,
            purchase_order_id, goods_receipt_id, supplier_invoice_id, supplier_payment_id,
            note, supplier_snapshot
        ) VALUES (
            v_root_doc_id, v_supplier_id, v_warehouse_id, v_external_doc_num,
            v_payment_status, v_payment_method, v_gross_subtotal, 0, 0, v_total_additional_cost,
            v_grand_total, v_paid_amount, v_outstanding_amount, v_due_date,
            v_po_doc_id, v_rcpt_doc_id, v_inv_doc_id, v_pay_doc_id,
            p_payload->>'note', jsonb_build_object('id', v_supplier_rec.id, 'code', v_supplier_rec.code, 'name', v_supplier_rec.name)
        );

        -- Insert Line Records
        v_line_idx := 0;
        FOR v_line_rec IN SELECT * FROM jsonb_to_recordset(v_lines) AS x(
            variant_id bigint,
            unit_id bigint,
            quantity numeric,
            unit_cost numeric
        ) LOOP
            v_line_idx := v_line_idx + 1;
            DECLARE
                v_l_gross numeric(14,2) := round(v_line_rec.quantity * v_line_rec.unit_cost, 2);
                v_l_total numeric(14,2) := v_l_gross;
                v_sku text;
                v_pname text;
                v_bname text;
                v_ucode text;
                v_attrs jsonb;
            BEGIN
                SELECT pv.sku, p.name, b.name, u.code,
                    coalesce((
                        SELECT jsonb_agg(jsonb_build_object('name', a.name, 'value', val.value))
                        FROM catalog.variant_attribute_values vav
                        JOIN catalog.attribute_values val ON val.id = vav.attribute_value_id
                        JOIN catalog.attributes a ON a.id = val.attribute_id
                        WHERE vav.variant_id = pv.id
                    ), '[]'::jsonb)
                INTO v_sku, v_pname, v_bname, v_ucode, v_attrs
                FROM catalog.product_variants pv
                JOIN catalog.products p ON p.id = pv.product_id
                JOIN catalog.units u ON u.id = COALESCE(v_line_rec.unit_id, p.unit_id)
                LEFT JOIN catalog.brands b ON b.id = p.brand_id
                WHERE pv.id = v_line_rec.variant_id;

                INSERT INTO procurement.purchase_transaction_lines (
                    document_id, line_number, variant_id, unit_id, quantity, unit_cost,
                    gross_amount, discount_amount, tax_amount, line_total,
                    sku_snapshot, product_name_snapshot, brand_snapshot, attributes_snapshot, unit_code_snapshot
                ) VALUES (
                    v_root_doc_id, v_line_idx, v_line_rec.variant_id, COALESCE(v_line_rec.unit_id, 1),
                    v_line_rec.quantity, v_line_rec.unit_cost,
                    v_l_gross, 0, 0, v_l_total,
                    v_sku, v_pname, v_bname, v_attrs, v_ucode
                );
            END;
        END LOOP;
    END;

    -- 14. Document Print Job Enqueue if requested
    IF v_print_after THEN
        PERFORM * FROM documents.enqueue_business_document_jobs(
            v_root_doc_id,
            'PURCHASE_RECEIPT_PDF',
            'purchase_receipt:' || v_root_doc_id::text
        );
        v_gen_status := 'PENDING';
        v_print_status := 'WAITING_FOR_GENERATION';
    ELSE
        v_gen_status := 'NOT_ENQUEUED';
        v_print_status := NULL;
    END IF;

    -- Return JSON Result
    SELECT jsonb_build_object(
        'document_id', v_root_doc_id,
        'document_number', v_root_doc_num,
        'status', 'POSTED',
        'supplier_id', v_supplier_id,
        'warehouse_id', v_warehouse_id,
        'gross_subtotal', v_gross_subtotal::text,
        'discount_amount', '0.00',
        'tax_amount', '0.00',
        'total_amount', v_grand_total::text,
        'payment_status', v_payment_status,
        'payment_method', v_payment_method,
        'paid_amount', v_paid_amount::text,
        'outstanding_amount', v_outstanding_amount::text,
        'due_date', v_due_date,
        'child_documents', jsonb_build_object(
            'purchase_order_id', v_po_doc_id,
            'goods_receipt_id', v_rcpt_doc_id,
            'supplier_invoice_id', v_inv_doc_id,
            'supplier_payment_id', v_pay_doc_id
        ),
        'generation_status', v_gen_status,
        'print_status', v_print_status
    ) INTO v_res;

    RETURN v_res;
END;
$function$

```

## `procurement.confirm_purchase_return` (oid 19737)

```sql
CREATE OR REPLACE FUNCTION procurement.confirm_purchase_return(p_session_token text, p_request_id uuid, p_payload_hash bytea, p_receipt_document_id bigint, p_fiscal_period_id bigint, p_document_date date, p_reason_code text, p_note text, p_lines jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
    v_user_id bigint;
    v_cached_result bigint;
    v_period_status text;
    v_period_start date;
    v_period_end date;
    v_fiscal_year integer;
    v_supplier_id bigint;
    v_warehouse_id bigint;
    v_sequence bigint;
    v_document_number text;
    v_return_document_id bigint;
    v_journal_document_id bigint;
    v_input_line jsonb;
    v_line_number integer := 0;
    v_receipt_line_id bigint;
    v_quantity numeric(18, 3);
    v_variant_id bigint;
    v_unit_id bigint;
    v_unit_cost numeric(14, 2);
    v_quantity_received numeric(18, 3);
    v_already_returned numeric(18, 3);
    v_base_unit_id bigint;
    v_conversion_factor numeric(20, 6);
    v_base_quantity numeric(18, 3);
    v_old_qty numeric(18, 3);
    v_old_value numeric(18, 4);
    v_old_wac numeric(18, 6);
    v_new_qty numeric(18, 3);
    v_new_value numeric(18, 4);
    v_line_inventory_value numeric(14, 2);
    v_line_refund numeric(14, 2);
    v_movement_id bigint;
    v_refund_total numeric(14, 2) := 0;
    v_inventory_total numeric(14, 2) := 0;
    v_variance numeric(14, 2);
    v_journal_line_number integer;
BEGIN
    -- 1. Session and permission
    SELECT user_id INTO v_user_id
    FROM iam.resolve_session_with_permission(p_session_token, 'POST_SUPPLIER_RETURN');

    -- 2. Idempotency
    v_cached_result := core.reserve_idempotent_request(
        'procurement.confirm_purchase_return', p_request_id, p_payload_hash
    );
    IF v_cached_result IS NOT NULL THEN
        RETURN procurement._purchase_return_response(v_cached_result);
    END IF;

    -- 3. Reason and lines
    IF p_reason_code IS NULL OR p_reason_code NOT IN ('DEFECTIVE_GOODS', 'EXCESS_DELIVERY', 'WRONG_ITEM', 'OTHER') THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: unsupported supplier return reason'
            USING ERRCODE = '22023';
    END IF;

    IF p_reason_code = 'OTHER' AND (p_note IS NULL OR btrim(p_note) = '') THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: note is required when reason is OTHER'
            USING ERRCODE = '22023';
    END IF;

    IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: a supplier return needs at least one line'
            USING ERRCODE = '22023';
    END IF;

    IF (SELECT count(DISTINCT (item ->> 'receipt_line_id')::bigint)
        FROM jsonb_array_elements(p_lines) item) <> jsonb_array_length(p_lines) THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: the same purchase line appears twice on this return'
            USING ERRCODE = '22023';
    END IF;

    -- 4. Fiscal period
    SELECT status, starts_on, ends_on, extract(year FROM starts_on)::integer
    INTO v_period_status, v_period_start, v_period_end, v_fiscal_year
    FROM finance.fiscal_periods
    WHERE id = p_fiscal_period_id
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'fiscal period % not found', p_fiscal_period_id USING ERRCODE = '22023';
    END IF;
    IF v_period_status <> 'OPEN' THEN
        RAISE EXCEPTION 'fiscal period % is not open', p_fiscal_period_id USING ERRCODE = '55000';
    END IF;
    IF p_document_date < v_period_start OR p_document_date > v_period_end THEN
        RAISE EXCEPTION 'document date is outside fiscal period' USING ERRCODE = '22023';
    END IF;

    -- 5. Lock the receipt
    SELECT receipt.supplier_id, receipt.warehouse_id
    INTO v_supplier_id, v_warehouse_id
    FROM procurement.purchase_receipts receipt
    JOIN core.business_documents document ON document.id = receipt.document_id
    WHERE receipt.document_id = p_receipt_document_id
      AND document.status = 'POSTED'
    FOR UPDATE OF receipt;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: posted purchase receipt % not found', p_receipt_document_id
            USING ERRCODE = '55000';
    END IF;

    -- 6. Return business document
    v_sequence := core.claim_next_document_number('PURCHASE_RETURN', v_fiscal_year);
    v_document_number := 'PRT-' || v_fiscal_year || '-' || lpad(v_sequence::text, 6, '0');

    INSERT INTO core.business_documents (
        document_type, status, document_date, fiscal_period_id, fiscal_year,
        sequence_number, document_number, posted_at
    ) VALUES (
        'PURCHASE_RETURN', 'POSTED', p_document_date, p_fiscal_period_id, v_fiscal_year,
        v_sequence, v_document_number, now()
    ) RETURNING id INTO v_return_document_id;

    -- 7. Lines, in a deterministic order so concurrent returns lock alike
    FOR v_input_line IN
        SELECT item
        FROM jsonb_array_elements(p_lines) item
        ORDER BY (item ->> 'receipt_line_id')::bigint
    LOOP
        v_line_number := v_line_number + 1;
        v_receipt_line_id := (v_input_line ->> 'receipt_line_id')::bigint;
        v_quantity := round((v_input_line ->> 'quantity')::numeric, 3);

        IF v_quantity IS NULL OR v_quantity <= 0 THEN
            RAISE EXCEPTION 'VALIDATION_ERROR: return quantity must be greater than zero'
                USING ERRCODE = '22023';
        END IF;

        SELECT receipt_line.variant_id, receipt_line.unit_id,
               receipt_line.unit_cost, receipt_line.quantity_received
        INTO v_variant_id, v_unit_id, v_unit_cost, v_quantity_received
        FROM procurement.purchase_receipt_lines receipt_line
        WHERE receipt_line.id = v_receipt_line_id
          AND receipt_line.document_id = p_receipt_document_id
        FOR SHARE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'VALIDATION_ERROR: purchase line % does not belong to purchase %',
                v_receipt_line_id, p_receipt_document_id USING ERRCODE = '22023';
        END IF;

        SELECT coalesce(sum(return_line.quantity), 0)::numeric(18, 3)
        INTO v_already_returned
        FROM procurement.purchase_return_lines return_line
        WHERE return_line.receipt_line_id = v_receipt_line_id;

        IF v_quantity > (v_quantity_received - v_already_returned) THEN
            RAISE EXCEPTION 'VALIDATION_ERROR: return quantity exceeds the quantity still returnable on this line'
                USING ERRCODE = '22023';
        END IF;

        -- Unit conversion to the variant's base unit
        SELECT base_unit_id INTO v_base_unit_id
        FROM catalog.product_variants
        WHERE id = v_variant_id;

        IF v_unit_id = v_base_unit_id THEN
            v_conversion_factor := 1;
        ELSE
            SELECT conversion_factor
            INTO v_conversion_factor
            FROM catalog.variant_units
            WHERE variant_id = v_variant_id
              AND unit_id = v_unit_id
            FOR SHARE;

            IF NOT FOUND OR v_conversion_factor IS NULL OR v_conversion_factor <= 0 THEN
                RAISE EXCEPTION 'VALIDATION_ERROR: no unit conversion for variant % from unit % to base unit %',
                    v_variant_id, v_unit_id, v_base_unit_id USING ERRCODE = '22023';
            END IF;
        END IF;

        v_base_quantity := round(v_quantity * v_conversion_factor, 3);

        -- Position: lock, check stock, reduce at WAC
        SELECT quantity_on_hand, total_value, last_known_wac
        INTO v_old_qty, v_old_value, v_old_wac
        FROM inventory.positions
        WHERE warehouse_id = v_warehouse_id AND variant_id = v_variant_id
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'PRECONDITION_FAILED: no stock position for this product in the purchase warehouse'
                USING ERRCODE = '55000';
        END IF;

        IF v_old_qty < v_base_quantity THEN
            RAISE EXCEPTION 'PRECONDITION_FAILED: not enough stock on hand to return this quantity'
                USING ERRCODE = '55000';
        END IF;

        v_line_inventory_value := round(v_base_quantity * v_old_wac, 2);
        v_new_qty := v_old_qty - v_base_quantity;
        v_new_value := round(v_old_value - v_line_inventory_value, 4);
        IF v_new_value < 0 THEN
            v_new_value := 0;
        END IF;

        UPDATE inventory.positions
        SET quantity_on_hand = v_new_qty,
            total_value = v_new_value,
            last_known_wac = CASE WHEN v_new_qty > 0 THEN v_old_wac ELSE v_old_wac END,
            updated_at = now()
        WHERE warehouse_id = v_warehouse_id AND variant_id = v_variant_id;

        INSERT INTO inventory.movements (
            warehouse_id, variant_id, movement_type, quantity_delta,
            inventory_value_delta, resulting_quantity_on_hand,
            resulting_total_value, reference_type, reference_id
        ) VALUES (
            v_warehouse_id, v_variant_id, 'ISSUE', -v_base_quantity,
            -v_line_inventory_value, v_new_qty, v_new_value,
            'PURCHASE_RETURN', v_return_document_id
        ) RETURNING id INTO v_movement_id;

        v_line_refund := round(v_quantity * v_unit_cost, 2);
        v_refund_total := v_refund_total + v_line_refund;
        v_inventory_total := v_inventory_total + v_line_inventory_value;

        INSERT INTO procurement.purchase_return_lines (
            return_document_id, line_number, receipt_line_id, variant_id, unit_id,
            quantity, base_quantity, unit_cost, refund_total, wac_at_return,
            inventory_value, movement_id
        ) VALUES (
            v_return_document_id, v_line_number, v_receipt_line_id, v_variant_id, v_unit_id,
            v_quantity, v_base_quantity, v_unit_cost, v_line_refund, v_old_wac,
            v_line_inventory_value, v_movement_id
        );
    END LOOP;

    IF v_refund_total <= 0 THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: the return has no value to credit'
            USING ERRCODE = '22023';
    END IF;

    v_variance := v_refund_total - v_inventory_total;

    -- 8. Journal: Dr GRNI, Cr Inventory, variance on whichever side balances
    v_journal_document_id := finance.create_posted_journal(
        p_document_date,
        p_fiscal_period_id,
        'Supplier return ' || v_document_number,
        'PURCHASE_RETURN',
        v_return_document_id
    );

    PERFORM finance.add_journal_line(
        v_journal_document_id, 1, 'GRNI'::finance.account_role_code,
        v_refund_total, 0.00, 'Supplier return reduces the amount owed'
    );

    PERFORM finance.add_journal_line(
        v_journal_document_id, 2, 'INVENTORY'::finance.account_role_code,
        0.00, v_inventory_total, 'Supplier return removes stock at weighted average cost'
    );

    v_journal_line_number := 3;

    IF v_variance > 0 THEN
        PERFORM finance.add_journal_line(
            v_journal_document_id, v_journal_line_number,
            'PROCUREMENT_VARIANCE'::finance.account_role_code,
            0.00, v_variance, 'Supplier return cost variance'
        );
    ELSIF v_variance < 0 THEN
        PERFORM finance.add_journal_line(
            v_journal_document_id, v_journal_line_number,
            'PROCUREMENT_VARIANCE'::finance.account_role_code,
            -v_variance, 0.00, 'Supplier return cost variance'
        );
    END IF;

    -- 9. Return header
    INSERT INTO procurement.purchase_returns (
        document_id, receipt_document_id, supplier_id, warehouse_id, reason_code, note,
        refund_amount, inventory_value, variance_amount, journal_document_id, posted_by_user_id
    ) VALUES (
        v_return_document_id, p_receipt_document_id, v_supplier_id, v_warehouse_id, p_reason_code,
        nullif(btrim(coalesce(p_note, '')), ''),
        v_refund_total, v_inventory_total, v_variance, v_journal_document_id, v_user_id
    );

    -- 10. Idempotency result
    PERFORM core.record_idempotent_result(
        'procurement.confirm_purchase_return', p_request_id, v_return_document_id
    );

    RETURN procurement._purchase_return_response(v_return_document_id);
END;
$function$

```

## `inventory.confirm_supplier_return` (oid 17682)

```sql
CREATE OR REPLACE FUNCTION inventory.confirm_supplier_return(p_session_token text, p_request_id uuid, p_request_hash bytea, p_return_doc_id bigint, p_fiscal_period_id bigint, p_document_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
    v_user_id bigint;
    v_workstation_id text;
    v_existing_document_id bigint;
    v_return_status text;
    v_return_id bigint;
    v_supplier_id bigint;
    v_warehouse_id bigint;
    v_purchase_order_id bigint;
    v_receipt_document_id bigint;
    v_period_status text;
    v_period_start date;
    v_period_end date;
    v_fiscal_year integer := extract(year FROM p_document_date)::integer;
    v_invoice_count integer;
    v_invoice_document_id bigint;
    v_liability_id bigint;
    v_liability_outstanding numeric(14,2);
    v_clearing_role finance.account_role_code;
    v_return_sequence bigint;
    v_return_number text;
    v_journal_document_id bigint;
    v_clearing_amount numeric(14,2) := 0;
    v_inventory_value numeric(14,2) := 0;
    v_variance numeric(14,2);
    v_line record;
    v_received_qty numeric(18,3);
    v_previously_returned_qty numeric(18,3);
    v_authoritative_unit_cost numeric(18,6);
    v_position_qty numeric(18,3);
    v_position_value numeric(18,4);
    v_wac numeric(18,6);
    v_issue_value numeric(14,2);
    v_movement_id bigint;
    v_journal_line_number integer := 1;
BEGIN
    SELECT user_id, workstation_id
    INTO v_user_id, v_workstation_id
    FROM iam.resolve_session_with_permission(p_session_token, 'POST_SUPPLIER_RETURN');

    v_existing_document_id := core.reserve_idempotent_request(
        'inventory.confirm_supplier_return', p_request_id, p_request_hash
    );
    IF v_existing_document_id IS NOT NULL THEN
        SELECT bd.document_number, je.document_id
        INTO v_return_number, v_journal_document_id
        FROM core.business_documents bd
        LEFT JOIN finance.journal_entries je
          ON je.source_type = 'PURCHASE_RETURN' AND je.source_id = bd.id
        WHERE bd.id = v_existing_document_id;
        RETURN jsonb_build_object(
            'document_id', v_existing_document_id,
            'document_number', v_return_number,
            'status', 'POSTED',
            'journal_document_id', v_journal_document_id
        );
    END IF;

    SELECT bd.status, sr.id, sr.supplier_id, sr.warehouse_id, sr.purchase_order_id, sr.receipt_document_id
    INTO v_return_status, v_return_id, v_supplier_id, v_warehouse_id, v_purchase_order_id, v_receipt_document_id
    FROM core.business_documents bd
    JOIN procurement.supplier_returns sr ON sr.document_id = bd.id
    WHERE bd.id = p_return_doc_id
    FOR UPDATE OF bd;

    IF NOT FOUND OR v_return_status <> 'DRAFT' THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: Supplier return % is not in DRAFT status', p_return_doc_id USING ERRCODE = '55000';
    END IF;

    SELECT status, starts_on, ends_on
    INTO v_period_status, v_period_start, v_period_end
    FROM finance.fiscal_periods
    WHERE id = p_fiscal_period_id
    FOR SHARE;
    IF NOT FOUND OR v_period_status <> 'OPEN' THEN
        RAISE EXCEPTION 'CLOSED_FISCAL_PERIOD: Fiscal period % is not open', p_fiscal_period_id USING ERRCODE = '55000';
    END IF;
    IF p_document_date < v_period_start OR p_document_date > v_period_end THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Document date is outside fiscal period' USING ERRCODE = '22023';
    END IF;

    -- Count related invoices
    SELECT count(DISTINCT inv.document_id), min(inv.document_id)
    INTO v_invoice_count, v_invoice_document_id
    FROM procurement.supplier_invoices inv
    JOIN core.business_documents bd ON bd.id = inv.document_id AND bd.status = 'POSTED'
    WHERE (
        (v_purchase_order_id IS NOT NULL AND inv.purchase_order_id = v_purchase_order_id)
        OR (v_receipt_document_id IS NOT NULL AND inv.document_id IN (
            SELECT sil.document_id FROM procurement.supplier_invoice_lines sil
            WHERE sil.receipt_line_id IN (
                SELECT id FROM procurement.purchase_receipt_lines WHERE document_id = v_receipt_document_id
            )
        ))
    )
    AND inv.supplier_id = v_supplier_id;

    IF v_invoice_count > 1 THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: Return allocation is ambiguous across multiple supplier invoices'
            USING ERRCODE = '55000';
    ELSIF v_invoice_count = 1 THEN
        SELECT id, outstanding_amount
        INTO v_liability_id, v_liability_outstanding
        FROM procurement.supplier_liabilities
        WHERE invoice_document_id = v_invoice_document_id
          AND supplier_id = v_supplier_id
        FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'PRECONDITION_FAILED: Posted supplier invoice has no payable liability' USING ERRCODE = '55000';
        END IF;
        v_clearing_role := 'ACCOUNTS_PAYABLE';
    ELSE
        v_clearing_role := 'GRNI';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM procurement.supplier_return_lines WHERE return_id = v_return_id
    ) THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Supplier return requires at least one line' USING ERRCODE = '22023';
    END IF;

    PERFORM 1
    FROM inventory.positions pos
    WHERE pos.warehouse_id = v_warehouse_id
      AND pos.variant_id IN (
          SELECT DISTINCT srl.variant_id
          FROM procurement.supplier_return_lines srl
          WHERE srl.return_id = v_return_id
      )
    ORDER BY pos.variant_id
    FOR UPDATE;

    FOR v_line IN
        SELECT id, variant_id, quantity
        FROM procurement.supplier_return_lines
        WHERE return_id = v_return_id
        ORDER BY line_number, id
    LOOP
        SELECT COALESCE(sum(prl.quantity_received), 0)
        INTO v_received_qty
        FROM procurement.purchase_receipt_lines prl
        JOIN procurement.purchase_receipts pr ON pr.document_id = prl.document_id
        JOIN core.business_documents bd ON bd.id = pr.document_id AND bd.status = 'POSTED'
        WHERE (
            (v_purchase_order_id IS NOT NULL AND pr.purchase_order_id = v_purchase_order_id)
            OR (v_receipt_document_id IS NOT NULL AND pr.document_id = v_receipt_document_id)
            OR (v_purchase_order_id IS NULL AND v_receipt_document_id IS NULL AND pr.supplier_id = v_supplier_id AND pr.warehouse_id = v_warehouse_id)
        )
        AND pr.supplier_id = v_supplier_id
        AND pr.warehouse_id = v_warehouse_id
        AND prl.variant_id = v_line.variant_id;

        SELECT COALESCE(sum(other_line.quantity), 0)
        INTO v_previously_returned_qty
        FROM procurement.supplier_return_lines other_line
        JOIN procurement.supplier_returns other_return ON other_return.id = other_line.return_id
        JOIN core.business_documents other_doc ON other_doc.id = other_return.document_id
        WHERE (
            (v_purchase_order_id IS NOT NULL AND other_return.purchase_order_id = v_purchase_order_id)
            OR (v_receipt_document_id IS NOT NULL AND other_return.receipt_document_id = v_receipt_document_id)
            OR (v_purchase_order_id IS NULL AND v_receipt_document_id IS NULL AND other_return.supplier_id = v_supplier_id AND other_return.warehouse_id = v_warehouse_id)
        )
        AND other_return.supplier_id = v_supplier_id
        AND other_return.warehouse_id = v_warehouse_id
        AND other_line.variant_id = v_line.variant_id
        AND other_return.id <> v_return_id
        AND other_doc.status = 'POSTED';

        IF v_line.quantity + v_previously_returned_qty > v_received_qty THEN
            RAISE EXCEPTION 'PRECONDITION_FAILED: Return quantity exceeds received quantity for variant %', v_line.variant_id
                USING ERRCODE = '55000';
        END IF;

        IF v_invoice_count = 1 THEN
            SELECT round(sum(sil.quantity * sil.unit_cost * inv.exchange_rate_to_dzd) / sum(sil.quantity), 6)
            INTO v_authoritative_unit_cost
            FROM procurement.supplier_invoice_lines sil
            JOIN procurement.supplier_invoices inv ON inv.document_id = sil.document_id
            WHERE sil.document_id = v_invoice_document_id
              AND sil.variant_id = v_line.variant_id;
        ELSE
            SELECT round(sum(prl.quantity_received * prl.unit_cost) / sum(prl.quantity_received), 6)
            INTO v_authoritative_unit_cost
            FROM procurement.purchase_receipt_lines prl
            JOIN procurement.purchase_receipts pr ON pr.document_id = prl.document_id
            WHERE (
                (v_purchase_order_id IS NOT NULL AND pr.purchase_order_id = v_purchase_order_id)
                OR (v_receipt_document_id IS NOT NULL AND pr.document_id = v_receipt_document_id)
                OR (v_purchase_order_id IS NULL AND v_receipt_document_id IS NULL AND pr.supplier_id = v_supplier_id AND pr.warehouse_id = v_warehouse_id)
            )
            AND pr.supplier_id = v_supplier_id
            AND pr.warehouse_id = v_warehouse_id
            AND prl.variant_id = v_line.variant_id;
        END IF;

        IF v_authoritative_unit_cost IS NULL THEN
            RAISE EXCEPTION 'PRECONDITION_FAILED: No authoritative purchase cost exists for variant %', v_line.variant_id
                USING ERRCODE = '55000';
        END IF;

        SELECT quantity_on_hand, total_value
        INTO v_position_qty, v_position_value
        FROM inventory.positions
        WHERE warehouse_id = v_warehouse_id
          AND variant_id = v_line.variant_id
        FOR UPDATE;

        IF NOT FOUND OR v_position_qty < v_line.quantity THEN
            RAISE EXCEPTION 'NEGATIVE_STOCK_FORBIDDEN: Warehouse has insufficient quantity on hand for variant %', v_line.variant_id
                USING ERRCODE = '55000';
        END IF;

        IF v_position_qty = 0 THEN
            v_wac := 0.000000;
        ELSE
            v_wac := round(v_position_value / v_position_qty, 6);
        END IF;

        v_issue_value := round(v_line.quantity * v_wac, 2);
        v_clearing_amount := v_clearing_amount + round(v_line.quantity * v_authoritative_unit_cost, 2);
        v_inventory_value := v_inventory_value + v_issue_value;

        INSERT INTO inventory.movements (
            warehouse_id, variant_id, movement_type,
            quantity_delta, value_delta, unit_cost,
            reference_document_id, created_by_user_id
        ) VALUES (
            v_warehouse_id, v_line.variant_id, 'PURCHASE_RETURN',
            -v_line.quantity, -v_issue_value, v_wac,
            p_return_doc_id, v_user_id
        ) RETURNING id INTO v_movement_id;

        IF v_position_qty - v_line.quantity = 0 THEN
            UPDATE inventory.positions
            SET quantity_on_hand = 0,
                total_value = 0.00,
                current_wac = v_wac,
                updated_at = now()
            WHERE warehouse_id = v_warehouse_id AND variant_id = v_line.variant_id;
        ELSE
            UPDATE inventory.positions
            SET quantity_on_hand = quantity_on_hand - v_line.quantity,
                total_value = round(total_value - v_issue_value, 2),
                current_wac = round((total_value - v_issue_value) / (quantity_on_hand - v_line.quantity), 6),
                updated_at = now()
            WHERE warehouse_id = v_warehouse_id AND variant_id = v_line.variant_id;
        END IF;

        UPDATE procurement.supplier_return_lines
        SET unit_cost = v_authoritative_unit_cost,
            line_total = round(v_line.quantity * v_authoritative_unit_cost, 2)
        WHERE id = v_line.id;
    END LOOP;

    IF v_clearing_role = 'ACCOUNTS_PAYABLE' AND v_clearing_amount > v_liability_outstanding THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: Return amount % exceeds outstanding liability %',
            v_clearing_amount, v_liability_outstanding USING ERRCODE = '55000';
    END IF;

    v_variance := round(v_clearing_amount - v_inventory_value, 2);
    v_return_sequence := core.claim_next_document_number('PURCHASE_RETURN', v_fiscal_year);
    v_return_number := 'PRT-' || v_fiscal_year || '-' || lpad(v_return_sequence::text, 6, '0');

    v_journal_document_id := finance.create_posted_journal(
        p_document_date,
        p_fiscal_period_id,
        'Supplier return ' || v_return_number,
        'PURCHASE_RETURN',
        p_return_doc_id
    );

    PERFORM finance.add_journal_line(
        v_journal_document_id,
        v_journal_line_number,
        v_clearing_role,
        v_clearing_amount,
        0.00,
        'Supplier return clearing debit'
    );
    v_journal_line_number := v_journal_line_number + 1;

    PERFORM finance.add_journal_line(
        v_journal_document_id,
        v_journal_line_number,
        'INVENTORY',
        0.00,
        v_inventory_value,
        'Supplier return inventory credit'
    );
    v_journal_line_number := v_journal_line_number + 1;

    IF v_variance > 0 THEN
        PERFORM finance.add_journal_line(
            v_journal_document_id,
            v_journal_line_number,
            'PURCHASE_PRICE_VARIANCE',
            0.00,
            v_variance,
            'Supplier return favorable variance'
        );
    ELSIF v_variance < 0 THEN
        PERFORM finance.add_journal_line(
            v_journal_document_id,
            v_journal_line_number,
            'PURCHASE_PRICE_VARIANCE',
            abs(v_variance),
            0.00,
            'Supplier return unfavorable variance'
        );
    END IF;

    IF v_clearing_role = 'ACCOUNTS_PAYABLE' THEN
        UPDATE procurement.supplier_liabilities
        SET outstanding_amount = round(outstanding_amount - v_clearing_amount, 2),
            status = CASE
                WHEN round(outstanding_amount - v_clearing_amount, 2) = 0 THEN 'PAID'
                ELSE 'PARTIALLY_PAID'
            END
        WHERE id = v_liability_id;
    END IF;

    UPDATE core.business_documents
    SET status = 'POSTED',
        sequence_number = v_return_sequence,
        document_number = v_return_number,
        document_date = p_document_date,
        fiscal_period_id = p_fiscal_period_id,
        fiscal_year = v_fiscal_year,
        posted_at = now()
    WHERE id = p_return_doc_id;

    PERFORM core.record_idempotent_result(
        'inventory.confirm_supplier_return', p_request_id, p_return_doc_id
    );

    RETURN jsonb_build_object(
        'document_id', p_return_doc_id,
        'document_number', v_return_number,
        'status', 'POSTED',
        'journal_document_id', v_journal_document_id
    );
END;
$function$

```

## `inventory.confirm_stock_receipt` (oid 16941)

```sql
CREATE OR REPLACE FUNCTION inventory.confirm_stock_receipt(p_session_token text, p_request_id uuid, p_payload_hash bytea, p_warehouse_id bigint, p_variant_id bigint, p_quantity numeric, p_unit_cost numeric, p_fiscal_period_id bigint, p_document_date date)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
    v_user_id bigint;
    v_cached_result bigint;
    v_variant_active boolean;
    v_period_status text;
    v_period_start date;
    v_period_end date;
    v_old_quantity numeric(18, 3);
    v_old_value numeric(18, 4);
    v_received_value numeric(18, 4);
    v_new_quantity numeric(18, 3);
    v_new_value numeric(18, 4);
    v_new_wac numeric(18, 6);
    v_document_id bigint;
    v_fiscal_year integer;
    v_sequence bigint;
    v_document_number text;
BEGIN
    -- 1. Session + permission (never trusts a caller-supplied actor id).
    SELECT user_id INTO v_user_id
        FROM iam.resolve_session_with_permission(p_session_token, 'POST_STOCK_RECEIPT');

    -- 2. Idempotency.
    v_cached_result := core.reserve_idempotent_request(
        'inventory.confirm_stock_receipt', p_request_id, p_payload_hash
    );
    IF v_cached_result IS NOT NULL THEN
        RETURN v_cached_result;
    END IF;

    -- 3. Input validation — fail safely on negative quantity / invalid cost.
    IF p_quantity <= 0 THEN
        RAISE EXCEPTION 'stock receipt quantity must be positive' USING ERRCODE = '22023';
    END IF;
    IF p_unit_cost < 0 THEN
        RAISE EXCEPTION 'stock receipt unit cost must not be negative' USING ERRCODE = '22023';
    END IF;

    -- 4. Fiscal period must be OPEN and must contain the document date.
    SELECT status, starts_on, ends_on, extract(year FROM starts_on)::integer
        INTO v_period_status, v_period_start, v_period_end, v_fiscal_year
        FROM finance.fiscal_periods
        WHERE id = p_fiscal_period_id
        FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'fiscal period % not found', p_fiscal_period_id USING ERRCODE = '22023';
    END IF;
    IF v_period_status <> 'OPEN' THEN
        RAISE EXCEPTION 'fiscal period % is not open', p_fiscal_period_id USING ERRCODE = '55000';
    END IF;
    IF p_document_date < v_period_start OR p_document_date > v_period_end THEN
        RAISE EXCEPTION 'document date % is outside fiscal period %', p_document_date, p_fiscal_period_id
            USING ERRCODE = '22023';
    END IF;

    -- 5. Variant must exist and be active.
    SELECT is_active INTO v_variant_active
        FROM catalog.product_variants
        WHERE id = p_variant_id
        FOR SHARE;
    IF NOT FOUND OR NOT v_variant_active THEN
        RAISE EXCEPTION 'variant % is not found or is inactive', p_variant_id USING ERRCODE = '22023';
    END IF;
    PERFORM 1 FROM inventory.warehouses WHERE id = p_warehouse_id FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'warehouse % not found', p_warehouse_id USING ERRCODE = '22023';
    END IF;

    -- 6. Lock the warehouse position (creating the zero row first if this
    -- is the variant's first-ever receipt into this warehouse).
    INSERT INTO inventory.positions (warehouse_id, variant_id)
        VALUES (p_warehouse_id, p_variant_id)
        ON CONFLICT (warehouse_id, variant_id) DO NOTHING;

    SELECT quantity_on_hand, total_value INTO v_old_quantity, v_old_value
        FROM inventory.positions
        WHERE warehouse_id = p_warehouse_id AND variant_id = p_variant_id
        FOR UPDATE;

    -- 7. Warehouse-specific WAC calculation.
    v_received_value := round(p_quantity * p_unit_cost, 4);
    v_new_quantity := v_old_quantity + p_quantity;
    v_new_value := v_old_value + v_received_value;
    v_new_wac := round(v_new_value / v_new_quantity, 6);

    UPDATE inventory.positions
        SET quantity_on_hand = v_new_quantity,
            total_value = v_new_value,
            last_known_wac = v_new_wac
        WHERE warehouse_id = p_warehouse_id AND variant_id = p_variant_id;

    -- 8. Create the business document (DRAFT first; flipped to POSTED once
    -- the number is claimed below, matching "allocate its official document
    -- number inside the transaction").
    INSERT INTO core.business_documents (document_type, document_date, fiscal_period_id, fiscal_year)
        VALUES ('STOCK_RECEIPT', p_document_date, p_fiscal_period_id, v_fiscal_year)
        RETURNING id INTO v_document_id;

    -- 9. Append the immutable stock movement, referencing the document.
    INSERT INTO inventory.movements (
        warehouse_id, variant_id, movement_type, quantity_delta, inventory_value_delta,
        resulting_quantity_on_hand, resulting_total_value, reference_type, reference_id
    ) VALUES (
        p_warehouse_id, p_variant_id, 'RECEIPT', p_quantity, v_received_value,
        v_new_quantity, v_new_value, 'STOCK_RECEIPT', v_document_id
    );

    -- 10. Allocate the official document number inside this same
    -- transaction, then post.
    v_sequence := core.claim_next_document_number('STOCK_RECEIPT', v_fiscal_year);
    v_document_number := 'SR-' || v_fiscal_year || '-' || lpad(v_sequence::text, 6, '0');

    UPDATE core.business_documents
        SET status = 'POSTED', sequence_number = v_sequence, document_number = v_document_number, posted_at = now()
        WHERE id = v_document_id;

    -- 11. Record the idempotent result and return it.
    PERFORM core.record_idempotent_result('inventory.confirm_stock_receipt', p_request_id, v_document_id);

    RETURN v_document_id;
END;
$function$

```

## `inventory.confirm_stock_adjustment` (oid 17247)

```sql
CREATE OR REPLACE FUNCTION inventory.confirm_stock_adjustment(p_session_token text, p_request_id uuid, p_payload_hash bytea, p_warehouse_id bigint, p_variant_id bigint, p_unit_id bigint, p_quantity_delta numeric, p_reason_code text, p_note text, p_fiscal_period_id bigint, p_document_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
    v_user_id bigint; v_workstation_id text; v_cached_result bigint;
    v_period_status text; v_period_start date; v_period_end date; v_fiscal_year integer;
    v_base_unit_id bigint; v_conversion_factor numeric(20, 6); v_base_delta numeric(18, 3);
    v_note text; v_old_quantity numeric(18, 3); v_old_value numeric(18, 4);
    v_wac numeric(18, 6); v_value_delta numeric(18, 4); v_new_quantity numeric(18, 3);
    v_new_value numeric(18, 4); v_journal_amount numeric(14, 2); v_document_id bigint;
    v_journal_document_id bigint; v_movement_id bigint; v_residual_journal_id bigint;
    v_sequence bigint; v_document_number text;
BEGIN
    SELECT user_id, workstation_id INTO v_user_id, v_workstation_id
    FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_INVENTORY');

    v_note := nullif(btrim(coalesce(p_note, '')), '');
    v_cached_result := core.reserve_idempotent_request(
        'inventory.confirm_stock_adjustment', p_request_id, p_payload_hash
    );
    IF v_cached_result IS NOT NULL THEN
        RETURN inventory._stock_adjustment_response(v_cached_result);
    END IF;

    IF NOT COALESCE((
        SELECT inventory_corrections_enabled
        FROM onboarding.feature_settings
        WHERE singleton
        FOR SHARE
    ), false) THEN
        RAISE EXCEPTION 'inventory corrections are disabled by policy' USING ERRCODE = '55000';
    END IF;

    IF p_quantity_delta IS NULL OR p_quantity_delta = 0 THEN
        RAISE EXCEPTION 'stock adjustment quantity delta must not be zero' USING ERRCODE = '22023';
    END IF;
    IF p_quantity_delta <> round(p_quantity_delta, 3) THEN
        RAISE EXCEPTION 'stock adjustment quantity supports at most three decimal places' USING ERRCODE = '22023';
    END IF;
    IF p_reason_code IS NULL OR p_reason_code NOT IN ('DAMAGE', 'SHRINKAGE', 'EXPIRED', 'FOUND_STOCK', 'RECORDING_ERROR', 'OTHER') THEN
        RAISE EXCEPTION 'invalid stock adjustment reason code' USING ERRCODE = '22023';
    END IF;
    IF p_reason_code = 'OTHER' AND v_note IS NULL THEN
        RAISE EXCEPTION 'OTHER stock adjustment reason requires a note' USING ERRCODE = '22023';
    END IF;

    SELECT status, starts_on, ends_on, extract(year FROM starts_on)::integer
    INTO v_period_status, v_period_start, v_period_end, v_fiscal_year
    FROM finance.fiscal_periods WHERE id = p_fiscal_period_id FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'fiscal period % not found', p_fiscal_period_id USING ERRCODE = '22023'; END IF;
    IF v_period_status <> 'OPEN' THEN RAISE EXCEPTION 'fiscal period % is not open', p_fiscal_period_id USING ERRCODE = '55000'; END IF;
    IF p_document_date < v_period_start OR p_document_date > v_period_end THEN
        RAISE EXCEPTION 'document date is outside the fiscal period' USING ERRCODE = '22023';
    END IF;

    PERFORM 1 FROM inventory.warehouses WHERE id = p_warehouse_id AND is_active FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'warehouse % is not found or is inactive', p_warehouse_id USING ERRCODE = '22023'; END IF;
    SELECT pv.base_unit_id INTO v_base_unit_id
    FROM catalog.product_variants pv JOIN catalog.products p ON p.id = pv.product_id
    WHERE pv.id = p_variant_id AND pv.is_active AND p.is_active FOR SHARE OF pv, p;
    IF NOT FOUND THEN RAISE EXCEPTION 'variant % is not found or is inactive', p_variant_id USING ERRCODE = '22023'; END IF;
    IF p_unit_id = v_base_unit_id THEN
        v_conversion_factor := 1;
    ELSE
        SELECT vu.conversion_factor INTO v_conversion_factor FROM catalog.variant_units vu
        WHERE vu.variant_id = p_variant_id AND vu.unit_id = p_unit_id FOR SHARE;
        IF NOT FOUND THEN RAISE EXCEPTION 'unit % is not valid for variant %', p_unit_id, p_variant_id USING ERRCODE = '22023'; END IF;
    END IF;
    IF p_quantity_delta * v_conversion_factor <> round(p_quantity_delta * v_conversion_factor, 3) THEN
        RAISE EXCEPTION 'stock adjustment does not convert exactly to base-unit precision' USING ERRCODE = '22023';
    END IF;
    v_base_delta := p_quantity_delta * v_conversion_factor;
    IF v_base_delta = 0 THEN RAISE EXCEPTION 'stock adjustment converts to a zero base-unit delta' USING ERRCODE = '22023'; END IF;

    INSERT INTO inventory.positions (warehouse_id, variant_id) VALUES (p_warehouse_id, p_variant_id)
    ON CONFLICT (warehouse_id, variant_id) DO NOTHING;
    SELECT quantity_on_hand, total_value, last_known_wac INTO v_old_quantity, v_old_value, v_wac
    FROM inventory.positions WHERE warehouse_id = p_warehouse_id AND variant_id = p_variant_id FOR UPDATE;
    IF v_base_delta < 0 AND v_old_quantity < abs(v_base_delta) THEN RAISE EXCEPTION 'insufficient stock for stock adjustment' USING ERRCODE = '55000'; END IF;
    IF v_base_delta > 0 AND v_old_quantity = 0 AND v_wac <= 0 THEN RAISE EXCEPTION 'positive adjustment at zero stock has no usable WAC' USING ERRCODE = 'P2002'; END IF;
    v_value_delta := round(v_base_delta * v_wac, 4);
    v_new_quantity := v_old_quantity + v_base_delta;
    v_new_value := v_old_value + v_value_delta;
    IF v_new_quantity < 0 THEN RAISE EXCEPTION 'stock adjustment would make confirmed stock negative' USING ERRCODE = '55000'; END IF;
    IF v_new_quantity = 0 AND v_new_value <> 0 THEN
        IF abs(v_new_value) >= 0.01 THEN RAISE EXCEPTION 'stock adjustment would result in a material unresolved inventory residual' USING ERRCODE = '55000'; END IF;
    ELSIF v_new_value < 0 THEN RAISE EXCEPTION 'stock adjustment would make inventory value negative' USING ERRCODE = '55000'; END IF;

    INSERT INTO core.business_documents (document_type, document_date, fiscal_period_id, fiscal_year)
    VALUES ('STOCK_ADJUSTMENT', p_document_date, p_fiscal_period_id, v_fiscal_year) RETURNING id INTO v_document_id;
    UPDATE inventory.positions SET quantity_on_hand = v_new_quantity,
        total_value = CASE WHEN v_new_quantity = 0 THEN 0 ELSE v_new_value END
    WHERE warehouse_id = p_warehouse_id AND variant_id = p_variant_id;
    INSERT INTO inventory.movements (warehouse_id, variant_id, movement_type, quantity_delta, inventory_value_delta,
        resulting_quantity_on_hand, resulting_total_value, reference_type, reference_id)
    VALUES (p_warehouse_id, p_variant_id, 'ADJUSTMENT', v_base_delta, v_value_delta, v_new_quantity,
        CASE WHEN v_new_quantity = 0 THEN 0 ELSE v_new_value END, 'STOCK_ADJUSTMENT', v_document_id)
    RETURNING id INTO v_movement_id;
    IF v_new_quantity = 0 AND v_new_value <> 0 THEN
        v_residual_journal_id := inventory._handle_residual_at_zero_quantity(p_warehouse_id, p_variant_id, v_movement_id, v_new_value, p_fiscal_period_id, p_document_date);
    END IF;

    v_journal_amount := round(abs(v_value_delta), 2);
    IF v_journal_amount > 0 THEN
        INSERT INTO core.business_documents (document_type, document_date, fiscal_period_id, fiscal_year)
        VALUES ('JOURNAL_ENTRY', p_document_date, p_fiscal_period_id, v_fiscal_year) RETURNING id INTO v_journal_document_id;
        INSERT INTO finance.journal_entries (document_id, description, source_type, source_id)
        VALUES (v_journal_document_id, 'Stock adjustment', 'STOCK_ADJUSTMENT', v_document_id);
        IF v_base_delta > 0 THEN
            INSERT INTO finance.journal_lines (document_id, line_number, account_code, account_id, debit, credit, description) VALUES
                (v_journal_document_id, 1, 'INVENTORY_MERCHANDISE', finance.resolve_account_id('INVENTORY_MERCHANDISE'), v_journal_amount, 0, 'Stock adjustment gain'),
                (v_journal_document_id, 2, 'INVENTORY_ADJUSTMENT_GAIN', finance.resolve_account_id('INVENTORY_ADJUSTMENT_GAIN'), 0, v_journal_amount, 'Stock adjustment gain');
        ELSE
            INSERT INTO finance.journal_lines (document_id, line_number, account_code, account_id, debit, credit, description) VALUES
                (v_journal_document_id, 1, 'INVENTORY_ADJUSTMENT_LOSS', finance.resolve_account_id('INVENTORY_ADJUSTMENT_LOSS'), v_journal_amount, 0, 'Stock adjustment loss'),
                (v_journal_document_id, 2, 'INVENTORY_MERCHANDISE', finance.resolve_account_id('INVENTORY_MERCHANDISE'), 0, v_journal_amount, 'Stock adjustment loss');
        END IF;
    END IF;

    INSERT INTO inventory.stock_adjustments (document_id, warehouse_id, variant_id, input_unit_id, input_quantity_delta,
        conversion_factor, quantity_delta, wac_snapshot, inventory_value_delta, reason_code, note, movement_id,
        journal_document_id, posted_by_user_id, workstation_id)
    VALUES (v_document_id, p_warehouse_id, p_variant_id, p_unit_id, p_quantity_delta, v_conversion_factor,
        v_base_delta, v_wac, v_value_delta, p_reason_code, v_note, v_movement_id, v_journal_document_id,
        v_user_id, v_workstation_id);
    v_sequence := core.claim_next_document_number('STOCK_ADJUSTMENT', v_fiscal_year);
    v_document_number := 'SA-' || v_fiscal_year || '-' || lpad(v_sequence::text, 6, '0');
    UPDATE core.business_documents SET status = 'POSTED', sequence_number = v_sequence, document_number = v_document_number, posted_at = now() WHERE id = v_document_id;
    IF v_journal_document_id IS NOT NULL THEN
        v_sequence := core.claim_next_document_number('JOURNAL_ENTRY', v_fiscal_year);
        v_document_number := 'JE-' || v_fiscal_year || '-' || lpad(v_sequence::text, 6, '0');
        UPDATE core.business_documents SET status = 'POSTED', sequence_number = v_sequence, document_number = v_document_number, posted_at = now() WHERE id = v_journal_document_id;
    END IF;
    PERFORM core.record_idempotent_result('inventory.confirm_stock_adjustment', p_request_id, v_document_id);
    RETURN inventory._stock_adjustment_response(v_document_id);
END;
$function$

```

## `inventory.allocate_landed_cost` (oid 17589)

```sql
CREATE OR REPLACE FUNCTION inventory.allocate_landed_cost(p_session_token text, p_request_id uuid, p_payload_hash bytea, p_receipt_id bigint, p_landed_cost_amount numeric, p_allocation_method text, p_fiscal_period_id bigint, p_document_date date, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
    v_user_id bigint;
    v_workstation_id text;
    v_existing_journal_id bigint;
    v_receipt_status text;
    v_warehouse_id bigint;
    v_supplier_id bigint;
    v_purchase_order_id bigint;
    v_period_status text;
    v_period_start date;
    v_period_end date;
    v_total_receipt_qty numeric(18,3);
    v_total_receipt_value numeric(14,2);
    v_line_count integer;
    v_processed_count integer := 0;
    v_allocated_so_far numeric(14,2) := 0;
    v_line record;
    v_attribution_id bigint;
    v_allocated_cost numeric(14,2);
    v_remaining_cost numeric(14,2);
    v_sold_cost numeric(14,2);
    v_qty_on_hand numeric(18,3);
    v_current_value numeric(18,4);
    v_new_value numeric(18,4);
    v_new_wac numeric(18,6);
    v_inventory_debit numeric(14,2) := 0;
    v_variance_debit numeric(14,2) := 0;
    v_journal_document_id bigint;
    v_line_number integer := 1;
BEGIN
    SELECT user_id, workstation_id
    INTO v_user_id, v_workstation_id
    FROM iam.resolve_session_with_permission(p_session_token, 'POST_SUPPLIER_INVOICE');

    v_existing_journal_id := core.reserve_idempotent_request(
        'inventory.allocate_landed_cost', p_request_id, p_payload_hash
    );
    IF v_existing_journal_id IS NOT NULL THEN
        RETURN jsonb_build_object(
            'receipt_id', p_receipt_id,
            'landed_cost_amount', p_landed_cost_amount,
            'status', 'POSTED',
            'journal_document_id', v_existing_journal_id
        );
    END IF;

    IF p_landed_cost_amount IS NULL OR p_landed_cost_amount <= 0 THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Landed cost amount must be positive' USING ERRCODE = '22023';
    END IF;
    IF p_allocation_method NOT IN ('BY_QTY', 'BY_VALUE', 'EQUAL_PER_LINE') THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Invalid allocation method %', p_allocation_method USING ERRCODE = '22023';
    END IF;

    SELECT status, starts_on, ends_on
    INTO v_period_status, v_period_start, v_period_end
    FROM finance.fiscal_periods
    WHERE id = p_fiscal_period_id
    FOR SHARE;
    IF NOT FOUND OR v_period_status <> 'OPEN' THEN
        RAISE EXCEPTION 'CLOSED_FISCAL_PERIOD: Fiscal period % is not open', p_fiscal_period_id USING ERRCODE = '55000';
    END IF;
    IF p_document_date < v_period_start OR p_document_date > v_period_end THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Document date is outside fiscal period' USING ERRCODE = '22023';
    END IF;

    SELECT doc.status, pr.warehouse_id, pr.supplier_id, pr.purchase_order_id
    INTO v_receipt_status, v_warehouse_id, v_supplier_id, v_purchase_order_id
    FROM core.business_documents doc
    JOIN procurement.purchase_receipts pr ON pr.document_id = doc.id
    WHERE doc.id = p_receipt_id
    FOR UPDATE OF doc;
    IF NOT FOUND OR v_receipt_status <> 'POSTED' THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: Receipt % is not posted', p_receipt_id USING ERRCODE = '55000';
    END IF;

    IF EXISTS (
        SELECT 1 FROM procurement.landed_cost_postings WHERE receipt_document_id = p_receipt_id
    ) THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: Receipt % already has a landed-cost posting', p_receipt_id USING ERRCODE = '55000';
    END IF;
    IF EXISTS (
        SELECT 1
        FROM procurement.supplier_liabilities
        WHERE receipt_document_id = p_receipt_id
    ) THEN
        RAISE EXCEPTION 'HISTORICAL_S3_DEFECT: Receipt % has a pre-R2 AP liability and requires append-only reconciliation first', p_receipt_id
            USING ERRCODE = '55000';
    END IF;

    SELECT COALESCE(sum(quantity_received), 0), COALESCE(sum(line_total), 0), count(*)
    INTO v_total_receipt_qty, v_total_receipt_value, v_line_count
    FROM procurement.purchase_receipt_lines
    WHERE document_id = p_receipt_id;
    IF v_line_count = 0 OR v_total_receipt_qty <= 0 THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: Receipt has no lines to allocate' USING ERRCODE = '55000';
    END IF;
    IF p_allocation_method = 'BY_VALUE' AND v_total_receipt_value <= 0 THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: BY_VALUE requires a positive receipt value' USING ERRCODE = '55000';
    END IF;

    PERFORM 1
    FROM inventory.positions pos
    WHERE pos.warehouse_id = v_warehouse_id
      AND pos.variant_id IN (
          SELECT DISTINCT prl.variant_id
          FROM procurement.purchase_receipt_lines prl
          WHERE prl.document_id = p_receipt_id
      )
    ORDER BY pos.variant_id
    FOR UPDATE;

    FOR v_line IN
        SELECT id, variant_id, quantity_received, unit_cost, line_total
        FROM procurement.purchase_receipt_lines
        WHERE document_id = p_receipt_id
        ORDER BY id
    LOOP
        v_processed_count := v_processed_count + 1;
        IF v_processed_count = v_line_count THEN
            v_allocated_cost := p_landed_cost_amount - v_allocated_so_far;
        ELSIF p_allocation_method = 'BY_QTY' THEN
            v_allocated_cost := round(p_landed_cost_amount * v_line.quantity_received / v_total_receipt_qty, 2);
        ELSIF p_allocation_method = 'BY_VALUE' THEN
            v_allocated_cost := round(p_landed_cost_amount * v_line.line_total / v_total_receipt_value, 2);
        ELSE
            v_allocated_cost := round(p_landed_cost_amount / v_line_count, 2);
        END IF;
        v_allocated_so_far := v_allocated_so_far + v_allocated_cost;

        SELECT id
        INTO v_attribution_id
        FROM inventory.receipt_cost_attribution
        WHERE receipt_line_id = v_line.id
        ORDER BY id
        LIMIT 1
        FOR UPDATE;
        IF v_attribution_id IS NULL THEN
            INSERT INTO inventory.receipt_cost_attribution (
                receipt_line_id, variant_id, warehouse_id, original_quantity,
                attributed_remaining_quantity, original_unit_cost
            ) VALUES (
                v_line.id, v_line.variant_id, v_warehouse_id, v_line.quantity_received,
                v_line.quantity_received, v_line.unit_cost
            ) RETURNING id INTO v_attribution_id;
        END IF;

        SELECT quantity_on_hand, total_value
        INTO v_qty_on_hand, v_current_value
        FROM inventory.positions
        WHERE warehouse_id = v_warehouse_id AND variant_id = v_line.variant_id
        FOR UPDATE;

        IF v_qty_on_hand IS NULL OR v_qty_on_hand <= 0 THEN
            v_remaining_cost := 0;
            v_sold_cost := v_allocated_cost;
        ELSE
            v_remaining_cost := round(
                v_allocated_cost * least(v_qty_on_hand, v_line.quantity_received) / v_line.quantity_received,
                2
            );
            v_sold_cost := v_allocated_cost - v_remaining_cost;
            v_new_value := v_current_value + v_remaining_cost;
            v_new_wac := round(v_new_value / v_qty_on_hand, 6);

            UPDATE inventory.positions
            SET total_value = v_new_value,
                last_known_wac = v_new_wac,
                updated_at = now()
            WHERE warehouse_id = v_warehouse_id AND variant_id = v_line.variant_id;

            INSERT INTO inventory.movements (
                warehouse_id, variant_id, movement_type, quantity_delta,
                inventory_value_delta, resulting_quantity_on_hand,
                resulting_total_value, reference_type, reference_id
            ) VALUES (
                v_warehouse_id, v_line.variant_id, 'COST_ONLY', 0,
                v_remaining_cost, v_qty_on_hand, v_new_value,
                'PURCHASE_RECEIPT', p_receipt_id
            );
        END IF;

        UPDATE inventory.receipt_cost_attribution
        SET late_cost_allocated = late_cost_allocated + v_allocated_cost,
            updated_at = now()
        WHERE id = v_attribution_id;

        v_inventory_debit := v_inventory_debit + v_remaining_cost;
        v_variance_debit := v_variance_debit + v_sold_cost;
    END LOOP;

    IF v_allocated_so_far <> p_landed_cost_amount THEN
        RAISE EXCEPTION 'ALLOCATION_ERROR: Landed cost allocation did not reconcile' USING ERRCODE = '22000';
    END IF;

    v_journal_document_id := finance.create_posted_journal(
        p_document_date,
        p_fiscal_period_id,
        'Landed cost allocation journal entry',
        'LANDED_COST',
        p_receipt_id
    );

    IF v_inventory_debit > 0 THEN
        INSERT INTO finance.journal_lines (document_id, line_number, account_code, debit, credit)
        VALUES (v_journal_document_id, v_line_number, finance.require_account_role('INVENTORY'), v_inventory_debit, 0);
        v_line_number := v_line_number + 1;
    END IF;
    IF v_variance_debit > 0 THEN
        INSERT INTO finance.journal_lines (document_id, line_number, account_code, debit, credit)
        VALUES (v_journal_document_id, v_line_number, finance.require_account_role('PROCUREMENT_VARIANCE'), v_variance_debit, 0);
        v_line_number := v_line_number + 1;
    END IF;
    INSERT INTO finance.journal_lines (document_id, line_number, account_code, debit, credit)
    VALUES (v_journal_document_id, v_line_number, finance.require_account_role('ACCOUNTS_PAYABLE'), 0, p_landed_cost_amount);

    INSERT INTO procurement.landed_cost_postings (
        receipt_document_id, supplier_id, journal_document_id, amount
    ) VALUES (
        p_receipt_id, v_supplier_id, v_journal_document_id, p_landed_cost_amount
    );

    INSERT INTO procurement.supplier_liabilities (
        supplier_id, purchase_order_id, receipt_document_id,
        journal_document_id, original_amount, outstanding_amount, due_date, status
    ) VALUES (
        v_supplier_id, v_purchase_order_id, p_receipt_id,
        v_journal_document_id, p_landed_cost_amount, p_landed_cost_amount,
        p_document_date + 30, 'UNPAID'
    );

    PERFORM core.record_idempotent_result(
        'inventory.allocate_landed_cost', p_request_id, v_journal_document_id
    );

    RETURN jsonb_build_object(
        'receipt_id', p_receipt_id,
        'landed_cost_amount', p_landed_cost_amount,
        'inventory_debit', v_inventory_debit,
        'variance_debit', v_variance_debit,
        'journal_document_id', v_journal_document_id,
        'status', 'POSTED'
    );
END;
$function$

```

## `inventory._handle_residual_at_zero_quantity` (oid 17246)

```sql
CREATE OR REPLACE FUNCTION inventory._handle_residual_at_zero_quantity(p_warehouse_id bigint, p_variant_id bigint, p_source_movement_id bigint, p_remaining_value numeric, p_fiscal_period_id bigint, p_document_date date)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
    v_residual numeric(18, 4);
    v_clearing_movement_id bigint;
    v_journal_document_id bigint;
    v_journal_entry_id bigint;
    v_fiscal_year integer;
    v_sequence bigint;
    v_document_number text;
BEGIN
    -- Only detect residuals if remaining value is non-zero but small (sub-centime).
    IF abs(p_remaining_value) = 0 OR abs(p_remaining_value) >= 0.01 THEN
        RETURN NULL;
    END IF;

    -- Residual detected: record it and clear it atomically.
    v_residual := p_remaining_value;

    -- Create a RESIDUAL_CLEARANCE movement with the opposite sign to zero the position.
    INSERT INTO inventory.movements (
        warehouse_id, variant_id, movement_type, quantity_delta,
        inventory_value_delta, resulting_quantity_on_hand,
        resulting_total_value, reference_type, reference_id
    ) VALUES (
        p_warehouse_id, p_variant_id, 'RESIDUAL_CLEARANCE', 0,
        -v_residual, 0, 0,
        'RESIDUAL_CLEARANCE', p_source_movement_id
    ) RETURNING id INTO v_clearing_movement_id;

    -- Create the residual clearance audit record.
    INSERT INTO inventory.residual_clearances (
        warehouse_id, variant_id, source_movement_id,
        detected_residual_value, clearing_movement_id
    ) VALUES (
        p_warehouse_id, p_variant_id, p_source_movement_id,
        v_residual, v_clearing_movement_id
    );

    -- Optionally journal the residual clearance (2-decimal scale).
    -- Only journal if the rounded 2-decimal amount is material (>= 0.01).
    -- Sub-centime values (0.0001 - 0.0099) typically do not journal,
    -- but we include the logic for transparency.
    IF round(v_residual, 2) > 0 THEN
        SELECT extract(year FROM starts_on)::integer
        INTO v_fiscal_year
        FROM finance.fiscal_periods
        WHERE id = p_fiscal_period_id;

        INSERT INTO core.business_documents (
            document_type, document_date, fiscal_period_id, fiscal_year
        ) VALUES (
            'JOURNAL_ENTRY', p_document_date, p_fiscal_period_id, v_fiscal_year
        ) RETURNING id INTO v_journal_entry_id;

        INSERT INTO finance.journal_entries (
            document_id, description, source_type, source_id
        ) VALUES (
            v_journal_entry_id, 'Rounding residual clearance',
            'RESIDUAL_CLEARANCE', v_clearing_movement_id
        );

        -- Debit INVENTORY_ADJUSTMENT_LOSS, credit INVENTORY_MERCHANDISE to reverse the residual.
        INSERT INTO finance.journal_lines (
            document_id, line_number, account_code, debit, credit
        ) VALUES
            (v_journal_entry_id, 1, 'INVENTORY_ADJUSTMENT_LOSS', round(v_residual, 2), 0),
            (v_journal_entry_id, 2, 'INVENTORY_MERCHANDISE', 0, round(v_residual, 2));

        v_sequence := core.claim_next_document_number('JOURNAL_ENTRY', v_fiscal_year);
        v_document_number := 'JE-' || v_fiscal_year || '-' || lpad(v_sequence::text, 6, '0');
        UPDATE core.business_documents
        SET status = 'POSTED', sequence_number = v_sequence,
            document_number = v_document_number, posted_at = now()
        WHERE id = v_journal_entry_id;

        UPDATE inventory.residual_clearances
        SET clearing_journal_document_id = v_journal_entry_id
        WHERE clearing_movement_id = v_clearing_movement_id;

        RETURN v_journal_entry_id;
    END IF;

    RETURN NULL;
END;
$function$

```

## `cash.get_session_report` (oid 19934)

```sql
CREATE OR REPLACE FUNCTION cash.get_session_report(p_session_token text, p_cash_session_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
    v_status text;
    v_workstation_id text;
    v_opened_at timestamptz;
    v_closed_at timestamptz;
    v_opened_by_user_id bigint;
    v_closed_by_user_id bigint;
    v_opening_float numeric(14,2);
    v_stored_expected numeric(14,2);
    v_stored_counted numeric(14,2);
    v_stored_variance numeric(14,2);
    v_expected numeric(14,2);
    v_counted numeric(14,2);
    v_variance numeric(14,2);
    v_variance_approved_by text;
    v_tolerance numeric(14,2);
    v_cash_count integer;
    v_cash_total numeric(14,2);
    v_void_count integer;
    v_void_total numeric(14,2);
    v_credit_count integer;
    v_credit_total numeric(14,2);
    v_cash_in_total numeric(14,2);
    v_cash_out_total numeric(14,2);
    v_payments_total numeric(14,2);
    v_refunds_total numeric(14,2);
    v_movement_rows jsonb;
    v_result jsonb;
BEGIN
    PERFORM 1 FROM iam.resolve_session(p_session_token);

    SELECT status, workstation_id, opened_at, closed_at,
           opened_by_user_id, closed_by_user_id, opening_float,
           expected_amount, counted_amount, variance_amount
    INTO v_status, v_workstation_id, v_opened_at, v_closed_at,
         v_opened_by_user_id, v_closed_by_user_id, v_opening_float,
         v_stored_expected, v_stored_counted, v_stored_variance
    FROM sales.cash_sessions
    WHERE id = p_cash_session_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: cash session not found' USING ERRCODE = '22023';
    END IF;

    -- Sales (cash / void) from cash.movements for this session.
    SELECT
        count(*) FILTER (WHERE m.movement_type = 'SALE'),
        coalesce(sum(m.amount) FILTER (WHERE m.movement_type = 'SALE'), 0),
        count(*) FILTER (WHERE m.movement_type = 'SALE_VOID'),
        coalesce(sum(-m.amount) FILTER (WHERE m.movement_type = 'SALE_VOID'), 0),
        coalesce(sum(m.amount) FILTER (WHERE m.movement_type = 'CASH_IN'), 0),
        coalesce(sum(m.amount) FILTER (WHERE m.movement_type = 'CASH_OUT'), 0),
        coalesce(sum(m.amount) FILTER (WHERE m.movement_type = 'CUSTOMER_PAYMENT'), 0),
        coalesce(sum(-m.amount) FILTER (WHERE m.movement_type = 'CUSTOMER_REFUND'), 0)
    INTO v_cash_count, v_cash_total, v_void_count, v_void_total,
         v_cash_in_total, v_cash_out_total, v_payments_total, v_refunds_total
    FROM cash.movements m
    WHERE m.cash_session_id = p_cash_session_id;

    -- Credit sales: same workstation, created within the session's window --
    -- identical definition to sales.list_session_sales (WS-F-006).
    SELECT count(*), coalesce(sum(cr.total_amount), 0)
    INTO v_credit_count, v_credit_total
    FROM sales.credit_sales cr
    JOIN core.business_documents d ON d.id = cr.document_id
    WHERE cr.workstation_id = v_workstation_id
      AND cr.created_at >= v_opened_at
      AND (v_closed_at IS NULL OR cr.created_at <= v_closed_at)
      AND d.status IN ('POSTED', 'REVERSED');

    -- Manual cash-in/cash-out movements, itemized.
    SELECT coalesce(jsonb_agg(
        jsonb_build_object(
            'type', m.movement_type,
            'reason_code', m.reason_code,
            'note', m.note,
            'amount', m.amount::text,
            'recorded_at', m.created_at
        ) ORDER BY m.created_at
    ), '[]'::jsonb)
    INTO v_movement_rows
    FROM cash.movements m
    WHERE m.cash_session_id = p_cash_session_id
      AND m.movement_type IN ('CASH_IN', 'CASH_OUT');

    -- Expected/counted/variance: read back the audited figures for a closed
    -- session; recompute live (WS-F-005's exact formula) for one still open.
    IF v_status = 'CLOSED' THEN
        v_expected := v_stored_expected;
        v_counted := v_stored_counted;
        v_variance := v_stored_variance;
    ELSE
        SELECT round(v_opening_float + coalesce(sum(
            CASE WHEN m.movement_type = 'CASH_OUT' THEN -m.amount ELSE m.amount END
        ), 0), 2)
        INTO v_expected
        FROM cash.movements m
        WHERE m.cash_session_id = p_cash_session_id;
        v_counted := NULL;
        v_variance := NULL;
    END IF;

    SELECT u.username INTO v_variance_approved_by
    FROM cash.session_close_attempts a
    JOIN cash.session_close_approvals ap ON ap.close_attempt_id = a.id
    JOIN iam.users u ON u.id = ap.approved_by_user_id
    WHERE a.cash_session_id = p_cash_session_id
    ORDER BY a.attempt_number DESC
    LIMIT 1;

    SELECT material_variance_threshold INTO v_tolerance
    FROM cash.session_policy
    WHERE id = 1;

    SELECT jsonb_build_object(
        'session', jsonb_build_object(
            'id', p_cash_session_id,
            'status', v_status,
            'workstation_id', v_workstation_id,
            'opened_at', v_opened_at,
            'closed_at', v_closed_at,
            'opened_by', (SELECT username FROM iam.users WHERE id = v_opened_by_user_id),
            'closed_by', (SELECT username FROM iam.users WHERE id = v_closed_by_user_id),
            'opening_float', v_opening_float::text
        ),
        'sales', jsonb_build_object(
            'cash_count', v_cash_count,
            'cash_total', v_cash_total::text,
            'credit_count', v_credit_count,
            'credit_total', v_credit_total::text,
            'void_count', v_void_count,
            'void_total', v_void_total::text
        ),
        'movements', jsonb_build_object(
            'cash_in_total', v_cash_in_total::text,
            'cash_out_total', v_cash_out_total::text,
            'rows', v_movement_rows
        ),
        'customer', jsonb_build_object(
            'payments_total', v_payments_total::text,
            'refunds_total', v_refunds_total::text
        ),
        'cash', jsonb_build_object(
            'expected', v_expected::text,
            'counted', v_counted::text,
            'variance', v_variance::text,
            'variance_approved_by', v_variance_approved_by,
            'tolerance', v_tolerance::text
        )
    )
    INTO v_result;

    RETURN v_result;
END;
$function$

```

# Appendix C — unit/pack keyword hits (item 2), verbatim `file:line:text`

Produced by the grep in *Commands run*. Lines are truncated to 220 characters. Some non-unit hits survive the exclusion filter (CSS class names, the French word "opération"); they are left in rather than hand-edited.

```
src-tauri/migrations/20260816195000_direct_purchase_unit_conversion_repair.sql:9:    v_definition := replace(v_definition, $match$            SELECT conversion_factor
src-tauri/migrations/20260816195000_direct_purchase_unit_conversion_repair.sql:17:                SELECT conversion_factor
src-tauri/migrations/20260816195000_direct_purchase_unit_conversion_repair.sql:24:            END IF;$match$, $replacement$            SELECT conversion_factor
src-tauri/migrations/20260816195000_direct_purchase_unit_conversion_repair.sql:30:    IF position('catalog.unit_conversions' IN v_definition) > 0 THEN RAISE EXCEPTION 'Direct Purchase unit conversion replacement failed';
src-tauri/migrations/20260817090000_inventory_corrections_policy.sql:216:    SELECT pv.base_unit_id INTO v_base_unit_id
src-tauri/migrations/20260817090000_inventory_corrections_policy.sql:223:        SELECT vu.conversion_factor INTO v_conversion_factor FROM catalog.variant_units vu
src-tauri/migrations/20260817090000_inventory_corrections_policy.sql:279:        conversion_factor, quantity_delta, wac_snapshot, inventory_value_delta, reason_code, note, movement_id,
src-tauri/migrations/20260826092000_finance_add_journal_line.sql:8:-- same dual-write discipline as every other conversion in this task.
src-tauri/migrations/20260724140100_update_stock_adjustment_residual_handling.sql:110:    SELECT pv.base_unit_id INTO v_base_unit_id
src-tauri/migrations/20260724140100_update_stock_adjustment_residual_handling.sql:123:        SELECT vu.conversion_factor INTO v_conversion_factor
src-tauri/migrations/20260724140100_update_stock_adjustment_residual_handling.sql:246:        input_quantity_delta, conversion_factor, quantity_delta, wac_snapshot,
src-tauri/migrations/20260826095100_inventory_confirm_stock_adjustment_account_id.sql:68:    SELECT pv.base_unit_id INTO v_base_unit_id
src-tauri/migrations/20260826095100_inventory_confirm_stock_adjustment_account_id.sql:75:        SELECT vu.conversion_factor INTO v_conversion_factor FROM catalog.variant_units vu
src-tauri/migrations/20260826095100_inventory_confirm_stock_adjustment_account_id.sql:131:        conversion_factor, quantity_delta, wac_snapshot, inventory_value_delta, reason_code, note, movement_id,
src-tauri/migrations/20260811120000_r8_d_inventory_read_side.sql:70:    base_unit_code text,
src-tauri/migrations/20260811120000_r8_d_inventory_read_side.sql:107:    JOIN catalog.units unit ON unit.id = variant.base_unit_id
src-tauri/migrations/20260816170000_direct_purchase_wac_column_repair.sql:20:        'SELECT pv.base_unit_id, (p.is_active AND pv.is_active)');
src-tauri/migrations/20260829090000_ws_i_001_historical_core_reports.sql:133:-- 2. The readiness gate, factored out
src-tauri/migrations/20260829090000_ws_i_001_historical_core_reports.sql:137:-- needs the answer, so the computation is factored into an internal helper and
src-tauri/migrations/20260722125404_catalog_products_and_variants.sql:8:-- categories, unit conversions, price lists) remain out of scope and stay
src-tauri/migrations/20260724120000_catalog_variants_attributes_units_barcodes.sql:2:-- exact alternate-unit conversions, and barcodes.
src-tauri/migrations/20260724120000_catalog_variants_attributes_units_barcodes.sql:24:--   * Conversion factors use exact NUMERIC(20,6); no floating point anywhere.
src-tauri/migrations/20260724120000_catalog_variants_attributes_units_barcodes.sql:49:-- units (carton, pack, kilogram, gram, ...) are created at runtime by users.
src-tauri/migrations/20260724120000_catalog_variants_attributes_units_barcodes.sql:95:    ADD COLUMN base_unit_id        bigint REFERENCES catalog.units (id),
src-tauri/migrations/20260724120000_catalog_variants_attributes_units_barcodes.sql:102:    SET base_unit_id = (SELECT id FROM catalog.units WHERE normalized_code = 'UNIT')
src-tauri/migrations/20260724120000_catalog_variants_attributes_units_barcodes.sql:103:    WHERE base_unit_id IS NULL;
src-tauri/migrations/20260724120000_catalog_variants_attributes_units_barcodes.sql:106:    ALTER COLUMN base_unit_id SET NOT NULL;
src-tauri/migrations/20260724120000_catalog_variants_attributes_units_barcodes.sql:133:-- Alternate units per variant with an exact conversion factor to the base
src-tauri/migrations/20260724120000_catalog_variants_attributes_units_barcodes.sql:134:-- unit. conversion_factor = number of BASE units contained in one alternate
src-tauri/migrations/20260724120000_catalog_variants_attributes_units_barcodes.sql:135:-- unit (e.g. one carton = 12 base units -> 12.000000). Strictly positive.
src-tauri/migrations/20260724120000_catalog_variants_attributes_units_barcodes.sql:136:-- The base unit itself is implicitly factor 1 and is never stored here.
src-tauri/migrations/20260724120000_catalog_variants_attributes_units_barcodes.sql:142:    conversion_factor numeric(20, 6) NOT NULL,
src-tauri/migrations/20260724120000_catalog_variants_attributes_units_barcodes.sql:146:    CONSTRAINT variant_units_factor_positive CHECK (conversion_factor > 0)
src-tauri/migrations/20260902090000_ws_d_002_brand_to_attribute.sql:114:        product_id, sku, sale_price, base_unit_id, attribute_signature, is_active, minimum_stock
src-tauri/migrations/20260902090000_ws_d_002_brand_to_attribute.sql:324:    UPDATE catalog.product_variants SET base_unit_id = p_unit_id WHERE product_id = p_product_id;
src-tauri/migrations/20260908090000_ws_d_007_variant_alt_unit_direction.sql:2:-- WS-D-14 Part 2 -- store the conversion in the DIRECTION it was entered,
src-tauri/migrations/20260908090000_ws_d_007_variant_alt_unit_direction.sql:5:-- THE TRAP. catalog.variant_units.conversion_factor is numeric(20,6) and its
src-tauri/migrations/20260908090000_ws_d_007_variant_alt_unit_direction.sql:6:-- established meaning is "1 ALTERNATE unit = conversion_factor BASE units".
src-tauri/migrations/20260908090000_ws_d_007_variant_alt_unit_direction.sql:11:-- which compute `quantity_in_selected_unit * conversion_factor` to get a base
src-tauri/migrations/20260908090000_ws_d_007_variant_alt_unit_direction.sql:14:-- WS-D-13 Phase B, and applying conversions at transaction time stays out of
src-tauri/migrations/20260908090000_ws_d_007_variant_alt_unit_direction.sql:17:-- The problem is the OWNER'S phrasing: "the main unit is BOX, and
src-tauri/migrations/20260908090000_ws_d_007_variant_alt_unit_direction.sql:18:-- alternative is pieces, and 1 box = 10 pieces." That is "1 BASE = 10 ALT",
src-tauri/migrations/20260908090000_ws_d_007_variant_alt_unit_direction.sql:19:-- the OPPOSITE direction from what conversion_factor stores ("1 ALT = N
src-tauri/migrations/20260908090000_ws_d_007_variant_alt_unit_direction.sql:20:-- BASE"). Converting it means factor = 1/10 = 0.1 -- exact here, but for
src-tauri/migrations/20260908090000_ws_d_007_variant_alt_unit_direction.sql:21:-- "1 BOX = 3 PIECE" it is 1/3 = 0.333333 at six decimal places, and reading
src-tauri/migrations/20260908090000_ws_d_007_variant_alt_unit_direction.sql:22:-- it back would show "0.333333 BOX = 1 PIECE" -- a number the operator never
src-tauri/migrations/20260908090000_ws_d_007_variant_alt_unit_direction.sql:26:--   conversion_direction text  -- 'ALT_TO_BASE' (legacy meaning, the default:
src-tauri/migrations/20260908090000_ws_d_007_variant_alt_unit_direction.sql:27:--     "1 alternate unit = conversion_quantity base units") or 'BASE_TO_ALT'
src-tauri/migrations/20260908090000_ws_d_007_variant_alt_unit_direction.sql:28:--     ("1 base unit = conversion_quantity alternate units", the Owner's
src-tauri/migrations/20260908090000_ws_d_007_variant_alt_unit_direction.sql:29:--     "1 BOX = 10 PIECE" shape).
src-tauri/migrations/20260908090000_ws_d_007_variant_alt_unit_direction.sql:30:--   conversion_quantity numeric(20,6) -- the EXACT number the operator typed
src-tauri/migrations/20260908090000_ws_d_007_variant_alt_unit_direction.sql:32:--     'ALT_TO_BASE' this number IS conversion_factor, copied verbatim. For
src-tauri/migrations/20260908090000_ws_d_007_variant_alt_unit_direction.sql:33:--     'BASE_TO_ALT' it is "3" in the "1 BOX = 3 PIECE" case -- displayed as
src-tauri/migrations/20260908090000_ws_d_007_variant_alt_unit_direction.sql:37:-- implicit denominator, conversion_quantity is the exact numerator, and
src-tauri/migrations/20260908090000_ws_d_007_variant_alt_unit_direction.sql:38:-- conversion_direction says which unit the denominator belongs to. Choosing
src-tauri/migrations/20260908090000_ws_d_007_variant_alt_unit_direction.sql:40:-- magnitude alongside conversion_factor) rather than replacing
src-tauri/migrations/20260908090000_ws_d_007_variant_alt_unit_direction.sql:41:-- conversion_factor outright with a bare numerator/denominator pair (shape
src-tauri/migrations/20260908090000_ws_d_007_variant_alt_unit_direction.sql:42:-- (b)) is deliberate: conversion_factor's single-number "1 alt = N base"
src-tauri/migrations/20260908090000_ws_d_007_variant_alt_unit_direction.sql:45:-- for no benefit -- this task is display/definition only. conversion_factor
src-tauri/migrations/20260908090000_ws_d_007_variant_alt_unit_direction.sql:47:-- insert (computed once, in SQL, never in React); conversion_quantity is
src-tauri/migrations/20260908090000_ws_d_007_variant_alt_unit_direction.sql:50:-- The one division that CAN still happen -- computing conversion_factor from
src-tauri/migrations/20260908090000_ws_d_007_variant_alt_unit_direction.sql:53:-- (add_variant_alt_unit already accepted only a single numeric factor, so a
src-tauri/migrations/20260908090000_ws_d_007_variant_alt_unit_direction.sql:56:-- conversion_direction/conversion_quantity, not conversion_factor, for
src-tauri/migrations/20260908090000_ws_d_007_variant_alt_unit_direction.sql:62:-- "1 alt = conversion_factor base" today (the only shape the old 4-argument
src-tauri/migrations/20260908090000_ws_d_007_variant_alt_unit_direction.sql:64:-- lossless copy: conversion_direction = 'ALT_TO_BASE',
src-tauri/migrations/20260908090000_ws_d_007_variant_alt_unit_direction.sql:65:-- conversion_quantity = conversion_factor. No division, no rounding, and the
src-tauri/migrations/20260908090000_ws_d_007_variant_alt_unit_direction.sql:77:-- get_product_detail's alt_units payload gets conversion_direction and
src-tauri/migrations/20260908090000_ws_d_007_variant_alt_unit_direction.sql:78:-- conversion_quantity ADDED alongside the existing five keys (id, variant_id,
src-tauri/migrations/20260908090000_ws_d_007_variant_alt_unit_direction.sql:79:-- unit_id, conversion_factor, unit_code, unit_name) -- nothing renamed,
src-tauri/migrations/20260908090000_ws_d_007_variant_alt_unit_direction.sql:81:-- values cross as text (direction is already text; conversion_quantity gets
src-tauri/migrations/20260908090000_ws_d_007_variant_alt_unit_direction.sql:91:    RAISE NOTICE 'catalog.variant_units rows to backfill with conversion_direction=ALT_TO_BASE: %', v_existing_rows;
src-tauri/migrations/20260908090000_ws_d_007_variant_alt_unit_direction.sql:95:    ADD COLUMN conversion_direction text,
src-tauri/migrations/20260908090000_ws_d_007_variant_alt_unit_direction.sql:96:    ADD COLUMN conversion_quantity numeric(20, 6);
src-tauri/migrations/20260908090000_ws_d_007_variant_alt_unit_direction.sql:100:    SET conversion_direction = 'ALT_TO_BASE',
src-tauri/migrations/20260908090000_ws_d_007_variant_alt_unit_direction.sql:101:        conversion_quantity = conversion_factor;
src-tauri/migrations/20260908090000_ws_d_007_variant_alt_unit_direction.sql:104:    ALTER COLUMN conversion_direction SET NOT NULL,
src-tauri/migrations/20260908090000_ws_d_007_variant_alt_unit_direction.sql:105:    ALTER COLUMN conversion_quantity SET NOT NULL,
src-tauri/migrations/20260908090000_ws_d_007_variant_alt_unit_direction.sql:107:        CHECK (conversion_direction IN ('ALT_TO_BASE', 'BASE_TO_ALT')),
src-tauri/migrations/20260908090000_ws_d_007_variant_alt_unit_direction.sql:109:        CHECK (conversion_quantity > 0);
src-tauri/migrations/20260908090000_ws_d_007_variant_alt_unit_direction.sql:111:COMMENT ON COLUMN catalog.variant_units.conversion_direction IS
src-tauri/migrations/20260908090000_ws_d_007_variant_alt_unit_direction.sql:114:    'conversion_quantity base units" -- this is also what conversion_factor '
src-tauri/migrations/20260908090000_ws_d_007_variant_alt_unit_direction.sql:115:    'means, unconditionally. BASE_TO_ALT: "1 base unit = conversion_quantity '
src-tauri/migrations/20260908090000_ws_d_007_variant_alt_unit_direction.sql:116:    'alternate units" (e.g. "1 BOX = 10 PIECE"). Display reads this column '
src-tauri/migrations/20260908090000_ws_d_007_variant_alt_unit_direction.sql:117:    'and conversion_quantity, never conversion_factor, so the operator never '
src-tauri/migrations/20260908090000_ws_d_007_variant_alt_unit_direction.sql:119:COMMENT ON COLUMN catalog.variant_units.conversion_quantity IS
src-tauri/migrations/20260908090000_ws_d_007_variant_alt_unit_direction.sql:121:    'never derived. For ALT_TO_BASE this equals conversion_factor exactly '
src-tauri/migrations/20260908090000_ws_d_007_variant_alt_unit_direction.sql:123:    'of the relationship as entered -- e.g. exactly "3" for "1 BOX = 3 '
src-tauri/migrations/20260908090000_ws_d_007_variant_alt_unit_direction.sql:124:    'PIECE", never the lossy reciprocal 0.333333 that conversion_factor '
src-tauri/migrations/20260908090000_ws_d_007_variant_alt_unit_direction.sql:146:    SELECT base_unit_id INTO v_base_unit FROM catalog.product_variants WHERE id = p_variant_id;
src-tauri/migrations/20260908090000_ws_d_007_variant_alt_unit_direction.sql:159:        RAISE EXCEPTION 'conversion direction must be ALT_TO_BASE or BASE_TO_ALT' USING ERRCODE = '22023';
src-tauri/migrations/20260908090000_ws_d_007_variant_alt_unit_direction.sql:162:        RAISE EXCEPTION 'conversion quantity must be strictly positive' USING ERRCODE = '22023';
src-tauri/migrations/20260908090000_ws_d_007_variant_alt_unit_direction.sql:165:    -- conversion_factor keeps its existing "1 alt = factor base" meaning for
src-tauri/migrations/20260908090000_ws_d_007_variant_alt_unit_direction.sql:169:    -- this legacy column -- conversion_quantity itself is stored untouched.
src-tauri/migrations/20260908090000_ws_d_007_variant_alt_unit_direction.sql:175:            RAISE EXCEPTION 'conversion quantity % is too large to represent at six decimal places',
src-tauri/migrations/20260908090000_ws_d_007_variant_alt_unit_direction.sql:182:                (variant_id, unit_id, conversion_factor, conversion_direction, conversion_quantity)
src-tauri/migrations/20260908090000_ws_d_007_variant_alt_unit_direction.sql:197:-- ADD ONLY: conversion_direction and conversion_quantity join the five keys
src-tauri/migrations/20260908090000_ws_d_007_variant_alt_unit_direction.sql:256:        -- WS-D-14 Part 2: conversion_direction/conversion_quantity ADDED,
src-tauri/migrations/20260908090000_ws_d_007_variant_alt_unit_direction.sql:262:            'conversion_factor', vu.conversion_factor::text,
src-tauri/migrations/20260908090000_ws_d_007_variant_alt_unit_direction.sql:265:            'conversion_direction', vu.conversion_direction,
src-tauri/migrations/20260908090000_ws_d_007_variant_alt_unit_direction.sql:266:            'conversion_quantity', vu.conversion_quantity::text
src-tauri/migrations/20260901090000_ws_d_001_catalogue_foundation.sql:100:-- Shared private helper: stock/transaction history guard, factored out of
src-tauri/migrations/20260901090000_ws_d_001_catalogue_foundation.sql:163:    UPDATE catalog.product_variants SET base_unit_id = p_unit_id WHERE product_id = p_product_id;
src-tauri/migrations/20260901090000_ws_d_001_catalogue_foundation.sql:556:-- usage_count = product.unit_id + variant.base_unit_id + alternate-unit
src-tauri/migrations/20260901090000_ws_d_001_catalogue_foundation.sql:557:-- conversion rows, per the brief: unit changes affect stock quantity maths.
src-tauri/migrations/20260901090000_ws_d_001_catalogue_foundation.sql:570:             + (SELECT count(*) FROM catalog.product_variants pv WHERE pv.base_unit_id = u.id)
src-tauri/migrations/20260901090000_ws_d_001_catalogue_foundation.sql:632:         + (SELECT count(*) FROM catalog.product_variants pv WHERE pv.base_unit_id = p_unit_id)
src-tauri/migrations/20260901090000_ws_d_001_catalogue_foundation.sql:636:        RAISE EXCEPTION 'unit % is in use by % product/variant/conversion row(s) and cannot be deleted', p_unit_id, v_usage
src-tauri/migrations/20260901090000_ws_d_001_catalogue_foundation.sql:714:        product_id, sku, sale_price, base_unit_id, attribute_signature, is_active, minimum_stock
src-tauri/migrations/20260901090000_ws_d_001_catalogue_foundation.sql:951:    UPDATE catalog.product_variants SET base_unit_id = p_unit_id WHERE product_id = p_product_id;
src-tauri/migrations/20260803131000_r2_purchase_receipt_grni.sql:214:        SELECT pv.base_unit_id
src-tauri/migrations/20260803131000_r2_purchase_receipt_grni.sql:227:            SELECT vu.conversion_factor
src-tauri/migrations/20260815115000_repair_legacy_catalog_create_contract.sql:54:            base_unit_id,
src-tauri/migrations/20260724130000_inventory_confirm_stock_adjustment.sql:51:    conversion_factor        numeric(20, 6) NOT NULL,
src-tauri/migrations/20260724130000_inventory_confirm_stock_adjustment.sql:64:    CONSTRAINT stock_adjustments_factor_positive CHECK (conversion_factor > 0),
src-tauri/migrations/20260724130000_inventory_confirm_stock_adjustment.sql:97:-- Read model for the adjustment form: one base unit (factor 1) plus the exact
src-tauri/migrations/20260724130000_inventory_confirm_stock_adjustment.sql:108:    conversion_factor numeric,
src-tauri/migrations/20260724130000_inventory_confirm_stock_adjustment.sql:120:    SELECT pv.base_unit_id INTO v_base_unit_id
src-tauri/migrations/20260724130000_inventory_confirm_stock_adjustment.sql:135:        SELECT u.id, u.code, u.name, vu.conversion_factor, false
src-tauri/migrations/20260724130000_inventory_confirm_stock_adjustment.sql:271:    SELECT pv.base_unit_id INTO v_base_unit_id
src-tauri/migrations/20260724130000_inventory_confirm_stock_adjustment.sql:284:        SELECT vu.conversion_factor INTO v_conversion_factor
src-tauri/migrations/20260724130000_inventory_confirm_stock_adjustment.sql:393:        input_quantity_delta, conversion_factor, quantity_delta, wac_snapshot,
src-tauri/migrations/20260813180000_catalog_identity_and_sku_redesign.sql:47:        SELECT count(DISTINCT base_unit_id), min(base_unit_id)
src-tauri/migrations/20260813180000_catalog_identity_and_sku_redesign.sql:216:        product_id, sku, name_override, sale_price, base_unit_id, attribute_signature, is_active
src-tauri/migrations/20260813180000_catalog_identity_and_sku_redesign.sql:375:    -- Keep product_variants.base_unit_id in sync
src-tauri/migrations/20260813180000_catalog_identity_and_sku_redesign.sql:376:    UPDATE catalog.product_variants SET base_unit_id = p_unit_id WHERE product_id = p_product_id;
src-tauri/migrations/20260912090000_ws_e_003_purchase_returns.sql:46:    base_quantity      numeric(18, 3) NOT NULL,
src-tauri/migrations/20260912090000_ws_e_003_purchase_returns.sql:54:    CONSTRAINT purchase_return_lines_base_quantity_positive CHECK (base_quantity > 0)
src-tauri/migrations/20260912090000_ws_e_003_purchase_returns.sql:303:        -- Unit conversion to the variant's base unit
src-tauri/migrations/20260912090000_ws_e_003_purchase_returns.sql:304:        SELECT base_unit_id INTO v_base_unit_id
src-tauri/migrations/20260912090000_ws_e_003_purchase_returns.sql:311:            SELECT conversion_factor
src-tauri/migrations/20260912090000_ws_e_003_purchase_returns.sql:319:                RAISE EXCEPTION 'VALIDATION_ERROR: no unit conversion for variant % from unit % to base unit %',
src-tauri/migrations/20260912090000_ws_e_003_purchase_returns.sql:373:            quantity, base_quantity, unit_cost, refund_total, wac_at_return,
src-tauri/migrations/20260813000000_single_entry_purchase_orchestration.sql:286:    JOIN catalog.units u ON u.id = p.base_unit_id
src-tauri/migrations/20260816150000_direct_purchase_foundation.sql:268:        -- Resolve Unit Conversion
src-tauri/migrations/20260816150000_direct_purchase_foundation.sql:272:            SELECT conversion_factor
src-tauri/migrations/20260816150000_direct_purchase_foundation.sql:280:                SELECT conversion_factor
src-tauri/migrations/20260816150000_direct_purchase_foundation.sql:290:                RAISE EXCEPTION 'VALIDATION_ERROR: No unit conversion for variant % from unit % to base unit %',
src-tauri/migrations/20260906090000_ws_d_005_unit_allows_fractions.sql:5:-- decimal-capable (Kg, Litre) or whole-number-only (Piece, Box). Until now
src-tauri/migrations/20260906090000_ws_d_005_unit_allows_fractions.sql:7:-- application accepted "2.5 Pieces".
src-tauri/migrations/20260906090000_ws_d_005_unit_allows_fractions.sql:24:-- catalog.variant_units.conversion_factor 0/0) -- but that is an acceptance
src-tauri/migrations/20260906090000_ws_d_005_unit_allows_fractions.sql:55:    'Kg/Litre, false for Piece/Box. Existing rows were backfilled to true '
src-tauri/migrations/20260906090000_ws_d_005_unit_allows_fractions.sql:162:-- using the unit, plus variants basing on it, plus alternate-unit conversion
src-tauri/migrations/20260906090000_ws_d_005_unit_allows_fractions.sql:185:             + (SELECT count(*) FROM catalog.product_variants pv WHERE pv.base_unit_id = u.id)
src-tauri/migrations/20260907090000_ws_d_006_variant_alt_units_in_detail.sql:5:-- Per-variant unit conversions have existed since 20260724120100
src-tauri/migrations/20260907090000_ws_d_006_variant_alt_units_in_detail.sql:9:-- ever add blind. This adds the read side. The conversions stay PER VARIANT,
src-tauri/migrations/20260907090000_ws_d_006_variant_alt_units_in_detail.sql:10:-- which is correct and deliberate -- a box of pillows and a box of nails hold
src-tauri/migrations/20260907090000_ws_d_006_variant_alt_units_in_detail.sql:11:-- different counts, so a global "BOX = 6" would be wrong.
src-tauri/migrations/20260907090000_ws_d_006_variant_alt_units_in_detail.sql:31:-- conversion_factor is an EXACT DECIMAL and is returned with ::text, the same
src-tauri/migrations/20260907090000_ws_d_006_variant_alt_units_in_detail.sql:99:        -- functions were written: id, variant_id, unit_id, conversion_factor,
src-tauri/migrations/20260907090000_ws_d_006_variant_alt_units_in_detail.sql:105:            'conversion_factor', vu.conversion_factor::text,
src-tauri/migrations/20260824091000_finance_accounts_seed_and_role_bridge.sql:33:    ('65', NULL, 'Autres charges opérationnelles',         'Other operating expenses',        'expense',   'debit',  NULL, false, false, N
src-tauri/migrations/20260824091000_finance_accounts_seed_and_role_bridge.sql:52:    ('658', 'PROCUREMENT_VARIANCE',        'Autres charges opérationnelles',                'Procurement and landed-cost variance','expens
src-tauri/migrations/20260825100000_finance_accounts_gap_fix_inventory_adjustment.sql:25:    ('75', NULL, 'Autres produits opérationnels', 'Other operating income', 'revenue', 'credit', NULL, false, false, NULL)
src-tauri/migrations/20260725120100_inventory_confirm_purchase_receipt.sql:209:        -- Resolve Unit & Conversion Factor
src-tauri/migrations/20260725120100_inventory_confirm_purchase_receipt.sql:210:        SELECT pv.base_unit_id INTO v_base_unit_id
src-tauri/migrations/20260725120100_inventory_confirm_purchase_receipt.sql:222:            SELECT vu.conversion_factor INTO v_conversion_factor
src-tauri/migrations/20260724120100_catalog_variant_management_and_lookup.sql:124:    IF (p_variant ->> 'base_unit_id') IS NOT NULL THEN
src-tauri/migrations/20260724120100_catalog_variant_management_and_lookup.sql:125:        v_base_unit := (p_variant ->> 'base_unit_id')::bigint;
src-tauri/migrations/20260724120100_catalog_variant_management_and_lookup.sql:145:            (product_id, sku, sale_price, is_active, base_unit_id, attribute_signature)
src-tauri/migrations/20260724120100_catalog_variant_management_and_lookup.sql:168:            v_factor := (v_alt ->> 'conversion_factor')::numeric;
src-tauri/migrations/20260724120100_catalog_variant_management_and_lookup.sql:173:                RAISE EXCEPTION 'conversion factor must be strictly positive' USING ERRCODE = '22023';
src-tauri/migrations/20260724120100_catalog_variant_management_and_lookup.sql:180:                INSERT INTO catalog.variant_units (variant_id, unit_id, conversion_factor)
src-tauri/migrations/20260724120100_catalog_variant_management_and_lookup.sql:474:    SELECT base_unit_id INTO v_base_unit FROM catalog.product_variants WHERE id = p_variant_id;
src-tauri/migrations/20260724120100_catalog_variant_management_and_lookup.sql:486:        RAISE EXCEPTION 'conversion factor must be strictly positive' USING ERRCODE = '22023';
src-tauri/migrations/20260724120100_catalog_variant_management_and_lookup.sql:489:        INSERT INTO catalog.variant_units (variant_id, unit_id, conversion_factor)
src-tauri/migrations/20260724120100_catalog_variant_management_and_lookup.sql:531:    UPDATE catalog.product_variants SET base_unit_id = p_unit_id WHERE id = p_variant_id;
src-tauri/migrations/20260724120100_catalog_variant_management_and_lookup.sql:545:    sale_price numeric, base_unit_id bigint, variant_is_active boolean, product_is_active boolean
src-tauri/migrations/20260724120100_catalog_variant_management_and_lookup.sql:552:        SELECT v.id, p.id, v.sku, p.name, v.sale_price, v.base_unit_id, v.is_active, p.is_active
src-tauri/migrations/20260724120100_catalog_variant_management_and_lookup.sql:610:-- attributes, alternate units, and barcodes. Prices/factors are serialized as
src-tauri/migrations/20260724120100_catalog_variant_management_and_lookup.sql:630:                'base_unit_id', v.base_unit_id,
src-tauri/migrations/20260724120100_catalog_variant_management_and_lookup.sql:631:                'base_unit_code', (SELECT u.code FROM catalog.units u WHERE u.id = v.base_unit_id),
src-tauri/migrations/20260724120100_catalog_variant_management_and_lookup.sql:644:                        'conversion_factor', vu.conversion_factor::text) ORDER BY u2.code)
src-tauri/migrations/20260724120100_catalog_variant_management_and_lookup.sql:663:-- working now that base_unit_id is mandatory. Same signature/return type, so
src-tauri/migrations/20260724120100_catalog_variant_management_and_lookup.sql:685:        INSERT INTO catalog.product_variants (product_id, sku, sale_price, is_active, base_unit_id, attribute_signature)
src-tauri/migrations/20260815100000_fix_catalog_variant_attribute_mapping.sql:54:        product_id, sku, name_override, sale_price, base_unit_id, attribute_signature, is_active
src-tauri/src/infrastructure/embedded_setup.rs:791:    /// staged tree means a packaging regression fails these tests too, not
src-tauri/src/infrastructure/local_config.rs:62:    /// `options` is boxed: `PgConnectOptions` is large relative to the other
src-tauri/src/infrastructure/local_config.rs:63:    /// (unit) variants of this enum, and boxing it keeps `LocalConfigOutcome`
src-tauri/src/infrastructure/pg_process.rs:191:/// `?`s being literally what the ANSI codepage conversion produced from
src-tauri/src/infrastructure/pg_process.rs:250:/// packaging bug managed to be wrong in two places at once.
src-tauri/src/infrastructure/pg_process.rs:959:    /// the moment the packaging stops matching the code's expectations.
src-tauri/src/infrastructure/pg_process.rs:975:    /// The packaging-level guard for the same bug. `tauri.conf.json`'s
src-tauri/src/infrastructure/db.rs:507:// conversion is why this failure class has repeatedly been misread as a
src-tauri/src/infrastructure/db.rs:1207:        // happens to run on a machine that has one — which a CI/test box
src-tauri/src/application/inventory.rs:30:    pub base_unit_code: String,
src-tauri/src/application/inventory.rs:90:            l.base_unit_code, \
src-tauri/src/application/inventory.rs:129:                base_unit_code,
src-tauri/src/application/inventory.rs:142:                base_unit_code,
src-tauri/src/application/stock_adjustment.rs:46:    pub conversion_factor: String,
src-tauri/src/application/stock_adjustment.rs:180:        "SELECT unit_id, unit_code, unit_name, conversion_factor, is_base \
src-tauri/src/application/stock_adjustment.rs:195:            conversion_factor: row.3.to_string(),
src-tauri/src/application/iam.rs:233:    /// current state, so it opened every box unchecked and a save submitted a
src-tauri/src/application/catalog.rs:496:/// pre-divided factor: `conversion_direction` is either `"ALT_TO_BASE"`
src-tauri/src/application/catalog.rs:497:/// (legacy meaning: "1 alternate unit = conversion_quantity base units") or
src-tauri/src/application/catalog.rs:498:/// `"BASE_TO_ALT"` ("1 base unit = conversion_quantity alternate units" —
src-tauri/src/application/catalog.rs:499:/// e.g. the Owner's "1 BOX = 10 PIECE"). Every argument is cast explicitly
src-tauri/src/application/catalog.rs:507:    conversion_direction: &str,
src-tauri/src/application/catalog.rs:508:    conversion_quantity: Decimal,
src-tauri/src/application/catalog.rs:516:    .bind(conversion_direction)
src-tauri/src/application/catalog.rs:517:    .bind(conversion_quantity)
src-tauri/src/error.rs:211:    /// text remains private in `diagnostic` and is dropped at IPC conversion.
src-tauri/src/error.rs:697:    fn conversion_omits_private_diagnostics_from_wire() {
src-tauri/src/domain/procurement.rs:650:    pub conversion_factor: String,
src-tauri/src/domain/onboarding.rs:92:/// inspection: no numeric conversion takes place.
src-tauri/src/domain/catalog.rs:1://! S2-001 — Catalog domain logic: normalization helpers, conversion arithmetic,
src-tauri/src/domain/catalog.rs:32:// Conversion-factor arithmetic
src-tauri/src/domain/catalog.rs:35:/// Validate that a conversion factor is strictly positive.
src-tauri/src/domain/catalog.rs:36:pub(crate) fn validate_positive_factor(factor: Decimal) -> Result<(), DomainError> {
src-tauri/src/domain/catalog.rs:37:    if factor <= Decimal::ZERO {
src-tauri/src/domain/catalog.rs:44:/// Compute the base quantity: `entered * factor` using exact Decimal arithmetic.
src-tauri/src/domain/catalog.rs:45:/// `factor` must be strictly positive; this function validates internally.
src-tauri/src/domain/catalog.rs:46:pub(crate) fn base_quantity(entered: Decimal, factor: Decimal) -> Result<Decimal, DomainError> {
src-tauri/src/domain/catalog.rs:47:    validate_positive_factor(factor)?;
src-tauri/src/domain/catalog.rs:48:    Ok(entered * factor)
src-tauri/src/domain/catalog.rs:106:    // -- base_quantity conversions ---------------------------------------------
src-tauri/src/domain/catalog.rs:109:    fn base_quantity_integer_case() {
src-tauri/src/domain/catalog.rs:110:        // 5 boxes * 12 units/box = 60 units
src-tauri/src/domain/catalog.rs:111:        let result = base_quantity(d("5"), d("12")).unwrap();
src-tauri/src/domain/catalog.rs:116:    fn base_quantity_exact_fractional() {
src-tauri/src/domain/catalog.rs:118:        let result = base_quantity(d("2"), d("0.001")).unwrap();
src-tauri/src/domain/catalog.rs:123:    fn base_quantity_factor_zero_rejected() {
src-tauri/src/domain/catalog.rs:125:            base_quantity(d("5"), Decimal::ZERO),
src-tauri/src/domain/catalog.rs:131:    fn base_quantity_negative_factor_rejected() {
src-tauri/src/domain/catalog.rs:133:            base_quantity(d("5"), d("-1")),
src-tauri/src/domain/product.rs:39:/// barcodes, or unit conversions (those stay Slice 2 work); this exists at
src-tauri/src/commands/stock_adjustment.rs:33:    pub conversion_factor: String,
src-tauri/src/commands/stock_adjustment.rs:109:                    conversion_factor: unit.conversion_factor,
src-tauri/src/commands/catalog.rs:311:    conversion_direction: String,
src-tauri/src/commands/catalog.rs:312:    conversion_quantity: Decimal,
src-tauri/src/commands/catalog.rs:320:        &conversion_direction,
src-tauri/src/commands/catalog.rs:321:        conversion_quantity,
src/shared/ipc/dto.ts:66:  base_unit_code: string;
src/shared/ipc/dto.ts:195:// WS-D-13 Phase B added `alt_units`: the variant's alternate-unit conversions,
src/shared/ipc/dto.ts:198:// `conversion_factor` crosses as an exact-decimal STRING, like sale_price.
src/shared/ipc/dto.ts:209: * WS-D-14 Part 2 added `conversion_direction`/`conversion_quantity`, ADD
src/shared/ipc/dto.ts:210: * ONLY: `conversion_factor` keeps its exact prior meaning ("1 alternate unit
src/shared/ipc/dto.ts:211: * = conversion_factor base units") because three transaction-time SQL
src/shared/ipc/dto.ts:213: * read `conversion_direction`/`conversion_quantity` for DISPLAY — the exact
src/shared/ipc/dto.ts:215: * `conversion_factor` alone; it can be the LOSSY reciprocal for a
src/shared/ipc/dto.ts:216: * `BASE_TO_ALT` entry (e.g. "1 BOX = 3 PIECE" stores conversion_quantity
src/shared/ipc/dto.ts:217: * "3" exactly, while conversion_factor is a rounded "0.333333").
src/shared/ipc/dto.ts:224:  conversion_factor: string;
src/shared/ipc/dto.ts:227:  conversion_direction: AltUnitConversionDirection;
src/shared/ipc/dto.ts:228:  conversion_quantity: string;
src/shared/ipc/dto.ts:232:export interface AltUnitInput { unit_id: number; conversion_direction: AltUnitConversionDirection; conversion_quantity: string; }
src/shared/ipc/dto.ts:248:  conversion_factor: string;
src/shared/ipc/dto.ts:684:  conversion_factor: string;
src/shared/ipc/dto.ts:820:// carry a fractional part (true for Kg/Litre, false for Piece/Box). It is UI
src/shared/ipc/gateway.ts:536: * WS-D-14 Part 2. `conversionDirection` says which side of the relationship
src/shared/ipc/gateway.ts:537: * the operator fixed at 1 ('ALT_TO_BASE': "1 alt = conversionQuantity base";
src/shared/ipc/gateway.ts:538: * 'BASE_TO_ALT': "1 base = conversionQuantity alt"). `conversionQuantity` is
src/shared/ipc/gateway.ts:546:  conversionDirection: AltUnitConversionDirection,
src/shared/ipc/gateway.ts:547:  conversionQuantity: string,
src/shared/ipc/gateway.ts:550:    sessionToken, variantId, unitId, conversionDirection, conversionQuantity,
src/shared/i18n/locales.ts:405:  'catalog2.altUnitsNotAppliedYet': 'Ces conversions sont enregistr\u00e9es pour cette variante. Elles ne sont pas encore appliqu\u00e9es automatiquement aux r\u00e9ceptions, aux achats ou
src/shared/i18n/locales.ts:407:  'catalog2.altUnitRelationship': 'Relation de conversion',
src/shared/i18n/locales.ts:414:  'catalog2.altUnitConfirmRemoveBody': 'La conversion 1 {left} = {quantity} {right} sera supprim\u00e9e pour cette variante.',
src/shared/i18n/locales.ts:469:  'errors.recoveryOperationInProgress': "Une autre opération de sauvegarde ou de récupération est déjà en cours. Attendez qu'elle se termine.",
src/shared/i18n/locales.ts:477:  'errors.insufficientDiskSpace': "Il n’y a pas assez d’espace disque libre pour cette opération.",
src/shared/i18n/locales.ts:1790:  'catalog2.altUnitsNotAppliedYet': 'These conversions are recorded for this variant. They are not yet applied automatically to receipts, purchases or sales.',
src/shared/i18n/locales.ts:1792:  'catalog2.altUnitRelationship': 'Conversion relationship',
src/shared/i18n/locales.ts:1799:  'catalog2.altUnitConfirmRemoveBody': 'The conversion 1 {left} = {quantity} {right} will be removed for this variant.',
src/shared/i18n/locales.ts:1898:  'catalogueSetup.units.allowsFractionsHint': 'Tick this for measured units (Kg, Litre); leave it clear for counted units (Piece, Box), which then accept whole numbers only.',
src/shared/documents/officialDocument.ts:141:    ? `<div class="status-box">${escapeHtml(model.statusText)}</div>`
src/shared/documents/officialDocument.ts:170:  return `<div class="box info-block"><div class="info-block-title">${escapeHtml(block.title)}</div>${rowsHtml}</div>`;
src/shared/documents/officialDocument.ts:253:  .status-box { display: inline-block; margin-top: 4px; padding: 1px 6px; border: 1px solid #000; font-size: 7.5pt; text-transform: uppercase; }
src/shared/documents/officialDocument.ts:257:  .box { border: 1px solid #888; padding: 4px 6px; flex: 1; page-break-inside: avoid; }
src/shared/documents/officialDocument.ts:326: * page numbers (Chromium/WebView2 can't render @page margin boxes), so this
src/features/customers/CustomersScreen.tsx:182:    refundBoundary: 'Cette opération annule uniquement le paiement client. Le retour produit et la remise en stock restent un flux séparé.',
src/features/settings/RecoverySettingsScreen.tsx:415:            <div className="sk-recovery-box">
src/features/settings/RecoverySettingsScreen.tsx:416:              <div className="sk-recovery-box__header">
src/features/settings/RecoverySettingsScreen.tsx:418:                  <h3 className="sk-recovery-box__title">{t('recovery.create')}</h3>
src/features/settings/RecoverySettingsScreen.tsx:419:                  <p className="sk-recovery-box__desc">{t('recovery.createHelp')}</p>
src/features/settings/RecoverySettingsScreen.tsx:457:          <div className="sk-recovery-box">
src/features/settings/RecoverySettingsScreen.tsx:490:              <h3 className="sk-recovery-box__title">{lastResult.heading}</h3>
src/features/settings/DrawerPolicySettingsScreen.tsx:30:    help: 'Une opération activée crée une seule impulsion du tiroir après validation réussie de l’écriture financière. L’impression et la réimpression n
src/features/settings/UserManagementSettingsScreen.tsx:320:    // an unloaded editor previously rendered every box unchecked and looked
src/features/settings/recovery/DestinationBox.tsx:27:    <div className="sk-recovery-box" data-testid="destination-box">
src/features/settings/recovery/DestinationBox.tsx:28:      <div className="sk-recovery-box__header">
src/features/settings/recovery/DestinationBox.tsx:30:          <h3 className="sk-recovery-box__title">{t('recovery.destination')}</h3>
src/features/settings/recovery/DestinationBox.tsx:31:          <p className="sk-recovery-box__desc">{t('recovery.destinationHelp')}</p>
src/features/settings/recovery/BackupList.tsx:54:    <div className="sk-recovery-box" data-testid={testId}>
src/features/settings/recovery/BackupList.tsx:55:      <div className="sk-recovery-box__header">
src/features/settings/recovery/BackupList.tsx:57:          <h3 className="sk-recovery-box__title">{title}</h3>
src/features/settings/recovery/BackupList.tsx:65:        <p className="sk-recovery-box__desc">{emptyLabel ?? t('recovery.listEmpty')}</p>
src/features/catalog2/CatalogPanel.tsx:480:       picker would show an empty box for a product that does have one. */
src/features/catalog2/CatalogPanel.tsx:816:                        baseUnitCode={detail.unit_code}
src/features/catalog2/CatalogPanel.tsx:1187: * WS-D-13 Phase B / WS-D-14 Part 2 — alternate units for ONE variant ("a BOX
src/features/catalog2/CatalogPanel.tsx:1188: * that equals 6 pieces, or 50 Kg").
src/features/catalog2/CatalogPanel.tsx:1190: * Conversions are PER VARIANT and stay that way: a box of pillows and a box
src/features/catalog2/CatalogPanel.tsx:1191: * of nails hold different counts, so a global "BOX = 6" would be wrong.
src/features/catalog2/CatalogPanel.tsx:1194: * BOX, and alternative is pieces, and 1 box = 10 pieces" — the "1" can land
src/features/catalog2/CatalogPanel.tsx:1196: * is exactly the trap this feature exists to avoid: "1 BOX = 3 PIECE" divided
src/features/catalog2/CatalogPanel.tsx:1197: * would store "0.333333 BOX = 1 PIECE", a number the operator never typed.
src/features/catalog2/CatalogPanel.tsx:1200: * what gets displayed back — never a computed reciprocal. `conversion_factor`
src/features/catalog2/CatalogPanel.tsx:1204: * `conversion_quantity` is an exact-decimal STRING end to end. Nothing here
src/features/catalog2/CatalogPanel.tsx:1217: * Removing a conversion is structural, so it is confirmed (RULING 6), exactly
src/features/catalog2/CatalogPanel.tsx:1224:  baseUnitCode,
src/features/catalog2/CatalogPanel.tsx:1231:  /** The product's unit code, for the "1 BOX = 10 PIECE" reading. */
src/features/catalog2/CatalogPanel.tsx:1232:  baseUnitCode: string;
src/features/catalog2/CatalogPanel.tsx:1262:    return dir === 'BASE_TO_ALT' ? { left: baseUnitCode, right: altCode } : { left: altCode, right: baseUnitCode };
src/features/catalog2/CatalogPanel.tsx:1298:  const confirmSides = confirmTarget ? sides(confirmTarget.conversion_direction, confirmTarget.unit_code) : null;
src/features/catalog2/CatalogPanel.tsx:1304:      {/* B3 — these conversions are DEFINABLE and VISIBLE only. Nothing in
src/features/catalog2/CatalogPanel.tsx:1316:            const row = sides(alt.conversion_direction, alt.unit_code);
src/features/catalog2/CatalogPanel.tsx:1319:                <span data-testid={`catalog2-alt-unit-${alt.id}`} data-direction={alt.conversion_direction}>
src/features/catalog2/CatalogPanel.tsx:1322:                    quantity: formatExactDecimal(alt.conversion_quantity),
src/features/catalog2/CatalogPanel.tsx:1425:            quantity: formatExactDecimal(confirmTarget.conversion_quantity),
src/features/inventory/StockReceiptScreen.tsx:60:  const [baseUnit, setBaseUnit] = useState<{ id: number; code: string } | null>(null);
src/features/inventory/StockReceiptScreen.tsx:84:  const baseUnitAllowsFractions = allowsFractionsById(baseUnit?.id);
src/features/inventory/StockReceiptScreen.tsx:87:    && baseUnit != null
src/features/inventory/StockReceiptScreen.tsx:88:    && baseUnitAllowsFractions === false
src/features/inventory/StockReceiptScreen.tsx:90:    ? t('units.wholeOnlyQuantity', { unit: baseUnit.code })
src/features/inventory/StockReceiptScreen.tsx:343:                {baseUnit && (
src/features/inventory/StockReceiptScreen.tsx:345:                    <span>{locale === 'ar' ? 'الوحدة' : locale === 'fr' ? 'Unité' : 'Unit'}:</span> <strong>{baseUnit.code}</strong>
src/features/inventory/InventoryScreen.tsx:158:                    <td>{item.base_unit_code}</td>
src/features/inventory/InventoryScreen.tsx:165:                      {formatExactDecimal(item.quantity_on_hand)} {item.base_unit_code}
src/features/inventory/exactDecimal.ts:32: * quantity: true for Kg and Litre, false for Piece and Box. This function is
src/features/inventory/StockAdjustmentScreen.tsx:295:   * be an alternate (a Box) rather than the base, so the flag consulted is
src/features/onboarding/xlsxParser.ts:1002:          probleme: `La ligne ${rowNumber} ouvre une nouvelle opération mais la date en ${cellRef(1, rowNumber)} est vide.`,
src/features/onboarding/xlsxParser.ts:1003:          action: 'Saisissez la date de l\'opération au format JJ/MM/AAAA, par exemple 15/05/2025.',
src/features/onboarding/xlsxParser.ts:1069:          probleme: `Un bénéfice est écrit en ${cellRef(benefitCol, rowNumber)} alors que l'opération est de type ${typeStr}.`,
src/features/onboarding/xlsxParser.ts:1070:          action: 'Le bénéfice ne se note que sur les ventes. Videz la case, ou corrigez le type de l\'opération.',
src/features/onboarding/xlsxParser.ts:1098:          probleme: `La ligne ${rowNumber} contient des données mais aucune opération n'a été ouverte au-dessus d'elle.`,
src/features/onboarding/xlsxParser.ts:1116:              probleme: `La date du ${isoDate} en ${cellRef(1, rowNumber)} contredit la date du ${activeTxn.transactionDate} de l'opération commencée ligne ${activeTxn.sourceF
src/features/onboarding/xlsxParser.ts:1117:              action: 'Laissez la date vide sur les lignes de suite, ou ouvrez une nouvelle opération en renseignant le Type.',
src/features/onboarding/xlsxParser.ts:1140:              probleme: `Le statut « ${paidStr} » en ${cellRef(3, rowNumber)} contredit celui de l'opération commencée ligne ${activeTxn.sourceFirstExcelRow}.`,
src/features/onboarding/xlsxParser.ts:1168:          probleme: `Le numéro de page ${pageNoVal} en ${cellRef(pageCol, rowNumber)} contredit la page ${activeTxn.pageNumber} de l'opération commencée ligne ${activeTxn.sou
src/features/onboarding/xlsxParser.ts:1179:          action: 'Le bénéfice se note une seule fois, sur la première ligne de la vente. Ce montant n\'est pas repris dans le bénéfice de l\'opération.',
src/features/onboarding/xlsxParser.ts:1188:    // workbook stores are kept as text; no numeric conversion takes place.
src/features/onboarding/xlsxParser.ts:1336:        action: 'Elle est ignorée : aucune opération ni ligne n\'a été créée. Complétez-la si un produit ou un montant manque.',
src/features/onboarding/OpeningStateApplicationScreen.tsx:110:    irreversible: 'Il s’agit d’une opération de démarrage unique et immuable. Toute correction ultérieure exige une écriture contrôlée; les preuves
src/features/onboarding/OpeningStateApplicationScreen.tsx:111:    inventoryWarning: 'La valeur du stock est uniquement financière. Cette opération ne crée ni quantités, ni positions, ni mouvements, ni coût moyen pon
src/features/onboarding/HistoricalReportsScreen.tsx:120:  trendEmpty: 'Aucune opération sur la période choisie.',
src/features/onboarding/HistoricalReportsScreen.tsx:128:  operations: 'Opérations',
src/features/onboarding/HistoricalReportsScreen.tsx:139:  emptyRows: 'Aucune opération sur la période choisie.',
src/features/onboarding/HistoricalReportsScreen.tsx:162:  transactions: 'Opérations',
src/features/onboarding/HistoricalReportsScreen.tsx:184:    `Situation au ${date}, c'est-à-dire après la dernière opération recopiée. Un stock est une position, pas un mouvement : le filtre de période ne s'applique
src/features/onboarding/HistoricalFinanceScreen.tsx:709:                <dt>Opérations</dt>
src/features/onboarding/HistoricalTrendChart.tsx:76:          {[0.25, 0.5, 0.75, 1].map((ratio) => {
src/features/onboarding/HistoricalTrendChart.tsx:77:            const y = chartHeight - ratio * chartHeight;
src/features/onboarding/HistoricalTrendChart.tsx:78:            const val = Math.round(ratio * maxVal);
src/features/onboarding/HistoricalTrendChart.tsx:80:              <g key={ratio}>
src/features/pos/PosScreen.tsx:154:  // Customers and categories load once. Neither depends on the search box.
src/features/pos/PosScreen.tsx:284:   * WS-D-15 A4 — the POS search box, on Enter, routes through the SAME
src/features/pos/PosScreen.tsx:888:                  <div className="sk-pos__discount-box" data-testid="pos-discount-box">
src/features/documents/BusinessDocumentDetailModal.tsx:183:      pdfGen: 'Génération PDF',
src/features/documents/DocumentsScreen.tsx:123:    subtitle: 'Consultez les documents opérationnels, transactions validées et rapports comptables.',
src/features/documents/DocumentsScreen.tsx:134:    generation: 'Génération',
src/features/documents/CustomerDocumentView.tsx:29:    kind: 'Type', status: 'Statut', attempts: 'Tentatives', generate: 'Générer le PDF', generating: 'Génération…', reprint: 'Mettre la réimpression en file',
```

---

Branch: task/ws-o-0-units-discovery
Commit: see the commit that adds this file (a file cannot contain its own commit hash); reported in the hand-off message.
Pushed: see hand-off message
