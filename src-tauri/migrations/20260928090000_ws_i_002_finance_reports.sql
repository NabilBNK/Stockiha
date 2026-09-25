-- WS-I-002: finance, money owed and accountant reports. Read-only. Re-runnable.
SET ROLE stockiha_owner;

-- ============================================================================
-- 1. Profit & loss (management view)
-- ============================================================================
CREATE OR REPLACE FUNCTION reports.get_profit_and_loss(p_session_token text, p_from date, p_to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
    v_net numeric; v_cost numeric;
    v_exp numeric; v_other numeric;
    v_short numeric; v_over numeric;
    v_exp_lines jsonb; v_other_lines jsonb;
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'VIEW_REPORTS');
    PERFORM reports._check_period(p_from, p_to);

    SELECT coalesce(sum(net_revenue), 0), coalesce(sum(line_cost), 0)
    INTO v_net, v_cost FROM reports._sale_lines(p_from, p_to);

    SELECT coalesce(sum(m.amount) FILTER (WHERE m.reason_code = 'EXPENSE'), 0),
           coalesce(sum(m.amount) FILTER (WHERE m.reason_code = 'OTHER'), 0)
    INTO v_exp, v_other
    FROM cash.movements m
    WHERE m.movement_type = 'CASH_OUT'
      AND (m.created_at AT TIME ZONE 'Africa/Algiers')::date BETWEEN p_from AND p_to;

    SELECT coalesce(jsonb_agg(jsonb_build_object(
               'date', (x.created_at AT TIME ZONE 'Africa/Algiers')::date,
               'note', x.note, 'amount', x.amount::numeric(14,2)::text) ORDER BY x.created_at DESC), '[]'::jsonb)
    INTO v_exp_lines
    FROM (SELECT m.created_at, m.note, m.amount FROM cash.movements m
          WHERE m.movement_type = 'CASH_OUT' AND m.reason_code = 'EXPENSE'
            AND (m.created_at AT TIME ZONE 'Africa/Algiers')::date BETWEEN p_from AND p_to
          ORDER BY m.created_at DESC LIMIT 200) x;

    SELECT coalesce(jsonb_agg(jsonb_build_object(
               'date', (x.created_at AT TIME ZONE 'Africa/Algiers')::date,
               'note', x.note, 'amount', x.amount::numeric(14,2)::text) ORDER BY x.created_at DESC), '[]'::jsonb)
    INTO v_other_lines
    FROM (SELECT m.created_at, m.note, m.amount FROM cash.movements m
          WHERE m.movement_type = 'CASH_OUT' AND m.reason_code = 'OTHER'
            AND (m.created_at AT TIME ZONE 'Africa/Algiers')::date BETWEEN p_from AND p_to
          ORDER BY m.created_at DESC LIMIT 200) x;

    SELECT coalesce(-sum(s.variance_amount) FILTER (WHERE s.variance_amount < 0), 0),
           coalesce(sum(s.variance_amount) FILTER (WHERE s.variance_amount > 0), 0)
    INTO v_short, v_over
    FROM sales.cash_sessions s
    WHERE s.status = 'CLOSED' AND s.closed_at IS NOT NULL
      AND (s.closed_at AT TIME ZONE 'Africa/Algiers')::date BETWEEN p_from AND p_to;

    RETURN jsonb_build_object(
        'from', p_from, 'to', p_to,
        'net_sales', v_net::numeric(14,2)::text,
        'cost_of_sales', v_cost::numeric(14,2)::text,
        'gross_profit', (v_net - v_cost)::numeric(14,2)::text,
        'margin_pct', CASE WHEN v_net = 0 THEN NULL ELSE round((v_net - v_cost) / v_net * 100, 1)::text END,
        'expenses', v_exp::numeric(14,2)::text,
        'expense_lines', v_exp_lines,
        'cash_shortages', v_short::numeric(14,2)::text,
        'cash_overages', v_over::numeric(14,2)::text,
        'other_cash_out', v_other::numeric(14,2)::text,
        'other_cash_out_lines', v_other_lines,
        'net_result', (v_net - v_cost - v_exp - v_short + v_over)::numeric(14,2)::text
    );
END;
$$;

