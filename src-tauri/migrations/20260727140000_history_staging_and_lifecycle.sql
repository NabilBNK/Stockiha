-- Slice 7: Sandbox Reconstruction & Historical Importer Schemas and Tables
CREATE SCHEMA IF NOT EXISTS history;
CREATE SCHEMA IF NOT EXISTS reconstruction;

-- Import Batches Table
CREATE TABLE IF NOT EXISTS history.import_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_number TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL CHECK (status IN ('STAGING', 'VALIDATING', 'NEEDS_REVIEW', 'VALIDATED', 'LOCKED')),
    file_name TEXT NOT NULL,
    total_rows INT NOT NULL DEFAULT 0,
    valid_rows INT NOT NULL DEFAULT 0,
    error_rows INT NOT NULL DEFAULT 0,
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    validated_at TIMESTAMPTZ,
    locked_at TIMESTAMPTZ
);

-- Staged Records Table
CREATE TABLE IF NOT EXISTS history.staged_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id UUID NOT NULL REFERENCES history.import_batches(id) ON DELETE CASCADE,
    row_number INT NOT NULL,
    entity_type TEXT NOT NULL CHECK (entity_type IN ('PRODUCT', 'STOCK_RECEIPT', 'CUSTOMER_BALANCE', 'SUPPLIER_BALANCE')),
    raw_json JSONB NOT NULL,
    corrected_json JSONB,
    validation_errors JSONB,
    status TEXT NOT NULL CHECK (status IN ('PENDING', 'VALID', 'ERROR', 'CORRECTED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_batch_row UNIQUE (batch_id, row_number)
);

CREATE INDEX IF NOT EXISTS idx_staged_records_batch ON history.staged_records(batch_id);
CREATE INDEX IF NOT EXISTS idx_staged_records_status ON history.staged_records(status);

-- Seed IAM Permissions for Historical Import Engine
INSERT INTO iam.permissions (permission_code, description)
VALUES 
    ('IMPORT_HISTORICAL_DATA', 'Ability to upload and stage historical CSV/Excel data'),
    ('REVIEW_HISTORICAL_BATCH', 'Ability to edit and fix validation errors in historical batches'),
    ('COMMIT_HISTORICAL_BATCH', 'Ability to execute sandbox replay and commit historical data to ledgers')
ON CONFLICT (permission_code) DO NOTHING;
