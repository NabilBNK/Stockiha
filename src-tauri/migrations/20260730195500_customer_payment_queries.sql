-- S4-001: Read model for allocating customer payments to open credit invoices.
SET ROLE stockiha_owner;

CREATE FUNCTION receivables.list_open_customer_invoices(
    p_session_token text,
    p_customer_id bigint
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
    FROM iam.resolve_session_with_permission(p_session_token, 'VIEW_CUSTOMERS');

    PERFORM 1 FROM receivables.customers WHERE id = p_customer_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'customer not found' USING ERRCODE = '22023';
    END IF;

    SELECT coalesce(jsonb_agg(
        jsonb_build_object(
            'invoice_ledger_entry_id', rows.invoice_ledger_entry_id,
            'document_id', rows.document_id,
            'document_number', rows.document_number,
            'document_date', rows.document_date,
            'due_date', rows.due_date,
            'original_amount', rows.original_amount::text,
            'allocated_amount', rows.allocated_amount::text,
            'remaining_amount', rows.remaining_amount::text
        ) ORDER BY rows.due_date NULLS LAST, rows.document_date, rows.invoice_ledger_entry_id
    ), '[]'::jsonb)
    INTO v_result
    FROM (
        SELECT
            l.id AS invoice_ledger_entry_id,
            l.document_id,
            d.document_number,
            d.document_date,
            l.due_date,
            l.amount_delta AS original_amount,
            coalesce(sum(pa.amount), 0)::numeric(14,2) AS allocated_amount,
            (l.amount_delta - coalesce(sum(pa.amount), 0))::numeric(14,2) AS remaining_amount
        FROM receivables.customer_ledger_entries l
        LEFT JOIN receivables.payment_allocations pa ON pa.invoice_ledger_entry_id = l.id
        LEFT JOIN core.business_documents d ON d.id = l.document_id
        WHERE l.customer_id = p_customer_id
          AND l.entry_type = 'CREDIT_INVOICE'
        GROUP BY l.id, l.document_id, d.document_number, d.document_date, l.due_date, l.amount_delta
        HAVING l.amount_delta - coalesce(sum(pa.amount), 0) > 0
    ) rows;

    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION receivables.list_open_customer_invoices(text, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION receivables.list_open_customer_invoices(text, bigint) TO stockiha_runtime;

RESET ROLE;
