-- WS-I-001b backup compatibility for the new reports schema.
--
-- The fixed stockiha_backup role must be able to include the reports schema
-- (functions only -- no tables or sequences yet) in a complete PostgreSQL
-- backup, same as every other Stockiha-owned schema
-- (src-tauri/tests/recovery/r6_001_backup_role_read_privileges_integration.sql
-- asserts this for every schema owned by stockiha_owner). The WS-I-001
-- migration's own SQL is specified verbatim by the WS-I plan and does not
-- include this grant, matching the same gap the r0_001 onboarding schema had
-- until 20260804185500_r0_001_onboarding_backup_acl.sql closed it -- this
-- migration follows that exact precedent rather than editing WS-I-001's SQL.
-- Least privilege preserved: schema USAGE only. No INSERT, UPDATE, DELETE,
-- TRUNCATE, CREATE, EXECUTE, ownership, role membership, or bypass-RLS
-- capability. ALL TABLES/SEQUENCES and ALTER DEFAULT PRIVILEGES statements
-- are intentionally omitted: the reports schema holds no tables or sequences
-- (WS-I-2/WS-I-3 add more functions to this same schema, never state).
SET ROLE stockiha_owner;

REVOKE ALL ON SCHEMA reports FROM stockiha_backup;
GRANT USAGE ON SCHEMA reports TO stockiha_backup;

RESET ROLE;
