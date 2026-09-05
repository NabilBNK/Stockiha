/**
 * WS-D-9 — the right slide-in detail panel (RULING 4).
 *
 * Everything that is not inline-editable in the table lives here: product
 * name, unit, category, active state, variant name overrides, attributes and
 * barcodes. The panel overlays the table; the table keeps full width when the
 * panel is closed, and is never permanently split.
 *
 * NO MODAL INSIDE THE PANEL. The only permitted overlay-on-overlay is
 * ConfirmDialog, which guards the destructive and structural actions
 * (RULING 6): deactivating a product, deactivating a variant, removing a
 * barcode. None of those autosave.
 *
 * Fields commit on blur (text) or on change (selects) — a select has no
 * half-typed intermediate state, so change IS the moment the user finished.
 * Nothing commits on a keystroke.
 *
 * CR2 REUSE. The attribute section renders `AttributeManagerForVariant` from
 * ProductEditor.tsx — the component that owns the `mergeAssignedValues`
 * wiring. That function merges a variant's already-assigned values into the
 * picker options so a variant holding a RETIRED value does not silently lose
 * it on the next save. Writing a fresh picker here instead would reintroduce
 * exactly that data-loss defect, so the existing component is reused whole
 * rather than reimplemented. A variant added through this panel gets the same
 * component, for the same reason.
 *
 * WS-D-9B adds the two things a catalogue cannot do without:
 *   - ADD VARIANT, inline in the variants section. `VariantInput` has no
 *     minimum_stock field, so a typed minimum stock is applied straight after
 *     through updateVariantV2 — silently dropping it would be data loss.
 *   - CREATE PRODUCT, as `CatalogCreatePanel`: the same slide-in panel in
 *     create mode, never a separate screen and never a modal. Creation is a
 *     DELIBERATE submit — a half-typed product is never autosaved into the
 *     catalogue, which is the one place on this page where commit-on-blur
 *     would be actively wrong.
 *
 * WS-D-10 — layout stability (RULINGS 3 and 5). A variant row is now a grid:
 * the name takes the remaining space and truncates, the identifier and status
 * each get their own slot, and the action group sits in a fixed slot at the
 * row's inline-end that never wraps. Before this, "Bed - M - Blue - AK Home"
 * pushed Open/Deactivate onto a second line while "Bed - M - Red" did not —
 * the name was allowed to shove the actions around. Spacing comes from the
 * page's scoped classes; the one-off inline margins are gone.
 */
import {
  useCallback,
  useEffect,
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
  AttributeDefinition,
  ProductDetail,
  ReferenceLifecycleItem,
  UnitLifecycleItem,
  VariantDetail,
  VariantInput,
} from '../../shared/ipc/dto';
import { AttributeManagerForVariant } from '../products/ProductEditor';
import { InlineCreateSelect } from '../products/InlineCreateSelect';
import { isValidMinimumStock, isValidPrice } from './catalogValidation';
import { useDecimalFormat } from './useDecimalFormat';

type FieldState = 'idle' | 'saving' | 'saved' | 'error';

