-- S4-001: Detection-only customer credit-state reconciliation.
--
-- `customer_credit_state` is a transactional cache used for row locking and fast
-- credit decisions. Ledger truth must be independently recomputable. This
-- function reports divergence but deliberately does not repair live state;
-- production repair policy remains subject to backup/maintenance/audit controls.
SET ROLE stockiha_owner;

CREATE FUNCTION receivables.reconcile_customer_credit_state(
    p_session_token text,
    p_customer_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_user_id bigint;
    v_cached_exposure numeric(14,2);
    v_cached_oldest_due date;
    v_ledger_exposure numeric(14,2);
    v_computed_oldest_due date;
BEGIN
    SELECT user_id INTO v_user_id
    FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_CUSTOMERS');

    SELECT exposure_amount, oldest_open_due_date
    INTO v_cached_exposure, v_cached_oldest_due
    FROM receivables.customer_credit_state
    WHERE customer_id = p_customer_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'customer credit state not found' USING ERRCODE = '22023';
    END IF;

    SELECT coalesce(sum(l.amount_delta), 0)::numeric(14,2)
    INTO v_ledger_exposure
    FROM receivables.customer_ledger_entries l
    WHERE l.customer_id = p_customer_id;

    SELECT min(l.due_date)
    INTO v_computed_oldest_due
    FROM receivables.customer_ledger_entries l
    WHERE l.customer_id = p_customer_id
      AND l.entry_type = 'CREDIT_INVOICE'
      AND l.due_date IS NOT NULL
      AND l.amount_delta > coalesce((
          SELECT sum(pa.amount)
          FROM receivables.payment_allocations pa
          WHERE pa.invoice_ledger_entry_id = l.id
      ), 0);

    RETURN jsonb_build_object(
        'customer_id', p_customer_id,
        'cached_exposure', v_cached_exposure::text,
        'ledger_exposure', v_ledger_exposure::text,
        'exposure_matches', v_cached_exposure = v_ledger_exposure,
        'cached_oldest_open_due_date', v_cached_oldest_due,
        'computed_oldest_open_due_date', v_computed_oldest_due,
        'oldest_due_matches', v_cached_oldest_due IS NOT DISTINCT FROM v_computed_oldest_due,
        'reconciled',
            v_cached_exposure = v_ledger_exposure
            AND v_cached_oldest_due IS NOT DISTINCT FROM v_computed_oldest_due
    );
END;
$$;

REVOKE ALL ON FUNCTION receivables.reconcile_customer_credit_state(text, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION receivables.reconcile_customer_credit_state(text, bigint) TO stockiha_runtime;

RESET ROLE;
