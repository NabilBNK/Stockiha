-- R5-003 opening-state setup lifecycle regression.
-- Runs inside the transaction owned by run_current_sql_suites.sh.
\set ON_ERROR_STOP on

SAVEPOINT r5_003_optional_choice;

DO $$
DECLARE
    v_admin_id bigint;
    v_cashier_id bigint;
    v_admin_token text := 'r5_003_choice_admin_token';
    v_cashier_token text := 'r5_003_choice_cashier_token';
    v_result jsonb;
    v_denied boolean := false;
    v_blocked boolean := false;
BEGIN
    INSERT INTO iam.users (username, display_name, password_hash)
    VALUES ('r5_003_choice_admin', 'R5 Choice Admin', 'hash')
    RETURNING id INTO v_admin_id;
    INSERT INTO iam.user_roles (user_id, role_id)
    SELECT v_admin_id, id FROM iam.roles WHERE code = 'ADMIN';
    INSERT INTO iam.application_sessions (user_id, workstation_id, token_hash, expires_at)
    VALUES (v_admin_id, 'R5-CHOICE-WKS', sha256(v_admin_token::bytea), now() + interval '1 hour');

    INSERT INTO iam.users (username, display_name, password_hash)
    VALUES ('r5_003_choice_cashier', 'R5 Choice Cashier', 'hash')
    RETURNING id INTO v_cashier_id;
    INSERT INTO iam.user_roles (user_id, role_id)
    SELECT v_cashier_id, id FROM iam.roles WHERE code = 'CASHIER';
    INSERT INTO iam.application_sessions (user_id, workstation_id, token_hash, expires_at)
    VALUES (v_cashier_id, 'R5-CHOICE-CASHIER-WKS', sha256(v_cashier_token::bytea), now() + interval '1 hour');

    v_result := onboarding.get_opening_state_onboarding_status(v_admin_token);
    ASSERT v_result ->> 'status' = 'PENDING',
        'Opening state must begin as a pending optional setup decision';
    ASSERT (v_result ->> 'enabled')::boolean,
        'Pending opening state must remain available by default';
    ASSERT (v_result ->> 'showDeferredAccess')::boolean,
        'Pending setup must be visible only through the privileged setup path';

    BEGIN
        PERFORM onboarding.get_opening_state_onboarding_status(v_cashier_token);
    EXCEPTION WHEN insufficient_privilege THEN
        v_denied := true;
    END;
    ASSERT v_denied, 'Cashier must not discover or access opening-state setup';

    v_result := onboarding.set_opening_state_onboarding_choice(v_admin_token, 'DEFERRED');
    ASSERT v_result ->> 'status' = 'DEFERRED',
        'Administrator must be able to postpone optional opening state';
    ASSERT (v_result ->> 'enabled')::boolean,
        'Deferred opening state must remain available later';
    ASSERT (v_result ->> 'showDeferredAccess')::boolean,
        'Deferred opening state must be exposed only through restricted settings';

    v_result := onboarding.set_opening_state_onboarding_choice(v_admin_token, 'DEFERRED');
    ASSERT (v_result ->> 'isReplay')::boolean,
        'Repeating the same setup choice must be replay-safe';

    v_result := onboarding.set_opening_state_onboarding_choice(v_admin_token, 'DECLINED');
    ASSERT v_result ->> 'status' = 'DECLINED',
        'Administrator must be able to decline optional opening state';
    ASSERT NOT (v_result ->> 'enabled')::boolean,
        'Declined opening state must be disabled';
    ASSERT NOT (v_result ->> 'showDeferredAccess')::boolean,
        'Declined opening state must disappear from later setup access';

    BEGIN
        PERFORM onboarding.create_opening_state_package(
            v_admin_token,
            'r5-declined-package',
            'MANUAL',
            NULL,
            DATE '2026-08-05'
        );
    EXCEPTION WHEN object_not_in_prerequisite_state THEN
        v_blocked := true;
    END;
    ASSERT v_blocked, 'Declining opening state must block package creation';

    ASSERT EXISTS (
        SELECT 1 FROM onboarding.opening_state_audit
        WHERE action_code = 'SETUP_DEFERRED' AND actor_id = v_admin_id
    ), 'Deferral must be audited';
    ASSERT EXISTS (
        SELECT 1 FROM onboarding.opening_state_audit
        WHERE action_code = 'SETUP_DECLINED' AND actor_id = v_admin_id
    ), 'Decline must be audited';
