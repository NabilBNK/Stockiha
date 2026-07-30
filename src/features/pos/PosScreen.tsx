/**
 * Touchscreen POS. Cash checkout remains the established Slice 1 path; Slice 4
 * adds customer-aware credit checkout. Financial eligibility and posted totals
 * remain database-authoritative.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Banner, Button, ConfirmDialog, Spinner } from '../../shared/components';
import { useI18n, type Locale } from '../../shared/i18n';
import { codeForError, useErrorText } from '../../shared/hooks/useErrorText';
import { useSession } from '../../shared/session/SessionContext';
import { useAppData } from '../../app/AppDataContext';
import * as ipc from '../../shared/ipc/gateway';
import { listCustomers } from '../../shared/ipc/customerGateway';
import { confirmCreditSale } from '../../shared/ipc/creditSaleGateway';
import type { Customer } from '../../shared/ipc/customerDto';
import type { CreditSaleResult } from '../../shared/ipc/creditSaleDto';
import type { ProductListItem } from '../../shared/ipc/dto';
import { ReceiptView } from '../documents/ReceiptView';

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
    payment: 'Payment',
    cash: 'Cash',
    credit: 'Credit',
    customer: 'Customer',
    chooseCustomer: 'Choose a credit customer',
    exposure: 'Exposure',
    available: 'Available credit',
    limit: 'Credit limit',
    creditConfirm: 'Confirm this customer credit sale?',
    creditBlocked: 'Credit sale blocked by customer credit policy or current stock state.',
    creditPosted: 'Credit sale posted',
    due: 'Due date',
    newExposure: 'New exposure',
    noCreditCustomers: 'No active credit-enabled customers.',
  },
  fr: {
    payment: 'Paiement',
    cash: 'Espèces',
    credit: 'Crédit',
    customer: 'Client',
    chooseCustomer: 'Choisir un client autorisé au crédit',
    exposure: 'Encours',
    available: 'Crédit disponible',
    limit: 'Plafond de crédit',
    creditConfirm: 'Confirmer cette vente à crédit ?',
    creditBlocked: 'Vente à crédit bloquée par la politique de crédit client ou l’état actuel du stock.',
    creditPosted: 'Vente à crédit enregistrée',
    due: 'Échéance',
    newExposure: 'Nouvel encours',
    noCreditCustomers: 'Aucun client actif autorisé au crédit.',
  },
  ar: {
    payment: 'الدفع',
    cash: 'نقداً',
    credit: 'بالدين',
    customer: 'العميل',
    chooseCustomer: 'اختر عميلاً مسموحاً له بالائتمان',
    exposure: 'الدين الحالي',
    available: 'الائتمان المتاح',
    limit: 'حد الائتمان',
    creditConfirm: 'تأكيد البيع بالدين لهذا العميل؟',
    creditBlocked: 'تم منع البيع بالدين بسبب سياسة ائتمان العميل أو حالة المخزون الحالية.',
    creditPosted: 'تم تسجيل البيع بالدين',
    due: 'تاريخ الاستحقاق',
    newExposure: 'الدين الجديد',
    noCreditCustomers: 'لا يوجد عملاء نشطون مسموح لهم بالائتمان.',
  },
};

function currentLocalDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function PosScreen() {
  const { t, locale } = useI18n();
  const creditText = CREDIT_COPY[locale];
  const { user, activeCashSession } = useSession();
  const { selectedWarehouseId, openFiscalPeriod } = useAppData();
  const errorText = useErrorText();
  const token = user?.token ?? '';

  const [products, setProducts] = useState<ProductListItem[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('cash');
  const [customerId, setCustomerId] = useState<number | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [banner, setBanner] = useState<{ tone: 'error' | 'warning'; text: string } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [lastSaleDocId, setLastSaleDocId] = useState<number | null>(null);
  const [lastCreditSale, setLastCreditSale] = useState<CreditSaleResult | null>(null);

  useEffect(() => {
    if (!token || selectedWarehouseId == null) return;
    setLoading(true);
    Promise.all([
      ipc.listProducts(token, selectedWarehouseId).catch(() => []),
      listCustomers(token, false).catch(() => []),
    ])
      .then(([productRows, customerRows]) => {
        setProducts(productRows);
        setCustomers(customerRows);
      })
      .finally(() => setLoading(false));
  }, [token, selectedWarehouseId]);

  const invalidateSaleIntent = useCallback(() => {
    setRequestId(null);
    setBanner(null);
    setLastSaleDocId(null);
    setLastCreditSale(null);
  }, []);

  const mutateCart = useCallback((next: (prev: CartLine[]) => CartLine[]) => {
    setCart(next);
    invalidateSaleIntent();
  }, [invalidateSaleIntent]);

  function changePaymentMode(next: PaymentMode) {
    setPaymentMode(next);
    if (next === 'cash') setCustomerId(null);
    invalidateSaleIntent();
  }

  function selectCustomer(value: string) {
    setCustomerId(value ? Number(value) : null);
    invalidateSaleIntent();
  }

  function addToCart(p: ProductListItem) {
    mutateCart((prev) => {
      const existing = prev.find((l) => l.variantId === p.variant_id);
      if (existing) {
        return prev.map((l) => (l.variantId === p.variant_id ? { ...l, qty: l.qty + 1 } : l));
      }
      return [
        ...prev,
        { variantId: p.variant_id, sku: p.sku, name: p.name, unitPrice: p.sale_price, qty: 1 },
      ];
    });
  }

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
    () => cart.reduce((sum, l) => sum + Number(l.unitPrice) * l.qty, 0).toFixed(2),
    [cart],
  );
  const cartItemCount = useMemo(() => cart.reduce((sum, line) => sum + line.qty, 0), [cart]);
  const filteredProducts = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return products;
    return products.filter(
      (product) =>
        product.name.toLocaleLowerCase().includes(query) ||
        product.sku.toLocaleLowerCase().includes(query),
    );
  }, [products, search]);
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
      submitting ||
      !token ||
      !activeCashSession ||
      openFiscalPeriod == null ||
      cart.length === 0 ||
      (paymentMode === 'credit' && !selectedCustomer)
    ) return;

    const rid = requestId ?? ipc.newRequestId();
    setRequestId(rid);
    setSubmitting(true);
    setBanner(null);

    try {
      if (paymentMode === 'credit' && selectedCustomer) {
        const result = await confirmCreditSale(token, {
          request_id: rid,
          customer_id: selectedCustomer.id,
          warehouse_id: activeCashSession.warehouse_id,
          fiscal_period_id: openFiscalPeriod.id,
          document_date: currentLocalDate(),
          lines: saleLines,
          override_token: null,
        });
        setCart([]);
        setRequestId(null);
        setLastSaleDocId(null);
        setLastCreditSale(result);
      } else {
        const documentId = await ipc.confirmCashSale(token, {
          requestId: rid,
          cashSessionId: activeCashSession.id,
          warehouseId: activeCashSession.warehouse_id,
          fiscalPeriodId: openFiscalPeriod.id,
          documentDate: currentLocalDate(),
          lines: saleLines,
        });
        setCart([]);
        setRequestId(null);
        setLastCreditSale(null);
        setLastSaleDocId(documentId);
      }
    } catch (err) {
      const code = codeForError(err);
      if (code === 'PRECONDITION_FAILED') {
        setBanner({
          tone: 'error',
          text: paymentMode === 'credit' ? creditText.creditBlocked : t('pos.insufficientStock'),
        });
      } else if (code === 'UNKNOWN_ERROR') {
        setBanner({ tone: 'warning', text: t('stock.retryPrompt') });
      } else {
        setBanner({ tone: 'error', text: errorText(err) });
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (!activeCashSession) {
    return (
      <section className="sk-page">
        <h1>{t('pos.title')}</h1>
        <Banner tone="warning" testId="pos-no-session">
          {t('session.required')}
        </Banner>
      </section>
    );
  }

  return (
    <section className="sk-page sk-pos">
      <div className="sk-pos__header">
        <div>
          <h1>{t('pos.title')}</h1>
          <p>{t('pos.subtitle')}</p>
        </div>
        <span className="sk-badge sk-badge--ok">{t('header.session.open')}</span>
      </div>

      <div className="sk-pos__workspace">
        <div className="sk-pos__catalog">
          <div className="sk-pos__catalog-header">
            <div>
              <h2>{t('pos.catalog')}</h2>
              <span>{t('pos.productsAvailable', { count: filteredProducts.length })}</span>
            </div>
            <label className="sk-pos__search">
              <span className="sk-visually-hidden">{t('pos.search')}</span>
              <span aria-hidden>⌕</span>
              <input
                type="search"
                value={search}
                placeholder={t('pos.search')}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
          </div>

          {loading ? (
            <Spinner />
          ) : filteredProducts.length === 0 ? (
            <div className="sk-pos__empty">{t('pos.noProducts')}</div>
          ) : (
            <div className="sk-pos__products" data-testid="pos-products">
              {filteredProducts.map((p) => (
                <button
                  key={p.variant_id}
                  type="button"
                  className="sk-pos__product"
                  aria-label={`${t('pos.addProduct')} ${p.name}`}
                  onClick={() => addToCart(p)}
                >
                  <span className="sk-pos__product-top">
                    <span className="sk-pos__product-mark" aria-hidden>
                      {p.name.trim().charAt(0).toLocaleUpperCase() || '•'}
                    </span>
                    <span className="sk-pos__product-sku">{p.sku}</span>
                  </span>
                  <span className="sk-pos__product-name">{p.name}</span>
                  <span className="sk-pos__product-price">{p.sale_price}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <aside className="sk-pos__cart">
          <div className="sk-pos__cart-header">
            <div>
              <h2>{t('pos.cart')}</h2>
              <span>{t('pos.items', { count: cartItemCount })}</span>
            </div>
            <span className="sk-pos__cart-count" aria-hidden>{cartItemCount}</span>
          </div>

          <div className="sk-card sk-form" data-testid="pos-payment-panel">
            <span>{creditText.payment}</span>
            <div className="sk-form-actions" role="group" aria-label={creditText.payment}>
              <button
                type="button"
                className={`sk-button ${paymentMode === 'cash' ? 'sk-button--primary' : 'sk-button--secondary'}`}
                aria-pressed={paymentMode === 'cash'}
                onClick={() => changePaymentMode('cash')}
              >
                {creditText.cash}
              </button>
              <button
                type="button"
                className={`sk-button ${paymentMode === 'credit' ? 'sk-button--primary' : 'sk-button--secondary'}`}
                aria-pressed={paymentMode === 'credit'}
                onClick={() => changePaymentMode('credit')}
                data-testid="payment-credit"
              >
                {creditText.credit}
              </button>
            </div>

            {paymentMode === 'credit' ? (
              <>
                <label>
                  {creditText.customer}
                  <select
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
                {creditCustomers.length === 0 ? <small>{creditText.noCreditCustomers}</small> : null}
                {selectedCustomer ? (
                  <div data-testid="selected-customer-credit">
                    <span>{creditText.limit}: {selectedCustomer.credit_limit}</span>{' · '}
                    <span>{creditText.exposure}: {selectedCustomer.exposure_amount}</span>{' · '}
                    <strong>{creditText.available}: {selectedCustomer.available_credit}</strong>
                  </div>
                ) : null}
              </>
            ) : null}
          </div>

          {banner ? <Banner tone={banner.tone} testId="pos-banner">{banner.text}</Banner> : null}
          <div className="sk-pos__cart-body">
            {cart.length === 0 ? (
              <div className="sk-cart__empty">
                <span aria-hidden>▤</span>
                <strong>{t('pos.cartEmpty')}</strong>
                <small>{t('pos.cartEmptyHint')}</small>
              </div>
            ) : (
              <ul className="sk-cart" data-testid="pos-cart">
                {cart.map((l) => (
                  <li key={l.variantId} className="sk-cart__line">
                    <div className="sk-cart__identity">
                      <span className="sk-cart__name">{l.name}</span>
                      <span className="sk-cart__sku">{l.sku}</span>
                    </div>
                    <span className="sk-cart__line-total sk-num">
                      {(Number(l.unitPrice) * l.qty).toFixed(2)}
                    </span>
                    <div className="sk-cart__qty">
                      <button type="button" aria-label="decrement" onClick={() => changeQty(l.variantId, -1)}>−</button>
                      <span data-testid={`qty-${l.variantId}`}>{l.qty}</span>
                      <button type="button" aria-label="increment" onClick={() => changeQty(l.variantId, 1)}>+</button>
                    </div>
                    <button type="button" className="sk-cart__remove" onClick={() => removeLine(l.variantId)}>
                      {t('pos.remove')}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="sk-cart__summary">
            <span>{t('pos.total')}</span>
            <strong data-testid="pos-total">{provisionalTotal}</strong>
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
              disabled={cart.length === 0 || (paymentMode === 'credit' && !selectedCustomer)}
              loading={submitting}
              onClick={() => setConfirming(true)}
            >
              {t('pos.confirm')}
            </Button>
          </div>
        </aside>
      </div>

      {confirming ? (
        <ConfirmDialog
          title={t('pos.confirm')}
          body={<p>{paymentMode === 'credit' ? creditText.creditConfirm : t('pos.confirmPrompt')}</p>}
          confirmLabel={t('common.confirm')}
          cancelLabel={t('common.cancel')}
          onConfirm={() => void confirmSale()}
          onCancel={() => setConfirming(false)}
          busy={submitting}
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
            setClearing(false);
          }}
          onCancel={() => setClearing(false)}
        />
      ) : null}

      {lastSaleDocId != null ? (
        <div className="sk-pos__receipt">
          <Banner tone="success" testId="pos-sold">
            {t('pos.sold', { number: lastSaleDocId })}
          </Banner>
          <ReceiptView documentId={lastSaleDocId} />
        </div>
      ) : null}

      {lastCreditSale ? (
        <div className="sk-card" data-testid="credit-sale-success">
          <Banner tone="success">
            {creditText.creditPosted}: {lastCreditSale.document_number}
          </Banner>
          <p>{creditText.due}: <strong>{lastCreditSale.due_date}</strong></p>
          <p>{creditText.newExposure}: <strong>{lastCreditSale.exposure_amount}</strong></p>
          <p>{creditText.available}: <strong>{lastCreditSale.available_credit}</strong></p>
        </div>
      ) : null}
    </section>
  );
}
