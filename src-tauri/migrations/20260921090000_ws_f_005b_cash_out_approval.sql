-- WS-F-005b: Owner rulings on cash in/out.
--   1. A cashier cannot take money out of the drawer alone: every CASH_OUT needs
--      a user holding APPROVE_CASH_OUT (Manager, Admin, Super Admin), either the
--      cashier themself or a manager who signs in on the same workstation.
--   2. Reason OTHER is shown as "Custom reason" and requires a description.
--   3. Notes are at most 200 characters.
--   4. SUPER_ADMIN receives the WS-F-005 permissions it was never granted.
--   5. cash.get_capabilities lets the screen know whether approval is needed.
--
-- Fully idempotent: the WS-K-5 safe-upgrade integration fixture re-applies the
-- newest migration after deleting its bookkeeping row.

SET ROLE stockiha_owner;

-- =============================================================================
-- 1. Permission vocabulary
-- =============================================================================

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

    IF position('APPROVE_CASH_OUT' in v_existing_check) = 0 THEN
        ALTER TABLE iam.permissions DROP CONSTRAINT permissions_code_valid;
        EXECUTE format(
            'ALTER TABLE iam.permissions ADD CONSTRAINT permissions_code_valid CHECK ((%s) OR code = %L)',
            v_existing_check,
            'APPROVE_CASH_OUT'
        );
    END IF;
END;
$$;

INSERT INTO iam.permissions (code, name)
VALUES ('APPROVE_CASH_OUT', 'Approve money taken out of the cash drawer')
ON CONFLICT (code) DO NOTHING;

INSERT INTO iam.role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM iam.roles role
CROSS JOIN iam.permissions permission
WHERE role.code IN ('MANAGER', 'ADMIN', 'SUPER_ADMIN')
  AND permission.code = 'APPROVE_CASH_OUT'
ON CONFLICT DO NOTHING;

INSERT INTO iam.role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM iam.roles role
CROSS JOIN iam.permissions permission
WHERE role.code = 'SUPER_ADMIN'
  AND permission.code IN ('RECORD_CASH_MOVEMENT', 'MANAGE_CASH_POLICY')
ON CONFLICT DO NOTHING;

-- =============================================================================
-- 2. Who approved a cash-out
-- =============================================================================

ALTER TABLE cash.movements
    ADD COLUMN IF NOT EXISTS approved_by_user_id bigint REFERENCES iam.users (id) ON DELETE RESTRICT;

-- =============================================================================
-- 3. record_cash_movement gains an approver argument
-- =============================================================================

-- The 6-argument version must disappear: leaving it would let a cashier skip
-- approval by calling the old signature.
DROP FUNCTION IF EXISTS cash.record_cash_movement(text, bigint, text, numeric, text, text);

