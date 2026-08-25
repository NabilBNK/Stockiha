-- WS-B-1 Gate 3b (2 of 4): dual-write account_id in
-- inventory.confirm_stock_adjustment. Confirmed clean in this task's
-- pre-check: INVENTORY_MERCHANDISE, INVENTORY_ADJUSTMENT_GAIN, and
-- INVENTORY_ADJUSTMENT_LOSS all already resolve via
-- finance.resolve_account_id(). Only the two journal-line INSERTs change.
SET ROLE stockiha_owner;

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
$function$;

RESET ROLE;
