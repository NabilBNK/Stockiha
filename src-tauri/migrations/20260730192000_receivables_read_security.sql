-- S4-001: Enforce per-user customer read permission at the database boundary.
SET ROLE stockiha_owner;

-- Runtime application role must not bypass application-user permissions with
-- direct table reads. All receivables reads flow through SECURITY DEFINER APIs.
REVOKE SELECT ON receivables.customers FROM stockiha_runtime;
REVOKE SELECT ON receivables.customer_credit_state FROM stockiha_runtime;
REVOKE SELECT ON receivables.customer_ledger_entries FROM stockiha_runtime;
REVOKE SELECT ON receivables.credit_override_tokens FROM stockiha_runtime;

CREATE OR REPLACE FUNCTION receivables.list_customers(
    p_session_token text,
    p_include_inactive boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_user_id bigint;
    v_result jsonb;
BEGIN
    SELECT user_id INTO v_user_id
    FROM iam.resolve_session_with_permission(p_session_token, 'VIEW_CUSTOMERS');

    SELECT coalesce(jsonb_agg(
        jsonb_build_object(
            'id', c.id,
            'code', c.code,
            'name', c.name,
            'contact_name', c.contact_name,
            'phone', c.phone,
            'email', c.email,
            'address', c.address,
            'tax_id', c.tax_id,
            'is_active', c.is_active,
            'credit_enabled', c.credit_enabled,
            'credit_limit', c.credit_limit::text,
            'payment_terms_days', c.payment_terms_days,
            'max_overdue_days', c.max_overdue_days,
            'exposure_amount', cs.exposure_amount::text,
            'available_credit', (c.credit_limit - cs.exposure_amount)::text,
            'oldest_open_due_date', cs.oldest_open_due_date,
            'created_at', c.created_at::text
        ) ORDER BY c.name, c.code
    ), '[]'::jsonb)
    INTO v_result
    FROM receivables.customers c
    JOIN receivables.customer_credit_state cs ON cs.customer_id = c.id
    WHERE coalesce(p_include_inactive, false) OR c.is_active;

    RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION receivables.get_customer_credit_summary(
    p_session_token text,
    p_customer_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_user_id bigint;
    v_result jsonb;
BEGIN
    SELECT user_id INTO v_user_id
    FROM iam.resolve_session_with_permission(p_session_token, 'VIEW_CUSTOMERS');

    SELECT jsonb_build_object(
        'customer_id', c.id,
        'customer_code', c.code,
        'customer_name', c.name,
        'is_active', c.is_active,
        'credit_enabled', c.credit_enabled,
        'credit_limit', c.credit_limit::text,
        'exposure_amount', cs.exposure_amount::text,
        'available_credit', (c.credit_limit - cs.exposure_amount)::text,
        'payment_terms_days', c.payment_terms_days,
        'max_overdue_days', c.max_overdue_days,
        'oldest_open_due_date', cs.oldest_open_due_date,
        'overdue_blocked', CASE
            WHEN cs.oldest_open_due_date IS NULL OR c.max_overdue_days IS NULL THEN false
            ELSE cs.oldest_open_due_date + c.max_overdue_days < CURRENT_DATE
        END,
        'last_rebuilt_at', cs.last_rebuilt_at::text
    ) INTO v_result
    FROM receivables.customers c
    JOIN receivables.customer_credit_state cs ON cs.customer_id = c.id
    WHERE c.id = p_customer_id;

    IF v_result IS NULL THEN
        RAISE EXCEPTION 'customer % not found', p_customer_id USING ERRCODE = '22023';
    END IF;

    RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION receivables.list_customer_ledger(
    p_session_token text,
    p_customer_id bigint,
    p_limit integer DEFAULT 100
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_user_id bigint;
    v_limit integer := coalesce(p_limit, 100);
    v_result jsonb;
BEGIN
    SELECT user_id INTO v_user_id
    FROM iam.resolve_session_with_permission(p_session_token, 'VIEW_CUSTOMERS');

    IF v_limit < 1 OR v_limit > 500 THEN
        RAISE EXCEPTION 'ledger limit must be between 1 and 500' USING ERRCODE = '22023';
    END IF;

    PERFORM 1 FROM receivables.customers WHERE id = p_customer_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'customer % not found', p_customer_id USING ERRCODE = '22023';
    END IF;

    SELECT coalesce(jsonb_agg(row_data ORDER BY created_at DESC, id DESC), '[]'::jsonb)
    INTO v_result
    FROM (
        SELECT
            l.id,
            l.created_at,
            jsonb_build_object(
                'id', l.id,
                'customer_id', l.customer_id,
                'entry_type', l.entry_type,
                'amount_delta', l.amount_delta::text,
                'document_id', l.document_id,
                'related_entry_id', l.related_entry_id,
                'due_date', l.due_date,
                'posted_by_user_id', l.posted_by_user_id,
                'workstation_id', l.workstation_id,
                'created_at', l.created_at::text
            ) AS row_data
        FROM receivables.customer_ledger_entries l
        WHERE l.customer_id = p_customer_id
        ORDER BY l.created_at DESC, l.id DESC
        LIMIT v_limit
    ) ledger_rows;

    RETURN v_result;
END;
$$;

-- PUBLIC remains denied from the original function migration; explicitly keep
-- runtime execution on the permission-checked read APIs.
GRANT EXECUTE ON FUNCTION receivables.list_customers(text, boolean) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION receivables.get_customer_credit_summary(text, bigint) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION receivables.list_customer_ledger(text, bigint, integer) TO stockiha_runtime;

RESET ROLE;
