-- WS-B-1 Gate 1: add finance.journal_lines.account_id as a nullable,
-- FK-constrained bridge column alongside the existing account_code text.
--
-- This migration was attempted once already and correctly stopped: the
-- existing finance.forbid_posted_journal_line_mutation() trigger rejects ANY
-- UPDATE on a row belonging to a POSTED/REVERSED document, including the
-- first-ever backfill of a brand-new column. That is correct behavior, not a
-- bug — it is a wall the backfill must be let through, once, narrowly, with
-- the wall fully restored by the end of this same migration.
--
-- Sequence (approved): STEP A relaxes the trigger to permit exactly one
-- shape of UPDATE (setting account_id from NULL for the first time, with
-- every other column unchanged); STEP B adds the column and runs the
-- backfill inside that relaxed window; STEP C restores the trigger to be
-- functionally identical to the original, with zero permanent account_id
-- carve-out, then adds the FK and index. Nothing outside this single
-- transaction ever observes a relaxed trigger.
SET ROLE stockiha_owner;

-- ============================================================
-- STEP A — relax, narrowly and explicitly
-- ============================================================
-- The original body blocks the entire row from changing (it never inspected
-- individual columns), so every column journal_lines has is protected today:
-- id, document_id, line_number, account_code, debit, credit, description,
-- created_at, updated_at. The exception below checks all nine explicitly
-- (updated_at included even though core.set_updated_at's own trigger only
-- runs AFTER this one in per-statement alphabetical trigger order —
-- "journal_lines_forbid_posted_update" sorts before "journal_lines_set_
-- updated_at" — so NEW.updated_at is still the pre-update value at the point
-- this function evaluates it).
CREATE OR REPLACE FUNCTION finance.forbid_posted_journal_line_mutation()
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
        IF TG_OP = 'UPDATE'
           AND OLD.account_id IS NULL AND NEW.account_id IS NOT NULL
           AND NEW.id            IS NOT DISTINCT FROM OLD.id
           AND NEW.document_id   IS NOT DISTINCT FROM OLD.document_id
           AND NEW.line_number   IS NOT DISTINCT FROM OLD.line_number
           AND NEW.account_code  IS NOT DISTINCT FROM OLD.account_code
           AND NEW.debit         IS NOT DISTINCT FROM OLD.debit
           AND NEW.credit        IS NOT DISTINCT FROM OLD.credit
           AND NEW.description   IS NOT DISTINCT FROM OLD.description
           AND NEW.created_at    IS NOT DISTINCT FROM OLD.created_at
           AND NEW.updated_at    IS NOT DISTINCT FROM OLD.updated_at
        THEN
            RETURN NEW;
        END IF;
        RAISE EXCEPTION 'lines of a posted or reversed journal entry are immutable'
            USING ERRCODE = '0A000';
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$;

-- ============================================================
-- STEP B — add the column and backfill, inside the relaxed window
-- ============================================================
ALTER TABLE finance.journal_lines
    ADD COLUMN account_id bigint;

UPDATE finance.journal_lines jl
SET account_id = a.id
FROM finance.accounts a
WHERE a.legacy_code = jl.account_code
  AND jl.account_id IS NULL;

DO $$
DECLARE
    v_null_count bigint;
BEGIN
    SELECT count(*) INTO v_null_count FROM finance.journal_lines WHERE account_id IS NULL;
    IF v_null_count <> 0 THEN
        RAISE EXCEPTION 'GATE1_BACKFILL_INCOMPLETE: % journal_lines row(s) still have a NULL account_id after backfill', v_null_count
            USING ERRCODE = '0A000';
    END IF;
END;
$$;

-- Force the DEFERRABLE INITIALLY DEFERRED balance-check trigger queued by
-- Step B's backfill UPDATE to fire now, inside this transaction, rather than
-- at COMMIT. PostgreSQL refuses ALTER TABLE on a table with pending deferred
-- trigger events, and Step C needs to ALTER TABLE to add the FK. This does
-- not change what the balance trigger checks or when it would otherwise have
-- fired relative to this transaction's commit — it only makes that already-
-- scheduled check happen a few statements earlier, still before commit.
SET CONSTRAINTS ALL IMMEDIATE;

-- ============================================================
-- STEP C — restore full immutability, permanently, then constrain
-- ============================================================
-- Byte-for-byte the same body finance.forbid_posted_journal_line_mutation()
-- had before this migration ran. No account_id exception survives past here.
CREATE OR REPLACE FUNCTION finance.forbid_posted_journal_line_mutation()
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
        RAISE EXCEPTION 'lines of a posted or reversed journal entry are immutable'
            USING ERRCODE = '0A000';
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$;

ALTER TABLE finance.journal_lines
    ADD CONSTRAINT journal_lines_account_id_fkey
    FOREIGN KEY (account_id) REFERENCES finance.accounts(id);

CREATE INDEX journal_lines_account_id_idx ON finance.journal_lines (account_id);

RESET ROLE;
