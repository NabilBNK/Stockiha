-- S4-002 Integration Test Suite: Cashier Session Advanced Transitions & Credit Override Tokens

\set ON_ERROR_STOP on
BEGIN;

DO $$
DECLARE
    v_token          text := 'test-s4002-token-' || gen_random_uuid();
    v_token_hash     bytea;
    v_user_id        bigint;
    v_warehouse_id   bigint;
    v_workstation    text := 'WS-S4002-TEST';
    v_session_id     bigint;
    v_customer_id    bigint;
    v_result         jsonb;
    v_denoms         jsonb;
    v_override_res   jsonb;
    v_override_token uuid;
    v_hash           bytea;
    v_valid          boolean;
BEGIN
    v_token_hash := sha256(v_token::bytea);

    -- 1. Setup User & Roles
    SELECT u.id INTO STRICT v_user_id FROM iam.users u WHERE u.is_active LIMIT 1;
    SELECT w.id INTO STRICT v_warehouse_id FROM inventory.warehouses w LIMIT 1;

    INSERT INTO iam.user_roles (user_id, role_id)
    SELECT v_user_id, r.id FROM iam.roles r WHERE r.code IN ('ADMIN', 'MANAGER', 'CASHIER')
    ON CONFLICT DO NOTHING;

    INSERT INTO iam.application_sessions (user_id, workstation_id, token_hash, expires_at)
    VALUES (v_user_id, v_workstation, v_token_hash, now() + interval '1 hour');

    -- 2. Test: Open Cash Session
    v_session_id := sales.open_cash_session(v_token, v_warehouse_id, v_workstation, 1000.00);
    ASSERT v_session_id IS NOT NULL, 'Failed to open cash session';
    RAISE NOTICE 'Test 1 PASS: Cash session opened id=%', v_session_id;

    -- 3. Test: Suspend Session
    v_result := sales.suspend_cash_session(v_token, v_session_id);
    ASSERT v_result->>'status' = 'SUSPENDED', 'Status mismatch on suspend';
    RAISE NOTICE 'Test 2 PASS: Cash session suspended';

    -- 4. Test: Resume Session
    v_result := sales.resume_cash_session(v_token, v_session_id);
    ASSERT v_result->>'status' = 'OPEN', 'Status mismatch on resume';
    RAISE NOTICE 'Test 3 PASS: Cash session resumed';

    -- 5. Test: Submit Closing with Denominations and Variance
    -- Opening float = 1000, Counted = 1500 (1x1000 + 1x500), Expected = 1000, Variance = +500
    v_denoms := '[{"denomination": 1000.00, "bill_count": 1}, {"denomination": 500.00, "bill_count": 1}]'::jsonb;
    v_result := sales.submit_session_closing(v_token, v_session_id, v_denoms);

    ASSERT v_result->>'status' = 'PENDING_APPROVAL', 'Non-zero variance should set status to PENDING_APPROVAL';
    ASSERT (v_result->>'variance_amount')::numeric = 500.00, 'Variance amount mismatch';
    RAISE NOTICE 'Test 4 PASS: Session submitted for closing, status=PENDING_APPROVAL variance=500.00';

    -- 6. Test: List Pending Variance Sessions
    v_result := sales.list_pending_variance_sessions(v_token);
    ASSERT jsonb_array_length(v_result) > 0, 'list_pending_variance_sessions returned empty array';
    RAISE NOTICE 'Test 5 PASS: Pending variance sessions listed';

    -- 7. Test: Manager Approval of Variance
    v_result := sales.approve_session_variance(v_token, v_session_id, 'Manager approved 500 DZD overage');
    ASSERT v_result->>'status' = 'CLOSED', 'Status after approval should be CLOSED';
    RAISE NOTICE 'Test 6 PASS: Variance approved, status=CLOSED';

    -- 8. Test: Credit Override Token Generation & Single-Use Verification
    -- Create test customer
    v_result := sales.create_customer(v_token, 'CUST-OVERRIDE-01', 'Override Client', NULL, NULL, NULL, NULL, NULL, 10000.00, 30);
    v_customer_id := (v_result->>'id')::bigint;

    v_hash := sha256('draft-sale-payload-123'::bytea);
    v_override_res := sales.generate_credit_override_token(v_token, v_customer_id, v_hash, 15);
    v_override_token := (v_override_res->>'token')::uuid;
    ASSERT v_override_token IS NOT NULL, 'Failed to generate credit override token';
    RAISE NOTICE 'Test 7 PASS: Override token generated token=%', v_override_token;

    -- Verify first use succeeds
    v_valid := sales.verify_and_use_credit_override_token(v_override_token, v_customer_id, v_hash);
    ASSERT v_valid = TRUE, 'First token use should succeed';
    RAISE NOTICE 'Test 8 PASS: Override token verified and used';

    -- Verify second use fails (single-use constraint)
    v_valid := sales.verify_and_use_credit_override_token(v_override_token, v_customer_id, v_hash);
    ASSERT v_valid = FALSE, 'Second token use should fail';
    RAISE NOTICE 'Test 9 PASS: Second token use correctly rejected (single-use enforced)';

    RAISE NOTICE '=== ALL S4-002 INTEGRATION ASSERTIONS PASSED ===';
END;
$$;

ROLLBACK;
