-- S2-002: atomic stock-adjustment posting.
--
-- The signed quantity_delta is the sole quantity contract. The caller may
-- identify the variant's base unit or one configured alternate unit; the
-- posting function converts the signed input exactly to base units before any
-- stock, valuation, movement, document, or journal write.
SET ROLE stockiha_owner;

-- Extend the fixed permission vocabulary and assign inventory management only
-- to trusted management roles. CASHIER remains unchanged.
ALTER TABLE iam.permissions DROP CONSTRAINT permissions_code_valid;
ALTER TABLE iam.permissions ADD CONSTRAINT permissions_code_valid CHECK (
    code IN (
        'POST_STOCK_RECEIPT',
        'POST_CASH_SALE',
        'OPEN_CASH_SESSION',
        'CLOSE_CASH_SESSION',
        'MANAGE_CATALOG',
        'MANAGE_WAREHOUSES',
        'MANAGE_INVENTORY'
    )
);

INSERT INTO iam.permissions (code, name)
    VALUES ('MANAGE_INVENTORY', 'Confirm stock adjustments');

INSERT INTO iam.role_permissions (role_id, permission_id)
    SELECT r.id, p.id
    FROM iam.roles r, iam.permissions p
    WHERE r.code IN ('MANAGER', 'ADMIN')
      AND p.code = 'MANAGE_INVENTORY';

-- STOCK_ADJUSTMENT participates in the same transactional, annual numbering
-- mechanism as every other confirmed business document.
ALTER TABLE core.document_sequences DROP CONSTRAINT document_sequences_type_valid;
ALTER TABLE core.document_sequences ADD CONSTRAINT document_sequences_type_valid
    CHECK (document_type IN ('CASH_SALE', 'JOURNAL_ENTRY', 'STOCK_RECEIPT', 'STOCK_ADJUSTMENT'));

ALTER TABLE core.business_documents DROP CONSTRAINT business_documents_type_valid;
ALTER TABLE core.business_documents ADD CONSTRAINT business_documents_type_valid
    CHECK (document_type IN ('CASH_SALE', 'JOURNAL_ENTRY', 'STOCK_RECEIPT', 'STOCK_ADJUSTMENT'));

-- Immutable confirmed adjustment snapshot. Quantities and values are stored in
-- exact decimal columns; quantity_delta is always in the variant's base unit.
CREATE TABLE inventory.stock_adjustments (
    document_id              bigint PRIMARY KEY REFERENCES core.business_documents (id),
    warehouse_id             bigint NOT NULL REFERENCES inventory.warehouses (id),
    variant_id               bigint NOT NULL REFERENCES catalog.product_variants (id),
    input_unit_id             bigint NOT NULL REFERENCES catalog.units (id),
    input_quantity_delta      numeric(18, 3) NOT NULL,
    conversion_factor        numeric(20, 6) NOT NULL,
    quantity_delta            numeric(18, 3) NOT NULL,
    wac_snapshot              numeric(18, 6) NOT NULL,
    inventory_value_delta     numeric(18, 4) NOT NULL,
    reason_code               text NOT NULL,
    note                      text,
    movement_id               bigint NOT NULL UNIQUE REFERENCES inventory.movements (id),
    journal_document_id       bigint UNIQUE REFERENCES finance.journal_entries (document_id),
    posted_by_user_id         bigint NOT NULL REFERENCES iam.users (id),
    workstation_id            text NOT NULL,
    created_at                timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT stock_adjustments_input_delta_nonzero CHECK (input_quantity_delta <> 0),
    CONSTRAINT stock_adjustments_base_delta_nonzero CHECK (quantity_delta <> 0),
    CONSTRAINT stock_adjustments_factor_positive CHECK (conversion_factor > 0),
    CONSTRAINT stock_adjustments_wac_non_negative CHECK (wac_snapshot >= 0),
    CONSTRAINT stock_adjustments_direction_matches CHECK (
        (input_quantity_delta > 0 AND quantity_delta > 0 AND inventory_value_delta >= 0)
        OR (input_quantity_delta < 0 AND quantity_delta < 0 AND inventory_value_delta <= 0)
    ),
    CONSTRAINT stock_adjustments_reason_valid CHECK (
        reason_code IN ('DAMAGE', 'SHRINKAGE', 'EXPIRED', 'FOUND_STOCK', 'RECORDING_ERROR', 'OTHER')
    ),
    CONSTRAINT stock_adjustments_other_note_required CHECK (
        reason_code <> 'OTHER' OR btrim(coalesce(note, '')) <> ''
    ),
    CONSTRAINT stock_adjustments_note_normalized CHECK (note IS NULL OR note = btrim(note)),
    CONSTRAINT stock_adjustments_workstation_not_blank CHECK (btrim(workstation_id) <> '')
);

