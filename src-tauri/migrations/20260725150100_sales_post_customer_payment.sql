-- S4-001: post_customer_payment — SECURITY DEFINER posting function
-- Reduces an open customer liability, updates the live exposure cache,
-- posts a balanced double-entry journal (Dr CASH_DESK / Cr ACCOUNTS_RECEIVABLE),
-- and records the payment with an official document number CP-YYYY-XXXXXX.

CREATE OR REPLACE FUNCTION sales.post_customer_payment(
    p_session_token  text,
    p_request_id     uuid,
    p_customer_id    bigint,
    p_liability_id   bigint,
    p_amount         numeric,
    p_payment_method text,      -- 'CASH' | 'BANK_TRANSFER' | 'CHECK'
    p_fiscal_period_id bigint,
    p_document_date  date,
    p_note           text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = core, sales, finance, iam, public AS $$
DECLARE
    v_user_id           bigint;
    v_existing_doc_id   bigint;
    v_period_status     text;
    v_fiscal_year       integer;

    v_liability         sales.customer_liabilities%ROWTYPE;

    v_cp_seq            bigint;
    v_cp_num            text;
    v_doc_id            bigint;

    v_je_seq            bigint;
    v_journal_num       text;
    v_journal_doc_id    bigint;

    v_debit_account     text;
BEGIN
    -- ── 1. Validate session ──────────────────────────────────────────────────
    SELECT s.user_id INTO v_user_id
    FROM iam.application_sessions s
    WHERE s.token_hash = sha256(p_session_token::bytea)
      AND s.revoked_at IS NULL
      AND s.expires_at > now();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'SESSION_INVALID: Invalid or expired session' USING ERRCODE = '28000';
    END IF;

    -- ── 2. Check permissions ─────────────────────────────────────────────────
    IF NOT EXISTS (
        SELECT 1 FROM iam.user_roles ur
        JOIN iam.roles r ON ur.role_id = r.id
        WHERE ur.user_id = v_user_id
          AND r.code IN ('ADMIN', 'MANAGER', 'ACCOUNTANT', 'CASHIER')
    ) THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: Role not authorized to post customer payments' USING ERRCODE = '42501';
    END IF;

    -- ── 3. Validate amount ───────────────────────────────────────────────────
    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Payment amount must be positive' USING ERRCODE = '22023';
    END IF;

    IF p_payment_method NOT IN ('CASH', 'BANK_TRANSFER', 'CHECK') THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Invalid payment method: %', p_payment_method USING ERRCODE = '22023';
    END IF;

    -- ── 4. Idempotency check ─────────────────────────────────────────────────
    -- Compute a deterministic hash for this operation payload
    v_existing_doc_id := core.reserve_idempotent_request(
        'sales.post_customer_payment',
        p_request_id,
        sha256((p_customer_id::text || '|' || p_liability_id::text || '|' || p_amount::text
                || '|' || p_payment_method || '|' || p_fiscal_period_id::text
                || '|' || p_document_date::text)::bytea)
    );
    IF v_existing_doc_id IS NOT NULL THEN
        RETURN jsonb_build_object(
            'document_id', v_existing_doc_id,
            'idempotent_replay', true
        );
    END IF;

    -- ── 5. Validate fiscal period ────────────────────────────────────────────
    SELECT fp.status INTO v_period_status
    FROM finance.fiscal_periods fp
    WHERE fp.id = p_fiscal_period_id;
    IF v_period_status IS NULL OR v_period_status <> 'OPEN' THEN
        RAISE EXCEPTION 'CLOSED_FISCAL_PERIOD: Fiscal period % is not open', p_fiscal_period_id USING ERRCODE = '22023';
    END IF;

    -- ── 6. Lock and validate the liability ──────────────────────────────────
    SELECT * INTO v_liability
    FROM sales.customer_liabilities
    WHERE id = p_liability_id
      AND customer_id = p_customer_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: Customer liability % not found for customer %', p_liability_id, p_customer_id USING ERRCODE = '55000';
    END IF;
    IF v_liability.status = 'PAID' THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: Liability % is already fully paid', p_liability_id USING ERRCODE = '55000';
    END IF;
    IF p_amount > v_liability.remaining_amount THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: Payment amount (%) exceeds remaining liability balance (%)', p_amount, v_liability.remaining_amount USING ERRCODE = '55000';
    END IF;

    -- ── 7. Determine journal debit account ───────────────────────────────────
    IF UPPER(p_payment_method) = 'CASH' THEN
        v_debit_account := 'CASH_DESK';
    ELSE
        v_debit_account := 'BANK_ACCOUNT';
    END IF;

    v_fiscal_year := extract(year FROM p_document_date)::integer;

    -- ── 8. Claim customer payment document number ────────────────────────────
    v_cp_seq := core.claim_next_document_number('CUSTOMER_PAYMENT', v_fiscal_year);
    v_cp_num  := 'CP-' || v_fiscal_year::text || '-' || lpad(v_cp_seq::text, 6, '0');

    INSERT INTO core.business_documents
        (document_type, status, document_date, fiscal_period_id, fiscal_year,
         sequence_number, document_number, posted_at)
    VALUES
        ('CUSTOMER_PAYMENT', 'POSTED', p_document_date, p_fiscal_period_id, v_fiscal_year,
         v_cp_seq, v_cp_num, now())
    RETURNING id INTO v_doc_id;

    -- ── 9. Record customer payment ───────────────────────────────────────────
    INSERT INTO sales.customer_payments
        (customer_id, liability_id, document_id, amount, payment_method, document_date, fiscal_period_id, note)
    VALUES
        (p_customer_id, p_liability_id, v_doc_id, p_amount, p_payment_method, p_document_date, p_fiscal_period_id, p_note);

    -- ── 10. Reduce liability balance ─────────────────────────────────────────
    UPDATE sales.customer_liabilities
    SET remaining_amount = remaining_amount - p_amount,
        status = CASE
            WHEN (remaining_amount - p_amount) <= 0 THEN 'PAID'
            ELSE 'PARTIALLY_PAID'
        END
    WHERE id = p_liability_id;

    -- ── 11. Reduce exposure cache ────────────────────────────────────────────
    INSERT INTO sales.customer_credit_states (customer_id, exposure_amount, last_recalculated_at)
    VALUES (p_customer_id, 0, now())
    ON CONFLICT (customer_id) DO UPDATE
    SET exposure_amount      = GREATEST(0, sales.customer_credit_states.exposure_amount - p_amount),
        last_recalculated_at = now();

    -- ── 12. Post double-entry journal ────────────────────────────────────────
    v_je_seq     := core.claim_next_document_number('JOURNAL_ENTRY', v_fiscal_year);
    v_journal_num := 'JE-' || v_fiscal_year::text || '-' || lpad(v_je_seq::text, 6, '0');

    INSERT INTO core.business_documents
        (document_type, status, document_date, fiscal_period_id, fiscal_year,
         sequence_number, document_number, posted_at)
    VALUES
        ('JOURNAL_ENTRY', 'POSTED', p_document_date, p_fiscal_period_id, v_fiscal_year,
         v_je_seq, v_journal_num, now())
    RETURNING id INTO v_journal_doc_id;

    INSERT INTO finance.journal_entries (document_id, description, source_type, source_id)
    VALUES (v_journal_doc_id, 'Customer payment ' || v_cp_num, 'CUSTOMER_PAYMENT', v_doc_id);

    INSERT INTO finance.journal_lines (document_id, line_number, account_code, debit, credit)
    VALUES
        (v_journal_doc_id, 1, v_debit_account,         p_amount, 0),         -- Dr CASH_DESK/BANK_ACCOUNT
        (v_journal_doc_id, 2, 'ACCOUNTS_RECEIVABLE',   0, p_amount);         -- Cr ACCOUNTS_RECEIVABLE

    -- ── 13. Record idempotency result ────────────────────────────────────────
    PERFORM core.record_idempotent_result('sales.post_customer_payment', p_request_id, v_doc_id);

    RETURN jsonb_build_object(
        'document_id',        v_doc_id,
        'document_number',    v_cp_num,
        'journal_document_id', v_journal_doc_id,
        'amount',             p_amount
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION sales.post_customer_payment(text, uuid, bigint, bigint, numeric, text, bigint, date, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION sales.post_customer_payment(text, uuid, bigint, bigint, numeric, text, bigint, date, text) TO stockiha_runtime;
