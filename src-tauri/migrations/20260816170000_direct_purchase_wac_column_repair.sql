-- Forward repair for the installed Direct Purchase posting function.
-- inventory.positions uses last_known_wac; no historical migration is edited.

SET ROLE stockiha_owner;

DO $$
DECLARE
    v_definition text;
BEGIN
    SELECT pg_get_functiondef(
        'inventory.confirm_direct_purchase(text, uuid, bytea, bigint, bigint, bigint, date, text, jsonb)'::regprocedure
    ) INTO v_definition;

    IF v_definition IS NULL THEN
        RAISE EXCEPTION 'Direct Purchase posting function is missing';
    END IF;

    v_definition := replace(v_definition, 'current_wac', 'last_known_wac');
    v_definition := replace(v_definition, 'SELECT p.unit_id, (p.is_active AND pv.is_active)',
        'SELECT pv.base_unit_id, (p.is_active AND pv.is_active)');
    EXECUTE v_definition;
END;
$$;

RESET ROLE;
