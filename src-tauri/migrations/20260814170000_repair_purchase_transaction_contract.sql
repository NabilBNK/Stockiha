-- Migration: 20260814170000_repair_purchase_transaction_contract.sql
-- Stockiha New Purchase Transaction Contract Repair:
-- 1. Update catalog._effective_variant_name to use canonical ' - ' separator (eliminating malformed Â· characters).
-- 2. Make procurement.purchase_transactions.external_supplier_document_number nullable.
-- 3. Update procurement.list_purchase_product_options to join catalog.products.unit_id and return variant details.
-- 4. Update procurement.post_purchase_transaction RPC to align JSON key names and table column names, and check jsonb_typeof for additional_costs.

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'stockiha_owner') THEN
        EXECUTE 'SET ROLE stockiha_owner';
    END IF;
EXCEPTION WHEN OTHERS THEN
    NULL;
END $$;

-- 1. Repair canonical variant effective naming helper (Product Name - Attribute Values)
CREATE OR REPLACE FUNCTION catalog._effective_variant_name(p_variant_id bigint) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
    v_product_name text;
    v_override text;
    v_attr_str text;
BEGIN
    SELECT p.name, v.name_override
        INTO v_product_name, v_override
        FROM catalog.product_variants v
        JOIN catalog.products p ON p.id = v.product_id
        WHERE v.id = p_variant_id;

    IF btrim(coalesce(v_override, '')) <> '' THEN
        RETURN btrim(v_override);
    END IF;

    SELECT string_agg(av.value, ' - ' ORDER BY a.id, av.id)
        INTO v_attr_str
        FROM catalog.variant_attribute_values vav
        JOIN catalog.attribute_values av ON av.id = vav.attribute_value_id
        JOIN catalog.attributes a ON a.id = av.attribute_id
        WHERE vav.variant_id = p_variant_id;

    IF v_attr_str IS NOT NULL AND btrim(v_attr_str) <> '' THEN
        RETURN v_product_name || ' - ' || v_attr_str;
    ELSE
        RETURN v_product_name;
    END IF;
END;
$$;

-- 2. Make external_supplier_document_number optional in storage
ALTER TABLE procurement.purchase_transactions
    ALTER COLUMN external_supplier_document_number DROP NOT NULL;

