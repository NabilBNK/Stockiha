-- Forward repair: calculate a receipt while mutable, then post it once.
-- This preserves the immutable-record trigger instead of bypassing it.

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
        $match$'PURCHASE_RECEIPT', 'POSTED', p_document_date, p_fiscal_period_id, v_fiscal_year,$match$,
        $replacement$'PURCHASE_RECEIPT', 'DRAFT', p_document_date, p_fiscal_period_id, v_fiscal_year,$replacement$
    );
    v_definition := replace(
        v_definition,
        '    -- 12. Record Idempotency Result',
        '    UPDATE core.business_documents' || chr(10) ||
        '    SET status = ''POSTED'', posted_at = now()' || chr(10) ||
        '    WHERE id = v_receipt_document_id;' || chr(10) || chr(10) ||
        '    -- 12. Record Idempotency Result'
    );
    IF position($match$'PURCHASE_RECEIPT', 'DRAFT'$match$ IN v_definition) = 0 THEN
        RAISE EXCEPTION 'Direct Purchase posting-order replacement failed';
    END IF;
    EXECUTE v_definition;
END;
$$;

RESET ROLE;
