-- Forward repair: Direct Purchase uses the canonical variant_units table.

SET ROLE stockiha_owner;

DO $$
DECLARE v_definition text;
BEGIN
    SELECT pg_get_functiondef('inventory.confirm_direct_purchase(text, uuid, bytea, bigint, bigint, bigint, date, text, jsonb)'::regprocedure) INTO v_definition;
    v_definition := replace(v_definition, $match$            SELECT conversion_factor
            INTO v_conversion_factor
            FROM catalog.unit_conversions
            WHERE variant_id = v_variant_id
              AND from_unit_id = v_unit_id
              AND to_unit_id = v_base_unit_id;

            IF NOT FOUND THEN
                SELECT conversion_factor
                INTO v_conversion_factor
                FROM catalog.unit_conversions
                WHERE product_id = (SELECT product_id FROM catalog.product_variants WHERE id = v_variant_id)
                  AND variant_id IS NULL
                  AND from_unit_id = v_unit_id
                  AND to_unit_id = v_base_unit_id;
            END IF;$match$, $replacement$            SELECT conversion_factor
            INTO v_conversion_factor
            FROM catalog.variant_units
            WHERE variant_id = v_variant_id
              AND unit_id = v_unit_id
            FOR SHARE;$replacement$);
    IF position('catalog.unit_conversions' IN v_definition) > 0 THEN RAISE EXCEPTION 'Direct Purchase unit conversion replacement failed'; END IF;
    EXECUTE v_definition;
END;
$$;

RESET ROLE;
