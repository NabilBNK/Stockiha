-- WS-B-1 Gate 3a (part 3): convert inventory.confirm_supplier_return.
--
-- This function's finance.add_journal_line calls were already shaped
-- correctly (they simply pointed at a function that never existed). Only two
-- textual changes are needed:
--   1. The unconditional 'INVENTORY_MERCHANDISE' call site used the legacy
--      code where an account_role_code enum member was required -- the
--      correct member for the same account is 'INVENTORY' (approved fix,
--      same class as Gate 2's CASH -> CASH_DESK correction).
--   2. core.store_idempotent_result never existed; core.record_idempotent_result
--      is the real, already-installed function with the same call shape.
--
-- The v_clearing_role call (already a valid finance.account_role_code value)
-- and both PURCHASE_PRICE_VARIANCE call sites are left completely untouched:
-- PURCHASE_PRICE_VARIANCE is not an enum member and no account exists for it
-- yet -- seeding one is an explicitly separate future task. Those two
-- branches remain exactly as broken as before this migration.
SET ROLE stockiha_owner;

CREATE OR REPLACE FUNCTION inventory.confirm_supplier_return(p_session_token text, p_request_id uuid, p_request_hash bytea, p_return_doc_id bigint, p_fiscal_period_id bigint, p_document_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
    v_user_id bigint;
    v_workstation_id text;
    v_existing_document_id bigint;
    v_return_status text;
    v_return_id bigint;
    v_supplier_id bigint;
    v_warehouse_id bigint;
    v_purchase_order_id bigint;
    v_receipt_document_id bigint;
    v_period_status text;
    v_period_start date;
    v_period_end date;
    v_fiscal_year integer := extract(year FROM p_document_date)::integer;
    v_invoice_count integer;
    v_invoice_document_id bigint;
    v_liability_id bigint;
    v_liability_outstanding numeric(14,2);
    v_clearing_role finance.account_role_code;
    v_return_sequence bigint;
    v_return_number text;
    v_journal_document_id bigint;
    v_clearing_amount numeric(14,2) := 0;
    v_inventory_value numeric(14,2) := 0;
    v_variance numeric(14,2);
    v_line record;
    v_received_qty numeric(18,3);
    v_previously_returned_qty numeric(18,3);
    v_authoritative_unit_cost numeric(18,6);
    v_position_qty numeric(18,3);
    v_position_value numeric(18,4);
    v_wac numeric(18,6);
    v_issue_value numeric(14,2);
    v_movement_id bigint;
    v_journal_line_number integer := 1;
BEGIN
    SELECT user_id, workstation_id
    INTO v_user_id, v_workstation_id
    FROM iam.resolve_session_with_permission(p_session_token, 'POST_SUPPLIER_RETURN');

    v_existing_document_id := core.reserve_idempotent_request(
        'inventory.confirm_supplier_return', p_request_id, p_request_hash
    );
    IF v_existing_document_id IS NOT NULL THEN
        SELECT bd.document_number, je.document_id
        INTO v_return_number, v_journal_document_id
        FROM core.business_documents bd
        LEFT JOIN finance.journal_entries je
          ON je.source_type = 'PURCHASE_RETURN' AND je.source_id = bd.id
        WHERE bd.id = v_existing_document_id;
        RETURN jsonb_build_object(
            'document_id', v_existing_document_id,
            'document_number', v_return_number,
            'status', 'POSTED',
            'journal_document_id', v_journal_document_id
        );
    END IF;

    SELECT bd.status, sr.id, sr.supplier_id, sr.warehouse_id, sr.purchase_order_id, sr.receipt_document_id
    INTO v_return_status, v_return_id, v_supplier_id, v_warehouse_id, v_purchase_order_id, v_receipt_document_id
    FROM core.business_documents bd
    JOIN procurement.supplier_returns sr ON sr.document_id = bd.id
    WHERE bd.id = p_return_doc_id
    FOR UPDATE OF bd;

    IF NOT FOUND OR v_return_status <> 'DRAFT' THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: Supplier return % is not in DRAFT status', p_return_doc_id USING ERRCODE = '55000';
    END IF;

    SELECT status, starts_on, ends_on
    INTO v_period_status, v_period_start, v_period_end
    FROM finance.fiscal_periods
    WHERE id = p_fiscal_period_id
    FOR SHARE;
    IF NOT FOUND OR v_period_status <> 'OPEN' THEN
        RAISE EXCEPTION 'CLOSED_FISCAL_PERIOD: Fiscal period % is not open', p_fiscal_period_id USING ERRCODE = '55000';
    END IF;
    IF p_document_date < v_period_start OR p_document_date > v_period_end THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Document date is outside fiscal period' USING ERRCODE = '22023';
    END IF;

    -- Count related invoices
    SELECT count(DISTINCT inv.document_id), min(inv.document_id)
    INTO v_invoice_count, v_invoice_document_id
    FROM procurement.supplier_invoices inv
    JOIN core.business_documents bd ON bd.id = inv.document_id AND bd.status = 'POSTED'
    WHERE (
        (v_purchase_order_id IS NOT NULL AND inv.purchase_order_id = v_purchase_order_id)
        OR (v_receipt_document_id IS NOT NULL AND inv.document_id IN (
            SELECT sil.document_id FROM procurement.supplier_invoice_lines sil
            WHERE sil.receipt_line_id IN (
                SELECT id FROM procurement.purchase_receipt_lines WHERE document_id = v_receipt_document_id
            )
        ))
    )
    AND inv.supplier_id = v_supplier_id;

    IF v_invoice_count > 1 THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: Return allocation is ambiguous across multiple supplier invoices'
            USING ERRCODE = '55000';
    ELSIF v_invoice_count = 1 THEN
        SELECT id, outstanding_amount
        INTO v_liability_id, v_liability_outstanding
        FROM procurement.supplier_liabilities
        WHERE invoice_document_id = v_invoice_document_id
          AND supplier_id = v_supplier_id
        FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'PRECONDITION_FAILED: Posted supplier invoice has no payable liability' USING ERRCODE = '55000';
        END IF;
        v_clearing_role := 'ACCOUNTS_PAYABLE';
    ELSE
        v_clearing_role := 'GRNI';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM procurement.supplier_return_lines WHERE return_id = v_return_id
    ) THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Supplier return requires at least one line' USING ERRCODE = '22023';
    END IF;

    PERFORM 1
    FROM inventory.positions pos
    WHERE pos.warehouse_id = v_warehouse_id
      AND pos.variant_id IN (
          SELECT DISTINCT srl.variant_id
          FROM procurement.supplier_return_lines srl
          WHERE srl.return_id = v_return_id
      )
    ORDER BY pos.variant_id
    FOR UPDATE;

    FOR v_line IN
        SELECT id, variant_id, quantity
        FROM procurement.supplier_return_lines
        WHERE return_id = v_return_id
        ORDER BY line_number, id
    LOOP
        SELECT COALESCE(sum(prl.quantity_received), 0)
        INTO v_received_qty
        FROM procurement.purchase_receipt_lines prl
        JOIN procurement.purchase_receipts pr ON pr.document_id = prl.document_id
        JOIN core.business_documents bd ON bd.id = pr.document_id AND bd.status = 'POSTED'
        WHERE (
            (v_purchase_order_id IS NOT NULL AND pr.purchase_order_id = v_purchase_order_id)
            OR (v_receipt_document_id IS NOT NULL AND pr.document_id = v_receipt_document_id)
            OR (v_purchase_order_id IS NULL AND v_receipt_document_id IS NULL AND pr.supplier_id = v_supplier_id AND pr.warehouse_id = v_warehouse_id)
        )
        AND pr.supplier_id = v_supplier_id
        AND pr.warehouse_id = v_warehouse_id
        AND prl.variant_id = v_line.variant_id;

        SELECT COALESCE(sum(other_line.quantity), 0)
        INTO v_previously_returned_qty
        FROM procurement.supplier_return_lines other_line
        JOIN procurement.supplier_returns other_return ON other_return.id = other_line.return_id
        JOIN core.business_documents other_doc ON other_doc.id = other_return.document_id
        WHERE (
            (v_purchase_order_id IS NOT NULL AND other_return.purchase_order_id = v_purchase_order_id)
            OR (v_receipt_document_id IS NOT NULL AND other_return.receipt_document_id = v_receipt_document_id)
            OR (v_purchase_order_id IS NULL AND v_receipt_document_id IS NULL AND other_return.supplier_id = v_supplier_id AND other_return.warehouse_id = v_warehouse_id)
        )
        AND other_return.supplier_id = v_supplier_id
        AND other_return.warehouse_id = v_warehouse_id
        AND other_line.variant_id = v_line.variant_id
        AND other_return.id <> v_return_id
        AND other_doc.status = 'POSTED';

        IF v_line.quantity + v_previously_returned_qty > v_received_qty THEN
            RAISE EXCEPTION 'PRECONDITION_FAILED: Return quantity exceeds received quantity for variant %', v_line.variant_id
                USING ERRCODE = '55000';
        END IF;

        IF v_invoice_count = 1 THEN
            SELECT round(sum(sil.quantity * sil.unit_cost * inv.exchange_rate_to_dzd) / sum(sil.quantity), 6)
            INTO v_authoritative_unit_cost
            FROM procurement.supplier_invoice_lines sil
            JOIN procurement.supplier_invoices inv ON inv.document_id = sil.document_id
            WHERE sil.document_id = v_invoice_document_id
              AND sil.variant_id = v_line.variant_id;
        ELSE
            SELECT round(sum(prl.quantity_received * prl.unit_cost) / sum(prl.quantity_received), 6)
            INTO v_authoritative_unit_cost
            FROM procurement.purchase_receipt_lines prl
            JOIN procurement.purchase_receipts pr ON pr.document_id = prl.document_id
            WHERE (
                (v_purchase_order_id IS NOT NULL AND pr.purchase_order_id = v_purchase_order_id)
                OR (v_receipt_document_id IS NOT NULL AND pr.document_id = v_receipt_document_id)
                OR (v_purchase_order_id IS NULL AND v_receipt_document_id IS NULL AND pr.supplier_id = v_supplier_id AND pr.warehouse_id = v_warehouse_id)
            )
            AND pr.supplier_id = v_supplier_id
            AND pr.warehouse_id = v_warehouse_id
            AND prl.variant_id = v_line.variant_id;
        END IF;

        IF v_authoritative_unit_cost IS NULL THEN
            RAISE EXCEPTION 'PRECONDITION_FAILED: No authoritative purchase cost exists for variant %', v_line.variant_id
                USING ERRCODE = '55000';
        END IF;

        SELECT quantity_on_hand, total_value
        INTO v_position_qty, v_position_value
        FROM inventory.positions
        WHERE warehouse_id = v_warehouse_id
          AND variant_id = v_line.variant_id
        FOR UPDATE;

        IF NOT FOUND OR v_position_qty < v_line.quantity THEN
            RAISE EXCEPTION 'NEGATIVE_STOCK_FORBIDDEN: Warehouse has insufficient quantity on hand for variant %', v_line.variant_id
                USING ERRCODE = '55000';
        END IF;

        IF v_position_qty = 0 THEN
            v_wac := 0.000000;
        ELSE
            v_wac := round(v_position_value / v_position_qty, 6);
        END IF;

        v_issue_value := round(v_line.quantity * v_wac, 2);
        v_clearing_amount := v_clearing_amount + round(v_line.quantity * v_authoritative_unit_cost, 2);
        v_inventory_value := v_inventory_value + v_issue_value;

        INSERT INTO inventory.movements (
            warehouse_id, variant_id, movement_type,
            quantity_delta, value_delta, unit_cost,
            reference_document_id, created_by_user_id
        ) VALUES (
            v_warehouse_id, v_line.variant_id, 'PURCHASE_RETURN',
            -v_line.quantity, -v_issue_value, v_wac,
            p_return_doc_id, v_user_id
        ) RETURNING id INTO v_movement_id;

        IF v_position_qty - v_line.quantity = 0 THEN
            UPDATE inventory.positions
            SET quantity_on_hand = 0,
                total_value = 0.00,
                current_wac = v_wac,
                updated_at = now()
            WHERE warehouse_id = v_warehouse_id AND variant_id = v_line.variant_id;
        ELSE
            UPDATE inventory.positions
            SET quantity_on_hand = quantity_on_hand - v_line.quantity,
                total_value = round(total_value - v_issue_value, 2),
                current_wac = round((total_value - v_issue_value) / (quantity_on_hand - v_line.quantity), 6),
                updated_at = now()
            WHERE warehouse_id = v_warehouse_id AND variant_id = v_line.variant_id;
        END IF;

        UPDATE procurement.supplier_return_lines
        SET unit_cost = v_authoritative_unit_cost,
            line_total = round(v_line.quantity * v_authoritative_unit_cost, 2)
        WHERE id = v_line.id;
    END LOOP;

    IF v_clearing_role = 'ACCOUNTS_PAYABLE' AND v_clearing_amount > v_liability_outstanding THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: Return amount % exceeds outstanding liability %',
            v_clearing_amount, v_liability_outstanding USING ERRCODE = '55000';
    END IF;

    v_variance := round(v_clearing_amount - v_inventory_value, 2);
    v_return_sequence := core.claim_next_document_number('PURCHASE_RETURN', v_fiscal_year);
    v_return_number := 'PRT-' || v_fiscal_year || '-' || lpad(v_return_sequence::text, 6, '0');

    v_journal_document_id := finance.create_posted_journal(
        p_document_date,
        p_fiscal_period_id,
        'Supplier return ' || v_return_number,
        'PURCHASE_RETURN',
        p_return_doc_id
    );

    PERFORM finance.add_journal_line(
        v_journal_document_id,
        v_journal_line_number,
        v_clearing_role,
        v_clearing_amount,
        0.00,
        'Supplier return clearing debit'
    );
    v_journal_line_number := v_journal_line_number + 1;

    PERFORM finance.add_journal_line(
        v_journal_document_id,
        v_journal_line_number,
        'INVENTORY',
        0.00,
        v_inventory_value,
        'Supplier return inventory credit'
    );
    v_journal_line_number := v_journal_line_number + 1;

    IF v_variance > 0 THEN
        PERFORM finance.add_journal_line(
            v_journal_document_id,
            v_journal_line_number,
            'PURCHASE_PRICE_VARIANCE',
            0.00,
            v_variance,
            'Supplier return favorable variance'
        );
    ELSIF v_variance < 0 THEN
        PERFORM finance.add_journal_line(
            v_journal_document_id,
            v_journal_line_number,
            'PURCHASE_PRICE_VARIANCE',
            abs(v_variance),
            0.00,
            'Supplier return unfavorable variance'
        );
    END IF;

    IF v_clearing_role = 'ACCOUNTS_PAYABLE' THEN
        UPDATE procurement.supplier_liabilities
        SET outstanding_amount = round(outstanding_amount - v_clearing_amount, 2),
            status = CASE
                WHEN round(outstanding_amount - v_clearing_amount, 2) = 0 THEN 'PAID'
                ELSE 'PARTIALLY_PAID'
            END
        WHERE id = v_liability_id;
    END IF;

    UPDATE core.business_documents
    SET status = 'POSTED',
        sequence_number = v_return_sequence,
        document_number = v_return_number,
        document_date = p_document_date,
        fiscal_period_id = p_fiscal_period_id,
        fiscal_year = v_fiscal_year,
        posted_at = now()
    WHERE id = p_return_doc_id;

    PERFORM core.record_idempotent_result(
        'inventory.confirm_supplier_return', p_request_id, p_return_doc_id
    );

    RETURN jsonb_build_object(
        'document_id', p_return_doc_id,
        'document_number', v_return_number,
        'status', 'POSTED',
        'journal_document_id', v_journal_document_id
    );
END;
$function$;

RESET ROLE;