CREATE FUNCTION inventory.forbid_stock_adjustment_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'confirmed stock adjustments are immutable'
        USING ERRCODE = '0A000';
END;
$$;

CREATE TRIGGER stock_adjustments_forbid_update
    BEFORE UPDATE ON inventory.stock_adjustments
    FOR EACH ROW EXECUTE FUNCTION inventory.forbid_stock_adjustment_mutation();
CREATE TRIGGER stock_adjustments_forbid_delete
    BEFORE DELETE ON inventory.stock_adjustments
    FOR EACH ROW EXECUTE FUNCTION inventory.forbid_stock_adjustment_mutation();

-- Read model for the adjustment form: one base unit (factor 1) plus the exact
-- configured alternate units for the selected variant. This does not expose or
-- calculate stock authority in React.
CREATE FUNCTION inventory.list_stock_adjustment_units(
    p_session_token text,
    p_variant_id bigint
)
RETURNS TABLE (
    unit_id bigint,
    unit_code text,
    unit_name text,
    conversion_factor numeric,
    is_base boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
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
$$;

-- Owner-only helper used for both a fresh posting and an idempotent retry.
CREATE FUNCTION inventory._stock_adjustment_response(p_document_id bigint)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = pg_catalog
AS $$
    SELECT jsonb_build_object(
        'document_id', a.document_id,
        'document_number', d.document_number,
        'movement_id', a.movement_id,
        'journal_document_id', a.journal_document_id,
        'journal_document_number', jd.document_number,
        'warehouse_id', a.warehouse_id,
        'variant_id', a.variant_id,
        'quantity_delta', a.quantity_delta::text,
        'inventory_value_delta', a.inventory_value_delta::text,
        'resulting_quantity_on_hand', m.resulting_quantity_on_hand::text,
        'resulting_total_value', m.resulting_total_value::text,
        'reason_code', a.reason_code
    )
    FROM inventory.stock_adjustments a
    JOIN core.business_documents d ON d.id = a.document_id
    JOIN inventory.movements m ON m.id = a.movement_id
    LEFT JOIN core.business_documents jd ON jd.id = a.journal_document_id
    WHERE a.document_id = p_document_id
$$;

CREATE FUNCTION inventory.confirm_stock_adjustment(
    p_session_token text,
    p_request_id uuid,
    p_payload_hash bytea,
    p_warehouse_id bigint,
    p_variant_id bigint,
    p_unit_id bigint,
    p_quantity_delta numeric,
    p_reason_code text,
    p_note text,
    p_fiscal_period_id bigint,
    p_document_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_user_id bigint;
    v_workstation_id text;
    v_cached_result bigint;
    v_period_status text;
    v_period_start date;
    v_period_end date;
    v_fiscal_year integer;
    v_base_unit_id bigint;
    v_conversion_factor numeric(20, 6);
    v_base_delta numeric(18, 3);
    v_note text;
    v_old_quantity numeric(18, 3);
    v_old_value numeric(18, 4);
    v_wac numeric(18, 6);
    v_value_delta numeric(18, 4);
    v_new_quantity numeric(18, 3);
    v_new_value numeric(18, 4);
    v_journal_amount numeric(14, 2);
    v_document_id bigint;
    v_journal_document_id bigint;
    v_movement_id bigint;
    v_sequence bigint;
    v_document_number text;
BEGIN
    -- Resolve the actor from the opaque session token; never trust a caller id.
    SELECT user_id, workstation_id INTO v_user_id, v_workstation_id
    FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_INVENTORY');

    v_note := nullif(btrim(coalesce(p_note, '')), '');

    -- Reserve before business work so concurrent duplicate requests serialize.
    v_cached_result := core.reserve_idempotent_request(
        'inventory.confirm_stock_adjustment', p_request_id, p_payload_hash
    );
    IF v_cached_result IS NOT NULL THEN
        RETURN inventory._stock_adjustment_response(v_cached_result);
    END IF;

    IF p_quantity_delta IS NULL OR p_quantity_delta = 0 THEN
        RAISE EXCEPTION 'stock adjustment quantity delta must not be zero'
            USING ERRCODE = '22023';
    END IF;
    IF p_quantity_delta <> round(p_quantity_delta, 3) THEN
        RAISE EXCEPTION 'stock adjustment quantity supports at most three decimal places'
            USING ERRCODE = '22023';
    END IF;
    IF p_reason_code IS NULL OR p_reason_code NOT IN ('DAMAGE', 'SHRINKAGE', 'EXPIRED', 'FOUND_STOCK', 'RECORDING_ERROR', 'OTHER') THEN
        RAISE EXCEPTION 'invalid stock adjustment reason code'
            USING ERRCODE = '22023';
    END IF;
    IF p_reason_code = 'OTHER' AND v_note IS NULL THEN
        RAISE EXCEPTION 'OTHER stock adjustment reason requires a note'
            USING ERRCODE = '22023';
    END IF;

    SELECT status, starts_on, ends_on, extract(year FROM starts_on)::integer
    INTO v_period_status, v_period_start, v_period_end, v_fiscal_year
    FROM finance.fiscal_periods
    WHERE id = p_fiscal_period_id
    FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'fiscal period % not found', p_fiscal_period_id
            USING ERRCODE = '22023';
    END IF;
    IF v_period_status <> 'OPEN' THEN
        RAISE EXCEPTION 'fiscal period % is not open', p_fiscal_period_id
            USING ERRCODE = '55000';
    END IF;
    IF p_document_date < v_period_start OR p_document_date > v_period_end THEN
        RAISE EXCEPTION 'document date is outside the fiscal period'
            USING ERRCODE = '22023';
    END IF;

    PERFORM 1 FROM inventory.warehouses
    WHERE id = p_warehouse_id AND is_active
    FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'warehouse % is not found or is inactive', p_warehouse_id
            USING ERRCODE = '22023';
    END IF;

    SELECT pv.base_unit_id INTO v_base_unit_id
    FROM catalog.product_variants pv
    JOIN catalog.products p ON p.id = pv.product_id
    WHERE pv.id = p_variant_id AND pv.is_active AND p.is_active
    FOR SHARE OF pv, p;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'variant % is not found or is inactive', p_variant_id
            USING ERRCODE = '22023';
    END IF;

    IF p_unit_id = v_base_unit_id THEN
        v_conversion_factor := 1;
    ELSE
        SELECT vu.conversion_factor INTO v_conversion_factor
        FROM catalog.variant_units vu
        WHERE vu.variant_id = p_variant_id AND vu.unit_id = p_unit_id
        FOR SHARE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'unit % is not valid for variant %', p_unit_id, p_variant_id
                USING ERRCODE = '22023';
        END IF;
    END IF;

    IF p_quantity_delta * v_conversion_factor <> round(p_quantity_delta * v_conversion_factor, 3) THEN
        RAISE EXCEPTION 'stock adjustment does not convert exactly to base-unit precision'
            USING ERRCODE = '22023';
    END IF;
    v_base_delta := p_quantity_delta * v_conversion_factor;
    IF v_base_delta = 0 THEN
        RAISE EXCEPTION 'stock adjustment converts to a zero base-unit delta'
            USING ERRCODE = '22023';
    END IF;

    INSERT INTO inventory.positions (warehouse_id, variant_id)
    VALUES (p_warehouse_id, p_variant_id)
    ON CONFLICT (warehouse_id, variant_id) DO NOTHING;

    SELECT quantity_on_hand, total_value, last_known_wac
    INTO v_old_quantity, v_old_value, v_wac
    FROM inventory.positions
    WHERE warehouse_id = p_warehouse_id AND variant_id = p_variant_id
    FOR UPDATE;

    IF v_base_delta < 0 AND v_old_quantity < abs(v_base_delta) THEN
        RAISE EXCEPTION 'insufficient stock for stock adjustment'
            USING ERRCODE = '55000';
    END IF;

    IF v_base_delta > 0 AND v_old_quantity = 0 AND v_wac <= 0 THEN
        RAISE EXCEPTION 'positive adjustment at zero stock has no usable WAC'
            USING ERRCODE = 'P2002';
    END IF;

    v_value_delta := round(v_base_delta * v_wac, 4);
    v_new_quantity := v_old_quantity + v_base_delta;
    v_new_value := v_old_value + v_value_delta;

    IF v_new_quantity < 0 THEN
        RAISE EXCEPTION 'stock adjustment would make confirmed stock negative'
            USING ERRCODE = '55000';
    END IF;
    IF v_new_quantity = 0 THEN
        v_new_value := 0;
    ELSIF v_new_value < 0 THEN
        RAISE EXCEPTION 'stock adjustment would make inventory value negative'
            USING ERRCODE = '55000';
    END IF;

    INSERT INTO core.business_documents (
        document_type, document_date, fiscal_period_id, fiscal_year
    ) VALUES (
        'STOCK_ADJUSTMENT', p_document_date, p_fiscal_period_id, v_fiscal_year
    ) RETURNING id INTO v_document_id;

    UPDATE inventory.positions
    SET quantity_on_hand = v_new_quantity,
        total_value = v_new_value
    WHERE warehouse_id = p_warehouse_id AND variant_id = p_variant_id;

    INSERT INTO inventory.movements (
        warehouse_id, variant_id, movement_type, quantity_delta,
        inventory_value_delta, resulting_quantity_on_hand,
        resulting_total_value, reference_type, reference_id
    ) VALUES (
        p_warehouse_id, p_variant_id, 'ADJUSTMENT', v_base_delta,
        v_value_delta, v_new_quantity, v_new_value,
        'STOCK_ADJUSTMENT', v_document_id
    ) RETURNING id INTO v_movement_id;

    -- Money journals use the repository's existing two-decimal finance model.
    -- A zero-valued adjustment has no financial effect and therefore no journal.
    v_journal_amount := round(abs(v_value_delta), 2);
    IF v_journal_amount > 0 THEN
        INSERT INTO core.business_documents (
            document_type, document_date, fiscal_period_id, fiscal_year
        ) VALUES (
            'JOURNAL_ENTRY', p_document_date, p_fiscal_period_id, v_fiscal_year
        ) RETURNING id INTO v_journal_document_id;

        INSERT INTO finance.journal_entries (
            document_id, description, source_type, source_id
        ) VALUES (
            v_journal_document_id, 'Stock adjustment', 'STOCK_ADJUSTMENT', v_document_id
        );

        IF v_base_delta > 0 THEN
            INSERT INTO finance.journal_lines (
                document_id, line_number, account_code, debit, credit, description
            ) VALUES
                (v_journal_document_id, 1, 'INVENTORY_MERCHANDISE', v_journal_amount, 0, 'Stock adjustment gain'),
                (v_journal_document_id, 2, 'INVENTORY_ADJUSTMENT_GAIN', 0, v_journal_amount, 'Stock adjustment gain');
        ELSE
            INSERT INTO finance.journal_lines (
                document_id, line_number, account_code, debit, credit, description
            ) VALUES
                (v_journal_document_id, 1, 'INVENTORY_ADJUSTMENT_LOSS', v_journal_amount, 0, 'Stock adjustment loss'),
                (v_journal_document_id, 2, 'INVENTORY_MERCHANDISE', 0, v_journal_amount, 'Stock adjustment loss');
        END IF;
    END IF;

    INSERT INTO inventory.stock_adjustments (
        document_id, warehouse_id, variant_id, input_unit_id,
        input_quantity_delta, conversion_factor, quantity_delta, wac_snapshot,
        inventory_value_delta, reason_code, note, movement_id,
        journal_document_id, posted_by_user_id, workstation_id
    ) VALUES (
        v_document_id, p_warehouse_id, p_variant_id, p_unit_id,
        p_quantity_delta, v_conversion_factor, v_base_delta, v_wac,
        v_value_delta, p_reason_code, v_note, v_movement_id,
        v_journal_document_id, v_user_id, v_workstation_id
    );

    v_sequence := core.claim_next_document_number('STOCK_ADJUSTMENT', v_fiscal_year);
    v_document_number := 'SA-' || v_fiscal_year || '-' || lpad(v_sequence::text, 6, '0');
    UPDATE core.business_documents
    SET status = 'POSTED', sequence_number = v_sequence,
        document_number = v_document_number, posted_at = now()
    WHERE id = v_document_id;

    IF v_journal_document_id IS NOT NULL THEN
        v_sequence := core.claim_next_document_number('JOURNAL_ENTRY', v_fiscal_year);
        v_document_number := 'JE-' || v_fiscal_year || '-' || lpad(v_sequence::text, 6, '0');
        UPDATE core.business_documents
        SET status = 'POSTED', sequence_number = v_sequence,
            document_number = v_document_number, posted_at = now()
        WHERE id = v_journal_document_id;
    END IF;

    PERFORM core.record_idempotent_result(
        'inventory.confirm_stock_adjustment', p_request_id, v_document_id
    );

    RETURN inventory._stock_adjustment_response(v_document_id);
END;
$$;

REVOKE ALL ON inventory.stock_adjustments FROM PUBLIC;
REVOKE ALL ON FUNCTION inventory.forbid_stock_adjustment_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION inventory._stock_adjustment_response(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION inventory.list_stock_adjustment_units(text, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION inventory.confirm_stock_adjustment(
    text, uuid, bytea, bigint, bigint, bigint, numeric, text, text, bigint, date
) FROM PUBLIC;

GRANT SELECT ON inventory.stock_adjustments TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION inventory.list_stock_adjustment_units(text, bigint) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION inventory.confirm_stock_adjustment(
    text, uuid, bytea, bigint, bigint, bigint, numeric, text, text, bigint, date
) TO stockiha_runtime;

RESET ROLE;
