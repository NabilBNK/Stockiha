-- WS-N-1: Dashboard data (calculation engine, SQL helpers, 12 public functions)
-- Read-only analytics over core, sales, inventory, procurement and receivables.

SET ROLE stockiha_owner;

-- ============================================================================
-- 1. Pure helpers (no table access)
-- ============================================================================

CREATE OR REPLACE FUNCTION core._dashboard_validate_window(
    p_from date,
    p_to date,
    p_today date
)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    IF p_from IS NULL OR p_to IS NULL THEN
        RAISE EXCEPTION 'DASHBOARD_RANGE_INVALID: dates cannot be null' USING ERRCODE = '22023';
    END IF;
    IF p_from > p_to THEN
        RAISE EXCEPTION 'DASHBOARD_RANGE_INVALID: start date % is after end date %', p_from, p_to USING ERRCODE = '22023';
    END IF;
    IF p_from < '2000-01-01'::date THEN
        RAISE EXCEPTION 'DASHBOARD_RANGE_INVALID: start date % is before 2000-01-01', p_from USING ERRCODE = '22023';
    END IF;
    IF p_to > p_today THEN
        RAISE EXCEPTION 'DASHBOARD_RANGE_INVALID: end date % is after today %', p_to, p_today USING ERRCODE = '22023';
    END IF;
END;
$$;
REVOKE ALL ON FUNCTION core._dashboard_validate_window(date, date, date) FROM PUBLIC;

