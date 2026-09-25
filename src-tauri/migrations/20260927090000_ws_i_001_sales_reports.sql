-- WS-I-001: reporting foundation + sales & profit reports.
-- Read-only functions only. Fully re-runnable (WS-K-5 safe-upgrade fixture).
SET ROLE stockiha_owner;

-- ============================================================================
-- 1. Schema
-- ============================================================================
CREATE SCHEMA IF NOT EXISTS reports AUTHORIZATION stockiha_owner;
REVOKE ALL ON SCHEMA reports FROM PUBLIC;
GRANT USAGE ON SCHEMA reports TO stockiha_runtime;

-- ============================================================================
-- 2. Permission VIEW_REPORTS (guarded, like WS-F-006)
-- ============================================================================
DO $$
DECLARE v_existing_check text;
BEGIN
    SELECT pg_get_expr(c.conbin, c.conrelid) INTO v_existing_check
    FROM pg_constraint c
    WHERE c.conrelid = 'iam.permissions'::regclass
      AND c.conname = 'permissions_code_valid' AND c.contype = 'c';
    IF v_existing_check IS NULL THEN
        RAISE EXCEPTION 'expected iam.permissions constraint permissions_code_valid is missing';
    END IF;
    IF position('VIEW_REPORTS' in v_existing_check) = 0 THEN
        ALTER TABLE iam.permissions DROP CONSTRAINT permissions_code_valid;
        EXECUTE format(
            'ALTER TABLE iam.permissions ADD CONSTRAINT permissions_code_valid CHECK ((%s) OR code = %L)',
            v_existing_check, 'VIEW_REPORTS');
    END IF;
END;
$$;

INSERT INTO iam.permissions (code, name)
VALUES ('VIEW_REPORTS', 'View sales, finance and stock reports')
ON CONFLICT (code) DO NOTHING;

INSERT INTO iam.role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM iam.roles role CROSS JOIN iam.permissions permission
WHERE role.code IN ('ADMIN', 'MANAGER', 'SUPER_ADMIN') AND permission.code = 'VIEW_REPORTS'
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 3. Indexes
-- ============================================================================
CREATE INDEX IF NOT EXISTS business_documents_type_status_date_idx
    ON core.business_documents (document_type, status, document_date);
CREATE INDEX IF NOT EXISTS cash_sale_lines_variant_idx ON sales.cash_sale_lines (variant_id);
CREATE INDEX IF NOT EXISTS credit_sale_lines_variant_idx ON sales.credit_sale_lines (variant_id);

-- ============================================================================
-- 4. Internal helpers
-- ============================================================================
CREATE OR REPLACE FUNCTION reports._check_period(p_from date, p_to date)
RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $$
BEGIN
    IF p_from IS NULL OR p_to IS NULL THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: both dates are required' USING ERRCODE = '22023';
    END IF;
    IF p_from > p_to THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: the start date is after the end date' USING ERRCODE = '22023';
    END IF;
    IF p_to - p_from > 3660 THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: the period is longer than ten years' USING ERRCODE = '22023';
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION reports._week_start(p_day date)
RETURNS date LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
    -- Saturday-start week. isodow: Mon=1 … Sat=6, Sun=7.
    SELECT p_day - ((extract(isodow FROM p_day)::int + 1) % 7)
$$;

CREATE OR REPLACE FUNCTION reports._weekday_index(p_day date)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
    -- 0 = Saturday … 6 = Friday
    SELECT (extract(isodow FROM p_day)::int + 1) % 7
$$;

