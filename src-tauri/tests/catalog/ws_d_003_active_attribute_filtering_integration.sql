-- WS-D-CORRECTION-2 regression assertions: deactivated attributes and
-- attribute values must stop being OFFERED by catalog.list_attributes (the
-- product form's picker), while existing variant assignments and
-- attribute_signature stay untouched (Owner ruling, Option A).
-- Run against a DB with all migrations applied. Any failed assertion RAISEs,
-- and psql -v ON_ERROR_STOP=1 aborts.
\set ON_ERROR_STOP on
SET client_min_messages = warning;

-- ---- Test fixtures: user, role, session ------------------------------------
INSERT INTO iam.users (username, password_hash, display_name) VALUES ('wsdcr2admin', 'x', 'WS-D CR2 Admin');
INSERT INTO iam.user_roles (user_id, role_id)
    SELECT u.id, r.id FROM iam.users u, iam.roles r WHERE u.username='wsdcr2admin' AND r.code='ADMIN';
INSERT INTO iam.application_sessions (token_hash, user_id, workstation_id, expires_at)
    SELECT sha256('wsdcr2tok'::bytea), id, 'WS1', now()+interval '1 day' FROM iam.users WHERE username='wsdcr2admin';

CREATE TEMP TABLE t (k text PRIMARY KEY, v bigint);

-- ---- 1. A deactivated VALUE disappears from the picker, but its existing
--         variant assignment survives, and the signature does not move. ------
DO $$
DECLARE
    v_unit bigint; v_attr bigint; v_val bigint;
    v_pid bigint; v_vid bigint;
    v_sig_before text; v_sig_after text;
    v_offered bigint; v_assigned bigint;
BEGIN
    SELECT id INTO v_unit FROM catalog.units WHERE normalized_code = 'UNIT';

    v_attr := catalog.create_attribute('wsdcr2tok', 'CR2Flavor');
    v_val  := catalog.add_attribute_value('wsdcr2tok', v_attr, 'CR2Cherry');

    SELECT product_id, variant_id INTO v_pid, v_vid
        FROM catalog.quick_create_product('wsdcr2tok', 'CR2 Retained Widget', v_unit, 1.00);
    PERFORM catalog.set_variant_attributes('wsdcr2tok', v_vid, ARRAY[v_val]);

    SELECT attribute_signature INTO v_sig_before FROM catalog.product_variants WHERE id = v_vid;

    -- while active, the value is offered
    SELECT count(*) INTO v_offered
        FROM catalog.list_attributes('wsdcr2tok') la,
             LATERAL jsonb_array_elements(la.attribute_values) AS av
        WHERE la.attribute_id = v_attr AND (av->>'id')::bigint = v_val;
    IF v_offered <> 1 THEN
        RAISE EXCEPTION 'ASSERT FAIL: active value should be offered exactly once, got %', v_offered;
    END IF;

    -- every offered value must carry the is_active flag the frontend needs
    IF EXISTS (
        SELECT 1 FROM catalog.list_attributes('wsdcr2tok') la,
             LATERAL jsonb_array_elements(la.attribute_values) AS av
        WHERE av->'is_active' IS NULL
    ) THEN
        RAISE EXCEPTION 'ASSERT FAIL: list_attributes must return is_active on every value';
    END IF;

    -- deactivate it
    PERFORM catalog.set_attribute_value_active('wsdcr2tok', v_val, false);

    -- no longer OFFERED
    SELECT count(*) INTO v_offered
        FROM catalog.list_attributes('wsdcr2tok') la,
             LATERAL jsonb_array_elements(la.attribute_values) AS av
        WHERE la.attribute_id = v_attr AND (av->>'id')::bigint = v_val;
    IF v_offered <> 0 THEN
        RAISE EXCEPTION 'ASSERT FAIL: deactivated value is still offered by list_attributes (% rows)', v_offered;
    END IF;

    -- but the ASSIGNMENT still exists (Option A: retired, not erased)
    SELECT count(*) INTO v_assigned
        FROM catalog.variant_attribute_values
        WHERE variant_id = v_vid AND attribute_value_id = v_val;
    IF v_assigned <> 1 THEN
        RAISE EXCEPTION 'ASSERT FAIL: deactivating a value destroyed its variant assignment';
    END IF;

    -- and the variant identity is byte-identical
    SELECT attribute_signature INTO v_sig_after FROM catalog.product_variants WHERE id = v_vid;
    IF v_sig_after IS DISTINCT FROM v_sig_before THEN
        RAISE EXCEPTION 'ASSERT FAIL: attribute_signature changed on deactivation (% -> %)', v_sig_before, v_sig_after;
    END IF;

    -- Catalogue Setup must still see it, flagged inactive, so it can be reactivated
    IF NOT EXISTS (
        SELECT 1 FROM catalog.list_attribute_values('wsdcr2tok') WHERE id = v_val AND is_active = false
    ) THEN
        RAISE EXCEPTION 'ASSERT FAIL: list_attribute_values must still return the deactivated value, flagged inactive';
    END IF;

    INSERT INTO t VALUES ('cr2_attr', v_attr), ('cr2_val', v_val), ('cr2_vid', v_vid);
    RAISE NOTICE 'deactivated VALUE: not offered, assignment + signature preserved OK';
END $$;

-- ---- 2. A deactivated ATTRIBUTE disappears from the picker entirely --------
DO $$
DECLARE
    v_attr bigint; v_vid bigint; v_rows bigint;
BEGIN
    SELECT v INTO v_attr FROM t WHERE k = 'cr2_attr';
    SELECT v INTO v_vid  FROM t WHERE k = 'cr2_vid';

    -- reactivate the value so this test isolates the ATTRIBUTE-level flag
    PERFORM catalog.set_attribute_value_active('wsdcr2tok', (SELECT v FROM t WHERE k='cr2_val'), true);
    IF NOT EXISTS (SELECT 1 FROM catalog.list_attributes('wsdcr2tok') WHERE attribute_id = v_attr) THEN
        RAISE EXCEPTION 'ASSERT FAIL: precondition — active attribute should be offered';
    END IF;

    PERFORM catalog.set_attribute_active('wsdcr2tok', v_attr, false);

    SELECT count(*) INTO v_rows FROM catalog.list_attributes('wsdcr2tok') WHERE attribute_id = v_attr;
    IF v_rows <> 0 THEN
        RAISE EXCEPTION 'ASSERT FAIL: deactivated attribute is still offered by list_attributes (% rows)', v_rows;
    END IF;

    -- its values must not leak through any other row either
    IF EXISTS (
        SELECT 1 FROM catalog.list_attributes('wsdcr2tok') la,
             LATERAL jsonb_array_elements(la.attribute_values) AS av
        WHERE (av->>'id')::bigint = (SELECT v FROM t WHERE k='cr2_val')
    ) THEN
        RAISE EXCEPTION 'ASSERT FAIL: a value of a deactivated attribute is still offered';
    END IF;

    -- the assignment still survives
    IF NOT EXISTS (
        SELECT 1 FROM catalog.variant_attribute_values
        WHERE variant_id = v_vid AND attribute_value_id = (SELECT v FROM t WHERE k='cr2_val')
    ) THEN
        RAISE EXCEPTION 'ASSERT FAIL: deactivating an attribute destroyed its variant assignment';
    END IF;

    -- Catalogue Setup must still see it, flagged inactive
    IF NOT EXISTS (
        SELECT 1 FROM catalog.list_attributes_v2('wsdcr2tok') WHERE id = v_attr AND is_active = false
    ) THEN
        RAISE EXCEPTION 'ASSERT FAIL: list_attributes_v2 must still return the deactivated attribute, flagged inactive';
    END IF;

    RAISE NOTICE 'deactivated ATTRIBUTE: absent from picker, assignment preserved OK';
END $$;

-- ---- 3. get_product_detail stays unfiltered — this is what preserves history
DO $$
DECLARE
    v_vid bigint; v_pid bigint; v_detail jsonb; v_val bigint;
BEGIN
    SELECT v INTO v_vid FROM t WHERE k = 'cr2_vid';
    SELECT v INTO v_val FROM t WHERE k = 'cr2_val';
    SELECT product_id INTO v_pid FROM catalog.product_variants WHERE id = v_vid;

    v_detail := catalog.get_product_detail('wsdcr2tok', v_pid);

    IF NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(v_detail->'variants') AS var,
             LATERAL jsonb_array_elements(var->'attributes') AS at
        WHERE (var->>'variant_id')::bigint = v_vid
          AND (at->>'attribute_value_id')::bigint = v_val
    ) THEN
        RAISE EXCEPTION 'ASSERT FAIL: get_product_detail dropped an attribute belonging to a deactivated attribute — history lost';
    END IF;

    RAISE NOTICE 'get_product_detail still reports retired assignments (history preserved) OK';
END $$;

SELECT 'ALL WS-D-003 ACTIVE-ATTRIBUTE-FILTERING ASSERTIONS PASSED' AS result;
