-- R0-002: Historical Paper-Book XLSX Import & Analytics Staging Foundation
--
-- Isolated historical data staging for paper-book V1 imports (BUY/SELL multi-line transactions).
-- Does NOT create or modify operational sales, purchases, inventory, cash, bank, AR/AP, or journals.
SET ROLE stockiha_owner;

ALTER TABLE onboarding.historical_finance_batches
    ADD COLUMN IF NOT EXISTS import_profile text NOT NULL DEFAULT 'GENERIC_V1',
    ADD COLUMN IF NOT EXISTS content_hash text UNIQUE,
    ADD COLUMN IF NOT EXISTS total_lines integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS unmatched_product_count integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS override_count integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS missing_qty_count integer NOT NULL DEFAULT 0;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'onboarding.historical_finance_batches'::regclass
          AND conname = 'historical_finance_batches_profile_valid'
    ) THEN
        ALTER TABLE onboarding.historical_finance_batches
            ADD CONSTRAINT historical_finance_batches_profile_valid
                CHECK (import_profile IN ('GENERIC_V1', 'PAPER_BOOK_V1'));
    END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS onboarding.historical_trade_transactions (
    id                           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    batch_id                     bigint NOT NULL REFERENCES onboarding.historical_finance_batches(id) ON DELETE RESTRICT,
    source_transaction_sequence  integer NOT NULL,
    source_first_excel_row       integer NOT NULL,
    source_excel_txn_ref         text,
    transaction_date             date NOT NULL,
    transaction_type             text NOT NULL,
    payment_status               text NOT NULL,
    party_company                text,
    page_number                  integer,
    transaction_total_dzd        bigint NOT NULL DEFAULT 0,
    review_status                text NOT NULL DEFAULT 'READY',
    validation_errors            jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at                   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT historical_trade_txns_batch_seq_unique
        UNIQUE (batch_id, source_transaction_sequence),
    CONSTRAINT historical_trade_txns_type_valid
        CHECK (transaction_type IN ('SALE', 'PURCHASE')),
    CONSTRAINT historical_trade_txns_payment_valid
        CHECK (payment_status IN ('PAID', 'UNPAID')),
    CONSTRAINT historical_trade_txns_page_positive
        CHECK (page_number IS NULL OR page_number > 0),
    CONSTRAINT historical_trade_txns_total_nonnegative
        CHECK (transaction_total_dzd >= 0),
    CONSTRAINT historical_trade_txns_review_status_valid
        CHECK (review_status IN ('READY', 'NEEDS_REVIEW', 'APPROVED', 'REJECTED')),
    CONSTRAINT historical_trade_txns_errors_array
        CHECK (jsonb_typeof(validation_errors) = 'array')
);

CREATE INDEX IF NOT EXISTS historical_trade_txns_batch_idx
    ON onboarding.historical_trade_transactions (batch_id, source_transaction_sequence);
CREATE INDEX IF NOT EXISTS historical_trade_txns_date_type_idx
    ON onboarding.historical_trade_transactions (transaction_date, transaction_type);
CREATE INDEX IF NOT EXISTS historical_trade_txns_party_idx
    ON onboarding.historical_trade_transactions (party_company);

CREATE TABLE IF NOT EXISTS onboarding.historical_trade_lines (
    id                           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    transaction_id               bigint NOT NULL REFERENCES onboarding.historical_trade_transactions(id) ON DELETE CASCADE,
    source_row_number            integer NOT NULL,
    line_sequence                integer NOT NULL,
    product_name                 text,
    matched_product_id           bigint REFERENCES catalog.products(id) ON DELETE SET NULL,
    brand                        text,
    custom_details               text,
    quantity                     bigint,
    unit_price_dzd               bigint NOT NULL,
    calculated_line_total_dzd    bigint,
    effective_line_total_dzd     bigint NOT NULL,
    line_total_source            text NOT NULL,
    override_difference_dzd      bigint,
    validation_errors            jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at                   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT historical_trade_lines_txn_seq_unique
        UNIQUE (transaction_id, line_sequence),
    CONSTRAINT historical_trade_lines_qty_positive
        CHECK (quantity IS NULL OR quantity > 0),
    CONSTRAINT historical_trade_lines_price_nonnegative
        CHECK (unit_price_dzd >= 0),
    CONSTRAINT historical_trade_lines_calc_total_nonnegative
        CHECK (calculated_line_total_dzd IS NULL OR calculated_line_total_dzd >= 0),
    CONSTRAINT historical_trade_lines_eff_total_nonnegative
        CHECK (effective_line_total_dzd >= 0),
    CONSTRAINT historical_trade_lines_source_valid
        CHECK (line_total_source IN ('CALCULATED', 'MANUAL_OVERRIDE')),
    CONSTRAINT historical_trade_lines_errors_array
        CHECK (jsonb_typeof(validation_errors) = 'array')
);

