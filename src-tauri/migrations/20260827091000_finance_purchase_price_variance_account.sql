-- WS-B-1 final gap (continued): seed the PURCHASE_PRICE_VARIANCE account and
-- its role mapping. Runs after the enum value from the prior migration has
-- committed, so it is safe to use here.
--
-- Deliberately its own account under heading 65, not merged into
-- PROCUREMENT_VARIANCE (658): a purchase-price variance (invoice cost vs.
-- GRNI/receipt cost) and a landed-cost allocation variance are different
-- economic events and must not share a bucket -- same reasoning already
-- applied to keep INVENTORY_ADJUSTMENT_LOSS (657) separate from 658.
--
-- scf_code 659 is PROVISIONAL pending accountant confirmation, same as every
-- other code in this chart -- postings reference finance.accounts.id, never
-- scf_code, so this is non-blocking and correctable later with a one-field
-- update and zero effect on posted history.
SET ROLE stockiha_owner;

INSERT INTO finance.accounts
    (scf_code, legacy_code, name_fr, name_en, account_type, normal_balance, parent_id, is_postable, is_control, control_kind)
VALUES
    ('659', 'PURCHASE_PRICE_VARIANCE', 'Ecarts sur prix d''achat', 'Purchase price variance', 'expense', 'debit',
        (SELECT id FROM finance.accounts WHERE scf_code = '65'), true, false, NULL)
ON CONFLICT (scf_code) DO NOTHING;

INSERT INTO finance.account_role_mappings (role_code, account_code, description)
VALUES ('PURCHASE_PRICE_VARIANCE', 'PURCHASE_PRICE_VARIANCE', 'Purchase price variance (invoice vs. receipt cost)')
ON CONFLICT (role_code) DO NOTHING;

RESET ROLE;
