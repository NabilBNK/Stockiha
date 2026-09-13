/**
 * Slice 1 — opening/emergency stock receipt. Selects a warehouse + variant,
 * enters quantity and unit acquisition cost, shows a PROVISIONAL total
 * (display only — WAC and the posted result are backend-authoritative),
 * generates one client request id per intended submission (reused on retry,
 * regenerated when inputs change), and prevents duplicate submits. Distinct
 * outcomes (success / validation / permission / closed period / uncertain
 * retry) are surfaced clearly.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';

import { Banner, Button, TextField } from '../../shared/components';
import { useI18n } from '../../shared/i18n';
import { codeForError, useErrorText } from '../../shared/hooks/useErrorText';
import { useSession } from '../../shared/session/SessionContext';
import { useAppData } from '../../app/AppDataContext';
import * as ipc from '../../shared/ipc/gateway';
import type { StockReceiptResult } from '../../shared/ipc/dto';
import { formatExactDecimal, isExactDecimalZero, isQuantityValidForUnit } from './exactDecimal';
import { useUnitFractionRules } from './useUnitFractionRules';
import { PurchaseItemPicker, type GenericPickerItem } from '../procurement/PurchaseItemPicker';
import { PROCUREMENT_COPY } from '../procurement/procurementCopy';
import '../procurement/procurement.css';

const QTY_RE = /^\d+(\.\d{1,3})?$/;
const COST_RE = /^\d+(\.\d{1,2})?$/;

export function StockReceiptScreen() {
  const { t, locale } = useI18n();
  const text = PROCUREMENT_COPY[locale];
  const { user } = useSession();
  const { warehouses, selectedWarehouseId, selectWarehouse, openFiscalPeriod } = useAppData();
  const errorText = useErrorText();
  const token = user?.token ?? '';

  const [variants, setVariants] = useState<GenericPickerItem[]>([]);
  const [variantId, setVariantId] = useState<number | null>(null);
  const [quantity, setQuantity] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [requestId, setRequestId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<StockReceiptResult | null>(null);
  const [banner, setBanner] = useState<{ tone: 'success' | 'error' | 'warning'; text: string } | null>(null);

  // Fast item entry / picker state
  const [pickerOpen, setPickerOpen] = useState(false);
  const [barcodeInput, setBarcodeInput] = useState('');
  const [barcodeError, setBarcodeError] = useState<string | null>(null);
  const barcodeInputRef = useRef<HTMLInputElement | null>(null);
  const quantityInputRef = useRef<HTMLInputElement | null>(null);

  /**
   * WS-D-13 Phase A. This screen posts in the variant's BASE unit, and
   * `ProductListItem` carries no unit at all, so the unit is looked up per
   * selection. `inventory.list_stock_adjustment_units` is variant-scoped and
   * already returns the base unit flagged `is_base`, so NO backend change was
   * needed; `useUnitFractionRules` then supplies that unit's allows_fractions.
   * Null while unknown — an unknown unit must never block a quantity.
   */
  const [baseUnit, setBaseUnit] = useState<{ id: number; code: string } | null>(null);
  const { allowsFractionsById } = useUnitFractionRules(token);

  useEffect(() => {
    if (!token || variantId == null) {
      setBaseUnit(null);
      return;
    }
    let active = true;
    void ipc.listStockAdjustmentUnits(token, variantId)
      .then((variantUnits) => {
        if (!active) return;
        const base = variantUnits.find((u) => u.is_base);
        setBaseUnit(base ? { id: base.unit_id, code: base.unit_code } : null);
      })
      .catch(() => {
        // Guidance only: failing to learn the unit must never stop a receipt.
        if (active) setBaseUnit(null);
      });
    return () => { active = false; };
  }, [token, variantId]);

  // Format first, then unit fitness, so a typo reads as a typo rather than as
  // a confusing message about the unit.
  const baseUnitAllowsFractions = allowsFractionsById(baseUnit?.id);
  const quantityUnitError = quantity !== ''
    && QTY_RE.test(quantity)
    && baseUnit != null
    && baseUnitAllowsFractions === false
    && !isQuantityValidForUnit(quantity, false)
    ? t('units.wholeOnlyQuantity', { unit: baseUnit.code })
    : null;

  const loadItems = useCallback(async () => {
    if (!token || selectedWarehouseId == null) return;
    try {
      const [productsRes, optionsRes] = await Promise.allSettled([
        ipc.listProducts(token, selectedWarehouseId),
        ipc.listPurchaseProductOptions(token),
      ]);
      const products = productsRes.status === 'fulfilled' ? productsRes.value : [];
      const options = optionsRes.status === 'fulfilled' ? optionsRes.value : [];
      const optionsMap = new Map(options.map((o) => [o.variant_id, o]));
      const enriched: GenericPickerItem[] = products.map((item) => {
        const opt = optionsMap.get(item.variant_id);
        return {
          ...item,
          product_name: opt?.product_name ?? item.product_name ?? item.name,
          variant_name: opt?.variant_name ?? null,
          brand: opt?.brand ?? null,
          default_unit_id: opt?.default_unit_id,
          default_unit_code: opt?.default_unit_code,
          default_unit_name: opt?.default_unit_name,
          alternate_units: opt?.alternate_units,
          attributes: opt?.attributes ?? item.attributes,
          default_unit_cost: opt?.default_unit_cost,
          last_purchase_cost: opt?.last_purchase_cost,
        };
      });
      setVariants(enriched);
      setVariantId((current) => (current != null && enriched.some((e) => e.variant_id === current) ? current : null));
    } catch {
      setVariants([]);
    }
  }, [token, selectedWarehouseId]);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  // Any input change invalidates the current idempotency key: this becomes a
  // new intended operation.
  const invalidateRequest = useCallback(() => setRequestId(null), []);

  const focusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (focusTimerRef.current) {
        clearTimeout(focusTimerRef.current);
      }
    };
  }, []);

  const handleSelectItem = useCallback((item: GenericPickerItem) => {
    setVariantId(item.variant_id);
    const suggestedCost = item.last_purchase_cost ?? item.default_unit_cost;
    if (suggestedCost) {
      setUnitCost(suggestedCost);
    }
    invalidateRequest();
    setPickerOpen(false);
    setBarcodeError(null);
    if (focusTimerRef.current) {
      clearTimeout(focusTimerRef.current);
    }
    focusTimerRef.current = setTimeout(() => {
      if (typeof document !== 'undefined') {
        quantityInputRef.current?.focus();
        (document.querySelector('input[data-testid="stock-quantity"]') as HTMLInputElement | null)?.focus();
      }
    }, 50);
  }, [invalidateRequest]);

  const handleBarcodeSubmit = useCallback(() => {
    const code = barcodeInput.trim();
    if (!code) return;
    const match = variants.find(
      (item) => item.is_active && (item.primary_barcode === code || item.sku === code),
    );
    if (!match) {
      setBarcodeError(text.barcodeNotFound);
      return;
    }
    handleSelectItem(match);
    setBarcodeError(null);
    setBarcodeInput('');
  }, [barcodeInput, variants, text.barcodeNotFound, handleSelectItem]);

  const selectedVariant = useMemo(() => {
    return variants.find((v) => v.variant_id === variantId) ?? null;
  }, [variants, variantId]);

  const provisionalTotal = useMemo(() => {
    if (!QTY_RE.test(quantity) || !COST_RE.test(unitCost)) return null;
    // Provisional display only — never authoritative.
    return (Number(quantity) * Number(unitCost)).toFixed(2);
  }, [quantity, unitCost]);

  const inputsValid =
    variantId != null &&
    selectedWarehouseId != null &&
    openFiscalPeriod != null &&
    QTY_RE.test(quantity) &&
    quantityUnitError == null &&
    COST_RE.test(unitCost);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting || !inputsValid || !token || openFiscalPeriod == null || selectedWarehouseId == null)
      return;

    // Reuse an existing request id (retry of the same operation); otherwise
    // mint one for this new operation.
    const rid = requestId ?? ipc.newRequestId();
    setRequestId(rid);
    setSubmitting(true);
    setBanner(null);
    setResult(null);
    try {
      const posted = await ipc.postStockReceipt(token, {
        requestId: rid,
        warehouseId: selectedWarehouseId,
        variantId: variantId!,
        quantity,
        unitCost,
        fiscalPeriodId: openFiscalPeriod.id,
        documentDate: openFiscalPeriod.starts_on,
      });
      setResult(posted);
      setBanner({ tone: 'success', text: t('stock.posted', { number: posted.document_number }) });
      // Success: next submission is a new operation, and refresh stock/WAC.
      setRequestId(null);
      setQuantity('');
      setUnitCost('');
      try {
        await loadItems();
      } catch {
        // The receipt is already confirmed. A read-side refresh failure must
        // never turn it into an uncertain posting or invite a new request ID.
      }
    } catch (err) {
      const code = codeForError(err);
      if (code === 'UNKNOWN_ERROR') {
        // Uncertain result: keep the SAME request id so a retry is idempotent.
        setBanner({ tone: 'warning', text: t('stock.retryPrompt') });
      } else {
        setBanner({ tone: 'error', text: errorText(err) });
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="sk-page">
      <h1>{t('stock.title')}</h1>
      {openFiscalPeriod == null ? <Banner tone="warning">{t('errors.preconditionFailed')}</Banner> : null}
      <form className="sk-card sk-form" onSubmit={onSubmit} aria-label={t('stock.title')}>
        {banner ? (
          <Banner tone={banner.tone} testId="stock-banner">
            {banner.text}
          </Banner>
        ) : null}

        <div className="sk-field">
          <label className="sk-field__label" htmlFor="stock-wh">{t('stock.warehouse')}</label>
          <select
            id="stock-wh"
            className="sk-field__input"
            value={selectedWarehouseId ?? ''}
            onChange={(e) => {
              selectWarehouse(Number(e.target.value));
              invalidateRequest();
            }}
          >
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.code} — {w.name}
              </option>
            ))}
          </select>
        </div>

        {/* Item Selection Toolbar (Barcode Scanner + + Choose Item) */}
        <div className="sk-field">
          <label className="sk-field__label">{t('stock.variant')}</label>
          <div className="pr-entry-toolbar">
            <div className="pr-scanner-input-group">
              <input
                ref={barcodeInputRef}
                type="text"
                className="pr-scanner-input"
                placeholder={text.scanBarcodePlaceholder}
                aria-label={text.scanBarcodePlaceholder}
                value={barcodeInput}
                onChange={(e) => {
                  setBarcodeInput(e.target.value);
                  setBarcodeError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleBarcodeSubmit();
                  }
                }}
                data-testid="stock-barcode-input"
              />
              {barcodeError && (
                <div className="sk-field-error" data-testid="stock-barcode-error" style={{ marginTop: 4 }}>
                  {barcodeError}
                </div>
              )}
            </div>

            <button
              type="button"
              className="sk-button sk-button--secondary pr-scanner-btn"
              onClick={() => {
                void loadItems();
                setPickerOpen(true);
              }}
              data-testid="stock-open-picker-btn"
            >
              <span aria-hidden style={{ fontSize: '1.05rem', lineHeight: 1 }}>⌕</span>
              + {text.chooseItem}
            </button>
          </div>
        </div>

        {/* Selected Item Preview Card */}
        {selectedVariant ? (
          <div className="pr-selected-item-card" data-testid="stock-selected-item-card">
            <div className="pr-selected-item-info">
              <div className="pr-selected-item-eyebrow">
                {locale === 'ar' ? 'الصنف المحدد' : locale === 'fr' ? 'Article sélectionné' : 'Selected Item'}
              </div>
              <div className="pr-selected-item-name">
                {selectedVariant.product_name
                  ? `${selectedVariant.product_name}${selectedVariant.variant_name ? ` — ${selectedVariant.variant_name}` : ''}`
                  : selectedVariant.name}
              </div>
              <div className="pr-selected-item-meta">
                {selectedVariant.sku && (
                  <span className="pr-meta-pill">
                    <span>SKU:</span> <strong>{selectedVariant.sku}</strong>
                  </span>
                )}
                {selectedVariant.primary_barcode && (
                  <span className="pr-meta-pill pr-meta-pill--barcode">
                    <span>▦</span> <strong>{selectedVariant.primary_barcode}</strong>
                  </span>
                )}
                {baseUnit && (
                  <span className="pr-meta-pill">
                    <span>{locale === 'ar' ? 'الوحدة' : locale === 'fr' ? 'Unité' : 'Unit'}:</span> <strong>{baseUnit.code}</strong>
                  </span>
                )}
                {selectedVariant.quantity_on_hand != null && (
                  <span
                    className={`pr-meta-pill ${
                      isExactDecimalZero(selectedVariant.quantity_on_hand)
                        ? 'pr-meta-pill--stock-zero'
                        : 'pr-meta-pill--stock'
                    }`}
                  >
                    <span>{locale === 'ar' ? 'المخزون المتوفر' : locale === 'fr' ? 'Stock en rayon' : 'Stock'}:</span>{' '}
                    <strong>{formatExactDecimal(selectedVariant.quantity_on_hand)}</strong>
                  </span>
                )}
                {selectedVariant.last_known_wac != null && (
                  <span className="pr-meta-pill pr-meta-pill--wac">
                    <span>WAC:</span> <strong>{formatExactDecimal(selectedVariant.last_known_wac)} DZD</strong>
                  </span>
                )}
              </div>
            </div>
            <button
              type="button"
              className="sk-button sk-button--secondary sk-button--small pr-change-item-btn"
              onClick={() => {
                void loadItems();
                setPickerOpen(true);
              }}
              data-testid="stock-change-item-btn"
            >
              {locale === 'ar' ? 'تغيير الصنف' : locale === 'fr' ? "Changer d'article" : 'Change item'}
            </button>
          </div>
        ) : (
          <div className="pr-empty-selection-prompt" data-testid="stock-empty-selection">
            <span className="pr-empty-selection-icon" aria-hidden>📦</span>
            <span>
              {locale === 'ar'
                ? 'لم يتم تحديد صنف بعد. امسح الرمز الشريطي أعلاه أو انقر على "+ اختيار صنف".'
                : locale === 'fr'
                ? 'Aucun article sélectionné. Scannez un code-barres ci-dessus ou cliquez sur "+ Choisir un article".'
                : 'No item selected yet. Scan a barcode above or click "+ Choose item".'}
            </span>
          </div>
        )}

        <TextField
          id="stock-quantity-input"
          label={t('stock.quantity')}
          value={quantity}
          inputMode="decimal"
          onChange={(e) => {
            setQuantity(e.target.value);
            invalidateRequest();
          }}
          error={
            quantity !== '' && !QTY_RE.test(quantity)
              ? t('errors.validation')
              : quantityUnitError ?? undefined
          }
          data-testid="stock-quantity"
          required
        />
        <TextField
          label={t('stock.unitCost')}
          value={unitCost}
          inputMode="decimal"
          onChange={(e) => {
            setUnitCost(e.target.value);
            invalidateRequest();
          }}
          error={unitCost !== '' && !COST_RE.test(unitCost) ? t('errors.validation') : undefined}
          required
        />

        <p className="sk-provisional" data-testid="stock-provisional">
          {t('stock.provisionalTotal')}: {provisionalTotal ?? '—'}
        </p>

        <Button type="submit" loading={submitting} disabled={!inputsValid}>
          {t('stock.submit')}
        </Button>

        <PurchaseItemPicker
          isOpen={pickerOpen}
          items={variants}
          showStock={true}
          onSelect={handleSelectItem}
          onClose={() => setPickerOpen(false)}
        />
      </form>

      {result ? (
        <section className="sk-card sk-feedback-pop" aria-labelledby="stock-receipt-result-title" data-testid="stock-result">
          <h2 id="stock-receipt-result-title">{t('stock.resultTitle')}</h2>
          <div className="sk-cards">
            <div className="sk-metric">
              <span className="sk-metric__icon" aria-hidden>#</span>
              <span className="sk-metric__label">{t('stock.documentNumber')}</span>
              <strong className="sk-metric__value">{result.document_number}</strong>
            </div>
            <div className="sk-metric">
              <span className="sk-metric__icon" aria-hidden>+</span>
              <span className="sk-metric__label">{t('stock.receivedQuantity')}</span>
              <strong className="sk-metric__value">{formatExactDecimal(result.received_quantity)}</strong>
            </div>
            <div className="sk-metric">
              <span className="sk-metric__icon" aria-hidden>₫</span>
              <span className="sk-metric__label">{t('stock.receivedValue')}</span>
              <strong className="sk-metric__value">{formatExactDecimal(result.received_value)} DZD</strong>
            </div>
            <div className="sk-metric">
              <span className="sk-metric__icon" aria-hidden>Σ</span>
              <span className="sk-metric__label">{t('stock.resultingQuantity')}</span>
              <strong className="sk-metric__value">{formatExactDecimal(result.resulting_quantity_on_hand)}</strong>
            </div>
            <div className="sk-metric">
              <span className="sk-metric__icon" aria-hidden>₫</span>
              <span className="sk-metric__label">{t('stock.resultingValue')}</span>
              <strong className="sk-metric__value">{formatExactDecimal(result.resulting_total_value)} DZD</strong>
            </div>
            <div className="sk-metric">
              <span className="sk-metric__icon" aria-hidden>W</span>
              <span className="sk-metric__label">{t('stock.resultingWac')}</span>
              <strong className="sk-metric__value">{formatExactDecimal(result.resulting_wac)} DZD</strong>
            </div>
          </div>
        </section>
      ) : null}
    </section>
  );
}
