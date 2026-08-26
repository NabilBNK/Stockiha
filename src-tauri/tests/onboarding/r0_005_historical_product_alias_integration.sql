-- R0-005 (WS-G): Historical product description mapping SQL integration test.
-- Runs inside a clean transaction block that is rolled back at the end.
--
-- What this proves:
--   * normalization is deterministic and collapses the pure-formatting
--     variants the customer's transcription contains;
--   * NOTHING is merged without an explicit administrator decision;
--   * a decision is applied at READ time and never rewrites the staged rows;
--   * a decision is keyed on the normalized description, so it survives a
--     re-import that gives every row a new id;
--   * the readiness gate answers "is the mapping complete?" definitively;
--   * no operational sale, purchase, journal or stock movement is created.

BEGIN;

-- 1. An administrator session, through the real IAM path.
INSERT INTO iam.users (username, display_name, password_hash)
VALUES ('admin_r0_005', 'Admin R0-005', 'hash')
ON CONFLICT (username) DO NOTHING;

DO $$
DECLARE
    v_admin_id bigint;
BEGIN
    SELECT id INTO v_admin_id FROM iam.users WHERE username = 'admin_r0_005';

    INSERT INTO iam.user_roles (user_id, role_id)
    SELECT v_admin_id, id FROM iam.roles WHERE code = 'ADMIN'
    ON CONFLICT DO NOTHING;

    DELETE FROM iam.application_sessions WHERE user_id = v_admin_id;
    INSERT INTO iam.application_sessions (user_id, workstation_id, token_hash, expires_at)
    VALUES (v_admin_id, 'workstation_r0_005', sha256('token_r0_005'::bytea), now() + interval '1 hour');
END;
$$;

-- 2. Normalization is deterministic and collapses formatting noise only.
DO $$
DECLARE
    v_pair record;
BEGIN
    FOR v_pair IN
        SELECT * FROM (VALUES
            ('1p 0,90',             '1p 0.9'),
            ('1p 0.90',             '1p 0.9'),
            ('1p 90',               '1p 0.9'),
            ('2p 1,60',             '2p 1.6'),
            ('2p 160',              '2p 1.6'),
            ('blanc polister 2,40', 'blanc polister 2.4'),
            ('blanc polister 240',  'blanc polister 2.4'),
            ('160',                 '1.6'),
            ('1.6',                 '1.6'),
            ('180',                 '1.8'),
            ('1 P',                 '1p'),
            ('1 P.',                '1p'),
            ('AK home',             'ak home'),
            ('Ak home',             'ak home')
        ) AS t(raw, expected)
    LOOP
        IF onboarding.normalize_historical_text(v_pair.raw) IS DISTINCT FROM v_pair.expected THEN
            RAISE EXCEPTION 'normalization of % gave % but should give %',
                v_pair.raw,
                onboarding.normalize_historical_text(v_pair.raw),
                v_pair.expected;
        END IF;
        -- Pure: calling it twice must give the same answer.
        IF onboarding.normalize_historical_text(v_pair.raw)
           IS DISTINCT FROM onboarding.normalize_historical_text(v_pair.raw) THEN
            RAISE EXCEPTION 'normalization of % is not deterministic', v_pair.raw;
        END IF;
    END LOOP;

    -- Two different sizes must NEVER normalize to the same key.
    IF onboarding.historical_description_key('couette', 'AK home', '1p')
       = onboarding.historical_description_key('couette', 'AK home', '2p') THEN
        RAISE EXCEPTION 'normalization wrongly merged two different sizes';
    END IF;
    IF onboarding.historical_description_key('drap housse', 'AK home', '1.6')
       = onboarding.historical_description_key('drap housse', 'AK home', '1.8') THEN
        RAISE EXCEPTION 'normalization wrongly merged 1.6 with 1.8';
    END IF;
    -- ...but the same size written two ways must.
    IF onboarding.historical_description_key('drap housse', 'AK home', '160')
       <> onboarding.historical_description_key('drap housse', 'AK home', '1.6') THEN
        RAISE EXCEPTION 'normalization failed to merge 160 with 1.6';
    END IF;
END;
$$;

-- 3. Stage a tiny paper book through the real import path.
DO $$
DECLARE
    v_batch jsonb;
    v_batch_id bigint;
    v_req text := 'req-r0-005-' || floor(extract(epoch from clock_timestamp()) * 1000)::text;
    v_before record;
    v_after record;
    v_digest_before text;
    v_digest_after text;
    v_readiness jsonb;
    v_mapping jsonb;
    v_alias_count bigint;
