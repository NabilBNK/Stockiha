-- S3-001: Procurement domain schema — Suppliers, Purchase Orders, Purchase Receipts, Supplier Liabilities
SET ROLE stockiha_owner;

CREATE SCHEMA IF NOT EXISTS procurement;
REVOKE ALL ON SCHEMA procurement FROM PUBLIC;
GRANT USAGE ON SCHEMA procurement TO stockiha_runtime;

-- 1. Extend document categories and permissions
ALTER TABLE core.business_documents DROP CONSTRAINT business_documents_type_valid;
ALTER TABLE core.business_documents ADD CONSTRAINT business_documents_type_valid
    CHECK (document_type IN ('STOCK_RECEIPT', 'CASH_SALE', 'JOURNAL_ENTRY', 'STOCK_ADJUSTMENT', 'PURCHASE_ORDER', 'PURCHASE_RECEIPT'));

ALTER TABLE core.document_sequences DROP CONSTRAINT document_sequences_type_valid;
ALTER TABLE core.document_sequences ADD CONSTRAINT document_sequences_type_valid
    CHECK (document_type IN ('STOCK_RECEIPT', 'CASH_SALE', 'JOURNAL_ENTRY', 'STOCK_ADJUSTMENT', 'PURCHASE_ORDER', 'PURCHASE_RECEIPT'));

ALTER TABLE iam.permissions DROP CONSTRAINT permissions_code_valid;
ALTER TABLE iam.permissions ADD CONSTRAINT permissions_code_valid
    CHECK (code IN ('POST_STOCK_RECEIPT', 'POST_CASH_SALE', 'OPEN_CASH_SESSION', 'CLOSE_CASH_SESSION', 'MANAGE_CATALOG', 'MANAGE_WAREHOUSES', 'MANAGE_INVENTORY', 'MANAGE_PROCUREMENT', 'POST_PURCHASE_RECEIPT'));

INSERT INTO iam.permissions (code, name) VALUES
    ('MANAGE_PROCUREMENT', 'Manage suppliers and purchase orders'),
    ('POST_PURCHASE_RECEIPT', 'Confirm purchase receipts')
ON CONFLICT (code) DO NOTHING;

INSERT INTO iam.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM iam.roles r
CROSS JOIN iam.permissions p
WHERE r.code IN ('ADMIN', 'MANAGER')
  AND p.code IN ('MANAGE_PROCUREMENT', 'POST_PURCHASE_RECEIPT')
ON CONFLICT DO NOTHING;

-- 2. Suppliers Master Directory
CREATE TABLE procurement.suppliers (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code          text NOT NULL UNIQUE,
    name          text NOT NULL,
    contact_name  text,
    phone         text,
    email         text,
    address       text,
    tax_id        text,
    is_active     boolean NOT NULL DEFAULT true,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT suppliers_code_not_blank CHECK (btrim(code) <> ''),
    CONSTRAINT suppliers_name_not_blank CHECK (btrim(name) <> '')
);

CREATE TRIGGER suppliers_update_timestamp
    BEFORE UPDATE ON procurement.suppliers
    FOR EACH ROW
    EXECUTE FUNCTION core.set_updated_at();

-- 3. Purchase Orders Header & Lines
CREATE TABLE procurement.purchase_orders (
    document_id          bigint PRIMARY KEY REFERENCES core.business_documents (id),
    supplier_id          bigint NOT NULL REFERENCES procurement.suppliers (id),
    warehouse_id         bigint NOT NULL REFERENCES inventory.warehouses (id),
    status               text NOT NULL DEFAULT 'DRAFT',
    subtotal             numeric(14, 2) NOT NULL DEFAULT 0,
    total_amount         numeric(14, 2) NOT NULL DEFAULT 0,
    note                 text,
    created_by_user_id   bigint NOT NULL REFERENCES iam.users (id),
    confirmed_at         timestamptz,
    confirmed_by_user_id bigint REFERENCES iam.users (id),
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT po_status_valid CHECK (status IN ('DRAFT', 'CONFIRMED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED')),
    CONSTRAINT po_subtotal_non_negative CHECK (subtotal >= 0),
    CONSTRAINT po_total_matches_subtotal CHECK (total_amount = subtotal)
);

