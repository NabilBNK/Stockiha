-- S2-002 stock-adjustment integration assertions. Run against a dedicated
-- database with all migrations applied; every fixture is rolled back.
\set ON_ERROR_STOP on
SET client_min_messages = warning;
BEGIN;

CREATE FUNCTION pg_temp.expect_error(p_sql text, p_sqlstate text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    BEGIN
        EXECUTE p_sql;
        RAISE EXCEPTION 'ASSERT FAIL: expected sqlstate % but statement succeeded: %', p_sqlstate, p_sql;
    EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE <> p_sqlstate THEN
            RAISE EXCEPTION 'ASSERT FAIL: expected % got % for: %', p_sqlstate, SQLSTATE, p_sql;
        END IF;
    END;
END; $$;

CREATE TEMP TABLE t (k text PRIMARY KEY, v bigint);

-- Users, roles, live sessions, period and warehouses.
INSERT INTO iam.users (username, password_hash, display_name) VALUES
    ('s2adj_admin', 'x', 'S2 Adjustment Admin'),
    ('s2adj_cashier', 'x', 'S2 Adjustment Cashier');
INSERT INTO iam.user_roles (user_id, role_id)
    SELECT u.id, r.id FROM iam.users u, iam.roles r
    WHERE u.username = 's2adj_admin' AND r.code = 'ADMIN';
INSERT INTO iam.user_roles (user_id, role_id)
    SELECT u.id, r.id FROM iam.users u, iam.roles r
    WHERE u.username = 's2adj_cashier' AND r.code = 'CASHIER';
INSERT INTO iam.application_sessions (token_hash, user_id, workstation_id, expires_at)
    SELECT sha256('s2adj-admin-token'::bytea), id, 'S2ADJ-ADMIN', now() + interval '1 day'
    FROM iam.users WHERE username = 's2adj_admin';
INSERT INTO iam.application_sessions (token_hash, user_id, workstation_id, expires_at)
    SELECT sha256('s2adj-cashier-token'::bytea), id, 'S2ADJ-CASH', now() + interval '1 day'
    FROM iam.users WHERE username = 's2adj_cashier';

INSERT INTO finance.fiscal_periods (period_code, starts_on, ends_on)
    VALUES ('S2ADJ-2026', '2026-01-01', '2026-12-31') RETURNING id;
INSERT INTO inventory.warehouses (code, name, is_active)
    VALUES ('S2ADJ-WH', 'S2 Adjustment Warehouse', true) RETURNING id;
INSERT INTO inventory.warehouses (code, name, is_active)
    VALUES ('S2ADJ-OFF', 'Inactive Warehouse', false) RETURNING id;

DO $$
DECLARE
    v_period bigint;
    v_warehouse bigint;
    v_inactive_warehouse bigint;
    v_product jsonb;
    v_variant bigint;
    v_zero_variant bigint;
    v_inactive_variant bigint;
    v_base_unit bigint;
    v_pack bigint;
    v_size bigint;
    v_color bigint;
    v_s bigint;
    v_m bigint;
    v_w bigint;
    v_b bigint;
    v_doc jsonb;
    v_doc_id bigint;
    v_journal bigint;
    v_count bigint;
    v_debit numeric;
    v_credit numeric;
    v_text text;
BEGIN
    SELECT id INTO v_period FROM finance.fiscal_periods WHERE period_code = 'S2ADJ-2026';
    SELECT id INTO v_warehouse FROM inventory.warehouses WHERE code = 'S2ADJ-WH';
    SELECT id INTO v_inactive_warehouse FROM inventory.warehouses WHERE code = 'S2ADJ-OFF';
    SELECT id INTO v_base_unit FROM catalog.units WHERE normalized_code = 'UNIT';
    v_pack := catalog.create_unit('s2adj-admin-token', 'S2PACK', 'S2 Pack');

    v_size := catalog.create_attribute('s2adj-admin-token', 'S2 Size');
    v_color := catalog.create_attribute('s2adj-admin-token', 'S2 Color');
    v_s := catalog.add_attribute_value('s2adj-admin-token', v_size, 'Small');
    v_m := catalog.add_attribute_value('s2adj-admin-token', v_size, 'Medium');
    v_w := catalog.add_attribute_value('s2adj-admin-token', v_color, 'White');
    v_b := catalog.add_attribute_value('s2adj-admin-token', v_color, 'Black');

    v_product := catalog.create_product_with_variants(
        's2adj-admin-token', 'S2 Adjustment Product', true,
        jsonb_build_array(
            jsonb_build_object(
                'sku', 'S2ADJ-ACTIVE', 'sale_price', '50.00', 'is_active', true,
                'attribute_value_ids', jsonb_build_array(v_s, v_w),
                'alternate_units', jsonb_build_array(
                    jsonb_build_object('unit_id', v_pack, 'conversion_factor', '4.000000')
                )
            ),
            jsonb_build_object('sku', 'S2ADJ-ZERO', 'sale_price', '10.00', 'is_active', true, 'attribute_value_ids', jsonb_build_array(v_m, v_w)),
            jsonb_build_object('sku', 'S2ADJ-INACTIVE', 'sale_price', '10.00', 'is_active', false, 'attribute_value_ids', jsonb_build_array(v_s, v_b))
        )
    );
    v_variant := ((v_product -> 'variant_ids') ->> 0)::bigint;
    v_zero_variant := ((v_product -> 'variant_ids') ->> 1)::bigint;
    v_inactive_variant := ((v_product -> 'variant_ids') ->> 2)::bigint;

    INSERT INTO inventory.positions (
        warehouse_id, variant_id, quantity_on_hand, total_value, last_known_wac
    ) VALUES (v_warehouse, v_variant, 10.000, 100.0000, 10.000000);

    INSERT INTO t VALUES
        ('period', v_period), ('warehouse', v_warehouse), ('inactive_warehouse', v_inactive_warehouse),
        ('variant', v_variant), ('zero_variant', v_zero_variant), ('inactive_variant', v_inactive_variant),
        ('base_unit', v_base_unit), ('pack', v_pack);

    -- Positive adjustment: stock/value movement and gain journal directions.
    v_doc := inventory.confirm_stock_adjustment(
        's2adj-admin-token', '00000000-0000-4000-8000-000000000101', sha256('positive'::bytea),
        v_warehouse, v_variant, v_base_unit, 2.000, 'FOUND_STOCK', NULL,
        v_period, '2026-07-24'
    );
    v_doc_id := (v_doc ->> 'document_id')::bigint;
    v_journal := (v_doc ->> 'journal_document_id')::bigint;
    IF (v_doc ->> 'document_number') !~ '^SA-2026-[0-9]{6}$' THEN
        RAISE EXCEPTION 'ASSERT FAIL: invalid STOCK_ADJUSTMENT number %', v_doc ->> 'document_number';
    END IF;
    IF (SELECT quantity_on_hand FROM inventory.positions WHERE warehouse_id=v_warehouse AND variant_id=v_variant) <> 12.000 THEN
        RAISE EXCEPTION 'ASSERT FAIL: positive quantity update';
    END IF;
    IF (SELECT total_value FROM inventory.positions WHERE warehouse_id=v_warehouse AND variant_id=v_variant) <> 120.0000 THEN
        RAISE EXCEPTION 'ASSERT FAIL: positive exact valuation';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM inventory.movements
        WHERE reference_type='STOCK_ADJUSTMENT' AND reference_id=v_doc_id
          AND movement_type='ADJUSTMENT' AND quantity_delta=2.000 AND inventory_value_delta=20.0000
          AND resulting_quantity_on_hand=12.000 AND resulting_total_value=120.0000
    ) THEN RAISE EXCEPTION 'ASSERT FAIL: positive movement'; END IF;
    IF NOT EXISTS (
        SELECT 1 FROM finance.journal_lines
        WHERE document_id=v_journal AND account_code='INVENTORY_MERCHANDISE' AND debit=20.00 AND credit=0
    ) OR NOT EXISTS (
        SELECT 1 FROM finance.journal_lines
        WHERE document_id=v_journal AND account_code='INVENTORY_ADJUSTMENT_GAIN' AND debit=0 AND credit=20.00
    ) THEN RAISE EXCEPTION 'ASSERT FAIL: positive journal direction'; END IF;

    -- Negative adjustment: loss journal and exact WAC issue.
    v_doc := inventory.confirm_stock_adjustment(
        's2adj-admin-token', '00000000-0000-4000-8000-000000000102', sha256('negative'::bytea),
        v_warehouse, v_variant, v_base_unit, -3.000, 'DAMAGE', 'Damaged case',
        v_period, '2026-07-24'
    );
    v_journal := (v_doc ->> 'journal_document_id')::bigint;
    IF (SELECT quantity_on_hand FROM inventory.positions WHERE warehouse_id=v_warehouse AND variant_id=v_variant) <> 9.000
       OR (SELECT total_value FROM inventory.positions WHERE warehouse_id=v_warehouse AND variant_id=v_variant) <> 90.0000 THEN
        RAISE EXCEPTION 'ASSERT FAIL: negative exact valuation';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM finance.journal_lines
        WHERE document_id=v_journal AND account_code='INVENTORY_ADJUSTMENT_LOSS' AND debit=30.00 AND credit=0
    ) OR NOT EXISTS (
        SELECT 1 FROM finance.journal_lines
        WHERE document_id=v_journal AND account_code='INVENTORY_MERCHANDISE' AND debit=0 AND credit=30.00
    ) THEN RAISE EXCEPTION 'ASSERT FAIL: negative journal direction'; END IF;

    -- Alternate-unit conversion is exact and the persisted authoritative delta is base units.
    v_doc := inventory.confirm_stock_adjustment(
        's2adj-admin-token', '00000000-0000-4000-8000-000000000103', sha256('alternate'::bytea),
        v_warehouse, v_variant, v_pack, 1.250, 'RECORDING_ERROR', NULL,
        v_period, '2026-07-24'
    );
    IF (v_doc ->> 'quantity_delta')::numeric <> 5.000 THEN
        RAISE EXCEPTION 'ASSERT FAIL: alternate unit base delta %', v_doc ->> 'quantity_delta';
    END IF;
    IF (SELECT conversion_factor FROM inventory.stock_adjustments WHERE document_id=(v_doc->>'document_id')::bigint) <> 4.000000 THEN
        RAISE EXCEPTION 'ASSERT FAIL: alternate conversion snapshot';
    END IF;

    -- Journal balance, posting status, immutable adjustment and actor snapshot.
    SELECT coalesce(sum(debit),0), coalesce(sum(credit),0)
    INTO v_debit, v_credit FROM finance.journal_lines WHERE document_id=v_journal;
    IF v_debit <> v_credit THEN RAISE EXCEPTION 'ASSERT FAIL: journal unbalanced'; END IF;
    IF EXISTS (
        SELECT 1 FROM inventory.stock_adjustments a
        JOIN core.business_documents d ON d.id=a.document_id
        WHERE d.status <> 'POSTED' OR a.posted_by_user_id IS NULL OR btrim(a.workstation_id)=''
    ) THEN RAISE EXCEPTION 'ASSERT FAIL: adjustment posting/actor snapshot'; END IF;
    PERFORM pg_temp.expect_error(
        format('UPDATE inventory.stock_adjustments SET note=%L WHERE document_id=%s', 'mutate', v_doc_id),
        '0A000'
    );

    -- Input, authorization and state rejections.
    PERFORM pg_temp.expect_error(format(
        'SELECT inventory.confirm_stock_adjustment(%L,%L::uuid,sha256(%L::bytea),%s,%s,%s,0,%L,NULL,%s,%L::date)',
        's2adj-admin-token','00000000-0000-4000-8000-000000000104','zero',v_warehouse,v_variant,v_base_unit,
        'FOUND_STOCK',v_period,'2026-07-24'), '22023');
    PERFORM pg_temp.expect_error(format(
        'SELECT inventory.confirm_stock_adjustment(%L,%L::uuid,sha256(%L::bytea),999999,%s,%s,1,%L,NULL,%s,%L::date)',
        's2adj-admin-token','00000000-0000-4000-8000-000000000105','warehouse',v_variant,v_base_unit,
        'FOUND_STOCK',v_period,'2026-07-24'), '22023');
    PERFORM pg_temp.expect_error(format(
        'SELECT inventory.confirm_stock_adjustment(%L,%L::uuid,sha256(%L::bytea),%s,%s,%s,1,%L,NULL,%s,%L::date)',
        's2adj-admin-token','00000000-0000-4000-8000-000000000106','inactive-warehouse',v_inactive_warehouse,v_variant,v_base_unit,
        'FOUND_STOCK',v_period,'2026-07-24'), '22023');
    PERFORM pg_temp.expect_error(format(
        'SELECT inventory.confirm_stock_adjustment(%L,%L::uuid,sha256(%L::bytea),%s,%s,%s,1,%L,NULL,%s,%L::date)',
        's2adj-admin-token','00000000-0000-4000-8000-000000000107','inactive-variant',v_warehouse,v_inactive_variant,v_base_unit,
        'FOUND_STOCK',v_period,'2026-07-24'), '22023');
    PERFORM pg_temp.expect_error(format(
        'SELECT inventory.confirm_stock_adjustment(%L,%L::uuid,sha256(%L::bytea),%s,%s,%s,-999,%L,NULL,%s,%L::date)',
        's2adj-admin-token','00000000-0000-4000-8000-000000000108','insufficient',v_warehouse,v_variant,v_base_unit,
        'SHRINKAGE',v_period,'2026-07-24'), '55000');
    PERFORM pg_temp.expect_error(format(
        'SELECT inventory.confirm_stock_adjustment(%L,%L::uuid,sha256(%L::bytea),%s,%s,%s,1,%L,NULL,%s,%L::date)',
        's2adj-admin-token','00000000-0000-4000-8000-000000000109','zero-wac',v_warehouse,v_zero_variant,v_base_unit,
        'FOUND_STOCK',v_period,'2026-07-24'), 'P2002');
    PERFORM pg_temp.expect_error(format(
        'SELECT inventory.confirm_stock_adjustment(%L,%L::uuid,sha256(%L::bytea),%s,%s,%s,1,%L,NULL,%s,%L::date)',
        's2adj-cashier-token','00000000-0000-4000-8000-000000000110','permission',v_warehouse,v_variant,v_base_unit,
        'FOUND_STOCK',v_period,'2026-07-24'), '42501');
    PERFORM pg_temp.expect_error(format(
        'SELECT inventory.confirm_stock_adjustment(%L,%L::uuid,sha256(%L::bytea),%s,%s,%s,1,%L,NULL,%s,%L::date)',
        'bogus','00000000-0000-4000-8000-000000000111','session',v_warehouse,v_variant,v_base_unit,
        'FOUND_STOCK',v_period,'2026-07-24'), '28000');
    PERFORM pg_temp.expect_error(format(
        'SELECT inventory.confirm_stock_adjustment(%L,%L::uuid,sha256(%L::bytea),%s,%s,%s,1,%L,NULL,%s,%L::date)',
        's2adj-admin-token','00000000-0000-4000-8000-000000000112','other-note',v_warehouse,v_variant,v_base_unit,
        'OTHER',v_period,'2026-07-24'), '22023');

    -- Failed requests roll back every protected write and number claim.
    SELECT count(*) INTO v_count FROM inventory.stock_adjustments;
    PERFORM pg_temp.expect_error(format(
        'SELECT inventory.confirm_stock_adjustment(%L,%L::uuid,sha256(%L::bytea),%s,%s,%s,-999,%L,NULL,%s,%L::date)',
        's2adj-admin-token','00000000-0000-4000-8000-000000000113','rollback',v_warehouse,v_variant,v_base_unit,
        'DAMAGE',v_period,'2026-07-24'), '55000');
    IF (SELECT count(*) FROM inventory.stock_adjustments) <> v_count THEN
        RAISE EXCEPTION 'ASSERT FAIL: rejected posting left adjustment';
    END IF;
    IF EXISTS (
        SELECT 1 FROM core.request_idempotency
        WHERE operation_key='inventory.confirm_stock_adjustment'
          AND request_id='00000000-0000-4000-8000-000000000113'
    ) THEN RAISE EXCEPTION 'ASSERT FAIL: rejected posting cached idempotency'; END IF;

    -- Idempotent retry returns the same cohesive response and posts once.
    v_doc := inventory.confirm_stock_adjustment(
        's2adj-admin-token', '00000000-0000-4000-8000-000000000114', sha256('retry'::bytea),
        v_warehouse, v_variant, v_base_unit, 1.000, 'FOUND_STOCK', NULL,
        v_period, '2026-07-24'
    );
    v_doc_id := (v_doc->>'document_id')::bigint;
    IF (inventory.confirm_stock_adjustment(
        's2adj-admin-token', '00000000-0000-4000-8000-000000000114', sha256('retry'::bytea),
        v_warehouse, v_variant, v_base_unit, 1.000, 'FOUND_STOCK', NULL,
        v_period, '2026-07-24'
    )->>'document_id')::bigint <> v_doc_id THEN
        RAISE EXCEPTION 'ASSERT FAIL: idempotent retry changed document';
    END IF;
    IF (SELECT count(*) FROM inventory.stock_adjustments WHERE document_id=v_doc_id) <> 1 THEN
        RAISE EXCEPTION 'ASSERT FAIL: idempotent retry duplicated adjustment';
    END IF;
    PERFORM pg_temp.expect_error(format(
        'SELECT inventory.confirm_stock_adjustment(%L,%L::uuid,sha256(%L::bytea),%s,%s,%s,2,%L,NULL,%s,%L::date)',
        's2adj-admin-token','00000000-0000-4000-8000-000000000114','different',v_warehouse,v_variant,v_base_unit,
        'FOUND_STOCK',v_period,'2026-07-24'), '23505');

    -- Unit selector exposes one base unit and the configured alternate factor.
    SELECT count(*) INTO v_count FROM inventory.list_stock_adjustment_units('s2adj-admin-token', v_variant);
    IF v_count <> 2 THEN RAISE EXCEPTION 'ASSERT FAIL: adjustment unit count %', v_count; END IF;
    SELECT conversion_factor::text INTO v_text
    FROM inventory.list_stock_adjustment_units('s2adj-admin-token', v_variant)
    WHERE unit_id=v_pack;
    IF v_text::numeric <> 4.000000 THEN RAISE EXCEPTION 'ASSERT FAIL: selector factor %', v_text; END IF;

    -- Existing stock-receipt posting remains operational after the migration.
    v_doc_id := inventory.confirm_stock_receipt(
        's2adj-admin-token', '00000000-0000-4000-8000-000000000115', sha256('receipt-regression'::bytea),
        v_warehouse, v_zero_variant, 5.000, 2.000000,
        v_period, '2026-07-24'
    );
    IF NOT EXISTS (
        SELECT 1 FROM core.business_documents WHERE id=v_doc_id AND document_type='STOCK_RECEIPT' AND status='POSTED'
    ) THEN RAISE EXCEPTION 'ASSERT FAIL: receipt regression'; END IF;
