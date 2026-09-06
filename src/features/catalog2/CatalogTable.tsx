/**
 * WS-D-9 — the grouped catalog table (RULING 2).
 *
 * One row per product, collapsed by default; expanding reveals that product's
 * variant lines, indented. The table keeps FULL WIDTH at all times — the
 * detail panel overlays it rather than splitting the screen (RULING 4).
 */
import { useI18n } from '../../shared/i18n';
import { ProductGroupRow } from './ProductGroupRow';
import { VariantLine } from './VariantLine';
import type { CatalogProductGroup } from './useCatalogList';
import type { SortColumn, SortState } from './sorting';

/**
 * P4 (WS-D-8b) — one sortable column header. A real `<button>` inside the
 * `<th>` so the control is keyboard-activatable (Enter/Space) without extra
 * wiring, and `aria-sort` on the `<th>` itself, which is where assistive
 * tech expects it.
 */
function SortableHeader({
  column,
  label,
  numeric,
  sort,
  onSort,
}: {
  column: SortColumn;
  label: string;
  numeric?: boolean;
  sort: SortState | null;
  onSort: (column: SortColumn) => void;
}) {
  const active = sort?.column === column;
  const ariaSort = active ? (sort!.direction === 'asc' ? 'ascending' : 'descending') : 'none';
  return (
    <th scope="col" className={numeric ? 'sk-catalog2__num' : undefined} aria-sort={ariaSort}>
      <button
        type="button"
        className="sk-catalog2__sort-btn"
        onClick={() => onSort(column)}
        data-testid={`catalog2-sort-${column}`}
      >
        {label}
        <span className="sk-catalog2__sort-glyph" aria-hidden>
          {active ? (sort!.direction === 'asc' ? '▲' : '▼') : ''}
        </span>
      </button>
    </th>
  );
}

export function CatalogTable({
  groups,
  expandedProductIds,
  onToggleProduct,
  onOpenPanel,
  onCommitField,
  sort,
  onSort,
}: {
  groups: CatalogProductGroup[];
  expandedProductIds: ReadonlySet<number>;
  onToggleProduct: (productId: number) => void;
  onOpenPanel: (productId: number, variantId?: number) => void;
  onCommitField: (
    variantId: number,
    productId: number,
    patch: { salePrice?: string; minimumStock?: string },
  ) => Promise<void>;
  sort: SortState | null;
  onSort: (column: SortColumn) => void;
}) {
  const { t } = useI18n();

  return (
    <div className="sk-catalog2__table-wrap" tabIndex={0} aria-label={t('catalog2.table')}>
      <table className="sk-catalog2__table" data-testid="catalog2-table">
        {/* Fixed numeric column widths, so digits line up vertically down the
            column instead of the columns resizing per page (RULING 2). */}
        <colgroup>
          <col />
          <col className="sk-catalog2__col-identifier" />
          <col className="sk-catalog2__col-category" />
          <col className="sk-catalog2__col-stock" />
          <col className="sk-catalog2__col-min" />
          <col className="sk-catalog2__col-price" />
          <col className="sk-catalog2__col-actions" />
        </colgroup>
        <thead>
          <tr>
            <SortableHeader column="name" label={t('catalog.name')} sort={sort} onSort={onSort} />
            <th scope="col">{t('productsList.identifier')}</th>
            <SortableHeader column="category" label={t('productsList.category')} sort={sort} onSort={onSort} />
            <SortableHeader column="stock" label={t('productsList.stock')} numeric sort={sort} onSort={onSort} />
            <SortableHeader column="minStock" label={t('productsList.min')} numeric sort={sort} onSort={onSort} />
            <SortableHeader column="price" label={t('productsList.price')} numeric sort={sort} onSort={onSort} />
            <th scope="col">{t('productsList.actions')}</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => {
            const expanded = expandedProductIds.has(group.productId);
            return [
              <ProductGroupRow
                key={`p-${group.productId}`}
                group={group}
                expanded={expanded}
                onToggle={() => onToggleProduct(group.productId)}
                onOpenPanel={(productId) => onOpenPanel(productId)}
              />,
              ...(expanded
                ? group.variants.map((variant) => (
                  <VariantLine
                    key={`v-${variant.variant_id}`}
                    variant={variant}
                    onCommitField={onCommitField}
                    onOpenPanel={onOpenPanel}
                  />
                ))
                : []),
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}
