-- S4-001: Secure customer master management and receivables read functions
SET ROLE stockiha_owner;

-- Runtime must not bypass permission-checked customer management functions.
REVOKE INSERT, UPDATE ON receivables.customers FROM stockiha_runtime;
GRANT SELECT ON receivables.customers TO stockiha_runtime;

CREATE FUNCTION receivables.create_customer(
    p_session_token text,
    p_code text,
    p_name text,
    p_contact_name text,
    p_phone text,
    p_email text,
    p_address text,
    p_tax_id text,
    p_credit_enabled boolean,
    p_credit_limit numeric,
    p_payment_terms_days integer,
    p_max_overdue_days integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_user_id bigint;
    v_customer_id bigint;
    v_code text := nullif(btrim(p_code), '');
    v_name text := nullif(btrim(p_name), '');
    v_credit_enabled boolean := coalesce(p_credit_enabled, false);
    v_credit_limit numeric(14, 2) := coalesce(p_credit_limit, 0);
    v_payment_terms_days integer := coalesce(p_payment_terms_days, 0);
BEGIN
    SELECT user_id INTO v_user_id
    FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_CUSTOMERS');

    IF v_code IS NULL THEN
        RAISE EXCEPTION 'customer code must not be blank' USING ERRCODE = '22023';
    END IF;
    IF v_name IS NULL THEN
        RAISE EXCEPTION 'customer name must not be blank' USING ERRCODE = '22023';
    END IF;
    IF v_credit_limit < 0 THEN
        RAISE EXCEPTION 'credit limit cannot be negative' USING ERRCODE = '22023';
    END IF;
    IF v_payment_terms_days < 0 OR (p_max_overdue_days IS NOT NULL AND p_max_overdue_days < 0) THEN
        RAISE EXCEPTION 'credit terms cannot be negative' USING ERRCODE = '22023';
    END IF;
    IF NOT v_credit_enabled AND (v_credit_limit <> 0 OR v_payment_terms_days <> 0 OR p_max_overdue_days IS NOT NULL) THEN
        RAISE EXCEPTION 'disabled credit requires zero limit, zero payment terms, and no overdue policy' USING ERRCODE = '22023';
    END IF;

    INSERT INTO receivables.customers (
        code, name, contact_name, phone, email, address, tax_id,
        credit_enabled, credit_limit, payment_terms_days, max_overdue_days
    ) VALUES (
        v_code, v_name,
        nullif(btrim(p_contact_name), ''), nullif(btrim(p_phone), ''),
        nullif(btrim(p_email), ''), nullif(btrim(p_address), ''), nullif(btrim(p_tax_id), ''),
        v_credit_enabled, v_credit_limit, v_payment_terms_days, p_max_overdue_days
    ) RETURNING id INTO v_customer_id;

    RETURN jsonb_build_object(
        'id', v_customer_id,
        'code', v_code,
        'name', v_name,
        'contact_name', nullif(btrim(p_contact_name), ''),
        'phone', nullif(btrim(p_phone), ''),
        'email', nullif(btrim(p_email), ''),
        'address', nullif(btrim(p_address), ''),
        'tax_id', nullif(btrim(p_tax_id), ''),
        'is_active', true,
        'credit_enabled', v_credit_enabled,
        'credit_limit', v_credit_limit::text,
        'payment_terms_days', v_payment_terms_days,
        'max_overdue_days', p_max_overdue_days,
        'exposure_amount', '0.00',
        'available_credit', v_credit_limit::text,
        'oldest_open_due_date', NULL,
        'created_at', now()::text
    );
END;
$$;

CREATE FUNCTION receivables.update_customer(
    p_session_token text,
    p_customer_id bigint,
    p_code text,
    p_name text,
    p_contact_name text,
    p_phone text,
    p_email text,
    p_address text,
    p_tax_id text,
    p_is_active boolean,
    p_credit_enabled boolean,
    p_credit_limit numeric,
    p_payment_terms_days integer,
    p_max_overdue_days integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_user_id bigint;
    v_code text := nullif(btrim(p_code), '');
    v_name text := nullif(btrim(p_name), '');
    v_credit_enabled boolean := coalesce(p_credit_enabled, false);
    v_credit_limit numeric(14, 2) := coalesce(p_credit_limit, 0);
    v_payment_terms_days integer := coalesce(p_payment_terms_days, 0);
    v_exposure numeric(14, 2);
    v_oldest_due date;
BEGIN
    SELECT user_id INTO v_user_id
    FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_CUSTOMERS');

    IF p_customer_id IS NULL OR p_customer_id <= 0 THEN
        RAISE EXCEPTION 'invalid customer id' USING ERRCODE = '22023';
    END IF;
    IF v_code IS NULL OR v_name IS NULL THEN
        RAISE EXCEPTION 'customer code and name must not be blank' USING ERRCODE = '22023';
    END IF;
    IF v_credit_limit < 0 OR v_payment_terms_days < 0 OR (p_max_overdue_days IS NOT NULL AND p_max_overdue_days < 0) THEN
        RAISE EXCEPTION 'invalid credit policy' USING ERRCODE = '22023';
    END IF;
    IF NOT v_credit_enabled AND (v_credit_limit <> 0 OR v_payment_terms_days <> 0 OR p_max_overdue_days IS NOT NULL) THEN
        RAISE EXCEPTION 'disabled credit requires zero limit, zero payment terms, and no overdue policy' USING ERRCODE = '22023';
    END IF;

    -- Serialize policy changes against future credit postings using the same state row.
    SELECT exposure_amount, oldest_open_due_date
    INTO v_exposure, v_oldest_due
    FROM receivables.customer_credit_state
    WHERE customer_id = p_customer_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'customer % not found', p_customer_id USING ERRCODE = '22023';
    END IF;

    UPDATE receivables.customers
    SET code = v_code,
        name = v_name,
        contact_name = nullif(btrim(p_contact_name), ''),
        phone = nullif(btrim(p_phone), ''),
        email = nullif(btrim(p_email), ''),
        address = nullif(btrim(p_address), ''),
        tax_id = nullif(btrim(p_tax_id), ''),
        is_active = coalesce(p_is_active, true),
        credit_enabled = v_credit_enabled,
        credit_limit = v_credit_limit,
        payment_terms_days = v_payment_terms_days,
        max_overdue_days = p_max_overdue_days
    WHERE id = p_customer_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'customer % not found', p_customer_id USING ERRCODE = '22023';
    END IF;

    RETURN jsonb_build_object(
        'id', p_customer_id,
        'code', v_code,
        'name', v_name,
        'contact_name', nullif(btrim(p_contact_name), ''),
        'phone', nullif(btrim(p_phone), ''),
        'email', nullif(btrim(p_email), ''),
        'address', nullif(btrim(p_address), ''),
        'tax_id', nullif(btrim(p_tax_id), ''),
        'is_active', coalesce(p_is_active, true),
        'credit_enabled', v_credit_enabled,
        'credit_limit', v_credit_limit::text,
        'payment_terms_days', v_payment_terms_days,
        'max_overdue_days', p_max_overdue_days,
        'exposure_amount', v_exposure::text,
        'available_credit', (v_credit_limit - v_exposure)::text,
        'oldest_open_due_date', v_oldest_due,
        'created_at', (SELECT created_at::text FROM receivables.customers WHERE id = p_customer_id)
    );
END;
$$;

CREATE FUNCTION receivables.list_customers(
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
    FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_CUSTOMERS');

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

CREATE FUNCTION receivables.get_customer_credit_summary(
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
    FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_CUSTOMERS');

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

CREATE FUNCTION receivables.list_customer_ledger(
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
    FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_CUSTOMERS');

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

REVOKE ALL ON FUNCTION receivables.create_customer(text, text, text, text, text, text, text, text, boolean, numeric, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION receivables.update_customer(text, bigint, text, text, text, text, text, text, text, boolean, boolean, numeric, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION receivables.list_customers(text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION receivables.get_customer_credit_summary(text, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION receivables.list_customer_ledger(text, bigint, integer) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION receivables.create_customer(text, text, text, text, text, text, text, text, boolean, numeric, integer, integer) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION receivables.update_customer(text, bigint, text, text, text, text, text, text, text, boolean, boolean, numeric, integer, integer) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION receivables.list_customers(text, boolean) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION receivables.get_customer_credit_summary(text, bigint) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION receivables.list_customer_ledger(text, bigint, integer) TO stockiha_runtime;

RESET ROLE;
