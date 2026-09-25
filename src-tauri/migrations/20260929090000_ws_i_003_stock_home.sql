-- WS-I-003: stock reports, notifications and the Today home. Read-only. Re-runnable.
SET ROLE stockiha_owner;

-- ============================================================================
-- 1. Stock helpers
-- ============================================================================
CREATE OR REPLACE FUNCTION reports._stock_by_variant()
RETURNS TABLE (variant_id bigint, on_hand numeric, stock_value numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
    SELECT p.variant_id, sum(p.quantity_on_hand), sum(p.total_value)
    FROM inventory.positions p GROUP BY p.variant_id
$$;
REVOKE ALL ON FUNCTION reports._stock_by_variant() FROM PUBLIC;

CREATE OR REPLACE FUNCTION reports._low_stock_rows()
RETURNS TABLE (
    variant_id bigint, product_name text, variant_label text, sku text, base_unit_name text,
    pack_unit_name text, pack_factor numeric, on_hand numeric, minimum_stock numeric,
    suggested_qty numeric, suggested_packs numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
    WITH cand AS (
        SELECT vi.*, coalesce(sv.on_hand, 0) AS on_hand_qty,
               greatest(2 * vi.minimum_stock - coalesce(sv.on_hand, 0), vi.minimum_stock) AS raw_qty
        FROM reports._variant_info() vi
        LEFT JOIN reports._stock_by_variant() sv ON sv.variant_id = vi.variant_id
        WHERE vi.is_active AND vi.minimum_stock > 0 AND coalesce(sv.on_hand, 0) <= vi.minimum_stock
    )
    SELECT c.variant_id, c.product_name, c.variant_label, c.sku, c.base_unit_name,
           c.pack_unit_name, c.pack_factor, c.on_hand_qty, c.minimum_stock,
           CASE WHEN c.pack_factor IS NOT NULL AND c.pack_factor >= 1
                THEN ceil(c.raw_qty / c.pack_factor) * c.pack_factor
                ELSE ceil(c.raw_qty) END,
           CASE WHEN c.pack_factor IS NOT NULL AND c.pack_factor >= 1
                THEN ceil(c.raw_qty / c.pack_factor) END
    FROM cand c
$$;
REVOKE ALL ON FUNCTION reports._low_stock_rows() FROM PUBLIC;

-- ============================================================================
-- 2. Stock valuation
-- ============================================================================
CREATE OR REPLACE FUNCTION reports.get_stock_valuation(
    p_session_token text, p_category_id bigint, p_search text, p_limit integer, p_offset integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
    v_pattern text := reports._pattern(p_search);
    v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 500);
    v_offset integer := greatest(coalesce(p_offset, 0), 0);
    v_total bigint; v_rows jsonb; v_totals jsonb;
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'VIEW_REPORTS');

    WITH joined AS (
        SELECT vi.*, sv.on_hand, sv.stock_value,
               CASE WHEN sv.on_hand > 0 THEN sv.stock_value / sv.on_hand END AS wac,
               sv.on_hand * vi.sale_price AS retail_value
        FROM reports._stock_by_variant() sv
        JOIN reports._variant_info() vi ON vi.variant_id = sv.variant_id
        WHERE vi.is_active AND sv.on_hand <> 0
          AND (p_category_id IS NULL OR vi.category_id = p_category_id)
          AND (v_pattern IS NULL OR vi.product_name ILIKE v_pattern ESCAPE '\'
               OR vi.variant_label ILIKE v_pattern ESCAPE '\' OR vi.sku ILIKE v_pattern ESCAPE '\')
    ),
    page AS (SELECT * FROM joined ORDER BY stock_value DESC, variant_id LIMIT v_limit OFFSET v_offset)
    SELECT (SELECT count(*) FROM joined),
           coalesce((SELECT jsonb_agg(jsonb_build_object(
               'variant_id', p.variant_id, 'product_name', p.product_name, 'variant_label', p.variant_label,
               'sku', p.sku, 'category_name', p.category_name,
               'quantity_base', p.on_hand::text, 'base_unit_name', p.base_unit_name,
               'pack_unit_name', p.pack_unit_name, 'pack_factor', p.pack_factor::text,
               'wac', CASE WHEN p.wac IS NULL THEN NULL ELSE p.wac::numeric(14,2)::text END,
               'stock_value', p.stock_value::numeric(14,2)::text,
               'sale_price', p.sale_price::numeric(14,2)::text,
               'retail_value', p.retail_value::numeric(14,2)::text,
               'potential_margin', (p.retail_value - p.stock_value)::numeric(14,2)::text
           ) ORDER BY p.stock_value DESC, p.variant_id) FROM page p), '[]'::jsonb),
           (SELECT jsonb_build_object(
               'variant_count', count(*),
               'stock_value', coalesce(sum(stock_value), 0)::numeric(14,2)::text,
               'retail_value', coalesce(sum(retail_value), 0)::numeric(14,2)::text,
               'potential_margin', coalesce(sum(retail_value - stock_value), 0)::numeric(14,2)::text) FROM joined)
    INTO v_total, v_rows, v_totals;

    RETURN jsonb_build_object('total_count', v_total, 'rows', v_rows, 'totals', v_totals);
END;
$$;

-- ============================================================================
-- 3. Low stock (idea B)
-- ============================================================================
CREATE OR REPLACE FUNCTION reports.get_low_stock(
    p_session_token text, p_search text, p_limit integer, p_offset integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
    v_pattern text := reports._pattern(p_search);
    v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 500);
    v_offset integer := greatest(coalesce(p_offset, 0), 0);
    v_total bigint; v_rows jsonb;
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'VIEW_REPORTS');

    WITH last_purchase AS (
        SELECT DISTINCT ON (l.variant_id)
               l.variant_id, r.supplier_id, s.name AS supplier_name, d.document_date,
               CASE WHEN vu.conversion_factor IS NOT NULL AND vu.conversion_factor > 0
                    THEN l.unit_cost / vu.conversion_factor ELSE l.unit_cost END AS unit_cost_base
        FROM procurement.purchase_receipt_lines l
        JOIN procurement.purchase_receipts r ON r.document_id = l.document_id
        JOIN core.business_documents d ON d.id = l.document_id
        JOIN procurement.suppliers s ON s.id = r.supplier_id
        LEFT JOIN catalog.variant_units vu ON vu.variant_id = l.variant_id AND vu.unit_id = l.unit_id
        WHERE d.status = 'POSTED'
        ORDER BY l.variant_id, d.document_date DESC, l.document_id DESC, l.line_number DESC
    ),
    joined AS (
        SELECT ls.*, lp.supplier_id, lp.supplier_name, lp.document_date AS last_purchase_date, lp.unit_cost_base
        FROM reports._low_stock_rows() ls
        LEFT JOIN last_purchase lp ON lp.variant_id = ls.variant_id
        WHERE v_pattern IS NULL OR ls.product_name ILIKE v_pattern ESCAPE '\'
           OR ls.variant_label ILIKE v_pattern ESCAPE '\' OR ls.sku ILIKE v_pattern ESCAPE '\'
    ),
    page AS (
        SELECT * FROM joined
        ORDER BY (on_hand / minimum_stock) ASC, variant_id
        LIMIT v_limit OFFSET v_offset
    )
    SELECT (SELECT count(*) FROM joined),
           coalesce((SELECT jsonb_agg(jsonb_build_object(
               'variant_id', p.variant_id, 'product_name', p.product_name, 'variant_label', p.variant_label,
               'sku', p.sku, 'on_hand', p.on_hand::text, 'minimum_stock', p.minimum_stock::text,
               'suggested_qty_base', p.suggested_qty::text,
               'suggested_packs', CASE WHEN p.suggested_packs IS NULL THEN NULL ELSE p.suggested_packs::text END,
               'base_unit_name', p.base_unit_name, 'pack_unit_name', p.pack_unit_name,
               'pack_factor', p.pack_factor::text,
               'last_supplier_id', p.supplier_id, 'last_supplier_name', p.supplier_name,
               'last_unit_cost', CASE WHEN p.unit_cost_base IS NULL THEN NULL ELSE p.unit_cost_base::numeric(14,2)::text END,
               'last_purchase_date', p.last_purchase_date
           ) ORDER BY (p.on_hand / p.minimum_stock) ASC, p.variant_id) FROM page p), '[]'::jsonb)
    INTO v_total, v_rows;

    RETURN jsonb_build_object('total_count', v_total, 'rows', v_rows);
END;
$$;

-- ============================================================================
-- 4. Slow movers (idea C)
-- ============================================================================
CREATE OR REPLACE FUNCTION reports._last_sale_dates()
RETURNS TABLE (variant_id bigint, last_sale_date date)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
    SELECT l.variant_id, max(d.document_date)
    FROM (SELECT document_id, variant_id FROM sales.cash_sale_lines
          UNION ALL
          SELECT document_id, variant_id FROM sales.credit_sale_lines) l
    JOIN core.business_documents d ON d.id = l.document_id
    WHERE d.status = 'POSTED'
    GROUP BY l.variant_id
$$;
REVOKE ALL ON FUNCTION reports._last_sale_dates() FROM PUBLIC;

CREATE OR REPLACE FUNCTION reports.get_slow_movers(
    p_session_token text, p_days integer, p_search text, p_limit integer, p_offset integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
    v_today date := (now() AT TIME ZONE 'Africa/Algiers')::date;
    v_pattern text := reports._pattern(p_search);
    v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 500);
    v_offset integer := greatest(coalesce(p_offset, 0), 0);
    v_total bigint; v_rows jsonb; v_totals jsonb;
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'VIEW_REPORTS');
    IF p_days IS NULL OR p_days NOT IN (30, 60, 90, 180) THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: days must be 30, 60, 90 or 180' USING ERRCODE = '22023';
    END IF;

    WITH last_purchase AS (
        SELECT l.variant_id, max(d.document_date) AS last_date
        FROM procurement.purchase_receipt_lines l
        JOIN core.business_documents d ON d.id = l.document_id
        WHERE d.status = 'POSTED' GROUP BY l.variant_id
    ),
    joined AS (
        SELECT vi.*, sv.on_hand, sv.stock_value, ls.last_sale_date, lp.last_date AS last_purchase_date,
               CASE WHEN ls.last_sale_date IS NULL THEN NULL ELSE v_today - ls.last_sale_date END AS days_since
        FROM reports._stock_by_variant() sv
        JOIN reports._variant_info() vi ON vi.variant_id = sv.variant_id
        LEFT JOIN reports._last_sale_dates() ls ON ls.variant_id = sv.variant_id
        LEFT JOIN last_purchase lp ON lp.variant_id = sv.variant_id
        WHERE vi.is_active AND sv.on_hand > 0
          AND (ls.last_sale_date IS NULL OR ls.last_sale_date < v_today - p_days)
          AND (v_pattern IS NULL OR vi.product_name ILIKE v_pattern ESCAPE '\'
               OR vi.variant_label ILIKE v_pattern ESCAPE '\' OR vi.sku ILIKE v_pattern ESCAPE '\')
    ),
    page AS (SELECT * FROM joined ORDER BY stock_value DESC, variant_id LIMIT v_limit OFFSET v_offset)
    SELECT (SELECT count(*) FROM joined),
           coalesce((SELECT jsonb_agg(jsonb_build_object(
               'variant_id', p.variant_id, 'product_name', p.product_name, 'variant_label', p.variant_label,
               'sku', p.sku, 'on_hand', p.on_hand::text, 'base_unit_name', p.base_unit_name,
               'pack_unit_name', p.pack_unit_name, 'pack_factor', p.pack_factor::text,
               'stock_value', p.stock_value::numeric(14,2)::text,
               'last_sale_date', p.last_sale_date, 'days_since_last_sale', p.days_since,
               'last_purchase_date', p.last_purchase_date
           ) ORDER BY p.stock_value DESC, p.variant_id) FROM page p), '[]'::jsonb),
           (SELECT jsonb_build_object('variant_count', count(*),
                   'stock_value', coalesce(sum(stock_value), 0)::numeric(14,2)::text) FROM joined)
    INTO v_total, v_rows, v_totals;

    RETURN jsonb_build_object('days', p_days, 'total_count', v_total, 'rows', v_rows, 'totals', v_totals);
END;
$$;

-- ============================================================================
-- 5. Product history
-- ============================================================================
CREATE OR REPLACE FUNCTION reports.get_product_history(
    p_session_token text, p_variant_id bigint, p_from date, p_to date, p_limit integer, p_offset integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
    v_variant jsonb; v_opening numeric; v_period_sum numeric; v_total bigint; v_rows jsonb;
    v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 500);
    v_offset integer := greatest(coalesce(p_offset, 0), 0);
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'VIEW_REPORTS');
    PERFORM reports._check_period(p_from, p_to);

    SELECT jsonb_build_object('variant_id', vi.variant_id, 'product_name', vi.product_name,
               'variant_label', vi.variant_label, 'sku', vi.sku, 'base_unit_name', vi.base_unit_name,
               'pack_unit_name', vi.pack_unit_name, 'pack_factor', vi.pack_factor::text)
    INTO v_variant FROM reports._variant_info() vi WHERE vi.variant_id = p_variant_id;
    IF v_variant IS NULL THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: product not found' USING ERRCODE = '22023';
    END IF;

    WITH mv AS (
        SELECT m.id, (m.created_at AT TIME ZONE 'Africa/Algiers') AS occurred_local,
               m.movement_type, m.reference_type, m.reference_id, m.quantity_delta, m.inventory_value_delta
        FROM inventory.movements m WHERE m.variant_id = p_variant_id
    ),
    opening AS (SELECT coalesce(sum(quantity_delta), 0) AS v FROM mv WHERE occurred_local::date < p_from),
    period AS (
        SELECT mv.*, o.v + sum(mv.quantity_delta) OVER (ORDER BY mv.occurred_local, mv.id
                                                         ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running
        FROM mv CROSS JOIN opening o
        WHERE mv.occurred_local::date BETWEEN p_from AND p_to
    )
    SELECT (SELECT v FROM opening),
           (SELECT coalesce(sum(quantity_delta), 0) FROM period),
           (SELECT count(*) FROM period),
           coalesce((SELECT jsonb_agg(jsonb_build_object(
               'movement_id', x.id, 'occurred_at', x.occurred_local, 'movement_type', x.movement_type,
               'reference_type', x.reference_type,
               'document_id', d.id, 'document_number', d.document_number, 'document_type', d.document_type,
               'quantity_delta', x.quantity_delta::text, 'running_quantity', x.running::text,
               'value_delta', x.inventory_value_delta::numeric(14,2)::text
           ) ORDER BY x.occurred_local, x.id)
           FROM (SELECT * FROM period ORDER BY occurred_local, id LIMIT v_limit OFFSET v_offset) x
           LEFT JOIN core.business_documents d
                  ON d.id = x.reference_id
                 AND (x.reference_type, d.document_type) IN (
                       ('CASH_SALE_LINE', 'CASH_SALE'), ('CREDIT_SALE_LINE', 'CREDIT_SALE'),
                       ('SALE_VOID_LINE', 'SALE_VOID'), ('PURCHASE_RECEIPT', 'PURCHASE_RECEIPT'),
                       ('PURCHASE_RETURN', 'PURCHASE_RETURN'), ('SUPPLIER_RETURN', 'SUPPLIER_RETURN'),
                       ('STOCK_ADJUSTMENT', 'STOCK_ADJUSTMENT'), ('STOCK_RECEIPT', 'STOCK_RECEIPT'))), '[]'::jsonb)
    INTO v_opening, v_period_sum, v_total, v_rows;

    RETURN jsonb_build_object(
        'variant', v_variant, 'from', p_from, 'to', p_to,
        'opening_quantity', v_opening::text,
        'closing_quantity', (v_opening + v_period_sum)::text,
        'total_count', v_total, 'rows', v_rows);
END;
$$;

-- ============================================================================
-- 6. Notifications
-- ============================================================================
CREATE OR REPLACE FUNCTION reports.get_notifications(p_session_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
    v_today date := (now() AT TIME ZONE 'Africa/Algiers')::date;
    v_out jsonb := '[]'::jsonb;
    v_count bigint; v_amount numeric; v_max_days integer;
    -- I3-02 pitfall fix (plan-authorized): a `record` variable left partly
    -- unassigned by `SELECT ... INTO` when no row matches raises "record ...
    -- is not assigned yet" as soon as any field is read. Scalars degrade to
    -- NULL instead, so `v_session_id IS NOT NULL` is a safe existence check.
    v_session_id bigint; v_session_hours integer; v_last_backup timestamptz;
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'VIEW_REPORTS');

    -- OUT_OF_STOCK
    SELECT count(*) INTO v_count FROM reports._low_stock_rows() WHERE on_hand <= 0;
    IF v_count > 0 THEN
        v_out := v_out || jsonb_build_object('id', 'OUT_OF_STOCK', 'kind', 'OUT_OF_STOCK',
                    'severity', 'CRITICAL', 'count', v_count);
    END IF;

    -- LOW_STOCK (above zero but at or below minimum)
    SELECT count(*) INTO v_count FROM reports._low_stock_rows() WHERE on_hand > 0;
    IF v_count > 0 THEN
        v_out := v_out || jsonb_build_object('id', 'LOW_STOCK', 'kind', 'LOW_STOCK',
                    'severity', 'WARNING', 'count', v_count);
    END IF;

    -- OVERDUE_DEBTS
    SELECT count(DISTINCT x.customer_id), coalesce(sum(x.open_amt), 0), coalesce(max(v_today - x.due_date), 0)
    INTO v_count, v_amount, v_max_days
    FROM (SELECT l.customer_id, l.due_date,
                 (l.amount_delta - receivables.net_invoice_allocated_amount(l.id)) AS open_amt
          FROM receivables.customer_ledger_entries l
          WHERE l.entry_type = 'CREDIT_INVOICE' AND l.due_date IS NOT NULL AND l.due_date < v_today) x
    WHERE x.open_amt > 0;
    IF v_count > 0 THEN
        v_out := v_out || jsonb_build_object('id', 'OVERDUE_DEBTS', 'kind', 'OVERDUE_DEBTS',
                    'severity', CASE WHEN v_max_days > 90 THEN 'CRITICAL' ELSE 'WARNING' END,
                    'count', v_count, 'amount', v_amount::numeric(14,2)::text, 'max_days', v_max_days);
    END IF;

    -- CREDIT_LIMIT_EXCEEDED
    SELECT count(*) INTO v_count
    FROM receivables.customer_credit_state cs
    JOIN receivables.customers c ON c.id = cs.customer_id
    WHERE c.credit_limit > 0 AND cs.exposure_amount > c.credit_limit;
    IF v_count > 0 THEN
        v_out := v_out || jsonb_build_object('id', 'CREDIT_LIMIT_EXCEEDED', 'kind', 'CREDIT_LIMIT_EXCEEDED',
                    'severity', 'WARNING', 'count', v_count);
    END IF;

    -- MARGIN_ALERTS_7D (variants with at least one line sold below cost in the last 7 days)
    SELECT count(DISTINCT sl.variant_id) INTO v_count
    FROM reports._sale_lines(v_today - 6, v_today) sl
    WHERE sl.net_revenue < sl.line_cost;
    IF v_count > 0 THEN
        v_out := v_out || jsonb_build_object('id', 'MARGIN_ALERTS_7D', 'kind', 'MARGIN_ALERTS_7D',
                    'severity', 'WARNING', 'count', v_count);
    END IF;

    -- SLOW_MOVERS_90D
    SELECT count(*), coalesce(sum(sv.stock_value), 0) INTO v_count, v_amount
    FROM reports._stock_by_variant() sv
    JOIN reports._variant_info() vi ON vi.variant_id = sv.variant_id
    LEFT JOIN reports._last_sale_dates() ls ON ls.variant_id = sv.variant_id
    WHERE vi.is_active AND sv.on_hand > 0
      AND (ls.last_sale_date IS NULL OR ls.last_sale_date < v_today - 90);
    IF v_count > 0 AND v_amount > 0 THEN
        v_out := v_out || jsonb_build_object('id', 'SLOW_MOVERS_90D', 'kind', 'SLOW_MOVERS_90D',
                    'severity', 'INFO', 'count', v_count, 'amount', v_amount::numeric(14,2)::text);
    END IF;

    -- CASH_SESSION_LONG_OPEN
    SELECT s.id, floor(extract(epoch FROM (now() - s.opened_at)) / 3600)::int AS hours
    INTO v_session_id, v_session_hours
    FROM sales.cash_sessions s
    WHERE s.status = 'OPEN' AND s.opened_at < now() - interval '16 hours'
    ORDER BY s.opened_at ASC LIMIT 1;
    IF v_session_id IS NOT NULL THEN
        v_out := v_out || jsonb_build_object('id', 'CASH_SESSION_LONG_OPEN', 'kind', 'CASH_SESSION_LONG_OPEN',
                    'severity', 'WARNING', 'session_id', v_session_id, 'hours', v_session_hours);
    END IF;

    -- BACKUP_OVERDUE
    SELECT max(completed_at) INTO v_last_backup
    FROM operations.recovery_attempts
    WHERE status = 'SUCCEEDED' AND operation_code IN ('CREATE_BACKUP', 'AUTO_BACKUP');
    IF v_last_backup IS NULL OR v_last_backup < now() - interval '7 days' THEN
        v_out := v_out || jsonb_build_object('id', 'BACKUP_OVERDUE', 'kind', 'BACKUP_OVERDUE',
                    'severity', 'WARNING', 'last_success_at', v_last_backup);
    END IF;

    RETURN jsonb_build_object('generated_at', now(), 'items', v_out);
END;
$$;

-- ============================================================================
-- 7. Today (idea A)
-- ============================================================================
CREATE OR REPLACE FUNCTION reports.get_today(p_session_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
    v_user_id bigint; v_ws text;
    v_today date := (now() AT TIME ZONE 'Africa/Algiers')::date;
    v_last_week date := (now() AT TIME ZONE 'Africa/Algiers')::date - 7;
    v_month_start date := date_trunc('month', (now() AT TIME ZONE 'Africa/Algiers')::date)::date;
    v_hourly jsonb; v_drawer jsonb;
    -- I3-02 pitfall fix (plan-authorized): see get_notifications above.
    v_s_id bigint; v_s_status text; v_s_float numeric; v_expected numeric;
    v_receivables numeric; v_overdue numeric; v_payables numeric;
    v_low bigint; v_out bigint; v_mtd jsonb;
BEGIN
    SELECT user_id, workstation_id INTO v_user_id, v_ws
    FROM iam.resolve_session_with_permission(p_session_token, 'VIEW_REPORTS');

    SELECT coalesce(jsonb_agg(jsonb_build_object('hour', h, 'net_sales', coalesce(a.net, 0)::numeric(14,2)::text,
                                                 'sale_count', coalesce(a.cnt, 0)) ORDER BY h), '[]'::jsonb)
    INTO v_hourly
    FROM generate_series(0, 23) h
    LEFT JOIN (SELECT extract(hour FROM sl.posted_local)::int AS hr, sum(sl.net_revenue) AS net,
                      count(DISTINCT sl.document_id) AS cnt
               FROM reports._sale_lines(v_today, v_today) sl GROUP BY 1) a ON a.hr = h;

    SELECT s.id, s.status, s.opening_float INTO v_s_id, v_s_status, v_s_float
    FROM sales.cash_sessions s
    WHERE s.status = 'OPEN' AND s.workstation_id = v_ws
    ORDER BY s.opened_at DESC LIMIT 1;
    IF v_s_id IS NOT NULL THEN
        SELECT v_s_float + coalesce(sum(CASE WHEN m.movement_type = 'CASH_OUT' THEN -m.amount ELSE m.amount END), 0)
        INTO v_expected FROM cash.movements m WHERE m.cash_session_id = v_s_id;
        v_drawer := jsonb_build_object('session_id', v_s_id, 'status', v_s_status,
                        'opening_float', v_s_float::numeric(14,2)::text,
                        'expected_now', v_expected::numeric(14,2)::text);
    END IF;

    SELECT coalesce(sum(exposure_amount), 0) INTO v_receivables FROM receivables.customer_credit_state;
    SELECT coalesce(sum(x.open_amt), 0) INTO v_overdue
    FROM (SELECT (l.amount_delta - receivables.net_invoice_allocated_amount(l.id)) AS open_amt
          FROM receivables.customer_ledger_entries l
          WHERE l.entry_type = 'CREDIT_INVOICE' AND l.due_date IS NOT NULL AND l.due_date < v_today) x
    WHERE x.open_amt > 0;
    SELECT coalesce(sum(balance), 0) INTO v_payables FROM reports._supplier_totals();
    SELECT count(*) FILTER (WHERE on_hand > 0), count(*) FILTER (WHERE on_hand <= 0)
    INTO v_low, v_out FROM reports._low_stock_rows();

    v_mtd := reports.get_sales_summary(p_session_token, v_month_start, v_today);

    RETURN jsonb_build_object(
        'today', jsonb_build_object('date', v_today,
                    'summary', reports.get_sales_summary(p_session_token, v_today, v_today)),
        'same_day_last_week', jsonb_build_object('date', v_last_week,
                    'summary', reports.get_sales_summary(p_session_token, v_last_week, v_last_week)),
        'hourly_today', v_hourly,
        'top_products_today', coalesce(reports.get_sales_by_product(
                    p_session_token, v_today, v_today, 'REVENUE', NULL, 5, 0) -> 'rows', '[]'::jsonb),
        'drawer', v_drawer,
        'receivables_total', v_receivables::numeric(14,2)::text,
        'overdue_total', v_overdue::numeric(14,2)::text,
        'payables_total', v_payables::numeric(14,2)::text,
        'low_stock_count', v_low,
        'out_of_stock_count', v_out,
        'month_to_date', jsonb_build_object('from', v_month_start, 'to', v_today,
                    'net_sales', v_mtd ->> 'net_sales', 'gross_profit', v_mtd ->> 'gross_profit')
    );
END;
$$;

-- ============================================================================
-- 8. Grants
-- ============================================================================
REVOKE ALL ON FUNCTION reports.get_stock_valuation(text, bigint, text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION reports.get_low_stock(text, text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION reports.get_slow_movers(text, integer, text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION reports.get_product_history(text, bigint, date, date, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION reports.get_notifications(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION reports.get_today(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reports.get_stock_valuation(text, bigint, text, integer, integer) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION reports.get_low_stock(text, text, integer, integer) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION reports.get_slow_movers(text, integer, text, integer, integer) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION reports.get_product_history(text, bigint, date, date, integer, integer) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION reports.get_notifications(text) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION reports.get_today(text) TO stockiha_runtime;

UPDATE operations.schema_state SET migration_version = 20260929090000, updated_at = now() WHERE singleton;
RESET ROLE;
