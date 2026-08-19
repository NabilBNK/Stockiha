-- Supplier-return recovery for direct purchases.
--
-- A return is anchored to exactly one purchase source:
--   * purchase_order_id for the advanced PO workflow, or
--   * receipt_document_id for a direct purchase whose goods already arrived.
-- Existing PO semantics remain unchanged. Direct returns use the exact direct
-- receipt and its matched supplier invoice, so no synthetic PO is introduced.

SET ROLE stockiha_owner;

ALTER TABLE procurement.supplier_returns
    ADD COLUMN IF NOT EXISTS receipt_document_id bigint
        REFERENCES procurement.purchase_receipts(document_id) ON DELETE RESTRICT;

ALTER TABLE procurement.supplier_returns
    DROP CONSTRAINT IF EXISTS supplier_returns_purchase_source_exactly_one;
ALTER TABLE procurement.supplier_returns
    ADD CONSTRAINT supplier_returns_purchase_source_exactly_one CHECK (
        (purchase_order_id IS NOT NULL AND receipt_document_id IS NULL)
        OR
        (purchase_order_id IS NULL AND receipt_document_id IS NOT NULL)
    );

-- ---------------------------------------------------------------------------
-- Read model: expose PO and direct receipt lines through one safe projection.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION procurement.list_purchase_receipt_lines(
    p_session_token text,
    p_purchase_order_id bigint DEFAULT NULL
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
    PERFORM 1
    FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_PROCUREMENT');

    SELECT coalesce(jsonb_agg(
        jsonb_build_object(
            'receipt_line_id', receipt_line.id,
            'receipt_document_id', receipt.document_id,
            'receipt_document_number', receipt_document.document_number,
            'receipt_origin', receipt.receipt_origin,
            'purchase_order_id', receipt.purchase_order_id,
            'purchase_order_number', po_document.document_number,
            'po_line_id', receipt_line.po_line_id,
            'supplier_id', receipt.supplier_id,
            'supplier_name', supplier.name,
            'warehouse_id', receipt.warehouse_id,
            'warehouse_name', warehouse.name,
            'variant_id', receipt_line.variant_id,
            'variant_sku', variant.sku,
            'variant_name', product.name,
            'unit_id', receipt_line.unit_id,
            'unit_code', unit.code,
            'quantity_received', receipt_line.quantity_received::text,
            'quantity_invoiced', coalesce(invoice_totals.quantity_invoiced, 0)::text,
            'quantity_available_to_invoice', greatest(
                receipt_line.quantity_received - coalesce(invoice_totals.quantity_invoiced, 0),
                0
            )::text,
            'quantity_returned_for_variant', coalesce(return_totals.quantity_returned, 0)::text,
            'stock_on_hand', coalesce(position.quantity_on_hand, 0)::text,
            'outstanding_liability', coalesce(liability_info.outstanding_amount, 0)::text,
            'invoice_count', coalesce(invoice_info.invoice_count, 0),
            'eligibility_code', CASE
                WHEN coalesce(invoice_info.invoice_count, 0) > 1 THEN 'AMBIGUOUS_INVOICES'
                WHEN coalesce(position.quantity_on_hand, 0) <= 0 THEN 'INSUFFICIENT_STOCK'
                WHEN coalesce(received_totals.quantity_received, 0)
                     - coalesce(return_totals.quantity_returned, 0) <= 0
                    THEN 'NO_RETURNABLE_QUANTITY'
                WHEN coalesce(invoice_info.invoice_count, 0) = 1
                     AND coalesce(liability_info.outstanding_amount, 0) <= 0
                    THEN 'INSUFFICIENT_LIABILITY'
                ELSE 'ELIGIBLE'
            END,
            'quantity_returnable_for_variant', greatest(
                CASE
                    WHEN coalesce(invoice_info.invoice_count, 0) > 1 THEN 0
                    WHEN coalesce(invoice_info.invoice_count, 0) = 1
                         AND coalesce(liability_info.outstanding_amount, 0) <= 0 THEN 0
                    ELSE least(
                        greatest(
                            coalesce(received_totals.quantity_received, 0)
                            - coalesce(return_totals.quantity_returned, 0),
                            0
                        ),
                        greatest(coalesce(position.quantity_on_hand, 0), 0)
                    )
                END,
                0
            )::text,
            'unit_cost', receipt_line.unit_cost::text,
            'line_total', receipt_line.line_total::text
        ) ORDER BY receipt_document.posted_at DESC, receipt_line.id
    ), '[]'::jsonb)
    INTO v_result
    FROM procurement.purchase_receipt_lines receipt_line
    JOIN procurement.purchase_receipts receipt
      ON receipt.document_id = receipt_line.document_id
    JOIN core.business_documents receipt_document
      ON receipt_document.id = receipt.document_id
     AND receipt_document.status = 'POSTED'
    LEFT JOIN core.business_documents po_document
      ON po_document.id = receipt.purchase_order_id
    JOIN procurement.suppliers supplier ON supplier.id = receipt.supplier_id
    JOIN inventory.warehouses warehouse ON warehouse.id = receipt.warehouse_id
    JOIN catalog.product_variants variant ON variant.id = receipt_line.variant_id
    JOIN catalog.products product ON product.id = variant.product_id
    JOIN catalog.units unit ON unit.id = receipt_line.unit_id
    LEFT JOIN inventory.positions position
      ON position.warehouse_id = receipt.warehouse_id
     AND position.variant_id = receipt_line.variant_id
    LEFT JOIN LATERAL (
        SELECT count(DISTINCT invoice.document_id) AS invoice_count,
               min(invoice.document_id) AS invoice_doc_id
        FROM procurement.supplier_invoices invoice
        JOIN core.business_documents invoice_document
          ON invoice_document.id = invoice.document_id
         AND invoice_document.status = 'POSTED'
        WHERE invoice.supplier_id = receipt.supplier_id
          AND (
              (receipt.purchase_order_id IS NOT NULL
               AND invoice.purchase_order_id = receipt.purchase_order_id)
              OR
              (receipt.purchase_order_id IS NULL
               AND invoice.purchase_order_id IS NULL
               AND EXISTS (
                   SELECT 1
                   FROM procurement.supplier_invoice_lines invoice_line
                   JOIN procurement.purchase_receipt_lines matched_receipt_line
                     ON matched_receipt_line.id = invoice_line.receipt_line_id
                   WHERE invoice_line.document_id = invoice.document_id
                     AND matched_receipt_line.document_id = receipt.document_id
               ))
          )
    ) invoice_info ON true
    LEFT JOIN LATERAL (
        SELECT liability.id, liability.outstanding_amount
        FROM procurement.supplier_liabilities liability
        WHERE liability.invoice_document_id = invoice_info.invoice_doc_id
          AND liability.supplier_id = receipt.supplier_id
        ORDER BY liability.id
        LIMIT 1
    ) liability_info ON true
    LEFT JOIN LATERAL (
        SELECT sum(invoice_line.quantity) AS quantity_invoiced
        FROM procurement.supplier_invoice_lines invoice_line
        JOIN core.business_documents invoice_document
          ON invoice_document.id = invoice_line.document_id
         AND invoice_document.status = 'POSTED'
        WHERE invoice_line.receipt_line_id = receipt_line.id
    ) invoice_totals ON true
    LEFT JOIN LATERAL (
        SELECT sum(other_receipt_line.quantity_received) AS quantity_received
        FROM procurement.purchase_receipt_lines other_receipt_line
        JOIN procurement.purchase_receipts other_receipt
          ON other_receipt.document_id = other_receipt_line.document_id
        JOIN core.business_documents other_receipt_document
          ON other_receipt_document.id = other_receipt.document_id
         AND other_receipt_document.status = 'POSTED'
        WHERE other_receipt_line.variant_id = receipt_line.variant_id
          AND (
              (receipt.purchase_order_id IS NOT NULL
               AND other_receipt.purchase_order_id = receipt.purchase_order_id)
              OR
              (receipt.purchase_order_id IS NULL
               AND other_receipt.document_id = receipt.document_id)
          )
    ) received_totals ON true
    LEFT JOIN LATERAL (
        SELECT sum(return_line.quantity) AS quantity_returned
        FROM procurement.supplier_return_lines return_line
        JOIN procurement.supplier_returns supplier_return
          ON supplier_return.id = return_line.return_id
        JOIN core.business_documents return_document
          ON return_document.id = supplier_return.document_id
         AND return_document.status = 'POSTED'
        WHERE return_line.variant_id = receipt_line.variant_id
          AND (
              (receipt.purchase_order_id IS NOT NULL
               AND supplier_return.purchase_order_id = receipt.purchase_order_id)
              OR
              (receipt.purchase_order_id IS NULL
               AND supplier_return.receipt_document_id = receipt.document_id)
          )
    ) return_totals ON true
    WHERE p_purchase_order_id IS NULL
       OR receipt.purchase_order_id = p_purchase_order_id;

    RETURN v_result;
END;
$$;

-- ---------------------------------------------------------------------------
-- Draft creation with an explicit direct-receipt source.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION procurement.create_supplier_return_draft(
    p_session_token text,
    p_supplier_id bigint,
    p_warehouse_id bigint,
    p_purchase_order_id bigint,
    p_receipt_document_id bigint,
    p_reason_code text,
    p_note text,
    p_lines jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_user_id bigint;
    v_fiscal_period_id bigint;
    v_document_id bigint;
    v_return_id bigint;
    v_line record;
    v_line_number integer := 1;
    v_received_quantity numeric;
    v_returned_quantity numeric;
    v_stock_on_hand numeric;
    v_invoice_count integer;
    v_invoice_doc_id bigint;
    v_liability_outstanding numeric;
    v_authoritative_cost numeric;
    v_return_clearing_amount numeric := 0;
BEGIN
    SELECT user_id
    INTO v_user_id
    FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_PROCUREMENT');

    IF (p_purchase_order_id IS NULL) = (p_receipt_document_id IS NULL) THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Supplier return requires exactly one purchase source'
            USING ERRCODE = '22023';
    END IF;
    IF coalesce(p_reason_code, 'DEFECTIVE_GOODS') NOT IN (
        'DEFECTIVE_GOODS', 'EXCESS_DELIVERY', 'WRONG_ITEM'
    ) THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Unsupported supplier return reason'
            USING ERRCODE = '22023';
    END IF;
    IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Supplier return must contain at least one line'
            USING ERRCODE = '22023';
    END IF;

    IF p_purchase_order_id IS NOT NULL THEN
        PERFORM 1
        FROM procurement.purchase_orders purchase_order
        JOIN procurement.suppliers supplier ON supplier.id = purchase_order.supplier_id
        JOIN inventory.warehouses warehouse ON warehouse.id = purchase_order.warehouse_id
        WHERE purchase_order.document_id = p_purchase_order_id
          AND purchase_order.supplier_id = p_supplier_id
          AND purchase_order.warehouse_id = p_warehouse_id
          AND purchase_order.status IN ('PARTIALLY_RECEIVED', 'RECEIVED')
          AND supplier.is_active
          AND warehouse.is_active;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'PRECONDITION_FAILED: Purchase order is not eligible for supplier return'
                USING ERRCODE = '55000';
        END IF;
    ELSE
        PERFORM 1
        FROM procurement.purchase_receipts receipt
        JOIN core.business_documents document ON document.id = receipt.document_id
        JOIN procurement.suppliers supplier ON supplier.id = receipt.supplier_id
        JOIN inventory.warehouses warehouse ON warehouse.id = receipt.warehouse_id
        WHERE receipt.document_id = p_receipt_document_id
          AND receipt.receipt_origin = 'DIRECT_PURCHASE'
          AND receipt.purchase_order_id IS NULL
          AND receipt.supplier_id = p_supplier_id
          AND receipt.warehouse_id = p_warehouse_id
          AND document.status = 'POSTED'
          AND supplier.is_active
          AND warehouse.is_active;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'PRECONDITION_FAILED: Direct purchase receipt is not eligible for supplier return'
                USING ERRCODE = '55000';
        END IF;
    END IF;

    SELECT count(DISTINCT invoice.document_id), min(invoice.document_id)
    INTO v_invoice_count, v_invoice_doc_id
    FROM procurement.supplier_invoices invoice
    JOIN core.business_documents invoice_document
      ON invoice_document.id = invoice.document_id
     AND invoice_document.status = 'POSTED'
    WHERE invoice.supplier_id = p_supplier_id
      AND (
          (p_purchase_order_id IS NOT NULL
           AND invoice.purchase_order_id = p_purchase_order_id)
          OR
          (p_receipt_document_id IS NOT NULL
           AND invoice.purchase_order_id IS NULL
           AND EXISTS (
               SELECT 1
               FROM procurement.supplier_invoice_lines invoice_line
               JOIN procurement.purchase_receipt_lines receipt_line
                 ON receipt_line.id = invoice_line.receipt_line_id
               WHERE invoice_line.document_id = invoice.document_id
                 AND receipt_line.document_id = p_receipt_document_id
           ))
      );

    IF v_invoice_count > 1 THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: Return allocation is ambiguous across multiple supplier invoices'
            USING ERRCODE = '55000';
    END IF;

    IF v_invoice_count = 1 THEN
        SELECT outstanding_amount
        INTO v_liability_outstanding
        FROM procurement.supplier_liabilities
        WHERE invoice_document_id = v_invoice_doc_id
          AND supplier_id = p_supplier_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'PRECONDITION_FAILED: Posted supplier invoice has no payable liability'
                USING ERRCODE = '55000';
        END IF;
    END IF;

    FOR v_line IN
        SELECT
            (line ->> 'variant_id')::bigint AS variant_id,
            sum((line ->> 'quantity')::numeric) AS quantity,
            max((line ->> 'unit_cost')::numeric) AS unit_cost
        FROM jsonb_array_elements(p_lines) line
        GROUP BY (line ->> 'variant_id')::bigint
    LOOP
        IF v_line.variant_id IS NULL OR v_line.quantity IS NULL OR v_line.quantity <= 0
           OR v_line.unit_cost IS NULL OR v_line.unit_cost < 0 THEN
            RAISE EXCEPTION 'VALIDATION_ERROR: Invalid supplier return line'
                USING ERRCODE = '22023';
        END IF;

        SELECT coalesce(quantity_on_hand, 0)
        INTO v_stock_on_hand
        FROM inventory.positions
        WHERE warehouse_id = p_warehouse_id
          AND variant_id = v_line.variant_id;
        IF coalesce(v_stock_on_hand, 0) < v_line.quantity THEN
            RAISE EXCEPTION 'INSUFFICIENT_STOCK: Insufficient stock for returned variant %',
                v_line.variant_id USING ERRCODE = '55000';
        END IF;

        SELECT coalesce(sum(receipt_line.quantity_received), 0)
        INTO v_received_quantity
        FROM procurement.purchase_receipt_lines receipt_line
        JOIN procurement.purchase_receipts receipt
          ON receipt.document_id = receipt_line.document_id
        JOIN core.business_documents receipt_document
          ON receipt_document.id = receipt.document_id
         AND receipt_document.status = 'POSTED'
        WHERE receipt_line.variant_id = v_line.variant_id
          AND (
              (p_purchase_order_id IS NOT NULL
               AND receipt.purchase_order_id = p_purchase_order_id)
              OR
              (p_receipt_document_id IS NOT NULL
               AND receipt.document_id = p_receipt_document_id)
          );

        SELECT coalesce(sum(return_line.quantity), 0)
        INTO v_returned_quantity
        FROM procurement.supplier_return_lines return_line
        JOIN procurement.supplier_returns supplier_return
          ON supplier_return.id = return_line.return_id
        JOIN core.business_documents return_document
          ON return_document.id = supplier_return.document_id
         AND return_document.status = 'POSTED'
        WHERE return_line.variant_id = v_line.variant_id
          AND (
              (p_purchase_order_id IS NOT NULL
               AND supplier_return.purchase_order_id = p_purchase_order_id)
              OR
              (p_receipt_document_id IS NOT NULL
               AND supplier_return.receipt_document_id = p_receipt_document_id)
          );

        IF v_line.quantity > v_received_quantity - v_returned_quantity THEN
            RAISE EXCEPTION 'PRECONDITION_FAILED: Return quantity exceeds net received quantity for variant %',
                v_line.variant_id USING ERRCODE = '55000';
        END IF;

        IF v_invoice_count = 1 THEN
            SELECT round(
                sum(invoice_line.quantity * invoice_line.unit_cost * invoice.exchange_rate_to_dzd)
                / sum(invoice_line.quantity),
                6
            )
            INTO v_authoritative_cost
            FROM procurement.supplier_invoice_lines invoice_line
            JOIN procurement.supplier_invoices invoice
              ON invoice.document_id = invoice_line.document_id
            WHERE invoice_line.document_id = v_invoice_doc_id
              AND invoice_line.variant_id = v_line.variant_id;
        ELSE
            SELECT round(
                sum(receipt_line.quantity_received * receipt_line.unit_cost)
                / sum(receipt_line.quantity_received),
                6
            )
            INTO v_authoritative_cost
            FROM procurement.purchase_receipt_lines receipt_line
            JOIN procurement.purchase_receipts receipt
              ON receipt.document_id = receipt_line.document_id
            WHERE receipt.supplier_id = p_supplier_id
              AND receipt.warehouse_id = p_warehouse_id
              AND receipt_line.variant_id = v_line.variant_id
              AND (
                  (p_purchase_order_id IS NOT NULL
                   AND receipt.purchase_order_id = p_purchase_order_id)
                  OR
                  (p_receipt_document_id IS NOT NULL
                   AND receipt.document_id = p_receipt_document_id)
              );
        END IF;

        IF v_authoritative_cost IS NULL THEN
            RAISE EXCEPTION 'PRECONDITION_FAILED: No authoritative purchase cost exists for variant %',
                v_line.variant_id USING ERRCODE = '55000';
        END IF;

        v_return_clearing_amount := v_return_clearing_amount
            + round(v_line.quantity * v_authoritative_cost, 2);
    END LOOP;

    IF v_invoice_count = 1
       AND v_liability_outstanding IS NOT NULL
       AND v_return_clearing_amount > v_liability_outstanding THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: Return amount exceeds the outstanding supplier liability'
            USING ERRCODE = '55000';
    END IF;

    SELECT id
    INTO v_fiscal_period_id
    FROM finance.fiscal_periods
    WHERE status = 'OPEN'
    ORDER BY starts_on DESC
    LIMIT 1;
    IF v_fiscal_period_id IS NULL THEN
        RAISE EXCEPTION 'CLOSED_FISCAL_PERIOD: No open fiscal period is available'
            USING ERRCODE = '55000';
    END IF;

    INSERT INTO core.business_documents (
        document_type, status, document_date, fiscal_period_id, fiscal_year
    ) VALUES (
        'PURCHASE_RETURN', 'DRAFT', current_date, v_fiscal_period_id,
        extract(year FROM current_date)::integer
    ) RETURNING id INTO v_document_id;

    INSERT INTO procurement.supplier_returns (
        document_id, supplier_id, warehouse_id, purchase_order_id,
        receipt_document_id, reason_code, note
    ) VALUES (
        v_document_id, p_supplier_id, p_warehouse_id, p_purchase_order_id,
        p_receipt_document_id, coalesce(p_reason_code, 'DEFECTIVE_GOODS'),
        nullif(btrim(p_note), '')
    ) RETURNING id INTO v_return_id;

    FOR v_line IN
        SELECT
            (line ->> 'variant_id')::bigint AS variant_id,
            (line ->> 'quantity')::numeric AS quantity,
            (line ->> 'unit_cost')::numeric AS unit_cost
        FROM jsonb_array_elements(p_lines) line
    LOOP
        INSERT INTO procurement.supplier_return_lines (
            return_id, line_number, variant_id, quantity, unit_cost, line_total
        ) VALUES (
            v_return_id, v_line_number, v_line.variant_id, v_line.quantity,
            v_line.unit_cost, round(v_line.quantity * v_line.unit_cost, 2)
        );
        v_line_number := v_line_number + 1;
    END LOOP;

    RETURN jsonb_build_object(
        'document_id', v_document_id,
        'supplier_id', p_supplier_id,
        'purchase_order_id', p_purchase_order_id,
        'receipt_document_id', p_receipt_document_id,
        'status', 'DRAFT'
    );
END;
$$;

-- Preserve the existing seven-argument API for the PO workflow and older
-- clients; it delegates to the generalized source-aware function.
CREATE OR REPLACE FUNCTION procurement.create_supplier_return_draft(
    p_session_token text,
    p_supplier_id bigint,
    p_warehouse_id bigint,
    p_purchase_order_id bigint,
    p_reason_code text,
    p_note text,
    p_lines jsonb
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
    SELECT procurement.create_supplier_return_draft(
        p_session_token,
        p_supplier_id,
        p_warehouse_id,
        p_purchase_order_id,
        NULL::bigint,
        p_reason_code,
        p_note,
        p_lines
    );
$$;

-- ---------------------------------------------------------------------------
-- Confirmation: same valuation/accounting semantics for either purchase source.
-- ---------------------------------------------------------------------------
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
SET search_path = pg_catalog
AS $$
DECLARE
    v_user_id bigint;
    v_workstation_id text;
    v_existing_document_id bigint;
    v_return_status text;
    v_return_id bigint;
    v_supplier_id bigint;
    v_warehouse_id bigint;
    v_purchase_order_id bigint;
    v_receipt_document_id bigint;
    v_period_status text;
    v_period_start date;
    v_period_end date;
    v_fiscal_year integer := extract(year FROM p_document_date)::integer;
    v_invoice_count integer;
    v_invoice_document_id bigint;
    v_liability_id bigint;
    v_liability_outstanding numeric(14,2);
    v_clearing_role finance.account_role_code;
    v_return_sequence bigint;
    v_return_number text;
    v_journal_document_id bigint;
    v_clearing_amount numeric(14,2) := 0;
    v_inventory_value numeric(14,2) := 0;
    v_variance numeric(14,2);
    v_line record;
    v_received_qty numeric(18,3);
    v_previously_returned_qty numeric(18,3);
    v_authoritative_unit_cost numeric(18,6);
    v_position_qty numeric(18,3);
    v_position_value numeric(18,4);
    v_wac numeric(18,6);
    v_issue_value numeric(14,2);
    v_movement_id bigint;
    v_journal_line_number integer := 1;
BEGIN
    SELECT user_id, workstation_id
    INTO v_user_id, v_workstation_id
    FROM iam.resolve_session_with_permission(p_session_token, 'POST_SUPPLIER_RETURN');

    v_existing_document_id := core.reserve_idempotent_request(
        'inventory.confirm_supplier_return', p_request_id, p_request_hash
    );
    IF v_existing_document_id IS NOT NULL THEN
        SELECT document.document_number, journal.document_id
        INTO v_return_number, v_journal_document_id
        FROM core.business_documents document
        LEFT JOIN finance.journal_entries journal
          ON journal.source_type = 'PURCHASE_RETURN'
         AND journal.source_id = document.id
        WHERE document.id = v_existing_document_id;
        RETURN jsonb_build_object(
            'document_id', v_existing_document_id,
            'document_number', v_return_number,
            'status', 'POSTED',
            'journal_document_id', v_journal_document_id
        );
    END IF;

    SELECT document.status, supplier_return.id, supplier_return.supplier_id,
           supplier_return.warehouse_id, supplier_return.purchase_order_id,
           supplier_return.receipt_document_id
    INTO v_return_status, v_return_id, v_supplier_id,
         v_warehouse_id, v_purchase_order_id, v_receipt_document_id
    FROM core.business_documents document
    JOIN procurement.supplier_returns supplier_return
      ON supplier_return.document_id = document.id
    WHERE document.id = p_return_doc_id
    FOR UPDATE OF document;

    IF NOT FOUND OR v_return_status <> 'DRAFT' THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: Supplier return % is not in DRAFT status',
            p_return_doc_id USING ERRCODE = '55000';
    END IF;
    IF (v_purchase_order_id IS NULL) = (v_receipt_document_id IS NULL) THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: Supplier return purchase source is invalid'
            USING ERRCODE = '55000';
    END IF;

    SELECT status, starts_on, ends_on
    INTO v_period_status, v_period_start, v_period_end
    FROM finance.fiscal_periods
    WHERE id = p_fiscal_period_id
    FOR SHARE;
    IF NOT FOUND OR v_period_status <> 'OPEN' THEN
        RAISE EXCEPTION 'CLOSED_FISCAL_PERIOD: Fiscal period % is not open', p_fiscal_period_id
            USING ERRCODE = '55000';
    END IF;
    IF p_document_date < v_period_start OR p_document_date > v_period_end THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Document date is outside fiscal period'
            USING ERRCODE = '22023';
    END IF;

    SELECT count(DISTINCT invoice.document_id), min(invoice.document_id)
    INTO v_invoice_count, v_invoice_document_id
    FROM procurement.supplier_invoices invoice
    JOIN core.business_documents invoice_document
      ON invoice_document.id = invoice.document_id
     AND invoice_document.status = 'POSTED'
    WHERE invoice.supplier_id = v_supplier_id
      AND (
          (v_purchase_order_id IS NOT NULL
           AND invoice.purchase_order_id = v_purchase_order_id)
          OR
          (v_receipt_document_id IS NOT NULL
           AND invoice.purchase_order_id IS NULL
           AND EXISTS (
               SELECT 1
               FROM procurement.supplier_invoice_lines invoice_line
               JOIN procurement.purchase_receipt_lines receipt_line
                 ON receipt_line.id = invoice_line.receipt_line_id
               WHERE invoice_line.document_id = invoice.document_id
                 AND receipt_line.document_id = v_receipt_document_id
           ))
      );

    IF v_invoice_count > 1 THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: Return allocation is ambiguous across multiple supplier invoices'
            USING ERRCODE = '55000';
    ELSIF v_invoice_count = 1 THEN
        SELECT id, outstanding_amount
        INTO v_liability_id, v_liability_outstanding
        FROM procurement.supplier_liabilities
        WHERE invoice_document_id = v_invoice_document_id
          AND supplier_id = v_supplier_id
        FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'PRECONDITION_FAILED: Posted supplier invoice has no payable liability'
                USING ERRCODE = '55000';
        END IF;
        v_clearing_role := 'ACCOUNTS_PAYABLE';
    ELSE
        v_clearing_role := 'GRNI';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM procurement.supplier_return_lines WHERE return_id = v_return_id
    ) THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Supplier return requires at least one line'
            USING ERRCODE = '22023';
    END IF;

    PERFORM 1
    FROM inventory.positions position
    WHERE position.warehouse_id = v_warehouse_id
      AND position.variant_id IN (
          SELECT DISTINCT return_line.variant_id
          FROM procurement.supplier_return_lines return_line
          WHERE return_line.return_id = v_return_id
      )
    ORDER BY position.variant_id
    FOR UPDATE;

    FOR v_line IN
        SELECT id, variant_id, quantity
        FROM procurement.supplier_return_lines
        WHERE return_id = v_return_id
        ORDER BY line_number, id
    LOOP
        SELECT coalesce(sum(receipt_line.quantity_received), 0)
        INTO v_received_qty
        FROM procurement.purchase_receipt_lines receipt_line
        JOIN procurement.purchase_receipts receipt
          ON receipt.document_id = receipt_line.document_id
        JOIN core.business_documents receipt_document
          ON receipt_document.id = receipt.document_id
         AND receipt_document.status = 'POSTED'
        WHERE receipt.supplier_id = v_supplier_id
          AND receipt.warehouse_id = v_warehouse_id
          AND receipt_line.variant_id = v_line.variant_id
          AND (
              (v_purchase_order_id IS NOT NULL
               AND receipt.purchase_order_id = v_purchase_order_id)
              OR
              (v_receipt_document_id IS NOT NULL
               AND receipt.document_id = v_receipt_document_id)
          );

        SELECT coalesce(sum(other_line.quantity), 0)
        INTO v_previously_returned_qty
        FROM procurement.supplier_return_lines other_line
        JOIN procurement.supplier_returns other_return
          ON other_return.id = other_line.return_id
        JOIN core.business_documents other_document
          ON other_document.id = other_return.document_id
         AND other_document.status = 'POSTED'
        WHERE other_return.supplier_id = v_supplier_id
          AND other_return.warehouse_id = v_warehouse_id
          AND other_line.variant_id = v_line.variant_id
          AND other_return.id <> v_return_id
          AND (
              (v_purchase_order_id IS NOT NULL
               AND other_return.purchase_order_id = v_purchase_order_id)
              OR
              (v_receipt_document_id IS NOT NULL
               AND other_return.receipt_document_id = v_receipt_document_id)
          );

        IF v_line.quantity + v_previously_returned_qty > v_received_qty THEN
            RAISE EXCEPTION 'PRECONDITION_FAILED: Return quantity exceeds received quantity for variant %',
                v_line.variant_id USING ERRCODE = '55000';
        END IF;

        IF v_invoice_count = 1 THEN
            SELECT round(
                sum(invoice_line.quantity * invoice_line.unit_cost * invoice.exchange_rate_to_dzd)
                / sum(invoice_line.quantity),
                6
            )
            INTO v_authoritative_unit_cost
            FROM procurement.supplier_invoice_lines invoice_line
            JOIN procurement.supplier_invoices invoice
              ON invoice.document_id = invoice_line.document_id
            WHERE invoice_line.document_id = v_invoice_document_id
              AND invoice_line.variant_id = v_line.variant_id;
        ELSE
            SELECT round(
                sum(receipt_line.quantity_received * receipt_line.unit_cost)
                / sum(receipt_line.quantity_received),
                6
            )
            INTO v_authoritative_unit_cost
            FROM procurement.purchase_receipt_lines receipt_line
            JOIN procurement.purchase_receipts receipt
              ON receipt.document_id = receipt_line.document_id
            WHERE receipt.supplier_id = v_supplier_id
              AND receipt.warehouse_id = v_warehouse_id
              AND receipt_line.variant_id = v_line.variant_id
              AND (
                  (v_purchase_order_id IS NOT NULL
                   AND receipt.purchase_order_id = v_purchase_order_id)
                  OR
                  (v_receipt_document_id IS NOT NULL
                   AND receipt.document_id = v_receipt_document_id)
              );
        END IF;

        IF v_authoritative_unit_cost IS NULL THEN
            RAISE EXCEPTION 'PRECONDITION_FAILED: No authoritative purchase cost exists for variant %',
                v_line.variant_id USING ERRCODE = '55000';
        END IF;

        SELECT quantity_on_hand, total_value
        INTO v_position_qty, v_position_value
        FROM inventory.positions
        WHERE warehouse_id = v_warehouse_id
          AND variant_id = v_line.variant_id
        FOR UPDATE;
        IF NOT FOUND OR v_position_qty < v_line.quantity THEN
            RAISE EXCEPTION 'INSUFFICIENT_STOCK: Insufficient stock for returned variant %',
                v_line.variant_id USING ERRCODE = '55000';
        END IF;

        v_wac := CASE WHEN v_position_qty > 0 THEN v_position_value / v_position_qty ELSE 0 END;
        v_issue_value := CASE
            WHEN v_position_qty = v_line.quantity THEN round(v_position_value, 2)
            ELSE round(v_line.quantity * v_wac, 2)
        END;

        UPDATE inventory.positions
        SET quantity_on_hand = quantity_on_hand - v_line.quantity,
            total_value = total_value - v_issue_value,
            last_known_wac = CASE
                WHEN quantity_on_hand - v_line.quantity = 0 THEN last_known_wac
                ELSE (total_value - v_issue_value) / (quantity_on_hand - v_line.quantity)
            END,
            updated_at = now()
        WHERE warehouse_id = v_warehouse_id
          AND variant_id = v_line.variant_id;

        INSERT INTO inventory.movements (
            movement_type, reference_type, reference_id, warehouse_id, variant_id,
            quantity_delta, inventory_value_delta, resulting_quantity_on_hand,
            resulting_total_value
        ) VALUES (
            'ISSUE', 'SUPPLIER_RETURN', p_return_doc_id, v_warehouse_id, v_line.variant_id,
            -v_line.quantity, -v_issue_value,
            v_position_qty - v_line.quantity, v_position_value - v_issue_value
        ) RETURNING id INTO v_movement_id;

        UPDATE procurement.supplier_return_lines
        SET unit_cost = round(v_authoritative_unit_cost, 4),
            line_total = round(v_line.quantity * v_authoritative_unit_cost, 2)
        WHERE id = v_line.id;

        v_clearing_amount := v_clearing_amount
            + round(v_line.quantity * v_authoritative_unit_cost, 2);
        v_inventory_value := v_inventory_value + v_issue_value;
    END LOOP;

    IF v_clearing_amount <= 0 OR v_inventory_value <= 0 THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: Supplier return values must be positive'
            USING ERRCODE = '55000';
    END IF;
    IF v_liability_id IS NOT NULL AND v_clearing_amount > v_liability_outstanding THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: Return amount exceeds the outstanding supplier liability'
            USING ERRCODE = '55000';
    END IF;

    v_return_sequence := core.claim_next_document_number('DEBIT_NOTE', v_fiscal_year);
    v_return_number := 'DN-' || v_fiscal_year || '-' || lpad(v_return_sequence::text, 6, '0');
    UPDATE core.business_documents
    SET status = 'POSTED',
        sequence_number = v_return_sequence,
        document_number = v_return_number,
        document_date = p_document_date,
        fiscal_period_id = p_fiscal_period_id,
        fiscal_year = v_fiscal_year,
        posted_at = now()
    WHERE id = p_return_doc_id;

    v_journal_document_id := finance.create_posted_journal(
        p_document_date,
        p_fiscal_period_id,
        'Supplier return journal entry',
        'PURCHASE_RETURN',
        p_return_doc_id
    );

    INSERT INTO finance.journal_lines (document_id, line_number, account_code, debit, credit)
    VALUES (
        v_journal_document_id, v_journal_line_number,
        finance.require_account_role(v_clearing_role), v_clearing_amount, 0
    );
    v_journal_line_number := v_journal_line_number + 1;

    v_variance := v_inventory_value - v_clearing_amount;
    IF v_variance > 0 THEN
        INSERT INTO finance.journal_lines (document_id, line_number, account_code, debit, credit)
        VALUES (
            v_journal_document_id, v_journal_line_number,
            finance.require_account_role('PROCUREMENT_VARIANCE'), v_variance, 0
        );
        v_journal_line_number := v_journal_line_number + 1;
    END IF;

    INSERT INTO finance.journal_lines (document_id, line_number, account_code, debit, credit)
    VALUES (
        v_journal_document_id, v_journal_line_number,
        finance.require_account_role('INVENTORY'), 0, v_inventory_value
    );
    v_journal_line_number := v_journal_line_number + 1;

    IF v_variance < 0 THEN
        INSERT INTO finance.journal_lines (document_id, line_number, account_code, debit, credit)
        VALUES (
            v_journal_document_id, v_journal_line_number,
            finance.require_account_role('PROCUREMENT_VARIANCE'), 0, -v_variance
        );
    END IF;

    IF v_liability_id IS NOT NULL THEN
        UPDATE procurement.supplier_liabilities
        SET outstanding_amount = outstanding_amount - v_clearing_amount,
            status = CASE
                WHEN outstanding_amount - v_clearing_amount = 0 THEN 'PAID'
                ELSE 'PARTIALLY_PAID'
            END
        WHERE id = v_liability_id;
    END IF;

    PERFORM core.record_idempotent_result(
        'inventory.confirm_supplier_return', p_request_id, p_return_doc_id
    );

    RETURN jsonb_build_object(
        'document_id', p_return_doc_id,
        'document_number', v_return_number,
        'status', 'POSTED',
        'clearing_role', v_clearing_role,
        'clearing_amount', v_clearing_amount,
        'inventory_value', v_inventory_value,
        'variance_amount', v_variance,
        'journal_document_id', v_journal_document_id
    );
END;
$$;

-- ---------------------------------------------------------------------------
-- Return history exposes whichever purchase source actually exists.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION procurement.list_supplier_returns(
    p_session_token text,
    p_supplier_id bigint DEFAULT NULL
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
    PERFORM 1
    FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_PROCUREMENT');

    SELECT coalesce(jsonb_agg(
        jsonb_build_object(
            'document_id', document.id,
            'document_number', document.document_number,
            'supplier_id', supplier_return.supplier_id,
            'supplier_name', supplier.name,
            'warehouse_id', supplier_return.warehouse_id,
            'warehouse_name', warehouse.name,
            'purchase_order_id', supplier_return.purchase_order_id,
            'purchase_order_number', po_document.document_number,
            'receipt_document_id', supplier_return.receipt_document_id,
            'receipt_document_number', receipt_document.document_number,
            'status', document.status,
            'reason_code', supplier_return.reason_code,
            'journal_document_id', journal.document_id,
            'journal_document_number', journal_document.document_number,
            'created_at', supplier_return.created_at
        ) ORDER BY supplier_return.id DESC
    ), '[]'::jsonb)
    INTO v_result
    FROM procurement.supplier_returns supplier_return
    JOIN core.business_documents document ON document.id = supplier_return.document_id
    JOIN procurement.suppliers supplier ON supplier.id = supplier_return.supplier_id
    JOIN inventory.warehouses warehouse ON warehouse.id = supplier_return.warehouse_id
    LEFT JOIN core.business_documents po_document
      ON po_document.id = supplier_return.purchase_order_id
    LEFT JOIN core.business_documents receipt_document
      ON receipt_document.id = supplier_return.receipt_document_id
    LEFT JOIN finance.journal_entries journal
      ON journal.source_type = 'PURCHASE_RETURN'
     AND journal.source_id = supplier_return.document_id
    LEFT JOIN core.business_documents journal_document
      ON journal_document.id = journal.document_id
    WHERE p_supplier_id IS NULL
       OR supplier_return.supplier_id = p_supplier_id;

    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION procurement.list_purchase_receipt_lines(text,bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION procurement.create_supplier_return_draft(
    text,bigint,bigint,bigint,bigint,text,text,jsonb
) FROM PUBLIC;
REVOKE ALL ON FUNCTION procurement.create_supplier_return_draft(
    text,bigint,bigint,bigint,text,text,jsonb
) FROM PUBLIC;
REVOKE ALL ON FUNCTION inventory.confirm_supplier_return(
    text,uuid,bytea,bigint,bigint,date
) FROM PUBLIC;
REVOKE ALL ON FUNCTION procurement.list_supplier_returns(text,bigint) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION procurement.list_purchase_receipt_lines(text,bigint) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION procurement.create_supplier_return_draft(
    text,bigint,bigint,bigint,bigint,text,text,jsonb
) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION procurement.create_supplier_return_draft(
    text,bigint,bigint,bigint,text,text,jsonb
) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION inventory.confirm_supplier_return(
    text,uuid,bytea,bigint,bigint,date
) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION procurement.list_supplier_returns(text,bigint) TO stockiha_runtime;

UPDATE operations.schema_state
SET migration_version = 20260816163000,
    updated_at = now()
WHERE singleton;

RESET ROLE;
