-- S4-002 existing-database compatibility for historical
-- sales.inspect_active_cash_session return-table drift.
--
-- Canonical repository history exposes five columns:
--   id, warehouse_id, opened_by_user_id, opening_float, opened_at
--
-- Some legitimate development databases carry a six-column variant that
-- additionally exposes status. PostgreSQL cannot change RETURNS TABLE / OUT
-- parameters with CREATE OR REPLACE FUNCTION. Preserve that historical object
-- under an inert legacy name, revoke application execution, and leave the
-- canonical name free for the S4-002 lifecycle migration to create.
SET ROLE stockiha_owner;

DO $$
DECLARE
    v_oid oid := to_regprocedure('sales.inspect_active_cash_session(text,text)');
    v_result text;
    v_canonical constant text :=
        'TABLE(id bigint, warehouse_id bigint, opened_by_user_id bigint, opening_float numeric, opened_at timestamp with time zone)';
    v_historical constant text :=
        'TABLE(id bigint, warehouse_id bigint, opened_by_user_id bigint, opening_float numeric, status text, opened_at timestamp with time zone)';
BEGIN
    IF v_oid IS NULL THEN
        RAISE EXCEPTION 'expected pre-S4-002 function is missing: sales.inspect_active_cash_session(text,text)';
    END IF;

    SELECT pg_get_function_result(v_oid)
    INTO v_result;

    IF v_result = v_canonical THEN
        RETURN;
    ELSIF v_result = v_historical THEN
        REVOKE ALL ON FUNCTION sales.inspect_active_cash_session(text, text) FROM PUBLIC;
        REVOKE EXECUTE ON FUNCTION sales.inspect_active_cash_session(text, text) FROM stockiha_runtime;
        ALTER FUNCTION sales.inspect_active_cash_session(text, text)
            RENAME TO inspect_active_cash_session_legacy_s4002;
    ELSE
        RAISE EXCEPTION
            'unexpected return shape for sales.inspect_active_cash_session(text,text): %',
            v_result;
    END IF;
END;
$$;

RESET ROLE;
