/**
 * Slice 2 — form for a single variant's fields:
 * 1. Variant Name (optional, with generated name preview text)
 * 2. Barcode (optional, scanner-friendly)
 * 3. Sale Price (required decimal)
 * 4. Minimum stock (required exact decimal, WS-D-5)
 * 5. Active Status
 *
 * Note: SKU is generated automatically by Stockiha.
 * Product owns the Unit. Reference cost is removed.
 *
 * WS-D-5: salePrice and minimumStock are EXACT DECIMAL STRINGS. They are
 * validated as strings and never passed through Number()/parseFloat, never
 * rounded, and never used in arithmetic here (ws-d-skill.md section 6).
 */
import type { ChangeEvent } from 'react';

import { TextField } from '../../shared/components';
import { useI18n } from '../../shared/i18n';

const PRICE_RE = /^\d+(\.\d{1,2})?$/;
/** Unsigned exact decimal, any scale — matches EXACT_DECIMAL in exactDecimal.ts. */
const MIN_STOCK_RE = /^\d+(?:\.\d+)?$/;

export interface VariantFormValues {
  nameOverride: string;
  barcode: string;
  salePrice: string;
  minimumStock: string;
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
  /**
   * WS-D-5: minimum stock is only rendered where it can actually be persisted.
   * The edit-variant modal still writes through the narrow `updateVariant`
   * (5-arg) overload, which has no minimum_stock parameter, and
   * `get_product_detail` does not return the variant's current minimum_stock
   * either — so showing the field there would be a control the user can set
   * and the app cannot honour. See the WS-D-5 report, "Not finished".
   */
  showMinimumStock?: boolean;
}

export function VariantForm({
  values, onChange, generatedNamePreview, disabled, idPrefix = '', showMinimumStock = true,
}: Props) {
  const { t } = useI18n();
  const priceInvalid = values.salePrice !== '' && !PRICE_RE.test(values.salePrice);
  const minStockInvalid = values.minimumStock !== '' && !MIN_STOCK_RE.test(values.minimumStock);
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

      {showMinimumStock ? (
        <div>
          <TextField
            label={t('variants.minimumStock')}
            id={`${prefix}variant-minimum-stock`}
            value={values.minimumStock}
            inputMode="decimal"
            placeholder="0"
            onChange={(e: ChangeEvent<HTMLInputElement>) => set({ minimumStock: e.target.value })}
            error={minStockInvalid ? t('variants.invalidMinimumStock') : undefined}
            required
            disabled={disabled}
          />
          <p style={{ marginBlock: '0.35rem 0', fontSize: '0.78rem', color: 'var(--sk-muted)' }}>
            {t('variants.minimumStockHint')}
          </p>
        </div>
      ) : null}

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

/**
 * WS-D-5: minimum stock is validated only where it is actually collected.
 * `requireMinimumStock` mirrors VariantForm's `showMinimumStock` — a form that
 * does not render the field must not be blocked by it. "0" is a valid,
 * meaningful value ("never warn me about this item"), so it must pass.
 */
export function isVariantFormValid(v: VariantFormValues, requireMinimumStock = true): boolean {
  if (!PRICE_RE.test(v.salePrice)) return false;
  if (requireMinimumStock && !MIN_STOCK_RE.test(v.minimumStock)) return false;
  return true;
}
