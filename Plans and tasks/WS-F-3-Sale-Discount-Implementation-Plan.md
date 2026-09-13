# WS-F-3 — Fixed-Amount Discount on a Sale

**Workstream:** WS-F — POS, Sales & Cash Operations
**Sub-plan:** 3 of 5
**Executing agent:** Gemini (Antigravity IDE)
**Base branch:** the branch WS-F-2 landed on — **the owner will write its exact name here before you start:** `________________`
**Branch to create:** `task/ws-f-3-sale-discount`
**Risk class:** HIGHEST in WS-F. This replaces the cash-sale posting function, changes what the shop earns, and changes what goes in the drawer.

---

## 0. Authority, precedence, and the override you are being given

Read in this order before touching anything:

1. This document.
2. `GEMINI.md`
3. `AGENTS.md`

This document wins where they differ.

**Explicit, limited override of `GEMINI.md` section 2.** This task drops and recreates `sales.confirm_cash_sale` — the function that records every cash sale, moves stock, writes the journal and puts money in the drawer. It also adds a ledger account and a permission. `GEMINI.md` tells you to refuse all of it. You may proceed **only** because the complete replacement function is written out below, line for line.

The condition attached to that override, and it is absolute here:

> **Copy the SQL exactly. Do not shorten it, do not reorder it, do not "clean it up", do not skip a comment, do not change a variable name, do not change a rounding call.**

The function below is the existing, working, tested cash-sale function with four small additions. If you retype it from memory or paraphrase any part of it, you will silently break how the shop's stock, revenue and cash are recorded, and nobody will notice until the accounts are wrong. If something fails, **report it** — do not repair it by editing the logic.

If any file does not look the way this plan describes, **stop and report the difference**.

---

## 1. Repository safety — do this first

```bash
git branch --show-current
git rev-parse HEAD
git status --short
git fetch origin --prune
```

If `git status --short` shows changes that are not yours, **STOP** and report. Never reset, clean, stash, or discard.

Check out the base branch named at the top of this document, pull it, then:

```bash
git checkout -b task/ws-f-3-sale-discount
```

If the base branch name is still blank at the top of this document, **stop and ask the owner.** Do not guess.

---

## 2. Background — what a discount does to the books

Read this so you understand what you are building. You still may not change the design.

The cashier knocks 200 DZD off a 5,000 DZD sale. Three numbers move, and they do not all move the same way:

- The shop still **sold** 5,000 DZD of goods. That is the revenue.
- The customer **paid** 4,800 DZD. That is what goes in the drawer.
- The 200 DZD difference is a **discount given** — a real cost of doing business, recorded in its own account so the owner can see at the end of the month how much he gave away.

So the journal is:

```
Debit  Cash                4,800.00
Debit  Discounts given       200.00
Credit Sales revenue                 5,000.00
```

The cost-of-goods side is untouched. A discount changes what the customer pays, not what the goods cost the shop.

**Rulings you must not deviate from:**

- The discount is a **fixed amount in dinars**, never a percentage. There is no percentage field anywhere in this sub-plan.
- The discount applies to the **whole sale**, not to a line. There is no per-line discount.
- The discount may never exceed the sale subtotal. A sale total may reach zero but never go below it.
- The discount is stored with two decimals, like every other amount.
- Cost of goods sold and the stock movement are computed exactly as they are today. Do not touch them.
- The discount applies to **cash sales only** in this sub-plan. Credit sales keep the full price. Discounts on credit sales are WS-F-4, together with the credit-limit change, because both require rewriting a different posting function.

---

## 3. Objective

Let an authorised user take a fixed number of dinars off a sale at the till, and record that correctly in the stock, the drawer and the ledger.

---

## 4. Scope — IN

Eight tasks, in this order. Do not reorder them.

---

### T1 — The migration

Create **one** new file, exactly at this path:

```
src-tauri/migrations/20260914090000_ws_f_003_sale_discount.sql
```

Copy the content below verbatim.

**Before you write it, verify the starting point.** Run this and read the output:

```bash
grep -c "" src-tauri/migrations/20260826091000_sales_confirm_cash_sale_account_id.sql
```

The function you are replacing lives in that file. The version below is that same function with the discount added. If you find yourself wanting to change anything in it beyond what the `WS-F-003` comments mark, **stop and report**.

