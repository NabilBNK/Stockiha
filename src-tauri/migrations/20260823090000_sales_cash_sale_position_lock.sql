-- WS-F: close the oversell race in sales.confirm_cash_sale (F-POS-001).
--
-- The function read inventory.positions with a bare SELECT, checked
-- sufficiency, and then wrote an absolute quantity_on_hand. Under READ
-- COMMITTED two concurrent cash sales of the last unit both read the pre-sale
-- quantity from their own snapshots, both pass `v_qty_on_hand < v_quantity`,
-- and the second UPDATE re-evaluates only its WHERE clause before writing the
-- value it computed from the stale read. Both sales commit and one unit of
-- stock is sold twice. `positions_quantity_non_negative` does not fire,
-- because this is a lost update and the stored quantity never goes negative.
--
-- Every one of the other seven functions that write inventory.positions
-- already takes the row lock; this one did not, and its own step-7 comment
-- claimed it did ("validate, lock position, issue stock"), which is what the
-- omission looked like from the inside.
--
-- The fix adopts the pattern sales.confirm_credit_sale already uses: one bulk
-- `FOR UPDATE` over every touched position, ordered by variant_id, taken
-- before any document row is written. A per-line lock inside the loop would
-- also close the race but would let two multi-line sales deadlock when their
-- JSON line arrays name an overlapping variant set in different orders.
--
-- Nothing else about the function changes -- same signature, same validation
-- order, same COGS and residual handling, same journal, same numbering, same
-- idempotency contract, same SQLSTATEs. CREATE OR REPLACE preserves the
-- existing owner and EXECUTE grants.

SET ROLE stockiha_owner;

