-- Slice 6: Stored Procedures for Print Queue Management

CREATE OR REPLACE FUNCTION core.enqueue_print_job(
    p_session_token text,
    p_document_id bigint,
    p_job_type text, -- 'THERMAL_RECEIPT' | 'PDF_INVOICE' | 'DRAWER_PULSE'
    p_format text,   -- 'ESC_POS_80MM' | 'PDF_A4' | 'PDF_A5'
    p_printer_name text DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, iam, public
AS $$
DECLARE
    v_user_id bigint;
    v_job_id bigint;
BEGIN
    SELECT user_id INTO v_user_id
    FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_PRINT_JOBS');

    IF p_job_type NOT IN ('THERMAL_RECEIPT', 'PDF_INVOICE', 'DRAWER_PULSE') THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Invalid job type %', p_job_type USING ERRCODE = '22023';
    END IF;

    IF p_format NOT IN ('ESC_POS_80MM', 'PDF_A4', 'PDF_A5') THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Invalid format %', p_format USING ERRCODE = '22023';
    END IF;

    INSERT INTO core.print_jobs (document_id, job_type, format, printer_name, status)
    VALUES (p_document_id, p_job_type, p_format, p_printer_name, 'PENDING')
    RETURNING id INTO v_job_id;

    RETURN v_job_id;
END;
$$;

CREATE OR REPLACE FUNCTION core.list_print_jobs(
    p_session_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, iam, public
AS $$
DECLARE
    v_user_id bigint;
    v_result jsonb;
BEGIN
    SELECT s.user_id INTO v_user_id FROM iam.application_sessions s WHERE s.token_hash = sha256(p_session_token::bytea) AND s.expires_at > now();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'SESSION_INVALID: Invalid session' USING ERRCODE = '28000';
    END IF;

    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', pj.id,
            'document_id', pj.document_id,
            'document_number', bd.document_number,
            'document_type', bd.document_type,
            'job_type', pj.job_type,
            'format', pj.format,
            'status', pj.status,
            'printer_name', pj.printer_name,
            'error_message', pj.error_message,
            'created_at', to_char(pj.created_at AT TIME ZONE 'Africa/Algiers', 'YYYY-MM-DD"T"HH24:MI:SS'),
            'completed_at', CASE WHEN pj.completed_at IS NOT NULL THEN to_char(pj.completed_at AT TIME ZONE 'Africa/Algiers', 'YYYY-MM-DD"T"HH24:MI:SS') ELSE NULL END
        ) ORDER BY pj.created_at DESC
    ), '[]'::jsonb)
    INTO v_result
    FROM core.print_jobs pj
    LEFT JOIN core.business_documents bd ON bd.id = pj.document_id;

    RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION core.update_print_job_status(
    p_session_token text,
    p_job_id bigint,
    p_status text, -- 'COMPLETED' | 'FAILED'
    p_error_message text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, iam, public
AS $$
DECLARE
    v_user_id bigint;
BEGIN
    SELECT user_id INTO v_user_id
    FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_PRINT_JOBS');

    IF p_status NOT IN ('COMPLETED', 'FAILED') THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Invalid status %', p_status USING ERRCODE = '22023';
    END IF;

    UPDATE core.print_jobs
    SET status = p_status,
        error_message = p_error_message,
        completed_at = CASE WHEN p_status = 'COMPLETED' THEN now() ELSE completed_at END
    WHERE id = p_job_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION core.enqueue_print_job(text, bigint, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION core.list_print_jobs(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION core.update_print_job_status(text, bigint, text, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION core.enqueue_print_job(text, bigint, text, text, text) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION core.list_print_jobs(text) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION core.update_print_job_status(text, bigint, text, text) TO stockiha_runtime;