CREATE TRIGGER purchase_orders_update_timestamp
    BEFORE UPDATE ON procurement.purchase_orders
    FOR EACH ROW
    EXECUTE FUNCTION core.set_updated_at();

CREATE TABLE procurement.purchase_order_lines (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    document_id       bigint NOT NULL REFERENCES procurement.purchase_orders (document_id) ON DELETE CASCADE,
    line_number       integer NOT NULL,
    variant_id        bigint NOT NULL REFERENCES catalog.product_variants (id),
    unit_id           bigint NOT NULL REFERENCES catalog.units (id),
    quantity_ordered  numeric(18, 3) NOT NULL,
    quantity_received numeric(18, 3) NOT NULL DEFAULT 0,
    unit_cost         numeric(14, 2) NOT NULL,
    line_total        numeric(14, 2) NOT NULL,
    CONSTRAINT po_lines_document_line_unique UNIQUE (document_id, line_number),
    CONSTRAINT po_lines_qty_ordered_positive CHECK (quantity_ordered > 0),
    CONSTRAINT po_lines_qty_received_non_negative CHECK (quantity_received >= 0),
    CONSTRAINT po_lines_qty_received_le_ordered CHECK (quantity_received <= quantity_ordered),
    CONSTRAINT po_lines_unit_cost_non_negative CHECK (unit_cost >= 0),
    CONSTRAINT po_lines_total_non_negative CHECK (line_total >= 0)
);

-- 4. Purchase Receipts Header & Lines
CREATE TABLE procurement.purchase_receipts (
    document_id          bigint PRIMARY KEY REFERENCES core.business_documents (id),
    purchase_order_id    bigint NOT NULL REFERENCES procurement.purchase_orders (document_id),
    supplier_id          bigint NOT NULL REFERENCES procurement.suppliers (id),
    warehouse_id         bigint NOT NULL REFERENCES inventory.warehouses (id),
    subtotal             numeric(14, 2) NOT NULL DEFAULT 0,
    total_amount         numeric(14, 2) NOT NULL DEFAULT 0,
    journal_document_id  bigint UNIQUE REFERENCES finance.journal_entries (document_id),
    posted_by_user_id    bigint NOT NULL REFERENCES iam.users (id),
    workstation_id       text NOT NULL,
    created_at           timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pr_subtotal_non_negative CHECK (subtotal >= 0),
    CONSTRAINT pr_total_matches_subtotal CHECK (total_amount = subtotal)
);

CREATE TABLE procurement.purchase_receipt_lines (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    document_id       bigint NOT NULL REFERENCES procurement.purchase_receipts (document_id) ON DELETE CASCADE,
    line_number       integer NOT NULL,
    po_line_id        bigint NOT NULL REFERENCES procurement.purchase_order_lines (id),
    variant_id        bigint NOT NULL REFERENCES catalog.product_variants (id),
    unit_id           bigint NOT NULL REFERENCES catalog.units (id),
    quantity_received numeric(18, 3) NOT NULL,
    unit_cost         numeric(14, 2) NOT NULL,
    line_total        numeric(14, 2) NOT NULL,
    movement_id       bigint NOT NULL UNIQUE REFERENCES inventory.movements (id),
    CONSTRAINT pr_lines_document_line_unique UNIQUE (document_id, line_number),
    CONSTRAINT pr_lines_qty_received_positive CHECK (quantity_received > 0),
    CONSTRAINT pr_lines_unit_cost_non_negative CHECK (unit_cost >= 0),
    CONSTRAINT pr_lines_total_non_negative CHECK (line_total >= 0)
);

