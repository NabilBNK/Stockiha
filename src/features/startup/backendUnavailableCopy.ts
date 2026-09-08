/**
 * WS-K-1 — pure state-key resolution for the "backend unavailable" screen.
 *
 * Kept separate from the rendering component so the state-classification
 * logic is unit-testable without mounting React. Never touches the
 * `detail` string or any schema numbers when choosing a key: only the
 * closed `code`/`schema.status` values drive which localized copy is shown,
 * so the resolved key can never carry configuration content.
 *
 * WS-K-1.2 hotfix invariant, enforced by construction here and covered by a
 * full-matrix test in tests/backendUnavailableCopy.test.ts: **whenever
 * `diagnostic.code === 'OK'`, the resolved key must never be `'generic'`.**
 * `'generic'` is the only key whose copy says the service could not be
 * reached — showing it for a diagnostic that says `OK` is exactly the
 * contradiction (headline "Service unavailable" over technical details
 * reading `OK — connected...`) that a production run surfaced. `'generic'`
 * is reserved for the one case where nothing at all is known: no diagnostic
 * could be fetched.
 */
import type { DbDiagnostic } from '../../shared/ipc/gateway';

export type BackendUnavailableStateKey =
  | 'generic'
  | 'notConfigured'
  | 'invalidConfiguration'
  | 'connectRefused'
  | 'connectFailed'
  | 'authFailed'
  | 'databaseMissing'
  | 'poolSaturated'
  | 'schemaMissing'
  | 'schemaOlder'
  | 'schemaNewer'
  | 'okButUnavailable';

/**
 * Resolve which localized message set to show.
 *
 * `applied === 0` under `OLDER_THAN_BINARY` is K1-3's "connected, but the
 * database or schema is missing" state: `schema_version::check_schema_compatibility`
 * folds "the `_sqlx_migrations` bookkeeping table does not exist yet" into
 * that same status with `applied: 0` (see its own doc comment), rather than
 * inventing a separate mechanism — the frontend tells the two apart purely
 * by that number.
 *
 * `UP_TO_DATE` and `UNKNOWN` (WS-K-1.2) both map to `'okButUnavailable'`,
 * never to `'generic'`: in normal operation neither should ever reach this
 * screen at all (a schema-compatible or schema-unknown connection lets
 * `get_setup_status` proceed, per `db::pool_if_schema_compatible`), so
 * reaching here with `code === 'OK'` means some other, non-schema,
 * non-connectivity failure occurred — the copy must say that honestly
 * rather than claim the service is unreachable.
 */
export function resolveBackendUnavailableStateKey(
  diagnostic: DbDiagnostic | null,
): BackendUnavailableStateKey {
  if (!diagnostic) return 'generic';

  switch (diagnostic.code) {
    case 'NOT_CONFIGURED':
      return 'notConfigured';
    case 'INVALID_CONFIGURATION':
      return 'invalidConfiguration';
    case 'CONNECT_REFUSED':
      return 'connectRefused';
    case 'CONNECT_FAILED':
      return 'connectFailed';
    case 'AUTH_FAILED':
      return 'authFailed';
    case 'DATABASE_MISSING':
      return 'databaseMissing';
    case 'POOL_SATURATED':
      return 'poolSaturated';
    case 'OK':
      if (!diagnostic.schema) return 'okButUnavailable';
      switch (diagnostic.schema.status) {
        case 'OLDER_THAN_BINARY':
          return diagnostic.schema.applied === 0 ? 'schemaMissing' : 'schemaOlder';
        case 'NEWER_THAN_BINARY':
          return 'schemaNewer';
        case 'UP_TO_DATE':
        case 'UNKNOWN':
          return 'okButUnavailable';
      }
  }
}
