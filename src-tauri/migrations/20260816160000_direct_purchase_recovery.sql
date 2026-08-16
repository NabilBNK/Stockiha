-- Direct-purchase recovery.
--
-- This migration supersedes the dormant single-entry purchase orchestrator so
-- that a direct purchase represents goods that already arrived. It deliberately
-- does NOT fabricate a purchase order. The authoritative accounting chain is:
--   purchase receipt -> GRNI -> supplier invoice/AP -> optional supplier payment.
-- Existing purchase-order receipts remain unchanged and continue to use
-- inventory.confirm_purchase_receipt.

SET ROLE stockiha_owner;

-- ---------------------------------------------------------------------------
-- 1. Generalize receipt / purchase-transaction storage for direct purchases.
-- ---------------------------------------------------------------------------
ALTER TABLE procurement.purchase_receipts
    ALTER COLUMN purchase_order_id DROP NOT NULL;

ALTER TABLE procurement.purchase_receipt_lines
    ALTER COLUMN po_line_id DROP NOT NULL;

ALTER TABLE procurement.purchase_receipts
    ADD COLUMN IF NOT EXISTS receipt_origin text NOT NULL DEFAULT 'PURCHASE_ORDER';

ALTER TABLE procurement.purchase_receipts
    DROP CONSTRAINT IF EXISTS purchase_receipts_origin_valid;
ALTER TABLE procurement.purchase_receipts
    ADD CONSTRAINT purchase_receipts_origin_valid
        CHECK (receipt_origin IN ('PURCHASE_ORDER', 'DIRECT_PURCHASE'));

ALTER TABLE procurement.purchase_receipts
    DROP CONSTRAINT IF EXISTS purchase_receipts_origin_po_consistent;
ALTER TABLE procurement.purchase_receipts
    ADD CONSTRAINT purchase_receipts_origin_po_consistent CHECK (
        (receipt_origin = 'PURCHASE_ORDER' AND purchase_order_id IS NOT NULL)
        OR
        (receipt_origin = 'DIRECT_PURCHASE' AND purchase_order_id IS NULL)
    );

ALTER TABLE procurement.purchase_transactions
    ALTER COLUMN purchase_order_id DROP NOT NULL;

ALTER TABLE procurement.purchase_transactions
    ADD COLUMN IF NOT EXISTS supplier_payment_ids jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE procurement.purchase_transactions
    DROP CONSTRAINT IF EXISTS purchase_transactions_payment_ids_array;
ALTER TABLE procurement.purchase_transactions
    ADD CONSTRAINT purchase_transactions_payment_ids_array
        CHECK (jsonb_typeof(supplier_payment_ids) = 'array');

