-- S1-001 (corrected): minimal catalog grain — `catalog.products` (the
-- abstract product) and `catalog.product_variants` (the actual stocked,
-- sellable unit). Pulled forward from Slice 2 ("Variant catalog,
-- attributes, units, barcodes") only at this minimal grain, per explicit
-- correction instructions, because inventory positions/movements and sale
-- lines need a stable `variant_id` to key off of even for the Golden
-- Transaction Chain. Advanced catalog features (attributes, barcodes,
-- categories, unit conversions, price lists) remain out of scope and stay
-- Slice 2 work — only identity, naming, price, and active status exist
-- here.
SET ROLE stockiha_owner;

CREATE TABLE catalog.products (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name        text NOT NULL,
    is_active   boolean NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT products_name_not_blank CHECK (btrim(name) <> '')
);

-- Price, availability, and (via `inventory.positions`/`movements`) stock
-- and WAC all attach to the variant, not the product — the product is
-- purely the grouping identity above the sellable unit.
CREATE TABLE catalog.product_variants (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    product_id  bigint NOT NULL REFERENCES catalog.products (id),
    sku         text NOT NULL,
    sale_price  numeric(14, 2) NOT NULL,
    is_active   boolean NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT product_variants_sku_unique UNIQUE (sku),
    CONSTRAINT product_variants_sku_not_blank CHECK (btrim(sku) <> ''),
    CONSTRAINT product_variants_sale_price_non_negative CHECK (sale_price >= 0)
);

CREATE TRIGGER products_set_updated_at
    BEFORE UPDATE ON catalog.products
    FOR EACH ROW
    EXECUTE FUNCTION core.set_updated_at();

CREATE TRIGGER product_variants_set_updated_at
    BEFORE UPDATE ON catalog.product_variants
    FOR EACH ROW
    EXECUTE FUNCTION core.set_updated_at();

REVOKE ALL ON catalog.products FROM PUBLIC;
REVOKE ALL ON catalog.product_variants FROM PUBLIC;

-- No catalog management workflow exists yet in this slice (no IPC, no
-- application service, no posting function) — SELECT only until a future
-- SECURITY DEFINER catalog-management function owns the writes.
GRANT SELECT ON catalog.products TO stockiha_runtime;
GRANT SELECT ON catalog.product_variants TO stockiha_runtime;

RESET ROLE;