CREATE OR REPLACE FUNCTION core._dashboard_period_bounds_at(
    p_period text,
    p_from date,
    p_to date,
    p_now timestamptz
)
RETURNS TABLE (
    cur_from date,
    cur_to date,
    prev_from date,
    prev_to date,
    cut_time time,
    bucket text,
    today date
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_local timestamp := p_now AT TIME ZONE 'Africa/Algiers';
    v_today date := v_local::date;
    v_clock time(0) := v_local::time(0);
    v_clamped boolean := false;
    v_cur_from date;
    v_cur_to date;
    v_prev_from date;
    v_prev_to date;
    v_prev_last date;
    v_cut_time time;
    v_days integer;
    v_bucket text;
    v_dow integer;
    v_year integer;
    v_n integer;
BEGIN
    CASE p_period
        WHEN 'today' THEN
            v_cur_from := v_today;
            v_cur_to := v_today;
            v_prev_from := v_today - 1;
            v_prev_to := v_today - 1;
        WHEN 'week' THEN
            v_dow := extract(dow FROM v_today)::integer; -- Sunday = 0
            v_cur_from := v_today - v_dow;
            v_cur_to := v_today;
            v_prev_from := v_cur_from - 7;
            v_prev_to := v_cur_to - 7;
        WHEN 'month' THEN
            v_cur_from := date_trunc('month', v_today)::date;
            v_cur_to := v_today;
            v_prev_from := (v_cur_from - interval '1 month')::date;
            v_prev_last := v_cur_from - 1;
            IF extract(day FROM v_today)::integer > extract(day FROM v_prev_last)::integer THEN
                v_prev_to := v_prev_last;
                v_clamped := true;
            ELSE
                v_prev_to := v_prev_from + (extract(day FROM v_today)::integer - 1);
            END IF;
        WHEN 'year' THEN
            v_year := extract(year FROM v_today)::integer;
            v_cur_from := make_date(v_year, 1, 1);
            v_cur_to := v_today;
            v_prev_from := make_date(v_year - 1, 1, 1);
            IF extract(month FROM v_today)::integer = 2 AND extract(day FROM v_today)::integer = 29 THEN
                v_prev_to := make_date(v_year - 1, 2, 28);
                v_clamped := true;
            ELSE
                v_prev_to := make_date(v_year - 1, extract(month FROM v_today)::integer, extract(day FROM v_today)::integer);
            END IF;
        WHEN 'custom' THEN
            PERFORM core._dashboard_validate_window(p_from, p_to, v_today);
            v_n := p_to - p_from + 1;
            v_cur_from := p_from;
            v_cur_to := p_to;
            v_prev_from := p_from - v_n;
            v_prev_to := p_from - 1;
        ELSE
            RAISE EXCEPTION 'DASHBOARD_PERIOD_INVALID: %', p_period USING ERRCODE = '22023';
    END CASE;

    IF v_cur_to = v_today AND NOT v_clamped THEN
        v_cut_time := v_clock;
    ELSE
        v_cut_time := NULL;
    END IF;

    v_days := v_cur_to - v_cur_from + 1;
    IF v_days = 1 THEN
        v_bucket := 'HOUR';
    ELSIF v_days <= 62 THEN
        v_bucket := 'DAY';
    ELSE
        v_bucket := 'MONTH';
    END IF;

    RETURN QUERY SELECT v_cur_from, v_cur_to, v_prev_from, v_prev_to, v_cut_time, v_bucket, v_today;
END;
$$;
REVOKE ALL ON FUNCTION core._dashboard_period_bounds_at(text, date, date, timestamptz) FROM PUBLIC;

CREATE OR REPLACE FUNCTION core._dashboard_change(p_cur numeric, p_prev numeric)
RETURNS TABLE (kind text, pct numeric)
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_cur numeric := coalesce(p_cur, 0);
    v_prev numeric := coalesce(p_prev, 0);
    v_pct numeric;
    v_kind text;
BEGIN
    IF v_prev = 0 AND v_cur = 0 THEN
        RETURN QUERY SELECT 'NONE'::text, NULL::numeric;
        RETURN;
    END IF;
    IF v_prev = 0 THEN
        RETURN QUERY SELECT 'NO_BASE'::text, NULL::numeric;
        RETURN;
    END IF;
    v_pct := round((v_cur - v_prev) / abs(v_prev) * 100, 1);
    IF v_pct > 0 THEN
        v_kind := 'UP';
    ELSIF v_pct < 0 THEN
        v_kind := 'DOWN';
    ELSE
        v_kind := 'FLAT';
    END IF;
    RETURN QUERY SELECT v_kind, v_pct;
END;
$$;
REVOKE ALL ON FUNCTION core._dashboard_change(numeric, numeric) FROM PUBLIC;

CREATE OR REPLACE FUNCTION core._dashboard_in_window(
    p_date date,
    p_local_time time,
    p_from date,
    p_to date,
    p_cut_time time
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
    SELECT p_date BETWEEN p_from AND p_to
       AND (p_cut_time IS NULL OR p_date < p_to OR p_local_time <= p_cut_time);
$$;
REVOKE ALL ON FUNCTION core._dashboard_in_window(date, time, date, date, time) FROM PUBLIC;

CREATE OR REPLACE FUNCTION core._dashboard_bucket_start(
    p_date date,
    p_local_ts timestamp,
    p_bucket text
)
RETURNS timestamp
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    CASE p_bucket
        WHEN 'HOUR' THEN
            RETURN p_date::timestamp + make_interval(hours => extract(hour FROM p_local_ts)::integer);
        WHEN 'DAY' THEN
            RETURN p_date::timestamp;
        WHEN 'MONTH' THEN
            RETURN date_trunc('month', p_date::timestamp)::timestamp;
        ELSE
            RAISE EXCEPTION 'DASHBOARD_BUCKET_INVALID: %', p_bucket USING ERRCODE = '22023';
    END CASE;
END;
$$;
REVOKE ALL ON FUNCTION core._dashboard_bucket_start(date, timestamp, text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION core._dashboard_age_bucket(p_age_days integer)
RETURNS text
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
    SELECT CASE
        WHEN p_age_days <= 30 THEN '0_30'
        WHEN p_age_days <= 60 THEN '31_60'
        WHEN p_age_days <= 90 THEN '61_90'
        ELSE '91_PLUS'
    END;
$$;
REVOKE ALL ON FUNCTION core._dashboard_age_bucket(integer) FROM PUBLIC;

-- ============================================================================
-- 2. Fact helpers (read tables, implement R1-R12)
-- ============================================================================

CREATE OR REPLACE FUNCTION core._dashboard_sales(p_from date, p_to date)
RETURNS TABLE (
    document_id bigint,
    document_number text,
    sale_kind text,
    customer_id bigint,
    customer_name text,
    sale_date date,
    posted_local timestamp,
    gross_total numeric,
    discount_total numeric,
    net_total numeric,
    cogs numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
    WITH cash_agg AS (
        SELECT l.document_id,
               coalesce(sum(l.line_total), 0) AS gross_total,
               coalesce(sum(round(l.quantity * coalesce(l.unit_cost_snapshot, 0), 2)), 0) AS cogs
        FROM sales.cash_sale_lines l
        GROUP BY l.document_id
    ),
    credit_agg AS (
        SELECT l.document_id,
               coalesce(sum(l.line_total), 0) AS gross_total,
               coalesce(sum(round(l.quantity * coalesce(l.unit_cost_snapshot, 0), 2)), 0) AS cogs
        FROM sales.credit_sale_lines l
        GROUP BY l.document_id
    )
    SELECT bd.id AS document_id,
           bd.document_number,
           'CASH'::text AS sale_kind,
           NULL::bigint AS customer_id,
           NULL::text AS customer_name,
           bd.document_date AS sale_date,
           (bd.posted_at AT TIME ZONE 'Africa/Algiers')::timestamp AS posted_local,
           coalesce(ca.gross_total, 0)::numeric AS gross_total,
           coalesce(cs.discount_amount, 0)::numeric AS discount_total,
           cs.total_amount::numeric AS net_total,
           coalesce(ca.cogs, 0)::numeric AS cogs
    FROM core.business_documents bd
    JOIN sales.cash_sales cs ON cs.document_id = bd.id
    LEFT JOIN cash_agg ca ON ca.document_id = bd.id
    WHERE bd.document_type = 'CASH_SALE'
      AND bd.status = 'POSTED'
      AND bd.document_date BETWEEN p_from AND p_to
    UNION ALL
    SELECT bd.id AS document_id,
           bd.document_number,
           'CREDIT'::text AS sale_kind,
           crs.customer_id,
           c.name AS customer_name,
           bd.document_date AS sale_date,
           (bd.posted_at AT TIME ZONE 'Africa/Algiers')::timestamp AS posted_local,
           coalesce(cra.gross_total, 0)::numeric AS gross_total,
           0::numeric AS discount_total,
           crs.total_amount::numeric AS net_total,
           coalesce(cra.cogs, 0)::numeric AS cogs
    FROM core.business_documents bd
    JOIN sales.credit_sales crs ON crs.document_id = bd.id
    LEFT JOIN receivables.customers c ON c.id = crs.customer_id
    LEFT JOIN credit_agg cra ON cra.document_id = bd.id
    WHERE bd.document_type = 'CREDIT_SALE'
      AND bd.status = 'POSTED'
      AND bd.document_date BETWEEN p_from AND p_to;
$$;
REVOKE ALL ON FUNCTION core._dashboard_sales(date, date) FROM PUBLIC;

CREATE OR REPLACE FUNCTION core._dashboard_sale_lines(p_from date, p_to date)
RETURNS TABLE (
    document_id bigint,
    sale_date date,
    variant_id bigint,
    product_id bigint,
    category_id bigint,
    quantity numeric,
    line_total numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
    SELECT bd.id AS document_id,
           bd.document_date AS sale_date,
           l.variant_id,
           pv.product_id,
           p.category_id,
           l.quantity,
           l.line_total
    FROM core.business_documents bd
    JOIN sales.cash_sale_lines l ON l.document_id = bd.id
    JOIN catalog.product_variants pv ON pv.id = l.variant_id
    JOIN catalog.products p ON p.id = pv.product_id
    WHERE bd.document_type = 'CASH_SALE'
      AND bd.status = 'POSTED'
      AND bd.document_date BETWEEN p_from AND p_to
    UNION ALL
    SELECT bd.id AS document_id,
           bd.document_date AS sale_date,
           l.variant_id,
           pv.product_id,
           p.category_id,
           l.quantity,
           l.line_total
    FROM core.business_documents bd
    JOIN sales.credit_sale_lines l ON l.document_id = bd.id
    JOIN catalog.product_variants pv ON pv.id = l.variant_id
    JOIN catalog.products p ON p.id = pv.product_id
    WHERE bd.document_type = 'CREDIT_SALE'
      AND bd.status = 'POSTED'
      AND bd.document_date BETWEEN p_from AND p_to;
$$;
REVOKE ALL ON FUNCTION core._dashboard_sale_lines(date, date) FROM PUBLIC;

CREATE OR REPLACE FUNCTION core._dashboard_purchases(p_from date, p_to date)
RETURNS TABLE (
    document_id bigint,
    purchase_date date,
    posted_local timestamp,
    total numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
    SELECT bd.id AS document_id,
           bd.document_date AS purchase_date,
           (bd.posted_at AT TIME ZONE 'Africa/Algiers')::timestamp AS posted_local,
           pr.total_amount::numeric AS total
    FROM core.business_documents bd
    JOIN procurement.purchase_receipts pr ON pr.document_id = bd.id
    WHERE bd.document_type = 'PURCHASE_RECEIPT'
      AND bd.status = 'POSTED'
      AND bd.document_date BETWEEN p_from AND p_to;
$$;
REVOKE ALL ON FUNCTION core._dashboard_purchases(date, date) FROM PUBLIC;

CREATE OR REPLACE FUNCTION core._dashboard_variant_stock()
RETURNS TABLE (
    variant_id bigint,
    product_id bigint,
    product_name text,
    quantity numeric,
    stock_value numeric,
    minimum_stock numeric,
    is_active boolean,
    created_on date,
    in_valuation boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
    WITH pos_agg AS (
        SELECT pos.variant_id,
               coalesce(sum(pos.quantity_on_hand), 0) AS qty,
               coalesce(sum(pos.total_value), 0) AS val
        FROM inventory.positions pos
        GROUP BY pos.variant_id
    )
    SELECT v.id AS variant_id,
           p.id AS product_id,
           p.name AS product_name,
           coalesce(pa.qty, 0)::numeric AS quantity,
           coalesce(pa.val, 0)::numeric AS stock_value,
           coalesce(v.minimum_stock, 0)::numeric AS minimum_stock,
           (v.is_active AND p.is_active) AS is_active,
           (v.created_at AT TIME ZONE 'Africa/Algiers')::date AS created_on,
           true AS in_valuation
    FROM catalog.product_variants v
    JOIN catalog.products p ON p.id = v.product_id
    LEFT JOIN pos_agg pa ON pa.variant_id = v.id;
$$;
REVOKE ALL ON FUNCTION core._dashboard_variant_stock() FROM PUBLIC;

CREATE OR REPLACE FUNCTION core._dashboard_variant_labels(p_variant_ids bigint[])
RETURNS TABLE (
    variant_id bigint,
    item_name text,
    base_unit_name text,
    display_identifier text,
    identifier_type text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
    WITH ids AS (
        SELECT DISTINCT vid AS variant_id
        FROM unnest(p_variant_ids) vid
    )
    SELECT v.id AS variant_id,
           catalog._effective_variant_name(v.id) AS item_name,
           u.name AS base_unit_name,
           coalesce(bp.barcode, v.sku) AS display_identifier,
           CASE WHEN bp.barcode IS NOT NULL THEN 'BARCODE' ELSE 'SKU' END AS identifier_type
    FROM ids i
    JOIN catalog.product_variants v ON v.id = i.variant_id
    JOIN catalog.products p ON p.id = v.product_id
    JOIN catalog.units u ON u.id = p.unit_id
    LEFT JOIN catalog.variant_barcodes bp ON bp.variant_id = v.id AND bp.is_primary = true;
$$;
REVOKE ALL ON FUNCTION core._dashboard_variant_labels(bigint[]) FROM PUBLIC;

CREATE OR REPLACE FUNCTION core._dashboard_last_sold()
RETURNS TABLE (
    variant_id bigint,
    last_sold_on date
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
    WITH all_lines AS (
        SELECT l.variant_id, bd.document_date
        FROM core.business_documents bd
        JOIN sales.cash_sale_lines l ON l.document_id = bd.id
        WHERE bd.document_type = 'CASH_SALE' AND bd.status = 'POSTED'
        UNION ALL
        SELECT l.variant_id, bd.document_date
        FROM core.business_documents bd
        JOIN sales.credit_sale_lines l ON l.document_id = bd.id
        WHERE bd.document_type = 'CREDIT_SALE' AND bd.status = 'POSTED'
    )
    SELECT variant_id, max(document_date) AS last_sold_on
    FROM all_lines
    GROUP BY variant_id;
$$;
REVOKE ALL ON FUNCTION core._dashboard_last_sold() FROM PUBLIC;

CREATE OR REPLACE FUNCTION core._dashboard_customer_balances()
RETURNS TABLE (
    customer_id bigint,
    customer_name text,
    balance numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
    SELECT c.id AS customer_id,
           c.name AS customer_name,
           cs.exposure_amount::numeric AS balance
    FROM receivables.customers c
    JOIN receivables.customer_credit_state cs ON cs.customer_id = c.id
    WHERE cs.exposure_amount > 0;
$$;
REVOKE ALL ON FUNCTION core._dashboard_customer_balances() FROM PUBLIC;

CREATE OR REPLACE FUNCTION core._dashboard_open_items_at(p_as_of date)
RETURNS TABLE (
    customer_id bigint,
    ledger_entry_id bigint,
    item_date date,
    open_amount numeric,
    age_days integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
    WITH cust AS (
        SELECT b.customer_id FROM core._dashboard_customer_balances() b
    ),
    items AS (
        SELECT e.id,
               e.customer_id,
               e.amount_delta,
               coalesce(bd.document_date, (e.created_at AT TIME ZONE 'Africa/Algiers')::date) AS item_date
        FROM receivables.customer_ledger_entries e
        LEFT JOIN core.business_documents bd ON bd.id = e.document_id
        WHERE e.amount_delta > 0
          AND e.customer_id IN (SELECT customer_id FROM cust)
    ),
    alloc AS (
        SELECT invoice_ledger_entry_id AS id, sum(amount) AS a
        FROM receivables.payment_allocations
        GROUP BY 1
    ),
    linked AS (
        SELECT x.related_entry_id AS id, sum(-x.amount_delta) AS a
        FROM receivables.customer_ledger_entries x
        WHERE x.related_entry_id IS NOT NULL
          AND x.amount_delta < 0
          AND NOT EXISTS (
              SELECT 1 FROM receivables.payment_allocations pa
              WHERE pa.payment_document_id = x.document_id
          )
        GROUP BY 1
    ),
    o AS (
        SELECT i.customer_id,
               i.id AS ledger_entry_id,
               i.item_date,
               greatest(i.amount_delta - coalesce(alloc.a, 0) - coalesce(linked.a, 0), 0) AS open_amount
        FROM items i
        LEFT JOIN alloc ON alloc.id = i.id
        LEFT JOIN linked ON linked.id = i.id
    )
    SELECT o.customer_id,
           o.ledger_entry_id,
           o.item_date,
           o.open_amount::numeric,
           (p_as_of - o.item_date)::integer AS age_days
    FROM o
    WHERE o.open_amount > 0;
$$;
REVOKE ALL ON FUNCTION core._dashboard_open_items_at(date) FROM PUBLIC;

-- ============================================================================
-- 3. Core calculation helpers (private, explicit parameters)
-- ============================================================================

CREATE OR REPLACE FUNCTION core._dashboard_money_summary(
    p_cur_from date,
    p_cur_to date,
    p_prev_from date,
    p_prev_to date,
    p_cut_time time
)
RETURNS TABLE (
    sales numeric,
    prev_sales numeric,
    sales_change_kind text,
    sales_change_pct numeric,
    profit numeric,
    prev_profit numeric,
    profit_change_kind text,
    profit_change_pct numeric,
    margin_pct numeric,
    sale_count bigint,
    prev_sale_count bigint,
    count_change_kind text,
    count_change_pct numeric,
    average_sale numeric,
    discount_total numeric,
    cash_sales numeric,
    credit_sales numeric,
    cash_in_drawer numeric,
    open_session_count bigint,
    receivables_total numeric,
    payables_total numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
    WITH cur AS (
        SELECT * FROM core._dashboard_sales(p_cur_from, p_cur_to)
    ),
    prev AS (
        SELECT s.* FROM core._dashboard_sales(p_prev_from, p_prev_to) s
        WHERE core._dashboard_in_window(s.sale_date, s.posted_local::time, p_prev_from, p_prev_to, p_cut_time)
    ),
    c AS (
        SELECT coalesce(sum(net_total), 0) AS sales,
               coalesce(sum(cogs), 0) AS cogs,
               count(*) AS n,
               coalesce(sum(discount_total), 0) AS disc,
               coalesce(sum(net_total) FILTER (WHERE sale_kind = 'CASH'), 0) AS cash,
               coalesce(sum(net_total) FILTER (WHERE sale_kind = 'CREDIT'), 0) AS credit
        FROM cur
    ),
    p AS (
        SELECT coalesce(sum(net_total), 0) AS sales,
               coalesce(sum(cogs), 0) AS cogs,
               count(*) AS n
        FROM prev
    ),
    drawer AS (
        SELECT count(*)::bigint AS open_session_count,
               CASE
                   WHEN count(*) > 0 THEN
                       sum(s.opening_float + coalesce((
                           SELECT sum(CASE WHEN m.movement_type = 'CASH_OUT' THEN -m.amount ELSE m.amount END)
                           FROM cash.movements m
                           WHERE m.cash_session_id = s.id
                       ), 0))
                   ELSE NULL
               END AS cash_in_drawer
        FROM sales.cash_sessions s
        WHERE s.status = 'OPEN'
    ),
    rec AS (
        SELECT coalesce(sum(balance), 0) AS receivables_total
        FROM core._dashboard_customer_balances()
    ),
    pay AS (
        SELECT coalesce(sum(balance), 0) AS payables_total
        FROM reports._supplier_totals()
    )
    SELECT round(c.sales, 2) AS sales,
           round(p.sales, 2) AS prev_sales,
           sc.kind AS sales_change_kind,
           sc.pct AS sales_change_pct,
           round(c.sales - c.cogs, 2) AS profit,
           round(p.sales - p.cogs, 2) AS prev_profit,
           pc.kind AS profit_change_kind,
           pc.pct AS profit_change_pct,
           CASE WHEN c.sales > 0 THEN round((c.sales - c.cogs) / c.sales * 100, 1) ELSE NULL END AS margin_pct,
           c.n AS sale_count,
           p.n AS prev_sale_count,
           nc.kind AS count_change_kind,
           nc.pct AS count_change_pct,
           CASE WHEN c.n > 0 THEN round(c.sales / c.n, 2) ELSE NULL END AS average_sale,
           round(c.disc, 2) AS discount_total,
           round(c.cash, 2) AS cash_sales,
           round(c.credit, 2) AS credit_sales,
           round(drawer.cash_in_drawer, 2) AS cash_in_drawer,
           drawer.open_session_count,
           round(rec.receivables_total, 2) AS receivables_total,
           round(pay.payables_total, 2) AS payables_total
    FROM c, p, drawer, rec, pay,
         LATERAL core._dashboard_change(c.sales, p.sales) sc,
         LATERAL core._dashboard_change(c.sales - c.cogs, p.sales - p.cogs) pc,
         LATERAL core._dashboard_change(c.n, p.n) nc;
$$;
REVOKE ALL ON FUNCTION core._dashboard_money_summary(date, date, date, date, time) FROM PUBLIC;

CREATE OR REPLACE FUNCTION core._dashboard_stock_summary_at(
    p_dead_days integer,
    p_as_of date
)
RETURNS TABLE (
    stock_value numeric,
    low_count bigint,
    out_count bigint,
    dead_count bigint,
    dead_value numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
    WITH stock AS (
        SELECT s.*, ls.last_sold_on
        FROM core._dashboard_variant_stock() s
        LEFT JOIN core._dashboard_last_sold() ls ON ls.variant_id = s.variant_id
    )
    SELECT round(coalesce(sum(stock_value) FILTER (WHERE in_valuation), 0), 2) AS stock_value,
           count(*) FILTER (WHERE is_active AND minimum_stock > 0 AND quantity > 0 AND quantity <= minimum_stock) AS low_count,
           count(*) FILTER (WHERE is_active AND quantity = 0) AS out_count,
           count(*) FILTER (WHERE is_active AND quantity > 0 AND (p_as_of - created_on) >= p_dead_days
                                  AND (last_sold_on IS NULL OR (p_as_of - last_sold_on) >= p_dead_days)) AS dead_count,
           round(coalesce(sum(stock_value) FILTER (WHERE is_active AND quantity > 0 AND (p_as_of - created_on) >= p_dead_days
                                  AND (last_sold_on IS NULL OR (p_as_of - last_sold_on) >= p_dead_days)), 0), 2) AS dead_value
    FROM stock;
$$;
REVOKE ALL ON FUNCTION core._dashboard_stock_summary_at(integer, date) FROM PUBLIC;

CREATE OR REPLACE FUNCTION core._dashboard_stock_items_at(
    p_kind text,
    p_dead_days integer,
    p_limit integer,
    p_offset integer,
    p_as_of date
)
RETURNS TABLE (
    variant_id bigint,
    product_id bigint,
    item_name text,
    display_identifier text,
    identifier_type text,
    base_unit_name text,
    quantity numeric,
    minimum_stock numeric,
    stock_value numeric,
    last_sold_on date,
    total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
#variable_conflict use_column
DECLARE
    v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
    v_offset integer := greatest(coalesce(p_offset, 0), 0);
BEGIN
    RETURN QUERY
    WITH stock AS (
        SELECT s.variant_id, s.product_id, s.product_name, s.quantity, s.stock_value, s.minimum_stock,
               ls.last_sold_on,
               count(*) OVER () AS total_count
        FROM core._dashboard_variant_stock() s
        LEFT JOIN core._dashboard_last_sold() ls ON ls.variant_id = s.variant_id
        WHERE s.is_active AND (
            (p_kind = 'low' AND s.minimum_stock > 0 AND s.quantity > 0 AND s.quantity <= s.minimum_stock) OR
            (p_kind = 'out' AND s.quantity = 0) OR
            (p_kind = 'dead' AND s.quantity > 0 AND (p_as_of - s.created_on) >= p_dead_days
                             AND (ls.last_sold_on IS NULL OR (p_as_of - ls.last_sold_on) >= p_dead_days))
        )
        ORDER BY
            CASE WHEN p_kind = 'low' THEN (s.quantity / s.minimum_stock) END ASC,
            CASE WHEN p_kind = 'dead' THEN s.stock_value END DESC,
            s.product_name ASC,
            s.variant_id ASC
        LIMIT v_limit OFFSET v_offset
    ),
    labeled AS (
        SELECT st.*, lb.item_name, lb.display_identifier, lb.identifier_type, lb.base_unit_name
        FROM stock st
        JOIN core._dashboard_variant_labels(ARRAY(SELECT st_sub.variant_id FROM stock st_sub)) lb
          ON lb.variant_id = st.variant_id
    )
    SELECT l.variant_id,
           l.product_id,
           l.item_name,
           l.display_identifier,
           l.identifier_type,
           l.base_unit_name,
           l.quantity,
           l.minimum_stock,
           round(l.stock_value, 2) AS stock_value,
           l.last_sold_on,
           l.total_count
    FROM labeled l
    ORDER BY
        CASE WHEN p_kind = 'low' THEN (l.quantity / l.minimum_stock) END ASC,
        CASE WHEN p_kind = 'dead' THEN l.stock_value END DESC,
        l.product_name ASC,
        l.variant_id ASC;
END;
$$;
REVOKE ALL ON FUNCTION core._dashboard_stock_items_at(text, integer, integer, integer, date) FROM PUBLIC;

CREATE OR REPLACE FUNCTION core._dashboard_top_items(
    p_from date,
    p_to date,
    p_limit integer
)
RETURNS TABLE (
    variant_id bigint,
    item_name text,
    base_unit_name text,
    quantity_sold numeric,
    sales_before_discount numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
    WITH top AS (
        SELECT l.variant_id,
               sum(l.quantity) AS quantity_sold,
               sum(l.line_total) AS sales_before_discount
        FROM core._dashboard_sale_lines(p_from, p_to) l
        GROUP BY l.variant_id
        ORDER BY sales_before_discount DESC, l.variant_id ASC
        LIMIT least(greatest(coalesce(p_limit, 5), 1), 10)
    )
    SELECT t.variant_id,
           lb.item_name,
           lb.base_unit_name,
           t.quantity_sold,
           round(t.sales_before_discount, 2) AS sales_before_discount
    FROM top t
    JOIN core._dashboard_variant_labels(ARRAY(SELECT t_sub.variant_id FROM top t_sub)) lb ON lb.variant_id = t.variant_id
    ORDER BY t.sales_before_discount DESC, t.variant_id ASC;
$$;
REVOKE ALL ON FUNCTION core._dashboard_top_items(date, date, integer) FROM PUBLIC;

CREATE OR REPLACE FUNCTION core._dashboard_top_customers(p_from date, p_to date)
RETURNS TABLE (
    customer_id bigint,
    customer_name text,
    sale_count bigint,
    sales numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
    SELECT s.customer_id,
           s.customer_name,
           count(*)::bigint AS sale_count,
           round(sum(s.net_total), 2) AS sales
    FROM core._dashboard_sales(p_from, p_to) s
    WHERE s.customer_id IS NOT NULL
    GROUP BY s.customer_id, s.customer_name
    ORDER BY sum(s.net_total) DESC, s.customer_name ASC, s.customer_id ASC
    LIMIT 5;
$$;
REVOKE ALL ON FUNCTION core._dashboard_top_customers(date, date) FROM PUBLIC;

CREATE OR REPLACE FUNCTION core._dashboard_top_debtors_at(p_as_of date)
RETURNS TABLE (
    customer_id bigint,
    customer_name text,
    amount_owed numeric,
    oldest_open_on date,
    oldest_open_days integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
    WITH open_items AS (
        SELECT oi.customer_id, min(oi.item_date) AS oldest_open_on
        FROM core._dashboard_open_items_at(p_as_of) oi
        GROUP BY oi.customer_id
    )
    SELECT b.customer_id,
           b.customer_name,
           round(b.balance, 2) AS amount_owed,
           oi.oldest_open_on,
           CASE WHEN oi.oldest_open_on IS NOT NULL THEN (p_as_of - oi.oldest_open_on)::integer ELSE NULL END AS oldest_open_days
    FROM core._dashboard_customer_balances() b
    LEFT JOIN open_items oi ON oi.customer_id = b.customer_id
    WHERE b.balance > 0
    ORDER BY b.balance DESC, b.customer_name ASC, b.customer_id ASC
    LIMIT 5;
$$;
REVOKE ALL ON FUNCTION core._dashboard_top_debtors_at(date) FROM PUBLIC;

CREATE OR REPLACE FUNCTION core._dashboard_latest_sales()
RETURNS TABLE (
    document_id bigint,
    document_number text,
    posted_local timestamp,
    sale_kind text,
    customer_name text,
    total numeric,
    is_voided boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
    SELECT bd.id AS document_id,
           bd.document_number,
           (bd.posted_at AT TIME ZONE 'Africa/Algiers')::timestamp AS posted_local,
           CASE bd.document_type WHEN 'CASH_SALE' THEN 'CASH' ELSE 'CREDIT' END AS sale_kind,
           CASE WHEN bd.document_type = 'CREDIT_SALE' THEN c.name ELSE NULL END AS customer_name,
           round(CASE WHEN bd.document_type = 'CASH_SALE' THEN cs.total_amount ELSE crs.total_amount END, 2) AS total,
           (bd.status = 'REVERSED') AS is_voided
    FROM core.business_documents bd
    LEFT JOIN sales.cash_sales cs ON cs.document_id = bd.id
    LEFT JOIN sales.credit_sales crs ON crs.document_id = bd.id
    LEFT JOIN receivables.customers c ON c.id = crs.customer_id
    WHERE bd.document_type IN ('CASH_SALE', 'CREDIT_SALE')
      AND bd.status IN ('POSTED', 'REVERSED')
    ORDER BY bd.posted_at DESC, bd.id DESC
    LIMIT 5;
$$;
REVOKE ALL ON FUNCTION core._dashboard_latest_sales() FROM PUBLIC;

CREATE OR REPLACE FUNCTION core._dashboard_sales_series(
    p_from date,
    p_to date,
    p_bucket text
)
RETURNS TABLE (
    bucket_start timestamp,
    sales numeric,
    profit numeric,
    cash_sales numeric,
    credit_sales numeric,
    purchases numeric,
    sale_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
#variable_conflict use_column
DECLARE
    v_step interval := CASE p_bucket WHEN 'HOUR' THEN interval '1 hour' WHEN 'DAY' THEN interval '1 day' ELSE interval '1 month' END;
    v_start timestamp := CASE p_bucket WHEN 'MONTH' THEN date_trunc('month', p_from::timestamp)::timestamp ELSE p_from::timestamp END;
    v_end timestamp := CASE p_bucket WHEN 'HOUR' THEN p_from::timestamp + interval '23 hours'
                                    WHEN 'MONTH' THEN date_trunc('month', p_to::timestamp)::timestamp
                                    ELSE p_to::timestamp END;
BEGIN
    RETURN QUERY
    WITH b AS (
        SELECT gs::timestamp AS bucket_start
        FROM generate_series(v_start, v_end, v_step) gs
    ),
    s AS (
        SELECT core._dashboard_bucket_start(sale_date, posted_local, p_bucket) AS bs,
               net_total, cogs, sale_kind
        FROM core._dashboard_sales(p_from, p_to)
    ),
    sa AS (
        SELECT bs,
               sum(net_total) AS sales,
               sum(cogs) AS cogs,
               count(*)::bigint AS n,
               sum(net_total) FILTER (WHERE sale_kind = 'CASH') AS cash,
               sum(net_total) FILTER (WHERE sale_kind = 'CREDIT') AS credit
        FROM s
        GROUP BY bs
    ),
    pu AS (
        SELECT core._dashboard_bucket_start(purchase_date, posted_local, p_bucket) AS bs,
               sum(total) AS total
        FROM core._dashboard_purchases(p_from, p_to)
        GROUP BY 1
    )
    SELECT b.bucket_start,
           round(coalesce(sa.sales, 0), 2) AS sales,
           round(coalesce(sa.sales, 0) - coalesce(sa.cogs, 0), 2) AS profit,
           round(coalesce(sa.cash, 0), 2) AS cash_sales,
           round(coalesce(sa.credit, 0), 2) AS credit_sales,
           round(coalesce(pu.total, 0), 2) AS purchases,
           coalesce(sa.n, 0)::bigint AS sale_count
    FROM b
    LEFT JOIN sa ON sa.bs = b.bucket_start
    LEFT JOIN pu ON pu.bs = b.bucket_start
    ORDER BY b.bucket_start;
END;
$$;
REVOKE ALL ON FUNCTION core._dashboard_sales_series(date, date, text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION core._dashboard_sales_by_category(
    p_from date,
    p_to date
)
RETURNS TABLE (
    sort_order integer,
    category_key text,
    category_name text,
    sales_before_discount numeric,
    share_pct numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
    WITH raw_lines AS (
        SELECT l.category_id, sum(l.line_total) AS cat_total
        FROM core._dashboard_sale_lines(p_from, p_to) l
        GROUP BY l.category_id
    ),
    total_sales AS (
        SELECT coalesce(sum(cat_total), 0) AS total_all FROM raw_lines
    ),
    named_cats AS (
        SELECT r.category_id,
               c.name AS category_name,
               r.cat_total,
               row_number() OVER (ORDER BY r.cat_total DESC, c.name ASC, r.category_id ASC) AS rank
        FROM raw_lines r
        JOIN catalog.categories c ON c.id = r.category_id
        WHERE r.category_id IS NOT NULL
    ),
    top_named AS (
        SELECT rank::integer AS sort_order,
               'ID:' || category_id::text AS category_key,
               category_name,
               cat_total AS sales_before_discount
        FROM named_cats
        WHERE rank <= 8
    ),
    other_named AS (
        SELECT 9::integer AS sort_order,
               'OTHER'::text AS category_key,
               NULL::text AS category_name,
               sum(cat_total) AS sales_before_discount
        FROM named_cats
        WHERE rank > 8
        HAVING sum(cat_total) > 0
    ),
    unassigned AS (
        SELECT 10::integer AS sort_order,
               'NONE'::text AS category_key,
               NULL::text AS category_name,
               cat_total AS sales_before_discount
        FROM raw_lines
        WHERE category_id IS NULL AND cat_total > 0
    ),
    combined AS (
        SELECT * FROM top_named
        UNION ALL
        SELECT * FROM other_named
        UNION ALL
        SELECT * FROM unassigned
    )
    SELECT c.sort_order,
           c.category_key,
           c.category_name,
           round(c.sales_before_discount, 2) AS sales_before_discount,
           CASE
               WHEN ts.total_all > 0 THEN round(c.sales_before_discount / ts.total_all * 100, 1)
               ELSE NULL
           END AS share_pct
    FROM combined c, total_sales ts
    ORDER BY c.sort_order;
$$;
REVOKE ALL ON FUNCTION core._dashboard_sales_by_category(date, date) FROM PUBLIC;

CREATE OR REPLACE FUNCTION core._dashboard_busy_hours(
    p_from date,
    p_to date
)
RETURNS TABLE (
    weekday integer,
    hour integer,
    sale_count bigint,
    sales numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
    SELECT d.dow::integer AS weekday,
           h.hr::integer AS hour,
           count(s.document_id)::bigint AS sale_count,
           round(coalesce(sum(s.net_total), 0), 2) AS sales
    FROM generate_series(0, 6) d(dow)
    CROSS JOIN generate_series(0, 23) h(hr)
    LEFT JOIN core._dashboard_sales(p_from, p_to) s
           ON extract(dow FROM s.sale_date)::integer = d.dow
          AND extract(hour FROM s.posted_local)::integer = h.hr
    GROUP BY d.dow, h.hr
    ORDER BY d.dow, h.hr;
$$;
REVOKE ALL ON FUNCTION core._dashboard_busy_hours(date, date) FROM PUBLIC;

CREATE OR REPLACE FUNCTION core._dashboard_receivables_aging_at(p_as_of date)
RETURNS TABLE (
    sort_order integer,
    bucket text,
    amount numeric,
    item_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
    WITH total_rec AS (
        SELECT coalesce(sum(balance), 0) AS total_val
        FROM core._dashboard_customer_balances()
    ),
    items AS (
        SELECT oi.open_amount,
               core._dashboard_age_bucket(oi.age_days) AS b_name
        FROM core._dashboard_open_items_at(p_as_of) oi
    ),
    agg AS (
        SELECT b_name,
               coalesce(sum(open_amount), 0) AS b_amount,
               count(*)::bigint AS b_count
        FROM items
        GROUP BY b_name
    ),
    def_buckets AS (
        SELECT 1 AS s_order, '0_30'::text AS b_key UNION ALL
        SELECT 2, '31_60' UNION ALL
        SELECT 3, '61_90' UNION ALL
        SELECT 4, '91_PLUS'
    ),
    b_rows AS (
        SELECT db.s_order,
               db.b_key AS b_name,
               coalesce(a.b_amount, 0) AS b_amount,
               coalesce(a.b_count, 0) AS b_count
        FROM def_buckets db
        LEFT JOIN agg a ON a.b_name = db.b_key
    ),
    sum_b AS (
        SELECT coalesce(sum(b_amount), 0) AS open_sum FROM b_rows
    ),
    unapplied_row AS (
        SELECT 5 AS s_order,
               'UNAPPLIED'::text AS b_name,
               (tr.total_val - sb.open_sum) AS b_amount,
               0::bigint AS b_count
        FROM total_rec tr, sum_b sb
    ),
    total_row AS (
        SELECT 6 AS s_order,
               'TOTAL'::text AS b_name,
               tr.total_val AS b_amount,
               0::bigint AS b_count
        FROM total_rec tr
    ),
    all_rows AS (
        SELECT * FROM b_rows
        UNION ALL
        SELECT * FROM unapplied_row
        UNION ALL
        SELECT * FROM total_row
    )
    SELECT ar.s_order AS sort_order,
           ar.b_name AS bucket,
           round(ar.b_amount, 2) AS amount,
           ar.b_count AS item_count
    FROM all_rows ar
    ORDER BY ar.s_order;
$$;
REVOKE ALL ON FUNCTION core._dashboard_receivables_aging_at(date) FROM PUBLIC;

-- ============================================================================
-- 4. 12 Public functions (session check + validation + call)
-- ============================================================================

-- P1: dashboard_period
CREATE OR REPLACE FUNCTION core.dashboard_period(
    p_session_token text,
    p_period text,
    p_from date,
    p_to date
)
RETURNS TABLE (
    cur_from date,
    cur_to date,
    prev_from date,
    prev_to date,
    cut_time time,
    bucket text,
    today date
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    PERFORM 1 FROM iam.resolve_session(p_session_token);
    RETURN QUERY SELECT * FROM core._dashboard_period_bounds_at(p_period, p_from, p_to, now());
END;
$$;
REVOKE ALL ON FUNCTION core.dashboard_period(text, text, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.dashboard_period(text, text, date, date) TO stockiha_runtime;

-- P2: dashboard_money_summary
CREATE OR REPLACE FUNCTION core.dashboard_money_summary(
    p_session_token text,
    p_cur_from date,
    p_cur_to date,
    p_prev_from date,
    p_prev_to date,
    p_cut_time time
)
RETURNS TABLE (
    sales numeric,
    prev_sales numeric,
    sales_change_kind text,
    sales_change_pct numeric,
    profit numeric,
    prev_profit numeric,
    profit_change_kind text,
    profit_change_pct numeric,
    margin_pct numeric,
    sale_count bigint,
    prev_sale_count bigint,
    count_change_kind text,
    count_change_pct numeric,
    average_sale numeric,
    discount_total numeric,
    cash_sales numeric,
    credit_sales numeric,
    cash_in_drawer numeric,
    open_session_count bigint,
    receivables_total numeric,
    payables_total numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_today date := (now() AT TIME ZONE 'Africa/Algiers')::date;
BEGIN
    PERFORM 1 FROM iam.resolve_session(p_session_token);
    PERFORM core._dashboard_validate_window(p_cur_from, p_cur_to, v_today);
    PERFORM core._dashboard_validate_window(p_prev_from, p_prev_to, v_today);
    RETURN QUERY SELECT * FROM core._dashboard_money_summary(p_cur_from, p_cur_to, p_prev_from, p_prev_to, p_cut_time);
END;
$$;
REVOKE ALL ON FUNCTION core.dashboard_money_summary(text, date, date, date, date, time) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.dashboard_money_summary(text, date, date, date, date, time) TO stockiha_runtime;

-- P3: dashboard_stock_summary
CREATE OR REPLACE FUNCTION core.dashboard_stock_summary(
    p_session_token text,
    p_dead_days integer
)
RETURNS TABLE (
    stock_value numeric,
    low_count bigint,
    out_count bigint,
    dead_count bigint,
    dead_value numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_today date := (now() AT TIME ZONE 'Africa/Algiers')::date;
BEGIN
    PERFORM 1 FROM iam.resolve_session(p_session_token);
    IF p_dead_days NOT IN (30, 60, 90, 180) THEN
        RAISE EXCEPTION 'DASHBOARD_DEAD_DAYS_INVALID: %', p_dead_days USING ERRCODE = '22023';
    END IF;
    RETURN QUERY SELECT * FROM core._dashboard_stock_summary_at(p_dead_days, v_today);
END;
$$;
REVOKE ALL ON FUNCTION core.dashboard_stock_summary(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.dashboard_stock_summary(text, integer) TO stockiha_runtime;

-- P4: dashboard_stock_items
CREATE OR REPLACE FUNCTION core.dashboard_stock_items(
    p_session_token text,
    p_kind text,
    p_dead_days integer,
    p_limit integer,
    p_offset integer
)
RETURNS TABLE (
    variant_id bigint,
    product_id bigint,
    item_name text,
    display_identifier text,
    identifier_type text,
    base_unit_name text,
    quantity numeric,
    minimum_stock numeric,
    stock_value numeric,
    last_sold_on date,
    total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_today date := (now() AT TIME ZONE 'Africa/Algiers')::date;
BEGIN
    PERFORM 1 FROM iam.resolve_session(p_session_token);
    IF p_kind NOT IN ('low', 'out', 'dead') THEN
        RAISE EXCEPTION 'DASHBOARD_KIND_INVALID: %', p_kind USING ERRCODE = '22023';
    END IF;
    IF p_dead_days NOT IN (30, 60, 90, 180) THEN
        RAISE EXCEPTION 'DASHBOARD_DEAD_DAYS_INVALID: %', p_dead_days USING ERRCODE = '22023';
    END IF;
    IF p_offset < 0 THEN
        RAISE EXCEPTION 'DASHBOARD_PAGING_INVALID: offset % cannot be negative', p_offset USING ERRCODE = '22023';
    END IF;
    RETURN QUERY SELECT * FROM core._dashboard_stock_items_at(p_kind, p_dead_days, p_limit, p_offset, v_today);
END;
$$;
REVOKE ALL ON FUNCTION core.dashboard_stock_items(text, text, integer, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.dashboard_stock_items(text, text, integer, integer, integer) TO stockiha_runtime;

-- P5: dashboard_top_items
CREATE OR REPLACE FUNCTION core.dashboard_top_items(
    p_session_token text,
    p_from date,
    p_to date,
    p_limit integer
)
RETURNS TABLE (
    variant_id bigint,
    item_name text,
    base_unit_name text,
    quantity_sold numeric,
    sales_before_discount numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_today date := (now() AT TIME ZONE 'Africa/Algiers')::date;
BEGIN
    PERFORM 1 FROM iam.resolve_session(p_session_token);
    PERFORM core._dashboard_validate_window(p_from, p_to, v_today);
    RETURN QUERY SELECT * FROM core._dashboard_top_items(p_from, p_to, p_limit);
END;
$$;
REVOKE ALL ON FUNCTION core.dashboard_top_items(text, date, date, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.dashboard_top_items(text, date, date, integer) TO stockiha_runtime;

-- P6: dashboard_top_customers
CREATE OR REPLACE FUNCTION core.dashboard_top_customers(
    p_session_token text,
    p_from date,
    p_to date
)
RETURNS TABLE (
    customer_id bigint,
    customer_name text,
    sale_count bigint,
    sales numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_today date := (now() AT TIME ZONE 'Africa/Algiers')::date;
BEGIN
    PERFORM 1 FROM iam.resolve_session(p_session_token);
    PERFORM core._dashboard_validate_window(p_from, p_to, v_today);
    RETURN QUERY SELECT * FROM core._dashboard_top_customers(p_from, p_to);
END;
$$;
REVOKE ALL ON FUNCTION core.dashboard_top_customers(text, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.dashboard_top_customers(text, date, date) TO stockiha_runtime;

-- P7: dashboard_top_debtors
CREATE OR REPLACE FUNCTION core.dashboard_top_debtors(
    p_session_token text
)
RETURNS TABLE (
    customer_id bigint,
    customer_name text,
    amount_owed numeric,
    oldest_open_on date,
    oldest_open_days integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_today date := (now() AT TIME ZONE 'Africa/Algiers')::date;
BEGIN
    PERFORM 1 FROM iam.resolve_session(p_session_token);
    RETURN QUERY SELECT * FROM core._dashboard_top_debtors_at(v_today);
END;
$$;
REVOKE ALL ON FUNCTION core.dashboard_top_debtors(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.dashboard_top_debtors(text) TO stockiha_runtime;

-- P8: dashboard_latest_sales
CREATE OR REPLACE FUNCTION core.dashboard_latest_sales(
    p_session_token text
)
RETURNS TABLE (
    document_id bigint,
    document_number text,
    posted_local timestamp,
    sale_kind text,
    customer_name text,
    total numeric,
    is_voided boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    PERFORM 1 FROM iam.resolve_session(p_session_token);
    RETURN QUERY SELECT * FROM core._dashboard_latest_sales();
END;
$$;
REVOKE ALL ON FUNCTION core.dashboard_latest_sales(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.dashboard_latest_sales(text) TO stockiha_runtime;

-- P9: dashboard_sales_series
CREATE OR REPLACE FUNCTION core.dashboard_sales_series(
    p_session_token text,
    p_from date,
    p_to date,
    p_bucket text
)
RETURNS TABLE (
    bucket_start timestamp,
    sales numeric,
    profit numeric,
    cash_sales numeric,
    credit_sales numeric,
    purchases numeric,
    sale_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_today date := (now() AT TIME ZONE 'Africa/Algiers')::date;
BEGIN
    PERFORM 1 FROM iam.resolve_session(p_session_token);
    PERFORM core._dashboard_validate_window(p_from, p_to, v_today);
    IF p_bucket NOT IN ('HOUR', 'DAY', 'MONTH') THEN
        RAISE EXCEPTION 'DASHBOARD_BUCKET_INVALID: %', p_bucket USING ERRCODE = '22023';
    END IF;
    IF p_bucket = 'HOUR' AND p_from <> p_to THEN
        RAISE EXCEPTION 'DASHBOARD_BUCKET_INVALID: HOUR bucket requires from and to to be the same date' USING ERRCODE = '22023';
    END IF;
    IF p_bucket = 'DAY' AND (p_to - p_from + 1) > 366 THEN
        RAISE EXCEPTION 'DASHBOARD_BUCKET_INVALID: DAY bucket window exceeds 366 days (% days)', (p_to - p_from + 1) USING ERRCODE = '22023';
    END IF;
    RETURN QUERY SELECT * FROM core._dashboard_sales_series(p_from, p_to, p_bucket);
END;
$$;
REVOKE ALL ON FUNCTION core.dashboard_sales_series(text, date, date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.dashboard_sales_series(text, date, date, text) TO stockiha_runtime;

-- P10: dashboard_sales_by_category
CREATE OR REPLACE FUNCTION core.dashboard_sales_by_category(
    p_session_token text,
    p_from date,
    p_to date
)
RETURNS TABLE (
    sort_order integer,
    category_key text,
    category_name text,
    sales_before_discount numeric,
    share_pct numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_today date := (now() AT TIME ZONE 'Africa/Algiers')::date;
BEGIN
    PERFORM 1 FROM iam.resolve_session(p_session_token);
    PERFORM core._dashboard_validate_window(p_from, p_to, v_today);
    RETURN QUERY SELECT * FROM core._dashboard_sales_by_category(p_from, p_to);
END;
$$;
REVOKE ALL ON FUNCTION core.dashboard_sales_by_category(text, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.dashboard_sales_by_category(text, date, date) TO stockiha_runtime;

-- P11: dashboard_busy_hours
CREATE OR REPLACE FUNCTION core.dashboard_busy_hours(
    p_session_token text,
    p_from date,
    p_to date
)
RETURNS TABLE (
    weekday integer,
    hour integer,
    sale_count bigint,
    sales numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_today date := (now() AT TIME ZONE 'Africa/Algiers')::date;
BEGIN
    PERFORM 1 FROM iam.resolve_session(p_session_token);
    PERFORM core._dashboard_validate_window(p_from, p_to, v_today);
    RETURN QUERY SELECT * FROM core._dashboard_busy_hours(p_from, p_to);
END;
$$;
REVOKE ALL ON FUNCTION core.dashboard_busy_hours(text, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.dashboard_busy_hours(text, date, date) TO stockiha_runtime;

-- P12: dashboard_receivables_aging
CREATE OR REPLACE FUNCTION core.dashboard_receivables_aging(
    p_session_token text
)
RETURNS TABLE (
    sort_order integer,
    bucket text,
    amount numeric,
    item_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_today date := (now() AT TIME ZONE 'Africa/Algiers')::date;
BEGIN
    PERFORM 1 FROM iam.resolve_session(p_session_token);
    RETURN QUERY SELECT * FROM core._dashboard_receivables_aging_at(v_today);
END;
$$;
REVOKE ALL ON FUNCTION core.dashboard_receivables_aging(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.dashboard_receivables_aging(text) TO stockiha_runtime;

UPDATE operations.schema_state SET migration_version = 20261005103000, updated_at = now() WHERE singleton;

RESET ROLE;
