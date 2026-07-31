-- S4-002: production cashier-session lifecycle.
-- Adds blind denomination counts, variance approval, suspension, controlled
-- handover, and a central ownership guard for every runtime cash movement.
SET ROLE stockiha_owner;

-- ---------------------------------------------------------------------------
-- Permissions
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
        'ALTER TABLE iam.permissions ADD CONSTRAINT permissions_code_valid CHECK ((%s) OR code = ANY (ARRAY[%L,%L,%L,%L]::text[]))',
        v_existing_check,
        'SUSPEND_CASH_SESSION',
        'RESUME_CASH_SESSION',
        'APPROVE_CASH_VARIANCE',
        'HANDOVER_CASH_SESSION'
    );
END;
$$;

INSERT INTO iam.permissions (code, name) VALUES
    ('SUSPEND_CASH_SESSION', 'Suspend a live cash register session'),
    ('RESUME_CASH_SESSION', 'Resume an owned suspended cash register session'),
    ('APPROVE_CASH_VARIANCE', 'Approve a material cash-session closing variance'),
    ('HANDOVER_CASH_SESSION', 'Transfer a suspended cash session to another cashier')
ON CONFLICT (code) DO NOTHING;

INSERT INTO iam.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM iam.roles r
CROSS JOIN iam.permissions p
WHERE r.code = 'CASHIER'
  AND p.code IN ('SUSPEND_CASH_SESSION', 'RESUME_CASH_SESSION')
ON CONFLICT DO NOTHING;

INSERT INTO iam.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM iam.roles r
CROSS JOIN iam.permissions p
WHERE r.code IN ('MANAGER', 'ADMIN')
  AND p.code IN (
      'SUSPEND_CASH_SESSION', 'RESUME_CASH_SESSION',
      'APPROVE_CASH_VARIANCE', 'HANDOVER_CASH_SESSION'
  )
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Denomination and materiality configuration
-- ---------------------------------------------------------------------------
CREATE TABLE cash.denominations (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code           text NOT NULL UNIQUE,
    value          numeric(14,2) NOT NULL,
    display_order  integer NOT NULL,
    is_active      boolean NOT NULL DEFAULT true,
    created_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT cash_denominations_code_not_blank CHECK (btrim(code) <> ''),
    CONSTRAINT cash_denominations_value_positive CHECK (value > 0),
    CONSTRAINT cash_denominations_display_order_non_negative CHECK (display_order >= 0)
);

INSERT INTO cash.denominations (code, value, display_order) VALUES
    ('DZD_2000', 2000, 10),
    ('DZD_1000', 1000, 20),
    ('DZD_500',   500, 30),
    ('DZD_200',   200, 40),
    ('DZD_100',   100, 50),
    ('DZD_50',     50, 60),
    ('DZD_20',     20, 70),
    ('DZD_10',     10, 80),
    ('DZD_5',       5, 90),
    ('DZD_2',       2, 100),
    ('DZD_1',       1, 110)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE cash.session_policy (
    id                          smallint PRIMARY KEY,
    material_variance_threshold numeric(14,2) NOT NULL DEFAULT 0,
    updated_at                  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT cash_session_policy_singleton CHECK (id = 1),
    CONSTRAINT cash_session_policy_threshold_non_negative CHECK (material_variance_threshold >= 0)
);

INSERT INTO cash.session_policy (id, material_variance_threshold)
VALUES (1, 0)
ON CONFLICT (id) DO NOTHING;

CREATE TRIGGER cash_session_policy_set_updated_at
    BEFORE UPDATE ON cash.session_policy
    FOR EACH ROW
    EXECUTE FUNCTION core.set_updated_at();

-- ---------------------------------------------------------------------------
-- Upgrade sales.cash_sessions from the Slice-1 OPEN/CLOSED model.
-- ---------------------------------------------------------------------------
ALTER TABLE sales.cash_sessions
    DROP CONSTRAINT cash_sessions_status_valid,
    DROP CONSTRAINT cash_sessions_close_snapshot_set_iff_closed;

DROP INDEX sales.cash_sessions_one_open_per_workstation;

ALTER TABLE sales.cash_sessions
    ADD COLUMN current_cashier_user_id bigint REFERENCES iam.users (id);

UPDATE sales.cash_sessions
SET current_cashier_user_id = opened_by_user_id
WHERE current_cashier_user_id IS NULL;

ALTER TABLE sales.cash_sessions
    ALTER COLUMN current_cashier_user_id SET NOT NULL,
    ADD CONSTRAINT cash_sessions_status_valid
        CHECK (status IN ('OPEN', 'CLOSING', 'PENDING_APPROVAL', 'CLOSED', 'SUSPENDED')),
    ADD CONSTRAINT cash_sessions_close_snapshot_set_iff_closed
        CHECK (
            (status = 'CLOSED'
                AND closed_by_user_id IS NOT NULL
                AND expected_amount IS NOT NULL
                AND counted_amount IS NOT NULL
                AND variance_amount IS NOT NULL
                AND closed_at IS NOT NULL)
            OR (status <> 'CLOSED'
                AND closed_by_user_id IS NULL
                AND expected_amount IS NULL
                AND counted_amount IS NULL
                AND variance_amount IS NULL
                AND closed_at IS NULL)
        );

CREATE UNIQUE INDEX cash_sessions_one_live_per_workstation
    ON sales.cash_sessions (workstation_id)
    WHERE status <> 'CLOSED';

