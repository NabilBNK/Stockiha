/**
 * WS-D-9 — click-to-edit table cell (RULING 3).
 *
 * Click the cell, it becomes an input in place. It commits on BLUR or ENTER —
 * the moment the user finishes with it — and NEVER on a keystroke, and never
 * on a keystroke debounce timer. That is not a style preference: typing a
 * price from 2000 to 2500 passes through the value "2", and a keystroke save
 * would write 2 DZD to a live product. The same applies to minimum stock.
 *
 * ESCAPE cancels: the draft is discarded, the previous value is restored, and
 * nothing is sent.
 *
 * An invalid value is never sent. The error shows inline and the cell stays
 * editable so the user can fix what they typed rather than losing it.
 *
 * On a FAILED commit the cell reverts to the last known-good server value AND
 * surfaces the error. The UI must never show a value the database does not
 * hold.
 */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';

import { useErrorText } from '../../shared/hooks/useErrorText';
import { useI18n } from '../../shared/i18n';

export interface InlineCellProps {
  /** The authoritative value as the server currently holds it. */
  value: string;
  /** Accessible name for both the trigger and the input. */
  label: string;
  /** Display transform; the raw string is what gets edited and sent. */
  format?: (value: string) => string;
  /** Returns a localized error message, or null when acceptable. */
  validate?: (value: string) => string | null;
  /** Performs exactly one write. Must resolve only on success. */
  commit: (value: string) => Promise<void>;
  disabled?: boolean;
  testId?: string;
}

export function InlineCell({
  value,
  label,
  format,
  validate,
  commit,
  disabled,
  testId,
}: InlineCellProps) {
  const { t } = useI18n();
  const errorText = useErrorText();

  const [lastGood, setLastGood] = useState(value);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const savingRef = useRef(false);
  // Removing a focused input fires blur; without this, Escape would cancel and
  // then immediately be followed by a commit attempt.
  const cancelledRef = useRef(false);

  // Adopt a new server value whenever the row is refreshed, unless the user is
  // mid-edit — a reload must never yank text out from under them.
  useEffect(() => {
    if (editing || savingRef.current) return;
    setLastGood(value);
    setDraft(value);
  }, [value, editing]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const startEditing = useCallback(() => {
    if (disabled || saving) return;
    setDraft(lastGood);
    setError(null);
    cancelledRef.current = false;
    setEditing(true);
  }, [disabled, saving, lastGood]);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    setDraft(lastGood);
    setError(null);
    setEditing(false);
  }, [lastGood]);

  const commitNow = useCallback(async () => {
    if (savingRef.current) return;
    const candidate = draft.trim();

    if (candidate === lastGood) {
      // Nothing changed. A no-op write is still a round-trip that can fail.
      setEditing(false);
      setError(null);
      return;
    }

    const invalid = validate?.(candidate) ?? null;
    if (invalid) {
      setDraft(candidate);
      setError(invalid);
      return; // stays editable, nothing sent
    }

    savingRef.current = true;
    setSaving(true);
    setError(null);
    setEditing(false);
    try {
      await commit(candidate);
      setLastGood(candidate);
      setDraft(candidate);
    } catch (err) {
      // Revert to the last value the database is known to hold, and say why.
      setDraft(lastGood);
      setError(errorText(err));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [draft, lastGood, validate, commit, errorText]);

  function handleBlur() {
    if (cancelledRef.current) {
      cancelledRef.current = false;
      return;
    }
    void commitNow();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      void commitNow();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancel();
    }
  }

  if (editing) {
    return (
      <>
        <input
          ref={inputRef}
          className="sk-catalog2__cell-input"
          aria-label={label}
          aria-invalid={!!error}
          inputMode="decimal"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          data-testid={testId}
        />
        {error ? (
          <span className="sk-catalog2__cell-error" role="alert" data-testid={testId ? `${testId}-error` : undefined}>
            {error}
          </span>
        ) : null}
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        className="sk-catalog2__cell-button"
        aria-label={label}
        onClick={startEditing}
        disabled={disabled || saving}
        data-testid={testId ? `${testId}-trigger` : undefined}
      >
        {format ? format(lastGood) : lastGood}
      </button>
      {saving ? (
        <span className="sk-catalog2__cell-saving" data-testid={testId ? `${testId}-saving` : undefined}>
          {t('catalog2.saving')}
        </span>
      ) : null}
      {error ? (
        <span className="sk-catalog2__cell-error" role="alert" data-testid={testId ? `${testId}-error` : undefined}>
          {error}
        </span>
      ) : null}
    </>
  );
}
