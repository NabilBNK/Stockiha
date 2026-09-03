/**
 * Slice 2 — attribute & attribute value management.
 * Note: Non-nested event handlers are used (no nested <form> elements)
 * to prevent outer form bubbling and accidental session/logout rejections.
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
    <div>
      <h3>{t('attrs.title')}</h3>

      {/* Create attribute section (no <form> to prevent nested form submit issues) */}
      <div className="sk-form">
        {attrError ? <Banner tone="error">{attrError}</Banner> : null}
        {attrOk ? <Banner tone="success">{t('attrs.created')}</Banner> : null}
        <div className="sk-form__grid">
          <TextField
            label={t('attrs.name')}
            value={attrName}
            onChange={(e) => setAttrName(e.target.value)}
            onKeyDown={handleAttrKeyDown}
            disabled={creatingAttr || busy}
          />
        </div>
        <Button
          type="button"
          onClick={() => void handleCreateAttr()}
          loading={creatingAttr}
          disabled={!attrName.trim() || busy}
        >
          {t('attrs.create')}
        </Button>
      </div>

      {/* Attribute list with value management and selection */}
      {attributes.length === 0 ? (
        <Banner tone="info">{t('attrs.empty')}</Banner>
      ) : (
        <div>
          {attributes.map((attr) => (
            <div key={attr.attribute_id} className="sk-card" style={{ marginBlockStart: '0.5rem' }}>
              <strong>{attr.name}</strong>

              {/* Value picker. An inactive value only ever appears here when
                  it is the one this variant already holds (merged in by
                  ProductEditor); it stays selectable so the user can keep it,
                  and is marked retired so they understand why it is not
                  offered elsewhere. */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBlockStart: '0.5rem' }}>
                {attr.attribute_values.map((av) => (
                  <label
                    key={av.id}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                    title={av.is_active ? undefined : t('attrs.retainedInactive')}
                  >
                    <input
                      type="radio"
                      name={`attr-${attr.attribute_id}`}
                      value={av.id}
                      checked={selected[attr.attribute_id] === av.id}
                      onChange={() => handleSelect(attr.attribute_id, av.id)}
                      disabled={busy}
                    />
                    {av.value}
                    {av.is_active ? null : (
                      <span className="sk-badge sk-badge--muted" data-testid={`attr-value-inactive-${av.id}`}>
                        {t('catalog.inactive')}
                      </span>
                    )}
                  </label>
                ))}
              </div>

              {/* Add value section */}
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end', marginBlockStart: '0.5rem' }}>
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
    </div>
  );
}
