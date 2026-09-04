/**
 * Slice 2 — Product Creation & Editing UI/UX Overhaul.
 * Implements authoritative Stockiha Product Architecture:
 * 1. Product owns Product Name, Unit (`unit_id`), and Active state.
 * 2. Variant fields: Name override (optional), Barcode (scanner-friendly), Sale Price (DZD), Attributes, Active status.
 * 3. Automatic SKU generation (never user-entered).
 * 4. Scanner-friendly text barcodes (preserves leading zeroes).
 * 5. Compact horizontal desktop layout & theme-semantic Dark Mode contrast.
 * 6. Inline Attribute & Value creation popovers/modals (no navigation away).
 * 7. Live Effective Variant Name preview badge.
 */
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';

import { Banner, Button, Spinner, TextField } from '../../shared/components';
import { useI18n } from '../../shared/i18n';
import { useErrorText } from '../../shared/hooks/useErrorText';
import type { AttributeDefinition, VariantDetail, VariantInput } from '../../shared/ipc/dto';
import { VariantForm, isVariantFormValid, type VariantFormValues } from './VariantForm';
import { AttributeManager } from './AttributeManager';
import { BarcodeManager } from './BarcodeManager';
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
  /** When set, we are editing an existing product */
  productId?: number;
  onCreated?: (productId: number) => void;
  onBack: () => void;
}

