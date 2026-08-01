-- S4-003: database-authoritative drawer eligibility and bounded customer
-- payment refunds.
--
-- A customer refund in this slice is a full reversal of one posted customer
-- receivable payment. It reopens the original invoice allocations and restores
-- customer exposure append-only. It is deliberately not a product return,
-- stock restoration, quarantine decision, or customer credit note; those stay
-- in Slice 5.
SET ROLE stockiha_owner;

-- ---------------------------------------------------------------------------
-- Closed vocabularies and permissions
-- ---------------------------------------------------------------------------
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
        'ALTER TABLE iam.permissions ADD CONSTRAINT permissions_code_valid CHECK ((%s) OR code = ANY (ARRAY[%L,%L,%L]::text[]))',
        v_existing_check,
        'POST_CUSTOMER_REFUND',
        'APPROVE_CUSTOMER_REFUND',
        'MANAGE_DRAWER_POLICY'
    );

    SELECT pg_get_expr(c.conbin, c.conrelid)
    INTO v_existing_check
    FROM pg_constraint c
    WHERE c.conrelid = 'core.business_documents'::regclass
      AND c.conname = 'business_documents_type_valid'
      AND c.contype = 'c';
    IF v_existing_check IS NULL THEN
        RAISE EXCEPTION 'expected core.business_documents constraint business_documents_type_valid is missing';
    END IF;
    ALTER TABLE core.business_documents DROP CONSTRAINT business_documents_type_valid;
    EXECUTE format(
        'ALTER TABLE core.business_documents ADD CONSTRAINT business_documents_type_valid CHECK ((%s) OR document_type = %L)',
        v_existing_check,
        'CUSTOMER_REFUND'
    );

    SELECT pg_get_expr(c.conbin, c.conrelid)
    INTO v_existing_check
    FROM pg_constraint c
    WHERE c.conrelid = 'core.document_sequences'::regclass
      AND c.conname = 'document_sequences_type_valid'
      AND c.contype = 'c';
    IF v_existing_check IS NULL THEN
        RAISE EXCEPTION 'expected core.document_sequences constraint document_sequences_type_valid is missing';
    END IF;
    ALTER TABLE core.document_sequences DROP CONSTRAINT document_sequences_type_valid;
    EXECUTE format(
        'ALTER TABLE core.document_sequences ADD CONSTRAINT document_sequences_type_valid CHECK ((%s) OR document_type = %L)',
        v_existing_check,
        'CUSTOMER_REFUND'
    );

    SELECT pg_get_expr(c.conbin, c.conrelid)
    INTO v_existing_check
    FROM pg_constraint c
    WHERE c.conrelid = 'receivables.customer_ledger_entries'::regclass
      AND c.conname = 'customer_ledger_type_valid'
      AND c.contype = 'c';
    IF v_existing_check IS NULL THEN
        RAISE EXCEPTION 'expected customer ledger type constraint is missing';
    END IF;
    ALTER TABLE receivables.customer_ledger_entries DROP CONSTRAINT customer_ledger_type_valid;
    EXECUTE format(
        'ALTER TABLE receivables.customer_ledger_entries ADD CONSTRAINT customer_ledger_type_valid CHECK ((%s) OR entry_type = %L)',
        v_existing_check,
        'PAYMENT_REFUND'
    );

    SELECT pg_get_expr(c.conbin, c.conrelid)
    INTO v_existing_check
    FROM pg_constraint c
    WHERE c.conrelid = 'cash.movements'::regclass
      AND c.conname = 'movements_movement_type_valid'
      AND c.contype = 'c';
    IF v_existing_check IS NULL THEN
        RAISE EXCEPTION 'expected cash movement type constraint is missing';
    END IF;
    ALTER TABLE cash.movements DROP CONSTRAINT movements_movement_type_valid;
    EXECUTE format(
        'ALTER TABLE cash.movements ADD CONSTRAINT movements_movement_type_valid CHECK ((%s) OR movement_type = %L)',
        v_existing_check,
        'CUSTOMER_REFUND'
    );
END;
$$;

INSERT INTO iam.permissions (code, name) VALUES
    ('POST_CUSTOMER_REFUND', 'Post a manager-authorized customer payment refund'),
    ('APPROVE_CUSTOMER_REFUND', 'Authorize an exact customer payment refund'),
    ('MANAGE_DRAWER_POLICY', 'Manage cash-drawer operation eligibility toggles')
ON CONFLICT (code) DO NOTHING;

INSERT INTO iam.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM iam.roles r
CROSS JOIN iam.permissions p
WHERE r.code IN ('CASHIER', 'MANAGER', 'ADMIN')
  AND p.code = 'POST_CUSTOMER_REFUND'
ON CONFLICT DO NOTHING;

INSERT INTO iam.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM iam.roles r
CROSS JOIN iam.permissions p
WHERE r.code IN ('MANAGER', 'ADMIN')
  AND p.code = 'APPROVE_CUSTOMER_REFUND'
ON CONFLICT DO NOTHING;

-- Drawer feature toggles are CEO/administrator controlled. They default ON.
INSERT INTO iam.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM iam.roles r
CROSS JOIN iam.permissions p
WHERE r.code = 'ADMIN'
  AND p.code = 'MANAGE_DRAWER_POLICY'
ON CONFLICT DO NOTHING;

ALTER TABLE cash.movements
    DROP CONSTRAINT movements_amount_positive,
    ADD CONSTRAINT movements_amount_direction_valid CHECK (
        (movement_type IN ('SALE', 'CUSTOMER_PAYMENT') AND amount > 0)
        OR (movement_type = 'CUSTOMER_REFUND' AND amount < 0)
    );

-- ---------------------------------------------------------------------------
-- Central drawer policy and traceability
-- ---------------------------------------------------------------------------
CREATE TABLE cash.drawer_operation_policy (
    operation_code       text PRIMARY KEY,
    movement_type        text NOT NULL,
    movement_direction   text NOT NULL,
    is_enabled           boolean NOT NULL DEFAULT true,
    description          text NOT NULL,
    updated_by_user_id   bigint REFERENCES iam.users (id),
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT drawer_operation_policy_code_not_blank CHECK (btrim(operation_code) <> ''),
    CONSTRAINT drawer_operation_policy_movement_not_blank CHECK (btrim(movement_type) <> ''),
    CONSTRAINT drawer_operation_policy_direction_valid CHECK (movement_direction IN ('IN', 'OUT')),
    CONSTRAINT drawer_operation_policy_description_not_blank CHECK (btrim(description) <> '')
);

CREATE TRIGGER drawer_operation_policy_set_updated_at
    BEFORE UPDATE ON cash.drawer_operation_policy
    FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

INSERT INTO cash.drawer_operation_policy (
    operation_code, movement_type, movement_direction, is_enabled, description
) VALUES
    ('CASH_SALE', 'SALE', 'IN', true, 'Open the drawer after a successfully posted cash sale'),
    ('CUSTOMER_CASH_PAYMENT', 'CUSTOMER_PAYMENT', 'IN', true, 'Open the drawer after a successfully posted customer cash collection'),
    ('CUSTOMER_CASH_REFUND', 'CUSTOMER_REFUND', 'OUT', true, 'Open the drawer after a successfully posted approved customer cash refund'),
    ('SUPPLIER_CASH_PAYMENT', 'SUPPLIER_PAYMENT', 'OUT', true, 'Open the drawer after a future supplier cash payment'),
    ('CASH_EXPENSE', 'CASH_EXPENSE', 'OUT', true, 'Open the drawer after a future posted cash expense'),
    ('CASH_DEPOSIT', 'CASH_DEPOSIT', 'IN', true, 'Open the drawer after a future authorized cash deposit'),
    ('CASH_WITHDRAWAL', 'CASH_WITHDRAWAL', 'OUT', true, 'Open the drawer after a future authorized cash withdrawal')
ON CONFLICT (operation_code) DO NOTHING;

