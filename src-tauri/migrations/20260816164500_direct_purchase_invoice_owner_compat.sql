-- Direct Purchase supplier-invoice replacement ownership compatibility.
--
-- The historical create_supplier_invoice_draft function predates the owner-role
-- discipline and can therefore be owned by postgres on a fresh/admin-applied
-- database or by stockiha_migrator / stockiha_admin on an existing database.
-- The Direct Purchase read-model migration replaces this function, so normalize
-- only this known legacy replace target before SET ROLE stockiha_owner is used.

DO $$
DECLARE
    v_signature text := 'procurement.create_supplier_invoice_draft(text,bigint,bigint,text,numeric,text,jsonb)';
    v_function_oid oid;
    v_owner text;
BEGIN
    v_function_oid := to_regprocedure(v_signature);
    IF v_function_oid IS NULL THEN
        RAISE EXCEPTION 'expected supplier invoice draft function is missing: %', v_signature;
    END IF;

    SELECT pg_get_userbyid(p.proowner)
    INTO v_owner
    FROM pg_proc p
    WHERE p.oid = v_function_oid;

    IF v_owner = 'stockiha_owner' THEN
        RETURN;
    ELSIF v_owner IN ('postgres', 'stockiha_admin', 'stockiha_migrator') THEN
        EXECUTE format(
            'ALTER FUNCTION %s OWNER TO stockiha_owner',
            v_function_oid::regprocedure
        );
    ELSE
        RAISE EXCEPTION 'unexpected owner % for Direct Purchase replace target %',
            v_owner, v_signature;
    END IF;
END;
$$;

SET ROLE stockiha_owner;

UPDATE operations.schema_state
SET migration_version = 20260816164500,
    updated_at = now()
WHERE singleton;

RESET ROLE;
