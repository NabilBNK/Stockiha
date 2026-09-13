-- WS-E-002: supplier payment invariants -- GRNI settlement, partial payment,
-- overpayment rejection, idempotency, and payment immutability.
\set ON_ERROR_STOP on

DO $$
DECLARE
    v_suffix text := floor(random() * 1000000000)::text;
    v_admin_id bigint;
    v_admin_token text := 'ws_e_002_admin_' || floor(random() * 1000000000)::text;
    v_supplier_id bigint;
    v_warehouse_id bigint;
    v_product_id bigint;
    v_variant_id bigint;
    v_unit_id bigint;
    v_period_id bigint;
    v_document_date date;
    v_receipt jsonb;
    v_receipt_id bigint;
    v_payment jsonb;
    v_repeat jsonb;
    v_payment_id bigint;
    v_journal_id bigint;
    v_status jsonb;
    v_balances jsonb;
    v_rejected boolean := false;
BEGIN
    INSERT INTO iam.users (username, display_name, password_hash)
    VALUES ('ws_e_002_admin_' || v_suffix, 'WS-E-002 Admin', 'hash')
    RETURNING id INTO v_admin_id;
    INSERT INTO iam.user_roles (user_id, role_id)
    SELECT v_admin_id, id FROM iam.roles WHERE code = 'ADMIN';
    INSERT INTO iam.application_sessions (user_id, workstation_id, token_hash, expires_at)
    VALUES (v_admin_id, 'WS-E-002', sha256(v_admin_token::bytea), now() + interval '2 hours');

    SELECT id, starts_on + 1
    INTO v_period_id, v_document_date
    FROM finance.fiscal_periods
    WHERE status = 'OPEN'
    ORDER BY starts_on DESC
    LIMIT 1;
    ASSERT v_period_id IS NOT NULL, 'Supplier payment requires an open fiscal period';

    SELECT id INTO v_unit_id FROM catalog.units ORDER BY id LIMIT 1;
    ASSERT v_unit_id IS NOT NULL, 'Supplier payment test requires a catalog unit';

    INSERT INTO procurement.suppliers (code, name, is_active)
    VALUES ('SUP-PAY-' || v_suffix, 'Payment Supplier', true)
    RETURNING id INTO v_supplier_id;
    INSERT INTO inventory.warehouses (code, name, is_active)
    VALUES ('WH-PAY-' || v_suffix, 'Payment Warehouse', true)
    RETURNING id INTO v_warehouse_id;
    INSERT INTO catalog.products (name, is_active)
    VALUES ('Payment Item', true)
    RETURNING id INTO v_product_id;
    INSERT INTO catalog.product_variants (product_id, base_unit_id, sku, sale_price, is_active)
    VALUES (v_product_id, v_unit_id, 'PAY-SKU-' || v_suffix, 180.00, true)
    RETURNING id INTO v_variant_id;
    INSERT INTO inventory.positions (warehouse_id, variant_id, quantity_on_hand, total_value, last_known_wac)
    VALUES (v_warehouse_id, v_variant_id, 0.000, 0.00, 0.000000);

    -- A 1,000.00 DZD purchase: Dr Inventory 1000 / Cr GRNI 1000
    v_receipt := inventory.confirm_direct_purchase(
        v_admin_token,
        'e2000000-0000-4000-8000-000000000001'::uuid,
        '\x01'::bytea,
        v_supplier_id, v_warehouse_id, v_period_id, v_document_date,
        'WS-E-002 purchase',
        jsonb_build_array(jsonb_build_object(
            'variant_id', v_variant_id, 'unit_id', v_unit_id,
            'quantity_received', 10.000, 'unit_cost', 100.00
        ))
    );
    v_receipt_id := (v_receipt ->> 'document_id')::bigint;
    ASSERT (v_receipt ->> 'total_amount')::numeric = 1000.00, 'Purchase total must be 1000.00';

    -- Unpaid before any payment
    v_status := procurement.list_purchase_payment_status(v_admin_token, v_receipt_id);
    ASSERT (v_status -> 0 ->> 'payment_status') = 'UNPAID', 'A new purchase must be UNPAID';
    ASSERT (v_status -> 0 ->> 'outstanding_amount')::numeric = 1000.00, 'Outstanding must equal the total';

    -- Partial payment of 400.00 in cash
    v_payment := procurement.post_purchase_payment(
        v_admin_token,
        'e2000000-0000-4000-8000-000000000002'::uuid,
        '\x02'::bytea,
        v_receipt_id, v_period_id, v_document_date,
        'CASH', 400.00, 'CASH-REF-1'
    );
    v_payment_id := (v_payment ->> 'document_id')::bigint;
    ASSERT (v_payment ->> 'amount')::numeric = 400.00, 'Payment amount must be 400.00';
    ASSERT (v_payment ->> 'document_number') LIKE 'SP-%', 'Payment must get an SP document number';

    v_journal_id := (v_payment ->> 'journal_document_id')::bigint;
    ASSERT EXISTS (
        SELECT 1 FROM finance.journal_lines line
        WHERE line.document_id = v_journal_id
          AND line.account_code = finance.require_account_role('GRNI')
          AND line.debit = 400.00
    ), 'Payment journal must debit GRNI';
    ASSERT EXISTS (
        SELECT 1 FROM finance.journal_lines line
        WHERE line.document_id = v_journal_id
          AND line.account_code = finance.require_account_role('CASH')
          AND line.credit = 400.00
    ), 'Cash payment journal must credit cash';
    ASSERT NOT EXISTS (
        SELECT 1 FROM finance.journal_lines
        WHERE document_id = v_journal_id
        GROUP BY document_id HAVING sum(debit) <> sum(credit)
    ), 'Payment journal must balance';
    ASSERT NOT EXISTS (
        SELECT 1 FROM finance.journal_lines
        WHERE document_id = v_journal_id AND account_id IS NULL
    ), 'Payment journal lines must carry account_id';

    v_status := procurement.list_purchase_payment_status(v_admin_token, v_receipt_id);
    ASSERT (v_status -> 0 ->> 'payment_status') = 'PARTIALLY_PAID', 'Purchase must now be PARTIALLY_PAID';
    ASSERT (v_status -> 0 ->> 'outstanding_amount')::numeric = 600.00, 'Outstanding must be 600.00';

    -- Idempotent retry returns the same payment, creates nothing new
    v_repeat := procurement.post_purchase_payment(
        v_admin_token,
        'e2000000-0000-4000-8000-000000000002'::uuid,
        '\x02'::bytea,
        v_receipt_id, v_period_id, v_document_date,
        'CASH', 400.00, 'CASH-REF-1'
    );
    ASSERT (v_repeat ->> 'document_id')::bigint = v_payment_id, 'Retry must return the original payment';
    ASSERT (SELECT count(*) FROM procurement.purchase_receipt_payments
            WHERE receipt_document_id = v_receipt_id) = 1,
        'Idempotent retry must not duplicate the payment';

    -- Overpayment is rejected
    BEGIN
        PERFORM procurement.post_purchase_payment(
            v_admin_token,
            'e2000000-0000-4000-8000-000000000003'::uuid,
            '\x03'::bytea,
            v_receipt_id, v_period_id, v_document_date,
            'CASH', 601.00, NULL
        );
    EXCEPTION WHEN invalid_parameter_value THEN
        v_rejected := true;
    END;
    ASSERT v_rejected, 'A payment above the outstanding amount must be rejected';
    v_rejected := false;

    -- An unsupported method is rejected
    BEGIN
        PERFORM procurement.post_purchase_payment(
            v_admin_token,
            'e2000000-0000-4000-8000-000000000004'::uuid,
            '\x04'::bytea,
            v_receipt_id, v_period_id, v_document_date,
            'CREDIT', 100.00, NULL
        );
    EXCEPTION WHEN invalid_parameter_value THEN
        v_rejected := true;
    END;
    ASSERT v_rejected, 'CREDIT must not be an accepted payment method';
    v_rejected := false;

    -- Settle the rest by bank transfer
    PERFORM procurement.post_purchase_payment(
        v_admin_token,
        'e2000000-0000-4000-8000-000000000005'::uuid,
        '\x05'::bytea,
        v_receipt_id, v_period_id, v_document_date,
        'BANK_TRANSFER', 600.00, 'BANK-REF-1'
    );

    v_status := procurement.list_purchase_payment_status(v_admin_token, v_receipt_id);
    ASSERT (v_status -> 0 ->> 'payment_status') = 'PAID', 'Purchase must now be PAID';
    ASSERT (v_status -> 0 ->> 'outstanding_amount')::numeric = 0.00, 'Outstanding must be zero';

    -- A fully paid purchase accepts no further payment
    BEGIN
        PERFORM procurement.post_purchase_payment(
            v_admin_token,
            'e2000000-0000-4000-8000-000000000006'::uuid,
            '\x06'::bytea,
            v_receipt_id, v_period_id, v_document_date,
            'CASH', 1.00, NULL
        );
    EXCEPTION WHEN raise_exception OR sqlstate '55000' THEN
        v_rejected := true;
    END;
    ASSERT v_rejected, 'A fully paid purchase must reject further payment';
    v_rejected := false;

    -- Supplier balance is zero once fully paid
    v_balances := procurement.list_supplier_balances(v_admin_token);
    ASSERT EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_balances) entry
        WHERE (entry ->> 'supplier_id')::bigint = v_supplier_id
          AND (entry ->> 'balance_due')::numeric = 0.00
    ), 'Supplier balance must be zero after full settlement';

    -- Payments are immutable
    BEGIN
        UPDATE procurement.purchase_receipt_payments
        SET amount = 1.00
        WHERE document_id = v_payment_id;
    EXCEPTION WHEN feature_not_supported THEN
        v_rejected := true;
    END;
    ASSERT v_rejected, 'A posted payment must be immutable';
END;
$$;
