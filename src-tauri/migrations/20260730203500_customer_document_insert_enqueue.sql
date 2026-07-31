-- S4-001: some posting functions (notably CUSTOMER_PAYMENT) insert the
-- business-document header directly as POSTED instead of transitioning a draft.
-- The 203000 migration covers DRAFT -> POSTED updates; this companion trigger
-- covers direct posted inserts without changing the financial posting model.
SET ROLE stockiha_owner;

CREATE FUNCTION documents.enqueue_customer_jobs_after_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_kind text;
    v_key text;
BEGIN
    IF NEW.status <> 'POSTED' THEN
        RETURN NEW;
    END IF;

    IF NEW.document_type = 'CREDIT_SALE' THEN
        v_kind := 'CREDIT_SALE_INVOICE_PDF';
        v_key := 'credit_sale_invoice:' || NEW.id::text;
    ELSIF NEW.document_type = 'CUSTOMER_PAYMENT' THEN
        v_kind := 'CUSTOMER_PAYMENT_RECEIPT_PDF';
        v_key := 'customer_payment_receipt:' || NEW.id::text;
    ELSE
        RETURN NEW;
    END IF;

    PERFORM generation_job_id
    FROM documents.enqueue_business_document_jobs(NEW.id, v_kind, v_key);
    RETURN NEW;
END;
$$;

CREATE TRIGGER business_documents_enqueue_customer_jobs_insert
    AFTER INSERT ON core.business_documents
    FOR EACH ROW
    EXECUTE FUNCTION documents.enqueue_customer_jobs_after_insert();

REVOKE ALL ON FUNCTION documents.enqueue_customer_jobs_after_insert() FROM PUBLIC;

RESET ROLE;
