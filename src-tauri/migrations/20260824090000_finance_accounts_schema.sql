-- WS-B-1 step 1 of 3: the real chart-of-accounts table.
--
-- This migration creates finance.accounts and its invariants only. It does
-- NOT seed data, does NOT touch finance.journal_lines, does NOT touch any
-- posting function, and does NOT change finance.require_account_role's
-- return values (that happens in the next migration, against this table).
--
-- account_type / normal_balance / control_kind are plain text + CHECK, not a
-- PostgreSQL enum: the pre-existing finance.account_role_code enum cannot be
-- extended without ALTER TYPE ... ADD VALUE (which cannot run inside a
-- transaction with earlier Postgres semantics and is generally awkward for
-- forward-only migrations); a text CHECK can be widened by a normal
-- DROP/ADD CONSTRAINT in a later migration instead.
SET ROLE stockiha_owner;

CREATE TABLE finance.accounts (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    scf_code       text NOT NULL,
    legacy_code    text,
    name_fr        text NOT NULL,
    name_ar        text,
    name_en        text,
    account_type   text NOT NULL,
    normal_balance text NOT NULL,
    parent_id      bigint REFERENCES finance.accounts(id),
    is_postable    boolean NOT NULL,
    is_control     boolean NOT NULL DEFAULT false,
    control_kind   text,
    is_active      boolean NOT NULL DEFAULT true,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT accounts_scf_code_unique UNIQUE (scf_code),
    CONSTRAINT accounts_legacy_code_unique UNIQUE (legacy_code),

    -- Non-empty and no internal/leading/trailing whitespace.
    CONSTRAINT accounts_scf_code_shape CHECK (scf_code ~ '^\S+$'),
    CONSTRAINT accounts_name_fr_not_blank CHECK (btrim(name_fr) <> ''),

    CONSTRAINT accounts_type_valid CHECK (
        account_type IN ('asset', 'liability', 'equity', 'revenue', 'expense')
    ),
    CONSTRAINT accounts_normal_balance_valid CHECK (
        normal_balance IN ('debit', 'credit')
    ),
    CONSTRAINT accounts_control_kind_valid CHECK (
        control_kind IS NULL
        OR control_kind IN ('inventory', 'ar', 'ap', 'cash', 'bank')
    ),

    -- asset/expense are debit-normal; liability/equity/revenue are credit-normal.
    CONSTRAINT accounts_normal_balance_matches_type CHECK (
        (account_type IN ('asset', 'expense') AND normal_balance = 'debit')
        OR (account_type IN ('liability', 'equity', 'revenue') AND normal_balance = 'credit')
    ),

    -- is_control and control_kind travel together.
    CONSTRAINT accounts_control_kind_consistency CHECK (
        (is_control AND control_kind IS NOT NULL)
        OR (NOT is_control AND control_kind IS NULL)
    ),

    -- Only a postable account may be a control account.
    CONSTRAINT accounts_control_requires_postable CHECK (
        NOT is_control OR is_postable
    ),

    -- A row cannot be its own parent. (Two-level-only and
    -- postable-account-cannot-have-children are enforced by trigger below,
    -- because both require looking at OTHER rows, which a CHECK constraint
    -- cannot do.)
    CONSTRAINT accounts_not_own_parent CHECK (
        parent_id IS NULL OR parent_id <> id
    )
);

-- At most one ACTIVE account per control_kind. Deactivated control accounts
-- of the same kind are allowed to coexist (e.g. during a control-account
-- migration) since is_active = false takes them out of the partial index.
CREATE UNIQUE INDEX accounts_one_active_control_per_kind
    ON finance.accounts (control_kind)
    WHERE is_control AND is_active;

CREATE INDEX accounts_parent_id_idx ON finance.accounts (parent_id);
CREATE INDEX accounts_legacy_code_idx ON finance.accounts (legacy_code)
    WHERE legacy_code IS NOT NULL;

CREATE FUNCTION finance.enforce_account_hierarchy_rules()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_parent_parent_id bigint;
    v_parent_is_postable boolean;
    v_child_count bigint;
BEGIN
    IF NEW.parent_id IS NOT NULL THEN
        SELECT parent_id, is_postable
        INTO v_parent_parent_id, v_parent_is_postable
        FROM finance.accounts
        WHERE id = NEW.parent_id;

        -- At most two levels: a parent must itself have no parent.
        IF v_parent_parent_id IS NOT NULL THEN
            RAISE EXCEPTION
                'ACCOUNT_HIERARCHY_TOO_DEEP: account % cannot be a child of account %, which is itself a child (only two levels are allowed)',
                COALESCE(NEW.id, -1), NEW.parent_id
                USING ERRCODE = '23514';
        END IF;

        -- A heading with children cannot be postable, checked from the
        -- child-insertion direction.
        IF v_parent_is_postable THEN
            RAISE EXCEPTION
                'ACCOUNT_PARENT_IS_POSTABLE: account % cannot become a child of account %, which is a postable account (a postable account cannot have children)',
                COALESCE(NEW.id, -1), NEW.parent_id
                USING ERRCODE = '23514';
        END IF;
    END IF;

    -- The same rule from the postable-flag direction: a row that already has
    -- children cannot be (re)marked postable.
    IF NEW.is_postable THEN
        SELECT count(*) INTO v_child_count
        FROM finance.accounts
        WHERE parent_id = NEW.id;

        IF v_child_count > 0 THEN
            RAISE EXCEPTION
                'ACCOUNT_HAS_CHILDREN: account % has % child account(s) and cannot be marked postable',
                NEW.id, v_child_count
                USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER accounts_enforce_hierarchy_rules
    BEFORE INSERT OR UPDATE ON finance.accounts
    FOR EACH ROW
    EXECUTE FUNCTION finance.enforce_account_hierarchy_rules();

CREATE TRIGGER accounts_set_updated_at
    BEFORE UPDATE ON finance.accounts
    FOR EACH ROW
    EXECUTE FUNCTION core.set_updated_at();

-- Accounts are deactivated, never deleted: a row referenced by posted history
-- must stay readable forever. No role gets DELETE.
REVOKE ALL ON finance.accounts FROM PUBLIC;
REVOKE DELETE ON finance.accounts FROM stockiha_runtime;
GRANT SELECT ON finance.accounts TO stockiha_runtime;

RESET ROLE;
