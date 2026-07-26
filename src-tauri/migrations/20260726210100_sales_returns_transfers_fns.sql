-- Slice 5: Stored Procedures for Customer Returns, Warehouse Transfers, and Stock Write-Offs

-- 1. Confirm Customer Return Procedure
CREATE OR REPLACE FUNCTION sales.confirm_customer_return(
    p_session_token text,
    p_request_id uuid,
    p_customer_id bigint,
    p_cash_session_id bigint,
    p_warehouse_id bigint,
    p_refund_method text, -- 'CASH' | 'CREDIT_NOTE' | 'BANK_TRANSFER'
    p_fiscal_period_id bigint,
    p_document_date date,
    p_lines jsonb,
    p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, sales, inventory, finance, cash, iam, public
AS $$
DECLARE
    v_user_id bigint;
    v_existing_doc_id bigint;
    v_period_status text;
    v_fiscal_year integer;

    v_cr_seq bigint;
    v_cr_num text;
    v_doc_id bigint;
    v_return_id bigint;

    v_je_seq bigint;
    v_journal_num text;
    v_journal_doc_id bigint;

    v_total_amount numeric(15,2) := 0;
    v_line record;
    v_line_num integer := 1;
    v_credit_account text;
BEGIN
    -- 1. Validate Session & Permission
    SELECT user_id INTO v_user_id
    FROM iam.resolve_session_with_permission(p_session_token, 'POST_CUSTOMER_RETURN');

    IF jsonb_array_length(p_lines) = 0 THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Return must contain at least one line' USING ERRCODE = '22023';
    END IF;

    IF p_refund_method NOT IN ('CASH', 'CREDIT_NOTE', 'BANK_TRANSFER') THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Invalid refund method %', p_refund_method USING ERRCODE = '22023';
    END IF;

    -- 2. Idempotency Check
    v_existing_doc_id := core.reserve_idempotent_request(
        'sales.confirm_customer_return',
        p_request_id,
        sha256((COALESCE(p_customer_id::text, '0') || '|' || COALESCE(p_cash_session_id::text, '0') || '|' || p_refund_method || '|' || p_document_date::text)::bytea)
    );
    IF v_existing_doc_id IS NOT NULL THEN
        RETURN jsonb_build_object('document_id', v_existing_doc_id, 'idempotent_replay', true);
    END IF;

    -- 3. Validate Fiscal Period
    SELECT fp.status INTO v_period_status FROM finance.fiscal_periods fp WHERE fp.id = p_fiscal_period_id;
    IF v_period_status IS NULL OR v_period_status <> 'OPEN' THEN
        RAISE EXCEPTION 'CLOSED_FISCAL_PERIOD: Fiscal period % is not open', p_fiscal_period_id USING ERRCODE = '22023';
    END IF;

    v_fiscal_year := extract(year FROM p_document_date)::integer;

    -- Calculate total
    FOR v_line IN SELECT * FROM jsonb_to_recordset(p_lines) AS x(variant_id bigint, quantity numeric(15,4), unit_price numeric(15,2)) LOOP
        v_total_amount := v_total_amount + round(v_line.quantity * v_line.unit_price, 2);
    END LOOP;

    -- 4. Create Business Document & Customer Return
    v_cr_seq := core.claim_next_document_number('CUSTOMER_RETURN', v_fiscal_year);
    v_cr_num := 'CR-' || v_fiscal_year::text || '-' || lpad(v_cr_seq::text, 6, '0');

    INSERT INTO core.business_documents
        (document_type, status, document_date, fiscal_period_id, fiscal_year, sequence_number, document_number, posted_at)
    VALUES
        ('CUSTOMER_RETURN', 'POSTED', p_document_date, p_fiscal_period_id, v_fiscal_year, v_cr_seq, v_cr_num, now())
    RETURNING id INTO v_doc_id;

    INSERT INTO sales.customer_returns
        (document_id, customer_id, cash_session_id, warehouse_id, refund_method, total_amount, note)
    VALUES
        (v_doc_id, p_customer_id, p_cash_session_id, p_warehouse_id, p_refund_method, v_total_amount, p_note)
    RETURNING id INTO v_return_id;

    -- 5. Restock Items to Inventory & Save Lines
    FOR v_line IN SELECT * FROM jsonb_to_recordset(p_lines) AS x(variant_id bigint, quantity numeric(15,4), unit_price numeric(15,2)) LOOP
        INSERT INTO sales.customer_return_lines
            (customer_return_id, line_number, variant_id, quantity, unit_price, line_total)
        VALUES
            (v_return_id, v_line_num, v_line.variant_id, v_line.quantity, v_line.unit_price, round(v_line.quantity * v_line.unit_price, 2));

        -- Restock item into warehouse
        INSERT INTO inventory.positions (warehouse_id, variant_id, quantity_on_hand, updated_at)
        VALUES (p_warehouse_id, v_line.variant_id, v_line.quantity, now())
        ON CONFLICT (warehouse_id, variant_id) DO UPDATE
        SET quantity_on_hand = inventory.positions.quantity_on_hand + v_line.quantity,
            updated_at = now();

        v_line_num := v_line_num + 1;
    END LOOP;

    -- 6. Cash Payout / Credit Balance Adjustment
    IF p_refund_method = 'CASH' THEN
        v_credit_account := 'CASH_DESK';
        IF p_cash_session_id IS NOT NULL THEN
            INSERT INTO cash.movements (cash_session_id, movement_type, amount, business_document_id, note)
            VALUES (p_cash_session_id, 'CUSTOMER_REFUND', -v_total_amount, v_doc_id, 'Refund for ' || v_cr_num);
        END IF;
    ELSIF p_refund_method = 'CREDIT_NOTE' AND p_customer_id IS NOT NULL THEN
        v_credit_account := 'ACCOUNTS_RECEIVABLE';
        -- Reduce customer liability / exposure
        UPDATE sales.customer_credit_states
        SET exposure_amount = GREATEST(0, exposure_amount - v_total_amount),
            last_recalculated_at = now()
        WHERE customer_id = p_customer_id;
    ELSE
        v_credit_account := 'BANK_ACCOUNT';
    END IF;

    -- 7. Post Double-Entry Journal
    v_je_seq := core.claim_next_document_number('JOURNAL_ENTRY', v_fiscal_year);
    v_journal_num := 'JE-' || v_fiscal_year::text || '-' || lpad(v_je_seq::text, 6, '0');

    INSERT INTO core.business_documents
        (document_type, status, document_date, fiscal_period_id, fiscal_year, sequence_number, document_number, posted_at)
    VALUES
        ('JOURNAL_ENTRY', 'POSTED', p_document_date, p_fiscal_period_id, v_fiscal_year, v_je_seq, v_journal_num, now())
    RETURNING id INTO v_journal_doc_id;

    INSERT INTO finance.journal_entries (document_id, description, source_type, source_id)
    VALUES (v_journal_doc_id, 'Customer return ' || v_cr_num, 'CUSTOMER_RETURN', v_doc_id);

    INSERT INTO finance.journal_lines (document_id, line_number, account_code, debit, credit)
    VALUES
        (v_journal_doc_id, 1, 'SALES_RETURNS', v_total_amount, 0),
        (v_journal_doc_id, 2, v_credit_account, 0, v_total_amount);

    PERFORM core.record_idempotent_result('sales.confirm_customer_return', p_request_id, v_doc_id);

    RETURN jsonb_build_object(
        'document_id', v_doc_id,
        'document_number', v_cr_num,
        'total_amount', v_total_amount,
        'status', 'POSTED'
    );
END;
$$;

-- 2. Confirm 1-Step Warehouse Transfer Procedure
CREATE OR REPLACE FUNCTION inventory.confirm_warehouse_transfer(
    p_session_token text,
    p_request_id uuid,
    p_from_warehouse_id bigint,
    p_to_warehouse_id bigint,
    p_fiscal_period_id bigint,
    p_document_date date,
    p_lines jsonb,
    p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, inventory, finance, iam, public
AS $$
DECLARE
    v_user_id bigint;
    v_existing_doc_id bigint;
    v_period_status text;
    v_fiscal_year integer;

    v_tr_seq bigint;
    v_tr_num text;
    v_doc_id bigint;
    v_transfer_id bigint;

    v_line record;
    v_line_num integer := 1;
    v_on_hand numeric(15,4);
BEGIN
    SELECT user_id INTO v_user_id
    FROM iam.resolve_session_with_permission(p_session_token, 'POST_STOCK_TRANSFER');

    IF p_from_warehouse_id = p_to_warehouse_id THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Source and destination warehouses must be different' USING ERRCODE = '22023';
    END IF;

    IF jsonb_array_length(p_lines) = 0 THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Transfer must contain at least one line' USING ERRCODE = '22023';
    END IF;

    -- Idempotency Check
    v_existing_doc_id := core.reserve_idempotent_request(
        'inventory.confirm_warehouse_transfer',
        p_request_id,
        sha256((p_from_warehouse_id::text || '|' || p_to_warehouse_id::text || '|' || p_document_date::text)::bytea)
    );
    IF v_existing_doc_id IS NOT NULL THEN
        RETURN jsonb_build_object('document_id', v_existing_doc_id, 'idempotent_replay', true);
    END IF;

    SELECT fp.status INTO v_period_status FROM finance.fiscal_periods fp WHERE fp.id = p_fiscal_period_id;
    IF v_period_status IS NULL OR v_period_status <> 'OPEN' THEN
        RAISE EXCEPTION 'CLOSED_FISCAL_PERIOD: Fiscal period % is not open', p_fiscal_period_id USING ERRCODE = '22023';
    END IF;

    v_fiscal_year := extract(year FROM p_document_date)::integer;

    v_tr_seq := core.claim_next_document_number('STOCK_TRANSFER', v_fiscal_year);
    v_tr_num := 'TR-' || v_fiscal_year::text || '-' || lpad(v_tr_seq::text, 6, '0');

    INSERT INTO core.business_documents
        (document_type, status, document_date, fiscal_period_id, fiscal_year, sequence_number, document_number, posted_at)
    VALUES
        ('STOCK_TRANSFER', 'POSTED', p_document_date, p_fiscal_period_id, v_fiscal_year, v_tr_seq, v_tr_num, now())
    RETURNING id INTO v_doc_id;

    INSERT INTO inventory.warehouse_transfers
        (document_id, from_warehouse_id, to_warehouse_id, note)
    VALUES
        (v_doc_id, p_from_warehouse_id, p_to_warehouse_id, p_note)
    RETURNING id INTO v_transfer_id;

    -- Transfer Stock Atomic Loop
    FOR v_line IN SELECT * FROM jsonb_to_recordset(p_lines) AS x(variant_id bigint, quantity numeric(15,4)) LOOP
        INSERT INTO inventory.warehouse_transfer_lines
            (warehouse_transfer_id, line_number, variant_id, quantity)
        VALUES
            (v_transfer_id, v_line_num, v_line.variant_id, v_line.quantity);

        -- Check source stock
        SELECT quantity_on_hand INTO v_on_hand
        FROM inventory.positions
        WHERE warehouse_id = p_from_warehouse_id AND variant_id = v_line.variant_id
        FOR UPDATE;

        IF v_on_hand IS NULL OR v_on_hand < v_line.quantity THEN
            RAISE EXCEPTION 'PRECONDITION_FAILED: Insufficient stock for variant % in source warehouse (available %, required %)', v_line.variant_id, COALESCE(v_on_hand, 0), v_line.quantity USING ERRCODE = '55000';
        END IF;

        -- Deduct from source
        UPDATE inventory.positions
        SET quantity_on_hand = quantity_on_hand - v_line.quantity, updated_at = now()
        WHERE warehouse_id = p_from_warehouse_id AND variant_id = v_line.variant_id;

        -- Add to target
        INSERT INTO inventory.positions (warehouse_id, variant_id, quantity_on_hand, updated_at)
        VALUES (p_to_warehouse_id, v_line.variant_id, v_line.quantity, now())
        ON CONFLICT (warehouse_id, variant_id) DO UPDATE
        SET quantity_on_hand = inventory.positions.quantity_on_hand + v_line.quantity, updated_at = now();

        v_line_num := v_line_num + 1;
    END LOOP;

    PERFORM core.record_idempotent_result('inventory.confirm_warehouse_transfer', p_request_id, v_doc_id);

    RETURN jsonb_build_object(
        'document_id', v_doc_id,
        'document_number', v_tr_num,
        'status', 'POSTED'
    );
END;
$$;

-- 3. Confirm Stock Write-Off Procedure
CREATE OR REPLACE FUNCTION inventory.confirm_stock_write_off(
    p_session_token text,
    p_request_id uuid,
    p_warehouse_id bigint,
    p_reason_code text,
    p_fiscal_period_id bigint,
    p_document_date date,
    p_lines jsonb,
    p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, inventory, finance, iam, public
AS $$
DECLARE
    v_user_id bigint;
    v_existing_doc_id bigint;
    v_period_status text;
    v_fiscal_year integer;

    v_wo_seq bigint;
    v_wo_num text;
    v_doc_id bigint;
    v_write_off_id bigint;

    v_je_seq bigint;
    v_journal_num text;
    v_journal_doc_id bigint;

    v_total_cost numeric(15,2) := 0;
    v_line record;
    v_line_num integer := 1;
    v_on_hand numeric(15,4);
BEGIN
    SELECT user_id INTO v_user_id
    FROM iam.resolve_session_with_permission(p_session_token, 'POST_STOCK_WRITEOFF');

    IF p_reason_code NOT IN ('DAMAGED', 'EXPIRED', 'DEFECTIVE', 'STOLEN', 'OTHER') THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Invalid reason code %', p_reason_code USING ERRCODE = '22023';
    END IF;

    IF jsonb_array_length(p_lines) = 0 THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Stock write-off must contain at least one line' USING ERRCODE = '22023';
    END IF;

    -- Idempotency Check
    v_existing_doc_id := core.reserve_idempotent_request(
        'inventory.confirm_stock_write_off',
        p_request_id,
        sha256((p_warehouse_id::text || '|' || p_reason_code || '|' || p_document_date::text)::bytea)
    );
    IF v_existing_doc_id IS NOT NULL THEN
        RETURN jsonb_build_object('document_id', v_existing_doc_id, 'idempotent_replay', true);
    END IF;

    SELECT fp.status INTO v_period_status FROM finance.fiscal_periods fp WHERE fp.id = p_fiscal_period_id;
    IF v_period_status IS NULL OR v_period_status <> 'OPEN' THEN
        RAISE EXCEPTION 'CLOSED_FISCAL_PERIOD: Fiscal period % is not open', p_fiscal_period_id USING ERRCODE = '22023';
    END IF;

    v_fiscal_year := extract(year FROM p_document_date)::integer;

    -- Calculate total cost
    FOR v_line IN SELECT * FROM jsonb_to_recordset(p_lines) AS x(variant_id bigint, quantity numeric(15,4), unit_cost numeric(15,2)) LOOP
        v_total_cost := v_total_cost + round(v_line.quantity * v_line.unit_cost, 2);
    END LOOP;

    v_wo_seq := core.claim_next_document_number('STOCK_WRITEOFF', v_fiscal_year);
    v_wo_num := 'WO-' || v_fiscal_year::text || '-' || lpad(v_wo_seq::text, 6, '0');

    INSERT INTO core.business_documents
        (document_type, status, document_date, fiscal_period_id, fiscal_year, sequence_number, document_number, posted_at)
    VALUES
        ('STOCK_WRITEOFF', 'POSTED', p_document_date, p_fiscal_period_id, v_fiscal_year, v_wo_seq, v_wo_num, now())
    RETURNING id INTO v_doc_id;

    INSERT INTO inventory.stock_write_offs
        (document_id, warehouse_id, reason_code, total_cost, note)
    VALUES
        (v_doc_id, p_warehouse_id, p_reason_code, v_total_cost, p_note)
    RETURNING id INTO v_write_off_id;

    -- Process Lines & Deduct Damaged Stock
    FOR v_line IN SELECT * FROM jsonb_to_recordset(p_lines) AS x(variant_id bigint, quantity numeric(15,4), unit_cost numeric(15,2)) LOOP
        INSERT INTO inventory.stock_write_off_lines
            (stock_write_off_id, line_number, variant_id, quantity, unit_cost, line_cost)
        VALUES
            (v_write_off_id, v_line_num, v_line.variant_id, v_line.quantity, v_line.unit_cost, round(v_line.quantity * v_line.unit_cost, 2));

        SELECT quantity_on_hand INTO v_on_hand
        FROM inventory.positions
        WHERE warehouse_id = p_warehouse_id AND variant_id = v_line.variant_id
        FOR UPDATE;

        IF v_on_hand IS NULL OR v_on_hand < v_line.quantity THEN
            RAISE EXCEPTION 'PRECONDITION_FAILED: Insufficient stock to write off variant % (available %, requested %)', v_line.variant_id, COALESCE(v_on_hand, 0), v_line.quantity USING ERRCODE = '55000';
        END IF;

        UPDATE inventory.positions
        SET quantity_on_hand = quantity_on_hand - v_line.quantity, updated_at = now()
        WHERE warehouse_id = p_warehouse_id AND variant_id = v_line.variant_id;

        v_line_num := v_line_num + 1;
    END LOOP;

    -- Post Double-Entry Journal for Stock Loss
    v_je_seq := core.claim_next_document_number('JOURNAL_ENTRY', v_fiscal_year);
    v_journal_num := 'JE-' || v_fiscal_year::text || '-' || lpad(v_je_seq::text, 6, '0');

    INSERT INTO core.business_documents
        (document_type, status, document_date, fiscal_period_id, fiscal_year, sequence_number, document_number, posted_at)
    VALUES
        ('JOURNAL_ENTRY', 'POSTED', p_document_date, p_fiscal_period_id, v_fiscal_year, v_je_seq, v_journal_num, now())
    RETURNING id INTO v_journal_doc_id;

    INSERT INTO finance.journal_entries (document_id, description, source_type, source_id)
    VALUES (v_journal_doc_id, 'Stock write-off ' || v_wo_num || ' (' || p_reason_code || ')', 'STOCK_WRITEOFF', v_doc_id);

    INSERT INTO finance.journal_lines (document_id, line_number, account_code, debit, credit)
    VALUES
        (v_journal_doc_id, 1, 'INVENTORY_LOSS_EXPENSE', v_total_cost, 0),
        (v_journal_doc_id, 2, 'INVENTORY_ASSET', 0, v_total_cost);

    PERFORM core.record_idempotent_result('inventory.confirm_stock_write_off', p_request_id, v_doc_id);

    RETURN jsonb_build_object(
        'document_id', v_doc_id,
        'document_number', v_wo_num,
        'total_cost', v_total_cost,
        'status', 'POSTED'
    );
END;
$$;

-- 4. List Query Functions
CREATE OR REPLACE FUNCTION sales.list_customer_returns(
    p_session_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, sales, iam, public
AS $$
DECLARE
    v_user_id bigint;
    v_result jsonb;
BEGIN
    SELECT s.user_id INTO v_user_id FROM iam.application_sessions s WHERE s.token_hash = sha256(p_session_token::bytea) AND s.expires_at > now();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'SESSION_INVALID: Invalid session' USING ERRCODE = '28000';
    END IF;

    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', cr.id,
            'document_id', cr.document_id,
            'document_number', bd.document_number,
            'customer_name', COALESCE(c.name, 'Walk-in'),
            'refund_method', cr.refund_method,
            'total_amount', cr.total_amount::text,
            'note', cr.note,
            'created_at', to_char(cr.created_at AT TIME ZONE 'Africa/Algiers', 'YYYY-MM-DD"T"HH24:MI:SS')
        ) ORDER BY cr.created_at DESC
    ), '[]'::jsonb)
    INTO v_result
    FROM sales.customer_returns cr
    JOIN core.business_documents bd ON bd.id = cr.document_id
    LEFT JOIN sales.customers c ON c.id = cr.customer_id;

    RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION inventory.list_warehouse_transfers(
    p_session_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, inventory, iam, public
AS $$
DECLARE
    v_user_id bigint;
    v_result jsonb;
BEGIN
    SELECT s.user_id INTO v_user_id FROM iam.application_sessions s WHERE s.token_hash = sha256(p_session_token::bytea) AND s.expires_at > now();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'SESSION_INVALID: Invalid session' USING ERRCODE = '28000';
    END IF;

    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', wt.id,
            'document_id', wt.document_id,
            'document_number', bd.document_number,
            'from_warehouse_name', w1.name,
            'to_warehouse_name', w2.name,
            'note', wt.note,
            'created_at', to_char(wt.created_at AT TIME ZONE 'Africa/Algiers', 'YYYY-MM-DD"T"HH24:MI:SS')
        ) ORDER BY wt.created_at DESC
    ), '[]'::jsonb)
    INTO v_result
    FROM inventory.warehouse_transfers wt
    JOIN core.business_documents bd ON bd.id = wt.document_id
    JOIN inventory.warehouses w1 ON w1.id = wt.from_warehouse_id
    JOIN inventory.warehouses w2 ON w2.id = wt.to_warehouse_id;

    RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION inventory.list_stock_write_offs(
    p_session_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, inventory, iam, public
AS $$
DECLARE
    v_user_id bigint;
    v_result jsonb;
BEGIN
    SELECT s.user_id INTO v_user_id FROM iam.application_sessions s WHERE s.token_hash = sha256(p_session_token::bytea) AND s.expires_at > now();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'SESSION_INVALID: Invalid session' USING ERRCODE = '28000';
    END IF;

    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', wo.id,
            'document_id', wo.document_id,
            'document_number', bd.document_number,
            'warehouse_name', w.name,
            'reason_code', wo.reason_code,
            'total_cost', wo.total_cost::text,
            'note', wo.note,
            'created_at', to_char(wo.created_at AT TIME ZONE 'Africa/Algiers', 'YYYY-MM-DD"T"HH24:MI:SS')
        ) ORDER BY wo.created_at DESC
    ), '[]'::jsonb)
    INTO v_result
    FROM inventory.stock_write_offs wo
    JOIN core.business_documents bd ON bd.id = wo.document_id
    JOIN inventory.warehouses w ON w.id = wo.warehouse_id;

    RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION sales.confirm_customer_return(text, uuid, bigint, bigint, bigint, text, bigint, date, jsonb, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION inventory.confirm_warehouse_transfer(text, uuid, bigint, bigint, bigint, date, jsonb, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION inventory.confirm_stock_write_off(text, uuid, bigint, text, bigint, date, jsonb, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION sales.list_customer_returns(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION inventory.list_warehouse_transfers(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION inventory.list_stock_write_offs(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION sales.confirm_customer_return(text, uuid, bigint, bigint, bigint, text, bigint, date, jsonb, text) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION inventory.confirm_warehouse_transfer(text, uuid, bigint, bigint, bigint, date, jsonb, text) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION inventory.confirm_stock_write_off(text, uuid, bigint, text, bigint, date, jsonb, text) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION sales.list_customer_returns(text) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION inventory.list_warehouse_transfers(text) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION inventory.list_stock_write_offs(text) TO stockiha_runtime;
