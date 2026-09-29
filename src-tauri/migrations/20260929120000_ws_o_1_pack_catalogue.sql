-- Migration: 20260929120000_ws_o_1_pack_catalogue.sql
-- Workstream WS-O-1: Pack Catalogue (Database & Backend foundation)

SET ROLE stockiha_owner;

-- ============================================================================
-- O-1.2 — Extend catalog.variant_units into packs
-- ============================================================================

ALTER TABLE catalog.variant_units
    ADD COLUMN sale_price numeric(14,2) NULL,
    ADD COLUMN is_primary boolean NOT NULL DEFAULT false,
    ADD COLUMN is_active  boolean NOT NULL DEFAULT true;

ALTER TABLE catalog.variant_units
    ADD CONSTRAINT variant_units_sale_price_valid
        CHECK (sale_price IS NULL OR (sale_price >= 0 AND sale_price = round(sale_price, 2))),
    ADD CONSTRAINT variant_units_primary_requires_active_pack
        CHECK (NOT is_primary OR (is_active AND conversion_factor > 1));

-- Backfill: one main pack per variant = active pack with the largest factor, then the smallest id.
UPDATE catalog.variant_units vu
   SET is_primary = true
 WHERE vu.id IN (
     SELECT DISTINCT ON (x.variant_id) x.id
       FROM catalog.variant_units x
      WHERE x.is_active AND x.conversion_factor > 1
      ORDER BY x.variant_id, x.conversion_factor DESC, x.id ASC);

CREATE UNIQUE INDEX variant_units_one_primary
    ON catalog.variant_units (variant_id) WHERE is_primary;

-- ============================================================================
-- O-1.3 — Link barcodes to packs
-- ============================================================================

ALTER TABLE catalog.variant_barcodes
    ADD COLUMN variant_unit_id bigint NULL REFERENCES catalog.variant_units (id);

ALTER TABLE catalog.variant_barcodes
    ADD CONSTRAINT variant_barcodes_pack_never_primary
        CHECK (variant_unit_id IS NULL OR NOT is_primary);

CREATE INDEX variant_barcodes_variant_unit_idx ON catalog.variant_barcodes (variant_unit_id);

CREATE OR REPLACE FUNCTION catalog._check_barcode_pack_variant() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
    IF NEW.variant_unit_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM catalog.variant_units vu
         WHERE vu.id = NEW.variant_unit_id AND vu.variant_id = NEW.variant_id) THEN
        RAISE EXCEPTION 'PACK_BARCODE_VARIANT_MISMATCH: pack % does not belong to variant %',
            NEW.variant_unit_id, NEW.variant_id USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION catalog._check_barcode_pack_variant() FROM PUBLIC;

CREATE TRIGGER variant_barcodes_check_pack_variant
    BEFORE INSERT OR UPDATE OF variant_unit_id, variant_id ON catalog.variant_barcodes
    FOR EACH ROW EXECUTE FUNCTION catalog._check_barcode_pack_variant();

-- ============================================================================
-- O-1.4 — Lock the base unit once alternate units exist (D12)
-- ============================================================================

CREATE OR REPLACE FUNCTION catalog._forbid_base_unit_change_with_packs() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
    IF TG_TABLE_NAME = 'products' THEN
        IF NEW.unit_id IS DISTINCT FROM OLD.unit_id AND EXISTS (
            SELECT 1 FROM catalog.variant_units vu JOIN catalog.product_variants pv ON pv.id = vu.variant_id
             WHERE pv.product_id = NEW.id) THEN
            RAISE EXCEPTION 'PRODUCT_UNIT_LOCKED_BY_PACKS: product % has packs or alternate units', NEW.id
                USING ERRCODE = '22023';
        END IF;
    ELSIF TG_TABLE_NAME = 'product_variants' THEN
        IF NEW.base_unit_id IS DISTINCT FROM OLD.base_unit_id AND EXISTS (
            SELECT 1 FROM catalog.variant_units vu WHERE vu.variant_id = NEW.id) THEN
            RAISE EXCEPTION 'PRODUCT_UNIT_LOCKED_BY_PACKS: variant % has packs or alternate units', NEW.id
                USING ERRCODE = '22023';
        END IF;
    END IF;
    RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION catalog._forbid_base_unit_change_with_packs() FROM PUBLIC;

