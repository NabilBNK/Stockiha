-- WS-F-003: fixed-amount discount on a cash sale.
--
-- A discount reduces what the customer pays and what enters the drawer, but
-- not what the shop sold. Revenue is credited gross; the discount is debited
-- to its own account so it can be reported. Cost of goods sold and the stock
-- movement are unchanged -- a discount does not change what the goods cost.
--
-- sales.confirm_cash_sale is DROPPED and recreated with one extra parameter
-- rather than overloaded, so that only one version of this logic can ever be
-- called. The body below is the existing WS-B-1 version with four additions,
-- each marked WS-F-003.

SET ROLE stockiha_owner;

-- =============================================================================
-- 1. Permission: who may discount
-- =============================================================================

DO $$
DECLARE
    v_existing_check text;
BEGIN
    SELECT pg_get_expr(c.conbin, c.conrelid)
    INTO v_existing_check
    FROM pg_constraint c
    WHERE c.conrelid = 'iam.permissions'::regclass
      AND c.conname = 'permissions_code_valid'
      AND c.contype = 'c';

    IF v_existing_check IS NULL THEN
        RAISE EXCEPTION 'expected iam.permissions constraint permissions_code_valid is missing';
    END IF;

    IF v_existing_check NOT LIKE '%APPLY_SALE_DISCOUNT%' THEN
        ALTER TABLE iam.permissions DROP CONSTRAINT permissions_code_valid;
        EXECUTE format(
            'ALTER TABLE iam.permissions ADD CONSTRAINT permissions_code_valid CHECK ((%s) OR code = %L)',
            v_existing_check,
            'APPLY_SALE_DISCOUNT'
        );
    END IF;
END;
$$;

INSERT INTO iam.permissions (code, name) VALUES
    ('APPLY_SALE_DISCOUNT', 'Apply a fixed-amount discount to a sale')
ON CONFLICT (code) DO NOTHING;

INSERT INTO iam.role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM iam.roles role
CROSS JOIN iam.permissions permission
WHERE role.code IN ('MANAGER', 'ADMIN')
  AND permission.code = 'APPLY_SALE_DISCOUNT'
ON CONFLICT DO NOTHING;

-- =============================================================================
-- 2. Ledger account for discounts given (SCF 709)
-- =============================================================================

-- SCF 709 is a contra-revenue account (revenue type with debit normal balance).
-- Relax accounts_normal_balance_matches_type to permit 709.
ALTER TABLE finance.accounts DROP CONSTRAINT IF EXISTS accounts_normal_balance_matches_type;
ALTER TABLE finance.accounts ADD CONSTRAINT accounts_normal_balance_matches_type CHECK (
    (account_type IN ('asset', 'expense') AND normal_balance = 'debit')
    OR (account_type IN ('liability', 'equity', 'revenue') AND normal_balance = 'credit')
    OR (scf_code = '709' AND account_type = 'revenue' AND normal_balance = 'debit')
);

INSERT INTO finance.accounts
    (scf_code, legacy_code, name_fr, name_en, account_type, normal_balance, parent_id, is_postable, is_control, control_kind)
VALUES
    ('709', 'SALES_DISCOUNT', 'Rabais, remises et ristournes accordés', 'Discounts granted on sales',
     'revenue', 'debit', (SELECT id FROM finance.accounts WHERE scf_code = '70'), true, false, NULL)
ON CONFLICT (scf_code) DO NOTHING;

-- =============================================================================
-- 3. Sale header gains a discount column
-- =============================================================================

ALTER TABLE sales.cash_sales
    ADD COLUMN IF NOT EXISTS discount_amount numeric(14, 2) NOT NULL DEFAULT 0;

-- The original table deliberately asserted total_amount = subtotal and its own
-- comment said a future slice introducing discounts would relax it on purpose.
-- This is that slice.
ALTER TABLE sales.cash_sales
    DROP CONSTRAINT IF EXISTS cash_sales_total_matches_subtotal;

ALTER TABLE sales.cash_sales
    DROP CONSTRAINT IF EXISTS cash_sales_discount_non_negative;
ALTER TABLE sales.cash_sales
    ADD CONSTRAINT cash_sales_discount_non_negative CHECK (discount_amount >= 0);

ALTER TABLE sales.cash_sales
    DROP CONSTRAINT IF EXISTS cash_sales_discount_within_subtotal;
ALTER TABLE sales.cash_sales
    ADD CONSTRAINT cash_sales_discount_within_subtotal CHECK (discount_amount <= subtotal);

ALTER TABLE sales.cash_sales
    DROP CONSTRAINT IF EXISTS cash_sales_total_is_subtotal_less_discount;
ALTER TABLE sales.cash_sales
    ADD CONSTRAINT cash_sales_total_is_subtotal_less_discount
    CHECK (total_amount = subtotal - discount_amount);

-- =============================================================================
-- 4. Replace the cash-sale posting function
-- =============================================================================

DROP FUNCTION IF EXISTS sales.confirm_cash_sale(text, uuid, bytea, bigint, bigint, bigint, date, jsonb);

