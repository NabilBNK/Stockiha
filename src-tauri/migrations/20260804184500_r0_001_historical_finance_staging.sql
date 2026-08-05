-- R0-001: finance-only historical onboarding staging foundation.
--
-- Excel is the primary ingestion path and direct application entry is the
-- fallback. Both write only to this isolated staging schema. No function in
-- this migration posts sales, purchases, stock movements, cash movements,
-- receivables, payables, or journals.
SET ROLE stockiha_owner;

CREATE SCHEMA IF NOT EXISTS onboarding AUTHORIZATION stockiha_owner;
REVOKE ALL ON SCHEMA onboarding FROM PUBLIC;
GRANT USAGE ON SCHEMA onboarding TO stockiha_runtime;

-- Extend the closed permission vocabulary without reconstructing every prior
-- forward extension.
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
        'ALTER TABLE iam.permissions ADD CONSTRAINT permissions_code_valid CHECK ((%s) OR code = ANY (ARRAY[%L,%L]::text[]))',
        v_existing_check,
        'MANAGE_HISTORICAL_FINANCE_IMPORT',
        'REVIEW_HISTORICAL_FINANCE_IMPORT'
    );
END;
$$;

INSERT INTO iam.permissions (code, name) VALUES
    ('MANAGE_HISTORICAL_FINANCE_IMPORT', 'Create and validate historical finance imports'),
    ('REVIEW_HISTORICAL_FINANCE_IMPORT', 'Approve historical finance data for reporting')
ON CONFLICT (code) DO NOTHING;

-- Pilot posture: administrator-only. A future CEO role can inherit these
-- permissions through a forward migration.
INSERT INTO iam.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM iam.roles r
CROSS JOIN iam.permissions p
WHERE r.code = 'ADMIN'
  AND p.code IN (
      'MANAGE_HISTORICAL_FINANCE_IMPORT',
      'REVIEW_HISTORICAL_FINANCE_IMPORT'
  )
ON CONFLICT DO NOTHING;

CREATE TABLE onboarding.feature_settings (
    singleton                          boolean PRIMARY KEY DEFAULT true,
    historical_finance_import_enabled boolean NOT NULL DEFAULT true,
    updated_by                         bigint REFERENCES iam.users(id) ON DELETE RESTRICT,
    updated_at                         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT feature_settings_singleton CHECK (singleton)
);

INSERT INTO onboarding.feature_settings (
    singleton,
    historical_finance_import_enabled
) VALUES (true, true)
ON CONFLICT (singleton) DO NOTHING;

CREATE TABLE onboarding.historical_finance_batches (
    id                       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    request_id               text NOT NULL UNIQUE,
    source_type              text NOT NULL,
    original_filename        text,
    status                   text NOT NULL DEFAULT 'DRAFT',
    created_by               bigint NOT NULL REFERENCES iam.users(id) ON DELETE RESTRICT,
    workstation_id           text NOT NULL,
    created_at               timestamptz NOT NULL DEFAULT now(),
    validated_at             timestamptz,
    approved_by              bigint REFERENCES iam.users(id) ON DELETE RESTRICT,
    approved_at              timestamptz,
    rejected_by              bigint REFERENCES iam.users(id) ON DELETE RESTRICT,
    rejected_at              timestamptz,
    decision_reason          text,
    row_count                integer NOT NULL DEFAULT 0,
    invalid_row_count        integer NOT NULL DEFAULT 0,
    total_sales_dzd          bigint NOT NULL DEFAULT 0,
    total_purchases_dzd      bigint NOT NULL DEFAULT 0,
    total_expenses_dzd       bigint NOT NULL DEFAULT 0,
    total_other_income_dzd   bigint NOT NULL DEFAULT 0,
    total_customer_refunds_dzd bigint NOT NULL DEFAULT 0,
    total_supplier_refunds_dzd bigint NOT NULL DEFAULT 0,
    CONSTRAINT historical_finance_batches_request_not_blank
        CHECK (btrim(request_id) <> ''),
    CONSTRAINT historical_finance_batches_request_length
        CHECK (length(request_id) BETWEEN 8 AND 128),
    CONSTRAINT historical_finance_batches_source_valid
        CHECK (source_type IN ('EXCEL', 'MANUAL')),
    CONSTRAINT historical_finance_batches_filename_valid
        CHECK (
            (source_type = 'EXCEL' AND original_filename IS NOT NULL
             AND btrim(original_filename) <> '' AND length(original_filename) <= 255)
            OR
            (source_type = 'MANUAL' AND original_filename IS NULL)
        ),
    CONSTRAINT historical_finance_batches_status_valid
        CHECK (status IN (
            'DRAFT',
            'VALIDATED',
            'NEEDS_REVIEW',
            'APPROVED_FOR_REPORTING',
            'REJECTED'
        )),
    CONSTRAINT historical_finance_batches_workstation_not_blank
        CHECK (btrim(workstation_id) <> ''),
    CONSTRAINT historical_finance_batches_counts_valid
        CHECK (row_count >= 0 AND invalid_row_count >= 0 AND invalid_row_count <= row_count),
    CONSTRAINT historical_finance_batches_decision_consistent CHECK (
        (status IN ('DRAFT', 'VALIDATED', 'NEEDS_REVIEW')
            AND approved_by IS NULL AND approved_at IS NULL
            AND rejected_by IS NULL AND rejected_at IS NULL)
        OR
        (status = 'APPROVED_FOR_REPORTING'
            AND approved_by IS NOT NULL AND approved_at IS NOT NULL
            AND rejected_by IS NULL AND rejected_at IS NULL)
        OR
        (status = 'REJECTED'
            AND rejected_by IS NOT NULL AND rejected_at IS NOT NULL
            AND approved_by IS NULL AND approved_at IS NULL
            AND decision_reason IS NOT NULL AND btrim(decision_reason) <> '')
    )
);

