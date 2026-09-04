/**
 * WS-D-8a — product CREATION only.
 *
 * The edit flow moved to ProductsWorkspace / ProductDetailPanel / VariantRow,
 * which rebuilt it as a master-detail screen with field-level commit-on-blur
 * and zero nested modals. Creation is untouched here and is rebuilt separately
 * under WS-D-8b (attribute-grid variant generation); this file keeps it
 * working exactly as WS-D-5 delivered it.
 *
 * Two things in this file are load-bearing for the edit flow and are exported
 * from here on purpose (WS-D-CORRECTION-2): `mergeAssignedValues` and the
 * `AttributeManagerForVariant` that wires it. See their comments below.
 *
 * Authoritative Stockiha Product Architecture, unchanged:
 * 1. Product owns Product Name, Category, Unit (`unit_id`), and Active state.
 * 2. Variant fields: Name override (optional), Barcode, Sale Price (DZD),
 *    Minimum stock, Attributes, Active status.
 * 3. Automatic SKU generation (never user-entered).
 * 4. Scanner-friendly text barcodes (preserves leading zeroes).
 */
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';

import { Banner, Button, TextField } from '../../shared/components';
import { useI18n } from '../../shared/i18n';
import { useErrorText } from '../../shared/hooks/useErrorText';
import type { AttributeDefinition, VariantDetail } from '../../shared/ipc/dto';
import { VariantForm, isVariantFormValid, type VariantFormValues } from './VariantForm';
import { AttributeManager } from './AttributeManager';
import { InlineCreateSelect } from './InlineCreateSelect';
import { useCatalog } from './useCatalog';

const EMPTY_VARIANT: VariantFormValues = {
  nameOverride: '',
  barcode: '',
  salePrice: '',
  // WS-D-5: "0" is the meaningful default — it means "never warn me about this
  // item" (ws-d-skill.md section 3), not "unset". It is seeded explicitly as a
  // string so it is transmitted as "0" rather than silently coerced later.
  minimumStock: '0',
  isActive: true,
};

interface Props {
  token: string;
  onCreated?: (productId: number) => void;
  onBack: () => void;
}