-- ============================================================================
-- 2. Cash flow (drawer)
-- ============================================================================
CREATE OR REPLACE FUNCTION reports.get_cash_flow(p_session_token text, p_from date, p_to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE r record; v_in_reason jsonb; v_out_reason jsonb; v_supplier numeric;
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'VIEW_REPORTS');
    PERFORM reports._check_period(p_from, p_to);

    SELECT coalesce(sum(amount) FILTER (WHERE movement_type = 'SALE'), 0) AS cash_sales,
           coalesce(sum(amount) FILTER (WHERE movement_type = 'CUSTOMER_PAYMENT'), 0) AS customer_payments,
           coalesce(sum(amount) FILTER (WHERE movement_type = 'CASH_IN'), 0) AS cash_in,
           coalesce(-sum(amount) FILTER (WHERE movement_type = 'CUSTOMER_REFUND'), 0) AS refunds,
           coalesce(-sum(amount) FILTER (WHERE movement_type = 'SALE_VOID'), 0) AS cancellations,
           coalesce(sum(amount) FILTER (WHERE movement_type = 'CASH_OUT'), 0) AS cash_out
    INTO r
    FROM cash.movements
    WHERE (created_at AT TIME ZONE 'Africa/Algiers')::date BETWEEN p_from AND p_to;

    SELECT coalesce(jsonb_object_agg(reason_code, total), '{}'::jsonb) INTO v_in_reason
    FROM (SELECT coalesce(reason_code, 'NONE') AS reason_code, sum(amount)::numeric(14,2)::text AS total
          FROM cash.movements
          WHERE movement_type = 'CASH_IN'
            AND (created_at AT TIME ZONE 'Africa/Algiers')::date BETWEEN p_from AND p_to
          GROUP BY 1) x;

    SELECT coalesce(jsonb_object_agg(reason_code, total), '{}'::jsonb) INTO v_out_reason
    FROM (SELECT coalesce(reason_code, 'NONE') AS reason_code, sum(amount)::numeric(14,2)::text AS total
          FROM cash.movements
          WHERE movement_type = 'CASH_OUT'
            AND (created_at AT TIME ZONE 'Africa/Algiers')::date BETWEEN p_from AND p_to
          GROUP BY 1) x;

    SELECT coalesce(sum(p.amount), 0) INTO v_supplier
    FROM procurement.purchase_receipt_payments p
    JOIN core.business_documents d ON d.id = p.document_id
    WHERE d.document_date BETWEEN p_from AND p_to;

    RETURN jsonb_build_object(
        'from', p_from, 'to', p_to,
        'in', jsonb_build_object(
            'cash_sales', r.cash_sales::numeric(14,2)::text,
            'customer_payments_cash', r.customer_payments::numeric(14,2)::text,
            'cash_in', r.cash_in::numeric(14,2)::text,
            'cash_in_by_reason', v_in_reason),
        'out', jsonb_build_object(
            'refunds', r.refunds::numeric(14,2)::text,
            'cancellations', r.cancellations::numeric(14,2)::text,
            'cash_out', r.cash_out::numeric(14,2)::text,
            'cash_out_by_reason', v_out_reason),
        'supplier_payments_all_methods', v_supplier::numeric(14,2)::text,
        'net_drawer_flow', (r.cash_sales + r.customer_payments + r.cash_in
                            - r.refunds - r.cancellations - r.cash_out)::numeric(14,2)::text
    );
END;
$$;

-- ============================================================================
-- 3. Payables helper (identical rule to procurement.list_supplier_balances)
-- ============================================================================
CREATE OR REPLACE FUNCTION reports._supplier_totals()
RETURNS TABLE (supplier_id bigint, purchased numeric, returned numeric, paid numeric, balance numeric,
               last_purchase_date date, last_payment_date date)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
    WITH purchased AS (
        SELECT r.supplier_id, sum(r.total_amount) AS t, max(d.document_date) AS last_date
        FROM procurement.purchase_receipts r
        JOIN core.business_documents d ON d.id = r.document_id
        WHERE d.status = 'POSTED' GROUP BY r.supplier_id
    ),
    returned AS (
        SELECT pr.supplier_id, sum(pr.refund_amount) AS t
        FROM procurement.purchase_returns pr GROUP BY pr.supplier_id
    ),
    paid AS (
        SELECT p.supplier_id, sum(p.amount) AS t, max(d.document_date) AS last_date
        FROM procurement.purchase_receipt_payments p
        LEFT JOIN core.business_documents d ON d.id = p.document_id
        GROUP BY p.supplier_id
    )
    SELECT s.id,
           coalesce(pu.t, 0), coalesce(re.t, 0), coalesce(pa.t, 0),
           (coalesce(pu.t, 0) - coalesce(re.t, 0) - coalesce(pa.t, 0)),
           pu.last_date, pa.last_date
    FROM procurement.suppliers s
    LEFT JOIN purchased pu ON pu.supplier_id = s.id
    LEFT JOIN returned re ON re.supplier_id = s.id
    LEFT JOIN paid pa ON pa.supplier_id = s.id
