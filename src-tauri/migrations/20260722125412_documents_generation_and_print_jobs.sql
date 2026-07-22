-- Slice 1 MVP batch: `documents.generation_jobs` and `documents.print_jobs`
-- (final-architecture.md section 5, names and state machines both taken
-- verbatim from architecture).
SET ROLE stockiha_owner;

CREATE SCHEMA IF NOT EXISTS documents AUTHORIZATION stockiha_owner;
REVOKE ALL ON SCHEMA documents FROM PUBLIC;
GRANT USAGE ON SCHEMA documents TO stockiha_runtime;

-- States: PENDING -> CLAIMED -> GENERATING -> COMPLETED | RETRYABLE_FAILURE
-- | PERMANENT_FAILURE.
CREATE TABLE documents.generation_jobs (
    id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    business_document_id bigint NOT NULL REFERENCES core.business_documents (id),
    -- Closed set: only the one receipt kind this batch produces. Extending
    -- this is a future migration, not a loose free-text column.
    document_kind        text NOT NULL,
    status                text NOT NULL DEFAULT 'PENDING',
    claimed_by            text,
    lease_expires_at      timestamptz,
    attempt_count         integer NOT NULL DEFAULT 0,
    next_attempt_at       timestamptz NOT NULL DEFAULT now(),
    external_job_id       text,
    error_code            text,
    error_message         text,
    generated_file_ref    text,
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT generation_jobs_status_valid CHECK (
        status IN ('PENDING', 'CLAIMED', 'GENERATING', 'COMPLETED', 'RETRYABLE_FAILURE', 'PERMANENT_FAILURE')
    ),
    CONSTRAINT generation_jobs_document_kind_valid CHECK (document_kind IN ('CASH_SALE_RECEIPT')),
    CONSTRAINT generation_jobs_one_per_document_and_kind UNIQUE (business_document_id, document_kind),
    CONSTRAINT generation_jobs_attempt_count_non_negative CHECK (attempt_count >= 0)
);

-- States: WAITING_FOR_GENERATION -> PENDING -> CLAIMED -> SENDING ->
-- SUBMITTED -> COMPLETED | RETRYABLE_FAILURE | PERMANENT_FAILURE |
-- UNKNOWN_DELIVERY | CANCELLED. A print job inserted during the sale
-- transaction uses WAITING_FOR_GENERATION; it only becomes PENDING once its
-- generation job reaches COMPLETED (enforced by
-- `documents.complete_generation_job`, not by application code, so it
-- cannot be skipped).
CREATE TABLE documents.print_jobs (
    id                     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    generation_job_id      bigint NOT NULL REFERENCES documents.generation_jobs (id),
    business_document_id   bigint NOT NULL REFERENCES core.business_documents (id),
    -- Task requirement: idempotent uniqueness for queue records — one print
    -- job per triggering event (e.g. `cash_sale_receipt:<document_id>`).
    idempotency_key        text NOT NULL,
    status                 text NOT NULL DEFAULT 'WAITING_FOR_GENERATION',
    claimed_by             text,
    lease_expires_at       timestamptz,
    attempt_count          integer NOT NULL DEFAULT 0,
    next_attempt_at        timestamptz NOT NULL DEFAULT now(),
    external_job_id        text,
    error_code             text,
    error_message          text,
    created_at             timestamptz NOT NULL DEFAULT now(),
    updated_at             timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT print_jobs_status_valid CHECK (
        status IN (
            'WAITING_FOR_GENERATION', 'PENDING', 'CLAIMED', 'SENDING', 'SUBMITTED',
            'COMPLETED', 'RETRYABLE_FAILURE', 'PERMANENT_FAILURE', 'UNKNOWN_DELIVERY', 'CANCELLED'
        )
    ),
    CONSTRAINT print_jobs_idempotency_key_unique UNIQUE (idempotency_key),
    CONSTRAINT print_jobs_attempt_count_non_negative CHECK (attempt_count >= 0)
);

CREATE TRIGGER generation_jobs_set_updated_at
    BEFORE UPDATE ON documents.generation_jobs
    FOR EACH ROW
    EXECUTE FUNCTION core.set_updated_at();

CREATE TRIGGER print_jobs_set_updated_at
    BEFORE UPDATE ON documents.print_jobs
    FOR EACH ROW
    EXECUTE FUNCTION core.set_updated_at();