CREATE INDEX IF NOT EXISTS historical_trade_lines_txn_idx
    ON onboarding.historical_trade_lines (transaction_id, line_sequence);
CREATE INDEX IF NOT EXISTS historical_trade_lines_product_name_idx
    ON onboarding.historical_trade_lines (product_name);
CREATE INDEX IF NOT EXISTS historical_trade_lines_brand_idx
    ON onboarding.historical_trade_lines (brand);
CREATE INDEX IF NOT EXISTS historical_trade_lines_matched_product_idx
    ON onboarding.historical_trade_lines (matched_product_id);

REVOKE ALL ON onboarding.historical_trade_transactions FROM PUBLIC;
REVOKE ALL ON onboarding.historical_trade_lines FROM PUBLIC;
REVOKE ALL ON onboarding.historical_trade_transactions FROM stockiha_runtime;
REVOKE ALL ON onboarding.historical_trade_lines FROM stockiha_runtime;

-- Function: create_historical_trade_batch
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
DECLARE
    v_actor_id bigint;
    v_workstation_id text;
    v_existing onboarding.historical_finance_batches%ROWTYPE;
    v_batch_id bigint;
    v_enabled boolean;
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

    -- Duplicate dataset protection by content_hash
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
        'PAPER_BOOK_V1',
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
        'importProfile', 'PAPER_BOOK_V1',
        'originalFilename', p_original_filename,
        'contentHash', p_content_hash
    );
END;
$$;

-- Function: replace_historical_trade_batch_data
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
    v_txn_rec record;
    v_line_rec record;
    v_txn_id bigint;
    v_txn_total bigint;
    v_calc_total bigint;
    v_eff_total bigint;
    v_override_diff bigint;
    v_total_txns integer := 0;
    v_total_lines integer := 0;
    v_unmatched_count integer := 0;
    v_override_count integer := 0;
    v_missing_qty_count integer := 0;
    v_matched_id bigint;
