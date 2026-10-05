-- WS-N-1: SQL helper unit test suite (H1..H6)
-- Tests pure helpers that require no business data.
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION pg_temp.expect_error(p_sql text, p_sqlstate text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    EXECUTE p_sql;
    RAISE EXCEPTION 'Expected SQLSTATE %, but no error was raised: %', p_sqlstate, p_sql;
EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> p_sqlstate THEN
        RAISE EXCEPTION 'Expected SQLSTATE %, got %: % (query: %)', p_sqlstate, SQLSTATE, SQLERRM, p_sql;
    END IF;
END;
$$;

DO $$
DECLARE
    v_rec record;
    v_kind text;
    v_pct numeric;
    v_bool boolean;
    v_ts timestamp;
BEGIN
    -- ========================================================================
    -- H1: _dashboard_period_bounds_at (all 18 rows of B.2 + errors)
    -- ========================================================================
    -- Row 1: today @ 2026-09-24 12:00+01
    SELECT * INTO v_rec FROM core._dashboard_period_bounds_at('today', NULL, NULL, '2026-09-24 12:00:00+01'::timestamptz);
    ASSERT v_rec.cur_from = '2026-09-24' AND v_rec.cur_to = '2026-09-24'
       AND v_rec.prev_from = '2026-09-23' AND v_rec.prev_to = '2026-09-23'
       AND v_rec.cut_time = '12:00:00'::time AND v_rec.bucket = 'HOUR' AND v_rec.today = '2026-09-24', 'H1.1 failed';

    -- Row 2: week @ 2026-09-24 12:00+01 (Thu)
    SELECT * INTO v_rec FROM core._dashboard_period_bounds_at('week', NULL, NULL, '2026-09-24 12:00:00+01'::timestamptz);
    ASSERT v_rec.cur_from = '2026-09-20' AND v_rec.cur_to = '2026-09-24'
       AND v_rec.prev_from = '2026-09-13' AND v_rec.prev_to = '2026-09-17'
       AND v_rec.cut_time = '12:00:00'::time AND v_rec.bucket = 'DAY' AND v_rec.today = '2026-09-24', 'H1.2 failed';

    -- Row 3: month @ 2026-09-24 12:00+01
    SELECT * INTO v_rec FROM core._dashboard_period_bounds_at('month', NULL, NULL, '2026-09-24 12:00:00+01'::timestamptz);
    ASSERT v_rec.cur_from = '2026-09-01' AND v_rec.cur_to = '2026-09-24'
       AND v_rec.prev_from = '2026-08-01' AND v_rec.prev_to = '2026-08-24'
       AND v_rec.cut_time = '12:00:00'::time AND v_rec.bucket = 'DAY' AND v_rec.today = '2026-09-24', 'H1.3 failed';

    -- Row 4: year @ 2026-09-24 12:00+01
    SELECT * INTO v_rec FROM core._dashboard_period_bounds_at('year', NULL, NULL, '2026-09-24 12:00:00+01'::timestamptz);
    ASSERT v_rec.cur_from = '2026-01-01' AND v_rec.cur_to = '2026-09-24'
       AND v_rec.prev_from = '2025-01-01' AND v_rec.prev_to = '2025-09-24'
       AND v_rec.cut_time = '12:00:00'::time AND v_rec.bucket = 'MONTH' AND v_rec.today = '2026-09-24', 'H1.4 failed';

    -- Row 5: custom @ 2026-09-24 12:00+01, [2026-09-01, 2026-09-15]
    SELECT * INTO v_rec FROM core._dashboard_period_bounds_at('custom', '2026-09-01', '2026-09-15', '2026-09-24 12:00:00+01'::timestamptz);
    ASSERT v_rec.cur_from = '2026-09-01' AND v_rec.cur_to = '2026-09-15'
       AND v_rec.prev_from = '2026-08-17' AND v_rec.prev_to = '2026-08-31'
       AND v_rec.cut_time IS NULL AND v_rec.bucket = 'DAY' AND v_rec.today = '2026-09-24', 'H1.5 failed';

    -- Row 6: custom @ 2026-09-24 12:00+01, [2026-06-01, 2026-09-24]
    SELECT * INTO v_rec FROM core._dashboard_period_bounds_at('custom', '2026-06-01', '2026-09-24', '2026-09-24 12:00:00+01'::timestamptz);
    ASSERT v_rec.cur_from = '2026-06-01' AND v_rec.cur_to = '2026-09-24'
       AND v_rec.prev_from = '2026-02-05' AND v_rec.prev_to = '2026-05-31'
       AND v_rec.cut_time = '12:00:00'::time AND v_rec.bucket = 'MONTH' AND v_rec.today = '2026-09-24', 'H1.6 failed';

    -- Row 7: month @ 2026-03-31 10:00+01
    SELECT * INTO v_rec FROM core._dashboard_period_bounds_at('month', NULL, NULL, '2026-03-31 10:00:00+01'::timestamptz);
    ASSERT v_rec.cur_from = '2026-03-01' AND v_rec.cur_to = '2026-03-31'
       AND v_rec.prev_from = '2026-02-01' AND v_rec.prev_to = '2026-02-28'
       AND v_rec.cut_time IS NULL AND v_rec.bucket = 'DAY' AND v_rec.today = '2026-03-31', 'H1.7 failed';

    -- Row 8: month @ 2028-03-30 10:00+01
    SELECT * INTO v_rec FROM core._dashboard_period_bounds_at('month', NULL, NULL, '2028-03-30 10:00:00+01'::timestamptz);
    ASSERT v_rec.cur_from = '2028-03-01' AND v_rec.cur_to = '2028-03-30'
       AND v_rec.prev_from = '2028-02-01' AND v_rec.prev_to = '2028-02-29'
       AND v_rec.cut_time IS NULL AND v_rec.bucket = 'DAY' AND v_rec.today = '2028-03-30', 'H1.8 failed';

    -- Row 9: year @ 2028-02-29 09:00+01
    SELECT * INTO v_rec FROM core._dashboard_period_bounds_at('year', NULL, NULL, '2028-02-29 09:00:00+01'::timestamptz);
    ASSERT v_rec.cur_from = '2028-01-01' AND v_rec.cur_to = '2028-02-29'
       AND v_rec.prev_from = '2027-01-01' AND v_rec.prev_to = '2027-02-28'
       AND v_rec.cut_time IS NULL AND v_rec.bucket = 'DAY' AND v_rec.today = '2028-02-29', 'H1.9 failed';

    -- Row 10: week @ 2026-09-27 08:00+01 (Sun)
    SELECT * INTO v_rec FROM core._dashboard_period_bounds_at('week', NULL, NULL, '2026-09-27 08:00:00+01'::timestamptz);
    ASSERT v_rec.cur_from = '2026-09-27' AND v_rec.cur_to = '2026-09-27'
       AND v_rec.prev_from = '2026-09-20' AND v_rec.prev_to = '2026-09-20'
       AND v_rec.cut_time = '08:00:00'::time AND v_rec.bucket = 'HOUR' AND v_rec.today = '2026-09-27', 'H1.10 failed';

    -- Row 11: month @ 2026-10-01 09:00+01
    SELECT * INTO v_rec FROM core._dashboard_period_bounds_at('month', NULL, NULL, '2026-10-01 09:00:00+01'::timestamptz);
    ASSERT v_rec.cur_from = '2026-10-01' AND v_rec.cur_to = '2026-10-01'
       AND v_rec.prev_from = '2026-09-01' AND v_rec.prev_to = '2026-09-01'
       AND v_rec.cut_time = '09:00:00'::time AND v_rec.bucket = 'HOUR' AND v_rec.today = '2026-10-01', 'H1.11 failed';

    -- Row 12: custom @ 2026-09-24 12:00+01, [2026-09-10, 2026-09-10]
    SELECT * INTO v_rec FROM core._dashboard_period_bounds_at('custom', '2026-09-10', '2026-09-10', '2026-09-24 12:00:00+01'::timestamptz);
    ASSERT v_rec.cur_from = '2026-09-10' AND v_rec.cur_to = '2026-09-10'
       AND v_rec.prev_from = '2026-09-09' AND v_rec.prev_to = '2026-09-09'
       AND v_rec.cut_time IS NULL AND v_rec.bucket = 'HOUR' AND v_rec.today = '2026-09-24', 'H1.12 failed';

    -- Row 13: custom @ 2026-09-24 12:00+01, [2026-07-25, 2026-09-24] (62 days)
    SELECT * INTO v_rec FROM core._dashboard_period_bounds_at('custom', '2026-07-25', '2026-09-24', '2026-09-24 12:00:00+01'::timestamptz);
    ASSERT v_rec.cur_from = '2026-07-25' AND v_rec.cur_to = '2026-09-24'
       AND v_rec.prev_from = '2026-05-24' AND v_rec.prev_to = '2026-07-24'
       AND v_rec.cut_time = '12:00:00'::time AND v_rec.bucket = 'DAY' AND v_rec.today = '2026-09-24', 'H1.13 failed';

    -- Row 14: custom @ 2026-09-24 12:00+01, [2026-07-24, 2026-09-24] (63 days)
    SELECT * INTO v_rec FROM core._dashboard_period_bounds_at('custom', '2026-07-24', '2026-09-24', '2026-09-24 12:00:00+01'::timestamptz);
    ASSERT v_rec.cur_from = '2026-07-24' AND v_rec.cur_to = '2026-09-24'
       AND v_rec.prev_from = '2026-05-22' AND v_rec.prev_to = '2026-07-23'
       AND v_rec.cut_time = '12:00:00'::time AND v_rec.bucket = 'MONTH' AND v_rec.today = '2026-09-24', 'H1.14 failed';

    -- Row 15: week @ 2026-10-03 18:30+01 (Sat)
    SELECT * INTO v_rec FROM core._dashboard_period_bounds_at('week', NULL, NULL, '2026-10-03 18:30:00+01'::timestamptz);
    ASSERT v_rec.cur_from = '2026-09-27' AND v_rec.cur_to = '2026-10-03'
       AND v_rec.prev_from = '2026-09-20' AND v_rec.prev_to = '2026-09-26'
       AND v_rec.cut_time = '18:30:00'::time AND v_rec.bucket = 'DAY' AND v_rec.today = '2026-10-03', 'H1.15 failed';

    -- Row 16: today @ '2026-09-23 23:30:00+00'::timestamptz (UTC) -> in Algiers (+01) is 2026-09-24 00:30:00
    SELECT * INTO v_rec FROM core._dashboard_period_bounds_at('today', NULL, NULL, '2026-09-23 23:30:00+00'::timestamptz);
    ASSERT v_rec.cur_from = '2026-09-24' AND v_rec.cur_to = '2026-09-24'
       AND v_rec.prev_from = '2026-09-23' AND v_rec.prev_to = '2026-09-23'
       AND v_rec.cut_time = '00:30:00'::time AND v_rec.bucket = 'HOUR' AND v_rec.today = '2026-09-24', 'H1.16 failed';

    -- Row 17: month @ 2026-03-28 10:00+01
    SELECT * INTO v_rec FROM core._dashboard_period_bounds_at('month', NULL, NULL, '2026-03-28 10:00:00+01'::timestamptz);
    ASSERT v_rec.cur_from = '2026-03-01' AND v_rec.cur_to = '2026-03-28'
       AND v_rec.prev_from = '2026-02-01' AND v_rec.prev_to = '2026-02-28'
       AND v_rec.cut_time = '10:00:00'::time AND v_rec.bucket = 'DAY' AND v_rec.today = '2026-03-28', 'H1.17 failed';

    -- Row 18: month @ 2026-01-15 10:00+01
    SELECT * INTO v_rec FROM core._dashboard_period_bounds_at('month', NULL, NULL, '2026-01-15 10:00:00+01'::timestamptz);
    ASSERT v_rec.cur_from = '2026-01-01' AND v_rec.cur_to = '2026-01-15'
       AND v_rec.prev_from = '2025-12-01' AND v_rec.prev_to = '2025-12-15'
       AND v_rec.cut_time = '10:00:00'::time AND v_rec.bucket = 'DAY' AND v_rec.today = '2026-01-15', 'H1.18 failed';

    -- Errors for H1
    PERFORM pg_temp.expect_error('SELECT * FROM core._dashboard_period_bounds_at(''decade'', NULL, NULL, now())', '22023');
    PERFORM pg_temp.expect_error('SELECT * FROM core._dashboard_period_bounds_at(''custom'', NULL, ''2026-09-24'', now())', '22023');
    PERFORM pg_temp.expect_error('SELECT * FROM core._dashboard_period_bounds_at(''custom'', ''2026-09-01'', NULL, now())', '22023');
    PERFORM pg_temp.expect_error('SELECT * FROM core._dashboard_period_bounds_at(''custom'', ''2026-09-30'', ''2026-09-01'', ''2026-09-24 12:00:00+01''::timestamptz)', '22023');
    PERFORM pg_temp.expect_error('SELECT * FROM core._dashboard_period_bounds_at(''custom'', ''2026-09-01'', ''2026-09-25'', ''2026-09-24 12:00:00+01''::timestamptz)', '22023');
    PERFORM pg_temp.expect_error('SELECT * FROM core._dashboard_period_bounds_at(''custom'', ''1999-12-31'', ''2026-09-24'', ''2026-09-24 12:00:00+01''::timestamptz)', '22023');

    -- ========================================================================
    -- H2: _dashboard_change (all 14 rows of C.1)
    -- ========================================================================
    SELECT kind, pct INTO v_kind, v_pct FROM core._dashboard_change(58500, 0);
    ASSERT v_kind = 'NO_BASE' AND v_pct IS NULL, 'H2.1 failed';

    SELECT kind, pct INTO v_kind, v_pct FROM core._dashboard_change(0, 0);
    ASSERT v_kind = 'NONE' AND v_pct IS NULL, 'H2.2 failed';

    SELECT kind, pct INTO v_kind, v_pct FROM core._dashboard_change(8500, 36000);
    ASSERT v_kind = 'DOWN' AND v_pct = -76.4, 'H2.3 failed';

    SELECT kind, pct INTO v_kind, v_pct FROM core._dashboard_change(100, 100);
    ASSERT v_kind = 'FLAT' AND v_pct = 0.0, 'H2.4 failed';

    SELECT kind, pct INTO v_kind, v_pct FROM core._dashboard_change(500, -1000);
    ASSERT v_kind = 'UP' AND v_pct = 150.0, 'H2.5 failed';

    SELECT kind, pct INTO v_kind, v_pct FROM core._dashboard_change(-200, 100);
    ASSERT v_kind = 'DOWN' AND v_pct = -300.0, 'H2.6 failed';

    SELECT kind, pct INTO v_kind, v_pct FROM core._dashboard_change(100.04, 100);
    ASSERT v_kind = 'FLAT' AND v_pct = 0.0, 'H2.7 failed';

    SELECT kind, pct INTO v_kind, v_pct FROM core._dashboard_change(51500, 2000);
    ASSERT v_kind = 'UP' AND v_pct = 2475.0, 'H2.8 failed';

    SELECT kind, pct INTO v_kind, v_pct FROM core._dashboard_change(0, 2000);
    ASSERT v_kind = 'DOWN' AND v_pct = -100.0, 'H2.9 failed';

    SELECT kind, pct INTO v_kind, v_pct FROM core._dashboard_change(10, 3);
    ASSERT v_kind = 'UP' AND v_pct = 233.3, 'H2.10 failed';

    SELECT kind, pct INTO v_kind, v_pct FROM core._dashboard_change(2, 3);
    ASSERT v_kind = 'DOWN' AND v_pct = -33.3, 'H2.11 failed';

    SELECT kind, pct INTO v_kind, v_pct FROM core._dashboard_change(-50, -100);
    ASSERT v_kind = 'UP' AND v_pct = 50.0, 'H2.12 failed';

    SELECT kind, pct INTO v_kind, v_pct FROM core._dashboard_change(-150, -100);
    ASSERT v_kind = 'DOWN' AND v_pct = -50.0, 'H2.13 failed';

    SELECT kind, pct INTO v_kind, v_pct FROM core._dashboard_change(NULL, 5);
    ASSERT v_kind = 'DOWN' AND v_pct = -100.0, 'H2.14 failed';

    -- ========================================================================
    -- H3: _dashboard_in_window (all 7 rows of C.2)
    -- ========================================================================
    SELECT core._dashboard_in_window('2026-08-24', '11:59:00'::time, '2026-08-01', '2026-08-24', '12:00:00'::time) INTO v_bool;
    ASSERT v_bool = true, 'H3.1 failed';

    SELECT core._dashboard_in_window('2026-08-24', '12:00:00'::time, '2026-08-01', '2026-08-24', '12:00:00'::time) INTO v_bool;
    ASSERT v_bool = true, 'H3.2 failed';

    SELECT core._dashboard_in_window('2026-08-24', '12:00:01'::time, '2026-08-01', '2026-08-24', '12:00:00'::time) INTO v_bool;
    ASSERT v_bool = false, 'H3.3 failed';

    SELECT core._dashboard_in_window('2026-08-23', '23:00:00'::time, '2026-08-01', '2026-08-24', '12:00:00'::time) INTO v_bool;
    ASSERT v_bool = true, 'H3.4 failed';

    SELECT core._dashboard_in_window('2026-08-25', '09:00:00'::time, '2026-08-01', '2026-08-24', '12:00:00'::time) INTO v_bool;
    ASSERT v_bool = false, 'H3.5 failed';

    SELECT core._dashboard_in_window('2026-07-31', '10:00:00'::time, '2026-08-01', '2026-08-24', '12:00:00'::time) INTO v_bool;
    ASSERT v_bool = false, 'H3.6 failed';

    SELECT core._dashboard_in_window('2026-08-24', '18:00:00'::time, '2026-08-01', '2026-08-24', NULL) INTO v_bool;
    ASSERT v_bool = true, 'H3.7 failed';

    -- ========================================================================
    -- H4: _dashboard_bucket_start (all rows of C.3 + WEEK error)
    -- ========================================================================
    SELECT core._dashboard_bucket_start('2026-09-24', '2026-09-24 09:45:10'::timestamp, 'HOUR') INTO v_ts;
    ASSERT v_ts = '2026-09-24 09:00:00'::timestamp, 'H4.1 failed';

    SELECT core._dashboard_bucket_start('2026-09-24', '2026-09-23 23:10:00'::timestamp, 'HOUR') INTO v_ts;
    ASSERT v_ts = '2026-09-24 23:00:00'::timestamp, 'H4.2 failed';

    SELECT core._dashboard_bucket_start('2026-09-05', '2026-09-05 17:20:00'::timestamp, 'DAY') INTO v_ts;
    ASSERT v_ts = '2026-09-05 00:00:00'::timestamp, 'H4.3 failed';

    SELECT core._dashboard_bucket_start('2026-09-05', '2026-09-05 17:20:00'::timestamp, 'MONTH') INTO v_ts;
    ASSERT v_ts = '2026-09-01 00:00:00'::timestamp, 'H4.4 failed';

    PERFORM pg_temp.expect_error('SELECT core._dashboard_bucket_start(''2026-09-05'', ''2026-09-05 17:20:00''::timestamp, ''WEEK'')', '22023');

    -- ========================================================================
    -- H5: _dashboard_age_bucket (all rows of C.4)
    -- ========================================================================
    ASSERT core._dashboard_age_bucket(-3) = '0_30', 'H5.-3 failed';
    ASSERT core._dashboard_age_bucket(0) = '0_30', 'H5.0 failed';
    ASSERT core._dashboard_age_bucket(30) = '0_30', 'H5.30 failed';
    ASSERT core._dashboard_age_bucket(31) = '31_60', 'H5.31 failed';
    ASSERT core._dashboard_age_bucket(60) = '31_60', 'H5.60 failed';
    ASSERT core._dashboard_age_bucket(61) = '61_90', 'H5.61 failed';
    ASSERT core._dashboard_age_bucket(90) = '61_90', 'H5.90 failed';
    ASSERT core._dashboard_age_bucket(91) = '91_PLUS', 'H5.91 failed';
    ASSERT core._dashboard_age_bucket(400) = '91_PLUS', 'H5.400 failed';

    -- ========================================================================
    -- H6: _dashboard_validate_window
    -- ========================================================================
    -- Valid window passes
    PERFORM core._dashboard_validate_window('2026-09-01', '2026-09-24', '2026-09-24');

    -- Invalid cases raise 22023
    PERFORM pg_temp.expect_error('SELECT core._dashboard_validate_window(NULL, ''2026-09-24'', ''2026-09-24'')', '22023');
    PERFORM pg_temp.expect_error('SELECT core._dashboard_validate_window(''2026-09-25'', ''2026-09-24'', ''2026-09-24'')', '22023');
    PERFORM pg_temp.expect_error('SELECT core._dashboard_validate_window(''1999-12-31'', ''2026-09-24'', ''2026-09-24'')', '22023');
    PERFORM pg_temp.expect_error('SELECT core._dashboard_validate_window(''2026-09-01'', ''2026-09-25'', ''2026-09-24'')', '22023');
END;
$$;
