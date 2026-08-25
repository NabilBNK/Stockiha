-- WS-B-1 step 1 of 3 (continued): seed the chart of accounts and re-point
-- finance.require_account_role() to read from it.
--
-- SAFETY: finance.require_account_role() must return the exact same text
-- values after this migration as before it (verified separately against the
-- running database — see docs/audits/). Only its data source changes, from
-- finance.account_role_mappings to finance.accounts.legacy_code. The enum
-- finance.account_role_code and the finance.account_role_mappings table are
-- left untouched, as is finance.opening_state_allowed_accounts.
--
-- SCF codes below are provisional pending accountant confirmation. That is
-- the entire reason finance.accounts has an internal id distinct from
-- scf_code: the code can be corrected later without touching anything that
-- references the account by id.
SET ROLE stockiha_owner;

-- Headings: non-postable, no parent, no legacy_code (nothing posts to these
-- directly), no control_kind.
INSERT INTO finance.accounts
    (scf_code, legacy_code, name_fr, name_en, account_type, normal_balance, parent_id, is_postable, is_control, control_kind)
VALUES
    ('10', NULL, 'Capital et réserves',                   'Capital and reserves',            'equity',    'credit', NULL, false, false, NULL),
    ('11', NULL, 'Report à nouveau',                       'Retained earnings carried forward','equity',   'credit', NULL, false, false, NULL),
    ('16', NULL, 'Emprunts et dettes assimilées',          'Borrowings and similar debts',    'liability', 'credit', NULL, false, false, NULL),
    ('3',  NULL, 'Stocks',                                 'Inventories',                      'asset',     'debit',  NULL, false, false, NULL),
    ('40', NULL, 'Fournisseurs et comptes rattachés',      'Suppliers and related accounts',  'liability', 'credit', NULL, false, false, NULL),
    ('41', NULL, 'Clients et comptes rattachés',           'Customers and related accounts',  'asset',     'debit',  NULL, false, false, NULL),
    ('44', NULL, 'État et collectivités publiques',        'State and public bodies',         'liability', 'credit', NULL, false, false, NULL),
    ('46', NULL, 'Débiteurs et créditeurs divers',         'Sundry debtors and creditors',    'asset',     'debit',  NULL, false, false, NULL),
    ('51', NULL, 'Banques et établissements financiers',   'Banks and financial institutions','asset',     'debit',  NULL, false, false, NULL),
    ('53', NULL, 'Caisse',                                 'Cash',                             'asset',     'debit',  NULL, false, false, NULL),
    ('60', NULL, 'Achats consommés',                       'Purchases consumed',              'expense',   'debit',  NULL, false, false, NULL),
    ('65', NULL, 'Autres charges opérationnelles',         'Other operating expenses',        'expense',   'debit',  NULL, false, false, NULL),
    ('70', NULL, 'Ventes de marchandises',                 'Sales of goods',                  'revenue',   'credit', NULL, false, false, NULL)
ON CONFLICT (scf_code) DO NOTHING;

-- Postable accounts: parent resolved by scf_code lookup so this block is
-- order-independent and safe to re-run.
INSERT INTO finance.accounts
    (scf_code, legacy_code, name_fr, name_en, account_type, normal_balance, parent_id, is_postable, is_control, control_kind)