BEGIN
    SELECT user_id, workstation_id
    INTO v_actor_id, v_workstation_id
    FROM iam.resolve_session_with_permission(
        p_session_token,
        'MANAGE_HISTORICAL_FINANCE_IMPORT'
    );

    IF jsonb_typeof(p_transactions) <> 'array' THEN
        RAISE EXCEPTION 'historical transactions must be a JSON array'
            USING ERRCODE = '22023';
    END IF;

    SELECT *
    INTO v_batch
    FROM onboarding.historical_finance_batches
    WHERE id = p_batch_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'unknown historical finance batch' USING ERRCODE = '22023';
    END IF;
    IF v_batch.status IN ('APPROVED_FOR_REPORTING', 'REJECTED') THEN
        RAISE EXCEPTION 'historical finance batch is immutable after decision'
            USING ERRCODE = '55000';
    END IF;

    -- Delete existing transactions and lines for this batch
    DELETE FROM onboarding.historical_trade_transactions WHERE batch_id = p_batch_id;

    FOR v_txn_rec IN SELECT * FROM jsonb_to_recordset(p_transactions) AS x(
        source_transaction_sequence integer,
        source_first_excel_row integer,
        source_excel_txn_ref text,
        transaction_date date,
        transaction_type text,
        payment_status text,
        party_company text,
        page_number integer,
        lines jsonb
    ) LOOP
        v_total_txns := v_total_txns + 1;
        v_txn_total := 0;

        INSERT INTO onboarding.historical_trade_transactions (
            batch_id,
            source_transaction_sequence,
            source_first_excel_row,
            source_excel_txn_ref,
            transaction_date,
            transaction_type,
            payment_status,
            party_company,
            page_number,
            transaction_total_dzd,
            review_status
        ) VALUES (
            p_batch_id,
            v_txn_rec.source_transaction_sequence,
            v_txn_rec.source_first_excel_row,
            NULLIF(btrim(v_txn_rec.source_excel_txn_ref), ''),
            v_txn_rec.transaction_date,
            btrim(v_txn_rec.transaction_type),
            btrim(v_txn_rec.payment_status),
            NULLIF(btrim(v_txn_rec.party_company), ''),
            v_txn_rec.page_number,
            0,
            'READY'
        )
        RETURNING id INTO v_txn_id;

        FOR v_line_rec IN SELECT * FROM jsonb_to_recordset(v_txn_rec.lines) AS y(
            source_row_number integer,
            line_sequence integer,
            product_name text,
            brand text,
            custom_details text,
            quantity bigint,
            unit_price_dzd bigint,
            manual_line_total_dzd bigint
        ) LOOP
            v_total_lines := v_total_lines + 1;

            -- Calculate totals and overrides
            IF v_line_rec.quantity IS NOT NULL THEN
                v_calc_total := v_line_rec.quantity * v_line_rec.unit_price_dzd;
            ELSE
                v_calc_total := NULL;
                v_missing_qty_count := v_missing_qty_count + 1;
            END IF;

            IF v_line_rec.manual_line_total_dzd IS NOT NULL THEN
                v_eff_total := v_line_rec.manual_line_total_dzd;
                v_override_count := v_override_count + 1;
                IF v_calc_total IS NOT NULL THEN
                    v_override_diff := v_eff_total - v_calc_total;
                ELSE
                    v_override_diff := NULL;
                END IF;
            ELSE
                IF v_calc_total IS NULL THEN
                    RAISE EXCEPTION 'line at row % has no quantity and no manual line total', v_line_rec.source_row_number
                        USING ERRCODE = '22023';
                END IF;
                v_eff_total := v_calc_total;
                v_override_diff := 0;
            END IF;

            v_txn_total := v_txn_total + v_eff_total;

            -- Product catalog exact matching
            v_matched_id := NULL;
            IF v_line_rec.product_name IS NOT NULL AND btrim(v_line_rec.product_name) <> '' THEN
                SELECT id INTO v_matched_id
                FROM catalog.products
                WHERE lower(btrim(name)) = lower(btrim(v_line_rec.product_name))
                LIMIT 1;

                IF v_matched_id IS NULL THEN
                    v_unmatched_count := v_unmatched_count + 1;
                END IF;
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
                v_line_rec.source_row_number,
                v_line_rec.line_sequence,
                NULLIF(btrim(v_line_rec.product_name), ''),
                v_matched_id,
                NULLIF(btrim(v_line_rec.brand), ''),
                NULLIF(btrim(v_line_rec.custom_details), ''),
                v_line_rec.quantity,
                v_line_rec.unit_price_dzd,
                v_calc_total,
                v_eff_total,
                CASE WHEN v_line_rec.manual_line_total_dzd IS NOT NULL THEN 'MANUAL_OVERRIDE' ELSE 'CALCULATED' END,
                v_override_diff
            );
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

