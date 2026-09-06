/**
 * P4 (WS-D-8b pre-phase) — client-side sort of the CURRENT PAGE of the
 * products table.
 *
 * `catalog.list_products_v2` accepts search, categoryId, includeInactive,
 * limit and offset ONLY — there is no sort parameter, so a full-result-set
 * sort would require new SQL, which is out of scope here (see the report's
 * "Sorting limitation" section for the proposed follow-up). Sorting the
 * loaded PAGE is what is actually implemented, and `CatalogScreen` is
 * responsible for telling the operator so whenever the result set spans more
 * than one page — see `catalog2.sortAppliesToPageOnly` there.
 *
 * Numeric columns compare by VALUE via the exact-decimal comparator in
 * exactDecimal.ts — never Number()/parseFloat(), which would silently lose
 * precision on a stored decimal string. Text columns use a locale-aware
 * `Intl.Collator` so fr/ar/en all sort the way a human reading that locale
 * would expect.
 *
 * Sorting happens at the PRODUCT-GROUP level: each group's variants stay
 * nested underneath it exactly as `groupByProduct` produced them. Nothing
 * here re-sorts or flattens the variants inside a group.
 */
import type { CatalogProductGroup } from './useCatalogList';
import { isDecimalLessThanOrEqual } from '../inventory/exactDecimal';

export type SortColumn = 'name' | 'category' | 'stock' | 'minStock' | 'price';
export type SortDirection = 'asc' | 'desc';

export interface SortState {
  column: SortColumn;
  direction: SortDirection;
}

/** -1 / 0 / 1, by VALUE, via the shared exact-decimal comparator. */
function compareExactDecimal(a: string, b: string): number {
  const aLeB = isDecimalLessThanOrEqual(a, b);
  const bLeA = isDecimalLessThanOrEqual(b, a);
  if (aLeB && bLeA) return 0;
  return aLeB ? -1 : 1;
}

/**
 * The lowest minimum_stock among a group's variants — there is no
 * product-level minimum stock (the table shows a muted dash there
 * deliberately, per WS-D-9: 0 is a real "never warn" setting, not an
 * aggregate). Sorting on the low end mirrors how the price column already
 * summarises a product row: "cheapest"/"lowest floor" across its variants.
 */
function lowestMinimumStock(group: CatalogProductGroup): string {
  let lowest = group.variants[0]?.minimum_stock ?? '0';
  for (const v of group.variants) {
    if (isDecimalLessThanOrEqual(v.minimum_stock, lowest)) lowest = v.minimum_stock;
  }
  return lowest;
}

export function sortGroups(
  groups: CatalogProductGroup[],
  sort: SortState | null,
  locale: string,
): CatalogProductGroup[] {
  if (!sort) return groups;
  const collator = new Intl.Collator(locale, { sensitivity: 'base', numeric: true });
  const sign = sort.direction === 'asc' ? 1 : -1;

  const compared = [...groups].sort((a, b) => {
    switch (sort.column) {
      case 'name':
        return sign * collator.compare(a.productName, b.productName);
      case 'category':
        return sign * collator.compare(a.categoryName ?? '', b.categoryName ?? '');
      case 'stock':
        return sign * compareExactDecimal(a.totalStock, b.totalStock);
      case 'minStock':
        return sign * compareExactDecimal(lowestMinimumStock(a), lowestMinimumStock(b));
      case 'price':
        return sign * compareExactDecimal(a.lowestPrice, b.lowestPrice);
      default:
        return 0;
    }
  });
  return compared;
}
