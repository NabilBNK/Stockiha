-- Forward repair: align Direct Purchase movement rows with the established
-- inventory movement ledger contract. Historical migrations remain unchanged.

SET ROLE stockiha_owner;

DO $$
DECLARE
    v_definition text;
    v_old_block text := $old$
        -- Insert Inventory Movement
        INSERT INTO inventory.movements (
            warehouse_id, variant_id, movement_type,
            quantity_delta, value_delta, unit_cost,
            reference_document_id, created_by_user_id
        ) VALUES (
            p_warehouse_id, v_variant_id, 'PURCHASE_RECEIPT',
            v_base_qty_received, v_value_delta, v_unit_cost,
            v_receipt_document_id, v_user_id
        ) RETURNING id INTO v_movement_id;

        -- Update Inventory Position & Recalculate WAC
        SELECT quantity_on_hand, total_value, last_known_wac
        INTO v_old_qty, v_old_value, v_old_wac
        FROM inventory.positions
        WHERE warehouse_id = p_warehouse_id AND variant_id = v_variant_id
        FOR UPDATE;

        IF NOT FOUND THEN
            v_new_qty := v_base_qty_received;
            v_new_value := v_value_delta;
            v_new_wac := round(v_new_value / v_new_qty, 6);

            INSERT INTO inventory.positions (
                warehouse_id, variant_id, quantity_on_hand, total_value, last_known_wac
            ) VALUES (
                p_warehouse_id, v_variant_id, v_new_qty, v_new_value, v_new_wac
            );
        ELSE
            v_new_qty := v_old_qty + v_base_qty_received;
            v_new_value := v_old_value + v_value_delta;
            IF v_new_qty > 0 THEN
                v_new_wac := round(v_new_value / v_new_qty, 6);
            ELSE
                v_new_wac := v_old_wac;
            END IF;

            UPDATE inventory.positions
            SET quantity_on_hand = v_new_qty,
                total_value = v_new_value,
                last_known_wac = v_new_wac,
                updated_at = now()
            WHERE warehouse_id = p_warehouse_id AND variant_id = v_variant_id;
        END IF;
$old$;
    v_new_block text := $new$
        -- Lock or create the position before calculating its resulting balance.
        INSERT INTO inventory.positions (warehouse_id, variant_id)
        VALUES (p_warehouse_id, v_variant_id)
        ON CONFLICT (warehouse_id, variant_id) DO NOTHING;

        SELECT quantity_on_hand, total_value, last_known_wac
        INTO v_old_qty, v_old_value, v_old_wac
        FROM inventory.positions
        WHERE warehouse_id = p_warehouse_id AND variant_id = v_variant_id
        FOR UPDATE;

        v_new_qty := v_old_qty + v_base_qty_received;
        v_new_value := v_old_value + v_value_delta;
        v_new_wac := CASE WHEN v_new_qty > 0 THEN round(v_new_value / v_new_qty, 6) ELSE v_old_wac END;

        UPDATE inventory.positions
        SET quantity_on_hand = v_new_qty,
            total_value = v_new_value,
            last_known_wac = v_new_wac,
            updated_at = now()
        WHERE warehouse_id = p_warehouse_id AND variant_id = v_variant_id;

        INSERT INTO inventory.movements (
            warehouse_id, variant_id, movement_type, quantity_delta,
            inventory_value_delta, resulting_quantity_on_hand,
            resulting_total_value, reference_type, reference_id
        ) VALUES (
            p_warehouse_id, v_variant_id, 'RECEIPT', v_base_qty_received,
            v_value_delta, v_new_qty, v_new_value,
            'PURCHASE_RECEIPT', v_receipt_document_id
        ) RETURNING id INTO v_movement_id;
$new$;
BEGIN
    SELECT pg_get_functiondef(
        'inventory.confirm_direct_purchase(text, uuid, bytea, bigint, bigint, bigint, date, text, jsonb)'::regprocedure
    ) INTO v_definition;
    v_definition := replace(v_definition, v_old_block, v_new_block);
    IF position('value_delta, unit_cost' IN v_definition) > 0 THEN
        RAISE EXCEPTION 'Direct Purchase movement contract replacement failed';
    END IF;
    EXECUTE v_definition;
END;
$$;

RESET ROLE;
