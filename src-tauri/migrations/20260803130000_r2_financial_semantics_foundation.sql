-- R2: typed financial account roles, dedicated procurement permissions, and
-- detection-only reporting for journals posted by the pre-R2 S3 functions.
--
-- TVA and discounts are deliberately disabled for the MVP. The application
-- must reject non-zero tax/discount totals until a later, approved migration
-- introduces effective-dated fiscal policy and immutable posting snapshots.
SET ROLE stockiha_owner;

CREATE TYPE finance.account_role_code AS ENUM (
    'INVENTORY',
    'GRNI',
    'ACCOUNTS_PAYABLE',
    'CASH',
    'BANK',
    'PROCUREMENT_VARIANCE'
);

CREATE TABLE finance.account_role_mappings (
    role_code     finance.account_role_code PRIMARY KEY,
    account_code  text NOT NULL,
    description   text NOT NULL,
    is_active     boolean NOT NULL DEFAULT true,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT account_role_mapping_code_not_blank CHECK (btrim(account_code) <> ''),
    CONSTRAINT account_role_mapping_description_not_blank CHECK (btrim(description) <> '')
);

CREATE TRIGGER account_role_mappings_set_updated_at
    BEFORE UPDATE ON finance.account_role_mappings
    FOR EACH ROW
    EXECUTE FUNCTION core.set_updated_at();

-- These are semantic account identifiers, not approved Algerian SCF numbers.
-- Replacing them with accountant-approved SCF codes is a future data migration;
-- posting functions resolve roles instead of embedding either representation.
INSERT INTO finance.account_role_mappings (role_code, account_code, description) VALUES
    ('INVENTORY', 'INVENTORY_MERCHANDISE', 'Merchandise inventory asset'),
    ('GRNI', 'GOODS_RECEIVED_NOT_INVOICED', 'Goods received not invoiced clearing'),
    ('ACCOUNTS_PAYABLE', 'ACCOUNTS_PAYABLE', 'Supplier trade payables'),
    ('CASH', 'CASH_DESK', 'Cash on hand'),
    ('BANK', 'BANK_ACCOUNT', 'Bank current account'),
    ('PROCUREMENT_VARIANCE', 'PROCUREMENT_VARIANCE', 'Purchase and landed-cost variance');

CREATE FUNCTION finance.require_account_role(p_role finance.account_role_code)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_account_code text;
BEGIN
    SELECT m.account_code
    INTO v_account_code
    FROM finance.account_role_mappings m
    WHERE m.role_code = p_role
      AND m.is_active;

    IF v_account_code IS NULL THEN
        RAISE EXCEPTION 'ACCOUNT_ROLE_NOT_CONFIGURED: required account role % is unavailable', p_role
            USING ERRCODE = '55000';
    END IF;

    RETURN v_account_code;
END;
$$;

REVOKE ALL ON finance.account_role_mappings FROM PUBLIC;
REVOKE ALL ON FUNCTION finance.require_account_role(finance.account_role_code) FROM PUBLIC;

-- Extend the closed permission vocabulary without reconstructing the older
-- migration chain's accumulated CHECK expression.
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
        'ALTER TABLE iam.permissions ADD CONSTRAINT permissions_code_valid CHECK ((%s) OR code = ANY (ARRAY[%L,%L,%L]::text[]))',
        v_existing_check,
        'POST_SUPPLIER_INVOICE',
        'POST_SUPPLIER_RETURN',
        'POST_SUPPLIER_PAYMENT'
    );
END;
$$;

INSERT INTO iam.permissions (code, name) VALUES
    ('POST_SUPPLIER_INVOICE', 'Confirm supplier invoices'),
    ('POST_SUPPLIER_RETURN', 'Confirm supplier returns and debit notes'),
    ('POST_SUPPLIER_PAYMENT', 'Post allocated supplier payments')
ON CONFLICT (code) DO NOTHING;

INSERT INTO iam.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM iam.roles r
CROSS JOIN iam.permissions p
WHERE r.code IN ('ADMIN', 'MANAGER')
  AND p.code IN ('POST_SUPPLIER_INVOICE', 'POST_SUPPLIER_RETURN', 'POST_SUPPLIER_PAYMENT')
ON CONFLICT DO NOTHING;

-- No tax or discount fields exist in the MVP supplier invoice contract. Lock
-- that policy at the database boundary: totals cannot diverge from subtotals.
ALTER TABLE procurement.supplier_invoices
    ADD CONSTRAINT supplier_invoices_tax_discount_disabled CHECK (
        foreign_total_amount = foreign_subtotal
        AND base_total_amount = base_subtotal
    );

