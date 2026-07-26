-- S4-001: Customer master, credit limits, customer ledger, and customer payments schema
--
-- Extends constraint lists to add CUSTOMER_PAYMENT document type.

ALTER TABLE core.business_documents DROP CONSTRAINT IF EXISTS business_documents_type_valid;
ALTER TABLE core.business_documents ADD CONSTRAINT business_documents_type_valid
    CHECK (document_type IN (
        'CASH_SALE', 'JOURNAL_ENTRY', 'STOCK_RECEIPT', 'STOCK_ADJUSTMENT',
        'PURCHASE_ORDER', 'PURCHASE_RECEIPT', 'PURCHASE_INVOICE',
        'PURCHASE_RETURN', 'DEBIT_NOTE', 'SUPPLIER_PAYMENT', 'CUSTOMER_PAYMENT'
    ));

ALTER TABLE core.document_sequences DROP CONSTRAINT IF EXISTS document_sequences_type_valid;
ALTER TABLE core.document_sequences ADD CONSTRAINT document_sequences_type_valid
    CHECK (document_type IN (
        'CASH_SALE', 'JOURNAL_ENTRY', 'STOCK_RECEIPT', 'STOCK_ADJUSTMENT',
        'PURCHASE_ORDER', 'PURCHASE_RECEIPT', 'PURCHASE_INVOICE',
        'DEBIT_NOTE', 'SUPPLIER_PAYMENT', 'CUSTOMER_PAYMENT'
    ));

-- ───────────────────────────────────────────────────────────────
-- Customer master
-- ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sales.customers (
    id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code             text    NOT NULL UNIQUE,
    name             text    NOT NULL,
    contact_name     text,
    phone            text,
    email            text,
    address          text,
    tax_id           text,
    credit_limit_amount  numeric(15,2) NOT NULL DEFAULT 0,
    max_overdue_days     integer       NOT NULL DEFAULT 0,
    is_active        boolean NOT NULL DEFAULT TRUE,
    created_at       timestamptz NOT NULL DEFAULT now()
);

-- ───────────────────────────────────────────────────────────────
-- Live credit exposure cache (one row per customer, updated atomically by posting functions)
-- ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sales.customer_credit_states (
    customer_id          bigint PRIMARY KEY REFERENCES sales.customers(id) ON DELETE RESTRICT,
    exposure_amount      numeric(15,2) NOT NULL DEFAULT 0,
    last_recalculated_at timestamptz   NOT NULL DEFAULT now()
);

-- ───────────────────────────────────────────────────────────────
-- Open receivables from credit sales (populated by Slice 5 confirm_credit_sale posting function)
-- ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sales.customer_liabilities (
    id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    customer_id      bigint NOT NULL REFERENCES sales.customers(id) ON DELETE RESTRICT,
    document_id      bigint REFERENCES core.business_documents(id) ON DELETE RESTRICT,
    original_amount  numeric(15,2) NOT NULL,
    remaining_amount numeric(15,2) NOT NULL,
    due_date         date,
    status           text NOT NULL DEFAULT 'OPEN'
                     CHECK (status IN ('OPEN', 'PARTIALLY_PAID', 'PAID')),
    created_at       timestamptz NOT NULL DEFAULT now()
);

-- ───────────────────────────────────────────────────────────────
-- Customer payment records (receipts reducing receivable balances)
-- ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sales.customer_payments (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    customer_id     bigint NOT NULL REFERENCES sales.customers(id) ON DELETE RESTRICT,
    liability_id    bigint REFERENCES sales.customer_liabilities(id) ON DELETE RESTRICT,
    document_id     bigint UNIQUE REFERENCES core.business_documents(id) ON DELETE RESTRICT,
    amount          numeric(15,2) NOT NULL CHECK (amount > 0),
    payment_method  text NOT NULL CHECK (payment_method IN ('CASH', 'BANK_TRANSFER', 'CHECK')),
    document_date   date NOT NULL,
    fiscal_period_id bigint NOT NULL REFERENCES finance.fiscal_periods(id) ON DELETE RESTRICT,
    note            text,
    created_at      timestamptz NOT NULL DEFAULT now()
);

