-- Slice 1 MVP batch: cash session open / inspect / close
-- (final-architecture.md section 3.E — minimal Slice 1 scope only: no
-- blind counts or variance approval workflow yet, just the
-- opening/expected/counted/variance snapshot fields the schema already
-- carries).
SET ROLE stockiha_owner;

CREATE FUNCTION sales.open_cash_session(
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
    v_session_id bigint;
BEGIN
    SELECT user_id INTO v_user_id
        FROM iam.resolve_session_with_permission(p_session_token, 'OPEN_CASH_SESSION');

    IF p_opening_float < 0 THEN
        RAISE EXCEPTION 'opening float must not be negative' USING ERRCODE = '22023';
    END IF;

    PERFORM 1 FROM inventory.warehouses WHERE id = p_warehouse_id FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'warehouse % not found', p_warehouse_id USING ERRCODE = '22023';
    END IF;

    BEGIN
        INSERT INTO sales.cash_sessions (warehouse_id, workstation_id, opened_by_user_id, opening_float)
            VALUES (p_warehouse_id, p_workstation_id, v_user_id, p_opening_float)
            RETURNING id INTO v_session_id;
    EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION 'workstation % already has an open cash session', p_workstation_id
            USING ERRCODE = '55000';
    END;

    RETURN v_session_id;
END;
$$;

-- Read-only inspection of the active session for a workstation. Requires
-- only a valid, live session (any permission) — inspecting is not itself a
-- protected posting operation.
CREATE FUNCTION sales.inspect_active_cash_session(
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
BEGIN
    PERFORM 1 FROM iam.resolve_session(p_session_token);

    RETURN QUERY
        SELECT cs.id, cs.warehouse_id, cs.opened_by_user_id, cs.opening_float, cs.opened_at
        FROM sales.cash_sessions cs
        WHERE cs.workstation_id = p_workstation_id AND cs.status = 'OPEN';
END;
$$;

-- Closes an open cash session, computing and preserving the immutable
-- expected/counted/variance snapshot. `expected_amount` is the opening
-- float plus every cash-in movement recorded against this session; the
-- caller supplies the physically counted amount.
CREATE FUNCTION sales.close_cash_session(
    p_session_token text,
    p_cash_session_id bigint,
    p_counted_amount numeric
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_user_id bigint;
    v_status text;
    v_opening_float numeric;
    v_movement_total numeric;
    v_expected numeric;
    v_variance numeric;
BEGIN
    SELECT user_id INTO v_user_id
        FROM iam.resolve_session_with_permission(p_session_token, 'CLOSE_CASH_SESSION');

    IF p_counted_amount < 0 THEN
        RAISE EXCEPTION 'counted amount must not be negative' USING ERRCODE = '22023';
    END IF;

    SELECT status, opening_float INTO v_status, v_opening_float
        FROM sales.cash_sessions
        WHERE id = p_cash_session_id
        FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'cash session % not found', p_cash_session_id USING ERRCODE = '22023';
    END IF;
    IF v_status <> 'OPEN' THEN
        RAISE EXCEPTION 'cash session % is not open', p_cash_session_id USING ERRCODE = '55000';
    END IF;

    SELECT coalesce(sum(amount), 0) INTO v_movement_total
        FROM cash.movements
        WHERE cash_session_id = p_cash_session_id;

    v_expected := v_opening_float + v_movement_total;
    v_variance := p_counted_amount - v_expected;

    UPDATE sales.cash_sessions
        SET status = 'CLOSED',
            closed_by_user_id = v_user_id,
            expected_amount = v_expected,
            counted_amount = p_counted_amount,
            variance_amount = v_variance,
            closed_at = now()
        WHERE id = p_cash_session_id;

    RETURN p_cash_session_id;
END;
$$;


REVOKE ALL ON FUNCTION sales.open_cash_session(text, bigint, text, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION sales.inspect_active_cash_session(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION sales.close_cash_session(text, bigint, numeric) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION sales.open_cash_session(text, bigint, text, numeric) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION sales.inspect_active_cash_session(text, text) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION sales.close_cash_session(text, bigint, numeric) TO stockiha_runtime;

RESET ROLE;
