/**
 * Slice 2 — attribute value selection for one variant.
 * Note: Non-nested event handlers are used (no nested <form> elements)
 * to prevent outer form bubbling and accidental session/logout rejections.
 *
 * WS-D-10 — presentation rebuilt as chips. One row per attribute: the
 * attribute name, then its values as pills that wrap. The selected pill is
 * filled with the accent; the rest are outlined.
 *
 * WS-D-11:
 *   R7 — the full "create attribute" FORM is gone. Creating attribute TYPES is
 *     Catalogue Setup's job, and a form for it had no business sitting inside
 *     the variant editor. What stays is a compact "+" at the end of each chip
 *     row that adds a new VALUE to that attribute and selects it immediately —
 *     adding "Turquoise" to Colour without leaving the editor is a normal part
 *     of entering a product; inventing a new attribute type is not.
 *   R8 — every attribute stays visible even with nothing selected. Hiding the
 *     empty ones is how users forget the attribute exists.
 *   R9 — the chosen combination is summarised above the pickers. It is built
 *     from the selected values in attribute order; `attribute_signature` is a
 *     backend-derived identity string and is never parsed or reconstructed
 *     here.
 *   R10 — a variant may legitimately have no value for an attribute, so every
 *     row offers an explicit "None" chip. catalog.set_variant_attributes
 *     accepts a partial or empty array.
 *
 * *** THE RADIOS ARE LOAD-BEARING — DO NOT REPLACE THEM WITH BUTTONS ***
 * Each chip is a <label> wrapping a real, visually hidden <input type="radio">.
 * Two reasons, both binding:
 *   1. CR2. The regression test that has guarded the retired-value data-loss
 *      defect for eight consecutive commits finds values via
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
  /**
   * Retained for callers that still pass it (AttributeManagerForVariant is
   * frozen byte-identical under CR2). Creating attribute TYPES moved to
   * Catalogue Setup in WS-D-11, so this component no longer calls it.
   */
  onCreateAttribute: (name: string) => Promise<number>;
  onAddValue: (attributeId: number, value: string) => Promise<number>;
  busy?: boolean;
}

export function AttributeManager({
  attributes, refLoading, selected, onSelectionChange, onAddValue, busy,
}: Props) {
  const { t } = useI18n();
  const errorText = useErrorText();

  const [openAdder, setOpenAdder] = useState<number | null>(null);
  const [valueName, setValueName] = useState<Record<number, string>>({});
  const [valueError, setValueError] = useState<Record<number, string>>({});
  const [addingValue, setAddingValue] = useState<Record<number, boolean>>({});

  async function handleAddValue(attrId: number) {
    const name = (valueName[attrId] ?? '').trim();
    if (!name || addingValue[attrId]) return;
    setAddingValue((prev) => ({ ...prev, [attrId]: true }));
    setValueError((prev) => ({ ...prev, [attrId]: '' }));
    try {
      const newId = await onAddValue(attrId, name);
      setValueName((prev) => ({ ...prev, [attrId]: '' }));
      setOpenAdder(null);
      // R7: select it immediately — the operator added it in order to use it.
      onSelectionChange({ ...selected, [attrId]: newId });
    } catch (err) {
      setValueError((prev) => ({ ...prev, [attrId]: errorText(err) }));
    } finally {
      setAddingValue((prev) => ({ ...prev, [attrId]: false }));
    }
  }

  function handleSelect(attrId: number, valueId: number) {
    onSelectionChange({ ...selected, [attrId]: valueId });
  }

  /** R10 — clearing back to "no value for this attribute". */
  function handleClear(attrId: number) {
    const next = { ...selected };
    delete next[attrId];
    onSelectionChange(next);
  }

  function handleValueKeyDown(e: KeyboardEvent<HTMLInputElement>, attrId: number) {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      void handleAddValue(attrId);
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setOpenAdder(null);
    }
  }

  if (refLoading) return <Spinner />;

  // R9 — built from the selection in attribute order. Never from
  // attribute_signature, which is backend-derived identity, display-only.
  const summary = attributes
    .map((attr) => attr.attribute_values.find((av) => av.id === selected[attr.attribute_id])?.value)
    .filter((value): value is string => !!value)
    .join(' · ');

  return (
    <div className="sk-attr">
      <h3 className="sk-attr__title">{t('attrs.title')}</h3>

      <p className="sk-attr__summary" data-testid="attr-summary">
        <span className="sk-attr__summary-label">{t('attrs.selection')}:</span>{' '}
        <strong>{summary || t('attrs.noneSelected')}</strong>
      </p>

      {attributes.length === 0 ? (
        <Banner tone="info">{t('attrs.empty')}</Banner>
      ) : (
        <div className="sk-attr__list">
          {attributes.map((attr) => {
            const cleared = selected[attr.attribute_id] === undefined;
            return (
              <div key={attr.attribute_id} className="sk-attr__row">
                <div className="sk-attr__name">{attr.name}</div>

                {/* An inactive value only ever appears here when it is the one
                    this variant already holds (merged in by
                    mergeAssignedValues). It stays selectable so the user can
                    keep it, and is marked retired so they understand why it is
                    not offered elsewhere. */}
                <div className="sk-attr__chips">
                  {/* R10 */}
                  <label
                    className={`sk-attr__chip sk-attr__chip--none${cleared ? ' sk-attr__chip--selected' : ''}`}
                  >
                    <input
                      type="radio"
                      className="sk-attr__chip-input"
                      name={`attr-${attr.attribute_id}`}
                      value=""
                      checked={cleared}
                      onChange={() => handleClear(attr.attribute_id)}
                      disabled={busy}
                      data-testid={`attr-none-${attr.attribute_id}`}
                    />
                    {t('attrs.none')}
                  </label>

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

                  {/* R7 — compact inline "+", values only. */}
                  <button
                    type="button"
                    className="sk-attr__chip sk-attr__chip--add"
                    onClick={() => setOpenAdder((prev) => (prev === attr.attribute_id ? null : attr.attribute_id))}
                    aria-expanded={openAdder === attr.attribute_id}
                    aria-label={`${t('attrs.addValueShort')} — ${attr.name}`}
                    disabled={busy}
                    data-testid={`attr-add-value-${attr.attribute_id}`}
                  >
                    +
                  </button>
                </div>

                {openAdder === attr.attribute_id ? (
                  <div className="sk-attr__add-value">
                    <TextField
                      label={t('attrs.valueName')}
                      value={valueName[attr.attribute_id] ?? ''}
                      onChange={(e) => setValueName((prev) => ({ ...prev, [attr.attribute_id]: e.target.value }))}
                      onKeyDown={(e) => handleValueKeyDown(e, attr.attribute_id)}
                      error={valueError[attr.attribute_id] || undefined}
                      disabled={addingValue[attr.attribute_id] || busy}
                      data-testid={`attr-value-input-${attr.attribute_id}`}
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => void handleAddValue(attr.attribute_id)}
                      loading={addingValue[attr.attribute_id]}
                      disabled={!(valueName[attr.attribute_id] ?? '').trim() || busy}
                      data-testid={`attr-value-save-${attr.attribute_id}`}
                    >
                      {t('attrs.addValue')}
                    </Button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {/* R7 — where the create-attribute form used to be. */}
      <p className="sk-attr__setup-hint">{t('attrs.manageInSetup')}</p>
    </div>
  );
}
