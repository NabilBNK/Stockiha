-- Slice 1 Frontend MVP batch: read a single cash session (open OR closed) by
-- id, including the immutable expected/counted/variance snapshot the close
-- flow computed. Needed so the UI can display the BACKEND-authoritative
-- expected cash and variance after closing, rather than recomputing them in
-- React. Session-validated read.
SET ROLE stockiha_owner;

CREATE FUNCTION sales.get_cash_session(p_session_token text, p_cash_session_id bigint)
RETURNS TABLE (
    id               bigint,
    warehouse_id     bigint,
    status           text,
    opening_float    numeric,
    expected_amount  numeric,
    counted_amount   numeric,
    variance_amount  numeric,
    opened_at        timestamptz,
    closed_at        timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    PERFORM 1 FROM iam.resolve_session(p_session_token);
    RETURN QUERY
        SELECT cs.id, cs.warehouse_id, cs.status, cs.opening_float, cs.expected_amount,
               cs.counted_amount, cs.variance_amount, cs.opened_at, cs.closed_at
        FROM sales.cash_sessions cs
        WHERE cs.id = p_cash_session_id;
END;
$$;

REVOKE ALL ON FUNCTION sales.get_cash_session(text, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sales.get_cash_session(text, bigint) TO stockiha_runtime;

RESET ROLE;
