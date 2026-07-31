-- S4-002 existing-database compatibility for legacy function ownership drift.
--
-- Some development databases were historically provisioned with selected
-- SECURITY DEFINER functions owned by `postgres` instead of the canonical
-- `stockiha_owner`. The S4-002 lifecycle migration replaces those functions;
-- PostgreSQL only permits CREATE OR REPLACE by the owning role (or a
-- superuser), so normalize the known legacy ownership before entering the
-- owner-scoped migration.
--
-- This migration intentionally does NOT SET ROLE. It must run from the
-- administrative migration connection. Canonical databases are a no-op.

DO $$
DECLARE
    v_signature text;
    v_oid oid;
    v_owner text;
BEGIN
    FOREACH v_signature IN ARRAY ARRAY[
        'iam.resolve_session(text)',
        'iam.resolve_session_with_permission(text,text)',
        'sales.open_cash_session(text,bigint,text,numeric)',
        'sales.inspect_active_cash_session(text,text)'
    ]
    LOOP
        v_oid := to_regprocedure(v_signature);

        IF v_oid IS NULL THEN
            RAISE EXCEPTION 'expected pre-S4-002 function is missing: %', v_signature;
        END IF;

        SELECT pg_get_userbyid(p.proowner)
        INTO v_owner
        FROM pg_proc p
        WHERE p.oid = v_oid;

        IF v_owner = 'stockiha_owner' THEN
            CONTINUE;
        ELSIF v_owner = 'postgres' THEN
            EXECUTE format(
                'ALTER FUNCTION %s OWNER TO stockiha_owner',
                v_oid::regprocedure
            );
        ELSE
            RAISE EXCEPTION
                'unexpected owner % for %, expected stockiha_owner or known historical postgres owner',
                v_owner,
                v_signature;
        END IF;
    END LOOP;
END;
$$;
