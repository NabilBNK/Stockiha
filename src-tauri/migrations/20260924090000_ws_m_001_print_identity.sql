-- WS-M-1: shop identity, print settings and logo bookkeeping.
--
-- Adds the shop's legal identity (legal name, email, website, NIF, NIS, RC,
-- AI, RIB), the logo file name, the print language, the A4 display toggles,
-- and the amount-in-words toggle to core.printing_settings. Nothing about
-- printed layout changes here (that is WS-M-2) -- this migration only makes
-- the identity data enterable and saveable.
--
-- The write function signature changes from 9 positional arguments to a
-- single jsonb payload (core.save_printing_settings(text, jsonb)) because a
-- 25-argument function is unreadable. The old 9-argument function is
-- dropped; the Rust command and the settings screen change in the same
-- commit so the app keeps working end to end.

SET ROLE stockiha_owner;

-- =============================================================================
-- 1. New columns on core.printing_settings
-- =============================================================================

ALTER TABLE core.printing_settings
    ADD COLUMN IF NOT EXISTS shop_legal_name text,
    ADD COLUMN IF NOT EXISTS shop_email text,
    ADD COLUMN IF NOT EXISTS shop_website text,
    ADD COLUMN IF NOT EXISTS tax_id_nif text,
    ADD COLUMN IF NOT EXISTS tax_id_nis text,
    ADD COLUMN IF NOT EXISTS trade_register_rc text,
    ADD COLUMN IF NOT EXISTS article_imposition_ai text,
    ADD COLUMN IF NOT EXISTS bank_account_rib text,
    ADD COLUMN IF NOT EXISTS logo_file_name text,
    ADD COLUMN IF NOT EXISTS logo_updated_at timestamptz,
    ADD COLUMN IF NOT EXISTS print_language text NOT NULL DEFAULT 'FOLLOW_APP',
    ADD COLUMN IF NOT EXISTS show_logo boolean NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS show_email boolean NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS show_website boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS show_rib boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS amount_in_words boolean NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS a4_footer_note text;

ALTER TABLE core.printing_settings
    DROP CONSTRAINT IF EXISTS printing_settings_print_language_valid;
ALTER TABLE core.printing_settings
    ADD CONSTRAINT printing_settings_print_language_valid
    CHECK (print_language IN ('FOLLOW_APP', 'fr', 'ar', 'en'));

-- Length constraints, each re-runnable.
ALTER TABLE core.printing_settings DROP CONSTRAINT IF EXISTS printing_settings_shop_legal_name_length;
ALTER TABLE core.printing_settings ADD CONSTRAINT printing_settings_shop_legal_name_length
    CHECK (shop_legal_name IS NULL OR char_length(shop_legal_name) <= 120);

ALTER TABLE core.printing_settings DROP CONSTRAINT IF EXISTS printing_settings_shop_email_length;
ALTER TABLE core.printing_settings ADD CONSTRAINT printing_settings_shop_email_length
    CHECK (shop_email IS NULL OR char_length(shop_email) <= 120);

ALTER TABLE core.printing_settings DROP CONSTRAINT IF EXISTS printing_settings_shop_website_length;
ALTER TABLE core.printing_settings ADD CONSTRAINT printing_settings_shop_website_length
    CHECK (shop_website IS NULL OR char_length(shop_website) <= 120);

ALTER TABLE core.printing_settings DROP CONSTRAINT IF EXISTS printing_settings_tax_id_nif_length;
ALTER TABLE core.printing_settings ADD CONSTRAINT printing_settings_tax_id_nif_length
    CHECK (tax_id_nif IS NULL OR char_length(tax_id_nif) <= 40);

ALTER TABLE core.printing_settings DROP CONSTRAINT IF EXISTS printing_settings_tax_id_nis_length;
ALTER TABLE core.printing_settings ADD CONSTRAINT printing_settings_tax_id_nis_length
    CHECK (tax_id_nis IS NULL OR char_length(tax_id_nis) <= 40);

ALTER TABLE core.printing_settings DROP CONSTRAINT IF EXISTS printing_settings_trade_register_rc_length;
ALTER TABLE core.printing_settings ADD CONSTRAINT printing_settings_trade_register_rc_length
    CHECK (trade_register_rc IS NULL OR char_length(trade_register_rc) <= 60);

