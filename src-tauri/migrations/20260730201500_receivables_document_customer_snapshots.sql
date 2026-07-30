-- S4-001 document integrity: posted credit/customer-payment documents must not
-- render mutable customer master data. Freeze the customer identity used at
-- posting time on each commercial document header.
SET ROLE stockiha_owner;

ALTER TABLE sales.credit_sales
    ADD COLUMN customer_code_snapshot text,
    ADD COLUMN customer_name_snapshot text,
    ADD COLUMN customer_tax_id_snapshot text,
    ADD COLUMN customer_address_snapshot text;

ALTER TABLE receivables.customer_payments
    ADD COLUMN customer_code_snapshot text,
    ADD COLUMN customer_name_snapshot text,
    ADD COLUMN customer_tax_id_snapshot text,
    ADD COLUMN customer_address_snapshot text;

-- Backfill any S4 rows created before this hardening migration.
UPDATE sales.credit_sales cs
SET customer_code_snapshot = c.code,
    customer_name_snapshot = c.name,
    customer_tax_id_snapshot = c.tax_id,
    customer_address_snapshot = c.address
FROM receivables.customers c
WHERE c.id = cs.customer_id;

UPDATE receivables.customer_payments cp
SET customer_code_snapshot = c.code,
    customer_name_snapshot = c.name,
    customer_tax_id_snapshot = c.tax_id,
    customer_address_snapshot = c.address
FROM receivables.customers c
WHERE c.id = cp.customer_id;

ALTER TABLE sales.credit_sales
    ALTER COLUMN customer_code_snapshot SET NOT NULL,
    ALTER COLUMN customer_name_snapshot SET NOT NULL;

ALTER TABLE receivables.customer_payments
    ALTER COLUMN customer_code_snapshot SET NOT NULL,
    ALTER COLUMN customer_name_snapshot SET NOT NULL;

CREATE FUNCTION receivables.populate_customer_document_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_code text;
    v_name text;
    v_tax_id text;
    v_address text;
BEGIN
    SELECT code, name, tax_id, address
    INTO v_code, v_name, v_tax_id, v_address
    FROM receivables.customers
    WHERE id = NEW.customer_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'customer not found for document snapshot'
            USING ERRCODE = '22023';
    END IF;

    NEW.customer_code_snapshot := v_code;
    NEW.customer_name_snapshot := v_name;
    NEW.customer_tax_id_snapshot := v_tax_id;
    NEW.customer_address_snapshot := v_address;
    RETURN NEW;
END;
$$;

CREATE TRIGGER credit_sales_customer_snapshot
    BEFORE INSERT ON sales.credit_sales
    FOR EACH ROW EXECUTE FUNCTION receivables.populate_customer_document_snapshot();

CREATE TRIGGER customer_payments_customer_snapshot
    BEFORE INSERT ON receivables.customer_payments
    FOR EACH ROW EXECUTE FUNCTION receivables.populate_customer_document_snapshot();

REVOKE ALL ON FUNCTION receivables.populate_customer_document_snapshot() FROM PUBLIC;

RESET ROLE;
