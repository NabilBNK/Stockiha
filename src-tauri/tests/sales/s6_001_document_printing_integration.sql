-- Slice 6 Integration Test Suite: Document Numbering & Print Jobs Queue

\set ON_ERROR_STOP on
BEGIN;

DO $$
DECLARE
    v_token              text := 'test-s6001-token-' || gen_random_uuid();
    v_token_hash         bytea;
    v_user_id            bigint;
    v_fiscal_year        integer;
    v_period_id          bigint;
    v_seq                bigint;
    v_doc_num            text;
    v_doc_id             bigint;
    v_job_id             bigint;
    v_jobs               jsonb;
BEGIN
    v_token_hash := sha256(v_token::bytea);
    v_fiscal_year := extract(year FROM CURRENT_DATE)::integer;

    SELECT u.id INTO STRICT v_user_id FROM iam.users u WHERE u.is_active LIMIT 1;
    SELECT fp.id INTO STRICT v_period_id FROM finance.fiscal_periods fp WHERE fp.status = 'OPEN' LIMIT 1;

    INSERT INTO iam.user_roles (user_id, role_id)
    SELECT v_user_id, r.id FROM iam.roles r WHERE r.code IN ('ADMIN', 'MANAGER')
    ON CONFLICT DO NOTHING;

    INSERT INTO iam.application_sessions (user_id, workstation_id, token_hash, expires_at)
    VALUES (v_user_id, 'WS-S6001-TEST', v_token_hash, now() + interval '1 hour');

    -- Create test document
    v_seq := core.claim_next_document_number('CASH_SALE', v_fiscal_year);
    v_doc_num := 'INV-' || v_fiscal_year::text || '-' || lpad(v_seq::text, 6, '0');

    INSERT INTO core.business_documents
        (document_type, status, document_date, fiscal_period_id, fiscal_year, sequence_number, document_number, posted_at)
    VALUES
        ('CASH_SALE', 'POSTED', CURRENT_DATE, v_period_id, v_fiscal_year, v_seq, v_doc_num, now())
    RETURNING id INTO v_doc_id;

    -- ── Test 1: Enqueue Thermal Print Job ────────────────────────────────────
    v_job_id := core.enqueue_print_job(v_token, v_doc_id, 'THERMAL_RECEIPT', 'ESC_POS_80MM', 'POS-Printer-01');
    ASSERT v_job_id IS NOT NULL, 'Job ID is null';
    RAISE NOTICE 'Test 1 PASS: Thermal print job enqueued id=%', v_job_id;

    -- ── Test 2: List Print Jobs ──────────────────────────────────────────────
    v_jobs := core.list_print_jobs(v_token);
    ASSERT jsonb_array_length(v_jobs) >= 1, 'No print jobs found';
    ASSERT v_jobs->0->>'document_number' = v_doc_num, 'Document number mismatch in queue';
    ASSERT v_jobs->0->>'status' = 'PENDING', 'Status not PENDING';
    RAISE NOTICE 'Test 2 PASS: Print jobs listed successfully';

    -- ── Test 3: Update Job Status to COMPLETED ───────────────────────────────
    PERFORM core.update_print_job_status(v_token, v_job_id, 'COMPLETED', NULL);
    v_jobs := core.list_print_jobs(v_token);
    ASSERT v_jobs->0->>'status' = 'COMPLETED', 'Status not updated to COMPLETED';
    RAISE NOTICE 'Test 3 PASS: Print job status updated to COMPLETED';

    RAISE NOTICE '=== ALL SLICE 6 INTEGRATION ASSERTIONS PASSED ===';
END;
$$;

ROLLBACK;