/** Commit-on-blur text field. Never commits on a keystroke. */
function PanelField({
  id,
  label,
  value,
  commit,
  validate,
  testId,
}: {
  id: string;
  label: string;
  value: string;
  commit: (next: string) => Promise<void>;
  validate?: (next: string) => string | null;
  testId?: string;
}) {
  const errorText = useErrorText();
  const [lastGood, setLastGood] = useState(value);
  const [draft, setDraft] = useState(value);
  const [state, setState] = useState<FieldState>('idle');
  const [error, setError] = useState<string | null>(null);
  const savingRef = useRef(false);
  const dirty = draft !== lastGood;
  // Refs, not deps: this effect reacts to the SERVER value changing, never to
  // its own bookkeeping, and it must not clobber an edit in progress.
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  useEffect(() => {
    if (dirtyRef.current || savingRef.current) return;
    setLastGood(value);
    setDraft(value);
  }, [value]);

  const commitNow = useCallback(async () => {
    if (savingRef.current) return;
    const candidate = draft.trim();
    if (candidate === lastGood) {
      setDraft(candidate);
      setError(null);
      return;
    }
    const invalid = validate?.(candidate) ?? null;
    if (invalid) {
      setError(invalid);
      setState('error');
      return;
    }
    savingRef.current = true;
    setState('saving');
    setError(null);
    try {
      await commit(candidate);
      setLastGood(candidate);
      setDraft(candidate);
      setState('saved');
    } catch (err) {
      // Never show a value the database does not hold.
      setDraft(lastGood);
      setError(errorText(err));
      setState('error');
    } finally {
      savingRef.current = false;
    }
  }, [draft, lastGood, validate, commit, errorText]);

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      void commitNow();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setDraft(lastGood);
      setError(null);
      setState('idle');
    }
  }

  return (
    <div className="sk-catalog2__field">
      <label className="sk-catalog2__label" htmlFor={id}>{label}</label>
      <input
        id={id}
        className="sk-catalog2__input"
        value={draft}
        aria-invalid={state === 'error'}
        onChange={(e) => { setDraft(e.target.value); setState('idle'); setError(null); }}
        onBlur={() => void commitNow()}
        onKeyDown={onKeyDown}
        data-testid={testId}
      />
      <PanelStatus state={state} dirty={dirty} error={error} testId={testId} />
    </div>
  );
}

/** Commit-on-change select. */
function PanelSelect({
  id,
  label,
  value,
  options,
  emptyLabel,
  commit,
  testId,
}: {
  id: string;
  label: string;
  value: string;
  options: { value: string; label: string }[];
  emptyLabel?: string;
  commit: (next: string) => Promise<void>;
  testId?: string;
}) {
  const errorText = useErrorText();
  const [state, setState] = useState<FieldState>('idle');
  const [error, setError] = useState<string | null>(null);

  async function handleChange(next: string) {
    setState('saving');
    setError(null);
    try {
      await commit(next);
      setState('saved');
    } catch (err) {
      setError(errorText(err));
      setState('error');
    }
  }

  return (
    <div className="sk-catalog2__field">
      <label className="sk-catalog2__label" htmlFor={id}>{label}</label>
      <select
        id={id}
        className="sk-catalog2__select"
        value={value}
        aria-invalid={state === 'error'}
        onChange={(e) => void handleChange(e.target.value)}
        data-testid={testId}
      >
        {emptyLabel !== undefined ? <option value="">{emptyLabel}</option> : null}
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <PanelStatus state={state} dirty={false} error={error} testId={testId} />
    </div>
  );
}

function PanelStatus({
  state, dirty, error, testId,
}: {
  state: FieldState;
  dirty: boolean;
  error: string | null;
  testId?: string;
}) {
  const { t } = useI18n();
  if (state === 'error' && error) {
    return (
      <p className="sk-catalog2__status sk-catalog2__status--error" role="alert" data-testid={testId ? `${testId}-error` : undefined}>
        {error}
      </p>
    );
  }
  if (state === 'saving') {
    return <p className="sk-catalog2__status sk-catalog2__status--saving">{t('catalog2.saving')}</p>;
  }
  if (dirty) {
    return <p className="sk-catalog2__status sk-catalog2__status--saving">{t('catalog2.pending')}</p>;
  }
  if (state === 'saved') {
    return (
      <p className="sk-catalog2__status sk-catalog2__status--saved" data-testid={testId ? `${testId}-saved` : undefined}>
        {t('catalog2.saved')}
      </p>
    );
  }
  return null;
}

/**
 * The fields that describe one new variant. Shared by "add variant" and by the
 * first variant of a new product, so the two paths cannot drift apart.
 *
 * `minimumStock` seeds to "0" deliberately: "0" means "never warn me about
 * this item" (ws-d-skill.md section 3). It is a value, not a blank.
 */
