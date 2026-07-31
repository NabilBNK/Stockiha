-- S4-002 existing-database compatibility for historical/local lifecycle APIs.
--
-- Some development databases contain earlier cash-session lifecycle functions
-- that are not part of the canonical migration chain. The production S4-002
-- migration creates the canonical API with CREATE FUNCTION, so an existing
-- function with the same input signature blocks the upgrade before any app
-- code can run.
--
-- Do not guess which historical implementation is safe to keep. Quarantine
-- every known S4-002 target name that already exists, revoke runtime/public
-- execution, and rename it to a deterministic legacy name. The following
-- lifecycle migration then creates the canonical implementation under the
-- production name. Renaming preserves the historical object for audit/debug
-- purposes without leaving it on the runtime API surface.
--
-- This migration intentionally runs from the administrative migration
-- connection and does not SET ROLE because historical objects may be owned by
-- postgres or stockiha_owner.

DO $$
DECLARE
    v_signature text;
    v_oid oid;
    v_schema text;
    v_name text;
    v_args text;
    v_legacy_name text;
    v_legacy_signature text;
BEGIN
    FOREACH v_signature IN ARRAY ARRAY[
        'sales.inspect_current_cash_session(text,text)',
        'sales.list_cash_denominations(text)',
        'sales.begin_cash_session_close(text,bigint)',
        'sales.cancel_cash_session_close(text,bigint)',
        'sales.submit_cash_session_count(text,bigint,jsonb)',
        'sales.approve_cash_session_variance(text,bigint,bigint,text)',
        'sales.suspend_cash_session(text,bigint,text)',
        'sales.resume_cash_session(text,bigint)',
        'sales.handover_cash_session(text,bigint,text,text)'
    ]
    LOOP
        v_oid := to_regprocedure(v_signature);
        IF v_oid IS NULL THEN
            CONTINUE;
        END IF;

        SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)
        INTO v_schema, v_name, v_args
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE p.oid = v_oid;

        v_legacy_name := v_name || '_legacy_s4002';
        v_legacy_signature := format('%I.%I(%s)', v_schema, v_legacy_name, v_args);

        IF to_regprocedure(v_legacy_signature) IS NOT NULL THEN
            RAISE EXCEPTION
                'cannot quarantine historical function %: legacy target % already exists',
                v_signature,
                v_legacy_signature;
        END IF;

        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', v_oid::regprocedure);
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM stockiha_runtime', v_oid::regprocedure);
        EXECUTE format('ALTER FUNCTION %s RENAME TO %I', v_oid::regprocedure, v_legacy_name);
    END LOOP;
END;
$$;
