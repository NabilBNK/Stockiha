/**
 * WS-D-CORRECTION-2 (CR2) attribute selection — the retired-value fix.
 *
 * WS-D-12 moved these two functions here VERBATIM from
 * src/features/products/ProductEditor.tsx, which was deleted when the old
 * Products page was retired. The bodies below are byte-identical to their text
 * at f7ec385 and to every commit since WS-D-CORRECTION-2; only the file they
 * live in and the import lines above them changed.
 *
 * DO NOT reformat, retype, "clean up" or modernise anything below this header.
 * `mergeAssignedValues` is the fix for a real data-loss defect — deactivating
 * an attribute value used to silently strip it off every variant that held it
 * on the next save — and it is guarded by the retired-value regression test in
 * tests/catalog2.workflow.test.tsx. If you find yourself editing either
 * function, stop: you are removing the guard, not improving it.
 */
import { useEffect, useMemo, useState } from 'react';

import { Banner, Button } from '../../shared/components';
import { useI18n } from '../../shared/i18n';
import { useErrorText } from '../../shared/hooks/useErrorText';
import type { AttributeDefinition, VariantDetail } from '../../shared/ipc/dto';
import { AttributeManager } from './AttributeManager';

/**
 * WS-D-CORRECTION-2 — the edit-path trap.
 *
 * `attributes` comes from catalog.list_attributes, which (correctly) now
 * offers ACTIVE attributes and values only. A variant's own attributes come
 * from get_product_detail, which (correctly) is unfiltered so history is
 * preserved. Editing a variant that holds a now-retired value therefore has to
 * reconcile the two: if the picker's options do not contain the variant's
 * current value, that value is invisible to the user and one careless save
 * could drop it.
 *
 * The fix is additive and per-variant: merge the variant's already-assigned
 * values into the option list, deduplicated by attribute_value_id, marked
 * inactive so the UI can flag them as retired. Two distinct cases:
 *
 *   1. value retired, attribute still active  -> append the value to that
 *      attribute's existing option list;
 *   2. the whole ATTRIBUTE retired            -> the attribute is absent from
 *      `attributes` entirely, so synthesize its entry holding just the
 *      assigned value.
 *
 * The picker itself is never unfiltered, so nothing retired is offered for a
 * variant that does not already hold it.
 */
export function mergeAssignedValues(
  attributes: AttributeDefinition[],
  variant: VariantDetail,
): AttributeDefinition[] {
  if (variant.attributes.length === 0) return attributes;

  const merged = attributes.map((a) => ({ ...a, attribute_values: [...a.attribute_values] }));
  const byAttributeId = new Map(merged.map((a) => [a.attribute_id, a]));

  for (const assigned of variant.attributes) {
    const target = byAttributeId.get(assigned.attribute_id);
    if (!target) {
      // Case 2: the attribute itself was deactivated, so list_attributes
      // omits it. Rebuild a minimal entry so the assignment stays visible.
      const synthesized: AttributeDefinition = {
        attribute_id: assigned.attribute_id,
        name: assigned.attribute_name,
        attribute_values: [
          { id: assigned.attribute_value_id, value: assigned.value, is_active: false },
        ],
      };
      merged.push(synthesized);
      byAttributeId.set(synthesized.attribute_id, synthesized);
      continue;
    }
    // Case 1: attribute is offered, but this specific value may have been
    // retired. Deduplicate by attribute_value_id — an active value is already
    // present and must not be duplicated or downgraded.
    if (!target.attribute_values.some((av) => av.id === assigned.attribute_value_id)) {
      target.attribute_values.push({
        id: assigned.attribute_value_id,
        value: assigned.value,
        is_active: false,
      });
    }
  }

  return merged;
}

/**
 * Attribute manager helper wired to a specific variant's selections.
 * WS-D-8a: exported so VariantRow can render it inline inside the expanded
 * variant row. Its mergeAssignedValues wiring is unchanged.
 */
export function AttributeManagerForVariant({
  attributes,
  refLoading,
  variant,
  onSetAttributes,
  onCreateAttribute,
  onAddValue,
}: {
  attributes: AttributeDefinition[];
  refLoading: boolean;
  variant: VariantDetail;
  onSetAttributes: (sel: Record<number, number>) => Promise<void>;
  onCreateAttribute: (name: string) => Promise<number>;
  onAddValue: (attrId: number, value: string) => Promise<number>;
}) {
  const { t } = useI18n();
  const errorText = useErrorText();
  const [selected, setSelected] = useState<Record<number, number>>(() => {
    const map: Record<number, number> = {};
    for (const a of variant.attributes) {
      map[a.attribute_id] = a.attribute_value_id;
    }
    return map;
  });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);

  useEffect(() => {
    const map: Record<number, number> = {};
    for (const a of variant.attributes) {
      map[a.attribute_id] = a.attribute_value_id;
    }
    setSelected(map);
  }, [variant]);

  // Options this variant may choose from: the active catalogue plus whatever
  // it already holds (even if retired). See mergeAssignedValues above.
  const optionsForVariant = useMemo(
    () => mergeAssignedValues(attributes, variant),
    [attributes, variant],
  );

  async function handleAssign() {
    setSaving(true);
    setSaveError(null);
    setSaveOk(false);
    try {
      await onSetAttributes(selected);
      setSaveOk(true);
    } catch (err) {
      setSaveError(errorText(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      {saveError ? <Banner tone="error">{saveError}</Banner> : null}
      {saveOk ? <Banner tone="success">{t('attrs.assigned')}</Banner> : null}
      <AttributeManager
        attributes={optionsForVariant}
        refLoading={refLoading}
        selected={selected}
        onSelectionChange={setSelected}
        onCreateAttribute={onCreateAttribute}
        onAddValue={onAddValue}
        busy={saving}
      />
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBlockStart: '0.75rem' }}>
        <Button type="button" onClick={() => void handleAssign()} loading={saving} disabled={saving}>
          {t('attrs.assign')}
        </Button>
      </div>
    </div>
  );
}
