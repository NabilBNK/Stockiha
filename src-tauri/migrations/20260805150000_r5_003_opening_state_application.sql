-- R5-003: atomically apply one approved opening-state package to controlled
-- financial and counterparty subledgers. This never replays historical
-- transactions and never fabricates physical inventory quantities or WAC.
SET ROLE stockiha_owner;

-- Dedicated application permission. Opening-state application remains a
-- CEO/administrator-only cutover action.
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
        'ALTER TABLE iam.permissions ADD CONSTRAINT permissions_code_valid CHECK ((%s) OR code = %L)',
        v_existing_check,
        'APPLY_OPENING_STATE'
    );
END;
$$;

INSERT INTO iam.permissions (code, name)
VALUES ('APPLY_OPENING_STATE', 'Apply one approved opening state to live ledgers')
ON CONFLICT (code) DO NOTHING;

INSERT INTO iam.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM iam.roles r
CROSS JOIN iam.permissions p
WHERE r.code IN ('ADMIN', 'CEO')
  AND p.code = 'APPLY_OPENING_STATE'
ON CONFLICT DO NOTHING;

ALTER TABLE onboarding.feature_settings
    ADD COLUMN opening_state_application_enabled boolean NOT NULL DEFAULT true;

-- Controlled semantic account options. These are internal semantic account
-- identifiers, not certified Algerian SCF numbers. Accountant-approved codes
-- can replace them later without changing the application contract.
CREATE TABLE finance.opening_state_allowed_accounts (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    line_type     text NOT NULL,
    account_code  text NOT NULL,
    normal_side   text NOT NULL,
    description   text NOT NULL,
    is_default    boolean NOT NULL DEFAULT false,
    is_active     boolean NOT NULL DEFAULT true,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT opening_state_allowed_accounts_line_type_valid CHECK (line_type IN (
        'CASH', 'BANK', 'INVENTORY_VALUE', 'CUSTOMER_RECEIVABLE',
        'SUPPLIER_PAYABLE', 'LOAN_PAYABLE', 'TAX_PAYABLE',
        'OWNER_CAPITAL', 'RETAINED_EARNINGS', 'OTHER_ASSET', 'OTHER_LIABILITY'
    )),
    CONSTRAINT opening_state_allowed_accounts_side_valid CHECK (normal_side IN ('DEBIT', 'CREDIT')),
    CONSTRAINT opening_state_allowed_accounts_code_not_blank CHECK (btrim(account_code) <> ''),
    CONSTRAINT opening_state_allowed_accounts_description_not_blank CHECK (btrim(description) <> ''),
    CONSTRAINT opening_state_allowed_accounts_unique UNIQUE (line_type, account_code)
);

CREATE UNIQUE INDEX opening_state_allowed_accounts_default_unique
    ON finance.opening_state_allowed_accounts (line_type)
    WHERE is_default AND is_active;

CREATE TRIGGER opening_state_allowed_accounts_set_updated_at
    BEFORE UPDATE ON finance.opening_state_allowed_accounts
    FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

INSERT INTO finance.opening_state_allowed_accounts
    (line_type, account_code, normal_side, description, is_default)
VALUES
    ('CASH', 'CASH_DESK', 'DEBIT', 'Opening cash on hand', true),
    ('BANK', 'BANK_ACCOUNT', 'DEBIT', 'Opening bank balance', true),
    ('INVENTORY_VALUE', 'INVENTORY_MERCHANDISE', 'DEBIT', 'Opening inventory financial value', true),
    ('CUSTOMER_RECEIVABLE', 'ACCOUNTS_RECEIVABLE', 'DEBIT', 'Opening customer receivables', true),
    ('SUPPLIER_PAYABLE', 'ACCOUNTS_PAYABLE', 'CREDIT', 'Opening supplier payables', true),
    ('LOAN_PAYABLE', 'LOAN_PAYABLE', 'CREDIT', 'Opening loan liabilities', true),
    ('TAX_PAYABLE', 'TAX_PAYABLE', 'CREDIT', 'Opening tax liabilities', true),
    ('OWNER_CAPITAL', 'OWNER_CAPITAL', 'CREDIT', 'Opening owner capital', true),
    ('RETAINED_EARNINGS', 'RETAINED_EARNINGS', 'CREDIT', 'Opening retained earnings', true),
    ('OTHER_ASSET', 'OTHER_ASSET', 'DEBIT', 'Controlled other opening asset', true),
    ('OTHER_LIABILITY', 'OTHER_LIABILITY', 'CREDIT', 'Controlled other opening liability', true)
ON CONFLICT (line_type, account_code) DO NOTHING;

CREATE TABLE onboarding.opening_state_applications (
    id                              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    package_id                      bigint NOT NULL UNIQUE REFERENCES onboarding.opening_state_packages(id) ON DELETE RESTRICT,
    request_id                      uuid NOT NULL UNIQUE,
    canonical_payload_hash          bytea NOT NULL,
    fiscal_period_id                bigint NOT NULL REFERENCES finance.fiscal_periods(id) ON DELETE RESTRICT,
    journal_document_id             bigint UNIQUE REFERENCES finance.journal_entries(document_id) ON DELETE RESTRICT,
    status                          text NOT NULL DEFAULT 'APPLYING',
    applied_by                      bigint NOT NULL REFERENCES iam.users(id) ON DELETE RESTRICT,
    workstation_id                  text NOT NULL,
    applied_at                      timestamptz,
    total_assets_dzd                bigint NOT NULL,
    total_liabilities_dzd           bigint NOT NULL,
    total_equity_dzd                bigint NOT NULL,
    physical_inventory_incomplete   boolean NOT NULL DEFAULT false,
    created_at                      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT opening_state_applications_status_valid CHECK (status IN ('APPLYING', 'APPLIED')),
    CONSTRAINT opening_state_applications_workstation_not_blank CHECK (btrim(workstation_id) <> ''),
    CONSTRAINT opening_state_applications_hash_not_empty CHECK (octet_length(canonical_payload_hash) > 0),
    CONSTRAINT opening_state_applications_applied_consistent CHECK (
        (status = 'APPLYING' AND journal_document_id IS NULL AND applied_at IS NULL)
        OR
        (status = 'APPLIED' AND journal_document_id IS NOT NULL AND applied_at IS NOT NULL)
    )
);

