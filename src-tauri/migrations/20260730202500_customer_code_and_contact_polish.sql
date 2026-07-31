-- S4-001 UX hardening: database-authoritative customer codes and one canonical contact value.
-- Existing customer codes remain unchanged. New customer codes are generated under the
-- database authority boundary so concurrent terminals cannot race on a frontend-derived value.
SET ROLE stockiha_owner;

CREATE SEQUENCE receivables.customer_code_seq AS bigint START WITH 1 INCREMENT BY 1;

-- Continue after any already-existing CUS-NNNNNN values without rewriting historical codes.
DO $$
DECLARE
    v_max_suffix bigint;
BEGIN
    SELECT coalesce(max(substring(code FROM '^CUS-([0-9]+)$')::bigint), 0)
    INTO v_max_suffix
    FROM receivables.customers
    WHERE code ~ '^CUS-[0-9]+$';

    IF v_max_suffix > 0 THEN
        PERFORM setval('receivables.customer_code_seq', v_max_suffix, true);
    END IF;
END;
$$;

REVOKE ALL ON SEQUENCE receivables.customer_code_seq FROM PUBLIC;
REVOKE ALL ON SEQUENCE receivables.customer_code_seq FROM stockiha_runtime;

CREATE OR REPLACE FUNCTION receivables.create_customer(
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
    v_code text;
    v_name text := nullif(btrim(p_name), '');
    v_contact text := coalesce(nullif(btrim(p_contact_name), ''), nullif(btrim(p_phone), ''));
    v_credit_enabled boolean := coalesce(p_credit_enabled, false);
    v_credit_limit numeric(14, 2) := coalesce(p_credit_limit, 0);
    v_payment_terms_days integer := coalesce(p_payment_terms_days, 0);
BEGIN
    SELECT user_id INTO v_user_id
    FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_CUSTOMERS');

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

    -- Ignore caller-supplied create code. The sequence is authoritative and the
    -- uniqueness loop also tolerates historical/manual CUS-* codes.
    LOOP
        v_code := 'CUS-' || lpad(nextval('receivables.customer_code_seq')::text, 6, '0');
        EXIT WHEN NOT EXISTS (SELECT 1 FROM receivables.customers WHERE code = v_code);
    END LOOP;

    INSERT INTO receivables.customers (
        code, name, contact_name, phone, email, address, tax_id,
        credit_enabled, credit_limit, payment_terms_days, max_overdue_days
    ) VALUES (
        v_code, v_name, v_contact, NULL,
        nullif(btrim(p_email), ''), nullif(btrim(p_address), ''), nullif(btrim(p_tax_id), ''),
        v_credit_enabled, v_credit_limit, v_payment_terms_days, p_max_overdue_days
    ) RETURNING id INTO v_customer_id;

    RETURN jsonb_build_object(
        'id', v_customer_id,
        'code', v_code,
        'name', v_name,
        'contact_name', v_contact,
        'phone', NULL,
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

CREATE OR REPLACE FUNCTION receivables.update_customer(
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
    v_code text;
    v_name text := nullif(btrim(p_name), '');
    v_contact text := coalesce(nullif(btrim(p_contact_name), ''), nullif(btrim(p_phone), ''));
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
    IF v_name IS NULL THEN
        RAISE EXCEPTION 'customer name must not be blank' USING ERRCODE = '22023';
    END IF;
    IF v_credit_limit < 0 OR v_payment_terms_days < 0 OR (p_max_overdue_days IS NOT NULL AND p_max_overdue_days < 0) THEN
        RAISE EXCEPTION 'invalid credit policy' USING ERRCODE = '22023';
    END IF;
    IF NOT v_credit_enabled AND (v_credit_limit <> 0 OR v_payment_terms_days <> 0 OR p_max_overdue_days IS NOT NULL) THEN
        RAISE EXCEPTION 'disabled credit requires zero limit, zero payment terms, and no overdue policy' USING ERRCODE = '22023';
    END IF;

    -- Code is immutable after creation. Lock customer + credit state together so
    -- profile/policy changes serialize with credit postings.
    SELECT c.code, cs.exposure_amount, cs.oldest_open_due_date
    INTO v_code, v_exposure, v_oldest_due
    FROM receivables.customers c
    JOIN receivables.customer_credit_state cs ON cs.customer_id = c.id
    WHERE c.id = p_customer_id
    FOR UPDATE OF c, cs;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'customer % not found', p_customer_id USING ERRCODE = '22023';
    END IF;

    UPDATE receivables.customers
    SET name = v_name,
        contact_name = v_contact,
        phone = NULL,
        email = nullif(btrim(p_email), ''),
        address = nullif(btrim(p_address), ''),
        tax_id = nullif(btrim(p_tax_id), ''),
        is_active = coalesce(p_is_active, true),
        credit_enabled = v_credit_enabled,
        credit_limit = v_credit_limit,
        payment_terms_days = v_payment_terms_days,
        max_overdue_days = p_max_overdue_days
    WHERE id = p_customer_id;

    RETURN jsonb_build_object(
        'id', p_customer_id,
        'code', v_code,
        'name', v_name,
        'contact_name', v_contact,
        'phone', NULL,
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

RESET ROLE;
