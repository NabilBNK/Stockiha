-- S1-001: production schema namespaces for the Golden Transaction Chain.
--
-- Mirrors the search_path convention fixed by every SECURITY DEFINER function
-- in final-architecture.md section 2 ("SET search_path = pg_catalog, sales,
-- inventory, finance, core"): every schema below is created and owned by
-- `stockiha_owner`, never by `stockiha_migrator` itself, matching the S0-006
-- proof pattern (SET ROLE stockiha_owner for DDL, RESET ROLE afterwards).
-- `stockiha_migrator` can assume `stockiha_owner` because S0-004 granted that
-- role membership WITH ADMIN FALSE, INHERIT FALSE, SET TRUE.
SET ROLE stockiha_owner;

CREATE SCHEMA IF NOT EXISTS core AUTHORIZATION stockiha_owner;
CREATE SCHEMA IF NOT EXISTS inventory AUTHORIZATION stockiha_owner;
CREATE SCHEMA IF NOT EXISTS sales AUTHORIZATION stockiha_owner;
CREATE SCHEMA IF NOT EXISTS finance AUTHORIZATION stockiha_owner;

-- Default posture for every schema created above: nothing is reachable by
-- PUBLIC, and `stockiha_runtime` only ever receives USAGE plus per-object
-- grants added by later migrations (SELECT on read paths, EXECUTE on the
-- specific SECURITY DEFINER functions it needs). Direct INSERT/UPDATE/DELETE
-- on ledgers stays exclusively behind future posting functions.
--
-- These REVOKE/GRANT statements must run while still acting as
-- `stockiha_owner` (the schema owner) — issuing them after RESET ROLE would
-- run them as `stockiha_migrator`, which has no privilege to change grants
-- on an object it does not own.
REVOKE ALL ON SCHEMA core FROM PUBLIC;
REVOKE ALL ON SCHEMA inventory FROM PUBLIC;
REVOKE ALL ON SCHEMA sales FROM PUBLIC;
REVOKE ALL ON SCHEMA finance FROM PUBLIC;

GRANT USAGE ON SCHEMA core TO stockiha_runtime;
GRANT USAGE ON SCHEMA inventory TO stockiha_runtime;
GRANT USAGE ON SCHEMA sales TO stockiha_runtime;
GRANT USAGE ON SCHEMA finance TO stockiha_runtime;

RESET ROLE;