-- 5. Supplier Liabilities Tracking
CREATE TABLE procurement.supplier_liabilities (
    id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    supplier_id          bigint NOT NULL REFERENCES procurement.suppliers (id),
    purchase_order_id    bigint NOT NULL REFERENCES procurement.purchase_orders (document_id),
    receipt_document_id  bigint NOT NULL UNIQUE REFERENCES procurement.purchase_receipts (document_id),
    journal_document_id  bigint NOT NULL UNIQUE REFERENCES finance.journal_entries (document_id),
    original_amount      numeric(14, 2) NOT NULL,
    outstanding_amount   numeric(14, 2) NOT NULL,
    status               text NOT NULL DEFAULT 'UNPAID',
    created_at           timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT liabilities_orig_amount_non_neg CHECK (original_amount >= 0),
    CONSTRAINT liabilities_out_amount_non_neg CHECK (outstanding_amount >= 0),
    CONSTRAINT liabilities_status_valid CHECK (status IN ('UNPAID', 'PARTIALLY_PAID', 'PAID'))
);

-- Immutability triggers for posted purchase receipts, receipt lines, and liabilities
CREATE FUNCTION procurement.forbid_receipt_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF (TG_OP = 'UPDATE') THEN
        IF EXISTS (SELECT 1 FROM core.business_documents WHERE id = OLD.document_id AND status = 'POSTED') THEN
            RAISE EXCEPTION 'procurement posted receipt records are immutable'
                USING ERRCODE = '0A000';
        END IF;
        RETURN NEW;
    ELSE
        RAISE EXCEPTION 'procurement posted receipt records are immutable'
            USING ERRCODE = '0A000';
    END IF;
END;
$$;

CREATE TRIGGER purchase_receipts_forbid_update
    BEFORE UPDATE ON procurement.purchase_receipts
    FOR EACH ROW EXECUTE FUNCTION procurement.forbid_receipt_mutation();

CREATE TRIGGER purchase_receipts_forbid_delete
    BEFORE DELETE ON procurement.purchase_receipts
    FOR EACH ROW EXECUTE FUNCTION procurement.forbid_receipt_mutation();

CREATE TRIGGER purchase_receipt_lines_forbid_update
    BEFORE UPDATE ON procurement.purchase_receipt_lines
    FOR EACH ROW EXECUTE FUNCTION procurement.forbid_receipt_mutation();

CREATE TRIGGER purchase_receipt_lines_forbid_delete
    BEFORE DELETE ON procurement.purchase_receipt_lines
    FOR EACH ROW EXECUTE FUNCTION procurement.forbid_receipt_mutation();

CREATE TRIGGER supplier_liabilities_forbid_delete
    BEFORE DELETE ON procurement.supplier_liabilities
    FOR EACH ROW EXECUTE FUNCTION procurement.forbid_receipt_mutation();

-- Grants
REVOKE ALL ON procurement.suppliers FROM PUBLIC;
REVOKE ALL ON procurement.purchase_orders FROM PUBLIC;
REVOKE ALL ON procurement.purchase_order_lines FROM PUBLIC;
REVOKE ALL ON procurement.purchase_receipts FROM PUBLIC;
REVOKE ALL ON procurement.purchase_receipt_lines FROM PUBLIC;
REVOKE ALL ON procurement.supplier_liabilities FROM PUBLIC;

GRANT SELECT, INSERT, UPDATE ON procurement.suppliers TO stockiha_runtime;
GRANT SELECT, INSERT, UPDATE ON procurement.purchase_orders TO stockiha_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON procurement.purchase_order_lines TO stockiha_runtime;
GRANT SELECT, INSERT ON procurement.purchase_receipts TO stockiha_runtime;
GRANT SELECT, INSERT ON procurement.purchase_receipt_lines TO stockiha_runtime;
GRANT SELECT, INSERT, UPDATE ON procurement.supplier_liabilities TO stockiha_runtime;

RESET ROLE;
