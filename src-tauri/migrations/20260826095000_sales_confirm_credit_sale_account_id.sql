-- WS-B-1 Gate 3b (1 of 4): dual-write account_id in
-- sales.confirm_credit_sale (the 9-arg implementation; the 8-arg overload is
-- a payload-hash-computing wrapper that delegates to this one and is
-- untouched). Confirmed clean in this task's pre-check: all four literals
-- (ACCOUNTS_RECEIVABLE, SALES_REVENUE, COGS, INVENTORY_MERCHANDISE) already
-- resolve via finance.resolve_account_id(). Only the two journal-line
-- INSERTs change; nothing else in this function is touched.
SET ROLE stockiha_owner;

CREATE OR REPLACE FUNCTION sales.confirm_credit_sale(p_session_token text, p_request_id uuid, p_payload_hash bytea, p_customer_id bigint, p_warehouse_id bigint, p_fiscal_period_id bigint, p_document_date date, p_lines jsonb, p_override_token uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
    v_user_id bigint;
    v_workstation_id text;
    v_cached_result bigint;
    v_period_status text;
    v_period_start date;
    v_period_end date;
    v_fiscal_year integer;
    v_customer_active boolean;
    v_credit_enabled boolean;
    v_credit_limit numeric(14, 2);
    v_payment_terms_days integer;
    v_max_overdue_days integer;
    v_exposure numeric(14, 2);
    v_oldest_due date;
    v_business_today date := (now() AT TIME ZONE 'Africa/Algiers')::date;
    v_over_limit boolean;
    v_overdue_blocked boolean;
    v_override_used boolean := false;
    v_document_id bigint;
    v_journal_document_id bigint;
    v_line jsonb;
    v_line_number integer := 0;
    v_variant_id bigint;
    v_quantity numeric;
    v_unit_price numeric;
    v_variant_active boolean;
    v_variant_sku text;
    v_variant_name text;
    v_qty_on_hand numeric;
    v_position_value numeric;
    v_wac numeric;
    v_new_qty numeric;
    v_new_value numeric;
    v_unit_cost_snapshot numeric;
    v_line_total numeric(14, 2);
    v_subtotal numeric(14, 2) := 0;
    v_total_cogs numeric(18, 4) := 0;
    v_movement_id bigint;
    v_residual_journal_id bigint;
    v_due_date date;
    v_sequence bigint;
    v_document_number text;
    v_journal_sequence bigint;
    v_journal_number text;
    v_new_exposure numeric(14, 2);
BEGIN
    -- Application session + permission. Actor and workstation are resolved here,
    -- never trusted from caller input.
    SELECT user_id, workstation_id
    INTO v_user_id, v_workstation_id
    FROM iam.resolve_session_with_permission(p_session_token, 'POST_CREDIT_SALE');

    -- Core idempotency. Failed attempts roll back this reservation naturally.
    v_cached_result := core.reserve_idempotent_request(
        'sales.confirm_credit_sale', p_request_id, p_payload_hash
    );
    IF v_cached_result IS NOT NULL THEN
        RETURN (
            SELECT jsonb_build_object(
                'document_id', d.id,
                'document_number', d.document_number,
                'customer_id', s.customer_id,
                'total_amount', s.total_amount::text,
                'due_date', s.due_date,
                'exposure_amount', cs.exposure_amount::text,
                'available_credit', (c.credit_limit - cs.exposure_amount)::text,
                'journal_document_id', s.journal_document_id
            )
            FROM core.business_documents d
            JOIN sales.credit_sales s ON s.document_id = d.id
            JOIN receivables.customers c ON c.id = s.customer_id
            JOIN receivables.customer_credit_state cs ON cs.customer_id = c.id
            WHERE d.id = v_cached_result
        );
    END IF;

    -- Fiscal boundary.
    SELECT status, starts_on, ends_on, extract(year FROM starts_on)::integer
    INTO v_period_status, v_period_start, v_period_end, v_fiscal_year
    FROM finance.fiscal_periods
    WHERE id = p_fiscal_period_id
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'fiscal period % not found', p_fiscal_period_id USING ERRCODE = '22023';
    END IF;
    IF v_period_status <> 'OPEN' THEN
        RAISE EXCEPTION 'fiscal period is not open' USING ERRCODE = '55000';
    END IF;
    IF p_document_date < v_period_start OR p_document_date > v_period_end THEN
        RAISE EXCEPTION 'document date is outside fiscal period' USING ERRCODE = '22023';
    END IF;

    IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
        RAISE EXCEPTION 'credit sale must contain at least one line' USING ERRCODE = '22023';
    END IF;

    -- Lock customer master + credit state before evaluating exposure. Every future
    -- customer payment/credit posting follows this same lock boundary.
    SELECT c.is_active, c.credit_enabled, c.credit_limit, c.payment_terms_days,
           c.max_overdue_days, cs.exposure_amount, cs.oldest_open_due_date
    INTO v_customer_active, v_credit_enabled, v_credit_limit, v_payment_terms_days,
         v_max_overdue_days, v_exposure, v_oldest_due
    FROM receivables.customers c
    JOIN receivables.customer_credit_state cs ON cs.customer_id = c.id
    WHERE c.id = p_customer_id
    FOR UPDATE OF c, cs;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'customer % not found', p_customer_id USING ERRCODE = '22023';
    END IF;
    IF NOT v_customer_active THEN
        RAISE EXCEPTION 'customer is inactive' USING ERRCODE = '55000';
    END IF;
    IF NOT v_credit_enabled THEN
        RAISE EXCEPTION 'customer is not enabled for credit sales' USING ERRCODE = '55000';
    END IF;

    -- Validate wire amounts and calculate sale total before any inventory mutation.
    FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
    LOOP
        v_variant_id := NULLIF(v_line ->> 'variant_id', '')::bigint;
        v_quantity := NULLIF(v_line ->> 'quantity', '')::numeric;
        v_unit_price := NULLIF(v_line ->> 'unit_price', '')::numeric;
        IF v_variant_id IS NULL OR v_quantity IS NULL OR v_unit_price IS NULL THEN
            RAISE EXCEPTION 'credit sale line is missing required fields' USING ERRCODE = '22023';
        END IF;
        IF v_quantity <= 0 THEN
            RAISE EXCEPTION 'credit sale quantity must be positive' USING ERRCODE = '22023';
        END IF;
        IF v_unit_price < 0 THEN
            RAISE EXCEPTION 'credit sale unit price cannot be negative' USING ERRCODE = '22023';
        END IF;
        v_subtotal := v_subtotal + round(v_quantity * v_unit_price, 2);
    END LOOP;

    IF v_subtotal <= 0 THEN
        RAISE EXCEPTION 'credit sale total must be positive' USING ERRCODE = '22023';
    END IF;

    v_due_date := p_document_date + v_payment_terms_days;
    v_over_limit := (v_exposure + v_subtotal) > v_credit_limit;
    v_overdue_blocked := v_oldest_due IS NOT NULL
        AND v_max_overdue_days IS NOT NULL
        AND (v_oldest_due + v_max_overdue_days) < v_business_today;

    IF v_over_limit OR v_overdue_blocked THEN
        IF p_override_token IS NULL THEN
            RAISE EXCEPTION 'customer credit policy blocks this sale' USING ERRCODE = '55000';
        END IF;

        PERFORM 1
        FROM receivables.credit_override_tokens o
        WHERE o.id = p_override_token
          AND o.customer_id = p_customer_id
          AND o.canonical_payload_hash = encode(p_payload_hash, 'hex')
          AND o.consumed_at IS NULL
          AND o.expires_at > now()
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'credit override is invalid, expired, consumed, or does not match this sale'
                USING ERRCODE = '55000';
        END IF;
        v_override_used := true;
    END IF;

    -- Lock all existing touched stock positions in deterministic order.
    PERFORM 1
    FROM inventory.positions
    WHERE warehouse_id = p_warehouse_id
      AND variant_id IN (
          SELECT DISTINCT (elem ->> 'variant_id')::bigint
          FROM jsonb_array_elements(p_lines) elem
      )
    ORDER BY variant_id
    FOR UPDATE;

    INSERT INTO core.business_documents (
        document_type, document_date, fiscal_period_id, fiscal_year
    ) VALUES (
        'CREDIT_SALE', p_document_date, p_fiscal_period_id, v_fiscal_year
    ) RETURNING id INTO v_document_id;

    INSERT INTO sales.credit_sales (
        document_id, customer_id, warehouse_id, subtotal, total_amount, due_date,
        posted_by_user_id, workstation_id
    ) VALUES (
        v_document_id, p_customer_id, p_warehouse_id, 0, 0, v_due_date,
        v_user_id, v_workstation_id
    );

    v_line_number := 0;
    FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
    LOOP
        v_line_number := v_line_number + 1;
        v_variant_id := (v_line ->> 'variant_id')::bigint;
        v_quantity := (v_line ->> 'quantity')::numeric;
        v_unit_price := (v_line ->> 'unit_price')::numeric;

        SELECT pv.is_active, pv.sku, p.name
        INTO v_variant_active, v_variant_sku, v_variant_name
        FROM catalog.product_variants pv
        JOIN catalog.products p ON p.id = pv.product_id
        WHERE pv.id = v_variant_id;

        IF NOT FOUND OR NOT v_variant_active THEN
            RAISE EXCEPTION 'variant % is missing or inactive', v_variant_id USING ERRCODE = '22023';
        END IF;

        SELECT quantity_on_hand, total_value, last_known_wac
        INTO v_qty_on_hand, v_position_value, v_wac
        FROM inventory.positions
        WHERE warehouse_id = p_warehouse_id AND variant_id = v_variant_id;

        IF NOT FOUND THEN
            v_qty_on_hand := 0;
            v_position_value := 0;
            v_wac := 0;
        END IF;
        IF v_qty_on_hand < v_quantity THEN
            RAISE EXCEPTION 'insufficient stock for variant %', v_variant_id USING ERRCODE = '55000';
        END IF;

        v_unit_cost_snapshot := v_wac;
        v_line_total := round(v_quantity * v_unit_price, 2);
        v_total_cogs := v_total_cogs + round(v_quantity * v_unit_cost_snapshot, 4);
        v_new_qty := v_qty_on_hand - v_quantity;
        v_new_value := v_position_value - round(v_quantity * v_wac, 4);

        IF v_new_qty = 0 THEN
            IF abs(v_new_value) >= 0.01 THEN
                RAISE EXCEPTION 'credit sale would leave a material zero-quantity inventory residual'
                    USING ERRCODE = '55000';
            END IF;
        ELSIF v_new_value < 0 THEN
            RAISE EXCEPTION 'credit sale would make inventory value negative' USING ERRCODE = '55000';
        END IF;

        UPDATE inventory.positions
        SET quantity_on_hand = v_new_qty,
            total_value = CASE WHEN v_new_qty = 0 THEN 0 ELSE v_new_value END
        WHERE warehouse_id = p_warehouse_id AND variant_id = v_variant_id;

        INSERT INTO inventory.movements (
            warehouse_id, variant_id, movement_type, quantity_delta, inventory_value_delta,
            resulting_quantity_on_hand, resulting_total_value, reference_type, reference_id
        ) VALUES (
            p_warehouse_id, v_variant_id, 'ISSUE', -v_quantity,
            -round(v_quantity * v_wac, 4), v_new_qty,
            CASE WHEN v_new_qty = 0 THEN 0 ELSE v_new_value END,
            'CREDIT_SALE_LINE', v_document_id
        ) RETURNING id INTO v_movement_id;

        IF v_new_qty = 0 AND v_new_value <> 0 THEN
            v_residual_journal_id := inventory._handle_residual_at_zero_quantity(
                p_warehouse_id, v_variant_id, v_movement_id, v_new_value,
                p_fiscal_period_id, p_document_date
            );
        END IF;

        INSERT INTO sales.credit_sale_lines (
            document_id, line_number, variant_id, variant_sku_snapshot,
            variant_name_snapshot, quantity, unit_price, unit_cost_snapshot, line_total
        ) VALUES (
            v_document_id, v_line_number, v_variant_id, v_variant_sku,
            v_variant_name, v_quantity, v_unit_price, v_unit_cost_snapshot, v_line_total
        );
    END LOOP;

    UPDATE sales.credit_sales
    SET subtotal = v_subtotal, total_amount = v_subtotal
    WHERE document_id = v_document_id;

    -- Receivable journal: Dr AR / Cr revenue, plus COGS / inventory.
    INSERT INTO core.business_documents (
        document_type, document_date, fiscal_period_id, fiscal_year
    ) VALUES (
        'JOURNAL_ENTRY', p_document_date, p_fiscal_period_id, v_fiscal_year
    ) RETURNING id INTO v_journal_document_id;

    INSERT INTO finance.journal_entries (document_id, description, source_type, source_id)
    VALUES (v_journal_document_id, 'Customer credit sale', 'CREDIT_SALE', v_document_id);

    INSERT INTO finance.journal_lines (document_id, line_number, account_code, account_id, debit, credit) VALUES
        (v_journal_document_id, 1, 'ACCOUNTS_RECEIVABLE', finance.resolve_account_id('ACCOUNTS_RECEIVABLE'), v_subtotal, 0),
        (v_journal_document_id, 2, 'SALES_REVENUE', finance.resolve_account_id('SALES_REVENUE'), 0, v_subtotal);

    IF v_total_cogs > 0 THEN
        INSERT INTO finance.journal_lines (document_id, line_number, account_code, account_id, debit, credit) VALUES
            (v_journal_document_id, 3, 'COGS', finance.resolve_account_id('COGS'), round(v_total_cogs, 2), 0),
            (v_journal_document_id, 4, 'INVENTORY_MERCHANDISE', finance.resolve_account_id('INVENTORY_MERCHANDISE'), 0, round(v_total_cogs, 2));
    END IF;

    UPDATE sales.credit_sales
    SET journal_document_id = v_journal_document_id
    WHERE document_id = v_document_id;

    -- Official numbers claimed inside transaction; rollback leaves no gap.
    v_sequence := core.claim_next_document_number('CREDIT_SALE', v_fiscal_year);
    v_document_number := 'CR-' || v_fiscal_year || '-' || lpad(v_sequence::text, 6, '0');
    UPDATE core.business_documents
    SET status = 'POSTED', sequence_number = v_sequence,
        document_number = v_document_number, posted_at = now()
    WHERE id = v_document_id;

    v_journal_sequence := core.claim_next_document_number('JOURNAL_ENTRY', v_fiscal_year);
    v_journal_number := 'JE-' || v_fiscal_year || '-' || lpad(v_journal_sequence::text, 6, '0');
    UPDATE core.business_documents
    SET status = 'POSTED', sequence_number = v_journal_sequence,
        document_number = v_journal_number, posted_at = now()
    WHERE id = v_journal_document_id;

    -- Append-only AR movement and authoritative cache update happen under the
    -- same customer lock as the credit decision.
    INSERT INTO receivables.customer_ledger_entries (
        customer_id, entry_type, amount_delta, document_id, due_date,
        posted_by_user_id, workstation_id
    ) VALUES (
        p_customer_id, 'CREDIT_INVOICE', v_subtotal, v_document_id, v_due_date,
        v_user_id, v_workstation_id
    );

    v_new_exposure := v_exposure + v_subtotal;
    UPDATE receivables.customer_credit_state
    SET exposure_amount = v_new_exposure,
        oldest_open_due_date = CASE
            WHEN oldest_open_due_date IS NULL THEN v_due_date
            ELSE least(oldest_open_due_date, v_due_date)
        END
    WHERE customer_id = p_customer_id;

    IF v_override_used THEN
        UPDATE receivables.credit_override_tokens
        SET consumed_at = now(), consumed_document_id = v_document_id
        WHERE id = p_override_token;
    END IF;

    PERFORM core.record_idempotent_result(
        'sales.confirm_credit_sale', p_request_id, v_document_id
    );

    RETURN jsonb_build_object(
        'document_id', v_document_id,
        'document_number', v_document_number,
        'customer_id', p_customer_id,
        'total_amount', v_subtotal::text,
        'due_date', v_due_date,
        'exposure_amount', v_new_exposure::text,
        'available_credit', (v_credit_limit - v_new_exposure)::text,
        'journal_document_id', v_journal_document_id
    );
END;
$function$;

RESET ROLE;
