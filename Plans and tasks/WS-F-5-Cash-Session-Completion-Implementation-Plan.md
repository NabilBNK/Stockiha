# WS-F-5 — Cash In, Cash Out, and a Till That Balances

**Workstream:** WS-F — POS, Sales & Cash Operations
**Sub-plan:** 5 of 6
**Executing agent:** Gemini (Antigravity IDE)
**Base branch:** `task/ws-f-4-credit-limit-warning` (commit `572a280`)
**Branch to create:** `task/ws-f-5-cash-session-completion`
**Risk class:** HIGH. This replaces two cash-session functions, adds ledger accounts, and makes the till post to the books for the first time.

---

## 0. Authority, precedence, and the override you are being given

Read in this order before touching anything:

1. This document.
2. `GEMINI.md`
3. `AGENTS.md`

This document wins where they differ.

**Explicit, limited override of `GEMINI.md` section 2.** This task replaces `cash.submit_cash_session_count` and `cash.approve_cash_session_variance`, relaxes a check constraint on an append-only cash table, adds two ledger accounts, and posts journals. `GEMINI.md` tells you to refuse all of it. You may proceed **only** because every replacement function is written out below, line for line.

The condition attached to that override, and it is absolute:

> **Copy the SQL exactly. Do not shorten it, do not reorder it, do not "clean it up", do not skip a comment, do not rename a variable, do not change a rounding call.**

Both functions below are the existing, working versions with marked additions. Everything unmarked is unchanged and must stay unchanged. If something fails, **report it** — do not repair it by editing the logic.

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

```bash
git checkout task/ws-f-4-credit-limit-warning
git pull origin task/ws-f-4-credit-limit-warning
git checkout -b task/ws-f-5-cash-session-completion
```

Work only on `task/ws-f-5-cash-session-completion`.

---

## 2. Background — three problems, one sub-plan

Read this so you understand what you are building. You still may not change the design.

The cash session is the best-built part of this application. The blind count works, close attempts are numbered and kept, every state change is recorded, and manager approval re-authenticates properly. Do not redesign any of it. You are finishing it.

**Problem 1: the tolerance is zero.** The machinery for accepting a small difference already exists — there is a threshold column, it is read under a lock, it is compared correctly. It shipped set to `0`, so a one-dinar difference stops the close and demands a manager's password. The smallest coin in circulation for this shop is 50 DA, so any difference below 50 can only be a miscount. The threshold becomes 50, and a settings screen lets the owner change it.

**Problem 2: money leaves the drawer during the day and nothing knows.** The shopkeeper pays a delivery man, buys lunch, or hands cash to a supplier. At closing, the count is short by exactly that amount and looks like a loss. Cash also goes *in* — extra change brought from home. Both directions get recorded, with a reason.

**Problem 3: the variance never reaches the books.** When the drawer is 500 short, the session records it and closes, and the ledger still says the cash is there. Over months the books and the drawer drift apart with nothing recording it. Every other module in this app posts a balanced journal. This one posts none. That ends here.

**How the accounting works, and why:**

- A **shortfall** is a cost. Debit a cash-variance expense account, credit cash. An **overage** does the reverse — debit cash, credit the same account. One account, both directions, so at month end the owner sees a single net figure for how much the till drifted.
- **Cash leaving** the drawer for something else is not an expense yet — nobody knows what it was for until the accountant classifies it. It moves to an internal-transfer account: debit transfer, credit cash. **Cash coming in** is the reverse. This is the standard SCF 58 treatment for money in motion, and it keeps the ledger's cash balance equal to the drawer at all times.

**Rulings you must not deviate from:**

- Amounts are always stored positive. Direction is carried by the movement type, never by a minus sign.
- Cash movements are append-only, exactly like sales movements. There is no edit and no delete. A mistake is corrected by recording the opposite movement with a reason.
- A movement can only be recorded against an **open** session, by the cashier who owns it.
- Supplier payments are **not** automatically linked to the drawer. If the shopkeeper pays a supplier from the till, he records a cash-out with the supplier reason. The owner does not yet know whether the shop works that way, and guessing would make every close show a phantom shortfall.
- The printable session report is **not** in this sub-plan. It is WS-F-6.

---

## 3. Objective

Let cash move in and out of the drawer during the day with a reason attached, accept differences under 50 DA without a manager, and make every closing difference appear in the accounts.

---

## 4. Scope — IN

Eight tasks, in this order. Do not reorder them.

---

### T1 — The migration

Create **one** new file, exactly at this path:

```
src-tauri/migrations/20260916090000_ws_f_005_cash_session_completion.sql
```

Copy the content below verbatim.

