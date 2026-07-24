-- S2-003: Zero-quantity safeguards and rounding residual handlers
--
-- Extends inventory.movements with RESIDUAL_CLEARANCE type to track explicit
-- clearance of sub-centime inventory values when quantity reaches zero.
-- Enforces the zero-quantity invariant: quantity = 0 => value = 0 (no dangling residuals).
--
-- Monetary scale: all calculations use exact decimal(18,4) for inventory value
-- and decimal(14,2) for journals (2-decimal minor unit = 0.01 DZD).
-- Residual threshold: 0.01 (smallest unit that can't be represented in journal).
-- Residual values < 0.01 are cleared implicitly; values >= 0.01 block posting.
SET ROLE stockiha_owner;

-- Extend movement type vocabulary to include residual clearance.
ALTER TABLE inventory.movements DROP CONSTRAINT movements_movement_type_valid;
ALTER TABLE inventory.movements ADD CONSTRAINT movements_movement_type_valid
    CHECK (movement_type IN ('RECEIPT', 'ISSUE', 'ADJUSTMENT', 'COST_ONLY', 'RESIDUAL_CLEARANCE'));

-- Update the cost-only constraint to permit RESIDUAL_CLEARANCE at zero quantity:
-- Residual clearance is the ONLY operation permitted with qty_delta=0 at resulting_qty=0.
ALTER TABLE inventory.movements DROP CONSTRAINT movements_cost_only_requires_stock;
ALTER TABLE inventory.movements ADD CONSTRAINT movements_cost_only_requires_stock
    CHECK (
        (quantity_delta <> 0 OR resulting_quantity_on_hand > 0)
        OR
        (movement_type = 'RESIDUAL_CLEARANCE' AND quantity_delta = 0 AND resulting_quantity_on_hand = 0)
    );

-- Audit table: one row per detection + clearance of a rounding residual.
-- Linked to the posting that brought quantity to zero, and to the residual clearing movement.
CREATE TABLE inventory.residual_clearances (
    id                          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    warehouse_id                bigint NOT NULL REFERENCES inventory.warehouses (id),
    variant_id                  bigint NOT NULL REFERENCES catalog.product_variants (id),
    -- The posting that caused qty to reach exactly zero (e.g., a CASH_SALE_LINE, STOCK_ADJUSTMENT).
    source_movement_id          bigint NOT NULL UNIQUE REFERENCES inventory.movements (id),
    -- The detected residual inventory value (in DZD, decimal(18,4) scale).
    -- Always in the range 0.0001 to 0.0099 (sub-centime).
    detected_residual_value     numeric(18, 4) NOT NULL,
    -- The RESIDUAL_CLEARANCE movement that cleared it (quantity_delta=0, value_delta=-residual, resulting_qty=0, resulting_value=0).
    clearing_movement_id        bigint NOT NULL UNIQUE REFERENCES inventory.movements (id),
    -- Optional journal entry that reversed the residual (e.g., debit INVENTORY_ADJUSTMENT_LOSS / credit INVENTORY_MERCHANDISE).
    clearing_journal_document_id bigint UNIQUE REFERENCES finance.journal_entries (document_id),
    created_at                  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT residual_clearances_detected_positive CHECK (detected_residual_value > 0),
    CONSTRAINT residual_clearances_detected_sub_centime CHECK (detected_residual_value < 0.01)
);

-- Immutability: residual clearance audit records are historical facts.
CREATE FUNCTION inventory.forbid_residual_clearance_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'inventory.residual_clearances rows are immutable'
        USING ERRCODE = '0A000';
END;
$$;

CREATE TRIGGER residual_clearances_forbid_update
    BEFORE UPDATE ON inventory.residual_clearances
    FOR EACH ROW
    EXECUTE FUNCTION inventory.forbid_residual_clearance_mutation();

CREATE TRIGGER residual_clearances_forbid_delete
    BEFORE DELETE ON inventory.residual_clearances
    FOR EACH ROW
    EXECUTE FUNCTION inventory.forbid_residual_clearance_mutation();

-- Helper: called DURING a posting transaction to detect and clear residuals
-- when a position moves to zero quantity.
-- Returns the journal document ID if a residual was cleared and journalized, or NULL.
CREATE FUNCTION inventory._handle_residual_at_zero_quantity(
    p_warehouse_id bigint,
    p_variant_id bigint,
    p_source_movement_id bigint,
    p_remaining_value numeric,
    p_fiscal_period_id bigint,
    p_document_date date
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_residual numeric(18, 4);
    v_clearing_movement_id bigint;
    v_journal_document_id bigint;
    v_journal_entry_id bigint;
    v_fiscal_year integer;
    v_sequence bigint;
    v_document_number text;
BEGIN
    -- Only detect residuals if remaining value is non-zero but small (sub-centime).
    IF p_remaining_value <= 0 OR p_remaining_value >= 0.01 THEN
        RETURN NULL;
    END IF;

    -- Residual detected: record it and clear it atomically.
    v_residual := p_remaining_value;

    -- Create a RESIDUAL_CLEARANCE movement with the opposite sign to zero the position.
    INSERT INTO inventory.movements (
        warehouse_id, variant_id, movement_type, quantity_delta,
        inventory_value_delta, resulting_quantity_on_hand,
        resulting_total_value, reference_type, reference_id
    ) VALUES (
        p_warehouse_id, p_variant_id, 'RESIDUAL_CLEARANCE', 0,
        -v_residual, 0, 0,
        'RESIDUAL_CLEARANCE', p_source_movement_id
    ) RETURNING id INTO v_clearing_movement_id;

    -- Create the residual clearance audit record.
    INSERT INTO inventory.residual_clearances (
        warehouse_id, variant_id, source_movement_id,
        detected_residual_value, clearing_movement_id
    ) VALUES (
        p_warehouse_id, p_variant_id, p_source_movement_id,
        v_residual, v_clearing_movement_id
    );

    -- Optionally journal the residual clearance (2-decimal scale).
    -- Only journal if the rounded 2-decimal amount is material (>= 0.01).
    -- Sub-centime values (0.0001 - 0.0099) typically do not journal,
    -- but we include the logic for transparency.
    IF round(v_residual, 2) > 0 THEN
        SELECT extract(year FROM starts_on)::integer
        INTO v_fiscal_year
        FROM finance.fiscal_periods
        WHERE id = p_fiscal_period_id;

        INSERT INTO core.business_documents (
            document_type, document_date, fiscal_period_id, fiscal_year
        ) VALUES (
            'JOURNAL_ENTRY', p_document_date, p_fiscal_period_id, v_fiscal_year
        ) RETURNING id INTO v_journal_entry_id;

        INSERT INTO finance.journal_entries (
            document_id, description, source_type, source_id
        ) VALUES (
            v_journal_entry_id, 'Rounding residual clearance',
            'RESIDUAL_CLEARANCE', v_clearing_movement_id
        );

        -- Debit INVENTORY_ADJUSTMENT_LOSS, credit INVENTORY_MERCHANDISE to reverse the residual.
        INSERT INTO finance.journal_lines (
            document_id, line_number, account_code, debit, credit
        ) VALUES
            (v_journal_entry_id, 1, 'INVENTORY_ADJUSTMENT_LOSS', round(v_residual, 2), 0),
            (v_journal_entry_id, 2, 'INVENTORY_MERCHANDISE', 0, round(v_residual, 2));

        v_sequence := core.claim_next_document_number('JOURNAL_ENTRY', v_fiscal_year);
        v_document_number := 'JE-' || v_fiscal_year || '-' || lpad(v_sequence::text, 6, '0');
        UPDATE core.business_documents
        SET status = 'POSTED', sequence_number = v_sequence,
            document_number = v_document_number, posted_at = now()
        WHERE id = v_journal_entry_id;

        UPDATE inventory.residual_clearances
        SET clearing_journal_document_id = v_journal_entry_id
        WHERE clearing_movement_id = v_clearing_movement_id;

        RETURN v_journal_entry_id;
    END IF;

    RETURN NULL;
END;
$$;

REVOKE ALL ON inventory.residual_clearances FROM PUBLIC;
REVOKE ALL ON FUNCTION inventory.forbid_residual_clearance_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION inventory._handle_residual_at_zero_quantity(bigint, bigint, bigint, numeric, bigint, date) FROM PUBLIC;

GRANT SELECT ON inventory.residual_clearances TO stockiha_runtime;

RESET ROLE;
