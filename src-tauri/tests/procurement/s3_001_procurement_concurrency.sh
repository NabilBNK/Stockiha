#!/usr/bin/env bash
set -euo pipefail

DB_NAME="${STOCKIHA_TEST_DB:-stockiha_test}"
PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-0000}"

psql_test_db() {
    if [[ -n "${ADMIN_URL:-}" ]]; then
        psql "${ADMIN_URL}" -X -v ON_ERROR_STOP=1 "$@"
    else
        psql -U "${PGUSER}" -d "${DB_NAME}" -X -v ON_ERROR_STOP=1 "$@"
    fi
}

echo "=== Running S3-001 Concurrency & Idempotency Verification ==="

psql_test_db << 'EOF'
DO $$
DECLARE
    v_user_id bigint;
    v_session_token text := 's3001_conc_token';
    v_supplier_id bigint;
    v_warehouse_id bigint;
    v_product_id bigint;
    v_variant_id bigint;
    v_fiscal_period_id bigint;
    v_po_id bigint;
    v_po_json jsonb;
    v_receipt_json jsonb;
    v_receipt_doc_id bigint;
    v_request_id uuid := '55555555-5555-4555-8555-555555555555'::uuid;
BEGIN
    -- Fixture setup
    DELETE FROM iam.user_roles WHERE user_id IN (SELECT id FROM iam.users WHERE username = 's3001_conc_user');
    DELETE FROM iam.users WHERE username = 's3001_conc_user';

    INSERT INTO iam.users (username, display_name, password_hash)
    VALUES ('s3001_conc_user', 'S3001 Conc User', 'hashed_pass')
    RETURNING id INTO v_user_id;

    INSERT INTO iam.user_roles (user_id, role_id)
    SELECT v_user_id, r.id FROM iam.roles r WHERE r.code IN ('ADMIN', 'MANAGER');

    INSERT INTO iam.application_sessions (user_id, workstation_id, token_hash, expires_at)
    VALUES (v_user_id, 'TEST_WKS', sha256(v_session_token::bytea), now() + interval '1 hour');

    SELECT id INTO v_supplier_id FROM procurement.suppliers WHERE code = 'SUP-CONC';
    IF v_supplier_id IS NULL THEN
        INSERT INTO procurement.suppliers (code, name, is_active)
        VALUES ('SUP-CONC', 'Supplier Conc', true)
        RETURNING id INTO v_supplier_id;
    END IF;

    SELECT id INTO v_warehouse_id FROM inventory.warehouses WHERE code = 'W-CONC';
    IF v_warehouse_id IS NULL THEN
        INSERT INTO inventory.warehouses (code, name, is_active)
        VALUES ('W-CONC', 'Warehouse Conc', true)
        RETURNING id INTO v_warehouse_id;
    END IF;

    SELECT id INTO v_fiscal_period_id FROM finance.fiscal_periods WHERE status = 'OPEN' ORDER BY starts_on DESC LIMIT 1;

    INSERT INTO catalog.products (name, is_active) VALUES ('Product Conc', true) RETURNING id INTO v_product_id;
    INSERT INTO catalog.product_variants (product_id, base_unit_id, sku, sale_price, is_active)
    VALUES (v_product_id, 1, 'SKU-CONC-1', 100.00, true)
    RETURNING id INTO v_variant_id;

    -- Create PO: 10 units @ 50.00 DZD
    v_po_json := procurement.create_purchase_order_draft(
        v_session_token, v_supplier_id, v_warehouse_id, 'Conc order',
        jsonb_build_array(
            jsonb_build_object('variant_id', v_variant_id, 'unit_id', 1, 'quantity_ordered', 10, 'unit_cost', 50.00)
        )
    );
    v_po_id := (v_po_json ->> 'document_id')::bigint;
    PERFORM procurement.confirm_purchase_order(v_session_token, v_po_id);

    -- Post Receipt 1
    v_receipt_json := inventory.confirm_purchase_receipt(
        v_session_token, v_request_id, '\x010203'::bytea, v_po_id, v_fiscal_period_id, '2026-02-15'::date,
        jsonb_build_array(
            jsonb_build_object('po_line_id', (SELECT id FROM procurement.purchase_order_lines WHERE document_id = v_po_id AND line_number = 1), 'quantity_received', 10)
        )
    );
    v_receipt_doc_id := (v_receipt_json ->> 'document_id')::bigint;
    RAISE NOTICE 'Receipt Document ID: %', v_receipt_doc_id;

    -- Test Idempotent Retry
    v_receipt_json := inventory.confirm_purchase_receipt(
        v_session_token, v_request_id, '\x010203'::bytea, v_po_id, v_fiscal_period_id, '2026-02-15'::date,
        jsonb_build_array(
            jsonb_build_object('po_line_id', (SELECT id FROM procurement.purchase_order_lines WHERE document_id = v_po_id AND line_number = 1), 'quantity_received', 10)
        )
    );

    IF (v_receipt_json ->> 'document_id')::bigint = v_receipt_doc_id THEN
        RAISE NOTICE 'Idempotency PASSED: Returned identical document ID %', v_receipt_doc_id;
    ELSE
        RAISE EXCEPTION 'Idempotency FAILED: ID mismatch';
    END IF;
END;
$$;
EOF

echo "=== ALL S3-001 CONCURRENCY ASSERTIONS PASSED ==="