END;
$$;

ROLLBACK TO SAVEPOINT r5_003_optional_choice;

SAVEPOINT r5_003_completion;

DO $$
DECLARE
    v_admin_id bigint;
    v_admin_token text := 'r5_003_complete_admin_token';
    v_package jsonb;
    v_package_id bigint;
    v_result jsonb;
    v_blocked boolean := false;
BEGIN
    INSERT INTO iam.users (username, display_name, password_hash)
    VALUES ('r5_003_complete_admin', 'R5 Complete Admin', 'hash')
    RETURNING id INTO v_admin_id;
    INSERT INTO iam.user_roles (user_id, role_id)
    SELECT v_admin_id, id FROM iam.roles WHERE code = 'ADMIN';
    INSERT INTO iam.application_sessions (user_id, workstation_id, token_hash, expires_at)
    VALUES (v_admin_id, 'R5-COMPLETE-WKS', sha256(v_admin_token::bytea), now() + interval '1 hour');

    v_package := onboarding.create_opening_state_package(
        v_admin_token,
        'r5-complete-package',
        'MANUAL',
        NULL,
        DATE '2026-08-05'
    );
    v_package_id := (v_package ->> 'packageId')::bigint;

    PERFORM onboarding.replace_opening_state_package_data(
        v_admin_token,
        v_package_id,
        jsonb_build_array(
            jsonb_build_object(
                'source_row_number', 2,
                'line_type', 'CASH',
                'description', 'Cash',
                'amount_dzd', 1000,
                'review_status', 'READY'
            ),
            jsonb_build_object(
                'source_row_number', 3,
                'line_type', 'BANK',
                'description', 'Bank',
                'amount_dzd', 0,
                'review_status', 'READY'
            ),
            jsonb_build_object(
                'source_row_number', 4,
                'line_type', 'INVENTORY_VALUE',
                'description', 'Inventory value',
                'amount_dzd', 0,
                'review_status', 'READY'
            ),
            jsonb_build_object(
                'source_row_number', 5,
                'line_type', 'OWNER_CAPITAL',
                'description', 'Owner capital',
                'amount_dzd', 1000,
                'review_status', 'READY'
            )
        )
    );

    v_result := onboarding.validate_opening_state_package(v_admin_token, v_package_id);
    ASSERT v_result ->> 'status' = 'VALIDATED',
        'Balanced one-time opening state must validate';

    PERFORM onboarding.approve_opening_state_package(v_admin_token, v_package_id);

    v_result := onboarding.get_opening_state_onboarding_status(v_admin_token);
    ASSERT v_result ->> 'status' = 'COMPLETED',
        'Approval must complete the one-time setup lifecycle';
    ASSERT NOT (v_result ->> 'enabled')::boolean,
        'Completed opening state must disable further entry';
    ASSERT (v_result ->> 'hasApprovedPackage')::boolean,
        'Completed lifecycle must expose approved evidence to privileged code';
    ASSERT NOT (v_result ->> 'showDeferredAccess')::boolean,
        'Completed opening state must disappear from setup/settings access';

    BEGIN
        PERFORM onboarding.set_opening_state_onboarding_choice(v_admin_token, 'DEFERRED');
    EXCEPTION WHEN object_not_in_prerequisite_state THEN
        v_blocked := true;
    END;
    ASSERT v_blocked, 'Completed opening state must not be reopened as deferred';

    ASSERT EXISTS (
        SELECT 1 FROM onboarding.opening_state_audit
        WHERE package_id = v_package_id
          AND action_code = 'SETUP_COMPLETED'
          AND actor_id = v_admin_id
    ), 'One-time completion must be audited';
END;
$$;

ROLLBACK TO SAVEPOINT r5_003_completion;
