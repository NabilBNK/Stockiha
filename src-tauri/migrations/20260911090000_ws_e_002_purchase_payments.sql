-- WS-E-002: supplier payment against a posted purchase receipt.
--
-- In this MVP there are no supplier invoices. inventory.confirm_direct_purchase
-- credits GRNI when goods arrive, and this migration adds the settlement side:
-- a payment debits GRNI and credits Cash or Bank. GRNI is therefore the
-- effective supplier balance. inventory.confirm_direct_purchase is deliberately
-- left untouched; every object here is new and additive.
--
-- A cash payment posts to the cash ledger account only. It intentionally does
-- not write a cash.movements row and does not require an open cash session --
-- drawer integration is WS-F scope.

SET ROLE stockiha_owner;

-- =============================================================================
-- 1. Payment table
-- =============================================================================

CREATE TABLE IF NOT EXISTS procurement.purchase_receipt_payments (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    document_id         bigint NOT NULL UNIQUE REFERENCES core.business_documents (id) ON DELETE RESTRICT,
    receipt_document_id bigint NOT NULL REFERENCES procurement.purchase_receipts (document_id) ON DELETE RESTRICT,
    supplier_id         bigint NOT NULL REFERENCES procurement.suppliers (id) ON DELETE RESTRICT,
    payment_method      text NOT NULL,
    amount              numeric(14, 2) NOT NULL,
    reference_number    text,
    journal_document_id bigint NOT NULL REFERENCES finance.journal_entries (document_id) ON DELETE RESTRICT,
    posted_by_user_id   bigint NOT NULL REFERENCES iam.users (id) ON DELETE RESTRICT,
    created_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT purchase_receipt_payments_method_valid
        CHECK (payment_method IN ('CASH', 'BANK_TRANSFER')),
    CONSTRAINT purchase_receipt_payments_amount_positive
        CHECK (amount > 0)
);

CREATE INDEX IF NOT EXISTS purchase_receipt_payments_receipt_idx
    ON procurement.purchase_receipt_payments (receipt_document_id);

CREATE INDEX IF NOT EXISTS purchase_receipt_payments_supplier_idx
    ON procurement.purchase_receipt_payments (supplier_id);

-- =============================================================================
-- 2. Immutability -- a posted payment is business evidence, never edited
-- =============================================================================

CREATE OR REPLACE FUNCTION procurement.forbid_purchase_payment_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'IMMUTABLE_RECORD: posted supplier payments cannot be modified or deleted'
        USING ERRCODE = '0A000';
END;
$$;

DROP TRIGGER IF EXISTS purchase_receipt_payments_immutable
    ON procurement.purchase_receipt_payments;

CREATE TRIGGER purchase_receipt_payments_immutable
    BEFORE UPDATE OR DELETE ON procurement.purchase_receipt_payments
    FOR EACH ROW
    EXECUTE FUNCTION procurement.forbid_purchase_payment_mutation();

-- =============================================================================
-- 3. Shared response shape (also used to replay an idempotent retry)
-- =============================================================================

CREATE OR REPLACE FUNCTION procurement._purchase_payment_response(p_payment_document_id bigint)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
    SELECT jsonb_build_object(
        'document_id', payment.document_id,
        'document_number', payment_document.document_number,
        'receipt_document_id', payment.receipt_document_id,
        'receipt_document_number', receipt_document.document_number,
        'supplier_id', payment.supplier_id,
        'supplier_name', supplier.name,
        'payment_method', payment.payment_method,
        'amount', payment.amount::text,
        'reference_number', payment.reference_number,
        'journal_document_id', payment.journal_document_id,
        'journal_document_number', journal_document.document_number,
        'posted_at', payment_document.posted_at
    )
    FROM procurement.purchase_receipt_payments payment
    JOIN core.business_documents payment_document ON payment_document.id = payment.document_id
    JOIN core.business_documents receipt_document ON receipt_document.id = payment.receipt_document_id
    JOIN core.business_documents journal_document ON journal_document.id = payment.journal_document_id
    JOIN procurement.suppliers supplier ON supplier.id = payment.supplier_id
    WHERE payment.document_id = p_payment_document_id;
