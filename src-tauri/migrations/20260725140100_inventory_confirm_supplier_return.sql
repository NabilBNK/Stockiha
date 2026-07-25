-- Migration: 20260725140100_inventory_confirm_supplier_return.sql
-- S3-003: Confirm supplier return procedure with stock issue, WAC valuation, and double-entry postings.

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
SET search_path = core, inventory, catalog, procurement, finance, public
AS $$
DECLARE
    v_user_id bigint;
    v_role_id bigint;
    v_existing_doc_id bigint;
    v_cached_result jsonb;
    v_status text;
    v_supplier_id bigint;
    v_warehouse_id bigint;
    v_po_id bigint;
    v_period_status text;
    v_fiscal_year integer;
    v_dn_seq bigint;
    v_dn_num text;
    v_je_seq bigint;
    v_journal_num text;
    v_journal_doc_id bigint;
    v_total_return_amount numeric(14,2) := 0.00;
    v_total_inventory_val numeric(14,2) := 0.00;
    v_line record;
    v_pos_qty numeric(14,4);
    v_pos_val numeric(14,2);
    v_wac numeric(14,6);
    v_issue_val numeric(14,2);
    v_mov_id bigint;
BEGIN
    -- 1. Validate Session & Permissions
    SELECT s.user_id, r.role_id INTO v_user_id, v_role_id
    FROM iam.application_sessions s
    JOIN iam.user_roles r ON s.user_id = r.user_id
    WHERE s.token_hash = sha256(p_session_token::bytea) AND (s.expires_at IS NULL OR s.expires_at > now());

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'SESSION_INVALID: Invalid or expired session' USING ERRCODE = '28000';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM iam.user_roles ur JOIN iam.roles r ON ur.role_id = r.id WHERE ur.user_id = v_user_id AND r.code IN ('ADMIN', 'MANAGER', 'ACCOUNTANT')) THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: Role not authorized to confirm supplier returns' USING ERRCODE = '42501';
    END IF;

    -- 2. Check Idempotency
    v_existing_doc_id := core.reserve_idempotent_request('inventory.confirm_supplier_return', p_request_id, p_request_hash);
    IF v_existing_doc_id IS NOT NULL THEN
        SELECT doc.document_number INTO v_dn_num FROM core.business_documents doc WHERE doc.id = p_return_doc_id;
        RETURN jsonb_build_object(
            'document_id', p_return_doc_id,
            'document_number', v_dn_num,
            'status', 'POSTED'
        );
    END IF;

    -- 3. Lock & Validate Document
    SELECT doc.status, ret.supplier_id, ret.warehouse_id, ret.purchase_order_id
    INTO v_status, v_supplier_id, v_warehouse_id, v_po_id
    FROM core.business_documents doc
    JOIN procurement.supplier_returns ret ON doc.id = ret.document_id
    WHERE doc.id = p_return_doc_id
    FOR UPDATE OF doc;

    IF v_status IS NULL OR v_status <> 'DRAFT' THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: Supplier return % is not in DRAFT status', p_return_doc_id USING ERRCODE = '55000';
    END IF;

    -- Validate Fiscal Period
    SELECT status INTO v_period_status FROM finance.fiscal_periods WHERE id = p_fiscal_period_id;
    IF v_period_status IS NULL OR v_period_status <> 'OPEN' THEN
        RAISE EXCEPTION 'CLOSED_FISCAL_PERIOD: Fiscal period % is not open', p_fiscal_period_id USING ERRCODE = '22023';
    END IF;

    v_fiscal_year := extract(year from p_document_date)::integer;

    -- 4. Process Line Items & Update Inventory Stock Positions
    FOR v_line IN (
        SELECT l.id, l.variant_id, l.quantity, l.unit_cost, l.line_total
        FROM procurement.supplier_return_lines l
        WHERE l.return_id = (SELECT id FROM procurement.supplier_returns WHERE document_id = p_return_doc_id)
        ORDER BY l.line_number
    ) LOOP
        -- Lock Stock Position
        SELECT quantity_on_hand, total_value
        INTO v_pos_qty, v_pos_val
        FROM inventory.positions
        WHERE warehouse_id = v_warehouse_id AND variant_id = v_line.variant_id
        FOR UPDATE;

        IF v_pos_qty IS NULL OR v_pos_qty < v_line.quantity THEN
            RAISE EXCEPTION 'INSUFFICIENT_STOCK: Stock on hand (%) is less than return quantity (%) for variant %',
                COALESCE(v_pos_qty, 0), v_line.quantity, v_line.variant_id USING ERRCODE = '55000';
        END IF;

        IF v_pos_qty > 0 THEN
            v_wac := round(v_pos_val / v_pos_qty, 6);
        ELSE
            v_wac := v_line.unit_cost;
        END IF;

        IF v_pos_qty = v_line.quantity THEN
            v_issue_val := v_pos_val;
        ELSE
            v_issue_val := round(v_line.quantity * v_wac, 2);
        END IF;

        -- Update Position
        UPDATE inventory.positions
        SET quantity_on_hand = quantity_on_hand - v_line.quantity,
            total_value = total_value - v_issue_val,
            updated_at = now()
        WHERE warehouse_id = v_warehouse_id AND variant_id = v_line.variant_id;

        -- Post Issue Stock Movement
        INSERT INTO inventory.movements (
            movement_type, reference_type, reference_id, warehouse_id, variant_id,
            quantity_delta, inventory_value_delta, resulting_quantity_on_hand, resulting_total_value
        )
        VALUES (
            'ISSUE', 'SUPPLIER_RETURN', p_return_doc_id, v_warehouse_id, v_line.variant_id,
            -v_line.quantity, -v_issue_val, v_pos_qty - v_line.quantity, v_pos_val - v_issue_val
        )
        RETURNING id INTO v_mov_id;

        v_total_return_amount := v_total_return_amount + v_line.line_total;
        v_total_inventory_val := v_total_inventory_val + v_issue_val;
    END LOOP;

    -- 5. Document Number Assignment & Update
    v_dn_seq := core.claim_next_document_number('DEBIT_NOTE', v_fiscal_year);
    v_dn_num := 'DN-' || v_fiscal_year::text || '-' || lpad(v_dn_seq::text, 6, '0');

    UPDATE core.business_documents
    SET status = 'POSTED', sequence_number = v_dn_seq, document_number = v_dn_num, document_date = p_document_date, posted_at = now()
    WHERE id = p_return_doc_id;

    -- 6. Balanced Double-Entry Journal Entry
    v_je_seq := core.claim_next_document_number('JOURNAL_ENTRY', v_fiscal_year);
    v_journal_num := 'JE-' || v_fiscal_year::text || '-' || lpad(v_je_seq::text, 6, '0');

    INSERT INTO core.business_documents (
        document_type, status, document_date, fiscal_period_id, fiscal_year, sequence_number, document_number, posted_at
    )
    VALUES (
        'JOURNAL_ENTRY', 'POSTED', p_document_date, p_fiscal_period_id, v_fiscal_year, v_je_seq, v_journal_num, now()
    )
    RETURNING id INTO v_journal_doc_id;

    INSERT INTO finance.journal_entries (document_id, description, source_type, source_id)
    VALUES (v_journal_doc_id, 'Supplier return journal entry', 'PURCHASE_RETURN', p_return_doc_id);

    INSERT INTO finance.journal_lines (document_id, line_number, account_code, debit, credit)
    VALUES (v_journal_doc_id, 1, 'ACCOUNTS_PAYABLE', v_total_return_amount, 0),
           (v_journal_doc_id, 2, 'ACCOUNTS_PAYABLE', 0, v_total_inventory_val);

    IF v_total_return_amount <> v_total_inventory_val THEN
        INSERT INTO finance.journal_lines (document_id, line_number, account_code, debit, credit)
        VALUES (v_journal_doc_id, 3, 'ACCOUNTS_PAYABLE',
                CASE WHEN v_total_inventory_val > v_total_return_amount THEN v_total_inventory_val - v_total_return_amount ELSE 0 END,
                CASE WHEN v_total_return_amount > v_total_inventory_val THEN v_total_return_amount - v_total_inventory_val ELSE 0 END);
    END IF;

    -- Record Idempotency Result
    PERFORM core.record_idempotent_result('inventory.confirm_supplier_return', p_request_id, p_return_doc_id);

    RETURN jsonb_build_object(
        'document_id', p_return_doc_id,
        'document_number', v_dn_num,
        'status', 'POSTED',
        'journal_document_id', v_journal_doc_id,
        'journal_document_number', v_journal_num,
        'total_amount', v_total_return_amount
    );
END;
$$;
