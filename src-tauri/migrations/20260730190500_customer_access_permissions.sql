-- S4-001: Split customer read access from customer master management.
SET ROLE stockiha_owner;

-- Extend the current closed vocabulary by exactly VIEW_CUSTOMERS. The existing
-- CHECK expression is carried forward verbatim, so upgraded databases keep all
-- permissions introduced by earlier slices/patches without S4 having to copy
-- their names into another fragile list.
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

    IF v_existing_check IS NULL THEN
        RAISE EXCEPTION 'expected iam.permissions constraint permissions_code_valid is missing';
    END IF;

    ALTER TABLE iam.permissions DROP CONSTRAINT permissions_code_valid;
    EXECUTE format(
        'ALTER TABLE iam.permissions ADD CONSTRAINT permissions_code_valid CHECK ((%s) OR code = %L)',
        v_existing_check,
        'VIEW_CUSTOMERS'
    );
END;
$$;

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
