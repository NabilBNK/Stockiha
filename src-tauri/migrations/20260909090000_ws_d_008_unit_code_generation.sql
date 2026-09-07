-- =============================================================================
-- WS-D-14 Part 3 -- generate catalog.units.code SERVER-SIDE, and stop
-- accepting it as typed input at all.
--
-- THE DANGER OF GENERATING IT IN REACT: catalog.units.normalized_code is
-- UNIQUE, and the old create_unit was get-or-create ON THAT COLUMN -- if two
-- units ever produced the same normalized_code, the SECOND call silently
-- returned the FIRST unit's id. If React derived "KG" from the typed name
-- "Kilogramme" while a "KG" unit already existed for an unrelated reason, the
-- operator would be handed someone else's unit -- a different unit than they
-- meant, with someone else's allows_fractions flag, and no error to warn
-- them. Only the database can resolve a uniqueness collision atomically
-- against concurrent writers, so the code is generated HERE.
--
-- DERIVATION ALGORITHM, stated plainly:
--   1. `public.unaccent(trim(name))` strips Latin diacritics: "Kilogramme"
--      stays "Kilogramme", "Boîte" becomes "Boite". The `unaccent` extension
--      is installed by this migration (CREATE EXTENSION IF NOT EXISTS); it
--      ships with PostgreSQL's contrib modules, so no external dependency is
--      introduced. Called schema-qualified (`public.unaccent`, not bare
--      `unaccent`) because this function runs under
--      `SET search_path = pg_catalog`, which deliberately keeps unqualified
--      names from resolving to anything outside pg_catalog.
--   2. Every character that is not an ASCII letter or digit is stripped
--      (regexp_replace ... '[^a-zA-Z0-9]+' ... 'g'), then the result is
--      upper-cased. This is what actually handles non-Latin input: Arabic
--      script is untouched by unaccent (unaccent only strips COMBINING
--      diacritics from Latin-family scripts) but IS stripped here, because
--      it is not in [a-zA-Z0-9].
--   3. NON-LATIN NAME, EXPLICITLY: if step 2 leaves an empty string (a name
--      with no Latin letters or digits at all -- a plain Arabic name is the
--      real case; verified against this database: unaccent+strip on the
--      Arabic word for "piece" yields ''), the candidate falls back to the
--      literal string 'UNIT'. This is NEVER left empty, and 'UNIT' then goes
--      through the exact same collision-suffix loop as every other
--      candidate, so several Arabic-named units end up 'UNIT', 'UNIT2',
--      'UNIT3' rather than colliding or failing.
--   4. The candidate is truncated to 20 characters -- long enough to keep a
--      real name recognisable, short enough that a suffixed code stays
--      readable on a receipt.
--   5. COLLISION RESOLUTION, inside the same statement so two concurrent
--      creates cannot both win: try the candidate bare first, then
--      candidate||2, candidate||3, ... incrementing on `unique_violation`
--      until an INSERT succeeds. Each attempt is a real INSERT inside a
--      sub-transaction (implicit in the EXCEPTION block), so PostgreSQL's own
--      unique-constraint enforcement is the arbiter -- there is no
--      check-then-insert race window.
--
-- NO DEDUPLICATION BY NAME. The OLD create_unit was get-or-create keyed on a
-- CODE THE OPERATOR TYPED: retyping the same code was a deliberate, explicit
-- statement "this is the same unit", and returning the existing row was the
-- safe response to that. Now that no code is typed, a normalized_code
-- collision means something different -- two unrelated NAMES happened to
-- derive overlapping candidates -- and the brief's own framing of collision
-- resolution ("so two concurrent creates cannot both win") describes
-- guaranteeing each one becomes a genuinely new, distinct row, not
-- deduplicating them. Creating a second unit named "Kilogram" twice in a row
-- therefore produces two units, coded KILOGRAM and KILOGRAM2 -- unlikely in
-- practice (nothing in this codebase surfaces a duplicate-name shortcut) and
-- a deliberate, stated choice rather than an oversight.
--
-- RENAME. The Owner ruled the code non-editable, so rename_unit's parameter
-- list DROPS p_code entirely -- renaming a unit's NAME never touches its
-- code, which is exactly the point: an operator changing "Kg" to
-- "Kilogramme" for clarity must not silently change a code that may already
-- be printed on a document. rename_unit's UPDATE therefore no longer
-- assigns code/normalized_code at all.
--
-- Both functions take a fixed parameter list, so both are DROPped and
-- recreated rather than CREATE OR REPLACE (ws-d-skill.md section 2.1): the
-- list shrinks in both cases, and PostgreSQL keys functions by argument
-- types, so replacing the body in place would leave the OLD, wider signature
-- live as a second overload. Every existing caller (Rust; SQL suites
-- s2_001, ws_d_001, r8_d, and s2_002 -- not run per instruction, but fixed
-- so it is not left broken for whoever re-provisions that database) is
-- updated in this same change. A dropped function loses its grants;
-- REVOKE/GRANT are re-issued for both.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS unaccent;

