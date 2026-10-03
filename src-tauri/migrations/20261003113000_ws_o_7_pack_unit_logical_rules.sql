-- =============================================================================
-- Migration: 20261003113000_ws_o_7_pack_unit_logical_rules.sql
-- Workstream WS-O-7: Units and Packs Logical Rules & Architecture Enforcement
-- =============================================================================

SET ROLE stockiha_owner;

-- 1. Add is_pack to catalog.units
ALTER TABLE catalog.units
    ADD COLUMN IF NOT EXISTS is_pack boolean NOT NULL DEFAULT false;

-- Backfill is_pack for existing pack units (any unit with base_unit_id or known packaging names)
UPDATE catalog.units
   SET is_pack = true
 WHERE base_unit_id IS NOT NULL
    OR code IN ('BOX36', 'CARTON', 'BOX12', 'BX12_691869741', 'BOX-2026');

-- 2. Clean up test products that currently use pack units as base units
DELETE FROM catalog.variant_barcodes
 WHERE variant_unit_id IN (
     SELECT vu.id
       FROM catalog.variant_units vu
       JOIN catalog.product_variants pv ON pv.id = vu.variant_id
       JOIN catalog.products p ON p.id = pv.product_id
      WHERE p.unit_id IN (SELECT id FROM catalog.units WHERE is_pack = true)
         OR pv.base_unit_id IN (SELECT id FROM catalog.units WHERE is_pack = true)
 );

DELETE FROM catalog.variant_units vu
 USING catalog.product_variants pv, catalog.products p
 WHERE vu.variant_id = pv.id
   AND pv.product_id = p.id
   AND (p.unit_id IN (SELECT id FROM catalog.units WHERE is_pack = true)
        OR pv.base_unit_id IN (SELECT id FROM catalog.units WHERE is_pack = true));

UPDATE catalog.product_variants
   SET base_unit_id = 1
 WHERE base_unit_id IN (SELECT id FROM catalog.units WHERE is_pack = true);

UPDATE catalog.products
   SET unit_id = 1
 WHERE unit_id IN (SELECT id FROM catalog.units WHERE is_pack = true);

-- Remove any invalid variant_units where unit_id is the same as the variant's base_unit_id
DELETE FROM catalog.variant_barcodes
 WHERE variant_unit_id IN (
     SELECT vu.id
       FROM catalog.variant_units vu
       JOIN catalog.product_variants pv ON pv.id = vu.variant_id
      WHERE vu.unit_id = pv.base_unit_id
 );

DELETE FROM catalog.variant_units vu
 USING catalog.product_variants pv
 WHERE vu.variant_id = pv.id AND vu.unit_id = pv.base_unit_id;

-- 3. Replace units_pack_factor_check constraint:
-- Base Unit: NOT is_pack AND base_unit_id IS NULL AND conversion_factor IS NULL
-- Pre-configured Pack: is_pack AND base_unit_id IS NOT NULL AND conversion_factor IS NOT NULL AND conversion_factor > 1
-- Flexible Pack: is_pack AND base_unit_id IS NULL AND conversion_factor IS NULL
ALTER TABLE catalog.units DROP CONSTRAINT IF EXISTS units_pack_factor_check;
ALTER TABLE catalog.units ADD CONSTRAINT units_pack_factor_check
    CHECK (
        (NOT is_pack AND base_unit_id IS NULL AND conversion_factor IS NULL) OR
        (is_pack AND base_unit_id IS NOT NULL AND conversion_factor IS NOT NULL AND conversion_factor > 1) OR
        (is_pack AND base_unit_id IS NULL AND conversion_factor IS NULL)
    );

-- 4. Prevent pack units from being selected as product or variant base unit
CREATE OR REPLACE FUNCTION catalog._check_product_unit_is_base() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
    v_is_pack boolean;
BEGIN
    SELECT is_pack INTO v_is_pack FROM catalog.units WHERE id = NEW.unit_id;
    IF v_is_pack IS TRUE THEN
        RAISE EXCEPTION 'PRODUCT_BASE_UNIT_CANNOT_BE_PACK: unit % is a packaging/pack unit and cannot be a product base unit', NEW.unit_id
            USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION catalog._check_product_unit_is_base() FROM PUBLIC;

DROP TRIGGER IF EXISTS products_check_unit_is_base ON catalog.products;
CREATE TRIGGER products_check_unit_is_base
    BEFORE INSERT OR UPDATE OF unit_id ON catalog.products
    FOR EACH ROW EXECUTE FUNCTION catalog._check_product_unit_is_base();

