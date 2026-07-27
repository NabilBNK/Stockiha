-- Slice 6: Official Document Numbering & Printing Queue Schema

CREATE TABLE IF NOT EXISTS core.print_jobs (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    document_id       bigint REFERENCES core.business_documents(id) ON DELETE CASCADE,
    job_type          text NOT NULL CHECK (job_type IN ('THERMAL_RECEIPT', 'PDF_INVOICE', 'DRAWER_PULSE')),
    format            text NOT NULL CHECK (format IN ('ESC_POS_80MM', 'PDF_A4', 'PDF_A5')),
    status            text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'COMPLETED', 'FAILED')),
    printer_name      text,
    error_message     text,
    created_at        timestamptz NOT NULL DEFAULT now(),
    completed_at      timestamptz
);

-- Seed permissions
ALTER TABLE iam.permissions DROP CONSTRAINT IF EXISTS permissions_code_valid;
ALTER TABLE iam.permissions ADD CONSTRAINT permissions_code_valid CHECK (
    code IN (
        'POST_STOCK_RECEIPT', 'POST_CASH_SALE', 'OPEN_CASH_SESSION', 'CLOSE_CASH_SESSION',
        'MANAGE_CATALOG', 'MANAGE_WAREHOUSES', 'MANAGE_INVENTORY', 'MANAGE_PROCUREMENT',
        'POST_PURCHASE_RECEIPT', 'SUSPEND_CASH_SESSION', 'RESUME_CASH_SESSION',
        'APPROVE_CASH_VARIANCE', 'AUTHORIZE_CREDIT_OVERRIDE',
        'POST_CUSTOMER_RETURN', 'POST_STOCK_TRANSFER', 'POST_STOCK_WRITEOFF',
        'MANAGE_PRINT_JOBS', 'VIEW_PRINT_JOBS'
    )
);

INSERT INTO iam.permissions (code, name) VALUES
    ('MANAGE_PRINT_JOBS', 'Manage and trigger print jobs'),
    ('VIEW_PRINT_JOBS', 'View print job history')
ON CONFLICT (code) DO NOTHING;

INSERT INTO iam.role_permissions (role_id, permission_id)
    SELECT r.id, p.id FROM iam.roles r, iam.permissions p
    WHERE r.code IN ('ADMIN', 'MANAGER', 'CASHIER')
      AND p.code IN ('MANAGE_PRINT_JOBS', 'VIEW_PRINT_JOBS')
ON CONFLICT DO NOTHING;

GRANT SELECT ON core.print_jobs TO stockiha_runtime;
