-- S4-001: Customer master, credit-state lock boundary, and receivables ledger foundation
SET ROLE stockiha_owner;

CREATE SCHEMA IF NOT EXISTS receivables;
REVOKE ALL ON SCHEMA receivables FROM PUBLIC;
GRANT USAGE ON SCHEMA receivables TO stockiha_runtime;

-- Extend the existing closed permission vocabulary instead of replacing it
-- with a copied list. The prior CHECK remains authoritative for every code
-- accepted by the installed S0-S3 database; S4 adds only its new codes.
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
        'ALTER TABLE iam.permissions ADD CONSTRAINT permissions_code_valid CHECK ((%s) OR code IN (%L, %L, %L, %L))',
        v_existing_check,
        'MANAGE_CUSTOMERS',
        'POST_CREDIT_SALE',
        'POST_CUSTOMER_PAYMENT',
        'OVERRIDE_CREDIT_LIMIT'
    );
END;
$$;

INSERT INTO iam.permissions (code, name) VALUES
    ('MANAGE_CUSTOMERS', 'Manage customer master data and credit policy'),
    ('POST_CREDIT_SALE', 'Confirm customer credit sales'),
    ('POST_CUSTOMER_PAYMENT', 'Post customer receivable payments'),
    ('OVERRIDE_CREDIT_LIMIT', 'Authorize a single customer credit override')
ON CONFLICT (code) DO NOTHING;

INSERT INTO iam.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM iam.roles r
CROSS JOIN iam.permissions p
WHERE r.code IN ('ADMIN', 'MANAGER')
  AND p.code IN ('MANAGE_CUSTOMERS', 'POST_CREDIT_SALE', 'POST_CUSTOMER_PAYMENT', 'OVERRIDE_CREDIT_LIMIT')
ON CONFLICT DO NOTHING;

-- Customer master directory. Master data is editable; financial state is not stored here.
CREATE TABLE receivables.customers (
    id                         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code                       text NOT NULL UNIQUE,
    name                       text NOT NULL,
    contact_name               text,
    phone                      text,
    email                      text,
    address                    text,
    tax_id                     text,
    is_active                  boolean NOT NULL DEFAULT true,
    credit_enabled             boolean NOT NULL DEFAULT false,
    credit_limit               numeric(14, 2) NOT NULL DEFAULT 0,
    payment_terms_days         integer NOT NULL DEFAULT 0,
    max_overdue_days           integer,
    created_at                 timestamptz NOT NULL DEFAULT now(),
    updated_at                 timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT customers_code_not_blank CHECK (btrim(code) <> ''),
    CONSTRAINT customers_name_not_blank CHECK (btrim(name) <> ''),
    CONSTRAINT customers_credit_limit_non_negative CHECK (credit_limit >= 0),
    CONSTRAINT customers_payment_terms_non_negative CHECK (payment_terms_days >= 0),
    CONSTRAINT customers_max_overdue_non_negative CHECK (max_overdue_days IS NULL OR max_overdue_days >= 0),
    CONSTRAINT customers_credit_policy_consistent CHECK (
        credit_enabled OR (credit_limit = 0 AND payment_terms_days = 0 AND max_overdue_days IS NULL)
    )
);

CREATE TRIGGER customers_update_timestamp
    BEFORE UPDATE ON receivables.customers
    FOR EACH ROW
    EXECUTE FUNCTION core.set_updated_at();

-- One row per customer. Posting functions lock this row FOR UPDATE before evaluating
-- or changing credit exposure so concurrent sales cannot jointly exceed the limit.
CREATE TABLE receivables.customer_credit_state (
    customer_id                bigint PRIMARY KEY REFERENCES receivables.customers (id),
    exposure_amount            numeric(14, 2) NOT NULL DEFAULT 0,
    oldest_open_due_date       date,
    last_rebuilt_at            timestamptz NOT NULL DEFAULT now(),
    updated_at                 timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT customer_credit_exposure_non_negative CHECK (exposure_amount >= 0)
);

CREATE TRIGGER customer_credit_state_update_timestamp
    BEFORE UPDATE ON receivables.customer_credit_state
    FOR EACH ROW
    EXECUTE FUNCTION core.set_updated_at();

CREATE FUNCTION receivables.ensure_customer_credit_state()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO receivables.customer_credit_state (customer_id)
    VALUES (NEW.id)
    ON CONFLICT (customer_id) DO NOTHING;
    RETURN NEW;
END;
$$;