CREATE INDEX historical_finance_batches_created_at_idx
    ON onboarding.historical_finance_batches (created_at DESC);
CREATE INDEX historical_finance_batches_status_idx
    ON onboarding.historical_finance_batches (status, created_at DESC);

CREATE TABLE onboarding.historical_finance_rows (
    id                       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    batch_id                 bigint NOT NULL REFERENCES onboarding.historical_finance_batches(id) ON DELETE RESTRICT,
    source_row_number        integer NOT NULL,
    paper_id                 text NOT NULL UNIQUE,
    transaction_date         date NOT NULL,
    transaction_type         text NOT NULL,
    description_or_category  text NOT NULL,
    net_amount_dzd           bigint NOT NULL,
    payment_status           text NOT NULL,
    amount_paid_dzd          bigint,
    expense_category         text,
    supplier_fournisseur     text,
    customer_client          text,
    notes                    text,
    review_status            text NOT NULL DEFAULT 'READY',
    validation_errors        jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at               timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT historical_finance_rows_batch_row_unique
        UNIQUE (batch_id, source_row_number),
    CONSTRAINT historical_finance_rows_source_row_positive
        CHECK (source_row_number >= 2),
    CONSTRAINT historical_finance_rows_paper_not_blank
        CHECK (btrim(paper_id) <> '' AND length(paper_id) <= 128),
    CONSTRAINT historical_finance_rows_type_valid CHECK (transaction_type IN (
        'SALE',
        'PURCHASE',
        'EXPENSE',
        'OTHER_INCOME',
        'CUSTOMER_REFUND',
        'SUPPLIER_REFUND',
        'LOAN_RECEIVED',
        'LOAN_REPAYMENT',
        'OWNER_CONTRIBUTION',
        'OWNER_WITHDRAWAL',
        'TAX_PAYMENT',
        'SALARY',
        'OTHER'
    )),
    CONSTRAINT historical_finance_rows_description_not_blank
        CHECK (btrim(description_or_category) <> '' AND length(description_or_category) <= 500),
    CONSTRAINT historical_finance_rows_net_positive
        CHECK (net_amount_dzd > 0),
    CONSTRAINT historical_finance_rows_paid_amount_valid
        CHECK (amount_paid_dzd IS NULL OR amount_paid_dzd >= 0),
    CONSTRAINT historical_finance_rows_payment_status_valid
        CHECK (payment_status IN ('PAID', 'UNPAID', 'PARTIAL', 'UNKNOWN')),
    CONSTRAINT historical_finance_rows_review_status_valid
        CHECK (review_status IN ('READY', 'NEEDS_REVIEW', 'APPROVED', 'REJECTED')),
    CONSTRAINT historical_finance_rows_validation_errors_array
        CHECK (jsonb_typeof(validation_errors) = 'array')
);

CREATE INDEX historical_finance_rows_batch_idx
    ON onboarding.historical_finance_rows (batch_id, source_row_number);
CREATE INDEX historical_finance_rows_date_type_idx
    ON onboarding.historical_finance_rows (transaction_date, transaction_type);

