# Verification script for direct database catalog & security properties of WS-A-1
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$DatabaseName = 'stockiha_iam_test'
$localSecretRoot = Join-Path $env:LOCALAPPDATA 'Stockiha\r8-acceptance'

function Get-Secret([string]$File, [string]$EnvName) {
    $envVal = [Environment]::GetEnvironmentVariable($EnvName, 'Process')
    if (-not [string]::IsNullOrWhiteSpace($envVal)) { return $envVal.Trim() }
    $path = Join-Path $localSecretRoot $File
    if (Test-Path -LiteralPath $path) { return (Get-Content -LiteralPath $path -Raw).Trim() }
    throw "Secret $File / $EnvName not found."
}

$adminPw = Get-Secret 'admin.key' 'STOCKIHA_ADMIN_PW'
$psql = 'C:\Program Files\PostgreSQL\18\bin\psql.exe'
if (-not (Test-Path -LiteralPath $psql)) {
    $psqlCmd = Get-Command psql.exe -ErrorAction SilentlyContinue
    if ($psqlCmd) { $psql = $psqlCmd.Source }
    else { throw "psql not found" }
}

$escapedAdminPw = [System.Uri]::EscapeDataString($adminPw)
$targetAdminUrl = "postgres://stockiha_admin:${escapedAdminPw}@127.0.0.1:5433/${DatabaseName}?sslmode=disable"

Write-Host "Verifying direct database catalog and security properties on $DatabaseName..."

$sql = @'
DO $$
DECLARE
    v_count int;
    v_total_perms int;
    v_sa_perms int;
    v_func text;
    v_secdef boolean;
    v_proconfig text[];
    v_owner text;
    v_has_exec boolean;
    v_has_insert boolean;
    v_has_update boolean;
    v_has_delete boolean;
    v_funcs text[] := ARRAY[
        'create_user(text,text,text,text,text)',
        'list_users(text)',
        'set_user_active(text,bigint,boolean)',
        'assign_user_role(text,bigint,text)',
        'create_role(text,text,text)',
        'list_permissions(text)',
        'set_role_permissions(text,text,text[])'
    ];
BEGIN
    -- 1. Check SUPER_ADMIN and ADMIN roles
    SELECT COUNT(*) INTO v_count FROM iam.roles WHERE code = 'SUPER_ADMIN';
    IF v_count <> 1 THEN RAISE EXCEPTION 'SUPER_ADMIN role missing in iam.roles'; END IF;

    SELECT COUNT(*) INTO v_count FROM iam.roles WHERE code = 'ADMIN';
    IF v_count <> 1 THEN RAISE EXCEPTION 'ADMIN role missing in iam.roles'; END IF;

    -- 2. Check MANAGE_USERS and MANAGE_ROLES permissions
    SELECT COUNT(*) INTO v_count FROM iam.permissions WHERE code = 'MANAGE_USERS';
    IF v_count <> 1 THEN RAISE EXCEPTION 'MANAGE_USERS permission missing in iam.permissions'; END IF;

    SELECT COUNT(*) INTO v_count FROM iam.permissions WHERE code = 'MANAGE_ROLES';
    IF v_count <> 1 THEN RAISE EXCEPTION 'MANAGE_ROLES permission missing in iam.permissions'; END IF;

    -- 3. Check SUPER_ADMIN has every permission
    SELECT COUNT(*) INTO v_total_perms FROM iam.permissions;
    SELECT COUNT(*) INTO v_sa_perms
    FROM iam.role_permissions rp
    JOIN iam.roles r ON rp.role_id = r.id
    WHERE r.code = 'SUPER_ADMIN';
    IF v_sa_perms <> v_total_perms THEN
        RAISE EXCEPTION 'SUPER_ADMIN permissions count mismatch: expected %, got %', v_total_perms, v_sa_perms;
    END IF;

    -- 4. Check ADMIN has MANAGE_USERS and MANAGE_ROLES
    SELECT COUNT(*) INTO v_count
    FROM iam.role_permissions rp
    JOIN iam.roles r ON rp.role_id = r.id
    JOIN iam.permissions p ON rp.permission_id = p.id
    WHERE r.code = 'ADMIN' AND p.code IN ('MANAGE_USERS', 'MANAGE_ROLES');
    IF v_count <> 2 THEN
        RAISE EXCEPTION 'ADMIN is missing MANAGE_USERS or MANAGE_ROLES; found % of 2', v_count;
    END IF;

    -- 5. Check SECURITY DEFINER, owner stockiha_owner, and search_path pg_catalog for all 7 functions
    FOREACH v_func IN ARRAY v_funcs LOOP
        SELECT 
            p.prosecdef,
            p.proconfig,
            pg_get_userbyid(p.proowner)
        INTO v_secdef, v_proconfig, v_owner
        FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'iam' AND p.oid = format('iam.%s', v_func)::regprocedure;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Function iam.% is missing', v_func;
        END IF;

        IF NOT v_secdef THEN
            RAISE EXCEPTION 'Function iam.% is NOT SECURITY DEFINER', v_func;
        END IF;

        IF v_owner <> 'stockiha_owner' THEN
            RAISE EXCEPTION 'Function iam.% owner is %, expected stockiha_owner', v_func, v_owner;
        END IF;

        IF NOT (v_proconfig @> ARRAY['search_path=pg_catalog']) THEN
            RAISE EXCEPTION 'Function iam.% search_path is not pg_catalog: %', v_func, v_proconfig;
        END IF;

        -- Check EXECUTE grant to stockiha_runtime
        SELECT has_function_privilege('stockiha_runtime', format('iam.%s', v_func)::regprocedure, 'EXECUTE')
        INTO v_has_exec;
        IF NOT v_has_exec THEN
            RAISE EXCEPTION 'stockiha_runtime lacks EXECUTE privilege on iam.%', v_func;
        END IF;
    END LOOP;

    -- 6. Check stockiha_runtime has NO write privileges on iam tables
    FOR v_func IN SELECT tablename FROM pg_tables WHERE schemaname = 'iam' AND tablename IN ('users', 'roles', 'permissions', 'role_permissions', 'user_roles') LOOP
        SELECT 
            has_table_privilege('stockiha_runtime', format('iam.%I', v_func), 'INSERT'),
            has_table_privilege('stockiha_runtime', format('iam.%I', v_func), 'UPDATE'),
            has_table_privilege('stockiha_runtime', format('iam.%I', v_func), 'DELETE')
        INTO v_has_insert, v_has_update, v_has_delete;

        IF v_has_insert OR v_has_update OR v_has_delete THEN
            RAISE EXCEPTION 'stockiha_runtime has unauthorized write privileges on iam.%: insert=%, update=%, delete=%',
                v_func, v_has_insert, v_has_update, v_has_delete;
        END IF;
    END LOOP;

    RAISE NOTICE 'Direct database catalog and security verification: ALL CHECKS PASSED';
END;
$$;
'@

& $psql $targetAdminUrl -X -v ON_ERROR_STOP=1 -c $sql
if ($LASTEXITCODE -ne 0) {
    throw "Direct catalog verification failed."
}

Write-Host "Direct database catalog and security verification: PASS" -ForegroundColor Green