CREATE FUNCTION sales.confirm_cash_sale(
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
    -- WS-F-003 addition 1 of 4: discount state.
    v_discount numeric(14, 2);
    v_net_total numeric(14, 2);
    v_journal_line_number integer;
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

    -- WS-F-003 addition 2 of 4: validate the discount and, if there is one,
    -- require the discount permission on top of POST_CASH_SALE. A sale with no
    -- discount is unaffected and any cashier may still post it.
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

    -- 7. Process each line: validate, issue stock, accumulate COGS.
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

    -- WS-F-003 addition 3 of 4: the discount may not exceed what was sold, and
    -- the net total is what the customer actually pays.
    IF v_discount > v_subtotal THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: discount exceeds the sale total'
            USING ERRCODE = '22023';
    END IF;
    v_net_total := v_subtotal - v_discount;

    -- 8. Finalize the sale header's exact totals.
    UPDATE sales.cash_sales
        SET subtotal = v_subtotal,
            discount_amount = v_discount,
            total_amount = v_net_total
        WHERE document_id = v_document_id;

    -- 9. Balanced journal -- revenue is credited gross, the discount is debited
    -- to its own account, and cash receives only the net. COGS is unchanged.
    INSERT INTO core.business_documents (document_type, document_date, fiscal_period_id, fiscal_year)
        VALUES ('JOURNAL_ENTRY', p_document_date, p_fiscal_period_id, v_fiscal_year)
        RETURNING id INTO v_journal_document_id;

    INSERT INTO finance.journal_entries (document_id, description, source_type, source_id)
        VALUES (v_journal_document_id, 'Cash sale', 'CASH_SALE', v_document_id);

    -- WS-F-003 addition 4 of 4: three-line revenue posting when a discount is
    -- present, otherwise exactly the two lines that were posted before.
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

    -- 11. Record the cash movement -- the drawer receives the net, not the gross.
    INSERT INTO cash.movements (cash_session_id, business_document_id, movement_type, amount)
        VALUES (p_cash_session_id, v_document_id, 'SALE', v_net_total);

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
$function$;

-- =============================================================================
-- 5. Privileges
-- =============================================================================

REVOKE ALL ON FUNCTION sales.confirm_cash_sale(text, uuid, bytea, bigint, bigint, bigint, date, jsonb, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sales.confirm_cash_sale(text, uuid, bytea, bigint, bigint, bigint, date, jsonb, numeric) TO stockiha_runtime;

-- =============================================================================
-- 6. Update customer capabilities to return can_apply_sale_discount
-- =============================================================================

CREATE OR REPLACE FUNCTION receivables.get_customer_capabilities(p_session_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_user_id bigint;
BEGIN
    SELECT user_id INTO v_user_id FROM iam.resolve_session(p_session_token);

    RETURN jsonb_build_object(
        'can_view_customers', EXISTS (
            SELECT 1 FROM iam.user_roles ur
            JOIN iam.role_permissions rp ON rp.role_id = ur.role_id
            JOIN iam.permissions p ON p.id = rp.permission_id
            WHERE ur.user_id = v_user_id AND p.code = 'VIEW_CUSTOMERS'
        ),
        'can_manage_customers', EXISTS (
            SELECT 1 FROM iam.user_roles ur
            JOIN iam.role_permissions rp ON rp.role_id = ur.role_id
            JOIN iam.permissions p ON p.id = rp.permission_id
            WHERE ur.user_id = v_user_id AND p.code = 'MANAGE_CUSTOMERS'
        ),
        'can_post_credit_sale', EXISTS (
            SELECT 1 FROM iam.user_roles ur
            JOIN iam.role_permissions rp ON rp.role_id = ur.role_id
            JOIN iam.permissions p ON p.id = rp.permission_id
            WHERE ur.user_id = v_user_id AND p.code = 'POST_CREDIT_SALE'
        ),
        'can_post_customer_payment', EXISTS (
            SELECT 1 FROM iam.user_roles ur
            JOIN iam.role_permissions rp ON rp.role_id = ur.role_id
            JOIN iam.permissions p ON p.id = rp.permission_id
            WHERE ur.user_id = v_user_id AND p.code = 'POST_CUSTOMER_PAYMENT'
        ),
        'can_post_customer_refund', EXISTS (
            SELECT 1 FROM iam.user_roles ur
            JOIN iam.role_permissions rp ON rp.role_id = ur.role_id
            JOIN iam.permissions p ON p.id = rp.permission_id
            WHERE ur.user_id = v_user_id AND p.code = 'POST_CUSTOMER_REFUND'
        ),
        'can_manage_drawer_policy', EXISTS (
            SELECT 1 FROM iam.user_roles ur
            JOIN iam.role_permissions rp ON rp.role_id = ur.role_id
            JOIN iam.permissions p ON p.id = rp.permission_id
            WHERE ur.user_id = v_user_id AND p.code = 'MANAGE_DRAWER_POLICY'
        ),
        'can_override_credit_limit', EXISTS (
            SELECT 1 FROM iam.user_roles ur
            JOIN iam.role_permissions rp ON rp.role_id = ur.role_id
            JOIN iam.permissions p ON p.id = rp.permission_id
            WHERE ur.user_id = v_user_id AND p.code = 'OVERRIDE_CREDIT_LIMIT'
        ),
        'can_apply_sale_discount', EXISTS (
            SELECT 1 FROM iam.user_roles ur
            JOIN iam.role_permissions rp ON rp.role_id = ur.role_id
            JOIN iam.permissions p ON p.id = rp.permission_id
            WHERE ur.user_id = v_user_id AND p.code = 'APPLY_SALE_DISCOUNT'
        )
    );
END;
$$;

REVOKE ALL ON FUNCTION receivables.get_customer_capabilities(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION receivables.get_customer_capabilities(text) TO stockiha_runtime;

RESET ROLE;
