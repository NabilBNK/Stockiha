/**
 * Slice 2 — create/edit a product and manage its variants, attributes, units, barcodes.
 */
import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { Banner, Button, Spinner, TextField } from '../../shared/components';
import { useI18n } from '../../shared/i18n';
import { useErrorText } from '../../shared/hooks/useErrorText';
import type { AttributeDefinition, VariantDetail, VariantInput } from '../../shared/ipc/dto';
import { VariantForm, isVariantFormValid } from './VariantForm';
import type { VariantFormValues } from './VariantForm';
import { AttributeManager } from './AttributeManager';
import { UnitManager } from './UnitManager';
import { BarcodeManager } from './BarcodeManager';
import { useCatalog } from './useCatalog';

const EMPTY_VARIANT: VariantFormValues = { sku: '', salePrice: '', isActive: true };

interface Props {
  token: string;
  /** When set, we are editing an existing product */
  productId?: number;
  onCreated?: (productId: number) => void;
  onBack: () => void;
}

export function ProductEditor({ token, productId, onCreated, onBack }: Props) {
  const { t } = useI18n();
  const errorText = useErrorText();
  const catalog = useCatalog(token);

  // Product-level fields
  const [productName, setProductName] = useState('');
  const [productActive, setProductActive] = useState(true);
  const [productError, setProductError] = useState<string | null>(null);
  const [productOk, setProductOk] = useState(false);
  const [savingProduct, setSavingProduct] = useState(false);

  // Variant creation (for new products, multiple variants can be added)
  const [variantForms, setVariantForms] = useState<VariantFormValues[]>([{ ...EMPTY_VARIANT }]);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // For editing: selected variant
  const [selectedVariantId, setSelectedVariantId] = useState<number | null>(null);
  const [savingVariant, setSavingVariant] = useState(false);
  const [variantError, setVariantError] = useState<string | null>(null);
  const [variantOk, setVariantOk] = useState(false);
  const [variantForm, setVariantForm] = useState<VariantFormValues>({ ...EMPTY_VARIANT });

  // Attribute selection (per-variant for create flow)
  const [attrSelections, setAttrSelections] = useState<Record<number, Record<number, number>>>({});

  const isEdit = productId != null;

  const selectedVariant = isEdit
    ? (catalog.detail?.variants.find((v) => v.variant_id === selectedVariantId) ?? null)
    : null;

  // Load data for edit mode
  useEffect(() => {
    if (isEdit && productId != null) {
      void catalog.loadDetail(productId);
      void catalog.loadRefData();
    } else if (!isEdit) {
      void catalog.loadRefData();
    }
  }, [productId]);

  // Populate product form when detail loads
  useEffect(() => {
    if (catalog.detail) {
      setProductName(catalog.detail.name);
      setProductActive(catalog.detail.is_active);
      if (catalog.detail.variants.length > 0) {
        const v = catalog.detail.variants[0];
        setSelectedVariantId(v.variant_id);
        setVariantForm({ sku: v.sku, salePrice: v.sale_price, isActive: v.is_active });
      }
    }
  }, [catalog.detail]);

  // When selected variant changes, populate variant form
  useEffect(() => {
    if (selectedVariant) {
      setVariantForm({ sku: selectedVariant.sku, salePrice: selectedVariant.sale_price, isActive: selectedVariant.is_active });
      setVariantError(null);
      setVariantOk(false);
    }
  }, [selectedVariant]);

  function addVariantForm() {
    setVariantForms((prev) => [...prev, { ...EMPTY_VARIANT }]);
  }

  function updateVariantForm(index: number, values: VariantFormValues) {
    setVariantForms((prev) => prev.map((v, i) => (i === index ? values : v)));
  }

  function removeVariantForm(index: number) {
    setVariantForms((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (creating || !productName.trim()) return;
    for (const vf of variantForms) {
      if (!isVariantFormValid(vf)) {
        setCreateError(t('errors.validation'));
        return;
      }
    }
    setCreating(true);
    setCreateError(null);
    try {
      const variants: VariantInput[] = variantForms.map((vf, idx) => {
        const sel = attrSelections[idx] ?? {};
        const attrValueIds = Object.values(sel).filter((id) => id > 0);
        return {
          sku: vf.sku.trim(),
          sale_price: vf.salePrice,
          is_active: vf.isActive,
          ...(attrValueIds.length > 0 ? { attribute_value_ids: attrValueIds } : {}),
        };
      });
      const result = await catalog.createProductWithVariants(productName.trim(), productActive, variants);
      onCreated?.(result.product_id);
    } catch (err) {
      setCreateError(errorText(err));
    } finally {
      setCreating(false);
    }
  }

  async function handleSaveProduct(e: FormEvent) {
    e.preventDefault();
    if (savingProduct || !productId || !productName.trim()) return;
    setSavingProduct(true);
    setProductError(null);
    setProductOk(false);
    try {
      await catalog.updateProduct(productId, productName.trim(), productActive);
      setProductOk(true);
    } catch (err) {
      setProductError(errorText(err));
    } finally {
      setSavingProduct(false);
    }
  }

  async function handleSaveVariant(e: FormEvent) {
    e.preventDefault();
    if (savingVariant || !selectedVariantId || !isVariantFormValid(variantForm)) {
      setVariantError(t('errors.validation'));
      return;
    }
    setSavingVariant(true);
    setVariantError(null);
    setVariantOk(false);
    try {
      await catalog.updateVariant(selectedVariantId, variantForm.sku.trim(), variantForm.salePrice, variantForm.isActive);
      setVariantOk(true);
      await catalog.loadDetail(productId!);
    } catch (err) {
      setVariantError(errorText(err));
    } finally {
      setSavingVariant(false);
    }
  }

  async function handleToggleVariantActive(v: VariantDetail) {
    try {
      await catalog.setVariantActive(v.variant_id, !v.is_active);
      await catalog.loadDetail(productId!);
    } catch (err) {
      setVariantError(errorText(err));
    }
  }

  async function handleAddVariant(e: FormEvent) {
    e.preventDefault();
    if (creating || !productId || !isVariantFormValid(variantForm)) {
      setVariantError(t('errors.validation'));
      return;
    }
    setCreating(true);
    setVariantError(null);
    setVariantOk(false);
    try {
      const variantInput: VariantInput = {
        sku: variantForm.sku.trim(),
        sale_price: variantForm.salePrice,
        is_active: variantForm.isActive,
      };
      const newId = await catalog.addVariant(productId, variantInput);
      setSelectedVariantId(newId);
      setVariantForm({ ...EMPTY_VARIANT });
      setVariantOk(true);
      await catalog.loadDetail(productId);
    } catch (err) {
      setVariantError(errorText(err));
    } finally {
      setCreating(false);
    }
  }

  const handleSetAttributes = useCallback(async (sel: Record<number, number>) => {
    if (!selectedVariantId) return;
    const ids = Object.values(sel).filter((id) => id > 0);
    await catalog.setVariantAttributes(selectedVariantId, ids);
    await catalog.loadDetail(productId!);
  }, [catalog, selectedVariantId, productId]);

  // Barcode handlers for selected variant
  const handleAddBarcode = useCallback(async (barcode: string) => {
    if (!selectedVariantId) return;
    await catalog.addVariantBarcode(selectedVariantId, barcode);
    await catalog.loadDetail(productId!);
  }, [catalog, selectedVariantId, productId]);

  const handleRemoveBarcode = useCallback(async (barcodeId: number) => {
    await catalog.removeVariantBarcode(barcodeId);
    await catalog.loadDetail(productId!);
  }, [catalog, productId]);

  // Unit handlers for selected variant
  const handleSetBase = useCallback(async (unitId: number) => {
    if (!selectedVariantId) return;
    await catalog.setVariantBaseUnit(selectedVariantId, unitId);
    await catalog.loadDetail(productId!);
  }, [catalog, selectedVariantId, productId]);

  const handleAddAlt = useCallback(async (unitId: number, factor: string) => {
    if (!selectedVariantId) return;
    await catalog.addVariantAltUnit(selectedVariantId, unitId, factor);
    await catalog.loadDetail(productId!);
  }, [catalog, selectedVariantId, productId]);

  const handleRemoveAlt = useCallback(async (variantUnitId: number) => {
    await catalog.removeVariantAltUnit(variantUnitId);
    await catalog.loadDetail(productId!);
  }, [catalog, productId]);

  // --- Create mode ---
  if (!isEdit) {
    return (
      <section className="sk-page">
        <Button variant="secondary" onClick={onBack}>{t('catalog.backToList')}</Button>
        <h1>{t('catalog.new')}</h1>

        <form className="sk-card sk-form" onSubmit={handleCreate} aria-label={t('catalog.new')} data-testid="create-product-form">
          {createError ? <Banner tone="error" testId="create-error">{createError}</Banner> : null}
          <div className="sk-form__grid">
            <TextField
              label={t('catalog.name')}
              value={productName}
              onChange={(e) => setProductName(e.target.value)}
              required
              disabled={creating}
            />
            <label className="sk-field__label">
              <input
                type="checkbox"
                checked={productActive}
                onChange={(e) => setProductActive(e.target.checked)}
                disabled={creating}
              />
              {' '}{t('catalog.active')}
            </label>
          </div>

          <h2>{t('variants.title')}</h2>

          {variantForms.map((vf, idx) => (
            <div key={idx} className="sk-card" style={{ marginBlockStart: '0.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong>{t('variants.title')} {idx + 1}</strong>
                {variantForms.length > 1 ? (
                  <Button variant="danger" type="button" onClick={() => removeVariantForm(idx)} disabled={creating}>
                    {t('common.cancel')}
                  </Button>
                ) : null}
              </div>
              <VariantForm
                values={vf}
                onChange={(vals) => updateVariantForm(idx, vals)}
                disabled={creating}
                idPrefix={`v${idx}`}
              />
              {/* Attribute selection per variant */}
              {catalog.attributes.length > 0 ? (
                <AttributeManager
                  attributes={catalog.attributes}
                  refLoading={catalog.refLoading}
                  selected={attrSelections[idx] ?? {}}
                  onSelectionChange={(sel) => setAttrSelections((prev) => ({ ...prev, [idx]: sel }))}
                  onCreateAttribute={catalog.createAttribute}
                  onAddValue={catalog.addAttributeValue}
                  busy={creating}
                />
              ) : null}
            </div>
          ))}

          <Button type="button" variant="secondary" onClick={addVariantForm} disabled={creating}>
            {t('variants.add')}
          </Button>

          <Button type="submit" loading={creating} disabled={!productName.trim() || variantForms.some((vf) => !isVariantFormValid(vf))}>
            {t('common.create')}
          </Button>
        </form>
      </section>
    );
  }

  // --- Edit mode ---
  if (catalog.detailLoading) return <Spinner />;
  if (catalog.detailError) return <Banner tone="error">{catalog.detailError}</Banner>;
  if (!catalog.detail) return null;

  return (
    <section className="sk-page">
      <Button variant="secondary" onClick={onBack}>{t('catalog.backToList')}</Button>
      <h1>{t('catalog.edit')}: {catalog.detail.name}</h1>

      {/* Product metadata form */}
      <form className="sk-card sk-form" onSubmit={handleSaveProduct} aria-label={t('catalog.edit')}>
        {productError ? <Banner tone="error">{productError}</Banner> : null}
        {productOk ? <Banner tone="success">{t('catalog.saved')}</Banner> : null}
        <div className="sk-form__grid">
          <TextField
            label={t('catalog.name')}
            value={productName}
            onChange={(e) => setProductName(e.target.value)}
            required
            disabled={savingProduct}
          />
          <label className="sk-field__label">
            <input
              type="checkbox"
              checked={productActive}
              onChange={(e) => setProductActive(e.target.checked)}
              disabled={savingProduct}
            />
            {' '}{t('catalog.active')}
          </label>
        </div>
        <Button type="submit" loading={savingProduct} disabled={!productName.trim()}>
          {t('catalog.save')}
        </Button>
      </form>

      {/* Variant list */}
      <div className="sk-card" style={{ marginBlockStart: '1rem' }}>
        <h2>{t('variants.title')}</h2>
        {catalog.detail.variants.length === 0 ? (
          <Banner tone="info">{t('variants.empty')}</Banner>
        ) : (
          <table className="sk-table" data-testid="variants-table">
            <thead>
              <tr>
                <th>{t('variants.sku')}</th>
                <th className="sk-num">{t('variants.price')}</th>
                <th>{t('variants.active')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {catalog.detail.variants.map((v) => (
                <tr
                  key={v.variant_id}
                  style={{ cursor: 'pointer', background: selectedVariantId === v.variant_id ? 'var(--sk-accent-light, #e8f0fe)' : undefined }}
                  onClick={() => setSelectedVariantId(v.variant_id)}
                  data-testid={`variant-row-${v.variant_id}`}
                >
                  <td>{v.sku}</td>
                  <td className="sk-num">{v.sale_price}</td>
                  <td>{v.is_active ? t('catalog.active') : t('catalog.inactive')}</td>
                  <td>
                    <Button
                      variant={v.is_active ? 'danger' : 'secondary'}
                      onClick={(e) => { e.stopPropagation(); void handleToggleVariantActive(v); }}
                      data-testid={`toggle-variant-${v.variant_id}`}
                    >
                      {v.is_active ? t('variants.deactivate') : t('variants.activate')}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Add new variant */}
      <details className="sk-card" style={{ marginBlockStart: '1rem' }}>
        <summary style={{ cursor: 'pointer', padding: '0.5rem' }}>{t('variants.add')}</summary>
        <form className="sk-form" onSubmit={handleAddVariant} aria-label={t('variants.add')}>
          {variantError && !selectedVariantId ? <Banner tone="error">{variantError}</Banner> : null}
          <VariantForm values={variantForm} onChange={setVariantForm} disabled={creating} />
          <Button type="submit" loading={creating} disabled={!isVariantFormValid(variantForm)}>
            {t('variants.add')}
          </Button>
        </form>
      </details>

      {/* Selected variant editor */}
      {selectedVariant ? (
        <div className="sk-card" style={{ marginBlockStart: '1rem' }}>
          <h2>{t('variants.title')}: {selectedVariant.sku}</h2>

          {/* Edit core fields */}
          <form className="sk-form" onSubmit={handleSaveVariant} aria-label={`${t('variants.title')} ${selectedVariant.sku}`}>
            {variantError ? <Banner tone="error" testId="variant-error">{variantError}</Banner> : null}
            {variantOk ? <Banner tone="success">{t('variants.saved')}</Banner> : null}
            <VariantForm values={variantForm} onChange={setVariantForm} disabled={savingVariant} />
            <Button type="submit" loading={savingVariant} disabled={!isVariantFormValid(variantForm)}>
              {t('catalog.save')}
            </Button>
          </form>

          {/* Attributes */}
          <div style={{ marginBlockStart: '1rem' }}>
            <AttributeManagerForVariant
              attributes={catalog.attributes}
              refLoading={catalog.refLoading}
              variant={selectedVariant}
              onSetAttributes={handleSetAttributes}
              onCreateAttribute={catalog.createAttribute}
              onAddValue={catalog.addAttributeValue}
            />
          </div>

          {/* Units */}
          <div style={{ marginBlockStart: '1rem' }}>
            <UnitManager
              units={catalog.units}
              baseUnitId={selectedVariant.base_unit_id}
              altUnits={selectedVariant.alternate_units}
              onSetBase={handleSetBase}
              onCreateUnit={catalog.createUnit}
              onAddAlt={handleAddAlt}
              onRemoveAlt={handleRemoveAlt}
            />
          </div>

          {/* Barcodes */}
          <div style={{ marginBlockStart: '1rem' }}>
            <BarcodeManager
              barcodes={selectedVariant.barcodes}
              onAdd={handleAddBarcode}
              onRemove={handleRemoveBarcode}
            />
          </div>
        </div>
      ) : null}
    </section>
  );
}

/** Attribute manager wired to a specific variant's current attribute selections */
function AttributeManagerForVariant({
  attributes, refLoading, variant, onSetAttributes, onCreateAttribute, onAddValue,
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
        attributes={attributes}
        refLoading={refLoading}
        selected={selected}
        onSelectionChange={setSelected}
        onCreateAttribute={onCreateAttribute}
        onAddValue={onAddValue}
        busy={saving}
      />
      <Button onClick={() => void handleAssign()} loading={saving} disabled={saving}>
        {t('attrs.assign')}
      </Button>
    </div>
  );
}

