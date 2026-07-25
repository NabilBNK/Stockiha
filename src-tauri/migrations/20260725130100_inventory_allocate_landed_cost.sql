-- Migration: 20260725130100_inventory_allocate_landed_cost.sql
-- Description: SECURITY DEFINER atomic procedure inventory.allocate_landed_cost for landed-cost allocation.

BEGIN;

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
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_user_id bigint;
    v_workstation_id text;
    v_existing_doc_id bigint;
    v_receipt_doc_type text;
    v_receipt_status text;
    v_warehouse_id bigint;
    v_supplier_id bigint;
    v_period_status text;
    v_period_start date;
    v_period_end date;

    v_total_receipt_qty numeric(14,3);
    v_total_receipt_val numeric(14,2);

    v_line record;
    v_allocated_cost numeric(14,2);
    v_remaining_cost_for_line numeric(14,2);
    v_sold_cost_for_line numeric(14,2);

    v_qty_on_hand numeric(14,3);
    v_curr_total_val numeric(14,2);
    v_new_total_val numeric(14,2);
    v_new_wac numeric(14,6);

    v_total_inventory_debit numeric(14,2) := 0.00;
    v_total_variance_debit numeric(14,2) := 0.00;

    v_journal_doc_id bigint;
    v_journal_num text;
    v_seq_num integer;

    v_acct_inv_id bigint;
    v_acct_variance_id bigint;
    v_acct_ap_id bigint;
