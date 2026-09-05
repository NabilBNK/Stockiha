/**
 * WS-D-9 — one row per PRODUCT, collapsed by default (RULING 2).
 *
 * Shows the expand chevron, the product name, an "N variants" pill, the
 * category (a product-level field, shown here and nowhere else), aggregate
 * stock across the variants on this page, and price.
 *
 * Price is a RANGE when the variants disagree. Showing a single figure for a
 * product whose variants cost different amounts would be a quiet lie; the two
 * endpoints are picked with the exact-decimal comparator, never by arithmetic.
 *
 * The aggregate is explicitly "across the variants on this page" — see the
 * `mayContinue` marker and the note in useCatalogList.ts.
 */
import { useI18n } from '../../shared/i18n';
import { formatExactDecimal } from '../inventory/exactDecimal';
import type { CatalogProductGroup } from './useCatalogList';

export function ProductGroupRow({
  group,
  expanded,
  onToggle,
  onOpenPanel,
}: {
  group: CatalogProductGroup;
  expanded: boolean;
  onToggle: () => void;
  onOpenPanel: (productId: number) => void;
}) {
  const { t } = useI18n();

  const priceLabel = group.lowestPrice === group.highestPrice
    ? group.lowestPrice
    : `${group.lowestPrice} – ${group.highestPrice}`;

  return (
    <tr
      className={`sk-catalog2__product-row${expanded ? ' sk-catalog2__product-row--open' : ''}`}
      data-testid={`catalog2-product-${group.productId}`}
    >
      <td>
        <button
          type="button"
          className="sk-catalog2__chevron"
          aria-expanded={expanded}
          onClick={onToggle}
          data-testid={`catalog2-expand-${group.productId}`}
        >
          <span className="sk-catalog2__chevron-glyph" aria-hidden>{expanded ? '▾' : '▸'}</span>
          <span>{group.productName}</span>
        </button>
        {group.productIsActive ? null : (
          <> <span className="sk-catalog2__pill sk-catalog2__pill--neutral">{t('catalog.inactive')}</span></>
        )}
        {group.mayContinue ? (
          <> <span
            className="sk-catalog2__pill sk-catalog2__pill--neutral"
            title={t('catalog2.continuedHint')}
            data-testid={`catalog2-continued-${group.productId}`}
          >
            {t('catalog2.continued')}
          </span></>
        ) : null}
      </td>

      <td>
        <span className="sk-catalog2__pill sk-catalog2__pill--accent" data-testid={`catalog2-variant-count-${group.productId}`}>
          {t('catalog2.variantCount', { count: group.variants.length })}
        </span>
      </td>

      <td>{group.categoryName ?? <span className="sk-catalog2__dash">{t('common.none')}</span>}</td>

      <td className="sk-catalog2__num">{formatExactDecimal(group.totalStock)}</td>

      {/* Minimum stock is per-variant; there is no meaningful product roll-up. */}
      <td className="sk-catalog2__num sk-catalog2__dash" aria-hidden>—</td>

      <td className="sk-catalog2__num">{priceLabel}</td>

      <td>
        <button
          type="button"
          className="sk-catalog2__row-menu"
          aria-label={`${t('catalog2.rowMenu')} — ${group.productName}`}
          onClick={() => onOpenPanel(group.productId)}
          data-testid={`catalog2-product-menu-${group.productId}`}
        >
          …
        </button>
      </td>
    </tr>
  );
}
