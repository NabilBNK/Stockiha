-- The supplier's own invoice/receipt number is optional in the direct-purchase
-- workflow. A NULL value means Stockiha's internal PUR/PR/PI numbers are the
-- authoritative identifiers. Non-NULL supplier references remain unique per
-- supplier through the existing UNIQUE constraint (PostgreSQL permits multiple
-- NULL values).

SET ROLE stockiha_owner;

ALTER TABLE procurement.purchase_transactions
    ALTER COLUMN external_supplier_document_number DROP NOT NULL;

UPDATE operations.schema_state
SET migration_version = 20260816162000,
    updated_at = now()
WHERE singleton;

RESET ROLE;
