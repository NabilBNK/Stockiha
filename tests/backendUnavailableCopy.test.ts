import { describe, it, expect } from 'vitest';
import {
  resolveBackendUnavailableStateKey,
  type BackendUnavailableStateKey,
} from '../src/features/startup/backendUnavailableCopy';
import type { DbDiagnostic, DbReasonCode, SchemaCompatibility } from '../src/shared/ipc/gateway';

function diag(partial: Partial<DbDiagnostic>): DbDiagnostic {
  return { code: 'OK', detail: '', schema: null, config_warning: null, ...partial };
}

describe('resolveBackendUnavailableStateKey', () => {
  it('returns generic for a null diagnostic', () => {
    expect(resolveBackendUnavailableStateKey(null)).toBe('generic');
  });

  it('maps every non-OK DbReasonCode to its own state', () => {
    expect(resolveBackendUnavailableStateKey(diag({ code: 'NOT_CONFIGURED' }))).toBe('notConfigured');
    expect(resolveBackendUnavailableStateKey(diag({ code: 'INVALID_CONFIGURATION' }))).toBe(
      'invalidConfiguration',
    );
    expect(resolveBackendUnavailableStateKey(diag({ code: 'CONNECT_REFUSED' }))).toBe('connectRefused');
    expect(resolveBackendUnavailableStateKey(diag({ code: 'CONNECT_FAILED' }))).toBe('connectFailed');
    expect(resolveBackendUnavailableStateKey(diag({ code: 'AUTH_FAILED' }))).toBe('authFailed');
    expect(resolveBackendUnavailableStateKey(diag({ code: 'DATABASE_MISSING' }))).toBe('databaseMissing');
    expect(resolveBackendUnavailableStateKey(diag({ code: 'POOL_SATURATED' }))).toBe('poolSaturated');
  });

  // WS-K-1.2 hotfix regression: a diagnostic that says the connection is OK
  // must never resolve to 'generic' — 'generic' is the only key whose copy
  // claims the service could not be reached, and showing it over a
  // technical-details panel reading `OK` is the exact contradiction a
  // production run surfaced.
  it('treats OK with no schema info as okButUnavailable, never generic', () => {
    expect(resolveBackendUnavailableStateKey(diag({ code: 'OK', schema: null }))).toBe(
      'okButUnavailable',
    );
  });

  it('treats OK + UP_TO_DATE as okButUnavailable (should never actually reach this screen)', () => {
    expect(
      resolveBackendUnavailableStateKey(diag({ code: 'OK', schema: { status: 'UP_TO_DATE' } })),
    ).toBe('okButUnavailable');
  });

  it('treats OK + UNKNOWN schema as okButUnavailable, never as a schema-specific claim', () => {
    expect(
      resolveBackendUnavailableStateKey(diag({ code: 'OK', schema: { status: 'UNKNOWN' } })),
    ).toBe('okButUnavailable');
  });

  it('distinguishes "never set up" (applied 0) from "behind" (applied > 0) under OLDER_THAN_BINARY', () => {
    expect(
      resolveBackendUnavailableStateKey(
        diag({ code: 'OK', schema: { status: 'OLDER_THAN_BINARY', applied: 0, latest: 5 } }),
      ),
    ).toBe('schemaMissing');
    expect(
      resolveBackendUnavailableStateKey(
        diag({ code: 'OK', schema: { status: 'OLDER_THAN_BINARY', applied: 3, latest: 5 } }),
      ),
    ).toBe('schemaOlder');
  });

  it('maps NEWER_THAN_BINARY to schemaNewer', () => {
    expect(
      resolveBackendUnavailableStateKey(
        diag({ code: 'OK', schema: { status: 'NEWER_THAN_BINARY', applied: 9, latest: 5 } }),
      ),
    ).toBe('schemaNewer');
  });

  // Required by the WS-K-1.2 hotfix: assert the no-contradiction invariant
  // over the FULL (reason code, schema status) matrix, not one example.
  describe('full matrix: no (code, schema) pair produces a contradictory headline', () => {
    const ALL_CODES: DbReasonCode[] = [
      'OK',
      'NOT_CONFIGURED',
      'INVALID_CONFIGURATION',
      'CONNECT_REFUSED',
      'CONNECT_FAILED',
      'AUTH_FAILED',
      'DATABASE_MISSING',
      'POOL_SATURATED',
    ];
    const ALL_SCHEMAS: Array<SchemaCompatibility | null> = [
      null,
      { status: 'UP_TO_DATE' },
      { status: 'UNKNOWN' },
      { status: 'OLDER_THAN_BINARY', applied: 0, latest: 5 },
      { status: 'OLDER_THAN_BINARY', applied: 3, latest: 5 },
      { status: 'NEWER_THAN_BINARY', applied: 9, latest: 5 },
    ];

    // 'generic' is the only key that claims the service is unreachable —
    // that claim is only ever true when there is no diagnostic at all.
    const CLAIMS_UNREACHABLE: BackendUnavailableStateKey = 'generic';

    for (const code of ALL_CODES) {
      for (const schema of ALL_SCHEMAS) {
        it(`code=${code} schema=${schema ? schema.status : 'null'}`, () => {
          const key = resolveBackendUnavailableStateKey(diag({ code, schema }));
          if (code === 'OK') {
            expect(key).not.toBe(CLAIMS_UNREACHABLE);
          }
        });
      }
    }

    it('the null diagnostic is the only case allowed to claim unreachability', () => {
      expect(resolveBackendUnavailableStateKey(null)).toBe(CLAIMS_UNREACHABLE);
    });
  });
});
