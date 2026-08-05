-- R5-002: current opening-state reconciliation.
--
-- This migration establishes a separately reviewed go-live balance package.
-- Approval means "ready for a later controlled application step" only. No
-- function here writes operational stock, cash, receivables, payables, sales,
-- purchases, or finance journals.
SET ROLE stockiha_owner;

-- Extend the closed permission vocabulary without rewriting prior migrations.
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
        'ALTER TABLE iam.permissions ADD CONSTRAINT permissions_code_valid CHECK ((%s) OR code = ANY (ARRAY[%L,%L]::text[]))',
        v_existing_check,
        'MANAGE_OPENING_STATE_RECONCILIATION',
        'REVIEW_OPENING_STATE_RECONCILIATION'
    );
END;
$$;

INSERT INTO iam.permissions (code, name) VALUES
    ('MANAGE_OPENING_STATE_RECONCILIATION', 'Create and validate current opening-state packages'),
    ('REVIEW_OPENING_STATE_RECONCILIATION', 'Approve reconciled opening state for later application')
ON CONFLICT (code) DO NOTHING;

INSERT INTO iam.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM iam.roles r
CROSS JOIN iam.permissions p
WHERE r.code = 'ADMIN'
  AND p.code IN (
      'MANAGE_OPENING_STATE_RECONCILIATION',
      'REVIEW_OPENING_STATE_RECONCILIATION'
  )
ON CONFLICT DO NOTHING;

ALTER TABLE onboarding.feature_settings
    ADD COLUMN opening_state_reconciliation_enabled boolean NOT NULL DEFAULT true;

CREATE TABLE onboarding.opening_state_packages (
    id                         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    request_id                 text NOT NULL UNIQUE,
    source_type                text NOT NULL,
    original_filename          text,
    cutover_date               date NOT NULL,
    status                     text NOT NULL DEFAULT 'DRAFT',
    created_by                 bigint NOT NULL REFERENCES iam.users(id) ON DELETE RESTRICT,
    workstation_id             text NOT NULL,
    created_at                 timestamptz NOT NULL DEFAULT now(),
    validated_at               timestamptz,
    approved_by                bigint REFERENCES iam.users(id) ON DELETE RESTRICT,
    approved_at                timestamptz,
    rejected_by                bigint REFERENCES iam.users(id) ON DELETE RESTRICT,
    rejected_at                timestamptz,
    decision_reason            text,
    row_count                  integer NOT NULL DEFAULT 0,
    invalid_row_count          integer NOT NULL DEFAULT 0,
    total_assets_dzd           bigint NOT NULL DEFAULT 0,
    total_liabilities_dzd      bigint NOT NULL DEFAULT 0,
    total_equity_dzd           bigint NOT NULL DEFAULT 0,
    reconciliation_difference_dzd bigint NOT NULL DEFAULT 0,
    validation_errors          jsonb NOT NULL DEFAULT '[]'::jsonb,
    CONSTRAINT opening_state_packages_request_not_blank
        CHECK (btrim(request_id) <> '' AND length(request_id) BETWEEN 8 AND 128),
    CONSTRAINT opening_state_packages_source_valid
        CHECK (source_type IN ('EXCEL', 'MANUAL')),
    CONSTRAINT opening_state_packages_filename_valid CHECK (
        (source_type = 'EXCEL' AND original_filename IS NOT NULL
         AND btrim(original_filename) <> '' AND length(original_filename) <= 255)
        OR
        (source_type = 'MANUAL' AND original_filename IS NULL)
    ),
    CONSTRAINT opening_state_packages_status_valid CHECK (status IN (
        'DRAFT',
        'VALIDATED',
        'NEEDS_REVIEW',
        'APPROVED_FOR_APPLICATION',
        'REJECTED'
    )),
    CONSTRAINT opening_state_packages_workstation_not_blank
        CHECK (btrim(workstation_id) <> ''),
    CONSTRAINT opening_state_packages_counts_valid
        CHECK (row_count >= 0 AND invalid_row_count >= 0 AND invalid_row_count <= row_count),
    CONSTRAINT opening_state_packages_validation_errors_array
        CHECK (jsonb_typeof(validation_errors) = 'array'),
    CONSTRAINT opening_state_packages_decision_consistent CHECK (
        (status IN ('DRAFT', 'VALIDATED', 'NEEDS_REVIEW')
            AND approved_by IS NULL AND approved_at IS NULL
            AND rejected_by IS NULL AND rejected_at IS NULL)
        OR
        (status = 'APPROVED_FOR_APPLICATION'
            AND approved_by IS NOT NULL AND approved_at IS NOT NULL
            AND rejected_by IS NULL AND rejected_at IS NULL)
        OR
        (status = 'REJECTED'
            AND rejected_by IS NOT NULL AND rejected_at IS NOT NULL
            AND approved_by IS NULL AND approved_at IS NULL
            AND decision_reason IS NOT NULL AND btrim(decision_reason) <> '')
    )
);

