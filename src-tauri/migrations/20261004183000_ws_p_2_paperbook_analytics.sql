-- Migration: 20261004183000_ws_p_2_paperbook_analytics.sql
-- WS-P-2: Historical Paper Book Financial Analytics & Charts
-- Provides high-performance aggregation functions strictly isolated in schema paperbook.

SET ROLE stockiha_owner;

-- ----------------------------------------------------------------------------
-- 1. Analytics Summary / Headline KPIs
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION paperbook.get_analytics_summary(
    p_session_token text,
    p_from date,
    p_to date
)
RETURNS TABLE (
    sell_total numeric(14,0),
    buy_total numeric(14,0),
    expense_total numeric(14,0),
    benefit_total numeric(14,0),
    net_profit numeric(14,0),
    margin_rate numeric(8,4),
    unpaid_sell_total numeric(14,0),
    unpaid_buy_total numeric(14,0),
    sell_count integer,
    buy_count integer,
    expense_count integer
)
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_sells numeric(14,0) := 0;
    v_buys numeric(14,0) := 0;
    v_expenses numeric(14,0) := 0;
    v_benefit numeric(14,0) := 0;
    v_net_profit numeric(14,0) := 0;
    v_margin numeric(8,4) := 0;
    v_unpaid_sells numeric(14,0) := 0;
    v_unpaid_buys numeric(14,0) := 0;
    v_scnt integer := 0;
    v_bcnt integer := 0;
    v_ecnt integer := 0;
BEGIN
    PERFORM 1 FROM iam.resolve_session(p_session_token);

    SELECT
        coalesce(sum(CASE WHEN t.txn_type = 'sell' THEN t.total ELSE 0 END), 0)::numeric(14,0),
        coalesce(sum(CASE WHEN t.txn_type = 'buy' THEN t.total ELSE 0 END), 0)::numeric(14,0),
        coalesce(sum(CASE WHEN t.txn_type = 'expense' THEN t.total ELSE 0 END), 0)::numeric(14,0),
        coalesce(sum(CASE WHEN t.txn_type = 'sell' THEN coalesce(t.benefit, 0) ELSE 0 END), 0)::numeric(14,0),
        coalesce(sum(CASE WHEN t.txn_type = 'sell' AND NOT t.is_paid THEN t.total ELSE 0 END), 0)::numeric(14,0),
        coalesce(sum(CASE WHEN t.txn_type = 'buy' AND NOT t.is_paid THEN t.total ELSE 0 END), 0)::numeric(14,0),
        count(CASE WHEN t.txn_type = 'sell' THEN 1 END)::integer,
        count(CASE WHEN t.txn_type = 'buy' THEN 1 END)::integer,
        count(CASE WHEN t.txn_type = 'expense' THEN 1 END)::integer
    INTO
        v_sells, v_buys, v_expenses, v_benefit,
        v_unpaid_sells, v_unpaid_buys,
        v_scnt, v_bcnt, v_ecnt
    FROM paperbook.txn t
    WHERE (p_from IS NULL OR t.txn_date >= p_from)
      AND (p_to IS NULL OR t.txn_date <= p_to);

    v_net_profit := v_benefit - v_expenses;

    IF v_sells > 0 THEN
        v_margin := round((v_benefit::numeric / v_sells::numeric) * 100, 4);
    ELSE
        v_margin := 0;
    END IF;

    RETURN QUERY SELECT
        v_sells,
        v_buys,
        v_expenses,
        v_benefit,
        v_net_profit,
        v_margin,
        v_unpaid_sells,
        v_unpaid_buys,
        v_scnt,
        v_bcnt,
        v_ecnt;
END;
$$;

