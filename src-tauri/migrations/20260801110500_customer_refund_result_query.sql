-- S4-003: canonical customer-refund result reader.
--
-- The posting function is request-idempotent and may return either its fresh
-- posting payload or its cached payload. Keep the Rust/Tauri DTO stable by
-- reading the complete authoritative result through one protected query after
-- either path returns the document id.
SET ROLE stockiha_owner;

CREATE FUNCTION receivables.get_customer_refund_result(
    p_session_token text,
    p_document_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_user_id bigint;
    v_result jsonb;
BEGIN
    SELECT user_id INTO v_user_id
    FROM iam.resolve_session_with_permission(
        p_session_token,
        'POST_CUSTOMER_REFUND'
    );

    SELECT jsonb_build_object(
        'document_id', d.id,
        'document_number', d.document_number,
        'source_payment_document_id', r.source_payment_document_id,
        'customer_id', r.customer_id,
        'refund_method', r.refund_method,
        'amount', r.amount::text,
        'exposure_amount', cs.exposure_amount::text,
        'available_credit', (c.credit_limit - cs.exposure_amount)::text,
        'journal_document_id', r.journal_document_id,
        'refund_ledger_entry_id', l.id
    )
    INTO v_result
    FROM core.business_documents d
    JOIN receivables.customer_payment_refunds r
      ON r.document_id = d.id
    JOIN receivables.customers c
      ON c.id = r.customer_id
    JOIN receivables.customer_credit_state cs
      ON cs.customer_id = r.customer_id
    JOIN receivables.customer_ledger_entries l
      ON l.document_id = r.document_id
     AND l.customer_id = r.customer_id
     AND l.entry_type = 'PAYMENT_REFUND'
    WHERE d.id = p_document_id
      AND d.status = 'POSTED';

    IF v_result IS NULL THEN
        RAISE EXCEPTION 'posted customer refund result not found'
            USING ERRCODE = '22023';
    END IF;

    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION receivables.get_customer_refund_result(text,bigint)
    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION receivables.get_customer_refund_result(text,bigint)
    TO stockiha_runtime;

RESET ROLE;
