-- Slice 1 MVP batch: `core.request_idempotency`
-- (final-architecture.md section 2.4).
--
-- Scoping note: architecture's own column list includes `company_id`, but
-- no company/tenant table exists anywhere in this repository yet (Slice 1
-- is single-tenant) — adding a `company_id` column with nothing real to
-- reference would be exactly the kind of placeholder column the task
-- forbids. It is intentionally omitted here; a future multi-company slice
-- adds it as a real, FK-backed column, not a stub.
SET ROLE stockiha_owner;

CREATE TABLE core.request_idempotency (
    operation_key           text NOT NULL,
    request_id              uuid NOT NULL,
    canonical_payload_hash  bytea NOT NULL,
    result_document_id      bigint REFERENCES core.business_documents (id),
    created_at              timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (operation_key, request_id),
    CONSTRAINT request_idempotency_operation_key_not_blank CHECK (btrim(operation_key) <> '')
);

-- Reserves a (operation_key, request_id) pair for a posting attempt.
--
-- Algorithm (matches final-architecture.md section 2.4 exactly):
-- 1. Attempt to insert the idempotency row. If it succeeds, this is a fresh
--    request — return NULL and let the caller proceed to post.
-- 2. If it already exists (unique violation), lock and read it.
-- 3. If the payload hash differs, reject as an idempotency conflict.
-- 4. If the payload hash matches and a result already exists, return the
--    cached result_document_id (the caller must NOT post again).
-- 5. If the payload hash matches but no result exists yet, another
--    transaction currently holds the row lock while actively posting (it
--    will block here until that transaction commits or rolls back) —
--    reaching this branch after acquiring the lock without a concurrent
--    holder indicates a caller bug, not a legitimate retry, because the
--    reservation insert and the result update both live inside the same
--    posting transaction: a rolled-back poster's reservation row rolls back
--    with it and simply disappears, so a retry after a genuine failure
--    always sees case 1 again, never a lingering NULL result.
--
-- `SECURITY DEFINER` with a fixed, schema-qualified `search_path`, called
-- from inside a posting function's own transaction (never granted to
-- `stockiha_runtime` directly — see the grants at the end of this file).
CREATE FUNCTION core.reserve_idempotent_request(
    p_operation_key text,
    p_request_id uuid,
    p_payload_hash bytea
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_existing_hash bytea;
    v_existing_result bigint;
BEGIN
    BEGIN
        INSERT INTO core.request_idempotency (operation_key, request_id, canonical_payload_hash)
        VALUES (p_operation_key, p_request_id, p_payload_hash);
        RETURN NULL;
    EXCEPTION WHEN unique_violation THEN
        NULL;
    END;

    SELECT canonical_payload_hash, result_document_id
        INTO v_existing_hash, v_existing_result
        FROM core.request_idempotency
        WHERE operation_key = p_operation_key AND request_id = p_request_id
        FOR UPDATE;

    IF v_existing_hash <> p_payload_hash THEN
        RAISE EXCEPTION 'idempotency conflict: request % already used with a different payload', p_request_id
            USING ERRCODE = '23505';
    END IF;

    IF v_existing_result IS NULL THEN
        RAISE EXCEPTION 'idempotent request % is still being processed', p_request_id
            USING ERRCODE = '55000';
    END IF;

    RETURN v_existing_result;
END;
$$;

-- Records the final result of a fresh (non-duplicate) posting attempt.
-- Called once, at the end of the same posting transaction that reserved the
-- request, immediately before that transaction commits.
CREATE FUNCTION core.record_idempotent_result(
    p_operation_key text,
    p_request_id uuid,
    p_result_document_id bigint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    UPDATE core.request_idempotency
        SET result_document_id = p_result_document_id
        WHERE operation_key = p_operation_key AND request_id = p_request_id;
END;
$$;


REVOKE ALL ON core.request_idempotency FROM PUBLIC;
REVOKE ALL ON FUNCTION core.reserve_idempotent_request(text, uuid, bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION core.record_idempotent_result(text, uuid, bigint) FROM PUBLIC;

-- Task requirement: "stockiha_runtime must not directly write protected: ...
-- idempotency records". These two functions are called only from *inside* a
-- future posting function's own transaction (itself SECURITY DEFINER,
-- owned by stockiha_owner) — never directly by stockiha_runtime.
GRANT SELECT ON core.request_idempotency TO stockiha_runtime;

RESET ROLE;
