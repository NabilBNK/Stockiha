-- WS-D-001: catalogue foundation for Product & Inventory Core.
--
-- Adds categories (new, user-created reference data mirroring
-- catalog.attributes' normalized_name pattern), activates catalog.brands as
-- a real product-level field, adds variant-level minimum_stock, adds
-- is_active to attributes/attribute_values/units so all five reference-data
-- types support deactivate/reactivate uniformly, provides full CRUD +
-- usage_count reference-data functions for a future Catalogue Setup screen,
-- a one-call quick_create_product for the ~90% of products with no
-- variants, and catalog.list_products_v2 -- a paginated, filterable,
-- multi-field-search product list fit for a 5000-product store.
--
-- catalog.list_products (Slice-1-era, 8 columns) is left completely
-- untouched: it is called directly from Rust (src/application/catalog.rs)
-- and from the S2-001 regression suite, and updating every caller is
-- explicitly WS-D-2 (Rust/DTO layer), not this sub-plan. Likewise every
-- extended write path (update_product, update_variant) is added as a new
-- overload alongside the existing signatures rather than replacing them, so
-- no already-compiled Rust caller breaks.
--
-- Category and brand are PRODUCT-level fields, never variant-level, and
-- never participate in attribute_signature or the effective variant name --
-- see catalog._effective_variant_name and catalog.compute_attribute_signature,
-- both untouched by this migration.

SET ROLE stockiha_owner;

-- =============================================================================
-- 0. pg_trgm -- trusted extension, installable by stockiha_owner without
--    superuser. Backs the substring ILIKE searches in list_products_v2.
-- =============================================================================
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- =============================================================================
-- 2.1 Categories
-- =============================================================================
CREATE TABLE catalog.categories (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name            text NOT NULL,
    normalized_name text NOT NULL,
    is_active       boolean NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT categories_name_not_blank CHECK (btrim(name) <> ''),
    CONSTRAINT categories_normalized_name_not_blank CHECK (normalized_name <> ''),
    CONSTRAINT categories_normalized_name_unique UNIQUE (normalized_name)
);

CREATE TRIGGER categories_set_updated_at
    BEFORE UPDATE ON catalog.categories
    FOR EACH ROW
    EXECUTE FUNCTION core.set_updated_at();

REVOKE ALL ON catalog.categories FROM PUBLIC;
GRANT SELECT ON catalog.categories TO stockiha_runtime;

ALTER TABLE catalog.products
    ADD COLUMN category_id bigint REFERENCES catalog.categories (id);

CREATE INDEX idx_products_category_id ON catalog.products (category_id);

-- =============================================================================
-- 2.2 Minimum stock (variant-level: stock positions are per variant)
-- =============================================================================
ALTER TABLE catalog.product_variants
    ADD COLUMN minimum_stock numeric NOT NULL DEFAULT 0;

ALTER TABLE catalog.product_variants
    ADD CONSTRAINT product_variants_minimum_stock_non_negative CHECK (minimum_stock >= 0);

COMMENT ON COLUMN catalog.product_variants.minimum_stock IS
    'Low-stock warning threshold for this variant''s stock position. '
    '0 means "no low-stock warning for this item" -- WS-D-8 inventory '
    'analytics relies on this meaning; it is not merely a default.';

-- =============================================================================
-- Reference-data groundwork: brands and units gain the same normalized/
-- active-flag shape as categories/attributes so all five entity types in
-- 2.3 behave uniformly.
-- =============================================================================

-- brands: add case-insensitive uniqueness (mirrors catalog.units'
-- normalized_code), backfilled from the existing case-sensitive UNIQUE(code).
ALTER TABLE catalog.brands ADD COLUMN normalized_code text;
UPDATE catalog.brands SET normalized_code = upper(btrim(code));
ALTER TABLE catalog.brands ALTER COLUMN normalized_code SET NOT NULL;
ALTER TABLE catalog.brands
    ADD CONSTRAINT brands_normalized_code_not_blank CHECK (normalized_code <> '');
ALTER TABLE catalog.brands
    ADD CONSTRAINT brands_normalized_code_unique UNIQUE (normalized_code);

-- attributes / attribute_values / units: none of these currently carry an
-- active flag. All five reference-data types must support deactivate/
-- reactivate per 2.3, so add it uniformly.
ALTER TABLE catalog.attributes ADD COLUMN is_active boolean NOT NULL DEFAULT true;
ALTER TABLE catalog.attribute_values ADD COLUMN is_active boolean NOT NULL DEFAULT true;
ALTER TABLE catalog.units ADD COLUMN is_active boolean NOT NULL DEFAULT true;

-- =============================================================================
-- Shared private helper: stock/transaction history guard, factored out of
-- catalog.update_product (3-arg) so the new category/brand-aware overload
-- (2.6) does not duplicate the four-way EXISTS check. Same logic, same
-- result -- pure internal refactor, no external signature changes.
-- =============================================================================
CREATE OR REPLACE FUNCTION catalog._product_has_stock_history(p_product_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
    SELECT EXISTS (
        SELECT 1 FROM inventory.positions pos
        JOIN catalog.product_variants pv ON pv.id = pos.variant_id
        WHERE pv.product_id = p_product_id AND (pos.quantity_on_hand <> 0 OR pos.total_value <> 0)
    ) OR EXISTS (
        SELECT 1 FROM inventory.movements m
        JOIN catalog.product_variants pv ON pv.id = m.variant_id
        WHERE pv.product_id = p_product_id
    ) OR EXISTS (
        SELECT 1 FROM sales.cash_sale_lines sl
        JOIN catalog.product_variants pv ON pv.id = sl.variant_id
        WHERE pv.product_id = p_product_id
    ) OR EXISTS (
        SELECT 1 FROM procurement.purchase_receipt_lines prl
        JOIN catalog.product_variants pv ON pv.id = prl.variant_id
        WHERE pv.product_id = p_product_id
    );
$$;

REVOKE ALL ON FUNCTION catalog._product_has_stock_history(bigint) FROM PUBLIC;

-- Internal refactor only: same signature, same behaviour, now delegates to
-- the shared helper above instead of inlining the four-way EXISTS check.
CREATE OR REPLACE FUNCTION catalog.update_product(p_session_token text, p_product_id bigint, p_name text, p_unit_id bigint, p_is_active boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
    v_curr_unit bigint;
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_CATALOG');
    SELECT unit_id INTO v_curr_unit FROM catalog.products WHERE id = p_product_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'product % not found', p_product_id USING ERRCODE = '22023';
    END IF;
    IF btrim(coalesce(p_name, '')) = '' THEN
        RAISE EXCEPTION 'product name must not be blank' USING ERRCODE = '22023';
    END IF;
    PERFORM 1 FROM catalog.units WHERE id = p_unit_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'unit % not found', p_unit_id USING ERRCODE = '22023';
    END IF;

    IF p_unit_id <> v_curr_unit AND catalog._product_has_stock_history(p_product_id) THEN
        RAISE EXCEPTION 'This product''s unit cannot be changed because stock transactions already exist.'
            USING ERRCODE = '55000';
    END IF;

    UPDATE catalog.products SET name = btrim(p_name), unit_id = p_unit_id, is_active = p_is_active WHERE id = p_product_id;
    UPDATE catalog.product_variants SET base_unit_id = p_unit_id WHERE product_id = p_product_id;

    IF NOT p_is_active THEN
        UPDATE catalog.product_variants SET is_active = false WHERE product_id = p_product_id AND is_active;
    END IF;
END;
$function$;

-- =============================================================================
-- 2.3 Reference-data management functions
-- =============================================================================

-- ---------------------------------------------------------------- categories
CREATE FUNCTION catalog.list_categories(p_session_token text)
RETURNS TABLE(id bigint, name text, is_active boolean, usage_count bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    PERFORM 1 FROM iam.resolve_session(p_session_token);
    RETURN QUERY
        SELECT c.id, c.name, c.is_active,
               (SELECT count(*) FROM catalog.products p WHERE p.category_id = c.id)
        FROM catalog.categories c
        ORDER BY c.name;
END;
$$;

CREATE FUNCTION catalog.create_category(p_session_token text, p_name text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_id bigint;
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_CATALOG');
    IF btrim(coalesce(p_name, '')) = '' THEN
        RAISE EXCEPTION 'category name must not be blank' USING ERRCODE = '22023';
    END IF;
    INSERT INTO catalog.categories (name, normalized_name)
        VALUES (btrim(p_name), lower(btrim(p_name)))
        ON CONFLICT (normalized_name) DO NOTHING;
    SELECT id INTO v_id FROM catalog.categories WHERE normalized_name = lower(btrim(p_name));
    RETURN v_id;
END;
$$;

CREATE FUNCTION catalog.rename_category(p_session_token text, p_category_id bigint, p_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_CATALOG');
    PERFORM 1 FROM catalog.categories WHERE id = p_category_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'category % not found', p_category_id USING ERRCODE = '22023';
    END IF;
    IF btrim(coalesce(p_name, '')) = '' THEN
        RAISE EXCEPTION 'category name must not be blank' USING ERRCODE = '22023';
    END IF;
    BEGIN
        UPDATE catalog.categories
            SET name = btrim(p_name), normalized_name = lower(btrim(p_name))
            WHERE id = p_category_id;
    EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION 'a category named % already exists', p_name USING ERRCODE = '22023';
    END;
END;
$$;

CREATE FUNCTION catalog.set_category_active(p_session_token text, p_category_id bigint, p_is_active boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_CATALOG');
    UPDATE catalog.categories SET is_active = p_is_active WHERE id = p_category_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'category % not found', p_category_id USING ERRCODE = '22023';
    END IF;
END;
$$;

CREATE FUNCTION catalog.delete_category(p_session_token text, p_category_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_usage bigint;
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_CATALOG');
    PERFORM 1 FROM catalog.categories WHERE id = p_category_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'category % not found', p_category_id USING ERRCODE = '22023';
    END IF;
    SELECT count(*) INTO v_usage FROM catalog.products WHERE category_id = p_category_id;
    IF v_usage > 0 THEN
        RAISE EXCEPTION 'category % is used by % product(s) and cannot be deleted', p_category_id, v_usage
            USING ERRCODE = '55000';
    END IF;
    DELETE FROM catalog.categories WHERE id = p_category_id;
END;
$$;

-- -------------------------------------------------------------------- brands
CREATE FUNCTION catalog.list_brands(p_session_token text)
RETURNS TABLE(id bigint, code text, name text, is_active boolean, usage_count bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    PERFORM 1 FROM iam.resolve_session(p_session_token);
    RETURN QUERY
        SELECT b.id, b.code, b.name, b.is_active,
               (SELECT count(*) FROM catalog.products p WHERE p.brand_id = b.id)
        FROM catalog.brands b
        ORDER BY b.name;
END;
$$;

CREATE FUNCTION catalog.create_brand(p_session_token text, p_code text, p_name text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_id bigint;
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_CATALOG');
    IF btrim(coalesce(p_code, '')) = '' OR btrim(coalesce(p_name, '')) = '' THEN
        RAISE EXCEPTION 'brand code and name must not be blank' USING ERRCODE = '22023';
    END IF;
    INSERT INTO catalog.brands (code, normalized_code, name)
        VALUES (btrim(p_code), upper(btrim(p_code)), btrim(p_name))
        ON CONFLICT (normalized_code) DO NOTHING;
    SELECT id INTO v_id FROM catalog.brands WHERE normalized_code = upper(btrim(p_code));
    RETURN v_id;
END;
$$;

CREATE FUNCTION catalog.rename_brand(p_session_token text, p_brand_id bigint, p_code text, p_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_CATALOG');
    PERFORM 1 FROM catalog.brands WHERE id = p_brand_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'brand % not found', p_brand_id USING ERRCODE = '22023';
    END IF;
    IF btrim(coalesce(p_code, '')) = '' OR btrim(coalesce(p_name, '')) = '' THEN
        RAISE EXCEPTION 'brand code and name must not be blank' USING ERRCODE = '22023';
    END IF;
    BEGIN
        UPDATE catalog.brands
            SET code = btrim(p_code), normalized_code = upper(btrim(p_code)), name = btrim(p_name)
            WHERE id = p_brand_id;
    EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION 'a brand with code % already exists', p_code USING ERRCODE = '22023';
    END;
END;
$$;

CREATE FUNCTION catalog.set_brand_active(p_session_token text, p_brand_id bigint, p_is_active boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_CATALOG');
    UPDATE catalog.brands SET is_active = p_is_active WHERE id = p_brand_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'brand % not found', p_brand_id USING ERRCODE = '22023';
    END IF;
END;
$$;

CREATE FUNCTION catalog.delete_brand(p_session_token text, p_brand_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_usage bigint;
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_CATALOG');
    PERFORM 1 FROM catalog.brands WHERE id = p_brand_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'brand % not found', p_brand_id USING ERRCODE = '22023';
    END IF;
    SELECT count(*) INTO v_usage FROM catalog.products WHERE brand_id = p_brand_id;
    IF v_usage > 0 THEN
        RAISE EXCEPTION 'brand % is used by % product(s) and cannot be deleted', p_brand_id, v_usage
            USING ERRCODE = '55000';
    END IF;
    DELETE FROM catalog.brands WHERE id = p_brand_id;
END;
$$;

-- --------------------------------------------------------------- attributes
-- catalog.create_attribute and catalog.add_attribute_value already exist
-- and are reused unmodified. Only rename/deactivate/delete/list are new.
CREATE FUNCTION catalog.list_attributes_v2(p_session_token text)
RETURNS TABLE(id bigint, name text, is_active boolean, usage_count bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    PERFORM 1 FROM iam.resolve_session(p_session_token);
    RETURN QUERY
        SELECT a.id, a.name, a.is_active,
               (SELECT count(*) FROM catalog.attribute_values av WHERE av.attribute_id = a.id)
        FROM catalog.attributes a
        ORDER BY a.name;
END;
$$;

CREATE FUNCTION catalog.rename_attribute(p_session_token text, p_attribute_id bigint, p_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_CATALOG');
    PERFORM 1 FROM catalog.attributes WHERE id = p_attribute_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'attribute % not found', p_attribute_id USING ERRCODE = '22023';
    END IF;
    IF btrim(coalesce(p_name, '')) = '' THEN
        RAISE EXCEPTION 'attribute name must not be blank' USING ERRCODE = '22023';
    END IF;
    BEGIN
        UPDATE catalog.attributes
            SET name = btrim(p_name), normalized_name = lower(btrim(p_name))
            WHERE id = p_attribute_id;
    EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION 'an attribute named % already exists', p_name USING ERRCODE = '22023';
    END;
END;
$$;

CREATE FUNCTION catalog.set_attribute_active(p_session_token text, p_attribute_id bigint, p_is_active boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_CATALOG');
    UPDATE catalog.attributes SET is_active = p_is_active WHERE id = p_attribute_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'attribute % not found', p_attribute_id USING ERRCODE = '22023';
    END IF;
END;
$$;

-- usage_count = count of catalog.attribute_values rows under this attribute.
-- Deliberately NOT just "variants using this attribute": attribute_values
-- has a NO-ACTION FK to attributes, so an attribute with any values --
-- even values no variant currently selects -- cannot be deleted either way.
-- Counting attribute_values directly makes usage_count = 0 a true guarantee
-- that delete_attribute will succeed (the promise the UI relies on), and it
-- transitively covers variant usage since a variant can only ever reference
-- an attribute via one of its attribute_values rows.
CREATE FUNCTION catalog.delete_attribute(p_session_token text, p_attribute_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_usage bigint;
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_CATALOG');
    PERFORM 1 FROM catalog.attributes WHERE id = p_attribute_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'attribute % not found', p_attribute_id USING ERRCODE = '22023';
    END IF;
    SELECT count(*) INTO v_usage FROM catalog.attribute_values WHERE attribute_id = p_attribute_id;
    IF v_usage > 0 THEN
        RAISE EXCEPTION 'attribute % has % value(s) and cannot be deleted', p_attribute_id, v_usage
            USING ERRCODE = '55000';
    END IF;
    DELETE FROM catalog.attributes WHERE id = p_attribute_id;
END;
$$;

-- --------------------------------------------------------- attribute values
CREATE FUNCTION catalog.list_attribute_values(p_session_token text)
RETURNS TABLE(id bigint, attribute_id bigint, attribute_name text, value text, is_active boolean, usage_count bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    PERFORM 1 FROM iam.resolve_session(p_session_token);
    RETURN QUERY
        SELECT av.id, av.attribute_id, a.name, av.value, av.is_active,
               (SELECT count(*) FROM catalog.variant_attribute_values vav WHERE vav.attribute_value_id = av.id)
        FROM catalog.attribute_values av
        JOIN catalog.attributes a ON a.id = av.attribute_id
        ORDER BY a.name, av.value;
END;
$$;

CREATE FUNCTION catalog.rename_attribute_value(p_session_token text, p_attribute_value_id bigint, p_value text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_attribute_id bigint;
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_CATALOG');
    SELECT attribute_id INTO v_attribute_id FROM catalog.attribute_values WHERE id = p_attribute_value_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'attribute value % not found', p_attribute_value_id USING ERRCODE = '22023';
    END IF;
    IF btrim(coalesce(p_value, '')) = '' THEN
        RAISE EXCEPTION 'attribute value must not be blank' USING ERRCODE = '22023';
    END IF;
    BEGIN
        UPDATE catalog.attribute_values
            SET value = btrim(p_value), normalized_value = lower(btrim(p_value))
            WHERE id = p_attribute_value_id;
    EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION 'attribute % already has a value %', v_attribute_id, p_value USING ERRCODE = '22023';
    END;
END;
$$;

CREATE FUNCTION catalog.set_attribute_value_active(p_session_token text, p_attribute_value_id bigint, p_is_active boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_CATALOG');
    UPDATE catalog.attribute_values SET is_active = p_is_active WHERE id = p_attribute_value_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'attribute value % not found', p_attribute_value_id USING ERRCODE = '22023';
    END IF;
END;
$$;

CREATE FUNCTION catalog.delete_attribute_value(p_session_token text, p_attribute_value_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_usage bigint;
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_CATALOG');
    PERFORM 1 FROM catalog.attribute_values WHERE id = p_attribute_value_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'attribute value % not found', p_attribute_value_id USING ERRCODE = '22023';
    END IF;
    SELECT count(*) INTO v_usage FROM catalog.variant_attribute_values WHERE attribute_value_id = p_attribute_value_id;
    IF v_usage > 0 THEN
        RAISE EXCEPTION 'attribute value % is used by % variant(s) and cannot be deleted', p_attribute_value_id, v_usage
            USING ERRCODE = '55000';
    END IF;
    DELETE FROM catalog.attribute_values WHERE id = p_attribute_value_id;
END;
$$;

-- -------------------------------------------------------------------- units
-- catalog.create_unit already exists and is reused unmodified.
-- usage_count = product.unit_id + variant.base_unit_id + alternate-unit
-- conversion rows, per the brief: unit changes affect stock quantity maths.
CREATE FUNCTION catalog.list_units_v2(p_session_token text)
RETURNS TABLE(id bigint, code text, name text, is_active boolean, usage_count bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    PERFORM 1 FROM iam.resolve_session(p_session_token);
    RETURN QUERY
        SELECT u.id, u.code, u.name, u.is_active,
               (SELECT count(*) FROM catalog.products p WHERE p.unit_id = u.id)
             + (SELECT count(*) FROM catalog.product_variants pv WHERE pv.base_unit_id = u.id)
             + (SELECT count(*) FROM catalog.variant_units vu WHERE vu.unit_id = u.id)
        FROM catalog.units u
        ORDER BY u.code;
END;
$$;

CREATE FUNCTION catalog.rename_unit(p_session_token text, p_unit_id bigint, p_code text, p_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_CATALOG');
    PERFORM 1 FROM catalog.units WHERE id = p_unit_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'unit % not found', p_unit_id USING ERRCODE = '22023';
    END IF;
    IF btrim(coalesce(p_code, '')) = '' OR btrim(coalesce(p_name, '')) = '' THEN
        RAISE EXCEPTION 'unit code and name must not be blank' USING ERRCODE = '22023';
    END IF;
    BEGIN
        UPDATE catalog.units
            SET code = btrim(p_code), normalized_code = upper(btrim(p_code)), name = btrim(p_name)
            WHERE id = p_unit_id;
    EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION 'a unit with code % already exists', p_code USING ERRCODE = '22023';
    END;
END;
$$;

CREATE FUNCTION catalog.set_unit_active(p_session_token text, p_unit_id bigint, p_is_active boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_CATALOG');
    UPDATE catalog.units SET is_active = p_is_active WHERE id = p_unit_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'unit % not found', p_unit_id USING ERRCODE = '22023';
    END IF;
END;
$$;

CREATE FUNCTION catalog.delete_unit(p_session_token text, p_unit_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_usage bigint;
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_CATALOG');
    PERFORM 1 FROM catalog.units WHERE id = p_unit_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'unit % not found', p_unit_id USING ERRCODE = '22023';
    END IF;
    SELECT (SELECT count(*) FROM catalog.products p WHERE p.unit_id = p_unit_id)
         + (SELECT count(*) FROM catalog.product_variants pv WHERE pv.base_unit_id = p_unit_id)
         + (SELECT count(*) FROM catalog.variant_units vu WHERE vu.unit_id = p_unit_id)
        INTO v_usage;
    IF v_usage > 0 THEN
        RAISE EXCEPTION 'unit % is in use by % product/variant/conversion row(s) and cannot be deleted', p_unit_id, v_usage
            USING ERRCODE = '55000';
    END IF;
    DELETE FROM catalog.units WHERE id = p_unit_id;
END;
$$;

-- =============================================================================
-- 2.4 Quick product creation
-- =============================================================================
CREATE FUNCTION catalog.quick_create_product(
    p_session_token text,
    p_name text,
    p_unit_id bigint,
    p_sale_price numeric,
    p_category_id bigint DEFAULT NULL,
    p_brand_id bigint DEFAULT NULL,
    p_barcode text DEFAULT NULL,
    p_minimum_stock numeric DEFAULT 0,
    p_is_active boolean DEFAULT true
)
RETURNS TABLE(product_id bigint, variant_id bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_product_id bigint;
    v_variant_id bigint;
    v_sku        text;
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_CATALOG');

    IF btrim(coalesce(p_name, '')) = '' THEN
        RAISE EXCEPTION 'product name must not be blank' USING ERRCODE = '22023';
    END IF;
    PERFORM 1 FROM catalog.units WHERE id = p_unit_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'unit % not found', p_unit_id USING ERRCODE = '22023';
    END IF;
    IF p_sale_price IS NULL OR p_sale_price < 0 THEN
        RAISE EXCEPTION 'sale price must not be negative' USING ERRCODE = '22023';
    END IF;
    IF coalesce(p_minimum_stock, 0) < 0 THEN
        RAISE EXCEPTION 'minimum stock must not be negative' USING ERRCODE = '22023';
    END IF;
    IF p_category_id IS NOT NULL THEN
        PERFORM 1 FROM catalog.categories WHERE id = p_category_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'category % not found', p_category_id USING ERRCODE = '22023';
        END IF;
    END IF;
    IF p_brand_id IS NOT NULL THEN
        PERFORM 1 FROM catalog.brands WHERE id = p_brand_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'brand % not found', p_brand_id USING ERRCODE = '22023';
        END IF;
    END IF;

    -- Fail fast on a duplicate barcode before creating anything. Not
    -- strictly required for correctness -- an unhandled exception from
    -- catalog._insert_barcode below would abort this whole function call
    -- and roll back the product/variant inserts too, since there is no
    -- exception block here to catch it -- but this avoids the wasted work
    -- and gives the clearest possible error.
    IF p_barcode IS NOT NULL AND btrim(p_barcode) <> '' THEN
        PERFORM 1 FROM catalog.variant_barcodes WHERE normalized_barcode = upper(btrim(p_barcode));
        IF FOUND THEN
            RAISE EXCEPTION 'barcode % is already registered in the system', p_barcode USING ERRCODE = '22023';
        END IF;
    END IF;

    INSERT INTO catalog.products (name, unit_id, category_id, brand_id, is_active)
        VALUES (btrim(p_name), p_unit_id, p_category_id, p_brand_id, coalesce(p_is_active, true))
        RETURNING id INTO v_product_id;

    v_sku := catalog._generate_sku();
    INSERT INTO catalog.product_variants (
        product_id, sku, sale_price, base_unit_id, attribute_signature, is_active, minimum_stock
    ) VALUES (
        v_product_id, v_sku, p_sale_price, p_unit_id, '', coalesce(p_is_active, true), coalesce(p_minimum_stock, 0)
    ) RETURNING id INTO v_variant_id;

    IF p_barcode IS NOT NULL AND btrim(p_barcode) <> '' THEN
        PERFORM catalog._insert_barcode(v_variant_id, p_barcode, true);
    END IF;

    RETURN QUERY SELECT v_product_id, v_variant_id;
END;
$$;

-- =============================================================================
-- 2.5 Product list read path -- v2
-- =============================================================================
-- Design choice: catalog.list_products (8-column, Slice-1 shape) is kept
-- byte-for-byte untouched. It is queried directly from Rust
-- (src/application/catalog.rs) and asserted against by the S2-001
-- regression suite; changing its signature without updating every caller
-- is out of scope for this SQL-only sub-plan (that is WS-D-2). This new
-- function is additive.
--
-- Search strategy: rather than building one per-row concatenated haystack
-- (which cannot use an index, since it is a scalar subquery evaluated once
-- per candidate row), matching candidate variant_ids are found via a UNION
-- of single-purpose branches -- one per searchable field -- each able to
-- use its own trigram GIN index independently. UNION's implicit DISTINCT
-- also guarantees one row per variant even when a term matches more than
-- one field (e.g. barcode AND attribute value) on the same item.
--
-- Pagination strategy: the per-variant `attributes` jsonb aggregate is
-- deliberately computed only for the final <=100-row page (in the `paged`
-- CTE), not for the whole matching set. Measured at 5000 products / 17500
-- variants: computing it for every row before LIMIT/OFFSET (the naive
-- approach) cost ~1.1s on an unfiltered deep page, almost entirely inside
-- that one correlated subquery; deferring it past LIMIT/OFFSET cuts that
-- to page-size cost. Everything ORDER BY depends on (product_name,
-- variant_name via catalog._effective_variant_name) must still be computed
-- before pagination -- see report for full EXPLAIN ANALYZE evidence.
CREATE FUNCTION catalog.list_products_v2(
    p_session_token text,
    p_warehouse_id bigint,
    p_search text DEFAULT NULL,
    p_category_id bigint DEFAULT NULL,
    p_brand_id bigint DEFAULT NULL,
    p_include_inactive boolean DEFAULT false,
    p_limit integer DEFAULT 100,
    p_offset integer DEFAULT 0
)
RETURNS TABLE(
    product_id bigint,
    variant_id bigint,
    sku text,
    product_name text,
    variant_name text,
    primary_barcode text,
    display_identifier text,
    identifier_type text,
    sale_price numeric,
    minimum_stock numeric,
    is_active boolean,
    product_is_active boolean,
    category_id bigint,
    category_name text,
    brand_id bigint,
    brand_name text,
    quantity_on_hand numeric,
    last_known_wac numeric,
    attributes jsonb,
    total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_limit  integer;
    v_offset integer;
    v_search text;
BEGIN
    PERFORM 1 FROM iam.resolve_session(p_session_token);

    -- Server-side pagination cap: never trust the client's limit.
    v_limit  := LEAST(GREATEST(coalesce(p_limit, 100), 1), 100);
    v_offset := GREATEST(coalesce(p_offset, 0), 0);
    v_search := NULLIF(btrim(coalesce(p_search, '')), '');

    RETURN QUERY
    WITH matched_variants AS (
        SELECT v.id AS variant_id
        FROM catalog.product_variants v
        WHERE v_search IS NOT NULL AND v.sku ILIKE '%' || v_search || '%'
        UNION
        SELECT v.id
        FROM catalog.product_variants v
        WHERE v_search IS NOT NULL AND coalesce(v.name_override, '') ILIKE '%' || v_search || '%'
        UNION
        SELECT v.id
        FROM catalog.product_variants v
        JOIN catalog.products p ON p.id = v.product_id
        WHERE v_search IS NOT NULL AND p.name ILIKE '%' || v_search || '%'
        UNION
        SELECT b.variant_id
        FROM catalog.variant_barcodes b
        WHERE v_search IS NOT NULL AND b.barcode ILIKE '%' || v_search || '%'
        UNION
        SELECT vav.variant_id
        FROM catalog.variant_attribute_values vav
        JOIN catalog.attribute_values av ON av.id = vav.attribute_value_id
        WHERE v_search IS NOT NULL AND av.value ILIKE '%' || v_search || '%'
    ),
    base AS (
        SELECT
            p.id AS product_id,
            v.id AS variant_id,
            v.sku,
            p.name AS product_name,
            catalog._effective_variant_name(v.id) AS variant_name,
            bp.barcode AS primary_barcode,
            coalesce(bp.barcode, v.sku) AS display_identifier,
            CASE WHEN bp.barcode IS NOT NULL THEN 'BARCODE' ELSE 'SKU' END AS identifier_type,
            v.sale_price,
            v.minimum_stock,
            v.is_active,
            p.is_active AS product_is_active,
            p.category_id,
            cat.name AS category_name,
            p.brand_id,
            br.name AS brand_name,
            coalesce(pos.quantity_on_hand, 0)::numeric AS quantity_on_hand,
            coalesce(pos.last_known_wac, 0)::numeric AS last_known_wac
        FROM catalog.product_variants v
        JOIN catalog.products p ON p.id = v.product_id
        LEFT JOIN catalog.categories cat ON cat.id = p.category_id
        LEFT JOIN catalog.brands br ON br.id = p.brand_id
        LEFT JOIN catalog.variant_barcodes bp ON bp.variant_id = v.id AND bp.is_primary = true
        LEFT JOIN inventory.positions pos ON pos.variant_id = v.id AND pos.warehouse_id = p_warehouse_id
        WHERE (p_include_inactive OR (v.is_active AND p.is_active))
          AND (p_category_id IS NULL OR p.category_id = p_category_id)
          AND (p_brand_id IS NULL OR p.brand_id = p_brand_id)
          AND (v_search IS NULL OR v.id IN (SELECT mv.variant_id FROM matched_variants mv))
    ),
    counted AS (
        SELECT b.*, count(*) OVER () AS total_count FROM base b
    ),
    paged AS (
        SELECT * FROM counted
        ORDER BY product_name, variant_name, variant_id
        LIMIT v_limit OFFSET v_offset
    )
    SELECT
        pg.product_id, pg.variant_id, pg.sku, pg.product_name, pg.variant_name,
        pg.primary_barcode, pg.display_identifier, pg.identifier_type,
        pg.sale_price, pg.minimum_stock, pg.is_active, pg.product_is_active,
        pg.category_id, pg.category_name, pg.brand_id, pg.brand_name,
        pg.quantity_on_hand, pg.last_known_wac,
        coalesce((
            SELECT jsonb_agg(jsonb_build_object('name', a.name, 'value', av.value) ORDER BY a.id, av.id)
            FROM catalog.variant_attribute_values vav
            JOIN catalog.attribute_values av ON av.id = vav.attribute_value_id
            JOIN catalog.attributes a ON a.id = av.attribute_id
            WHERE vav.variant_id = pg.variant_id
        ), '[]'::jsonb) AS attributes,
        pg.total_count
    FROM paged pg
    ORDER BY pg.product_name, pg.variant_name, pg.variant_id;
END;
$$;

-- =============================================================================
-- 2.6 Extend write functions -- category_id/brand_id on products,
--     minimum_stock on variants. New overloads only; existing signatures
--     used by Rust today are untouched.
-- =============================================================================
CREATE FUNCTION catalog.update_product(
    p_session_token text,
    p_product_id bigint,
    p_name text,
    p_unit_id bigint,
    p_is_active boolean,
    p_category_id bigint,
    p_brand_id bigint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_curr_unit bigint;
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_CATALOG');
    SELECT unit_id INTO v_curr_unit FROM catalog.products WHERE id = p_product_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'product % not found', p_product_id USING ERRCODE = '22023';
    END IF;
    IF btrim(coalesce(p_name, '')) = '' THEN
        RAISE EXCEPTION 'product name must not be blank' USING ERRCODE = '22023';
    END IF;
    PERFORM 1 FROM catalog.units WHERE id = p_unit_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'unit % not found', p_unit_id USING ERRCODE = '22023';
    END IF;
    IF p_category_id IS NOT NULL THEN
        PERFORM 1 FROM catalog.categories WHERE id = p_category_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'category % not found', p_category_id USING ERRCODE = '22023';
        END IF;
    END IF;
    IF p_brand_id IS NOT NULL THEN
        PERFORM 1 FROM catalog.brands WHERE id = p_brand_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'brand % not found', p_brand_id USING ERRCODE = '22023';
        END IF;
    END IF;

    IF p_unit_id <> v_curr_unit AND catalog._product_has_stock_history(p_product_id) THEN
        RAISE EXCEPTION 'This product''s unit cannot be changed because stock transactions already exist.'
            USING ERRCODE = '55000';
    END IF;

    UPDATE catalog.products
        SET name = btrim(p_name), unit_id = p_unit_id, is_active = p_is_active,
            category_id = p_category_id, brand_id = p_brand_id
        WHERE id = p_product_id;
    UPDATE catalog.product_variants SET base_unit_id = p_unit_id WHERE product_id = p_product_id;

    IF NOT p_is_active THEN
        UPDATE catalog.product_variants SET is_active = false WHERE product_id = p_product_id AND is_active;
    END IF;
END;
$$;

CREATE FUNCTION catalog.update_variant(
    p_session_token text,
    p_variant_id bigint,
    p_name_override text,
    p_sale_price numeric,
    p_is_active boolean,
    p_minimum_stock numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_product_id bigint;
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_CATALOG');
    SELECT product_id INTO v_product_id FROM catalog.product_variants WHERE id = p_variant_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'variant % not found', p_variant_id USING ERRCODE = '22023';
    END IF;
    IF p_sale_price < 0 THEN
        RAISE EXCEPTION 'sale price must not be negative' USING ERRCODE = '22023';
    END IF;
    IF coalesce(p_minimum_stock, 0) < 0 THEN
        RAISE EXCEPTION 'minimum stock must not be negative' USING ERRCODE = '22023';
    END IF;
    IF p_is_active THEN
        PERFORM 1 FROM catalog.products WHERE id = v_product_id AND is_active;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'cannot activate a variant of an inactive product' USING ERRCODE = '55000';
        END IF;
    END IF;

    UPDATE catalog.product_variants
        SET name_override = NULLIF(btrim(p_name_override), ''),
            sale_price = p_sale_price,
            is_active = p_is_active,
            minimum_stock = coalesce(p_minimum_stock, 0)
        WHERE id = p_variant_id;
END;
$$;

-- =============================================================================
-- Indexes -- support list_products_v2's search branches and filters at
-- 5000-product / 3-4-variant-per-product scale. See report for EXPLAIN
-- ANALYZE evidence.
-- =============================================================================
CREATE INDEX idx_products_name_trgm ON catalog.products USING gin (name gin_trgm_ops);
CREATE INDEX idx_product_variants_sku_trgm ON catalog.product_variants USING gin (sku gin_trgm_ops);
CREATE INDEX idx_product_variants_name_override_trgm
    ON catalog.product_variants USING gin (name_override gin_trgm_ops)
    WHERE name_override IS NOT NULL;
CREATE INDEX idx_variant_barcodes_barcode_trgm ON catalog.variant_barcodes USING gin (barcode gin_trgm_ops);
CREATE INDEX idx_attribute_values_value_trgm ON catalog.attribute_values USING gin (value gin_trgm_ops);
CREATE INDEX idx_variant_attribute_values_attribute_value_id
    ON catalog.variant_attribute_values (attribute_value_id);
CREATE INDEX idx_product_variants_product_id ON catalog.product_variants (product_id);

-- =============================================================================
-- Grants -- nothing to PUBLIC, EXECUTE to stockiha_runtime only.
-- =============================================================================
REVOKE ALL ON FUNCTION catalog.list_categories(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION catalog.create_category(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION catalog.rename_category(text, bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION catalog.set_category_active(text, bigint, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION catalog.delete_category(text, bigint) FROM PUBLIC;

REVOKE ALL ON FUNCTION catalog.list_brands(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION catalog.create_brand(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION catalog.rename_brand(text, bigint, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION catalog.set_brand_active(text, bigint, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION catalog.delete_brand(text, bigint) FROM PUBLIC;

REVOKE ALL ON FUNCTION catalog.list_attributes_v2(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION catalog.rename_attribute(text, bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION catalog.set_attribute_active(text, bigint, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION catalog.delete_attribute(text, bigint) FROM PUBLIC;

REVOKE ALL ON FUNCTION catalog.list_attribute_values(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION catalog.rename_attribute_value(text, bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION catalog.set_attribute_value_active(text, bigint, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION catalog.delete_attribute_value(text, bigint) FROM PUBLIC;

REVOKE ALL ON FUNCTION catalog.list_units_v2(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION catalog.rename_unit(text, bigint, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION catalog.set_unit_active(text, bigint, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION catalog.delete_unit(text, bigint) FROM PUBLIC;

REVOKE ALL ON FUNCTION catalog.quick_create_product(text, text, bigint, numeric, bigint, bigint, text, numeric, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION catalog.list_products_v2(text, bigint, text, bigint, bigint, boolean, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION catalog.update_product(text, bigint, text, bigint, boolean, bigint, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION catalog.update_variant(text, bigint, text, numeric, boolean, numeric) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION catalog.list_categories(text) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION catalog.create_category(text, text) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION catalog.rename_category(text, bigint, text) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION catalog.set_category_active(text, bigint, boolean) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION catalog.delete_category(text, bigint) TO stockiha_runtime;

GRANT EXECUTE ON FUNCTION catalog.list_brands(text) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION catalog.create_brand(text, text, text) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION catalog.rename_brand(text, bigint, text, text) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION catalog.set_brand_active(text, bigint, boolean) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION catalog.delete_brand(text, bigint) TO stockiha_runtime;

GRANT EXECUTE ON FUNCTION catalog.list_attributes_v2(text) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION catalog.rename_attribute(text, bigint, text) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION catalog.set_attribute_active(text, bigint, boolean) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION catalog.delete_attribute(text, bigint) TO stockiha_runtime;

GRANT EXECUTE ON FUNCTION catalog.list_attribute_values(text) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION catalog.rename_attribute_value(text, bigint, text) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION catalog.set_attribute_value_active(text, bigint, boolean) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION catalog.delete_attribute_value(text, bigint) TO stockiha_runtime;

GRANT EXECUTE ON FUNCTION catalog.list_units_v2(text) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION catalog.rename_unit(text, bigint, text, text) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION catalog.set_unit_active(text, bigint, boolean) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION catalog.delete_unit(text, bigint) TO stockiha_runtime;

GRANT EXECUTE ON FUNCTION catalog.quick_create_product(text, text, bigint, numeric, bigint, bigint, text, numeric, boolean) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION catalog.list_products_v2(text, bigint, text, bigint, bigint, boolean, integer, integer) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION catalog.update_product(text, bigint, text, bigint, boolean, bigint, bigint) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION catalog.update_variant(text, bigint, text, numeric, boolean, numeric) TO stockiha_runtime;

RESET ROLE;
