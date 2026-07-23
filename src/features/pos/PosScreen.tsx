/**
 * Slice 1 — touchscreen POS. Product grid + cart with quantity controls and
 * provisional (display-only) totals. Requires an open cash session. Generates
 * one client request id per intended sale (reused on uncertain retry,
 * regenerated when the cart changes), prevents double submission, and only
 * clears the cart after confirmed backend success. The backend result is
 * authoritative; the posted receipt (official number, lines, job states) is
 * shown after success.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Banner, Button, ConfirmDialog, Spinner } from '../../shared/components';
import { useI18n } from '../../shared/i18n';
import { codeForError, useErrorText } from '../../shared/hooks/useErrorText';
import { useSession } from '../../shared/session/SessionContext';
import { useAppData } from '../../app/AppDataContext';
import * as ipc from '../../shared/ipc/gateway';
import type { ProductListItem } from '../../shared/ipc/dto';
import { ReceiptView } from '../documents/ReceiptView';

interface CartLine {
  variantId: number;
  sku: string;
  name: string;
  unitPrice: string;
  qty: number;
}

export function PosScreen() {
  const { t } = useI18n();
  const { user, activeCashSession } = useSession();
  const { selectedWarehouseId, openFiscalPeriod } = useAppData();
  const errorText = useErrorText();
  const token = user?.token ?? '';

  const [products, setProducts] = useState<ProductListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [banner, setBanner] = useState<{ tone: 'error' | 'warning'; text: string } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [lastSaleDocId, setLastSaleDocId] = useState<number | null>(null);

  useEffect(() => {
    if (!token || selectedWarehouseId == null) return;
    setLoading(true);
    ipc
      .listProducts(token, selectedWarehouseId)
      .then(setProducts)
      .catch(() => setProducts([]))
      .finally(() => setLoading(false));
  }, [token, selectedWarehouseId]);

  // Cart mutations invalidate the idempotency key (new intended sale).
  const mutateCart = useCallback((next: (prev: CartLine[]) => CartLine[]) => {
    setCart(next);
    setRequestId(null);
    setBanner(null);
    setLastSaleDocId(null);
  }, []);

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

  // Provisional totals — display only; the backend total is authoritative.
  const provisionalTotal = useMemo(
    () => cart.reduce((sum, l) => sum + Number(l.unitPrice) * l.qty, 0).toFixed(2),
    [cart],
  );

  async function confirmSale() {
    setConfirming(false);
    if (submitting || !token || !activeCashSession || openFiscalPeriod == null || cart.length === 0)
      return;
    const rid = requestId ?? ipc.newRequestId();
    setRequestId(rid);
    setSubmitting(true);
    setBanner(null);
    try {
      const documentId = await ipc.confirmCashSale(token, {
        requestId: rid,
        cashSessionId: activeCashSession.id,
        warehouseId: activeCashSession.warehouse_id,
        fiscalPeriodId: openFiscalPeriod.id,
        documentDate: openFiscalPeriod.starts_on,
        lines: cart.map((l) => ({
          variant_id: l.variantId,
          quantity: String(l.qty),
          unit_price: l.unitPrice,
        })),
      });
      // Confirmed success: only now clear the cart, and show the receipt.
      setCart([]);
      setRequestId(null);
      setLastSaleDocId(documentId);
    } catch (err) {
      const code = codeForError(err);
      if (code === 'PRECONDITION_FAILED') {
        setBanner({ tone: 'error', text: t('pos.insufficientStock') });
      } else if (code === 'UNKNOWN_ERROR') {
        // Uncertain: keep the same request id so a retry is idempotent.
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
      <div className="sk-pos__grid">
        <h1>{t('pos.title')}</h1>
        {loading ? (
          <Spinner />
        ) : (
          <div className="sk-pos__products" data-testid="pos-products">
            {products.map((p) => (
              <button
                key={p.variant_id}
                type="button"
                className="sk-pos__product"
                onClick={() => addToCart(p)}
              >
                <span className="sk-pos__product-name">{p.name}</span>
                <span className="sk-pos__product-sku">{p.sku}</span>
                <span className="sk-pos__product-price">{p.sale_price}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <aside className="sk-pos__cart">
        <h2>{t('pos.cart')}</h2>
        {banner ? <Banner tone={banner.tone} testId="pos-banner">{banner.text}</Banner> : null}
        {cart.length === 0 ? (
          <Banner tone="info">{t('pos.cartEmpty')}</Banner>
        ) : (
          <ul className="sk-cart" data-testid="pos-cart">
            {cart.map((l) => (
              <li key={l.variantId} className="sk-cart__line">
                <span className="sk-cart__name">{l.name}</span>
                <div className="sk-cart__qty">
                  <button type="button" aria-label="decrement" onClick={() => changeQty(l.variantId, -1)}>
                    −
                  </button>
                  <span data-testid={`qty-${l.variantId}`}>{l.qty}</span>
                  <button type="button" aria-label="increment" onClick={() => changeQty(l.variantId, 1)}>
                    +
                  </button>
                </div>
                <span className="sk-num">{(Number(l.unitPrice) * l.qty).toFixed(2)}</span>
                <button type="button" className="sk-cart__remove" onClick={() => removeLine(l.variantId)}>
                  {t('pos.remove')}
                </button>
              </li>
            ))}
          </ul>
        )}

        <p className="sk-cart__total" data-testid="pos-total">
          {t('pos.total')}: {provisionalTotal}
        </p>

        <div className="sk-cart__actions">
          <Button
            variant="secondary"
            disabled={cart.length === 0 || submitting}
            onClick={() => setClearing(true)}
          >
            {t('pos.clear')}
          </Button>
          <Button
            disabled={cart.length === 0}
            loading={submitting}
            onClick={() => setConfirming(true)}
          >
            {t('pos.confirm')}
          </Button>
        </div>
      </aside>

      {confirming ? (
        <ConfirmDialog
          title={t('pos.confirm')}
          body={<p>{t('pos.confirmPrompt')}</p>}
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
    </section>
  );
}
