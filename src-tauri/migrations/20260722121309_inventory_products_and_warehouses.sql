-- S1-001: products and warehouses — the minimal master data the Golden
-- Transaction Chain needs to record a cash sale.
--
-- Cost is deliberately NOT stored on `products`: valuation is
-- warehouse-specific weighted-average cost (final-architecture.md section 1,
-- "Valuation: Warehouse-specific WAC"), so the cost foundation lives on
-- `inventory.warehouse_stock` (next migration), not here. Duplicating a cost
-- field on the product would contradict that policy and invite drift between
-- a product-level figure and the real per-warehouse WAC.
SET ROLE stockiha_owner;

CREATE TABLE inventory.products (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    sku         text NOT NULL,
    name        text NOT NULL,
    sale_price  numeric(14, 2) NOT NULL,
    is_active   boolean NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT products_sku_unique UNIQUE (sku),
    CONSTRAINT products_sku_not_blank CHECK (btrim(sku) <> ''),
    CONSTRAINT products_name_not_blank CHECK (btrim(name) <> ''),
    CONSTRAINT products_sale_price_non_negative CHECK (sale_price >= 0)
);

CREATE TABLE inventory.warehouses (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code        text NOT NULL,
    name        text NOT NULL,
    is_active   boolean NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT warehouses_code_unique UNIQUE (code),
    CONSTRAINT warehouses_code_not_blank CHECK (btrim(code) <> ''),
    CONSTRAINT warehouses_name_not_blank CHECK (btrim(name) <> '')
);

CREATE TRIGGER products_set_updated_at
    BEFORE UPDATE ON inventory.products
    FOR EACH ROW
    EXECUTE FUNCTION core.set_updated_at();

CREATE TRIGGER warehouses_set_updated_at
    BEFORE UPDATE ON inventory.warehouses
    FOR EACH ROW
    EXECUTE FUNCTION core.set_updated_at();

REVOKE ALL ON inventory.products FROM PUBLIC;
REVOKE ALL ON inventory.warehouses FROM PUBLIC;

-- No product/warehouse management workflow exists yet in this slice (no IPC,
-- no application service, no posting function) — per the architecture's core
-- policy that day-to-day writes go exclusively through posting functions,
-- `stockiha_runtime` gets SELECT only here too. A future SECURITY DEFINER
-- catalog-management function will own the writes.
GRANT SELECT ON inventory.products TO stockiha_runtime;
GRANT SELECT ON inventory.warehouses TO stockiha_runtime;

RESET ROLE;
