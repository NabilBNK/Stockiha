/**
 * Touchscreen POS. Cash checkout remains the established Slice 1 path; Slice 4
 * adds customer-aware credit checkout and manager override escalation.
 * Financial eligibility and posted totals remain database-authoritative.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Banner, Button, ConfirmDialog, Spinner } from '../../shared/components';
import { useI18n, type Locale } from '../../shared/i18n';
import { codeForError, useErrorText } from '../../shared/hooks/useErrorText';
import { useSession } from '../../shared/session/SessionContext';
import { useAppData } from '../../app/AppDataContext';
import * as ipc from '../../shared/ipc/gateway';
import { listCustomers } from '../../shared/ipc/customerGateway';
import { authorizeCreditOverride, confirmCreditSale } from '../../shared/ipc/creditSaleGateway';
import type { Customer } from '../../shared/ipc/customerDto';
import type { CreditSaleResult } from '../../shared/ipc/creditSaleDto';
import type { ProductListItem, ProductListItemV2, ReferenceLifecycleItem } from '../../shared/ipc/dto';
import { addExactMoney, multiplyMoneyByQuantity } from '../../shared/money/exactMoney';
import { formatExactDecimal, isExactDecimalZero } from '../inventory/exactDecimal';
import { ReceiptView } from '../documents/ReceiptView';
import { resolveBarcodeFirst } from '../../shared/search/barcodeFirstSearch';
import { ItemSearchModal } from '../../shared/components/ItemSearchModal';

interface CartLine {
  variantId: number;
  sku: string;
  name: string;
  unitPrice: string;
  qty: number;
}

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

export function PosScreen() {
  const { t, locale } = useI18n();
  const creditText = CREDIT_COPY[locale];
  const { user, activeCashSession, workstationId } = useSession();
  const { selectedWarehouseId, openFiscalPeriod } = useAppData();
  const errorText = useErrorText();
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
    ])
      .then(([customerRows, categoryRows]) => {
        setCustomers(customerRows);
        setCategories(categoryRows.filter((category) => category.is_active));
      })
      .finally(() => setLoading(false));
  }, [token]);

  // Products are fetched from the database for the current category and search
  // text, 60 at a time. The catalogue is never loaded into the browser whole.
  useEffect(() => {
    if (!token || selectedWarehouseId == null) return;
    let active = true;
    const timer = setTimeout(() => {
      setCatalogBusy(true);
      ipc
        .listProductsV2(token, selectedWarehouseId, {
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
  }, [token, selectedWarehouseId, search, categoryId]);

  const loadMoreProducts = useCallback(async () => {
    if (!token || selectedWarehouseId == null || catalogBusy) return;
    setCatalogBusy(true);
    try {
      const rows = await ipc.listProductsV2(token, selectedWarehouseId, {
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
  }, [token, selectedWarehouseId, search, categoryId, products.length, catalogBusy]);

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

  function changePaymentMode(next: PaymentMode) {
    setPaymentMode(next);
    if (next === 'cash') setCustomerId(null);
    invalidateSaleIntent();
  }

  function selectCustomer(value: string) {
    setCustomerId(value ? Number(value) : null);
    invalidateSaleIntent();
  }

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
    if (!trimmed || !token || selectedWarehouseId == null) return;

    const result = await resolveBarcodeFirst(token, trimmed);
    if (result.type !== 'match') {
      setBanner({ tone: 'warning', text: t('pos.barcodeNotFound', { query: trimmed }) });
      return;
    }

    // The scanned variant may not be on the current page, so fetch it by the
    // scanned value rather than searching the already-loaded rows.
    const matches = await ipc
      .listProductsV2(token, selectedWarehouseId, {
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

    addToCart(matchedProduct);
    setSearch('');
    setBanner(null);
  }

  function displayNameOf(product: ProductListItemV2): string {
    return product.variant_name
      ? `${product.product_name} — ${product.variant_name}`
      : product.product_name;
  }

  function addToCart(p: ProductListItemV2) {
    mutateCart((prev) => {
      const existing = prev.find((l) => l.variantId === p.variant_id);
      if (existing) {
        return prev.map((l) => (l.variantId === p.variant_id ? { ...l, qty: l.qty + 1 } : l));
      }
      return [
        ...prev,
        {
          variantId: p.variant_id,
          sku: p.sku,
          name: displayNameOf(p),
          unitPrice: p.sale_price,
          qty: 1,
        },
      ];
    });
  }

  function addProductListItemToCart(item: ProductListItem) {
    mutateCart((prev) => {
      const existing = prev.find((l) => l.variantId === item.variant_id);
      if (existing) {
        return prev.map((l) => (l.variantId === item.variant_id ? { ...l, qty: l.qty + 1 } : l));
      }
      const displayName =
        item.product_name && item.name && item.product_name !== item.name
          ? `${item.product_name} — ${item.name}`
          : item.name || item.product_name || item.sku;

      return [
        ...prev,
        {
          variantId: item.variant_id,
          sku: item.sku,
          name: displayName,
          unitPrice: item.sale_price,
          qty: 1,
        },
      ];
    });
  }

  const loadAdvancedSearchResults = useCallback(
    async (query: string) => {
      if (!token || selectedWarehouseId == null) return;
      setAdvancedSearchLoading(true);
      try {
        const rows = await ipc.listProductsV2(token, selectedWarehouseId, {
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
    [token, selectedWarehouseId],
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

  const provisionalTotal = useMemo(
    () => addExactMoney(cart.map((l) => multiplyMoneyByQuantity(l.unitPrice, l.qty))),
    [cart],
  );
  const cartItemCount = useMemo(() => cart.reduce((sum, line) => sum + line.qty, 0), [cart]);
  const creditCustomers = useMemo(
    () => customers.filter((customer) => customer.is_active && customer.credit_enabled),
    [customers],
  );
  const selectedCustomer = useMemo(
    () => creditCustomers.find((customer) => customer.id === customerId) ?? null,
    [creditCustomers, customerId],
  );
  const saleLines = useMemo(
    () => cart.map((line) => ({
      variant_id: line.variantId,
      quantity: String(line.qty),
      unit_price: line.unitPrice,
    })),
    [cart],
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
        setCart([]);
        setRequestId(null);
        setSaleIntentDate(null);
        setCreditOverrideToken(null);
        setLastSaleDocId(null);
        setLastCreditSale(result);
      } else {
        const documentId = await ipc.confirmCashSale(token, {
          requestId: rid,
          cashSessionId: activeCashSession.id,
          warehouseId: activeCashSession.warehouse_id,
          fiscalPeriodId: openFiscalPeriod.id,
          documentDate,
          lines: saleLines,
        });
        setCart([]);
        setRequestId(null);
        setSaleIntentDate(null);
        setCreditOverrideToken(null);
        setLastCreditSale(null);
        setLastSaleDocId(documentId);
      }
    } catch (err) {
      const code = codeForError(err);
      if (code === 'CREDIT_POLICY_BLOCKED' && paymentMode === 'credit') {
        setCreditOverrideToken(null);
        setBanner({ tone: 'error', text: errorText(err) });
        setOverridePromptOpen(true);
      } else if (code === 'PRECONDITION_FAILED') {
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
      <div className="sk-pos__header">
        <div><h1>{t('pos.title')}</h1><p>{t('pos.subtitle')}</p></div>
        <span className="sk-badge sk-badge--ok">{t('header.session.open')}</span>
      </div>

      <div className="sk-pos__workspace">
        <div className="sk-pos__catalog">
          <div className="sk-pos__catalog-header">
            <div>
              <h2>{t('pos.catalog')}</h2>
              <span>{t('pos.productsAvailable', { count: products.length })}</span>
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
          ) : products.length === 0 ? (
            <div className="sk-pos__empty">{catalogBusy ? t('pos.searching') : t('pos.noProducts')}</div>
          ) : (
            <div className="sk-pos__products-scroll">
              <div className="sk-pos__products" data-testid="pos-products">
                {products.map((p) => (
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

          {banner ? <Banner tone={banner.tone} testId="pos-banner">{banner.text}</Banner> : null}
          <div className="sk-pos__cart-body">
            {cart.length === 0 ? (
              <div className="sk-cart__empty"><span aria-hidden>▤</span><strong>{t('pos.cartEmpty')}</strong><small>{t('pos.cartEmptyHint')}</small></div>
            ) : (
              <ul className="sk-cart" data-testid="pos-cart">
                {cart.map((l) => (
                  <li key={l.variantId} className="sk-cart__line">
                    <div className="sk-cart__identity"><span className="sk-cart__name">{l.name}</span><span className="sk-cart__sku">{l.sku}</span></div>
                    <span className="sk-cart__line-total sk-num">{multiplyMoneyByQuantity(l.unitPrice, l.qty)}</span>
                    <div className="sk-cart__qty"><button type="button" className="sk-cart__qty-btn" aria-label={t('pos.decrement')} onClick={() => changeQty(l.variantId, -1)}>−</button><span data-testid={`qty-${l.variantId}`}>{l.qty}</span><button type="button" className="sk-cart__qty-btn" aria-label={t('pos.increment')} onClick={() => changeQty(l.variantId, 1)}>+</button></div>
                    <button type="button" className="sk-cart__remove" onClick={() => removeLine(l.variantId)}>{t('pos.remove')}</button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="sk-pos__checkout" data-testid="pos-checkout-bar">
            <div className="sk-cart__summary"><span>{t('pos.total')}</span><strong data-testid="pos-total">{provisionalTotal}</strong></div>
            <div className="sk-cart__actions">
              <Button variant="secondary" disabled={cart.length === 0 || submitting} onClick={() => setClearing(true)}>{t('pos.clear')}</Button>
              <Button disabled={cart.length === 0 || (paymentMode === 'credit' && !selectedCustomer)} loading={submitting} onClick={() => setConfirming(true)}>{t('pos.confirm')}</Button>
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
        <ConfirmDialog title={t('pos.clear')} confirmLabel={t('common.confirm')} cancelLabel={t('common.cancel')} confirmVariant="danger" onConfirm={() => { mutateCart(() => []); setClearing(false); }} onCancel={() => setClearing(false)} />
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
        <div className="sk-card" data-testid="credit-sale-success">
          <Banner tone="success">{creditText.creditPosted}: {lastCreditSale.document_number}</Banner>
          <p>{creditText.due}: <strong>{lastCreditSale.due_date}</strong></p>
          <p>{creditText.newExposure}: <strong>{lastCreditSale.exposure_amount}</strong></p>
          <p>{creditText.available}: <strong>{lastCreditSale.available_credit}</strong></p>
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