CREATE TABLE onboarding.opening_state_application_lines (
    id                         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    application_id             bigint NOT NULL REFERENCES onboarding.opening_state_applications(id) ON DELETE RESTRICT,
    opening_state_line_id      bigint NOT NULL REFERENCES onboarding.opening_state_lines(id) ON DELETE RESTRICT,
    source_row_number          integer NOT NULL,
    line_type                  text NOT NULL,
    description                text NOT NULL,
    amount_dzd                 bigint NOT NULL,
    evidence_counterparty_name text,
    account_code               text NOT NULL,
    normal_side                text NOT NULL,
    customer_id                bigint REFERENCES receivables.customers(id) ON DELETE RESTRICT,
    customer_code_snapshot     text,
    customer_name_snapshot     text,
    supplier_id                bigint REFERENCES procurement.suppliers(id) ON DELETE RESTRICT,
    supplier_code_snapshot     text,
    supplier_name_snapshot     text,
    customer_ledger_entry_id   bigint REFERENCES receivables.customer_ledger_entries(id) ON DELETE RESTRICT,
    supplier_liability_id      bigint,
    created_at                 timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT opening_state_application_lines_unique UNIQUE (application_id, opening_state_line_id),
    CONSTRAINT opening_state_application_lines_amount_nonnegative CHECK (amount_dzd >= 0),
    CONSTRAINT opening_state_application_lines_account_not_blank CHECK (btrim(account_code) <> ''),
    CONSTRAINT opening_state_application_lines_side_valid CHECK (normal_side IN ('DEBIT', 'CREDIT')),
    CONSTRAINT opening_state_application_lines_mapping_consistent CHECK (
        (line_type = 'CUSTOMER_RECEIVABLE'
            AND customer_id IS NOT NULL AND supplier_id IS NULL
            AND customer_code_snapshot IS NOT NULL AND customer_name_snapshot IS NOT NULL)
        OR
        (line_type = 'SUPPLIER_PAYABLE'
            AND supplier_id IS NOT NULL AND customer_id IS NULL
            AND supplier_code_snapshot IS NOT NULL AND supplier_name_snapshot IS NOT NULL)
        OR
        (line_type NOT IN ('CUSTOMER_RECEIVABLE', 'SUPPLIER_PAYABLE')
            AND customer_id IS NULL AND supplier_id IS NULL)
    )
);

CREATE INDEX opening_state_application_lines_application_idx
    ON onboarding.opening_state_application_lines (application_id, source_row_number);

CREATE TABLE onboarding.opening_state_application_audit (
    id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    application_id   bigint REFERENCES onboarding.opening_state_applications(id) ON DELETE RESTRICT,
    package_id       bigint NOT NULL REFERENCES onboarding.opening_state_packages(id) ON DELETE RESTRICT,
    action_code      text NOT NULL,
    actor_id         bigint NOT NULL REFERENCES iam.users(id) ON DELETE RESTRICT,
    workstation_id   text NOT NULL,
    reason_code      text,
    details          jsonb NOT NULL DEFAULT '{}'::jsonb,
    occurred_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT opening_state_application_audit_action_valid CHECK (action_code IN (
        'APPLICATION_SETTING_CHANGED', 'APPLICATION_POSTED', 'APPLICATION_REPLAYED'
    )),
    CONSTRAINT opening_state_application_audit_workstation_not_blank CHECK (btrim(workstation_id) <> ''),
    CONSTRAINT opening_state_application_audit_details_object CHECK (jsonb_typeof(details) = 'object')
);

CREATE INDEX opening_state_application_audit_package_idx
    ON onboarding.opening_state_application_audit (package_id, occurred_at DESC);

-- Existing receivables uniqueness allowed only one ledger entry of a given
-- type per journal. Opening state can legitimately contain several customers,
-- so uniqueness is now scoped to customer as well.
ALTER TABLE receivables.customer_ledger_entries
    DROP CONSTRAINT customer_ledger_document_type_unique;

CREATE UNIQUE INDEX customer_ledger_document_type_customer_unique
    ON receivables.customer_ledger_entries (document_id, entry_type, customer_id)
    WHERE document_id IS NOT NULL;

-- Opening supplier balances share one opening journal. Preserve the old
-- one-liability-per-journal rule for normal procurement while allowing one
-- aggregated opening liability per supplier.
ALTER TABLE procurement.supplier_liabilities
    ADD COLUMN opening_state_application_id bigint
        REFERENCES onboarding.opening_state_applications(id) ON DELETE RESTRICT;

ALTER TABLE procurement.supplier_liabilities
    DROP CONSTRAINT IF EXISTS supplier_liabilities_journal_document_id_key;

