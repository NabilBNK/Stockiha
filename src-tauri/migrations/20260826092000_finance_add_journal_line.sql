-- WS-B-1 Gate 3a (part 1): the account_id-aware journal-line helper that
-- procurement.confirm_supplier_invoice and inventory.confirm_supplier_return
-- have called since they were written, but which was never created --
-- confirmed absent from pg_proc under any signature (baseline audit, and this
-- task's own missing-function sweep). Resolves a role to its legacy code via
-- finance.require_account_role(), then to the internal id via
-- finance.resolve_account_id(), and writes both columns in one INSERT -- the
-- same dual-write discipline as every other conversion in this task.
SET ROLE stockiha_owner;

CREATE OR REPLACE FUNCTION finance.add_journal_line(
    p_document_id bigint,
    p_line_number integer,
    p_role finance.account_role_code,
    p_debit numeric,
    p_credit numeric,
    p_description text
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    v_legacy_code text;
    v_account_id bigint;
BEGIN
    v_legacy_code := finance.require_account_role(p_role);
    v_account_id := finance.resolve_account_id(v_legacy_code);

    INSERT INTO finance.journal_lines (document_id, line_number, account_code, account_id, debit, credit, description)
    VALUES (p_document_id, p_line_number, v_legacy_code, v_account_id, p_debit, p_credit, p_description);
END;
$$;

REVOKE ALL ON FUNCTION finance.add_journal_line(bigint, integer, finance.account_role_code, numeric, numeric, text) FROM PUBLIC;

RESET ROLE;