```sql
-- WS-F-003: fixed-amount discount on a cash sale.
--
-- A discount reduces what the customer pays and what enters the drawer, but
-- not what the shop sold. Revenue is credited gross; the discount is debited
-- to its own account so it can be reported. Cost of goods sold and the stock
-- movement are unchanged -- a discount does not change what the goods cost.
--
-- sales.confirm_cash_sale is DROPPED and recreated with one extra parameter
-- rather than overloaded, so that only one version of this logic can ever be
-- called. The body below is the existing WS-B-1 version with four additions,
-- each marked WS-F-003.

SET ROLE stockiha_owner;

-- =============================================================================
-- 1. Permission: who may discount
-- =============================================================================

INSERT INTO iam.permissions (code, name) VALUES
    ('APPLY_SALE_DISCOUNT', 'Apply a fixed-amount discount to a sale')
ON CONFLICT (code) DO NOTHING;

INSERT INTO iam.role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM iam.roles role
CROSS JOIN iam.permissions permission
WHERE role.code IN ('MANAGER', 'ADMIN')
  AND permission.code = 'APPLY_SALE_DISCOUNT'
ON CONFLICT DO NOTHING;

-- =============================================================================
-- 2. Ledger account for discounts given (SCF 709)
-- =============================================================================

INSERT INTO finance.accounts
    (scf_code, legacy_code, name_fr, name_en, account_type, normal_balance, parent_id, is_postable, is_control, control_kind)
VALUES
    ('709', 'SALES_DISCOUNT', 'Rabais, remises et ristournes accordés', 'Discounts granted on sales',
     'revenue', 'debit', (SELECT id FROM finance.accounts WHERE scf_code = '70'), true, false, NULL)
ON CONFLICT (scf_code) DO NOTHING;

-- =============================================================================
-- 3. Sale header gains a discount column
-- =============================================================================

ALTER TABLE sales.cash_sales
    ADD COLUMN IF NOT EXISTS discount_amount numeric(14, 2) NOT NULL DEFAULT 0;

-- The original table deliberately asserted total_amount = subtotal and its own
-- comment said a future slice introducing discounts would relax it on purpose.
-- This is that slice.
ALTER TABLE sales.cash_sales
    DROP CONSTRAINT IF EXISTS cash_sales_total_matches_subtotal;

ALTER TABLE sales.cash_sales
    DROP CONSTRAINT IF EXISTS cash_sales_discount_non_negative;
ALTER TABLE sales.cash_sales
    ADD CONSTRAINT cash_sales_discount_non_negative CHECK (discount_amount >= 0);

ALTER TABLE sales.cash_sales
    DROP CONSTRAINT IF EXISTS cash_sales_discount_within_subtotal;
ALTER TABLE sales.cash_sales
    ADD CONSTRAINT cash_sales_discount_within_subtotal CHECK (discount_amount <= subtotal);

ALTER TABLE sales.cash_sales
    DROP CONSTRAINT IF EXISTS cash_sales_total_is_subtotal_less_discount;
ALTER TABLE sales.cash_sales
    ADD CONSTRAINT cash_sales_total_is_subtotal_less_discount
    CHECK (total_amount = subtotal - discount_amount);

-- =============================================================================
-- 4. Replace the cash-sale posting function
-- =============================================================================

DROP FUNCTION IF EXISTS sales.confirm_cash_sale(text, uuid, bytea, bigint, bigint, bigint, date, jsonb);

CREATE FUNCTION sales.confirm_cash_sale(
    p_session_token text,
    p_request_id uuid,
    p_payload_hash bytea,
    p_cash_session_id bigint,
    p_warehouse_id bigint,
    p_fiscal_period_id bigint,
    p_document_date date,
    p_lines jsonb,
    p_discount_amount numeric DEFAULT 0
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
    v_user_id bigint;
    v_cached_result bigint;
    v_session_status text;
    v_session_warehouse_id bigint;
    v_period_status text;
    v_period_start date;
    v_period_end date;
    v_fiscal_year integer;
    v_document_id bigint;
    v_journal_document_id bigint;
    v_line jsonb;
    v_line_number integer := 0;
    v_variant_id bigint;
    v_quantity numeric;
    v_unit_price numeric;
    v_variant_active boolean;
    v_variant_sku text;
    v_variant_name text;
    v_qty_on_hand numeric;
    v_position_value numeric;
    v_wac numeric;
    v_new_qty numeric;
    v_new_value numeric;
    v_unit_cost_snapshot numeric;
    v_line_total numeric;
    v_subtotal numeric(14, 2) := 0;
    v_total_cogs numeric(18, 4) := 0;
    v_gen_job bigint;
    v_print_job bigint;
    v_drawer_job bigint;
    v_movement_id bigint;
    v_residual_journal_id bigint;
    v_sequence bigint;
    v_document_number text;
    -- WS-F-003 addition 1 of 4: discount state.
    v_discount numeric(14, 2);
    v_net_total numeric(14, 2);
    v_journal_line_number integer;
BEGIN
    -- 1. Session + permission (never trusts a caller-supplied actor id).
    SELECT user_id INTO v_user_id
        FROM iam.resolve_session_with_permission(p_session_token, 'POST_CASH_SALE');

    -- 2. Idempotency.
    v_cached_result := core.reserve_idempotent_request(
        'sales.confirm_cash_sale', p_request_id, p_payload_hash
    );
    IF v_cached_result IS NOT NULL THEN
        RETURN v_cached_result;
    END IF;

    -- WS-F-003 addition 2 of 4: validate the discount and, if there is one,
    -- require the discount permission on top of POST_CASH_SALE. A sale with no
    -- discount is unaffected and any cashier may still post it.
    v_discount := coalesce(p_discount_amount, 0)::numeric(14, 2);
    IF v_discount < 0 THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: discount must not be negative' USING ERRCODE = '22023';
    END IF;
    IF v_discount <> round(v_discount, 2) THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: discount must have at most two decimals'
            USING ERRCODE = '22023';
    END IF;
    IF v_discount > 0 THEN
        PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'APPLY_SALE_DISCOUNT');
    END IF;

    -- 3. Cash session validation.
    SELECT status, warehouse_id
        INTO v_session_status, v_session_warehouse_id
        FROM sales.cash_sessions
        WHERE id = p_cash_session_id
        FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'cash session % not found', p_cash_session_id USING ERRCODE = '22023';
    END IF;
    IF v_session_status <> 'OPEN' THEN
        RAISE EXCEPTION 'cash session % is not open', p_cash_session_id USING ERRCODE = '55000';
    END IF;
    IF v_session_warehouse_id <> p_warehouse_id THEN
        RAISE EXCEPTION 'warehouse mismatch between cash session and sale'
            USING ERRCODE = '22023';
    END IF;

    -- 4. Fiscal period must be OPEN and must contain the document date.
    SELECT status, starts_on, ends_on, extract(year FROM starts_on)::integer
        INTO v_period_status, v_period_start, v_period_end, v_fiscal_year
        FROM finance.fiscal_periods
        WHERE id = p_fiscal_period_id
        FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'fiscal period % not found', p_fiscal_period_id USING ERRCODE = '22023';
    END IF;
    IF v_period_status <> 'OPEN' THEN
        RAISE EXCEPTION 'fiscal period % is not open', p_fiscal_period_id USING ERRCODE = '55000';
    END IF;
    IF p_document_date < v_period_start OR p_document_date > v_period_end THEN
        RAISE EXCEPTION 'document date % is outside fiscal period %', p_document_date, p_fiscal_period_id
            USING ERRCODE = '22023';
    END IF;

    -- 5. Validate non-empty lines.
    IF p_lines IS NULL OR jsonb_array_length(p_lines) = 0 THEN
        RAISE EXCEPTION 'cash sale must have at least one line' USING ERRCODE = '22023';
    END IF;

    -- 5b. Lock all existing touched stock positions in deterministic order.
    -- Without this, two concurrent sales of the same last unit both read the
    -- pre-sale quantity, both pass the sufficiency check below, and the second
    -- UPDATE overwrites the first with a value computed from its stale read --
    -- a lost update that sells the same unit twice. The non-negative CHECK on
    -- inventory.positions cannot catch it because the stored quantity never
    -- goes negative. Ordering by variant_id keeps multi-line sales that touch
    -- an overlapping set of variants from deadlocking against each other.
    -- This mirrors sales.confirm_credit_sale, which already locks this way.
    PERFORM 1
    FROM inventory.positions
    WHERE warehouse_id = p_warehouse_id
      AND variant_id IN (
          SELECT DISTINCT (elem ->> 'variant_id')::bigint
          FROM jsonb_array_elements(p_lines) elem
      )
    ORDER BY variant_id
    FOR UPDATE;

    -- 6. Create sale header (DRAFT).
    INSERT INTO core.business_documents (document_type, document_date, fiscal_period_id, fiscal_year)
        VALUES ('CASH_SALE', p_document_date, p_fiscal_period_id, v_fiscal_year)
        RETURNING id INTO v_document_id;

    INSERT INTO sales.cash_sales (
        document_id, warehouse_id, subtotal, total_amount
    ) VALUES (
        v_document_id, p_warehouse_id, 0, 0
    );

    -- 7. Process each line: validate, issue stock, accumulate COGS. The
    -- positions rows are already locked by step 5b.
    FOR v_line IN SELECT jsonb_array_elements(p_lines)
    LOOP
        v_line_number := v_line_number + 1;
        v_variant_id := (v_line ->> 'variant_id')::bigint;
        v_quantity := (v_line ->> 'quantity')::numeric;
        v_unit_price := (v_line ->> 'unit_price')::numeric;

        IF v_variant_id IS NULL OR v_quantity IS NULL OR v_unit_price IS NULL THEN
            RAISE EXCEPTION 'line % is missing required fields', v_line_number
                USING ERRCODE = '22023';
        END IF;
        IF v_quantity <= 0 THEN
            RAISE EXCEPTION 'line % quantity must be positive', v_line_number
                USING ERRCODE = '22023';
        END IF;
        IF v_unit_price < 0 THEN
            RAISE EXCEPTION 'line % unit price must not be negative', v_line_number
                USING ERRCODE = '22023';
        END IF;

        SELECT pv.is_active, pv.sku, p.name
            INTO v_variant_active, v_variant_sku, v_variant_name
            FROM catalog.product_variants pv
            JOIN catalog.products p ON p.id = pv.product_id
            WHERE pv.id = v_variant_id;
        IF NOT FOUND OR NOT v_variant_active THEN
            RAISE EXCEPTION 'variant % is not found or is inactive', v_variant_id USING ERRCODE = '22023';
        END IF;

        SELECT quantity_on_hand, total_value, last_known_wac
            INTO v_qty_on_hand, v_position_value, v_wac
            FROM inventory.positions
            WHERE warehouse_id = p_warehouse_id AND variant_id = v_variant_id;
        IF NOT FOUND THEN
            v_qty_on_hand := 0;
            v_position_value := 0;
            v_wac := 0;
        END IF;

        -- Reject insufficient stock / prevent negative confirmed stock.
        IF v_qty_on_hand < v_quantity THEN
            RAISE EXCEPTION 'insufficient stock for variant % in warehouse % (have %, need %)',
                v_variant_id, p_warehouse_id, v_qty_on_hand, v_quantity
                USING ERRCODE = '55000';
        END IF;

        -- COGS uses warehouse-specific WAC at the moment of sale.
        v_unit_cost_snapshot := v_wac;
        v_line_total := round(v_quantity * v_unit_price, 2);
        v_subtotal := v_subtotal + v_line_total;
        v_total_cogs := v_total_cogs + round(v_quantity * v_unit_cost_snapshot, 4);

        v_new_qty := v_qty_on_hand - v_quantity;
        v_new_value := v_position_value - round(v_quantity * v_wac, 4);

        -- S2-003: Handle zero-quantity residuals.
        IF v_new_qty = 0 THEN
            -- Check for material residuals (>= 0.01).
            IF abs(v_new_value) >= 0.01 THEN
                RAISE EXCEPTION 'sale line % would result in a material unresolved inventory residual',
                    v_line_number USING ERRCODE = '55000';
            END IF;
        ELSIF v_new_value < 0 THEN
            RAISE EXCEPTION 'sale line % would make inventory value negative', v_line_number
                USING ERRCODE = '55000';
        END IF;

        UPDATE inventory.positions
            SET quantity_on_hand = v_new_qty,
                total_value = CASE WHEN v_new_qty = 0 THEN 0 ELSE v_new_value END
            WHERE warehouse_id = p_warehouse_id AND variant_id = v_variant_id;

        INSERT INTO inventory.movements (
            warehouse_id, variant_id, movement_type, quantity_delta, inventory_value_delta,
            resulting_quantity_on_hand, resulting_total_value, reference_type, reference_id
        ) VALUES (
            p_warehouse_id, v_variant_id, 'ISSUE', -v_quantity, -round(v_quantity * v_wac, 4),
            v_new_qty, CASE WHEN v_new_qty = 0 THEN 0 ELSE v_new_value END, 'CASH_SALE_LINE', v_document_id
        ) RETURNING id INTO v_movement_id;

        -- S2-003: Handle residual clearance if qty=0 with residual remaining.
        IF v_new_qty = 0 AND v_new_value <> 0 THEN
            v_residual_journal_id := inventory._handle_residual_at_zero_quantity(
                p_warehouse_id, v_variant_id, v_movement_id, v_new_value,
                p_fiscal_period_id, p_document_date
            );
        END IF;

        INSERT INTO sales.cash_sale_lines (
            document_id, line_number, variant_id, variant_sku_snapshot, variant_name_snapshot,
            quantity, unit_price, unit_cost_snapshot, line_total
        ) VALUES (
            v_document_id, v_line_number, v_variant_id, v_variant_sku, v_variant_name,
            v_quantity, v_unit_price, v_unit_cost_snapshot, v_line_total
        );
    END LOOP;

    -- WS-F-003 addition 3 of 4: the discount may not exceed what was sold, and
    -- the net total is what the customer actually pays.
    IF v_discount > v_subtotal THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: discount exceeds the sale total'
            USING ERRCODE = '22023';
    END IF;
    v_net_total := v_subtotal - v_discount;

    -- 8. Finalize the sale header's exact totals.
    UPDATE sales.cash_sales
        SET subtotal = v_subtotal,
            discount_amount = v_discount,
            total_amount = v_net_total
        WHERE document_id = v_document_id;

    -- 9. Balanced journal -- revenue is credited gross, the discount is debited
    -- to its own account, and cash receives only the net. COGS is unchanged.
    INSERT INTO core.business_documents (document_type, document_date, fiscal_period_id, fiscal_year)
        VALUES ('JOURNAL_ENTRY', p_document_date, p_fiscal_period_id, v_fiscal_year)
        RETURNING id INTO v_journal_document_id;

    INSERT INTO finance.journal_entries (document_id, description, source_type, source_id)
        VALUES (v_journal_document_id, 'Cash sale', 'CASH_SALE', v_document_id);

    -- WS-F-003 addition 4 of 4: three-line revenue posting when a discount is
    -- present, otherwise exactly the two lines that were posted before.
    INSERT INTO finance.journal_lines (document_id, line_number, account_code, account_id, debit, credit) VALUES
        (v_journal_document_id, 1, 'CASH_DESK', finance.resolve_account_id('CASH_DESK'), v_net_total, 0);

    v_journal_line_number := 2;

    IF v_discount > 0 THEN
        INSERT INTO finance.journal_lines (document_id, line_number, account_code, account_id, debit, credit) VALUES
            (v_journal_document_id, v_journal_line_number, 'SALES_DISCOUNT', finance.resolve_account_id('SALES_DISCOUNT'), v_discount, 0);
        v_journal_line_number := v_journal_line_number + 1;
    END IF;

    INSERT INTO finance.journal_lines (document_id, line_number, account_code, account_id, debit, credit) VALUES
        (v_journal_document_id, v_journal_line_number, 'SALES_REVENUE', finance.resolve_account_id('SALES_REVENUE'), 0, v_subtotal);

    v_journal_line_number := v_journal_line_number + 1;

    IF v_total_cogs > 0 THEN
        INSERT INTO finance.journal_lines (document_id, line_number, account_code, account_id, debit, credit) VALUES
            (v_journal_document_id, v_journal_line_number, 'COGS', finance.resolve_account_id('COGS'), round(v_total_cogs, 2), 0),
            (v_journal_document_id, v_journal_line_number + 1, 'INVENTORY_MERCHANDISE', finance.resolve_account_id('INVENTORY_MERCHANDISE'), 0, round(v_total_cogs, 2));
    END IF;

    -- 10. Allocate both official document numbers inside this same transaction, then post.
    v_sequence := core.claim_next_document_number('CASH_SALE', v_fiscal_year);
    v_document_number := 'VC-' || v_fiscal_year || '-' || lpad(v_sequence::text, 6, '0');
    UPDATE core.business_documents
        SET status = 'POSTED', sequence_number = v_sequence, document_number = v_document_number, posted_at = now()
        WHERE id = v_document_id;

    v_sequence := core.claim_next_document_number('JOURNAL_ENTRY', v_fiscal_year);
    v_document_number := 'JE-' || v_fiscal_year || '-' || lpad(v_sequence::text, 6, '0');
    UPDATE core.business_documents
        SET status = 'POSTED', sequence_number = v_sequence, document_number = v_document_number, posted_at = now()
        WHERE id = v_journal_document_id;

    -- 11. Record the cash movement -- the drawer receives the net, not the gross.
    INSERT INTO cash.movements (cash_session_id, business_document_id, movement_type, amount)
        VALUES (p_cash_session_id, v_document_id, 'SALE', v_net_total);

    -- 12. Enqueue document generation + receipt printing (inside this same transaction) and drawer pulse.
    SELECT generation_job_id, print_job_id INTO v_gen_job, v_print_job
        FROM documents.enqueue_receipt_jobs(v_document_id, 'cash_sale_receipt:' || v_document_id);

    v_drawer_job := cash.enqueue_drawer_job(
        p_cash_session_id, v_document_id, 'cash_sale_drawer:' || v_document_id
    );

    -- 13. Record the idempotent result and return it.
    PERFORM core.record_idempotent_result('sales.confirm_cash_sale', p_request_id, v_document_id);

    RETURN v_document_id;
END;
$function$;

-- =============================================================================
-- 5. Privileges
-- =============================================================================

REVOKE ALL ON FUNCTION sales.confirm_cash_sale(text, uuid, bytea, bigint, bigint, bigint, date, jsonb, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sales.confirm_cash_sale(text, uuid, bytea, bigint, bigint, bigint, date, jsonb, numeric) TO stockiha_runtime;

RESET ROLE;
```