CREATE UNIQUE INDEX supplier_liabilities_non_opening_journal_unique
    ON procurement.supplier_liabilities (journal_document_id)
    WHERE opening_state_application_id IS NULL;

CREATE UNIQUE INDEX supplier_liabilities_opening_supplier_unique
    ON procurement.supplier_liabilities (opening_state_application_id, supplier_id)
    WHERE opening_state_application_id IS NOT NULL;

ALTER TABLE procurement.supplier_liabilities
    ADD CONSTRAINT supplier_liabilities_opening_source_consistent CHECK (
        opening_state_application_id IS NULL
        OR (
            purchase_order_id IS NULL
            AND receipt_document_id IS NULL
            AND invoice_document_id IS NULL
        )
    );

ALTER TABLE onboarding.opening_state_application_lines
    ADD CONSTRAINT opening_state_application_lines_supplier_liability_fk
    FOREIGN KEY (supplier_liability_id)
    REFERENCES procurement.supplier_liabilities(id) ON DELETE RESTRICT;

-- Approval now finalizes every reviewed line. Backfill databases that already
-- hold the single approved package.
UPDATE onboarding.opening_state_lines line
SET review_status = 'APPROVED'
FROM onboarding.opening_state_packages package
WHERE package.id = line.package_id
  AND package.status = 'APPROVED_FOR_APPLICATION'
  AND line.review_status <> 'APPROVED';

CREATE OR REPLACE FUNCTION onboarding.approve_opening_state_package(
    p_session_token text,
    p_package_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_actor_id bigint;
    v_workstation_id text;
    v_package onboarding.opening_state_packages%ROWTYPE;
BEGIN
    SELECT user_id, workstation_id
    INTO v_actor_id, v_workstation_id
    FROM iam.resolve_session_with_permission(
        p_session_token,
        'REVIEW_OPENING_STATE_RECONCILIATION'
    );

    SELECT * INTO v_package
    FROM onboarding.opening_state_packages
    WHERE id = p_package_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'opening-state package not found' USING ERRCODE = 'P0002';
    END IF;

    IF v_package.status = 'APPROVED_FOR_APPLICATION' THEN
        RETURN jsonb_build_object(
            'packageId', v_package.id,
            'status', v_package.status,
            'isReplay', true,
            'cutoverDate', v_package.cutover_date,
            'totalAssetsDzd', v_package.total_assets_dzd,
            'totalLiabilitiesDzd', v_package.total_liabilities_dzd,
            'totalEquityDzd', v_package.total_equity_dzd,
            'reconciliationDifferenceDzd', v_package.reconciliation_difference_dzd
        );
    END IF;

    IF v_package.status <> 'VALIDATED'
       OR v_package.reconciliation_difference_dzd <> 0
       OR jsonb_array_length(v_package.validation_errors) <> 0
       OR EXISTS (
            SELECT 1 FROM onboarding.opening_state_lines l
            WHERE l.package_id = p_package_id
              AND jsonb_array_length(l.validation_errors) <> 0
       ) THEN
        RAISE EXCEPTION 'opening-state package must be fully reconciled before approval'
            USING ERRCODE = '55000';
    END IF;

    UPDATE onboarding.opening_state_lines
    SET review_status = 'APPROVED'
    WHERE package_id = p_package_id;

    UPDATE onboarding.opening_state_packages
    SET status = 'APPROVED_FOR_APPLICATION',
        approved_by = v_actor_id,
        approved_at = now()
    WHERE id = p_package_id;

    INSERT INTO onboarding.opening_state_audit (
        package_id, action_code, actor_id, workstation_id, from_status, to_status
    ) VALUES (
        p_package_id, 'APPROVED', v_actor_id, v_workstation_id,
        v_package.status, 'APPROVED_FOR_APPLICATION'
    );

    RETURN jsonb_build_object(
        'packageId', v_package.id,
        'status', 'APPROVED_FOR_APPLICATION',
        'isReplay', false,
        'cutoverDate', v_package.cutover_date,
        'totalAssetsDzd', v_package.total_assets_dzd,
        'totalLiabilitiesDzd', v_package.total_liabilities_dzd,
        'totalEquityDzd', v_package.total_equity_dzd,
        'reconciliationDifferenceDzd', v_package.reconciliation_difference_dzd
    );
END;
$$;

CREATE FUNCTION onboarding.update_opening_state_application_setting(
    p_session_token text,
    p_enabled boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_actor_id bigint;
    v_workstation_id text;
    v_previous boolean;
    v_package_id bigint;
BEGIN
    SELECT user_id, workstation_id
    INTO v_actor_id, v_workstation_id
    FROM iam.resolve_session_with_permission(p_session_token, 'APPLY_OPENING_STATE');

    SELECT opening_state_application_enabled
    INTO v_previous
    FROM onboarding.feature_settings
    WHERE singleton
    FOR UPDATE;

    UPDATE onboarding.feature_settings
    SET opening_state_application_enabled = p_enabled,
        updated_by = v_actor_id,
        updated_at = now()
    WHERE singleton;

    SELECT id INTO v_package_id
    FROM onboarding.opening_state_packages
    WHERE status = 'APPROVED_FOR_APPLICATION'
    ORDER BY id
    LIMIT 1;

    IF v_previous IS DISTINCT FROM p_enabled AND v_package_id IS NOT NULL THEN
        INSERT INTO onboarding.opening_state_application_audit (
            package_id, action_code, actor_id, workstation_id, details
        ) VALUES (
            v_package_id,
            'APPLICATION_SETTING_CHANGED',
            v_actor_id,
            v_workstation_id,
            jsonb_build_object('from', v_previous, 'to', p_enabled)
        );
    END IF;

    RETURN jsonb_build_object('enabled', p_enabled);
END;
$$;

CREATE FUNCTION onboarding.get_opening_state_application_context(
    p_session_token text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_enabled boolean;
    v_package onboarding.opening_state_packages%ROWTYPE;
    v_application onboarding.opening_state_applications%ROWTYPE;
    v_lines jsonb;
BEGIN
    PERFORM 1
    FROM iam.resolve_session_with_permission(p_session_token, 'APPLY_OPENING_STATE');

    SELECT opening_state_application_enabled
    INTO v_enabled
    FROM onboarding.feature_settings
    WHERE singleton;

    SELECT * INTO v_package
    FROM onboarding.opening_state_packages
    WHERE status = 'APPROVED_FOR_APPLICATION'
    ORDER BY id
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'enabled', v_enabled,
            'hasApprovedPackage', false,
            'applied', false,
            'package', NULL,
            'lines', '[]'::jsonb
        );
    END IF;

    SELECT * INTO v_application
    FROM onboarding.opening_state_applications
    WHERE package_id = v_package.id;

    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'lineId', line.id,
            'sourceRowNumber', line.source_row_number,
            'lineType', line.line_type,
            'description', line.description,
            'amountDzd', line.amount_dzd,
            'counterpartyName', line.counterparty_name,
            'externalReference', line.external_reference,
            'notes', line.notes,
            'accountOptions', COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                    'accountCode', account.account_code,
                    'normalSide', account.normal_side,
                    'description', account.description,
                    'isDefault', account.is_default
                ) ORDER BY account.is_default DESC, account.account_code)
                FROM finance.opening_state_allowed_accounts account
                WHERE account.line_type = line.line_type
                  AND account.is_active
            ), '[]'::jsonb)
        ) ORDER BY line.source_row_number, line.id
    ), '[]'::jsonb)
    INTO v_lines
    FROM onboarding.opening_state_lines line
    WHERE line.package_id = v_package.id;

    RETURN jsonb_build_object(
        'enabled', v_enabled,
        'hasApprovedPackage', true,
        'applied', v_application.id IS NOT NULL AND v_application.status = 'APPLIED',
        'applicationId', v_application.id,
        'journalDocumentId', v_application.journal_document_id,
        'package', jsonb_build_object(
            'packageId', v_package.id,
            'status', v_package.status,
            'cutoverDate', v_package.cutover_date,
            'totalAssetsDzd', v_package.total_assets_dzd,
            'totalLiabilitiesDzd', v_package.total_liabilities_dzd,
            'totalEquityDzd', v_package.total_equity_dzd,
            'reconciliationDifferenceDzd', v_package.reconciliation_difference_dzd
        ),
        'lines', v_lines
    );
