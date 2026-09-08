import { describe, it, expect } from 'vitest';
import { resolveBackendUnavailableStateKey } from '../src/features/startup/backendUnavailableCopy';
import type { DbDiagnostic } from '../src/shared/ipc/gateway';

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

  it('treats OK with no schema info as generic', () => {
    expect(resolveBackendUnavailableStateKey(diag({ code: 'OK', schema: null }))).toBe('generic');
  });

  it('treats OK + UP_TO_DATE as generic (should never actually reach this screen)', () => {
    expect(
      resolveBackendUnavailableStateKey(diag({ code: 'OK', schema: { status: 'UP_TO_DATE' } })),
    ).toBe('generic');
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
});
