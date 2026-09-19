-- WS-F-005: cash in/out during a session, a workable variance tolerance, and
-- the closing variance posted to the ledger.
--
-- Three gaps are closed:
--   1. cash.session_policy.material_variance_threshold shipped as 0, so any
--      difference at all demanded a manager. The smallest coin is 50 DA, so
--      anything under 50 can only be a miscount. It becomes 50.
--   2. cash.movements accepted only 'SALE'. Money that leaves or enters the
--      drawer for any other reason was invisible and showed up as a shortfall.
--   3. Closing a session recorded the variance but posted no journal, so the
--      ledger's cash balance drifted away from the drawer with no trace.
--
-- Amounts stay positive everywhere; direction is carried by movement_type.
-- cash.movements remains append-only -- its immutability trigger is untouched.

SET ROLE stockiha_owner;

-- =============================================================================
-- 1. Permissions
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

    IF v_existing_check NOT LIKE '%RECORD_CASH_MOVEMENT%' THEN
        ALTER TABLE iam.permissions DROP CONSTRAINT permissions_code_valid;
        EXECUTE format(
            'ALTER TABLE iam.permissions ADD CONSTRAINT permissions_code_valid CHECK ((%s) OR code = ANY (ARRAY[%L,%L]::text[]))',
            v_existing_check,
            'RECORD_CASH_MOVEMENT',
            'MANAGE_CASH_POLICY'
        );
    END IF;
END;
$$;

INSERT INTO iam.permissions (code, name) VALUES
    ('RECORD_CASH_MOVEMENT', 'Record cash taken from or added to the drawer'),
    ('MANAGE_CASH_POLICY', 'Change the cash variance tolerance')
ON CONFLICT (code) DO NOTHING;

INSERT INTO iam.role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM iam.roles role
CROSS JOIN iam.permissions permission
WHERE role.code IN ('CASHIER', 'MANAGER', 'ADMIN')
  AND permission.code = 'RECORD_CASH_MOVEMENT'
ON CONFLICT DO NOTHING;

INSERT INTO iam.role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM iam.roles role
CROSS JOIN iam.permissions permission
WHERE role.code IN ('MANAGER', 'ADMIN')
  AND permission.code = 'MANAGE_CASH_POLICY'
ON CONFLICT DO NOTHING;

-- =============================================================================
-- 2. Ledger accounts
-- =============================================================================

INSERT INTO finance.accounts
    (scf_code, legacy_code, name_fr, name_en, account_type, normal_balance, parent_id, is_postable, is_control, control_kind)
VALUES
    ('58', NULL, 'Virements internes', 'Internal transfers', 'asset', 'debit', NULL, false, false, NULL)
ON CONFLICT (scf_code) DO NOTHING;

INSERT INTO finance.accounts
    (scf_code, legacy_code, name_fr, name_en, account_type, normal_balance, parent_id, is_postable, is_control, control_kind)
VALUES
    ('581', 'CASH_TRANSIT', 'Virements de fonds', 'Cash in transit',
     'asset', 'debit', (SELECT id FROM finance.accounts WHERE scf_code = '58'), true, false, NULL),
    ('6588', 'CASH_VARIANCE', 'Écarts de caisse', 'Cash over and short',
     'expense', 'debit', (SELECT id FROM finance.accounts WHERE scf_code = '65'), true, false, NULL)
ON CONFLICT (scf_code) DO NOTHING;

-- =============================================================================
-- 3. Tolerance: 50 DA, only if it is still the shipped default of 0
-- =============================================================================

UPDATE cash.session_policy
SET material_variance_threshold = 50.00
WHERE id = 1
  AND material_variance_threshold = 0;

-- =============================================================================
-- 4. cash.movements gains direction, reason and actor
-- =============================================================================

ALTER TABLE cash.movements
    DROP CONSTRAINT IF EXISTS movements_movement_type_valid;
ALTER TABLE cash.movements
    ADD CONSTRAINT movements_movement_type_valid
    CHECK (movement_type IN ('SALE', 'CUSTOMER_PAYMENT', 'CUSTOMER_REFUND', 'CASH_IN', 'CASH_OUT'));

ALTER TABLE cash.movements
    DROP CONSTRAINT IF EXISTS movements_amount_direction_valid;
ALTER TABLE cash.movements
    ADD CONSTRAINT movements_amount_direction_valid CHECK (
        (movement_type IN ('SALE', 'CUSTOMER_PAYMENT', 'CASH_IN', 'CASH_OUT') AND amount > 0)
        OR (movement_type = 'CUSTOMER_REFUND' AND amount < 0)
    );

