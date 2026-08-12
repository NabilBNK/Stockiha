-- R2 existing-database compatibility: normalize the historical S3 objects
-- that were created without SET ROLE stockiha_owner. CREATE OR REPLACE and
-- new constraints must not depend on postgres ownership.
DO $$
DECLARE
    v_relation text;
    v_oid regclass;
    v_owner text;
    v_signature text;
    v_function_oid oid;
BEGIN
    FOREACH v_relation IN ARRAY ARRAY[
        'inventory.receipt_cost_attribution',
        'procurement.supplier_invoices',
        'procurement.supplier_invoice_lines',
        'procurement.supplier_returns',
        'procurement.supplier_return_lines',
        'procurement.supplier_payments'
    ]
    LOOP
        v_oid := to_regclass(v_relation);
        IF v_oid IS NULL THEN
            RAISE EXCEPTION 'expected R2 relation is missing: %', v_relation;
        END IF;

        SELECT pg_get_userbyid(c.relowner)
        INTO v_owner
        FROM pg_class c
        WHERE c.oid = v_oid;

        IF v_owner = 'stockiha_owner' THEN
            CONTINUE;
        ELSIF v_owner IN ('postgres', 'stockiha_admin', 'stockiha_migrator') THEN
            EXECUTE format('ALTER TABLE %s OWNER TO stockiha_owner', v_oid);
        ELSE
            RAISE EXCEPTION 'unexpected owner % for R2 relation %', v_owner, v_relation;
        END IF;
    END LOOP;

    FOREACH v_signature IN ARRAY ARRAY[
        'inventory.allocate_landed_cost(text,uuid,bytea,bigint,numeric,text,bigint,date,text)',
        'procurement.confirm_supplier_invoice(text,uuid,bytea,bigint,bigint,date)',
        'inventory.confirm_supplier_return(text,uuid,bytea,bigint,bigint,date)',
        'procurement.post_supplier_payment(text,uuid,bytea,bigint,bigint,numeric,text,bigint,date,text)'
    ]
    LOOP
        v_function_oid := to_regprocedure(v_signature);
        IF v_function_oid IS NULL THEN
            RAISE EXCEPTION 'expected R2 replace-target function is missing: %', v_signature;
        END IF;

        SELECT pg_get_userbyid(p.proowner)
        INTO v_owner
        FROM pg_proc p
        WHERE p.oid = v_function_oid;

        IF v_owner = 'stockiha_owner' THEN
            CONTINUE;
        ELSIF v_owner IN ('postgres', 'stockiha_admin', 'stockiha_migrator') THEN
            EXECUTE format('ALTER FUNCTION %s OWNER TO stockiha_owner', v_function_oid::regprocedure);
        ELSE
            RAISE EXCEPTION 'unexpected owner % for R2 function %', v_owner, v_signature;
        END IF;
    END LOOP;
END;
$$;
