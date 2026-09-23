-- WS-M-3: end-of-day cash session report data.
--
-- One read-only function, `cash.get_session_report`, that assembles the
-- figures an operator needs to print at end of day: session identity, sales
-- (cash/credit/void), manual cash movements, customer payments/refunds, and
-- the expected/counted/variance figures. Every figure is derived from
-- existing tables -- no new business data is introduced by this migration.
--
-- "Expected cash" reuses, verbatim, the signed formula from
-- cash.submit_cash_session_count (WS-F-005): opening_float plus every
-- cash.movements row for the session, with CASH_OUT subtracted (every other
-- movement type already carries the correct sign in its stored amount).
-- For a CLOSED session the already-computed, already-audited
-- sales.cash_sessions.expected_amount/counted_amount/variance_amount are
-- read back instead of recomputed, so a printed report never disagrees with
-- what the session actually closed at.
--
-- "Credit sale" reuses, verbatim, the workstation+time-window definition
-- from sales.list_session_sales (WS-F-006): credit sales carry no
-- cash_session_id, so they are matched by workstation_id and
-- opened_at..closed_at (open-ended while the session is still open).

SET ROLE stockiha_owner;

CREATE OR REPLACE FUNCTION cash.get_session_report(
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
    v_status text;
    v_workstation_id text;
    v_opened_at timestamptz;
    v_closed_at timestamptz;
    v_opened_by_user_id bigint;
    v_closed_by_user_id bigint;
    v_opening_float numeric(14,2);
    v_stored_expected numeric(14,2);
    v_stored_counted numeric(14,2);
    v_stored_variance numeric(14,2);
    v_expected numeric(14,2);
    v_counted numeric(14,2);
    v_variance numeric(14,2);
    v_variance_approved_by text;
    v_tolerance numeric(14,2);
    v_cash_count integer;
    v_cash_total numeric(14,2);
    v_void_count integer;
    v_void_total numeric(14,2);
    v_credit_count integer;
    v_credit_total numeric(14,2);
    v_cash_in_total numeric(14,2);
    v_cash_out_total numeric(14,2);
    v_payments_total numeric(14,2);
    v_refunds_total numeric(14,2);
    v_movement_rows jsonb;
    v_result jsonb;
BEGIN
    PERFORM 1 FROM iam.resolve_session(p_session_token);

    SELECT status, workstation_id, opened_at, closed_at,
           opened_by_user_id, closed_by_user_id, opening_float,
           expected_amount, counted_amount, variance_amount
    INTO v_status, v_workstation_id, v_opened_at, v_closed_at,
         v_opened_by_user_id, v_closed_by_user_id, v_opening_float,
         v_stored_expected, v_stored_counted, v_stored_variance
    FROM sales.cash_sessions
    WHERE id = p_cash_session_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: cash session not found' USING ERRCODE = '22023';
    END IF;

    -- Sales (cash / void) from cash.movements for this session.
    SELECT
        count(*) FILTER (WHERE m.movement_type = 'SALE'),
        coalesce(sum(m.amount) FILTER (WHERE m.movement_type = 'SALE'), 0),
        count(*) FILTER (WHERE m.movement_type = 'SALE_VOID'),
        coalesce(sum(-m.amount) FILTER (WHERE m.movement_type = 'SALE_VOID'), 0),
        coalesce(sum(m.amount) FILTER (WHERE m.movement_type = 'CASH_IN'), 0),
        coalesce(sum(m.amount) FILTER (WHERE m.movement_type = 'CASH_OUT'), 0),
        coalesce(sum(m.amount) FILTER (WHERE m.movement_type = 'CUSTOMER_PAYMENT'), 0),
        coalesce(sum(-m.amount) FILTER (WHERE m.movement_type = 'CUSTOMER_REFUND'), 0)
    INTO v_cash_count, v_cash_total, v_void_count, v_void_total,
         v_cash_in_total, v_cash_out_total, v_payments_total, v_refunds_total
    FROM cash.movements m
    WHERE m.cash_session_id = p_cash_session_id;

    -- Credit sales: same workstation, created within the session's window --
    -- identical definition to sales.list_session_sales (WS-F-006).
    SELECT count(*), coalesce(sum(cr.total_amount), 0)
    INTO v_credit_count, v_credit_total
    FROM sales.credit_sales cr
    JOIN core.business_documents d ON d.id = cr.document_id
    WHERE cr.workstation_id = v_workstation_id
      AND cr.created_at >= v_opened_at
      AND (v_closed_at IS NULL OR cr.created_at <= v_closed_at)
      AND d.status IN ('POSTED', 'REVERSED');

    -- Manual cash-in/cash-out movements, itemized.
    SELECT coalesce(jsonb_agg(
        jsonb_build_object(
            'type', m.movement_type,
            'reason_code', m.reason_code,
            'note', m.note,
            'amount', m.amount::text,
            'recorded_at', m.created_at
        ) ORDER BY m.created_at
    ), '[]'::jsonb)
    INTO v_movement_rows
    FROM cash.movements m
    WHERE m.cash_session_id = p_cash_session_id
      AND m.movement_type IN ('CASH_IN', 'CASH_OUT');

    -- Expected/counted/variance: read back the audited figures for a closed
    -- session; recompute live (WS-F-005's exact formula) for one still open.
    IF v_status = 'CLOSED' THEN
        v_expected := v_stored_expected;
        v_counted := v_stored_counted;
        v_variance := v_stored_variance;
    ELSE
        SELECT round(v_opening_float + coalesce(sum(
            CASE WHEN m.movement_type = 'CASH_OUT' THEN -m.amount ELSE m.amount END
        ), 0), 2)
        INTO v_expected
        FROM cash.movements m
        WHERE m.cash_session_id = p_cash_session_id;
        v_counted := NULL;
        v_variance := NULL;
    END IF;

    SELECT u.username INTO v_variance_approved_by
    FROM cash.session_close_attempts a
    JOIN cash.session_close_approvals ap ON ap.close_attempt_id = a.id
    JOIN iam.users u ON u.id = ap.approved_by_user_id
    WHERE a.cash_session_id = p_cash_session_id
    ORDER BY a.attempt_number DESC
    LIMIT 1;

    SELECT material_variance_threshold INTO v_tolerance
    FROM cash.session_policy
    WHERE id = 1;

    SELECT jsonb_build_object(
        'session', jsonb_build_object(
            'id', p_cash_session_id,
            'status', v_status,
            'workstation_id', v_workstation_id,
            'opened_at', v_opened_at,
            'closed_at', v_closed_at,
            'opened_by', (SELECT username FROM iam.users WHERE id = v_opened_by_user_id),
            'closed_by', (SELECT username FROM iam.users WHERE id = v_closed_by_user_id),
            'opening_float', v_opening_float::text
        ),
        'sales', jsonb_build_object(
            'cash_count', v_cash_count,
            'cash_total', v_cash_total::text,
            'credit_count', v_credit_count,
            'credit_total', v_credit_total::text,
            'void_count', v_void_count,
            'void_total', v_void_total::text
        ),
        'movements', jsonb_build_object(
            'cash_in_total', v_cash_in_total::text,
            'cash_out_total', v_cash_out_total::text,
            'rows', v_movement_rows
        ),
        'customer', jsonb_build_object(
            'payments_total', v_payments_total::text,
            'refunds_total', v_refunds_total::text
        ),
        'cash', jsonb_build_object(
            'expected', v_expected::text,
            'counted', v_counted::text,
            'variance', v_variance::text,
            'variance_approved_by', v_variance_approved_by,
            'tolerance', v_tolerance::text
        )
    )
    INTO v_result;

    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION cash.get_session_report(text, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cash.get_session_report(text, bigint) TO stockiha_runtime;

UPDATE operations.schema_state SET migration_version = 20260925090000, updated_at = now() WHERE singleton;

RESET ROLE;
