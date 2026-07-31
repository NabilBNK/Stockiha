-- S4-002 upgrade-path compatibility for pre-existing development databases.
--
-- Some legitimate pre-S4-002 databases carry the Slice-1 partial unique
-- workstation index under the historical name
-- `cash_sessions_one_active_per_workstation`, while the canonical migration
-- chain currently names the same invariant
-- `cash_sessions_one_open_per_workstation`.
--
-- The S4-002 lifecycle migration intentionally replaces that OPEN-only
-- invariant with a stronger one covering every non-CLOSED lifecycle state.
-- Normalize the historical name first so the following migration can perform
-- one deterministic upgrade without weakening or silently recreating missing
-- preconditions.
SET ROLE stockiha_owner;

DO $$
DECLARE
    v_open_index regclass := to_regclass('sales.cash_sessions_one_open_per_workstation');
    v_active_index regclass := to_regclass('sales.cash_sessions_one_active_per_workstation');
BEGIN
    IF v_open_index IS NOT NULL AND v_active_index IS NOT NULL THEN
        RAISE EXCEPTION
            'ambiguous cash-session workstation invariant: both canonical and historical indexes exist';
    ELSIF v_open_index IS NULL AND v_active_index IS NOT NULL THEN
        ALTER INDEX sales.cash_sessions_one_active_per_workstation
            RENAME TO cash_sessions_one_open_per_workstation;
    ELSIF v_open_index IS NULL AND v_active_index IS NULL THEN
        RAISE EXCEPTION
            'expected pre-S4-002 cash-session workstation index is missing';
    END IF;
END;
$$;

RESET ROLE;
