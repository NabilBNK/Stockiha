-- Migration: 20260814183000_fix_purchase_document_enqueue_contract.sql
-- Repair the purchase receipt document-generation queue contract.
-- Reuses the existing documents.* queue instead of the nonexistent core.enqueue_document_job API.

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'stockiha_owner') THEN
        EXECUTE 'SET ROLE stockiha_owner';
    END IF;
EXCEPTION WHEN OTHERS THEN
    NULL;
END $$;

-- Extend the closed generation-kind vocabulary without removing any existing kind.
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
        RAISE EXCEPTION
            'expected documents.generation_jobs constraint generation_jobs_document_kind_valid is missing';
    END IF;

    ALTER TABLE documents.generation_jobs
        DROP CONSTRAINT generation_jobs_document_kind_valid;

    EXECUTE format(
        'ALTER TABLE documents.generation_jobs ADD CONSTRAINT generation_jobs_document_kind_valid CHECK ((%s) OR document_kind IN (%L))',
        v_existing_check,
        'PURCHASE_RECEIPT_PDF'
    );
END;
$$;

-- Generalize the existing durable queue entry point to include purchase receipts.
CREATE OR REPLACE FUNCTION documents.enqueue_business_document_jobs(
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

    IF p_document_kind NOT IN (
        'CREDIT_SALE_INVOICE_PDF',
        'CUSTOMER_PAYMENT_RECEIPT_PDF',
        'PURCHASE_RECEIPT_PDF'
    ) THEN
        RAISE EXCEPTION 'unsupported business document generation kind' USING ERRCODE = '22023';
    END IF;

    IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
        RAISE EXCEPTION 'document job idempotency key is required' USING ERRCODE = '22023';
    END IF;

    INSERT INTO documents.generation_jobs (
        business_document_id,
        document_kind
    )
    VALUES (
        p_business_document_id,
        p_document_kind
    )
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
    )
    VALUES (
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
        WHERE idempotency_key = p_idempotency_key
          AND business_document_id = p_business_document_id;
    END IF;

    IF v_print_job_id IS NULL THEN
        RAISE EXCEPTION
            'document job idempotency key belongs to another business document'
            USING ERRCODE = '23505';
    END IF;

    RETURN QUERY
    SELECT v_generation_job_id, v_print_job_id;
END;
$$;

REVOKE ALL ON FUNCTION documents.enqueue_business_document_jobs(bigint, text, text) FROM PUBLIC;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'stockiha_owner') THEN
        EXECUTE 'RESET ROLE';
    END IF;
EXCEPTION WHEN OTHERS THEN
    NULL;
END $$;