END;
$$;

CREATE OR REPLACE FUNCTION onboarding.get_opening_state_onboarding_status(
    p_session_token text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_status text;
    v_enabled boolean;
    v_application_enabled boolean;
    v_package_id bigint;
    v_application_id bigint;
BEGIN
    PERFORM 1
    FROM iam.resolve_session_with_permission(
        p_session_token,
        'MANAGE_OPENING_STATE_RECONCILIATION'
    );

    SELECT opening_state_setup_status,
           opening_state_reconciliation_enabled,
           opening_state_application_enabled
    INTO v_status, v_enabled, v_application_enabled
    FROM onboarding.feature_settings
    WHERE singleton;

    SELECT id INTO v_package_id
    FROM onboarding.opening_state_packages
    WHERE status = 'APPROVED_FOR_APPLICATION'
    ORDER BY id
    LIMIT 1;

    SELECT id INTO v_application_id
    FROM onboarding.opening_state_applications
    WHERE package_id = v_package_id
      AND status = 'APPLIED';

    RETURN jsonb_build_object(
        'status', v_status,
        'enabled', v_enabled,
        'hasApprovedPackage', v_package_id IS NOT NULL,
        'approvedPackageId', v_package_id,
        'hasAppliedOpeningState', v_application_id IS NOT NULL,
        'showDeferredAccess', (
            v_status IN ('PENDING', 'DEFERRED')
            AND v_enabled
            AND v_package_id IS NULL
        ),
        'showApplicationAccess', (
            v_package_id IS NOT NULL
            AND v_application_id IS NULL
            AND v_application_enabled
        )
    );
END;
$$;

CREATE FUNCTION onboarding.apply_opening_state(
    p_session_token text,
    p_request_id uuid,
    p_payload_hash bytea,
    p_package_id bigint,
    p_fiscal_period_id bigint,
    p_mappings jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_actor_id bigint;
    v_workstation_id text;
    v_enabled boolean;
    v_package onboarding.opening_state_packages%ROWTYPE;
    v_existing_application onboarding.opening_state_applications%ROWTYPE;
    v_existing_journal_id bigint;
    v_period_status text;
    v_period_start date;
    v_period_end date;
    v_application_id bigint;
    v_journal_id bigint;
    v_line_number integer := 0;
    v_mapping_count integer;
BEGIN
    SELECT user_id, workstation_id
    INTO v_actor_id, v_workstation_id
    FROM iam.resolve_session_with_permission(p_session_token, 'APPLY_OPENING_STATE');

    IF p_request_id IS NULL OR p_payload_hash IS NULL OR octet_length(p_payload_hash) = 0 THEN
        RAISE EXCEPTION 'invalid opening-state application request' USING ERRCODE = '22023';
    END IF;
    IF p_package_id IS NULL OR p_package_id <= 0 OR p_fiscal_period_id IS NULL OR p_fiscal_period_id <= 0 THEN
        RAISE EXCEPTION 'package and fiscal period are required' USING ERRCODE = '22023';
    END IF;
    IF p_mappings IS NULL OR jsonb_typeof(p_mappings) <> 'array' THEN
        RAISE EXCEPTION 'opening-state mappings must be a JSON array' USING ERRCODE = '22023';
    END IF;

    SELECT opening_state_application_enabled
    INTO v_enabled
    FROM onboarding.feature_settings
    WHERE singleton
    FOR SHARE;

    IF NOT COALESCE(v_enabled, false) THEN
        RAISE EXCEPTION 'opening-state application is disabled' USING ERRCODE = '55000';
    END IF;

    SELECT * INTO v_package
    FROM onboarding.opening_state_packages
    WHERE id = p_package_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'opening-state package not found' USING ERRCODE = 'P0002';
    END IF;

    SELECT * INTO v_existing_application
    FROM onboarding.opening_state_applications
    WHERE package_id = p_package_id;

    IF FOUND THEN
        IF v_existing_application.request_id = p_request_id
           AND v_existing_application.canonical_payload_hash = p_payload_hash
           AND v_existing_application.status = 'APPLIED' THEN
            INSERT INTO onboarding.opening_state_application_audit (
                application_id, package_id, action_code, actor_id, workstation_id,
                reason_code, details
            ) VALUES (
                v_existing_application.id, p_package_id, 'APPLICATION_REPLAYED',
                v_actor_id, v_workstation_id, 'IDEMPOTENT_REPLAY',
                jsonb_build_object('journalDocumentId', v_existing_application.journal_document_id)
            );

            RETURN jsonb_build_object(
                'applicationId', v_existing_application.id,
                'packageId', p_package_id,
                'journalDocumentId', v_existing_application.journal_document_id,
                'status', 'APPLIED',
                'isReplay', true,
                'physicalInventoryIncomplete', v_existing_application.physical_inventory_incomplete
            );
        END IF;

        RAISE EXCEPTION 'opening state has already been applied with a different request'
            USING ERRCODE = '23505';
    END IF;

    v_existing_journal_id := core.reserve_idempotent_request(
        'onboarding.apply_opening_state', p_request_id, p_payload_hash
    );
    IF v_existing_journal_id IS NOT NULL THEN
        SELECT * INTO v_existing_application
        FROM onboarding.opening_state_applications
        WHERE journal_document_id = v_existing_journal_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'opening-state idempotency result is inconsistent'
                USING ERRCODE = 'XX000';
        END IF;

        RETURN jsonb_build_object(
            'applicationId', v_existing_application.id,
            'packageId', v_existing_application.package_id,
            'journalDocumentId', v_existing_application.journal_document_id,
            'status', v_existing_application.status,
            'isReplay', true,
            'physicalInventoryIncomplete', v_existing_application.physical_inventory_incomplete
        );
    END IF;

    IF v_package.status <> 'APPROVED_FOR_APPLICATION'
       OR v_package.reconciliation_difference_dzd <> 0
       OR jsonb_array_length(v_package.validation_errors) <> 0
       OR EXISTS (
            SELECT 1 FROM onboarding.opening_state_lines line
            WHERE line.package_id = p_package_id
              AND (
                  line.review_status <> 'APPROVED'
                  OR jsonb_array_length(line.validation_errors) <> 0
              )
       ) THEN
        RAISE EXCEPTION 'opening-state package is not approved and application-ready'
            USING ERRCODE = '55000';
    END IF;

    SELECT status, starts_on, ends_on
    INTO v_period_status, v_period_start, v_period_end
    FROM finance.fiscal_periods
    WHERE id = p_fiscal_period_id
    FOR SHARE;

    IF NOT FOUND OR v_period_status <> 'OPEN' THEN
        RAISE EXCEPTION 'opening state requires an open fiscal period'
            USING ERRCODE = '55000';
    END IF;
    IF v_package.cutover_date < v_period_start OR v_package.cutover_date > v_period_end THEN
        RAISE EXCEPTION 'opening-state cutover date is outside the selected fiscal period'
            USING ERRCODE = '22023';
    END IF;

    SELECT count(*)::integer, count(DISTINCT mapping.line_id)::integer
    INTO v_mapping_count, v_line_number
    FROM jsonb_to_recordset(p_mappings) AS mapping(
        line_id bigint,
        customer_id bigint,
        supplier_id bigint,
        account_code text
    );
    IF v_mapping_count <> v_line_number THEN
        RAISE EXCEPTION 'opening-state mappings contain duplicate line ids'
            USING ERRCODE = '22023';
    END IF;
    v_line_number := 0;

    IF EXISTS (
        SELECT 1
        FROM jsonb_to_recordset(p_mappings) AS mapping(
            line_id bigint,
            customer_id bigint,
            supplier_id bigint,
            account_code text
        )
        LEFT JOIN onboarding.opening_state_lines line
          ON line.id = mapping.line_id
         AND line.package_id = p_package_id
        WHERE line.id IS NULL
           OR line.line_type NOT IN (
               'CUSTOMER_RECEIVABLE', 'SUPPLIER_PAYABLE', 'OTHER_ASSET', 'OTHER_LIABILITY'
           )
    ) THEN
        RAISE EXCEPTION 'opening-state mappings contain an unknown or non-mappable line'
            USING ERRCODE = '22023';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM onboarding.opening_state_lines line
        LEFT JOIN jsonb_to_recordset(p_mappings) AS mapping(
            line_id bigint,
            customer_id bigint,
            supplier_id bigint,
            account_code text
        ) ON mapping.line_id = line.id
        LEFT JOIN receivables.customers customer
          ON customer.id = mapping.customer_id AND customer.is_active
        WHERE line.package_id = p_package_id
          AND line.amount_dzd > 0
          AND line.line_type = 'CUSTOMER_RECEIVABLE'
          AND (
              mapping.line_id IS NULL
              OR mapping.customer_id IS NULL
              OR mapping.supplier_id IS NOT NULL
              OR mapping.account_code IS NOT NULL
              OR customer.id IS NULL
          )
    ) THEN
        RAISE EXCEPTION 'every customer receivable requires one active customer mapping'
            USING ERRCODE = '22023';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM onboarding.opening_state_lines line
        LEFT JOIN jsonb_to_recordset(p_mappings) AS mapping(
            line_id bigint,
            customer_id bigint,
            supplier_id bigint,
            account_code text
        ) ON mapping.line_id = line.id
        LEFT JOIN procurement.suppliers supplier
          ON supplier.id = mapping.supplier_id AND supplier.is_active
        WHERE line.package_id = p_package_id
          AND line.amount_dzd > 0
          AND line.line_type = 'SUPPLIER_PAYABLE'
          AND (
              mapping.line_id IS NULL
              OR mapping.supplier_id IS NULL
              OR mapping.customer_id IS NOT NULL
              OR mapping.account_code IS NOT NULL
              OR supplier.id IS NULL
          )
    ) THEN
        RAISE EXCEPTION 'every supplier payable requires one active supplier mapping'
            USING ERRCODE = '22023';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM onboarding.opening_state_lines line
        LEFT JOIN jsonb_to_recordset(p_mappings) AS mapping(
            line_id bigint,
            customer_id bigint,
            supplier_id bigint,
            account_code text
        ) ON mapping.line_id = line.id
        LEFT JOIN finance.opening_state_allowed_accounts account
          ON account.line_type = line.line_type
         AND account.account_code = btrim(mapping.account_code)
         AND account.is_active
        WHERE line.package_id = p_package_id
          AND line.amount_dzd > 0
          AND line.line_type IN ('OTHER_ASSET', 'OTHER_LIABILITY')
          AND (
              mapping.line_id IS NULL
              OR mapping.customer_id IS NOT NULL
              OR mapping.supplier_id IS NOT NULL
              OR mapping.account_code IS NULL
              OR account.id IS NULL
          )
    ) THEN
        RAISE EXCEPTION 'every other asset/liability requires an allowed account mapping'
            USING ERRCODE = '22023';
    END IF;

    INSERT INTO onboarding.opening_state_applications (
        package_id, request_id, canonical_payload_hash, fiscal_period_id,
        applied_by, workstation_id, total_assets_dzd, total_liabilities_dzd,
        total_equity_dzd, physical_inventory_incomplete
    ) VALUES (
        p_package_id, p_request_id, p_payload_hash, p_fiscal_period_id,
        v_actor_id, v_workstation_id, v_package.total_assets_dzd,
        v_package.total_liabilities_dzd, v_package.total_equity_dzd,
        EXISTS (
            SELECT 1 FROM onboarding.opening_state_lines line
            WHERE line.package_id = p_package_id
              AND line.line_type = 'INVENTORY_VALUE'
              AND line.amount_dzd > 0
        )
    ) RETURNING id INTO v_application_id;

    INSERT INTO onboarding.opening_state_application_lines (
        application_id, opening_state_line_id, source_row_number, line_type,
        description, amount_dzd, evidence_counterparty_name, account_code,
        normal_side, customer_id, customer_code_snapshot, customer_name_snapshot,
        supplier_id, supplier_code_snapshot, supplier_name_snapshot
    )
    SELECT
        v_application_id,
        line.id,
        line.source_row_number,
        line.line_type,
        line.description,
        line.amount_dzd,
        line.counterparty_name,
        COALESCE(NULLIF(btrim(mapping.account_code), ''), account.account_code),
        selected_account.normal_side,
        mapping.customer_id,
        customer.code,
        customer.name,
        mapping.supplier_id,
        supplier.code,
        supplier.name
    FROM onboarding.opening_state_lines line
    LEFT JOIN jsonb_to_recordset(p_mappings) AS mapping(
        line_id bigint,
        customer_id bigint,
        supplier_id bigint,
        account_code text
    ) ON mapping.line_id = line.id
    LEFT JOIN LATERAL (
        SELECT allowed.account_code
        FROM finance.opening_state_allowed_accounts allowed
        WHERE allowed.line_type = line.line_type
          AND allowed.is_active
          AND allowed.is_default
        ORDER BY allowed.id
        LIMIT 1
    ) account ON true
    JOIN finance.opening_state_allowed_accounts selected_account
      ON selected_account.line_type = line.line_type
     AND selected_account.account_code = COALESCE(NULLIF(btrim(mapping.account_code), ''), account.account_code)
     AND selected_account.is_active
    LEFT JOIN receivables.customers customer ON customer.id = mapping.customer_id
    LEFT JOIN procurement.suppliers supplier ON supplier.id = mapping.supplier_id
    WHERE line.package_id = p_package_id
    ORDER BY line.source_row_number, line.id;

    IF (SELECT count(*) FROM onboarding.opening_state_application_lines
        WHERE application_id = v_application_id) <> v_package.row_count THEN
        RAISE EXCEPTION 'opening-state account mapping is incomplete'
            USING ERRCODE = '55000';
    END IF;

    v_journal_id := finance.create_posted_journal(
        v_package.cutover_date,
        p_fiscal_period_id,
        'Approved opening-state application',
        'OPENING_STATE',
        v_application_id
    );

    INSERT INTO finance.journal_lines (
        document_id, line_number, account_code, debit, credit, description
    )
    SELECT
        v_journal_id,
        row_number() OVER (ORDER BY line.source_row_number, line.id)::integer,
        line.account_code,
        CASE WHEN line.normal_side = 'DEBIT' THEN line.amount_dzd ELSE 0 END,
        CASE WHEN line.normal_side = 'CREDIT' THEN line.amount_dzd ELSE 0 END,
        line.description
    FROM onboarding.opening_state_application_lines line
    WHERE line.application_id = v_application_id
      AND line.amount_dzd > 0
    ORDER BY line.source_row_number, line.id;

    IF (SELECT count(*) FROM finance.journal_lines WHERE document_id = v_journal_id) < 2 THEN
        RAISE EXCEPTION 'opening-state journal requires at least two non-zero lines'
            USING ERRCODE = '55000';
    END IF;

    PERFORM 1
    FROM receivables.customer_credit_state state
    WHERE state.customer_id IN (
        SELECT DISTINCT line.customer_id
        FROM onboarding.opening_state_application_lines line
        WHERE line.application_id = v_application_id
          AND line.customer_id IS NOT NULL
          AND line.amount_dzd > 0
    )
    ORDER BY state.customer_id
    FOR UPDATE;

    WITH totals AS (
        SELECT customer_id, sum(amount_dzd)::numeric(14,2) AS amount
        FROM onboarding.opening_state_application_lines
        WHERE application_id = v_application_id
          AND customer_id IS NOT NULL
          AND amount_dzd > 0
        GROUP BY customer_id
    ), inserted AS (
        INSERT INTO receivables.customer_ledger_entries (
            customer_id, entry_type, amount_delta, document_id, due_date,
            posted_by_user_id, workstation_id
        )
        SELECT
            totals.customer_id, 'ADJUSTMENT', totals.amount, v_journal_id,
            v_package.cutover_date, v_actor_id, v_workstation_id
        FROM totals
        RETURNING id, customer_id
    )
    UPDATE onboarding.opening_state_application_lines line
    SET customer_ledger_entry_id = inserted.id
    FROM inserted
    WHERE line.application_id = v_application_id
      AND line.customer_id = inserted.customer_id;

    WITH totals AS (
        SELECT customer_id, sum(amount_dzd)::numeric(14,2) AS amount
        FROM onboarding.opening_state_application_lines
        WHERE application_id = v_application_id
          AND customer_id IS NOT NULL
          AND amount_dzd > 0
        GROUP BY customer_id
    )
    UPDATE receivables.customer_credit_state state
    SET exposure_amount = state.exposure_amount + totals.amount,
        oldest_open_due_date = CASE
            WHEN state.oldest_open_due_date IS NULL THEN v_package.cutover_date
            ELSE LEAST(state.oldest_open_due_date, v_package.cutover_date)
        END,
        last_rebuilt_at = now(),
        updated_at = now()
    FROM totals
    WHERE state.customer_id = totals.customer_id;

    WITH totals AS (
        SELECT supplier_id, sum(amount_dzd)::numeric(14,2) AS amount
        FROM onboarding.opening_state_application_lines
        WHERE application_id = v_application_id
          AND supplier_id IS NOT NULL
          AND amount_dzd > 0
        GROUP BY supplier_id
    ), inserted AS (
        INSERT INTO procurement.supplier_liabilities (
            supplier_id, journal_document_id, original_amount,
            outstanding_amount, status, due_date, opening_state_application_id
        )
        SELECT
            totals.supplier_id, v_journal_id, totals.amount,
            totals.amount, 'UNPAID', v_package.cutover_date, v_application_id
        FROM totals
        RETURNING id, supplier_id
    )
    UPDATE onboarding.opening_state_application_lines line
    SET supplier_liability_id = inserted.id
    FROM inserted
    WHERE line.application_id = v_application_id
      AND line.supplier_id = inserted.supplier_id;

    UPDATE onboarding.opening_state_applications
    SET journal_document_id = v_journal_id,
        status = 'APPLIED',
        applied_at = now()
    WHERE id = v_application_id;

    INSERT INTO onboarding.opening_state_application_audit (
        application_id, package_id, action_code, actor_id, workstation_id,
        reason_code, details
    ) VALUES (
        v_application_id, p_package_id, 'APPLICATION_POSTED',
        v_actor_id, v_workstation_id, 'OPENING_STATE_APPLIED',
        jsonb_build_object(
            'journalDocumentId', v_journal_id,
            'totalAssetsDzd', v_package.total_assets_dzd,
            'totalLiabilitiesDzd', v_package.total_liabilities_dzd,
            'totalEquityDzd', v_package.total_equity_dzd
        )
    );

    PERFORM core.record_idempotent_result(
        'onboarding.apply_opening_state', p_request_id, v_journal_id
    );

    RETURN jsonb_build_object(
        'applicationId', v_application_id,
        'packageId', p_package_id,
        'journalDocumentId', v_journal_id,
        'status', 'APPLIED',
        'isReplay', false,
        'physicalInventoryIncomplete', (
            SELECT physical_inventory_incomplete
            FROM onboarding.opening_state_applications
            WHERE id = v_application_id
        )
    );
