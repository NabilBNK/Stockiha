-- S4-001 security hardening: never trust a caller-supplied hash for manager
-- override binding. Runtime-facing wrappers derive the hash from the actual
-- typed sale fields and JSONB lines inside PostgreSQL, then call the existing
-- owner-only core functions.
SET ROLE stockiha_owner;

CREATE FUNCTION receivables.credit_sale_payload_hash(
    p_customer_id bigint,
    p_warehouse_id bigint,
    p_fiscal_period_id bigint,
    p_document_date date,
    p_lines jsonb
)
RETURNS bytea
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog
AS $$
DECLARE
    v_lines jsonb;
    v_payload jsonb;
BEGIN
    IF p_customer_id IS NULL OR p_customer_id <= 0
       OR p_warehouse_id IS NULL OR p_warehouse_id <= 0
       OR p_fiscal_period_id IS NULL OR p_fiscal_period_id <= 0
       OR p_document_date IS NULL
       OR p_lines IS NULL
       OR jsonb_typeof(p_lines) <> 'array'
       OR jsonb_array_length(p_lines) = 0
    THEN
        RAISE EXCEPTION 'invalid credit sale payload for fingerprinting' USING ERRCODE = '22023';
    END IF;

    -- Keep line order (it is part of the exact sale intent), but normalize each
    -- line to the only three accepted fields and canonical numeric values.
    SELECT jsonb_agg(
        jsonb_build_object(
            'variant_id', (line ->> 'variant_id')::bigint,
            'quantity', trim_scale((line ->> 'quantity')::numeric),
            'unit_price', trim_scale((line ->> 'unit_price')::numeric)
        )
        ORDER BY ordinal
    )
    INTO v_lines
    FROM jsonb_array_elements(p_lines) WITH ORDINALITY AS rows(line, ordinal);

    v_payload := jsonb_build_object(
        'customer_id', p_customer_id,
        'warehouse_id', p_warehouse_id,
        'fiscal_period_id', p_fiscal_period_id,
        'document_date', p_document_date,
        'lines', v_lines
    );

    RETURN sha256(convert_to(v_payload::text, 'UTF8'));
EXCEPTION
    WHEN invalid_text_representation OR numeric_value_out_of_range THEN
        RAISE EXCEPTION 'invalid credit sale payload for fingerprinting' USING ERRCODE = '22023';
END;
$$;

REVOKE ALL ON FUNCTION receivables.credit_sale_payload_hash(bigint, bigint, bigint, date, jsonb) FROM PUBLIC;

-- The original hash-taking APIs stay available only to stockiha_owner as
-- private implementation functions. Runtime can no longer provide its own hash.
REVOKE EXECUTE ON FUNCTION receivables.authorize_credit_override(
    text, uuid, bigint, bytea, text, integer
) FROM stockiha_runtime;
REVOKE EXECUTE ON FUNCTION sales.confirm_credit_sale(
    text, uuid, bytea, bigint, bigint, bigint, date, jsonb, uuid
) FROM stockiha_runtime;

CREATE FUNCTION receivables.authorize_credit_override(
    p_session_token text,
    p_token_id uuid,
    p_customer_id bigint,
    p_warehouse_id bigint,
    p_fiscal_period_id bigint,
    p_document_date date,
    p_lines jsonb,
    p_reason text,
    p_ttl_minutes integer DEFAULT 15
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_payload_hash bytea;
BEGIN
    v_payload_hash := receivables.credit_sale_payload_hash(
        p_customer_id,
        p_warehouse_id,
        p_fiscal_period_id,
        p_document_date,
        p_lines
    );

    RETURN receivables.authorize_credit_override(
        p_session_token,
        p_token_id,
        p_customer_id,
        v_payload_hash,
        p_reason,
        p_ttl_minutes
    );
END;
$$;

CREATE FUNCTION sales.confirm_credit_sale(
    p_session_token text,
    p_request_id uuid,
    p_customer_id bigint,
    p_warehouse_id bigint,
    p_fiscal_period_id bigint,
    p_document_date date,
    p_lines jsonb,
    p_override_token uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_payload_hash bytea;
BEGIN
    v_payload_hash := receivables.credit_sale_payload_hash(
        p_customer_id,
        p_warehouse_id,
        p_fiscal_period_id,
        p_document_date,
        p_lines
    );

    RETURN sales.confirm_credit_sale(
        p_session_token,
        p_request_id,
        v_payload_hash,
        p_customer_id,
        p_warehouse_id,
        p_fiscal_period_id,
        p_document_date,
        p_lines,
        p_override_token
    );
END;
$$;

REVOKE ALL ON FUNCTION receivables.authorize_credit_override(
    text, uuid, bigint, bigint, bigint, date, jsonb, text, integer
) FROM PUBLIC;
REVOKE ALL ON FUNCTION sales.confirm_credit_sale(
    text, uuid, bigint, bigint, bigint, date, jsonb, uuid
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION receivables.authorize_credit_override(
    text, uuid, bigint, bigint, bigint, date, jsonb, text, integer
) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION sales.confirm_credit_sale(
    text, uuid, bigint, bigint, bigint, date, jsonb, uuid
) TO stockiha_runtime;

RESET ROLE;
