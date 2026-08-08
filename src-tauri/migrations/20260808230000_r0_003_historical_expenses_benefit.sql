-- R0-003: Historical Paper-Book V2 Expenses + Manual Sell Benefit Extension
--
-- Forward-only migration extending historical trade staging for PAPER_BOOK_V2.
-- Does NOT modify operational sales, purchases, inventory, cash, bank, AR/AP, or journals.

SET ROLE stockiha_owner;

-- 1. Extend import_profile check constraint on historical_finance_batches
ALTER TABLE onboarding.historical_finance_batches
    DROP CONSTRAINT IF EXISTS historical_finance_batches_profile_valid;

ALTER TABLE onboarding.historical_finance_batches
    ADD CONSTRAINT historical_finance_batches_profile_valid
        CHECK (import_profile IN ('GENERIC_V1', 'PAPER_BOOK_V1', 'PAPER_BOOK_V2'));

-- 2. Add manual_benefit_dzd column and update transaction_type constraint on historical_trade_transactions
ALTER TABLE onboarding.historical_trade_transactions
    ADD COLUMN IF NOT EXISTS manual_benefit_dzd bigint;

ALTER TABLE onboarding.historical_trade_transactions
    DROP CONSTRAINT IF EXISTS historical_trade_txns_type_valid;

ALTER TABLE onboarding.historical_trade_transactions
    ADD CONSTRAINT historical_trade_txns_type_valid
        CHECK (transaction_type IN ('SALE', 'PURCHASE', 'EXPENSE'));

ALTER TABLE onboarding.historical_trade_transactions
    DROP CONSTRAINT IF EXISTS historical_trade_txns_benefit_valid;

ALTER TABLE onboarding.historical_trade_transactions
    ADD CONSTRAINT historical_trade_txns_benefit_valid
        CHECK (manual_benefit_dzd IS NULL OR transaction_type = 'SALE');

-- 3. Make unit_price_dzd nullable and update line_total_source constraint on historical_trade_lines
ALTER TABLE onboarding.historical_trade_lines
    ALTER COLUMN unit_price_dzd DROP NOT NULL;

ALTER TABLE onboarding.historical_trade_lines
    DROP CONSTRAINT IF EXISTS historical_trade_lines_source_valid;

ALTER TABLE onboarding.historical_trade_lines
    ADD CONSTRAINT historical_trade_lines_source_valid
        CHECK (line_total_source IN ('CALCULATED', 'MANUAL_OVERRIDE', 'EXPENSE_AMOUNT'));

