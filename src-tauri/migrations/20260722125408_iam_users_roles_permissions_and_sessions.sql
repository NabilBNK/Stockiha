-- Slice 1 MVP batch: `iam` schema — administrators/users, roles,
-- permissions, and the session/token model, reusing the S0-006 proof's
-- SECURITY DEFINER / session-token pattern instead of inventing a new one
-- (final-architecture.md section 2.3).
--
-- Session table matches architecture's own literal column list exactly:
-- `iam.application_sessions (id, token_hash, user_id, workstation_id,
-- created_at, expires_at, revoked_at)`.
SET ROLE stockiha_owner;

CREATE SCHEMA IF NOT EXISTS iam AUTHORIZATION stockiha_owner;
REVOKE ALL ON SCHEMA iam FROM PUBLIC;
GRANT USAGE ON SCHEMA iam TO stockiha_runtime;

CREATE TABLE iam.users (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    username       text NOT NULL,
    -- Self-describing Argon2 hash string (algorithm, params, salt, and hash
    -- all encoded in the one field) — never a raw or reversibly-encrypted
    -- password. Verified in Rust via the `argon2` crate; the database never
    -- computes or compares a password hash itself.
    password_hash  text NOT NULL,
    display_name   text NOT NULL,
    is_active      boolean NOT NULL DEFAULT true,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT users_username_unique UNIQUE (username),
    CONSTRAINT users_username_not_blank CHECK (btrim(username) <> ''),
    CONSTRAINT users_display_name_not_blank CHECK (btrim(display_name) <> '')
);

-- Fixed, closed permission vocabulary for this MVP batch — scoped to
-- exactly what the Golden Transaction Chain's posting functions need to
-- authorize. Extending this is a deliberate future migration, not a loose
-- free-text column.
CREATE TABLE iam.permissions (
    id    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code  text NOT NULL,
    name  text NOT NULL,
    CONSTRAINT permissions_code_unique UNIQUE (code),
    CONSTRAINT permissions_code_valid CHECK (
        code IN (
            'POST_STOCK_RECEIPT',
            'POST_CASH_SALE',
            'OPEN_CASH_SESSION',
            'CLOSE_CASH_SESSION'
        )
    )
);

CREATE TABLE iam.roles (
    id    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code  text NOT NULL,
    name  text NOT NULL,
    CONSTRAINT roles_code_unique UNIQUE (code),
    CONSTRAINT roles_code_not_blank CHECK (btrim(code) <> '')
);

