-- Migration: 20261004120000_ws_p_1_paperbook_foundation.sql
-- WS-P-1: Historical Paper Book Foundation
-- Implements schema, normalisation helpers, tables, views, and functions
-- strictly isolated from live operational tables.

SET ROLE stockiha_owner;

CREATE SCHEMA IF NOT EXISTS paperbook;

-- ----------------------------------------------------------------------------
-- 1. Normalisation & Text Cleaning Helpers (Used by generated columns)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION paperbook.normalize_key(p text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  SELECT NULLIF(
    pg_catalog.translate(
      pg_catalog.btrim(
        pg_catalog.regexp_replace(
          pg_catalog.translate(p, E'\u00A0\u202F\u2009\t\n\r', '      '),
          ' {2,}', ' ', 'g')),
      'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'),
    '')
$$;

CREATE OR REPLACE FUNCTION paperbook.clean_text(p text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  SELECT NULLIF(
    pg_catalog.btrim(
      pg_catalog.regexp_replace(
        pg_catalog.translate(p, E'\u00A0\u202F\u2009\t\n\r', '      '),
        ' {2,}', ' ', 'g')),
    '')
$$;

REVOKE ALL ON FUNCTION paperbook.normalize_key(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION paperbook.normalize_key(text) TO stockiha_runtime;

REVOKE ALL ON FUNCTION paperbook.clean_text(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION paperbook.clean_text(text) TO stockiha_runtime;

-- ----------------------------------------------------------------------------
-- 2. Tables
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS paperbook.settings (
  id           smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  go_live_date date NULL,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
INSERT INTO paperbook.settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS paperbook.import_batch (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  file_name     text NOT NULL,
  file_sha256   text NOT NULL CHECK (file_sha256 ~ '^[0-9a-f]{64}$'),
  sheet_name    text NOT NULL,
  txn_count     integer NOT NULL CHECK (txn_count >= 1),
  line_count    integer NOT NULL CHECK (line_count >= 1),
  warning_count integer NOT NULL CHECK (warning_count >= 0),
  is_active     boolean NOT NULL,
  imported_at   timestamptz NOT NULL DEFAULT now(),
  imported_by   bigint NOT NULL,
  superseded_at timestamptz NULL,
  CHECK (is_active = (superseded_at IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS import_batch_one_active ON paperbook.import_batch (is_active) WHERE is_active;

CREATE TABLE IF NOT EXISTS paperbook.txn (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source          text NOT NULL CHECK (source IN ('import','manual')),
  batch_id        bigint NULL REFERENCES paperbook.import_batch(id),
  excel_first_row integer NULL CHECK (excel_first_row >= 2),
  excel_txn_no    text NULL,
  txn_date        date NOT NULL,
  txn_type        text NOT NULL CHECK (txn_type IN ('sell','buy','expense')),
  is_paid         boolean NOT NULL,
  party_raw       text NULL,
  party_key       text GENERATED ALWAYS AS (paperbook.normalize_key(party_raw)) STORED,
  benefit         numeric(14,0) NULL,
  page_no         text NULL,
  note            text NULL CHECK (note IS NULL OR char_length(note) <= 500),
  total           numeric(14,0) NOT NULL CHECK (total > 0),
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      bigint NOT NULL,
  updated_at      timestamptz NULL,
  updated_by      bigint NULL,
  CHECK ((source = 'import') = (batch_id IS NOT NULL)),
  CHECK ((source = 'import') = (excel_first_row IS NOT NULL)),
  CHECK (source = 'manual' OR note IS NULL),
  CHECK (benefit IS NULL OR txn_type = 'sell')
);
CREATE INDEX IF NOT EXISTS txn_date_idx      ON paperbook.txn (txn_date);
CREATE INDEX IF NOT EXISTS txn_type_date_idx ON paperbook.txn (txn_type, txn_date);
CREATE INDEX IF NOT EXISTS txn_party_key_idx ON paperbook.txn (party_key);
CREATE INDEX IF NOT EXISTS txn_source_idx    ON paperbook.txn (source);

CREATE TABLE IF NOT EXISTS paperbook.txn_line (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  txn_id           bigint NOT NULL REFERENCES paperbook.txn(id) ON DELETE CASCADE,
  line_no          integer NOT NULL CHECK (line_no >= 1),
  excel_row        integer NULL CHECK (excel_row >= 2),
  product_raw      text NULL,
  product_key      text GENERATED ALWAYS AS (paperbook.normalize_key(product_raw)) STORED,
  brand_raw        text NULL,
  brand_key        text GENERATED ALWAYS AS (paperbook.normalize_key(brand_raw)) STORED,
  details_raw      text NULL,
  details_key      text GENERATED ALWAYS AS (paperbook.normalize_key(details_raw)) STORED,
  quantity         numeric(14,0) NULL CHECK (quantity IS NULL OR quantity >= 1),
  unit_price       numeric(14,0) NULL CHECK (unit_price IS NULL OR unit_price >= 0),
  line_total       numeric(14,0) NOT NULL CHECK (line_total >= 0),
  total_overridden boolean NOT NULL DEFAULT false,
  page_no          text NULL,
  UNIQUE (txn_id, line_no)
);
CREATE INDEX IF NOT EXISTS txn_line_txn_idx     ON paperbook.txn_line (txn_id);
CREATE INDEX IF NOT EXISTS txn_line_product_idx ON paperbook.txn_line (product_key);
CREATE INDEX IF NOT EXISTS txn_line_brand_idx   ON paperbook.txn_line (brand_key);
CREATE INDEX IF NOT EXISTS txn_line_details_idx ON paperbook.txn_line (details_key);

CREATE TABLE IF NOT EXISTS paperbook.name_map (
  field           text NOT NULL CHECK (field IN ('party','product','brand','details')),
  raw_key         text NOT NULL,
  canonical_label text NOT NULL CHECK (paperbook.normalize_key(canonical_label) IS NOT NULL),
  canonical_key   text GENERATED ALWAYS AS (paperbook.normalize_key(canonical_label)) STORED,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      bigint NOT NULL,
  PRIMARY KEY (field, raw_key)
);
CREATE INDEX IF NOT EXISTS name_map_canonical_idx ON paperbook.name_map (field, canonical_key);

CREATE TABLE IF NOT EXISTS paperbook.name_dismissed (
  field      text NOT NULL CHECK (field IN ('party','product','brand','details')),
  key_a      text NOT NULL,
  key_b      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (key_a < key_b),
  PRIMARY KEY (field, key_a, key_b)
);

REVOKE ALL ON paperbook.settings FROM PUBLIC;
REVOKE ALL ON paperbook.import_batch FROM PUBLIC;
REVOKE ALL ON paperbook.txn FROM PUBLIC;
REVOKE ALL ON paperbook.txn_line FROM PUBLIC;
REVOKE ALL ON paperbook.name_map FROM PUBLIC;
REVOKE ALL ON paperbook.name_dismissed FROM PUBLIC;

GRANT SELECT ON paperbook.settings TO stockiha_runtime;
GRANT SELECT ON paperbook.import_batch TO stockiha_runtime;
GRANT SELECT ON paperbook.txn TO stockiha_runtime;
GRANT SELECT ON paperbook.txn_line TO stockiha_runtime;
GRANT SELECT ON paperbook.name_map TO stockiha_runtime;
GRANT SELECT ON paperbook.name_dismissed TO stockiha_runtime;

-- ----------------------------------------------------------------------------
-- 3. Views for Label Resolution & Name Management
-- ----------------------------------------------------------------------------

CREATE OR REPLACE VIEW paperbook.v_raw_labels AS
WITH all_raws AS (
    SELECT 'party'::text AS field, party_key AS raw_key, party_raw AS raw_text
    FROM paperbook.txn
    WHERE party_key IS NOT NULL AND party_raw IS NOT NULL
    UNION ALL
    SELECT 'product'::text AS field, product_key AS raw_key, product_raw AS raw_text
    FROM paperbook.txn_line
    WHERE product_key IS NOT NULL AND product_raw IS NOT NULL
    UNION ALL
    SELECT 'brand'::text AS field, brand_key AS raw_key, brand_raw AS raw_text
    FROM paperbook.txn_line
    WHERE brand_key IS NOT NULL AND brand_raw IS NOT NULL
    UNION ALL
    SELECT 'details'::text AS field, details_key AS raw_key, details_raw AS raw_text
    FROM paperbook.txn_line
    WHERE details_key IS NOT NULL AND details_raw IS NOT NULL
),
cleaned_raws AS (
    SELECT field, raw_key, paperbook.clean_text(raw_text) AS raw_clean
    FROM all_raws
),
ranked AS (
    SELECT
        field,
        raw_key,
        raw_clean AS raw_label,
        count(*) AS usage_count,
        ROW_NUMBER() OVER(
            PARTITION BY field, raw_key
            ORDER BY count(*) DESC, raw_clean ASC
        ) AS rnk
    FROM cleaned_raws
    GROUP BY field, raw_key, raw_clean
)
SELECT field, raw_key, raw_label, usage_count
FROM ranked
WHERE rnk = 1;

CREATE OR REPLACE VIEW paperbook.v_effective_labels AS
WITH canonical_overrides AS (
    SELECT DISTINCT ON (field, canonical_key)
        field,
        canonical_key AS eff_key,
        canonical_label AS eff_label
    FROM paperbook.name_map
    ORDER BY field, canonical_key, created_at DESC
)
SELECT
    coalesce(c.field, r.field) AS field,
    coalesce(c.eff_key, r.raw_key) AS effective_key,
    coalesce(c.eff_label, r.raw_label) AS effective_label
FROM canonical_overrides c
FULL OUTER JOIN paperbook.v_raw_labels r
    ON c.field = r.field AND c.eff_key = r.raw_key;

CREATE OR REPLACE VIEW paperbook.v_labels AS
SELECT
    r.field,
    r.raw_key,
    r.raw_label,
    r.usage_count,
    coalesce(m.canonical_key, r.raw_key) AS effective_key,
    coalesce(e.effective_label, r.raw_label) AS effective_label,
    (m.raw_key IS NOT NULL) AS is_mapped
FROM paperbook.v_raw_labels r
LEFT JOIN paperbook.name_map m
    ON r.field = m.field AND r.raw_key = m.raw_key
LEFT JOIN paperbook.v_effective_labels e
    ON r.field = e.field AND coalesce(m.canonical_key, r.raw_key) = e.effective_key;

REVOKE ALL ON paperbook.v_raw_labels FROM PUBLIC;
REVOKE ALL ON paperbook.v_effective_labels FROM PUBLIC;
REVOKE ALL ON paperbook.v_labels FROM PUBLIC;
GRANT SELECT ON paperbook.v_raw_labels TO stockiha_runtime;
GRANT SELECT ON paperbook.v_effective_labels TO stockiha_runtime;
GRANT SELECT ON paperbook.v_labels TO stockiha_runtime;

-- ----------------------------------------------------------------------------
-- 4. Shared Private Transaction Insert Helper
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION paperbook._insert_txn(
    p_user_id bigint,
    p_source text,
    p_batch_id bigint,
    p_go_live_date date,
    p_today date,
    p_txn jsonb
) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_excel_first_row integer;
    v_excel_txn_no text;
    v_date date;
    v_type text;
    v_paid boolean;
    v_party text;
    v_benefit numeric(14,0);
    v_page text;
    v_note text;
    v_lines jsonb;
    v_txn_id bigint;
    v_total numeric(14,0) := 0;
    v_line_elem jsonb;
    v_idx integer := 0;
    v_line_qty numeric(14,0);
    v_line_price numeric(14,0);
    v_line_total numeric(14,0);
    v_overridden boolean;
BEGIN
    v_excel_first_row := (p_txn->>'excel_first_row')::integer;
    v_excel_txn_no := p_txn->>'excel_txn_no';
    v_date := (p_txn->>'date')::date;
    v_type := p_txn->>'type';
    v_paid := (p_txn->>'paid')::boolean;
    v_party := paperbook.clean_text(p_txn->>'party');
    v_page := paperbook.clean_text(p_txn->>'page');
    v_note := paperbook.clean_text(p_txn->>'note');
    v_lines := p_txn->'lines';

    IF p_txn->>'benefit' IS NOT NULL AND btrim(p_txn->>'benefit') <> '' THEN
        v_benefit := (p_txn->>'benefit')::numeric(14,0);
    ELSE
        v_benefit := NULL;
    END IF;

    -- Safety net checks
    IF p_go_live_date IS NOT NULL AND v_date >= p_go_live_date THEN
        RAISE EXCEPTION 'paperbook: transaction date % is on or after go-live date %', v_date, p_go_live_date USING ERRCODE = '22023';
    END IF;
    IF v_date > p_today THEN
        RAISE EXCEPTION 'paperbook: transaction date % is in future (today %)', v_date, p_today USING ERRCODE = '22023';
    END IF;
    IF v_type NOT IN ('sell', 'buy', 'expense') THEN
        RAISE EXCEPTION 'paperbook: invalid transaction type %', v_type USING ERRCODE = '22023';
    END IF;
    IF v_benefit IS NOT NULL AND v_type <> 'sell' THEN
        RAISE EXCEPTION 'paperbook: benefit only allowed on sell' USING ERRCODE = '22023';
    END IF;
    IF v_lines IS NULL OR jsonb_array_length(v_lines) = 0 THEN
        RAISE EXCEPTION 'paperbook: transaction has zero lines' USING ERRCODE = '22023';
    END IF;

    -- Compute transaction total from line totals
    FOR v_line_elem IN SELECT * FROM jsonb_array_elements(v_lines) LOOP
        v_line_total := (v_line_elem->>'line_total')::numeric(14,0);
        IF v_line_total < 0 THEN
            RAISE EXCEPTION 'paperbook: negative line total' USING ERRCODE = '22023';
        END IF;
        v_total := v_total + v_line_total;
    END LOOP;

    IF v_total <= 0 THEN
        RAISE EXCEPTION 'paperbook: transaction total must be positive' USING ERRCODE = '22023';
    END IF;

    INSERT INTO paperbook.txn (
        source, batch_id, excel_first_row, excel_txn_no,
        txn_date, txn_type, is_paid, party_raw, benefit,
        page_no, note, total, created_by
    ) VALUES (
        p_source, p_batch_id, v_excel_first_row, v_excel_txn_no,
        v_date, v_type, v_paid, v_party, v_benefit,
        v_page, v_note, v_total, p_user_id
    ) RETURNING id INTO v_txn_id;

    -- Insert lines
    FOR v_line_elem IN SELECT * FROM jsonb_array_elements(v_lines) LOOP
        v_idx := v_idx + 1;
        IF v_line_elem->>'qty' IS NOT NULL AND btrim(v_line_elem->>'qty') <> '' THEN
            v_line_qty := (v_line_elem->>'qty')::numeric(14,0);
            IF v_line_qty < 1 THEN
                RAISE EXCEPTION 'paperbook: line quantity must be >= 1' USING ERRCODE = '22023';
            END IF;
        ELSE
            v_line_qty := NULL;
        END IF;

        IF v_line_elem->>'unit_price' IS NOT NULL AND btrim(v_line_elem->>'unit_price') <> '' THEN
            v_line_price := (v_line_elem->>'unit_price')::numeric(14,0);
            IF v_line_price < 0 THEN
                RAISE EXCEPTION 'paperbook: line unit price cannot be negative' USING ERRCODE = '22023';
            END IF;
        ELSE
            v_line_price := NULL;
        END IF;

        v_line_total := (v_line_elem->>'line_total')::numeric(14,0);
        v_overridden := coalesce((v_line_elem->>'total_overridden')::boolean, false);

        INSERT INTO paperbook.txn_line (
            txn_id, line_no, excel_row,
            product_raw, brand_raw, details_raw,
            quantity, unit_price, line_total, total_overridden, page_no
        ) VALUES (
            v_txn_id, v_idx, (v_line_elem->>'excel_row')::integer,
            paperbook.clean_text(v_line_elem->>'product'),
            paperbook.clean_text(v_line_elem->>'brand'),
            paperbook.clean_text(v_line_elem->>'details'),
            v_line_qty, v_line_price, v_line_total, v_overridden,
            paperbook.clean_text(v_line_elem->>'page')
        );
    END LOOP;

    RETURN v_txn_id;
END;
$$;

REVOKE ALL ON FUNCTION paperbook._insert_txn(bigint, text, bigint, date, date, jsonb) FROM PUBLIC;

-- ----------------------------------------------------------------------------
-- 5. Public Application Functions (19 Functions)
-- ----------------------------------------------------------------------------

-- 1. get_settings
CREATE OR REPLACE FUNCTION paperbook.get_settings(p_session_token text)
RETURNS TABLE (go_live_date date)
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    PERFORM 1 FROM iam.resolve_session(p_session_token);
    RETURN QUERY SELECT s.go_live_date FROM paperbook.settings s WHERE s.id = 1;
END;
$$;

-- 2. set_go_live_date
CREATE OR REPLACE FUNCTION paperbook.set_go_live_date(p_session_token text, p_date date)
RETURNS TABLE (go_live_date date)
LANGUAGE plpgsql VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_today date := (now() AT TIME ZONE 'Africa/Algiers')::date;
    v_conflict_count bigint;
    v_earliest_conflict date;
BEGIN
    PERFORM 1 FROM iam.resolve_session(p_session_token);

    IF p_date IS NULL OR p_date < '2000-01-01'::date OR p_date > (v_today + 365) THEN
        RAISE EXCEPTION 'paperbook: go-live date out of allowed range' USING ERRCODE = '22023';
    END IF;

    SELECT count(*), min(t.txn_date)
    INTO v_conflict_count, v_earliest_conflict
    FROM paperbook.txn t
    WHERE t.txn_date >= p_date;

    IF v_conflict_count > 0 THEN
        RAISE EXCEPTION 'paperbook: % records are dated on or after % (earliest %)',
            v_conflict_count, p_date, v_earliest_conflict
            USING ERRCODE = '22023';
    END IF;

    UPDATE paperbook.settings SET go_live_date = p_date, updated_at = now() WHERE id = 1;
    RETURN QUERY SELECT p_date;
END;
$$;

-- 3. import_status
CREATE OR REPLACE FUNCTION paperbook.import_status(p_session_token text)
RETURNS TABLE (
    batch_id bigint,
    file_name text,
    file_sha256 text,
    imported_at timestamptz,
    txn_count integer,
    line_count integer,
    manual_count bigint
)
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_manual bigint;
BEGIN
    PERFORM 1 FROM iam.resolve_session(p_session_token);
    SELECT count(*) INTO v_manual FROM paperbook.txn WHERE source = 'manual';

    RETURN QUERY
    SELECT b.id, b.file_name, b.file_sha256, b.imported_at, b.txn_count, b.line_count, v_manual
    FROM paperbook.import_batch b
    WHERE b.is_active = true
    UNION ALL
    SELECT NULL::bigint, NULL::text, NULL::text, NULL::timestamptz, NULL::integer, NULL::integer, v_manual
    WHERE NOT EXISTS (SELECT 1 FROM paperbook.import_batch WHERE is_active = true)
    LIMIT 1;
END;
$$;

-- 4. manual_signatures
CREATE OR REPLACE FUNCTION paperbook.manual_signatures(p_session_token text)
RETURNS TABLE (
    id bigint,
    txn_date date,
    txn_type text,
    total numeric(14,0)
)
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    PERFORM 1 FROM iam.resolve_session(p_session_token);
    RETURN QUERY
    SELECT t.id, t.txn_date, t.txn_type, t.total
    FROM paperbook.txn t
    WHERE t.source = 'manual'
    ORDER BY t.id ASC;
END;
$$;

-- 5. import_replace
CREATE OR REPLACE FUNCTION paperbook.import_replace(
    p_session_token text,
    p_file_name text,
    p_file_sha256 text,
    p_sheet_name text,
    p_warning_count integer,
    p_txns jsonb
)
RETURNS TABLE (
    batch_id bigint,
    txn_count integer,
    line_count integer,
    replaced_txn_count integer
)
LANGUAGE plpgsql VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_user_id bigint;
    v_go_live date;
    v_today date := (now() AT TIME ZONE 'Africa/Algiers')::date;
    v_new_batch_id bigint;
    v_replaced integer := 0;
    v_elem jsonb;
    v_txn_total_count integer := 0;
    v_line_total_count integer := 0;
BEGIN
    SELECT s.user_id INTO v_user_id FROM iam.resolve_session(p_session_token) s;
    SELECT s.go_live_date INTO v_go_live FROM paperbook.settings s WHERE s.id = 1;
    -- Count existing imported
    SELECT count(*)::integer INTO v_replaced FROM paperbook.txn WHERE source = 'import';

    -- Delete old imported (lines cascade)
    DELETE FROM paperbook.txn WHERE source = 'import';

    -- Supersede existing active batch
    UPDATE paperbook.import_batch
    SET is_active = false, superseded_at = now()
    WHERE is_active = true;

    v_txn_total_count := jsonb_array_length(p_txns);
    IF v_txn_total_count = 0 THEN
        RAISE EXCEPTION 'paperbook: zero transactions in import payload' USING ERRCODE = '22023';
    END IF;

    -- Calculate total lines
    FOR v_elem IN SELECT * FROM jsonb_array_elements(p_txns) LOOP
        v_line_total_count := v_line_total_count + jsonb_array_length(v_elem->'lines');
    END LOOP;

    -- Insert new batch row
    INSERT INTO paperbook.import_batch (
        file_name, file_sha256, sheet_name,
        txn_count, line_count, warning_count,
        is_active, imported_at, imported_by
    ) VALUES (
        p_file_name, p_file_sha256, p_sheet_name,
        v_txn_total_count, v_line_total_count, p_warning_count,
        true, now(), v_user_id
    ) RETURNING id INTO v_new_batch_id;

    -- Insert all transactions
    FOR v_elem IN SELECT * FROM jsonb_array_elements(p_txns) LOOP
        PERFORM paperbook._insert_txn(
            v_user_id, 'import', v_new_batch_id, v_go_live, v_today, v_elem
        );
    END LOOP;

    RETURN QUERY SELECT v_new_batch_id, v_txn_total_count, v_line_total_count, v_replaced;
END;
$$;

-- 6. create_manual
CREATE OR REPLACE FUNCTION paperbook.create_manual(
    p_session_token text,
    p_txn jsonb
)
RETURNS bigint
LANGUAGE plpgsql VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_user_id bigint;
    v_go_live date;
    v_today date := (now() AT TIME ZONE 'Africa/Algiers')::date;
BEGIN
    SELECT s.user_id INTO v_user_id FROM iam.resolve_session(p_session_token) s;
    SELECT s.go_live_date INTO v_go_live FROM paperbook.settings s WHERE s.id = 1;
    RETURN paperbook._insert_txn(v_user_id, 'manual', NULL, v_go_live, v_today, p_txn);
END;
$$;

-- 7. update_manual
CREATE OR REPLACE FUNCTION paperbook.update_manual(
    p_session_token text,
    p_id bigint,
    p_txn jsonb
)
RETURNS bigint
LANGUAGE plpgsql VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_user_id bigint;
    v_go_live date;
    v_today date := (now() AT TIME ZONE 'Africa/Algiers')::date;
    v_source text;
BEGIN
    SELECT s.user_id INTO v_user_id FROM iam.resolve_session(p_session_token) s;
    SELECT t.source INTO v_source FROM paperbook.txn t WHERE t.id = p_id;

    IF v_source IS NULL THEN
        RAISE EXCEPTION 'paperbook: transaction % not found', p_id USING ERRCODE = '22023';
    END IF;
    IF v_source <> 'manual' THEN
        RAISE EXCEPTION 'paperbook: cannot edit imported transaction %', p_id USING ERRCODE = '22023';
    END IF;

    DELETE FROM paperbook.txn WHERE id = p_id;
    SELECT s.go_live_date INTO v_go_live FROM paperbook.settings s WHERE s.id = 1;
    RETURN paperbook._insert_txn(v_user_id, 'manual', NULL, v_go_live, v_today, p_txn);
END;
$$;

-- 8. delete_manual
CREATE OR REPLACE FUNCTION paperbook.delete_manual(
    p_session_token text,
    p_id bigint
)
RETURNS void
LANGUAGE plpgsql VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_source text;
BEGIN
    PERFORM 1 FROM iam.resolve_session(p_session_token);
    SELECT t.source INTO v_source FROM paperbook.txn t WHERE t.id = p_id;

    IF v_source IS NULL THEN
        RAISE EXCEPTION 'paperbook: transaction % not found', p_id USING ERRCODE = '22023';
    END IF;
    IF v_source <> 'manual' THEN
        RAISE EXCEPTION 'paperbook: cannot delete imported transaction %', p_id USING ERRCODE = '22023';
    END IF;

    DELETE FROM paperbook.txn WHERE id = p_id;
END;
$$;

-- Helper to escape LIKE wildcards per ws-d-skill §5
CREATE OR REPLACE FUNCTION paperbook._escape_like(p text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT replace(replace(replace(p, '\', '\\'), '%', '\%'), '_', '\_')
$$;

-- 9. list_txns
CREATE OR REPLACE FUNCTION paperbook.list_txns(
    p_session_token text,
    p_from date,
    p_to date,
    p_type text,
    p_paid text,
    p_source text,
    p_search text,
    p_sort text,
    p_limit integer,
    p_offset integer
)
RETURNS TABLE (
    id bigint,
    source text,
    batch_id bigint,
    excel_first_row integer,
    excel_txn_no text,
    txn_date date,
    txn_type text,
    is_paid boolean,
    party_raw text,
    party_label text,
    what_label text,
    benefit numeric(14,0),
    page_no text,
    note text,
    total numeric(14,0),
    line_count integer,
    total_count bigint
)
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_escaped_search text;
    v_sort text := CASE WHEN p_sort IN ('oldest', 'date_asc') THEN 'oldest' ELSE 'newest' END;
    v_paid text := CASE WHEN p_paid IN ('paid', 'true') THEN 'paid' WHEN p_paid IN ('not_paid', 'false') THEN 'not_paid' ELSE NULL END;
    v_limit integer := LEAST(GREATEST(coalesce(p_limit, 50), 1), 200);
    v_offset integer := GREATEST(coalesce(p_offset, 0), 0);
BEGIN
    PERFORM 1 FROM iam.resolve_session(p_session_token);

    IF p_type IS NOT NULL AND p_type NOT IN ('sell', 'buy', 'expense') THEN
        RAISE EXCEPTION 'paperbook: invalid type filter %', p_type USING ERRCODE = '22023';
    END IF;
    IF p_paid IS NOT NULL AND p_paid NOT IN ('paid', 'not_paid', 'true', 'false') THEN
        RAISE EXCEPTION 'paperbook: invalid paid filter %', p_paid USING ERRCODE = '22023';
    END IF;
    IF p_source IS NOT NULL AND p_source NOT IN ('import', 'manual') THEN
        RAISE EXCEPTION 'paperbook: invalid source filter %', p_source USING ERRCODE = '22023';
    END IF;
    IF p_sort IS NOT NULL AND p_sort NOT IN ('newest', 'oldest', 'date_desc', 'date_asc') THEN
        RAISE EXCEPTION 'paperbook: invalid sort %', p_sort USING ERRCODE = '22023';
    END IF;

    IF p_search IS NOT NULL AND btrim(p_search) <> '' THEN
        v_escaped_search := '%' || paperbook._escape_like(btrim(p_search)) || '%';
    ELSE
        v_escaped_search := NULL;
    END IF;

    RETURN QUERY
    WITH filtered_txns AS (
        SELECT
            t.id,
            t.source,
            t.batch_id,
            t.excel_first_row,
            t.excel_txn_no,
            t.txn_date,
            t.txn_type,
            t.is_paid,
            t.party_raw,
            coalesce(vl.effective_label, t.party_raw) AS party_label,
            t.benefit,
            t.page_no,
            t.note,
            t.total,
            (SELECT count(*)::integer FROM paperbook.txn_line tl WHERE tl.txn_id = t.id) AS line_count,
            (
                SELECT string_agg(
                    coalesce(v_line_prod.effective_label, tl.product_raw, '') ||
                    CASE WHEN tl.brand_raw IS NOT NULL THEN ' ' || coalesce(v_line_brand.effective_label, tl.brand_raw) ELSE '' END ||
                    CASE WHEN tl.details_raw IS NOT NULL THEN ' ' || coalesce(v_line_det.effective_label, tl.details_raw) ELSE '' END,
                    ' + '
                )
                FROM (
                    SELECT * FROM paperbook.txn_line tl_inner
                    WHERE tl_inner.txn_id = t.id
                    ORDER BY tl_inner.line_no ASC
                    LIMIT 1
                ) tl
                LEFT JOIN paperbook.v_labels v_line_prod ON v_line_prod.field = 'product' AND v_line_prod.raw_key = tl.product_key
                LEFT JOIN paperbook.v_labels v_line_brand ON v_line_brand.field = 'brand' AND v_line_brand.raw_key = tl.brand_key
                LEFT JOIN paperbook.v_labels v_line_det ON v_line_det.field = 'details' AND v_line_det.raw_key = tl.details_key
            ) AS first_line_desc
        FROM paperbook.txn t
        LEFT JOIN paperbook.v_labels vl ON vl.field = 'party' AND vl.raw_key = t.party_key
        WHERE (p_from IS NULL OR t.txn_date >= p_from)
          AND (p_to IS NULL OR t.txn_date <= p_to)
          AND (p_type IS NULL OR t.txn_type = p_type)
          AND (v_paid IS NULL OR (v_paid = 'paid' AND t.is_paid) OR (v_paid = 'not_paid' AND NOT t.is_paid))
          AND (p_source IS NULL OR t.source = p_source)
          AND (
              v_escaped_search IS NULL
              OR coalesce(vl.effective_label, t.party_raw, '') ILIKE v_escaped_search ESCAPE '\'
              OR t.party_raw ILIKE v_escaped_search ESCAPE '\'
              OR EXISTS (
                  SELECT 1 FROM paperbook.txn_line tl
                  LEFT JOIN paperbook.v_labels vlp ON vlp.field = 'product' AND vlp.raw_key = tl.product_key
                  LEFT JOIN paperbook.v_labels vlb ON vlb.field = 'brand' AND vlb.raw_key = tl.brand_key
                  LEFT JOIN paperbook.v_labels vld ON vld.field = 'details' AND vld.raw_key = tl.details_key
                  WHERE tl.txn_id = t.id
                    AND (
                        coalesce(vlp.effective_label, tl.product_raw, '') ILIKE v_escaped_search ESCAPE '\'
                        OR tl.product_raw ILIKE v_escaped_search ESCAPE '\'
                        OR coalesce(vlb.effective_label, tl.brand_raw, '') ILIKE v_escaped_search ESCAPE '\'
                        OR tl.brand_raw ILIKE v_escaped_search ESCAPE '\'
                        OR coalesce(vld.effective_label, tl.details_raw, '') ILIKE v_escaped_search ESCAPE '\'
                        OR tl.details_raw ILIKE v_escaped_search ESCAPE '\'
                    )
              )
          )
    )
    SELECT
        f.id,
        f.source,
        f.batch_id,
        f.excel_first_row,
        f.excel_txn_no,
        f.txn_date,
        f.txn_type,
        f.is_paid,
        f.party_raw,
        f.party_label,
        (coalesce(f.first_line_desc, '') || CASE WHEN f.line_count > 1 THEN ' (+' || (f.line_count - 1)::text || ')' ELSE '' END) AS what_label,
        f.benefit,
        f.page_no,
        f.note,
        f.total,
        f.line_count,
        count(*) OVER() AS total_count
    FROM filtered_txns f
    ORDER BY
        CASE WHEN v_sort = 'newest' THEN f.txn_date END DESC,
        CASE WHEN v_sort = 'newest' THEN f.id END DESC,
        CASE WHEN v_sort = 'oldest' THEN f.txn_date END ASC,
        CASE WHEN v_sort = 'oldest' THEN f.id END ASC
    LIMIT v_limit OFFSET v_offset;
END;
$$;

-- 10. list_totals
CREATE OR REPLACE FUNCTION paperbook.list_totals(
    p_session_token text,
    p_from date,
    p_to date,
    p_type text,
    p_paid text,
    p_source text,
    p_search text
)
RETURNS TABLE (
    txn_count bigint,
    sell_total numeric(14,0),
    buy_total numeric(14,0),
    expense_total numeric(14,0),
    benefit_total numeric(14,0),
    not_paid_total numeric(14,0)
)
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_escaped_search text;
    v_paid text := CASE WHEN p_paid IN ('paid', 'true') THEN 'paid' WHEN p_paid IN ('not_paid', 'false') THEN 'not_paid' ELSE NULL END;
BEGIN
    PERFORM 1 FROM iam.resolve_session(p_session_token);

    IF p_type IS NOT NULL AND p_type NOT IN ('sell', 'buy', 'expense') THEN
        RAISE EXCEPTION 'paperbook: invalid type filter %', p_type USING ERRCODE = '22023';
    END IF;
    IF p_paid IS NOT NULL AND p_paid NOT IN ('paid', 'not_paid', 'true', 'false') THEN
        RAISE EXCEPTION 'paperbook: invalid paid filter %', p_paid USING ERRCODE = '22023';
    END IF;
    IF p_source IS NOT NULL AND p_source NOT IN ('import', 'manual') THEN
        RAISE EXCEPTION 'paperbook: invalid source filter %', p_source USING ERRCODE = '22023';
    END IF;

    IF p_search IS NOT NULL AND btrim(p_search) <> '' THEN
        v_escaped_search := '%' || paperbook._escape_like(btrim(p_search)) || '%';
    ELSE
        v_escaped_search := NULL;
    END IF;

    RETURN QUERY
    SELECT
        count(*)::bigint AS txn_count,
        coalesce(sum(CASE WHEN t.txn_type = 'sell' THEN t.total ELSE 0 END), 0)::numeric(14,0) AS sell_total,
        coalesce(sum(CASE WHEN t.txn_type = 'buy' THEN t.total ELSE 0 END), 0)::numeric(14,0) AS buy_total,
        coalesce(sum(CASE WHEN t.txn_type = 'expense' THEN t.total ELSE 0 END), 0)::numeric(14,0) AS expense_total,
        coalesce(sum(CASE WHEN t.txn_type = 'sell' THEN coalesce(t.benefit, 0) ELSE 0 END), 0)::numeric(14,0) AS benefit_total,
        coalesce(sum(CASE WHEN NOT t.is_paid THEN t.total ELSE 0 END), 0)::numeric(14,0) AS not_paid_total
    FROM paperbook.txn t
    LEFT JOIN paperbook.v_labels vl ON vl.field = 'party' AND vl.raw_key = t.party_key
    WHERE (p_from IS NULL OR t.txn_date >= p_from)
      AND (p_to IS NULL OR t.txn_date <= p_to)
      AND (p_type IS NULL OR t.txn_type = p_type)
      AND (v_paid IS NULL OR (v_paid = 'paid' AND t.is_paid) OR (v_paid = 'not_paid' AND NOT t.is_paid))
      AND (p_source IS NULL OR t.source = p_source)
      AND (
          v_escaped_search IS NULL
          OR coalesce(vl.effective_label, t.party_raw, '') ILIKE v_escaped_search ESCAPE '\'
          OR t.party_raw ILIKE v_escaped_search ESCAPE '\'
          OR EXISTS (
              SELECT 1 FROM paperbook.txn_line tl
              LEFT JOIN paperbook.v_labels vlp ON vlp.field = 'product' AND vlp.raw_key = tl.product_key
              LEFT JOIN paperbook.v_labels vlb ON vlb.field = 'brand' AND vlb.raw_key = tl.brand_key
              LEFT JOIN paperbook.v_labels vld ON vld.field = 'details' AND vld.raw_key = tl.details_key
              WHERE tl.txn_id = t.id
                AND (
                    coalesce(vlp.effective_label, tl.product_raw, '') ILIKE v_escaped_search ESCAPE '\'
                    OR tl.product_raw ILIKE v_escaped_search ESCAPE '\'
                    OR coalesce(vlb.effective_label, tl.brand_raw, '') ILIKE v_escaped_search ESCAPE '\'
                    OR tl.brand_raw ILIKE v_escaped_search ESCAPE '\'
                    OR coalesce(vld.effective_label, tl.details_raw, '') ILIKE v_escaped_search ESCAPE '\'
                    OR tl.details_raw ILIKE v_escaped_search ESCAPE '\'
                )
          )
      );
END;
$$;

-- 11. get_txn
CREATE OR REPLACE FUNCTION paperbook.get_txn(p_session_token text, p_id bigint)
RETURNS TABLE (
    id bigint,
    source text,
    batch_id bigint,
    excel_first_row integer,
    excel_txn_no text,
    txn_date date,
    txn_type text,
    is_paid boolean,
    party_raw text,
    party_label text,
    benefit numeric(14,0),
    page_no text,
    note text,
    total numeric(14,0)
)
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    PERFORM 1 FROM iam.resolve_session(p_session_token);
    RETURN QUERY
    SELECT
        t.id, t.source, t.batch_id, t.excel_first_row, t.excel_txn_no,
        t.txn_date, t.txn_type, t.is_paid, t.party_raw,
        coalesce(vl.effective_label, t.party_raw) AS party_label,
        t.benefit, t.page_no, t.note, t.total
    FROM paperbook.txn t
    LEFT JOIN paperbook.v_labels vl ON vl.field = 'party' AND vl.raw_key = t.party_key
    WHERE t.id = p_id;
END;
$$;

-- 12. get_txn_lines
CREATE OR REPLACE FUNCTION paperbook.get_txn_lines(p_session_token text, p_id bigint)
RETURNS TABLE (
    id bigint,
    line_no integer,
    excel_row integer,
    product_raw text,
    product_label text,
    brand_raw text,
    brand_label text,
    details_raw text,
    details_label text,
    quantity numeric(14,0),
    unit_price numeric(14,0),
    line_total numeric(14,0),
    total_overridden boolean,
    page_no text
)
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    PERFORM 1 FROM iam.resolve_session(p_session_token);
    RETURN QUERY
    SELECT
        tl.id, tl.line_no, tl.excel_row,
        tl.product_raw, coalesce(vp.effective_label, tl.product_raw) AS product_label,
        tl.brand_raw, coalesce(vb.effective_label, tl.brand_raw) AS brand_label,
        tl.details_raw, coalesce(vd.effective_label, tl.details_raw) AS details_label,
        tl.quantity, tl.unit_price, tl.line_total, tl.total_overridden, tl.page_no
    FROM paperbook.txn_line tl
    LEFT JOIN paperbook.v_labels vp ON vp.field = 'product' AND vp.raw_key = tl.product_key
    LEFT JOIN paperbook.v_labels vb ON vb.field = 'brand' AND vb.raw_key = tl.brand_key
    LEFT JOIN paperbook.v_labels vd ON vd.field = 'details' AND vd.raw_key = tl.details_key
    WHERE tl.txn_id = p_id
    ORDER BY tl.line_no ASC;
END;
$$;

-- 13. autocomplete
CREATE OR REPLACE FUNCTION paperbook.autocomplete(
    p_session_token text,
    p_field text,
    p_text text,
    p_limit integer
)
RETURNS TABLE (label text)
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_escaped text;
    v_lim integer := LEAST(GREATEST(coalesce(p_limit, 10), 1), 10);
BEGIN
    PERFORM 1 FROM iam.resolve_session(p_session_token);
    IF p_field NOT IN ('party', 'product', 'brand', 'details') THEN
        RAISE EXCEPTION 'paperbook: invalid field %', p_field USING ERRCODE = '22023';
    END IF;

    IF p_text IS NOT NULL AND btrim(p_text) <> '' THEN
        v_escaped := '%' || paperbook._escape_like(btrim(p_text)) || '%';
    ELSE
        v_escaped := '%';
    END IF;

    RETURN QUERY
    SELECT DISTINCT vl.effective_label AS label
    FROM paperbook.v_labels vl
    WHERE vl.field = p_field
      AND (vl.effective_label ILIKE v_escaped ESCAPE '\' OR vl.raw_label ILIKE v_escaped ESCAPE '\')
    ORDER BY label ASC
    LIMIT v_lim;
END;
$$;

-- 14. list_names
CREATE OR REPLACE FUNCTION paperbook.list_names(
    p_session_token text,
    p_field text,
    p_search text,
    p_limit integer,
    p_offset integer
)
RETURNS TABLE (
    raw_key text,
    raw_label text,
    usage_count bigint,
    effective_key text,
    effective_label text,
    is_mapped boolean,
    total_count bigint
)
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_escaped text;
    v_lim integer := LEAST(GREATEST(coalesce(p_limit, 50), 1), 200);
    v_off integer := GREATEST(coalesce(p_offset, 0), 0);
BEGIN
    PERFORM 1 FROM iam.resolve_session(p_session_token);
    IF p_field NOT IN ('party', 'product', 'brand', 'details') THEN
        RAISE EXCEPTION 'paperbook: invalid field %', p_field USING ERRCODE = '22023';
    END IF;

    IF p_search IS NOT NULL AND btrim(p_search) <> '' THEN
        v_escaped := '%' || paperbook._escape_like(btrim(p_search)) || '%';
    ELSE
        v_escaped := NULL;
    END IF;

    RETURN QUERY
    SELECT
        vl.raw_key,
        vl.raw_label,
        vl.usage_count,
        vl.effective_key,
        vl.effective_label,
        vl.is_mapped,
        count(*) OVER() AS total_count
    FROM paperbook.v_labels vl
    WHERE vl.field = p_field
      AND (
          v_escaped IS NULL
          OR vl.raw_label ILIKE v_escaped ESCAPE '\'
          OR vl.effective_label ILIKE v_escaped ESCAPE '\'
      )
    ORDER BY vl.usage_count DESC, vl.raw_label ASC
    LIMIT v_lim OFFSET v_off;
END;
$$;

-- 15. list_effective_keys
CREATE OR REPLACE FUNCTION paperbook.list_effective_keys(
    p_session_token text,
    p_field text
)
RETURNS TABLE (
    effective_key text,
    label text,
    usage_count bigint
)
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    PERFORM 1 FROM iam.resolve_session(p_session_token);
    IF p_field NOT IN ('party', 'product', 'brand', 'details') THEN
        RAISE EXCEPTION 'paperbook: invalid field %', p_field USING ERRCODE = '22023';
    END IF;

    RETURN QUERY
    SELECT
        vl.effective_key,
        vl.effective_label AS label,
        sum(vl.usage_count)::bigint AS usage_count
    FROM paperbook.v_labels vl
    WHERE vl.field = p_field
    GROUP BY vl.effective_key, vl.effective_label
    ORDER BY usage_count DESC, label ASC;
END;
$$;

-- 16. list_dismissed
CREATE OR REPLACE FUNCTION paperbook.list_dismissed(
    p_session_token text,
    p_field text
)
RETURNS TABLE (key_a text, key_b text)
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    PERFORM 1 FROM iam.resolve_session(p_session_token);
    RETURN QUERY
    SELECT d.key_a, d.key_b
    FROM paperbook.name_dismissed d
    WHERE d.field = p_field
    ORDER BY d.key_a, d.key_b;
END;
$$;

-- 17. set_name_map
CREATE OR REPLACE FUNCTION paperbook.set_name_map(
    p_session_token text,
    p_field text,
    p_raw_key text,
    p_label text
)
RETURNS void
LANGUAGE plpgsql VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_user_id bigint;
    v_target_key text;
    v_existing_label text;
    v_label_to_use text;
BEGIN
    SELECT s.user_id INTO v_user_id FROM iam.resolve_session(p_session_token) s;
    IF p_field NOT IN ('party', 'product', 'brand', 'details') THEN
        RAISE EXCEPTION 'paperbook: invalid field %', p_field USING ERRCODE = '22023';
    END IF;

    v_target_key := paperbook.normalize_key(p_label);
    IF v_target_key IS NULL THEN
        RAISE EXCEPTION 'paperbook: canonical label cannot be blank' USING ERRCODE = '22023';
    END IF;

    -- Avoid mapping chains: if v_target_key has an existing mapping to L2, use L2
    SELECT nm.canonical_label INTO v_existing_label
    FROM paperbook.name_map nm
    WHERE nm.field = p_field AND nm.raw_key = v_target_key;

    v_label_to_use := coalesce(v_existing_label, paperbook.clean_text(p_label));

    -- Upsert mapping
    INSERT INTO paperbook.name_map (field, raw_key, canonical_label, created_by)
    VALUES (p_field, p_raw_key, v_label_to_use, v_user_id)
    ON CONFLICT (field, raw_key)
    DO UPDATE SET canonical_label = EXCLUDED.canonical_label, created_at = now(), created_by = EXCLUDED.created_by;

    -- Update any existing mappings in the same field whose canonical_key equals p_raw_key
    UPDATE paperbook.name_map
    SET canonical_label = v_label_to_use
    WHERE field = p_field AND canonical_key = p_raw_key;
END;
$$;

-- 18. remove_name_map
CREATE OR REPLACE FUNCTION paperbook.remove_name_map(
    p_session_token text,
    p_field text,
    p_raw_key text
)
RETURNS void
LANGUAGE plpgsql VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    PERFORM 1 FROM iam.resolve_session(p_session_token);
    DELETE FROM paperbook.name_map
    WHERE field = p_field AND raw_key = p_raw_key;
END;
$$;

-- 19. dismiss_suggestion
CREATE OR REPLACE FUNCTION paperbook.dismiss_suggestion(
    p_session_token text,
    p_field text,
    p_key_a text,
    p_key_b text
)
RETURNS void
LANGUAGE plpgsql VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_a text := LEAST(p_key_a, p_key_b);
    v_b text := GREATEST(p_key_a, p_key_b);
BEGIN
    PERFORM 1 FROM iam.resolve_session(p_session_token);
    IF p_field NOT IN ('party', 'product', 'brand', 'details') THEN
        RAISE EXCEPTION 'paperbook: invalid field %', p_field USING ERRCODE = '22023';
    END IF;
    IF v_a = v_b THEN
        RETURN;
    END IF;

    INSERT INTO paperbook.name_dismissed (field, key_a, key_b)
    VALUES (p_field, v_a, v_b)
    ON CONFLICT (field, key_a, key_b) DO NOTHING;
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. Permissions and Execution Grants
-- ----------------------------------------------------------------------------

REVOKE ALL ON FUNCTION paperbook.get_settings(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION paperbook.set_go_live_date(text, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION paperbook.import_status(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION paperbook.manual_signatures(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION paperbook.import_replace(text, text, text, text, integer, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION paperbook.create_manual(text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION paperbook.update_manual(text, bigint, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION paperbook.delete_manual(text, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION paperbook._escape_like(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION paperbook.list_txns(text, date, date, text, text, text, text, text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION paperbook.list_totals(text, date, date, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION paperbook.get_txn(text, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION paperbook.get_txn_lines(text, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION paperbook.autocomplete(text, text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION paperbook.list_names(text, text, text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION paperbook.list_effective_keys(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION paperbook.list_dismissed(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION paperbook.set_name_map(text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION paperbook.remove_name_map(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION paperbook.dismiss_suggestion(text, text, text, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION paperbook.get_settings(text) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION paperbook.set_go_live_date(text, date) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION paperbook.import_status(text) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION paperbook.manual_signatures(text) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION paperbook.import_replace(text, text, text, text, integer, jsonb) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION paperbook.create_manual(text, jsonb) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION paperbook.update_manual(text, bigint, jsonb) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION paperbook.delete_manual(text, bigint) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION paperbook._escape_like(text) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION paperbook.list_txns(text, date, date, text, text, text, text, text, integer, integer) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION paperbook.list_totals(text, date, date, text, text, text, text) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION paperbook.get_txn(text, bigint) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION paperbook.get_txn_lines(text, bigint) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION paperbook.autocomplete(text, text, text, integer) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION paperbook.list_names(text, text, text, integer, integer) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION paperbook.list_effective_keys(text, text) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION paperbook.list_dismissed(text, text) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION paperbook.set_name_map(text, text, text, text) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION paperbook.remove_name_map(text, text, text) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION paperbook.dismiss_suggestion(text, text, text, text) TO stockiha_runtime;

GRANT USAGE ON SCHEMA paperbook TO stockiha_runtime;
GRANT USAGE ON SCHEMA paperbook TO stockiha_backup;
GRANT SELECT ON ALL TABLES IN SCHEMA paperbook TO stockiha_backup;