-- Prevent modification of posted payment records
CREATE OR REPLACE FUNCTION sales.prevent_customer_payment_modification()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'customer_payments records are immutable after insert (payment_id=%)', OLD.id
        USING ERRCODE = 'P0001';
END;
$$;

DROP TRIGGER IF EXISTS trg_customer_payments_immutable ON sales.customer_payments;
CREATE TRIGGER trg_customer_payments_immutable
    BEFORE UPDATE OR DELETE ON sales.customer_payments
    FOR EACH ROW EXECUTE FUNCTION sales.prevent_customer_payment_modification();

-- ───────────────────────────────────────────────────────────────
-- Query helpers (SECURITY DEFINER)
-- ───────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION sales.create_customer(
    p_session_token   text,
    p_code            text,
    p_name            text,
    p_contact_name    text,
    p_phone           text,
    p_email           text,
    p_address         text,
    p_tax_id          text,
    p_credit_limit    numeric,
    p_max_overdue_days integer
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = core, sales, iam, public AS $$
DECLARE
    v_user_id bigint;
    v_new_id  bigint;
BEGIN
    -- Validate session
    SELECT s.user_id INTO v_user_id
    FROM iam.application_sessions s
    WHERE s.token_hash = sha256(p_session_token::bytea)
      AND s.revoked_at IS NULL
      AND s.expires_at > now();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'SESSION_INVALID: Invalid or expired session' USING ERRCODE = '28000';
    END IF;

    IF trim(p_code) = '' THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Customer code cannot be blank.' USING ERRCODE = '22023';
    END IF;
    IF trim(p_name) = '' THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Customer name cannot be blank.' USING ERRCODE = '22023';
    END IF;

    INSERT INTO sales.customers (code, name, contact_name, phone, email, address, tax_id, credit_limit_amount, max_overdue_days)
    VALUES (trim(p_code), trim(p_name), p_contact_name, p_phone, p_email, p_address, p_tax_id,
            COALESCE(p_credit_limit, 0), COALESCE(p_max_overdue_days, 0))
    RETURNING id INTO v_new_id;

    -- Initialize credit state row
    INSERT INTO sales.customer_credit_states (customer_id, exposure_amount)
    VALUES (v_new_id, 0)
    ON CONFLICT (customer_id) DO NOTHING;

    RETURN jsonb_build_object('id', v_new_id, 'code', trim(p_code), 'name', trim(p_name), 'is_active', true);
END;
$$;
REVOKE EXECUTE ON FUNCTION sales.create_customer(text, text, text, text, text, text, text, text, numeric, integer) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION sales.create_customer(text, text, text, text, text, text, text, text, numeric, integer) TO stockiha_runtime;

CREATE OR REPLACE FUNCTION sales.list_customers(
    p_session_token   text,
    p_include_inactive boolean DEFAULT FALSE
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = core, sales, iam, public AS $$
DECLARE
    v_user_id bigint;
    v_result  jsonb;
BEGIN
    SELECT s.user_id INTO v_user_id
    FROM iam.application_sessions s
    WHERE s.token_hash = sha256(p_session_token::bytea)
      AND s.revoked_at IS NULL
      AND s.expires_at > now();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'SESSION_INVALID: Invalid or expired session' USING ERRCODE = '28000';
    END IF;

    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', c.id,
            'code', c.code,
            'name', c.name,
            'contact_name', c.contact_name,
            'phone', c.phone,
            'email', c.email,
            'address', c.address,
            'tax_id', c.tax_id,
            'credit_limit_amount', c.credit_limit_amount::text,
            'max_overdue_days', c.max_overdue_days,
            'is_active', c.is_active,
            'exposure_amount', COALESCE(cs.exposure_amount, 0)::text,
            'created_at', to_char(c.created_at AT TIME ZONE 'Africa/Algiers', 'YYYY-MM-DD"T"HH24:MI:SS')
        )
        ORDER BY c.code
    ), '[]'::jsonb)
    INTO v_result
    FROM sales.customers c
    LEFT JOIN sales.customer_credit_states cs ON cs.customer_id = c.id
    WHERE (p_include_inactive OR c.is_active);

    RETURN v_result;
