/**
 * WS-D-11 — the panel's field primitives, lifted out of CatalogPanel so the
 * variant editor column can use them too.
 *
 * Both commit when the user FINISHES with the control — text on blur or Enter,
 * a select on change, because a dropdown has no half-typed intermediate state.
 * Nothing commits on a keystroke: typing a price from 2000 to 2500 passes
 * through "2", and a keystroke save would write 2 DZD to a live product.
 *
 * On a failed commit the field reverts to the last value the database is known
 * to hold and surfaces the error. The UI must never show a value the database
 * does not hold.
 */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';

import { useI18n } from '../../shared/i18n';
import { useErrorText } from '../../shared/hooks/useErrorText';

type FieldState = 'idle' | 'saving' | 'saved' | 'error';

/** Commit-on-blur text field. Never commits on a keystroke. */
export function PanelField({
  id,
  label,
  value,
  commit,
  validate,
  testId,
}: {
  id: string;
  label: string;
  value: string;
  commit: (next: string) => Promise<void>;
  validate?: (next: string) => string | null;
  testId?: string;
}) {
  const errorText = useErrorText();
  const [lastGood, setLastGood] = useState(value);
  const [draft, setDraft] = useState(value);
  const [state, setState] = useState<FieldState>('idle');
  const [error, setError] = useState<string | null>(null);
  const savingRef = useRef(false);
  const dirty = draft !== lastGood;
  // Refs, not deps: this effect reacts to the SERVER value changing, never to
  // its own bookkeeping, and it must not clobber an edit in progress.
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  useEffect(() => {
    if (dirtyRef.current || savingRef.current) return;
    setLastGood(value);
    setDraft(value);
  }, [value]);

  const commitNow = useCallback(async () => {
    if (savingRef.current) return;
    const candidate = draft.trim();
    if (candidate === lastGood) {
      setDraft(candidate);
      setError(null);
      return;
    }
    const invalid = validate?.(candidate) ?? null;
    if (invalid) {
      setError(invalid);
      setState('error');
      return;
    }
    savingRef.current = true;
    setState('saving');
    setError(null);
    try {
      await commit(candidate);
      setLastGood(candidate);
      setDraft(candidate);
      setState('saved');
    } catch (err) {
      // Never show a value the database does not hold.
      setDraft(lastGood);
      setError(errorText(err));
      setState('error');
    } finally {
      savingRef.current = false;
    }
  }, [draft, lastGood, validate, commit, errorText]);

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      void commitNow();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setDraft(lastGood);
      setError(null);
      setState('idle');
    }
  }

  return (
    <div className="sk-catalog2__field">
      <label className="sk-catalog2__label" htmlFor={id}>{label}</label>
      <input
        id={id}
        className="sk-catalog2__input"
        value={draft}
        aria-invalid={state === 'error'}
        onChange={(e) => { setDraft(e.target.value); setState('idle'); setError(null); }}
        onBlur={() => void commitNow()}
        onKeyDown={onKeyDown}
        data-testid={testId}
      />
      <PanelStatus state={state} dirty={dirty} error={error} testId={testId} />
    </div>
  );
}

/** Commit-on-change select. */
export function PanelSelect({
  id,
  label,
  value,
  options,
  emptyLabel,
  commit,
  testId,
}: {
  id: string;
  label: string;
  value: string;
  options: { value: string; label: string }[];
  emptyLabel?: string;
  commit: (next: string) => Promise<void>;
  testId?: string;
}) {
  const errorText = useErrorText();
  const [state, setState] = useState<FieldState>('idle');
  const [error, setError] = useState<string | null>(null);

  async function handleChange(next: string) {
    setState('saving');
    setError(null);
    try {
      await commit(next);
      setState('saved');
    } catch (err) {
      setError(errorText(err));
      setState('error');
    }
  }

  return (
    <div className="sk-catalog2__field">
      <label className="sk-catalog2__label" htmlFor={id}>{label}</label>
      <select
        id={id}
        className="sk-catalog2__select"
        value={value}
        aria-invalid={state === 'error'}
        onChange={(e) => void handleChange(e.target.value)}
        data-testid={testId}
      >
        {emptyLabel !== undefined ? <option value="">{emptyLabel}</option> : null}
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <PanelStatus state={state} dirty={false} error={error} testId={testId} />
    </div>
  );
}

function PanelStatus({
  state, dirty, error, testId,
}: {
  state: FieldState;
  dirty: boolean;
  error: string | null;
  testId?: string;
}) {
  const { t } = useI18n();
  if (state === 'error' && error) {
    return (
      <p className="sk-catalog2__status sk-catalog2__status--error" role="alert" data-testid={testId ? `${testId}-error` : undefined}>
        {error}
      </p>
    );
  }
  if (state === 'saving') {
    return <p className="sk-catalog2__status sk-catalog2__status--saving">{t('catalog2.saving')}</p>;
  }
  if (dirty) {
    return <p className="sk-catalog2__status sk-catalog2__status--saving">{t('catalog2.pending')}</p>;
  }
  if (state === 'saved') {
    return (
      <p className="sk-catalog2__status sk-catalog2__status--saved" data-testid={testId ? `${testId}-saved` : undefined}>
        {t('catalog2.saved')}
      </p>
    );
  }
  return null;
}
