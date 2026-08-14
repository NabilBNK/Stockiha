-- Migration: 20260814231000_stabilize_purchase_posting_contract.sql
-- Final compatibility guard for the single-entry purchase posting path.
-- Ensures the already-released purchase function can always resolve SHA-256
-- hashing and the purchase receipt document enqueue call without relying on
-- pgcrypto or PUBLIC search-path behavior.

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'stockiha_owner') THEN
        EXECUTE 'SET ROLE stockiha_owner';
    END IF;
EXCEPTION WHEN OTHERS THEN
    NULL;
END $$;

-- Keep the hash contract extension-free and deterministic on PostgreSQL 18.
CREATE OR REPLACE FUNCTION core.digest(p_data text, p_algorithm text)
RETURNS bytea
LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path = pg_catalog
AS $$
BEGIN
    IF lower(p_algorithm) <> 'sha256' THEN
        RAISE EXCEPTION 'unsupported digest algorithm: %', p_algorithm
            USING ERRCODE = '22023';
    END IF;

    RETURN sha256(convert_to(p_data, 'UTF8'));
END;
$$;

REVOKE ALL ON FUNCTION core.digest(text, text) FROM PUBLIC;

-- Transitional compatibility entry point for the incorrect call introduced by
-- the first purchase transaction migration. It delegates to the authoritative
-- documents queue and does not create a second queue implementation.
CREATE OR REPLACE FUNCTION core.enqueue_document_job(
    p_business_document_id bigint,
    p_job_kind text,
    p_payload jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    IF p_job_kind <> 'GENERATE_PURCHASE_TRANSACTION_PDF' THEN
        RAISE EXCEPTION 'unsupported compatibility document job kind: %', p_job_kind
            USING ERRCODE = '22023';
    END IF;

    PERFORM *
    FROM documents.enqueue_business_document_jobs(
        p_business_document_id,
        'PURCHASE_RECEIPT_PDF',
        'purchase_receipt:' || p_business_document_id::text
    );
END;
$$;

REVOKE ALL ON FUNCTION core.enqueue_document_job(bigint, text, jsonb) FROM PUBLIC;

-- Reassert the hardened search path after any later CREATE OR REPLACE of the
-- purchase function. The only additional schema is protected Stockiha core.
ALTER FUNCTION procurement.post_purchase_transaction(text, uuid, bytea, jsonb)
    SET search_path TO pg_catalog, core;

-- Migration-time proof for the exact runtime contracts that previously failed.
DO $$
DECLARE
    v_hash bytea;
BEGIN
    v_hash := core.digest('stockiha-purchase-contract-proof', 'sha256');
    IF length(v_hash) <> 32 THEN
        RAISE EXCEPTION 'purchase SHA-256 compatibility proof failed';
    END IF;

    IF to_regprocedure('core.enqueue_document_job(bigint,text,jsonb)') IS NULL THEN
        RAISE EXCEPTION 'purchase document enqueue compatibility function is missing';
    END IF;
END;
$$;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'stockiha_owner') THEN
        EXECUTE 'RESET ROLE';
    END IF;
EXCEPTION WHEN OTHERS THEN
    NULL;
END $$;
