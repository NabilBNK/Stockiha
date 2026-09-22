-- WS-L-001: Journals & Documents — fixed, findable, attributable.
--   1. SUPER_ADMIN holds every permission, now and in future.
--   2. core.business_documents records who created each document and where.
--   3. documents.get_business_document_detail rebuilt (was empty for all types).
--   4. documents.search_business_documents: server-side filters + pagination.
--   5. finance.search_journals: server-side filters + pagination.
--   6. finance.get_journal_detail: correct source link, account names, author.
--   7. documents.get_business_document_reports: correct journal link.
-- A journal belongs to a document only when source_type = document_type.
-- Fully idempotent (re-applied by the WS-K-5 safe-upgrade fixture).

SET ROLE stockiha_owner;

-- Section 1: SUPER_ADMIN holds every permission, now and in future.
INSERT INTO iam.role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM iam.roles role
CROSS JOIN iam.permissions permission
WHERE role.code = 'SUPER_ADMIN'
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION iam.grant_new_permission_to_super_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    INSERT INTO iam.role_permissions (role_id, permission_id)
    SELECT role.id, NEW.id
    FROM iam.roles role
    WHERE role.code = 'SUPER_ADMIN'
    ON CONFLICT DO NOTHING;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER permissions_grant_super_admin
    AFTER INSERT ON iam.permissions
    FOR EACH ROW EXECUTE FUNCTION iam.grant_new_permission_to_super_admin();

REVOKE ALL ON FUNCTION iam.grant_new_permission_to_super_admin() FROM PUBLIC;

-- Section 2: who created each document.
ALTER TABLE core.business_documents
    ADD COLUMN IF NOT EXISTS created_by_user_id bigint REFERENCES iam.users (id) ON DELETE RESTRICT;
ALTER TABLE core.business_documents
    ADD COLUMN IF NOT EXISTS created_on_workstation_id text;

CREATE OR REPLACE FUNCTION core.capture_business_document_actor()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
    v_actor text;
BEGIN
    IF NEW.created_by_user_id IS NULL THEN
        v_actor := nullif(current_setting('stockiha.actor_user_id', true), '');
        IF v_actor IS NOT NULL AND v_actor ~ '^[0-9]+$' THEN
            NEW.created_by_user_id := v_actor::bigint;
        END IF;
    END IF;
    IF NEW.created_on_workstation_id IS NULL THEN
        NEW.created_on_workstation_id := nullif(current_setting('stockiha.actor_workstation_id', true), '');
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER business_documents_capture_actor
    BEFORE INSERT ON core.business_documents
    FOR EACH ROW EXECUTE FUNCTION core.capture_business_document_actor();

REVOKE ALL ON FUNCTION core.capture_business_document_actor() FROM PUBLIC;

