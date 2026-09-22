-- WS-F-006: cancel a whole cash or credit sale (sale void).
--
-- Reverses exactly what the sale posted: stock comes back at the cost it
-- left at, the sale's journal is mirrored, the drawer's expected cash drops
-- (cash sale) or the customer's debt drops (credit sale). The original
-- document becomes REVERSED; a new SALE_VOID document (AN-YYYY-NNNNNN) is
-- linked to it. Nothing is edited or deleted.
--
-- Fully idempotent: the WS-K-5 safe-upgrade fixture re-applies the newest
-- migration after deleting its bookkeeping row.

SET ROLE stockiha_owner;

-- =============================================================================
-- 1. Vocabulary: permission, document type, sequence type
-- =============================================================================

DO $$
DECLARE
    v_existing_check text;
BEGIN
    -- 1a. iam.permissions: VOID_SALE
    SELECT pg_get_expr(c.conbin, c.conrelid) INTO v_existing_check
    FROM pg_constraint c
    WHERE c.conrelid = 'iam.permissions'::regclass
      AND c.conname = 'permissions_code_valid' AND c.contype = 'c';
    IF v_existing_check IS NULL THEN
        RAISE EXCEPTION 'expected iam.permissions constraint permissions_code_valid is missing';
    END IF;
    IF position('VOID_SALE' in v_existing_check) = 0 THEN
        ALTER TABLE iam.permissions DROP CONSTRAINT permissions_code_valid;
        EXECUTE format(
            'ALTER TABLE iam.permissions ADD CONSTRAINT permissions_code_valid CHECK ((%s) OR code = %L)',
            v_existing_check, 'VOID_SALE');
    END IF;

    -- 1b. core.business_documents: SALE_VOID
    SELECT pg_get_expr(c.conbin, c.conrelid) INTO v_existing_check
    FROM pg_constraint c
    WHERE c.conrelid = 'core.business_documents'::regclass
      AND c.conname = 'business_documents_type_valid' AND c.contype = 'c';
    IF v_existing_check IS NULL THEN
        RAISE EXCEPTION 'expected core.business_documents constraint business_documents_type_valid is missing';
    END IF;
    IF position('SALE_VOID' in v_existing_check) = 0 THEN
        ALTER TABLE core.business_documents DROP CONSTRAINT business_documents_type_valid;
        EXECUTE format(
            'ALTER TABLE core.business_documents ADD CONSTRAINT business_documents_type_valid CHECK ((%s) OR document_type = %L)',
            v_existing_check, 'SALE_VOID');
    END IF;

    -- 1c. core.document_sequences: SALE_VOID
    SELECT pg_get_expr(c.conbin, c.conrelid) INTO v_existing_check
    FROM pg_constraint c
    WHERE c.conrelid = 'core.document_sequences'::regclass
      AND c.conname = 'document_sequences_type_valid' AND c.contype = 'c';
    IF v_existing_check IS NULL THEN
        RAISE EXCEPTION 'expected core.document_sequences constraint document_sequences_type_valid is missing';
    END IF;
    IF position('SALE_VOID' in v_existing_check) = 0 THEN
        ALTER TABLE core.document_sequences DROP CONSTRAINT document_sequences_type_valid;
        EXECUTE format(
            'ALTER TABLE core.document_sequences ADD CONSTRAINT document_sequences_type_valid CHECK ((%s) OR document_type = %L)',
            v_existing_check, 'SALE_VOID');
    END IF;
END;
$$;

INSERT INTO iam.permissions (code, name)
VALUES ('VOID_SALE', 'Cancel a whole sale')
ON CONFLICT (code) DO NOTHING;

INSERT INTO iam.role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM iam.roles role
CROSS JOIN iam.permissions permission
WHERE role.code IN ('ADMIN', 'MANAGER', 'SUPER_ADMIN')
  AND permission.code = 'VOID_SALE'
ON CONFLICT DO NOTHING;

