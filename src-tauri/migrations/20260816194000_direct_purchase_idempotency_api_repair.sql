-- Forward repair: use the installed idempotency result API.

SET ROLE stockiha_owner;

DO $$
DECLARE v_definition text;
BEGIN
    SELECT pg_get_functiondef('inventory.confirm_direct_purchase(text, uuid, bytea, bigint, bigint, bigint, date, text, jsonb)'::regprocedure) INTO v_definition;
    v_definition := replace(v_definition, 'core.store_idempotent_result(', 'core.record_idempotent_result(');
    EXECUTE v_definition;
END;
$$;

RESET ROLE;
