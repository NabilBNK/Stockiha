/**
 * Touchscreen POS. Cash checkout remains the established Slice 1 path; Slice 4
 * adds customer-aware credit checkout and manager override escalation.
 * Financial eligibility and posted totals remain database-authoritative.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Banner, Button, ConfirmDialog, Spinner } from '../../shared/components';
import { useI18n, type Locale } from '../../shared/i18n';
import { codeForError, useErrorText } from '../../shared/hooks/useErrorText';
import { useLicence } from '../../shared/licence/LicenceContext';
import { useSession } from '../../shared/session/SessionContext';
import { useAppData } from '../../app/AppDataContext';
import * as ipc from '../../shared/ipc/gateway';
import { getCustomerCapabilities, listCustomers } from '../../shared/ipc/customerGateway';
import { authorizeCreditOverride, confirmCreditSale } from '../../shared/ipc/creditSaleGateway';
import type { Customer, CustomerCapabilities } from '../../shared/ipc/customerDto';
import type { CreditSaleResult } from '../../shared/ipc/creditSaleDto';
import type { ProductListItem, ProductListItemV2, ReferenceLifecycleItem, VariantAttributeDto } from '../../shared/ipc/dto';
import { addExactMoney, compareExactMoney, isValidMoneyString, multiplyMoneyByQuantity } from '../../shared/money/exactMoney';
import { formatExactDecimal, isExactDecimalPositive, isExactDecimalZero, subtractExactDecimal } from '../inventory/exactDecimal';
import { ReceiptView } from '../documents/ReceiptView';
import { resolveBarcodeFirst } from '../../shared/search/barcodeFirstSearch';
import { ItemSearchModal } from '../../shared/components/ItemSearchModal';
import { printSaleReceipt, type PrintOutcome } from './printReceipt';
import { useOfficialDocumentContext } from '../../shared/documents/useOfficialDocumentContext';
import { formatReceiptItemName, type ReceiptLineInput } from './receiptBuilder';
import { multiplyExactDecimal, packRate } from '../../shared/utils/packMath';
import type { PrintingSettingsDto, SaleLineInput } from '../../shared/ipc/dto';

export interface SellablePack {
  unitId: number;
  unitName: string;
  factor: string;
  factorNum: number;
  salePrice: string;
  isPrimary?: boolean;
}

export interface BaseCartLine {
  kind: 'BASE';
  variantId: number;
  sku: string;
  name: string;
  unitPrice: string;
  listPrice: string;
  qty: number;
  productName?: string;
  variantName?: string;
  attributes?: VariantAttributeDto[];
  productSalePrice?: string;
  baseUnitName?: string;
  baseIsWhole?: boolean;
  wac?: string | null;
  packs?: SellablePack[];
  priceOverridden?: boolean;
  editingPrice?: boolean;
  tempPrice?: string;
}

export interface PackCartLine {
  kind: 'PACK';
  variantId: number;
  sku: string;
  name: string;
  unitPrice: string;
  listPrice: string;
  qty: number;
  packQuantity: number;
  extraQuantity: number;
  pack: SellablePack;
  productName?: string;
  variantName?: string;
  attributes?: VariantAttributeDto[];
  productSalePrice?: string;
  baseUnitName?: string;
  baseIsWhole?: boolean;
  wac?: string | null;
  packs?: SellablePack[];
  priceOverridden?: boolean;
  editingPrice?: boolean;
  tempPrice?: string;
}

export type CartLine = BaseCartLine | PackCartLine;

type PaymentMode = 'cash' | 'credit';

const CREDIT_COPY: Record<Locale, Record<string, string>> = {
  en: {
    payment: 'Payment', cash: 'Cash', credit: 'Credit', customer: 'Customer',
    chooseCustomer: 'Choose a credit customer', exposure: 'Exposure', available: 'Available credit',
    limit: 'Credit limit', creditConfirm: 'Confirm this customer credit sale?',
    creditPosted: 'Credit sale posted', due: 'Due date', newExposure: 'New exposure',
    noCreditCustomers: 'No active credit-enabled customers.', managerOverride: 'Manager override',
    managerUsername: 'Manager username', managerPassword: 'Manager password', reason: 'Authorization reason',
    authorize: 'Authorize', overrideReady: 'Manager override authorized. Confirm the unchanged sale again.',
    overrideFields: 'Manager username, password, and authorization reason are required.',
  },
  fr: {
    payment: 'Paiement', cash: 'Espèces', credit: 'Crédit', customer: 'Client',
    chooseCustomer: 'Choisir un client autorisé au crédit', exposure: 'Encours', available: 'Crédit disponible',
    limit: 'Plafond de crédit', creditConfirm: 'Confirmer cette vente à crédit ?',
    creditPosted: 'Vente à crédit enregistrée', due: 'Échéance', newExposure: 'Nouvel encours',
    noCreditCustomers: 'Aucun client actif autorisé au crédit.', managerOverride: 'Autorisation responsable',
    managerUsername: 'Utilisateur responsable', managerPassword: 'Mot de passe responsable', reason: 'Motif de l’autorisation',
    authorize: 'Autoriser', overrideReady: 'Autorisation accordée. Confirmez à nouveau la vente inchangée.',
    overrideFields: 'Utilisateur, mot de passe et motif du responsable sont obligatoires.',
  },
  ar: {
    payment: 'الدفع', cash: 'نقداً', credit: 'بالدين', customer: 'العميل',
    chooseCustomer: 'اختر عميلاً مسموحاً له بالائتمان', exposure: 'الدين الحالي', available: 'الائتمان المتاح',
    limit: 'حد الائتمان', creditConfirm: 'تأكيد البيع بالدين لهذا العميل؟',
    creditPosted: 'تم تسجيل البيع بالدين', due: 'تاريخ الاستحقاق', newExposure: 'الدين الجديد',
    noCreditCustomers: 'لا يوجد عملاء نشطون مسموح لهم بالائتمان.', managerOverride: 'موافقة المسؤول',
    managerUsername: 'اسم مستخدم المسؤول', managerPassword: 'كلمة مرور المسؤول', reason: 'سبب الموافقة',
    authorize: 'موافقة', overrideReady: 'تمت موافقة المسؤول. أكد نفس عملية البيع مرة أخرى.',
    overrideFields: 'اسم المستخدم وكلمة المرور وسبب الموافقة مطلوبة.',
  },
};

function currentLocalDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function currentLocalTime(): string {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

function toProductListItem(row: ProductListItemV2): ProductListItem {
  return {
    product_id: row.product_id,
    variant_id: row.variant_id,
    sku: row.sku,
    name: row.variant_name || row.product_name,
    product_name: row.product_name,
    primary_barcode: row.primary_barcode,
    attributes: row.attributes,
    sale_price: row.sale_price,
    is_active: row.is_active,
    quantity_on_hand: row.quantity_on_hand,
    last_known_wac: row.last_known_wac,
    category_name: row.category_name,
  };
}

export function PosScreen({ onOpenLicence }: { onOpenLicence?: () => void } = {}) {
  const { t, locale } = useI18n();
  const creditText = CREDIT_COPY[locale];
  const { user, activeCashSession, workstationId } = useSession();
  const { selectedWarehouseId, selectWarehouse, openFiscalPeriod } = useAppData();
  const errorText = useErrorText();
  const { readOnly } = useLicence();
  const token = user?.token ?? '';

  const PAGE_SIZE = 60;
  const [products, setProducts] = useState<ProductListItemV2[]>([]);
  const [categories, setCategories] = useState<ReferenceLifecycleItem[]>([]);
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [catalogBusy, setCatalogBusy] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [advancedSearchOpen, setAdvancedSearchOpen] = useState(false);
  const [advancedSearchResults, setAdvancedSearchResults] = useState<ProductListItem[]>([]);
  const [advancedSearchLoading, setAdvancedSearchLoading] = useState(false);
  const [advancedSearchQuery, setAdvancedSearchQuery] = useState('');
  const [inStockOnly, setInStockOnly] = useState(true);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('cash');
  const [customerId, setCustomerId] = useState<number | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [saleIntentDate, setSaleIntentDate] = useState<string | null>(null);
  const [creditOverrideToken, setCreditOverrideToken] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [banner, setBanner] = useState<{ tone: 'error' | 'warning'; text: string } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [lastSaleDocId, setLastSaleDocId] = useState<number | null>(null);
  const [lastCreditSale, setLastCreditSale] = useState<CreditSaleResult | null>(null);
  const [printingSettings, setPrintingSettings] = useState<PrintingSettingsDto | null>(null);
  const { identity: printIdentity } = useOfficialDocumentContext(token);
  const [printOutcome, setPrintOutcome] = useState<PrintOutcome | null>(null);
  const [lastReceiptInput, setLastReceiptInput] = useState<Parameters<typeof printSaleReceipt>[0] | null>(null);
  const [capabilities, setCapabilities] = useState<CustomerCapabilities | null>(null);
  const [discount, setDiscount] = useState<string>('');
  const [discountOpen, setDiscountOpen] = useState<boolean>(false);

  const [overridePromptOpen, setOverridePromptOpen] = useState(false);
  const [overrideBusy, setOverrideBusy] = useState(false);
  const [managerUsername, setManagerUsername] = useState('');
  const [managerPassword, setManagerPassword] = useState('');
  const [overrideReason, setOverrideReason] = useState('');

  // Customers and categories load once. Neither depends on the search box.
  useEffect(() => {
    if (!token) return;
    setLoading(true);
    Promise.all([
      listCustomers(token, false).catch(() => []),
      ipc.listCategories(token).catch(() => []),
      ipc.getPrintingSettings(token).catch(() => null),
      getCustomerCapabilities(token).catch(() => null),
    ])
      .then(([customerRows, categoryRows, printingRow, capRow]) => {
        setCustomers(customerRows);
        setCategories(categoryRows.filter((category) => category.is_active));
        setPrintingSettings(printingRow);
        setCapabilities(capRow);
      })
      .finally(() => setLoading(false));
  }, [token]);

  const posWarehouseId = activeCashSession?.warehouse_id ?? selectedWarehouseId ?? 1;

  useEffect(() => {
    if (activeCashSession && selectedWarehouseId !== activeCashSession.warehouse_id) {
      selectWarehouse(activeCashSession.warehouse_id);
    }
  }, [activeCashSession, selectedWarehouseId, selectWarehouse]);

  // Products are fetched from the database for the current category and search
  // text, 60 at a time. The catalogue is never loaded into the browser whole.
  useEffect(() => {
    if (!token || posWarehouseId == null) return;
    let active = true;
    const timer = setTimeout(() => {
      setCatalogBusy(true);
      ipc
        .listProductsV2(token, posWarehouseId, {
          search: search.trim() || null,
          categoryId,
          includeInactive: false,
          limit: PAGE_SIZE,
          offset: 0,
        })
        .then((rows) => {
          if (!active) return;
          setProducts(rows);
          setHasMore(rows.length === PAGE_SIZE);
        })
        .catch(() => {
          if (!active) return;
          setProducts([]);
          setHasMore(false);
        })
        .finally(() => {
          if (active) setCatalogBusy(false);
        });
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [token, posWarehouseId, search, categoryId]);

  const loadMoreProducts = useCallback(async () => {
    if (!token || posWarehouseId == null || catalogBusy) return;
    setCatalogBusy(true);
    try {
      const rows = await ipc.listProductsV2(token, posWarehouseId, {
        search: search.trim() || null,
        categoryId,
        includeInactive: false,
        limit: PAGE_SIZE,
        offset: products.length,
      });
      setProducts((prev) => [...prev, ...rows]);
      setHasMore(rows.length === PAGE_SIZE);
    } catch {
      setHasMore(false);
    } finally {
      setCatalogBusy(false);
    }
  }, [token, posWarehouseId, search, categoryId, products.length, catalogBusy]);

  const refreshCatalog = useCallback(async () => {
    if (!token || posWarehouseId == null) return;
    try {
      const rows = await ipc.listProductsV2(token, posWarehouseId, {
        search: search.trim() || null,
        categoryId,
        includeInactive: false,
        limit: Math.max(PAGE_SIZE, products.length),
        offset: 0,
      });
      setProducts(rows);
      setHasMore(rows.length >= PAGE_SIZE);
    } catch {
      // ignore
    }
  }, [token, posWarehouseId, search, categoryId, products.length]);

  const displayedProducts = useMemo(() => {
    if (!inStockOnly) return products;
    return products.filter((p) => isExactDecimalPositive(p.quantity_on_hand ?? '0'));
  }, [products, inStockOnly]);

  // When filtering in-stock only, auto-fetch subsequent pages until we have at least PAGE_SIZE in-stock products
  // (or until there are no more pages in the catalog), so the operator isn't forced to click "Show more"
  // just because in-stock variants happen to be scattered across multiple backend pages.
  useEffect(() => {
    if (inStockOnly && hasMore && !catalogBusy && displayedProducts.length < PAGE_SIZE) {
      void loadMoreProducts();
    }
  }, [inStockOnly, hasMore, catalogBusy, displayedProducts.length, loadMoreProducts]);

  const invalidateSaleIntent = useCallback(() => {
    setRequestId(null);
    setSaleIntentDate(null);
    setCreditOverrideToken(null);
    setOverridePromptOpen(false);
    setManagerPassword('');
    setOverrideReason('');
    setBanner(null);
    setLastSaleDocId(null);
    setLastCreditSale(null);
    setPrintOutcome(null);
    setLastReceiptInput(null);
  }, []);

  const mutateCart = useCallback((next: (prev: CartLine[]) => CartLine[]) => {
    setCart(next);
    invalidateSaleIntent();
  }, [invalidateSaleIntent]);

  useEffect(() => {
    if (lastSaleDocId == null) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setLastSaleDocId(null);
        mutateCart(() => []);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [lastSaleDocId, mutateCart]);

  useEffect(() => {
    if (lastCreditSale == null) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setLastCreditSale(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [lastCreditSale]);

  function changePaymentMode(next: PaymentMode) {
    setPaymentMode(next);
    if (next === 'cash') setCustomerId(null);
    invalidateSaleIntent();
  }

  function selectCustomer(value: string) {
    setCustomerId(value ? Number(value) : null);
    invalidateSaleIntent();
  }

  const packCacheRef = useRef<Map<number, { packs: SellablePack[]; primaryPack: SellablePack | null }>>(new Map());

  const getPacksForVariant = useCallback(async (variantId: number): Promise<{ packs: SellablePack[]; primaryPack: SellablePack | null }> => {
    const cached = packCacheRef.current.get(variantId);
    if (cached) return cached;
    if (!token) return { packs: [], primaryPack: null };
    try {
      const rows = await ipc.listVariantPacks(token, variantId);
      const sellable: SellablePack[] = rows
        .filter((r) => r.is_pack && r.is_active && r.sale_price !== null)
        .map((r) => ({
          unitId: r.unit_id,
          unitName: r.unit_name,
          factor: r.conversion_factor,
          factorNum: Math.round(Number(r.conversion_factor)) || 1,
          salePrice: r.sale_price!,
          isPrimary: r.is_primary,
        }));
      const primary = sellable.find((p) => p.isPrimary) ?? null;
      const res = { packs: sellable, primaryPack: primary };
      packCacheRef.current.set(variantId, res);
      return res;
    } catch {
      return { packs: [], primaryPack: null };
    }
  }, [token]);

  /**
   * WS-D-15 A4 — the POS search box, on Enter, routes through the SAME
   * barcode-first resolver the global shell search uses
   * (src/shared/search/barcodeFirstSearch.ts). An exact match adds that
   * variant to the cart directly, no intermediate list, matched against the
   * warehouse's already-loaded `products` (POS's existing pattern — no new
   * IPC call for the fallback). Typing without Enter is UNCHANGED: it only
   * ever drives the existing client-side `filteredProducts` filter; this
   * handler never fires resolveBarcode on a keystroke.
   */
  async function handleSearchEnter() {
    const trimmed = search.trim();
    if (!trimmed || !token || posWarehouseId == null) return;

    const result = await resolveBarcodeFirst(token, trimmed);
    if (result.type !== 'match') {
      setBanner({ tone: 'warning', text: t('pos.barcodeNotFound', { query: trimmed }) });
      return;
    }

    // The scanned variant may not be on the current page, so fetch it by the
    // scanned value rather than searching the already-loaded rows.
    const matches = await ipc
      .listProductsV2(token, posWarehouseId, {
        search: trimmed,
        categoryId: null,
        includeInactive: false,
        limit: 5,
        offset: 0,
      })
      .catch(() => [] as ProductListItemV2[]);

    const matchedProduct = matches.find((row) => row.variant_id === result.resolved.variant_id);
    if (!matchedProduct) {
      setBanner({ tone: 'warning', text: t('pos.barcodeNotInWarehouse', { query: trimmed }) });
      return;
    }

    // WS-O-4 scanning behavior:
    if (result.resolved.pack_unit_id != null) {
      if (result.resolved.pack_is_active === false || result.resolved.pack_sale_price === null) {
        setBanner({ tone: 'warning', text: t('sale.pack.error.notSold') });
        return;
      }
      const targetPack: SellablePack = {
        unitId: result.resolved.pack_unit_id,
        unitName: result.resolved.pack_unit_name ?? '',
        factor: result.resolved.pack_factor ?? '1',
        factorNum: Math.round(Number(result.resolved.pack_factor)) || 1,
        salePrice: result.resolved.pack_sale_price,
      };
      const { packs } = await getPacksForVariant(matchedProduct.variant_id);
      mutateCart((prev) => {
        const existing = prev.find(
          (l) => l.variantId === matchedProduct.variant_id && l.kind === 'PACK' && l.pack.unitId === targetPack.unitId,
        ) as PackCartLine | undefined;
        if (existing) {
          return prev.map((l) => {
            if (l === existing) {
              const nextQty = existing.packQuantity + 1;
              return {
                ...existing,
                packQuantity: nextQty,
                qty: nextQty,
              };
            }
            return l;
          });
        }
        const newLine: PackCartLine = {
          kind: 'PACK',
          variantId: matchedProduct.variant_id,
          sku: matchedProduct.sku,
          name: displayNameOf(matchedProduct),
          unitPrice: targetPack.salePrice,
          listPrice: targetPack.salePrice,
          qty: 1,
          packQuantity: 1,
          extraQuantity: 0,
          pack: targetPack,
          productName: matchedProduct.product_name,
          variantName: matchedProduct.variant_name,
          attributes: matchedProduct.attributes,
          productSalePrice: matchedProduct.sale_price,
          wac: matchedProduct.last_known_wac || null,
          packs,
        };
        return [...prev, newLine];
      });
      setSearch('');
      setBanner(null);
      return;
    }

    void addToCart(matchedProduct);
    setSearch('');
    setBanner(null);
  }

  function displayNameOf(product: { product_name?: string; variant_name?: string }): string {
    const pName = (product.product_name ?? '').trim();
    const vName = (product.variant_name ?? '').trim();
    if (!vName || vName === pName) {
      return pName || vName;
    }
    if (pName && vName.toLowerCase().startsWith(pName.toLowerCase())) {
      return vName;
    }
    return pName ? `${pName} — ${vName}` : vName;
  }

  function applyAddToCart(
    item: {
      variant_id: number;
      sku: string;
      product_name: string;
      variant_name?: string;
      sale_price: string;
      attributes?: VariantAttributeDto[];
      last_known_wac?: string | null;
    },
    packs: SellablePack[],
    primaryPack: SellablePack | null,
  ) {
    mutateCart((prev) => {
      if (primaryPack) {
        const existing = prev.find(
          (l) => l.variantId === item.variant_id && l.kind === 'PACK' && l.pack.unitId === primaryPack.unitId,
        ) as PackCartLine | undefined;
        if (existing) {
          return prev.map((l) => {
            if (l === existing) {
              const nextQty = existing.packQuantity + 1;
              return {
                ...existing,
                packQuantity: nextQty,
                qty: nextQty,
              };
            }
            return l;
          });
        }
        const newLine: PackCartLine = {
          kind: 'PACK',
          variantId: item.variant_id,
          sku: item.sku,
          name: displayNameOf({ product_name: item.product_name, variant_name: item.variant_name }),
          unitPrice: primaryPack.salePrice,
          listPrice: primaryPack.salePrice,
          qty: 1,
          packQuantity: 1,
          extraQuantity: 0,
          pack: primaryPack,
          productName: item.product_name,
          variantName: item.variant_name,
          attributes: item.attributes,
          productSalePrice: item.sale_price,
          wac: item.last_known_wac || null,
          packs,
        };
        return [...prev, newLine];
      }

      const existing = prev.find((l) => l.variantId === item.variant_id && l.kind === 'BASE');
      if (existing) {
        return prev.map((l) => (l === existing ? { ...l, qty: l.qty + 1 } : l));
      }
      const newLine: BaseCartLine = {
        kind: 'BASE',
        variantId: item.variant_id,
        sku: item.sku,
        name: displayNameOf({ product_name: item.product_name, variant_name: item.variant_name }),
        unitPrice: item.sale_price,
        listPrice: item.sale_price,
        qty: 1,
        productName: item.product_name,
        variantName: item.variant_name,
        attributes: item.attributes,
        productSalePrice: item.sale_price,
        wac: item.last_known_wac || null,
        packs,
      };
      return [...prev, newLine];
    });
  }

  function addToCart(p: ProductListItemV2) {
    const cached = packCacheRef.current.get(p.variant_id);
    if (cached) {
      applyAddToCart(p, cached.packs, cached.primaryPack);
      return;
    }
    // Add synchronously first so UI is immediately responsive
    applyAddToCart(p, [], null);

    // Fetch packs asynchronously and upgrade if primary pack exists
    if (token) {
      void getPacksForVariant(p.variant_id).then(({ packs, primaryPack }) => {
        if (primaryPack) {
          mutateCart((prev) =>
            prev.map((l) => {
              if (l.variantId === p.variant_id && l.kind === 'BASE' && l.qty === 1 && !l.priceOverridden) {
                const packLine: PackCartLine = {
                  kind: 'PACK',
                  variantId: p.variant_id,
                  sku: p.sku,
                  name: displayNameOf(p),
                  unitPrice: primaryPack.salePrice,
                  listPrice: primaryPack.salePrice,
                  qty: 1,
                  packQuantity: 1,
                  extraQuantity: 0,
                  pack: primaryPack,
                  productName: p.product_name,
                  variantName: p.variant_name,
                  attributes: p.attributes,
                  productSalePrice: p.sale_price,
                  wac: p.last_known_wac || null,
                  packs,
                };
                return packLine;
              }
              if (l.variantId === p.variant_id && (!l.packs || l.packs.length === 0)) {
                return { ...l, packs };
              }
              return l;
            }),
          );
        } else if (packs.length > 0) {
          mutateCart((prev) =>
            prev.map((l) => (l.variantId === p.variant_id && (!l.packs || l.packs.length === 0) ? { ...l, packs } : l)),
          );
        }
      });
    }
  }

  function addProductListItemToCart(item: ProductListItem) {
    const cached = packCacheRef.current.get(item.variant_id);
    const itemAdapt = {
      variant_id: item.variant_id,
      sku: item.sku,
      product_name: item.product_name ?? item.name,
      variant_name: item.name,
      sale_price: item.sale_price,
      attributes: item.attributes,
      last_known_wac: item.last_known_wac,
    };
    if (cached) {
      applyAddToCart(itemAdapt, cached.packs, cached.primaryPack);
      return;
    }
    applyAddToCart(itemAdapt, [], null);

    if (token) {
      void getPacksForVariant(item.variant_id).then(({ packs, primaryPack }) => {
        if (primaryPack) {
          mutateCart((prev) =>
            prev.map((l) => {
              if (l.variantId === item.variant_id && l.kind === 'BASE' && l.qty === 1 && !l.priceOverridden) {
                const packLine: PackCartLine = {
                  kind: 'PACK',
                  variantId: item.variant_id,
                  sku: item.sku,
                  name: displayNameOf({ product_name: item.product_name, variant_name: item.name }),
                  unitPrice: primaryPack.salePrice,
                  listPrice: primaryPack.salePrice,
                  qty: 1,
                  packQuantity: 1,
                  extraQuantity: 0,
                  pack: primaryPack,
                  productName: item.product_name,
                  variantName: item.name,
                  attributes: item.attributes,
                  productSalePrice: item.sale_price,
                  wac: item.last_known_wac || null,
                  packs,
                };
                return packLine;
              }
              if (l.variantId === item.variant_id && (!l.packs || l.packs.length === 0)) {
                return { ...l, packs };
              }
              return l;
            }),
          );
        } else if (packs.length > 0) {
          mutateCart((prev) =>
            prev.map((l) => (l.variantId === item.variant_id && (!l.packs || l.packs.length === 0) ? { ...l, packs } : l)),
          );
        }
      });
    }
  }

  const loadAdvancedSearchResults = useCallback(
    async (query: string) => {
      if (!token || posWarehouseId == null) return;
      setAdvancedSearchLoading(true);
      try {
        const rows = await ipc.listProductsV2(token, posWarehouseId, {
          search: query.trim() || null,
          limit: 100,
          offset: 0,
        });
        setAdvancedSearchResults(rows.map(toProductListItem));
      } catch {
        setAdvancedSearchResults([]);
      } finally {
        setAdvancedSearchLoading(false);
      }
    },
    [token, posWarehouseId],
  );

  useEffect(() => {
    if (!advancedSearchOpen) return;
    const q = advancedSearchQuery.trim();
    if (!q) {
      void loadAdvancedSearchResults('');
      return;
    }
    const timer = setTimeout(() => {
      void loadAdvancedSearchResults(q);
    }, 250);
    return () => clearTimeout(timer);
  }, [advancedSearchOpen, advancedSearchQuery, loadAdvancedSearchResults]);

  function changeQty(variantId: number, delta: number) {
    mutateCart((prev) =>
      prev
        .map((l) => (l.variantId === variantId ? { ...l, qty: l.qty + delta } : l))
        .filter((l) => l.qty > 0),
    );
  }

  function removeLine(variantId: number) {
    mutateCart((prev) => prev.filter((l) => l.variantId !== variantId));
  }

  function switchToBase(variantId: number) {
    mutateCart((prev) =>
      prev.map((l) => {
        if (l.variantId !== variantId) return l;
        const pPrice = l.productSalePrice || l.unitPrice;
        const baseLine: BaseCartLine = {
          kind: 'BASE',
          variantId: l.variantId,
          sku: l.sku,
          name: l.name,
          unitPrice: pPrice,
          listPrice: pPrice,
          qty: 1,
          productName: l.productName,
          variantName: l.variantName,
          attributes: l.attributes,
          productSalePrice: l.productSalePrice,
          baseUnitName: l.baseUnitName,
          baseIsWhole: l.baseIsWhole,
          wac: l.wac,
          packs: l.packs,
          priceOverridden: false,
        };
        return baseLine;
      }),
    );
  }

  function switchToPack(variantId: number, targetPack: SellablePack) {
    mutateCart((prev) =>
      prev.map((l) => {
        if (l.variantId !== variantId) return l;
        const packLine: PackCartLine = {
          kind: 'PACK',
          variantId: l.variantId,
          sku: l.sku,
          name: l.name,
          unitPrice: targetPack.salePrice,
          listPrice: targetPack.salePrice,
          qty: 1,
          packQuantity: 1,
          extraQuantity: 0,
          pack: targetPack,
          productName: l.productName,
          variantName: l.variantName,
          attributes: l.attributes,
          productSalePrice: l.productSalePrice,
          baseUnitName: l.baseUnitName,
          baseIsWhole: l.baseIsWhole,
          wac: l.wac,
          packs: l.packs,
          priceOverridden: false,
        };
        return packLine;
      }),
    );
  }

  function changePackQty(variantId: number, delta: number) {
    mutateCart((prev) =>
      prev.map((l) => {
        if (l.variantId !== variantId || l.kind !== 'PACK') return l;
        const nextPackQty = l.packQuantity + delta;
        if (nextPackQty < 1) return l;
        return {
          ...l,
          packQuantity: nextPackQty,
          qty: nextPackQty,
        };
      }),
    );
  }

  function changeExtraQty(variantId: number, delta: number) {
    mutateCart((prev) =>
      prev.map((l) => {
        if (l.variantId !== variantId || l.kind !== 'PACK') return l;
        const nextRaw = l.extraQuantity + delta;
        if (nextRaw < 0) return l;
        const factor = l.pack.factorNum;
        if (nextRaw >= factor) {
          const carry = Math.floor(nextRaw / factor);
          const rem = nextRaw % factor;
          const nextPackQty = l.packQuantity + carry;
          return {
            ...l,
            packQuantity: nextPackQty,
            extraQuantity: rem,
            qty: nextPackQty,
          };
        }
        return {
          ...l,
          extraQuantity: nextRaw,
        };
      }),
    );
  }

  function startEditPrice(variantId: number) {
    mutateCart((prev) =>
      prev.map((l) =>
        l.variantId === variantId
          ? { ...l, editingPrice: true, tempPrice: l.unitPrice }
          : { ...l, editingPrice: false },
      ),
    );
  }

  function updateTempPrice(variantId: number, val: string) {
    mutateCart((prev) =>
      prev.map((l) => (l.variantId === variantId ? { ...l, tempPrice: val } : l)),
    );
  }

  function savePrice(variantId: number) {
    mutateCart((prev) =>
      prev.map((l) => {
        if (l.variantId !== variantId) return l;
        const trimmed = (l.tempPrice ?? '').trim();
        if (trimmed && isValidMoneyString(trimmed) && compareExactMoney(trimmed, '0.00') >= 0) {
          const isOverridden = trimmed !== l.listPrice;
          return {
            ...l,
            unitPrice: trimmed,
            priceOverridden: isOverridden,
            editingPrice: false,
          };
        }
        return { ...l, editingPrice: false };
      }),
    );
  }

  function cancelPrice(variantId: number) {
    mutateCart((prev) =>
      prev.map((l) => (l.variantId === variantId ? { ...l, editingPrice: false } : l)),
    );
  }

  function resetPrice(variantId: number) {
    mutateCart((prev) =>
      prev.map((l) => {
        if (l.variantId !== variantId) return l;
        return {
          ...l,
          unitPrice: l.listPrice,
          priceOverridden: false,
          editingPrice: false,
        };
      }),
    );
  }

  const lineTotalOf = useCallback((line: CartLine): string => {
    if (line.kind === 'PACK') {
      const packPart = multiplyMoneyByQuantity(line.unitPrice, line.packQuantity);
      if (line.extraQuantity > 0) {
        const rate = packRate(line.unitPrice, line.pack.factor, 0);
        const extraPart = multiplyMoneyByQuantity(rate, line.extraQuantity);
        return addExactMoney([packPart, extraPart]);
      }
      return packPart;
    }
    return multiplyMoneyByQuantity(line.unitPrice, line.qty);
  }, []);

  const provisionalTotal = useMemo(
    () => addExactMoney(cart.map(lineTotalOf)),
    [cart, lineTotalOf],
  );
  const canApplyDiscount = useMemo(
    () => (capabilities?.can_apply_sale_discount ?? false) && paymentMode === 'cash',
    [capabilities, paymentMode],
  );
  const trimmedDiscount = discount.trim();
  const discountValid = useMemo(() => {
    if (!trimmedDiscount) return true;
    if (!isValidMoneyString(trimmedDiscount)) return false;
    return compareExactMoney(trimmedDiscount, provisionalTotal) <= 0;
  }, [trimmedDiscount, provisionalTotal]);
  const hasDiscount = useMemo(
    () =>
      canApplyDiscount &&
      discountValid &&
      trimmedDiscount !== '' &&
      compareExactMoney(trimmedDiscount, '0.00') > 0,
    [canApplyDiscount, discountValid, trimmedDiscount],
  );
  const netTotal = useMemo(() => {
    if (!hasDiscount) return provisionalTotal;
    return addExactMoney([provisionalTotal, `-${trimmedDiscount}`]);
  }, [hasDiscount, provisionalTotal, trimmedDiscount]);

  const cartItemCount = useMemo(() => cart.reduce((sum, line) => sum + (line.kind === 'PACK' ? line.packQuantity : line.qty), 0), [cart]);
  const creditCustomers = useMemo(
    () => customers.filter((customer) => customer.is_active && customer.credit_enabled),
    [customers],
  );
  const selectedCustomer = useMemo(
    () => creditCustomers.find((customer) => customer.id === customerId) ?? null,
    [creditCustomers, customerId],
  );
  const creditOverBy = useMemo(() => {
    if (paymentMode !== 'credit' || !selectedCustomer) return null;
    const projected = addExactMoney([
      selectedCustomer.exposure_amount,
      netTotal,
      `-${selectedCustomer.credit_limit}`,
    ]);
    return projected.startsWith('-') || projected === '0.00' ? null : projected;
  }, [paymentMode, selectedCustomer, netTotal]);
  const saleLines: SaleLineInput[] = useMemo(
    () => cart.map((line) => {
      if (line.kind === 'PACK') {
        return {
          variant_id: line.variantId,
          sale_unit: 'PACK',
          pack_unit_id: line.pack.unitId,
          pack_quantity: String(line.packQuantity),
          ...(line.extraQuantity > 0 ? { extra_quantity: String(line.extraQuantity) } : {}),
          pack_price: line.unitPrice,
        };
      }
      return {
        variant_id: line.variantId,
        quantity: String(line.qty),
        unit_price: line.unitPrice,
      };
    }),
    [cart],
  );

  const runReceiptPrint = useCallback(
    async (documentNumber: string, customerName: string | null) => {
      const receiptLines: ReceiptLineInput[] = [];
      for (const l of cart) {
        const baseName = formatReceiptItemName({
          productName: l.productName,
          variantName: l.variantName,
          fallbackName: l.name,
          attributes: l.attributes,
        });
        if (l.kind === 'PACK') {
          const packTotal = multiplyMoneyByQuantity(l.unitPrice, l.packQuantity);
          receiptLines.push({
            name: baseName,
            qty: l.packQuantity,
            unitPrice: l.unitPrice,
            lineTotal: packTotal,
            detail: `${l.packQuantity} ${l.pack.unitName} (×${l.pack.factor}) × ${l.unitPrice}`,
          });
          if (l.extraQuantity > 0) {
            const rate = packRate(l.unitPrice, l.pack.factor, 0);
            const extraTotal = multiplyMoneyByQuantity(rate, l.extraQuantity);
            const baseUnit = l.baseUnitName || 'Unit';
            receiptLines.push({
              name: baseName,
              qty: l.extraQuantity,
              unitPrice: rate,
              lineTotal: extraTotal,
              detail: `${l.extraQuantity} ${baseUnit} × ${rate} (${l.pack.unitName} rate)`,
            });
          }
        } else {
          receiptLines.push({
            name: baseName,
            qty: l.qty,
            unitPrice: l.unitPrice,
            lineTotal: multiplyMoneyByQuantity(l.unitPrice, l.qty),
          });
        }
      }

      const input = {
        documentNumber,
        documentDate: currentLocalDate(),
        documentTime: currentLocalTime(),
        cashierName: user?.username ?? '',
        paymentLabel: paymentMode === 'cash' ? creditText.cash : creditText.credit,
        customerName,
        lines: receiptLines,
        subtotal: provisionalTotal,
        discount: hasDiscount ? trimmedDiscount : null,
        total: netTotal,
        currency: 'DZD',
        locale,
      };
      setLastReceiptInput(input);
      setPrintOutcome(await printSaleReceipt(input, printingSettings, printIdentity));
    },
    [cart, provisionalTotal, hasDiscount, trimmedDiscount, netTotal, locale, paymentMode, printingSettings, printIdentity, user, creditText],
  );

  async function confirmSale() {
    setConfirming(false);
    if (
      submitting || !token || !activeCashSession || openFiscalPeriod == null || cart.length === 0 ||
      (paymentMode === 'credit' && !selectedCustomer)
    ) return;

    const rid = requestId ?? ipc.newRequestId();
    const documentDate = saleIntentDate ?? currentLocalDate();
    setRequestId(rid);
    setSaleIntentDate(documentDate);
    setSubmitting(true);
    setBanner(null);

    try {
      if (paymentMode === 'credit' && selectedCustomer) {
        const result = await confirmCreditSale(token, {
          request_id: rid,
          customer_id: selectedCustomer.id,
          warehouse_id: activeCashSession.warehouse_id,
          fiscal_period_id: openFiscalPeriod.id,
          document_date: documentDate,
          lines: saleLines,
          override_token: creditOverrideToken,
        });
        setCustomers((rows) => rows.map((customer) => customer.id === selectedCustomer.id ? {
          ...customer,
          exposure_amount: result.exposure_amount,
          available_credit: result.available_credit,
        } : customer));
        const soldCart = [...cart];
        setProducts((prev) =>
          prev.map((p) => {
            const soldQty = soldCart
              .filter((l) => l.variantId === p.variant_id)
              .reduce((sum, l) => sum + (l.kind === 'PACK' ? l.packQuantity * l.pack.factorNum + l.extraQuantity : l.qty), 0);
            if (soldQty === 0) return p;
            const nextStock = subtractExactDecimal(p.quantity_on_hand ?? '0', String(soldQty));
            return { ...p, quantity_on_hand: nextStock };
          })
        );
        void refreshCatalog();
        setCart([]);
        setRequestId(null);
        setSaleIntentDate(null);
        setCreditOverrideToken(null);
        setLastSaleDocId(null);
        setLastCreditSale(result);
        void runReceiptPrint(result.document_number, selectedCustomer?.name ?? null);
      } else {
        const documentId = await ipc.confirmCashSale(token, {
          requestId: rid,
          cashSessionId: activeCashSession.id,
          warehouseId: activeCashSession.warehouse_id,
          fiscalPeriodId: openFiscalPeriod.id,
          documentDate,
          lines: saleLines,
          discountAmount: hasDiscount ? trimmedDiscount : null,
        });
        const soldCart = [...cart];
        setProducts((prev) =>
          prev.map((p) => {
            const soldQty = soldCart
              .filter((l) => l.variantId === p.variant_id)
              .reduce((sum, l) => sum + (l.kind === 'PACK' ? l.packQuantity * l.pack.factorNum + l.extraQuantity : l.qty), 0);
            if (soldQty === 0) return p;
            const nextStock = subtractExactDecimal(p.quantity_on_hand ?? '0', String(soldQty));
            return { ...p, quantity_on_hand: nextStock };
          })
        );
        void refreshCatalog();
        setCart([]);
        setDiscount('');
        setDiscountOpen(false);
        setRequestId(null);
        setSaleIntentDate(null);
        setCreditOverrideToken(null);
        setLastCreditSale(null);
        setLastSaleDocId(documentId);
        void runReceiptPrint(String(documentId), null);
      }
    } catch (err) {
      const code = codeForError(err);
      if (code === 'CREDIT_POLICY_BLOCKED' && paymentMode === 'credit') {
        setCreditOverrideToken(null);
        setBanner({ tone: 'error', text: errorText(err) });
        setOverridePromptOpen(true);
      } else if (code === 'PRECONDITION_FAILED' || code === 'INSUFFICIENT_STOCK') {
        setBanner({ tone: 'error', text: t('pos.insufficientStock') });
      } else if (code === 'UNKNOWN_ERROR') {
        setBanner({ tone: 'warning', text: t('stock.retryPrompt') });
      } else {
        setBanner({ tone: 'error', text: errorText(err) });
      }
    } finally {
      setSubmitting(false);
      setConfirming(false);
    }
  }

  async function authorizeManagerOverride() {
    if (
      overrideBusy || !selectedCustomer || !activeCashSession || !openFiscalPeriod ||
      !requestId || !saleIntentDate
    ) return;

    if (!managerUsername.trim() || !managerPassword || !overrideReason.trim()) {
      setBanner({ tone: 'error', text: creditText.overrideFields });
      return;
    }

    setOverrideBusy(true);
    setBanner(null);
    let managerToken: string | null = null;
    try {
      const managerSession = await ipc.login(managerUsername.trim(), managerPassword, workstationId);
      managerToken = managerSession.session_token;
      const overrideToken = await authorizeCreditOverride(managerToken, {
        token_id: ipc.newRequestId(),
        customer_id: selectedCustomer.id,
        warehouse_id: activeCashSession.warehouse_id,
        fiscal_period_id: openFiscalPeriod.id,
        document_date: saleIntentDate,
        lines: saleLines,
        reason: overrideReason.trim(),
        ttl_minutes: 15,
      });
      setCreditOverrideToken(overrideToken);
      setOverridePromptOpen(false);
      setManagerPassword('');
      setOverrideReason('');
      setBanner({ tone: 'warning', text: creditText.overrideReady });
    } catch (err) {
      setBanner({ tone: 'error', text: errorText(err) });
    } finally {
      if (managerToken) {
        await ipc.logout(managerToken).catch(() => undefined);
      }
      setOverrideBusy(false);
    }
  }

  if (readOnly) {
    return (
      <section className="sk-page">
        <h1>{t('pos.title')}</h1>
        <div className="sk-card" data-testid="pos-licence-blocked">
          <h2>{t('licence.posBlockedTitle')}</h2>
          <p>{t('licence.posBlockedBody')}</p>
          <Button type="button" onClick={onOpenLicence}>
            {t('licence.open')}
          </Button>
        </div>
      </section>
    );
  }

  if (!activeCashSession) {
    return (
      <section className="sk-page">
        <h1>{t('pos.title')}</h1>
        <Banner tone="warning" testId="pos-no-session">{t('session.required')}</Banner>
      </section>
    );
  }

  return (
    <section className="sk-page sk-pos">
      {(banner || creditOverBy) && (
        <div className="sk-pos__header" style={{ marginBottom: '12px' }}>
          <div className="sk-pos__header-alerts" data-testid="pos-alerts">
            {banner ? (
              <div
                className={`sk-pos__pill-alert sk-pos__pill-alert--${banner.tone}`}
                role={banner.tone === 'error' ? 'alert' : 'status'}
                data-testid="pos-banner"
              >
                <span aria-hidden>{banner.tone === 'error' ? '✕' : 'ℹ'}</span>
                <span>{banner.text}</span>
              </div>
            ) : null}
            {creditOverBy ? (
              <div
                className="sk-pos__pill-alert sk-pos__pill-alert--warning"
                role="status"
                data-testid="pos-credit-over-limit"
              >
                <span aria-hidden>⚠️</span>
                <span>{t('pos.creditOverLimit', { amount: creditOverBy })}</span>
              </div>
            ) : null}
          </div>
        </div>
      )}

      <div className="sk-pos__workspace">
        <div className="sk-pos__catalog">
          <div className="sk-pos__catalog-header">
            <div>
              <h2>{t('pos.catalog')}</h2>
              <span>{t('pos.productsAvailable', { count: displayedProducts.length })}</span>
            </div>
            <div className="sk-pos__search-group">
              <label className="sk-pos__search">
                <span className="sk-visually-hidden">{t('pos.search')}</span>
                <span aria-hidden>⌕</span>
                <input
                  type="search"
                  value={search}
                  placeholder={t('pos.search')}
                  autoComplete="off"
                  onChange={(event) => setSearch(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void handleSearchEnter();
                    }
                  }}
                  data-testid="pos-search"
                />
              </label>
              <button
                type="button"
                className="sk-button sk-button--secondary sk-pos__advanced-search-btn"
                onClick={() => setAdvancedSearchOpen(true)}
                aria-label={t('pos.advancedSearch')}
                title={t('pos.advancedSearch')}
                data-testid="pos-advanced-search-btn"
              >
                <span aria-hidden>🔍</span>
              </button>
              <button
                type="button"
                className={`sk-pos__stock-toggle-btn ${inStockOnly ? 'sk-pos__stock-toggle-btn--active' : 'sk-pos__stock-toggle-btn--inactive'}`}
                onClick={() => setInStockOnly((prev) => !prev)}
                aria-pressed={inStockOnly}
                title={inStockOnly ? t('pos.inStockOnly') : t('pos.allStock')}
                data-testid="pos-in-stock-toggle"
              >
                <span aria-hidden>📦</span>
                <span>{inStockOnly ? t('pos.inStockOnly') : t('pos.allStock')}</span>
              </button>
            </div>
          </div>

          <div className="sk-pos__categories" role="group" aria-label={t('pos.categories')} data-testid="pos-categories">
            <button
              type="button"
              className={`sk-pos__category ${categoryId === null ? 'sk-pos__category--active' : ''}`}
              aria-pressed={categoryId === null}
              onClick={() => setCategoryId(null)}
              data-testid="pos-category-all"
            >
              {t('pos.allCategories')}
            </button>
            {categories.map((category) => (
              <button
                key={category.id}
                type="button"
                className={`sk-pos__category ${categoryId === category.id ? 'sk-pos__category--active' : ''}`}
                aria-pressed={categoryId === category.id}
                onClick={() => setCategoryId(category.id)}
                data-testid={`pos-category-${category.id}`}
              >
                {category.name}
              </button>
            ))}
          </div>

          {loading ? (
            <Spinner />
          ) : displayedProducts.length === 0 ? (
            <div className="sk-pos__empty" data-testid="pos-empty-state">
              {catalogBusy ? (
                t('pos.searching')
              ) : hasMore ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                  <span>{t('pos.searching')}</span>
                  <button
                    type="button"
                    className="sk-button sk-button--secondary sk-pos__more"
                    onClick={() => void loadMoreProducts()}
                    disabled={catalogBusy}
                    data-testid="pos-load-more"
                  >
                    {t('pos.showMore')}
                  </button>
                </div>
              ) : (
                t('pos.noProducts')
              )}
            </div>
          ) : (
            <div className="sk-pos__products-scroll">
              <div className="sk-pos__products" data-testid="pos-products">
                {displayedProducts.map((p) => (
                  <button
                    key={p.variant_id}
                    type="button"
                    className="sk-pos__product"
                    aria-label={`${t('pos.addProduct')} ${displayNameOf(p)}`}
                    onClick={() => addToCart(p)}
                    data-testid={`pos-product-${p.variant_id}`}
                  >
                    <span className="sk-pos__product-top">
                      <span className="sk-pos__product-mark" aria-hidden>
                        {p.product_name.trim().charAt(0).toLocaleUpperCase() || '•'}
                      </span>
                      <span className="sk-pos__product-sku">{p.display_identifier}</span>
                    </span>
                    <span className="sk-pos__product-name">{displayNameOf(p)}</span>
                    <div className="sk-pos__product-footer">
                      <span className="sk-pos__product-price">{p.sale_price}</span>
                      {p.quantity_on_hand != null ? (
                        <span
                          className={`sk-pos__product-stock ${isExactDecimalZero(p.quantity_on_hand) ? 'sk-pos__product-stock--zero' : ''}`}
                          data-testid={`pos-product-stock-${p.variant_id}`}
                        >
                          Stock: {formatExactDecimal(p.quantity_on_hand)}
                        </span>
                      ) : null}
                    </div>
                  </button>
                ))}
              </div>
              {hasMore && (
                <button
                  type="button"
                  className="sk-button sk-button--secondary sk-pos__more"
                  onClick={() => void loadMoreProducts()}
                  disabled={catalogBusy}
                  data-testid="pos-load-more"
                >
                  {catalogBusy ? t('pos.searching') : t('pos.showMore')}
                </button>
              )}
            </div>
          )}
        </div>

        <aside className="sk-pos__cart">
          <div className="sk-pos__cart-header">
            <div><h2>{t('pos.cart')}</h2><span>{t('pos.items', { count: cartItemCount })}</span></div>
            <span className="sk-pos__cart-count" aria-hidden>{cartItemCount}</span>
          </div>

          <div className="sk-pos__payment-panel" data-testid="pos-payment-panel">
            <div className="sk-pos__payment-header">
              <span className="sk-pos__payment-label">{creditText.payment}</span>
            </div>
            <div className="sk-pos__payment-toggle" role="group" aria-label={creditText.payment}>
              <button
                type="button"
                className={`sk-pos__payment-tab ${paymentMode === 'cash' ? 'sk-pos__payment-tab--active' : ''}`}
                aria-pressed={paymentMode === 'cash'}
                onClick={() => changePaymentMode('cash')}
                data-testid="payment-cash"
              >
                <span className="sk-pos__payment-icon" aria-hidden>💵</span>
                <span>{creditText.cash}</span>
              </button>
              <button
                type="button"
                className={`sk-pos__payment-tab ${paymentMode === 'credit' ? 'sk-pos__payment-tab--active' : ''}`}
                aria-pressed={paymentMode === 'credit'}
                onClick={() => changePaymentMode('credit')}
                data-testid="payment-credit"
              >
                <span className="sk-pos__payment-icon" aria-hidden>💳</span>
                <span>{creditText.credit}</span>
              </button>
            </div>

            {paymentMode === 'credit' ? (
              <div className="sk-pos__credit-details">
                <label className="sk-field">
                  <span className="sk-field__label">{creditText.customer}</span>
                  <select
                    className="sk-select"
                    value={customerId ?? ''}
                    onChange={(event) => selectCustomer(event.target.value)}
                    data-testid="credit-customer-select"
                  >
                    <option value="">{creditText.chooseCustomer}</option>
                    {creditCustomers.map((customer) => (
                      <option key={customer.id} value={customer.id}>
                        {customer.code} — {customer.name}
                      </option>
                    ))}
                  </select>
                </label>
                {creditCustomers.length === 0 ? (
                  <small className="sk-pos__credit-hint">{creditText.noCreditCustomers}</small>
                ) : null}
                {selectedCustomer ? (
                  <div className="sk-pos__credit-info" data-testid="selected-customer-credit">
                    <div><span>{creditText.limit}:</span> <strong>{selectedCustomer.credit_limit}</strong></div>
                    <div><span>{creditText.exposure}:</span> <strong>{selectedCustomer.exposure_amount}</strong></div>
                    <div className="sk-pos__credit-available"><span>{creditText.available}:</span> <strong>{selectedCustomer.available_credit}</strong></div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="sk-pos__cart-body">
            {cart.length === 0 ? (
              <div className="sk-cart__empty"><span aria-hidden>▤</span><strong>{t('pos.cartEmpty')}</strong><small>{t('pos.cartEmptyHint')}</small></div>
            ) : (
              <ul className="sk-cart" data-testid="pos-cart">
                {cart.map((l) => {
                  const lineTotal = lineTotalOf(l);
                  const rate = l.kind === 'PACK' ? packRate(l.unitPrice, l.pack.factor, 0) : '0';
                  const baseQty = l.kind === 'PACK' ? l.packQuantity * l.pack.factorNum + l.extraQuantity : l.qty;
                  const unitLabel = l.kind === 'PACK' ? l.pack.unitName : (l.baseUnitName || t('sale.pack.piece'));

                  let isBelowCost = false;
                  if (l.wac && isExactDecimalPositive(l.wac)) {
                    if (l.kind === 'BASE') {
                      isBelowCost = compareExactMoney(l.unitPrice, l.wac) < 0;
                    } else {
                      const packCost = multiplyExactDecimal(l.wac, String(l.pack.factorNum));
                      isBelowCost = compareExactMoney(l.unitPrice, packCost) < 0 || (l.extraQuantity > 0 && compareExactMoney(rate, l.wac) < 0);
                    }
                  }

                  return (
                    <li key={l.variantId} className={l.kind === 'PACK' ? 'sk-cart__line sk-cart__line--pack' : 'sk-cart__line'}>
                      <div className="sk-cart__line-header">
                        <div className="sk-cart__identity">
                          <span className="sk-cart__name">{l.name}</span>
                          <span className="sk-cart__sku">{l.sku}</span>
                        </div>
                        <span className="sk-cart__line-total sk-num">
                          {lineTotal}
                        </span>
                      </div>

                      {l.kind === 'PACK' && (
                        <div className="sk-cart__pack-badge">
                          <span>📦 = {baseQty} {l.baseUnitName || t('sale.pack.piece')}</span>
                          {l.extraQuantity > 0 && (
                            <span> · {l.extraQuantity} {l.baseUnitName || t('sale.pack.piece')} à {rate}</span>
                          )}
                        </div>
                      )}

                      {l.packs && l.packs.length > 0 && (
                        <div className="sk-cart__unit-chips">
                          <button
                            type="button"
                            className={`sk-cart__chip ${l.kind === 'BASE' ? 'sk-cart__chip--active' : 'sk-cart__chip--inactive'}`}
                            onClick={() => switchToBase(l.variantId)}
                            data-testid={`unit-chip-base-${l.variantId}`}
                          >
                            {l.baseUnitName || t('sale.pack.piece')}
                          </button>
                          {l.packs.map((p) => {
                            const isSelected = l.kind === 'PACK' && l.pack.unitId === p.unitId;
                            return (
                              <button
                                key={p.unitId}
                                type="button"
                                className={`sk-cart__chip ${isSelected ? 'sk-cart__chip--active' : 'sk-cart__chip--inactive'}`}
                                onClick={() => switchToPack(l.variantId, p)}
                                data-testid={`unit-chip-pack-${l.variantId}-${p.unitId}`}
                              >
                                {p.unitName} ×{formatExactDecimal(p.factor)}
                              </button>
                            );
                          })}
                        </div>
                      )}

                      {l.kind === 'BASE' ? (
                        <div className="sk-cart__footer-row">
                          <div className="sk-cart__qty">
                            <button type="button" className="sk-cart__qty-btn" aria-label={t('pos.decrement')} onClick={() => changeQty(l.variantId, -1)} data-testid={`btn-decrease-base-${l.variantId}`}>−</button>
                            <span data-testid={`qty-${l.variantId}`}>{l.qty}</span>
                            <button type="button" className="sk-cart__qty-btn" aria-label={t('pos.increment')} onClick={() => changeQty(l.variantId, 1)} data-testid={`btn-increase-base-${l.variantId}`}>+</button>
                          </div>

                          <div className="sk-cart__footer-left" style={{ marginInlineStart: 'auto' }}>
                            {l.editingPrice ? (
                              <div className="sk-cart__price-edit-group">
                                <input
                                  type="text"
                                  className="sk-cart__price-input"
                                  value={l.tempPrice ?? l.unitPrice}
                                  onChange={(e) => updateTempPrice(l.variantId, e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') savePrice(l.variantId);
                                    if (e.key === 'Escape') cancelPrice(l.variantId);
                                  }}
                                  autoFocus
                                />
                                <button type="button" className="sk-cart__price-confirm" onClick={() => savePrice(l.variantId)} title="Save">✓</button>
                                <button type="button" className="sk-cart__price-cancel" onClick={() => cancelPrice(l.variantId)} title="Cancel">✕</button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                className="sk-cart__price-btn"
                                onClick={() => startEditPrice(l.variantId)}
                                title={t('pack.edit')}
                              >
                                <span>{l.unitPrice}</span>
                                <span className="sk-cart__price-unit">/ {unitLabel}</span>
                              </button>
                            )}

                            {l.priceOverridden && (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <span className="sk-cart__price-tag">
                                  {t('sale.pack.edited')}
                                </span>
                                <button
                                  type="button"
                                  className="sk-cart__price-reset"
                                  onClick={() => resetPrice(l.variantId)}
                                >
                                  {t('sale.pack.reset')}
                                </button>
                              </div>
                            )}

                            <button type="button" className="sk-cart__remove" onClick={() => removeLine(l.variantId)}>{t('pos.remove')}</button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="sk-cart__pack-grid">
                            <div className="sk-cart__pack-col">
                              <span className="sk-cart__pack-label">{l.pack.unitName}:</span>
                              <div className="sk-cart__qty">
                                <button
                                  type="button"
                                  className="sk-cart__qty-btn"
                                  disabled={l.packQuantity <= 1}
                                  aria-label={t('pos.decrement')}
                                  onClick={() => changePackQty(l.variantId, -1)}
                                  data-testid={`btn-decrease-pack-${l.variantId}`}
                                >
                                  −
                                </button>
                                <span data-testid={`qty-${l.variantId}`} data-testid-pack={`pack-qty-${l.variantId}`}>{l.packQuantity}</span>
                                <button
                                  type="button"
                                  className="sk-cart__qty-btn"
                                  aria-label={t('pos.increment')}
                                  onClick={() => changePackQty(l.variantId, 1)}
                                  data-testid={`btn-increase-pack-${l.variantId}`}
                                >
                                  +
                                </button>
                              </div>
                            </div>

                            <div className="sk-cart__pack-col">
                              <span className="sk-cart__pack-label">+ {t('sale.pack.extra', { base: l.baseUnitName || t('sale.pack.piece') })}:</span>
                              <div className="sk-cart__qty">
                                <button
                                  type="button"
                                  className="sk-cart__qty-btn"
                                  disabled={l.extraQuantity <= 0}
                                  aria-label={t('pos.decrement')}
                                  onClick={() => changeExtraQty(l.variantId, -1)}
                                  data-testid={`btn-decrease-extra-${l.variantId}`}
                                >
                                  −
                                </button>
                                <span data-testid={`extra-qty-${l.variantId}`}>{l.extraQuantity}</span>
                                <button
                                  type="button"
                                  className="sk-cart__qty-btn"
                                  aria-label={t('pos.increment')}
                                  onClick={() => changeExtraQty(l.variantId, 1)}
                                  data-testid={`btn-increase-extra-${l.variantId}`}
                                >
                                  +
                                </button>
                              </div>
                            </div>
                          </div>

                          <div className="sk-cart__footer-row">
                            <div className="sk-cart__footer-left">
                              {l.editingPrice ? (
                                <div className="sk-cart__price-edit-group">
                                  <input
                                    type="text"
                                    className="sk-cart__price-input"
                                    value={l.tempPrice ?? l.unitPrice}
                                    onChange={(e) => updateTempPrice(l.variantId, e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') savePrice(l.variantId);
                                      if (e.key === 'Escape') cancelPrice(l.variantId);
                                    }}
                                    autoFocus
                                  />
                                  <button type="button" className="sk-cart__price-confirm" onClick={() => savePrice(l.variantId)} title="Save">✓</button>
                                  <button type="button" className="sk-cart__price-cancel" onClick={() => cancelPrice(l.variantId)} title="Cancel">✕</button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  className="sk-cart__price-btn"
                                  onClick={() => startEditPrice(l.variantId)}
                                  title={t('pack.edit')}
                                >
                                  <span>{l.unitPrice}</span>
                                  <span className="sk-cart__price-unit">/ {unitLabel}</span>
                                </button>
                              )}

                              {l.priceOverridden && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                  <span className="sk-cart__price-tag">
                                    {t('sale.pack.edited')}
                                  </span>
                                  <button
                                    type="button"
                                    className="sk-cart__price-reset"
                                    onClick={() => resetPrice(l.variantId)}
                                  >
                                    {t('sale.pack.reset')}
                                  </button>
                                </div>
                              )}
                            </div>

                            <button type="button" className="sk-cart__remove" onClick={() => removeLine(l.variantId)}>{t('pos.remove')}</button>
                          </div>
                        </>
                      )}

                      {isBelowCost && (
                        <div style={{ color: 'var(--sk-warn, #d97706)', background: 'var(--sk-warn-soft, #fff6df)', padding: '5px 10px', borderRadius: '6px', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span>⚠️</span>
                          <span>{t('sale.pack.warn.belowCost', { cost: formatExactDecimal(l.wac || '0.00'), base: l.baseUnitName || t('sale.pack.piece') })}</span>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="sk-pos__checkout" data-testid="pos-checkout-bar">
            {canApplyDiscount ? (
              <div className="sk-pos__discount-section" data-testid="pos-discount-section">
                {!discountOpen ? (
                  <button
                    type="button"
                    className="sk-pos__discount-toggle"
                    onClick={() => setDiscountOpen(true)}
                    data-testid="add-discount-btn"
                  >
                    {t('pos.addDiscount')}
                  </button>
                ) : (
                  <div className="sk-pos__discount-box" data-testid="pos-discount-box">
                    <div className="sk-pos__discount-row">
                      <span className="sk-pos__discount-label">{t('pos.discount')} :</span>
                      <div className="sk-pos__discount-input-wrapper">
                        <input
                          type="text"
                          inputMode="decimal"
                          className="sk-pos__discount-input"
                          placeholder="0.00"
                          value={discount}
                          onChange={(e) => setDiscount(e.target.value)}
                          data-testid="pos-discount-input"
                          autoFocus
                        />
                        <span className="sk-pos__discount-currency">DZD</span>
                      </div>
                      <button
                        type="button"
                        className="sk-pos__discount-clear"
                        title={t('pos.removeDiscount')}
                        aria-label={t('pos.removeDiscount')}
                        onClick={() => {
                          setDiscount('');
                          setDiscountOpen(false);
                        }}
                        data-testid="remove-discount-btn"
                      >
                        ×
                      </button>
                    </div>
                    {trimmedDiscount && !discountValid ? (
                      <div className="sk-pos__discount-error" data-testid="pos-discount-error">
                        {t('pos.discountInvalid')}
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            ) : null}

            {hasDiscount ? (
              <div className="sk-cart__summary-breakdown" data-testid="pos-summary-breakdown">
                <div className="sk-cart__summary-subtotal">
                  <span>{t('pos.subtotal')}</span>
                  <strong data-testid="pos-subtotal">{provisionalTotal}</strong>
                </div>
                <div className="sk-cart__summary-discount">
                  <span>{t('pos.discount')}</span>
                  <strong data-testid="pos-discount-amount">-{trimmedDiscount}</strong>
                </div>
              </div>
            ) : null}

            <div className="sk-cart__summary">
              <span>{t('pos.total')}</span>
              <strong data-testid="pos-total">{netTotal}</strong>
            </div>
            <div className="sk-cart__actions">
              <Button
                variant="secondary"
                disabled={cart.length === 0 || submitting}
                onClick={() => setClearing(true)}
              >
                {t('pos.clear')}
              </Button>
              <Button
                disabled={
                  cart.length === 0 ||
                  !discountValid ||
                  (paymentMode === 'credit' && !selectedCustomer)
                }
                loading={submitting}
                onClick={() => setConfirming(true)}
              >
                {creditOverBy ? t('pos.confirmAnyway') : t('pos.confirm')}
              </Button>
            </div>
          </div>
        </aside>
      </div>

      {confirming ? (
        <ConfirmDialog title={t('pos.confirm')} body={<p>{paymentMode === 'credit' ? creditText.creditConfirm : t('pos.confirmPrompt')}</p>} confirmLabel={t('common.confirm')} cancelLabel={t('common.cancel')} onConfirm={() => void confirmSale()} onCancel={() => setConfirming(false)} busy={submitting} />
      ) : null}

      {overridePromptOpen ? (
        <ConfirmDialog
          title={creditText.managerOverride}
          body={(
            <div className="sk-form">
              <label>{creditText.managerUsername}<input value={managerUsername} autoComplete="username" onChange={(event) => setManagerUsername(event.target.value)} data-testid="override-manager-username" /></label>
              <label>{creditText.managerPassword}<input type="password" value={managerPassword} autoComplete="current-password" onChange={(event) => setManagerPassword(event.target.value)} data-testid="override-manager-password" /></label>
              <label>{creditText.reason}<input value={overrideReason} onChange={(event) => setOverrideReason(event.target.value)} data-testid="override-reason" /></label>
            </div>
          )}
          confirmLabel={creditText.authorize}
          cancelLabel={t('common.cancel')}
          onConfirm={() => void authorizeManagerOverride()}
          onCancel={() => { setOverridePromptOpen(false); setManagerPassword(''); setOverrideReason(''); }}
          busy={overrideBusy}
        />
      ) : null}

      {clearing ? (
        <ConfirmDialog
          title={t('pos.clear')}
          confirmLabel={t('common.confirm')}
          cancelLabel={t('common.cancel')}
          confirmVariant="danger"
          onConfirm={() => {
            mutateCart(() => []);
            setDiscount('');
            setDiscountOpen(false);
            setClearing(false);
          }}
          onCancel={() => setClearing(false)}
        />
      ) : null}

      {lastSaleDocId != null ? (
        <div
          className="sk-pos__receipt-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={t('receipt.title')}
          data-testid="pos-receipt-modal"
        >
          <div className="sk-pos__receipt-dialog">
            <div className="sk-pos__receipt-dialog-header">
              <div className="sk-pos__receipt-dialog-title-wrap">
                <Banner tone="success" testId="pos-sold">
                  {t('pos.sold', { number: lastSaleDocId })}
                </Banner>
                {printOutcome && printOutcome.status !== 'disabled' ? (
                  <div className="sk-pos__print-status" data-testid="pos-print-status">
                    {printOutcome.status === 'printed' ? (
                      <Banner tone="success" testId="pos-print-ok">{t('pos.printOk')}</Banner>
                    ) : (
                      <>
                        <Banner tone="warning" testId="pos-print-failed">{t('pos.printFailed')}</Banner>
                        <Button
                          variant="secondary"
                          onClick={() => {
                            if (lastReceiptInput) {
                              void printSaleReceipt(lastReceiptInput, printingSettings, printIdentity).then(setPrintOutcome);
                            }
                          }}
                          data-testid="pos-reprint"
                        >
                          {t('pos.reprint')}
                        </Button>
                      </>
                    )}
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                className="sk-modal-close"
                aria-label={t('common.close')}
                onClick={() => {
                  setLastSaleDocId(null);
                  mutateCart(() => []);
                }}
                data-testid="pos-receipt-close"
              >
                ×
              </button>
            </div>
            <div className="sk-pos__receipt-scroll-body">
              <ReceiptView
                documentId={lastSaleDocId}
                showJobs={false}
                onClose={() => {
                  setLastSaleDocId(null);
                  mutateCart(() => []);
                }}
              />
            </div>
          </div>
        </div>
      ) : null}

      {lastCreditSale ? (
        <div
          className="sk-pos__receipt-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={creditText.creditPosted}
          data-testid="pos-credit-modal"
        >
          <div className="sk-pos__receipt-dialog sk-pos__credit-dialog" data-testid="credit-sale-success">
            <div className="sk-pos__receipt-dialog-header">
              <div className="sk-pos__receipt-dialog-title-wrap">
                <Banner tone="success">
                  {creditText.creditPosted}: {lastCreditSale.document_number}
                  {lastCreditSale.over_limit ? ` — ${t('pos.soldOverLimit')}` : ''}
                </Banner>
                {printOutcome && printOutcome.status !== 'disabled' ? (
                  <div className="sk-pos__print-status" data-testid="pos-print-status">
                    {printOutcome.status === 'printed' ? (
                      <Banner tone="success" testId="pos-print-ok">{t('pos.printOk')}</Banner>
                    ) : (
                      <>
                        <Banner tone="warning" testId="pos-print-failed">{t('pos.printFailed')}</Banner>
                        <Button
                          variant="secondary"
                          onClick={() => {
                            if (lastReceiptInput) {
                              void printSaleReceipt(lastReceiptInput, printingSettings, printIdentity).then(setPrintOutcome);
                            }
                          }}
                          data-testid="pos-reprint"
                        >
                          {t('pos.reprint')}
                        </Button>
                      </>
                    )}
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                className="sk-modal-close"
                aria-label={t('common.close')}
                onClick={() => setLastCreditSale(null)}
                data-testid="pos-credit-close"
              >
                ×
              </button>
            </div>
            <div className="sk-pos__receipt-scroll-body">
              <div className="sk-pos__credit-summary-details">
                <div className="sk-pos__credit-summary-row">
                  <span>{creditText.due}:</span>
                  <strong>{lastCreditSale.due_date}</strong>
                </div>
                <div className="sk-pos__credit-summary-row">
                  <span>{creditText.newExposure}:</span>
                  <strong>{lastCreditSale.exposure_amount}</strong>
                </div>
                <div className="sk-pos__credit-summary-row">
                  <span>{creditText.available}:</span>
                  <strong className={lastCreditSale.over_limit ? 'sk-pos__credit-over-val' : ''}>
                    {lastCreditSale.available_credit}
                  </strong>
                </div>
              </div>
              <div className="sk-pos__credit-dialog-actions">
                <Button onClick={() => setLastCreditSale(null)} data-testid="pos-credit-dismiss">
                  {t('common.close')}
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <ItemSearchModal
        isOpen={advancedSearchOpen}
        onClose={() => {
          setAdvancedSearchOpen(false);
          setAdvancedSearchQuery('');
        }}
        onSelect={(item) => addProductListItemToCart(item)}
        items={advancedSearchResults}
        loading={advancedSearchLoading}
        onQueryChange={setAdvancedSearchQuery}
        title={t('search.title')}
        placeholder={t('search.placeholder')}
        closeOnSelect={false}
      />
    </section>
  );
}
