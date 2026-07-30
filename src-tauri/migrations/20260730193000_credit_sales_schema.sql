-- S4-001: Customer credit-sale document schema.
SET ROLE stockiha_owner;

-- Extend shared document vocabularies as a strict superset of every type
-- introduced by S1-S3. A later slice must never make an older valid document
-- or sequence type invalid merely by replacing the closed CHECK list.
ALTER TABLE core.business_documents DROP CONSTRAINT IF EXISTS business_documents_type_valid;
ALTER TABLE core.business_documents ADD CONSTRAINT business_documents_type_valid
    CHECK (document_type IN (
        'CASH_SALE',
        'CREDIT_SALE',
        'JOURNAL_ENTRY',
        'STOCK_RECEIPT',
        'STOCK_ADJUSTMENT',
        'PURCHASE_ORDER',
        'PURCHASE_RECEIPT',
        'PURCHASE_INVOICE',
        'SUPPLIER_CREDIT_NOTE',
        'PURCHASE_RETURN',
        'DEBIT_NOTE',
        'SUPPLIER_PAYMENT'
    ));

ALTER TABLE core.document_sequences DROP CONSTRAINT IF EXISTS document_sequences_type_valid;
ALTER TABLE core.document_sequences ADD CONSTRAINT document_sequences_type_valid
    CHECK (document_type IN (
        'CASH_SALE',
        'CREDIT_SALE',
        'JOURNAL_ENTRY',
        'STOCK_RECEIPT',
        'STOCK_ADJUSTMENT',
        'PURCHASE_ORDER',
        'PURCHASE_RECEIPT',
        'PURCHASE_INVOICE',
        'SUPPLIER_CREDIT_NOTE',
        'PURCHASE_RETURN',
        'DEBIT_NOTE',
        'SUPPLIER_PAYMENT'
    ));

CREATE TABLE sales.credit_sales (
    document_id            bigint PRIMARY KEY REFERENCES core.business_documents (id),
    customer_id            bigint NOT NULL REFERENCES receivables.customers (id),
    warehouse_id           bigint NOT NULL REFERENCES inventory.warehouses (id),
    subtotal               numeric(14, 2) NOT NULL DEFAULT 0,
    total_amount           numeric(14, 2) NOT NULL DEFAULT 0,
    due_date               date NOT NULL,
    journal_document_id    bigint UNIQUE REFERENCES finance.journal_entries (document_id),
    posted_by_user_id      bigint NOT NULL REFERENCES iam.users (id),
    workstation_id         text NOT NULL,
    created_at             timestamptz NOT NULL DEFAULT now(),
    updated_at             timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT credit_sales_subtotal_non_negative CHECK (subtotal >= 0),
    CONSTRAINT credit_sales_total_non_negative CHECK (total_amount >= 0),
    CONSTRAINT credit_sales_total_matches_subtotal CHECK (total_amount = subtotal),
    CONSTRAINT credit_sales_workstation_not_blank CHECK (btrim(workstation_id) <> '')
);

CREATE TABLE sales.credit_sale_lines (
    id                      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    document_id             bigint NOT NULL REFERENCES sales.credit_sales (document_id) ON DELETE CASCADE,
    line_number             integer NOT NULL,
    variant_id              bigint NOT NULL REFERENCES catalog.product_variants (id),
    variant_sku_snapshot    text NOT NULL,
    variant_name_snapshot   text NOT NULL,
    quantity                numeric(18, 3) NOT NULL,
    unit_price              numeric(14, 2) NOT NULL,
    unit_cost_snapshot      numeric(18, 4) NOT NULL,
    line_total              numeric(14, 2) NOT NULL,
    created_at              timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT credit_sale_lines_line_number_unique UNIQUE (document_id, line_number),
    CONSTRAINT credit_sale_lines_line_number_positive CHECK (line_number > 0),
    CONSTRAINT credit_sale_lines_quantity_positive CHECK (quantity > 0),
    CONSTRAINT credit_sale_lines_unit_price_non_negative CHECK (unit_price >= 0),
    CONSTRAINT credit_sale_lines_unit_cost_non_negative CHECK (unit_cost_snapshot >= 0),
    CONSTRAINT credit_sale_lines_total_non_negative CHECK (line_total >= 0),
    CONSTRAINT credit_sale_lines_total_matches CHECK (line_total = round(quantity * unit_price, 2))
);

CREATE TRIGGER credit_sales_set_updated_at
    BEFORE UPDATE ON sales.credit_sales
    FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

CREATE FUNCTION sales.forbid_posted_credit_sale_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_document_id bigint;
    v_status text;
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_document_id := OLD.document_id;
    ELSE
        v_document_id := NEW.document_id;
    END IF;

    SELECT status INTO v_status FROM core.business_documents WHERE id = v_document_id;
    IF v_status IN ('POSTED', 'REVERSED') THEN
        RAISE EXCEPTION 'posted or reversed credit sales are immutable' USING ERRCODE = '0A000';
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER credit_sales_forbid_posted_update
    BEFORE UPDATE ON sales.credit_sales
    FOR EACH ROW EXECUTE FUNCTION sales.forbid_posted_credit_sale_mutation();
CREATE TRIGGER credit_sales_forbid_posted_delete
    BEFORE DELETE ON sales.credit_sales
    FOR EACH ROW EXECUTE FUNCTION sales.forbid_posted_credit_sale_mutation();
CREATE TRIGGER credit_sale_lines_forbid_posted_update
    BEFORE UPDATE ON sales.credit_sale_lines
    FOR EACH ROW EXECUTE FUNCTION sales.forbid_posted_credit_sale_mutation();
CREATE TRIGGER credit_sale_lines_forbid_posted_delete
    BEFORE DELETE ON sales.credit_sale_lines
    FOR EACH ROW EXECUTE FUNCTION sales.forbid_posted_credit_sale_mutation();

REVOKE ALL ON sales.credit_sales FROM PUBLIC;
REVOKE ALL ON sales.credit_sale_lines FROM PUBLIC;
REVOKE ALL ON sales.credit_sales FROM stockiha_runtime;
REVOKE ALL ON sales.credit_sale_lines FROM stockiha_runtime;
REVOKE ALL ON FUNCTION sales.forbid_posted_credit_sale_mutation() FROM PUBLIC;

RESET ROLE;
