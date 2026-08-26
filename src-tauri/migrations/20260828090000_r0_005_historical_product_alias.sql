-- R0-005 (WS-G): Historical product description mapping — normalization + alias table
--
-- Sale lines in the paper ledger carry no cost. Cost of goods sold is derived
-- from the purchase history of the SAME variant. When a sale is written
-- `couete` and the purchase is written `couette`, no cost is found and the
-- whole sale price is reported as profit. This migration gives the
-- administrator a way to resolve every distinct historical description into a
-- canonical variant ONCE, before any report is computed.
--
-- Three rules the rest of the system depends on:
--   1. The staged transcription rows are NEVER rewritten. Mapping is applied at
--      READ time, through onboarding.historical_trade_lines_mapped.
--   2. Nothing is merged automatically. With an empty alias table every
--      description is its own canonical variant AND is reported as unresolved.
--   3. An alias is keyed on the NORMALIZED description, never on a row id, so
--      re-importing a corrected workbook preserves every confirmed decision.
--
-- Isolation: this touches onboarding.* only. It does NOT create or modify
-- operational sales, purchases, inventory, cash, bank, AR/AP, or journals, and
-- it does NOT touch the live product catalogue.

SET ROLE stockiha_owner;

-- ---------------------------------------------------------------------------
-- 1. Deterministic normalization
-- ---------------------------------------------------------------------------
-- PostgreSQL is the single authority for normalization. TypeScript never
-- recomputes a normalized key; it only receives the keys computed here and
-- measures edit distance between them to propose groupings.
--
-- The transformation is pure and deterministic:
--   * lowercase, trim, collapse internal whitespace (incl. NBSP)
--   * a comma between two digits is a decimal point   1,60 -> 1.60
--   * punctuation becomes a separator, accented letters are preserved
--   * `1 P`, `1 P.`, `1p.` all become `1p` (same for the `d` suffix)
--   * a bare number is expressed in metres: 160 -> 1.6, 90 -> 0.9, 2,40 -> 2.4
--     (an integer of 10 or more is read as centimetres, which is how the
--     warehouse writes bed sizes), and trailing zeros are dropped
--   * a numeric-typed Custom Details cell arrives here already coerced to its
--     displayed text by the parser, and is normalized like any other text.
--
-- IMMUTABLE: the same input always yields the same output. No randomness, no
-- clock, no network, no catalogue lookup.