CREATE INDEX opening_state_packages_created_at_idx
    ON onboarding.opening_state_packages (created_at DESC);
CREATE INDEX opening_state_packages_status_idx
    ON onboarding.opening_state_packages (status, created_at DESC);
CREATE UNIQUE INDEX opening_state_single_approved_idx
    ON onboarding.opening_state_packages ((1))
    WHERE status = 'APPROVED_FOR_APPLICATION';

CREATE TABLE onboarding.opening_state_lines (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    package_id          bigint NOT NULL REFERENCES onboarding.opening_state_packages(id) ON DELETE RESTRICT,
    source_row_number   integer NOT NULL,
    line_type           text NOT NULL,
    description         text NOT NULL,
    amount_dzd          bigint NOT NULL,
    counterparty_name   text,
    external_reference  text,
    notes               text,
    review_status       text NOT NULL DEFAULT 'READY',
    validation_errors   jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT opening_state_lines_package_row_unique
        UNIQUE (package_id, source_row_number),
    CONSTRAINT opening_state_lines_source_row_positive
        CHECK (source_row_number >= 2),
    CONSTRAINT opening_state_lines_type_valid CHECK (line_type IN (
        'CASH',
        'BANK',
        'INVENTORY_VALUE',
        'CUSTOMER_RECEIVABLE',
        'SUPPLIER_PAYABLE',
        'LOAN_PAYABLE',
        'TAX_PAYABLE',
        'OWNER_CAPITAL',
        'RETAINED_EARNINGS',
        'OTHER_ASSET',
        'OTHER_LIABILITY'
    )),
    CONSTRAINT opening_state_lines_description_not_blank
        CHECK (btrim(description) <> '' AND length(description) <= 500),
    CONSTRAINT opening_state_lines_amount_nonnegative
        CHECK (amount_dzd >= 0),
    CONSTRAINT opening_state_lines_counterparty_length
        CHECK (counterparty_name IS NULL OR (btrim(counterparty_name) <> '' AND length(counterparty_name) <= 300)),
    CONSTRAINT opening_state_lines_reference_length
        CHECK (external_reference IS NULL OR (btrim(external_reference) <> '' AND length(external_reference) <= 200)),
    CONSTRAINT opening_state_lines_notes_length
        CHECK (notes IS NULL OR (btrim(notes) <> '' AND length(notes) <= 1000)),
    CONSTRAINT opening_state_lines_review_status_valid
        CHECK (review_status IN ('READY', 'NEEDS_REVIEW', 'APPROVED', 'REJECTED')),
    CONSTRAINT opening_state_lines_validation_errors_array
        CHECK (jsonb_typeof(validation_errors) = 'array')
);

CREATE INDEX opening_state_lines_package_idx
    ON onboarding.opening_state_lines (package_id, source_row_number);
CREATE INDEX opening_state_lines_type_idx
    ON onboarding.opening_state_lines (line_type, package_id);

CREATE TABLE onboarding.opening_state_audit (
    id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    package_id       bigint REFERENCES onboarding.opening_state_packages(id) ON DELETE RESTRICT,
    action_code      text NOT NULL,
    actor_id         bigint NOT NULL REFERENCES iam.users(id) ON DELETE RESTRICT,
    workstation_id   text NOT NULL,
    from_status      text,
    to_status        text,
    reason           text,
    occurred_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT opening_state_audit_action_valid CHECK (action_code IN (
        'CREATED',
        'DATA_REPLACED',
        'VALIDATED',
        'APPROVED',
        'REJECTED',
        'SETTING_CHANGED'
    )),
    CONSTRAINT opening_state_audit_workstation_not_blank
        CHECK (btrim(workstation_id) <> '')
);