CREATE TABLE onboarding.historical_finance_balances (
    id                       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    batch_id                 bigint NOT NULL REFERENCES onboarding.historical_finance_batches(id) ON DELETE RESTRICT,
    source_row_number        integer NOT NULL,
    balance_date             date NOT NULL,
    balance_type             text NOT NULL,
    amount_dzd               bigint NOT NULL,
    supplier_fournisseur     text,
    customer_client          text,
    notes                    text,
    review_status            text NOT NULL DEFAULT 'READY',
    validation_errors        jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at               timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT historical_finance_balances_batch_row_unique
        UNIQUE (batch_id, source_row_number),
    CONSTRAINT historical_finance_balances_source_row_positive
        CHECK (source_row_number >= 2),
    CONSTRAINT historical_finance_balances_type_valid CHECK (balance_type IN (
        'OPENING_CASH',
        'CLOSING_CASH',
        'OPENING_BANK',
        'CLOSING_BANK',
        'OPENING_INVENTORY_VALUE',
        'CLOSING_INVENTORY_VALUE',
        'CUSTOMER_RECEIVABLE',
        'SUPPLIER_PAYABLE',
        'LOAN_BALANCE',
        'TAX_PAYABLE',
        'OWNER_CAPITAL',
        'OTHER'
    )),
    CONSTRAINT historical_finance_balances_amount_nonnegative
        CHECK (amount_dzd >= 0),
    CONSTRAINT historical_finance_balances_review_status_valid
        CHECK (review_status IN ('READY', 'NEEDS_REVIEW', 'APPROVED', 'REJECTED')),
    CONSTRAINT historical_finance_balances_validation_errors_array
        CHECK (jsonb_typeof(validation_errors) = 'array')
);

CREATE INDEX historical_finance_balances_batch_idx
    ON onboarding.historical_finance_balances (batch_id, source_row_number);

CREATE TABLE onboarding.historical_finance_audit (
    id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    batch_id         bigint NOT NULL REFERENCES onboarding.historical_finance_batches(id) ON DELETE RESTRICT,
    action_code      text NOT NULL,
    actor_id         bigint NOT NULL REFERENCES iam.users(id) ON DELETE RESTRICT,
    workstation_id   text NOT NULL,
    from_status      text,
    to_status        text,
    reason           text,
    occurred_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT historical_finance_audit_action_valid CHECK (action_code IN (
        'CREATED',
        'DATA_REPLACED',
        'VALIDATED',
        'APPROVED',
        'REJECTED',
        'SETTING_CHANGED'
    )),
    CONSTRAINT historical_finance_audit_workstation_not_blank
        CHECK (btrim(workstation_id) <> '')
);

CREATE INDEX historical_finance_audit_batch_idx
    ON onboarding.historical_finance_audit (batch_id, occurred_at);

REVOKE ALL ON onboarding.feature_settings FROM PUBLIC;
REVOKE ALL ON onboarding.historical_finance_batches FROM PUBLIC;
REVOKE ALL ON onboarding.historical_finance_rows FROM PUBLIC;
REVOKE ALL ON onboarding.historical_finance_balances FROM PUBLIC;
REVOKE ALL ON onboarding.historical_finance_audit FROM PUBLIC;
REVOKE ALL ON onboarding.feature_settings FROM stockiha_runtime;
REVOKE ALL ON onboarding.historical_finance_batches FROM stockiha_runtime;
REVOKE ALL ON onboarding.historical_finance_rows FROM stockiha_runtime;
REVOKE ALL ON onboarding.historical_finance_balances FROM stockiha_runtime;
REVOKE ALL ON onboarding.historical_finance_audit FROM stockiha_runtime;

