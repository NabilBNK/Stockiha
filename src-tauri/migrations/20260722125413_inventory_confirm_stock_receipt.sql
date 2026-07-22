-- Slice 1 MVP batch: the emergency/opening stock receipt posting function
-- (final-architecture.md section 1, "Valuation: Warehouse-specific WAC";
-- section 4, Slice 1: "Create Product -> Emergency Receipt -> WAC Update").
--
-- Owned by `stockiha_owner`, `SECURITY DEFINER`, fixed schema-qualified
-- `search_path`, `EXECUTE` revoked from `PUBLIC` and granted only to
-- `stockiha_runtime` (never trusts a caller-supplied actor id — the only
-- identity input is the opaque session token, resolved via
-- `iam.resolve_session_with_permission`).
--
-- Journal-entry scoping note: architecture's posting-matrix guidance
-- (section 3.A/3.B) covers supplier goods receipts matched against
-- invoices via clearing accounts — a different flow from an
-- emergency/opening receipt with no supplier invoice to clear. No
-- posting-matrix rule exists anywhere in final-architecture.md for this
-- specific operation, so this function does not invent one: it posts the
-- stock movement and WAC update only, no journal entry. Task wording
-- ("create required journal entries when architecture requires them") is
-- read as conditional — here, architecture does not require one.
SET ROLE stockiha_owner;

CREATE FUNCTION inventory.confirm_stock_receipt(
    p_session_token text,
    p_request_id uuid,
    p_payload_hash bytea,
    p_warehouse_id bigint,
    p_variant_id bigint,
    p_quantity numeric,
    p_unit_cost numeric,
    p_fiscal_period_id bigint,
    p_document_date date
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
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
$$;


REVOKE ALL ON FUNCTION inventory.confirm_stock_receipt(
    text, uuid, bytea, bigint, bigint, numeric, numeric, bigint, date
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inventory.confirm_stock_receipt(
    text, uuid, bytea, bigint, bigint, numeric, numeric, bigint, date
) TO stockiha_runtime;

RESET ROLE;
