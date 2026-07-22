-- S1-001 (corrected): concurrency-safe document numbering
-- (final-architecture.md section 3.D-bis) and the shared business-document
-- header (`core.business_documents`) that owns every common document field
-- so subtype tables (`sales.cash_sales`, `finance.journal_entries`) never
-- duplicate that authority.
SET ROLE stockiha_owner;

-- One row per (document_type, fiscal_year). Claiming the next number is a
-- single `INSERT ... ON CONFLICT (document_type, fiscal_year) DO UPDATE SET
-- current_value = current_value + 1` statement — atomic under PostgreSQL
-- MVCC without an explicit `SELECT ... FOR UPDATE`, and free of the
-- MAX(number)+1 race condition the task explicitly forbids.
CREATE TABLE core.document_sequences (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    document_type  text NOT NULL,
    fiscal_year    integer NOT NULL,
    current_value  bigint NOT NULL DEFAULT 0,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT document_sequences_scope_unique UNIQUE (document_type, fiscal_year),
    CONSTRAINT document_sequences_type_valid
        CHECK (document_type IN ('CASH_SALE', 'JOURNAL_ENTRY', 'STOCK_RECEIPT')),
    CONSTRAINT document_sequences_fiscal_year_valid
        CHECK (fiscal_year BETWEEN 2000 AND 2999),
    CONSTRAINT document_sequences_current_value_non_negative
        CHECK (current_value >= 0)
);

CREATE TRIGGER document_sequences_set_updated_at
    BEFORE UPDATE ON core.document_sequences
    FOR EACH ROW
    EXECUTE FUNCTION core.set_updated_at();