CREATE OR REPLACE FUNCTION cash.record_cash_movement(
    p_session_token text,
    p_cash_session_id bigint,
    p_movement_type text,
    p_amount numeric,
    p_reason_code text,
    p_note text,
    p_approver_session_token text
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
    v_amount numeric(14, 2);
    v_note text;
    v_approver_user_id bigint;
    v_approver_workstation_id text;
    v_journal_document_id bigint;
    v_movement_id bigint;
BEGIN
    SELECT user_id, workstation_id
    INTO v_user_id, v_workstation_id
    FROM iam.resolve_session_with_permission(p_session_token, 'RECORD_CASH_MOVEMENT');

    IF p_movement_type IS NULL OR p_movement_type NOT IN ('CASH_IN', 'CASH_OUT') THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: movement must be CASH_IN or CASH_OUT'
            USING ERRCODE = '22023';
    END IF;

    IF p_reason_code IS NULL OR p_reason_code NOT IN
        ('SUPPLIER_PAYMENT', 'EXPENSE', 'CHANGE_FLOAT', 'CORRECTION', 'OTHER') THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: unsupported cash movement reason'
            USING ERRCODE = '22023';
    END IF;

    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: amount must be greater than zero'
            USING ERRCODE = '22023';
    END IF;
    IF p_amount <> round(p_amount, 2) THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: amount must have at most two decimals'
            USING ERRCODE = '22023';
    END IF;
    v_amount := p_amount::numeric(14, 2);

    -- WS-F-005b: description rules.
    v_note := nullif(btrim(coalesce(p_note, '')), '');
    IF v_note IS NOT NULL AND char_length(v_note) > 200 THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: note must be at most 200 characters'
            USING ERRCODE = '22023';
    END IF;
    IF p_reason_code = 'OTHER' AND v_note IS NULL THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: a description is required for a custom reason'
            USING ERRCODE = '22023';
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
        RAISE EXCEPTION 'PRECONDITION_FAILED: cash can only move while the session is open'
            USING ERRCODE = '55000';
    END IF;
    IF v_current_cashier_user_id <> v_user_id OR v_session_workstation_id <> v_workstation_id THEN
        RAISE EXCEPTION 'only the current cashier can record a cash movement' USING ERRCODE = '42501';
    END IF;

    -- WS-F-005b: a cash-out needs someone holding APPROVE_CASH_OUT.
    v_approver_user_id := NULL;
    IF p_movement_type = 'CASH_OUT' THEN
        IF EXISTS (
            SELECT 1
            FROM iam.user_roles ur
            JOIN iam.role_permissions rp ON rp.role_id = ur.role_id
            JOIN iam.permissions permission ON permission.id = rp.permission_id
            WHERE ur.user_id = v_user_id
              AND permission.code = 'APPROVE_CASH_OUT'
        ) THEN
            v_approver_user_id := v_user_id;
        ELSE
            IF p_approver_session_token IS NULL OR btrim(p_approver_session_token) = '' THEN
                RAISE EXCEPTION 'a manager must approve money taken out of the drawer'
                    USING ERRCODE = '42501';
            END IF;

            SELECT user_id, workstation_id
            INTO v_approver_user_id, v_approver_workstation_id
            FROM iam.resolve_session_with_permission(p_approver_session_token, 'APPROVE_CASH_OUT');

            IF v_approver_workstation_id <> v_session_workstation_id THEN
                RAISE EXCEPTION 'cash-out approval must occur on the same workstation'
                    USING ERRCODE = '42501';
            END IF;

            -- Resolving the approver's session above overwrote the
            -- transaction-local actor GUCs. cash.enforce_runtime_cash_session_operator()
            -- checks those GUCs against the session's own cashier on INSERT, so
            -- they must be restored to the cashier before the movement is written.
            PERFORM set_config('stockiha.actor_user_id', v_user_id::text, true);
            PERFORM set_config('stockiha.actor_workstation_id', v_workstation_id, true);
        END IF;
    END IF;

    IF p_movement_type = 'CASH_OUT' THEN
        v_journal_document_id := cash._post_cash_journal(
            'Cash out of drawer', 'CASH_MOVEMENT', p_cash_session_id,
            'CASH_TRANSIT', 'CASH_DESK', v_amount
        );
    ELSE
        v_journal_document_id := cash._post_cash_journal(
            'Cash into drawer', 'CASH_MOVEMENT', p_cash_session_id,
            'CASH_DESK', 'CASH_TRANSIT', v_amount
        );
    END IF;

    INSERT INTO cash.movements (
        cash_session_id, business_document_id, movement_type, amount,
        reason_code, note, recorded_by_user_id, journal_document_id,
        approved_by_user_id
    ) VALUES (
        p_cash_session_id, NULL, p_movement_type, v_amount,
        p_reason_code, v_note, v_user_id, v_journal_document_id,
        v_approver_user_id
    ) RETURNING id INTO v_movement_id;

    RETURN jsonb_build_object(
        'movement_id', v_movement_id,
        'cash_session_id', p_cash_session_id,
        'movement_type', p_movement_type,
        'amount', v_amount::text,
        'reason_code', p_reason_code,
        'journal_document_id', v_journal_document_id,
        'approved_by_user_id', v_approver_user_id
    );
END;
$$;

-- =============================================================================
-- 4. Capabilities for the cash-session screen
-- =============================================================================

CREATE OR REPLACE FUNCTION cash.get_capabilities(p_session_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_user_id bigint;
BEGIN
    SELECT user_id INTO v_user_id
    FROM iam.resolve_session(p_session_token);

    RETURN jsonb_build_object(
        'can_record_cash_movement', EXISTS (
            SELECT 1
            FROM iam.user_roles ur
            JOIN iam.role_permissions rp ON rp.role_id = ur.role_id
            JOIN iam.permissions permission ON permission.id = rp.permission_id
            WHERE ur.user_id = v_user_id
              AND permission.code = 'RECORD_CASH_MOVEMENT'
        ),
        'can_approve_cash_out', EXISTS (
            SELECT 1
            FROM iam.user_roles ur
            JOIN iam.role_permissions rp ON rp.role_id = ur.role_id
            JOIN iam.permissions permission ON permission.id = rp.permission_id
            WHERE ur.user_id = v_user_id
              AND permission.code = 'APPROVE_CASH_OUT'
        )
    );
END;
$$;

-- =============================================================================
-- 5. Privileges
-- =============================================================================

REVOKE ALL ON FUNCTION cash.record_cash_movement(text, bigint, text, numeric, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION cash.get_capabilities(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cash.record_cash_movement(text, bigint, text, numeric, text, text, text) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION cash.get_capabilities(text) TO stockiha_runtime;

-- =============================================================================
-- 6. Schema state (required on the newest migration)
-- =============================================================================

UPDATE operations.schema_state SET migration_version = 20260921090000, updated_at = now() WHERE singleton;

RESET ROLE;