-- ---------------------------------------------------------------------------
-- 2. Purchase-receipt response helper that supports both receipt origins.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION inventory._purchase_receipt_response(p_document_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_result jsonb;
BEGIN
    SELECT jsonb_build_object(
        'document_id', pr.document_id,
        'document_number', bd.document_number,
        'receipt_origin', pr.receipt_origin,
        'purchase_order_id', pr.purchase_order_id,
        'purchase_order_number', po_bd.document_number,
        'supplier_id', pr.supplier_id,
        'warehouse_id', pr.warehouse_id,
        'total_amount', pr.total_amount::text,
        'journal_document_id', pr.journal_document_id,
        'journal_document_number', journal_bd.document_number,
        'order_status', CASE
            WHEN pr.purchase_order_id IS NULL THEN NULL
            ELSE po.status
        END,
        'posted_at', bd.posted_at
    )
    INTO v_result
    FROM procurement.purchase_receipts pr
    JOIN core.business_documents bd ON bd.id = pr.document_id
    LEFT JOIN procurement.purchase_orders po ON po.document_id = pr.purchase_order_id
    LEFT JOIN core.business_documents po_bd ON po_bd.id = pr.purchase_order_id
    LEFT JOIN core.business_documents journal_bd ON journal_bd.id = pr.journal_document_id
    WHERE pr.document_id = p_document_id;

    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION inventory._purchase_receipt_response(bigint) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 3. Direct purchase receipt posting.
--
-- Product owns its unit in the current catalog contract. The simplified
-- purchase UI therefore accepts only that product unit; legacy alternate-unit
-- conversion is intentionally not reintroduced into the direct workflow.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION inventory.confirm_direct_purchase_receipt(
    p_session_token text,
    p_request_id uuid,
    p_payload_hash bytea,
    p_supplier_id bigint,
    p_warehouse_id bigint,
    p_fiscal_period_id bigint,
    p_document_date date,
    p_lines jsonb,
    p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_user_id bigint;
    v_workstation_id text;
    v_cached_result bigint;
    v_period_status text;
    v_period_start date;
    v_period_end date;
    v_fiscal_year integer := extract(year FROM p_document_date)::integer;
    v_input_line jsonb;
    v_line_number integer := 0;
    v_variant_id bigint;
    v_unit_id bigint;
    v_product_unit_id bigint;
    v_quantity numeric(18,3);
    v_unit_cost numeric(14,2);
    v_line_total numeric(14,2);
    v_receipt_subtotal numeric(14,2) := 0;
    v_old_qty numeric(18,3);
    v_old_value numeric(18,4);
    v_old_wac numeric(18,6);
    v_new_qty numeric(18,3);
    v_new_value numeric(18,4);
    v_new_wac numeric(18,6);
    v_movement_id bigint;
    v_receipt_document_id bigint;
    v_journal_document_id bigint;
    v_sequence bigint;
    v_document_number text;
BEGIN
    SELECT user_id, workstation_id
    INTO v_user_id, v_workstation_id
    FROM iam.resolve_session_with_permission(p_session_token, 'POST_PURCHASE_TRANSACTION');

    v_cached_result := core.reserve_idempotent_request(
        'inventory.confirm_direct_purchase_receipt', p_request_id, p_payload_hash
    );
    IF v_cached_result IS NOT NULL THEN
        RETURN inventory._purchase_receipt_response(v_cached_result);
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

    PERFORM 1
    FROM procurement.suppliers
    WHERE id = p_supplier_id AND is_active
    FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Supplier % is inactive or not found', p_supplier_id
            USING ERRCODE = '22023';
    END IF;

    PERFORM 1
    FROM inventory.warehouses
    WHERE id = p_warehouse_id AND is_active
    FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Warehouse % is inactive or not found', p_warehouse_id
            USING ERRCODE = '22023';
    END IF;

    IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Direct purchase requires at least one product line'
            USING ERRCODE = '22023';
    END IF;

    -- Validate every line before creating any business document.
    FOR v_input_line IN SELECT * FROM jsonb_array_elements(p_lines)
    LOOP
        v_line_number := v_line_number + 1;
        v_variant_id := NULLIF(v_input_line ->> 'variant_id', '')::bigint;
        v_unit_id := NULLIF(v_input_line ->> 'unit_id', '')::bigint;
        v_quantity := NULLIF(v_input_line ->> 'quantity_received', '')::numeric;
        v_unit_cost := NULLIF(v_input_line ->> 'unit_cost', '')::numeric;

        IF v_variant_id IS NULL OR v_variant_id <= 0 THEN
            RAISE EXCEPTION 'VALIDATION_ERROR: Line % has an invalid variant', v_line_number
                USING ERRCODE = '22023';
        END IF;
        IF v_unit_id IS NULL OR v_unit_id <= 0 THEN
            RAISE EXCEPTION 'VALIDATION_ERROR: Line % has an invalid unit', v_line_number
                USING ERRCODE = '22023';
        END IF;
        IF v_quantity IS NULL OR v_quantity <= 0 THEN
            RAISE EXCEPTION 'VALIDATION_ERROR: Line % quantity must be positive', v_line_number
                USING ERRCODE = '22023';
        END IF;
        IF v_unit_cost IS NULL OR v_unit_cost < 0 THEN
            RAISE EXCEPTION 'VALIDATION_ERROR: Line % unit cost cannot be negative', v_line_number
                USING ERRCODE = '22023';
        END IF;

        SELECT product.unit_id
        INTO v_product_unit_id
        FROM catalog.product_variants variant
        JOIN catalog.products product ON product.id = variant.product_id
        WHERE variant.id = v_variant_id
          AND variant.is_active
          AND product.is_active
        FOR SHARE OF variant, product;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'VALIDATION_ERROR: Variant % is inactive or not found', v_variant_id
                USING ERRCODE = '22023';
        END IF;
        IF v_unit_id <> v_product_unit_id THEN
            RAISE EXCEPTION 'VALIDATION_ERROR: Unit % is not the configured product unit for variant %',
                v_unit_id, v_variant_id USING ERRCODE = '22023';
        END IF;
    END LOOP;

    -- Lock existing positions deterministically. Missing positions are created
    -- below and protected by the unique (warehouse_id, variant_id) constraint.
    PERFORM 1
    FROM inventory.positions position
    WHERE position.warehouse_id = p_warehouse_id
      AND position.variant_id IN (
          SELECT DISTINCT (line ->> 'variant_id')::bigint
          FROM jsonb_array_elements(p_lines) line
      )
    ORDER BY position.variant_id
    FOR UPDATE;

    INSERT INTO core.business_documents (
        document_type, status, document_date, fiscal_period_id, fiscal_year
    ) VALUES (
        'PURCHASE_RECEIPT', 'DRAFT', p_document_date, p_fiscal_period_id, v_fiscal_year
    ) RETURNING id INTO v_receipt_document_id;

    INSERT INTO procurement.purchase_receipts (
        document_id, purchase_order_id, receipt_origin, supplier_id, warehouse_id,
        subtotal, total_amount, posted_by_user_id, workstation_id
    ) VALUES (
        v_receipt_document_id, NULL, 'DIRECT_PURCHASE', p_supplier_id, p_warehouse_id,
        0, 0, v_user_id, v_workstation_id
    );

    v_line_number := 0;
    FOR v_input_line IN SELECT * FROM jsonb_array_elements(p_lines)
    LOOP
        v_line_number := v_line_number + 1;
        v_variant_id := (v_input_line ->> 'variant_id')::bigint;
        v_unit_id := (v_input_line ->> 'unit_id')::bigint;
        v_quantity := (v_input_line ->> 'quantity_received')::numeric;
        v_unit_cost := (v_input_line ->> 'unit_cost')::numeric;
        v_line_total := round(v_quantity * v_unit_cost, 2);
        v_receipt_subtotal := v_receipt_subtotal + v_line_total;

        INSERT INTO inventory.positions (warehouse_id, variant_id)
        VALUES (p_warehouse_id, v_variant_id)
        ON CONFLICT (warehouse_id, variant_id) DO NOTHING;

        SELECT quantity_on_hand, total_value, last_known_wac
        INTO v_old_qty, v_old_value, v_old_wac
        FROM inventory.positions
        WHERE warehouse_id = p_warehouse_id AND variant_id = v_variant_id
        FOR UPDATE;

        v_new_qty := v_old_qty + v_quantity;
        v_new_value := v_old_value + v_line_total;
        v_new_wac := CASE
            WHEN v_new_qty > 0 THEN round(v_new_value / v_new_qty, 6)
            ELSE v_old_wac
        END;

        UPDATE inventory.positions
        SET quantity_on_hand = v_new_qty,
            total_value = v_new_value,
            last_known_wac = v_new_wac,
            updated_at = now()
        WHERE warehouse_id = p_warehouse_id AND variant_id = v_variant_id;

        INSERT INTO inventory.movements (
            warehouse_id, variant_id, movement_type, quantity_delta,
            inventory_value_delta, resulting_quantity_on_hand,
            resulting_total_value, reference_type, reference_id
        ) VALUES (
            p_warehouse_id, v_variant_id, 'RECEIPT', v_quantity,
            v_line_total, v_new_qty, v_new_value,
            'PURCHASE_RECEIPT', v_receipt_document_id
        ) RETURNING id INTO v_movement_id;

        INSERT INTO procurement.purchase_receipt_lines (
            document_id, line_number, po_line_id, variant_id, unit_id,
            quantity_received, unit_cost, line_total, movement_id
        ) VALUES (
            v_receipt_document_id, v_line_number, NULL, v_variant_id, v_unit_id,
            v_quantity, v_unit_cost, v_line_total, v_movement_id
        );
    END LOOP;

    IF v_receipt_subtotal <= 0 THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Direct purchase goods total must be positive'
            USING ERRCODE = '22023';
    END IF;

    UPDATE procurement.purchase_receipts
    SET subtotal = v_receipt_subtotal,
        total_amount = v_receipt_subtotal
    WHERE document_id = v_receipt_document_id;

    v_journal_document_id := finance.create_posted_journal(
        p_document_date,
        p_fiscal_period_id,
        COALESCE(NULLIF(btrim(p_note), ''), 'Direct purchase goods receipt'),
        'PURCHASE_RECEIPT',
        v_receipt_document_id
    );

    INSERT INTO finance.journal_lines (
        document_id, line_number, account_code, debit, credit
    ) VALUES
        (v_journal_document_id, 1, finance.require_account_role('INVENTORY'), v_receipt_subtotal, 0),
        (v_journal_document_id, 2, finance.require_account_role('GRNI'), 0, v_receipt_subtotal);

    UPDATE procurement.purchase_receipts
    SET journal_document_id = v_journal_document_id
    WHERE document_id = v_receipt_document_id;

    v_sequence := core.claim_next_document_number('PURCHASE_RECEIPT', v_fiscal_year);
    v_document_number := 'PR-' || v_fiscal_year || '-' || lpad(v_sequence::text, 6, '0');

    UPDATE core.business_documents
    SET status = 'POSTED',
        sequence_number = v_sequence,
        document_number = v_document_number,
        posted_at = now()
    WHERE id = v_receipt_document_id;

    PERFORM core.record_idempotent_result(
        'inventory.confirm_direct_purchase_receipt', p_request_id, v_receipt_document_id
    );

    RETURN inventory._purchase_receipt_response(v_receipt_document_id);
END;
$$;

REVOKE ALL ON FUNCTION inventory.confirm_direct_purchase_receipt(
    text,uuid,bytea,bigint,bigint,bigint,date,jsonb,text
) FROM PUBLIC;
-- The helper is intentionally not granted to stockiha_runtime. It is an
-- internal step of procurement.post_purchase_transaction, whose own permission
-- and idempotency boundary is authoritative.

-- ---------------------------------------------------------------------------
-- 4. Supplier invoice confirmation: allow direct receipts while preserving
--    strict receipt-line matching, GRNI clearing, variance, and AP creation.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION procurement.confirm_supplier_invoice(
    p_session_token text,
    p_request_id uuid,
    p_payload_hash bytea,
    p_invoice_doc_id bigint,
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
    v_supplier_id bigint;
    v_purchase_order_id bigint;
    v_invoice_status text;
    v_base_total numeric(14,2);
    v_foreign_subtotal numeric(14,2);
    v_foreign_total numeric(14,2);
    v_base_subtotal numeric(14,2);
    v_period_status text;
    v_period_start date;
    v_period_end date;
    v_fiscal_year integer := extract(year FROM p_document_date)::integer;
    v_invoice_sequence bigint;
    v_invoice_number text;
    v_journal_document_id bigint;
    v_grni_amount numeric(14,2);
    v_variance numeric(14,2);
    v_line_number integer := 1;
BEGIN
    SELECT user_id, workstation_id
    INTO v_user_id, v_workstation_id
    FROM iam.resolve_session_with_permission(p_session_token, 'POST_SUPPLIER_INVOICE');

    v_existing_document_id := core.reserve_idempotent_request(
        'procurement.confirm_supplier_invoice', p_request_id, p_payload_hash
    );
    IF v_existing_document_id IS NOT NULL THEN
        SELECT bd.document_number, liability.journal_document_id
        INTO v_invoice_number, v_journal_document_id
        FROM core.business_documents bd
        LEFT JOIN procurement.supplier_liabilities liability
          ON liability.invoice_document_id = bd.id
        WHERE bd.id = v_existing_document_id;

        RETURN jsonb_build_object(
            'document_id', v_existing_document_id,
            'document_number', v_invoice_number,
            'status', 'POSTED',
            'journal_document_id', v_journal_document_id
        );
    END IF;

    SELECT bd.status, invoice.supplier_id, invoice.purchase_order_id,
           invoice.base_total_amount, invoice.foreign_subtotal,
           invoice.foreign_total_amount, invoice.base_subtotal
    INTO v_invoice_status, v_supplier_id, v_purchase_order_id,
         v_base_total, v_foreign_subtotal, v_foreign_total, v_base_subtotal
    FROM core.business_documents bd
    JOIN procurement.supplier_invoices invoice ON invoice.document_id = bd.id
    WHERE bd.id = p_invoice_doc_id
    FOR UPDATE OF bd;

    IF NOT FOUND OR v_invoice_status <> 'DRAFT' THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: Invoice % is not in DRAFT status', p_invoice_doc_id
            USING ERRCODE = '55000';
    END IF;
    IF v_base_total <= 0 THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Supplier invoice total must be positive'
            USING ERRCODE = '22023';
    END IF;
    IF v_foreign_total <> v_foreign_subtotal OR v_base_total <> v_base_subtotal THEN
        RAISE EXCEPTION 'TAX_DISCOUNT_DISABLED: TVA and discounts are not enabled for the MVP'
            USING ERRCODE = '0A000';
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

    PERFORM 1
    FROM procurement.purchase_receipt_lines receipt_line
    WHERE receipt_line.id IN (
        SELECT invoice_line.receipt_line_id
        FROM procurement.supplier_invoice_lines invoice_line
        WHERE invoice_line.document_id = p_invoice_doc_id
    )
    ORDER BY receipt_line.id
    FOR UPDATE;

    IF NOT EXISTS (
        SELECT 1
        FROM procurement.supplier_invoice_lines
        WHERE document_id = p_invoice_doc_id
    ) THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Supplier invoice requires at least one line'
            USING ERRCODE = '22023';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM procurement.supplier_invoice_lines invoice_line
        LEFT JOIN procurement.purchase_receipt_lines receipt_line
          ON receipt_line.id = invoice_line.receipt_line_id
        LEFT JOIN procurement.purchase_receipts receipt
          ON receipt.document_id = receipt_line.document_id
        WHERE invoice_line.document_id = p_invoice_doc_id
          AND (
              invoice_line.receipt_line_id IS NULL
              OR receipt_line.id IS NULL
              OR receipt.supplier_id <> v_supplier_id
              OR receipt_line.variant_id <> invoice_line.variant_id
              OR (
                  v_purchase_order_id IS NOT NULL
                  AND (
                      receipt.purchase_order_id IS DISTINCT FROM v_purchase_order_id
                      OR receipt_line.po_line_id IS NULL
                      OR (
                          invoice_line.po_line_id IS NOT NULL
                          AND invoice_line.po_line_id <> receipt_line.po_line_id
                      )
                  )
              )
              OR (
                  v_purchase_order_id IS NULL
                  AND (
                      receipt.purchase_order_id IS NOT NULL
                      OR receipt.receipt_origin <> 'DIRECT_PURCHASE'
                      OR receipt_line.po_line_id IS NOT NULL
                      OR invoice_line.po_line_id IS NOT NULL
                  )
              )
          )
    ) THEN
        RAISE EXCEPTION 'THREE_WAY_MATCH_FAILED: Every invoice line must match a valid receipt line for the same supplier and workflow'
            USING ERRCODE = '55000';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM procurement.supplier_invoice_lines current_line
        JOIN procurement.purchase_receipt_lines receipt_line
          ON receipt_line.id = current_line.receipt_line_id
        WHERE current_line.document_id = p_invoice_doc_id
          AND current_line.quantity + COALESCE((
              SELECT sum(other_line.quantity)
              FROM procurement.supplier_invoice_lines other_line
              JOIN core.business_documents other_doc ON other_doc.id = other_line.document_id
              WHERE other_line.receipt_line_id = current_line.receipt_line_id
                AND other_line.document_id <> p_invoice_doc_id
                AND other_doc.status = 'POSTED'
          ), 0) > receipt_line.quantity_received
    ) THEN
        RAISE EXCEPTION 'THREE_WAY_MATCH_FAILED: Invoiced quantity exceeds received quantity'
            USING ERRCODE = '55000';
    END IF;

    -- Purchase-order invoices retain the pre-invoice-return net-received guard.
    IF v_purchase_order_id IS NOT NULL AND EXISTS (
        SELECT current_totals.variant_id
        FROM (
            SELECT invoice_line.variant_id, sum(invoice_line.quantity) AS current_quantity
            FROM procurement.supplier_invoice_lines invoice_line
            WHERE invoice_line.document_id = p_invoice_doc_id
            GROUP BY invoice_line.variant_id
        ) current_totals
        WHERE current_totals.current_quantity
              + COALESCE((
                  SELECT sum(other_line.quantity)
                  FROM procurement.supplier_invoice_lines other_line
                  JOIN procurement.supplier_invoices other_invoice
                    ON other_invoice.document_id = other_line.document_id
                  JOIN core.business_documents other_doc
                    ON other_doc.id = other_invoice.document_id
                   AND other_doc.status = 'POSTED'
                  WHERE other_invoice.purchase_order_id = v_purchase_order_id
                    AND other_line.variant_id = current_totals.variant_id
                    AND other_invoice.document_id <> p_invoice_doc_id
              ), 0)
              > COALESCE((
                  SELECT sum(receipt_line.quantity_received)
                  FROM procurement.purchase_receipt_lines receipt_line
                  JOIN procurement.purchase_receipts receipt
                    ON receipt.document_id = receipt_line.document_id
                  JOIN core.business_documents receipt_doc
                    ON receipt_doc.id = receipt.document_id
                   AND receipt_doc.status = 'POSTED'
                  WHERE receipt.purchase_order_id = v_purchase_order_id
                    AND receipt_line.variant_id = current_totals.variant_id
              ), 0)
              - COALESCE((
                  SELECT sum(return_line.quantity)
                  FROM procurement.supplier_return_lines return_line
                  JOIN procurement.supplier_returns supplier_return
                    ON supplier_return.id = return_line.return_id
                  JOIN core.business_documents return_doc
                    ON return_doc.id = supplier_return.document_id
                   AND return_doc.status = 'POSTED'
                  WHERE supplier_return.purchase_order_id = v_purchase_order_id
                    AND return_line.variant_id = current_totals.variant_id
              ), 0)
    ) THEN
        RAISE EXCEPTION 'THREE_WAY_MATCH_FAILED: Invoice quantity exceeds net received quantity after supplier returns'
            USING ERRCODE = '55000';
    END IF;

    SELECT sum(round(invoice_line.quantity * receipt_line.unit_cost, 2))
    INTO v_grni_amount
    FROM procurement.supplier_invoice_lines invoice_line
    JOIN procurement.purchase_receipt_lines receipt_line
      ON receipt_line.id = invoice_line.receipt_line_id
    WHERE invoice_line.document_id = p_invoice_doc_id;

    IF v_grni_amount IS NULL OR v_grni_amount <= 0 THEN
        RAISE EXCEPTION 'THREE_WAY_MATCH_FAILED: Matched GRNI amount must be positive'
            USING ERRCODE = '55000';
    END IF;

    v_variance := round(v_base_total - v_grni_amount, 2);
    v_invoice_sequence := core.claim_next_document_number('PURCHASE_INVOICE', v_fiscal_year);
    v_invoice_number := 'PI-' || v_fiscal_year || '-' || lpad(v_invoice_sequence::text, 6, '0');

    UPDATE core.business_documents
    SET status = 'POSTED',
        sequence_number = v_invoice_sequence,
        document_number = v_invoice_number,
        document_date = p_document_date,
        fiscal_period_id = p_fiscal_period_id,
        fiscal_year = v_fiscal_year,
        posted_at = now()
    WHERE id = p_invoice_doc_id;

    v_journal_document_id := finance.create_posted_journal(
        p_document_date,
        p_fiscal_period_id,
        'Supplier invoice journal entry',
        'PURCHASE_INVOICE',
        p_invoice_doc_id
    );

    INSERT INTO finance.journal_lines (document_id, line_number, account_code, debit, credit)
    VALUES (
        v_journal_document_id, v_line_number,
        finance.require_account_role('GRNI'), v_grni_amount, 0
    );
    v_line_number := v_line_number + 1;

    IF v_variance > 0 THEN
        INSERT INTO finance.journal_lines (document_id, line_number, account_code, debit, credit)
        VALUES (
            v_journal_document_id, v_line_number,
            finance.require_account_role('PROCUREMENT_VARIANCE'), v_variance, 0
        );
        v_line_number := v_line_number + 1;
    ELSIF v_variance < 0 THEN
        INSERT INTO finance.journal_lines (document_id, line_number, account_code, debit, credit)
        VALUES (
            v_journal_document_id, v_line_number,
            finance.require_account_role('PROCUREMENT_VARIANCE'), 0, -v_variance
        );
        v_line_number := v_line_number + 1;
    END IF;

    INSERT INTO finance.journal_lines (document_id, line_number, account_code, debit, credit)
    VALUES (
        v_journal_document_id, v_line_number,
        finance.require_account_role('ACCOUNTS_PAYABLE'), 0, v_base_total
    );

    INSERT INTO procurement.supplier_liabilities (
        supplier_id, purchase_order_id, invoice_document_id,
        journal_document_id, original_amount, outstanding_amount, due_date, status
    ) VALUES (
        v_supplier_id, v_purchase_order_id, p_invoice_doc_id,
        v_journal_document_id, v_base_total, v_base_total,
        p_document_date + 30, 'UNPAID'
    );

    PERFORM core.record_idempotent_result(
        'procurement.confirm_supplier_invoice', p_request_id, p_invoice_doc_id
    );

    RETURN jsonb_build_object(
        'document_id', p_invoice_doc_id,
        'document_number', v_invoice_number,
        'supplier_id', v_supplier_id,
        'total_amount', v_base_total,
        'grni_amount', v_grni_amount,
        'variance_amount', v_variance,
        'journal_document_id', v_journal_document_id,
        'status', 'POSTED'
    );
END;
$$;

REVOKE ALL ON FUNCTION procurement.confirm_supplier_invoice(
    text,uuid,bytea,bigint,bigint,date
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION procurement.confirm_supplier_invoice(
    text,uuid,bytea,bigint,bigint,date
) TO stockiha_runtime;

-- ---------------------------------------------------------------------------
-- 5. Replace the dormant single-entry orchestrator with the direct-purchase
--    workflow. One UI confirmation remains one database transaction.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION procurement.post_purchase_transaction(
    p_session_token text,
    p_request_id uuid,
    p_request_hash bytea,
    p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_user_id bigint;
    v_workstation_id text;
    v_existing_doc_id bigint;
    v_supplier_id bigint;
    v_supplier_rec record;
    v_external_doc_num text;
    v_doc_date date;
    v_fiscal_period_id bigint;
    v_fiscal_year integer;
    v_warehouse_id bigint;
    v_payment_status text;
    v_payment_method text;
    v_paid_amount numeric(14,2) := 0;
    v_outstanding_amount numeric(14,2) := 0;
    v_payment_remaining numeric(14,2) := 0;
    v_payment_piece numeric(14,2) := 0;
    v_due_terms_days integer;
    v_due_date date;
    v_require_cash_session boolean;
    v_cash_session_id bigint;
    v_default_bank_account text;
    v_lines jsonb;
    v_line_rec record;
    v_line_idx integer := 0;
    v_gross_subtotal numeric(14,2) := 0;
    v_total_additional_cost numeric(14,2) := 0;
    v_grand_total numeric(14,2) := 0;
    v_receipt_lines_json jsonb := '[]'::jsonb;
    v_invoice_lines_json jsonb := '[]'::jsonb;
    v_root_doc_id bigint;
    v_root_doc_num text;
    v_receipt_doc_id bigint;
    v_invoice_doc_id bigint;
    v_payment_doc_id bigint := NULL;
    v_payment_doc_ids jsonb := '[]'::jsonb;
    v_landed_cost_ids jsonb := '[]'::jsonb;
    v_additional_costs jsonb;
    v_additional_cost record;
    v_liability record;
    v_print_after boolean;
    v_generation_status text := 'NOT_ENQUEUED';
    v_print_status text := NULL;
    v_result jsonb;
BEGIN
    SELECT user_id, workstation_id
    INTO v_user_id, v_workstation_id
    FROM iam.resolve_session_with_permission(p_session_token, 'POST_PURCHASE_TRANSACTION');

    IF core.get_setting('simplified_purchase_entry', 'true') <> 'true' THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: Direct purchase entry is disabled by the purchasing workflow setting'
            USING ERRCODE = '55000';
    END IF;

    v_existing_doc_id := core.reserve_idempotent_request(
        'procurement.post_purchase_transaction', p_request_id, p_request_hash
    );
    IF v_existing_doc_id IS NOT NULL THEN
        SELECT jsonb_build_object(
            'document_id', transaction.document_id,
            'document_number', document.document_number,
            'status', document.status,
            'supplier_id', transaction.supplier_id,
            'warehouse_id', transaction.warehouse_id,
            'gross_subtotal', transaction.gross_subtotal::text,
            'discount_amount', '0.00',
            'tax_amount', '0.00',
            'total_amount', transaction.total_amount::text,
            'payment_status', transaction.payment_status,
            'payment_method', transaction.payment_method,
            'paid_amount', transaction.paid_amount::text,
            'outstanding_amount', transaction.outstanding_amount::text,
            'due_date', transaction.due_date,
            'child_documents', jsonb_build_object(
                'purchase_order_id', NULL,
                'goods_receipt_id', transaction.goods_receipt_id,
                'supplier_invoice_id', transaction.supplier_invoice_id,
                'supplier_payment_id', transaction.supplier_payment_id,
                'supplier_payment_ids', transaction.supplier_payment_ids,
                'landed_cost_document_ids', '[]'::jsonb
            ),
            'generation_status', 'COMPLETED',
            'print_status', CASE WHEN transaction.supplier_payment_id IS NULL THEN NULL ELSE 'COMPLETED' END
        )
        INTO v_result
        FROM procurement.purchase_transactions transaction
        JOIN core.business_documents document ON document.id = transaction.document_id
        WHERE transaction.document_id = v_existing_doc_id;

        RETURN v_result;
    END IF;

    v_supplier_id := NULLIF(p_payload ->> 'supplier_id', '')::bigint;
    v_external_doc_num := NULLIF(btrim(COALESCE(p_payload ->> 'external_supplier_document_number', '')), '');
    v_doc_date := NULLIF(p_payload ->> 'document_date', '')::date;
    v_payment_status := upper(COALESCE(p_payload ->> 'payment_status', ''));
    v_payment_method := NULLIF(upper(btrim(COALESCE(p_payload ->> 'payment_method', ''))), '');
    v_print_after := COALESCE((p_payload ->> 'print_after_confirmation')::boolean, true);

    IF v_supplier_id IS NULL OR v_supplier_id <= 0 THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Supplier is required' USING ERRCODE = '22023';
    END IF;
    IF v_doc_date IS NULL THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Document date is required' USING ERRCODE = '22023';
    END IF;
    IF v_payment_status NOT IN ('PAID', 'PARTIALLY_PAID', 'UNPAID') THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Invalid payment status' USING ERRCODE = '22023';
    END IF;

    SELECT *
    INTO v_supplier_rec
    FROM procurement.suppliers
    WHERE id = v_supplier_id AND is_active
    FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Supplier does not exist or is inactive'
            USING ERRCODE = '22023';
    END IF;

    IF v_external_doc_num IS NOT NULL AND EXISTS (
        SELECT 1
        FROM procurement.purchase_transactions transaction
        WHERE transaction.supplier_id = v_supplier_id
          AND transaction.external_supplier_document_number = v_external_doc_num
    ) THEN
        RAISE EXCEPTION 'DUPLICATE_SUPPLIER_DOCUMENT: This supplier document has already been recorded'
            USING ERRCODE = '23505';
    END IF;

    SELECT default_warehouse_id
    INTO v_warehouse_id
    FROM core.system_state
    WHERE id = 1;

    IF v_warehouse_id IS NULL THEN
        SELECT id
        INTO v_warehouse_id
        FROM inventory.warehouses
        WHERE is_active
        ORDER BY id
        LIMIT 1;
    END IF;
    IF v_warehouse_id IS NULL THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: No active default warehouse configured'
            USING ERRCODE = '55000';
    END IF;

    SELECT period.id
    INTO v_fiscal_period_id
    FROM finance.fiscal_periods period
    WHERE period.status = 'OPEN'
      AND period.starts_on <= v_doc_date
      AND period.ends_on >= v_doc_date
    ORDER BY period.id DESC
    LIMIT 1;

    IF v_fiscal_period_id IS NULL THEN
        RAISE EXCEPTION 'CLOSED_FISCAL_PERIOD: No open fiscal period contains the purchase date'
            USING ERRCODE = '55000';
    END IF;
    v_fiscal_year := extract(year FROM v_doc_date)::integer;

    v_lines := p_payload -> 'lines';
    IF v_lines IS NULL OR jsonb_typeof(v_lines) <> 'array' OR jsonb_array_length(v_lines) = 0 THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Purchase transaction must contain at least one product line'
            USING ERRCODE = '22023';
    END IF;

    FOR v_line_rec IN
        SELECT *
        FROM jsonb_to_recordset(v_lines) AS line(
            variant_id bigint,
            unit_id bigint,
            quantity numeric,
            unit_cost numeric
        )
    LOOP
        v_line_idx := v_line_idx + 1;
        IF v_line_rec.variant_id IS NULL OR v_line_rec.variant_id <= 0 THEN
            RAISE EXCEPTION 'VALIDATION_ERROR: Line % has invalid variant', v_line_idx
                USING ERRCODE = '22023';
        END IF;
        IF v_line_rec.unit_id IS NULL OR v_line_rec.unit_id <= 0 THEN
            RAISE EXCEPTION 'VALIDATION_ERROR: Line % has invalid unit', v_line_idx
                USING ERRCODE = '22023';
        END IF;
        IF v_line_rec.quantity IS NULL OR v_line_rec.quantity <= 0 THEN
            RAISE EXCEPTION 'VALIDATION_ERROR: Line % quantity must be positive', v_line_idx
                USING ERRCODE = '22023';
        END IF;
        IF v_line_rec.unit_cost IS NULL OR v_line_rec.unit_cost < 0 THEN
            RAISE EXCEPTION 'VALIDATION_ERROR: Line % unit cost cannot be negative', v_line_idx
                USING ERRCODE = '22023';
        END IF;

        v_gross_subtotal := v_gross_subtotal + round(v_line_rec.quantity * v_line_rec.unit_cost, 2);
        v_receipt_lines_json := v_receipt_lines_json || jsonb_build_object(
            'variant_id', v_line_rec.variant_id,
            'unit_id', v_line_rec.unit_id,
            'quantity_received', v_line_rec.quantity,
            'unit_cost', v_line_rec.unit_cost
        );
    END LOOP;

    IF v_gross_subtotal <= 0 THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Purchase goods total must be positive'
            USING ERRCODE = '22023';
    END IF;

    v_additional_costs := p_payload -> 'additional_costs';
    IF v_additional_costs IS NOT NULL
       AND jsonb_typeof(v_additional_costs) = 'array'
       AND jsonb_array_length(v_additional_costs) > 0 THEN
        FOR v_additional_cost IN
            SELECT * FROM jsonb_to_recordset(v_additional_costs) AS cost(cost_type text, amount numeric)
        LOOP
            IF v_additional_cost.amount IS NULL OR v_additional_cost.amount < 0 THEN
                RAISE EXCEPTION 'VALIDATION_ERROR: Additional cost amounts cannot be negative'
                    USING ERRCODE = '22023';
            END IF;
            v_total_additional_cost := v_total_additional_cost + round(v_additional_cost.amount, 2);
        END LOOP;
    END IF;

    v_grand_total := v_gross_subtotal + v_total_additional_cost;

    IF v_payment_status = 'PAID' THEN
        IF v_payment_method NOT IN ('CASH', 'BANK_TRANSFER') THEN
            RAISE EXCEPTION 'VALIDATION_ERROR: Paid purchases require Cash or Bank Transfer'
                USING ERRCODE = '22023';
        END IF;
        v_paid_amount := v_grand_total;
    ELSIF v_payment_status = 'PARTIALLY_PAID' THEN
        IF v_payment_method NOT IN ('CASH', 'BANK_TRANSFER') THEN
            RAISE EXCEPTION 'VALIDATION_ERROR: Partially paid purchases require Cash or Bank Transfer'
                USING ERRCODE = '22023';
        END IF;
        v_paid_amount := COALESCE(NULLIF(p_payload ->> 'paid_amount', '')::numeric, 0);
        IF v_paid_amount <= 0 OR v_paid_amount >= v_grand_total THEN
            RAISE EXCEPTION 'VALIDATION_ERROR: Partial payment must be greater than zero and less than the total'
                USING ERRCODE = '22023';
        END IF;
    ELSE
        v_payment_method := NULL;
        v_paid_amount := 0;
    END IF;

    v_outstanding_amount := v_grand_total - v_paid_amount;

    IF v_payment_method = 'CASH' THEN
        v_require_cash_session := (
            core.get_setting('require_open_cash_session_for_purchase_cash_payment', 'true') = 'true'
        );
        IF v_require_cash_session THEN
            SELECT cash_session.id
            INTO v_cash_session_id
            FROM sales.cash_sessions cash_session
            WHERE cash_session.status = 'OPEN'
              AND (
                  cash_session.current_cashier_user_id = v_user_id
                  OR cash_session.opened_by_user_id = v_user_id
              )
            ORDER BY cash_session.opened_at DESC
            LIMIT 1;

            IF v_cash_session_id IS NULL THEN
                RAISE EXCEPTION 'CASH_SESSION_REQUIRED: An open cash session is required for a cash supplier payment'
                    USING ERRCODE = '55000';
            END IF;
        END IF;
    ELSIF v_payment_method = 'BANK_TRANSFER' THEN
        v_default_bank_account := core.get_setting('default_purchase_bank_account', '');
        IF COALESCE(NULLIF(v_default_bank_account, ''), '') = '' THEN
            RAISE EXCEPTION 'PRECONDITION_FAILED: A default purchase bank account must be configured for bank transfers'
                USING ERRCODE = '55000';
        END IF;
    END IF;

    v_due_terms_days := COALESCE(
        NULLIF(core.get_setting('default_supplier_payment_terms', '30'), '')::integer,
        30
    );
    v_due_date := v_doc_date + v_due_terms_days;

    -- Post the physical receipt first. No purchase order exists in this path.
    DECLARE
        v_receipt_result jsonb;
    BEGIN
        v_receipt_result := inventory.confirm_direct_purchase_receipt(
            p_session_token,
            gen_random_uuid(),
            sha256(convert_to(jsonb_build_object(
                'supplier_id', v_supplier_id,
                'warehouse_id', v_warehouse_id,
                'date', v_doc_date,
                'lines', v_receipt_lines_json
            )::text, 'UTF8')),
            v_supplier_id,
            v_warehouse_id,
            v_fiscal_period_id,
            v_doc_date,
            v_receipt_lines_json,
            p_payload ->> 'note'
        );
        v_receipt_doc_id := (v_receipt_result ->> 'document_id')::bigint;
    END;

    -- The current landed-cost policy is one allocation per receipt. Aggregate
    -- all UI additional-cost rows into that single authoritative allocation.
    IF v_total_additional_cost > 0 THEN
        DECLARE
            v_landed_result jsonb;
            v_landed_journal_id bigint;
        BEGIN
            v_landed_result := inventory.allocate_landed_cost(
                p_session_token,
                gen_random_uuid(),
                sha256(convert_to(jsonb_build_object(
                    'receipt_id', v_receipt_doc_id,
                    'amount', v_total_additional_cost
                )::text, 'UTF8')),
                v_receipt_doc_id,
                v_total_additional_cost,
                'BY_VALUE',
                v_fiscal_period_id,
                v_doc_date,
                'Single-entry purchase additional costs'
            );
            v_landed_journal_id := NULLIF(v_landed_result ->> 'journal_document_id', '')::bigint;
            IF v_landed_journal_id IS NOT NULL THEN
                v_landed_cost_ids := v_landed_cost_ids || to_jsonb(v_landed_journal_id);
            END IF;
        END;
    END IF;

    -- Create a supplier invoice directly against the posted direct receipt.
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'line_number', receipt_line.line_number,
        'po_line_id', NULL,
        'receipt_line_id', receipt_line.id,
        'variant_id', receipt_line.variant_id,
        'quantity', receipt_line.quantity_received,
        'unit_cost', receipt_line.unit_cost
    ) ORDER BY receipt_line.line_number), '[]'::jsonb)
    INTO v_invoice_lines_json
    FROM procurement.purchase_receipt_lines receipt_line
    WHERE receipt_line.document_id = v_receipt_doc_id;

    DECLARE
        v_invoice_draft jsonb;
        v_invoice_confirmed jsonb;
    BEGIN
        v_invoice_draft := procurement.create_supplier_invoice_draft(
            p_session_token,
            v_supplier_id,
            NULL,
            'DZD',
            1.0,
            p_payload ->> 'note',
            v_invoice_lines_json
        );
        v_invoice_doc_id := (v_invoice_draft ->> 'document_id')::bigint;

        v_invoice_confirmed := procurement.confirm_supplier_invoice(
            p_session_token,
            gen_random_uuid(),
            sha256(convert_to(jsonb_build_object('invoice_id', v_invoice_doc_id)::text, 'UTF8')),
            v_invoice_doc_id,
            v_fiscal_period_id,
            v_doc_date
        );
    END;

    -- Allocate a full/partial payment across every liability created by this
    -- transaction (goods invoice first, then landed-cost liability). This
    -- avoids the historical bug where additional costs made one payment exceed
    -- the invoice liability.
    v_payment_remaining := v_paid_amount;
    IF v_payment_remaining > 0 THEN
        FOR v_liability IN
            SELECT liability.id, liability.outstanding_amount,
                   CASE WHEN liability.invoice_document_id = v_invoice_doc_id THEN 0 ELSE 1 END AS priority
            FROM procurement.supplier_liabilities liability
            WHERE liability.supplier_id = v_supplier_id
              AND (
                  liability.invoice_document_id = v_invoice_doc_id
                  OR liability.receipt_document_id = v_receipt_doc_id
              )
              AND liability.outstanding_amount > 0
            ORDER BY priority, liability.id
        LOOP
            EXIT WHEN v_payment_remaining <= 0;
            v_payment_piece := least(v_payment_remaining, v_liability.outstanding_amount);

            DECLARE
                v_payment_result jsonb;
                v_current_payment_id bigint;
            BEGIN
                v_payment_result := procurement.post_supplier_payment(
                    p_session_token,
                    gen_random_uuid(),
                    sha256(convert_to(jsonb_build_object(
                        'liability_id', v_liability.id,
                        'amount', v_payment_piece,
                        'method', v_payment_method
                    )::text, 'UTF8')),
                    v_supplier_id,
                    v_liability.id,
                    v_payment_piece,
                    v_payment_method,
                    v_fiscal_period_id,
                    v_doc_date,
                    'Single-entry purchase payment'
                );
                v_current_payment_id := (v_payment_result ->> 'document_id')::bigint;
                IF v_payment_doc_id IS NULL THEN
                    v_payment_doc_id := v_current_payment_id;
                END IF;
                v_payment_doc_ids := v_payment_doc_ids || to_jsonb(v_current_payment_id);
            END;

            v_payment_remaining := round(v_payment_remaining - v_payment_piece, 2);
        END LOOP;

        IF v_payment_remaining <> 0 THEN
            RAISE EXCEPTION 'PRECONDITION_FAILED: Purchase payment could not be fully allocated to created supplier liabilities'
                USING ERRCODE = '55000';
        END IF;
    END IF;

    -- Root document: one operator transaction that references all authoritative
    -- child records. The purchase_order_id is intentionally NULL.
    DECLARE
        v_root_sequence bigint;
    BEGIN
        v_root_sequence := core.claim_next_document_number('PURCHASE_TRANSACTION', v_fiscal_year);
        v_root_doc_num := 'PUR-' || v_fiscal_year || '-' || lpad(v_root_sequence::text, 6, '0');

        INSERT INTO core.business_documents (
            document_type, sequence_number, document_number, status,
            document_date, fiscal_year, fiscal_period_id, posted_at
        ) VALUES (
            'PURCHASE_TRANSACTION', v_root_sequence, v_root_doc_num, 'POSTED',
            v_doc_date, v_fiscal_year, v_fiscal_period_id, now()
        ) RETURNING id INTO v_root_doc_id;

        INSERT INTO procurement.purchase_transactions (
            document_id, supplier_id, warehouse_id, external_supplier_document_number,
            payment_status, payment_method, gross_subtotal, discount_amount, tax_amount,
            additional_cost_amount, total_amount, paid_amount, outstanding_amount, due_date,
            purchase_order_id, goods_receipt_id, supplier_invoice_id, supplier_payment_id,
            supplier_payment_ids, note, supplier_snapshot
        ) VALUES (
            v_root_doc_id, v_supplier_id, v_warehouse_id, v_external_doc_num,
            v_payment_status, v_payment_method, v_gross_subtotal, 0, 0,
            v_total_additional_cost, v_grand_total, v_paid_amount, v_outstanding_amount, v_due_date,
            NULL, v_receipt_doc_id, v_invoice_doc_id, v_payment_doc_id,
            v_payment_doc_ids, p_payload ->> 'note',
            jsonb_build_object(
                'id', v_supplier_rec.id,
                'code', v_supplier_rec.code,
                'name', v_supplier_rec.name
            )
        );

        v_line_idx := 0;
        FOR v_line_rec IN
            SELECT *
            FROM jsonb_to_recordset(v_lines) AS line(
                variant_id bigint,
                unit_id bigint,
                quantity numeric,
                unit_cost numeric
            )
        LOOP
            v_line_idx := v_line_idx + 1;
            DECLARE
                v_line_total numeric(14,2) := round(v_line_rec.quantity * v_line_rec.unit_cost, 2);
                v_sku text;
                v_product_name text;
                v_brand_name text;
                v_unit_code text;
                v_attributes jsonb;
            BEGIN
                SELECT variant.sku, product.name, brand.name, unit.code,
                       COALESCE((
                           SELECT jsonb_agg(jsonb_build_object(
                               'name', attribute.name,
                               'value', attribute_value.value
                           ) ORDER BY attribute.id, attribute_value.id)
                           FROM catalog.variant_attribute_values mapping
                           JOIN catalog.attribute_values attribute_value
                             ON attribute_value.id = mapping.attribute_value_id
                           JOIN catalog.attributes attribute
                             ON attribute.id = attribute_value.attribute_id
                           WHERE mapping.variant_id = variant.id
                       ), '[]'::jsonb)
                INTO v_sku, v_product_name, v_brand_name, v_unit_code, v_attributes
                FROM catalog.product_variants variant
                JOIN catalog.products product ON product.id = variant.product_id
                JOIN catalog.units unit ON unit.id = product.unit_id
                LEFT JOIN catalog.brands brand ON brand.id = product.brand_id
                WHERE variant.id = v_line_rec.variant_id;

                INSERT INTO procurement.purchase_transaction_lines (
                    document_id, line_number, variant_id, unit_id, quantity, unit_cost,
                    gross_amount, discount_amount, tax_amount, line_total,
                    sku_snapshot, product_name_snapshot, brand_snapshot,
                    attributes_snapshot, unit_code_snapshot
                ) VALUES (
                    v_root_doc_id, v_line_idx, v_line_rec.variant_id, v_line_rec.unit_id,
                    v_line_rec.quantity, v_line_rec.unit_cost,
                    v_line_total, 0, 0, v_line_total,
                    v_sku, v_product_name, v_brand_name, v_attributes, v_unit_code
                );
            END;
        END LOOP;
    END;

    IF v_print_after THEN
        PERFORM *
        FROM documents.enqueue_business_document_jobs(
            v_root_doc_id,
            'PURCHASE_RECEIPT_PDF',
            'purchase_receipt:' || v_root_doc_id::text
        );
        v_generation_status := 'PENDING';
        v_print_status := 'WAITING_FOR_GENERATION';
    END IF;

    PERFORM core.record_idempotent_result(
        'procurement.post_purchase_transaction', p_request_id, v_root_doc_id
    );

    v_result := jsonb_build_object(
        'document_id', v_root_doc_id,
        'document_number', v_root_doc_num,
        'status', 'POSTED',
        'supplier_id', v_supplier_id,
        'warehouse_id', v_warehouse_id,
        'gross_subtotal', v_gross_subtotal::text,
        'discount_amount', '0.00',
        'tax_amount', '0.00',
        'total_amount', v_grand_total::text,
        'payment_status', v_payment_status,
        'payment_method', v_payment_method,
        'paid_amount', v_paid_amount::text,
        'outstanding_amount', v_outstanding_amount::text,
        'due_date', v_due_date,
        'child_documents', jsonb_build_object(
            'purchase_order_id', NULL,
            'goods_receipt_id', v_receipt_doc_id,
            'supplier_invoice_id', v_invoice_doc_id,
            'supplier_payment_id', v_payment_doc_id,
            'supplier_payment_ids', v_payment_doc_ids,
            'landed_cost_document_ids', v_landed_cost_ids
        ),
        'generation_status', v_generation_status,
        'print_status', v_print_status
    );

    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION procurement.post_purchase_transaction(text,uuid,bytea,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION procurement.post_purchase_transaction(text,uuid,bytea,jsonb) TO stockiha_runtime;

UPDATE operations.schema_state
SET migration_version = 20260816160000,
    updated_at = now()
WHERE singleton;

RESET ROLE;