-- Atomically claims and returns the next sequence value for a
-- (document_type, fiscal_year) scope. `SECURITY DEFINER` with a fixed,
-- schema-qualified `search_path` follows the exact pattern established by
-- the S0-006 proof (`s0_006_proof.resolve_session`). Every reference inside
-- the function body is schema-qualified (`core.document_sequences`, not a
-- bare `document_sequences`) so behavior cannot change if `search_path` is
-- ever altered outside this function's own `SET`.
--
-- Security correction: this helper is intentionally NOT reachable by
-- `stockiha_runtime`. Only `stockiha_owner` (implicitly, as the function's
-- owner) and `stockiha_migrator` (explicitly granted below, for bootstrap /
-- integration-test use) may call it directly. A future posting function
-- (itself `SECURITY DEFINER` and owned by `stockiha_owner`) calls this
-- helper from *inside its own transaction*, so it runs in the posting
-- function's already-elevated context — it never needs a direct grant to
-- `stockiha_runtime`. If that calling transaction rolls back, the claimed
-- number is rolled back with it (ordinary transactional semantics — no
-- special handling is needed for this property).
CREATE FUNCTION core.claim_next_document_number(
    p_document_type text,
    p_fiscal_year integer
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_next bigint;
BEGIN
    INSERT INTO core.document_sequences (document_type, fiscal_year, current_value)
    VALUES (p_document_type, p_fiscal_year, 1)
    ON CONFLICT (document_type, fiscal_year)
        DO UPDATE SET current_value = core.document_sequences.current_value + 1,
                       updated_at = now()
    RETURNING current_value INTO v_next;

    RETURN v_next;
END;
$$;

-- `core.business_documents` — the shared header every posted document in
-- this slice (cash sales, journal entries) is keyed off of via
-- `document_id` (see `sales.cash_sales` / `finance.journal_entries`
-- subtype tables in later migrations). Owns: identity, document type,
-- status, document date, fiscal period/year, the claimed sequence number,
-- the formatted document-number snapshot, posting timestamp, and the
-- reversal relationship.
--
-- Audit metadata scoping note: `iam.application_sessions` (the
-- session/actor resolver from final-architecture.md section 2.3) is not in
-- this task's schema-placement list and has no table in this repository
-- yet, so no `posted_by_user_id`/actor snapshot column is added here — that
-- would be a foreign key to a table that does not exist. `created_at` /
-- `updated_at` are the audit trail this slice can honestly provide; a
-- resolved-actor snapshot is future work once session infrastructure lands.
--
-- Reversal design: only `reverses_document_id` exists (set on the NEW
-- reversing document, pointing back at the original). There is no
-- `reversed_by_document_id` on the original: storing it there would require
-- updating the original's row after it is already POSTED, which is exactly
-- the "impossible POSTED -> REVERSED" trap the task calls out — except here
-- it would trip on a *different* column, not even the controlled status
-- transition. "What reversed this document" is a simple reverse lookup
-- (`SELECT * FROM core.business_documents WHERE reverses_document_id = ?`),
-- not a stored, mutation-requiring column.
CREATE TABLE core.business_documents (
    id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    document_type         text NOT NULL,
    status                text NOT NULL DEFAULT 'DRAFT',
    document_date         date NOT NULL,
    fiscal_period_id      bigint NOT NULL REFERENCES finance.fiscal_periods (id),
    fiscal_year           integer NOT NULL,
    sequence_number       bigint,
    document_number       text,
    posted_at             timestamptz,
    reverses_document_id  bigint REFERENCES core.business_documents (id),
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT business_documents_type_valid
        CHECK (document_type IN ('CASH_SALE', 'JOURNAL_ENTRY', 'STOCK_RECEIPT')),
    CONSTRAINT business_documents_status_valid
        CHECK (status IN ('DRAFT', 'POSTED', 'REVERSED')),
    CONSTRAINT business_documents_fiscal_year_valid
        CHECK (fiscal_year BETWEEN 2000 AND 2999),
    CONSTRAINT business_documents_number_set_iff_posted
        CHECK (
            (status = 'DRAFT'
                AND sequence_number IS NULL
                AND document_number IS NULL
                AND posted_at IS NULL)
            OR (status IN ('POSTED', 'REVERSED')
                AND sequence_number IS NOT NULL
                AND document_number IS NOT NULL
                AND posted_at IS NOT NULL)
        ),
    CONSTRAINT business_documents_document_number_unique UNIQUE (document_number),
    CONSTRAINT business_documents_sequence_scope_unique
        UNIQUE (document_type, fiscal_year, sequence_number),
    -- Task requirement, verbatim: "reversal cannot reference itself".
    CONSTRAINT business_documents_reversal_not_self
        CHECK (reverses_document_id IS NULL OR reverses_document_id <> id)
);

CREATE TRIGGER business_documents_set_updated_at
    BEFORE UPDATE ON core.business_documents
    FOR EACH ROW
    EXECUTE FUNCTION core.set_updated_at();

-- Immutability with exactly one controlled exception: a DRAFT document is
-- freely editable/deletable. A POSTED document may transition to REVERSED
-- (and *only* that transition, touching *only* `status`/`updated_at`) —
-- this is the mechanism that makes "reversals are new linked documents,
-- while the original becomes REVERSED" representable at all, instead of
-- being permanently blocked by blanket immutability (the "impossible
-- POSTED -> REVERSED transition" the task calls out). Every other mutation
-- of a POSTED or REVERSED row, and any delete of either, is rejected.
CREATE FUNCTION core.forbid_business_document_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.status IN ('POSTED', 'REVERSED') THEN
            RAISE EXCEPTION 'posted or reversed business documents cannot be deleted'
                USING ERRCODE = '0A000';
        END IF;
        RETURN OLD;
    END IF;

    -- TG_OP = 'UPDATE' from here on.
    IF OLD.status = 'DRAFT' THEN
        RETURN NEW;
    END IF;

    IF OLD.status = 'POSTED'
        AND NEW.status = 'REVERSED'
        AND NEW.document_type = OLD.document_type
        AND NEW.document_date = OLD.document_date
        AND NEW.fiscal_period_id = OLD.fiscal_period_id
        AND NEW.fiscal_year = OLD.fiscal_year
        AND NEW.sequence_number = OLD.sequence_number
        AND NEW.document_number = OLD.document_number
        AND NEW.posted_at = OLD.posted_at
        AND NEW.reverses_document_id IS NOT DISTINCT FROM OLD.reverses_document_id
        AND NEW.created_at = OLD.created_at
    THEN
        RETURN NEW;
    END IF;

    RAISE EXCEPTION
        'posted/reversed business documents are immutable except for the controlled POSTED -> REVERSED status transition'
        USING ERRCODE = '0A000';
END;
$$;

CREATE TRIGGER business_documents_forbid_mutation
    BEFORE UPDATE OR DELETE ON core.business_documents
    FOR EACH ROW
    EXECUTE FUNCTION core.forbid_business_document_mutation();

REVOKE ALL ON core.document_sequences FROM PUBLIC;
REVOKE ALL ON FUNCTION core.claim_next_document_number(text, integer) FROM PUBLIC;
REVOKE ALL ON core.business_documents FROM PUBLIC;
REVOKE ALL ON FUNCTION core.forbid_business_document_mutation() FROM PUBLIC;

-- The sequence table itself is never written to directly by the runtime
-- role. `stockiha_migrator` gets a direct EXECUTE grant on the claim helper
-- for bootstrap/integration-test use; `stockiha_owner` already has implicit
-- EXECUTE as the function's own owner. `stockiha_runtime` deliberately gets
-- neither — see the function's own doc comment above.
GRANT SELECT ON core.document_sequences TO stockiha_runtime;
-- `stockiha_migrator` does not INHERIT from `stockiha_owner` (S0-004 grants
-- it SET-only membership), so calling this function directly (outside a
-- `SET ROLE stockiha_owner` session) also needs its own schema USAGE grant
-- — EXECUTE on the function alone is not enough to resolve `core.*` at all.
GRANT USAGE ON SCHEMA core TO stockiha_migrator;
GRANT EXECUTE ON FUNCTION core.claim_next_document_number(text, integer) TO stockiha_migrator;

-- `stockiha_runtime` must not directly insert, update, or delete business
-- documents (no posting function exists yet in this slice) — SELECT only.
GRANT SELECT ON core.business_documents TO stockiha_runtime;

RESET ROLE;
