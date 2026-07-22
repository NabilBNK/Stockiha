-- Slice 1 MVP batch: `cash.movements` (the cash ledger a confirmed cash
-- sale appends to) and `cash.drawer_jobs` (final-architecture.md section 5:
-- "Cash drawer openings are managed as a separate, idempotent queue
-- (`cash.drawer_jobs`) to prevent multiple drawer pulses during receipt
-- printing retries").
--
-- Schema placement note: architecture names `cash.drawer_jobs` literally, so
-- `cash.movements` is placed in the same schema for consistency —
-- `sales.cash_sessions` stays in `sales` because the task's own
-- schema-placement list names it there explicitly.
SET ROLE stockiha_owner;

CREATE SCHEMA IF NOT EXISTS cash AUTHORIZATION stockiha_owner;
REVOKE ALL ON SCHEMA cash FROM PUBLIC;
GRANT USAGE ON SCHEMA cash TO stockiha_runtime;

-- Append-only, immutable cash ledger. MVP scope: only the 'SALE' movement
-- type exists (a confirmed cash sale's cash-in). Other eligible operations
-- listed in architecture section 3.E (payments, refunds, expenses,
-- deposits/withdrawals) are out of scope until their own posting functions
-- exist.
CREATE TABLE cash.movements (
    id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    cash_session_id    bigint NOT NULL REFERENCES sales.cash_sessions (id),
    business_document_id bigint REFERENCES core.business_documents (id),
    movement_type      text NOT NULL,
    amount             numeric(14, 2) NOT NULL,
    created_at         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT movements_movement_type_valid CHECK (movement_type IN ('SALE')),
    CONSTRAINT movements_amount_positive CHECK (amount > 0)
);

CREATE FUNCTION cash.forbid_movement_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'cash.movements rows are immutable and append-only'
        USING ERRCODE = '0A000';
END;
$$;

CREATE TRIGGER movements_forbid_update
    BEFORE UPDATE ON cash.movements
    FOR EACH ROW
    EXECUTE FUNCTION cash.forbid_movement_mutation();

CREATE TRIGGER movements_forbid_delete
    BEFORE DELETE ON cash.movements
    FOR EACH ROW
    EXECUTE FUNCTION cash.forbid_movement_mutation();

-- Drawer pulse queue (final-architecture.md section 5): states
-- PENDING -> CLAIMED -> PULSE_SUBMITTED | PULSE_FAILED | CANCELLED. The
-- common lease fields match architecture's own list exactly: claimed_by,
-- lease_expires_at, attempt_count, next_attempt_at, external_job_id,
-- error_code, error_message.
CREATE TABLE cash.drawer_jobs (
    id                     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    cash_session_id        bigint NOT NULL REFERENCES sales.cash_sessions (id),
    business_document_id   bigint REFERENCES core.business_documents (id),
    -- Task requirement: "Each drawer operation has its own idempotency
    -- key" / "drawer retry must not create duplicate physical pulses". One
    -- unique key per triggering event (e.g. `cash_sale:<document_id>`) makes
    -- a duplicate enqueue attempt a no-op instead of a second physical
    -- pulse.
    idempotency_key        text NOT NULL,
    status                 text NOT NULL DEFAULT 'PENDING',
    claimed_by             text,
    lease_expires_at       timestamptz,
    attempt_count          integer NOT NULL DEFAULT 0,
    next_attempt_at        timestamptz NOT NULL DEFAULT now(),
    external_job_id        text,
    error_code             text,
    error_message          text,
    created_at             timestamptz NOT NULL DEFAULT now(),
    updated_at             timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT drawer_jobs_status_valid
        CHECK (status IN ('PENDING', 'CLAIMED', 'PULSE_SUBMITTED', 'PULSE_FAILED', 'CANCELLED')),
    CONSTRAINT drawer_jobs_idempotency_key_unique UNIQUE (idempotency_key),
    CONSTRAINT drawer_jobs_attempt_count_non_negative CHECK (attempt_count >= 0)
);

CREATE TRIGGER drawer_jobs_set_updated_at
    BEFORE UPDATE ON cash.drawer_jobs
    FOR EACH ROW
    EXECUTE FUNCTION core.set_updated_at();

-- Enqueues (or, on a duplicate idempotency key, no-ops and returns the
-- existing job) exactly one drawer pulse job. Intended to be called from
-- *inside* the cash-sale posting transaction, matching architecture's "jobs
-- inserted inside the posting transaction" requirement.
CREATE FUNCTION cash.enqueue_drawer_job(
    p_cash_session_id bigint,
    p_business_document_id bigint,
    p_idempotency_key text
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_job_id bigint;
BEGIN
    INSERT INTO cash.drawer_jobs (cash_session_id, business_document_id, idempotency_key)
    VALUES (p_cash_session_id, p_business_document_id, p_idempotency_key)
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id INTO v_job_id;

    IF v_job_id IS NULL THEN
        SELECT id INTO v_job_id FROM cash.drawer_jobs WHERE idempotency_key = p_idempotency_key;
    END IF;

    RETURN v_job_id;
END;
$$;

-- Claims one eligible drawer job (PENDING, or CLAIMED with an expired
-- lease) using `FOR UPDATE SKIP LOCKED`, matching architecture section 5's
-- worker-claim pattern exactly, so concurrent workers never double-claim
-- and expired leases are safely reclaimed.
CREATE FUNCTION cash.claim_next_drawer_job(
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
    SELECT id INTO v_job_id
        FROM cash.drawer_jobs
        WHERE (status = 'PENDING' AND next_attempt_at <= now())
           OR (status = 'CLAIMED' AND lease_expires_at <= now())
        ORDER BY next_attempt_at
        FOR UPDATE SKIP LOCKED
        LIMIT 1;

    IF v_job_id IS NULL THEN
        RETURN NULL;
    END IF;

    UPDATE cash.drawer_jobs
        SET status = 'CLAIMED',
            claimed_by = p_claimed_by,
            lease_expires_at = now() + make_interval(secs => p_lease_seconds),
            attempt_count = attempt_count + 1
        WHERE id = v_job_id;

    RETURN v_job_id;
END;
$$;

-- Marks a claimed drawer job's outcome. `p_success` submits the pulse
-- (PULSE_SUBMITTED, terminal — architecture: "Reprint never creates a
-- drawer pulse", so this job is never re-armed once it reaches a terminal
-- state). Failure moves to PULSE_FAILED with the error recorded; the caller
-- decides separately whether to enqueue a fresh retry (a new job would need
-- its own idempotency key, since this one is now terminal).
CREATE FUNCTION cash.complete_drawer_job(
    p_job_id bigint,
    p_success boolean,
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
    UPDATE cash.drawer_jobs
        SET status = CASE WHEN p_success THEN 'PULSE_SUBMITTED' ELSE 'PULSE_FAILED' END,
            external_job_id = p_external_job_id,
            error_code = p_error_code,
            error_message = p_error_message
        WHERE id = p_job_id;
END;
$$;


REVOKE ALL ON cash.movements FROM PUBLIC;
REVOKE ALL ON cash.drawer_jobs FROM PUBLIC;
REVOKE ALL ON FUNCTION cash.forbid_movement_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION cash.enqueue_drawer_job(bigint, bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION cash.claim_next_drawer_job(text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION cash.complete_drawer_job(bigint, boolean, text, text, text) FROM PUBLIC;

-- Task requirement: "stockiha_runtime must not directly write protected: ...
-- cash movements ... queue records". `enqueue_drawer_job` is called only
-- from inside the cash-sale posting function's own transaction; the print
-- worker process calls `claim_next_drawer_job`/`complete_drawer_job`
-- directly as `stockiha_runtime` (it is a background worker, not a posting
-- function, and has no other privileged role to run as).
GRANT SELECT ON cash.movements TO stockiha_runtime;
GRANT SELECT ON cash.drawer_jobs TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION cash.claim_next_drawer_job(text, integer) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION cash.complete_drawer_job(bigint, boolean, text, text, text) TO stockiha_runtime;

RESET ROLE;