---

### T2 — Rust

**2a.** Find the service function that calls `sales.confirm_cash_sale`:

```bash
grep -rn "confirm_cash_sale" src-tauri/src
```

**2b.** In the payload struct that function takes, add one field at the **end** of the struct:

```rust
    pub discount_amount: Option<String>,
```

**2c.** In the service function:

- parse it the same way other money strings are parsed in that file, into an `Option<Decimal>`, defaulting to `Decimal::ZERO` when absent or empty
- add `"discount_amount": payload.discount_amount` to the canonical JSON that feeds `payload_hash`, as the **last** key
- add one `.bind(...)` for the discount, as the **last** bind, and add `$9` to the SQL string so it reads `SELECT sales.confirm_cash_sale($1, $2, $3, $4, $5, $6, $7, $8, $9)`

The discount must be inside the idempotency hash. Two otherwise identical sales that differ only by discount are different sales, and leaving it out would let a retry replay the wrong one.

**2d.** In the Tauri command for the cash sale, nothing changes — it passes the payload struct through. Confirm that is true; if the command spells out each field instead, add `discount_amount` in the same style.

Do not change the command's name, the return type, or anything about the credit-sale path.

---

### T3 — TypeScript IPC layer

In `src/shared/ipc/dto.ts`, add to the existing cash-sale payload interface, as the last field:

```ts
  discount_amount: string | null;
```

In `src/shared/ipc/gateway.ts`, pass it through in the existing `confirmCashSale` function, matching the casing convention that function already uses for its other fields.

Add nothing else. Do not create a new command.

---

### T4 — The discount control at the till

All edits are in `src/features/pos/PosScreen.tsx`.

**4a.** Add state:

```tsx
const [discount, setDiscount] = useState('');
const [discountOpen, setDiscountOpen] = useState(false);
```

**4b.** Read the permission. The POS already loads capabilities for the credit flow — find how `can_override_credit_limit` reaches this screen and read `can_apply_sale_discount` the same way. You will need to add `can_apply_sale_discount` to the customer-capabilities read path:

```bash
grep -rn "can_override_credit_limit" src-tauri/migrations/*.sql src/shared/ipc/customerDto.ts src-tauri/src
```

Add `'can_apply_sale_discount', <the same permission-check expression the others use, with 'APPLY_SALE_DISCOUNT'>` to that capabilities function in a **new migration section inside the T1 file** — append it to the T1 migration, in its own clearly commented block, using `CREATE OR REPLACE FUNCTION` and reproducing that function in full exactly as it currently exists plus the one new key. Then add `can_apply_sale_discount: boolean;` to the `CustomerCapabilities` interface and to the Rust struct behind it.

