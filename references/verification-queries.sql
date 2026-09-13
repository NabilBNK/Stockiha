-- =====================================================================
-- WS-D — Product & Inventory Core verification queries
-- =====================================================================
-- READ-ONLY. Every statement is a SELECT against catalog metadata or
-- data tables. Nothing is modified, created, or locked.
--
-- Run with:
--   psql -U <user> -d stockiha_r8_acceptance_inventory_test -p 5433 \
--        -f verification-queries.sql -o output.txt
--
-- Sections 1-4 establish reality and should be run BEFORE writing code.
-- Sections 5-9 verify behaviour and are run AFTER a change.
--
-- Do not guess table or column names. Section 1 tells you the real ones.
-- A query against the wrong table produces a confident wrong answer,
-- which is worse than no answer at all.
-- =====================================================================


-- =====================================================================
-- 1. SCHEMA INVENTORY — what actually exists
-- =====================================================================
SELECT n.nspname AS schema_name,
       c.relname AS table_name,
       c.reltuples::bigint AS approx_rows
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname IN ('catalog', 'inventory')
  AND c.relkind = 'r'
ORDER BY 1, 2;


-- =====================================================================
-- 2. LIVE FUNCTION SIGNATURES — the authority, not the .sql files
-- =====================================================================
-- More than one row for the same proname means OVERLOADS ARE LIVE.
-- Read SKILL.md section 2.1 before calling any function listed twice.
SELECT p.proname,
       p.oid::regprocedure AS live_signature,
       CASE p.provolatile WHEN 's' THEN 'STABLE'
                          WHEN 'i' THEN 'IMMUTABLE'
                          ELSE 'VOLATILE' END AS volatility,
       p.prosecdef        AS security_definer
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname IN ('catalog', 'inventory')
ORDER BY p.proname, live_signature;


-- =====================================================================
-- 2b. OVERLOAD DETECTOR — run this every time
-- =====================================================================
SELECT p.proname,
       count(*)                                   AS signature_count,
       string_agg(p.oid::regprocedure::text, E'\n') AS signatures
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname IN ('catalog', 'inventory')
GROUP BY p.proname
HAVING count(*) > 1
ORDER BY 1;


-- =====================================================================
-- 3. PERMISSION SURFACE — anything PUBLIC can execute is a finding
-- =====================================================================
SELECT p.oid::regprocedure AS function_signature,
       a.grantee,
       a.privilege_type
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
LEFT JOIN pg_roles r ON r.oid = a.grantee
WHERE n.nspname IN ('catalog', 'inventory')
  AND (a.grantee = 0 OR r.rolname = 'public')
ORDER BY 1;


-- =====================================================================
-- 4. CONSTRAINTS AND IMMUTABILITY TRIGGERS
-- =====================================================================
SELECT conrelid::regclass AS table_name,
       conname            AS constraint_name,
       pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE connamespace IN ('catalog'::regnamespace, 'inventory'::regnamespace)
  AND contype IN ('c', 'u', 'f')
ORDER BY 1, 2;

SELECT c.relname AS table_name,
       t.tgname  AS trigger_name,
       p.proname AS function_called
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_proc p ON p.oid = t.tgfoid
WHERE n.nspname IN ('catalog', 'inventory')
  AND NOT t.tgisinternal
ORDER BY 1, 2;


-- =====================================================================
-- 5. IDENTIFIER INTEGRITY
-- =====================================================================
-- 5a. A barcode must never map to more than one variant.
--     Any row returned is a correctness failure.
SELECT barcode, count(*) AS variant_count
FROM catalog.variant_barcodes
GROUP BY barcode
HAVING count(*) > 1;

-- 5b. SKU uniqueness across variants. Any row returned is a failure.
SELECT sku, count(*) AS variant_count
FROM catalog.product_variants
WHERE sku IS NOT NULL
GROUP BY sku
HAVING count(*) > 1;

-- 5c. Variants with neither barcode nor SKU have no display identifier
--     at all. Any row returned means display_identifier will be null.
SELECT v.id AS variant_id, v.product_id
FROM catalog.product_variants v
LEFT JOIN catalog.variant_barcodes b ON b.variant_id = v.id
WHERE v.sku IS NULL AND b.id IS NULL;


-- =====================================================================
-- 6. STOCK INTEGRITY
-- =====================================================================
-- 6a. Confirmed negative stock is forbidden. Any row is a breach of a
--     core invariant -- stop and escalate, do not "fix" the data.
SELECT variant_id, warehouse_id, quantity_on_hand
FROM inventory.stock_positions
WHERE quantity_on_hand < 0;

-- 6b. Float contamination. Authoritative quantity, cost and value columns
--     must be numeric. Any row returned is an invariant violation.
SELECT c.table_schema, c.table_name, c.column_name, c.data_type
FROM information_schema.columns c
WHERE c.table_schema IN ('catalog', 'inventory')
  AND c.data_type IN ('double precision', 'real')
ORDER BY 1, 2, 3;


-- =====================================================================
-- 7. LOW-STOCK SEMANTICS (WS-D-8)
-- =====================================================================
-- minimum_stock = 0 means NO low-stock warning for that item.
-- Low means quantity_on_hand <= minimum_stock AND minimum_stock > 0.
-- 7a. How many variants actually opt in to alerting.
SELECT count(*) FILTER (WHERE minimum_stock > 0)  AS alerting_enabled,
       count(*) FILTER (WHERE minimum_stock = 0)  AS alerting_disabled,
       count(*)                                   AS total_variants
FROM catalog.product_variants;

-- 7b. The low-stock set under the agreed predicate.
SELECT v.id AS variant_id, v.sku, sp.quantity_on_hand, v.minimum_stock
FROM catalog.product_variants v
JOIN inventory.stock_positions sp ON sp.variant_id = v.id
WHERE v.minimum_stock > 0
  AND sp.quantity_on_hand <= v.minimum_stock
ORDER BY sp.quantity_on_hand;


-- =====================================================================
-- 8. REFERENCE-DATA LIFECYCLE
-- =====================================================================
-- Deletion must be blocked while a reference type is still in use.
-- These counts are what the delete_* functions guard against.
SELECT 'category' AS entity, c.id, c.name, count(p.id) AS usage_count
FROM catalog.categories c
LEFT JOIN catalog.products p ON p.category_id = c.id
GROUP BY c.id, c.name
ORDER BY usage_count DESC, c.name;


-- =====================================================================
-- 9. SEARCH ESCAPING REGRESSION
-- =====================================================================
-- A product named with a LIKE metacharacter must be findable by its
-- literal name and must not act as a wildcard. Substitute a real session
-- token and warehouse id. Expected: exactly one row, the '50%' product.
--
-- SELECT product_id, product_name, display_identifier, identifier_type
-- FROM catalog.list_products_v2(
--        p_session_token    => '<token>',
--        p_warehouse_id     => <id>,
--        p_search           => '50%',
--        p_category_id      => NULL,
--        p_brand_id         => NULL,
--        p_include_inactive => false,
--        p_limit            => 100,
--        p_offset           => 0);
--
-- Note the named-argument form above. From Rust, do NOT call positionally
-- and do NOT rely on parameter DEFAULTs -- pass every argument with an
-- explicit cast. See SKILL.md sections 2.2 and 2.3.