-- ------------------------------------------------------------- create_unit
DROP FUNCTION catalog.create_unit(text, text, text, boolean);

CREATE FUNCTION catalog.create_unit(
    p_session_token text,
    p_name text,
    p_allows_fractions boolean
)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE
    v_name   text;
    v_base   text;
    v_code   text;
    v_suffix int := 1;
    v_id     bigint;
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_CATALOG');
    v_name := btrim(coalesce(p_name, ''));
    IF v_name = '' THEN
        RAISE EXCEPTION 'unit name must not be blank' USING ERRCODE = '22023';
    END IF;
    IF p_allows_fractions IS NULL THEN
        RAISE EXCEPTION 'unit allows_fractions must not be null' USING ERRCODE = '22023';
    END IF;

    -- Derivation algorithm -- see the file header for the worked cases.
    v_base := upper(regexp_replace(public.unaccent(v_name), '[^a-zA-Z0-9]+', '', 'g'));
    v_base := left(v_base, 20);
    IF v_base = '' THEN
        v_base := 'UNIT';
    END IF;

    LOOP
        v_code := CASE WHEN v_suffix = 1 THEN v_base ELSE v_base || v_suffix::text END;
        BEGIN
            INSERT INTO catalog.units (code, normalized_code, name, allows_fractions)
                VALUES (v_code, upper(v_code), v_name, p_allows_fractions)
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

REVOKE ALL ON FUNCTION catalog.create_unit(text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION catalog.create_unit(text, text, boolean) TO stockiha_runtime;

-- ------------------------------------------------------------- rename_unit
-- p_code REMOVED. The code is fixed at creation; renaming the NAME never
-- touches it, so there is nothing left here that can raise unique_violation
-- on code -- the EXCEPTION block for it is gone along with the parameter.
DROP FUNCTION catalog.rename_unit(text, bigint, text, text, boolean);

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
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_CATALOG');
    PERFORM 1 FROM catalog.units WHERE id = p_unit_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'unit % not found', p_unit_id USING ERRCODE = '22023';
    END IF;
    IF btrim(coalesce(p_name, '')) = '' THEN
        RAISE EXCEPTION 'unit name must not be blank' USING ERRCODE = '22023';
    END IF;
    IF p_allows_fractions IS NULL THEN
        RAISE EXCEPTION 'unit allows_fractions must not be null' USING ERRCODE = '22023';
    END IF;
    UPDATE catalog.units
        SET name = btrim(p_name),
            allows_fractions = p_allows_fractions
        WHERE id = p_unit_id;
END;
$$;

REVOKE ALL ON FUNCTION catalog.rename_unit(text, bigint, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION catalog.rename_unit(text, bigint, text, boolean) TO stockiha_runtime;
