-- S4-001: POS credit-sale fiscal date is authoritative in Africa/Algiers.
--
-- Keep the existing IPC signature for compatibility, but do not trust a
-- workstation-computed date for a live POS posting. Both override authorization
-- and confirmation derive the same business date inside PostgreSQL. Crossing
-- midnight between authorization and confirmation intentionally invalidates the
-- old override because it is no longer the exact same posting intent.
SET ROLE stockiha_owner;

CREATE OR REPLACE FUNCTION receivables.authorize_credit_override(
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

CREATE OR REPLACE FUNCTION sales.confirm_credit_sale(
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
$$;

RESET ROLE;