CREATE FUNCTION onboarding.get_historical_finance_setting(
    p_session_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_enabled boolean;
BEGIN
    PERFORM 1
    FROM iam.resolve_session_with_permission(
        p_session_token,
        'MANAGE_HISTORICAL_FINANCE_IMPORT'
    );

    SELECT historical_finance_import_enabled
    INTO v_enabled
    FROM onboarding.feature_settings
    WHERE singleton;

    RETURN jsonb_build_object('enabled', v_enabled);
END;
$$;

CREATE FUNCTION onboarding.update_historical_finance_setting(
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
BEGIN
    SELECT user_id, workstation_id
    INTO v_actor_id, v_workstation_id
    FROM iam.resolve_session_with_permission(
        p_session_token,
        'MANAGE_HISTORICAL_FINANCE_IMPORT'
    );

    UPDATE onboarding.feature_settings
    SET historical_finance_import_enabled = p_enabled,
        updated_by = v_actor_id,
        updated_at = now()
    WHERE singleton;

    RETURN jsonb_build_object('enabled', p_enabled);
END;
$$;

CREATE FUNCTION onboarding.create_historical_finance_batch(
    p_session_token text,
    p_request_id text,
    p_source_type text,
    p_original_filename text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_actor_id bigint;
    v_workstation_id text;
    v_existing onboarding.historical_finance_batches%ROWTYPE;
    v_batch_id bigint;
    v_enabled boolean;
BEGIN
    SELECT user_id, workstation_id
    INTO v_actor_id, v_workstation_id
    FROM iam.resolve_session_with_permission(
        p_session_token,
        'MANAGE_HISTORICAL_FINANCE_IMPORT'
    );

    SELECT historical_finance_import_enabled
    INTO v_enabled
    FROM onboarding.feature_settings
    WHERE singleton;

    IF NOT COALESCE(v_enabled, false) THEN
        RAISE EXCEPTION 'historical finance import is disabled'
            USING ERRCODE = '55000';
    END IF;

    IF p_request_id IS NULL OR length(btrim(p_request_id)) NOT BETWEEN 8 AND 128 THEN
        RAISE EXCEPTION 'invalid historical finance request id' USING ERRCODE = '22023';
    END IF;
    IF p_source_type NOT IN ('EXCEL', 'MANUAL') THEN
        RAISE EXCEPTION 'invalid historical finance source type' USING ERRCODE = '22023';
    END IF;
    IF p_source_type = 'EXCEL' AND (
        p_original_filename IS NULL
        OR btrim(p_original_filename) = ''
        OR length(p_original_filename) > 255
    ) THEN
        RAISE EXCEPTION 'Excel imports require a safe filename' USING ERRCODE = '22023';
    END IF;
    IF p_source_type = 'MANUAL' AND p_original_filename IS NOT NULL THEN
        RAISE EXCEPTION 'manual batches must not carry a filename' USING ERRCODE = '22023';
    END IF;

    SELECT *
    INTO v_existing
    FROM onboarding.historical_finance_batches
    WHERE request_id = btrim(p_request_id);

    IF FOUND THEN
        IF v_existing.created_by <> v_actor_id
           OR v_existing.source_type <> p_source_type
           OR v_existing.original_filename IS DISTINCT FROM p_original_filename THEN
            RAISE EXCEPTION 'historical finance request id conflicts with an existing request'
                USING ERRCODE = '23505';
        END IF;

        RETURN jsonb_build_object(
            'batchId', v_existing.id,
            'status', v_existing.status,
            'isReplay', true,
            'sourceType', v_existing.source_type,
            'originalFilename', v_existing.original_filename
        );
    END IF;

    INSERT INTO onboarding.historical_finance_batches (
        request_id,
        source_type,
        original_filename,
        created_by,
        workstation_id
    ) VALUES (
        btrim(p_request_id),
        p_source_type,
        CASE WHEN p_original_filename IS NULL THEN NULL ELSE btrim(p_original_filename) END,
        v_actor_id,
        v_workstation_id
    )
    RETURNING id INTO v_batch_id;

    INSERT INTO onboarding.historical_finance_audit (
        batch_id,
        action_code,
        actor_id,
        workstation_id,
        to_status
    ) VALUES (
        v_batch_id,
        'CREATED',
        v_actor_id,
        v_workstation_id,
        'DRAFT'
    );

    RETURN jsonb_build_object(
        'batchId', v_batch_id,
        'status', 'DRAFT',
        'isReplay', false,
        'sourceType', p_source_type,
        'originalFilename', p_original_filename
    );
END;
$$;

CREATE FUNCTION onboarding.replace_historical_finance_batch_data(
    p_session_token text,
    p_batch_id bigint,
    p_rows jsonb,
    p_balances jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_actor_id bigint;
    v_workstation_id text;
    v_batch onboarding.historical_finance_batches%ROWTYPE;
    v_row_count integer;
    v_balance_count integer;
BEGIN
    SELECT user_id, workstation_id
    INTO v_actor_id, v_workstation_id
    FROM iam.resolve_session_with_permission(
        p_session_token,
        'MANAGE_HISTORICAL_FINANCE_IMPORT'
    );

    IF jsonb_typeof(p_rows) <> 'array' OR jsonb_typeof(p_balances) <> 'array' THEN
        RAISE EXCEPTION 'historical finance rows and balances must be arrays'
            USING ERRCODE = '22023';
    END IF;

    SELECT *
    INTO v_batch
    FROM onboarding.historical_finance_batches
    WHERE id = p_batch_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'unknown historical finance batch' USING ERRCODE = '22023';
    END IF;
    IF v_batch.status NOT IN ('DRAFT', 'NEEDS_REVIEW', 'VALIDATED') THEN
        RAISE EXCEPTION 'historical finance batch is immutable after decision'
            USING ERRCODE = '55000';
    END IF;

    DELETE FROM onboarding.historical_finance_rows WHERE batch_id = p_batch_id;
    DELETE FROM onboarding.historical_finance_balances WHERE batch_id = p_batch_id;

    INSERT INTO onboarding.historical_finance_rows (
        batch_id,
        source_row_number,
        paper_id,
        transaction_date,
        transaction_type,
        description_or_category,
        net_amount_dzd,
        payment_status,
        amount_paid_dzd,
        expense_category,
        supplier_fournisseur,
        customer_client,
        notes,
        review_status
    )
    SELECT
        p_batch_id,
        x.source_row_number,
        btrim(x.paper_id),
        x.transaction_date,
        x.transaction_type,
        btrim(x.description_or_category),
        x.net_amount_dzd,
        x.payment_status,
        x.amount_paid_dzd,
        NULLIF(btrim(x.expense_category), ''),
        NULLIF(btrim(x.supplier_fournisseur), ''),
        NULLIF(btrim(x.customer_client), ''),
        NULLIF(btrim(x.notes), ''),
        COALESCE(x.review_status, 'READY')
    FROM jsonb_to_recordset(p_rows) AS x(
        source_row_number integer,
        paper_id text,
        transaction_date date,
        transaction_type text,
        description_or_category text,
        net_amount_dzd bigint,
        payment_status text,
        amount_paid_dzd bigint,
        expense_category text,
        supplier_fournisseur text,
        customer_client text,
        notes text,
        review_status text
    );

    INSERT INTO onboarding.historical_finance_balances (
        batch_id,
        source_row_number,
        balance_date,
        balance_type,
        amount_dzd,
        supplier_fournisseur,
        customer_client,
        notes,
        review_status
    )
    SELECT
        p_batch_id,
        x.source_row_number,
        x.balance_date,
        x.balance_type,
        x.amount_dzd,
        NULLIF(btrim(x.supplier_fournisseur), ''),
        NULLIF(btrim(x.customer_client), ''),
        NULLIF(btrim(x.notes), ''),
        COALESCE(x.review_status, 'READY')
    FROM jsonb_to_recordset(p_balances) AS x(
        source_row_number integer,
        balance_date date,
        balance_type text,
        amount_dzd bigint,
        supplier_fournisseur text,
        customer_client text,
        notes text,
        review_status text
    );

    SELECT count(*) INTO v_row_count
    FROM onboarding.historical_finance_rows
    WHERE batch_id = p_batch_id;

    SELECT count(*) INTO v_balance_count
    FROM onboarding.historical_finance_balances
    WHERE batch_id = p_batch_id;

    UPDATE onboarding.historical_finance_batches
    SET status = 'DRAFT',
        validated_at = NULL,
        row_count = v_row_count,
        invalid_row_count = 0,
        total_sales_dzd = 0,
        total_purchases_dzd = 0,
        total_expenses_dzd = 0,
        total_other_income_dzd = 0,
        total_customer_refunds_dzd = 0,
        total_supplier_refunds_dzd = 0
    WHERE id = p_batch_id;

    INSERT INTO onboarding.historical_finance_audit (
        batch_id,
        action_code,
        actor_id,
        workstation_id,
        from_status,
        to_status,
        reason
    ) VALUES (
        p_batch_id,
        'DATA_REPLACED',
        v_actor_id,
        v_workstation_id,
        v_batch.status,
        'DRAFT',
        format('%s transaction rows and %s balance rows', v_row_count, v_balance_count)
    );

    RETURN jsonb_build_object(
        'batchId', p_batch_id,
        'status', 'DRAFT',
        'transactionRowCount', v_row_count,
        'balanceRowCount', v_balance_count
    );
END;
$$;

CREATE FUNCTION onboarding.validate_historical_finance_batch(
    p_session_token text,
    p_batch_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_actor_id bigint;
    v_workstation_id text;
    v_batch onboarding.historical_finance_batches%ROWTYPE;
    v_row_count integer;
    v_invalid_count integer;
    v_status text;
    v_sales bigint;
    v_purchases bigint;
    v_expenses bigint;
    v_other_income bigint;
    v_customer_refunds bigint;
    v_supplier_refunds bigint;
BEGIN
    SELECT user_id, workstation_id
    INTO v_actor_id, v_workstation_id
    FROM iam.resolve_session_with_permission(
        p_session_token,
        'MANAGE_HISTORICAL_FINANCE_IMPORT'
    );

    SELECT *
    INTO v_batch
    FROM onboarding.historical_finance_batches
    WHERE id = p_batch_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'unknown historical finance batch' USING ERRCODE = '22023';
    END IF;
    IF v_batch.status IN ('APPROVED_FOR_REPORTING', 'REJECTED') THEN
        RAISE EXCEPTION 'historical finance batch is immutable after decision'
            USING ERRCODE = '55000';
    END IF;

    UPDATE onboarding.historical_finance_rows r
    SET validation_errors = to_jsonb(array_remove(ARRAY[
        CASE WHEN r.transaction_date > current_date THEN 'FUTURE_DATE' END,
        CASE WHEN r.payment_status = 'PARTIAL'
                  AND (r.amount_paid_dzd IS NULL
                       OR r.amount_paid_dzd <= 0
                       OR r.amount_paid_dzd >= r.net_amount_dzd)
             THEN 'INVALID_PARTIAL_PAYMENT' END,
        CASE WHEN r.payment_status = 'UNPAID'
                  AND COALESCE(r.amount_paid_dzd, 0) <> 0
             THEN 'UNPAID_HAS_PAYMENT' END,
        CASE WHEN r.payment_status = 'PAID'
                  AND r.amount_paid_dzd IS NOT NULL
                  AND r.amount_paid_dzd <> r.net_amount_dzd
             THEN 'PAID_AMOUNT_MISMATCH' END,
        CASE WHEN r.payment_status = 'UNKNOWN' THEN 'UNKNOWN_PAYMENT_STATUS' END,
        CASE WHEN r.transaction_type IN ('EXPENSE', 'SALARY', 'TAX_PAYMENT')
                  AND r.expense_category IS NULL
             THEN 'MISSING_EXPENSE_CATEGORY' END,
        CASE WHEN r.review_status = 'NEEDS_REVIEW' THEN 'ROW_NEEDS_REVIEW' END
    ]::text[], NULL));

    UPDATE onboarding.historical_finance_balances b
    SET validation_errors = to_jsonb(array_remove(ARRAY[
        CASE WHEN b.balance_date > current_date THEN 'FUTURE_DATE' END,
        CASE WHEN b.balance_type = 'CUSTOMER_RECEIVABLE'
                  AND b.customer_client IS NULL
             THEN 'MISSING_CUSTOMER' END,
        CASE WHEN b.balance_type = 'SUPPLIER_PAYABLE'
                  AND b.supplier_fournisseur IS NULL
             THEN 'MISSING_SUPPLIER' END,
        CASE WHEN b.review_status = 'NEEDS_REVIEW' THEN 'ROW_NEEDS_REVIEW' END
    ]::text[], NULL));

    SELECT
        count(*),
        count(*) FILTER (WHERE jsonb_array_length(validation_errors) > 0),
        COALESCE(sum(net_amount_dzd) FILTER (
            WHERE transaction_type = 'SALE' AND review_status <> 'REJECTED'
        ), 0),
        COALESCE(sum(net_amount_dzd) FILTER (
            WHERE transaction_type = 'PURCHASE' AND review_status <> 'REJECTED'
        ), 0),
        COALESCE(sum(net_amount_dzd) FILTER (
            WHERE transaction_type IN ('EXPENSE', 'SALARY', 'TAX_PAYMENT')
              AND review_status <> 'REJECTED'
        ), 0),
        COALESCE(sum(net_amount_dzd) FILTER (
            WHERE transaction_type = 'OTHER_INCOME' AND review_status <> 'REJECTED'
        ), 0),
        COALESCE(sum(net_amount_dzd) FILTER (
            WHERE transaction_type = 'CUSTOMER_REFUND' AND review_status <> 'REJECTED'
        ), 0),
        COALESCE(sum(net_amount_dzd) FILTER (
            WHERE transaction_type = 'SUPPLIER_REFUND' AND review_status <> 'REJECTED'
        ), 0)
    INTO
        v_row_count,
        v_invalid_count,
        v_sales,
        v_purchases,
        v_expenses,
        v_other_income,
        v_customer_refunds,
        v_supplier_refunds
    FROM onboarding.historical_finance_rows
    WHERE batch_id = p_batch_id;

    SELECT v_invalid_count + count(*) FILTER (
        WHERE jsonb_array_length(validation_errors) > 0
    )
    INTO v_invalid_count
    FROM onboarding.historical_finance_balances
    WHERE batch_id = p_batch_id;

    IF v_row_count = 0 THEN
        v_invalid_count := v_invalid_count + 1;
    END IF;

    v_status := CASE WHEN v_invalid_count = 0 THEN 'VALIDATED' ELSE 'NEEDS_REVIEW' END;

    UPDATE onboarding.historical_finance_batches
    SET status = v_status,
        validated_at = now(),
        row_count = v_row_count,
        invalid_row_count = v_invalid_count,
        total_sales_dzd = v_sales,
        total_purchases_dzd = v_purchases,
        total_expenses_dzd = v_expenses,
        total_other_income_dzd = v_other_income,
        total_customer_refunds_dzd = v_customer_refunds,
        total_supplier_refunds_dzd = v_supplier_refunds
    WHERE id = p_batch_id;

    INSERT INTO onboarding.historical_finance_audit (
        batch_id,
        action_code,
        actor_id,
        workstation_id,
        from_status,
        to_status,
        reason
    ) VALUES (
        p_batch_id,
        'VALIDATED',
        v_actor_id,
        v_workstation_id,
        v_batch.status,
        v_status,
        format('%s rows, %s validation issues', v_row_count, v_invalid_count)
    );

    RETURN jsonb_build_object(
        'batchId', p_batch_id,
        'status', v_status,
        'rowCount', v_row_count,
        'invalidRowCount', v_invalid_count,
        'totalSalesDzd', v_sales,
        'totalPurchasesDzd', v_purchases,
        'totalExpensesDzd', v_expenses,
        'totalOtherIncomeDzd', v_other_income,
        'totalCustomerRefundsDzd', v_customer_refunds,
        'totalSupplierRefundsDzd', v_supplier_refunds,
        'preliminaryResultBeforeInventoryDzd',
            v_sales + v_other_income + v_supplier_refunds
            - v_customer_refunds - v_purchases - v_expenses
    );
END;
$$;

CREATE FUNCTION onboarding.approve_historical_finance_batch(
    p_session_token text,
    p_batch_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_actor_id bigint;
    v_workstation_id text;
    v_batch onboarding.historical_finance_batches%ROWTYPE;
BEGIN
    SELECT user_id, workstation_id
    INTO v_actor_id, v_workstation_id
    FROM iam.resolve_session_with_permission(
        p_session_token,
        'REVIEW_HISTORICAL_FINANCE_IMPORT'
    );

    SELECT *
    INTO v_batch
    FROM onboarding.historical_finance_batches
    WHERE id = p_batch_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'unknown historical finance batch' USING ERRCODE = '22023';
    END IF;
    IF v_batch.status = 'APPROVED_FOR_REPORTING' THEN
        RETURN jsonb_build_object(
            'batchId', v_batch.id,
            'status', v_batch.status,
            'isReplay', true
        );
    END IF;
    IF v_batch.status <> 'VALIDATED' OR v_batch.invalid_row_count <> 0 THEN
        RAISE EXCEPTION 'only a fully validated historical finance batch can be approved'
            USING ERRCODE = '55000';
    END IF;

    UPDATE onboarding.historical_finance_rows
    SET review_status = 'APPROVED'
    WHERE batch_id = p_batch_id
      AND review_status = 'READY';

    UPDATE onboarding.historical_finance_balances
    SET review_status = 'APPROVED'
    WHERE batch_id = p_batch_id
      AND review_status = 'READY';

    UPDATE onboarding.historical_finance_batches
    SET status = 'APPROVED_FOR_REPORTING',
        approved_by = v_actor_id,
        approved_at = now()
    WHERE id = p_batch_id;

    INSERT INTO onboarding.historical_finance_audit (
        batch_id,
        action_code,
        actor_id,
        workstation_id,
        from_status,
        to_status
    ) VALUES (
        p_batch_id,
        'APPROVED',
        v_actor_id,
        v_workstation_id,
        v_batch.status,
        'APPROVED_FOR_REPORTING'
    );

    RETURN jsonb_build_object(
        'batchId', p_batch_id,
        'status', 'APPROVED_FOR_REPORTING',
        'isReplay', false
    );
END;
$$;

CREATE FUNCTION onboarding.get_historical_finance_summary(
    p_session_token text,
    p_date_from date,
    p_date_to date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_sales bigint;
    v_purchases bigint;
    v_expenses bigint;
    v_other_income bigint;
    v_customer_refunds bigint;
    v_supplier_refunds bigint;
    v_opening_inventory bigint;
    v_closing_inventory bigint;
    v_inventory_complete boolean;
    v_preliminary bigint;
    v_profit bigint;
BEGIN
    PERFORM 1
    FROM iam.resolve_session_with_permission(
        p_session_token,
        'REVIEW_HISTORICAL_FINANCE_IMPORT'
    );

    IF p_date_from IS NULL OR p_date_to IS NULL OR p_date_from > p_date_to THEN
        RAISE EXCEPTION 'invalid historical finance report period' USING ERRCODE = '22023';
    END IF;

    SELECT
        COALESCE(sum(r.net_amount_dzd) FILTER (WHERE r.transaction_type = 'SALE'), 0),
        COALESCE(sum(r.net_amount_dzd) FILTER (WHERE r.transaction_type = 'PURCHASE'), 0),
        COALESCE(sum(r.net_amount_dzd) FILTER (
            WHERE r.transaction_type IN ('EXPENSE', 'SALARY', 'TAX_PAYMENT')
        ), 0),
        COALESCE(sum(r.net_amount_dzd) FILTER (WHERE r.transaction_type = 'OTHER_INCOME'), 0),
        COALESCE(sum(r.net_amount_dzd) FILTER (WHERE r.transaction_type = 'CUSTOMER_REFUND'), 0),
        COALESCE(sum(r.net_amount_dzd) FILTER (WHERE r.transaction_type = 'SUPPLIER_REFUND'), 0)
    INTO
        v_sales,
        v_purchases,
        v_expenses,
        v_other_income,
        v_customer_refunds,
        v_supplier_refunds
    FROM onboarding.historical_finance_rows r
    JOIN onboarding.historical_finance_batches b ON b.id = r.batch_id
    WHERE b.status = 'APPROVED_FOR_REPORTING'
      AND r.review_status = 'APPROVED'
      AND r.transaction_date BETWEEN p_date_from AND p_date_to;

    SELECT amount_dzd
    INTO v_opening_inventory
    FROM onboarding.historical_finance_balances hb
    JOIN onboarding.historical_finance_batches b ON b.id = hb.batch_id
    WHERE b.status = 'APPROVED_FOR_REPORTING'
      AND hb.review_status = 'APPROVED'
      AND hb.balance_type = 'OPENING_INVENTORY_VALUE'
      AND hb.balance_date <= p_date_from
    ORDER BY hb.balance_date DESC, hb.id DESC
    LIMIT 1;

    SELECT amount_dzd
    INTO v_closing_inventory
    FROM onboarding.historical_finance_balances hb
    JOIN onboarding.historical_finance_batches b ON b.id = hb.batch_id
    WHERE b.status = 'APPROVED_FOR_REPORTING'
      AND hb.review_status = 'APPROVED'
      AND hb.balance_type = 'CLOSING_INVENTORY_VALUE'
      AND hb.balance_date >= p_date_to
    ORDER BY hb.balance_date ASC, hb.id ASC
    LIMIT 1;

    v_preliminary := v_sales + v_other_income + v_supplier_refunds
        - v_customer_refunds - v_purchases - v_expenses;
    v_inventory_complete := v_opening_inventory IS NOT NULL AND v_closing_inventory IS NOT NULL;
    v_profit := CASE WHEN v_inventory_complete THEN
        v_sales + v_other_income + v_supplier_refunds
        - v_customer_refunds
        - (v_opening_inventory + v_purchases - v_supplier_refunds - v_closing_inventory)
        - v_expenses
        ELSE NULL
    END;

    RETURN jsonb_build_object(
        'dateFrom', p_date_from,
        'dateTo', p_date_to,
        'salesDzd', v_sales,
        'purchasesDzd', v_purchases,
        'expensesDzd', v_expenses,
        'otherIncomeDzd', v_other_income,
        'customerRefundsDzd', v_customer_refunds,
        'supplierRefundsDzd', v_supplier_refunds,
        'preliminaryResultBeforeInventoryDzd', v_preliminary,
        'openingInventoryDzd', v_opening_inventory,
        'closingInventoryDzd', v_closing_inventory,
        'inventoryDataComplete', v_inventory_complete,
        'estimatedProfitLossDzd', v_profit,
        'profitCalculationStatus', CASE
            WHEN v_inventory_complete THEN 'INVENTORY_ADJUSTED_ESTIMATE'
            ELSE 'INCOMPLETE_WITHOUT_OPENING_AND_CLOSING_INVENTORY'
        END
    );
END;
$$;

REVOKE ALL ON FUNCTION onboarding.get_historical_finance_setting(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION onboarding.update_historical_finance_setting(text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION onboarding.create_historical_finance_batch(text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION onboarding.replace_historical_finance_batch_data(text, bigint, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION onboarding.validate_historical_finance_batch(text, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION onboarding.approve_historical_finance_batch(text, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION onboarding.get_historical_finance_summary(text, date, date) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION onboarding.get_historical_finance_setting(text) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION onboarding.update_historical_finance_setting(text, boolean) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION onboarding.create_historical_finance_batch(text, text, text, text) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION onboarding.replace_historical_finance_batch_data(text, bigint, jsonb, jsonb) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION onboarding.validate_historical_finance_batch(text, bigint) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION onboarding.approve_historical_finance_batch(text, bigint) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION onboarding.get_historical_finance_summary(text, date, date) TO stockiha_runtime;

-- This is a real recoverable schema change, so backup metadata advances with it.
UPDATE operations.schema_state
SET migration_version = 20260804184500,
    updated_at = now()
WHERE singleton;

RESET ROLE;