$$;
REVOKE ALL ON FUNCTION reports._supplier_totals() FROM PUBLIC;

-- ============================================================================
-- 4. Monthly summary (idea G)
-- ============================================================================
CREATE OR REPLACE FUNCTION reports.get_monthly_summary(p_session_token text, p_year integer, p_month integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
    v_from date; v_to date; v_prev_from date; v_prev_to date;
    v_pnl jsonb; v_prev jsonb; v_purchases numeric; v_receivables numeric;
    v_payables numeric; v_stock numeric; v_top jsonb;
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'VIEW_REPORTS');
    IF p_year IS NULL OR p_year < 2000 OR p_year > 2100 OR p_month IS NULL OR p_month < 1 OR p_month > 12 THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: invalid month' USING ERRCODE = '22023';
    END IF;
    v_from := make_date(p_year, p_month, 1);
    v_to := (v_from + interval '1 month' - interval '1 day')::date;
    v_prev_from := (v_from - interval '1 month')::date;
    v_prev_to := v_from - 1;

    v_pnl := reports.get_profit_and_loss(p_session_token, v_from, v_to);
    v_prev := reports.get_profit_and_loss(p_session_token, v_prev_from, v_prev_to);

    SELECT coalesce(sum(r.total_amount), 0) INTO v_purchases
    FROM procurement.purchase_receipts r
    JOIN core.business_documents d ON d.id = r.document_id
    WHERE d.status = 'POSTED' AND d.document_date BETWEEN v_from AND v_to;

    SELECT coalesce(sum(exposure_amount), 0) INTO v_receivables FROM receivables.customer_credit_state;
    SELECT coalesce(sum(balance), 0) INTO v_payables FROM reports._supplier_totals();
    SELECT coalesce(sum(total_value), 0) INTO v_stock FROM inventory.positions;

    v_top := reports.get_sales_by_product(p_session_token, v_from, v_to, 'PROFIT', NULL, 5, 0) -> 'rows';

    RETURN jsonb_build_object(
        'period', jsonb_build_object('from', v_from, 'to', v_to),
        'pnl', v_pnl,
        'purchases_total', v_purchases::numeric(14,2)::text,
        'receivables_now', v_receivables::numeric(14,2)::text,
        'payables_now', v_payables::numeric(14,2)::text,
        'stock_value_now', v_stock::numeric(14,2)::text,
        'top_products', coalesce(v_top, '[]'::jsonb),
        'previous_month', jsonb_build_object(
            'from', v_prev_from, 'to', v_prev_to,
            'net_sales', v_prev ->> 'net_sales',
            'gross_profit', v_prev ->> 'gross_profit',
            'net_result', v_prev ->> 'net_result')
    );
END;
$$;

