-- R6-003 (WS-H-1, G3): a configurable, user-changeable backup destination.
--
-- Adds exactly one new persisted value to the existing R6-002 singleton
-- settings table (`operations.recovery_settings`) rather than introducing a
-- new schema, table, or general settings engine. NULL means "no stored
-- setting" — the application falls back to the existing STOCKIHA_BACKUP_ROOT
-- environment variable exactly as it does today (G3 regression-risk seam).
--
-- Reuses the existing CREATE_BACKUP_BUNDLE permission code rather than
-- widening the iam.permissions CHECK constraint: whoever may create a backup
-- may also choose where it is written. No new permission code is added.
SET ROLE stockiha_owner;

ALTER TABLE operations.recovery_settings
    ADD COLUMN backup_destination_path text;

ALTER TABLE operations.recovery_settings
    ADD CONSTRAINT recovery_settings_backup_destination_path_valid CHECK (
        backup_destination_path IS NULL
        OR (
            btrim(backup_destination_path) = backup_destination_path
            AND btrim(backup_destination_path) <> ''
            AND length(backup_destination_path) <= 400
        )
    );

CREATE FUNCTION operations.get_backup_destination_setting(
    p_session_token text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_path text;
BEGIN
    PERFORM 1
    FROM iam.resolve_session_with_permission(p_session_token, 'CREATE_BACKUP_BUNDLE');

    SELECT backup_destination_path
    INTO v_path
    FROM operations.recovery_settings
    WHERE singleton;

    RETURN jsonb_build_object('path', v_path);
END;
$$;

CREATE FUNCTION operations.update_backup_destination_setting(
    p_session_token text,
    p_path text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_actor_id bigint;
    v_normalized text;
BEGIN
    SELECT user_id
    INTO v_actor_id
    FROM iam.resolve_session_with_permission(p_session_token, 'CREATE_BACKUP_BUNDLE');

    v_normalized := NULLIF(btrim(p_path), '');
    IF v_normalized IS NOT NULL AND length(v_normalized) > 400 THEN
        RAISE EXCEPTION 'backup destination path is too long' USING ERRCODE = '22023';
    END IF;

    UPDATE operations.recovery_settings
    SET backup_destination_path = v_normalized,
        updated_by = v_actor_id,
        updated_at = now()
    WHERE singleton;

    RETURN jsonb_build_object('path', v_normalized);
END;
$$;

REVOKE ALL ON FUNCTION operations.get_backup_destination_setting(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION operations.update_backup_destination_setting(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION operations.get_backup_destination_setting(text) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION operations.update_backup_destination_setting(text, text) TO stockiha_runtime;

-- operations.recovery_settings is already granted to stockiha_backup by
-- migration 20260805151000; this new column requires no additional grant.

UPDATE operations.schema_state
SET migration_version = 20260829100000,
    updated_at = now()
WHERE singleton;

RESET ROLE;
