-- =============================================================================
-- Migration: 20260930100000_ws_o_2_catalogue_pack_units.sql
-- Description: Pack units in Catalogue Setup (base_unit_id, conversion_factor)
-- =============================================================================

-- 1. Alter catalog.units table to support pack units
ALTER TABLE catalog.units
    ADD COLUMN IF NOT EXISTS base_unit_id bigint REFERENCES catalog.units(id),
    ADD COLUMN IF NOT EXISTS conversion_factor numeric(14,6);

-- 2. Constraints:
-- a) cannot be base unit of itself
ALTER TABLE catalog.units
    DROP CONSTRAINT IF EXISTS units_base_unit_not_self;

ALTER TABLE catalog.units
    ADD CONSTRAINT units_base_unit_not_self
        CHECK (base_unit_id IS NULL OR base_unit_id <> id);

-- b) if base_unit_id is set, conversion_factor must be set and > 1. If base_unit_id is null, conversion_factor must be null.
ALTER TABLE catalog.units
    DROP CONSTRAINT IF EXISTS units_pack_factor_check;

ALTER TABLE catalog.units
    ADD CONSTRAINT units_pack_factor_check
        CHECK (
            (base_unit_id IS NULL AND conversion_factor IS NULL) OR
            (base_unit_id IS NOT NULL AND conversion_factor IS NOT NULL AND conversion_factor > 1)
        );

-- 3. Triggers for hierarchy and validation
CREATE OR REPLACE FUNCTION catalog._check_unit_hierarchy()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.base_unit_id IS NOT NULL THEN
        -- Verify that the referenced base unit is NOT itself a pack unit (1-level hierarchy only)
        IF EXISTS (SELECT 1 FROM catalog.units WHERE id = NEW.base_unit_id AND base_unit_id IS NOT NULL) THEN
            RAISE EXCEPTION 'nested pack units are not allowed; base unit % is itself a pack unit', NEW.base_unit_id USING ERRCODE = '22023';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS check_unit_hierarchy_trg ON catalog.units;
CREATE TRIGGER check_unit_hierarchy_trg
    BEFORE INSERT OR UPDATE OF base_unit_id ON catalog.units
    FOR EACH ROW
    EXECUTE FUNCTION catalog._check_unit_hierarchy();

CREATE OR REPLACE FUNCTION catalog._check_unit_factor_fractions()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_base_fractions boolean;
BEGIN
    IF NEW.base_unit_id IS NOT NULL AND NEW.conversion_factor IS NOT NULL THEN
        SELECT allows_fractions INTO v_base_fractions FROM catalog.units WHERE id = NEW.base_unit_id;
        IF v_base_fractions IS FALSE AND NEW.conversion_factor <> trunc(NEW.conversion_factor) THEN
            RAISE EXCEPTION 'conversion factor for whole-number unit % must be an integer', NEW.base_unit_id USING ERRCODE = '22023';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS check_unit_factor_fractions_trg ON catalog.units;
CREATE TRIGGER check_unit_factor_fractions_trg
    BEFORE INSERT OR UPDATE OF base_unit_id, conversion_factor ON catalog.units
    FOR EACH ROW
    EXECUTE FUNCTION catalog._check_unit_factor_fractions();

CREATE OR REPLACE FUNCTION catalog._forbid_unit_factor_change_when_used()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF (OLD.conversion_factor IS DISTINCT FROM NEW.conversion_factor OR OLD.base_unit_id IS DISTINCT FROM NEW.base_unit_id) THEN
        IF EXISTS (SELECT 1 FROM catalog.variant_units WHERE unit_id = OLD.id) OR
           EXISTS (SELECT 1 FROM catalog.products WHERE unit_id = OLD.id) THEN
            RAISE EXCEPTION 'cannot change base unit or conversion factor of unit % because it is in use', OLD.id USING ERRCODE = '55000';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS forbid_unit_factor_change_when_used_trg ON catalog.units;
CREATE TRIGGER forbid_unit_factor_change_when_used_trg
    BEFORE UPDATE OF base_unit_id, conversion_factor ON catalog.units
    FOR EACH ROW
    EXECUTE FUNCTION catalog._forbid_unit_factor_change_when_used();

-- 4. Replace create_unit
DROP FUNCTION IF EXISTS catalog.create_unit(text, text, boolean);
DROP FUNCTION IF EXISTS catalog.create_unit(text, text, boolean, text, bigint, numeric);

