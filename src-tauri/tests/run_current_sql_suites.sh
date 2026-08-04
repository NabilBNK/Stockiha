#!/usr/bin/env bash
set -euo pipefail

: "${ADMIN_URL:?ADMIN_URL must point to the dedicated CI database}"

# Every suite runs in an isolated transaction. Deferred journal constraints are
# forced before rollback so balance failures cannot be hidden by test cleanup.
suites=(
  src-tauri/tests/catalog/s2_001_catalog_integration.sql
  src-tauri/tests/inventory/s2_003_zero_quantity_safeguards_integration.sql
  src-tauri/tests/procurement/s3_001_procurement_integration.sql
  src-tauri/tests/procurement/s3_002_landed_cost_and_invoices_integration.sql
  src-tauri/tests/procurement/s3_003_supplier_returns_and_payments_integration.sql
  src-tauri/tests/procurement/r2_financial_semantics_integration.sql
  src-tauri/tests/receivables/s4_001_credit_sale_integration.sql
  src-tauri/tests/receivables/s4_001_customer_payment_integration.sql
  src-tauri/tests/cash/s4_002_cash_session_lifecycle.sql
  src-tauri/tests/cash/s4_002_cash_session_ownership_integration.sql
  src-tauri/tests/receivables/s4_003_drawer_refund_integration.sql
  src-tauri/tests/onboarding/r0_001_historical_finance_staging_integration.sql
  src-tauri/tests/onboarding/r0_001_setting_audit_integration.sql
  src-tauri/tests/onboarding/r0_001_onboarding_backup_acl_integration.sql
  src-tauri/tests/recovery/r6_001_recovery_authorization_audit_integration.sql
  src-tauri/tests/recovery/r6_001_backup_role_read_privileges_integration.sql
  src-tauri/tests/recovery/r6_001_sqlx_metadata_backup_acl_integration.sql
)

for suite in "${suites[@]}"; do
  echo "Running ${suite}"
  psql "$ADMIN_URL" -X -v ON_ERROR_STOP=1 <<SQL
BEGIN;
\i ${suite}
SET CONSTRAINTS ALL IMMEDIATE;
ROLLBACK;
SQL
done

# S2-002 owns its BEGIN/ROLLBACK because it explicitly tests transaction
# rollback behavior.
psql "$ADMIN_URL" -X -v ON_ERROR_STOP=1 \
  -f src-tauri/tests/inventory/s2_002_stock_adjustment_integration.sql
