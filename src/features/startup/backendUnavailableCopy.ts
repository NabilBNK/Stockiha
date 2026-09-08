/**
 * WS-K-1 — pure state-key resolution for the "backend unavailable" screen.
 *
 * Kept separate from the rendering component so the state-classification
 * logic is unit-testable without mounting React. Never touches the
 * `detail` string or any schema numbers when choosing a key: only the
 * closed `code`/`schema.status` values drive which localized copy is shown,
 * so the resolved key can never carry configuration content.
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
  | 'schemaNewer';

/**
 * Resolve which localized message set to show.
 *
 * `applied === 0` under `OLDER_THAN_BINARY` is K1-3's "connected, but the
 * database or schema is missing" state: `schema_version::check_schema_compatibility`
 * folds "the `_sqlx_migrations` bookkeeping table does not exist yet" into
 * that same status with `applied: 0` (see its own doc comment), rather than
 * inventing a separate mechanism — the frontend tells the two apart purely
 * by that number.
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
      if (!diagnostic.schema) return 'generic';
      switch (diagnostic.schema.status) {
        case 'OLDER_THAN_BINARY':
          return diagnostic.schema.applied === 0 ? 'schemaMissing' : 'schemaOlder';
        case 'NEWER_THAN_BINARY':
          return 'schemaNewer';
        case 'UP_TO_DATE':
          // A schema-compatible, connected database should never reach this
          // screen — `get_setup_status` only fails to get here in the first
          // place when something else is wrong. Fall back to the generic
          // message rather than claim a specific cause that isn't true.
          return 'generic';
      }
  }
}
