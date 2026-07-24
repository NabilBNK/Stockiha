/**
 * Slice 2 — form for a single variant's core fields (SKU, price, active).
 */
import type { ChangeEvent } from 'react';

import { TextField } from '../../shared/components';
import { useI18n } from '../../shared/i18n';

const PRICE_RE = /^\d+(\.\d{1,2})?$/;

export interface VariantFormValues {
  sku: string;
  salePrice: string;
  isActive: boolean;
}

interface Props {
  values: VariantFormValues;
  onChange: (values: VariantFormValues) => void;
  disabled?: boolean;
  /** Optional ID prefix to disambiguate multiple forms on the same page */
  idPrefix?: string;
}

export function VariantForm({ values, onChange, disabled, idPrefix = '' }: Props) {
  const { t } = useI18n();
  const priceInvalid = values.salePrice !== '' && !PRICE_RE.test(values.salePrice);
  const prefix = idPrefix ? `${idPrefix}-` : '';

  function set(patch: Partial<VariantFormValues>) {
    onChange({ ...values, ...patch });
  }

  return (
    <div className="sk-form__grid">
      <TextField
        label={t('variants.sku')}
        id={`${prefix}variant-sku`}
        value={values.sku}
        onChange={(e: ChangeEvent<HTMLInputElement>) => set({ sku: e.target.value })}
        required
        disabled={disabled}
      />
      <TextField
        label={t('variants.price')}
        id={`${prefix}variant-price`}
        value={values.salePrice}
        inputMode="decimal"
        onChange={(e: ChangeEvent<HTMLInputElement>) => set({ salePrice: e.target.value })}
        error={priceInvalid ? t('variants.invalidPrice') : undefined}
        required
        disabled={disabled}
      />
      <div className="sk-field">
        <label className="sk-field__label">
          <input
            type="checkbox"
            checked={values.isActive}
            onChange={(e: ChangeEvent<HTMLInputElement>) => set({ isActive: e.target.checked })}
            disabled={disabled}
          />
          {' '}
          {t('variants.active')}
        </label>
      </div>
    </div>
  );
}

export function isVariantFormValid(v: VariantFormValues): boolean {
  return v.sku.trim() !== '' && PRICE_RE.test(v.salePrice);
}
