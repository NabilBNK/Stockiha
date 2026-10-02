-- Migration: 20261002093000_ws_o_4_sell_by_pack.sql
-- Workstream WS-O-4: Sell by the box (Pack sales on till, line expansion, line totals by price basis)

SET ROLE stockiha_owner;

-- ============================================================================
-- 1. Add pack columns and basis-aware constraints to cash and credit sale lines
-- ============================================================================

ALTER TABLE sales.cash_sale_lines
    ADD COLUMN price_basis             text          NOT NULL DEFAULT 'BASE',
    ADD COLUMN pack_unit_id            bigint        NULL REFERENCES catalog.units (id),
    ADD COLUMN pack_unit_name_snapshot text          NULL,
    ADD COLUMN pack_factor_snapshot    numeric(20,6) NULL,
    ADD COLUMN pack_quantity           numeric(18,3) NULL,
    ADD COLUMN pack_price              numeric(14,2) NULL,
    ADD COLUMN list_price_snapshot     numeric(14,2) NULL,
    ADD COLUMN price_overridden        boolean       NOT NULL DEFAULT false;

ALTER TABLE sales.cash_sale_lines
    DROP CONSTRAINT IF EXISTS cash_sale_lines_line_total_matches_quantity_and_price;

ALTER TABLE sales.cash_sale_lines
    ADD CONSTRAINT cash_sale_lines_price_basis_valid
        CHECK (price_basis IN ('BASE','PACK','PACK_RATE')),
    ADD CONSTRAINT cash_sale_lines_pack_columns_consistent CHECK (
        (price_basis = 'BASE'
            AND pack_unit_id IS NULL AND pack_unit_name_snapshot IS NULL
            AND pack_factor_snapshot IS NULL AND pack_quantity IS NULL AND pack_price IS NULL)
     OR (price_basis = 'PACK'
            AND pack_unit_id IS NOT NULL AND pack_unit_name_snapshot IS NOT NULL
            AND pack_factor_snapshot > 1 AND pack_price >= 0
            AND pack_quantity >= 1 AND pack_quantity = trunc(pack_quantity)
            AND quantity = pack_quantity * pack_factor_snapshot)
     OR (price_basis = 'PACK_RATE'
            AND pack_unit_id IS NOT NULL AND pack_unit_name_snapshot IS NOT NULL
            AND pack_factor_snapshot > 1 AND pack_price >= 0
            AND pack_quantity IS NULL AND quantity < pack_factor_snapshot)),
    ADD CONSTRAINT cash_sale_lines_line_total_matches_by_basis CHECK (
        (price_basis = 'PACK' AND line_total = round(pack_quantity * pack_price, 2))
     OR (price_basis <> 'PACK' AND line_total = round(quantity * unit_price, 2)));

ALTER TABLE sales.credit_sale_lines
    ADD COLUMN price_basis             text          NOT NULL DEFAULT 'BASE',
    ADD COLUMN pack_unit_id            bigint        NULL REFERENCES catalog.units (id),
    ADD COLUMN pack_unit_name_snapshot text          NULL,
    ADD COLUMN pack_factor_snapshot    numeric(20,6) NULL,
    ADD COLUMN pack_quantity           numeric(18,3) NULL,
    ADD COLUMN pack_price              numeric(14,2) NULL,
    ADD COLUMN list_price_snapshot     numeric(14,2) NULL,
    ADD COLUMN price_overridden        boolean       NOT NULL DEFAULT false;

ALTER TABLE sales.credit_sale_lines
    DROP CONSTRAINT IF EXISTS credit_sale_lines_total_matches;

ALTER TABLE sales.credit_sale_lines
    ADD CONSTRAINT credit_sale_lines_price_basis_valid
        CHECK (price_basis IN ('BASE','PACK','PACK_RATE')),
    ADD CONSTRAINT credit_sale_lines_pack_columns_consistent CHECK (
        (price_basis = 'BASE'
            AND pack_unit_id IS NULL AND pack_unit_name_snapshot IS NULL
            AND pack_factor_snapshot IS NULL AND pack_quantity IS NULL AND pack_price IS NULL)
     OR (price_basis = 'PACK'
            AND pack_unit_id IS NOT NULL AND pack_unit_name_snapshot IS NOT NULL
            AND pack_factor_snapshot > 1 AND pack_price >= 0
            AND pack_quantity >= 1 AND pack_quantity = trunc(pack_quantity)
            AND quantity = pack_quantity * pack_factor_snapshot)
     OR (price_basis = 'PACK_RATE'
            AND pack_unit_id IS NOT NULL AND pack_unit_name_snapshot IS NOT NULL
            AND pack_factor_snapshot > 1 AND pack_price >= 0
            AND pack_quantity IS NULL AND quantity < pack_factor_snapshot)),
    ADD CONSTRAINT credit_sale_lines_line_total_matches_by_basis CHECK (
        (price_basis = 'PACK' AND line_total = round(pack_quantity * pack_price, 2))
     OR (price_basis <> 'PACK' AND line_total = round(quantity * unit_price, 2)));

-- ============================================================================
-- 2. Private helper: sales._expand_sale_lines(p_lines jsonb)
-- ============================================================================