ALTER TABLE cash.drawer_jobs
    ADD COLUMN operation_code text REFERENCES cash.drawer_operation_policy (operation_code),
    ADD COLUMN cash_movement_id bigint REFERENCES cash.movements (id);

CREATE UNIQUE INDEX drawer_jobs_cash_movement_unique
    ON cash.drawer_jobs (cash_movement_id)
    WHERE cash_movement_id IS NOT NULL;

CREATE FUNCTION cash.list_drawer_operation_policy(p_session_token text)
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
    SELECT user_id INTO v_user_id FROM iam.resolve_session(p_session_token);

    SELECT coalesce(jsonb_agg(
        jsonb_build_object(
            'operation_code', p.operation_code,
            'movement_type', p.movement_type,
            'movement_direction', p.movement_direction,
            'is_enabled', p.is_enabled,
            'description', p.description,
            'can_manage', EXISTS (
                SELECT 1
                FROM iam.user_roles ur
                JOIN iam.role_permissions rp ON rp.role_id = ur.role_id
                JOIN iam.permissions permission ON permission.id = rp.permission_id
                WHERE ur.user_id = v_user_id
                  AND permission.code = 'MANAGE_DRAWER_POLICY'
            )
        ) ORDER BY p.operation_code
    ), '[]'::jsonb)
    INTO v_result
    FROM cash.drawer_operation_policy p;

    RETURN v_result;
END;
$$;

