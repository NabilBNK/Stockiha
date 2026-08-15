-- Preserve owner/admin inserts that predate product-owned units.
-- Runtime callers still use the canonical five-argument creation API; this
-- default only supplies UNIT when trusted SQL omits the column entirely.
SET ROLE stockiha_owner;

CREATE OR REPLACE FUNCTION catalog._default_product_unit_id()
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
    SELECT u.id
      FROM catalog.units u
     WHERE u.normalized_code = 'UNIT'
     LIMIT 1
$$;

REVOKE ALL ON FUNCTION catalog._default_product_unit_id() FROM PUBLIC;

ALTER TABLE catalog.products
    ALTER COLUMN unit_id
    SET DEFAULT catalog._default_product_unit_id();

RESET ROLE;
