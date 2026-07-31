#!/usr/bin/env bash
set -euo pipefail

: "${STOCKIHA_TEST_ADMIN_DATABASE_URL:?required}"
: "${STOCKIHA_TEST_DATABASE_URL:?required}"

for url_name in STOCKIHA_TEST_ADMIN_DATABASE_URL STOCKIHA_TEST_DATABASE_URL; do
  url="${!url_name}"
  db_name="${url%%\?*}"
  db_name="${db_name##*/}"
  if [[ "$db_name" != *_test ]]; then
    echo "refusing to run S4-002 concurrency test against non-test database" >&2
    exit 2
  fi
done

run_id="$RANDOM$RANDOM"
username="s4002_conc_cashier_$run_id"
token="s4002-conc-token-$run_id"
workstation="S4002-CONC-WKS-$run_id"
warehouse_code="S4002-CONC-WH-$run_id"

cash_session_id="$(
  psql "$STOCKIHA_TEST_ADMIN_DATABASE_URL" -X -v ON_ERROR_STOP=1 -At <<SQL | tr -d '\r' | tail -n 1
INSERT INTO iam.users (username, password_hash, display_name)
VALUES ('$username', 'x', 'S4-002 Concurrency Cashier');
INSERT INTO iam.user_roles (user_id, role_id)
SELECT u.id, r.id FROM iam.users u, iam.roles r
WHERE u.username='$username' AND r.code='CASHIER';
INSERT INTO iam.application_sessions (token_hash, user_id, workstation_id, expires_at)
SELECT sha256('$token'::bytea), id, '$workstation', now()+interval '1 day'
FROM iam.users WHERE username='$username';
INSERT INTO inventory.warehouses (code, name)
VALUES ('$warehouse_code', 'S4-002 Concurrency Warehouse');
SELECT sales.open_cash_session(
  '$token',
  (SELECT id FROM inventory.warehouses WHERE code='$warehouse_code'),
  '$workstation',
  0
);
SQL
)"

[[ -n "$cash_session_id" ]] || { echo "failed to create concurrency cash session" >&2; exit 1; }

workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT

# Transaction A moves OPEN -> CLOSING and intentionally holds the row lock.
# Transaction B must wait for A, then reject because the session is no longer OPEN.
set +e
psql "$STOCKIHA_TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 -At >"$workdir/a" 2>"$workdir/a.err" <<SQL &
BEGIN;
SELECT sales.begin_cash_session_close('$token', $cash_session_id);
SELECT pg_sleep(2);
COMMIT;
SQL
pid_a=$!
sleep 0.2

psql "$STOCKIHA_TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 -At >"$workdir/b" 2>"$workdir/b.err" <<SQL &
SELECT sales.begin_cash_session_close('$token', $cash_session_id);
SQL
pid_b=$!

wait "$pid_a"; status_a=$?
wait "$pid_b"; status_b=$?
set -e

if [[ "$status_a" -ne 0 || "$status_b" -eq 0 ]]; then
  echo "expected A to succeed and B to fail after waiting; statuses A=$status_a B=$status_b" >&2
  cat "$workdir/a.err" >&2 || true
  cat "$workdir/b.err" >&2 || true
  exit 1
fi

status="$(psql "$STOCKIHA_TEST_ADMIN_DATABASE_URL" -X -Atc "SELECT status FROM sales.cash_sessions WHERE id=$cash_session_id" | tr -d '\r')"
event_count="$(psql "$STOCKIHA_TEST_ADMIN_DATABASE_URL" -X -Atc "SELECT count(*) FROM cash.cash_session_events WHERE cash_session_id=$cash_session_id AND event_type='CLOSE_STARTED'" | tr -d '\r')"

[[ "$status" == "CLOSING" ]] || { echo "expected CLOSING after race, got $status" >&2; exit 1; }
[[ "$event_count" == "1" ]] || { echo "expected one CLOSE_STARTED event, got $event_count" >&2; exit 1; }

# Return the fixture to OPEN through the production cancellation path.
psql "$STOCKIHA_TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 -Atc \
  "SELECT sales.cancel_cash_session_close('$token', $cash_session_id)" >/dev/null

status="$(psql "$STOCKIHA_TEST_ADMIN_DATABASE_URL" -X -Atc "SELECT status FROM sales.cash_sessions WHERE id=$cash_session_id" | tr -d '\r')"
[[ "$status" == "OPEN" ]] || { echo "cleanup cancel did not restore OPEN, got $status" >&2; exit 1; }

echo "ALL S4-002 CASH-SESSION CONCURRENCY ASSERTIONS PASSED"
