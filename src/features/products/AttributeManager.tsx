/**
 * Slice 2 — attribute & attribute value management.
 * Note: Non-nested event handlers are used (no nested <form> elements)
 * to prevent outer form bubbling and accidental session/logout rejections.
 *
 * WS-D-10 — presentation rebuilt as chips (RULING 4). One row per attribute:
 * the attribute name, then its values as pills that wrap. The selected pill is
 * filled with the accent; the rest are outlined. Creating a new attribute
 * moved BELOW the value selection — picking is the constant action, creating
 * is the rare one, and the rare one had been sitting on top of it.
 *
 * *** THE RADIOS ARE LOAD-BEARING — DO NOT REPLACE THEM WITH BUTTONS ***
 * Each chip is a <label> wrapping a real, visually hidden <input type="radio">.
 * Two reasons, both binding:
 *   1. CR2. The regression test that has guarded the retired-value data-loss
 *      defect for seven consecutive commits finds values via
 *      getByRole('radio', { name: 'Burgendy' }). Swapping in <button> breaks
 *      it, and with it the only automated proof that deactivating an attribute
 *      value does not silently strip it off existing variants.
 *   2. It is the correct accessible pattern for single-select. Keyboard arrow
 *      navigation and screen-reader group semantics come free from the radio
 *      group; a row of buttons would have to reimplement both, badly.
 * The hiding uses the clip pattern, never display:none or visibility:hidden,
 * which would remove the input from the accessibility tree entirely.
 *
 * A chip's label text is exactly the value (plus the retired marker for an
 * inactive one). Do not add other visible text inside the label — it becomes
 * part of the radio's accessible name and the CR2 test matches on that.
 *
 * This component is shared with the older products screen, which picks up the
 * same picker. That is expected; the old screen is scheduled for retirement
 * and forking the component to avoid it would fork the CR2 behaviour too.
 */
import { useState, type KeyboardEvent } from 'react';

import { Banner, Button, Spinner, TextField } from '../../shared/components';
import { useI18n } from '../../shared/i18n';
import { useErrorText } from '../../shared/hooks/useErrorText';
import type { AttributeDefinition } from '../../shared/ipc/dto';

interface Props {
  attributes: AttributeDefinition[];
  refLoading: boolean;
  /** Current selection: attribute_id -> attribute_value_id */
  selected: Record<number, number>;
  onSelectionChange: (selected: Record<number, number>) => void;
  onCreateAttribute: (name: string) => Promise<number>;
  onAddValue: (attributeId: number, value: string) => Promise<number>;
  busy?: boolean;
}