-- 3. Repair catalog variant options read model
CREATE OR REPLACE FUNCTION procurement.list_purchase_product_options(
    p_session_token text
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
    SELECT user_id INTO v_user_id FROM iam.resolve_session(p_session_token);
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'SESSION_INVALID: Session is invalid or expired' USING ERRCODE = '28000';
    END IF;

    SELECT coalesce(jsonb_agg(
        jsonb_build_object(
            'product_id', p.id,
            'variant_id', pv.id,
            'sku', pv.sku,
            'product_name', p.name,
            'variant_name', catalog._effective_variant_name(pv.id),
            'primary_barcode', (
                SELECT barcode FROM catalog.variant_barcodes vb
                WHERE vb.variant_id = pv.id AND vb.is_primary = true
                LIMIT 1
            ),
            'brand', CASE WHEN b.id IS NOT NULL THEN jsonb_build_object('id', b.id, 'name', b.name) ELSE NULL END,
            'default_unit_id', u.id,
            'default_unit_code', u.code,
            'default_unit_name', u.name,
            'alternate_units', '[]'::jsonb,
            'attributes', coalesce((
                SELECT jsonb_agg(jsonb_build_object('name', a.name, 'value', val.value))
                FROM catalog.variant_attribute_values vav
                JOIN catalog.attribute_values val ON val.id = vav.attribute_value_id
                JOIN catalog.attributes a ON a.id = val.attribute_id
                WHERE vav.variant_id = pv.id
            ), '[]'::jsonb),
            'is_active', (p.is_active AND pv.is_active)
        ) ORDER BY p.name, pv.sku
    ), '[]'::jsonb) INTO v_result
    FROM catalog.product_variants pv
    JOIN catalog.products p ON p.id = pv.product_id
    JOIN catalog.units u ON u.id = p.unit_id
    LEFT JOIN catalog.brands b ON b.id = p.brand_id
    WHERE p.is_active = true AND pv.is_active = true;

    RETURN v_result;
END;
$$;

-- 4. Repair post_purchase_transaction RPC
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
    v_period_status text;
    v_period_start date;
    v_period_end date;
    v_fiscal_year integer;
    v_warehouse_id bigint;
    
    v_payment_status text;
    v_payment_method text;
    v_paid_amount numeric(14,2) := 0;
    v_outstanding_amount numeric(14,2) := 0;
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
    
    v_po_lines_json jsonb := '[]'::jsonb;
    v_rcpt_lines_json jsonb := '[]'::jsonb;
    v_inv_lines_json jsonb := '[]'::jsonb;
    
    v_root_doc_id bigint;
    v_root_doc_num text;
    v_po_doc_id bigint;
    v_po_doc_num text;
    v_rcpt_doc_id bigint;
    v_rcpt_doc_num text;
    v_inv_doc_id bigint;
    v_inv_doc_num text;
    v_pay_doc_id bigint := NULL;
    v_pay_doc_num text := NULL;
    v_liability_id bigint := NULL;
    v_landed_cost_doc_ids jsonb := '[]'::jsonb;
    
    v_add_costs jsonb;
    v_add_cost_item record;
    
    v_print_after boolean;
    v_gen_status text := 'NOT_ENQUEUED';
    v_print_status text := NULL;
    v_res jsonb;
BEGIN
    -- 1. Resolve Session & Permission
    SELECT user_id, workstation_id INTO v_user_id, v_workstation_id
    FROM iam.resolve_session_with_permission(p_session_token, 'POST_PURCHASE_TRANSACTION');

    -- 2. Idempotency Check
    v_existing_doc_id := core.reserve_idempotent_request(
        'procurement.post_purchase_transaction', p_request_id, p_request_hash
    );
    IF v_existing_doc_id IS NOT NULL THEN
        SELECT bd.document_number INTO v_root_doc_num
        FROM core.business_documents bd WHERE bd.id = v_existing_doc_id;

        SELECT jsonb_build_object(
            'document_id', pt.document_id,
            'document_number', v_root_doc_num,
            'status', 'POSTED',
            'supplier_id', pt.supplier_id,
            'warehouse_id', pt.warehouse_id,
            'gross_subtotal', pt.gross_subtotal::text,
            'discount_amount', '0.00',
            'tax_amount', '0.00',
            'total_amount', pt.total_amount::text,
            'payment_status', pt.payment_status,
            'payment_method', pt.payment_method,
            'paid_amount', pt.paid_amount::text,
            'outstanding_amount', pt.outstanding_amount::text,
            'due_date', pt.due_date,
            'child_documents', jsonb_build_object(
                'purchase_order_id', pt.purchase_order_id,
                'goods_receipt_id', pt.goods_receipt_id,
                'supplier_invoice_id', pt.supplier_invoice_id,
                'supplier_payment_id', pt.supplier_payment_id
            ),
            'generation_status', 'COMPLETED',
            'print_status', 'COMPLETED'
        ) INTO v_res
        FROM procurement.purchase_transactions pt
        WHERE pt.document_id = v_existing_doc_id;

        RETURN v_res;
    END IF;

    -- 3. Resolve Warehouse
    SELECT default_warehouse_id INTO v_warehouse_id FROM core.system_state WHERE id = 1;
    IF v_warehouse_id IS NULL THEN
        SELECT id INTO v_warehouse_id FROM inventory.warehouses WHERE is_active = true ORDER BY id LIMIT 1;
    END IF;
    IF v_warehouse_id IS NULL THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: No active default warehouse configured' USING ERRCODE = '55000';
    END IF;

    -- 4. Parse Header Payload
    v_supplier_id := (p_payload->>'supplier_id')::bigint;
    v_external_doc_num := trim(p_payload->>'external_supplier_document_number');
    IF v_external_doc_num = '' THEN
        v_external_doc_num := NULL;
    END IF;

    v_doc_date := (p_payload->>'document_date')::date;
    v_payment_status := p_payload->>'payment_status';
    v_payment_method := p_payload->>'payment_method';
    v_print_after := COALESCE((p_payload->>'print_after_confirmation')::boolean, true);

    IF v_supplier_id IS NULL OR v_supplier_id <= 0 THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Supplier is required' USING ERRCODE = '22023';
    END IF;
    IF v_doc_date IS NULL THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Document date is required' USING ERRCODE = '22023';
    END IF;
    IF v_payment_status NOT IN ('PAID', 'PARTIALLY_PAID', 'UNPAID') THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Invalid payment status' USING ERRCODE = '22023';
    END IF;

    -- Supplier validation & uniqueness check
    SELECT * INTO v_supplier_rec FROM procurement.suppliers WHERE id = v_supplier_id AND is_active = true;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Supplier does not exist or is inactive' USING ERRCODE = '22023';
    END IF;

    IF v_external_doc_num IS NOT NULL AND EXISTS (
        SELECT 1 FROM procurement.purchase_transactions
        WHERE supplier_id = v_supplier_id AND external_supplier_document_number = v_external_doc_num
    ) THEN
        RAISE EXCEPTION 'DUPLICATE_SUPPLIER_DOCUMENT: This supplier document has already been recorded' USING ERRCODE = '23505';
    END IF;

    -- 5. Resolve Fiscal Period
    v_fiscal_year := extract(year FROM v_doc_date)::integer;
    SELECT id, status, starts_on, ends_on
    INTO v_fiscal_period_id, v_period_status, v_period_start, v_period_end
    FROM finance.fiscal_periods
    WHERE status = 'OPEN' AND starts_on <= v_doc_date AND ends_on >= v_doc_date
    ORDER BY id DESC LIMIT 1;

    IF v_fiscal_period_id IS NULL THEN
        SELECT id, status, starts_on, ends_on
        INTO v_fiscal_period_id, v_period_status, v_period_start, v_period_end
        FROM finance.fiscal_periods WHERE status = 'OPEN' ORDER BY id DESC LIMIT 1;
    END IF;
    IF v_fiscal_period_id IS NULL THEN
        RAISE EXCEPTION 'CLOSED_FISCAL_PERIOD: No open fiscal period exists' USING ERRCODE = '55000';
    END IF;

    -- Ensure document date matches open fiscal period bounds
    IF v_doc_date < v_period_start THEN
        v_doc_date := v_period_start;
    ELSIF v_doc_date > v_period_end THEN
        v_doc_date := v_period_end;
    END IF;

    -- 6. Validate Lines & Recompute Totals
    v_lines := p_payload->'lines';
    IF v_lines IS NULL OR jsonb_typeof(v_lines) <> 'array' OR jsonb_array_length(v_lines) = 0 THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Purchase transaction must contain at least one product line' USING ERRCODE = '22023';
    END IF;

    FOR v_line_rec IN SELECT * FROM jsonb_to_recordset(v_lines) AS x(
        variant_id bigint,
        unit_id bigint,
        quantity numeric,
        unit_cost numeric
    ) LOOP
        v_line_idx := v_line_idx + 1;
        IF v_line_rec.variant_id IS NULL OR v_line_rec.variant_id <= 0 THEN
            RAISE EXCEPTION 'VALIDATION_ERROR: Line % has invalid variant', v_line_idx USING ERRCODE = '22023';
        END IF;
        IF v_line_rec.quantity IS NULL OR v_line_rec.quantity <= 0 THEN
            RAISE EXCEPTION 'VALIDATION_ERROR: Line % quantity must be positive', v_line_idx USING ERRCODE = '22023';
        END IF;
        IF v_line_rec.unit_cost IS NULL OR v_line_rec.unit_cost < 0 THEN
            RAISE EXCEPTION 'VALIDATION_ERROR: Line % unit cost cannot be negative', v_line_idx USING ERRCODE = '22023';
        END IF;

        DECLARE
            v_line_gross numeric(14,2) := round(v_line_rec.quantity * v_line_rec.unit_cost, 2);
        BEGIN
            v_gross_subtotal := v_gross_subtotal + v_line_gross;
        END;
    END LOOP;

    -- Calculate additional costs if provided
    v_add_costs := p_payload->'additional_costs';
    IF v_add_costs IS NOT NULL AND jsonb_typeof(v_add_costs) = 'array' AND jsonb_array_length(v_add_costs) > 0 THEN
        FOR v_add_cost_item IN SELECT * FROM jsonb_to_recordset(v_add_costs) AS c(cost_type text, amount numeric) LOOP
            IF v_add_cost_item.amount IS NOT NULL AND v_add_cost_item.amount > 0 THEN
                v_total_additional_cost := v_total_additional_cost + round(v_add_cost_item.amount, 2);
            END IF;
        END LOOP;
    END IF;

    v_grand_total := v_gross_subtotal + v_total_additional_cost;

    -- 7. Payment Logic & Session/Bank Validation
    IF v_payment_status = 'PAID' THEN
        IF v_payment_method NOT IN ('CASH', 'BANK_TRANSFER') THEN
            RAISE EXCEPTION 'VALIDATION_ERROR: Paid status requires Cash or Bank payment method' USING ERRCODE = '22023';
        END IF;
        v_paid_amount := v_grand_total;
        v_outstanding_amount := 0;
    ELSIF v_payment_status = 'PARTIALLY_PAID' THEN
        IF v_payment_method NOT IN ('CASH', 'BANK_TRANSFER') THEN
            RAISE EXCEPTION 'VALIDATION_ERROR: Partially Paid status requires Cash or Bank payment method' USING ERRCODE = '22023';
        END IF;
        v_paid_amount := COALESCE((p_payload->>'paid_amount')::numeric, 0);
        IF v_paid_amount <= 0 OR v_paid_amount >= v_grand_total THEN
            RAISE EXCEPTION 'VALIDATION_ERROR: Partially Paid amount must be greater than zero and less than total amount' USING ERRCODE = '22023';
        END IF;
        v_outstanding_amount := v_grand_total - v_paid_amount;
    ELSE -- UNPAID
        v_payment_method := NULL;
        v_paid_amount := 0;
        v_outstanding_amount := v_grand_total;
    END IF;

    IF v_payment_method = 'CASH' THEN
        v_require_cash_session := (core.get_setting('require_open_cash_session_for_purchase_cash_payment', 'true') = 'true');
        IF v_require_cash_session THEN
            SELECT cs.id INTO v_cash_session_id
            FROM sales.cash_sessions cs
            WHERE (cs.current_cashier_user_id = v_user_id OR cs.opened_by_user_id = v_user_id) AND cs.status = 'OPEN'
            ORDER BY cs.opened_at DESC LIMIT 1;

            IF v_cash_session_id IS NULL THEN
                RAISE EXCEPTION 'CASH_SESSION_REQUIRED: A cash session must be open before paying a supplier with cash' USING ERRCODE = '55000';
            END IF;
        END IF;
    ELSIF v_payment_method = 'BANK_TRANSFER' THEN
        v_default_bank_account := core.get_setting('default_purchase_bank_account', '');
        IF COALESCE(NULLIF(v_default_bank_account, ''), '') = '' THEN
            RAISE EXCEPTION 'default_purchase_bank_account setting is required for BANK_TRANSFER payments' USING ERRCODE = '55000';
        END IF;
    END IF;

    -- Due date resolution
    v_due_terms_days := COALESCE(NULLIF(core.get_setting('default_supplier_payment_terms', '30'), '')::integer, 30);
    v_due_date := v_doc_date + v_due_terms_days;

    -- 8. Create Internal Purchase Order (Draft + Confirm)
    DECLARE
        v_po_seq bigint := core.claim_next_document_number('PURCHASE_ORDER', v_fiscal_year);
    BEGIN
        v_po_doc_num := 'PO-' || v_fiscal_year || '-' || lpad(v_po_seq::text, 6, '0');
        INSERT INTO core.business_documents (document_type, sequence_number, document_number, status, document_date, fiscal_year, fiscal_period_id, posted_at)
        VALUES ('PURCHASE_ORDER', v_po_seq, v_po_doc_num, 'POSTED', v_doc_date, v_fiscal_year, v_fiscal_period_id, now())
        RETURNING id INTO v_po_doc_id;
    END;

    INSERT INTO procurement.purchase_orders (
        document_id, supplier_id, warehouse_id, status, subtotal, total_amount, note, created_by_user_id, confirmed_at, confirmed_by_user_id
    ) VALUES (
        v_po_doc_id, v_supplier_id, v_warehouse_id, 'CONFIRMED', v_gross_subtotal, v_gross_subtotal, p_payload->>'note', v_user_id, now(), v_user_id
    );

    -- Build lines for PO, Receipt, Invoice
    v_line_idx := 0;
    FOR v_line_rec IN SELECT * FROM jsonb_to_recordset(v_lines) AS x(
        variant_id bigint,
        unit_id bigint,
        quantity numeric,
        unit_cost numeric
    ) LOOP
        v_line_idx := v_line_idx + 1;
        DECLARE
            v_l_gross numeric(14,2) := round(v_line_rec.quantity * v_line_rec.unit_cost, 2);
            v_l_total numeric(14,2) := v_l_gross;
            v_po_line_id bigint;
            v_sku text;
            v_pname text;
            v_bname text;
            v_ucode text;
        BEGIN
            SELECT pv.sku, p.name, b.name, u.code
            INTO v_sku, v_pname, v_bname, v_ucode
            FROM catalog.product_variants pv
            JOIN catalog.products p ON p.id = pv.product_id
            JOIN catalog.units u ON u.id = COALESCE(v_line_rec.unit_id, p.unit_id)
            LEFT JOIN catalog.brands b ON b.id = p.brand_id
            WHERE pv.id = v_line_rec.variant_id;

            INSERT INTO procurement.purchase_order_lines (
                document_id, line_number, variant_id, unit_id, quantity_ordered, unit_cost, line_total
            ) VALUES (
                v_po_doc_id, v_line_idx, v_line_rec.variant_id, COALESCE(v_line_rec.unit_id, 1), v_line_rec.quantity, v_line_rec.unit_cost, v_l_gross
            ) RETURNING id INTO v_po_line_id;

            v_rcpt_lines_json := v_rcpt_lines_json || jsonb_build_object(
                'po_line_id', v_po_line_id,
                'quantity_received', v_line_rec.quantity::text
            );
        END;
    END LOOP;

    -- 9. Post Goods Receipt
    DECLARE
        v_rcpt_res jsonb;
    BEGIN
        v_rcpt_res := inventory.confirm_purchase_receipt(
            p_session_token,
            gen_random_uuid(),
            digest(jsonb_build_object('po_id', v_po_doc_id, 'rcpt_lines', v_rcpt_lines_json)::text, 'sha256'),
            v_po_doc_id,
            v_fiscal_period_id,
            v_doc_date,
            v_rcpt_lines_json
        );
        v_rcpt_doc_id := (v_rcpt_res->>'document_id')::bigint;
        v_rcpt_doc_num := v_rcpt_res->>'document_number';
    END;

    -- 10. Allocate Landed Costs if present
    IF v_total_additional_cost > 0 AND v_add_costs IS NOT NULL AND jsonb_typeof(v_add_costs) = 'array' THEN
        FOR v_add_cost_item IN SELECT * FROM jsonb_to_recordset(v_add_costs) AS c(cost_type text, amount numeric) LOOP
            IF v_add_cost_item.amount IS NOT NULL AND v_add_cost_item.amount > 0 THEN
                DECLARE
                    v_lc_res jsonb;
                BEGIN
                    v_lc_res := procurement.allocate_landed_cost(
                        p_session_token,
                        gen_random_uuid(),
                        digest(jsonb_build_object('rcpt_id', v_rcpt_doc_id, 'amount', v_add_cost_item.amount, 'type', v_add_cost_item.cost_type)::text, 'sha256'),
                        v_rcpt_doc_id,
                        'WEIGHT',
                        '["FREIGHT"]'::jsonb,
                        v_add_cost_item.amount,
                        v_add_cost_item.cost_type,
                        v_fiscal_period_id,
                        v_doc_date
                    );
                    v_landed_cost_doc_ids := v_landed_cost_doc_ids || (v_lc_res->'document_id');
                END;
            END IF;
        END LOOP;
    END IF;

    -- 11. Create & Confirm Supplier Invoice
    DECLARE
        v_inv_draft_res jsonb;
        v_inv_confirm_res jsonb;
    BEGIN
        SELECT coalesce(jsonb_agg(jsonb_build_object(
            'line_number', prl.line_number,
            'po_line_id', prl.po_line_id,
            'receipt_line_id', prl.id,
            'variant_id', prl.variant_id,
            'quantity', prl.quantity_received::text,
            'unit_cost', prl.unit_cost::text
        )), '[]'::jsonb) INTO v_inv_lines_json
        FROM procurement.purchase_receipt_lines prl
        WHERE prl.document_id = v_rcpt_doc_id;

        v_inv_draft_res := procurement.create_supplier_invoice_draft(
            p_session_token,
            v_supplier_id,
            v_po_doc_id,
            'DZD',
            1.0,
            p_payload->>'note',
            v_inv_lines_json
        );
        v_inv_doc_id := (v_inv_draft_res->>'document_id')::bigint;

        v_inv_confirm_res := procurement.confirm_supplier_invoice(
            p_session_token,
            gen_random_uuid(),
            digest(jsonb_build_object('inv_id', v_inv_doc_id)::text, 'sha256'),
            v_inv_doc_id,
            v_fiscal_period_id,
            v_doc_date
        );
        v_inv_doc_num := v_inv_confirm_res->>'document_number';

        SELECT id INTO v_liability_id
        FROM procurement.supplier_liabilities
        WHERE invoice_document_id = v_inv_doc_id;
    END;

    -- 12. Post Supplier Payment if applicable
    IF v_payment_status IN ('PAID', 'PARTIALLY_PAID') AND v_paid_amount > 0 THEN
        DECLARE
            v_pay_res jsonb;
        BEGIN
            v_pay_res := procurement.post_supplier_payment(
                p_session_token,
                gen_random_uuid(),
                digest(jsonb_build_object('liability_id', v_liability_id, 'amount', v_paid_amount)::text, 'sha256'),
                v_supplier_id,
                v_liability_id,
                v_paid_amount,
                v_payment_method,
                v_fiscal_period_id,
                v_doc_date,
                'Single-entry purchase payment'
            );
            v_pay_doc_id := (v_pay_res->>'document_id')::bigint;
            v_pay_doc_num := v_pay_res->>'document_number';
        END;
    END IF;

    -- 13. Create Root Business Document & Record Storage
    DECLARE
        v_root_seq bigint := core.claim_next_document_number('PURCHASE_TRANSACTION', v_fiscal_year);
    BEGIN
        v_root_doc_num := 'PUR-' || v_fiscal_year || '-' || lpad(v_root_seq::text, 6, '0');
        INSERT INTO core.business_documents (document_type, sequence_number, document_number, status, document_date, fiscal_year, fiscal_period_id, posted_at)
        VALUES ('PURCHASE_TRANSACTION', v_root_seq, v_root_doc_num, 'POSTED', v_doc_date, v_fiscal_year, v_fiscal_period_id, now())
        RETURNING id INTO v_root_doc_id;

        INSERT INTO procurement.purchase_transactions (
            document_id, supplier_id, warehouse_id, external_supplier_document_number,
            payment_status, payment_method, gross_subtotal, discount_amount, tax_amount, additional_cost_amount,
            total_amount, paid_amount, outstanding_amount, due_date,
            purchase_order_id, goods_receipt_id, supplier_invoice_id, supplier_payment_id,
            note, supplier_snapshot
        ) VALUES (
            v_root_doc_id, v_supplier_id, v_warehouse_id, v_external_doc_num,
            v_payment_status, v_payment_method, v_gross_subtotal, 0, 0, v_total_additional_cost,
            v_grand_total, v_paid_amount, v_outstanding_amount, v_due_date,
            v_po_doc_id, v_rcpt_doc_id, v_inv_doc_id, v_pay_doc_id,
            p_payload->>'note', jsonb_build_object('id', v_supplier_rec.id, 'code', v_supplier_rec.code, 'name', v_supplier_rec.name)
        );

        -- Insert Line Records
        v_line_idx := 0;
        FOR v_line_rec IN SELECT * FROM jsonb_to_recordset(v_lines) AS x(
            variant_id bigint,
            unit_id bigint,
            quantity numeric,
            unit_cost numeric
        ) LOOP
            v_line_idx := v_line_idx + 1;
            DECLARE
                v_l_gross numeric(14,2) := round(v_line_rec.quantity * v_line_rec.unit_cost, 2);
                v_l_total numeric(14,2) := v_l_gross;
                v_sku text;
                v_pname text;
                v_bname text;
                v_ucode text;
                v_attrs jsonb;
            BEGIN
                SELECT pv.sku, p.name, b.name, u.code,
                    coalesce((
                        SELECT jsonb_agg(jsonb_build_object('name', a.name, 'value', val.value))
                        FROM catalog.variant_attribute_values vav
                        JOIN catalog.attribute_values val ON val.id = vav.attribute_value_id
                        JOIN catalog.attributes a ON a.id = val.attribute_id
                        WHERE vav.variant_id = pv.id
                    ), '[]'::jsonb)
                INTO v_sku, v_pname, v_bname, v_ucode, v_attrs
                FROM catalog.product_variants pv
                JOIN catalog.products p ON p.id = pv.product_id
                JOIN catalog.units u ON u.id = COALESCE(v_line_rec.unit_id, p.unit_id)
                LEFT JOIN catalog.brands b ON b.id = p.brand_id
                WHERE pv.id = v_line_rec.variant_id;

                INSERT INTO procurement.purchase_transaction_lines (
                    document_id, line_number, variant_id, unit_id, quantity, unit_cost,
                    gross_amount, discount_amount, tax_amount, line_total,
                    sku_snapshot, product_name_snapshot, brand_snapshot, attributes_snapshot, unit_code_snapshot
                ) VALUES (
                    v_root_doc_id, v_line_idx, v_line_rec.variant_id, COALESCE(v_line_rec.unit_id, 1),
                    v_line_rec.quantity, v_line_rec.unit_cost,
                    v_l_gross, 0, 0, v_l_total,
                    v_sku, v_pname, v_bname, v_attrs, v_ucode
                );
            END;
        END LOOP;
    END;

    -- 14. Document Print Job Enqueue if requested
    IF v_print_after THEN
        PERFORM generation_job_id
        FROM documents.enqueue_business_document_jobs(
            v_root_doc_id,
            'PURCHASE_RECEIPT_PDF',
            'purchase_receipt:' || v_root_doc_id::text
        );
        v_gen_status := 'QUEUED';
        v_print_status := 'QUEUED';
    END IF;

    -- Return JSON Result
    SELECT jsonb_build_object(
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
            'purchase_order_id', v_po_doc_id,
            'goods_receipt_id', v_rcpt_doc_id,
            'supplier_invoice_id', v_inv_doc_id,
            'supplier_payment_id', v_pay_doc_id
        ),
        'generation_status', v_gen_status,
        'print_status', v_print_status
    ) INTO v_res;

    RETURN v_res;
END;
$$;

GRANT EXECUTE ON FUNCTION catalog._effective_variant_name(bigint) TO stockiha_runtime, stockiha_owner, public;
GRANT EXECUTE ON FUNCTION procurement.list_purchase_product_options(text) TO stockiha_runtime, stockiha_owner, public;
GRANT EXECUTE ON FUNCTION procurement.post_purchase_transaction(text, uuid, bytea, jsonb) TO stockiha_runtime, stockiha_owner, public;
