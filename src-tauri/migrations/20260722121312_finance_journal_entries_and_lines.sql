-- S1-001: double-entry journal entries and lines
-- (final-architecture.md section 3.D).
SET ROLE stockiha_owner;

-- States are the fixed vocabulary from architecture section 3.D: DRAFT,
-- POSTED, REVERSED. The *workflow* that drives DRAFT -> POSTED (validate >= 2
-- lines, verify total debit = total credit, then post) and POSTED ->
-- REVERSED (a linked reversal entry) both belong to a future atomic posting
-- function — out of scope for S1-001. REVERSED is still included in the
-- CHECK now because it is architecture's fixed state set, avoiding a
-- constraint-widening migration later purely to add a state name.
CREATE TABLE finance.journal_entries (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    fiscal_period_id  bigint NOT NULL REFERENCES core.fiscal_periods (id),
    document_number   text,
    status            text NOT NULL DEFAULT 'DRAFT',
    entry_date        date NOT NULL,
    description       text,
    -- Generic backreference to whatever produced this entry (e.g. a future
    -- sales.cash_sales row); deliberately not a foreign key for the same
    -- reason as inventory.stock_ledger.reference_type/id.
    source_type       text,
    source_id         bigint,
    posted_at         timestamptz,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT journal_entries_status_valid
        CHECK (status IN ('DRAFT', 'POSTED', 'REVERSED')),
    CONSTRAINT journal_entries_document_number_unique UNIQUE (document_number),
    CONSTRAINT journal_entries_document_number_set_iff_posted
        CHECK (
            (status = 'DRAFT' AND document_number IS NULL AND posted_at IS NULL)
            OR (status IN ('POSTED', 'REVERSED') AND document_number IS NOT NULL AND posted_at IS NOT NULL)
        )
);

CREATE TABLE finance.journal_lines (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    journal_entry_id  bigint NOT NULL REFERENCES finance.journal_entries (id) ON DELETE CASCADE,
    line_number       integer NOT NULL,
    -- No chart-of-accounts table exists yet in this slice; account_code is a
    -- plain fixed-format text code until a later slice introduces a real
    -- accounts table this can reference.
    account_code      text NOT NULL,
    debit             numeric(14, 2) NOT NULL DEFAULT 0,
    credit            numeric(14, 2) NOT NULL DEFAULT 0,
    description       text,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT journal_lines_line_number_unique UNIQUE (journal_entry_id, line_number),
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

-- Immutability: once a journal entry is POSTED (or REVERSED), neither the
-- header nor its lines can be updated or deleted. DRAFT entries stay freely
-- editable while being built line by line.
CREATE FUNCTION finance.forbid_posted_journal_entry_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.status IN ('POSTED', 'REVERSED') THEN
        RAISE EXCEPTION 'posted journal entries are immutable' USING ERRCODE = '0A000';
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
    SELECT status INTO v_status FROM finance.journal_entries WHERE id = OLD.journal_entry_id;
    IF v_status IN ('POSTED', 'REVERSED') THEN
        RAISE EXCEPTION 'lines of a posted journal entry are immutable'
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

-- Cross-row balance validation (final-architecture.md section 2, rule 5:
-- "A deferred database constraint validates that the entry balances (Debits
-- = Credits) prior to commit"). PostgreSQL has no native deferrable CHECK
-- across rows, so this is implemented as a DEFERRABLE INITIALLY DEFERRED
-- CONSTRAINT TRIGGER, which is the standard, safe mechanism for this exact
-- rule and is explicitly allowed by the task ("unless the architecture
-- specifies a safe deferred constraint"). It only enforces balance for
-- entries that are POSTED/REVERSED by commit time — a DRAFT entry may be
-- transiently unbalanced while being assembled line by line across several
-- statements, which is required for interactive drafting to work at all.
-- The full posting *workflow* (validate >= 2 lines, flip DRAFT -> POSTED,
-- allocate a document number) remains a future atomic posting function.
CREATE FUNCTION finance.check_journal_entry_balances()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_entry_id bigint;
    v_status text;
    v_total_debit numeric(14, 2);
    v_total_credit numeric(14, 2);
BEGIN
    v_entry_id := COALESCE(NEW.journal_entry_id, OLD.journal_entry_id);

    SELECT status INTO v_status FROM finance.journal_entries WHERE id = v_entry_id;

    -- The entry may have been deleted in the same transaction (cascade); if
    -- so there is nothing left to balance.
    IF v_status IS NULL THEN
        RETURN NULL;
    END IF;

    IF v_status NOT IN ('POSTED', 'REVERSED') THEN
        RETURN NULL;
    END IF;

    SELECT coalesce(sum(debit), 0), coalesce(sum(credit), 0)
        INTO v_total_debit, v_total_credit
        FROM finance.journal_lines
        WHERE journal_entry_id = v_entry_id;

    IF v_total_debit <> v_total_credit THEN
        RAISE EXCEPTION
            'journal entry % does not balance: total debit % <> total credit %',
            v_entry_id, v_total_debit, v_total_credit
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
