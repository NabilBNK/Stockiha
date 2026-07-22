-- S1-001 (corrected): cash sales and sale lines — cash-only scope (no
-- credit, returns, refunds, discounts, taxes, or split payments).
--
-- `sales.cash_sales` is now a thin subtype of `core.business_documents`:
-- its primary key IS the parent document's id (`document_id`), and it does
-- NOT duplicate document_type/status/document_date/fiscal_period_id/
-- document_number/posted_at — those live exclusively on the shared header.
-- Lines key off `variant_id` (catalog.product_variants) instead of a bare
-- product id, per the corrected inventory grain.
SET ROLE stockiha_owner;

CREATE TABLE sales.cash_sales (
    document_id    bigint PRIMARY KEY REFERENCES core.business_documents (id),
    warehouse_id   bigint NOT NULL REFERENCES inventory.warehouses (id),
    subtotal       numeric(14, 2) NOT NULL DEFAULT 0,
    total_amount   numeric(14, 2) NOT NULL DEFAULT 0,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT cash_sales_subtotal_non_negative CHECK (subtotal >= 0),
    CONSTRAINT cash_sales_total_non_negative CHECK (total_amount >= 0),
    -- Tax and discounts are out of scope for S1-001 (cash sales only), so the
    -- current invariant is exact equality — made explicit here rather than
    -- left as an unstated assumption. A future slice introducing tax/discount
    -- lines will relax this constraint deliberately, not by accident.
    CONSTRAINT cash_sales_total_matches_subtotal CHECK (total_amount = subtotal)
);

CREATE TABLE sales.cash_sale_lines (
    id                      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    document_id             bigint NOT NULL REFERENCES sales.cash_sales (document_id) ON DELETE CASCADE,
    line_number             integer NOT NULL,
    variant_id              bigint NOT NULL REFERENCES catalog.product_variants (id),
    -- Historical snapshots: a sale line must remain readable exactly as it
    -- was confirmed even if the variant is later renamed, re-priced, or its
    -- WAC moves (task requirement: "product identity, product code/name
    -- snapshot ..., quantity, unit price, cost snapshot ..., line total").
    variant_sku_snapshot    text NOT NULL,
    variant_name_snapshot   text NOT NULL,
    quantity                 numeric(18, 3) NOT NULL,
    unit_price               numeric(14, 2) NOT NULL,
    unit_cost_snapshot       numeric(18, 4) NOT NULL,
    line_total                numeric(14, 2) NOT NULL,
    created_at                timestamptz NOT NULL DEFAULT now(),
    updated_at                timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT cash_sale_lines_line_number_unique UNIQUE (document_id, line_number),
    CONSTRAINT cash_sale_lines_line_number_positive CHECK (line_number > 0),
    CONSTRAINT cash_sale_lines_quantity_positive CHECK (quantity > 0),
    CONSTRAINT cash_sale_lines_unit_price_non_negative CHECK (unit_price >= 0),
    CONSTRAINT cash_sale_lines_unit_cost_non_negative CHECK (unit_cost_snapshot >= 0),
    CONSTRAINT cash_sale_lines_line_total_non_negative CHECK (line_total >= 0),
    CONSTRAINT cash_sale_lines_line_total_matches_quantity_and_price
        CHECK (line_total = round(quantity * unit_price, 2))
);

CREATE TRIGGER cash_sales_set_updated_at
    BEFORE UPDATE ON sales.cash_sales
    FOR EACH ROW
    EXECUTE FUNCTION core.set_updated_at();

CREATE TRIGGER cash_sale_lines_set_updated_at
    BEFORE UPDATE ON sales.cash_sale_lines
    FOR EACH ROW
    EXECUTE FUNCTION core.set_updated_at();

-- Immutability: once the parent business document is POSTED or REVERSED,
-- neither the cash-sale subtype row nor its lines can be updated or
-- deleted. Unlike `core.business_documents` itself, there is no controlled
-- exception here — a reversal is a brand-new document + new subtype row,
-- never a mutation of the original sale's amounts or lines.
CREATE FUNCTION sales.forbid_posted_cash_sale_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_status text;
BEGIN
    SELECT status INTO v_status
        FROM core.business_documents
        WHERE id = COALESCE(NEW.document_id, OLD.document_id);
    IF v_status IN ('POSTED', 'REVERSED') THEN
        RAISE EXCEPTION 'cash sales of a posted or reversed business document are immutable'
            USING ERRCODE = '0A000';
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER cash_sales_forbid_posted_update
    BEFORE UPDATE ON sales.cash_sales
    FOR EACH ROW
    EXECUTE FUNCTION sales.forbid_posted_cash_sale_mutation();

CREATE TRIGGER cash_sales_forbid_posted_delete
    BEFORE DELETE ON sales.cash_sales
    FOR EACH ROW
    EXECUTE FUNCTION sales.forbid_posted_cash_sale_mutation();

CREATE FUNCTION sales.forbid_posted_cash_sale_line_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_status text;
BEGIN
    -- `cash_sale_lines.document_id` is transitively the same value as
    -- `core.business_documents.id` (it references `cash_sales.document_id`,
    -- which itself references `business_documents.id`), so this can look
    -- the status up directly without an intermediate join through
    -- `sales.cash_sales`.
    SELECT status INTO v_status
        FROM core.business_documents
        WHERE id = COALESCE(NEW.document_id, OLD.document_id);
    IF v_status IN ('POSTED', 'REVERSED') THEN
        RAISE EXCEPTION 'lines of a posted or reversed cash sale are immutable'
            USING ERRCODE = '0A000';
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER cash_sale_lines_forbid_posted_update
    BEFORE UPDATE ON sales.cash_sale_lines
    FOR EACH ROW
    EXECUTE FUNCTION sales.forbid_posted_cash_sale_line_mutation();

CREATE TRIGGER cash_sale_lines_forbid_posted_delete
    BEFORE DELETE ON sales.cash_sale_lines
    FOR EACH ROW
    EXECUTE FUNCTION sales.forbid_posted_cash_sale_line_mutation();

REVOKE ALL ON sales.cash_sales FROM PUBLIC;
REVOKE ALL ON sales.cash_sale_lines FROM PUBLIC;
REVOKE ALL ON FUNCTION sales.forbid_posted_cash_sale_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION sales.forbid_posted_cash_sale_line_mutation() FROM PUBLIC;

-- Task requirement: "stockiha_runtime must not directly insert, update, or
-- delete: ... posted sales and sale lines". No posting function exists yet
-- in this slice, so read-only is the correct posture for the whole table for
-- now (not just the posted subset) — there is no sanctioned write path at
-- all until a future `sales.confirm_cash_sale` (or equivalent draft-editing
-- function) is introduced.
GRANT SELECT ON sales.cash_sales TO stockiha_runtime;
GRANT SELECT ON sales.cash_sale_lines TO stockiha_runtime;

RESET ROLE;
