-- R6-001 regression: SQLx metadata remains readable but never writable by the
-- fixed backup role. This suite is meaningful both for real SQLx deployments
-- and for CI, which creates a representative metadata table before migrations.
\set ON_ERROR_STOP on

DO $$
BEGIN
    ASSERT has_schema_privilege('stockiha_backup', 'public', 'USAGE'),
        'Backup role must have USAGE on public for SQLx migration metadata';

    ASSERT NOT has_schema_privilege('stockiha_backup', 'public', 'CREATE'),
        'Backup role must not create objects in public';

    IF to_regclass('public._sqlx_migrations') IS NOT NULL THEN
        ASSERT has_table_privilege(
            'stockiha_backup',
            'public._sqlx_migrations',
            'SELECT'
        ), 'Backup role must read SQLx migration metadata';

        ASSERT NOT has_table_privilege(
            'stockiha_backup',
            'public._sqlx_migrations',
            'INSERT'
        ), 'Backup role must not insert SQLx migration metadata';

        ASSERT NOT has_table_privilege(
            'stockiha_backup',
            'public._sqlx_migrations',
            'UPDATE'
        ), 'Backup role must not update SQLx migration metadata';

        ASSERT NOT has_table_privilege(
            'stockiha_backup',
            'public._sqlx_migrations',
            'DELETE'
        ), 'Backup role must not delete SQLx migration metadata';

        ASSERT NOT has_table_privilege(
            'stockiha_backup',
            'public._sqlx_migrations',
            'TRUNCATE'
        ), 'Backup role must not truncate SQLx migration metadata';
    END IF;
END;
$$;
