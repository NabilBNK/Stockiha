/**
 * WS-D-4 — state and fetching for the variant-level products list. Mirrors
 * the debounced-search / server-paginated shape of
 * src/features/inventory/InventoryScreen.tsx (warehouse from AppDataContext,
 * search+appliedSearch+300ms debounce) and the fetch/refetch shape of
 * src/features/catalogue-setup/useCatalogueSetup.ts.
 *
 * total_count on list_products_v2 rows is the FULL result-set size (same
 * value repeated on every row), read off row [0] — never the page length.
 */
import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { useAppData } from '../../app/AppDataContext';
import { useErrorText } from '../../shared/hooks/useErrorText';
import * as ipc from '../../shared/ipc/gateway';
import type { ProductListItemV2, ReferenceLifecycleItem } from '../../shared/ipc/dto';

export const PRODUCTS_LIST_PAGE_SIZE = 50;

export function useProductsList(token: string) {
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
      .then((cats) => {
        if (!active) return;
        setCategories(cats);
      })
      .catch(() => {
        // Filter dropdowns are non-fatal; the list itself still loads.
      });
    return () => {
      active = false;
    };
  }, [token]);

  // Debounced search, promoted to appliedSearch after 300ms of no typing.
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

  function submitSearch(event?: FormEvent) {
    event?.preventDefault();
    setAppliedSearch(search.trim());
    setPageIndex(0);
  }

  function changeCategory(id: number | null) {
    setCategoryId(id);
    setPageIndex(0);
  }

  function changeIncludeInactive(value: boolean) {
    setIncludeInactive(value);
    setPageIndex(0);
  }

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
        limit: PRODUCTS_LIST_PAGE_SIZE,
        offset: pageIndex * PRODUCTS_LIST_PAGE_SIZE,
      });
      setRows(result);
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

  return {
    warehouses, selectedWarehouseId, selectWarehouse,
    search, setSearch, submitSearch,
    categoryId, changeCategory,
    includeInactive, changeIncludeInactive,
    categories,
    rows, totalCount, loading, error,
    pageIndex, setPageIndex,
    pageSize: PRODUCTS_LIST_PAGE_SIZE,
    reload: load,
  };
}
