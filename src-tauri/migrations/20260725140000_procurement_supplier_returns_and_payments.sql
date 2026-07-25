-- Update business_documents_type_valid and document_sequences_type_valid constraints
ALTER TABLE core.business_documents DROP CONSTRAINT IF EXISTS business_documents_type_valid;
ALTER TABLE core.business_documents ADD CONSTRAINT business_documents_type_valid
    CHECK (document_type IN (
        'CASH_SALE', 'JOURNAL_ENTRY', 'STOCK_RECEIPT', 'STOCK_ADJUSTMENT',
        'PURCHASE_ORDER', 'PURCHASE_RECEIPT', 'PURCHASE_INVOICE', 'PURCHASE_RETURN', 'SUPPLIER_PAYMENT'
    ));

ALTER TABLE core.document_sequences DROP CONSTRAINT IF EXISTS document_sequences_type_valid;
ALTER TABLE core.document_sequences ADD CONSTRAINT document_sequences_type_valid
    CHECK (document_type IN (
        'CASH_SALE', 'JOURNAL_ENTRY', 'STOCK_RECEIPT', 'STOCK_ADJUSTMENT',
        'PURCHASE_ORDER', 'PURCHASE_RECEIPT', 'PURCHASE_INVOICE', 'DEBIT_NOTE', 'SUPPLIER_PAYMENT'
    ));

CREATE TABLE IF NOT EXISTS procurement.supplier_returns (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    document_id bigint NOT NULL UNIQUE REFERENCES core.business_documents(id) ON DELETE RESTRICT,
    supplier_id bigint NOT NULL REFERENCES procurement.suppliers(id) ON DELETE RESTRICT,
    warehouse_id bigint NOT NULL REFERENCES inventory.warehouses(id) ON DELETE RESTRICT,
    purchase_order_id bigint REFERENCES procurement.purchase_orders(document_id) ON DELETE RESTRICT,
    reason_code text NOT NULL DEFAULT 'DEFECTIVE_GOODS',
    note text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS procurement.supplier_return_lines (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    return_id bigint NOT NULL REFERENCES procurement.supplier_returns(id) ON DELETE CASCADE,
    line_number integer NOT NULL,
    variant_id bigint NOT NULL REFERENCES catalog.product_variants(id) ON DELETE RESTRICT,
    quantity numeric(14,4) NOT NULL CHECK (quantity > 0),
    unit_cost numeric(14,4) NOT NULL CHECK (unit_cost >= 0),
    line_total numeric(14,2) NOT NULL CHECK (line_total >= 0),
    UNIQUE (return_id, line_number)
);

CREATE TABLE IF NOT EXISTS procurement.supplier_payments (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    document_id bigint NOT NULL UNIQUE REFERENCES core.business_documents(id) ON DELETE RESTRICT,
    supplier_id bigint NOT NULL REFERENCES procurement.suppliers(id) ON DELETE RESTRICT,
    liability_id bigint REFERENCES procurement.supplier_liabilities(id) ON DELETE RESTRICT,
    payment_method text NOT NULL DEFAULT 'CASH',
    amount numeric(14,2) NOT NULL CHECK (amount > 0),
    reference_number text,
    note text,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Immutability Triggers
CREATE OR REPLACE FUNCTION procurement.forbid_return_mutation()
RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'IMMUTABLE_RECORD: Confirmed supplier return records cannot be modified or deleted'
        USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER supplier_returns_forbid_update
    BEFORE UPDATE ON procurement.supplier_returns
    FOR EACH ROW EXECUTE FUNCTION procurement.forbid_return_mutation();

CREATE TRIGGER supplier_returns_forbid_delete
    BEFORE DELETE ON procurement.supplier_returns
    FOR EACH ROW EXECUTE FUNCTION procurement.forbid_return_mutation();

-- Grants
-- Table permissions granted via schema-level usage

