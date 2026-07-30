-- S4-001: Immutable rendering payloads for customer credit invoices and payment receipts.
-- These payloads use posted header/line snapshots, never current customer master data.
SET ROLE stockiha_owner;

CREATE FUNCTION receivables.get_customer_document_payload(
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
    v_document_type text;
    v_result jsonb;
BEGIN
    SELECT user_id INTO v_user_id
    FROM iam.resolve_session_with_permission(p_session_token, 'VIEW_CUSTOMERS');

    SELECT document_type
    INTO v_document_type
    FROM core.business_documents
    WHERE id = p_document_id
      AND status IN ('POSTED', 'REVERSED');

    IF NOT FOUND THEN
        RAISE EXCEPTION 'posted customer document not found' USING ERRCODE = '22023';
    END IF;

    IF v_document_type = 'CREDIT_SALE' THEN
        SELECT jsonb_build_object(
            'document_kind', 'CREDIT_SALE',
            'document_id', d.id,
            'document_number', d.document_number,
            'status', d.status,
            'document_date', d.document_date,
            'posted_at', d.posted_at,
            'customer', jsonb_build_object(
                'id', cs.customer_id,
                'code', cs.customer_code_snapshot,
                'name', cs.customer_name_snapshot,
                'tax_id', cs.customer_tax_id_snapshot,
                'address', cs.customer_address_snapshot
            ),
            'warehouse_id', cs.warehouse_id,
            'subtotal', cs.subtotal::text,
            'total_amount', cs.total_amount::text,
            'due_date', cs.due_date,
            'journal_document_id', cs.journal_document_id,
            'lines', coalesce((
                SELECT jsonb_agg(
                    jsonb_build_object(
                        'line_number', l.line_number,
                        'variant_id', l.variant_id,
                        'sku', l.variant_sku_snapshot,
                        'name', l.variant_name_snapshot,
                        'quantity', l.quantity::text,
                        'unit_price', l.unit_price::text,
                        'line_total', l.line_total::text
                    ) ORDER BY l.line_number
                )
                FROM sales.credit_sale_lines l
                WHERE l.document_id = cs.document_id
            ), '[]'::jsonb)
        )
        INTO v_result
        FROM core.business_documents d
        JOIN sales.credit_sales cs ON cs.document_id = d.id
        WHERE d.id = p_document_id;

    ELSIF v_document_type = 'CUSTOMER_PAYMENT' THEN
        SELECT jsonb_build_object(
            'document_kind', 'CUSTOMER_PAYMENT',
            'document_id', d.id,
            'document_number', d.document_number,
            'status', d.status,
            'document_date', d.document_date,
            'posted_at', d.posted_at,
            'customer', jsonb_build_object(
                'id', cp.customer_id,
                'code', cp.customer_code_snapshot,
                'name', cp.customer_name_snapshot,
                'tax_id', cp.customer_tax_id_snapshot,
                'address', cp.customer_address_snapshot
            ),
            'payment_method', cp.payment_method,
            'amount', cp.amount::text,
            'cash_session_id', cp.cash_session_id,
            'journal_document_id', cp.journal_document_id,
            'note', cp.note,
            'allocations', coalesce((
                SELECT jsonb_agg(
                    jsonb_build_object(
                        'invoice_ledger_entry_id', pa.invoice_ledger_entry_id,
                        'invoice_document_id', invoice_entry.document_id,
                        'invoice_document_number', invoice_doc.document_number,
                        'invoice_document_date', invoice_doc.document_date,
                        'allocated_amount', pa.amount::text
                    ) ORDER BY invoice_doc.document_date, pa.invoice_ledger_entry_id
                )
                FROM receivables.payment_allocations pa
                JOIN receivables.customer_ledger_entries invoice_entry
                  ON invoice_entry.id = pa.invoice_ledger_entry_id
                LEFT JOIN core.business_documents invoice_doc
                  ON invoice_doc.id = invoice_entry.document_id
                WHERE pa.payment_document_id = cp.document_id
            ), '[]'::jsonb)
        )
        INTO v_result
        FROM core.business_documents d
        JOIN receivables.customer_payments cp ON cp.document_id = d.id
        WHERE d.id = p_document_id;
    ELSE
        RAISE EXCEPTION 'document is not a supported customer document'
            USING ERRCODE = '22023';
    END IF;

    IF v_result IS NULL THEN
        RAISE EXCEPTION 'customer document payload not found' USING ERRCODE = '22023';
    END IF;

    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION receivables.get_customer_document_payload(text, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION receivables.get_customer_document_payload(text, bigint) TO stockiha_runtime;

RESET ROLE;