CREATE INDEX opening_state_audit_package_idx
    ON onboarding.opening_state_audit (package_id, occurred_at);

REVOKE ALL ON onboarding.opening_state_packages FROM PUBLIC;
REVOKE ALL ON onboarding.opening_state_lines FROM PUBLIC;
REVOKE ALL ON onboarding.opening_state_audit FROM PUBLIC;
REVOKE ALL ON onboarding.opening_state_packages FROM stockiha_runtime;
REVOKE ALL ON onboarding.opening_state_lines FROM stockiha_runtime;
REVOKE ALL ON onboarding.opening_state_audit FROM stockiha_runtime;

CREATE FUNCTION onboarding.get_opening_state_setting(
    p_session_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_enabled boolean;
BEGIN
    PERFORM 1
    FROM iam.resolve_session_with_permission(
        p_session_token,
        'MANAGE_OPENING_STATE_RECONCILIATION'
    );

    SELECT opening_state_reconciliation_enabled
    INTO v_enabled
    FROM onboarding.feature_settings
    WHERE singleton;

    RETURN jsonb_build_object('enabled', v_enabled);
END;
$$;

CREATE FUNCTION onboarding.update_opening_state_setting(
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
BEGIN
    SELECT user_id, workstation_id
    INTO v_actor_id, v_workstation_id
    FROM iam.resolve_session_with_permission(
        p_session_token,
        'MANAGE_OPENING_STATE_RECONCILIATION'
    );

    SELECT opening_state_reconciliation_enabled
    INTO v_previous
    FROM onboarding.feature_settings
    WHERE singleton
    FOR UPDATE;

    UPDATE onboarding.feature_settings
    SET opening_state_reconciliation_enabled = p_enabled,
        updated_by = v_actor_id,
        updated_at = now()
    WHERE singleton;

    IF v_previous IS DISTINCT FROM p_enabled THEN
        INSERT INTO onboarding.opening_state_audit (
            package_id,
            action_code,
            actor_id,
            workstation_id,
            reason
        ) VALUES (
            NULL,
            'SETTING_CHANGED',
            v_actor_id,
            v_workstation_id,
            format('opening_state_reconciliation_enabled: %s -> %s', v_previous, p_enabled)
        );
    END IF;

    RETURN jsonb_build_object('enabled', p_enabled);
END;
$$;

CREATE FUNCTION onboarding.create_opening_state_package(
    p_session_token text,
    p_request_id text,
    p_source_type text,
    p_original_filename text,
    p_cutover_date date
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
    v_existing onboarding.opening_state_packages%ROWTYPE;
    v_package_id bigint;
    v_source_type text;
    v_filename text;
BEGIN
    SELECT user_id, workstation_id
    INTO v_actor_id, v_workstation_id
    FROM iam.resolve_session_with_permission(
        p_session_token,
        'MANAGE_OPENING_STATE_RECONCILIATION'
    );

    SELECT opening_state_reconciliation_enabled
    INTO v_enabled
    FROM onboarding.feature_settings
    WHERE singleton;

    IF NOT COALESCE(v_enabled, false) THEN
        RAISE EXCEPTION 'opening-state reconciliation is disabled'
            USING ERRCODE = '55000';
    END IF;

    IF p_request_id IS NULL OR length(btrim(p_request_id)) NOT BETWEEN 8 AND 128 THEN
        RAISE EXCEPTION 'invalid opening-state request id' USING ERRCODE = '22023';
    END IF;
    IF p_cutover_date IS NULL THEN
        RAISE EXCEPTION 'cutover date is required' USING ERRCODE = '22023';
    END IF;

    v_source_type := upper(btrim(COALESCE(p_source_type, '')));
    v_filename := CASE WHEN p_original_filename IS NULL THEN NULL ELSE btrim(p_original_filename) END;

    IF v_source_type NOT IN ('EXCEL', 'MANUAL') THEN
        RAISE EXCEPTION 'invalid opening-state source type' USING ERRCODE = '22023';
    END IF;
    IF v_source_type = 'EXCEL' AND (
        v_filename IS NULL OR v_filename = '' OR length(v_filename) > 255
    ) THEN
        RAISE EXCEPTION 'Excel opening-state packages require a safe filename'
            USING ERRCODE = '22023';
    END IF;
    IF v_source_type = 'MANUAL' AND v_filename IS NOT NULL THEN
        RAISE EXCEPTION 'manual opening-state packages must not carry a filename'
            USING ERRCODE = '22023';
    END IF;

    SELECT *
    INTO v_existing
    FROM onboarding.opening_state_packages
    WHERE request_id = btrim(p_request_id);

    IF FOUND THEN
        IF v_existing.created_by <> v_actor_id
           OR v_existing.source_type <> v_source_type
           OR v_existing.original_filename IS DISTINCT FROM v_filename
           OR v_existing.cutover_date <> p_cutover_date THEN
            RAISE EXCEPTION 'opening-state request id conflicts with an existing request'
                USING ERRCODE = '23505';
        END IF;

        RETURN jsonb_build_object(
            'packageId', v_existing.id,
            'status', v_existing.status,
            'isReplay', true,
            'sourceType', v_existing.source_type,
            'originalFilename', v_existing.original_filename,
            'cutoverDate', v_existing.cutover_date
        );
    END IF;

    IF v_source_type = 'EXCEL' THEN
        SELECT *
        INTO v_existing
        FROM onboarding.opening_state_packages
        WHERE created_by = v_actor_id
          AND source_type = 'EXCEL'
          AND original_filename = v_filename
          AND cutover_date = p_cutover_date
          AND status IN ('DRAFT', 'VALIDATED', 'NEEDS_REVIEW')
        ORDER BY created_at DESC, id DESC
        LIMIT 1
        FOR UPDATE;

        IF FOUND THEN
            RETURN jsonb_build_object(
                'packageId', v_existing.id,
                'status', v_existing.status,
                'isReplay', true,
                'sourceType', v_existing.source_type,
                'originalFilename', v_existing.original_filename,
                'cutoverDate', v_existing.cutover_date
            );
        END IF;
    END IF;

    INSERT INTO onboarding.opening_state_packages (
        request_id,
        source_type,
        original_filename,
        cutover_date,
        created_by,
        workstation_id
    ) VALUES (
        btrim(p_request_id),
        v_source_type,
        v_filename,
        p_cutover_date,
        v_actor_id,
        v_workstation_id
    )
    RETURNING id INTO v_package_id;

    INSERT INTO onboarding.opening_state_audit (
        package_id,
        action_code,
        actor_id,
        workstation_id,
        to_status
    ) VALUES (
        v_package_id,
        'CREATED',
        v_actor_id,
        v_workstation_id,
        'DRAFT'
    );

    RETURN jsonb_build_object(
        'packageId', v_package_id,
        'status', 'DRAFT',
        'isReplay', false,
        'sourceType', v_source_type,
        'originalFilename', v_filename,
        'cutoverDate', p_cutover_date
    );
END;
$$;

CREATE FUNCTION onboarding.replace_opening_state_package_data(
    p_session_token text,
    p_package_id bigint,
    p_lines jsonb
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
    v_line_count integer;
BEGIN
    SELECT user_id, workstation_id
    INTO v_actor_id, v_workstation_id
    FROM iam.resolve_session_with_permission(
        p_session_token,
        'MANAGE_OPENING_STATE_RECONCILIATION'
    );

    IF p_package_id IS NULL OR p_package_id <= 0 THEN
        RAISE EXCEPTION 'invalid opening-state package id' USING ERRCODE = '22023';
    END IF;
    IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' THEN
        RAISE EXCEPTION 'opening-state lines must be a JSON array' USING ERRCODE = '22023';
    END IF;
    IF jsonb_array_length(p_lines) > 5000 THEN
        RAISE EXCEPTION 'opening-state package exceeds the 5000-line limit'
            USING ERRCODE = '54000';
    END IF;

    SELECT *
    INTO v_package
    FROM onboarding.opening_state_packages
    WHERE id = p_package_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'opening-state package not found' USING ERRCODE = 'P0002';
    END IF;
    IF v_package.created_by <> v_actor_id THEN
        RAISE EXCEPTION 'opening-state package belongs to another operator'
            USING ERRCODE = '42501';
    END IF;
    IF v_package.status NOT IN ('DRAFT', 'VALIDATED', 'NEEDS_REVIEW') THEN
        RAISE EXCEPTION 'opening-state package is immutable in its current status'
            USING ERRCODE = '55000';
    END IF;

    DELETE FROM onboarding.opening_state_lines
    WHERE package_id = p_package_id;

    INSERT INTO onboarding.opening_state_lines (
        package_id,
        source_row_number,
        line_type,
        description,
        amount_dzd,
        counterparty_name,
        external_reference,
        notes,
        review_status
    )
    SELECT
        p_package_id,
        line.source_row_number,
        upper(btrim(line.line_type)),
        btrim(line.description),
        line.amount_dzd,
        NULLIF(btrim(line.counterparty_name), ''),
        NULLIF(btrim(line.external_reference), ''),
        NULLIF(btrim(line.notes), ''),
        upper(btrim(line.review_status))
    FROM jsonb_to_recordset(p_lines) AS line(
        source_row_number integer,
        line_type text,
        description text,
        amount_dzd bigint,
        counterparty_name text,
        external_reference text,
        notes text,
        review_status text
    );

    GET DIAGNOSTICS v_line_count = ROW_COUNT;

    UPDATE onboarding.opening_state_packages
    SET status = 'DRAFT',
        validated_at = NULL,
        row_count = v_line_count,
        invalid_row_count = 0,
        total_assets_dzd = 0,
        total_liabilities_dzd = 0,
        total_equity_dzd = 0,
        reconciliation_difference_dzd = 0,
        validation_errors = '[]'::jsonb
    WHERE id = p_package_id;

    INSERT INTO onboarding.opening_state_audit (
        package_id,
        action_code,
        actor_id,
        workstation_id,
        from_status,
        to_status
    ) VALUES (
        p_package_id,
        'DATA_REPLACED',
        v_actor_id,
        v_workstation_id,
        v_package.status,
        'DRAFT'
    );

    RETURN jsonb_build_object(
        'packageId', p_package_id,
        'status', 'DRAFT',
        'lineCount', v_line_count
    );
END;
$$;

CREATE FUNCTION onboarding.validate_opening_state_package(
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
    v_row_count integer;
    v_invalid_row_count integer;
    v_assets bigint;
    v_liabilities bigint;
    v_equity bigint;
    v_difference bigint;
    v_package_errors jsonb := '[]'::jsonb;
    v_new_status text;
BEGIN
    SELECT user_id, workstation_id
    INTO v_actor_id, v_workstation_id
    FROM iam.resolve_session_with_permission(
        p_session_token,
        'MANAGE_OPENING_STATE_RECONCILIATION'
    );

    SELECT *
    INTO v_package
    FROM onboarding.opening_state_packages
    WHERE id = p_package_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'opening-state package not found' USING ERRCODE = 'P0002';
    END IF;
    IF v_package.status NOT IN ('DRAFT', 'VALIDATED', 'NEEDS_REVIEW') THEN
        RAISE EXCEPTION 'opening-state package cannot be validated in its current status'
            USING ERRCODE = '55000';
    END IF;

    UPDATE onboarding.opening_state_lines line
    SET validation_errors = errors.value
    FROM (
        SELECT
            candidate.id,
            COALESCE(jsonb_agg(to_jsonb(candidate.code)) FILTER (WHERE candidate.code IS NOT NULL), '[]'::jsonb) AS value
        FROM (
            SELECT l.id,
                CASE WHEN l.review_status <> 'READY' THEN 'REVIEW_REQUIRED' END AS code
            FROM onboarding.opening_state_lines l
            WHERE l.package_id = p_package_id
            UNION ALL
            SELECT l.id,
                CASE
                    WHEN l.line_type = 'CUSTOMER_RECEIVABLE'
                     AND (l.counterparty_name IS NULL OR btrim(l.counterparty_name) = '')
                    THEN 'CUSTOMER_REQUIRED'
                END AS code
            FROM onboarding.opening_state_lines l
            WHERE l.package_id = p_package_id
            UNION ALL
            SELECT l.id,
                CASE
                    WHEN l.line_type = 'SUPPLIER_PAYABLE'
                     AND (l.counterparty_name IS NULL OR btrim(l.counterparty_name) = '')
                    THEN 'SUPPLIER_REQUIRED'
                END AS code
            FROM onboarding.opening_state_lines l
            WHERE l.package_id = p_package_id
        ) candidate
        GROUP BY candidate.id
    ) errors
    WHERE line.id = errors.id;

    SELECT
        count(*)::integer,
        count(*) FILTER (WHERE jsonb_array_length(validation_errors) > 0)::integer,
        COALESCE(sum(amount_dzd) FILTER (WHERE line_type IN (
            'CASH', 'BANK', 'INVENTORY_VALUE', 'CUSTOMER_RECEIVABLE', 'OTHER_ASSET'
        )), 0),
        COALESCE(sum(amount_dzd) FILTER (WHERE line_type IN (
            'SUPPLIER_PAYABLE', 'LOAN_PAYABLE', 'TAX_PAYABLE', 'OTHER_LIABILITY'
        )), 0),
        COALESCE(sum(amount_dzd) FILTER (WHERE line_type IN (
            'OWNER_CAPITAL', 'RETAINED_EARNINGS'
        )), 0)
    INTO
        v_row_count,
        v_invalid_row_count,
        v_assets,
        v_liabilities,
        v_equity
    FROM onboarding.opening_state_lines
    WHERE package_id = p_package_id;

    v_difference := v_assets - v_liabilities - v_equity;

    IF v_row_count = 0 THEN
        v_package_errors := v_package_errors || jsonb_build_array('NO_LINES');
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM onboarding.opening_state_lines
        WHERE package_id = p_package_id AND line_type = 'CASH'
    ) THEN
        v_package_errors := v_package_errors || jsonb_build_array('CASH_REQUIRED');
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM onboarding.opening_state_lines
        WHERE package_id = p_package_id AND line_type = 'BANK'
    ) THEN
        v_package_errors := v_package_errors || jsonb_build_array('BANK_REQUIRED');
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM onboarding.opening_state_lines
        WHERE package_id = p_package_id AND line_type = 'INVENTORY_VALUE'
    ) THEN
        v_package_errors := v_package_errors || jsonb_build_array('INVENTORY_VALUE_REQUIRED');
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM onboarding.opening_state_lines
        WHERE package_id = p_package_id AND line_type IN ('OWNER_CAPITAL', 'RETAINED_EARNINGS')
    ) THEN
        v_package_errors := v_package_errors || jsonb_build_array('EQUITY_REQUIRED');
    END IF;
    IF v_difference <> 0 THEN
        v_package_errors := v_package_errors || jsonb_build_array('ACCOUNTING_EQUATION_NOT_BALANCED');
    END IF;

    v_new_status := CASE
        WHEN v_invalid_row_count = 0 AND jsonb_array_length(v_package_errors) = 0
        THEN 'VALIDATED'
        ELSE 'NEEDS_REVIEW'
    END;

    UPDATE onboarding.opening_state_packages
    SET status = v_new_status,
        validated_at = now(),
        row_count = v_row_count,
        invalid_row_count = v_invalid_row_count,
        total_assets_dzd = v_assets,
        total_liabilities_dzd = v_liabilities,
        total_equity_dzd = v_equity,
        reconciliation_difference_dzd = v_difference,
        validation_errors = v_package_errors
    WHERE id = p_package_id;

    INSERT INTO onboarding.opening_state_audit (
        package_id,
        action_code,
        actor_id,
        workstation_id,
        from_status,
        to_status
    ) VALUES (
        p_package_id,
        'VALIDATED',
        v_actor_id,
        v_workstation_id,
        v_package.status,
        v_new_status
    );

    RETURN jsonb_build_object(
        'packageId', p_package_id,
        'status', v_new_status,
        'rowCount', v_row_count,
        'invalidRowCount', v_invalid_row_count,
        'totalAssetsDzd', v_assets,
        'totalLiabilitiesDzd', v_liabilities,
        'totalEquityDzd', v_equity,
        'reconciliationDifferenceDzd', v_difference,
        'validationErrors', v_package_errors
    );
END;
$$;

CREATE FUNCTION onboarding.approve_opening_state_package(
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

    SELECT *
    INTO v_package
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
       OR jsonb_array_length(v_package.validation_errors) <> 0 THEN
        RAISE EXCEPTION 'opening-state package must be fully reconciled before approval'
            USING ERRCODE = '55000';
    END IF;

    UPDATE onboarding.opening_state_packages
    SET status = 'APPROVED_FOR_APPLICATION',
        approved_by = v_actor_id,
        approved_at = now()
    WHERE id = p_package_id;

    INSERT INTO onboarding.opening_state_audit (
        package_id,
        action_code,
        actor_id,
        workstation_id,
        from_status,
        to_status
    ) VALUES (
        p_package_id,
        'APPROVED',
        v_actor_id,
        v_workstation_id,
        v_package.status,
        'APPROVED_FOR_APPLICATION'
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

CREATE FUNCTION onboarding.get_opening_state_package(
    p_session_token text,
    p_package_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_package onboarding.opening_state_packages%ROWTYPE;
BEGIN
    PERFORM 1
    FROM iam.resolve_session_with_permission(
        p_session_token,
        'MANAGE_OPENING_STATE_RECONCILIATION'
    );

    SELECT *
    INTO v_package
    FROM onboarding.opening_state_packages
    WHERE id = p_package_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'opening-state package not found' USING ERRCODE = 'P0002';
    END IF;

    RETURN jsonb_build_object(
        'packageId', v_package.id,
        'status', v_package.status,
        'sourceType', v_package.source_type,
        'originalFilename', v_package.original_filename,
        'cutoverDate', v_package.cutover_date,
        'rowCount', v_package.row_count,
        'invalidRowCount', v_package.invalid_row_count,
        'totalAssetsDzd', v_package.total_assets_dzd,
        'totalLiabilitiesDzd', v_package.total_liabilities_dzd,
        'totalEquityDzd', v_package.total_equity_dzd,
        'reconciliationDifferenceDzd', v_package.reconciliation_difference_dzd,
        'validationErrors', v_package.validation_errors
    );
END;
$$;

REVOKE ALL ON FUNCTION onboarding.get_opening_state_setting(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION onboarding.update_opening_state_setting(text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION onboarding.create_opening_state_package(text, text, text, text, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION onboarding.replace_opening_state_package_data(text, bigint, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION onboarding.validate_opening_state_package(text, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION onboarding.approve_opening_state_package(text, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION onboarding.get_opening_state_package(text, bigint) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION onboarding.get_opening_state_setting(text) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION onboarding.update_opening_state_setting(text, boolean) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION onboarding.create_opening_state_package(text, text, text, text, date) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION onboarding.replace_opening_state_package_data(text, bigint, jsonb) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION onboarding.validate_opening_state_package(text, bigint) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION onboarding.approve_opening_state_package(text, bigint) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION onboarding.get_opening_state_package(text, bigint) TO stockiha_runtime;

-- Backups include the reconciliation evidence but the backup role remains read-only.
GRANT SELECT ON onboarding.opening_state_packages TO stockiha_backup;
GRANT SELECT ON onboarding.opening_state_lines TO stockiha_backup;
GRANT SELECT ON onboarding.opening_state_audit TO stockiha_backup;
GRANT SELECT ON SEQUENCE onboarding.opening_state_packages_id_seq TO stockiha_backup;
GRANT SELECT ON SEQUENCE onboarding.opening_state_lines_id_seq TO stockiha_backup;
GRANT SELECT ON SEQUENCE onboarding.opening_state_audit_id_seq TO stockiha_backup;

UPDATE operations.schema_state
SET migration_version = 20260805121000,
    updated_at = now()
WHERE singleton;

RESET ROLE;
