/**
 * WS-D-8a — the products master–detail workspace.
 *
 * RULING 1: the list stays permanently visible on the left; selecting a row
 * opens that product in the detail panel on the right. No navigation away, so
 * the list keeps its scroll position, filters and paging.
 *
 * Below 1440px the two panes cannot both be legible, so the workspace
 * collapses to one pane with a back control. 1440px is DESIGN.md's own layout
 * breakpoint — the width at which the 360px context rail collapses (§6.1) —
 * not a new number invented here.
 *
 * RULING 2 corollary: because fields commit on blur rather than on a save
 * button, swapping the selected product while an edit is still uncommitted
 * would either lose it or write it behind the user's back. Neither is
 * acceptable, so the switch is confirmed and the pending edit is named.
 */
import { useEffect, useState } from 'react';

import { Button, ConfirmDialog } from '../../shared/components';
import { useI18n } from '../../shared/i18n';
import { ProductDetailPanel } from './ProductDetailPanel';
import { ProductsListView } from './ProductsListView';
import { AutosaveDirtyContext, useAutosaveDirtyTracker } from './useAutosaveField';

/** DESIGN.md §6.1 — below this the side-by-side region is not supported. */
const WIDE_QUERY = '(min-width: 1440px)';

function useIsWideViewport(): boolean {
  const [wide, setWide] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
    return window.matchMedia(WIDE_QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(WIDE_QUERY);
    const onChange = () => setWide(query.matches);
    query.addEventListener?.('change', onChange);
    return () => query.removeEventListener?.('change', onChange);
  }, []);

  return wide;
}

export function ProductsWorkspace({
  token,
  onCreateNew,
  initialProductId = null,
}: {
  token: string;
  onCreateNew: () => void;
  /** Opens straight onto a product — used after a create. */
  initialProductId?: number | null;
}) {
  const { t } = useI18n();
  const wide = useIsWideViewport();

  const [selectedProductId, setSelectedProductId] = useState<number | null>(initialProductId);
  const [pendingProductId, setPendingProductId] = useState<number | null>(null);
  const { dirtyLabels, registry, clear } = useAutosaveDirtyTracker();

  function requestSelect(productId: number) {
    if (productId === selectedProductId) return;
    if (dirtyLabels.length > 0) {
      setPendingProductId(productId);
      return;
    }
    setSelectedProductId(productId);
  }

  function discardAndSwitch() {
    clear();
    setSelectedProductId(pendingProductId);
    setPendingProductId(null);
  }

  const detailOpen = selectedProductId != null;
  const showMaster = wide || !detailOpen;

  return (
    <section className="sk-workspace" data-testid="products-workspace">
      <div className="sk-page-header sk-workspace__header">
        <div>
          <h1>{t('catalog.title')}</h1>
          <p className="sk-muted">{t('productsList.subtitle')}</p>
        </div>
        <Button onClick={onCreateNew} data-testid="new-product-btn">
          {t('catalog.new')}
        </Button>
      </div>

      <div
        className={`sk-workspace__grid${detailOpen && wide ? ' sk-workspace__grid--split' : ''}`}
      >
        {showMaster ? (
          <div className="sk-workspace__master">
            <ProductsListView
              token={token}
              selectedProductId={selectedProductId}
              onSelect={requestSelect}
            />
          </div>
        ) : null}

        {selectedProductId != null ? (
          <div className="sk-workspace__detail">
            <AutosaveDirtyContext.Provider value={registry}>
              <ProductDetailPanel
                key={selectedProductId}
                token={token}
                productId={selectedProductId}
                showBack={!wide}
                onBack={() => {
                  clear();
                  setSelectedProductId(null);
                }}
              />
            </AutosaveDirtyContext.Provider>
          </div>
        ) : null}
      </div>

      {pendingProductId != null ? (
        <ConfirmDialog
          title={t('autosave.unsavedTitle')}
          body={t('autosave.unsavedBody', { fields: dirtyLabels.join(', ') })}
          confirmLabel={t('autosave.discard')}
          cancelLabel={t('autosave.stay')}
          confirmVariant="danger"
          onConfirm={discardAndSwitch}
          onCancel={() => setPendingProductId(null)}
        />
      ) : null}
    </section>
  );
}
