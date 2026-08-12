-- Script: Complete Database Wipe & Seed Single Super Admin + Single Cashier

SET ROLE stockiha_owner;

-- 1. Truncate all business, transaction, document, journal, cash, inventory, catalog, and user data
TRUNCATE TABLE
    iam.application_sessions,
    iam.user_roles,
    iam.users,
    catalog.attribute_values,
    catalog.attributes,
    catalog.variant_attribute_values,
    catalog.variant_barcodes,
    catalog.variant_units,
    catalog.product_variants,
    catalog.products,
    inventory.movements,
    inventory.positions,
    inventory.receipt_cost_attribution,
    inventory.residual_clearances,
    inventory.stock_adjustments,
    inventory.warehouses,
    procurement.landed_cost_postings,
    procurement.supplier_payments,
    procurement.supplier_liabilities,
    procurement.supplier_invoice_lines,
    procurement.supplier_invoices,
    procurement.supplier_return_lines,
    procurement.supplier_returns,
    procurement.purchase_receipt_lines,
    procurement.purchase_receipts,
    procurement.purchase_order_lines,
    procurement.purchase_orders,
    procurement.suppliers,
    receivables.credit_override_tokens,
    receivables.customer_credit_state,
    receivables.payment_refund_allocations,
    receivables.payment_allocations,
    receivables.customer_payment_refunds,
    receivables.customer_payments,
    receivables.customer_refund_authorizations,
    receivables.customer_ledger_entries,
    receivables.customers,
    documents.generation_jobs,
    documents.print_jobs,
    core.business_documents,
    core.request_idempotency,
    finance.journal_lines,
    finance.journal_entries,
    finance.fiscal_periods,
    cash.cash_session_events,
    cash.movements,
    cash.session_close_approvals,
    cash.session_close_attempts,
    cash.session_close_count_lines,
    cash.drawer_jobs
CASCADE;

-- 2. Base Units (if empty)
INSERT INTO catalog.units (code, name, normalized_code)
VALUES 
    ('U', 'Unit', 'u'),
    ('KG', 'Kilogram', 'kg'),
    ('L', 'Liter', 'l')
ON CONFLICT (normalized_code) DO NOTHING;

-- 3. Default Warehouse & Open Fiscal Period
INSERT INTO inventory.warehouses (code, name, is_active)
VALUES ('WH-MAIN', 'Main Warehouse', true);

INSERT INTO finance.fiscal_periods (period_code, starts_on, ends_on, status)
VALUES ('FP-2026', '2026-01-01', '2026-12-31', 'OPEN');

-- 4. Seed core.system_state singleton row
INSERT INTO core.system_state (id, initialized, initialized_at, workstation_id, default_warehouse_id)
VALUES (
    1,
    true,
    now(),
    'WS-MAIN',
    (SELECT id FROM inventory.warehouses WHERE code = 'WH-MAIN')
)
ON CONFLICT (id) DO UPDATE SET
    initialized = true,
    initialized_at = COALESCE(core.system_state.initialized_at, now()),
    workstation_id = 'WS-MAIN',
    default_warehouse_id = (SELECT id FROM inventory.warehouses WHERE code = 'WH-MAIN');

-- 5. Create Single Super Admin User (Username: admin, Password: Admin123!)
INSERT INTO iam.users (username, display_name, password_hash, is_active)
VALUES (
    'admin',
    'Super Admin',
    '$argon2id$v=19$m=19456,t=2,p=1$RTdcgH/d6YR1x8eH40Mq8Q$ggBcFSmXOKBewSXgSAspNYIdQN1xOvg0Otgi9UEwECw',
    true
);

INSERT INTO iam.user_roles (user_id, role_id)
SELECT u.id, r.id
FROM iam.users u, iam.roles r
WHERE u.username = 'admin' AND r.code = 'ADMIN';

-- 6. Create Single Cashier User (Username: cashier, Password: Cashier123!)
INSERT INTO iam.users (username, display_name, password_hash, is_active)
VALUES (
    'cashier',
    'Cashier',
    '$argon2id$v=19$m=19456,t=2,p=1$AmdIlzWiaysj9IJQO/DofQ$+Z5ruQGF1onuWKtHEjvIS3gSizpMfYIe29yGw3V3jpY',
    true
);

INSERT INTO iam.user_roles (user_id, role_id)
SELECT u.id, r.id
FROM iam.users u, iam.roles r
WHERE u.username = 'cashier' AND r.code = 'CASHIER';

RESET ROLE;

SELECT u.id, u.username, u.display_name, r.code AS role_name
FROM iam.users u
JOIN iam.user_roles ur ON ur.user_id = u.id
JOIN iam.roles r ON r.id = ur.role_id;
