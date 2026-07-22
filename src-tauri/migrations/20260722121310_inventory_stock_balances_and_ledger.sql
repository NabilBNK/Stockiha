-- S1-001: warehouse-specific WAC balances and the immutable stock ledger
-- (final-architecture.md sections 1 and 3.C).
SET ROLE stockiha_owner;

-- Cached current balance per (warehouse, product). Mutated exclusively by a
-- future posting function that also appends the corresponding
-- `stock_ledger` row in the same transaction — never by `stockiha_runtime`
-- directly (enforced below via grants, not just convention).
CREATE TABLE inventory.warehouse_stock (
    id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    warehouse_id          bigint NOT NULL REFERENCES inventory.warehouses (id),
    product_id            bigint NOT NULL REFERENCES inventory.products (id),
    quantity_on_hand      numeric(18, 3) NOT NULL DEFAULT 0,
    total_value           numeric(18, 4) NOT NULL DEFAULT 0,
    -- Stored separately from total_value so a zero-quantity reset never
    -- discards the last real cost figure (architecture section 3.C:
    -- "last_known_wac remains stored separately to prevent rounding
    -- residuals from leaving dangling values").
    last_known_wac        numeric(18, 6) NOT NULL DEFAULT 0,
    updated_at            timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT warehouse_stock_scope_unique UNIQUE (warehouse_id, product_id),
    CONSTRAINT warehouse_stock_quantity_non_negative CHECK (quantity_on_hand >= 0),
    CONSTRAINT warehouse_stock_value_non_negative CHECK (total_value >= 0),
    CONSTRAINT warehouse_stock_wac_non_negative CHECK (last_known_wac >= 0),
    -- Zero-quantity safeguard (architecture section 3.C): no positive
    -- inventory value may exist against zero units.
    CONSTRAINT warehouse_stock_zero_quantity_zero_value
        CHECK (quantity_on_hand > 0 OR total_value = 0)
);

CREATE TRIGGER warehouse_stock_set_updated_at
    BEFORE UPDATE ON inventory.warehouse_stock
    FOR EACH ROW
    EXECUTE FUNCTION core.set_updated_at();

-- Append-only, immutable movement history. Every row is a signed delta pair
-- (quantity_delta, inventory_value_delta) plus the resulting balance
-- snapshot, matching architecture section 3.C's ledger model. No `UPDATE`
-- path exists on purpose: corrections are new rows, never edits.
CREATE TABLE inventory.stock_ledger (
    id                         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    warehouse_id               bigint NOT NULL REFERENCES inventory.warehouses (id),
    product_id                 bigint NOT NULL REFERENCES inventory.products (id),
    movement_type               text NOT NULL,
    quantity_delta              numeric(18, 3) NOT NULL,
    inventory_value_delta       numeric(18, 4) NOT NULL,
    resulting_quantity_on_hand  numeric(18, 3) NOT NULL,
    resulting_total_value       numeric(18, 4) NOT NULL,
    -- Generic, ledger-agnostic backreference (e.g. to a future
    -- sales.sale_lines row) — deliberately not a foreign key yet: the
    -- referenced posting tables/functions do not exist in this slice, and a
    -- premature FK would either point nowhere or hard-couple the ledger to
    -- one specific source before the posting matrix is designed.
    reference_type              text,
    reference_id                bigint,
    created_at                  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT stock_ledger_movement_type_valid
        CHECK (movement_type IN ('RECEIPT', 'ISSUE', 'ADJUSTMENT', 'COST_ONLY')),
    -- Cost-only adjustments (quantity_delta = 0) are only meaningful while
    -- quantity_on_hand > 0 (architecture section 3.C).
    CONSTRAINT stock_ledger_cost_only_requires_stock
        CHECK (quantity_delta <> 0 OR resulting_quantity_on_hand > 0),
    CONSTRAINT stock_ledger_resulting_quantity_non_negative
        CHECK (resulting_quantity_on_hand >= 0),
    CONSTRAINT stock_ledger_resulting_value_non_negative
        CHECK (resulting_total_value >= 0),
    CONSTRAINT stock_ledger_zero_quantity_zero_value
        CHECK (resulting_quantity_on_hand > 0 OR resulting_total_value = 0)
);

-- Immutability: a stock movement is a fact of history the moment it is
-- written — there is no draft phase for ledger rows (unlike journal entries
-- or cash sales, which have an explicit DRAFT status before posting).
CREATE FUNCTION inventory.forbid_stock_ledger_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'inventory.stock_ledger rows are immutable and append-only'
        USING ERRCODE = '0A000';
END;
$$;

CREATE TRIGGER stock_ledger_forbid_update
    BEFORE UPDATE ON inventory.stock_ledger
    FOR EACH ROW
    EXECUTE FUNCTION inventory.forbid_stock_ledger_mutation();

CREATE TRIGGER stock_ledger_forbid_delete
    BEFORE DELETE ON inventory.stock_ledger
    FOR EACH ROW
    EXECUTE FUNCTION inventory.forbid_stock_ledger_mutation();

REVOKE ALL ON inventory.warehouse_stock FROM PUBLIC;
REVOKE ALL ON inventory.stock_ledger FROM PUBLIC;
REVOKE ALL ON FUNCTION inventory.forbid_stock_ledger_mutation() FROM PUBLIC;

-- Task requirement: "stockiha_runtime must not directly insert, update, or
-- delete: stock balances, stock ledger". Read-only until a future posting
-- function (e.g. `inventory.confirm_stock_adjustment`, Slice 2) is the sole
-- writer.
GRANT SELECT ON inventory.warehouse_stock TO stockiha_runtime;
GRANT SELECT ON inventory.stock_ledger TO stockiha_runtime;

RESET ROLE;
