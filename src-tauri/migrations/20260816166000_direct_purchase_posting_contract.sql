-- Direct Purchase MVP posting boundary.
--
-- The operator-facing Direct Purchase command posts only the physical receipt,
-- inventory valuation and GRNI journal. Supplier invoice/AP, supplier payment
-- and landed-cost operations remain explicit downstream business events.
--
-- Keep the historical aggregate purchase transaction function in the schema for
-- compatibility/audit, but remove its runtime execution grant so it cannot
-- silently recreate the old receipt+invoice+payment orchestration in the MVP.

SET ROLE stockiha_owner;

REVOKE ALL ON FUNCTION inventory.confirm_direct_purchase_receipt(
    text,uuid,bytea,bigint,bigint,bigint,date,jsonb,text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inventory.confirm_direct_purchase_receipt(
    text,uuid,bytea,bigint,bigint,bigint,date,jsonb,text
) TO stockiha_runtime;

REVOKE EXECUTE ON FUNCTION procurement.post_purchase_transaction(
    text,uuid,bytea,jsonb
) FROM stockiha_runtime;

UPDATE operations.schema_state
SET migration_version = 20260816166000,
    updated_at = now()
WHERE singleton;

RESET ROLE;
