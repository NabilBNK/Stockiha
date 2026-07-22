-- S1-001: cash sales and sale lines — cash-only scope (no credit, returns,
-- refunds, discounts, taxes, or split payments; those arrive in later
-- slices per CURRENT_SLICE.md / final-architecture.md section 4).
SET ROLE stockiha_owner;

-- Two-state lifecycle for this slice: DRAFT (still editable, no official
-- number per architecture section 3.D-bis) and CONFIRMED (posted, immutable,
-- carries an atomically-claimed document_number). A future posting function
-- (`sales.confirm_cash_sale`) is the only path from DRAFT to CONFIRMED; it is
-- explicitly out of scope for S1-001, so no such function exists yet — this
-- migration only lays down the schema that function will operate on.
CREATE TABLE sales.cash_sales (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    warehouse_id      bigint NOT NULL REFERENCES inventory.warehouses (id),
    fiscal_period_id  bigint NOT NULL REFERENCES core.fiscal_periods (id),
    document_number   text,
    status            text NOT NULL DEFAULT 'DRAFT',
    sale_date         date NOT NULL,
    subtotal          numeric(14, 2) NOT NULL DEFAULT 0,
    total_amount      numeric(14, 2) NOT NULL DEFAULT 0,
    confirmed_at      timestamptz,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT cash_sales_status_valid CHECK (status IN ('DRAFT', 'CONFIRMED')),
    CONSTRAINT cash_sales_subtotal_non_negative CHECK (subtotal >= 0),
    CONSTRAINT cash_sales_total_non_negative CHECK (total_amount >= 0),
    -- Tax and discounts are out of scope for S1-001 (cash sales only), so the
    -- current invariant is exact equality — made explicit here rather than
    -- left as an unstated assumption. A future slice introducing tax/discount
    -- lines will relax this constraint deliberately, not by accident.
    CONSTRAINT cash_sales_total_matches_subtotal CHECK (total_amount = subtotal),
    CONSTRAINT cash_sales_document_number_set_iff_confirmed
        CHECK (
            (status = 'DRAFT' AND document_number IS NULL AND confirmed_at IS NULL)
            OR (status = 'CONFIRMED' AND document_number IS NOT NULL AND confirmed_at IS NOT NULL)
        ),
    CONSTRAINT cash_sales_document_number_unique UNIQUE (document_number)
);

CREATE TABLE sales.sale_lines (
    id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    cash_sale_id          bigint NOT NULL REFERENCES sales.cash_sales (id) ON DELETE CASCADE,
    line_number           integer NOT NULL,
    product_id            bigint NOT NULL REFERENCES inventory.products (id),
    -- Historical snapshots: a sale line must remain readable exactly as it
    -- was confirmed even if the product is later renamed, re-priced, or its
    -- WAC moves (task requirement: "product identity, product code/name
    -- snapshot ..., quantity, unit price, cost snapshot ..., line total").
    product_sku_snapshot  text NOT NULL,
    product_name_snapshot text NOT NULL,
    quantity               numeric(18, 3) NOT NULL,
    unit_price             numeric(14, 2) NOT NULL,
    unit_cost_snapshot     numeric(18, 4) NOT NULL,
    line_total             numeric(14, 2) NOT NULL,
    created_at             timestamptz NOT NULL DEFAULT now(),
    updated_at             timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT sale_lines_line_number_unique UNIQUE (cash_sale_id, line_number),
    CONSTRAINT sale_lines_line_number_positive CHECK (line_number > 0),
    CONSTRAINT sale_lines_quantity_positive CHECK (quantity > 0),
    CONSTRAINT sale_lines_unit_price_non_negative CHECK (unit_price >= 0),
    CONSTRAINT sale_lines_unit_cost_non_negative CHECK (unit_cost_snapshot >= 0),
    CONSTRAINT sale_lines_line_total_non_negative CHECK (line_total >= 0),
    CONSTRAINT sale_lines_line_total_matches_quantity_and_price
        CHECK (line_total = round(quantity * unit_price, 2))
);

CREATE TRIGGER cash_sales_set_updated_at
    BEFORE UPDATE ON sales.cash_sales
    FOR EACH ROW
    EXECUTE FUNCTION core.set_updated_at();

CREATE TRIGGER sale_lines_set_updated_at
    BEFORE UPDATE ON sales.sale_lines
    FOR EACH ROW
    EXECUTE FUNCTION core.set_updated_at();

-- Immutability: once CONFIRMED, a cash sale and its lines can never be
-- updated or deleted (task requirement: sale lines "preserve required
-- historical snapshots"; architecture-wide rule: posted documents are
-- immutable). DRAFT rows remain freely editable/deletable while being built.
CREATE FUNCTION sales.forbid_confirmed_cash_sale_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.status = 'CONFIRMED' THEN
        RAISE EXCEPTION 'confirmed cash sales are immutable' USING ERRCODE = '0A000';
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER cash_sales_forbid_confirmed_update
    BEFORE UPDATE ON sales.cash_sales
    FOR EACH ROW
    EXECUTE FUNCTION sales.forbid_confirmed_cash_sale_mutation();

CREATE TRIGGER cash_sales_forbid_confirmed_delete
    BEFORE DELETE ON sales.cash_sales
    FOR EACH ROW
    EXECUTE FUNCTION sales.forbid_confirmed_cash_sale_mutation();

CREATE FUNCTION sales.forbid_confirmed_sale_line_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_status text;
BEGIN
    SELECT status INTO v_status FROM sales.cash_sales WHERE id = OLD.cash_sale_id;
    IF v_status = 'CONFIRMED' THEN
        RAISE EXCEPTION 'sale lines of a confirmed cash sale are immutable'
            USING ERRCODE = '0A000';
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER sale_lines_forbid_confirmed_update
    BEFORE UPDATE ON sales.sale_lines
    FOR EACH ROW
    EXECUTE FUNCTION sales.forbid_confirmed_sale_line_mutation();

CREATE TRIGGER sale_lines_forbid_confirmed_delete
    BEFORE DELETE ON sales.sale_lines
    FOR EACH ROW
    EXECUTE FUNCTION sales.forbid_confirmed_sale_line_mutation();

REVOKE ALL ON sales.cash_sales FROM PUBLIC;
REVOKE ALL ON sales.sale_lines FROM PUBLIC;
REVOKE ALL ON FUNCTION sales.forbid_confirmed_cash_sale_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION sales.forbid_confirmed_sale_line_mutation() FROM PUBLIC;

-- Task requirement: "stockiha_runtime must not directly insert, update, or
-- delete: ... posted sales and sale lines". No posting function exists yet
-- in this slice, so read-only is the correct posture for the whole table for
-- now (not just the confirmed subset) — there is no sanctioned write path at
-- all until `sales.confirm_cash_sale` (or an equivalent draft-editing
-- function) is introduced.
GRANT SELECT ON sales.cash_sales TO stockiha_runtime;
GRANT SELECT ON sales.sale_lines TO stockiha_runtime;

RESET ROLE;