export function AttributeManager({
  attributes, refLoading, selected, onSelectionChange,
  onCreateAttribute, onAddValue, busy,
}: Props) {
  const { t } = useI18n();
  const errorText = useErrorText();
  const [attrName, setAttrName] = useState('');
  const [attrError, setAttrError] = useState<string | null>(null);
  const [attrOk, setAttrOk] = useState(false);
  const [creatingAttr, setCreatingAttr] = useState(false);

  const [valueName, setValueName] = useState<Record<number, string>>({});
  const [valueError, setValueError] = useState<Record<number, string>>({});
  const [valueOk, setValueOk] = useState<Record<number, boolean>>({});
  const [addingValue, setAddingValue] = useState<Record<number, boolean>>({});

  async function handleCreateAttr() {
    if (creatingAttr || !attrName.trim()) return;
    setCreatingAttr(true);
    setAttrError(null);
    setAttrOk(false);
    try {
      await onCreateAttribute(attrName.trim());
      setAttrName('');
      setAttrOk(true);
    } catch (err) {
      setAttrError(errorText(err));
    } finally {
      setCreatingAttr(false);
    }
  }

  async function handleAddValue(attrId: number) {
    const name = (valueName[attrId] ?? '').trim();
    if (!name || addingValue[attrId]) return;
    setAddingValue((prev) => ({ ...prev, [attrId]: true }));
    setValueError((prev) => ({ ...prev, [attrId]: '' }));
    setValueOk((prev) => ({ ...prev, [attrId]: false }));
    try {
      await onAddValue(attrId, name);
      setValueName((prev) => ({ ...prev, [attrId]: '' }));
      setValueOk((prev) => ({ ...prev, [attrId]: true }));
    } catch (err) {
      setValueError((prev) => ({ ...prev, [attrId]: errorText(err) }));
    } finally {
      setAddingValue((prev) => ({ ...prev, [attrId]: false }));
    }
  }

  function handleSelect(attrId: number, valueId: number) {
    onSelectionChange({ ...selected, [attrId]: valueId });
  }

  function handleAttrKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      void handleCreateAttr();
    }
  }

  function handleValueKeyDown(e: KeyboardEvent<HTMLInputElement>, attrId: number) {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      void handleAddValue(attrId);
    }
  }

  if (refLoading) return <Spinner />;

  return (
    <div className="sk-attr">
      <h3 className="sk-attr__title">{t('attrs.title')}</h3>

      {/* VALUE SELECTION FIRST — the constant action. */}
      {attributes.length === 0 ? (
        <Banner tone="info">{t('attrs.empty')}</Banner>
      ) : (
        <div className="sk-attr__list">
          {attributes.map((attr) => (
            <div key={attr.attribute_id} className="sk-attr__row">
              <div className="sk-attr__name">{attr.name}</div>

              {/* An inactive value only ever appears here when it is the one
                  this variant already holds (merged in by mergeAssignedValues).
                  It stays selectable so the user can keep it, and is marked
                  retired so they understand why it is not offered elsewhere. */}
              <div className="sk-attr__chips">
                {attr.attribute_values.map((av) => {
                  const isSelected = selected[attr.attribute_id] === av.id;
                  return (
                    <label
                      key={av.id}
                      className={[
                        'sk-attr__chip',
                        isSelected ? 'sk-attr__chip--selected' : '',
                        av.is_active ? '' : 'sk-attr__chip--retired',
                      ].filter(Boolean).join(' ')}
                      title={av.is_active ? undefined : t('attrs.retainedInactive')}
                    >
                      <input
                        type="radio"
                        className="sk-attr__chip-input"
                        name={`attr-${attr.attribute_id}`}
                        value={av.id}
                        checked={isSelected}
                        onChange={() => handleSelect(attr.attribute_id, av.id)}
                        disabled={busy}
                      />
                      {av.value}
                      {av.is_active ? null : (
                        <span className="sk-attr__retired" data-testid={`attr-value-inactive-${av.id}`}>
                          {t('catalog.inactive')}
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>

              <div className="sk-attr__add-value">
                <TextField
                  label={t('attrs.valueName')}
                  value={valueName[attr.attribute_id] ?? ''}
                  onChange={(e) => setValueName((prev) => ({ ...prev, [attr.attribute_id]: e.target.value }))}
                  onKeyDown={(e) => handleValueKeyDown(e, attr.attribute_id)}
                  error={valueError[attr.attribute_id] || undefined}
                  disabled={addingValue[attr.attribute_id] || busy}
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => void handleAddValue(attr.attribute_id)}
                  loading={addingValue[attr.attribute_id]}
                  disabled={!(valueName[attr.attribute_id] ?? '').trim() || busy}
                >
                  {t('attrs.addValue')}
                </Button>
              </div>
              {valueOk[attr.attribute_id] ? <Banner tone="success">{t('attrs.valueAdded')}</Banner> : null}
            </div>
          ))}
        </div>
      )}

      {/* CREATE ATTRIBUTE LAST — the rare action, below the constant one.
          No <form>: this renders inside other forms, and a nested submit would
          bubble to the wrong handler. */}
      <div className="sk-attr__create">
        {attrError ? <Banner tone="error">{attrError}</Banner> : null}
        {attrOk ? <Banner tone="success">{t('attrs.created')}</Banner> : null}
        <div className="sk-attr__create-row">
          <TextField
            label={t('attrs.name')}
            value={attrName}
            onChange={(e) => setAttrName(e.target.value)}
            onKeyDown={handleAttrKeyDown}
            disabled={creatingAttr || busy}
          />
          <Button
            type="button"
            variant="secondary"
            onClick={() => void handleCreateAttr()}
            loading={creatingAttr}
            disabled={!attrName.trim() || busy}
          >
            {t('attrs.create')}
          </Button>
        </div>
      </div>
    </div>
  );
}
