-- S4-003 existing-database compatibility: normalize ownership of every
-- pre-existing function that this slice replaces with CREATE OR REPLACE.
--
-- Real Windows development databases may contain canonical functions owned by
-- postgres instead of the dedicated stockiha_owner role. PostgreSQL only lets
-- the current owner replace a function, so normalize the known historical
-- postgres owner before the production migration enters SET ROLE
-- stockiha_owner. Unexpected owners fail loudly.
DO $$
DECLARE
    v_signature text;
    v_oid oid;
    v_owner text;
BEGIN
    FOREACH v_signature IN ARRAY ARRAY[
        'cash.enqueue_drawer_job(bigint,bigint,text)',
        'receivables.post_customer_payment(text,uuid,bigint,numeric,text,bigint,bigint,date,jsonb,text)',
        'receivables.list_open_customer_invoices(text,bigint)',
        'receivables.reconcile_customer_credit_state(text,bigint)',
        'receivables.get_customer_capabilities(text)'
    ]
    LOOP
        v_oid := to_regprocedure(v_signature);
        IF v_oid IS NULL THEN
            RAISE EXCEPTION 'expected S4-003 replace-target function is missing: %', v_signature;
        END IF;

        SELECT pg_get_userbyid(proowner)
        INTO v_owner
        FROM pg_proc
        WHERE oid = v_oid;

        IF v_owner = 'stockiha_owner' THEN
            CONTINUE;
        ELSIF v_owner = 'postgres' THEN
            EXECUTE format('ALTER FUNCTION %s OWNER TO stockiha_owner', v_oid::regprocedure);
        ELSE
            RAISE EXCEPTION
                'unexpected owner % for S4-003 replace-target function %',
                v_owner,
                v_signature;
        END IF;
    END LOOP;
END;
$$;
