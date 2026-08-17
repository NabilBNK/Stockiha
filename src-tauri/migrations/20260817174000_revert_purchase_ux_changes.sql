-- Revert the abandoned purchase UX additions while preserving an append-only
-- SQLx migration history for existing local databases.
SET ROLE stockiha_owner;

DROP FUNCTION IF EXISTS procurement.confirm_direct_purchase_with_costs(text, uuid, bytea, bigint, bigint, date, text, jsonb, jsonb);
DROP TABLE IF EXISTS procurement.purchase_receipt_additional_costs;
DROP FUNCTION IF EXISTS procurement.list_purchase_receipts_ux(text, bigint, date, date, text, integer, integer);
DROP FUNCTION IF EXISTS procurement.get_purchase_dashboard(text, date, date);

RESET ROLE;
