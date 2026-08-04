-- R0-001: safe correction path for the primary Excel workflow.
--
-- The UI creates a fresh idempotency request for each user action. When an
-- imported workbook needs correction, a second action using the same safe
-- filename must reuse the latest mutable batch owned by that actor; otherwise
-- the global Paper_ID duplicate guard would correctly reject the corrected
-- rows against their own prior draft. Approved/rejected batches remain
-- immutable and are never reused.
SET ROLE stockiha_owner;

CREATE OR REPLACE FUNCTION onboarding.create_historical_finance_batch(
    p_session_token text,
    p_request_id text,
    p_source_type text,
    p_original_filename text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_actor_id bigint;
    v_workstation_id text;
    v_existing onboarding.historical_finance_batches%ROWTYPE;
    v_batch_id bigint;
    v_enabled boolean;
    v_normalized_filename text;
BEGIN
    SELECT user_id, workstation_id
    INTO v_actor_id, v_workstation_id
    FROM iam.resolve_session_with_permission(
        p_session_token,
        'MANAGE_HISTORICAL_FINANCE_IMPORT'
    );

    SELECT historical_finance_import_enabled
    INTO v_enabled
    FROM onboarding.feature_settings
    WHERE singleton;

    IF NOT COALESCE(v_enabled, false) THEN
        RAISE EXCEPTION 'historical finance import is disabled'
            USING ERRCODE = '55000';
    END IF;

    IF p_request_id IS NULL OR length(btrim(p_request_id)) NOT BETWEEN 8 AND 128 THEN
        RAISE EXCEPTION 'invalid historical finance request id' USING ERRCODE = '22023';
    END IF;
    IF p_source_type NOT IN ('EXCEL', 'MANUAL') THEN
        RAISE EXCEPTION 'invalid historical finance source type' USING ERRCODE = '22023';
    END IF;
    IF p_source_type = 'EXCEL' AND (
        p_original_filename IS NULL
        OR btrim(p_original_filename) = ''
        OR length(p_original_filename) > 255
    ) THEN
        RAISE EXCEPTION 'Excel imports require a safe filename' USING ERRCODE = '22023';
    END IF;
    IF p_source_type = 'MANUAL' AND p_original_filename IS NOT NULL THEN
        RAISE EXCEPTION 'manual batches must not carry a filename' USING ERRCODE = '22023';
    END IF;

    v_normalized_filename := CASE
        WHEN p_original_filename IS NULL THEN NULL
        ELSE btrim(p_original_filename)
    END;

    -- Exact request replay remains the strongest idempotency signal.
    SELECT *
    INTO v_existing
    FROM onboarding.historical_finance_batches
    WHERE request_id = btrim(p_request_id);

    IF FOUND THEN
        IF v_existing.created_by <> v_actor_id
           OR v_existing.source_type <> p_source_type
           OR v_existing.original_filename IS DISTINCT FROM v_normalized_filename THEN
            RAISE EXCEPTION 'historical finance request id conflicts with an existing request'
                USING ERRCODE = '23505';
        END IF;

        RETURN jsonb_build_object(
            'batchId', v_existing.id,
            'status', v_existing.status,
            'isReplay', true,
            'sourceType', v_existing.source_type,
            'originalFilename', v_existing.original_filename
        );
    END IF;

    -- Primary Excel correction path: the same actor and filename reuse only
    -- the latest batch that is still mutable. This preserves Paper_ID
    -- uniqueness while allowing corrected workbook values to replace drafts.
    IF p_source_type = 'EXCEL' THEN
        SELECT *
        INTO v_existing
        FROM onboarding.historical_finance_batches
        WHERE created_by = v_actor_id
          AND source_type = 'EXCEL'
          AND original_filename = v_normalized_filename
          AND status IN ('DRAFT', 'VALIDATED', 'NEEDS_REVIEW')
        ORDER BY created_at DESC, id DESC
        LIMIT 1
        FOR UPDATE;

        IF FOUND THEN
            RETURN jsonb_build_object(
                'batchId', v_existing.id,
                'status', v_existing.status,
                'isReplay', true,
                'sourceType', v_existing.source_type,
                'originalFilename', v_existing.original_filename
            );
        END IF;
    END IF;

    INSERT INTO onboarding.historical_finance_batches (
        request_id,
        source_type,
        original_filename,
        created_by,
        workstation_id
    ) VALUES (
        btrim(p_request_id),
        p_source_type,
        v_normalized_filename,
        v_actor_id,
        v_workstation_id
    )
    RETURNING id INTO v_batch_id;

    INSERT INTO onboarding.historical_finance_audit (
        batch_id,
        action_code,
        actor_id,
        workstation_id,
        to_status
    ) VALUES (
        v_batch_id,
        'CREATED',
        v_actor_id,
        v_workstation_id,
        'DRAFT'
    );

    RETURN jsonb_build_object(
        'batchId', v_batch_id,
        'status', 'DRAFT',
        'isReplay', false,
        'sourceType', p_source_type,
        'originalFilename', v_normalized_filename
    );
END;
$$;

UPDATE operations.schema_state
SET migration_version = 20260804190500,
    updated_at = now()
WHERE singleton;

RESET ROLE;