CREATE TRIGGER customers_create_credit_state
    AFTER INSERT ON receivables.customers
    FOR EACH ROW
    EXECUTE FUNCTION receivables.ensure_customer_credit_state();

-- Append-only receivables ledger. Positive amounts increase customer exposure;
-- negative amounts reduce it. document_id is optional during foundation work and
-- will become populated by posting functions as credit invoices/payments land.
CREATE TABLE receivables.customer_ledger_entries (
    id                         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    customer_id                bigint NOT NULL REFERENCES receivables.customers (id),
    entry_type                 text NOT NULL,
    amount_delta               numeric(14, 2) NOT NULL,
    document_id                bigint REFERENCES core.business_documents (id),
    related_entry_id           bigint REFERENCES receivables.customer_ledger_entries (id),
    due_date                   date,
    posted_by_user_id          bigint NOT NULL REFERENCES iam.users (id),
    workstation_id             text NOT NULL,
    created_at                 timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT customer_ledger_amount_non_zero CHECK (amount_delta <> 0),
    CONSTRAINT customer_ledger_type_valid CHECK (
        entry_type IN ('CREDIT_INVOICE', 'DEBIT_NOTE', 'CREDIT_NOTE', 'PAYMENT', 'WRITE_OFF', 'ADJUSTMENT')
    ),
    CONSTRAINT customer_ledger_document_type_unique UNIQUE (document_id, entry_type)
);

CREATE INDEX customer_ledger_customer_created_idx
    ON receivables.customer_ledger_entries (customer_id, created_at DESC, id DESC);

CREATE INDEX customer_ledger_customer_due_idx
    ON receivables.customer_ledger_entries (customer_id, due_date)
    WHERE due_date IS NOT NULL;

CREATE FUNCTION receivables.forbid_customer_ledger_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'posted customer ledger entries are immutable'
        USING ERRCODE = '0A000';
END;
$$;

CREATE TRIGGER customer_ledger_entries_forbid_update
    BEFORE UPDATE ON receivables.customer_ledger_entries
    FOR EACH ROW EXECUTE FUNCTION receivables.forbid_customer_ledger_mutation();

CREATE TRIGGER customer_ledger_entries_forbid_delete
    BEFORE DELETE ON receivables.customer_ledger_entries
    FOR EACH ROW EXECUTE FUNCTION receivables.forbid_customer_ledger_mutation();

-- Manager override tokens are single-use and payload-bound. The payload hash is
-- generated from canonical sale input by the application/posting boundary.
CREATE TABLE receivables.credit_override_tokens (
    id                         uuid PRIMARY KEY,
    customer_id                bigint NOT NULL REFERENCES receivables.customers (id),
    canonical_payload_hash     text NOT NULL,
    authorized_by_user_id      bigint NOT NULL REFERENCES iam.users (id),
    authorization_reason       text NOT NULL,
    expires_at                 timestamptz NOT NULL,
    consumed_at                timestamptz,
    consumed_document_id       bigint UNIQUE REFERENCES core.business_documents (id),
    created_at                 timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT credit_override_hash_not_blank CHECK (btrim(canonical_payload_hash) <> ''),
    CONSTRAINT credit_override_reason_not_blank CHECK (btrim(authorization_reason) <> ''),
    CONSTRAINT credit_override_consumption_consistent CHECK (
        (consumed_at IS NULL AND consumed_document_id IS NULL)
        OR (consumed_at IS NOT NULL AND consumed_document_id IS NOT NULL)
    )
);

CREATE INDEX credit_override_customer_active_idx
    ON receivables.credit_override_tokens (customer_id, expires_at)
    WHERE consumed_at IS NULL;

-- Public/runtime access policy:
-- * customer master may be managed by the application layer (permission checked there today);
-- * financial state/ledger/override rows are SELECT-only to runtime and will only be mutated
--   by SECURITY DEFINER posting functions introduced in the next S4-001 commits.
REVOKE ALL ON receivables.customers FROM PUBLIC;
REVOKE ALL ON receivables.customer_credit_state FROM PUBLIC;
REVOKE ALL ON receivables.customer_ledger_entries FROM PUBLIC;
REVOKE ALL ON receivables.credit_override_tokens FROM PUBLIC;

GRANT SELECT, INSERT, UPDATE ON receivables.customers TO stockiha_runtime;
GRANT SELECT ON receivables.customer_credit_state TO stockiha_runtime;
GRANT SELECT ON receivables.customer_ledger_entries TO stockiha_runtime;
GRANT SELECT ON receivables.credit_override_tokens TO stockiha_runtime;

RESET ROLE;
