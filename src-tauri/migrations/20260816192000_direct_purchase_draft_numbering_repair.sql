-- Forward repair: draft business documents must not carry official numbering.

SET ROLE stockiha_owner;

DO $$
DECLARE
    v_definition text;
BEGIN
    SELECT pg_get_functiondef(
        'inventory.confirm_direct_purchase(text, uuid, bytea, bigint, bigint, bigint, date, text, jsonb)'::regprocedure
    ) INTO v_definition;

    v_definition := replace(
        v_definition,
        $match$'PURCHASE_RECEIPT', 'DRAFT', p_document_date, p_fiscal_period_id, v_fiscal_year,
        v_sequence, v_document_number, now()$match$,
        $replacement$'PURCHASE_RECEIPT', 'DRAFT', p_document_date, p_fiscal_period_id, v_fiscal_year,
        NULL, NULL, NULL$replacement$
    );
    v_definition := replace(
        v_definition,
        $match$SET status = 'POSTED', posted_at = now()
    WHERE id = v_receipt_document_id;$match$,
        $replacement$SET status = 'POSTED',
        sequence_number = v_sequence,
        document_number = v_document_number,
        posted_at = now()
    WHERE id = v_receipt_document_id;$replacement$
    );
    IF position($match$NULL, NULL, NULL$match$ IN v_definition) = 0 THEN
        RAISE EXCEPTION 'Direct Purchase draft-numbering replacement failed';
    END IF;
    EXECUTE v_definition;
END;
$$;

RESET ROLE;
