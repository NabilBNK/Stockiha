-- Direct-purchase UX contract: resolve the configured default warehouse on the
-- server and retain each entered additional-cost item while delegating the
-- authoritative inventory allocation to the existing landed-cost posting.
SET ROLE stockiha_owner;

CREATE TABLE procurement.purchase_receipt_additional_costs (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    receipt_document_id bigint NOT NULL REFERENCES procurement.purchase_receipts(document_id),
    line_number integer NOT NULL,
    cost_type text NOT NULL CHECK (btrim(cost_type) <> ''),
    description text NULL,
    amount numeric(14, 2) NOT NULL CHECK (amount > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (receipt_document_id, line_number)
);

CREATE OR REPLACE FUNCTION procurement.confirm_direct_purchase_with_costs(
    p_session_token text,
    p_request_id uuid,
    p_payload_hash bytea,
    p_supplier_id bigint,
    p_fiscal_period_id bigint,
    p_document_date date,
    p_note text,
    p_lines jsonb,
    p_additional_costs jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_default_warehouse_id bigint;
    v_existing_document_id bigint;
    v_receipt jsonb;
    v_total_additional_cost numeric(14, 2) := 0;
    v_cost jsonb;
    v_cost_line_number integer := 0;
    v_inner_request_id uuid := gen_random_uuid();
    v_inner_hash bytea;
BEGIN
    PERFORM iam.resolve_session_with_permission(p_session_token, 'POST_PURCHASE_RECEIPT');
    v_existing_document_id := core.reserve_idempotent_request(
        'procurement.confirm_direct_purchase_with_costs', p_request_id, p_payload_hash
    );
    IF v_existing_document_id IS NOT NULL THEN
        RETURN inventory._purchase_receipt_response(v_existing_document_id);
    END IF;

    SELECT default_warehouse_id
    INTO v_default_warehouse_id
    FROM core.system_state
    WHERE id = 1;
    IF v_default_warehouse_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM inventory.warehouses
        WHERE id = v_default_warehouse_id AND is_active
    ) THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: an active default warehouse must be configured before confirming a purchase'
            USING ERRCODE = '55000';
    END IF;

    IF p_additional_costs IS NULL OR jsonb_typeof(p_additional_costs) <> 'array' THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: additional costs must be an array' USING ERRCODE = '22023';
    END IF;
    FOR v_cost IN SELECT * FROM jsonb_array_elements(p_additional_costs)
    LOOP
        v_cost_line_number := v_cost_line_number + 1;
        IF btrim(coalesce(v_cost->>'cost_type', '')) = '' THEN
            RAISE EXCEPTION 'VALIDATION_ERROR: additional cost % needs a type', v_cost_line_number USING ERRCODE = '22023';
        END IF;
        IF (v_cost->>'amount') !~ '^[0-9]+(\\.[0-9]{1,2})?$' OR (v_cost->>'amount')::numeric <= 0 THEN
            RAISE EXCEPTION 'VALIDATION_ERROR: additional cost % must have a positive two-decimal amount', v_cost_line_number USING ERRCODE = '22023';
        END IF;
        v_total_additional_cost := v_total_additional_cost + (v_cost->>'amount')::numeric(14, 2);
    END LOOP;

    v_inner_hash := sha256(convert_to(jsonb_build_object(
        'supplier_id', p_supplier_id, 'warehouse_id', v_default_warehouse_id,
        'fiscal_period_id', p_fiscal_period_id, 'document_date', p_document_date,
        'note', p_note, 'lines', p_lines
    )::text, 'UTF8'));
    v_receipt := inventory.confirm_direct_purchase(
        p_session_token, v_inner_request_id, v_inner_hash, p_supplier_id,
        v_default_warehouse_id, p_fiscal_period_id, p_document_date, p_note, p_lines
    );

    IF v_total_additional_cost > 0 THEN
        PERFORM iam.resolve_session_with_permission(p_session_token, 'POST_SUPPLIER_INVOICE');
        PERFORM inventory.allocate_landed_cost(
            p_session_token, gen_random_uuid(), sha256(convert_to(jsonb_build_object(
                'receipt_id', (v_receipt->>'document_id')::bigint,
                'amount', v_total_additional_cost, 'allocation_method', 'BY_VALUE',
                'fiscal_period_id', p_fiscal_period_id, 'document_date', p_document_date
            )::text, 'UTF8')),
            (v_receipt->>'document_id')::bigint, v_total_additional_cost, 'BY_VALUE',
            p_fiscal_period_id, p_document_date, p_note
        );

        v_cost_line_number := 0;
        FOR v_cost IN SELECT * FROM jsonb_array_elements(p_additional_costs)
        LOOP
            v_cost_line_number := v_cost_line_number + 1;
            INSERT INTO procurement.purchase_receipt_additional_costs (
                receipt_document_id, line_number, cost_type, description, amount
            ) VALUES (
                (v_receipt->>'document_id')::bigint, v_cost_line_number,
                btrim(v_cost->>'cost_type'), nullif(btrim(coalesce(v_cost->>'description', '')), ''),
                (v_cost->>'amount')::numeric(14, 2)
            );
        END LOOP;
    END IF;

    PERFORM core.store_idempotent_result(
        'procurement.confirm_direct_purchase_with_costs', p_request_id, (v_receipt->>'document_id')::bigint
    );
    RETURN v_receipt;
END;
$$;

REVOKE ALL ON TABLE procurement.purchase_receipt_additional_costs FROM PUBLIC;
REVOKE ALL ON FUNCTION procurement.confirm_direct_purchase_with_costs(text, uuid, bytea, bigint, bigint, date, text, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION procurement.confirm_direct_purchase_with_costs(text, uuid, bytea, bigint, bigint, date, text, jsonb, jsonb) TO stockiha_runtime;

RESET ROLE;
