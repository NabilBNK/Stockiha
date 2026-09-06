/**
 * WS-D-5 — a reference-data picker with a create-only inline shortcut.
 *
 * Locked D-0 design ruling: inside the product form, reference pickers may
 * CREATE a new item and select it immediately, and nothing more. Rename,
 * deactivate and delete stay exclusively on the Catalogue Setup screen, so an
 * operator cannot reshape shared reference data by accident while entering a
 * product.
 *
 * The caller's `onCreate` is expected to create the item, refresh the list,
 * and return the new id; this component then selects that id.
 */
import { useState, type KeyboardEvent } from 'react';

import { Button, TextField } from '../../shared/components';
import { useErrorText } from '../../shared/hooks/useErrorText';
import { useI18n } from '../../shared/i18n';

export interface InlineCreateOption {
  id: number;
  /** Text shown in the dropdown. */
  label: string;
}

interface Props {
  id: string;
  label: string;
  options: InlineCreateOption[];
  value: number | null;
  onChange: (value: number | null) => void;
  /** Creates the item and returns its new id. */
  onCreate: (name: string) => Promise<number>;
  /** Label for the "no selection" option. Omit to make the field required. */
  emptyLabel?: string;
  createLabel: string;
  newItemLabel: string;
  disabled?: boolean;
  testId?: string;
}

export function InlineCreateSelect({
  id, label, options, value, onChange, onCreate,
  emptyLabel, createLabel, newItemLabel, disabled, testId,
}: Props) {
  const { t } = useI18n();
  const errorText = useErrorText();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    const name = draft.trim();
    if (!name || busy) return;
    setBusy(true);
    setError(null);
    try {
      const newId = await onCreate(name);
      // Select the freshly created item straight away — the whole point of the
      // shortcut is that the operator does not have to go looking for it.
      onChange(newId);
      setDraft('');
      setAdding(false);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      // This picker is rendered inside a <form>; Enter must create the item,
      // not submit the product.
      e.preventDefault();
      e.stopPropagation();
      void handleCreate();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setAdding(false);
      setDraft('');
      setError(null);
    }
  }

  return (
    <div className="sk-field">
      <label className="sk-field__label" htmlFor={id}>{label}</label>
      <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
        <select
          id={id}
          className="sk-field__input"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
          disabled={disabled || busy}
          data-testid={testId}
          style={{ flex: 1 }}
        >
          {emptyLabel !== undefined ? <option value="">{emptyLabel}</option> : null}
          {options.map((o) => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </select>
        <Button
          type="button"
          variant="secondary"
          onClick={() => setAdding((prev) => !prev)}
          disabled={disabled || busy}
          data-testid={testId ? `${testId}-new` : undefined}
          style={{ whiteSpace: 'nowrap', paddingInline: '0.6rem' }}
          aria-expanded={adding}
        >
          + {newItemLabel}
        </Button>
      </div>

      {adding ? (
        <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'flex-end', marginBlockStart: '0.5rem' }}>
          <div style={{ flex: 1 }}>
            <TextField
              label={createLabel}
              id={`${id}-new-name`}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              error={error ?? undefined}
              disabled={busy}
              data-testid={testId ? `${testId}-new-name` : undefined}
            />
          </div>
          <Button
            type="button"
            onClick={() => void handleCreate()}
            loading={busy}
            disabled={!draft.trim() || busy}
            data-testid={testId ? `${testId}-new-save` : undefined}
          >
            {t('common.create')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => { setAdding(false); setDraft(''); setError(null); }}
            disabled={busy}
          >
            {t('common.cancel')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
