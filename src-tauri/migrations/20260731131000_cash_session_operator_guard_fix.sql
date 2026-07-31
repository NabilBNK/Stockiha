-- S4-002 hardening: enforce cash-session ownership from authenticated
-- application actor context, not merely from the PostgreSQL login role.
--
-- SECURITY DEFINER posting functions populate the transaction-local actor GUCs
-- through iam.resolve_session[_with_permission]. Any call carrying that context
-- must satisfy the session ownership/workstation/OPEN invariant regardless of
-- whether the caller is stockiha_runtime or an administrative integration
-- connection. Privileged maintenance with no actor context remains possible,
-- while stockiha_runtime without authenticated context fails closed.
SET ROLE stockiha_owner;

CREATE OR REPLACE FUNCTION cash.enforce_runtime_cash_session_operator()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_actor_user_text text;
    v_actor_user_id bigint;
    v_actor_workstation_id text;
    v_status text;
    v_current_cashier_user_id bigint;
    v_session_workstation_id text;
BEGIN
    v_actor_user_text := nullif(current_setting('stockiha.actor_user_id', true), '');
    v_actor_workstation_id := nullif(current_setting('stockiha.actor_workstation_id', true), '');

    -- Owner/admin fixtures and controlled maintenance may operate without an
    -- application actor. Runtime traffic must always have authenticated actor
    -- context before it can touch the cash ledger.
    IF v_actor_user_text IS NULL AND v_actor_workstation_id IS NULL THEN
        IF session_user = 'stockiha_runtime' THEN
            RAISE EXCEPTION 'cash operation lacks authenticated actor context'
                USING ERRCODE = '28000';
        END IF;
        RETURN NEW;
    END IF;

    -- Partial or malformed context is never accepted, for any DB login.
    IF v_actor_user_text IS NULL OR v_actor_workstation_id IS NULL THEN
        RAISE EXCEPTION 'cash operation has incomplete authenticated actor context'
            USING ERRCODE = '28000';
    END IF;

    BEGIN
        v_actor_user_id := v_actor_user_text::bigint;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
        RAISE EXCEPTION 'cash operation has invalid authenticated actor context'
            USING ERRCODE = '28000';
    END;

    SELECT status, current_cashier_user_id, workstation_id
    INTO v_status, v_current_cashier_user_id, v_session_workstation_id
    FROM sales.cash_sessions
    WHERE id = NEW.cash_session_id
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'cash session not found' USING ERRCODE = '22023';
    END IF;
    IF v_status <> 'OPEN' THEN
        RAISE EXCEPTION 'cash session is not open' USING ERRCODE = '55000';
    END IF;
    IF v_current_cashier_user_id <> v_actor_user_id
       OR v_session_workstation_id <> v_actor_workstation_id THEN
        RAISE EXCEPTION 'cash session is not owned by the authenticated cashier/workstation'
            USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION cash.enforce_runtime_cash_session_operator() FROM PUBLIC;

RESET ROLE;
