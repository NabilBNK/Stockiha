-- R0-001 feature-toggle audit regression.
-- Runs inside the transaction owned by run_current_sql_suites.sh.
\set ON_ERROR_STOP on

DO $$
DECLARE
    v_admin_id bigint;
    v_admin_token text := 'r0_001_setting_admin_token';
BEGIN
    INSERT INTO iam.users (username, display_name, password_hash)
    VALUES ('r0_001_setting_admin', 'R0 Setting Admin', 'hash')
    RETURNING id INTO v_admin_id;

    INSERT INTO iam.user_roles (user_id, role_id)
    SELECT v_admin_id, id FROM iam.roles WHERE code = 'ADMIN';

    INSERT INTO iam.application_sessions (user_id, workstation_id, token_hash, expires_at)
    VALUES (
        v_admin_id,
        'R0-SETTING-WKS',
        sha256(v_admin_token::bytea),
        now() + interval '1 hour'
    );

    PERFORM onboarding.update_historical_finance_setting(v_admin_token, false);
    PERFORM onboarding.update_historical_finance_setting(v_admin_token, false);
    PERFORM onboarding.update_historical_finance_setting(v_admin_token, true);

    ASSERT (
        SELECT count(*)
        FROM onboarding.historical_finance_audit
        WHERE action_code = 'SETTING_CHANGED'
          AND actor_id = v_admin_id
          AND workstation_id = 'R0-SETTING-WKS'
          AND batch_id IS NULL
    ) = 2,
        'Only actual historical-import setting changes must be audited';

    ASSERT EXISTS (
        SELECT 1
        FROM onboarding.historical_finance_audit
        WHERE action_code = 'SETTING_CHANGED'
          AND actor_id = v_admin_id
          AND from_status = 'true'
          AND to_status = 'false'
    ), 'Disabling the feature must retain its old and new value';

    ASSERT EXISTS (
        SELECT 1
        FROM onboarding.historical_finance_audit
        WHERE action_code = 'SETTING_CHANGED'
          AND actor_id = v_admin_id
          AND from_status = 'false'
          AND to_status = 'true'
    ), 'Re-enabling the feature must retain its old and new value';

    ASSERT NOT EXISTS (
        SELECT 1
        FROM onboarding.historical_finance_audit
        WHERE action_code <> 'SETTING_CHANGED'
          AND batch_id IS NULL
    ), 'Every non-setting audit entry must retain its batch identifier';
END;
$$;
