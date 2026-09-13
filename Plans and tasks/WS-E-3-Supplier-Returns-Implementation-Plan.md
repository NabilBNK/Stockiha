# WS-E-3 — Return Goods to a Supplier

**Workstream:** WS-E — Procurement & Supplier Operations
**Sub-plan:** 3 of 3 (final)
**Executing agent:** Gemini (Antigravity IDE)
**Base branch:** `task/ws-e-2-supplier-payments-and-documents` (commit `2518000`)
**Branch to create:** `task/ws-e-3-supplier-returns`
**Risk class:** HIGHEST in WS-E. This moves stock, changes inventory valuation, writes journals, and revises two functions written in WS-E-2.

---

## 0. Authority, precedence, and the override you are being given

Read in this order before touching anything:

1. This document.
2. `GEMINI.md`
3. `AGENTS.md`

This document wins where they differ.

**Explicit, limited override of `GEMINI.md` section 2.** This task touches money, journals, weighted-average cost, inventory quantities, stock movements, a SQL migration, `SECURITY DEFINER` functions, and Rust that posts a business transaction. `GEMINI.md` tells you to refuse all of that. You may proceed **only** because every line of SQL and Rust is written out for you below.

The condition attached to that override:

> **Do not invent, adapt, "improve", reorder, rename, or optimise any SQL or Rust in this document. Copy it exactly.**

If something fails to compile or a test fails, **report it**. Do not repair it by changing the logic. This function decrements real stock and writes real accounting entries; a well-meaning fix here is worse than a failure.

If any file does not look the way this plan describes, **stop and report the difference**.

**One more limit, specific to this sub-plan.** WS-E-2 created `procurement.post_purchase_payment`, `procurement.list_purchase_payment_status` and `procurement.list_supplier_balances`. This sub-plan replaces all three, in full, with the versions printed below. Replacing them is authorised and required. Editing them by hand is not — delete nothing, patch nothing, just include the full `CREATE OR REPLACE` blocks exactly as written in the new migration file.

---

## 1. Repository safety — do this first

```bash
git branch --show-current
git rev-parse HEAD
git status --short
git fetch origin --prune
```

If `git status --short` shows changes that are not yours, **STOP** and report. Never reset, clean, stash, or discard.

Then:

```bash
git checkout task/ws-e-2-supplier-payments-and-documents
git pull origin task/ws-e-2-supplier-payments-and-documents
git checkout -b task/ws-e-3-supplier-returns
```

Work only on `task/ws-e-3-supplier-returns`.

---

## 2. Background — what a supplier return is and why the numbers are what they are

Read this so you understand what you are building. You still may not change the design.

The client receives goods, records the purchase, and later finds some of them broken, expired, or simply the wrong item. He sends them back. Three things have to happen at once:

1. **The stock leaves.** The goods are no longer in the warehouse.
2. **The supplier owes less.** The claim against the client shrinks by the price he was charged.
3. **The books stay balanced.**

Points 2 and 3 pull in different directions, and this is the one piece of arithmetic in WS-E you must understand rather than just copy.

Stock in this system is valued at **weighted average cost** (WAC): if you bought 10 units at 100 and later 10 more at 120, every unit on the shelf is now valued at 110, regardless of which box it came from. But when you send an item back to a supplier, he credits you what **he** charged you — say 100 — not your internal average of 110.

So the two figures differ, and the difference is real. It goes to the procurement variance account, which is what that account exists for.

Worked example. Return 4 units that were bought at 100 each, while the current WAC is 110:

```
Supplier credit  4 × 100 = 400.00     Debit  GRNI                 400.00
Stock leaving    4 × 110 = 440.00     Credit Inventory            440.00
Difference               = -40.00     Debit  Procurement variance  40.00
                                      -----------------------------------
                                      Debits 440.00 = Credits 440.00
```

If the WAC had instead been 90, the difference would sit on the other side: the variance line would be a credit of 40.00. The rule the SQL implements is:

- `variance = refund_total − inventory_value`
- `variance > 0` → **credit** procurement variance
- `variance < 0` → **debit** procurement variance
- `variance = 0` → no third line at all

**Rulings you must not deviate from:**

- A return is always **against a specific purchase**, line by line. There is no free-standing return. This is what makes the refund price knowable.
- You may never return more of a line than was received on it, minus whatever was already returned from it.
- You may never return more than is physically in the warehouse right now.
- The return quantity is entered in the **same unit** as the original purchase line. There is no unit selector.
- `inventory.confirm_direct_purchase` and `procurement.post_purchase_payment`'s posting logic are not being redesigned. The payment function is reprinted below only because its outstanding-amount arithmetic must now subtract returns.
- The legacy `procurement.supplier_returns` tables and `inventory.confirm_supplier_return` are **history**. They require a Purchase Order, which no longer exists in this app. Do not call them, do not modify them, do not delete them.

**Why the payment functions have to change.** Buy 1,000, return 400, and you owe the supplier 600 — not 1,000. If the payment function kept using the raw purchase total, the app would happily let the client pay for goods he sent back. So from now on:

```
amount owed on a purchase = purchase total − returns − payments already made
```

And when returns exceed what is still owed (he returned goods he had already paid for), the supplier owes **him** money. The app reports that as a supplier credit rather than a negative number, because a negative "outstanding" reads as a bug to a shopkeeper.

---

## 3. Objective

Let the user send goods back to a supplier from a specific purchase, with the stock, the supplier balance and the ledger all updated in one atomic operation.

---

## 4. Scope — IN

Ten tasks, in this order. Do not reorder them.

---

### T1 — The migration

Create **one** new file, exactly at this path:

```
src-tauri/migrations/20260912090000_ws_e_003_purchase_returns.sql
```

Copy the content below verbatim. Do not edit any existing migration file. Do not create a second migration.