ALTER TABLE core.printing_settings DROP CONSTRAINT IF EXISTS printing_settings_article_imposition_ai_length;
ALTER TABLE core.printing_settings ADD CONSTRAINT printing_settings_article_imposition_ai_length
    CHECK (article_imposition_ai IS NULL OR char_length(article_imposition_ai) <= 40);

ALTER TABLE core.printing_settings DROP CONSTRAINT IF EXISTS printing_settings_bank_account_rib_length;
ALTER TABLE core.printing_settings ADD CONSTRAINT printing_settings_bank_account_rib_length
    CHECK (bank_account_rib IS NULL OR char_length(bank_account_rib) <= 60);

ALTER TABLE core.printing_settings DROP CONSTRAINT IF EXISTS printing_settings_logo_file_name_length;
ALTER TABLE core.printing_settings ADD CONSTRAINT printing_settings_logo_file_name_length
    CHECK (logo_file_name IS NULL OR char_length(logo_file_name) <= 80);

ALTER TABLE core.printing_settings DROP CONSTRAINT IF EXISTS printing_settings_a4_footer_note_length;
ALTER TABLE core.printing_settings ADD CONSTRAINT printing_settings_a4_footer_note_length
    CHECK (a4_footer_note IS NULL OR char_length(a4_footer_note) <= 200);

-- =============================================================================
-- 2. Read (base copied from 20260913090000_ws_f_002_printing_settings.sql so
--    no existing key disappears, plus every new column).
-- =============================================================================