-- Enqueues (inside the posting transaction) a generation job and its
-- linked, WAITING_FOR_GENERATION print job in one call. Idempotent: a
-- duplicate call with the same idempotency key returns the existing print
-- job instead of creating a second one; `generation_jobs_one_per_document_
-- and_kind` gives the generation side the same guarantee.
CREATE FUNCTION documents.enqueue_receipt_jobs(
    p_business_document_id bigint,
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
    INSERT INTO documents.generation_jobs (business_document_id, document_kind)
    VALUES (p_business_document_id, 'CASH_SALE_RECEIPT')
    ON CONFLICT (business_document_id, document_kind) DO NOTHING
    RETURNING id INTO v_generation_job_id;

    IF v_generation_job_id IS NULL THEN
        SELECT id INTO v_generation_job_id
            FROM documents.generation_jobs
            WHERE business_document_id = p_business_document_id AND document_kind = 'CASH_SALE_RECEIPT';
    END IF;

    INSERT INTO documents.print_jobs (generation_job_id, business_document_id, idempotency_key)
    VALUES (v_generation_job_id, p_business_document_id, p_idempotency_key)
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id INTO v_print_job_id;

    IF v_print_job_id IS NULL THEN
        SELECT id INTO v_print_job_id FROM documents.print_jobs WHERE idempotency_key = p_idempotency_key;
    END IF;

    RETURN QUERY SELECT v_generation_job_id, v_print_job_id;
END;
$$;

CREATE FUNCTION documents.claim_next_generation_job(p_claimed_by text, p_lease_seconds integer)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_job_id bigint;
BEGIN
    SELECT id INTO v_job_id
        FROM documents.generation_jobs
        WHERE (status = 'PENDING' AND next_attempt_at <= now())
           OR (status IN ('CLAIMED', 'GENERATING') AND lease_expires_at <= now())
        ORDER BY next_attempt_at
        FOR UPDATE SKIP LOCKED
        LIMIT 1;

    IF v_job_id IS NULL THEN
        RETURN NULL;
    END IF;

    UPDATE documents.generation_jobs
        SET status = 'CLAIMED',
            claimed_by = p_claimed_by,
            lease_expires_at = now() + make_interval(secs => p_lease_seconds),
            attempt_count = attempt_count + 1
        WHERE id = v_job_id;

    RETURN v_job_id;
END;
$$;

CREATE FUNCTION documents.start_generation(p_job_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    UPDATE documents.generation_jobs SET status = 'GENERATING' WHERE id = p_job_id;
END;
$$;

-- On success, also flips the linked print job from WAITING_FOR_GENERATION
-- to PENDING — the only place that transition happens, so "print job
-- cannot run before generation completes" (architecture section 6) is
-- structural, not a convention application code has to remember.
CREATE FUNCTION documents.complete_generation_job(
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
        UPDATE documents.generation_jobs
            SET status = 'COMPLETED', generated_file_ref = p_generated_file_ref
            WHERE id = p_job_id;
        UPDATE documents.print_jobs
            SET status = 'PENDING'
            WHERE generation_job_id = p_job_id AND status = 'WAITING_FOR_GENERATION';
    ELSE
        UPDATE documents.generation_jobs
            SET status = CASE WHEN p_permanent THEN 'PERMANENT_FAILURE' ELSE 'RETRYABLE_FAILURE' END,
                error_code = p_error_code,
                error_message = p_error_message
            WHERE id = p_job_id;
    END IF;
END;
$$;

CREATE FUNCTION documents.claim_next_print_job(p_claimed_by text, p_lease_seconds integer)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_job_id bigint;
BEGIN
    -- Only PENDING (never WAITING_FOR_GENERATION) is eligible — this is
    -- the "print job cannot run before generation completes" queue-safety
    -- rule enforced at the claim boundary too, not just at the transition
    -- above.
    SELECT id INTO v_job_id
        FROM documents.print_jobs
        WHERE (status = 'PENDING' AND next_attempt_at <= now())
           OR (status IN ('CLAIMED', 'SENDING') AND lease_expires_at <= now())
        ORDER BY next_attempt_at
        FOR UPDATE SKIP LOCKED
        LIMIT 1;

    IF v_job_id IS NULL THEN
        RETURN NULL;
    END IF;

    UPDATE documents.print_jobs
        SET status = 'CLAIMED',
            claimed_by = p_claimed_by,
            lease_expires_at = now() + make_interval(secs => p_lease_seconds),
            attempt_count = attempt_count + 1
        WHERE id = v_job_id;

    RETURN v_job_id;
END;
$$;

CREATE FUNCTION documents.mark_print_sending(p_job_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    UPDATE documents.print_jobs SET status = 'SENDING' WHERE id = p_job_id;
END;
$$;

-- `p_outcome` is one of the print job's own terminal-or-submitted states:
-- SUBMITTED, COMPLETED, RETRYABLE_FAILURE, PERMANENT_FAILURE,
-- UNKNOWN_DELIVERY, or CANCELLED. Architecture: "Unknown printer delivery
-- states do not trigger automatic retries" — `UNKNOWN_DELIVERY` is treated
-- as terminal by this function (it never sets `next_attempt_at` forward),
-- matching that rule.
CREATE FUNCTION documents.complete_print_job(
    p_job_id bigint,
    p_outcome text,
    p_external_job_id text,
    p_error_code text,
    p_error_message text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    IF p_outcome NOT IN ('SUBMITTED', 'COMPLETED', 'RETRYABLE_FAILURE', 'PERMANENT_FAILURE', 'UNKNOWN_DELIVERY', 'CANCELLED') THEN
        RAISE EXCEPTION 'invalid print job outcome: %', p_outcome USING ERRCODE = '22023';
    END IF;

    UPDATE documents.print_jobs
        SET status = p_outcome,
            external_job_id = p_external_job_id,
            error_code = p_error_code,
            error_message = p_error_message
        WHERE id = p_job_id;
END;
$$;


REVOKE ALL ON documents.generation_jobs FROM PUBLIC;
REVOKE ALL ON documents.print_jobs FROM PUBLIC;
REVOKE ALL ON FUNCTION documents.enqueue_receipt_jobs(bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION documents.claim_next_generation_job(text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION documents.start_generation(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION documents.complete_generation_job(bigint, boolean, boolean, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION documents.claim_next_print_job(text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION documents.mark_print_sending(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION documents.complete_print_job(bigint, text, text, text, text) FROM PUBLIC;

-- `enqueue_receipt_jobs` is called only from inside the cash-sale posting
-- function's own transaction. The generation/print worker processes call
-- the claim/start/complete functions directly as `stockiha_runtime` (they
-- are background workers, not posting functions).
GRANT SELECT ON documents.generation_jobs TO stockiha_runtime;
GRANT SELECT ON documents.print_jobs TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION documents.claim_next_generation_job(text, integer) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION documents.start_generation(bigint) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION documents.complete_generation_job(bigint, boolean, boolean, text, text, text) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION documents.claim_next_print_job(text, integer) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION documents.mark_print_sending(bigint) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION documents.complete_print_job(bigint, text, text, text, text) TO stockiha_runtime;

RESET ROLE;
