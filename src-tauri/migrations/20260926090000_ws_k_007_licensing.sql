-- WS-K-7: offline licence activation — database side.
--
-- Two tables: `core.licence_runtime` (the single-row clock guard the app
-- reads/updates before anyone has logged in, per WS-K-7 plan §5.7) and
-- `core.licence_events` (the append-only activation/removal audit trail).
-- Four SECURITY DEFINER functions. `licence_touch` and `licence_record_seen`
-- need no session — the app refreshes its licence status before anyone has
-- logged in — and can only move `grace_started_at` earlier or `last_seen_at`
-- later, both of which are protective, so a misuse can only hurt the
-- caller. `licence_reset_last_seen` and `record_licence_event` require a
-- valid session.

SET ROLE stockiha_owner;

CREATE TABLE IF NOT EXISTS core.licence_runtime (
    id                smallint PRIMARY KEY DEFAULT 1,
    grace_started_at  timestamptz,
    last_seen_at      timestamptz,
    updated_at        timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT licence_runtime_single_row CHECK (id = 1)
);
INSERT INTO core.licence_runtime (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS core.licence_events (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    occurred_at    timestamptz NOT NULL DEFAULT now(),
    event_type     text NOT NULL,
    licence_id     text,
    machine_code   text,
    reason_code    text,
    user_id        bigint REFERENCES iam.users (id) ON DELETE SET NULL,
    workstation_id text,
    CONSTRAINT licence_events_type_valid CHECK (event_type IN ('ACTIVATED','REMOVED','ACTIVATION_REJECTED')),
    CONSTRAINT licence_events_licence_id_length CHECK (licence_id IS NULL OR char_length(licence_id) <= 40),
    CONSTRAINT licence_events_reason_length CHECK (reason_code IS NULL OR char_length(reason_code) <= 64)
);

REVOKE ALL ON core.licence_runtime, core.licence_events FROM PUBLIC, stockiha_runtime;
GRANT SELECT ON core.licence_runtime, core.licence_events TO stockiha_backup;

CREATE OR REPLACE FUNCTION core.licence_touch()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_grace_started_at timestamptz;
    v_last_seen_at timestamptz;
BEGIN
    SELECT grace_started_at, last_seen_at
    INTO v_grace_started_at, v_last_seen_at
    FROM core.licence_runtime
    WHERE id = 1;

    RETURN jsonb_build_object(
        'grace_started_at', v_grace_started_at,
        'last_seen_at', v_last_seen_at
    );
END;
$$;

CREATE OR REPLACE FUNCTION core.licence_record_seen(
    p_first_seen timestamptz,
    p_last_seen timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    UPDATE core.licence_runtime
    SET grace_started_at = least(coalesce(grace_started_at, p_first_seen), p_first_seen),
        last_seen_at = greatest(coalesce(last_seen_at, p_last_seen), p_last_seen),
        updated_at = now()
    WHERE id = 1;
END;
$$;

CREATE OR REPLACE FUNCTION core.licence_reset_last_seen(
    p_session_token text,
    p_last_seen timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    PERFORM 1 FROM iam.resolve_session(p_session_token);

    UPDATE core.licence_runtime
    SET last_seen_at = p_last_seen,
        updated_at = now()
    WHERE id = 1;
END;
$$;

CREATE OR REPLACE FUNCTION core.record_licence_event(
    p_session_token text,
    p_event_type text,
    p_licence_id text,
    p_machine_code text,
    p_reason_code text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_user_id bigint;
    v_workstation_id text;
BEGIN
    SELECT user_id, workstation_id
    INTO v_user_id, v_workstation_id
    FROM iam.resolve_session(p_session_token);

    -- An invalid `p_event_type` is rejected by `licence_events_type_valid`
    -- (the table's own CHECK constraint) below, not re-validated here.
    INSERT INTO core.licence_events (
        event_type, licence_id, machine_code, reason_code, user_id, workstation_id
    ) VALUES (
        p_event_type, p_licence_id, p_machine_code, p_reason_code, v_user_id, v_workstation_id
    );
END;
$$;

REVOKE ALL ON FUNCTION core.licence_touch() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.licence_touch() TO stockiha_runtime;

REVOKE ALL ON FUNCTION core.licence_record_seen(timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.licence_record_seen(timestamptz, timestamptz) TO stockiha_runtime;

REVOKE ALL ON FUNCTION core.licence_reset_last_seen(text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.licence_reset_last_seen(text, timestamptz) TO stockiha_runtime;

REVOKE ALL ON FUNCTION core.record_licence_event(text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.record_licence_event(text, text, text, text, text) TO stockiha_runtime;

UPDATE operations.schema_state SET migration_version = 20260926090000, updated_at = now() WHERE singleton;

RESET ROLE;
