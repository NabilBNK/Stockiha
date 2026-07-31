-- S4-002: complete the Bank of Algeria denomination set used by blind cash
-- counting with the 1/2 DA and 1/4 DA coins. Monetary storage already uses
-- numeric(14,2), so both denominations remain exact.
SET ROLE stockiha_owner;

INSERT INTO cash.denominations (code, value, display_order) VALUES
    ('DZD_0_50', 0.50, 120),
    ('DZD_0_25', 0.25, 130)
ON CONFLICT (code) DO NOTHING;

RESET ROLE;