-- Function: create_historical_trade_batch (5-argument signature for PAPER_BOOK_V2)
CREATE OR REPLACE FUNCTION onboarding.create_historical_trade_batch(
    p_session_token text,
    p_request_id text,
    p_original_filename text,
    p_content_hash text,
    p_import_profile text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_actor_id bigint;
    v_workstation_id text;
    v_existing onboarding.historical_finance_batches%ROWTYPE;
    v_batch_id bigint;
    v_enabled boolean;
    v_profile text;
BEGIN
    SELECT user_id, workstation_id
    INTO v_actor_id, v_workstation_id
    FROM iam.resolve_session_with_permission(
        p_session_token,
        'MANAGE_HISTORICAL_FINANCE_IMPORT'
    );

    SELECT historical_finance_import_enabled
    INTO v_enabled
    FROM onboarding.feature_settings
    WHERE singleton;

    IF NOT COALESCE(v_enabled, false) THEN
        RAISE EXCEPTION 'historical finance import is disabled'
            USING ERRCODE = '55000';
    END IF;

    IF p_request_id IS NULL OR length(btrim(p_request_id)) NOT BETWEEN 8 AND 128 THEN
        RAISE EXCEPTION 'invalid historical finance request id' USING ERRCODE = '22023';
    END IF;
    IF p_original_filename IS NULL OR btrim(p_original_filename) = '' OR length(p_original_filename) > 255 THEN
        RAISE EXCEPTION 'Excel imports require a safe filename' USING ERRCODE = '22023';
    END IF;

    v_profile := COALESCE(NULLIF(btrim(p_import_profile), ''), 'PAPER_BOOK_V2');
    IF v_profile NOT IN ('GENERIC_V1', 'PAPER_BOOK_V1', 'PAPER_BOOK_V2') THEN
        RAISE EXCEPTION 'invalid import profile' USING ERRCODE = '22023';
    END IF;

    -- Replay protection by request_id
    SELECT *
    INTO v_existing
    FROM onboarding.historical_finance_batches
    WHERE request_id = btrim(p_request_id);

    IF FOUND THEN
        IF v_existing.created_by <> v_actor_id
           OR v_existing.original_filename IS DISTINCT FROM p_original_filename THEN
            RAISE EXCEPTION 'historical finance request id conflicts with an existing request'
                USING ERRCODE = '23505';
        END IF;

        RETURN jsonb_build_object(
            'batchId', v_existing.id,
            'status', v_existing.status,
            'isReplay', true,
            'importProfile', v_existing.import_profile,
            'originalFilename', v_existing.original_filename,
            'contentHash', v_existing.content_hash
        );
    END IF;

    -- Deduplication check by content hash
    IF p_content_hash IS NOT NULL AND btrim(p_content_hash) <> '' THEN
        SELECT *
        INTO v_existing
        FROM onboarding.historical_finance_batches
        WHERE content_hash = btrim(p_content_hash)
          AND status IN ('DRAFT', 'VALIDATED', 'NEEDS_REVIEW', 'APPROVED_FOR_REPORTING');

        IF FOUND THEN
            RAISE EXCEPTION 'this identical dataset has already been imported (batch #%)', v_existing.id
                USING ERRCODE = '23505';
        END IF;
    END IF;

    INSERT INTO onboarding.historical_finance_batches (
        request_id,
        source_type,
        import_profile,
        original_filename,
        content_hash,
        created_by,
        workstation_id
    ) VALUES (
        btrim(p_request_id),
        'EXCEL',
        v_profile,
        btrim(p_original_filename),
        NULLIF(btrim(p_content_hash), ''),
        v_actor_id,
        v_workstation_id
    )
    RETURNING id INTO v_batch_id;

    INSERT INTO onboarding.historical_finance_audit (
        batch_id,
        action_code,
        actor_id,
        workstation_id,
        to_status
    ) VALUES (
        v_batch_id,
        'CREATED',
        v_actor_id,
        v_workstation_id,
        'DRAFT'
    );

    RETURN jsonb_build_object(
        'batchId', v_batch_id,
        'status', 'DRAFT',
        'isReplay', false,
        'importProfile', v_profile,
        'originalFilename', btrim(p_original_filename),
        'contentHash', NULLIF(btrim(p_content_hash), '')
    );
END;
$$;

-- Function: create_historical_trade_batch (4-argument signature delegation for V1 backward compatibility)
CREATE OR REPLACE FUNCTION onboarding.create_historical_trade_batch(
    p_session_token text,
    p_request_id text,
    p_original_filename text,
    p_content_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    RETURN onboarding.create_historical_trade_batch(
        p_session_token,
        p_request_id,
        p_original_filename,
        p_content_hash,
        'PAPER_BOOK_V1'
    );
END;
$$;

-- Function: replace_historical_trade_batch_data (updated for Expenses & Benefit)
CREATE OR REPLACE FUNCTION onboarding.replace_historical_trade_batch_data(
    p_session_token text,
    p_batch_id bigint,
    p_transactions jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_actor_id bigint;
    v_workstation_id text;
    v_batch onboarding.historical_finance_batches%ROWTYPE;
    v_txn jsonb;
    v_line jsonb;
    v_txn_id bigint;
    v_source_seq integer;
    v_first_row integer;
    v_txn_ref text;
    v_date date;
    v_type text;
    v_payment text;
    v_party text;
    v_benefit bigint;
    v_page integer;
    v_line_seq integer;
    v_product_name text;
    v_brand text;
    v_details text;
    v_qty bigint;
    v_unit_price bigint;
    v_manual_total bigint;
    v_calc_total bigint;
    v_eff_total bigint;
    v_total_source text;
    v_override_diff bigint;
    v_matched_product_id bigint;
    v_txn_total bigint;
    v_total_txns integer := 0;
    v_total_lines integer := 0;
    v_unmatched_count integer := 0;
    v_override_count integer := 0;
    v_missing_qty_count integer := 0;
BEGIN
    SELECT user_id, workstation_id
    INTO v_actor_id, v_workstation_id
    FROM iam.resolve_session_with_permission(
        p_session_token,
        'MANAGE_HISTORICAL_FINANCE_IMPORT'
    );

    SELECT *
    INTO v_batch
    FROM onboarding.historical_finance_batches
    WHERE id = p_batch_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'historical finance batch not found' USING ERRCODE = '22023';
    END IF;

    IF v_batch.status = 'APPROVED_FOR_REPORTING' THEN
        RAISE EXCEPTION 'approved historical finance batch cannot be modified' USING ERRCODE = '55000';
    END IF;

    IF p_transactions IS NULL OR jsonb_typeof(p_transactions) <> 'array' THEN
        RAISE EXCEPTION 'transactions must be a json array' USING ERRCODE = '22023';
    END IF;

    -- Delete existing transactions and lines
    DELETE FROM onboarding.historical_trade_transactions WHERE batch_id = p_batch_id;

    FOR v_txn IN SELECT * FROM jsonb_array_elements(p_transactions)
    LOOP
        v_source_seq := (v_txn->>'source_transaction_sequence')::integer;
        v_first_row  := (v_txn->>'source_first_excel_row')::integer;
        v_txn_ref    := NULLIF(btrim(v_txn->>'source_excel_txn_ref'), '');
        v_date       := (v_txn->>'transaction_date')::date;
        v_type       := upper(btrim(v_txn->>'transaction_type'));
        v_payment    := upper(btrim(v_txn->>'payment_status'));
        v_party      := NULLIF(btrim(v_txn->>'party_company'), '');
        v_benefit    := (v_txn->>'manual_benefit_dzd')::bigint;
        v_page       := (v_txn->>'page_number')::integer;

        IF v_type NOT IN ('SALE', 'PURCHASE', 'EXPENSE') THEN
            RAISE EXCEPTION 'invalid transaction_type: %', v_type USING ERRCODE = '22023';
        END IF;
        IF v_payment NOT IN ('PAID', 'UNPAID') THEN
            RAISE EXCEPTION 'invalid payment_status: %', v_payment USING ERRCODE = '22023';
        END IF;
        IF v_type <> 'SALE' AND v_benefit IS NOT NULL THEN
            RAISE EXCEPTION 'manual_benefit_dzd is only allowed for SALE transactions' USING ERRCODE = '22023';
        END IF;

        INSERT INTO onboarding.historical_trade_transactions (
            batch_id,
            source_transaction_sequence,
            source_first_excel_row,
            source_excel_txn_ref,
            transaction_date,
            transaction_type,
            payment_status,
            party_company,
            manual_benefit_dzd,
            page_number,
            transaction_total_dzd
        ) VALUES (
            p_batch_id,
            v_source_seq,
            v_first_row,
            v_txn_ref,
            v_date,
            v_type,
            v_payment,
            v_party,
            v_benefit,
            v_page,
            0
        ) RETURNING id INTO v_txn_id;

        v_total_txns := v_total_txns + 1;
        v_txn_total  := 0;

        FOR v_line IN SELECT * FROM jsonb_array_elements(v_txn->'lines')
        LOOP
            v_line_seq     := (v_line->>'line_sequence')::integer;
            v_product_name := NULLIF(btrim(v_line->>'product_name'), '');
            v_brand        := NULLIF(btrim(v_line->>'brand'), '');
            v_details      := NULLIF(btrim(v_line->>'custom_details'), '');
            v_qty          := (v_line->>'quantity')::bigint;
            v_unit_price   := (v_line->>'unit_price_dzd')::bigint;
            v_manual_total := (v_line->>'manual_line_total_dzd')::bigint;

            IF v_type = 'EXPENSE' THEN
                IF v_qty IS NULL AND v_unit_price IS NULL THEN
                    IF v_manual_total IS NULL THEN
                        RAISE EXCEPTION 'expense line requires manual_line_total_dzd when quantity and unit_price are omitted' USING ERRCODE = '22023';
                    END IF;
                    v_calc_total := NULL;
                    v_eff_total := v_manual_total;
                    v_total_source := 'EXPENSE_AMOUNT';
                    v_override_diff := 0;
                ELSE
                    v_calc_total := COALESCE(v_qty, 1) * COALESCE(v_unit_price, 0);
                    IF v_manual_total IS NOT NULL THEN
                        v_eff_total := v_manual_total;
                        v_total_source := 'EXPENSE_AMOUNT';
                        v_override_diff := v_manual_total - v_calc_total;
                    ELSE
                        v_eff_total := v_calc_total;
                        v_total_source := 'CALCULATED';
                        v_override_diff := 0;
                    END IF;
                END IF;
            ELSE
                -- SALE or PURCHASE
                IF v_unit_price IS NULL THEN
                    RAISE EXCEPTION 'unit_price_dzd is required for SALE and PURCHASE' USING ERRCODE = '22023';
                END IF;
                IF v_qty IS NOT NULL THEN
                    v_calc_total := v_qty * v_unit_price;
                ELSE
                    v_calc_total := NULL;
                    v_missing_qty_count := v_missing_qty_count + 1;
                END IF;

                IF v_manual_total IS NOT NULL THEN
                    v_eff_total := v_manual_total;
                    v_total_source := 'MANUAL_OVERRIDE';
                    v_override_count := v_override_count + 1;
                    v_override_diff := CASE WHEN v_calc_total IS NOT NULL THEN v_manual_total - v_calc_total ELSE 0 END;
                ELSE
                    IF v_calc_total IS NULL THEN
                        RAISE EXCEPTION 'quantity or manual_line_total_dzd is required for SALE and PURCHASE' USING ERRCODE = '22023';
                    END IF;
                    v_eff_total := v_calc_total;
                    v_total_source := 'CALCULATED';
                    v_override_diff := 0;
                END IF;
            END IF;

            -- Exact string match against catalog.products
            v_matched_product_id := NULL;
            IF v_product_name IS NOT NULL THEN
                SELECT id INTO v_matched_product_id
                FROM catalog.products
                WHERE lower(btrim(name)) = lower(btrim(v_product_name))
                LIMIT 1;
            END IF;

            IF v_product_name IS NOT NULL AND v_matched_product_id IS NULL THEN
                v_unmatched_count := v_unmatched_count + 1;
            END IF;

            INSERT INTO onboarding.historical_trade_lines (
                transaction_id,
                source_row_number,
                line_sequence,
                product_name,
                matched_product_id,
                brand,
                custom_details,
                quantity,
                unit_price_dzd,
                calculated_line_total_dzd,
                effective_line_total_dzd,
                line_total_source,
                override_difference_dzd
            ) VALUES (
                v_txn_id,
                (v_line->>'source_row_number')::integer,
                v_line_seq,
                v_product_name,
                v_matched_product_id,
                v_brand,
                v_details,
                v_qty,
                v_unit_price,
                v_calc_total,
                v_eff_total,
                v_total_source,
                v_override_diff
            );

            v_total_lines := v_total_lines + 1;
            v_txn_total   := v_txn_total + v_eff_total;
        END LOOP;

        UPDATE onboarding.historical_trade_transactions
        SET transaction_total_dzd = v_txn_total
        WHERE id = v_txn_id;
    END LOOP;

    UPDATE onboarding.historical_finance_batches
    SET status = 'DRAFT',
        validated_at = NULL,
        row_count = v_total_txns,
        total_lines = v_total_lines,
        unmatched_product_count = v_unmatched_count,
        override_count = v_override_count,
        missing_qty_count = v_missing_qty_count,
        invalid_row_count = 0,
        total_sales_dzd = 0,
        total_purchases_dzd = 0
    WHERE id = p_batch_id;

    INSERT INTO onboarding.historical_finance_audit (
        batch_id,
        action_code,
        actor_id,
        workstation_id,
        from_status,
        to_status,
        reason
    ) VALUES (
        p_batch_id,
        'DATA_REPLACED',
        v_actor_id,
        v_workstation_id,
        v_batch.status,
        'DRAFT',
        format('%s trade transactions and %s product lines', v_total_txns, v_total_lines)
    );

    RETURN jsonb_build_object(
        'batchId', p_batch_id,
        'status', 'DRAFT',
        'transactionCount', v_total_txns,
        'lineCount', v_total_lines,
        'unmatchedProductCount', v_unmatched_count,
        'overrideCount', v_override_count,
        'missingQtyCount', v_missing_qty_count
    );
END;
$$;

-- Function: validate_historical_trade_batch (updated for Expenses & Benefit)
CREATE OR REPLACE FUNCTION onboarding.validate_historical_trade_batch(
    p_session_token text,
    p_batch_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_actor_id bigint;
    v_workstation_id text;
    v_batch onboarding.historical_finance_batches%ROWTYPE;
    v_total_txns integer := 0;
    v_total_lines integer := 0;
    v_total_sales bigint := 0;
    v_total_purchases bigint := 0;
    v_total_expenses bigint := 0;
    v_paid_sales bigint := 0;
    v_unpaid_sales bigint := 0;
    v_paid_purchases bigint := 0;
    v_unpaid_purchases bigint := 0;
    v_paid_expenses bigint := 0;
    v_unpaid_expenses bigint := 0;
    v_manual_benefit_count integer := 0;
    v_total_manual_benefit bigint := 0;
    v_unmatched integer := 0;
    v_override integer := 0;
    v_missing_qty integer := 0;
    v_invalid_count integer := 0;
    v_status text;
BEGIN
    SELECT user_id, workstation_id
    INTO v_actor_id, v_workstation_id
    FROM iam.resolve_session_with_permission(
        p_session_token,
        'MANAGE_HISTORICAL_FINANCE_IMPORT'
    );

    SELECT *
    INTO v_batch
    FROM onboarding.historical_finance_batches
    WHERE id = p_batch_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'historical finance batch not found' USING ERRCODE = '22023';
    END IF;
    IF v_batch.status IN ('APPROVED_FOR_REPORTING', 'REJECTED') THEN
        RAISE EXCEPTION 'historical finance batch is immutable after decision' USING ERRCODE = '55000';
    END IF;

    -- Update validation errors on transactions
    UPDATE onboarding.historical_trade_transactions t
    SET validation_errors = to_jsonb(array_remove(ARRAY[
        CASE WHEN t.transaction_date > current_date THEN 'FUTURE_DATE' END,
        CASE WHEN t.review_status = 'NEEDS_REVIEW' THEN 'TRANSACTION_NEEDS_REVIEW' END,
        CASE WHEN NOT EXISTS (
            SELECT 1 FROM onboarding.historical_trade_lines l WHERE l.transaction_id = t.id
        ) THEN 'NO_PRODUCT_LINES' END
    ]::text[], NULL))
    WHERE t.batch_id = p_batch_id;

    -- Update validation warnings/errors on lines
    UPDATE onboarding.historical_trade_lines l
    SET validation_errors = to_jsonb(array_remove(ARRAY[
        CASE WHEN l.product_name IS NOT NULL AND l.matched_product_id IS NULL THEN 'UNMATCHED_PRODUCT_NAME' END,
        CASE WHEN l.line_total_source = 'MANUAL_OVERRIDE' THEN 'MANUAL_LINE_TOTAL_OVERRIDE' END,
        CASE WHEN l.quantity IS NULL AND t.transaction_type <> 'EXPENSE' THEN 'MISSING_QUANTITY' END,
        CASE WHEN l.product_name IS NULL AND t.transaction_type <> 'EXPENSE' THEN 'MISSING_PRODUCT_NAME' END
    ]::text[], NULL))
    FROM onboarding.historical_trade_transactions t
    WHERE t.id = l.transaction_id
      AND t.batch_id = p_batch_id;

    SELECT
        COALESCE(COUNT(*), 0),
        COALESCE(SUM(CASE WHEN transaction_type = 'SALE' THEN transaction_total_dzd ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN transaction_type = 'PURCHASE' THEN transaction_total_dzd ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN transaction_type = 'EXPENSE' THEN transaction_total_dzd ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN transaction_type = 'SALE' AND payment_status = 'PAID' THEN transaction_total_dzd ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN transaction_type = 'SALE' AND payment_status = 'UNPAID' THEN transaction_total_dzd ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN transaction_type = 'PURCHASE' AND payment_status = 'PAID' THEN transaction_total_dzd ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN transaction_type = 'PURCHASE' AND payment_status = 'UNPAID' THEN transaction_total_dzd ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN transaction_type = 'EXPENSE' AND payment_status = 'PAID' THEN transaction_total_dzd ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN transaction_type = 'EXPENSE' AND payment_status = 'UNPAID' THEN transaction_total_dzd ELSE 0 END), 0),
        COALESCE(COUNT(CASE WHEN manual_benefit_dzd IS NOT NULL THEN 1 END), 0),
        COALESCE(SUM(COALESCE(manual_benefit_dzd, 0)), 0)
    INTO
        v_total_txns,
        v_total_sales,
        v_total_purchases,
        v_total_expenses,
        v_paid_sales,
        v_unpaid_sales,
        v_paid_purchases,
        v_unpaid_purchases,
        v_paid_expenses,
        v_unpaid_expenses,
        v_manual_benefit_count,
        v_total_manual_benefit
    FROM onboarding.historical_trade_transactions
    WHERE batch_id = p_batch_id;

    SELECT
        COALESCE(COUNT(*), 0),
        COALESCE(COUNT(CASE WHEN product_name IS NOT NULL AND matched_product_id IS NULL THEN 1 END), 0),
        COALESCE(COUNT(CASE WHEN line_total_source = 'MANUAL_OVERRIDE' THEN 1 END), 0),
        COALESCE(COUNT(CASE WHEN quantity IS NULL THEN 1 END), 0)
    INTO
        v_total_lines,
        v_unmatched,
        v_override,
        v_missing_qty
    FROM onboarding.historical_trade_lines l
    JOIN onboarding.historical_trade_transactions t ON t.id = l.transaction_id
    WHERE t.batch_id = p_batch_id;

    IF v_total_txns = 0 THEN
        v_invalid_count := 1;
    END IF;

    v_status := CASE WHEN v_invalid_count = 0 THEN 'VALIDATED' ELSE 'NEEDS_REVIEW' END;

    UPDATE onboarding.historical_finance_batches
    SET status = v_status,
        validated_at = now(),
        row_count = v_total_txns,
        invalid_row_count = v_invalid_count,
        total_lines = v_total_lines,
        unmatched_product_count = v_unmatched,
        override_count = v_override,
        missing_qty_count = v_missing_qty,
        total_sales_dzd = v_total_sales,
        total_purchases_dzd = v_total_purchases,
        total_expenses_dzd = v_total_expenses
    WHERE id = p_batch_id;

    INSERT INTO onboarding.historical_finance_audit (
        batch_id,
        action_code,
        actor_id,
        workstation_id,
        from_status,
        to_status,
        reason
    ) VALUES (
        p_batch_id,
        'VALIDATED',
        v_actor_id,
        v_workstation_id,
        v_batch.status,
        v_status,
        format('%s trade transactions, %s validation issues', v_total_txns, v_invalid_count)
    );

    RETURN jsonb_build_object(
        'batchId', p_batch_id,
        'status', v_status,
        'transactionCount', v_total_txns,
        'lineCount', v_total_lines,
        'invalidRowCount', v_invalid_count,
        'totalSalesDzd', v_total_sales,
        'totalPurchasesDzd', v_total_purchases,
        'totalExpensesDzd', v_total_expenses,
        'paidSalesDzd', v_paid_sales,
        'unpaidSalesDzd', v_unpaid_sales,
        'paidPurchasesDzd', v_paid_purchases,
        'unpaidPurchasesDzd', v_unpaid_purchases,
        'paidExpensesDzd', v_paid_expenses,
        'unpaidExpensesDzd', v_unpaid_expenses,
        'manualBenefitCount', v_manual_benefit_count,
        'totalManualBenefitDzd', v_total_manual_benefit,
        'unmatchedProductCount', v_unmatched,
        'overrideCount', v_override,
        'missingQtyCount', v_missing_qty
    );
END;
$$;

-- Function: approve_historical_trade_batch
CREATE OR REPLACE FUNCTION onboarding.approve_historical_trade_batch(
    p_session_token text,
    p_batch_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_actor_id bigint;
    v_workstation_id text;
    v_batch onboarding.historical_finance_batches%ROWTYPE;
BEGIN
    SELECT user_id, workstation_id
    INTO v_actor_id, v_workstation_id
    FROM iam.resolve_session_with_permission(
        p_session_token,
        'REVIEW_HISTORICAL_FINANCE_IMPORT'
    );

    SELECT *
    INTO v_batch
    FROM onboarding.historical_finance_batches
    WHERE id = p_batch_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'historical finance batch not found' USING ERRCODE = '22023';
    END IF;

    IF v_batch.status = 'APPROVED_FOR_REPORTING' THEN
        RETURN jsonb_build_object(
            'batchId', p_batch_id,
            'status', 'APPROVED_FOR_REPORTING',
            'isReplay', true
        );
    END IF;

    IF v_batch.status <> 'VALIDATED' OR v_batch.invalid_row_count <> 0 THEN
        RAISE EXCEPTION 'only a fully validated historical finance batch can be approved'
            USING ERRCODE = '55000';
    END IF;

    UPDATE onboarding.historical_trade_transactions
    SET review_status = 'APPROVED'
    WHERE batch_id = p_batch_id
      AND review_status = 'READY';

    UPDATE onboarding.historical_finance_batches
    SET status = 'APPROVED_FOR_REPORTING',
        approved_by = v_actor_id,
        approved_at = now()
    WHERE id = p_batch_id;

    INSERT INTO onboarding.historical_finance_audit (
        batch_id,
        action_code,
        actor_id,
        workstation_id,
        from_status,
        to_status
    ) VALUES (
        p_batch_id,
        'APPROVED',
        v_actor_id,
        v_workstation_id,
        v_batch.status,
        'APPROVED_FOR_REPORTING'
    );

    RETURN jsonb_build_object(
        'batchId', p_batch_id,
        'status', 'APPROVED_FOR_REPORTING',
        'isReplay', false
    );
END;
$$;

-- Function: get_historical_trade_analytics (updated for Expenses & Manual Sell Benefit)
CREATE OR REPLACE FUNCTION onboarding.get_historical_trade_analytics(
    p_session_token text,
    p_date_from date,
    p_date_to date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_actor_id bigint;
    v_workstation_id text;
    v_overview jsonb;
    v_payment jsonb;
    v_timeline jsonb;
    v_products jsonb;
    v_brands jsonb;
    v_parties jsonb;
    v_data_quality jsonb;
    v_manual_overrides jsonb;
    v_expenses jsonb;
    v_benefits jsonb;
BEGIN
    SELECT user_id, workstation_id
    INTO v_actor_id, v_workstation_id
    FROM iam.resolve_session_with_permission(
        p_session_token,
        'MANAGE_HISTORICAL_FINANCE_IMPORT'
    );

    IF p_date_from IS NULL OR p_date_to IS NULL OR p_date_from > p_date_to THEN
        RAISE EXCEPTION 'invalid date range for historical trade analytics' USING ERRCODE = '22023';
    END IF;

    -- Overview section
    SELECT jsonb_build_object(
        'transactionCount', COALESCE(COUNT(DISTINCT t.id), 0),
        'lineCount', COALESCE(COUNT(l.id), 0),
        'totalSalesDzd', COALESCE(SUM(CASE WHEN t.transaction_type = 'SALE' THEN l.effective_line_total_dzd ELSE 0 END), 0),
        'totalPurchasesDzd', COALESCE(SUM(CASE WHEN t.transaction_type = 'PURCHASE' THEN l.effective_line_total_dzd ELSE 0 END), 0),
        'totalExpensesDzd', COALESCE(SUM(CASE WHEN t.transaction_type = 'EXPENSE' THEN l.effective_line_total_dzd ELSE 0 END), 0),
        'paidSalesDzd', COALESCE(SUM(CASE WHEN t.transaction_type = 'SALE' AND t.payment_status = 'PAID' THEN l.effective_line_total_dzd ELSE 0 END), 0),
        'unpaidSalesDzd', COALESCE(SUM(CASE WHEN t.transaction_type = 'SALE' AND t.payment_status = 'UNPAID' THEN l.effective_line_total_dzd ELSE 0 END), 0),
        'paidPurchasesDzd', COALESCE(SUM(CASE WHEN t.transaction_type = 'PURCHASE' AND t.payment_status = 'PAID' THEN l.effective_line_total_dzd ELSE 0 END), 0),
        'unpaidPurchasesDzd', COALESCE(SUM(CASE WHEN t.transaction_type = 'PURCHASE' AND t.payment_status = 'UNPAID' THEN l.effective_line_total_dzd ELSE 0 END), 0),
        'paidExpensesDzd', COALESCE(SUM(CASE WHEN t.transaction_type = 'EXPENSE' AND t.payment_status = 'PAID' THEN l.effective_line_total_dzd ELSE 0 END), 0),
        'unpaidExpensesDzd', COALESCE(SUM(CASE WHEN t.transaction_type = 'EXPENSE' AND t.payment_status = 'UNPAID' THEN l.effective_line_total_dzd ELSE 0 END), 0),
        'totalManualBenefitDzd', COALESCE(SUM(DISTINCT CASE WHEN t.transaction_type = 'SALE' THEN t.manual_benefit_dzd ELSE 0 END), 0),
        'tradeDifferenceDzd',
            COALESCE(SUM(CASE WHEN t.transaction_type = 'SALE' THEN l.effective_line_total_dzd ELSE 0 END), 0) -
            COALESCE(SUM(CASE WHEN t.transaction_type = 'PURCHASE' THEN l.effective_line_total_dzd ELSE 0 END), 0) -
            COALESCE(SUM(CASE WHEN t.transaction_type = 'EXPENSE' THEN l.effective_line_total_dzd ELSE 0 END), 0)
    ) INTO v_overview
    FROM onboarding.historical_trade_transactions t
    JOIN onboarding.historical_finance_batches b ON b.id = t.batch_id
    LEFT JOIN onboarding.historical_trade_lines l ON l.transaction_id = t.id
    WHERE b.status = 'APPROVED_FOR_REPORTING'
      AND t.transaction_date BETWEEN p_date_from AND p_date_to;

    -- Payment section
    SELECT jsonb_build_object(
        'sales', jsonb_build_object(
            'total', COALESCE(SUM(CASE WHEN t.transaction_type = 'SALE' THEN l.effective_line_total_dzd ELSE 0 END), 0),
            'paid', COALESCE(SUM(CASE WHEN t.transaction_type = 'SALE' AND t.payment_status = 'PAID' THEN l.effective_line_total_dzd ELSE 0 END), 0),
            'unpaid', COALESCE(SUM(CASE WHEN t.transaction_type = 'SALE' AND t.payment_status = 'UNPAID' THEN l.effective_line_total_dzd ELSE 0 END), 0)
        ),
        'purchases', jsonb_build_object(
            'total', COALESCE(SUM(CASE WHEN t.transaction_type = 'PURCHASE' THEN l.effective_line_total_dzd ELSE 0 END), 0),
            'paid', COALESCE(SUM(CASE WHEN t.transaction_type = 'PURCHASE' AND t.payment_status = 'PAID' THEN l.effective_line_total_dzd ELSE 0 END), 0),
            'unpaid', COALESCE(SUM(CASE WHEN t.transaction_type = 'PURCHASE' AND t.payment_status = 'UNPAID' THEN l.effective_line_total_dzd ELSE 0 END), 0)
        ),
        'expenses', jsonb_build_object(
            'total', COALESCE(SUM(CASE WHEN t.transaction_type = 'EXPENSE' THEN l.effective_line_total_dzd ELSE 0 END), 0),
            'paid', COALESCE(SUM(CASE WHEN t.transaction_type = 'EXPENSE' AND t.payment_status = 'PAID' THEN l.effective_line_total_dzd ELSE 0 END), 0),
            'unpaid', COALESCE(SUM(CASE WHEN t.transaction_type = 'EXPENSE' AND t.payment_status = 'UNPAID' THEN l.effective_line_total_dzd ELSE 0 END), 0)
        )
    ) INTO v_payment
    FROM onboarding.historical_trade_transactions t
    JOIN onboarding.historical_finance_batches b ON b.id = t.batch_id
    LEFT JOIN onboarding.historical_trade_lines l ON l.transaction_id = t.id
    WHERE b.status = 'APPROVED_FOR_REPORTING'
      AND t.transaction_date BETWEEN p_date_from AND p_date_to;

    -- Timeline section
    SELECT COALESCE(jsonb_agg(month_row ORDER BY month_row->>'yearMonth'), '[]'::jsonb)
    INTO v_timeline
    FROM (
        SELECT jsonb_build_object(
            'yearMonth', to_char(t.transaction_date, 'YYYY-MM'),
            'salesDzd', COALESCE(SUM(CASE WHEN t.transaction_type = 'SALE' THEN l.effective_line_total_dzd ELSE 0 END), 0),
            'purchasesDzd', COALESCE(SUM(CASE WHEN t.transaction_type = 'PURCHASE' THEN l.effective_line_total_dzd ELSE 0 END), 0),
            'expensesDzd', COALESCE(SUM(CASE WHEN t.transaction_type = 'EXPENSE' THEN l.effective_line_total_dzd ELSE 0 END), 0),
            'manualBenefitDzd', COALESCE(SUM(DISTINCT CASE WHEN t.transaction_type = 'SALE' THEN t.manual_benefit_dzd ELSE 0 END), 0),
            'netTradeDifferenceDzd',
                COALESCE(SUM(CASE WHEN t.transaction_type = 'SALE' THEN l.effective_line_total_dzd ELSE 0 END), 0) -
                COALESCE(SUM(CASE WHEN t.transaction_type = 'PURCHASE' THEN l.effective_line_total_dzd ELSE 0 END), 0) -
                COALESCE(SUM(CASE WHEN t.transaction_type = 'EXPENSE' THEN l.effective_line_total_dzd ELSE 0 END), 0)
        ) AS month_row
        FROM onboarding.historical_trade_transactions t
        JOIN onboarding.historical_finance_batches b ON b.id = t.batch_id
        LEFT JOIN onboarding.historical_trade_lines l ON l.transaction_id = t.id
        WHERE b.status = 'APPROVED_FOR_REPORTING'
          AND t.transaction_date BETWEEN p_date_from AND p_date_to
        GROUP BY to_char(t.transaction_date, 'YYYY-MM')
    ) sub;

    -- Products breakdown
    SELECT COALESCE(jsonb_agg(prod_row ORDER BY prod_row->>'salesDzd' DESC), '[]'::jsonb)
    INTO v_products
    FROM (
        SELECT jsonb_build_object(
            'productName', COALESCE(l.product_name, 'Unspecified / Expense'),
            'matchedProductId', max(l.matched_product_id),
            'qtySold', COALESCE(SUM(CASE WHEN t.transaction_type = 'SALE' THEN l.quantity ELSE 0 END), 0),
            'salesDzd', COALESCE(SUM(CASE WHEN t.transaction_type = 'SALE' THEN l.effective_line_total_dzd ELSE 0 END), 0),
            'qtyPurchased', COALESCE(SUM(CASE WHEN t.transaction_type = 'PURCHASE' THEN l.quantity ELSE 0 END), 0),
            'purchasesDzd', COALESCE(SUM(CASE WHEN t.transaction_type = 'PURCHASE' THEN l.effective_line_total_dzd ELSE 0 END), 0)
        ) AS prod_row
        FROM onboarding.historical_trade_lines l
        JOIN onboarding.historical_trade_transactions t ON t.id = l.transaction_id
        JOIN onboarding.historical_finance_batches b ON b.id = t.batch_id
        WHERE b.status = 'APPROVED_FOR_REPORTING'
          AND t.transaction_date BETWEEN p_date_from AND p_date_to
        GROUP BY COALESCE(l.product_name, 'Unspecified / Expense')
    ) sub;

    -- Brands breakdown
    SELECT COALESCE(jsonb_agg(brand_row ORDER BY brand_row->>'salesDzd' DESC), '[]'::jsonb)
    INTO v_brands
    FROM (
        SELECT jsonb_build_object(
            'brand', COALESCE(l.brand, 'Unspecified'),
            'salesDzd', COALESCE(SUM(CASE WHEN t.transaction_type = 'SALE' THEN l.effective_line_total_dzd ELSE 0 END), 0),
            'purchasesDzd', COALESCE(SUM(CASE WHEN t.transaction_type = 'PURCHASE' THEN l.effective_line_total_dzd ELSE 0 END), 0)
        ) AS brand_row
        FROM onboarding.historical_trade_lines l
        JOIN onboarding.historical_trade_transactions t ON t.id = l.transaction_id
        JOIN onboarding.historical_finance_batches b ON b.id = t.batch_id
        WHERE b.status = 'APPROVED_FOR_REPORTING'
          AND t.transaction_date BETWEEN p_date_from AND p_date_to
        GROUP BY COALESCE(l.brand, 'Unspecified')
    ) sub;

    -- Parties breakdown
    SELECT COALESCE(jsonb_agg(party_row ORDER BY party_row->>'totalVolumeDzd' DESC), '[]'::jsonb)
    INTO v_parties
    FROM (
        SELECT jsonb_build_object(
            'partyCompany', COALESCE(t.party_company, 'Unspecified Party'),
            'salesDzd', COALESCE(SUM(CASE WHEN t.transaction_type = 'SALE' THEN l.effective_line_total_dzd ELSE 0 END), 0),
            'purchasesDzd', COALESCE(SUM(CASE WHEN t.transaction_type = 'PURCHASE' THEN l.effective_line_total_dzd ELSE 0 END), 0),
            'expensesDzd', COALESCE(SUM(CASE WHEN t.transaction_type = 'EXPENSE' THEN l.effective_line_total_dzd ELSE 0 END), 0),
            'totalVolumeDzd', COALESCE(SUM(l.effective_line_total_dzd), 0)
        ) AS party_row
        FROM onboarding.historical_trade_transactions t
        JOIN onboarding.historical_finance_batches b ON b.id = t.batch_id
        LEFT JOIN onboarding.historical_trade_lines l ON l.transaction_id = t.id
        WHERE b.status = 'APPROVED_FOR_REPORTING'
          AND t.transaction_date BETWEEN p_date_from AND p_date_to
        GROUP BY COALESCE(t.party_company, 'Unspecified Party')
    ) sub;

    -- Data Quality breakdown
    SELECT jsonb_build_object(
        'totalLines', COALESCE(COUNT(l.id), 0),
        'productNameCoveragePct', CASE WHEN COUNT(l.id) > 0 THEN (COUNT(CASE WHEN l.product_name IS NOT NULL THEN 1 END)::numeric / COUNT(l.id)::numeric) * 100 ELSE 0 END,
        'brandCoveragePct', CASE WHEN COUNT(l.id) > 0 THEN (COUNT(CASE WHEN l.brand IS NOT NULL THEN 1 END)::numeric / COUNT(l.id)::numeric) * 100 ELSE 0 END,
        'partyCoveragePct', CASE WHEN COUNT(DISTINCT t.id) > 0 THEN (COUNT(DISTINCT CASE WHEN t.party_company IS NOT NULL THEN t.id END)::numeric / COUNT(DISTINCT t.id)::numeric) * 100 ELSE 0 END,
        'pageNumberCoveragePct', CASE WHEN COUNT(DISTINCT t.id) > 0 THEN (COUNT(DISTINCT CASE WHEN t.page_number IS NOT NULL THEN t.id END)::numeric / COUNT(DISTINCT t.id)::numeric) * 100 ELSE 0 END,
        'quantityCoveragePct', CASE WHEN COUNT(l.id) > 0 THEN (COUNT(CASE WHEN l.quantity IS NOT NULL THEN 1 END)::numeric / COUNT(l.id)::numeric) * 100 ELSE 0 END,
        'unmatchedProductCount', COALESCE(COUNT(CASE WHEN l.product_name IS NOT NULL AND l.matched_product_id IS NULL THEN 1 END), 0),
        'manualOverrideCount', COALESCE(COUNT(CASE WHEN l.line_total_source = 'MANUAL_OVERRIDE' THEN 1 END), 0)
    ) INTO v_data_quality
    FROM onboarding.historical_trade_transactions t
    JOIN onboarding.historical_finance_batches b ON b.id = t.batch_id
    LEFT JOIN onboarding.historical_trade_lines l ON l.transaction_id = t.id
    WHERE b.status = 'APPROVED_FOR_REPORTING'
      AND t.transaction_date BETWEEN p_date_from AND p_date_to;

    -- Manual Overrides breakdown
    SELECT jsonb_build_object(
        'calculatedLineCount', COALESCE(COUNT(CASE WHEN l.line_total_source = 'CALCULATED' THEN 1 END), 0),
        'manualOverrideCount', COALESCE(COUNT(CASE WHEN l.line_total_source = 'MANUAL_OVERRIDE' THEN 1 END), 0),
        'calculatedMathematicalTotalDzd', COALESCE(SUM(COALESCE(l.calculated_line_total_dzd, l.effective_line_total_dzd)), 0),
        'finalEffectiveTotalDzd', COALESCE(SUM(l.effective_line_total_dzd), 0),
        'totalOverrideDifferenceDzd', COALESCE(SUM(l.override_difference_dzd), 0)
    ) INTO v_manual_overrides
    FROM onboarding.historical_trade_lines l
    JOIN onboarding.historical_trade_transactions t ON t.id = l.transaction_id
    JOIN onboarding.historical_finance_batches b ON b.id = t.batch_id
    WHERE b.status = 'APPROVED_FOR_REPORTING'
      AND t.transaction_date BETWEEN p_date_from AND p_date_to;

    -- Expenses breakdown
    SELECT jsonb_build_object(
        'expenseCount', COALESCE(COUNT(DISTINCT t.id), 0),
        'totalExpensesDzd', COALESCE(SUM(l.effective_line_total_dzd), 0),
        'paidExpensesDzd', COALESCE(SUM(CASE WHEN t.payment_status = 'PAID' THEN l.effective_line_total_dzd ELSE 0 END), 0),
        'unpaidExpensesDzd', COALESCE(SUM(CASE WHEN t.payment_status = 'UNPAID' THEN l.effective_line_total_dzd ELSE 0 END), 0),
        'expenseItems', COALESCE((
            SELECT jsonb_agg(item_row)
            FROM (
                SELECT jsonb_build_object(
                    'transactionDate', t2.transaction_date,
                    'partyCompany', t2.party_company,
                    'customDetails', l2.custom_details,
                    'effectiveLineTotalDzd', l2.effective_line_total_dzd,
                    'paymentStatus', t2.payment_status
                ) AS item_row
                FROM onboarding.historical_trade_transactions t2
                JOIN onboarding.historical_finance_batches b2 ON b2.id = t2.batch_id
                JOIN onboarding.historical_trade_lines l2 ON l2.transaction_id = t2.id
                WHERE b2.status = 'APPROVED_FOR_REPORTING'
                  AND t2.transaction_type = 'EXPENSE'
                  AND t2.transaction_date BETWEEN p_date_from AND p_date_to
                ORDER BY t2.transaction_date DESC, t2.id DESC
            ) sub_item
        ), '[]'::jsonb)
    ) INTO v_expenses
    FROM onboarding.historical_trade_transactions t
    JOIN onboarding.historical_finance_batches b ON b.id = t.batch_id
    LEFT JOIN onboarding.historical_trade_lines l ON l.transaction_id = t.id
    WHERE b.status = 'APPROVED_FOR_REPORTING'
      AND t.transaction_type = 'EXPENSE'
      AND t.transaction_date BETWEEN p_date_from AND p_date_to;

    -- Benefits breakdown
    SELECT jsonb_build_object(
        'salesTransactionCount', COALESCE(COUNT(t.id), 0),
        'totalManualBenefitDzd', COALESCE(SUM(COALESCE(t.manual_benefit_dzd, 0)), 0),
        'salesWithManualBenefitCount', COALESCE(COUNT(CASE WHEN t.manual_benefit_dzd IS NOT NULL THEN 1 END), 0),
        'salesWithoutManualBenefitCount', COALESCE(COUNT(CASE WHEN t.manual_benefit_dzd IS NULL THEN 1 END), 0),
        'averageManualBenefitDzd', CASE
            WHEN COUNT(CASE WHEN t.manual_benefit_dzd IS NOT NULL THEN 1 END) > 0
            THEN COALESCE(SUM(COALESCE(t.manual_benefit_dzd, 0)), 0) / COUNT(CASE WHEN t.manual_benefit_dzd IS NOT NULL THEN 1 END)
            ELSE NULL
        END
    ) INTO v_benefits
    FROM onboarding.historical_trade_transactions t
    JOIN onboarding.historical_finance_batches b ON b.id = t.batch_id
    WHERE b.status = 'APPROVED_FOR_REPORTING'
      AND t.transaction_type = 'SALE'
      AND t.transaction_date BETWEEN p_date_from AND p_date_to;

    RETURN jsonb_build_object(
        'overview', v_overview,
        'payment', v_payment,
        'timeline', v_timeline,
        'products', v_products,
        'brands', v_brands,
        'parties', v_parties,
        'dataQuality', v_data_quality,
        'manualOverrides', v_manual_overrides,
        'expenses', v_expenses,
        'benefits', v_benefits
    );
END;
$$;

GRANT EXECUTE ON FUNCTION onboarding.create_historical_trade_batch(text, text, text, text) TO stockiha_admin;
GRANT EXECUTE ON FUNCTION onboarding.create_historical_trade_batch(text, text, text, text, text) TO stockiha_admin;
GRANT EXECUTE ON FUNCTION onboarding.replace_historical_trade_batch_data(text, bigint, jsonb) TO stockiha_admin;
GRANT EXECUTE ON FUNCTION onboarding.validate_historical_trade_batch(text, bigint) TO stockiha_admin;
GRANT EXECUTE ON FUNCTION onboarding.approve_historical_trade_batch(text, bigint) TO stockiha_admin;
GRANT EXECUTE ON FUNCTION onboarding.get_historical_trade_analytics(text, date, date) TO stockiha_admin;

REVOKE EXECUTE ON FUNCTION onboarding.create_historical_trade_batch(text, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION onboarding.create_historical_trade_batch(text, text, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION onboarding.replace_historical_trade_batch_data(text, bigint, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION onboarding.validate_historical_trade_batch(text, bigint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION onboarding.approve_historical_trade_batch(text, bigint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION onboarding.get_historical_trade_analytics(text, date, date) FROM PUBLIC;