CREATE TRIGGER products_lock_unit_with_packs BEFORE UPDATE OF unit_id ON catalog.products
    FOR EACH ROW EXECUTE FUNCTION catalog._forbid_base_unit_change_with_packs();
CREATE TRIGGER product_variants_lock_base_unit_with_packs BEFORE UPDATE OF base_unit_id ON catalog.product_variants
    FOR EACH ROW EXECUTE FUNCTION catalog._forbid_base_unit_change_with_packs();

-- ============================================================================
-- O-1.5 — Private helpers (owner-only, no grant)
-- ============================================================================

CREATE OR REPLACE FUNCTION catalog._variant_base_unit(p_variant_id bigint)
RETURNS TABLE (unit_id bigint, unit_code text, unit_name text, is_whole boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
    RETURN QUERY
    SELECT u.id, u.code, u.name, (NOT u.allows_fractions)
      FROM catalog.product_variants pv
      JOIN catalog.products p ON p.id = pv.product_id
      JOIN catalog.units u ON u.id = p.unit_id
     WHERE pv.id = p_variant_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'PACK_VARIANT_NOT_FOUND: variant % not found', p_variant_id USING ERRCODE = '22023';
    END IF;
END; $$;
REVOKE ALL ON FUNCTION catalog._variant_base_unit(bigint) FROM PUBLIC;

CREATE OR REPLACE FUNCTION catalog._validate_pack_factor(p_factor numeric, p_is_whole boolean)
RETURNS void
LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
    IF p_factor IS NULL OR p_factor <= 1 OR p_factor > 100000 OR p_factor <> round(p_factor, 6) THEN
        RAISE EXCEPTION 'PACK_FACTOR_INVALID: factor % is invalid', p_factor USING ERRCODE = '22023';
    END IF;
    IF p_is_whole AND p_factor <> trunc(p_factor) THEN
        RAISE EXCEPTION 'PACK_FACTOR_NOT_WHOLE: factor % must be a whole number for this base unit', p_factor USING ERRCODE = '22023';
    END IF;
END; $$;
REVOKE ALL ON FUNCTION catalog._validate_pack_factor(numeric, boolean) FROM PUBLIC;

CREATE OR REPLACE FUNCTION catalog._validate_amount(p_amount numeric, p_code text)
RETURNS void
LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
    IF p_amount IS NOT NULL THEN
        IF p_amount < 0 OR p_amount <> round(p_amount, 2) OR p_amount > 999999999999.99 THEN
            RAISE EXCEPTION '%: amount % is not valid', p_code, p_amount USING ERRCODE = '22023';
        END IF;
    END IF;
END; $$;
REVOKE ALL ON FUNCTION catalog._validate_amount(numeric, text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION catalog._pack_rate(p_amount numeric, p_factor numeric, p_scale integer)
RETURNS numeric
LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
    IF p_scale NOT IN (0, 2) THEN
        RAISE EXCEPTION 'PACK_RATE_SCALE_INVALID: scale % must be 0 or 2', p_scale USING ERRCODE = '22023';
    END IF;
    RETURN round(p_amount / p_factor, p_scale);
END; $$;
REVOKE ALL ON FUNCTION catalog._pack_rate(numeric, numeric, integer) FROM PUBLIC;

CREATE OR REPLACE FUNCTION catalog._pack_is_used(p_variant_unit_id bigint)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
    v_variant_id bigint;
    v_unit_id bigint;
BEGIN
    SELECT variant_id, unit_id INTO v_variant_id, v_unit_id
      FROM catalog.variant_units WHERE id = p_variant_unit_id;
    IF NOT FOUND THEN
        RETURN false;
    END IF;

    IF EXISTS (
        SELECT 1 FROM procurement.purchase_receipt_lines
         WHERE variant_id = v_variant_id AND unit_id = v_unit_id
    ) THEN
        RETURN true;
    END IF;

    IF EXISTS (
        SELECT 1 FROM inventory.stock_adjustments
         WHERE variant_id = v_variant_id AND input_unit_id = v_unit_id
    ) THEN
        RETURN true;
    END IF;

    IF EXISTS (
        SELECT 1 FROM procurement.purchase_return_lines
         WHERE variant_id = v_variant_id AND unit_id = v_unit_id
    ) THEN
        RETURN true;
    END IF;

    IF EXISTS (
        SELECT 1 FROM procurement.purchase_transaction_lines
         WHERE variant_id = v_variant_id AND unit_id = v_unit_id
    ) THEN
        RETURN true;
    END IF;

    RETURN false;
END; $$;
REVOKE ALL ON FUNCTION catalog._pack_is_used(bigint) FROM PUBLIC;

CREATE OR REPLACE FUNCTION catalog._reassign_primary_pack(p_variant_id bigint)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
    v_target_id bigint;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM catalog.variant_units
         WHERE variant_id = p_variant_id AND is_primary
    ) THEN
        SELECT id INTO v_target_id
          FROM catalog.variant_units
         WHERE variant_id = p_variant_id
           AND is_active
           AND conversion_factor > 1
         ORDER BY conversion_factor DESC, id ASC
         LIMIT 1;

        IF v_target_id IS NOT NULL THEN
            UPDATE catalog.variant_units
               SET is_primary = true
             WHERE id = v_target_id;
        END IF;
    END IF;
END; $$;
REVOKE ALL ON FUNCTION catalog._reassign_primary_pack(bigint) FROM PUBLIC;

CREATE OR REPLACE FUNCTION catalog._set_primary_pack(p_variant_unit_id bigint)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
    v_variant_id bigint;
BEGIN
    SELECT variant_id INTO v_variant_id
      FROM catalog.variant_units WHERE id = p_variant_unit_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'PACK_NOT_FOUND: pack % not found', p_variant_unit_id USING ERRCODE = '22023';
    END IF;

    UPDATE catalog.variant_units
       SET is_primary = false
     WHERE variant_id = v_variant_id
       AND is_primary
       AND id <> p_variant_unit_id;

    UPDATE catalog.variant_units
       SET is_primary = true
     WHERE id = p_variant_unit_id;
END; $$;
REVOKE ALL ON FUNCTION catalog._set_primary_pack(bigint) FROM PUBLIC;

-- ============================================================================
-- O-1.6 — Public pack functions (writes)
-- ============================================================================

CREATE OR REPLACE FUNCTION catalog.create_pack(
    p_session_token text,
    p_variant_id bigint,
    p_unit_id bigint,
    p_conversion_factor numeric,
    p_sale_price numeric,
    p_make_primary boolean
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
    v_base RECORD;
    v_new_id bigint;
    v_direction text;
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_CATALOG');

    -- Lock variant row for update
    PERFORM 1 FROM catalog.product_variants WHERE id = p_variant_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'PACK_VARIANT_NOT_FOUND: variant % not found', p_variant_id USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_base FROM catalog._variant_base_unit(p_variant_id);

    IF NOT EXISTS (SELECT 1 FROM catalog.units WHERE id = p_unit_id AND is_active) THEN
        RAISE EXCEPTION 'PACK_UNIT_NOT_FOUND: unit % not found or inactive', p_unit_id USING ERRCODE = '22023';
    END IF;

    IF p_unit_id = v_base.unit_id THEN
        RAISE EXCEPTION 'PACK_UNIT_IS_BASE: unit % is already the base unit', p_unit_id USING ERRCODE = '22023';
    END IF;

    PERFORM catalog._validate_pack_factor(p_conversion_factor, v_base.is_whole);
    PERFORM catalog._validate_amount(p_sale_price, 'PACK_PRICE_INVALID');

    v_direction := 'ALT_TO_BASE';

    BEGIN
        INSERT INTO catalog.variant_units (
            variant_id, unit_id, conversion_factor, conversion_direction, conversion_quantity,
            sale_price, is_primary, is_active
        ) VALUES (
            p_variant_id, p_unit_id, p_conversion_factor, v_direction, p_conversion_factor,
            p_sale_price, false, true
        ) RETURNING id INTO v_new_id;
    EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION 'PACK_DUPLICATE_UNIT: unit % is already configured for variant %',
            p_unit_id, p_variant_id USING ERRCODE = '22023';
    END;

    IF coalesce(p_make_primary, false) THEN
        PERFORM catalog._set_primary_pack(v_new_id);
    ELSE
        PERFORM catalog._reassign_primary_pack(p_variant_id);
    END IF;

    RETURN v_new_id;
END; $$;
REVOKE ALL ON FUNCTION catalog.create_pack(text, bigint, bigint, numeric, numeric, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION catalog.create_pack(text, bigint, bigint, numeric, numeric, boolean) TO stockiha_runtime;

CREATE OR REPLACE FUNCTION catalog.update_pack(
    p_session_token text,
    p_variant_unit_id bigint,
    p_conversion_factor numeric,
    p_sale_price numeric
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
    v_pack RECORD;
    v_base RECORD;
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_CATALOG');

    SELECT * INTO v_pack FROM catalog.variant_units WHERE id = p_variant_unit_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'PACK_NOT_FOUND: pack % not found', p_variant_unit_id USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_base FROM catalog._variant_base_unit(v_pack.variant_id);

    IF p_conversion_factor <> v_pack.conversion_factor THEN
        IF catalog._pack_is_used(p_variant_unit_id) THEN
            RAISE EXCEPTION 'PACK_IN_USE: pack % is in use and its factor cannot be changed',
                p_variant_unit_id USING ERRCODE = '22023';
        END IF;
        PERFORM catalog._validate_pack_factor(p_conversion_factor, v_base.is_whole);
        UPDATE catalog.variant_units
           SET conversion_factor = p_conversion_factor,
               conversion_quantity = p_conversion_factor
         WHERE id = p_variant_unit_id;
    END IF;

    PERFORM catalog._validate_amount(p_sale_price, 'PACK_PRICE_INVALID');
    UPDATE catalog.variant_units
       SET sale_price = p_sale_price
     WHERE id = p_variant_unit_id;

    PERFORM catalog._reassign_primary_pack(v_pack.variant_id);
END; $$;
REVOKE ALL ON FUNCTION catalog.update_pack(text, bigint, numeric, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION catalog.update_pack(text, bigint, numeric, numeric) TO stockiha_runtime;

CREATE OR REPLACE FUNCTION catalog.set_pack_primary(
    p_session_token text,
    p_variant_unit_id bigint
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
    v_pack RECORD;
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_CATALOG');

    SELECT * INTO v_pack FROM catalog.variant_units WHERE id = p_variant_unit_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'PACK_NOT_FOUND: pack % not found', p_variant_unit_id USING ERRCODE = '22023';
    END IF;

    IF NOT v_pack.is_active OR v_pack.conversion_factor <= 1 THEN
        RAISE EXCEPTION 'PACK_NOT_ACTIVE: pack % is not active or factor <= 1', p_variant_unit_id USING ERRCODE = '22023';
    END IF;

    PERFORM catalog._set_primary_pack(p_variant_unit_id);
END; $$;
REVOKE ALL ON FUNCTION catalog.set_pack_primary(text, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION catalog.set_pack_primary(text, bigint) TO stockiha_runtime;

CREATE OR REPLACE FUNCTION catalog.set_pack_active(
    p_session_token text,
    p_variant_unit_id bigint,
    p_is_active boolean
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
    v_pack RECORD;
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_CATALOG');

    SELECT * INTO v_pack FROM catalog.variant_units WHERE id = p_variant_unit_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'PACK_NOT_FOUND: pack % not found', p_variant_unit_id USING ERRCODE = '22023';
    END IF;

    IF NOT p_is_active THEN
        UPDATE catalog.variant_units
           SET is_primary = false,
               is_active = false
         WHERE id = p_variant_unit_id;
    ELSE
        UPDATE catalog.variant_units
           SET is_active = true
         WHERE id = p_variant_unit_id;
    END IF;

    PERFORM catalog._reassign_primary_pack(v_pack.variant_id);
END; $$;
REVOKE ALL ON FUNCTION catalog.set_pack_active(text, bigint, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION catalog.set_pack_active(text, bigint, boolean) TO stockiha_runtime;

CREATE OR REPLACE FUNCTION catalog.remove_pack(
    p_session_token text,
    p_variant_unit_id bigint
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
    v_pack RECORD;
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_CATALOG');

    SELECT * INTO v_pack FROM catalog.variant_units WHERE id = p_variant_unit_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'PACK_NOT_FOUND: pack % not found', p_variant_unit_id USING ERRCODE = '22023';
    END IF;

    IF catalog._pack_is_used(p_variant_unit_id) THEN
        RAISE EXCEPTION 'PACK_IN_USE: pack % is in use and cannot be deleted', p_variant_unit_id USING ERRCODE = '22023';
    END IF;

    DELETE FROM catalog.variant_barcodes WHERE variant_unit_id = p_variant_unit_id;
    DELETE FROM catalog.variant_units WHERE id = p_variant_unit_id;

    PERFORM catalog._reassign_primary_pack(v_pack.variant_id);
END; $$;
REVOKE ALL ON FUNCTION catalog.remove_pack(text, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION catalog.remove_pack(text, bigint) TO stockiha_runtime;

CREATE OR REPLACE FUNCTION catalog.add_pack_barcode(
    p_session_token text,
    p_variant_unit_id bigint,
    p_barcode text
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
    v_pack RECORD;
    v_norm text;
    v_barcode_id bigint;
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_CATALOG');

    SELECT * INTO v_pack FROM catalog.variant_units WHERE id = p_variant_unit_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'PACK_NOT_FOUND: pack % not found', p_variant_unit_id USING ERRCODE = '22023';
    END IF;

    IF NOT v_pack.is_active THEN
        RAISE EXCEPTION 'PACK_NOT_ACTIVE: pack % is inactive', p_variant_unit_id USING ERRCODE = '22023';
    END IF;

    v_norm := upper(btrim(coalesce(p_barcode, '')));
    IF v_norm = '' THEN
        RAISE EXCEPTION 'PACK_BARCODE_BLANK: barcode cannot be blank' USING ERRCODE = '22023';
    END IF;

    BEGIN
        INSERT INTO catalog.variant_barcodes (
            variant_id, barcode, normalized_barcode, is_primary, variant_unit_id
        ) VALUES (
            v_pack.variant_id, btrim(p_barcode), v_norm, false, p_variant_unit_id
        ) RETURNING id INTO v_barcode_id;
    EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION 'PACK_BARCODE_DUPLICATE: barcode % is already in use', p_barcode USING ERRCODE = '22023';
    END;

    RETURN v_barcode_id;
END; $$;
REVOKE ALL ON FUNCTION catalog.add_pack_barcode(text, bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION catalog.add_pack_barcode(text, bigint, text) TO stockiha_runtime;

-- ============================================================================
-- O-1.7 — Public pack functions (reads)
-- ============================================================================

CREATE OR REPLACE FUNCTION catalog.list_variant_packs(
    p_session_token text,
    p_variant_id bigint
) RETURNS TABLE (
    variant_unit_id bigint,
    unit_id bigint,
    unit_code text,
    unit_name text,
    conversion_factor numeric,
    sale_price numeric,
    is_pack boolean,
    is_primary boolean,
    is_active boolean,
    is_used boolean,
    barcode_ids bigint[],
    barcodes text[]
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
    PERFORM 1 FROM iam.resolve_session(p_session_token);

    RETURN QUERY
    SELECT vu.id AS variant_unit_id,
           vu.unit_id,
           u.code AS unit_code,
           u.name AS unit_name,
           vu.conversion_factor,
           vu.sale_price,
           (vu.conversion_factor > 1) AS is_pack,
           vu.is_primary,
           vu.is_active,
           catalog._pack_is_used(vu.id) AS is_used,
           coalesce((
               SELECT array_agg(b.id ORDER BY b.id)
                 FROM catalog.variant_barcodes b
                WHERE b.variant_unit_id = vu.id
           ), '{}'::bigint[]) AS barcode_ids,
           coalesce((
               SELECT array_agg(b.barcode ORDER BY b.id)
                 FROM catalog.variant_barcodes b
                WHERE b.variant_unit_id = vu.id
           ), '{}'::text[]) AS barcodes
      FROM catalog.variant_units vu
      JOIN catalog.units u ON u.id = vu.unit_id
     WHERE vu.variant_id = p_variant_id
     ORDER BY vu.is_primary DESC, (vu.conversion_factor > 1) DESC, vu.conversion_factor DESC, vu.id ASC;
END; $$;
REVOKE ALL ON FUNCTION catalog.list_variant_packs(text, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION catalog.list_variant_packs(text, bigint) TO stockiha_runtime;

CREATE OR REPLACE FUNCTION catalog.get_primary_packs(
    p_session_token text,
    p_variant_ids bigint[]
) RETURNS TABLE (
    variant_id bigint,
    variant_unit_id bigint,
    unit_code text,
    unit_name text,
    conversion_factor numeric,
    sale_price numeric,
    base_unit_code text,
    base_unit_name text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
    PERFORM 1 FROM iam.resolve_session(p_session_token);

    IF p_variant_ids IS NOT NULL AND cardinality(p_variant_ids) > 500 THEN
        RAISE EXCEPTION 'PACK_REQUEST_TOO_LARGE: cannot request more than 500 variant packs at once' USING ERRCODE = '22023';
    END IF;

    IF p_variant_ids IS NULL OR cardinality(p_variant_ids) = 0 THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT DISTINCT ON (pv.id)
           pv.id AS variant_id,
           vu.id AS variant_unit_id,
           u.code AS unit_code,
           u.name AS unit_name,
           vu.conversion_factor,
           vu.sale_price,
           bu.code AS base_unit_code,
           bu.name AS base_unit_name
      FROM catalog.product_variants pv
      JOIN catalog.products p ON p.id = pv.product_id
      JOIN catalog.units bu ON bu.id = p.unit_id
      JOIN catalog.variant_units vu ON vu.variant_id = pv.id AND vu.is_primary AND vu.is_active
      JOIN catalog.units u ON u.id = vu.unit_id
     WHERE pv.id = ANY(p_variant_ids);
END; $$;
REVOKE ALL ON FUNCTION catalog.get_primary_packs(text, bigint[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION catalog.get_primary_packs(text, bigint[]) TO stockiha_runtime;

-- ============================================================================
-- O-1.8 — Patch existing barcode and alternate-unit functions
-- ============================================================================

CREATE OR REPLACE FUNCTION catalog.remove_variant_barcode(p_session_token text, p_barcode_id bigint)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
    v_variant_id bigint;
    v_was_primary boolean;
    v_next_id bigint;
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_CATALOG');
    SELECT variant_id, is_primary INTO v_variant_id, v_was_primary
        FROM catalog.variant_barcodes WHERE id = p_barcode_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'barcode % not found', p_barcode_id USING ERRCODE = '22023';
    END IF;

    DELETE FROM catalog.variant_barcodes WHERE id = p_barcode_id;

    IF v_was_primary THEN
        -- Only promote a piece barcode (variant_unit_id IS NULL)
        SELECT min(id) INTO v_next_id
          FROM catalog.variant_barcodes
         WHERE variant_id = v_variant_id AND variant_unit_id IS NULL;
        IF v_next_id IS NOT NULL THEN
            UPDATE catalog.variant_barcodes SET is_primary = true WHERE id = v_next_id;
        END IF;
    END IF;
END; $$;
REVOKE ALL ON FUNCTION catalog.remove_variant_barcode(text, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION catalog.remove_variant_barcode(text, bigint) TO stockiha_runtime;

CREATE OR REPLACE FUNCTION catalog.remove_variant_alt_unit(p_session_token text, p_variant_unit_id bigint)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
    v_variant_id bigint;
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_CATALOG');

    SELECT variant_id INTO v_variant_id
      FROM catalog.variant_units WHERE id = p_variant_unit_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'alternate unit assignment % not found', p_variant_unit_id USING ERRCODE = '22023';
    END IF;

    DELETE FROM catalog.variant_barcodes WHERE variant_unit_id = p_variant_unit_id;
    DELETE FROM catalog.variant_units WHERE id = p_variant_unit_id;

    PERFORM catalog._reassign_primary_pack(v_variant_id);
END; $$;
REVOKE ALL ON FUNCTION catalog.remove_variant_alt_unit(text, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION catalog.remove_variant_alt_unit(text, bigint) TO stockiha_runtime;

CREATE OR REPLACE FUNCTION catalog.add_variant_alt_unit(
    p_session_token text,
    p_variant_id bigint,
    p_unit_id bigint,
    p_conversion_direction text,
    p_conversion_quantity numeric
)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
    v_base_unit bigint;
    v_factor numeric(20,6);
    v_id bigint;
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_CATALOG');

    SELECT p.unit_id INTO v_base_unit
      FROM catalog.product_variants pv
      JOIN catalog.products p ON p.id = pv.product_id
     WHERE pv.id = p_variant_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'variant % not found', p_variant_id USING ERRCODE = '22023';
    END IF;
    PERFORM 1 FROM catalog.units WHERE id = p_unit_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'unit % not found', p_unit_id USING ERRCODE = '22023';
    END IF;

    IF p_unit_id = v_base_unit THEN
        RAISE EXCEPTION 'alternate unit must differ from the base unit' USING ERRCODE = '22023';
    END IF;
    IF p_conversion_direction NOT IN ('ALT_TO_BASE', 'BASE_TO_ALT') THEN
        RAISE EXCEPTION 'conversion direction must be ALT_TO_BASE or BASE_TO_ALT' USING ERRCODE = '22023';
    END IF;
    IF p_conversion_quantity IS NULL OR p_conversion_quantity <= 0 THEN
        RAISE EXCEPTION 'conversion quantity must be strictly positive' USING ERRCODE = '22023';
    END IF;

    IF p_conversion_direction = 'ALT_TO_BASE' THEN
        v_factor := p_conversion_quantity;
    ELSE
        v_factor := round(1 / p_conversion_quantity, 6);
        IF v_factor <= 0 THEN
            RAISE EXCEPTION 'conversion quantity % is too large to represent at six decimal places',
                p_conversion_quantity USING ERRCODE = '22023';
        END IF;
    END IF;

    BEGIN
        INSERT INTO catalog.variant_units
                (variant_id, unit_id, conversion_factor, conversion_direction, conversion_quantity)
            VALUES (p_variant_id, p_unit_id, v_factor, p_conversion_direction, p_conversion_quantity)
            RETURNING id INTO v_id;
    EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION 'alternate unit % is already configured for this variant', p_unit_id
            USING ERRCODE = '22023';
    END;

    PERFORM catalog._reassign_primary_pack(p_variant_id);

    RETURN v_id;
END; $$;
REVOKE ALL ON FUNCTION catalog.add_variant_alt_unit(text, bigint, bigint, text, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION catalog.add_variant_alt_unit(text, bigint, bigint, text, numeric) TO stockiha_runtime;

-- ============================================================================
-- O-1.9 — Extend catalog.resolve_barcode with pack columns
-- ============================================================================

DROP FUNCTION catalog.resolve_barcode(text, text);

CREATE OR REPLACE FUNCTION catalog.resolve_barcode(p_session_token text, p_identifier text)
RETURNS TABLE(
    variant_id bigint,
    product_id bigint,
    sku text,
    name_override text,
    effective_variant_name text,
    primary_barcode text,
    operational_identifier text,
    identifier_type text,
    product_name text,
    sale_price numeric,
    unit_id bigint,
    unit_code text,
    unit_name text,
    variant_is_active boolean,
    product_is_active boolean,
    pack_variant_unit_id bigint,
    pack_unit_id bigint,
    pack_unit_code text,
    pack_unit_name text,
    pack_factor numeric,
    pack_sale_price numeric,
    pack_is_active boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
    v_norm text;
BEGIN
    PERFORM 1 FROM iam.resolve_session(p_session_token);

    v_norm := upper(btrim(coalesce(p_identifier, '')));
    IF v_norm = '' THEN
        RETURN;
    END IF;

    -- 1. Try exact barcode match (piece or pack barcode)
    RETURN QUERY
    SELECT v.id, p.id, v.sku, v.name_override, catalog._effective_variant_name(v.id),
           b_prim.barcode, coalesce(b_prim.barcode, v.sku),
           CASE WHEN b_prim.barcode IS NOT NULL THEN 'BARCODE' ELSE 'SKU' END,
           p.name, v.sale_price, u.id, u.code, u.name, v.is_active, p.is_active,
           pk.id, pk.unit_id, pku.code, pku.name, pk.conversion_factor, pk.sale_price, pk.is_active
    FROM catalog.variant_barcodes b
    JOIN catalog.product_variants v ON v.id = b.variant_id
    JOIN catalog.products p ON p.id = v.product_id
    JOIN catalog.units u ON u.id = p.unit_id
    LEFT JOIN catalog.variant_barcodes b_prim
      ON b_prim.variant_id = v.id AND b_prim.is_primary = true
    LEFT JOIN catalog.variant_units pk
      ON pk.id = b.variant_unit_id
    LEFT JOIN catalog.units pku
      ON pku.id = pk.unit_id
    WHERE b.normalized_barcode = v_norm
      AND v.is_active
      AND p.is_active
    LIMIT 1;

    IF FOUND THEN
        RETURN;
    END IF;

    -- 2. Try exact SKU match (pack columns are NULL)
    RETURN QUERY
    SELECT v.id, p.id, v.sku, v.name_override, catalog._effective_variant_name(v.id),
           b_prim.barcode, coalesce(b_prim.barcode, v.sku),
           CASE WHEN b_prim.barcode IS NOT NULL THEN 'BARCODE' ELSE 'SKU' END,
           p.name, v.sale_price, u.id, u.code, u.name, v.is_active, p.is_active,
           NULL::bigint, NULL::bigint, NULL::text, NULL::text, NULL::numeric, NULL::numeric, NULL::boolean
    FROM catalog.product_variants v
    JOIN catalog.products p ON p.id = v.product_id
    JOIN catalog.units u ON u.id = p.unit_id
    LEFT JOIN catalog.variant_barcodes b_prim
      ON b_prim.variant_id = v.id AND b_prim.is_primary = true
    WHERE upper(v.sku) = v_norm
      AND v.is_active
      AND p.is_active
    LIMIT 1;
END; $$;

REVOKE ALL ON FUNCTION catalog.resolve_barcode(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION catalog.resolve_barcode(text, text) TO stockiha_runtime;

UPDATE operations.schema_state SET migration_version = 20260929120000, updated_at = now() WHERE singleton;

RESET ROLE;