-- ----------------------------------------------------------------------------
-- 2. Monthly Timeline Aggregation
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION paperbook.get_analytics_monthly(
    p_session_token text,
    p_from date,
    p_to date
)
RETURNS TABLE (
    year_month text,
    month_date date,
    sell_total numeric(14,0),
    buy_total numeric(14,0),
    expense_total numeric(14,0),
    benefit_total numeric(14,0),
    net_profit numeric(14,0),
    unpaid_sell_total numeric(14,0),
    txn_count integer
)
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    PERFORM 1 FROM iam.resolve_session(p_session_token);

    RETURN QUERY
    SELECT
        to_char(date_trunc('month', t.txn_date), 'YYYY-MM') AS year_month,
        date_trunc('month', t.txn_date)::date AS month_date,
        coalesce(sum(CASE WHEN t.txn_type = 'sell' THEN t.total ELSE 0 END), 0)::numeric(14,0) AS sell_total,
        coalesce(sum(CASE WHEN t.txn_type = 'buy' THEN t.total ELSE 0 END), 0)::numeric(14,0) AS buy_total,
        coalesce(sum(CASE WHEN t.txn_type = 'expense' THEN t.total ELSE 0 END), 0)::numeric(14,0) AS expense_total,
        coalesce(sum(CASE WHEN t.txn_type = 'sell' THEN coalesce(t.benefit, 0) ELSE 0 END), 0)::numeric(14,0) AS benefit_total,
        (
            coalesce(sum(CASE WHEN t.txn_type = 'sell' THEN coalesce(t.benefit, 0) ELSE 0 END), 0) -
            coalesce(sum(CASE WHEN t.txn_type = 'expense' THEN t.total ELSE 0 END), 0)
        )::numeric(14,0) AS net_profit,
        coalesce(sum(CASE WHEN t.txn_type = 'sell' AND NOT t.is_paid THEN t.total ELSE 0 END), 0)::numeric(14,0) AS unpaid_sell_total,
        count(*)::integer AS txn_count
    FROM paperbook.txn t
    WHERE (p_from IS NULL OR t.txn_date >= p_from)
      AND (p_to IS NULL OR t.txn_date <= p_to)
    GROUP BY date_trunc('month', t.txn_date)
    ORDER BY date_trunc('month', t.txn_date) ASC;
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. Top Selling Products
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION paperbook.get_analytics_top_products(
    p_session_token text,
    p_from date,
    p_to date,
    p_limit integer DEFAULT 10
)
RETURNS TABLE (
    product_label text,
    total_qty numeric(14,0),
    total_revenue numeric(14,0),
    txn_count integer,
    avg_price numeric(14,0)
)
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_lim integer := LEAST(GREATEST(coalesce(p_limit, 10), 1), 100);
BEGIN
    PERFORM 1 FROM iam.resolve_session(p_session_token);

    RETURN QUERY
    WITH prod_lines AS (
        SELECT
            coalesce(vl.effective_label, tl.product_raw, 'Unknown Product') AS label,
            coalesce(tl.quantity, 1) AS qty,
            tl.line_total AS rev
        FROM paperbook.txn_line tl
        JOIN paperbook.txn t ON t.id = tl.txn_id
        LEFT JOIN paperbook.v_labels vl ON vl.field = 'product' AND vl.raw_key = tl.product_key
        WHERE t.txn_type = 'sell'
          AND (p_from IS NULL OR t.txn_date >= p_from)
          AND (p_to IS NULL OR t.txn_date <= p_to)
    )
    SELECT
        pl.label AS product_label,
        coalesce(sum(pl.qty), 0)::numeric(14,0) AS total_qty,
        coalesce(sum(pl.rev), 0)::numeric(14,0) AS total_revenue,
        count(*)::integer AS txn_count,
        CASE
            WHEN sum(pl.qty) > 0 THEN round(sum(pl.rev)::numeric / sum(pl.qty)::numeric)::numeric(14,0)
            ELSE 0
        END AS avg_price
    FROM prod_lines pl
    GROUP BY pl.label
    ORDER BY sum(pl.rev) DESC
    LIMIT v_lim;
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. Top Customers & Debtors (Unpaid Balances)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION paperbook.get_analytics_top_customers(
    p_session_token text,
    p_from date,
    p_to date,
    p_limit integer DEFAULT 10
)
RETURNS TABLE (
    customer_label text,
    total_spent numeric(14,0),
    unpaid_amount numeric(14,0),
    order_count integer
)
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_lim integer := LEAST(GREATEST(coalesce(p_limit, 10), 1), 100);
BEGIN
    PERFORM 1 FROM iam.resolve_session(p_session_token);

    RETURN QUERY
    SELECT
        coalesce(vl.effective_label, t.party_raw, 'Unknown Customer') AS customer_label,
        coalesce(sum(t.total), 0)::numeric(14,0) AS total_spent,
        coalesce(sum(CASE WHEN NOT t.is_paid THEN t.total ELSE 0 END), 0)::numeric(14,0) AS unpaid_amount,
        count(*)::integer AS order_count
    FROM paperbook.txn t
    LEFT JOIN paperbook.v_labels vl ON vl.field = 'party' AND vl.raw_key = t.party_key
    WHERE t.txn_type = 'sell'
      AND (p_from IS NULL OR t.txn_date >= p_from)
      AND (p_to IS NULL OR t.txn_date <= p_to)
    GROUP BY coalesce(vl.effective_label, t.party_raw, 'Unknown Customer')
    ORDER BY sum(t.total) DESC
    LIMIT v_lim;
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. Top Suppliers & Creditors (Debts Owed to Suppliers)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION paperbook.get_analytics_top_suppliers(
    p_session_token text,
    p_from date,
    p_to date,
    p_limit integer DEFAULT 10
)
RETURNS TABLE (
    supplier_label text,
    total_bought numeric(14,0),
    unpaid_amount numeric(14,0),
    txn_count integer
)
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_lim integer := LEAST(GREATEST(coalesce(p_limit, 10), 1), 100);
BEGIN
    PERFORM 1 FROM iam.resolve_session(p_session_token);

    RETURN QUERY
    SELECT
        coalesce(vl.effective_label, t.party_raw, 'Unknown Supplier') AS supplier_label,
        coalesce(sum(t.total), 0)::numeric(14,0) AS total_bought,
        coalesce(sum(CASE WHEN NOT t.is_paid THEN t.total ELSE 0 END), 0)::numeric(14,0) AS unpaid_amount,
        count(*)::integer AS txn_count
    FROM paperbook.txn t
    LEFT JOIN paperbook.v_labels vl ON vl.field = 'party' AND vl.raw_key = t.party_key
    WHERE t.txn_type = 'buy'
      AND (p_from IS NULL OR t.txn_date >= p_from)
      AND (p_to IS NULL OR t.txn_date <= p_to)
    GROUP BY coalesce(vl.effective_label, t.party_raw, 'Unknown Supplier')
    ORDER BY sum(t.total) DESC
    LIMIT v_lim;
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. Top Brands
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION paperbook.get_analytics_top_brands(
    p_session_token text,
    p_from date,
    p_to date,
    p_limit integer DEFAULT 10
)
RETURNS TABLE (
    brand_label text,
    total_qty numeric(14,0),
    total_revenue numeric(14,0),
    txn_count integer
)
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_lim integer := LEAST(GREATEST(coalesce(p_limit, 10), 1), 100);
BEGIN
    PERFORM 1 FROM iam.resolve_session(p_session_token);

    RETURN QUERY
    SELECT
        coalesce(vl.effective_label, tl.brand_raw, 'Unknown Brand') AS brand_label,
        coalesce(sum(coalesce(tl.quantity, 1)), 0)::numeric(14,0) AS total_qty,
        coalesce(sum(tl.line_total), 0)::numeric(14,0) AS total_revenue,
        count(DISTINCT tl.txn_id)::integer AS txn_count
    FROM paperbook.txn_line tl
    JOIN paperbook.txn t ON t.id = tl.txn_id
    LEFT JOIN paperbook.v_labels vl ON vl.field = 'brand' AND vl.raw_key = tl.brand_key
    WHERE t.txn_type = 'sell'
      AND (tl.brand_raw IS NOT NULL AND btrim(tl.brand_raw) <> '')
      AND (p_from IS NULL OR t.txn_date >= p_from)
      AND (p_to IS NULL OR t.txn_date <= p_to)
    GROUP BY coalesce(vl.effective_label, tl.brand_raw, 'Unknown Brand')
    ORDER BY sum(tl.line_total) DESC
    LIMIT v_lim;