CREATE OR REPLACE FUNCTION sales._expand_sale_lines(p_lines jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_expanded jsonb := '[]'::jsonb;
    v_elem jsonb;
    v_i integer := 0;
    v_var_id bigint;
    v_sale_unit text;
    v_pack_unit_id bigint;
    v_pack_qty numeric;
    v_extra_qty numeric;
    v_pack_price numeric(14,2);
    v_base_unit_id bigint;
    v_base_unit_name text;
    v_base_is_whole boolean;
    v_factor numeric(20,6);
    v_pack_sale_price numeric(14,2);
    v_pack_active boolean;
    v_pack_unit_name text;
    v_base_qty numeric(18,3);
    v_rate numeric(14,2);
    v_list_rate numeric(14,2);
    v_overridden boolean;
    v_unit_price numeric(14,2);
    v_list_price numeric(14,2);
BEGIN
    IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
        RETURN p_lines;
    END IF;

    FOR v_elem IN SELECT * FROM jsonb_array_elements(p_lines)
    LOOP
        v_i := v_i + 1;

        -- No sale_unit key -> base line
        IF NOT (v_elem ? 'sale_unit') THEN
            BEGIN
                v_var_id := (v_elem->>'variant_id')::bigint;
            EXCEPTION WHEN OTHERS THEN
                v_var_id := NULL;
            END;

            v_list_price := NULL;
            IF v_var_id IS NOT NULL THEN
                SELECT sale_price INTO v_list_price
                FROM catalog.product_variants
                WHERE id = v_var_id;
            END IF;

            BEGIN
                v_unit_price := (v_elem->>'unit_price')::numeric(14,2);
            EXCEPTION WHEN OTHERS THEN
                v_unit_price := NULL;
            END;

            v_overridden := (v_unit_price IS NOT NULL AND v_list_price IS NOT NULL AND v_unit_price <> v_list_price);

            v_expanded := v_expanded || jsonb_build_array(
                v_elem || jsonb_build_object(
                    'price_basis', 'BASE',
                    'list_price', v_list_price,
                    'price_overridden', v_overridden
                )
            );
        ELSE
            v_sale_unit := v_elem->>'sale_unit';
            IF v_sale_unit <> 'PACK' THEN
                RAISE EXCEPTION 'SALE_LINE_INVALID: line %: unknown sale_unit %', v_i, v_sale_unit USING ERRCODE = '22023';
            END IF;

            BEGIN
                v_var_id := (v_elem->>'variant_id')::bigint;
                v_pack_unit_id := (v_elem->>'pack_unit_id')::bigint;
                v_pack_qty := (v_elem->>'pack_quantity')::numeric;
                v_pack_price := (v_elem->>'pack_price')::numeric;
                IF v_elem ? 'extra_quantity' AND (v_elem->>'extra_quantity') IS NOT NULL AND (v_elem->>'extra_quantity') <> '' THEN
                    v_extra_qty := (v_elem->>'extra_quantity')::numeric;
                ELSE
                    v_extra_qty := 0;
                END IF;
            EXCEPTION WHEN OTHERS THEN
                RAISE EXCEPTION 'SALE_LINE_INVALID: line %: invalid or unparseable field values', v_i USING ERRCODE = '22023';
            END;

            IF v_var_id IS NULL OR v_pack_unit_id IS NULL OR v_pack_qty IS NULL OR v_pack_price IS NULL THEN
                RAISE EXCEPTION 'SALE_LINE_INVALID: line %: missing required pack fields', v_i USING ERRCODE = '22023';
            END IF;

            SELECT u.id, u.name, (NOT u.allows_fractions)
            INTO v_base_unit_id, v_base_unit_name, v_base_is_whole
            FROM catalog.product_variants pv
            JOIN catalog.products p ON p.id = pv.product_id
            JOIN catalog.units u ON u.id = p.unit_id
            WHERE pv.id = v_var_id;

            IF NOT FOUND THEN
                RAISE EXCEPTION 'SALE_LINE_INVALID: line %: variant % not found', v_i, v_var_id USING ERRCODE = '22023';
            END IF;

            SELECT vu.conversion_factor, vu.sale_price, vu.is_active, u.name
            INTO v_factor, v_pack_sale_price, v_pack_active, v_pack_unit_name
            FROM catalog.variant_units vu
            JOIN catalog.units u ON u.id = vu.unit_id
            WHERE vu.variant_id = v_var_id AND vu.unit_id = v_pack_unit_id;

            IF NOT FOUND OR NOT v_pack_active OR v_factor <= 1 OR v_pack_sale_price IS NULL THEN
                RAISE EXCEPTION 'SALE_PACK_UNAVAILABLE: line %: pack % unavailable for variant %', v_i, v_pack_unit_id, v_var_id USING ERRCODE = '22023';
            END IF;

            IF v_pack_qty < 1 OR v_pack_qty <> trunc(v_pack_qty) THEN
                RAISE EXCEPTION 'SALE_PACK_QTY_INVALID: line %: pack quantity % must be a whole number >= 1', v_i, v_pack_qty USING ERRCODE = '22023';
            END IF;

            IF v_extra_qty < 0 OR v_extra_qty >= v_factor OR v_extra_qty <> round(v_extra_qty, 3)
               OR (v_base_is_whole AND v_extra_qty <> trunc(v_extra_qty)) THEN
                RAISE EXCEPTION 'SALE_EXTRA_QTY_INVALID: line %: extra quantity % is invalid', v_i, v_extra_qty USING ERRCODE = '22023';
            END IF;

            PERFORM catalog._validate_amount(v_pack_price, 'SALE_PACK_PRICE_INVALID');

            v_base_qty := v_pack_qty * v_factor;
            IF v_base_qty <> round(v_base_qty, 3) THEN
                RAISE EXCEPTION 'SALE_PACK_QTY_INVALID: line %: base quantity % exceeds 3 decimals', v_i, v_base_qty USING ERRCODE = '22023';
            END IF;

            v_rate := catalog._pack_rate(v_pack_price, v_factor, 0);
            v_list_rate := catalog._pack_rate(v_pack_sale_price, v_factor, 0);
            v_overridden := (v_pack_price <> v_pack_sale_price);

            v_expanded := v_expanded || jsonb_build_array(
                jsonb_build_object(
                    'variant_id', v_var_id,
                    'quantity', v_base_qty,
                    'unit_price', round(v_pack_price / v_factor, 2),
                    'line_total', round(v_pack_qty * v_pack_price, 2),
                    'price_basis', 'PACK',
                    'pack_unit_id', v_pack_unit_id,
                    'pack_unit_name', v_pack_unit_name,
                    'pack_factor', v_factor,
                    'pack_quantity', v_pack_qty,
                    'pack_price', v_pack_price,
                    'list_price', v_pack_sale_price,
                    'price_overridden', v_overridden
                )
            );

            IF v_extra_qty > 0 THEN
                v_expanded := v_expanded || jsonb_build_array(
                    jsonb_build_object(
                        'variant_id', v_var_id,
                        'quantity', v_extra_qty,
                        'unit_price', v_rate,
                        'line_total', round(v_extra_qty * v_rate, 2),
                        'price_basis', 'PACK_RATE',
                        'pack_unit_id', v_pack_unit_id,
                        'pack_unit_name', v_pack_unit_name,
                        'pack_factor', v_factor,
                        'pack_quantity', NULL,
                        'pack_price', v_pack_price,
                        'list_price', v_list_rate,
                        'price_overridden', v_overridden
                    )
                );
            END IF;
        END IF;
    END LOOP;

    RETURN v_expanded;
END;
$$;
REVOKE ALL ON FUNCTION sales._expand_sale_lines(jsonb) FROM PUBLIC;

-- ============================================================================
-- 3. Replace sales.confirm_cash_sale with expanded lines
-- ============================================================================

CREATE OR REPLACE FUNCTION sales.confirm_cash_sale(
    p_session_token text,
    p_request_id uuid,
    p_payload_hash bytea,
    p_cash_session_id bigint,
    p_warehouse_id bigint,
    p_fiscal_period_id bigint,
    p_document_date date,
    p_lines jsonb,
    p_discount_amount numeric DEFAULT 0
)
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
    v_lines_expanded jsonb;
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
    v_discount numeric(14, 2);
    v_net_total numeric(14, 2);
    v_journal_line_number integer;
BEGIN
    -- 1. Session + permission
    SELECT user_id INTO v_user_id
        FROM iam.resolve_session_with_permission(p_session_token, 'POST_CASH_SALE');

    -- 2. Idempotency (evaluated on raw p_lines)
    v_cached_result := core.reserve_idempotent_request(
        'sales.confirm_cash_sale', p_request_id, p_payload_hash
    );
    IF v_cached_result IS NOT NULL THEN
        RETURN v_cached_result;
    END IF;

    -- Validate discount
    v_discount := coalesce(p_discount_amount, 0)::numeric(14, 2);
    IF v_discount < 0 THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: discount must not be negative' USING ERRCODE = '22023';
    END IF;
    IF v_discount <> round(v_discount, 2) THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: discount must have at most two decimals'
            USING ERRCODE = '22023';
    END IF;
    IF v_discount > 0 THEN
        PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'APPLY_SALE_DISCOUNT');
    END IF;

    -- 3. Cash session validation
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

    -- 4. Fiscal period must be OPEN and must contain document date
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

    -- 5. Validate and expand lines
    IF p_lines IS NULL OR jsonb_array_length(p_lines) = 0 THEN
        RAISE EXCEPTION 'cash sale must have at least one line' USING ERRCODE = '22023';
    END IF;

    v_lines_expanded := sales._expand_sale_lines(p_lines);
    IF v_lines_expanded IS NULL OR jsonb_array_length(v_lines_expanded) = 0 THEN
        RAISE EXCEPTION 'cash sale must have at least one line' USING ERRCODE = '22023';
    END IF;

    -- 5b. Lock all existing touched stock positions in deterministic order
    PERFORM 1
    FROM inventory.positions
    WHERE warehouse_id = p_warehouse_id
      AND variant_id IN (
          SELECT DISTINCT (elem ->> 'variant_id')::bigint
          FROM jsonb_array_elements(v_lines_expanded) elem
      )
    ORDER BY variant_id
    FOR UPDATE;

    -- 6. Create sale header (DRAFT)
    INSERT INTO core.business_documents (document_type, document_date, fiscal_period_id, fiscal_year)
        VALUES ('CASH_SALE', p_document_date, p_fiscal_period_id, v_fiscal_year)
        RETURNING id INTO v_document_id;

    INSERT INTO sales.cash_sales (
        document_id, warehouse_id, subtotal, total_amount
    ) VALUES (
        v_document_id, p_warehouse_id, 0, 0
    );

    -- 7. Process each expanded line
    FOR v_line IN SELECT jsonb_array_elements(v_lines_expanded)
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

        IF v_qty_on_hand < v_quantity THEN
            RAISE EXCEPTION 'insufficient stock for variant % in warehouse % (have %, need %)',
                v_variant_id, p_warehouse_id, v_qty_on_hand, v_quantity
                USING ERRCODE = '55000';
        END IF;

        v_unit_cost_snapshot := v_wac;

        IF coalesce(v_line->>'price_basis', 'BASE') = 'BASE' THEN
            v_line_total := round(v_quantity * v_unit_price, 2);
        ELSE
            v_line_total := (v_line->>'line_total')::numeric;
        END IF;

        v_subtotal := v_subtotal + v_line_total;
        v_total_cogs := v_total_cogs + round(v_quantity * v_unit_cost_snapshot, 4);

        v_new_qty := v_qty_on_hand - v_quantity;
        v_new_value := v_position_value - round(v_quantity * v_wac, 4);

        IF v_new_qty = 0 THEN
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

        IF v_new_qty = 0 AND v_new_value <> 0 THEN
            v_residual_journal_id := inventory._handle_residual_at_zero_quantity(
                p_warehouse_id, v_variant_id, v_movement_id, v_new_value,
                p_fiscal_period_id, p_document_date
            );
        END IF;

        INSERT INTO sales.cash_sale_lines (
            document_id, line_number, variant_id, variant_sku_snapshot, variant_name_snapshot,
            quantity, unit_price, unit_cost_snapshot, line_total,
            price_basis, pack_unit_id, pack_unit_name_snapshot, pack_factor_snapshot,
            pack_quantity, pack_price, list_price_snapshot, price_overridden
        ) VALUES (
            v_document_id, v_line_number, v_variant_id, v_variant_sku, v_variant_name,
            v_quantity, v_unit_price, v_unit_cost_snapshot, v_line_total,
            coalesce(v_line->>'price_basis', 'BASE'),
            nullif(v_line->>'pack_unit_id', '')::bigint,
            v_line->>'pack_unit_name',
            nullif(v_line->>'pack_factor', '')::numeric,
            nullif(v_line->>'pack_quantity', '')::numeric,
            nullif(v_line->>'pack_price', '')::numeric,
            nullif(v_line->>'list_price', '')::numeric,
            coalesce((v_line->>'price_overridden')::boolean, false)
        );
    END LOOP;

    IF v_discount > v_subtotal THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: discount exceeds the sale total'
            USING ERRCODE = '22023';
    END IF;
    v_net_total := v_subtotal - v_discount;

    -- 8. Finalize the sale header totals
    UPDATE sales.cash_sales
        SET subtotal = v_subtotal,
            discount_amount = v_discount,
            total_amount = v_net_total
        WHERE document_id = v_document_id;

    -- 9. Balanced journal
    INSERT INTO core.business_documents (document_type, document_date, fiscal_period_id, fiscal_year)
        VALUES ('JOURNAL_ENTRY', p_document_date, p_fiscal_period_id, v_fiscal_year)
        RETURNING id INTO v_journal_document_id;

    INSERT INTO finance.journal_entries (document_id, description, source_type, source_id)
        VALUES (v_journal_document_id, 'Cash sale', 'CASH_SALE', v_document_id);

    INSERT INTO finance.journal_lines (document_id, line_number, account_code, account_id, debit, credit) VALUES
        (v_journal_document_id, 1, 'CASH_DESK', finance.resolve_account_id('CASH_DESK'), v_net_total, 0);

    v_journal_line_number := 2;

    IF v_discount > 0 THEN
        INSERT INTO finance.journal_lines (document_id, line_number, account_code, account_id, debit, credit) VALUES
            (v_journal_document_id, v_journal_line_number, 'SALES_DISCOUNT', finance.resolve_account_id('SALES_DISCOUNT'), v_discount, 0);
        v_journal_line_number := v_journal_line_number + 1;
    END IF;

    INSERT INTO finance.journal_lines (document_id, line_number, account_code, account_id, debit, credit) VALUES
        (v_journal_document_id, v_journal_line_number, 'SALES_REVENUE', finance.resolve_account_id('SALES_REVENUE'), 0, v_subtotal);

    v_journal_line_number := v_journal_line_number + 1;

    IF v_total_cogs > 0 THEN
        INSERT INTO finance.journal_lines (document_id, line_number, account_code, account_id, debit, credit) VALUES
            (v_journal_document_id, v_journal_line_number, 'COGS', finance.resolve_account_id('COGS'), round(v_total_cogs, 2), 0),
            (v_journal_document_id, v_journal_line_number + 1, 'INVENTORY_MERCHANDISE', finance.resolve_account_id('INVENTORY_MERCHANDISE'), 0, round(v_total_cogs, 2));
    END IF;

    -- 10. Allocate official numbers
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

    -- 11. Record cash movement
    INSERT INTO cash.movements (cash_session_id, business_document_id, movement_type, amount)
        VALUES (p_cash_session_id, v_document_id, 'SALE', v_net_total);

    -- 12. Enqueue document jobs & drawer
    SELECT generation_job_id, print_job_id INTO v_gen_job, v_print_job
        FROM documents.enqueue_receipt_jobs(v_document_id, 'cash_sale_receipt:' || v_document_id);

    v_drawer_job := cash.enqueue_drawer_job(
        p_cash_session_id, v_document_id, 'cash_sale_drawer:' || v_document_id
    );

    -- 13. Idempotency completion
    PERFORM core.record_idempotent_result('sales.confirm_cash_sale', p_request_id, v_document_id);

    RETURN v_document_id;