-- Function: validate_historical_trade_batch
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
    v_txn_count integer;
    v_invalid_count integer := 0;
    v_status text;
    v_sales bigint := 0;
    v_purchases bigint := 0;
    v_paid_sales bigint := 0;
    v_unpaid_sales bigint := 0;
    v_paid_purchases bigint := 0;
    v_unpaid_purchases bigint := 0;
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
        RAISE EXCEPTION 'unknown historical finance batch' USING ERRCODE = '22023';
    END IF;
    IF v_batch.status IN ('APPROVED_FOR_REPORTING', 'REJECTED') THEN
        RAISE EXCEPTION 'historical finance batch is immutable after decision'
            USING ERRCODE = '55000';
    END IF;

    -- Update validation errors on transactions
    UPDATE onboarding.historical_trade_transactions t
    SET validation_errors = to_jsonb(array_remove(ARRAY[
        CASE WHEN t.transaction_date > current_date THEN 'FUTURE_DATE' END,
        CASE WHEN t.review_status = 'NEEDS_REVIEW' THEN 'TRANSACTION_NEEDS_REVIEW' END,
        CASE WHEN NOT EXISTS (
            SELECT 1 FROM onboarding.historical_trade_lines l WHERE l.transaction_id = t.id
        ) THEN 'NO_PRODUCT_LINES' END
    ]::text[], NULL));

    -- Update validation warnings/errors on lines
    UPDATE onboarding.historical_trade_lines l
    SET validation_errors = to_jsonb(array_remove(ARRAY[
        CASE WHEN l.product_name IS NOT NULL AND l.matched_product_id IS NULL THEN 'UNMATCHED_PRODUCT_NAME' END,
        CASE WHEN l.line_total_source = 'MANUAL_OVERRIDE' THEN 'MANUAL_LINE_TOTAL_OVERRIDE' END,
        CASE WHEN l.quantity IS NULL THEN 'MISSING_QUANTITY' END,
        CASE WHEN l.product_name IS NULL THEN 'MISSING_PRODUCT_NAME' END
    ]::text[], NULL));

    -- Compute transaction totals and validation stats
    SELECT
        count(*),
        count(*) FILTER (WHERE jsonb_array_length(validation_errors) > 0),
        COALESCE(sum(transaction_total_dzd) FILTER (WHERE transaction_type = 'SALE'), 0),
        COALESCE(sum(transaction_total_dzd) FILTER (WHERE transaction_type = 'PURCHASE'), 0),
        COALESCE(sum(transaction_total_dzd) FILTER (WHERE transaction_type = 'SALE' AND payment_status = 'PAID'), 0),
        COALESCE(sum(transaction_total_dzd) FILTER (WHERE transaction_type = 'SALE' AND payment_status = 'UNPAID'), 0),
        COALESCE(sum(transaction_total_dzd) FILTER (WHERE transaction_type = 'PURCHASE' AND payment_status = 'PAID'), 0),
        COALESCE(sum(transaction_total_dzd) FILTER (WHERE transaction_type = 'PURCHASE' AND payment_status = 'UNPAID'), 0)
    INTO
        v_txn_count,
        v_invalid_count,
        v_sales,
        v_purchases,
        v_paid_sales,
        v_unpaid_sales,
        v_paid_purchases,
        v_unpaid_purchases
    FROM onboarding.historical_trade_transactions
    WHERE batch_id = p_batch_id;

    IF v_txn_count = 0 THEN
        v_invalid_count := v_invalid_count + 1;
    END IF;

    v_status := CASE WHEN v_invalid_count = 0 THEN 'VALIDATED' ELSE 'NEEDS_REVIEW' END;

    UPDATE onboarding.historical_finance_batches
    SET status = v_status,
        validated_at = now(),
        row_count = v_txn_count,
        invalid_row_count = v_invalid_count,
        total_sales_dzd = v_sales,
        total_purchases_dzd = v_purchases
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
        format('%s trade transactions, %s validation issues', v_txn_count, v_invalid_count)
    );

    RETURN jsonb_build_object(
        'batchId', p_batch_id,
        'status', v_status,
        'transactionCount', v_txn_count,
        'lineCount', v_batch.total_lines,
        'invalidRowCount', v_invalid_count,
        'totalSalesDzd', v_sales,
        'totalPurchasesDzd', v_purchases,
        'paidSalesDzd', v_paid_sales,
        'unpaidSalesDzd', v_unpaid_sales,
        'paidPurchasesDzd', v_paid_purchases,
        'unpaidPurchasesDzd', v_unpaid_purchases,
        'unmatchedProductCount', v_batch.unmatched_product_count,
        'overrideCount', v_batch.override_count,
        'missingQtyCount', v_batch.missing_qty_count
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
        RAISE EXCEPTION 'unknown historical finance batch' USING ERRCODE = '22023';
    END IF;
    IF v_batch.status = 'APPROVED_FOR_REPORTING' THEN
        RETURN jsonb_build_object(
            'batchId', v_batch.id,
            'status', v_batch.status,
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

-- Function: get_historical_trade_analytics
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
    v_overview jsonb;
    v_payment jsonb;
    v_timeline jsonb;
    v_products jsonb;
    v_brands jsonb;
    v_parties jsonb;
    v_quality jsonb;
    v_overrides jsonb;
BEGIN
    PERFORM 1
    FROM iam.resolve_session_with_permission(
        p_session_token,
        'REVIEW_HISTORICAL_FINANCE_IMPORT'
    );

    IF p_date_from IS NULL OR p_date_to IS NULL OR p_date_from > p_date_to THEN
        RAISE EXCEPTION 'invalid historical trade report period' USING ERRCODE = '22023';
    END IF;

    -- 1. Overview
    SELECT jsonb_build_object(
        'dateFrom', p_date_from,
        'dateTo', p_date_to,
        'transactionCount', COALESCE(count(t.id), 0),
        'lineCount', COALESCE((
            SELECT count(l.id)
            FROM onboarding.historical_trade_lines l
            JOIN onboarding.historical_trade_transactions t2 ON t2.id = l.transaction_id
            JOIN onboarding.historical_finance_batches b2 ON b2.id = t2.batch_id
            WHERE b2.status = 'APPROVED_FOR_REPORTING'
              AND t2.review_status = 'APPROVED'
              AND t2.transaction_date BETWEEN p_date_from AND p_date_to
        ), 0),
        'totalSalesDzd', COALESCE(sum(t.transaction_total_dzd) FILTER (WHERE t.transaction_type = 'SALE'), 0),
        'totalPurchasesDzd', COALESCE(sum(t.transaction_total_dzd) FILTER (WHERE t.transaction_type = 'PURCHASE'), 0),
        'paidSalesDzd', COALESCE(sum(t.transaction_total_dzd) FILTER (WHERE t.transaction_type = 'SALE' AND t.payment_status = 'PAID'), 0),
        'unpaidSalesDzd', COALESCE(sum(t.transaction_total_dzd) FILTER (WHERE t.transaction_type = 'SALE' AND t.payment_status = 'UNPAID'), 0),
        'paidPurchasesDzd', COALESCE(sum(t.transaction_total_dzd) FILTER (WHERE t.transaction_type = 'PURCHASE' AND t.payment_status = 'PAID'), 0),
        'unpaidPurchasesDzd', COALESCE(sum(t.transaction_total_dzd) FILTER (WHERE t.transaction_type = 'PURCHASE' AND t.payment_status = 'UNPAID'), 0),
        'avgSaleValueDzd', CASE
            WHEN count(t.id) FILTER (WHERE t.transaction_type = 'SALE') > 0
            THEN sum(t.transaction_total_dzd) FILTER (WHERE t.transaction_type = 'SALE') / count(t.id) FILTER (WHERE t.transaction_type = 'SALE')
            ELSE 0 END,
        'avgPurchaseValueDzd', CASE
            WHEN count(t.id) FILTER (WHERE t.transaction_type = 'PURCHASE') > 0
            THEN sum(t.transaction_total_dzd) FILTER (WHERE t.transaction_type = 'PURCHASE') / count(t.id) FILTER (WHERE t.transaction_type = 'PURCHASE')
            ELSE 0 END,
        'tradeDifferenceDzd',
            COALESCE(sum(t.transaction_total_dzd) FILTER (WHERE t.transaction_type = 'SALE'), 0) -
            COALESCE(sum(t.transaction_total_dzd) FILTER (WHERE t.transaction_type = 'PURCHASE'), 0)
    )
    INTO v_overview
    FROM onboarding.historical_trade_transactions t
    JOIN onboarding.historical_finance_batches b ON b.id = t.batch_id
    WHERE b.status = 'APPROVED_FOR_REPORTING'
      AND t.review_status = 'APPROVED'
      AND t.transaction_date BETWEEN p_date_from AND p_date_to;

    -- 2. Payment Analysis
    SELECT jsonb_build_object(
        'sales', jsonb_build_object(
            'total', COALESCE(sum(t.transaction_total_dzd) FILTER (WHERE t.transaction_type = 'SALE'), 0),
            'paid', COALESCE(sum(t.transaction_total_dzd) FILTER (WHERE t.transaction_type = 'SALE' AND t.payment_status = 'PAID'), 0),
            'unpaid', COALESCE(sum(t.transaction_total_dzd) FILTER (WHERE t.transaction_type = 'SALE' AND t.payment_status = 'UNPAID'), 0)
        ),
        'purchases', jsonb_build_object(
            'total', COALESCE(sum(t.transaction_total_dzd) FILTER (WHERE t.transaction_type = 'PURCHASE'), 0),
            'paid', COALESCE(sum(t.transaction_total_dzd) FILTER (WHERE t.transaction_type = 'PURCHASE' AND t.payment_status = 'PAID'), 0),
            'unpaid', COALESCE(sum(t.transaction_total_dzd) FILTER (WHERE t.transaction_type = 'PURCHASE' AND t.payment_status = 'UNPAID'), 0)
        )
    )
    INTO v_payment
    FROM onboarding.historical_trade_transactions t
    JOIN onboarding.historical_finance_batches b ON b.id = t.batch_id
    WHERE b.status = 'APPROVED_FOR_REPORTING'
      AND t.review_status = 'APPROVED'
      AND t.transaction_date BETWEEN p_date_from AND p_date_to;

    -- 3. Timeline Aggregation (Monthly)
    SELECT COALESCE(jsonb_agg(month_data ORDER BY month_data->>'month'), '[]'::jsonb)
    INTO v_timeline
    FROM (
        SELECT jsonb_build_object(
            'month', to_char(t.transaction_date, 'YYYY-MM'),
            'salesDzd', COALESCE(sum(t.transaction_total_dzd) FILTER (WHERE t.transaction_type = 'SALE'), 0),
            'purchasesDzd', COALESCE(sum(t.transaction_total_dzd) FILTER (WHERE t.transaction_type = 'PURCHASE'), 0),
            'saleCount', count(t.id) FILTER (WHERE t.transaction_type = 'SALE'),
            'purchaseCount', count(t.id) FILTER (WHERE t.transaction_type = 'PURCHASE'),
            'paidSalesDzd', COALESCE(sum(t.transaction_total_dzd) FILTER (WHERE t.transaction_type = 'SALE' AND t.payment_status = 'PAID'), 0),
            'unpaidSalesDzd', COALESCE(sum(t.transaction_total_dzd) FILTER (WHERE t.transaction_type = 'SALE' AND t.payment_status = 'UNPAID'), 0)
        ) AS month_data
        FROM onboarding.historical_trade_transactions t
        JOIN onboarding.historical_finance_batches b ON b.id = t.batch_id
        WHERE b.status = 'APPROVED_FOR_REPORTING'
          AND t.review_status = 'APPROVED'
          AND t.transaction_date BETWEEN p_date_from AND p_date_to
        GROUP BY to_char(t.transaction_date, 'YYYY-MM')
    ) m;

    -- 4. Top Products Analysis
    SELECT COALESCE(jsonb_agg(prod ORDER BY (prod->>'salesDzd')::bigint DESC), '[]'::jsonb)
    INTO v_products
    FROM (
        SELECT jsonb_build_object(
            'productName', COALESCE(l.product_name, 'Unspecified Product'),
            'matchedProductId', l.matched_product_id,
            'qtySold', COALESCE(sum(l.quantity) FILTER (WHERE t.transaction_type = 'SALE'), 0),
            'salesDzd', COALESCE(sum(l.effective_line_total_dzd) FILTER (WHERE t.transaction_type = 'SALE'), 0),
            'qtyPurchased', COALESCE(sum(l.quantity) FILTER (WHERE t.transaction_type = 'PURCHASE'), 0),
            'purchasesDzd', COALESCE(sum(l.effective_line_total_dzd) FILTER (WHERE t.transaction_type = 'PURCHASE'), 0),
            'avgSaleUnitPriceDzd', CASE
                WHEN COALESCE(sum(l.quantity) FILTER (WHERE t.transaction_type = 'SALE'), 0) > 0
                THEN sum(l.effective_line_total_dzd) FILTER (WHERE t.transaction_type = 'SALE') / sum(l.quantity) FILTER (WHERE t.transaction_type = 'SALE')
                ELSE 0 END,
            'avgPurchaseUnitPriceDzd', CASE
                WHEN COALESCE(sum(l.quantity) FILTER (WHERE t.transaction_type = 'PURCHASE'), 0) > 0
                THEN sum(l.effective_line_total_dzd) FILTER (WHERE t.transaction_type = 'PURCHASE') / sum(l.quantity) FILTER (WHERE t.transaction_type = 'PURCHASE')
                ELSE 0 END,
            'transactionCount', count(DISTINCT t.id)
        ) AS prod
        FROM onboarding.historical_trade_lines l
        JOIN onboarding.historical_trade_transactions t ON t.id = l.transaction_id
        JOIN onboarding.historical_finance_batches b ON b.id = t.batch_id
        WHERE b.status = 'APPROVED_FOR_REPORTING'
          AND t.review_status = 'APPROVED'
          AND t.transaction_date BETWEEN p_date_from AND p_date_to
        GROUP BY COALESCE(l.product_name, 'Unspecified Product'), l.matched_product_id
        LIMIT 50
    ) p;

    -- 5. Brands Analysis
    SELECT COALESCE(jsonb_agg(br ORDER BY (br->>'salesDzd')::bigint DESC), '[]'::jsonb)
    INTO v_brands
    FROM (
        SELECT jsonb_build_object(
            'brand', COALESCE(l.brand, 'Unspecified Brand'),
            'salesDzd', COALESCE(sum(l.effective_line_total_dzd) FILTER (WHERE t.transaction_type = 'SALE'), 0),
            'purchasesDzd', COALESCE(sum(l.effective_line_total_dzd) FILTER (WHERE t.transaction_type = 'PURCHASE'), 0),
            'qtySold', COALESCE(sum(l.quantity) FILTER (WHERE t.transaction_type = 'SALE'), 0),
            'qtyPurchased', COALESCE(sum(l.quantity) FILTER (WHERE t.transaction_type = 'PURCHASE'), 0),
            'transactionCount', count(DISTINCT t.id)
        ) AS br
        FROM onboarding.historical_trade_lines l
        JOIN onboarding.historical_trade_transactions t ON t.id = l.transaction_id
        JOIN onboarding.historical_finance_batches b ON b.id = t.batch_id
        WHERE b.status = 'APPROVED_FOR_REPORTING'
          AND t.review_status = 'APPROVED'
          AND t.transaction_date BETWEEN p_date_from AND p_date_to
        GROUP BY COALESCE(l.brand, 'Unspecified Brand')
        LIMIT 50
    ) b_arr;

    -- 6. Parties Analysis (Customers & Suppliers)
    SELECT COALESCE(jsonb_agg(pty ORDER BY (pty->>'totalVolumeDzd')::bigint DESC), '[]'::jsonb)
    INTO v_parties
    FROM (
        SELECT jsonb_build_object(
            'partyCompany', COALESCE(t.party_company, 'Unknown / Unspecified'),
            'salesDzd', COALESCE(sum(t.transaction_total_dzd) FILTER (WHERE t.transaction_type = 'SALE'), 0),
            'purchasesDzd', COALESCE(sum(t.transaction_total_dzd) FILTER (WHERE t.transaction_type = 'PURCHASE'), 0),
            'totalVolumeDzd', sum(t.transaction_total_dzd),
            'paidSalesDzd', COALESCE(sum(t.transaction_total_dzd) FILTER (WHERE t.transaction_type = 'SALE' AND t.payment_status = 'PAID'), 0),
            'unpaidSalesDzd', COALESCE(sum(t.transaction_total_dzd) FILTER (WHERE t.transaction_type = 'SALE' AND t.payment_status = 'UNPAID'), 0),
            'paidPurchasesDzd', COALESCE(sum(t.transaction_total_dzd) FILTER (WHERE t.transaction_type = 'PURCHASE' AND t.payment_status = 'PAID'), 0),
            'unpaidPurchasesDzd', COALESCE(sum(t.transaction_total_dzd) FILTER (WHERE t.transaction_type = 'PURCHASE' AND t.payment_status = 'UNPAID'), 0),
            'transactionCount', count(t.id)
        ) AS pty
        FROM onboarding.historical_trade_transactions t
        JOIN onboarding.historical_finance_batches b ON b.id = t.batch_id
        WHERE b.status = 'APPROVED_FOR_REPORTING'
          AND t.review_status = 'APPROVED'
          AND t.transaction_date BETWEEN p_date_from AND p_date_to
        GROUP BY COALESCE(t.party_company, 'Unknown / Unspecified')
        LIMIT 50
    ) pty_arr;

    -- 7. Data Quality Metrics
    SELECT jsonb_build_object(
        'totalLines', count(l.id),
        'productNameCoveragePct', CASE WHEN count(l.id) > 0 THEN (count(l.product_name)::numeric / count(l.id)::numeric * 100) ELSE 0 END,
        'brandCoveragePct', CASE WHEN count(l.id) > 0 THEN (count(l.brand)::numeric / count(l.id)::numeric * 100) ELSE 0 END,
        'partyCoveragePct', CASE WHEN count(DISTINCT t.id) > 0 THEN (count(t.party_company)::numeric / count(DISTINCT t.id)::numeric * 100) ELSE 0 END,
        'pageNumberCoveragePct', CASE WHEN count(DISTINCT t.id) > 0 THEN (count(t.page_number)::numeric / count(DISTINCT t.id)::numeric * 100) ELSE 0 END,
        'quantityCoveragePct', CASE WHEN count(l.id) > 0 THEN (count(l.quantity)::numeric / count(l.id)::numeric * 100) ELSE 0 END,
        'unmatchedProductCount', count(l.id) FILTER (WHERE l.product_name IS NOT NULL AND l.matched_product_id IS NULL),
        'matchedProductCount', count(l.id) FILTER (WHERE l.matched_product_id IS NOT NULL),
        'manualOverrideCount', count(l.id) FILTER (WHERE l.line_total_source = 'MANUAL_OVERRIDE'),
        'missingQtyCount', count(l.id) FILTER (WHERE l.quantity IS NULL)
    )
    INTO v_quality
    FROM onboarding.historical_trade_lines l
    JOIN onboarding.historical_trade_transactions t ON t.id = l.transaction_id
    JOIN onboarding.historical_finance_batches b ON b.id = t.batch_id
    WHERE b.status = 'APPROVED_FOR_REPORTING'
      AND t.review_status = 'APPROVED'
      AND t.transaction_date BETWEEN p_date_from AND p_date_to;

    -- 8. Manual Override Metrics
    SELECT jsonb_build_object(
        'totalLines', count(l.id),
        'calculatedLineCount', count(l.id) FILTER (WHERE l.line_total_source = 'CALCULATED'),
        'manualOverrideCount', count(l.id) FILTER (WHERE l.line_total_source = 'MANUAL_OVERRIDE'),
        'calculatedMathematicalTotalDzd', COALESCE(sum(l.calculated_line_total_dzd), 0),
        'finalEffectiveTotalDzd', COALESCE(sum(l.effective_line_total_dzd), 0),
        'totalOverrideDifferenceDzd', COALESCE(sum(l.override_difference_dzd), 0)
    )
    INTO v_overrides
    FROM onboarding.historical_trade_lines l
    JOIN onboarding.historical_trade_transactions t ON t.id = l.transaction_id
    JOIN onboarding.historical_finance_batches b ON b.id = t.batch_id
    WHERE b.status = 'APPROVED_FOR_REPORTING'
      AND t.review_status = 'APPROVED'
      AND t.transaction_date BETWEEN p_date_from AND p_date_to;

    RETURN jsonb_build_object(
        'overview', v_overview,
        'payment', v_payment,
        'timeline', v_timeline,
        'products', v_products,
        'brands', v_brands,
        'parties', v_parties,
        'dataQuality', v_quality,
        'manualOverrides', v_overrides
    );
END;
$$;

REVOKE ALL ON FUNCTION onboarding.create_historical_trade_batch(text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION onboarding.replace_historical_trade_batch_data(text, bigint, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION onboarding.validate_historical_trade_batch(text, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION onboarding.approve_historical_trade_batch(text, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION onboarding.get_historical_trade_analytics(text, date, date) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION onboarding.create_historical_trade_batch(text, text, text, text) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION onboarding.replace_historical_trade_batch_data(text, bigint, jsonb) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION onboarding.validate_historical_trade_batch(text, bigint) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION onboarding.approve_historical_trade_batch(text, bigint) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION onboarding.get_historical_trade_analytics(text, date, date) TO stockiha_runtime;

UPDATE operations.schema_state
SET migration_version = 20260807230000,
    updated_at = now()
WHERE singleton;

RESET ROLE;