-- Section 3: rebuild documents.get_business_document_detail. Base: the
-- complete 20260812120000 function. Edits E1-E7 per the WS-L-1 brief:
-- E1 header carries created_by_username/created_on_workstation_id; E2 the
-- CASH_SALE branch drops the non-existent workstation_id column and adds
-- subtotal/discount_amount; E3 restores the PURCHASE_TRANSACTION branch
-- (copied verbatim from 20260813000000); E4 adds a SALE_VOID branch; E5
-- links a cancelled document and its cancellation both ways; E6 the linked
-- journal lookup matches on source_type = document_type; E7 the output key
-- stays subtype_detail.
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
    -- Authenticate session
    SELECT user_id INTO v_user_id
    FROM iam.resolve_session(p_session_token);
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'SESSION_INVALID: Session is invalid or expired' USING ERRCODE = '28000';
    END IF;

    -- Fetch header
    SELECT * INTO v_doc
    FROM core.business_documents
    WHERE id = p_document_id;

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
        'updated_at', v_doc.updated_at,
        'created_by_username', (SELECT u.username FROM iam.users u WHERE u.id = v_doc.created_by_user_id),
        'created_on_workstation_id', v_doc.created_on_workstation_id
    );

    -- Type-specific details & relationship loading
    IF v_doc.document_type = 'PURCHASE_ORDER' THEN
        SELECT jsonb_build_object(
            'supplier_id', po.supplier_id,
            'supplier_code', s.code,
            'supplier_name', s.name,
            'warehouse_id', po.warehouse_id,
            'warehouse_code', w.code,
            'warehouse_name', w.name,
            'notes', po.note,
            'total_amount', po.total_amount::text,
            'lines', coalesce((
                SELECT jsonb_agg(jsonb_build_object(
                    'line_number', pol.line_number,
                    'variant_id', pol.variant_id,
                    'sku', pv.sku,
                    'product_name', p.name,
                    'unit_code', u.code,
                    'ordered_quantity', pol.quantity_ordered::text,
                    'unit_cost', pol.unit_cost::text,
                    'line_total', pol.line_total::text
                ) ORDER BY pol.line_number)
                FROM procurement.purchase_order_lines pol
                JOIN catalog.product_variants pv ON pv.id = pol.variant_id
                JOIN catalog.products p ON p.id = pv.product_id
                JOIN catalog.units u ON u.id = pol.unit_id
                WHERE pol.document_id = v_doc.id
            ), '[]'::jsonb)
        ) INTO v_subtype
        FROM procurement.purchase_orders po
        JOIN procurement.suppliers s ON s.id = po.supplier_id
        JOIN inventory.warehouses w ON w.id = po.warehouse_id
        WHERE po.document_id = v_doc.id;

        -- Related receipts & invoices
        SELECT coalesce(jsonb_agg(jsonb_build_object(
            'document_id', r_bd.id,
            'document_type', r_bd.document_type,
            'document_number', r_bd.document_number,
            'date', r_bd.document_date,
            'status', r_bd.status
        )), '[]'::jsonb) INTO v_relationships
        FROM core.business_documents r_bd
        WHERE r_bd.id IN (
            SELECT pr.document_id FROM procurement.purchase_receipts pr WHERE pr.purchase_order_id = v_doc.id
            UNION
            SELECT si.document_id FROM procurement.supplier_invoices si WHERE si.purchase_order_id = v_doc.id
            UNION
            SELECT sr.document_id FROM procurement.supplier_returns sr WHERE sr.purchase_order_id = v_doc.id
        );

    ELSIF v_doc.document_type = 'PURCHASE_RECEIPT' THEN
        SELECT jsonb_build_object(
            'purchase_order_id', pr.purchase_order_id,
            'purchase_order_number', po_bd.document_number,
            'supplier_id', pr.supplier_id,
            'supplier_name', s.name,
            'warehouse_id', pr.warehouse_id,
            'warehouse_name', w.name,
            'total_amount', pr.total_amount::text,
            'lines', coalesce((
                SELECT jsonb_agg(jsonb_build_object(
                    'line_number', prl.line_number,
                    'variant_id', prl.variant_id,
                    'sku', pv.sku,
                    'product_name', p.name,
                    'received_quantity', prl.quantity_received::text,
                    'unit_cost', prl.unit_cost::text,
                    'line_total', prl.line_total::text
                ) ORDER BY prl.line_number)
                FROM procurement.purchase_receipt_lines prl
                JOIN catalog.product_variants pv ON pv.id = prl.variant_id
                JOIN catalog.products p ON p.id = pv.product_id
                WHERE prl.document_id = v_doc.id
            ), '[]'::jsonb)
        ) INTO v_subtype
        FROM procurement.purchase_receipts pr
        JOIN procurement.suppliers s ON s.id = pr.supplier_id
        JOIN inventory.warehouses w ON w.id = pr.warehouse_id
        LEFT JOIN core.business_documents po_bd ON po_bd.id = pr.purchase_order_id
        WHERE pr.document_id = v_doc.id;

    ELSIF v_doc.document_type = 'SUPPLIER_INVOICE' THEN
        SELECT jsonb_build_object(
            'purchase_order_id', si.purchase_order_id,
            'purchase_order_number', po_bd.document_number,
            'supplier_id', si.supplier_id,
            'supplier_name', s.name,
            'currency_code', si.currency_code,
            'exchange_rate', si.exchange_rate_to_dzd::text,
            'base_total_amount', si.base_total_amount::text,
            'notes', si.note,
            'lines', coalesce((
                SELECT jsonb_agg(jsonb_build_object(
                    'line_number', sil.line_number,
                    'variant_id', sil.variant_id,
                    'sku', pv.sku,
                    'product_name', p.name,
                    'invoiced_quantity', sil.quantity::text,
                    'unit_cost', sil.unit_cost::text,
                    'line_total', sil.line_total::text
                ) ORDER BY sil.line_number)
                FROM procurement.supplier_invoice_lines sil
                JOIN catalog.product_variants pv ON pv.id = sil.variant_id
                JOIN catalog.products p ON p.id = pv.product_id
                WHERE sil.document_id = v_doc.id
            ), '[]'::jsonb)
        ) INTO v_subtype
        FROM procurement.supplier_invoices si
        JOIN procurement.suppliers s ON s.id = si.supplier_id
        LEFT JOIN core.business_documents po_bd ON po_bd.id = si.purchase_order_id
        WHERE si.document_id = v_doc.id;

    ELSIF v_doc.document_type = 'PURCHASE_RETURN' THEN
        SELECT jsonb_build_object(
            'purchase_order_id', sr.purchase_order_id,
            'purchase_order_number', po_bd.document_number,
            'supplier_id', sr.supplier_id,
            'supplier_name', s.name,
            'warehouse_id', sr.warehouse_id,
            'warehouse_name', w.name,
            'reason_code', sr.reason_code,
            'notes', sr.note,
            'lines', coalesce((
                SELECT jsonb_agg(jsonb_build_object(
                    'line_number', srl.line_number,
                    'variant_id', srl.variant_id,
                    'sku', pv.sku,
                    'product_name', p.name,
                    'returned_quantity', srl.quantity::text,
                    'supplier_unit_cost', srl.unit_cost::text,
                    'line_total', srl.line_total::text
                ) ORDER BY srl.line_number)
                FROM procurement.supplier_return_lines srl
                JOIN catalog.product_variants pv ON pv.id = srl.variant_id
                JOIN catalog.products p ON p.id = pv.product_id
                WHERE srl.return_id = sr.id
            ), '[]'::jsonb)
        ) INTO v_subtype
        FROM procurement.supplier_returns sr
        JOIN procurement.suppliers s ON s.id = sr.supplier_id
        JOIN inventory.warehouses w ON w.id = sr.warehouse_id
        LEFT JOIN core.business_documents po_bd ON po_bd.id = sr.purchase_order_id
        WHERE sr.document_id = v_doc.id;

    ELSIF v_doc.document_type = 'SUPPLIER_PAYMENT' THEN
        SELECT jsonb_build_object(
            'supplier_id', sp.supplier_id,
            'supplier_name', s.name,
            'amount', sp.amount::text,
            'payment_method', sp.payment_method,
            'reference_number', sp.reference_number,
            'notes', sp.note
        ) INTO v_subtype
        FROM procurement.supplier_payments sp
        JOIN procurement.suppliers s ON s.id = sp.supplier_id
        WHERE sp.document_id = v_doc.id;

    ELSIF v_doc.document_type = 'CASH_SALE' THEN
        SELECT jsonb_build_object(
            'subtotal', cs.subtotal::text,
            'discount_amount', cs.discount_amount::text,
            'total_amount', cs.total_amount::text,
            'lines', coalesce((
                SELECT jsonb_agg(jsonb_build_object(
                    'line_number', csl.line_number,
                    'variant_id', csl.variant_id,
                    'sku', pv.sku,
                    'product_name', p.name,
                    'quantity', csl.quantity::text,
                    'unit_price', csl.unit_price::text,
                    'line_total', csl.line_total::text
                ) ORDER BY csl.line_number)
                FROM sales.cash_sale_lines csl
                JOIN catalog.product_variants pv ON pv.id = csl.variant_id
                JOIN catalog.products p ON p.id = pv.product_id
                WHERE csl.document_id = v_doc.id
            ), '[]'::jsonb)
        ) INTO v_subtype
        FROM sales.cash_sales cs
        WHERE cs.document_id = v_doc.id;

    ELSIF v_doc.document_type = 'CREDIT_SALE' THEN
        SELECT jsonb_build_object(
            'customer_id', cs.customer_id,
            'customer_name', c.name,
            'total_amount', cs.total_amount::text,
            'due_date', cs.due_date,
            'lines', coalesce((
                SELECT jsonb_agg(jsonb_build_object(
                    'line_number', csl.line_number,
                    'variant_id', csl.variant_id,
                    'sku', pv.sku,
                    'product_name', p.name,
                    'quantity', csl.quantity::text,
                    'unit_price', csl.unit_price::text,
                    'line_total', csl.line_total::text
                ) ORDER BY csl.line_number)
                FROM sales.credit_sale_lines csl
                JOIN catalog.product_variants pv ON pv.id = csl.variant_id
                JOIN catalog.products p ON p.id = pv.product_id
                WHERE csl.document_id = v_doc.id
            ), '[]'::jsonb)
        ) INTO v_subtype
        FROM sales.credit_sales cs
        JOIN receivables.customers c ON c.id = cs.customer_id
        WHERE cs.document_id = v_doc.id;

    ELSIF v_doc.document_type = 'CUSTOMER_PAYMENT' THEN
        SELECT jsonb_build_object(
            'customer_id', cp.customer_id,
            'customer_name', c.name,
            'amount', cp.amount::text,
            'payment_method', cp.payment_method,
            'reference_number', cp.note
        ) INTO v_subtype
        FROM receivables.customer_payments cp
        JOIN receivables.customers c ON c.id = cp.customer_id
        WHERE cp.document_id = v_doc.id;

    ELSIF v_doc.document_type = 'PURCHASE_TRANSACTION' THEN
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

    ELSIF v_doc.document_type = 'SALE_VOID' THEN
        SELECT jsonb_build_object(
            'sale_kind', v.sale_kind,
            'reason_code', v.reason_code,
            'note', v.note,
            'total_amount', v.total_amount::text,
            'original_document_id', v.original_document_id,
            'customer_name', (
                SELECT c.name
                FROM sales.credit_sales cr
                JOIN receivables.customers c ON c.id = cr.customer_id
                WHERE cr.document_id = v.original_document_id
            ),
            'lines', coalesce((
                SELECT jsonb_agg(jsonb_build_object(
                    'line_number', l.line_number,
                    'variant_id', l.variant_id,
                    'sku', l.variant_sku_snapshot,
                    'product_name', l.variant_name_snapshot,
                    'quantity', l.quantity::text,
                    'unit_price', l.unit_price::text,
                    'line_total', l.line_total::text
                ) ORDER BY l.line_number)
                FROM (
                    SELECT line_number, variant_id, variant_sku_snapshot, variant_name_snapshot,
                           quantity, unit_price, line_total
                    FROM sales.cash_sale_lines WHERE document_id = v.original_document_id
                    UNION ALL
                    SELECT line_number, variant_id, variant_sku_snapshot, variant_name_snapshot,
                           quantity, unit_price, line_total
                    FROM sales.credit_sale_lines WHERE document_id = v.original_document_id
                ) l
            ), '[]'::jsonb)
        ) INTO v_subtype
        FROM sales.sale_voids v
        WHERE v.void_document_id = v_doc.id;
    END IF;

    -- WS-L-001: a cancelled document and its cancellation always link to each other.
    v_relationships := coalesce(v_relationships, '[]'::jsonb) || coalesce((
        SELECT jsonb_agg(jsonb_build_object(
            'document_id', r.id,
            'document_type', r.document_type,
            'document_number', r.document_number,
            'date', r.document_date,
            'status', r.status
        ) ORDER BY r.id)
        FROM core.business_documents r
        WHERE r.id = v_doc.reverses_document_id
           OR r.reverses_document_id = v_doc.id
    ), '[]'::jsonb);

    -- Linked Journal Lookup
    SELECT jsonb_build_object(
        'document_id', je.document_id,
        'document_number', j_bd.document_number
    ) INTO v_journal
    FROM finance.journal_entries je
    JOIN core.business_documents j_bd ON j_bd.id = je.document_id
    WHERE je.source_id = v_doc.id
      AND je.source_type = v_doc.document_type
    ORDER BY je.document_id LIMIT 1;

    -- Print/Gen status
    IF v_doc.document_type IN ('CASH_SALE', 'CREDIT_SALE', 'CUSTOMER_PAYMENT') THEN
        SELECT jsonb_build_object(
            'gen_status', coalesce(dg.status, 'NOT_GENERATED'),
            'prt_status', coalesce(dpj.status, 'NOT_PRINTED')
        ) INTO v_print_jobs
        FROM documents.generation_jobs dg
        LEFT JOIN documents.print_jobs dpj ON dpj.business_document_id = dg.business_document_id
        WHERE dg.business_document_id = v_doc.id
        ORDER BY dg.created_at DESC
        LIMIT 1;
    ELSE
        v_print_jobs := jsonb_build_object(
            'gen_status', 'NOT_APPLICABLE',
            'prt_status', 'NOT_APPLICABLE'
        );
    END IF;

    v_result := jsonb_build_object(
        'header', v_header,
        'subtype_detail', coalesce(v_subtype, '{}'::jsonb),
        'relationships', v_relationships,
        'journal', v_journal,
        'print_jobs', v_print_jobs
    );

    RETURN v_result;