-- =============================================================================
-- 2. cash.movements accepts SALE_VOID (stored negative, like CUSTOMER_REFUND)
-- =============================================================================
-- cash.submit_cash_session_count already sums every non-CASH_OUT amount as
-- signed, so a negative SALE_VOID row lowers expected cash with no change to
-- that function.

ALTER TABLE cash.movements DROP CONSTRAINT IF EXISTS movements_movement_type_valid;
ALTER TABLE cash.movements ADD CONSTRAINT movements_movement_type_valid
    CHECK (movement_type IN ('SALE', 'CUSTOMER_PAYMENT', 'CUSTOMER_REFUND', 'CASH_IN', 'CASH_OUT', 'SALE_VOID'));

ALTER TABLE cash.movements DROP CONSTRAINT IF EXISTS movements_amount_direction_valid;
ALTER TABLE cash.movements ADD CONSTRAINT movements_amount_direction_valid CHECK (
    (movement_type IN ('SALE', 'CUSTOMER_PAYMENT', 'CASH_IN', 'CASH_OUT') AND amount > 0)
    OR (movement_type IN ('CUSTOMER_REFUND', 'SALE_VOID') AND amount < 0)
);

ALTER TABLE cash.movements DROP CONSTRAINT IF EXISTS movements_reason_required_for_manual;
ALTER TABLE cash.movements ADD CONSTRAINT movements_reason_required_for_manual CHECK (
    movement_type IN ('SALE', 'CUSTOMER_PAYMENT', 'CUSTOMER_REFUND', 'SALE_VOID')
    OR reason_code IN ('SUPPLIER_PAYMENT', 'EXPENSE', 'CHANGE_FLOAT', 'CORRECTION', 'OTHER')
);

-- =============================================================================
-- 3. The void record
-- =============================================================================

CREATE TABLE IF NOT EXISTS sales.sale_voids (
    void_document_id        bigint PRIMARY KEY REFERENCES core.business_documents (id),
    original_document_id    bigint NOT NULL UNIQUE REFERENCES core.business_documents (id),
    sale_kind               text NOT NULL,
    reason_code             text NOT NULL,
    note                    text,
    total_amount            numeric(14, 2) NOT NULL,
    cash_session_id         bigint NOT NULL REFERENCES sales.cash_sessions (id),
    journal_document_id     bigint NOT NULL REFERENCES finance.journal_entries (document_id),
    voided_by_user_id       bigint NOT NULL REFERENCES iam.users (id),
    workstation_id          text NOT NULL,
    created_at              timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT sale_voids_kind_valid CHECK (sale_kind IN ('CASH', 'CREDIT')),
    CONSTRAINT sale_voids_reason_valid CHECK (reason_code IN (
        'CUSTOMER_CHANGED_MIND', 'WRONG_ITEM', 'WRONG_PRICE', 'CASHIER_MISTAKE', 'OTHER')),
    CONSTRAINT sale_voids_note_length CHECK (note IS NULL OR char_length(note) <= 200),
    CONSTRAINT sale_voids_custom_reason_needs_note CHECK (reason_code <> 'OTHER' OR note IS NOT NULL),
    CONSTRAINT sale_voids_total_non_negative CHECK (total_amount >= 0),
    CONSTRAINT sale_voids_workstation_not_blank CHECK (btrim(workstation_id) <> '')
);

CREATE OR REPLACE FUNCTION sales.forbid_sale_void_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'sale voids are immutable' USING ERRCODE = '0A000';
END;
$$;

CREATE OR REPLACE TRIGGER sale_voids_forbid_update
    BEFORE UPDATE ON sales.sale_voids
    FOR EACH ROW EXECUTE FUNCTION sales.forbid_sale_void_mutation();

CREATE OR REPLACE TRIGGER sale_voids_forbid_delete
    BEFORE DELETE ON sales.sale_voids
    FOR EACH ROW EXECUTE FUNCTION sales.forbid_sale_void_mutation();

REVOKE ALL ON sales.sale_voids FROM PUBLIC;
REVOKE ALL ON sales.sale_voids FROM stockiha_runtime;
GRANT SELECT ON sales.sale_voids TO stockiha_backup;
REVOKE ALL ON FUNCTION sales.forbid_sale_void_mutation() FROM PUBLIC;

