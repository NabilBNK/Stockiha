-- Slice 5: Customer POS Returns, Warehouse Transfers, and Stock Write-Offs Schema

-- 1. Extend core business document types
ALTER TABLE core.business_documents DROP CONSTRAINT IF EXISTS business_documents_type_valid;
ALTER TABLE core.business_documents ADD CONSTRAINT business_documents_type_valid
    CHECK (document_type IN (
        'CASH_SALE', 'JOURNAL_ENTRY', 'STOCK_RECEIPT', 'STOCK_ADJUSTMENT',
        'PURCHASE_ORDER', 'PURCHASE_RECEIPT', 'PURCHASE_INVOICE',
        'PURCHASE_RETURN', 'DEBIT_NOTE', 'SUPPLIER_PAYMENT', 'CUSTOMER_PAYMENT',
        'CUSTOMER_RETURN', 'STOCK_TRANSFER', 'STOCK_WRITEOFF'
    ));

ALTER TABLE core.document_sequences DROP CONSTRAINT IF EXISTS document_sequences_type_valid;
ALTER TABLE core.document_sequences ADD CONSTRAINT document_sequences_type_valid
    CHECK (document_type IN (
        'CASH_SALE', 'JOURNAL_ENTRY', 'STOCK_RECEIPT', 'STOCK_ADJUSTMENT',
        'PURCHASE_ORDER', 'PURCHASE_RECEIPT', 'PURCHASE_INVOICE',
        'DEBIT_NOTE', 'SUPPLIER_PAYMENT', 'CUSTOMER_PAYMENT',
        'CUSTOMER_RETURN', 'STOCK_TRANSFER', 'STOCK_WRITEOFF'
    ));