If reproducing that function in full is not possible because you cannot find its current definition, **stop and report** rather than guessing.

**4c.** Add the exact-decimal validator and the net total. Immediately after the existing `provisionalTotal` memo:

```tsx
  const discountValid = useMemo(() => {
    const value = discount.trim();
    if (value === '') return true;
    if (!/^\d+(\.\d{1,2})?$/.test(value)) return false;
    return addExactMoney([provisionalTotal, `-${value}`]) >= '0';
  }, [discount, provisionalTotal]);

  const netTotal = useMemo(() => {
    const value = discount.trim();
    if (value === '' || !discountValid) return provisionalTotal;
    return addExactMoney([provisionalTotal, `-${value}`]);
  }, [discount, discountValid, provisionalTotal]);
```

**Stop and check one thing before writing this.** `addExactMoney` came from WS-F-1 and sums decimal strings exactly. Confirm it accepts a negative string such as `-200.00`. Run:

```bash
sed -n '1,60p' src/shared/money/exactMoney.ts
```

Its `splitDecimal` accepts an optional leading `-`, so a negative string is valid input. If that is not what you see, **stop and report** — do not write your own subtraction.

The `>= '0'` comparison above compares strings, which is wrong for this purpose. Replace that line with:

```tsx
    return !addExactMoney([provisionalTotal, `-${value}`]).startsWith('-');
  }, [discount, provisionalTotal]);
```

