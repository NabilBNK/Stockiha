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

export function CatalogTable({
  groups,
  expandedProductIds,
  onToggleProduct,
  onOpenPanel,
  onCommitField,
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
}) {
  const { t } = useI18n();

  return (
    <div className="sk-catalog2__table-wrap" tabIndex={0} aria-label={t('catalog2.table')}>
      <table className="sk-catalog2__table" data-testid="catalog2-table">
        <thead>
          <tr>
            <th scope="col">{t('catalog.name')}</th>
            <th scope="col">{t('productsList.identifier')}</th>
            <th scope="col">{t('productsList.category')}</th>
            <th scope="col" className="sk-catalog2__num">{t('productsList.stock')}</th>
            <th scope="col" className="sk-catalog2__num">{t('productsList.min')}</th>
            <th scope="col" className="sk-catalog2__num">{t('productsList.price')}</th>
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
