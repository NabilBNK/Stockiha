-- WS-N-1: Performance benchmark script for Dashboard Calculation Engine
-- Designed to be run against a dedicated scratch database stockiha_ws_n_perf.
-- DO NOT RUN AGAINST stockiha_acceptance.
\set ON_ERROR_STOP on

DO $$
BEGIN
    IF current_database() <> 'stockiha_ws_n_perf' THEN
        RAISE EXCEPTION 'This script must ONLY be run against scratch database stockiha_ws_n_perf (current: %)', current_database();
    END IF;
END;
$$;

-- Benchmarking queries for 12 public dashboard functions
\timing on

-- P1: dashboard_period
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM core.dashboard_period('wsnadmin', 'today', NULL, NULL);

-- P2: dashboard_money_summary
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM core.dashboard_money_summary('wsnadmin', CURRENT_DATE, CURRENT_DATE, CURRENT_DATE - 1, CURRENT_DATE - 1, NULL);

-- P3: dashboard_stock_summary
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM core.dashboard_stock_summary('wsnadmin', 90);

-- P4: dashboard_stock_items
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM core.dashboard_stock_items('wsnadmin', 'low', 90, 25, 0);

-- P5: dashboard_top_items
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM core.dashboard_top_items('wsnadmin', CURRENT_DATE, CURRENT_DATE, 5);

-- P6: dashboard_top_customers
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM core.dashboard_top_customers('wsnadmin', CURRENT_DATE, CURRENT_DATE);

-- P7: dashboard_top_debtors
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM core.dashboard_top_debtors('wsnadmin');

-- P8: dashboard_latest_sales
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM core.dashboard_latest_sales('wsnadmin');

-- P9: dashboard_sales_series
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM core.dashboard_sales_series('wsnadmin', CURRENT_DATE, CURRENT_DATE, 'HOUR');

-- P10: dashboard_sales_by_category
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM core.dashboard_sales_by_category('wsnadmin', CURRENT_DATE, CURRENT_DATE);

-- P11: dashboard_busy_hours
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM core.dashboard_busy_hours('wsnadmin', CURRENT_DATE, CURRENT_DATE);

-- P12: dashboard_receivables_aging
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM core.dashboard_receivables_aging('wsnadmin');

\timing off
