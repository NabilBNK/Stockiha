-- R6-001 backup-role ACL regression.
-- Runs inside the transaction owned by run_current_sql_suites.sh.
\set ON_ERROR_STOP on

DO $$
BEGIN
    ASSERT EXISTS (
        SELECT 1
        FROM pg_namespace n
        JOIN pg_roles owner_role ON owner_role.oid = n.nspowner
        WHERE owner_role.rolname = 'stockiha_owner'
          AND n.nspname NOT LIKE 'pg\_%' ESCAPE '\'
          AND n.nspname <> 'information_schema'
    ), 'Expected at least one Stockiha-owned schema';

    ASSERT NOT EXISTS (
        SELECT 1
        FROM pg_namespace n
        JOIN pg_roles owner_role ON owner_role.oid = n.nspowner
        WHERE owner_role.rolname = 'stockiha_owner'
          AND n.nspname NOT LIKE 'pg\_%' ESCAPE '\'
          AND n.nspname <> 'information_schema'
          AND NOT has_schema_privilege('stockiha_backup', n.oid, 'USAGE')
    ), 'Backup role must have USAGE on every Stockiha-owned schema';

    ASSERT NOT EXISTS (
        SELECT 1
        FROM pg_namespace n
        JOIN pg_roles owner_role ON owner_role.oid = n.nspowner
        WHERE owner_role.rolname = 'stockiha_owner'
          AND n.nspname NOT LIKE 'pg\_%' ESCAPE '\'
          AND n.nspname <> 'information_schema'
          AND has_schema_privilege('stockiha_backup', n.oid, 'CREATE')
    ), 'Backup role must not create objects in Stockiha schemas';

    ASSERT NOT EXISTS (
        SELECT 1
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_roles owner_role ON owner_role.oid = n.nspowner
        WHERE owner_role.rolname = 'stockiha_owner'
          AND CASE
              WHEN c.relkind IN ('r', 'p', 'v', 'm', 'f')
                  THEN NOT has_table_privilege('stockiha_backup', c.oid, 'SELECT')
              ELSE false
          END
    ), 'Backup role must read every current Stockiha relation';

    ASSERT NOT EXISTS (
        SELECT 1
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_roles owner_role ON owner_role.oid = n.nspowner
        WHERE owner_role.rolname = 'stockiha_owner'
          AND CASE
              WHEN c.relkind IN ('r', 'p', 'v', 'm', 'f') THEN (
                  has_table_privilege('stockiha_backup', c.oid, 'INSERT')
                  OR has_table_privilege('stockiha_backup', c.oid, 'UPDATE')
                  OR has_table_privilege('stockiha_backup', c.oid, 'DELETE')
                  OR has_table_privilege('stockiha_backup', c.oid, 'TRUNCATE')
                  OR has_table_privilege('stockiha_backup', c.oid, 'REFERENCES')
                  OR has_table_privilege('stockiha_backup', c.oid, 'TRIGGER')
              )
              ELSE false
          END
    ), 'Backup role must not receive table write or trigger privileges';

    -- CASE is intentional. PostgreSQL may reorder plain WHERE predicates and
    -- call has_sequence_privilege on indexes before applying relkind = 'S'.
    ASSERT NOT EXISTS (
        SELECT 1
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_roles owner_role ON owner_role.oid = n.nspowner
        WHERE owner_role.rolname = 'stockiha_owner'
          AND CASE
              WHEN c.relkind = 'S'
                  THEN NOT has_sequence_privilege('stockiha_backup', c.oid, 'SELECT')
              ELSE false
          END
    ), 'Backup role must read every current Stockiha sequence';

    ASSERT NOT EXISTS (
        SELECT 1
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_roles owner_role ON owner_role.oid = n.nspowner
        WHERE owner_role.rolname = 'stockiha_owner'
          AND CASE
              WHEN c.relkind = 'S' THEN (
                  has_sequence_privilege('stockiha_backup', c.oid, 'USAGE')
                  OR has_sequence_privilege('stockiha_backup', c.oid, 'UPDATE')
              )
              ELSE false
          END
    ), 'Backup role must not advance or mutate Stockiha sequences';

    ASSERT NOT pg_has_role('stockiha_backup', 'stockiha_owner', 'MEMBER'),
        'Backup role must not inherit or hold owner membership';
END;
$$;

-- Functional proof that owner-created future objects in an existing application
-- schema inherit the intended read-only ACL through ALTER DEFAULT PRIVILEGES.
SET ROLE stockiha_owner;
CREATE TABLE operations.r6_001_backup_default_acl_table_probe (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    note text NOT NULL
);
CREATE SEQUENCE operations.r6_001_backup_default_acl_sequence_probe;
RESET ROLE;

DO $$
BEGIN
    ASSERT has_table_privilege(
        'stockiha_backup',
        'operations.r6_001_backup_default_acl_table_probe',
        'SELECT'
    ), 'Future owner-created tables must be readable by the backup role';
    ASSERT NOT has_table_privilege(
        'stockiha_backup',
        'operations.r6_001_backup_default_acl_table_probe',
        'INSERT'
    ), 'Future owner-created tables must remain non-writable by the backup role';
    ASSERT has_sequence_privilege(
        'stockiha_backup',
        'operations.r6_001_backup_default_acl_sequence_probe',
        'SELECT'
    ), 'Future owner-created sequences must be readable by the backup role';
    ASSERT NOT has_sequence_privilege(
        'stockiha_backup',
        'operations.r6_001_backup_default_acl_sequence_probe',
        'USAGE'
    ), 'Future owner-created sequences must not be advanceable by the backup role';
END;
$$;

SET ROLE stockiha_owner;
DROP TABLE operations.r6_001_backup_default_acl_table_probe;
DROP SEQUENCE operations.r6_001_backup_default_acl_sequence_probe;
RESET ROLE;
