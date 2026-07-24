import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { Banner, Button, TextField } from '../../shared/components';
import { useI18n, type MessageKey } from '../../shared/i18n';
import { codeForError, useErrorText } from '../../shared/hooks/useErrorText';
import { useSession } from '../../shared/session/SessionContext';
import { useAppData } from '../../app/AppDataContext';
import * as ipc from '../../shared/ipc/gateway';
import { ZeroQuantityWarning } from './ZeroQuantityWarning';
import type {
  ProductListItem,
  StockAdjustmentReasonCode,
  StockAdjustmentUnit,
} from '../../shared/ipc/dto';

type Direction = 'increase' | 'decrease';

const REASONS: { code: StockAdjustmentReasonCode; label: MessageKey }[] = [
  { code: 'DAMAGE', label: 'adjustment.reason.damage' },
  { code: 'SHRINKAGE', label: 'adjustment.reason.shrinkage' },
  { code: 'EXPIRED', label: 'adjustment.reason.expired' },
  { code: 'FOUND_STOCK', label: 'adjustment.reason.foundStock' },
  { code: 'RECORDING_ERROR', label: 'adjustment.reason.recordingError' },
  { code: 'OTHER', label: 'adjustment.reason.other' },
];

const EXACT_QUANTITY = /^\d+(\.\d{1,3})?$/;

export function isPositiveExactQuantity(value: string): boolean {
  return EXACT_QUANTITY.test(value) && /[1-9]/.test(value.replace('.', ''));
}

export function signedQuantityDelta(direction: Direction, positiveQuantity: string): string {
  return direction === 'decrease' ? `-${positiveQuantity}` : positiveQuantity;
}

