-- Migration: 20260725130000_procurement_landed_cost_and_invoices.sql
-- Description: Landed cost attribution schema, supplier invoices, multi-currency support, and document types.

BEGIN;

-- 1. Extend business document type constraint
ALTER TABLE core.business_documents
  DROP CONSTRAINT IF EXISTS business_documents_type_valid;

ALTER TABLE core.business_documents
  ADD CONSTRAINT business_documents_type_valid CHECK (
    document_type IN (
      'STOCK_RECEIPT',
      'STOCK_ADJUSTMENT',
      'CASH_SALE',
      'PURCHASE_ORDER',
      'PURCHASE_RECEIPT',
      'PURCHASE_INVOICE',
      'SUPPLIER_CREDIT_NOTE',
      'JOURNAL_ENTRY'
    )
  );

ALTER TABLE core.document_sequences
  DROP CONSTRAINT IF EXISTS document_sequences_type_valid;

ALTER TABLE core.document_sequences
  ADD CONSTRAINT document_sequences_type_valid CHECK (
    document_type IN (
      'STOCK_RECEIPT',
      'STOCK_ADJUSTMENT',
      'CASH_SALE',
      'PURCHASE_ORDER',
      'PURCHASE_RECEIPT',
      'PURCHASE_INVOICE',
      'SUPPLIER_CREDIT_NOTE',
      'JOURNAL_ENTRY'
    )
  );

-- 2. Landed cost auxiliary attribution table
CREATE TABLE IF NOT EXISTS inventory.receipt_cost_attribution (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    receipt_line_id bigint NOT NULL REFERENCES procurement.purchase_receipt_lines(id) ON DELETE RESTRICT,
    variant_id bigint NOT NULL REFERENCES catalog.product_variants(id) ON DELETE RESTRICT,
    warehouse_id bigint NOT NULL REFERENCES inventory.warehouses(id) ON DELETE RESTRICT,
    original_quantity numeric(14,3) NOT NULL CHECK (original_quantity > 0),
    attributed_remaining_quantity numeric(14,3) NOT NULL CHECK (attributed_remaining_quantity >= 0),
    original_unit_cost numeric(14,2) NOT NULL CHECK (original_unit_cost >= 0),
    late_cost_allocated numeric(14,2) NOT NULL DEFAULT 0.00 CHECK (late_cost_allocated >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_receipt_cost_attr_line ON inventory.receipt_cost_attribution(receipt_line_id);
CREATE INDEX IF NOT EXISTS idx_receipt_cost_attr_var_wh ON inventory.receipt_cost_attribution(variant_id, warehouse_id);

-- 3. Supplier Invoices Header
CREATE TABLE IF NOT EXISTS procurement.supplier_invoices (
    document_id bigint PRIMARY KEY REFERENCES core.business_documents(id) ON DELETE RESTRICT,
    supplier_id bigint NOT NULL REFERENCES procurement.suppliers(id) ON DELETE RESTRICT,
    purchase_order_id bigint REFERENCES procurement.purchase_orders(document_id) ON DELETE RESTRICT,
    currency_code text NOT NULL DEFAULT 'DZD' CHECK (length(trim(currency_code)) >= 3),
    exchange_rate_to_dzd numeric(14,6) NOT NULL DEFAULT 1.000000 CHECK (exchange_rate_to_dzd > 0),
    foreign_subtotal numeric(14,2) NOT NULL DEFAULT 0.00 CHECK (foreign_subtotal >= 0),
    foreign_total_amount numeric(14,2) NOT NULL DEFAULT 0.00 CHECK (foreign_total_amount >= 0),
    base_subtotal numeric(14,2) NOT NULL DEFAULT 0.00 CHECK (base_subtotal >= 0),
    base_total_amount numeric(14,2) NOT NULL DEFAULT 0.00 CHECK (base_total_amount >= 0),
    note text,
    created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE procurement.supplier_liabilities
  ALTER COLUMN receipt_document_id DROP NOT NULL,
  ALTER COLUMN purchase_order_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS invoice_document_id bigint REFERENCES procurement.supplier_invoices(document_id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS due_date date;

-- 4. Supplier Invoice Lines
CREATE TABLE IF NOT EXISTS procurement.supplier_invoice_lines (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    document_id bigint NOT NULL REFERENCES procurement.supplier_invoices(document_id) ON DELETE CASCADE,
    line_number integer NOT NULL CHECK (line_number > 0),
    po_line_id bigint REFERENCES procurement.purchase_order_lines(id) ON DELETE RESTRICT,
    receipt_line_id bigint REFERENCES procurement.purchase_receipt_lines(id) ON DELETE RESTRICT,
    variant_id bigint NOT NULL REFERENCES catalog.product_variants(id) ON DELETE RESTRICT,
    quantity numeric(14,3) NOT NULL CHECK (quantity > 0),
    unit_cost numeric(14,2) NOT NULL CHECK (unit_cost >= 0),
    line_total numeric(14,2) NOT NULL CHECK (line_total >= 0),
    CONSTRAINT supplier_invoice_lines_unique_line UNIQUE (document_id, line_number)
);

COMMIT;
