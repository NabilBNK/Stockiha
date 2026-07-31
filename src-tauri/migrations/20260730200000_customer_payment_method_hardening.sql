-- S4-001 accounting hardening.
--
-- CHECK collection needs its own checks-receivable / clearing lifecycle. Treating
-- a physical check as BANK_ACCOUNT at receipt time would overstate bank cash.
-- Until that lifecycle exists, Stockiha supports only CASH and BANK_TRANSFER
-- customer debt collection. The trigger gives callers a typed validation error;
-- the table CHECK remains the final invariant.
SET ROLE stockiha_owner;

CREATE FUNCTION receivables.reject_unsupported_customer_payment_method()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    IF NEW.payment_method NOT IN ('CASH', 'BANK_TRANSFER') THEN
        RAISE EXCEPTION 'unsupported customer payment method'
            USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER customer_payments_validate_method
    BEFORE INSERT OR UPDATE OF payment_method ON receivables.customer_payments
    FOR EACH ROW EXECUTE FUNCTION receivables.reject_unsupported_customer_payment_method();

ALTER TABLE receivables.customer_payments
    DROP CONSTRAINT customer_payment_method_valid;
ALTER TABLE receivables.customer_payments
    ADD CONSTRAINT customer_payment_method_valid
    CHECK (payment_method IN ('CASH', 'BANK_TRANSFER'));

REVOKE ALL ON FUNCTION receivables.reject_unsupported_customer_payment_method() FROM PUBLIC;

RESET ROLE;
