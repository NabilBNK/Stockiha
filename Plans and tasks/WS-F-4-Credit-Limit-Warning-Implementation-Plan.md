# WS-F-4 — Credit Limit Warns Instead of Blocking

**Workstream:** WS-F — POS, Sales & Cash Operations
**Sub-plan:** 4 of 5
**Executing agent:** Gemini (Antigravity IDE)
**Base branch:** the branch WS-F-3 landed on — **the owner will write its exact name here before you start:** `________________`
**Branch to create:** `task/ws-f-4-credit-limit-warning`
**Risk class:** HIGH. This replaces the credit-sale posting function, which moves stock, writes the journal, and changes what a customer owes.

---

## 0. Authority, precedence, and the override you are being given

Read in this order before touching anything:

1. This document.
2. `GEMINI.md`
3. `AGENTS.md`

This document wins where they differ.

**Explicit, limited override of `GEMINI.md` section 2.** This task replaces `sales.confirm_credit_sale`, adds a column to a sales table, and changes a credit-control rule. `GEMINI.md` tells you to refuse all of it. You may proceed **only** because the complete replacement function is written out below, line for line.

The condition attached to that override, and it is absolute:

> **Copy the SQL exactly. Do not shorten it, do not reorder it, do not "clean it up", do not skip a comment, do not rename a variable, do not change a rounding call.**

The function below is the existing, working credit-sale function with three marked changes. Everything else in it is unchanged and must stay unchanged. If something fails, **report it** — do not repair it by editing the logic.

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
git checkout -b task/ws-f-4-credit-limit-warning
```

If the base branch name is still blank at the top of this document, **stop and ask the owner.** Do not guess.

---

## 2. Background — what is changing and what is deliberately not

Read this so you understand what you are building. You still may not change the design.

A customer has a credit limit. Today, if a sale would push what he owes past that limit, the database **refuses the sale**, and the only way through is for a manager to type their username and password to mint a single-use override token. At a busy counter, for a regular customer who is 300 dinars over his limit, that is friction the shop owner does not want.

From now on, going over the limit **warns and lets the sale through**. The cashier sees clearly that the customer is over, and sells anyway if they choose.

**What is deliberately NOT changing:**

- **The overdue block stays a block.** If a customer has an invoice that has been unpaid past his allowed overdue window, the sale is still refused unless a manager authorises it. Being over a limit is a matter of degree — a good customer buying a lot. Not having paid an old invoice for weeks is a different and more serious signal, and the shop is protected from it by default. Do not soften this.
- **The override machinery stays.** Override tokens, `receivables.authorize_credit_override`, the single-use consumption, all of it remains, and is still used for the overdue case.
- **Credit is still refused outright** for an inactive customer and for a customer whose credit is not enabled. Those are not limits; they are switches the owner set deliberately.
- **Discounts are not being added to credit sales.** The fixed-amount discount from WS-F-3 applies to cash sales only. Adding it here would mean also changing the payload-hash function and the override-authorisation chain that binds a manager's approval to an exact sale amount, and that chain must not be touched in the same pass as the credit rule. If the owner wants discounts on credit sales later, it gets its own sub-plan.

---

## 3. Objective

Let a sale to an over-limit customer go through, with the cashier warned before and the fact recorded after.

---

## 4. Scope — IN

Seven tasks, in this order. Do not reorder them.

---

### T1 — The migration

Create **one** new file, exactly at this path:

```
src-tauri/migrations/20260915090000_ws_f_004_credit_limit_warning.sql
```

Copy the content below verbatim.

```sql
-- WS-F-004: exceeding a customer's credit limit warns instead of blocking.
--
-- Before: (exposure + sale) > credit_limit refused the sale unless a manager
-- override token was supplied. After: it posts, and the fact is recorded on
-- the sale and returned to the caller so the till can show it.
--
-- The overdue block is deliberately UNCHANGED and still requires an override:
-- being over a limit is a good customer buying a lot; an unpaid invoice past
-- its window is a different risk.
--
-- Only sales.confirm_credit_sale (the 9-argument implementation) is replaced.
-- The 8-argument wrapper, receivables.credit_sale_payload_hash and
-- receivables.authorize_credit_override are untouched, so a manager's
-- authorisation stays bound to exactly the sale it was issued for.

