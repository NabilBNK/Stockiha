-- Remove the superseded batch-create overload.
-- Its payload allowed per-variant units and caller-supplied SKUs, which conflict
-- with the canonical product-owned unit and generated-SKU contract.
SET ROLE stockiha_owner;

DROP FUNCTION IF EXISTS catalog.create_product_with_variants(
    text, text, boolean, jsonb
);

RESET ROLE;