END;
$$;

-- ----------------------------------------------------------------------------
-- 7. Expense Category Breakdown
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION paperbook.get_analytics_expenses(
    p_session_token text,
    p_from date,
    p_to date
)
RETURNS TABLE (
    category_label text,
    total_amount numeric(14,0),
    txn_count integer,
    percent_of_total numeric(8,2)
)
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_overall_expense numeric(14,0);
BEGIN
    PERFORM 1 FROM iam.resolve_session(p_session_token);

    SELECT coalesce(sum(t.total), 0)
    INTO v_overall_expense
    FROM paperbook.txn t
    WHERE t.txn_type = 'expense'
      AND (p_from IS NULL OR t.txn_date >= p_from)
      AND (p_to IS NULL OR t.txn_date <= p_to);

    RETURN QUERY
    SELECT
        coalesce(
            vl.effective_label,
            t.party_raw,
            t.note,
            'Other Expense'
        ) AS category_label,
        coalesce(sum(t.total), 0)::numeric(14,0) AS total_amount,
        count(*)::integer AS txn_count,
        CASE
            WHEN v_overall_expense > 0 THEN
                round((sum(t.total)::numeric / v_overall_expense::numeric) * 100, 2)
            ELSE 0
        END AS percent_of_total
    FROM paperbook.txn t
    LEFT JOIN paperbook.v_labels vl ON vl.field = 'party' AND vl.raw_key = t.party_key
    WHERE t.txn_type = 'expense'
      AND (p_from IS NULL OR t.txn_date >= p_from)
      AND (p_to IS NULL OR t.txn_date <= p_to)
    GROUP BY coalesce(vl.effective_label, t.party_raw, t.note, 'Other Expense')
    ORDER BY sum(t.total) DESC;
END;
$$;

-- ----------------------------------------------------------------------------
-- 8. Execution Grants
-- ----------------------------------------------------------------------------

REVOKE ALL ON FUNCTION paperbook.get_analytics_summary(text, date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION paperbook.get_analytics_monthly(text, date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION paperbook.get_analytics_top_products(text, date, date, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION paperbook.get_analytics_top_customers(text, date, date, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION paperbook.get_analytics_top_suppliers(text, date, date, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION paperbook.get_analytics_top_brands(text, date, date, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION paperbook.get_analytics_expenses(text, date, date) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION paperbook.get_analytics_summary(text, date, date) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION paperbook.get_analytics_monthly(text, date, date) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION paperbook.get_analytics_top_products(text, date, date, integer) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION paperbook.get_analytics_top_customers(text, date, date, integer) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION paperbook.get_analytics_top_suppliers(text, date, date, integer) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION paperbook.get_analytics_top_brands(text, date, date, integer) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION paperbook.get_analytics_expenses(text, date, date) TO stockiha_runtime;
