-- Remove the obsolete helper overload left by the catalog redesign.
-- A two-argument call is ambiguous when both (bigint, text) and
-- (bigint, text, boolean DEFAULT false) exist.
SET ROLE stockiha_owner;

DO $$
BEGIN
    IF to_regprocedure('catalog._insert_barcode(bigint,text,boolean)') IS NULL THEN
        RAISE EXCEPTION 'canonical catalog._insert_barcode(bigint, text, boolean) is missing';
    END IF;
END
$$;

DROP FUNCTION IF EXISTS catalog._insert_barcode(bigint, text);

REVOKE ALL ON FUNCTION catalog._insert_barcode(bigint, text, boolean) FROM PUBLIC;

RESET ROLE;
