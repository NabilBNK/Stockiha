-- WS-B-1 gap fix: seed the two chart-of-accounts rows a live stock-adjustment
-- posting already needs (INVENTORY_ADJUSTMENT_LOSS, exercised once in this
-- database) and its symmetric gain counterpart (INVENTORY_ADJUSTMENT_GAIN,
-- not yet exercised but reachable via the same function's other branch), plus
-- the new SCF heading the gain side requires.
--
-- Losses and gains are kept on opposite sides of the SCF class split (65
-- "other operating charges" / 75 "other operating income") rather than as a
-- credit-normal contra-expense under 65 alone: Step 1's own
-- accounts_normal_balance_matches_type constraint requires expense accounts
-- to be debit-normal, and introducing a contra-expense would need a new
-- is_contra column and a rewritten constraint just to seed one row. The
-- 65/75 split needs no schema change and is the SCF-native shape.
--
-- Does NOT seed PURCHASE_PRICE_VARIANCE: that literal is written only by code
-- paths that currently call the nonexistent finance.add_journal_line (see the
-- Part A missing-function sweep in this task's report), so its classification
-- is deferred until that separate defect is fixed and the two decisions can
-- be made together.
SET ROLE stockiha_owner;

INSERT INTO finance.accounts
    (scf_code, legacy_code, name_fr, name_en, account_type, normal_balance, parent_id, is_postable, is_control, control_kind)
VALUES
    ('75', NULL, 'Autres produits opérationnels', 'Other operating income', 'revenue', 'credit', NULL, false, false, NULL)
ON CONFLICT (scf_code) DO NOTHING;

INSERT INTO finance.accounts
    (scf_code, legacy_code, name_fr, name_en, account_type, normal_balance, parent_id, is_postable, is_control, control_kind)
VALUES
    ('657', 'INVENTORY_ADJUSTMENT_LOSS', 'Pertes sur ajustements d''inventaire', 'Inventory adjustment losses', 'expense', 'debit',
        (SELECT id FROM finance.accounts WHERE scf_code = '65'), true, false, NULL),
    ('758', 'INVENTORY_ADJUSTMENT_GAIN', 'Gains sur ajustements d''inventaire', 'Inventory adjustment gains', 'revenue', 'credit',
        (SELECT id FROM finance.accounts WHERE scf_code = '75'), true, false, NULL)
ON CONFLICT (scf_code) DO NOTHING;

RESET ROLE;