export function ProductEditor({ token, productId, onCreated, onBack }: Props) {
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
  const [productError, setProductError] = useState<string | null>(null);
  const [productOk, setProductOk] = useState(false);
  const [savingProduct, setSavingProduct] = useState(false);

  // Variant creation state (Create Flow)
  const [variantForms, setVariantForms] = useState<VariantFormValues[]>([{ ...EMPTY_VARIANT }]);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Edit flow: Selected variant modal/drawer state
  const [selectedVariantId, setSelectedVariantId] = useState<number | null>(null);
  const [isEditingVariantModal, setIsEditingVariantModal] = useState(false);
  const [savingVariant, setSavingVariant] = useState(false);
  const [editVariantError, setEditVariantError] = useState<string | null>(null);
  const [editVariantOk, setEditVariantOk] = useState(false);
  const [editVariantForm, setEditVariantForm] = useState<VariantFormValues>({ ...EMPTY_VARIANT });

  // Add new variant draft (Edit Flow)
  const [isAddingVariantModal, setIsAddingVariantModal] = useState(false);
  const [addVariantDraft, setAddVariantDraft] = useState<VariantFormValues>({ ...EMPTY_VARIANT });
  const [addVariantError, setAddVariantError] = useState<string | null>(null);

  // Attribute selection (per-variant index for create flow)
  const [attrSelections, setAttrSelections] = useState<Record<number, Record<number, number>>>({});

  const isEdit = productId != null;

  const selectedVariant = isEdit
    ? (catalog.detail?.variants.find((v) => v.variant_id === selectedVariantId) ?? null)
    : null;

  // Load ref data and product details on mount / id change
  useEffect(() => {
    if (isEdit && productId != null) {
      void catalog.loadDetail(productId);
      void catalog.loadRefData();
    } else {
      void catalog.loadRefData();
    }
  }, [productId, isEdit]);

  // Default unit initialization
  useEffect(() => {
    if (!productUnitId && catalog.units.length > 0) {
      setProductUnitId(catalog.units[0].id);
    }
  }, [catalog.units, productUnitId]);

  // Populate product form on detail load
  useEffect(() => {
    if (catalog.detail) {
      setProductName(catalog.detail.name);
      setProductUnitId(catalog.detail.unit_id);
      // WS-D-5B: seed the category from the loaded detail. update_product
      // overwrites category_id unconditionally, so this round-trip is what
      // stops an untouched save from clearing it.
      setProductCategoryId(catalog.detail.category_id);
      setProductActive(catalog.detail.is_active);
      if (catalog.detail.variants.length > 0 && !selectedVariantId) {
        const v = catalog.detail.variants[0];
        setSelectedVariantId(v.variant_id);
      }
    }
  }, [catalog.detail, selectedVariantId]);

  // Update edit variant form when selected variant changes
  useEffect(() => {
    if (selectedVariant) {
      setEditVariantForm({
        nameOverride: selectedVariant.name_override ?? '',
        barcode: selectedVariant.primary_barcode ?? '',
        salePrice: selectedVariant.sale_price,
        // WS-D-5B: seeded verbatim from get_product_detail as an exact decimal
        // string. update_variant overwrites minimum_stock unconditionally, so
        // sending back exactly what was loaded is what preserves it through a
        // save that did not touch the field.
        minimumStock: selectedVariant.minimum_stock,
        isActive: selectedVariant.is_active,
      });
      setEditVariantError(null);
      setEditVariantOk(false);
    }
  }, [selectedVariant]);

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

  async function handleSaveProduct(e: FormEvent) {
    e.preventDefault();
    if (savingProduct || !productId || !productName.trim() || !productUnitId) return;
    setSavingProduct(true);
    setProductError(null);
    setProductOk(false);
    try {
      // WS-D-5B: the 6-arg update_product overload, carrying the category.
      // productCategoryId was seeded from get_product_detail on load, so an
      // untouched save re-sends the product's current category rather than
      // clearing it.
      await catalog.updateProductV2(
        productId,
        productName.trim(),
        productUnitId,
        productActive,
        productCategoryId,
      );
      setProductOk(true);
      await catalog.loadDetail(productId);
    } catch (err) {
      setProductError(errorText(err));
    } finally {
      setSavingProduct(false);
    }
  }

  async function handleSaveVariant(e: FormEvent) {
    e.preventDefault();
    if (savingVariant || !selectedVariantId || !isVariantFormValid(editVariantForm)) {
      setEditVariantError(t('errors.validation'));
      return;
    }
    setSavingVariant(true);
    setEditVariantError(null);
    setEditVariantOk(false);
    try {
      // WS-D-5B: the 6-arg update_variant overload, carrying minimum_stock.
      // editVariantForm.minimumStock was seeded verbatim from
      // get_product_detail, so an untouched save round-trips the variant's
      // current value instead of resetting it to 0.
      await catalog.updateVariantV2(
        selectedVariantId,
        editVariantForm.nameOverride.trim() || null,
        editVariantForm.salePrice,
        editVariantForm.isActive,
        editVariantForm.minimumStock,
      );
      setEditVariantOk(true);
      await catalog.loadDetail(productId!);
    } catch (err) {
      setEditVariantError(errorText(err));
    } finally {
      setSavingVariant(false);
    }
  }

  async function handleToggleVariantActive(v: VariantDetail) {
    try {
      await catalog.setVariantActive(v.variant_id, !v.is_active);
      await catalog.loadDetail(productId!);
    } catch (err) {
      setProductError(errorText(err));
    }
  }

  async function handleAddVariant(e: FormEvent) {
    e.preventDefault();
    if (creating || !productId || !isVariantFormValid(addVariantDraft)) {
      setAddVariantError(t('errors.validation'));
      return;
    }
    setCreating(true);
    setAddVariantError(null);
    try {
      const variantInput: VariantInput = {
        name_override: addVariantDraft.nameOverride.trim() || undefined,
        sale_price: addVariantDraft.salePrice,
        is_active: addVariantDraft.isActive,
        ...(addVariantDraft.barcode.trim() ? { barcodes: [addVariantDraft.barcode.trim()] } : {}),
      };
      const newId = await catalog.addVariant(productId, variantInput);

      // WS-D-5: `VariantInput` has no minimum_stock field, so add_variant
      // cannot carry it. Rather than render a control whose value is silently
      // discarded, apply it immediately through the 6-arg update_variant
      // overload. This is safe precisely because the variant is brand new —
      // every value written here is one the operator just typed, so nothing
      // pre-existing can be overwritten.
      await catalog.updateVariantV2(
        newId,
        addVariantDraft.nameOverride.trim() || null,
        addVariantDraft.salePrice,
        addVariantDraft.isActive,
        addVariantDraft.minimumStock,
      );

      setSelectedVariantId(newId);
      setAddVariantDraft({ ...EMPTY_VARIANT });
      setIsAddingVariantModal(false);
      await catalog.loadDetail(productId);
    } catch (err) {
      setAddVariantError(errorText(err));
    } finally {
      setCreating(false);
    }
  }

  const handleSetAttributes = useCallback(
    async (sel: Record<number, number>) => {
      if (!selectedVariantId || !productId) return;
      const ids = Object.values(sel).filter((id) => id > 0);
      await catalog.setVariantAttributes(selectedVariantId, ids);
      await catalog.loadDetail(productId);
    },
    [catalog, selectedVariantId, productId],
  );

  const handleAddBarcode = useCallback(
    async (barcode: string) => {
      if (!selectedVariantId || !productId) return;
      await catalog.addVariantBarcode(selectedVariantId, barcode);
      await catalog.loadDetail(productId);
    },
    [catalog, selectedVariantId, productId],
  );

  const handleRemoveBarcode = useCallback(
    async (barcodeId: number) => {
      if (!productId) return;
      await catalog.removeVariantBarcode(barcodeId);
      await catalog.loadDetail(productId);
    },
    [catalog, productId],
  );

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

  // --- CREATE MODE ---
  if (!isEdit) {
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

  // --- EDIT MODE ---
  if (catalog.detailLoading) return <Spinner />;
  if (catalog.detailError) return <Banner tone="error">{catalog.detailError}</Banner>;
  if (!catalog.detail) return null;

  return (
    <div className="sk-page" style={{ maxWidth: '1100px', marginInline: 'auto' }}>
      {/* Header Action Bar */}
      <div className="sk-toolbar" style={{ marginBlockEnd: '1.25rem' }}>
        <div>
          <h1 style={{ margin: 0 }}>
            {t('catalog.edit')}: {catalog.detail.name}
          </h1>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <Button variant="secondary" onClick={onBack}>
            {t('catalog.backToList')}
          </Button>
          <Button variant="primary" onClick={(e) => void handleSaveProduct(e)} loading={savingProduct}>
            {t('catalog.save')}
          </Button>
        </div>
      </div>

      {productError ? <Banner tone="error">{productError}</Banner> : null}
      {productOk ? <Banner tone="success">{t('catalog.saved')}</Banner> : null}

      {/* Product Metadata Form */}
      <form className="sk-card sk-form" onSubmit={handleSaveProduct} aria-label={t('catalog.edit')}>
        <h3 style={{ margin: 0, fontSize: '0.92rem', letterSpacing: '0.04em' }}>PRODUCT DETAILS</h3>
        <div className="sk-form__grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          <TextField
            label={t('catalog.name')}
            value={productName}
            onChange={(e) => setProductName(e.target.value)}
            required
            disabled={savingProduct}
          />

          {/* WS-D-5B: category is editable here now that get_product_detail
              returns category_id to seed it. Same create-only inline shortcut
              as the create form (D-0 ruling). */}
          <InlineCreateSelect
            id="edit-product-category"
            label={t('productsList.category')}
            options={activeCategoryOptions}
            value={productCategoryId}
            onChange={setProductCategoryId}
            onCreate={catalog.createCategory}
            emptyLabel={t('common.none')}
            createLabel={t('catalogueSetup.categories.name')}
            newItemLabel={t('catalog.newShort')}
            disabled={savingProduct}
            testId="edit-product-category"
          />

          <InlineCreateSelect
            id="edit-product-unit"
            label={t('catalog.unit')}
            options={unitOptions}
            value={productUnitId}
            onChange={setProductUnitId}
            onCreate={handleCreateUnit}
            createLabel={t('catalogueSetup.units.name')}
            newItemLabel={t('catalog.newShort')}
            disabled={savingProduct}
            testId="edit-product-unit"
          />

          <div className="sk-field">
            <span className="sk-field__label">{t('products.active')}</span>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', minHeight: 'var(--sk-touch)', cursor: 'pointer', fontWeight: 600 }}>
              <input
                type="checkbox"
                checked={productActive}
                onChange={(e) => setProductActive(e.target.checked)}
                disabled={savingProduct}
              />
              <span>{productActive ? t('catalog.active') : t('catalog.inactive')}</span>
            </label>
          </div>
        </div>
      </form>

      {/* Variants Summary Table */}
      <div className="sk-card" style={{ marginBlockStart: '1.25rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBlockEnd: '1rem' }}>
          <h3 style={{ margin: 0 }}>{t('variants.title')}</h3>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setAddVariantDraft({ ...EMPTY_VARIANT });
              setIsAddingVariantModal(true);
            }}
          >
            + {t('variants.add')}
          </Button>
        </div>

        {catalog.detail.variants.length === 0 ? (
          <Banner tone="info">{t('variants.empty')}</Banner>
        ) : (
          <div className="sk-table-wrap">
            <table className="sk-table" data-testid="variants-table">
              <thead>
                <tr>
                  <th>{t('variants.identifier')}</th>
                  <th>{t('variants.name')}</th>
                  <th>{t('attrs.title')}</th>
                  <th className="sk-num">{t('variants.price')}</th>
                  <th>{t('variants.active')}</th>
                  <th style={{ textAlign: 'end' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {catalog.detail.variants.map((v) => {
                  const attrStr =
                    v.attributes.map((a) => `${a.attribute_name}: ${a.value}`).join(', ') || '—';
                  const isSelected = selectedVariantId === v.variant_id;
                  return (
                    <tr
                      key={v.variant_id}
                      style={{
                        background: isSelected ? 'var(--sk-surface-hover)' : undefined,
                      }}
                      data-testid={`variant-row-${v.variant_id}`}
                    >
                      <td>
                        <code>{v.operational_identifier}</code>
                      </td>
                      <td>
                        <strong>{v.effective_variant_name}</strong>
                      </td>
                      <td>{attrStr}</td>
                      <td className="sk-num">{v.sale_price} DZD</td>
                      <td>
                        <span
                          className={`sk-badge ${v.is_active ? 'sk-badge--ok' : 'sk-badge--secondary'}`}
                        >
                          {v.is_active ? t('catalog.active') : t('catalog.inactive')}
                        </span>
                      </td>
                      <td style={{ textAlign: 'end' }}>
                        <div style={{ display: 'inline-flex', gap: '0.4rem' }}>
                          <Button
                            variant="secondary"
                            onClick={() => {
                              setSelectedVariantId(v.variant_id);
                              setIsEditingVariantModal(true);
                            }}
                            style={{ height: '32px', padding: '0 10px', fontSize: '0.8rem' }}
                            data-testid={`edit-variant-${v.variant_id}`}
                          >
                            Edit
                          </Button>
                          <Button
                            variant={v.is_active ? 'secondary' : 'primary'}
                            onClick={() => void handleToggleVariantActive(v)}
                            style={{ height: '32px', padding: '0 10px', fontSize: '0.8rem' }}
                            data-testid={`toggle-variant-${v.variant_id}`}
                          >
                            {v.is_active ? t('variants.deactivate') : t('variants.activate')}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* MODAL: Add Variant */}
      {isAddingVariantModal ? (
        <div className="sk-modal__backdrop" role="presentation" onClick={() => setIsAddingVariantModal(false)}>
          <div
            className="sk-modal"
            role="dialog"
            aria-modal="true"
            aria-label={t('variants.add')}
            onClick={(e) => e.stopPropagation()}
            style={{ width: 'min(100%, 600px)' }}
          >
            <h2 className="sk-modal__title">{t('variants.add')}</h2>
            {addVariantError ? <Banner tone="error">{addVariantError}</Banner> : null}
            <form onSubmit={handleAddVariant} className="sk-form">
              <VariantForm
                values={addVariantDraft}
                onChange={setAddVariantDraft}
                disabled={creating}
                idPrefix="modal-add"
              />
              <div className="sk-modal__actions" style={{ marginBlockStart: '1rem' }}>
                <Button variant="secondary" type="button" onClick={() => setIsAddingVariantModal(false)} disabled={creating}>
                  {t('common.cancel')}
                </Button>
                <Button type="submit" loading={creating} disabled={!isVariantFormValid(addVariantDraft)}>
                  {t('variants.add')}
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* MODAL: Edit Variant (selected variant details, attributes, barcodes) */}
      {isEditingVariantModal && selectedVariant ? (
        <div className="sk-modal__backdrop" role="presentation" onClick={() => setIsEditingVariantModal(false)}>
          <div
            className="sk-modal"
            role="dialog"
            aria-modal="true"
            aria-label={`Edit ${selectedVariant.effective_variant_name}`}
            onClick={(e) => e.stopPropagation()}
            style={{ width: 'min(100%, 650px)' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBlockEnd: '1rem' }}>
              <h2 className="sk-modal__title" style={{ margin: 0 }}>
                {selectedVariant.effective_variant_name}
              </h2>
              <span className="sk-badge sk-badge--secondary">
                {selectedVariant.operational_identifier} ({selectedVariant.identifier_type})
              </span>
            </div>

            {editVariantError ? <Banner tone="error">{editVariantError}</Banner> : null}
            {editVariantOk ? <Banner tone="success">{t('variants.saved')}</Banner> : null}

            <form onSubmit={handleSaveVariant} className="sk-form">
              {/* WS-D-5B: minimum stock is now populated from
                  get_product_detail and written through the 6-arg
                  update_variant overload, so the field is offered here. */}
              <VariantForm
                values={editVariantForm}
                onChange={setEditVariantForm}
                disabled={savingVariant}
                idPrefix={`modal-edit-${selectedVariant.variant_id}`}
              />

              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBlockStart: '0.75rem' }}>
                <Button type="submit" loading={savingVariant} disabled={!isVariantFormValid(editVariantForm)}>
                  {t('catalog.save')}
                </Button>
              </div>
            </form>

            <hr style={{ border: 0, borderTop: '1px solid var(--sk-border)', marginBlock: '1.25rem' }} />

            {/* Attributes Assignment */}
            <div style={{ marginBlockEnd: '1.25rem' }}>
              <AttributeManagerForVariant
                attributes={catalog.attributes}
                refLoading={catalog.refLoading}
                variant={selectedVariant}
                onSetAttributes={handleSetAttributes}
                onCreateAttribute={catalog.createAttribute}
                onAddValue={catalog.addAttributeValue}
              />
            </div>

            <hr style={{ border: 0, borderTop: '1px solid var(--sk-border)', marginBlock: '1.25rem' }} />

            {/* Barcode Manager */}
            <div>
              <BarcodeManager
                barcodes={selectedVariant.barcodes}
                onAdd={handleAddBarcode}
                onRemove={handleRemoveBarcode}
              />
            </div>

            <div className="sk-modal__actions" style={{ marginBlockStart: '1.5rem' }}>
              <Button variant="secondary" onClick={() => setIsEditingVariantModal(false)}>
                {t('common.close')}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
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

/** Attribute manager helper wired to a specific variant's selections */
function AttributeManagerForVariant({
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