CREATE OR REPLACE FUNCTION onboarding.normalize_historical_text(p_text text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
STRICT
SET search_path = pg_catalog
AS $$
DECLARE
    v_work      text;
    v_tokens    text[];
    v_merged    text[] := ARRAY[]::text[];
    v_out       text[] := ARRAY[]::text[];
    v_token     text;
    v_next      text;
    v_index     integer;
    v_count     integer;
    v_num       numeric;
    v_num_text  text;
BEGIN
    v_work := lower(btrim(p_text));
    IF v_work = '' THEN
        RETURN '';
    END IF;

    -- Non-breaking and narrow no-break spaces behave like ordinary spaces.
    v_work := translate(v_work, E'   ', '   ');

    -- A comma between two digits is a decimal separator, not punctuation.
    v_work := regexp_replace(v_work, '([0-9]),([0-9])', '\1.\2', 'g');

    -- Everything that is not a letter, a digit, a dot or a space becomes a
    -- separator. [[:alnum:]] keeps accented letters intact.
    v_work := regexp_replace(v_work, '[^[:alnum:]. ]+', ' ', 'g');
    v_work := btrim(regexp_replace(v_work, '[[:space:]]+', ' ', 'g'));
    IF v_work = '' THEN
        RETURN '';
    END IF;

    v_tokens := string_to_array(v_work, ' ');

    -- Pass 1: a bare integer followed by a lone `p` or `d` is one size token.
    -- `1 P` and `1 P.` both become `1p`; `2 draps` is left alone because the
    -- following token is not a single letter.
    v_count := array_length(v_tokens, 1);
    v_index := 1;
    WHILE v_index <= v_count LOOP
        v_token := btrim(v_tokens[v_index], '.');
        IF v_token = '' THEN
            v_index := v_index + 1;
            CONTINUE;
        END IF;

        IF v_index < v_count AND v_token ~ '^[0-9]+$' THEN
            v_next := btrim(v_tokens[v_index + 1], '.');
            IF v_next ~ '^[pd]$' THEN
                v_merged := v_merged || (v_token || v_next);
                v_index := v_index + 2;
                CONTINUE;
            END IF;
        END IF;

        v_merged := v_merged || v_token;
        v_index := v_index + 1;
    END LOOP;

    -- Pass 2: canonicalise every purely numeric token.
    FOREACH v_token IN ARRAY v_merged LOOP
        IF v_token ~ '^[0-9]+(\.[0-9]+)?$' THEN
            v_num := v_token::numeric;
            -- A whole number of 10 or more is centimetres on the paper.
            IF v_num >= 10 AND v_num = trunc(v_num) THEN
                v_num := v_num / 100;
            END IF;
            v_num_text := v_num::text;
            IF position('.' IN v_num_text) > 0 THEN
                v_num_text := rtrim(v_num_text, '0');
                v_num_text := rtrim(v_num_text, '.');
            END IF;
            IF v_num_text = '' THEN
                v_num_text := '0';
            END IF;
            v_out := v_out || v_num_text;
        ELSE
            v_out := v_out || v_token;
        END IF;
    END LOOP;

    RETURN array_to_string(v_out, ' ');
END;
$$;

COMMENT ON FUNCTION onboarding.normalize_historical_text(text) IS
    'WS-G: deterministic normalization of one historical description field.';

-- The comparison key for a whole line: the three transcribed fields, each
-- normalized, joined by a character that cannot appear inside a normalized
-- field (normalization removes every non-alphanumeric character except `.`).
CREATE OR REPLACE FUNCTION onboarding.historical_description_key(
    p_product_name   text,
    p_brand          text,
    p_custom_details text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $$
    SELECT onboarding.normalize_historical_text(coalesce($1, ''))
        || '|' || onboarding.normalize_historical_text(coalesce($2, ''))
        || '|' || onboarding.normalize_historical_text(coalesce($3, ''));
$$;

COMMENT ON FUNCTION onboarding.historical_description_key(text, text, text) IS
    'WS-G: normalized (Product|Brand|Custom Details) key an alias is stored against.';

-- ---------------------------------------------------------------------------
-- 2. The alias table
-- ---------------------------------------------------------------------------
-- One row per normalized description the administrator has decided about.
-- No batch_id on purpose: a decision belongs to the description, not to an
-- import run, which is what makes decisions survive a re-import.

CREATE TABLE IF NOT EXISTS onboarding.historical_product_aliases (
    id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    normalized_key        text NOT NULL UNIQUE,
    -- One raw spelling, kept only so the review screen can show the
    -- administrator what he actually decided about. Never used for matching.
    raw_sample            text NOT NULL,
    decision              text NOT NULL,
    -- The normalized key of the variant this description reports under.
    canonical_key         text NOT NULL,
    normalization_version integer NOT NULL DEFAULT 1,
    note                  text,
    decided_by            bigint NOT NULL REFERENCES iam.users(id) ON DELETE RESTRICT,
    decided_at            timestamptz NOT NULL DEFAULT now(),
    workstation_id        text,
    CONSTRAINT historical_product_aliases_key_not_blank
        CHECK (btrim(normalized_key) <> '' AND btrim(canonical_key) <> ''),
    CONSTRAINT historical_product_aliases_decision_valid
        CHECK (decision IN ('CANONICAL', 'MERGED', 'NEW_PRODUCT', 'IGNORED')),
    -- Only a MERGED description points somewhere else. Everything else is its
    -- own canonical variant, which keeps the alias graph exactly one hop deep.
    CONSTRAINT historical_product_aliases_canonical_shape
        CHECK (
            (decision = 'MERGED' AND canonical_key <> normalized_key)
            OR (decision <> 'MERGED' AND canonical_key = normalized_key)
        )
);

CREATE INDEX IF NOT EXISTS historical_product_aliases_canonical_idx
    ON onboarding.historical_product_aliases (canonical_key);

COMMENT ON TABLE onboarding.historical_product_aliases IS
    'WS-G: administrator-confirmed mapping from a normalized historical description to a canonical variant. Never written automatically.';

REVOKE ALL ON onboarding.historical_product_aliases FROM PUBLIC;
REVOKE ALL ON onboarding.historical_product_aliases FROM stockiha_runtime;

-- ---------------------------------------------------------------------------
-- 3. Read-time application
-- ---------------------------------------------------------------------------
-- The staged transcription is never rewritten. This view is how every reader
-- sees a line: the original columns untouched, plus the normalized key and the
-- canonical key the mapping resolves it to. With no alias row a description is
-- its own canonical variant — correct by default, and still reported as
-- unresolved by the readiness gate.

CREATE OR REPLACE VIEW onboarding.historical_trade_lines_mapped AS
SELECT
    l.id                              AS line_id,
    l.transaction_id,
    t.batch_id,
    t.transaction_type,
    t.transaction_date,
    l.source_row_number,
    l.product_name,
    l.brand,
    l.custom_details,
    l.quantity,
    l.unit_price_dzd,
    l.effective_line_total_dzd,
    onboarding.historical_description_key(l.product_name, l.brand, l.custom_details)
                                      AS normalized_key,
    coalesce(
        a.canonical_key,
        onboarding.historical_description_key(l.product_name, l.brand, l.custom_details)
    )                                 AS canonical_key,
    a.decision                        AS mapping_decision,
    (a.id IS NOT NULL)                AS is_resolved
FROM onboarding.historical_trade_lines l
JOIN onboarding.historical_trade_transactions t ON t.id = l.transaction_id
LEFT JOIN onboarding.historical_product_aliases a
       ON a.normalized_key
        = onboarding.historical_description_key(l.product_name, l.brand, l.custom_details);

COMMENT ON VIEW onboarding.historical_trade_lines_mapped IS
    'WS-G: staged historical lines with the confirmed mapping applied at READ time. The underlying rows are never modified.';

REVOKE ALL ON onboarding.historical_trade_lines_mapped FROM PUBLIC;
REVOKE ALL ON onboarding.historical_trade_lines_mapped FROM stockiha_runtime;

-- ---------------------------------------------------------------------------
-- 4. The mapping review screen's data
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION onboarding.get_historical_product_mapping(
    p_session_token text,
    p_batch_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_rows jsonb;
    v_readiness jsonb;
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

    WITH scoped AS (
        SELECT *
        FROM onboarding.historical_trade_lines_mapped m
        WHERE m.batch_id = p_batch_id
          AND m.transaction_type IN ('SALE', 'PURCHASE')
          AND m.normalized_key <> '||'
    ),
    -- A canonical variant has a cost source when at least one PURCHASE line
    -- resolves to it. That is the only place a historical cost can come from.
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
            s.mapping_decision,
            bool_or(s.is_resolved)                                                AS is_resolved,
            count(*)                                                              AS occurrence_count,
            coalesce(sum(s.quantity), 0)                                          AS total_quantity,
            coalesce(sum(s.effective_line_total_dzd), 0)                          AS total_value_dzd,
            count(*) FILTER (WHERE s.transaction_type = 'PURCHASE')               AS buy_line_count,
            count(*) FILTER (WHERE s.transaction_type = 'SALE')                   AS sell_line_count,
            coalesce(sum(s.effective_line_total_dzd)
                     FILTER (WHERE s.transaction_type = 'PURCHASE'), 0)           AS buy_value_dzd,
            coalesce(sum(s.effective_line_total_dzd)
                     FILTER (WHERE s.transaction_type = 'SALE'), 0)               AS sell_value_dzd,
            coalesce(sum(s.quantity) FILTER (WHERE s.transaction_type = 'SALE'), 0)
                                                                                  AS sell_quantity,
            min(s.source_row_number)                                              AS first_row
        FROM scoped s
        GROUP BY s.normalized_key, s.canonical_key, s.mapping_decision
    ),
    variants AS (
        SELECT
            s.normalized_key,
            jsonb_agg(DISTINCT jsonb_build_object(
                'productName',   s.product_name,
                'brand',         s.brand,
                'customDetails', s.custom_details
            )) AS raw_variants
        FROM scoped s
        GROUP BY s.normalized_key
    ),
    display AS (
        SELECT DISTINCT ON (s.normalized_key)
            s.normalized_key,
            s.product_name,
            s.brand,
            s.custom_details
        FROM scoped s
        ORDER BY s.normalized_key, s.source_row_number
    )
    SELECT coalesce(jsonb_agg(row_json ORDER BY sort_missing_cost DESC, sort_value DESC, sort_key), '[]'::jsonb)
    INTO v_rows
    FROM (
        SELECT
            (k.sell_line_count > 0 AND c.canonical_key IS NULL) AS sort_missing_cost,
            k.total_value_dzd                                   AS sort_value,
            k.normalized_key                                    AS sort_key,
            jsonb_build_object(
                'normalizedKey',       k.normalized_key,
                'canonicalKey',        k.canonical_key,
                'decision',            k.mapping_decision,
                'isResolved',          k.is_resolved,
                'displayProductName',  d.product_name,
                'displayBrand',        d.brand,
                'displayCustomDetails', d.custom_details,
                'rawVariants',         v.raw_variants,
                'occurrenceCount',     k.occurrence_count,
                'buyLineCount',        k.buy_line_count,
                'sellLineCount',       k.sell_line_count,
                'appearsInBuy',        k.buy_line_count > 0,
                'appearsInSell',       k.sell_line_count > 0,
                -- Money and quantity cross the boundary as exact decimal text.
                'totalQuantity',       k.total_quantity::text,
                'sellQuantity',        k.sell_quantity::text,
                'totalValueDzd',       k.total_value_dzd::text,
                'buyValueDzd',         k.buy_value_dzd::text,
                'sellValueDzd',        k.sell_value_dzd::text,
                'hasCostSource',       c.canonical_key IS NOT NULL,
                'firstSourceRow',      k.first_row
            ) AS row_json
        FROM per_key k
        JOIN variants v ON v.normalized_key = k.normalized_key
        JOIN display d ON d.normalized_key = k.normalized_key
        LEFT JOIN cost_source c ON c.canonical_key = k.canonical_key
    ) ordered;

    v_readiness := onboarding.get_historical_mapping_readiness(p_session_token, p_batch_id);

    RETURN jsonb_build_object(
        'batchId', p_batch_id,
        'descriptions', v_rows,
        'readiness', v_readiness
    );
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. The readiness gate
-- ---------------------------------------------------------------------------
-- Two different questions, deliberately reported separately:
--   unresolvedDescriptionCount   — how many descriptions the administrator has
--                                  not decided about yet.
--   sellWithoutCostSourceCount   — how many SOLD canonical variants have no
--                                  purchase line to take a cost from. This is
--                                  the failure mode that overstates profit.
-- A report may only run when both are zero.

CREATE OR REPLACE FUNCTION onboarding.get_historical_mapping_readiness(
    p_session_token text,
    p_batch_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
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

    IF p_batch_id IS NULL OR p_batch_id <= 0 THEN
        RAISE EXCEPTION 'invalid historical finance batch' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM onboarding.historical_finance_batches WHERE id = p_batch_id) THEN
        RAISE EXCEPTION 'unknown historical finance batch' USING ERRCODE = '22023';
    END IF;

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
    INTO v_result
    FROM per_key k
    LEFT JOIN cost_source c ON c.canonical_key = k.canonical_key;

    RETURN v_result;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Recording the administrator's decisions
-- ---------------------------------------------------------------------------
-- Every row written here is an explicit administrator confirmation. There is
-- no code path anywhere that inserts into the alias table on its own.

CREATE OR REPLACE FUNCTION onboarding.apply_historical_product_alias_decisions(
    p_session_token text,
    p_decisions jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_actor_id bigint;
    v_workstation_id text;
    v_rec record;
    v_decision text;
    v_canonical text;
    v_target_decision text;
    v_target_canonical text;
    v_applied integer := 0;
BEGIN
    SELECT user_id, workstation_id
    INTO v_actor_id, v_workstation_id
    FROM iam.resolve_session_with_permission(
        p_session_token,
        'MANAGE_HISTORICAL_FINANCE_IMPORT'
    );

    IF jsonb_typeof(p_decisions) <> 'array' THEN
        RAISE EXCEPTION 'historical product mapping decisions must be a JSON array'
            USING ERRCODE = '22023';
    END IF;
    IF jsonb_array_length(p_decisions) > 5000 THEN
        RAISE EXCEPTION 'too many historical product mapping decisions in one request'
            USING ERRCODE = '22023';
    END IF;

    FOR v_rec IN SELECT * FROM jsonb_to_recordset(p_decisions) AS x(
        normalized_key text,
        raw_sample text,
        decision text,
        canonical_key text,
        note text
    ) LOOP
        IF v_rec.normalized_key IS NULL OR btrim(v_rec.normalized_key) = '' THEN
            RAISE EXCEPTION 'a historical product mapping decision is missing its description'
                USING ERRCODE = '22023';
        END IF;

        v_decision := upper(btrim(coalesce(v_rec.decision, '')));
        IF v_decision NOT IN ('CANONICAL', 'MERGED', 'NEW_PRODUCT', 'IGNORED') THEN
            RAISE EXCEPTION 'unknown historical product mapping decision' USING ERRCODE = '22023';
        END IF;

        IF v_decision = 'MERGED' THEN
            v_canonical := btrim(coalesce(v_rec.canonical_key, ''));
            IF v_canonical = '' THEN
                RAISE EXCEPTION 'merging a description requires a target variant'
                    USING ERRCODE = '22023';
            END IF;
            IF v_canonical = btrim(v_rec.normalized_key) THEN
                RAISE EXCEPTION 'a description cannot be merged into itself'
                    USING ERRCODE = '22023';
            END IF;

            -- Keep the graph one hop deep: merging into a description that is
            -- itself merged lands on the final canonical variant instead.
            SELECT decision, canonical_key
            INTO v_target_decision, v_target_canonical
            FROM onboarding.historical_product_aliases
            WHERE normalized_key = v_canonical;

            IF v_target_decision = 'MERGED' THEN
                v_canonical := v_target_canonical;
            END IF;
            IF v_canonical = btrim(v_rec.normalized_key) THEN
                RAISE EXCEPTION 'a description cannot be merged into itself'
                    USING ERRCODE = '22023';
            END IF;
        ELSE
            v_canonical := btrim(v_rec.normalized_key);
        END IF;

        INSERT INTO onboarding.historical_product_aliases (
            normalized_key,
            raw_sample,
            decision,
            canonical_key,
            note,
            decided_by,
            decided_at,
            workstation_id
        ) VALUES (
            btrim(v_rec.normalized_key),
            left(coalesce(nullif(btrim(coalesce(v_rec.raw_sample, '')), ''), btrim(v_rec.normalized_key)), 500),
            v_decision,
            v_canonical,
            nullif(btrim(coalesce(v_rec.note, '')), ''),
            v_actor_id,
            now(),
            v_workstation_id
        )
        ON CONFLICT (normalized_key) DO UPDATE
        SET raw_sample     = EXCLUDED.raw_sample,
            decision       = EXCLUDED.decision,
            canonical_key  = EXCLUDED.canonical_key,
            note           = EXCLUDED.note,
            decided_by     = EXCLUDED.decided_by,
            decided_at     = EXCLUDED.decided_at,
            workstation_id = EXCLUDED.workstation_id;

        -- If this description used to be a target and has now been merged
        -- away, move everything that pointed at it onto the new target so no
        -- chain is ever created.
        IF v_decision = 'MERGED' THEN
            UPDATE onboarding.historical_product_aliases
            SET canonical_key = v_canonical,
                decided_by = v_actor_id,
                decided_at = now(),
                workstation_id = v_workstation_id
            WHERE canonical_key = btrim(v_rec.normalized_key)
              AND normalized_key <> btrim(v_rec.normalized_key)
              AND decision = 'MERGED';
        END IF;

        v_applied := v_applied + 1;
    END LOOP;

    RETURN jsonb_build_object(
        'appliedCount', v_applied,
        'aliasCount', (SELECT count(*) FROM onboarding.historical_product_aliases)
    );
END;
$$;

CREATE OR REPLACE FUNCTION onboarding.clear_historical_product_alias(
    p_session_token text,
    p_normalized_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_actor_id bigint;
    v_removed integer;
BEGIN
    SELECT user_id
    INTO v_actor_id
    FROM iam.resolve_session_with_permission(
        p_session_token,
        'MANAGE_HISTORICAL_FINANCE_IMPORT'
    );

    IF p_normalized_key IS NULL OR btrim(p_normalized_key) = '' THEN
        RAISE EXCEPTION 'a historical product mapping decision is missing its description'
            USING ERRCODE = '22023';
    END IF;

    -- A description other decisions point at cannot simply disappear.
    IF EXISTS (
        SELECT 1 FROM onboarding.historical_product_aliases
        WHERE canonical_key = btrim(p_normalized_key)
          AND normalized_key <> btrim(p_normalized_key)
    ) THEN
        RAISE EXCEPTION 'other descriptions are still grouped under this variant'
            USING ERRCODE = '55000';
    END IF;

    DELETE FROM onboarding.historical_product_aliases
    WHERE normalized_key = btrim(p_normalized_key);
    GET DIAGNOSTICS v_removed = ROW_COUNT;

    RETURN jsonb_build_object(
        'removedCount', v_removed,
        'aliasCount', (SELECT count(*) FROM onboarding.historical_product_aliases)
    );
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. Grants
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION onboarding.get_historical_product_mapping(text, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION onboarding.get_historical_mapping_readiness(text, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION onboarding.apply_historical_product_alias_decisions(text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION onboarding.clear_historical_product_alias(text, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION onboarding.get_historical_product_mapping(text, bigint) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION onboarding.get_historical_mapping_readiness(text, bigint) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION onboarding.apply_historical_product_alias_decisions(text, jsonb) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION onboarding.clear_historical_product_alias(text, text) TO stockiha_runtime;

GRANT EXECUTE ON FUNCTION onboarding.get_historical_product_mapping(text, bigint) TO stockiha_admin;
GRANT EXECUTE ON FUNCTION onboarding.get_historical_mapping_readiness(text, bigint) TO stockiha_admin;
GRANT EXECUTE ON FUNCTION onboarding.apply_historical_product_alias_decisions(text, jsonb) TO stockiha_admin;
GRANT EXECUTE ON FUNCTION onboarding.clear_historical_product_alias(text, text) TO stockiha_admin;

UPDATE operations.schema_state
SET migration_version = 20260828090000,
    updated_at = now()
WHERE singleton;

RESET ROLE;
