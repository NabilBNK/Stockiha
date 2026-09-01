/**
 * Slice 2 — product management: catalog list + create/edit workflow.
 * WS-D-4: the list view is now ProductsListView (variant-level, built on
 * list_products_v2); create/edit still goes through ProductEditor exactly
 * as before.
 */
import { useState } from 'react';

import { useSession } from '../../shared/session/SessionContext';
import { ProductEditor } from './ProductEditor';
import { ProductsListView } from './ProductsListView';

type View = 'list' | 'create' | 'edit';

export function ProductsScreen() {
  const { user } = useSession();
  const token = user?.token ?? '';

  const [view, setView] = useState<View>('list');
  const [editProductId, setEditProductId] = useState<number | null>(null);

  function goEdit(productId: number) {
    setEditProductId(productId);
    setView('edit');
  }

  function goList() {
    setView('list');
    setEditProductId(null);
  }

  if (view === 'create') {
    return (
      <ProductEditor
        token={token}
        onCreated={() => goList()}
        onBack={() => setView('list')}
      />
    );
  }

  if (view === 'edit' && editProductId != null) {
    return (
      <ProductEditor
        token={token}
        productId={editProductId}
        onBack={goList}
      />
    );
  }

  // List view
  return (
    <ProductsListView
      token={token}
      onEdit={goEdit}
      onCreateNew={() => setView('create')}
    />
  );
}