export interface VariantDraft {
  nameOverride: string;
  barcode: string;
  salePrice: string;
  minimumStock: string;
  isActive: boolean;
}

export const EMPTY_VARIANT_DRAFT: VariantDraft = {
  nameOverride: '',
  barcode: '',
  salePrice: '',
  minimumStock: '0',
  isActive: true,
};

export function isVariantDraftValid(draft: VariantDraft): boolean {
  return isValidPrice(draft.salePrice) && isValidMinimumStock(draft.minimumStock);
}

function VariantDraftFields({
  idPrefix,
  draft,
  onChange,
  disabled,
  showActive = true,
}: {
  idPrefix: string;
  draft: VariantDraft;
  onChange: (next: VariantDraft) => void;
  disabled?: boolean;
  showActive?: boolean;
}) {
  const { t } = useI18n();
  const priceInvalid = draft.salePrice !== '' && !isValidPrice(draft.salePrice);
  const minInvalid = draft.minimumStock !== '' && !isValidMinimumStock(draft.minimumStock);

  function set(patch: Partial<VariantDraft>) {
    onChange({ ...draft, ...patch });
  }

  return (
    <div className="sk-catalog2__panel-grid">
      <TextField
        id={`${idPrefix}-name`}
        label={t('variants.name')}
        value={draft.nameOverride}
        placeholder={t('variants.namePlaceholder')}
        onChange={(e) => set({ nameOverride: e.target.value })}
        disabled={disabled}
        data-testid={`${idPrefix}-name`}
      />
      <TextField
        id={`${idPrefix}-barcode`}
        label={t('barcodes.barcode')}
        value={draft.barcode}
        placeholder={t('barcodes.placeholder')}
        onChange={(e) => set({ barcode: e.target.value })}
        disabled={disabled}
        data-testid={`${idPrefix}-barcode`}
      />
      <TextField
        id={`${idPrefix}-price`}
        label={`${t('variants.price')} (DZD)`}
        value={draft.salePrice}
        inputMode="decimal"
        onChange={(e) => set({ salePrice: e.target.value })}
        error={priceInvalid ? t('variants.invalidPrice') : undefined}
        required
        disabled={disabled}
        data-testid={`${idPrefix}-price`}
      />
      <div>
        <TextField
          id={`${idPrefix}-minimum-stock`}
          label={t('variants.minimumStock')}
          value={draft.minimumStock}
          inputMode="decimal"
          onChange={(e) => set({ minimumStock: e.target.value })}
          error={minInvalid ? t('variants.invalidMinimumStock') : undefined}
          required
          disabled={disabled}
          data-testid={`${idPrefix}-minimum-stock`}
        />
        <p className="sk-catalog2__note">{t('variants.minimumStockHint')}</p>
      </div>
      {showActive ? (
        <label className="sk-catalog2__checkbox">
          <input
            type="checkbox"
            checked={draft.isActive}
            onChange={(e) => set({ isActive: e.target.checked })}
            disabled={disabled}
            data-testid={`${idPrefix}-active`}
          />
          <span>{draft.isActive ? t('catalog.active') : t('catalog.inactive')}</span>
        </label>
      ) : null}
    </div>
  );
}

/**
 * The slide-in chrome, shared by edit mode and create mode so both are
 * literally the same panel rather than two things that look alike.
 */
function PanelShell({
  title,
  onClose,
  children,
  overlays,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  overlays?: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <>
      <button
        type="button"
        className="sk-catalog2__panel-backdrop"
        aria-label={t('common.close')}
        onClick={onClose}
        data-testid="catalog2-panel-backdrop"
      />
      <aside
        className="sk-catalog2__panel"
        role="dialog"
        aria-modal="false"
        aria-label={title}
        data-testid="catalog2-panel"
      >
        <div className="sk-catalog2__panel-header">
          <h2 className="sk-catalog2__panel-title sk-catalog2__truncate" title={title}>{title}</h2>
          <div className="sk-catalog2__actions">
            <Button variant="secondary" type="button" onClick={onClose} data-testid="catalog2-panel-close">
              {t('common.close')}
            </Button>
          </div>
        </div>
        {children}
      </aside>
      {overlays}
    </>
  );
}

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