-- =============================================================================
-- 4. A credit note closes the invoice it reverses
-- =============================================================================
-- Every place that decides whether a credit invoice is still open compares
-- the invoice amount with this function. Counting CREDIT_NOTE entries linked
-- through related_entry_id makes a cancelled invoice look fully settled
-- everywhere at once, with no change to the payment or refund functions.
-- Identical to the 20260801110000 definition plus the third term.

CREATE OR REPLACE FUNCTION receivables.net_invoice_allocated_amount(p_invoice_ledger_entry_id bigint)
RETURNS numeric(14,2)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
    SELECT (
        coalesce((
            SELECT sum(pa.amount)
            FROM receivables.payment_allocations pa
            WHERE pa.invoice_ledger_entry_id = p_invoice_ledger_entry_id
        ), 0)
        - coalesce((
            SELECT sum(pra.amount)
            FROM receivables.payment_refund_allocations pra
            WHERE pra.invoice_ledger_entry_id = p_invoice_ledger_entry_id
        ), 0)
        + coalesce((
            SELECT -sum(cn.amount_delta)
            FROM receivables.customer_ledger_entries cn
            WHERE cn.related_entry_id = p_invoice_ledger_entry_id
              AND cn.entry_type = 'CREDIT_NOTE'
        ), 0)
    )::numeric(14,2)
$$;

-- =============================================================================
-- 5. sales.void_sale
-- =============================================================================