-- ============================================================================
-- 5. Receivables aging (idea F) — ages are measured from today (Algeria)
-- ============================================================================
CREATE OR REPLACE FUNCTION reports.get_receivables_aging(
    p_session_token text, p_search text, p_limit integer, p_offset integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
    v_today date := (now() AT TIME ZONE 'Africa/Algiers')::date;
    v_pattern text := reports._pattern(p_search);
    v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 500);
    v_offset integer := greatest(coalesce(p_offset, 0), 0);
    v_total bigint; v_rows jsonb; v_totals jsonb;
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'VIEW_REPORTS');

    WITH open_inv AS (
        SELECT l.customer_id, l.due_date,
               (l.amount_delta - receivables.net_invoice_allocated_amount(l.id)) AS open_amt
        FROM receivables.customer_ledger_entries l
        WHERE l.entry_type = 'CREDIT_INVOICE'
    ),
    per_cust AS (
        SELECT customer_id,
               sum(open_amt) AS total_open,
               coalesce(sum(open_amt) FILTER (WHERE due_date IS NULL OR due_date >= v_today), 0) AS not_due,
               coalesce(sum(open_amt) FILTER (WHERE v_today - due_date BETWEEN 1 AND 30), 0) AS d1_30,
               coalesce(sum(open_amt) FILTER (WHERE v_today - due_date BETWEEN 31 AND 60), 0) AS d31_60,
               coalesce(sum(open_amt) FILTER (WHERE v_today - due_date BETWEEN 61 AND 90), 0) AS d61_90,
               coalesce(sum(open_amt) FILTER (WHERE v_today - due_date > 90), 0) AS d90_plus,
               min(due_date) FILTER (WHERE due_date < v_today) AS oldest_due
        FROM open_inv WHERE open_amt > 0
        GROUP BY customer_id
    ),
    last_pay AS (
        SELECT DISTINCT ON (l.customer_id) l.customer_id,
               (l.created_at AT TIME ZONE 'Africa/Algiers')::date AS paid_on,
               abs(l.amount_delta) AS amount
        FROM receivables.customer_ledger_entries l
        WHERE l.entry_type = 'PAYMENT'
        ORDER BY l.customer_id, l.created_at DESC, l.id DESC
    ),
    joined AS (
        SELECT pc.*, c.code, c.name, c.phone, c.credit_limit,
               CASE WHEN pc.oldest_due IS NULL THEN 0 ELSE v_today - pc.oldest_due END AS days_overdue,
               lp.paid_on, lp.amount AS last_amount
        FROM per_cust pc
        JOIN receivables.customers c ON c.id = pc.customer_id
        LEFT JOIN last_pay lp ON lp.customer_id = pc.customer_id
        WHERE v_pattern IS NULL
           OR c.name ILIKE v_pattern ESCAPE '\'
           OR c.code ILIKE v_pattern ESCAPE '\'
           OR coalesce(c.phone, '') ILIKE v_pattern ESCAPE '\'
    ),
    page AS (
        SELECT * FROM joined ORDER BY days_overdue DESC, total_open DESC, customer_id
        LIMIT v_limit OFFSET v_offset
    )
    SELECT (SELECT count(*) FROM joined),
           coalesce((SELECT jsonb_agg(jsonb_build_object(
               'customer_id', p.customer_id, 'code', p.code, 'name', p.name, 'phone', p.phone,
               'credit_limit', p.credit_limit::numeric(14,2)::text,
               'total_open', p.total_open::numeric(14,2)::text,
               'not_due', p.not_due::numeric(14,2)::text,
               'd1_30', p.d1_30::numeric(14,2)::text, 'd31_60', p.d31_60::numeric(14,2)::text,
               'd61_90', p.d61_90::numeric(14,2)::text, 'd90_plus', p.d90_plus::numeric(14,2)::text,
               'overdue_total', (p.total_open - p.not_due)::numeric(14,2)::text,
               'oldest_due_date', p.oldest_due, 'days_overdue', p.days_overdue,
               'last_payment_date', p.paid_on,
               'last_payment_amount', CASE WHEN p.last_amount IS NULL THEN NULL ELSE p.last_amount::numeric(14,2)::text END
           ) ORDER BY p.days_overdue DESC, p.total_open DESC, p.customer_id) FROM page p), '[]'::jsonb),
           (SELECT jsonb_build_object(
               'total_open', coalesce(sum(total_open), 0)::numeric(14,2)::text,
               'not_due', coalesce(sum(not_due), 0)::numeric(14,2)::text,
               'd1_30', coalesce(sum(d1_30), 0)::numeric(14,2)::text,
               'd31_60', coalesce(sum(d31_60), 0)::numeric(14,2)::text,
               'd61_90', coalesce(sum(d61_90), 0)::numeric(14,2)::text,
               'd90_plus', coalesce(sum(d90_plus), 0)::numeric(14,2)::text,
               'overdue_total', coalesce(sum(total_open - not_due), 0)::numeric(14,2)::text) FROM joined)
    INTO v_total, v_rows, v_totals;

    RETURN jsonb_build_object('as_of', v_today, 'total_count', v_total, 'rows', v_rows, 'totals', v_totals);
END;
$$;

