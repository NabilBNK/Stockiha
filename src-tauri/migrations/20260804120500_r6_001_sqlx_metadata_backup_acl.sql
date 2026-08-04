-- R6-001 follow-up: include SQLx migration metadata in least-privilege backups.
--
-- A real Windows acceptance run exposed a deployment-path gap. `sqlx migrate`
-- creates `public._sqlx_migrations` before applying repository migrations. That
-- table is not owned by `stockiha_owner`, so the prior schema-owner ACL sweep
-- deliberately did not touch it. `pg_dump` then failed unless the operator
-- changed role posture or schema ownership manually.
--
-- This migration keeps `stockiha_owner` NOLOGIN and grants the fixed backup
-- role read-only access only to SQLx's metadata table when it exists. Raw-SQL
-- deployments that do not create the table remain supported.
RESET ROLE;

REVOKE CREATE ON SCHEMA public FROM stockiha_backup;
GRANT USAGE ON SCHEMA public TO stockiha_backup;

DO $$
BEGIN
    IF to_regclass('public._sqlx_migrations') IS NOT NULL THEN
        REVOKE ALL ON TABLE public._sqlx_migrations FROM stockiha_backup;
        GRANT SELECT ON TABLE public._sqlx_migrations TO stockiha_backup;
    END IF;
END;
$$;
