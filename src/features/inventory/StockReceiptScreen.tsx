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

export interface ReceiptLine {
  id: number;
  variant: GenericPickerItem;
  quantity: string;
  unitCost: string;
  baseUnit: { id: number; code: string } | null;
}

export function StockReceiptScreen() {
  const { t, locale } = useI18n();
  const text = PROCUREMENT_COPY[locale];
  const { user } = useSession();
  const { selectedWarehouseId, openFiscalPeriod } = useAppData();
  const errorText = useErrorText();
  const token = user?.token ?? '';

  const [variants, setVariants] = useState<GenericPickerItem[]>([]);
  const [variantId, setVariantId] = useState<number | null>(null);
  const [quantity, setQuantity] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [lines, setLines] = useState<ReceiptLine[]>([]);
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

  // Look up base units for batch lines
  useEffect(() => {
    if (!token || lines.length <= 1) return;
    lines.forEach((line) => {
      if (!line.baseUnit) {
        ipc.listStockAdjustmentUnits(token, line.id)
          .then((variantUnits) => {
            const base = variantUnits.find((u) => u.is_base);
            if (base) {
              setLines((current) =>
                current.map((l) =>
                  l.id === line.id ? { ...l, baseUnit: { id: base.unit_id, code: base.unit_code } } : l
                )
              );
            }
          })
          .catch(() => {});
      }
    });
  }, [token, lines]);

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
    const suggestedCost = item.last_purchase_cost ?? item.default_unit_cost ?? '';
    if (suggestedCost) {
      setUnitCost(suggestedCost);
    }
    setLines([{
      id: item.variant_id,
      variant: item,
      quantity: '',
      unitCost: suggestedCost,
      baseUnit: null,
    }]);
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

  const handleSelectMultiple = useCallback((selectedItems: GenericPickerItem[]) => {
    if (selectedItems.length === 0) return;
    if (selectedItems.length === 1 && lines.length === 0) {
      handleSelectItem(selectedItems[0]);
      return;
    }
    setLines((prev) => {
      const existingIds = new Set(prev.map((l) => l.id));
      const newLines: ReceiptLine[] = selectedItems
        .filter((it) => !existingIds.has(it.variant_id))
        .map((it) => ({
          id: it.variant_id,
          variant: it,
          quantity: '',
          unitCost: it.last_purchase_cost ?? it.default_unit_cost ?? '',
          baseUnit: null,
        }));
      const combined = [...prev, ...newLines];
      if (combined.length > 0 && variantId == null) {
        setVariantId(combined[0].id);
      }
      return combined;
    });
    setPickerOpen(false);
    invalidateRequest();
  }, [handleSelectItem, lines.length, variantId, invalidateRequest]);

  const removeLine = useCallback((variantIdToRemove: number) => {
    setLines((prev) => {
      const next = prev.filter((l) => l.id !== variantIdToRemove);
      if (next.length === 1) {
        setVariantId(next[0].id);
        setQuantity(next[0].quantity);
        setUnitCost(next[0].unitCost);
      } else if (next.length === 0) {
        setVariantId(null);
        setQuantity('');
        setUnitCost('');
      }
      return next;
    });
    invalidateRequest();
  }, [invalidateRequest]);

  const updateLine = useCallback((id: number, field: 'quantity' | 'unitCost', value: string) => {
    setLines((prev) =>
      prev.map((l) => (l.id === id ? { ...l, [field]: value } : l))
    );
    if (lines.length <= 1) {
      if (field === 'quantity') setQuantity(value);
      if (field === 'unitCost') setUnitCost(value);
    }
    invalidateRequest();
  }, [lines.length, invalidateRequest]);

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

  const multiInputsValid =
    lines.length > 1 &&
    selectedWarehouseId != null &&
    openFiscalPeriod != null &&
    lines.every((l) => {
      const allowsFrac = allowsFractionsById(l.baseUnit?.id);
      const isFormatOk = QTY_RE.test(l.quantity) && COST_RE.test(l.unitCost);
      if (!isFormatOk) return false;
      if (l.baseUnit && allowsFrac === false && !isQuantityValidForUnit(l.quantity, false)) {
        return false;
      }
      return true;
    });

  const multiTotal = useMemo(() => {
    if (lines.length <= 1) return null;
    let sum = 0;
    for (const l of lines) {
      if (QTY_RE.test(l.quantity) && COST_RE.test(l.unitCost)) {
        sum += Number(l.quantity) * Number(l.unitCost);
      }
    }
    return sum.toFixed(2);
  }, [lines]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting || !token || openFiscalPeriod == null || selectedWarehouseId == null)
      return;

    // Handle Multi-Item Batch Submission
    if (lines.length > 1) {
      if (!multiInputsValid) return;
      setSubmitting(true);
      setBanner(null);
      setResult(null);
      const postedResults: StockReceiptResult[] = [];
      try {
        for (const line of lines) {
          const rid = ipc.newRequestId();
          const posted = await ipc.postStockReceipt(token, {
            requestId: rid,
            warehouseId: selectedWarehouseId,
            variantId: line.variant.variant_id,
            quantity: line.quantity,
            unitCost: line.unitCost,
            fiscalPeriodId: openFiscalPeriod.id,
            documentDate: openFiscalPeriod.starts_on,
          });
          postedResults.push(posted);
        }
        setResult(postedResults[postedResults.length - 1]);
        const docNumbers = postedResults.map((r) => r.document_number).join(', ');
        setBanner({
          tone: 'success',
          text: locale === 'ar'
            ? `تم استلام ${postedResults.length} أصناف بنجاح (${docNumbers})`
            : locale === 'fr'
            ? `${postedResults.length} articles réceptionnés avec succès (${docNumbers})`
            : `Successfully received ${postedResults.length} items (${docNumbers})`,
        });
        setLines([]);
        setVariantId(null);
        setQuantity('');
        setUnitCost('');
        void loadItems();
      } catch (err) {
        setBanner({ tone: 'error', text: errorText(err) });
      } finally {
        setSubmitting(false);
      }
      return;
    }

    // Single-Item Submission
    if (!inputsValid) return;

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
      setLines([]);
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

        {/* Multi-Item Batch Table vs Single-Item Form */}
        {lines.length > 1 ? (
          <div className="sk-card" style={{ padding: '16px', marginBlock: '16px', background: 'var(--sk-surface)' }} data-testid="stock-multi-receipt-table">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700 }}>
                  {locale === 'ar' ? `استلام متعدد (${lines.length} أصناف)` : locale === 'fr' ? `Réception multiple (${lines.length} articles)` : `Batch Receipt (${lines.length} items)`}
                </h3>
                <span style={{ fontSize: '0.82rem', color: 'var(--sk-muted)' }}>
                  {locale === 'ar' ? 'حدد الكمية وسعر التكلفة لكل صنف' : locale === 'fr' ? 'Saisissez la quantité et le coût unitaire pour chaque article' : 'Enter quantity and unit cost for each item'}
                </span>
              </div>
              <button
                type="button"
                className="sk-button sk-button--secondary sk-button--small"
                onClick={() => {
                  void loadItems();
                  setPickerOpen(true);
                }}
                data-testid="stock-add-more-lines-btn"
              >
                + {locale === 'ar' ? 'إضافة أصناف أخرى' : locale === 'fr' ? 'Ajouter d’autres articles' : 'Add more items'}
              </button>
            </div>

            <div className="sk-table-wrap">
              <table className="sk-table" style={{ width: '100%', fontSize: '0.88rem' }}>
                <thead>
                  <tr>
                    <th style={{ width: '35%' }}>{locale === 'ar' ? 'الصنف' : locale === 'fr' ? 'Article' : 'Product / Variant'}</th>
                    <th style={{ width: '10%' }}>{locale === 'ar' ? 'الوحدة' : locale === 'fr' ? 'Unité' : 'Unit'}</th>
                    <th style={{ width: '12%' }}>{locale === 'ar' ? 'المخزون' : locale === 'fr' ? 'Stock' : 'Stock'}</th>
                    <th style={{ width: '16%' }}>{t('stock.quantity')}</th>
                    <th style={{ width: '16%' }}>{t('stock.unitCost')} (DZD)</th>
                    <th style={{ width: '11%' }}>{t('stock.provisionalTotal')}</th>
                    <th style={{ width: '4%' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, idx) => {
                    const lineTotal = QTY_RE.test(line.quantity) && COST_RE.test(line.unitCost)
                      ? (Number(line.quantity) * Number(line.unitCost)).toFixed(2)
                      : '—';
                    const allowsFrac = allowsFractionsById(line.baseUnit?.id);
                    const lineUnitError = line.quantity !== ''
                      && QTY_RE.test(line.quantity)
                      && line.baseUnit != null
                      && allowsFrac === false
                      && !isQuantityValidForUnit(line.quantity, false);

                    return (
                      <tr key={line.id} data-testid={`stock-receipt-line-${line.id}`}>
                        <td>
                          <div style={{ fontWeight: 600 }}>
                            {line.variant.product_name ?? line.variant.name}
                            {line.variant.variant_name ? ` — ${line.variant.variant_name}` : ''}
                          </div>
                          <div style={{ fontSize: '0.76rem', color: 'var(--sk-muted)' }}>
                            SKU: {line.variant.sku} {line.variant.primary_barcode ? `| ▦ ${line.variant.primary_barcode}` : ''}
                          </div>
                        </td>
                        <td>
                          <span className="sk-badge sk-badge--neutral">{line.baseUnit?.code ?? '—'}</span>
                        </td>
                        <td>
                          <span style={{ fontWeight: 600 }}>{formatExactDecimal(line.variant.quantity_on_hand ?? '0')}</span>
                        </td>
                        <td>
                          <input
                            type="text"
                            inputMode="decimal"
                            className="sk-field__input"
                            style={{ height: '34px', fontSize: '0.88rem' }}
                            value={line.quantity}
                            placeholder="0"
                            onChange={(e) => updateLine(line.id, 'quantity', e.target.value)}
                            data-testid={idx === 0 ? 'stock-quantity' : `stock-quantity-${line.id}`}
                            aria-invalid={lineUnitError || (line.quantity !== '' && !QTY_RE.test(line.quantity))}
                          />
                        </td>
                        <td>
                          <input
                            type="text"
                            inputMode="decimal"
                            className="sk-field__input"
                            style={{ height: '34px', fontSize: '0.88rem' }}
                            value={line.unitCost}
                            placeholder="0.00"
                            onChange={(e) => updateLine(line.id, 'unitCost', e.target.value)}
                            data-testid={`stock-unit-cost-${line.id}`}
                            aria-label={idx === 0 ? 'Unit cost' : undefined}
                          />
                        </td>
                        <td style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                          {lineTotal !== '—' ? `${lineTotal} DZD` : '—'}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="sk-button sk-button--small sk-button--secondary"
                            onClick={() => removeLine(line.id)}
                            style={{ padding: '2px 8px', color: 'var(--sk-danger)' }}
                            title="Remove line"
                            aria-label="Remove line"
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="sk-receipt-form-actions" style={{ marginTop: '16px' }}>
              <p className="sk-provisional" data-testid="stock-provisional">
                <span>{t('stock.provisionalTotal')}:</span>
                <strong>{multiTotal ? `${multiTotal} DZD` : '—'}</strong>
              </p>
              <Button type="submit" loading={submitting} disabled={!multiInputsValid}>
                {locale === 'ar' ? `استلام (${lines.length} أصناف)` : locale === 'fr' ? `Réceptionner (${lines.length} articles)` : `Receive (${lines.length} items)`}
              </Button>
            </div>
          </div>
        ) : (
          <>
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

            <div className="sk-receipt-form-inputs">
              <TextField
                id="stock-quantity-input"
                label={t('stock.quantity')}
                value={quantity}
                inputMode="decimal"
                onChange={(e) => {
                  setQuantity(e.target.value);
                  if (selectedVariant) {
                    updateLine(selectedVariant.variant_id, 'quantity', e.target.value);
                  }
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
                  if (selectedVariant) {
                    updateLine(selectedVariant.variant_id, 'unitCost', e.target.value);
                  }
                  invalidateRequest();
                }}
                error={unitCost !== '' && !COST_RE.test(unitCost) ? t('errors.validation') : undefined}
                required
              />
            </div>

            <div className="sk-receipt-form-actions">
              <p className="sk-provisional" data-testid="stock-provisional">
                <span>{t('stock.provisionalTotal')}:</span>
                <strong>{provisionalTotal ? `${provisionalTotal} DZD` : '—'}</strong>
              </p>

              <Button type="submit" loading={submitting} disabled={!inputsValid}>
                {t('stock.submit')}
              </Button>
            </div>
          </>
        )}

        <PurchaseItemPicker
          isOpen={pickerOpen}
          items={variants}
          disabledVariantIds={lines.map((l) => l.id)}
          showStock={true}
          multiSelect={true}
          onSelect={handleSelectItem}
          onSelectMultiple={handleSelectMultiple}
          onClose={() => setPickerOpen(false)}
        />
      </form>

      {result ? (
        <section className="sk-card sk-feedback-pop sk-receipt-result-section" aria-labelledby="stock-receipt-result-title" data-testid="stock-result">
          <div className="sk-receipt-result-header">
            <h2 id="stock-receipt-result-title" style={{ margin: 0 }}>{t('stock.resultTitle')}</h2>
            <div className="sk-receipt-doc-badge">
              <span className="sk-receipt-doc-badge__label">{t('stock.documentNumber')}:</span>
              <strong className="sk-receipt-doc-badge__num">{result.document_number}</strong>
            </div>
          </div>
          <div className="sk-receipt-cards-grid">
            <div className="sk-metric sk-receipt-card">
              <span className="sk-metric__icon sk-receipt-card__icon--doc" aria-hidden>#</span>
              <div className="sk-receipt-card__body">
                <span className="sk-metric__label">{t('stock.documentNumber')}</span>
                <strong className="sk-metric__value sk-receipt-card__val--doc">{result.document_number}</strong>
              </div>
            </div>
            <div className="sk-metric sk-receipt-card">
              <span className="sk-metric__icon sk-receipt-card__icon--qty" aria-hidden>+</span>
              <div className="sk-receipt-card__body">
                <span className="sk-metric__label">{t('stock.receivedQuantity')}</span>
                <strong className="sk-metric__value sk-receipt-card__val--qty">
                  {formatExactDecimal(result.received_quantity)}
                  {baseUnit?.code ? <span className="sk-receipt-card__unit">{baseUnit.code}</span> : null}
                </strong>
              </div>
            </div>
            <div className="sk-metric sk-receipt-card">
              <span className="sk-metric__icon sk-receipt-card__icon--val" aria-hidden>₫</span>
              <div className="sk-receipt-card__body">
                <span className="sk-metric__label">{t('stock.receivedValue')}</span>
                <strong className="sk-metric__value sk-receipt-card__val--money">{formatExactDecimal(result.received_value)} DZD</strong>
              </div>
            </div>
            <div className="sk-metric sk-receipt-card">
              <span className="sk-metric__icon sk-receipt-card__icon--stock" aria-hidden>Σ</span>
              <div className="sk-receipt-card__body">
                <span className="sk-metric__label">{t('stock.resultingQuantity')}</span>
                <strong className="sk-metric__value sk-receipt-card__val--stock">
                  {formatExactDecimal(result.resulting_quantity_on_hand)}
                  {baseUnit?.code ? <span className="sk-receipt-card__unit">{baseUnit.code}</span> : null}
                </strong>
              </div>
            </div>
            <div className="sk-metric sk-receipt-card">
              <span className="sk-metric__icon sk-receipt-card__icon--val" aria-hidden>₫</span>
              <div className="sk-receipt-card__body">
                <span className="sk-metric__label">{t('stock.resultingValue')}</span>
                <strong className="sk-metric__value sk-receipt-card__val--money">{formatExactDecimal(result.resulting_total_value)} DZD</strong>
              </div>
            </div>
            <div className="sk-metric sk-receipt-card">
              <span className="sk-metric__icon sk-receipt-card__icon--wac" aria-hidden>W</span>
              <div className="sk-receipt-card__body">
                <span className="sk-metric__label">{t('stock.resultingWac')}</span>
                <strong className="sk-metric__value sk-receipt-card__val--wac">{formatExactDecimal(result.resulting_wac)} DZD</strong>
              </div>
            </div>
          </div>
        </section>
      ) : null}
    </section>
  );
}
