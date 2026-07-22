-- Slice 1 MVP batch: `sales.cash_sessions` — the minimal open/close cash
-- register session required for the Golden Transaction Chain
-- (final-architecture.md section 4, Slice 1: "Minimal open cash session
-- required for the Golden Chain (no blind counts or variance approval
-- yet)"). Full session management (blind counts, denomination entries,
-- suspension, handover) stays Slice 4 work per architecture section 3.E.
SET ROLE stockiha_owner;

CREATE TABLE sales.cash_sessions (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    warehouse_id      bigint NOT NULL REFERENCES inventory.warehouses (id),
    workstation_id    text NOT NULL,
    opened_by_user_id bigint NOT NULL REFERENCES iam.users (id),
    closed_by_user_id bigint REFERENCES iam.users (id),
    status            text NOT NULL DEFAULT 'OPEN',
    opening_float     numeric(14, 2) NOT NULL DEFAULT 0,
    expected_amount   numeric(14, 2),
    counted_amount    numeric(14, 2),
    variance_amount   numeric(14, 2),
    opened_at         timestamptz NOT NULL DEFAULT now(),
    closed_at         timestamptz,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT cash_sessions_status_valid CHECK (status IN ('OPEN', 'CLOSED')),
    CONSTRAINT cash_sessions_opening_float_non_negative CHECK (opening_float >= 0),
    CONSTRAINT cash_sessions_workstation_not_blank CHECK (btrim(workstation_id) <> ''),
    -- Closing must preserve immutable opening/expected/counted/variance
    -- snapshots: those three become required and fixed the moment the
    -- session closes, mirroring the same "number set iff posted" pattern
    -- used by `core.business_documents`.
    CONSTRAINT cash_sessions_close_snapshot_set_iff_closed
        CHECK (
            (status = 'OPEN'
                AND closed_by_user_id IS NULL
                AND expected_amount IS NULL
                AND counted_amount IS NULL
                AND variance_amount IS NULL
                AND closed_at IS NULL)
            OR (status = 'CLOSED'
                AND closed_by_user_id IS NOT NULL
                AND expected_amount IS NOT NULL
                AND counted_amount IS NOT NULL
                AND variance_amount IS NOT NULL
                AND closed_at IS NOT NULL)
        )
);

-- Task requirement: "Prevent multiple active sessions for the same
-- register/workstation". A partial unique index is the standard, safe
-- PostgreSQL mechanism for "at most one active row" — cheaper and simpler
-- than a trigger, and enforced by the same unique-index machinery already
-- relied on elsewhere in this schema.
CREATE UNIQUE INDEX cash_sessions_one_open_per_workstation
    ON sales.cash_sessions (workstation_id)
    WHERE status = 'OPEN';

CREATE TRIGGER cash_sessions_set_updated_at
    BEFORE UPDATE ON sales.cash_sessions
    FOR EACH ROW
    EXECUTE FUNCTION core.set_updated_at();

-- Immutability: once CLOSED, a cash session (and its preserved snapshots)
-- can never be updated or deleted.
CREATE FUNCTION sales.forbid_closed_cash_session_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.status = 'CLOSED' THEN
            RAISE EXCEPTION 'closed cash sessions cannot be deleted' USING ERRCODE = '0A000';
        END IF;
        RETURN OLD;
    END IF;

    IF OLD.status = 'CLOSED' THEN
        RAISE EXCEPTION 'closed cash sessions are immutable' USING ERRCODE = '0A000';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER cash_sessions_forbid_closed_update
    BEFORE UPDATE ON sales.cash_sessions
    FOR EACH ROW
    EXECUTE FUNCTION sales.forbid_closed_cash_session_mutation();

CREATE TRIGGER cash_sessions_forbid_closed_delete
    BEFORE DELETE ON sales.cash_sessions
    FOR EACH ROW
    EXECUTE FUNCTION sales.forbid_closed_cash_session_mutation();


REVOKE ALL ON sales.cash_sessions FROM PUBLIC;
REVOKE ALL ON FUNCTION sales.forbid_closed_cash_session_mutation() FROM PUBLIC;

-- Task requirement: writes to cash sessions go exclusively through the
-- open/inspect/close SECURITY DEFINER functions added later in this batch —
-- `stockiha_runtime` gets SELECT only here.
GRANT SELECT ON sales.cash_sessions TO stockiha_runtime;

RESET ROLE;
