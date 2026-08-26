-- WS-I-1: the eight core historical financial reports over the staged, mapped
-- paper ledger.
--
--   1. Profit and loss                    (cost-dependent)
--   2. Monthly trend                      (cost-dependent)
--   3. Purchases by supplier and product
--   4. Sales by customer and product
--   5. Best and worst sellers             (cost-dependent)
--   6. Customer debt
--   7. Supplier debt and expenses
--   8. Stock on hand and valuation        (cost-dependent)
--
-- The customer transcribed 18 months of paper ledgers. WS-G staged them and the
-- product-alias system (R0-005) resolved every transcribed description to a
-- canonical variant. This migration computes the reports entirely in PostgreSQL
-- `numeric`. Nothing here writes: no journal entry, no inventory movement, no
-- operational row of any kind. Every function is read-only by construction.
--
-- Five rules the rest of WS-I depends on:
--
--   1. NO FLOATING POINT, ANYWHERE. Amounts are staged as whole-dinar `bigint`
--      and are cast to `numeric` before any division. `round(x, 6)` is applied
--      to the running weighted-average cost per pool update; cost of goods sold
--      per line is left UNROUNDED. Every money value leaves this schema as
--      exact decimal TEXT so TypeScript can never see an IEEE-754 double.
--
--   2. THE READINESS GATE IS ABOUT DATA DEPENDENCY, NOT REPORT IDENTITY. A
--      report that consumes a purchase cost refuses to run while the product
--      mapping is incomplete: an unresolved sell description has no cost
--      source, and reporting it would silently book the entire sale price as
--      profit. Profit and loss, the monthly trend, the seller ranking and the
--      stock valuation are therefore gated. Purchases, sales, customer debt,
--      supplier debt and expenses read only amounts, parties and payment
--      status — no mapping decision can move any of those figures by one
--      dinar, so gating them would withhold numbers that are already right.
--      They still carry the readiness block so the screen can warn.
--
--   3. TWO-TIER HONESTY. The customer's own handwritten "Benefit" column and
--      the computed profit do NOT agree, and they never will: the paper figure
--      is a per-sale manual note, while the computed figure subtracts the actual
--      weighted-average cost and, for net profit, the expenses. Every
--      profit-facing payload therefore carries the recorded benefit, the
--      computed figure, AND the gap. There is no code path here that returns one
--      without the others.
--
--   4. ONE ORDERING: STRICT CHRONOLOGICAL, AT DATE LEVEL. Purchases and sales
--      are processed by transaction date, purchases before sales on the SAME
--      date, tie-broken by workbook row order. That is what a real warehouse
--      means by cost, and a sale can never consume stock bought after it. This
--      is the sole normative convention; the month-level grouping that appeared
--      in revision 2 of the fixture oracle was a mistake in that document and
--      is obsolete.
--
--   5. A SALE WITH NO KNOWN PURCHASE COST IS ITS OWN CATEGORY, NOT A FOOTNOTE.
--      The customer held stock before his paper records began, so sales whose
--      variant has no earlier purchase are permanent, not a fixture artifact.
--      Their revenue is reported separately from revenue that carries a cost,
--      and a variant touched by one of them reports an UNKNOWN margin. A cost
--      of zero is never invented, because that would display a 100 % margin on
--      a sale nobody can price.

SET ROLE stockiha_owner;

-- ---------------------------------------------------------------------------
-- 1. The reporting projection
-- ---------------------------------------------------------------------------
-- `onboarding.historical_trade_lines_mapped` (R0-005) deliberately exposes only
-- what the mapping screen needs, so it carries no party, no payment status and
-- no benefit. Reports need all three. This view adds them without touching the
-- staged transcription, which is still never rewritten.
--
-- Party precedence follows the writer: a line's own party wins, falling back to
-- the transaction's. The role of the party is implied by the direction —
-- PURCHASE means supplier, SALE means customer, EXPENSE means payee.

CREATE OR REPLACE VIEW onboarding.historical_report_lines AS
SELECT
    l.id                                        AS line_id,
    l.transaction_id,
    t.batch_id,
    t.transaction_type,
    t.transaction_date,
    t.payment_status,
    l.source_row_number,
    l.line_sequence,
    l.product_name,
    l.brand,
    l.custom_details,
    l.quantity,
    l.effective_line_total_dzd,
    coalesce(l.party_company, t.party_company)  AS party_company,
    onboarding.historical_description_key(l.product_name, l.brand, l.custom_details)
                                                AS normalized_key,
    coalesce(
        a.canonical_key,
        onboarding.historical_description_key(l.product_name, l.brand, l.custom_details)
    )                                           AS canonical_key
FROM onboarding.historical_trade_lines l
JOIN onboarding.historical_trade_transactions t ON t.id = l.transaction_id
LEFT JOIN onboarding.historical_product_aliases a
       ON a.normalized_key
        = onboarding.historical_description_key(l.product_name, l.brand, l.custom_details);

COMMENT ON VIEW onboarding.historical_report_lines IS
    'WS-I: staged historical lines with the confirmed mapping, the party and the payment status, for reporting only. Read-only projection; the staged rows are never modified.';

REVOKE ALL ON onboarding.historical_report_lines FROM PUBLIC;
REVOKE ALL ON onboarding.historical_report_lines FROM stockiha_runtime;

