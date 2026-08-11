-- R0-004 compatibility repair for historical manual-benefit analytics.
--
-- R0-003 stored one manual benefit per SALE transaction. R0-004 added
-- line-level benefits and derives the transaction value from those lines, but
-- its analytics replacement read only the line values. That made valid legacy
-- transaction-level benefits disappear from overview, timeline, and benefits
-- aggregates. Keep the R0-004 line-level breakdowns, while making the
-- transaction aggregate authoritative for transaction-level analytics.
SET ROLE stockiha_owner;

ALTER FUNCTION onboarding.get_historical_trade_analytics(text, date, date)
    RENAME TO get_historical_trade_analytics_r0_004;

REVOKE ALL ON FUNCTION onboarding.get_historical_trade_analytics_r0_004(text, date, date)
    FROM PUBLIC, stockiha_runtime, stockiha_admin;

CREATE FUNCTION onboarding.get_historical_trade_analytics(
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
    v_result jsonb;
    v_timeline jsonb;
    v_sale_count bigint;
    v_purchase_count bigint;
    v_total_manual_benefit bigint;
    v_sales_with_manual_benefit bigint;
    v_sales_without_manual_benefit bigint;
BEGIN
    -- The R0-004 implementation remains responsible for session/permission
    -- validation and for every line-level analytics projection.
    v_result := onboarding.get_historical_trade_analytics_r0_004(
        p_session_token,
        p_date_from,
        p_date_to
    );

    SELECT
        COUNT(*) FILTER (WHERE t.transaction_type = 'SALE'),
        COUNT(*) FILTER (WHERE t.transaction_type = 'PURCHASE'),
        COALESCE(SUM(t.manual_benefit_dzd)
            FILTER (WHERE t.transaction_type = 'SALE'), 0),
        COUNT(*) FILTER (
            WHERE t.transaction_type = 'SALE'
              AND t.manual_benefit_dzd IS NOT NULL
        ),
        COUNT(*) FILTER (
            WHERE t.transaction_type = 'SALE'
              AND t.manual_benefit_dzd IS NULL
        )
    INTO
        v_sale_count,
        v_purchase_count,
        v_total_manual_benefit,
        v_sales_with_manual_benefit,
        v_sales_without_manual_benefit
    FROM onboarding.historical_trade_transactions t
    JOIN onboarding.historical_finance_batches b ON b.id = t.batch_id
    WHERE b.status = 'APPROVED_FOR_REPORTING'
      AND t.transaction_date BETWEEN p_date_from AND p_date_to;

    v_result := jsonb_set(
        v_result,
        '{overview}',
        (v_result->'overview') || jsonb_build_object(
            'dateFrom', p_date_from,
            'dateTo', p_date_to,
            'avgSaleValueDzd', CASE
                WHEN v_sale_count > 0
                THEN (v_result->'overview'->>'totalSalesDzd')::bigint / v_sale_count
                ELSE 0
            END,
            'avgPurchaseValueDzd', CASE
                WHEN v_purchase_count > 0
                THEN (v_result->'overview'->>'totalPurchasesDzd')::bigint / v_purchase_count
                ELSE 0
            END,
            'totalManualBenefitDzd', v_total_manual_benefit,
            'salesWithManualBenefitCount', v_sales_with_manual_benefit,
            'salesWithoutManualBenefitCount', v_sales_without_manual_benefit
        ),
        false
    );

    v_result := jsonb_set(
        v_result,
        '{benefits}',
        (v_result->'benefits') || jsonb_build_object(
            'salesTransactionCount', v_sale_count,
            'totalManualBenefitDzd', v_total_manual_benefit,
            'salesWithManualBenefitCount', v_sales_with_manual_benefit,
            'salesWithoutManualBenefitCount', v_sales_without_manual_benefit,
            'averageManualBenefitDzd', CASE
                WHEN v_sales_with_manual_benefit > 0
                THEN v_total_manual_benefit / v_sales_with_manual_benefit
                ELSE NULL
            END
        ),
        false
    );

    SELECT COALESCE(
        jsonb_agg(
            jsonb_set(
                timeline_row.item,
                '{manualBenefitDzd}',
                to_jsonb(COALESCE(month_benefit.total_manual_benefit_dzd, 0)),
                true
            )
            ORDER BY timeline_row.item->>'yearMonth'
        ),
        '[]'::jsonb
    )
    INTO v_timeline
    FROM jsonb_array_elements(COALESCE(v_result->'timeline', '[]'::jsonb))
        AS timeline_row(item)
    LEFT JOIN (
        SELECT
            to_char(t.transaction_date, 'YYYY-MM') AS year_month,
            COALESCE(SUM(t.manual_benefit_dzd), 0) AS total_manual_benefit_dzd
        FROM onboarding.historical_trade_transactions t
        JOIN onboarding.historical_finance_batches b ON b.id = t.batch_id
        WHERE b.status = 'APPROVED_FOR_REPORTING'
          AND t.transaction_type = 'SALE'
          AND t.transaction_date BETWEEN p_date_from AND p_date_to
        GROUP BY to_char(t.transaction_date, 'YYYY-MM')
    ) month_benefit
      ON month_benefit.year_month = timeline_row.item->>'yearMonth';

    RETURN jsonb_set(v_result, '{timeline}', v_timeline, false);
END;
$$;

REVOKE ALL ON FUNCTION onboarding.get_historical_trade_analytics(text, date, date)
    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION onboarding.get_historical_trade_analytics(text, date, date)
    TO stockiha_runtime, stockiha_admin;

UPDATE operations.schema_state
SET migration_version = 20260811130000,
    updated_at = now()
WHERE singleton;

RESET ROLE;