END;
$$;

CREATE FUNCTION onboarding.forbid_applied_opening_state_application_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'opening-state applications are immutable'
            USING ERRCODE = '0A000';
    END IF;

    IF OLD.status = 'APPLYING'
       AND NEW.status = 'APPLIED'
       AND NEW.package_id = OLD.package_id
       AND NEW.request_id = OLD.request_id
       AND NEW.canonical_payload_hash = OLD.canonical_payload_hash
       AND NEW.fiscal_period_id = OLD.fiscal_period_id
       AND NEW.applied_by = OLD.applied_by
       AND NEW.workstation_id = OLD.workstation_id
       AND NEW.total_assets_dzd = OLD.total_assets_dzd
       AND NEW.total_liabilities_dzd = OLD.total_liabilities_dzd
       AND NEW.total_equity_dzd = OLD.total_equity_dzd
       AND NEW.physical_inventory_incomplete = OLD.physical_inventory_incomplete
       AND NEW.created_at = OLD.created_at
       AND NEW.journal_document_id IS NOT NULL
       AND NEW.applied_at IS NOT NULL
    THEN
        RETURN NEW;
    END IF;

    RAISE EXCEPTION 'applied opening-state application evidence is immutable'
        USING ERRCODE = '0A000';
END;
$$;

CREATE TRIGGER opening_state_applications_forbid_mutation
    BEFORE UPDATE OR DELETE ON onboarding.opening_state_applications
    FOR EACH ROW EXECUTE FUNCTION onboarding.forbid_applied_opening_state_application_mutation();