END;
$function$;

REVOKE ALL ON FUNCTION sales.confirm_cash_sale(text, uuid, bytea, bigint, bigint, bigint, date, jsonb, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sales.confirm_cash_sale(text, uuid, bytea, bigint, bigint, bigint, date, jsonb, numeric) TO stockiha_runtime;

-- ============================================================================
-- 4. Replace sales.confirm_credit_sale with expanded lines
-- ============================================================================

CREATE OR REPLACE FUNCTION sales.confirm_credit_sale(
    p_session_token text,
    p_request_id uuid,
    p_payload_hash bytea,
    p_customer_id bigint,
    p_warehouse_id bigint,
    p_fiscal_period_id bigint,
    p_document_date date,
    p_lines jsonb,
    p_override_token uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
    v_user_id bigint;
    v_workstation_id text;
    v_cached_result bigint;
    v_period_status text;
    v_period_start date;
    v_period_end date;
    v_fiscal_year integer;
    v_customer_active boolean;
    v_credit_enabled boolean;
    v_credit_limit numeric(14, 2);
    v_payment_terms_days integer;
    v_max_overdue_days integer;
    v_exposure numeric(14, 2);
    v_oldest_due date;
    v_business_today date := (now() AT TIME ZONE 'Africa/Algiers')::date;
    v_over_limit boolean;
    v_overdue_blocked boolean;
    v_override_used boolean := false;
    v_document_id bigint;
    v_journal_document_id bigint;
    v_lines_expanded jsonb;
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
    v_line_total numeric(14, 2);
    v_subtotal numeric(14, 2) := 0;
    v_total_cogs numeric(18, 4) := 0;
    v_movement_id bigint;
    v_residual_journal_id bigint;
    v_due_date date;
    v_sequence bigint;
    v_document_number text;
    v_journal_sequence bigint;
    v_journal_number text;
    v_new_exposure numeric(14, 2);
BEGIN
    SELECT user_id, workstation_id
    INTO v_user_id, v_workstation_id
    FROM iam.resolve_session_with_permission(p_session_token, 'POST_CREDIT_SALE');

    v_cached_result := core.reserve_idempotent_request(
        'sales.confirm_credit_sale', p_request_id, p_payload_hash
    );
    IF v_cached_result IS NOT NULL THEN
        RETURN (
            SELECT jsonb_build_object(
                'document_id', d.id,
                'document_number', d.document_number,
                'customer_id', s.customer_id,
                'total_amount', s.total_amount::text,
                'due_date', s.due_date,
                'exposure_amount', cs.exposure_amount::text,
                'available_credit', (c.credit_limit - cs.exposure_amount)::text,
                'credit_limit', c.credit_limit::text,
                'over_limit', s.over_limit_at_posting,
                'journal_document_id', s.journal_document_id
            )
            FROM core.business_documents d
            JOIN sales.credit_sales s ON s.document_id = d.id
            JOIN receivables.customers c ON c.id = s.customer_id
            JOIN receivables.customer_credit_state cs ON cs.customer_id = c.id
            WHERE d.id = v_cached_result
        );
    END IF;

    SELECT status, starts_on, ends_on, extract(year FROM starts_on)::integer
    INTO v_period_status, v_period_start, v_period_end, v_fiscal_year
    FROM finance.fiscal_periods
    WHERE id = p_fiscal_period_id
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'fiscal period % not found', p_fiscal_period_id USING ERRCODE = '22023';
    END IF;
    IF v_period_status <> 'OPEN' THEN
        RAISE EXCEPTION 'fiscal period is not open' USING ERRCODE = '55000';
    END IF;
    IF p_document_date < v_period_start OR p_document_date > v_period_end THEN
        RAISE EXCEPTION 'document date is outside fiscal period' USING ERRCODE = '22023';
    END IF;

    IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
        RAISE EXCEPTION 'credit sale must contain at least one line' USING ERRCODE = '22023';
    END IF;

    v_lines_expanded := sales._expand_sale_lines(p_lines);
    IF v_lines_expanded IS NULL OR jsonb_array_length(v_lines_expanded) = 0 THEN
        RAISE EXCEPTION 'credit sale must contain at least one line' USING ERRCODE = '22023';
    END IF;

    SELECT c.is_active, c.credit_enabled, c.credit_limit, c.payment_terms_days,
           c.max_overdue_days, cs.exposure_amount, cs.oldest_open_due_date
    INTO v_customer_active, v_credit_enabled, v_credit_limit, v_payment_terms_days,
         v_max_overdue_days, v_exposure, v_oldest_due
    FROM receivables.customers c
    JOIN receivables.customer_credit_state cs ON cs.customer_id = c.id
    WHERE c.id = p_customer_id
    FOR UPDATE OF c, cs;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'customer % not found', p_customer_id USING ERRCODE = '22023';
    END IF;
    IF NOT v_customer_active THEN
        RAISE EXCEPTION 'customer is inactive' USING ERRCODE = '55000';
    END IF;
    IF NOT v_credit_enabled THEN
        RAISE EXCEPTION 'customer is not enabled for credit sales' USING ERRCODE = '55000';
    END IF;

    -- Validate wire amounts and calculate sale total using expanded lines
    FOR v_line IN SELECT * FROM jsonb_array_elements(v_lines_expanded)
    LOOP
        v_variant_id := NULLIF(v_line ->> 'variant_id', '')::bigint;
        v_quantity := NULLIF(v_line ->> 'quantity', '')::numeric;
        v_unit_price := NULLIF(v_line ->> 'unit_price', '')::numeric;
        IF v_variant_id IS NULL OR v_quantity IS NULL OR v_unit_price IS NULL THEN
            RAISE EXCEPTION 'credit sale line is missing required fields' USING ERRCODE = '22023';
        END IF;
        IF v_quantity <= 0 THEN
            RAISE EXCEPTION 'credit sale quantity must be positive' USING ERRCODE = '22023';
        END IF;
        IF v_unit_price < 0 THEN
            RAISE EXCEPTION 'credit sale unit price cannot be negative' USING ERRCODE = '22023';
        END IF;

        IF coalesce(v_line->>'price_basis', 'BASE') = 'BASE' THEN
            v_line_total := round(v_quantity * v_unit_price, 2);
        ELSE
            v_line_total := (v_line->>'line_total')::numeric;
        END IF;

        v_subtotal := v_subtotal + v_line_total;
    END LOOP;

    IF v_subtotal <= 0 THEN
        RAISE EXCEPTION 'credit sale total must be positive' USING ERRCODE = '22023';
    END IF;

    v_due_date := p_document_date + v_payment_terms_days;
    v_over_limit := (v_exposure + v_subtotal) > v_credit_limit;
    v_overdue_blocked := v_oldest_due IS NOT NULL
        AND v_max_overdue_days IS NOT NULL
        AND (v_oldest_due + v_max_overdue_days) < v_business_today;

    IF v_overdue_blocked THEN
        IF p_override_token IS NULL THEN
            RAISE EXCEPTION 'customer has an overdue invoice beyond the allowed window'
                USING ERRCODE = '55000';
        END IF;

        PERFORM 1
        FROM receivables.credit_override_tokens o
        WHERE o.id = p_override_token
          AND o.customer_id = p_customer_id
          AND o.canonical_payload_hash = encode(p_payload_hash, 'hex')
          AND o.consumed_at IS NULL
          AND o.expires_at > now()
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'credit override is invalid, expired, consumed, or does not match this sale'
                USING ERRCODE = '55000';
        END IF;
        v_override_used := true;
    END IF;

    PERFORM 1
    FROM inventory.positions
    WHERE warehouse_id = p_warehouse_id
      AND variant_id IN (
          SELECT DISTINCT (elem ->> 'variant_id')::bigint
          FROM jsonb_array_elements(v_lines_expanded) elem
      )
    ORDER BY variant_id
    FOR UPDATE;

    INSERT INTO core.business_documents (
        document_type, document_date, fiscal_period_id, fiscal_year
    ) VALUES (
        'CREDIT_SALE', p_document_date, p_fiscal_period_id, v_fiscal_year
    ) RETURNING id INTO v_document_id;

    INSERT INTO sales.credit_sales (
        document_id, customer_id, warehouse_id, subtotal, total_amount, due_date,
        posted_by_user_id, workstation_id
    ) VALUES (
        v_document_id, p_customer_id, p_warehouse_id, 0, 0, v_due_date,
        v_user_id, v_workstation_id
    );

    v_line_number := 0;
    FOR v_line IN SELECT * FROM jsonb_array_elements(v_lines_expanded)
    LOOP
        v_line_number := v_line_number + 1;
        v_variant_id := (v_line ->> 'variant_id')::bigint;
        v_quantity := (v_line ->> 'quantity')::numeric;
        v_unit_price := (v_line ->> 'unit_price')::numeric;

        SELECT pv.is_active, pv.sku, p.name
        INTO v_variant_active, v_variant_sku, v_variant_name
        FROM catalog.product_variants pv
        JOIN catalog.products p ON p.id = pv.product_id
        WHERE pv.id = v_variant_id;

        IF NOT FOUND OR NOT v_variant_active THEN
            RAISE EXCEPTION 'variant % is missing or inactive', v_variant_id USING ERRCODE = '22023';
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
        IF v_qty_on_hand < v_quantity THEN
            RAISE EXCEPTION 'insufficient stock for variant %', v_variant_id USING ERRCODE = '55000';
        END IF;

        v_unit_cost_snapshot := v_wac;

        IF coalesce(v_line->>'price_basis', 'BASE') = 'BASE' THEN
            v_line_total := round(v_quantity * v_unit_price, 2);
        ELSE
            v_line_total := (v_line->>'line_total')::numeric;
        END IF;

        v_total_cogs := v_total_cogs + round(v_quantity * v_unit_cost_snapshot, 4);
        v_new_qty := v_qty_on_hand - v_quantity;
        v_new_value := v_position_value - round(v_quantity * v_wac, 4);

        IF v_new_qty = 0 THEN
            IF abs(v_new_value) >= 0.01 THEN
                RAISE EXCEPTION 'credit sale would leave a material zero-quantity inventory residual'
                    USING ERRCODE = '55000';
            END IF;
        ELSIF v_new_value < 0 THEN
            RAISE EXCEPTION 'credit sale would make inventory value negative' USING ERRCODE = '55000';
        END IF;

        UPDATE inventory.positions
        SET quantity_on_hand = v_new_qty,
            total_value = CASE WHEN v_new_qty = 0 THEN 0 ELSE v_new_value END
        WHERE warehouse_id = p_warehouse_id AND variant_id = v_variant_id;

        INSERT INTO inventory.movements (
            warehouse_id, variant_id, movement_type, quantity_delta, inventory_value_delta,
            resulting_quantity_on_hand, resulting_total_value, reference_type, reference_id
        ) VALUES (
            p_warehouse_id, v_variant_id, 'ISSUE', -v_quantity,
            -round(v_quantity * v_wac, 4), v_new_qty,
            CASE WHEN v_new_qty = 0 THEN 0 ELSE v_new_value END,
            'CREDIT_SALE_LINE', v_document_id
        ) RETURNING id INTO v_movement_id;

        IF v_new_qty = 0 AND v_new_value <> 0 THEN
            v_residual_journal_id := inventory._handle_residual_at_zero_quantity(
                p_warehouse_id, v_variant_id, v_movement_id, v_new_value,
                p_fiscal_period_id, p_document_date
            );
        END IF;

        INSERT INTO sales.credit_sale_lines (
            document_id, line_number, variant_id, variant_sku_snapshot,
            variant_name_snapshot, quantity, unit_price, unit_cost_snapshot, line_total,
            price_basis, pack_unit_id, pack_unit_name_snapshot, pack_factor_snapshot,
            pack_quantity, pack_price, list_price_snapshot, price_overridden
        ) VALUES (
            v_document_id, v_line_number, v_variant_id, v_variant_sku,
            v_variant_name, v_quantity, v_unit_price, v_unit_cost_snapshot, v_line_total,
            coalesce(v_line->>'price_basis', 'BASE'),
            nullif(v_line->>'pack_unit_id', '')::bigint,
            v_line->>'pack_unit_name',
            nullif(v_line->>'pack_factor', '')::numeric,
            nullif(v_line->>'pack_quantity', '')::numeric,
            nullif(v_line->>'pack_price', '')::numeric,
            nullif(v_line->>'list_price', '')::numeric,
            coalesce((v_line->>'price_overridden')::boolean, false)
        );
    END LOOP;

    UPDATE sales.credit_sales
    SET subtotal = v_subtotal,
        total_amount = v_subtotal,
        over_limit_at_posting = v_over_limit
    WHERE document_id = v_document_id;

    -- Receivable journal
    INSERT INTO core.business_documents (
        document_type, document_date, fiscal_period_id, fiscal_year
    ) VALUES (
        'JOURNAL_ENTRY', p_document_date, p_fiscal_period_id, v_fiscal_year
    ) RETURNING id INTO v_journal_document_id;

    INSERT INTO finance.journal_entries (document_id, description, source_type, source_id)
    VALUES (v_journal_document_id, 'Customer credit sale', 'CREDIT_SALE', v_document_id);

    INSERT INTO finance.journal_lines (document_id, line_number, account_code, account_id, debit, credit) VALUES
        (v_journal_document_id, 1, 'ACCOUNTS_RECEIVABLE', finance.resolve_account_id('ACCOUNTS_RECEIVABLE'), v_subtotal, 0),
        (v_journal_document_id, 2, 'SALES_REVENUE', finance.resolve_account_id('SALES_REVENUE'), 0, v_subtotal);

    IF v_total_cogs > 0 THEN
        INSERT INTO finance.journal_lines (document_id, line_number, account_code, account_id, debit, credit) VALUES
            (v_journal_document_id, 3, 'COGS', finance.resolve_account_id('COGS'), round(v_total_cogs, 2), 0),
            (v_journal_document_id, 4, 'INVENTORY_MERCHANDISE', finance.resolve_account_id('INVENTORY_MERCHANDISE'), 0, round(v_total_cogs, 2));
    END IF;

    UPDATE sales.credit_sales
    SET journal_document_id = v_journal_document_id
    WHERE document_id = v_document_id;

    v_sequence := core.claim_next_document_number('CREDIT_SALE', v_fiscal_year);
    v_document_number := 'CR-' || v_fiscal_year || '-' || lpad(v_sequence::text, 6, '0');
    UPDATE core.business_documents
    SET status = 'POSTED', sequence_number = v_sequence,
        document_number = v_document_number, posted_at = now()
    WHERE id = v_document_id;

    v_journal_sequence := core.claim_next_document_number('JOURNAL_ENTRY', v_fiscal_year);
    v_journal_number := 'JE-' || v_fiscal_year || '-' || lpad(v_journal_sequence::text, 6, '0');
    UPDATE core.business_documents
    SET status = 'POSTED', sequence_number = v_journal_sequence,
        document_number = v_journal_number, posted_at = now()
    WHERE id = v_journal_document_id;

    INSERT INTO receivables.customer_ledger_entries (
        customer_id, entry_type, amount_delta, document_id, due_date,
        posted_by_user_id, workstation_id
    ) VALUES (
        p_customer_id, 'CREDIT_INVOICE', v_subtotal, v_document_id, v_due_date,
        v_user_id, v_workstation_id
    );

    v_new_exposure := v_exposure + v_subtotal;
    UPDATE receivables.customer_credit_state
    SET exposure_amount = v_new_exposure,
        oldest_open_due_date = CASE
            WHEN oldest_open_due_date IS NULL THEN v_due_date
            ELSE least(oldest_open_due_date, v_due_date)
        END
    WHERE customer_id = p_customer_id;

    IF v_override_used THEN
        UPDATE receivables.credit_override_tokens
        SET consumed_at = now(), consumed_document_id = v_document_id
        WHERE id = p_override_token;
    END IF;

    PERFORM core.record_idempotent_result(
        'sales.confirm_credit_sale', p_request_id, v_document_id
    );

    RETURN jsonb_build_object(
        'document_id', v_document_id,
        'document_number', v_document_number,
        'customer_id', p_customer_id,
        'total_amount', v_subtotal::text,
        'due_date', v_due_date,
        'exposure_amount', v_new_exposure::text,
        'available_credit', (v_credit_limit - v_new_exposure)::text,
        'credit_limit', v_credit_limit::text,
        'over_limit', v_over_limit,
        'journal_document_id', v_journal_document_id
    );
END;
$function$;

REVOKE ALL ON FUNCTION sales.confirm_credit_sale(text, uuid, bytea, bigint, bigint, bigint, date, jsonb, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sales.confirm_credit_sale(text, uuid, bytea, bigint, bigint, bigint, date, jsonb, uuid) TO stockiha_runtime;

-- ============================================================================
-- 5. Sale lines make a pack "used" in catalog._pack_is_used
-- ============================================================================

CREATE OR REPLACE FUNCTION catalog._pack_is_used(p_variant_unit_id bigint)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
    v_variant_id bigint;
    v_unit_id bigint;
BEGIN
    SELECT variant_id, unit_id INTO v_variant_id, v_unit_id
      FROM catalog.variant_units WHERE id = p_variant_unit_id;
    IF NOT FOUND THEN
        RETURN false;
    END IF;

    IF EXISTS (
        SELECT 1 FROM procurement.purchase_receipt_lines
         WHERE variant_id = v_variant_id AND unit_id = v_unit_id
    ) THEN
        RETURN true;
    END IF;

    IF EXISTS (
        SELECT 1 FROM inventory.stock_adjustments
         WHERE variant_id = v_variant_id AND input_unit_id = v_unit_id
    ) THEN
        RETURN true;
    END IF;

    IF EXISTS (
        SELECT 1 FROM procurement.purchase_return_lines
         WHERE variant_id = v_variant_id AND unit_id = v_unit_id
    ) THEN
        RETURN true;
    END IF;

    IF EXISTS (
        SELECT 1 FROM procurement.purchase_transaction_lines
         WHERE variant_id = v_variant_id AND unit_id = v_unit_id
    ) THEN
        RETURN true;
    END IF;

    IF EXISTS (
        SELECT 1 FROM sales.cash_sale_lines
         WHERE variant_id = v_variant_id AND pack_unit_id = v_unit_id
    ) THEN
        RETURN true;
    END IF;

    IF EXISTS (
        SELECT 1 FROM sales.credit_sale_lines
         WHERE variant_id = v_variant_id AND pack_unit_id = v_unit_id
    ) THEN
        RETURN true;
    END IF;

    RETURN false;
END; $$;
REVOKE ALL ON FUNCTION catalog._pack_is_used(bigint) FROM PUBLIC;

-- ============================================================================
-- 6. Update receivables.credit_sale_payload_hash to include pack fields
-- ============================================================================

CREATE OR REPLACE FUNCTION receivables.credit_sale_payload_hash(
    p_customer_id bigint,
    p_warehouse_id bigint,
    p_fiscal_period_id bigint,
    p_document_date date,
    p_lines jsonb
)
RETURNS bytea
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog
AS $$
DECLARE
    v_lines jsonb;
    v_payload jsonb;
BEGIN
    IF p_customer_id IS NULL OR p_customer_id <= 0
       OR p_warehouse_id IS NULL OR p_warehouse_id <= 0
       OR p_fiscal_period_id IS NULL OR p_fiscal_period_id <= 0
       OR p_document_date IS NULL
       OR p_lines IS NULL
       OR jsonb_typeof(p_lines) <> 'array'
       OR jsonb_array_length(p_lines) = 0
    THEN
        RAISE EXCEPTION 'invalid credit sale payload for fingerprinting' USING ERRCODE = '22023';
    END IF;

    SELECT jsonb_agg(
        CASE WHEN line ? 'sale_unit' THEN jsonb_build_object(
            'sale_unit',      line ->> 'sale_unit',
            'variant_id',     (line ->> 'variant_id')::bigint,
            'pack_unit_id',   nullif(line ->> 'pack_unit_id','')::bigint,
            'pack_quantity',  trim_scale(nullif(line ->> 'pack_quantity','')::numeric),
            'extra_quantity', trim_scale(coalesce(nullif(line ->> 'extra_quantity',''),'0')::numeric),
            'pack_price',     trim_scale(nullif(line ->> 'pack_price','')::numeric)
        )
        ELSE jsonb_build_object(
            'variant_id', (line ->> 'variant_id')::bigint,
            'quantity', trim_scale((line ->> 'quantity')::numeric),
            'unit_price', trim_scale((line ->> 'unit_price')::numeric)
        )
        END
        ORDER BY ordinal
    )
    INTO v_lines
    FROM jsonb_array_elements(p_lines) WITH ORDINALITY AS rows(line, ordinal);

    v_payload := jsonb_build_object(
        'customer_id', p_customer_id,
        'warehouse_id', p_warehouse_id,
        'fiscal_period_id', p_fiscal_period_id,
        'document_date', p_document_date,
        'lines', v_lines
    );

    RETURN sha256(convert_to(v_payload::text, 'UTF8'));
EXCEPTION
    WHEN invalid_text_representation OR numeric_value_out_of_range THEN
        RAISE EXCEPTION 'invalid credit sale payload for fingerprinting' USING ERRCODE = '22023';
END;
$$;
REVOKE ALL ON FUNCTION receivables.credit_sale_payload_hash(bigint, bigint, bigint, date, jsonb) FROM PUBLIC;

-- ============================================================================
-- 7. Update sales.list_sale_lines to return pack snapshots and base unit
-- ============================================================================

DROP FUNCTION IF EXISTS sales.list_sale_lines(text, bigint);

CREATE FUNCTION sales.list_sale_lines(p_session_token text, p_document_id bigint)
RETURNS TABLE (
    line_number             integer,
    variant_sku_snapshot    text,
    variant_name_snapshot   text,
    quantity                numeric,
    unit_price              numeric,
    line_total              numeric,
    price_basis             text,
    pack_unit_name_snapshot text,
    pack_factor_snapshot    numeric,
    pack_quantity           numeric,
    pack_price              numeric,
    base_unit_name          text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    BEGIN
        PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'POST_CASH_SALE');
    EXCEPTION WHEN OTHERS THEN
        PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'POST_CREDIT_SALE');
    END;

    IF EXISTS (SELECT 1 FROM sales.credit_sales WHERE document_id = p_document_id) THEN
        RETURN QUERY
            SELECT l.line_number, l.variant_sku_snapshot, l.variant_name_snapshot,
                   l.quantity, l.unit_price, l.line_total,
                   l.price_basis, l.pack_unit_name_snapshot, l.pack_factor_snapshot,
                   l.pack_quantity, l.pack_price, u.name AS base_unit_name
            FROM sales.credit_sale_lines l
            JOIN catalog.product_variants pv ON pv.id = l.variant_id
            JOIN catalog.products p ON p.id = pv.product_id
            JOIN catalog.units u ON u.id = p.unit_id
            WHERE l.document_id = p_document_id
            ORDER BY l.line_number;
    ELSE
        RETURN QUERY
            SELECT l.line_number, l.variant_sku_snapshot, l.variant_name_snapshot,
                   l.quantity, l.unit_price, l.line_total,
                   l.price_basis, l.pack_unit_name_snapshot, l.pack_factor_snapshot,
                   l.pack_quantity, l.pack_price, u.name AS base_unit_name
            FROM sales.cash_sale_lines l
            JOIN catalog.product_variants pv ON pv.id = l.variant_id
            JOIN catalog.products p ON p.id = pv.product_id
            JOIN catalog.units u ON u.id = p.unit_id
            WHERE l.document_id = p_document_id
            ORDER BY l.line_number;
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION sales.list_sale_lines(text, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sales.list_sale_lines(text, bigint) TO stockiha_runtime;

-- ============================================================================
-- 8. Update documents.get_business_document_detail with pack snapshots
-- ============================================================================

CREATE OR REPLACE FUNCTION documents.get_business_document_detail(
    p_session_token text,
    p_document_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_user_id bigint;
    v_doc record;
    v_header jsonb;
    v_subtype jsonb := '{}'::jsonb;
    v_relationships jsonb := '[]'::jsonb;
    v_journal jsonb := NULL;
    v_print_jobs jsonb := NULL;
    v_result jsonb;
BEGIN
    SELECT user_id INTO v_user_id
    FROM iam.resolve_session(p_session_token);
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'SESSION_INVALID: Session is invalid or expired' USING ERRCODE = '28000';
    END IF;

    SELECT * INTO v_doc
    FROM core.business_documents
    WHERE id = p_document_id;

    IF v_doc.id IS NULL THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: Document % not found', p_document_id USING ERRCODE = '55000';
    END IF;

    v_header := jsonb_build_object(
        'document_id', v_doc.id,
        'document_type', v_doc.document_type,
        'document_number', v_doc.document_number,
        'status', v_doc.status,
        'document_date', v_doc.document_date,
        'fiscal_year', v_doc.fiscal_year,
        'fiscal_period_id', v_doc.fiscal_period_id,
        'posted_at', v_doc.posted_at,
        'created_at', v_doc.created_at,
        'updated_at', v_doc.updated_at,
        'created_by_username', (SELECT u.username FROM iam.users u WHERE u.id = v_doc.created_by_user_id),
        'created_on_workstation_id', v_doc.created_on_workstation_id
    );

    IF v_doc.document_type = 'PURCHASE_ORDER' THEN
        SELECT jsonb_build_object(
            'supplier_id', po.supplier_id,
            'supplier_name', s.name,
            'warehouse_id', po.warehouse_id,
            'warehouse_name', w.name,
            'payment_terms', po.payment_terms,
            'expected_delivery_date', po.expected_delivery_date,
            'subtotal', po.subtotal::text,
            'tax_amount', po.tax_amount::text,
            'total_amount', po.total_amount::text,
            'notes', po.note,
            'lines', coalesce((
                SELECT jsonb_agg(jsonb_build_object(
                    'line_number', pol.line_number,
                    'variant_id', pol.variant_id,
                    'sku', pv.sku,
                    'product_name', p.name,
                    'unit_code', u.code,
                    'ordered_quantity', pol.quantity_ordered::text,
                    'unit_cost', pol.unit_cost::text,
                    'line_total', pol.line_total::text
                ) ORDER BY pol.line_number)
                FROM procurement.purchase_order_lines pol
                JOIN catalog.product_variants pv ON pv.id = pol.variant_id
                JOIN catalog.products p ON p.id = pv.product_id
                JOIN catalog.units u ON u.id = pol.unit_id
                WHERE pol.document_id = v_doc.id
            ), '[]'::jsonb)
        ) INTO v_subtype
        FROM procurement.purchase_orders po
        JOIN procurement.suppliers s ON s.id = po.supplier_id
        JOIN inventory.warehouses w ON w.id = po.warehouse_id
        WHERE po.document_id = v_doc.id;

        SELECT coalesce(jsonb_agg(jsonb_build_object(
            'document_id', r_bd.id,
            'document_type', r_bd.document_type,
            'document_number', r_bd.document_number,
            'date', r_bd.document_date,
            'status', r_bd.status
        )), '[]'::jsonb) INTO v_relationships
        FROM core.business_documents r_bd
        WHERE r_bd.id IN (
            SELECT pr.document_id FROM procurement.purchase_receipts pr WHERE pr.purchase_order_id = v_doc.id
            UNION
            SELECT si.document_id FROM procurement.supplier_invoices si WHERE si.purchase_order_id = v_doc.id
            UNION
            SELECT sr.document_id FROM procurement.supplier_returns sr WHERE sr.purchase_order_id = v_doc.id
        );

    ELSIF v_doc.document_type = 'PURCHASE_RECEIPT' THEN
        SELECT jsonb_build_object(
            'purchase_order_id', pr.purchase_order_id,
            'purchase_order_number', po_bd.document_number,
            'supplier_id', pr.supplier_id,
            'supplier_name', s.name,
            'warehouse_id', pr.warehouse_id,
            'warehouse_name', w.name,
            'total_amount', pr.total_amount::text,
            'lines', coalesce((
                SELECT jsonb_agg(jsonb_build_object(
                    'line_number', prl.line_number,
                    'variant_id', prl.variant_id,
                    'sku', pv.sku,
                    'product_name', p.name,
                    'unit_code', u.code,
                    'received_quantity', prl.quantity_received::text,
                    'unit_cost', prl.unit_cost::text,
                    'line_total', prl.line_total::text
                ) ORDER BY prl.line_number)
                FROM procurement.purchase_receipt_lines prl
                JOIN catalog.product_variants pv ON pv.id = prl.variant_id
                JOIN catalog.products p ON p.id = pv.product_id
                JOIN catalog.units u ON u.id = prl.unit_id
                WHERE prl.document_id = v_doc.id
            ), '[]'::jsonb)
        ) INTO v_subtype
        FROM procurement.purchase_receipts pr
        JOIN procurement.suppliers s ON s.id = pr.supplier_id
        JOIN inventory.warehouses w ON w.id = pr.warehouse_id
        LEFT JOIN core.business_documents po_bd ON po_bd.id = pr.purchase_order_id
        WHERE pr.document_id = v_doc.id;

    ELSIF v_doc.document_type = 'SUPPLIER_INVOICE' THEN
        SELECT jsonb_build_object(
            'purchase_order_id', si.purchase_order_id,
            'purchase_order_number', po_bd.document_number,
            'supplier_id', si.supplier_id,
            'supplier_name', s.name,
            'supplier_invoice_number', si.supplier_invoice_number,
            'subtotal', si.subtotal::text,
            'tax_amount', si.tax_amount::text,
            'total_amount', si.total_amount::text,
            'due_date', si.due_date,
            'lines', coalesce((
                SELECT jsonb_agg(jsonb_build_object(
                    'line_number', sil.line_number,
                    'variant_id', sil.variant_id,
                    'sku', pv.sku,
                    'product_name', p.name,
                    'invoiced_quantity', sil.quantity::text,
                    'unit_cost', sil.unit_cost::text,
                    'line_total', sil.line_total::text
                ) ORDER BY sil.line_number)
                FROM procurement.supplier_invoice_lines sil
                JOIN catalog.product_variants pv ON pv.id = sil.variant_id
                JOIN catalog.products p ON p.id = pv.product_id
                WHERE sil.document_id = v_doc.id
            ), '[]'::jsonb)
        ) INTO v_subtype
        FROM procurement.supplier_invoices si
        JOIN procurement.suppliers s ON s.id = si.supplier_id
        LEFT JOIN core.business_documents po_bd ON po_bd.id = si.purchase_order_id
        WHERE si.document_id = v_doc.id;

    ELSIF v_doc.document_type = 'PURCHASE_RETURN' THEN
        SELECT jsonb_build_object(
            'purchase_order_id', sr.purchase_order_id,
            'purchase_order_number', po_bd.document_number,
            'supplier_id', sr.supplier_id,
            'supplier_name', s.name,
            'warehouse_id', sr.warehouse_id,
            'warehouse_name', w.name,
            'reason_code', sr.reason_code,
            'notes', sr.note,
            'lines', coalesce((
                SELECT jsonb_agg(jsonb_build_object(
                    'line_number', srl.line_number,
                    'variant_id', srl.variant_id,
                    'sku', pv.sku,
                    'product_name', p.name,
                    'returned_quantity', srl.quantity::text,
                    'supplier_unit_cost', srl.unit_cost::text,
                    'line_total', srl.line_total::text
                ) ORDER BY srl.line_number)
                FROM procurement.supplier_return_lines srl
                JOIN catalog.product_variants pv ON pv.id = srl.variant_id
                JOIN catalog.products p ON p.id = pv.product_id
                WHERE srl.return_id = sr.id
            ), '[]'::jsonb)
        ) INTO v_subtype
        FROM procurement.supplier_returns sr
        JOIN procurement.suppliers s ON s.id = sr.supplier_id
        JOIN inventory.warehouses w ON w.id = sr.warehouse_id
        LEFT JOIN core.business_documents po_bd ON po_bd.id = sr.purchase_order_id
        WHERE sr.document_id = v_doc.id;

    ELSIF v_doc.document_type = 'SUPPLIER_PAYMENT' THEN
        SELECT jsonb_build_object(
            'supplier_id', sp.supplier_id,
            'supplier_name', s.name,
            'amount', sp.amount::text,
            'payment_method', sp.payment_method,
            'reference', sp.reference,
            'notes', sp.note
        ) INTO v_subtype
        FROM procurement.supplier_payments sp
        JOIN procurement.suppliers s ON s.id = sp.supplier_id
        WHERE sp.document_id = v_doc.id;

    ELSIF v_doc.document_type = 'CASH_SALE' THEN
        SELECT jsonb_build_object(
            'subtotal', cs.subtotal::text,
            'discount_amount', cs.discount_amount::text,
            'total_amount', cs.total_amount::text,
            'lines', coalesce((
                SELECT jsonb_agg(jsonb_build_object(
                    'line_number', csl.line_number,
                    'variant_id', csl.variant_id,
                    'sku', pv.sku,
                    'product_name', p.name,
                    'quantity', csl.quantity::text,
                    'unit_price', csl.unit_price::text,
                    'line_total', csl.line_total::text,
                    'price_basis', csl.price_basis,
                    'pack_unit_name', csl.pack_unit_name_snapshot,
                    'pack_factor', csl.pack_factor_snapshot::text,
                    'pack_quantity', csl.pack_quantity::text,
                    'pack_price', csl.pack_price::text,
                    'unit_name', u.name
                ) ORDER BY csl.line_number)
                FROM sales.cash_sale_lines csl
                JOIN catalog.product_variants pv ON pv.id = csl.variant_id
                JOIN catalog.products p ON p.id = pv.product_id
                JOIN catalog.units u ON u.id = p.unit_id
                WHERE csl.document_id = v_doc.id
            ), '[]'::jsonb)
        ) INTO v_subtype
        FROM sales.cash_sales cs
        WHERE cs.document_id = v_doc.id;

    ELSIF v_doc.document_type = 'CREDIT_SALE' THEN
        SELECT jsonb_build_object(
            'customer_id', cs.customer_id,
            'customer_name', c.name,
            'total_amount', cs.total_amount::text,
            'due_date', cs.due_date,
            'lines', coalesce((
                SELECT jsonb_agg(jsonb_build_object(
                    'line_number', csl.line_number,
                    'variant_id', csl.variant_id,
                    'sku', pv.sku,
                    'product_name', p.name,
                    'quantity', csl.quantity::text,
                    'unit_price', csl.unit_price::text,
                    'line_total', csl.line_total::text,
                    'price_basis', csl.price_basis,
                    'pack_unit_name', csl.pack_unit_name_snapshot,
                    'pack_factor', csl.pack_factor_snapshot::text,
                    'pack_quantity', csl.pack_quantity::text,
                    'pack_price', csl.pack_price::text,
                    'unit_name', u.name
                ) ORDER BY csl.line_number)
                FROM sales.credit_sale_lines csl
                JOIN catalog.product_variants pv ON pv.id = csl.variant_id
                JOIN catalog.products p ON p.id = pv.product_id
                JOIN catalog.units u ON u.id = p.unit_id
                WHERE csl.document_id = v_doc.id
            ), '[]'::jsonb)
        ) INTO v_subtype
        FROM sales.credit_sales cs
        JOIN receivables.customers c ON c.id = cs.customer_id
        WHERE cs.document_id = v_doc.id;

    ELSIF v_doc.document_type = 'CUSTOMER_PAYMENT' THEN
        SELECT jsonb_build_object(
            'customer_id', cp.customer_id,
            'customer_name', c.name,
            'amount', cp.amount::text,
            'payment_method', cp.payment_method,
            'reference', cp.reference_note,
            'notes', cp.note
        ) INTO v_subtype
        FROM receivables.customer_payments cp
        JOIN receivables.customers c ON c.id = cp.customer_id
        WHERE cp.document_id = v_doc.id;

    ELSIF v_doc.document_type = 'STOCK_ADJUSTMENT' THEN
        SELECT jsonb_build_object(
            'warehouse_id', sa.warehouse_id,
            'warehouse_name', w.name,
            'reason_code', sa.reason_code,
            'notes', sa.note,
            'lines', coalesce((
                SELECT jsonb_agg(jsonb_build_object(
                    'line_number', sal.line_number,
                    'variant_id', sal.variant_id,
                    'sku', pv.sku,
                    'product_name', p.name,
                    'delta_quantity', sal.delta_quantity::text,
                    'unit_cost', sal.unit_cost_snapshot::text,
                    'inventory_value_delta', sal.inventory_value_delta::text
                ) ORDER BY sal.line_number)
                FROM inventory.stock_adjustment_lines sal
                JOIN catalog.product_variants pv ON pv.id = sal.variant_id
                JOIN catalog.products p ON p.id = pv.product_id
                WHERE sal.document_id = v_doc.id
            ), '[]'::jsonb)
        ) INTO v_subtype
        FROM inventory.stock_adjustments sa
        JOIN inventory.warehouses w ON w.id = sa.warehouse_id
        WHERE sa.document_id = v_doc.id;

    ELSIF v_doc.document_type = 'STOCK_TRANSFER' THEN
        SELECT jsonb_build_object(
            'source_warehouse_id', st.source_warehouse_id,
            'source_warehouse_name', sw.name,
            'target_warehouse_id', st.target_warehouse_id,
            'target_warehouse_name', tw.name,
            'notes', st.note,
            'lines', coalesce((
                SELECT jsonb_agg(jsonb_build_object(
                    'line_number', stl.line_number,
                    'variant_id', stl.variant_id,
                    'sku', pv.sku,
                    'product_name', p.name,
                    'transferred_quantity', stl.quantity::text,
                    'unit_cost', stl.unit_cost_snapshot::text,
                    'total_value', stl.total_value::text
                ) ORDER BY stl.line_number)
                FROM inventory.stock_transfer_lines stl
                JOIN catalog.product_variants pv ON pv.id = stl.variant_id
                JOIN catalog.products p ON p.id = pv.product_id
                WHERE stl.document_id = v_doc.id
            ), '[]'::jsonb)
        ) INTO v_subtype
        FROM inventory.stock_transfers st
        JOIN inventory.warehouses sw ON sw.id = st.source_warehouse_id
        JOIN inventory.warehouses tw ON tw.id = st.target_warehouse_id
        WHERE st.document_id = v_doc.id;

    ELSIF v_doc.document_type = 'SALE_VOID' THEN
        SELECT jsonb_build_object(
            'original_document_id', v.original_document_id,
            'original_document_number', orig_bd.document_number,
            'sale_kind', v.sale_kind,
            'reason_code', v.reason_code,
            'note', v.note,
            'subtotal', v.sale_subtotal::text,
            'discount_amount', v.sale_discount::text,
            'total_amount', v.sale_total::text,
            'lines', coalesce((
                CASE WHEN v.sale_kind = 'CASH' THEN (
                    SELECT jsonb_agg(jsonb_build_object(
                        'line_number', csl.line_number,
                        'variant_id', csl.variant_id,
                        'sku', pv.sku,
                        'product_name', p.name,
                        'quantity', csl.quantity::text,
                        'unit_price', csl.unit_price::text,
                        'line_total', csl.line_total::text,
                        'price_basis', csl.price_basis,
                        'pack_unit_name', csl.pack_unit_name_snapshot,
                        'pack_factor', csl.pack_factor_snapshot::text,
                        'pack_quantity', csl.pack_quantity::text,
                        'pack_price', csl.pack_price::text,
                        'unit_name', u.name
                    ) ORDER BY csl.line_number)
                    FROM sales.cash_sale_lines csl
                    JOIN catalog.product_variants pv ON pv.id = csl.variant_id
                    JOIN catalog.products p ON p.id = pv.product_id
                    JOIN catalog.units u ON u.id = p.unit_id
                    WHERE csl.document_id = v.original_document_id
                ) ELSE (
                    SELECT jsonb_agg(jsonb_build_object(
                        'line_number', csl.line_number,
                        'variant_id', csl.variant_id,
                        'sku', pv.sku,
                        'product_name', p.name,
                        'quantity', csl.quantity::text,
                        'unit_price', csl.unit_price::text,
                        'line_total', csl.line_total::text,
                        'price_basis', csl.price_basis,
                        'pack_unit_name', csl.pack_unit_name_snapshot,
                        'pack_factor', csl.pack_factor_snapshot::text,
                        'pack_quantity', csl.pack_quantity::text,
                        'pack_price', csl.pack_price::text,
                        'unit_name', u.name
                    ) ORDER BY csl.line_number)
                    FROM sales.credit_sale_lines csl
                    JOIN catalog.product_variants pv ON pv.id = csl.variant_id
                    JOIN catalog.products p ON p.id = pv.product_id
                    JOIN catalog.units u ON u.id = p.unit_id
                    WHERE csl.document_id = v.original_document_id
                ) END
            ), '[]'::jsonb)
        ) INTO v_subtype
        FROM sales.sale_voids v
        JOIN core.business_documents orig_bd ON orig_bd.id = v.original_document_id
        WHERE v.document_id = v_doc.id;
    END IF;

    -- Associated journal entry
    SELECT jsonb_build_object(
        'document_id', j_bd.id,
        'document_number', j_bd.document_number,
        'description', je.description,
        'lines', coalesce((
            SELECT jsonb_agg(jsonb_build_object(
                'line_number', jl.line_number,
                'account_code', jl.account_code,
                'account_name', coalesce(a.name_fr, jl.account_code),
                'debit', jl.debit::text,
                'credit', jl.credit::text
            ) ORDER BY jl.line_number)
            FROM finance.journal_lines jl
            LEFT JOIN finance.accounts a ON a.id = jl.account_id
            WHERE jl.document_id = j_bd.id
        ), '[]'::jsonb)
    ) INTO v_journal
    FROM finance.journal_entries je
    JOIN core.business_documents j_bd ON j_bd.id = je.document_id
    WHERE (je.source_id = v_doc.id AND je.source_type = v_doc.document_type)
       OR (je.source_id = v_doc.id AND v_doc.document_type = 'CASH_SALE' AND je.source_type = 'CASH_SALE')
       OR (v_doc.document_type = 'JOURNAL_ENTRY' AND je.document_id = v_doc.id);

    -- Print/Gen status
    IF v_doc.document_type IN ('CASH_SALE', 'CREDIT_SALE', 'CUSTOMER_PAYMENT') THEN
        SELECT jsonb_build_object(
            'gen_status', coalesce(dg.status, 'NOT_GENERATED'),
            'prt_status', coalesce(dpj.status, 'NOT_PRINTED')
        ) INTO v_print_jobs
        FROM documents.generation_jobs dg
        LEFT JOIN documents.print_jobs dpj ON dpj.business_document_id = dg.business_document_id
        WHERE dg.business_document_id = v_doc.id
        ORDER BY dg.created_at DESC
        LIMIT 1;
    ELSE
        v_print_jobs := jsonb_build_object(
            'gen_status', 'NOT_APPLICABLE',
            'prt_status', 'NOT_APPLICABLE'
        );
    END IF;

    v_result := jsonb_build_object(
        'header', v_header,
        'subtype_detail', coalesce(v_subtype, '{}'::jsonb),
        'relationships', v_relationships,
        'journal', v_journal,
        'print_jobs', coalesce(v_print_jobs, jsonb_build_object('gen_status', 'NOT_GENERATED', 'prt_status', 'NOT_PRINTED'))
    );

    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION documents.get_business_document_detail(text, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION documents.get_business_document_detail(text, bigint) TO stockiha_runtime;

-- ============================================================================
-- 9. Update sales.void_sale to return pack fields in line summaries
-- ============================================================================

CREATE OR REPLACE FUNCTION sales.void_sale(
    p_session_token text,
    p_document_id bigint,
    p_reason_code text,
    p_note text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_user_id bigint;
    v_workstation_id text;
    v_note text;
    v_doc_type text;
    v_doc_status text;
    v_doc_number text;
    v_sale_kind text;
    v_session_id bigint;
    v_session_status text;
    v_session_cashier bigint;
    v_session_workstation text;
    v_sale_total numeric(14, 2);
    v_sale_subtotal numeric(14, 2);
    v_sale_discount numeric(14, 2);
    v_sale_created_at timestamptz;
    v_sale_workstation text;
    v_customer_id bigint;
    v_customer_name text;
    v_invoice_entry_id bigint;
    v_original_journal_id bigint;
    v_line_reference text;
    v_today date := (now() AT TIME ZONE 'Africa/Algiers')::date;
    v_period_id bigint;
    v_fiscal_year integer;
    v_void_document_id bigint;
    v_void_journal_id bigint;
    v_sequence bigint;
    v_void_number text;
    v_journal_number text;
    v_mv record;
    v_new_qty numeric;
    v_new_value numeric;
    v_restocked_lines integer := 0;
    v_mirrored_lines integer := 0;
    v_oldest_due date;
    v_lines jsonb;
BEGIN
    SELECT user_id, workstation_id
    INTO v_user_id, v_workstation_id
    FROM iam.resolve_session_with_permission(p_session_token, 'VOID_SALE');

    IF p_reason_code IS NULL OR p_reason_code NOT IN
        ('CUSTOMER_CHANGED_MIND', 'WRONG_ITEM', 'WRONG_PRICE', 'CASHIER_MISTAKE', 'OTHER') THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: unsupported cancellation reason' USING ERRCODE = '22023';
    END IF;
    v_note := nullif(btrim(coalesce(p_note, '')), '');
    IF v_note IS NOT NULL AND char_length(v_note) > 200 THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: note must be at most 200 characters' USING ERRCODE = '22023';
    END IF;
    IF p_reason_code = 'OTHER' AND v_note IS NULL THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: a description is required for a custom reason'
            USING ERRCODE = '22023';
    END IF;

    SELECT document_type, status, document_number
    INTO v_doc_type, v_doc_status, v_doc_number
    FROM core.business_documents
    WHERE id = p_document_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'sale not found' USING ERRCODE = '22023';
    END IF;
    IF v_doc_type NOT IN ('CASH_SALE', 'CREDIT_SALE') THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: only a cash or credit sale can be cancelled' USING ERRCODE = '22023';
    END IF;
    IF v_doc_status = 'REVERSED' THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: this sale is already cancelled' USING ERRCODE = '55000';
    END IF;
    IF v_doc_status <> 'POSTED' THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: only a posted sale can be cancelled' USING ERRCODE = '55000';
    END IF;

    IF v_doc_type = 'CASH_SALE' THEN
        v_sale_kind := 'CASH';
        v_line_reference := 'CASH_SALE_LINE';

        SELECT m.cash_session_id INTO v_session_id
        FROM cash.movements m
        WHERE m.business_document_id = p_document_id AND m.movement_type = 'SALE';
        IF NOT FOUND THEN
            RAISE EXCEPTION 'PRECONDITION_FAILED: this sale is not linked to a cash session'
                USING ERRCODE = '55000';
        END IF;

        SELECT total_amount, subtotal, discount_amount
        INTO v_sale_total, v_sale_subtotal, v_sale_discount
        FROM sales.cash_sales
        WHERE document_id = p_document_id;

        SELECT je.document_id INTO v_original_journal_id
        FROM finance.journal_entries je
        WHERE je.source_type = 'CASH_SALE' AND je.source_id = p_document_id;
    ELSE
        v_sale_kind := 'CREDIT';
        v_line_reference := 'CREDIT_SALE_LINE';

        SELECT cs.total_amount, cs.subtotal, cs.created_at, cs.workstation_id,
               cs.customer_id, cs.journal_document_id, c.name
        INTO v_sale_total, v_sale_subtotal, v_sale_created_at, v_sale_workstation,
             v_customer_id, v_original_journal_id, v_customer_name
        FROM sales.credit_sales cs
        JOIN receivables.customers c ON c.id = cs.customer_id
        WHERE cs.document_id = p_document_id;
        v_sale_discount := 0;
    END IF;

    SELECT status, current_cashier_user_id, workstation_id
    INTO v_session_status, v_session_cashier, v_session_workstation
    FROM sales.cash_sessions
    WHERE id = v_session_id
    FOR UPDATE;

    IF v_session_status <> 'OPEN' THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: a sale can only be cancelled while the cash session it was made in is still open'
            USING ERRCODE = '55000';
    END IF;
    IF v_session_cashier <> v_user_id OR v_session_workstation <> v_workstation_id THEN
        RAISE EXCEPTION 'only the cashier of the open session can cancel its sales' USING ERRCODE = '42501';
    END IF;

    IF v_sale_kind = 'CREDIT' THEN
        SELECT id INTO v_invoice_entry_id
        FROM receivables.customer_ledger_entries
        WHERE document_id = p_document_id AND entry_type = 'CREDIT_INVOICE';
        IF NOT FOUND THEN
            RAISE EXCEPTION 'PRECONDITION_FAILED: the customer invoice was not found' USING ERRCODE = '55000';
        END IF;

        PERFORM 1 FROM receivables.customer_credit_state
        WHERE customer_id = v_customer_id
        FOR UPDATE;

        IF receivables.net_invoice_allocated_amount(v_invoice_entry_id) <> 0 THEN
            RAISE EXCEPTION 'PRECONDITION_FAILED: the customer has already paid part of this sale; refund that payment first, then cancel the sale'
                USING ERRCODE = '55000';
        END IF;
    END IF;

    SELECT id, extract(year FROM starts_on)::integer
    INTO v_period_id, v_fiscal_year
    FROM finance.fiscal_periods
    WHERE status = 'OPEN' AND starts_on <= v_today AND ends_on >= v_today
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: no open fiscal period covers today' USING ERRCODE = '55000';
    END IF;

    INSERT INTO core.business_documents (document_type, document_date, fiscal_period_id, fiscal_year)
    VALUES ('SALE_VOID', v_today, v_period_id, v_fiscal_year)
    RETURNING id INTO v_void_document_id;

    INSERT INTO sales.sale_voids (
        document_id, original_document_id, sale_kind, reason_code, note,
        cash_session_id, cashier_user_id, workstation_id,
        sale_total, sale_subtotal, sale_discount
    ) VALUES (
        v_void_document_id, p_document_id, v_sale_kind, p_reason_code, v_note,
        v_session_id, v_user_id, v_workstation_id,
        v_sale_total, v_sale_subtotal, v_sale_discount
    );

    FOR v_mv IN
        SELECT m.id, m.warehouse_id, m.variant_id, m.quantity_delta, m.inventory_value_delta
        FROM inventory.movements m
        WHERE m.reference_type = v_line_reference
          AND m.reference_id = p_document_id
          AND m.movement_type = 'ISSUE'
        ORDER BY m.id
    LOOP
        PERFORM 1 FROM inventory.positions
        WHERE warehouse_id = v_mv.warehouse_id AND variant_id = v_mv.variant_id
        FOR UPDATE;

        UPDATE inventory.positions
        SET quantity_on_hand = quantity_on_hand + (-v_mv.quantity_delta),
            total_value      = total_value + (-v_mv.inventory_value_delta)
        WHERE warehouse_id = v_mv.warehouse_id AND variant_id = v_mv.variant_id
        RETURNING quantity_on_hand, total_value INTO v_new_qty, v_new_value;

        INSERT INTO inventory.movements (
            warehouse_id, variant_id, movement_type, quantity_delta, inventory_value_delta,
            resulting_quantity_on_hand, resulting_total_value, reference_type, reference_id
        ) VALUES (
            v_mv.warehouse_id, v_mv.variant_id, 'RESTOCK',
            -v_mv.quantity_delta, -v_mv.inventory_value_delta,
            v_new_qty, v_new_value, 'SALE_VOID', v_void_document_id
        );
        v_restocked_lines := v_restocked_lines + 1;
    END LOOP;

    INSERT INTO core.business_documents (document_type, document_date, fiscal_period_id, fiscal_year)
    VALUES ('JOURNAL_ENTRY', v_today, v_period_id, v_fiscal_year)
    RETURNING id INTO v_void_journal_id;

    INSERT INTO finance.journal_entries (document_id, description, source_type, source_id)
    VALUES (v_void_journal_id, 'Annulation vente ' || v_doc_number, 'SALE_VOID', v_void_document_id);

    INSERT INTO finance.journal_lines (document_id, line_number, account_code, account_id, debit, credit)
    SELECT v_void_journal_id, jl.line_number, jl.account_code, jl.account_id, jl.credit, jl.debit
    FROM finance.journal_lines jl
    WHERE jl.document_id = v_original_journal_id
    ORDER BY jl.line_number;

    GET DIAGNOSTICS v_mirrored_lines = ROW_COUNT;
    IF v_mirrored_lines = 0 THEN
        RAISE EXCEPTION 'ASSERTION_FAILURE: original journal entry has no lines to reverse'
            USING ERRCODE = '55000';
    END IF;

    IF v_sale_kind = 'CASH' THEN
        INSERT INTO cash.movements (cash_session_id, business_document_id, movement_type, amount)
        VALUES (v_session_id, v_void_document_id, 'SALE_VOID', -v_sale_total);
    ELSE
        INSERT INTO receivables.customer_ledger_entries (
            customer_id, entry_type, amount_delta, document_id, due_date,
            posted_by_user_id, workstation_id
        ) VALUES (
            v_customer_id, 'CREDIT_INVOICE_VOID', -v_sale_total, v_void_document_id, v_today,
            v_user_id, v_workstation_id
        );

        SELECT min(due_date) INTO v_oldest_due
        FROM receivables.customer_ledger_entries
        WHERE customer_id = v_customer_id;

        UPDATE receivables.customer_credit_state
        SET exposure_amount = exposure_amount - v_sale_total,
            oldest_open_due_date = v_oldest_due
        WHERE customer_id = v_customer_id;
    END IF;

    v_sequence := core.claim_next_document_number('SALE_VOID', v_fiscal_year);
    v_void_number := 'AV-' || v_fiscal_year || '-' || lpad(v_sequence::text, 6, '0');
    UPDATE core.business_documents
    SET status = 'POSTED', sequence_number = v_sequence, document_number = v_void_number, posted_at = now()
    WHERE id = v_void_document_id;

    v_sequence := core.claim_next_document_number('JOURNAL_ENTRY', v_fiscal_year);
    v_journal_number := 'JE-' || v_fiscal_year || '-' || lpad(v_sequence::text, 6, '0');
    UPDATE core.business_documents
    SET status = 'POSTED', sequence_number = v_sequence, document_number = v_journal_number, posted_at = now()
    WHERE id = v_void_journal_id;

    UPDATE core.business_documents SET status = 'REVERSED' WHERE id = p_document_id;

    IF v_sale_kind = 'CASH' THEN
        SELECT jsonb_agg(jsonb_build_object(
                   'name', l.variant_name_snapshot,
                   'quantity', l.quantity::text,
                   'unit_price', l.unit_price::text,
                   'line_total', l.line_total::text,
                   'price_basis', l.price_basis,
                   'pack_unit_name', l.pack_unit_name_snapshot,
                   'pack_factor', l.pack_factor_snapshot::text,
                   'pack_quantity', l.pack_quantity::text,
                   'pack_price', l.pack_price::text,
                   'unit_name', u.name) ORDER BY l.line_number)
        INTO v_lines
        FROM sales.cash_sale_lines l
        JOIN catalog.product_variants pv ON pv.id = l.variant_id
        JOIN catalog.products p ON p.id = pv.product_id
        JOIN catalog.units u ON u.id = p.unit_id
        WHERE l.document_id = p_document_id;
    ELSE
        SELECT jsonb_agg(jsonb_build_object(
                   'name', l.variant_name_snapshot,
                   'quantity', l.quantity::text,
                   'unit_price', l.unit_price::text,
                   'line_total', l.line_total::text,
                   'price_basis', l.price_basis,
                   'pack_unit_name', l.pack_unit_name_snapshot,
                   'pack_factor', l.pack_factor_snapshot::text,
                   'pack_quantity', l.pack_quantity::text,
                   'pack_price', l.pack_price::text,
                   'unit_name', u.name) ORDER BY l.line_number)
        INTO v_lines
        FROM sales.credit_sale_lines l
        JOIN catalog.product_variants pv ON pv.id = l.variant_id
        JOIN catalog.products p ON p.id = pv.product_id
        JOIN catalog.units u ON u.id = p.unit_id
        WHERE l.document_id = p_document_id;
    END IF;

    RETURN jsonb_build_object(
        'void_document_id', v_void_document_id,
        'void_document_number', v_void_number,
        'original_document_id', p_document_id,
        'original_document_number', v_doc_number,
        'sale_kind', v_sale_kind,
        'customer_name', v_customer_name,
        'total_amount', v_sale_total::text,
        'subtotal', v_sale_subtotal::text,
        'discount_amount', v_sale_discount::text,
        'lines', coalesce(v_lines, '[]'::jsonb),
        'reason_code', p_reason_code,
        'note', v_note,
        'cashier_user_id', v_user_id,
        'workstation_id', v_workstation_id,
        'voided_at', now()
    );
END;
$$;

REVOKE ALL ON FUNCTION sales.void_sale(text, bigint, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sales.void_sale(text, bigint, text, text) TO stockiha_runtime;

-- ============================================================================
-- 10. Update schema state
-- ============================================================================

UPDATE operations.schema_state SET migration_version = 20261002093000, updated_at = now() WHERE singleton;

RESET ROLE;