-- ---------------------------------------------------------------------------
-- Immutable close attempts, denomination snapshots, approvals, and audit.
-- ---------------------------------------------------------------------------
CREATE TABLE cash.session_close_attempts (
    id                         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    cash_session_id            bigint NOT NULL REFERENCES sales.cash_sessions (id),
    attempt_number             integer NOT NULL,
    submitted_by_user_id       bigint NOT NULL REFERENCES iam.users (id),
    expected_amount            numeric(14,2) NOT NULL,
    counted_amount             numeric(14,2) NOT NULL,
    variance_amount            numeric(14,2) NOT NULL,
    materiality_threshold      numeric(14,2) NOT NULL,
    requires_manager_approval  boolean NOT NULL,
    submitted_at               timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT session_close_attempts_number_positive CHECK (attempt_number > 0),
    CONSTRAINT session_close_attempts_counted_non_negative CHECK (counted_amount >= 0),
    CONSTRAINT session_close_attempts_threshold_non_negative CHECK (materiality_threshold >= 0),
    CONSTRAINT session_close_attempts_variance_exact CHECK (variance_amount = counted_amount - expected_amount),
    CONSTRAINT session_close_attempts_unique_number UNIQUE (cash_session_id, attempt_number)
);

CREATE TABLE cash.session_close_count_lines (
    id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    close_attempt_id      bigint NOT NULL REFERENCES cash.session_close_attempts (id),
    denomination_id       bigint NOT NULL REFERENCES cash.denominations (id),
    denomination_code     text NOT NULL,
    denomination_value    numeric(14,2) NOT NULL,
    quantity              bigint NOT NULL,
    line_total            numeric(14,2) NOT NULL,
    created_at            timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT session_close_count_lines_code_not_blank CHECK (btrim(denomination_code) <> ''),
    CONSTRAINT session_close_count_lines_value_positive CHECK (denomination_value > 0),
    CONSTRAINT session_close_count_lines_quantity_non_negative CHECK (quantity >= 0),
    CONSTRAINT session_close_count_lines_total_exact CHECK (line_total = denomination_value * quantity),
    CONSTRAINT session_close_count_lines_one_denom UNIQUE (close_attempt_id, denomination_id)
);

CREATE TABLE cash.session_close_approvals (
    id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    close_attempt_id     bigint NOT NULL UNIQUE REFERENCES cash.session_close_attempts (id),
    approved_by_user_id  bigint NOT NULL REFERENCES iam.users (id),
    reason               text NOT NULL,
    approved_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT session_close_approvals_reason_not_blank CHECK (btrim(reason) <> '')
);

CREATE TABLE cash.cash_session_events (
    id                       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    cash_session_id          bigint NOT NULL REFERENCES sales.cash_sessions (id),
    event_type               text NOT NULL,
    actor_user_id            bigint NOT NULL REFERENCES iam.users (id),
    close_attempt_id         bigint REFERENCES cash.session_close_attempts (id),
    previous_cashier_user_id bigint REFERENCES iam.users (id),
    new_cashier_user_id      bigint REFERENCES iam.users (id),
    reason                   text,
    created_at               timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT cash_session_events_type_valid CHECK (
        event_type IN (
            'OPENED', 'CLOSE_STARTED', 'CLOSE_CANCELLED', 'COUNT_SUBMITTED',
            'AUTO_CLOSED', 'VARIANCE_APPROVED', 'SUSPENDED', 'RESUMED', 'HANDED_OVER'
        )
    )
);

-- Backfill the opening audit event for pre-S4 sessions.
INSERT INTO cash.cash_session_events (
    cash_session_id, event_type, actor_user_id, new_cashier_user_id, created_at
)
SELECT id, 'OPENED', opened_by_user_id, opened_by_user_id, opened_at
FROM sales.cash_sessions;

CREATE FUNCTION cash.forbid_cash_session_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'cash session audit records are immutable and append-only'
        USING ERRCODE = '0A000';
END;
$$;

CREATE TRIGGER session_close_attempts_forbid_update
    BEFORE UPDATE OR DELETE ON cash.session_close_attempts
    FOR EACH ROW EXECUTE FUNCTION cash.forbid_cash_session_audit_mutation();
CREATE TRIGGER session_close_count_lines_forbid_update
    BEFORE UPDATE OR DELETE ON cash.session_close_count_lines
    FOR EACH ROW EXECUTE FUNCTION cash.forbid_cash_session_audit_mutation();
CREATE TRIGGER session_close_approvals_forbid_update
    BEFORE UPDATE OR DELETE ON cash.session_close_approvals
    FOR EACH ROW EXECUTE FUNCTION cash.forbid_cash_session_audit_mutation();
CREATE TRIGGER cash_session_events_forbid_update
    BEFORE UPDATE OR DELETE ON cash.cash_session_events
    FOR EACH ROW EXECUTE FUNCTION cash.forbid_cash_session_audit_mutation();

