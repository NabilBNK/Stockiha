/**
 * WS-D-9 — a variant, nested under its product (RULING 2).
 *
 * Shows the identifier badge (BARCODE or SKU) exactly as `identifier_type`
 * reports it — the type is decided in SQL by list_products_v2 and is never
 * inferred here — the variant name, stock with a low-stock pill where it
 * applies, and the two inline-editable cells.
 *
 * Category is a PRODUCT-level field, so a variant line shows a muted dash
 * rather than repeating its product's category.
 *
 * Stock is NOT editable: it is derived from stock movements and owned by Stock
 * Receipt and Inventory Corrections. Display only.
 */
import { useI18n } from '../../shared/i18n';
import type { ProductListItemV2 } from '../../shared/ipc/dto';
import { formatExactDecimal, isExactDecimalZero, isLowStock } from '../inventory/exactDecimal';
import { InlineCell } from './InlineCell';

/** Same shapes the rest of WS-D validates against. Exact decimal strings. */
const PRICE_RE = /^\d+(\.\d{1,2})?$/;
const MIN_STOCK_RE = /^\d+(?:\.\d+)?$/;

export function VariantLine({
  variant,
  onCommitField,
  onOpenPanel,
}: {
  variant: ProductListItemV2;
  onCommitField: (
    variantId: number,
    productId: number,
    patch: { salePrice?: string; minimumStock?: string },
  ) => Promise<void>;
  onOpenPanel: (productId: number, variantId: number) => void;
}) {
  const { t } = useI18n();

  const low = isLowStock(variant.quantity_on_hand, variant.minimum_stock);
  const outOfStock = isExactDecimalZero(variant.quantity_on_hand);
  const isBarcode = variant.identifier_type === 'BARCODE';
  const inactive = !variant.is_active || !variant.product_is_active;

  return (
    <tr className="sk-catalog2__variant-row" data-testid={`catalog2-variant-${variant.variant_id}`}>
      <td className="sk-catalog2__variant-name">
        {variant.variant_name}
        {inactive ? (
          <> <span className="sk-catalog2__pill sk-catalog2__pill--neutral">{t('catalog.inactive')}</span></>
        ) : null}
      </td>

      <td>
        <span
          className={`sk-catalog2__pill ${isBarcode ? 'sk-catalog2__pill--accent' : 'sk-catalog2__pill--neutral'}`}
        >
          {isBarcode ? t('productsList.identifierBarcode') : t('productsList.identifierSku')}
        </span>{' '}
        <span className="sk-catalog2__mono">{variant.display_identifier}</span>
      </td>

      {/* Product-level field: never repeated per variant. */}
      <td className="sk-catalog2__dash" aria-hidden>—</td>

      <td className="sk-catalog2__num">
        {formatExactDecimal(variant.quantity_on_hand)}
        {outOfStock ? (
          <> <span className="sk-catalog2__pill sk-catalog2__pill--danger">{t('productsList.outOfStock')}</span></>
        ) : low ? (
          <> <span className="sk-catalog2__pill sk-catalog2__pill--warn">{t('productsList.lowStock')}</span></>
        ) : null}
      </td>

      <td className="sk-catalog2__num">
        <InlineCell
          value={variant.minimum_stock}
          label={`${t('variants.minimumStock')} — ${variant.variant_name}`}
          format={formatExactDecimal}
          validate={(v) => (MIN_STOCK_RE.test(v) ? null : t('variants.invalidMinimumStock'))}
          commit={(v) => onCommitField(variant.variant_id, variant.product_id, { minimumStock: v })}
          testId={`catalog2-min-${variant.variant_id}`}
        />
      </td>

      <td className="sk-catalog2__num">
        <InlineCell
          value={variant.sale_price}
          label={`${t('variants.price')} — ${variant.variant_name}`}
          validate={(v) => (PRICE_RE.test(v) ? null : t('variants.invalidPrice'))}
          commit={(v) => onCommitField(variant.variant_id, variant.product_id, { salePrice: v })}
          testId={`catalog2-price-${variant.variant_id}`}
        />
      </td>

      <td>
        <button
          type="button"
          className="sk-catalog2__row-menu"
          aria-label={`${t('catalog2.rowMenu')} — ${variant.variant_name}`}
          onClick={() => onOpenPanel(variant.product_id, variant.variant_id)}
          data-testid={`catalog2-variant-menu-${variant.variant_id}`}
        >
          …
        </button>
      </td>
    </tr>
  );
}
