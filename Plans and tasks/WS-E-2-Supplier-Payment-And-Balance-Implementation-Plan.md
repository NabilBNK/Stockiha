# WS-E-2 — Supplier Payment and Balance

**Workstream:** WS-E — Procurement & Supplier Operations
**Sub-plan:** 2 of 3
**Executing agent:** Gemini (Antigravity IDE)
**Base branch:** `task/ws-e-1-purchases-redesign`
**Branch to create:** `task/ws-e-2-supplier-payments`
**Risk class:** HIGH. This touches money, journals, a new SQL migration, and Rust posting code.

---

## 0. Authority, precedence, and the override you are being given

Read in this order before touching anything:

1. This document.
2. `GEMINI.md`
3. `AGENTS.md`

This document wins where they differ.

**Explicit, limited override of `GEMINI.md` section 2.** `GEMINI.md` tells you to stop when a task touches money, journals, SQL migrations, `SECURITY DEFINER` functions, or Rust that posts a business transaction. This task touches all of those. You are authorised to proceed **only** because every line of SQL and Rust you need is written out for you in this document. You are transcribing, not designing.

The condition attached to that override:

> **Do not invent, adapt, "improve", reorder, rename, or optimise any SQL or Rust in this document. Copy it exactly.**

If something does not compile or a test fails, report it. Do not repair it by changing the logic. A wrong repair here corrupts the client's accounts.

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

Then:

```bash
git checkout task/ws-e-1-purchases-redesign
git pull origin task/ws-e-1-purchases-redesign
git checkout -b task/ws-e-2-supplier-payments
```

Work only on `task/ws-e-2-supplier-payments`.

---

## 2. Background — what this feature is and why the design is what it is

Read this so you understand what you are building. You still may not change the design.

Today, confirming a purchase writes one journal entry:

```
Debit  Inventory   (the goods are now ours)
Credit GRNI        (we owe the supplier for them)
```

`GRNI` stands for "goods received, not invoiced". Nothing in the application ever reduces it, so the client's books show a supplier debt that only grows. This sub-plan adds the missing half:

```
Debit  GRNI        (we owe the supplier less now)
Credit Cash / Bank (the money left)
```

**Ruling that you must not deviate from:** in this MVP, GRNI *is* the supplier balance. A payment debits GRNI. There are no supplier invoices, and none are being added.

Consequences, all deliberate:

- `inventory.confirm_direct_purchase` is **not modified**. It already works and is covered by tests. Everything in this sub-plan is new and sits beside it.
- Payments are recorded **after** the purchase is posted, as a separate, separately-numbered document. Two documents, two journals, each atomic on its own.
- A payment may be partial. Several payments may settle one purchase. The sum of payments may never exceed the purchase total.
- Payment methods are exactly two: `CASH` and `BANK_TRANSFER`. There is no credit method — an unpaid purchase is simply a purchase with no payment recorded yet.
- A cash payment posts to the cash ledger account only. It does **not** create a cash-drawer movement and does **not** require an open cash session. That coupling belongs to WS-F and is deliberately out of scope here. Do not add it.

---

## 3. Objective

Let the user record what was paid to a supplier against a specific purchase, see at a glance which purchases are paid, partly paid or unpaid, and see how much is owed to each supplier in total.

---

## 4. Scope — IN

Nine tasks, in this order. Do not reorder them: later tasks depend on earlier ones compiling.

---

### T1 — The migration

Create **one** new file, exactly at this path and with exactly this name:

```
src-tauri/migrations/20260911090000_ws_e_002_purchase_payments.sql
```

Its full content is below. Copy it verbatim. Do not edit any existing migration file. Do not create a second migration.

