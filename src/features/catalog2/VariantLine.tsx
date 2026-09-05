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
 *
 * WS-D-9B — the row opens the panel already expanded on THIS variant, and the
 * edit affordance is a labelled button rather than a bare "…". The two
 * inline-editable cells are marked `data-row-click="ignore"` so clicking a
 * price edits the price instead of sliding a panel over it.
 *
 * WS-D-10 — every number is formatted for display (RULING 1) and every numeric
 * cell is right-aligned with tabular numerals (RULING 2). The stock cell gives
 * the digits and the low-stock badge separate slots, so the digits stay in a
 * straight column down the page whether a badge is present or not — a badge
 * rendered after the number would shove that row's digits inward.
 *
 * The formatting is display-only: InlineCell edits and commits the RAW stored
 * string, so nothing formatted ever reaches the gateway.
 */
import { useI18n } from '../../shared/i18n';
import type { ProductListItemV2 } from '../../shared/ipc/dto';
import { isExactDecimalZero, isLowStock } from '../inventory/exactDecimal';
import { InlineCell } from './InlineCell';
import { isValidMinimumStock, isValidPrice } from './catalogValidation';
import { isRowClickIgnored } from './rowClick';
import { useDecimalFormat } from './useDecimalFormat';

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
  const format = useDecimalFormat();

  const low = isLowStock(variant.quantity_on_hand, variant.minimum_stock);
  const outOfStock = isExactDecimalZero(variant.quantity_on_hand);
  const isBarcode = variant.identifier_type === 'BARCODE';
  const inactive = !variant.is_active || !variant.product_is_active;

  return (
    <tr
      className="sk-catalog2__variant-row"
      data-testid={`catalog2-variant-${variant.variant_id}`}
      onClick={(e) => {
        if (isRowClickIgnored(e.target)) return;
        onOpenPanel(variant.product_id, variant.variant_id);
      }}
    >
      <td className="sk-catalog2__variant-name">
        <div className="sk-catalog2__name-cell">
          <span className="sk-catalog2__truncate" title={variant.variant_name}>
            {variant.variant_name}
          </span>
          {inactive ? (
            <span className="sk-catalog2__pill sk-catalog2__pill--neutral">{t('catalog.inactive')}</span>
          ) : null}
        </div>
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

      {/* Two slots: the digits keep a fixed right edge, the badge gets its own
          reserved space beside them. */}
      <td className="sk-catalog2__num">
        <span className="sk-catalog2__stock">
          <span className="sk-catalog2__stock-value">{format(variant.quantity_on_hand)}</span>
          <span className="sk-catalog2__stock-badge">
            {outOfStock ? (
              <span className="sk-catalog2__pill sk-catalog2__pill--danger">{t('productsList.outOfStock')}</span>
            ) : low ? (
              <span className="sk-catalog2__pill sk-catalog2__pill--warn">{t('productsList.lowStock')}</span>
            ) : null}
          </span>
        </span>
      </td>

      {/* Cell edit takes precedence over the row's open-panel click. */}
      <td className="sk-catalog2__num" data-row-click="ignore">
        <InlineCell
          value={variant.minimum_stock}
          label={`${t('variants.minimumStock')} — ${variant.variant_name}`}
          format={format}
          validate={(v) => (isValidMinimumStock(v) ? null : t('variants.invalidMinimumStock'))}
          commit={(v) => onCommitField(variant.variant_id, variant.product_id, { minimumStock: v })}
          testId={`catalog2-min-${variant.variant_id}`}
        />
      </td>

      <td className="sk-catalog2__num" data-row-click="ignore">
        <InlineCell
          value={variant.sale_price}
          label={`${t('variants.price')} — ${variant.variant_name}`}
          format={format}
          validate={(v) => (isValidPrice(v) ? null : t('variants.invalidPrice'))}
          commit={(v) => onCommitField(variant.variant_id, variant.product_id, { salePrice: v })}
          testId={`catalog2-price-${variant.variant_id}`}
        />
      </td>

      <td>
        <button
          type="button"
          className="sk-catalog2__row-edit"
          aria-label={`${t('catalog2.edit')} — ${variant.variant_name}`}
          onClick={() => onOpenPanel(variant.product_id, variant.variant_id)}
          data-testid={`catalog2-variant-menu-${variant.variant_id}`}
        >
          {t('catalog2.edit')}
        </button>
      </td>
    </tr>
  );
}
