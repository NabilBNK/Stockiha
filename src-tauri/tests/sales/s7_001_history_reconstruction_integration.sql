-- SQL Integration Test Suite for Slice 7: Sandbox Reconstruction & Historical Importer
BEGIN;

-- Setup session & grant permissions to test user
DO $$
DECLARE
    v_user_id UUID;
BEGIN
    SELECT id INTO v_user_id FROM iam.users WHERE username = 'admin';
    IF v_user_id IS NOT NULL THEN
        INSERT INTO iam.user_permissions (user_id, permission_id)
        SELECT v_user_id, p.id
        FROM iam.permissions p
        WHERE p.permission_code IN ('IMPORT_HISTORICAL_DATA', 'REVIEW_HISTORICAL_BATCH', 'COMMIT_HISTORICAL_BATCH')
        ON CONFLICT DO NOTHING;
    END IF;
END $$;

-- Create test session token
INSERT INTO iam.application_sessions (session_token_hash, user_id, expires_at)
SELECT encode(digest('s7_test_token', 'sha256'), 'hex'), id, CURRENT_TIMESTAMP + INTERVAL '1 hour'
FROM iam.users WHERE username = 'admin'
ON CONFLICT (session_token_hash) DO UPDATE SET expires_at = CURRENT_TIMESTAMP + INTERVAL '1 hour';

-- Test 1: Create Import Batch
DO $$
DECLARE
    v_res JSONB;
    v_batch_id UUID;
BEGIN
    v_res := core.create_import_batch('s7_test_token', 'historic_products.csv', 10);
    v_batch_id := (v_res->>'batch_id')::UUID;
    ASSERT v_batch_id IS NOT NULL, 'Batch ID should not be NULL';
    ASSERT v_res->>'status' = 'STAGING', 'Batch status should be STAGING';

    -- Insert mock staged record
    INSERT INTO history.staged_records (batch_id, row_number, entity_type, raw_json, status)
    VALUES (v_batch_id, 1, 'PRODUCT', '{"name": "Old Stock Item", "price": 100}'::jsonb, 'PENDING');
END $$;

-- Test 2: List Import Batches
DO $$
DECLARE
    v_count INT;
BEGIN
    SELECT COUNT(*) INTO v_count FROM core.list_import_batches('s7_test_token');
    ASSERT v_count >= 1, 'Should return at least 1 import batch';
END $$;

-- Test 3: Replay & Commit Historical Batch
DO $$
DECLARE
    v_batch_id UUID;
    v_replay JSONB;
    v_commit JSONB;
BEGIN
    SELECT id INTO v_batch_id FROM history.import_batches LIMIT 1;

    -- Replay in sandbox
    v_replay := core.replay_historical_batch('s7_test_token', v_batch_id);
    ASSERT v_replay->>'reconstruction_status' = 'REPLAY_SUCCESSFUL', 'Replay status should be REPLAY_SUCCESSFUL';

    -- Commit batch
    v_commit := core.commit_historical_batch('s7_test_token', v_batch_id);
    ASSERT v_commit->>'status' = 'LOCKED', 'Committed batch status should be LOCKED';
END $$;

ROLLBACK;
