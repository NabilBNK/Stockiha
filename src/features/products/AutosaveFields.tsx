/**
 * WS-D-8a — the visible half of commit-on-blur autosave.
 *
 * A quiet per-field indicator, never a banner or a modal: the user must always
 * know their change landed, without anything stealing focus (RULING 2).
 */
import type { ReactNode } from 'react';

import { useI18n } from '../../shared/i18n';
import type { AutosaveField } from './useAutosaveField';

export function AutosaveStatus({ field, testId }: { field: AutosaveField; testId?: string }) {
  const { t } = useI18n();

  if (field.error) {
    return (
      <p className="sk-autosave sk-autosave--error" role="alert" data-testid={testId ? `${testId}-error` : undefined}>
        {field.error}
      </p>
    );
  }
  if (field.saving) {
    return (
      <p className="sk-autosave sk-autosave--saving" data-testid={testId ? `${testId}-saving` : undefined}>
        {t('autosave.saving')}
      </p>
    );
  }
  if (field.dirty) {
    return (
      <p className="sk-autosave sk-autosave--dirty" data-testid={testId ? `${testId}-dirty` : undefined}>
        {t('autosave.pending')}
      </p>
    );
  }
  if (field.saved) {
    return (
      <p className="sk-autosave sk-autosave--saved" data-testid={testId ? `${testId}-saved` : undefined}>
        {t('autosave.saved')}
      </p>
    );
  }
  return null;
}

/**
 * Text input that commits on blur or Enter. Deliberately NOT wired to
 * onChange: see the rationale in useAutosaveField.ts.
 */
export function AutosaveTextField({
  id,
  label,
  field,
  hint,
  inputMode,
  placeholder,
  testId,
}: {
  id: string;
  label: string;
  field: AutosaveField;
  hint?: ReactNode;
  inputMode?: 'decimal' | 'text' | 'numeric';
  placeholder?: string;
  testId?: string;
}) {
  return (
    <div className="sk-field">
      <label className="sk-field__label" htmlFor={id}>{label}</label>
      <input
        id={id}
        className="sk-field__input"
        value={field.value}
        inputMode={inputMode}
        placeholder={placeholder}
        aria-invalid={!!field.error}
        onChange={(e) => field.setValue(e.target.value)}
        onBlur={field.onBlur}
        onKeyDown={field.onKeyDown}
        disabled={field.saving}
        data-testid={testId}
      />
      {hint ? <p className="sk-field__hint">{hint}</p> : null}
      <AutosaveStatus field={field} testId={testId} />
    </div>
  );
}

/**
 * Select that commits on change — a dropdown has no half-typed intermediate
 * state, so change IS the moment the user finished with it.
 */
export function AutosaveSelectField({
  id,
  label,
  field,
  options,
  emptyLabel,
  testId,
}: {
  id: string;
  label: string;
  field: AutosaveField;
  options: { value: string; label: string }[];
  emptyLabel?: string;
  testId?: string;
}) {
  return (
    <div className="sk-field">
      <label className="sk-field__label" htmlFor={id}>{label}</label>
      <select
        id={id}
        className="sk-field__input"
        value={field.value}
        aria-invalid={!!field.error}
        onChange={(e) => field.commitValue(e.target.value)}
        disabled={field.saving}
        data-testid={testId}
      >
        {emptyLabel !== undefined ? <option value="">{emptyLabel}</option> : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <AutosaveStatus field={field} testId={testId} />
    </div>
  );
}
