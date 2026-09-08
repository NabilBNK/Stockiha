-- WS-K-1.2 hotfix: grant read-only SELECT on public._sqlx_migrations to the
-- runtime role.
--
-- infrastructure::schema_version::check_schema_compatibility (WS-K-1) reads
-- _sqlx_migrations at startup and on every explicit Retry, to compare the
-- applied schema version against what this binary expects. stockiha_runtime
-- had never been granted access to this table before WS-K-1 added that
-- read: nothing at runtime read it beforehand. The result on the Owner's
-- own working dev cluster was "permission denied for table
-- _sqlx_migrations" on every attempt, visible repeating in PostgreSQL's log.
--
-- Read-only, by design: stockiha_runtime must never be able to alter
-- migration history, so only SELECT is granted — never INSERT/UPDATE/DELETE.
-- Follows the exact precedent already set for stockiha_backup by
-- 20260804120500_r6_001_sqlx_metadata_backup_acl.sql, including the
-- to_regclass guard so a raw-SQL deployment without _sqlx_migrations remains
-- supported.
RESET ROLE;

DO $$
BEGIN
    IF to_regclass('public._sqlx_migrations') IS NOT NULL THEN
        REVOKE ALL ON TABLE public._sqlx_migrations FROM stockiha_runtime;
        GRANT SELECT ON TABLE public._sqlx_migrations TO stockiha_runtime;
    END IF;
END;
$$;
