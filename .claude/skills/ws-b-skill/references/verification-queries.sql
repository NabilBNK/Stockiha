-- =====================================================================
-- WS-B — Financial Core verification queries
-- =====================================================================
-- READ-ONLY. Every statement here is a SELECT against catalog or data
-- tables. Nothing is modified, created, or locked.
--
-- Run with:
--   psql -U <user> -d <database> -f verification-queries.sql -o output.txt
--
-- Sections 1-6 are schema-agnostic and run as-is.
-- Sections 7-10 are TEMPLATES: identify the real table and column names
-- from sections 1-2 first, substitute them, then run. Do NOT guess table
-- names — a query against the wrong table produces a confident wrong
-- answer, which is worse than no answer.
-- =====================================================================


-- =====================================================================
-- 1. SCHEMA INVENTORY
-- What exists at all. Establishes the real table names for sections 7-10.
-- =====================================================================
SELECT n.nspname AS schema_name,
       c.relname AS table_name,
       c.reltuples::bigint AS approx_rows
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'r'
  AND n.nspname NOT LIKE 'pg\_%' AND n.nspname <> 'information_schema'
ORDER BY 1, 2;


-- =====================================================================
-- 2. NUMERIC COLUMN TYPES AND SCALES
-- Confirms the actual money scale and WAC scale in use.
-- Do not assume 2 decimal places — read it here.
-- =====================================================================
SELECT table_schema,
       table_name,
       column_name,
       data_type,
       numeric_precision,
       numeric_scale
FROM information_schema.columns
WHERE data_type IN ('numeric', 'double precision', 'real', 'money')
  AND table_schema NOT LIKE 'pg\_%' AND table_schema <> 'information_schema'
ORDER BY 1, 2, 3;


-- =====================================================================
-- 3. FLOATING-POINT VIOLATIONS  ***MUST RETURN ZERO ROWS***
-- Any money, quantity, cost, or valuation column here is a direct
-- violation of the no-floating-point invariant, and every number it
-- has ever touched is already imprecise.
-- =====================================================================
SELECT table_schema, table_name, column_name, data_type
FROM information_schema.columns
WHERE data_type IN ('double precision', 'real')
  AND table_schema NOT LIKE 'pg\_%' AND table_schema <> 'information_schema'
ORDER BY 1, 2, 3;


-- =====================================================================
-- 4. SECURITY DEFINER FUNCTIONS — full list with owner and search_path
-- A SECURITY DEFINER function runs with its OWNER's privileges.
-- Ownership drift changes effective privileges silently.
-- A NULL search_path on an elevated function is a privilege-escalation
-- vector.
-- =====================================================================
SELECT n.nspname                       AS schema_name,
       p.proname                       AS function_name,
       pg_get_userbyid(p.proowner)     AS owner,
       COALESCE(
         (SELECT s FROM unnest(p.proconfig) AS s WHERE s LIKE 'search\_path=%'),
         '** NO search_path SET **'
       )                               AS search_path_setting
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE p.prosecdef
  AND p.prokind = 'f'
  AND n.nspname NOT LIKE 'pg\_%' AND n.nspname <> 'information_schema'
ORDER BY 1, 2;


-- =====================================================================
-- 5. SECURITY DEFINER FUNCTIONS WITH NO AUTHORIZATION KEYWORD
-- HEURISTIC, NOT PROOF. Searches each function body for permission-
-- related keywords. Expect false positives (a function may authorize
-- via a helper with different naming) and false negatives (a keyword
-- may appear in a comment). Treat the output as a review shortlist and
-- read each body by hand.
-- =====================================================================
SELECT n.nspname AS schema_name,
       p.proname AS function_name
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE p.prosecdef
  AND p.prokind = 'f'
  AND n.nspname NOT LIKE 'pg\_%' AND n.nspname <> 'information_schema'
  AND pg_get_functiondef(p.oid) !~*
      '(permission|authoriz|require_|has_perm|check_perm|session_token|current_session|assert_)'
ORDER BY 1, 2;


-- =====================================================================
-- 6a. CHECK CONSTRAINTS
-- Where negative stock, balance, and sign rules are actually enforced.
-- If a rule is not here, it lives only in application code — which is
-- not enforcement.
-- =====================================================================
SELECT n.nspname                        AS schema_name,
       t.relname                        AS table_name,
       con.conname                      AS constraint_name,
       pg_get_constraintdef(con.oid)    AS definition
FROM pg_constraint con
JOIN pg_class t     ON t.oid = con.conrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE con.contype = 'c'
  AND n.nspname NOT LIKE 'pg\_%' AND n.nspname <> 'information_schema'
ORDER BY 1, 2, 3;


-- =====================================================================
-- 6b. TRIGGERS
-- Immutability (B-8) and balance enforcement (B-2) are commonly
-- implemented here. Absence of any trigger on journal tables is a
-- strong signal that posted rows are NOT protected.
-- =====================================================================
SELECT n.nspname  AS schema_name,
       t.relname  AS table_name,
       tg.tgname  AS trigger_name,
       p.proname  AS trigger_function
FROM pg_trigger tg
JOIN pg_class t     ON t.oid = tg.tgrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
JOIN pg_proc p      ON p.oid = tg.tgfoid
WHERE NOT tg.tgisinternal
  AND n.nspname NOT LIKE 'pg\_%' AND n.nspname <> 'information_schema'