CREATE OR REPLACE FUNCTION sales.void_sale(
    p_session_token text,
    p_document_id bigint,
    p_reason_code text,
    p_note text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_user_id bigint;
    v_workstation_id text;
    v_note text;
    v_doc_type text;
    v_doc_status text;
    v_doc_number text;
    v_sale_kind text;
    v_session_id bigint;
    v_session_status text;
    v_session_cashier bigint;
    v_session_workstation text;
    v_sale_total numeric(14, 2);
    v_sale_subtotal numeric(14, 2);
    v_sale_discount numeric(14, 2);
    v_sale_created_at timestamptz;
    v_sale_workstation text;
    v_customer_id bigint;
    v_customer_name text;
    v_invoice_entry_id bigint;
    v_original_journal_id bigint;
    v_line_reference text;
    v_today date := (now() AT TIME ZONE 'Africa/Algiers')::date;
    v_period_id bigint;
    v_fiscal_year integer;
    v_void_document_id bigint;
    v_void_journal_id bigint;
    v_sequence bigint;
    v_void_number text;
    v_journal_number text;
    v_mv record;
    v_new_qty numeric;
    v_new_value numeric;
    v_restocked_lines integer := 0;
    v_mirrored_lines integer := 0;
    v_oldest_due date;
    v_lines jsonb;
BEGIN
    -- 1. Who is asking.
    SELECT user_id, workstation_id
    INTO v_user_id, v_workstation_id
    FROM iam.resolve_session_with_permission(p_session_token, 'VOID_SALE');

    -- 2. Reason and description.
    IF p_reason_code IS NULL OR p_reason_code NOT IN
        ('CUSTOMER_CHANGED_MIND', 'WRONG_ITEM', 'WRONG_PRICE', 'CASHIER_MISTAKE', 'OTHER') THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: unsupported cancellation reason' USING ERRCODE = '22023';
    END IF;
    v_note := nullif(btrim(coalesce(p_note, '')), '');
    IF v_note IS NOT NULL AND char_length(v_note) > 200 THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: note must be at most 200 characters' USING ERRCODE = '22023';
    END IF;
    IF p_reason_code = 'OTHER' AND v_note IS NULL THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: a description is required for a custom reason'
            USING ERRCODE = '22023';
    END IF;

    -- 3. Lock the original document; this is also the double-cancel guard.
    SELECT document_type, status, document_number
    INTO v_doc_type, v_doc_status, v_doc_number
    FROM core.business_documents
    WHERE id = p_document_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'sale not found' USING ERRCODE = '22023';
    END IF;
    IF v_doc_type NOT IN ('CASH_SALE', 'CREDIT_SALE') THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: only a cash or credit sale can be cancelled' USING ERRCODE = '22023';
    END IF;
    IF v_doc_status = 'REVERSED' THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: this sale is already cancelled' USING ERRCODE = '55000';
    END IF;
    IF v_doc_status <> 'POSTED' THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: only a posted sale can be cancelled' USING ERRCODE = '55000';
    END IF;

    -- 4. Gather the sale and find its cash session.
    IF v_doc_type = 'CASH_SALE' THEN
        v_sale_kind := 'CASH';
        v_line_reference := 'CASH_SALE_LINE';

        SELECT m.cash_session_id INTO v_session_id
        FROM cash.movements m
        WHERE m.business_document_id = p_document_id AND m.movement_type = 'SALE';
        IF NOT FOUND THEN
            RAISE EXCEPTION 'PRECONDITION_FAILED: this sale is not linked to a cash session'
                USING ERRCODE = '55000';
        END IF;

        SELECT total_amount, subtotal, discount_amount
        INTO v_sale_total, v_sale_subtotal, v_sale_discount
        FROM sales.cash_sales
        WHERE document_id = p_document_id;

        SELECT je.document_id INTO v_original_journal_id
        FROM finance.journal_entries je
        WHERE je.source_type = 'CASH_SALE' AND je.source_id = p_document_id;
    ELSE
        v_sale_kind := 'CREDIT';
        v_line_reference := 'CREDIT_SALE_LINE';

        SELECT cs.total_amount, cs.subtotal, cs.created_at, cs.workstation_id,
               cs.customer_id, cs.journal_document_id, c.name
        INTO v_sale_total, v_sale_subtotal, v_sale_created_at, v_sale_workstation,
             v_customer_id, v_original_journal_id, v_customer_name
        FROM sales.credit_sales cs
        JOIN receivables.customers c ON c.id = cs.customer_id
        WHERE cs.document_id = p_document_id;
        v_sale_discount := 0;

        SELECT s.id INTO v_session_id
        FROM sales.cash_sessions s
        WHERE s.workstation_id = v_sale_workstation
          AND s.status = 'OPEN'
          AND s.opened_at <= v_sale_created_at
        ORDER BY s.opened_at DESC
        LIMIT 1;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'PRECONDITION_FAILED: a sale can only be cancelled while the cash session it was made in is still open'
                USING ERRCODE = '55000';
        END IF;
    END IF;

    IF v_original_journal_id IS NULL THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: the sale journal was not found' USING ERRCODE = '55000';
    END IF;

    -- 5. The session must still be open and belong to the caller.
    SELECT status, current_cashier_user_id, workstation_id
    INTO v_session_status, v_session_cashier, v_session_workstation
    FROM sales.cash_sessions
    WHERE id = v_session_id
    FOR UPDATE;

    IF v_session_status <> 'OPEN' THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: a sale can only be cancelled while the cash session it was made in is still open'
            USING ERRCODE = '55000';
    END IF;
    IF v_session_cashier <> v_user_id OR v_session_workstation <> v_workstation_id THEN
        RAISE EXCEPTION 'only the cashier of the open session can cancel its sales' USING ERRCODE = '42501';
    END IF;

    -- 6. Credit sale: refuse if any payment is allocated to it (ruling R4).
    IF v_sale_kind = 'CREDIT' THEN
        SELECT id INTO v_invoice_entry_id
        FROM receivables.customer_ledger_entries
        WHERE document_id = p_document_id AND entry_type = 'CREDIT_INVOICE';
        IF NOT FOUND THEN
            RAISE EXCEPTION 'PRECONDITION_FAILED: the customer invoice was not found' USING ERRCODE = '55000';
        END IF;

        PERFORM 1 FROM receivables.customer_credit_state
        WHERE customer_id = v_customer_id
        FOR UPDATE;

        IF receivables.net_invoice_allocated_amount(v_invoice_entry_id) <> 0 THEN
            RAISE EXCEPTION 'PRECONDITION_FAILED: the customer has already paid part of this sale; refund that payment first, then cancel the sale'
                USING ERRCODE = '55000';
        END IF;
    END IF;

    -- 7. Fiscal period covering today (same rule as cash._post_cash_journal).
    SELECT id, extract(year FROM starts_on)::integer
    INTO v_period_id, v_fiscal_year
    FROM finance.fiscal_periods
    WHERE status = 'OPEN' AND v_today BETWEEN starts_on AND ends_on
    ORDER BY starts_on DESC
    LIMIT 1;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: no open fiscal period covers today' USING ERRCODE = '55000';
    END IF;

    -- 8. The void document (DRAFT for now; numbered and posted in step 13).
    INSERT INTO core.business_documents (
        document_type, document_date, fiscal_period_id, fiscal_year, reverses_document_id
    ) VALUES (
        'SALE_VOID', v_today, v_period_id, v_fiscal_year, p_document_id
    ) RETURNING id INTO v_void_document_id;

    -- 9. The mirrored journal: every line of the sale journal, debit and credit swapped.
    INSERT INTO core.business_documents (document_type, document_date, fiscal_period_id, fiscal_year)
    VALUES ('JOURNAL_ENTRY', v_today, v_period_id, v_fiscal_year)
    RETURNING id INTO v_void_journal_id;

    INSERT INTO finance.journal_entries (document_id, description, source_type, source_id)
    VALUES (v_void_journal_id, 'Sale cancelled', 'SALE_VOID', v_void_document_id);

    INSERT INTO finance.journal_lines (document_id, line_number, account_code, account_id, debit, credit)
    SELECT v_void_journal_id, jl.line_number, jl.account_code, jl.account_id, jl.credit, jl.debit
    FROM finance.journal_lines jl
    WHERE jl.document_id = v_original_journal_id
    ORDER BY jl.line_number;
    GET DIAGNOSTICS v_mirrored_lines = ROW_COUNT;
    IF v_mirrored_lines = 0 THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: the sale journal has no lines' USING ERRCODE = '55000';
    END IF;

    -- 10. Stock comes back at exactly the value it left with.
    PERFORM 1
    FROM inventory.positions p
    WHERE (p.warehouse_id, p.variant_id) IN (
        SELECT m.warehouse_id, m.variant_id
        FROM inventory.movements m
        WHERE m.reference_type = v_line_reference
          AND m.reference_id = p_document_id
          AND m.movement_type = 'ISSUE'
    )
    ORDER BY p.warehouse_id, p.variant_id
    FOR UPDATE;

    FOR v_mv IN
        SELECT m.warehouse_id, m.variant_id, m.quantity_delta, m.inventory_value_delta
        FROM inventory.movements m
        WHERE m.reference_type = v_line_reference
          AND m.reference_id = p_document_id
          AND m.movement_type = 'ISSUE'
        ORDER BY m.warehouse_id, m.variant_id, m.id
    LOOP
        UPDATE inventory.positions
        SET quantity_on_hand = quantity_on_hand - v_mv.quantity_delta,
            total_value = total_value - v_mv.inventory_value_delta
        WHERE warehouse_id = v_mv.warehouse_id AND variant_id = v_mv.variant_id
        RETURNING quantity_on_hand, total_value INTO v_new_qty, v_new_value;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'PRECONDITION_FAILED: stock position for variant % not found', v_mv.variant_id
                USING ERRCODE = '55000';
        END IF;

        UPDATE inventory.positions
        SET last_known_wac = CASE WHEN v_new_qty > 0 THEN round(v_new_value / v_new_qty, 6) ELSE last_known_wac END
        WHERE warehouse_id = v_mv.warehouse_id AND variant_id = v_mv.variant_id;

        INSERT INTO inventory.movements (
            warehouse_id, variant_id, movement_type, quantity_delta, inventory_value_delta,
            resulting_quantity_on_hand, resulting_total_value, reference_type, reference_id
        ) VALUES (
            v_mv.warehouse_id, v_mv.variant_id, 'RECEIPT', -v_mv.quantity_delta, -v_mv.inventory_value_delta,
            v_new_qty, v_new_value, 'SALE_VOID_LINE', v_void_document_id
        );
        v_restocked_lines := v_restocked_lines + 1;
    END LOOP;

    IF v_restocked_lines = 0 THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: the sale has no stock movements to reverse' USING ERRCODE = '55000';
    END IF;

    -- 11. Money: drawer (cash sale) or customer debt (credit sale).
    IF v_sale_kind = 'CASH' THEN
        IF v_sale_total > 0 THEN
            INSERT INTO cash.movements (
                cash_session_id, business_document_id, movement_type, amount,
                recorded_by_user_id, journal_document_id
            ) VALUES (
                v_session_id, v_void_document_id, 'SALE_VOID', -v_sale_total,
                v_user_id, v_void_journal_id
            );
        END IF;
    ELSE
        INSERT INTO receivables.customer_ledger_entries (
            customer_id, entry_type, amount_delta, document_id, related_entry_id,
            posted_by_user_id, workstation_id
        ) VALUES (
            v_customer_id, 'CREDIT_NOTE', -v_sale_total, v_void_document_id, v_invoice_entry_id,
            v_user_id, v_workstation_id
        );

        SELECT min(l.due_date) INTO v_oldest_due
        FROM receivables.customer_ledger_entries l
        WHERE l.customer_id = v_customer_id
          AND l.entry_type = 'CREDIT_INVOICE'
          AND l.due_date IS NOT NULL
          AND l.amount_delta > receivables.net_invoice_allocated_amount(l.id);

        UPDATE receivables.customer_credit_state
        SET exposure_amount = exposure_amount - v_sale_total,
            oldest_open_due_date = v_oldest_due,
            last_rebuilt_at = now()
        WHERE customer_id = v_customer_id;
    END IF;

    -- 12. The void record.
    INSERT INTO sales.sale_voids (
        void_document_id, original_document_id, sale_kind, reason_code, note,
        total_amount, cash_session_id, journal_document_id, voided_by_user_id, workstation_id
    ) VALUES (
        v_void_document_id, p_document_id, v_sale_kind, p_reason_code, v_note,
        v_sale_total, v_session_id, v_void_journal_id, v_user_id, v_workstation_id
    );

    -- 13. Numbers, posting, and the original becomes REVERSED.
    v_sequence := core.claim_next_document_number('SALE_VOID', v_fiscal_year);
    v_void_number := 'AN-' || v_fiscal_year || '-' || lpad(v_sequence::text, 6, '0');
    UPDATE core.business_documents
    SET status = 'POSTED', sequence_number = v_sequence, document_number = v_void_number, posted_at = now()
    WHERE id = v_void_document_id;

    v_sequence := core.claim_next_document_number('JOURNAL_ENTRY', v_fiscal_year);
    v_journal_number := 'JE-' || v_fiscal_year || '-' || lpad(v_sequence::text, 6, '0');
    UPDATE core.business_documents
    SET status = 'POSTED', sequence_number = v_sequence, document_number = v_journal_number, posted_at = now()
    WHERE id = v_void_journal_id;

    UPDATE core.business_documents SET status = 'REVERSED' WHERE id = p_document_id;

    -- 14. Everything the slip needs.
    IF v_sale_kind = 'CASH' THEN
        SELECT jsonb_agg(jsonb_build_object(
                   'name', l.variant_name_snapshot,
                   'quantity', l.quantity::text,
                   'unit_price', l.unit_price::text,
                   'line_total', l.line_total::text) ORDER BY l.line_number)
        INTO v_lines
        FROM sales.cash_sale_lines l
        WHERE l.document_id = p_document_id;
    ELSE
        SELECT jsonb_agg(jsonb_build_object(
                   'name', l.variant_name_snapshot,
                   'quantity', l.quantity::text,
                   'unit_price', l.unit_price::text,
                   'line_total', l.line_total::text) ORDER BY l.line_number)
        INTO v_lines
        FROM sales.credit_sale_lines l
        WHERE l.document_id = p_document_id;
    END IF;

    RETURN jsonb_build_object(
        'void_document_id', v_void_document_id,
        'void_document_number', v_void_number,
        'original_document_id', p_document_id,
        'original_document_number', v_doc_number,
        'sale_kind', v_sale_kind,
        'customer_name', v_customer_name,
        'subtotal', v_sale_subtotal::text,
        'discount_amount', coalesce(v_sale_discount, 0)::text,
        'total_amount', v_sale_total::text,
        'reason_code', p_reason_code,
        'note', v_note,
        'cash_session_id', v_session_id,
        'journal_document_id', v_void_journal_id,
        'voided_at', now(),
        'lines', coalesce(v_lines, '[]'::jsonb)
    );
END;
$$;

-- =============================================================================
-- 6. sales.list_session_sales — the list on the cash session screen
-- =============================================================================

CREATE OR REPLACE FUNCTION sales.list_session_sales(
    p_session_token text,
    p_cash_session_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_user_id bigint;
    v_workstation text;
    v_opened_at timestamptz;
    v_closed_at timestamptz;
    v_result jsonb;
BEGIN
    SELECT user_id INTO v_user_id
    FROM iam.resolve_session_with_permission(p_session_token, 'VOID_SALE');

    SELECT workstation_id, opened_at, closed_at
    INTO v_workstation, v_opened_at, v_closed_at
    FROM sales.cash_sessions
    WHERE id = p_cash_session_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'cash session not found' USING ERRCODE = '22023';
    END IF;

    SELECT coalesce(jsonb_agg(row_data ORDER BY posted_at DESC, document_id DESC), '[]'::jsonb)
    INTO v_result
    FROM (
        SELECT d.id AS document_id, d.posted_at,
               jsonb_build_object(
                   'document_id', d.id,
                   'document_number', d.document_number,
                   'sale_kind', 'CASH',
                   'customer_name', NULL,
                   'total_amount', cs.total_amount::text,
                   'status', d.status,
                   'posted_at', d.posted_at,
                   'void_document_number', vd.document_number
               ) AS row_data
        FROM cash.movements m
        JOIN core.business_documents d ON d.id = m.business_document_id
        JOIN sales.cash_sales cs ON cs.document_id = d.id
        LEFT JOIN sales.sale_voids v ON v.original_document_id = d.id
        LEFT JOIN core.business_documents vd ON vd.id = v.void_document_id
        WHERE m.cash_session_id = p_cash_session_id
          AND m.movement_type = 'SALE'

        UNION ALL

        SELECT d.id, d.posted_at,
               jsonb_build_object(
                   'document_id', d.id,
                   'document_number', d.document_number,
                   'sale_kind', 'CREDIT',
                   'customer_name', c.name,
                   'total_amount', cr.total_amount::text,
                   'status', d.status,
                   'posted_at', d.posted_at,
                   'void_document_number', vd.document_number
               )
        FROM sales.credit_sales cr
        JOIN core.business_documents d ON d.id = cr.document_id
        JOIN receivables.customers c ON c.id = cr.customer_id
        LEFT JOIN sales.sale_voids v ON v.original_document_id = d.id
        LEFT JOIN core.business_documents vd ON vd.id = v.void_document_id
        WHERE cr.workstation_id = v_workstation
          AND cr.created_at >= v_opened_at
          AND (v_closed_at IS NULL OR cr.created_at <= v_closed_at)
          AND d.status IN ('POSTED', 'REVERSED')
    ) sales_rows;

    RETURN v_result;
END;
$$;

-- =============================================================================
-- 7. Privileges
-- =============================================================================

REVOKE ALL ON FUNCTION sales.void_sale(text, bigint, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION sales.list_session_sales(text, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sales.void_sale(text, bigint, text, text) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION sales.list_session_sales(text, bigint) TO stockiha_runtime;

-- =============================================================================
-- 8. Schema state (required on the newest migration)
-- =============================================================================

UPDATE operations.schema_state SET migration_version = 20260922090000, updated_at = now() WHERE singleton;

RESET ROLE;
