#!/usr/bin/env bash
set -euo pipefail

# Real two-connection S4-001 credit-limit race proof. Run only against a
# disposable migrated database ending in _test. Admin URL creates/inspects
# fixtures; runtime URL must connect as stockiha_runtime.
: "${STOCKIHA_TEST_ADMIN_DATABASE_URL:?required}"
: "${STOCKIHA_TEST_DATABASE_URL:?required}"

for url_name in STOCKIHA_TEST_ADMIN_DATABASE_URL STOCKIHA_TEST_DATABASE_URL; do
  url="${!url_name}"
  db_name="${url%%\?*}"
  db_name="${db_name##*/}"
  if [[ "$db_name" != *_test ]]; then
    echo "refusing to run against non-test database" >&2
    exit 2
  fi
done

run_id="$RANDOM$RANDOM"
username="s4credit_conc_admin_$run_id"
token="s4credit-conc-token-$run_id"
wh_code="S4CREDIT-CONC-WH-$run_id"
sku="S4CREDIT-CONC-SKU-$run_id"
customer_code="S4CREDIT-CONC-CUS-$run_id"

read -r warehouse_id variant_id period_id document_date customer_id < <(
  psql "$STOCKIHA_TEST_ADMIN_DATABASE_URL" -X -v ON_ERROR_STOP=1 -At -F ' ' <<SQL | tr -d '\r' | tail -n 1
INSERT INTO iam.users (username, password_hash, display_name)
VALUES ('$username', 'x', 'S4 Credit Concurrency Admin');
INSERT INTO iam.user_roles (user_id, role_id)
SELECT u.id, r.id FROM iam.users u, iam.roles r
WHERE u.username='$username' AND r.code='ADMIN';
INSERT INTO iam.application_sessions (token_hash, user_id, workstation_id, expires_at)
SELECT sha256('$token'::bytea), id, 'S4CREDIT-CONC', now()+interval '1 day'
FROM iam.users WHERE username='$username';

INSERT INTO inventory.warehouses (code, name)
VALUES ('$wh_code', 'S4 Credit Concurrency Warehouse');
SELECT catalog.create_product_with_variant(
  '$token', 'S4 Credit Concurrency Product', '$sku', 200.00, true
);
INSERT INTO inventory.positions (warehouse_id, variant_id, quantity_on_hand, total_value, last_known_wac)
SELECT w.id, v.id, 10.000, 1000.0000, 100.000000
FROM inventory.warehouses w, catalog.product_variants v
WHERE w.code='$wh_code' AND v.sku='$sku';

SELECT receivables.create_customer(
  '$token', '$customer_code', 'S4 Credit Concurrency Customer',
  NULL, NULL, NULL, NULL, NULL,
  true, 300.00, 30, 60
);

SELECT w.id, v.id, fp.id, fp.starts_on, c.id
FROM inventory.warehouses w
JOIN catalog.product_variants v ON v.sku='$sku'
JOIN receivables.customers c ON c.code='$customer_code'
CROSS JOIN LATERAL (
  SELECT id, starts_on
  FROM finance.fiscal_periods
  WHERE status='OPEN'
  ORDER BY starts_on DESC
  LIMIT 1
) fp
WHERE w.code='$wh_code';
SQL
)

[[ -n "$period_id" && -n "$document_date" ]] || {
  echo "no OPEN fiscal period available for concurrency test" >&2
  exit 1
}

req_a="$(printf '10000000-0000-4000-8000-%012d' $((run_id * 10 + 1)))"
req_b="$(printf '10000000-0000-4000-8000-%012d' $((run_id * 10 + 2)))"
lines="[{\"variant_id\":$variant_id,\"quantity\":\"1\",\"unit_price\":\"200.00\"}]"

workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT

# Both transactions start with exposure 0 and each wants 200 against a 300
# limit. Transaction A holds the customer credit-state row lock after posting.
# Transaction B must wait, re-read exposure=200 after A commits, then fail.
set +e
psql "$STOCKIHA_TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 -At >"$workdir/a" 2>"$workdir/a.err" <<SQL &
BEGIN;
SELECT sales.confirm_credit_sale(
  '$token', '$req_a', sha256('s4-credit-race-a-$run_id'::bytea),
  $customer_id, $warehouse_id, $period_id, '$document_date',
  '$lines'::jsonb, NULL
)->>'document_id';
SELECT pg_sleep(2);
COMMIT;
SQL
pid_a=$!
sleep 0.2

psql "$STOCKIHA_TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 -At >"$workdir/b" 2>"$workdir/b.err" <<SQL &
SELECT sales.confirm_credit_sale(
  '$token', '$req_b', sha256('s4-credit-race-b-$run_id'::bytea),
  $customer_id, $warehouse_id, $period_id, '$document_date',
  '$lines'::jsonb, NULL
)->>'document_id';
SQL
pid_b=$!

wait "$pid_a"; status_a=$?
wait "$pid_b"; status_b=$?
set -e

if [[ "$status_a" -eq "$status_b" ]]; then
  echo "expected exactly one concurrent credit sale to succeed; statuses A=$status_a B=$status_b" >&2
  cat "$workdir/a.err" >&2 || true
  cat "$workdir/b.err" >&2 || true
  exit 1
fi

exposure="$(psql "$STOCKIHA_TEST_ADMIN_DATABASE_URL" -X -Atc "SELECT exposure_amount FROM receivables.customer_credit_state WHERE customer_id=$customer_id" | tr -d '\r')"
qty="$(psql "$STOCKIHA_TEST_ADMIN_DATABASE_URL" -X -Atc "SELECT quantity_on_hand FROM inventory.positions WHERE warehouse_id=$warehouse_id AND variant_id=$variant_id" | tr -d '\r')"
ledger_count="$(psql "$STOCKIHA_TEST_ADMIN_DATABASE_URL" -X -Atc "SELECT count(*) FROM receivables.customer_ledger_entries WHERE customer_id=$customer_id AND entry_type='CREDIT_INVOICE'" | tr -d '\r')"
credit_doc_count="$(psql "$STOCKIHA_TEST_ADMIN_DATABASE_URL" -X -Atc "SELECT count(*) FROM sales.credit_sales WHERE customer_id=$customer_id" | tr -d '\r')"
cash_count="$(psql "$STOCKIHA_TEST_ADMIN_DATABASE_URL" -X -Atc "SELECT count(*) FROM cash.movements cm JOIN sales.credit_sales cs ON cs.document_id=cm.business_document_id WHERE cs.customer_id=$customer_id" | tr -d '\r')"
drawer_count="$(psql "$STOCKIHA_TEST_ADMIN_DATABASE_URL" -X -Atc "SELECT count(*) FROM cash.drawer_jobs dj JOIN sales.credit_sales cs ON cs.document_id=dj.business_document_id WHERE cs.customer_id=$customer_id" | tr -d '\r')"

[[ "$exposure" == "200.00" ]] || { echo "unexpected exposure after race: $exposure" >&2; exit 1; }
[[ "$qty" == "9.000" ]] || { echo "unexpected stock after race: $qty" >&2; exit 1; }
[[ "$ledger_count" == "1" ]] || { echo "expected one receivable ledger entry, got $ledger_count" >&2; exit 1; }
[[ "$credit_doc_count" == "1" ]] || { echo "expected one credit document, got $credit_doc_count" >&2; exit 1; }
[[ "$cash_count" == "0" ]] || { echo "credit race produced cash movement" >&2; exit 1; }
[[ "$drawer_count" == "0" ]] || { echo "credit race produced drawer pulse" >&2; exit 1; }

echo "ALL S4-001 CREDIT CONCURRENCY ASSERTIONS PASSED"