CREATE OR REPLACE FUNCTION reports.get_customer_statement(
    p_session_token text, p_customer_id bigint, p_from date, p_to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
    v_customer jsonb; v_opening numeric; v_rows jsonb; v_period_sum numeric; v_count bigint;
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'VIEW_REPORTS');
    PERFORM reports._check_period(p_from, p_to);

    SELECT jsonb_build_object('customer_id', c.id, 'code', c.code, 'name', c.name, 'phone', c.phone,
                              'address', c.address, 'credit_limit', c.credit_limit::numeric(14,2)::text)
    INTO v_customer FROM receivables.customers c WHERE c.id = p_customer_id;
    IF v_customer IS NULL THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: customer not found' USING ERRCODE = '22023';
    END IF;

    WITH entries AS (
        SELECT l.id,
               coalesce(d.document_date, (l.created_at AT TIME ZONE 'Africa/Algiers')::date) AS entry_date,
               l.entry_type, d.document_number, l.amount_delta
        FROM receivables.customer_ledger_entries l
        LEFT JOIN core.business_documents d ON d.id = l.document_id
        WHERE l.customer_id = p_customer_id
    ),
    opening AS (SELECT coalesce(sum(amount_delta), 0) AS v FROM entries WHERE entry_date < p_from),
    period AS (
        SELECT e.*, o.v + sum(e.amount_delta) OVER (ORDER BY e.entry_date, e.id
                                                     ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS balance
        FROM entries e CROSS JOIN opening o
        WHERE e.entry_date BETWEEN p_from AND p_to
    )
    SELECT (SELECT v FROM opening),
           (SELECT coalesce(sum(amount_delta), 0) FROM period),
           (SELECT count(*) FROM period),
           coalesce((SELECT jsonb_agg(jsonb_build_object(
               'entry_id', x.id, 'date', x.entry_date, 'entry_type', x.entry_type,
               'document_number', x.document_number,
               'debit', greatest(x.amount_delta, 0)::numeric(14,2)::text,
               'credit', greatest(-x.amount_delta, 0)::numeric(14,2)::text,
               'balance', x.balance::numeric(14,2)::text
           ) ORDER BY x.entry_date, x.id)
           FROM (SELECT * FROM period ORDER BY entry_date, id LIMIT 5000) x), '[]'::jsonb)
    INTO v_opening, v_period_sum, v_count, v_rows;

    RETURN jsonb_build_object(
        'customer', v_customer, 'from', p_from, 'to', p_to,
        'opening_balance', v_opening::numeric(14,2)::text,
        'entries', v_rows,
        'truncated', v_count > 5000,
        'total_debit', (SELECT coalesce(sum((e ->> 'debit')::numeric), 0) FROM jsonb_array_elements(v_rows) e)::numeric(14,2)::text,
        'total_credit', (SELECT coalesce(sum((e ->> 'credit')::numeric), 0) FROM jsonb_array_elements(v_rows) e)::numeric(14,2)::text,
        'closing_balance', (v_opening + v_period_sum)::numeric(14,2)::text
    );
END;
$$;

-- ============================================================================
-- 7. Supplier balances
-- ============================================================================
CREATE OR REPLACE FUNCTION reports.get_supplier_balances(
    p_session_token text, p_search text, p_limit integer, p_offset integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
    v_pattern text := reports._pattern(p_search);
    v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 500);
    v_offset integer := greatest(coalesce(p_offset, 0), 0);
    v_total bigint; v_rows jsonb; v_totals jsonb;
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'VIEW_REPORTS');

    WITH joined AS (
        SELECT s.id, s.code, s.name, s.phone, t.purchased, t.returned, t.paid, t.balance,
               t.last_purchase_date, t.last_payment_date
        FROM procurement.suppliers s
        JOIN reports._supplier_totals() t ON t.supplier_id = s.id
        WHERE (t.purchased <> 0 OR t.returned <> 0 OR t.paid <> 0)
          AND (v_pattern IS NULL OR s.name ILIKE v_pattern ESCAPE '\'
               OR s.code ILIKE v_pattern ESCAPE '\' OR coalesce(s.phone, '') ILIKE v_pattern ESCAPE '\')
    ),
    page AS (SELECT * FROM joined ORDER BY balance DESC, name, id LIMIT v_limit OFFSET v_offset)
    SELECT (SELECT count(*) FROM joined),
           coalesce((SELECT jsonb_agg(jsonb_build_object(
               'supplier_id', p.id, 'code', p.code, 'name', p.name, 'phone', p.phone,
               'total_purchased', p.purchased::numeric(14,2)::text,
               'total_returned', p.returned::numeric(14,2)::text,
               'total_paid', p.paid::numeric(14,2)::text,
               'balance_due', p.balance::numeric(14,2)::text,
               'last_purchase_date', p.last_purchase_date,
               'last_payment_date', p.last_payment_date
           ) ORDER BY p.balance DESC, p.name, p.id) FROM page p), '[]'::jsonb),
           (SELECT jsonb_build_object('balance_due', coalesce(sum(balance), 0)::numeric(14,2)::text) FROM joined)
    INTO v_total, v_rows, v_totals;

    RETURN jsonb_build_object('total_count', v_total, 'rows', v_rows, 'totals', v_totals);
END;
$$;

-- ============================================================================
-- 8. Supplier statement
-- ============================================================================
CREATE OR REPLACE FUNCTION reports.get_supplier_statement(
    p_session_token text, p_supplier_id bigint, p_from date, p_to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE v_supplier jsonb; v_opening numeric; v_period_sum numeric; v_rows jsonb; v_count bigint;
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'VIEW_REPORTS');
    PERFORM reports._check_period(p_from, p_to);

    SELECT jsonb_build_object('supplier_id', s.id, 'code', s.code, 'name', s.name, 'phone', s.phone)
    INTO v_supplier FROM procurement.suppliers s WHERE s.id = p_supplier_id;
    IF v_supplier IS NULL THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: supplier not found' USING ERRCODE = '22023';
    END IF;

    WITH entries AS (
        SELECT d.id, d.document_date AS entry_date, 'PURCHASE_RECEIPT'::text AS entry_type,
               d.document_number, r.total_amount AS amount_delta
        FROM procurement.purchase_receipts r
        JOIN core.business_documents d ON d.id = r.document_id
        WHERE r.supplier_id = p_supplier_id AND d.status = 'POSTED'
        UNION ALL
        SELECT d.id, d.document_date, 'PURCHASE_RETURN', d.document_number, -pr.refund_amount
        FROM procurement.purchase_returns pr
        JOIN core.business_documents d ON d.id = pr.document_id
        WHERE pr.supplier_id = p_supplier_id
        UNION ALL
        SELECT d.id, d.document_date, 'SUPPLIER_PAYMENT', d.document_number, -p.amount
        FROM procurement.purchase_receipt_payments p
        JOIN core.business_documents d ON d.id = p.document_id
        WHERE p.supplier_id = p_supplier_id
    ),
    opening AS (SELECT coalesce(sum(amount_delta), 0) AS v FROM entries WHERE entry_date < p_from),
    period AS (
        SELECT e.*, o.v + sum(e.amount_delta) OVER (ORDER BY e.entry_date, e.id
                                                     ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS balance
        FROM entries e CROSS JOIN opening o
        WHERE e.entry_date BETWEEN p_from AND p_to
    )
    SELECT (SELECT v FROM opening),
           (SELECT coalesce(sum(amount_delta), 0) FROM period),
           (SELECT count(*) FROM period),
           coalesce((SELECT jsonb_agg(jsonb_build_object(
               'document_id', x.id, 'date', x.entry_date, 'entry_type', x.entry_type,
               'document_number', x.document_number,
               'increase', greatest(x.amount_delta, 0)::numeric(14,2)::text,
               'decrease', greatest(-x.amount_delta, 0)::numeric(14,2)::text,
               'balance', x.balance::numeric(14,2)::text
           ) ORDER BY x.entry_date, x.id)
           FROM (SELECT * FROM period ORDER BY entry_date, id LIMIT 5000) x), '[]'::jsonb)
    INTO v_opening, v_period_sum, v_count, v_rows;

    RETURN jsonb_build_object(
        'supplier', v_supplier, 'from', p_from, 'to', p_to,
        'opening_balance', v_opening::numeric(14,2)::text,
        'entries', v_rows, 'truncated', v_count > 5000,
        'closing_balance', (v_opening + v_period_sum)::numeric(14,2)::text
    );
END;
$$;

-- ============================================================================
-- 9. Trial balance (accountant)
-- ============================================================================
CREATE OR REPLACE FUNCTION reports.get_trial_balance(p_session_token text, p_from date, p_to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE v_rows jsonb; v_totals jsonb;
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'VIEW_REPORTS');
    PERFORM reports._check_period(p_from, p_to);

    WITH lines AS (
        SELECT jl.account_id, jl.account_code, bd.document_date, jl.debit, jl.credit
        FROM finance.journal_lines jl
        JOIN core.business_documents bd ON bd.id = jl.document_id
        WHERE bd.status = 'POSTED' AND bd.document_date <= p_to
    ),
    agg AS (
        SELECT account_id,
               CASE WHEN account_id IS NULL THEN account_code END AS orphan_code,
               coalesce(sum(debit - credit) FILTER (WHERE document_date < p_from), 0) AS opening_net,
               coalesce(sum(debit) FILTER (WHERE document_date BETWEEN p_from AND p_to), 0) AS pd,
               coalesce(sum(credit) FILTER (WHERE document_date BETWEEN p_from AND p_to), 0) AS pc
        FROM lines
        GROUP BY account_id, CASE WHEN account_id IS NULL THEN account_code END
    ),
    shaped AS (
        SELECT a.account_id, coalesce(acc.scf_code, a.orphan_code) AS scf_code,
               acc.name_fr, acc.name_ar, acc.name_en,
               a.opening_net, a.pd, a.pc, (a.opening_net + a.pd - a.pc) AS closing_net
        FROM agg a LEFT JOIN finance.accounts acc ON acc.id = a.account_id
    )
    SELECT coalesce(jsonb_agg(jsonb_build_object(
               'account_id', s.account_id, 'scf_code', s.scf_code,
               'name_fr', s.name_fr, 'name_ar', s.name_ar, 'name_en', s.name_en,
               'opening_debit', greatest(s.opening_net, 0)::numeric(14,2)::text,
               'opening_credit', greatest(-s.opening_net, 0)::numeric(14,2)::text,
               'period_debit', s.pd::numeric(14,2)::text,
               'period_credit', s.pc::numeric(14,2)::text,
               'closing_debit', greatest(s.closing_net, 0)::numeric(14,2)::text,
               'closing_credit', greatest(-s.closing_net, 0)::numeric(14,2)::text
           ) ORDER BY s.scf_code), '[]'::jsonb),
           jsonb_build_object(
               'opening_debit', coalesce(sum(greatest(s.opening_net, 0)), 0)::numeric(14,2)::text,
               'opening_credit', coalesce(sum(greatest(-s.opening_net, 0)), 0)::numeric(14,2)::text,
               'period_debit', coalesce(sum(s.pd), 0)::numeric(14,2)::text,
               'period_credit', coalesce(sum(s.pc), 0)::numeric(14,2)::text,
               'closing_debit', coalesce(sum(greatest(s.closing_net, 0)), 0)::numeric(14,2)::text,
               'closing_credit', coalesce(sum(greatest(-s.closing_net, 0)), 0)::numeric(14,2)::text,
               'is_balanced', coalesce(sum(greatest(s.closing_net, 0)), 0) = coalesce(sum(greatest(-s.closing_net, 0)), 0),
               'difference', (coalesce(sum(greatest(s.closing_net, 0)), 0) - coalesce(sum(greatest(-s.closing_net, 0)), 0))::numeric(14,2)::text)
    INTO v_rows, v_totals
    FROM shaped s
    WHERE s.opening_net <> 0 OR s.pd <> 0 OR s.pc <> 0;

    RETURN jsonb_build_object('from', p_from, 'to', p_to, 'rows', v_rows, 'totals', v_totals);
END;
$$;

-- ============================================================================
-- 10. Account ledger (accountant)
-- ============================================================================
CREATE OR REPLACE FUNCTION reports.get_account_ledger(
    p_session_token text, p_account_id bigint, p_from date, p_to date, p_limit integer, p_offset integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
    v_account jsonb; v_opening numeric; v_period_sum numeric; v_total bigint; v_rows jsonb;
    v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 500);
    v_offset integer := greatest(coalesce(p_offset, 0), 0);
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'VIEW_REPORTS');
    PERFORM reports._check_period(p_from, p_to);

    SELECT jsonb_build_object('account_id', a.id, 'scf_code', a.scf_code,
                              'name_fr', a.name_fr, 'name_ar', a.name_ar, 'name_en', a.name_en)
    INTO v_account FROM finance.accounts a WHERE a.id = p_account_id;
    IF v_account IS NULL THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: account not found' USING ERRCODE = '22023';
    END IF;

    WITH lines AS (
        SELECT jl.document_id AS journal_id, jl.line_number, bd.document_date, bd.document_number,
               je.description, je.source_type, je.source_id, jl.debit, jl.credit
        FROM finance.journal_lines jl
        JOIN core.business_documents bd ON bd.id = jl.document_id
        JOIN finance.journal_entries je ON je.document_id = jl.document_id
        WHERE jl.account_id = p_account_id AND bd.status = 'POSTED' AND bd.document_date <= p_to
    ),
    opening AS (SELECT coalesce(sum(debit - credit), 0) AS v FROM lines WHERE document_date < p_from),
    period AS (
        SELECT l.*, o.v + sum(l.debit - l.credit) OVER (ORDER BY l.document_date, l.journal_id, l.line_number
                                                         ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS balance
        FROM lines l CROSS JOIN opening o
        WHERE l.document_date >= p_from
    )
    SELECT (SELECT v FROM opening),
           (SELECT coalesce(sum(debit - credit), 0) FROM period),
           (SELECT count(*) FROM period),
           coalesce((SELECT jsonb_agg(jsonb_build_object(
               'date', x.document_date, 'journal_id', x.journal_id, 'journal_number', x.document_number,
               'description', x.description,
               'source_document_number', src.document_number,
               'debit', x.debit::numeric(14,2)::text, 'credit', x.credit::numeric(14,2)::text,
               'balance', x.balance::numeric(14,2)::text
           ) ORDER BY x.document_date, x.journal_id, x.line_number)
           FROM (SELECT * FROM period ORDER BY document_date, journal_id, line_number
                 LIMIT v_limit OFFSET v_offset) x
           LEFT JOIN core.business_documents src
                  ON src.id = x.source_id AND src.document_type = x.source_type), '[]'::jsonb)
    INTO v_opening, v_period_sum, v_total, v_rows;

    RETURN jsonb_build_object(
        'account', v_account, 'from', p_from, 'to', p_to,
        'opening_balance', v_opening::numeric(14,2)::text,
        'closing_balance', (v_opening + v_period_sum)::numeric(14,2)::text,
        'total_count', v_total, 'rows', v_rows
    );
END;
$$;

-- ============================================================================
-- 11. Account list for the ledger picker
-- ============================================================================
CREATE OR REPLACE FUNCTION reports.list_accounts(p_session_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE v_rows jsonb;
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'VIEW_REPORTS');
    SELECT coalesce(jsonb_agg(jsonb_build_object(
               'account_id', a.id, 'scf_code', a.scf_code,
               'name_fr', a.name_fr, 'name_ar', a.name_ar, 'name_en', a.name_en) ORDER BY a.scf_code), '[]'::jsonb)
    INTO v_rows
    FROM finance.accounts a
    WHERE EXISTS (SELECT 1 FROM finance.journal_lines jl WHERE jl.account_id = a.id);
    RETURN jsonb_build_object('rows', v_rows);
END;
$$;

-- ============================================================================
-- 12. Grants
-- ============================================================================
REVOKE ALL ON FUNCTION reports.get_profit_and_loss(text, date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION reports.get_cash_flow(text, date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION reports.get_monthly_summary(text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION reports.get_receivables_aging(text, text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION reports.get_customer_statement(text, bigint, date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION reports.get_supplier_balances(text, text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION reports.get_supplier_statement(text, bigint, date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION reports.get_trial_balance(text, date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION reports.get_account_ledger(text, bigint, date, date, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION reports.list_accounts(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reports.get_profit_and_loss(text, date, date) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION reports.get_cash_flow(text, date, date) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION reports.get_monthly_summary(text, integer, integer) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION reports.get_receivables_aging(text, text, integer, integer) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION reports.get_customer_statement(text, bigint, date, date) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION reports.get_supplier_balances(text, text, integer, integer) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION reports.get_supplier_statement(text, bigint, date, date) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION reports.get_trial_balance(text, date, date) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION reports.get_account_ledger(text, bigint, date, date, integer, integer) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION reports.list_accounts(text) TO stockiha_runtime;

UPDATE operations.schema_state SET migration_version = 20260928090000, updated_at = now() WHERE singleton;
RESET ROLE;
