-- WS-B-1 Gate 3b (3 of 4): dual-write account_id in
-- receivables.post_customer_payment. Confirmed clean in this task's
-- pre-check: v_debit_account ('CASH_DESK' or 'BANK_ACCOUNT') and
-- ACCOUNTS_RECEIVABLE both already resolve via finance.resolve_account_id().
-- account_id for the dynamic line is resolved from the same v_debit_account
-- variable's runtime value, not from a hardcoded assumption of which branch
-- executes. Only the one journal-line INSERT changes.
SET ROLE stockiha_owner;

CREATE OR REPLACE FUNCTION receivables.post_customer_payment(p_session_token text, p_request_id uuid, p_customer_id bigint, p_amount numeric, p_payment_method text, p_cash_session_id bigint, p_fiscal_period_id bigint, p_document_date date, p_allocations jsonb, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
    v_user_id bigint;
    v_workstation_id text;
    v_method text := upper(coalesce(nullif(btrim(p_payment_method), ''), 'CASH'));
    v_canonical_allocations jsonb;
    v_payload_hash bytea;
    v_cached_result bigint;
    v_period_status text;
    v_period_start date;
    v_period_end date;
    v_fiscal_year integer;
    v_customer_active boolean;
    v_exposure numeric(14,2);
    v_alloc jsonb;
    v_invoice_entry_id bigint;
    v_alloc_amount numeric(14,2);
    v_allocation_sum numeric(14,2) := 0;
    v_invoice_customer_id bigint;
    v_invoice_amount numeric(14,2);
    v_already_allocated numeric(14,2);
    v_doc_id bigint;
    v_doc_seq bigint;
    v_doc_num text;
    v_journal_doc_id bigint;
    v_journal_seq bigint;
    v_journal_num text;
    v_debit_account text;
    v_payment_ledger_id bigint;
    v_new_exposure numeric(14,2);
    v_oldest_due date;
    v_result jsonb;
    v_session_status text;
    v_current_cashier bigint;
    v_session_workstation text;
BEGIN
    SELECT user_id, workstation_id
    INTO v_user_id, v_workstation_id
    FROM iam.resolve_session_with_permission(p_session_token, 'POST_CUSTOMER_PAYMENT');

    IF p_customer_id IS NULL OR p_customer_id <= 0 THEN
        RAISE EXCEPTION 'customer is required' USING ERRCODE = '22023';
    END IF;
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'payment amount must be positive' USING ERRCODE = '22023';
    END IF;
    IF v_method NOT IN ('CASH', 'BANK_TRANSFER') THEN
        RAISE EXCEPTION 'unsupported customer payment method' USING ERRCODE = '22023';
    END IF;
    IF p_allocations IS NULL OR jsonb_typeof(p_allocations) <> 'array' OR jsonb_array_length(p_allocations) = 0 THEN
        RAISE EXCEPTION 'customer payment requires at least one invoice allocation' USING ERRCODE = '22023';
    END IF;

    BEGIN
        SELECT jsonb_agg(
                   jsonb_build_object(
                       'invoice_ledger_entry_id', invoice_ledger_entry_id,
                       'amount', trim_scale(amount)
                   ) ORDER BY invoice_ledger_entry_id
               )
        INTO v_canonical_allocations
        FROM (
            SELECT
                nullif(elem ->> 'invoice_ledger_entry_id', '')::bigint AS invoice_ledger_entry_id,
                sum(nullif(elem ->> 'amount', '')::numeric) AS amount
            FROM jsonb_array_elements(p_allocations) elem
            GROUP BY nullif(elem ->> 'invoice_ledger_entry_id', '')::bigint
        ) normalized
        WHERE invoice_ledger_entry_id IS NOT NULL
          AND amount IS NOT NULL;
    EXCEPTION
        WHEN invalid_text_representation OR numeric_value_out_of_range THEN
            RAISE EXCEPTION 'invalid customer payment allocation' USING ERRCODE = '22023';
    END;

    IF v_canonical_allocations IS NULL
       OR jsonb_array_length(v_canonical_allocations) = 0
       OR EXISTS (
           SELECT 1 FROM jsonb_array_elements(v_canonical_allocations) elem
           WHERE (elem ->> 'amount')::numeric <= 0
              OR (elem ->> 'invoice_ledger_entry_id')::bigint <= 0
       ) THEN
        RAISE EXCEPTION 'invalid customer payment allocation' USING ERRCODE = '22023';
    END IF;

    v_payload_hash := sha256(convert_to(jsonb_build_object(
        'customer_id', p_customer_id,
        'amount', trim_scale(p_amount),
        'payment_method', v_method,
        'cash_session_id', p_cash_session_id,
        'fiscal_period_id', p_fiscal_period_id,
        'document_date', p_document_date,
        'allocations', v_canonical_allocations,
        'note', nullif(btrim(p_note), '')
    )::text, 'UTF8'));

    v_cached_result := core.reserve_idempotent_request(
        'receivables.post_customer_payment', p_request_id, v_payload_hash
    );
    IF v_cached_result IS NOT NULL THEN
        SELECT jsonb_build_object(
            'document_id', d.id,
            'document_number', d.document_number,
            'customer_id', cp.customer_id,
            'payment_method', cp.payment_method,
            'amount', cp.amount::text,
            'exposure_amount', cs.exposure_amount::text,
            'available_credit', (c.credit_limit - cs.exposure_amount)::text,
            'journal_document_id', cp.journal_document_id,
            'payment_ledger_entry_id', l.id
        ) INTO v_result
        FROM core.business_documents d
        JOIN receivables.customer_payments cp ON cp.document_id = d.id
        JOIN receivables.customers c ON c.id = cp.customer_id
        JOIN receivables.customer_credit_state cs ON cs.customer_id = c.id
        JOIN receivables.customer_ledger_entries l
          ON l.document_id = d.id AND l.entry_type = 'PAYMENT'
        WHERE d.id = v_cached_result;
        RETURN v_result;
    END IF;

    SELECT status, starts_on, ends_on, extract(year FROM starts_on)::integer
    INTO v_period_status, v_period_start, v_period_end, v_fiscal_year
    FROM finance.fiscal_periods
    WHERE id = p_fiscal_period_id
    FOR SHARE;
    IF NOT FOUND OR v_period_status <> 'OPEN' THEN
        RAISE EXCEPTION 'fiscal period is not open' USING ERRCODE = '55000';
    END IF;
    IF p_document_date < v_period_start OR p_document_date > v_period_end THEN
        RAISE EXCEPTION 'document date is outside fiscal period' USING ERRCODE = '22023';
    END IF;

    SELECT c.is_active, cs.exposure_amount
    INTO v_customer_active, v_exposure
    FROM receivables.customers c
    JOIN receivables.customer_credit_state cs ON cs.customer_id = c.id
    WHERE c.id = p_customer_id
    FOR UPDATE OF c, cs;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'customer not found' USING ERRCODE = '22023';
    END IF;
    IF NOT v_customer_active THEN
        RAISE EXCEPTION 'customer is inactive' USING ERRCODE = '55000';
    END IF;
    IF p_amount > v_exposure THEN
        RAISE EXCEPTION 'payment exceeds customer exposure' USING ERRCODE = '55000';
    END IF;

    IF v_method = 'CASH' THEN
        IF p_cash_session_id IS NULL THEN
            RAISE EXCEPTION 'cash payment requires an active cash session' USING ERRCODE = '55000';
        END IF;
        SELECT status, current_cashier_user_id, workstation_id
        INTO v_session_status, v_current_cashier, v_session_workstation
        FROM sales.cash_sessions
        WHERE id = p_cash_session_id
        FOR UPDATE;
        IF NOT FOUND OR v_session_status <> 'OPEN' THEN
            RAISE EXCEPTION 'cash session is not open' USING ERRCODE = '55000';
        END IF;
        IF v_current_cashier <> v_user_id OR v_session_workstation <> v_workstation_id THEN
            RAISE EXCEPTION 'cash session is not owned by the authenticated cashier/workstation'
                USING ERRCODE = '42501';
        END IF;
    ELSIF p_cash_session_id IS NOT NULL THEN
        RAISE EXCEPTION 'non-cash payment must not specify a cash session' USING ERRCODE = '22023';
    END IF;

    PERFORM 1
    FROM receivables.customer_ledger_entries l
    WHERE l.id IN (
        SELECT (elem ->> 'invoice_ledger_entry_id')::bigint
        FROM jsonb_array_elements(v_canonical_allocations) elem
    )
    ORDER BY l.id
    FOR UPDATE;

    FOR v_alloc IN SELECT * FROM jsonb_array_elements(v_canonical_allocations)
    LOOP
        v_invoice_entry_id := (v_alloc ->> 'invoice_ledger_entry_id')::bigint;
        v_alloc_amount := (v_alloc ->> 'amount')::numeric;

        SELECT l.customer_id, l.amount_delta
        INTO v_invoice_customer_id, v_invoice_amount
        FROM receivables.customer_ledger_entries l
        WHERE l.id = v_invoice_entry_id
          AND l.entry_type = 'CREDIT_INVOICE';

        IF NOT FOUND THEN
            RAISE EXCEPTION 'allocated invoice ledger entry not found' USING ERRCODE = '55000';
        END IF;
        IF v_invoice_customer_id <> p_customer_id THEN
            RAISE EXCEPTION 'payment allocation cannot cross customers' USING ERRCODE = '55000';
        END IF;

        v_already_allocated := receivables.net_invoice_allocated_amount(v_invoice_entry_id);
        IF v_already_allocated + v_alloc_amount > v_invoice_amount THEN
            RAISE EXCEPTION 'payment allocation exceeds invoice remaining amount' USING ERRCODE = '55000';
        END IF;
        v_allocation_sum := v_allocation_sum + v_alloc_amount;
    END LOOP;

    IF v_allocation_sum <> p_amount THEN
        RAISE EXCEPTION 'payment allocations must equal payment amount' USING ERRCODE = '55000';
    END IF;

    v_doc_seq := core.claim_next_document_number('CUSTOMER_PAYMENT', v_fiscal_year);
    v_doc_num := 'CP-' || v_fiscal_year::text || '-' || lpad(v_doc_seq::text, 6, '0');
    INSERT INTO core.business_documents (
        document_type, status, document_date, fiscal_period_id, fiscal_year,
        sequence_number, document_number, posted_at
    ) VALUES (
        'CUSTOMER_PAYMENT', 'POSTED', p_document_date, p_fiscal_period_id, v_fiscal_year,
        v_doc_seq, v_doc_num, now()
    ) RETURNING id INTO v_doc_id;

    v_journal_seq := core.claim_next_document_number('JOURNAL_ENTRY', v_fiscal_year);
    v_journal_num := 'JE-' || v_fiscal_year::text || '-' || lpad(v_journal_seq::text, 6, '0');
    INSERT INTO core.business_documents (
        document_type, status, document_date, fiscal_period_id, fiscal_year,
        sequence_number, document_number, posted_at
    ) VALUES (
        'JOURNAL_ENTRY', 'POSTED', p_document_date, p_fiscal_period_id, v_fiscal_year,
        v_journal_seq, v_journal_num, now()
    ) RETURNING id INTO v_journal_doc_id;

    INSERT INTO finance.journal_entries (document_id, description, source_type, source_id)
    VALUES (v_journal_doc_id, 'Customer receivable payment', 'CUSTOMER_PAYMENT', v_doc_id);

    v_debit_account := CASE WHEN v_method = 'CASH' THEN 'CASH_DESK' ELSE 'BANK_ACCOUNT' END;
    INSERT INTO finance.journal_lines (document_id, line_number, account_code, account_id, debit, credit) VALUES
        (v_journal_doc_id, 1, v_debit_account, finance.resolve_account_id(v_debit_account), p_amount, 0),
        (v_journal_doc_id, 2, 'ACCOUNTS_RECEIVABLE', finance.resolve_account_id('ACCOUNTS_RECEIVABLE'), 0, p_amount);

    INSERT INTO receivables.customer_payments (
        document_id, customer_id, payment_method, amount, cash_session_id,
        journal_document_id, posted_by_user_id, workstation_id, note
    ) VALUES (
        v_doc_id, p_customer_id, v_method, p_amount,
        CASE WHEN v_method = 'CASH' THEN p_cash_session_id ELSE NULL END,
        v_journal_doc_id, v_user_id, v_workstation_id, nullif(btrim(p_note), '')
    );

    INSERT INTO receivables.customer_ledger_entries (
        customer_id, entry_type, amount_delta, document_id,
        posted_by_user_id, workstation_id
    ) VALUES (
        p_customer_id, 'PAYMENT', -p_amount, v_doc_id,
        v_user_id, v_workstation_id
    ) RETURNING id INTO v_payment_ledger_id;

    FOR v_alloc IN SELECT * FROM jsonb_array_elements(v_canonical_allocations)
    LOOP
        INSERT INTO receivables.payment_allocations (
            payment_document_id, invoice_ledger_entry_id, amount
        ) VALUES (
            v_doc_id,
            (v_alloc ->> 'invoice_ledger_entry_id')::bigint,
            (v_alloc ->> 'amount')::numeric
        );
    END LOOP;

    v_new_exposure := v_exposure - p_amount;

    SELECT min(l.due_date)
    INTO v_oldest_due
    FROM receivables.customer_ledger_entries l
    WHERE l.customer_id = p_customer_id
      AND l.entry_type = 'CREDIT_INVOICE'
      AND l.due_date IS NOT NULL
      AND l.amount_delta > receivables.net_invoice_allocated_amount(l.id);

    UPDATE receivables.customer_credit_state
    SET exposure_amount = v_new_exposure,
        oldest_open_due_date = v_oldest_due,
        last_rebuilt_at = now()
    WHERE customer_id = p_customer_id;

    IF v_method = 'CASH' THEN
        INSERT INTO cash.movements (
            cash_session_id, business_document_id, movement_type, amount
        ) VALUES (
            p_cash_session_id, v_doc_id, 'CUSTOMER_PAYMENT', p_amount
        );
        PERFORM cash.enqueue_drawer_job(
            p_cash_session_id,
            v_doc_id,
            'customer_payment:' || v_doc_id::text
        );
    END IF;

    PERFORM core.record_idempotent_result(
        'receivables.post_customer_payment', p_request_id, v_doc_id
    );

    RETURN jsonb_build_object(
        'document_id', v_doc_id,
        'document_number', v_doc_num,
        'customer_id', p_customer_id,
        'payment_method', v_method,
        'amount', p_amount::text,
        'exposure_amount', v_new_exposure::text,
        'available_credit', (
            (SELECT credit_limit FROM receivables.customers WHERE id = p_customer_id)
            - v_new_exposure
        )::text,
        'journal_document_id', v_journal_doc_id,
        'payment_ledger_entry_id', v_payment_ledger_id
    );
END;
$function$;

RESET ROLE;
