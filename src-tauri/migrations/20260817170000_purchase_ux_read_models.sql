-- Purchase UX read models. These are read-only, permission-gated aggregates
-- for the Purchases dashboard and history; posted operational records remain
-- immutable and no accounting data is changed.
SET ROLE stockiha_owner;

CREATE OR REPLACE FUNCTION procurement.get_purchase_dashboard(
    p_session_token text,
    p_from_date date,
    p_to_date date
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
    PERFORM iam.resolve_session_with_permission(p_session_token, 'MANAGE_PROCUREMENT');
    IF p_from_date IS NULL OR p_to_date IS NULL OR p_from_date > p_to_date THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: invalid purchase dashboard date range' USING ERRCODE = '22023';
    END IF;

    WITH receipts AS (
        SELECT receipt.document_id, document.document_date, receipt.subtotal,
               coalesce(landed.total_amount, 0)::numeric(14, 2) AS additional_cost_amount
        FROM procurement.purchase_receipts receipt
        JOIN core.business_documents document ON document.id = receipt.document_id
        LEFT JOIN LATERAL (
            SELECT sum(posting.amount)::numeric(14, 2) AS total_amount
            FROM procurement.landed_cost_postings posting
            WHERE posting.receipt_document_id = receipt.document_id
        ) landed ON true
        WHERE document.status = 'POSTED'
          AND document.document_date BETWEEN p_from_date AND p_to_date
    ), lines AS (
        SELECT line.document_id, line.variant_id, line.quantity_received
        FROM procurement.purchase_receipt_lines line
        JOIN receipts ON receipts.document_id = line.document_id
    ), totals AS (
        SELECT count(*)::bigint AS receipt_count,
               coalesce(sum(subtotal), 0)::numeric(14, 2) AS purchase_subtotal,
               coalesce(sum(additional_cost_amount), 0)::numeric(14, 2) AS additional_costs,
               coalesce(sum(subtotal + additional_cost_amount), 0)::numeric(14, 2) AS total_purchase_value
        FROM receipts
    ), trend AS (
        SELECT document_date,
               count(*)::bigint AS receipt_count,
               sum(subtotal)::numeric(14, 2) AS purchase_subtotal,
               sum(additional_cost_amount)::numeric(14, 2) AS additional_costs,
               sum(subtotal + additional_cost_amount)::numeric(14, 2) AS total_purchase_value
        FROM receipts
        GROUP BY document_date
    )
    SELECT jsonb_build_object(
        'receipt_count', totals.receipt_count,
        'purchase_subtotal', totals.purchase_subtotal::text,
        'additional_costs', totals.additional_costs::text,
        'total_purchase_value', totals.total_purchase_value::text,
        'distinct_variants', (SELECT count(DISTINCT variant_id) FROM lines),
        'units_purchased', coalesce((SELECT sum(quantity_received)::text FROM lines), '0'),
        'average_receipt_value', CASE WHEN totals.receipt_count = 0 THEN '0.00'
            ELSE round(totals.total_purchase_value / totals.receipt_count, 2)::text END,
        'trend', coalesce((SELECT jsonb_agg(jsonb_build_object(
            'date', document_date,
            'receipt_count', receipt_count,
            'purchase_subtotal', purchase_subtotal::text,
            'additional_costs', additional_costs::text,
            'total_purchase_value', total_purchase_value::text
        ) ORDER BY document_date) FROM trend), '[]'::jsonb)
    ) INTO v_result
    FROM totals;

    RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION procurement.list_purchase_receipts_ux(
    p_session_token text,
    p_supplier_id bigint DEFAULT NULL,
    p_from_date date DEFAULT NULL,
    p_to_date date DEFAULT NULL,
    p_query text DEFAULT NULL,
    p_limit integer DEFAULT 50,
    p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_query text := upper(regexp_replace(btrim(coalesce(p_query, '')), '\\s+', ' ', 'g'));
BEGIN
    PERFORM iam.resolve_session_with_permission(p_session_token, 'MANAGE_PROCUREMENT');
    IF p_limit < 1 OR p_limit > 100 OR p_offset < 0 THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: invalid receipt history page' USING ERRCODE = '22023';
    END IF;

    RETURN (
        SELECT coalesce(jsonb_agg(jsonb_build_object(
            'document_id', receipt.document_id,
            'document_number', document.document_number,
            'supplier_id', receipt.supplier_id,
            'supplier_name', supplier.name,
            'warehouse_id', receipt.warehouse_id,
            'warehouse_name', warehouse.name,
            'document_date', document.document_date,
            'total_amount', receipt.total_amount::text,
            'journal_document_id', receipt.journal_document_id,
            'journal_document_number', journal.document_number,
            'item_count', line_counts.item_count,
            'total_quantity', line_counts.total_quantity::text
        ) ORDER BY document.document_date DESC, receipt.document_id DESC), '[]'::jsonb)
        FROM (
            SELECT receipt.*, document.document_date, document.document_number, supplier.name AS supplier_name,
                   warehouse.name AS warehouse_name, journal.document_number AS journal_document_number,
                   counts.item_count, counts.total_quantity
            FROM procurement.purchase_receipts receipt
            JOIN core.business_documents document ON document.id = receipt.document_id AND document.status = 'POSTED'
            JOIN procurement.suppliers supplier ON supplier.id = receipt.supplier_id
            JOIN inventory.warehouses warehouse ON warehouse.id = receipt.warehouse_id
            LEFT JOIN core.business_documents journal ON journal.id = receipt.journal_document_id
            JOIN LATERAL (
                SELECT count(DISTINCT line.variant_id)::bigint AS item_count,
                       coalesce(sum(line.quantity_received), 0)::numeric(18, 3) AS total_quantity
                FROM procurement.purchase_receipt_lines line
                WHERE line.document_id = receipt.document_id
            ) counts ON true
            WHERE (p_supplier_id IS NULL OR receipt.supplier_id = p_supplier_id)
              AND (p_from_date IS NULL OR document.document_date >= p_from_date)
              AND (p_to_date IS NULL OR document.document_date <= p_to_date)
              AND (v_query = '' OR upper(document.document_number) LIKE '%' || v_query || '%'
                   OR upper(supplier.name) LIKE '%' || v_query || '%'
                   OR upper(coalesce(journal.document_number, '')) LIKE '%' || v_query || '%'
                   OR EXISTS (
                       SELECT 1 FROM procurement.purchase_receipt_lines line
                       JOIN catalog.product_variants variant ON variant.id = line.variant_id
                       JOIN catalog.products product ON product.id = variant.product_id
                       WHERE line.document_id = receipt.document_id
                         AND (upper(variant.sku) LIKE '%' || v_query || '%'
                           OR upper(catalog._effective_variant_name(variant.id)) LIKE '%' || v_query || '%'
                           OR upper(product.name) LIKE '%' || v_query || '%'
                           OR EXISTS (SELECT 1 FROM catalog.variant_barcodes barcode
                                      WHERE barcode.variant_id = variant.id
                                        AND upper(barcode.barcode) LIKE '%' || v_query || '%'))
                   ))
            ORDER BY document.document_date DESC, receipt.document_id DESC
            LIMIT p_limit OFFSET p_offset
        ) receipt
        JOIN core.business_documents document ON document.id = receipt.document_id
        JOIN procurement.suppliers supplier ON supplier.id = receipt.supplier_id
        JOIN inventory.warehouses warehouse ON warehouse.id = receipt.warehouse_id
        LEFT JOIN core.business_documents journal ON journal.id = receipt.journal_document_id
        JOIN LATERAL (SELECT receipt.item_count, receipt.total_quantity) line_counts ON true
    );
END;
$$;

REVOKE ALL ON FUNCTION procurement.get_purchase_dashboard(text, date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION procurement.list_purchase_receipts_ux(text, bigint, date, date, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION procurement.get_purchase_dashboard(text, date, date) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION procurement.list_purchase_receipts_ux(text, bigint, date, date, text, integer, integer) TO stockiha_runtime;

RESET ROLE;
