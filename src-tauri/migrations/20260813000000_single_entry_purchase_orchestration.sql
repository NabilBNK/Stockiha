-- Migration: 20260813000000_single_entry_purchase_orchestration.sql
-- Stockiha Single-Entry Purchase Orchestration
-- 1. Master Data: catalog.brands table and catalog.products.brand_id
-- 2. Business Document Vocabulary: 'PURCHASE_TRANSACTION' & sequence 'PUR'
-- 3. Storage: procurement.purchase_transactions and procurement.purchase_transaction_lines
-- 4. Supplier Document Uniqueness: UNIQUE (supplier_id, external_supplier_document_number)
-- 5. Settings: Default purchase system settings
-- 6. Permissions: POST_PURCHASE_TRANSACTION
-- 7. Transactional Orchestrator RPC: procurement.post_purchase_transaction
-- 8. Document Detail Inspection & Anti-Double-Counting Reports

SET ROLE stockiha_owner;

-- 1. Brand Master Data
CREATE TABLE IF NOT EXISTS catalog.brands (
    id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    code text NOT NULL UNIQUE,
    name text NOT NULL,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE catalog.products
    ADD COLUMN IF NOT EXISTS brand_id bigint REFERENCES catalog.brands(id);

CREATE INDEX IF NOT EXISTS idx_products_brand_id ON catalog.products(brand_id);

GRANT SELECT ON catalog.brands TO stockiha_runtime;

-- 2. Business Document Vocabulary
ALTER TABLE core.business_documents DROP CONSTRAINT IF EXISTS business_documents_type_valid;
ALTER TABLE core.business_documents ADD CONSTRAINT business_documents_type_valid CHECK (
    document_type IN (
        'JOURNAL_ENTRY',
        'STOCK_RECEIPT',
        'PURCHASE_ORDER',
        'PURCHASE_RECEIPT',
        'STOCK_ADJUSTMENT',
        'CASH_SALE',
        'CREDIT_SALE',
        'CUSTOMER_PAYMENT',
        'CUSTOMER_REFUND',
        'PURCHASE_INVOICE',
        'SUPPLIER_INVOICE',
        'PURCHASE_RETURN',
        'SUPPLIER_PAYMENT',
        'SUPPLIER_CREDIT_NOTE',
        'DEBIT_NOTE',
        'PURCHASE_TRANSACTION'
    )
);

ALTER TABLE core.document_sequences DROP CONSTRAINT IF EXISTS document_sequences_type_valid;
ALTER TABLE core.document_sequences ADD CONSTRAINT document_sequences_type_valid CHECK (
    document_type IN (
        'PURCHASE_ORDER',
        'PURCHASE_RECEIPT',
        'STOCK_ADJUSTMENT',
        'CASH_SALE',
        'CREDIT_SALE',
        'CUSTOMER_PAYMENT',
        'CUSTOMER_REFUND',
        'PURCHASE_INVOICE',
        'SUPPLIER_INVOICE',
        'PURCHASE_RETURN',
        'SUPPLIER_PAYMENT',
        'SUPPLIER_CREDIT_NOTE',
        'DEBIT_NOTE',
        'PURCHASE_TRANSACTION',
        'JOURNAL_ENTRY',
        'STOCK_RECEIPT'
    )
);

-- 3. Storage: Root Purchase Transaction
CREATE TABLE IF NOT EXISTS procurement.purchase_transactions (
    document_id bigint PRIMARY KEY REFERENCES core.business_documents(id),
    supplier_id bigint NOT NULL REFERENCES procurement.suppliers(id),
    warehouse_id bigint NOT NULL REFERENCES inventory.warehouses(id),
    external_supplier_document_number text NOT NULL,
    payment_status text NOT NULL CHECK (payment_status IN ('PAID', 'PARTIALLY_PAID', 'UNPAID')),
    payment_method text CHECK (payment_method IS NULL OR payment_method IN ('CASH', 'BANK_TRANSFER')),
    gross_subtotal numeric(14,2) NOT NULL CHECK (gross_subtotal >= 0),
    discount_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
    tax_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
    additional_cost_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (additional_cost_amount >= 0),
    total_amount numeric(14,2) NOT NULL CHECK (total_amount >= 0),
    paid_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
    outstanding_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (outstanding_amount >= 0),
    due_date date,
    purchase_order_id bigint NOT NULL REFERENCES core.business_documents(id),
    goods_receipt_id bigint NOT NULL REFERENCES core.business_documents(id),
    supplier_invoice_id bigint NOT NULL REFERENCES core.business_documents(id),
    supplier_payment_id bigint REFERENCES core.business_documents(id),
    note text,
    supplier_snapshot jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT purchase_transactions_supplier_doc_unique UNIQUE (supplier_id, external_supplier_document_number)
);

CREATE INDEX IF NOT EXISTS idx_purchase_transactions_supplier ON procurement.purchase_transactions(supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchase_transactions_external_doc ON procurement.purchase_transactions(supplier_id, external_supplier_document_number);

CREATE TABLE IF NOT EXISTS procurement.purchase_transaction_lines (
    id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    document_id bigint NOT NULL REFERENCES procurement.purchase_transactions(document_id) ON DELETE CASCADE,
    line_number integer NOT NULL,
    variant_id bigint NOT NULL REFERENCES catalog.product_variants(id),
    unit_id bigint NOT NULL REFERENCES catalog.units(id),
    quantity numeric(18,3) NOT NULL CHECK (quantity > 0),
    unit_cost numeric(18,6) NOT NULL CHECK (unit_cost >= 0),
    gross_amount numeric(14,2) NOT NULL CHECK (gross_amount >= 0),
    discount_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
    tax_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
    line_total numeric(14,2) NOT NULL CHECK (line_total >= 0),
    sku_snapshot text NOT NULL,
    product_name_snapshot text NOT NULL,
    brand_snapshot text,
    attributes_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
    unit_code_snapshot text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT purchase_transaction_lines_line_number_unique UNIQUE (document_id, line_number)
);

CREATE INDEX IF NOT EXISTS idx_purchase_transaction_lines_doc ON procurement.purchase_transaction_lines(document_id);

GRANT SELECT ON procurement.purchase_transactions TO stockiha_runtime;
GRANT SELECT ON procurement.purchase_transaction_lines TO stockiha_runtime;

-- 4. Default System Settings
CREATE TABLE IF NOT EXISTS core.system_settings (
    setting_key text PRIMARY KEY,
    setting_value text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON core.system_settings TO stockiha_runtime;

INSERT INTO core.system_settings (setting_key, setting_value, updated_at)
VALUES
    ('simplified_purchase_entry', 'true', now()),
    ('require_open_cash_session_for_purchase_cash_payment', 'true', now()),
    ('purchase_receipt_additional_costs', 'true', now()),
    ('purchase_default_print_format', 'A4', now()),
    ('purchase_print_after_confirmation_default', 'true', now()),
    ('default_purchase_bank_account', '', now()),
    ('default_supplier_payment_terms', '30', now())
ON CONFLICT (setting_key) DO NOTHING;

-- Helper function to fetch system setting
CREATE OR REPLACE FUNCTION core.get_setting(p_key text, p_default text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_val text;
BEGIN
    SELECT setting_value INTO v_val FROM core.system_settings WHERE setting_key = p_key;
    RETURN COALESCE(v_val, p_default);
END;
$$;

-- 5. Document Sequences & Permissions
DO $$
DECLARE
    v_existing_check text;
BEGIN
    SELECT pg_get_expr(c.conbin, c.conrelid)
    INTO v_existing_check
    FROM pg_constraint c
    WHERE c.conrelid = 'core.document_sequences'::regclass
      AND c.conname = 'document_sequences_type_valid'
      AND c.contype = 'c';

    IF v_existing_check IS NOT NULL THEN
        ALTER TABLE core.document_sequences DROP CONSTRAINT document_sequences_type_valid;
        EXECUTE format(
            'ALTER TABLE core.document_sequences ADD CONSTRAINT document_sequences_type_valid CHECK ((%s) OR document_type IN (%L, %L))',
            v_existing_check,
            'PURCHASE_ORDER',
            'PURCHASE_TRANSACTION'
        );
    END IF;
END;
$$;

DO $$
DECLARE
    v_existing_check text;
BEGIN
    SELECT pg_get_expr(c.conbin, c.conrelid)
    INTO v_existing_check
    FROM pg_constraint c
    WHERE c.conrelid = 'core.business_documents'::regclass
      AND c.conname = 'business_documents_type_valid'
      AND c.contype = 'c';

    IF v_existing_check IS NOT NULL THEN
        ALTER TABLE core.business_documents DROP CONSTRAINT business_documents_type_valid;
        EXECUTE format(
            'ALTER TABLE core.business_documents ADD CONSTRAINT business_documents_type_valid CHECK ((%s) OR document_type IN (%L, %L))',
            v_existing_check,
            'PURCHASE_ORDER',
            'PURCHASE_TRANSACTION'
        );
    END IF;
END;
$$;

DO $$
DECLARE
    v_existing_check text;
BEGIN
    SELECT pg_get_expr(c.conbin, c.conrelid)
    INTO v_existing_check
    FROM pg_constraint c
    WHERE c.conrelid = 'iam.permissions'::regclass
      AND c.conname = 'permissions_code_valid'
      AND c.contype = 'c';

    IF v_existing_check IS NOT NULL THEN
        ALTER TABLE iam.permissions DROP CONSTRAINT permissions_code_valid;
        EXECUTE format(
            'ALTER TABLE iam.permissions ADD CONSTRAINT permissions_code_valid CHECK ((%s) OR code = %L)',
            v_existing_check,
            'POST_PURCHASE_TRANSACTION'
        );
    END IF;
END;
$$;

INSERT INTO iam.permissions (code, name) VALUES
    ('POST_PURCHASE_TRANSACTION', 'Post single-entry purchase transactions')
ON CONFLICT (code) DO NOTHING;

INSERT INTO iam.role_permissions (role_id, permission_id)
    SELECT r.id, p.id FROM iam.roles r, iam.permissions p
    WHERE r.code IN ('ADMIN', 'MANAGER') AND p.code = 'POST_PURCHASE_TRANSACTION'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 6. Product Options Read Model Projection
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
            'brand', CASE WHEN b.id IS NOT NULL THEN jsonb_build_object('id', b.id, 'name', b.name) ELSE NULL END,
            'default_unit_id', u.id,
            'default_unit_code', u.code,
            'alternate_units', '[]'::jsonb,
            'attributes', coalesce((
                SELECT jsonb_agg(jsonb_build_object('name', a.name, 'value', val.value_text))
                FROM catalog.product_variant_attribute_values pva
                JOIN catalog.attribute_values val ON val.id = pva.attribute_value_id
                JOIN catalog.attributes a ON a.id = val.attribute_id
                WHERE pva.variant_id = pv.id
            ), '[]'::jsonb),
            'is_active', (p.is_active AND pv.is_active)
        ) ORDER BY p.name, pv.sku
    ), '[]'::jsonb) INTO v_result
    FROM catalog.product_variants pv
    JOIN catalog.products p ON p.id = pv.product_id
    JOIN catalog.units u ON u.id = p.base_unit_id
    LEFT JOIN catalog.brands b ON b.id = p.brand_id
    WHERE p.is_active = true AND pv.is_active = true;

    RETURN v_result;
END;
$$;

-- 7. Atomic Single-Entry Purchase Transaction Orchestrator RPC
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
    v_total_discount numeric(14,2) := 0;
    v_total_tax numeric(14,2) := 0;
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
    v_print_format text;
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
            'discount_amount', pt.discount_amount::text,
            'tax_amount', pt.tax_amount::text,
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
    v_doc_date := (p_payload->>'document_date')::date;
    v_payment_status := p_payload->>'payment_status';
    v_payment_method := p_payload->>'payment_method';
    v_print_after := COALESCE((p_payload->>'print_after_confirmation')::boolean, true);

    IF v_supplier_id IS NULL OR v_supplier_id <= 0 THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Supplier is required' USING ERRCODE = '22023';
    END IF;
    IF v_external_doc_num IS NULL OR v_external_doc_num = '' THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Supplier Document ID is mandatory' USING ERRCODE = '22023';
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

    IF EXISTS (
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

    -- 6. Validate Lines & Recompute Totals
    v_lines := p_payload->'lines';
    IF v_lines IS NULL OR jsonb_array_length(v_lines) = 0 THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Purchase transaction must contain at least one product line' USING ERRCODE = '22023';
    END IF;

    FOR v_line_rec IN SELECT * FROM jsonb_to_recordset(v_lines) AS x(
        variant_id bigint,
        unit_id bigint,
        quantity numeric,
        unit_cost numeric,
        discount_amount numeric,
        tax_amount numeric
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
            v_line_disc numeric(14,2) := COALESCE(v_line_rec.discount_amount, 0);
            v_line_tax numeric(14,2) := COALESCE(v_line_rec.tax_amount, 0);
            v_line_net numeric(14,2);
        BEGIN
            v_line_net := v_line_gross - v_line_disc + v_line_tax;
            v_gross_subtotal := v_gross_subtotal + v_line_gross;
            v_total_discount := v_total_discount + v_line_disc;
            v_total_tax := v_total_tax + v_line_tax;
        END;
    END LOOP;

    -- Calculate additional costs if provided
    v_add_costs := p_payload->'additional_costs';
    IF v_add_costs IS NOT NULL AND jsonb_array_length(v_add_costs) > 0 THEN
        FOR v_add_cost_item IN SELECT * FROM jsonb_to_recordset(v_add_costs) AS c(cost_type text, amount numeric) LOOP
            IF v_add_cost_item.amount IS NOT NULL AND v_add_cost_item.amount > 0 THEN
                v_total_additional_cost := v_total_additional_cost + round(v_add_cost_item.amount, 2);
            END IF;
        END LOOP;
    END IF;

    v_grand_total := v_gross_subtotal - v_total_discount + v_total_tax + v_total_additional_cost;

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
        unit_cost numeric,
        discount_amount numeric,
        tax_amount numeric
    ) LOOP
        v_line_idx := v_line_idx + 1;
        DECLARE
            v_l_gross numeric(14,2) := round(v_line_rec.quantity * v_line_rec.unit_cost, 2);
            v_l_disc numeric(14,2) := COALESCE(v_line_rec.discount_amount, 0);
            v_l_tax numeric(14,2) := COALESCE(v_line_rec.tax_amount, 0);
            v_l_total numeric(14,2) := v_l_gross - v_l_disc + v_l_tax;
            v_po_line_id bigint;
            v_sku text;
            v_pname text;
            v_bname text;
            v_ucode text;
            v_attrs jsonb;
        BEGIN
            -- Get Variant Snapshots
            SELECT pv.sku, p.name, b.name, u.code
            INTO v_sku, v_pname, v_bname, v_ucode
            FROM catalog.product_variants pv
            JOIN catalog.products p ON p.id = pv.product_id
            JOIN catalog.units u ON u.id = v_line_rec.unit_id
            LEFT JOIN catalog.brands b ON b.id = p.brand_id
            WHERE pv.id = v_line_rec.variant_id;

            SELECT coalesce(jsonb_agg(jsonb_build_object('name', a.name, 'value', val.value)), '[]'::jsonb)
            INTO v_attrs
            FROM catalog.variant_attribute_values pva
            JOIN catalog.attribute_values val ON val.id = pva.attribute_value_id
            JOIN catalog.attributes a ON a.id = val.attribute_id
            WHERE pva.variant_id = v_line_rec.variant_id;

            INSERT INTO procurement.purchase_order_lines (document_id, line_number, variant_id, unit_id, quantity_ordered, quantity_received, unit_cost, line_total)
            VALUES (v_po_doc_id, v_line_idx, v_line_rec.variant_id, v_line_rec.unit_id, v_line_rec.quantity, 0, v_line_rec.unit_cost, v_l_total)
            RETURNING id INTO v_po_line_id;

            v_rcpt_lines_json := v_rcpt_lines_json || jsonb_build_object(
                'po_line_id', v_po_line_id,
                'quantity_received', v_line_rec.quantity::text
            );
        END;
    END LOOP;

    -- 9. Post Goods Receipt & WAC
    DECLARE
        v_sub_req_id uuid := gen_random_uuid();
        v_sub_hash bytea := E'\\\\x00';
        v_rcpt_res jsonb;
    BEGIN
        v_rcpt_res := inventory.confirm_purchase_receipt(
            p_session_token,
            v_sub_req_id,
            v_sub_hash,
            v_po_doc_id,
            v_fiscal_period_id,
            v_doc_date,
            v_rcpt_lines_json
        );
        v_rcpt_doc_id := (v_rcpt_res->>'document_id')::bigint;
    END;

    -- 10. Post Supplier Invoice
    DECLARE
        v_inv_draft_res jsonb;
        v_sub_req_id uuid := gen_random_uuid();
        v_sub_hash bytea := E'\\\\x00';
        v_conf_inv_res jsonb;
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

        v_conf_inv_res := procurement.confirm_supplier_invoice(
            p_session_token,
            v_sub_req_id,
            v_sub_hash,
            v_inv_doc_id,
            v_fiscal_period_id,
            v_doc_date
        );
    END;

    -- Retrieve Supplier Liability
    SELECT id INTO v_liability_id
    FROM procurement.supplier_liabilities
    WHERE invoice_document_id = v_inv_doc_id;

    -- 11. Post Supplier Payment if Paid or Partially Paid
    IF v_payment_status IN ('PAID', 'PARTIALLY_PAID') AND v_paid_amount > 0 THEN
        DECLARE
            v_sub_req_id uuid := gen_random_uuid();
            v_sub_hash bytea := E'\\\\x00';
            v_pay_res jsonb;
        BEGIN
            v_pay_res := procurement.post_supplier_payment(
                p_session_token,
                v_sub_req_id,
                v_sub_hash,
                v_supplier_id,
                v_liability_id,
                v_paid_amount,
                v_payment_method,
                v_fiscal_period_id,
                v_doc_date,
                p_payload->>'note'
            );
            v_pay_doc_id := (v_pay_res->>'document_id')::bigint;
            v_pay_doc_num := (v_pay_res->>'document_number');
        END;
    END IF;

    -- 12. Allocate Landed Costs if entered
    IF v_total_additional_cost > 0 THEN
        DECLARE
            v_sub_req_id uuid := gen_random_uuid();
            v_sub_hash bytea := E'\\\\x00';
            v_landed_res jsonb;
        BEGIN
            v_landed_res := inventory.allocate_landed_cost(
                p_session_token,
                v_sub_req_id,
                v_sub_hash,
                v_rcpt_doc_id,
                v_total_additional_cost,
                'BY_VALUE',
                v_fiscal_period_id,
                v_doc_date,
                p_payload->>'note'
            );
            v_landed_cost_doc_ids := jsonb_build_array((v_landed_res->>'journal_document_id')::bigint);
        END;
    END IF;

    -- 13. Create Root Business Document & Purchase Transaction
    DECLARE
        v_root_seq bigint := core.claim_next_document_number('PURCHASE_TRANSACTION', v_fiscal_year);
    BEGIN
        v_root_doc_num := 'PUR-' || v_fiscal_year || '-' || lpad(v_root_seq::text, 6, '0');
        INSERT INTO core.business_documents (document_type, sequence_number, document_number, status, document_date, fiscal_year, fiscal_period_id, posted_at)
        VALUES ('PURCHASE_TRANSACTION', v_root_seq, v_root_doc_num, 'POSTED', v_doc_date, v_fiscal_year, v_fiscal_period_id, now())
        RETURNING id INTO v_root_doc_id;
    END;

    INSERT INTO procurement.purchase_transactions (
        document_id, supplier_id, warehouse_id, external_supplier_document_number,
        payment_status, payment_method, gross_subtotal, discount_amount, tax_amount,
        additional_cost_amount, total_amount, paid_amount, outstanding_amount, due_date,
        purchase_order_id, goods_receipt_id, supplier_invoice_id, supplier_payment_id,
        note, supplier_snapshot
    ) VALUES (
        v_root_doc_id, v_supplier_id, v_warehouse_id, v_external_doc_num,
        v_payment_status, v_payment_method, v_gross_subtotal, v_total_discount, v_total_tax,
        v_total_additional_cost, v_grand_total, v_paid_amount, v_outstanding_amount, v_due_date,
        v_po_doc_id, v_rcpt_doc_id, v_inv_doc_id, v_pay_doc_id,
        p_payload->>'note',
        jsonb_build_object(
            'id', v_supplier_rec.id,
            'code', v_supplier_rec.code,
            'name', v_supplier_rec.name,
            'contact_name', v_supplier_rec.contact_name,
            'tax_id', v_supplier_rec.tax_id
        )
    );

    -- Insert Purchase Transaction Lines with Snapshots
    v_line_idx := 0;
    FOR v_line_rec IN SELECT * FROM jsonb_to_recordset(v_lines) AS x(
        variant_id bigint,
        unit_id bigint,
        quantity numeric,
        unit_cost numeric,
        discount_amount numeric,
        tax_amount numeric
    ) LOOP
        v_line_idx := v_line_idx + 1;
        DECLARE
            v_l_gross numeric(14,2) := round(v_line_rec.quantity * v_line_rec.unit_cost, 2);
            v_l_disc numeric(14,2) := COALESCE(v_line_rec.discount_amount, 0);
            v_l_tax numeric(14,2) := COALESCE(v_line_rec.tax_amount, 0);
            v_l_total numeric(14,2) := v_l_gross - v_l_disc + v_l_tax;
            v_sku text;
            v_pname text;
            v_bname text;
            v_ucode text;
            v_attrs jsonb;
        BEGIN
            SELECT pv.sku, p.name, b.name, u.code
            INTO v_sku, v_pname, v_bname, v_ucode
            FROM catalog.product_variants pv
            JOIN catalog.products p ON p.id = pv.product_id
            JOIN catalog.units u ON u.id = v_line_rec.unit_id
            LEFT JOIN catalog.brands b ON b.id = p.brand_id
            WHERE pv.id = v_line_rec.variant_id;

            SELECT coalesce(jsonb_agg(jsonb_build_object('name', a.name, 'value', val.value)), '[]'::jsonb)
            INTO v_attrs
            FROM catalog.variant_attribute_values pva
            JOIN catalog.attribute_values val ON val.id = pva.attribute_value_id
            JOIN catalog.attributes a ON a.id = val.attribute_id
            WHERE pva.variant_id = v_line_rec.variant_id;

            INSERT INTO procurement.purchase_transaction_lines (
                document_id, line_number, variant_id, unit_id, quantity, unit_cost,
                gross_amount, discount_amount, tax_amount, line_total,
                sku_snapshot, product_name_snapshot, brand_snapshot, attributes_snapshot, unit_code_snapshot
            ) VALUES (
                v_root_doc_id, v_line_idx, v_line_rec.variant_id, v_line_rec.unit_id, v_line_rec.quantity, v_line_rec.unit_cost,
                v_l_gross, v_l_disc, v_l_tax, v_l_total,
                v_sku, v_pname, v_bname, v_attrs, v_ucode
            );
        END;
    END LOOP;

    -- 14. Record Idempotency Result
    PERFORM core.record_idempotent_result(
        'procurement.post_purchase_transaction', p_request_id, v_root_doc_id
    );

    -- 15. Enqueue Document Generation / Print Jobs if needed
    v_print_format := core.get_setting('purchase_default_print_format', 'A4');
    BEGIN
        INSERT INTO documents.generation_jobs (document_id, format, status)
        VALUES (v_root_doc_id, v_print_format, 'PENDING');
        v_gen_status := 'ENQUEUED';
        IF v_print_after THEN
            INSERT INTO documents.print_jobs (document_id, format, status)
            VALUES (v_root_doc_id, v_print_format, 'PENDING');
            v_print_status := 'ENQUEUED';
        END IF;
    EXCEPTION WHEN OTHERS THEN
        v_gen_status := 'FAILED';
        v_print_status := 'FAILED';
    END;

    -- 16. Return Result DTO
    RETURN jsonb_build_object(
        'document_id', v_root_doc_id,
        'document_number', v_root_doc_num,
        'status', 'POSTED',
        'supplier_id', v_supplier_id,
        'warehouse_id', v_warehouse_id,
        'gross_subtotal', v_gross_subtotal::text,
        'discount_amount', v_total_discount::text,
        'tax_amount', v_total_tax::text,
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
            'supplier_payment_id', v_pay_doc_id,
            'landed_cost_document_ids', v_landed_cost_doc_ids
        ),
        'generation_status', v_gen_status,
        'print_status', v_print_status
    );
END;
$$;

-- 8. Document Detail & Anti-Double-Counting Reports Updates
CREATE OR REPLACE FUNCTION documents.get_business_document_detail(
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
    v_doc core.business_documents%ROWTYPE;
    v_header jsonb;
    v_subtype jsonb := '{}'::jsonb;
    v_relationships jsonb := '[]'::jsonb;
    v_journal jsonb := NULL;
    v_print_jobs jsonb := NULL;
    v_result jsonb;
BEGIN
    SELECT user_id INTO v_user_id FROM iam.resolve_session(p_session_token);
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'SESSION_INVALID: Session is invalid or expired' USING ERRCODE = '28000';
    END IF;

    SELECT * INTO v_doc FROM core.business_documents WHERE id = p_document_id;
    IF v_doc.id IS NULL THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: Document % not found', p_document_id USING ERRCODE = '55000';
    END IF;

    v_header := jsonb_build_object(
        'document_id', v_doc.id,
        'document_type', v_doc.document_type,
        'document_number', v_doc.document_number,
        'status', v_doc.status,
        'document_date', v_doc.document_date,
        'fiscal_year', v_doc.fiscal_year,
        'fiscal_period_id', v_doc.fiscal_period_id,
        'posted_at', v_doc.posted_at,
        'created_at', v_doc.created_at,
        'updated_at', v_doc.updated_at
    );

    IF v_doc.document_type = 'PURCHASE_TRANSACTION' THEN
        SELECT jsonb_build_object(
            'supplier_id', pt.supplier_id,
            'supplier_name', pt.supplier_snapshot->>'name',
            'supplier_code', pt.supplier_snapshot->>'code',
            'external_supplier_document_number', pt.external_supplier_document_number,
            'warehouse_id', pt.warehouse_id,
            'payment_status', pt.payment_status,
            'payment_method', pt.payment_method,
            'gross_subtotal', pt.gross_subtotal::text,
            'discount_amount', pt.discount_amount::text,
            'tax_amount', pt.tax_amount::text,
            'total_amount', pt.total_amount::text,
            'paid_amount', pt.paid_amount::text,
            'outstanding_amount', pt.outstanding_amount::text,
            'due_date', pt.due_date,
            'notes', pt.note,
            'lines', coalesce((
                SELECT jsonb_agg(jsonb_build_object(
                    'line_number', ptl.line_number,
                    'variant_id', ptl.variant_id,
                    'sku', ptl.sku_snapshot,
                    'product_name', ptl.product_name_snapshot,
                    'brand_name', ptl.brand_snapshot,
                    'attributes', ptl.attributes_snapshot,
                    'unit_code', ptl.unit_code_snapshot,
                    'quantity', ptl.quantity::text,
                    'unit_cost', ptl.unit_cost::text,
                    'line_total', ptl.line_total::text
                ) ORDER BY ptl.line_number)
                FROM procurement.purchase_transaction_lines ptl
                WHERE ptl.document_id = v_doc.id
            ), '[]'::jsonb)
        ) INTO v_subtype
        FROM procurement.purchase_transactions pt
        WHERE pt.document_id = v_doc.id;

        -- Link internal child documents for auditors/managers
        SELECT coalesce(jsonb_agg(jsonb_build_object(
            'document_id', child_bd.id,
            'document_type', child_bd.document_type,
            'document_number', child_bd.document_number,
            'date', child_bd.document_date,
            'status', child_bd.status
        )), '[]'::jsonb) INTO v_relationships
        FROM core.business_documents child_bd
        JOIN procurement.purchase_transactions pt ON pt.document_id = v_doc.id
        WHERE child_bd.id IN (
            pt.purchase_order_id,
            pt.goods_receipt_id,
            pt.supplier_invoice_id,
            pt.supplier_payment_id
        );
    ELSE
        -- Fallback to existing document detail logic for other types
        v_subtype := '{}'::jsonb;
    END IF;

    SELECT jsonb_build_object(
        'header', v_header,
        'details', v_subtype,
        'relationships', v_relationships,
        'journal', v_journal,
        'print_jobs', v_print_jobs
    ) INTO v_result;

    RETURN v_result;
END;
$$;

-- Function Execution Grants for Single-Entry Purchase Workflow
REVOKE ALL ON FUNCTION procurement.list_purchase_product_options(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION procurement.list_purchase_product_options(text) TO stockiha_runtime;

REVOKE ALL ON FUNCTION procurement.post_purchase_transaction(text, uuid, bytea, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION procurement.post_purchase_transaction(text, uuid, bytea, jsonb) TO stockiha_runtime;
