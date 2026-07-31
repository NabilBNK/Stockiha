-- S4-002 existing-database compatibility: preserve CLOSED cash-session
-- immutability while allowing the lifecycle migration to populate the new
-- current cashier ownership column on historical rows.
--
-- The following migration adds current_cashier_user_id, then backfills it
-- from opened_by_user_id. Historical CLOSED rows are protected by the Slice-1
-- immutability trigger, so a normal UPDATE is correctly rejected. Rather than
-- disabling that guard, narrow it to permit exactly one legacy upgrade
-- transition:
--   NULL current cashier -> the row's immutable opened_by_user_id
-- with every pre-existing business field unchanged.
--
-- Once 20260731130000 makes current_cashier_user_id NOT NULL, this exception
-- is unreachable for all future rows/updates and CLOSED sessions remain fully
-- immutable.
SET ROLE stockiha_owner;

CREATE OR REPLACE FUNCTION sales.forbid_closed_cash_session_mutation()
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
        -- Compatibility-only exception for the S4-002 ownership backfill.
        -- to_jsonb keeps this function valid before the new column exists;
        -- when it is later added, ->> returns NULL for the historical value.
        IF (to_jsonb(OLD) ->> 'current_cashier_user_id') IS NULL
           AND (to_jsonb(NEW) ->> 'current_cashier_user_id')
               = (to_jsonb(OLD) ->> 'opened_by_user_id')
           AND (
               to_jsonb(NEW) - 'current_cashier_user_id' - 'updated_at'
               = to_jsonb(OLD) - 'current_cashier_user_id' - 'updated_at'
           ) THEN
            RETURN NEW;
        END IF;

        RAISE EXCEPTION 'closed cash sessions are immutable' USING ERRCODE = '0A000';
    END IF;

    RETURN NEW;
END;
$$;

RESET ROLE;
