-- S1-001 (corrected): production schema namespaces for the Golden
-- Transaction Chain, plus one shared helper trigger function.
--
-- Correction from the first pass: `catalog` is added as its own schema
-- (products / variants) — final-architecture.md's search_path example
-- ("pg_catalog, sales, inventory, finance, core") predates the variant
-- grain this correction introduces, so `catalog` is a deliberate addition,
-- not a renaming of an existing architecture schema.
SET ROLE stockiha_owner;

CREATE SCHEMA IF NOT EXISTS core AUTHORIZATION stockiha_owner;
CREATE SCHEMA IF NOT EXISTS catalog AUTHORIZATION stockiha_owner;
CREATE SCHEMA IF NOT EXISTS inventory AUTHORIZATION stockiha_owner;
CREATE SCHEMA IF NOT EXISTS sales AUTHORIZATION stockiha_owner;
CREATE SCHEMA IF NOT EXISTS finance AUTHORIZATION stockiha_owner;

-- Shared, schema-qualified utility: bumps `updated_at` to the transaction
-- timestamp on every UPDATE. Fixed body, no dynamic SQL, callable from any
-- schema via `core.set_updated_at()`.
CREATE FUNCTION core.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

RESET ROLE;

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
SET ROLE stockiha_owner;

REVOKE ALL ON SCHEMA core FROM PUBLIC;
REVOKE ALL ON SCHEMA catalog FROM PUBLIC;
REVOKE ALL ON SCHEMA inventory FROM PUBLIC;
REVOKE ALL ON SCHEMA sales FROM PUBLIC;
REVOKE ALL ON SCHEMA finance FROM PUBLIC;

GRANT USAGE ON SCHEMA core TO stockiha_runtime;
GRANT USAGE ON SCHEMA catalog TO stockiha_runtime;
GRANT USAGE ON SCHEMA inventory TO stockiha_runtime;
GRANT USAGE ON SCHEMA sales TO stockiha_runtime;
GRANT USAGE ON SCHEMA finance TO stockiha_runtime;

REVOKE ALL ON FUNCTION core.set_updated_at() FROM PUBLIC;

RESET ROLE;