CREATE OR REPLACE FUNCTION core.get_printing_settings(p_session_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_result jsonb;
BEGIN
    PERFORM 1 FROM iam.resolve_session(p_session_token);

    SELECT jsonb_build_object(
        'receipt_printing_enabled', settings.receipt_printing_enabled,
        'receipt_target', settings.receipt_target,
        'thermal_printer_name', settings.thermal_printer_name,
        'thermal_columns', settings.thermal_columns,
        'shop_name', settings.shop_name,
        'shop_address', settings.shop_address,
        'shop_phone', settings.shop_phone,
        'receipt_footer', settings.receipt_footer,
        'updated_at', settings.updated_at,
        'shop_legal_name', settings.shop_legal_name,
        'shop_email', settings.shop_email,
        'shop_website', settings.shop_website,
        'tax_id_nif', settings.tax_id_nif,
        'tax_id_nis', settings.tax_id_nis,
        'trade_register_rc', settings.trade_register_rc,
        'article_imposition_ai', settings.article_imposition_ai,
        'bank_account_rib', settings.bank_account_rib,
        'logo_file_name', settings.logo_file_name,
        'logo_updated_at', settings.logo_updated_at,
        'print_language', settings.print_language,
        'show_logo', settings.show_logo,
        'show_email', settings.show_email,
        'show_website', settings.show_website,
        'show_rib', settings.show_rib,
        'amount_in_words', settings.amount_in_words,
        'a4_footer_note', settings.a4_footer_note
    )
    INTO v_result
    FROM core.printing_settings settings
    WHERE settings.id = 1;

    RETURN v_result;
END;
$$;

-- =============================================================================
-- 3. Write -- new jsonb-payload signature; the old 9-argument function is
--    dropped in the same migration as the Rust/TypeScript callers change.
-- =============================================================================

DROP FUNCTION IF EXISTS core.save_printing_settings(text, boolean, text, text, smallint, text, text, text, text);

CREATE OR REPLACE FUNCTION core.save_printing_settings(p_session_token text, p_settings jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_user_id bigint;
    v_receipt_printing_enabled boolean;
    v_receipt_target text;
    v_thermal_printer_name text;
    v_thermal_columns smallint;
    v_shop_name text;
    v_shop_address text;
    v_shop_phone text;
    v_receipt_footer text;
    v_shop_legal_name text;
    v_shop_email text;
    v_shop_website text;
    v_tax_id_nif text;
    v_tax_id_nis text;
    v_trade_register_rc text;
    v_article_imposition_ai text;
    v_bank_account_rib text;
    v_print_language text;
    v_show_logo boolean;
    v_show_email boolean;
    v_show_website boolean;
    v_show_rib boolean;
    v_amount_in_words boolean;
    v_a4_footer_note text;
    v_current core.printing_settings%ROWTYPE;
BEGIN
    SELECT user_id INTO v_user_id
    FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_PRINTING_SETTINGS');

    IF jsonb_typeof(p_settings) IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: settings payload must be a JSON object'
            USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_current FROM core.printing_settings WHERE id = 1;

    -- Not-null fields: a present key with an explicit JSON null is invalid,
    -- because these columns cannot become null. A missing key keeps the
    -- current value (`p_settings ? 'key'` tells "missing" apart from
    -- "explicit null" -- `->>'key'` alone returns NULL for both).
    IF p_settings ? 'receipt_printing_enabled' THEN
        v_receipt_printing_enabled := (p_settings->>'receipt_printing_enabled')::boolean;
        IF v_receipt_printing_enabled IS NULL THEN
            RAISE EXCEPTION 'VALIDATION_ERROR: receipt_printing_enabled cannot be null'
                USING ERRCODE = '22023';
        END IF;
    ELSE
        v_receipt_printing_enabled := v_current.receipt_printing_enabled;
    END IF;

    IF p_settings ? 'receipt_target' THEN
        v_receipt_target := p_settings->>'receipt_target';
    ELSE
        v_receipt_target := v_current.receipt_target;
    END IF;
    IF v_receipt_target IS NULL OR v_receipt_target NOT IN ('THERMAL', 'A4') THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: receipt target must be THERMAL or A4'
            USING ERRCODE = '22023';
    END IF;

    IF p_settings ? 'thermal_columns' THEN
        v_thermal_columns := (p_settings->>'thermal_columns')::smallint;
    ELSE
        v_thermal_columns := v_current.thermal_columns;
    END IF;
    IF v_thermal_columns IS NULL OR v_thermal_columns NOT IN (32, 42, 48) THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: thermal width must be 32, 42 or 48 characters'
            USING ERRCODE = '22023';
    END IF;

    IF p_settings ? 'print_language' THEN
        v_print_language := p_settings->>'print_language';
        IF v_print_language IS NULL THEN
            RAISE EXCEPTION 'VALIDATION_ERROR: print_language cannot be null'
                USING ERRCODE = '22023';
        END IF;
    ELSE
        v_print_language := v_current.print_language;
    END IF;
    IF v_print_language NOT IN ('FOLLOW_APP', 'fr', 'ar', 'en') THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: print_language must be FOLLOW_APP, fr, ar or en'
            USING ERRCODE = '22023';
    END IF;

    IF p_settings ? 'show_logo' THEN
        v_show_logo := (p_settings->>'show_logo')::boolean;
        IF v_show_logo IS NULL THEN
            RAISE EXCEPTION 'VALIDATION_ERROR: show_logo cannot be null' USING ERRCODE = '22023';
        END IF;
    ELSE
        v_show_logo := v_current.show_logo;
    END IF;

    IF p_settings ? 'show_email' THEN
        v_show_email := (p_settings->>'show_email')::boolean;
        IF v_show_email IS NULL THEN
            RAISE EXCEPTION 'VALIDATION_ERROR: show_email cannot be null' USING ERRCODE = '22023';
        END IF;
    ELSE
        v_show_email := v_current.show_email;
    END IF;

    IF p_settings ? 'show_website' THEN
        v_show_website := (p_settings->>'show_website')::boolean;
        IF v_show_website IS NULL THEN
            RAISE EXCEPTION 'VALIDATION_ERROR: show_website cannot be null' USING ERRCODE = '22023';
        END IF;
    ELSE
        v_show_website := v_current.show_website;
    END IF;

    IF p_settings ? 'show_rib' THEN
        v_show_rib := (p_settings->>'show_rib')::boolean;
        IF v_show_rib IS NULL THEN
            RAISE EXCEPTION 'VALIDATION_ERROR: show_rib cannot be null' USING ERRCODE = '22023';
        END IF;
    ELSE
        v_show_rib := v_current.show_rib;
    END IF;

    IF p_settings ? 'amount_in_words' THEN
        v_amount_in_words := (p_settings->>'amount_in_words')::boolean;
        IF v_amount_in_words IS NULL THEN
            RAISE EXCEPTION 'VALIDATION_ERROR: amount_in_words cannot be null'
                USING ERRCODE = '22023';
        END IF;
    ELSE
        v_amount_in_words := v_current.amount_in_words;
    END IF;

    -- Nullable text fields: trimmed, empty string or explicit null both
    -- become NULL (this is what "missing key keeps the value, explicit null
    -- clears it" means for these columns).
    IF p_settings ? 'thermal_printer_name' THEN
        v_thermal_printer_name := nullif(btrim(coalesce(p_settings->>'thermal_printer_name', '')), '');
    ELSE
        v_thermal_printer_name := v_current.thermal_printer_name;
    END IF;

    IF v_receipt_printing_enabled AND v_receipt_target = 'THERMAL' AND v_thermal_printer_name IS NULL THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: a thermal printer name is required when thermal printing is on'
            USING ERRCODE = '22023';
    END IF;

    IF p_settings ? 'shop_name' THEN
        v_shop_name := nullif(btrim(coalesce(p_settings->>'shop_name', '')), '');
    ELSE
        v_shop_name := v_current.shop_name;
    END IF;

    IF p_settings ? 'shop_address' THEN
        v_shop_address := nullif(btrim(coalesce(p_settings->>'shop_address', '')), '');
    ELSE
        v_shop_address := v_current.shop_address;
    END IF;

    IF p_settings ? 'shop_phone' THEN
        v_shop_phone := nullif(btrim(coalesce(p_settings->>'shop_phone', '')), '');
    ELSE
        v_shop_phone := v_current.shop_phone;
    END IF;

    IF p_settings ? 'receipt_footer' THEN
        v_receipt_footer := nullif(btrim(coalesce(p_settings->>'receipt_footer', '')), '');
    ELSE
        v_receipt_footer := v_current.receipt_footer;
    END IF;

    IF p_settings ? 'shop_legal_name' THEN
        v_shop_legal_name := nullif(btrim(coalesce(p_settings->>'shop_legal_name', '')), '');
    ELSE
        v_shop_legal_name := v_current.shop_legal_name;
    END IF;
    IF v_shop_legal_name IS NOT NULL AND char_length(v_shop_legal_name) > 120 THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: shop_legal_name is too long' USING ERRCODE = '22023';
    END IF;

    IF p_settings ? 'shop_email' THEN
        v_shop_email := nullif(btrim(coalesce(p_settings->>'shop_email', '')), '');
    ELSE
        v_shop_email := v_current.shop_email;
    END IF;
    IF v_shop_email IS NOT NULL THEN
        IF char_length(v_shop_email) > 120 THEN
            RAISE EXCEPTION 'VALIDATION_ERROR: shop_email is too long' USING ERRCODE = '22023';
        END IF;
        IF v_shop_email !~ '^[^@]+@[^@]+$' THEN
            RAISE EXCEPTION 'VALIDATION_ERROR: shop_email must contain exactly one @ with text either side'
                USING ERRCODE = '22023';
        END IF;
    END IF;

    IF p_settings ? 'shop_website' THEN
        v_shop_website := nullif(btrim(coalesce(p_settings->>'shop_website', '')), '');
    ELSE
        v_shop_website := v_current.shop_website;
    END IF;
    IF v_shop_website IS NOT NULL AND char_length(v_shop_website) > 120 THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: shop_website is too long' USING ERRCODE = '22023';
    END IF;

    IF p_settings ? 'tax_id_nif' THEN
        v_tax_id_nif := nullif(btrim(coalesce(p_settings->>'tax_id_nif', '')), '');
    ELSE
        v_tax_id_nif := v_current.tax_id_nif;
    END IF;
    IF v_tax_id_nif IS NOT NULL AND char_length(v_tax_id_nif) > 40 THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: tax_id_nif is too long' USING ERRCODE = '22023';
    END IF;

    IF p_settings ? 'tax_id_nis' THEN
        v_tax_id_nis := nullif(btrim(coalesce(p_settings->>'tax_id_nis', '')), '');
    ELSE
        v_tax_id_nis := v_current.tax_id_nis;
    END IF;
    IF v_tax_id_nis IS NOT NULL AND char_length(v_tax_id_nis) > 40 THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: tax_id_nis is too long' USING ERRCODE = '22023';
    END IF;

    IF p_settings ? 'trade_register_rc' THEN
        v_trade_register_rc := nullif(btrim(coalesce(p_settings->>'trade_register_rc', '')), '');
    ELSE
        v_trade_register_rc := v_current.trade_register_rc;
    END IF;
    IF v_trade_register_rc IS NOT NULL AND char_length(v_trade_register_rc) > 60 THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: trade_register_rc is too long' USING ERRCODE = '22023';
    END IF;

    IF p_settings ? 'article_imposition_ai' THEN
        v_article_imposition_ai := nullif(btrim(coalesce(p_settings->>'article_imposition_ai', '')), '');
    ELSE
        v_article_imposition_ai := v_current.article_imposition_ai;
    END IF;
    IF v_article_imposition_ai IS NOT NULL AND char_length(v_article_imposition_ai) > 40 THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: article_imposition_ai is too long' USING ERRCODE = '22023';
    END IF;

    IF p_settings ? 'bank_account_rib' THEN
        v_bank_account_rib := nullif(btrim(coalesce(p_settings->>'bank_account_rib', '')), '');
    ELSE
        v_bank_account_rib := v_current.bank_account_rib;
    END IF;
    IF v_bank_account_rib IS NOT NULL AND char_length(v_bank_account_rib) > 60 THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: bank_account_rib is too long' USING ERRCODE = '22023';
    END IF;

    IF p_settings ? 'a4_footer_note' THEN
        v_a4_footer_note := nullif(btrim(coalesce(p_settings->>'a4_footer_note', '')), '');
    ELSE
        v_a4_footer_note := v_current.a4_footer_note;
    END IF;
    IF v_a4_footer_note IS NOT NULL AND char_length(v_a4_footer_note) > 200 THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: a4_footer_note is too long' USING ERRCODE = '22023';
    END IF;

    -- logo_file_name / logo_updated_at are set only through
    -- core.set_printing_logo(); any such keys in p_settings are ignored.

    UPDATE core.printing_settings
    SET receipt_printing_enabled = v_receipt_printing_enabled,
        receipt_target = v_receipt_target,
        thermal_printer_name = v_thermal_printer_name,
        thermal_columns = v_thermal_columns,
        shop_name = v_shop_name,
        shop_address = v_shop_address,
        shop_phone = v_shop_phone,
        receipt_footer = v_receipt_footer,
        shop_legal_name = v_shop_legal_name,
        shop_email = v_shop_email,
        shop_website = v_shop_website,
        tax_id_nif = v_tax_id_nif,
        tax_id_nis = v_tax_id_nis,
        trade_register_rc = v_trade_register_rc,
        article_imposition_ai = v_article_imposition_ai,
        bank_account_rib = v_bank_account_rib,
        print_language = v_print_language,
        show_logo = v_show_logo,
        show_email = v_show_email,
        show_website = v_show_website,
        show_rib = v_show_rib,
        amount_in_words = v_amount_in_words,
        a4_footer_note = v_a4_footer_note,
        updated_at = now(),
        updated_by_user_id = v_user_id
    WHERE id = 1;

    RETURN core.get_printing_settings(p_session_token);
END;
$$;

-- =============================================================================
-- 4. Logo bookkeeping
-- =============================================================================

CREATE OR REPLACE FUNCTION core.set_printing_logo(p_session_token text, p_file_name text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_user_id bigint;
BEGIN
    SELECT user_id INTO v_user_id
    FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_PRINTING_SETTINGS');

    IF p_file_name IS NULL THEN
        UPDATE core.printing_settings
        SET logo_file_name = NULL,
            logo_updated_at = NULL,
            updated_at = now(),
            updated_by_user_id = v_user_id
        WHERE id = 1;
    ELSE
        IF p_file_name !~ '^[A-Za-z0-9._-]{1,80}$'
           OR p_file_name !~* '\.(png|jpe?g|webp)$' THEN
            RAISE EXCEPTION 'VALIDATION_ERROR: logo file name is not a supported image file name'
                USING ERRCODE = '22023';
        END IF;

        UPDATE core.printing_settings
        SET logo_file_name = p_file_name,
            logo_updated_at = now(),
            updated_at = now(),
            updated_by_user_id = v_user_id
        WHERE id = 1;
    END IF;

    RETURN core.get_printing_settings(p_session_token);
END;
$$;

-- =============================================================================
-- 5. Privileges
-- =============================================================================

REVOKE ALL ON FUNCTION core.get_printing_settings(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION core.save_printing_settings(text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION core.set_printing_logo(text, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION core.get_printing_settings(text) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION core.save_printing_settings(text, jsonb) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION core.set_printing_logo(text, text) TO stockiha_runtime;

-- =============================================================================
-- 6. Schema state
-- =============================================================================

UPDATE operations.schema_state SET migration_version = 20260924090000, updated_at = now() WHERE singleton;

RESET ROLE;