```sql
-- WS-E-002: supplier payment against a posted purchase receipt.
--
-- In this MVP there are no supplier invoices. inventory.confirm_direct_purchase
-- credits GRNI when goods arrive, and this migration adds the settlement side:
-- a payment debits GRNI and credits Cash or Bank. GRNI is therefore the
-- effective supplier balance. inventory.confirm_direct_purchase is deliberately
-- left untouched; every object here is new and additive.
--
-- A cash payment posts to the cash ledger account only. It intentionally does
-- not write a cash.movements row and does not require an open cash session --
-- drawer integration is WS-F scope.

SET ROLE stockiha_owner;

-- =============================================================================
-- 1. Payment table
-- =============================================================================

CREATE TABLE IF NOT EXISTS procurement.purchase_receipt_payments (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    document_id         bigint NOT NULL UNIQUE REFERENCES core.business_documents (id) ON DELETE RESTRICT,
    receipt_document_id bigint NOT NULL REFERENCES procurement.purchase_receipts (document_id) ON DELETE RESTRICT,
    supplier_id         bigint NOT NULL REFERENCES procurement.suppliers (id) ON DELETE RESTRICT,
    payment_method      text NOT NULL,
    amount              numeric(14, 2) NOT NULL,
    reference_number    text,
    journal_document_id bigint NOT NULL REFERENCES finance.journal_entries (document_id) ON DELETE RESTRICT,
    posted_by_user_id   bigint NOT NULL REFERENCES iam.users (id) ON DELETE RESTRICT,
    created_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT purchase_receipt_payments_method_valid
        CHECK (payment_method IN ('CASH', 'BANK_TRANSFER')),
    CONSTRAINT purchase_receipt_payments_amount_positive
        CHECK (amount > 0)
);

CREATE INDEX IF NOT EXISTS purchase_receipt_payments_receipt_idx
    ON procurement.purchase_receipt_payments (receipt_document_id);

CREATE INDEX IF NOT EXISTS purchase_receipt_payments_supplier_idx
    ON procurement.purchase_receipt_payments (supplier_id);

-- =============================================================================
-- 2. Immutability -- a posted payment is business evidence, never edited
-- =============================================================================

CREATE OR REPLACE FUNCTION procurement.forbid_purchase_payment_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'IMMUTABLE_RECORD: posted supplier payments cannot be modified or deleted'
        USING ERRCODE = '0A000';
END;
$$;

DROP TRIGGER IF EXISTS purchase_receipt_payments_immutable
    ON procurement.purchase_receipt_payments;

CREATE TRIGGER purchase_receipt_payments_immutable
    BEFORE UPDATE OR DELETE ON procurement.purchase_receipt_payments
    FOR EACH ROW
    EXECUTE FUNCTION procurement.forbid_purchase_payment_mutation();

-- =============================================================================
-- 3. Shared response shape (also used to replay an idempotent retry)
-- =============================================================================

CREATE OR REPLACE FUNCTION procurement._purchase_payment_response(p_payment_document_id bigint)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
    SELECT jsonb_build_object(
        'document_id', payment.document_id,
        'document_number', payment_document.document_number,
        'receipt_document_id', payment.receipt_document_id,
        'receipt_document_number', receipt_document.document_number,
        'supplier_id', payment.supplier_id,
        'supplier_name', supplier.name,
        'payment_method', payment.payment_method,
        'amount', payment.amount::text,
        'reference_number', payment.reference_number,
        'journal_document_id', payment.journal_document_id,
        'journal_document_number', journal_document.document_number,
        'posted_at', payment_document.posted_at
    )
    FROM procurement.purchase_receipt_payments payment
    JOIN core.business_documents payment_document ON payment_document.id = payment.document_id
    JOIN core.business_documents receipt_document ON receipt_document.id = payment.receipt_document_id
    JOIN core.business_documents journal_document ON journal_document.id = payment.journal_document_id
    JOIN procurement.suppliers supplier ON supplier.id = payment.supplier_id
    WHERE payment.document_id = p_payment_document_id;
$$;

-- =============================================================================
-- 4. The posting function
-- =============================================================================

CREATE OR REPLACE FUNCTION procurement.post_purchase_payment(
    p_session_token text,
    p_request_id uuid,
    p_payload_hash bytea,
    p_receipt_document_id bigint,
    p_fiscal_period_id bigint,
    p_document_date date,
    p_payment_method text,
    p_amount numeric,
    p_reference_number text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_user_id bigint;
    v_cached_result bigint;
    v_period_status text;
    v_period_start date;
    v_period_end date;
    v_fiscal_year integer;
    v_supplier_id bigint;
    v_receipt_total numeric(14, 2);
    v_already_paid numeric(14, 2);
    v_outstanding numeric(14, 2);
    v_amount numeric(14, 2);
    v_sequence bigint;
    v_document_number text;
    v_payment_document_id bigint;
    v_journal_document_id bigint;
BEGIN
    -- 1. Session and permission
    SELECT user_id INTO v_user_id
    FROM iam.resolve_session_with_permission(p_session_token, 'POST_SUPPLIER_PAYMENT');

    -- 2. Idempotency
    v_cached_result := core.reserve_idempotent_request(
        'procurement.post_purchase_payment', p_request_id, p_payload_hash
    );
    IF v_cached_result IS NOT NULL THEN
        RETURN procurement._purchase_payment_response(v_cached_result);
    END IF;

    -- 3. Method and amount
    IF p_payment_method IS NULL OR p_payment_method NOT IN ('CASH', 'BANK_TRANSFER') THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: payment method must be CASH or BANK_TRANSFER'
            USING ERRCODE = '22023';
    END IF;

    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: payment amount must be greater than zero'
            USING ERRCODE = '22023';
    END IF;

    IF p_amount <> round(p_amount, 2) THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: payment amount must have at most two decimals'
            USING ERRCODE = '22023';
    END IF;

    v_amount := p_amount::numeric(14, 2);

    -- 4. Fiscal period
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
        RAISE EXCEPTION 'document date is outside fiscal period' USING ERRCODE = '22023';
    END IF;

    -- 5. Lock the receipt so two concurrent payments cannot both pass the
    --    outstanding-amount check.
    SELECT receipt.supplier_id, receipt.total_amount
    INTO v_supplier_id, v_receipt_total
    FROM procurement.purchase_receipts receipt
    JOIN core.business_documents document ON document.id = receipt.document_id
    WHERE receipt.document_id = p_receipt_document_id
      AND document.status = 'POSTED'
    FOR UPDATE OF receipt;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: posted purchase receipt % not found', p_receipt_document_id
            USING ERRCODE = '55000';
    END IF;

    -- 6. Outstanding amount
    SELECT coalesce(sum(amount), 0)::numeric(14, 2)
    INTO v_already_paid
    FROM procurement.purchase_receipt_payments
    WHERE receipt_document_id = p_receipt_document_id;

    v_outstanding := (v_receipt_total - v_already_paid)::numeric(14, 2);

    IF v_outstanding <= 0 THEN
        RAISE EXCEPTION 'PRECONDITION_FAILED: purchase % is already fully paid', p_receipt_document_id
            USING ERRCODE = '55000';
    END IF;

    IF v_amount > v_outstanding THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: payment exceeds the outstanding amount'
            USING ERRCODE = '22023';
    END IF;

    -- 7. Payment business document
    v_sequence := core.claim_next_document_number('SUPPLIER_PAYMENT', v_fiscal_year);
    v_document_number := 'SP-' || v_fiscal_year || '-' || lpad(v_sequence::text, 6, '0');

    INSERT INTO core.business_documents (
        document_type, status, document_date, fiscal_period_id, fiscal_year,
        sequence_number, document_number, posted_at
    ) VALUES (
        'SUPPLIER_PAYMENT', 'POSTED', p_document_date, p_fiscal_period_id, v_fiscal_year,
        v_sequence, v_document_number, now()
    ) RETURNING id INTO v_payment_document_id;

    -- 8. Balanced journal: Dr GRNI / Cr Cash or Bank
    v_journal_document_id := finance.create_posted_journal(
        p_document_date,
        p_fiscal_period_id,
        'Supplier payment ' || v_document_number,
        'SUPPLIER_PAYMENT',
        v_payment_document_id
    );

    PERFORM finance.add_journal_line(
        v_journal_document_id, 1, 'GRNI'::finance.account_role_code,
        v_amount, 0.00, 'Supplier payment settles goods received'
    );

    IF p_payment_method = 'CASH' THEN
        PERFORM finance.add_journal_line(
            v_journal_document_id, 2, 'CASH'::finance.account_role_code,
            0.00, v_amount, 'Supplier payment in cash'
        );
    ELSE
        PERFORM finance.add_journal_line(
            v_journal_document_id, 2, 'BANK'::finance.account_role_code,
            0.00, v_amount, 'Supplier payment by bank transfer'
        );
    END IF;

    -- 9. Payment record
    INSERT INTO procurement.purchase_receipt_payments (
        document_id, receipt_document_id, supplier_id, payment_method, amount,
        reference_number, journal_document_id, posted_by_user_id
    ) VALUES (
        v_payment_document_id, p_receipt_document_id, v_supplier_id, p_payment_method, v_amount,
        nullif(btrim(coalesce(p_reference_number, '')), ''), v_journal_document_id, v_user_id
    );

    -- 10. Idempotency result
    PERFORM core.record_idempotent_result(
        'procurement.post_purchase_payment', p_request_id, v_payment_document_id
    );

    RETURN procurement._purchase_payment_response(v_payment_document_id);
END;
$$;

-- =============================================================================
-- 5. Read model: payment status per purchase receipt
-- =============================================================================

CREATE OR REPLACE FUNCTION procurement.list_purchase_payment_status(
    p_session_token text,
    p_receipt_document_id bigint DEFAULT NULL
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
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_PROCUREMENT');

    SELECT coalesce(jsonb_agg(
        jsonb_build_object(
            'receipt_document_id', data.document_id,
            'total_amount', data.total_amount::text,
            'paid_amount', data.paid_amount::text,
            'outstanding_amount', data.outstanding_amount::text,
            'payment_status', data.payment_status
        ) ORDER BY data.document_id DESC
    ), '[]'::jsonb)
    INTO v_result
    FROM (
        SELECT
            receipt.document_id,
            receipt.total_amount,
            coalesce(sum(payment.amount), 0)::numeric(14, 2) AS paid_amount,
            (receipt.total_amount - coalesce(sum(payment.amount), 0))::numeric(14, 2) AS outstanding_amount,
            CASE
                WHEN receipt.total_amount <= 0 THEN 'PAID'
                WHEN coalesce(sum(payment.amount), 0) <= 0 THEN 'UNPAID'
                WHEN coalesce(sum(payment.amount), 0) >= receipt.total_amount THEN 'PAID'
                ELSE 'PARTIALLY_PAID'
            END AS payment_status
        FROM procurement.purchase_receipts receipt
        JOIN core.business_documents document ON document.id = receipt.document_id
        LEFT JOIN procurement.purchase_receipt_payments payment
               ON payment.receipt_document_id = receipt.document_id
        WHERE document.status = 'POSTED'
          AND (p_receipt_document_id IS NULL OR receipt.document_id = p_receipt_document_id)
        GROUP BY receipt.document_id, receipt.total_amount
    ) data;

    RETURN v_result;
END;
$$;

-- =============================================================================
-- 6. Read model: the payments recorded against one purchase receipt
-- =============================================================================

CREATE OR REPLACE FUNCTION procurement.list_purchase_payments(
    p_session_token text,
    p_receipt_document_id bigint DEFAULT NULL
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
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_PROCUREMENT');

    SELECT coalesce(jsonb_agg(
        jsonb_build_object(
            'document_id', payment.document_id,
            'document_number', payment_document.document_number,
            'receipt_document_id', payment.receipt_document_id,
            'supplier_id', payment.supplier_id,
            'supplier_name', supplier.name,
            'payment_method', payment.payment_method,
            'amount', payment.amount::text,
            'reference_number', payment.reference_number,
            'journal_document_id', payment.journal_document_id,
            'journal_document_number', journal_document.document_number,
            'posted_at', payment_document.posted_at
        ) ORDER BY payment_document.posted_at DESC, payment.document_id DESC
    ), '[]'::jsonb)
    INTO v_result
    FROM procurement.purchase_receipt_payments payment
    JOIN core.business_documents payment_document ON payment_document.id = payment.document_id
    JOIN core.business_documents journal_document ON journal_document.id = payment.journal_document_id
    JOIN procurement.suppliers supplier ON supplier.id = payment.supplier_id
    WHERE (p_receipt_document_id IS NULL OR payment.receipt_document_id = p_receipt_document_id);

    RETURN v_result;
END;
$$;

-- =============================================================================
-- 7. Read model: what is owed to each supplier
-- =============================================================================

CREATE OR REPLACE FUNCTION procurement.list_supplier_balances(p_session_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_result jsonb;
BEGIN
    PERFORM 1 FROM iam.resolve_session_with_permission(p_session_token, 'MANAGE_PROCUREMENT');

    SELECT coalesce(jsonb_agg(
        jsonb_build_object(
            'supplier_id', data.id,
            'supplier_name', data.name,
            'total_purchased', data.total_purchased::text,
            'total_paid', data.total_paid::text,
            'balance_due', data.balance_due::text
        ) ORDER BY data.name
    ), '[]'::jsonb)
    INTO v_result
    FROM (
        SELECT
            supplier.id,
            supplier.name,
            coalesce(purchased.total, 0)::numeric(14, 2) AS total_purchased,
            coalesce(paid.total, 0)::numeric(14, 2) AS total_paid,
            (coalesce(purchased.total, 0) - coalesce(paid.total, 0))::numeric(14, 2) AS balance_due
        FROM procurement.suppliers supplier
        LEFT JOIN (
            SELECT receipt.supplier_id, sum(receipt.total_amount) AS total
            FROM procurement.purchase_receipts receipt
            JOIN core.business_documents document ON document.id = receipt.document_id
            WHERE document.status = 'POSTED'
            GROUP BY receipt.supplier_id
        ) purchased ON purchased.supplier_id = supplier.id
        LEFT JOIN (
            SELECT payment.supplier_id, sum(payment.amount) AS total
            FROM procurement.purchase_receipt_payments payment
            GROUP BY payment.supplier_id
        ) paid ON paid.supplier_id = supplier.id
    ) data;

    RETURN v_result;
END;
$$;

-- =============================================================================
-- 8. Privileges
-- =============================================================================

REVOKE ALL ON procurement.purchase_receipt_payments FROM PUBLIC;
GRANT SELECT ON procurement.purchase_receipt_payments TO stockiha_runtime;

REVOKE ALL ON FUNCTION procurement.forbid_purchase_payment_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION procurement._purchase_payment_response(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION procurement.post_purchase_payment(text, uuid, bytea, bigint, bigint, date, text, numeric, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION procurement.list_purchase_payment_status(text, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION procurement.list_purchase_payments(text, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION procurement.list_supplier_balances(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION procurement.post_purchase_payment(text, uuid, bytea, bigint, bigint, date, text, numeric, text) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION procurement.list_purchase_payment_status(text, bigint) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION procurement.list_purchase_payments(text, bigint) TO stockiha_runtime;
GRANT EXECUTE ON FUNCTION procurement.list_supplier_balances(text) TO stockiha_runtime;

RESET ROLE;
```