so the check is "the result is not negative". Use that version.

**4d.** Render the control inside the checkout bar added in WS-F-1, immediately above the total row:

```tsx
{capabilities.can_apply_sale_discount ? (
  <div className="sk-pos__discount" data-testid="pos-discount">
    {discountOpen ? (
      <>
        <label>
          {t('pos.discount')} (DZD)
          <input
            type="text"
            inputMode="decimal"
            className="sk-field__input"
            value={discount}
            onChange={(event) => {
              setDiscount(event.target.value);
              invalidateSaleIntent();
            }}
            data-testid="pos-discount-input"
          />
        </label>
        {!discountValid && (
          <span className="sk-field-error" data-testid="pos-discount-error">
            {t('pos.discountInvalid')}
          </span>
        )}
      </>
    ) : (
      <button
        type="button"
        className="sk-button sk-button--secondary"
        onClick={() => setDiscountOpen(true)}
        data-testid="pos-discount-open"
      >
        {t('pos.addDiscount')}
      </button>
    )}
  </div>
) : null}
```

**4e.** Show the discount in the summary. In the checkout bar, when `discount.trim() !== '' && discountValid`, render one extra row above the total:

```tsx
<div className="sk-cart__summary-row" data-testid="pos-discount-row">
  <span>{t('pos.discount')}</span>
  <span>-{discount.trim()} DZD</span>
</div>
```

and change the existing total row to display `netTotal` instead of `provisionalTotal`. Use the class names the existing summary row already uses.

**4f.** Send it. In `confirmSale`, in the object passed to `confirmCashSale`, add as the last field:

```tsx
        discount_amount: discount.trim() === '' ? null : discount.trim(),
```

**4g.** Block confirmation while the discount is invalid. In the existing `disabled` expression of the Confirm button, add `|| !discountValid`. Change nothing else about that button.

**4h.** Reset `discount` to `''` and `discountOpen` to `false` wherever the cart is already cleared after a successful sale.

**4i.** The credit path must not send a discount. In the credit branch of `confirmSale`, pass nothing new, and when `paymentMode` is `'credit'`, hide the discount control by adding `paymentMode === 'cash' &&` to the condition in 4d.

---

### T5 — The receipt shows the discount

This depends on WS-F-2 having landed. In `src/features/pos/receiptBuilder.ts`:

- add two optional fields to `ReceiptInput`: `subtotal?: string;` and `discount?: string | null;`
- in `buildThermalReceipt`, immediately before the TOTAL line, when `input.discount` is present and not `'0.00'`, print two extra lines in the same padded style: one showing `SUBTOTAL` with `input.subtotal`, one showing `REMISE` with `-input.discount`
- in `buildA4Receipt`, when `input.discount` is present and not `'0.00'`, add two rows to the table footer above the total, labelled the same way

In `src/features/pos/PosScreen.tsx`, in `runReceiptPrint`, set `subtotal: provisionalTotal`, `discount: discount.trim() || null`, and change `total` to `netTotal`.

If `receiptBuilder.ts` does not exist because WS-F-2 has not landed on your base branch, **stop and report** — do not create it.

---

### T6 — Styles

Append to the end of `src/styles/global.css`. Do not edit an existing rule.

```css
/* WS-F-3 — discount control in the till checkout bar */
.sk-pos__discount {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-block-end: 10px;
}

.sk-pos__discount .sk-button {
  min-height: 56px;
}

.sk-pos__discount input {
  min-height: 56px;
  font-size: 1.1rem;
}
```

---

### T7 — Copy keys

In `src/shared/i18n/locales.ts`, add these keys to all three locale blocks, next to the existing `pos.*` entries. The Arabic block stores strings as escaped `\uXXXX` sequences — match that style.

| key | en | fr | ar |
|---|---|---|---|
| `pos.discount` | `Discount` | `Remise` | `تخفيض` |
| `pos.addDiscount` | `Add a discount` | `Ajouter une remise` | `إضافة تخفيض` |
| `pos.discountInvalid` | `Enter an amount of at most the sale total, for example 200 or 200.50.` | `Saisissez un montant au plus égal au total, par exemple 200 ou 200.50.` | `أدخل مبلغاً لا يتجاوز إجمالي البيع، مثال 200 أو 200.50.` |
| `pos.subtotal` | `Subtotal` | `Sous-total` | `المجموع الفرعي` |

