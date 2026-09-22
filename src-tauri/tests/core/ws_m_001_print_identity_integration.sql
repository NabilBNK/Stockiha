-- WS-M-001 Integration Test: shop identity, print settings and logo bookkeeping.
-- Runs inside the transaction owned by run_current_sql_suites.sh.
\set ON_ERROR_STOP on

DO $$
DECLARE
    v_suffix text := floor(random() * 1000000000)::bigint::text;
    v_workstation text := 'WSM001-WKS-' || v_suffix;
    v_manager_username text := 'wsm001_manager_' || v_suffix;
    v_manager_token text := 'wsm001_manager_token_' || v_suffix;
    v_manager_id bigint;
    v_cashier_username text := 'wsm001_cashier_' || v_suffix;
    v_cashier_token text := 'wsm001_cashier_token_' || v_suffix;
    v_cashier_id bigint;
    v_result jsonb;
    v_before jsonb;
    v_permission_denied boolean;
    v_key text;
BEGIN
    RAISE NOTICE '=== Running WS-M-001 print identity integration suite ===';

    -- Fixture users, roles and sessions --------------------------------------
    INSERT INTO iam.users (username, display_name, password_hash)
    VALUES (v_manager_username, 'WS-M-001 Manager', 'hash')
    RETURNING id INTO v_manager_id;
    INSERT INTO iam.user_roles (user_id, role_id)
    SELECT v_manager_id, id FROM iam.roles WHERE code = 'MANAGER';
    INSERT INTO iam.application_sessions (user_id, workstation_id, token_hash, expires_at)
    VALUES (v_manager_id, v_workstation, sha256(v_manager_token::bytea), now() + interval '2 hours');

    INSERT INTO iam.users (username, display_name, password_hash)
    VALUES (v_cashier_username, 'WS-M-001 Cashier', 'hash')
    RETURNING id INTO v_cashier_id;
    INSERT INTO iam.user_roles (user_id, role_id)
    SELECT v_cashier_id, id FROM iam.roles WHERE code = 'CASHIER';
    INSERT INTO iam.application_sessions (user_id, workstation_id, token_hash, expires_at)
    VALUES (v_cashier_id, v_workstation, sha256(v_cashier_token::bytea), now() + interval '2 hours');

    -- 1. A manager can save; a cashier is denied. ----------------------------
    -- The default row has receipt_printing_enabled = true, receipt_target =
    -- THERMAL, and no thermal_printer_name yet, so the first save must also
    -- supply one -- the same precondition the pre-WS-M-1 function already
    -- enforced (a thermal printer name is required while thermal printing
    -- is on).
    v_result := core.save_printing_settings(v_manager_token, jsonb_build_object(
        'shop_name', 'WS-M-001 Shop',
        'shop_legal_name', 'WS-M-001 SARL',
        'thermal_printer_name', 'WS-M-001 Test Printer'
    ));
    IF v_result ->> 'shop_legal_name' IS DISTINCT FROM 'WS-M-001 SARL' THEN
        RAISE EXCEPTION 'Assertion failed (1a): manager save did not persist shop_legal_name';
    END IF;

    v_permission_denied := false;
    BEGIN
        PERFORM core.save_printing_settings(v_cashier_token, jsonb_build_object('shop_name', 'Denied'));
    EXCEPTION WHEN insufficient_privilege THEN
        v_permission_denied := true;
    END;
    IF NOT v_permission_denied THEN
        RAISE EXCEPTION 'Assertion failed (1b): a cashier must not be able to save printing settings';
    END IF;

    -- 2. A partial payload changes only that column. -------------------------
    v_before := core.get_printing_settings(v_manager_token);
    v_result := core.save_printing_settings(v_manager_token, jsonb_build_object('tax_id_nif', '123456789'));
    IF v_result ->> 'tax_id_nif' IS DISTINCT FROM '123456789' THEN
        RAISE EXCEPTION 'Assertion failed (2a): tax_id_nif was not set';
    END IF;
    IF v_result ->> 'shop_name' IS DISTINCT FROM (v_before ->> 'shop_name') THEN
        RAISE EXCEPTION 'Assertion failed (2b): a partial payload must not touch unrelated columns';
    END IF;

    -- 3. Explicit null clears a column. --------------------------------------
    v_result := core.save_printing_settings(v_manager_token, jsonb_build_object('tax_id_nif', NULL));
    IF v_result ->> 'tax_id_nif' IS NOT NULL THEN
        RAISE EXCEPTION 'Assertion failed (3): explicit JSON null must clear tax_id_nif';
    END IF;

    -- 4. Invalid enumerations are rejected. -----------------------------------
    BEGIN
        PERFORM core.save_printing_settings(v_manager_token, jsonb_build_object('print_language', 'de'));
        RAISE EXCEPTION 'Assertion failed (4a): print_language = de must be rejected';
    EXCEPTION WHEN sqlstate '22023' THEN NULL;
    END;

    BEGIN
        PERFORM core.save_printing_settings(v_manager_token, jsonb_build_object('receipt_target', 'X'));
        RAISE EXCEPTION 'Assertion failed (4b): receipt_target = X must be rejected';
    EXCEPTION WHEN sqlstate '22023' THEN NULL;
    END;

    BEGIN
        PERFORM core.save_printing_settings(v_manager_token, jsonb_build_object('thermal_columns', 40));
        RAISE EXCEPTION 'Assertion failed (4c): thermal_columns = 40 must be rejected';
    EXCEPTION WHEN sqlstate '22023' THEN NULL;
    END;

    -- 5. Length limits. --------------------------------------------------------
    BEGIN
        PERFORM core.save_printing_settings(v_manager_token, jsonb_build_object(
            'shop_legal_name', repeat('x', 121)
        ));
        RAISE EXCEPTION 'Assertion failed (5a): a 121-character shop_legal_name must be rejected';
    EXCEPTION WHEN sqlstate '22023' THEN NULL;
    END;

    v_result := core.save_printing_settings(v_manager_token, jsonb_build_object(
        'shop_legal_name', repeat('x', 120)
    ));
    IF char_length(v_result ->> 'shop_legal_name') != 120 THEN
        RAISE EXCEPTION 'Assertion failed (5b): a 120-character shop_legal_name must be accepted';
    END IF;

    -- 6. Email format. -----------------------------------------------------
    BEGIN
        PERFORM core.save_printing_settings(v_manager_token, jsonb_build_object('shop_email', 'abc'));
        RAISE EXCEPTION 'Assertion failed (6a): shop_email = abc must be rejected';
    EXCEPTION WHEN sqlstate '22023' THEN NULL;
    END;

    v_result := core.save_printing_settings(v_manager_token, jsonb_build_object('shop_email', 'a@b'));
    IF v_result ->> 'shop_email' IS DISTINCT FROM 'a@b' THEN
        RAISE EXCEPTION 'Assertion failed (6b): shop_email = a@b must be accepted';
    END IF;

    -- 7. Logo bookkeeping. -----------------------------------------------------
    v_result := core.set_printing_logo(v_manager_token, 'logo.png');
    IF v_result ->> 'logo_file_name' IS DISTINCT FROM 'logo.png' THEN
        RAISE EXCEPTION 'Assertion failed (7a): logo_file_name was not set';
    END IF;
    IF v_result ->> 'logo_updated_at' IS NULL THEN
        RAISE EXCEPTION 'Assertion failed (7b): logo_updated_at was not set';
    END IF;

    BEGIN
        PERFORM core.set_printing_logo(v_manager_token, 'evil/../x.png');
        RAISE EXCEPTION 'Assertion failed (7c): a path-like logo file name must be rejected';
    EXCEPTION WHEN sqlstate '22023' THEN NULL;
    END;

    BEGIN
        PERFORM core.set_printing_logo(v_manager_token, 'logo.gif');
        RAISE EXCEPTION 'Assertion failed (7d): an unsupported logo extension must be rejected';
    EXCEPTION WHEN sqlstate '22023' THEN NULL;
    END;

    -- 8. Clearing the logo clears both columns. ---------------------------------
    v_result := core.set_printing_logo(v_manager_token, NULL);
    IF v_result ->> 'logo_file_name' IS NOT NULL OR v_result ->> 'logo_updated_at' IS NOT NULL THEN
        RAISE EXCEPTION 'Assertion failed (8): clearing the logo must clear both columns';
    END IF;

    -- 9. save_printing_settings ignores logo_file_name in its payload. ---------
    v_result := core.set_printing_logo(v_manager_token, 'logo.jpg');
    v_result := core.save_printing_settings(v_manager_token, jsonb_build_object(
        'logo_file_name', 'attacker.png',
        'shop_name', 'Still WS-M-001 Shop'
    ));
    IF v_result ->> 'logo_file_name' IS DISTINCT FROM 'logo.jpg' THEN
        RAISE EXCEPTION 'Assertion failed (9): save_printing_settings must ignore logo_file_name in its payload';
    END IF;

    -- 10. get_printing_settings returns all 26 keys. ----------------------------
    v_result := core.get_printing_settings(v_manager_token);
    FOR v_key IN SELECT unnest(ARRAY[
        'receipt_printing_enabled', 'receipt_target', 'thermal_printer_name', 'thermal_columns',
        'shop_name', 'shop_address', 'shop_phone', 'receipt_footer', 'updated_at',
        'shop_legal_name', 'shop_email', 'shop_website', 'tax_id_nif', 'tax_id_nis',
        'trade_register_rc', 'article_imposition_ai', 'bank_account_rib',
        'logo_file_name', 'logo_updated_at', 'print_language',
        'show_logo', 'show_email', 'show_website', 'show_rib', 'amount_in_words', 'a4_footer_note'
    ])
    LOOP
        IF NOT (v_result ? v_key) THEN
            RAISE EXCEPTION 'Assertion failed (10): get_printing_settings is missing key %', v_key;
        END IF;
    END LOOP;

    -- 13. `{}` payload changes nothing and returns the current row. -----------
    v_before := core.get_printing_settings(v_manager_token);
    v_result := core.save_printing_settings(v_manager_token, '{}'::jsonb);
    IF v_result IS DISTINCT FROM v_before THEN
        RAISE EXCEPTION 'Assertion failed (13): an empty payload must change nothing';
    END IF;

    BEGIN
        PERFORM core.save_printing_settings(v_manager_token, '[1,2,3]'::jsonb);
        RAISE EXCEPTION 'Assertion failed (13b): a non-object payload must be rejected';
    EXCEPTION WHEN sqlstate '22023' THEN NULL;
    END;

    -- 11. schema_state. ----------------------------------------------------------
    IF (SELECT migration_version FROM operations.schema_state WHERE singleton) < 20260924090000 THEN
        RAISE EXCEPTION 'Assertion failed (11): schema_state.migration_version mismatch';
    END IF;

    RAISE NOTICE '=== WS-M-001 print identity integration suite completed successfully ===';
END;
$$;

-- =============================================================================
-- 12. Re-applying the migration file a second time raises no error.
-- =============================================================================
\i src-tauri/migrations/20260924090000_ws_m_001_print_identity.sql
