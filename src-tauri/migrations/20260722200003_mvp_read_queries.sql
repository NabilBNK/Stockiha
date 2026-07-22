-- Slice 1 Frontend MVP batch: authenticated read queries backing the UI.
--
-- Every function validates the session token first (via `iam.resolve_session`
-- for plain authenticated reads, or `iam.resolve_session_with_permission`
-- where the ruling calls for a permission), then returns only
-- display-appropriate columns. All SECURITY DEFINER, owner-owned, fixed
-- search_path, schema-qualified, granted to the runtime role only. None of
-- them expose token hashes, password hashes, machine paths, worker lease
-- internals, or SQL detail.
SET ROLE stockiha_owner;

-- Products + their default variant, with the selected warehouse's on-hand
-- quantity and WAC (0 when the variant has no position in that warehouse
-- yet). Optional case-insensitive search over name/SKU. Only active variants
-- are returned (the POS and forms only ever offer sellable variants).
CREATE FUNCTION catalog.list_products(
    p_session_token text,
    p_warehouse_id bigint,
    p_search text
)
RETURNS TABLE (
    product_id        bigint,
    variant_id        bigint,
    sku               text,
    name              text,
    sale_price        numeric,
    is_active         boolean,
    quantity_on_hand  numeric,
    last_known_wac    numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    PERFORM 1 FROM iam.resolve_session(p_session_token);

    RETURN QUERY
    SELECT
        p.id,
        v.id,
        v.sku,
        p.name,
        v.sale_price,
        v.is_active,
        coalesce(pos.quantity_on_hand, 0)::numeric,
        coalesce(pos.last_known_wac, 0)::numeric
    FROM catalog.product_variants v
    JOIN catalog.products p ON p.id = v.product_id
    LEFT JOIN inventory.positions pos
        ON pos.variant_id = v.id AND pos.warehouse_id = p_warehouse_id
    WHERE v.is_active
      AND (
        p_search IS NULL
        OR btrim(p_search) = ''
        OR v.sku ILIKE '%' || p_search || '%'
        OR p.name ILIKE '%' || p_search || '%'
      )
    ORDER BY p.name, v.sku;
END;
$$;

CREATE FUNCTION inventory.list_warehouses(p_session_token text)
RETURNS TABLE (id bigint, code text, name text, is_active boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    PERFORM 1 FROM iam.resolve_session(p_session_token);
    RETURN QUERY
        SELECT w.id, w.code, w.name, w.is_active
        FROM inventory.warehouses w
        ORDER BY w.code;
END;
$$;

CREATE FUNCTION finance.list_fiscal_periods(p_session_token text)
RETURNS TABLE (id bigint, period_code text, starts_on date, ends_on date, status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    PERFORM 1 FROM iam.resolve_session(p_session_token);
    RETURN QUERY
        SELECT fp.id, fp.period_code, fp.starts_on, fp.ends_on, fp.status
        FROM finance.fiscal_periods fp
        ORDER BY fp.starts_on DESC;
END;
$$;

-- The single current open period the POS/receipt/stock flows post into.
-- Returns at most one row (the earliest-starting OPEN period).
CREATE FUNCTION finance.get_open_fiscal_period(p_session_token text)
RETURNS TABLE (id bigint, period_code text, starts_on date, ends_on date)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    PERFORM 1 FROM iam.resolve_session(p_session_token);
    RETURN QUERY
        SELECT fp.id, fp.period_code, fp.starts_on, fp.ends_on
        FROM finance.fiscal_periods fp
        WHERE fp.status = 'OPEN'
        ORDER BY fp.starts_on
        LIMIT 1;
END;
$$;

-- Posted business-document header + cash-sale totals for the receipt view.
-- Gated on POST_CASH_SALE (the cashier who can post a sale may view its
-- receipt). Never exposes internal ids beyond the document id itself.
CREATE FUNCTION sales.get_sale_document(p_session_token text, p_document_id bigint)
RETURNS TABLE (
    document_id      bigint,
    document_type    text,
    status           text,
    document_number  text,
    document_date    date,
    posted_at        timestamptz,
    subtotal         numeric,
    total_amount     numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'POST_CASH_SALE');
    RETURN QUERY
        SELECT bd.id, bd.document_type, bd.status, bd.document_number, bd.document_date,
               bd.posted_at, cs.subtotal, cs.total_amount
        FROM core.business_documents bd
        JOIN sales.cash_sales cs ON cs.document_id = bd.id
        WHERE bd.id = p_document_id;
END;
$$;

CREATE FUNCTION sales.list_sale_lines(p_session_token text, p_document_id bigint)
RETURNS TABLE (
    line_number            integer,
    variant_sku_snapshot   text,
    variant_name_snapshot  text,
    quantity               numeric,
    unit_price             numeric,
    line_total             numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'POST_CASH_SALE');
    RETURN QUERY
        SELECT l.line_number, l.variant_sku_snapshot, l.variant_name_snapshot,
               l.quantity, l.unit_price, l.line_total
        FROM sales.cash_sale_lines l
        WHERE l.document_id = p_document_id
        ORDER BY l.line_number;
END;
$$;

-- Job status views for a document (generation, print, drawer). Return only
-- the safe operational columns — never `claimed_by`, lease timestamps, or
-- `error_message` (which could carry machine paths).
CREATE FUNCTION documents.list_document_jobs(p_session_token text, p_document_id bigint)
RETURNS TABLE (
    job_kind      text,
    id            bigint,
    status        text,
    attempt_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    PERFORM 1 FROM iam.resolve_session(p_session_token);
    RETURN QUERY
        SELECT 'GENERATION'::text, g.id, g.status, g.attempt_count
        FROM documents.generation_jobs g WHERE g.business_document_id = p_document_id
        UNION ALL
        SELECT 'PRINT'::text, pj.id, pj.status, pj.attempt_count
        FROM documents.print_jobs pj WHERE pj.business_document_id = p_document_id
        UNION ALL
        SELECT 'DRAWER'::text, d.id, d.status, d.attempt_count
        FROM cash.drawer_jobs d WHERE d.business_document_id = p_document_id
        ORDER BY 1, 2;
END;
$$;

-- Small operational dashboard summary. Single row; only currently-supported
-- figures. `active_cash_session_id` is the open session for the given
-- workstation (NULL if none); latest document is the most recent posted
-- business document.
CREATE FUNCTION core.get_dashboard_summary(p_session_token text, p_workstation_id text)
RETURNS TABLE (
    product_count             bigint,
    variant_count             bigint,
    active_cash_session_id    bigint,
    latest_document_id        bigint,
    latest_document_number    text,
    pending_generation_jobs   bigint,
    pending_print_jobs        bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    PERFORM 1 FROM iam.resolve_session(p_session_token);
    RETURN QUERY
    SELECT
        (SELECT count(*) FROM catalog.products),
        (SELECT count(*) FROM catalog.product_variants),
        (SELECT cs.id FROM sales.cash_sessions cs
            WHERE cs.workstation_id = p_workstation_id AND cs.status = 'OPEN'
            ORDER BY cs.opened_at DESC LIMIT 1),
        (SELECT bd.id FROM core.business_documents bd
            WHERE bd.status = 'POSTED' ORDER BY bd.posted_at DESC LIMIT 1),
        (SELECT bd.document_number FROM core.business_documents bd
            WHERE bd.status = 'POSTED' ORDER BY bd.posted_at DESC LIMIT 1),
        (SELECT count(*) FROM documents.generation_jobs
            WHERE status IN ('PENDING', 'CLAIMED', 'GENERATING')),
        (SELECT count(*) FROM documents.print_jobs
            WHERE status IN ('WAITING_FOR_GENERATION', 'PENDING', 'CLAIMED', 'SENDING'));
END;
$$;

REVOKE ALL ON FUNCTION catalog.list_products(text, bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION inventory.list_warehouses(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION finance.list_fiscal_periods(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION finance.get_open_fiscal_period(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION sales.get_sale_document(text, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION sales.list_sale_lines(text, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION documents.list_document_jobs(text, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION core.get_dashboard_summary(text, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION catalog.list_products(text, bigint, text) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION inventory.list_warehouses(text) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION finance.list_fiscal_periods(text) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION finance.get_open_fiscal_period(text) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION sales.get_sale_document(text, bigint) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION sales.list_sale_lines(text, bigint) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION documents.list_document_jobs(text, bigint) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION core.get_dashboard_summary(text, text) TO stockiha_runtime;

RESET ROLE;