CREATE TABLE iam.role_permissions (
    role_id        bigint NOT NULL REFERENCES iam.roles (id),
    permission_id  bigint NOT NULL REFERENCES iam.permissions (id),
    PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE iam.user_roles (
    user_id  bigint NOT NULL REFERENCES iam.users (id),
    role_id  bigint NOT NULL REFERENCES iam.roles (id),
    PRIMARY KEY (user_id, role_id)
);

-- Minimal seed reference data (the fixed permission/role vocabulary itself,
-- not test fixtures or fake accounts): three baseline roles covering the
-- MVP chain's four permissions. No user accounts are seeded here — creating
-- an actual administrator/cashier account is an application-level bootstrap
-- concern, not migration data.
INSERT INTO iam.permissions (code, name) VALUES
    ('POST_STOCK_RECEIPT', 'Post an emergency/opening stock receipt'),
    ('POST_CASH_SALE', 'Confirm a cash sale'),
    ('OPEN_CASH_SESSION', 'Open a cash register session'),
    ('CLOSE_CASH_SESSION', 'Close a cash register session');

INSERT INTO iam.roles (code, name) VALUES
    ('CASHIER', 'Cashier'),
    ('MANAGER', 'Manager'),
    ('ADMIN', 'Administrator');

INSERT INTO iam.role_permissions (role_id, permission_id)
    SELECT r.id, p.id FROM iam.roles r, iam.permissions p
    WHERE r.code = 'CASHIER'
      AND p.code IN ('OPEN_CASH_SESSION', 'CLOSE_CASH_SESSION', 'POST_CASH_SALE');

INSERT INTO iam.role_permissions (role_id, permission_id)
    SELECT r.id, p.id FROM iam.roles r, iam.permissions p
    WHERE r.code = 'MANAGER'
      AND p.code IN ('OPEN_CASH_SESSION', 'CLOSE_CASH_SESSION', 'POST_CASH_SALE', 'POST_STOCK_RECEIPT');

INSERT INTO iam.role_permissions (role_id, permission_id)
    SELECT r.id, p.id FROM iam.roles r, iam.permissions p WHERE r.code = 'ADMIN';

-- `iam.application_sessions` — token_hash only, never the raw token
-- (matches the S0-006 proof's `s0_006_proof.app_sessions` design exactly:
-- SHA-256 of the opaque token, resolved via a SECURITY DEFINER function).
CREATE TABLE iam.application_sessions (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    token_hash      bytea NOT NULL,
    user_id         bigint NOT NULL REFERENCES iam.users (id),
    workstation_id  text NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    expires_at      timestamptz NOT NULL,
    revoked_at      timestamptz,
    CONSTRAINT application_sessions_token_hash_unique UNIQUE (token_hash),
    CONSTRAINT application_sessions_workstation_not_blank CHECK (btrim(workstation_id) <> '')
);

CREATE TRIGGER users_set_updated_at
    BEFORE UPDATE ON iam.users
    FOR EACH ROW
    EXECUTE FUNCTION core.set_updated_at();

-- Resolves an opaque session token with no permission requirement — for
-- read-only inspection calls (e.g. "inspect active cash session") that need
-- a valid, live session but are not themselves a protected posting
-- operation gated by one specific permission code.
CREATE FUNCTION iam.resolve_session(p_token text)
RETURNS TABLE (user_id bigint, workstation_id text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_user_id bigint;
    v_workstation_id text;
BEGIN
    SELECT s.user_id, s.workstation_id
        INTO v_user_id, v_workstation_id
        FROM iam.application_sessions s
        JOIN iam.users u ON u.id = s.user_id
        WHERE s.token_hash = sha256(p_token::bytea)
          AND s.revoked_at IS NULL
          AND s.expires_at > now()
          AND u.is_active;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'invalid, expired, or revoked session'
            USING ERRCODE = '28000';
    END IF;

    RETURN QUERY SELECT v_user_id, v_workstation_id;
END;
$$;

-- Resolves an opaque session token AND checks a required permission in one
-- call — the single primitive every posting function needs
-- (final-architecture.md section 2.3: "Every posting function verifies:
-- token exists, is not expired, is not revoked, and the resolved user holds
-- the required permission"). `SECURITY DEFINER` with a fixed,
-- schema-qualified `search_path`, following the exact S0-006 proof pattern.
-- Never trusts a caller-supplied actor id — the only input is the opaque
-- token itself.
CREATE FUNCTION iam.resolve_session_with_permission(
    p_token text,
    p_permission_code text
)
RETURNS TABLE (user_id bigint, workstation_id text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_user_id bigint;
    v_workstation_id text;
    v_has_permission boolean;
BEGIN
    SELECT s.user_id, s.workstation_id
        INTO v_user_id, v_workstation_id
        FROM iam.application_sessions s
        JOIN iam.users u ON u.id = s.user_id
        WHERE s.token_hash = sha256(p_token::bytea)
          AND s.revoked_at IS NULL
          AND s.expires_at > now()
          AND u.is_active;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'invalid, expired, or revoked session'
            USING ERRCODE = '28000';
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM iam.user_roles ur
        JOIN iam.role_permissions rp ON rp.role_id = ur.role_id
        JOIN iam.permissions p ON p.id = rp.permission_id
        WHERE ur.user_id = v_user_id AND p.code = p_permission_code
    ) INTO v_has_permission;

    IF NOT v_has_permission THEN
        RAISE EXCEPTION 'session user lacks required permission: %', p_permission_code
            USING ERRCODE = '42501';
    END IF;

    RETURN QUERY SELECT v_user_id, v_workstation_id;
END;
$$;


REVOKE ALL ON iam.users FROM PUBLIC;
REVOKE ALL ON iam.permissions FROM PUBLIC;
REVOKE ALL ON iam.roles FROM PUBLIC;
REVOKE ALL ON iam.role_permissions FROM PUBLIC;
REVOKE ALL ON iam.user_roles FROM PUBLIC;
REVOKE ALL ON iam.application_sessions FROM PUBLIC;
REVOKE ALL ON FUNCTION iam.resolve_session(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION iam.resolve_session_with_permission(text, text) FROM PUBLIC;

-- `stockiha_runtime` authenticates users (reads `users`/`role_permissions`
-- to verify a login and issue a session — login itself is not a protected
-- posting operation) and creates/revokes its own sessions directly; it does
-- NOT get write access to permissions/roles/role_permissions (fixed
-- reference data, owner-managed only).
GRANT SELECT ON iam.users TO stockiha_runtime;
GRANT SELECT ON iam.permissions TO stockiha_runtime;
GRANT SELECT ON iam.roles TO stockiha_runtime;
GRANT SELECT ON iam.role_permissions TO stockiha_runtime;
GRANT SELECT ON iam.user_roles TO stockiha_runtime;
GRANT SELECT, INSERT, UPDATE ON iam.application_sessions TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION iam.resolve_session(text) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION iam.resolve_session_with_permission(text, text) TO stockiha_runtime;

RESET ROLE;