-- A canonical key is `product|brand|details`, normalized and lowercased. Every
-- report that names a product names the CANONICAL variant, never a raw
-- transcription, so two spellings of one product can never appear as two rows.
CREATE OR REPLACE FUNCTION onboarding.historical_variant_label(p_key text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
    SELECT array_to_string(
        ARRAY(
            SELECT CASE WHEN btrim(part) = '' THEN '—' ELSE btrim(part) END
            FROM unnest(string_to_array(coalesce(p_key, ''), '|'))
                 WITH ORDINALITY AS u(part, ord)
            ORDER BY u.ord
        ),
        ' · '
    );
$$;

REVOKE ALL ON FUNCTION onboarding.historical_variant_label(text) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 2. The readiness gate, factored out
-- ---------------------------------------------------------------------------
-- R0-005 already answers "is the mapping complete?" but only behind a session
-- token. A report function has already validated its own session by the time it
-- needs the answer, so the computation is factored into an internal helper and
-- the existing public function now delegates to it. One source of truth: the
-- gate the mapping screen shows and the gate the reports enforce cannot drift.

CREATE OR REPLACE FUNCTION onboarding.historical_mapping_readiness_internal(
    p_batch_id bigint
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = pg_catalog
AS $$
    WITH scoped AS (
        SELECT *
        FROM onboarding.historical_trade_lines_mapped m
        WHERE m.batch_id = p_batch_id
          AND m.transaction_type IN ('SALE', 'PURCHASE')
          AND m.normalized_key <> '||'
    ),
    cost_source AS (
        SELECT canonical_key
        FROM scoped
        WHERE transaction_type = 'PURCHASE'
        GROUP BY canonical_key
    ),
    per_key AS (
        SELECT
            s.normalized_key,
            s.canonical_key,
            bool_or(s.is_resolved)                                       AS is_resolved,
            count(*) FILTER (WHERE s.transaction_type = 'SALE') > 0      AS appears_in_sell,
            coalesce(sum(s.effective_line_total_dzd)
                     FILTER (WHERE s.transaction_type = 'SALE'), 0)      AS sell_value_dzd
        FROM scoped s
        GROUP BY s.normalized_key, s.canonical_key
    )
    SELECT jsonb_build_object(
        'batchId', p_batch_id,
        'distinctDescriptionCount', count(*),
        'resolvedDescriptionCount', count(*) FILTER (WHERE k.is_resolved),
        'unresolvedDescriptionCount', count(*) FILTER (WHERE NOT k.is_resolved),
        'sellDescriptionCount', count(*) FILTER (WHERE k.appears_in_sell),
        'unresolvedSellDescriptionCount',
            count(*) FILTER (WHERE k.appears_in_sell AND NOT k.is_resolved),
        'distinctCanonicalVariantsSold',
            count(DISTINCT k.canonical_key) FILTER (WHERE k.appears_in_sell),
        'sellWithoutCostSourceCount',
            count(*) FILTER (WHERE k.appears_in_sell AND c.canonical_key IS NULL),
        'sellWithoutCostSourceValueDzd',
            coalesce(sum(k.sell_value_dzd) FILTER (WHERE c.canonical_key IS NULL), 0)::text,
        'isComplete',
            count(*) FILTER (WHERE NOT k.is_resolved) = 0
            AND count(*) FILTER (WHERE k.appears_in_sell AND c.canonical_key IS NULL) = 0
    )
    FROM per_key k
    LEFT JOIN cost_source c ON c.canonical_key = k.canonical_key;
$$;

COMMENT ON FUNCTION onboarding.historical_mapping_readiness_internal(bigint) IS
    'WS-I: the mapping readiness computation, without the session check. The single source of truth for both the mapping screen and the report gate.';

REVOKE ALL ON FUNCTION onboarding.historical_mapping_readiness_internal(bigint) FROM PUBLIC;

-- The public, session-checked entry point keeps its exact signature and output
-- shape; only its body is now a delegation.
CREATE OR REPLACE FUNCTION onboarding.get_historical_mapping_readiness(
    p_session_token text,
    p_batch_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    PERFORM 1
    FROM iam.resolve_session_with_permission(
        p_session_token,
        'REVIEW_HISTORICAL_FINANCE_IMPORT'
    );

    IF p_batch_id IS NULL OR p_batch_id <= 0 THEN
        RAISE EXCEPTION 'invalid historical finance batch' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM onboarding.historical_finance_batches WHERE id = p_batch_id) THEN
        RAISE EXCEPTION 'unknown historical finance batch' USING ERRCODE = '22023';
    END IF;

    RETURN onboarding.historical_mapping_readiness_internal(p_batch_id);
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. The weighted-average cost walk
-- ---------------------------------------------------------------------------
-- One cost pool per canonical variant. A purchase adds quantity and value to
-- its pool. A sale takes cost out of it at the running weighted average.
--
-- Ordering is strictly chronological: by transaction date, purchases before
-- sales on the same date, then workbook row order, then line order. Fully
-- deterministic, and a sale can never consume stock bought after it.
--
-- The arithmetic:
--   * running WAC = pool value / pool quantity, ROUNDED TO 6 DECIMALS;
--   * cost of goods sold for a line = WAC x quantity, LEFT UNROUNDED;
--   * when a sale empties a pool, that line's cost is the ENTIRE remaining pool
--     value, so the rounding residue accumulated in the pool is never orphaned.
--
-- That last rule is what makes the report balance: for every variant, total
-- purchased value = total cost of goods sold + closing pool value, exactly,
-- with no lost fraction of a dinar.
--
-- Expenses never enter the walk: an expense line has no quantity and no
-- variant, and cannot consume stock.
--
-- A sale that lands before any purchase of its variant is reported with
-- `missing_cost_source`, never given an invented cost of zero silently. The
-- caller surfaces the count so an understated cost can never masquerade as
-- profit.
--
-- The walk emits TWO kinds of row, from ONE pass, so the cost of goods sold and
-- the closing stock can never be computed by two implementations that drift:
--   * `SALE_LINE`    — one row per sale line, with its cost;
--   * `CLOSING_POOL` — one row per variant still holding quantity or value when
--                      the last staged transaction has been processed.

DROP FUNCTION IF EXISTS onboarding.historical_wac_walk(bigint);

CREATE FUNCTION onboarding.historical_wac_walk(
    p_batch_id bigint
)
RETURNS TABLE (
    row_kind            text,
    line_id             bigint,
    transaction_id      bigint,
    transaction_date    date,
    canonical_key       text,
    quantity            numeric,
    revenue_dzd         numeric,
    cost_dzd            numeric,
    wac_at_sale         numeric,
    missing_cost_source boolean,
    missing_quantity    boolean
)
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog
AS $$
DECLARE
    v_keys     text[]    := ARRAY[]::text[];
    v_qty      numeric[] := ARRAY[]::numeric[];
    v_val      numeric[] := ARRAY[]::numeric[];
    v_rec      record;
    v_idx      integer;
    v_wac      numeric;
    v_cogs     numeric;
    v_line_qty numeric;
    v_i        integer;
BEGIN
    FOR v_rec IN
        SELECT
            r.line_id,
            r.transaction_id,
            r.transaction_date,
            r.canonical_key,
            r.quantity,
            r.effective_line_total_dzd::numeric AS amount,
            (r.transaction_type = 'SALE')       AS is_sale
        FROM onboarding.historical_report_lines r
        WHERE r.batch_id = p_batch_id
          AND r.transaction_type IN ('PURCHASE', 'SALE')
          AND r.canonical_key <> '||'
        ORDER BY
            r.transaction_date,
            (r.transaction_type = 'SALE'),   -- false sorts first: purchases lead
            r.source_row_number,
            r.line_sequence
    LOOP
        v_idx := array_position(v_keys, v_rec.canonical_key);
        IF v_idx IS NULL THEN
            v_keys := v_keys || v_rec.canonical_key;
            v_qty  := v_qty  || 0::numeric;
            v_val  := v_val  || 0::numeric;
            v_idx  := array_length(v_keys, 1);
        END IF;

        IF NOT v_rec.is_sale THEN
            -- A purchase adds to the pool. A purchase with no transcribed
            -- quantity still adds its value; it cannot add units it lacks.
            v_qty[v_idx] := v_qty[v_idx] + coalesce(v_rec.quantity, 0)::numeric;
            v_val[v_idx] := v_val[v_idx] + v_rec.amount;
            CONTINUE;
        END IF;

        v_line_qty := coalesce(v_rec.quantity, 0)::numeric;

        IF v_line_qty <= 0 THEN
            -- No transcribed quantity: no cost can be attributed. Reported,
            -- never silently treated as zero-cost profit.
            RETURN QUERY SELECT
                'SALE_LINE'::text,
                v_rec.line_id, v_rec.transaction_id, v_rec.transaction_date,
                v_rec.canonical_key, 0::numeric, v_rec.amount, 0::numeric,
                NULL::numeric, false, true;
            CONTINUE;
        END IF;

        IF v_qty[v_idx] <= 0 THEN
            -- The pool is empty at this point in time: nothing of this variant
            -- had been bought yet. Surfaced, not invented.
            RETURN QUERY SELECT
                'SALE_LINE'::text,
                v_rec.line_id, v_rec.transaction_id, v_rec.transaction_date,
                v_rec.canonical_key, v_line_qty, v_rec.amount, 0::numeric,
                NULL::numeric, true, false;
            CONTINUE;
        END IF;

        v_wac := round(v_val[v_idx] / v_qty[v_idx], 6);

        IF v_line_qty >= v_qty[v_idx] THEN
            -- The sale empties the pool: take the entire remaining value so no
            -- rounding residue is orphaned.
            v_cogs := v_val[v_idx];
            v_qty[v_idx] := 0;
            v_val[v_idx] := 0;
        ELSE
            v_cogs := v_wac * v_line_qty;          -- deliberately UNROUNDED
            v_qty[v_idx] := v_qty[v_idx] - v_line_qty;
            v_val[v_idx] := v_val[v_idx] - v_cogs;
        END IF;

        RETURN QUERY SELECT
            'SALE_LINE'::text,
            v_rec.line_id, v_rec.transaction_id, v_rec.transaction_date,
            v_rec.canonical_key, v_line_qty, v_rec.amount, v_cogs,
            v_wac, false, false;
    END LOOP;

    -- What is left in every pool once the last staged transaction has been
    -- processed: the stock the customer is holding, at its weighted average
    -- cost. A pool that was emptied contributes nothing and is not reported.
    FOR v_i IN 1 .. coalesce(array_length(v_keys, 1), 0) LOOP
        IF v_qty[v_i] <> 0 OR v_val[v_i] <> 0 THEN
            RETURN QUERY SELECT
                'CLOSING_POOL'::text,
                NULL::bigint, NULL::bigint, NULL::date,
                v_keys[v_i], v_qty[v_i], NULL::numeric, v_val[v_i],
                CASE WHEN v_qty[v_i] > 0 THEN round(v_val[v_i] / v_qty[v_i], 6) END,
                false, false;
        END IF;
    END LOOP;
END;
$$;

COMMENT ON FUNCTION onboarding.historical_wac_walk(bigint) IS
    'WS-I: one chronological weighted-average-cost pass over a staged batch, emitting both the per-sale-line cost of goods sold and the closing stock pools. Purchases lead sales on the same date.';

REVOKE ALL ON FUNCTION onboarding.historical_wac_walk(bigint) FROM PUBLIC;

-- The per-sale-line half of the walk, under its original name and shape.
CREATE OR REPLACE FUNCTION onboarding.historical_wac_cogs(
    p_batch_id bigint
)
RETURNS TABLE (
    line_id             bigint,
    transaction_id      bigint,
    transaction_date    date,
    canonical_key       text,
    sold_quantity       numeric,
    revenue_dzd         numeric,
    cogs_dzd            numeric,
    wac_at_sale         numeric,
    missing_cost_source boolean,
    missing_quantity    boolean
)
LANGUAGE sql
STABLE
SET search_path = pg_catalog
AS $$
    SELECT
        w.line_id, w.transaction_id, w.transaction_date, w.canonical_key,
        w.quantity, w.revenue_dzd, w.cost_dzd, w.wac_at_sale,
        w.missing_cost_source, w.missing_quantity
    FROM onboarding.historical_wac_walk(p_batch_id) w
    WHERE w.row_kind = 'SALE_LINE';
$$;

COMMENT ON FUNCTION onboarding.historical_wac_cogs(bigint) IS
    'WS-I: per-sale-line cost of goods sold from the historical purchase history, by weighted average cost, in strict chronological order with purchases before sales on the same date.';

REVOKE ALL ON FUNCTION onboarding.historical_wac_cogs(bigint) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 4. The month rows — the single arithmetic the profit report rolls up
-- ---------------------------------------------------------------------------
-- Both the monthly table and the profit-and-loss headline come from THIS
-- function, and the headline is the SUM OF THESE ALREADY-ROUNDED ROWS.
--
-- That is deliberate and it is a display requirement, not an accounting one.
-- The customer prints the monthly table and adds the column by hand. If the
-- headline were rounded independently from the unrounded per-line costs, his
-- addition would differ from the printed total by a centime and he would, quite
-- reasonably, stop trusting the report. Rounding each month once and summing
-- those rounded figures makes the printed page internally consistent.
--
-- The underlying arithmetic truth is unchanged and still available: the
-- unrounded sum of `historical_wac_cogs` is what the stock valuation report
-- uses to prove that total purchases = total cost of goods sold + closing
-- stock, to the exact dinar. Those are two different computations serving two
-- different purposes — a displayed total and an internal-consistency proof —
-- and they may differ by one centime without either being wrong.

CREATE OR REPLACE FUNCTION onboarding.historical_report_monthly_rows(
    p_batch_id bigint,
    p_date_from date,
    p_date_to date
)
RETURNS TABLE (
    month_key                     text,
    purchases_dzd                 numeric,
    sales_dzd                     numeric,
    cogs_dzd                      numeric,
    gross_profit_dzd              numeric,
    expenses_dzd                  numeric,
    net_profit_dzd                numeric,
    recorded_benefit_dzd          numeric,
    revenue_with_cost_dzd         numeric,
    revenue_without_cost_dzd      numeric,
    sale_lines_without_cost_count bigint
)
LANGUAGE sql
STABLE
SET search_path = pg_catalog
AS $$
    WITH base AS (
        SELECT
            to_char(r.transaction_date, 'YYYY-MM') AS mk,
            coalesce(sum(r.effective_line_total_dzd)
                     FILTER (WHERE r.transaction_type = 'PURCHASE'), 0)::numeric AS purchases,
            coalesce(sum(r.effective_line_total_dzd)
                     FILTER (WHERE r.transaction_type = 'SALE'), 0)::numeric     AS sales,
            coalesce(sum(r.effective_line_total_dzd)
                     FILTER (WHERE r.transaction_type = 'EXPENSE'), 0)::numeric  AS expenses
        FROM onboarding.historical_report_lines r
        WHERE r.batch_id = p_batch_id
          AND (p_date_from IS NULL OR r.transaction_date >= p_date_from)
          AND (p_date_to   IS NULL OR r.transaction_date <= p_date_to)
        GROUP BY 1
    ),
    cost AS (
        SELECT
            to_char(w.transaction_date, 'YYYY-MM') AS mk,
            sum(w.cogs_dzd)                                             AS cogs,
            count(*) FILTER (WHERE w.missing_cost_source
                                OR w.missing_quantity)                  AS no_cost_lines,
            coalesce(sum(w.revenue_dzd) FILTER (WHERE NOT w.missing_cost_source
                                                  AND NOT w.missing_quantity), 0) AS rev_with,
            coalesce(sum(w.revenue_dzd) FILTER (WHERE w.missing_cost_source
                                                   OR w.missing_quantity), 0)     AS rev_without
        FROM onboarding.historical_wac_cogs(p_batch_id) w
        WHERE (p_date_from IS NULL OR w.transaction_date >= p_date_from)
          AND (p_date_to   IS NULL OR w.transaction_date <= p_date_to)
        GROUP BY 1
    ),
    benefit AS (
        SELECT
            to_char(t.transaction_date, 'YYYY-MM')         AS mk,
            coalesce(sum(t.manual_benefit_dzd), 0)::numeric AS recorded
        FROM onboarding.historical_trade_transactions t
        WHERE t.batch_id = p_batch_id
          AND t.transaction_type = 'SALE'
          AND (p_date_from IS NULL OR t.transaction_date >= p_date_from)
          AND (p_date_to   IS NULL OR t.transaction_date <= p_date_to)
        GROUP BY 1
    )
    SELECT
        b.mk,
        round(b.purchases, 2),
        round(b.sales, 2),
        round(coalesce(c.cogs, 0), 2),
        round(b.sales, 2) - round(coalesce(c.cogs, 0), 2),
        round(b.expenses, 2),
        round(b.sales, 2) - round(coalesce(c.cogs, 0), 2) - round(b.expenses, 2),
        round(coalesce(n.recorded, 0), 2),
        round(coalesce(c.rev_with, 0), 2),
        round(coalesce(c.rev_without, 0), 2),
        coalesce(c.no_cost_lines, 0)::bigint
    FROM base b
    LEFT JOIN cost c    ON c.mk = b.mk
    LEFT JOIN benefit n ON n.mk = b.mk
    ORDER BY b.mk;
$$;

COMMENT ON FUNCTION onboarding.historical_report_monthly_rows(bigint, date, date) IS
    'WS-I: the per-month figures, already rounded to 2 decimals. The profit-and-loss headline is the sum of these rows, so the printed table always adds up to the printed total.';

REVOKE ALL ON FUNCTION onboarding.historical_report_monthly_rows(bigint, date, date) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 5. The reports
-- ---------------------------------------------------------------------------
-- Each is a plain STABLE SQL function: no session check, no write, no dynamic
-- SQL. They are reachable only through the single SECURITY DEFINER entry point
-- in section 6, which validates the session and the readiness gate first.
--
-- The date range is inclusive and either bound may be NULL, meaning unbounded.
-- It filters on `transaction_date`. The cost walk ALWAYS covers the whole
-- batch regardless of the range: a weighted average cost depends on the entire
-- purchase history that preceded a sale, so truncating the walk to the range
-- would invent a different cost.
--
-- Every monetary value leaves as exact decimal TEXT.

-- Report 1 — Profit and loss for the whole selected period.
--
-- Two things this payload refuses to blur:
--   * the paper's recorded benefit, the computed figure, and the gap always
--     travel together;
--   * revenue that carries a known purchase cost and revenue that does not are
--     two separate lines, and only the first has a gross profit. Adding them
--     back together gives total revenue exactly.
CREATE OR REPLACE FUNCTION onboarding.historical_report_profit_and_loss(
    p_batch_id bigint,
    p_date_from date,
    p_date_to date
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = pg_catalog
AS $$
    WITH m AS (
        SELECT *
        FROM onboarding.historical_report_monthly_rows(p_batch_id, p_date_from, p_date_to)
    ),
    -- THE HEADLINE IS THE SUM OF THE DISPLAYED MONTHLY ROWS. See section 4.
    head AS (
        SELECT
            coalesce(sum(purchases_dzd), 0)                 AS purchases,
            coalesce(sum(sales_dzd), 0)                     AS revenue,
            coalesce(sum(cogs_dzd), 0)                      AS cogs,
            coalesce(sum(gross_profit_dzd), 0)              AS gross,
            coalesce(sum(expenses_dzd), 0)                  AS expenses,
            coalesce(sum(net_profit_dzd), 0)                AS net,
            coalesce(sum(recorded_benefit_dzd), 0)          AS recorded,
            coalesce(sum(revenue_with_cost_dzd), 0)         AS rev_with,
            coalesce(sum(revenue_without_cost_dzd), 0)      AS rev_without,
            coalesce(sum(sale_lines_without_cost_count), 0) AS no_cost_lines,
            count(*)                                        AS month_count
        FROM m
    ),
    lines AS (
        SELECT *
        FROM onboarding.historical_report_lines r
        WHERE r.batch_id = p_batch_id
          AND (p_date_from IS NULL OR r.transaction_date >= p_date_from)
          AND (p_date_to   IS NULL OR r.transaction_date <= p_date_to)
    ),
    balances AS (
        SELECT
            coalesce(sum(l.effective_line_total_dzd)
                     FILTER (WHERE l.transaction_type = 'SALE'
                               AND l.payment_status = 'UNPAID'), 0)::numeric AS customer_debt,
            coalesce(sum(l.effective_line_total_dzd)
                     FILTER (WHERE l.transaction_type = 'PURCHASE'
                               AND l.payment_status = 'UNPAID'), 0)::numeric AS supplier_debt,
            coalesce(sum(l.effective_line_total_dzd)
                     FILTER (WHERE l.transaction_type = 'EXPENSE'
                               AND l.payment_status = 'UNPAID'), 0)::numeric AS unpaid_expenses,
            count(*) FILTER (WHERE l.transaction_type = 'SALE')              AS sale_line_count
        FROM lines l
    ),
    -- The paper benefit is a per-SALE-transaction note, so it is counted at
    -- transaction level, never per line, or a multi-line sale would count twice.
    benefit AS (
        SELECT
            count(*) FILTER (WHERE t.manual_benefit_dzd IS NOT NULL) AS with_benefit,
            count(*) FILTER (WHERE t.manual_benefit_dzd IS NULL)     AS without_benefit
        FROM onboarding.historical_trade_transactions t
        WHERE t.batch_id = p_batch_id
          AND t.transaction_type = 'SALE'
          AND (p_date_from IS NULL OR t.transaction_date >= p_date_from)
          AND (p_date_to   IS NULL OR t.transaction_date <= p_date_to)
    ),
    -- The cost-free split, at line level, with the two reasons kept apart.
    split AS (
        SELECT
            count(*) FILTER (WHERE NOT w.missing_cost_source
                               AND NOT w.missing_quantity)                     AS with_cost_lines,
            count(*) FILTER (WHERE w.missing_cost_source)                      AS no_purchase_lines,
            coalesce(sum(w.revenue_dzd) FILTER (WHERE w.missing_cost_source), 0) AS no_purchase_value,
            count(*) FILTER (WHERE w.missing_quantity)                         AS no_qty_lines,
            coalesce(sum(w.revenue_dzd) FILTER (WHERE w.missing_quantity), 0)  AS no_qty_value
        FROM onboarding.historical_wac_cogs(p_batch_id) w
        WHERE (p_date_from IS NULL OR w.transaction_date >= p_date_from)
          AND (p_date_to   IS NULL OR w.transaction_date <= p_date_to)
    )
    SELECT jsonb_build_object(
        'revenueDzd',            round(h.revenue, 2)::text,
        'purchasesDzd',          round(h.purchases, 2)::text,
        'cogsDzd',               round(h.cogs, 2)::text,
        'grossProfitDzd',        round(h.gross, 2)::text,
        'expensesDzd',           round(h.expenses, 2)::text,
        'netProfitDzd',          round(h.net, 2)::text,
        'monthCount',            h.month_count,
        -- The two-tier honesty block. Always all three together.
        'recordedBenefitDzd',    round(h.recorded, 2)::text,
        'gapVsGrossDzd',         round(h.recorded - h.gross, 2)::text,
        'gapVsNetDzd',           round(h.recorded - h.net, 2)::text,
        'customerDebtDzd',       round(bal.customer_debt, 2)::text,
        'supplierDebtDzd',       round(bal.supplier_debt, 2)::text,
        'unpaidExpensesDzd',     round(bal.unpaid_expenses, 2)::text,
        'saleLineCount',         bal.sale_line_count,
        'salesWithRecordedBenefitCount',    b.with_benefit,
        'salesWithoutRecordedBenefitCount', b.without_benefit,
        -- The cost-free split. `revenueWithCost + revenueWithoutCost` is
        -- `revenue`, exactly; the gross profit below applies ONLY to the first.
        'revenueWithCostDzd',            round(h.rev_with, 2)::text,
        'revenueWithoutCostDzd',         round(h.rev_without, 2)::text,
        'grossProfitOnCostedSalesDzd',   round(h.rev_with - h.cogs, 2)::text,
        'saleLinesWithCostCount',        s.with_cost_lines,
        'saleLinesWithoutCostCount',     h.no_cost_lines,
        'costFreeNoPurchaseCount',       s.no_purchase_lines,
        'costFreeNoPurchaseValueDzd',    round(s.no_purchase_value, 2)::text,
        'costFreeNoQuantityCount',       s.no_qty_lines,
        'costFreeNoQuantityValueDzd',    round(s.no_qty_value, 2)::text,
        -- Kept under their original names for the callers that already read
        -- them; identical meaning.
        'saleLinesWithoutCostAtDateCount',    s.no_purchase_lines,
        'saleLinesWithoutCostAtDateValueDzd', round(s.no_purchase_value, 2)::text,
        'saleLinesWithoutQuantityCount',      s.no_qty_lines
    )
    FROM head h, balances bal, benefit b, split s;
$$;

-- Report 2 — one row per calendar month, same two-tier honesty per row. These
-- are the exact rows the headline above is the sum of.
CREATE OR REPLACE FUNCTION onboarding.historical_report_monthly_trend(
    p_batch_id bigint,
    p_date_from date,
    p_date_to date
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = pg_catalog
AS $$
    SELECT coalesce(jsonb_agg(jsonb_build_object(
        'month',              m.month_key,
        'purchasesDzd',       m.purchases_dzd::text,
        'salesDzd',           m.sales_dzd::text,
        'cogsDzd',            m.cogs_dzd::text,
        'grossProfitDzd',     m.gross_profit_dzd::text,
        'expensesDzd',        m.expenses_dzd::text,
        'netProfitDzd',       m.net_profit_dzd::text,
        'recordedBenefitDzd', m.recorded_benefit_dzd::text,
        'gapVsGrossDzd',      (m.recorded_benefit_dzd - m.gross_profit_dzd)::text,
        'revenueWithCostDzd',    m.revenue_with_cost_dzd::text,
        'revenueWithoutCostDzd', m.revenue_without_cost_dzd::text,
        'saleLinesWithoutCostAtDateCount', m.sale_lines_without_cost_count
    ) ORDER BY m.month_key), '[]'::jsonb)
    FROM onboarding.historical_report_monthly_rows(p_batch_id, p_date_from, p_date_to) m;
$$;

-- Report 3 — purchases, grouped by supplier and by canonical variant.
-- Reads amounts, quantities and parties only. No cost is derived, so the
-- product mapping cannot move a single figure here and the report is not gated.
CREATE OR REPLACE FUNCTION onboarding.historical_report_purchases(
    p_batch_id bigint,
    p_date_from date,
    p_date_to date
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = pg_catalog
AS $$
    WITH lines AS (
        SELECT *
        FROM onboarding.historical_report_lines r
        WHERE r.batch_id = p_batch_id
          AND r.transaction_type = 'PURCHASE'
          AND (p_date_from IS NULL OR r.transaction_date >= p_date_from)
          AND (p_date_to   IS NULL OR r.transaction_date <= p_date_to)
    ),
    by_party AS (
        SELECT
            coalesce(nullif(btrim(l.party_company), ''), '') AS party,
            sum(l.effective_line_total_dzd)::numeric         AS total_value,
            coalesce(sum(l.quantity), 0)::numeric            AS quantity,
            count(*)                                         AS line_count,
            count(DISTINCT l.transaction_id)                 AS transaction_count
        FROM lines l
        GROUP BY 1
    ),
    by_variant AS (
        SELECT
            l.canonical_key,
            sum(l.effective_line_total_dzd)::numeric AS total_value,
            coalesce(sum(l.quantity), 0)::numeric    AS quantity,
            count(*)                                 AS line_count,
            count(DISTINCT l.transaction_id)         AS transaction_count
        FROM lines l
        GROUP BY 1
    )
    SELECT jsonb_build_object(
        'bySupplier', (
            SELECT coalesce(jsonb_agg(jsonb_build_object(
                        'party',            nullif(p.party, ''),
                        'totalDzd',         round(p.total_value, 2)::text,
                        'quantity',         p.quantity::text,
                        'lineCount',        p.line_count,
                        'transactionCount', p.transaction_count
                    ) ORDER BY p.total_value DESC, p.party), '[]'::jsonb)
            FROM by_party p
        ),
        'byProduct', (
            SELECT coalesce(jsonb_agg(jsonb_build_object(
                        'canonicalKey',     v.canonical_key,
                        'label',            onboarding.historical_variant_label(v.canonical_key),
                        'totalDzd',         round(v.total_value, 2)::text,
                        'quantity',         v.quantity::text,
                        'lineCount',        v.line_count,
                        'transactionCount', v.transaction_count
                    ) ORDER BY v.total_value DESC, v.canonical_key), '[]'::jsonb)
            FROM by_variant v
        ),
        'totalDzd',        (SELECT round(coalesce(sum(effective_line_total_dzd), 0)::numeric, 2)::text FROM lines),
        'totalQuantity',   (SELECT coalesce(sum(quantity), 0)::text FROM lines),
        'lineCount',       (SELECT count(*) FROM lines),
        'transactionCount',(SELECT count(DISTINCT transaction_id) FROM lines),
        'supplierCount',   (SELECT count(*) FROM by_party WHERE party <> ''),
        'productCount',    (SELECT count(*) FROM by_variant),
        'unspecifiedSupplierTotalDzd',
            (SELECT round(coalesce(sum(total_value), 0), 2)::text FROM by_party WHERE party = '')
    );
$$;

-- Report 4 — sales, grouped by customer and by canonical variant. Same shape as
-- report 3, and equally free of any cost, so equally ungated.
CREATE OR REPLACE FUNCTION onboarding.historical_report_sales(
    p_batch_id bigint,
    p_date_from date,
    p_date_to date
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = pg_catalog
AS $$
    WITH lines AS (
        SELECT *
        FROM onboarding.historical_report_lines r
        WHERE r.batch_id = p_batch_id
          AND r.transaction_type = 'SALE'
          AND (p_date_from IS NULL OR r.transaction_date >= p_date_from)
          AND (p_date_to   IS NULL OR r.transaction_date <= p_date_to)
    ),
    by_party AS (
        SELECT
            coalesce(nullif(btrim(l.party_company), ''), '') AS party,
            sum(l.effective_line_total_dzd)::numeric         AS total_value,
            coalesce(sum(l.quantity), 0)::numeric            AS quantity,
            count(*)                                         AS line_count,
            count(DISTINCT l.transaction_id)                 AS transaction_count,
            coalesce(sum(l.effective_line_total_dzd)
                     FILTER (WHERE l.payment_status = 'UNPAID'), 0)::numeric AS unpaid_value
        FROM lines l
        GROUP BY 1
    ),
    by_variant AS (
        SELECT
            l.canonical_key,
            sum(l.effective_line_total_dzd)::numeric AS total_value,
            coalesce(sum(l.quantity), 0)::numeric    AS quantity,
            count(*)                                 AS line_count,
            count(DISTINCT l.transaction_id)         AS transaction_count
        FROM lines l
        GROUP BY 1
    )
    SELECT jsonb_build_object(
        'byCustomer', (
            SELECT coalesce(jsonb_agg(jsonb_build_object(
                        'party',            nullif(p.party, ''),
                        'totalDzd',         round(p.total_value, 2)::text,
                        'unpaidDzd',        round(p.unpaid_value, 2)::text,
                        'quantity',         p.quantity::text,
                        'lineCount',        p.line_count,
                        'transactionCount', p.transaction_count
                    ) ORDER BY p.total_value DESC, p.party), '[]'::jsonb)
            FROM by_party p
        ),
        'byProduct', (
            SELECT coalesce(jsonb_agg(jsonb_build_object(
                        'canonicalKey',     v.canonical_key,
                        'label',            onboarding.historical_variant_label(v.canonical_key),
                        'totalDzd',         round(v.total_value, 2)::text,
                        'quantity',         v.quantity::text,
                        'lineCount',        v.line_count,
                        'transactionCount', v.transaction_count
                    ) ORDER BY v.total_value DESC, v.canonical_key), '[]'::jsonb)
            FROM by_variant v
        ),
        'totalDzd',        (SELECT round(coalesce(sum(effective_line_total_dzd), 0)::numeric, 2)::text FROM lines),
        'totalQuantity',   (SELECT coalesce(sum(quantity), 0)::text FROM lines),
        'lineCount',       (SELECT count(*) FROM lines),
        'transactionCount',(SELECT count(DISTINCT transaction_id) FROM lines),
        'customerCount',   (SELECT count(*) FROM by_party WHERE party <> ''),
        'productCount',    (SELECT count(*) FROM by_variant),
        'unspecifiedCustomerTotalDzd',
            (SELECT round(coalesce(sum(total_value), 0), 2)::text FROM by_party WHERE party = '')
    );
$$;

-- Report 5 — best and worst sellers, by quantity and by margin.
--
-- Every row names the CANONICAL variant, never a raw transcription.
--
-- The margin rule is the whole point of this report. A variant with even one
-- sale that has no known purchase cost gets `marginKnown = false` and NO margin
-- figure at all. Treating that missing cost as zero would display the entire
-- sale price as margin — a 100 % margin on merchandise the customer certainly
-- paid for — and would put exactly the least-understood products at the top of
-- a "best sellers" list. Quantity needs no cost, so those variants are still
-- ranked by quantity; they are simply absent from the margin ranking and listed
-- on their own.
CREATE OR REPLACE FUNCTION onboarding.historical_report_sellers(
    p_batch_id bigint,
    p_date_from date,
    p_date_to date
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = pg_catalog
AS $$
    WITH walk AS (
        SELECT *
        FROM onboarding.historical_wac_cogs(p_batch_id) w
        WHERE (p_date_from IS NULL OR w.transaction_date >= p_date_from)
          AND (p_date_to   IS NULL OR w.transaction_date <= p_date_to)
    ),
    variant AS (
        SELECT
            w.canonical_key,
            onboarding.historical_variant_label(w.canonical_key) AS label,
            sum(w.sold_quantity)                                 AS quantity,
            sum(w.revenue_dzd)                                   AS revenue,
            sum(w.cogs_dzd)                                      AS cogs,
            count(*)                                             AS line_count,
            count(*) FILTER (WHERE w.missing_cost_source
                                OR w.missing_quantity)           AS lines_without_cost,
            NOT bool_or(w.missing_cost_source OR w.missing_quantity) AS margin_known
        FROM walk w
        GROUP BY 1
    ),
    -- One place builds a seller row, so the four rankings and the unknown list
    -- can never disagree about what a row contains. `marginDzd` is NULL — not
    -- zero, not the revenue — whenever the margin is unknown.
    shaped AS (
        SELECT
            v.canonical_key,
            v.quantity,
            CASE WHEN v.margin_known THEN v.revenue - v.cogs END AS margin,
            jsonb_build_object(
                'canonicalKey',       v.canonical_key,
                'label',              v.label,
                'quantitySold',       v.quantity::text,
                'revenueDzd',         round(v.revenue, 2)::text,
                'cogsDzd',            CASE WHEN v.margin_known
                                           THEN round(v.cogs, 2)::text END,
                'marginDzd',          CASE WHEN v.margin_known
                                           THEN round(v.revenue - v.cogs, 2)::text END,
                'marginKnown',        v.margin_known,
                'saleLineCount',      v.line_count,
                'linesWithoutCostCount', v.lines_without_cost
            ) AS row_json,
            v.margin_known
        FROM variant v
    )
    SELECT jsonb_build_object(
        'variantCount',      (SELECT count(*) FROM shaped),
        'marginKnownCount',  (SELECT count(*) FROM shaped WHERE margin_known),
        'marginUnknownCount',(SELECT count(*) FROM shaped WHERE NOT margin_known),
        'rankingSize',       10,
        'bestByQuantity', (
            SELECT coalesce(jsonb_agg(q.row_json ORDER BY q.ord), '[]'::jsonb)
            FROM (
                SELECT s.row_json,
                       row_number() OVER (ORDER BY s.quantity DESC, s.canonical_key) AS ord
                FROM shaped s
            ) q
            WHERE q.ord <= 10
        ),
        'worstByQuantity', (
            SELECT coalesce(jsonb_agg(q.row_json ORDER BY q.ord), '[]'::jsonb)
            FROM (
                SELECT s.row_json,
                       row_number() OVER (ORDER BY s.quantity ASC, s.canonical_key) AS ord
                FROM shaped s
            ) q
            WHERE q.ord <= 10
        ),
        'bestByMargin', (
            SELECT coalesce(jsonb_agg(q.row_json ORDER BY q.ord), '[]'::jsonb)
            FROM (
                SELECT s.row_json,
                       row_number() OVER (ORDER BY s.margin DESC, s.canonical_key) AS ord
                FROM shaped s
                WHERE s.margin_known
            ) q
            WHERE q.ord <= 10
        ),
        'worstByMargin', (
            SELECT coalesce(jsonb_agg(q.row_json ORDER BY q.ord), '[]'::jsonb)
            FROM (
                SELECT s.row_json,
                       row_number() OVER (ORDER BY s.margin ASC, s.canonical_key) AS ord
                FROM shaped s
                WHERE s.margin_known
            ) q
            WHERE q.ord <= 10
        ),
        'unknownMargin', (
            SELECT coalesce(jsonb_agg(s.row_json
                            ORDER BY s.quantity DESC, s.canonical_key), '[]'::jsonb)
            FROM shaped s
            WHERE NOT s.margin_known
        )
    );
$$;

-- Report 7 — supplier debt and expenses.
--
-- Supplier debt has exactly the shape of customer debt: one lifetime balance
-- per supplier, because the paper records no partial payment and no due date.
--
-- Expenses are grouped by the category the customer actually wrote in the
-- `Custom Details` column. There is no expense taxonomy in this product and
-- inventing one would relabel his own words, so the free text IS the grouping
-- key, verbatim.
CREATE OR REPLACE FUNCTION onboarding.historical_report_supplier_debt_and_expenses(
    p_batch_id bigint,
    p_date_from date,
    p_date_to date
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = pg_catalog
AS $$
    WITH scoped AS (
        SELECT *
        FROM onboarding.historical_report_lines r
        WHERE r.batch_id = p_batch_id
          AND (p_date_from IS NULL OR r.transaction_date >= p_date_from)
          AND (p_date_to   IS NULL OR r.transaction_date <= p_date_to)
    ),
    supplier AS (
        SELECT
            coalesce(nullif(btrim(s.party_company), ''), '') AS party,
            sum(s.effective_line_total_dzd)::numeric         AS total_value,
            count(DISTINCT s.transaction_id)                 AS transaction_count,
            min(s.transaction_date)                          AS oldest,
            max(s.transaction_date)                          AS newest
        FROM scoped s
        WHERE s.transaction_type = 'PURCHASE'
          AND s.payment_status = 'UNPAID'
        GROUP BY 1
    ),
    expense AS (
        SELECT
            coalesce(nullif(btrim(s.custom_details), ''), '') AS category,
            sum(s.effective_line_total_dzd)::numeric          AS total_value,
            coalesce(sum(s.effective_line_total_dzd)
                     FILTER (WHERE s.payment_status = 'UNPAID'), 0)::numeric AS unpaid_value,
            count(*)                                          AS line_count,
            count(DISTINCT s.transaction_id)                  AS transaction_count
        FROM scoped s
        WHERE s.transaction_type = 'EXPENSE'
        GROUP BY 1
    )
    SELECT jsonb_build_object(
        'supplier', jsonb_build_object(
            'rows', (
                SELECT coalesce(jsonb_agg(jsonb_build_object(
                            'party',            nullif(u.party, ''),
                            'balanceDzd',       round(u.total_value, 2)::text,
                            'transactionCount', u.transaction_count,
                            'oldestDate',       u.oldest,
                            'newestDate',       u.newest
                        ) ORDER BY u.total_value DESC, u.party), '[]'::jsonb)
                FROM supplier u
            ),
            'totalDzd',   (SELECT round(coalesce(sum(total_value), 0), 2)::text FROM supplier),
            'partyCount', (SELECT count(*) FROM supplier WHERE party <> ''),
            'unspecifiedPartyBalanceDzd',
                (SELECT round(coalesce(sum(total_value), 0), 2)::text FROM supplier WHERE party = ''),
            'transactionCount', (SELECT coalesce(sum(transaction_count), 0) FROM supplier),
            'hasPartialPayments', false,
            'hasAgeing', false
        ),
        'expenses', jsonb_build_object(
            'rows', (
                SELECT coalesce(jsonb_agg(jsonb_build_object(
                            'category',         nullif(e.category, ''),
                            'totalDzd',         round(e.total_value, 2)::text,
                            'unpaidDzd',        round(e.unpaid_value, 2)::text,
                            'lineCount',        e.line_count,
                            'transactionCount', e.transaction_count
                        ) ORDER BY e.total_value DESC, e.category), '[]'::jsonb)
                FROM expense e
            ),
            'totalDzd',       (SELECT round(coalesce(sum(total_value), 0), 2)::text FROM expense),
            'unpaidTotalDzd', (SELECT round(coalesce(sum(unpaid_value), 0), 2)::text FROM expense),
            'categoryCount',  (SELECT count(*) FROM expense WHERE category <> ''),
            'lineCount',      (SELECT coalesce(sum(line_count), 0) FROM expense),
            'uncategorizedTotalDzd',
                (SELECT round(coalesce(sum(total_value), 0), 2)::text FROM expense WHERE category = ''),
            'hasCategoryTaxonomy', false
        )
    );
$$;

-- Report 8 — stock on hand and its value.
--
-- The closing pools of the same single chronological walk that produced the
-- cost of goods sold. The date range deliberately does NOT apply: a stock level
-- is a position, not a flow, and the only position this data can support is the
-- one after the last transaction the customer transcribed. `asOfDate` says so
-- explicitly and `dateRangeApplies` is false so the screen can say it too.
--
-- The payload carries its own proof: total purchased = total cost of goods sold
-- + closing stock value, to the exact dinar, from the UNROUNDED walk. That
-- identity is an internal-consistency check, not a displayed total, so it is
-- deliberately computed from the unrounded figures rather than from the rounded
-- monthly rows the profit headline sums.
CREATE OR REPLACE FUNCTION onboarding.historical_report_stock_valuation(
    p_batch_id bigint,
    p_date_from date,
    p_date_to date
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = pg_catalog
AS $$
    WITH walk AS (
        SELECT * FROM onboarding.historical_wac_walk(p_batch_id)
    ),
    pool AS (
        SELECT
            w.canonical_key,
            onboarding.historical_variant_label(w.canonical_key) AS label,
            w.quantity,
            w.cost_dzd AS value_dzd,
            w.wac_at_sale AS unit_cost
        FROM walk w
        WHERE w.row_kind = 'CLOSING_POOL'
    ),
    cogs AS (
        SELECT coalesce(sum(w.cost_dzd), 0) AS total
        FROM walk w
        WHERE w.row_kind = 'SALE_LINE'
    ),
    purchased AS (
        SELECT coalesce(sum(r.effective_line_total_dzd), 0)::numeric AS total
        FROM onboarding.historical_report_lines r
        WHERE r.batch_id = p_batch_id
          AND r.transaction_type = 'PURCHASE'
          AND r.canonical_key <> '||'
    )
    SELECT jsonb_build_object(
        'asOfDate', (
            SELECT max(t.transaction_date)
            FROM onboarding.historical_trade_transactions t
            WHERE t.batch_id = p_batch_id
        ),
        'dateRangeApplies', false,
        'rows', (
            SELECT coalesce(jsonb_agg(jsonb_build_object(
                        'canonicalKey', p.canonical_key,
                        'label',        p.label,
                        'quantity',     p.quantity::text,
                        'valueDzd',     round(p.value_dzd, 2)::text,
                        'unitCostDzd',  CASE WHEN p.quantity > 0
                                             THEN round(p.value_dzd / p.quantity, 2)::text END
                    ) ORDER BY p.value_dzd DESC, p.canonical_key), '[]'::jsonb)
            FROM pool p
        ),
        'variantCount',   (SELECT count(*) FROM pool),
        'totalQuantity',  (SELECT coalesce(sum(quantity), 0)::text FROM pool),
        'totalValueDzd',  (SELECT round(coalesce(sum(value_dzd), 0), 2)::text FROM pool),
        -- The balance proof, from unrounded figures.
        'totalPurchasedDzd', (SELECT round(total, 2)::text FROM purchased),
        'totalCogsDzd',      (SELECT round(total, 2)::text FROM cogs),
        'balanceResidualDzd', (
            SELECT round((SELECT total FROM purchased)
                         - (SELECT total FROM cogs)
                         - coalesce(sum(p.value_dzd), 0), 2)::text
            FROM pool p
        ),
        'balances', (
            SELECT (SELECT total FROM purchased)
                   - (SELECT total FROM cogs)
                   - coalesce(sum(p.value_dzd), 0) = 0
            FROM pool p
        )
    );
$$;

-- Report 6 — customer debt. One lifetime balance per customer. The paper has no
-- partial-payment concept and no invoice ageing, so this is deliberately a
-- single figure per customer: everything they have not paid, ever. Inventing
-- ageing buckets the source data cannot support would be a lie, so the payload
-- states the absence explicitly rather than leaving it to the UI.
CREATE OR REPLACE FUNCTION onboarding.historical_report_customer_debt(
    p_batch_id bigint,
    p_date_from date,
    p_date_to date
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = pg_catalog
AS $$
    WITH unpaid AS (
        SELECT
            coalesce(nullif(btrim(r.party_company), ''), '') AS party,
            sum(r.effective_line_total_dzd)::numeric         AS total_value,
            count(DISTINCT r.transaction_id)                 AS transaction_count,
            min(r.transaction_date)                          AS oldest,
            max(r.transaction_date)                          AS newest
        FROM onboarding.historical_report_lines r
        WHERE r.batch_id = p_batch_id
          AND r.transaction_type = 'SALE'
          AND r.payment_status = 'UNPAID'
          AND (p_date_from IS NULL OR r.transaction_date >= p_date_from)
          AND (p_date_to   IS NULL OR r.transaction_date <= p_date_to)
        GROUP BY 1
    )
    SELECT jsonb_build_object(
        'rows', (
            SELECT coalesce(jsonb_agg(jsonb_build_object(
                        'party',            nullif(u.party, ''),
                        'balanceDzd',       round(u.total_value, 2)::text,
                        'transactionCount', u.transaction_count,
                        'oldestDate',       u.oldest,
                        'newestDate',       u.newest
                    ) ORDER BY u.total_value DESC, u.party), '[]'::jsonb)
            FROM unpaid u
        ),
        'totalDzd',   (SELECT round(coalesce(sum(total_value), 0), 2)::text FROM unpaid),
        'partyCount', (SELECT count(*) FROM unpaid WHERE party <> ''),
        'unspecifiedPartyBalanceDzd',
            (SELECT round(coalesce(sum(total_value), 0), 2)::text FROM unpaid WHERE party = ''),
        'transactionCount', (SELECT coalesce(sum(transaction_count), 0) FROM unpaid),
        'hasPartialPayments', false,
        'hasAgeing', false
    );
$$;

REVOKE ALL ON FUNCTION onboarding.historical_report_profit_and_loss(bigint, date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION onboarding.historical_report_monthly_trend(bigint, date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION onboarding.historical_report_customer_debt(bigint, date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION onboarding.historical_report_purchases(bigint, date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION onboarding.historical_report_sales(bigint, date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION onboarding.historical_report_sellers(bigint, date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION onboarding.historical_report_supplier_debt_and_expenses(bigint, date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION onboarding.historical_report_stock_valuation(bigint, date, date) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 6. The single entry point
-- ---------------------------------------------------------------------------
-- One SECURITY DEFINER function is the entire attack surface of WS-I. It
-- validates the session and the permission, resolves the batch, enforces the
-- readiness gate, and only then dispatches to a read-only report above.
--
-- `canRender` is false and `report` is null whenever a report that DEPENDS ON
-- COST is asked for while the mapping is incomplete. The caller has nothing to
-- render a number from in that state — the refusal is structural, not a UI
-- convention. The list below is the whole gate, and it is a statement about
-- DATA DEPENDENCY, not about which report is important.

CREATE OR REPLACE FUNCTION onboarding.get_historical_report(
    p_session_token text,
    p_report_code text,
    p_batch_id bigint,
    p_date_from date,
    p_date_to date
)
RETURNS jsonb
LANGUAGE plpgsql
-- STABLE, not the plpgsql default VOLATILE: this function cannot write, and
-- saying so in the catalogue makes that checkable rather than a claim.
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_batch_id  bigint;
    v_code      text;
    v_readiness jsonb;
    v_report    jsonb := NULL;
    v_can       boolean;
    v_needs_cost boolean;
BEGIN
    PERFORM 1
    FROM iam.resolve_session_with_permission(
        p_session_token,
        'REVIEW_HISTORICAL_FINANCE_IMPORT'
    );

    v_code := upper(btrim(coalesce(p_report_code, '')));
    IF v_code NOT IN (
        'PROFIT_AND_LOSS', 'MONTHLY_TREND', 'CUSTOMER_DEBT',
        'PURCHASES', 'SALES', 'SELLERS',
        'SUPPLIER_DEBT_AND_EXPENSES', 'STOCK_VALUATION'
    ) THEN
        RAISE EXCEPTION 'unknown historical report' USING ERRCODE = '22023';
    END IF;

    IF p_date_from IS NOT NULL AND p_date_to IS NOT NULL AND p_date_from > p_date_to THEN
        RAISE EXCEPTION 'invalid historical finance report period' USING ERRCODE = '22023';
    END IF;

    IF p_batch_id IS NULL THEN
        -- No batch named: the most recent one that actually holds transcribed
        -- trade rows, which is what an operator means by "the import".
        SELECT max(t.batch_id) INTO v_batch_id
        FROM onboarding.historical_trade_transactions t;
    ELSE
        IF p_batch_id <= 0 THEN
            RAISE EXCEPTION 'invalid historical finance batch' USING ERRCODE = '22023';
        END IF;
        v_batch_id := p_batch_id;
    END IF;

    IF v_batch_id IS NULL THEN
        RETURN jsonb_build_object(
            'batchId', NULL,
            'reportCode', v_code,
            'dateFrom', p_date_from,
            'dateTo', p_date_to,
            'readiness', NULL,
            'canRender', false,
            'refusalReason', 'NO_BATCH',
            'report', NULL
        );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM onboarding.historical_finance_batches WHERE id = v_batch_id) THEN
        RAISE EXCEPTION 'unknown historical finance batch' USING ERRCODE = '22023';
    END IF;

    v_readiness := onboarding.historical_mapping_readiness_internal(v_batch_id);

    -- Gated because the figure is derived from a purchase cost, and an
    -- unresolved description has no cost source. Everything else reads amounts,
    -- parties and payment status only, which no mapping decision can change.
    v_needs_cost := v_code IN
        ('PROFIT_AND_LOSS', 'MONTHLY_TREND', 'SELLERS', 'STOCK_VALUATION');
    v_can := (NOT v_needs_cost)
             OR coalesce((v_readiness->>'isComplete')::boolean, false);

    IF v_can THEN
        v_report := CASE v_code
            WHEN 'PROFIT_AND_LOSS' THEN
                onboarding.historical_report_profit_and_loss(v_batch_id, p_date_from, p_date_to)
            WHEN 'MONTHLY_TREND' THEN
                onboarding.historical_report_monthly_trend(v_batch_id, p_date_from, p_date_to)
            WHEN 'CUSTOMER_DEBT' THEN
                onboarding.historical_report_customer_debt(v_batch_id, p_date_from, p_date_to)
            WHEN 'PURCHASES' THEN
                onboarding.historical_report_purchases(v_batch_id, p_date_from, p_date_to)
            WHEN 'SALES' THEN
                onboarding.historical_report_sales(v_batch_id, p_date_from, p_date_to)
            WHEN 'SELLERS' THEN
                onboarding.historical_report_sellers(v_batch_id, p_date_from, p_date_to)
            WHEN 'SUPPLIER_DEBT_AND_EXPENSES' THEN
                onboarding.historical_report_supplier_debt_and_expenses(v_batch_id, p_date_from, p_date_to)
            WHEN 'STOCK_VALUATION' THEN
                onboarding.historical_report_stock_valuation(v_batch_id, p_date_from, p_date_to)
        END;
    END IF;

    RETURN jsonb_build_object(
        'batchId', v_batch_id,
        'reportCode', v_code,
        'dateFrom', p_date_from,
        'dateTo', p_date_to,
        'readiness', v_readiness,
        'canRender', v_can,
        'refusalReason', CASE WHEN v_can THEN NULL ELSE 'MAPPING_INCOMPLETE' END,
        'report', v_report
    );
END;
$$;

COMMENT ON FUNCTION onboarding.get_historical_report(text, text, bigint, date, date) IS
    'WS-I: the single read-only entry point for the historical financial reports. A report that consumes a purchase cost refuses to return a number while the product mapping is incomplete.';

-- The date span actually available, so the range filter can offer real bounds
-- instead of asking the operator to guess.
CREATE OR REPLACE FUNCTION onboarding.get_historical_report_scope(
    p_session_token text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_result jsonb;
BEGIN
    PERFORM 1
    FROM iam.resolve_session_with_permission(
        p_session_token,
        'REVIEW_HISTORICAL_FINANCE_IMPORT'
    );

    SELECT jsonb_build_object(
        'batchId', t.batch_id,
        'status', b.status,
        'minDate', min(t.transaction_date),
        'maxDate', max(t.transaction_date),
        'transactionCount', count(*)
    )
    INTO v_result
    FROM onboarding.historical_trade_transactions t
    JOIN onboarding.historical_finance_batches b ON b.id = t.batch_id
    WHERE t.batch_id = (SELECT max(batch_id) FROM onboarding.historical_trade_transactions)
    GROUP BY t.batch_id, b.status;

    RETURN coalesce(v_result, jsonb_build_object(
        'batchId', NULL, 'status', NULL, 'minDate', NULL,
        'maxDate', NULL, 'transactionCount', 0
    ));
END;
$$;

REVOKE ALL ON FUNCTION onboarding.get_historical_report(text, text, bigint, date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION onboarding.get_historical_report_scope(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION onboarding.get_historical_report(text, text, bigint, date, date)
    TO stockiha_runtime, stockiha_admin;
GRANT EXECUTE ON FUNCTION onboarding.get_historical_report_scope(text)
    TO stockiha_runtime, stockiha_admin;

UPDATE operations.schema_state
SET migration_version = 20260829090000,
    updated_at = now()
WHERE singleton;

RESET ROLE;