export function CatalogPanel({
  token,
  productId,
  initialVariantId,
  onClose,
}: {
  token: string;
  productId: number;
  initialVariantId?: number | null;
  onClose: (changed: boolean) => void;
}) {
  const { t } = useI18n();
  const errorText = useErrorText();
  const format = useDecimalFormat();

  const [detail, setDetail] = useState<ProductDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [categories, setCategories] = useState<ReferenceLifecycleItem[]>([]);
  const [units, setUnits] = useState<UnitLifecycleItem[]>([]);
  const [attributes, setAttributes] = useState<AttributeDefinition[]>([]);
  const [refLoading, setRefLoading] = useState(true);

  const [openVariantId, setOpenVariantId] = useState<number | null>(initialVariantId ?? null);
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
      .then((d) => { if (active) { setDetail(d); detailRef.current = d; } })
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

  const handleSetAttributes = useCallback(async (variantId: number, sel: Record<number, number>) => {
    const ids = Object.values(sel).filter((id) => id > 0);
    await ipc.setVariantAttributes(token, variantId, ids);
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
   * Opening from a variant's row asks for THAT variant, not the product's
   * first one. It is already expanded via `openVariantId`; bring it into view
   * as well, or on a product with many variants the user is looking at the
   * top of a panel whose relevant part is off-screen. Guarded because jsdom
   * does not implement scrollIntoView.
   */
  const openVariantRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (initialVariantId == null || !detail) return;
    const node = openVariantRef.current;
    if (node && typeof node.scrollIntoView === 'function') {
      node.scrollIntoView({ block: 'nearest' });
    }
  }, [initialVariantId, detail]);

  /**
   * ADD VARIANT.
   *
   * `addVariant` takes a `VariantInput`, which has no minimum_stock field, so
   * the typed value is applied immediately afterwards through updateVariantV2.
   * That second call is unconditional and safe: the variant is brand new, so
   * every column in the payload is a value the operator just typed and there
   * is nothing pre-existing for it to overwrite. Making it conditional on
   * "the user changed it" would risk dropping a deliberate value.
   *
   * The two calls are not atomic. If the first succeeds and the second fails,
   * the variant genuinely exists — reporting "add failed" would be a lie that
   * leads to a duplicate — so that case is reported distinctly and the panel
   * still refreshes onto the new variant.
   *
   * A variant's uniqueness is its attribute signature, enforced in the
   * database. A rejection surfaces here as-is; nothing is pre-validated in
   * React, which could only ever guess.
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
      // The variant exists either way; a failed refresh must not read as a
      // failed add. The list reloads on close.
    }
    // Land on the new variant, expanded, so attributes and barcodes are one
    // click away rather than requiring a hunt.
    setOpenVariantId(newId);
    setAddingVariant(false);
    setAddDraft({ ...EMPTY_VARIANT_DRAFT });
    setAddBusy(false);
  }

  function close() {
    onClose(changedRef.current);
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

    body = (
      <>
        {actionError ? <Banner tone="error">{actionError}</Banner> : null}

        <section className="sk-catalog2__panel-section" aria-label={t('catalog2.panelProduct')}>
          <h3>{t('catalog2.panelProduct')}</h3>
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

        <section className="sk-catalog2__panel-section" aria-label={t('variants.title')}>
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
              succeeded but could not apply the minimum stock closes the form
              and must still be able to say so. */}
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
            const open = openVariantId === variant.variant_id;
            return (
              <div
                className="sk-catalog2__panel-variant"
                key={variant.variant_id}
                ref={variant.variant_id === initialVariantId ? openVariantRef : undefined}
              >
                {/* [ name (truncating) ][ identifier ][ status ][ actions ] —
                    the actions slot is fixed and never wraps. */}
                <div className="sk-catalog2__vrow">
                  <div className="sk-catalog2__vrow-main">
                    <strong
                      className="sk-catalog2__truncate sk-catalog2__vrow-name"
                      title={variant.effective_variant_name}
                    >
                      {variant.effective_variant_name}
                    </strong>
                    <span className="sk-catalog2__mono sk-catalog2__vrow-id">
                      {variant.operational_identifier}
                    </span>
                    <span className={`sk-catalog2__pill ${variant.is_active ? 'sk-catalog2__pill--accent' : 'sk-catalog2__pill--neutral'}`}>
                      {variant.is_active ? t('catalog.active') : t('catalog.inactive')}
                    </span>
                  </div>
                  <div className="sk-catalog2__actions">
                    <Button
                      type="button"
                      variant="secondary"
                      aria-expanded={open}
                      onClick={() => setOpenVariantId(open ? null : variant.variant_id)}
                      data-testid={`catalog2-panel-variant-toggle-${variant.variant_id}`}
                    >
                      {open ? t('variants.collapse') : t('variants.expand')}
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

                {/* Read-only summary of what the table lets you edit inline,
                    formatted the same way it is there. */}
                <div className="sk-catalog2__vrow-figures">
                  <span>
                    {t('variants.price')}: <strong>{format(variant.sale_price)}</strong>
                  </span>
                  <span>
                    {t('variants.minimumStock')}: <strong>{format(variant.minimum_stock)}</strong>
                  </span>
                </div>

                {open ? (
                  <div className="sk-catalog2__panel-variant-body">
                    <div className="sk-catalog2__panel-grid">
                      <PanelField
                        id={`catalog2-panel-variant-name-${variant.variant_id}`}
                        label={t('variants.name')}
                        value={variant.name_override ?? ''}
                        commit={(v) => commitVariant(variant.variant_id, { nameOverride: v || null })}
                        testId={`catalog2-panel-variant-name-${variant.variant_id}`}
                      />
                    </div>

                    {/* CR2: mergeAssignedValues wiring, reused whole. */}
                    <div className="sk-catalog2__panel-variant-body">
                      <AttributeManagerForVariant
                        attributes={attributes}
                        refLoading={refLoading}
                        variant={variant}
                        onSetAttributes={(sel) => handleSetAttributes(variant.variant_id, sel)}
                        onCreateAttribute={handleCreateAttribute}
                        onAddValue={handleAddValue}
                      />
                    </div>

                    <div className="sk-catalog2__panel-variant-body">
                      <BarcodeSection
                        token={token}
                        variant={variant}
                        busy={busy}
                        onChanged={async () => {
                          changedRef.current = true;
                          await refresh();
                        }}
                      />
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </section>
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

/**
 * WS-D-9B — CREATE PRODUCT, in the same slide-in panel.
 *
 * The one place on this page where commit-on-blur would be actively wrong.
 * Everywhere else a field describes a row that already exists, so writing it
 * the moment the user finishes is right. Here there is no row yet, and
 * autosaving a half-typed name would put a nameless, priceless product into a
 * live catalogue that someone then has to find and clean up. Creation is
 * therefore a DELIBERATE submit: nothing reaches the backend until the button
 * is pressed.
 *
 * `catalog.quick_create_product` creates the product AND its first variant in
 * one authoritative call, carrying the product-level category and the
 * variant's barcode and minimum stock. Further variants come from the add
 * form in CatalogPanel.
 *
 * The category and unit pickers use `InlineCreateSelect` from the products
 * feature — the create-only shortcut locked by the D-0 ruling: this form may
 * add a reference item and select it immediately, and nothing more. Rename,
 * deactivate and delete stay on Catalogue Setup.
 */
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
    <PanelShell title={t('catalog2.createTitle')} onClose={onClose}>
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
          <Button variant="secondary" type="button" onClick={onClose} disabled={submitting}>
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