Remove no existing key.

---

### T8 — Tests

**8a. Database acceptance suite.** Create `src-tauri/tests/procurement/../sales/ws_f_003_sale_discount_integration.sql` — that is, place it at `src-tauri/tests/sales/ws_f_003_sale_discount_integration.sql`, creating the `sales` directory if it does not exist. Copy the setup style of `src-tauri/tests/procurement/ws_e_003_purchase_return_integration.sql` exactly: the same user/session/fiscal-period/warehouse/variant bootstrap, the same `\set ON_ERROR_STOP on`, the same `DO $$ … $$;` shape, the same `ASSERT` style.

It must prove all of the following, with real numbers:

1. Set up a product with stock, open a cash session, and post a sale of 10 units at 500.00 with **no** discount. Assert `subtotal = 5000.00`, `discount_amount = 0.00`, `total_amount = 5000.00`, and that the journal has exactly one CASH_DESK debit of 5000.00 and one SALES_REVENUE credit of 5000.00 and **no** SALES_DISCOUNT line.
2. Post a second identical sale with a discount of 200.00. Assert `subtotal = 5000.00`, `discount_amount = 200.00`, `total_amount = 4800.00`.
3. For that second sale, assert the journal debits CASH_DESK by 4800.00, debits SALES_DISCOUNT by 200.00, credits SALES_REVENUE by 5000.00, and that total debits equal total credits.
4. Assert the COGS lines of both sales are identical — a discount must not change cost of goods sold.
5. Assert `cash.movements` for the second sale records 4800.00, not 5000.00.
6. Assert a discount larger than the subtotal is refused and posts nothing.
7. Assert a negative discount is refused.
8. Assert a discount with three decimals is refused.
9. Assert a user who has `POST_CASH_SALE` but **not** `APPLY_SALE_DISCOUNT` can post a sale with no discount but is refused when a discount is supplied.
10. Assert an idempotent retry of the discounted sale with the same request id returns the same document and creates no second sale.

Register the file in `src-tauri/tests/run_current_sql_suites.sh` by adding it to the `suites` array after the last existing entry.

**8b. Workflow test.** Create `tests/pos-discount.workflow.test.tsx`, copying the mocks and structure of `tests/pos-touch.workflow.test.tsx`. Four tests:

1. With `can_apply_sale_discount: false`, `pos-discount-open` is not in the document.
2. With it true, clicking `pos-discount-open` reveals `pos-discount-input`.
3. With a cart of 5000.00 and a discount of `200`, the total row shows `4800.00` and `pos-discount-row` shows `-200`.
4. Confirming sends `discount_amount: '200'` in the payload; and with a discount of `9999` on a 5000.00 cart, `pos-discount-error` appears and the Confirm button is disabled.

**8c. Existing tests.** Every test in `tests/` must still pass. If a POS test fails only because the payload gained a field, update its expected payload to include `discount_amount: null`. Do not weaken or delete any assertion. If a test fails for any other reason, **stop and report**.

---

## 5. Scope — OUT. Do not touch.

- `sales.confirm_credit_sale` and everything on the credit path — the credit-limit change and credit-sale discounts are WS-F-4.
- Percentage discounts. Per-line discounts. Tax. None of these exist and none are being added.
- COGS, WAC, `inventory.positions`, `inventory.movements`, `inventory._handle_residual_at_zero_quantity`.
- The cash drawer, `cash.enqueue_drawer_job`, cash sessions, blind counts, variance.
- The print-job queue. The printing code from WS-F-2 beyond the two builder functions named in T5.
- Any existing migration file. Forward-only: your one new migration is the only SQL change.
- `finance.resolve_account_id`, `finance.require_account_role`, `finance.account_role_mappings`, the `finance.account_role_code` enum, every account other than the one new `709` row.
- Procurement, inventory screens, catalogue, customers screen.
- `package.json`, `package-lock.json`, `Cargo.toml`, `Cargo.lock`.
- `STOCKIHA_GROUND_TRUTH.md`, `AGENTS.md`, `CURRENT_STEP.md`, `README.md`, `TASKS.md`, `GEMINI.md`.

If you find a genuine unrelated bug: **report it, do not fix it.**

---

## 6. Constraints

- **Never use floating point for money.** The discount is a string in TypeScript, a `Decimal` in Rust, `numeric(14,2)` in PostgreSQL. No `Number()`, no `parseFloat`, no arithmetic operators on a money string in the frontend — use `addExactMoney` from WS-F-1 and nothing else.
- The database decides. The on-screen net total is a preview; PostgreSQL recomputes and validates the discount independently.
- A cashier without `APPLY_SALE_DISCOUNT` must not be able to discount, and hiding the button is not the protection — the database check is. Both must be in place.
- Every user-facing string comes from `t(...)` in all three locales. No hardcoded English in JSX.
- Logical CSS properties only. Arabic RTL must keep working.
- No new npm dependency and no new Rust crate.
- No placeholder, no `TODO`, no mock, no commented-out block left behind.
- Show your file plan before editing. If it names a file outside the list below, you have misread the task — stop.

