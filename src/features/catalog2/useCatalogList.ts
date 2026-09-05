/**
 * WS-D-9 — fetch / filter / paginate / group state for the new Catalog page.
 *
 * Filters stay 100% SERVER-SIDE (search, category, include-inactive,
 * warehouse), and any filter change resets the offset to 0. The target is
 * 5,000 products and ~17,500 variants: nothing is ever fetched wholesale and
 * filtered in React.
 *
 * GROUPING vs PAGINATION — a real constraint, surfaced rather than hidden.
 * `catalog.list_products_v2` pages over VARIANTS, 50 at a time, and there is
 * no product-level paginated function. Rows are therefore grouped WITHIN the
 * fetched page, which means a product whose variants straddle a page boundary
 * legitimately appears on both pages. `mayContinue` marks the groups that can
 * be affected — the first group when there is a previous page, the last when
 * there is a next one — so the UI can say so instead of pretending otherwise.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';

import { useAppData } from '../../app/AppDataContext';
import { useErrorText } from '../../shared/hooks/useErrorText';
import * as ipc from '../../shared/ipc/gateway';
import type { ProductListItemV2, ReferenceLifecycleItem } from '../../shared/ipc/dto';
import { isDecimalLessThanOrEqual, sumExactDecimals } from '../inventory/exactDecimal';

export const CATALOG2_PAGE_SIZE = 50;

export interface CatalogProductGroup {
  productId: number;
  productName: string;
  categoryName: string | null;
  productIsActive: boolean;
  variants: ProductListItemV2[];
  /** Exact-decimal sum of the variant quantities on this page. Never JS `+`. */
  totalStock: string;
  lowestPrice: string;
  highestPrice: string;
  /** This product's variants may extend onto an adjacent page. */
  mayContinue: boolean;
}

/** Groups variant rows by product, preserving the backend's row order. */
export function groupByProduct(
  rows: ProductListItemV2[],
  options: { hasPreviousPage: boolean; hasNextPage: boolean },
): CatalogProductGroup[] {
  const order: number[] = [];
  const byProduct = new Map<number, ProductListItemV2[]>();

  for (const row of rows) {
    const existing = byProduct.get(row.product_id);
    if (existing) {
      existing.push(row);
    } else {
      order.push(row.product_id);
      byProduct.set(row.product_id, [row]);
    }
  }

  return order.map((productId, index) => {
    const variants = byProduct.get(productId)!;
    const first = variants[0];
    const prices = variants.map((v) => v.sale_price);
    let lowest = prices[0];
    let highest = prices[0];
    for (const price of prices) {
      if (isDecimalLessThanOrEqual(price, lowest)) lowest = price;
      if (isDecimalLessThanOrEqual(highest, price)) highest = price;
    }
    return {
      productId,
      productName: first.product_name,
      categoryName: first.category_name,
      productIsActive: first.product_is_active,
      variants,
      totalStock: sumExactDecimals(variants.map((v) => v.quantity_on_hand)),
      lowestPrice: lowest,
      highestPrice: highest,
      mayContinue:
        (index === 0 && options.hasPreviousPage)
        || (index === order.length - 1 && options.hasNextPage),
    };
  });
}

interface VariantFieldPatch {
  salePrice?: string;
  minimumStock?: string;
}