CREATE OR REPLACE FUNCTION catalog._check_variant_unit_is_base() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
    v_is_pack boolean;
BEGIN
    SELECT is_pack INTO v_is_pack FROM catalog.units WHERE id = NEW.base_unit_id;
    IF v_is_pack IS TRUE THEN
        RAISE EXCEPTION 'VARIANT_BASE_UNIT_CANNOT_BE_PACK: unit % is a packaging/pack unit and cannot be a variant base unit', NEW.base_unit_id
            USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION catalog._check_variant_unit_is_base() FROM PUBLIC;

DROP TRIGGER IF EXISTS product_variants_check_unit_is_base ON catalog.product_variants;
CREATE TRIGGER product_variants_check_unit_is_base
    BEFORE INSERT OR UPDATE OF base_unit_id ON catalog.product_variants
    FOR EACH ROW EXECUTE FUNCTION catalog._check_variant_unit_is_base();

-- 5. Prevent atomic base units from being added as variant packs, and enforce pack rules
CREATE OR REPLACE FUNCTION catalog._check_variant_pack_rules() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
    v_unit_is_pack boolean;
    v_unit_base_id bigint;
    v_unit_factor numeric;
    v_var_base_id bigint;
BEGIN
    SELECT base_unit_id INTO v_var_base_id FROM catalog.product_variants WHERE id = NEW.variant_id;
    IF NEW.unit_id = v_var_base_id THEN
        RAISE EXCEPTION 'PACK_CANNOT_BE_SAME_AS_BASE_UNIT: unit % is the base unit of variant %', NEW.unit_id, NEW.variant_id
            USING ERRCODE = '22023';
    END IF;

    SELECT is_pack, base_unit_id, conversion_factor
      INTO v_unit_is_pack, v_unit_base_id, v_unit_factor
      FROM catalog.units WHERE id = NEW.unit_id;

    IF v_unit_is_pack IS NOT TRUE THEN
        RAISE EXCEPTION 'PACK_UNIT_MUST_BE_PACK_TYPE: unit % is an atomic base unit and cannot be added as a pack', NEW.unit_id
            USING ERRCODE = '22023';
    END IF;

    IF v_unit_base_id IS NOT NULL AND v_unit_base_id <> v_var_base_id THEN
        RAISE EXCEPTION 'PACK_BASE_UNIT_MISMATCH: pack unit % is configured for base unit %, but variant has %',
            NEW.unit_id, v_unit_base_id, v_var_base_id USING ERRCODE = '22023';
    END IF;

    IF v_unit_factor IS NOT NULL AND NEW.conversion_factor <> v_unit_factor THEN
        RAISE EXCEPTION 'PACK_FACTOR_LOCKED: pack unit % has fixed factor %, cannot set %',
            NEW.unit_id, v_unit_factor, NEW.conversion_factor USING ERRCODE = '22023';
    END IF;

    IF NEW.conversion_factor <= 1 THEN
        RAISE EXCEPTION 'PACK_FACTOR_MUST_BE_GREATER_THAN_ONE: pack factor % must be > 1',
            NEW.conversion_factor USING ERRCODE = '22023';
    END IF;

    RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION catalog._check_variant_pack_rules() FROM PUBLIC;

DROP TRIGGER IF EXISTS variant_units_check_rules ON catalog.variant_units;
CREATE TRIGGER variant_units_check_rules
    BEFORE INSERT OR UPDATE OF unit_id, conversion_factor ON catalog.variant_units
    FOR EACH ROW EXECUTE FUNCTION catalog._check_variant_pack_rules();

-- 6. Update catalog.create_unit
DROP FUNCTION IF EXISTS catalog.create_unit(text, text, boolean, text, bigint, numeric);
DROP FUNCTION IF EXISTS catalog.create_unit(text, text, boolean, text, bigint, numeric, boolean);

