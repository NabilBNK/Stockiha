-- S4-001: durable customer-document generation / print-queue integration.
-- Credit-sale invoices and customer-payment receipts now enter the same
-- generation -> print state machine used by cash-sale receipts. Queue rows are
-- created inside the posting transaction via an AFTER status trigger, so a
-- rolled-back posting can never leave an orphan document/print job.
SET ROLE stockiha_owner;

-- Extend the installed closed generation-kind vocabulary without narrowing
-- values introduced by earlier slices/patches.
DO $$
DECLARE
    v_existing_check text;
BEGIN
    SELECT pg_get_expr(c.conbin, c.conrelid)
    INTO v_existing_check
    FROM pg_constraint c
    WHERE c.conrelid = 'documents.generation_jobs'::regclass
      AND c.conname = 'generation_jobs_document_kind_valid'
      AND c.contype = 'c';

    IF v_existing_check IS NULL THEN
        RAISE EXCEPTION 'expected documents.generation_jobs constraint generation_jobs_document_kind_valid is missing';
    END IF;

    ALTER TABLE documents.generation_jobs
        DROP CONSTRAINT generation_jobs_document_kind_valid;

    EXECUTE format(
        'ALTER TABLE documents.generation_jobs ADD CONSTRAINT generation_jobs_document_kind_valid CHECK ((%s) OR document_kind IN (%L, %L))',
        v_existing_check,
        'CREDIT_SALE_INVOICE_PDF',
        'CUSTOMER_PAYMENT_RECEIPT_PDF'
    );
END;
$$;