END;
$$;
REVOKE EXECUTE ON FUNCTION sales.list_customers(text, boolean) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION sales.list_customers(text, boolean) TO stockiha_runtime;

CREATE OR REPLACE FUNCTION sales.list_customer_liabilities(
    p_session_token text,
    p_customer_id   bigint DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = core, sales, iam, public AS $$
DECLARE
    v_user_id bigint;
    v_result  jsonb;
BEGIN
    SELECT s.user_id INTO v_user_id
    FROM iam.application_sessions s
    WHERE s.token_hash = sha256(p_session_token::bytea)
      AND s.revoked_at IS NULL
      AND s.expires_at > now();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'SESSION_INVALID: Invalid or expired session' USING ERRCODE = '28000';
    END IF;

    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', l.id,
            'customer_id', l.customer_id,
            'customer_name', c.name,
            'customer_code', c.code,
            'original_amount', l.original_amount::text,
            'remaining_amount', l.remaining_amount::text,
            'due_date', to_char(l.due_date, 'YYYY-MM-DD'),
            'status', l.status,
            'created_at', to_char(l.created_at AT TIME ZONE 'Africa/Algiers', 'YYYY-MM-DD"T"HH24:MI:SS')
        )
        ORDER BY l.created_at DESC
    ), '[]'::jsonb)
    INTO v_result
    FROM sales.customer_liabilities l
    JOIN sales.customers c ON c.id = l.customer_id
    WHERE l.status IN ('OPEN', 'PARTIALLY_PAID')
      AND (p_customer_id IS NULL OR l.customer_id = p_customer_id);

    RETURN v_result;
END;
$$;
REVOKE EXECUTE ON FUNCTION sales.list_customer_liabilities(text, bigint) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION sales.list_customer_liabilities(text, bigint) TO stockiha_runtime;

CREATE OR REPLACE FUNCTION sales.list_customer_payments(
    p_session_token text,
    p_customer_id   bigint DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = core, sales, iam, public AS $$
DECLARE
    v_user_id bigint;
    v_result  jsonb;
BEGIN
    SELECT s.user_id INTO v_user_id
    FROM iam.application_sessions s
    WHERE s.token_hash = sha256(p_session_token::bytea)
      AND s.revoked_at IS NULL
      AND s.expires_at > now();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'SESSION_INVALID: Invalid or expired session' USING ERRCODE = '28000';
    END IF;

    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', p.id,
            'customer_id', p.customer_id,
            'customer_name', c.name,
            'customer_code', c.code,
            'liability_id', p.liability_id,
            'amount', p.amount::text,
            'payment_method', p.payment_method,
            'document_number', bd.document_number,
            'document_date', to_char(p.document_date, 'YYYY-MM-DD'),
            'note', p.note,
            'created_at', to_char(p.created_at AT TIME ZONE 'Africa/Algiers', 'YYYY-MM-DD"T"HH24:MI:SS')
        )
        ORDER BY p.created_at DESC
    ), '[]'::jsonb)
    INTO v_result
    FROM sales.customer_payments p
    JOIN sales.customers c ON c.id = p.customer_id
    LEFT JOIN core.business_documents bd ON bd.id = p.document_id
    WHERE (p_customer_id IS NULL OR p.customer_id = p_customer_id);

    RETURN v_result;
END;
$$;
REVOKE EXECUTE ON FUNCTION sales.list_customer_payments(text, bigint) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION sales.list_customer_payments(text, bigint) TO stockiha_runtime;