END;
$$;

-- Section 4: documents.search_business_documents.
CREATE OR REPLACE FUNCTION documents.search_business_documents(
    p_session_token text,
    p_date_from date DEFAULT NULL,
    p_date_to date DEFAULT NULL,
    p_document_type text DEFAULT NULL,
    p_status text DEFAULT NULL,
    p_search text DEFAULT NULL,
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
    v_user_id bigint;
    v_enabled text;
    v_is_cashier boolean;
    v_search text;
    v_pattern text;
    v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
    v_offset integer := greatest(coalesce(p_offset, 0), 0);
    v_total bigint;
    v_rows jsonb;
BEGIN
    SELECT user_id INTO v_user_id FROM iam.resolve_session(p_session_token);
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'SESSION_INVALID: Session is invalid or expired' USING ERRCODE = '28000';
    END IF;

    IF p_date_from IS NOT NULL AND p_date_to IS NOT NULL AND p_date_from > p_date_to THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: the start date is after the end date' USING ERRCODE = '22023';
    END IF;
    IF p_status IS NOT NULL AND p_status NOT IN ('DRAFT', 'POSTED', 'REVERSED') THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: unsupported status filter' USING ERRCODE = '22023';
    END IF;
    v_search := nullif(btrim(coalesce(p_search, '')), '');
    IF v_search IS NOT NULL AND char_length(v_search) > 100 THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: search text must be at most 100 characters' USING ERRCODE = '22023';
    END IF;
    IF v_search IS NOT NULL THEN
        v_pattern := '%' || replace(replace(replace(v_search, '\', '\\'), '%', '\%'), '_', '\_') || '%';
    END IF;

    SELECT setting_value INTO v_enabled
    FROM core.system_settings
    WHERE setting_key = 'business_documents_enabled';
    IF v_enabled = 'false' THEN
        RETURN jsonb_build_object('total_count', 0, 'rows', '[]'::jsonb);
    END IF;

    -- Same cashier rule as documents.list_business_documents.
    SELECT EXISTS (
        SELECT 1 FROM iam.user_roles ur
        JOIN iam.roles r ON r.id = ur.role_id
        WHERE ur.user_id = v_user_id AND r.code = 'CASHIER'
    ) AND NOT EXISTS (
        SELECT 1 FROM iam.user_roles ur
        JOIN iam.roles r ON r.id = ur.role_id
        WHERE ur.user_id = v_user_id AND r.code IN ('ADMIN', 'MANAGER', 'SUPER_ADMIN')
    ) INTO v_is_cashier;

    WITH base AS (
        SELECT
            bd.id, bd.document_number, bd.document_type, bd.document_date, bd.status,
            bd.posted_at, bd.reverses_document_id, bd.created_by_user_id, bd.created_on_workstation_id,
            CASE bd.document_type
                WHEN 'PURCHASE_ORDER' THEN (SELECT s.name FROM procurement.purchase_orders po JOIN procurement.suppliers s ON s.id = po.supplier_id WHERE po.document_id = bd.id)
                WHEN 'PURCHASE_RECEIPT' THEN (SELECT s.name FROM procurement.purchase_receipts pr JOIN procurement.suppliers s ON s.id = pr.supplier_id WHERE pr.document_id = bd.id)
                WHEN 'SUPPLIER_INVOICE' THEN (SELECT s.name FROM procurement.supplier_invoices si JOIN procurement.suppliers s ON s.id = si.supplier_id WHERE si.document_id = bd.id)
                WHEN 'PURCHASE_RETURN' THEN (SELECT s.name FROM procurement.supplier_returns sr JOIN procurement.suppliers s ON s.id = sr.supplier_id WHERE sr.document_id = bd.id)
                WHEN 'SUPPLIER_PAYMENT' THEN (SELECT s.name FROM procurement.supplier_payments sp JOIN procurement.suppliers s ON s.id = sp.supplier_id WHERE sp.document_id = bd.id)
                WHEN 'PURCHASE_TRANSACTION' THEN (SELECT pt.supplier_snapshot ->> 'name' FROM procurement.purchase_transactions pt WHERE pt.document_id = bd.id)
                WHEN 'CREDIT_SALE' THEN (SELECT c.name FROM sales.credit_sales cs JOIN receivables.customers c ON c.id = cs.customer_id WHERE cs.document_id = bd.id)
                WHEN 'CUSTOMER_PAYMENT' THEN (SELECT c.name FROM receivables.customer_payments cp JOIN receivables.customers c ON c.id = cp.customer_id WHERE cp.document_id = bd.id)
                WHEN 'CUSTOMER_REFUND' THEN (SELECT c.name FROM receivables.customer_payment_refunds cr JOIN receivables.customers c ON c.id = cr.customer_id WHERE cr.document_id = bd.id)
                WHEN 'SALE_VOID' THEN (SELECT c.name FROM sales.sale_voids v JOIN sales.credit_sales cs ON cs.document_id = v.original_document_id JOIN receivables.customers c ON c.id = cs.customer_id WHERE v.void_document_id = bd.id)
                ELSE NULL
            END AS party_name,
            CASE bd.document_type
                WHEN 'PURCHASE_ORDER' THEN (SELECT po.total_amount::text FROM procurement.purchase_orders po WHERE po.document_id = bd.id)
                WHEN 'PURCHASE_RECEIPT' THEN (SELECT pr.total_amount::text FROM procurement.purchase_receipts pr WHERE pr.document_id = bd.id)
                WHEN 'SUPPLIER_INVOICE' THEN (SELECT si.base_total_amount::text FROM procurement.supplier_invoices si WHERE si.document_id = bd.id)
                WHEN 'PURCHASE_RETURN' THEN (SELECT sum(srl.line_total)::text FROM procurement.supplier_return_lines srl WHERE srl.return_id = bd.id)
                WHEN 'SUPPLIER_PAYMENT' THEN (SELECT sp.amount::text FROM procurement.supplier_payments sp WHERE sp.document_id = bd.id)
                WHEN 'PURCHASE_TRANSACTION' THEN (SELECT pt.total_amount::text FROM procurement.purchase_transactions pt WHERE pt.document_id = bd.id)
                WHEN 'CASH_SALE' THEN (SELECT cs.total_amount::text FROM sales.cash_sales cs WHERE cs.document_id = bd.id)
                WHEN 'CREDIT_SALE' THEN (SELECT cs.total_amount::text FROM sales.credit_sales cs WHERE cs.document_id = bd.id)
                WHEN 'CUSTOMER_PAYMENT' THEN (SELECT cp.amount::text FROM receivables.customer_payments cp WHERE cp.document_id = bd.id)
                WHEN 'CUSTOMER_REFUND' THEN (SELECT cr.amount::text FROM receivables.customer_payment_refunds cr WHERE cr.document_id = bd.id)
                WHEN 'SALE_VOID' THEN (SELECT v.total_amount::text FROM sales.sale_voids v WHERE v.void_document_id = bd.id)
                ELSE NULL
            END AS amount
        FROM core.business_documents bd
        WHERE bd.document_type <> 'JOURNAL_ENTRY'
          AND (p_date_from IS NULL OR bd.document_date >= p_date_from)
          AND (p_date_to IS NULL OR bd.document_date <= p_date_to)
          AND (p_document_type IS NULL OR bd.document_type = p_document_type)
          AND (p_status IS NULL OR bd.status = p_status)
          AND (NOT v_is_cashier OR bd.document_type IN ('CASH_SALE', 'CREDIT_SALE', 'CUSTOMER_PAYMENT'))
    ),
    filtered AS (
        SELECT *
        FROM base
        WHERE v_pattern IS NULL
           OR coalesce(base.document_number, '') ILIKE v_pattern ESCAPE '\'
           OR coalesce(base.party_name, '') ILIKE v_pattern ESCAPE '\'
    ),
    page AS (
        SELECT *
        FROM filtered
        ORDER BY posted_at DESC NULLS LAST, id DESC
        LIMIT v_limit OFFSET v_offset
    )
    SELECT
        (SELECT count(*) FROM filtered),
        coalesce((
            SELECT jsonb_agg(jsonb_build_object(
                'document_id', p.id,
                'document_number', p.document_number,
                'document_type', p.document_type,
                'document_date', p.document_date,
                'status', p.status,
                'posted_at', p.posted_at,
                'party_name', p.party_name,
                'amount', p.amount,
                'linked_journal_id', jl.journal_id,
                'linked_journal_number', jl.journal_number,
                'created_by_username', u.username,
                'created_on_workstation_id', p.created_on_workstation_id,
                'reverses_document_id', rev.id,
                'reverses_document_number', rev.document_number,
                'reversed_by_document_id', rby.id,
                'reversed_by_document_number', rby.document_number
            ) ORDER BY p.posted_at DESC NULLS LAST, p.id DESC)
            FROM page p
            LEFT JOIN LATERAL (
                SELECT je.document_id AS journal_id, jbd.document_number AS journal_number
                FROM finance.journal_entries je
                JOIN core.business_documents jbd ON jbd.id = je.document_id
                WHERE je.source_id = p.id AND je.source_type = p.document_type
                ORDER BY je.document_id
                LIMIT 1
            ) jl ON true
            LEFT JOIN iam.users u ON u.id = p.created_by_user_id
            LEFT JOIN core.business_documents rev ON rev.id = p.reverses_document_id
            LEFT JOIN LATERAL (
                SELECT r2.id, r2.document_number
                FROM core.business_documents r2
                WHERE r2.reverses_document_id = p.id
                ORDER BY r2.id
                LIMIT 1
            ) rby ON true
        ), '[]'::jsonb)
    INTO v_total, v_rows;

    RETURN jsonb_build_object('total_count', v_total, 'rows', v_rows);
END;
$$;

-- Section 5: finance.search_journals.
CREATE OR REPLACE FUNCTION finance.search_journals(
    p_session_token text,
    p_date_from date DEFAULT NULL,
    p_date_to date DEFAULT NULL,
    p_source_type text DEFAULT NULL,
    p_search text DEFAULT NULL,
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
    v_user_id bigint;
    v_enabled text;
    v_search text;
    v_pattern text;
    v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
    v_offset integer := greatest(coalesce(p_offset, 0), 0);
    v_total bigint;
    v_rows jsonb;
    v_types jsonb;
BEGIN
    SELECT user_id INTO v_user_id FROM iam.resolve_session(p_session_token);
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'SESSION_INVALID: Session is invalid or expired' USING ERRCODE = '28000';
    END IF;

    IF p_date_from IS NOT NULL AND p_date_to IS NOT NULL AND p_date_from > p_date_to THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: the start date is after the end date' USING ERRCODE = '22023';
    END IF;
    v_search := nullif(btrim(coalesce(p_search, '')), '');
    IF v_search IS NOT NULL AND char_length(v_search) > 100 THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: search text must be at most 100 characters' USING ERRCODE = '22023';
    END IF;
    IF v_search IS NOT NULL THEN
        v_pattern := '%' || replace(replace(replace(v_search, '\', '\\'), '%', '\%'), '_', '\_') || '%';
    END IF;

    SELECT setting_value INTO v_enabled
    FROM core.system_settings
    WHERE setting_key = 'accounting_journals_enabled';
    IF v_enabled = 'false' THEN
        RETURN jsonb_build_object('total_count', 0, 'rows', '[]'::jsonb, 'available_source_types', '[]'::jsonb);
    END IF;

    SELECT coalesce(jsonb_agg(t.source_type ORDER BY t.source_type), '[]'::jsonb)
    INTO v_types
    FROM (SELECT DISTINCT source_type FROM finance.journal_entries WHERE source_type IS NOT NULL) t;

    WITH base AS (
        SELECT
            je.document_id, je.source_type, je.source_id, je.description, je.created_at,
            bd.document_number, bd.document_date, bd.fiscal_period_id,
            bd.created_by_user_id, bd.created_on_workstation_id,
            source_bd.id AS source_document_id,
            source_bd.document_number AS source_document_number
        FROM finance.journal_entries je
        JOIN core.business_documents bd ON bd.id = je.document_id
        LEFT JOIN core.business_documents source_bd
               ON source_bd.id = je.source_id
              AND source_bd.document_type = je.source_type
        WHERE (p_date_from IS NULL OR bd.document_date >= p_date_from)
          AND (p_date_to IS NULL OR bd.document_date <= p_date_to)
          AND (p_source_type IS NULL OR je.source_type = p_source_type)
    ),
    filtered AS (
        SELECT *
        FROM base
        WHERE v_pattern IS NULL
           OR coalesce(base.document_number, '') ILIKE v_pattern ESCAPE '\'
           OR coalesce(base.source_document_number, '') ILIKE v_pattern ESCAPE '\'
    ),
    page AS (
        SELECT *
        FROM filtered
        ORDER BY document_date DESC, document_id DESC
        LIMIT v_limit OFFSET v_offset
    )
    SELECT
        (SELECT count(*) FROM filtered),
        coalesce((
            SELECT jsonb_agg(jsonb_build_object(
                'document_id', p.document_id,
                'document_number', p.document_number,
                'document_date', p.document_date,
                'fiscal_period_id', p.fiscal_period_id,
                'source_type', p.source_type,
                'source_id', p.source_id,
                'source_document_id', p.source_document_id,
                'source_document_number', p.source_document_number,
                'description', p.description,
                'total_debit', coalesce(t.total_debit, 0)::text,
                'total_credit', coalesce(t.total_credit, 0)::text,
                'is_balanced', (coalesce(t.total_debit, 0) = coalesce(t.total_credit, 0)),
                'created_at', p.created_at,
                'created_by_username', u.username,
                'created_on_workstation_id', p.created_on_workstation_id
            ) ORDER BY p.document_date DESC, p.document_id DESC)
            FROM page p
            LEFT JOIN LATERAL (
                SELECT sum(jl.debit) AS total_debit, sum(jl.credit) AS total_credit
                FROM finance.journal_lines jl
                WHERE jl.document_id = p.document_id
            ) t ON true
            LEFT JOIN iam.users u ON u.id = p.created_by_user_id
        ), '[]'::jsonb)
    INTO v_total, v_rows;

    RETURN jsonb_build_object('total_count', v_total, 'rows', v_rows, 'available_source_types', v_types);
END;
$$;

-- Section 6: finance.get_journal_detail (same signature; superset of keys).
CREATE OR REPLACE FUNCTION finance.get_journal_detail(
    p_session_token text,
    p_journal_doc_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_user_id bigint;
    v_enabled text;
    v_result jsonb;
BEGIN
    SELECT user_id INTO v_user_id
    FROM iam.resolve_session(p_session_token);
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'SESSION_INVALID: Session is invalid or expired' USING ERRCODE = '28000';
    END IF;

    SELECT setting_value INTO v_enabled
    FROM core.system_settings
    WHERE setting_key = 'accounting_journals_enabled';
    IF v_enabled = 'false' THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: Journal visibility is disabled' USING ERRCODE = '55000';
    END IF;

    SELECT jsonb_build_object(
        'document_id', je.document_id,
        'document_number', bd.document_number,
        'document_date', bd.document_date,
        'fiscal_period_id', bd.fiscal_period_id,
        'source_type', je.source_type,
        'source_id', je.source_id,
        'source_document_id', source_bd.id,
        'source_document_number', source_bd.document_number,
        'description', je.description,
        'total_debit', coalesce(line_totals.total_debit, 0)::text,
        'total_credit', coalesce(line_totals.total_credit, 0)::text,
        'is_balanced', (coalesce(line_totals.total_debit, 0) = coalesce(line_totals.total_credit, 0)),
        'created_at', je.created_at,
        'created_by_username', (SELECT u.username FROM iam.users u WHERE u.id = bd.created_by_user_id),
        'created_on_workstation_id', bd.created_on_workstation_id,
        'lines', coalesce(line_totals.lines, '[]'::jsonb)
    ) INTO v_result
    FROM finance.journal_entries je
    JOIN core.business_documents bd ON bd.id = je.document_id
    LEFT JOIN core.business_documents source_bd
           ON source_bd.id = je.source_id
          AND source_bd.document_type = je.source_type
    LEFT JOIN LATERAL (
        SELECT
            sum(jl.debit) AS total_debit,
            sum(jl.credit) AS total_credit,
            jsonb_agg(
                jsonb_build_object(
                    'line_number', jl.line_number,
                    'account_code', jl.account_code,
                    'account_name', coalesce(a.name_fr, jl.account_code),
                    'scf_code', a.scf_code,
                    'name_fr', a.name_fr,
                    'name_ar', a.name_ar,
                    'name_en', a.name_en,
                    'debit', jl.debit::text,
                    'credit', jl.credit::text
                ) ORDER BY jl.line_number
            ) AS lines
        FROM finance.journal_lines jl
        LEFT JOIN finance.accounts a ON a.id = jl.account_id
        WHERE jl.document_id = je.document_id
    ) line_totals ON true
    WHERE je.document_id = p_journal_doc_id;

    IF v_result IS NULL THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: Journal entry % not found', p_journal_doc_id USING ERRCODE = '55000';
    END IF;

    RETURN v_result;
END;
$$;

-- Section 7: fix documents.get_business_document_reports. Base: the complete
-- 20260812120000 function. Edits R1 (journal join matches source_type too),
-- R2 (p_has_journal filter honoured in the paginated rows, not just the
-- summary), R3 (SALE_VOID amount).
CREATE OR REPLACE FUNCTION documents.get_business_document_reports(
    p_session_token text,
    p_date_from date DEFAULT NULL,
    p_date_to date DEFAULT NULL,
    p_document_type text DEFAULT NULL,
    p_status text DEFAULT NULL,
    p_search text DEFAULT NULL,
    p_has_journal boolean DEFAULT NULL,
    p_limit integer DEFAULT 100,
    p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_user_id bigint;
    v_summary jsonb;
    v_rows jsonb;
    v_result jsonb;
BEGIN
    -- Authenticate session
    SELECT user_id INTO v_user_id
    FROM iam.resolve_session(p_session_token);
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'SESSION_INVALID: Session is invalid or expired' USING ERRCODE = '28000';
    END IF;

    -- Summary KPI aggregation
    SELECT jsonb_build_object(
        'total_count', count(*),
        'posted_count', count(*) FILTER (WHERE bd.status = 'POSTED'),
        'draft_count', count(*) FILTER (WHERE bd.status = 'DRAFT'),
        'reversed_count', count(*) FILTER (WHERE bd.status = 'REVERSED'),
        'linked_journal_count', count(*) FILTER (WHERE je.document_id IS NOT NULL),
        'unlinked_journal_count', count(*) FILTER (WHERE je.document_id IS NULL AND bd.document_type <> 'JOURNAL_ENTRY'),
        'type_counts', coalesce((
            SELECT jsonb_agg(jsonb_build_object('type', t.document_type, 'count', t.cnt))
            FROM (
                SELECT sub_bd.document_type, count(*) AS cnt
                FROM core.business_documents sub_bd
                WHERE (p_date_from IS NULL OR sub_bd.document_date >= p_date_from)
                  AND (p_date_to IS NULL OR sub_bd.document_date <= p_date_to)
                  AND (p_document_type IS NULL OR sub_bd.document_type = p_document_type)
                  AND (p_status IS NULL OR sub_bd.status = p_status)
                  AND (p_search IS NULL OR sub_bd.document_number ILIKE '%' || p_search || '%')
                GROUP BY sub_bd.document_type
                ORDER BY sub_bd.document_type
            ) t
        ), '[]'::jsonb),
        'type_amounts', coalesce((
            SELECT jsonb_agg(jsonb_build_object(
                'type', a.document_type,
                'total_amount', a.tot::text,
                'semantic_label', a.label
            ))
            FROM (
                SELECT
                    bd_amt.document_type,
                    CASE bd_amt.document_type
                        WHEN 'PURCHASE_ORDER' THEN 'Ordered Value'
                        WHEN 'PURCHASE_RECEIPT' THEN 'Received Goods Value'
                        WHEN 'SUPPLIER_INVOICE' THEN 'Invoiced Value'
                        WHEN 'PURCHASE_RETURN' THEN 'Return Value'
                        WHEN 'SUPPLIER_PAYMENT' THEN 'Paid Amount'
                        WHEN 'CASH_SALE' THEN 'Sales Value'
                        WHEN 'CREDIT_SALE' THEN 'Credit Sales Value'
                        WHEN 'CUSTOMER_PAYMENT' THEN 'Collected Amount'
                        ELSE 'Transaction Value'
                    END AS label,
                    sum(
                        CASE bd_amt.document_type
                            WHEN 'PURCHASE_ORDER' THEN (SELECT po.total_amount FROM procurement.purchase_orders po WHERE po.document_id = bd_amt.id)
                            WHEN 'PURCHASE_RECEIPT' THEN (SELECT pr.total_amount FROM procurement.purchase_receipts pr WHERE pr.document_id = bd_amt.id)
                            WHEN 'SUPPLIER_INVOICE' THEN (SELECT si.base_total_amount FROM procurement.supplier_invoices si WHERE si.document_id = bd_amt.id)
                            WHEN 'PURCHASE_RETURN' THEN (SELECT sum(srl.line_total) FROM procurement.supplier_return_lines srl WHERE srl.return_id = bd_amt.id)
                            WHEN 'SUPPLIER_PAYMENT' THEN (SELECT sp.amount FROM procurement.supplier_payments sp WHERE sp.document_id = bd_amt.id)
                            WHEN 'CASH_SALE' THEN (SELECT cs.total_amount FROM sales.cash_sales cs WHERE cs.document_id = bd_amt.id)
                            WHEN 'CREDIT_SALE' THEN (SELECT cs.total_amount FROM sales.credit_sales cs WHERE cs.document_id = bd_amt.id)
                            WHEN 'CUSTOMER_PAYMENT' THEN (SELECT cp.amount FROM receivables.customer_payments cp WHERE cp.document_id = bd_amt.id)
                            ELSE 0
                        END
                    ) AS tot
                FROM core.business_documents bd_amt
                WHERE (p_date_from IS NULL OR bd_amt.document_date >= p_date_from)
                  AND (p_date_to IS NULL OR bd_amt.document_date <= p_date_to)
                  AND (p_document_type IS NULL OR bd_amt.document_type = p_document_type)
                  AND (p_status IS NULL OR bd_amt.status = p_status)
                  AND (p_search IS NULL OR bd_amt.document_number ILIKE '%' || p_search || '%')
                  AND bd_amt.document_type IN ('PURCHASE_ORDER', 'PURCHASE_RECEIPT', 'SUPPLIER_INVOICE', 'PURCHASE_RETURN', 'SUPPLIER_PAYMENT', 'CASH_SALE', 'CREDIT_SALE', 'CUSTOMER_PAYMENT')
                GROUP BY bd_amt.document_type
            ) a
        ), '[]'::jsonb)
    ) INTO v_summary
    FROM core.business_documents bd
    LEFT JOIN finance.journal_entries je ON je.source_id = bd.id AND je.source_type = bd.document_type
    WHERE (p_date_from IS NULL OR bd.document_date >= p_date_from)
      AND (p_date_to IS NULL OR bd.document_date <= p_date_to)
      AND (p_document_type IS NULL OR bd.document_type = p_document_type)
      AND (p_status IS NULL OR bd.status = p_status)
      AND (p_search IS NULL OR bd.document_number ILIKE '%' || p_search || '%')
      AND (p_has_journal IS NULL OR (p_has_journal = true AND je.document_id IS NOT NULL) OR (p_has_journal = false AND je.document_id IS NULL));

    -- Filtered Paginated Report Rows
    SELECT coalesce(jsonb_agg(
        jsonb_build_object(
            'document_id', bd.id,
            'document_number', bd.document_number,
            'document_type', bd.document_type,
            'document_date', bd.document_date,
            'status', bd.status,
            'posted_at', bd.posted_at,
            'party_name', CASE
                WHEN bd.document_type = 'PURCHASE_ORDER' THEN (SELECT s.name FROM procurement.purchase_orders po JOIN procurement.suppliers s ON s.id = po.supplier_id WHERE po.document_id = bd.id)
                WHEN bd.document_type = 'PURCHASE_RECEIPT' THEN (SELECT s.name FROM procurement.purchase_receipts pr JOIN procurement.suppliers s ON s.id = pr.supplier_id WHERE pr.document_id = bd.id)
                WHEN bd.document_type = 'SUPPLIER_INVOICE' THEN (SELECT s.name FROM procurement.supplier_invoices si JOIN procurement.suppliers s ON s.id = si.supplier_id WHERE si.document_id = bd.id)
                WHEN bd.document_type = 'PURCHASE_RETURN' THEN (SELECT s.name FROM procurement.supplier_returns sr JOIN procurement.suppliers s ON s.id = sr.supplier_id WHERE sr.document_id = bd.id)
                WHEN bd.document_type = 'SUPPLIER_PAYMENT' THEN (SELECT s.name FROM procurement.supplier_payments sp JOIN procurement.suppliers s ON s.id = sp.supplier_id WHERE sp.document_id = bd.id)
                WHEN bd.document_type = 'CASH_SALE' THEN 'Cash Customer'
                WHEN bd.document_type = 'CREDIT_SALE' THEN (SELECT c.name FROM sales.credit_sales cs JOIN receivables.customers c ON c.id = cs.customer_id WHERE cs.document_id = bd.id)
                WHEN bd.document_type = 'CUSTOMER_PAYMENT' THEN (SELECT c.name FROM receivables.customer_payments cp JOIN receivables.customers c ON c.id = cp.customer_id WHERE cp.document_id = bd.id)
                ELSE NULL
            END,
            'amount', CASE
                WHEN bd.document_type = 'PURCHASE_ORDER' THEN (SELECT po.total_amount::text FROM procurement.purchase_orders po WHERE po.document_id = bd.id)
                WHEN bd.document_type = 'PURCHASE_RECEIPT' THEN (SELECT pr.total_amount::text FROM procurement.purchase_receipts pr WHERE pr.document_id = bd.id)
                WHEN bd.document_type = 'SUPPLIER_INVOICE' THEN (SELECT si.base_total_amount::text FROM procurement.supplier_invoices si WHERE si.document_id = bd.id)
                WHEN bd.document_type = 'PURCHASE_RETURN' THEN (SELECT sum(srl.line_total)::text FROM procurement.supplier_return_lines srl WHERE srl.return_id = bd.id)
                WHEN bd.document_type = 'SUPPLIER_PAYMENT' THEN (SELECT sp.amount::text FROM procurement.supplier_payments sp WHERE sp.document_id = bd.id)
                WHEN bd.document_type = 'CASH_SALE' THEN (SELECT cs.total_amount::text FROM sales.cash_sales cs WHERE cs.document_id = bd.id)
                WHEN bd.document_type = 'CREDIT_SALE' THEN (SELECT cs.total_amount::text FROM sales.credit_sales cs WHERE cs.document_id = bd.id)
                WHEN bd.document_type = 'CUSTOMER_PAYMENT' THEN (SELECT cp.amount::text FROM receivables.customer_payments cp WHERE cp.document_id = bd.id)
                WHEN bd.document_type = 'SALE_VOID' THEN (SELECT v.total_amount::text FROM sales.sale_voids v WHERE v.void_document_id = bd.id)
                ELSE NULL
            END,
            'linked_journal_id', je.document_id,
            'linked_journal_number', j_bd.document_number,
            'has_journal', (je.document_id IS NOT NULL)
        ) ORDER BY bd.document_date DESC, bd.id DESC
    ), '[]'::jsonb) INTO v_rows
    FROM (
        SELECT * FROM core.business_documents bd_inner
        WHERE (p_date_from IS NULL OR bd_inner.document_date >= p_date_from)
          AND (p_date_to IS NULL OR bd_inner.document_date <= p_date_to)
          AND (p_document_type IS NULL OR bd_inner.document_type = p_document_type)
          AND (p_status IS NULL OR bd_inner.status = p_status)
          AND (p_search IS NULL OR bd_inner.document_number ILIKE '%' || p_search || '%')
          AND (p_has_journal IS NULL OR p_has_journal = EXISTS (
              SELECT 1 FROM finance.journal_entries j2
              WHERE j2.source_id = bd_inner.id AND j2.source_type = bd_inner.document_type))
        ORDER BY bd_inner.document_date DESC, bd_inner.id DESC
        LIMIT greatest(coalesce(p_limit, 100), 1)
        OFFSET greatest(coalesce(p_offset, 0), 0)
    ) bd
    LEFT JOIN finance.journal_entries je ON je.source_id = bd.id AND je.source_type = bd.document_type
    LEFT JOIN core.business_documents j_bd ON j_bd.id = je.document_id;

    v_result := jsonb_build_object(
        'summary', v_summary,
        'rows', coalesce(v_rows, '[]'::jsonb)
    );

    RETURN v_result;
END;
$$;

-- Section 8: grants and schema state.
REVOKE ALL ON FUNCTION documents.search_business_documents(text, date, date, text, text, text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION finance.search_journals(text, date, date, text, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION documents.search_business_documents(text, date, date, text, text, text, integer, integer) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION finance.search_journals(text, date, date, text, text, integer, integer) TO stockiha_runtime;
-- get_business_document_detail, get_business_document_reports and get_journal_detail keep their
-- existing grants (CREATE OR REPLACE with an unchanged signature preserves them).

UPDATE operations.schema_state SET migration_version = 20260923090000, updated_at = now() WHERE singleton;

RESET ROLE;
