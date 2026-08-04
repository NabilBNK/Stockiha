-- R0-001 Excel correction-path regression.
-- Runs inside the transaction owned by run_current_sql_suites.sh.
\set ON_ERROR_STOP on

DO $$
DECLARE
    v_admin_id bigint;
    v_admin_token text := 'r0_001_excel_correction_token';
    v_first jsonb;
    v_reused jsonb;
    v_after_approval jsonb;
    v_validation jsonb;
    v_batch_id bigint;
BEGIN
    INSERT INTO iam.users (username, display_name, password_hash)
    VALUES ('r0_001_excel_correction_admin', 'R0 Excel Correction Admin', 'hash')
    RETURNING id INTO v_admin_id;

    INSERT INTO iam.user_roles (user_id, role_id)
    SELECT v_admin_id, id FROM iam.roles WHERE code = 'ADMIN';

    INSERT INTO iam.application_sessions (user_id, workstation_id, token_hash, expires_at)
    VALUES (
        v_admin_id,
        'R0-CORRECTION-WKS',
        sha256(v_admin_token::bytea),
        now() + interval '1 hour'
    );

    v_first := onboarding.create_historical_finance_batch(
        v_admin_token,
        'r0-correction-request-0001',
        'EXCEL',
        'historical-correction.xlsx'
    );
    v_batch_id := (v_first ->> 'batchId')::bigint;

    PERFORM onboarding.replace_historical_finance_batch_data(
        v_admin_token,
        v_batch_id,
        jsonb_build_array(
            jsonb_build_object(
                'source_row_number', 2,
                'paper_id', 'PAPER-CORRECTION-001',
                'transaction_date', '2025-01-10',
                'transaction_type', 'SALE',
                'description_or_category', 'Needs settlement review',
                'net_amount_dzd', 100000,
                'payment_status', 'UNKNOWN',
                'review_status', 'READY'
            )
        ),
        '[]'::jsonb
    );

    v_validation := onboarding.validate_historical_finance_batch(
        v_admin_token,
        v_batch_id
    );
    ASSERT v_validation ->> 'status' = 'NEEDS_REVIEW',
        'Initial workbook must require review';

    -- A new UI action creates a new request id, but the same actor and safe
    -- filename must return the original mutable batch.
    v_reused := onboarding.create_historical_finance_batch(
        v_admin_token,
        'r0-correction-request-0002',
        'EXCEL',
        'historical-correction.xlsx'
    );
    ASSERT (v_reused ->> 'batchId')::bigint = v_batch_id,
        'Corrected workbook must reuse its mutable batch';
    ASSERT (v_reused ->> 'isReplay')::boolean,
        'Corrected workbook reuse must be explicit in the safe result';

    PERFORM onboarding.replace_historical_finance_batch_data(
        v_admin_token,
        v_batch_id,
        jsonb_build_array(
            jsonb_build_object(
                'source_row_number', 2,
                'paper_id', 'PAPER-CORRECTION-001',
                'transaction_date', '2025-01-10',
                'transaction_type', 'SALE',
                'description_or_category', 'Confirmed paid historical sale',
                'net_amount_dzd', 100000,
                'payment_status', 'PAID',
                'amount_paid_dzd', 100000,
                'review_status', 'READY'
            )
        ),
        '[]'::jsonb
    );

    v_validation := onboarding.validate_historical_finance_batch(
        v_admin_token,
        v_batch_id
    );
    ASSERT v_validation ->> 'status' = 'VALIDATED',
        'Corrected workbook must validate without Paper_ID collision';

    PERFORM onboarding.approve_historical_finance_batch(v_admin_token, v_batch_id);

    -- Once approved, the same filename starts a distinct immutable-history
    -- batch rather than modifying the approved evidence.
    v_after_approval := onboarding.create_historical_finance_batch(
        v_admin_token,
        'r0-correction-request-0003',
        'EXCEL',
        'historical-correction.xlsx'
    );
    ASSERT (v_after_approval ->> 'batchId')::bigint <> v_batch_id,
        'Approved Excel batch must never be reused or modified';
    ASSERT NOT (v_after_approval ->> 'isReplay')::boolean,
        'A post-approval import must be a new batch';
END;
$$;