```sql
-- WS-F-005: cash in/out during a session, a workable variance tolerance, and
-- the closing variance posted to the ledger.
--
-- Three gaps are closed:
--   1. cash.session_policy.material_variance_threshold shipped as 0, so any
--      difference at all demanded a manager. The smallest coin is 50 DA, so
--      anything under 50 can only be a miscount. It becomes 50.
--   2. cash.movements accepted only 'SALE'. Money that leaves or enters the
--      drawer for any other reason was invisible and showed up as a shortfall.
--   3. Closing a session recorded the variance but posted no journal, so the
--      ledger's cash balance drifted away from the drawer with no trace.
--
-- Amounts stay positive everywhere; direction is carried by movement_type.
-- cash.movements remains append-only -- its immutability trigger is untouched.

SET ROLE stockiha_owner;

-- =============================================================================
-- 1. Permissions
-- =============================================================================

INSERT INTO iam.permissions (code, name) VALUES
    ('RECORD_CASH_MOVEMENT', 'Record cash taken from or added to the drawer'),
    ('MANAGE_CASH_POLICY', 'Change the cash variance tolerance')
ON CONFLICT (code) DO NOTHING;

INSERT INTO iam.role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM iam.roles role
CROSS JOIN iam.permissions permission
WHERE role.code IN ('CASHIER', 'MANAGER', 'ADMIN')
  AND permission.code = 'RECORD_CASH_MOVEMENT'
ON CONFLICT DO NOTHING;

INSERT INTO iam.role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM iam.roles role
CROSS JOIN iam.permissions permission
WHERE role.code IN ('MANAGER', 'ADMIN')
  AND permission.code = 'MANAGE_CASH_POLICY'
ON CONFLICT DO NOTHING;

-- =============================================================================
-- 2. Ledger accounts
-- =============================================================================

INSERT INTO finance.accounts
    (scf_code, legacy_code, name_fr, name_en, account_type, normal_balance, parent_id, is_postable, is_control, control_kind)
VALUES
    ('58', NULL, 'Virements internes', 'Internal transfers', 'asset', 'debit', NULL, false, false, NULL)
ON CONFLICT (scf_code) DO NOTHING;

INSERT INTO finance.accounts
    (scf_code, legacy_code, name_fr, name_en, account_type, normal_balance, parent_id, is_postable, is_control, control_kind)
VALUES
    ('581', 'CASH_TRANSIT', 'Virements de fonds', 'Cash in transit',
     'asset', 'debit', (SELECT id FROM finance.accounts WHERE scf_code = '58'), true, false, NULL),
    ('6588', 'CASH_VARIANCE', 'Écarts de caisse', 'Cash over and short',
     'expense', 'debit', (SELECT id FROM finance.accounts WHERE scf_code = '65'), true, false, NULL)
ON CONFLICT (scf_code) DO NOTHING;

-- =============================================================================
-- 3. Tolerance: 50 DA, only if it is still the shipped default of 0
-- =============================================================================

UPDATE cash.session_policy
SET material_variance_threshold = 50.00
WHERE id = 1
  AND material_variance_threshold = 0;

-- =============================================================================
-- 4. cash.movements gains direction, reason and actor
-- =============================================================================

ALTER TABLE cash.movements
    DROP CONSTRAINT IF EXISTS movements_movement_type_valid;
ALTER TABLE cash.movements
    ADD CONSTRAINT movements_movement_type_valid
    CHECK (movement_type IN ('SALE', 'CASH_IN', 'CASH_OUT'));

ALTER TABLE cash.movements
    ADD COLUMN IF NOT EXISTS reason_code text;
ALTER TABLE cash.movements
    ADD COLUMN IF NOT EXISTS note text;
ALTER TABLE cash.movements
    ADD COLUMN IF NOT EXISTS recorded_by_user_id bigint REFERENCES iam.users (id) ON DELETE RESTRICT;
ALTER TABLE cash.movements
    ADD COLUMN IF NOT EXISTS journal_document_id bigint REFERENCES finance.journal_entries (document_id) ON DELETE RESTRICT;

-- A SALE row carries no reason and is written by the sale function; CASH_IN and
-- CASH_OUT must always carry one. Existing rows are all SALE, so this is safe.
ALTER TABLE cash.movements
    DROP CONSTRAINT IF EXISTS movements_reason_required_for_manual;
ALTER TABLE cash.movements
    ADD CONSTRAINT movements_reason_required_for_manual CHECK (
        movement_type = 'SALE'
        OR reason_code IN ('SUPPLIER_PAYMENT', 'EXPENSE', 'CHANGE_FLOAT', 'CORRECTION', 'OTHER')
    );

-- =============================================================================
-- 5. Shared helper: post a cash journal for this session, today
-- =============================================================================

CREATE OR REPLACE FUNCTION cash._post_cash_journal(
    p_description text,
    p_source_type text,
    p_source_id bigint,
    p_debit_account text,
    p_credit_account text,
    p_amount numeric
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_today date := (now() AT TIME ZONE 'Africa/Algiers')::date;
    v_period_id bigint;
    v_fiscal_year integer;
    v_journal_document_id bigint;
    v_sequence bigint;
    v_journal_number text;
BEGIN
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: journal amount must be positive' USING ERRCODE = '22023';
    END IF;

    SELECT id, extract(year FROM starts_on)::integer
    INTO v_period_id, v_fiscal_year
    FROM finance.fiscal_periods
    WHERE status = 'OPEN'
      AND v_today BETWEEN starts_on AND ends_on
    ORDER BY starts_on DESC
    LIMIT 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: no open fiscal period covers today'
            USING ERRCODE = '55000';
    END IF;

    INSERT INTO core.business_documents (document_type, document_date, fiscal_period_id, fiscal_year)
        VALUES ('JOURNAL_ENTRY', v_today, v_period_id, v_fiscal_year)
        RETURNING id INTO v_journal_document_id;

    INSERT INTO finance.journal_entries (document_id, description, source_type, source_id)
        VALUES (v_journal_document_id, p_description, p_source_type, p_source_id);

    INSERT INTO finance.journal_lines (document_id, line_number, account_code, account_id, debit, credit) VALUES
        (v_journal_document_id, 1, p_debit_account, finance.resolve_account_id(p_debit_account), p_amount, 0),
        (v_journal_document_id, 2, p_credit_account, finance.resolve_account_id(p_credit_account), 0, p_amount);

    v_sequence := core.claim_next_document_number('JOURNAL_ENTRY', v_fiscal_year);
    v_journal_number := 'JE-' || v_fiscal_year || '-' || lpad(v_sequence::text, 6, '0');
    UPDATE core.business_documents
        SET status = 'POSTED', sequence_number = v_sequence,
            document_number = v_journal_number, posted_at = now()
        WHERE id = v_journal_document_id;

    RETURN v_journal_document_id;
END;
$$;

-- =============================================================================
-- 6. Record money in or out of the drawer
-- =============================================================================

CREATE OR REPLACE FUNCTION cash.record_cash_movement(
    p_session_token text,
    p_cash_session_id bigint,
    p_movement_type text,
    p_amount numeric,
    p_reason_code text,
    p_note text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_user_id bigint;
    v_workstation_id text;
    v_status text;
    v_current_cashier_user_id bigint;
    v_session_workstation_id text;
    v_amount numeric(14, 2);
    v_journal_document_id bigint;
    v_movement_id bigint;
BEGIN
    SELECT user_id, workstation_id
    INTO v_user_id, v_workstation_id
    FROM iam.resolve_session_with_permission(p_session_token, 'RECORD_CASH_MOVEMENT');

    IF p_movement_type IS NULL OR p_movement_type NOT IN ('CASH_IN', 'CASH_OUT') THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: movement must be CASH_IN or CASH_OUT'
            USING ERRCODE = '22023';
    END IF;

    IF p_reason_code IS NULL OR p_reason_code NOT IN
        ('SUPPLIER_PAYMENT', 'EXPENSE', 'CHANGE_FLOAT', 'CORRECTION', 'OTHER') THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: unsupported cash movement reason'
            USING ERRCODE = '22023';
    END IF;

    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: amount must be greater than zero'
            USING ERRCODE = '22023';
    END IF;
    IF p_amount <> round(p_amount, 2) THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: amount must have at most two decimals'
            USING ERRCODE = '22023';
    END IF;
    v_amount := p_amount::numeric(14, 2);

    SELECT status, current_cashier_user_id, workstation_id
    INTO v_status, v_current_cashier_user_id, v_session_workstation_id
    FROM sales.cash_sessions
    WHERE id = p_cash_session_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'cash session not found' USING ERRCODE = '22023';
    END IF;
    IF v_status <> 'OPEN' THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: cash can only move while the session is open'
            USING ERRCODE = '55000';
    END IF;
    IF v_current_cashier_user_id <> v_user_id OR v_session_workstation_id <> v_workstation_id THEN
        RAISE EXCEPTION 'only the current cashier can record a cash movement' USING ERRCODE = '42501';
    END IF;

    IF p_movement_type = 'CASH_OUT' THEN
        v_journal_document_id := cash._post_cash_journal(
            'Cash out of drawer', 'CASH_MOVEMENT', p_cash_session_id,
            'CASH_TRANSIT', 'CASH_DESK', v_amount
        );
    ELSE
        v_journal_document_id := cash._post_cash_journal(
            'Cash into drawer', 'CASH_MOVEMENT', p_cash_session_id,
            'CASH_DESK', 'CASH_TRANSIT', v_amount
        );
    END IF;

    INSERT INTO cash.movements (
        cash_session_id, business_document_id, movement_type, amount,
        reason_code, note, recorded_by_user_id, journal_document_id
    ) VALUES (
        p_cash_session_id, NULL, p_movement_type, v_amount,
        p_reason_code, nullif(btrim(coalesce(p_note, '')), ''), v_user_id, v_journal_document_id
    ) RETURNING id INTO v_movement_id;

    RETURN jsonb_build_object(
        'movement_id', v_movement_id,
        'cash_session_id', p_cash_session_id,
        'movement_type', p_movement_type,
        'amount', v_amount::text,
        'reason_code', p_reason_code,
        'journal_document_id', v_journal_document_id
    );
END;
$$;

-- =============================================================================
-- 7. Read models
-- =============================================================================

CREATE OR REPLACE FUNCTION cash.list_cash_movements(
    p_session_token text,
    p_cash_session_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_result jsonb;
BEGIN
    PERFORM 1 FROM iam.resolve_session(p_session_token);

    SELECT coalesce(jsonb_agg(
        jsonb_build_object(
            'movement_id', m.id,
            'movement_type', m.movement_type,
            'amount', m.amount::text,
            'reason_code', m.reason_code,
            'note', m.note,
            'business_document_id', m.business_document_id,
            'journal_document_id', m.journal_document_id,
            'created_at', m.created_at
        ) ORDER BY m.created_at DESC, m.id DESC
    ), '[]'::jsonb)
    INTO v_result
    FROM cash.movements m
    WHERE m.cash_session_id = p_cash_session_id;

    RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION cash.get_session_policy(p_session_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_result jsonb;
BEGIN
    PERFORM 1 FROM iam.resolve_session(p_session_token);

    SELECT jsonb_build_object(
        'material_variance_threshold', policy.material_variance_threshold::text,
        'updated_at', policy.updated_at
    )
    INTO v_result
    FROM cash.session_policy policy
    WHERE policy.id = 1;

    RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION cash.save_session_policy(
    p_session_token text,
    p_material_variance_threshold numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_CASH_POLICY');

    IF p_material_variance_threshold IS NULL OR p_material_variance_threshold < 0 THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: tolerance must not be negative' USING ERRCODE = '22023';
    END IF;
    IF p_material_variance_threshold <> round(p_material_variance_threshold, 2) THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: tolerance must have at most two decimals'
            USING ERRCODE = '22023';
    END IF;

    UPDATE cash.session_policy
    SET material_variance_threshold = p_material_variance_threshold::numeric(14, 2)
    WHERE id = 1;

    RETURN cash.get_session_policy(p_session_token);
END;
$$;

-- =============================================================================
-- 8. Replace the blind-count submission
-- =============================================================================

CREATE OR REPLACE FUNCTION cash.submit_cash_session_count(
    p_session_token text,
    p_cash_session_id bigint,
    p_counts jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_user_id bigint;
    v_workstation_id text;
    v_status text;
    v_current_cashier_user_id bigint;
    v_session_workstation_id text;
    v_opening_float numeric(14,2);
    v_active_denom_count integer;
    v_payload_count integer;
    v_distinct_count integer;
    v_expected numeric(14,2);
    v_counted numeric(14,2);
    v_variance numeric(14,2);
    v_threshold numeric(14,2);
    v_requires_approval boolean;
    v_attempt_number integer;
    v_attempt_id bigint;
BEGIN
    SELECT user_id, workstation_id
    INTO v_user_id, v_workstation_id
    FROM iam.resolve_session_with_permission(p_session_token, 'CLOSE_CASH_SESSION');

    SELECT status, current_cashier_user_id, workstation_id, opening_float
    INTO v_status, v_current_cashier_user_id, v_session_workstation_id, v_opening_float
    FROM sales.cash_sessions
    WHERE id = p_cash_session_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'cash session not found' USING ERRCODE = '22023';
    END IF;
    IF v_status <> 'CLOSING' THEN
        RAISE EXCEPTION 'cash session is not awaiting a blind count' USING ERRCODE = '55000';
    END IF;
    IF v_current_cashier_user_id <> v_user_id OR v_session_workstation_id <> v_workstation_id THEN
        RAISE EXCEPTION 'only the current cashier can submit this blind count' USING ERRCODE = '42501';
    END IF;
    IF p_counts IS NULL OR jsonb_typeof(p_counts) <> 'array' THEN
        RAISE EXCEPTION 'denomination counts must be an array' USING ERRCODE = '22023';
    END IF;

    SELECT count(*) INTO v_active_denom_count FROM cash.denominations WHERE is_active;
    IF v_active_denom_count = 0 THEN
        RAISE EXCEPTION 'no active cash denominations are configured' USING ERRCODE = '55000';
    END IF;

    v_payload_count := jsonb_array_length(p_counts);
    IF v_payload_count <> v_active_denom_count THEN
        RAISE EXCEPTION 'blind count must include every active denomination exactly once'
            USING ERRCODE = '22023';
    END IF;

    BEGIN
        SELECT count(DISTINCT (elem ->> 'denomination_id')::bigint)
        INTO v_distinct_count
        FROM jsonb_array_elements(p_counts) elem;

        IF v_distinct_count <> v_payload_count THEN
            RAISE EXCEPTION 'duplicate or missing denomination in blind count' USING ERRCODE = '22023';
        END IF;

        IF EXISTS (
            SELECT 1
            FROM jsonb_array_elements(p_counts) elem
            LEFT JOIN cash.denominations d
              ON d.id = (elem ->> 'denomination_id')::bigint
             AND d.is_active
            WHERE d.id IS NULL
               OR (elem ->> 'quantity') IS NULL
               OR (elem ->> 'quantity')::bigint < 0
        ) THEN
            RAISE EXCEPTION 'invalid denomination count' USING ERRCODE = '22023';
        END IF;
    EXCEPTION
        WHEN invalid_text_representation OR numeric_value_out_of_range THEN
            RAISE EXCEPTION 'invalid denomination count' USING ERRCODE = '22023';
    END;

    -- WS-F-005 change 1 of 2: expected cash is now signed. A sale and a cash-in
    -- add to the drawer; a cash-out takes away. Amounts are stored positive, so
    -- the direction is applied here rather than in the stored value.
    SELECT round(v_opening_float + coalesce(sum(
        CASE WHEN m.movement_type = 'CASH_OUT' THEN -m.amount ELSE m.amount END
    ), 0), 2)
    INTO v_expected
    FROM cash.movements m
    WHERE m.cash_session_id = p_cash_session_id;

    BEGIN
        SELECT round(sum(d.value * (elem ->> 'quantity')::bigint), 2)
        INTO v_counted
        FROM jsonb_array_elements(p_counts) elem
        JOIN cash.denominations d ON d.id = (elem ->> 'denomination_id')::bigint;
    EXCEPTION
        WHEN invalid_text_representation OR numeric_value_out_of_range THEN
            RAISE EXCEPTION 'invalid denomination count' USING ERRCODE = '22023';
    END;

    SELECT material_variance_threshold INTO v_threshold
    FROM cash.session_policy
    WHERE id = 1
    FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'cash session policy is not configured' USING ERRCODE = '55000';
    END IF;

    v_variance := round(v_counted - v_expected, 2);
    v_requires_approval := abs(v_variance) > v_threshold;

    SELECT coalesce(max(attempt_number), 0) + 1
    INTO v_attempt_number
    FROM cash.session_close_attempts
    WHERE cash_session_id = p_cash_session_id;

    INSERT INTO cash.session_close_attempts (
        cash_session_id, attempt_number, submitted_by_user_id,
        expected_amount, counted_amount, variance_amount,
        materiality_threshold, requires_manager_approval
    ) VALUES (
        p_cash_session_id, v_attempt_number, v_user_id,
        v_expected, v_counted, v_variance,
        v_threshold, v_requires_approval
    ) RETURNING id INTO v_attempt_id;

    INSERT INTO cash.session_close_count_lines (
        close_attempt_id, denomination_id, denomination_code,
        denomination_value, quantity, line_total
    )
    SELECT
        v_attempt_id,
        d.id,
        d.code,
        d.value,
        (elem ->> 'quantity')::bigint,
        round(d.value * (elem ->> 'quantity')::bigint, 2)
    FROM jsonb_array_elements(p_counts) elem
    JOIN cash.denominations d ON d.id = (elem ->> 'denomination_id')::bigint
    ORDER BY d.display_order, d.id;

    INSERT INTO cash.cash_session_events (
        cash_session_id, event_type, actor_user_id, close_attempt_id
    ) VALUES (
        p_cash_session_id, 'COUNT_SUBMITTED', v_user_id, v_attempt_id
    );

    IF v_requires_approval THEN
        UPDATE sales.cash_sessions
        SET status = 'PENDING_APPROVAL'
        WHERE id = p_cash_session_id;
    ELSE
        UPDATE sales.cash_sessions
        SET status = 'CLOSED',
            closed_by_user_id = v_user_id,
            expected_amount = v_expected,
            counted_amount = v_counted,
            variance_amount = v_variance,
            closed_at = now()
        WHERE id = p_cash_session_id;

        -- WS-F-005 change 2 of 2: a closing difference is real money and now
        -- reaches the ledger. Short: the shop lost it, so the expense is
        -- debited and cash credited. Over: the reverse.
        IF v_variance < 0 THEN
            PERFORM cash._post_cash_journal(
                'Cash session shortfall', 'CASH_SESSION', p_cash_session_id,
                'CASH_VARIANCE', 'CASH_DESK', -v_variance
            );
        ELSIF v_variance > 0 THEN
            PERFORM cash._post_cash_journal(
                'Cash session overage', 'CASH_SESSION', p_cash_session_id,
                'CASH_DESK', 'CASH_VARIANCE', v_variance
            );
        END IF;

        INSERT INTO cash.cash_session_events (
            cash_session_id, event_type, actor_user_id, close_attempt_id
        ) VALUES (
            p_cash_session_id, 'AUTO_CLOSED', v_user_id, v_attempt_id
        );
    END IF;

    RETURN jsonb_build_object(
        'cash_session_id', p_cash_session_id,
        'close_attempt_id', v_attempt_id,
        'status', CASE WHEN v_requires_approval THEN 'PENDING_APPROVAL' ELSE 'CLOSED' END,
        'expected_amount', v_expected::text,
        'counted_amount', v_counted::text,
        'variance_amount', v_variance::text,
        'requires_manager_approval', v_requires_approval
    );
END;
$$;

-- =============================================================================
-- 9. Replace the manager approval so it posts the same journal
-- =============================================================================

CREATE OR REPLACE FUNCTION cash.approve_cash_session_variance(
    p_session_token text,
    p_cash_session_id bigint,
    p_close_attempt_id bigint,
    p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_manager_user_id bigint;
    v_manager_workstation_id text;
    v_status text;
    v_session_workstation_id text;
    v_submitted_by_user_id bigint;
    v_expected numeric(14,2);
    v_counted numeric(14,2);
    v_variance numeric(14,2);
    v_requires_approval boolean;
BEGIN
    SELECT user_id, workstation_id
    INTO v_manager_user_id, v_manager_workstation_id
    FROM iam.resolve_session_with_permission(p_session_token, 'APPROVE_CASH_VARIANCE');

    IF btrim(coalesce(p_reason, '')) = '' THEN
        RAISE EXCEPTION 'variance approval reason is required' USING ERRCODE = '22023';
    END IF;

    SELECT status, workstation_id
    INTO v_status, v_session_workstation_id
    FROM sales.cash_sessions
    WHERE id = p_cash_session_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'cash session not found' USING ERRCODE = '22023';
    END IF;
    IF v_status <> 'PENDING_APPROVAL' THEN
        RAISE EXCEPTION 'cash session is not pending variance approval' USING ERRCODE = '55000';
    END IF;
    IF v_session_workstation_id <> v_manager_workstation_id THEN
        RAISE EXCEPTION 'variance approval must occur on the same workstation' USING ERRCODE = '42501';
    END IF;

    SELECT submitted_by_user_id, expected_amount, counted_amount,
           variance_amount, requires_manager_approval
    INTO v_submitted_by_user_id, v_expected, v_counted,
         v_variance, v_requires_approval
    FROM cash.session_close_attempts
    WHERE id = p_close_attempt_id
      AND cash_session_id = p_cash_session_id;

    IF NOT FOUND OR NOT v_requires_approval THEN
        RAISE EXCEPTION 'close attempt is not eligible for manager approval' USING ERRCODE = '55000';
    END IF;
    IF EXISTS (
        SELECT 1 FROM cash.session_close_approvals
        WHERE close_attempt_id = p_close_attempt_id
    ) THEN
        RAISE EXCEPTION 'close attempt has already been approved' USING ERRCODE = '55000';
    END IF;

    INSERT INTO cash.session_close_approvals (
        close_attempt_id, approved_by_user_id, reason
    ) VALUES (
        p_close_attempt_id, v_manager_user_id, btrim(p_reason)
    );

    UPDATE sales.cash_sessions
    SET status = 'CLOSED',
        closed_by_user_id = v_submitted_by_user_id,
        expected_amount = v_expected,
        counted_amount = v_counted,
        variance_amount = v_variance,
        closed_at = now()
    WHERE id = p_cash_session_id;

    -- WS-F-005: an approved variance posts the same journal an auto-accepted
    -- one does. Approval changes who signed it off, not the accounting.
    IF v_variance < 0 THEN
        PERFORM cash._post_cash_journal(
            'Cash session shortfall', 'CASH_SESSION', p_cash_session_id,
            'CASH_VARIANCE', 'CASH_DESK', -v_variance
        );
    ELSIF v_variance > 0 THEN
        PERFORM cash._post_cash_journal(
            'Cash session overage', 'CASH_SESSION', p_cash_session_id,
            'CASH_DESK', 'CASH_VARIANCE', v_variance
        );
    END IF;

    INSERT INTO cash.cash_session_events (
        cash_session_id, event_type, actor_user_id, close_attempt_id, reason
    ) VALUES (
        p_cash_session_id, 'VARIANCE_APPROVED', v_manager_user_id,
        p_close_attempt_id, btrim(p_reason)
    );

    RETURN jsonb_build_object(
        'cash_session_id', p_cash_session_id,
        'close_attempt_id', p_close_attempt_id,
        'status', 'CLOSED',
        'expected_amount', v_expected::text,
        'counted_amount', v_counted::text,
        'variance_amount', v_variance::text,
        'requires_manager_approval', true,
        'approved_by_user_id', v_manager_user_id
    );
END;
$$;

-- =============================================================================
-- 10. Privileges
-- =============================================================================

REVOKE ALL ON FUNCTION cash._post_cash_journal(text, text, bigint, text, text, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION cash.record_cash_movement(text, bigint, text, numeric, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION cash.list_cash_movements(text, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION cash.get_session_policy(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION cash.save_session_policy(text, numeric) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION cash.record_cash_movement(text, bigint, text, numeric, text, text) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION cash.list_cash_movements(text, bigint) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION cash.get_session_policy(text) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION cash.save_session_policy(text, numeric) TO stockiha_runtime;

RESET ROLE;
```

