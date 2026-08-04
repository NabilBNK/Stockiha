-- R0-001 onboarding backup-role ACL regression.
-- Runs inside the transaction owned by run_current_sql_suites.sh.
\set ON_ERROR_STOP on

DO $$
DECLARE
    v_table regclass;
    v_sequence regclass;
BEGIN
    ASSERT has_schema_privilege('stockiha_backup', 'onboarding', 'USAGE'),
        'Backup role must have USAGE on onboarding';
    ASSERT NOT has_schema_privilege('stockiha_backup', 'onboarding', 'CREATE'),
        'Backup role must not create objects in onboarding';

    FOREACH v_table IN ARRAY ARRAY[
        'onboarding.feature_settings'::regclass,
        'onboarding.historical_finance_batches'::regclass,
        'onboarding.historical_finance_rows'::regclass,
        'onboarding.historical_finance_balances'::regclass,
        'onboarding.historical_finance_audit'::regclass
    ]
    LOOP
        ASSERT has_table_privilege('stockiha_backup', v_table, 'SELECT'),
            format('Backup role must SELECT %s', v_table);
        ASSERT NOT has_table_privilege('stockiha_backup', v_table, 'INSERT'),
            format('Backup role must not INSERT %s', v_table);
        ASSERT NOT has_table_privilege('stockiha_backup', v_table, 'UPDATE'),
            format('Backup role must not UPDATE %s', v_table);
        ASSERT NOT has_table_privilege('stockiha_backup', v_table, 'DELETE'),
            format('Backup role must not DELETE %s', v_table);
        ASSERT NOT has_table_privilege('stockiha_backup', v_table, 'TRUNCATE'),
            format('Backup role must not TRUNCATE %s', v_table);
        ASSERT NOT has_table_privilege('stockiha_backup', v_table, 'TRIGGER'),
            format('Backup role must not TRIGGER %s', v_table);
    END LOOP;

    FOREACH v_sequence IN ARRAY ARRAY[
        'onboarding.historical_finance_batches_id_seq'::regclass,
        'onboarding.historical_finance_rows_id_seq'::regclass,
        'onboarding.historical_finance_balances_id_seq'::regclass,
        'onboarding.historical_finance_audit_id_seq'::regclass
    ]
    LOOP
        ASSERT has_sequence_privilege('stockiha_backup', v_sequence, 'SELECT'),
            format('Backup role must SELECT %s', v_sequence);
        ASSERT NOT has_sequence_privilege('stockiha_backup', v_sequence, 'USAGE'),
            format('Backup role must not use nextval on %s', v_sequence);
        ASSERT NOT has_sequence_privilege('stockiha_backup', v_sequence, 'UPDATE'),
            format('Backup role must not setval %s', v_sequence);
    END LOOP;

    ASSERT NOT (
        SELECT rolcanlogin
        FROM pg_roles
        WHERE rolname = 'stockiha_owner'
    ), 'Owner role must remain NOLOGIN';

    ASSERT NOT pg_has_role('stockiha_backup', 'stockiha_owner', 'MEMBER'),
        'Backup role must not inherit owner membership';

    ASSERT (
        SELECT migration_version
        FROM operations.schema_state
        WHERE singleton
    ) = 20260804185000,
        'ACL-only migration must not change the recoverable schema version';
END;
$$;
