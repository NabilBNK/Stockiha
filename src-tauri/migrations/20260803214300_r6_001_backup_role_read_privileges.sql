-- R6-001 follow-up: make the fixed stockiha_backup login capable of taking a
-- complete read-only pg_dump on a freshly migrated Stockiha database.
--
-- Windows acceptance exposed that role attributes alone were insufficient:
-- pg_dump also requires USAGE on application schemas plus SELECT on every
-- relation and sequence. The acceptance database had to be repaired manually,
-- which means the original branch was not production-ready on a clean install.
--
-- This migration is deliberately least-privilege and forward-only:
-- - no owner membership;
-- - no DML, DDL, EXECUTE, or bypass-RLS capability;
-- - read access only to schemas owned by stockiha_owner;
-- - matching default privileges for future objects in those existing schemas.
SET ROLE stockiha_owner;

DO $$
DECLARE
    v_schema name;
BEGIN
    FOR v_schema IN
        SELECT n.nspname
        FROM pg_namespace n
        JOIN pg_roles owner_role ON owner_role.oid = n.nspowner
        WHERE owner_role.rolname = 'stockiha_owner'
          AND n.nspname NOT LIKE 'pg\_%' ESCAPE '\'
          AND n.nspname <> 'information_schema'
        ORDER BY n.nspname
    LOOP
        -- Enforce a strict read-only posture for all current objects.
        EXECUTE format('REVOKE ALL ON SCHEMA %I FROM stockiha_backup', v_schema);
        EXECUTE format('GRANT USAGE ON SCHEMA %I TO stockiha_backup', v_schema);

        EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA %I FROM stockiha_backup', v_schema);
        EXECUTE format('GRANT SELECT ON ALL TABLES IN SCHEMA %I TO stockiha_backup', v_schema);

        EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA %I FROM stockiha_backup', v_schema);
        EXECUTE format('GRANT SELECT ON ALL SEQUENCES IN SCHEMA %I TO stockiha_backup', v_schema);

        -- Future owner-created relations in existing Stockiha schemas inherit
        -- the same read-only backup ACL automatically.
        EXECUTE format(
            'ALTER DEFAULT PRIVILEGES FOR ROLE stockiha_owner IN SCHEMA %I REVOKE ALL ON TABLES FROM stockiha_backup',
            v_schema
        );
        EXECUTE format(
            'ALTER DEFAULT PRIVILEGES FOR ROLE stockiha_owner IN SCHEMA %I GRANT SELECT ON TABLES TO stockiha_backup',
            v_schema
        );
        EXECUTE format(
            'ALTER DEFAULT PRIVILEGES FOR ROLE stockiha_owner IN SCHEMA %I REVOKE ALL ON SEQUENCES FROM stockiha_backup',
            v_schema
        );
        EXECUTE format(
            'ALTER DEFAULT PRIVILEGES FOR ROLE stockiha_owner IN SCHEMA %I GRANT SELECT ON SEQUENCES TO stockiha_backup',
            v_schema
        );
    END LOOP;
END;
$$;

UPDATE operations.schema_state
SET migration_version = 20260803214300,
    updated_at = now()
WHERE singleton;

RESET ROLE;
