-- S4-001: Split customer read access from customer master management.
SET ROLE stockiha_owner;

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