-- 2. Customer POS Returns Table
CREATE TABLE IF NOT EXISTS sales.customer_returns (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    document_id       bigint UNIQUE REFERENCES core.business_documents(id) ON DELETE RESTRICT,
    customer_id       bigint REFERENCES sales.customers(id) ON DELETE RESTRICT,
    cash_session_id   bigint REFERENCES sales.cash_sessions(id) ON DELETE RESTRICT,
    warehouse_id      bigint NOT NULL REFERENCES inventory.warehouses(id) ON DELETE RESTRICT,
    refund_method     text NOT NULL CHECK (refund_method IN ('CASH', 'CREDIT_NOTE', 'BANK_TRANSFER')),
    total_amount      numeric(15,2) NOT NULL CHECK (total_amount > 0),
    note              text,
    created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sales.customer_return_lines (
    id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    customer_return_id bigint NOT NULL REFERENCES sales.customer_returns(id) ON DELETE CASCADE,
    line_number        integer NOT NULL CHECK (line_number > 0),
    variant_id         bigint NOT NULL REFERENCES catalog.product_variants(id) ON DELETE RESTRICT,
    quantity           numeric(15,4) NOT NULL CHECK (quantity > 0),
    unit_price         numeric(15,2) NOT NULL CHECK (unit_price >= 0),
    line_total         numeric(15,2) NOT NULL CHECK (line_total >= 0),
    created_at         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT customer_return_lines_unique_line UNIQUE (customer_return_id, line_number)
);

-- 3. 1-Step Warehouse Transfers Table
CREATE TABLE IF NOT EXISTS inventory.warehouse_transfers (
    id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    document_id        bigint UNIQUE REFERENCES core.business_documents(id) ON DELETE RESTRICT,
    from_warehouse_id  bigint NOT NULL REFERENCES inventory.warehouses(id) ON DELETE RESTRICT,
    to_warehouse_id    bigint NOT NULL REFERENCES inventory.warehouses(id) ON DELETE RESTRICT,
    note               text,
    created_at         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT warehouse_transfers_different_warehouses CHECK (from_warehouse_id <> to_warehouse_id)
);

CREATE TABLE IF NOT EXISTS inventory.warehouse_transfer_lines (
    id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    warehouse_transfer_id bigint NOT NULL REFERENCES inventory.warehouse_transfers(id) ON DELETE CASCADE,
    line_number           integer NOT NULL CHECK (line_number > 0),
    variant_id            bigint NOT NULL REFERENCES catalog.product_variants(id) ON DELETE RESTRICT,
    quantity              numeric(15,4) NOT NULL CHECK (quantity > 0),
    created_at            timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT warehouse_transfer_lines_unique_line UNIQUE (warehouse_transfer_id, line_number)
);

-- 4. Stock Write-Offs Table
CREATE TABLE IF NOT EXISTS inventory.stock_write_offs (
    id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    document_id        bigint UNIQUE REFERENCES core.business_documents(id) ON DELETE RESTRICT,
    warehouse_id       bigint NOT NULL REFERENCES inventory.warehouses(id) ON DELETE RESTRICT,
    reason_code        text NOT NULL CHECK (reason_code IN ('DAMAGED', 'EXPIRED', 'DEFECTIVE', 'STOLEN', 'OTHER')),
    total_cost         numeric(15,2) NOT NULL CHECK (total_cost >= 0),
    note               text,
    created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS inventory.stock_write_off_lines (
    id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    stock_write_off_id bigint NOT NULL REFERENCES inventory.stock_write_offs(id) ON DELETE CASCADE,
    line_number        integer NOT NULL CHECK (line_number > 0),
    variant_id         bigint NOT NULL REFERENCES catalog.product_variants(id) ON DELETE RESTRICT,
    quantity           numeric(15,4) NOT NULL CHECK (quantity > 0),
    unit_cost          numeric(15,2) NOT NULL CHECK (unit_cost >= 0),
    line_cost          numeric(15,2) NOT NULL CHECK (line_cost >= 0),
    created_at         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT stock_write_off_lines_unique_line UNIQUE (stock_write_off_id, line_number)
);

-- 5. Permissions Seed
ALTER TABLE iam.permissions DROP CONSTRAINT IF EXISTS permissions_code_valid;
ALTER TABLE iam.permissions ADD CONSTRAINT permissions_code_valid CHECK (
    code IN (
        'POST_STOCK_RECEIPT', 'POST_CASH_SALE', 'OPEN_CASH_SESSION', 'CLOSE_CASH_SESSION',
        'MANAGE_CATALOG', 'MANAGE_WAREHOUSES', 'MANAGE_INVENTORY', 'MANAGE_PROCUREMENT',
        'POST_PURCHASE_RECEIPT', 'SUSPEND_CASH_SESSION', 'RESUME_CASH_SESSION',
        'APPROVE_CASH_VARIANCE', 'AUTHORIZE_CREDIT_OVERRIDE',
        'POST_CUSTOMER_RETURN', 'POST_STOCK_TRANSFER', 'POST_STOCK_WRITEOFF'
    )
);

INSERT INTO iam.permissions (code, name) VALUES
    ('POST_CUSTOMER_RETURN', 'Confirm a customer product return'),
    ('POST_STOCK_TRANSFER', 'Confirm a warehouse stock transfer'),
    ('POST_STOCK_WRITEOFF', 'Confirm a stock write-off for damaged goods')
ON CONFLICT (code) DO NOTHING;

-- Grant permissions to roles
INSERT INTO iam.role_permissions (role_id, permission_id)
    SELECT r.id, p.id FROM iam.roles r, iam.permissions p
    WHERE r.code IN ('MANAGER', 'ADMIN')
      AND p.code IN ('POST_CUSTOMER_RETURN', 'POST_STOCK_TRANSFER', 'POST_STOCK_WRITEOFF')
ON CONFLICT DO NOTHING;

INSERT INTO iam.role_permissions (role_id, permission_id)
    SELECT r.id, p.id FROM iam.roles r, iam.permissions p
    WHERE r.code = 'CASHIER'
      AND p.code IN ('POST_CUSTOMER_RETURN')
ON CONFLICT DO NOTHING;

GRANT SELECT ON sales.customer_returns TO stockiha_runtime;
GRANT SELECT ON sales.customer_return_lines TO stockiha_runtime;
GRANT SELECT ON inventory.warehouse_transfers TO stockiha_runtime;
GRANT SELECT ON inventory.warehouse_transfer_lines TO stockiha_runtime;
GRANT SELECT ON inventory.stock_write_offs TO stockiha_runtime;
GRANT SELECT ON inventory.stock_write_off_lines TO stockiha_runtime;
