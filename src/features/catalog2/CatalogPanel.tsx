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
 * attributeSelection.tsx — the component that owns the `mergeAssignedValues`
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
 * silently would be data loss. WS-D-11B (C3) moved the add-variant FORM into
 * the detail column — the list column stays a pure list, and creating and
 * editing a variant now happen in the same place. The "+ Add variant" trigger
 * stays in the list, matching ordinary list-detail UX ("+" adds, opens in the
 * detail pane).
 *
 * CREATE PRODUCT — `CatalogCreatePanel`, the same panel in create mode. A
 * deliberate submit, never autosave: there is no row yet, so a half-typed
 * product would be a nameless, priceless row in a live catalogue. R15 keeps a
 * discard guard there and, deliberately, nowhere else — the edit side commits
 * as you go, so there is nothing to lose.
 *
 * WS-D-11B corrections to the two-column shape:
 *   C1 — a client-side search over the CURRENT product's already-loaded
 *     variants, filtering by name, SKU, barcode and attribute combination.
 *     No IPC call: these variants are already in memory.
 *   C2 — a variant row IS the selection control. Clicking anywhere on it
 *     selects it; there is no separate "Edit" button. The list is a
 *     listbox-style single-select (`role="listbox"`/`"option"`,
 *     `aria-selected`, arrow-key navigation). Deactivate is destructive, so it
 *     moved OUT of the row — which exists to select, not to be misclicked —
 *     into the detail column's header, acting on whichever variant is
 *     currently selected.
 *   C4/C5 — the detail column's field order is now: header (name, status,
 *     Deactivate) → SKU → Barcodes → Sale price + Minimum stock (editable) →
 *     Variant name → Attributes. Price and minimum stock are editable here
 *     AND in the table; both call `commitVariantFields` in `variantCommit.ts`
 *     — see that file for why this is the one place the payload is built.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

import { Banner, Button, ConfirmDialog, Spinner, TextField } from '../../shared/components';
import { useI18n } from '../../shared/i18n';
import { useErrorText } from '../../shared/hooks/useErrorText';
import * as ipc from '../../shared/ipc/gateway';
import type {
  AltUnitConversionDirection,
  AttributeDefinition,
  ProductDetail,
  ReferenceLifecycleItem,
  UnitLifecycleItem,
  VariantDetail,
  VariantInput,
} from '../../shared/ipc/dto';
import { AttributeManagerForVariant } from './attributeSelection';
import { BulkVariantGenerator } from './BulkVariantGenerator';
import { InlineCreateSelect } from './InlineCreateSelect';
import { PanelField, PanelSelect } from './PanelFields';
import { PanelShell, usePanelNarrow } from './PanelShell';
import { VariantEditor, VariantEditorEmpty } from './VariantEditor';
import { commitVariantFields, type VariantFieldPatch } from './variantCommit';
import {
  EMPTY_VARIANT_DRAFT,
  VariantDraftFields,
  isVariantDraftValid,
  type VariantDraft,
} from './VariantDraftFields';
import { useDecimalFormat } from './useDecimalFormat';
import { formatExactDecimal, isExactDecimalPositive } from '../inventory/exactDecimal';

/**
 * P1 (WS-D-8b pre-phase) — a stable, empty `VariantDetail` shape handed to
 * `AttributeManagerForVariant` while creating a product's first variant.
 *
 * `mergeAssignedValues` only does anything when `variant.attributes` is
 * non-empty, so an empty array is always safe here — there is no variant yet.
 * The object identity must stay stable across renders: the component reseeds
 * its internal selection from `variant` in a `useEffect` keyed on that
 * reference, so a fresh object on every keystroke (e.g. from `salePrice`
 * changing) would silently wipe out attribute values the operator just
 * picked. A module-level constant, not `useMemo`, is what actually guarantees
 * that stability.
 */
const DRAFT_ATTRIBUTE_VARIANT: VariantDetail = {
  variant_id: 0,
  sku: '',
  name_override: null,
  effective_variant_name: '',
  primary_barcode: null,
  operational_identifier: '',
  identifier_type: 'SKU',
  sale_price: '0',
  minimum_stock: '0',
  is_active: true,
  attribute_signature: '',
  attributes: [],
  barcodes: [],
};

