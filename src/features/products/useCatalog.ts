/**
 * Slice 2 — catalog data loading and mutation hook.
 */
import { useCallback, useState } from 'react';

import { useErrorText } from '../../shared/hooks/useErrorText';
import * as ipc from '../../shared/ipc/gateway';
import type {
  AttributeDefinition,
  CatalogProduct,
  ProductDetail,
  ReferenceLifecycleItem,
  Unit,
  VariantInput,
} from '../../shared/ipc/dto';

export function useCatalog(token: string) {
  const errorText = useErrorText();

  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [productsError, setProductsError] = useState<string | null>(null);
  const [attributes, setAttributes] = useState<AttributeDefinition[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  // WS-D-5: categories are a PRODUCT-level reference type, offered in the
  // product form's category picker. Only active ones are selectable.
  const [categories, setCategories] = useState<ReferenceLifecycleItem[]>([]);
  const [refLoading, setRefLoading] = useState(false);
  const [detail, setDetail] = useState<ProductDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const loadProducts = useCallback(async (search?: string) => {
    if (!token) return;
    setProductsLoading(true);
    setProductsError(null);
    try {
      setProducts(await ipc.listCatalogProducts(token, search));
    } catch (err) {
      setProductsError(errorText(err));
    } finally {
      setProductsLoading(false);
    }
  }, [token, errorText]);

  const loadRefData = useCallback(async () => {
    if (!token) return;
    setRefLoading(true);
    try {
      const [attrs, us, cats] = await Promise.all([
        ipc.listAttributes(token),
        ipc.listUnits(token),
        ipc.listCategories(token),
      ]);
      setAttributes(attrs);
      setUnits(us);
      setCategories(cats);
    } catch {
      // ref data load failure is non-fatal; leave previous state
    } finally {
      setRefLoading(false);
    }
  }, [token]);

  const loadDetail = useCallback(async (productId: number) => {
    if (!token) return;
    setDetailLoading(true);
    setDetailError(null);
    setDetail(null);
    try {
      setDetail(await ipc.getProductDetail(token, productId));
    } catch (err) {
      setDetailError(errorText(err));
    } finally {
      setDetailLoading(false);
    }
  }, [token, errorText]);

  /**
   * WS-D-8a — reload the detail WITHOUT blanking it first.
   *
   * `loadDetail` clears `detail` and raises `detailLoading`, which is right for
   * an initial open but wrong after a field-level autosave commit: the panel
   * would collapse to a spinner on every blur. This refetches in place so
   * server-derived values (effective variant name, operational identifier,
   * attribute assignments) stay current without the panel flashing.
   */
  const refreshDetail = useCallback(async (productId: number) => {
    if (!token) return;
    try {
      setDetail(await ipc.getProductDetail(token, productId));
    } catch (err) {
      setDetailError(errorText(err));
    }
  }, [token, errorText]);

  const createProductWithVariants = useCallback(async (
    name: string, unitId: number, isActive: boolean, variants: VariantInput[],
  ) => {
    return ipc.createProductWithVariants(token, name, unitId, isActive, variants);
  }, [token]);

  const updateProduct = useCallback(async (productId: number, name: string, unitId: number, isActive: boolean) => {
    return ipc.updateProduct(token, productId, name, unitId, isActive);
  }, [token]);

  const addVariant = useCallback(async (productId: number, variant: VariantInput) => {
    return ipc.addVariant(token, productId, variant);
  }, [token]);

  const updateVariant = useCallback(async (
    variantId: number, nameOverride: string | null, salePrice: string, isActive: boolean,
  ) => {
    return ipc.updateVariant(token, variantId, nameOverride, salePrice, isActive);
  }, [token]);

  const setVariantActive = useCallback(async (variantId: number, isActive: boolean) => {
    return ipc.setVariantActive(token, variantId, isActive);
  }, [token]);

  /**
   * WS-D-5 — `catalog.quick_create_product`: one product + its first variant,
   * with the product-level category and the variant's barcode and minimum
   * stock, in a single authoritative call. `salePrice` and `minimumStock` are
   * exact decimal strings and are forwarded verbatim; this layer never parses,
   * rounds, or defaults them (ws-d-skill.md section 6).
   */
  const quickCreateProduct = useCallback(async (input: ipc.QuickCreateProductInput) => {
    return ipc.quickCreateProduct(token, input);
  }, [token]);

  /**
   * WS-D-5B — the 6-argument `catalog.update_product` overload (adds
   * category_id). The caller must pass the product's CURRENT category when the
   * user did not change it: the SQL assigns `category_id = p_category_id`
   * unconditionally, so a null here clears the category.
   */
  const updateProductV2 = useCallback(async (
    productId: number,
    name: string,
    unitId: number,
    isActive: boolean,
    categoryId: number | null,
  ) => {
    return ipc.updateProductV2(token, productId, name, unitId, isActive, categoryId);
  }, [token]);

  /** WS-D-5 — the 6-argument `catalog.update_variant` overload (adds minimum_stock). */
  const updateVariantV2 = useCallback(async (
    variantId: number,
    nameOverride: string | null,
    salePrice: string,
    isActive: boolean,
    minimumStock: string,
  ) => {
    return ipc.updateVariantV2(token, variantId, nameOverride, salePrice, isActive, minimumStock);
  }, [token]);

  /**
   * WS-D-5 inline create shortcut. Create-only by design (D-0 ruling): the
   * product form may add a category and select it immediately, but rename,
   * deactivate and delete stay exclusively on the Catalogue Setup screen.
   * Refreshes the picker so the new item is present before it is selected.
   */
  const createCategory = useCallback(async (name: string) => {
    const id = await ipc.createCategory(token, name);
    await loadRefData();
    return id;
  }, [token, loadRefData]);

  const createAttribute = useCallback(async (name: string) => {
    const id = await ipc.createAttribute(token, name);
    await loadRefData();
    return id;
  }, [token, loadRefData]);

  const addAttributeValue = useCallback(async (attributeId: number, value: string) => {
    const id = await ipc.addAttributeValue(token, attributeId, value);
    await loadRefData();
    return id;
  }, [token, loadRefData]);

  const setVariantAttributes = useCallback(async (variantId: number, attrValueIds: number[]) => {
    return ipc.setVariantAttributes(token, variantId, attrValueIds);
  }, [token]);

  const createUnit = useCallback(async (code: string, name: string) => {
    const id = await ipc.createUnit(token, code, name);
    await loadRefData();
    return id;
  }, [token, loadRefData]);

  const addVariantBarcode = useCallback(async (variantId: number, barcode: string) => {
    return ipc.addVariantBarcode(token, variantId, barcode);
  }, [token]);

  const removeVariantBarcode = useCallback(async (barcodeId: number) => {
    return ipc.removeVariantBarcode(token, barcodeId);
  }, [token]);

  return {
    // state
    products, productsLoading, productsError,
    attributes, units, categories, refLoading,
    detail, detailLoading, detailError,
    // loaders
    loadProducts, loadRefData, loadDetail, refreshDetail,
    // mutations
    createProductWithVariants, updateProduct,
    addVariant, updateVariant, setVariantActive,
    createAttribute, addAttributeValue, setVariantAttributes,
    createUnit, createCategory,
    addVariantBarcode, removeVariantBarcode,
    // WS-D-5 / WS-D-5B — v2 write layer
    quickCreateProduct, updateProductV2, updateVariantV2,
  };
}

/** WS-D-8a — the catalog controller, shared by the products workspace. */
export type CatalogController = ReturnType<typeof useCatalog>;