ORDER BY 1, 2, 3;


-- =====================================================================
-- 6c. RUNTIME ROLE GRANTS
-- Grant drift has already occurred in this project on IAM tables.
-- A table can exist, the code can be correct, and the runtime role can
-- still lack the privilege to write to it — failing only at runtime,
-- mid-transaction.
-- =====================================================================
SELECT table_schema, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE grantee = 'stockiha_runtime'
ORDER BY 1, 2, 3;


-- =====================================================================
-- 6d. UNIQUE CONSTRAINTS — idempotency key check
-- Idempotency requires a UNIQUE constraint on the request key.
-- A SELECT-then-INSERT check is NOT idempotency: two concurrent calls
-- both see nothing and both insert.
-- =====================================================================
SELECT n.nspname                     AS schema_name,
       t.relname                     AS table_name,
       con.conname                   AS constraint_name,
       pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint con
JOIN pg_class t     ON t.oid = con.conrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE con.contype IN ('u', 'p')
  AND n.nspname NOT LIKE 'pg\_%' AND n.nspname <> 'information_schema'
  AND (pg_get_constraintdef(con.oid) ILIKE '%request%'
    OR pg_get_constraintdef(con.oid) ILIKE '%idempot%'
    OR pg_get_constraintdef(con.oid) ILIKE '%correlation%')
ORDER BY 1, 2;


-- =====================================================================
-- ===================  TEMPLATES BELOW THIS LINE  =====================
-- Substitute real table and column names from sections 1-2 first.
-- =====================================================================


-- =====================================================================
-- 7. JOURNAL BALANCE  ***MUST RETURN ZERO ROWS***
-- The single most important correctness check in WS-B.
-- Every journal entry must sum to zero across its lines.
-- =====================================================================
-- SELECT jl.entry_id,
--        SUM(jl.debit)  AS total_debit,
--        SUM(jl.credit) AS total_credit,
--        SUM(jl.debit) - SUM(jl.credit) AS imbalance
-- FROM   <journal_lines_table> jl
-- GROUP  BY jl.entry_id
-- HAVING SUM(jl.debit) <> SUM(jl.credit);
--
-- If the schema uses a single signed amount column instead of separate
-- debit/credit columns:
--
-- SELECT jl.entry_id, SUM(jl.amount) AS imbalance
-- FROM   <journal_lines_table> jl
-- GROUP  BY jl.entry_id
-- HAVING SUM(jl.amount) <> 0;


-- =====================================================================
-- 8. ORPHANS  ***MUST RETURN ZERO ROWS***
-- Headers with no lines, and lines with no header. Either indicates a
-- non-atomic posting path.
-- =====================================================================
-- SELECT je.id AS header_with_no_lines
-- FROM   <journal_entries_table> je
-- LEFT   JOIN <journal_lines_table> jl ON jl.entry_id = je.id
-- WHERE  jl.entry_id IS NULL;
--
-- SELECT jl.id AS line_with_no_header
-- FROM   <journal_lines_table> jl
-- LEFT   JOIN <journal_entries_table> je ON je.id = jl.entry_id
-- WHERE  je.id IS NULL;


-- =====================================================================
-- 9. SUBLEDGER RECONCILIATION  ***DIFFERENCE MUST BE ZERO***
-- AR: sum of customer balances vs the AR control account in the GL.
-- Repeat the same shape for AP with suppliers.
-- =====================================================================
-- WITH subledger AS (
--   SELECT SUM(balance) AS total FROM <customer_balances_source>
-- ),
-- control AS (
--   SELECT SUM(jl.debit) - SUM(jl.credit) AS total
--   FROM   <journal_lines_table> jl
--   WHERE  jl.account_id = <ar_control_account_id>
-- )
-- SELECT subledger.total AS subledger_total,
--        control.total   AS gl_control_total,
--        subledger.total - control.total AS difference
-- FROM   subledger, control;


-- =====================================================================
-- 10. INVENTORY VALUATION RECONCILIATION
-- Compare three figures. All three should agree.
--   a) GL inventory control account balance   <- authoritative
--   b) Sum of posted movement amounts
--   c) Sum of (current qty x current WAC)     <- drift detector
-- (a) vs (b) failing means posting is inconsistent.
-- (a) vs (c) failing means WAC has drifted from posted cost.
-- =====================================================================
-- SELECT SUM(jl.debit) - SUM(jl.credit) AS gl_inventory_balance
-- FROM   <journal_lines_table> jl
-- WHERE  jl.account_id = <inventory_control_account_id>;
--
-- SELECT SUM(sl.quantity_on_hand * sl.wac) AS qty_times_wac_valuation
-- FROM   <stock_levels_table> sl;


-- =====================================================================
-- 11. IMMUTABILITY PROBE — RUN INSIDE A TRANSACTION, THEN ROLL BACK
-- Confirms the DATABASE rejects mutation of posted rows, rather than
-- the application merely avoiding it.
-- The ROLLBACK is mandatory. Never run the UPDATE outside a transaction.
-- Expected result: the UPDATE raises an error.
-- =====================================================================
-- BEGIN;
--   UPDATE <journal_lines_table> SET debit = debit + 1 WHERE id = <some_posted_id>;
-- ROLLBACK;


-- =====================================================================
-- END
-- =====================================================================
