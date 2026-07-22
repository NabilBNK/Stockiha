#!/usr/bin/env bash
# Slice 1 MVP batch — backup/restore reconciliation integration test.
#
# Verifies that the production backend chain introduced in this batch
# (catalog/inventory/sales/finance/iam/cash/documents/core) survives a real
# `pg_dump`/`pg_restore` round trip with the security model intact: row
# counts and monetary aggregates reconcile exactly, and ownership/grants/
# triggers are still enforced after restore.
#
# This intentionally reuses the existing, proven backup bundle mechanism
# (S0-009/S0-010) rather than redesigning it — it drives the same
# `pg_dump`/`pg_restore` binaries the Rust `backup_proof`/`restore_proof`
# modules wrap, so it can run standalone in any environment with `psql`,
# `pg_dump`, and `pg_restore` on PATH, including this sandbox (which cannot
# compile the full `tauri`-linked crate — see AGENTS.md's Linux/WebKitGTK
# note — so this script is what actually proves the reconciliation here).
#
# Usage:
#   PGHOST=... PGPORT=... PGUSER=postgres ./backup_restore_reconciliation.sh <source_db>
#
# Requires: a database already migrated with every migration in
# `src-tauri/migrations/` and populated with at least one posted document
# through the Golden Transaction Chain (stock receipt + cash sale), so the
# reconciliation actually exercises non-empty tables.
set -euo pipefail

SOURCE_DB="${1:?usage: $0 <source_db>}"
PGHOST="${PGHOST:-127.0.0.1}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-postgres}"
RESTORE_DB="${SOURCE_DB}_restored_$$"
DUMP_FILE="$(mktemp -u /tmp/stockiha-reconcile-XXXXXX.pgcustom)"

cleanup() {
    rm -f "$DUMP_FILE"
    psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -v ON_ERROR_STOP=0 -c "DROP DATABASE IF EXISTS ${RESTORE_DB};" >/dev/null 2>&1 || true
}
trap cleanup EXIT

reconciliation_query() {
    cat <<'SQL'
SELECT 'products', count(*)::text FROM catalog.products
UNION ALL SELECT 'variants', count(*)::text FROM catalog.product_variants
UNION ALL SELECT 'positions', count(*)::text FROM inventory.positions
UNION ALL SELECT 'movements', count(*)::text FROM inventory.movements
UNION ALL SELECT 'cash_sales', count(*)::text FROM sales.cash_sales
UNION ALL SELECT 'cash_sale_lines', count(*)::text FROM sales.cash_sale_lines
UNION ALL SELECT 'cash_sessions', count(*)::text FROM sales.cash_sessions
UNION ALL SELECT 'cash_movements', count(*)::text FROM cash.movements
UNION ALL SELECT 'journal_entries', count(*)::text FROM finance.journal_entries
UNION ALL SELECT 'journal_lines', count(*)::text FROM finance.journal_lines
UNION ALL SELECT 'business_documents', count(*)::text FROM core.business_documents
UNION ALL SELECT 'generation_jobs', count(*)::text FROM documents.generation_jobs
UNION ALL SELECT 'print_jobs', count(*)::text FROM documents.print_jobs
UNION ALL SELECT 'drawer_jobs', count(*)::text FROM cash.drawer_jobs
UNION ALL SELECT 'total_position_value', coalesce(sum(total_value), 0)::text FROM inventory.positions
UNION ALL SELECT 'total_cash_movement_amount', coalesce(sum(amount), 0)::text FROM cash.movements
ORDER BY 1;
SQL
}

canonical_hash_query() {
    cat <<'SQL'
SELECT encode(
    sha256(
        string_agg(id::text || document_type || status || document_number, ',' ORDER BY id)::bytea
    ),
    'hex'
) FROM core.business_documents;
SQL
}

echo "== capturing baseline from ${SOURCE_DB} =="
BASELINE="$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$SOURCE_DB" -t -A -F'|' -c "$(reconciliation_query)")"
BASELINE_HASH="$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$SOURCE_DB" -t -A -c "$(canonical_hash_query)")"

echo "== creating backup bundle (pg_dump, custom format) =="
pg_dump -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$SOURCE_DB" -Fc -f "$DUMP_FILE"

echo "== restoring into a fresh database, preserving ownership (no --no-owner) =="
psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -c "CREATE DATABASE ${RESTORE_DB} OWNER stockiha_owner;" >/dev/null
psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$RESTORE_DB" -c "GRANT CREATE ON DATABASE ${RESTORE_DB} TO stockiha_owner;" >/dev/null
pg_restore -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$RESTORE_DB" "$DUMP_FILE"

echo "== capturing reconciliation from restored database =="
RESTORED="$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$RESTORE_DB" -t -A -F'|' -c "$(reconciliation_query)")"
RESTORED_HASH="$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$RESTORE_DB" -t -A -c "$(canonical_hash_query)")"

echo "== comparing row counts and aggregates =="
if [ "$BASELINE" != "$RESTORED" ]; then
    echo "RECONCILIATION FAILED: row counts/aggregates differ" >&2
    diff <(echo "$BASELINE") <(echo "$RESTORED") || true
    exit 1
fi
echo "row counts and monetary aggregates match exactly"

echo "== comparing canonical business_documents hash =="
if [ "$BASELINE_HASH" != "$RESTORED_HASH" ]; then
    echo "RECONCILIATION FAILED: canonical hash differs ($BASELINE_HASH != $RESTORED_HASH)" >&2
    exit 1
fi
echo "canonical hash matches exactly: $BASELINE_HASH"

echo "== spot-checking that the security model survived the restore =="
DENIED="$(psql -h "$PGHOST" -p "$PGPORT" -U stockiha_runtime -d "$RESTORE_DB" -v ON_ERROR_STOP=0 -c "INSERT INTO iam.roles (code, name) VALUES ('RECONCILE_TEST', 'x');" 2>&1 || true)"
if ! echo "$DENIED" | grep -qi "permission denied"; then
    echo "RECONCILIATION FAILED: stockiha_runtime was NOT denied a protected write after restore" >&2
    exit 1
fi
echo "stockiha_runtime write denial still enforced after restore"

IMMUTABLE="$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$RESTORE_DB" -v ON_ERROR_STOP=0 -c "
    SET ROLE stockiha_owner;
    UPDATE core.business_documents SET document_date = '2099-01-01'
    WHERE id = (SELECT id FROM core.business_documents WHERE status IN ('POSTED','REVERSED') LIMIT 1);
" 2>&1 || true)"
if ! echo "$IMMUTABLE" | grep -qi "immutable"; then
    echo "RECONCILIATION FAILED: a posted business document was NOT immutable after restore" >&2
    exit 1
fi
echo "posted-document immutability still enforced after restore"

echo
echo "RECONCILIATION PASSED for ${SOURCE_DB} -> ${RESTORE_DB}"