CREATE FUNCTION onboarding.forbid_applied_opening_state_line_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_status text;
BEGIN
    SELECT status INTO v_status
    FROM onboarding.opening_state_applications
    WHERE id = COALESCE(NEW.application_id, OLD.application_id);

    IF v_status = 'APPLIED' THEN
        RAISE EXCEPTION 'applied opening-state line snapshots are immutable'
            USING ERRCODE = '0A000';
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER opening_state_application_lines_forbid_update
    BEFORE UPDATE ON onboarding.opening_state_application_lines
    FOR EACH ROW EXECUTE FUNCTION onboarding.forbid_applied_opening_state_line_mutation();

CREATE TRIGGER opening_state_application_lines_forbid_delete
    BEFORE DELETE ON onboarding.opening_state_application_lines
    FOR EACH ROW EXECUTE FUNCTION onboarding.forbid_applied_opening_state_line_mutation();

CREATE FUNCTION onboarding.forbid_opening_state_application_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'opening-state application audit rows are immutable'
        USING ERRCODE = '0A000';
END;
$$;

CREATE TRIGGER opening_state_application_audit_forbid_update
    BEFORE UPDATE ON onboarding.opening_state_application_audit
    FOR EACH ROW EXECUTE FUNCTION onboarding.forbid_opening_state_application_audit_mutation();

