import { describe, it, expect } from 'vitest';
import {
  parseTauriError,
  resolveErrorMessage,
  resolveErrorMessageKey,
} from '../src/shared/utils/tauriError';
import { UNKNOWN_ERROR } from '../src/shared/types/errors';

/** Must never appear in any resolved message. */
const SENTINEL = 'DO_NOT_EXPOSE_DIAGNOSTIC';

describe('parseTauriError', () => {
  it('accepts a recognized backend code', () => {
    expect(parseTauriError({ code: 'INTERNAL_ERROR' })).toBe('INTERNAL_ERROR');
  });

  it('accepts the S0-003 database codes', () => {
    expect(parseTauriError({ code: 'CONFIGURATION_ERROR' })).toBe('CONFIGURATION_ERROR');
    expect(parseTauriError({ code: 'DATABASE_UNAVAILABLE' })).toBe('DATABASE_UNAVAILABLE');
  });

  it('accepts the S4 credit-policy code without reading diagnostics', () => {
    expect(parseTauriError({ code: 'CREDIT_POLICY_BLOCKED', message: SENTINEL })).toBe(
      'CREDIT_POLICY_BLOCKED',
    );
  });

  it('ignores extra secret-like properties and keeps only the code', () => {
    expect(
      parseTauriError({
        code: 'INTERNAL_ERROR',
        message: SENTINEL,
        details: SENTINEL,
        stack: SENTINEL,
        token: 'super-secret',
      }),
    ).toBe('INTERNAL_ERROR');
  });

  it('returns UNKNOWN_ERROR for an unknown backend code', () => {
    expect(parseTauriError({ code: 'NOT_A_REAL_CODE' })).toBe(UNKNOWN_ERROR);
  });

  it('returns UNKNOWN_ERROR for a missing code', () => {
    expect(parseTauriError({ message: 'boom' })).toBe(UNKNOWN_ERROR);
  });

  it('returns UNKNOWN_ERROR for a malformed object', () => {
    expect(parseTauriError({})).toBe(UNKNOWN_ERROR);
    expect(parseTauriError(Object.create(null))).toBe(UNKNOWN_ERROR);
  });

  it('returns UNKNOWN_ERROR for an Error instance', () => {
    expect(parseTauriError(new Error('IPC error'))).toBe(UNKNOWN_ERROR);
  });

  it('returns UNKNOWN_ERROR for an arbitrary string', () => {
    expect(parseTauriError('INTERNAL_ERROR')).toBe(UNKNOWN_ERROR);
    expect(parseTauriError('some arbitrary message')).toBe(UNKNOWN_ERROR);
  });

  it('returns UNKNOWN_ERROR for numbers and booleans', () => {
    expect(parseTauriError(42)).toBe(UNKNOWN_ERROR);
    expect(parseTauriError(0)).toBe(UNKNOWN_ERROR);
    expect(parseTauriError(true)).toBe(UNKNOWN_ERROR);
    expect(parseTauriError(false)).toBe(UNKNOWN_ERROR);
  });

  it('returns UNKNOWN_ERROR for null and undefined', () => {
    expect(parseTauriError(null)).toBe(UNKNOWN_ERROR);
    expect(parseTauriError(undefined)).toBe(UNKNOWN_ERROR);
  });

  it('returns UNKNOWN_ERROR for arrays (including a code-like element)', () => {
    expect(parseTauriError([])).toBe(UNKNOWN_ERROR);
    expect(parseTauriError(['INTERNAL_ERROR'])).toBe(UNKNOWN_ERROR);
  });

  it('returns UNKNOWN_ERROR for a code that is not a string', () => {
    expect(parseTauriError({ code: 123 })).toBe(UNKNOWN_ERROR);
    expect(parseTauriError({ code: null })).toBe(UNKNOWN_ERROR);
    expect(parseTauriError({ code: { nested: 'INTERNAL_ERROR' } })).toBe(UNKNOWN_ERROR);
  });

  it('survives an object whose code getter throws', () => {
    const hostile = {
      get code(): string {
        throw new Error('exploding getter');
      },
    };
    expect(parseTauriError(hostile)).toBe(UNKNOWN_ERROR);
  });

  it('survives a revoked Proxy (every trap throws)', () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    expect(parseTauriError(proxy)).toBe(UNKNOWN_ERROR);
  });
});

describe('resolveErrorMessage', () => {
  it('returns the fixed internal message for a recognized code', () => {
    expect(resolveErrorMessage({ code: 'INTERNAL_ERROR' })).toBe(
      'An internal error occurred. Please try again.',
    );
  });

  it('returns fixed, detail-free messages for the S0-003 database codes', () => {
    expect(resolveErrorMessage({ code: 'CONFIGURATION_ERROR' })).toBe(
      'The application configuration is missing or invalid.',
    );
    expect(resolveErrorMessage({ code: 'DATABASE_UNAVAILABLE' })).toBe(
      'The database is currently unavailable.',
    );
  });

  it('returns fixed, detail-free copy for credit policy rejection', () => {
    const message = resolveErrorMessage({ code: 'CREDIT_POLICY_BLOCKED', details: SENTINEL });
    expect(message).toBe('Customer credit policy blocks this sale.');
    expect(message).not.toContain(SENTINEL);
  });

  it('returns the fixed unknown message for unrecognized values', () => {
    const unknownMsg = 'An unexpected error occurred. Please try again.';
    expect(resolveErrorMessage(new Error(SENTINEL))).toBe(unknownMsg);
    expect(resolveErrorMessage(SENTINEL)).toBe(unknownMsg);
    expect(resolveErrorMessage({ code: 'NOPE' })).toBe(unknownMsg);
    expect(resolveErrorMessage(null)).toBe(unknownMsg);
  });

  it('never echoes the sentinel diagnostic, regardless of input shape', () => {
    const inputs: unknown[] = [
      new Error(SENTINEL),
      SENTINEL,
      { code: 'INTERNAL_ERROR', message: SENTINEL, details: SENTINEL, stack: SENTINEL },
      { code: 'CREDIT_POLICY_BLOCKED', message: SENTINEL, details: SENTINEL },
      { code: SENTINEL },
      [SENTINEL],
      { get code() { throw new Error(SENTINEL); } },
    ];
    for (const input of inputs) {
      expect(resolveErrorMessage(input)).not.toContain(SENTINEL);
    }
  });

  it('never returns String(error) for an object input', () => {
    const err = { code: 'INTERNAL_ERROR', toString: () => SENTINEL };
    expect(resolveErrorMessage(err)).not.toBe(String(err));
    expect(resolveErrorMessage(err)).not.toContain(SENTINEL);
  });
});

describe('resolveErrorMessageKey', () => {
  it('maps recognized and unknown values to stable i18n keys', () => {
    expect(resolveErrorMessageKey({ code: 'INTERNAL_ERROR' })).toBe('errors.internal');
    expect(resolveErrorMessageKey({ code: 'CONFIGURATION_ERROR' })).toBe('errors.configuration');
    expect(resolveErrorMessageKey({ code: 'DATABASE_UNAVAILABLE' })).toBe(
      'errors.databaseUnavailable',
    );
    expect(resolveErrorMessageKey({ code: 'CREDIT_POLICY_BLOCKED' })).toBe(
      'errors.preconditionFailed',
    );
    expect(resolveErrorMessageKey(new Error('x'))).toBe('errors.unknown');
  });
});