END $$;

-- Force all deferred journal checks now, while assertions can still roll back.
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;

-- Existing POS posting remains operational after S2-002.
DO $$
DECLARE
    v_period bigint := (SELECT v FROM t WHERE k='period');
    v_warehouse bigint := (SELECT v FROM t WHERE k='warehouse');
    v_variant bigint := (SELECT v FROM t WHERE k='zero_variant');
    v_cash_session bigint;
    v_sale bigint;
BEGIN
    v_cash_session := sales.open_cash_session('s2adj-admin-token', v_warehouse, 'S2ADJ-POS', 0);
    v_sale := sales.confirm_cash_sale(
        's2adj-admin-token', '00000000-0000-4000-8000-000000000116', sha256('sale-regression'::bytea),
        v_cash_session, v_warehouse, v_period, '2026-07-24',
        jsonb_build_array(jsonb_build_object('variant_id',v_variant,'quantity','1.000','unit_price','5.00'))
    );
    IF NOT EXISTS (
        SELECT 1 FROM core.business_documents WHERE id=v_sale AND document_type='CASH_SALE' AND status='POSTED'
    ) THEN RAISE EXCEPTION 'ASSERT FAIL: POS regression'; END IF;
END $$;

SET CONSTRAINTS ALL IMMEDIATE;
SELECT 'ALL S2-002 DB ASSERTIONS PASSED' AS result;
ROLLBACK;