Nothing in this migration alters an existing table, function, or constraint. If you believe it needs to, you have misread it — stop.

---

### T2 — Rust DTOs

In `src-tauri/src/domain/procurement.rs`, append these five structs at the **end of the file**. Do not modify any existing struct.

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PostPurchasePaymentPayload {
    pub request_id: String,
    pub receipt_document_id: i64,
    pub fiscal_period_id: i64,
    pub document_date: String,
    pub payment_method: String,
    pub amount: String,
    pub reference_number: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PostPurchasePaymentResult {
    pub document_id: i64,
    pub document_number: String,
    pub receipt_document_id: i64,
    pub receipt_document_number: Option<String>,
    pub supplier_id: i64,
    pub supplier_name: String,
    pub payment_method: String,
    pub amount: String,
    pub reference_number: Option<String>,
    pub journal_document_id: i64,
    pub journal_document_number: Option<String>,
    pub posted_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PurchasePaymentStatusDto {
    pub receipt_document_id: i64,
    pub total_amount: String,
    pub paid_amount: String,
    pub outstanding_amount: String,
    pub payment_status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PurchasePaymentRecordDto {
    pub document_id: i64,
    pub document_number: Option<String>,
    pub receipt_document_id: i64,
    pub supplier_id: i64,
    pub supplier_name: String,
    pub payment_method: String,
    pub amount: String,
    pub reference_number: Option<String>,
    pub journal_document_id: i64,
    pub journal_document_number: Option<String>,
    pub posted_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SupplierBalanceDto {
    pub supplier_id: i64,
    pub supplier_name: String,
    pub total_purchased: String,
    pub total_paid: String,
    pub balance_due: String,
}
```

---

### T3 — Rust service functions

In `src-tauri/src/application/procurement_service.rs`:

**3a.** Extend the existing `use crate::domain::procurement::{...}` import list with these five names, keeping the list alphabetically ordered the way `rustfmt` wants it (run `cargo fmt` at the end and it will fix the ordering for you):

```
PostPurchasePaymentPayload, PostPurchasePaymentResult, PurchasePaymentRecordDto,
PurchasePaymentStatusDto, SupplierBalanceDto,
```

**3b.** Append these four functions at the **end of the file**:

```rust
pub(crate) async fn post_purchase_payment(
    pool: &PgPool,
    session_token: &str,
    payload: PostPurchasePaymentPayload,
) -> Result<PostPurchasePaymentResult, AppError> {
    let amount: Decimal = payload
        .amount
        .parse()
        .map_err(|_| AppError::ValidationError {
            diagnostic: "Invalid payment amount".to_string(),
        })?;

    let canonical = json!({
        "receipt_document_id": payload.receipt_document_id,
        "fiscal_period_id": payload.fiscal_period_id,
        "document_date": payload.document_date,
        "payment_method": payload.payment_method,
        "amount": payload.amount,
        "reference_number": payload.reference_number,
    });
    let hash = payload_hash(&canonical);
    let doc_date = parse_iso_date(&payload.document_date)?;

    let res: JsonValue = query_scalar(
        "SELECT procurement.post_purchase_payment($1, $2::uuid, $3, $4, $5, $6, $7, $8, $9)",
    )
    .bind(session_token)
    .bind(&payload.request_id)
    .bind(hash.as_slice())
    .bind(payload.receipt_document_id)
    .bind(payload.fiscal_period_id)
    .bind(doc_date)
    .bind(&payload.payment_method)
    .bind(amount)
    .bind(payload.reference_number.as_deref())
    .fetch_one(pool)
    .await
    .map_err(AppError::from_posting_error)?;

    let result: PostPurchasePaymentResult = serde_json::from_value(res)
        .map_err(|e| AppError::internal(format!("Failed to parse purchase payment result: {e}")))?;
    Ok(result)
}

pub(crate) async fn list_purchase_payment_status(
    pool: &PgPool,
    session_token: &str,
    receipt_document_id: Option<i64>,
) -> Result<Vec<PurchasePaymentStatusDto>, AppError> {
    let res: JsonValue =
        query_scalar("SELECT procurement.list_purchase_payment_status($1, $2)")
            .bind(session_token)
            .bind(receipt_document_id)
            .fetch_one(pool)
            .await
            .map_err(AppError::from_posting_error)?;

    serde_json::from_value(res).map_err(|e| {
        AppError::internal(format!("Failed to parse purchase payment status: {e}"))
    })
}

pub(crate) async fn list_purchase_payments(
    pool: &PgPool,
    session_token: &str,
    receipt_document_id: Option<i64>,
) -> Result<Vec<PurchasePaymentRecordDto>, AppError> {
    let res: JsonValue = query_scalar("SELECT procurement.list_purchase_payments($1, $2)")
        .bind(session_token)
        .bind(receipt_document_id)
        .fetch_one(pool)
        .await
        .map_err(AppError::from_posting_error)?;

    serde_json::from_value(res)
        .map_err(|e| AppError::internal(format!("Failed to parse purchase payments: {e}")))
}

pub(crate) async fn list_supplier_balances(
    pool: &PgPool,
    session_token: &str,
) -> Result<Vec<SupplierBalanceDto>, AppError> {
    let res: JsonValue = query_scalar("SELECT procurement.list_supplier_balances($1)")
        .bind(session_token)
        .fetch_one(pool)
        .await
        .map_err(AppError::from_posting_error)?;

    serde_json::from_value(res)
        .map_err(|e| AppError::internal(format!("Failed to parse supplier balances: {e}")))
}
```

---

### T4 — Tauri commands

In `src-tauri/src/commands/procurement.rs`:

**4a.** Extend the existing `use crate::domain::procurement::{...}` import list with the same five names as in T3a.

**4b.** Append these four commands at the **end of the file**:

```rust
#[tauri::command]
pub(crate) async fn post_purchase_payment(
    state: State<'_, DatabaseState>,
    session_token: String,
    payload: PostPurchasePaymentPayload,
) -> Result<PostPurchasePaymentResult, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    procurement_service::post_purchase_payment(pool, &session_token, payload)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn list_purchase_payment_status(
    state: State<'_, DatabaseState>,
    session_token: String,
    receipt_document_id: Option<i64>,
) -> Result<Vec<PurchasePaymentStatusDto>, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    procurement_service::list_purchase_payment_status(pool, &session_token, receipt_document_id)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn list_purchase_payments(
    state: State<'_, DatabaseState>,
    session_token: String,
    receipt_document_id: Option<i64>,
) -> Result<Vec<PurchasePaymentRecordDto>, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    procurement_service::list_purchase_payments(pool, &session_token, receipt_document_id)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn list_supplier_balances(
    state: State<'_, DatabaseState>,
    session_token: String,
) -> Result<Vec<SupplierBalanceDto>, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    procurement_service::list_supplier_balances(pool, &session_token)
        .await
        .map_err(IpcError::from)
}
```

**4c.** In `src-tauri/src/lib.rs`, find the existing line

```rust
            commands::procurement::confirm_direct_purchase,
```

and add these four lines immediately after it, keeping the same indentation:

```rust
            commands::procurement::post_purchase_payment,
            commands::procurement::list_purchase_payment_status,
            commands::procurement::list_purchase_payments,
            commands::procurement::list_supplier_balances,
```

Change nothing else in `lib.rs`.

---

### T5 — TypeScript IPC layer

**5a.** In `src/shared/ipc/commands.ts`, add these four entries to the existing `COMMANDS` object, immediately after `CONFIRM_DIRECT_PURCHASE`:

```ts
  POST_PURCHASE_PAYMENT: 'post_purchase_payment',
  LIST_PURCHASE_PAYMENT_STATUS: 'list_purchase_payment_status',
  LIST_PURCHASE_PAYMENTS: 'list_purchase_payments',
  LIST_SUPPLIER_BALANCES: 'list_supplier_balances',
```

**5b.** In `src/shared/ipc/dto.ts`, append at the **end of the file**:

```ts
export type PurchaseSettlementMethod = 'CASH' | 'BANK_TRANSFER';

export interface PostPurchasePaymentPayload {
  request_id: string;
  receipt_document_id: number;
  fiscal_period_id: number;
  document_date: string;
  payment_method: PurchaseSettlementMethod;
  amount: string;
  reference_number: string | null;
}

export interface PostPurchasePaymentResult {
  document_id: number;
  document_number: string;
  receipt_document_id: number;
  receipt_document_number: string | null;
  supplier_id: number;
  supplier_name: string;
  payment_method: PurchaseSettlementMethod;
  amount: string;
  reference_number: string | null;
  journal_document_id: number;
  journal_document_number: string | null;
  posted_at: string;
}

export interface PurchasePaymentStatusDto {
  receipt_document_id: number;
  total_amount: string;
  paid_amount: string;
  outstanding_amount: string;
  payment_status: PurchasePaymentStatus;
}

export interface PurchasePaymentRecordDto {
  document_id: number;
  document_number: string | null;
  receipt_document_id: number;
  supplier_id: number;
  supplier_name: string;
  payment_method: PurchaseSettlementMethod;
  amount: string;
  reference_number: string | null;
  journal_document_id: number;
  journal_document_number: string | null;
  posted_at: string;
}

export interface SupplierBalanceDto {
  supplier_id: number;
  supplier_name: string;
  total_purchased: string;
  total_paid: string;
  balance_due: string;
}
```

`PurchasePaymentStatus` already exists in this file as `'PAID' | 'PARTIALLY_PAID' | 'UNPAID'`. Reuse it. Do not redefine it.

**5c.** In `src/shared/ipc/gateway.ts`, append at the **end of the file**:

```ts
export function postPurchasePayment(
  sessionToken: string,
  payload: import('./dto').PostPurchasePaymentPayload
): Promise<import('./dto').PostPurchasePaymentResult> {
  return call<import('./dto').PostPurchasePaymentResult>(COMMANDS.POST_PURCHASE_PAYMENT, {
    sessionToken,
    payload,
  });
}

export function listPurchasePaymentStatus(
  sessionToken: string,
  receiptDocumentId?: number | null
): Promise<import('./dto').PurchasePaymentStatusDto[]> {
  return call<import('./dto').PurchasePaymentStatusDto[]>(COMMANDS.LIST_PURCHASE_PAYMENT_STATUS, {
    sessionToken,
    receiptDocumentId: receiptDocumentId ?? null,
  });
}

export function listPurchasePayments(
  sessionToken: string,
  receiptDocumentId?: number | null
): Promise<import('./dto').PurchasePaymentRecordDto[]> {
  return call<import('./dto').PurchasePaymentRecordDto[]>(COMMANDS.LIST_PURCHASE_PAYMENTS, {
    sessionToken,
    receiptDocumentId: receiptDocumentId ?? null,
  });
}

export function listSupplierBalances(
  sessionToken: string
): Promise<import('./dto').SupplierBalanceDto[]> {
  return call<import('./dto').SupplierBalanceDto[]>(COMMANDS.LIST_SUPPLIER_BALANCES, {
    sessionToken,
  });
}
```

---

### T6 — The payment modal

Create `src/features/procurement/PurchasePaymentModal.tsx` with exactly this content:

```tsx
import { useState } from 'react';
import { newRequestId, postPurchasePayment } from '../../shared/ipc/gateway';
import type {
  PostPurchasePaymentPayload,
  PostPurchasePaymentResult,
  PurchaseSettlementMethod,
} from '../../shared/ipc/dto';
import { useI18n } from '../../shared/i18n';
import { useErrorText } from '../../shared/hooks/useErrorText';
import { currentBusinessDate } from '../../shared/utils/businessDate';
import { isPositiveDecimal } from './procurementDecimal';
import { PROCUREMENT_COPY } from './procurementCopy';
import './procurement.css';

interface Props {
  sessionToken: string;
  receiptDocumentId: number;
  receiptDocumentNumber: string;
  supplierName: string;
  outstandingAmount: string;
  fiscalPeriodId: number | null;
  onClose: () => void;
  onPosted: (result: PostPurchasePaymentResult) => void;
}

export function PurchasePaymentModal({
  sessionToken,
  receiptDocumentId,
  receiptDocumentNumber,
  supplierName,
  outstandingAmount,
  fiscalPeriodId,
  onClose,
  onPosted,
}: Props) {
  const { locale } = useI18n();
  const text = PROCUREMENT_COPY[locale];
  const errorText = useErrorText();

  const [amount, setAmount] = useState(outstandingAmount);
  const [method, setMethod] = useState<PurchaseSettlementMethod>('CASH');
  const [documentDate, setDocumentDate] = useState(currentBusinessDate());
  const [reference, setReference] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!isPositiveDecimal(amount)) {
      setError(text.paymentAmountInvalid);
      return;
    }
    if (!fiscalPeriodId) {
      setError(text.openPeriodRequired);
      return;
    }

    try {
      setSubmitting(true);
      setError(null);
      const payload: PostPurchasePaymentPayload = {
        request_id: newRequestId(),
        receipt_document_id: receiptDocumentId,
        fiscal_period_id: fiscalPeriodId,
        document_date: documentDate,
        payment_method: method,
        amount: amount.trim(),
        reference_number: reference.trim() || null,
      };
      const result = await postPurchasePayment(sessionToken, payload);
      onPosted(result);
    } catch (err: unknown) {
      setError(errorText(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="sk-modal__backdrop" role="presentation" data-testid="purchase-payment-backdrop">
      <div
        className="sk-modal"
        role="dialog"
        aria-modal="true"
        aria-label={text.recordPayment}
        style={{ width: 'min(100%, 520px)' }}
        data-testid="purchase-payment-modal"
      >
        <div className="sk-modal-header">
          <h2 className="sk-modal__title">{text.recordPayment}</h2>
          <button
            type="button"
            className="sk-modal-close"
            onClick={onClose}
            aria-label={text.close}
            data-testid="purchase-payment-close"
          >
            ✕
          </button>
        </div>

        {error && (
          <div className="sk-banner sk-banner--error" role="alert" data-testid="purchase-payment-error">
            {error}
          </div>
        )}

        <div className="pr-detail-header-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
          <div className="pr-detail-field">
            <span className="pr-detail-field__label">{text.receipt}</span>
            <span className="pr-detail-field__value">{receiptDocumentNumber}</span>
          </div>
          <div className="pr-detail-field">
            <span className="pr-detail-field__label">{text.supplier}</span>
            <span className="pr-detail-field__value">{supplierName}</span>
          </div>
          <div className="pr-detail-field">
            <span className="pr-detail-field__label">{text.outstanding}</span>
            <span className="pr-detail-field__value pr-detail-field__value--money">
              {outstandingAmount} DZD
            </span>
          </div>
        </div>

        <div className="sk-form-grid">
          <label>
            {text.paymentAmount} (DZD) *
            <input
              type="text"
              className="sk-field__input"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              data-testid="purchase-payment-amount"
            />
          </label>

          <label>
            {text.paymentMethod} *
            <select
              value={method}
              onChange={(event) => setMethod(event.target.value as PurchaseSettlementMethod)}
              data-testid="purchase-payment-method"
            >
              <option value="CASH">{text.methodCash}</option>
              <option value="BANK_TRANSFER">{text.methodBankTransfer}</option>
            </select>
          </label>

          <label>
            {text.date} *
            <input
              type="date"
              className="sk-field__input"
              value={documentDate}
              onChange={(event) => setDocumentDate(event.target.value)}
              data-testid="purchase-payment-date"
            />
          </label>

          <label>
            {text.paymentReference}
            <input
              type="text"
              className="sk-field__input"
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              data-testid="purchase-payment-reference"
            />
          </label>
        </div>

        <div className="sk-form-actions">
          <button
            type="button"
            className="sk-button sk-button--secondary"
            onClick={onClose}
            data-testid="purchase-payment-later"
          >
            {text.payLater}
          </button>
          <button
            type="button"
            className="sk-button sk-button--primary"
            onClick={handleSubmit}
            disabled={submitting}
            data-testid="purchase-payment-submit"
          >
            {submitting ? text.confirming : text.confirmPayment}
          </button>
        </div>
      </div>
    </div>
  );
}
```

Before writing this file, open `src/features/procurement/procurementDecimal.ts` and confirm it exports `isPositiveDecimal`. If it does not, **stop and report** — do not write your own.

---

### T7 — Wire payments into the Purchases screen

All edits are in `src/features/procurement/PurchasesScreen.tsx`.

**7a.** Add imports:

```tsx
import { PurchasePaymentModal } from './PurchasePaymentModal';
```

and add `listPurchasePaymentStatus` to the existing gateway import list, and `PurchasePaymentStatusDto` to the existing dto type import list.

**7b.** Add state next to the other list state:

```tsx
const [paymentStatuses, setPaymentStatuses] = useState<PurchasePaymentStatusDto[]>([]);
const [paymentTarget, setPaymentTarget] = useState<PurchaseReceiptSummary | null>(null);
```

**7c.** In `loadData`, add `listPurchasePaymentStatus(sessionToken)` as a fifth call in the existing `Promise.all`, destructure it as `statusData`, and set it with `setPaymentStatuses(statusData)`.

**7d.** Add this helper immediately after `loadData`:

```tsx
const statusFor = (receiptDocumentId: number): PurchasePaymentStatusDto | null =>
  paymentStatuses.find((item) => item.receipt_document_id === receiptDocumentId) ?? null;
```

**7e.** In the receipts table header, **replace** the landed-cost header cell

```tsx
<th className="sk-num">{text.landedCost}</th>
```

with

```tsx
<th>{text.payment}</th>
```

**7f.** In the receipts table body, **replace** the landed-cost data cell

```tsx
<td className="sk-num">
  {receipt.landed_cost_amount ? `${receipt.landed_cost_amount} DZD` : '—'}
</td>
```

with

```tsx
<td>
  {(() => {
    const status = statusFor(receipt.document_id);
    if (!status) return '—';
    const badgeClass =
      status.payment_status === 'PAID'
        ? 'sk-badge sk-badge--success'
        : status.payment_status === 'PARTIALLY_PAID'
          ? 'sk-badge sk-badge--info'
          : 'sk-badge sk-badge--warning';
    const label =
      status.payment_status === 'PAID'
        ? text.statusPaid
        : status.payment_status === 'PARTIALLY_PAID'
          ? text.statusPartiallyPaid
          : text.statusUnpaid;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span className={badgeClass} data-testid={`payment-status-${receipt.document_id}`}>
          {label}
        </span>
        {status.payment_status !== 'PAID' && (
          <span style={{ fontSize: '0.75rem', color: 'var(--sk-muted)' }}>
            {text.outstanding}: {status.outstanding_amount} DZD
          </span>
        )}
      </div>
    );
  })()}
</td>
```

**7g.** In the actions cell, immediately after the existing `View details` button, add:

```tsx
{capabilities.can_post_supplier_payment &&
  statusFor(receipt.document_id)?.payment_status !== 'PAID' && (
    <button
      type="button"
      className="sk-button sk-button--small sk-button--primary"
      onClick={() => setPaymentTarget(receipt)}
      data-testid={`record-payment-${receipt.document_id}`}
    >
      {text.recordPayment}
    </button>
  )}
```

**7h.** In `handleConfirmDirectPurchase`, in the success path, replace

```tsx
      setSuccessBanner(`${text.purchaseConfirmed} ${result.document_number} (${result.total_amount} DZD)`);
      await loadData();
```

with

```tsx
      setSuccessBanner(`${text.purchaseConfirmed} ${result.document_number} (${result.total_amount} DZD)`);
      await loadData();
      if (capabilities.can_post_supplier_payment) {
        setPaymentTarget({
          document_id: result.document_id,
          document_number: result.document_number,
          receipt_origin: result.receipt_origin ?? 'DIRECT_PURCHASE',
          purchase_order_id: null,
          purchase_order_number: null,
          supplier_id: result.supplier_id,
          supplier_name:
            suppliers.find((item) => item.id === result.supplier_id)?.name ?? '',
          warehouse_id: result.warehouse_id,
          warehouse_name:
            warehouses.find((item) => item.id === result.warehouse_id)?.name ?? '',
          total_amount: result.total_amount,
          journal_document_id: result.journal_document_id ?? null,
          journal_document_number: result.journal_document_number ?? null,
          landed_cost_amount: null,
          landed_cost_journal_id: null,
          landed_cost_journal_number: null,
          posted_at: result.posted_at,
        } as PurchaseReceiptSummary);
      }
```

If the field names of `PurchaseReceiptSummary` in `dto.ts` do not match this object exactly, **stop and report**. Do not guess.

**7i.** Render the modal just before the Journal Detail Modal block:

```tsx
{paymentTarget && (
  <PurchasePaymentModal
    sessionToken={sessionToken}
    receiptDocumentId={paymentTarget.document_id}
    receiptDocumentNumber={paymentTarget.document_number}
    supplierName={paymentTarget.supplier_name}
    outstandingAmount={
      statusFor(paymentTarget.document_id)?.outstanding_amount ?? paymentTarget.total_amount
    }
    fiscalPeriodId={openFiscalPeriodId}
    onClose={() => setPaymentTarget(null)}
    onPosted={async (result) => {
      setPaymentTarget(null);
      setSuccessBanner(`${text.paymentPosted} ${result.document_number} (${result.amount} DZD)`);
      await loadData();
    }}
  />
)}
```

---

### T8 — Supplier balance column

In `src/features/procurement/SuppliersScreen.tsx`:

**8a.** Import `listSupplierBalances` from the gateway and `SupplierBalanceDto` from the dto module.

**8b.** Add state:

```tsx
const [balances, setBalances] = useState<SupplierBalanceDto[]>([]);
```

**8c.** In whatever function already loads suppliers, add a call to `listSupplierBalances(sessionToken)` in the same `Promise.all` (create a `Promise.all` if the file currently awaits one call at a time) and store the result with `setBalances`.

**8d.** Add one column to the supplier table. Header, placed immediately before the actions header:

```tsx
<th className="sk-num">{text.balanceDue}</th>
```

Data cell, in the same position in the row:

```tsx
<td className="sk-num" data-testid={`supplier-balance-${supplier.id}`}>
  {balances.find((item) => item.supplier_id === supplier.id)?.balance_due ?? '0.00'} DZD
</td>
```

Change nothing else in this file. Do not touch the supplier create or edit form.

---

### T9 — Copy keys

In `src/features/procurement/procurementCopy.ts`, add these thirteen keys to the `ProcurementCopy` type and to all three locale objects, with exactly these values.

| key | en | fr | ar |
|---|---|---|---|
| `payment` | `Payment` | `Paiement` | `الدفع` |
| `recordPayment` | `Record payment` | `Enregistrer un paiement` | `تسجيل دفعة` |
| `confirmPayment` | `Confirm payment` | `Confirmer le paiement` | `تأكيد الدفعة` |
| `paymentPosted` | `Payment recorded` | `Paiement enregistré` | `تم تسجيل الدفعة` |
| `paymentAmount` | `Amount paid` | `Montant payé` | `المبلغ المدفوع` |
| `paymentMethod` | `Payment method` | `Mode de paiement` | `طريقة الدفع` |
| `paymentReference` | `Reference (optional)` | `Référence (facultatif)` | `المرجع (اختياري)` |
| `paymentAmountInvalid` | `Enter an amount greater than zero, for example 1000 or 1000.00.` | `Saisissez un montant supérieur à zéro, par exemple 1000 ou 1000.00.` | `أدخل مبلغاً أكبر من صفر، مثال 1000 أو 1000.00.` |
| `methodCash` | `Cash` | `Espèces` | `نقداً` |
| `methodBankTransfer` | `Bank transfer` | `Virement bancaire` | `تحويل بنكي` |
| `outstanding` | `Outstanding` | `Reste à payer` | `المتبقي` |
| `payLater` | `Pay later` | `Payer plus tard` | `الدفع لاحقاً` |
| `balanceDue` | `Balance due` | `Solde dû` | `الرصيد المستحق` |

Also add these three, used by the status badge:

| key | en | fr | ar |
|---|---|---|---|
| `statusPaid` | `Paid` | `Payé` | `مدفوع` |
| `statusPartiallyPaid` | `Partly paid` | `Partiellement payé` | `مدفوع جزئياً` |
| `statusUnpaid` | `Unpaid` | `Non payé` | `غير مدفوع` |

Remove no existing key.

---

### T10 — Tests

**10a. Database acceptance suite.** Create `src-tauri/tests/procurement/ws_e_002_purchase_payment_integration.sql` with exactly this content:

```sql
-- WS-E-002: supplier payment invariants -- GRNI settlement, partial payment,
-- overpayment rejection, idempotency, and payment immutability.
\set ON_ERROR_STOP on

DO $$
DECLARE
    v_suffix text := floor(random() * 1000000000)::text;
    v_admin_id bigint;
    v_admin_token text := 'ws_e_002_admin_' || floor(random() * 1000000000)::text;
    v_supplier_id bigint;
    v_warehouse_id bigint;
    v_product_id bigint;
    v_variant_id bigint;
    v_unit_id bigint;
    v_period_id bigint;
    v_document_date date;
    v_receipt jsonb;
    v_receipt_id bigint;
    v_payment jsonb;
    v_repeat jsonb;
    v_payment_id bigint;
    v_journal_id bigint;
    v_status jsonb;
    v_balances jsonb;
    v_rejected boolean := false;
BEGIN
    INSERT INTO iam.users (username, display_name, password_hash)
    VALUES ('ws_e_002_admin_' || v_suffix, 'WS-E-002 Admin', 'hash')
    RETURNING id INTO v_admin_id;
    INSERT INTO iam.user_roles (user_id, role_id)
    SELECT v_admin_id, id FROM iam.roles WHERE code = 'ADMIN';
    INSERT INTO iam.application_sessions (user_id, workstation_id, token_hash, expires_at)
    VALUES (v_admin_id, 'WS-E-002', sha256(v_admin_token::bytea), now() + interval '2 hours');

    SELECT id, starts_on + 1
    INTO v_period_id, v_document_date
    FROM finance.fiscal_periods
    WHERE status = 'OPEN'
    ORDER BY starts_on DESC
    LIMIT 1;
    ASSERT v_period_id IS NOT NULL, 'Supplier payment requires an open fiscal period';

    SELECT id INTO v_unit_id FROM catalog.units ORDER BY id LIMIT 1;
    ASSERT v_unit_id IS NOT NULL, 'Supplier payment test requires a catalog unit';

    INSERT INTO procurement.suppliers (code, name, is_active)
    VALUES ('SUP-PAY-' || v_suffix, 'Payment Supplier', true)
    RETURNING id INTO v_supplier_id;
    INSERT INTO inventory.warehouses (code, name, is_active)
    VALUES ('WH-PAY-' || v_suffix, 'Payment Warehouse', true)
    RETURNING id INTO v_warehouse_id;
    INSERT INTO catalog.products (name, is_active)
    VALUES ('Payment Item', true)
    RETURNING id INTO v_product_id;
    INSERT INTO catalog.product_variants (product_id, base_unit_id, sku, sale_price, is_active)
    VALUES (v_product_id, v_unit_id, 'PAY-SKU-' || v_suffix, 180.00, true)
    RETURNING id INTO v_variant_id;
    INSERT INTO inventory.positions (warehouse_id, variant_id, quantity_on_hand, total_value, last_known_wac)
    VALUES (v_warehouse_id, v_variant_id, 0.000, 0.00, 0.000000);

    -- A 1,000.00 DZD purchase: Dr Inventory 1000 / Cr GRNI 1000
    v_receipt := inventory.confirm_direct_purchase(
        v_admin_token,
        'e2000000-0000-4000-8000-000000000001'::uuid,
        '\x01'::bytea,
        v_supplier_id, v_warehouse_id, v_period_id, v_document_date,
        'WS-E-002 purchase',
        jsonb_build_array(jsonb_build_object(
            'variant_id', v_variant_id, 'unit_id', v_unit_id,
            'quantity_received', 10.000, 'unit_cost', 100.00
        ))
    );
    v_receipt_id := (v_receipt ->> 'document_id')::bigint;
    ASSERT (v_receipt ->> 'total_amount')::numeric = 1000.00, 'Purchase total must be 1000.00';

    -- Unpaid before any payment
    v_status := procurement.list_purchase_payment_status(v_admin_token, v_receipt_id);
    ASSERT (v_status -> 0 ->> 'payment_status') = 'UNPAID', 'A new purchase must be UNPAID';
    ASSERT (v_status -> 0 ->> 'outstanding_amount')::numeric = 1000.00, 'Outstanding must equal the total';

    -- Partial payment of 400.00 in cash
    v_payment := procurement.post_purchase_payment(
        v_admin_token,
        'e2000000-0000-4000-8000-000000000002'::uuid,
        '\x02'::bytea,
        v_receipt_id, v_period_id, v_document_date,
        'CASH', 400.00, 'CASH-REF-1'
    );
    v_payment_id := (v_payment ->> 'document_id')::bigint;
    ASSERT (v_payment ->> 'amount')::numeric = 400.00, 'Payment amount must be 400.00';
    ASSERT (v_payment ->> 'document_number') LIKE 'SP-%', 'Payment must get an SP document number';

    v_journal_id := (v_payment ->> 'journal_document_id')::bigint;
    ASSERT EXISTS (
        SELECT 1 FROM finance.journal_lines line
        WHERE line.document_id = v_journal_id
          AND line.account_code = finance.require_account_role('GRNI')
          AND line.debit = 400.00
    ), 'Payment journal must debit GRNI';
    ASSERT EXISTS (
        SELECT 1 FROM finance.journal_lines line
        WHERE line.document_id = v_journal_id
          AND line.account_code = finance.require_account_role('CASH')
          AND line.credit = 400.00
    ), 'Cash payment journal must credit cash';
    ASSERT NOT EXISTS (
        SELECT 1 FROM finance.journal_lines
        WHERE document_id = v_journal_id
        GROUP BY document_id HAVING sum(debit) <> sum(credit)
    ), 'Payment journal must balance';
    ASSERT NOT EXISTS (
        SELECT 1 FROM finance.journal_lines
        WHERE document_id = v_journal_id AND account_id IS NULL
    ), 'Payment journal lines must carry account_id';

    v_status := procurement.list_purchase_payment_status(v_admin_token, v_receipt_id);
    ASSERT (v_status -> 0 ->> 'payment_status') = 'PARTIALLY_PAID', 'Purchase must now be PARTIALLY_PAID';
    ASSERT (v_status -> 0 ->> 'outstanding_amount')::numeric = 600.00, 'Outstanding must be 600.00';

    -- Idempotent retry returns the same payment, creates nothing new
    v_repeat := procurement.post_purchase_payment(
        v_admin_token,
        'e2000000-0000-4000-8000-000000000002'::uuid,
        '\x02'::bytea,
        v_receipt_id, v_period_id, v_document_date,
        'CASH', 400.00, 'CASH-REF-1'
    );
    ASSERT (v_repeat ->> 'document_id')::bigint = v_payment_id, 'Retry must return the original payment';
    ASSERT (SELECT count(*) FROM procurement.purchase_receipt_payments
            WHERE receipt_document_id = v_receipt_id) = 1,
        'Idempotent retry must not duplicate the payment';

    -- Overpayment is rejected
    BEGIN
        PERFORM procurement.post_purchase_payment(
            v_admin_token,
            'e2000000-0000-4000-8000-000000000003'::uuid,
            '\x03'::bytea,
            v_receipt_id, v_period_id, v_document_date,
            'CASH', 601.00, NULL
        );
    EXCEPTION WHEN invalid_parameter_value THEN
        v_rejected := true;
    END;
    ASSERT v_rejected, 'A payment above the outstanding amount must be rejected';
    v_rejected := false;

    -- An unsupported method is rejected
    BEGIN
        PERFORM procurement.post_purchase_payment(
            v_admin_token,
            'e2000000-0000-4000-8000-000000000004'::uuid,
            '\x04'::bytea,
            v_receipt_id, v_period_id, v_document_date,
            'CREDIT', 100.00, NULL
        );
    EXCEPTION WHEN invalid_parameter_value THEN
        v_rejected := true;
    END;
    ASSERT v_rejected, 'CREDIT must not be an accepted payment method';
    v_rejected := false;

    -- Settle the rest by bank transfer
    PERFORM procurement.post_purchase_payment(
        v_admin_token,
        'e2000000-0000-4000-8000-000000000005'::uuid,
        '\x05'::bytea,
        v_receipt_id, v_period_id, v_document_date,
        'BANK_TRANSFER', 600.00, 'BANK-REF-1'
    );

    v_status := procurement.list_purchase_payment_status(v_admin_token, v_receipt_id);
    ASSERT (v_status -> 0 ->> 'payment_status') = 'PAID', 'Purchase must now be PAID';
    ASSERT (v_status -> 0 ->> 'outstanding_amount')::numeric = 0.00, 'Outstanding must be zero';

    -- A fully paid purchase accepts no further payment
    BEGIN
        PERFORM procurement.post_purchase_payment(
            v_admin_token,
            'e2000000-0000-4000-8000-000000000006'::uuid,
            '\x06'::bytea,
            v_receipt_id, v_period_id, v_document_date,
            'CASH', 1.00, NULL
        );
    EXCEPTION WHEN raise_exception OR sqlstate '55000' THEN
        v_rejected := true;
    END;
    ASSERT v_rejected, 'A fully paid purchase must reject further payment';
    v_rejected := false;

    -- Supplier balance is zero once fully paid
    v_balances := procurement.list_supplier_balances(v_admin_token);
    ASSERT EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_balances) entry
        WHERE (entry ->> 'supplier_id')::bigint = v_supplier_id
          AND (entry ->> 'balance_due')::numeric = 0.00
    ), 'Supplier balance must be zero after full settlement';

    -- Payments are immutable
    BEGIN
        UPDATE procurement.purchase_receipt_payments
        SET amount = 1.00
        WHERE document_id = v_payment_id;
    EXCEPTION WHEN feature_not_supported THEN
        v_rejected := true;
    END;
    ASSERT v_rejected, 'A posted payment must be immutable';
END;
$$;
```

Then register it in `src-tauri/tests/run_current_sql_suites.sh` by adding this line to the `suites` array, immediately after the `direct_purchase_acceptance_integration.sql` line:

```
  src-tauri/tests/procurement/ws_e_002_purchase_payment_integration.sql
```

**10b. Frontend workflow test.** Create `tests/purchase-payment.workflow.test.tsx`. Copy the structure, mock style and login helper of the existing `tests/direct-purchase.workflow.test.tsx` exactly. It must contain three tests:

1. **Status column renders.** With a mocked `list_purchase_receipts` returning one receipt with `document_id: 100` and `total_amount: '1000.00'`, and a mocked `list_purchase_payment_status` returning `[{ receipt_document_id: 100, total_amount: '1000.00', paid_amount: '0.00', outstanding_amount: '1000.00', payment_status: 'UNPAID' }]`, assert that `payment-status-100` is in the document and shows the unpaid label.
2. **Record payment posts the right payload.** Click `record-payment-100`, assert the modal appears with `purchase-payment-amount` prefilled to `1000.00`, then click `purchase-payment-submit` and assert that `post_purchase_payment` was called once with `payload.receipt_document_id === 100`, `payload.amount === '1000.00'`, and `payload.payment_method === 'CASH'`.
3. **Paid purchases hide the button.** With `payment_status: 'PAID'` and `outstanding_amount: '0.00'`, assert `record-payment-100` is **not** in the document.

Mock `post_purchase_payment` to return a valid `PostPurchasePaymentResult` shape. Add no new dependency. Do not weaken any existing test.

---

## 5. Scope — OUT. Do not touch.

- `inventory.confirm_direct_purchase`, in any form, in any migration. It is finished.
- Any existing migration file. Forward-only: your one new migration is the only SQL change.
- Any existing SQL function, table, constraint, trigger, or grant.
- `finance.add_journal_line`, `finance.create_posted_journal`, `finance.require_account_role`, `finance.account_role_mappings`, the chart of accounts.
- `cash.movements`, cash sessions, the drawer, POS, customers, receivables.
- The legacy `procurement.supplier_payments`, `procurement.supplier_liabilities`, `procurement.supplier_invoices`, `procurement.supplier_returns` tables and their functions. They hold history. Read nothing, write nothing, delete nothing.
- WAC, inventory quantities, inventory movements, inventory valuation.
- Permissions, roles, `procurement.get_capabilities`. `POST_SUPPLIER_PAYMENT` already exists and is already granted to ADMIN and MANAGER. Do not add, rename, or re-grant a permission.
- `PurchaseItemPicker.tsx`, the barcode entry, the item search, the purchase line table. WS-E-1 is finished.
- `package.json`, `package-lock.json`, `Cargo.toml`, `Cargo.lock`.
- `STOCKIHA_GROUND_TRUTH.md`, `AGENTS.md`, `CURRENT_STEP.md`, `README.md`, `TASKS.md`, `GEMINI.md`.

If you find a genuine unrelated bug: **report it, do not fix it.**

---

## 6. Constraints

- **Never use floating point for money.** Amounts cross every layer as strings (TypeScript), `Decimal` (Rust), `numeric(14,2)` (PostgreSQL). Never `parseFloat`, never `Number()`, never `f64`.
- React never decides. The frontend collects the amount and displays the result; PostgreSQL validates the outstanding balance and writes the journal.
- Every user-facing string comes from `procurementCopy.ts` in all three locales. No hardcoded English in JSX.
- Use logical CSS properties only. Arabic RTL must keep working.
- No placeholder, no `TODO`, no mock, no commented-out code left behind.
- Show your file plan before editing. If it contains a file not named in section 4, you have misread the task — stop.

---

## 7. Acceptance criteria

1. The migration applies cleanly on a database that already has every earlier migration, and `sqlx` records it.
2. No existing migration file is modified. `git diff --stat` shows exactly one new file under `src-tauri/migrations/`.
3. `cargo fmt`, `cargo check`, `cargo clippy`, `cargo test` all pass.
4. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` all pass.
5. The SQL suite `ws_e_002_purchase_payment_integration.sql` passes inside `run_current_sql_suites.sh`, and every other suite still passes.
6. Confirming a purchase still works exactly as before and still posts Dr Inventory / Cr GRNI.
7. After confirming a purchase, the payment dialog opens with the full amount prefilled and the method set to Cash.
8. Clicking `Pay later` closes the dialog, records nothing, and leaves the purchase showing Unpaid.
9. Confirming a payment for the full amount makes the purchase show Paid, and the `Record payment` button disappears for that row.
10. Confirming a payment for part of the amount makes the purchase show Partly paid with the correct remaining amount.
11. Trying to pay more than the remaining amount is refused with a clear message and posts nothing.
12. Each payment produces its own `SP-…` document and its own balanced journal: GRNI debited, Cash or Bank credited.
13. The Suppliers screen shows a Balance due column that equals total purchased minus total paid for each supplier.
14. A user whose role lacks `POST_SUPPLIER_PAYMENT` never sees the `Record payment` button and never sees the payment dialog.
15. All new text appears correctly in French, Arabic (RTL intact) and English.
16. `git status --short` shows only files named in this plan.

---

## 8. Verification required

Paste the real, unedited output of every command.

Frontend:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Rust:

```bash
cd src-tauri
cargo fmt --check
cargo check
cargo clippy -- -D warnings
cargo test
cd ..
```

Database suites (needs `ADMIN_URL` pointing at the acceptance database):

```bash
bash src-tauri/tests/run_current_sql_suites.sh
```

Then:

```bash
git status --short
git diff --stat
```

Do not run `npm run tauri build`. The Windows build and the manual acceptance run are the owner's steps.

Commit once:

```
feat(procurement): WS-E-2 supplier payment against purchase receipts
```

Push the branch. Do not merge into `main`.

---

## 9. Report back — required format

```
WS-E-2 REPORT

Git
- Branch:
- Full commit hash:
- Pushed: yes/no
- Working tree clean: yes/no
- Migration files changed (must be 1 new, 0 modified):

Files changed (full list):
Files created (full list):

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

Anything not finished, and why:

Unrelated problems found but NOT fixed:
```

If any acceptance criterion fails, the final result is FAIL. Do not hide or downgrade a failure to finish.

---

## 10. Manual acceptance checklist for the owner (not for the agent)

Run on Windows after the agent reports PASS.

1. Launch the app, sign in as Admin, open Purchases.
2. Create a purchase for one product, quantity 10, unit cost 100. Confirm. Expect a `PR-…` number and the payment dialog to open showing 1,000.00 DZD outstanding.
3. Click **Pay later**. Expect the row to show **Unpaid** with 1,000.00 outstanding.
4. Click **Record payment**, change the amount to 400, method Cash, confirm. Expect **Partly paid**, 600.00 outstanding, and an `SP-…` confirmation.
5. Open Journals. Find the new `JE-…` for the payment. Expect GRNI debited 400.00 and Caisse credited 400.00, balanced.
6. Click **Record payment** again, leave the amount at 600, method Bank transfer, confirm. Expect **Paid** and the button to disappear.
7. Open Suppliers. Expect that supplier's Balance due to read 0.00 DZD.
8. Create a second purchase for 500 and pay nothing. Expect the supplier's Balance due to read 500.00 DZD.
9. Try a payment of 600 on the 500 purchase. Expect a clear refusal and no new document.
10. Switch the language to French, then Arabic. Check the payment dialog and the status badges read correctly and the Arabic layout stays right-to-left.
11. Close the app, reopen it, and confirm every status and balance is unchanged.