BEGIN
    -- 1. Session + Permission Check
    SELECT user_id, workstation_id INTO v_user_id, v_workstation_id
    FROM iam.resolve_session_with_permission(p_session_token, 'POST_PURCHASE_RECEIPT');

    -- 2. Idempotency Check
    v_existing_doc_id := core.reserve_idempotent_request(
        'inventory.allocate_landed_cost', p_request_id, p_payload_hash
    );
    IF v_existing_doc_id IS NOT NULL THEN
        RETURN jsonb_build_object(
            'receipt_id', p_receipt_id,
            'landed_cost_amount', p_landed_cost_amount,
            'status', 'POSTED',
            'journal_document_id', v_existing_doc_id
        );
    END IF;

    -- 3. Validate Inputs
    IF p_landed_cost_amount <= 0 THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Landed cost amount must be positive'
            USING ERRCODE = '22023';
    END IF;

    IF p_allocation_method NOT IN ('BY_QTY', 'BY_VALUE', 'EQUAL_PER_LINE') THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Invalid allocation method %', p_allocation_method
            USING ERRCODE = '22023';
    END IF;

    -- Fiscal Period Validation
    SELECT status, starts_on, ends_on INTO v_period_status, v_period_start, v_period_end
    FROM finance.fiscal_periods
    WHERE id = p_fiscal_period_id;

    IF v_period_status IS NULL OR v_period_status <> 'OPEN' THEN
        RAISE EXCEPTION 'CLOSED_FISCAL_PERIOD: Fiscal period % is not open', p_fiscal_period_id
            USING ERRCODE = '22023';
    END IF;

    IF p_document_date < v_period_start OR p_document_date > v_period_end THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Document date % outside fiscal period range', p_document_date
            USING ERRCODE = '22023';
    END IF;

    -- Lock & Validate Purchase Receipt
    SELECT doc.document_type, doc.status, pr.warehouse_id, pr.supplier_id
    INTO v_receipt_doc_type, v_receipt_status, v_warehouse_id, v_supplier_id
    FROM core.business_documents doc
    JOIN procurement.purchase_receipts pr ON doc.id = pr.document_id
    WHERE doc.id = p_receipt_id
    FOR UPDATE OF doc;

    IF v_receipt_status IS NULL OR v_receipt_status <> 'POSTED' THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: Receipt % is not posted', p_receipt_id
            USING ERRCODE = '55000';
    END IF;

    -- Total Totals for Receipt Lines
    SELECT COALESCE(SUM(quantity_received), 0), COALESCE(SUM(line_total), 0)
    INTO v_total_receipt_qty, v_total_receipt_val
    FROM procurement.purchase_receipt_lines
    WHERE document_id = p_receipt_id;

    IF v_total_receipt_qty <= 0 THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: Receipt has no lines to allocate costs to'
            USING ERRCODE = '55000';
    END IF;

    -- 4. Process Receipt Lines & Allocate
    FOR v_line IN (
        SELECT id, variant_id, quantity_received, unit_cost, line_total
        FROM procurement.purchase_receipt_lines
        WHERE document_id = p_receipt_id
        ORDER BY id ASC
    ) LOOP
        -- Calculate Allocated Cost for Line
        IF p_allocation_method = 'BY_QTY' THEN
            v_allocated_cost := round(p_landed_cost_amount * (v_line.quantity_received / v_total_receipt_qty), 2);
        ELSIF p_allocation_method = 'BY_VALUE' THEN
            v_allocated_cost := round(p_landed_cost_amount * (v_line.line_total / v_total_receipt_val), 2);
        ELSE
            -- EQUAL_PER_LINE
            v_allocated_cost := round(p_landed_cost_amount / (SELECT count(*) FROM procurement.purchase_receipt_lines WHERE document_id = p_receipt_id), 2);
        END IF;

        -- Ensure / Fetch Attribution Row
        INSERT INTO inventory.receipt_cost_attribution (
            receipt_line_id, variant_id, warehouse_id, original_quantity, attributed_remaining_quantity, original_unit_cost
        )
        VALUES (
            v_line.id, v_line.variant_id, v_warehouse_id, v_line.quantity_received, v_line.quantity_received, v_line.unit_cost
        )
        ON CONFLICT DO NOTHING;

        -- Lock position and evaluate remaining stock portion vs sold portion
        SELECT quantity_on_hand, total_value
        INTO v_qty_on_hand, v_curr_total_val
        FROM inventory.positions
        WHERE warehouse_id = v_warehouse_id AND variant_id = v_line.variant_id
        FOR UPDATE;

        IF v_qty_on_hand IS NULL OR v_qty_on_hand <= 0 THEN
            -- All stock sold: entire line allocated cost goes to variance
            v_sold_cost_for_line := v_allocated_cost;
            v_remaining_cost_for_line := 0.00;
        ELSE
            -- Stock remains: split proportionally based on attributed_remaining_quantity
            v_remaining_cost_for_line := round(v_allocated_cost * (LEAST(v_qty_on_hand, v_line.quantity_received) / v_line.quantity_received), 2);
            v_sold_cost_for_line := v_allocated_cost - v_remaining_cost_for_line;

            -- Update position inventory value & WAC
            v_new_total_val := v_curr_total_val + v_remaining_cost_for_line;
            v_new_wac := round(v_new_total_val / v_qty_on_hand, 6);

            UPDATE inventory.positions
            SET total_value = v_new_total_val,
                last_known_wac = v_new_wac,
                updated_at = now()
            WHERE warehouse_id = v_warehouse_id AND variant_id = v_line.variant_id;

            -- Log COST_ONLY movement
            INSERT INTO inventory.movements (
                warehouse_id, variant_id, movement_type, quantity_delta,
                inventory_value_delta, resulting_quantity_on_hand,
                resulting_total_value, reference_type, reference_id
            )
            VALUES (
                v_warehouse_id, v_line.variant_id, 'COST_ONLY', 0.000,
                v_remaining_cost_for_line, v_qty_on_hand, v_new_total_val,
                'PURCHASE_RECEIPT', p_receipt_id
            );
        END IF;

        -- Update attribution ledger
        UPDATE inventory.receipt_cost_attribution
        SET late_cost_allocated = late_cost_allocated + v_allocated_cost,
            updated_at = now()
        WHERE receipt_line_id = v_line.id;

        v_total_inventory_debit := v_total_inventory_debit + v_remaining_cost_for_line;
        v_total_variance_debit := v_total_variance_debit + v_sold_cost_for_line;
    END LOOP;

    -- 5. Create Double-Entry Journal Entry
    DECLARE
        v_fiscal_year integer := extract(year from p_document_date)::integer;
    BEGIN
        v_seq_num := core.claim_next_document_number('JOURNAL_ENTRY', v_fiscal_year);
        v_journal_num := 'JE-' || v_fiscal_year::text || '-' || lpad(v_seq_num::text, 6, '0');

        INSERT INTO core.business_documents (
            document_type, status, document_date, fiscal_period_id, fiscal_year,
            sequence_number, document_number, posted_at
        )
        VALUES (
            'JOURNAL_ENTRY', 'POSTED', p_document_date, p_fiscal_period_id, v_fiscal_year,
            v_seq_num, v_journal_num, now()
        )
        RETURNING id INTO v_journal_doc_id;
    END;

        INSERT INTO finance.journal_entries (
            document_id, description, source_type, source_id
        )
        VALUES (
            v_journal_doc_id, 'Landed cost allocation journal entry', 'PURCHASE_RECEIPT', p_receipt_id
        );

    -- Debits
    IF v_total_inventory_debit > 0 THEN
        INSERT INTO finance.journal_lines (document_id, line_number, account_code, debit, credit)
        VALUES (v_journal_doc_id, 1, 'INVENTORY_MERCHANDISE', v_total_inventory_debit, 0);
    END IF;

    IF v_total_variance_debit > 0 THEN
        INSERT INTO finance.journal_lines (document_id, line_number, account_code, debit, credit)
        VALUES (v_journal_doc_id, CASE WHEN v_total_inventory_debit > 0 THEN 2 ELSE 1 END, 'LANDED_COST_VARIANCE', v_total_variance_debit, 0);
    END IF;

    -- Credit: Accounts Payable
    INSERT INTO finance.journal_lines (document_id, line_number, account_code, debit, credit)
    VALUES (v_journal_doc_id, CASE WHEN v_total_inventory_debit > 0 AND v_total_variance_debit > 0 THEN 3 WHEN v_total_inventory_debit > 0 OR v_total_variance_debit > 0 THEN 2 ELSE 1 END, 'ACCOUNTS_PAYABLE', 0, p_landed_cost_amount);

    -- Record Idempotency Result
    PERFORM core.record_idempotent_result('inventory.allocate_landed_cost', p_request_id, v_journal_doc_id);

    RETURN jsonb_build_object(
        'receipt_id', p_receipt_id,
        'landed_cost_amount', p_landed_cost_amount,
        'inventory_debit', v_total_inventory_debit,
        'variance_debit', v_total_variance_debit,
        'journal_document_id', v_journal_doc_id,
        'journal_document_number', v_journal_num
    );
END;
$$;

COMMIT;
