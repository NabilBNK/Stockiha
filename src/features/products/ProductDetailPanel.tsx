/**
 * WS-D-8a — the detail half of the products master–detail workspace.
 *
 * RULING 1: this panel never navigates. It renders beside the list, which
 * keeps its scroll position, filters and paging.
 * RULING 2: no save button. Product-level fields commit on blur (text) or on
 * change (selects), one backend call per field.
 * RULING 3: deactivating the product is structural — explicit and confirmed.
 * RULING 4: variants are inline expandable rows, never modals.
 *
 * THE OVERWRITE TRAP. catalog.update_product assigns name, unit_id, is_active
 * and category_id unconditionally. Every commit here therefore sends the
 * CURRENT server value of the three columns it is not changing, read from the
 * freshest ProductDetail snapshot. WS-D-5B exists solely because this was
 * previously unhandled.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';

import { Banner, Button, ConfirmDialog, Spinner } from '../../shared/components';
import { useI18n } from '../../shared/i18n';
import { useErrorText } from '../../shared/hooks/useErrorText';
import type { VariantInput } from '../../shared/ipc/dto';
import { AutosaveSelectField, AutosaveTextField } from './AutosaveFields';
import { VariantForm, isVariantFormValid, type VariantFormValues } from './VariantForm';
import { VariantRow } from './VariantRow';
import { useCatalog } from './useCatalog';
import { useAutosaveField } from './useAutosaveField';

const EMPTY_VARIANT: VariantFormValues = {
  nameOverride: '',
  barcode: '',
  salePrice: '',
  minimumStock: '0',
  isActive: true,
};

interface ProductPatch {
  name?: string;
  unitId?: number;
  isActive?: boolean;
  categoryId?: number | null;
}

export function ProductDetailPanel({
  token,
  productId,
  onBack,
  showBack,
}: {
  token: string;
  productId: number;
  onBack: () => void;
  /** Narrow viewports collapse to a single pane, so the back control appears. */
  showBack: boolean;
}) {
  const { t } = useI18n();
  const errorText = useErrorText();
  const catalog = useCatalog(token);

  const [expandedVariantId, setExpandedVariantId] = useState<number | null>(null);
  const [addingVariant, setAddingVariant] = useState(false);
  const [addDraft, setAddDraft] = useState<VariantFormValues>({ ...EMPTY_VARIANT });
  const [addError, setAddError] = useState<string | null>(null);
  const [addBusy, setAddBusy] = useState(false);
  const [confirmDeactivateProduct, setConfirmDeactivateProduct] = useState(false);
  const [productActionBusy, setProductActionBusy] = useState(false);
  const [productActionError, setProductActionError] = useState<string | null>(null);

  useEffect(() => {
    setExpandedVariantId(null);
    setAddingVariant(false);
    setAddDraft({ ...EMPTY_VARIANT });
    setAddError(null);
    void catalog.loadDetail(productId);
    void catalog.loadRefData();
  }, [productId, catalog.loadDetail, catalog.loadRefData]);

  const detail = catalog.detail;

  // Freshest server snapshot at execution time, and one serialised commit
  // queue so an in-flight refresh cannot make a later commit send a stale
  // sibling column.
  const detailRef = useRef(detail);
  detailRef.current = detail;
  const chain = useRef<Promise<void>>(Promise.resolve());

  const commitProduct = useCallback(
    (patch: ProductPatch) => {
      const run = chain.current.catch(() => {}).then(async () => {
        const d = detailRef.current;
        if (!d) return;
        await catalog.updateProductV2(
          d.product_id,
          patch.name !== undefined ? patch.name : d.name,
          patch.unitId !== undefined ? patch.unitId : d.unit_id,
          patch.isActive !== undefined ? patch.isActive : d.is_active,
          patch.categoryId !== undefined ? patch.categoryId : d.category_id,
        );
        await catalog.refreshDetail(d.product_id);
      });
      chain.current = run.catch(() => {});
      return run;
    },
    [catalog],
  );

  const nameField = useAutosaveField({
    serverValue: detail?.name ?? '',
    label: t('catalog.name'),
    normalize: (v) => v.trim(),
    validate: (v) => (v.length > 0 ? null : t('common.required')),
    commit: (v) => commitProduct({ name: v }),
  });

  const categoryField = useAutosaveField({
    serverValue: detail?.category_id != null ? String(detail.category_id) : '',
    label: t('productsList.category'),
    commit: (v) => commitProduct({ categoryId: v === '' ? null : Number(v) }),
  });

  const unitField = useAutosaveField({
    serverValue: detail?.unit_id != null ? String(detail.unit_id) : '',
    label: t('catalog.unit'),
    validate: (v) => (v === '' ? t('common.required') : null),
    commit: (v) => commitProduct({ unitId: Number(v) }),
  });

  /**
   * Only active categories may be newly assigned, but the one this product
   * already holds stays visible even if it was retired — otherwise the picker
   * would show an empty box for a product that does have a category.
   */
  const categoryOptions = useMemo(() => {
    const active = catalog.categories.filter((c) => c.is_active);
    const current = detail?.category_id;
    if (current != null && !active.some((c) => c.id === current)) {
      const held = catalog.categories.find((c) => c.id === current);
      if (held) return [...active, held];
    }
    return active;
  }, [catalog.categories, detail?.category_id]);

  async function applyProductActive(nextActive: boolean) {
    setProductActionBusy(true);
    setProductActionError(null);
    try {
      await commitProduct({ isActive: nextActive });
      setConfirmDeactivateProduct(false);
    } catch (err) {
      setProductActionError(errorText(err));
    } finally {
      setProductActionBusy(false);
    }
  }

  async function handleAddVariant(e: FormEvent) {
    e.preventDefault();
    if (addBusy || !detail || !isVariantFormValid(addDraft)) {
      setAddError(t('errors.validation'));
      return;
    }
    setAddBusy(true);
    setAddError(null);
    try {
      const variantInput: VariantInput = {
        name_override: addDraft.nameOverride.trim() || undefined,
        sale_price: addDraft.salePrice,
        is_active: addDraft.isActive,
        ...(addDraft.barcode.trim() ? { barcodes: [addDraft.barcode.trim()] } : {}),
      };
      const newId = await catalog.addVariant(detail.product_id, variantInput);

      // `VariantInput` has no minimum_stock field, so add_variant cannot carry
      // it. This second call is safe precisely because the variant is brand
      // new — every value written here is one the operator just typed, so
      // nothing pre-existing can be overwritten.
      await catalog.updateVariantV2(
        newId,
        addDraft.nameOverride.trim() || null,
        addDraft.salePrice,
        addDraft.isActive,
        addDraft.minimumStock,
      );

      await catalog.refreshDetail(detail.product_id);
      setAddDraft({ ...EMPTY_VARIANT });
      setAddingVariant(false);
      setExpandedVariantId(newId);
    } catch (err) {
      setAddError(errorText(err));
    } finally {
      setAddBusy(false);
    }
  }

  if (catalog.detailLoading) return <Spinner />;
  if (catalog.detailError) return <Banner tone="error">{catalog.detailError}</Banner>;
  if (!detail) return null;

  const unitOptions = catalog.units.map((u) => ({ value: String(u.id), label: `${u.name} (${u.code})` }));

  return (
    <div className="sk-detail-panel" data-testid="product-detail-panel" aria-label={t('productsWorkspace.detail')}>
      <div className="sk-detail-panel__header">
        <div>
          <h2 className="sk-detail-panel__title">{detail.name}</h2>
          <p className="sk-muted sk-detail-panel__hint">{t('autosave.hint')}</p>
        </div>
        {showBack ? (
          <Button variant="secondary" type="button" onClick={onBack} data-testid="detail-back">
            {t('catalog.backToList')}
          </Button>
        ) : null}
      </div>

      {productActionError ? <Banner tone="error">{productActionError}</Banner> : null}

      <div className="sk-card sk-detail-panel__form">
        <h3 className="sk-detail-panel__section-title">{t('catalog.edit')}</h3>
        <div className="sk-form__grid">
          <AutosaveTextField
            id="detail-product-name"
            label={t('catalog.name')}
            field={nameField}
            testId="detail-product-name"
          />
          <AutosaveSelectField
            id="detail-product-category"
            label={t('productsList.category')}
            field={categoryField}
            emptyLabel={t('common.none')}
            options={categoryOptions.map((c) => ({ value: String(c.id), label: c.name }))}
            testId="detail-product-category"
          />
          <AutosaveSelectField
            id="detail-product-unit"
            label={t('catalog.unit')}
            field={unitField}
            options={unitOptions}
            testId="detail-product-unit"
          />

          {/* RULING 3: deactivating a product is structural and confirmed. */}
          <div className="sk-field">
            <span className="sk-field__label">{t('products.active')}</span>
            <div className="sk-detail-panel__status-row">
              <span className={`sk-badge ${detail.is_active ? 'sk-badge--ok' : 'sk-badge--secondary'}`}>
                {detail.is_active ? t('catalog.active') : t('catalog.inactive')}
              </span>
              <Button
                type="button"
                variant={detail.is_active ? 'secondary' : 'primary'}
                loading={productActionBusy}
                onClick={() => {
                  if (detail.is_active) setConfirmDeactivateProduct(true);
                  else void applyProductActive(true);
                }}
                data-testid="toggle-product-active"
              >
                {detail.is_active ? t('products.deactivate') : t('products.activate')}
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="sk-card">
        <div className="sk-detail-panel__variants-header">
          <h3 className="sk-detail-panel__section-title">{t('variants.title')}</h3>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setAddDraft({ ...EMPTY_VARIANT });
              setAddError(null);
              setAddingVariant((prev) => !prev);
            }}
            aria-expanded={addingVariant}
            data-testid="add-variant-toggle"
          >
            {addingVariant ? t('common.cancel') : `+ ${t('variants.add')}`}
          </Button>
        </div>

        {/* RULING 4: the add-variant draft is an inline panel, not a modal. */}
        {addingVariant ? (
          <form className="sk-form sk-variant-panel" onSubmit={handleAddVariant} aria-label={t('variants.add')}>
            {addError ? <Banner tone="error" testId="add-variant-error">{addError}</Banner> : null}
            <VariantForm
              values={addDraft}
              onChange={setAddDraft}
              disabled={addBusy}
              idPrefix="add-variant"
            />
            <div className="sk-form-actions">
              <Button
                type="submit"
                loading={addBusy}
                disabled={!isVariantFormValid(addDraft)}
                data-testid="add-variant-submit"
              >
                {t('variants.add')}
              </Button>
            </div>
          </form>
        ) : null}

        {detail.variants.length === 0 ? (
          <Banner tone="info">{t('variants.empty')}</Banner>
        ) : (
          <div className="sk-table-wrap">
            <table className="sk-table" data-testid="variants-table">
              <thead>
                <tr>
                  <th scope="col">{t('variants.identifier')}</th>
                  <th scope="col">{t('variants.name')}</th>
                  <th scope="col">{t('attrs.title')}</th>
                  <th scope="col" className="sk-num">{t('variants.price')}</th>
                  <th scope="col">{t('variants.active')}</th>
                  <th scope="col">{t('productsList.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {detail.variants.map((v) => (
                  <VariantRow
                    key={v.variant_id}
                    catalog={catalog}
                    productId={detail.product_id}
                    variant={v}
                    attributes={catalog.attributes}
                    refLoading={catalog.refLoading}
                    expanded={expandedVariantId === v.variant_id}
                    onToggle={() =>
                      setExpandedVariantId((prev) => (prev === v.variant_id ? null : v.variant_id))
                    }
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {confirmDeactivateProduct ? (
        <ConfirmDialog
          title={t('products.confirmDeactivateTitle')}
          body={t('products.confirmDeactivateBody', { name: detail.name })}
          confirmLabel={t('products.deactivate')}
          cancelLabel={t('common.cancel')}
          confirmVariant="danger"
          busy={productActionBusy}
          onConfirm={() => void applyProductActive(false)}
          onCancel={() => setConfirmDeactivateProduct(false)}
        />
      ) : null}
    </div>
  );
}