CREATE OR REPLACE FUNCTION reports._pattern(p_search text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $$
DECLARE v text := nullif(btrim(coalesce(p_search, '')), '');
BEGIN
    IF v IS NULL THEN RETURN NULL; END IF;
    IF char_length(v) > 100 THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: search text must be at most 100 characters' USING ERRCODE = '22023';
    END IF;
    RETURN '%' || replace(replace(replace(v, '\', '\\'), '%', '\%'), '_', '\_') || '%';
END;
$$;

CREATE OR REPLACE FUNCTION reports._variant_info()
RETURNS TABLE (
    variant_id bigint, product_id bigint, product_name text, variant_label text, sku text,
    category_id bigint, category_name text, base_unit_name text, pack_unit_name text,
    pack_factor numeric, is_active boolean, sale_price numeric, minimum_stock numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
    SELECT v.id, p.id, p.name,
           coalesce(nullif(btrim(v.name_override), ''), v.sku),
           v.sku, p.category_id, c.name,
           coalesce(u.name, ''),
           pack.unit_name, pack.factor,
           (v.is_active AND p.is_active), v.sale_price, v.minimum_stock
    FROM catalog.product_variants v
    JOIN catalog.products p ON p.id = v.product_id
    LEFT JOIN catalog.categories c ON c.id = p.category_id
    LEFT JOIN catalog.units u ON u.id = coalesce(v.base_unit_id, p.unit_id)
    LEFT JOIN LATERAL (
        SELECT pu.name AS unit_name, vu.conversion_factor AS factor
        FROM catalog.variant_units vu
        JOIN catalog.units pu ON pu.id = vu.unit_id
        WHERE vu.variant_id = v.id
        ORDER BY vu.conversion_factor DESC, vu.unit_id ASC
        LIMIT 1
    ) pack ON true
$$;

CREATE OR REPLACE FUNCTION reports._sale_lines(p_from date, p_to date)
RETURNS TABLE (
    document_id bigint, document_number text, sale_kind text, document_date date,
    posted_local timestamp, customer_id bigint, cashier_user_id bigint, line_number integer,
    variant_id bigint, quantity numeric, line_total numeric, discount_share numeric,
    net_revenue numeric, line_cost numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
    WITH cash_lines AS (
        SELECT d.id AS document_id, d.document_number, d.document_date,
               (d.posted_at AT TIME ZONE 'Africa/Algiers') AS posted_local,
               (SELECT m.recorded_by_user_id FROM cash.movements m
                 WHERE m.business_document_id = d.id AND m.movement_type = 'SALE'
                 ORDER BY m.id LIMIT 1) AS cashier_user_id,
               l.line_number::integer AS line_number, l.variant_id, l.quantity, l.line_total,
               coalesce(l.unit_cost_snapshot, 0) AS unit_cost,
               cs.subtotal, coalesce(cs.discount_amount, 0) AS discount_amount,
               max(l.line_number::integer) OVER (PARTITION BY d.id) AS last_line
        FROM core.business_documents d
        JOIN sales.cash_sales cs ON cs.document_id = d.id
        JOIN sales.cash_sale_lines l ON l.document_id = d.id
        WHERE d.document_type = 'CASH_SALE' AND d.status = 'POSTED'
          AND d.document_date BETWEEN p_from AND p_to
    ),
    cash_shares AS (
        SELECT cl.*,
               CASE
                   WHEN cl.discount_amount = 0 OR cl.subtotal = 0 THEN 0::numeric
                   WHEN cl.line_number < cl.last_line
                       THEN round(cl.discount_amount * cl.line_total / cl.subtotal, 2)
                   ELSE cl.discount_amount - coalesce((
                       SELECT sum(round(o.discount_amount * o.line_total / o.subtotal, 2))
                       FROM cash_lines o
                       WHERE o.document_id = cl.document_id AND o.line_number < o.last_line), 0)
               END AS share
        FROM cash_lines cl
    )
    SELECT s.document_id, s.document_number, 'CASH'::text, s.document_date, s.posted_local,
           NULL::bigint, s.cashier_user_id, s.line_number, s.variant_id, s.quantity,
           s.line_total, s.share::numeric(14,2),
           (s.line_total - s.share)::numeric(14,2),
           round(s.quantity * s.unit_cost, 2)::numeric(14,2)
    FROM cash_shares s
    UNION ALL
    SELECT d.id, d.document_number, 'CREDIT'::text, d.document_date,
           (d.posted_at AT TIME ZONE 'Africa/Algiers'),
           cr.customer_id, cr.posted_by_user_id, l.line_number::integer, l.variant_id,
           l.quantity, l.line_total, 0::numeric(14,2), l.line_total::numeric(14,2),
           round(l.quantity * coalesce(l.unit_cost_snapshot, 0), 2)::numeric(14,2)
    FROM core.business_documents d
    JOIN sales.credit_sales cr ON cr.document_id = d.id
    JOIN sales.credit_sale_lines l ON l.document_id = d.id
    WHERE d.document_type = 'CREDIT_SALE' AND d.status = 'POSTED'
      AND d.document_date BETWEEN p_from AND p_to
$$;

REVOKE ALL ON FUNCTION reports._check_period(date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION reports._week_start(date) FROM PUBLIC;
REVOKE ALL ON FUNCTION reports._weekday_index(date) FROM PUBLIC;
REVOKE ALL ON FUNCTION reports._pattern(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION reports._variant_info() FROM PUBLIC;
REVOKE ALL ON FUNCTION reports._sale_lines(date, date) FROM PUBLIC;

-- ============================================================================
-- 5. Capabilities
-- ============================================================================
CREATE OR REPLACE FUNCTION reports.get_capabilities(p_session_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE v_user_id bigint;
BEGIN
    SELECT user_id INTO v_user_id FROM iam.resolve_session(p_session_token);
    RETURN jsonb_build_object('can_view_reports', EXISTS (
        SELECT 1 FROM iam.user_roles ur
        JOIN iam.role_permissions rp ON rp.role_id = ur.role_id
        JOIN iam.permissions perm ON perm.id = rp.permission_id
        WHERE ur.user_id = v_user_id AND perm.code = 'VIEW_REPORTS'));
END;
$$;

-- ============================================================================
-- 6. Sales summary
-- ============================================================================
CREATE OR REPLACE FUNCTION reports.get_sales_summary(p_session_token text, p_from date, p_to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
    r record;
    v_void_count bigint;
    v_void_total numeric;
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'VIEW_REPORTS');
    PERFORM reports._check_period(p_from, p_to);

    SELECT coalesce(sum(sl.line_total), 0) AS gross,
           coalesce(sum(sl.discount_share), 0) AS discounts,
           coalesce(sum(sl.net_revenue), 0) AS net,
           coalesce(sum(sl.line_cost), 0) AS cost,
           count(DISTINCT sl.document_id) AS sale_count,
           coalesce(sum(sl.net_revenue) FILTER (WHERE sl.sale_kind = 'CASH'), 0) AS cash_net,
           coalesce(sum(sl.net_revenue) FILTER (WHERE sl.sale_kind = 'CREDIT'), 0) AS credit_net,
           count(DISTINCT sl.document_id) FILTER (WHERE sl.sale_kind = 'CASH') AS cash_count,
           count(DISTINCT sl.document_id) FILTER (WHERE sl.sale_kind = 'CREDIT') AS credit_count,
           coalesce(sum(sl.quantity), 0) AS units
    INTO r
    FROM reports._sale_lines(p_from, p_to) sl;

    SELECT count(*), coalesce(sum(v.total_amount), 0)
    INTO v_void_count, v_void_total
    FROM sales.sale_voids v
    JOIN core.business_documents d ON d.id = v.void_document_id
    WHERE d.status = 'POSTED' AND d.document_date BETWEEN p_from AND p_to;

    RETURN jsonb_build_object(
        'from', p_from, 'to', p_to,
        'gross_sales', r.gross::numeric(14,2)::text,
        'discounts', r.discounts::numeric(14,2)::text,
        'net_sales', r.net::numeric(14,2)::text,
        'cost', r.cost::numeric(14,2)::text,
        'gross_profit', (r.net - r.cost)::numeric(14,2)::text,
        'margin_pct', CASE WHEN r.net = 0 THEN NULL
                           ELSE round((r.net - r.cost) / r.net * 100, 1)::text END,
        'sale_count', r.sale_count,
        'avg_basket', CASE WHEN r.sale_count = 0 THEN NULL
                           ELSE (r.net / r.sale_count)::numeric(14,2)::text END,
        'cash_net', r.cash_net::numeric(14,2)::text,
        'credit_net', r.credit_net::numeric(14,2)::text,
        'cash_count', r.cash_count,
        'credit_count', r.credit_count,
        'void_count', v_void_count,
        'void_total', v_void_total::numeric(14,2)::text,
        'units_sold_base', r.units::text
    );
END;
$$;

-- ============================================================================
-- 7. Sales over time
-- ============================================================================
CREATE OR REPLACE FUNCTION reports.get_sales_timeseries(
    p_session_token text, p_from date, p_to date, p_granularity text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE v_rows jsonb;
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'VIEW_REPORTS');
    PERFORM reports._check_period(p_from, p_to);
    IF p_granularity IS NULL OR p_granularity NOT IN ('DAY', 'WEEK', 'MONTH') THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: granularity must be DAY, WEEK or MONTH' USING ERRCODE = '22023';
    END IF;

    WITH buckets AS (
        SELECT b::date AS bucket_start
        FROM generate_series(
            CASE p_granularity
                WHEN 'DAY' THEN p_from
                WHEN 'WEEK' THEN reports._week_start(p_from)
                ELSE date_trunc('month', p_from)::date END,
            p_to,
            CASE p_granularity WHEN 'DAY' THEN interval '1 day'
                               WHEN 'WEEK' THEN interval '7 days'
                               ELSE interval '1 month' END) AS b
    ),
    agg AS (
        SELECT CASE p_granularity
                   WHEN 'DAY' THEN sl.document_date
                   WHEN 'WEEK' THEN reports._week_start(sl.document_date)
                   ELSE date_trunc('month', sl.document_date)::date END AS bucket_start,
               sum(sl.net_revenue) AS net, sum(sl.line_cost) AS cost,
               count(DISTINCT sl.document_id) AS cnt
        FROM reports._sale_lines(p_from, p_to) sl
        GROUP BY 1
    )
    SELECT coalesce(jsonb_agg(jsonb_build_object(
               'bucket_start', b.bucket_start,
               'net_sales', coalesce(a.net, 0)::numeric(14,2)::text,
               'gross_profit', coalesce(a.net - a.cost, 0)::numeric(14,2)::text,
               'sale_count', coalesce(a.cnt, 0)
           ) ORDER BY b.bucket_start), '[]'::jsonb)
    INTO v_rows
    FROM buckets b LEFT JOIN agg a ON a.bucket_start = b.bucket_start;

    RETURN jsonb_build_object('granularity', p_granularity, 'rows', v_rows);
END;
$$;

-- ============================================================================
-- 8. Sales by product
-- ============================================================================
CREATE OR REPLACE FUNCTION reports.get_sales_by_product(
    p_session_token text, p_from date, p_to date, p_sort text,
    p_search text, p_limit integer, p_offset integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
    v_pattern text;
    v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 500);
    v_offset integer := greatest(coalesce(p_offset, 0), 0);
    v_total bigint;
    v_rows jsonb;
    v_totals jsonb;
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'VIEW_REPORTS');
    PERFORM reports._check_period(p_from, p_to);
    IF coalesce(p_sort, 'REVENUE') NOT IN ('REVENUE', 'QUANTITY', 'PROFIT', 'MARGIN') THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: unsupported sort' USING ERRCODE = '22023';
    END IF;
    v_pattern := reports._pattern(p_search);

    WITH per_variant AS (
        SELECT sl.variant_id, sum(sl.quantity) AS qty, sum(sl.net_revenue) AS net,
               sum(sl.line_cost) AS cost, count(DISTINCT sl.document_id) AS sale_count
        FROM reports._sale_lines(p_from, p_to) sl
        GROUP BY sl.variant_id
    ),
    joined AS (
        SELECT pv.*, vi.product_name, vi.variant_label, vi.sku, vi.category_name,
               vi.base_unit_name, vi.pack_unit_name, vi.pack_factor,
               (pv.net - pv.cost) AS profit,
               CASE WHEN pv.net = 0 THEN NULL ELSE (pv.net - pv.cost) / pv.net * 100 END AS margin
        FROM per_variant pv
        JOIN reports._variant_info() vi ON vi.variant_id = pv.variant_id
        WHERE v_pattern IS NULL
           OR vi.product_name ILIKE v_pattern ESCAPE '\'
           OR vi.variant_label ILIKE v_pattern ESCAPE '\'
           OR vi.sku ILIKE v_pattern ESCAPE '\'
    ),
    page AS (
        SELECT * FROM joined
        ORDER BY CASE coalesce(p_sort, 'REVENUE')
                     WHEN 'QUANTITY' THEN qty
                     WHEN 'PROFIT' THEN profit
                     WHEN 'MARGIN' THEN coalesce(margin, -1000000)
                     ELSE net END DESC,
                 variant_id ASC
        LIMIT v_limit OFFSET v_offset
    )
    SELECT (SELECT count(*) FROM joined),
           coalesce((SELECT jsonb_agg(jsonb_build_object(
               'variant_id', p.variant_id, 'product_name', p.product_name,
               'variant_label', p.variant_label, 'sku', p.sku,
               'category_name', p.category_name,
               'quantity_base', p.qty::text, 'base_unit_name', p.base_unit_name,
               'pack_unit_name', p.pack_unit_name, 'pack_factor', p.pack_factor::text,
               'net_revenue', p.net::numeric(14,2)::text, 'cost', p.cost::numeric(14,2)::text,
               'gross_profit', p.profit::numeric(14,2)::text,
               'margin_pct', CASE WHEN p.margin IS NULL THEN NULL ELSE round(p.margin, 1)::text END,
               'sale_count', p.sale_count
           ) ORDER BY CASE coalesce(p_sort, 'REVENUE')
                          WHEN 'QUANTITY' THEN p.qty
                          WHEN 'PROFIT' THEN p.profit
                          WHEN 'MARGIN' THEN coalesce(p.margin, -1000000)
                          ELSE p.net END DESC, p.variant_id ASC)
               FROM page p), '[]'::jsonb),
           (SELECT jsonb_build_object(
               'net_revenue', coalesce(sum(net), 0)::numeric(14,2)::text,
               'cost', coalesce(sum(cost), 0)::numeric(14,2)::text,
               'gross_profit', coalesce(sum(profit), 0)::numeric(14,2)::text) FROM joined)
    INTO v_total, v_rows, v_totals;

    RETURN jsonb_build_object('total_count', v_total, 'rows', v_rows, 'totals', v_totals);
END;
$$;

-- ============================================================================
-- 9. Sales by category
-- ============================================================================
CREATE OR REPLACE FUNCTION reports.get_sales_by_category(p_session_token text, p_from date, p_to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE v_rows jsonb;
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'VIEW_REPORTS');
    PERFORM reports._check_period(p_from, p_to);

    WITH per_cat AS (
        SELECT vi.category_id, vi.category_name,
               sum(sl.net_revenue) AS net, sum(sl.line_cost) AS cost, sum(sl.quantity) AS qty
        FROM reports._sale_lines(p_from, p_to) sl
        JOIN reports._variant_info() vi ON vi.variant_id = sl.variant_id
        GROUP BY vi.category_id, vi.category_name
    ),
    total AS (SELECT sum(net) AS all_net FROM per_cat)
    SELECT coalesce(jsonb_agg(jsonb_build_object(
               'category_id', pc.category_id, 'category_name', pc.category_name,
               'net_revenue', pc.net::numeric(14,2)::text,
               'gross_profit', (pc.net - pc.cost)::numeric(14,2)::text,
               'margin_pct', CASE WHEN pc.net = 0 THEN NULL
                                  ELSE round((pc.net - pc.cost) / pc.net * 100, 1)::text END,
               'quantity_base', pc.qty::text,
               'share_pct', CASE WHEN t.all_net IS NULL OR t.all_net = 0 THEN NULL
                                 ELSE round(pc.net / t.all_net * 100, 1)::text END
           ) ORDER BY pc.net DESC), '[]'::jsonb)
    INTO v_rows
    FROM per_cat pc CROSS JOIN total t;

    RETURN jsonb_build_object('rows', v_rows);
END;
$$;

-- ============================================================================
-- 10. Sales by cashier
-- ============================================================================
CREATE OR REPLACE FUNCTION reports.get_sales_by_cashier(p_session_token text, p_from date, p_to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE v_rows jsonb;
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'VIEW_REPORTS');
    PERFORM reports._check_period(p_from, p_to);

    WITH per_user AS (
        SELECT sl.cashier_user_id AS user_id,
               count(DISTINCT sl.document_id) AS cnt,
               sum(sl.net_revenue) AS net, sum(sl.line_cost) AS cost,
               coalesce(sum(sl.net_revenue) FILTER (WHERE sl.sale_kind = 'CASH'), 0) AS cash_net,
               coalesce(sum(sl.net_revenue) FILTER (WHERE sl.sale_kind = 'CREDIT'), 0) AS credit_net
        FROM reports._sale_lines(p_from, p_to) sl
        GROUP BY sl.cashier_user_id
    )
    SELECT coalesce(jsonb_agg(jsonb_build_object(
               'user_id', pu.user_id, 'username', u.username,
               'sale_count', pu.cnt,
               'net_revenue', pu.net::numeric(14,2)::text,
               'gross_profit', (pu.net - pu.cost)::numeric(14,2)::text,
               'avg_basket', CASE WHEN pu.cnt = 0 THEN NULL ELSE (pu.net / pu.cnt)::numeric(14,2)::text END,
               'cash_net', pu.cash_net::numeric(14,2)::text,
               'credit_net', pu.credit_net::numeric(14,2)::text
           ) ORDER BY pu.net DESC), '[]'::jsonb)
    INTO v_rows
    FROM per_user pu LEFT JOIN iam.users u ON u.id = pu.user_id;

    RETURN jsonb_build_object('rows', v_rows);
END;
$$;

-- ============================================================================
-- 11. Busy hours (7 x 24 grid, 0 = Saturday)
-- ============================================================================
CREATE OR REPLACE FUNCTION reports.get_sales_by_hour(p_session_token text, p_from date, p_to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE v_rows jsonb;
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'VIEW_REPORTS');
    PERFORM reports._check_period(p_from, p_to);

    WITH per_doc AS (
        SELECT sl.document_id,
               reports._weekday_index(sl.posted_local::date) AS weekday,
               extract(hour FROM sl.posted_local)::int AS hour,
               sum(sl.net_revenue) AS net
        FROM reports._sale_lines(p_from, p_to) sl
        WHERE sl.posted_local IS NOT NULL
        GROUP BY sl.document_id, 2, 3
    ),
    agg AS (
        SELECT weekday, hour, count(*) AS cnt, sum(net) AS net
        FROM per_doc GROUP BY weekday, hour
    ),
    grid AS (
        SELECT w AS weekday, h AS hour FROM generate_series(0, 6) w CROSS JOIN generate_series(0, 23) h
    )
    SELECT jsonb_agg(jsonb_build_object(
               'weekday', g.weekday, 'hour', g.hour,
               'sale_count', coalesce(a.cnt, 0),
               'net_sales', coalesce(a.net, 0)::numeric(14,2)::text
           ) ORDER BY g.weekday, g.hour)
    INTO v_rows
    FROM grid g LEFT JOIN agg a ON a.weekday = g.weekday AND a.hour = g.hour;

    RETURN jsonb_build_object('rows', v_rows);
END;
$$;

-- ============================================================================
-- 12. Margin alerts (idea I)
-- ============================================================================
CREATE OR REPLACE FUNCTION reports.get_margin_alerts(
    p_session_token text, p_from date, p_to date, p_threshold_pct numeric)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
    v_threshold numeric := coalesce(p_threshold_pct, 5);
    v_rows jsonb;
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'VIEW_REPORTS');
    PERFORM reports._check_period(p_from, p_to);
    IF v_threshold < 0 OR v_threshold > 50 THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: threshold must be between 0 and 50' USING ERRCODE = '22023';
    END IF;

    WITH per_variant AS (
        SELECT sl.variant_id, sum(sl.quantity) AS qty, sum(sl.net_revenue) AS net,
               sum(sl.line_cost) AS cost,
               count(*) FILTER (WHERE sl.net_revenue < sl.line_cost) AS below_cost_lines
        FROM reports._sale_lines(p_from, p_to) sl
        GROUP BY sl.variant_id
    ),
    wac AS (
        SELECT variant_id,
               CASE WHEN sum(quantity_on_hand) > 0 THEN sum(total_value) / sum(quantity_on_hand) END AS wac
        FROM inventory.positions GROUP BY variant_id
    ),
    flagged AS (
        SELECT pv.*, vi.product_name, vi.variant_label, vi.sku, vi.base_unit_name,
               vi.pack_unit_name, vi.pack_factor, vi.sale_price, w.wac,
               CASE WHEN pv.net = 0 THEN NULL ELSE (pv.net - pv.cost) / pv.net * 100 END AS margin
        FROM per_variant pv
        JOIN reports._variant_info() vi ON vi.variant_id = pv.variant_id
        LEFT JOIN wac w ON w.variant_id = pv.variant_id
    )
    SELECT coalesce(jsonb_agg(jsonb_build_object(
               'variant_id', f.variant_id, 'product_name', f.product_name,
               'variant_label', f.variant_label, 'sku', f.sku,
               'quantity_base', f.qty::text, 'base_unit_name', f.base_unit_name,
               'pack_unit_name', f.pack_unit_name, 'pack_factor', f.pack_factor::text,
               'net_revenue', f.net::numeric(14,2)::text, 'cost', f.cost::numeric(14,2)::text,
               'gross_profit', (f.net - f.cost)::numeric(14,2)::text,
               'margin_pct', CASE WHEN f.margin IS NULL THEN NULL ELSE round(f.margin, 1)::text END,
               'below_cost_lines', f.below_cost_lines,
               'current_sale_price', f.sale_price::numeric(14,2)::text,
               'current_wac', CASE WHEN f.wac IS NULL THEN NULL ELSE f.wac::numeric(14,2)::text END,
               'suggested_min_price', CASE WHEN f.wac IS NULL THEN NULL
                                           ELSE round(f.wac * (1 + v_threshold / 100), 2)::text END
           ) ORDER BY (f.net - f.cost) ASC, f.variant_id), '[]'::jsonb)
    INTO v_rows
    FROM flagged f
    WHERE f.below_cost_lines > 0 OR (f.margin IS NOT NULL AND f.margin < v_threshold);

    RETURN jsonb_build_object('threshold_pct', v_threshold::text, 'rows', v_rows);
END;
$$;

-- ============================================================================
-- 13. Grants
-- ============================================================================
REVOKE ALL ON FUNCTION reports.get_capabilities(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION reports.get_sales_summary(text, date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION reports.get_sales_timeseries(text, date, date, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION reports.get_sales_by_product(text, date, date, text, text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION reports.get_sales_by_category(text, date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION reports.get_sales_by_cashier(text, date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION reports.get_sales_by_hour(text, date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION reports.get_margin_alerts(text, date, date, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reports.get_capabilities(text) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION reports.get_sales_summary(text, date, date) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION reports.get_sales_timeseries(text, date, date, text) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION reports.get_sales_by_product(text, date, date, text, text, integer, integer) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION reports.get_sales_by_category(text, date, date) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION reports.get_sales_by_cashier(text, date, date) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION reports.get_sales_by_hour(text, date, date) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION reports.get_margin_alerts(text, date, date, numeric) TO stockiha_runtime;

UPDATE operations.schema_state SET migration_version = 20260927090000, updated_at = now() WHERE singleton;
RESET ROLE;