$$;

-- =============================================================================
-- 4. The posting function
-- =============================================================================

CREATE OR REPLACE FUNCTION procurement.post_purchase_payment(
    p_session_token text,
    p_request_id uuid,
    p_payload_hash bytea,
    p_receipt_document_id bigint,
    p_fiscal_period_id bigint,
    p_document_date date,
    p_payment_method text,
    p_amount numeric,
    p_reference_number text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_user_id bigint;
    v_cached_result bigint;
    v_period_status text;
    v_period_start date;
    v_period_end date;
    v_fiscal_year integer;
    v_supplier_id bigint;
    v_receipt_total numeric(14, 2);
    v_already_paid numeric(14, 2);
    v_outstanding numeric(14, 2);
    v_amount numeric(14, 2);
    v_sequence bigint;
    v_document_number text;
    v_payment_document_id bigint;
    v_journal_document_id bigint;
BEGIN
    -- 1. Session and permission
    SELECT user_id INTO v_user_id
    FROM iam.resolve_session_with_permission(p_session_token, 'POST_SUPPLIER_PAYMENT');

    -- 2. Idempotency
    v_cached_result := core.reserve_idempotent_request(
        'procurement.post_purchase_payment', p_request_id, p_payload_hash
    );
    IF v_cached_result IS NOT NULL THEN
        RETURN procurement._purchase_payment_response(v_cached_result);
    END IF;

    -- 3. Method and amount
    IF p_payment_method IS NULL OR p_payment_method NOT IN ('CASH', 'BANK_TRANSFER') THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: payment method must be CASH or BANK_TRANSFER'
            USING ERRCODE = '22023';
    END IF;

    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: payment amount must be greater than zero'
            USING ERRCODE = '22023';
    END IF;

    IF p_amount <> round(p_amount, 2) THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: payment amount must have at most two decimals'
            USING ERRCODE = '22023';
    END IF;

    v_amount := p_amount::numeric(14, 2);

    -- 4. Fiscal period
    SELECT status, starts_on, ends_on, extract(year FROM starts_on)::integer
    INTO v_period_status, v_period_start, v_period_end, v_fiscal_year
    FROM finance.fiscal_periods
    WHERE id = p_fiscal_period_id
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'fiscal period % not found', p_fiscal_period_id USING ERRCODE = '22023';
    END IF;
    IF v_period_status <> 'OPEN' THEN
        RAISE EXCEPTION 'fiscal period % is not open', p_fiscal_period_id USING ERRCODE = '55000';
    END IF;
    IF p_document_date < v_period_start OR p_document_date > v_period_end THEN
        RAISE EXCEPTION 'document date is outside fiscal period' USING ERRCODE = '22023';
    END IF;

    -- 5. Lock the receipt so two concurrent payments cannot both pass the
    --    outstanding-amount check.
    SELECT receipt.supplier_id, receipt.total_amount
    INTO v_supplier_id, v_receipt_total
    FROM procurement.purchase_receipts receipt
    JOIN core.business_documents document ON document.id = receipt.document_id
    WHERE receipt.document_id = p_receipt_document_id
      AND document.status = 'POSTED'
    FOR UPDATE OF receipt;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: posted purchase receipt % not found', p_receipt_document_id
            USING ERRCODE = '55000';
    END IF;

    -- 6. Outstanding amount
    SELECT coalesce(sum(amount), 0)::numeric(14, 2)
    INTO v_already_paid
    FROM procurement.purchase_receipt_payments
    WHERE receipt_document_id = p_receipt_document_id;

    v_outstanding := (v_receipt_total - v_already_paid)::numeric(14, 2);

    IF v_outstanding <= 0 THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: purchase % is already fully paid', p_receipt_document_id
            USING ERRCODE = '55000';
    END IF;

    IF v_amount > v_outstanding THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: payment exceeds the outstanding amount'
            USING ERRCODE = '22023';
    END IF;

    -- 7. Payment business document
    v_sequence := core.claim_next_document_number('SUPPLIER_PAYMENT', v_fiscal_year);
    v_document_number := 'SP-' || v_fiscal_year || '-' || lpad(v_sequence::text, 6, '0');

    INSERT INTO core.business_documents (
        document_type, status, document_date, fiscal_period_id, fiscal_year,
        sequence_number, document_number, posted_at
    ) VALUES (
        'SUPPLIER_PAYMENT', 'POSTED', p_document_date, p_fiscal_period_id, v_fiscal_year,
        v_sequence, v_document_number, now()
    ) RETURNING id INTO v_payment_document_id;

    -- 8. Balanced journal: Dr GRNI / Cr Cash or Bank
    v_journal_document_id := finance.create_posted_journal(
        p_document_date,
        p_fiscal_period_id,
        'Supplier payment ' || v_document_number,
        'SUPPLIER_PAYMENT',
        v_payment_document_id
    );

    PERFORM finance.add_journal_line(
        v_journal_document_id, 1, 'GRNI'::finance.account_role_code,
        v_amount, 0.00, 'Supplier payment settles goods received'
    );

    IF p_payment_method = 'CASH' THEN
        PERFORM finance.add_journal_line(
            v_journal_document_id, 2, 'CASH'::finance.account_role_code,
            0.00, v_amount, 'Supplier payment in cash'
        );
    ELSE
        PERFORM finance.add_journal_line(
            v_journal_document_id, 2, 'BANK'::finance.account_role_code,
            0.00, v_amount, 'Supplier payment by bank transfer'
        );
    END IF;

    -- 9. Payment record
    INSERT INTO procurement.purchase_receipt_payments (
        document_id, receipt_document_id, supplier_id, payment_method, amount,
        reference_number, journal_document_id, posted_by_user_id
    ) VALUES (
        v_payment_document_id, p_receipt_document_id, v_supplier_id, p_payment_method, v_amount,
        nullif(btrim(coalesce(p_reference_number, '')), ''), v_journal_document_id, v_user_id
    );

    -- 10. Idempotency result
    PERFORM core.record_idempotent_result(
        'procurement.post_purchase_payment', p_request_id, v_payment_document_id
    );

    RETURN procurement._purchase_payment_response(v_payment_document_id);
END;
$$;

-- =============================================================================
-- 5. Read model: payment status per purchase receipt
-- =============================================================================

CREATE OR REPLACE FUNCTION procurement.list_purchase_payment_status(
    p_session_token text,
    p_receipt_document_id bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_result jsonb;
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_PROCUREMENT');

    SELECT coalesce(jsonb_agg(
        jsonb_build_object(
            'receipt_document_id', data.document_id,
            'total_amount', data.total_amount::text,
            'paid_amount', data.paid_amount::text,
            'outstanding_amount', data.outstanding_amount::text,
            'payment_status', data.payment_status
        ) ORDER BY data.document_id DESC
    ), '[]'::jsonb)
    INTO v_result
    FROM (
        SELECT
            receipt.document_id,
            receipt.total_amount,
            coalesce(sum(payment.amount), 0)::numeric(14, 2) AS paid_amount,
            (receipt.total_amount - coalesce(sum(payment.amount), 0))::numeric(14, 2) AS outstanding_amount,
            CASE
                WHEN receipt.total_amount <= 0 THEN 'PAID'
                WHEN coalesce(sum(payment.amount), 0) <= 0 THEN 'UNPAID'
                WHEN coalesce(sum(payment.amount), 0) >= receipt.total_amount THEN 'PAID'
                ELSE 'PARTIALLY_PAID'
            END AS payment_status
        FROM procurement.purchase_receipts receipt
        JOIN core.business_documents document ON document.id = receipt.document_id
        LEFT JOIN procurement.purchase_receipt_payments payment
               ON payment.receipt_document_id = receipt.document_id
        WHERE document.status = 'POSTED'
          AND (p_receipt_document_id IS NULL OR receipt.document_id = p_receipt_document_id)
        GROUP BY receipt.document_id, receipt.total_amount
    ) data;

    RETURN v_result;
END;
$$;

-- =============================================================================
-- 6. Read model: the payments recorded against one purchase receipt
-- =============================================================================

CREATE OR REPLACE FUNCTION procurement.list_purchase_payments(
    p_session_token text,
    p_receipt_document_id bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_result jsonb;
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_PROCUREMENT');

    SELECT coalesce(jsonb_agg(
        jsonb_build_object(
            'document_id', payment.document_id,
            'document_number', payment_document.document_number,
            'receipt_document_id', payment.receipt_document_id,
            'supplier_id', payment.supplier_id,
            'supplier_name', supplier.name,
            'payment_method', payment.payment_method,
            'amount', payment.amount::text,
            'reference_number', payment.reference_number,
            'journal_document_id', payment.journal_document_id,
            'journal_document_number', journal_document.document_number,
            'posted_at', payment_document.posted_at
        ) ORDER BY payment_document.posted_at DESC, payment.document_id DESC
    ), '[]'::jsonb)
    INTO v_result
    FROM procurement.purchase_receipt_payments payment
    JOIN core.business_documents payment_document ON payment_document.id = payment.document_id
    JOIN core.business_documents journal_document ON journal_document.id = payment.journal_document_id
    JOIN procurement.suppliers supplier ON supplier.id = payment.supplier_id
    WHERE (p_receipt_document_id IS NULL OR payment.receipt_document_id = p_receipt_document_id);

    RETURN v_result;
END;
$$;

-- =============================================================================
-- 7. Read model: what is owed to each supplier
-- =============================================================================

CREATE OR REPLACE FUNCTION procurement.list_supplier_balances(p_session_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_result jsonb;
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_PROCUREMENT');

    SELECT coalesce(jsonb_agg(
        jsonb_build_object(
            'supplier_id', data.id,
            'supplier_name', data.name,
            'total_purchased', data.total_purchased::text,
            'total_paid', data.total_paid::text,
            'balance_due', data.balance_due::text
        ) ORDER BY data.name
    ), '[]'::jsonb)
    INTO v_result
    FROM (
        SELECT
            supplier.id,
            supplier.name,
            coalesce(purchased.total, 0)::numeric(14, 2) AS total_purchased,
            coalesce(paid.total, 0)::numeric(14, 2) AS total_paid,
            (coalesce(purchased.total, 0) - coalesce(paid.total, 0))::numeric(14, 2) AS balance_due
        FROM procurement.suppliers supplier
        LEFT JOIN (
            SELECT receipt.supplier_id, sum(receipt.total_amount) AS total
            FROM procurement.purchase_receipts receipt
            JOIN core.business_documents document ON document.id = receipt.document_id
            WHERE document.status = 'POSTED'
            GROUP BY receipt.supplier_id
        ) purchased ON purchased.supplier_id = supplier.id
        LEFT JOIN (
            SELECT payment.supplier_id, sum(payment.amount) AS total
            FROM procurement.purchase_receipt_payments payment
            GROUP BY payment.supplier_id
        ) paid ON paid.supplier_id = supplier.id
    ) data;

    RETURN v_result;
END;
$$;

-- =============================================================================
-- 8. Privileges
-- =============================================================================

REVOKE ALL ON procurement.purchase_receipt_payments FROM PUBLIC;
GRANT SELECT ON procurement.purchase_receipt_payments TO stockiha_runtime;

REVOKE ALL ON FUNCTION procurement.forbid_purchase_payment_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION procurement._purchase_payment_response(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION procurement.post_purchase_payment(text, uuid, bytea, bigint, bigint, date, text, numeric, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION procurement.list_purchase_payment_status(text, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION procurement.list_purchase_payments(text, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION procurement.list_supplier_balances(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION procurement.post_purchase_payment(text, uuid, bytea, bigint, bigint, date, text, numeric, text) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION procurement.list_purchase_payment_status(text, bigint) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION procurement.list_purchase_payments(text, bigint) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION procurement.list_supplier_balances(text) TO stockiha_runtime;

RESET ROLE;
