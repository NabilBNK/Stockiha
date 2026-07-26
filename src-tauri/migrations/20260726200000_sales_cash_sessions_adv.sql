-- S4-002: Advanced Cashier Sessions & Credit Limit Override Tokens Schema
--
-- Extends sales.cash_sessions with SUSPENDED and PENDING_APPROVAL states,
-- adds denomination entry tracking, single-use credit limit override tokens,
-- and seed permissions for authorization.

-- 1. Adjust cash_sessions constraints to support SUSPENDED & PENDING_APPROVAL
ALTER TABLE sales.cash_sessions DROP CONSTRAINT IF EXISTS cash_sessions_status_valid;
ALTER TABLE sales.cash_sessions ADD CONSTRAINT cash_sessions_status_valid
    CHECK (status IN ('OPEN', 'SUSPENDED', 'PENDING_APPROVAL', 'CLOSED'));

ALTER TABLE sales.cash_sessions DROP CONSTRAINT IF EXISTS cash_sessions_close_snapshot_set_iff_closed;
ALTER TABLE sales.cash_sessions ADD CONSTRAINT cash_sessions_close_snapshot_set_iff_closed
    CHECK (
        (status IN ('OPEN', 'SUSPENDED')
            AND closed_by_user_id IS NULL
            AND expected_amount IS NULL
            AND counted_amount IS NULL
            AND variance_amount IS NULL
            AND closed_at IS NULL)
        OR (status IN ('PENDING_APPROVAL', 'CLOSED')
            AND closed_by_user_id IS NOT NULL
            AND expected_amount IS NOT NULL
            AND counted_amount IS NOT NULL
            AND variance_amount IS NOT NULL
            AND closed_at IS NOT NULL)
    );

-- Replace index to allow only ONE active/open/suspended/pending session per workstation
DROP INDEX IF EXISTS sales.cash_sessions_one_open_per_workstation;
CREATE UNIQUE INDEX IF NOT EXISTS cash_sessions_one_active_per_workstation
    ON sales.cash_sessions (workstation_id)
    WHERE status IN ('OPEN', 'SUSPENDED', 'PENDING_APPROVAL');

-- 2. Denomination entry log at closing
CREATE TABLE IF NOT EXISTS sales.cash_session_denominations (
    id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    cash_session_id  bigint NOT NULL REFERENCES sales.cash_sessions (id) ON DELETE CASCADE,
    denomination     numeric(14, 2) NOT NULL CHECK (denomination > 0),
    bill_count       integer NOT NULL CHECK (bill_count >= 0),
    total_amount     numeric(14, 2) NOT NULL CHECK (total_amount >= 0),
    created_at       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT cash_session_denominations_unique UNIQUE (cash_session_id, denomination)
);

-- 3. Credit limit single-use manager override tokens
CREATE TABLE IF NOT EXISTS sales.credit_override_tokens (
    id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    token                uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    customer_id          bigint NOT NULL REFERENCES sales.customers (id) ON DELETE RESTRICT,
    payload_hash         bytea NOT NULL,
    generated_by_user_id bigint NOT NULL REFERENCES iam.users (id) ON DELETE RESTRICT,
    expires_at           timestamptz NOT NULL,
    used_at              timestamptz,
    is_invalidated       boolean NOT NULL DEFAULT FALSE,
    created_at           timestamptz NOT NULL DEFAULT now()
);

-- 4. Seed new IAM permissions
ALTER TABLE iam.permissions DROP CONSTRAINT IF EXISTS permissions_code_valid;
ALTER TABLE iam.permissions ADD CONSTRAINT permissions_code_valid CHECK (
    code IN (
        'POST_STOCK_RECEIPT', 'POST_CASH_SALE', 'OPEN_CASH_SESSION', 'CLOSE_CASH_SESSION',
        'MANAGE_CATALOG', 'MANAGE_WAREHOUSES', 'MANAGE_INVENTORY', 'MANAGE_PROCUREMENT',
        'POST_PURCHASE_RECEIPT', 'SUSPEND_CASH_SESSION', 'RESUME_CASH_SESSION',
        'APPROVE_CASH_VARIANCE', 'AUTHORIZE_CREDIT_OVERRIDE'
    )
);

INSERT INTO iam.permissions (code, name) VALUES
    ('SUSPEND_CASH_SESSION', 'Suspend an active cash session'),
    ('RESUME_CASH_SESSION', 'Resume a suspended cash session'),
    ('APPROVE_CASH_VARIANCE', 'Approve a cash session closing variance'),
    ('AUTHORIZE_CREDIT_OVERRIDE', 'Generate a single-use credit limit override token')
ON CONFLICT (code) DO NOTHING;

-- Grant new permissions to MANAGER and ADMIN roles
INSERT INTO iam.role_permissions (role_id, permission_id)
    SELECT r.id, p.id FROM iam.roles r, iam.permissions p
    WHERE r.code IN ('MANAGER', 'ADMIN')
      AND p.code IN ('SUSPEND_CASH_SESSION', 'RESUME_CASH_SESSION', 'APPROVE_CASH_VARIANCE', 'AUTHORIZE_CREDIT_OVERRIDE')
ON CONFLICT DO NOTHING;

-- Grant cashier suspend/resume permissions
INSERT INTO iam.role_permissions (role_id, permission_id)
    SELECT r.id, p.id FROM iam.roles r, iam.permissions p
    WHERE r.code = 'CASHIER'
      AND p.code IN ('SUSPEND_CASH_SESSION', 'RESUME_CASH_SESSION')
ON CONFLICT DO NOTHING;

GRANT SELECT ON sales.cash_session_denominations TO stockiha_runtime;
GRANT SELECT ON sales.credit_override_tokens TO stockiha_runtime;
