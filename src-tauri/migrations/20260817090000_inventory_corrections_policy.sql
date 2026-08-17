-- Part 02: administrator-controlled inventory-corrections policy.
--
-- This gate changes neither correction valuation nor the immutable posting
-- contract.  It prevents new postings while preserving all prior evidence.
SET ROLE stockiha_owner;

DO $$
DECLARE
    v_existing_check text;
BEGIN
    SELECT pg_get_expr(c.conbin, c.conrelid)
    INTO v_existing_check
    FROM pg_constraint c
    WHERE c.conrelid = 'iam.permissions'::regclass
      AND c.conname = 'permissions_code_valid'
      AND c.contype = 'c';

    IF v_existing_check IS NULL THEN
        RAISE EXCEPTION 'expected iam.permissions constraint permissions_code_valid is missing';
    END IF;

    ALTER TABLE iam.permissions DROP CONSTRAINT permissions_code_valid;
    EXECUTE format(
        'ALTER TABLE iam.permissions ADD CONSTRAINT permissions_code_valid CHECK ((%s) OR code = %L)',
        v_existing_check,
        'MANAGE_INVENTORY_CORRECTIONS_POLICY'
    );
END;
$$;

INSERT INTO iam.permissions (code, name)
VALUES (
    'MANAGE_INVENTORY_CORRECTIONS_POLICY',
    'Enable or disable inventory corrections'
)
ON CONFLICT (code) DO NOTHING;

INSERT INTO iam.role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM iam.roles role
CROSS JOIN iam.permissions permission
WHERE role.code = 'ADMIN'
  AND permission.code = 'MANAGE_INVENTORY_CORRECTIONS_POLICY'
ON CONFLICT DO NOTHING;

ALTER TABLE onboarding.feature_settings
    ADD COLUMN inventory_corrections_enabled boolean NOT NULL DEFAULT true;

CREATE TABLE onboarding.inventory_corrections_setting_audit (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    previous_value boolean NOT NULL,
    new_value      boolean NOT NULL,
    actor_id       bigint NOT NULL REFERENCES iam.users(id) ON DELETE RESTRICT,
    workstation_id text NOT NULL,
    occurred_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT inventory_corrections_setting_audit_workstation_not_blank
        CHECK (btrim(workstation_id) <> '')
);

CREATE INDEX inventory_corrections_setting_audit_occurred_at_idx
    ON onboarding.inventory_corrections_setting_audit (occurred_at DESC);

CREATE FUNCTION onboarding.get_inventory_corrections_setting(
    p_session_token text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_enabled boolean;
    v_user_id bigint;
BEGIN
    SELECT user_id INTO v_user_id
    FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_INVENTORY');

    SELECT inventory_corrections_enabled
    INTO v_enabled
    FROM onboarding.feature_settings
    WHERE singleton;

    RETURN jsonb_build_object(
        'enabled', v_enabled,
        'canUpdate', EXISTS (
            SELECT 1
            FROM iam.user_roles user_role
            JOIN iam.role_permissions role_permission
              ON role_permission.role_id = user_role.role_id
            JOIN iam.permissions permission
              ON permission.id = role_permission.permission_id
            WHERE user_role.user_id = v_user_id
              AND permission.code = 'MANAGE_INVENTORY_CORRECTIONS_POLICY'
        )
    );
END;
$$;

CREATE FUNCTION onboarding.update_inventory_corrections_setting(
    p_session_token text,
    p_enabled boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_actor_id bigint;
    v_workstation_id text;
    v_previous boolean;
BEGIN
    SELECT user_id, workstation_id
    INTO v_actor_id, v_workstation_id
    FROM iam.resolve_session_with_permission(
        p_session_token,
        'MANAGE_INVENTORY_CORRECTIONS_POLICY'
    );

    SELECT inventory_corrections_enabled
    INTO v_previous
    FROM onboarding.feature_settings
    WHERE singleton
    FOR UPDATE;

    UPDATE onboarding.feature_settings
    SET inventory_corrections_enabled = p_enabled,
        updated_by = v_actor_id,
        updated_at = now()
    WHERE singleton;

    IF v_previous IS DISTINCT FROM p_enabled THEN
        INSERT INTO onboarding.inventory_corrections_setting_audit (
            previous_value,
            new_value,
            actor_id,
            workstation_id
        ) VALUES (
            v_previous,
            p_enabled,
            v_actor_id,
            v_workstation_id
        );
    END IF;

    RETURN jsonb_build_object('enabled', p_enabled, 'canUpdate', true);
END;
$$;

CREATE OR REPLACE FUNCTION inventory.confirm_stock_adjustment(
    p_session_token text, p_request_id uuid, p_payload_hash bytea,
    p_warehouse_id bigint, p_variant_id bigint, p_unit_id bigint,
    p_quantity_delta numeric, p_reason_code text, p_note text,
    p_fiscal_period_id bigint, p_document_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
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
            INSERT INTO finance.journal_lines (document_id, line_number, account_code, debit, credit, description) VALUES
                (v_journal_document_id, 1, 'INVENTORY_MERCHANDISE', v_journal_amount, 0, 'Stock adjustment gain'),
                (v_journal_document_id, 2, 'INVENTORY_ADJUSTMENT_GAIN', 0, v_journal_amount, 'Stock adjustment gain');
        ELSE
            INSERT INTO finance.journal_lines (document_id, line_number, account_code, debit, credit, description) VALUES
                (v_journal_document_id, 1, 'INVENTORY_ADJUSTMENT_LOSS', v_journal_amount, 0, 'Stock adjustment loss'),
                (v_journal_document_id, 2, 'INVENTORY_MERCHANDISE', 0, v_journal_amount, 'Stock adjustment loss');
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
$$;

REVOKE ALL ON onboarding.inventory_corrections_setting_audit FROM PUBLIC;
REVOKE ALL ON onboarding.inventory_corrections_setting_audit FROM stockiha_runtime;
REVOKE ALL ON FUNCTION onboarding.get_inventory_corrections_setting(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION onboarding.update_inventory_corrections_setting(text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION inventory.confirm_stock_adjustment(
    text, uuid, bytea, bigint, bigint, bigint, numeric, text, text, bigint, date
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION onboarding.get_inventory_corrections_setting(text) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION onboarding.update_inventory_corrections_setting(text, boolean) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION inventory.confirm_stock_adjustment(
    text, uuid, bytea, bigint, bigint, bigint, numeric, text, text, bigint, date
) TO stockiha_runtime;
GRANT SELECT ON onboarding.inventory_corrections_setting_audit TO stockiha_backup;
GRANT SELECT ON SEQUENCE onboarding.inventory_corrections_setting_audit_id_seq TO stockiha_backup;

UPDATE operations.schema_state
SET migration_version = 20260817090000,
    updated_at = now()
WHERE singleton;

RESET ROLE;
