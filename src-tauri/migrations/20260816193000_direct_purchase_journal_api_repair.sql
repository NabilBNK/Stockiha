-- Forward repair: use the installed journal-line table contract.

SET ROLE stockiha_owner;

DO $$
DECLARE v_definition text;
BEGIN
    SELECT pg_get_functiondef('inventory.confirm_direct_purchase(text, uuid, bytea, bigint, bigint, bigint, date, text, jsonb)'::regprocedure) INTO v_definition;
    v_definition := replace(v_definition, $match$    PERFORM finance.add_journal_line(
        v_journal_document_id,
        1,
        'INVENTORY_MERCHANDISE',
        v_receipt_subtotal,
        0.00,
        'Direct purchase inventory debit'
    );

    PERFORM finance.add_journal_line(
        v_journal_document_id,
        2,
        'GRNI',
        0.00,
        v_receipt_subtotal,
        'Direct purchase un-invoiced goods receipt credit'
    );$match$, $replacement$    INSERT INTO finance.journal_lines (document_id, line_number, account_code, debit, credit)
    VALUES
        (v_journal_document_id, 1, finance.require_account_role('INVENTORY'), v_receipt_subtotal, 0),
        (v_journal_document_id, 2, finance.require_account_role('GRNI'), 0, v_receipt_subtotal);$replacement$);
    IF position('finance.add_journal_line' IN v_definition) > 0 THEN RAISE EXCEPTION 'Direct Purchase journal API replacement failed'; END IF;
    EXECUTE v_definition;
END;
$$;

RESET ROLE;