ALTER TABLE cash.movements
    ADD COLUMN IF NOT EXISTS reason_code text;
ALTER TABLE cash.movements
    ADD COLUMN IF NOT EXISTS note text;
ALTER TABLE cash.movements
    ADD COLUMN IF NOT EXISTS recorded_by_user_id bigint REFERENCES iam.users (id) ON DELETE RESTRICT;
ALTER TABLE cash.movements
    ADD COLUMN IF NOT EXISTS journal_document_id bigint REFERENCES finance.journal_entries (document_id) ON DELETE RESTRICT;

-- A SALE row carries no reason and is written by the sale function; CASH_IN and
-- CASH_OUT must always carry one. Existing rows are all SALE, so this is safe.
ALTER TABLE cash.movements
    DROP CONSTRAINT IF EXISTS movements_reason_required_for_manual;
ALTER TABLE cash.movements
    ADD CONSTRAINT movements_reason_required_for_manual CHECK (
        movement_type IN ('SALE', 'CUSTOMER_PAYMENT', 'CUSTOMER_REFUND')
        OR reason_code IN ('SUPPLIER_PAYMENT', 'EXPENSE', 'CHANGE_FLOAT', 'CORRECTION', 'OTHER')
    );

-- =============================================================================
-- 5. Shared helper: post a cash journal for this session, today
-- =============================================================================

