-- WS-B-1 final gap: add PURCHASE_PRICE_VARIANCE to finance.account_role_code.
--
-- This migration does ONLY the enum addition, in its own transaction/file.
-- PostgreSQL will not let a newly added enum value be used (e.g. in an INSERT
-- into a column of that type) inside the same transaction that added it --
-- ALTER TYPE ... ADD VALUE commits its own catalog change but the new label
-- is not visible to other commands in the same transaction until that
-- transaction ends. The seed (account_role_mappings row using this value)
-- is therefore a separate, later migration file.
SET ROLE stockiha_owner;

ALTER TYPE finance.account_role_code ADD VALUE IF NOT EXISTS 'PURCHASE_PRICE_VARIANCE';

RESET ROLE;