interface ProductPatch {
  name?: string;
  unitId?: number;
  isActive?: boolean;
  categoryId?: number | null;
}

type PanelTab = 'variants' | 'product';

/**
 * WS-D-11B C1 — client-side search over one product's already-loaded
 * variants. Never an IPC call: this product's variants are already in
 * memory, and the target scale (a handful to a few dozen variants per
 * product) is exactly what a substring scan over an array is for.
 */
function matchesVariantSearch(variant: VariantDetail, query: string): boolean {
  const combo = variant.attributes.map((a) => a.value).join(' · ');
  const haystack = [
    variant.effective_variant_name,
    variant.name_override ?? '',
    variant.sku,
    combo,
    ...variant.barcodes.map((b) => b.barcode),
  ].join(' ').toLowerCase();
  return haystack.includes(query);
}

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
  // C1: filters the CURRENT product's already-loaded variants. Client-side —
  // never an IPC call.
  const [variantSearch, setVariantSearch] = useState('');
  const [addingVariant, setAddingVariant] = useState(false);
  // Part 2 (WS-D-8b) — bulk variant generation occupies the detail column the
  // same way adding one variant does; exactly one of the two is ever active.
  const [generatingVariants, setGeneratingVariants] = useState(false);
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

  /**
   * THE OVERWRITE TRAP — variant half. Same rule, four columns, built by the
   * SAME `commitVariantFields` the table's inline cells call (variantCommit.ts)
   * — see "Panel/table edit parity" in the WS-D-11B report for the proof this
   * cannot drift from the table's payload.
   */
  const commitVariant = useCallback((variantId: number, patch: VariantFieldPatch) => {
    const run = chain.current.catch(() => {}).then(async () => {
      const d = detailRef.current;
      const v = d?.variants.find((x) => x.variant_id === variantId);
      if (!v) return;
      await commitVariantFields(token, variantId, v, patch);
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

  // C1 — filtered view of this product's variants. Nothing server-side.
  const filteredVariants = useMemo(() => {
    const all = detail?.variants ?? [];
    const query = variantSearch.trim().toLowerCase();
    if (!query) return all;
    return all.filter((v) => matchesVariantSearch(v, query));
  }, [detail, variantSearch]);

  /**
   * C2 — clicking a row (or selecting via arrow keys) IS the selection
   * control; there is no separate Edit button. Selecting always cancels an
   * in-progress add, since a click on an existing variant clearly means the
   * operator wants that one instead.
   */
  const selectVariant = useCallback((variantId: number) => {
    setAddingVariant(false);
    setGeneratingVariants(false);
    setSelectedVariantId(variantId);
  }, []);

  /** C2 — arrow-key navigation over the listbox, matching the chip pattern. */
  function handleListKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    if (filteredVariants.length === 0) return;
    event.preventDefault();
    const currentIndex = filteredVariants.findIndex((v) => v.variant_id === selectedVariantId);
    let nextIndex: number;
    if (currentIndex === -1) {
      nextIndex = event.key === 'ArrowDown' ? 0 : filteredVariants.length - 1;
    } else if (event.key === 'ArrowDown') {
      nextIndex = Math.min(filteredVariants.length - 1, currentIndex + 1);
    } else {
      nextIndex = Math.max(0, currentIndex - 1);
    }
    selectVariant(filteredVariants[nextIndex].variant_id);
  }

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
    // C3 — adding a variant occupies the detail column too, so it counts as
    // "detail active" the same way an actual selection does. Part 2 —
    // generating variants in bulk does too.
    const detailActive = addingVariant || generatingVariants || selectedVariantId != null;
    const showList = !narrow || !detailActive;
    const showDetail = !narrow || detailActive;

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
                </div>

                {/* C1 — client-side search over this product's already-loaded
                    variants. Above "+ Add variant", not autofocused: the
                    panel opens for editing, not searching. */}
                <div className="sk-catalog2__field">
                  <label className="sk-catalog2__label" htmlFor="catalog2-variant-search">
                    {t('catalog2.searchVariants')}
                  </label>
                  <input
                    id="catalog2-variant-search"
                    className="sk-catalog2__input"
                    type="search"
                    value={variantSearch}
                    onChange={(e) => setVariantSearch(e.target.value)}
                    placeholder={t('catalog2.searchVariantsPlaceholder')}
                    data-testid="catalog2-variant-search"
                  />
                </div>

                <div className="sk-catalog2__actions sk-catalog2__actions--end">
                  <Button
                    type="button"
                    variant="secondary"
                    aria-expanded={addingVariant}
                    onClick={() => {
                      setGeneratingVariants(false);
                      setAddDraft({ ...EMPTY_VARIANT_DRAFT });
                      setAddError(null);
                      setAddingVariant((prev) => !prev);
                    }}
                    data-testid="catalog2-add-variant-toggle"
                  >
                    {addingVariant ? t('common.cancel') : `+ ${t('variants.add')}`}
                  </Button>
                  {/* Part 2 (WS-D-8b) — bulk creation from an attribute grid,
                      alongside adding one variant at a time. */}
                  <Button
                    type="button"
                    variant="secondary"
                    aria-expanded={generatingVariants}
                    onClick={() => {
                      setAddingVariant(false);
                      setGeneratingVariants((prev) => !prev);
                    }}
                    data-testid="catalog2-generate-variants-toggle"
                  >
                    {generatingVariants ? t('common.cancel') : t('catalog2.bulkTitle')}
                  </Button>
                </div>

                {/* C3 — makes it obvious no existing variant is selected while
                    a new one is being drafted in the detail column. */}
                {addingVariant ? (
                  <p className="sk-catalog2__note" data-testid="catalog2-adding-variant-hint">
                    {t('catalog2.addingVariantHint')}
                  </p>
                ) : null}
                {generatingVariants ? (
                  <p className="sk-catalog2__note" data-testid="catalog2-generating-variant-hint">
                    {t('catalog2.addingVariantHint')}
                  </p>
                ) : null}

                {detail.variants.length === 0 ? (
                  <Banner tone="info">{t('variants.empty')}</Banner>
                ) : filteredVariants.length === 0 ? (
                  <p className="sk-catalog2__note" data-testid="catalog2-variant-no-matches">
                    {t('catalog2.noVariantMatches')}
                  </p>
                ) : (
                  // C2 — a listbox-style single-select. The row itself IS the
                  // selection control; there is no separate Edit button, and
                  // no button lives inside it that a long name could shove
                  // around (WS-D-10's layout rule, satisfied trivially here).
                  <div
                    className="sk-catalog2__vlist-items"
                    role="listbox"
                    aria-label={t('variants.title')}
                    tabIndex={0}
                    onKeyDown={handleListKeyDown}
                    data-testid="catalog2-variant-listbox"
                  >
                    {filteredVariants.map((variant) => {
                      const attrs = variant.attributes.map((a) => a.value).join(' \u00b7 ');
                      const selected = !addingVariant && !generatingVariants && variant.variant_id === selectedVariantId;
                      const stock = stockByVariant?.[variant.variant_id];
                      return (
                        <div
                          key={variant.variant_id}
                          role="option"
                          aria-selected={selected}
                          className={`sk-catalog2__panel-variant${selected ? ' sk-catalog2__panel-variant--selected' : ''}`}
                          onClick={() => selectVariant(variant.variant_id)}
                          data-testid={`catalog2-variant-row-${variant.variant_id}`}
                        >
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
                )}
              </div>
            ) : null}

            {showDetail ? (
              <div className="sk-catalog2__vdetail" data-testid="catalog2-variant-detail">
                {narrow ? (
                  <div className="sk-catalog2__actions">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => {
                        setAddingVariant(false);
                        setGeneratingVariants(false);
                        setSelectedVariantId(null);
                      }}
                      data-testid="catalog2-variant-back"
                    >
                      {t('catalog.backToList')}
                    </Button>
                  </div>
                ) : null}

                {/* C3 — the add-variant FORM lives here, in the detail
                    column, replacing whatever else it would show. Creating
                    and editing a variant now happen in the same place. */}
                {addingVariant ? (
                  <form
                    className="sk-catalog2__panel-variant-body"
                    onSubmit={submitAddVariant}
                    aria-label={t('catalog2.addVariantTitle')}
                    data-testid="catalog2-add-variant-form"
                  >
                    <h3>{t('catalog2.addVariantTitle')}</h3>
                    {addError ? <Banner tone="error" testId="catalog2-add-variant-error">{addError}</Banner> : null}
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
                ) : generatingVariants ? (
                  /* Part 2 (WS-D-8b) — bulk creation from an attribute grid,
                     replacing whatever else the detail column would show,
                     exactly like the add-variant form above. */
                  <BulkVariantGenerator
                    token={token}
                    productId={productId}
                    attributes={attributes}
                    refLoading={refLoading}
                    existingVariants={detail.variants}
                    onCancel={() => setGeneratingVariants(false)}
                    onCreated={async () => {
                      changedRef.current = true;
                      await refresh();
                    }}
                  />
                ) : selectedVariant ? (
                  <VariantEditor
                    key={selectedVariant.variant_id}
                    variant={selectedVariant}
                    attributes={attributes}
                    refLoading={refLoading}
                    stock={stockByVariant?.[selectedVariant.variant_id]}
                    busy={busy}
                    onCommitName={(nameOverride) =>
                      commitVariant(selectedVariant.variant_id, { nameOverride })}
                    onCommitPrice={(salePrice) =>
                      commitVariant(selectedVariant.variant_id, { salePrice })}
                    onCommitMinimumStock={(minimumStock) =>
                      commitVariant(selectedVariant.variant_id, { minimumStock })}
                    onDeactivate={() => setConfirmVariantDeactivate(selectedVariant)}
                    onActivate={() =>
                      void runAction(() => ipc.setVariantActive(token, selectedVariant.variant_id, true))}
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
                    altUnits={(
                      <AlternateUnitsSection
                        token={token}
                        variant={selectedVariant}
                        units={units}
                        baseUnitCode={detail.unit_code}
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
  /**
   * P1 — `warning` is set when `quickCreateProduct` succeeded but the
   * attribute assignment that followed it did not. The product exists either
   * way, so this is never a failure signal — see `submit` below.
   */
  onCreated: (productId: number, warning?: string) => void;
}) {
  const { t } = useI18n();
  const errorText = useErrorText();

  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [unitId, setUnitId] = useState<number | null>(null);
  const [isActive, setIsActive] = useState(true);
  const [draft, setDraft] = useState<VariantDraft>({ ...EMPTY_VARIANT_DRAFT });
  // P1 — attribute_id -> attribute_value_id, staged locally until the product
  // (and its first variant) exist. See `submit`: quickCreateProduct returns
  // the new variant_id, and only THEN can setVariantAttributes be called.
  const [attrSelection, setAttrSelection] = useState<Record<number, number>>({});

  const [categories, setCategories] = useState<ReferenceLifecycleItem[]>([]);
  const [units, setUnits] = useState<UnitLifecycleItem[]>([]);
  const [attributes, setAttributes] = useState<AttributeDefinition[]>([]);
  const [refLoading, setRefLoading] = useState(true);
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
    || draft.minimumStock !== EMPTY_VARIANT_DRAFT.minimumStock
    || Object.keys(attrSelection).length > 0;

  function requestClose() {
    if (dirty && !submitting) {
      setConfirmDiscard(true);
      return;
    }
    onClose();
  }

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
      setUnitId((current) => current ?? us.find((u) => u.is_active)?.id ?? null);
    } catch {
      // The pickers stay empty; the form still reports its own submit errors.
    } finally {
      setRefLoading(false);
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
   *
   * WS-D-13 Phase A: this shortcut has no room to ask whether the new unit
   * takes decimals, so it passes `true` — the same permissive value as the
   * column default. Tightening it to whole-number-only is a deliberate choice
   * made on Catalogue Setup, where the toggle and its explanation live. The
   * permissive direction is the safe one to default to: it blocks nothing the
   * operator has not explicitly asked to have blocked.
   */
  const createUnit = useCallback(async (label: string) => {
    const id = await ipc.createUnit(token, label, label, true);
    await loadRefData();
    return id;
  }, [token, loadRefData]);

  const canSubmit = name.trim().length > 0
    && unitId != null
    && isVariantDraftValid(draft)
    && !submitting;

  const handleCreateAttribute = useCallback(async (attrName: string) => {
    const id = await ipc.createAttribute(token, attrName);
    await loadRefData();
    return id;
  }, [token, loadRefData]);

  const handleAddValue = useCallback(async (attributeId: number, value: string) => {
    const id = await ipc.addAttributeValue(token, attributeId, value);
    await loadRefData();
    return id;
  }, [token, loadRefData]);

  /**
   * P1 — the picker only stages a local selection (`setAttrSelection`); it
   * never calls the backend directly, because there is no variant to attach
   * values to until `quickCreateProduct` returns one below.
   */
  const handleStageAttributes = useCallback(async (sel: Record<number, number>) => {
    setAttrSelection(sel);
  }, []);

  /**
   * P1 — ORDERING CONSTRAINT. `quickCreateProduct` creates the product and its
   * first variant in one call and returns `variant_id`; only then can
   * `setVariantAttributes` run.
   *
   * THE TWO CALLS ARE NOT ATOMIC. If `quickCreateProduct` succeeds and
   * `setVariantAttributes` then fails, the product EXISTS — reporting
   * "create failed" here would send the operator to create a duplicate. So,
   * matching the existing add-variant/minimum-stock partial-failure pattern
   * (`submitAddVariant` above), a failed attribute assignment is reported as
   * exactly that, and the operator still lands on the new product to retry
   * from there.
   */
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit || unitId == null) {
      setError(t('errors.validation'));
      return;
    }
    setSubmitting(true);
    setError(null);
    let created: { product_id: number; variant_id: number };
    try {
      created = await ipc.quickCreateProduct(token, {
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
    } catch (err) {
      setError(errorText(err));
      setSubmitting(false);
      return;
    }

    const attributeValueIds = Object.values(attrSelection).filter((id) => id > 0);
    if (attributeValueIds.length > 0) {
      try {
        await ipc.setVariantAttributes(token, created.variant_id, attributeValueIds);
      } catch (err) {
        setSubmitting(false);
        onCreated(created.product_id, `${t('catalog2.createdAttributesNotApplied')} ${errorText(err)}`);
        return;
      }
    }

    setSubmitting(false);
    onCreated(created.product_id);
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

        {/* P1 — the same picker used everywhere else (CR2). Staged locally;
            applied to the real variant only after quickCreateProduct returns
            its id, in `submit` above. */}
        <section
          className="sk-catalog2__panel-section"
          aria-label={t('attrs.title')}
          data-testid="catalog2-create-attributes"
        >
          <AttributeManagerForVariant
            attributes={attributes}
            refLoading={refLoading}
            variant={DRAFT_ATTRIBUTE_VARIANT}
            onSetAttributes={handleStageAttributes}
            onCreateAttribute={handleCreateAttribute}
            onAddValue={handleAddValue}
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
 * WS-D-13 Phase B / WS-D-14 Part 2 — alternate units for ONE variant ("a BOX
 * that equals 6 pieces, or 50 Kg").
 *
 * Conversions are PER VARIANT and stay that way: a box of pillows and a box
 * of nails hold different counts, so a global "BOX = 6" would be wrong.
 *
 * DIRECTION (WS-D-14 Part 2). The Owner phrases these as "the main unit is
 * BOX, and alternative is pieces, and 1 box = 10 pieces" — the "1" can land
 * on EITHER side. Deriving one direction from the other by dividing in React
 * is exactly the trap this feature exists to avoid: "1 BOX = 3 PIECE" divided
 * would store "0.333333 BOX = 1 PIECE", a number the operator never typed.
 * So the operator picks which side is "1" (the swap button below), types the
 * quantity for the OTHER side, and that exact string is what gets sent and
 * what gets displayed back — never a computed reciprocal. `conversion_factor`
 * still exists on the wire (for the three transaction-time functions this
 * task does not touch) but nothing here reads it for display.
 *
 * `conversion_quantity` is an exact-decimal STRING end to end. Nothing here
 * parses it, rounds it or does arithmetic on it; `isExactDecimalPositive`
 * checks the string shape, which is what rejects a blank or a zero before
 * anything is sent.
 *
 * THE RULES LIVE IN SQL, NOT HERE. `catalog.add_variant_alt_unit` already
 * rejects a unit equal to the variant's base unit, a non-positive quantity,
 * and a duplicate unit for the same variant. This component does not restate
 * any of that — the base unit in particular is a variant-level column this
 * payload does not carry, so re-deriving it in React would be guesswork. The
 * backend decides and its rejection is surfaced through `useErrorText`, the
 * one path this codebase allows (raw diagnostics never reach the UI).
 *
 * Removing a conversion is structural, so it is confirmed (RULING 6), exactly
 * like removing a barcode.
 */
function AlternateUnitsSection({
  token,
  variant,
  units,
  baseUnitCode,
  busy,
  onChanged,
}: {
  token: string;
  variant: VariantDetail;
  units: UnitLifecycleItem[];
  /** The product's unit code, for the "1 BOX = 10 PIECE" reading. */
  baseUnitCode: string;
  busy: boolean;
  onChanged: () => Promise<void>;
}) {
  const { t } = useI18n();
  const errorText = useErrorText();
  const [unitId, setUnitId] = useState('');
  // Default matches the column default and the legacy meaning: "1 <alt> =
  // quantity <base>".
  const [direction, setDirection] = useState<AltUnitConversionDirection>('ALT_TO_BASE');
  const [quantity, setQuantity] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<number | null>(null);
  const [removing, setRemoving] = useState(false);

  // `?? []`: a build running one migration behind receives no alt_units key.
  const altUnitRows = variant.alt_units ?? [];
  // Only active units may be newly assigned. Units this variant already uses
  // are excluded from the picker because the backend rejects a duplicate
  // anyway; offering them would be offering a guaranteed error.
  const assigned = new Set(altUnitRows.map((a) => a.unit_id));
  const options = units.filter((u) => u.is_active && !assigned.has(u.id));
  const selectedUnitCode = options.find((u) => String(u.id) === unitId)?.code;

  const quantityValid = isExactDecimalPositive(quantity.trim());
  const canAdd = unitId !== '' && quantityValid && !adding && !busy;

  /** "1 <left> = <right unit>", the unit that reads as "1" for this direction. */
  function sides(dir: AltUnitConversionDirection, altCode: string): { left: string; right: string } {
    return dir === 'BASE_TO_ALT' ? { left: baseUnitCode, right: altCode } : { left: altCode, right: baseUnitCode };
  }

  async function add() {
    if (!canAdd) return;
    setAdding(true);
    setError(null);
    try {
      await ipc.addVariantAltUnit(token, variant.variant_id, Number(unitId), direction, quantity.trim());
      setUnitId('');
      setDirection('ALT_TO_BASE');
      setQuantity('');
      await onChanged();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setAdding(false);
    }
  }

  async function remove(variantUnitId: number) {
    setRemoving(true);
    setError(null);
    try {
      await ipc.removeVariantAltUnit(token, variantUnitId);
      setConfirmRemoveId(null);
      await onChanged();
    } catch (err) {
      setError(errorText(err));
      setConfirmRemoveId(null);
    } finally {
      setRemoving(false);
    }
  }

  const confirmTarget = altUnitRows.find((a) => a.id === confirmRemoveId) ?? null;
  const confirmSides = confirmTarget ? sides(confirmTarget.conversion_direction, confirmTarget.unit_code) : null;

  return (
    <div>
      {error ? <Banner tone="error" testId="catalog2-alt-unit-error">{error}</Banner> : null}

      {/* B3 — these conversions are DEFINABLE and VISIBLE only. Nothing in
          Stock Receipt, Purchases or POS applies them yet, and the UI must
          not imply otherwise. */}
      <p className="sk-catalog2__note">{t('catalog2.altUnitsNotAppliedYet')}</p>

      {altUnitRows.length === 0 ? (
        <p className="sk-catalog2__note" data-testid={`catalog2-alt-units-empty-${variant.variant_id}`}>
          {t('catalog2.altUnitsEmpty')}
        </p>
      ) : (
        <ul className="sk-catalog2__barcode-list">
          {altUnitRows.map((alt) => {
            const row = sides(alt.conversion_direction, alt.unit_code);
            return (
              <li key={alt.id} className="sk-catalog2__barcode-row">
                <span data-testid={`catalog2-alt-unit-${alt.id}`} data-direction={alt.conversion_direction}>
                  {t('catalog2.altUnitSentence', {
                    left: row.left,
                    quantity: formatExactDecimal(alt.conversion_quantity),
                    right: row.right,
                  })}
                </span>
                <Button
                  type="button"
                  variant="danger"
                  disabled={busy || removing}
                  onClick={() => setConfirmRemoveId(alt.id)}
                  data-testid={`catalog2-remove-alt-unit-${alt.id}`}
                >
                  {t('barcodes.remove')}
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="sk-catalog2__panel-grid">
        <div className="sk-catalog2__field">
          <label className="sk-catalog2__label" htmlFor={`catalog2-alt-unit-select-${variant.variant_id}`}>
            {t('catalog2.altUnitUnit')}
          </label>
          <select
            id={`catalog2-alt-unit-select-${variant.variant_id}`}
            className="sk-catalog2__select"
            value={unitId}
            onChange={(e) => setUnitId(e.target.value)}
            disabled={adding || busy}
            data-testid={`catalog2-alt-unit-select-${variant.variant_id}`}
          >
            <option value="">{t('common.none')}</option>
            {options.map((u) => (
              <option key={u.id} value={u.id}>{u.code} — {u.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* The relationship, in plain language, units named — never abstract.
          Only shown once a unit is picked: before that there is nothing to
          name on the alternate side. */}
      {selectedUnitCode ? (
        <div className="sk-catalog2__field">
          <span className="sk-catalog2__label">{t('catalog2.altUnitRelationship')}</span>
          <div
            className="sk-catalog2__alt-unit-sentence"
            data-testid={`catalog2-alt-unit-sentence-${variant.variant_id}`}
            data-direction={direction}
          >
            <span>1 {sides(direction, selectedUnitCode).left} =</span>
            <input
              id={`catalog2-alt-unit-quantity-${variant.variant_id}`}
              className="sk-catalog2__input"
              inputMode="decimal"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              disabled={adding || busy}
              aria-label={t('catalog2.altUnitQuantity')}
              aria-invalid={quantity.trim() !== '' && !quantityValid}
              data-testid={`catalog2-alt-unit-quantity-${variant.variant_id}`}
            />
            <span>{sides(direction, selectedUnitCode).right}</span>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setDirection((d) => (d === 'BASE_TO_ALT' ? 'ALT_TO_BASE' : 'BASE_TO_ALT'))}
              disabled={adding || busy}
              data-testid={`catalog2-alt-unit-direction-toggle-${variant.variant_id}`}
            >
              {t('catalog2.altUnitSwapDirection')}
            </Button>
          </div>
          {quantity.trim() !== '' && !quantityValid ? (
            <p
              className="sk-catalog2__status sk-catalog2__status--error"
              role="alert"
              data-testid={`catalog2-alt-unit-quantity-error-${variant.variant_id}`}
            >
              {t('catalog2.altUnitInvalidQuantity')}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="sk-catalog2__actions sk-catalog2__actions--end">
        <Button
          type="button"
          loading={adding}
          disabled={!canAdd}
          onClick={() => void add()}
          data-testid={`catalog2-add-alt-unit-${variant.variant_id}`}
        >
          {t('catalog2.altUnitAdd')}
        </Button>
      </div>

      {confirmTarget && confirmSides ? (
        <ConfirmDialog
          title={t('catalog2.altUnitConfirmRemoveTitle')}
          body={t('catalog2.altUnitConfirmRemoveBody', {
            left: confirmSides.left,
            quantity: formatExactDecimal(confirmTarget.conversion_quantity),
            right: confirmSides.right,
          })}
          confirmLabel={t('barcodes.remove')}
          cancelLabel={t('common.cancel')}
          confirmVariant="danger"
          busy={removing}
          onConfirm={() => void remove(confirmTarget.id)}
          onCancel={() => setConfirmRemoveId(null)}
        />
      ) : null}
    </div>
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
