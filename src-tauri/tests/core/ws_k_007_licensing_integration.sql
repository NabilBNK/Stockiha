-- WS-K-7: licensing database-side integration assertions (plan §9.3).
-- Runs inside the caller's transaction (see run_current_sql_suites.sh);
-- assumes a bootstrapped iam.users row and a valid session are needed for
-- the session-gated functions, so this suite creates its own throwaway
-- user and session first.

DO $$
DECLARE
    v_user_id bigint;
    v_session_token text := 'ws-k-7-test-session-token';
    v_touch jsonb;
    v_result text;
BEGIN
    -- ——— fixture: one user + one active session ———
    INSERT INTO iam.users (username, password_hash, display_name, is_active)
    VALUES ('ws_k_7_test_user', 'x', 'WS-K-7 Test User', true)
    RETURNING id INTO v_user_id;

    INSERT INTO iam.application_sessions (user_id, workstation_id, token_hash, expires_at)
    VALUES (v_user_id, 'WS-K-7-TEST', sha256(v_session_token::bytea), now() + interval '1 hour');

    -- 1. core.licence_touch() returns nulls initially.
    v_touch := core.licence_touch();
    IF v_touch->>'grace_started_at' IS NOT NULL OR v_touch->>'last_seen_at' IS NOT NULL THEN
        RAISE EXCEPTION 'assertion 1 failed: licence_touch() must return nulls initially, got %', v_touch;
    END IF;

    -- 2a. licence_record_seen stores the values. Comparisons parse the
    -- jsonb text back into timestamptz and compare instants, so the
    -- assertions do not depend on the server's session timezone.
    PERFORM core.licence_record_seen(
        '2026-01-01T00:00:00Z'::timestamptz,
        '2026-01-02T00:00:00Z'::timestamptz
    );
    v_touch := core.licence_touch();
    IF (v_touch->>'grace_started_at')::timestamptz <> '2026-01-01T00:00:00Z'::timestamptz
        OR (v_touch->>'last_seen_at')::timestamptz <> '2026-01-02T00:00:00Z'::timestamptz THEN
        RAISE EXCEPTION 'assertion 2a failed: unexpected values %', v_touch;
    END IF;

    -- 2b. a later first-seen does not move grace earlier.
    PERFORM core.licence_record_seen(
        '2026-01-05T00:00:00Z'::timestamptz,
        '2026-01-02T00:00:00Z'::timestamptz
    );
    v_touch := core.licence_touch();
    IF (v_touch->>'grace_started_at')::timestamptz <> '2026-01-01T00:00:00Z'::timestamptz THEN
        RAISE EXCEPTION 'assertion 2b failed: grace_started_at must not move later, got %', v_touch;
    END IF;

    -- 2c. an earlier last-seen does not lower it.
    PERFORM core.licence_record_seen(
        '2026-01-01T00:00:00Z'::timestamptz,
        '2026-01-01T00:00:00Z'::timestamptz
    );
    v_touch := core.licence_touch();
    IF (v_touch->>'last_seen_at')::timestamptz <> '2026-01-02T00:00:00Z'::timestamptz THEN
        RAISE EXCEPTION 'assertion 2c failed: last_seen_at must never go down, got %', v_touch;
    END IF;

    -- 3a. licence_reset_last_seen(valid_token, t0) lowers it.
    PERFORM core.licence_reset_last_seen(v_session_token, '2025-06-01T00:00:00Z'::timestamptz);
    v_touch := core.licence_touch();
    IF (v_touch->>'last_seen_at')::timestamptz <> '2025-06-01T00:00:00Z'::timestamptz THEN
        RAISE EXCEPTION 'assertion 3a failed: licence_reset_last_seen must lower last_seen_at, got %', v_touch;
    END IF;

    -- 3b. an invalid token raises 28000.
    BEGIN
        PERFORM core.licence_reset_last_seen('not-a-real-token', now());
        RAISE EXCEPTION 'assertion 3b failed: an invalid session token must be rejected';
    EXCEPTION
        WHEN sqlstate '28000' THEN
            NULL; -- expected
    END;

    -- 4a. record_licence_event inserts a row with user_id.
    PERFORM core.record_licence_event(v_session_token, 'ACTIVATED', 'L-1', 'STKH-TEST-0000-0000-0001', NULL);
    IF NOT EXISTS (
        SELECT 1 FROM core.licence_events
        WHERE event_type = 'ACTIVATED' AND licence_id = 'L-1' AND user_id = v_user_id
    ) THEN
        RAISE EXCEPTION 'assertion 4a failed: expected an ACTIVATED row with user_id %', v_user_id;
    END IF;

    -- 4b. an invalid event type is rejected by the table's own CHECK
    -- constraint (licence_events_type_valid) — not re-validated in the
    -- function body.
    BEGIN
        PERFORM core.record_licence_event(v_session_token, 'BOGUS', NULL, NULL, NULL);
        RAISE EXCEPTION 'assertion 4b failed: BOGUS event type must be rejected';
    EXCEPTION
        WHEN check_violation THEN
            NULL; -- expected
    END;
    -- The failed insert above aborts the current subtransaction's changes
    -- but not the outer block; nothing further depends on its side effects.

    -- 5. stockiha_runtime cannot SELECT the two tables directly.
    IF has_table_privilege('stockiha_runtime', 'core.licence_runtime', 'SELECT') THEN
        RAISE EXCEPTION 'assertion 5 failed: stockiha_runtime must not have SELECT on core.licence_runtime';
    END IF;
    IF has_table_privilege('stockiha_runtime', 'core.licence_events', 'SELECT') THEN
        RAISE EXCEPTION 'assertion 5 failed: stockiha_runtime must not have SELECT on core.licence_events';
    END IF;

    -- 6. schema_state has advanced to at least this migration.
    SELECT migration_version::text INTO v_result FROM operations.schema_state WHERE singleton;
    IF v_result::bigint < 20260926090000 THEN
        RAISE EXCEPTION 'assertion 6 failed: schema_state.migration_version % is behind 20260926090000', v_result;
    END IF;

    RAISE NOTICE 'ws_k_007_licensing_integration: all assertions passed';
END;
$$;