export function StockAdjustmentScreen() {
  const { t } = useI18n();
  const { user } = useSession();
  const { warehouses, selectedWarehouseId, selectWarehouse, openFiscalPeriod } = useAppData();
  const errorText = useErrorText();
  const token = user?.token ?? '';

  const [variants, setVariants] = useState<ProductListItem[]>([]);
  const [variantId, setVariantId] = useState<number | null>(null);
  const [units, setUnits] = useState<StockAdjustmentUnit[]>([]);
  const [unitId, setUnitId] = useState<number | null>(null);
  const [direction, setDirection] = useState<Direction>('increase');
  const [quantity, setQuantity] = useState('');
  const [reasonCode, setReasonCode] = useState<StockAdjustmentReasonCode>('FOUND_STOCK');
  const [note, setNote] = useState('');
  const [requestId, setRequestId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [banner, setBanner] = useState<{
    tone: 'success' | 'error' | 'warning';
    text: string;
  } | null>(null);

  const invalidateRequest = useCallback(() => setRequestId(null), []);

  useEffect(() => {
    if (!token || selectedWarehouseId == null) return;
    let active = true;
    void ipc
      .listProducts(token, selectedWarehouseId)
      .then((items) => {
        if (!active) return;
        const available = items.filter((item) => item.is_active);
        setVariants(available);
        setVariantId((current) =>
          current != null && available.some((item) => item.variant_id === current)
            ? current
            : (available[0]?.variant_id ?? null),
        );
      })
      .catch(() => {
        if (active) setVariants([]);
      });
    return () => {
      active = false;
    };
  }, [token, selectedWarehouseId]);

  useEffect(() => {
    if (!token || variantId == null) {
      setUnits([]);
      setUnitId(null);
      return;
    }
    let active = true;
    void ipc
      .listStockAdjustmentUnits(token, variantId)
      .then((items) => {
        if (!active) return;
        setUnits(items);
        setUnitId(items.find((item) => item.is_base)?.unit_id ?? items[0]?.unit_id ?? null);
      })
      .catch(() => {
        if (active) {
          setUnits([]);
          setUnitId(null);
        }
      });
    return () => {
      active = false;
    };
  }, [token, variantId]);

  const selectedVariant = variants.find((item) => item.variant_id === variantId);
  const isZeroQty = selectedVariant != null && Number(selectedVariant.quantity_on_hand) === 0;
  const hasUsableWAC =
    selectedVariant != null &&
    selectedVariant.last_known_wac != null &&
    Number(selectedVariant.last_known_wac) > 0;

  const quantityValid = isPositiveExactQuantity(quantity);
  const noteValid = reasonCode !== 'OTHER' || note.trim() !== '';
  const inputsValid =
    selectedWarehouseId != null &&
    variantId != null &&
    unitId != null &&
    openFiscalPeriod != null &&
    quantityValid &&
    noteValid;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (
      submitting ||
      !inputsValid ||
      !token ||
      selectedWarehouseId == null ||
      variantId == null ||
      unitId == null ||
      openFiscalPeriod == null
    ) {
      return;
    }

    const rid = requestId ?? ipc.newRequestId();
    setRequestId(rid);
    setSubmitting(true);
    setBanner(null);
    try {
      const result = await ipc.confirmStockAdjustment(token, {
        requestId: rid,
        warehouseId: selectedWarehouseId,
        variantId,
        unitId,
        quantityDelta: signedQuantityDelta(direction, quantity),
        reasonCode,
        note: note.trim() || undefined,
        fiscalPeriodId: openFiscalPeriod.id,
        documentDate: openFiscalPeriod.starts_on,
      });
      setBanner({
        tone: 'success',
        text: t('adjustment.posted', { number: result.document_number }),
      });
      setRequestId(null);
      setQuantity('');
      setNote('');
      const items = await ipc.listProducts(token, selectedWarehouseId);
      setVariants(items.filter((item) => item.is_active));
    } catch (error) {
      if (codeForError(error) === 'UNKNOWN_ERROR') {
        setBanner({ tone: 'warning', text: t('adjustment.retryPrompt') });
      } else {
        setBanner({ tone: 'error', text: errorText(error) });
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="sk-page">
      <h1>{t('adjustment.title')}</h1>
      {openFiscalPeriod == null ? (
        <Banner tone="warning">{t('errors.preconditionFailed')}</Banner>
      ) : null}
      <form className="sk-card sk-form" onSubmit={onSubmit} aria-label={t('adjustment.title')}>
        {banner ? (
          <Banner tone={banner.tone} testId="adjustment-banner">
            {banner.text}
          </Banner>
        ) : null}

        <div className="sk-field">
          <label className="sk-field__label" htmlFor="adjustment-warehouse">
            {t('adjustment.warehouse')}
          </label>
          <select
            id="adjustment-warehouse"
            className="sk-field__input"
            value={selectedWarehouseId ?? ''}
            onChange={(event) => {
              selectWarehouse(Number(event.target.value));
              setVariantId(null);
              setUnits([]);
              setUnitId(null);
              invalidateRequest();
            }}
          >
            {warehouses.map((warehouse) => (
              <option key={warehouse.id} value={warehouse.id}>
                {warehouse.code} — {warehouse.name}
              </option>
            ))}
          </select>
        </div>

        <div className="sk-field">
          <label className="sk-field__label" htmlFor="adjustment-variant">
            {t('adjustment.variant')}
          </label>
          <select
            id="adjustment-variant"
            className="sk-field__input"
            value={variantId ?? ''}
            onChange={(event) => {
              setVariantId(Number(event.target.value));
              setUnits([]);
              setUnitId(null);
              invalidateRequest();
            }}
          >
            {variants.map((variant) => (
              <option key={variant.variant_id} value={variant.variant_id}>
                {variant.sku} — {variant.name}
              </option>
            ))}
          </select>
        </div>

        {selectedVariant && direction === 'increase' && isZeroQty ? (
          <ZeroQuantityWarning
            variantName={selectedVariant.name}
            hasUsableWAC={hasUsableWAC}
          />
        ) : null}

        <fieldset className="sk-choice-group">
          <legend className="sk-field__label">{t('adjustment.direction')}</legend>
          <label>
            <input
              type="radio"
              name="adjustment-direction"
              value="increase"
              checked={direction === 'increase'}
              onChange={() => {
                setDirection('increase');
                invalidateRequest();
              }}
            />
            {t('adjustment.increase')}
          </label>
          <label>
            <input
              type="radio"
              name="adjustment-direction"
              value="decrease"
              checked={direction === 'decrease'}
              onChange={() => {
                setDirection('decrease');
                invalidateRequest();
              }}
            />
            {t('adjustment.decrease')}
          </label>
        </fieldset>

        <TextField
          label={t('adjustment.quantity')}
          value={quantity}
          inputMode="decimal"
          onChange={(event) => {
            setQuantity(event.target.value);
            invalidateRequest();
          }}
          error={quantity !== '' && !quantityValid ? t('adjustment.quantityError') : undefined}
          required
        />

        <div className="sk-field">
          <label className="sk-field__label" htmlFor="adjustment-unit">
            {t('adjustment.unit')}
          </label>
          <select
            id="adjustment-unit"
            className="sk-field__input"
            value={unitId ?? ''}
            onChange={(event) => {
              setUnitId(Number(event.target.value));
              invalidateRequest();
            }}
          >
            {units.map((unit) => (
              <option key={unit.unit_id} value={unit.unit_id}>
                {unit.unit_code} — {unit.unit_name}
              </option>
            ))}
          </select>
        </div>

        <div className="sk-field">
          <label className="sk-field__label" htmlFor="adjustment-reason">
            {t('adjustment.reason')}
          </label>
          <select
            id="adjustment-reason"
            className="sk-field__input"
            value={reasonCode}
            onChange={(event) => {
              setReasonCode(event.target.value as StockAdjustmentReasonCode);
              invalidateRequest();
            }}
          >
            {REASONS.map((reason) => (
              <option key={reason.code} value={reason.code}>
                {t(reason.label)}
              </option>
            ))}
          </select>
        </div>

        <div className="sk-field">
          <label className="sk-field__label" htmlFor="adjustment-note">
            {t('adjustment.note')}
          </label>
          <textarea
            id="adjustment-note"
            className="sk-field__input sk-field__textarea"
            value={note}
            onChange={(event) => {
              setNote(event.target.value);
              invalidateRequest();
            }}
            aria-invalid={!noteValid}
            required={reasonCode === 'OTHER'}
          />
          {!noteValid ? (
            <p className="sk-field__error" role="alert">
              {t('adjustment.otherNoteRequired')}
            </p>
          ) : null}
        </div>

        <Button type="submit" loading={submitting} disabled={!inputsValid}>
          {t('adjustment.submit')}
        </Button>
      </form>
    </section>
  );
}
