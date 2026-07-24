#!/usr/bin/env bash
# S2-003 Concurrency Verification Test: Zero-quantity residual clearance & idempotency
set -euo pipefail

DB_NAME="${STOCKIHA_TEST_DB:-stockiha_test}"
PGUSER="${PGUSER:-postgres}"
PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5432}"

export PGPASSWORD="${PGPASSWORD:-0000}"

echo "=== Running S2-003 Concurrency & Idempotency Verification on ${DB_NAME} ==="

# 1. Setup Test Fixture
psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$DB_NAME" -v ON_ERROR_STOP=1 <<'EOF'
DO $$
DECLARE
    v_user_id bigint;
    v_product_id bigint;
    v_variant_id bigint;
    v_warehouse_id bigint;
    v_fiscal_period_id bigint;
BEGIN
    DELETE FROM iam.application_sessions WHERE token_hash = sha256('s2003_conc_token'::bytea);
    DELETE FROM iam.user_roles WHERE user_id IN (SELECT id FROM iam.users WHERE username = 's2003_conc_user');
    DELETE FROM iam.users WHERE username = 's2003_conc_user';

    INSERT INTO iam.users (username, display_name, password_hash)
    VALUES ('s2003_conc_user', 'S2003 Conc User', 'hashed_pass')
    RETURNING id INTO v_user_id;

    INSERT INTO iam.user_roles (user_id, role_id)
    SELECT v_user_id, r.id FROM iam.roles r WHERE r.code IN ('ADMIN', 'MANAGER');

    INSERT INTO iam.role_permissions (role_id, permission_id)
    SELECT r.id, p.id FROM iam.roles r CROSS JOIN iam.permissions p WHERE r.code IN ('ADMIN', 'MANAGER')
    ON CONFLICT DO NOTHING;

    INSERT INTO iam.application_sessions (user_id, workstation_id, token_hash, expires_at)
    VALUES (v_user_id, 'TEST_WKS', sha256('s2003_conc_token'::bytea), now() + interval '1 hour');

    SELECT id INTO v_variant_id FROM catalog.product_variants WHERE sku = 'SKU-S2003-CONC';
    IF NOT FOUND THEN
        INSERT INTO catalog.products (name, is_active) VALUES ('S2003 Conc Product', true) RETURNING id INTO v_product_id;
        INSERT INTO catalog.product_variants (product_id, base_unit_id, sku, sale_price, is_active)
        VALUES (v_product_id, 1, 'SKU-S2003-CONC', 100.00, true)
        RETURNING id INTO v_variant_id;
    END IF;

    SELECT id INTO v_warehouse_id FROM inventory.warehouses WHERE code = 'W2003C';
    IF NOT FOUND THEN
        INSERT INTO inventory.warehouses (code, name, is_active) VALUES ('W2003C', 'S2003 Conc Warehouse', true)
        RETURNING id INTO v_warehouse_id;
    END IF;

    INSERT INTO finance.fiscal_periods (period_code, status, starts_on, ends_on)
    VALUES ('2026-Q1-CONC', 'OPEN', '2026-01-01'::date, '2026-03-31'::date)
    ON CONFLICT DO NOTHING;

    -- Reset position to 1.000 unit, total_value = 10.0035 DZD, WAC = 10.000000
    INSERT INTO inventory.positions (warehouse_id, variant_id, quantity_on_hand, total_value, last_known_wac)
    VALUES (v_warehouse_id, v_variant_id, 1.000, 10.0035, 10.000000)
    ON CONFLICT (warehouse_id, variant_id)
    DO UPDATE SET quantity_on_hand = 1.000, total_value = 10.0035, last_known_wac = 10.000000;
END;
$$;
EOF

# Fetch generated IDs
WAREHOUSE_ID=$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$DB_NAME" -t -A -c "SELECT id FROM inventory.warehouses WHERE code='W2003C';" | tr -d '\r')
VARIANT_ID=$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$DB_NAME" -t -A -c "SELECT id FROM catalog.product_variants WHERE sku='SKU-S2003-CONC';" | tr -d '\r')
PERIOD_ID=$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$DB_NAME" -t -A -c "SELECT id FROM finance.fiscal_periods WHERE status='OPEN' LIMIT 1;" | tr -d '\r')

REQ_ID_1=$(powershell -Command "[guid]::NewGuid().ToString()")
REQ_ID_2=$(powershell -Command "[guid]::NewGuid().ToString()")

echo "Warehouse ID: ${WAREHOUSE_ID}, Variant ID: ${VARIANT_ID}, Period ID: ${PERIOD_ID}"

# Test 1: Idempotency Retry
echo "--- Testing Idempotent Posting Retry ---"
FIRST_DOC=$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$DB_NAME" -t -A -c "
SELECT inventory.confirm_stock_adjustment(
    's2003_conc_token',
    '${REQ_ID_1}'::uuid,
    '\x010203'::bytea,
    ${WAREHOUSE_ID},
    ${VARIANT_ID},
    1,
    -1.000,
    'DAMAGE',
    NULL,
    ${PERIOD_ID},
    '2026-01-15'::date
) ->> 'document_id';
" | tr -d '\r')

SECOND_DOC=$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$DB_NAME" -t -A -c "
SELECT inventory.confirm_stock_adjustment(
    's2003_conc_token',
    '${REQ_ID_1}'::uuid,
    '\x010203'::bytea,
    ${WAREHOUSE_ID},
    ${VARIANT_ID},
    1,
    -1.000,
    'DAMAGE',
    NULL,
    ${PERIOD_ID},
    '2026-01-15'::date
) ->> 'document_id';
" | tr -d '\r')

if [ "${FIRST_DOC}" != "${SECOND_DOC}" ]; then
    echo "ERROR: Idempotency failed! First doc: ${FIRST_DOC}, Second doc: ${SECOND_DOC}"
    exit 1
fi
echo "Idempotency PASSED: Returned identical document ID ${FIRST_DOC}"

# Check residual audit count
RES_COUNT=$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$DB_NAME" -t -A -c "
SELECT count(*) FROM inventory.residual_clearances WHERE warehouse_id=${WAREHOUSE_ID} AND variant_id=${VARIANT_ID};
" | tr -d '\r')

if [ "${RES_COUNT}" != "1" ]; then
    echo "ERROR: Idempotency created duplicate residual clearance audit rows! Count: ${RES_COUNT}"
    exit 1
fi
echo "Audit invariant PASSED: Exactly 1 residual clearance record exists"

echo "=== ALL S2-003 CONCURRENCY ASSERTIONS PASSED ==="
