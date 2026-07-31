-- S4-001: Safe UI capability projection. This does not authorize operations;
-- every write/posting function still performs its own database permission check.
SET ROLE stockiha_owner;

CREATE FUNCTION receivables.get_customer_capabilities(p_session_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_user_id bigint;
BEGIN
    SELECT user_id INTO v_user_id
    FROM iam.resolve_session(p_session_token);

    RETURN jsonb_build_object(
        'can_view_customers', EXISTS (
            SELECT 1
            FROM iam.user_roles ur
            JOIN iam.role_permissions rp ON rp.role_id = ur.role_id
            JOIN iam.permissions p ON p.id = rp.permission_id
            WHERE ur.user_id = v_user_id AND p.code = 'VIEW_CUSTOMERS'
        ),
        'can_manage_customers', EXISTS (
            SELECT 1
            FROM iam.user_roles ur
            JOIN iam.role_permissions rp ON rp.role_id = ur.role_id
            JOIN iam.permissions p ON p.id = rp.permission_id
            WHERE ur.user_id = v_user_id AND p.code = 'MANAGE_CUSTOMERS'
        ),
        'can_post_credit_sale', EXISTS (
            SELECT 1
            FROM iam.user_roles ur
            JOIN iam.role_permissions rp ON rp.role_id = ur.role_id
            JOIN iam.permissions p ON p.id = rp.permission_id
            WHERE ur.user_id = v_user_id AND p.code = 'POST_CREDIT_SALE'
        ),
        'can_post_customer_payment', EXISTS (
            SELECT 1
            FROM iam.user_roles ur
            JOIN iam.role_permissions rp ON rp.role_id = ur.role_id
            JOIN iam.permissions p ON p.id = rp.permission_id
            WHERE ur.user_id = v_user_id AND p.code = 'POST_CUSTOMER_PAYMENT'
        ),
        'can_override_credit_limit', EXISTS (
            SELECT 1
            FROM iam.user_roles ur
            JOIN iam.role_permissions rp ON rp.role_id = ur.role_id
            JOIN iam.permissions p ON p.id = rp.permission_id
            WHERE ur.user_id = v_user_id AND p.code = 'OVERRIDE_CREDIT_LIMIT'
        )
    );
END;
$$;

REVOKE ALL ON FUNCTION receivables.get_customer_capabilities(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION receivables.get_customer_capabilities(text) TO stockiha_runtime;

RESET ROLE;
