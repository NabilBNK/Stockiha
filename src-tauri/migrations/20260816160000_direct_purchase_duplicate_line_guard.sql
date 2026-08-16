-- Direct Purchase acceptance-gap closure: do not permit ambiguous duplicate
-- variant/unit lines in a single direct-purchase receipt. This is a forward
-- migration so installed Direct Purchase history remains byte-stable.

SET ROLE stockiha_owner;

CREATE OR REPLACE FUNCTION procurement.forbid_duplicate_direct_purchase_line()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM procurement.purchase_receipts receipt
        WHERE receipt.document_id = NEW.document_id
          AND receipt.receipt_origin = 'DIRECT_PURCHASE'
    ) AND EXISTS (
        SELECT 1
        FROM procurement.purchase_receipt_lines existing_line
        WHERE existing_line.document_id = NEW.document_id
          AND existing_line.variant_id = NEW.variant_id
          AND existing_line.unit_id = NEW.unit_id
    ) THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Direct purchase cannot contain duplicate variant and unit lines'
            USING ERRCODE = '22023';
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION procurement.forbid_duplicate_direct_purchase_line() FROM PUBLIC;

DROP TRIGGER IF EXISTS purchase_receipt_lines_forbid_duplicate_direct_purchase_line
    ON procurement.purchase_receipt_lines;

CREATE TRIGGER purchase_receipt_lines_forbid_duplicate_direct_purchase_line
BEFORE INSERT ON procurement.purchase_receipt_lines
FOR EACH ROW
EXECUTE FUNCTION procurement.forbid_duplicate_direct_purchase_line();

RESET ROLE;
