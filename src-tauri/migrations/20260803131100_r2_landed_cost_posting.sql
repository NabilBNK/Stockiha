-- R2: landed cost updates inventory/variance and creates one traceable AP
-- liability. One allocation per receipt is the bounded MVP policy.
SET ROLE stockiha_owner;

CREATE OR REPLACE FUNCTION inventory.allocate_landed_cost(
    p_session_token text,
    p_request_id uuid,
    p_payload_hash bytea,
    p_receipt_id bigint,
    p_landed_cost_amount numeric(14,2),
    p_allocation_method text,
    p_fiscal_period_id bigint,
    p_document_date date,
    p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_user_id bigint;
    v_workstation_id text;
    v_existing_journal_id bigint;
    v_receipt_status text;
    v_warehouse_id bigint;
    v_supplier_id bigint;
    v_purchase_order_id bigint;
    v_period_status text;
    v_period_start date;
    v_period_end date;
    v_total_receipt_qty numeric(18,3);
    v_total_receipt_value numeric(14,2);
    v_line_count integer;
    v_processed_count integer := 0;
    v_allocated_so_far numeric(14,2) := 0;
    v_line record;
    v_attribution_id bigint;
    v_allocated_cost numeric(14,2);
    v_remaining_cost numeric(14,2);
    v_sold_cost numeric(14,2);
    v_qty_on_hand numeric(18,3);
    v_current_value numeric(18,4);
    v_new_value numeric(18,4);
    v_new_wac numeric(18,6);
    v_inventory_debit numeric(14,2) := 0;
    v_variance_debit numeric(14,2) := 0;
    v_journal_document_id bigint;
    v_line_number integer := 1;
BEGIN
    SELECT user_id, workstation_id
    INTO v_user_id, v_workstation_id
    FROM iam.resolve_session_with_permission(p_session_token, 'POST_SUPPLIER_INVOICE');

    v_existing_journal_id := core.reserve_idempotent_request(
        'inventory.allocate_landed_cost', p_request_id, p_payload_hash
    );
    IF v_existing_journal_id IS NOT NULL THEN
        RETURN jsonb_build_object(
            'receipt_id', p_receipt_id,
            'landed_cost_amount', p_landed_cost_amount,
            'status', 'POSTED',
            'journal_document_id', v_existing_journal_id
        );
    END IF;

    IF p_landed_cost_amount IS NULL OR p_landed_cost_amount <= 0 THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Landed cost amount must be positive' USING ERRCODE = '22023';
    END IF;
    IF p_allocation_method NOT IN ('BY_QTY', 'BY_VALUE', 'EQUAL_PER_LINE') THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Invalid allocation method %', p_allocation_method USING ERRCODE = '22023';
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

    SELECT doc.status, pr.warehouse_id, pr.supplier_id, pr.purchase_order_id
    INTO v_receipt_status, v_warehouse_id, v_supplier_id, v_purchase_order_id
    FROM core.business_documents doc
    JOIN procurement.purchase_receipts pr ON pr.document_id = doc.id
    WHERE doc.id = p_receipt_id
    FOR UPDATE OF doc;
    IF NOT FOUND OR v_receipt_status <> 'POSTED' THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: Receipt % is not posted', p_receipt_id USING ERRCODE = '55000';
    END IF;

    IF EXISTS (
        SELECT 1 FROM procurement.landed_cost_postings WHERE receipt_document_id = p_receipt_id
    ) THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: Receipt % already has a landed-cost posting', p_receipt_id USING ERRCODE = '55000';
    END IF;
    IF EXISTS (
        SELECT 1
        FROM procurement.supplier_liabilities
        WHERE receipt_document_id = p_receipt_id
    ) THEN
        RAISE EXCEPTION 'HISTORICAL_S3_DEFECT: Receipt % has a pre-R2 AP liability and requires append-only reconciliation first', p_receipt_id
            USING ERRCODE = '55000';
    END IF;

    SELECT COALESCE(sum(quantity_received), 0), COALESCE(sum(line_total), 0), count(*)
    INTO v_total_receipt_qty, v_total_receipt_value, v_line_count
    FROM procurement.purchase_receipt_lines
    WHERE document_id = p_receipt_id;
    IF v_line_count = 0 OR v_total_receipt_qty <= 0 THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: Receipt has no lines to allocate' USING ERRCODE = '55000';
    END IF;
    IF p_allocation_method = 'BY_VALUE' AND v_total_receipt_value <= 0 THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: BY_VALUE requires a positive receipt value' USING ERRCODE = '55000';
    END IF;

    PERFORM 1
    FROM inventory.positions pos
    WHERE pos.warehouse_id = v_warehouse_id
      AND pos.variant_id IN (
          SELECT DISTINCT prl.variant_id
          FROM procurement.purchase_receipt_lines prl
          WHERE prl.document_id = p_receipt_id
      )
    ORDER BY pos.variant_id
    FOR UPDATE;

    FOR v_line IN
        SELECT id, variant_id, quantity_received, unit_cost, line_total
        FROM procurement.purchase_receipt_lines
        WHERE document_id = p_receipt_id
        ORDER BY id
    LOOP
        v_processed_count := v_processed_count + 1;
        IF v_processed_count = v_line_count THEN
            v_allocated_cost := p_landed_cost_amount - v_allocated_so_far;
        ELSIF p_allocation_method = 'BY_QTY' THEN
            v_allocated_cost := round(p_landed_cost_amount * v_line.quantity_received / v_total_receipt_qty, 2);
        ELSIF p_allocation_method = 'BY_VALUE' THEN
            v_allocated_cost := round(p_landed_cost_amount * v_line.line_total / v_total_receipt_value, 2);
        ELSE
            v_allocated_cost := round(p_landed_cost_amount / v_line_count, 2);
        END IF;
        v_allocated_so_far := v_allocated_so_far + v_allocated_cost;

        SELECT id
        INTO v_attribution_id
        FROM inventory.receipt_cost_attribution
        WHERE receipt_line_id = v_line.id
        ORDER BY id
        LIMIT 1
        FOR UPDATE;
        IF v_attribution_id IS NULL THEN
            INSERT INTO inventory.receipt_cost_attribution (
                receipt_line_id, variant_id, warehouse_id, original_quantity,
                attributed_remaining_quantity, original_unit_cost
            ) VALUES (
                v_line.id, v_line.variant_id, v_warehouse_id, v_line.quantity_received,
                v_line.quantity_received, v_line.unit_cost
            ) RETURNING id INTO v_attribution_id;
        END IF;

        SELECT quantity_on_hand, total_value
        INTO v_qty_on_hand, v_current_value
        FROM inventory.positions
        WHERE warehouse_id = v_warehouse_id AND variant_id = v_line.variant_id
        FOR UPDATE;

        IF v_qty_on_hand IS NULL OR v_qty_on_hand <= 0 THEN
            v_remaining_cost := 0;
            v_sold_cost := v_allocated_cost;
        ELSE
            v_remaining_cost := round(
                v_allocated_cost * least(v_qty_on_hand, v_line.quantity_received) / v_line.quantity_received,
                2
            );
            v_sold_cost := v_allocated_cost - v_remaining_cost;
            v_new_value := v_current_value + v_remaining_cost;
            v_new_wac := round(v_new_value / v_qty_on_hand, 6);

            UPDATE inventory.positions
            SET total_value = v_new_value,
                last_known_wac = v_new_wac,
                updated_at = now()
            WHERE warehouse_id = v_warehouse_id AND variant_id = v_line.variant_id;

            INSERT INTO inventory.movements (
                warehouse_id, variant_id, movement_type, quantity_delta,
                inventory_value_delta, resulting_quantity_on_hand,
                resulting_total_value, reference_type, reference_id
            ) VALUES (
                v_warehouse_id, v_line.variant_id, 'COST_ONLY', 0,
                v_remaining_cost, v_qty_on_hand, v_new_value,
                'PURCHASE_RECEIPT', p_receipt_id
            );
        END IF;

        UPDATE inventory.receipt_cost_attribution
        SET late_cost_allocated = late_cost_allocated + v_allocated_cost,
            updated_at = now()
        WHERE id = v_attribution_id;

        v_inventory_debit := v_inventory_debit + v_remaining_cost;
        v_variance_debit := v_variance_debit + v_sold_cost;
    END LOOP;

    IF v_allocated_so_far <> p_landed_cost_amount THEN
        RAISE EXCEPTION 'ALLOCATION_ERROR: Landed cost allocation did not reconcile' USING ERRCODE = '22000';
    END IF;

    v_journal_document_id := finance.create_posted_journal(
        p_document_date,
        p_fiscal_period_id,
        'Landed cost allocation journal entry',
        'LANDED_COST',
        p_receipt_id
    );

    IF v_inventory_debit > 0 THEN
        INSERT INTO finance.journal_lines (document_id, line_number, account_code, debit, credit)
        VALUES (v_journal_document_id, v_line_number, finance.require_account_role('INVENTORY'), v_inventory_debit, 0);
        v_line_number := v_line_number + 1;
    END IF;
    IF v_variance_debit > 0 THEN
        INSERT INTO finance.journal_lines (document_id, line_number, account_code, debit, credit)
        VALUES (v_journal_document_id, v_line_number, finance.require_account_role('PROCUREMENT_VARIANCE'), v_variance_debit, 0);
        v_line_number := v_line_number + 1;
    END IF;
    INSERT INTO finance.journal_lines (document_id, line_number, account_code, debit, credit)
    VALUES (v_journal_document_id, v_line_number, finance.require_account_role('ACCOUNTS_PAYABLE'), 0, p_landed_cost_amount);

    INSERT INTO procurement.landed_cost_postings (
        receipt_document_id, supplier_id, journal_document_id, amount
    ) VALUES (
        p_receipt_id, v_supplier_id, v_journal_document_id, p_landed_cost_amount
    );

    INSERT INTO procurement.supplier_liabilities (
        supplier_id, purchase_order_id, receipt_document_id,
        journal_document_id, original_amount, outstanding_amount, due_date, status
    ) VALUES (
        v_supplier_id, v_purchase_order_id, p_receipt_id,
        v_journal_document_id, p_landed_cost_amount, p_landed_cost_amount,
        p_document_date + 30, 'UNPAID'
    );

    PERFORM core.record_idempotent_result(
        'inventory.allocate_landed_cost', p_request_id, v_journal_document_id
    );

    RETURN jsonb_build_object(
        'receipt_id', p_receipt_id,
        'landed_cost_amount', p_landed_cost_amount,
        'inventory_debit', v_inventory_debit,
        'variance_debit', v_variance_debit,
        'journal_document_id', v_journal_document_id,
        'status', 'POSTED'
    );
END;
$$;

REVOKE ALL ON FUNCTION inventory.allocate_landed_cost(
    text,uuid,bytea,bigint,numeric,text,bigint,date,text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inventory.allocate_landed_cost(
    text,uuid,bytea,bigint,numeric,text,bigint,date,text
) TO stockiha_runtime;

RESET ROLE;