CREATE TRIGGER opening_state_application_audit_forbid_delete
    BEFORE DELETE ON onboarding.opening_state_application_audit
    FOR EACH ROW EXECUTE FUNCTION onboarding.forbid_opening_state_application_audit_mutation();

REVOKE ALL ON finance.opening_state_allowed_accounts FROM PUBLIC;
REVOKE ALL ON onboarding.opening_state_applications FROM PUBLIC;
REVOKE ALL ON onboarding.opening_state_application_lines FROM PUBLIC;
REVOKE ALL ON onboarding.opening_state_application_audit FROM PUBLIC;
REVOKE ALL ON finance.opening_state_allowed_accounts FROM stockiha_runtime;
REVOKE ALL ON onboarding.opening_state_applications FROM stockiha_runtime;
REVOKE ALL ON onboarding.opening_state_application_lines FROM stockiha_runtime;
REVOKE ALL ON onboarding.opening_state_application_audit FROM stockiha_runtime;

REVOKE ALL ON FUNCTION onboarding.update_opening_state_application_setting(text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION onboarding.get_opening_state_application_context(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION onboarding.apply_opening_state(text, uuid, bytea, bigint, bigint, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION onboarding.forbid_applied_opening_state_application_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION onboarding.forbid_applied_opening_state_line_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION onboarding.forbid_opening_state_application_audit_mutation() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION onboarding.update_opening_state_application_setting(text, boolean) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION onboarding.get_opening_state_application_context(text) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION onboarding.apply_opening_state(text, uuid, bytea, bigint, bigint, jsonb) TO stockiha_runtime;

-- Backup visibility is read-only and includes complete application evidence.
GRANT SELECT ON finance.opening_state_allowed_accounts TO stockiha_backup;
GRANT SELECT ON onboarding.opening_state_applications TO stockiha_backup;
GRANT SELECT ON onboarding.opening_state_application_lines TO stockiha_backup;
GRANT SELECT ON onboarding.opening_state_application_audit TO stockiha_backup;
GRANT SELECT ON SEQUENCE finance.opening_state_allowed_accounts_id_seq TO stockiha_backup;
GRANT SELECT ON SEQUENCE onboarding.opening_state_applications_id_seq TO stockiha_backup;
GRANT SELECT ON SEQUENCE onboarding.opening_state_application_lines_id_seq TO stockiha_backup;
GRANT SELECT ON SEQUENCE onboarding.opening_state_application_audit_id_seq TO stockiha_backup;

UPDATE operations.schema_state
SET migration_version = 20260805150000,
    updated_at = now()
WHERE singleton;

RESET ROLE;
