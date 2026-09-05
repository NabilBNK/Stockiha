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
 * WS-D-10: both endpoints go through the same display formatter, so the range
 * reads "12,000 – 14,000" rather than the old "12000 – 14000.00". Single-value
 * detection compares the FORMATTED endpoints, because "12000" and "12000.00"
 * are the same price stored two ways and must not render as a range.
 *
 * The aggregate is explicitly "across the variants on this page" — see the
 * `mayContinue` marker and the note in useCatalogList.ts.
 *
 * WS-D-9B — discoverability. The row's edit affordance was a bare "…", which
 * the Owner did not recognise: he opened the page and concluded that editing
 * did not exist. It is now a labelled "Edit" button, and the whole row opens
 * the panel too. `data-row-click="ignore"` marks the sub-controls that own
 * their own click — the chevron expands rather than opening the panel.
 */
import { useI18n } from '../../shared/i18n';
import { isRowClickIgnored } from './rowClick';
import { useDecimalFormat } from './useDecimalFormat';
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
  const format = useDecimalFormat();

  const lowest = format(group.lowestPrice);
  const highest = format(group.highestPrice);
  const priceLabel = lowest === highest ? lowest : `${lowest} – ${highest}`;

  return (
    <tr
      className={`sk-catalog2__product-row${expanded ? ' sk-catalog2__product-row--open' : ''}`}
      data-testid={`catalog2-product-${group.productId}`}
      onClick={(e) => {
        if (isRowClickIgnored(e.target)) return;
        onOpenPanel(group.productId);
      }}
    >
      <td>
        <div className="sk-catalog2__name-cell">
          <button
            type="button"
            className="sk-catalog2__chevron"
            aria-expanded={expanded}
            data-row-click="ignore"
            onClick={onToggle}
            data-testid={`catalog2-expand-${group.productId}`}
          >
            <span className="sk-catalog2__chevron-glyph" aria-hidden>{expanded ? '▾' : '▸'}</span>
            <span className="sk-catalog2__truncate" title={group.productName}>
              {group.productName}
            </span>
          </button>
          {group.productIsActive ? null : (
            <span className="sk-catalog2__pill sk-catalog2__pill--neutral">{t('catalog.inactive')}</span>
          )}
          {group.mayContinue ? (
            <span
              className="sk-catalog2__pill sk-catalog2__pill--neutral"
              title={t('catalog2.continuedHint')}
              data-testid={`catalog2-continued-${group.productId}`}
            >
              {t('catalog2.continued')}
            </span>
          ) : null}
        </div>
      </td>

      <td>
        <span className="sk-catalog2__pill sk-catalog2__pill--accent" data-testid={`catalog2-variant-count-${group.productId}`}>
          {t('catalog2.variantCount', { count: group.variants.length })}
        </span>
      </td>

      <td>{group.categoryName ?? <span className="sk-catalog2__dash">{t('common.none')}</span>}</td>

      <td className="sk-catalog2__num">
        <span className="sk-catalog2__stock">
          <span className="sk-catalog2__stock-value">{format(group.totalStock)}</span>
          <span className="sk-catalog2__stock-badge" />
        </span>
      </td>

      {/* Minimum stock is per-variant and there is no meaningful product
          roll-up. Printing 0 here would assert something false — 0 is a real
          setting meaning "never warn" — so the column keeps its position and
          shows a muted dash (Owner ruling). */}
      <td className="sk-catalog2__num sk-catalog2__dash" aria-hidden>—</td>

      <td className="sk-catalog2__num">{priceLabel}</td>

      <td>
        <button
          type="button"
          className="sk-catalog2__row-edit"
          aria-label={`${t('catalog2.edit')} — ${group.productName}`}
          onClick={() => onOpenPanel(group.productId)}
          data-testid={`catalog2-product-menu-${group.productId}`}
        >
          {t('catalog2.edit')}
        </button>
      </td>
    </tr>
  );
}
