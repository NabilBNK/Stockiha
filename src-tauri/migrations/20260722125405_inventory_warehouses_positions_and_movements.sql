-- S1-001 (corrected): warehouses, warehouse-specific WAC positions, and the
-- immutable movement ledger (final-architecture.md sections 1 and 3.C).
--
-- Naming correction: architecture section 2, rule 1 names these ledgers
-- explicitly — "core ledgers (movements, payments, journals, positions)" —
-- so this migration renames the first pass's `warehouse_stock` /
-- `stock_ledger` to `inventory.positions` / `inventory.movements`, matching
-- the architecture's own vocabulary instead of a paraphrase of it. Both now
-- key off `variant_id` (catalog.product_variants), not a bare product id.
SET ROLE stockiha_owner;

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

CREATE TRIGGER warehouses_set_updated_at
    BEFORE UPDATE ON inventory.warehouses
    FOR EACH ROW
    EXECUTE FUNCTION core.set_updated_at();

-- Cached current balance per (warehouse, variant). Mutated exclusively by a
-- future posting function that also appends the corresponding
-- `inventory.movements` row in the same transaction — never by
-- `stockiha_runtime` directly (enforced below via grants, not just
-- convention).
CREATE TABLE inventory.positions (
    id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    warehouse_id          bigint NOT NULL REFERENCES inventory.warehouses (id),
    variant_id            bigint NOT NULL REFERENCES catalog.product_variants (id),
    quantity_on_hand      numeric(18, 3) NOT NULL DEFAULT 0,
    total_value           numeric(18, 4) NOT NULL DEFAULT 0,
    -- Stored separately from total_value so a zero-quantity reset never
    -- discards the last real cost figure (architecture section 3.C:
    -- "last_known_wac remains stored separately to prevent rounding
    -- residuals from leaving dangling values").
    last_known_wac        numeric(18, 6) NOT NULL DEFAULT 0,
    updated_at            timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT positions_scope_unique UNIQUE (warehouse_id, variant_id),
    CONSTRAINT positions_quantity_non_negative CHECK (quantity_on_hand >= 0),
    CONSTRAINT positions_value_non_negative CHECK (total_value >= 0),
    CONSTRAINT positions_wac_non_negative CHECK (last_known_wac >= 0),
    -- Zero-quantity safeguard (architecture section 3.C): no positive
    -- inventory value may exist against zero units.
    CONSTRAINT positions_zero_quantity_zero_value
        CHECK (quantity_on_hand > 0 OR total_value = 0)
);

CREATE TRIGGER positions_set_updated_at
    BEFORE UPDATE ON inventory.positions
    FOR EACH ROW
    EXECUTE FUNCTION core.set_updated_at();

-- Append-only, immutable movement history. Every row is a signed delta pair
-- (quantity_delta, inventory_value_delta) plus the resulting balance
-- snapshot, matching architecture section 3.C's ledger model. No `UPDATE`
-- path exists on purpose: corrections are new rows, never edits.
CREATE TABLE inventory.movements (
    id                          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    warehouse_id                bigint NOT NULL REFERENCES inventory.warehouses (id),
    variant_id                  bigint NOT NULL REFERENCES catalog.product_variants (id),
    movement_type                text NOT NULL,
    quantity_delta                numeric(18, 3) NOT NULL,
    inventory_value_delta         numeric(18, 4) NOT NULL,
    resulting_quantity_on_hand    numeric(18, 3) NOT NULL,
    resulting_total_value         numeric(18, 4) NOT NULL,
    -- Generic, ledger-agnostic backreference (e.g. to a future
    -- sales.cash_sale_lines row) — deliberately not a foreign key yet: the
    -- referenced posting tables/functions do not exist in this slice, and a
    -- premature FK would either point nowhere or hard-couple the ledger to
    -- one specific source before the posting matrix is designed.
    reference_type                text,
    reference_id                  bigint,
    created_at                    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT movements_movement_type_valid
        CHECK (movement_type IN ('RECEIPT', 'ISSUE', 'ADJUSTMENT', 'COST_ONLY')),
    -- Cost-only adjustments (quantity_delta = 0) are only meaningful while
    -- quantity_on_hand > 0 (architecture section 3.C).
    CONSTRAINT movements_cost_only_requires_stock
        CHECK (quantity_delta <> 0 OR resulting_quantity_on_hand > 0),
    CONSTRAINT movements_resulting_quantity_non_negative
        CHECK (resulting_quantity_on_hand >= 0),
    CONSTRAINT movements_resulting_value_non_negative
        CHECK (resulting_total_value >= 0),
    CONSTRAINT movements_zero_quantity_zero_value
        CHECK (resulting_quantity_on_hand > 0 OR resulting_total_value = 0)
);

-- Immutability: a stock movement is a fact of history the moment it is
-- written — there is no draft phase for ledger rows (unlike business
-- documents, which have an explicit DRAFT status before posting).
CREATE FUNCTION inventory.forbid_movement_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'inventory.movements rows are immutable and append-only'
        USING ERRCODE = '0A000';
END;
$$;

CREATE TRIGGER movements_forbid_update
    BEFORE UPDATE ON inventory.movements
    FOR EACH ROW
    EXECUTE FUNCTION inventory.forbid_movement_mutation();

CREATE TRIGGER movements_forbid_delete
    BEFORE DELETE ON inventory.movements
    FOR EACH ROW
    EXECUTE FUNCTION inventory.forbid_movement_mutation();

REVOKE ALL ON inventory.warehouses FROM PUBLIC;
REVOKE ALL ON inventory.positions FROM PUBLIC;
REVOKE ALL ON inventory.movements FROM PUBLIC;
REVOKE ALL ON FUNCTION inventory.forbid_movement_mutation() FROM PUBLIC;

GRANT SELECT ON inventory.warehouses TO stockiha_runtime;
-- Task requirement: "stockiha_runtime must not directly insert, update, or
-- delete: stock balances, stock ledger" (now positions/movements). Read-only
-- until a future posting function (e.g. `inventory.confirm_stock_adjustment`,
-- Slice 2) is the sole writer.
GRANT SELECT ON inventory.positions TO stockiha_runtime;
GRANT SELECT ON inventory.movements TO stockiha_runtime;

RESET ROLE;
