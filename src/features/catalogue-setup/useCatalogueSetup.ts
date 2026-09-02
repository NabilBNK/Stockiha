/**
 * WS-D-3 — data loading and mutation hook for the Catalogue Setup screen.
 * Mirrors the fetch/refetch pattern in src/features/products/useCatalog.ts:
 * each mutation re-fetches the list it affects so the UI always reflects
 * the server's current usage_count and active state.
 */
import { useCallback, useState } from 'react';

import { useErrorText } from '../../shared/hooks/useErrorText';
import * as ipc from '../../shared/ipc/gateway';
import type {
  AttributeValueLifecycleItem,
  ReferenceLifecycleItem,
  UnitLifecycleItem,
} from '../../shared/ipc/dto';

export function useCatalogueSetup(token: string) {
  const errorText = useErrorText();

  const [categories, setCategories] = useState<ReferenceLifecycleItem[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [categoriesError, setCategoriesError] = useState<string | null>(null);

  const [units, setUnits] = useState<UnitLifecycleItem[]>([]);
  const [unitsLoading, setUnitsLoading] = useState(false);
  const [unitsError, setUnitsError] = useState<string | null>(null);

  const [attributes, setAttributes] = useState<ReferenceLifecycleItem[]>([]);
  const [attributeValues, setAttributeValues] = useState<AttributeValueLifecycleItem[]>([]);
  const [attributesLoading, setAttributesLoading] = useState(false);
  const [attributesError, setAttributesError] = useState<string | null>(null);

  const loadCategories = useCallback(async () => {
    if (!token) return;
    setCategoriesLoading(true);
    setCategoriesError(null);
    try {
      setCategories(await ipc.listCategories(token));
    } catch (err) {
      setCategoriesError(errorText(err));
    } finally {
      setCategoriesLoading(false);
    }
  }, [token, errorText]);

  const loadUnits = useCallback(async () => {
    if (!token) return;
    setUnitsLoading(true);
    setUnitsError(null);
    try {
      setUnits(await ipc.listUnitsV2(token));
    } catch (err) {
      setUnitsError(errorText(err));
    } finally {
      setUnitsLoading(false);
    }
  }, [token, errorText]);

  const loadAttributes = useCallback(async () => {
    if (!token) return;
    setAttributesLoading(true);
    setAttributesError(null);
    try {
      const [attrs, values] = await Promise.all([
        ipc.listAttributesV2(token),
        ipc.listAttributeValues(token),
      ]);
      setAttributes(attrs);
      setAttributeValues(values);
    } catch (err) {
      setAttributesError(errorText(err));
    } finally {
      setAttributesLoading(false);
    }
  }, [token, errorText]);

  const loadAll = useCallback(async () => {
    await Promise.all([loadCategories(), loadUnits(), loadAttributes()]);
  }, [loadCategories, loadUnits, loadAttributes]);

  // Categories
  const createCategory = useCallback(async (name: string) => {
    await ipc.createCategory(token, name);
    await loadCategories();
  }, [token, loadCategories]);

  const renameCategory = useCallback(async (id: number, name: string) => {
    await ipc.renameCategory(token, id, name);
    await loadCategories();
  }, [token, loadCategories]);

  const setCategoryActive = useCallback(async (id: number, isActive: boolean) => {
    await ipc.setCategoryActive(token, id, isActive);
    await loadCategories();
  }, [token, loadCategories]);

  const deleteCategory = useCallback(async (id: number) => {
    await ipc.deleteCategory(token, id);
    await loadCategories();
  }, [token, loadCategories]);

  // Units
  const createUnit = useCallback(async (code: string, name: string) => {
    await ipc.createUnit(token, code, name);
    await loadUnits();
  }, [token, loadUnits]);

  const renameUnit = useCallback(async (id: number, code: string, name: string) => {
    await ipc.renameUnit(token, id, code, name);
    await loadUnits();
  }, [token, loadUnits]);

  const setUnitActive = useCallback(async (id: number, isActive: boolean) => {
    await ipc.setUnitActive(token, id, isActive);
    await loadUnits();
  }, [token, loadUnits]);

  const deleteUnit = useCallback(async (id: number) => {
    await ipc.deleteUnit(token, id);
    await loadUnits();
  }, [token, loadUnits]);

  // Attributes
  const createAttribute = useCallback(async (name: string) => {
    await ipc.createAttribute(token, name);
    await loadAttributes();
  }, [token, loadAttributes]);

  const renameAttribute = useCallback(async (id: number, name: string) => {
    await ipc.renameAttribute(token, id, name);
    await loadAttributes();
  }, [token, loadAttributes]);

  const setAttributeActive = useCallback(async (id: number, isActive: boolean) => {
    await ipc.setAttributeActive(token, id, isActive);
    await loadAttributes();
  }, [token, loadAttributes]);

  const deleteAttribute = useCallback(async (id: number) => {
    await ipc.deleteAttribute(token, id);
    await loadAttributes();
  }, [token, loadAttributes]);

  // Attribute values
  const addAttributeValue = useCallback(async (attributeId: number, value: string) => {
    await ipc.addAttributeValue(token, attributeId, value);
    await loadAttributes();
  }, [token, loadAttributes]);

  const renameAttributeValue = useCallback(async (id: number, value: string) => {
    await ipc.renameAttributeValue(token, id, value);
    await loadAttributes();
  }, [token, loadAttributes]);

  const setAttributeValueActive = useCallback(async (id: number, isActive: boolean) => {
    await ipc.setAttributeValueActive(token, id, isActive);
    await loadAttributes();
  }, [token, loadAttributes]);

  const deleteAttributeValue = useCallback(async (id: number) => {
    await ipc.deleteAttributeValue(token, id);
    await loadAttributes();
  }, [token, loadAttributes]);

  return {
    categories, categoriesLoading, categoriesError,
    units, unitsLoading, unitsError,
    attributes, attributeValues, attributesLoading, attributesError,
    loadAll,
    createCategory, renameCategory, setCategoryActive, deleteCategory,
    createUnit, renameUnit, setUnitActive, deleteUnit,
    createAttribute, renameAttribute, setAttributeActive, deleteAttribute,
    addAttributeValue, renameAttributeValue, setAttributeValueActive, deleteAttributeValue,
  };
}