-- ---------------------------------------------------------------------------
-- Authenticated transaction-local actor context.
-- The cash-movement trigger below uses this to enforce the current cashier at
-- one central ledger boundary, avoiding duplicated ownership checks in every
-- posting function.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION iam.resolve_session(p_token text)
RETURNS TABLE (user_id bigint, workstation_id text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_user_id bigint;
    v_workstation_id text;
BEGIN
    PERFORM set_config('stockiha.actor_user_id', '', true);
    PERFORM set_config('stockiha.actor_workstation_id', '', true);

    SELECT s.user_id, s.workstation_id
    INTO v_user_id, v_workstation_id
    FROM iam.application_sessions s
    JOIN iam.users u ON u.id = s.user_id
    WHERE s.token_hash = sha256(p_token::bytea)
      AND s.revoked_at IS NULL
      AND s.expires_at > now()
      AND u.is_active;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'invalid, expired, or revoked session'
            USING ERRCODE = '28000';
    END IF;

    PERFORM set_config('stockiha.actor_user_id', v_user_id::text, true);
    PERFORM set_config('stockiha.actor_workstation_id', v_workstation_id, true);

    RETURN QUERY SELECT v_user_id, v_workstation_id;
END;
$$;

CREATE OR REPLACE FUNCTION iam.resolve_session_with_permission(
    p_token text,
    p_permission_code text
)
RETURNS TABLE (user_id bigint, workstation_id text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_user_id bigint;
    v_workstation_id text;
    v_has_permission boolean;
BEGIN
    PERFORM set_config('stockiha.actor_user_id', '', true);
    PERFORM set_config('stockiha.actor_workstation_id', '', true);

    SELECT s.user_id, s.workstation_id
    INTO v_user_id, v_workstation_id
    FROM iam.application_sessions s
    JOIN iam.users u ON u.id = s.user_id
    WHERE s.token_hash = sha256(p_token::bytea)
      AND s.revoked_at IS NULL
      AND s.expires_at > now()
      AND u.is_active;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'invalid, expired, or revoked session'
            USING ERRCODE = '28000';
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM iam.user_roles ur
        JOIN iam.role_permissions rp ON rp.role_id = ur.role_id
        JOIN iam.permissions p ON p.id = rp.permission_id
        WHERE ur.user_id = v_user_id
          AND p.code = p_permission_code
    ) INTO v_has_permission;

    IF NOT v_has_permission THEN
        RAISE EXCEPTION 'session user lacks required permission: %', p_permission_code
            USING ERRCODE = '42501';
    END IF;

    PERFORM set_config('stockiha.actor_user_id', v_user_id::text, true);
    PERFORM set_config('stockiha.actor_workstation_id', v_workstation_id, true);

    RETURN QUERY SELECT v_user_id, v_workstation_id;
END;
$$;

CREATE FUNCTION cash.enforce_runtime_cash_session_operator()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_actor_user_id bigint;
    v_actor_workstation_id text;
    v_status text;
    v_current_cashier_user_id bigint;
    v_session_workstation_id text;
BEGIN
    -- Privileged owner/admin maintenance is outside the runtime boundary.
    -- SECURITY DEFINER posting calls still have session_user=stockiha_runtime,
    -- so normal application traffic always goes through this check.
    IF session_user <> 'stockiha_runtime' THEN
        RETURN NEW;
    END IF;

    BEGIN
        v_actor_user_id := nullif(current_setting('stockiha.actor_user_id', true), '')::bigint;
        v_actor_workstation_id := nullif(current_setting('stockiha.actor_workstation_id', true), '');
    EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'cash operation lacks authenticated actor context' USING ERRCODE = '28000';
    END;

    IF v_actor_user_id IS NULL OR v_actor_workstation_id IS NULL THEN
        RAISE EXCEPTION 'cash operation lacks authenticated actor context' USING ERRCODE = '28000';
    END IF;

    SELECT status, current_cashier_user_id, workstation_id
    INTO v_status, v_current_cashier_user_id, v_session_workstation_id
    FROM sales.cash_sessions
    WHERE id = NEW.cash_session_id
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'cash session not found' USING ERRCODE = '22023';
    END IF;
    IF v_status <> 'OPEN' THEN
        RAISE EXCEPTION 'cash session is not open' USING ERRCODE = '55000';
    END IF;
    IF v_current_cashier_user_id <> v_actor_user_id
       OR v_session_workstation_id <> v_actor_workstation_id THEN
        RAISE EXCEPTION 'cash session is not owned by the authenticated cashier/workstation'
            USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER movements_enforce_runtime_cash_session_operator
    BEFORE INSERT ON cash.movements
    FOR EACH ROW
    EXECUTE FUNCTION cash.enforce_runtime_cash_session_operator();

-- Raw movement visibility would defeat blind counting for a runtime client.
REVOKE SELECT ON cash.movements FROM stockiha_runtime;

-- ---------------------------------------------------------------------------
-- Open / inspect APIs
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sales.open_cash_session(
    p_session_token text,
    p_warehouse_id bigint,
    p_workstation_id text,
    p_opening_float numeric
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_user_id bigint;
    v_actor_workstation_id text;
    v_session_id bigint;
BEGIN
    SELECT user_id, workstation_id
    INTO v_user_id, v_actor_workstation_id
    FROM iam.resolve_session_with_permission(p_session_token, 'OPEN_CASH_SESSION');

    IF p_opening_float < 0 THEN
        RAISE EXCEPTION 'opening float must not be negative' USING ERRCODE = '22023';
    END IF;
    IF btrim(coalesce(p_workstation_id, '')) = '' OR p_workstation_id <> v_actor_workstation_id THEN
        RAISE EXCEPTION 'cash session workstation must match authenticated workstation'
            USING ERRCODE = '42501';
    END IF;

    PERFORM 1 FROM inventory.warehouses WHERE id = p_warehouse_id FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'warehouse % not found', p_warehouse_id USING ERRCODE = '22023';
    END IF;

    BEGIN
        INSERT INTO sales.cash_sessions (
            warehouse_id, workstation_id, opened_by_user_id,
            current_cashier_user_id, opening_float
        ) VALUES (
            p_warehouse_id, p_workstation_id, v_user_id,
            v_user_id, p_opening_float
        )
        RETURNING id INTO v_session_id;
    EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION 'workstation % already has a live cash session', p_workstation_id
            USING ERRCODE = '55000';
    END;

    INSERT INTO cash.cash_session_events (
        cash_session_id, event_type, actor_user_id, new_cashier_user_id
    ) VALUES (
        v_session_id, 'OPENED', v_user_id, v_user_id
    );

    RETURN v_session_id;
END;
$$;

CREATE OR REPLACE FUNCTION sales.inspect_active_cash_session(
    p_session_token text,
    p_workstation_id text
)
RETURNS TABLE (
    id bigint,
    warehouse_id bigint,
    opened_by_user_id bigint,
    opening_float numeric,
    opened_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_user_id bigint;
    v_actor_workstation_id text;
BEGIN
    SELECT user_id, workstation_id
    INTO v_user_id, v_actor_workstation_id
    FROM iam.resolve_session(p_session_token);

    IF p_workstation_id <> v_actor_workstation_id THEN
        RAISE EXCEPTION 'workstation mismatch' USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
        SELECT cs.id, cs.warehouse_id, cs.opened_by_user_id, cs.opening_float, cs.opened_at
        FROM sales.cash_sessions cs
        WHERE cs.workstation_id = p_workstation_id
          AND cs.current_cashier_user_id = v_user_id
          AND cs.status = 'OPEN';
END;
$$;

CREATE FUNCTION sales.inspect_current_cash_session(
    p_session_token text,
    p_workstation_id text
)
RETURNS TABLE (
    id bigint,
    warehouse_id bigint,
    workstation_id text,
    opened_by_user_id bigint,
    current_cashier_user_id bigint,
    current_cashier_display_name text,
    status text,
    opening_float numeric,
    opened_at timestamptz,
    close_attempt_id bigint,
    expected_amount numeric,
    counted_amount numeric,
    variance_amount numeric,
    requires_manager_approval boolean,
    suspension_reason text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_actor_workstation_id text;
BEGIN
    SELECT rs.workstation_id INTO v_actor_workstation_id
    FROM iam.resolve_session(p_session_token) rs;

    IF p_workstation_id <> v_actor_workstation_id THEN
        RAISE EXCEPTION 'workstation mismatch' USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT
        cs.id,
        cs.warehouse_id,
        cs.workstation_id,
        cs.opened_by_user_id,
        cs.current_cashier_user_id,
        u.display_name,
        cs.status,
        cs.opening_float,
        cs.opened_at,
        CASE WHEN cs.status IN ('PENDING_APPROVAL', 'CLOSED') THEN ca.id ELSE NULL END,
        CASE
            WHEN cs.status = 'CLOSED' THEN cs.expected_amount
            WHEN cs.status = 'PENDING_APPROVAL' THEN ca.expected_amount
            ELSE NULL
        END,
        CASE
            WHEN cs.status = 'CLOSED' THEN cs.counted_amount
            WHEN cs.status = 'PENDING_APPROVAL' THEN ca.counted_amount
            ELSE NULL
        END,
        CASE
            WHEN cs.status = 'CLOSED' THEN cs.variance_amount
            WHEN cs.status = 'PENDING_APPROVAL' THEN ca.variance_amount
            ELSE NULL
        END,
        CASE WHEN cs.status IN ('PENDING_APPROVAL', 'CLOSED') THEN ca.requires_manager_approval ELSE NULL END,
        CASE WHEN cs.status = 'SUSPENDED' THEN se.reason ELSE NULL END
    FROM sales.cash_sessions cs
    JOIN iam.users u ON u.id = cs.current_cashier_user_id
    LEFT JOIN LATERAL (
        SELECT a.*
        FROM cash.session_close_attempts a
        WHERE a.cash_session_id = cs.id
        ORDER BY a.attempt_number DESC
        LIMIT 1
    ) ca ON true
    LEFT JOIN LATERAL (
        SELECT e.reason
        FROM cash.cash_session_events e
        WHERE e.cash_session_id = cs.id
          AND e.event_type = 'SUSPENDED'
        ORDER BY e.id DESC
        LIMIT 1
    ) se ON true
    WHERE cs.workstation_id = p_workstation_id
      AND cs.status <> 'CLOSED';
END;
$$;

CREATE FUNCTION sales.list_cash_denominations(p_session_token text)
RETURNS TABLE (id bigint, code text, value numeric, display_order integer)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog
AS $$
BEGIN
    PERFORM 1 FROM iam.resolve_session(p_session_token);
    RETURN QUERY
    SELECT d.id, d.code, d.value, d.display_order
    FROM cash.denominations d
    WHERE d.is_active
    ORDER BY d.display_order, d.value DESC, d.id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Blind close lifecycle
-- ---------------------------------------------------------------------------
CREATE FUNCTION sales.begin_cash_session_close(
    p_session_token text,
    p_cash_session_id bigint
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_user_id bigint;
    v_workstation_id text;
    v_status text;
    v_current_cashier_user_id bigint;
    v_session_workstation_id text;
BEGIN
    SELECT user_id, workstation_id
    INTO v_user_id, v_workstation_id
    FROM iam.resolve_session_with_permission(p_session_token, 'CLOSE_CASH_SESSION');

    SELECT status, current_cashier_user_id, workstation_id
    INTO v_status, v_current_cashier_user_id, v_session_workstation_id
    FROM sales.cash_sessions
    WHERE id = p_cash_session_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'cash session not found' USING ERRCODE = '22023';
    END IF;
    IF v_status <> 'OPEN' THEN
        RAISE EXCEPTION 'only an open cash session can begin closing' USING ERRCODE = '55000';
    END IF;
    IF v_current_cashier_user_id <> v_user_id OR v_session_workstation_id <> v_workstation_id THEN
        RAISE EXCEPTION 'only the current cashier can close this session' USING ERRCODE = '42501';
    END IF;

    UPDATE sales.cash_sessions
    SET status = 'CLOSING'
    WHERE id = p_cash_session_id;

    INSERT INTO cash.cash_session_events (cash_session_id, event_type, actor_user_id)
    VALUES (p_cash_session_id, 'CLOSE_STARTED', v_user_id);

    RETURN p_cash_session_id;
END;
$$;

CREATE FUNCTION sales.cancel_cash_session_close(
    p_session_token text,
    p_cash_session_id bigint
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_user_id bigint;
    v_workstation_id text;
    v_status text;
    v_current_cashier_user_id bigint;
    v_session_workstation_id text;
BEGIN
    SELECT user_id, workstation_id
    INTO v_user_id, v_workstation_id
    FROM iam.resolve_session_with_permission(p_session_token, 'CLOSE_CASH_SESSION');

    SELECT status, current_cashier_user_id, workstation_id
    INTO v_status, v_current_cashier_user_id, v_session_workstation_id
    FROM sales.cash_sessions
    WHERE id = p_cash_session_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'cash session not found' USING ERRCODE = '22023';
    END IF;
    IF v_status <> 'CLOSING' THEN
        RAISE EXCEPTION 'cash session is not awaiting a blind count' USING ERRCODE = '55000';
    END IF;
    IF v_current_cashier_user_id <> v_user_id OR v_session_workstation_id <> v_workstation_id THEN
        RAISE EXCEPTION 'only the current cashier can cancel this close' USING ERRCODE = '42501';
    END IF;
    IF EXISTS (SELECT 1 FROM cash.session_close_attempts a WHERE a.cash_session_id = p_cash_session_id) THEN
        RAISE EXCEPTION 'submitted close attempts cannot be cancelled' USING ERRCODE = '55000';
    END IF;

    UPDATE sales.cash_sessions SET status = 'OPEN' WHERE id = p_cash_session_id;
    INSERT INTO cash.cash_session_events (cash_session_id, event_type, actor_user_id)
    VALUES (p_cash_session_id, 'CLOSE_CANCELLED', v_user_id);

    RETURN p_cash_session_id;
END;
$$;

CREATE FUNCTION sales.submit_cash_session_count(
    p_session_token text,
    p_cash_session_id bigint,
    p_counts jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_user_id bigint;
    v_workstation_id text;
    v_status text;
    v_current_cashier_user_id bigint;
    v_session_workstation_id text;
    v_opening_float numeric(14,2);
    v_active_denom_count integer;
    v_payload_count integer;
    v_distinct_count integer;
    v_expected numeric(14,2);
    v_counted numeric(14,2);
    v_variance numeric(14,2);
    v_threshold numeric(14,2);
    v_requires_approval boolean;
    v_attempt_number integer;
    v_attempt_id bigint;
BEGIN
    SELECT user_id, workstation_id
    INTO v_user_id, v_workstation_id
    FROM iam.resolve_session_with_permission(p_session_token, 'CLOSE_CASH_SESSION');

    SELECT status, current_cashier_user_id, workstation_id, opening_float
    INTO v_status, v_current_cashier_user_id, v_session_workstation_id, v_opening_float
    FROM sales.cash_sessions
    WHERE id = p_cash_session_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'cash session not found' USING ERRCODE = '22023';
    END IF;
    IF v_status <> 'CLOSING' THEN
        RAISE EXCEPTION 'cash session is not awaiting a blind count' USING ERRCODE = '55000';
    END IF;
    IF v_current_cashier_user_id <> v_user_id OR v_session_workstation_id <> v_workstation_id THEN
        RAISE EXCEPTION 'only the current cashier can submit this blind count' USING ERRCODE = '42501';
    END IF;
    IF p_counts IS NULL OR jsonb_typeof(p_counts) <> 'array' THEN
        RAISE EXCEPTION 'denomination counts must be an array' USING ERRCODE = '22023';
    END IF;

    SELECT count(*) INTO v_active_denom_count FROM cash.denominations WHERE is_active;
    IF v_active_denom_count = 0 THEN
        RAISE EXCEPTION 'no active cash denominations are configured' USING ERRCODE = '55000';
    END IF;

    v_payload_count := jsonb_array_length(p_counts);
    IF v_payload_count <> v_active_denom_count THEN
        RAISE EXCEPTION 'blind count must include every active denomination exactly once'
            USING ERRCODE = '22023';
    END IF;

    BEGIN
        SELECT count(DISTINCT (elem ->> 'denomination_id')::bigint)
        INTO v_distinct_count
        FROM jsonb_array_elements(p_counts) elem;

        IF v_distinct_count <> v_payload_count THEN
            RAISE EXCEPTION 'duplicate or missing denomination in blind count' USING ERRCODE = '22023';
        END IF;

        IF EXISTS (
            SELECT 1
            FROM jsonb_array_elements(p_counts) elem
            LEFT JOIN cash.denominations d
              ON d.id = (elem ->> 'denomination_id')::bigint
             AND d.is_active
            WHERE d.id IS NULL
               OR (elem ->> 'quantity') IS NULL
               OR (elem ->> 'quantity')::bigint < 0
        ) THEN
            RAISE EXCEPTION 'invalid denomination count' USING ERRCODE = '22023';
        END IF;
    EXCEPTION
        WHEN invalid_text_representation OR numeric_value_out_of_range THEN
            RAISE EXCEPTION 'invalid denomination count' USING ERRCODE = '22023';
    END;

    SELECT round(v_opening_float + coalesce(sum(m.amount), 0), 2)
    INTO v_expected
    FROM cash.movements m
    WHERE m.cash_session_id = p_cash_session_id;

    BEGIN
        SELECT round(sum(d.value * (elem ->> 'quantity')::bigint), 2)
        INTO v_counted
        FROM jsonb_array_elements(p_counts) elem
        JOIN cash.denominations d ON d.id = (elem ->> 'denomination_id')::bigint;
    EXCEPTION
        WHEN invalid_text_representation OR numeric_value_out_of_range THEN
            RAISE EXCEPTION 'invalid denomination count' USING ERRCODE = '22023';
    END;

    SELECT material_variance_threshold INTO v_threshold
    FROM cash.session_policy
    WHERE id = 1
    FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'cash session policy is not configured' USING ERRCODE = '55000';
    END IF;

    v_variance := round(v_counted - v_expected, 2);
    v_requires_approval := abs(v_variance) > v_threshold;

    SELECT coalesce(max(attempt_number), 0) + 1
    INTO v_attempt_number
    FROM cash.session_close_attempts
    WHERE cash_session_id = p_cash_session_id;

    INSERT INTO cash.session_close_attempts (
        cash_session_id, attempt_number, submitted_by_user_id,
        expected_amount, counted_amount, variance_amount,
        materiality_threshold, requires_manager_approval
    ) VALUES (
        p_cash_session_id, v_attempt_number, v_user_id,
        v_expected, v_counted, v_variance,
        v_threshold, v_requires_approval
    ) RETURNING id INTO v_attempt_id;

    INSERT INTO cash.session_close_count_lines (
        close_attempt_id, denomination_id, denomination_code,
        denomination_value, quantity, line_total
    )
    SELECT
        v_attempt_id,
        d.id,
        d.code,
        d.value,
        (elem ->> 'quantity')::bigint,
        round(d.value * (elem ->> 'quantity')::bigint, 2)
    FROM jsonb_array_elements(p_counts) elem
    JOIN cash.denominations d ON d.id = (elem ->> 'denomination_id')::bigint
    ORDER BY d.display_order, d.id;

    INSERT INTO cash.cash_session_events (
        cash_session_id, event_type, actor_user_id, close_attempt_id
    ) VALUES (
        p_cash_session_id, 'COUNT_SUBMITTED', v_user_id, v_attempt_id
    );

    IF v_requires_approval THEN
        UPDATE sales.cash_sessions
        SET status = 'PENDING_APPROVAL'
        WHERE id = p_cash_session_id;
    ELSE
        UPDATE sales.cash_sessions
        SET status = 'CLOSED',
            closed_by_user_id = v_user_id,
            expected_amount = v_expected,
            counted_amount = v_counted,
            variance_amount = v_variance,
            closed_at = now()
        WHERE id = p_cash_session_id;

        INSERT INTO cash.cash_session_events (
            cash_session_id, event_type, actor_user_id, close_attempt_id
        ) VALUES (
            p_cash_session_id, 'AUTO_CLOSED', v_user_id, v_attempt_id
        );
    END IF;

    RETURN jsonb_build_object(
        'cash_session_id', p_cash_session_id,
        'close_attempt_id', v_attempt_id,
        'status', CASE WHEN v_requires_approval THEN 'PENDING_APPROVAL' ELSE 'CLOSED' END,
        'expected_amount', v_expected::text,
        'counted_amount', v_counted::text,
        'variance_amount', v_variance::text,
        'requires_manager_approval', v_requires_approval
    );
END;
$$;

CREATE FUNCTION sales.approve_cash_session_variance(
    p_session_token text,
    p_cash_session_id bigint,
    p_close_attempt_id bigint,
    p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_manager_user_id bigint;
    v_manager_workstation_id text;
    v_status text;
    v_session_workstation_id text;
    v_submitted_by_user_id bigint;
    v_expected numeric(14,2);
    v_counted numeric(14,2);
    v_variance numeric(14,2);
    v_requires_approval boolean;
BEGIN
    SELECT user_id, workstation_id
    INTO v_manager_user_id, v_manager_workstation_id
    FROM iam.resolve_session_with_permission(p_session_token, 'APPROVE_CASH_VARIANCE');

    IF btrim(coalesce(p_reason, '')) = '' THEN
        RAISE EXCEPTION 'variance approval reason is required' USING ERRCODE = '22023';
    END IF;

    SELECT status, workstation_id
    INTO v_status, v_session_workstation_id
    FROM sales.cash_sessions
    WHERE id = p_cash_session_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'cash session not found' USING ERRCODE = '22023';
    END IF;
    IF v_status <> 'PENDING_APPROVAL' THEN
        RAISE EXCEPTION 'cash session is not pending variance approval' USING ERRCODE = '55000';
    END IF;
    IF v_session_workstation_id <> v_manager_workstation_id THEN
        RAISE EXCEPTION 'variance approval must occur on the same workstation' USING ERRCODE = '42501';
    END IF;

    SELECT submitted_by_user_id, expected_amount, counted_amount,
           variance_amount, requires_manager_approval
    INTO v_submitted_by_user_id, v_expected, v_counted,
         v_variance, v_requires_approval
    FROM cash.session_close_attempts
    WHERE id = p_close_attempt_id
      AND cash_session_id = p_cash_session_id;

    IF NOT FOUND OR NOT v_requires_approval THEN
        RAISE EXCEPTION 'close attempt is not eligible for manager approval' USING ERRCODE = '55000';
    END IF;
    IF EXISTS (
        SELECT 1 FROM cash.session_close_approvals
        WHERE close_attempt_id = p_close_attempt_id
    ) THEN
        RAISE EXCEPTION 'close attempt has already been approved' USING ERRCODE = '55000';
    END IF;

    INSERT INTO cash.session_close_approvals (
        close_attempt_id, approved_by_user_id, reason
    ) VALUES (
        p_close_attempt_id, v_manager_user_id, btrim(p_reason)
    );

    UPDATE sales.cash_sessions
    SET status = 'CLOSED',
        closed_by_user_id = v_submitted_by_user_id,
        expected_amount = v_expected,
        counted_amount = v_counted,
        variance_amount = v_variance,
        closed_at = now()
    WHERE id = p_cash_session_id;

    INSERT INTO cash.cash_session_events (
        cash_session_id, event_type, actor_user_id, close_attempt_id, reason
    ) VALUES (
        p_cash_session_id, 'VARIANCE_APPROVED', v_manager_user_id,
        p_close_attempt_id, btrim(p_reason)
    );

    RETURN jsonb_build_object(
        'cash_session_id', p_cash_session_id,
        'close_attempt_id', p_close_attempt_id,
        'status', 'CLOSED',
        'expected_amount', v_expected::text,
        'counted_amount', v_counted::text,
        'variance_amount', v_variance::text,
        'requires_manager_approval', true,
        'approved_by_user_id', v_manager_user_id
    );
END;
$$;

-- ---------------------------------------------------------------------------
-- Suspension / resume / controlled handover
-- ---------------------------------------------------------------------------
CREATE FUNCTION sales.suspend_cash_session(
    p_session_token text,
    p_cash_session_id bigint,
    p_reason text
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_user_id bigint;
    v_workstation_id text;
    v_status text;
    v_current_cashier_user_id bigint;
    v_session_workstation_id text;
    v_manager_override boolean;
BEGIN
    SELECT user_id, workstation_id
    INTO v_user_id, v_workstation_id
    FROM iam.resolve_session_with_permission(p_session_token, 'SUSPEND_CASH_SESSION');

    IF btrim(coalesce(p_reason, '')) = '' THEN
        RAISE EXCEPTION 'suspension reason is required' USING ERRCODE = '22023';
    END IF;

    SELECT status, current_cashier_user_id, workstation_id
    INTO v_status, v_current_cashier_user_id, v_session_workstation_id
    FROM sales.cash_sessions
    WHERE id = p_cash_session_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'cash session not found' USING ERRCODE = '22023';
    END IF;
    IF v_status <> 'OPEN' THEN
        RAISE EXCEPTION 'only an open cash session can be suspended' USING ERRCODE = '55000';
    END IF;
    IF v_session_workstation_id <> v_workstation_id THEN
        RAISE EXCEPTION 'cash session belongs to another workstation' USING ERRCODE = '42501';
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM iam.user_roles ur
        JOIN iam.role_permissions rp ON rp.role_id = ur.role_id
        JOIN iam.permissions p ON p.id = rp.permission_id
        WHERE ur.user_id = v_user_id
          AND p.code = 'HANDOVER_CASH_SESSION'
    ) INTO v_manager_override;

    IF v_current_cashier_user_id <> v_user_id AND NOT v_manager_override THEN
        RAISE EXCEPTION 'only the current cashier or a cash-session manager can suspend this session'
            USING ERRCODE = '42501';
    END IF;

    UPDATE sales.cash_sessions SET status = 'SUSPENDED' WHERE id = p_cash_session_id;

    INSERT INTO cash.cash_session_events (
        cash_session_id, event_type, actor_user_id, reason
    ) VALUES (
        p_cash_session_id, 'SUSPENDED', v_user_id, btrim(p_reason)
    );

    RETURN p_cash_session_id;
END;
$$;

CREATE FUNCTION sales.resume_cash_session(
    p_session_token text,
    p_cash_session_id bigint
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_user_id bigint;
    v_workstation_id text;
    v_status text;
    v_current_cashier_user_id bigint;
    v_session_workstation_id text;
BEGIN
    SELECT user_id, workstation_id
    INTO v_user_id, v_workstation_id
    FROM iam.resolve_session_with_permission(p_session_token, 'RESUME_CASH_SESSION');

    SELECT status, current_cashier_user_id, workstation_id
    INTO v_status, v_current_cashier_user_id, v_session_workstation_id
    FROM sales.cash_sessions
    WHERE id = p_cash_session_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'cash session not found' USING ERRCODE = '22023';
    END IF;
    IF v_status <> 'SUSPENDED' THEN
        RAISE EXCEPTION 'cash session is not suspended' USING ERRCODE = '55000';
    END IF;
    IF v_current_cashier_user_id <> v_user_id OR v_session_workstation_id <> v_workstation_id THEN
        RAISE EXCEPTION 'only the current cashier can resume this session' USING ERRCODE = '42501';
    END IF;

    UPDATE sales.cash_sessions SET status = 'OPEN' WHERE id = p_cash_session_id;
    INSERT INTO cash.cash_session_events (cash_session_id, event_type, actor_user_id)
    VALUES (p_cash_session_id, 'RESUMED', v_user_id);

    RETURN p_cash_session_id;
END;
$$;

CREATE FUNCTION sales.handover_cash_session(
    p_session_token text,
    p_cash_session_id bigint,
    p_target_username text,
    p_reason text
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_manager_user_id bigint;
    v_manager_workstation_id text;
    v_status text;
    v_session_workstation_id text;
    v_previous_cashier_user_id bigint;
    v_target_user_id bigint;
    v_required_permission_count integer;
BEGIN
    SELECT user_id, workstation_id
    INTO v_manager_user_id, v_manager_workstation_id
    FROM iam.resolve_session_with_permission(p_session_token, 'HANDOVER_CASH_SESSION');

    IF btrim(coalesce(p_target_username, '')) = '' THEN
        RAISE EXCEPTION 'target cashier username is required' USING ERRCODE = '22023';
    END IF;
    IF btrim(coalesce(p_reason, '')) = '' THEN
        RAISE EXCEPTION 'handover reason is required' USING ERRCODE = '22023';
    END IF;

    SELECT status, workstation_id, current_cashier_user_id
    INTO v_status, v_session_workstation_id, v_previous_cashier_user_id
    FROM sales.cash_sessions
    WHERE id = p_cash_session_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'cash session not found' USING ERRCODE = '22023';
    END IF;
    IF v_status <> 'SUSPENDED' THEN
        RAISE EXCEPTION 'cash session must be suspended before handover' USING ERRCODE = '55000';
    END IF;
    IF v_session_workstation_id <> v_manager_workstation_id THEN
        RAISE EXCEPTION 'handover must occur on the same workstation' USING ERRCODE = '42501';
    END IF;

    SELECT id INTO v_target_user_id
    FROM iam.users
    WHERE username = btrim(p_target_username)
      AND is_active
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'target cashier not found or inactive' USING ERRCODE = '22023';
    END IF;
    IF v_target_user_id = v_previous_cashier_user_id THEN
        RAISE EXCEPTION 'target cashier already owns this session' USING ERRCODE = '22023';
    END IF;

    SELECT count(DISTINCT p.code)
    INTO v_required_permission_count
    FROM iam.user_roles ur
    JOIN iam.role_permissions rp ON rp.role_id = ur.role_id
    JOIN iam.permissions p ON p.id = rp.permission_id
    WHERE ur.user_id = v_target_user_id
      AND p.code IN ('POST_CASH_SALE', 'CLOSE_CASH_SESSION', 'RESUME_CASH_SESSION');

    IF v_required_permission_count <> 3 THEN
        RAISE EXCEPTION 'target user is not authorized to operate a cash session'
            USING ERRCODE = '42501';
    END IF;

    UPDATE sales.cash_sessions
    SET current_cashier_user_id = v_target_user_id
    WHERE id = p_cash_session_id;

    INSERT INTO cash.cash_session_events (
        cash_session_id, event_type, actor_user_id,
        previous_cashier_user_id, new_cashier_user_id, reason
    ) VALUES (
        p_cash_session_id, 'HANDED_OVER', v_manager_user_id,
        v_previous_cashier_user_id, v_target_user_id, btrim(p_reason)
    );

    RETURN p_cash_session_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
REVOKE ALL ON cash.denominations FROM PUBLIC;
REVOKE ALL ON cash.session_policy FROM PUBLIC;
REVOKE ALL ON cash.session_close_attempts FROM PUBLIC;
REVOKE ALL ON cash.session_close_count_lines FROM PUBLIC;
REVOKE ALL ON cash.session_close_approvals FROM PUBLIC;
REVOKE ALL ON cash.cash_session_events FROM PUBLIC;
REVOKE ALL ON FUNCTION cash.forbid_cash_session_audit_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION cash.enforce_runtime_cash_session_operator() FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION sales.close_cash_session(text, bigint, numeric) FROM stockiha_runtime;

REVOKE ALL ON FUNCTION sales.inspect_current_cash_session(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION sales.list_cash_denominations(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION sales.begin_cash_session_close(text, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION sales.cancel_cash_session_close(text, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION sales.submit_cash_session_count(text, bigint, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION sales.approve_cash_session_variance(text, bigint, bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION sales.suspend_cash_session(text, bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION sales.resume_cash_session(text, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION sales.handover_cash_session(text, bigint, text, text) FROM PUBLIC;

GRANT SELECT ON cash.denominations TO stockiha_runtime;
GRANT SELECT ON cash.session_policy TO stockiha_runtime;

GRANT EXECUTE ON FUNCTION sales.inspect_current_cash_session(text, text) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION sales.list_cash_denominations(text) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION sales.begin_cash_session_close(text, bigint) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION sales.cancel_cash_session_close(text, bigint) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION sales.submit_cash_session_count(text, bigint, jsonb) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION sales.approve_cash_session_variance(text, bigint, bigint, text) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION sales.suspend_cash_session(text, bigint, text) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION sales.resume_cash_session(text, bigint) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION sales.handover_cash_session(text, bigint, text, text) TO stockiha_runtime;

RESET ROLE;