CREATE FUNCTION documents.enqueue_business_document_jobs(
    p_business_document_id bigint,
    p_document_kind text,
    p_idempotency_key text
)
RETURNS TABLE (generation_job_id bigint, print_job_id bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_generation_job_id bigint;
    v_print_job_id bigint;
BEGIN
    IF p_business_document_id IS NULL OR p_business_document_id <= 0 THEN
        RAISE EXCEPTION 'business document id is required' USING ERRCODE = '22023';
    END IF;
    IF p_document_kind NOT IN ('CREDIT_SALE_INVOICE_PDF', 'CUSTOMER_PAYMENT_RECEIPT_PDF') THEN
        RAISE EXCEPTION 'unsupported customer generation kind' USING ERRCODE = '22023';
    END IF;
    IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
        RAISE EXCEPTION 'print idempotency key is required' USING ERRCODE = '22023';
    END IF;

    INSERT INTO documents.generation_jobs (business_document_id, document_kind)
    VALUES (p_business_document_id, p_document_kind)
    ON CONFLICT (business_document_id, document_kind) DO NOTHING
    RETURNING id INTO v_generation_job_id;

    IF v_generation_job_id IS NULL THEN
        SELECT id
        INTO v_generation_job_id
        FROM documents.generation_jobs
        WHERE business_document_id = p_business_document_id
          AND document_kind = p_document_kind;
    END IF;

    INSERT INTO documents.print_jobs (
        generation_job_id,
        business_document_id,
        idempotency_key,
        status
    ) VALUES (
        v_generation_job_id,
        p_business_document_id,
        p_idempotency_key,
        'WAITING_FOR_GENERATION'
    )
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id INTO v_print_job_id;

    IF v_print_job_id IS NULL THEN
        SELECT id
        INTO v_print_job_id
        FROM documents.print_jobs
        WHERE idempotency_key = p_idempotency_key;
    END IF;

    RETURN QUERY SELECT v_generation_job_id, v_print_job_id;
END;
$$;

CREATE FUNCTION documents.enqueue_customer_jobs_after_post()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_kind text;
    v_key text;
BEGIN
    IF NEW.status <> 'POSTED' OR OLD.status = 'POSTED' THEN
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

    PERFORM * FROM documents.enqueue_business_document_jobs(NEW.id, v_kind, v_key);
    RETURN NEW;
END;
$$;

CREATE TRIGGER business_documents_enqueue_customer_jobs
    AFTER UPDATE OF status ON core.business_documents
    FOR EACH ROW
    EXECUTE FUNCTION documents.enqueue_customer_jobs_after_post();

-- Backfill customer documents posted before this migration. This is safe and
-- idempotent because both queue sides have structural uniqueness.
INSERT INTO documents.generation_jobs (business_document_id, document_kind)
SELECT bd.id,
       CASE bd.document_type
           WHEN 'CREDIT_SALE' THEN 'CREDIT_SALE_INVOICE_PDF'
           WHEN 'CUSTOMER_PAYMENT' THEN 'CUSTOMER_PAYMENT_RECEIPT_PDF'
       END
FROM core.business_documents bd
WHERE bd.status = 'POSTED'
  AND bd.document_type IN ('CREDIT_SALE', 'CUSTOMER_PAYMENT')
ON CONFLICT (business_document_id, document_kind) DO NOTHING;

INSERT INTO documents.print_jobs (
    generation_job_id,
    business_document_id,
    idempotency_key,
    status
)
SELECT g.id,
       g.business_document_id,
       CASE g.document_kind
           WHEN 'CREDIT_SALE_INVOICE_PDF' THEN 'credit_sale_invoice:' || g.business_document_id::text
           WHEN 'CUSTOMER_PAYMENT_RECEIPT_PDF' THEN 'customer_payment_receipt:' || g.business_document_id::text
       END,
       CASE WHEN g.status = 'COMPLETED' THEN 'PENDING' ELSE 'WAITING_FOR_GENERATION' END
FROM documents.generation_jobs g
WHERE g.document_kind IN ('CREDIT_SALE_INVOICE_PDF', 'CUSTOMER_PAYMENT_RECEIPT_PDF')
ON CONFLICT (idempotency_key) DO NOTHING;

-- Retryable generation failures must actually be claimable again. Earlier
-- Slice-1 queue code stored RETRYABLE_FAILURE but claim_next omitted it.
CREATE OR REPLACE FUNCTION documents.claim_next_generation_job(
    p_claimed_by text,
    p_lease_seconds integer
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_job_id bigint;
BEGIN
    IF p_claimed_by IS NULL OR btrim(p_claimed_by) = ''
       OR p_lease_seconds IS NULL OR p_lease_seconds < 1 OR p_lease_seconds > 3600 THEN
        RAISE EXCEPTION 'invalid generation claim parameters' USING ERRCODE = '22023';
    END IF;

    SELECT id INTO v_job_id
    FROM documents.generation_jobs
    WHERE (status IN ('PENDING', 'RETRYABLE_FAILURE') AND next_attempt_at <= now())
       OR (status IN ('CLAIMED', 'GENERATING') AND lease_expires_at <= now())
    ORDER BY next_attempt_at, id
    FOR UPDATE SKIP LOCKED
    LIMIT 1;

    IF v_job_id IS NULL THEN
        RETURN NULL;
    END IF;

    UPDATE documents.generation_jobs
    SET status = 'CLAIMED',
        claimed_by = p_claimed_by,
        lease_expires_at = now() + make_interval(secs => p_lease_seconds),
        attempt_count = attempt_count + 1,
        error_code = NULL,
        error_message = NULL
    WHERE id = v_job_id;

    RETURN v_job_id;
END;
$$;

CREATE OR REPLACE FUNCTION documents.complete_generation_job(
    p_job_id bigint,
    p_success boolean,
    p_permanent boolean,
    p_generated_file_ref text,
    p_error_code text,
    p_error_message text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    IF p_success THEN
        IF p_generated_file_ref IS NULL OR btrim(p_generated_file_ref) = '' THEN
            RAISE EXCEPTION 'generated file reference is required on success' USING ERRCODE = '22023';
        END IF;

        UPDATE documents.generation_jobs
        SET status = 'COMPLETED',
            generated_file_ref = p_generated_file_ref,
            claimed_by = NULL,
            lease_expires_at = NULL,
            error_code = NULL,
            error_message = NULL
        WHERE id = p_job_id;

        UPDATE documents.print_jobs
        SET status = 'PENDING'
        WHERE generation_job_id = p_job_id
          AND status = 'WAITING_FOR_GENERATION';
    ELSE
        UPDATE documents.generation_jobs
        SET status = CASE WHEN p_permanent THEN 'PERMANENT_FAILURE' ELSE 'RETRYABLE_FAILURE' END,
            next_attempt_at = CASE WHEN p_permanent THEN next_attempt_at ELSE now() + interval '30 seconds' END,
            claimed_by = NULL,
            lease_expires_at = NULL,
            error_code = p_error_code,
            error_message = p_error_message
        WHERE id = p_job_id;
    END IF;
END;
$$;

-- User-triggered customer-document generation claims one exact document job;
-- it can never accidentally claim another terminal's pending document.
CREATE FUNCTION documents.claim_customer_generation_job(
    p_session_token text,
    p_document_id bigint,
    p_claimed_by text,
    p_lease_seconds integer
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_document_type text;
    v_job_id bigint;
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'VIEW_CUSTOMERS');

    SELECT document_type INTO v_document_type
    FROM core.business_documents
    WHERE id = p_document_id
      AND status IN ('POSTED', 'REVERSED');

    IF v_document_type NOT IN ('CREDIT_SALE', 'CUSTOMER_PAYMENT') THEN
        RAISE EXCEPTION 'document is not a customer document' USING ERRCODE = '22023';
    END IF;
    IF p_claimed_by IS NULL OR btrim(p_claimed_by) = ''
       OR p_lease_seconds IS NULL OR p_lease_seconds < 1 OR p_lease_seconds > 3600 THEN
        RAISE EXCEPTION 'invalid generation claim parameters' USING ERRCODE = '22023';
    END IF;

    SELECT id INTO v_job_id
    FROM documents.generation_jobs
    WHERE business_document_id = p_document_id
      AND document_kind IN ('CREDIT_SALE_INVOICE_PDF', 'CUSTOMER_PAYMENT_RECEIPT_PDF')
      AND (
          (status IN ('PENDING', 'RETRYABLE_FAILURE') AND next_attempt_at <= now())
          OR (status IN ('CLAIMED', 'GENERATING') AND lease_expires_at <= now())
      )
    ORDER BY id
    FOR UPDATE SKIP LOCKED
    LIMIT 1;

    IF v_job_id IS NULL THEN
        RETURN NULL;
    END IF;

    UPDATE documents.generation_jobs
    SET status = 'CLAIMED',
        claimed_by = p_claimed_by,
        lease_expires_at = now() + make_interval(secs => p_lease_seconds),
        attempt_count = attempt_count + 1,
        error_code = NULL,
        error_message = NULL
    WHERE id = v_job_id;

    RETURN v_job_id;
END;
$$;

CREATE FUNCTION documents.list_printable_documents(
    p_session_token text,
    p_limit integer DEFAULT 100
)
RETURNS TABLE (
    document_id bigint,
    document_type text,
    document_number text,
    document_date date,
    posted_at timestamptz,
    generation_status text,
    generated_file_ref text,
    print_status text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_user_id bigint;
    v_can_cash boolean;
    v_can_customers boolean;
BEGIN
    SELECT user_id INTO v_user_id FROM iam.resolve_session(p_session_token);

    IF p_limit IS NULL OR p_limit < 1 OR p_limit > 500 THEN
        RAISE EXCEPTION 'document list limit must be between 1 and 500' USING ERRCODE = '22023';
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM iam.user_roles ur
        JOIN iam.role_permissions rp ON rp.role_id = ur.role_id
        JOIN iam.permissions p ON p.id = rp.permission_id
        WHERE ur.user_id = v_user_id AND p.code = 'POST_CASH_SALE'
    ) INTO v_can_cash;

    SELECT EXISTS (
        SELECT 1
        FROM iam.user_roles ur
        JOIN iam.role_permissions rp ON rp.role_id = ur.role_id
        JOIN iam.permissions p ON p.id = rp.permission_id
        WHERE ur.user_id = v_user_id AND p.code = 'VIEW_CUSTOMERS'
    ) INTO v_can_customers;

    RETURN QUERY
    SELECT bd.id,
           bd.document_type,
           bd.document_number,
           bd.document_date,
           bd.posted_at,
           gen.status,
           gen.generated_file_ref,
           pr.status
    FROM core.business_documents bd
    LEFT JOIN LATERAL (
        SELECT g.status, g.generated_file_ref
        FROM documents.generation_jobs g
        WHERE g.business_document_id = bd.id
        ORDER BY g.id DESC
        LIMIT 1
    ) gen ON true
    LEFT JOIN LATERAL (
        SELECT pj.status
        FROM documents.print_jobs pj
        WHERE pj.business_document_id = bd.id
        ORDER BY pj.id DESC
        LIMIT 1
    ) pr ON true
    WHERE bd.status IN ('POSTED', 'REVERSED')
      AND (
          (bd.document_type = 'CASH_SALE' AND v_can_cash)
          OR (bd.document_type IN ('CREDIT_SALE', 'CUSTOMER_PAYMENT') AND v_can_customers)
      )
    ORDER BY bd.posted_at DESC NULLS LAST, bd.id DESC
    LIMIT p_limit;
END;
$$;

CREATE FUNCTION documents.enqueue_customer_reprint(
    p_session_token text,
    p_document_id bigint,
    p_idempotency_key text
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_document_type text;
    v_generation_job_id bigint;
    v_print_job_id bigint;
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'VIEW_CUSTOMERS');

    SELECT document_type INTO v_document_type
    FROM core.business_documents
    WHERE id = p_document_id
      AND status IN ('POSTED', 'REVERSED');

    IF v_document_type NOT IN ('CREDIT_SALE', 'CUSTOMER_PAYMENT') THEN
        RAISE EXCEPTION 'document is not a customer document' USING ERRCODE = '22023';
    END IF;
    IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
        RAISE EXCEPTION 'reprint idempotency key is required' USING ERRCODE = '22023';
    END IF;

    SELECT id INTO v_generation_job_id
    FROM documents.generation_jobs
    WHERE business_document_id = p_document_id
      AND document_kind IN ('CREDIT_SALE_INVOICE_PDF', 'CUSTOMER_PAYMENT_RECEIPT_PDF')
      AND status = 'COMPLETED'
    ORDER BY id DESC
    LIMIT 1;

    IF v_generation_job_id IS NULL THEN
        RAISE EXCEPTION 'customer document must be generated before reprint' USING ERRCODE = '55000';
    END IF;

    INSERT INTO documents.print_jobs (
        generation_job_id,
        business_document_id,
        idempotency_key,
        status
    ) VALUES (
        v_generation_job_id,
        p_document_id,
        p_idempotency_key,
        'PENDING'
    )
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id INTO v_print_job_id;

    IF v_print_job_id IS NULL THEN
        SELECT id INTO v_print_job_id
        FROM documents.print_jobs
        WHERE idempotency_key = p_idempotency_key
          AND business_document_id = p_document_id;
    END IF;

    IF v_print_job_id IS NULL THEN
        RAISE EXCEPTION 'reprint idempotency key belongs to another document' USING ERRCODE = '23505';
    END IF;

    RETURN v_print_job_id;
END;
$$;

REVOKE ALL ON FUNCTION documents.enqueue_business_document_jobs(bigint, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION documents.enqueue_customer_jobs_after_post() FROM PUBLIC;
REVOKE ALL ON FUNCTION documents.claim_customer_generation_job(text, bigint, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION documents.list_printable_documents(text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION documents.enqueue_customer_reprint(text, bigint, text) FROM PUBLIC;

-- The generic enqueue helper is owner-internal. Runtime receives only the
-- session-authorized customer operations and the existing worker transitions.
GRANT EXECUTE ON FUNCTION documents.claim_customer_generation_job(text, bigint, text, integer) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION documents.list_printable_documents(text, integer) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION documents.enqueue_customer_reprint(text, bigint, text) TO stockiha_runtime;

RESET ROLE;