CREATE FUNCTION catalog.create_unit(
    p_session_token text,
    p_name text,
    p_allows_fractions boolean,
    p_code text DEFAULT NULL,
    p_base_unit_id bigint DEFAULT NULL,
    p_conversion_factor numeric DEFAULT NULL
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
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_CATALOG');
    v_name := btrim(coalesce(p_name, ''));
    IF v_name = '' THEN
        RAISE EXCEPTION 'unit name must not be blank' USING ERRCODE = '22023';
    END IF;

    -- If pack unit, inherit allows_fractions from the base unit
    IF p_base_unit_id IS NOT NULL THEN
        SELECT allows_fractions INTO v_base_fractions FROM catalog.units WHERE id = p_base_unit_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'base unit % not found', p_base_unit_id USING ERRCODE = '22023';
        END IF;
        v_fractions := v_base_fractions;
    ELSE
        IF v_fractions IS NULL THEN
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
            INSERT INTO catalog.units (code, normalized_code, name, allows_fractions, base_unit_id, conversion_factor)
                VALUES (v_code, upper(v_code), v_name, v_fractions, p_base_unit_id, p_conversion_factor)
                RETURNING id INTO v_id;
            RETURN v_id;
        EXCEPTION WHEN unique_violation THEN
            RAISE EXCEPTION 'a unit with code % already exists', v_code USING ERRCODE = '23505';
        END;
    END IF;

    -- Derivation algorithm when code is not manually provided
    v_base := upper(regexp_replace(public.unaccent(v_name), '[^a-zA-Z0-9]+', '', 'g'));
    v_base := left(v_base, 20);
    IF v_base = '' THEN
        v_base := 'UNIT';
    END IF;

    LOOP
        v_code := CASE WHEN v_suffix = 1 THEN v_base ELSE v_base || v_suffix::text END;
        BEGIN
            INSERT INTO catalog.units (code, normalized_code, name, allows_fractions, base_unit_id, conversion_factor)
                VALUES (v_code, upper(v_code), v_name, v_fractions, p_base_unit_id, p_conversion_factor)
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

REVOKE ALL ON FUNCTION catalog.create_unit(text, text, boolean, text, bigint, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION catalog.create_unit(text, text, boolean, text, bigint, numeric) TO stockiha_runtime;

-- 5. update_unit / rename_unit
DROP FUNCTION IF EXISTS catalog.rename_unit(text, bigint, text, boolean);
DROP FUNCTION IF EXISTS catalog.update_unit(text, bigint, text, boolean, text, bigint, numeric);

CREATE FUNCTION catalog.update_unit(
    p_session_token text,
    p_unit_id bigint,
    p_name text,
    p_allows_fractions boolean,
    p_code text DEFAULT NULL,
    p_base_unit_id bigint DEFAULT NULL,
    p_conversion_factor numeric DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_name text;
    v_custom_code text;
    v_code text;
    v_fractions boolean := p_allows_fractions;
    v_base_fractions boolean;
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_CATALOG');
    PERFORM 1 FROM catalog.units WHERE id = p_unit_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'unit % not found', p_unit_id USING ERRCODE = '22023';
    END IF;
    v_name := btrim(coalesce(p_name, ''));
    IF v_name = '' THEN
        RAISE EXCEPTION 'unit name must not be blank' USING ERRCODE = '22023';
    END IF;

    IF p_base_unit_id IS NOT NULL THEN
        SELECT allows_fractions INTO v_base_fractions FROM catalog.units WHERE id = p_base_unit_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'base unit % not found', p_base_unit_id USING ERRCODE = '22023';
        END IF;
        v_fractions := v_base_fractions;
    ELSE
        IF v_fractions IS NULL THEN
            RAISE EXCEPTION 'unit allows_fractions must not be null' USING ERRCODE = '22023';
        END IF;
    END IF;

    v_custom_code := btrim(coalesce(p_code, ''));
    IF v_custom_code <> '' THEN
        v_code := upper(regexp_replace(v_custom_code, '[^a-zA-Z0-9_-]+', '', 'g'));
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
            conversion_factor = p_conversion_factor
        WHERE id = p_unit_id;
END;
$$;

REVOKE ALL ON FUNCTION catalog.update_unit(text, bigint, text, boolean, text, bigint, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION catalog.update_unit(text, bigint, text, boolean, text, bigint, numeric) TO stockiha_runtime;

-- Backwards compatibility wrapper for rename_unit
CREATE FUNCTION catalog.rename_unit(
    p_session_token text,
    p_unit_id bigint,
    p_name text,
    p_allows_fractions boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    PERFORM catalog.update_unit(p_session_token, p_unit_id, p_name, p_allows_fractions, NULL, NULL, NULL);
END;
$$;

REVOKE ALL ON FUNCTION catalog.rename_unit(text, bigint, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION catalog.rename_unit(text, bigint, text, boolean) TO stockiha_runtime;

-- 6. Replace delete_unit
CREATE OR REPLACE FUNCTION catalog.delete_unit(p_session_token text, p_unit_id bigint)
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
         + (SELECT count(*) FROM catalog.units child WHERE child.base_unit_id = p_unit_id)
        INTO v_usage;
    IF v_usage > 0 THEN
        RAISE EXCEPTION 'unit % is in use by % product/variant/conversion/pack unit row(s) and cannot be deleted', p_unit_id, v_usage
            USING ERRCODE = '55000';
    END IF;
    DELETE FROM catalog.units WHERE id = p_unit_id;
END;
$$;

-- 7. Replace set_unit_active
CREATE OR REPLACE FUNCTION catalog.set_unit_active(p_session_token text, p_unit_id bigint, p_is_active boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_CATALOG');
    IF NOT p_is_active THEN
        IF EXISTS (SELECT 1 FROM catalog.units WHERE base_unit_id = p_unit_id AND is_active = true) THEN
            RAISE EXCEPTION 'cannot deactivate unit % while active pack units depend on it', p_unit_id USING ERRCODE = '55000';
        END IF;
    END IF;
    UPDATE catalog.units SET is_active = p_is_active WHERE id = p_unit_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'unit % not found', p_unit_id USING ERRCODE = '22023';
    END IF;
END;
$$;

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
    conversion_factor numeric
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
               u.conversion_factor
        FROM catalog.units u
        LEFT JOIN catalog.units bu ON bu.id = u.base_unit_id
        ORDER BY u.code;
END;
$$;

REVOKE ALL ON FUNCTION catalog.list_units_v2(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION catalog.list_units_v2(text) TO stockiha_runtime;

-- 9. Update operations.schema_state
UPDATE operations.schema_state SET migration_version = 20260930100000, updated_at = now() WHERE singleton;

