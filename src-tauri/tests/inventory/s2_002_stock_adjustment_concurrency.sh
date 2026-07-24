#!/usr/bin/env bash
set -euo pipefail

# Run only against a disposable database whose name ends in _test and already
# has all migrations applied. URLs are read from the environment and never
# printed. The admin URL must be able to create fixtures; the runtime URL must
# connect as stockiha_runtime.
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

read -r warehouse_id variant_id unit_id period_id < <(
  psql "$STOCKIHA_TEST_ADMIN_DATABASE_URL" -X -v ON_ERROR_STOP=1 -At -F ' ' <<'SQL'
INSERT INTO iam.users (username, password_hash, display_name)
VALUES ('s2adj_concurrency_admin', 'x', 'S2 Adjustment Concurrency Admin');
INSERT INTO iam.user_roles (user_id, role_id)
SELECT u.id, r.id FROM iam.users u, iam.roles r
WHERE u.username='s2adj_concurrency_admin' AND r.code='ADMIN';
INSERT INTO iam.application_sessions (token_hash, user_id, workstation_id, expires_at)
SELECT sha256('s2adj-concurrency-token'::bytea), id, 'S2ADJ-CONC', now()+interval '1 day'
FROM iam.users WHERE username='s2adj_concurrency_admin';
INSERT INTO finance.fiscal_periods (period_code, starts_on, ends_on)
VALUES ('S2ADJ-CONC-2026', '2026-01-01', '2026-12-31');
INSERT INTO inventory.warehouses (code, name)
VALUES ('S2ADJ-CONC-WH', 'S2 Adjustment Concurrency Warehouse');
SELECT catalog.create_product_with_variant(
  's2adj-concurrency-token', 'S2 Adjustment Concurrency Product',
  'S2ADJ-CONC-SKU', 10.00, true
);
INSERT INTO inventory.positions (warehouse_id, variant_id, quantity_on_hand, total_value, last_known_wac)
SELECT w.id, v.id, 5.000, 50.0000, 10.000000
FROM inventory.warehouses w, catalog.product_variants v
WHERE w.code='S2ADJ-CONC-WH' AND v.sku='S2ADJ-CONC-SKU';
SELECT w.id, v.id, v.base_unit_id, p.id
FROM inventory.warehouses w, catalog.product_variants v, finance.fiscal_periods p
WHERE w.code='S2ADJ-CONC-WH' AND v.sku='S2ADJ-CONC-SKU' AND p.period_code='S2ADJ-CONC-2026';
SQL
)

workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT

# Concurrent duplicate: transaction A holds the idempotency row lock after the
# posting call; transaction B must wait and then return the same document.
psql "$STOCKIHA_TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 -At >"$workdir/dup-a" 2>"$workdir/dup-a.err" <<SQL &
BEGIN;
SELECT inventory.confirm_stock_adjustment(
  's2adj-concurrency-token', '00000000-0000-4000-8000-000000000201', sha256('concurrent-duplicate'::bytea),
  $warehouse_id, $variant_id, $unit_id, 1.000, 'FOUND_STOCK', NULL,
  $period_id, '2026-07-24'
)->>'document_id';
SELECT pg_sleep(2);
COMMIT;
SQL
pid_a=$!
sleep 0.2
psql "$STOCKIHA_TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 -At >"$workdir/dup-b" 2>"$workdir/dup-b.err" <<SQL &
SELECT inventory.confirm_stock_adjustment(
  's2adj-concurrency-token', '00000000-0000-4000-8000-000000000201', sha256('concurrent-duplicate'::bytea),
  $warehouse_id, $variant_id, $unit_id, 1.000, 'FOUND_STOCK', NULL,
  $period_id, '2026-07-24'
)->>'document_id';
SQL
pid_b=$!
wait "$pid_a"
wait "$pid_b"
doc_a="$(sed -n '1p' "$workdir/dup-a")"
doc_b="$(sed -n '1p' "$workdir/dup-b")"
if [[ -z "$doc_a" || "$doc_a" != "$doc_b" ]]; then
  echo "concurrent duplicate did not return one document" >&2
  exit 1
fi
count="$(psql "$STOCKIHA_TEST_ADMIN_DATABASE_URL" -X -Atc "SELECT count(*) FROM inventory.stock_adjustments WHERE document_id=$doc_a")"
[[ "$count" == "1" ]] || { echo "concurrent duplicate posted more than once" >&2; exit 1; }

# Starting quantity is now 6. Two concurrent -4 adjustments cannot both win.
set +e
psql "$STOCKIHA_TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 -At >"$workdir/neg-a" 2>"$workdir/neg-a.err" <<SQL &
BEGIN;
SELECT inventory.confirm_stock_adjustment(
  's2adj-concurrency-token', '00000000-0000-4000-8000-000000000202', sha256('concurrent-negative-a'::bytea),
  $warehouse_id, $variant_id, $unit_id, -4.000, 'SHRINKAGE', NULL,
  $period_id, '2026-07-24'
)->>'document_id';
SELECT pg_sleep(2);
COMMIT;
SQL
pid_a=$!
sleep 0.2
psql "$STOCKIHA_TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 -At >"$workdir/neg-b" 2>"$workdir/neg-b.err" <<SQL &
SELECT inventory.confirm_stock_adjustment(
  's2adj-concurrency-token', '00000000-0000-4000-8000-000000000203', sha256('concurrent-negative-b'::bytea),
  $warehouse_id, $variant_id, $unit_id, -4.000, 'SHRINKAGE', NULL,
  $period_id, '2026-07-24'
)->>'document_id';
SQL
pid_b=$!
wait "$pid_a"; status_a=$?
wait "$pid_b"; status_b=$?
set -e
if [[ "$status_a" -eq "$status_b" ]]; then
  echo "expected exactly one concurrent negative adjustment to succeed" >&2
  exit 1
fi
final_qty="$(psql "$STOCKIHA_TEST_ADMIN_DATABASE_URL" -X -Atc "SELECT quantity_on_hand FROM inventory.positions WHERE warehouse_id=$warehouse_id AND variant_id=$variant_id")"
[[ "$final_qty" == "2.000" ]] || { echo "unexpected final quantity: $final_qty" >&2; exit 1; }

echo "ALL S2-002 CONCURRENCY ASSERTIONS PASSED"