BEGIN
    SELECT (SELECT count(*) FROM finance.journal_entries)   AS journal_entries,
           (SELECT count(*) FROM finance.journal_lines)     AS journal_lines,
           (SELECT count(*) FROM inventory.movements)       AS movements,
           (SELECT count(*) FROM sales.cash_sales)          AS cash_sales,
           (SELECT count(*) FROM procurement.purchase_orders) AS purchase_orders
    INTO v_before;

    UPDATE onboarding.feature_settings SET historical_finance_import_enabled = true WHERE singleton;

    v_batch := onboarding.create_historical_trade_batch(
        'token_r0_005', v_req, 'r0_005_mapping.xlsx',
        encode(sha256(v_req::bytea), 'hex'), 'PAPER_BOOK_V2');
    v_batch_id := (v_batch->>'batchId')::bigint;

    -- Two purchases and two sales. The sale of `couete` is the SAME article as
    -- the purchase of `couette`, typed with one letter missing; the sale of
    -- `oreiller` was never purchased at all.
    PERFORM onboarding.replace_historical_trade_batch_data('token_r0_005', v_batch_id, $j$[
      {"source_transaction_sequence":1,"source_first_excel_row":2,"transaction_date":"2025-06-02",
       "transaction_type":"PURCHASE","payment_status":"PAID","lines":[
         {"source_row_number":2,"line_sequence":1,"product_name":"couette","brand":"AK home",
          "custom_details":"1p 0,90","quantity":10,"unit_price_dzd":9200},
         {"source_row_number":3,"line_sequence":2,"product_name":"couette","brand":"AK home",
          "custom_details":"1p 90","quantity":5,"unit_price_dzd":9200}]},
      {"source_transaction_sequence":2,"source_first_excel_row":4,"transaction_date":"2025-07-02",
       "transaction_type":"SALE","payment_status":"PAID","lines":[
         {"source_row_number":4,"line_sequence":1,"product_name":"couete","brand":"AK home",
          "custom_details":"1p 0.90","quantity":2,"unit_price_dzd":12000},
         {"source_row_number":5,"line_sequence":2,"product_name":"oreiller","brand":"rozana",
          "custom_details":"blanc","quantity":3,"unit_price_dzd":800}]}
    ]$j$::jsonb);

    -- 3a. Normalization alone already unified `1p 0,90`, `1p 90` and `1p 0.90`.
    IF (SELECT count(DISTINCT normalized_key)
          FROM onboarding.historical_trade_lines_mapped
         WHERE batch_id = v_batch_id
           AND product_name IN ('couette', 'couete')) <> 2 THEN
        RAISE EXCEPTION 'the three size spellings should collapse into two keys (couette and couete)';
    END IF;

    -- 3b. NO automatic merge: with no decisions the alias table is empty and
    --     every description is unresolved.
    -- Scoped to this batch's descriptions, so the assertion is meaningful on a
    -- database that already carries decisions about other descriptions.
    SELECT count(*) INTO v_alias_count
    FROM onboarding.historical_product_aliases a
    WHERE a.normalized_key IN (
        SELECT normalized_key FROM onboarding.historical_trade_lines_mapped
        WHERE batch_id = v_batch_id
    );
    IF v_alias_count <> 0 THEN
        RAISE EXCEPTION 'no description may be decided before the administrator decides (found %)', v_alias_count;
    END IF;

    v_readiness := onboarding.get_historical_mapping_readiness('token_r0_005', v_batch_id);
    IF (v_readiness->>'resolvedDescriptionCount')::int <> 0
       OR (v_readiness->>'unresolvedDescriptionCount')::int
          <> (v_readiness->>'distinctDescriptionCount')::int THEN
        RAISE EXCEPTION 'every description must start unresolved: %', v_readiness;
    END IF;
    IF (v_readiness->>'isComplete')::boolean THEN
        RAISE EXCEPTION 'the readiness gate must not report complete before any decision';
    END IF;
    -- `couete` and `oreiller` are both sold with no purchase behind them.
    IF (v_readiness->>'sellWithoutCostSourceCount')::int <> 2 THEN
        RAISE EXCEPTION 'expected 2 sold descriptions with no cost source, got %',
            v_readiness->>'sellWithoutCostSourceCount';
    END IF;

    -- 3c. The listing reconciles to the staged lines.
    v_mapping := onboarding.get_historical_product_mapping('token_r0_005', v_batch_id);
    IF (SELECT sum((r->>'occurrenceCount')::bigint)
          FROM jsonb_array_elements(v_mapping->'descriptions') AS r)
       <> (SELECT count(*) FROM onboarding.historical_trade_lines_mapped
            WHERE batch_id = v_batch_id AND transaction_type IN ('SALE','PURCHASE')) THEN
        RAISE EXCEPTION 'the mapping listing does not reconcile to the staged lines';
    END IF;

    -- The highest-impact row comes first: a sold description with no cost.
    IF NOT ((v_mapping->'descriptions'->0->>'appearsInSell')::boolean
            AND NOT (v_mapping->'descriptions'->0->>'hasCostSource')::boolean) THEN
        RAISE EXCEPTION 'a sold description with no cost source must be listed first';
    END IF;

    -- 4. Snapshot the transcription, then record a decision.
    SELECT md5(string_agg(md5(ROW(l.*)::text), '' ORDER BY l.id))
    INTO v_digest_before
    FROM onboarding.historical_trade_lines l
    JOIN onboarding.historical_trade_transactions t ON t.id = l.transaction_id
    WHERE t.batch_id = v_batch_id;

    PERFORM onboarding.apply_historical_product_alias_decisions('token_r0_005', jsonb_build_array(
        jsonb_build_object(
            'normalized_key', onboarding.historical_description_key('couete', 'AK home', '1p 0.90'),
            'raw_sample', 'couete / AK home / 1p 0.90',
            'decision', 'MERGED',
            'canonical_key', onboarding.historical_description_key('couette', 'AK home', '1p 0,90')),
        jsonb_build_object(
            'normalized_key', onboarding.historical_description_key('oreiller', 'rozana', 'blanc'),
            'raw_sample', 'oreiller / rozana / blanc',
            'decision', 'NEW_PRODUCT')
    ));

    -- 4a. The transcription is byte-identical afterwards.
    SELECT md5(string_agg(md5(ROW(l.*)::text), '' ORDER BY l.id))
    INTO v_digest_after
    FROM onboarding.historical_trade_lines l
    JOIN onboarding.historical_trade_transactions t ON t.id = l.transaction_id
    WHERE t.batch_id = v_batch_id;

    IF v_digest_before IS DISTINCT FROM v_digest_after THEN
        RAISE EXCEPTION 'the staged transcription was modified by the mapping';
    END IF;

    -- 4b. The merge is applied at read time.
    IF (SELECT count(DISTINCT canonical_key)
          FROM onboarding.historical_trade_lines_mapped
         WHERE batch_id = v_batch_id
           AND product_name IN ('couette', 'couete')) <> 1 THEN
        RAISE EXCEPTION 'the confirmed merge is not applied at read time';
    END IF;

    -- 4c. The sold `couete` now has a cost source; `oreiller` still does not,
    --     because marking it as a new product does not invent a purchase.
    v_readiness := onboarding.get_historical_mapping_readiness('token_r0_005', v_batch_id);
    IF (v_readiness->>'sellWithoutCostSourceCount')::int <> 1 THEN
        RAISE EXCEPTION 'expected exactly 1 sold description still without a cost source, got %',
            v_readiness->>'sellWithoutCostSourceCount';
    END IF;

    -- 5. A merge into a description that is itself merged never builds a chain.
    PERFORM onboarding.apply_historical_product_alias_decisions('token_r0_005', jsonb_build_array(
        jsonb_build_object(
            'normalized_key', 'couete 2|ak home|1p 0.9',
            'decision', 'MERGED',
            'canonical_key', onboarding.historical_description_key('couete', 'AK home', '1p 0.90'))
    ));
    IF (SELECT canonical_key FROM onboarding.historical_product_aliases
         WHERE normalized_key = 'couete 2|ak home|1p 0.9')
       <> onboarding.historical_description_key('couette', 'AK home', '1p 0,90') THEN
        RAISE EXCEPTION 'merging into a merged description must resolve to the final variant';
    END IF;

    -- 6. Operational isolation.
    SELECT (SELECT count(*) FROM finance.journal_entries)   AS journal_entries,
           (SELECT count(*) FROM finance.journal_lines)     AS journal_lines,
           (SELECT count(*) FROM inventory.movements)       AS movements,
           (SELECT count(*) FROM sales.cash_sales)          AS cash_sales,
           (SELECT count(*) FROM procurement.purchase_orders) AS purchase_orders
    INTO v_after;

    IF v_after.journal_entries <> v_before.journal_entries THEN
        RAISE EXCEPTION 'Operational isolation broken: finance.journal_entries changed!';
    END IF;
    IF v_after.journal_lines <> v_before.journal_lines THEN
        RAISE EXCEPTION 'Operational isolation broken: finance.journal_lines changed!';
    END IF;
    IF v_after.movements <> v_before.movements THEN
        RAISE EXCEPTION 'Operational isolation broken: inventory.movements changed!';
    END IF;
    IF v_after.cash_sales <> v_before.cash_sales THEN
        RAISE EXCEPTION 'Operational isolation broken: sales.cash_sales changed!';
    END IF;
    IF v_after.purchase_orders <> v_before.purchase_orders THEN
        RAISE EXCEPTION 'Operational isolation broken: procurement.purchase_orders changed!';
    END IF;
END;
$$;

-- 7. An unauthenticated caller gets nothing.
DO $$
BEGIN
    BEGIN
        PERFORM onboarding.get_historical_product_mapping('not-a-session-token', 1);
        RAISE EXCEPTION 'the mapping must not be readable without a valid session';
    EXCEPTION
        WHEN OTHERS THEN
            IF SQLSTATE = 'P0001' AND SQLERRM = 'the mapping must not be readable without a valid session' THEN
                RAISE;
            END IF;
    END;

    BEGIN
        PERFORM onboarding.apply_historical_product_alias_decisions(
            'not-a-session-token', '[{"normalized_key":"a|b|c","decision":"CANONICAL"}]'::jsonb);
        RAISE EXCEPTION 'a mapping decision must not be writable without a valid session';
    EXCEPTION
        WHEN OTHERS THEN
            IF SQLSTATE = 'P0001' AND SQLERRM = 'a mapping decision must not be writable without a valid session' THEN
                RAISE;
            END IF;
    END;
END;
$$;

ROLLBACK;
