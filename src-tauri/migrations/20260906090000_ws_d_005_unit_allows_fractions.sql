-- =============================================================================
-- WS-D-13 Phase A -- decimal-vs-whole capability flag on catalog.units.
--
-- Owner requirement: when creating a unit it must be markable as
-- decimal-capable (Kg, Litre) or whole-number-only (Piece, Box). Until now
-- catalog.units carried no such flag at all, so every quantity field in the
-- application accepted "2.5 Pieces".
--
-- WHY THE DEFAULT IS `true` (permissive), which is the LESS strict choice:
-- existing rows carry no record of the Owner's intent, and defaulting to
-- `false` would retroactively declare every fractional quantity already
-- stored against those units invalid. Existing rows are therefore left
-- deliberately permissive; the Owner tightens them per-unit from Catalogue
-- Setup, where the new toggle now lives. A unit created from here on states
-- its own intent at creation time.
--
-- NO CHECK CONSTRAINT IS ADDED, deliberately. A database-level constraint on
-- quantity columns would have to be validated against all historical rows,
-- and enforcing it is out of this task's scope. The census run against
-- stockiha_acceptance before writing this migration found ZERO fractional
-- rows in all four quantity-bearing columns
-- (catalog.product_variants.minimum_stock 0/9, inventory.positions
-- .quantity_on_hand 0/0, inventory.movements.quantity_delta 0/0,
-- catalog.variant_units.conversion_factor 0/0) -- but that is an acceptance
-- database, NOT the Owner's production data, so it cannot license a
-- constraint either. Enforcement in this phase is UI-level guidance only;
-- see src/features/inventory/exactDecimal.ts (isQuantityValidForUnit).
--
-- ---------------------------------------------------------------------------
-- WIDENING MECHANISM, and why these are DROP + CREATE rather than
-- CREATE OR REPLACE (ws-d-skill.md section 2.1):
--
-- PostgreSQL identifies a function by (name, argument types). Adding a
-- parameter therefore does NOT replace the existing function -- it creates a
-- SECOND, overloaded one, and leaving both live is exactly the ambiguity that
-- `remove_ambiguous_catalog_barcode_helper` had to delete once already. Each
-- function below is dropped at its OLD signature and recreated at the new
-- one, so exactly one signature stays live, and every caller is updated in
-- this same change (Rust: application/catalog.rs, commands/catalog.rs; SQL
-- suites: s2_001, ws_d_001, r8_d, s2_002).
--
-- catalog.list_units_v2 keeps its (text) signature but changes its RETURNS
-- TABLE, which CREATE OR REPLACE also cannot do ("cannot change return type
-- of existing function"), so it is dropped and recreated too.
--
-- A dropped function loses its grants (ws-d-skill.md section 4.4), so REVOKE
-- and GRANT are re-issued for all three at the end of this file.
-- =============================================================================

ALTER TABLE catalog.units
    ADD COLUMN allows_fractions boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN catalog.units.allows_fractions IS
    'Whether quantities in this unit may carry a fractional part. true for '
    'Kg/Litre, false for Piece/Box. Existing rows were backfilled to true '
    'deliberately (WS-D-13 Phase A): their intent was unrecorded, and '
    'defaulting to false would have retroactively invalidated any fractional '
    'quantity already stored. Enforced as UI guidance only -- there is no '
    'CHECK constraint on quantity columns.';

-- ------------------------------------------------------------- create_unit
-- Unchanged semantics apart from the new parameter: still get-or-create,
-- still returns the id of the existing row on a normalized_code conflict.
--
-- ON CONFLICT DO NOTHING is kept rather than widened to DO UPDATE: this
-- function is the inline "create a unit without leaving the product form"
-- shortcut as well as Catalogue Setup's create. A get-or-create must not
-- silently REDEFINE an existing unit's fractional semantics as a side effect
-- of someone typing an existing code, which DO UPDATE would do. Changing the
-- flag on an existing unit is rename_unit's job, from Catalogue Setup, where
-- the operator can see what they are changing.
DROP FUNCTION catalog.create_unit(text, text, text);

CREATE FUNCTION catalog.create_unit(
    p_session_token text,
    p_code text,
    p_name text,
    p_allows_fractions boolean
)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE
    v_id bigint;
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_CATALOG');
    IF btrim(coalesce(p_code, '')) = '' OR btrim(coalesce(p_name, '')) = '' THEN
        RAISE EXCEPTION 'unit code and name must not be blank' USING ERRCODE = '22023';
    END IF;
    IF p_allows_fractions IS NULL THEN
        RAISE EXCEPTION 'unit allows_fractions must not be null' USING ERRCODE = '22023';
    END IF;
    INSERT INTO catalog.units (code, normalized_code, name, allows_fractions)
        VALUES (btrim(p_code), upper(btrim(p_code)), btrim(p_name), p_allows_fractions)
        ON CONFLICT (normalized_code) DO NOTHING;
    SELECT id INTO v_id FROM catalog.units WHERE normalized_code = upper(btrim(p_code));
    RETURN v_id;
END;
$$;

-- ------------------------------------------------------------- rename_unit
-- THE OVERWRITE TRAP -- stated explicitly because this function's shape
-- decides it:
--
-- rename_unit's UPDATE assigns every column it names UNCONDITIONALLY. It
-- already did so for code, normalized_code and name (there is no "leave the
-- name alone" call), and allows_fractions now joins them. So EVERY caller
-- must send the unit's CURRENT allows_fractions value, not a default -- a
-- caller that hardcoded `true` here would silently re-open a whole-number
-- unit to fractions on the next rename.
--
-- This is consistent with the contract that already existed (you cannot
-- rename a unit without also sending its code), and the Catalogue Setup row
-- editor seeds all three fields from the row before submitting. `is_active`
-- is deliberately NOT assigned here -- it has its own function,
-- catalog.set_unit_active, and that split is unchanged.
DROP FUNCTION catalog.rename_unit(text, bigint, text, text);

CREATE FUNCTION catalog.rename_unit(
    p_session_token text,
    p_unit_id bigint,
    p_code text,
    p_name text,
    p_allows_fractions boolean
)
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
    IF p_allows_fractions IS NULL THEN
        RAISE EXCEPTION 'unit allows_fractions must not be null' USING ERRCODE = '22023';
    END IF;
    BEGIN
        UPDATE catalog.units
            SET code = btrim(p_code),
                normalized_code = upper(btrim(p_code)),
                name = btrim(p_name),
                allows_fractions = p_allows_fractions
            WHERE id = p_unit_id;
    EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION 'a unit with code % already exists', p_code USING ERRCODE = '22023';
    END;
END;
$$;

-- ----------------------------------------------------------- list_units_v2
-- ADD ONLY: allows_fractions is appended after is_active. The five existing
-- output columns keep their names, order and types, and the Rust caller
-- selects columns BY NAME from this function
-- (`SELECT id, code, name, is_active, allows_fractions, usage_count FROM ...`),
-- so nothing positional can drift. usage_count keeps its meaning: products
-- using the unit, plus variants basing on it, plus alternate-unit conversion
-- rows.
DROP FUNCTION catalog.list_units_v2(text);

CREATE FUNCTION catalog.list_units_v2(p_session_token text)
RETURNS TABLE(
    id bigint,
    code text,
    name text,
    is_active boolean,
    allows_fractions boolean,
    usage_count bigint
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
        FROM catalog.units u
        ORDER BY u.code;
END;
$$;

-- =============================================================================
-- Grants. A dropped function takes its grants with it, so all three are
-- re-issued here at their NEW signatures, matching the pattern in
-- ws_d_001 section 1021 onward. Omitting this fails at runtime, not at
-- migration time.
-- =============================================================================
REVOKE ALL ON FUNCTION catalog.create_unit(text, text, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION catalog.rename_unit(text, bigint, text, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION catalog.list_units_v2(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION catalog.create_unit(text, text, text, boolean) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION catalog.rename_unit(text, bigint, text, text, boolean) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION catalog.list_units_v2(text) TO stockiha_runtime;