```sql
-- WS-E-003: return goods to a supplier, against a posted purchase receipt.
--
-- Stock leaves at weighted-average cost; the supplier is credited at the price
-- originally charged on the receipt line. The difference is a procurement
-- variance. Returns reduce what is owed on the purchase, so the WS-E-002
-- payment functions are reprinted here with returns subtracted.
--
-- The legacy PO-based procurement.supplier_returns tables and
-- inventory.confirm_supplier_return are untouched history and are never
-- called from this file.

SET ROLE stockiha_owner;

-- =============================================================================
-- 1. Return tables
-- =============================================================================

CREATE TABLE IF NOT EXISTS procurement.purchase_returns (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    document_id         bigint NOT NULL UNIQUE REFERENCES core.business_documents (id) ON DELETE RESTRICT,
    receipt_document_id bigint NOT NULL REFERENCES procurement.purchase_receipts (document_id) ON DELETE RESTRICT,
    supplier_id         bigint NOT NULL REFERENCES procurement.suppliers (id) ON DELETE RESTRICT,
    warehouse_id        bigint NOT NULL REFERENCES inventory.warehouses (id) ON DELETE RESTRICT,
    reason_code         text NOT NULL,
    note                text,
    refund_amount       numeric(14, 2) NOT NULL,
    inventory_value     numeric(14, 2) NOT NULL,
    variance_amount     numeric(14, 2) NOT NULL,
    journal_document_id bigint NOT NULL REFERENCES finance.journal_entries (document_id) ON DELETE RESTRICT,
    posted_by_user_id   bigint NOT NULL REFERENCES iam.users (id) ON DELETE RESTRICT,
    created_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT purchase_returns_reason_valid
        CHECK (reason_code IN ('DEFECTIVE_GOODS', 'EXCESS_DELIVERY', 'WRONG_ITEM')),
    CONSTRAINT purchase_returns_refund_positive CHECK (refund_amount > 0),
    CONSTRAINT purchase_returns_inventory_non_negative CHECK (inventory_value >= 0)
);

CREATE TABLE IF NOT EXISTS procurement.purchase_return_lines (
    id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    return_document_id bigint NOT NULL REFERENCES procurement.purchase_returns (document_id) ON DELETE RESTRICT,
    line_number        integer NOT NULL,
    receipt_line_id    bigint NOT NULL REFERENCES procurement.purchase_receipt_lines (id) ON DELETE RESTRICT,
    variant_id         bigint NOT NULL REFERENCES catalog.product_variants (id) ON DELETE RESTRICT,
    unit_id            bigint NOT NULL REFERENCES catalog.units (id) ON DELETE RESTRICT,
    quantity           numeric(18, 3) NOT NULL,
    base_quantity      numeric(18, 3) NOT NULL,
    unit_cost          numeric(14, 2) NOT NULL,
    refund_total       numeric(14, 2) NOT NULL,
    wac_at_return      numeric(18, 6) NOT NULL,
    inventory_value    numeric(14, 2) NOT NULL,
    movement_id        bigint NOT NULL UNIQUE REFERENCES inventory.movements (id) ON DELETE RESTRICT,
    CONSTRAINT purchase_return_lines_document_line_unique UNIQUE (return_document_id, line_number),
    CONSTRAINT purchase_return_lines_quantity_positive CHECK (quantity > 0),
    CONSTRAINT purchase_return_lines_base_quantity_positive CHECK (base_quantity > 0)
);

CREATE INDEX IF NOT EXISTS purchase_returns_receipt_idx
    ON procurement.purchase_returns (receipt_document_id);

CREATE INDEX IF NOT EXISTS purchase_returns_supplier_idx
    ON procurement.purchase_returns (supplier_id);

CREATE INDEX IF NOT EXISTS purchase_return_lines_receipt_line_idx
    ON procurement.purchase_return_lines (receipt_line_id);

-- =============================================================================
-- 2. Immutability
-- =============================================================================

CREATE OR REPLACE FUNCTION procurement.forbid_purchase_return_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'IMMUTABLE_RECORD: posted supplier returns cannot be modified or deleted'
        USING ERRCODE = '0A000';
END;
$$;

DROP TRIGGER IF EXISTS purchase_returns_immutable ON procurement.purchase_returns;
CREATE TRIGGER purchase_returns_immutable
    BEFORE UPDATE OR DELETE ON procurement.purchase_returns
    FOR EACH ROW
    EXECUTE FUNCTION procurement.forbid_purchase_return_mutation();

DROP TRIGGER IF EXISTS purchase_return_lines_immutable ON procurement.purchase_return_lines;
CREATE TRIGGER purchase_return_lines_immutable
    BEFORE UPDATE OR DELETE ON procurement.purchase_return_lines
    FOR EACH ROW
    EXECUTE FUNCTION procurement.forbid_purchase_return_mutation();

-- =============================================================================
-- 3. Response shape (also replays an idempotent retry)
-- =============================================================================

CREATE OR REPLACE FUNCTION procurement._purchase_return_response(p_return_document_id bigint)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
    SELECT jsonb_build_object(
        'document_id', purchase_return.document_id,
        'document_number', return_document.document_number,
        'receipt_document_id', purchase_return.receipt_document_id,
        'receipt_document_number', receipt_document.document_number,
        'supplier_id', purchase_return.supplier_id,
        'supplier_name', supplier.name,
        'warehouse_id', purchase_return.warehouse_id,
        'warehouse_name', warehouse.name,
        'reason_code', purchase_return.reason_code,
        'note', purchase_return.note,
        'refund_amount', purchase_return.refund_amount::text,
        'inventory_value', purchase_return.inventory_value::text,
        'variance_amount', purchase_return.variance_amount::text,
        'journal_document_id', purchase_return.journal_document_id,
        'journal_document_number', journal_document.document_number,
        'posted_at', return_document.posted_at
    )
    FROM procurement.purchase_returns purchase_return
    JOIN core.business_documents return_document ON return_document.id = purchase_return.document_id
    JOIN core.business_documents receipt_document ON receipt_document.id = purchase_return.receipt_document_id
    JOIN core.business_documents journal_document ON journal_document.id = purchase_return.journal_document_id
    JOIN procurement.suppliers supplier ON supplier.id = purchase_return.supplier_id
    JOIN inventory.warehouses warehouse ON warehouse.id = purchase_return.warehouse_id
    WHERE purchase_return.document_id = p_return_document_id;
$$;

-- =============================================================================
-- 4. The posting function
-- =============================================================================

CREATE OR REPLACE FUNCTION procurement.confirm_purchase_return(
    p_session_token text,
    p_request_id uuid,
    p_payload_hash bytea,
    p_receipt_document_id bigint,
    p_fiscal_period_id bigint,
    p_document_date date,
    p_reason_code text,
    p_note text,
    p_lines jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
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
    IF p_reason_code IS NULL OR p_reason_code NOT IN ('DEFECTIVE_GOODS', 'EXCESS_DELIVERY', 'WRONG_ITEM') THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: unsupported supplier return reason'
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
$$;

-- =============================================================================
-- 5. Read model: what is still returnable on a purchase
-- =============================================================================

CREATE OR REPLACE FUNCTION procurement.list_purchase_returnable_lines(
    p_session_token text,
    p_receipt_document_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_result jsonb;
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_PROCUREMENT');

    SELECT coalesce(jsonb_agg(
        jsonb_build_object(
            'receipt_line_id', data.id,
            'line_number', data.line_number,
            'variant_id', data.variant_id,
            'sku', data.sku,
            'product_name', data.product_name,
            'variant_name', data.variant_name,
            'unit_id', data.unit_id,
            'unit_code', data.unit_code,
            'unit_cost', data.unit_cost::text,
            'quantity_received', data.quantity_received::text,
            'quantity_returned', data.quantity_returned::text,
            'quantity_returnable', data.quantity_returnable::text
        ) ORDER BY data.line_number
    ), '[]'::jsonb)
    INTO v_result
    FROM (
        SELECT
            receipt_line.id,
            receipt_line.line_number,
            receipt_line.variant_id,
            variant.sku,
            product.name AS product_name,
            variant.name AS variant_name,
            receipt_line.unit_id,
            unit.code AS unit_code,
            receipt_line.unit_cost,
            receipt_line.quantity_received,
            coalesce(returned.total, 0)::numeric(18, 3) AS quantity_returned,
            (receipt_line.quantity_received - coalesce(returned.total, 0))::numeric(18, 3) AS quantity_returnable
        FROM procurement.purchase_receipt_lines receipt_line
        JOIN catalog.product_variants variant ON variant.id = receipt_line.variant_id
        JOIN catalog.products product ON product.id = variant.product_id
        JOIN catalog.units unit ON unit.id = receipt_line.unit_id
        LEFT JOIN (
            SELECT return_line.receipt_line_id, sum(return_line.quantity) AS total
            FROM procurement.purchase_return_lines return_line
            GROUP BY return_line.receipt_line_id
        ) returned ON returned.receipt_line_id = receipt_line.id
        WHERE receipt_line.document_id = p_receipt_document_id
    ) data;

    RETURN v_result;
END;
$$;

-- =============================================================================
-- 6. Read model: returns posted against a purchase
-- =============================================================================

CREATE OR REPLACE FUNCTION procurement.list_purchase_returns(
    p_session_token text,
    p_receipt_document_id bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_result jsonb;
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_PROCUREMENT');

    SELECT coalesce(jsonb_agg(
        jsonb_build_object(
            'document_id', purchase_return.document_id,
            'document_number', return_document.document_number,
            'receipt_document_id', purchase_return.receipt_document_id,
            'supplier_id', purchase_return.supplier_id,
            'supplier_name', supplier.name,
            'reason_code', purchase_return.reason_code,
            'note', purchase_return.note,
            'refund_amount', purchase_return.refund_amount::text,
            'inventory_value', purchase_return.inventory_value::text,
            'variance_amount', purchase_return.variance_amount::text,
            'journal_document_id', purchase_return.journal_document_id,
            'journal_document_number', journal_document.document_number,
            'posted_at', return_document.posted_at
        ) ORDER BY return_document.posted_at DESC, purchase_return.document_id DESC
    ), '[]'::jsonb)
    INTO v_result
    FROM procurement.purchase_returns purchase_return
    JOIN core.business_documents return_document ON return_document.id = purchase_return.document_id
    JOIN core.business_documents journal_document ON journal_document.id = purchase_return.journal_document_id
    JOIN procurement.suppliers supplier ON supplier.id = purchase_return.supplier_id
    WHERE (p_receipt_document_id IS NULL OR purchase_return.receipt_document_id = p_receipt_document_id);

    RETURN v_result;
END;
$$;

-- =============================================================================
-- 7. WS-E-002 functions, reprinted with returns subtracted
-- =============================================================================

CREATE OR REPLACE FUNCTION procurement.list_purchase_payment_status(
    p_session_token text,
    p_receipt_document_id bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_result jsonb;
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_PROCUREMENT');

    SELECT coalesce(jsonb_agg(
        jsonb_build_object(
            'receipt_document_id', data.document_id,
            'total_amount', data.total_amount::text,
            'returned_amount', data.returned_amount::text,
            'net_payable_amount', data.net_payable::text,
            'paid_amount', data.paid_amount::text,
            'outstanding_amount', greatest(data.net_payable - data.paid_amount, 0)::text,
            'supplier_credit_amount', greatest(data.paid_amount - data.net_payable, 0)::text,
            'payment_status', CASE
                WHEN data.net_payable - data.paid_amount <= 0 THEN 'PAID'
                WHEN data.paid_amount <= 0 THEN 'UNPAID'
                ELSE 'PARTIALLY_PAID'
            END
        ) ORDER BY data.document_id DESC
    ), '[]'::jsonb)
    INTO v_result
    FROM (
        SELECT
            receipt.document_id,
            receipt.total_amount,
            coalesce(returned.total, 0)::numeric(14, 2) AS returned_amount,
            (receipt.total_amount - coalesce(returned.total, 0))::numeric(14, 2) AS net_payable,
            coalesce(paid.total, 0)::numeric(14, 2) AS paid_amount
        FROM procurement.purchase_receipts receipt
        JOIN core.business_documents document ON document.id = receipt.document_id
        LEFT JOIN (
            SELECT purchase_return.receipt_document_id, sum(purchase_return.refund_amount) AS total
            FROM procurement.purchase_returns purchase_return
            GROUP BY purchase_return.receipt_document_id
        ) returned ON returned.receipt_document_id = receipt.document_id
        LEFT JOIN (
            SELECT payment.receipt_document_id, sum(payment.amount) AS total
            FROM procurement.purchase_receipt_payments payment
            GROUP BY payment.receipt_document_id
        ) paid ON paid.receipt_document_id = receipt.document_id
        WHERE document.status = 'POSTED'
          AND (p_receipt_document_id IS NULL OR receipt.document_id = p_receipt_document_id)
    ) data;

    RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION procurement.list_supplier_balances(p_session_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_result jsonb;
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_PROCUREMENT');

    SELECT coalesce(jsonb_agg(
        jsonb_build_object(
            'supplier_id', data.id,
            'supplier_name', data.name,
            'total_purchased', data.total_purchased::text,
            'total_returned', data.total_returned::text,
            'total_paid', data.total_paid::text,
            'balance_due', data.balance_due::text
        ) ORDER BY data.name
    ), '[]'::jsonb)
    INTO v_result
    FROM (
        SELECT
            supplier.id,
            supplier.name,
            coalesce(purchased.total, 0)::numeric(14, 2) AS total_purchased,
            coalesce(returned.total, 0)::numeric(14, 2) AS total_returned,
            coalesce(paid.total, 0)::numeric(14, 2) AS total_paid,
            (coalesce(purchased.total, 0) - coalesce(returned.total, 0) - coalesce(paid.total, 0))::numeric(14, 2) AS balance_due
        FROM procurement.suppliers supplier
        LEFT JOIN (
            SELECT receipt.supplier_id, sum(receipt.total_amount) AS total
            FROM procurement.purchase_receipts receipt
            JOIN core.business_documents document ON document.id = receipt.document_id
            WHERE document.status = 'POSTED'
            GROUP BY receipt.supplier_id
        ) purchased ON purchased.supplier_id = supplier.id
        LEFT JOIN (
            SELECT purchase_return.supplier_id, sum(purchase_return.refund_amount) AS total
            FROM procurement.purchase_returns purchase_return
            GROUP BY purchase_return.supplier_id
        ) returned ON returned.supplier_id = supplier.id
        LEFT JOIN (
            SELECT payment.supplier_id, sum(payment.amount) AS total
            FROM procurement.purchase_receipt_payments payment
            GROUP BY payment.supplier_id
        ) paid ON paid.supplier_id = supplier.id
    ) data;

    RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION procurement.post_purchase_payment(
    p_session_token text,
    p_request_id uuid,
    p_payload_hash bytea,
    p_receipt_document_id bigint,
    p_fiscal_period_id bigint,
    p_document_date date,
    p_payment_method text,
    p_amount numeric,
    p_reference_number text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_user_id bigint;
    v_cached_result bigint;
    v_period_status text;
    v_period_start date;
    v_period_end date;
    v_fiscal_year integer;
    v_supplier_id bigint;
    v_receipt_total numeric(14, 2);
    v_returned numeric(14, 2);
    v_already_paid numeric(14, 2);
    v_outstanding numeric(14, 2);
    v_amount numeric(14, 2);
    v_sequence bigint;
    v_document_number text;
    v_payment_document_id bigint;
    v_journal_document_id bigint;
BEGIN
    SELECT user_id INTO v_user_id
    FROM iam.resolve_session_with_permission(p_session_token, 'POST_SUPPLIER_PAYMENT');

    v_cached_result := core.reserve_idempotent_request(
        'procurement.post_purchase_payment', p_request_id, p_payload_hash
    );
    IF v_cached_result IS NOT NULL THEN
        RETURN procurement._purchase_payment_response(v_cached_result);
    END IF;

    IF p_payment_method IS NULL OR p_payment_method NOT IN ('CASH', 'BANK_TRANSFER') THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: payment method must be CASH or BANK_TRANSFER'
            USING ERRCODE = '22023';
    END IF;

    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: payment amount must be greater than zero'
            USING ERRCODE = '22023';
    END IF;

    IF p_amount <> round(p_amount, 2) THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: payment amount must have at most two decimals'
            USING ERRCODE = '22023';
    END IF;

    v_amount := p_amount::numeric(14, 2);

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

    SELECT receipt.supplier_id, receipt.total_amount
    INTO v_supplier_id, v_receipt_total
    FROM procurement.purchase_receipts receipt
    JOIN core.business_documents document ON document.id = receipt.document_id
    WHERE receipt.document_id = p_receipt_document_id
      AND document.status = 'POSTED'
    FOR UPDATE OF receipt;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: posted purchase receipt % not found', p_receipt_document_id
            USING ERRCODE = '55000';
    END IF;

    SELECT coalesce(sum(refund_amount), 0)::numeric(14, 2)
    INTO v_returned
    FROM procurement.purchase_returns
    WHERE receipt_document_id = p_receipt_document_id;

    SELECT coalesce(sum(amount), 0)::numeric(14, 2)
    INTO v_already_paid
    FROM procurement.purchase_receipt_payments
    WHERE receipt_document_id = p_receipt_document_id;

    v_outstanding := (v_receipt_total - v_returned - v_already_paid)::numeric(14, 2);

    IF v_outstanding <= 0 THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: nothing is owed on purchase %', p_receipt_document_id
            USING ERRCODE = '55000';
    END IF;

    IF v_amount > v_outstanding THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: payment exceeds the outstanding amount'
            USING ERRCODE = '22023';
    END IF;

    v_sequence := core.claim_next_document_number('SUPPLIER_PAYMENT', v_fiscal_year);
    v_document_number := 'SP-' || v_fiscal_year || '-' || lpad(v_sequence::text, 6, '0');

    INSERT INTO core.business_documents (
        document_type, status, document_date, fiscal_period_id, fiscal_year,
        sequence_number, document_number, posted_at
    ) VALUES (
        'SUPPLIER_PAYMENT', 'POSTED', p_document_date, p_fiscal_period_id, v_fiscal_year,
        v_sequence, v_document_number, now()
    ) RETURNING id INTO v_payment_document_id;

    v_journal_document_id := finance.create_posted_journal(
        p_document_date,
        p_fiscal_period_id,
        'Supplier payment ' || v_document_number,
        'SUPPLIER_PAYMENT',
        v_payment_document_id
    );

    PERFORM finance.add_journal_line(
        v_journal_document_id, 1, 'GRNI'::finance.account_role_code,
        v_amount, 0.00, 'Supplier payment settles goods received'
    );

    IF p_payment_method = 'CASH' THEN
        PERFORM finance.add_journal_line(
            v_journal_document_id, 2, 'CASH'::finance.account_role_code,
            0.00, v_amount, 'Supplier payment in cash'
        );
    ELSE
        PERFORM finance.add_journal_line(
            v_journal_document_id, 2, 'BANK'::finance.account_role_code,
            0.00, v_amount, 'Supplier payment by bank transfer'
        );
    END IF;

    INSERT INTO procurement.purchase_receipt_payments (
        document_id, receipt_document_id, supplier_id, payment_method, amount,
        reference_number, journal_document_id, posted_by_user_id
    ) VALUES (
        v_payment_document_id, p_receipt_document_id, v_supplier_id, p_payment_method, v_amount,
        nullif(btrim(coalesce(p_reference_number, '')), ''), v_journal_document_id, v_user_id
    );

    PERFORM core.record_idempotent_result(
        'procurement.post_purchase_payment', p_request_id, v_payment_document_id
    );

    RETURN procurement._purchase_payment_response(v_payment_document_id);
END;
$$;

-- =============================================================================
-- 8. Privileges
-- =============================================================================

REVOKE ALL ON procurement.purchase_returns FROM PUBLIC;
REVOKE ALL ON procurement.purchase_return_lines FROM PUBLIC;
GRANT SELECT ON procurement.purchase_returns TO stockiha_runtime;
GRANT SELECT ON procurement.purchase_return_lines TO stockiha_runtime;

REVOKE ALL ON FUNCTION procurement.forbid_purchase_return_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION procurement._purchase_return_response(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION procurement.confirm_purchase_return(text, uuid, bytea, bigint, bigint, date, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION procurement.list_purchase_returnable_lines(text, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION procurement.list_purchase_returns(text, bigint) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION procurement.confirm_purchase_return(text, uuid, bytea, bigint, bigint, date, text, text, jsonb) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION procurement.list_purchase_returnable_lines(text, bigint) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION procurement.list_purchase_returns(text, bigint) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION procurement.list_purchase_payment_status(text, bigint) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION procurement.list_supplier_balances(text) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION procurement.post_purchase_payment(text, uuid, bytea, bigint, bigint, date, text, numeric, text) TO stockiha_runtime;

RESET ROLE;
```

