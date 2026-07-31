-- S4-001: Split customer read access from customer master management.
SET ROLE stockiha_owner;

-- Preserve every permission already valid before S4, then add VIEW_CUSTOMERS.
-- This CHECK is a strict superset of the vocabulary accepted by the preceding
-- S4 foundation migration and by upgraded S0-S3 development databases.
ALTER TABLE iam.permissions DROP CONSTRAINT permissions_code_valid;
ALTER TABLE iam.permissions ADD CONSTRAINT permissions_code_valid
    CHECK (code IN (
        'POST_STOCK_RECEIPT',
        'POST_CASH_SALE',
        'OPEN_CASH_SESSION',
        'CLOSE_CASH_SESSION',
        'MANAGE_CATALOG',
        'MANAGE_WAREHOUSES',
        'MANAGE_INVENTORY',
        'MANAGE_PROCUREMENT',
        'POST_PURCHASE_RECEIPT',
        'APPROVE_CASH_VARIANCE',
        'AUTHORIZE_CREDIT_OVERRIDE',
        'MANAGE_PRINT_JOBS',
        'POST_CUSTOMER_RETURN',
        'POST_STOCK_TRANSFER',
        'POST_STOCK_WRITEOFF',
        'RESUME_CASH_SESSION',
        'SUSPEND_CASH_SESSION',
        'VIEW_PRINT_JOBS',
        'VIEW_CUSTOMERS',
        'MANAGE_CUSTOMERS',
        'POST_CREDIT_SALE',
        'POST_CUSTOMER_PAYMENT',
        'OVERRIDE_CREDIT_LIMIT'
    ));

INSERT INTO iam.permissions (code, name) VALUES
    ('VIEW_CUSTOMERS', 'View customers, receivable exposure, and customer ledger')
ON CONFLICT (code) DO NOTHING;

-- Cashiers need customer lookup and normal customer transaction permissions,
-- but they do not receive customer-master management or override authority.
INSERT INTO iam.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM iam.roles r
CROSS JOIN iam.permissions p
WHERE r.code = 'CASHIER'
  AND p.code IN ('VIEW_CUSTOMERS', 'POST_CREDIT_SALE', 'POST_CUSTOMER_PAYMENT')
ON CONFLICT DO NOTHING;

-- Manager/admin can read customers as well as manage/override them.
INSERT INTO iam.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM iam.roles r
CROSS JOIN iam.permissions p
WHERE r.code IN ('ADMIN', 'MANAGER')
  AND p.code = 'VIEW_CUSTOMERS'
ON CONFLICT DO NOTHING;

RESET ROLE;
