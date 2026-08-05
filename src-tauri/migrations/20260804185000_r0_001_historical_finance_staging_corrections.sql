-- R0-001 corrective hardening before the staging slice leaves draft.
--
-- 1. Validation updates must affect only the selected batch.
-- 2. Balance validation issues are counted alongside transaction issues, so
--    the issue count is not constrained by the transaction-row count.
-- 3. Supplier refunds reduce purchases once; they must not also be added a
--    second time to the inventory-adjusted result.
SET ROLE stockiha_owner;

ALTER TABLE onboarding.historical_finance_batches
    DROP CONSTRAINT historical_finance_batches_counts_valid;
ALTER TABLE onboarding.historical_finance_batches
    ADD CONSTRAINT historical_finance_batches_counts_valid
    CHECK (row_count >= 0 AND invalid_row_count >= 0);

CREATE OR REPLACE FUNCTION onboarding.validate_historical_finance_batch(
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
    v_row_count integer;
    v_row_issue_count integer;
    v_balance_issue_count integer;
    v_invalid_count integer;
    v_status text;
    v_sales bigint;
    v_purchases bigint;
    v_expenses bigint;
    v_other_income bigint;
    v_customer_refunds bigint;
    v_supplier_refunds bigint;
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

    UPDATE onboarding.historical_finance_rows r
    SET validation_errors = to_jsonb(array_remove(ARRAY[
        CASE WHEN r.transaction_date > current_date THEN 'FUTURE_DATE' END,
        CASE WHEN r.payment_status = 'PARTIAL'
                  AND (r.amount_paid_dzd IS NULL
                       OR r.amount_paid_dzd <= 0
                       OR r.amount_paid_dzd >= r.net_amount_dzd)
             THEN 'INVALID_PARTIAL_PAYMENT' END,
        CASE WHEN r.payment_status = 'UNPAID'
                  AND COALESCE(r.amount_paid_dzd, 0) <> 0
             THEN 'UNPAID_HAS_PAYMENT' END,
        CASE WHEN r.payment_status = 'PAID'
                  AND r.amount_paid_dzd IS NOT NULL
                  AND r.amount_paid_dzd <> r.net_amount_dzd
             THEN 'PAID_AMOUNT_MISMATCH' END,
        CASE WHEN r.payment_status = 'UNKNOWN' THEN 'UNKNOWN_PAYMENT_STATUS' END,
        CASE WHEN r.transaction_type IN ('EXPENSE', 'SALARY', 'TAX_PAYMENT')
                  AND r.expense_category IS NULL
             THEN 'MISSING_EXPENSE_CATEGORY' END,
        CASE WHEN r.review_status = 'NEEDS_REVIEW' THEN 'ROW_NEEDS_REVIEW' END
    ]::text[], NULL))
    WHERE r.batch_id = p_batch_id;

    UPDATE onboarding.historical_finance_balances b
    SET validation_errors = to_jsonb(array_remove(ARRAY[
        CASE WHEN b.balance_date > current_date THEN 'FUTURE_DATE' END,
        CASE WHEN b.balance_type = 'CUSTOMER_RECEIVABLE'
                  AND b.customer_client IS NULL
             THEN 'MISSING_CUSTOMER' END,
        CASE WHEN b.balance_type = 'SUPPLIER_PAYABLE'
                  AND b.supplier_fournisseur IS NULL
             THEN 'MISSING_SUPPLIER' END,
        CASE WHEN b.review_status = 'NEEDS_REVIEW' THEN 'ROW_NEEDS_REVIEW' END
    ]::text[], NULL))
    WHERE b.batch_id = p_batch_id;

    SELECT
        count(*),
        count(*) FILTER (WHERE jsonb_array_length(validation_errors) > 0),
        COALESCE(sum(net_amount_dzd) FILTER (
            WHERE transaction_type = 'SALE' AND review_status <> 'REJECTED'
        ), 0),
        COALESCE(sum(net_amount_dzd) FILTER (
            WHERE transaction_type = 'PURCHASE' AND review_status <> 'REJECTED'
        ), 0),
        COALESCE(sum(net_amount_dzd) FILTER (
            WHERE transaction_type IN ('EXPENSE', 'SALARY', 'TAX_PAYMENT')
              AND review_status <> 'REJECTED'
        ), 0),
        COALESCE(sum(net_amount_dzd) FILTER (
            WHERE transaction_type = 'OTHER_INCOME' AND review_status <> 'REJECTED'
        ), 0),
        COALESCE(sum(net_amount_dzd) FILTER (
            WHERE transaction_type = 'CUSTOMER_REFUND' AND review_status <> 'REJECTED'
        ), 0),
        COALESCE(sum(net_amount_dzd) FILTER (
            WHERE transaction_type = 'SUPPLIER_REFUND' AND review_status <> 'REJECTED'
        ), 0)
    INTO
        v_row_count,
        v_row_issue_count,
        v_sales,
        v_purchases,
        v_expenses,
        v_other_income,
        v_customer_refunds,
        v_supplier_refunds
    FROM onboarding.historical_finance_rows
    WHERE batch_id = p_batch_id;

    SELECT count(*) FILTER (WHERE jsonb_array_length(validation_errors) > 0)
    INTO v_balance_issue_count
    FROM onboarding.historical_finance_balances
    WHERE batch_id = p_batch_id;

    v_invalid_count := v_row_issue_count + v_balance_issue_count;
    IF v_row_count = 0 THEN
        v_invalid_count := v_invalid_count + 1;
    END IF;

    v_status := CASE WHEN v_invalid_count = 0 THEN 'VALIDATED' ELSE 'NEEDS_REVIEW' END;

    UPDATE onboarding.historical_finance_batches
    SET status = v_status,
        validated_at = now(),
        row_count = v_row_count,
        invalid_row_count = v_invalid_count,
        total_sales_dzd = v_sales,
        total_purchases_dzd = v_purchases,
        total_expenses_dzd = v_expenses,
        total_other_income_dzd = v_other_income,
        total_customer_refunds_dzd = v_customer_refunds,
        total_supplier_refunds_dzd = v_supplier_refunds
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
        format('%s rows, %s validation issues', v_row_count, v_invalid_count)
    );

    RETURN jsonb_build_object(
        'batchId', p_batch_id,
        'status', v_status,
        'rowCount', v_row_count,
        'invalidRowCount', v_invalid_count,
        'totalSalesDzd', v_sales,
        'totalPurchasesDzd', v_purchases,
        'totalExpensesDzd', v_expenses,
        'totalOtherIncomeDzd', v_other_income,
        'totalCustomerRefundsDzd', v_customer_refunds,
        'totalSupplierRefundsDzd', v_supplier_refunds,
        'preliminaryResultBeforeInventoryDzd',
            v_sales + v_other_income + v_supplier_refunds
            - v_customer_refunds - v_purchases - v_expenses
    );
