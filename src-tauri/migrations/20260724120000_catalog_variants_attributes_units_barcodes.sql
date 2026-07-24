-- S2-001: Variant catalog extension — attributes, attribute values, units,
-- exact alternate-unit conversions, and barcodes.
--
-- Forward-only, additive migration. It preserves every existing Slice 1
-- product and its default variant: the only change to an existing row is
-- backfilling a mandatory base unit. No default variant is duplicated.
--
-- Design notes (see the companion function migration for enforcement):
--   * SKU uniqueness stays GLOBAL (repository's intended scope), owned by the
--     existing product_variants_sku_unique constraint. Input is trimmed before
--     persistence; the DB constraint remains the final authority.
--   * A variant's effective attribute combination is captured in a
--     deterministic `attribute_signature` (sorted "attribute_id:value_id"
--     pairs, empty string = no attributes). UNIQUE(product_id,
--     attribute_signature) is the final authority preventing two variants of
--     the same product from sharing an identical combination. The signature is
--     computed only inside catalog posting functions, under a per-product row
--     lock, so the rule is deterministic and concurrency-safe even though
--     PostgreSQL cannot directly express set-equality uniqueness across a
--     child table.
--   * Barcodes are globally unique on their normalized (upper+trim) value and
--     are never referenced by any ledger, so add/remove never corrupts stock
--     or sale history.
--   * Conversion factors use exact NUMERIC(20,6); no floating point anywhere.
SET ROLE stockiha_owner;

-- ---------------------------------------------------------------------------
-- Units of measure (reusable definitions managed by catalog administrators).
-- normalized_code = upper(btrim(code)) and is the uniqueness key.
-- ---------------------------------------------------------------------------
CREATE TABLE catalog.units (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code            text NOT NULL,
    normalized_code text NOT NULL,
    name            text NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT units_code_not_blank CHECK (btrim(code) <> ''),
    CONSTRAINT units_name_not_blank CHECK (btrim(name) <> ''),
    CONSTRAINT units_normalized_code_not_blank CHECK (normalized_code <> ''),
    CONSTRAINT units_normalized_code_unique UNIQUE (normalized_code)
);

CREATE TRIGGER units_set_updated_at
    BEFORE UPDATE ON catalog.units
    FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

-- Canonical base unit used to backfill existing Slice 1 variants. Additional
-- units (carton, pack, kilogram, gram, ...) are created at runtime by users.
INSERT INTO catalog.units (code, normalized_code, name)
    VALUES ('UNIT', 'UNIT', 'Unit');

-- ---------------------------------------------------------------------------
-- Attributes and their values (reusable; names are not hard-coded).
-- normalized_name/value = lower(btrim(...)) for case-insensitive uniqueness.
-- ---------------------------------------------------------------------------
CREATE TABLE catalog.attributes (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name            text NOT NULL,
    normalized_name text NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT attributes_name_not_blank CHECK (btrim(name) <> ''),
    CONSTRAINT attributes_normalized_name_not_blank CHECK (normalized_name <> ''),
    CONSTRAINT attributes_normalized_name_unique UNIQUE (normalized_name)
);

CREATE TRIGGER attributes_set_updated_at
    BEFORE UPDATE ON catalog.attributes
    FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

CREATE TABLE catalog.attribute_values (
    id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    attribute_id     bigint NOT NULL REFERENCES catalog.attributes (id),
    value            text NOT NULL,
    normalized_value text NOT NULL,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT attribute_values_value_not_blank CHECK (btrim(value) <> ''),
    CONSTRAINT attribute_values_normalized_not_blank CHECK (normalized_value <> ''),
    CONSTRAINT attribute_values_unique UNIQUE (attribute_id, normalized_value),
    -- Composite key so a variant link can enforce value-belongs-to-attribute
    -- via a foreign key on (attribute_value_id, attribute_id).
    CONSTRAINT attribute_values_id_attribute_unique UNIQUE (id, attribute_id)
);

CREATE TRIGGER attribute_values_set_updated_at
    BEFORE UPDATE ON catalog.attribute_values
    FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

-- ---------------------------------------------------------------------------
-- Extend product variants: mandatory base unit + deterministic signature.
-- ---------------------------------------------------------------------------
ALTER TABLE catalog.product_variants
    ADD COLUMN base_unit_id        bigint REFERENCES catalog.units (id),
    ADD COLUMN attribute_signature text NOT NULL DEFAULT '';

-- Backfill existing default variants with the canonical base unit. Their
-- signature stays '' (no attributes), which is unique per product, so the
-- new combination constraint accepts them without duplication.
UPDATE catalog.product_variants
    SET base_unit_id = (SELECT id FROM catalog.units WHERE normalized_code = 'UNIT')
    WHERE base_unit_id IS NULL;

ALTER TABLE catalog.product_variants
    ALTER COLUMN base_unit_id SET NOT NULL;

ALTER TABLE catalog.product_variants
    ADD CONSTRAINT product_variants_combo_unique UNIQUE (product_id, attribute_signature);

-- ---------------------------------------------------------------------------
-- Variant <-> attribute value links. One value per attribute per variant
-- (enforced by the primary key). The composite FK guarantees the chosen value
-- actually belongs to the named attribute.
-- ---------------------------------------------------------------------------
CREATE TABLE catalog.variant_attribute_values (
    variant_id         bigint NOT NULL REFERENCES catalog.product_variants (id),
    attribute_id       bigint NOT NULL REFERENCES catalog.attributes (id),
    attribute_value_id bigint NOT NULL,
    created_at         timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (variant_id, attribute_id),
    CONSTRAINT variant_attribute_values_value_fk
        FOREIGN KEY (attribute_value_id, attribute_id)
        REFERENCES catalog.attribute_values (id, attribute_id)
);

CREATE INDEX variant_attribute_values_variant_idx
    ON catalog.variant_attribute_values (variant_id);
CREATE INDEX variant_attribute_values_value_idx
    ON catalog.variant_attribute_values (attribute_value_id);

-- ---------------------------------------------------------------------------
-- Alternate units per variant with an exact conversion factor to the base
-- unit. conversion_factor = number of BASE units contained in one alternate
-- unit (e.g. one carton = 12 base units -> 12.000000). Strictly positive.
-- The base unit itself is implicitly factor 1 and is never stored here.
-- ---------------------------------------------------------------------------
CREATE TABLE catalog.variant_units (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    variant_id        bigint NOT NULL REFERENCES catalog.product_variants (id),
    unit_id           bigint NOT NULL REFERENCES catalog.units (id),
    conversion_factor numeric(20, 6) NOT NULL,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT variant_units_unique UNIQUE (variant_id, unit_id),
    CONSTRAINT variant_units_factor_positive CHECK (conversion_factor > 0)
);

CREATE TRIGGER variant_units_set_updated_at
    BEFORE UPDATE ON catalog.variant_units
    FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

CREATE INDEX variant_units_variant_idx ON catalog.variant_units (variant_id);

-- ---------------------------------------------------------------------------
-- Barcodes: one or more per variant, globally unique on the normalized value
-- (upper+trim). A barcode resolves to exactly one variant. Barcodes are not
-- referenced by any ledger, so add/remove never corrupts historical records.
-- ---------------------------------------------------------------------------
CREATE TABLE catalog.variant_barcodes (
    id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    variant_id         bigint NOT NULL REFERENCES catalog.product_variants (id),
    barcode            text NOT NULL,
    normalized_barcode text NOT NULL,
    created_at         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT variant_barcodes_not_blank CHECK (btrim(barcode) <> ''),
    CONSTRAINT variant_barcodes_normalized_not_blank CHECK (normalized_barcode <> ''),
    CONSTRAINT variant_barcodes_normalized_unique UNIQUE (normalized_barcode)
);

CREATE INDEX variant_barcodes_variant_idx ON catalog.variant_barcodes (variant_id);

-- ---------------------------------------------------------------------------
-- Grants: the runtime role may read catalog tables directly (matching the
-- existing Slice 1 pattern); every WRITE flows through SECURITY DEFINER
-- posting functions defined in the companion migration. No INSERT/UPDATE/
-- DELETE is granted to stockiha_runtime on any catalog table.
-- ---------------------------------------------------------------------------
REVOKE ALL ON catalog.units FROM PUBLIC;
REVOKE ALL ON catalog.attributes FROM PUBLIC;
REVOKE ALL ON catalog.attribute_values FROM PUBLIC;
REVOKE ALL ON catalog.variant_attribute_values FROM PUBLIC;
REVOKE ALL ON catalog.variant_units FROM PUBLIC;
REVOKE ALL ON catalog.variant_barcodes FROM PUBLIC;

GRANT SELECT ON catalog.units TO stockiha_runtime;
GRANT SELECT ON catalog.attributes TO stockiha_runtime;
GRANT SELECT ON catalog.attribute_values TO stockiha_runtime;
GRANT SELECT ON catalog.variant_attribute_values TO stockiha_runtime;
GRANT SELECT ON catalog.variant_units TO stockiha_runtime;
GRANT SELECT ON catalog.variant_barcodes TO stockiha_runtime;

RESET ROLE;
