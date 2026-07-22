-- S1-001: fiscal periods (final-architecture.md section 3.D-bis) and a shared
-- `updated_at` maintenance trigger function reused by every table added in
-- this slice.
SET ROLE stockiha_owner;

-- Shared, schema-qualified utility: bumps `updated_at` to the transaction
-- timestamp on every UPDATE. Fixed body, no dynamic SQL, callable from any
-- schema via `core.set_updated_at()`.
CREATE FUNCTION core.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

-- Period states are the fixed vocabulary from architecture section 3.D-bis:
-- OPEN (normal posting allowed), SOFT_CLOSED (no normal posting; reopening is
-- an authorized, reasoned action), HARD_CLOSED (no reopening, no backdated
-- modification of any kind). The reopening/closing *workflow* itself is out
-- of scope for S1-001 — this table only lays the foundation a future posting
-- function will read to reject postings in closed periods.
CREATE TABLE core.fiscal_periods (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    period_code text NOT NULL,
    starts_on   date NOT NULL,
    ends_on     date NOT NULL,
    status      text NOT NULL DEFAULT 'OPEN',
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT fiscal_periods_period_code_unique UNIQUE (period_code),
    CONSTRAINT fiscal_periods_status_valid
        CHECK (status IN ('OPEN', 'SOFT_CLOSED', 'HARD_CLOSED')),
    CONSTRAINT fiscal_periods_valid_range CHECK (ends_on >= starts_on),
    -- Non-overlap is enforced natively by PostgreSQL's built-in GiST support
    -- for range types (`range_ops`) — no extension (e.g. btree_gist) needed,
    -- because this constraint has no equality column alongside the range.
    CONSTRAINT fiscal_periods_no_overlap
        EXCLUDE USING gist (daterange(starts_on, ends_on, '[]') WITH &&)
);

CREATE TRIGGER fiscal_periods_set_updated_at
    BEFORE UPDATE ON core.fiscal_periods
    FOR EACH ROW
    EXECUTE FUNCTION core.set_updated_at();

REVOKE ALL ON core.fiscal_periods FROM PUBLIC;
REVOKE ALL ON FUNCTION core.set_updated_at() FROM PUBLIC;

-- Read-only foundation: no application/IPC/workflow exists yet to open,
-- soft-close, or hard-close a period, so `stockiha_runtime` gets SELECT only.
-- A future SECURITY DEFINER period-management function will own the writes.
GRANT SELECT ON core.fiscal_periods TO stockiha_runtime;

RESET ROLE;