CREATE FUNCTION cash.update_drawer_operation_policy(
    p_session_token text,
    p_operation_code text,
    p_enabled boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_user_id bigint;
    v_result jsonb;
BEGIN
    SELECT user_id INTO v_user_id
    FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_DRAWER_POLICY');

    UPDATE cash.drawer_operation_policy
    SET is_enabled = p_enabled,
        updated_by_user_id = v_user_id
    WHERE operation_code = upper(btrim(p_operation_code))
    RETURNING jsonb_build_object(
        'operation_code', operation_code,
        'movement_type', movement_type,
        'movement_direction', movement_direction,
        'is_enabled', is_enabled,
        'description', description,
        'can_manage', true
    ) INTO v_result;

    IF v_result IS NULL THEN
        RAISE EXCEPTION 'drawer operation policy not found' USING ERRCODE = '22023';
    END IF;

    RETURN v_result;
END;
$$;

-- Replace the Slice-1 enqueue helper with one central policy boundary. Existing
-- sale/payment posting functions keep their stable call signature; this helper
-- derives eligibility from the posted cash movement and document instead of an
-- ad-hoc caller decision.
CREATE OR REPLACE FUNCTION cash.enqueue_drawer_job(
    p_cash_session_id bigint,
    p_business_document_id bigint,
    p_idempotency_key text
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_actor_user_text text;
    v_actor_user_id bigint;
    v_actor_workstation_id text;
    v_session_status text;
    v_current_cashier_user_id bigint;
    v_session_workstation_id text;
    v_movement_id bigint;
    v_movement_type text;
    v_amount numeric(14,2);
    v_operation_code text;
    v_expected_direction text;
    v_enabled boolean;
    v_job_id bigint;
    v_existing_session bigint;
    v_existing_document bigint;
    v_existing_movement bigint;
    v_existing_operation text;
BEGIN
    IF btrim(coalesce(p_idempotency_key, '')) = '' THEN
        RAISE EXCEPTION 'drawer idempotency key is required' USING ERRCODE = '22023';
    END IF;

    SELECT m.id, m.movement_type, m.amount
    INTO v_movement_id, v_movement_type, v_amount
    FROM cash.movements m
    WHERE m.cash_session_id = p_cash_session_id
      AND m.business_document_id = p_business_document_id
    ORDER BY m.id DESC
    LIMIT 1
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'drawer pulse requires a posted cash movement' USING ERRCODE = '55000';
    END IF;

    v_operation_code := CASE v_movement_type
        WHEN 'SALE' THEN 'CASH_SALE'
        WHEN 'CUSTOMER_PAYMENT' THEN 'CUSTOMER_CASH_PAYMENT'
        WHEN 'CUSTOMER_REFUND' THEN 'CUSTOMER_CASH_REFUND'
        ELSE NULL
    END;

    IF v_operation_code IS NULL THEN
        RAISE EXCEPTION 'cash movement type is not drawer-policy integrated: %', v_movement_type
            USING ERRCODE = '55000';
    END IF;

    SELECT is_enabled, movement_direction
    INTO v_enabled, v_expected_direction
    FROM cash.drawer_operation_policy
    WHERE operation_code = v_operation_code
      AND movement_type = v_movement_type
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'drawer operation policy is missing: %', v_operation_code
            USING ERRCODE = '55000';
    END IF;

    IF (v_expected_direction = 'IN' AND v_amount <= 0)
       OR (v_expected_direction = 'OUT' AND v_amount >= 0) THEN
        RAISE EXCEPTION 'cash movement direction does not match drawer policy'
            USING ERRCODE = '55000';
    END IF;

    -- A disabled toggle suppresses only the physical pulse queue. The already
    -- posted financial movement remains authoritative.
    IF NOT v_enabled THEN
        RETURN NULL;
    END IF;

    v_actor_user_text := nullif(current_setting('stockiha.actor_user_id', true), '');
    v_actor_workstation_id := nullif(current_setting('stockiha.actor_workstation_id', true), '');

    IF v_actor_user_text IS NULL AND v_actor_workstation_id IS NULL THEN
        IF session_user = 'stockiha_runtime' THEN
            RAISE EXCEPTION 'drawer operation lacks authenticated actor context'
                USING ERRCODE = '28000';
        END IF;
    ELSE
        IF v_actor_user_text IS NULL OR v_actor_workstation_id IS NULL THEN
            RAISE EXCEPTION 'drawer operation has incomplete authenticated actor context'
                USING ERRCODE = '28000';
        END IF;
        BEGIN
            v_actor_user_id := v_actor_user_text::bigint;
        EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
            RAISE EXCEPTION 'drawer operation has invalid authenticated actor context'
                USING ERRCODE = '28000';
        END;

        SELECT status, current_cashier_user_id, workstation_id
        INTO v_session_status, v_current_cashier_user_id, v_session_workstation_id
        FROM sales.cash_sessions
        WHERE id = p_cash_session_id
        FOR SHARE;

        IF NOT FOUND OR v_session_status <> 'OPEN' THEN
            RAISE EXCEPTION 'drawer operation requires an open cash session'
                USING ERRCODE = '55000';
        END IF;
        IF v_current_cashier_user_id <> v_actor_user_id
           OR v_session_workstation_id <> v_actor_workstation_id THEN
            RAISE EXCEPTION 'drawer operation is not owned by the authenticated cashier/workstation'
                USING ERRCODE = '42501';
        END IF;
    END IF;

    INSERT INTO cash.drawer_jobs (
        cash_session_id,
        business_document_id,
        cash_movement_id,
        operation_code,
        idempotency_key
    ) VALUES (
        p_cash_session_id,
        p_business_document_id,
        v_movement_id,
        v_operation_code,
        p_idempotency_key
    )
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id INTO v_job_id;

    IF v_job_id IS NULL THEN
        SELECT id, cash_session_id, business_document_id, cash_movement_id, operation_code
        INTO v_job_id, v_existing_session, v_existing_document, v_existing_movement, v_existing_operation
        FROM cash.drawer_jobs
        WHERE idempotency_key = p_idempotency_key;

        IF v_existing_session IS DISTINCT FROM p_cash_session_id
           OR v_existing_document IS DISTINCT FROM p_business_document_id
           OR v_existing_movement IS DISTINCT FROM v_movement_id
           OR v_existing_operation IS DISTINCT FROM v_operation_code THEN
            RAISE EXCEPTION 'drawer idempotency key conflicts with another operation'
                USING ERRCODE = '23505';
        END IF;
    END IF;

    RETURN v_job_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Customer payment refund authorization and immutable posting records
-- ---------------------------------------------------------------------------
CREATE TABLE receivables.customer_refund_authorizations (
    id                         uuid PRIMARY KEY,
    source_payment_document_id bigint NOT NULL REFERENCES receivables.customer_payments (document_id),
    customer_id                bigint NOT NULL REFERENCES receivables.customers (id),
    refund_method              text NOT NULL,
    amount                     numeric(14,2) NOT NULL,
    cash_session_id            bigint REFERENCES sales.cash_sessions (id),
    authorized_cashier_user_id bigint REFERENCES iam.users (id),
    workstation_id             text NOT NULL,
    authorized_by_user_id      bigint NOT NULL REFERENCES iam.users (id),
    reason                     text NOT NULL,
    expires_at                 timestamptz NOT NULL,
    consumed_at                timestamptz,
    consumed_document_id       bigint UNIQUE REFERENCES core.business_documents (id),
    created_at                 timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT customer_refund_authorization_method_valid CHECK (refund_method IN ('CASH', 'BANK_TRANSFER')),
    CONSTRAINT customer_refund_authorization_amount_positive CHECK (amount > 0),
    CONSTRAINT customer_refund_authorization_reason_not_blank CHECK (btrim(reason) <> ''),
    CONSTRAINT customer_refund_authorization_workstation_not_blank CHECK (btrim(workstation_id) <> ''),
    CONSTRAINT customer_refund_authorization_cash_consistent CHECK (
        (refund_method = 'CASH' AND cash_session_id IS NOT NULL AND authorized_cashier_user_id IS NOT NULL)
        OR (refund_method = 'BANK_TRANSFER' AND cash_session_id IS NULL AND authorized_cashier_user_id IS NULL)
    ),
    CONSTRAINT customer_refund_authorization_consumption_consistent CHECK (
        (consumed_at IS NULL AND consumed_document_id IS NULL)
        OR (consumed_at IS NOT NULL AND consumed_document_id IS NOT NULL)
    )
);

CREATE TABLE receivables.customer_payment_refunds (
    document_id                bigint PRIMARY KEY REFERENCES core.business_documents (id),
    authorization_id           uuid NOT NULL UNIQUE REFERENCES receivables.customer_refund_authorizations (id),
    source_payment_document_id bigint NOT NULL UNIQUE REFERENCES receivables.customer_payments (document_id),
    customer_id                bigint NOT NULL REFERENCES receivables.customers (id),
    refund_method              text NOT NULL,
    amount                     numeric(14,2) NOT NULL,
    cash_session_id            bigint REFERENCES sales.cash_sessions (id),
    journal_document_id        bigint NOT NULL UNIQUE REFERENCES finance.journal_entries (document_id),
    posted_by_user_id          bigint NOT NULL REFERENCES iam.users (id),
    authorized_by_user_id      bigint NOT NULL REFERENCES iam.users (id),
    workstation_id             text NOT NULL,
    reason                     text NOT NULL,
    note                       text,
    created_at                 timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT customer_payment_refund_method_valid CHECK (refund_method IN ('CASH', 'BANK_TRANSFER')),
    CONSTRAINT customer_payment_refund_amount_positive CHECK (amount > 0),
    CONSTRAINT customer_payment_refund_reason_not_blank CHECK (btrim(reason) <> ''),
    CONSTRAINT customer_payment_refund_workstation_not_blank CHECK (btrim(workstation_id) <> ''),
    CONSTRAINT customer_payment_refund_cash_consistent CHECK (
        (refund_method = 'CASH' AND cash_session_id IS NOT NULL)
        OR (refund_method = 'BANK_TRANSFER' AND cash_session_id IS NULL)
    )
);

CREATE TABLE receivables.payment_refund_allocations (
    id                       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    refund_document_id       bigint NOT NULL REFERENCES receivables.customer_payment_refunds (document_id),
    invoice_ledger_entry_id  bigint NOT NULL REFERENCES receivables.customer_ledger_entries (id),
    amount                   numeric(14,2) NOT NULL,
    created_at               timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT payment_refund_allocation_amount_positive CHECK (amount > 0),
    CONSTRAINT payment_refund_allocation_invoice_unique UNIQUE (refund_document_id, invoice_ledger_entry_id)
);

CREATE INDEX payment_refund_allocations_invoice_idx
    ON receivables.payment_refund_allocations (invoice_ledger_entry_id);

CREATE FUNCTION receivables.forbid_customer_refund_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'posted customer refunds and refund allocations are immutable'
        USING ERRCODE = '0A000';
END;
$$;

CREATE FUNCTION receivables.guard_customer_refund_authorization_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'customer refund authorizations cannot be deleted'
            USING ERRCODE = '0A000';
    END IF;

    IF OLD.consumed_at IS NULL
       AND OLD.consumed_document_id IS NULL
       AND NEW.consumed_at IS NOT NULL
       AND NEW.consumed_document_id IS NOT NULL
       AND NEW.id = OLD.id
       AND NEW.source_payment_document_id = OLD.source_payment_document_id
       AND NEW.customer_id = OLD.customer_id
       AND NEW.refund_method = OLD.refund_method
       AND NEW.amount = OLD.amount
       AND NEW.cash_session_id IS NOT DISTINCT FROM OLD.cash_session_id
       AND NEW.authorized_cashier_user_id IS NOT DISTINCT FROM OLD.authorized_cashier_user_id
       AND NEW.workstation_id = OLD.workstation_id
       AND NEW.authorized_by_user_id = OLD.authorized_by_user_id
       AND NEW.reason = OLD.reason
       AND NEW.expires_at = OLD.expires_at
       AND NEW.created_at = OLD.created_at THEN
        RETURN NEW;
    END IF;

    RAISE EXCEPTION 'customer refund authorization is immutable except for one-time consumption'
        USING ERRCODE = '0A000';
END;
$$;

CREATE TRIGGER customer_refund_authorizations_guard_update
    BEFORE UPDATE ON receivables.customer_refund_authorizations
    FOR EACH ROW EXECUTE FUNCTION receivables.guard_customer_refund_authorization_mutation();
CREATE TRIGGER customer_refund_authorizations_guard_delete
    BEFORE DELETE ON receivables.customer_refund_authorizations
    FOR EACH ROW EXECUTE FUNCTION receivables.guard_customer_refund_authorization_mutation();
CREATE TRIGGER customer_payment_refunds_forbid_update
    BEFORE UPDATE ON receivables.customer_payment_refunds
    FOR EACH ROW EXECUTE FUNCTION receivables.forbid_customer_refund_mutation();
CREATE TRIGGER customer_payment_refunds_forbid_delete
    BEFORE DELETE ON receivables.customer_payment_refunds
    FOR EACH ROW EXECUTE FUNCTION receivables.forbid_customer_refund_mutation();
CREATE TRIGGER payment_refund_allocations_forbid_update
    BEFORE UPDATE ON receivables.payment_refund_allocations
    FOR EACH ROW EXECUTE FUNCTION receivables.forbid_customer_refund_mutation();
CREATE TRIGGER payment_refund_allocations_forbid_delete
    BEFORE DELETE ON receivables.payment_refund_allocations
    FOR EACH ROW EXECUTE FUNCTION receivables.forbid_customer_refund_mutation();

CREATE FUNCTION receivables.net_invoice_allocated_amount(p_invoice_ledger_entry_id bigint)
RETURNS numeric(14,2)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
    SELECT (
        coalesce((
            SELECT sum(pa.amount)
            FROM receivables.payment_allocations pa
            WHERE pa.invoice_ledger_entry_id = p_invoice_ledger_entry_id
        ), 0)
        - coalesce((
            SELECT sum(pra.amount)
            FROM receivables.payment_refund_allocations pra
            WHERE pra.invoice_ledger_entry_id = p_invoice_ledger_entry_id
        ), 0)
    )::numeric(14,2)
$$;

CREATE FUNCTION receivables.list_refundable_customer_payments(
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

    PERFORM 1 FROM receivables.customers WHERE id = p_customer_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'customer not found' USING ERRCODE = '22023';
    END IF;

    SELECT coalesce(jsonb_agg(
        jsonb_build_object(
            'payment_document_id', cp.document_id,
            'document_number', d.document_number,
            'document_date', d.document_date,
            'payment_method', cp.payment_method,
            'amount', cp.amount::text,
            'note', cp.note
        ) ORDER BY d.document_date DESC, cp.document_id DESC
    ), '[]'::jsonb)
    INTO v_result
    FROM receivables.customer_payments cp
    JOIN core.business_documents d ON d.id = cp.document_id
    LEFT JOIN receivables.customer_payment_refunds r
      ON r.source_payment_document_id = cp.document_id
    WHERE cp.customer_id = p_customer_id
      AND d.status = 'POSTED'
      AND r.document_id IS NULL;

    RETURN v_result;
END;
$$;

CREATE FUNCTION receivables.authorize_customer_payment_refund(
    p_session_token text,
    p_authorization_id uuid,
    p_source_payment_document_id bigint,
    p_refund_method text,
    p_cash_session_id bigint,
    p_reason text,
    p_ttl_minutes integer DEFAULT 15
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_manager_user_id bigint;
    v_workstation_id text;
    v_method text := upper(btrim(coalesce(p_refund_method, '')));
    v_customer_id bigint;
    v_amount numeric(14,2);
    v_session_status text;
    v_cashier_user_id bigint;
    v_session_workstation text;
    v_existing receivables.customer_refund_authorizations%ROWTYPE;
BEGIN
    SELECT user_id, workstation_id
    INTO v_manager_user_id, v_workstation_id
    FROM iam.resolve_session_with_permission(p_session_token, 'APPROVE_CUSTOMER_REFUND');

    IF p_authorization_id IS NULL THEN
        RAISE EXCEPTION 'refund authorization id is required' USING ERRCODE = '22023';
    END IF;
    IF v_method NOT IN ('CASH', 'BANK_TRANSFER') THEN
        RAISE EXCEPTION 'unsupported customer refund method' USING ERRCODE = '22023';
    END IF;
    IF btrim(coalesce(p_reason, '')) = '' THEN
        RAISE EXCEPTION 'refund authorization reason is required' USING ERRCODE = '22023';
    END IF;
    IF p_ttl_minutes IS NULL OR p_ttl_minutes < 1 OR p_ttl_minutes > 30 THEN
        RAISE EXCEPTION 'refund authorization lifetime must be between 1 and 30 minutes'
            USING ERRCODE = '22023';
    END IF;

    SELECT cp.customer_id, cp.amount
    INTO v_customer_id, v_amount
    FROM receivables.customer_payments cp
    JOIN core.business_documents d ON d.id = cp.document_id
    WHERE cp.document_id = p_source_payment_document_id
      AND d.status = 'POSTED'
    FOR SHARE OF cp, d;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'posted customer payment not found' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
        SELECT 1 FROM receivables.customer_payment_refunds
        WHERE source_payment_document_id = p_source_payment_document_id
    ) THEN
        RAISE EXCEPTION 'customer payment has already been refunded' USING ERRCODE = '55000';
    END IF;

    IF v_method = 'CASH' THEN
        IF p_cash_session_id IS NULL THEN
            RAISE EXCEPTION 'cash refund requires an open cash session' USING ERRCODE = '55000';
        END IF;

        SELECT status, current_cashier_user_id, workstation_id
        INTO v_session_status, v_cashier_user_id, v_session_workstation
        FROM sales.cash_sessions
        WHERE id = p_cash_session_id
        FOR SHARE;

        IF NOT FOUND OR v_session_status <> 'OPEN' THEN
            RAISE EXCEPTION 'cash refund requires an open cash session' USING ERRCODE = '55000';
        END IF;
        IF v_session_workstation <> v_workstation_id THEN
            RAISE EXCEPTION 'refund approval must occur on the cash-session workstation'
                USING ERRCODE = '42501';
        END IF;
    ELSE
        IF p_cash_session_id IS NOT NULL THEN
            RAISE EXCEPTION 'bank-transfer refund must not specify a cash session'
                USING ERRCODE = '22023';
        END IF;
        v_cashier_user_id := NULL;
    END IF;

    BEGIN
        INSERT INTO receivables.customer_refund_authorizations (
            id,
            source_payment_document_id,
            customer_id,
            refund_method,
            amount,
            cash_session_id,
            authorized_cashier_user_id,
            workstation_id,
            authorized_by_user_id,
            reason,
            expires_at
        ) VALUES (
            p_authorization_id,
            p_source_payment_document_id,
            v_customer_id,
            v_method,
            v_amount,
            CASE WHEN v_method = 'CASH' THEN p_cash_session_id ELSE NULL END,
            CASE WHEN v_method = 'CASH' THEN v_cashier_user_id ELSE NULL END,
            v_workstation_id,
            v_manager_user_id,
            btrim(p_reason),
            now() + make_interval(mins => p_ttl_minutes)
        );
    EXCEPTION WHEN unique_violation THEN
        SELECT * INTO v_existing
        FROM receivables.customer_refund_authorizations
        WHERE id = p_authorization_id;

        IF NOT FOUND
           OR v_existing.source_payment_document_id <> p_source_payment_document_id
           OR v_existing.refund_method <> v_method
           OR v_existing.cash_session_id IS DISTINCT FROM CASE WHEN v_method = 'CASH' THEN p_cash_session_id ELSE NULL END
           OR v_existing.reason <> btrim(p_reason) THEN
            RAISE EXCEPTION 'refund authorization id conflicts with another request'
                USING ERRCODE = '23505';
        END IF;
    END;

    RETURN p_authorization_id;
END;
$$;

CREATE FUNCTION receivables.post_customer_refund(
    p_session_token text,
    p_request_id uuid,
    p_authorization_id uuid,
    p_fiscal_period_id bigint,
    p_document_date date,
    p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_user_id bigint;
    v_workstation_id text;
    v_payload_hash bytea;
    v_cached_result bigint;
    v_auth receivables.customer_refund_authorizations%ROWTYPE;
    v_period_status text;
    v_period_start date;
    v_period_end date;
    v_fiscal_year integer;
    v_current_exposure numeric(14,2);
    v_session_status text;
    v_current_cashier bigint;
    v_session_workstation text;
    v_doc_id bigint;
    v_doc_seq bigint;
    v_doc_num text;
    v_journal_doc_id bigint;
    v_journal_seq bigint;
    v_journal_num text;
    v_credit_account text;
    v_original_payment_ledger_id bigint;
    v_refund_ledger_id bigint;
    v_new_exposure numeric(14,2);
    v_oldest_due date;
    v_movement_id bigint;
    v_result jsonb;
BEGIN
    SELECT user_id, workstation_id
    INTO v_user_id, v_workstation_id
    FROM iam.resolve_session_with_permission(p_session_token, 'POST_CUSTOMER_REFUND');

    IF p_request_id IS NULL OR p_authorization_id IS NULL THEN
        RAISE EXCEPTION 'refund request and authorization ids are required' USING ERRCODE = '22023';
    END IF;

    v_payload_hash := sha256(convert_to(jsonb_build_object(
        'authorization_id', p_authorization_id,
        'fiscal_period_id', p_fiscal_period_id,
        'document_date', p_document_date,
        'note', nullif(btrim(p_note), '')
    )::text, 'UTF8'));

    v_cached_result := core.reserve_idempotent_request(
        'receivables.post_customer_refund', p_request_id, v_payload_hash
    );
    IF v_cached_result IS NOT NULL THEN
        SELECT jsonb_build_object(
            'document_id', d.id,
            'document_number', d.document_number,
            'source_payment_document_id', r.source_payment_document_id,
            'customer_id', r.customer_id,
            'refund_method', r.refund_method,
            'amount', r.amount::text,
            'exposure_amount', cs.exposure_amount::text,
            'available_credit', (c.credit_limit - cs.exposure_amount)::text,
            'journal_document_id', r.journal_document_id
        ) INTO v_result
        FROM core.business_documents d
        JOIN receivables.customer_payment_refunds r ON r.document_id = d.id
        JOIN receivables.customers c ON c.id = r.customer_id
        JOIN receivables.customer_credit_state cs ON cs.customer_id = r.customer_id
        WHERE d.id = v_cached_result;
        RETURN v_result;
    END IF;

    SELECT * INTO v_auth
    FROM receivables.customer_refund_authorizations
    WHERE id = p_authorization_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'customer refund authorization not found' USING ERRCODE = '22023';
    END IF;
    IF v_auth.consumed_at IS NOT NULL THEN
        RAISE EXCEPTION 'customer refund authorization has already been consumed'
            USING ERRCODE = '55000';
    END IF;
    IF v_auth.expires_at <= now() THEN
        RAISE EXCEPTION 'customer refund authorization has expired' USING ERRCODE = '55000';
    END IF;
    IF v_auth.workstation_id <> v_workstation_id THEN
        RAISE EXCEPTION 'customer refund authorization belongs to another workstation'
            USING ERRCODE = '42501';
    END IF;

    IF EXISTS (
        SELECT 1 FROM receivables.customer_payment_refunds
        WHERE source_payment_document_id = v_auth.source_payment_document_id
    ) THEN
        RAISE EXCEPTION 'customer payment has already been refunded' USING ERRCODE = '55000';
    END IF;

    SELECT status, starts_on, ends_on, extract(year FROM starts_on)::integer
    INTO v_period_status, v_period_start, v_period_end, v_fiscal_year
    FROM finance.fiscal_periods
    WHERE id = p_fiscal_period_id
    FOR SHARE;

    IF NOT FOUND OR v_period_status <> 'OPEN' THEN
        RAISE EXCEPTION 'fiscal period is not open' USING ERRCODE = '55000';
    END IF;
    IF p_document_date < v_period_start OR p_document_date > v_period_end THEN
        RAISE EXCEPTION 'document date is outside fiscal period' USING ERRCODE = '22023';
    END IF;

    SELECT exposure_amount
    INTO v_current_exposure
    FROM receivables.customer_credit_state
    WHERE customer_id = v_auth.customer_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'customer credit state not found' USING ERRCODE = '22023';
    END IF;

    IF v_auth.refund_method = 'CASH' THEN
        IF v_auth.authorized_cashier_user_id <> v_user_id THEN
            RAISE EXCEPTION 'cash refund authorization is bound to another cashier'
                USING ERRCODE = '42501';
        END IF;

        SELECT status, current_cashier_user_id, workstation_id
        INTO v_session_status, v_current_cashier, v_session_workstation
        FROM sales.cash_sessions
        WHERE id = v_auth.cash_session_id
        FOR UPDATE;

        IF NOT FOUND OR v_session_status <> 'OPEN' THEN
            RAISE EXCEPTION 'cash refund requires the authorized open cash session'
                USING ERRCODE = '55000';
        END IF;
        IF v_current_cashier <> v_user_id OR v_session_workstation <> v_workstation_id THEN
            RAISE EXCEPTION 'cash refund session is not owned by the authorized cashier/workstation'
                USING ERRCODE = '42501';
        END IF;
    END IF;

    PERFORM 1
    FROM receivables.customer_payments cp
    WHERE cp.document_id = v_auth.source_payment_document_id
      AND cp.customer_id = v_auth.customer_id
      AND cp.amount = v_auth.amount
    FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'source customer payment no longer matches authorization'
            USING ERRCODE = '55000';
    END IF;

    SELECT id INTO v_original_payment_ledger_id
    FROM receivables.customer_ledger_entries
    WHERE document_id = v_auth.source_payment_document_id
      AND customer_id = v_auth.customer_id
      AND entry_type = 'PAYMENT';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'source customer payment ledger entry not found' USING ERRCODE = '55000';
    END IF;

    v_doc_seq := core.claim_next_document_number('CUSTOMER_REFUND', v_fiscal_year);
    v_doc_num := 'RF-' || v_fiscal_year::text || '-' || lpad(v_doc_seq::text, 6, '0');
    INSERT INTO core.business_documents (
        document_type, status, document_date, fiscal_period_id, fiscal_year,
        sequence_number, document_number, posted_at
    ) VALUES (
        'CUSTOMER_REFUND', 'POSTED', p_document_date, p_fiscal_period_id, v_fiscal_year,
        v_doc_seq, v_doc_num, now()
    ) RETURNING id INTO v_doc_id;

    v_journal_seq := core.claim_next_document_number('JOURNAL_ENTRY', v_fiscal_year);
    v_journal_num := 'JE-' || v_fiscal_year::text || '-' || lpad(v_journal_seq::text, 6, '0');
    INSERT INTO core.business_documents (
        document_type, status, document_date, fiscal_period_id, fiscal_year,
        sequence_number, document_number, posted_at
    ) VALUES (
        'JOURNAL_ENTRY', 'POSTED', p_document_date, p_fiscal_period_id, v_fiscal_year,
        v_journal_seq, v_journal_num, now()
    ) RETURNING id INTO v_journal_doc_id;

    INSERT INTO finance.journal_entries (document_id, description, source_type, source_id)
    VALUES (v_journal_doc_id, 'Customer payment refund', 'CUSTOMER_REFUND', v_doc_id);

    v_credit_account := CASE
        WHEN v_auth.refund_method = 'CASH' THEN 'CASH_DESK'
        ELSE 'BANK_ACCOUNT'
    END;
    INSERT INTO finance.journal_lines (document_id, line_number, account_code, debit, credit) VALUES
        (v_journal_doc_id, 1, 'ACCOUNTS_RECEIVABLE', v_auth.amount, 0),
        (v_journal_doc_id, 2, v_credit_account, 0, v_auth.amount);

    INSERT INTO receivables.customer_payment_refunds (
        document_id,
        authorization_id,
        source_payment_document_id,
        customer_id,
        refund_method,
        amount,
        cash_session_id,
        journal_document_id,
        posted_by_user_id,
        authorized_by_user_id,
        workstation_id,
        reason,
        note
    ) VALUES (
        v_doc_id,
        v_auth.id,
        v_auth.source_payment_document_id,
        v_auth.customer_id,
        v_auth.refund_method,
        v_auth.amount,
        v_auth.cash_session_id,
        v_journal_doc_id,
        v_user_id,
        v_auth.authorized_by_user_id,
        v_workstation_id,
        v_auth.reason,
        nullif(btrim(p_note), '')
    );

    INSERT INTO receivables.payment_refund_allocations (
        refund_document_id, invoice_ledger_entry_id, amount
    )
    SELECT v_doc_id, pa.invoice_ledger_entry_id, pa.amount
    FROM receivables.payment_allocations pa
    WHERE pa.payment_document_id = v_auth.source_payment_document_id;

    INSERT INTO receivables.customer_ledger_entries (
        customer_id,
        entry_type,
        amount_delta,
        document_id,
        related_entry_id,
        posted_by_user_id,
        workstation_id
    ) VALUES (
        v_auth.customer_id,
        'PAYMENT_REFUND',
        v_auth.amount,
        v_doc_id,
        v_original_payment_ledger_id,
        v_user_id,
        v_workstation_id
    ) RETURNING id INTO v_refund_ledger_id;

    v_new_exposure := v_current_exposure + v_auth.amount;

    SELECT min(l.due_date)
    INTO v_oldest_due
    FROM receivables.customer_ledger_entries l
    WHERE l.customer_id = v_auth.customer_id
      AND l.entry_type = 'CREDIT_INVOICE'
      AND l.due_date IS NOT NULL
      AND l.amount_delta > receivables.net_invoice_allocated_amount(l.id);

    UPDATE receivables.customer_credit_state
    SET exposure_amount = v_new_exposure,
        oldest_open_due_date = v_oldest_due,
        last_rebuilt_at = now()
    WHERE customer_id = v_auth.customer_id;

    IF v_auth.refund_method = 'CASH' THEN
        INSERT INTO cash.movements (
            cash_session_id, business_document_id, movement_type, amount
        ) VALUES (
            v_auth.cash_session_id, v_doc_id, 'CUSTOMER_REFUND', -v_auth.amount
        ) RETURNING id INTO v_movement_id;

        PERFORM cash.enqueue_drawer_job(
            v_auth.cash_session_id,
            v_doc_id,
            'customer_refund:' || v_doc_id::text
        );
    END IF;

    UPDATE receivables.customer_refund_authorizations
    SET consumed_at = now(), consumed_document_id = v_doc_id
    WHERE id = v_auth.id;

    PERFORM core.record_idempotent_result(
        'receivables.post_customer_refund', p_request_id, v_doc_id
    );

    RETURN jsonb_build_object(
        'document_id', v_doc_id,
        'document_number', v_doc_num,
        'source_payment_document_id', v_auth.source_payment_document_id,
        'customer_id', v_auth.customer_id,
        'refund_method', v_auth.refund_method,
        'amount', v_auth.amount::text,
        'exposure_amount', v_new_exposure::text,
        'available_credit', (
            (SELECT credit_limit FROM receivables.customers WHERE id = v_auth.customer_id)
            - v_new_exposure
        )::text,
        'journal_document_id', v_journal_doc_id,
        'refund_ledger_entry_id', v_refund_ledger_id
    );
END;
$$;

-- ---------------------------------------------------------------------------
-- Existing receivables functions upgraded for net allocations/refunds
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION receivables.list_open_customer_invoices(
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

    PERFORM 1 FROM receivables.customers WHERE id = p_customer_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'customer not found' USING ERRCODE = '22023';
    END IF;

    SELECT coalesce(jsonb_agg(
        jsonb_build_object(
            'invoice_ledger_entry_id', rows.invoice_ledger_entry_id,
            'document_id', rows.document_id,
            'document_number', rows.document_number,
            'document_date', rows.document_date,
            'due_date', rows.due_date,
            'original_amount', rows.original_amount::text,
            'allocated_amount', rows.allocated_amount::text,
            'remaining_amount', rows.remaining_amount::text
        ) ORDER BY rows.due_date NULLS LAST, rows.document_date, rows.invoice_ledger_entry_id
    ), '[]'::jsonb)
    INTO v_result
    FROM (
        SELECT
            l.id AS invoice_ledger_entry_id,
            l.document_id,
            d.document_number,
            d.document_date,
            l.due_date,
            l.amount_delta AS original_amount,
            receivables.net_invoice_allocated_amount(l.id) AS allocated_amount,
            (l.amount_delta - receivables.net_invoice_allocated_amount(l.id))::numeric(14,2)
                AS remaining_amount
        FROM receivables.customer_ledger_entries l
        LEFT JOIN core.business_documents d ON d.id = l.document_id
        WHERE l.customer_id = p_customer_id
          AND l.entry_type = 'CREDIT_INVOICE'
          AND l.amount_delta - receivables.net_invoice_allocated_amount(l.id) > 0
    ) rows;

    RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION receivables.reconcile_customer_credit_state(
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
    v_cached_exposure numeric(14,2);
    v_cached_oldest_due date;
    v_ledger_exposure numeric(14,2);
    v_computed_oldest_due date;
BEGIN
    SELECT user_id INTO v_user_id
    FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_CUSTOMERS');

    SELECT exposure_amount, oldest_open_due_date
    INTO v_cached_exposure, v_cached_oldest_due
    FROM receivables.customer_credit_state
    WHERE customer_id = p_customer_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'customer credit state not found' USING ERRCODE = '22023';
    END IF;

    SELECT coalesce(sum(l.amount_delta), 0)::numeric(14,2)
    INTO v_ledger_exposure
    FROM receivables.customer_ledger_entries l
    WHERE l.customer_id = p_customer_id;

    SELECT min(l.due_date)
    INTO v_computed_oldest_due
    FROM receivables.customer_ledger_entries l
    WHERE l.customer_id = p_customer_id
      AND l.entry_type = 'CREDIT_INVOICE'
      AND l.due_date IS NOT NULL
      AND l.amount_delta > receivables.net_invoice_allocated_amount(l.id);

    RETURN jsonb_build_object(
        'customer_id', p_customer_id,
        'cached_exposure', v_cached_exposure::text,
        'ledger_exposure', v_ledger_exposure::text,
        'exposure_matches', v_cached_exposure = v_ledger_exposure,
        'cached_oldest_open_due_date', v_cached_oldest_due,
        'computed_oldest_open_due_date', v_computed_oldest_due,
        'oldest_due_matches', v_cached_oldest_due IS NOT DISTINCT FROM v_computed_oldest_due,
        'reconciled',
            v_cached_exposure = v_ledger_exposure
            AND v_cached_oldest_due IS NOT DISTINCT FROM v_computed_oldest_due
    );
END;
$$;

CREATE OR REPLACE FUNCTION receivables.get_customer_capabilities(p_session_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_user_id bigint;
BEGIN
    SELECT user_id INTO v_user_id FROM iam.resolve_session(p_session_token);

    RETURN jsonb_build_object(
        'can_view_customers', EXISTS (
            SELECT 1 FROM iam.user_roles ur
            JOIN iam.role_permissions rp ON rp.role_id = ur.role_id
            JOIN iam.permissions p ON p.id = rp.permission_id
            WHERE ur.user_id = v_user_id AND p.code = 'VIEW_CUSTOMERS'
        ),
        'can_manage_customers', EXISTS (
            SELECT 1 FROM iam.user_roles ur
            JOIN iam.role_permissions rp ON rp.role_id = ur.role_id
            JOIN iam.permissions p ON p.id = rp.permission_id
            WHERE ur.user_id = v_user_id AND p.code = 'MANAGE_CUSTOMERS'
        ),
        'can_post_credit_sale', EXISTS (
            SELECT 1 FROM iam.user_roles ur
            JOIN iam.role_permissions rp ON rp.role_id = ur.role_id
            JOIN iam.permissions p ON p.id = rp.permission_id
            WHERE ur.user_id = v_user_id AND p.code = 'POST_CREDIT_SALE'
        ),
        'can_post_customer_payment', EXISTS (
            SELECT 1 FROM iam.user_roles ur
            JOIN iam.role_permissions rp ON rp.role_id = ur.role_id
            JOIN iam.permissions p ON p.id = rp.permission_id
            WHERE ur.user_id = v_user_id AND p.code = 'POST_CUSTOMER_PAYMENT'
        ),
        'can_post_customer_refund', EXISTS (
            SELECT 1 FROM iam.user_roles ur
            JOIN iam.role_permissions rp ON rp.role_id = ur.role_id
            JOIN iam.permissions p ON p.id = rp.permission_id
            WHERE ur.user_id = v_user_id AND p.code = 'POST_CUSTOMER_REFUND'
        ),
        'can_manage_drawer_policy', EXISTS (
            SELECT 1 FROM iam.user_roles ur
            JOIN iam.role_permissions rp ON rp.role_id = ur.role_id
            JOIN iam.permissions p ON p.id = rp.permission_id
            WHERE ur.user_id = v_user_id AND p.code = 'MANAGE_DRAWER_POLICY'
        ),
        'can_override_credit_limit', EXISTS (
            SELECT 1 FROM iam.user_roles ur
            JOIN iam.role_permissions rp ON rp.role_id = ur.role_id
            JOIN iam.permissions p ON p.id = rp.permission_id
            WHERE ur.user_id = v_user_id AND p.code = 'OVERRIDE_CREDIT_LIMIT'
        )
    );
END;
$$;

-- Recreate the payment posting boundary with net-allocation awareness and an
-- explicit current-cashier check before the cash movement trigger.
CREATE OR REPLACE FUNCTION receivables.post_customer_payment(
    p_session_token text,
    p_request_id uuid,
    p_customer_id bigint,
    p_amount numeric(14,2),
    p_payment_method text,
    p_cash_session_id bigint,
    p_fiscal_period_id bigint,
    p_document_date date,
    p_allocations jsonb,
    p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_user_id bigint;
    v_workstation_id text;
    v_method text := upper(coalesce(nullif(btrim(p_payment_method), ''), 'CASH'));
    v_canonical_allocations jsonb;
    v_payload_hash bytea;
    v_cached_result bigint;
    v_period_status text;
    v_period_start date;
    v_period_end date;
    v_fiscal_year integer;
    v_customer_active boolean;
    v_exposure numeric(14,2);
    v_alloc jsonb;
    v_invoice_entry_id bigint;
    v_alloc_amount numeric(14,2);
    v_allocation_sum numeric(14,2) := 0;
    v_invoice_customer_id bigint;
    v_invoice_amount numeric(14,2);
    v_already_allocated numeric(14,2);
    v_doc_id bigint;
    v_doc_seq bigint;
    v_doc_num text;
    v_journal_doc_id bigint;
    v_journal_seq bigint;
    v_journal_num text;
    v_debit_account text;
    v_payment_ledger_id bigint;
    v_new_exposure numeric(14,2);
    v_oldest_due date;
    v_result jsonb;
    v_session_status text;
    v_current_cashier bigint;
    v_session_workstation text;
BEGIN
    SELECT user_id, workstation_id
    INTO v_user_id, v_workstation_id
    FROM iam.resolve_session_with_permission(p_session_token, 'POST_CUSTOMER_PAYMENT');

    IF p_customer_id IS NULL OR p_customer_id <= 0 THEN
        RAISE EXCEPTION 'customer is required' USING ERRCODE = '22023';
    END IF;
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'payment amount must be positive' USING ERRCODE = '22023';
    END IF;
    IF v_method NOT IN ('CASH', 'BANK_TRANSFER') THEN
        RAISE EXCEPTION 'unsupported customer payment method' USING ERRCODE = '22023';
    END IF;
    IF p_allocations IS NULL OR jsonb_typeof(p_allocations) <> 'array' OR jsonb_array_length(p_allocations) = 0 THEN
        RAISE EXCEPTION 'customer payment requires at least one invoice allocation' USING ERRCODE = '22023';
    END IF;

    BEGIN
        SELECT jsonb_agg(
                   jsonb_build_object(
                       'invoice_ledger_entry_id', invoice_ledger_entry_id,
                       'amount', trim_scale(amount)
                   ) ORDER BY invoice_ledger_entry_id
               )
        INTO v_canonical_allocations
        FROM (
            SELECT
                nullif(elem ->> 'invoice_ledger_entry_id', '')::bigint AS invoice_ledger_entry_id,
                sum(nullif(elem ->> 'amount', '')::numeric) AS amount
            FROM jsonb_array_elements(p_allocations) elem
            GROUP BY nullif(elem ->> 'invoice_ledger_entry_id', '')::bigint
        ) normalized
        WHERE invoice_ledger_entry_id IS NOT NULL
          AND amount IS NOT NULL;
    EXCEPTION
        WHEN invalid_text_representation OR numeric_value_out_of_range THEN
            RAISE EXCEPTION 'invalid customer payment allocation' USING ERRCODE = '22023';
    END;

    IF v_canonical_allocations IS NULL
       OR jsonb_array_length(v_canonical_allocations) = 0
       OR EXISTS (
           SELECT 1 FROM jsonb_array_elements(v_canonical_allocations) elem
           WHERE (elem ->> 'amount')::numeric <= 0
              OR (elem ->> 'invoice_ledger_entry_id')::bigint <= 0
       ) THEN
        RAISE EXCEPTION 'invalid customer payment allocation' USING ERRCODE = '22023';
    END IF;

    v_payload_hash := sha256(convert_to(jsonb_build_object(
        'customer_id', p_customer_id,
        'amount', trim_scale(p_amount),
        'payment_method', v_method,
        'cash_session_id', p_cash_session_id,
        'fiscal_period_id', p_fiscal_period_id,
        'document_date', p_document_date,
        'allocations', v_canonical_allocations,
        'note', nullif(btrim(p_note), '')
    )::text, 'UTF8'));

    v_cached_result := core.reserve_idempotent_request(
        'receivables.post_customer_payment', p_request_id, v_payload_hash
    );
    IF v_cached_result IS NOT NULL THEN
        SELECT jsonb_build_object(
            'document_id', d.id,
            'document_number', d.document_number,
            'customer_id', cp.customer_id,
            'payment_method', cp.payment_method,
            'amount', cp.amount::text,
            'exposure_amount', cs.exposure_amount::text,
            'available_credit', (c.credit_limit - cs.exposure_amount)::text,
            'journal_document_id', cp.journal_document_id,
            'payment_ledger_entry_id', l.id
        ) INTO v_result
        FROM core.business_documents d
        JOIN receivables.customer_payments cp ON cp.document_id = d.id
        JOIN receivables.customers c ON c.id = cp.customer_id
        JOIN receivables.customer_credit_state cs ON cs.customer_id = c.id
        JOIN receivables.customer_ledger_entries l
          ON l.document_id = d.id AND l.entry_type = 'PAYMENT'
        WHERE d.id = v_cached_result;
        RETURN v_result;
    END IF;

    SELECT status, starts_on, ends_on, extract(year FROM starts_on)::integer
    INTO v_period_status, v_period_start, v_period_end, v_fiscal_year
    FROM finance.fiscal_periods
    WHERE id = p_fiscal_period_id
    FOR SHARE;
    IF NOT FOUND OR v_period_status <> 'OPEN' THEN
        RAISE EXCEPTION 'fiscal period is not open' USING ERRCODE = '55000';
    END IF;
    IF p_document_date < v_period_start OR p_document_date > v_period_end THEN
        RAISE EXCEPTION 'document date is outside fiscal period' USING ERRCODE = '22023';
    END IF;

    SELECT c.is_active, cs.exposure_amount
    INTO v_customer_active, v_exposure
    FROM receivables.customers c
    JOIN receivables.customer_credit_state cs ON cs.customer_id = c.id
    WHERE c.id = p_customer_id
    FOR UPDATE OF c, cs;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'customer not found' USING ERRCODE = '22023';
    END IF;
    IF NOT v_customer_active THEN
        RAISE EXCEPTION 'customer is inactive' USING ERRCODE = '55000';
    END IF;
    IF p_amount > v_exposure THEN
        RAISE EXCEPTION 'payment exceeds customer exposure' USING ERRCODE = '55000';
    END IF;

    IF v_method = 'CASH' THEN
        IF p_cash_session_id IS NULL THEN
            RAISE EXCEPTION 'cash payment requires an active cash session' USING ERRCODE = '55000';
        END IF;
        SELECT status, current_cashier_user_id, workstation_id
        INTO v_session_status, v_current_cashier, v_session_workstation
        FROM sales.cash_sessions
        WHERE id = p_cash_session_id
        FOR UPDATE;
        IF NOT FOUND OR v_session_status <> 'OPEN' THEN
            RAISE EXCEPTION 'cash session is not open' USING ERRCODE = '55000';
        END IF;
        IF v_current_cashier <> v_user_id OR v_session_workstation <> v_workstation_id THEN
            RAISE EXCEPTION 'cash session is not owned by the authenticated cashier/workstation'
                USING ERRCODE = '42501';
        END IF;
    ELSIF p_cash_session_id IS NOT NULL THEN
        RAISE EXCEPTION 'non-cash payment must not specify a cash session' USING ERRCODE = '22023';
    END IF;

    PERFORM 1
    FROM receivables.customer_ledger_entries l
    WHERE l.id IN (
        SELECT (elem ->> 'invoice_ledger_entry_id')::bigint
        FROM jsonb_array_elements(v_canonical_allocations) elem
    )
    ORDER BY l.id
    FOR UPDATE;

    FOR v_alloc IN SELECT * FROM jsonb_array_elements(v_canonical_allocations)
    LOOP
        v_invoice_entry_id := (v_alloc ->> 'invoice_ledger_entry_id')::bigint;
        v_alloc_amount := (v_alloc ->> 'amount')::numeric;

        SELECT l.customer_id, l.amount_delta
        INTO v_invoice_customer_id, v_invoice_amount
        FROM receivables.customer_ledger_entries l
        WHERE l.id = v_invoice_entry_id
          AND l.entry_type = 'CREDIT_INVOICE';

        IF NOT FOUND THEN
            RAISE EXCEPTION 'allocated invoice ledger entry not found' USING ERRCODE = '55000';
        END IF;
        IF v_invoice_customer_id <> p_customer_id THEN
            RAISE EXCEPTION 'payment allocation cannot cross customers' USING ERRCODE = '55000';
        END IF;

        v_already_allocated := receivables.net_invoice_allocated_amount(v_invoice_entry_id);
        IF v_already_allocated + v_alloc_amount > v_invoice_amount THEN
            RAISE EXCEPTION 'payment allocation exceeds invoice remaining amount' USING ERRCODE = '55000';
        END IF;
        v_allocation_sum := v_allocation_sum + v_alloc_amount;
    END LOOP;

    IF v_allocation_sum <> p_amount THEN
        RAISE EXCEPTION 'payment allocations must equal payment amount' USING ERRCODE = '55000';
    END IF;

    v_doc_seq := core.claim_next_document_number('CUSTOMER_PAYMENT', v_fiscal_year);
    v_doc_num := 'CP-' || v_fiscal_year::text || '-' || lpad(v_doc_seq::text, 6, '0');
    INSERT INTO core.business_documents (
        document_type, status, document_date, fiscal_period_id, fiscal_year,
        sequence_number, document_number, posted_at
    ) VALUES (
        'CUSTOMER_PAYMENT', 'POSTED', p_document_date, p_fiscal_period_id, v_fiscal_year,
        v_doc_seq, v_doc_num, now()
    ) RETURNING id INTO v_doc_id;

    v_journal_seq := core.claim_next_document_number('JOURNAL_ENTRY', v_fiscal_year);
    v_journal_num := 'JE-' || v_fiscal_year::text || '-' || lpad(v_journal_seq::text, 6, '0');
    INSERT INTO core.business_documents (
        document_type, status, document_date, fiscal_period_id, fiscal_year,
        sequence_number, document_number, posted_at
    ) VALUES (
        'JOURNAL_ENTRY', 'POSTED', p_document_date, p_fiscal_period_id, v_fiscal_year,
        v_journal_seq, v_journal_num, now()
    ) RETURNING id INTO v_journal_doc_id;

    INSERT INTO finance.journal_entries (document_id, description, source_type, source_id)
    VALUES (v_journal_doc_id, 'Customer receivable payment', 'CUSTOMER_PAYMENT', v_doc_id);

    v_debit_account := CASE WHEN v_method = 'CASH' THEN 'CASH_DESK' ELSE 'BANK_ACCOUNT' END;
    INSERT INTO finance.journal_lines (document_id, line_number, account_code, debit, credit) VALUES
        (v_journal_doc_id, 1, v_debit_account, p_amount, 0),
        (v_journal_doc_id, 2, 'ACCOUNTS_RECEIVABLE', 0, p_amount);

    INSERT INTO receivables.customer_payments (
        document_id, customer_id, payment_method, amount, cash_session_id,
        journal_document_id, posted_by_user_id, workstation_id, note
    ) VALUES (
        v_doc_id, p_customer_id, v_method, p_amount,
        CASE WHEN v_method = 'CASH' THEN p_cash_session_id ELSE NULL END,
        v_journal_doc_id, v_user_id, v_workstation_id, nullif(btrim(p_note), '')
    );

    INSERT INTO receivables.customer_ledger_entries (
        customer_id, entry_type, amount_delta, document_id,
        posted_by_user_id, workstation_id
    ) VALUES (
        p_customer_id, 'PAYMENT', -p_amount, v_doc_id,
        v_user_id, v_workstation_id
    ) RETURNING id INTO v_payment_ledger_id;

    FOR v_alloc IN SELECT * FROM jsonb_array_elements(v_canonical_allocations)
    LOOP
        INSERT INTO receivables.payment_allocations (
            payment_document_id, invoice_ledger_entry_id, amount
        ) VALUES (
            v_doc_id,
            (v_alloc ->> 'invoice_ledger_entry_id')::bigint,
            (v_alloc ->> 'amount')::numeric
        );
    END LOOP;

    v_new_exposure := v_exposure - p_amount;

    SELECT min(l.due_date)
    INTO v_oldest_due
    FROM receivables.customer_ledger_entries l
    WHERE l.customer_id = p_customer_id
      AND l.entry_type = 'CREDIT_INVOICE'
      AND l.due_date IS NOT NULL
      AND l.amount_delta > receivables.net_invoice_allocated_amount(l.id);

    UPDATE receivables.customer_credit_state
    SET exposure_amount = v_new_exposure,
        oldest_open_due_date = v_oldest_due,
        last_rebuilt_at = now()
    WHERE customer_id = p_customer_id;

    IF v_method = 'CASH' THEN
        INSERT INTO cash.movements (
            cash_session_id, business_document_id, movement_type, amount
        ) VALUES (
            p_cash_session_id, v_doc_id, 'CUSTOMER_PAYMENT', p_amount
        );
        PERFORM cash.enqueue_drawer_job(
            p_cash_session_id,
            v_doc_id,
            'customer_payment:' || v_doc_id::text
        );
    END IF;

    PERFORM core.record_idempotent_result(
        'receivables.post_customer_payment', p_request_id, v_doc_id
    );

    RETURN jsonb_build_object(
        'document_id', v_doc_id,
        'document_number', v_doc_num,
        'customer_id', p_customer_id,
        'payment_method', v_method,
        'amount', p_amount::text,
        'exposure_amount', v_new_exposure::text,
        'available_credit', (
            (SELECT credit_limit FROM receivables.customers WHERE id = p_customer_id)
            - v_new_exposure
        )::text,
        'journal_document_id', v_journal_doc_id,
        'payment_ledger_entry_id', v_payment_ledger_id
    );
END;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
REVOKE ALL ON cash.drawer_operation_policy FROM PUBLIC;
REVOKE ALL ON receivables.customer_refund_authorizations FROM PUBLIC;
REVOKE ALL ON receivables.customer_payment_refunds FROM PUBLIC;
REVOKE ALL ON receivables.payment_refund_allocations FROM PUBLIC;
REVOKE ALL ON FUNCTION cash.list_drawer_operation_policy(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION cash.update_drawer_operation_policy(text,text,boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION cash.enqueue_drawer_job(bigint,bigint,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION receivables.net_invoice_allocated_amount(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION receivables.list_refundable_customer_payments(text,bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION receivables.authorize_customer_payment_refund(text,uuid,bigint,text,bigint,text,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION receivables.post_customer_refund(text,uuid,uuid,bigint,date,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION receivables.forbid_customer_refund_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION receivables.guard_customer_refund_authorization_mutation() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION cash.list_drawer_operation_policy(text) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION cash.update_drawer_operation_policy(text,text,boolean) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION receivables.list_refundable_customer_payments(text,bigint) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION receivables.authorize_customer_payment_refund(text,uuid,bigint,text,bigint,text,integer) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION receivables.post_customer_refund(text,uuid,uuid,bigint,date,text) TO stockiha_runtime;

RESET ROLE;