**Two things to verify before you run this.** Both must be true; if either is not, **stop and report**.

```bash
grep -rn "FUNCTION iam.resolve_session(" src-tauri/migrations/*.sql
grep -rn "current_cashier_user_id" src-tauri/migrations/20260731130000_cash_session_lifecycle.sql | head -3
```

The first must find a single-text-argument `iam.resolve_session`. The second must show `sales.cash_sessions` really has a `current_cashier_user_id` column.

---

### T2 — Rust

Create `src-tauri/src/domain/cash_policy.rs`:

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CashMovementDto {
    pub movement_id: i64,
    pub movement_type: String,
    pub amount: String,
    pub reason_code: Option<String>,
    pub note: Option<String>,
    pub business_document_id: Option<i64>,
    pub journal_document_id: Option<i64>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecordCashMovementResult {
    pub movement_id: i64,
    pub cash_session_id: i64,
    pub movement_type: String,
    pub amount: String,
    pub reason_code: String,
    pub journal_document_id: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CashSessionPolicyDto {
    pub material_variance_threshold: String,
    pub updated_at: String,
}
```

Register it in `src-tauri/src/domain/mod.rs` with `pub mod cash_policy;` in the existing style.

Then add four service functions and four commands, following **exactly** the pattern of `list_supplier_balances` / `post_purchase_payment` in `src-tauri/src/application/procurement_service.rs` and `src-tauri/src/commands/procurement.rs` — same `query_scalar`, same `AppError::from_posting_error`, same `serde_json::from_value`, same `db::pool_or_unavailable`:

- `record_cash_movement(pool, session_token, cash_session_id: i64, movement_type: &str, amount: Decimal, reason_code: &str, note: Option<&str>) -> RecordCashMovementResult`, calling `SELECT cash.record_cash_movement($1, $2, $3, $4, $5, $6)`
- `list_cash_movements(pool, session_token, cash_session_id: i64) -> Vec<CashMovementDto>`
- `get_cash_session_policy(pool, session_token) -> CashSessionPolicyDto`
- `save_cash_session_policy(pool, session_token, threshold: Decimal) -> CashSessionPolicyDto`

Put them in whichever existing file already holds the cash-session service functions — find it with:

```bash
grep -rln "submit_cash_session_count" src-tauri/src
```

Register all four commands in `src-tauri/src/lib.rs` alongside the existing cash-session commands, in the same style.

The amount arrives from the frontend as a string and is parsed into a `Decimal` in the service function, exactly as `post_purchase_payment` does it. Never as a float.

---

### T3 — TypeScript IPC layer

In `src/shared/ipc/commands.ts`, add four entries:

```ts
  RECORD_CASH_MOVEMENT: 'record_cash_movement',
  LIST_CASH_MOVEMENTS: 'list_cash_movements',
  GET_CASH_SESSION_POLICY: 'get_cash_session_policy',
  SAVE_CASH_SESSION_POLICY: 'save_cash_session_policy',
```

In `src/shared/ipc/cashSessionDto.ts`, append:

```ts
export type CashMovementDirection = 'CASH_IN' | 'CASH_OUT';

export type CashMovementReason =
  | 'SUPPLIER_PAYMENT'
  | 'EXPENSE'
  | 'CHANGE_FLOAT'
  | 'CORRECTION'
  | 'OTHER';

export interface CashMovement {
  movement_id: number;
  movement_type: 'SALE' | CashMovementDirection;
  amount: string;
  reason_code: CashMovementReason | null;
  note: string | null;
  business_document_id: number | null;
  journal_document_id: number | null;
  created_at: string;
}

export interface RecordCashMovementResult {
  movement_id: number;
  cash_session_id: number;
  movement_type: CashMovementDirection;
  amount: string;
  reason_code: CashMovementReason;
  journal_document_id: number;
}

export interface CashSessionPolicy {
  material_variance_threshold: string;
  updated_at: string;
}
```

In `src/shared/ipc/cashSessionGateway.ts`, add four functions following the casing convention that file already uses for its arguments:

```ts
recordCashMovement(sessionToken, cashSessionId, movementType, amount, reasonCode, note)
listCashMovements(sessionToken, cashSessionId)
getCashSessionPolicy(sessionToken)
saveCashSessionPolicy(sessionToken, materialVarianceThreshold)
```

---

### T4 — Cash in and out on the cash session screen

All edits are in `src/features/cash-session/CashSessionScreen.tsx`.

This screen holds its strings in a local `COPY` object at the top of the file rather than in the shared i18n file. **Follow that existing pattern** — add your keys to that `COPY` object in all three locales. Do not move the screen to the shared i18n file.

**4a.** Add state:

```tsx
const [movements, setMovements] = useState<CashMovement[]>([]);
const [movementDirection, setMovementDirection] = useState<CashMovementDirection>('CASH_OUT');
const [movementAmount, setMovementAmount] = useState('');
const [movementReason, setMovementReason] = useState<CashMovementReason>('EXPENSE');
const [movementNote, setMovementNote] = useState('');
```

**4b.** Load the movements whenever the session refreshes. Inside `refreshLifecycle`, after `setCurrent(session)`, add:

```tsx
    if (session) {
      setMovements(await cashIpc.listCashMovements(token, session.id).catch(() => []));
    } else {
      setMovements([]);
    }
```

**4c.** Add the handler, next to the other handlers:

```tsx
  async function recordMovement(event: FormEvent) {
    event.preventDefault();
    if (!current) return;
    if (!AMOUNT_RE.test(movementAmount) || movementAmount === '0') {
      setError(text.movementAmountInvalid);
      return;
    }
    await run(async () => {
      await cashIpc.recordCashMovement(
        token,
        current.id,
        movementDirection,
        movementAmount,
        movementReason,
        movementNote.trim() || null,
      );
      setMovementAmount('');
      setMovementNote('');
      setInfo(text.movementRecorded);
      await sync();
    });
  }
```

`AMOUNT_RE` already exists at the top of this file and matches a decimal with up to two places. Use it. Do not write another one and do not use `Number()`.

**4d.** Render the panel, visible **only** when `current` exists and `current.status === 'OPEN'`. Place it after the session header and before the close section:

```tsx
{current && current.status === 'OPEN' ? (
  <section data-testid="cash-movement-panel">
    <h3>{text.movementsTitle}</h3>
    <p>{text.movementsHelp}</p>

    <form onSubmit={recordMovement}>
      <label>
        {text.direction}
        <select
          value={movementDirection}
          onChange={(e) => setMovementDirection(e.target.value as CashMovementDirection)}
          data-testid="cash-movement-direction"
        >
          <option value="CASH_OUT">{text.cashOut}</option>
          <option value="CASH_IN">{text.cashIn}</option>
        </select>
      </label>

      <TextField
        label={`${text.amount} (DZD)`}
        value={movementAmount}
        onChange={setMovementAmount}
        testId="cash-movement-amount"
      />

      <label>
        {text.reason}
        <select
          value={movementReason}
          onChange={(e) => setMovementReason(e.target.value as CashMovementReason)}
          data-testid="cash-movement-reason"
        >
          <option value="EXPENSE">{text.reasonExpense}</option>
          <option value="SUPPLIER_PAYMENT">{text.reasonSupplier}</option>
          <option value="CHANGE_FLOAT">{text.reasonChange}</option>
          <option value="CORRECTION">{text.reasonCorrection}</option>
          <option value="OTHER">{text.reasonOther}</option>
        </select>
      </label>

      <TextField
        label={text.note}
        value={movementNote}
        onChange={setMovementNote}
        testId="cash-movement-note"
      />

      <Button type="submit" disabled={busy} testId="cash-movement-submit">
        {text.recordMovement}
      </Button>
    </form>

    <table data-testid="cash-movement-list">
      <tbody>
        {movements
          .filter((m) => m.movement_type !== 'SALE')
          .map((m) => (
            <tr key={m.movement_id} data-testid={`cash-movement-${m.movement_id}`}>
              <td>{m.movement_type === 'CASH_OUT' ? text.cashOut : text.cashIn}</td>
              <td>{m.amount} DZD</td>
              <td>{m.reason_code ? text[`reasonTag_${m.reason_code}`] : ''}</td>
              <td>{m.note ?? ''}</td>
            </tr>
          ))}
      </tbody>
    </table>
  </section>
) : null}
```

Use the `TextField` and `Button` prop names exactly as this file already uses them — read the existing forms in it first. If `TextField` does not take an `onChange` that receives a string, adapt the call to whatever signature it really has and **say so in your report**.

**4e.** Add these keys to the `COPY` object in this file, all three locales:

| key | en | fr | ar |
|---|---|---|---|
| `movementsTitle` | `Cash in and out` | `Entrées et sorties de caisse` | `دخول وخروج النقد` |
| `movementsHelp` | `Record money taken from or added to the drawer during the day, so the closing count matches.` | `Enregistrez l'argent retiré ou ajouté à la caisse pendant la journée, pour que le comptage final corresponde.` | `سجّل المال المسحوب من الصندوق أو المضاف إليه خلال اليوم حتى يتطابق الجرد النهائي.` |
| `direction` | `Direction` | `Sens` | `الاتجاه` |
| `cashIn` | `Money in` | `Entrée` | `دخول` |
| `cashOut` | `Money out` | `Sortie` | `خروج` |
| `amount` | `Amount` | `Montant` | `المبلغ` |
| `reason` | `Reason` | `Motif` | `السبب` |
| `reasonExpense` | `Expense` | `Dépense` | `مصروف` |
| `reasonSupplier` | `Paid a supplier` | `Paiement fournisseur` | `دفع لمورد` |
| `reasonChange` | `Change float` | `Appoint de monnaie` | `صرف عملة` |
| `reasonCorrection` | `Correction` | `Correction` | `تصحيح` |
| `reasonOther` | `Other` | `Autre` | `أخرى` |
| `reasonTag_EXPENSE` | `Expense` | `Dépense` | `مصروف` |
| `reasonTag_SUPPLIER_PAYMENT` | `Supplier` | `Fournisseur` | `مورد` |
| `reasonTag_CHANGE_FLOAT` | `Change` | `Monnaie` | `عملة` |
| `reasonTag_CORRECTION` | `Correction` | `Correction` | `تصحيح` |
| `reasonTag_OTHER` | `Other` | `Autre` | `أخرى` |
| `note` | `Note` | `Note` | `ملاحظة` |
| `recordMovement` | `Record` | `Enregistrer` | `تسجيل` |
| `movementRecorded` | `Cash movement recorded` | `Mouvement de caisse enregistré` | `تم تسجيل حركة النقد` |
| `movementAmountInvalid` | `Enter an amount greater than zero, for example 500 or 500.50.` | `Saisissez un montant supérieur à zéro, par exemple 500 ou 500.50.` | `أدخل مبلغاً أكبر من صفر، مثال 500 أو 500.50.` |

Remove no existing key.

---

### T5 — The tolerance settings screen

Create `src/features/settings/CashPolicySettingsScreen.tsx`. Copy the structure, layout classes, loading and saving pattern, and permission handling of `src/features/settings/RecoverySettingsScreen.tsx` — read it first and follow it closely.

The screen contains:

1. One text input, `data-testid="cash-tolerance-input"`, bound to `material_variance_threshold`, validated with the same decimal rule used elsewhere (up to two decimal places, not negative).
2. Explanatory text: `t('cashPolicy.help')`.
3. A **Save** button, `data-testid="cash-tolerance-save"`, calling `saveCashSessionPolicy`, showing a success banner on return and the error text on failure.

Add these keys to `src/shared/i18n/locales.ts` in all three locale blocks. The Arabic block stores strings as escaped `\uXXXX` sequences — match that style.

| key | en | fr | ar |
|---|---|---|---|
| `cashPolicy.title` | `Cash variance tolerance` | `Tolérance d'écart de caisse` | `حد التسامح في فرق الصندوق` |
| `cashPolicy.threshold` | `Accept differences up to (DZD)` | `Accepter les écarts jusqu'à (DZD)` | `قبول الفروق حتى (دج)` |
| `cashPolicy.help` | `A closing difference at or below this amount closes the session automatically. Anything larger needs a manager.` | `Un écart de clôture inférieur ou égal à ce montant clôture la session automatiquement. Au-delà, un responsable est requis.` | `أي فرق عند الإغلاق لا يتجاوز هذا المبلغ يغلق الجلسة تلقائياً. وما زاد عنه يتطلب موافقة مسؤول.` |
| `cashPolicy.saved` | `Tolerance saved` | `Tolérance enregistrée` | `تم حفظ حد التسامح` |

Wire the screen into the Settings area exactly the way `RecoverySettingsScreen` is wired — same navigation mechanism, same permission gate, using `MANAGE_CASH_POLICY`. Read how that screen is reached and copy it. Do not invent a new routing mechanism.

---

### T6 — Tests

**6a. Database acceptance suite.** Create `src-tauri/tests/cash/ws_f_005_cash_session_completion_integration.sql`, copying the bootstrap style of `src-tauri/tests/sales/ws_f_003_sale_discount_integration.sql` exactly.

It must prove all of the following, with real numbers:

1. Open a session with an opening float of 2,000. Record a cash-out of 500 for reason `EXPENSE`. The movement row exists with `amount = 500.00` and `movement_type = 'CASH_OUT'`.
2. That cash-out posted a balanced journal debiting `CASH_TRANSIT` 500 and crediting `CASH_DESK` 500.
3. Record a cash-in of 300 for reason `CHANGE_FLOAT`. Its journal debits `CASH_DESK` 300 and credits `CASH_TRANSIT` 300.
4. Begin the close and submit a blind count equal to 1,800. Expected must be 2,000 − 500 + 300 = 1,800, variance 0.00, and the session closes with **no** manager approval and **no** variance journal.
5. In a second session with an opening float of 1,000 and no sales, submit a count of 970. Variance is −30.00, which is within the 50 tolerance, so it auto-closes, and a journal exists debiting `CASH_VARIANCE` 30 and crediting `CASH_DESK` 30.
6. In a third session, a variance of −80.00 exceeds the tolerance and leaves the session `PENDING_APPROVAL` with **no** journal posted yet.
7. Approving that variance closes the session and posts the journal, debiting `CASH_VARIANCE` 80 and crediting `CASH_DESK` 80.
8. An overage — counted above expected — posts the reverse: `CASH_DESK` debited, `CASH_VARIANCE` credited.
9. A cash movement is refused on a session that is not `OPEN`.
10. A cash movement is refused for a user who is not the session's current cashier.
11. A movement with a negative amount, a zero amount, a three-decimal amount, and an unsupported reason are each refused, and nothing is written.
12. `cash.movements` is still append-only — an `UPDATE` on a movement row is refused.
13. The default tolerance after this migration reads 50.00.
14. Every journal this migration can post balances: total debits equal total credits, and no line has a NULL `account_id`.

Register it in `src-tauri/tests/run_current_sql_suites.sh` after the WS-F-4 entry.

**6b. Workflow test.** Create `tests/cash-movement.workflow.test.tsx`, copying the mocks and structure of an existing cash-session test if one exists, otherwise of `tests/recovery-settings.workflow.test.tsx`. Four tests:

1. With an `OPEN` session, `cash-movement-panel` is present.
2. With a `CLOSING` session, `cash-movement-panel` is absent.
3. Entering `500`, reason `EXPENSE`, direction `CASH_OUT`, and submitting calls `record_cash_movement` once with those values and the amount as the string `'500'`.
4. Entering `0` shows the invalid-amount message and calls nothing.

**6c. Existing tests.** Every test in `tests/` must still pass. A test that asserted a one-dinar variance requires manager approval is now asserting the opposite of intended behaviour — update it and **name it explicitly in your report**, with what it asserted before. Do not delete it. Do not weaken an assertion for any other reason.

---

### T7 — What you must not change on this screen

The blind count, the close attempts, suspend, resume, handover, and the manager approval form are all finished and working. You are **adding a panel** to this screen, not reorganising it. Do not restyle it, do not move existing sections, do not touch the handover form even though it is unused.

---

### T8 — Leave the sale path alone

`sales.confirm_cash_sale` already writes its `SALE` movement and is unchanged by this sub-plan. Do not touch it, do not add a reason to it, do not change its cash amount.

---

## 5. Scope — OUT. Do not touch.

- `sales.confirm_cash_sale`, `sales.confirm_credit_sale`, and everything WS-F-3 and WS-F-4 built.
- `cash.enqueue_drawer_job`, the physical drawer, drawer pulses. Deferred to a future workstream.
- The printable session report — that is WS-F-6.
- The whole-sale void — that is WS-F-6.
- Supplier payments in procurement. They are **not** being linked to the drawer in this sub-plan; a cash-out with the supplier reason is how that is recorded for now.
- `cash.forbid_movement_mutation` and the append-only trigger on `cash.movements`.
- The blind-count validation, the close-attempt tables, `cash.session_close_approvals`, suspend, resume, handover.
- `finance.resolve_account_id`, `finance.require_account_role`, the `finance.account_role_code` enum, every account other than the three new rows.
- Any existing migration file. Forward-only: your one new migration is the only SQL change.
- Printing, procurement, inventory, catalogue, customers.
- `package.json`, `package-lock.json`, `Cargo.toml`, `Cargo.lock`.
- `STOCKIHA_GROUND_TRUTH.md`, `AGENTS.md`, `CURRENT_STEP.md`, `README.md`, `TASKS.md`, `GEMINI.md`.

If you find a genuine unrelated bug: **report it, do not fix it.**

---

## 6. Constraints

- **Never use floating point for money.** Strings in TypeScript, `Decimal` in Rust, `numeric(14,2)` in PostgreSQL. No `Number()`, no `parseFloat`, no arithmetic on a money string in the frontend.
- Amounts are stored positive. Direction lives in `movement_type` and nowhere else.
- Cash movements are append-only. No edit, no delete, no soft-delete.
- Every user-facing string on the cash-session screen goes in that file's local `COPY` object in all three locales; settings-screen strings go in the shared i18n file. No hardcoded English in JSX.
- Logical CSS properties only. Arabic RTL must keep working.
- No new npm dependency and no new Rust crate.
- No placeholder, no `TODO`, no mock, no commented-out block left behind.
- Show your file plan before editing. If it names a file outside the list below, you have misread the task — stop.

Files this task may touch:

```
src-tauri/migrations/20260916090000_ws_f_005_cash_session_completion.sql   (new)
src-tauri/src/domain/cash_policy.rs                                        (new)
src-tauri/src/domain/mod.rs                                                (one line)
src-tauri/src/application/…   cash-session service file                    (four functions)
src-tauri/src/commands/…      cash-session command file                    (four commands)
src-tauri/src/lib.rs                                                       (four lines)
src/shared/ipc/commands.ts                                                 (four entries)
src/shared/ipc/cashSessionDto.ts                                           (appended)
src/shared/ipc/cashSessionGateway.ts                                       (appended)
src/features/cash-session/CashSessionScreen.tsx                            (edited)
src/features/settings/CashPolicySettingsScreen.tsx                         (new)
src/shared/i18n/locales.ts                                                 (edited)
src-tauri/tests/cash/ws_f_005_cash_session_completion_integration.sql      (new)
src-tauri/tests/run_current_sql_suites.sh                                  (one line)
tests/cash-movement.workflow.test.tsx                                      (new)
plus whichever file wires Settings navigation, matching RecoverySettingsScreen
plus existing test files, per 6c
```

---

## 7. Acceptance criteria

1. The migration applies cleanly on top of every earlier migration and `sqlx` records it. No existing migration file is modified.
2. `cargo fmt --check`, `cargo check`, `cargo clippy -- -D warnings`, `cargo test` all pass.
3. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` all pass.
4. Every SQL suite in `run_current_sql_suites.sh` passes, including the new one.
5. The tolerance reads 50.00 after the migration, and a Manager can change it from Settings.
6. A Cashier can record money out and money in while the session is open, with a reason, and sees them listed.
7. Neither is possible once the session is closing, closed or suspended, nor for anyone but the session's own cashier.
8. Expected cash at closing equals opening float, plus sales, plus money in, minus money out.
9. A closing difference within the tolerance closes the session with no manager involved.
10. A closing difference beyond the tolerance still requires a manager, exactly as before.
11. Every closing difference — auto-accepted or manager-approved — posts one balanced journal, shortfall one way and overage the other.
12. Every cash movement posts one balanced journal moving between cash and the transfer account.
13. Cash movements cannot be edited or deleted.
14. Selling still works exactly as before and still records its own cash movement.
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
feat(cash): WS-F-5 cash in and out, 50 DA variance tolerance, variance posted to the ledger
```

Push the branch. Do not merge into `main`.

---

## 9. Report back — required format

```
WS-F-5 REPORT

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

Did you copy cash.submit_cash_session_count and cash.approve_cash_session_variance
exactly as written in this plan? yes/no
If no, state every difference, line by line.

Existing tests I changed, and what each asserted before:

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

1. Sign in as Admin, open Settings. The cash tolerance should read 50.00. Leave it there for now.
2. Open a cash session with an opening float of 2,000.
3. On the cash session screen, record money out: 500, reason Expense, note "delivery man". It should appear in the list below.
4. Record money in: 300, reason Change float.
5. Ring up a cash sale of 1,200 at the till.
6. Come back and begin the blind close. Count the drawer honestly — it should hold 3,000. Submit.
7. The session should close with no manager prompt and no difference.
8. Open a new session with 1,000, sell nothing, and close it counting 970 — 30 short. It should still close on its own, because 30 is under the tolerance.
9. Open Journals. Find the entry for that shortfall: cash-variance debited 30, cash credited 30. That entry appearing at all is the main thing this sub-plan fixes.
10. Open another session with 1,000 and close it counting 900 — 100 short. Now it must ask for a manager. Approve it and check the journal posted the same way.
11. Try to record money out on a session that is already closing. It must be refused.
12. As Admin, change the tolerance to 200 in Settings, then repeat step 10. It should now close on its own.
13. Switch the language to French, then Arabic. Check the cash in and out panel reads correctly and Arabic stays right-to-left.
