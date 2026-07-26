-- S4-002: Advanced Cash Session & Credit Override Stored Procedures

-- 1. Suspend Cash Session
CREATE OR REPLACE FUNCTION sales.suspend_cash_session(
    p_session_token text,
    p_cash_session_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, sales, iam, public
AS $$
DECLARE
    v_user_id bigint;
    v_status text;
BEGIN
    SELECT user_id INTO v_user_id
    FROM iam.resolve_session_with_permission(p_session_token, 'SUSPEND_CASH_SESSION');

    SELECT status INTO v_status
    FROM sales.cash_sessions
    WHERE id = p_cash_session_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: Cash session % not found', p_cash_session_id USING ERRCODE = '55000';
    END IF;

    IF v_status <> 'OPEN' THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: Only OPEN cash sessions can be suspended (current status: %)', v_status USING ERRCODE = '55000';
    END IF;

    UPDATE sales.cash_sessions
    SET status = 'SUSPENDED'
    WHERE id = p_cash_session_id;

    RETURN jsonb_build_object('id', p_cash_session_id, 'status', 'SUSPENDED');
END;
$$;

-- 2. Resume Cash Session
CREATE OR REPLACE FUNCTION sales.resume_cash_session(
    p_session_token text,
    p_cash_session_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, sales, iam, public
AS $$
DECLARE
    v_user_id bigint;
    v_status text;
    v_workstation_id text;
BEGIN
    SELECT user_id INTO v_user_id
    FROM iam.resolve_session_with_permission(p_session_token, 'RESUME_CASH_SESSION');

    SELECT status, workstation_id INTO v_status, v_workstation_id
    FROM sales.cash_sessions
    WHERE id = p_cash_session_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: Cash session % not found', p_cash_session_id USING ERRCODE = '55000';
    END IF;

    IF v_status <> 'SUSPENDED' THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: Only SUSPENDED cash sessions can be resumed (current status: %)', v_status USING ERRCODE = '55000';
    END IF;

    IF EXISTS (
        SELECT 1 FROM sales.cash_sessions
        WHERE workstation_id = v_workstation_id AND status = 'OPEN' AND id <> p_cash_session_id
    ) THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: Workstation % already has an OPEN cash session', v_workstation_id USING ERRCODE = '55000';
    END IF;

    UPDATE sales.cash_sessions
    SET status = 'OPEN'
    WHERE id = p_cash_session_id;

    RETURN jsonb_build_object('id', p_cash_session_id, 'status', 'OPEN');
END;
$$;

-- 3. Submit Session Closing with Denominations and Variance Check
CREATE OR REPLACE FUNCTION sales.submit_session_closing(
    p_session_token text,
    p_cash_session_id bigint,
    p_denominations jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, sales, cash, iam, public
AS $$
DECLARE
    v_user_id bigint;
    v_status text;
    v_opening_float numeric(14, 2);
    v_movement_total numeric(14, 2);
    v_expected numeric(14, 2);
    v_counted numeric(14, 2) := 0;
    v_variance numeric(14, 2);
    v_new_status text;
    v_denom record;
BEGIN
    SELECT user_id INTO v_user_id
    FROM iam.resolve_session_with_permission(p_session_token, 'CLOSE_CASH_SESSION');

    SELECT status, opening_float INTO v_status, v_opening_float
    FROM sales.cash_sessions
    WHERE id = p_cash_session_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: Cash session % not found', p_cash_session_id USING ERRCODE = '55000';
    END IF;

    IF v_status NOT IN ('OPEN', 'SUSPENDED') THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: Cash session % cannot be closed from status %', p_cash_session_id, v_status USING ERRCODE = '55000';
    END IF;

    -- Clear existing denominations if re-submitting
    DELETE FROM sales.cash_session_denominations WHERE cash_session_id = p_cash_session_id;

    -- Process Denomination Entries
    IF p_denominations IS NOT NULL AND jsonb_array_length(p_denominations) > 0 THEN
        FOR v_denom IN SELECT * FROM jsonb_to_recordset(p_denominations) AS x(denomination numeric(14,2), bill_count integer) LOOP
            IF v_denom.bill_count > 0 THEN
                INSERT INTO sales.cash_session_denominations (cash_session_id, denomination, bill_count, total_amount)
                VALUES (p_cash_session_id, v_denom.denomination, v_denom.bill_count, round(v_denom.denomination * v_denom.bill_count, 2));

                v_counted := v_counted + round(v_denom.denomination * v_denom.bill_count, 2);
            END IF;
        END LOOP;
    END IF;

    -- Calculate expected amount
    SELECT coalesce(sum(amount), 0) INTO v_movement_total
    FROM cash.movements
    WHERE cash_session_id = p_cash_session_id;

    v_expected := v_opening_float + v_movement_total;
    v_variance := v_counted - v_expected;

    -- If variance is non-zero, set to PENDING_APPROVAL; otherwise CLOSE directly
    IF v_variance <> 0 THEN
        v_new_status := 'PENDING_APPROVAL';
    ELSE
        v_new_status := 'CLOSED';
    END IF;

    UPDATE sales.cash_sessions
    SET status = v_new_status,
        closed_by_user_id = v_user_id,
        expected_amount = v_expected,
        counted_amount = v_counted,
        variance_amount = v_variance,
        closed_at = now()
    WHERE id = p_cash_session_id;

    RETURN jsonb_build_object(
        'id', p_cash_session_id,
        'status', v_new_status,
        'expected_amount', v_expected,
        'counted_amount', v_counted,
        'variance_amount', v_variance
    );
END;
$$;

-- 4. Manager Approval of Session Variance
CREATE OR REPLACE FUNCTION sales.approve_session_variance(
    p_session_token text,
    p_cash_session_id bigint,
    p_manager_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, sales, iam, public
AS $$
DECLARE
    v_user_id bigint;
    v_status text;
BEGIN
    SELECT user_id INTO v_user_id
    FROM iam.resolve_session_with_permission(p_session_token, 'APPROVE_CASH_VARIANCE');

    SELECT status INTO v_status
    FROM sales.cash_sessions
    WHERE id = p_cash_session_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: Cash session % not found', p_cash_session_id USING ERRCODE = '55000';
    END IF;

    IF v_status <> 'PENDING_APPROVAL' THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: Session % is not PENDING_APPROVAL (status: %)', p_cash_session_id, v_status USING ERRCODE = '55000';
    END IF;

    UPDATE sales.cash_sessions
    SET status = 'CLOSED'
    WHERE id = p_cash_session_id;

    RETURN jsonb_build_object('id', p_cash_session_id, 'status', 'CLOSED', 'approved_by', v_user_id);
END;
$$;

-- 5. List Pending Variance Sessions for Managers
CREATE OR REPLACE FUNCTION sales.list_pending_variance_sessions(
    p_session_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, sales, iam, public
AS $$
DECLARE
    v_user_id bigint;
    v_result jsonb;
BEGIN
    SELECT user_id INTO v_user_id
    FROM iam.resolve_session_with_permission(p_session_token, 'APPROVE_CASH_VARIANCE');

    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', cs.id,
            'warehouse_id', cs.warehouse_id,
            'workstation_id', cs.workstation_id,
            'opened_by_user_id', cs.opened_by_user_id,
            'opened_by_name', u_open.username,
            'closed_by_user_id', cs.closed_by_user_id,
            'closed_by_name', u_close.username,
            'status', cs.status,
            'opening_float', cs.opening_float::text,
            'expected_amount', cs.expected_amount::text,
            'counted_amount', cs.counted_amount::text,
            'variance_amount', cs.variance_amount::text,
            'opened_at', to_char(cs.opened_at AT TIME ZONE 'Africa/Algiers', 'YYYY-MM-DD"T"HH24:MI:SS'),
            'closed_at', to_char(cs.closed_at AT TIME ZONE 'Africa/Algiers', 'YYYY-MM-DD"T"HH24:MI:SS')
        ) ORDER BY cs.closed_at DESC
    ), '[]'::jsonb)
    INTO v_result
    FROM sales.cash_sessions cs
    JOIN iam.users u_open ON u_open.id = cs.opened_by_user_id
    LEFT JOIN iam.users u_close ON u_close.id = cs.closed_by_user_id
    WHERE cs.status = 'PENDING_APPROVAL';

    RETURN v_result;
END;
$$;

-- 6. Generate Single-Use Credit Override Token
CREATE OR REPLACE FUNCTION sales.generate_credit_override_token(
    p_session_token text,
    p_customer_id bigint,
    p_payload_hash bytea,
    p_valid_minutes integer DEFAULT 15
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, sales, iam, public
AS $$
DECLARE
    v_user_id bigint;
    v_token uuid;
    v_expires_at timestamptz;
BEGIN
    SELECT user_id INTO v_user_id
    FROM iam.resolve_session_with_permission(p_session_token, 'AUTHORIZE_CREDIT_OVERRIDE');

    IF NOT EXISTS (SELECT 1 FROM sales.customers WHERE id = p_customer_id) THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: Customer % not found', p_customer_id USING ERRCODE = '55000';
    END IF;

    v_token := gen_random_uuid();
    v_expires_at := now() + (p_valid_minutes || ' minutes')::interval;

    INSERT INTO sales.credit_override_tokens (token, customer_id, payload_hash, generated_by_user_id, expires_at)
    VALUES (v_token, p_customer_id, p_payload_hash, v_user_id, v_expires_at);

    RETURN jsonb_build_object(
        'token', v_token,
        'customer_id', p_customer_id,
        'expires_at', to_char(v_expires_at AT TIME ZONE 'Africa/Algiers', 'YYYY-MM-DD"T"HH24:MI:SS')
    );
END;
$$;

-- 7. Verify & Redeem Single-Use Credit Override Token (Internal Helper)
CREATE OR REPLACE FUNCTION sales.verify_and_use_credit_override_token(
    p_token uuid,
    p_customer_id bigint,
    p_payload_hash bytea
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, sales, public
AS $$
DECLARE
    v_token_id bigint;
BEGIN
    SELECT id INTO v_token_id
    FROM sales.credit_override_tokens
    WHERE token = p_token
      AND customer_id = p_customer_id
      AND payload_hash = p_payload_hash
      AND used_at IS NULL
      AND is_invalidated = FALSE
      AND expires_at > now()
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;

    UPDATE sales.credit_override_tokens
    SET used_at = now()
    WHERE id = v_token_id;

    RETURN TRUE;
END;
$$;

REVOKE EXECUTE ON FUNCTION sales.suspend_cash_session(text, bigint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION sales.resume_cash_session(text, bigint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION sales.submit_session_closing(text, bigint, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION sales.approve_session_variance(text, bigint, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION sales.list_pending_variance_sessions(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION sales.generate_credit_override_token(text, bigint, bytea, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION sales.verify_and_use_credit_override_token(uuid, bigint, bytea) FROM PUBLIC;

-- 8. Updated inspect_active_cash_session to return status and include SUSPENDED / PENDING_APPROVAL sessions
DROP FUNCTION IF EXISTS sales.inspect_active_cash_session(text, text);
CREATE OR REPLACE FUNCTION sales.inspect_active_cash_session(
    p_session_token text,
    p_workstation_id text
)
RETURNS TABLE (
    id bigint,
    warehouse_id bigint,
    opened_by_user_id bigint,
    opening_float numeric,
    status text,
    opened_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, sales, iam, public
AS $$
BEGIN
    PERFORM 1 FROM iam.resolve_session(p_session_token);

    RETURN QUERY
        SELECT cs.id, cs.warehouse_id, cs.opened_by_user_id, cs.opening_float, cs.status, cs.opened_at
        FROM sales.cash_sessions cs
        WHERE cs.workstation_id = p_workstation_id AND cs.status IN ('OPEN', 'SUSPENDED', 'PENDING_APPROVAL');
END;
$$;

REVOKE EXECUTE ON FUNCTION sales.inspect_active_cash_session(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sales.inspect_active_cash_session(text, text) TO stockiha_runtime;

GRANT EXECUTE ON FUNCTION sales.suspend_cash_session(text, bigint) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION sales.resume_cash_session(text, bigint) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION sales.submit_session_closing(text, bigint, jsonb) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION sales.approve_session_variance(text, bigint, text) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION sales.list_pending_variance_sessions(text) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION sales.generate_credit_override_token(text, bigint, bytea, integer) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION sales.verify_and_use_credit_override_token(uuid, bigint, bytea) TO stockiha_runtime;

