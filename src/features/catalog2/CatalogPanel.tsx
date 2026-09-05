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
 * rather than reimplemented.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

import { Banner, Button, ConfirmDialog, Spinner } from '../../shared/components';
import { useI18n } from '../../shared/i18n';
import { useErrorText } from '../../shared/hooks/useErrorText';
import * as ipc from '../../shared/ipc/gateway';
import type {
  AttributeDefinition,
  ProductDetail,
  ReferenceLifecycleItem,
  UnitLifecycleItem,
  VariantDetail,
} from '../../shared/ipc/dto';
import { AttributeManagerForVariant } from '../products/ProductEditor';

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

  const [detail, setDetail] = useState<ProductDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [categories, setCategories] = useState<ReferenceLifecycleItem[]>([]);
  const [units, setUnits] = useState<UnitLifecycleItem[]>([]);
  const [attributes, setAttributes] = useState<AttributeDefinition[]>([]);
  const [refLoading, setRefLoading] = useState(true);

  const [openVariantId, setOpenVariantId] = useState<number | null>(initialVariantId ?? null);
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
              <div className="sk-catalog2__panel-variant-head">
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
          <h3>{t('variants.title')}</h3>
          {detail.variants.length === 0 ? (
            <Banner tone="info">{t('variants.empty')}</Banner>
          ) : detail.variants.map((variant) => {
            const open = openVariantId === variant.variant_id;
            return (
              <div className="sk-catalog2__panel-variant" key={variant.variant_id}>
                <div className="sk-catalog2__panel-variant-head">
                  <div>
                    <strong>{variant.effective_variant_name}</strong>{' '}
                    <span className="sk-catalog2__mono">{variant.operational_identifier}</span>{' '}
                    <span className={`sk-catalog2__pill ${variant.is_active ? 'sk-catalog2__pill--accent' : 'sk-catalog2__pill--neutral'}`}>
                      {variant.is_active ? t('catalog.active') : t('catalog.inactive')}
                    </span>
                  </div>
                  <div className="sk-catalog2__footer-actions">
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
    <>
      <button
        type="button"
        className="sk-catalog2__panel-backdrop"
        aria-label={t('common.close')}
        onClick={close}
        data-testid="catalog2-panel-backdrop"
      />
      <aside
        className="sk-catalog2__panel"
        role="dialog"
        aria-modal="false"
        aria-label={t('catalog2.panel')}
        data-testid="catalog2-panel"
      >
        <div className="sk-catalog2__panel-header">
          <h2 className="sk-catalog2__panel-title">{detail?.name ?? t('catalog2.panel')}</h2>
          <Button variant="secondary" type="button" onClick={close} data-testid="catalog2-panel-close">
            {t('common.close')}
          </Button>
        </div>
        {body}
      </aside>

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
    </>
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
        <ul className="sk-catalog2__panel-grid" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {variant.barcodes.map((b) => (
            <li key={b.id} className="sk-catalog2__panel-variant-head">
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

      <div className="sk-catalog2__field" style={{ marginBlockStart: '12px' }}>
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
      <div className="sk-catalog2__footer-actions" style={{ marginBlockStart: '8px' }}>
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
