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
        CHECK (reason_code IN ('DEFECTIVE_GOODS', 'EXCESS_DELIVERY', 'WRONG_ITEM', 'OTHER')),
    CONSTRAINT purchase_returns_refund_positive CHECK (refund_amount > 0),
    CONSTRAINT purchase_returns_inventory_non_negative CHECK (inventory_value >= 0)
);

CREATE TABLE IF NOT EXISTS procurement.purchase_return_lines (
    id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    return_document_id bigint NOT NULL REFERENCES procurement.purchase_returns (document_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
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
            catalog._effective_variant_name(variant.id) AS variant_name,
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