export function useCatalogList(token: string) {
  const errorText = useErrorText();
  const { warehouses, selectedWarehouseId, selectWarehouse } = useAppData();

  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);

  const [rows, setRows] = useState<ProductListItemV2[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [categories, setCategories] = useState<ReferenceLifecycleItem[]>([]);

  useEffect(() => {
    if (!token) return;
    let active = true;
    void ipc.listCategories(token)
      .then((cats) => { if (active) setCategories(cats); })
      .catch(() => {
        // A filter dropdown that fails to populate must not stop the list.
      });
    return () => { active = false; };
  }, [token]);

  // RULING 5: typed input is debounced at 300ms; a scanner's Enter bypasses
  // the timer entirely through submitSearch below.
  useEffect(() => {
    const timer = setTimeout(() => {
      setAppliedSearch(search.trim());
      setPageIndex(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  // A warehouse switch changes the whole result set (quantity_on_hand is
  // per-warehouse); always return to the first page.
  useEffect(() => {
    setPageIndex(0);
  }, [selectedWarehouseId]);

  const submitSearch = useCallback((event?: FormEvent) => {
    event?.preventDefault();
    setAppliedSearch(search.trim());
    setPageIndex(0);
  }, [search]);

  const changeCategory = useCallback((id: number | null) => {
    setCategoryId(id);
    setPageIndex(0);
  }, []);

  const changeIncludeInactive = useCallback((value: boolean) => {
    setIncludeInactive(value);
    setPageIndex(0);
  }, []);

  const load = useCallback(async () => {
    if (!token || selectedWarehouseId == null) {
      setRows([]);
      setTotalCount(0);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await ipc.listProductsV2(token, selectedWarehouseId, {
        search: appliedSearch || null,
        categoryId,
        includeInactive,
        limit: CATALOG2_PAGE_SIZE,
        offset: pageIndex * CATALOG2_PAGE_SIZE,
      });
      setRows(result);
      // total_count is the FULL result-set size, repeated on every row.
      setTotalCount(result[0]?.total_count ?? 0);
    } catch (err) {
      setRows([]);
      setTotalCount(0);
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  }, [token, selectedWarehouseId, appliedSearch, categoryId, includeInactive, pageIndex, errorText]);

  useEffect(() => {
    void load();
  }, [load]);

  const hasPreviousPage = pageIndex > 0;
  const hasNextPage = pageIndex * CATALOG2_PAGE_SIZE + rows.length < totalCount;

  const groups = useMemo(
    () => groupByProduct(rows, { hasPreviousPage, hasNextPage }),
    [rows, hasPreviousPage, hasNextPage],
  );

  /**
   * THE OVERWRITE TRAP.
   *
   * `catalog.update_variant` assigns name_override, sale_price, is_active and
   * minimum_stock unconditionally, so a commit carrying only the edited column
   * would blank the others. A `list_products_v2` row does NOT carry
   * `name_override` — it carries the EFFECTIVE name, which is derived — so
   * there is no way to reconstruct a correct payload from the table alone.
   * Sending `variant_name` as the override would invent an override where the
   * product had none.
   *
   * The commit therefore reads `get_product_detail` immediately before
   * writing, takes the untouched columns from that snapshot, and sends a full
   * payload. Commits are serialised so a second edit can never read a snapshot
   * that predates the first one and write its old value back.
   */
  const chain = useRef<Promise<void>>(Promise.resolve());

  const commitVariantField = useCallback(
    (variantId: number, productId: number, patch: VariantFieldPatch) => {
      const run = chain.current.catch(() => {}).then(async () => {
        const detail = await ipc.getProductDetail(token, productId);
        const current = detail.variants.find((v) => v.variant_id === variantId);
        if (!current) {
          throw new Error(`variant ${variantId} is no longer part of product ${productId}`);
        }
        await ipc.updateVariantV2(
          token,
          variantId,
          current.name_override,
          patch.salePrice !== undefined ? patch.salePrice : current.sale_price,
          current.is_active,
          patch.minimumStock !== undefined ? patch.minimumStock : current.minimum_stock,
        );
        // Patch the row locally rather than refetching the page: the two
        // editable columns are stored verbatim, nothing server-derived
        // depends on them, and a refetch per blur would be wasteful.
        setRows((prev) => prev.map((row) => (
          row.variant_id === variantId
            ? {
              ...row,
              ...(patch.salePrice !== undefined ? { sale_price: patch.salePrice } : {}),
              ...(patch.minimumStock !== undefined ? { minimum_stock: patch.minimumStock } : {}),
            }
            : row
        )));
      });
      chain.current = run.catch(() => {});
      return run;
    },
    [token],
  );

  return {
    warehouses, selectedWarehouseId, selectWarehouse,
    search, setSearch, submitSearch,
    categoryId, changeCategory,
    includeInactive, changeIncludeInactive,
    categories,
    groups, totalCount, rowCount: rows.length,
    loading, error,
    pageIndex, setPageIndex, pageSize: CATALOG2_PAGE_SIZE,
    hasPreviousPage, hasNextPage,
    reload: load,
    commitVariantField,
  };
}