CREATE OR REPLACE FUNCTION cash._post_cash_journal(
    p_description text,
    p_source_type text,
    p_source_id bigint,
    p_debit_account text,
    p_credit_account text,
    p_amount numeric
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_today date := (now() AT TIME ZONE 'Africa/Algiers')::date;
    v_period_id bigint;
    v_fiscal_year integer;
    v_journal_document_id bigint;
    v_sequence bigint;
    v_journal_number text;
BEGIN
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: journal amount must be positive' USING ERRCODE = '22023';
    END IF;

    SELECT id, extract(year FROM starts_on)::integer
    INTO v_period_id, v_fiscal_year
    FROM finance.fiscal_periods
    WHERE status = 'OPEN'
      AND v_today BETWEEN starts_on AND ends_on
    ORDER BY starts_on DESC
    LIMIT 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: no open fiscal period covers today'
            USING ERRCODE = '55000';
    END IF;

    INSERT INTO core.business_documents (document_type, document_date, fiscal_period_id, fiscal_year)
        VALUES ('JOURNAL_ENTRY', v_today, v_period_id, v_fiscal_year)
        RETURNING id INTO v_journal_document_id;

    INSERT INTO finance.journal_entries (document_id, description, source_type, source_id)
        VALUES (v_journal_document_id, p_description, p_source_type, p_source_id);

    INSERT INTO finance.journal_lines (document_id, line_number, account_code, account_id, debit, credit) VALUES
        (v_journal_document_id, 1, p_debit_account, finance.resolve_account_id(p_debit_account), p_amount, 0),
        (v_journal_document_id, 2, p_credit_account, finance.resolve_account_id(p_credit_account), 0, p_amount);

    v_sequence := core.claim_next_document_number('JOURNAL_ENTRY', v_fiscal_year);
    v_journal_number := 'JE-' || v_fiscal_year || '-' || lpad(v_sequence::text, 6, '0');
    UPDATE core.business_documents
        SET status = 'POSTED', sequence_number = v_sequence,
            document_number = v_journal_number, posted_at = now()
        WHERE id = v_journal_document_id;

    RETURN v_journal_document_id;
END;
$$;

-- =============================================================================
-- 6. Record money in or out of the drawer
-- =============================================================================

CREATE OR REPLACE FUNCTION cash.record_cash_movement(
    p_session_token text,
    p_cash_session_id bigint,
    p_movement_type text,
    p_amount numeric,
    p_reason_code text,
    p_note text
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
        reason_code, note, recorded_by_user_id, journal_document_id
    ) VALUES (
        p_cash_session_id, NULL, p_movement_type, v_amount,
        p_reason_code, nullif(btrim(coalesce(p_note, '')), ''), v_user_id, v_journal_document_id
    ) RETURNING id INTO v_movement_id;

    RETURN jsonb_build_object(
        'movement_id', v_movement_id,
        'cash_session_id', p_cash_session_id,
        'movement_type', p_movement_type,
        'amount', v_amount::text,
        'reason_code', p_reason_code,
        'journal_document_id', v_journal_document_id
    );
END;
$$;

-- =============================================================================
-- 7. Read models
-- =============================================================================

CREATE OR REPLACE FUNCTION cash.list_cash_movements(
    p_session_token text,
    p_cash_session_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_result jsonb;
BEGIN
    PERFORM 1 FROM iam.resolve_session(p_session_token);

    SELECT coalesce(jsonb_agg(
        jsonb_build_object(
            'movement_id', m.id,
            'movement_type', m.movement_type,
            'amount', m.amount::text,
            'reason_code', m.reason_code,
            'note', m.note,
            'business_document_id', m.business_document_id,
            'journal_document_id', m.journal_document_id,
            'created_at', m.created_at
        ) ORDER BY m.created_at DESC, m.id DESC
    ), '[]'::jsonb)
    INTO v_result
    FROM cash.movements m
    WHERE m.cash_session_id = p_cash_session_id;

    RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION cash.get_session_policy(p_session_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_result jsonb;
BEGIN
    PERFORM 1 FROM iam.resolve_session(p_session_token);

    SELECT jsonb_build_object(
        'material_variance_threshold', policy.material_variance_threshold::text,
        'updated_at', policy.updated_at
    )
    INTO v_result
    FROM cash.session_policy policy
    WHERE policy.id = 1;

    RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION cash.save_session_policy(
    p_session_token text,
    p_material_variance_threshold numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_CASH_POLICY');

    IF p_material_variance_threshold IS NULL OR p_material_variance_threshold < 0 THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: tolerance must not be negative' USING ERRCODE = '22023';
    END IF;
    IF p_material_variance_threshold <> round(p_material_variance_threshold, 2) THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: tolerance must have at most two decimals'
            USING ERRCODE = '22023';
    END IF;

    UPDATE cash.session_policy
    SET material_variance_threshold = p_material_variance_threshold::numeric(14, 2)
    WHERE id = 1;

    RETURN cash.get_session_policy(p_session_token);
END;
$$;

-- =============================================================================
-- 8. Replace the blind-count submission
-- =============================================================================

CREATE OR REPLACE FUNCTION cash.submit_cash_session_count(
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

    -- WS-F-005 change 1 of 2: expected cash is now signed. A sale and a cash-in
    -- add to the drawer; a cash-out takes away. Amounts are stored positive, so
    -- the direction is applied here rather than in the stored value.
    SELECT round(v_opening_float + coalesce(sum(
        CASE WHEN m.movement_type = 'CASH_OUT' THEN -m.amount ELSE m.amount END
    ), 0), 2)
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

        -- WS-F-005 change 2 of 2: a closing difference is real money and now
        -- reaches the ledger. Short: the shop lost it, so the expense is
        -- debited and cash credited. Over: the reverse.
        IF v_variance < 0 THEN
            PERFORM cash._post_cash_journal(
                'Cash session shortfall', 'CASH_SESSION', p_cash_session_id,
                'CASH_VARIANCE', 'CASH_DESK', -v_variance
            );
        ELSIF v_variance > 0 THEN
            PERFORM cash._post_cash_journal(
                'Cash session overage', 'CASH_SESSION', p_cash_session_id,
                'CASH_DESK', 'CASH_VARIANCE', v_variance
            );
        END IF;

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

-- =============================================================================
-- 9. Replace the manager approval so it posts the same journal
-- =============================================================================

CREATE OR REPLACE FUNCTION cash.approve_cash_session_variance(
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

    -- WS-F-005: an approved variance posts the same journal an auto-accepted
    -- one does. Approval changes who signed it off, not the accounting.
    IF v_variance < 0 THEN
        PERFORM cash._post_cash_journal(
            'Cash session shortfall', 'CASH_SESSION', p_cash_session_id,
            'CASH_VARIANCE', 'CASH_DESK', -v_variance
        );
    ELSIF v_variance > 0 THEN
        PERFORM cash._post_cash_journal(
            'Cash session overage', 'CASH_SESSION', p_cash_session_id,
            'CASH_DESK', 'CASH_VARIANCE', v_variance
        );
    END IF;

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

-- =============================================================================
-- 10. Privileges
-- =============================================================================

REVOKE ALL ON FUNCTION cash._post_cash_journal(text, text, bigint, text, text, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION cash.record_cash_movement(text, bigint, text, numeric, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION cash.list_cash_movements(text, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION cash.get_session_policy(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION cash.save_session_policy(text, numeric) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION cash.record_cash_movement(text, bigint, text, numeric, text, text) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION cash.list_cash_movements(text, bigint) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION cash.get_session_policy(text) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION cash.save_session_policy(text, numeric) TO stockiha_runtime;

RESET ROLE;