-- A landed-cost allocation is one atomic posting per receipt in the MVP. This
-- gives its AP liability a durable source without modifying posted receipts.
CREATE TABLE procurement.landed_cost_postings (
    receipt_document_id  bigint PRIMARY KEY REFERENCES procurement.purchase_receipts(document_id) ON DELETE RESTRICT,
    supplier_id          bigint NOT NULL REFERENCES procurement.suppliers(id) ON DELETE RESTRICT,
    journal_document_id  bigint NOT NULL UNIQUE REFERENCES finance.journal_entries(document_id) ON DELETE RESTRICT,
    amount               numeric(14, 2) NOT NULL CHECK (amount > 0),
    created_at           timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON procurement.landed_cost_postings FROM PUBLIC;

-- Runtime callers must use SECURITY DEFINER posting functions. Direct edits
-- could otherwise bypass allocation, period, permission, and journal checks.
REVOKE INSERT, UPDATE, DELETE ON procurement.supplier_liabilities FROM stockiha_runtime;

CREATE VIEW finance.s3_semantic_defect_report
WITH (security_invoker = true)
AS
SELECT
    'RECEIPT_POSTED_TO_AP'::text AS defect_code,
    je.source_type,
    je.source_id,
    je.document_id AS journal_document_id,
    jsonb_build_object('expected_credit_role', 'GRNI') AS details
FROM finance.journal_entries je
WHERE je.source_type = 'PURCHASE_RECEIPT'
  AND je.description = 'Purchase goods receipt'
  AND EXISTS (
      SELECT 1
      FROM finance.journal_lines jl
      WHERE jl.document_id = je.document_id
        AND jl.account_code = 'ACCOUNTS_PAYABLE'
        AND jl.credit > 0
  )
UNION ALL
SELECT
    'INVOICE_AP_SELF_OFFSET',
    je.source_type,
    je.source_id,
    je.document_id,
    jsonb_build_object('expected_debit_role', 'GRNI', 'expected_credit_role', 'ACCOUNTS_PAYABLE')
FROM finance.journal_entries je
WHERE je.source_type = 'PURCHASE_INVOICE'
  AND EXISTS (
      SELECT 1
      FROM finance.journal_lines jl
      WHERE jl.document_id = je.document_id
      GROUP BY jl.document_id
      HAVING bool_and(jl.account_code = 'ACCOUNTS_PAYABLE')
  )
UNION ALL
SELECT
    'RETURN_AP_ONLY',
    je.source_type,
    je.source_id,
    je.document_id,
    jsonb_build_object('expected_credit_role', 'INVENTORY')
FROM finance.journal_entries je
WHERE je.source_type = 'PURCHASE_RETURN'
  AND EXISTS (
      SELECT 1
      FROM finance.journal_lines jl
      WHERE jl.document_id = je.document_id
      GROUP BY jl.document_id
      HAVING bool_and(jl.account_code = 'ACCOUNTS_PAYABLE')
  )
UNION ALL
SELECT
    'PAYMENT_WRONG_FUNDING_ACCOUNT',
    je.source_type,
    je.source_id,
    je.document_id,
    jsonb_build_object('payment_method', sp.payment_method, 'expected_credit_role', 'BANK')
FROM finance.journal_entries je
JOIN procurement.supplier_payments sp ON sp.document_id = je.source_id
WHERE je.source_type = 'SUPPLIER_PAYMENT'
  AND upper(sp.payment_method) IN ('BANK_TRANSFER', 'CHECK')
  AND EXISTS (
      SELECT 1
      FROM finance.journal_lines jl
      WHERE jl.document_id = je.document_id
        AND jl.account_code = 'CASH_DESK'
        AND jl.credit > 0
  )
UNION ALL
SELECT
    'RECEIPT_CREATED_AP_LIABILITY',
    'PURCHASE_RECEIPT',
    l.receipt_document_id,
    l.journal_document_id,
    jsonb_build_object('liability_id', l.id, 'expected_role', 'GRNI')
FROM procurement.supplier_liabilities l
WHERE l.receipt_document_id IS NOT NULL
  AND l.invoice_document_id IS NULL
  AND NOT EXISTS (
      SELECT 1
      FROM procurement.landed_cost_postings lcp
      WHERE lcp.journal_document_id = l.journal_document_id
  );

REVOKE ALL ON finance.s3_semantic_defect_report FROM PUBLIC;

CREATE FUNCTION procurement.list_s3_semantic_defects(p_session_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_result jsonb;
BEGIN
    PERFORM 1
    FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_PROCUREMENT');

    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'defect_code', r.defect_code,
                'source_type', r.source_type,
                'source_id', r.source_id,
                'journal_document_id', r.journal_document_id,
                'details', r.details,
                'correction_policy', 'APPEND_ONLY_LINKED_ADJUSTMENT'
            )
            ORDER BY r.journal_document_id, r.defect_code
        ),
        '[]'::jsonb
    )
    INTO v_result
    FROM finance.s3_semantic_defect_report r;

    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION procurement.list_s3_semantic_defects(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION procurement.list_s3_semantic_defects(text) TO stockiha_runtime;

RESET ROLE;
