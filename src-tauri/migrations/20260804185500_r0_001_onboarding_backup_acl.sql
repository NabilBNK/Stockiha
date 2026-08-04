-- R0-001 backup compatibility for the new onboarding schema.
--
-- The fixed stockiha_backup role must be able to include historical-finance
-- staging and audit evidence in a complete PostgreSQL backup. This migration
-- preserves least privilege: schema USAGE and relation/sequence SELECT only.
-- It grants no INSERT, UPDATE, DELETE, TRUNCATE, CREATE, EXECUTE, ownership,
-- role membership, or bypass-RLS capability.
--
-- This is an ACL-only migration. It deliberately does not advance
-- operations.schema_state beyond the recoverable schema version established by
-- 20260804185000.
SET ROLE stockiha_owner;

REVOKE ALL ON SCHEMA onboarding FROM stockiha_backup;
GRANT USAGE ON SCHEMA onboarding TO stockiha_backup;

REVOKE ALL ON ALL TABLES IN SCHEMA onboarding FROM stockiha_backup;
GRANT SELECT ON ALL TABLES IN SCHEMA onboarding TO stockiha_backup;

REVOKE ALL ON ALL SEQUENCES IN SCHEMA onboarding FROM stockiha_backup;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA onboarding TO stockiha_backup;

ALTER DEFAULT PRIVILEGES FOR ROLE stockiha_owner IN SCHEMA onboarding
    REVOKE ALL ON TABLES FROM stockiha_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE stockiha_owner IN SCHEMA onboarding
    GRANT SELECT ON TABLES TO stockiha_backup;

ALTER DEFAULT PRIVILEGES FOR ROLE stockiha_owner IN SCHEMA onboarding
    REVOKE ALL ON SEQUENCES FROM stockiha_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE stockiha_owner IN SCHEMA onboarding
    GRANT SELECT ON SEQUENCES TO stockiha_backup;

RESET ROLE;
