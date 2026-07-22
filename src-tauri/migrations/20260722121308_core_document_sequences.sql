-- S1-001: concurrency-safe document numbering foundation
-- (final-architecture.md section 3.D-bis).
--
-- Design: one row per (document_type, fiscal_year). Claiming the next number
-- is a single `INSERT ... ON CONFLICT (document_type, fiscal_year) DO UPDATE
-- SET current_value = current_value + 1` statement — atomic under PostgreSQL
-- MVCC without an explicit `SELECT ... FOR UPDATE`, and free of the
-- MAX(number)+1 race condition the task explicitly forbids. Numbers are
-- claimed and returned by a single SECURITY DEFINER function so a rolled-back
-- caller never leaves a gap without a value already having been consumed
-- atomically in the same statement.
--
-- `document_type` is a closed set scoped to what this slice actually
-- produces (cash sales, journal entries). Extending it to later slices is a
-- future migration, not a looser CHECK now.
SET ROLE stockiha_owner;

CREATE TABLE core.document_sequences (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    document_type  text NOT NULL,
    fiscal_year    integer NOT NULL,
    current_value  bigint NOT NULL DEFAULT 0,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT document_sequences_scope_unique UNIQUE (document_type, fiscal_year),
    CONSTRAINT document_sequences_type_valid
        CHECK (document_type IN ('CASH_SALE', 'JOURNAL_ENTRY')),
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
-- (document_type, fiscal_year) scope. Intended to be called from *inside* a
-- future posting function's transaction (e.g. `sales.confirm_cash_sale`) —
-- this migration only proves out the numbering primitive itself, not the
-- posting workflow. `SECURITY DEFINER` with a fixed `search_path` follows the
-- exact pattern established by the S0-006 proof (`s0_006_proof.resolve_session`).
CREATE FUNCTION core.claim_next_document_number(
    p_document_type text,
    p_fiscal_year integer
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, core
AS $$
DECLARE
    v_next bigint;
BEGIN
    INSERT INTO document_sequences (document_type, fiscal_year, current_value)
    VALUES (p_document_type, p_fiscal_year, 1)
    ON CONFLICT (document_type, fiscal_year)
        DO UPDATE SET current_value = document_sequences.current_value + 1,
                       updated_at = now()
    RETURNING current_value INTO v_next;

    RETURN v_next;
END;
$$;

REVOKE ALL ON core.document_sequences FROM PUBLIC;
REVOKE ALL ON FUNCTION core.claim_next_document_number(text, integer) FROM PUBLIC;

-- The sequence table itself is never written to directly by the runtime role
-- (task requirement: "stockiha_runtime must not directly insert, update, or
-- delete ... document sequences"). Only the claim function may write, and it
-- runs as `stockiha_owner` regardless of caller.
GRANT SELECT ON core.document_sequences TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION core.claim_next_document_number(text, integer) TO stockiha_runtime;

RESET ROLE;