CREATE FUNCTION catalog.create_unit(
    p_session_token text,
    p_name text,
    p_allows_fractions boolean,
    p_code text DEFAULT NULL,
    p_base_unit_id bigint DEFAULT NULL,
    p_conversion_factor numeric DEFAULT NULL,
    p_is_pack boolean DEFAULT false
)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE
    v_name   text;
    v_base   text;
    v_code   text;
    v_custom_code text;
    v_suffix int := 1;
    v_id     bigint;
    v_fractions boolean := p_allows_fractions;
    v_base_fractions boolean;
    v_is_pack boolean := coalesce(p_is_pack, false);
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_CATALOG');
    v_name := btrim(coalesce(p_name, ''));
    IF v_name = '' THEN
        RAISE EXCEPTION 'unit name must not be blank' USING ERRCODE = '22023';
    END IF;

    -- If base_unit_id is provided, it is automatically a pack
    IF p_base_unit_id IS NOT NULL THEN
        v_is_pack := true;
        SELECT allows_fractions INTO v_base_fractions FROM catalog.units WHERE id = p_base_unit_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'base unit % not found', p_base_unit_id USING ERRCODE = '22023';
        END IF;
        v_fractions := v_base_fractions;
    ELSE
        IF v_is_pack THEN
            v_fractions := false;
        ELSIF v_fractions IS NULL THEN
            RAISE EXCEPTION 'unit allows_fractions must not be null' USING ERRCODE = '22023';
        END IF;
    END IF;

    v_custom_code := btrim(coalesce(p_code, ''));
    IF v_custom_code <> '' THEN
        v_code := upper(regexp_replace(v_custom_code, '[^a-zA-Z0-9_-]+', '', 'g'));
        IF v_code = '' THEN
            RAISE EXCEPTION 'custom unit code is invalid' USING ERRCODE = '22023';
        END IF;
        BEGIN
            INSERT INTO catalog.units (code, normalized_code, name, allows_fractions, base_unit_id, conversion_factor, is_pack)
                VALUES (v_code, upper(v_code), v_name, v_fractions, p_base_unit_id, p_conversion_factor, v_is_pack)
                RETURNING id INTO v_id;
            RETURN v_id;
        EXCEPTION WHEN unique_violation THEN
            RAISE EXCEPTION 'a unit with code % already exists', v_code USING ERRCODE = '23505';
        END;
    END IF;

    v_base := upper(regexp_replace(public.unaccent(v_name), '[^a-zA-Z0-9]+', '', 'g'));
    v_base := left(v_base, 20);
    IF v_base = '' THEN
        v_base := 'UNIT';
    END IF;

    LOOP
        v_code := CASE WHEN v_suffix = 1 THEN v_base ELSE v_base || v_suffix::text END;
        BEGIN
            INSERT INTO catalog.units (code, normalized_code, name, allows_fractions, base_unit_id, conversion_factor, is_pack)
                VALUES (v_code, upper(v_code), v_name, v_fractions, p_base_unit_id, p_conversion_factor, v_is_pack)
                RETURNING id INTO v_id;
            RETURN v_id;
        EXCEPTION WHEN unique_violation THEN
            v_suffix := v_suffix + 1;
            IF v_suffix > 1000 THEN
                RAISE EXCEPTION 'could not generate a unique code for unit %', v_name USING ERRCODE = '22023';
            END IF;
        END;
    END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION catalog.create_unit(text, text, boolean, text, bigint, numeric, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION catalog.create_unit(text, text, boolean, text, bigint, numeric, boolean) TO stockiha_runtime;

-- Backwards compatibility wrapper for 6-arg create_unit
CREATE OR REPLACE FUNCTION catalog.create_unit(
    p_session_token text,
    p_name text,
    p_allows_fractions boolean,
    p_code text,
    p_base_unit_id bigint,
    p_conversion_factor numeric
)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
BEGIN
    RETURN catalog.create_unit(p_session_token, p_name, p_allows_fractions, p_code, p_base_unit_id, p_conversion_factor, (p_base_unit_id IS NOT NULL));
END;
$$;
REVOKE ALL ON FUNCTION catalog.create_unit(text, text, boolean, text, bigint, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION catalog.create_unit(text, text, boolean, text, bigint, numeric) TO stockiha_runtime;

-- 7. Update update_unit
DROP FUNCTION IF EXISTS catalog.update_unit(text, bigint, text, boolean, text, bigint, numeric);
DROP FUNCTION IF EXISTS catalog.update_unit(text, bigint, text, boolean, text, bigint, numeric, boolean);

CREATE FUNCTION catalog.update_unit(
    p_session_token text,
    p_unit_id bigint,
    p_name text,
    p_allows_fractions boolean,
    p_code text DEFAULT NULL,
    p_base_unit_id bigint DEFAULT NULL,
    p_conversion_factor numeric DEFAULT NULL,
    p_is_pack boolean DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_name text;
    v_code text;
    v_fractions boolean := p_allows_fractions;
    v_base_fractions boolean;
    v_is_pack boolean;
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_CATALOG');
    v_name := btrim(coalesce(p_name, ''));
    IF v_name = '' THEN
        RAISE EXCEPTION 'unit name must not be blank' USING ERRCODE = '22023';
    END IF;

    SELECT is_pack INTO v_is_pack FROM catalog.units WHERE id = p_unit_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'unit % not found', p_unit_id USING ERRCODE = '22023';
    END IF;

    IF p_is_pack IS NOT NULL THEN
        v_is_pack := p_is_pack;
    END IF;

    IF p_base_unit_id IS NOT NULL THEN
        v_is_pack := true;
        SELECT allows_fractions INTO v_base_fractions FROM catalog.units WHERE id = p_base_unit_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'base unit % not found', p_base_unit_id USING ERRCODE = '22023';
        END IF;
        v_fractions := v_base_fractions;
    ELSE
        IF v_is_pack THEN
            v_fractions := false;
        ELSIF v_fractions IS NULL THEN
            RAISE EXCEPTION 'unit allows_fractions must not be null' USING ERRCODE = '22023';
        END IF;
    END IF;

    IF p_code IS NOT NULL AND btrim(p_code) <> '' THEN
        v_code := upper(regexp_replace(btrim(p_code), '[^a-zA-Z0-9_-]+', '', 'g'));
        IF v_code = '' THEN
            RAISE EXCEPTION 'custom unit code is invalid' USING ERRCODE = '22023';
        END IF;
    END IF;

    UPDATE catalog.units
       SET name = v_name,
           allows_fractions = v_fractions,
           code = coalesce(v_code, code),
           normalized_code = coalesce(v_code, normalized_code),
           base_unit_id = p_base_unit_id,
           conversion_factor = p_conversion_factor,
           is_pack = v_is_pack
     WHERE id = p_unit_id;
END;
$$;

REVOKE ALL ON FUNCTION catalog.update_unit(text, bigint, text, boolean, text, bigint, numeric, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION catalog.update_unit(text, bigint, text, boolean, text, bigint, numeric, boolean) TO stockiha_runtime;

-- Backwards compatibility wrapper for 7-arg update_unit
CREATE OR REPLACE FUNCTION catalog.update_unit(
    p_session_token text,
    p_unit_id bigint,
    p_name text,
    p_allows_fractions boolean,
    p_code text,
    p_base_unit_id bigint,
    p_conversion_factor numeric
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
BEGIN
    PERFORM catalog.update_unit(p_session_token, p_unit_id, p_name, p_allows_fractions, p_code, p_base_unit_id, p_conversion_factor, NULL);
END;
$$;
REVOKE ALL ON FUNCTION catalog.update_unit(text, bigint, text, boolean, text, bigint, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION catalog.update_unit(text, bigint, text, boolean, text, bigint, numeric) TO stockiha_runtime;

-- 8. Replace list_units_v2
DROP FUNCTION IF EXISTS catalog.list_units_v2(text);

CREATE FUNCTION catalog.list_units_v2(p_session_token text)
RETURNS TABLE(
    id bigint,
    code text,
    name text,
    is_active boolean,
    allows_fractions boolean,
    usage_count bigint,
    base_unit_id bigint,
    base_unit_code text,
    base_unit_name text,
    conversion_factor numeric,
    is_pack boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    PERFORM 1 FROM iam.resolve_session(p_session_token);
    RETURN QUERY
        SELECT u.id, u.code, u.name, u.is_active, u.allows_fractions,
               (SELECT count(*) FROM catalog.products p WHERE p.unit_id = u.id)
             + (SELECT count(*) FROM catalog.product_variants pv WHERE pv.base_unit_id = u.id)
             + (SELECT count(*) FROM catalog.variant_units vu WHERE vu.unit_id = u.id)
             + (SELECT count(*) FROM catalog.units child WHERE child.base_unit_id = u.id) AS usage_count,
               u.base_unit_id,
               bu.code AS base_unit_code,
               bu.name AS base_unit_name,
               u.conversion_factor,
               u.is_pack
        FROM catalog.units u
        LEFT JOIN catalog.units bu ON bu.id = u.base_unit_id
        ORDER BY u.is_pack ASC, u.code ASC;
END;
$$;

REVOKE ALL ON FUNCTION catalog.list_units_v2(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION catalog.list_units_v2(text) TO stockiha_runtime;
