-- R2: state-aware supplier return journals and allocated supplier payments.
SET ROLE stockiha_owner;

CREATE OR REPLACE FUNCTION inventory.confirm_supplier_return(
    p_session_token text,
    p_request_id uuid,
    p_request_hash bytea,
    p_return_doc_id bigint,
    p_fiscal_period_id bigint,
    p_document_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_user_id bigint;
    v_workstation_id text;
    v_existing_document_id bigint;
    v_return_status text;
    v_return_id bigint;
    v_supplier_id bigint;
    v_warehouse_id bigint;
    v_purchase_order_id bigint;
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

    SELECT bd.status, sr.id, sr.supplier_id, sr.warehouse_id, sr.purchase_order_id
    INTO v_return_status, v_return_id, v_supplier_id, v_warehouse_id, v_purchase_order_id
    FROM core.business_documents bd
    JOIN procurement.supplier_returns sr ON sr.document_id = bd.id
    WHERE bd.id = p_return_doc_id
    FOR UPDATE OF bd;

    IF NOT FOUND OR v_return_status <> 'DRAFT' THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: Supplier return % is not in DRAFT status', p_return_doc_id USING ERRCODE = '55000';
    END IF;
    IF v_purchase_order_id IS NULL THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: MVP supplier returns require a purchase order' USING ERRCODE = '55000';
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

    SELECT count(DISTINCT inv.document_id), min(inv.document_id)
    INTO v_invoice_count, v_invoice_document_id
    FROM procurement.supplier_invoices inv
    JOIN core.business_documents bd ON bd.id = inv.document_id AND bd.status = 'POSTED'
    WHERE inv.purchase_order_id = v_purchase_order_id
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
        WHERE pr.purchase_order_id = v_purchase_order_id
          AND pr.supplier_id = v_supplier_id
          AND pr.warehouse_id = v_warehouse_id
          AND prl.variant_id = v_line.variant_id;

        SELECT COALESCE(sum(other_line.quantity), 0)
        INTO v_previously_returned_qty
        FROM procurement.supplier_return_lines other_line
        JOIN procurement.supplier_returns other_return ON other_return.id = other_line.return_id
        JOIN core.business_documents other_doc ON other_doc.id = other_return.document_id
        WHERE other_return.purchase_order_id = v_purchase_order_id
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
            WHERE pr.purchase_order_id = v_purchase_order_id
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
        WHERE warehouse_id = v_warehouse_id AND variant_id = v_line.variant_id
        FOR UPDATE;
        IF NOT FOUND OR v_position_qty < v_line.quantity THEN
            RAISE EXCEPTION 'INSUFFICIENT_STOCK: Insufficient stock for returned variant %', v_line.variant_id
                USING ERRCODE = '55000';
        END IF;

        v_wac := CASE WHEN v_position_qty > 0 THEN v_position_value / v_position_qty ELSE 0 END;
        v_issue_value := CASE
            WHEN v_position_qty = v_line.quantity THEN round(v_position_value, 2)
            ELSE round(v_line.quantity * v_wac, 2)
        END;

        UPDATE inventory.positions
        SET quantity_on_hand = quantity_on_hand - v_line.quantity,
            total_value = total_value - v_issue_value,
            last_known_wac = CASE
                WHEN quantity_on_hand - v_line.quantity = 0 THEN last_known_wac
                ELSE (total_value - v_issue_value) / (quantity_on_hand - v_line.quantity)
            END,
            updated_at = now()
        WHERE warehouse_id = v_warehouse_id AND variant_id = v_line.variant_id;

        INSERT INTO inventory.movements (
            movement_type, reference_type, reference_id, warehouse_id, variant_id,
            quantity_delta, inventory_value_delta, resulting_quantity_on_hand,
            resulting_total_value
        ) VALUES (
            'ISSUE', 'SUPPLIER_RETURN', p_return_doc_id, v_warehouse_id, v_line.variant_id,
            -v_line.quantity, -v_issue_value,
            v_position_qty - v_line.quantity, v_position_value - v_issue_value
        ) RETURNING id INTO v_movement_id;

        UPDATE procurement.supplier_return_lines
        SET unit_cost = round(v_authoritative_unit_cost, 4),
            line_total = round(v_line.quantity * v_authoritative_unit_cost, 2)
        WHERE id = v_line.id;

        v_clearing_amount := v_clearing_amount + round(v_line.quantity * v_authoritative_unit_cost, 2);
        v_inventory_value := v_inventory_value + v_issue_value;
    END LOOP;

    IF v_clearing_amount <= 0 OR v_inventory_value <= 0 THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: Supplier return values must be positive' USING ERRCODE = '55000';
    END IF;
    IF v_liability_id IS NOT NULL AND v_clearing_amount > v_liability_outstanding THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: Return amount exceeds the outstanding supplier liability'
            USING ERRCODE = '55000';
    END IF;

    v_return_sequence := core.claim_next_document_number('DEBIT_NOTE', v_fiscal_year);
    v_return_number := 'DN-' || v_fiscal_year || '-' || lpad(v_return_sequence::text, 6, '0');
    UPDATE core.business_documents
    SET status = 'POSTED', sequence_number = v_return_sequence,
        document_number = v_return_number, document_date = p_document_date,
        fiscal_period_id = p_fiscal_period_id, fiscal_year = v_fiscal_year,
        posted_at = now()
    WHERE id = p_return_doc_id;

    v_journal_document_id := finance.create_posted_journal(
        p_document_date,
        p_fiscal_period_id,
        'Supplier return journal entry',
        'PURCHASE_RETURN',
        p_return_doc_id
    );

    INSERT INTO finance.journal_lines (document_id, line_number, account_code, debit, credit)
    VALUES (
        v_journal_document_id, v_journal_line_number,
        finance.require_account_role(v_clearing_role), v_clearing_amount, 0
    );
    v_journal_line_number := v_journal_line_number + 1;

    v_variance := v_inventory_value - v_clearing_amount;
    IF v_variance > 0 THEN
        INSERT INTO finance.journal_lines (document_id, line_number, account_code, debit, credit)
        VALUES (
            v_journal_document_id, v_journal_line_number,
            finance.require_account_role('PROCUREMENT_VARIANCE'), v_variance, 0
        );
        v_journal_line_number := v_journal_line_number + 1;
    END IF;

    INSERT INTO finance.journal_lines (document_id, line_number, account_code, debit, credit)
    VALUES (
        v_journal_document_id, v_journal_line_number,
        finance.require_account_role('INVENTORY'), 0, v_inventory_value
    );
    v_journal_line_number := v_journal_line_number + 1;

    IF v_variance < 0 THEN
        INSERT INTO finance.journal_lines (document_id, line_number, account_code, debit, credit)
        VALUES (
            v_journal_document_id, v_journal_line_number,
            finance.require_account_role('PROCUREMENT_VARIANCE'), 0, -v_variance
        );
    END IF;

    IF v_liability_id IS NOT NULL THEN
        UPDATE procurement.supplier_liabilities
        SET outstanding_amount = outstanding_amount - v_clearing_amount,
            status = CASE
                WHEN outstanding_amount - v_clearing_amount = 0 THEN 'PAID'
                ELSE 'PARTIALLY_PAID'
            END
        WHERE id = v_liability_id;
    END IF;

    PERFORM core.record_idempotent_result(
        'inventory.confirm_supplier_return', p_request_id, p_return_doc_id
    );

    RETURN jsonb_build_object(
        'document_id', p_return_doc_id,
        'document_number', v_return_number,
        'status', 'POSTED',
        'clearing_role', v_clearing_role,
        'clearing_amount', v_clearing_amount,
        'inventory_value', v_inventory_value,
        'variance_amount', v_variance,
        'journal_document_id', v_journal_document_id
    );
END;
$$;

CREATE OR REPLACE FUNCTION procurement.post_supplier_payment(
    p_session_token text,
    p_request_id uuid,
    p_request_hash bytea,
    p_supplier_id bigint,
    p_liability_id bigint,
    p_amount numeric(14,2),
    p_payment_method text,
    p_fiscal_period_id bigint,
    p_document_date date,
    p_note text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_user_id bigint;
    v_workstation_id text;
    v_existing_document_id bigint;
    v_period_status text;
    v_period_start date;
    v_period_end date;
    v_outstanding numeric(14,2);
    v_payment_method text := upper(COALESCE(p_payment_method, ''));
    v_funding_role finance.account_role_code;
    v_fiscal_year integer := extract(year FROM p_document_date)::integer;
    v_payment_sequence bigint;
    v_payment_number text;
    v_payment_document_id bigint;
    v_journal_document_id bigint;
BEGIN
    SELECT user_id, workstation_id
    INTO v_user_id, v_workstation_id
    FROM iam.resolve_session_with_permission(p_session_token, 'POST_SUPPLIER_PAYMENT');

    v_existing_document_id := core.reserve_idempotent_request(
        'procurement.post_supplier_payment', p_request_id, p_request_hash
    );
    IF v_existing_document_id IS NOT NULL THEN
        SELECT bd.document_number, je.document_id
        INTO v_payment_number, v_journal_document_id
        FROM core.business_documents bd
        LEFT JOIN finance.journal_entries je
          ON je.source_type = 'SUPPLIER_PAYMENT' AND je.source_id = bd.id
        WHERE bd.id = v_existing_document_id;
        RETURN jsonb_build_object(
            'document_id', v_existing_document_id,
            'document_number', v_payment_number,
            'status', 'POSTED',
            'journal_document_id', v_journal_document_id
        );
    END IF;

    IF p_liability_id IS NULL THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Supplier payments must be allocated to one liability' USING ERRCODE = '22023';
    END IF;
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Payment amount must be positive' USING ERRCODE = '22023';
    END IF;
    IF v_payment_method = 'CASH' THEN
        v_funding_role := 'CASH';
    ELSIF v_payment_method IN ('BANK_TRANSFER', 'CHECK') THEN
        v_funding_role := 'BANK';
    ELSE
        RAISE EXCEPTION 'VALIDATION_ERROR: Unsupported supplier payment method %', v_payment_method USING ERRCODE = '22023';
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

    SELECT outstanding_amount
    INTO v_outstanding
    FROM procurement.supplier_liabilities
    WHERE id = p_liability_id
      AND supplier_id = p_supplier_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: Supplier liability % not found', p_liability_id USING ERRCODE = '55000';
    END IF;
    IF p_amount > v_outstanding THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: Payment amount exceeds outstanding liability' USING ERRCODE = '55000';
    END IF;

    v_payment_sequence := core.claim_next_document_number('SUPPLIER_PAYMENT', v_fiscal_year);
    v_payment_number := 'SP-' || v_fiscal_year || '-' || lpad(v_payment_sequence::text, 6, '0');
    INSERT INTO core.business_documents (
        document_type, status, document_date, fiscal_period_id, fiscal_year,
        sequence_number, document_number, posted_at
    ) VALUES (
        'SUPPLIER_PAYMENT', 'POSTED', p_document_date, p_fiscal_period_id, v_fiscal_year,
        v_payment_sequence, v_payment_number, now()
    ) RETURNING id INTO v_payment_document_id;

    INSERT INTO procurement.supplier_payments (
        document_id, supplier_id, liability_id, payment_method, amount, note
    ) VALUES (
        v_payment_document_id, p_supplier_id, p_liability_id,
        v_payment_method, p_amount, p_note
    );

    v_journal_document_id := finance.create_posted_journal(
        p_document_date,
        p_fiscal_period_id,
        'Supplier payment journal entry',
        'SUPPLIER_PAYMENT',
        v_payment_document_id
    );

    INSERT INTO finance.journal_lines (document_id, line_number, account_code, debit, credit)
    VALUES
        (v_journal_document_id, 1, finance.require_account_role('ACCOUNTS_PAYABLE'), p_amount, 0),
        (v_journal_document_id, 2, finance.require_account_role(v_funding_role), 0, p_amount);

    UPDATE procurement.supplier_liabilities
    SET outstanding_amount = outstanding_amount - p_amount,
        status = CASE
            WHEN outstanding_amount - p_amount = 0 THEN 'PAID'
            ELSE 'PARTIALLY_PAID'
        END
    WHERE id = p_liability_id;

    PERFORM core.record_idempotent_result(
        'procurement.post_supplier_payment', p_request_id, v_payment_document_id
    );

    RETURN jsonb_build_object(
        'document_id', v_payment_document_id,
        'document_number', v_payment_number,
        'status', 'POSTED',
        'journal_document_id', v_journal_document_id,
        'amount', p_amount,
        'funding_role', v_funding_role
    );
END;
$$;

REVOKE ALL ON FUNCTION inventory.confirm_supplier_return(
    text,uuid,bytea,bigint,bigint,date
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inventory.confirm_supplier_return(
    text,uuid,bytea,bigint,bigint,date
) TO stockiha_runtime;

REVOKE ALL ON FUNCTION procurement.post_supplier_payment(
    text,uuid,bytea,bigint,bigint,numeric,text,bigint,date,text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION procurement.post_supplier_payment(
    text,uuid,bytea,bigint,bigint,numeric,text,bigint,date,text
) TO stockiha_runtime;

RESET ROLE;
