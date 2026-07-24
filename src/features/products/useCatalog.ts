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
      const [attrs, us] = await Promise.all([
        ipc.listAttributes(token),
        ipc.listUnits(token),
      ]);
      setAttributes(attrs);
      setUnits(us);
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

  const createProductWithVariants = useCallback(async (
    name: string, isActive: boolean, variants: VariantInput[],
  ) => {
    return ipc.createProductWithVariants(token, name, isActive, variants);
  }, [token]);

  const updateProduct = useCallback(async (productId: number, name: string, isActive: boolean) => {
    return ipc.updateProduct(token, productId, name, isActive);
  }, [token]);

  const addVariant = useCallback(async (productId: number, variant: VariantInput) => {
    return ipc.addVariant(token, productId, variant);
  }, [token]);

  const updateVariant = useCallback(async (
    variantId: number, sku: string, salePrice: string, isActive: boolean,
  ) => {
    return ipc.updateVariant(token, variantId, sku, salePrice, isActive);
  }, [token]);

  const setVariantActive = useCallback(async (variantId: number, isActive: boolean) => {
    return ipc.setVariantActive(token, variantId, isActive);
  }, [token]);

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

  const setVariantBaseUnit = useCallback(async (variantId: number, unitId: number) => {
    return ipc.setVariantBaseUnit(token, variantId, unitId);
  }, [token]);

  const addVariantAltUnit = useCallback(async (
    variantId: number, unitId: number, conversionFactor: string,
  ) => {
    return ipc.addVariantAltUnit(token, variantId, unitId, conversionFactor);
  }, [token]);

  const removeVariantAltUnit = useCallback(async (variantUnitId: number) => {
    return ipc.removeVariantAltUnit(token, variantUnitId);
  }, [token]);

  const addVariantBarcode = useCallback(async (variantId: number, barcode: string) => {
    return ipc.addVariantBarcode(token, variantId, barcode);
  }, [token]);

  const removeVariantBarcode = useCallback(async (barcodeId: number) => {
    return ipc.removeVariantBarcode(token, barcodeId);
  }, [token]);

  return {
    // state
    products, productsLoading, productsError,
    attributes, units, refLoading,
    detail, detailLoading, detailError,
    // loaders
    loadProducts, loadRefData, loadDetail,
    // mutations
    createProductWithVariants, updateProduct,
    addVariant, updateVariant, setVariantActive,
    createAttribute, addAttributeValue, setVariantAttributes,
    createUnit, setVariantBaseUnit,
    addVariantAltUnit, removeVariantAltUnit,
    addVariantBarcode, removeVariantBarcode,
  };
}
