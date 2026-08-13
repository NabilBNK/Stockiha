/**
 * Slice 2 — form for a single variant's fields:
 * 1. Variant Name (optional, with generated name preview text)
 * 2. Barcode (optional, scanner-friendly)
 * 3. Sale Price (required decimal)
 * 4. Active Status
 *
 * Note: SKU is generated automatically by Stockiha.
 * Product owns the Unit. Reference cost is removed.
 */
import type { ChangeEvent } from 'react';

import { TextField } from '../../shared/components';
import { useI18n } from '../../shared/i18n';

const PRICE_RE = /^\d+(\.\d{1,2})?$/;

export interface VariantFormValues {
  nameOverride: string;
  barcode: string;
  salePrice: string;
  isActive: boolean;
}

interface Props {
  values: VariantFormValues;
  onChange: (values: VariantFormValues) => void;
  /** Generated preview name (Product Name + Attributes) when Variant Name is empty */
  generatedNamePreview?: string;
  disabled?: boolean;
  /** Optional ID prefix to disambiguate multiple forms on the same page */
  idPrefix?: string;
}

export function VariantForm({
  values, onChange, generatedNamePreview, disabled, idPrefix = '',
}: Props) {
  const { t } = useI18n();
  const priceInvalid = values.salePrice !== '' && !PRICE_RE.test(values.salePrice);
  const prefix = idPrefix ? `${idPrefix}-` : '';

  function set(patch: Partial<VariantFormValues>) {
    onChange({ ...values, ...patch });
  }

  const effectivePreview = values.nameOverride.trim() !== ''
    ? values.nameOverride.trim()
    : (generatedNamePreview ?? '');

  return (
    <div className="sk-form__grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
      <div style={{ gridColumn: '1 / -1' }}>
        <TextField
          label={t('variants.name')}
          id={`${prefix}variant-name`}
          value={values.nameOverride}
          onChange={(e: ChangeEvent<HTMLInputElement>) => set({ nameOverride: e.target.value })}
          placeholder={t('variants.namePlaceholder')}
          disabled={disabled}
        />
        {effectivePreview ? (
          <div style={{ marginBlockStart: '0.4rem', fontSize: '0.82rem', color: 'var(--sk-muted)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <span>{t('variants.effectiveNamePreview')}:</span>
            <span className="sk-badge sk-badge--secondary" style={{ fontSize: '0.78rem' }}>
              {effectivePreview}
            </span>
          </div>
        ) : null}
      </div>

      <TextField
        label={t('barcodes.barcode')}
        id={`${prefix}variant-barcode`}
        value={values.barcode}
        onChange={(e: ChangeEvent<HTMLInputElement>) => set({ barcode: e.target.value })}
        placeholder={t('barcodes.placeholder')}
        disabled={disabled}
      />

      <TextField
        label={`${t('variants.price')} (DZD)`}
        id={`${prefix}variant-price`}
        value={values.salePrice}
        inputMode="decimal"
        placeholder="e.g. 2000"
        onChange={(e: ChangeEvent<HTMLInputElement>) => set({ salePrice: e.target.value })}
        error={priceInvalid ? t('variants.invalidPrice') : undefined}
        required
        disabled={disabled}
      />

      <div className="sk-field">
        <span className="sk-field__label">{t('variants.active')}</span>
        <label
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.5rem',
            minHeight: 'var(--sk-touch)',
            cursor: 'pointer',
            fontWeight: 600,
          }}
        >
          <input
            type="checkbox"
            checked={values.isActive}
            onChange={(e: ChangeEvent<HTMLInputElement>) => set({ isActive: e.target.checked })}
            disabled={disabled}
          />
          <span>{values.isActive ? t('catalog.active') : t('catalog.inactive')}</span>
        </label>
      </div>
    </div>
  );
}

export function isVariantFormValid(v: VariantFormValues): boolean {
  return PRICE_RE.test(v.salePrice);
}