SET ROLE stockiha_owner;

-- =============================================================================
-- 1. Record whether a posted credit sale was over the limit
-- =============================================================================

ALTER TABLE sales.credit_sales
    ADD COLUMN IF NOT EXISTS over_limit_at_posting boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN sales.credit_sales.over_limit_at_posting IS
    'True when this sale took the customer past their credit limit. WS-F-004: over-limit warns rather than blocks, so this is evidence, not an exception.';

-- =============================================================================
-- 2. Replace the credit-sale posting function
-- =============================================================================

CREATE OR REPLACE FUNCTION sales.confirm_credit_sale(p_session_token text, p_request_id uuid, p_payload_hash bytea, p_customer_id bigint, p_warehouse_id bigint, p_fiscal_period_id bigint, p_document_date date, p_lines jsonb, p_override_token uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
    v_user_id bigint;
    v_workstation_id text;
    v_cached_result bigint;
    v_period_status text;
    v_period_start date;
    v_period_end date;
    v_fiscal_year integer;
    v_customer_active boolean;
    v_credit_enabled boolean;
    v_credit_limit numeric(14, 2);
    v_payment_terms_days integer;
    v_max_overdue_days integer;
    v_exposure numeric(14, 2);
    v_oldest_due date;
    v_business_today date := (now() AT TIME ZONE 'Africa/Algiers')::date;
    v_over_limit boolean;
    v_overdue_blocked boolean;
    v_override_used boolean := false;
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
    v_line_total numeric(14, 2);
    v_subtotal numeric(14, 2) := 0;
    v_total_cogs numeric(18, 4) := 0;
    v_movement_id bigint;
    v_residual_journal_id bigint;
    v_due_date date;
    v_sequence bigint;
    v_document_number text;
    v_journal_sequence bigint;
    v_journal_number text;
    v_new_exposure numeric(14, 2);
BEGIN
    -- Application session + permission. Actor and workstation are resolved here,
    -- never trusted from caller input.
    SELECT user_id, workstation_id
    INTO v_user_id, v_workstation_id
    FROM iam.resolve_session_with_permission(p_session_token, 'POST_CREDIT_SALE');

    -- Core idempotency. Failed attempts roll back this reservation naturally.
    v_cached_result := core.reserve_idempotent_request(
        'sales.confirm_credit_sale', p_request_id, p_payload_hash
    );
    IF v_cached_result IS NOT NULL THEN
        -- WS-F-004 change 1 of 3: the replay must return the same over-limit
        -- flag the original posting returned, so it is read from the stored
        -- column rather than recomputed against today's exposure.
        RETURN (
            SELECT jsonb_build_object(
                'document_id', d.id,
                'document_number', d.document_number,
                'customer_id', s.customer_id,
                'total_amount', s.total_amount::text,
                'due_date', s.due_date,
                'exposure_amount', cs.exposure_amount::text,
                'available_credit', (c.credit_limit - cs.exposure_amount)::text,
                'credit_limit', c.credit_limit::text,
                'over_limit', s.over_limit_at_posting,
                'journal_document_id', s.journal_document_id
            )
            FROM core.business_documents d
            JOIN sales.credit_sales s ON s.document_id = d.id
            JOIN receivables.customers c ON c.id = s.customer_id
            JOIN receivables.customer_credit_state cs ON cs.customer_id = c.id
            WHERE d.id = v_cached_result
        );
    END IF;

    -- Fiscal boundary.
    SELECT status, starts_on, ends_on, extract(year FROM starts_on)::integer
    INTO v_period_status, v_period_start, v_period_end, v_fiscal_year
    FROM finance.fiscal_periods
    WHERE id = p_fiscal_period_id
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'fiscal period % not found', p_fiscal_period_id USING ERRCODE = '22023';
    END IF;
    IF v_period_status <> 'OPEN' THEN
        RAISE EXCEPTION 'fiscal period is not open' USING ERRCODE = '55000';
    END IF;
    IF p_document_date < v_period_start OR p_document_date > v_period_end THEN
        RAISE EXCEPTION 'document date is outside fiscal period' USING ERRCODE = '22023';
    END IF;

    IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
        RAISE EXCEPTION 'credit sale must contain at least one line' USING ERRCODE = '22023';
    END IF;

    -- Lock customer master + credit state before evaluating exposure. Every future
    -- customer payment/credit posting follows this same lock boundary.
    SELECT c.is_active, c.credit_enabled, c.credit_limit, c.payment_terms_days,
           c.max_overdue_days, cs.exposure_amount, cs.oldest_open_due_date
    INTO v_customer_active, v_credit_enabled, v_credit_limit, v_payment_terms_days,
         v_max_overdue_days, v_exposure, v_oldest_due
    FROM receivables.customers c
    JOIN receivables.customer_credit_state cs ON cs.customer_id = c.id
    WHERE c.id = p_customer_id
    FOR UPDATE OF c, cs;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'customer % not found', p_customer_id USING ERRCODE = '22023';
    END IF;
    IF NOT v_customer_active THEN
        RAISE EXCEPTION 'customer is inactive' USING ERRCODE = '55000';
    END IF;
    IF NOT v_credit_enabled THEN
        RAISE EXCEPTION 'customer is not enabled for credit sales' USING ERRCODE = '55000';
    END IF;

    -- Validate wire amounts and calculate sale total before any inventory mutation.
    FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
    LOOP
        v_variant_id := NULLIF(v_line ->> 'variant_id', '')::bigint;
        v_quantity := NULLIF(v_line ->> 'quantity', '')::numeric;
        v_unit_price := NULLIF(v_line ->> 'unit_price', '')::numeric;
        IF v_variant_id IS NULL OR v_quantity IS NULL OR v_unit_price IS NULL THEN
            RAISE EXCEPTION 'credit sale line is missing required fields' USING ERRCODE = '22023';
        END IF;
        IF v_quantity <= 0 THEN
            RAISE EXCEPTION 'credit sale quantity must be positive' USING ERRCODE = '22023';
        END IF;
        IF v_unit_price < 0 THEN
            RAISE EXCEPTION 'credit sale unit price cannot be negative' USING ERRCODE = '22023';
        END IF;
        v_subtotal := v_subtotal + round(v_quantity * v_unit_price, 2);
    END LOOP;

    IF v_subtotal <= 0 THEN
        RAISE EXCEPTION 'credit sale total must be positive' USING ERRCODE = '22023';
    END IF;

    v_due_date := p_document_date + v_payment_terms_days;
    v_over_limit := (v_exposure + v_subtotal) > v_credit_limit;
    v_overdue_blocked := v_oldest_due IS NOT NULL
        AND v_max_overdue_days IS NOT NULL
        AND (v_oldest_due + v_max_overdue_days) < v_business_today;

    -- WS-F-004 change 2 of 3: only the overdue condition blocks now. Being over
    -- the credit limit is recorded and returned, and the sale continues. An
    -- override token is still honoured if one was supplied for the overdue case.
    IF v_overdue_blocked THEN
        IF p_override_token IS NULL THEN
            RAISE EXCEPTION 'customer has an overdue invoice beyond the allowed window'
                USING ERRCODE = '55000';
        END IF;

        PERFORM 1
        FROM receivables.credit_override_tokens o
        WHERE o.id = p_override_token
          AND o.customer_id = p_customer_id
          AND o.canonical_payload_hash = encode(p_payload_hash, 'hex')
          AND o.consumed_at IS NULL
          AND o.expires_at > now()
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'credit override is invalid, expired, consumed, or does not match this sale'
                USING ERRCODE = '55000';
        END IF;
        v_override_used := true;
    END IF;

    -- Lock all existing touched stock positions in deterministic order.
    PERFORM 1
    FROM inventory.positions
    WHERE warehouse_id = p_warehouse_id
      AND variant_id IN (
          SELECT DISTINCT (elem ->> 'variant_id')::bigint
          FROM jsonb_array_elements(p_lines) elem
      )
    ORDER BY variant_id
    FOR UPDATE;

    INSERT INTO core.business_documents (
        document_type, document_date, fiscal_period_id, fiscal_year
    ) VALUES (
        'CREDIT_SALE', p_document_date, p_fiscal_period_id, v_fiscal_year
    ) RETURNING id INTO v_document_id;

    INSERT INTO sales.credit_sales (
        document_id, customer_id, warehouse_id, subtotal, total_amount, due_date,
        posted_by_user_id, workstation_id
    ) VALUES (
        v_document_id, p_customer_id, p_warehouse_id, 0, 0, v_due_date,
        v_user_id, v_workstation_id
    );

    v_line_number := 0;
    FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
    LOOP
        v_line_number := v_line_number + 1;
        v_variant_id := (v_line ->> 'variant_id')::bigint;
        v_quantity := (v_line ->> 'quantity')::numeric;
        v_unit_price := (v_line ->> 'unit_price')::numeric;

        SELECT pv.is_active, pv.sku, p.name
        INTO v_variant_active, v_variant_sku, v_variant_name
        FROM catalog.product_variants pv
        JOIN catalog.products p ON p.id = pv.product_id
        WHERE pv.id = v_variant_id;

        IF NOT FOUND OR NOT v_variant_active THEN
            RAISE EXCEPTION 'variant % is missing or inactive', v_variant_id USING ERRCODE = '22023';
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
        IF v_qty_on_hand < v_quantity THEN
            RAISE EXCEPTION 'insufficient stock for variant %', v_variant_id USING ERRCODE = '55000';
        END IF;

        v_unit_cost_snapshot := v_wac;
        v_line_total := round(v_quantity * v_unit_price, 2);
        v_total_cogs := v_total_cogs + round(v_quantity * v_unit_cost_snapshot, 4);
        v_new_qty := v_qty_on_hand - v_quantity;
        v_new_value := v_position_value - round(v_quantity * v_wac, 4);

        IF v_new_qty = 0 THEN
            IF abs(v_new_value) >= 0.01 THEN
                RAISE EXCEPTION 'credit sale would leave a material zero-quantity inventory residual'
                    USING ERRCODE = '55000';
            END IF;
        ELSIF v_new_value < 0 THEN
            RAISE EXCEPTION 'credit sale would make inventory value negative' USING ERRCODE = '55000';
        END IF;

        UPDATE inventory.positions
        SET quantity_on_hand = v_new_qty,
            total_value = CASE WHEN v_new_qty = 0 THEN 0 ELSE v_new_value END
        WHERE warehouse_id = p_warehouse_id AND variant_id = v_variant_id;

        INSERT INTO inventory.movements (
            warehouse_id, variant_id, movement_type, quantity_delta, inventory_value_delta,
            resulting_quantity_on_hand, resulting_total_value, reference_type, reference_id
        ) VALUES (
            p_warehouse_id, v_variant_id, 'ISSUE', -v_quantity,
            -round(v_quantity * v_wac, 4), v_new_qty,
            CASE WHEN v_new_qty = 0 THEN 0 ELSE v_new_value END,
            'CREDIT_SALE_LINE', v_document_id
        ) RETURNING id INTO v_movement_id;

        IF v_new_qty = 0 AND v_new_value <> 0 THEN
            v_residual_journal_id := inventory._handle_residual_at_zero_quantity(
                p_warehouse_id, v_variant_id, v_movement_id, v_new_value,
                p_fiscal_period_id, p_document_date
            );
        END IF;

        INSERT INTO sales.credit_sale_lines (
            document_id, line_number, variant_id, variant_sku_snapshot,
            variant_name_snapshot, quantity, unit_price, unit_cost_snapshot, line_total
        ) VALUES (
            v_document_id, v_line_number, v_variant_id, v_variant_sku,
            v_variant_name, v_quantity, v_unit_price, v_unit_cost_snapshot, v_line_total
        );
    END LOOP;

    -- WS-F-004 change 3 of 3: store the over-limit fact alongside the totals.
    UPDATE sales.credit_sales
    SET subtotal = v_subtotal,
        total_amount = v_subtotal,
        over_limit_at_posting = v_over_limit
    WHERE document_id = v_document_id;

    -- Receivable journal: Dr AR / Cr revenue, plus COGS / inventory.
    INSERT INTO core.business_documents (
        document_type, document_date, fiscal_period_id, fiscal_year
    ) VALUES (
        'JOURNAL_ENTRY', p_document_date, p_fiscal_period_id, v_fiscal_year
    ) RETURNING id INTO v_journal_document_id;

    INSERT INTO finance.journal_entries (document_id, description, source_type, source_id)
    VALUES (v_journal_document_id, 'Customer credit sale', 'CREDIT_SALE', v_document_id);

    INSERT INTO finance.journal_lines (document_id, line_number, account_code, account_id, debit, credit) VALUES
        (v_journal_document_id, 1, 'ACCOUNTS_RECEIVABLE', finance.resolve_account_id('ACCOUNTS_RECEIVABLE'), v_subtotal, 0),
        (v_journal_document_id, 2, 'SALES_REVENUE', finance.resolve_account_id('SALES_REVENUE'), 0, v_subtotal);

    IF v_total_cogs > 0 THEN
        INSERT INTO finance.journal_lines (document_id, line_number, account_code, account_id, debit, credit) VALUES
            (v_journal_document_id, 3, 'COGS', finance.resolve_account_id('COGS'), round(v_total_cogs, 2), 0),
            (v_journal_document_id, 4, 'INVENTORY_MERCHANDISE', finance.resolve_account_id('INVENTORY_MERCHANDISE'), 0, round(v_total_cogs, 2));
    END IF;

    UPDATE sales.credit_sales
    SET journal_document_id = v_journal_document_id
    WHERE document_id = v_document_id;

    -- Official numbers claimed inside transaction; rollback leaves no gap.
    v_sequence := core.claim_next_document_number('CREDIT_SALE', v_fiscal_year);
    v_document_number := 'CR-' || v_fiscal_year || '-' || lpad(v_sequence::text, 6, '0');
    UPDATE core.business_documents
    SET status = 'POSTED', sequence_number = v_sequence,
        document_number = v_document_number, posted_at = now()
    WHERE id = v_document_id;

    v_journal_sequence := core.claim_next_document_number('JOURNAL_ENTRY', v_fiscal_year);
    v_journal_number := 'JE-' || v_fiscal_year || '-' || lpad(v_journal_sequence::text, 6, '0');
    UPDATE core.business_documents
    SET status = 'POSTED', sequence_number = v_journal_sequence,
        document_number = v_journal_number, posted_at = now()
    WHERE id = v_journal_document_id;

    -- Append-only AR movement and authoritative cache update happen under the
    -- same customer lock as the credit decision.
    INSERT INTO receivables.customer_ledger_entries (
        customer_id, entry_type, amount_delta, document_id, due_date,
        posted_by_user_id, workstation_id
    ) VALUES (
        p_customer_id, 'CREDIT_INVOICE', v_subtotal, v_document_id, v_due_date,
        v_user_id, v_workstation_id
    );

    v_new_exposure := v_exposure + v_subtotal;
    UPDATE receivables.customer_credit_state
    SET exposure_amount = v_new_exposure,
        oldest_open_due_date = CASE
            WHEN oldest_open_due_date IS NULL THEN v_due_date
            ELSE least(oldest_open_due_date, v_due_date)
        END
    WHERE customer_id = p_customer_id;

    IF v_override_used THEN
        UPDATE receivables.credit_override_tokens
        SET consumed_at = now(), consumed_document_id = v_document_id
        WHERE id = p_override_token;
    END IF;

    PERFORM core.record_idempotent_result(
        'sales.confirm_credit_sale', p_request_id, v_document_id
    );

    RETURN jsonb_build_object(
        'document_id', v_document_id,
        'document_number', v_document_number,
        'customer_id', p_customer_id,
        'total_amount', v_subtotal::text,
        'due_date', v_due_date,
        'exposure_amount', v_new_exposure::text,
        'available_credit', (v_credit_limit - v_new_exposure)::text,
        'credit_limit', v_credit_limit::text,
        'over_limit', v_over_limit,
        'journal_document_id', v_journal_document_id
    );
END;
$function$;

RESET ROLE;
```

**Note on `available_credit`.** When a customer goes past his limit this value becomes negative — that is correct and intended. It is the amount by which he is over. The till presents it as an over-limit warning rather than showing a minus sign; see T4.

---

### T2 — Rust

Find the credit-sale result struct:

```bash
grep -rn "available_credit" src-tauri/src
```

Add two fields to it, matching the style of the fields already there:

```rust
    pub credit_limit: String,
    pub over_limit: bool,
```

Nothing else in Rust changes. The function signature is the same, the bind list is the same, the command is the same.

---

### T3 — TypeScript IPC layer

In whichever DTO file holds the credit-sale result (`src/shared/ipc/customerDto.ts` or `dto.ts` — find it with `grep -rn "available_credit" src/shared`), add the same two fields to that interface:

```ts
  credit_limit: string;
  over_limit: boolean;
```

Add nothing else. No new command, no gateway change.

---

### T4 — Warn at the till, before confirming

All edits are in `src/features/pos/PosScreen.tsx`.

**4a.** Add this memo immediately after the `netTotal` memo added in WS-F-3:

```tsx
  const creditOverBy = useMemo(() => {
    if (paymentMode !== 'credit' || !selectedCustomer) return null;
    const projected = addExactMoney([
      selectedCustomer.exposure_amount,
      netTotal,
      `-${selectedCustomer.credit_limit}`,
    ]);
    return projected.startsWith('-') || projected === '0.00' ? null : projected;
  }, [paymentMode, selectedCustomer, netTotal]);
```

`addExactMoney` comes from WS-F-1 and sums decimal strings exactly. It accepts a leading minus, so subtracting is done by passing a negated string. Do not write your own subtraction and do not use `Number()`.

If the variable holding the chosen customer is not called `selectedCustomer`, use whatever name the file already uses. If the customer object does not carry `exposure_amount` and `credit_limit`, **stop and report** rather than fetching them another way.

**4b.** Render the warning inside the checkout bar, immediately above the total row:

```tsx
{creditOverBy ? (
  <Banner tone="warning" testId="pos-credit-over-limit">
    {t('pos.creditOverLimit', { amount: creditOverBy })}
  </Banner>
) : null}
```

Use the `Banner` prop names the surrounding code already uses.

**4c.** Change the Confirm button's **label only** when the warning is showing, so the cashier is making a deliberate choice:

```tsx
{creditOverBy ? t('pos.confirmAnyway') : <the existing label expression>}
```

**Do not add a second confirmation step, a dialog, or a checkbox. Do not disable the button.** The whole point of this sub-plan is that the sale goes through.

**4d.** Remove the over-limit branch of the manager-override prompt. Find where the screen currently reacts to the credit-policy refusal by opening the override dialog, and leave that dialog wired **only** to the overdue refusal. The simplest correct change: the dialog now opens in response to the error the database raises, which after T1 only happens for the overdue case — so if the existing code opens the dialog on any credit failure, that is already correct and you change nothing here. **Read the code and decide which of those two situations you are in. If the existing code checks for the specific old message text `customer credit policy blocks this sale`, update that string to `customer has an overdue invoice beyond the allowed window`.** Report which case applied.

**4e.** After a successful credit sale, if `result.over_limit` is true, append the over-limit note to the existing success banner rather than replacing it. Keep the existing banner text and add `t('pos.soldOverLimit')` after it.

---

### T5 — Copy keys

In `src/shared/i18n/locales.ts`, add these to all three locale blocks, next to the existing `pos.*` entries. The Arabic block stores strings as escaped `\uXXXX` sequences — match that style.

| key | en | fr | ar |
|---|---|---|---|
| `pos.creditOverLimit` | `This sale puts the customer {amount} DZD over their credit limit.` | `Cette vente dépasse la limite de crédit du client de {amount} DZD.` | `هذه العملية تتجاوز حد ائتمان الزبون بـ {amount} دج.` |
| `pos.confirmAnyway` | `Confirm anyway` | `Confirmer quand même` | `تأكيد على أي حال` |
| `pos.soldOverLimit` | `Customer is over their credit limit.` | `Le client dépasse sa limite de crédit.` | `الزبون تجاوز حد ائتمانه.` |

Use the same interpolation syntax that existing keys with placeholders in this file already use. If that file does not support a `{amount}` placeholder, follow whatever mechanism the existing keys use — **do not invent one**.

Remove no existing key.

---

### T6 — Tests

**6a. Database acceptance suite.** Create `src-tauri/tests/sales/ws_f_004_credit_limit_warning_integration.sql`, copying the bootstrap style of `src-tauri/tests/sales/ws_f_003_sale_discount_integration.sql` exactly.

It must prove all of the following, with real numbers:

1. A customer with a credit limit of 1,000 and no exposure. A credit sale of 600 posts, `over_limit_at_posting` is false, and the returned `over_limit` is false.
2. A second credit sale of 600 for the same customer **posts successfully with no override token**, `over_limit_at_posting` is true, and the returned `over_limit` is true.
3. After those two sales, the customer's exposure is 1,200 and the returned `available_credit` is `-200.00`.
4. The journal for the over-limit sale is exactly the same shape as for the within-limit one — AR debited, revenue credited, balanced — with no extra or missing line.
5. The customer ledger gained a `CREDIT_INVOICE` entry for the over-limit sale, of the right amount.
6. An **inactive** customer is still refused.
7. A customer with `credit_enabled = false` is still refused.
8. A customer whose oldest open invoice is past `max_overdue_days` is still **refused without an override**, and the refusal message mentions the overdue invoice.
9. That same overdue sale **succeeds** when a valid override token is supplied, and the token is marked consumed.
10. An idempotent retry of the over-limit sale returns the same document and reports `over_limit` as true, and creates no second sale.

Register it in `src-tauri/tests/run_current_sql_suites.sh` after the WS-F-3 entry.

**6b. Workflow test.** Create `tests/pos-credit-limit.workflow.test.tsx`, copying the mocks and structure of `tests/pos-discount.workflow.test.tsx`. Four tests:

1. A customer with limit `1000.00` and exposure `900.00`, and a cart of `50.00`: `pos-credit-over-limit` is **not** in the document.
2. Same customer, cart of `200.00`: `pos-credit-over-limit` appears and names `100.00`.
3. In that state the Confirm button is **enabled** and reads the "confirm anyway" label.
4. Clicking Confirm calls the credit-sale command once, with no override token.

**6c. Existing tests.** Every test in `tests/` must still pass. A test that asserted an over-limit sale is refused, or that the override dialog opens on an over-limit sale, is now asserting the opposite of the intended behaviour — update it to assert the new behaviour and **say so explicitly in your report, naming each test you changed and what it asserted before**. Do not delete such a test. Do not weaken an assertion for any other reason.

---

### T7 — Nothing in the customer screen changes

Do not touch `src/features/customers/CustomersScreen.tsx`, the credit-limit field, or the customer edit form. Limits are still set the same way; only what happens when one is exceeded has changed.

---

## 5. Scope — OUT. Do not touch.

- `receivables.credit_sale_payload_hash`, `receivables.authorize_credit_override`, the 8-argument `sales.confirm_credit_sale` wrapper, `receivables.credit_override_tokens`. The override chain binds a manager's approval to an exact sale; it stays exactly as it is.
- The overdue block. It still blocks. Do not soften it, do not add a setting for it, do not make it configurable.
- Discounts on credit sales. Out of scope, stated in section 2, not negotiable in this pass.
- `sales.confirm_cash_sale` and everything WS-F-3 built.
- COGS, WAC, `inventory.positions`, `inventory.movements`, `inventory._handle_residual_at_zero_quantity`.
- Customer payments, refunds, the receivables ledger rebuild, `receivables.customer_credit_state` beyond the update already inside the function.
- Any existing migration file. Forward-only: your one new migration is the only SQL change.
- Printing, cash sessions, the drawer, procurement, inventory screens, catalogue.
- `package.json`, `package-lock.json`, `Cargo.toml`, `Cargo.lock`.
- `STOCKIHA_GROUND_TRUTH.md`, `AGENTS.md`, `CURRENT_STEP.md`, `README.md`, `TASKS.md`, `GEMINI.md`.

If you find a genuine unrelated bug: **report it, do not fix it.**

---

## 6. Constraints

- **Never use floating point for money.** Use `addExactMoney` from WS-F-1 and nothing else in the frontend.
- The database decides. The till's warning is a preview computed from the customer's cached exposure; PostgreSQL recomputes it under a row lock at posting time. The two can legitimately disagree if another till sold to the same customer a second earlier, and the database's answer is the one that counts.
- Every user-facing string comes from `t(...)` in all three locales. No hardcoded English in JSX.
- Logical CSS properties only. Arabic RTL must keep working.
- No new npm dependency and no new Rust crate.
- No placeholder, no `TODO`, no mock, no commented-out block left behind.
- Show your file plan before editing. If it names a file outside the list below, you have misread the task — stop.

Files this task may touch:

```
src-tauri/migrations/20260915090000_ws_f_004_credit_limit_warning.sql   (new)
src-tauri/src/…          credit-sale result struct                      (two fields)
src/shared/ipc/…         credit-sale result interface                   (two fields)
src/features/pos/PosScreen.tsx                                          (edited)
src/shared/i18n/locales.ts                                              (edited)
src-tauri/tests/sales/ws_f_004_credit_limit_warning_integration.sql     (new)
src-tauri/tests/run_current_sql_suites.sh                               (one line)
tests/pos-credit-limit.workflow.test.tsx                                (new)
plus existing test files, per 6c
```

---

## 7. Acceptance criteria

1. The migration applies cleanly on top of every earlier migration and `sqlx` records it. No existing migration file is modified.
2. `cargo fmt --check`, `cargo check`, `cargo clippy -- -D warnings`, `cargo test` all pass.
3. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` all pass.
4. Every SQL suite in `run_current_sql_suites.sh` passes, including the new one.
5. A credit sale within the limit behaves exactly as before — same journal, same ledger entry, same exposure update.
6. A credit sale that exceeds the limit **posts without any manager override** and is flagged on the sale row and in the returned result.
7. The till warns, before confirming, by how much the customer will be over, and the Confirm button stays enabled.
8. A customer who is inactive, or not enabled for credit, is still refused.
9. A customer with an invoice overdue past his window is still refused without an override, and still succeeds with one.
10. An over-limit sale produces the same journal shape as any other credit sale.
11. The customer's exposure and available credit update correctly, and available credit may legitimately show a negative figure.
12. All new text appears correctly in French, Arabic (RTL intact) and English.
13. `git status --short` shows only files from section 6's list.

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
feat(pos): WS-F-4 credit limit warns instead of blocking the sale
```

Push the branch. Do not merge into `main`.

---

## 9. Report back — required format

```
WS-F-4 REPORT

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

Did you copy sales.confirm_credit_sale exactly as written in this plan? yes/no
If no, state every difference, line by line.

Which case applied in task 4d, and what did you change?

Existing tests I changed, and what each asserted before:

Acceptance criteria 1-13: PASS / FAIL each, one line each

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

1. Sign in as Admin. Open a customer and set their credit limit to 1,000 DZD. Make sure credit is enabled.
2. Open a cash session and go to the till. Switch to credit payment and choose that customer.
3. Ring up 600 DZD. No warning should appear. Confirm the sale.
4. Ring up another 600 DZD for the same customer. A warning should appear saying the customer will be 200 DZD over their limit, and the Confirm button should now read **Confirm anyway** and still be clickable.
5. Confirm it. The sale must go through with **no manager password prompt at all**. That prompt disappearing is the whole point of this change.
6. Open the customer's record. Exposure should read 1,200 and available credit should show −200. A negative figure here is correct.
7. Open Journals and check the second sale. It must look exactly like the first one: receivables debited, revenue credited, balanced, plus the usual cost-of-goods pair.
8. Set that customer to inactive and try another credit sale. It must be refused.
9. Set them active again but turn credit off. It must be refused.
10. If you can arrange a customer with an invoice overdue past their allowed window, try a credit sale. It must still be refused and still ask for a manager. That block is deliberate and stays.
11. Switch the language to French, then Arabic. Check the warning reads correctly and Arabic stays right-to-left.
