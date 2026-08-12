-- Integration assertion script for Business Documents Detail & Reports
-- Run against stockiha_r8e_verification_test

BEGIN;

-- 1. Setup Session
DELETE FROM iam.application_sessions WHERE workstation_id = 'WS-ASSERT-DOCS';
INSERT INTO iam.application_sessions (token_hash, user_id, workstation_id, expires_at)
VALUES (
    sha256('1111111111111111111111111111111111111111111111111111111111111111'),
    (SELECT id FROM iam.users WHERE username = 'admin'),
    'WS-ASSERT-DOCS',
    now() + interval '1 hour'
);

-- 2. Execute documents.get_business_document_reports
DO $$
DECLARE
    v_res jsonb;
    v_total_count integer;
    v_posted_count integer;
BEGIN
    v_res := documents.get_business_document_reports('1111111111111111111111111111111111111111111111111111111111111111');
    
    v_total_count := (v_res->'summary'->>'total_count')::integer;
    v_posted_count := (v_res->'summary'->>'posted_count')::integer;

    IF v_total_count < 1 THEN
        RAISE EXCEPTION 'ASSERTION FAILED: expected at least 1 document in report summary, found %', v_total_count;
    END IF;

    IF v_posted_count < 1 THEN
        RAISE EXCEPTION 'ASSERTION FAILED: expected at least 1 posted document, found %', v_posted_count;
    END IF;

    RAISE NOTICE 'ASSERTION 1 PASSED: get_business_document_reports returned % total, % posted docs', v_total_count, v_posted_count;
END;
$$;

-- 3. Execute documents.get_business_document_detail for Document ID 1
DO $$
DECLARE
    v_doc_id bigint;
    v_res jsonb;
    v_doc_num text;
    v_status text;
BEGIN
    SELECT id INTO v_doc_id FROM core.business_documents ORDER BY id ASC LIMIT 1;
    IF v_doc_id IS NULL THEN
        RAISE NOTICE 'No business documents found for detail assertion; skipping detail test.';
        RETURN;
    END IF;

    v_res := documents.get_business_document_detail('1111111111111111111111111111111111111111111111111111111111111111', v_doc_id);
    v_doc_num := v_res->'header'->>'document_number';
    v_status := v_res->'header'->>'status';

    IF v_doc_num IS NULL THEN
        RAISE EXCEPTION 'ASSERTION FAILED: expected valid document_number for doc %, got null', v_doc_id;
    END IF;

    IF v_status IS NULL THEN
        RAISE EXCEPTION 'ASSERTION FAILED: expected valid status for doc %, got null', v_doc_id;
    END IF;

    RAISE NOTICE 'ASSERTION 2 PASSED: get_business_document_detail for doc % (%) returned status %', v_doc_id, v_doc_num, v_status;
END;
$$;

COMMIT;

SELECT '=== ALL BUSINESS DOCUMENTS DETAIL & REPORTS SQL ASSERTIONS PASSED ===' AS status;
