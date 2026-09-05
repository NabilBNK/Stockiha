/**
 * WS-D-9 / WS-D-11 — the right slide-in detail panel.
 *
 * Everything that is not inline-editable in the table lives here. The panel
 * overlays the table; the table keeps full width when the panel is closed.
 *
 * WS-D-11 restructures it, because the Owner's verdict on the previous shape
 * was that "the arrangements of the elements is frustrating and confusing" and
 * "the right sidebar is so much narrow and tight". Three changes address that:
 *
 *   R4/R6 — TWO COLUMNS. A variant list on the inline-start side, the selected
 *     variant's editor on the inline-end side, EXACTLY ONE open at a time. The
 *     accordion is gone: it used to stack name + identifier + status + actions
 *     + figures + attribute picker + barcodes vertically inside 560px, for
 *     several variants at once. Below a panel width where two columns cannot
 *     both be legible it falls back to list-then-detail with a back control —
 *     measured on the PANEL, because the panel is resizable and a viewport
 *     query would answer the wrong question.
 *   R5 — PRODUCT FIELDS MOVED to their own tab. They are edited rarely and
 *     variants constantly, so they no longer eat the top of every screenful.
 *     One clearly labelled click away.
 *   R1/R2/R3 — the panel itself is proportionally wide, drag-resizable and
 *     expandable to full screen; see PanelShell.tsx.
 *
 * NO MODAL INSIDE THE PANEL. The only permitted overlay-on-overlay is
 * ConfirmDialog, guarding the destructive and structural actions: deactivating
 * a product, deactivating a variant, removing a barcode. None of those
 * autosave.
 *
 * Fields commit on blur (text) or on change (selects). Nothing commits on a
 * keystroke.
 *
 * CR2 REUSE. The attribute section renders `AttributeManagerForVariant` from
 * ProductEditor.tsx — the component that owns the `mergeAssignedValues`
 * wiring, which keeps a RETIRED value a variant already holds visible,
 * selectable and marked. A fresh picker here would reintroduce that data-loss
 * defect, so the existing component is reused whole.
 *
 * R14 — a rejected attribute combination must not leave the chips showing a
 * selection the database refused. `handleSetAttributes` refreshes the detail
 * BEFORE re-throwing, which gives AttributeManagerForVariant a new `variant`
 * object; its existing effect re-seeds the selection from server truth, so the
 * chip reverts while the picker surfaces the message.
 *
 * ADD VARIANT — `VariantInput` has no minimum_stock field, so a typed minimum
 * stock is applied straight after through updateVariantV2; dropping it
 * silently would be data loss.
 *
 * CREATE PRODUCT — `CatalogCreatePanel`, the same panel in create mode. A
 * deliberate submit, never autosave: there is no row yet, so a half-typed
 * product would be a nameless, priceless row in a live catalogue. R15 keeps a
 * discard guard there and, deliberately, nowhere else — the edit side commits
 * as you go, so there is nothing to lose.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';

import { Banner, Button, ConfirmDialog, Spinner, TextField } from '../../shared/components';
import { useI18n } from '../../shared/i18n';
import { useErrorText } from '../../shared/hooks/useErrorText';
import * as ipc from '../../shared/ipc/gateway';
import type {
  AttributeDefinition,
  ProductDetail,
  ReferenceLifecycleItem,
  UnitLifecycleItem,
  VariantDetail,
  VariantInput,
} from '../../shared/ipc/dto';
import { InlineCreateSelect } from '../products/InlineCreateSelect';
import { PanelField, PanelSelect } from './PanelFields';
import { PanelShell, usePanelNarrow } from './PanelShell';
import { VariantEditor, VariantEditorEmpty } from './VariantEditor';
import {
  EMPTY_VARIANT_DRAFT,
  VariantDraftFields,
  isVariantDraftValid,
  type VariantDraft,
} from './VariantDraftFields';
import { useDecimalFormat } from './useDecimalFormat';

interface ProductPatch {
  name?: string;
  unitId?: number;
  isActive?: boolean;
  categoryId?: number | null;
}

interface VariantPatch {
  nameOverride?: string | null;
  salePrice?: string;
  isActive?: boolean;
  minimumStock?: string;
}

type PanelTab = 'variants' | 'product';

export function CatalogPanel({
  token,
  productId,
  initialVariantId,
  stockByVariant,
  onClose,
}: {
  token: string;
  productId: number;
  initialVariantId?: number | null;
  /** quantity_on_hand per variant, from the loaded list page. */
  stockByVariant?: Record<number, string>;
  onClose: (changed: boolean) => void;
}) {
  const { t } = useI18n();
  const errorText = useErrorText();
  const format = useDecimalFormat();
  const narrow = usePanelNarrow();

  const [detail, setDetail] = useState<ProductDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [categories, setCategories] = useState<ReferenceLifecycleItem[]>([]);
  const [units, setUnits] = useState<UnitLifecycleItem[]>([]);
  const [attributes, setAttributes] = useState<AttributeDefinition[]>([]);
  const [refLoading, setRefLoading] = useState(true);

  const [tab, setTab] = useState<PanelTab>('variants');
  // R6: exactly one variant open. A single id, never a set.
  const [selectedVariantId, setSelectedVariantId] = useState<number | null>(initialVariantId ?? null);
  const [addingVariant, setAddingVariant] = useState(false);
  const [addDraft, setAddDraft] = useState<VariantDraft>({ ...EMPTY_VARIANT_DRAFT });
  const [addError, setAddError] = useState<string | null>(null);
  const [addBusy, setAddBusy] = useState(false);
  const [confirmProductDeactivate, setConfirmProductDeactivate] = useState(false);
  const [confirmVariantDeactivate, setConfirmVariantDeactivate] = useState<VariantDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const changedRef = useRef(false);

  const detailRef = useRef<ProductDetail | null>(null);
  detailRef.current = detail;
  const chain = useRef<Promise<void>>(Promise.resolve());

  const refresh = useCallback(async () => {
    const fresh = await ipc.getProductDetail(token, productId);
    setDetail(fresh);
    detailRef.current = fresh;
  }, [token, productId]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(null);
    void ipc.getProductDetail(token, productId)
      .then((d) => {
        if (!active) return;
        setDetail(d);
        detailRef.current = d;
        // Land on a variant rather than an empty right-hand column.
        setSelectedVariantId((current) => current ?? d.variants[0]?.variant_id ?? null);
      })
      .catch((err) => { if (active) setLoadError(errorText(err)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token, productId, errorText]);

  const loadRefData = useCallback(async () => {
    setRefLoading(true);
    try {
      const [cats, us, attrs] = await Promise.all([
        ipc.listCategories(token),
        ipc.listUnitsV2(token),
        ipc.listAttributes(token),
      ]);
      setCategories(cats);
      setUnits(us);
      setAttributes(attrs);
    } catch {
      // Reference data is supporting detail; a failure must not blank the panel.
    } finally {
      setRefLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void loadRefData();
  }, [loadRefData]);

  /**
   * THE OVERWRITE TRAP — product half.
   *
   * `catalog.update_product` assigns name, unit_id, is_active and category_id
   * unconditionally, so every commit sends the CURRENT server value of the
   * columns the user did not touch, read from the freshest snapshot at
   * execution time. `!== undefined` distinguishes "unchanged" from a
   * deliberate null; `??` would make clearing a category impossible.
   */
  const commitProduct = useCallback((patch: ProductPatch) => {
    const run = chain.current.catch(() => {}).then(async () => {
      const d = detailRef.current;
      if (!d) return;
      await ipc.updateProductV2(
        token,
        d.product_id,
        patch.name !== undefined ? patch.name : d.name,
        patch.unitId !== undefined ? patch.unitId : d.unit_id,
        patch.isActive !== undefined ? patch.isActive : d.is_active,
        patch.categoryId !== undefined ? patch.categoryId : d.category_id,
      );
      changedRef.current = true;
      await refresh();
    });
    chain.current = run.catch(() => {});
    return run;
  }, [token, refresh]);

  /** THE OVERWRITE TRAP — variant half. Same rule, four columns. */
  const commitVariant = useCallback((variantId: number, patch: VariantPatch) => {
    const run = chain.current.catch(() => {}).then(async () => {
      const d = detailRef.current;
      const v = d?.variants.find((x) => x.variant_id === variantId);
      if (!v) return;
      await ipc.updateVariantV2(
        token,
        variantId,
        patch.nameOverride !== undefined ? patch.nameOverride : v.name_override,
        patch.salePrice !== undefined ? patch.salePrice : v.sale_price,
        patch.isActive !== undefined ? patch.isActive : v.is_active,
        patch.minimumStock !== undefined ? patch.minimumStock : v.minimum_stock,
      );
      changedRef.current = true;
      await refresh();
    });
    chain.current = run.catch(() => {});
    return run;
  }, [token, refresh]);

  async function runAction(action: () => Promise<void>) {
    setBusy(true);
    setActionError(null);
    try {
      await action();
      changedRef.current = true;
      await refresh();
      setConfirmProductDeactivate(false);
      setConfirmVariantDeactivate(null);
    } catch (err) {
      setActionError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  /**
   * R14 — a variant's identity is its attribute combination, and
   * `catalog.set_variant_attributes` rejects a duplicate. On rejection the
   * chips must NOT be left showing the combination the database refused.
   *
   * Refreshing before re-throwing hands AttributeManagerForVariant a new
   * `variant` object, whose existing effect re-seeds the selection from server
   * truth — so the chip reverts to what is actually stored, and the picker's
   * own catch surfaces the message. Doing it this way keeps that component
   * byte-identical, which CR2 requires.
   */
  const handleSetAttributes = useCallback(async (variantId: number, sel: Record<number, number>) => {
    const ids = Object.values(sel).filter((id) => id > 0);
    try {
      await ipc.setVariantAttributes(token, variantId, ids);
    } catch (err) {
      await refresh().catch(() => {});
      throw err;
    }
    changedRef.current = true;
    await refresh();
  }, [token, refresh]);

  const handleCreateAttribute = useCallback(async (name: string) => {
    const id = await ipc.createAttribute(token, name);
    await loadRefData();
    return id;
  }, [token, loadRefData]);

  const handleAddValue = useCallback(async (attributeId: number, value: string) => {
    const id = await ipc.addAttributeValue(token, attributeId, value);
    await loadRefData();
    return id;
  }, [token, loadRefData]);

  /**
   * ADD VARIANT. The updateVariantV2 that follows is unconditional and safe:
   * the variant is brand new, so every column in the payload is a value the
   * operator just typed and there is nothing pre-existing to overwrite. The
   * two calls are not atomic — a first-succeeded-second-failed outcome is
   * reported distinctly, because "add failed" would be a lie that leads to a
   * duplicate.
   */
  async function submitAddVariant(event: FormEvent) {
    event.preventDefault();
    if (addBusy) return;
    if (!isVariantDraftValid(addDraft)) {
      setAddError(t('errors.validation'));
      return;
    }
    setAddBusy(true);
    setAddError(null);

    const nameOverride = addDraft.nameOverride.trim() || null;
    let newId: number;
    try {
      const input: VariantInput = {
        ...(nameOverride ? { name_override: nameOverride } : {}),
        sale_price: addDraft.salePrice,
        is_active: addDraft.isActive,
        ...(addDraft.barcode.trim() ? { barcodes: [addDraft.barcode.trim()] } : {}),
      };
      newId = await ipc.addVariant(token, productId, input);
    } catch (err) {
      setAddError(errorText(err));
      setAddBusy(false);
      return;
    }

    changedRef.current = true;
    try {
      await ipc.updateVariantV2(
        token,
        newId,
        nameOverride,
        addDraft.salePrice,
        addDraft.isActive,
        addDraft.minimumStock,
      );
    } catch (err) {
      setAddError(`${t('catalog2.variantAddedMinimumStockFailed')} ${errorText(err)}`);
    }

    try {
      await refresh();
    } catch {
      // The variant exists either way; the list reloads on close.
    }
    setSelectedVariantId(newId);
    setAddingVariant(false);
    setAddDraft({ ...EMPTY_VARIANT_DRAFT });
    setAddBusy(false);
  }

  function close() {
    onClose(changedRef.current);
  }

  const selectedVariant = useMemo(
    () => detail?.variants.find((v) => v.variant_id === selectedVariantId) ?? null,
    [detail, selectedVariantId],
  );

  let body: ReactNode;
  if (loading) {
    body = <Spinner />;
  } else if (loadError) {
    body = <Banner tone="error">{loadError}</Banner>;
  } else if (!detail) {
    body = null;
  } else {
    /* Only active categories may be newly assigned, but the one this product
       already holds stays visible even if it was retired — otherwise the
       picker would show an empty box for a product that does have one. */
    const activeCategories = categories.filter((c) => c.is_active);
    const heldCategory = detail.category_id != null
      && !activeCategories.some((c) => c.id === detail.category_id)
      ? categories.find((c) => c.id === detail.category_id)
      : undefined;
    const categoryOptions = (heldCategory ? [...activeCategories, heldCategory] : activeCategories)
      .map((c) => ({ value: String(c.id), label: c.name }));

    const activeUnits = units.filter((u) => u.is_active);
    const heldUnit = !activeUnits.some((u) => u.id === detail.unit_id)
      ? units.find((u) => u.id === detail.unit_id)
      : undefined;
    const unitOptions = (heldUnit ? [...activeUnits, heldUnit] : activeUnits)
      .map((u) => ({ value: String(u.id), label: `${u.name} (${u.code})` }));

    // R4 fallback: one column at a time, with a way back to the list.
    const showList = !narrow || selectedVariantId == null;
    const showDetail = !narrow || selectedVariantId != null;

    body = (
      <>
        {actionError ? <Banner tone="error">{actionError}</Banner> : null}

        {/* R5 — product fields are one clearly labelled click away, and out of
            the way the rest of the time. */}
        <div className="sk-catalog2__tabs" role="tablist" aria-label={t('catalog2.panel')}>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'variants'}
            className={`sk-catalog2__tab${tab === 'variants' ? ' sk-catalog2__tab--active' : ''}`}
            onClick={() => setTab('variants')}
            data-testid="catalog2-tab-variants"
          >
            {t('variants.title')} ({detail.variants.length})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'product'}
            className={`sk-catalog2__tab${tab === 'product' ? ' sk-catalog2__tab--active' : ''}`}
            onClick={() => setTab('product')}
            data-testid="catalog2-tab-product"
          >
            {t('catalog2.panelProduct')}
          </button>
        </div>

        {tab === 'product' ? (
          <section className="sk-catalog2__panel-section" aria-label={t('catalog2.panelProduct')}>
            <div className="sk-catalog2__panel-grid">
              <PanelField
                id="catalog2-panel-name"
                label={t('catalog.name')}
                value={detail.name}
                validate={(v) => (v.length > 0 ? null : t('common.required'))}
                commit={(v) => commitProduct({ name: v })}
                testId="catalog2-panel-name"
              />
              <PanelSelect
                id="catalog2-panel-category"
                label={t('productsList.category')}
                value={detail.category_id != null ? String(detail.category_id) : ''}
                options={categoryOptions}
                emptyLabel={t('common.none')}
                commit={(v) => commitProduct({ categoryId: v === '' ? null : Number(v) })}
                testId="catalog2-panel-category"
              />
              <PanelSelect
                id="catalog2-panel-unit"
                label={t('catalog.unit')}
                value={detail.unit_id != null ? String(detail.unit_id) : ''}
                options={unitOptions}
                commit={(v) => commitProduct({ unitId: Number(v) })}
                testId="catalog2-panel-unit"
              />
              <div className="sk-catalog2__field">
                <span className="sk-catalog2__label">{t('products.active')}</span>
                <div className="sk-catalog2__status-row">
                  <span className={`sk-catalog2__pill ${detail.is_active ? 'sk-catalog2__pill--accent' : 'sk-catalog2__pill--neutral'}`}>
                    {detail.is_active ? t('catalog.active') : t('catalog.inactive')}
                  </span>
                  <Button
                    type="button"
                    variant={detail.is_active ? 'secondary' : 'primary'}
                    loading={busy}
                    onClick={() => {
                      if (detail.is_active) setConfirmProductDeactivate(true);
                      else void runAction(() => commitProduct({ isActive: true }));
                    }}
                    data-testid="catalog2-panel-product-active"
                  >
                    {detail.is_active ? t('products.deactivate') : t('products.activate')}
                  </Button>
                </div>
              </div>
            </div>
          </section>
        ) : (
          <div className={`sk-catalog2__panel-cols${narrow ? ' sk-catalog2__panel-cols--stacked' : ''}`}>
            {showList ? (
              <div className="sk-catalog2__vlist" data-testid="catalog2-variant-list">
                <div className="sk-catalog2__section-head">
                  <h3>{t('variants.title')}</h3>
                  <Button
                    type="button"
                    variant="secondary"
                    aria-expanded={addingVariant}
                    onClick={() => {
                      setAddDraft({ ...EMPTY_VARIANT_DRAFT });
                      setAddError(null);
                      setAddingVariant((prev) => !prev);
                    }}
                    data-testid="catalog2-add-variant-toggle"
                  >
                    {addingVariant ? t('common.cancel') : `+ ${t('variants.add')}`}
                  </Button>
                </div>

                {/* The error lives in the section, not the form: an add that
                    succeeded but could not apply the minimum stock closes the
                    form and must still be able to say so. */}
                {addError ? <Banner tone="error" testId="catalog2-add-variant-error">{addError}</Banner> : null}

                {addingVariant ? (
                  <form
                    className="sk-catalog2__panel-variant-body"
                    onSubmit={submitAddVariant}
                    aria-label={t('catalog2.addVariantTitle')}
                  >
                    <VariantDraftFields
                      idPrefix="catalog2-add-variant"
                      draft={addDraft}
                      onChange={setAddDraft}
                      disabled={addBusy}
                    />
                    <div className="sk-catalog2__actions sk-catalog2__actions--end">
                      <Button
                        type="submit"
                        loading={addBusy}
                        disabled={!isVariantDraftValid(addDraft)}
                        data-testid="catalog2-add-variant-submit"
                      >
                        {t('variants.add')}
                      </Button>
                    </div>
                  </form>
                ) : null}

                {detail.variants.length === 0 ? (
                  <Banner tone="info">{t('variants.empty')}</Banner>
                ) : detail.variants.map((variant) => {
                  const attrs = variant.attributes.map((a) => a.value).join(' \u00b7 ');
                  const selected = variant.variant_id === selectedVariantId;
                  const stock = stockByVariant?.[variant.variant_id];
                  return (
                    <div
                      className={`sk-catalog2__panel-variant${selected ? ' sk-catalog2__panel-variant--selected' : ''}`}
                      key={variant.variant_id}
                    >
                      {/* WS-D-10 layout rule still binds: the name truncates,
                          the actions keep a fixed inline-end slot. */}
                      <div className="sk-catalog2__vrow">
                        <div className="sk-catalog2__vrow-main">
                          <strong
                            className="sk-catalog2__truncate sk-catalog2__vrow-name"
                            title={variant.effective_variant_name}
                          >
                            {variant.effective_variant_name}
                          </strong>
                          <span className={`sk-catalog2__pill ${variant.is_active ? 'sk-catalog2__pill--accent' : 'sk-catalog2__pill--neutral'}`}>
                            {variant.is_active ? t('catalog.active') : t('catalog.inactive')}
                          </span>
                        </div>
                        <div className="sk-catalog2__actions">
                          <Button
                            type="button"
                            variant={selected ? 'primary' : 'secondary'}
                            aria-pressed={selected}
                            onClick={() => setSelectedVariantId(variant.variant_id)}
                            data-testid={`catalog2-panel-variant-toggle-${variant.variant_id}`}
                          >
                            {t('catalog2.edit')}
                          </Button>
                          <Button
                            type="button"
                            variant={variant.is_active ? 'secondary' : 'primary'}
                            loading={busy}
                            onClick={() => {
                              if (variant.is_active) setConfirmVariantDeactivate(variant);
                              else void runAction(() => ipc.setVariantActive(token, variant.variant_id, true));
                            }}
                            data-testid={`catalog2-panel-variant-active-${variant.variant_id}`}
                          >
                            {variant.is_active ? t('variants.deactivate') : t('variants.activate')}
                          </Button>
                        </div>
                      </div>

                      {/* R11 — combination, price, stock, status at a glance. */}
                      <div className="sk-catalog2__vrow-figures">
                        <span className="sk-catalog2__truncate" title={attrs || undefined}>
                          {attrs || t('catalog2.noAttributes')}
                        </span>
                        <span>{t('variants.price')}: <strong>{format(variant.sale_price)}</strong></span>
                        <span>
                          {t('productsList.stock')}:{' '}
                          <strong>{stock !== undefined ? format(stock) : '\u2014'}</strong>
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}

            {showDetail ? (
              <div className="sk-catalog2__vdetail" data-testid="catalog2-variant-detail">
                {narrow && selectedVariant ? (
                  <div className="sk-catalog2__actions">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => setSelectedVariantId(null)}
                      data-testid="catalog2-variant-back"
                    >
                      {t('catalog.backToList')}
                    </Button>
                  </div>
                ) : null}

                {selectedVariant ? (
                  <VariantEditor
                    key={selectedVariant.variant_id}
                    variant={selectedVariant}
                    attributes={attributes}
                    refLoading={refLoading}
                    stock={stockByVariant?.[selectedVariant.variant_id]}
                    onCommitName={(nameOverride) =>
                      commitVariant(selectedVariant.variant_id, { nameOverride })}
                    onSetAttributes={(sel) => handleSetAttributes(selectedVariant.variant_id, sel)}
                    onCreateAttribute={handleCreateAttribute}
                    onAddValue={handleAddValue}
                    barcodes={(
                      <BarcodeSection
                        token={token}
                        variant={selectedVariant}
                        busy={busy}
                        onChanged={async () => {
                          changedRef.current = true;
                          await refresh();
                        }}
                      />
                    )}
                  />
                ) : (
                  <VariantEditorEmpty />
                )}
              </div>
            ) : null}
          </div>
        )}
      </>
    );
  }

  return (
    <PanelShell
      title={detail?.name ?? t('catalog2.panel')}
      onClose={close}
      overlays={<>
      {confirmProductDeactivate && detail ? (
        <ConfirmDialog
          title={t('products.confirmDeactivateTitle')}
          body={t('products.confirmDeactivateBody', { name: detail.name })}
          confirmLabel={t('products.deactivate')}
          cancelLabel={t('common.cancel')}
          confirmVariant="danger"
          busy={busy}
          onConfirm={() => void runAction(() => commitProduct({ isActive: false }))}
          onCancel={() => setConfirmProductDeactivate(false)}
        />
      ) : null}

      {confirmVariantDeactivate ? (
        <ConfirmDialog
          title={t('variants.confirmDeactivateTitle')}
          body={t('variants.confirmDeactivateBody', { name: confirmVariantDeactivate.effective_variant_name })}
          confirmLabel={t('variants.deactivate')}
          cancelLabel={t('common.cancel')}
          confirmVariant="danger"
          busy={busy}
          onConfirm={() => void runAction(() =>
            ipc.setVariantActive(token, confirmVariantDeactivate.variant_id, false))}
          onCancel={() => setConfirmVariantDeactivate(null)}
        />
      ) : null}
      </>}
    >
      {body}
    </PanelShell>
  );
}

export function CatalogCreatePanel({
  token,
  onClose,
  onCreated,
}: {
  token: string;
  onClose: () => void;
  onCreated: (productId: number) => void;
}) {
  const { t } = useI18n();
  const errorText = useErrorText();

  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [unitId, setUnitId] = useState<number | null>(null);
  const [isActive, setIsActive] = useState(true);
  const [draft, setDraft] = useState<VariantDraft>({ ...EMPTY_VARIANT_DRAFT });

  const [categories, setCategories] = useState<ReferenceLifecycleItem[]>([]);
  const [units, setUnits] = useState<UnitLifecycleItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  /**
   * R15 — the guard exists HERE and deliberately nowhere else. The edit panel
   * commits every field as you finish with it, so closing it can lose nothing.
   * This form holds a product that does not exist yet, so closing it silently
   * would throw the whole thing away.
   */
  const dirty = name.trim() !== ''
    || categoryId !== null
    || draft.nameOverride.trim() !== ''
    || draft.barcode.trim() !== ''
    || draft.salePrice.trim() !== ''
    || draft.minimumStock !== EMPTY_VARIANT_DRAFT.minimumStock;

  function requestClose() {
    if (dirty && !submitting) {
      setConfirmDiscard(true);
      return;
    }
    onClose();
  }

  const loadRefData = useCallback(async () => {
    try {
      const [cats, us] = await Promise.all([
        ipc.listCategories(token),
        ipc.listUnitsV2(token),
      ]);
      setCategories(cats);
      setUnits(us);
      setUnitId((current) => current ?? us.find((u) => u.is_active)?.id ?? null);
    } catch {
      // The pickers stay empty; the form still reports its own submit errors.
    }
  }, [token]);

  useEffect(() => {
    void loadRefData();
  }, [loadRefData]);

  const createCategory = useCallback(async (label: string) => {
    const id = await ipc.createCategory(token, label);
    await loadRefData();
    return id;
  }, [token, loadRefData]);

  /**
   * `catalog.create_unit` needs a code as well as a name; the inline shortcut
   * collects one value, so the typed text is used for both and the operator
   * can refine the pair later on Catalogue Setup. Same behaviour as the
   * existing product form.
   */
  const createUnit = useCallback(async (label: string) => {
    const id = await ipc.createUnit(token, label, label);
    await loadRefData();
    return id;
  }, [token, loadRefData]);

  const canSubmit = name.trim().length > 0
    && unitId != null
    && isVariantDraftValid(draft)
    && !submitting;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit || unitId == null) {
      setError(t('errors.validation'));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const created = await ipc.quickCreateProduct(token, {
        name: name.trim(),
        unitId,
        // Exact decimal strings, forwarded verbatim — never parsed, never
        // rounded, and "0" transmitted as "0" rather than dropped as blank.
        salePrice: draft.salePrice,
        minimumStock: draft.minimumStock,
        categoryId,
        barcode: draft.barcode.trim() || null,
        isActive,
      });
      onCreated(created.product_id);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSubmitting(false);
    }
  }

  const categoryOptions = categories
    .filter((c) => c.is_active)
    .map((c) => ({ id: c.id, label: c.name }));
  const unitOptions = units
    .filter((u) => u.is_active)
    .map((u) => ({ id: u.id, label: `${u.name} (${u.code})` }));

  return (
    <PanelShell
      title={t('catalog2.createTitle')}
      onClose={requestClose}
      overlays={confirmDiscard ? (
        <ConfirmDialog
          title={t('catalog2.discardTitle')}
          body={t('catalog2.discardBody')}
          confirmLabel={t('catalog2.discardConfirm')}
          cancelLabel={t('catalog2.keepEditing')}
          confirmVariant="danger"
          onConfirm={() => { setConfirmDiscard(false); onClose(); }}
          onCancel={() => setConfirmDiscard(false)}
        />
      ) : null}
    >
      <form onSubmit={submit} aria-label={t('catalog2.createTitle')} data-testid="catalog2-create-form">
        {error ? <Banner tone="error" testId="catalog2-create-error">{error}</Banner> : null}

        <section className="sk-catalog2__panel-section" aria-label={t('catalog2.panelProduct')}>
          <h3>{t('catalog2.panelProduct')}</h3>
          <p className="sk-catalog2__note">{t('catalog2.createHint')}</p>
          <div className="sk-catalog2__panel-grid">
            <TextField
              id="catalog2-create-name"
              label={t('catalog.name')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              disabled={submitting}
              data-testid="catalog2-create-name"
            />
            <InlineCreateSelect
              id="catalog2-create-category"
              label={t('productsList.category')}
              options={categoryOptions}
              value={categoryId}
              onChange={setCategoryId}
              onCreate={createCategory}
              emptyLabel={t('common.none')}
              createLabel={t('catalogueSetup.categories.name')}
              newItemLabel={t('catalog.newShort')}
              disabled={submitting}
              testId="catalog2-create-category"
            />
            <InlineCreateSelect
              id="catalog2-create-unit"
              label={t('catalog.unit')}
              options={unitOptions}
              value={unitId}
              onChange={setUnitId}
              onCreate={createUnit}
              createLabel={t('catalogueSetup.units.name')}
              newItemLabel={t('catalog.newShort')}
              disabled={submitting}
              testId="catalog2-create-unit"
            />
            <label className="sk-catalog2__checkbox">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                disabled={submitting}
                data-testid="catalog2-create-active"
              />
              <span>{isActive ? t('catalog.active') : t('catalog.inactive')}</span>
            </label>
          </div>
        </section>

        <section className="sk-catalog2__panel-section" aria-label={t('catalog2.firstVariant')}>
          <h3>{t('catalog2.firstVariant')}</h3>
          {/* The variant's own active flag is not offered here: a brand-new
              product and its first variant share one state, set above. */}
          <VariantDraftFields
            idPrefix="catalog2-create-variant"
            draft={draft}
            onChange={setDraft}
            disabled={submitting}
            showActive={false}
          />
        </section>

        <div className="sk-catalog2__actions sk-catalog2__actions--end">
          <Button variant="secondary" type="button" onClick={requestClose} disabled={submitting}>
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            loading={submitting}
            disabled={!canSubmit}
            data-testid="catalog2-create-submit"
          >
            {t('catalog2.createSubmit')}
          </Button>
        </div>
      </form>
    </PanelShell>
  );
}

/**
 * Barcodes for one variant. Adding is a single deliberate submit — barcodes
 * are uniqueness-constrained, so nothing here may be written from a partially
 * typed value. Removing is destructive and confirmed (RULING 6).
 */
function BarcodeSection({
  token,
  variant,
  busy,
  onChanged,
}: {
  token: string;
  variant: VariantDetail;
  busy: boolean;
  onChanged: () => Promise<void>;
}) {
  const { t } = useI18n();
  const errorText = useErrorText();
  const [draft, setDraft] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<number | null>(null);
  const [removing, setRemoving] = useState(false);

  async function add() {
    const barcode = draft.trim();
    if (!barcode || adding) return;
    setAdding(true);
    setError(null);
    try {
      await ipc.addVariantBarcode(token, variant.variant_id, barcode);
      setDraft('');
      await onChanged();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setAdding(false);
    }
  }

  async function remove(barcodeId: number) {
    setRemoving(true);
    setError(null);
    try {
      await ipc.removeVariantBarcode(token, barcodeId);
      setConfirmRemoveId(null);
      await onChanged();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div>
      <h3>{t('barcodes.title')}</h3>
      {error ? <Banner tone="error">{error}</Banner> : null}

      {variant.barcodes.length === 0 ? (
        <p className="sk-catalog2__note">{t('barcodes.empty')}</p>
      ) : (
        <ul className="sk-catalog2__barcode-list">
          {variant.barcodes.map((b) => (
            <li key={b.id} className="sk-catalog2__barcode-row">
              <span className="sk-catalog2__mono">{b.barcode}</span>
              <Button
                type="button"
                variant="danger"
                disabled={busy || removing}
                onClick={() => setConfirmRemoveId(b.id)}
                data-testid={`catalog2-remove-barcode-${b.id}`}
              >
                {t('barcodes.remove')}
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="sk-catalog2__field sk-catalog2__barcode-field">
        <label className="sk-catalog2__label" htmlFor={`catalog2-barcode-${variant.variant_id}`}>
          {t('barcodes.barcode')}
        </label>
        <input
          id={`catalog2-barcode-${variant.variant_id}`}
          className="sk-catalog2__input"
          value={draft}
          placeholder={t('barcodes.placeholder')}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); void add(); }
          }}
          data-testid={`catalog2-barcode-input-${variant.variant_id}`}
        />
      </div>
      <div className="sk-catalog2__actions sk-catalog2__actions--end">
        <Button
          type="button"
          loading={adding}
          disabled={!draft.trim() || busy}
          onClick={() => void add()}
          data-testid={`catalog2-add-barcode-${variant.variant_id}`}
        >
          {t('barcodes.add')}
        </Button>
      </div>

      {confirmRemoveId != null ? (
        <ConfirmDialog
          title={t('barcodes.confirmRemoveTitle')}
          body={t('barcodes.confirmRemoveBody', {
            barcode: variant.barcodes.find((b) => b.id === confirmRemoveId)?.barcode ?? '',
          })}
          confirmLabel={t('barcodes.remove')}
          cancelLabel={t('common.cancel')}
          confirmVariant="danger"
          busy={removing}
          onConfirm={() => void remove(confirmRemoveId)}
          onCancel={() => setConfirmRemoveId(null)}
        />
      ) : null}
    </div>
  );
}