VALUES
    ('30',  'INVENTORY_MERCHANDISE',       'Stocks de marchandises',                        'Merchandise inventory',              'asset',     'debit',  (SELECT id FROM finance.accounts WHERE scf_code = '3'),  true, true,  'inventory'),
    ('401', 'ACCOUNTS_PAYABLE',            'Fournisseurs de stocks et services',            'Trade suppliers',                    'liability', 'credit', (SELECT id FROM finance.accounts WHERE scf_code = '40'), true, true,  'ap'),
    ('408', 'GOODS_RECEIVED_NOT_INVOICED', 'Fournisseurs - factures non parvenues',         'Suppliers - invoices not received',  'liability', 'credit', (SELECT id FROM finance.accounts WHERE scf_code = '40'), true, false, NULL),
    ('411', 'ACCOUNTS_RECEIVABLE',         'Clients',                                        'Customers',                          'asset',     'debit',  (SELECT id FROM finance.accounts WHERE scf_code = '41'), true, true,  'ar'),
    ('445', 'TAX_PAYABLE',                 'État - taxes sur le chiffre d''affaires',       'State - turnover taxes',             'liability', 'credit', (SELECT id FROM finance.accounts WHERE scf_code = '44'), true, false, NULL),
    ('462', 'OTHER_ASSET',                 'Débiteurs divers',                              'Sundry debtors',                     'asset',     'debit',  (SELECT id FROM finance.accounts WHERE scf_code = '46'), true, false, NULL),
    ('463', 'OTHER_LIABILITY',             'Créditeurs divers',                             'Sundry creditors',                   'liability', 'credit', (SELECT id FROM finance.accounts WHERE scf_code = '46'), true, false, NULL),
    ('512', 'BANK_ACCOUNT',                'Banques - comptes courants',                    'Banks - current accounts',           'asset',     'debit',  (SELECT id FROM finance.accounts WHERE scf_code = '51'), true, true,  'bank'),
    ('530', 'CASH_DESK',                   'Caisse',                                         'Cash on hand',                       'asset',     'debit',  (SELECT id FROM finance.accounts WHERE scf_code = '53'), true, true,  'cash'),
    ('600', 'COGS',                        'Achats de marchandises vendues',                'Cost of goods sold',                 'expense',   'debit',  (SELECT id FROM finance.accounts WHERE scf_code = '60'), true, false, NULL),
    ('658', 'PROCUREMENT_VARIANCE',        'Autres charges opérationnelles',                'Procurement and landed-cost variance','expense',  'debit',  (SELECT id FROM finance.accounts WHERE scf_code = '65'), true, false, NULL),
    ('700', 'SALES_REVENUE',               'Ventes de marchandises',                        'Sales of goods',                     'revenue',   'credit', (SELECT id FROM finance.accounts WHERE scf_code = '70'), true, false, NULL),
    ('101', 'OWNER_CAPITAL',               'Capital émis',                                  'Issued capital',                     'equity',    'credit', (SELECT id FROM finance.accounts WHERE scf_code = '10'), true, false, NULL),
    ('110', 'RETAINED_EARNINGS',           'Report à nouveau',                              'Retained earnings',                  'equity',    'credit', (SELECT id FROM finance.accounts WHERE scf_code = '11'), true, false, NULL),
    ('164', 'LOAN_PAYABLE',                'Emprunts auprès des établissements de crédit',  'Loans from credit institutions',     'liability', 'credit', (SELECT id FROM finance.accounts WHERE scf_code = '16'), true, false, NULL)
ON CONFLICT (scf_code) DO NOTHING;

-- Re-point require_account_role at finance.accounts via legacy_code. Same
-- signature, same return type, same exception behaviour, same text values.
CREATE OR REPLACE FUNCTION finance.require_account_role(p_role finance.account_role_code)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_legacy_code text;
    v_account_code text;
BEGIN
    SELECT m.account_code
    INTO v_legacy_code
    FROM finance.account_role_mappings m
    WHERE m.role_code = p_role
      AND m.is_active;

    IF v_legacy_code IS NOT NULL THEN
        SELECT a.legacy_code
        INTO v_account_code
        FROM finance.accounts a
        WHERE a.legacy_code = v_legacy_code
          AND a.is_active;
    END IF;

    IF v_account_code IS NULL THEN
        RAISE EXCEPTION 'ACCOUNT_ROLE_NOT_CONFIGURED: required account role % is unavailable', p_role
            USING ERRCODE = '55000';
    END IF;

    RETURN v_account_code;
END;
$$;

-- Steps 2 and 3 will use this to resolve a legacy code to the internal id.
-- Never returns NULL: an unknown or inactive code is always an exception.
CREATE OR REPLACE FUNCTION finance.resolve_account_id(p_legacy_code text)
RETURNS bigint
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_id bigint;
BEGIN
    SELECT a.id
    INTO v_id
    FROM finance.accounts a
    WHERE a.legacy_code = p_legacy_code
      AND a.is_active;

    IF v_id IS NULL THEN
        RAISE EXCEPTION 'ACCOUNT_NOT_FOUND: no active account with legacy code %', p_legacy_code
            USING ERRCODE = '55000';
    END IF;

    RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION finance.resolve_account_id(text) FROM PUBLIC;

RESET ROLE;