CREATE OR REPLACE FUNCTION sales.confirm_cash_sale(p_session_token text, p_request_id uuid, p_payload_hash bytea, p_cash_session_id bigint, p_warehouse_id bigint, p_fiscal_period_id bigint, p_document_date date, p_lines jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
    v_user_id bigint;
    v_cached_result bigint;
    v_session_status text;
    v_session_warehouse_id bigint;
    v_period_status text;
    v_period_start date;
    v_period_end date;
    v_fiscal_year integer;
    v_document_id bigint;
    v_journal_document_id bigint;
    v_line jsonb;
    v_line_number integer := 0;
    v_variant_id bigint;
    v_quantity numeric;
    v_unit_price numeric;
    v_variant_active boolean;
    v_variant_sku text;
    v_variant_name text;
    v_qty_on_hand numeric;
    v_position_value numeric;
    v_wac numeric;
    v_new_qty numeric;
    v_new_value numeric;
    v_unit_cost_snapshot numeric;
    v_line_total numeric;
    v_subtotal numeric(14, 2) := 0;
    v_total_cogs numeric(18, 4) := 0;
    v_gen_job bigint;
    v_print_job bigint;
    v_drawer_job bigint;
    v_movement_id bigint;
    v_residual_journal_id bigint;
    v_sequence bigint;
    v_document_number text;
BEGIN
    -- 1. Session + permission (never trusts a caller-supplied actor id).
    SELECT user_id INTO v_user_id
        FROM iam.resolve_session_with_permission(p_session_token, 'POST_CASH_SALE');

    -- 2. Idempotency.
    v_cached_result := core.reserve_idempotent_request(
        'sales.confirm_cash_sale', p_request_id, p_payload_hash
    );
    IF v_cached_result IS NOT NULL THEN
        RETURN v_cached_result;
    END IF;

    -- 3. Cash session validation.
    SELECT status, warehouse_id
        INTO v_session_status, v_session_warehouse_id
        FROM sales.cash_sessions
        WHERE id = p_cash_session_id
        FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'cash session % not found', p_cash_session_id USING ERRCODE = '22023';
    END IF;
    IF v_session_status <> 'OPEN' THEN
        RAISE EXCEPTION 'cash session % is not open', p_cash_session_id USING ERRCODE = '55000';
    END IF;
    IF v_session_warehouse_id <> p_warehouse_id THEN
        RAISE EXCEPTION 'warehouse mismatch between cash session and sale'
            USING ERRCODE = '22023';
    END IF;

    -- 4. Fiscal period must be OPEN and must contain the document date.
    SELECT status, starts_on, ends_on, extract(year FROM starts_on)::integer
        INTO v_period_status, v_period_start, v_period_end, v_fiscal_year
        FROM finance.fiscal_periods
        WHERE id = p_fiscal_period_id
        FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'fiscal period % not found', p_fiscal_period_id USING ERRCODE = '22023';
    END IF;
    IF v_period_status <> 'OPEN' THEN
        RAISE EXCEPTION 'fiscal period % is not open', p_fiscal_period_id USING ERRCODE = '55000';
    END IF;
    IF p_document_date < v_period_start OR p_document_date > v_period_end THEN
        RAISE EXCEPTION 'document date % is outside fiscal period %', p_document_date, p_fiscal_period_id
            USING ERRCODE = '22023';
    END IF;

    -- 5. Validate non-empty lines.
    IF p_lines IS NULL OR jsonb_array_length(p_lines) = 0 THEN
        RAISE EXCEPTION 'cash sale must have at least one line' USING ERRCODE = '22023';
    END IF;

    -- 5b. Lock all existing touched stock positions in deterministic order.
    -- Without this, two concurrent sales of the same last unit both read the
    -- pre-sale quantity, both pass the sufficiency check below, and the second
    -- UPDATE overwrites the first with a value computed from its stale read --
    -- a lost update that sells the same unit twice. The non-negative CHECK on
    -- inventory.positions cannot catch it because the stored quantity never
    -- goes negative. Ordering by variant_id keeps multi-line sales that touch
    -- an overlapping set of variants from deadlocking against each other.
    -- This mirrors sales.confirm_credit_sale, which already locks this way.
    PERFORM 1
    FROM inventory.positions
    WHERE warehouse_id = p_warehouse_id
      AND variant_id IN (
          SELECT DISTINCT (elem ->> 'variant_id')::bigint
          FROM jsonb_array_elements(p_lines) elem
      )
    ORDER BY variant_id
    FOR UPDATE;

    -- 6. Create sale header (DRAFT).
    INSERT INTO core.business_documents (document_type, document_date, fiscal_period_id, fiscal_year)
        VALUES ('CASH_SALE', p_document_date, p_fiscal_period_id, v_fiscal_year)
        RETURNING id INTO v_document_id;

    INSERT INTO sales.cash_sales (
        document_id, warehouse_id, subtotal, total_amount
    ) VALUES (
        v_document_id, p_warehouse_id, 0, 0
    );

    -- 7. Process each line: validate, issue stock, accumulate COGS. The
    -- positions rows are already locked by step 5b.
    FOR v_line IN SELECT jsonb_array_elements(p_lines)
    LOOP
        v_line_number := v_line_number + 1;
        v_variant_id := (v_line ->> 'variant_id')::bigint;
        v_quantity := (v_line ->> 'quantity')::numeric;
        v_unit_price := (v_line ->> 'unit_price')::numeric;

        IF v_variant_id IS NULL OR v_quantity IS NULL OR v_unit_price IS NULL THEN
            RAISE EXCEPTION 'line % is missing required fields', v_line_number
                USING ERRCODE = '22023';
        END IF;
        IF v_quantity <= 0 THEN
            RAISE EXCEPTION 'line % quantity must be positive', v_line_number
                USING ERRCODE = '22023';
        END IF;
        IF v_unit_price < 0 THEN
            RAISE EXCEPTION 'line % unit price must not be negative', v_line_number
                USING ERRCODE = '22023';
        END IF;

        SELECT pv.is_active, pv.sku, p.name
            INTO v_variant_active, v_variant_sku, v_variant_name
            FROM catalog.product_variants pv
            JOIN catalog.products p ON p.id = pv.product_id
            WHERE pv.id = v_variant_id;
        IF NOT FOUND OR NOT v_variant_active THEN
            RAISE EXCEPTION 'variant % is not found or is inactive', v_variant_id USING ERRCODE = '22023';
        END IF;

        SELECT quantity_on_hand, total_value, last_known_wac
            INTO v_qty_on_hand, v_position_value, v_wac
            FROM inventory.positions
            WHERE warehouse_id = p_warehouse_id AND variant_id = v_variant_id;
        IF NOT FOUND THEN
            v_qty_on_hand := 0;
            v_position_value := 0;
            v_wac := 0;
        END IF;

        -- Reject insufficient stock / prevent negative confirmed stock.
        IF v_qty_on_hand < v_quantity THEN
            RAISE EXCEPTION 'insufficient stock for variant % in warehouse % (have %, need %)',
                v_variant_id, p_warehouse_id, v_qty_on_hand, v_quantity
                USING ERRCODE = '55000';
        END IF;

        -- COGS uses warehouse-specific WAC at the moment of sale.
        v_unit_cost_snapshot := v_wac;
        v_line_total := round(v_quantity * v_unit_price, 2);
        v_subtotal := v_subtotal + v_line_total;
        v_total_cogs := v_total_cogs + round(v_quantity * v_unit_cost_snapshot, 4);

        v_new_qty := v_qty_on_hand - v_quantity;
        v_new_value := v_position_value - round(v_quantity * v_wac, 4);

        -- S2-003: Handle zero-quantity residuals.
        IF v_new_qty = 0 THEN
            -- Check for material residuals (>= 0.01).
            IF abs(v_new_value) >= 0.01 THEN
                RAISE EXCEPTION 'sale line % would result in a material unresolved inventory residual',
                    v_line_number USING ERRCODE = '55000';
            END IF;
        ELSIF v_new_value < 0 THEN
            RAISE EXCEPTION 'sale line % would make inventory value negative', v_line_number
                USING ERRCODE = '55000';
        END IF;

        UPDATE inventory.positions
            SET quantity_on_hand = v_new_qty,
                total_value = CASE WHEN v_new_qty = 0 THEN 0 ELSE v_new_value END
            WHERE warehouse_id = p_warehouse_id AND variant_id = v_variant_id;

        INSERT INTO inventory.movements (
            warehouse_id, variant_id, movement_type, quantity_delta, inventory_value_delta,
            resulting_quantity_on_hand, resulting_total_value, reference_type, reference_id
        ) VALUES (
            p_warehouse_id, v_variant_id, 'ISSUE', -v_quantity, -round(v_quantity * v_wac, 4),
            v_new_qty, CASE WHEN v_new_qty = 0 THEN 0 ELSE v_new_value END, 'CASH_SALE_LINE', v_document_id
        ) RETURNING id INTO v_movement_id;

        -- S2-003: Handle residual clearance if qty=0 with residual remaining.
        IF v_new_qty = 0 AND v_new_value <> 0 THEN
            v_residual_journal_id := inventory._handle_residual_at_zero_quantity(
                p_warehouse_id, v_variant_id, v_movement_id, v_new_value,
                p_fiscal_period_id, p_document_date
            );
        END IF;

        INSERT INTO sales.cash_sale_lines (
            document_id, line_number, variant_id, variant_sku_snapshot, variant_name_snapshot,
            quantity, unit_price, unit_cost_snapshot, line_total
        ) VALUES (
            v_document_id, v_line_number, v_variant_id, v_variant_sku, v_variant_name,
            v_quantity, v_unit_price, v_unit_cost_snapshot, v_line_total
        );
    END LOOP;

    -- 8. Finalize the sale header's exact totals (no tax/discount in this MVP scope).
    UPDATE sales.cash_sales SET subtotal = v_subtotal, total_amount = v_subtotal WHERE document_id = v_document_id;

    -- 9. Balanced journal — Cash sale revenue (Dr CASH / Cr SALES_REVENUE)
    -- plus COGS (Dr COGS / Cr INVENTORY_MERCHANDISE) when WAC-costed inventory was actually consumed.
    INSERT INTO core.business_documents (document_type, document_date, fiscal_period_id, fiscal_year)
        VALUES ('JOURNAL_ENTRY', p_document_date, p_fiscal_period_id, v_fiscal_year)
        RETURNING id INTO v_journal_document_id;

    INSERT INTO finance.journal_entries (document_id, description, source_type, source_id)
        VALUES (v_journal_document_id, 'Cash sale', 'CASH_SALE', v_document_id);

    INSERT INTO finance.journal_lines (document_id, line_number, account_code, debit, credit) VALUES
        (v_journal_document_id, 1, 'CASH', v_subtotal, 0),
        (v_journal_document_id, 2, 'SALES_REVENUE', 0, v_subtotal);

    IF v_total_cogs > 0 THEN
        INSERT INTO finance.journal_lines (document_id, line_number, account_code, debit, credit) VALUES
            (v_journal_document_id, 3, 'COGS', round(v_total_cogs, 2), 0),
            (v_journal_document_id, 4, 'INVENTORY_MERCHANDISE', 0, round(v_total_cogs, 2));
    END IF;

    -- 10. Allocate both official document numbers inside this same transaction, then post.
    v_sequence := core.claim_next_document_number('CASH_SALE', v_fiscal_year);
    v_document_number := 'VC-' || v_fiscal_year || '-' || lpad(v_sequence::text, 6, '0');
    UPDATE core.business_documents
        SET status = 'POSTED', sequence_number = v_sequence, document_number = v_document_number, posted_at = now()
        WHERE id = v_document_id;

    v_sequence := core.claim_next_document_number('JOURNAL_ENTRY', v_fiscal_year);
    v_document_number := 'JE-' || v_fiscal_year || '-' || lpad(v_sequence::text, 6, '0');
    UPDATE core.business_documents
        SET status = 'POSTED', sequence_number = v_sequence, document_number = v_document_number, posted_at = now()
        WHERE id = v_journal_document_id;

    -- 11. Record the cash movement.
    INSERT INTO cash.movements (cash_session_id, business_document_id, movement_type, amount)
        VALUES (p_cash_session_id, v_document_id, 'SALE', v_subtotal);

    -- 12. Enqueue document generation + receipt printing (inside this same transaction) and drawer pulse.
    SELECT generation_job_id, print_job_id INTO v_gen_job, v_print_job
        FROM documents.enqueue_receipt_jobs(v_document_id, 'cash_sale_receipt:' || v_document_id);

    v_drawer_job := cash.enqueue_drawer_job(
        p_cash_session_id, v_document_id, 'cash_sale_drawer:' || v_document_id
    );

    -- 13. Record the idempotent result and return it.
    PERFORM core.record_idempotent_result('sales.confirm_cash_sale', p_request_id, v_document_id);

    RETURN v_document_id;
END;
$function$

RESET ROLE;