---

### T2 — Rust DTOs

In `src-tauri/src/domain/procurement.rs`, append these five structs at the **end of the file**, and make the two edits marked in 2b.

**2a. New structs:**

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfirmPurchaseReturnLinePayload {
    pub receipt_line_id: i64,
    pub quantity: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfirmPurchaseReturnPayload {
    pub request_id: String,
    pub receipt_document_id: i64,
    pub fiscal_period_id: i64,
    pub document_date: String,
    pub reason_code: String,
    pub note: Option<String>,
    pub lines: Vec<ConfirmPurchaseReturnLinePayload>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfirmPurchaseReturnResult {
    pub document_id: i64,
    pub document_number: String,
    pub receipt_document_id: i64,
    pub receipt_document_number: Option<String>,
    pub supplier_id: i64,
    pub supplier_name: String,
    pub warehouse_id: i64,
    pub warehouse_name: String,
    pub reason_code: String,
    pub note: Option<String>,
    pub refund_amount: String,
    pub inventory_value: String,
    pub variance_amount: String,
    pub journal_document_id: i64,
    pub journal_document_number: Option<String>,
    pub posted_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PurchaseReturnableLineDto {
    pub receipt_line_id: i64,
    pub line_number: i32,
    pub variant_id: i64,
    pub sku: Option<String>,
    pub product_name: String,
    pub variant_name: Option<String>,
    pub unit_id: i64,
    pub unit_code: String,
    pub unit_cost: String,
    pub quantity_received: String,
    pub quantity_returned: String,
    pub quantity_returnable: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PurchaseReturnSummaryDto {
    pub document_id: i64,
    pub document_number: Option<String>,
    pub receipt_document_id: i64,
    pub supplier_id: i64,
    pub supplier_name: String,
    pub reason_code: String,
    pub note: Option<String>,
    pub refund_amount: String,
    pub inventory_value: String,
    pub variance_amount: String,
    pub journal_document_id: i64,
    pub journal_document_number: Option<String>,
    pub posted_at: String,
}
```

**2b. Extend the existing `PurchasePaymentStatusDto`** (added in WS-E-2) with three new fields, so it matches the new SQL. Add them in this position:

```rust
pub struct PurchasePaymentStatusDto {
    pub receipt_document_id: i64,
    pub total_amount: String,
    pub returned_amount: String,
    pub net_payable_amount: String,
    pub paid_amount: String,
    pub outstanding_amount: String,
    pub supplier_credit_amount: String,
    pub payment_status: String,
}
```

**2c. Extend the existing `SupplierBalanceDto`** with one field:

```rust
pub struct SupplierBalanceDto {
    pub supplier_id: i64,
    pub supplier_name: String,
    pub total_purchased: String,
    pub total_returned: String,
    pub total_paid: String,
    pub balance_due: String,
}
```

Change nothing else in this file.

---

### T3 — Rust service functions

In `src-tauri/src/application/procurement_service.rs`:

**3a.** Extend the existing `use crate::domain::procurement::{...}` list with:

```
ConfirmPurchaseReturnPayload, ConfirmPurchaseReturnResult,
PurchaseReturnableLineDto, PurchaseReturnSummaryDto,
```

`cargo fmt` will fix the ordering.

**3b.** Append at the **end of the file**:

```rust
pub(crate) async fn confirm_purchase_return(
    pool: &PgPool,
    session_token: &str,
    payload: ConfirmPurchaseReturnPayload,
) -> Result<ConfirmPurchaseReturnResult, AppError> {
    if payload.lines.is_empty() {
        return Err(AppError::ValidationError {
            diagnostic: "A supplier return needs at least one line".to_string(),
        });
    }

    let canonical = json!({
        "receipt_document_id": payload.receipt_document_id,
        "fiscal_period_id": payload.fiscal_period_id,
        "document_date": payload.document_date,
        "reason_code": payload.reason_code,
        "note": payload.note,
        "lines": payload.lines,
    });
    let hash = payload_hash(&canonical);
    let doc_date = parse_iso_date(&payload.document_date)?;

    let lines_json = serde_json::to_value(&payload.lines)
        .map_err(|e| AppError::internal(format!("Invalid return lines JSON: {e}")))?;

    let res: JsonValue = query_scalar(
        "SELECT procurement.confirm_purchase_return($1, $2::uuid, $3, $4, $5, $6, $7, $8, $9)",
    )
    .bind(session_token)
    .bind(&payload.request_id)
    .bind(hash.as_slice())
    .bind(payload.receipt_document_id)
    .bind(payload.fiscal_period_id)
    .bind(doc_date)
    .bind(&payload.reason_code)
    .bind(payload.note.as_deref())
    .bind(&lines_json)
    .fetch_one(pool)
    .await
    .map_err(AppError::from_posting_error)?;

    let result: ConfirmPurchaseReturnResult = serde_json::from_value(res)
        .map_err(|e| AppError::internal(format!("Failed to parse purchase return result: {e}")))?;
    Ok(result)
}

pub(crate) async fn list_purchase_returnable_lines(
    pool: &PgPool,
    session_token: &str,
    receipt_document_id: i64,
) -> Result<Vec<PurchaseReturnableLineDto>, AppError> {
    let res: JsonValue =
        query_scalar("SELECT procurement.list_purchase_returnable_lines($1, $2)")
            .bind(session_token)
            .bind(receipt_document_id)
            .fetch_one(pool)
            .await
            .map_err(AppError::from_posting_error)?;

    serde_json::from_value(res)
        .map_err(|e| AppError::internal(format!("Failed to parse returnable lines: {e}")))
}

pub(crate) async fn list_purchase_returns(
    pool: &PgPool,
    session_token: &str,
    receipt_document_id: Option<i64>,
) -> Result<Vec<PurchaseReturnSummaryDto>, AppError> {
    let res: JsonValue = query_scalar("SELECT procurement.list_purchase_returns($1, $2)")
        .bind(session_token)
        .bind(receipt_document_id)
        .fetch_one(pool)
        .await
        .map_err(AppError::from_posting_error)?;

    serde_json::from_value(res)
        .map_err(|e| AppError::internal(format!("Failed to parse purchase returns: {e}")))
}
```

---

### T4 — Tauri commands

In `src-tauri/src/commands/procurement.rs`:

**4a.** Extend the existing `use crate::domain::procurement::{...}` list with the same four names as T3a.

**4b.** Append at the **end of the file**:

```rust
#[tauri::command]
pub(crate) async fn confirm_purchase_return(
    state: State<'_, DatabaseState>,
    session_token: String,
    payload: ConfirmPurchaseReturnPayload,
) -> Result<ConfirmPurchaseReturnResult, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    procurement_service::confirm_purchase_return(pool, &session_token, payload)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn list_purchase_returnable_lines(
    state: State<'_, DatabaseState>,
    session_token: String,
    receipt_document_id: i64,
) -> Result<Vec<PurchaseReturnableLineDto>, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    procurement_service::list_purchase_returnable_lines(pool, &session_token, receipt_document_id)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn list_purchase_returns(
    state: State<'_, DatabaseState>,
    session_token: String,
    receipt_document_id: Option<i64>,
) -> Result<Vec<PurchaseReturnSummaryDto>, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    procurement_service::list_purchase_returns(pool, &session_token, receipt_document_id)
        .await
        .map_err(IpcError::from)
}
```

**4c.** In `src-tauri/src/lib.rs`, find the line added in WS-E-2:

```rust
            commands::procurement::list_supplier_balances,
```

and add these three lines immediately after it, same indentation:

```rust
            commands::procurement::confirm_purchase_return,
            commands::procurement::list_purchase_returnable_lines,
            commands::procurement::list_purchase_returns,
```

Change nothing else in `lib.rs`.

---

### T5 — TypeScript IPC layer

**5a.** In `src/shared/ipc/commands.ts`, add three entries immediately after `LIST_SUPPLIER_BALANCES`:

```ts
  CONFIRM_PURCHASE_RETURN: 'confirm_purchase_return',
  LIST_PURCHASE_RETURNABLE_LINES: 'list_purchase_returnable_lines',
  LIST_PURCHASE_RETURNS: 'list_purchase_returns',
```

**5b.** In `src/shared/ipc/dto.ts`:

Extend the existing `PurchasePaymentStatusDto` interface to:

```ts
export interface PurchasePaymentStatusDto {
  receipt_document_id: number;
  total_amount: string;
  returned_amount: string;
  net_payable_amount: string;
  paid_amount: string;
  outstanding_amount: string;
  supplier_credit_amount: string;
  payment_status: PurchasePaymentStatus;
}
```

Extend the existing `SupplierBalanceDto` interface to:

```ts
export interface SupplierBalanceDto {
  supplier_id: number;
  supplier_name: string;
  total_purchased: string;
  total_returned: string;
  total_paid: string;
  balance_due: string;
}
```

Then append at the **end of the file**:

```ts
export type PurchaseReturnReason = 'DEFECTIVE_GOODS' | 'EXCESS_DELIVERY' | 'WRONG_ITEM';

export interface ConfirmPurchaseReturnLinePayload {
  receipt_line_id: number;
  quantity: string;
}

export interface ConfirmPurchaseReturnPayload {
  request_id: string;
  receipt_document_id: number;
  fiscal_period_id: number;
  document_date: string;
  reason_code: PurchaseReturnReason;
  note: string | null;
  lines: ConfirmPurchaseReturnLinePayload[];
}

export interface ConfirmPurchaseReturnResult {
  document_id: number;
  document_number: string;
  receipt_document_id: number;
  receipt_document_number: string | null;
  supplier_id: number;
  supplier_name: string;
  warehouse_id: number;
  warehouse_name: string;
  reason_code: PurchaseReturnReason;
  note: string | null;
  refund_amount: string;
  inventory_value: string;
  variance_amount: string;
  journal_document_id: number;
  journal_document_number: string | null;
  posted_at: string;
}

export interface PurchaseReturnableLineDto {
  receipt_line_id: number;
  line_number: number;
  variant_id: number;
  sku: string | null;
  product_name: string;
  variant_name: string | null;
  unit_id: number;
  unit_code: string;
  unit_cost: string;
  quantity_received: string;
  quantity_returned: string;
  quantity_returnable: string;
}

export interface PurchaseReturnSummaryDto {
  document_id: number;
  document_number: string | null;
  receipt_document_id: number;
  supplier_id: number;
  supplier_name: string;
  reason_code: PurchaseReturnReason;
  note: string | null;
  refund_amount: string;
  inventory_value: string;
  variance_amount: string;
  journal_document_id: number;
  journal_document_number: string | null;
  posted_at: string;
}
```

**5c.** In `src/shared/ipc/gateway.ts`, append at the **end of the file**:

```ts
export function confirmPurchaseReturn(
  sessionToken: string,
  payload: import('./dto').ConfirmPurchaseReturnPayload
): Promise<import('./dto').ConfirmPurchaseReturnResult> {
  return call<import('./dto').ConfirmPurchaseReturnResult>(COMMANDS.CONFIRM_PURCHASE_RETURN, {
    sessionToken,
    payload,
  });
}

export function listPurchaseReturnableLines(
  sessionToken: string,
  receiptDocumentId: number
): Promise<import('./dto').PurchaseReturnableLineDto[]> {
  return call<import('./dto').PurchaseReturnableLineDto[]>(
    COMMANDS.LIST_PURCHASE_RETURNABLE_LINES,
    { sessionToken, receiptDocumentId }
  );
}

export function listPurchaseReturns(
  sessionToken: string,
  receiptDocumentId?: number | null
): Promise<import('./dto').PurchaseReturnSummaryDto[]> {
  return call<import('./dto').PurchaseReturnSummaryDto[]>(COMMANDS.LIST_PURCHASE_RETURNS, {
    sessionToken,
    receiptDocumentId: receiptDocumentId ?? null,
  });
}
```

---

### T6 — The return modal

Create `src/features/procurement/PurchaseReturnModal.tsx` with exactly this content:

```tsx
import { useEffect, useMemo, useState } from 'react';
import { confirmPurchaseReturn, listPurchaseReturnableLines, newRequestId } from '../../shared/ipc/gateway';
import type {
  ConfirmPurchaseReturnPayload,
  ConfirmPurchaseReturnResult,
  PurchaseReturnReason,
  PurchaseReturnableLineDto,
} from '../../shared/ipc/dto';
import { useI18n } from '../../shared/i18n';
import { useErrorText } from '../../shared/hooks/useErrorText';
import { currentBusinessDate } from '../../shared/utils/businessDate';
import { addExactDecimals, multiplyExactDecimals } from './procurementDecimal';
import { PROCUREMENT_COPY } from './procurementCopy';
import './procurement.css';

interface Props {
  sessionToken: string;
  receiptDocumentId: number;
  receiptDocumentNumber: string;
  supplierName: string;
  fiscalPeriodId: number | null;
  onClose: () => void;
  onPosted: (result: ConfirmPurchaseReturnResult) => void;
}

export function PurchaseReturnModal({
  sessionToken,
  receiptDocumentId,
  receiptDocumentNumber,
  supplierName,
  fiscalPeriodId,
  onClose,
  onPosted,
}: Props) {
  const { locale } = useI18n();
  const text = PROCUREMENT_COPY[locale];
  const errorText = useErrorText();

  const [lines, setLines] = useState<PurchaseReturnableLineDto[]>([]);
  const [quantities, setQuantities] = useState<Record<number, string>>({});
  const [reason, setReason] = useState<PurchaseReturnReason>('DEFECTIVE_GOODS');
  const [documentDate, setDocumentDate] = useState(currentBusinessDate());
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await listPurchaseReturnableLines(sessionToken, receiptDocumentId);
        if (!active) return;
        setLines(data);
      } catch (err: unknown) {
        if (active) setError(errorText(err));
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [sessionToken, receiptDocumentId]);

  const refundPreview = useMemo(() => {
    let total = '0';
    lines.forEach((line) => {
      const quantity = quantities[line.receipt_line_id];
      if (!quantity || quantity.trim() === '') return;
      total = addExactDecimals(total, multiplyExactDecimals(quantity, line.unit_cost));
    });
    return total;
  }, [lines, quantities]);

  const handleSubmit = async () => {
    const payloadLines = lines
      .filter((line) => {
        const quantity = (quantities[line.receipt_line_id] ?? '').trim();
        return quantity !== '' && quantity !== '0';
      })
      .map((line) => ({
        receipt_line_id: line.receipt_line_id,
        quantity: (quantities[line.receipt_line_id] ?? '').trim(),
      }));

    if (payloadLines.length === 0) {
      setError(text.returnNeedsLine);
      return;
    }
    if (!fiscalPeriodId) {
      setError(text.openPeriodRequired);
      return;
    }

    try {
      setSubmitting(true);
      setError(null);
      const payload: ConfirmPurchaseReturnPayload = {
        request_id: newRequestId(),
        receipt_document_id: receiptDocumentId,
        fiscal_period_id: fiscalPeriodId,
        document_date: documentDate,
        reason_code: reason,
        note: note.trim() || null,
        lines: payloadLines,
      };
      const result = await confirmPurchaseReturn(sessionToken, payload);
      onPosted(result);
    } catch (err: unknown) {
      setError(errorText(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="sk-modal__backdrop" role="presentation" data-testid="purchase-return-backdrop">
      <div
        className="sk-modal sk-modal-content--large"
        role="dialog"
        aria-modal="true"
        aria-label={text.returnToSupplier}
        style={{ width: 'min(100%, 820px)', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}
        data-testid="purchase-return-modal"
      >
        <div className="sk-modal-header">
          <h2 className="sk-modal__title">{text.returnToSupplier}</h2>
          <button
            type="button"
            className="sk-modal-close"
            onClick={onClose}
            aria-label={text.close}
            data-testid="purchase-return-close"
          >
            ✕
          </button>
        </div>

        {error && (
          <div className="sk-banner sk-banner--error" role="alert" data-testid="purchase-return-error">
            {error}
          </div>
        )}

        <div className="pr-detail-header-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
          <div className="pr-detail-field">
            <span className="pr-detail-field__label">{text.receipt}</span>
            <span className="pr-detail-field__value">{receiptDocumentNumber}</span>
          </div>
          <div className="pr-detail-field">
            <span className="pr-detail-field__label">{text.supplier}</span>
            <span className="pr-detail-field__value">{supplierName}</span>
          </div>
        </div>

        <div className="sk-form-grid">
          <label>
            {text.returnReason} *
            <select
              value={reason}
              onChange={(event) => setReason(event.target.value as PurchaseReturnReason)}
              data-testid="purchase-return-reason"
            >
              <option value="DEFECTIVE_GOODS">{text.reasonDefective}</option>
              <option value="EXCESS_DELIVERY">{text.reasonExcess}</option>
              <option value="WRONG_ITEM">{text.reasonWrongItem}</option>
            </select>
          </label>

          <label>
            {text.date} *
            <input
              type="date"
              className="sk-field__input"
              value={documentDate}
              onChange={(event) => setDocumentDate(event.target.value)}
              data-testid="purchase-return-date"
            />
          </label>

          <label className="sk-grid-full">
            {text.note}
            <input
              type="text"
              className="sk-field__input"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              data-testid="purchase-return-note"
            />
          </label>
        </div>

        <div className="sk-table-wrap" style={{ flex: 1, overflowY: 'auto' }}>
          <table className="sk-table" data-testid="purchase-return-lines-table">
            <thead>
              <tr>
                <th>{text.product}</th>
                <th>{text.unit}</th>
                <th className="sk-num">{text.unitCost} (DZD)</th>
                <th className="sk-num">{text.quantityReturnable}</th>
                <th className="sk-num">{text.quantityToReturn}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5}>{text.loading}</td>
                </tr>
              ) : (
                lines.map((line) => (
                  <tr key={line.receipt_line_id}>
                    <td>
                      {line.product_name}
                      {line.variant_name ? ` — ${line.variant_name}` : ''}
                      <div style={{ fontSize: '0.75rem', color: 'var(--sk-muted)' }}>{line.sku}</div>
                    </td>
                    <td>{line.unit_code}</td>
                    <td className="sk-num">{line.unit_cost}</td>
                    <td className="sk-num">{line.quantity_returnable}</td>
                    <td className="sk-num">
                      <input
                        type="text"
                        className="sk-input-small"
                        value={quantities[line.receipt_line_id] ?? ''}
                        disabled={Number(line.quantity_returnable) <= 0}
                        onChange={(event) =>
                          setQuantities((prev) => ({
                            ...prev,
                            [line.receipt_line_id]: event.target.value,
                          }))
                        }
                        data-testid={`return-quantity-${line.receipt_line_id}`}
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div
          style={{ display: 'flex', justifyContent: 'flex-end', padding: '10px 0', fontWeight: 700 }}
          data-testid="purchase-return-refund-preview"
        >
          {text.refundPreview}: {refundPreview} DZD
        </div>

        <div className="sk-form-actions">
          <button
            type="button"
            className="sk-button sk-button--secondary"
            onClick={onClose}
            data-testid="purchase-return-cancel"
          >
            {text.cancel}
          </button>
          <button
            type="button"
            className="sk-button sk-button--primary"
            onClick={handleSubmit}
            disabled={submitting || loading}
            data-testid="purchase-return-submit"
          >
            {submitting ? text.confirming : text.confirmReturn}
          </button>
        </div>
      </div>
    </div>
  );
}
```

Before writing this file, confirm that `src/features/procurement/procurementDecimal.ts` exports both `addExactDecimals` and `multiplyExactDecimals`. If either is missing, **stop and report** — do not write your own.

The `Number(line.quantity_returnable) <= 0` above is used **only** to disable an input. It never touches a stored value. Do not use `Number()` anywhere else in this sub-plan.

---

### T7 — Wire returns into the Purchases screen

All edits are in `src/features/procurement/PurchasesScreen.tsx`.

**7a.** Add the import:

```tsx
import { PurchaseReturnModal } from './PurchaseReturnModal';
```

**7b.** Add state next to `paymentTarget`:

```tsx
const [returnTarget, setReturnTarget] = useState<PurchaseReceiptSummary | null>(null);
```

**7c.** In the Payment cell added by WS-E-2, immediately after the outstanding-amount line, add a returned-amount line and a supplier-credit line:

```tsx
{status.returned_amount !== '0.00' && (
  <span style={{ fontSize: '0.75rem', color: 'var(--sk-muted)' }}>
    {text.returned}: {status.returned_amount} DZD
  </span>
)}
{status.supplier_credit_amount !== '0.00' && (
  <span style={{ fontSize: '0.75rem', color: 'var(--sk-warn, var(--sk-muted))' }}>
    {text.supplierOwesYou}: {status.supplier_credit_amount} DZD
  </span>
)}
```

**7d.** In the actions cell, immediately after the `Record payment` button block from WS-E-2, add:

```tsx
{capabilities.can_post_supplier_return && (
  <button
    type="button"
    className="sk-button sk-button--small sk-button--secondary"
    onClick={() => setReturnTarget(receipt)}
    data-testid={`return-goods-${receipt.document_id}`}
  >
    {text.returnToSupplier}
  </button>
)}
```

**7e.** Render the modal immediately after the `PurchasePaymentModal` block:

```tsx
{returnTarget && (
  <PurchaseReturnModal
    sessionToken={sessionToken}
    receiptDocumentId={returnTarget.document_id}
    receiptDocumentNumber={returnTarget.document_number}
    supplierName={returnTarget.supplier_name}
    fiscalPeriodId={openFiscalPeriodId}
    onClose={() => setReturnTarget(null)}
    onPosted={async (result) => {
      setReturnTarget(null);
      setSuccessBanner(`${text.returnPosted} ${result.document_number} (${result.refund_amount} DZD)`);
      await loadData();
    }}
  />
)}
```

---

### T8 — Supplier returned-total column

In `src/features/procurement/SuppliersScreen.tsx`, add one column immediately before the Balance due column added in WS-E-2.

Header:

```tsx
<th className="sk-num">{text.returned}</th>
```

Data cell:

```tsx
<td className="sk-num" data-testid={`supplier-returned-${supplier.id}`}>
  {balances.find((item) => item.supplier_id === supplier.id)?.total_returned ?? '0.00'} DZD
</td>
```

Change nothing else in that file.

---

### T9 — Copy keys

In `src/features/procurement/procurementCopy.ts`, add these keys to the `ProcurementCopy` type and to all three locale objects, with exactly these values.

| key | en | fr | ar |
|---|---|---|---|
| `returnToSupplier` | `Return to supplier` | `Retour fournisseur` | `إرجاع للمورد` |
| `confirmReturn` | `Confirm return` | `Confirmer le retour` | `تأكيد الإرجاع` |
| `returnPosted` | `Return recorded` | `Retour enregistré` | `تم تسجيل الإرجاع` |
| `returnReason` | `Reason` | `Motif` | `السبب` |
| `reasonDefective` | `Damaged or defective` | `Endommagé ou défectueux` | `تالف أو معيب` |
| `reasonExcess` | `Delivered in excess` | `Livré en excès` | `كمية زائدة` |
| `reasonWrongItem` | `Wrong item` | `Article incorrect` | `صنف خاطئ` |
| `quantityReturnable` | `Can return` | `Retournable` | `القابل للإرجاع` |
| `quantityToReturn` | `Return quantity` | `Quantité à retourner` | `الكمية المرجعة` |
| `refundPreview` | `Supplier credit` | `Avoir fournisseur` | `رصيد لدى المورد` |
| `returnNeedsLine` | `Enter a quantity on at least one line.` | `Saisissez une quantité sur au moins une ligne.` | `أدخل كمية في سطر واحد على الأقل.` |
| `returned` | `Returned` | `Retourné` | `مُرجع` |
| `supplierOwesYou` | `Supplier owes you` | `Le fournisseur vous doit` | `المورد مدين لك` |

Remove no existing key.

---

### T10 — Tests

**10a. Database acceptance suite.** Create `src-tauri/tests/procurement/ws_e_003_purchase_return_integration.sql` with exactly this content:

```sql
-- WS-E-003: supplier return invariants -- stock leaves at WAC, supplier is
-- credited at the purchase price, the variance balances the journal, returns
-- reduce what is owed, and over-returning is refused.
\set ON_ERROR_STOP on

DO $$
DECLARE
    v_suffix text := floor(random() * 1000000000)::text;
    v_admin_id bigint;
    v_admin_token text := 'ws_e_003_admin_' || floor(random() * 1000000000)::text;
    v_supplier_id bigint;
    v_warehouse_id bigint;
    v_product_id bigint;
    v_variant_id bigint;
    v_unit_id bigint;
    v_period_id bigint;
    v_document_date date;
    v_receipt jsonb;
    v_receipt_id bigint;
    v_receipt_line_id bigint;
    v_return jsonb;
    v_repeat jsonb;
    v_return_id bigint;
    v_journal_id bigint;
    v_status jsonb;
    v_qty numeric;
    v_value numeric;
    v_wac numeric;
    v_rejected boolean := false;
BEGIN
    INSERT INTO iam.users (username, display_name, password_hash)
    VALUES ('ws_e_003_admin_' || v_suffix, 'WS-E-003 Admin', 'hash')
    RETURNING id INTO v_admin_id;
    INSERT INTO iam.user_roles (user_id, role_id)
    SELECT v_admin_id, id FROM iam.roles WHERE code = 'ADMIN';
    INSERT INTO iam.application_sessions (user_id, workstation_id, token_hash, expires_at)
    VALUES (v_admin_id, 'WS-E-003', sha256(v_admin_token::bytea), now() + interval '2 hours');

    SELECT id, starts_on + 1
    INTO v_period_id, v_document_date
    FROM finance.fiscal_periods
    WHERE status = 'OPEN'
    ORDER BY starts_on DESC
    LIMIT 1;
    ASSERT v_period_id IS NOT NULL, 'Supplier return requires an open fiscal period';

    SELECT id INTO v_unit_id FROM catalog.units ORDER BY id LIMIT 1;
    ASSERT v_unit_id IS NOT NULL, 'Supplier return test requires a catalog unit';

    INSERT INTO procurement.suppliers (code, name, is_active)
    VALUES ('SUP-RET-' || v_suffix, 'Return Supplier', true)
    RETURNING id INTO v_supplier_id;
    INSERT INTO inventory.warehouses (code, name, is_active)
    VALUES ('WH-RET-' || v_suffix, 'Return Warehouse', true)
    RETURNING id INTO v_warehouse_id;
    INSERT INTO catalog.products (name, is_active)
    VALUES ('Return Item', true)
    RETURNING id INTO v_product_id;
    INSERT INTO catalog.product_variants (product_id, base_unit_id, sku, sale_price, is_active)
    VALUES (v_product_id, v_unit_id, 'RET-SKU-' || v_suffix, 200.00, true)
    RETURNING id INTO v_variant_id;

    -- Opening stock: 10 units valued at 120 each, so the later purchase at 100
    -- produces a blended WAC of 110 and a real return variance.
    INSERT INTO inventory.positions (warehouse_id, variant_id, quantity_on_hand, total_value, last_known_wac)
    VALUES (v_warehouse_id, v_variant_id, 10.000, 1200.00, 120.000000);

    -- Purchase 10 units at 100.00 -> qty 20, value 2200.00, WAC 110.000000
    v_receipt := inventory.confirm_direct_purchase(
        v_admin_token,
        'e3000000-0000-4000-8000-000000000001'::uuid,
        '\x01'::bytea,
        v_supplier_id, v_warehouse_id, v_period_id, v_document_date,
        'WS-E-003 purchase',
        jsonb_build_array(jsonb_build_object(
            'variant_id', v_variant_id, 'unit_id', v_unit_id,
            'quantity_received', 10.000, 'unit_cost', 100.00
        ))
    );
    v_receipt_id := (v_receipt ->> 'document_id')::bigint;

    SELECT quantity_on_hand, total_value, last_known_wac
    INTO v_qty, v_value, v_wac
    FROM inventory.positions
    WHERE warehouse_id = v_warehouse_id AND variant_id = v_variant_id;
    ASSERT v_qty = 20.000, 'Stock after purchase must be 20';
    ASSERT v_wac = 110.000000, 'WAC after purchase must be 110.000000';

    SELECT id INTO v_receipt_line_id
    FROM procurement.purchase_receipt_lines
    WHERE document_id = v_receipt_id
    ORDER BY line_number
    LIMIT 1;

    -- Return 4 units: supplier credit 400.00, stock out 440.00, variance -40.00
    v_return := procurement.confirm_purchase_return(
        v_admin_token,
        'e3000000-0000-4000-8000-000000000002'::uuid,
        '\x02'::bytea,
        v_receipt_id, v_period_id, v_document_date,
        'DEFECTIVE_GOODS', 'four broken units',
        jsonb_build_array(jsonb_build_object(
            'receipt_line_id', v_receipt_line_id, 'quantity', 4.000
        ))
    );
    v_return_id := (v_return ->> 'document_id')::bigint;
    ASSERT (v_return ->> 'document_number') LIKE 'PRT-%', 'Return must get a PRT document number';
    ASSERT (v_return ->> 'refund_amount')::numeric = 400.00, 'Supplier credit must be 4 x 100.00';
    ASSERT (v_return ->> 'inventory_value')::numeric = 440.00, 'Stock must leave at 4 x 110.00';
    ASSERT (v_return ->> 'variance_amount')::numeric = -40.00, 'Variance must be -40.00';

    SELECT quantity_on_hand, total_value, last_known_wac
    INTO v_qty, v_value, v_wac
    FROM inventory.positions
    WHERE warehouse_id = v_warehouse_id AND variant_id = v_variant_id;
    ASSERT v_qty = 16.000, 'Stock after return must be 16';
    ASSERT v_value = 1760.0000, 'Stock value after return must be 1760.00';
    ASSERT v_wac = 110.000000, 'Returning at WAC must not change WAC';

    ASSERT EXISTS (
        SELECT 1 FROM inventory.movements
        WHERE reference_type = 'PURCHASE_RETURN'
          AND reference_id = v_return_id
          AND movement_type = 'ISSUE'
          AND quantity_delta = -4.000
    ), 'Return must write one ISSUE movement';

    v_journal_id := (v_return ->> 'journal_document_id')::bigint;
    ASSERT EXISTS (
        SELECT 1 FROM finance.journal_lines line
        WHERE line.document_id = v_journal_id
          AND line.account_code = finance.require_account_role('GRNI')
          AND line.debit = 400.00
    ), 'Return journal must debit GRNI by the supplier credit';
    ASSERT EXISTS (
        SELECT 1 FROM finance.journal_lines line
        WHERE line.document_id = v_journal_id
          AND line.account_code = finance.require_account_role('INVENTORY')
          AND line.credit = 440.00
    ), 'Return journal must credit inventory at WAC';
    ASSERT EXISTS (
        SELECT 1 FROM finance.journal_lines line
        WHERE line.document_id = v_journal_id
          AND line.account_code = finance.require_account_role('PROCUREMENT_VARIANCE')
          AND line.debit = 40.00
    ), 'Return journal must debit the variance';
    ASSERT NOT EXISTS (
        SELECT 1 FROM finance.journal_lines
        WHERE document_id = v_journal_id
        GROUP BY document_id HAVING sum(debit) <> sum(credit)
    ), 'Return journal must balance';
    ASSERT NOT EXISTS (
        SELECT 1 FROM finance.journal_lines
        WHERE document_id = v_journal_id AND account_id IS NULL
    ), 'Return journal lines must carry account_id';

    -- The return reduces what is owed on the purchase
    v_status := procurement.list_purchase_payment_status(v_admin_token, v_receipt_id);
    ASSERT (v_status -> 0 ->> 'returned_amount')::numeric = 400.00, 'Status must report the returned amount';
    ASSERT (v_status -> 0 ->> 'net_payable_amount')::numeric = 600.00, 'Net payable must be 1000 - 400';
    ASSERT (v_status -> 0 ->> 'outstanding_amount')::numeric = 600.00, 'Outstanding must be 600.00';

    -- Idempotent retry
    v_repeat := procurement.confirm_purchase_return(
        v_admin_token,
        'e3000000-0000-4000-8000-000000000002'::uuid,
        '\x02'::bytea,
        v_receipt_id, v_period_id, v_document_date,
        'DEFECTIVE_GOODS', 'four broken units',
        jsonb_build_array(jsonb_build_object(
            'receipt_line_id', v_receipt_line_id, 'quantity', 4.000
        ))
    );
    ASSERT (v_repeat ->> 'document_id')::bigint = v_return_id, 'Retry must return the original return';
    ASSERT (SELECT count(*) FROM procurement.purchase_returns
            WHERE receipt_document_id = v_receipt_id) = 1,
        'Idempotent retry must not duplicate the return';

    -- Paying more than the net payable is refused
    BEGIN
        PERFORM procurement.post_purchase_payment(
            v_admin_token,
            'e3000000-0000-4000-8000-000000000003'::uuid,
            '\x03'::bytea,
            v_receipt_id, v_period_id, v_document_date,
            'CASH', 601.00, NULL
        );
    EXCEPTION WHEN invalid_parameter_value THEN
        v_rejected := true;
    END;
    ASSERT v_rejected, 'A payment above the net payable must be refused after a return';
    v_rejected := false;

    -- Returning more than remains on the line is refused
    BEGIN
        PERFORM procurement.confirm_purchase_return(
            v_admin_token,
            'e3000000-0000-4000-8000-000000000004'::uuid,
            '\x04'::bytea,
            v_receipt_id, v_period_id, v_document_date,
            'WRONG_ITEM', NULL,
            jsonb_build_array(jsonb_build_object(
                'receipt_line_id', v_receipt_line_id, 'quantity', 7.000
            ))
        );
    EXCEPTION WHEN invalid_parameter_value THEN
        v_rejected := true;
    END;
    ASSERT v_rejected, 'Returning more than was received must be refused';
    v_rejected := false;

    -- An unsupported reason is refused
    BEGIN
        PERFORM procurement.confirm_purchase_return(
            v_admin_token,
            'e3000000-0000-4000-8000-000000000005'::uuid,
            '\x05'::bytea,
            v_receipt_id, v_period_id, v_document_date,
            'CHANGED_MY_MIND', NULL,
            jsonb_build_array(jsonb_build_object(
                'receipt_line_id', v_receipt_line_id, 'quantity', 1.000
            ))
        );
    EXCEPTION WHEN invalid_parameter_value THEN
        v_rejected := true;
    END;
    ASSERT v_rejected, 'An unsupported return reason must be refused';
    v_rejected := false;

    -- Returnable quantity read model
    ASSERT (
        SELECT (entry ->> 'quantity_returnable')::numeric
        FROM jsonb_array_elements(
            procurement.list_purchase_returnable_lines(v_admin_token, v_receipt_id)
        ) entry
        LIMIT 1
    ) = 6.000, 'Six units must remain returnable';

    -- Supplier balance nets the return
    ASSERT EXISTS (
        SELECT 1 FROM jsonb_array_elements(
            procurement.list_supplier_balances(v_admin_token)
        ) entry
        WHERE (entry ->> 'supplier_id')::bigint = v_supplier_id
          AND (entry ->> 'total_returned')::numeric = 400.00
          AND (entry ->> 'balance_due')::numeric = 600.00
    ), 'Supplier balance must net purchases against returns';

    -- Returns are immutable
    BEGIN
        UPDATE procurement.purchase_returns
        SET refund_amount = 1.00
        WHERE document_id = v_return_id;
    EXCEPTION WHEN feature_not_supported THEN
        v_rejected := true;
    END;
    ASSERT v_rejected, 'A posted return must be immutable';
END;
$$;
```

Register it in `src-tauri/tests/run_current_sql_suites.sh` by adding this line to the `suites` array immediately after the `ws_e_002_purchase_payment_integration.sql` line:

```
  src-tauri/tests/procurement/ws_e_003_purchase_return_integration.sql
```

**10b. Update the WS-E-2 SQL suite.** `ws_e_002_purchase_payment_integration.sql` asserts on the payment status shape, which now has more fields. Only if a WS-E-2 assertion now fails, adjust that assertion so it reads the same value under the same key name — `outstanding_amount` and `payment_status` are unchanged, so it should pass untouched. Do not weaken or delete any assertion in that file. If it fails for any other reason, **stop and report**.

**10c. Frontend workflow test.** Create `tests/purchase-return.workflow.test.tsx`, copying the structure, mock style and login helper of `tests/purchase-payment.workflow.test.tsx`. It must contain three tests:

1. **Button visibility.** With `capabilities.can_post_supplier_return` true and one receipt with `document_id: 100`, assert `return-goods-100` is present. With that capability false, assert it is absent.
2. **Modal loads returnable lines.** Click `return-goods-100`, mock `list_purchase_returnable_lines` to return one line with `receipt_line_id: 55`, `unit_cost: '100.00'`, `quantity_returnable: '10.000'`, and assert `return-quantity-55` is present.
3. **Submit sends the right payload.** Type `4` into `return-quantity-55`, click `purchase-return-submit`, and assert `confirm_purchase_return` was called once with `payload.receipt_document_id === 100`, `payload.reason_code === 'DEFECTIVE_GOODS'`, and `payload.lines` equal to `[{ receipt_line_id: 55, quantity: '4' }]`.

Add no new dependency. Do not weaken any existing test.

---

## 5. Scope — OUT. Do not touch.

- `inventory.confirm_direct_purchase`, in any form, in any migration.
- `inventory.confirm_supplier_return`, `procurement.create_supplier_return_draft`, `procurement.supplier_returns`, `procurement.supplier_return_lines`, `procurement.supplier_invoices`, `procurement.supplier_liabilities`, `procurement.supplier_payments`. History. Read nothing, write nothing, delete nothing.
- Any existing migration file. Forward-only: your one new migration is the only SQL change.
- `finance.add_journal_line`, `finance.create_posted_journal`, `finance.require_account_role`, `finance.account_role_mappings`, the chart of accounts, the `finance.account_role_code` enum.
- The `procurement._purchase_payment_response` function and the `procurement.purchase_receipt_payments` table from WS-E-2 — unchanged.
- Sales, POS, cash sessions, the drawer, customers, receivables, stock adjustments, stock receipts.
- `PurchaseItemPicker.tsx`, the barcode entry, the purchase line table, `PurchasePaymentModal.tsx`.
- The document printing and PDF code under `src/shared/documents/`.
- Permissions and roles. `POST_SUPPLIER_RETURN` and `can_post_supplier_return` already exist. Do not add, rename, or re-grant a permission.
- `package.json`, `package-lock.json`, `Cargo.toml`, `Cargo.lock`.
- `STOCKIHA_GROUND_TRUTH.md`, `AGENTS.md`, `CURRENT_STEP.md`, `README.md`, `TASKS.md`, `GEMINI.md`.

If you find a genuine unrelated bug: **report it, do not fix it.**

---

## 6. Constraints

- **Never use floating point for money or quantity.** Values cross the layers as strings (TypeScript), `Decimal` (Rust), `numeric` (PostgreSQL). The single `Number()` call in T6 disables an input and is the only one permitted in this sub-plan.
- React never decides. The modal collects quantities and shows a preview; PostgreSQL decides what is returnable, what the stock is worth, and what the journal says.
- Every user-facing string comes from `procurementCopy.ts` in all three locales. No hardcoded English in JSX.
- Use logical CSS properties only. Arabic RTL must keep working.
- No placeholder, no `TODO`, no mock, no commented-out code left behind.
- Show your file plan before editing. If it contains a file not named in section 4, you have misread the task — stop.

---

## 7. Acceptance criteria

1. The migration applies cleanly on a database that already has every earlier migration, including WS-E-2's, and `sqlx` records it.
2. No existing migration file is modified. `git diff --stat` shows exactly one new file under `src-tauri/migrations/`.
3. `cargo fmt`, `cargo check`, `cargo clippy -- -D warnings`, `cargo test` all pass.
4. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` all pass.
5. Both `ws_e_002_purchase_payment_integration.sql` and `ws_e_003_purchase_return_integration.sql` pass inside `run_current_sql_suites.sh`, and every other suite still passes.
6. Confirming a purchase and recording a payment still behave exactly as they did in WS-E-2.
7. `Return to supplier` opens a dialog listing the purchase's lines with the quantity still returnable on each.
8. Returning a quantity reduces stock on hand by the correct amount and leaves the weighted average cost unchanged.
9. The return posts one balanced journal: GRNI debited at the purchase price, inventory credited at weighted average cost, the difference on the procurement variance account.
10. After a return, the purchase's outstanding amount drops by the returned value, and a payment above the new amount is refused.
11. Returning more than remains on a line is refused with a clear message and posts nothing.
12. Returning more than is physically in stock is refused with a clear message and posts nothing.
13. If the purchase was already fully paid, the row shows a supplier credit rather than a negative outstanding amount.
14. The Suppliers screen shows Returned and Balance due, and Balance due equals purchased minus returned minus paid.
15. A user whose role lacks `POST_SUPPLIER_RETURN` never sees the `Return to supplier` button.
16. All new text appears correctly in French, Arabic (RTL intact) and English.
17. `git status --short` shows only files named in this plan.

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
```

```bash
git status --short
git diff --stat
```

Do not run `npm run tauri build`. The Windows build and the manual acceptance run are the owner's steps.

Commit once:

```
feat(procurement): WS-E-3 return goods to a supplier against a purchase
```

Push the branch. Do not merge into `main`.

---

## 9. Report back — required format

```
WS-E-3 REPORT

Git
- Branch:
- Full commit hash:
- Pushed: yes/no
- Working tree clean: yes/no
- Migration files: new = ?, modified = ? (modified must be 0)

Files changed (full list):
Files created (full list):

Acceptance criteria 1-17: PASS / FAIL each, one line each

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

Anything not finished, and why:

Unrelated problems found but NOT fixed:
```

If any acceptance criterion fails, the final result is FAIL. Do not hide or downgrade a failure to finish.

---

## 10. Manual acceptance checklist for the owner (not for the agent)

Run on Windows after the agent reports PASS.

1. Sign in as Admin. Note the current stock and cost of one product on the Inventory screen.
2. Buy 10 of that product at 100 DZD. Confirm. Click **Pay later**.
3. Open the Purchases list. The row shows Unpaid, 1,000.00 outstanding.
4. Click **Return to supplier**. Expect the dialog to list the line with 10 returnable.
5. Enter 4, reason Damaged or defective, confirm. Expect a `PRT-…` number and a supplier-credit figure of 400.00.
6. Check Inventory. Stock is down by 4. The unit cost is unchanged.
7. Back on Purchases, the row shows Returned 400.00 and 600.00 still outstanding.
8. Click **Record payment**. Expect it to prefill 600.00, not 1,000.00. Confirm it. The row shows Paid.
9. Open Journals and find the return's `JE-…`. Expect three lines: GRNI debit, Inventory credit, and a variance line, all balancing.
10. Try another return of 7 on the same purchase. Expect a refusal — only 6 remain.
11. Return the remaining 6, then check Suppliers: Returned should total 1,000.00 and Balance due should show what the supplier now owes you.
12. Switch to French, then Arabic. Check the return dialog and the badges read correctly and Arabic stays right-to-left.
13. Close and reopen the app. Every figure is unchanged.