export function ProductEditor({ token, onCreated, onBack }: Props) {
  const { t } = useI18n();
  const errorText = useErrorText();
  const catalog = useCatalog(token);

  // Product-level state
  const [productName, setProductName] = useState('');
  const [productUnitId, setProductUnitId] = useState<number | null>(null);
  // WS-D-5: category is a PRODUCT-level field (never variant-level) and is
  // optional — null means "uncategorised", which the backend accepts.
  const [productCategoryId, setProductCategoryId] = useState<number | null>(null);
  const [productActive, setProductActive] = useState(true);

  // Variant creation state
  const [variantForms, setVariantForms] = useState<VariantFormValues[]>([{ ...EMPTY_VARIANT }]);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Attribute selection (per-variant index)
  const [attrSelections, setAttrSelections] = useState<Record<number, Record<number, number>>>({});

  useEffect(() => {
    void catalog.loadRefData();
  }, [catalog.loadRefData]);

  // Default unit initialization
  useEffect(() => {
    if (!productUnitId && catalog.units.length > 0) {
      setProductUnitId(catalog.units[0].id);
    }
  }, [catalog.units, productUnitId]);

  function updateVariantForm(index: number, values: VariantFormValues) {
    setVariantForms((prev) => prev.map((v, i) => (i === index ? values : v)));
  }

  // Only active categories may be assigned to a product; inactive ones are
  // retired reference data and stay visible only on Catalogue Setup.
  const activeCategoryOptions = useMemo(
    () => catalog.categories.filter((c) => c.is_active).map((c) => ({ id: c.id, label: c.name })),
    [catalog.categories],
  );

  const unitOptions = useMemo(
    () => catalog.units.map((u) => ({ id: u.id, label: `${u.name} (${u.code})` })),
    [catalog.units],
  );

  /**
   * Inline unit creation. `catalog.create_unit` needs a code as well as a
   * name; the inline shortcut collects one value, so the typed text is used
   * for both and the operator can refine the pair later on Catalogue Setup.
   */
  const handleCreateUnit = useCallback(
    (name: string) => catalog.createUnit(name, name),
    [catalog],
  );

  /**
   * WS-D-5 — create on the v2 write layer.
   *
   * `catalog.quick_create_product` creates the product and its first variant in
   * one authoritative call, carrying the product-level category and the
   * variant's barcode and minimum stock — none of which the old
   * `createProductWithVariants` path could express, which is why those fields
   * were unreachable from the UI before this task.
   *
   * Attributes are a deliberate second step: quick_create_product has no
   * attribute parameter, so any selected values are applied afterwards through
   * the existing `setVariantAttributes` path. That second call is not atomic
   * with the first, so a failure there is reported distinctly — the product
   * genuinely exists at that point, and telling the operator "creation failed"
   * would be a lie that leads to a duplicate.
   */
  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (creating || !productName.trim() || !productUnitId) return;

    const draft = variantForms[0];
    if (!isVariantFormValid(draft)) {
      setCreateError(t('errors.validation'));
      return;
    }

    setCreating(true);
    setCreateError(null);
    try {
      const created = await catalog.quickCreateProduct({
        name: productName.trim(),
        unitId: productUnitId,
        // Exact decimal strings, forwarded verbatim — never parsed or rounded.
        salePrice: draft.salePrice,
        minimumStock: draft.minimumStock,
        categoryId: productCategoryId,
        barcode: draft.barcode.trim() || null,
        isActive: draft.isActive,
      });

      const attrValueIds = Object.values(attrSelections[0] ?? {}).filter((id) => id > 0);
      if (attrValueIds.length > 0) {
        try {
          await catalog.setVariantAttributes(created.variant_id, attrValueIds);
        } catch (err) {
          // The product exists; only the attribute assignment failed. Say so
          // precisely and stop, rather than reporting a creation failure.
          setCreateError(`${t('catalog.createdButAttributesFailed')} ${errorText(err)}`);
          return;
        }
      }

      onCreated?.(created.product_id);
    } catch (err) {
      setCreateError(errorText(err));
    } finally {
      setCreating(false);
    }
  }

  // Live Effective Name preview calculation for draft variant
  function computeNewVariantPreview(idx: number): string {
    const sel = attrSelections[idx] ?? {};
    const selectedAttrValues: string[] = [];
    for (const attr of catalog.attributes) {
      const valId = sel[attr.attribute_id];
      if (valId) {
        const found = attr.attribute_values.find((v) => v.id === valId);
        if (found) selectedAttrValues.push(found.value);
      }
    }
    const baseName = productName.trim() || t('catalog.name');
    return selectedAttrValues.length > 0
      ? `${baseName} · ${selectedAttrValues.join(' · ')}`
      : baseName;
  }

    const canSubmit =
      productName.trim().length > 0 &&
      productUnitId !== null &&
      isVariantFormValid(variantForms[0]) &&
      !creating;

    return (
      <div className="sk-page" style={{ maxWidth: '1100px', marginInline: 'auto' }}>
        {/* Top Header Action Bar */}
        <div className="sk-toolbar" style={{ marginBlockEnd: '1.25rem' }}>
          <div>
            <h1 style={{ margin: 0 }}>{t('catalog.new')}</h1>
            <p style={{ margin: '0.2rem 0 0', color: 'var(--sk-muted)', fontSize: '0.88rem' }}>
              Create a product and its sellable variants.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <Button variant="secondary" onClick={onBack} disabled={creating}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              onClick={(e) => void handleCreate(e)}
              loading={creating}
              disabled={!canSubmit}
              data-testid="submit-create-product"
            >
              {t('catalog.createProduct')}
            </Button>
          </div>
        </div>

        {createError ? <Banner tone="error" testId="create-error">{createError}</Banner> : null}

        <form onSubmit={handleCreate} className="sk-form" data-testid="create-product-form">
          {/* PRODUCT DETAILS CARD */}
          <div className="sk-card">
            <h3 style={{ marginBlockEnd: '1rem', fontSize: '0.92rem', letterSpacing: '0.04em' }}>
              PRODUCT DETAILS
            </h3>
            <div className="sk-form__grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
              <TextField
                label={t('catalog.name')}
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                placeholder="e.g. Pillow"
                required
                disabled={creating}
              />

              <InlineCreateSelect
                id="create-product-category"
                label={t('productsList.category')}
                options={activeCategoryOptions}
                value={productCategoryId}
                onChange={setProductCategoryId}
                onCreate={catalog.createCategory}
                emptyLabel={t('common.none')}
                createLabel={t('catalogueSetup.categories.name')}
                newItemLabel={t('catalog.newShort')}
                disabled={creating}
                testId="create-product-category"
              />

              <InlineCreateSelect
                id="create-product-unit"
                label={t('catalog.unit')}
                options={unitOptions}
                value={productUnitId}
                onChange={setProductUnitId}
                onCreate={handleCreateUnit}
                createLabel={t('catalogueSetup.units.name')}
                newItemLabel={t('catalog.newShort')}
                disabled={creating}
                testId="create-product-unit"
              />

              <div className="sk-field">
                <span className="sk-field__label">{t('products.active')}</span>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', minHeight: 'var(--sk-touch)', cursor: 'pointer', fontWeight: 600 }}>
                  <input
                    type="checkbox"
                    checked={productActive}
                    onChange={(e) => setProductActive(e.target.checked)}
                    disabled={creating}
                  />
                  <span>{productActive ? t('catalog.active') : t('catalog.inactive')}</span>
                </label>
              </div>
            </div>
          </div>

          {/* FIRST VARIANT SECTION.
              WS-D-5: creation makes one product and its first variant via
              quick_create_product. Further variants are added afterwards from
              the edit screen, which is the only place add_variant lives. */}
          <div style={{ marginBlockStart: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBlockEnd: '0.75rem' }}>
              <h3 style={{ margin: 0, fontSize: '0.92rem', letterSpacing: '0.04em' }}>
                {t('variants.firstVariant')}
              </h3>
              <span style={{ fontSize: '0.8rem', color: 'var(--sk-muted)' }}>
                {t('variants.skuAutoGenerated')}
              </span>
            </div>

            <div className="sk-card" style={{ marginBlockEnd: '1rem', padding: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBlockEnd: '1rem', borderBlockEnd: '1px solid var(--sk-border)', paddingBlockEnd: '0.5rem' }}>
                <span className="sk-badge sk-badge--secondary" style={{ fontSize: '0.78rem' }}>
                  {computeNewVariantPreview(0)}
                </span>
              </div>

              <VariantForm
                values={variantForms[0]}
                onChange={(vals) => updateVariantForm(0, vals)}
                generatedNamePreview={computeNewVariantPreview(0)}
                disabled={creating}
                idPrefix="v0"
              />

              {/* Inline Attribute Selection. AttributeManager already provides
                  create-only inline shortcuts for attributes and their values,
                  matching the D-0 ruling applied to the pickers above. */}
              <div style={{ marginBlockStart: '1.25rem', paddingTop: '1rem', borderBlockStart: '1px solid var(--sk-border)' }}>
                <AttributeManager
                  attributes={catalog.attributes}
                  refLoading={catalog.refLoading}
                  selected={attrSelections[0] ?? {}}
                  onSelectionChange={(sel) =>
                    setAttrSelections((prev) => ({ ...prev, 0: sel }))
                  }
                  onCreateAttribute={catalog.createAttribute}
                  onAddValue={catalog.addAttributeValue}
                  busy={creating}
                />
              </div>
            </div>
          </div>

          {/* Bottom Action Footer */}
          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginBlockStart: '1rem' }}>
            <Button type="button" variant="secondary" onClick={onBack} disabled={creating}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" loading={creating} disabled={!canSubmit}>
              {t('catalog.createProduct')}
            </Button>
          </div>
        </form>
      </div>
    );
}

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