Files this task may touch:

```
src-tauri/migrations/20260914090000_ws_f_003_sale_discount.sql   (new)
src-tauri/src/domain/…            cash-sale payload struct        (one field)
src-tauri/src/application/…       cash-sale service fn            (edited)
src-tauri/src/commands/…          cash-sale command, if it spells out fields
src-tauri/src/…                   CustomerCapabilities struct     (one field)
src/shared/ipc/dto.ts                                             (edited)
src/shared/ipc/gateway.ts                                         (edited)
src/shared/ipc/customerDto.ts                                     (one field)
src/features/pos/PosScreen.tsx                                    (edited)
src/features/pos/receiptBuilder.ts                                (edited)
src/shared/i18n/locales.ts                                        (edited)
src/styles/global.css                                             (appended)
src-tauri/tests/sales/ws_f_003_sale_discount_integration.sql      (new)
src-tauri/tests/run_current_sql_suites.sh                         (one line)
tests/pos-discount.workflow.test.tsx                              (new)
plus existing test files, expected-payload updates only, per 8c
```

---

## 7. Acceptance criteria

1. The migration applies cleanly on top of every earlier migration and `sqlx` records it. No existing migration file is modified.
2. `cargo fmt --check`, `cargo check`, `cargo clippy -- -D warnings`, `cargo test` all pass.
3. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` all pass, every pre-existing test included.
4. Every SQL suite in `run_current_sql_suites.sh` passes, including the new one.
5. A sale with no discount posts exactly as it did before this change — same totals, same journal lines, same drawer amount.
6. A 5,000 sale with a 200 discount records subtotal 5,000, discount 200, total 4,800.
7. That sale's journal debits cash 4,800, debits discounts 200, credits revenue 5,000, and balances.
8. Cost of goods sold is identical with and without a discount.
9. The drawer receives the net amount, not the gross.
10. A discount larger than the sale, a negative discount, and a three-decimal discount are each refused, and nothing is posted.
11. A Cashier without the discount permission sees no discount button and is refused by the database if the request is sent anyway.
12. A Manager or Admin can discount, and Admin can grant the permission to a Cashier from the users and roles page.
13. The receipt shows subtotal, discount and total when a discount was given, and only the total when none was.
14. The credit-sale path is unchanged and shows no discount control.
15. All new text appears correctly in French, Arabic (RTL intact) and English.
16. `git status --short` shows only files from section 6's list.

---

## 8. Verification required

Paste the real, unedited output of every command.

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

```bash
cd src-tauri
cargo fmt --check
cargo check
cargo clippy -- -D warnings
cargo test
cd ..
```

```bash
bash src-tauri/tests/run_current_sql_suites.sh
git status --short
git diff --stat
git diff --stat -- src-tauri/migrations/
```

The last command must show exactly one file, and it must be new.

Do not run `npm run tauri build`. The Windows build and the manual acceptance run are the owner's steps.

Commit once:

```
feat(pos): WS-F-3 fixed-amount discount on cash sales
```

Push the branch. Do not merge into `main`.

---

## 9. Report back — required format

```
WS-F-3 REPORT

Git
- Branch:
- Base branch used:
- Full commit hash:
- Pushed: yes/no
- Working tree clean: yes/no
- Migration files: new = ?, modified = ? (modified must be 0)

Files changed (full list):
Files created (full list):
Files touched that are NOT in section 6's list (must be none):

Did you copy sales.confirm_cash_sale exactly as written in this plan? yes/no
If no, state every difference, line by line.

Acceptance criteria 1-16: PASS / FAIL each, one line each

Commands run (paste real output):
- npm run typecheck:
- npm run lint:
- npm test:
- npm run build:
- cargo fmt --check:
- cargo check:
- cargo clippy -- -D warnings:
- cargo test:
- run_current_sql_suites.sh:
- git diff --stat -- src-tauri/migrations/:

Anything not finished, and why:

Unrelated problems found but NOT fixed:
```

If any acceptance criterion fails, the final result is FAIL. Do not hide or downgrade a failure to finish.

---

## 10. Manual acceptance checklist for the owner (not for the agent)

1. Sign in as Admin, open a cash session, go to the till.
2. Ring up a sale with no discount and confirm it. Everything must behave exactly as before — same total, same receipt.
3. Ring up a sale worth 5,000. Tap **Add a discount**, enter 200. The summary should show a subtotal of 5,000, a discount of −200, and a total of 4,800.
4. Confirm it. The receipt should show all three figures.
5. Open Journals and find that sale's entry. Expect cash debited 4,800, discounts debited 200, revenue credited 5,000, balanced — plus the usual cost-of-goods pair.
6. Close the cash session and count the drawer. The expected cash must reflect 4,800 for that sale, not 5,000.
7. Try a discount of 9,999 on a 5,000 sale. The Confirm button must stay disabled with a clear message.
8. Try entering `200.555`. Same — refused.
9. Sign in as a Cashier. The discount button must not appear.
10. As Admin, grant the discount permission to the Cashier role from the users and roles page, sign back in as the Cashier, and confirm the button now appears.
11. Switch to credit payment. The discount control must disappear.
12. Switch the language to French, then Arabic. Check the discount row and error message read correctly and Arabic stays right-to-left.
