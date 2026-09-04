/**
 * Slice 2 — product management.
 *
 * WS-D-8a: the list and the edit flow are no longer two screens. They are one
 * master-detail workspace (ProductsWorkspace) with no navigation between
 * them, so selecting a product never costs the list its scroll position,
 * filters or page. Only creation is still a separate view, because it is a
 * different task with a different shape — it is rebuilt under WS-D-8b.
 */
import { useState } from 'react';

import { useSession } from '../../shared/session/SessionContext';
import { ProductEditor } from './ProductEditor';
import { ProductsWorkspace } from './ProductsWorkspace';

export function ProductsScreen() {
  const { user } = useSession();
  const token = user?.token ?? '';

  const [creating, setCreating] = useState(false);
  // A freshly created product opens straight in the detail panel; making the
  // operator hunt for it in the list would be exactly the extra step this
  // rebuild exists to remove.
  const [openProductId, setOpenProductId] = useState<number | null>(null);
  const [workspaceKey, setWorkspaceKey] = useState(0);

  if (creating) {
    return (
      <ProductEditor
        token={token}
        onCreated={(productId) => {
          setOpenProductId(productId);
          setWorkspaceKey((k) => k + 1);
          setCreating(false);
        }}
        onBack={() => setCreating(false)}
      />
    );
  }

  return (
    <ProductsWorkspace
      key={workspaceKey}
      token={token}
      initialProductId={openProductId}
      onCreateNew={() => setCreating(true)}
    />
  );
}