END;
$$;

CREATE OR REPLACE FUNCTION onboarding.get_historical_finance_summary(
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
    v_sales bigint;
    v_purchases bigint;
    v_expenses bigint;
    v_other_income bigint;
    v_customer_refunds bigint;
    v_supplier_refunds bigint;
    v_opening_inventory bigint;
    v_closing_inventory bigint;
    v_inventory_complete boolean;
    v_preliminary bigint;
    v_profit bigint;
BEGIN
    PERFORM 1
    FROM iam.resolve_session_with_permission(
        p_session_token,
        'REVIEW_HISTORICAL_FINANCE_IMPORT'
    );

    IF p_date_from IS NULL OR p_date_to IS NULL OR p_date_from > p_date_to THEN
        RAISE EXCEPTION 'invalid historical finance report period' USING ERRCODE = '22023';
    END IF;

    SELECT
        COALESCE(sum(r.net_amount_dzd) FILTER (WHERE r.transaction_type = 'SALE'), 0),
        COALESCE(sum(r.net_amount_dzd) FILTER (WHERE r.transaction_type = 'PURCHASE'), 0),
        COALESCE(sum(r.net_amount_dzd) FILTER (
            WHERE r.transaction_type IN ('EXPENSE', 'SALARY', 'TAX_PAYMENT')
        ), 0),
        COALESCE(sum(r.net_amount_dzd) FILTER (WHERE r.transaction_type = 'OTHER_INCOME'), 0),
        COALESCE(sum(r.net_amount_dzd) FILTER (WHERE r.transaction_type = 'CUSTOMER_REFUND'), 0),
        COALESCE(sum(r.net_amount_dzd) FILTER (WHERE r.transaction_type = 'SUPPLIER_REFUND'), 0)
    INTO
        v_sales,
        v_purchases,
        v_expenses,
        v_other_income,
        v_customer_refunds,
        v_supplier_refunds
    FROM onboarding.historical_finance_rows r
    JOIN onboarding.historical_finance_batches b ON b.id = r.batch_id
    WHERE b.status = 'APPROVED_FOR_REPORTING'
      AND r.review_status = 'APPROVED'
      AND r.transaction_date BETWEEN p_date_from AND p_date_to;

    SELECT amount_dzd
    INTO v_opening_inventory
    FROM onboarding.historical_finance_balances hb
    JOIN onboarding.historical_finance_batches b ON b.id = hb.batch_id
    WHERE b.status = 'APPROVED_FOR_REPORTING'
      AND hb.review_status = 'APPROVED'
      AND hb.balance_type = 'OPENING_INVENTORY_VALUE'
      AND hb.balance_date <= p_date_from
    ORDER BY hb.balance_date DESC, hb.id DESC
    LIMIT 1;

    SELECT amount_dzd
    INTO v_closing_inventory
    FROM onboarding.historical_finance_balances hb
    JOIN onboarding.historical_finance_batches b ON b.id = hb.batch_id
    WHERE b.status = 'APPROVED_FOR_REPORTING'
      AND hb.review_status = 'APPROVED'
      AND hb.balance_type = 'CLOSING_INVENTORY_VALUE'
      AND hb.balance_date >= p_date_to
    ORDER BY hb.balance_date ASC, hb.id ASC
    LIMIT 1;

    v_preliminary := v_sales + v_other_income + v_supplier_refunds
        - v_customer_refunds - v_purchases - v_expenses;
    v_inventory_complete := v_opening_inventory IS NOT NULL AND v_closing_inventory IS NOT NULL;
    v_profit := CASE WHEN v_inventory_complete THEN
        v_sales + v_other_income
        - v_customer_refunds
        - (v_opening_inventory + v_purchases - v_supplier_refunds - v_closing_inventory)
        - v_expenses
        ELSE NULL
    END;

    RETURN jsonb_build_object(
        'dateFrom', p_date_from,
        'dateTo', p_date_to,
        'salesDzd', v_sales,
        'purchasesDzd', v_purchases,
        'expensesDzd', v_expenses,
        'otherIncomeDzd', v_other_income,
        'customerRefundsDzd', v_customer_refunds,
        'supplierRefundsDzd', v_supplier_refunds,
        'preliminaryResultBeforeInventoryDzd', v_preliminary,
        'openingInventoryDzd', v_opening_inventory,
        'closingInventoryDzd', v_closing_inventory,
        'inventoryDataComplete', v_inventory_complete,
        'estimatedProfitLossDzd', v_profit,
        'profitCalculationStatus', CASE
            WHEN v_inventory_complete THEN 'INVENTORY_ADJUSTED_ESTIMATE'
            ELSE 'INCOMPLETE_WITHOUT_OPENING_AND_CLOSING_INVENTORY'
        END
    );
END;
$$;

UPDATE operations.schema_state
SET migration_version = 20260804185000,
    updated_at = now()
WHERE singleton;

RESET ROLE;
