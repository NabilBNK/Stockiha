/**
 * Slice 1 — opening/emergency stock receipt. Selects a warehouse + variant,
 * enters quantity and unit acquisition cost, shows a PROVISIONAL total
 * (display only — WAC and the posted result are backend-authoritative),
 * generates one client request id per intended submission (reused on retry,
 * regenerated when inputs change), and prevents duplicate submits. Distinct
 * outcomes (success / validation / permission / closed period / uncertain
 * retry) are surfaced clearly.
 */
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';

import { Banner, Button, TextField } from '../../shared/components';
import { useI18n } from '../../shared/i18n';
import { codeForError, useErrorText } from '../../shared/hooks/useErrorText';
import { useSession } from '../../shared/session/SessionContext';
import { useAppData } from '../../app/AppDataContext';
import * as ipc from '../../shared/ipc/gateway';
import type { ProductListItem } from '../../shared/ipc/dto';

const QTY_RE = /^\d+(\.\d{1,3})?$/;
const COST_RE = /^\d+(\.\d{1,2})?$/;

export function StockReceiptScreen() {
  const { t } = useI18n();
  const { user } = useSession();
  const { warehouses, selectedWarehouseId, selectWarehouse, openFiscalPeriod } = useAppData();
  const errorText = useErrorText();
  const token = user?.token ?? '';

  const [variants, setVariants] = useState<ProductListItem[]>([]);
  const [variantId, setVariantId] = useState<number | null>(null);
  const [quantity, setQuantity] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [requestId, setRequestId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [banner, setBanner] = useState<{ tone: 'success' | 'error' | 'warning'; text: string } | null>(null);

  useEffect(() => {
    if (!token || selectedWarehouseId == null) return;
    void ipc
      .listProducts(token, selectedWarehouseId)
      .then((items) => {
        setVariants(items);
        setVariantId((current) => current ?? items[0]?.variant_id ?? null);
      })
      .catch(() => setVariants([]));
  }, [token, selectedWarehouseId]);

  // Any input change invalidates the current idempotency key: this becomes a
  // new intended operation.
  const invalidateRequest = useCallback(() => setRequestId(null), []);

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
    try {
      const documentId = await ipc.postStockReceipt(token, {
        requestId: rid,
        warehouseId: selectedWarehouseId,
        variantId: variantId!,
        quantity,
        unitCost,
        fiscalPeriodId: openFiscalPeriod.id,
        documentDate: openFiscalPeriod.starts_on,
      });
      setBanner({ tone: 'success', text: t('stock.posted', { number: documentId }) });
      // Success: next submission is a new operation, and refresh stock/WAC.
      setRequestId(null);
      setQuantity('');
      setUnitCost('');
      const items = await ipc.listProducts(token, selectedWarehouseId);
      setVariants(items);
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

        <div className="sk-field">
          <label className="sk-field__label" htmlFor="stock-variant">{t('stock.variant')}</label>
          <select
            id="stock-variant"
            className="sk-field__input"
            value={variantId ?? ''}
            onChange={(e) => {
              setVariantId(Number(e.target.value));
              invalidateRequest();
            }}
          >
            {variants.map((v) => (
              <option key={v.variant_id} value={v.variant_id}>
                {v.sku} — {v.name}
              </option>
            ))}
          </select>
        </div>

        <TextField
          label={t('stock.quantity')}
          value={quantity}
          inputMode="decimal"
          onChange={(e) => {
            setQuantity(e.target.value);
            invalidateRequest();
          }}
          error={quantity !== '' && !QTY_RE.test(quantity) ? t('errors.validation') : undefined}
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
      </form>
    </section>
  );
}
