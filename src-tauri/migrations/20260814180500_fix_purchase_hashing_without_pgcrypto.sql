-- Migration: 20260814180500_fix_purchase_hashing_without_pgcrypto.sql
-- Fixes Confirm Purchase runtime failure:
--   function digest(text, unknown) does not exist
--
-- Root cause:
-- procurement.post_purchase_transaction is SECURITY DEFINER with
--   SET search_path = pg_catalog
-- but its nested idempotency hashes call unqualified digest(text, 'sha256').
-- digest() is a pgcrypto extension function and Stockiha does not install or
-- expose pgcrypto in that hardened search_path. PostgreSQL 18 already provides
-- the core sha256(bytea) primitive, so keep the database extension-free and
-- provide a trusted core-schema compatibility function for this call site.
--
-- This migration intentionally does NOT broaden the SECURITY DEFINER search
-- path to public and does NOT install pgcrypto.

SET ROLE stockiha_owner;

-- Trusted compatibility helper used only by hardened Stockiha functions.
-- It preserves the bytea SHA-256 contract expected by request idempotency.
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

-- Keep pg_catalog first and add only Stockiha's protected core schema.
-- This allows the existing unqualified digest(...) calls inside the function
-- to resolve to core.digest without exposing PUBLIC or another writable schema.
ALTER FUNCTION procurement.post_purchase_transaction(text, uuid, bytea, jsonb)
    SET search_path TO pg_catalog, core;

-- Fail migration immediately if the compatibility hash does not match the
-- PostgreSQL 18 core SHA-256 primitive.
DO $$
DECLARE
    v_expected bytea;
    v_actual bytea;
BEGIN
    v_expected := sha256(convert_to('stockiha-confirm-purchase-hash-self-test', 'UTF8'));
    v_actual := core.digest('stockiha-confirm-purchase-hash-self-test', 'sha256');

    IF v_actual IS DISTINCT FROM v_expected THEN
        RAISE EXCEPTION 'purchase hashing compatibility self-test failed';
    END IF;
END;
$$;

RESET ROLE;
