-- S1-001 (corrected): double-entry journal entries and lines
-- (final-architecture.md section 3.D).
--
-- `finance.journal_entries` is now a thin subtype of
-- `core.business_documents`: its primary key IS the parent document's id
-- (`document_id`), and it does NOT duplicate
-- document_type/status/document_date/fiscal_period_id/document_number/
-- posted_at — those live exclusively on the shared header.
SET ROLE stockiha_owner;

CREATE TABLE finance.journal_entries (
    document_id  bigint PRIMARY KEY REFERENCES core.business_documents (id),
    description  text,
    -- Generic backreference to whatever produced this entry (e.g. a future
    -- sales.cash_sales row); deliberately not a foreign key for the same
    -- reason as inventory.movements.reference_type/id.
    source_type  text,
    source_id    bigint,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE finance.journal_lines (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    document_id   bigint NOT NULL REFERENCES finance.journal_entries (document_id) ON DELETE CASCADE,
    line_number   integer NOT NULL,
    -- No chart-of-accounts table exists yet in this slice; account_code is a
    -- plain fixed-format text code until a later slice introduces a real
    -- accounts table this can reference.
    account_code  text NOT NULL,
    debit         numeric(14, 2) NOT NULL DEFAULT 0,
    credit        numeric(14, 2) NOT NULL DEFAULT 0,
    description   text,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT journal_lines_line_number_unique UNIQUE (document_id, line_number),
    CONSTRAINT journal_lines_line_number_positive CHECK (line_number > 0),
    CONSTRAINT journal_lines_account_code_not_blank CHECK (btrim(account_code) <> ''),
    CONSTRAINT journal_lines_debit_non_negative CHECK (debit >= 0),
    CONSTRAINT journal_lines_credit_non_negative CHECK (credit >= 0),
    -- Task requirement, verbatim: "a line cannot have both a positive debit
    -- and positive credit" and "a line cannot have neither debit nor
    -- credit" -- i.e. exactly one side is populated.
    CONSTRAINT journal_lines_exactly_one_side
        CHECK ((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0))
);

CREATE TRIGGER journal_entries_set_updated_at
    BEFORE UPDATE ON finance.journal_entries
    FOR EACH ROW
    EXECUTE FUNCTION core.set_updated_at();

CREATE TRIGGER journal_lines_set_updated_at
    BEFORE UPDATE ON finance.journal_lines
    FOR EACH ROW
    EXECUTE FUNCTION core.set_updated_at();

-- Immutability: once the parent business document is POSTED or REVERSED,
-- neither the journal-entry subtype row nor its lines can be updated or
-- deleted. Unlike `core.business_documents` itself, there is no controlled
-- exception here — a reversal is a brand-new document + new subtype row
-- (with its own balanced lines), never a mutation of the original entry's
-- lines. This is also exactly what keeps the "impossible POSTED ->
-- REVERSED transition" out of this table: that transition only ever
-- happens on the header, never here.
CREATE FUNCTION finance.forbid_posted_journal_entry_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_status text;
BEGIN
    SELECT status INTO v_status
        FROM core.business_documents
        WHERE id = COALESCE(NEW.document_id, OLD.document_id);
    IF v_status IN ('POSTED', 'REVERSED') THEN
        RAISE EXCEPTION 'journal entries of a posted or reversed business document are immutable'
            USING ERRCODE = '0A000';
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER journal_entries_forbid_posted_update
    BEFORE UPDATE ON finance.journal_entries
    FOR EACH ROW
    EXECUTE FUNCTION finance.forbid_posted_journal_entry_mutation();

CREATE TRIGGER journal_entries_forbid_posted_delete
    BEFORE DELETE ON finance.journal_entries
    FOR EACH ROW
    EXECUTE FUNCTION finance.forbid_posted_journal_entry_mutation();

CREATE FUNCTION finance.forbid_posted_journal_line_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_status text;
BEGIN
    -- `journal_lines.document_id` is transitively the same value as
    -- `core.business_documents.id` (it references
    -- `journal_entries.document_id`, which itself references
    -- `business_documents.id`).
    SELECT status INTO v_status
        FROM core.business_documents
        WHERE id = COALESCE(NEW.document_id, OLD.document_id);
    IF v_status IN ('POSTED', 'REVERSED') THEN
        RAISE EXCEPTION 'lines of a posted or reversed journal entry are immutable'
            USING ERRCODE = '0A000';
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER journal_lines_forbid_posted_update
    BEFORE UPDATE ON finance.journal_lines
    FOR EACH ROW
    EXECUTE FUNCTION finance.forbid_posted_journal_line_mutation();

CREATE TRIGGER journal_lines_forbid_posted_delete
    BEFORE DELETE ON finance.journal_lines
    FOR EACH ROW
    EXECUTE FUNCTION finance.forbid_posted_journal_line_mutation();

-- Cross-row validation (final-architecture.md section 2, rule 5, and
-- section 3.D: "At least two lines" / "Non-negative debit and credit
-- values" / "Exactly one side ... populated per line" / entry balances).
-- PostgreSQL has no native deferrable CHECK across rows, so this is a
-- DEFERRABLE INITIALLY DEFERRED CONSTRAINT TRIGGER — the "safe deferred
-- constraint" the task allows in lieu of the full posting function. It only
-- runs its checks once the entry is POSTED/REVERSED by commit time — a
-- DRAFT entry may be transiently short of lines or unbalanced while being
-- assembled across several statements, which interactive drafting requires.
--
-- Correction from the first pass: this now also rejects fewer than two
-- lines and re-checks exactly-one-side-positive in aggregate (redundant
-- with `journal_lines_exactly_one_side`, but defense-in-depth exactly as
-- specified), not just the debit/credit balance.
CREATE FUNCTION finance.check_journal_entry_balances()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_document_id bigint;
    v_status text;
    v_line_count bigint;
    v_bad_line_count bigint;
    v_total_debit numeric(14, 2);
    v_total_credit numeric(14, 2);
BEGIN
    v_document_id := COALESCE(NEW.document_id, OLD.document_id);

    SELECT status INTO v_status FROM core.business_documents WHERE id = v_document_id;

    -- The entry may have been deleted in the same transaction (cascade); if
    -- so there is nothing left to balance.
    IF v_status IS NULL THEN
        RETURN NULL;
    END IF;

    IF v_status NOT IN ('POSTED', 'REVERSED') THEN
        RETURN NULL;
    END IF;

    SELECT
        count(*),
        coalesce(sum(debit), 0),
        coalesce(sum(credit), 0),
        count(*) FILTER (
            WHERE NOT ((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0))
        )
        INTO v_line_count, v_total_debit, v_total_credit, v_bad_line_count
        FROM finance.journal_lines
        WHERE document_id = v_document_id;

    IF v_line_count < 2 THEN
        RAISE EXCEPTION
            'journal entry % cannot be posted with fewer than two lines (has %)',
            v_document_id, v_line_count
            USING ERRCODE = '0A000';
    END IF;

    IF v_bad_line_count > 0 THEN
        RAISE EXCEPTION
            'journal entry % has % line(s) violating exactly-one-side-positive',
            v_document_id, v_bad_line_count
            USING ERRCODE = '0A000';
    END IF;

    IF v_total_debit <> v_total_credit THEN
        RAISE EXCEPTION
            'journal entry % does not balance: total debit % <> total credit %',
            v_document_id, v_total_debit, v_total_credit
            USING ERRCODE = '0A000';
    END IF;

    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER journal_lines_check_balance
    AFTER INSERT OR UPDATE OR DELETE ON finance.journal_lines
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION finance.check_journal_entry_balances();

REVOKE ALL ON finance.journal_entries FROM PUBLIC;
REVOKE ALL ON finance.journal_lines FROM PUBLIC;
REVOKE ALL ON FUNCTION finance.forbid_posted_journal_entry_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION finance.forbid_posted_journal_line_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION finance.check_journal_entry_balances() FROM PUBLIC;

-- Task requirement: "stockiha_runtime must not directly insert, update, or
-- delete: ... journal entries and lines". Read-only until a future atomic
-- posting function is the sole writer.
GRANT SELECT ON finance.journal_entries TO stockiha_runtime;
GRANT SELECT ON finance.journal_lines TO stockiha_runtime;

RESET ROLE;
